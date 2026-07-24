import { normalize, yearOf } from './utils.js';

export function makeClientId() {
  return globalThis.crypto?.randomUUID?.() || `ringside-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function viewingState(item, threshold = 0.9) {
  const duration = Number(item.duration || 0);
  const offset = Number(item.viewOffset || 0);
  const ratio = duration > 0 ? Math.min(1, offset / duration) : 0;
  const watched = Number(item.viewCount || 0) > 0 || ratio >= threshold;
  return { watched, progress: ratio, viewOffset: offset, duration, lastViewedAt: item.lastViewedAt || null };
}

function cleanMediaTitle(value) {
  return normalize(String(value || '')
    .replace(/\.[a-z0-9]{2,5}$/i, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|uhd|hdr10?|dv|web[ .-]?dl|webrip|bluray|brrip|hdtv|x26[45]|hevc|av1|aac|dts|proper|repack|multi|extended)\b/gi, ' ')
    .replace(/^\s*\d{1,3}[. _-]+/, ' '));
}

function similarity(left, right) {
  const a = cleanMediaTitle(left), b = cleanMediaTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 120;
  if (a.startsWith(`${b} `) || b.startsWith(`${a} `)) return 105;
  if (a.includes(b) || b.includes(a)) return 92;
  const aa = new Set(a.split(' ').filter(token => token.length > 1));
  const bb = new Set(b.split(' ').filter(token => token.length > 1));
  const intersection = [...aa].filter(token => bb.has(token)).length;
  const union = new Set([...aa, ...bb]).size || 1;
  return Math.round((intersection / union) * 80);
}

function bestProgramme(programmeAliases, ...titles) {
  let best = null;
  for (const entry of programmeAliases) {
    for (const title of titles.filter(Boolean)) {
      for (const name of entry.rawNames) {
        const score = similarity(title, name);
        if (!best || score > best.score) best = { programme: entry.programme, score };
      }
    }
  }
  return best;
}

function episodeNumbers(item) {
  let season = Number(item.parentIndex ?? item.season ?? item.seasonNumber);
  let episode = Number(item.index ?? item.episode ?? item.episodeNumber);
  if (Number.isFinite(season) && Number.isFinite(episode)) return { season, episode };
  const text = `${item.title || ''} ${item.parentTitle || ''}`;
  let match = text.match(/\bS(\d{1,4})[ ._-]*E(\d{1,4})\b/i);
  if (!match) match = text.match(/\bseason[ ._-]*(\d{1,4})[ ._-]*(?:episode|ep)[ ._-]*(\d{1,4})\b/i);
  if (!match) return null;
  season = Number(match[1]); episode = Number(match[2]);
  return Number.isFinite(season) && Number.isFinite(episode) ? { season, episode } : null;
}

export function buildPlexMatches(data, plexItems = [], threshold = 0.9) {
  const matches = new Set(), links = new Map(), viewing = new Map();
  const programmeAliases = data.programmes.map(programme => ({
    programme,
    rawNames: [programme.name, ...(programme.aliases || []), programme.traktTitle].filter(Boolean)
  }));
  const eventsByYear = new Map();
  for (const event of data.majorEvents) {
    const year = yearOf(event.date);
    if (!eventsByYear.has(year)) eventsByYear.set(year, []);
    eventsByYear.get(year).push(event);
  }

  let validItems = 0, matchedItems = 0;
  for (const item of plexItems) {
    if (!item || (!item.title && !item.grandparentTitle && !item.ratingKey)) continue;
    validItems++;
    const showTitle = item.grandparentTitle || item.showTitle || (item.type === 'show' ? item.title : '');
    const title = item.title || item.name || '';
    const libraryLooksRelevant = /wrestl|ppv|sports show|combat/i.test(String(item.library || ''));
    let programme = null;
    const programmeHit = bestProgramme(programmeAliases, showTitle, title);
    if (programmeHit && (programmeHit.score >= (showTitle ? 88 : libraryLooksRelevant ? 92 : 105))) programme = programmeHit.programme;

    let itemMatched = false;
    if (programme) {
      const programKey = `program:${programme.id}`;
      matches.add(programKey);
      if (!links.has(programKey)) links.set(programKey, item);
      itemMatched = true;
      const numbers = episodeNumbers(item);
      if (numbers && (item.type === 'episode' || /episode|s\d+e\d+/i.test(`${item.type || ''} ${title}`))) {
        const episodeKey = `episode:${programme.id}:${numbers.season}:${numbers.episode}`;
        matches.add(episodeKey);
        links.set(episodeKey, item);
        viewing.set(episodeKey, viewingState(item, threshold));
      }
    }

    const normalizedTitle = cleanMediaTitle(title);
    const itemYear = Number(item.year) || yearOf(item.originallyAvailableAt) || Number((String(title).match(/\b(19\d{2}|20\d{2})\b/) || [])[1]);
    if (normalizedTitle && itemYear) {
      let bestEvent = null;
      for (const candidate of eventsByYear.get(itemYear) || []) {
        const score = Math.max(
          similarity(title, candidate.title),
          similarity(title, candidate.event),
          similarity(title, candidate.eventName)
        );
        if (!bestEvent || score > bestEvent.score) bestEvent = { event: candidate, score };
      }
      if (bestEvent && bestEvent.score >= (libraryLooksRelevant ? 78 : 92)) {
        const key = `event:${bestEvent.event.id}`;
        matches.add(key);
        links.set(key, item);
        viewing.set(key, viewingState(item, threshold));
        itemMatched = true;
      }
    }
    if (itemMatched) matchedItems++;
  }
  return { matches, links, viewing, diagnostics: { totalItems: plexItems.length, validItems, matchedItems } };
}

export function plexWebUrl(item, server) {
  if (!item?.ratingKey || !server?.machineIdentifier) return '';
  const key = encodeURIComponent(`/library/metadata/${item.ratingKey}`);
  return `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(server.machineIdentifier)}/details?key=${key}`;
}

async function jsonResponse(response, fallback) {
  const text = await response.text().catch(() => '');
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { error: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) }; }
  }
  if (!response.ok) {
    const details = data.details?.length ? ` ${data.details.join(' | ')}` : '';
    throw new Error(`${data.error || data.message || fallback} (${response.status})${details}`);
  }
  return data;
}

export async function createPlexPin(clientId, accountHeaders = {}) {
  const response = await fetch('./api/plex/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders },
    body: JSON.stringify({ clientId, forwardUrl: location.href.split('#')[0] })
  });
  return jsonResponse(response, 'Unable to start Plex sign-in.');
}

export async function pollPlexPin(clientId, pinId, accountHeaders = {}) {
  const response = await fetch(`./api/plex/pin?id=${encodeURIComponent(pinId)}&clientId=${encodeURIComponent(clientId)}`, {
    headers: accountHeaders,
    cache: 'no-store'
  });
  return jsonResponse(response, 'Plex sign-in failed.');
}

export async function loadPlexResources(clientId, token, accountHeaders = {}) {
  const response = await fetch('./api/plex/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders },
    body: JSON.stringify({ clientId, token })
  });
  return jsonResponse(response, 'Unable to load Plex servers.');
}

export async function listPlexLibraries(clientId, token, server, accountHeaders = {}) {
  const response = await fetch('./api/plex/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders },
    body: JSON.stringify({
      action: 'sections', clientId, token, server,
      machineIdentifier: server?.machineIdentifier || server
    })
  });
  return jsonResponse(response, 'Unable to load Plex libraries.');
}

export async function scanPlexLibrary(clientId, token, server, sectionKeys = [], accountHeaders = {}) {
  const response = await fetch('./api/plex/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders },
    body: JSON.stringify({
      action: 'scan', clientId, token, server, sectionKeys,
      machineIdentifier: server?.machineIdentifier || server
    })
  });
  return jsonResponse(response, 'Unable to scan Plex library.');
}

export async function updatePlexViewState({ clientId, token, server, item, action, accountHeaders = {} }) {
  const response = await fetch('./api/plex/view-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders },
    body: JSON.stringify({
      clientId, token, server,
      machineIdentifier: item?.machineIdentifier || server?.machineIdentifier,
      ratingKey: item?.ratingKey, action
    })
  });
  return jsonResponse(response, 'Unable to update Plex viewing state.');
}

function artworkInput(item, programme, extra = {}) {
  return {
    key: extra.key || item.id || item.name,
    id: item.id,
    title: item.title || item.name,
    aliases: extra.aliases || item.aliases || [],
    year: yearOf(item.date || item.firstAirDate),
    kind: extra.kind || item.kind || programme?.kind || 'show',
    programmeTitle: programme?.name || '',
    season: item.season ?? null,
    episode: item.number ?? null
  };
}

export async function searchArtwork(item, programme, extra = {}) {
  const response = await fetch('./api/artwork/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(artworkInput(item, programme, extra))
  });
  return jsonResponse(response, 'Artwork scan failed.');
}

export async function searchArtworkBatch(entries = []) {
  const items = entries.slice(0, 12).map(entry => artworkInput(entry.item, entry.programme, entry.extra || {}));
  const response = await fetch('./api/artwork/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  });
  return jsonResponse(response, 'Artwork batch scan failed.');
}

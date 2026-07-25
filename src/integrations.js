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
    .replace(/\bAll Elite Wrestling\b/gi, 'AEW')
    .replace(/\bWorld Championship Wrestling\b/gi, 'WCW')
    .replace(/\bWorld Wrestling Entertainment\b/gi, 'WWE')
    .replace(/\bWorld Wrestling Federation\b/gi, 'WWE')
    .replace(/\bTotal Nonstop Action(?: Wrestling)?\b/gi, 'TNA')
    .replace(/\bRing of Honor\b/gi, 'ROH')
    .replace(/\bNew Japan Pro[ -]?Wrestling\b/gi, 'NJPW')
    .replace(/\bNational Wrestling Alliance\b/gi, 'NWA')
    .replace(/\b(?:Eastern|Extreme) Championship Wrestling\b/gi, 'ECW')
    .replace(/\bAmerican Wrestling Association\b/gi, 'AWA')
    .replace(/\bJim Crockett Promotions\b/gi, 'JCP')
    .replace(/\.[a-z0-9]{2,5}$/i, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|uhd|hdr10?|dv|web[ .-]?dl|webrip|bluray|brrip|hdtv|x26[45]|hevc|av1|aac|dts|proper|repack|multi|extended)\b/gi, ' ')
    .replace(/^\s*\d{1,3}[. _-]+/, ' '));
}

function cleanEventTitle(value) {
  return cleanMediaTitle(value)
    .replace(/\b(?:19\d{2}|20\d{2})\b/g, ' ')
    .replace(/\b(?:aew|wcw|wwe|wwf|ecw|tna|nwa|njpw|roh|mlw|awa|jcp|gcw|czw|pwg)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function similarity(left, right) {
  const a = cleanMediaTitle(left), b = cleanMediaTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 120;
  if (a.startsWith(`${b} `) || b.startsWith(`${a} `)) return 106;
  if (a.includes(b) || b.includes(a)) return 94;
  const aa = new Set(a.split(' ').filter(token => token.length > 1));
  const bb = new Set(b.split(' ').filter(token => token.length > 1));
  const intersection = [...aa].filter(token => bb.has(token)).length;
  const union = new Set([...aa, ...bb]).size || 1;
  return Math.round((intersection / union) * 88);
}

function eventSimilarity(left, right) {
  const direct=similarity(left,right),a=cleanEventTitle(left),b=cleanEventTitle(right);
  if(!a||!b)return direct;
  if(a===b)return Math.max(direct,120);
  return Math.max(direct,similarity(a,b));
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

function itemDate(item) {
  const exact = String(item.originallyAvailableAt || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(exact)) return exact;
  const title = String(item.title || '');
  const compact = title.match(/\b(19\d{2}|20\d{2})[ ._-](\d{1,2})[ ._-](\d{1,2})\b/);
  if (compact) return `${compact[1]}-${String(compact[2]).padStart(2,'0')}-${String(compact[3]).padStart(2,'0')}`;
  return '';
}

function mappedProgramme(data, showTitle, date = '') {
  const rules = data.plexTitleMap?.shows?.[showTitle] || data.plexTitleMap?.shows?.[String(showTitle || '').trim()] || [];
  for (const rule of rules) {
    if (rule.from && (!date || date < rule.from)) continue;
    if (rule.before && (!date || date >= rule.before)) continue;
    const programme = data.programmes.find(row => row.id === rule.programId);
    if (programme) return programme;
  }
  return null;
}

function buildProgrammeIndex(programmes) {
  const exact = new Map(), rows = [];
  for (const programme of programmes || []) {
    const names = [programme.name, ...(programme.aliases || []), programme.traktTitle].filter(Boolean);
    const entry = { programme, names };
    rows.push(entry);
    for (const name of names) {
      const key = cleanMediaTitle(name);
      if (!key) continue;
      if (!exact.has(key)) exact.set(key, []);
      exact.get(key).push(entry);
    }
  }
  return { exact, rows };
}

function programmeInDateRange(programme, date) {
  if (!date) return true;
  const start = programme.lineageStartDate || programme.firstAirDate || '';
  const end = programme.endDate || '';
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function bestProgramme(index, showTitle, title, date, libraryRelevant) {
  const exact = index.exact.get(cleanMediaTitle(showTitle || title)) || [];
  const ranged = exact.filter(entry => programmeInDateRange(entry.programme, date));
  if (ranged.length === 1) return { programme: ranged[0].programme, score: 125, reason: 'exact-title-date-range' };
  if (ranged.length > 1) {
    ranged.sort((a,b) => String(b.programme.firstAirDate || '').localeCompare(String(a.programme.firstAirDate || '')));
    return { programme: ranged[0].programme, score: 122, reason: 'exact-title-lineage' };
  }
  let best = null;
  for (const entry of index.rows) {
    if (!programmeInDateRange(entry.programme, date)) continue;
    for (const candidate of [showTitle, title].filter(Boolean)) {
      for (const name of entry.names) {
        let score = similarity(candidate, name);
        if (showTitle && score >= 90) score += 8;
        if (date && programmeInDateRange(entry.programme, date)) score += 4;
        if (!best || score > best.score) best = { programme: entry.programme, score, reason: 'alias-similarity' };
      }
    }
  }
  const minimum = showTitle ? 96 : libraryRelevant ? 104 : 112;
  return best && best.score >= minimum ? best : null;
}

function externalIdPairs(item) {
  const pairs = [];
  for (const value of item.guids || []) {
    const match = String(value || '').match(/^(imdb|tmdb|tvdb):\/\/(.+)$/i);
    if (match) pairs.push([match[1].toLowerCase(), match[2]]);
  }
  const direct = item.externalIds || item.traktIds || {};
  for (const key of ['imdb','tmdb','tvdb']) if (direct[key]) pairs.push([key, String(direct[key])]);
  return pairs;
}

function allArchiveRecords(data) {
  return [
    ...(data.majorEvents || []),
    ...(data.customRecords || []),
    ...(data.plexSupplement?.records || []),
    ...(data.runtimeRecords || [])
  ];
}

function buildRecordIndexes(data) {
  const records = allArchiveRecords(data), byExternal = new Map(), byDate = new Map(), byItemKey = new Map(), byProgrammeDate = new Map();
  for (const record of records) {
    const key = record.itemKey || `event:${record.id}`;
    byItemKey.set(key, record);
    const date = String(record.date || '').slice(0, 10);
    if (date) {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(record);
      const pd = `${record.programId || ''}|${date}`;
      if (!byProgrammeDate.has(pd)) byProgrammeDate.set(pd, []);
      byProgrammeDate.get(pd).push(record);
    }
    for (const [provider, id] of externalIdPairs(record)) byExternal.set(`${provider}:${id}`, record);
  }
  return { records, byExternal, byDate, byItemKey, byProgrammeDate };
}

function chooseEvent(item, indexes, programme = null) {
  for (const [provider,id] of externalIdPairs(item)) {
    const exact = indexes.byExternal.get(`${provider}:${id}`);
    if (exact) return { event: exact, score: 160, reason: `${provider}-id` };
  }
  const date = itemDate(item), title = item.title || item.name || '';
  const candidates = date ? indexes.byDate.get(date) || [] : [];
  let best = null;
  for (const candidate of candidates) {
    if (programme && candidate.promotionId && candidate.promotionId !== programme.promotionId) continue;
    const score = Math.max(eventSimilarity(title, candidate.title), eventSimilarity(title, candidate.event), eventSimilarity(title, candidate.eventName));
    if (!best || score > best.score) best = { event: candidate, score, reason: 'date-title' };
  }
  if (best && best.score >= 88) return best;
  const year = Number(item.year) || yearOf(date) || Number((String(title).match(/\b(19\d{2}|20\d{2})\b/) || [])[1]);
  if (!year) return null;
  for (const candidate of indexes.records) {
    if (yearOf(candidate.date) !== year) continue;
    if (programme && candidate.promotionId && candidate.promotionId !== programme.promotionId) continue;
    const score = eventSimilarity(title, candidate.title);
    if (!best || score > best.score) best = { event: candidate, score, reason: 'year-title' };
  }
  return best && best.score >= 108 ? best : null;
}

function setLink(links, viewing, key, item, threshold) {
  const previous = links.get(key);
  if (!previous || Number(item.viewCount || 0) > Number(previous.viewCount || 0) || Number(item.viewOffset || 0) > Number(previous.viewOffset || 0)) links.set(key, item);
  viewing.set(key, viewingState(item, threshold));
}

export function buildPlexMatches(data, plexItems = [], threshold = 0.9) {
  const matches = new Set(), links = new Map(), viewing = new Map();
  const programmeIndex = buildProgrammeIndex(data.programmes || []), recordIndexes = buildRecordIndexes(data);
  const diagnostics = { totalItems: plexItems.length, validItems: 0, matchedItems: 0, matchedEpisodes: 0, matchedEvents: 0, matchedProgrammes: 0, externalIdMatches: 0, exactDateMatches: 0, unmatchedShows: {}, unmatchedMovies: [] };
  const matchedProgrammeIds = new Set();

  for (const item of plexItems) {
    if (!item || (!item.title && !item.grandparentTitle && !item.ratingKey)) continue;
    diagnostics.validItems++;
    const date = itemDate(item), showTitle = item.grandparentTitle || item.showTitle || (item.type === 'show' ? item.title : ''), title = item.title || item.name || '';
    const libraryRelevant = /wrestl|ppv|sports show|combat/i.test(String(item.library || ''));
    let programme = mappedProgramme(data, showTitle, date);
    let programmeHit = programme ? { programme, score: 150, reason: 'plex-title-map' } : bestProgramme(programmeIndex, showTitle, title, date, libraryRelevant);
    programme = programmeHit?.programme || null;
    let itemMatched = false;

    if (item.type === 'episode' || showTitle) {
      if (programme) {
        const programKey = `program:${programme.id}`;
        matches.add(programKey); if (!links.has(programKey)) links.set(programKey, item);
        matchedProgrammeIds.add(programme.id); itemMatched = true;
        const numbers = episodeNumbers(item);
        if (numbers) {
          const episodeKey = `episode:${programme.id}:${numbers.season}:${numbers.episode}`;
          matches.add(episodeKey); setLink(links, viewing, episodeKey, item, threshold); diagnostics.matchedEpisodes++;
        }
        const sameDate = recordIndexes.byProgrammeDate.get(`${programme.id}|${date}`) || [];
        let exactRecord = null;
        if (numbers) exactRecord = recordIndexes.byItemKey.get(`episode:${programme.id}:${numbers.season}:${numbers.episode}`) || null;
        if (!exactRecord && sameDate.length) exactRecord = sameDate.sort((a,b)=>eventSimilarity(title,b.title)-eventSimilarity(title,a.title))[0];
        if (exactRecord) {
          const key = exactRecord.itemKey || `event:${exactRecord.id}`;
          matches.add(key); setLink(links, viewing, key, item, threshold);
        }
      } else if (showTitle) diagnostics.unmatchedShows[showTitle] = (diagnostics.unmatchedShows[showTitle] || 0) + 1;
    }

    if (item.type === 'movie' || (!showTitle && item.type !== 'episode')) {
      const eventHit = chooseEvent(item, recordIndexes, programme);
      if (eventHit) {
        const event = eventHit.event, key = event.itemKey || `event:${event.id}`;
        matches.add(key); setLink(links, viewing, key, item, threshold); itemMatched = true; diagnostics.matchedEvents++;
        if (eventHit.reason.endsWith('-id')) diagnostics.externalIdMatches++;
        if (eventHit.reason === 'date-title') diagnostics.exactDateMatches++;
        if (event.programId) {
          const programKey = `program:${event.programId}`;
          matches.add(programKey); if (!links.has(programKey)) links.set(programKey, item); matchedProgrammeIds.add(event.programId);
        }
      } else diagnostics.unmatchedMovies.push({ title, date, year: item.year || null, ratingKey: item.ratingKey || null });
    }
    if (itemMatched) diagnostics.matchedItems++;
  }
  diagnostics.matchedProgrammes = matchedProgrammeIds.size;
  diagnostics.unmatchedMovieCount = diagnostics.unmatchedMovies.length;
  diagnostics.unmatchedShowCount = Object.values(diagnostics.unmatchedShows).reduce((sum,value)=>sum+value,0);
  diagnostics.unmatchedMovies = diagnostics.unmatchedMovies.slice(0,100);
  return { matches, links, viewing, diagnostics };
}

export function plexWebUrl(item, server, lanBaseUrl = '') {
  const machineIdentifier = item?.machineIdentifier || server?.machineIdentifier;
  if (!item?.ratingKey || !machineIdentifier) return '';
  const key = encodeURIComponent(`/library/metadata/${item.ratingKey}`);
  const configured = String(lanBaseUrl || globalThis.RINGSIDE_CONFIG?.plexLanBaseUrl || '').trim().replace(/\/+$/, '');
  if (configured) return `${configured}/web/index.html#!/server/${encodeURIComponent(machineIdentifier)}/details?key=${key}`;
  return `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(machineIdentifier)}/details?key=${key}`;
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
    programmeTitle: programme?.name || extra.programmeTitle || '',
    promotionName: extra.promotionName || '',
    promotionShortName: extra.promotionShortName || '',
    tvMazeId: item.tvMazeId || programme?.tvMazeId || extra.tvMazeId || null,
    season: item.season ?? null,
    episode: item.number ?? null,
    sourceUrl: item.sourceUrl || programme?.sourceUrl || extra.sourceUrl || ''
  };
}

export async function searchArtwork(item, programme, extra = {}, accountHeaders = {}) {
  const response = await fetch('./api/artwork/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders },
    body: JSON.stringify(artworkInput(item, programme, extra))
  });
  return jsonResponse(response, 'Artwork scan failed.');
}

export async function searchArtworkBatch(entries = [], accountHeaders = {}) {
  const items = entries.slice(0, 12).map(entry => artworkInput(entry.item, entry.programme, entry.extra || {}));
  const response = await fetch('./api/artwork/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders },
    body: JSON.stringify({ items })
  });
  return jsonResponse(response, 'Artwork batch scan failed.');
}

import { normalize, yearOf } from './utils.js';

export function makeClientId() {
  return globalThis.crypto?.randomUUID?.() || `ringside-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function viewingState(item, threshold = 0.9) {
  const duration = Number(item.duration || 0), offset = Number(item.viewOffset || 0), ratio = duration > 0 ? Math.min(1, offset / duration) : 0;
  const watched = Number(item.viewCount || 0) > 0 || ratio >= threshold;
  return { watched, progress: ratio, viewOffset: offset, duration, lastViewedAt: item.lastViewedAt || null };
}

export function buildPlexMatches(data, plexItems = [], threshold = 0.9) {
  const matches = new Set(), links = new Map(), viewing = new Map();
  const programmeAliases = data.programmes.map(programme => ({ programme, names: [programme.name, ...(programme.aliases || [])].map(normalize).filter(Boolean) }));
  const eventsByYear = new Map();
  for (const event of data.majorEvents) eventsByYear.set(`${yearOf(event.date)}:${normalize(event.title)}`, event);
  for (const item of plexItems) {
    const showTitle = item.grandparentTitle || item.showTitle || (item.type === 'show' ? item.title : '');
    const title = item.title || item.name || '', normalizedShow = normalize(showTitle), normalizedTitle = normalize(title);
    let programme = null;
    if (normalizedShow) programme = programmeAliases.find(entry => entry.names.some(name => normalizedShow === name || normalizedShow.includes(name) || name.includes(normalizedShow)))?.programme;
    if (!programme && item.type === 'show') programme = programmeAliases.find(entry => entry.names.some(name => normalizedTitle === name || normalizedTitle.includes(name) || name.includes(normalizedTitle)))?.programme;
    if (programme) {
      const programKey = `program:${programme.id}`;
      matches.add(programKey); if (!links.has(programKey)) links.set(programKey, item);
      const season = Number(item.parentIndex ?? item.season ?? item.seasonNumber), episode = Number(item.index ?? item.episode ?? item.episodeNumber);
      if (item.type === 'episode' && Number.isFinite(season) && Number.isFinite(episode)) {
        const episodeKey = `episode:${programme.id}:${season}:${episode}`;
        matches.add(episodeKey); links.set(episodeKey, item); viewing.set(episodeKey, viewingState(item, threshold));
      }
    }
    const year = Number(item.year);
    if (normalizedTitle && year) {
      const event = eventsByYear.get(`${year}:${normalizedTitle}`) || data.majorEvents.find(event => yearOf(event.date) === year && (normalize(event.title) === normalizedTitle || normalizedTitle.includes(normalize(event.title))));
      if (event) { const key = `event:${event.id}`; matches.add(key); links.set(key, item); viewing.set(key, viewingState(item, threshold)); }
    }
  }
  return { matches, links, viewing };
}

export function plexWebUrl(item, server) {
  if (!item?.ratingKey || !server?.machineIdentifier) return '';
  const key = encodeURIComponent(`/library/metadata/${item.ratingKey}`);
  return `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(server.machineIdentifier)}/details?key=${key}`;
}

async function jsonResponse(response, fallback) { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || fallback); return data; }
export async function createPlexPin(clientId, accountHeaders = {}) {
  const response = await fetch('./api/plex/pin', { method: 'POST', headers: {'Content-Type':'application/json',...accountHeaders}, body: JSON.stringify({ clientId, forwardUrl: location.href.split('#')[0] }) });
  return jsonResponse(response, 'Unable to start Plex sign-in.');
}
export async function pollPlexPin(clientId, pinId, accountHeaders = {}) {
  const response = await fetch(`./api/plex/pin?id=${encodeURIComponent(pinId)}&clientId=${encodeURIComponent(clientId)}`, { headers: accountHeaders });
  return jsonResponse(response, 'Plex sign-in failed.');
}
export async function loadPlexResources(clientId, token, accountHeaders = {}) {
  const response = await fetch('./api/plex/resources', { method: 'POST', headers: {'Content-Type':'application/json',...accountHeaders}, body: JSON.stringify({ clientId, token }) });
  return jsonResponse(response, 'Unable to load Plex servers.');
}
export async function scanPlexLibrary(clientId, token, server, accountHeaders = {}) {
  const response = await fetch('./api/plex/library', { method: 'POST', headers: {'Content-Type':'application/json',...accountHeaders}, body: JSON.stringify({ clientId, token, server, machineIdentifier: server?.machineIdentifier || server }) });
  return jsonResponse(response, 'Unable to scan Plex library.');
}
export async function updatePlexViewState({ clientId, token, server, item, action, accountHeaders = {} }) {
  const response = await fetch('./api/plex/view-state', { method: 'POST', headers: {'Content-Type':'application/json',...accountHeaders}, body: JSON.stringify({ clientId, token, server, machineIdentifier: item?.machineIdentifier || server?.machineIdentifier, ratingKey: item?.ratingKey, action }) });
  return jsonResponse(response, 'Unable to update Plex viewing state.');
}

export async function searchArtwork(item, programme) {
  const response = await fetch('./api/artwork/search', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ id:item.id,title:item.title||item.name,year:yearOf(item.date||item.firstAirDate),kind:item.kind||programme?.kind||'show',programmeTitle:programme?.name||'',season:item.season??null,episode:item.number??null })
  });
  return jsonResponse(response, 'Artwork scan failed.');
}

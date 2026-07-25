import { resolvePlexCredentials, persistPlex } from '../_lib/providers.js';
import { bodyOf } from '../_lib/http.js';

const PRODUCT = 'Ringside Archive';
const PAGE_SIZE = 250;
const MAX_ITEMS = 30000;

function allowedUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      url.hostname.endsWith('.plex.direct')
      || url.hostname.endsWith('.plex.services')
      || url.hostname === 'localhost'
    );
  } catch {
    return false;
  }
}

function connectionCandidates(server) {
  const candidates = [...(server.connections || [])];
  if (server.uri) candidates.push({ uri: server.uri, local: false, relay: false, selected: true });
  const seen = new Set();
  return candidates
    .filter(connection => connection?.uri && allowedUri(connection.uri))
    .filter(connection => !seen.has(connection.uri) && seen.add(connection.uri))
    .sort((left, right) => {
      const score = connection => (connection.local ? 100 : 0) + (connection.relay ? 25 : 0) + (connection.selected ? -5 : 0);
      return score(left) - score(right);
    });
}

async function plexJson(url, headers, timeout = 18000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  const text = await response.text().catch(() => '');
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch {
    const error = new Error(`Plex returned a non-JSON response (${response.status}) for ${new URL(url).pathname}.`);
    error.status = response.status || 502;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `Plex returned ${response.status} for ${new URL(url).pathname}.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function plexHeaders(token, clientId) {
  return {
    Accept: 'application/json',
    'X-Plex-Token': token,
    'X-Plex-Product': PRODUCT,
    'X-Plex-Version': '5.6.0',
    'X-Plex-Client-Identifier': clientId
  };
}

function publicSections(payload) {
  return (payload.MediaContainer?.Directory || [])
    .filter(section => ['show', 'movie', 'video'].includes(section.type))
    .map(section => ({
      key: String(section.key),
      title: section.title,
      type: section.type,
      agent: section.agent || null,
      scanner: section.scanner || null,
      language: section.language || null,
      uuid: section.uuid || null
    }));
}

async function findWorkingConnection(server, headers) {
  const candidates = connectionCandidates(server);
  const details = [];
  for (const connection of candidates) {
    const base = connection.uri.replace(/\/$/, '');
    try {
      const sectionsPayload = await plexJson(`${base}/library/sections`, headers, 14000);
      return { base, connection, sectionsPayload, details };
    } catch (error) {
      details.push(`${connection.relay ? 'relay' : connection.local ? 'local' : 'remote'} ${base}: ${error.message}`);
    }
  }
  const error = new Error(
    candidates.length
      ? 'None of this server’s secure Plex connections could be reached from Vercel. Enable Plex Remote Access or Relay, then refresh servers.'
      : 'This server did not advertise a secure plex.direct/plex.services connection. Enable secure Remote Access or use the local export tool.'
  );
  error.status = 502;
  error.details = details;
  throw error;
}

function imageUrl(base, key, token) {
  if (!key) return '';
  return `${base}${key}${key.includes('?') ? '&' : '?'}X-Plex-Token=${encodeURIComponent(token)}`;
}

function safeItem(entry, section, server, base, token, cloud) {
  const item = {
    title: entry.title,
    grandparentTitle: entry.grandparentTitle,
    parentTitle: entry.parentTitle,
    year: entry.year,
    type: entry.type,
    ratingKey: entry.ratingKey,
    index: entry.index,
    parentIndex: entry.parentIndex,
    library: section.title,
    libraryKey: String(section.key),
    duration: entry.duration,
    originallyAvailableAt: entry.originallyAvailableAt,
    addedAt: entry.addedAt,
    lastViewedAt: entry.lastViewedAt,
    viewCount: Number(entry.viewCount || 0),
    viewOffset: Number(entry.viewOffset || 0),
    userRating: entry.userRating,
    guid: entry.guid,
    guids: (entry.Guid || []).map(value => value.id),
    thumb: entry.thumb,
    art: entry.art,
    machineIdentifier: server.machineIdentifier,
    serverName: server.name
  };
  if (!cloud) {
    item.thumbUrl = imageUrl(base, entry.thumb, token);
    item.artUrl = imageUrl(base, entry.art, token);
  }
  return item;
}

async function scanSection({ section, base, headers, server, token, cloud }) {
  const items = [];
  const type = section.type === 'show' ? 4 : section.type === 'movie' ? 1 : null;
  let start = 0;
  let total = Infinity;
  while (start < total && items.length < MAX_ITEMS) {
    const params = new URLSearchParams({
      includeGuids: '1',
      includeUserState: '1',
      'X-Plex-Container-Start': String(start),
      'X-Plex-Container-Size': String(PAGE_SIZE)
    });
    // Show libraries need Plex's episode metadata type. Movie libraries use type 1.
    // Other Videos libraries must use the section's native type, so omit the filter.
    if (type !== null) params.set('type', String(type));
    const url = `${base}/library/sections/${encodeURIComponent(section.key)}/all?${params}`;
    const data = await plexJson(url, headers, 25000);
    const media = data.MediaContainer || {};
    const rows = media.Metadata || [];
    total = Number(media.totalSize ?? media.size ?? rows.length);
    for (const entry of rows) items.push(safeItem(entry, section, server, base, token, cloud));
    if (!rows.length) break;
    start += rows.length;
  }
  return items;
}

function serverFromContext(context, body) {
  const payload = context.payload;
  if (!context.cloud) return body.server;
  const id = body.machineIdentifier || body.server?.machineIdentifier;
  return (payload.servers || []).find(server => server.machineIdentifier === id) || payload.selectedServer;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = bodyOf(req);
    const context = await resolvePlexCredentials(req, body);
    const payload = context.payload;
    const server = serverFromContext(context, body);
    if (!server) return res.status(400).json({ error: 'Choose a Plex server first.' });

    const serverToken = server.accessToken || payload.token;
    if (!serverToken) return res.status(401).json({ error: 'The selected Plex server has no usable access token. Refresh the server list.' });
    const headers = plexHeaders(serverToken, payload.clientId);
    const connected = await findWorkingConnection(server, headers);
    const base = connected.base;
    const sections = publicSections(connected.sectionsPayload);
    const selectedServer = {
      ...server,
      uri: base,
      activeConnection: {
        uri: base,
        local: Boolean(connected.connection.local),
        relay: Boolean(connected.connection.relay)
      }
    };

    if ((body.action || 'scan') === 'sections') {
      if (context.cloud) await persistPlex(context, { selectedServer, sections });
      return res.status(200).json({
        server: { name: server.name, machineIdentifier: server.machineIdentifier, uri: base, activeConnection: selectedServer.activeConnection },
        sections,
        connectionDiagnostics: connected.details,
        cloud: context.cloud
      });
    }

    const requestedKeys = new Set((Array.isArray(body.sectionKeys) ? body.sectionKeys : []).map(String));
    const selectedSections = requestedKeys.size ? sections.filter(section => requestedKeys.has(String(section.key))) : sections;
    if (!selectedSections.length) return res.status(400).json({ error: 'Select at least one Plex library to scan.' });

    const items = [];
    const queue = [...selectedSections];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length) {
        const section = queue.shift();
        const sectionItems = await scanSection({ section, base, headers, server, token: serverToken, cloud: context.cloud });
        items.push(...sectionItems);
      }
    });
    await Promise.all(workers);

    const scannedAt = new Date().toISOString();
    if (context.cloud) {
      // Persist only connection/selection metadata here. The browser matches the scan against
      // the archive and then stores only matched compact items through account/integrations.
      await persistPlex(context, {
        selectedServer,
        sections,
        selectedSectionKeys: selectedSections.map(section => String(section.key)),
        scannedAt
      });
      const { accessToken, ...safeServer } = selectedServer;
      safeServer.connections = (safeServer.connections || []).map(({ accessToken: ignored, ...connection }) => connection);
      return res.status(200).json({
        server: safeServer,
        sections,
        selectedSections,
        items,
        scannedAt,
        cloud: true
      });
    }

    return res.status(200).json({
      server: { name: server.name, machineIdentifier: server.machineIdentifier, uri: base, activeConnection: selectedServer.activeConnection },
      sections,
      selectedSections,
      items,
      scannedAt
    });
  } catch (error) {
    return res.status(error.status || 502).json({
      error: error.message || 'Plex scan failed.',
      details: Array.isArray(error.details) ? error.details : []
    });
  }
}

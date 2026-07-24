import { encryptJson, decryptJson, signValue } from './crypto.js';
import { fetchJson } from './http.js';

function config() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { url, publishableKey, secretKey };
}

export function accountToken(req) {
  return String(req.headers?.['x-ringside-account-token'] || '').replace(/^Bearer\s+/i, '').trim();
}

export async function authenticateAccount(req, { optional = false } = {}) {
  const token = accountToken(req);
  if (!token) {
    if (optional) return null;
    const error = new Error('Sign in to your Ringside account first.'); error.status = 401; throw error;
  }
  const { url, publishableKey } = config();
  if (!url || !publishableKey) {
    const error = new Error('Supabase account sync is not configured.'); error.status = 503; throw error;
  }
  try {
    return await fetchJson(`${url}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}` }
    });
  } catch (error) {
    error.status = error.status === 401 ? 401 : 502;
    throw error;
  }
}

function serviceHeaders(extra = {}) {
  const { secretKey } = config();
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not configured.');
  // New sb_secret_* keys are opaque API keys and must not be parsed as JWTs.
  // Legacy service_role keys are JWTs and still require the Authorization header.
  const isLegacyJwt = secretKey.split('.').length === 3;
  return {
    apikey: secretKey,
    ...(isLegacyJwt ? { Authorization: `Bearer ${secretKey}` } : {}),
    'Content-Type': 'application/json',
    ...extra
  };
}

async function serviceRequest(path, options = {}) {
  const { url } = config();
  if (!url) throw new Error('SUPABASE_URL is not configured.');
  return fetchJson(`${url}${path}`, { ...options, headers: serviceHeaders(options.headers || {}) });
}

function mergePayload(current, patch) {
  const merged = { ...(current || {}), ...(patch || {}) };
  for (const key of ['account', 'selectedServer', 'settings']) {
    if (current?.[key] && patch?.[key]) merged[key] = { ...current[key], ...patch[key] };
  }
  return merged;
}

export async function readIntegration(userId, provider) {
  const rows = await serviceRequest(`/rest/v1/integration_vault?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}&select=provider,encrypted_payload,metadata,updated_at&limit=1`, {
    headers: { Accept: 'application/json' }
  });
  if (!rows?.[0]) return null;
  return {
    provider, userId,
    payload: decryptJson(rows[0].encrypted_payload),
    metadata: rows[0].metadata || {},
    updatedAt: rows[0].updated_at
  };
}

export async function writeIntegration(userId, provider, patch, metadata = {}) {
  const current = await readIntegration(userId, provider).catch(() => null);
  const payload = mergePayload(current?.payload, patch);
  const updatedAt = new Date().toISOString();
  const rows = await serviceRequest('/rest/v1/integration_vault?on_conflict=user_id,provider', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      user_id: userId,
      provider,
      encrypted_payload: encryptJson(payload),
      metadata: { ...(current?.metadata || {}), ...metadata },
      updated_at: updatedAt
    })
  });
  return { provider, userId, payload, metadata: rows?.[0]?.metadata || metadata, updatedAt: rows?.[0]?.updated_at || updatedAt };
}

export async function replaceIntegration(userId, provider, payload, metadata = {}) {
  const updatedAt = new Date().toISOString();
  const rows = await serviceRequest('/rest/v1/integration_vault?on_conflict=user_id,provider', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: userId, provider, encrypted_payload: encryptJson(payload), metadata, updated_at: updatedAt })
  });
  return { provider, userId, payload, metadata: rows?.[0]?.metadata || metadata, updatedAt: rows?.[0]?.updated_at || updatedAt };
}

export async function deleteIntegration(userId, provider) {
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/integration_vault?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`, {
    method: 'DELETE', headers: serviceHeaders({ Prefer: 'return=minimal' })
  });
  if (!response.ok) throw new Error(`Unable to remove ${provider} connection (${response.status}).`);
}

function scrubServer(server) {
  if (!server) return null;
  const { accessToken, ...safe } = server;
  return { ...safe, connections: (safe.connections || []).map(connection => ({ ...connection })) };
}
function signedPlexImage(userId, item, imagePath) {
  if (!userId || !item?.machineIdentifier || !imagePath || !String(imagePath).startsWith('/library/metadata/')) return '';
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const value = `${userId}|${item.machineIdentifier}|${imagePath}`;
  const params = new URLSearchParams({ u: userId, m: item.machineIdentifier, p: imagePath, e: String(expiresAt), s: signValue(value, expiresAt) });
  return `./api/plex/image?${params.toString()}`;
}
function scrubItem(item, userId) {
  if (!item) return item;
  const { thumbUrl, artUrl, token, accessToken, ...safe } = item;
  return {
    ...safe,
    thumbUrl: signedPlexImage(userId, item, item.thumb),
    artUrl: signedPlexImage(userId, item, item.art)
  };
}

export function publicIntegration(entry) {
  if (!entry) return null;
  const { provider, payload = {}, updatedAt } = entry;
  if (provider === 'trakt') {
    return {
      provider, connected: Boolean(payload.accessToken || payload.refreshToken), cloud: true,
      account: payload.account || null, expiresAt: payload.expiresAt || null, updatedAt
    };
  }
  if (provider === 'plex') {
    return {
      provider, connected: Boolean(payload.token), cloud: true, clientId: payload.clientId || null,
      account: payload.account || null,
      servers: (payload.servers || []).map(scrubServer).filter(Boolean),
      selectedServer: scrubServer(payload.selectedServer),
      items: (payload.items || []).map(item => scrubItem(item, entry.userId)),
      matches: Array.isArray(payload.matches) ? payload.matches : [],
      scannedAt: payload.scannedAt || null,
      updatedAt
    };
  }
  return { provider, connected: true, cloud: true, updatedAt };
}

export function supabaseServerConfigured() {
  const { url, publishableKey, secretKey } = config();
  return Boolean(url && publishableKey && secretKey && process.env.INTEGRATION_ENCRYPTION_KEY);
}

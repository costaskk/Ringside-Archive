const SESSION_KEY = 'ringside-supabase-session-v1';
let cachedConfig = null;
let cachedSession = null;

function readJson(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; } }
function writeJson(key, value) { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); }
function normalizeUrl(value) { return String(value || '').replace(/\/+$/, ''); }
function expiresAtMs(session) {
  if (!session) return 0;
  if (session.expires_at) return Number(session.expires_at) * 1000;
  if (session.expiresAt) return Number(session.expiresAt);
  if (session.created_at && session.expires_in) return (Number(session.created_at) + Number(session.expires_in)) * 1000;
  return 0;
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.msg || payload.message || payload.error_description || payload.error || `Request failed (${response.status}).`);
  return payload;
}

export async function loadCloudConfig(force = false) {
  if (cachedConfig && !force) return cachedConfig;
  let remote = {};
  try { const response = await fetch('./api/config', { cache: 'no-store' }); if (response.ok) remote = await response.json(); } catch {}
  const local = globalThis.RINGSIDE_CONFIG || {};
  cachedConfig = {
    supabaseUrl: normalizeUrl(remote.supabaseUrl || local.supabaseUrl),
    supabasePublishableKey: remote.supabasePublishableKey || local.supabasePublishableKey || '',
    traktConfigured: Boolean(remote.traktConfigured), tmdbConfigured: Boolean(remote.tmdbConfigured),
    r2ArtworkConfigured: Boolean(remote.r2ArtworkConfigured),
    r2ArtworkPublicBaseUrl: normalizeUrl(remote.r2ArtworkPublicBaseUrl || local.r2ArtworkPublicBaseUrl),
    encryptedIntegrationStorage: Boolean(remote.encryptedIntegrationStorage),
    diagnostics: remote.diagnostics || {}
  };
  cachedConfig.supabaseConfigured = Boolean(cachedConfig.supabaseUrl && cachedConfig.supabasePublishableKey);
  return cachedConfig;
}

export function storedCloudSession() { if (cachedSession) return cachedSession; cachedSession = readJson(SESSION_KEY, null); return cachedSession; }
function saveSession(session) { cachedSession = session || null; writeJson(SESSION_KEY, cachedSession); return cachedSession; }
function authHeaders(config, token = '') { return { apikey: config.supabasePublishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }; }


export function consumeCloudAuthRedirect() {
  if (typeof location === 'undefined' || !location.hash) return null;
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Number(params.get('expires_in') || 3600),
    expires_at: Number(params.get('expires_at') || 0) || Math.floor(Date.now() / 1000) + Number(params.get('expires_in') || 3600),
    token_type: params.get('token_type') || 'bearer'
  };
  saveSession(session);
  const result = { type: params.get('type') || '', session };
  try { history.replaceState(null, '', `${location.pathname}${location.search}#exact`); } catch {}
  return result;
}

export async function updateCloudPassword(password) {
  const config = await loadCloudConfig(), session = await refreshCloudSession();
  if (!config.supabaseConfigured || !session?.access_token) throw new Error('The password-recovery session is missing or expired.');
  if (String(password || '').length < 8) throw new Error('Use a password of at least 8 characters.');
  return fetchJson(`${config.supabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: authHeaders(config, session.access_token),
    body: JSON.stringify({ password })
  });
}

export async function signUpCloud(email, password) {
  const config = await loadCloudConfig(); if (!config.supabaseConfigured) throw new Error('Supabase is not configured.');
  const data = await fetchJson(`${config.supabaseUrl}/auth/v1/signup`, { method: 'POST', headers: authHeaders(config), body: JSON.stringify({ email: String(email).trim(), password }) });
  if (data.session) saveSession(data.session); return data;
}
export async function signInCloud(email, password) {
  const config = await loadCloudConfig(); if (!config.supabaseConfigured) throw new Error('Supabase is not configured.');
  const data = await fetchJson(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authHeaders(config), body: JSON.stringify({ email: String(email).trim(), password }) });
  saveSession(data); return data;
}
export async function sendPasswordReset(email) {
  const config = await loadCloudConfig(); if (!config.supabaseConfigured) throw new Error('Supabase is not configured.');
  return fetchJson(`${config.supabaseUrl}/auth/v1/recover`, { method: 'POST', headers: authHeaders(config), body: JSON.stringify({ email: String(email).trim(), redirect_to: location.href.split('#')[0] }) });
}
export async function refreshCloudSession(force = false) {
  const config = await loadCloudConfig(); let session = storedCloudSession();
  if (!session?.refresh_token || !config.supabaseConfigured) return session;
  if (!force && expiresAtMs(session) > Date.now() + 120000) return session;
  try {
    const data = await fetchJson(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: authHeaders(config), body: JSON.stringify({ refresh_token: session.refresh_token }) });
    return saveSession(data);
  } catch (error) { saveSession(null); throw error; }
}
export async function getCloudUser() {
  const config = await loadCloudConfig(); const session = await refreshCloudSession();
  if (!config.supabaseConfigured || !session?.access_token) return null;
  try { return await fetchJson(`${config.supabaseUrl}/auth/v1/user`, { headers: authHeaders(config, session.access_token) }); } catch { return null; }
}
export async function signOutCloud() {
  const config = await loadCloudConfig(), session = storedCloudSession();
  if (config.supabaseConfigured && session?.access_token) { try { await fetch(`${config.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: authHeaders(config, session.access_token) }); } catch {} }
  saveSession(null);
}
export async function cloudAccessToken() { return (await refreshCloudSession())?.access_token || ''; }
export async function cloudApiHeaders(extra = {}) { const token = await cloudAccessToken(); return { ...(token ? { 'X-Ringside-Account-Token': token } : {}), ...extra }; }

async function authenticatedContext() {
  const config = await loadCloudConfig(), session = await refreshCloudSession();
  if (!config.supabaseConfigured || !session?.access_token) throw new Error('Sign in to a Ringside account first.');
  const user = await getCloudUser(); if (!user?.id) throw new Error('Your Supabase session is no longer valid.');
  return { config, session, user };
}
export async function pullCloudState() {
  const { config, session, user } = await authenticatedContext();
  const url = `${config.supabaseUrl}/rest/v1/archive_state?user_id=eq.${encodeURIComponent(user.id)}&select=state,revision,updated_at`;
  const rows = await fetchJson(url, { headers: { ...authHeaders(config, session.access_token), Accept: 'application/json' } });
  return rows[0] || null;
}
export async function pushCloudState(state, revision = 0) {
  const { config, session, user } = await authenticatedContext();
  const url = `${config.supabaseUrl}/rest/v1/archive_state?on_conflict=user_id`;
  const rows = await fetchJson(url, {
    method: 'POST', headers: { ...authHeaders(config, session.access_token), Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: user.id, state, revision: Number(revision || 0) + 1, updated_at: new Date().toISOString() })
  });
  return rows[0] || null;
}
export async function loadCloudIntegrations() {
  const headers = await cloudApiHeaders();
  return fetchJson('./api/account/integrations', { headers });
}
export async function saveCloudIntegration(provider, payload) {
  const headers = await cloudApiHeaders({ 'Content-Type': 'application/json' });
  return fetchJson('./api/account/integrations', { method: 'PUT', headers, body: JSON.stringify({ provider, payload }) });
}
export async function deleteCloudIntegration(provider) {
  const headers = await cloudApiHeaders();
  return fetchJson(`./api/account/integrations?provider=${encodeURIComponent(provider)}`, { method: 'DELETE', headers });
}
export function clearCloudSession() { saveSession(null); }

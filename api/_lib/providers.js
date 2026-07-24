import { authenticateAccount, readIntegration, writeIntegration } from './account.js';

export async function resolvePlexCredentials(req, body = {}) {
  const user = await authenticateAccount(req, { optional: true });
  if (user) {
    const entry = await readIntegration(user.id, 'plex');
    if (!entry?.payload?.token) { const error = new Error('Plex is not connected to this Ringside account.'); error.status = 401; throw error; }
    return { user, cloud: true, entry, payload: entry.payload };
  }
  if (!body.clientId || !body.token) { const error = new Error('Missing Plex credentials.'); error.status = 400; throw error; }
  return { user: null, cloud: false, entry: null, payload: body };
}

export async function persistPlex(context, patch, metadata = {}) {
  if (!context.cloud || !context.user) return null;
  return writeIntegration(context.user.id, 'plex', patch, metadata);
}

function expiresAtMs(session) {
  if (!session) return 0;
  if (session.expiresAt) return Number(session.expiresAt);
  if (session.createdAt && session.expiresIn) return (Number(session.createdAt) + Number(session.expiresIn)) * 1000;
  return 0;
}

async function refreshTraktSession(session) {
  const clean=value=>String(value||'').trim().replace(/^[\"']|[\"']$/g,'');
  const clientId = clean(process.env.TRAKT_CLIENT_ID), clientSecret = clean(process.env.TRAKT_CLIENT_SECRET);
  if (!session?.refreshToken || !clientId || !clientSecret) throw new Error('The Trakt connection expired and cannot be refreshed.');
  const response = await fetch('https://api.trakt.tv/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ refresh_token: session.refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || `Trakt returned ${response.status}.`);
  return {
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || session.refreshToken,
    createdAt: data.created_at,
    expiresIn: data.expires_in,
    expiresAt: (Number(data.created_at || Math.floor(Date.now() / 1000)) + Number(data.expires_in || 0)) * 1000
  };
}

export async function resolveTraktSession(req) {
  const user = await authenticateAccount(req, { optional: true });
  if (user) {
    let entry = await readIntegration(user.id, 'trakt');
    if (!entry?.payload?.accessToken) { const error = new Error('Trakt is not connected to this Ringside account.'); error.status = 401; throw error; }
    if (expiresAtMs(entry.payload) && expiresAtMs(entry.payload) <= Date.now() + 60000) {
      const refreshed = await refreshTraktSession(entry.payload);
      entry = await writeIntegration(user.id, 'trakt', refreshed, { account: refreshed.account || entry.metadata?.account || null });
    }
    return { user, cloud: true, entry, session: entry.payload };
  }
  const accessToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) { const error = new Error('Trakt connection is missing.'); error.status = 401; throw error; }
  return { user: null, cloud: false, entry: null, session: { accessToken } };
}

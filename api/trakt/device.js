import { authenticateAccount, writeIntegration, publicIntegration } from '../_lib/account.js';
import { bodyOf, sendError } from '../_lib/http.js';
import { traktClientId, traktClientSecret, traktHeaders, traktPayload, traktErrorMessage } from '../_lib/trakt.js';

async function traktAccount(accessToken, clientId) {
  try {
    const response = await fetch('https://api.trakt.tv/users/settings', {
      headers: traktHeaders({ accessToken, clientId }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.user
      ? { username: data.user.username, name: data.user.name, ids: data.user.ids, vip: Boolean(data.user.vip) }
      : null;
  } catch {
    return null;
  }
}

async function createDeviceCode(res, clientId) {
  const response = await fetch('https://api.trakt.tv/oauth/device/code', {
    method: 'POST',
    headers: traktHeaders({ clientId }),
    body: JSON.stringify({ client_id: clientId }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await traktPayload(response);
  if (!response.ok) {
    const hint = response.status === 403
      ? 'Trakt rejected or challenged the request. Confirm the Client ID, then retry after redeployment.'
      : 'Trakt did not issue a device code.';
    return res.status(response.status).json({
      error: traktErrorMessage(response, data, hint),
      details: hint,
      cloudflare: Boolean(data.cloudflare),
      traktStatus: response.status
    });
  }
  return res.status(200).json(data);
}

async function exchangeDeviceToken(req, res, body, clientId, clientSecret) {
  if (!clientSecret) return res.status(503).json({ error: 'TRAKT_CLIENT_SECRET is not configured in Vercel.' });
  if (!body.device_code) return res.status(400).json({ error: 'device_code is required.' });

  const response = await fetch('https://api.trakt.tv/oauth/device/token', {
    method: 'POST',
    headers: traktHeaders({ clientId }),
    body: JSON.stringify({
      code: body.device_code,
      client_id: clientId,
      client_secret: clientSecret
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (response.status === 400) return res.status(202).json({ pending: true });
  const data = await traktPayload(response);
  if (!response.ok) {
    const hint = response.status === 403
      ? 'Trakt rejected or challenged the API application credentials.'
      : 'Trakt device authorization failed.';
    return res.status(response.status).json({
      error: traktErrorMessage(response, data, hint),
      details: hint,
      cloudflare: Boolean(data.cloudflare),
      traktStatus: response.status
    });
  }

  const session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    createdAt: data.created_at,
    expiresIn: data.expires_in,
    expiresAt: (Number(data.created_at || Math.floor(Date.now() / 1000)) + Number(data.expires_in || 0)) * 1000
  };
  session.account = await traktAccount(session.accessToken, clientId);

  let user = null;
  try { user = await authenticateAccount(req, { optional: true }); } catch {}
  if (user) {
    try {
      const entry = await writeIntegration(user.id, 'trakt', session, { account: session.account || null });
      return res.status(200).json({ connected: true, cloud: true, integration: publicIntegration(entry) });
    } catch (storageError) {
      return res.status(200).json({ ...session, cloud: false, warning: `Trakt connected locally, but cross-device storage failed: ${storageError.message}` });
    }
  }
  return res.status(200).json({ ...session, cloud: false });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const clientId = traktClientId();
  const clientSecret = traktClientSecret();
  if (!clientId) return res.status(503).json({ error: 'TRAKT_CLIENT_ID is not configured in Vercel.' });

  try {
    const body = bodyOf(req);
    const action = body.action || 'code';
    if (action === 'code') return await createDeviceCode(res, clientId);
    if (action === 'token') return await exchangeDeviceToken(req, res, body, clientId, clientSecret);
    return res.status(400).json({ error: 'Unsupported Trakt device action.' });
  } catch (error) {
    return sendError(res, error.status || 502, error, 'Unable to complete Trakt device authorization.');
  }
}

import { authenticateAccount, readIntegration, writeIntegration, deleteIntegration, publicIntegration, supabaseServerConfigured } from '../_lib/account.js';
import { bodyOf, sendError } from '../_lib/http.js';

const PROVIDERS = new Set(['trakt', 'plex']);

function validateProvider(value) {
  const provider = String(value || '').toLowerCase();
  if (!PROVIDERS.has(provider)) {
    const error = new Error('Provider must be trakt or plex.'); error.status = 400; throw error;
  }
  return provider;
}

function acceptedPayload(provider, payload = {}) {
  const out = {};
  if (provider === 'trakt') {
    for (const key of ['accessToken','refreshToken','createdAt','expiresIn','expiresAt','account']) {
      if (payload[key] !== undefined && payload[key] !== null) out[key] = payload[key];
    }
    return out;
  }
  for (const key of ['token','clientId','account','selectedServer','scannedAt']) {
    if (payload[key] !== undefined && payload[key] !== null) out[key] = payload[key];
  }
  for (const key of ['servers','items','matches']) if (Array.isArray(payload[key])) out[key] = payload[key];
  return out;
}

export default async function handler(req, res) {
  try {
    if (!supabaseServerConfigured()) return res.status(503).json({ error: 'Server-side Supabase integration storage is not fully configured.' });
    const user = await authenticateAccount(req);
    if (req.method === 'GET') {
      const requested = req.query?.provider ? [validateProvider(req.query.provider)] : [...PROVIDERS];
      const rows = await Promise.all(requested.map(provider => readIntegration(user.id, provider)));
      return res.status(200).json({ integrations: rows.filter(Boolean).map(publicIntegration) });
    }
    if (req.method === 'PUT') {
      const body = bodyOf(req), provider = validateProvider(body.provider);
      const entry = await writeIntegration(user.id, provider, acceptedPayload(provider, body.payload || {}), { migratedFromDevice: true });
      return res.status(200).json({ integration: publicIntegration(entry) });
    }
    if (req.method === 'DELETE') {
      const provider = validateProvider(req.query?.provider || bodyOf(req).provider);
      await deleteIntegration(user.id, provider);
      return res.status(200).json({ deleted: provider });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error.status || 500, error);
  }
}

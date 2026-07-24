export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const encryptedIntegrationStorage = Boolean(supabaseUrl && supabasePublishableKey && supabaseSecretKey && process.env.INTEGRATION_ENCRYPTION_KEY);
  return res.status(200).json({
    supabaseUrl,
    supabasePublishableKey,
    supabaseConfigured: Boolean(supabaseUrl && supabasePublishableKey),
    encryptedIntegrationStorage,
    traktConfigured: Boolean(process.env.TRAKT_CLIENT_ID && process.env.TRAKT_CLIENT_SECRET),
    tmdbConfigured: Boolean(process.env.TMDB_READ_ACCESS_TOKEN)
  });
}

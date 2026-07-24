const clean = value => String(value || '').trim().replace(/^['"]|['"]$/g, '');
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const supabaseUrl = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabasePublishableKey = clean(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const supabaseSecretKey = clean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const encryptionKey = clean(process.env.INTEGRATION_ENCRYPTION_KEY);
  const traktClientId = clean(process.env.TRAKT_CLIENT_ID);
  const traktClientSecret = clean(process.env.TRAKT_CLIENT_SECRET);
  const tmdbToken = clean(process.env.TMDB_READ_ACCESS_TOKEN);
  const encryptedIntegrationStorage = Boolean(supabaseUrl && supabasePublishableKey && supabaseSecretKey && encryptionKey);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({
    supabaseUrl,
    supabasePublishableKey,
    supabaseConfigured: Boolean(supabaseUrl && supabasePublishableKey),
    encryptedIntegrationStorage,
    traktConfigured: Boolean(traktClientId && traktClientSecret),
    tmdbConfigured: Boolean(tmdbToken),
    diagnostics: {
      supabaseUrl: Boolean(supabaseUrl),
      supabasePublishableKey: Boolean(supabasePublishableKey),
      supabaseSecretKey: Boolean(supabaseSecretKey),
      integrationEncryptionKey: Boolean(encryptionKey),
      traktClientId: Boolean(traktClientId),
      traktClientSecret: Boolean(traktClientSecret),
      tmdbReadAccessToken: Boolean(tmdbToken)
    }
  });
}

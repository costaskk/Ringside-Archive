/* Safe public fallback for local/static use. Vercel normally serves these values
   through /api/config from environment variables. Never put server secrets here. */
window.RINGSIDE_CONFIG = window.RINGSIDE_CONFIG || {
  supabaseUrl: '',
  supabasePublishableKey: '',
  plexLanBaseUrl: 'http://100.112.143.89:32400'
};

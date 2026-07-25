const clean = value => String(value || '').trim().replace(/^["']|["']$/g, '');

export function traktClientId() {
  return clean(process.env.TRAKT_CLIENT_ID);
}

export function traktClientSecret() {
  return clean(process.env.TRAKT_CLIENT_SECRET);
}

export function traktHeaders({ accessToken = '', json = true, clientId = traktClientId() } = {}) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'RingsideArchive/5.6.0 (+https://ringside-archive.vercel.app)',
    'Api-User-Agent': 'RingsideArchive/5.6.0 (+https://ringside-archive.vercel.app)',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'trakt-api-version': '2'
  };
  if (clientId) headers['trakt-api-key'] = clientId;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export async function traktPayload(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); }
  catch {
    const cleaned = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 700);
    return {
      error: cleaned || `Trakt returned a non-JSON response (${response.status}).`,
      cloudflare: /cloudflare|attention required|you have been blocked/i.test(text)
    };
  }
}

export function traktErrorMessage(response, payload, fallback) {
  if (payload?.cloudflare) {
    return 'Trakt Cloudflare blocked the request. Ringside now sends Trakt’s required application and User-Agent headers; if this persists, retry after a few minutes or verify the Trakt API application client ID.';
  }
  return payload?.error_description || payload?.error || payload?.message || fallback || `Trakt returned ${response.status}.`;
}

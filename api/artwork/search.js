const image = path => path ? `https://image.tmdb.org/t/p/original${path}` : '';
const clean = value => String(value || '')
  .replace(/\b(?:WWE|WWF|WCW|ECW|AEW|TNA|NWA|NJPW|ROH)\b/gi, '')
  .replace(/\b(?:PPV|PLE)\b/gi, '')
  .replace(/\s+/g, ' ')
  .trim();
const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const withTimeout = (ms = 12000) => AbortSignal.timeout(ms);

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

async function tmdb(path, token) {
  const response = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: withTimeout()
  });
  if (!response.ok) throw new Error(`TMDB returned ${response.status}.`);
  return response.json();
}

function best(results, title, year, dateField) {
  const wanted = norm(title);
  return (results || []).map(result => {
    const name = result.title || result.name || '';
    const normalized = norm(name);
    const candidateYear = Number(String(result[dateField] || '').slice(0, 4));
    let score = 0;
    if (normalized === wanted) score += 100;
    else if (normalized.includes(wanted) || wanted.includes(normalized)) score += 50;
    if (year && candidateYear === year) score += 30;
    score += Number(result.popularity || 0) / 100;
    return { result, score };
  }).sort((a, b) => b.score - a.score)[0]?.result || null;
}

function wikipediaQueries({ title, year, programmeTitle, kind }) {
  const suffix = /episode/i.test(kind || '') ? 'television episode' : 'professional wrestling';
  return [
    [title, year, suffix].filter(Boolean).join(' '),
    [title, programmeTitle, suffix].filter(Boolean).join(' '),
    [clean(title), year, suffix].filter(Boolean).join(' ')
  ].filter((value, index, all) => value && all.indexOf(value) === index);
}

function scoreWikipediaPage(page, title, year, programmeTitle) {
  const wanted = norm(title);
  const pageTitle = norm(page.title);
  let score = 0;
  if (pageTitle === wanted) score += 120;
  else if (pageTitle.includes(wanted) || wanted.includes(pageTitle)) score += 70;
  if (year && String(page.title || '').includes(String(year))) score += 20;
  if (programmeTitle && pageTitle.includes(norm(programmeTitle))) score += 15;
  if (page.original?.source) score += 12;
  if (page.thumbnail?.source) score += 5;
  return score;
}

async function wikipediaArtwork(input) {
  for (const query of wikipediaQueries(input)) {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '0',
      gsrlimit: '10',
      prop: 'pageimages|info',
      piprop: 'original|thumbnail',
      pithumbsize: '1400',
      inprop: 'url',
      redirects: '1',
      format: 'json',
      formatversion: '2',
      origin: '*'
    });
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { Accept: 'application/json', 'Api-User-Agent': 'RingsideArchive/4.1 (artwork discovery)' },
      signal: withTimeout()
    });
    if (!response.ok) continue;
    const payload = await response.json();
    const pages = (payload.query?.pages || [])
      .filter(page => page.original?.source || page.thumbnail?.source)
      .map(page => ({ page, score: scoreWikipediaPage(page, input.title, input.year, input.programmeTitle) }))
      .filter(row => row.score >= 65)
      .sort((a, b) => b.score - a.score);
    const hit = pages[0]?.page;
    if (!hit) continue;
    const artwork = hit.original?.source || hit.thumbnail?.source || '';
    return {
      source: 'Wikipedia/Wikimedia',
      sourceUrl: hit.fullurl || `https://en.wikipedia.org/?curid=${hit.pageid}`,
      pageId: hit.pageid,
      mediaType: input.kind === 'episode' ? 'episode-reference' : 'reference',
      poster: artwork,
      backdrop: artwork,
      still: input.kind === 'episode' ? artwork : '',
      attribution: 'Lead image supplied by Wikipedia/Wikimedia; verify the image-page licence before redistribution.'
    };
  }
  return null;
}

async function tmdbArtwork(input, token) {
  const { title, year, kind, programmeTitle, season, episode } = input;
  if (kind === 'episode' && programmeTitle) {
    const search = await tmdb(`/search/tv?query=${encodeURIComponent(programmeTitle)}${year ? `&first_air_date_year=${year}` : ''}`, token);
    const show = best(search.results, programmeTitle, year, 'first_air_date');
    if (!show) return null;
    let still = '';
    if (Number.isFinite(Number(season)) && Number.isFinite(Number(episode))) {
      const images = await tmdb(`/tv/${show.id}/season/${Number(season)}/episode/${Number(episode)}/images?include_image_language=en,null`, token).catch(() => ({ stills: [] }));
      still = image(images.stills?.[0]?.file_path);
    }
    return {
      source: 'TMDB', sourceUrl: `https://www.themoviedb.org/tv/${show.id}`,
      tmdbId: show.id, mediaType: 'tv', poster: image(show.poster_path),
      backdrop: image(show.backdrop_path), still
    };
  }

  const programmeLike = ['weekly', 'territory-tv', 'studio', 'streaming', 'archive', 'show'].includes(kind) || programmeTitle === title;
  if (programmeLike) {
    const search = await tmdb(`/search/tv?query=${encodeURIComponent(title)}${year ? `&first_air_date_year=${year}` : ''}`, token);
    const show = best(search.results, title, year, 'first_air_date');
    if (!show) return null;
    const details = await tmdb(`/tv/${show.id}`, token);
    const seasons = {};
    for (const row of details.seasons || []) if (row.poster_path) seasons[row.season_number] = { poster: image(row.poster_path) };
    return {
      source: 'TMDB', sourceUrl: `https://www.themoviedb.org/tv/${show.id}`,
      tmdbId: show.id, mediaType: 'tv', poster: image(show.poster_path),
      backdrop: image(show.backdrop_path), seasons
    };
  }

  const queries = [title, clean(title), programmeTitle && `${title} ${programmeTitle}`].filter(Boolean);
  let movie = null;
  for (const query of queries) {
    const search = await tmdb(`/search/movie?query=${encodeURIComponent(query)}${year ? `&year=${year}` : ''}`, token);
    movie = best(search.results, title, year, 'release_date');
    if (movie) break;
  }
  if (movie) {
    return {
      source: 'TMDB', sourceUrl: `https://www.themoviedb.org/movie/${movie.id}`,
      tmdbId: movie.id, mediaType: 'movie', poster: image(movie.poster_path),
      backdrop: image(movie.backdrop_path)
    };
  }
  const search = await tmdb(`/search/tv?query=${encodeURIComponent(title)}`, token);
  const show = best(search.results, title, year, 'first_air_date');
  return show ? {
    source: 'TMDB', sourceUrl: `https://www.themoviedb.org/tv/${show.id}`,
    tmdbId: show.id, mediaType: 'tv', poster: image(show.poster_path),
    backdrop: image(show.backdrop_path)
  } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const input = bodyOf(req);
  if (!input.title) return res.status(400).json({ error: 'Missing artwork title.' });
  input.year = Number(input.year) || null;
  try {
    const token = process.env.TMDB_READ_ACCESS_TOKEN;
    if (token) {
      const result = await tmdbArtwork(input, token).catch(() => null);
      if (result && (result.poster || result.backdrop || result.still)) {
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
        return res.status(200).json(result);
      }
    }
    const fallback = await wikipediaArtwork(input);
    if (fallback) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json(fallback);
    }
    return res.status(404).json({
      error: token
        ? 'No trustworthy TMDB or Wikipedia/Wikimedia artwork match was found.'
        : 'No Wikipedia/Wikimedia artwork match was found. Add TMDB_READ_ACCESS_TOKEN for richer show, season and episode artwork.'
    });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Artwork lookup failed.' });
  }
}

import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const token = process.env.TMDB_READ_ACCESS_TOKEN || '';
const args = new Set(process.argv.slice(2));
const includeEpisodes = args.has('--episodes');
const wikipediaOnly = args.has('--wikipedia-only');
const refresh = args.has('--refresh');
const limitArg = process.argv.find(value => value.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const [programmes, events, current] = await Promise.all([
  fs.readFile(new URL('data/programmes.json', root), 'utf8').then(JSON.parse),
  fs.readFile(new URL('data/major-events.json', root), 'utf8').then(JSON.parse),
  fs.readFile(new URL('data/artwork-catalog.json', root), 'utf8').then(JSON.parse)
]);

const image = path => path ? `https://image.tmdb.org/t/p/original${path}` : '';
const clean = value => String(value || '').replace(/\b(?:WWE|WWF|WCW|ECW|AEW|TNA|NWA|NJPW|ROH)\b/gi, '').replace(/\b(?:PPV|PLE)\b/gi, '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function tmdb(path) {
  if (!token || wikipediaOnly) return null;
  const response = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
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

function wikiScore(page, title, year, programmeTitle = '') {
  const wanted = norm(title);
  const candidate = norm(page.title);
  let score = 0;
  if (candidate === wanted) score += 120;
  else if (candidate.includes(wanted) || wanted.includes(candidate)) score += 70;
  if (year && String(page.title || '').includes(String(year))) score += 20;
  if (programmeTitle && candidate.includes(norm(programmeTitle))) score += 15;
  if (page.original?.source) score += 12;
  return score;
}

async function wikipedia(title, year, programmeTitle = '', kind = 'professional wrestling') {
  const queries = [
    [title, year, kind].filter(Boolean).join(' '),
    [title, programmeTitle, kind].filter(Boolean).join(' '),
    [clean(title), year, kind].filter(Boolean).join(' ')
  ].filter((value, index, all) => value && all.indexOf(value) === index);
  for (const query of queries) {
    const params = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '0', gsrlimit: '10',
      prop: 'pageimages|info', piprop: 'original|thumbnail', pithumbsize: '1400', inprop: 'url',
      redirects: '1', format: 'json', formatversion: '2', origin: '*'
    });
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { Accept: 'application/json', 'Api-User-Agent': 'RingsideArchive/4.1 (catalogue artwork discovery)' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) continue;
    const payload = await response.json();
    const hit = (payload.query?.pages || [])
      .filter(page => page.original?.source || page.thumbnail?.source)
      .map(page => ({ page, score: wikiScore(page, title, year, programmeTitle) }))
      .filter(row => row.score >= 65)
      .sort((a, b) => b.score - a.score)[0]?.page;
    if (!hit) continue;
    const artwork = hit.original?.source || hit.thumbnail?.source || '';
    return {
      source: 'Wikipedia/Wikimedia', sourceUrl: hit.fullurl || `https://en.wikipedia.org/?curid=${hit.pageid}`,
      pageId: hit.pageid, poster: artwork, backdrop: artwork,
      attribution: 'Lead image supplied by Wikipedia/Wikimedia; verify the image-page licence before redistribution.'
    };
  }
  return null;
}

async function programmeArtwork(programme) {
  const year = Number(String(programme.firstAirDate).slice(0, 4));
  if (token && !wikipediaOnly) {
    const search = await tmdb(`/search/tv?query=${encodeURIComponent(programme.name)}${year ? `&first_air_date_year=${year}` : ''}`);
    const show = best(search?.results, programme.name, year, 'first_air_date');
    if (show) {
      const details = await tmdb(`/tv/${show.id}`);
      const seasons = {};
      for (const season of details?.seasons || []) if (season.poster_path) seasons[season.season_number] = { poster: image(season.poster_path) };
      return {
        source: 'TMDB', sourceUrl: `https://www.themoviedb.org/tv/${show.id}`, tmdbId: show.id,
        poster: image(show.poster_path), backdrop: image(show.backdrop_path), seasons
      };
    }
  }
  return wikipedia(programme.name, year, '', 'professional wrestling television');
}

async function eventArtwork(event) {
  const year = Number(event.date.slice(0, 4));
  if (token && !wikipediaOnly) {
    for (const query of [event.title, clean(event.title)]) {
      const search = await tmdb(`/search/movie?query=${encodeURIComponent(query)}&year=${year}`);
      const movie = best(search?.results, event.title, year, 'release_date');
      if (movie) return {
        source: 'TMDB', sourceUrl: `https://www.themoviedb.org/movie/${movie.id}`, tmdbId: movie.id,
        poster: image(movie.poster_path), backdrop: image(movie.backdrop_path)
      };
    }
  }
  return wikipedia(event.title, year, '', 'professional wrestling event');
}

current.programmes ||= {};
current.records ||= {};
current.episodes ||= {};
let processed = 0;

for (const programme of programmes) {
  if (processed >= limit) break;
  if (!refresh && current.programmes[programme.id]?.poster) continue;
  try {
    const result = await programmeArtwork(programme);
    if (result?.poster) {
      current.programmes[programme.id] = result;
      console.log(`Programme [${result.source}]: ${programme.name}`);
    }
  } catch (error) {
    console.warn(`Programme skipped: ${programme.name}: ${error.message}`);
  }
  processed += 1;
  await sleep(token && !wikipediaOnly ? 280 : 180);
}

for (const event of events) {
  if (processed >= limit) break;
  if (!refresh && current.records[event.id]?.poster) continue;
  try {
    const result = await eventArtwork(event);
    if (result?.poster) {
      current.records[event.id] = result;
      console.log(`Event [${result.source}]: ${event.title} (${event.date.slice(0, 4)})`);
    }
  } catch (error) {
    console.warn(`Event skipped: ${event.id}: ${error.message}`);
  }
  processed += 1;
  await sleep(token && !wikipediaOnly ? 280 : 180);
}

if (includeEpisodes && token && !wikipediaOnly) {
  const files = (await fs.readdir(new URL('data/tvmaze/', root))).filter(name => name.endsWith('.json') && name !== 'index.json');
  for (const file of files) {
    const feed = JSON.parse(await fs.readFile(new URL(`data/tvmaze/${file}`, root), 'utf8'));
    const programme = programmes.find(item => item.id === feed.programId);
    const tmdbShow = current.programmes[programme?.id]?.tmdbId;
    if (!programme || !tmdbShow) continue;
    for (const episode of feed.episodes || []) {
      if (!episode.airdate || episode.image?.original || episode.image?.medium) continue;
      const key = `${programme.id}:${episode.season}:${episode.number ?? 0}`;
      if (!refresh && current.episodes[key]?.still) continue;
      try {
        const images = await tmdb(`/tv/${tmdbShow}/season/${episode.season}/episode/${episode.number ?? 0}/images?include_image_language=en,null`);
        const still = image(images?.stills?.[0]?.file_path);
        if (still) current.episodes[key] = {
          source: 'TMDB', sourceUrl: `https://www.themoviedb.org/tv/${tmdbShow}/season/${episode.season}/episode/${episode.number ?? 0}`, still
        };
      } catch {}
      await sleep(280);
    }
  }
} else if (includeEpisodes) {
  console.warn('Episode-still scanning requires TMDB_READ_ACCESS_TOKEN; Wikipedia fallback only supplies page lead images.');
}

current.generatedAt = new Date().toISOString();
current.generatedWith = token && !wikipediaOnly ? 'TMDB with Wikipedia/Wikimedia fallback' : 'Wikipedia/Wikimedia fallback';
await fs.writeFile(new URL('data/artwork-catalog.json', root), `${JSON.stringify(current, null, 2)}\n`);
console.log('Artwork catalogue updated.');

const image = path => path ? `https://image.tmdb.org/t/p/original${path}` : '';
const clean = value => String(value || '')
  .replace(/\b(?:WWE|WWF|WCW|ECW|AEW|TNA|NWA|NJPW|ROH)\b/gi, '')
  .replace(/\b(?:PPV|PLE)\b/gi, '')
  .replace(/\s+/g, ' ')
  .trim();
const norm = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const withTimeout = (ms = 8000) => AbortSignal.timeout(ms);

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

function wikipediaQueries({ title, year, programmeTitle, kind, aliases = [] }) {
  if (kind === 'wrestler') {
    return [
      `${title} professional wrestler`,
      `${title} wrestler`,
      ...aliases.map(alias => `${alias} professional wrestler`)
    ];
  }
  if (kind === 'company') {
    return [
      `${title} professional wrestling promotion`,
      `${title} wrestling company`,
      ...aliases.map(alias => `${alias} professional wrestling promotion`)
    ];
  }
  const suffix = /episode/i.test(kind || '') ? 'television episode' : 'professional wrestling';
  return [
    [title, year, suffix].filter(Boolean).join(' '),
    [title, programmeTitle, suffix].filter(Boolean).join(' '),
    [clean(title), year, suffix].filter(Boolean).join(' ')
  ];
}

function scoreWikipediaPage(page, input) {
  const wanted = norm(input.title);
  const pageTitle = norm(page.title);
  let score = 0;
  if (pageTitle === wanted) score += 130;
  else if (pageTitle.startsWith(`${wanted} `) || wanted.startsWith(`${pageTitle} `)) score += 95;
  else if (pageTitle.includes(wanted) || wanted.includes(pageTitle)) score += 65;
  if (input.year && String(page.title || '').includes(String(input.year))) score += 20;
  if (input.programmeTitle && pageTitle.includes(norm(input.programmeTitle))) score += 15;
  if (input.kind === 'wrestler' && /wrestler|professional wrestler/.test(norm(page.description || ''))) score += 25;
  if (input.kind === 'company' && /wrestling|promotion/.test(norm(page.description || ''))) score += 20;
  if (page.original?.source) score += 12;
  if (page.thumbnail?.source) score += 5;
  return score;
}

async function wikipediaArtwork(input) {
  const queries = wikipediaQueries(input).filter((value, index, all) => value && all.indexOf(value) === index);
  for (const query of queries.slice(0, 3)) {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '0',
      gsrlimit: '10',
      prop: 'pageimages|info|description',
      piprop: 'original|thumbnail',
      pithumbsize: '1400',
      inprop: 'url',
      redirects: '1',
      format: 'json',
      formatversion: '2',
      origin: '*'
    });
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'RingsideArchive/5.3.0 (+https://ringside-archive.vercel.app/)', 'Api-User-Agent': 'RingsideArchive/5.3.0 (+https://ringside-archive.vercel.app/)' },
      signal: withTimeout()
    });
    if (!response.ok) continue;
    const payload = await response.json();
    const pages = (payload.query?.pages || [])
      .filter(page => page.original?.source || page.thumbnail?.source)
      .map(page => ({ page, score: scoreWikipediaPage(page, input) }))
      .filter(row => row.score >= (input.kind === 'wrestler' || input.kind === 'company' ? 70 : 65))
      .sort((a, b) => b.score - a.score);
    const hit = pages[0]?.page;
    if (!hit) continue;
    const foundImage = hit.original?.source || hit.thumbnail?.source || '';
    const common = {
      source: 'Wikipedia/Wikimedia',
      sourceUrl: hit.fullurl || `https://en.wikipedia.org/?curid=${hit.pageid}`,
      pageId: hit.pageid,
      attribution: 'Lead image supplied by Wikipedia/Wikimedia; verify the image-page licence before redistribution.'
    };
    if (input.kind === 'wrestler') return { ...common, mediaType: 'wrestler', poster: foundImage, headshot: foundImage };
    if (input.kind === 'company') return { ...common, mediaType: 'company', poster: foundImage, logo: foundImage };
    return {
      ...common,
      mediaType: input.kind === 'episode' ? 'episode-reference' : 'reference',
      poster: foundImage,
      backdrop: foundImage,
      still: input.kind === 'episode' ? foundImage : ''
    };
  }
  return null;
}


function commonsQueries(input){
  const aliases=Array.isArray(input.aliases)?input.aliases:[];
  if(input.kind==='company')return [`${input.title} logo`,...aliases.map(alias=>`${alias} wrestling logo`),`${input.title} professional wrestling`];
  if(input.kind==='wrestler')return [input.title,`${input.title} professional wrestler`,...aliases];
  return [`${input.title} professional wrestling`,input.title];
}
function scoreCommons(page,input){
  const filename=norm(String(page.title||'').replace(/^File:/i,'').replace(/\.[a-z0-9]+$/i,''));
  const wanted=norm(input.title);let score=0;
  if(filename===wanted)score+=130;
  else if(filename.startsWith(wanted)||wanted.startsWith(filename))score+=95;
  else if(filename.includes(wanted)||wanted.includes(filename))score+=65;
  if(input.kind==='company'&&/logo|emblem|wordmark/.test(filename))score+=35;
  if(input.kind==='wrestler'&&/logo|belt|championship|poster|card/.test(filename))score-=30;
  const info=page.imageinfo?.[0];
  const width=Number(info?.width||0),height=Number(info?.height||0);
  if(input.kind==='wrestler'&&height>=width)score+=12;
  if(input.kind==='company'&&width>=height)score+=8;
  return score;
}
async function commonsArtwork(input){
  for(const query of commonsQueries(input).filter(Boolean).slice(0,3)){
    const params=new URLSearchParams({
      action:'query',generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:'12',
      prop:'imageinfo|info',iiprop:'url|size|mime|extmetadata',iiurlwidth:'1400',
      inprop:'url',format:'json',formatversion:'2',origin:'*'
    });
    const response=await fetch(`https://commons.wikimedia.org/w/api.php?${params}`,{
      headers:{Accept:'application/json','User-Agent':'RingsideArchive/5.3.0 (+https://ringside-archive.vercel.app/)','Api-User-Agent':'RingsideArchive/5.3.0 (+https://ringside-archive.vercel.app/)'},
      signal:withTimeout()
    }).catch(()=>null);
    if(!response?.ok)continue;
    const payload=await response.json().catch(()=>({}));
    const rows=(payload.query?.pages||[]).map(page=>({page,score:scoreCommons(page,input)})).filter(row=>row.score>=(input.kind==='company'?85:input.kind==='wrestler'?80:75)).sort((a,b)=>b.score-a.score);
    const hit=rows[0]?.page,info=hit?.imageinfo?.[0];if(!hit||!info)continue;
    const foundImage=info.thumburl||info.url||'';if(!foundImage)continue;
    const common={source:'Wikimedia Commons',sourceUrl:hit.fullurl||info.descriptionurl||'',attribution:'Image supplied by Wikimedia Commons; open the source page to verify author and licence.'};
    if(input.kind==='company')return {...common,mediaType:'company',poster:foundImage,logo:foundImage};
    if(input.kind==='wrestler')return {...common,mediaType:'wrestler',poster:foundImage,headshot:foundImage};
    return {...common,mediaType:'reference',poster:foundImage,backdrop:foundImage};
  }
  return null;
}

async function tmdbArtwork(input, token) {
  const { title, year, kind, programmeTitle, season, episode } = input;
  if (kind === 'wrestler' || kind === 'company') return null;

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

async function lookup(input, token) {
  const normalized = {
    ...input,
    title: String(input?.title || '').trim(),
    year: Number(input?.year) || null,
    kind: String(input?.kind || 'show'),
    aliases: Array.isArray(input?.aliases) ? input.aliases.filter(Boolean).slice(0, 5) : []
  };
  if (!normalized.title) return { error: 'Missing artwork title.' };

  if (token) {
    const result = await tmdbArtwork(normalized, token).catch(() => null);
    if (result && (result.poster || result.backdrop || result.still || result.logo || result.headshot)) return result;
  }
  const fallback = await wikipediaArtwork(normalized);
  if (fallback) return fallback;
  const commons = await commonsArtwork(normalized);
  if (commons) return commons;
  return {
    error: token
      ? 'No trustworthy TMDB or Wikipedia/Wikimedia artwork match was found.'
      : 'No Wikipedia/Wikimedia artwork match was found. Add TMDB_READ_ACCESS_TOKEN for richer show, season and episode artwork.'
  };
}

function allowedArtworkAsset(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'image.tmdb.org' || host === 'static.tvmaze.com' || host === 'upload.wikimedia.org'
      || host.endsWith('.wikimedia.org') || host.endsWith('.wikipedia.org')
    );
  } catch { return false; }
}

async function proxyArtwork(req, res) {
  const asset = String(req.query?.asset || '');
  if (!allowedArtworkAsset(asset)) return res.status(400).json({ error: 'Unsupported artwork host.' });
  const response = await fetch(asset, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': 'RingsideArchive/5.3.0 (+https://ringside-archive.vercel.app)',
      Referer: new URL(asset).origin + '/'
    },
    signal: withTimeout(15000)
  });
  if (!response.ok) return res.status(response.status).json({ error: `Artwork source returned ${response.status}.` });
  const type = response.headers.get('content-type') || 'application/octet-stream';
  if (!type.startsWith('image/')) return res.status(415).json({ error: 'Artwork source did not return an image.' });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Artwork image is too large.' });
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(buffer);
}

export default async function handler(req, res) {
  if (req.method === 'GET') return proxyArtwork(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = bodyOf(req);
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  try {
    if (Array.isArray(body.items)) {
      const items = body.items.slice(0, 8);
      const results = new Array(items.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < items.length) {
          const index = cursor++;
          const item = items[index];
          try {
            const result = await Promise.race([
              lookup(item, token),
              new Promise(resolve => setTimeout(() => resolve({ error: 'Artwork lookup timed out; retry later.' }), 18000))
            ]);
            results[index] = { key: item.key || item.id || item.title, result };
          } catch (error) {
            results[index] = { key: item.key || item.id || item.title, result: { error: error.message || 'Artwork lookup failed.' } };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ results });
    }

    const result = await lookup(body, token);
    if (result.error) return res.status(404).json(result);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Artwork lookup failed.' });
  }
}

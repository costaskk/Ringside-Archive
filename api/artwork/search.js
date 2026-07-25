import { createHash, createHmac } from 'node:crypto';
import { authenticateAccount } from '../_lib/account.js';
const APP_VERSION = '5.8.1';
const APP_URL = 'https://ringside-archive.vercel.app/';
const USER_AGENT = `RingsideArchive/${APP_VERSION} (+${APP_URL})`;
const image = path => path ? `https://image.tmdb.org/t/p/original${path}` : '';
const withTimeout = (ms = 9000) => AbortSignal.timeout(ms);

const norm = value => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const GENERIC_WORDS = new Set([
  'the','a','an','and','of','in','on','at','to','for','with','from','professional','pro','wrestling',
  'show','event','events','episode','episodes','television','tv','pay','per','view','ppv','ple','special',
  'archive','complete','weekly','major','series','promotion','championship'
]);

const words = value => norm(value).split(' ').filter(word => word && !GENERIC_WORDS.has(word));
const unique = values => [...new Set(values.filter(Boolean))];
const clean = value => String(value || '')
  .replace(/\b(?:WWE|WWF|WCW|ECW|AEW|TNA|NWA|NJPW|ROH|MLW|GCW|CZW|PWG)\b/gi, '')
  .replace(/\b(?:PPV|PLE)\b/gi, '')
  .replace(/\s+/g, ' ')
  .trim();

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function normalizeInput(input = {}) {
  return {
    ...input,
    key: String(input.key || input.id || input.title || '').trim(),
    title: String(input.title || '').trim(),
    programmeTitle: String(input.programmeTitle || '').trim(),
    promotionName: String(input.promotionName || '').trim(),
    promotionShortName: String(input.promotionShortName || '').trim(),
    kind: String(input.kind || 'show').toLowerCase(),
    year: Number(input.year) || null,
    tvMazeId: Number(input.tvMazeId) || null,
    season: Number.isFinite(Number(input.season)) ? Number(input.season) : null,
    episode: Number.isFinite(Number(input.episode)) ? Number(input.episode) : null,
    aliases: Array.isArray(input.aliases) ? unique(input.aliases.map(String).map(v => v.trim())).slice(0, 8) : []
  };
}

function imageFilename(url = '') {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').toLowerCase(); }
  catch { return String(url).toLowerCase(); }
}

function tokenCoverage(candidate, wanted) {
  const a = new Set(words(candidate));
  const b = new Set(words(wanted));
  if (!a.size || !b.size) return 0;
  const intersection = [...b].filter(word => a.has(word)).length;
  return intersection / b.size;
}

function titleScore(candidate, input, { allowProgramme = true } = {}) {
  const candidateNorm = norm(candidate);
  const titles = unique([input.title, ...input.aliases, allowProgramme ? input.programmeTitle : '']);
  let best = 0;
  for (const title of titles) {
    const wanted = norm(title);
    if (!wanted || !candidateNorm) continue;
    let score = 0;
    if (candidateNorm === wanted) score = 100;
    else if (candidateNorm.startsWith(`${wanted} `) || wanted.startsWith(`${candidateNorm} `)) score = 91;
    else if (candidateNorm.includes(wanted) || wanted.includes(candidateNorm)) score = 78;
    else {
      const coverage = tokenCoverage(candidateNorm, wanted);
      score = Math.round(coverage * 72);
      if (coverage === 1) score = Math.max(score, 84);
    }
    best = Math.max(best, score);
  }
  return best;
}

function yearScore(candidateYear, wantedYear, tolerance = 0) {
  if (!wantedYear || !candidateYear) return 0;
  const difference = Math.abs(Number(candidateYear) - Number(wantedYear));
  if (difference === 0) return 25;
  if (difference <= tolerance) return 10;
  return -35;
}

function resultWithConfidence(result, confidence, matchReason) {
  return { ...result, confidence: Math.max(0, Math.min(100, Math.round(confidence))), matchReason };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      'Api-User-Agent': USER_AGENT,
      ...(options.headers || {})
    },
    signal: options.signal || withTimeout()
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}.`);
  return response.json();
}

async function tmdb(path, token) {
  return jsonFetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function chooseTmdb(results, input, dateField, { episodeShow = false } = {}) {
  return (results || []).map(result => {
    const candidate = result.title || result.name || '';
    const candidateYear = Number(String(result[dateField] || '').slice(0, 4)) || null;
    let score = titleScore(candidate, input, { allowProgramme: episodeShow });
    if (!episodeShow) score += yearScore(candidateYear, input.year, 1);
    if (result.poster_path) score += 4;
    if (result.backdrop_path) score += 2;
    return { result, score, candidate, candidateYear };
  }).sort((a, b) => b.score - a.score)[0] || null;
}

async function tvMazeArtwork(input) {
  if (!input.tvMazeId || ['company', 'wrestler'].includes(input.kind)) return null;
  const show = await jsonFetch(`https://api.tvmaze.com/shows/${input.tvMazeId}`).catch(() => null);
  if (!show) return null;
  const showTitleScore = titleScore(show.name, { ...input, title: input.programmeTitle || input.title }, { allowProgramme: true });
  if (showTitleScore < 72) return null;

  let still = '';
  let episodeSource = '';
  if (input.kind === 'episode' && input.season != null && input.episode != null) {
    const episode = await jsonFetch(`https://api.tvmaze.com/shows/${input.tvMazeId}/episodebynumber?season=${input.season}&number=${input.episode}`).catch(() => null);
    still = episode?.image?.original || episode?.image?.medium || '';
    episodeSource = episode?.url || '';
  }

  const poster = show.image?.original || show.image?.medium || '';
  if (!poster && !still) return null;
  return resultWithConfidence({
    source: 'TVMaze',
    sourceUrl: episodeSource || show.url || `https://www.tvmaze.com/shows/${show.id}`,
    mediaType: input.kind === 'episode' ? 'episode' : 'tv',
    tvMazeId: show.id,
    poster,
    backdrop: poster,
    still,
    attribution: 'Show or episode image supplied by the mapped TVMaze record.'
  }, still ? 100 : 96, still ? 'Exact mapped TVMaze episode number' : 'Exact mapped TVMaze show ID');
}

function isProgrammeLike(input) {
  return ['weekly','territory-tv','studio','streaming','archive','show'].includes(input.kind)
    || input.programmeTitle === input.title;
}

async function tmdbArtwork(input, token) {
  if (!token || ['wrestler', 'company'].includes(input.kind)) return null;

  if (input.kind === 'episode' && input.programmeTitle) {
    const search = await tmdb(`/search/tv?query=${encodeURIComponent(input.programmeTitle)}`, token);
    const hit = chooseTmdb(search.results, { ...input, title: input.programmeTitle }, 'first_air_date', { episodeShow: true });
    if (!hit || hit.score < 88) return null;
    let still = '';
    if (input.season != null && input.episode != null) {
      const images = await tmdb(`/tv/${hit.result.id}/season/${input.season}/episode/${input.episode}/images?include_image_language=en,null`, token).catch(() => ({ stills: [] }));
      still = image(images.stills?.[0]?.file_path);
    }
    if (!still && !hit.result.poster_path && !hit.result.backdrop_path) return null;
    return resultWithConfidence({
      source: 'TMDB',
      sourceUrl: `https://www.themoviedb.org/tv/${hit.result.id}`,
      tmdbId: hit.result.id,
      mediaType: 'tv',
      poster: image(hit.result.poster_path),
      backdrop: image(hit.result.backdrop_path),
      still,
      attribution: 'Artwork supplied by TMDB; this product is not endorsed or certified by TMDB.'
    }, still ? 96 : Math.min(92, hit.score), still ? 'Exact TMDB season and episode still' : 'Strict programme-title match on TMDB');
  }

  if (isProgrammeLike(input)) {
    const queries = unique([input.title, ...input.aliases]).slice(0, 3);
    let bestHit = null;
    for (const query of queries) {
      const search = await tmdb(`/search/tv?query=${encodeURIComponent(query)}`, token).catch(() => ({ results: [] }));
      const hit = chooseTmdb(search.results, input, 'first_air_date');
      if (hit && (!bestHit || hit.score > bestHit.score)) bestHit = hit;
    }
    if (!bestHit || bestHit.score < 86) return null;
    const details = await tmdb(`/tv/${bestHit.result.id}`, token).catch(() => bestHit.result);
    const seasons = {};
    for (const row of details.seasons || []) if (row.poster_path) seasons[row.season_number] = { poster: image(row.poster_path) };
    if (!bestHit.result.poster_path && !bestHit.result.backdrop_path && !Object.keys(seasons).length) return null;
    return resultWithConfidence({
      source: 'TMDB',
      sourceUrl: `https://www.themoviedb.org/tv/${bestHit.result.id}`,
      tmdbId: bestHit.result.id,
      mediaType: 'tv',
      poster: image(bestHit.result.poster_path),
      backdrop: image(bestHit.result.backdrop_path),
      seasons,
      attribution: 'Artwork supplied by TMDB; this product is not endorsed or certified by TMDB.'
    }, Math.min(96, bestHit.score), `Strict TV title match: ${bestHit.candidate}`);
  }

  const queries = unique([
    input.title,
    clean(input.title),
    input.programmeTitle ? `${input.title} ${input.programmeTitle}` : '',
    input.promotionShortName ? `${input.title} ${input.promotionShortName}` : ''
  ]).slice(0, 4);
  let bestHit = null;
  for (const query of queries) {
    const suffix = input.year ? `&year=${input.year}` : '';
    const search = await tmdb(`/search/movie?query=${encodeURIComponent(query)}${suffix}`, token).catch(() => ({ results: [] }));
    const hit = chooseTmdb(search.results, input, 'release_date');
    if (hit && (!bestHit || hit.score > bestHit.score)) bestHit = hit;
  }
  if (!bestHit || bestHit.score < 104) return null;
  if (!bestHit.result.poster_path && !bestHit.result.backdrop_path) return null;
  return resultWithConfidence({
    source: 'TMDB',
    sourceUrl: `https://www.themoviedb.org/movie/${bestHit.result.id}`,
    tmdbId: bestHit.result.id,
    mediaType: 'movie',
    poster: image(bestHit.result.poster_path),
    backdrop: image(bestHit.result.backdrop_path),
    attribution: 'Artwork supplied by TMDB; this product is not endorsed or certified by TMDB.'
  }, Math.min(96, bestHit.score - 10), `Strict event-title and year match: ${bestHit.candidate}`);
}

function wikipediaQueries(input) {
  if (input.kind === 'wrestler') return unique([
    `${input.title} professional wrestler`, `${input.title} wrestler`, ...input.aliases.map(alias => `${alias} professional wrestler`)
  ]);
  if (input.kind === 'company') return unique([
    `${input.title} professional wrestling promotion logo`, `${input.title} wrestling logo`,
    ...input.aliases.map(alias => `${alias} wrestling logo`)
  ]);
  if (input.kind === 'episode') return unique([
    `${input.programmeTitle} ${input.season != null ? `season ${input.season}` : ''} ${input.episode != null ? `episode ${input.episode}` : ''}`,
    `${input.title} ${input.programmeTitle}`
  ]);
  return unique([
    [input.title, input.year, input.promotionShortName, 'professional wrestling'].filter(Boolean).join(' '),
    [input.title, input.programmeTitle, input.year].filter(Boolean).join(' '),
    [clean(input.title), input.year, input.promotionName].filter(Boolean).join(' ')
  ]);
}

function wikipediaPageScore(page, input) {
  const pageTitle = page.title || '';
  let score = titleScore(pageTitle, input);
  const description = norm(`${page.description || ''} ${page.extract || ''}`);
  if (input.year && String(pageTitle).includes(String(input.year))) score += 18;
  if (input.promotionShortName && norm(pageTitle).includes(norm(input.promotionShortName))) score += 10;
  if (input.programmeTitle && tokenCoverage(pageTitle, input.programmeTitle) >= .7) score += 12;
  if (input.kind === 'wrestler') score += /professional wrestler|wrestler/.test(description) ? 22 : -35;
  if (input.kind === 'company') score += /wrestling promotion|professional wrestling|wrestling company/.test(description) ? 18 : -30;
  if (page.original?.source || page.thumbnail?.source) score += 4;
  return score;
}

function rejectWikipediaImage(url, input) {
  const filename = norm(imageFilename(url));
  if (!filename) return true;
  if (input.kind === 'wrestler') return /logo|wordmark|belt|championship|poster|match card|stable|tag team|group photo|arena/.test(filename);
  if (input.kind === 'company') return !/logo|wordmark|emblem|brand|symbol/.test(filename);
  if (input.kind === 'episode') return /logo|wordmark|championship belt/.test(filename);
  const coverage = tokenCoverage(filename, input.title);
  return coverage < .45 && !String(filename).includes(String(input.year || ''));
}

async function wikipediaSummaryArtwork(input) {
  if (!['wrestler', 'company'].includes(input.kind)) return null;
  for (const title of unique([input.title, ...input.aliases]).slice(0, 3)) {
    const slug = encodeURIComponent(title.replace(/\s+/g, '_'));
    const page = await jsonFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, { signal: withTimeout(6500) }).catch(() => null);
    const foundImage = page?.originalimage?.source || page?.thumbnail?.source || '';
    if (!foundImage || rejectWikipediaImage(foundImage, input)) continue;
    const description = norm(`${page.description || ''} ${page.extract || ''}`);
    if (input.kind === 'wrestler' && !/wrestl/.test(description)) continue;
    if (input.kind === 'company' && !/wrestling promotion|wrestling company|professional wrestling/.test(description)) continue;
    const common = {
      source: 'Wikipedia/Wikimedia',
      sourceUrl: page.content_urls?.desktop?.page || '',
      attribution: 'Image supplied by Wikipedia/Wikimedia; open the source page to verify author and licence.'
    };
    return resultWithConfidence(input.kind === 'wrestler'
      ? { ...common, mediaType: 'wrestler', poster: foundImage, headshot: foundImage }
      : { ...common, mediaType: 'company', poster: foundImage, logo: foundImage }, 95, 'Exact Wikipedia page with media-type validation');
  }
  return null;
}

async function wikipediaArtwork(input) {
  const summary = await wikipediaSummaryArtwork(input);
  if (summary) return summary;
  for (const query of wikipediaQueries(input).slice(0, 4)) {
    const params = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '0', gsrlimit: '12',
      prop: 'pageimages|info|description|extracts', piprop: 'original|thumbnail', pithumbsize: '1400',
      exintro: '1', explaintext: '1', inprop: 'url', redirects: '1', format: 'json', formatversion: '2', origin: '*'
    });
    const payload = await jsonFetch(`https://en.wikipedia.org/w/api.php?${params}`).catch(() => null);
    const rows = (payload?.query?.pages || []).map(page => ({ page, score: wikipediaPageScore(page, input) }))
      .filter(row => row.score >= (input.kind === 'wrestler' ? 88 : input.kind === 'company' ? 92 : input.kind === 'episode' ? 90 : 92))
      .sort((a, b) => b.score - a.score);
    for (const row of rows) {
      const hit = row.page;
      const foundImage = hit.original?.source || hit.thumbnail?.source || '';
      if (!foundImage || rejectWikipediaImage(foundImage, input)) continue;
      const common = {
        source: 'Wikipedia/Wikimedia',
        sourceUrl: hit.fullurl || `https://en.wikipedia.org/?curid=${hit.pageid}`,
        pageId: hit.pageid,
        attribution: 'Image supplied by Wikipedia/Wikimedia; open the source page to verify author and licence.'
      };
      if (input.kind === 'wrestler') return resultWithConfidence({ ...common, mediaType: 'wrestler', poster: foundImage, headshot: foundImage }, Math.min(96, row.score), `Validated wrestler page: ${hit.title}`);
      if (input.kind === 'company') return resultWithConfidence({ ...common, mediaType: 'company', poster: foundImage, logo: foundImage }, Math.min(96, row.score), `Validated promotion logo page: ${hit.title}`);
      return resultWithConfidence({
        ...common,
        mediaType: input.kind === 'episode' ? 'episode-reference' : 'reference',
        poster: foundImage,
        backdrop: foundImage,
        still: input.kind === 'episode' ? foundImage : ''
      }, Math.min(94, row.score), `Strict Wikipedia title/context match: ${hit.title}`);
    }
  }
  return null;
}

function commonsQueries(input) {
  if (input.kind === 'company') return unique([
    `${input.title} logo`, ...input.aliases.map(alias => `${alias} wrestling logo`), `${input.title} wordmark`
  ]);
  if (input.kind === 'wrestler') return unique([input.title, `${input.title} professional wrestler`, ...input.aliases]);
  return unique([
    `${input.title} ${input.year || ''} ${input.promotionShortName || ''}`,
    `${input.title} professional wrestling poster`,
    input.programmeTitle ? `${input.title} ${input.programmeTitle}` : ''
  ]);
}

function commonsScore(page, input) {
  const info = page.imageinfo?.[0] || {};
  const filename = String(page.title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '');
  const normalizedFilename = norm(filename);
  let score = titleScore(filename, input);
  const width = Number(info.width || 0), height = Number(info.height || 0);
  if (input.year && normalizedFilename.includes(String(input.year))) score += 14;
  if (input.kind === 'company') {
    if (/logo|emblem|wordmark|brand|symbol/.test(normalizedFilename)) score += 32;
    else score -= 80;
    if (width >= height) score += 6;
  }
  if (input.kind === 'wrestler') {
    if (/logo|belt|championship|poster|card|tag team|stable|group|arena/.test(normalizedFilename)) score -= 65;
    if (height >= width) score += 10;
  }
  if (!['company', 'wrestler'].includes(input.kind)) {
    if (/logo|wordmark/.test(normalizedFilename) && tokenCoverage(filename, input.title) < .7) score -= 35;
    if (/poster|programme|program|event/.test(normalizedFilename)) score += 8;
  }
  return score;
}

async function commonsArtwork(input) {
  for (const query of commonsQueries(input).slice(0, 4)) {
    const params = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '16',
      prop: 'imageinfo|info', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1400',
      inprop: 'url', format: 'json', formatversion: '2', origin: '*'
    });
    const payload = await jsonFetch(`https://commons.wikimedia.org/w/api.php?${params}`).catch(() => null);
    const rows = (payload?.query?.pages || []).map(page => ({ page, score: commonsScore(page, input) }))
      .filter(row => row.score >= (input.kind === 'company' ? 104 : input.kind === 'wrestler' ? 86 : 92))
      .sort((a, b) => b.score - a.score);
    const hit = rows[0]?.page, info = hit?.imageinfo?.[0];
    if (!hit || !info) continue;
    const foundImage = info.thumburl || info.url || '';
    if (!foundImage) continue;
    const common = {
      source: 'Wikimedia Commons',
      sourceUrl: hit.fullurl || info.descriptionurl || '',
      attribution: 'Image supplied by Wikimedia Commons; open the source page to verify author and licence.'
    };
    if (input.kind === 'company') return resultWithConfidence({ ...common, mediaType: 'company', poster: foundImage, logo: foundImage }, Math.min(97, rows[0].score - 5), `Validated logo filename: ${hit.title}`);
    if (input.kind === 'wrestler') return resultWithConfidence({ ...common, mediaType: 'wrestler', poster: foundImage, headshot: foundImage }, Math.min(95, rows[0].score), `Validated wrestler image filename: ${hit.title}`);
    return resultWithConfidence({ ...common, mediaType: 'reference', poster: foundImage, backdrop: foundImage }, Math.min(93, rows[0].score), `Strict event image filename match: ${hit.title}`);
  }
  return null;
}

export async function lookup(rawInput, token) {
  const input = normalizeInput(rawInput);
  if (!input.title) return { error: 'Missing artwork title.' };

  const attempts = [];
  const trySource = async (name, fn) => {
    try {
      const result = await fn();
      if (result && !result.error) return result;
    } catch (error) {
      attempts.push(`${name}: ${error.message}`);
    }
    return null;
  };

  if (!['company', 'wrestler'].includes(input.kind)) {
    const tvmaze = await trySource('TVMaze', () => tvMazeArtwork(input));
    if (tvmaze) return tvmaze;
  }

  if (input.kind === 'company') {
    const commons = await trySource('Wikimedia Commons', () => commonsArtwork(input));
    if (commons) return commons;
    const wikipedia = await trySource('Wikipedia', () => wikipediaArtwork(input));
    if (wikipedia) return wikipedia;
  } else if (input.kind === 'wrestler') {
    const wikipedia = await trySource('Wikipedia', () => wikipediaArtwork(input));
    if (wikipedia) return wikipedia;
    const commons = await trySource('Wikimedia Commons', () => commonsArtwork(input));
    if (commons) return commons;
  } else {
    if (token) {
      const tmdbResult = await trySource('TMDB', () => tmdbArtwork(input, token));
      if (tmdbResult) return tmdbResult;
    }
    const wikipedia = await trySource('Wikipedia', () => wikipediaArtwork(input));
    if (wikipedia) return wikipedia;
    const commons = await trySource('Wikimedia Commons', () => commonsArtwork(input));
    if (commons) return commons;
  }

  return {
    error: token
      ? 'No high-confidence artwork match was found. The scanner rejected ambiguous images rather than showing unrelated artwork.'
      : 'No high-confidence Wikipedia/Wikimedia match was found. Add TMDB_READ_ACCESS_TOKEN for richer show, season and episode artwork.',
    diagnostics: attempts.slice(0, 4)
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


const envValue = name => String(process.env[name] || '').trim().replace(/^['"]|['"]$/g, '');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value, encoding) => createHmac('sha256', key).update(value, 'utf8').digest(encoding);
const safeSegment = value => norm(value).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 72) || 'artwork';
const encodePath = value => String(value).split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');

function r2Configuration() {
  const accountId=envValue('CLOUDFLARE_ACCOUNT_ID');
  const accessKeyId=envValue('R2_ACCESS_KEY_ID');
  const secretAccessKey=envValue('R2_SECRET_ACCESS_KEY');
  const bucket=envValue('R2_BUCKET_NAME')||'ringside-artwork';
  const publicBaseUrl=envValue('R2_ARTWORK_PUBLIC_BASE_URL').replace(/\/+$/,'');
  return {accountId,accessKeyId,secretAccessKey,bucket,publicBaseUrl,configured:Boolean(accountId&&accessKeyId&&secretAccessKey&&bucket&&publicBaseUrl)};
}

function awsDates(date=new Date()) {
  const stamp=date.toISOString().replace(/[:-]|\.\d{3}/g,'');
  return {amzDate:stamp,dateStamp:stamp.slice(0,8)};
}

async function putR2Object(config, objectKey, buffer, contentType) {
  const host=`${config.accountId}.r2.cloudflarestorage.com`;
  const path=`/${encodePath(config.bucket)}/${encodePath(objectKey)}`;
  const payloadHash=sha256(buffer);
  const {amzDate,dateStamp}=awsDates();
  const canonicalHeaders=`cache-control:public,max-age=31536000,immutable\ncontent-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders='cache-control;content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest=['PUT',path,'',canonicalHeaders,signedHeaders,payloadHash].join('\n');
  const scope=`${dateStamp}/auto/s3/aws4_request`;
  const stringToSign=['AWS4-HMAC-SHA256',amzDate,scope,sha256(canonicalRequest)].join('\n');
  const kDate=hmac(Buffer.from(`AWS4${config.secretAccessKey}`,'utf8'),dateStamp);
  const kRegion=hmac(kDate,'auto');
  const kService=hmac(kRegion,'s3');
  const kSigning=hmac(kService,'aws4_request');
  const signature=hmac(kSigning,stringToSign,'hex');
  const authorization=`AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response=await fetch(`https://${host}${path}`,{method:'PUT',headers:{Authorization:authorization,'x-amz-date':amzDate,'x-amz-content-sha256':payloadHash,'Content-Type':contentType,'Cache-Control':'public,max-age=31536000,immutable'},body:buffer,signal:withTimeout(20000)});
  if(!response.ok){const text=await response.text().catch(()=> '');throw new Error(`R2 upload returned ${response.status}${text?`: ${text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,180)}`:''}`);}
  return `${config.publicBaseUrl}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

function imageExtension(contentType, sourceUrl='') {
  const type=String(contentType||'').split(';')[0].toLowerCase();
  const byType={'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif','image/gif':'gif','image/svg+xml':'svg'};
  if(byType[type])return byType[type];
  const pathname=(()=>{try{return new URL(sourceUrl).pathname;}catch{return '';}})();
  const ext=(pathname.match(/\.([a-z0-9]{2,5})$/i)||[])[1]?.toLowerCase();
  return ['jpg','jpeg','png','webp','avif','gif','svg'].includes(ext)?(ext==='jpeg'?'jpg':ext):'img';
}

async function downloadArtworkAsset(asset) {
  if(!allowedArtworkAsset(asset))throw new Error('The accepted artwork source is not on the upload allow-list.');
  const response=await fetch(asset,{headers:{Accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','User-Agent':USER_AGENT,Referer:new URL(asset).origin+'/'},signal:withTimeout(18000)});
  if(!response.ok)throw new Error(`Artwork source returned ${response.status}.`);
  const contentType=response.headers.get('content-type')||'application/octet-stream';
  if(!contentType.startsWith('image/'))throw new Error('Artwork source did not return an image.');
  const buffer=Buffer.from(await response.arrayBuffer());
  if(!buffer.length||buffer.length>10*1024*1024)throw new Error('Artwork image was empty or exceeded 10 MB.');
  return {buffer,contentType};
}

async function persistArtworkToR2(result, input, account=null) {
  const config=r2Configuration();
  if(!config.configured||!result||result.error)return result;
  if(!account?.id)return {...result,r2Cached:false,r2RequiresAccount:true};
  const fields=['poster','backdrop','still','logo','headshot'];
  const urls=new Map();
  const cachedFields=[];
  const updated={...result};
  try{
    for(const field of fields){
      const source=String(result[field]||'');if(!source)continue;
      if(source.startsWith(`${config.publicBaseUrl}/`)){updated[field]=source;cachedFields.push(field);continue;}
      let publicUrl=urls.get(source);
      if(!publicUrl){
        const {buffer,contentType}=await downloadArtworkAsset(source);
        const hash=sha256(buffer).slice(0,24),ext=imageExtension(contentType,source);
        const objectKey=`runtime/${safeSegment(input.kind)}/${safeSegment(input.key||input.id||input.title)}/${hash}.${ext}`;
        publicUrl=await putR2Object(config,objectKey,buffer,contentType);urls.set(source,publicUrl);
      }
      updated[field]=publicUrl;cachedFields.push(field);
    }
    if(cachedFields.length){updated.r2Cached=true;updated.r2CachedFields=[...new Set(cachedFields)];updated.r2PublicBaseUrl=config.publicBaseUrl;}
  }catch(error){updated.r2Cached=false;updated.r2CacheError=error.message||'R2 persistence failed.';}
  return updated;
}

async function proxyArtworkAsset(asset, res) {
  asset = String(asset || '');
  if (!allowedArtworkAsset(asset)) return res.status(400).json({ error: 'Unsupported artwork host.' });
  const response = await fetch(asset, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': USER_AGENT,
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
  const token = String(process.env.TMDB_READ_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
  if (req.method === 'GET') {
    try {
      if (req.query?.asset) return await proxyArtworkAsset(req.query.asset, res);
      if (String(req.query?.render || '') === '1') {
        const input = normalizeInput({
          title: req.query?.title,
          kind: req.query?.kind,
          aliases: String(req.query?.aliases || '').split('|').filter(Boolean),
          year: req.query?.year,
          programmeTitle: req.query?.programmeTitle,
          promotionName: req.query?.promotionName,
          promotionShortName: req.query?.promotionShortName,
          tvMazeId: req.query?.tvMazeId,
          season: req.query?.season,
          episode: req.query?.episode
        });
        const result = await lookup(input, token);
        const asset = result.headshot || result.logo || result.poster || result.still || result.backdrop || '';
        if (!asset) return res.status(404).json({ error: result.error || 'No artwork was found.' });
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
        return await proxyArtworkAsset(asset, res);
      }
      return res.status(400).json({ error: 'Missing artwork asset or render request.' });
    } catch (error) {
      return res.status(502).json({ error: error.message || 'Artwork rendering failed.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = bodyOf(req);
  try {
    const account=await authenticateAccount(req,{optional:true}).catch(()=>null);
    if (Array.isArray(body.items)) {
      const items = body.items.slice(0, 8).map(normalizeInput);
      const results = new Array(items.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < items.length) {
          const index = cursor++;
          const item = items[index];
          try {
            const found = await Promise.race([
              lookup(item, token),
              new Promise(resolve => setTimeout(() => resolve({ error: 'Artwork lookup timed out; retry later.' }), 20000))
            ]);
            const result=found?.error?found:await persistArtworkToR2(found,item,account);
            results[index] = { key: item.key || item.id || item.title, result };
          } catch (error) {
            results[index] = { key: item.key || item.id || item.title, result: { error: error.message || 'Artwork lookup failed.' } };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ results });
    }

    const input=normalizeInput(body);
    const found = await lookup(input, token);
    if (found.error) return res.status(404).json(found);
    const result=await persistArtworkToR2(found,input,account);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Artwork lookup failed.' });
  }
}

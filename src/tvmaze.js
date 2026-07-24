const memory = new Map();
let snapshotIndexPromise = null;

const stripHtml = value => String(value || '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const normal = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\b(?:wwe|wwf|wwwf|wcw|nwa|aew|tna|impact)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

async function snapshotIndex() {
  if (snapshotIndexPromise) return snapshotIndexPromise;
  snapshotIndexPromise = fetch('./data/tvmaze/index.json', { cache: 'no-cache' })
    .then(response => response.ok ? response.json() : { feeds: [] })
    .catch(() => ({ feeds: [] }))
    .then(payload => new Set((payload.feeds || []).map(item => item.programId).filter(Boolean)));
  return snapshotIndexPromise;
}

export async function discoverTvMazeId(program) {
  const queries = [program.name, ...(program.aliases || [])].filter(Boolean);
  for (const query of queries.slice(0, 4)) {
    const response = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) continue;
    const results = await response.json();
    const wanted = normal(query);
    const exact = results.find(row => normal(row.show?.name) === wanted);
    if (exact?.show?.id) {
      return { tvMazeId: exact.show.id, show: exact.show, matchedBy: query, confidence: 'exact-title' };
    }
  }
  return null;
}

export async function loadTvMazeFeed(program, { forceLive = false, tvMazeId = null } = {}) {
  const mappedId = tvMazeId || program?.tvMazeId;
  if (!mappedId) throw new Error('This programme has no mapped exact episode feed.');

  const cacheKey = `${program.id}:${mappedId}`;
  if (!forceLive && memory.has(cacheKey)) return memory.get(cacheKey);

  let payload = null;
  const canUseCheckedInSnapshot = !forceLive
    && Number(mappedId) === Number(program.tvMazeId)
    && (await snapshotIndex()).has(program.id);

  if (canUseCheckedInSnapshot) {
    try {
      const response = await fetch(`./data/tvmaze/${encodeURIComponent(program.id)}.json`, { cache: 'no-cache' });
      if (response.ok) payload = await response.json();
    } catch {}
  }

  if (!payload) {
    const [showResponse, episodeResponse] = await Promise.all([
      fetch(`https://api.tvmaze.com/shows/${mappedId}`, { signal: AbortSignal.timeout(15000) }),
      fetch(`https://api.tvmaze.com/shows/${mappedId}/episodes?specials=1`, { signal: AbortSignal.timeout(15000) })
    ]);
    if (!showResponse.ok || !episodeResponse.ok) {
      throw new Error(`TVMaze feed failed for ${program.name} (${showResponse.status}/${episodeResponse.status}).`);
    }
    payload = {
      programId: program.id,
      tvMazeId: mappedId,
      fetchedAt: new Date().toISOString(),
      show: await showResponse.json(),
      episodes: await episodeResponse.json()
    };
  }

  memory.set(cacheKey, payload);
  return payload;
}

export function normalizeEpisode(program, feed, episode) {
  if (!episode?.airdate) return null;
  const eventLike = program.kind === 'ppv' || program.kind === 'supercard';
  const season = Number(episode.season || 0);
  const number = Number(episode.number ?? 0);
  return {
    id: `tvmaze:${episode.id}`,
    itemKey: `episode:${program.id}:${season}:${number}`,
    promotionId: program.promotionId,
    programId: program.id,
    title: episode.name || `${program.name} episode`,
    date: episode.airdate,
    kind: eventLike ? program.kind : 'episode',
    season,
    number,
    code: eventLike ? '' : `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`,
    description: stripHtml(episode.summary) || `${program.name} episode aired ${episode.airdate}.`,
    artwork: episode.image?.original || episode.image?.medium || '',
    showArtwork: feed.show?.image?.original || feed.show?.image?.medium || '',
    sourceUrl: episode.url || feed.show?.url || '',
    sourceLabel: 'TVMaze exact episode feed',
    runtime: episode.runtime || null,
    tvMazeId: episode.id,
    tvMazeShowId: feed.show?.id || feed.tvMazeId || program.tvMazeId,
    rating: episode.rating?.average ?? null
  };
}

export async function loadPromotionEpisodes(programmes, promotionId, onProgress = () => {}, feedMap = {}) {
  const feeds = programmes.filter(program => program.promotionId === promotionId && (program.tvMazeId || feedMap[program.id]));
  const records = [];
  let completed = 0;
  const queue = [...feeds];

  const worker = async () => {
    while (queue.length) {
      const program = queue.shift();
      try {
        const feed = await loadTvMazeFeed(program, { tvMazeId: feedMap[program.id] || program.tvMazeId });
        for (const episode of feed.episodes || []) {
          const record = normalizeEpisode(program, feed, episode);
          if (record) records.push(record);
        }
      } catch (error) {
        console.warn(error);
      } finally {
        completed += 1;
        onProgress(completed, feeds.length, program);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(3, feeds.length) }, worker));
  return records.sort((a, b) => a.date.localeCompare(b.date));
}

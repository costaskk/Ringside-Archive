const memory = new Map();
const stripHtml = value => String(value || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

export async function loadTvMazeFeed(program, { forceLive = false } = {}) {
  if (!program?.tvMazeId) throw new Error('This programme has no mapped exact episode feed.');
  if (!forceLive && memory.has(program.id)) return memory.get(program.id);
  let payload = null;
  if (!forceLive) {
    try {
      const response = await fetch(`./data/tvmaze/${encodeURIComponent(program.id)}.json`, { cache: 'no-cache' });
      if (response.ok) payload = await response.json();
    } catch {}
  }
  if (!payload) {
    const [showResponse, episodeResponse] = await Promise.all([
      fetch(`https://api.tvmaze.com/shows/${program.tvMazeId}`),
      fetch(`https://api.tvmaze.com/shows/${program.tvMazeId}/episodes?specials=1`)
    ]);
    if (!showResponse.ok || !episodeResponse.ok) throw new Error(`TVMaze feed failed for ${program.name}.`);
    payload = { programId: program.id, fetchedAt: new Date().toISOString(), show: await showResponse.json(), episodes: await episodeResponse.json() };
  }
  memory.set(program.id, payload);
  return payload;
}

export function normalizeEpisode(program, feed, episode) {
  if (!episode?.airdate) return null;
  const eventLike = program.kind === 'ppv' || program.kind === 'supercard';
  return {
    id: `tvmaze:${episode.id}`,
    itemKey: `episode:${program.id}:${episode.season}:${episode.number ?? 0}`,
    promotionId: program.promotionId,
    programId: program.id,
    title: episode.name || 'Untitled episode',
    date: episode.airdate,
    kind: eventLike ? program.kind : 'episode',
    code: eventLike ? '' : `S${String(episode.season || 0).padStart(2,'0')}E${String(episode.number ?? 0).padStart(2,'0')}`,
    description: stripHtml(episode.summary) || `${program.name} episode aired ${episode.airdate}.`,
    artwork: episode.image?.original || episode.image?.medium || feed.show?.image?.original || feed.show?.image?.medium || '',
    sourceUrl: episode.url || feed.show?.url || '',
    sourceLabel: 'TVMaze exact episode feed',
    runtime: episode.runtime || null
  };
}

export async function loadPromotionEpisodes(programmes, promotionId, onProgress = () => {}) {
  const feeds = programmes.filter(p => p.promotionId === promotionId && p.tvMazeId);
  const records = [];
  let completed = 0;
  const queue = [...feeds];
  const worker = async () => {
    while (queue.length) {
      const program = queue.shift();
      try {
        const feed = await loadTvMazeFeed(program);
        for (const episode of feed.episodes || []) {
          const record = normalizeEpisode(program, feed, episode);
          if (record) records.push(record);
        }
      } catch (error) {
        console.warn(error);
      } finally {
        completed += 1; onProgress(completed, feeds.length, program);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, feeds.length) }, worker));
  return records.sort((a,b) => a.date.localeCompare(b.date));
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const programmes = JSON.parse(await fs.readFile(path.join(root, 'data/programmes.json'), 'utf8'));
const discovery = await fs.readFile(path.join(root, 'data/tvmaze-discovery.json'), 'utf8').then(JSON.parse).catch(() => ({ candidates: [] }));
const discovered = new Map((discovery.candidates || []).filter(item => item.approved === true).map(item => [item.programId, item.tvMazeId]));
const feeds = programmes.filter(programme => programme.tvMazeId || discovered.has(programme.id)).map(programme => ({
  ...programme,
  resolvedTvMazeId: programme.tvMazeId || discovered.get(programme.id)
}));
const target = path.join(root, 'data/tvmaze');
await fs.mkdir(target, { recursive: true });

const index = [];
const failures = [];
const queue = feeds.map((programme, position) => ({ programme, position }));
let completed = 0;

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function syncOne(programme, position) {
  console.log(`[${position + 1}/${feeds.length}] ${programme.name}`);
  try {
    const [show, episodes] = await Promise.all([
      fetchJson(`https://api.tvmaze.com/shows/${programme.resolvedTvMazeId}`),
      fetchJson(`https://api.tvmaze.com/shows/${programme.resolvedTvMazeId}/episodes?specials=1`)
    ]);
    const payload = {
      programId: programme.id,
      tvMazeId: programme.resolvedTvMazeId,
      fetchedAt: new Date().toISOString(),
      show,
      episodes
    };
    await fs.writeFile(path.join(target, `${programme.id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    index.push({
      programId: programme.id,
      tvMazeId: programme.resolvedTvMazeId,
      episodes: episodes.length,
      fetchedAt: payload.fetchedAt,
      showArtwork: show?.image?.original || show?.image?.medium || null
    });
  } catch (error) {
    failures.push({ programId: programme.id, tvMazeId: programme.resolvedTvMazeId, error: error.message });
    console.warn(`Skipped ${programme.id}: ${error.message}`);
  } finally {
    completed += 1;
  }
}

async function worker() {
  while (queue.length) {
    const next = queue.shift();
    await syncOne(next.programme, next.position);
    await new Promise(resolve => setTimeout(resolve, 350));
  }
}

await Promise.all(Array.from({ length: Math.min(3, feeds.length) }, () => worker()));
index.sort((a, b) => a.programId.localeCompare(b.programId));
await fs.writeFile(path.join(target, 'index.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  feeds: index,
  failures
}, null, 2)}\n`);
console.log(`Saved ${index.length} feeds with ${index.reduce((sum, item) => sum + item.episodes, 0)} episodes. ${failures.length} failures.`);
if (!index.length && failures.length) process.exitCode = 1;

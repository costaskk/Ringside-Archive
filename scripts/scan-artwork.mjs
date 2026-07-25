import fs from 'node:fs/promises';
import { lookup } from '../api/artwork/search.js';

const root = new URL('../', import.meta.url);
const token = String(process.env.TMDB_READ_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
const args = new Set(process.argv.slice(2));
const includeEpisodes = args.has('--episodes');
const wikipediaOnly = args.has('--wikipedia-only');
const refresh = args.has('--refresh');
const limitArg = process.argv.find(value => value.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const effectiveToken = wikipediaOnly ? '' : token;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const [programmes, promotions, events, current] = await Promise.all([
  fs.readFile(new URL('data/programmes.json', root), 'utf8').then(JSON.parse),
  fs.readFile(new URL('data/promotions.json', root), 'utf8').then(JSON.parse),
  fs.readFile(new URL('data/major-events.json', root), 'utf8').then(JSON.parse),
  fs.readFile(new URL('data/artwork-catalog.json', root), 'utf8').then(JSON.parse)
]);
const programmeMap = new Map(programmes.map(item => [item.id, item]));
const promotionMap = new Map(promotions.map(item => [item.id, item]));

function accepted(result) {
  return result && !result.error && Number(result.confidence || 0) >= 80
    && Boolean(result.poster || result.backdrop || result.still || result.logo || result.headshot);
}
function compact(result) {
  const allowed = ['source','sourceUrl','attribution','confidence','matchReason','mediaType','tmdbId','tvMazeId','pageId','poster','backdrop','still','logo','headshot','seasons'];
  return Object.fromEntries(allowed.filter(key => result[key] !== undefined && result[key] !== '').map(key => [key, result[key]]));
}
function contextFor(item, programme = null) {
  const promotion = promotionMap.get(item.promotionId || programme?.promotionId);
  return {
    promotionName: promotion?.name || '',
    promotionShortName: promotion?.shortName || '',
    programmeTitle: programme?.name || '',
    tvMazeId: item.tvMazeId || programme?.tvMazeId || null
  };
}

current.programmes ||= {};
current.records ||= {};
current.episodes ||= {};
let processed = 0, found = 0, rejected = 0;

for (const programme of programmes) {
  if (processed >= limit) break;
  if (!refresh && Number(current.programmes[programme.id]?.confidence || 0) >= 80) continue;
  try {
    const result = await lookup({
      key: `program:${programme.id}`,
      id: programme.id,
      title: programme.name,
      aliases: programme.aliases || [],
      year: Number(String(programme.firstAirDate || '').slice(0, 4)) || null,
      kind: programme.kind,
      ...contextFor(programme, programme)
    }, effectiveToken);
    if (accepted(result)) {
      current.programmes[programme.id] = compact(result); found++;
      console.log(`Programme [${result.source}, ${result.confidence}%]: ${programme.name}`);
    } else {
      delete current.programmes[programme.id]; rejected++;
      console.warn(`Programme rejected: ${programme.name}: ${result?.error || 'low confidence'}`);
    }
  } catch (error) {
    console.warn(`Programme skipped: ${programme.name}: ${error.message}`);
  }
  processed++;
  await sleep(effectiveToken ? 240 : 160);
}

for (const event of events) {
  if (processed >= limit) break;
  if (!refresh && Number(current.records[event.id]?.confidence || 0) >= 80) continue;
  const programme = programmeMap.get(event.programId);
  try {
    const result = await lookup({
      key: event.id,
      id: event.id,
      title: event.title,
      aliases: event.aliases || [],
      year: Number(String(event.date || '').slice(0, 4)) || null,
      kind: event.kind || programme?.kind || 'supercard',
      ...contextFor(event, programme)
    }, effectiveToken);
    if (accepted(result)) {
      current.records[event.id] = compact(result); found++;
      console.log(`Event [${result.source}, ${result.confidence}%]: ${event.title} (${String(event.date).slice(0, 4)})`);
    } else {
      delete current.records[event.id]; rejected++;
    }
  } catch (error) {
    console.warn(`Event skipped: ${event.id}: ${error.message}`);
  }
  processed++;
  await sleep(effectiveToken ? 240 : 160);
}

if (includeEpisodes) {
  const files = (await fs.readdir(new URL('data/tvmaze/', root))).filter(name => name.endsWith('.json') && name !== 'index.json');
  for (const file of files) {
    const feed = JSON.parse(await fs.readFile(new URL(`data/tvmaze/${file}`, root), 'utf8'));
    const programme = programmeMap.get(feed.programId);
    if (!programme) continue;
    for (const episode of feed.episodes || []) {
      if (processed >= limit) break;
      const key = `${programme.id}:${episode.season}:${episode.number ?? 0}`;
      if (!refresh && Number(current.episodes[key]?.confidence || 0) >= 80) continue;
      const existingStill = episode.image?.original || episode.image?.medium || '';
      if (existingStill) {
        current.episodes[key] = {
          source: 'TVMaze', sourceUrl: episode.url || feed.show?.url || '', still: existingStill,
          confidence: 100, matchReason: 'Exact TVMaze snapshot episode image'
        };
        found++; processed++; continue;
      }
      try {
        const result = await lookup({
          key, title: episode.name || `${programme.name} episode`, programmeTitle: programme.name,
          year: Number(String(episode.airdate || '').slice(0, 4)) || null, kind: 'episode',
          season: episode.season, episode: episode.number, ...contextFor(programme, programme)
        }, effectiveToken);
        if (accepted(result) && result.still) { current.episodes[key] = compact(result); found++; }
        else { delete current.episodes[key]; rejected++; }
      } catch {}
      processed++;
      await sleep(effectiveToken ? 240 : 160);
    }
  }
}

current.generatedAt = new Date().toISOString();
current.generatedWith = effectiveToken ? 'Strict TVMaze/TMDB/Wikipedia/Wikimedia matcher v5.6' : 'Strict TVMaze/Wikipedia/Wikimedia matcher v5.6';
current.minimumConfidence = 80;
await fs.writeFile(new URL('data/artwork-catalog.json', root), `${JSON.stringify(current, null, 2)}\n`);
console.log(`Artwork catalogue updated: ${found} accepted, ${rejected} rejected, ${processed} processed.`);

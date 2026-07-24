import fs from 'node:fs';
import { buildPlexMatches } from '../src/integrations.js';

const root = new URL('../', import.meta.url);
const data = {
  programmes: JSON.parse(fs.readFileSync(new URL('data/programmes.json', root), 'utf8')),
  majorEvents: JSON.parse(fs.readFileSync(new URL('data/major-events.json', root), 'utf8'))
};
const sample = [
  { title: 'WWE Raw - S01E01 - January 11 1993.mkv', grandparentTitle: 'WWE Raw', type: 'episode', parentIndex: 1, index: 1, ratingKey: '1', library: 'Wrestling' },
  { title: 'AEW Double or Nothing 2019 1080p HEVC.mkv', year: 2019, type: 'movie', ratingKey: '2', library: 'Wrestling PPV' }
];
const result = buildPlexMatches(data, sample);
if (![...result.matches].some(key => key.startsWith('episode:wwe-raw:1:1'))) throw new Error('Exact WWE Raw episode did not match.');
if (![...result.matches].some(key => key.includes('aew-2019-05-25-double-or-nothing'))) throw new Error('AEW Double or Nothing event did not match.');
console.log(`Plex match smoke passed: ${result.matches.size} keys from ${result.diagnostics.matchedItems} matched items.`);

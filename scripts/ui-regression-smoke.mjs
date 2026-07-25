import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeExactRows } from '../src/record-merge.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
const supplement=JSON.parse(fs.readFileSync(path.join(root,'data/plex-supplement.json'),'utf8'));

const plexEpisode=supplement.records.find(row=>row.programId==='wwf-mania'&&row.code==='S01E01');
if(!plexEpisode)throw new Error('WWF Mania S01E01 is missing from the Plex supplement fixture.');

const tvMazeEpisode={
  id:'tvmaze:synthetic-wwf-mania-1',
  itemKey:'episode:wwf-mania:1:1',
  programId:'wwf-mania',promotionId:'wwe',kind:'episode',season:1,number:1,code:'S01E01',
  title:'Episode 1',date:'1993-01-09',runtime:60,artwork:'https://static.tvmaze.com/example.jpg',
  description:'WWF Mania episode aired 1993-01-09.',sourceLabel:'TVMaze exact episode feed'
};
const priority=row=>String(row.id||'').startsWith('plex-supplement-')?90:String(row.id||'').startsWith('tvmaze:')?80:60;
const merged=mergeExactRows([plexEpisode,tvMazeEpisode],{priority});
if(merged.length!==1)throw new Error(`Episode deduplication failed: expected 1 row, received ${merged.length}.`);
if(merged[0].title!==plexEpisode.title)throw new Error('Episode deduplication did not preserve the owner-library title.');
if(merged[0].artwork!==tvMazeEpisode.artwork)throw new Error('Episode deduplication did not merge the live-feed still artwork.');
if(!Array.isArray(merged[0]._mergedIds)||merged[0]._mergedIds.length!==2)throw new Error('Merged episode provenance was not retained.');

for(const marker of [
  'function programmeEpisodes(programId)',
  '...state.plexSupplementRecords.filter(item=>item?.programId===programId)',
  'const company=promotion(p.promotionId),loaded=programmeEpisodes(p.id)',
  'function renderResultsOnly({preserveScroll=true}={})',
  'document.activeElement?.id===\'searchInput\'',
  'state.searchRenderTimer=setTimeout(()=>renderResultsOnly',
  "const priority=['detailArtwork','heroArtwork'].includes(context)",
  "image.fetchPriority='high'"
])if(!app.includes(marker))throw new Error(`UI regression marker missing: ${marker}`);

console.log('UI regression smoke passed: programme supplements render immediately, duplicate feed rows merge, active search stays mounted, and modal artwork is primed eagerly.');

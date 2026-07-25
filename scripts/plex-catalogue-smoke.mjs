import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFile(path.join(root,'data',name),'utf8').then(JSON.parse);
const [promotions,programmes,events,map,supplement,report]=await Promise.all([
  read('promotions.json'),read('programmes.json'),read('major-events.json'),read('plex-title-map.json'),read('plex-supplement.json'),read('plex-import-report.json')
]);
if(promotions.length!==104)throw new Error(`Expected 104 promotions after Plex catalogue import, found ${promotions.length}.`);
if(programmes.length!==504)throw new Error(`Expected 504 programme families, found ${programmes.length}.`);
if(events.length!==1904)throw new Error(`Expected 1,891 dated major events, found ${events.length}.`);
if(Object.keys(map.shows||{}).length!==69)throw new Error('The Plex title map must cover all 69 exported show titles.');
if((supplement.records||[]).length!==6572)throw new Error('The Plex exact-episode supplement count is stale.');
if((report.unmappedMovieRows||[]).length)throw new Error(`Unmapped Plex movie records remain: ${JSON.stringify(report.unmappedMovieRows.slice(0,3))}`);
for(const id of ['gwf-dallas','xwf','maple-leaf-pro'])if(!promotions.some(row=>row.id===id))throw new Error(`Missing Plex-discovered promotion: ${id}`);
for(const id of ['jcp','wcw','nwa-historic']){
  const programmeCount=programmes.filter(row=>row.promotionId===id).length;
  const eventCount=events.filter(row=>row.promotionId===id).length+(supplement.records||[]).filter(row=>row.promotionId===id).length;
  if(!programmeCount||!eventCount)throw new Error(`${id} must have independently assigned programmes and dated records.`);
}
const worldwide=map.shows?.['World Wide Wrestling']||[];
if(!worldwide.some(row=>row.programId==='jcp-worldwide'&&row.before==='1988-11-27')||!worldwide.some(row=>row.programId==='wcw-worldwide'&&row.from==='1988-11-27'))throw new Error('World Wide Wrestling must split JCP and WCW at the Turner acquisition date.');
const worldChamp=map.shows?.['World Championship Wrestling']||[];
if(!worldChamp.some(row=>row.programId==='jcp-world-championship-wrestling-tbs')||!worldChamp.some(row=>row.programId==='wcw-saturday-night'))throw new Error('World Championship Wrestling lineage split is missing.');
if(!events.some(row=>row.date==='2000-08-13'&&/New Blood Rising/i.test(row.title)&&row.promotionId==='wcw'))throw new Error('WCW New Blood Rising was not imported.');
console.log(`Plex catalogue smoke passed: ${promotions.length} promotions, ${programmes.length} families, ${events.length} major events and ${supplement.records.length} exact supplement episodes.`);

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=await fs.readFile(path.join(root,'src/app.js'),'utf8');
const sw=await fs.readFile(path.join(root,'service-worker.js'),'utf8');
const core=JSON.parse(await fs.readFile(path.join(root,'data/core.json'),'utf8'));
const recommendations=JSON.parse(await fs.readFile(path.join(root,'data/recommendations.json'),'utf8'));

for(const marker of ['CORE_DATA_FILES','DEFERRED_DATA_FILES','loadDeferredData','onIdle(()=>loadAllEpisodes(false),1800)','Math.min(2,feeds.length)','recordCache','captureViewportState','restoreViewportState','visualStateSignature','renderViewOnly','patchArtworkElements','runButtonTask']){
  if(!app.includes(marker))throw new Error(`Performance marker missing: ${marker}`);
}
if(!app.includes('visible: 24'))throw new Error('Initial bounded rendering must remain at 24 cards.');
if(!app.includes('traktDeviceMarkup')||!app.includes('state.traktDevice={'))throw new Error('Persistent Trakt device-code state is missing.');
if(!app.includes('topMatchesForProfile')||!app.includes('showsForProfile'))throw new Error('Wrestler Top 10/programme profile features are missing.');
if(!sw.includes("url.pathname.startsWith('/data/')")||!sw.includes('staleWhileRevalidate'))throw new Error('Release-data repeat-visit caching is missing.');
if(core.majorEvents?.length!==1144||core.programmes?.length!==294)throw new Error('data/core.json is missing the cleaned current catalogue.');
if(core.programmes.some(row=>/master index/i.test(row.name||'')))throw new Error('Synthetic promotion Master Index rows must not remain in programme data.');
if(/location\.reload\?\.\(\)/.test(app))throw new Error('The application must not force-reload when a service worker changes controller.');
if(recommendations.length!==71||recommendations.some(row=>!(Number(row.archiveStars)>0&&Number(row.archiveStars)<=5)))throw new Error('Every curated recommendation must carry a 0–5 Archive editorial rating.');
const artworkScan=app.match(/async function scanVisibleArtwork\(\)[\s\S]*?\n}\n+const SCROLL_SESSION_KEY/)?.[0]||'';
if(/\brender\s*\(/.test(artworkScan))throw new Error('Visible artwork scanning still triggers a whole-page render.');
console.log(`Performance smoke passed: deferred boot, bounded rendering, incremental async actions, persistent Trakt code, ${recommendations.length} rated recommendations and cached release data validated.`);

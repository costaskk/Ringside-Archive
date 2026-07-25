import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const storage=await fs.readFile(path.join(root,'src/storage.js'),'utf8');
const app=await fs.readFile(path.join(root,'src/app.js'),'utf8');
const styles=await fs.readFile(path.join(root,'src/styles.css'),'utf8');

for(const marker of ['runButtonTask','runBackgroundTask','renderTaskDock','renderViewOnly','renderModalOnly','patchArtworkElements','setOperationMessage','specificFreeLinkFor','isSpecificFreeUrl']){
  if(!app.includes(marker))throw new Error(`Async UI marker missing: ${marker}`);
}
for(const marker of ['.buttonSpinner','.asyncTaskDock','button.isLoading','.freeWatchLink','.lightboxPanel','[data-lightbox]']){
  if(!styles.includes(marker))throw new Error(`Async UI style missing: ${marker}`);
}
if(app.includes('function youtubeUrlFor'))throw new Error('Legacy generic YouTube-link resolver must not remain.');
if(/Watch\/search/i.test(app))throw new Error('Generic YouTube search links must not be shown as record links.');
const scanBlock=app.match(/async function scanVisibleArtwork\(\)[\s\S]*?\n}\n+const SCROLL_SESSION_KEY/)?.[0]||'';
if(!scanBlock)throw new Error('scanVisibleArtwork function was not found.');
if(/\brender\s*\(/.test(scanBlock))throw new Error('Artwork scanning must patch visible artwork instead of rebuilding the page.');
if(!scanBlock.includes('patchArtworkElements')||!scanBlock.includes('updateTask'))throw new Error('Artwork scanning lacks incremental DOM/progress updates.');
const artworkKeyBlock=app.match(/async function scanArtworkKey\(key\)[\s\S]*?\n}\nasync function installServiceWorker/)?.[0]||'';
if(/\brender\s*\(/.test(artworkKeyBlock))throw new Error('Single artwork scans must not rebuild the full page.');
if(!app.includes("const version='5.8.1'"))throw new Error('Service worker registration is not versioned for 5.8.1.');

for(const marker of ["ringside-artwork-v2","Number(row.result.confidence||100)>=80","Wrong image","Open in Plex LAN","saved to Cloudflare R2","bindLightboxes"]){
  const haystack=marker==='ringside-artwork-v2'?storage:app;
  if(!haystack.includes(marker))throw new Error(`v5.8 artwork/Plex marker missing: ${marker}`);
}
if(app.includes('...companyArtworkCandidates(item.promotionId)'))throw new Error('Company logos must not be used as generic record artwork.');

console.log('Async UI smoke passed: button-level progress, incremental artwork patches and exact-link policy validated.');

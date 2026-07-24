import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const required=[
  'index.html','manifest.webmanifest','favicon.svg','service-worker.js','vercel.json','.env.example',
  'src/app.js','src/styles.css','src/storage.js','src/tvmaze.js','src/utils.js','src/records.js','src/integrations.js','src/cloud.js',
  'data/promotions.json','data/programmes.json','data/major-events.json','data/recommendations.json','data/wrestlers.json','data/format-labels.json','data/artwork-overrides.json','data/artwork-catalog.json','data/event-details.json','data/custom-records.json','data/meta.json',
  'api/trakt/device.js','api/trakt/history.js','api/trakt/sync.js','api/trakt/refresh.js','api/plex/pin.js','api/plex/resources.js','api/plex/library.js','api/plex/view-state.js','api/plex/image.js','api/account/integrations.js','api/_lib/account.js','api/_lib/crypto.js','api/_lib/providers.js','api/artwork/search.js','supabase/schema.sql',
  'tools/export-plex-library.ps1','scripts/runtime-smoke.mjs','scripts/cloud-smoke.mjs','scripts/sync-tvmaze.mjs','scripts/discover-tvmaze.mjs','scripts/scan-artwork.mjs','scripts/enrich-event-details.mjs'
];
for(const file of required){try{await fs.access(path.join(root,file));}catch{throw new Error(`Missing required file: ${file}`);}}

async function listApiRoutes(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const routes = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_')) continue;
      routes.push(...await listApiRoutes(absolute, relative));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('_')) {
      routes.push(relative);
    }
  }
  return routes;
}
const apiRoutes = await listApiRoutes(path.join(root, 'api'));
if (apiRoutes.length > 12) throw new Error(`Vercel Hobby supports at most 12 functions; found ${apiRoutes.length}: ${apiRoutes.join(', ')}`);

const html=await fs.readFile(path.join(root,'index.html'),'utf8');
for(const ref of ['./src/app.js','./src/styles.css','./manifest.webmanifest','./favicon.svg'])if(!html.includes(ref))throw new Error(`index.html is missing ${ref}`);
const app=await fs.readFile(path.join(root,'src/app.js'),'utf8');
for(const ref of ['./storage.js','./tvmaze.js','./utils.js','./records.js','./integrations.js','./cloud.js'])if(!app.includes(ref))throw new Error(`app.js is missing import ${ref}`);
const jsonFiles=required.filter(x=>x.endsWith('.json')||x.endsWith('.webmanifest')||x.endsWith('vercel.json'));
for(const file of jsonFiles)JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const jsFiles=required.filter(x=>x.endsWith('.js'));
for(const file of jsFiles){const source=await fs.readFile(path.join(root,file),'utf8');if(!source.trim())throw new Error(`Empty JavaScript file: ${file}`);}
console.log(`Smoke test passed: ${required.length} required files, ${jsonFiles.length} JSON files and ${apiRoutes.length} Vercel functions validated.`);

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const required=[
  'index.html','manifest.webmanifest','favicon.svg','service-worker.js','vercel.json',
  'src/app.js','src/styles.css','src/storage.js','src/tvmaze.js','src/utils.js',
  'data/promotions.json','data/programmes.json','data/major-events.json','data/recommendations.json',
  'data/wrestlers.json','data/format-labels.json','data/artwork-overrides.json','data/custom-records.json','data/meta.json'
];
for(const file of required){try{await fs.access(path.join(root,file));}catch{throw new Error(`Missing required file: ${file}`);}}
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
for(const ref of ['./src/app.js','./src/styles.css','./manifest.webmanifest','./favicon.svg'])if(!html.includes(ref))throw new Error(`index.html is missing ${ref}`);
const app=await fs.readFile(path.join(root,'src/app.js'),'utf8');
for(const ref of ['./storage.js','./tvmaze.js','./utils.js'])if(!app.includes(ref))throw new Error(`app.js is missing import ${ref}`);
const jsonFiles=required.filter(x=>x.endsWith('.json')||x.endsWith('.webmanifest')||x.endsWith('vercel.json'));
for(const file of jsonFiles)JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
console.log(`Smoke test passed: ${required.length} required files and ${jsonFiles.length} JSON files validated.`);

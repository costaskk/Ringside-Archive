import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files={
  promotions:'promotions.json',programmes:'programmes.json',majorEvents:'major-events.json',
  recommendations:'recommendations.json',wrestlers:'wrestlers.json',formatLabels:'format-labels.json',
  customRecords:'custom-records.json',freeLinks:'free-links.json',meta:'meta.json'
};
const core={};
for(const [key,file] of Object.entries(files))core[key]=JSON.parse(await fs.readFile(path.join(root,'data',file),'utf8'));
await fs.writeFile(path.join(root,'data','core.json'),JSON.stringify(core));
console.log(`Built data/core.json (${(await fs.stat(path.join(root,'data','core.json'))).size.toLocaleString()} bytes).`);

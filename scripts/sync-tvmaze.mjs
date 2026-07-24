import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const programmes=JSON.parse(await fs.readFile(path.join(root,'data/programmes.json'),'utf8'));
const feeds=programmes.filter(p=>p.tvMazeId);
await fs.mkdir(path.join(root,'data/tvmaze'),{recursive:true});
const index=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<feeds.length;i++){
  const p=feeds[i];console.log(`[${i+1}/${feeds.length}] ${p.name}`);
  const [showRes,episodesRes]=await Promise.all([fetch(`https://api.tvmaze.com/shows/${p.tvMazeId}`),fetch(`https://api.tvmaze.com/shows/${p.tvMazeId}/episodes?specials=1`)]);
  if(!showRes.ok||!episodesRes.ok){console.warn(`Skipped ${p.id}: ${showRes.status}/${episodesRes.status}`);continue;}
  const payload={programId:p.id,tvMazeId:p.tvMazeId,fetchedAt:new Date().toISOString(),show:await showRes.json(),episodes:await episodesRes.json()};
  await fs.writeFile(path.join(root,'data/tvmaze',`${p.id}.json`),JSON.stringify(payload,null,2)+'\n');
  index.push({programId:p.id,tvMazeId:p.tvMazeId,episodes:payload.episodes.length,fetchedAt:payload.fetchedAt});
  await sleep(300);
}
await fs.writeFile(path.join(root,'data/tvmaze/index.json'),JSON.stringify(index,null,2)+'\n');
console.log(`Saved ${index.length} feeds with ${index.reduce((n,x)=>n+x.episodes,0)} episodes.`);

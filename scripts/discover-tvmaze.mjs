import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const programmes=JSON.parse(await fs.readFile(new URL('data/programmes.json',root),'utf8'));
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(?:wwe|wwf|wwwf|wcw|nwa|aew|tna|impact)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const candidates=[];
for(const [index,program] of programmes.filter(p=>!p.tvMazeId&&['weekly','territory-tv','studio','streaming'].includes(p.kind)).entries()){
  console.log(`[${index+1}] ${program.name}`);
  let exact=null;
  for(const query of [program.name,...(program.aliases||[])].slice(0,4)){
    try{
      const response=await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
      if(!response.ok)continue;
      const results=await response.json();
      const match=results.find(row=>normalize(row.show?.name)===normalize(query));
      if(match){exact={programId:program.id,programme:program.name,tvMazeId:match.show.id,tvMazeName:match.show.name,premiered:match.show.premiered,url:match.show.url,matchedBy:query,confidence:'exact-title'};break;}
    }catch(error){console.warn(error.message);}
    await sleep(550);
  }
  if(exact)candidates.push(exact);
  await sleep(550);
}
await fs.writeFile(new URL('data/tvmaze-discovery.json',root),JSON.stringify({generatedAt:new Date().toISOString(),candidates},null,2)+'\n');
console.log(`Saved ${candidates.length} exact-title candidates. Review before copying IDs into programmes.json.`);

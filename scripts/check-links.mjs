import fs from 'node:fs/promises';
const files=['promotions','programmes','major-events','recommendations'];
const urls=new Set();
for(const name of files){const data=JSON.parse(await fs.readFile(new URL(`../data/${name}.json`,import.meta.url),'utf8'));for(const item of data)for(const [key,value] of Object.entries(item))if(/Url$/.test(key)&&typeof value==='string')urls.add(value);}
let failed=0;for(const url of urls){try{const res=await fetch(url,{method:'HEAD',redirect:'follow',headers:{'user-agent':'RingsideArchiveLinkAudit/1.0'}});if(!res.ok&&res.status!==405){console.log(res.status,url);failed++;}}catch{console.log('ERR',url);failed++;}}
console.log(`${urls.size} URLs checked; ${failed} need review.`);

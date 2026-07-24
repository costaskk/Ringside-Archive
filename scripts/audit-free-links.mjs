import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const links=JSON.parse(await fs.readFile(path.join(root,'data/free-links.json'),'utf8'));
const recommendations=JSON.parse(await fs.readFile(path.join(root,'data/recommendations.json'),'utf8'));
const programmes=JSON.parse(await fs.readFile(path.join(root,'data/programmes.json'),'utf8'));
const events=JSON.parse(await fs.readFile(path.join(root,'data/major-events.json'),'utf8'));
const recommendationIds=new Set(recommendations.map(row=>row.id));
const programmeIds=new Set(programmes.map(row=>row.id));
const eventIds=new Set(events.map(row=>row.id));

function specific(value){
  const url=typeof value==='string'?value:value?.url;
  if(!url)return false;
  let parsed;
  try{parsed=new URL(url);}catch{return false;}
  const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
  const pathname=parsed.pathname.replace(/\/+$/,'')||'/';
  if(host==='youtu.be')return pathname.length>2;
  if(host==='youtube.com'||host==='m.youtube.com'){
    if(pathname==='/watch')return Boolean(parsed.searchParams.get('v'));
    if(pathname==='/playlist')return Boolean(parsed.searchParams.get('list'));
    return /^\/(live|shorts)\/[^/]+/.test(pathname);
  }
  if(host==='archive.org')return /^\/details\/[^/]+/.test(pathname);
  if(host==='dailymotion.com'||host==='dai.ly')return pathname!=='/'&&/\/(video\/)?[^/]+/.test(pathname);
  if(host==='vimeo.com')return /^\/\d+/.test(pathname);
  if(host==='vk.com')return /^\/video[-\d_]+/.test(pathname)||parsed.searchParams.has('z');
  if(host.endsWith('twitch.tv'))return /^\/videos\/\d+/.test(pathname);
  if(pathname==='/'||/\/(search|results|channel|channels|user|users|category|categories)\/?$/i.test(pathname))return false;
  return pathname.split('/').filter(Boolean).length>=2;
}

const errors=[];
for(const [group,entries] of Object.entries({records:links.records||{},programmes:links.programmes||{},recommendations:links.recommendations||{}})){
  const allowed=group==='records'?eventIds:group==='programmes'?programmeIds:recommendationIds;
  for(const [id,entry] of Object.entries(entries)){
    if(!allowed.has(id))errors.push(`${group}.${id} does not reference an existing catalogue record.`);
    if(!specific(entry))errors.push(`${group}.${id} is not a record-specific free-viewing URL: ${entry?.url||entry}`);
    if(!entry.label)errors.push(`${group}.${id} is missing a user-facing label.`);
    if(!entry.publisher&&!entry.service)errors.push(`${group}.${id} is missing source attribution.`);
  }
}
for(const row of [...recommendations,...programmes,...events]){
  for(const field of ['watchUrl','freeUrl'])if(row[field]&&!specific(row[field]))errors.push(`${row.id}.${field} contains a generic or search URL.`);
}
const count=Object.values(links.records||{}).length+Object.values(links.programmes||{}).length+Object.values(links.recommendations||{}).length;
if(count<8)errors.push(`Expected at least 8 verified record-specific links, found ${count}.`);
if(errors.length)throw new Error(`Free-link audit failed:\n- ${errors.join('\n- ')}`);
console.log(`Free-link audit passed: ${count} exact video/event links; channel and search URLs rejected.`);

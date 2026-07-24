import { resolvePlexCredentials, persistPlex } from '../_lib/providers.js';
import { bodyOf, sendError } from '../_lib/http.js';
import { publicIntegration } from '../_lib/account.js';

const PRODUCT='Ringside Archive';
function allowedUri(value){try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname.endsWith('.plex.direct')||url.hostname.endsWith('.plex.services'));}catch{return false;}}
async function plexFetch(url,headers){const response=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Plex returned ${response.status} for ${new URL(url).pathname}.`);return response.json();}
function imageUrl(base,key,token){if(!key)return '';return `${base}${key}${key.includes('?')?'&':'?'}X-Plex-Token=${encodeURIComponent(token)}`;}
function safeItem(entry,section,server,base,token,cloud){
  const item={
    title:entry.title,grandparentTitle:entry.grandparentTitle,parentTitle:entry.parentTitle,year:entry.year,type:entry.type,ratingKey:entry.ratingKey,
    index:entry.index,parentIndex:entry.parentIndex,library:section.title,duration:entry.duration,originallyAvailableAt:entry.originallyAvailableAt,
    addedAt:entry.addedAt,lastViewedAt:entry.lastViewedAt,viewCount:Number(entry.viewCount||0),viewOffset:Number(entry.viewOffset||0),
    userRating:entry.userRating,guid:entry.guid,guids:(entry.Guid||[]).map(x=>x.id),thumb:entry.thumb,art:entry.art,
    machineIdentifier:server.machineIdentifier,serverName:server.name
  };
  if(!cloud){item.thumbUrl=imageUrl(base,entry.thumb,token);item.artUrl=imageUrl(base,entry.art,token);}
  return item;
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const body=bodyOf(req),context=await resolvePlexCredentials(req,body),payload=context.payload;
    let server;
    if(context.cloud){const id=body.machineIdentifier||body.server?.machineIdentifier;server=(payload.servers||[]).find(x=>x.machineIdentifier===id)||payload.selectedServer;}
    else server=body.server;
    if(!server)return res.status(400).json({error:'Choose a Plex server first.'});
    const connection=(server.connections||[]).filter(x=>allowedUri(x.uri)).sort((a,b)=>Number(a.relay)-Number(b.relay))[0];
    if(!connection)return res.status(400).json({error:'This server has no remotely reachable HTTPS plex.direct connection. Use the local export tool instead.'});
    const base=connection.uri.replace(/\/$/,'');const serverToken=server.accessToken||payload.token;
    const headers={'Accept':'application/json','X-Plex-Token':serverToken,'X-Plex-Product':PRODUCT,'X-Plex-Version':'5.1.0','X-Plex-Client-Identifier':payload.clientId};
    const sectionsPayload=await plexFetch(`${base}/library/sections`,headers);const sections=sectionsPayload.MediaContainer?.Directory||[];const items=[];
    for(const section of sections){
      if(!['show','movie','video'].includes(section.type))continue;
      const type=section.type==='show'?4:1;let start=0,total=Infinity;
      while(start<total){
        const url=`${base}/library/sections/${encodeURIComponent(section.key)}/all?type=${type}&includeGuids=1&includeUserState=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=500`;
        const data=await plexFetch(url,headers);const media=data.MediaContainer||{},rows=media.Metadata||[];total=Number(media.totalSize??media.size??rows.length);
        for(const entry of rows)items.push(safeItem(entry,section,server,base,serverToken,context.cloud));
        if(!rows.length)break;start+=rows.length;
      }
    }
    const selectedServer={...server,uri:base};const scannedAt=new Date().toISOString();
    if(context.cloud){
      const entry=await persistPlex(context,{selectedServer,items,scannedAt});const safe=publicIntegration(entry);
      return res.status(200).json({server:safe.selectedServer,sections:sections.map(x=>({key:x.key,title:x.title,type:x.type})),items:safe.items,scannedAt,cloud:true});
    }
    return res.status(200).json({server:{name:server.name,machineIdentifier:server.machineIdentifier,uri:base},sections:sections.map(x=>({key:x.key,title:x.title,type:x.type})),items,scannedAt});
  }catch(error){return sendError(res,error.status||502,error,'Plex scan failed.');}
}

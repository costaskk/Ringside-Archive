import { resolvePlexCredentials } from '../_lib/providers.js';
import { bodyOf, sendError } from '../_lib/http.js';

const PRODUCT='Ringside Archive';
function allowedUri(value){try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname.endsWith('.plex.direct')||url.hostname.endsWith('.plex.services'));}catch{return false;}}
function candidates(server){
  const rows=[server?.activeConnection,server?.uri&&{uri:server.uri,selected:true},...(server?.connections||[])].filter(Boolean);
  const seen=new Set();
  return rows.filter(row=>allowedUri(row.uri)).filter(row=>!seen.has(row.uri)&&seen.add(row.uri)).sort((a,b)=>{
    const score=row=>(row.local?100:0)+(row.relay?25:0)+(row.selected?-10:0)+(row===server?.activeConnection?-20:0);
    return score(a)-score(b);
  });
}
async function tryUpdate(server,headers,ratingKey,endpoint){
  const errors=[];
  for(const connection of candidates(server)){
    const base=connection.uri.replace(/\/$/,'');
    const url=`${base}/:/${endpoint}?key=${encodeURIComponent(ratingKey)}&identifier=com.plexapp.plugins.library`;
    try{
      const response=await fetch(url,{method:'GET',headers,signal:AbortSignal.timeout(15000)});
      if(response.ok)return {base,connection};
      errors.push(`${base}: Plex returned ${response.status}`);
    }catch(error){errors.push(`${base}: ${error.message}`);}
  }
  const error=new Error('None of the selected Plex server connections accepted the viewing-state update.');
  error.status=502;error.details=errors;throw error;
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const body=bodyOf(req),context=await resolvePlexCredentials(req,body),payload=context.payload;
    const action=body.action;
    if(!['watched','unwatched'].includes(action))return res.status(400).json({error:'Plex action must be watched or unwatched.'});
    const ratingKey=String(body.ratingKey||'');if(!/^\d+$/.test(ratingKey))return res.status(400).json({error:'Invalid Plex rating key.'});
    const machineIdentifier=body.machineIdentifier||body.server?.machineIdentifier;
    const server=context.cloud?(payload.servers||[]).find(x=>x.machineIdentifier===machineIdentifier)||payload.selectedServer:body.server;
    if(!server)return res.status(400).json({error:'Plex server not found.'});
    const token=server.accessToken||payload.token;if(!token)return res.status(401).json({error:'Plex access token is unavailable.'});
    const headers={'Accept':'application/json','X-Plex-Token':token,'X-Plex-Product':PRODUCT,'X-Plex-Version':'5.5.0','X-Plex-Client-Identifier':payload.clientId};
    const endpoint=action==='watched'?'scrobble':'unscrobble';
    const updated=await tryUpdate(server,headers,ratingKey,endpoint);
    return res.status(200).json({updated:true,action,ratingKey,connection:updated.base,cloud:context.cloud});
  }catch(error){
    if(Array.isArray(error.details))return res.status(error.status||502).json({error:error.message,details:error.details});
    return sendError(res,error.status||502,error,'Unable to update Plex viewing state.');
  }
}

import { resolvePlexCredentials } from '../_lib/providers.js';
import { bodyOf, sendError } from '../_lib/http.js';

const PRODUCT='Ringside Archive';
function allowedUri(value){try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname.endsWith('.plex.direct')||url.hostname.endsWith('.plex.services'));}catch{return false;}}
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
    const connection=(server.connections||[]).filter(x=>allowedUri(x.uri)).sort((a,b)=>Number(a.relay)-Number(b.relay))[0];
    if(!connection)return res.status(400).json({error:'No remotely reachable Plex connection is available.'});
    const base=connection.uri.replace(/\/$/,'');const token=server.accessToken||payload.token;
    const endpoint=action==='watched'?'scrobble':'unscrobble';
    const url=`${base}/:/${endpoint}?key=${encodeURIComponent(ratingKey)}&identifier=com.plexapp.plugins.library`;
    const response=await fetch(url,{method:'GET',headers:{'Accept':'application/json','X-Plex-Token':token,'X-Plex-Product':PRODUCT,'X-Plex-Version':'5.1.0','X-Plex-Client-Identifier':payload.clientId},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Plex returned ${response.status} while updating viewing state.`);
    return res.status(200).json({updated:true,action,ratingKey,cloud:context.cloud});
  }catch(error){return sendError(res,error.status||502,error,'Unable to update Plex viewing state.');}
}

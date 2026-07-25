import { resolvePlexCredentials, persistPlex } from '../_lib/providers.js';
import { bodyOf, sendError } from '../_lib/http.js';
import { publicIntegration } from '../_lib/account.js';

const PRODUCT='Ringside Archive';
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try {
    const body=bodyOf(req),context=await resolvePlexCredentials(req,body);
    const {clientId,token}=context.payload;
    const headers={'Accept':'application/json','X-Plex-Token':token,'X-Plex-Product':PRODUCT,'X-Plex-Version':'5.8.0','X-Plex-Client-Identifier':clientId};
    const [accountResponse,resourcesResponse]=await Promise.all([
      fetch('https://plex.tv/api/v2/user',{headers,signal:AbortSignal.timeout(15000)}),
      fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=0',{headers,signal:AbortSignal.timeout(15000)})
    ]);
    if(!resourcesResponse.ok)return res.status(resourcesResponse.status).json({error:'Unable to load Plex resources.'});
    const resources=await resourcesResponse.json();const accountRaw=accountResponse.ok?await accountResponse.json():null;
    const account=accountRaw?{username:accountRaw.username,title:accountRaw.title,email:accountRaw.email,thumb:accountRaw.thumb}:null;
    const servers=(Array.isArray(resources)?resources:[]).filter(resource=>resource.provides?.includes('server')).map(resource=>({
      name:resource.name,machineIdentifier:resource.clientIdentifier||resource.machineIdentifier,owned:Boolean(resource.owned),accessToken:resource.accessToken||null,
      connections:(resource.connections||[]).map(connection=>({uri:connection.uri,local:Boolean(connection.local),relay:Boolean(connection.relay),protocol:connection.protocol,address:connection.address,port:connection.port})).filter(connection=>connection.uri)
    }));
    if(context.cloud){
      const entry=await persistPlex(context,{account,servers});
      const safe=publicIntegration(entry);
      return res.status(200).json({account:safe.account,servers:safe.servers,cloud:true});
    }
    return res.status(200).json({account,servers});
  } catch(error){return sendError(res,error.status||502,error,'Unable to load Plex servers.');}
}

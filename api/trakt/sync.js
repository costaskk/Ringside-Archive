import { resolveTraktSession } from '../_lib/providers.js';
import { bodyOf, sendError } from '../_lib/http.js';
import { traktClientId, traktHeaders, traktPayload, traktErrorMessage } from '../_lib/trakt.js';

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const clientId=traktClientId();
  if(!clientId)return res.status(503).json({error:'TRAKT_CLIENT_ID is not configured.'});
  try {
    const context=await resolveTraktSession(req);
    const {action='add',item}=bodyOf(req);
    if(!item||!['add','remove'].includes(action))return res.status(400).json({error:'Invalid Trakt sync request.'});
    const watchedAt=new Date().toISOString();
    let payload;
    if(item.kind==='episode'){
      const show={...(item.show||{})};
      if(action==='add')show.watched_at=watchedAt;
      show.seasons=[{number:Number(item.season),episodes:[{number:Number(item.episode),...(action==='add'?{watched_at:watchedAt}:{})}]}];
      payload={shows:[show]};
    }else if(item.kind==='movie'){
      const movie={...(item.movie||{}),...(action==='add'?{watched_at:watchedAt}:{})};
      payload={movies:[movie]};
    }else return res.status(400).json({error:'Unsupported Trakt media type.'});
    const endpoint=action==='remove'?'https://api.trakt.tv/sync/history/remove':'https://api.trakt.tv/sync/history';
    const response=await fetch(endpoint,{method:'POST',headers:traktHeaders({accessToken:context.session.accessToken,clientId}),body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
    const data=await traktPayload(response);
    if(!response.ok)return res.status(response.status).json({error:traktErrorMessage(response,data,'Trakt update failed.'),details:data,cloudflare:Boolean(data.cloudflare)});
    return res.status(200).json({...data,cloud:context.cloud});
  } catch(error){return sendError(res,error.status||502,error,'Trakt update failed.');}
}

import { resolveTraktSession } from '../_lib/providers.js';
import { bodyOf, sendError } from '../_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try {
    if(req.headers?.['x-ringside-account-token']){
      const context=await resolveTraktSession(req);
      return res.status(200).json({connected:true,cloud:true,expiresAt:context.session.expiresAt||null});
    }
    const clientId=process.env.TRAKT_CLIENT_ID,clientSecret=process.env.TRAKT_CLIENT_SECRET;
    if(!clientId||!clientSecret)return res.status(503).json({error:'Trakt environment variables are not configured.'});
    const {refresh_token}=bodyOf(req);
    if(!refresh_token)return res.status(400).json({error:'Missing Trakt refresh token.'});
    const response=await fetch('https://api.trakt.tv/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({refresh_token,client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token',redirect_uri:'urn:ietf:wg:oauth:2.0:oob'})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return res.status(response.status).json({error:data.error_description||data.error||`Trakt returned ${response.status}.`});
    return res.status(200).json({accessToken:data.access_token,refreshToken:data.refresh_token,createdAt:data.created_at,expiresIn:data.expires_in,expiresAt:(Number(data.created_at||Math.floor(Date.now()/1000))+Number(data.expires_in||0))*1000});
  } catch(error){return sendError(res,error.status||502,error,'Unable to refresh Trakt access.');}
}

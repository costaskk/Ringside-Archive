import { authenticateAccount, writeIntegration, publicIntegration } from '../_lib/account.js';
import { bodyOf, sendError } from '../_lib/http.js';

async function traktAccount(accessToken, clientId) {
  try {
    const response = await fetch('https://api.trakt.tv/users/settings', {
      headers: { Authorization: `Bearer ${accessToken}`, 'trakt-api-version': '2', 'trakt-api-key': clientId, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.user ? { username: data.user.username, name: data.user.name, ids: data.user.ids, vip: Boolean(data.user.vip) } : null;
  } catch { return null; }
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const clientId=process.env.TRAKT_CLIENT_ID,clientSecret=process.env.TRAKT_CLIENT_SECRET;
  if(!clientId||!clientSecret)return res.status(503).json({error:'Trakt environment variables are not configured.'});
  try {
    const body=bodyOf(req);
    const response=await fetch('https://api.trakt.tv/oauth/device/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:body.device_code,client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(15000)});
    if(response.status===400)return res.status(202).json({pending:true});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return res.status(response.status).json(data);
    const session={
      accessToken:data.access_token,refreshToken:data.refresh_token,createdAt:data.created_at,expiresIn:data.expires_in,
      expiresAt:(Number(data.created_at||Math.floor(Date.now()/1000))+Number(data.expires_in||0))*1000
    };
    session.account=await traktAccount(session.accessToken,clientId);
    const user=await authenticateAccount(req,{optional:true});
    if(user){
      const entry=await writeIntegration(user.id,'trakt',session,{account:session.account||null});
      return res.status(200).json({connected:true,cloud:true,integration:publicIntegration(entry)});
    }
    return res.status(200).json(session);
  } catch(error){return sendError(res,error.status||502,error,'Unable to exchange the Trakt device code.');}
}

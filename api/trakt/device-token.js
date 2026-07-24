export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const clientId=process.env.TRAKT_CLIENT_ID,clientSecret=process.env.TRAKT_CLIENT_SECRET;
  if(!clientId||!clientSecret)return res.status(503).json({error:'Trakt environment variables are not configured.'});
  const response=await fetch('https://api.trakt.tv/oauth/device/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:req.body?.device_code,client_id:clientId,client_secret:clientSecret})});
  if(response.status===400)return res.status(202).json({pending:true});
  const data=await response.json();
  if(!response.ok)return res.status(response.status).json(data);
  return res.status(200).json({accessToken:data.access_token,refreshToken:data.refresh_token,createdAt:data.created_at,expiresIn:data.expires_in});
}

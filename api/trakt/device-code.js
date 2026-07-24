export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const clientId=process.env.TRAKT_CLIENT_ID;if(!clientId)return res.status(503).json({error:'TRAKT_CLIENT_ID is not configured in Vercel.'});
  const response=await fetch('https://api.trakt.tv/oauth/device/code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:clientId})});
  const data=await response.json();return res.status(response.status).json(data);
}

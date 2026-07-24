export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const clientId=process.env.TRAKT_CLIENT_ID;
  if(!token||!clientId)return res.status(401).json({error:'Trakt connection is missing.'});
  const headers={Authorization:`Bearer ${token}`,'trakt-api-version':'2','trakt-api-key':clientId,'Content-Type':'application/json'};
  const items=[];
  for(const type of ['shows','movies']){
    const response=await fetch(`https://api.trakt.tv/sync/watched/${type}`,{headers});if(!response.ok)return res.status(response.status).json({error:`Trakt returned ${response.status}.`});
    const data=await response.json();for(const row of data){const media=row.show||row.movie;if(media)items.push({type,title:media.title,year:media.year,ids:media.ids});}
  }
  return res.status(200).json({items});
}

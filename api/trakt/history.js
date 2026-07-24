import { resolveTraktSession } from '../_lib/providers.js';
import { sendError } from '../_lib/http.js';

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const clientId=process.env.TRAKT_CLIENT_ID;
  if(!clientId)return res.status(503).json({error:'TRAKT_CLIENT_ID is not configured.'});
  try {
    const context=await resolveTraktSession(req);
    const headers={Authorization:`Bearer ${context.session.accessToken}`,'trakt-api-version':'2','trakt-api-key':clientId,'Content-Type':'application/json'};
    const [showsResponse,moviesResponse]=await Promise.all([
      fetch('https://api.trakt.tv/sync/watched/shows?extended=full',{headers,signal:AbortSignal.timeout(30000)}),
      fetch('https://api.trakt.tv/sync/watched/movies?extended=full',{headers,signal:AbortSignal.timeout(30000)})
    ]);
    if(!showsResponse.ok||!moviesResponse.ok)return res.status(Math.max(showsResponse.status,moviesResponse.status)).json({error:`Trakt returned ${showsResponse.status}/${moviesResponse.status}.`});
    const shows=(await showsResponse.json()).map(row=>({
      title:row.show?.title,year:row.show?.year,ids:row.show?.ids,
      seasons:(row.seasons||[]).map(season=>({number:season.number,episodes:(season.episodes||[]).map(episode=>({number:episode.number,completedAt:episode.completed_at,lastWatchedAt:episode.last_watched_at}))}))
    })).filter(row=>row.title);
    const movies=(await moviesResponse.json()).map(row=>({title:row.movie?.title,year:row.movie?.year,ids:row.movie?.ids,lastWatchedAt:row.last_watched_at})).filter(row=>row.title);
    return res.status(200).json({shows,movies,cloud:context.cloud});
  } catch(error){return sendError(res,error.status||502,error,'Unable to load Trakt watched history.');}
}

import { readIntegration } from '../_lib/account.js';
import { verifySignedValue } from '../_lib/crypto.js';
import { sendError } from '../_lib/http.js';

function allowedUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname.endsWith('.plex.direct') || url.hostname.endsWith('.plex.services'));
  } catch { return false; }
}
function connectionCandidates(server){
  const rows=[server?.activeConnection,server?.uri&&{uri:server.uri,selected:true},...(server?.connections||[])].filter(Boolean);
  const seen=new Set();
  return rows.filter(row=>allowedUri(row.uri)).filter(row=>!seen.has(row.uri)&&seen.add(row.uri)).sort((a,b)=>{
    const score=row=>(row.local?100:0)+(row.relay?25:0)+(row.selected?-10:0)+(row===server?.activeConnection?-20:0);
    return score(a)-score(b);
  });
}
function validImagePath(value) {
  const path = String(value || '');
  return path.startsWith('/library/metadata/') && !path.includes('..') && path.length < 1024;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const userId = String(req.query?.u || ''), machineIdentifier = String(req.query?.m || '');
    const imagePath = String(req.query?.p || ''), expiresAt = Number(req.query?.e || 0), signature = String(req.query?.s || '');
    if (!userId || !machineIdentifier || !validImagePath(imagePath)) return res.status(400).json({ error: 'Invalid Plex image request.' });
    const value = `${userId}|${machineIdentifier}|${imagePath}`;
    if (!verifySignedValue(value, expiresAt, signature)) return res.status(403).json({ error: 'The Plex artwork link is invalid or expired.' });

    const entry = await readIntegration(userId, 'plex');
    if (!entry?.payload?.token) return res.status(404).json({ error: 'Plex connection not found.' });
    const payload = entry.payload;
    const server = (payload.servers || []).find(item => item.machineIdentifier === machineIdentifier) || payload.selectedServer;
    if (!server) return res.status(404).json({ error: 'Plex server not found.' });
    const token = server.accessToken || payload.token;
    const errors=[];
    for(const connection of connectionCandidates(server)){
      try{
        const response = await fetch(`${connection.uri.replace(/\/$/, '')}${imagePath}`, {
          headers: { 'X-Plex-Token': token, Accept: 'image/*' },
          signal: AbortSignal.timeout(20000)
        });
        if(!response.ok){errors.push(`${connection.uri}: ${response.status}`);continue;}
        const bytes = Buffer.from(await response.arrayBuffer());
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.status(200).send(bytes);
      }catch(error){errors.push(`${connection.uri}: ${error.message}`);}
    }
    return res.status(502).json({error:'No Plex connection could supply this artwork.',details:errors});
  } catch (error) {
    return sendError(res, error.status || 502, error, 'Unable to load Plex artwork.');
  }
}

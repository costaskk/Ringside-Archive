import { authenticateAccount, writeIntegration, publicIntegration } from '../_lib/account.js';
import { sendError } from '../_lib/http.js';

const PRODUCT='Ringside Archive';
const headers=clientId=>({'Accept':'application/json','Content-Type':'application/json','X-Plex-Product':PRODUCT,'X-Plex-Version':'5.8.1','X-Plex-Client-Identifier':clientId});
export default async function handler(req,res){
  const clientId=String(req.method==='POST'?req.body?.clientId:req.query?.clientId||'');
  if(!clientId)return res.status(400).json({error:'Missing Plex client identifier.'});
  try {
    if(req.method==='POST'){
      const response=await fetch('https://plex.tv/api/v2/pins?strong=true',{method:'POST',headers:headers(clientId),body:'{}',signal:AbortSignal.timeout(15000)});
      const data=await response.json().catch(()=>({}));if(!response.ok)return res.status(response.status).json({error:data.error||'Unable to create Plex PIN.'});
      const forwardUrl=String(req.body?.forwardUrl||'');
      const params=new URLSearchParams({clientID:clientId,code:data.code,forwardUrl,'context[device][product]':PRODUCT});
      return res.status(200).json({id:data.id,code:data.code,expiresAt:data.expiresAt,authUrl:`https://app.plex.tv/auth#?${params.toString()}`});
    }
    if(req.method==='GET'){
      const id=String(req.query?.id||'');if(!/^\d+$/.test(id))return res.status(400).json({error:'Invalid Plex PIN.'});
      const response=await fetch(`https://plex.tv/api/v2/pins/${id}`,{headers:headers(clientId),signal:AbortSignal.timeout(15000)});
      const data=await response.json().catch(()=>({}));if(!response.ok)return res.status(response.status).json({error:data.error||'Unable to check Plex PIN.'});
      if(!data.authToken)return res.status(200).json({id:data.id,authToken:null,expiresAt:data.expiresAt});
      let user=null;
      try { user=await authenticateAccount(req,{optional:true}); } catch {}
      if(user){
        try {
          const entry=await writeIntegration(user.id,'plex',{token:data.authToken,clientId},{connectedAt:new Date().toISOString()});
          return res.status(200).json({id:data.id,connected:true,cloud:true,integration:publicIntegration(entry),expiresAt:data.expiresAt});
        } catch (storageError) {
          return res.status(200).json({
            id:data.id,authToken:data.authToken,cloud:false,expiresAt:data.expiresAt,
            warning:`Plex connected locally, but cross-device storage failed: ${storageError.message}`
          });
        }
      }
      return res.status(200).json({id:data.id,authToken:data.authToken,cloud:false,expiresAt:data.expiresAt});
    }
    return res.status(405).json({error:'Method not allowed'});
  } catch(error){return sendError(res,error.status||502,error,'Plex sign-in failed.');}
}

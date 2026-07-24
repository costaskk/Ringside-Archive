const CACHE='ringside-archive-v5.1';
const CORE=[
  './','./index.html','./runtime-config.js','./src/app.js','./src/styles.css','./src/storage.js','./src/cloud.js',
  './src/tvmaze.js','./src/utils.js','./src/records.js','./src/integrations.js','./favicon.svg','./manifest.webmanifest',
  './data/meta.json','./data/promotions.json','./data/programmes.json','./data/major-events.json','./data/recommendations.json',
  './data/wrestlers.json','./data/format-labels.json','./data/artwork-overrides.json','./data/artwork-catalog.json',
  './data/event-details.json','./data/custom-records.json'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);

  // Account, Plex and Trakt responses can be private. Never cache API traffic.
  if(url.origin===self.location.origin&&url.pathname.includes('/api/')){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }

  if(url.hostname==='api.tvmaze.com'||url.hostname==='image.tmdb.org'||url.hostname.endsWith('wikimedia.org')){
    event.respondWith(caches.open(CACHE).then(async cache=>{
      try{
        const fresh=await fetch(event.request);
        if(fresh.ok)cache.put(event.request,fresh.clone());
        return fresh;
      }catch{
        return await cache.match(event.request)||Response.error();
      }
    }));
    return;
  }

  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
    if(response.ok&&url.origin===self.location.origin){
      const clone=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,clone));
    }
    return response;
  })));
});

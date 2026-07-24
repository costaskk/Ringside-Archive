const CACHE='ringside-archive-v3';
const CORE=['./','./index.html','./src/app.js','./src/styles.css','./src/storage.js','./src/tvmaze.js','./src/utils.js','./favicon.svg','./manifest.webmanifest','./data/meta.json','./data/promotions.json','./data/programmes.json','./data/major-events.json','./data/recommendations.json','./data/wrestlers.json','./data/format-labels.json','./data/artwork-overrides.json','./data/custom-records.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.hostname==='api.tvmaze.com'){
    event.respondWith(caches.open(CACHE).then(async cache=>{try{const fresh=await fetch(event.request);if(fresh.ok)cache.put(event.request,fresh.clone());return fresh;}catch{return await cache.match(event.request)||Response.error();}}));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(response.ok&&url.origin===location.origin){const clone=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,clone));}return response;})));
});

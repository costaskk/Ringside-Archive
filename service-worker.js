const CACHE = 'ringside-archive-v5.3.0';
const CORE = [
  './', './index.html?v=5.3.0', './runtime-config.js?v=5.3.0',
  './src/app.js?v=5.3.0', './src/styles.css?v=5.3.0', './src/storage.js', './src/cloud.js',
  './src/tvmaze.js', './src/utils.js', './src/records.js', './src/integrations.js',
  './favicon.svg', './manifest.webmanifest',
  './data/meta.json', './data/promotions.json', './data/programmes.json', './data/major-events.json',
  './data/recommendations.json', './data/wrestlers.json', './data/format-labels.json',
  './data/artwork-overrides.json', './data/artwork-catalog.json', './data/event-details.json',
  './data/custom-records.json', './data/tvmaze/index.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(CORE.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, { cacheable = true } = {}) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (cacheable && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: false })
      || await cache.match(new URL(request.url).pathname);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const update = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await update || Response.error();
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Do not intercept Supabase or third-party requests. This avoids duplicating auth,
  // metadata and artwork traffic in the service-worker console and keeps credentials network-only.
  if (url.origin !== self.location.origin) return;

  // Authentication, Plex and Trakt responses are private and must never be cached.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // Always prefer the newest application shell, modules, catalogue and runtime config.
  if (url.origin === self.location.origin && (
    event.request.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname === '/index.html'
    || url.pathname === '/runtime-config.js'
    || url.pathname === '/service-worker.js'
    || url.pathname.startsWith('/src/')
    || url.pathname.startsWith('/data/')
  )) {
    event.respondWith(networkFirst(event.request));
    return;
  }


  event.respondWith(networkFirst(event.request));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
  }
});

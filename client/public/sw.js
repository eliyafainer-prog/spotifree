// SpotiFree PWA Service Worker
const CACHE_NAME = 'spotifree-pwa-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Network-first strategy for media and API, pass-through for streaming
self.addEventListener('fetch', (event) => {
  // Direct pass-through for streaming audio to avoid caching multi-megabyte streams
  if (event.request.url.includes('/api/stream/')) {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

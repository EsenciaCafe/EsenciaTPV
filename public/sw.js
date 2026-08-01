const CACHE_NAME = 'tpv-cache-v96';
const BASE_URL = new URL('./', self.location.href);
const BUILD_ASSETS = /* __PRECACHE_ASSETS__ */ [];
const ASSETS = [
  './',
  './index.html',
  './kds.html',
  './ticket.html',
  './accounting.html',
  './manifest.webmanifest',
  './kds.webmanifest',
  './icon.svg',
  './icons/tpv-192.png',
  './icons/tpv-512.png',
  './icons/kds-192.png',
  './icons/kds-512.png',
  './latte.png',
  './minipancakes.png',
  ...BUILD_ASSETS
];
const CACHE_URLS = [...new Set(ASSETS)].map((asset) => new URL(asset, BASE_URL).toString());

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event (Network First, falling back to cache)
self.addEventListener('fetch', (e) => {
  // Only handle GET requests and local assets
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
    return;
  }

  const requestUrl = new URL(e.request.url);
  const isNavigation = e.request.mode === 'navigate';
  const isStaticAsset = ['script', 'style', 'image', 'font'].includes(e.request.destination);

  if (isStaticAsset) {
    e.respondWith(
      caches.match(e.request, { ignoreVary: true }).then((cached) => cached || fetch(e.request).then((networkResponse) => {
        if (networkResponse.ok) {
          const responseToCache = networkResponse.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseToCache));
        }
        return networkResponse;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // If successful, update the cache with the fresh resource
        if (networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(e.request, { ignoreVary: true });
        if (cached) return cached;
        if (isNavigation) {
          const fallback = requestUrl.pathname.endsWith('/kds.html')
            ? './kds.html'
            : requestUrl.pathname.endsWith('/ticket.html')
              ? './ticket.html'
              : './index.html';
          return caches.match(new URL(fallback, BASE_URL).toString(), { ignoreVary: true });
        }
        return Response.error();
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

const CACHE_NAME = 'tpv-cache-v65';
const BASE_URL = new URL('./', self.location.href);
const ASSETS = [
  './',
  './index.html',
  './kds.html',
  './ticket.html',
  './manifest.webmanifest',
  './kds.webmanifest',
  './icon.svg',
  './icons/tpv-192.png',
  './icons/tpv-512.png',
  './icons/kds-192.png',
  './icons/kds-512.png',
  './latte.png',
  './minipancakes.png'
];
const CACHE_URLS = ASSETS.map((asset) => new URL(asset, BASE_URL).toString());

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
      .catch(() => {
        // If network fails (offline), fall back to cache
        return caches.match(e.request);
      })
  );
});

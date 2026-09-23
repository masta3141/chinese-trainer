// sw.js — service worker for the HSK Vokabeltrainer PWA.
//
// Caches the app shell (the HTML file itself, manifest, icons) so the app
// still opens when there's no network connection — this is also what lets
// tools like PWABuilder recognize the app as genuinely installable/offline-
// capable, not just "has a registered service worker".
//
// External requests (e.g. to the Gemini API) are explicitly left alone and
// always go straight to the network — they're never cached or intercepted.
//
// Deploy this file in the SAME folder as your index.html on GitHub Pages.

var CACHE_NAME = 'hskflash-shell-v2';
var APP_SHELL = [
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== CACHE_NAME; })
              .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Only handle same-origin GET requests. Everything else (Gemini API calls,
  // Google Fonts, etc.) is left completely untouched and goes straight to
  // the network, exactly as if there were no service worker at all.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networkFetch = fetch(event.request)
        .then(function (response) {
          if (response && response.status === 200) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(function () {
          // Offline and nothing cached for this request — nothing more we can do.
          return cached;
        });

      // Cached version first for instant load / offline support; the network
      // request still runs in the background and refreshes the cache.
      return cached || networkFetch;
    })
  );
});

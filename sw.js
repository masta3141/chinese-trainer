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

var CACHE_NAME = 'hskflash-shell-v30';
// Keep in sync with the <link>/<script> tags in index.html.
var APP_SHELL = [
  'index.html',
  'impressum.html',
  'css/app.css',
  'vendor/lamejs/lame.min.js',
  'data/words-hsk2.js',
  'data/words-hsk3.js',
  'data/examples-seed.json',
  'data/freq.js',
  'js/core.js',
  'js/i18n.js',
  'js/state.js',
  'js/session.js',
  'js/streak.js',
  'js/gemini.js',
  'js/stories.js',
  'js/tts.js',
  'js/audio.js',
  'js/islands.js',
  'js/navigation.js',
  'js/pool.js',
  'js/speech.js',
  'js/cards.js',
  'js/stats.js',
  'js/settings.js',
  'js/backup.js',
  'js/welcome.js',
  'js/init.js',
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

  // Network first: always serve the current version of every file when online
  // (cache: 'no-cache' revalidates with the server, so the HTTP cache can't
  // hand out stale files either). This keeps index.html, css/, data/ and js/
  // from the same deploy together — serving cached files first could mix an
  // old js/state.js with a new js/init.js after an update. The cache is only
  // the offline fallback, refreshed on every successful fetch.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
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
        // Offline: fall back to the cached copy (precached on install).
        return caches.match(event.request);
      })
  );
});

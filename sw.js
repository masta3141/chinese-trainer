// sw.js — minimal service worker for the HSK Vokabeltrainer PWA.
//
// It doesn't do any real caching or offline work — its only job is to exist
// and be registered. Chrome on Android only creates a full "installed app"
// icon (no little browser badge) once a page has a registered service worker
// with a fetch handler; without one, "Add to Home Screen" just creates a
// bookmark-style shortcut instead.
//
// Deploy this file in the SAME folder as your index.html on GitHub Pages.

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  // Plain passthrough — just forwards every request to the network as normal.
  event.respondWith(fetch(event.request));
});

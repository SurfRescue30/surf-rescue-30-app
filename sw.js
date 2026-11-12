/* ── Surf Patrol Log – sw.js ──
   Keeps the app's own files on the device so it opens straight away at sea.
   Cache-first: the app always opens from the copy on the phone, even on one
   bar of signal (network-first waited for the slow network every time).
   New versions arrive whole: when this file changes (bump CACHE on every app
   change), the browser installs the new set of files in the background and
   the next open uses it. Weather data is not cached here (weather.js keeps
   its own last-good copy).
*/
const CACHE = 'sr30-shell-v12';
const SHELL = [
  './', 'index.html', 'style.css', 'config.js', 'places.js', 'vocab.js', 'geo.js', 'tide-constants.js', 'tide.js', 'moon.js',
  'coast.js', 'geofence.js', 'route.js', 'setup.js', 'script.js', 'weather.js', 'tools.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  // cache: 'reload' so the new set comes from the server, not a stale HTTP cache
  event.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      // Not one of the app's files: network, falling back to the app page
      return fetch(event.request).catch(() =>
        event.request.mode === 'navigate' ? caches.match('index.html') : Response.error());
    })
  );
});

// Tapping a boundary notification brings the app to the front
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(list =>
      list.length ? list[0].focus() : self.clients.openWindow('./'))
  );
});

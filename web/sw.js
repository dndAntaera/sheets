// The service worker: what lets the sheets open without a connection, and be
// installed on a phone's home screen as an app.
//
// Network first: a player online gets today's code, and the copy kept here is
// only what they fall back on offline. So a deploy never leaves anyone on an
// old version, and there is no list of files to keep in step - whatever the app
// has fetched once, it can fetch again offline. The one exception is a data
// file stamped with its build, which is kept and used until the next deploy.
//
// Only this site's own files are kept. Calls to the account server go straight
// to the network, never through a cache: a sheet saved offline is saved in the
// browser by the app itself (web/store.js), not here.

const CACHE = 'sheets-v2';

// Enough to draw the app offline even on a first visit that stopped early.
const SHELL = ['./', './index.html', './css/tokens.css', './css/sheet.css', './app.js', './config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/favicon-48.png', './brand/logo-disc-96.png', './starfield.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // A data file stamped with its build (?v=, see config.js) cannot change
    // under that address, so a kept copy is used at once. A new deploy asks for
    // a new address, and the copies of older builds are let go.
    if (url.searchParams.has('v')) {
      const kept = await cache.match(request);
      if (kept) return kept;
      try {
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone()).catch(() => {});
          for (const old of await cache.keys()) {
            const at = new URL(old.url);
            if (at.pathname === url.pathname && at.search !== url.search) cache.delete(old).catch(() => {});
          }
        }
        return response;
      } catch (err) {
        const older = await cache.match(request, { ignoreSearch: true });
        if (older) return older;
        throw err;
      }
    }
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch (err) {
      const kept = await cache.match(request, { ignoreSearch: true })
        || (request.mode === 'navigate' ? await cache.match('./index.html') : null);
      if (kept) return kept;
      throw err;
    }
  })());
});

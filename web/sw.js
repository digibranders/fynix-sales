// Fynix Sales service worker.
//
// It keeps only public files (icons, styles, scripts, the offline page) so the app opens quickly and shows a friendly
// page when there is no connection. It never stores a page or a response that belongs to a signed-in person: pages and
// data always come straight from the network, so nothing private can be left behind in the browser after sign-out.

const CACHE_VERSION = 'fynix-v2';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const MAX_STATIC_ENTRIES = 150;

const PRECACHE_ASSETS = [
  '/offline.html',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/favicon.svg',
  '/assets/icons/favicon-32x32.png',
  '/assets/img/fynix-white-logo.svg',
  '/assets/gbc.json',
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // One missing file must not stop the worker from installing.
      await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res.ok) await cache.put(url, res);
        }),
      );
    }),
  );
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────────────
// Every cache from an older version is deleted. This also clears the pages and data that version 1 used to keep.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Pages: always the network. Only when there is no connection is the offline page shown. Pages are never stored.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(offlineResponse));
    return;
  }

  // Data (/api/): not touched at all, so the server's "never store this" instructions apply.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // Public files: from the cache when we have them, otherwise fetched and kept.
  const isPublicFile =
    (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.json')) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';
  if (isPublicFile) {
    event.respondWith(cacheFirst(request));
  }
});

async function offlineResponse() {
  const page = await caches.match('/offline.html');
  return (
    page ||
    new Response('You are offline. Please reconnect to use Fynix Sales.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

/** Old release files pile up, so the oldest entries are dropped once the cache is over its limit. */
async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_STATIC_ENTRIES;
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i]);
}

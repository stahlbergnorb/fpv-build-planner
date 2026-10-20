// Service worker: app shell cache-first (versioned), data network-first so
// online users always get the latest prices and offline users the last copy.
// Bump VERSION whenever app files change so installed apps pick them up.

const VERSION = 'v1.1.1';
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = 'data';
const NETWORK_TIMEOUT_MS = 3500;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/styles.css',
  'src/main.js',
  'src/state.js',
  'src/data.js',
  'src/build.js',
  'src/classes.js',
  'src/physics.js',
  'src/compat.js',
  'src/pricing.js',
  'src/ui/dom.js',
  'src/ui/offers.js',
  'src/ui/picker.js',
  'src/ui/builder.js',
  'src/ui/stats.js',
  'src/ui/cost.js',
  'src/ui/search.js',
  'src/ui/more.js',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png',
  'assets/icons/apple-touch-icon.png',
];
const DATA = ['data/parts.json', 'data/meta.json', 'data/catalog.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' skips the HTTP cache so a new VERSION never stores old files.
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(async () => {
      // Pre-warm data so the first offline launch (and offline search) works.
      const c = await caches.open(DATA_CACHE);
      await Promise.all(DATA.map((u) =>
        fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => null)));
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE)
      .map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function dataResponse(event, req, key) {
  const cache = caches.open(DATA_CACHE);
  const network = fetch(req);
  // Registered while the event is still active, so the cache is refreshed even
  // when the cached copy was served first.
  event.waitUntil(network.then((res) => {
    if (!res.ok) return undefined;
    const copy = res.clone();
    return cache.then((c) => c.put(key, copy));
  }).catch(() => {}));
  const cached = cache.then((c) => c.match(key));
  const fallback = () => cached.then((hit) => hit || Response.error());
  // An explicit fresh load (data update) waits for the network.
  if (req.cache === 'reload') return network.catch(fallback);
  // Otherwise prefer the network, but on a slow connection use the cached copy.
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS)).then(() => cached);
  return Promise.race([network.catch(() => cached), timeout.then((hit) => hit || network)])
    .then((res) => res || network)
    .catch(fallback);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // store APIs, images: straight to network
  if (req.cache === 'no-store') return; // update checks must reach the network

  if (url.pathname.includes('/data/')) {
    const key = url.pathname.slice(url.pathname.indexOf('data/'));
    event.respondWith(dataResponse(event, req, key));
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && url.pathname.match(/\.(js|css|png|svg|webmanifest|html)$/)) {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});

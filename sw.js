// Service worker: offline start and silent updates (docs/PLAN-pwa.md).
// Strategy: network first (short timeout), every successful response is copied into the cache,
// the cache answers when the network is missing or too slow. Online, the app is therefore always
// the latest published version, applied at the next launch; no version number to bump by hand.
// Relative paths only: the site is served under a sub-path on GitHub Pages.
const CACHE = 'rower-monitor';
const TIMEOUT_MS = 3000;
// Everything the app needs to start offline (keep in sync with the module graph: test/pwa.test.js checks it).
const SHELL = [
  './', './index.html', './manifest.webmanifest', './src/ui/styles.css',
  './src/app.js', './src/activity.js', './src/ble.js', './src/export.js', './src/ftms.js', './src/ftms-encoder.js',
  './src/session.js', './src/sim.js', './src/store.js', './src/version.js', './src/wakelock.js',
  './src/goal.js', './src/engine.js', './src/programs.js', './src/target.js', './src/ui/choice.js', './src/ui/components.js', './src/ui/format.js', './src/ui/layouts.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  // Pre-cache the whole app so a first offline start works once it has been opened online.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  // Remove our own caches of older naming schemes (github.io is shared with other sites: never touch theirs),
  // then take control (no reload of open pages).
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rower-monitor') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(event));
});

async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const fromCache = () => cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  let stored = null;
  // 'no-cache' = always revalidate with the server (cheap 304 when unchanged). Without it Chrome's HTTP
  // cache (GitHub Pages: max-age=600) could serve a 10-minute-old file and hide a fresh deploy.
  // The promise is kept: a response arriving after the timeout is still copied into the cache.
  const fetching = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response.ok) stored = cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  fetching.catch(() => {}); // abandoned after the timeout: its failure is not an unhandled rejection
  event.waitUntil(fetching.then(() => stored, () => {})); // keep the worker alive until the copy is done
  let timer;
  try {
    const response = await Promise.race([
      fetching,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); }),
    ]);
    if (response.ok) return response;
    // 404 during a deploy, 5xx: a cached copy is better than an error page.
    return (await fromCache()) ?? response;
  } catch (err) {
    const cached = await fromCache();
    if (cached) return cached;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

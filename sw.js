// Service worker: offline start and silent updates (docs/PLAN-pwa.md).
// Strategy: network first (short timeout), every successful response is copied into the cache,
// the cache answers when the network is missing or too slow. Online, the app is therefore always
// the latest published version, applied at the next launch; no version number to bump by hand.
// Relative paths only: the site is served under a sub-path on GitHub Pages.
const CACHE = 'rower-monitor';
const TIMEOUT_MS = 3000;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (event) => {
  // Pre-cache the shell so a first offline start works once the app has been opened online.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  // Remove caches of older naming schemes, then take control (no reload of open pages).
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([
      // 'no-cache' = always revalidate with the server (cheap 304 when unchanged). Without it Chrome's HTTP
      // cache (GitHub Pages: max-age=600) could serve a 10-minute-old file and hide a fresh deploy.
      fetch(request, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    throw err;
  }
}

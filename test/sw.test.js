import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// sw.js is loaded once with a simulated worker scope (self, caches, fetch).
const listeners = {};
const store = new Map(); // cache name -> Map(url -> response)
const deleted = [];
globalThis.self = {
  location: { origin: 'https://site.test' },
  clients: { claim: async () => {} },
  addEventListener: (type, fn) => { listeners[type] = fn; },
};
const fakeCache = (name) => {
  const m = store.get(name) ?? store.set(name, new Map()).get(name);
  return {
    match: async (req) => m.get(req.url),
    put: async (req, res) => { m.set(req.url, res); },
    addAll: async () => {},
  };
};
globalThis.caches = {
  open: async (name) => fakeCache(name),
  keys: async () => [...store.keys()],
  delete: async (name) => { deleted.push(name); return store.delete(name); },
};
let fetchImpl = async () => { throw new Error('offline'); };
globalThis.fetch = (...args) => fetchImpl(...args);
await import('../sw.js');

const settle = () => new Promise((r) => setImmediate(r));
function fetchEvent(url = 'https://site.test/src/app.js') {
  const waits = [];
  const event = {
    request: { method: 'GET', url, mode: 'cors' },
    respondWith: (p) => { event.answer = p; },
    waitUntil: (p) => { waits.push(p); },
  };
  return { event, done: () => Promise.all(waits) };
}
const response = (ok, body) => ({ ok, status: ok ? 200 : 404, body, clone() { return this; } });

test('404 from the network (deploy in progress): the cached copy answers', async () => {
  const cached = response(true, 'cached');
  fakeCache('rower-monitor');
  store.get('rower-monitor').set('https://site.test/src/app.js', cached);
  fetchImpl = async () => response(false, 'not found');
  const { event, done } = fetchEvent();
  listeners.fetch(event);
  assert.equal(await event.answer, cached);
  await done();
  assert.equal(store.get('rower-monitor').get('https://site.test/src/app.js'), cached, '404 is not cached');
});

test('network slower than the timeout: cache answers now, the late response is still cached', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const cached = response(true, 'old');
    fakeCache('rower-monitor');
    store.get('rower-monitor').set('https://site.test/src/app.js', cached);
    let arrive;
    fetchImpl = () => new Promise((resolve) => { arrive = () => resolve(response(true, 'new')); });
    const { event, done } = fetchEvent();
    listeners.fetch(event);
    await settle();
    mock.timers.tick(3000);
    assert.equal(await event.answer, cached);
    arrive();
    await done();
    assert.equal(store.get('rower-monitor').get('https://site.test/src/app.js').body, 'new');
  } finally {
    mock.timers.reset();
  }
});

test('activate deletes only our own old caches', async () => {
  store.clear();
  for (const k of ['rower-monitor', 'rower-monitor-v0', 'other-site-cache']) fakeCache(k);
  deleted.length = 0;
  let work;
  listeners.activate({ waitUntil: (p) => { work = p; } });
  await work;
  assert.deepEqual(deleted, ['rower-monitor-v0']);
});

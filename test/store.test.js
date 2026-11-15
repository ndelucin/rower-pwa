import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

// Minimal in-memory IndexedDB fake: only the subset used by store.js.
function createFakeIndexedDB() {
  const dbs = new Map(); // name -> { stores: Map(name -> { keyPath, data: Map }) }
  const later = (fn) => setTimeout(fn, 0);
  return {
    open(name) {
      const req = {};
      later(() => {
        let first = false;
        if (!dbs.has(name)) { dbs.set(name, { stores: new Map() }); first = true; }
        const rec = dbs.get(name);
        const db = {
          createObjectStore(sn, opts = {}) { rec.stores.set(sn, { keyPath: opts.keyPath, data: new Map() }); },
          transaction(names, mode) {
            const tx = {};
            let pending = 0;
            const finish = () => later(() => { if (pending === 0) tx.oncomplete?.(); else finish(); });
            const request = (fn) => {
              const r = {};
              pending++;
              later(() => { r.result = fn(); pending--; r.onsuccess?.(); });
              return r;
            };
            tx.objectStore = (sn) => {
              const st = rec.stores.get(sn);
              if (!names.includes(sn) || !st) throw new Error('NotFoundError');
              const keyOf = (v, k) => (st.keyPath ? v[st.keyPath] : k);
              return {
                put: (v, k) => request(() => { const key = keyOf(v, k); st.data.set(key, structuredClone(v)); return key; }),
                get: (k) => request(() => structuredClone(st.data.get(k))),
                delete: (k) => request(() => { st.data.delete(k); }),
                getAll: () => request(() => [...st.data.values()].map((v) => structuredClone(v))),
              };
            };
            finish();
            return tx;
          },
        };
        req.result = db;
        if (first) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

test('loadDraft is null when empty', async () => {
  const store = createStore({ indexedDB: createFakeIndexedDB() });
  assert.equal(await store.loadDraft(), null);
});

test('draft save / load / overwrite / delete', async () => {
  const store = createStore({ indexedDB: createFakeIndexedDB() });
  await store.saveDraft({ a: 1 });
  assert.deepEqual(await store.loadDraft(), { a: 1 });
  await store.saveDraft({ a: 2, b: [1, 2] });
  assert.deepEqual(await store.loadDraft(), { a: 2, b: [1, 2] });
  await store.deleteDraft();
  assert.equal(await store.loadDraft(), null);
});

test('sessions are listed by startedAt ascending', async () => {
  const store = createStore({ indexedDB: createFakeIndexedDB() });
  assert.deepEqual(await store.listSessions(), []);
  await store.saveSession({ startedAt: 300, distance: 3 });
  await store.saveSession({ startedAt: 100, distance: 1 });
  await store.saveSession({ startedAt: 200, distance: 2 });
  assert.deepEqual((await store.listSessions()).map((s) => s.startedAt), [100, 200, 300]);
});

test('saving a session with the same startedAt replaces it', async () => {
  const store = createStore({ indexedDB: createFakeIndexedDB() });
  await store.saveSession({ startedAt: 1, distance: 1 });
  await store.saveSession({ startedAt: 1, distance: 9 });
  assert.deepEqual(await store.listSessions(), [{ startedAt: 1, distance: 9 }]);
});

test('a second store on the same DB sees the data', async () => {
  const idb = createFakeIndexedDB();
  const a = createStore({ indexedDB: idb });
  await a.saveDraft({ x: 1 });
  await a.saveSession({ startedAt: 5 });
  const b = createStore({ indexedDB: idb });
  assert.deepEqual(await b.loadDraft(), { x: 1 });
  assert.deepEqual(await b.listSessions(), [{ startedAt: 5 }]);
});

test('data is structured-cloned', async () => {
  const store = createStore({ indexedDB: createFakeIndexedDB() });
  const draft = { n: { v: 1 } };
  await store.saveDraft(draft);
  draft.n.v = 99;
  assert.deepEqual(await store.loadDraft(), { n: { v: 1 } });
  const s = { startedAt: 1, tags: ['a'] };
  await store.saveSession(s);
  s.tags.push('b');
  assert.deepEqual(await store.listSessions(), [{ startedAt: 1, tags: ['a'] }]);
});

test('without IndexedDB every method rejects with a clear error', async () => {
  const store = createStore({ indexedDB: null });
  await assert.rejects(store.saveDraft({}), /IndexedDB unavailable/);
  await assert.rejects(store.loadDraft(), /IndexedDB unavailable/);
  await assert.rejects(store.deleteDraft(), /IndexedDB unavailable/);
  await assert.rejects(store.saveSession({ startedAt: 1 }), /IndexedDB unavailable/);
  await assert.rejects(store.listSessions(), /IndexedDB unavailable/);
});

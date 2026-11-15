// Local persistence (IndexedDB): one backup draft of the running session + the history of finished sessions.
// IndexedDB is injected so tests can pass an in-memory fake.
//
// If IndexedDB is unavailable (private mode, old browser), every method REJECTS with a clear Error.
// It never throws synchronously: callers on the session screen just `.catch(log)` and carry on without backup.

const DRAFT_KEY = 'current';

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
});

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
});

export function createStore({ indexedDB = globalThis.indexedDB, name = 'rower-pwa' } = {}) {
  let dbPromise = null;

  function open() {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB unavailable: nothing will be stored'));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('draft');
          db.createObjectStore('sessions', { keyPath: 'startedAt' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      });
      dbPromise.catch(() => { dbPromise = null; }); // allow a retry later
    }
    return dbPromise;
  }

  async function run(storeName, mode, fn) {
    const db = await open();
    const tx = db.transaction([storeName], mode);
    const result = fn(tx.objectStore(storeName));
    const [value] = await Promise.all([result == null ? undefined : wrap(result), done(tx)]);
    return value;
  }

  return {
    async saveDraft(obj) { await run('draft', 'readwrite', (s) => s.put(obj, DRAFT_KEY)); },
    async loadDraft() { return (await run('draft', 'readonly', (s) => s.get(DRAFT_KEY))) ?? null; },
    async deleteDraft() { await run('draft', 'readwrite', (s) => s.delete(DRAFT_KEY)); },
    async saveSession(summary) { await run('sessions', 'readwrite', (s) => s.put(summary)); },
    async listSessions() {
      const all = await run('sessions', 'readonly', (s) => s.getAll());
      return all.sort((a, b) => a.startedAt - b.startedAt);
    },
  };
}

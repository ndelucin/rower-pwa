// Keeps the screen on during a session (Screen Wake Lock API, brief § 13).
// Without it Android turns the screen off, Chrome freezes the page and the Bluetooth link drops.
//
// The browser releases the lock by itself whenever the page is hidden (screen off, app switch),
// so we ask for it again each time the page becomes visible.

export function createKeepAwake({ wakeLock = globalThis.navigator?.wakeLock, doc = globalThis.document, log = () => {} } = {}) {
  let sentinel = null;
  let wanted = false;
  let denied = false; // the last request was refused by the browser

  let pending = null; // request in flight: concurrent callers (start + visibilitychange) share it

  function acquire() {
    if (pending) return pending;
    if (!wanted || sentinel || !wakeLock || doc.visibilityState !== 'visible') return Promise.resolve();
    pending = (async () => {
      try {
        const s = await wakeLock.request('screen');
        // stop() may have been called while the request was in flight: do not keep a lock nobody wants.
        if (!wanted || sentinel) { Promise.resolve(s.release?.()).catch(() => {}); return; }
        sentinel = s;
        denied = false;
        log('écran maintenu allumé');
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
          log('maintien de l\'écran relâché');
        });
      } catch (err) {
        denied = true;
        log(`maintien de l'écran refusé : ${err.name} ${err.message}`);
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  const onVisibility = () => { acquire(); };

  return {
    supported: !!wakeLock,
    get active() { return !!sentinel; },
    get denied() { return denied; },
    async start() {
      wanted = true;
      doc.addEventListener('visibilitychange', onVisibility);
      await acquire();
    },
    async stop() {
      wanted = false;
      doc.removeEventListener('visibilitychange', onVisibility);
      await sentinel?.release();
      sentinel = null;
    },
  };
}

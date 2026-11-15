// Keeps the screen on during a session (Screen Wake Lock API, brief § 13).
// Without it Android turns the screen off, Chrome freezes the page and the Bluetooth link drops.
//
// The browser releases the lock by itself whenever the page is hidden (screen off, app switch),
// so we ask for it again each time the page becomes visible.

export function createKeepAwake({ wakeLock = globalThis.navigator?.wakeLock, doc = globalThis.document, log = () => {} } = {}) {
  let sentinel = null;
  let wanted = false;

  async function acquire() {
    if (!wanted || sentinel || !wakeLock || doc.visibilityState !== 'visible') return;
    try {
      sentinel = await wakeLock.request('screen');
      log('écran maintenu allumé');
      sentinel.addEventListener('release', () => {
        sentinel = null;
        log('maintien de l\'écran relâché');
      });
    } catch (err) {
      log(`maintien de l'écran refusé : ${err.name} ${err.message}`);
    }
  }

  const onVisibility = () => { acquire(); };

  return {
    supported: !!wakeLock,
    get active() { return !!sentinel; },
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

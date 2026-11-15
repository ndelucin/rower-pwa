// Real rower over Web Bluetooth: S4 BLE module, FTMS service 0x1826, Rower Data 0x2AD1 (NOTIFY).
// Exposes the same data-source contract as sim.js (see CLAUDE.md):
//   EventTarget + connect() / disconnect(), events 'status' and 'data' (DataView), plus 'log' (string).
// v1 only listens: the Control Point (0x2AD9) is deliberately not used (brief § 5).
//
// Chrome's device chooser cannot be styled or skipped by a page (security). To show it only once,
// connect() first tries a rower this site was already allowed to use (navigator.bluetooth.getDevices(),
// when the browser offers it), and opens the chooser only if that fails. The chooser needs a fresh user
// gesture: if the direct attempt took too long, connect() rejects with name 'GestureNeeded' and the next
// call goes straight to the chooser.

export const FTMS_SERVICE = 0x1826;
export const ROWER_DATA = 0x2ad1;

// After a failed direct attempt, the next connect() opens the chooser. Module-level: the app creates
// a new source on each tap of "Connecter".
let skipKnown = false;

export function isBleAvailable(bluetooth = globalThis.navigator?.bluetooth) {
  return !!bluetooth;
}

/**
 * @param {object} opts
 * @param {string} opts.namePrefix   advertised name prefix ("S4 BLE 50")
 * @param {object} opts.bluetooth    navigator.bluetooth (injectable for tests)
 * @param {number} opts.maxRetryMs   cap of the reconnection back-off
 */
export function createBleSource({
  namePrefix = 'S4 BLE',
  bluetooth = globalThis.navigator?.bluetooth,
  userActivation = globalThis.navigator?.userActivation,
  maxRetryMs = 10000,
  knownTimeoutMs = 5000,
} = {}) {
  const source = new EventTarget();
  const emit = (type, detail) => source.dispatchEvent(new CustomEvent(type, { detail }));
  const log = (msg) => emit('log', msg);

  let device = null;
  let wanted = false;     // true between connect() and disconnect(): auto-reconnect only then
  let retry = 0;
  let retryTimer = null;
  let generation = 0;     // bumped by disconnect(): an attach() started before it must not take over
  let unwatch = null;     // removes the 'gattserverdisconnected' listener of the current device
  const watched = new WeakSet();

  const onValue = (e) => {
    const v = e.target.value;
    // Copy: the browser may reuse the underlying buffer for the next notification.
    emit('data', new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
  };

  async function attach() {
    const d = device;
    const gen = generation;
    // A direct attempt abandoned on timeout, or one in flight when disconnect() was called, may finish
    // later: it must not take over (the S4 accepts a single connection: a ghost link keeps it busy).
    const check = () => { if (d !== device || gen !== generation) { d.gatt?.disconnect?.(); throw Object.assign(new Error('abandonné'), { name: 'AbortError' }); } };
    emit('status', 'connecting');
    const server = await d.gatt.connect();
    check();
    log('GATT connecté');
    const service = await server.getPrimaryService(FTMS_SERVICE);
    const rowerData = await service.getCharacteristic(ROWER_DATA);
    check();
    rowerData.addEventListener('characteristicvaluechanged', onValue);
    await rowerData.startNotifications();
    check();
    log('abonné à Rower Data 0x2AD1');
    retry = 0;
    emit('status', 'connected');
  }

  function scheduleReconnect() {
    if (!wanted) return;
    const delay = Math.min(1000 * 2 ** retry, maxRetryMs);
    retry += 1;
    log(`reconnexion dans ${delay / 1000} s (tentative ${retry})`);
    clearTimeout(retryTimer); // never two timers: disconnect() could cancel only the last one
    retryTimer = setTimeout(async () => {
      if (!wanted) return;
      try {
        await attach();
      } catch (err) {
        log(`échec reconnexion : ${err.name} ${err.message}`);
        emit('status', 'disconnected');
        scheduleReconnect();
      }
    }, delay);
  }

  function use(d) {
    device = d;
    if (watched.has(d)) return;
    watched.add(d);
    const onGattDisconnected = () => {
      if (d !== device) return;
      log('déconnecté');
      emit('status', 'disconnected');
      scheduleReconnect();
    };
    d.addEventListener('gattserverdisconnected', onGattDisconnected);
    unwatch = () => { d.removeEventListener('gattserverdisconnected', onGattDisconnected); watched.delete(d); };
  }

  const withTimeout = (promise, ms) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('délai dépassé'), { name: 'TimeoutError' })), ms);
    });
    promise.catch(() => {}); // an abandoned attempt may reject later
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

  /** A rower this site is already allowed to use, without the chooser; null if none or unsupported. */
  async function knownRower() {
    if (skipKnown) { log('getDevices ignoré (geste expiré au dernier essai)'); return null; }
    if (typeof bluetooth.getDevices !== 'function') { log('getDevices indisponible dans ce Chrome'); return null; }
    try {
      const devices = await bluetooth.getDevices();
      log(`getDevices : ${devices.length} appareil(s) autorisé(s)`);
      return devices.find((d) => d.name?.startsWith(namePrefix)) ?? null;
    } catch (err) {
      log(`getDevices a échoué : ${err.name} ${err.message}`);
      return null;
    }
  }

  /** Must be called from a user gesture (the browser device chooser may open). */
  source.connect = async () => {
    if (!bluetooth) throw new Error('Web Bluetooth indisponible dans ce navigateur');
    wanted = true;
    if (device) use(device); // listener removed by a previous disconnect()
    if (!device) {
      const known = await knownRower();
      if (known) {
        log(`rameur déjà autorisé : ${known.name}, connexion directe`);
        use(known);
        try {
          await withTimeout(attach(), knownTimeoutMs);
          return;
        } catch (err) {
          log(`connexion directe impossible : ${err.name} ${err.message}`);
          known.gatt?.disconnect?.();
          generation += 1; // the abandoned attempt may complete later, even for this same device object
          unwatch?.();
          device = null;
          emit('status', 'disconnected');
          // The chooser needs a user gesture that may have expired while we waited.
          if (userActivation && !userActivation.isActive) {
            skipKnown = true;
            wanted = false;
            throw Object.assign(new Error('nouveau geste nécessaire pour ouvrir le sélecteur'), { name: 'GestureNeeded' });
          }
        }
      }
      // Two filters (OR): by name, or by service, since we do not know whether 0x1826 is advertised.
      use(await bluetooth.requestDevice({
        filters: [{ namePrefix }, { services: [FTMS_SERVICE] }],
        optionalServices: [FTMS_SERVICE],
      }));
      skipKnown = false;
      log(`appareil choisi : ${device.name}`);
    }
    try {
      await attach();
    } catch (err) {
      wanted = false;
      clearTimeout(retryTimer);
      device?.gatt?.disconnect?.(); // a half-open link would keep the S4 busy
      unwatch?.();
      device = null;
      emit('status', 'disconnected');
      throw err;
    }
  };

  source.disconnect = () => {
    wanted = false;
    generation += 1;
    clearTimeout(retryTimer);
    unwatch?.();
    unwatch = null;
    device?.gatt?.disconnect?.();
    emit('status', 'disconnected');
  };

  source.deviceName = () => device?.name ?? null;
  return source;
}

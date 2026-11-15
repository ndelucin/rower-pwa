// Real rower over Web Bluetooth: S4 BLE module, FTMS service 0x1826, Rower Data 0x2AD1 (NOTIFY).
// Exposes the same data-source contract as sim.js (see CLAUDE.md):
//   EventTarget + connect() / disconnect(), events 'status' and 'data' (DataView), plus 'log' (string).
// v1 only listens: the Control Point (0x2AD9) is deliberately not used (brief § 5).

export const FTMS_SERVICE = 0x1826;
export const ROWER_DATA = 0x2ad1;

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
  maxRetryMs = 10000,
} = {}) {
  const source = new EventTarget();
  const emit = (type, detail) => source.dispatchEvent(new CustomEvent(type, { detail }));
  const log = (msg) => emit('log', msg);

  let device = null;
  let wanted = false;     // true between connect() and disconnect(): auto-reconnect only then
  let retry = 0;
  let retryTimer = null;

  const onValue = (e) => {
    const v = e.target.value;
    // Copy: the browser may reuse the underlying buffer for the next notification.
    emit('data', new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
  };

  async function attach() {
    emit('status', 'connecting');
    const server = await device.gatt.connect();
    log('GATT connecté');
    const service = await server.getPrimaryService(FTMS_SERVICE);
    const rowerData = await service.getCharacteristic(ROWER_DATA);
    rowerData.addEventListener('characteristicvaluechanged', onValue);
    await rowerData.startNotifications();
    log('abonné à Rower Data 0x2AD1');
    retry = 0;
    emit('status', 'connected');
  }

  function scheduleReconnect() {
    if (!wanted) return;
    const delay = Math.min(1000 * 2 ** retry, maxRetryMs);
    retry += 1;
    log(`reconnexion dans ${delay / 1000} s (tentative ${retry})`);
    retryTimer = setTimeout(async () => {
      try {
        await attach();
      } catch (err) {
        log(`échec reconnexion : ${err.name} ${err.message}`);
        emit('status', 'disconnected');
        scheduleReconnect();
      }
    }, delay);
  }

  /** Must be called from a user gesture the first time (browser device chooser). */
  source.connect = async () => {
    if (!bluetooth) throw new Error('Web Bluetooth indisponible dans ce navigateur');
    wanted = true;
    if (!device) {
      // Two filters (OR): by name, or by service, since we do not know whether 0x1826 is advertised.
      device = await bluetooth.requestDevice({
        filters: [{ namePrefix }, { services: [FTMS_SERVICE] }],
        optionalServices: [FTMS_SERVICE],
      });
      log(`appareil choisi : ${device.name}`);
      device.addEventListener('gattserverdisconnected', () => {
        log('déconnecté');
        emit('status', 'disconnected');
        scheduleReconnect();
      });
    }
    try {
      await attach();
    } catch (err) {
      wanted = false;
      emit('status', 'disconnected');
      throw err;
    }
  };

  source.disconnect = () => {
    wanted = false;
    clearTimeout(retryTimer);
    if (device?.gatt?.connected) device.gatt.disconnect();
    emit('status', 'disconnected');
  };

  source.deviceName = () => device?.name ?? null;
  return source;
}

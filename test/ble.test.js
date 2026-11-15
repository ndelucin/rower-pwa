import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createBleSource, FTMS_SERVICE, ROWER_DATA } from '../src/ble.js';

// Minimal fake of navigator.bluetooth: one device, one service, one characteristic.
function fakeBluetooth({ failConnects = 0 } = {}) {
  const characteristic = new EventTarget();
  characteristic.startNotifications = async () => characteristic;
  const service = { getCharacteristic: async (uuid) => { assert.equal(uuid, ROWER_DATA); return characteristic; } };
  const device = new EventTarget();
  device.name = 'S4 BLE 50';
  let failures = failConnects;
  let connects = 0;
  device.gatt = {
    connected: false,
    connect: async () => {
      connects += 1;
      if (failures-- > 0) throw Object.assign(new Error('out of range'), { name: 'NetworkError' });
      device.gatt.connected = true;
      return { getPrimaryService: async (uuid) => { assert.equal(uuid, FTMS_SERVICE); return service; } };
    },
    disconnect: () => { device.gatt.connected = false; },
  };
  const requests = [];
  const bluetooth = { requestDevice: async (opts) => { requests.push(opts); return device; } };
  // Emit a notification the way Chrome does: event.target.value is a DataView.
  const push = (bytes) => {
    characteristic.value = new DataView(new Uint8Array(bytes).buffer);
    characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
  };
  const drop = () => { device.gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); };
  return { bluetooth, requests, push, drop, device, connects: () => connects };
}

function record(source) {
  const statuses = [];
  const frames = [];
  source.addEventListener('status', (e) => statuses.push(e.detail));
  source.addEventListener('data', (e) => frames.push(e.detail));
  return { statuses, frames };
}

test('connect: device chooser with name OR service filter, then connected', async () => {
  const fake = fakeBluetooth();
  const source = createBleSource({ bluetooth: fake.bluetooth });
  const { statuses } = record(source);
  await source.connect();
  assert.deepEqual(fake.requests[0].filters, [{ namePrefix: 'S4 BLE' }, { services: [0x1826] }]);
  assert.deepEqual(fake.requests[0].optionalServices, [0x1826]);
  assert.deepEqual(statuses, ['connecting', 'connected']);
  assert.equal(source.deviceName(), 'S4 BLE 50');
});

test('notifications are forwarded as independent DataView copies', async () => {
  const fake = fakeBluetooth();
  const source = createBleSource({ bluetooth: fake.bluetooth });
  const { frames } = record(source);
  await source.connect();
  fake.push([0xfe, 0x0b, 0x24]);
  fake.push([0x00, 0x08, 0x19, 0x00]);
  assert.equal(frames.length, 2);
  assert.deepEqual([...new Uint8Array(frames[0].buffer)], [0xfe, 0x0b, 0x24]);
  assert.equal(frames[1].byteLength, 4);
});

test('unexpected disconnection => automatic reconnection with back-off', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const fake = fakeBluetooth();
    const source = createBleSource({ bluetooth: fake.bluetooth });
    const { statuses } = record(source);
    await source.connect();
    fake.drop();
    assert.equal(statuses.at(-1), 'disconnected');
    mock.timers.tick(1000);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(statuses.slice(-2), ['connecting', 'connected']);
    assert.equal(fake.requests.length, 1, 'no second device chooser on reconnection');
  } finally {
    mock.timers.reset();
  }
});

test('manual disconnect => no reconnection', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const fake = fakeBluetooth();
    const source = createBleSource({ bluetooth: fake.bluetooth });
    const { statuses } = record(source);
    await source.connect();
    source.disconnect();
    fake.drop();
    mock.timers.tick(20000);
    await new Promise((r) => setImmediate(r));
    assert.ok(!statuses.slice(2).includes('connected'));
  } finally {
    mock.timers.reset();
  }
});

test('first connection failure is reported to the caller', async () => {
  const fake = fakeBluetooth({ failConnects: 1 });
  const source = createBleSource({ bluetooth: fake.bluetooth });
  await assert.rejects(source.connect(), { name: 'NetworkError' });
});

// ---------- Rower already allowed for this site: no chooser (navigator.bluetooth.getDevices) ----------
function knownRowerBluetooth({ connectOk = true, connectDelayMs = 0 } = {}) {
  const fake = fakeBluetooth();
  const known = new EventTarget();
  known.name = 'S4 BLE 50';
  known.gatt = {
    connected: false,
    connect: () => new Promise((resolve, reject) => setTimeout(() => {
      if (!connectOk) return reject(Object.assign(new Error('not in range'), { name: 'NetworkError' }));
      known.gatt.connected = true;
      resolve({ getPrimaryService: async () => ({ getCharacteristic: async () => {
        const c = new EventTarget(); c.startNotifications = async () => c; return c;
      } }) });
    }, connectDelayMs)),
    disconnect: () => { known.gatt.connected = false; },
  };
  fake.bluetooth.getDevices = async () => [{ name: 'Casque' }, known];
  return fake;
}

test('already allowed rower: direct connection, the chooser is not opened', async () => {
  const fake = knownRowerBluetooth();
  const source = createBleSource({ bluetooth: fake.bluetooth });
  const { statuses } = record(source);
  await source.connect();
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(statuses, ['connecting', 'connected']);
  assert.equal(source.deviceName(), 'S4 BLE 50');
});

test('direct connection fails while the user gesture is still valid: the chooser opens', async () => {
  const fake = knownRowerBluetooth({ connectOk: false });
  const source = createBleSource({ bluetooth: fake.bluetooth, userActivation: { isActive: true } });
  await source.connect();
  assert.equal(fake.requests.length, 1);
  assert.equal(source.deviceName(), 'S4 BLE 50');
});

test('direct connection too slow and gesture expired: GestureNeeded, the next tap opens the chooser', async () => {
  const fake = knownRowerBluetooth({ connectDelayMs: 200 });
  const first = createBleSource({ bluetooth: fake.bluetooth, userActivation: { isActive: false }, knownTimeoutMs: 50 });
  const { statuses } = record(first);
  await assert.rejects(first.connect(), { name: 'GestureNeeded' });
  assert.equal(fake.requests.length, 0);
  await new Promise((r) => setTimeout(r, 250)); // the abandoned attempt finishes: it must not announce "connected"
  assert.ok(!statuses.includes('connected'));
  const second = createBleSource({ bluetooth: fake.bluetooth, userActivation: { isActive: true } });
  await second.connect();
  assert.equal(fake.requests.length, 1, 'second tap: straight to the chooser');
});

test('no getDevices in this browser: the chooser as before', async () => {
  const fake = fakeBluetooth();
  assert.equal(fake.bluetooth.getDevices, undefined);
  await createBleSource({ bluetooth: fake.bluetooth }).connect();
  assert.equal(fake.requests.length, 1);
});

// ---------- Reconnection and disconnect races (docs: the S4 accepts a single connection) ----------
const settle = () => new Promise((r) => setImmediate(r));

test('disconnect event fired twice: a single timer, nothing reconnects after disconnect()', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const fake = fakeBluetooth();
    const source = createBleSource({ bluetooth: fake.bluetooth });
    await source.connect();
    const before = fake.connects();
    fake.drop();
    fake.drop(); // gattserverdisconnected + the catch of a failed attempt can both schedule
    source.disconnect();
    mock.timers.tick(30000);
    await settle();
    assert.equal(fake.connects(), before, 'no attach after disconnect()');
    assert.equal(fake.device.gatt.connected, false);
  } finally {
    mock.timers.reset();
  }
});

test('disconnect() while an attach() is in flight: it must not end up connected', async () => {
  const fake = fakeBluetooth();
  let release;
  const gate = new Promise((r) => { release = r; });
  const original = fake.device.gatt.connect;
  fake.device.gatt.connect = async () => { await gate; return original(); };
  const source = createBleSource({ bluetooth: fake.bluetooth });
  const { statuses } = record(source);
  const connecting = source.connect();
  await settle();
  source.disconnect();
  release();
  await assert.rejects(connecting, { name: 'AbortError' });
  assert.equal(fake.device.gatt.connected, false, 'the late link is closed');
  assert.ok(!statuses.includes('connected'));
});

test('reconnection attempt in flight when disconnect() is called: no connection afterwards', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const fake = fakeBluetooth();
    const source = createBleSource({ bluetooth: fake.bluetooth });
    const { statuses } = record(source);
    await source.connect();
    let release;
    const gate = new Promise((r) => { release = r; });
    const original = fake.device.gatt.connect;
    fake.device.gatt.connect = async () => { await gate; return original(); };
    fake.drop();
    mock.timers.tick(1000); // the timer fires: attach() waits on the gate
    await settle();
    source.disconnect();
    const n = statuses.length;
    release();
    await settle();
    assert.equal(fake.device.gatt.connected, false);
    assert.ok(!statuses.slice(n).includes('connected'));
  } finally {
    mock.timers.reset();
  }
});

test('failed connection that leaves the GATT open: it is closed', async () => {
  const fake = fakeBluetooth();
  const original = fake.device.gatt.connect;
  fake.device.gatt.connect = async () => {
    const server = await original();
    server.getPrimaryService = async () => { throw Object.assign(new Error('no FTMS'), { name: 'NotFoundError' }); };
    return server;
  };
  const source = createBleSource({ bluetooth: fake.bluetooth });
  await assert.rejects(source.connect(), { name: 'NotFoundError' });
  assert.equal(fake.device.gatt.connected, false);
});

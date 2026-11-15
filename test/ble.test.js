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
  device.gatt = {
    connected: false,
    connect: async () => {
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
  return { bluetooth, requests, push, drop };
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

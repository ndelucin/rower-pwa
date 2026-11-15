import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRowerData, createRowerState, formatPace } from '../src/ftms.js';
import { buildRowerFrame, fromHex } from './frame-builder.js';

// Reference values observed with nRF Connect (docs/BRIEF.md § 2).
const AT_REST = {
  strokeRate: 0, strokeCount: 0, avgStrokeRate: 0, totalDistance: 0,
  instPace: null, avgPace: null, instPower: 0, avgPower: 0, resistance: 170,
  totalEnergy: 0, energyPerHour: 0, energyPerMinute: 0, heartRate: 0, elapsedTime: 0,
};
const ROWING = {
  strokeRate: 18, strokeCount: 6, avgStrokeRate: 18.5, totalDistance: 45,
  instPace: 278, avgPace: 284, instPower: 21, avgPower: 16, resistance: 170,
  totalEnergy: 2, energyPerHour: 374, energyPerMinute: 6, heartRate: 0, elapsedTime: 25,
};

test('raw hex frame "rowing" (independent of the encoder)', () => {
  const bytes = fromHex('FE0B 24 0600 25 2D0000 1601 1C01 1500 1000 AA00 0200 7601 06 00 1900');
  assert.equal(bytes.length, 27);
  const r = parseRowerData(bytes);
  assert.equal(r.flags, 0x0bfe);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.fields, ROWING);
});

test('reference "at rest": pace 65535 => null', () => {
  const frame = buildRowerFrame(AT_REST);
  assert.equal(frame.getUint16(0, true), 0x0bfe);
  assert.equal(frame.getUint16(11, true), 0xffff); // instPace sentinel on the wire
  assert.deepEqual(parseRowerData(frame).fields, AT_REST);
});

test('reference "rowing" round-trips through the encoder', () => {
  const r = parseRowerData(buildRowerFrame(ROWING));
  assert.equal(r.flags, 0x0bfe);
  assert.deepEqual(r.fields, ROWING);
});

test('bit 0 inverted: set => no stroke rate / count, next fields at the right offset', () => {
  const r = parseRowerData(buildRowerFrame({ avgStrokeRate: 18.5, totalDistance: 45, elapsedTime: 25 }));
  assert.equal(r.flags, 0x0807);
  assert.equal(r.moreData, true);
  assert.deepEqual(r.fields, { avgStrokeRate: 18.5, totalDistance: 45, elapsedTime: 25 });
});

test('uint24 distance above 65535 m and negative sint16 power', () => {
  const r = parseRowerData(buildRowerFrame({ totalDistance: 70000, instPower: -5 }));
  assert.equal(r.fields.totalDistance, 70000);
  assert.equal(r.fields.instPower, -5);
});

test('sparse flags: elapsed only, then elapsed + remaining + MET', () => {
  assert.deepEqual(parseRowerData(buildRowerFrame({ elapsedTime: 600 })).fields, { elapsedTime: 600 });
  const r = parseRowerData(buildRowerFrame({ met: 7.3, elapsedTime: 600, remainingTime: 600 }));
  assert.deepEqual(r.fields, { met: 7.3, elapsedTime: 600, remainingTime: 600 });
});

test('truncated frame keeps complete fields and does not throw', () => {
  const full = new Uint8Array(buildRowerFrame(ROWING).buffer);
  const r = parseRowerData(full.slice(0, 10)); // instPace needs bytes 9-10, only 9 is there
  assert.equal(r.truncated, true);
  assert.deepEqual(r.fields, { strokeRate: 18, strokeCount: 6, avgStrokeRate: 18.5, totalDistance: 45 });
  assert.equal(parseRowerData(new Uint8Array([0xfe])).truncated, true);
});

test('state merges two fragments into a complete snapshot', () => {
  const state = createRowerState();
  const { strokeRate, strokeCount, ...rest } = ROWING;
  state.apply(parseRowerData(buildRowerFrame(rest)));            // bit 0 = 1 (more data)
  const snap = state.apply(parseRowerData(buildRowerFrame({ strokeRate, strokeCount }))); // flags 0x0000
  assert.deepEqual(snap, ROWING);
  state.apply(parseRowerData(buildRowerFrame({ instPace: null })));
  assert.equal(state.snapshot().instPace, null); // "no data" overrides an old value
});

test('formatPace', () => {
  assert.equal(formatPace(278), '4:38');
  assert.equal(formatPace(65), '1:05');
  assert.equal(formatPace(null), '--');
});

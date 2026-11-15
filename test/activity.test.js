import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createActivityFilter } from '../src/activity.js';

// Real session recorded on 2026-11-15 (docs/S4-OBSERVATIONS.md): one decoded line per S4 second.
const { series } = JSON.parse(readFileSync(new URL('./fixtures/s4-2026-11-15-series.json', import.meta.url)));
const toMs = (hhmmss) => {
  const [h, m, s] = hhmmss.split(':').map(Number);
  return ((h * 60 + m) * 60 + s) * 1000;
};

/** Replays the recorded session through the filter, returns the filtered line at each time. */
function replay() {
  const filter = createActivityFilter();
  return new Map(series.map((line) => [line.at, filter.update(line, toMs(line.at))]));
}

test('real session: stale values at connection are hidden until the first stroke', () => {
  const out = replay();
  const atConnection = out.get('16:21:35');
  assert.equal(atConnection.state, 'waiting');
  assert.equal(series[0].instPace, 185, 'the S4 really sends a stale pace here');
  assert.equal(atConnection.instPace, null);
  assert.equal(atConnection.strokeRate, null);
});

test('real session: while rowing, instantaneous values pass through', () => {
  const v = replay().get('16:22:20');
  assert.equal(v.state, 'rowing');
  assert.equal(v.instPace, 192);
  assert.equal(v.strokeRate, 21);
  assert.equal(v.instPower, 93);
});

test('real session: after stopping, frozen power is hidden', () => {
  const v = replay().get('16:22:46');
  assert.equal(series.find((l) => l.at === '16:22:46').instPower, 127, 'the S4 really keeps 127 W');
  assert.equal(v.state, 'stopped');
  assert.equal(v.instPower, null);
  assert.equal(v.totalDistance, 170, 'cumulative values are kept');
});

test('real session: the phantom stroke after 13 s of rest does not restart the session', () => {
  const raw = series.find((l) => l.at === '16:22:55');
  assert.equal(raw.instPace, 139, 'the S4 really brings back an old pace');
  const v = replay().get('16:22:55');
  assert.equal(v.state, 'stopped');
  assert.equal(v.instPace, null);
  assert.equal(v.strokeRate, null);
});

test('real start-stop session, raw frames through the whole chain (decode -> merge -> filter)', async () => {
  const { parseRowerData, createRowerState } = await import('../src/ftms.js');
  const { raw } = JSON.parse(readFileSync(new URL('./fixtures/s4-2026-11-15-startstop-raw.json', import.meta.url)));
  const state = createRowerState();
  const filter = createActivityFilter();
  const transitions = [];
  for (const [ms, hex] of raw) {
    const bytes = Uint8Array.from(hex.split(' ').map((h) => parseInt(h, 16)));
    const v = filter.update(state.apply(parseRowerData(bytes)), ms);
    if (v.state !== transitions.at(-1)?.split('@')[0]) transitions.push(`${v.state}@${v.strokeCount}`);
  }
  // What Nico saw on the phone: 4 rowing periods, each stop detected.
  assert.deepEqual(transitions, [
    'waiting@0', 'rowing@1', 'stopped@8', 'rowing@9', 'stopped@13',
    'rowing@14', 'stopped@16', 'rowing@17', 'stopped@17',
  ]);
});

test('slow strokes (every 5 s) still count as rowing', () => {
  const f = createActivityFilter();
  f.update({ strokeCount: 0, instPower: 0 }, 0);
  for (let i = 1; i <= 4; i++) {
    const v = f.update({ strokeCount: i, instPower: 80, instPace: 150 }, i * 5000);
    assert.equal(v.state, 'rowing');
    assert.equal(f.update({ strokeCount: i, instPower: 80, instPace: 150 }, i * 5000 + 4900).state, 'rowing');
  }
});

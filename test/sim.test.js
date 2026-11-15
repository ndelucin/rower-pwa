import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseRowerData, createRowerState } from '../src/ftms.js';
import { splitRowerData } from '../src/ftms-encoder.js';
import { createSimulator, createSimSource } from '../src/sim.js';

const run = (sim, seconds) => { let f = []; for (let i = 0; i < seconds; i++) f = sim.tick(1); return f; };
const decode = (frames) => {
  const state = createRowerState();
  for (const f of frames) state.apply(parseRowerData(f));
  return state.snapshot();
};

test('rest scenario looks like the "at rest" reference: nothing moves, pace = no data', () => {
  const v = decode(run(createSimulator({ scenario: 'rest' }), 10));
  assert.equal(v.totalDistance, 0);
  assert.equal(v.elapsedTime, 0); // S4 timer only starts at the first stroke
  assert.equal(v.instPace, null);
  assert.equal(v.strokeRate, 0);
  assert.equal(v.resistance, 170);
});

test('steady 2:10 / 22 spm without noise: 60 s gives consistent totals', () => {
  const sim = createSimulator({ scenario: 'steady', jitter: 0 });
  const v = decode(run(sim, 60));
  assert.equal(v.elapsedTime, 60);
  assert.equal(v.totalDistance, 230);   // 60 s × 500/130 m/s = 230.8 m
  assert.equal(v.strokeCount, 22);
  assert.equal(v.strokeRate, 22);
  assert.equal(v.instPace, 130);
  assert.equal(v.avgPace, 130);
  assert.equal(v.instPower, 159);       // 2.8 × (500/130)³
  assert.equal(v.avgPower, 159);
});

test('hiit follows its phases', () => {
  const sim = createSimulator({ scenario: 'hiit', jitter: 0 });
  run(sim, 130);
  assert.equal(sim.phase, 'effort');
  assert.equal(sim.values.strokeRate, 28);
  run(sim, 40);                          // t = 170 s, inside the first recovery
  assert.equal(sim.phase, 'récup');
  assert.equal(sim.values.instPace, 160);
  run(sim, 1200);                        // long after the end
  assert.equal(sim.phase, 'repos');
  assert.equal(sim.values.instPace, null);
  assert.ok(sim.values.elapsedTime > 0, 'the S4 timer keeps the session time after stopping');
});

test('same seed => same session (reproducible), different seed => different', () => {
  const a = run(createSimulator({ seed: 42 }), 30).map((f) => Buffer.from(f.buffer).toString('hex'));
  const b = run(createSimulator({ seed: 42 }), 30).map((f) => Buffer.from(f.buffer).toString('hex'));
  const c = run(createSimulator({ seed: 7 }), 30).map((f) => Buffer.from(f.buffer).toString('hex'));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('20-byte link: frames fit, only the last carries stroke data, merged result is identical', () => {
  const whole = createSimulator({ seed: 3 });
  const split = createSimulator({ seed: 3, maxFrameBytes: 20 });
  const frames = run(split, 45);
  assert.ok(frames.length >= 2);
  for (const f of frames) assert.ok(f.byteLength <= 20, `frame of ${f.byteLength} bytes`);
  const parsed = frames.map((f) => parseRowerData(f));
  assert.ok(parsed.slice(0, -1).every((p) => p.moreData));
  assert.equal(parsed.at(-1).moreData, false);
  assert.deepEqual(decode(frames), decode(run(whole, 45)));
});

test('splitRowerData never loses a field', () => {
  const sim = createSimulator({ jitter: 0 });
  sim.tick(1);
  const parts = splitRowerData(sim.values, 20);
  assert.deepEqual(Object.assign({}, ...parts), sim.values);
});

test('sim source honours the data-source contract (status + data events)', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const source = createSimSource({ scenario: 'steady', jitter: 0 });
    const statuses = [];
    const frames = [];
    source.addEventListener('status', (e) => statuses.push(e.detail));
    source.addEventListener('data', (e) => frames.push(e.detail));
    source.connect();
    mock.timers.tick(3000);
    source.disconnect();
    mock.timers.tick(3000);
    assert.deepEqual(statuses, ['connecting', 'connected', 'disconnected']);
    assert.equal(frames.length, 3);
    assert.equal(decode(frames).elapsedTime, 3);
  } finally {
    mock.timers.reset();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmoother } from '../src/smooth.js';

const frame = (strokeCount, instPace, instPower, extra = {}) => ({ strokeCount, instPace, instPower, strokeRate: 20, ...extra });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('the first stroke is passed through unchanged', () => {
  const s = createSmoother();
  const out = s.update(frame(1, 130, 120));
  near(out.instPace, 130);
  assert.equal(out.instPower, 120);
});

test('power is the mean of the last 3 strokes', () => {
  const s = createSmoother();
  s.update(frame(1, 130, 100));
  s.update(frame(2, 130, 110));
  assert.equal(s.update(frame(3, 130, 120)).instPower, 110);
  assert.equal(s.update(frame(4, 130, 140)).instPower, (110 + 120 + 140) / 3); // the oldest one leaves
});

test('no new stroke, no new measure: frames between two strokes do not weigh in', () => {
  const s = createSmoother();
  s.update(frame(1, 130, 100));
  s.update(frame(2, 130, 140));
  assert.equal(s.update(frame(2, 130, 140)).instPower, 120);
  assert.equal(s.update(frame(2, 130, 140)).instPower, 120);
});

test('split: the mean of the speeds, not of the seconds', () => {
  const s = createSmoother({ window: 2 });
  s.update(frame(1, 120, 150));
  const out = s.update(frame(2, 180, 150));
  near(out.instPace, 500 / ((500 / 120 + 500 / 180) / 2)); // 144 s
  assert.ok(Math.abs(out.instPace - 144) < 1e-9);
});

test('a window of 2 strokes (programmes)', () => {
  const s = createSmoother({ window: 2 });
  s.update(frame(1, 130, 100));
  s.update(frame(2, 130, 120));
  assert.equal(s.update(frame(3, 130, 160)).instPower, 140);
});

test('setWindow shrinks the window at once', () => {
  const s = createSmoother();
  s.update(frame(1, 130, 100));
  s.update(frame(2, 130, 120));
  s.update(frame(3, 130, 160));
  s.setWindow(2);
  assert.equal(s.update(frame(4, 130, 180)).instPower, 170);
});

test('hidden values (stopped) empty the window: a restart is not mixed with old strokes', () => {
  const s = createSmoother();
  s.update(frame(1, 130, 200));
  s.update(frame(2, 130, 200));
  const stopped = frame(2, null, null, { strokeRate: null });
  assert.deepEqual(s.update(stopped), stopped);
  const out = s.update(frame(3, 150, 100));
  near(out.instPace, 150);
  assert.equal(out.instPower, 100);
});

test('reset forgets the strokes of the previous session', () => {
  const s = createSmoother();
  s.update(frame(1, 130, 200));
  s.update(frame(2, 130, 200));
  s.reset();
  assert.equal(s.update(frame(3, 130, 100)).instPower, 100);
});

test('the other fields and the input object are left alone', () => {
  const s = createSmoother();
  const input = frame(1, 130, 120, { totalDistance: 12 });
  const out = s.update(input);
  assert.equal(out.strokeRate, 20);
  assert.equal(out.totalDistance, 12);
  assert.equal(input.instPace, 130);
});

test('smoothing reduces the stroke-to-stroke jitter of a real session', async () => {
  const { readFileSync } = await import('node:fs');
  const file = JSON.parse(readFileSync(new URL('./fixtures/rower-session-2026-11-18.json', import.meta.url), 'utf8'));
  const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  const steady = file.samples.filter((x) => x.t >= 175 && x.t <= 230 && x.w > 100 && x.split);
  const s = createSmoother();
  const raw = [];
  const smoothed = [];
  for (const x of steady) {
    raw.push(x.w);
    smoothed.push(s.update(frame(x.strokes, x.split, x.w)).instPower);
  }
  assert.ok(sd(smoothed) < sd(raw), `${sd(smoothed)} !< ${sd(raw)}`);
});

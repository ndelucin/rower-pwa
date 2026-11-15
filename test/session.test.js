import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession, best500 } from '../src/session.js';
import { createActivityFilter } from '../src/activity.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

/** Steady synthetic rowing: one frame per second, one stroke every 2 s, `speed` m/s. */
function row(session, { from, to, count, dist, speed = 4, w = 150, spm = 30 }) {
  let snap;
  for (let t = from; t <= to; t += 1000) {
    if ((t - from) % 2000 === 0) count++;
    dist += speed;
    snap = session.update({ state: 'rowing', strokeCount: count, totalDistance: dist, instPower: w, strokeRate: spm, instPace: 125 }, t);
  }
  return { snap, count, dist };
}
/** New session that has received the initial S4 values (counters at 0) before the first stroke. */
function fresh() {
  const s = createSession();
  s.update({ state: 'waiting', strokeCount: 0, totalDistance: 0 }, -1000);
  return s;
}
const idle = (session, { from, to, count, dist, state = 'stopped' }) => {
  let snap;
  for (let t = from; t <= to; t += 1000) snap = session.update({ state, strokeCount: count, totalDistance: dist, instPower: null }, t);
  return snap;
};

test('waiting until the first stroke; baselines are taken there, the first stroke counts as 1', () => {
  const s = createSession();
  let snap = s.update({ state: 'waiting', strokeCount: 40, totalDistance: 1000 }, 0);
  assert.deepEqual(snap, { status: 'waiting', elapsed: 0, displayElapsed: 0, distance: 0, activeDistance: 0, avgSplit: null, strokes: 0 });
  snap = s.update({ state: 'waiting', strokeCount: 40, totalDistance: 1002 }, 2000); // handle moved, no stroke
  assert.equal(snap.distance, 0);
  snap = s.update({ state: 'rowing', strokeCount: 41, totalDistance: 1003, instPower: 100 }, 5000);
  assert.equal(snap.status, 'active');
  assert.equal(snap.elapsed, 0);
  assert.equal(snap.strokes, 1);
  assert.equal(snap.distance, 0, 'metres before the first stroke are not counted');
  snap = s.update({ state: 'rowing', strokeCount: 42, totalDistance: 1015, instPower: 100 }, 7500);
  assert.equal(snap.elapsed, 2.5);
  assert.equal(snap.strokes, 2);
  assert.equal(snap.distance, 12);
  close(snap.avgSplit, (2.5 * 500) / 12);
});

test('pause is dated at the last stroke, and the clock resumes at the next rowing', () => {
  const s = fresh();
  let { snap, count, dist } = row(s, { from: 0, to: 10000, count: 0, dist: 0 }); // last stroke at 10 s
  assert.equal(snap.elapsed, 10);
  // Activity keeps 'rowing' for 6 s without stroke, then 'stopped'.
  for (let t = 11000; t <= 15000; t += 1000) snap = s.update({ state: 'rowing', strokeCount: count, totalDistance: dist, instPower: 150 }, t);
  assert.equal(snap.elapsed, 15, 'the clock runs until the stop is detected');
  snap = idle(s, { from: 16000, to: 30000, count, dist: dist + 5 });
  assert.equal(snap.status, 'paused');
  assert.equal(snap.elapsed, 10, 'idle seconds before detection are not counted');
  // Baseline = 4 m (first rowing frame); last stroke at 40 m.
  assert.equal(snap.distance, dist + 5 - 4, 'inertia metres during the pause are counted in distance');
  assert.equal(snap.activeDistance, 40, '...but not in the active distance');
  assert.equal(snap.avgSplit, 125);
  ({ snap } = row(s, { from: 31000, to: 35000, count, dist: dist + 5 }));
  assert.equal(snap.status, 'active');
  assert.equal(snap.elapsed, 14);
  assert.equal(snap.activeDistance, 40 + 16, 'the active distance resumes from the resume point');
  const sum = s.end(36000);
  assert.equal(sum.duration, 14, 'end() also stops the clock at the last stroke');
  assert.equal(sum.distance, 65);
  assert.equal(sum.activeDistance, 56);
  assert.equal(sum.avgSplit, 125, '4 m/s while active');
  assert.equal(sum.startedAt, 0);
  assert.equal(sum.endedAt, 36000);
  assert.equal(sum.samples.length, 14);
  assert.deepEqual(sum.samples.map((x) => x.t), [...Array(14)].map((_, i) => i + 1));
  assert.equal(s.update({ state: 'rowing', strokeCount: 99, totalDistance: 9999, instPower: 1 }, 40000).status, 'ended');
});

test('phantom stroke while stopped does not resume', () => {
  const s = fresh();
  const { count, dist } = row(s, { from: 0, to: 10000, count: 0, dist: 0 });
  idle(s, { from: 11000, to: 20000, count, dist });
  const snap = idle(s, { from: 21000, to: 25000, count: count + 1, dist }); // stroke +1, activity says stopped
  assert.equal(snap.status, 'paused');
  assert.equal(snap.elapsed, 10);
  assert.equal(snap.strokes, count + 1);
});

test('suspend() pauses at the last stroke; resume only after a new stroke', () => {
  const s = fresh();
  const { count, dist } = row(s, { from: 0, to: 10000, count: 0, dist: 0 });
  let snap = s.suspend(12000);
  assert.equal(snap.status, 'paused');
  assert.equal(snap.elapsed, 10);
  // After reconnection, the filter may still say 'rowing' on the old stroke: no resume.
  snap = s.update({ state: 'rowing', strokeCount: count, totalDistance: dist, instPower: 150 }, 14000);
  assert.equal(snap.status, 'paused');
  snap = s.update({ state: 'rowing', strokeCount: count + 1, totalDistance: dist + 4, instPower: 150 }, 20000);
  assert.equal(snap.status, 'active');
  snap = s.update({ state: 'rowing', strokeCount: count + 2, totalDistance: dist + 8, instPower: 150 }, 22000);
  assert.equal(snap.elapsed, 12);
});

test('summary: averages weighted by active time, samples one per second', () => {
  const s = createSession();
  s.update({ state: 'rowing', strokeCount: 1, totalDistance: 0, instPower: 100, strokeRate: 20, instPace: 150 }, 0);
  // 100 W for 3 s, then 200 W for 1 s: time-weighted mean = 125 W (a mean of frames would give 150).
  s.update({ state: 'rowing', strokeCount: 2, totalDistance: 12, instPower: 100, strokeRate: 20, instPace: 150 }, 3000);
  s.update({ state: 'rowing', strokeCount: 3, totalDistance: 16, instPower: 200, strokeRate: 30, instPace: 120 }, 4000);
  const sum = s.end(5000);
  assert.equal(sum.duration, 4);
  assert.equal(sum.avgPower, 125);
  assert.equal(sum.avgSpm, 22.5);
  assert.deepEqual(sum.samples[0], { t: 1, d: 4, split: 150, w: 100, spm: 20, strokes: 2 });
  assert.equal(sum.best500, null, 'less than 500 m');
  close(sum.avgSplit, (4 * 500) / 16);
});

test('best500: sliding window with interpolation', () => {
  assert.equal(best500([{ t: 0, d: 0 }, { t: 100, d: 400 }]), null);
  // 4 m/s for 100 s, then 5 m/s for 100 s: best 500 m = 100 s at 5 m/s.
  const pts = [];
  for (let t = 0; t <= 200; t++) pts.push({ t, d: t <= 100 ? 4 * t : 400 + 5 * (t - 100) });
  close(best500(pts), 100);
  // Uneven points: the start of the window is interpolated between two points.
  close(best500([{ t: 0, d: 0 }, { t: 10, d: 100 }, { t: 210, d: 500 }, { t: 310, d: 520 }]), 210);
  close(best500([{ t: 0, d: 0 }, { t: 2, d: 100 }, { t: 8, d: 700 }]), 5); // start at d = 200 m -> t = 3 s
});

test('best500 on a synthetic session (fast middle part)', () => {
  const s = fresh();
  let r = row(s, { from: 0, to: 199000, count: 0, dist: 0, speed: 4 }); // 800 m in 200 s
  r = row(s, { from: 200000, to: 299000, count: r.count, dist: r.dist, speed: 5 }); // 500 m in 100 s
  row(s, { from: 300000, to: 399000, count: r.count, dist: r.dist, speed: 4 });
  const sum = s.end(400000);
  close(sum.best500, 100, 1e-6);
});

test('toJSON round trip: a restored session continues and ends with the same summary', () => {
  const run = (cut) => {
    let s = fresh();
    let count = 0;
    let dist = 0;
    for (let t = 0; t <= 60000; t += 700) {
      if (t === cut) s = createSession({ restore: JSON.parse(JSON.stringify(s.toJSON())) });
      const stopped = t > 20000 && t < 35000;
      if (!stopped && t % 2100 === 0) count++;
      if (!stopped) dist += 3;
      s.update({ state: stopped ? 'stopped' : 'rowing', strokeCount: count, totalDistance: dist, instPower: stopped ? null : 120, strokeRate: 24 }, t);
    }
    return s.end(61000);
  };
  const ref = run(-1);
  assert.deepEqual(run(14000), ref);
  assert.deepEqual(run(28000), ref, 'restored during a pause');
});

test('real start-stop session: 4 rowing periods, pauses excluded from the clock', async () => {
  const { parseRowerData, createRowerState } = await import('../src/ftms.js');
  const { raw } = JSON.parse(readFileSync(new URL('./fixtures/s4-2026-11-15-startstop-raw.json', import.meta.url)));
  const state = createRowerState();
  const filter = createActivityFilter();
  const session = createSession();
  const periods = []; // [first rowing ms, last stroke ms, distance at first rowing, distance at last stroke]
  let prev = null;
  let pauses = 0;
  let lastCount = null;
  for (const [ms, hex] of raw) {
    const bytes = Uint8Array.from(hex.split(' ').map((h) => parseInt(h, 16)));
    const v = filter.update(state.apply(parseRowerData(bytes)), ms);
    if (v.state === 'rowing' && prev?.state !== 'rowing') periods.push([ms, ms, v.totalDistance, v.totalDistance]);
    if (lastCount != null && v.strokeCount > lastCount && v.state === 'rowing') Object.assign(periods.at(-1), { 1: ms, 3: v.totalDistance });
    lastCount = v.strokeCount;
    const snap = session.update(v, ms);
    if (snap.status === 'paused' && prev?.status === 'active') pauses++;
    prev = { state: v.state, status: snap.status };
  }
  assert.equal(periods.length, 4);
  assert.equal(pauses, 4);
  const expected = periods.reduce((a, [s, e]) => a + (e - s), 0) / 1000;
  const sum = session.end(raw.at(-1)[0]);
  close(sum.duration, expected, 0.01);
  assert.ok(sum.duration > 30 && sum.duration < 40, `duration ${sum.duration}`);
  assert.ok(sum.duration < (raw.at(-1)[0] - periods[0][0]) / 2000, 'well under the wall-clock time');
  assert.equal(sum.strokes, 17);
  assert.equal(sum.distance, 185, 'everything since the first stroke, inertia included');
  const activeDistance = periods.reduce((a, [, , d0, d1]) => a + (d1 - d0), 0);
  assert.equal(sum.activeDistance, activeDistance);
  assert.equal(sum.activeDistance, 120);
  close(sum.avgSplit, (sum.duration * 500) / 120);
  assert.ok(sum.avgSplit > 140 && sum.avgSplit < 160, `avgSplit ${sum.avgSplit}, a realistic pace`);
  assert.equal(sum.samples.length, Math.floor(sum.duration));
  assert.ok(sum.avgPower > 50 && sum.avgPower < 120, `avgPower ${sum.avgPower}`);
});

test('real session: the phantom stroke after 13 s of rest does not resume', () => {
  const { series } = JSON.parse(readFileSync(new URL('./fixtures/s4-2026-11-15-series.json', import.meta.url)));
  const toMs = (hhmmss) => hhmmss.split(':').map(Number).reduce((a, x) => a * 60 + x, 0) * 1000;
  const filter = createActivityFilter();
  const session = createSession();
  const snaps = new Map(series.map((l) => [l.at, session.update(filter.update(l, toMs(l.at)), toMs(l.at))]));
  const atPause = snaps.get('16:22:46');
  assert.equal(atPause.status, 'paused');
  const phantom = snaps.get('16:22:55');
  assert.equal(phantom.status, 'paused');
  assert.equal(phantom.elapsed, atPause.elapsed, 'clock frozen');
  assert.equal(phantom.strokes, atPause.strokes + 1, 'the phantom stroke is still counted');
});

test('real session of the v1 screen trial (2026-11-15): replay gives the summary seen on the phone', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseRowerData, createRowerState } = await import('../src/ftms.js');
  const { createActivityFilter } = await import('../src/activity.js');
  const { raw } = JSON.parse(readFileSync(new URL('./fixtures/s4-2026-11-15-ecran-v1-raw.json', import.meta.url)));
  const rower = createRowerState(), filter = createActivityFilter(), session = createSession();
  const statuses = [];
  let last;
  for (const [ms, hex] of raw) {
    const values = filter.update(rower.apply(parseRowerData(Uint8Array.from(hex.split(' ').map((h) => parseInt(h, 16))))), ms);
    const { status } = session.update(values, ms);
    if (status !== statuses.at(-1)) statuses.push(status);
    last = ms;
  }
  // The two phantom strokes of this session (158.8 s and 268.4 s) must not resume it.
  assert.deepEqual(statuses, ['waiting', 'active', 'paused', 'active', 'paused', 'active', 'paused']);
  const s = session.end(last);
  // Phone screen: 2:17, 604 m, split 2:13, 106 W, 20 /min, best 500 m 2:12.
  assert.equal(Math.floor(s.duration), 137);
  assert.equal(s.distance, 604);
  assert.equal(Math.round(s.avgSplit), 133);
  assert.equal(Math.round(s.avgPower), 106);
  assert.equal(Math.round(s.avgSpm), 20);
  assert.equal(Math.floor(s.best500), 131);
});

test('displayed chrono never goes backwards at a dated-back pause, the summary keeps the real time', () => {
  const s = createSession();
  s.update({ strokeCount: 0, totalDistance: 0, instPower: 0, state: 'waiting' }, 0);
  s.update({ strokeCount: 1, totalDistance: 5, instPower: 150, state: 'rowing' }, 1000);
  s.update({ strokeCount: 4, totalDistance: 40, instPower: 150, state: 'rowing' }, 10000); // last stroke
  const before = s.update({ strokeCount: 4, totalDistance: 44, instPower: 150, state: 'rowing' }, 14000);
  const paused = s.update({ strokeCount: 4, totalDistance: 45, instPower: null, state: 'stopped' }, 14500);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.elapsed, 9);                       // 1 s -> 10 s (last stroke)
  assert.ok(paused.displayElapsed >= before.displayElapsed); // 13.5 s shown, no jump back
  assert.equal(paused.displayElapsed, 13.5);
  assert.equal(s.end(20000).duration, 9);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, engineOf } from '../src/engine.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// 10 s warm-up, 2 efforts of 20 s with 10 s recovery (the last one included), 5 s cool-down.
const SMALL = { phases: [
  { type: 'warmup', duration: 10 },
  { type: 'block', reps: 2, work: 20, rest: 10 },
  { type: 'cooldown', duration: 5 },
] };

test('segments are expanded in order with their start', () => {
  const e = createEngine(SMALL);
  assert.deepEqual(e.segments.map((s) => [s.tone, s.duration, s.start]),
    [['warm', 10, 0], ['work', 20, 10], ['rest', 10, 30], ['work', 20, 40], ['rest', 10, 60], ['warm', 5, 70]]);
  assert.equal(e.duration, 75);
});

test('a pyramid ends its block on the last effort (no recovery after it)', () => {
  const e = createEngine({ phases: [{ type: 'block', efforts: [30, 60, 30], rest: 20 }] });
  assert.deepEqual(e.segments.map((s) => s.tone), ['work', 'rest', 'work', 'rest', 'work']);
  assert.equal(e.duration, 30 + 20 + 60 + 20 + 30);
});

test('position: name, counter, countdown and fraction of the current segment', () => {
  const e = createEngine(SMALL);
  let p = e.positionAt(0);
  assert.deepEqual([p.name, p.count, p.tone, p.remaining, p.fraction, p.finished], ['ÉCHAUFFEMENT', '', 'warm', 10, 0, false]);
  p = e.positionAt(10); // transitions are exact: the new segment starts at its start
  assert.deepEqual([p.name, p.count, p.tone, p.remaining], ['EFFORT', '1 / 2', 'work', 20]);
  p = e.positionAt(35);
  assert.deepEqual([p.name, p.count, p.tone, p.remaining], ['RÉCUP', '1 / 2', 'rest', 5]);
  near(p.fraction, 0.5);
  p = e.positionAt(45);
  assert.deepEqual([p.name, p.count, p.remaining], ['EFFORT', '2 / 2', 15]);
  p = e.positionAt(72);
  assert.deepEqual([p.name, p.count, p.tone, p.remaining], ['RETOUR AU CALME', '', 'warm', 3]);
});

test('end of the programme: finished, last segment at 100 %, stays there afterwards', () => {
  const e = createEngine(SMALL);
  assert.equal(e.positionAt(74.9).finished, false);
  for (const t of [75, 500]) {
    const p = e.positionAt(t);
    assert.deepEqual([p.finished, p.name, p.remaining, p.fraction], [true, 'RETOUR AU CALME', 0, 1]);
  }
  assert.equal(e.positionAt(-3).name, 'ÉCHAUFFEMENT'); // never before the start
});

test('frieze: the segments of the current phase only, proportional, past / running / to come', () => {
  const e = createEngine(SMALL);
  assert.equal(e.positionAt(5).frieze.length, 1, 'a single segment gives one arc');
  const f = e.positionAt(45).frieze; // phase = block, 60 s long, we are 5 s into the 2nd effort
  assert.deepEqual(f.map((a) => a.tone), ['work', 'rest', 'work', 'rest']);
  near(f[0].to, 20 / 60);
  near(f[1].from, 20 / 60);
  near(f[3].to, 1);
  assert.deepEqual(f.map((a) => a.progress), [1, 1, 0.25, 0]);
});

test('several sets: counter prefixed by the set, long recovery between sets', () => {
  const e = engineOf('3x6x30');
  assert.equal(e.positionAt(240).count, 'S1 · 1 / 6');
  const rest = e.segments.filter((s) => s.name === 'RÉCUP LONGUE');
  assert.equal(rest.length, 2);
  assert.equal(e.positionAt(rest[0].start).count, '');
  assert.equal(e.positionAt(rest[0].start + rest[0].duration).count, 'S2 · 1 / 6');
  assert.equal(e.segments.filter((s) => s.count.startsWith('S3')).length, 12);
});

test('a single block has no set prefix', () => {
  assert.equal(engineOf('6x1').positionAt(300).count, '1 / 6');
});

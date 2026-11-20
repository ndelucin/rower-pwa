import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REFERENCE, referenceSplit, targetZone } from '../src/target.js';

const session = (i, avgSplit, duration = 1200) => ({ startedAt: i * 1000, avgSplit, duration });

test('reference: 2:15 without history', () => {
  assert.equal(DEFAULT_REFERENCE, 135);
  assert.equal(referenceSplit([]), 135);
});

test('reference: median of the last 5 sessions (any order of the list)', () => {
  const list = [session(1, 100), session(2, 130), session(3, 128), session(4, 126), session(5, 140), session(6, 124)];
  assert.equal(referenceSplit(list), 128); // last five: 130 128 126 140 124
  assert.equal(referenceSplit([...list].reverse()), 128);
});

test('reference: sessions of 10 min or less (and without split) are ignored', () => {
  const list = [session(1, 120, 600), session(2, 110, 300), session(3, null), session(4, 130)];
  assert.equal(referenceSplit(list), 130);
  assert.equal(referenceSplit([session(1, 120, 600)]), 135);
});

test('reference: even count gives the mean of the two middle values', () => {
  assert.equal(referenceSplit([session(1, 126), session(2, 130)]), 128);
});

test('target zone: offset by effort length, example with 2:08', () => {
  const ref = 128;
  assert.deepEqual(targetZone(ref, 30), { from: 120, to: 124 });
  assert.deepEqual(targetZone(ref, 45), { from: 122, to: 126 });
  assert.deepEqual(targetZone(ref, 60), { from: 122, to: 126 });
  assert.deepEqual(targetZone(ref, 90), { from: 125, to: 128 });
  assert.deepEqual(targetZone(ref, 120), { from: 125, to: 128 });
  assert.deepEqual(targetZone(ref, 240), { from: 127, to: 131 });
});

test('reference: programme sessions are left out (fast on average, they would push the zone up)', () => {
  const list = [
    session(1, 130), session(2, 128), session(3, 126),
    { ...session(4, 110), goalKind: 'program' }, // an interval session
    { ...session(5, 140), goalKind: 'free' },
  ];
  assert.equal(referenceSplit(list), 129); // 130 128 126 140 (the programme's 110 ignored): mean of the middle two
});

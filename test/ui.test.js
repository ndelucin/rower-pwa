import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration, formatNumber, formatDistance, splitBarPosition, ringArcs, ringCircumference,
} from '../src/ui/format.js';

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(754), '12:34');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(null), '--');
});

test('formatNumber', () => {
  assert.equal(formatNumber(21.4), '21');
  assert.equal(formatNumber(18.5, 1), '18.5');
  assert.equal(formatNumber(null), '--');
});

test('formatDistance: thousands separator, floor, null', () => {
  assert.equal(formatDistance(0), '0');
  assert.equal(formatDistance(999.9), '999');
  assert.equal(formatDistance(1250.7), '1 250');
  assert.equal(formatDistance(10000), '10 000');
  assert.equal(formatDistance(null), '--');
});

test('splitBarPosition: 2:30 on the left, 1:50 on the right', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  assert.deepEqual(splitBarPosition(150), { ratio: 0, clamp: null });
  assert.deepEqual(splitBarPosition(110), { ratio: 1, clamp: null });
  near(splitBarPosition(130).ratio, 0.5);
  near(splitBarPosition(126).ratio, 0.6); // 2:06 -> 60 % (mock-up)
  assert.equal(splitBarPosition(126).clamp, null);
});

test('splitBarPosition: off scale sticks to the edge with an arrow side', () => {
  assert.deepEqual(splitBarPosition(165), { ratio: 0, clamp: 'left' });
  assert.deepEqual(splitBarPosition(100), { ratio: 1, clamp: 'right' });
  assert.equal(splitBarPosition(null), null);
  assert.equal(splitBarPosition(NaN), null);
  // custom scale
  assert.deepEqual(splitBarPosition(120, { slow: 140, fast: 100 }), { ratio: 0.5, clamp: null });
});

test('ringArcs: single arc from a fraction', () => {
  const c = ringCircumference(46);
  assert.ok(Math.abs(c - 289.03) < 0.01);
  // 1250 / 2000 m = 62.5 % -> 180.6 (mock-up)
  const [arc] = ringArcs([{ from: 0, to: 0.625 }]);
  assert.equal(arc.dasharray, '180.64 289.03');
  assert.equal(arc.dashoffset, 0);
  assert.equal(ringArcs([{ from: 0, to: 0 }])[0].length, 0);
  // fractions are clamped to [0, 1]
  assert.equal(ringArcs([{ from: -1, to: 2 }])[0].dasharray, '289.03 289.03');
});

test('ringArcs: several arcs with a gap (v2 interval frieze)', () => {
  const arcs = ringArcs([{ from: 0, to: 0.5 }, { from: 0.5, to: 1 }], { r: 50, gap: 0.01 });
  const c = ringCircumference(50);
  assert.equal(arcs.length, 2);
  assert.ok(Math.abs(arcs[0].length - 0.49 * c) < 0.01);
  assert.equal(arcs[0].dashoffset, 0);
  assert.ok(Math.abs(arcs[1].dashoffset + 0.5 * c) < 0.01);
  // an arc shorter than the gap is not drawn (no negative length)
  assert.equal(ringArcs([{ from: 0, to: 0.005 }], { gap: 0.01 })[0].length, 0);
});

test('ringArcs: a segment can carry its own gap (programme frieze)', () => {
  const [a, b] = ringArcs([{ from: 0, to: 0.5, gap: 0.01 }, { from: 0.5, to: 1 }]);
  assert.ok(Math.abs(a.length - 0.49 * ringCircumference(46)) < 0.01);
  assert.ok(Math.abs(b.length - 0.5 * ringCircumference(46)) < 0.01);
});

test('formatDistanceShort: metres below 1 km, km with a comma above, rounded up', async () => {
  const { formatDistanceShort } = await import('../src/ui/format.js');
  assert.equal(formatDistanceShort(750), '750 m');
  assert.equal(formatDistanceShort(749.2), '750 m');
  assert.equal(formatDistanceShort(1500), '1,5 km');
  assert.equal(formatDistanceShort(2000), '2,0 km');
  assert.equal(formatDistanceShort(0), '0 m');
  assert.equal(formatDistanceShort(null), '--');
});

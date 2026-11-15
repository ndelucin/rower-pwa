import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatNumber, sparklinePath } from '../src/ui/format.js';

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

test('sparklinePath: scale, inversion and gaps', () => {
  assert.equal(sparklinePath([], {}), '');
  assert.equal(sparklinePath([0, 10], { width: 100, height: 100, pad: 0 }), 'M0.0 100.0 L100.0 0.0');
  assert.equal(sparklinePath([0, 10], { width: 100, height: 100, pad: 0, invert: true }), 'M0.0 0.0 L100.0 100.0');
  // a null (no data, e.g. a pause) lifts the pen: two separate segments
  assert.equal(
    sparklinePath([0, 10, null, 0, 10], { width: 4, height: 10, pad: 0 }),
    'M0.0 10.0 L1.0 0.0 M3.0 10.0 L4.0 0.0',
  );
  // flat series does not divide by zero
  assert.match(sparklinePath([5, 5, 5], { width: 2, height: 10, pad: 0 }), /^M0\.0 5\.0 L1\.0 5\.0 L2\.0 5\.0$/);
});

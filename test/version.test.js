import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILD, formatBuild } from '../src/version.js';

test('BUILD has a number and an ISO date', () => {
  assert.ok(Number.isInteger(BUILD.number) && BUILD.number >= 0);
  assert.ok(!Number.isNaN(Date.parse(BUILD.at)));
});

test('formatBuild: "build N · dd/mm hh:mm"', () => {
  assert.match(formatBuild({ number: 14, at: '2026-11-15T20:34:00.000Z' }), /^build 14 · \d{2}\/\d{2} \d{2}:\d{2}$/);
});

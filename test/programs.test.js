import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMS, getProgram } from '../src/programs.js';
import { createEngine, engineOf } from '../src/engine.js';

test('six programmes, ids unique, intensity 1 to 3', () => {
  assert.deepEqual(PROGRAMS.map((p) => p.id), ['pyramide', '6x1', '8x1', '4x2', '4x4', '3x6x30']);
  assert.equal(new Set(PROGRAMS.map((p) => p.id)).size, PROGRAMS.length);
  for (const p of PROGRAMS) assert.ok([1, 2, 3].includes(p.level), p.id);
  assert.equal(getProgram('4x4').name, '4 × 4 min');
  assert.equal(getProgram('nope'), undefined);
});

test('the phases of each programme add up to its announced duration', () => {
  for (const p of PROGRAMS) assert.equal(createEngine(p).duration, p.minutes * 60, p.id);
});

test('every phase is well formed', () => {
  for (const p of PROGRAMS) {
    assert.equal(p.phases[0].type, 'warmup', p.id);
    assert.equal(p.phases.at(-1).type, 'cooldown', p.id);
    for (const ph of p.phases) {
      if (ph.type === 'block') assert.ok(ph.efforts || (ph.reps > 0 && ph.work > 0), p.id);
      else assert.ok(ph.duration > 0, p.id);
    }
  }
});

test('engineOf builds each engine once', () => {
  assert.equal(engineOf('pyramide'), engineOf('pyramide'));
});

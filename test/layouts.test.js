import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centre, programCentre, programTarget } from '../src/ui/layouts.js';
import { targetZone } from '../src/target.js';

// Models are built by hand: the pure parts of the screens (what the ring and the split bar show) are
// tested without a DOM.
const model = (session, extra = {}) => ({ session, values: {}, ...extra });

test('free session: elapsed time in the centre, ring in distance colour, one turn per 2000 m', () => {
  const c = centre(null);
  const m = model({ status: 'active', displayElapsed: 522, distance: 1250 });
  assert.equal(c.label(m), 'Temps écoulé');
  assert.equal(c.main(m), '8:42');
  assert.deepEqual(c.arcs(m), [{ from: 0, to: 0.625, tone: 'dist' }]);
  assert.equal(c.label(model({ status: 'paused', displayElapsed: 10 })), 'En pause');
  assert.equal(c.arcs(model({ distance: 2000 }))[0].to, 1); // a full turn stays full
});

test('duration goal: countdown and a ring that fills in the colour of time', () => {
  const c = centre({ kind: 'duration', target: 1200 });
  const m = model({ status: 'active', displayElapsed: 522, elapsed: 522 });
  assert.equal(c.label(m), 'Temps restant');
  assert.equal(c.main(m), '11:18');
  assert.deepEqual(c.arcs(m), [{ from: 0, to: 522 / 1200, tone: 'dur' }]);
});

test('distance goal: remaining distance, short form, ring in distance colour', () => {
  const c = centre({ kind: 'distance', target: 2000 });
  const m = model({ status: 'active', distance: 1250 });
  assert.equal(c.label(m), 'Distance restante');
  assert.equal(c.main(m), '750 m');
  assert.deepEqual(c.arcs(m), [{ from: 0, to: 0.625, tone: 'dist' }]);
});

test('programme: the warm-up first, then the first effort, with its counter', () => {
  const goal = { kind: 'program', programId: 'pyramide' };
  const c = programCentre(goal);
  const warm = model({ status: 'waiting', wallElapsed: 0 });
  assert.equal(c.label(warm), 'ÉCHAUFFEMENT');
  assert.equal(c.main(warm), '4:00');
  assert.equal(c.count(warm), '');
  const effort = model({ status: 'active', wallElapsed: 250 }); // 10 s into the first 30 s effort
  assert.equal(c.label(effort), 'EFFORT');
  assert.equal(c.main(effort), '0:20');
  assert.equal(c.count(effort), '1 / 5');
  assert.equal(c.tone(effort), 'work');
  assert.equal(c.dimmed(model({ status: 'paused', wallElapsed: 250 })), false); // a programme never shows a pause
});

test('programme: the target zone exists during an effort only, and follows its length', () => {
  const goal = { kind: 'program', programId: 'pyramide' };
  assert.equal(programTarget(goal, 130, model({ wallElapsed: 100 })), null); // warm-up
  assert.deepEqual(programTarget(goal, 130, model({ wallElapsed: 250 })), targetZone(130, 30)); // 30 s effort
  assert.equal(programTarget(goal, 130, model({ wallElapsed: 275 })), null); // recovery after it
  assert.deepEqual(programTarget(goal, 130, model({ wallElapsed: 240 + 30 + 60 + 10 })), targetZone(130, 60)); // 2nd effort: 60 s
});

test('programme: the frieze of a block has one faint arc per segment and one filling arc for the running one', () => {
  const c = programCentre({ kind: 'program', programId: 'pyramide' });
  const arcs = c.arcs(model({ wallElapsed: 250 }));
  assert.ok(arcs.length >= 2);
  assert.ok(arcs.every((a) => a.segment));
  assert.ok(arcs.some((a) => !a.faint)); // the running segment fills up
});

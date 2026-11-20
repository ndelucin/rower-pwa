import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOAL_LIMITS, clampGoal, stepGoal, goalFromAngle, goalDisplay, goalPresetLabel, goalName, goalProgress,
} from '../src/goal.js';

const TURN = 2 * Math.PI;

test('clampGoal rounds to the step and stays in range', () => {
  assert.equal(clampGoal('duration', 1234), 1230);
  assert.equal(clampGoal('duration', 99999), GOAL_LIMITS.duration.max);
  assert.equal(clampGoal('distance', -50), 0);
  assert.equal(clampGoal('distance', 2240), 2000);
});

test('stepGoal moves by one step and stops at both ends', () => {
  assert.equal(stepGoal('duration', 1200, 1), 1230);
  assert.equal(stepGoal('distance', 500, -1), 0);
  assert.equal(stepGoal('distance', 0, -1), 0);
  assert.equal(stepGoal('distance', 8000, 1), 8000);
});

test('goalFromAngle: quarter turns map to a quarter of the range', () => {
  assert.equal(goalFromAngle('duration', TURN / 4, 1200), 900);
  assert.equal(goalFromAngle('distance', TURN / 2, 4000), 4000);
  assert.equal(goalFromAngle('distance', TURN * 0.75, 6000), 6000);
});

test('goalFromAngle: the knob does not jump across the top', () => {
  // near the maximum, pointer just after 12 o'clock: stays at the maximum
  assert.equal(goalFromAngle('distance', 0.05, 7800), 8000);
  // near zero, pointer just before 12 o'clock: stays at zero
  assert.equal(goalFromAngle('distance', TURN - 0.05, 200), 0);
});

test('goalDisplay and labels', () => {
  assert.deepEqual(goalDisplay('duration', 1200), { text: '20:00', unit: 'min' });
  assert.deepEqual(goalDisplay('duration', 90), { text: '1:30', unit: 'min' });
  assert.deepEqual(goalDisplay('distance', 2000), { text: '2,0', unit: 'km' });
  assert.deepEqual(goalDisplay('distance', 500), { text: '0,5', unit: 'km' });
  assert.equal(goalPresetLabel('duration', 2700), '45 min');
  assert.equal(goalPresetLabel('distance', 5000), '5 km');
  assert.equal(goalName({ kind: 'duration', target: 1200 }), 'Durée 20 min');
  assert.equal(goalName(null), 'Séance libre');
});

test('goalProgress: duration uses the displayed chrono', () => {
  const goal = { kind: 'duration', target: 1200 };
  const p = goalProgress(goal, { elapsed: 290, displayElapsed: 300, distance: 1000 });
  assert.equal(p.done, 300);
  assert.equal(p.remaining, 900);
  assert.equal(p.fraction, 0.25);
  assert.equal(p.reached, false);
  assert.equal(goalProgress(goal, { elapsed: 1195, displayElapsed: 1200 }).reached, true);
});

test('goalProgress: distance, waiting session and overshoot', () => {
  const goal = { kind: 'distance', target: 2000 };
  assert.deepEqual(goalProgress(goal, { elapsed: 0, displayElapsed: 0, distance: 0 }),
    { done: 0, remaining: 2000, fraction: 0, reached: false });
  const p = goalProgress(goal, { distance: 2012 });
  assert.equal(p.remaining, 0);
  assert.equal(p.fraction, 1);
  assert.equal(p.reached, true);
});

// Session goals (v2): a duration (s) or a distance (m) to reach, chosen on the circular picker,
// or a programme { kind: 'program', programId } to complete (src/engine.js).
// Pure module: no DOM, no clock. The goal is an addition to the session, not part of its data:
// session.js and the export file do not know about it (docs/cinematique.md).
import { getProgram } from './programs.js';
import { engineOf } from './engine.js';

export const GOAL_KINDS = ['duration', 'distance']; // the kinds chosen on the circular picker

/** Picker range per kind: `max` is one full turn of the ring, `step` the granularity, `def` the starting value. */
export const GOAL_LIMITS = {
  duration: { max: 3600, step: 30, def: 1200 }, // s
  distance: { max: 8000, step: 500, def: 2000 }, // m
};

/** The four quick values offered next to the picker. */
export const GOAL_PRESETS = {
  duration: [600, 1200, 1800, 2700],
  distance: [1000, 2000, 5000, 8000],
};

/** 30..3600 s or 500..8000 m, rounded to the step. */
export function clampGoal(kind, value) {
  const { max, step } = GOAL_LIMITS[kind];
  return Math.max(0, Math.min(max, Math.round(value / step) * step));
}

/** Value + step * dir (dir = +1 / -1), kept in range. */
export function stepGoal(kind, value, dir) {
  const { max, step } = GOAL_LIMITS[kind];
  return Math.max(0, Math.min(max, value + dir * step));
}

/**
 * Value under the pointer: `angle` in radians clockwise from 12 o'clock (0..2π).
 * 0 and the maximum meet at the top: when the current value is near one end and the pointer lands near
 * the other, the knob stops at the end instead of jumping across.
 */
export function goalFromAngle(kind, angle, current) {
  const { max, step } = GOAL_LIMITS[kind];
  const a = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let v = Math.round((a / (2 * Math.PI)) * max / step) * step;
  if (current > max * 0.75 && v < max * 0.25) v = max;
  else if (current < max * 0.25 && v > max * 0.75) v = 0;
  return Math.max(0, Math.min(max, v));
}

/** Picker display: { text: "20:00", unit: "min" } or { text: "2,0", unit: "km" }. */
export function goalDisplay(kind, value) {
  if (kind === 'duration') {
    const m = Math.floor(value / 60);
    return { text: `${m}:${String(Math.round(value % 60)).padStart(2, '0')}`, unit: 'min' };
  }
  return { text: (value / 1000).toFixed(1).replace('.', ','), unit: 'km' };
}

/** Short label of a quick value: "20 min", "2 km". */
export function goalPresetLabel(kind, value) {
  return kind === 'duration' ? `${value / 60} min` : `${value / 1000} km`;
}

/** Name used in the export file: "Durée 20 min", "Distance 2 km". */
export function goalName(goal) {
  if (!goal) return 'Séance libre';
  if (goal.kind === 'program') return getProgram(goal.programId).name;
  return `${goal.kind === 'duration' ? 'Durée' : 'Distance'} ${goalPresetLabel(goal.kind, goal.target)}`;
}

/** The `program` field of the export file: { id, name, kind } ('intervals' for a programme). */
export function goalExport(goal) {
  if (!goal) return undefined;
  if (goal.kind === 'program') return { id: goal.programId, name: goalName(goal), kind: 'intervals' };
  return { id: `${goal.kind}-${goal.target}`, name: goalName(goal), kind: goal.kind };
}

const DONE = {
  // The duration uses the displayed chrono (it never goes backwards), so the countdown and the end
  // of the session agree on screen. A programme runs on the wall clock (src/engine.js).
  duration: (snap) => snap.displayElapsed ?? snap.elapsed ?? 0,
  distance: (snap) => snap.distance ?? 0,
  program: (snap) => snap.wallElapsed ?? 0,
};

/**
 * Progress towards a goal, from session.snapshot().
 * -> { done, remaining, fraction (0..1), reached }
 */
export function goalProgress(goal, snap) {
  const target = goal.kind === 'program' ? engineOf(goal.programId).duration : goal.target;
  const done = DONE[goal.kind](snap);
  return {
    done,
    remaining: Math.max(0, target - done),
    fraction: target > 0 ? Math.min(1, done / target) : 0,
    reached: target > 0 && done >= target,
  };
}

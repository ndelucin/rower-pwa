// Decides whether the user is actually rowing, because the S4 does not clean its values
// (docs/S4-OBSERVATIONS.md): stale pace/stroke rate at connection, frozen power when stopped,
// "phantom" stroke after ~13 s of rest that brings back old values.
//
// Rule: rowing = the stroke count increased less than `idle` ago AND the power is > 0.
// `idle` adapts to the stroke rhythm: 1.5 x the interval between the last two strokes, bounded to
// [minIdleMs, maxIdleMs] (S4 trials: 2.8 s between strokes at 21 spm, 3.8 s at most => stop seen after 4 s;
// slow recovery at 15 spm => 6 s). Before two strokes are known, `idleMs` is used.
// When not rowing, instantaneous fields become null (displayed "--"); cumulative fields are untouched.
// Pure module: time is passed in, so it is testable on recorded sessions.

export const INSTANT_FIELDS = ['strokeRate', 'instPace', 'instPower', 'energyPerHour', 'energyPerMinute'];

/** state: 'waiting' (no stroke seen yet) | 'rowing' | 'stopped' */
export function createActivityFilter({ idleMs = 6000, minIdleMs = 4000, maxIdleMs = 8000, factor = 1.5 } = {}) {
  let lastCount = null;
  let lastIncreaseAt = null;
  let idle = idleMs;    // current stop threshold (ms)
  let prev = null; // previous frame: { power, distance }

  return {
    update(values, now) {
      const count = values.strokeCount;
      if (count != null) {
        // First value seen is only a reference: a count that was already there is not a stroke.
        // "Phantom" stroke of the S4 (~12 s after a stop): the count goes up while power and distance
        // are exactly those of the previous frame (frozen values). A real stroke changes the power.
        const phantom = prev != null && values.totalDistance != null
          && values.instPower === prev.power && values.totalDistance === prev.distance;
        if (lastCount != null && count > lastCount && !phantom) {
          // Interval between two strokes of the same rowing period (not across a stop).
          const interval = lastIncreaseAt != null ? now - lastIncreaseAt : null;
          if (interval != null && interval < idle) idle = Math.min(maxIdleMs, Math.max(minIdleMs, factor * interval));
          else idle = idleMs;
          lastIncreaseAt = now;
        }
        lastCount = count;
      }
      prev = { power: values.instPower, distance: values.totalDistance };
      const recent = lastIncreaseAt != null && now - lastIncreaseAt < idle;
      const rowing = recent && (values.instPower ?? 0) > 0;
      const state = rowing ? 'rowing' : lastIncreaseAt == null ? 'waiting' : 'stopped';

      const out = { ...values, state };
      if (!rowing) for (const k of INSTANT_FIELDS) if (k in out) out[k] = null;
      return out;
    },
  };
}

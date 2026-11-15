// Decides whether the user is actually rowing, because the S4 does not clean its values
// (docs/S4-OBSERVATIONS.md): stale pace/stroke rate at connection, frozen power when stopped,
// "phantom" stroke after ~13 s of rest that brings back old values.
//
// Rule: rowing = the stroke count increased less than `idleMs` ago AND the power is > 0.
// When not rowing, instantaneous fields become null (displayed "--"); cumulative fields are untouched.
// Pure module: time is passed in, so it is testable on recorded sessions.

export const INSTANT_FIELDS = ['strokeRate', 'instPace', 'instPower', 'energyPerHour', 'energyPerMinute'];

/** state: 'waiting' (no stroke seen yet) | 'rowing' | 'stopped' */
export function createActivityFilter({ idleMs = 6000 } = {}) {
  let lastCount = null;
  let lastIncreaseAt = null;
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
        if (lastCount != null && count > lastCount && !phantom) lastIncreaseAt = now;
        lastCount = count;
      }
      prev = { power: values.instPower, distance: values.totalDistance };
      const recent = lastIncreaseAt != null && now - lastIncreaseAt < idleMs;
      const rowing = recent && (values.instPower ?? 0) > 0;
      const state = rowing ? 'rowing' : lastIncreaseAt == null ? 'waiting' : 'stopped';

      const out = { ...values, state };
      if (!rowing) for (const k of INSTANT_FIELDS) if (k in out) out[k] = null;
      return out;
    },
  };
}

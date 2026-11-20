// Display smoothing of the instantaneous power and split (docs/ECRAN.md, "Lissage").
// The S4 sends one raw value per stroke (power jumps by +-7 W from one stroke to the next, the split is a
// whole number of seconds) whereas its own screen is smoothed. Pure module: no DOM, no clock.
//
// - A value is taken only when the stroke count changes: values arrive once per stroke, so a window
//   in seconds would be wrong. The window is the last `window` strokes.
// - Power = mean of the watts. Split = mean of the SPEEDS (500 / split), turned back into a split: one very
//   slow stroke must not drag the average (120 s and 180 s average to 144 s, not 150 s).
// - When the activity filter hides the instantaneous values (null: stopped), the window is emptied, so that a
//   restart is not mixed with old strokes.
// Only the display uses the smoothed values: the session, its averages and the export keep the raw ones.

export const DEFAULT_WINDOW = 3; // strokes
export const PROGRAMME_WINDOW = 2; // strokes: efforts of 30 s leave little time for a longer window

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

export function createSmoother({ window = DEFAULT_WINDOW } = {}) {
  let size = window;
  let paces = [];
  let powers = [];
  let lastCount = null;

  const push = (list, value) => {
    list.push(value);
    if (list.length > size) list.splice(0, list.length - size);
  };

  const reset = () => { paces = []; powers = []; lastCount = null; };

  return {
    setWindow(n) { size = n; },

    /** Forgets every stroke (new session). */
    reset,

    /** values = output of activity.update(); returns a copy with instPace and instPower smoothed. */
    update(values) {
      if (values.instPace == null || values.instPower == null || !(values.instPace > 0)) {
        reset();
        return values;
      }
      if (values.strokeCount !== lastCount) {
        lastCount = values.strokeCount;
        push(paces, 500 / values.instPace);
        push(powers, values.instPower);
      }
      return { ...values, instPace: 500 / mean(paces), instPower: mean(powers) };
    },
  };
}

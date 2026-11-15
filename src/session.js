// Session clock and totals computed by the PWA, because the S4 has no pause (docs/ECRAN.md).
// Input: the output of activity.update() (with .state), and the time `now` in ms.
//
// Rules (docs/PLAN-ecran-v1.md, "A -> séance"):
// - waiting until the first 'rowing'; the clock starts at that `now`.
// - active -> paused when state becomes 'stopped', the pause being dated at the last stroke
//   (last `now` where strokeCount increased): the idle seconds before detection are not counted.
// - paused -> active at the next 'rowing' that follows a new stroke; the clock resumes at that `now`.
// - suspend(now) (Bluetooth loss) and end(now) close the running segment the same way, at the last stroke.
// - distance and strokes start when the session becomes active (the first stroke counts as 1; handle
//   movement before it is not counted), then count everything the S4 sends, including the metres
//   of inertia during a pause and the "phantom" stroke.
// - avgSplit uses the active distance only (metres covered while active, cut back to the last stroke
//   like the clock), so pauses count neither in time nor in distance.
// Samples are in the same active frame: t = active time, d = active distance (no jump for inertia).
// Averages are computed from the per-second samples (sample-and-hold of the last values received),
// so they are weighted by active time and survive a toJSON() round trip unchanged.
// Pure module: no DOM, no clock.

const MIN_SPLIT_DISTANCE = 10; // m
const BEST_DISTANCE = 500; // m

const initialState = () => ({
  status: 'waiting',
  startedAt: null, // ms, first stroke
  endedAt: null, // ms, end()
  activeMs: 0, // closed segments
  segStart: null, // ms, start of the running segment
  pausedAt: null, // ms, date of the last pause
  lastNow: null,
  lastStrokeAt: null,
  lastCount: null, // raw S4 values
  lastDistance: null,
  baseCount: null, // set at the first stroke
  baseDistance: null,
  strokes: 0,
  distance: 0, // m since the first stroke, everything included
  activeDist: 0, // m covered in closed segments (cut back to their last stroke)
  segStartDist: null, // distance at the start of the running segment
  strokeDist: null, // distance at the last stroke
  prev: null, // { e, d }: last (elapsed s, active distance m) point while active, for sample interpolation
  samples: [],
});

export function createSession({ restore } = {}) {
  const s = restore ? structuredClone(restore) : initialState();

  const elapsedMs = () => s.activeMs + (s.status === 'active' ? s.lastNow - s.segStart : 0);
  const activeDistance = () => s.activeDist + (s.status === 'active' ? s.distance - s.segStartDist : 0);
  const avgSplit = (elapsed, distance) => (distance < MIN_SPLIT_DISTANCE ? null : (elapsed * 500) / distance);

  // Closes the running segment at the last stroke, and drops samples taken after it.
  function closeSegment() {
    const until = Math.max(s.segStart, s.lastStrokeAt ?? s.segStart);
    s.activeMs += until - s.segStart;
    s.activeDist += Math.max(0, s.strokeDist - s.segStartDist);
    s.segStart = s.segStartDist = null;
    s.pausedAt = until;
    s.prev = null;
    const e = s.activeMs / 1000;
    while (s.samples.length && s.samples.at(-1).t > e) s.samples.pop();
  }

  function addSamples(values) {
    const e = elapsedMs() / 1000;
    const d = activeDistance();
    if (!s.prev) s.prev = { e, d };
    const { e: e0, d: d0 } = s.prev;
    for (let t = Math.floor(e0) + 1; t <= e; t++) {
      const di = e === e0 ? d : d0 + ((d - d0) * (t - e0)) / (e - e0);
      s.samples.push({
        t,
        d: Math.round(di * 10) / 10,
        split: values.instPace ?? null,
        w: values.instPower ?? null,
        spm: values.strokeRate ?? null,
        strokes: s.strokes,
      });
    }
    s.prev = { e, d };
  }

  const api = {
    update(values, now) {
      if (s.status === 'ended') return api.snapshot();
      s.lastNow = now;

      const count = values.strokeCount;
      const stroke = count != null && s.lastCount != null && count > s.lastCount;
      if (stroke) s.lastStrokeAt = now;
      if (count != null) s.lastCount = count;
      if (values.totalDistance != null) s.lastDistance = values.totalDistance;

      const rowing = values.state === 'rowing';
      if (s.status === 'waiting' && rowing) {
        // Baselines at the first stroke, which counts as 1.
        s.baseCount = (s.lastCount ?? 1) - 1;
        s.baseDistance = s.lastDistance ?? 0;
      }
      if (s.baseCount != null) {
        s.strokes = s.lastCount - s.baseCount;
        s.distance = (s.lastDistance ?? s.baseDistance) - s.baseDistance;
        if (stroke || s.strokeDist == null) s.strokeDist = s.distance;
      }

      if (s.status === 'waiting' && rowing) {
        s.status = 'active';
        s.startedAt = s.segStart = now;
        s.segStartDist = s.distance;
      } else if (s.status === 'paused' && rowing && s.lastStrokeAt > s.pausedAt) {
        s.status = 'active';
        s.segStart = now;
        s.segStartDist = s.distance;
      } else if (s.status === 'active' && values.state === 'stopped') {
        closeSegment();
        s.status = 'paused';
      }
      if (s.status === 'active') addSamples(values);
      return api.snapshot();
    },

    suspend(now) {
      if (s.status === 'ended') return api.snapshot();
      s.lastNow = now;
      if (s.status === 'active') {
        closeSegment();
        s.status = 'paused';
      }
      return api.snapshot();
    },

    end(now) {
      if (s.status !== 'ended') {
        s.lastNow = now;
        if (s.status === 'active') closeSegment();
        s.status = 'ended';
        s.endedAt = now;
      }
      return api.summary();
    },

    snapshot() {
      const elapsed = s.status === 'waiting' ? 0 : elapsedMs() / 1000;
      const activeDist = activeDistance();
      return {
        status: s.status,
        elapsed,
        distance: s.distance,
        activeDistance: activeDist,
        avgSplit: avgSplit(elapsed, activeDist),
        strokes: s.strokes,
      };
    },

    summary() {
      const { elapsed: duration, distance, activeDistance: activeDist, strokes } = api.snapshot();
      const mean = (k) => {
        const v = s.samples.map((x) => x[k]).filter((x) => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      return {
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        duration,
        distance,
        activeDistance: activeDist,
        strokes,
        avgSplit: avgSplit(duration, activeDist),
        avgPower: mean('w'),
        avgSpm: mean('spm'),
        best500: best500([{ t: 0, d: 0 }, ...s.samples, { t: duration, d: activeDist }]),
        samples: s.samples.map((x) => ({ ...x })),
      };
    },

    toJSON() {
      return structuredClone(s);
    },
  };
  return api;
}

/**
 * Fastest 500 m (s) over (t s, d m) points with non-decreasing t and d, linear interpolation
 * between points; null if less than 500 m. Two pointers: for each end point, the start is the
 * last time where the distance was d - 500.
 */
export function best500(points, len = BEST_DISTANCE) {
  let best = null;
  let i = 0;
  for (const end of points) {
    const target = end.d - len;
    if (target < points[0].d) continue;
    while (points[i + 1].d <= target) i++;
    const a = points[i];
    const b = points[i + 1];
    const start = b.d === a.d ? a.t : a.t + ((b.t - a.t) * (target - a.d)) / (b.d - a.d);
    const time = end.t - start;
    if (best == null || time < best) best = time;
  }
  return best;
}

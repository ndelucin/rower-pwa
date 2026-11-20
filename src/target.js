// Split target zone of an effort (docs/ECRAN.md, "Zone cible de split"). Pure module.
// No setting: a personal reference (median average split of the last sessions) plus an offset that depends
// on the length of the effort: the shorter the effort, the faster the zone.

export const DEFAULT_REFERENCE = 135; // s/500 m (2:15): a prudent beginner value, used without history
const MIN_SESSION = 600; // s: shorter sessions say little about a steady pace
const SESSIONS_USED = 5;

// Offsets (s/500 m) added to the reference, by maximum effort length (s).
const OFFSETS = [
  { upTo: 30, low: -8, high: -4 },
  { upTo: 60, low: -6, high: -2 },
  { upTo: 120, low: -3, high: 0 },
  { upTo: Infinity, low: -1, high: 3 },
];

const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

/** Median average split of the last 5 saved sessions longer than 10 min (summaries from store.listSessions()). */
export function referenceSplit(sessions) {
  const splits = [...sessions]
    .filter((s) => s.duration > MIN_SESSION && s.avgSplit != null)
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-SESSIONS_USED)
    .map((s) => s.avgSplit);
  return splits.length ? median(splits) : DEFAULT_REFERENCE;
}

/** Zone to hold during an effort of `effortSeconds`: { from, to } in s/500 m (from = faster bound). */
export function targetZone(reference, effortSeconds) {
  const { low, high } = OFFSETS.find((o) => effortSeconds <= o.upTo);
  return { from: reference + low, to: reference + high };
}

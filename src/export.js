// Session export "rower-session/1" (docs/BRIEF.md § 11): the only contract with the dashboard.
// Pure functions: no DOM, no Web Share here (see app.js). Input = session.summary() of src/session.js.

export const SCHEMA = 'rower-session/1';

const pad = (n) => String(n).padStart(2, '0');
const round = (x, digits = 0) => (x == null ? null : Math.round(x * 10 ** digits) / 10 ** digits);

/** Local date-time with its UTC offset, e.g. "2026-11-15T14:12:00+01:00" (parses back to the same instant). */
export function isoLocal(ms) {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const hh = pad(Math.floor(Math.abs(off) / 60));
  const mm = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
}

/** The export object of a finished session. v1: free session only, so no segments. */
export function buildExport(summary, { program = { id: 'free', name: 'Séance libre', kind: 'free' } } = {}) {
  return {
    schema: SCHEMA,
    id: isoLocal(summary.startedAt),
    program,
    summary: {
      duration: round(summary.duration),
      distance: round(summary.distance),
      avgSplit: round(summary.avgSplit, 1),
      avgPower: round(summary.avgPower),
      avgSpm: round(summary.avgSpm, 1),
      strokes: summary.strokes,
    },
    segments: [],
    samples: summary.samples.map((x) => ({ t: x.t, d: x.d, split: round(x.split, 1), w: x.w, spm: x.spm, strokes: x.strokes })),
    records: summary.best500 != null ? [{ kind: '500m', value: round(summary.best500, 1) }] : [],
  };
}

/** File name without characters Android or Drive dislike: "rower-2026-11-15T14-12.json". */
export function exportFileName(summary) {
  return `rower-${isoLocal(summary.startedAt).slice(0, 16).replace(':', '-')}.json`;
}

/** The file to share or download. */
export function exportFile(summary, FileCtor = globalThis.File) {
  return new FileCtor([JSON.stringify(buildExport(summary))], exportFileName(summary), { type: 'application/json' });
}

// One-off import: converts the sessions of the rowerboard repo (S4 + Polar TCX merge, see its docs/schema.md)
// into rower-session/1 files (docs/BRIEF.md § 11). Heart rate is dropped: the format has no field for it.
// Usage: node scripts/import-rowerboard.js <rowerboard/data/sessions> <output folder>
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { best500 } from '../src/session.js';
import { SCHEMA, isoLocal, round } from '../src/export.js';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node scripts/import-rowerboard.js <sessions folder> <output folder>'); process.exit(1); }
mkdirSync(out, { recursive: true });

const SMOOTH_S = 6;      // pace is measured over about 6 s of distance
const MIN_DIST = 8;      // m over that window, else "not rowing" (no split)
const MAX_SPLIT = 300;   // s / 500 m: slower than that is a pause

function convert(rb) {
  const startedAt = Date.parse(rb.date);
  const series = rb.series;
  const samples = series.map((p, i) => {
    let j = i;
    while (j > 0 && p.t - series[j].t < SMOOTH_S) j -= 1;
    const dd = p.distance - series[j].distance;
    const dt = p.t - series[j].t;
    const split = dd >= MIN_DIST && dt > 0 ? (dt * 500) / dd : null;
    return {
      t: round(p.t), d: round(p.distance, 1),
      split: split != null && split <= MAX_SPLIT ? round(split, 1) : null,
      w: round(p.watts), spm: round(p.strokeRate ?? p.cadence), strokes: null,
    };
  });
  const s = rb.summary;
  const duration = s.duration;
  const best = best500([{ t: 0, d: 0 }, ...series.map((p) => ({ t: p.t, d: p.distance }))]);
  return {
    schema: SCHEMA,
    id: isoLocal(startedAt),
    program: { id: 'free', name: 'Séance libre', kind: 'free' },
    summary: {
      duration: round(duration), distance: round(s.distance),
      avgSplit: round(s.avgPace500, 1), avgPower: round(s.avgWatts), avgSpm: round(s.avgCadence, 1), strokes: null,
    },
    segments: [],
    samples,
    records: best != null ? [{ kind: '500m', value: round(best, 1) }] : [],
  };
}

const rows = [];
for (const file of readdirSync(src).filter((f) => f.endsWith('.json')).sort()) {
  const rb = JSON.parse(readFileSync(join(src, file), 'utf8'));
  const ex = convert(rb);
  const name = `rower-${ex.id.slice(0, 16).replace(':', '-')}.txt`;
  writeFileSync(join(out, name), JSON.stringify(ex));
  rows.push({ name, id: ex.id, duration: ex.summary.duration, distance: ex.summary.distance, avgSplit: ex.summary.avgSplit,
    best500: ex.records[0]?.value ?? null, samples: ex.samples.length, noSplit: ex.samples.filter((x) => x.split == null).length });
}
console.table(rows);
console.log(`${rows.length} fichier(s) écrit(s) dans ${out}`);

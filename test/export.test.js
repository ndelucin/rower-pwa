import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, exportFileName, isoLocal, exportFile, SCHEMA } from '../src/export.js';

const summary = {
  startedAt: Date.UTC(2026, 10, 15, 13, 12, 5),
  endedAt: Date.UTC(2026, 10, 15, 13, 14, 0),
  duration: 110.4, distance: 473.26, activeDistance: 470, strokes: 41,
  avgSplit: 125.04, avgPower: 141.6, avgSpm: 22.46, best500: null,
  samples: [{ t: 1, d: 3.5, split: null, w: 0, spm: 0, strokes: 1 }, { t: 2, d: 7.1, split: 128.34, w: 150, spm: 22, strokes: 2 }],
};

test('isoLocal parses back to the same instant, with an offset', () => {
  const iso = isoLocal(summary.startedAt);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(Date.parse(iso), summary.startedAt);
});

test('buildExport: rower-session/1 shape, rounded values, no 500 m record when too short', () => {
  const e = buildExport(summary);
  assert.equal(e.schema, SCHEMA);
  assert.equal(e.id, isoLocal(summary.startedAt));
  assert.deepEqual(e.program, { id: 'free', name: 'Séance libre', kind: 'free' });
  assert.deepEqual(e.summary, { duration: 110, distance: 473, avgSplit: 125, avgPower: 142, avgSpm: 22.5, strokes: 41 });
  assert.deepEqual(e.segments, []);
  assert.deepEqual(e.samples[1], { t: 2, d: 7.1, split: 128.3, w: 150, spm: 22, strokes: 2 });
  assert.deepEqual(e.records, []);
  assert.deepEqual(buildExport({ ...summary, best500: 118.26 }).records, [{ kind: '500m', value: 118.3 }]);
});

test('exportFileName: no colon, sortable', () => {
  assert.match(exportFileName(summary), /^rower-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.txt$/);
});

test('exportFile: a plain-text file (shareable on Android) carrying the JSON export', async () => {
  const f = exportFile(summary);
  assert.equal(f.type, 'text/plain');
  assert.equal(f.name, exportFileName(summary));
  assert.equal(JSON.parse(await f.text()).schema, SCHEMA);
});

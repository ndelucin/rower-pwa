// Interval programmes offered on the programme list (docs/ECRAN.md, "Séances programmées" ; brief § 6).
// Pure data, no DOM.
//
// A programme is a list of phases, each one either
//  - a single segment: { type: 'warmup' | 'rest' | 'cooldown', duration } (rest = long recovery between sets),
//  - or a block of efforts: { type: 'block', rest, reps, work } (reps × effort / recovery, the last recovery included)
//    or { type: 'block', rest, efforts: [s…] } (efforts of different lengths, no recovery after the last one).
// This is the compact form of the brief's flat segment list: src/engine.js expands it into segments.
// Durations are in seconds. `minutes` is the announced total, checked against the phases by the tests.
// `level` is the intensity, 1 to 3. The split target is not stored here: it comes from the rower's own
// history (src/target.js).

export const PROGRAMS = [
  { id: 'pyramide', name: 'Pyramide', level: 2, minutes: 15, struct: '30-60-90-60-30 s · récup 1 min',
    phases: [{ type: 'warmup', duration: 240 }, { type: 'block', efforts: [30, 60, 90, 60, 30], rest: 60 }, { type: 'cooldown', duration: 150 }] },
  { id: '6x1', name: '6 × 1 min', level: 1, minutes: 20, struct: '1 min effort / 1 min récup',
    phases: [{ type: 'warmup', duration: 300 }, { type: 'block', reps: 6, work: 60, rest: 60 }, { type: 'cooldown', duration: 180 }] },
  { id: '8x1', name: '8 × 1 min', level: 2, minutes: 20, struct: '1 min effort / 30 s récup',
    phases: [{ type: 'warmup', duration: 300 }, { type: 'block', reps: 8, work: 60, rest: 30 }, { type: 'cooldown', duration: 180 }] },
  { id: '4x2', name: '4 × 2 min', level: 2, minutes: 20, struct: '2 min effort / 1:30 récup',
    phases: [{ type: 'warmup', duration: 240 }, { type: 'block', reps: 4, work: 120, rest: 90 }, { type: 'cooldown', duration: 120 }] },
  { id: '4x4', name: '4 × 4 min', level: 3, minutes: 30, struct: '4 min soutenu / 1 min récup',
    phases: [{ type: 'warmup', duration: 300 }, { type: 'block', reps: 4, work: 240, rest: 60 }, { type: 'cooldown', duration: 300 }] },
  { id: '3x6x30', name: '3 × 6 × 30 s', level: 3, minutes: 30, struct: '3 séries · 6 × 30 s / 30 s',
    phases: [
      { type: 'warmup', duration: 240 },
      { type: 'block', reps: 6, work: 30, rest: 30 }, { type: 'rest', duration: 150 },
      { type: 'block', reps: 6, work: 30, rest: 30 }, { type: 'rest', duration: 150 },
      { type: 'block', reps: 6, work: 30, rest: 30 },
      { type: 'cooldown', duration: 180 },
    ] },
];

export const getProgram = (id) => PROGRAMS.find((p) => p.id === id);

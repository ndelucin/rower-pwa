// Programme engine: where a session is in a programme, from the time elapsed since the first stroke.
// Pure module: no DOM, no clock (the time is a parameter).
//
// Clock: the programme runs on the WALL clock of the session (snapshot.wallElapsed: first stroke -> now),
// not on the session chrono, which stops while the rower is stopped. An interval programme must not wait
// for the athlete: a recovery lasts its 60 s whether he keeps rowing gently or stops (docs/ECRAN.md: stopping
// during a recovery is normal). The session still dates its automatic pauses internally (averages stay right),
// but the programme screen never shows them.
//
// The programme (src/programs.js) is expanded into flat segments { tone, name, count, duration, start, phase },
// `tone` being the colour class: 'work' | 'rest' | 'warm' (warm-up and cool-down).
import { getProgram } from './programs.js';

const PHASE_NAME = { warmup: 'ÉCHAUFFEMENT', cooldown: 'RETOUR AU CALME', rest: 'RÉCUP LONGUE' };
const PHASE_TONE = { warmup: 'warm', cooldown: 'warm', rest: 'rest' };

const effortCount = (block) => block.efforts?.length ?? block.reps;

// Effort / recovery pairs of a block. A pyramid ends on its last effort; repeated blocks end on a recovery.
function blockSegments(block) {
  const efforts = block.efforts ?? Array(block.reps).fill(block.work);
  const recoveryAfterLast = block.efforts == null;
  return efforts.flatMap((duration, i) => [
    { tone: 'work', name: 'EFFORT', duration, n: i + 1 },
    ...(i < efforts.length - 1 || recoveryAfterLast ? [{ tone: 'rest', name: 'RÉCUP', duration: block.rest, n: i + 1 }] : []),
  ]);
}

function expand(program) {
  const blocks = program.phases.filter((p) => p.type === 'block');
  const segments = [];
  let start = 0;
  program.phases.forEach((ph, phase) => {
    const isBlock = ph.type === 'block';
    const set = blocks.length > 1 ? `S${blocks.indexOf(ph) + 1} · ` : '';
    const parts = isBlock ? blockSegments(ph) : [{ tone: PHASE_TONE[ph.type], name: PHASE_NAME[ph.type], duration: ph.duration }];
    for (const { n, ...seg } of parts) {
      segments.push({ ...seg, count: isBlock ? `${set}${n} / ${effortCount(ph)}` : '', phase, start });
      start += seg.duration;
    }
  });
  return segments;
}

/** Programme position at `elapsed` seconds, and total duration. */
export function createEngine(program) {
  const segments = expand(program);
  const last = segments.at(-1);
  const duration = last.start + last.duration;

  /**
   * -> { finished, name, count ("S2 · 3 / 6", '' for a single segment), tone, duration (of the segment),
   *      remaining (s), fraction (0..1 of the segment),
   *      frieze: arcs of the current phase, one per segment, as fractions of a turn:
   *        [{ from, to, tone, progress (0 = to come, 1 = past, in between = running) }] }
   */
  function positionAt(elapsed) {
    const t = Math.max(0, elapsed);
    const finished = t >= duration;
    const seg = finished ? last : segments.findLast((s) => s.start <= t);
    const inSegment = Math.min(seg.duration, t - seg.start);
    const phase = segments.filter((s) => s.phase === seg.phase);
    const phaseStart = phase[0].start;
    const phaseLength = phase.reduce((sum, s) => sum + s.duration, 0);
    return {
      finished,
      name: seg.name,
      count: seg.count,
      tone: seg.tone,
      duration: seg.duration,
      remaining: seg.duration - inSegment,
      fraction: inSegment / seg.duration,
      frieze: phase.map((s) => ({
        from: (s.start - phaseStart) / phaseLength,
        to: (s.start + s.duration - phaseStart) / phaseLength,
        tone: s.tone,
        progress: Math.min(1, Math.max(0, (t - s.start) / s.duration)),
      })),
    };
  }

  return { duration, segments, positionAt };
}

const engines = new Map();
/** Engine of a programme by id (built once). */
export function engineOf(programId) {
  if (!engines.has(programId)) engines.set(programId, createEngine(getProgram(programId)));
  return engines.get(programId);
}

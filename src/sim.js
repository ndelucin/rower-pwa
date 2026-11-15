// Fake WaterRower: produces FTMS Rower Data frames as the S4 BLE module would.
// Lets us build the UI and the session engine without the rower.
//
// Two layers:
//  - createSimulator(): pure model, driven by tick(dt). Deterministic (seeded noise) => testable.
//  - createSimSource(): thin timer wrapper exposing the SAME contract ble.js will expose (see below),
//    so the app can switch between real rower and simulator without knowing which one it talks to.
import { encodeRowerData, splitRowerData } from './ftms-encoder.js';

// A phase: rowing at a target split (s/500 m) and stroke rate, or resting (split null, spm 0).
export const SCENARIOS = {
  rest: [{ label: 'repos', duration: Infinity, split: null, spm: 0 }],
  steady: [{ label: 'continu', duration: Infinity, split: 130, spm: 22 }],
  hiit: [
    { label: 'échauffement', duration: 120, split: 150, spm: 20 },
    ...Array.from({ length: 6 }, () => [
      { label: 'effort', duration: 40, split: 115, spm: 28 },
      { label: 'récup', duration: 60, split: 160, spm: 18 },
    ]).flat(),
    { label: 'retour au calme', duration: 120, split: 155, spm: 18 },
    { label: 'repos', duration: Infinity, split: null, spm: 0 },
  ],
};

// Small seeded PRNG (mulberry32): same seed => same session, so tests are reproducible.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const roundHalf = (x) => Math.round(x * 2) / 2;

/**
 * @param {object} opts
 * @param {string|Array} opts.scenario  name in SCENARIOS or a custom phase list
 * @param {number} opts.jitter          relative noise on split and stroke rate (0.03 = ±3 %)
 * @param {number} opts.seed
 * @param {number} opts.maxFrameBytes   Infinity = one 27-byte frame; 20 = split like a default-MTU link
 */
export function createSimulator({ scenario = 'steady', jitter = 0.03, seed = 1, maxFrameBytes = Infinity } = {}) {
  const phases = typeof scenario === 'string' ? SCENARIOS[scenario] : scenario;
  if (!phases) throw new Error(`Unknown scenario: ${scenario}`);
  const rand = prng(seed);
  const noise = () => 1 + jitter * (rand() * 2 - 1);

  // Cumulative state, like the S4 monitor keeps it.
  let t = 0;            // simulated wall time (s)
  let elapsed = 0;      // S4 timer: starts at the first stroke
  let distance = 0;     // m (float, reported floored)
  let strokes = 0;      // float, reported floored
  let energy = 0;       // kcal (float)
  let powerTime = 0;    // ∫ power dt, for average power
  let movingTime = 0;
  let last = null;

  function phaseAt(time) {
    let start = 0;
    for (const p of phases) {
      if (time < start + p.duration) return p;
      start += p.duration;
    }
    return phases[phases.length - 1];
  }

  function tick(dt = 1) {
    const phase = phaseAt(t);
    const rowing = phase.split != null && phase.spm > 0;
    let split = null, spm = 0, power = 0, energyPerHour = 0;

    if (rowing) {
      split = phase.split * noise();
      spm = phase.spm * noise();
      const speed = 500 / split;                 // m/s
      power = 2.8 * speed ** 3;                   // classic rowing-ergometer pace/power relation
      energyPerHour = 4 * power + 300;            // usual ergometer kcal/h estimate
      distance += speed * dt;
      strokes += (spm / 60) * dt;
      energy += (energyPerHour / 3600) * dt;
      powerTime += power * dt;
      movingTime += dt;
    }
    if (rowing || elapsed > 0) elapsed += dt;
    t += dt;

    last = {
      label: phase.label,
      values: {
        strokeRate: roundHalf(spm),
        strokeCount: Math.floor(strokes),
        avgStrokeRate: elapsed > 0 ? roundHalf((strokes / elapsed) * 60) : 0,
        totalDistance: Math.floor(distance),
        instPace: rowing ? Math.round(split) : null,
        avgPace: distance > 0 ? Math.round((elapsed / distance) * 500) : null,
        instPower: Math.round(power),
        avgPower: movingTime > 0 ? Math.round(powerTime / movingTime) : 0,
        resistance: 170,
        totalEnergy: Math.floor(energy),
        energyPerHour: Math.round(energyPerHour),
        energyPerMinute: Math.round(energyPerHour / 60),
        heartRate: 0,
        elapsedTime: Math.floor(elapsed),
      },
    };
    return frames();
  }

  /** Current values encoded as one or several DataViews (one per BLE notification). */
  function frames() {
    if (!last) return [];
    const parts = Number.isFinite(maxFrameBytes) ? splitRowerData(last.values, maxFrameBytes) : [last.values];
    return parts.map(encodeRowerData);
  }

  return {
    tick,
    frames,
    get values() { return last ? { ...last.values } : null; },
    get phase() { return last?.label ?? phaseAt(0).label; },
    get time() { return t; },
  };
}

/**
 * Data source contract (ble.js will implement the same one):
 *   an EventTarget with
 *     - connect(), disconnect()
 *     - 'status' events, detail: 'connecting' | 'connected' | 'disconnected'
 *     - 'data'   events, detail: DataView (one Rower Data notification)
 */
export function createSimSource({ intervalMs = 1000, ...simOptions } = {}) {
  const source = new EventTarget();
  const emit = (type, detail) => source.dispatchEvent(new CustomEvent(type, { detail }));
  let sim = null;
  let timer = null;

  source.connect = () => {
    if (timer) return;
    emit('status', 'connecting');
    sim = createSimulator(simOptions);
    timer = setInterval(() => {
      // Always 1 simulated second per tick; a shorter intervalMs fast-forwards the session.
      for (const frame of sim.tick(1)) emit('data', frame);
    }, intervalMs);
    emit('status', 'connected');
  };
  source.disconnect = () => {
    clearInterval(timer);
    timer = null;
    emit('status', 'disconnected');
  };
  source.simulator = () => sim;
  return source;
}

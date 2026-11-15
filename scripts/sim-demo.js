// Terminal demo of the fake rower, through the REAL decoding chain (encode -> bytes -> decode -> merge).
// Usage: node scripts/sim-demo.js [rest|steady|hiit] [seconds=300] [every=10]
import { createSimulator } from '../src/sim.js';
import { parseRowerData, createRowerState, formatPace } from '../src/ftms.js';

const [scenario = 'hiit', seconds = '300', every = '10'] = process.argv.slice(2);
const sim = createSimulator({ scenario, maxFrameBytes: 20 });
const state = createRowerState();

const pad = (v, n) => String(v).padStart(n);
console.log(`Scénario « ${scenario} », trames découpées à 20 octets\n`);
console.log(' temps  phase              cadence  split /500m  watts  distance  octets reçus');
for (let s = 1; s <= Number(seconds); s++) {
  const frames = sim.tick(1);
  for (const f of frames) state.apply(parseRowerData(f));
  if (s % Number(every)) continue;
  const v = state.snapshot();
  const bytes = frames.map((f) => f.byteLength).join('+');
  console.log(
    `${pad(formatPace(s), 6)}  ${sim.phase.padEnd(17)} ${pad(v.strokeRate, 7)}  ${pad(formatPace(v.instPace), 11)}`
    + `  ${pad(v.instPower, 5)}  ${pad(v.totalDistance + ' m', 8)}  ${bytes}`,
  );
}

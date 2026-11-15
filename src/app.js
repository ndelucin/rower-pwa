// Wiring: data source -> decoder -> merged state -> screen.
// The source is either the simulator or (soon) ble.js: same contract, see CLAUDE.md.
import { parseRowerData, createRowerState } from './ftms.js';
import { createSimSource } from './sim.js';
import { LAYOUTS, mountLayout } from './ui/layouts.js';

const HISTORY_MAX = 3600; // one sample per second of session time

const rower = createRowerState();
const history = [];       // [{ t, pace, power }] for the mini-curve
let status = 'disconnected';
let sourceLabel = '';
let view = null;

// Several notifications can arrive within the same frame (split messages):
// render at most once per animation frame.
let renderPending = false;
function scheduleRender() {
  if (renderPending || !view) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    view.update({ values: rower.snapshot(), history, status, sourceLabel });
  });
}

function record(values) {
  const t = values.elapsedTime;
  if (t == null || history.at(-1)?.t === t) return;
  history.push({ t, pace: values.instPace, power: values.instPower });
  if (history.length > HISTORY_MAX) history.shift();
}

async function enterFullscreenLandscape() {
  // Needs a user gesture; orientation lock only works in fullscreen on Android. Best effort.
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    await window.screen.orientation?.lock?.('landscape');
  } catch { /* desktop browser or refused: the CSS layout still works */ }
}

function startSession(source, label) {
  sourceLabel = label;
  document.getElementById('start').hidden = true;
  const screenEl = document.getElementById('screen');
  screenEl.hidden = false;
  view = mountLayout(screenEl, LAYOUTS.free());

  source.addEventListener('status', (e) => { status = e.detail; scheduleRender(); });
  source.addEventListener('data', (e) => {
    record(rower.apply(parseRowerData(e.detail)));
    scheduleRender();
  });
  source.connect();
  scheduleRender();
}

function startSimulator(scenario) {
  const params = new URLSearchParams(location.search);
  const speed = Number(params.get('speed')) || 1;  // ?speed=10 to fast-forward while developing
  startSession(createSimSource({ scenario, intervalMs: 1000 / speed, maxFrameBytes: 20 }), `Simulateur · ${scenario}`);
}

document.querySelectorAll('[data-sim]').forEach((btn) => btn.addEventListener('click', () => {
  enterFullscreenLandscape();
  startSimulator(btn.dataset.sim);
}));

// ?sim=hiit starts directly (handy during development)
const autoSim = new URLSearchParams(location.search).get('sim');
if (autoSim) startSimulator(autoSim);

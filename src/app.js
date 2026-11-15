// Wiring: data source -> decoder -> merged state -> screen.
// The source is either the simulator or the real rower (ble.js): same contract, see CLAUDE.md.
import { parseRowerData, createRowerState } from './ftms.js';
import { createSimSource } from './sim.js';
import { createBleSource, isBleAvailable } from './ble.js';
import { LAYOUTS, mountLayout } from './ui/layouts.js';
import { createKeepAwake } from './wakelock.js';
import { createActivityFilter } from './activity.js';

const HISTORY_MAX = 3600; // one sample per second of session time

const rower = createRowerState();
const activity = createActivityFilter(); // hides the S4's stale values when not rowing
let display = {};                        // what the screen shows: rower state after the activity filter
const history = [];       // [{ t, pace, power }] for the mini-curve
let status = 'disconnected';
let sourceLabel = '';
let view = null;

// ---------- Diagnostic journal, readable from the Mac (scripts/phone-eval.js) ----------
const diag = (window.__rower = {
  frames: 0,            // notifications received
  sizes: {},            // byte length -> count (answers the "27 bytes vs 20-byte MTU" question)
  moreData: 0,          // frames with the More Data bit set (= split frames)
  truncated: 0,
  flags: {},            // flags (hex) -> count
  last: [],             // last raw frames, hex
  raw: [],              // every raw frame with its reception time (capped)
  events: [],           // status changes, errors, BLE log
  series: [],           // one decoded snapshot per S4 second, with reception time: real-device behaviour
  firstAt: null,        // reception time of the first / latest frame (frequency)
  lastAt: null,
  snapshot: () => rower.snapshot(),
  screenKeptOn: () => keepAwake.active,
});
const hex = (dv) => [...new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)]
  .map((b) => b.toString(16).padStart(2, '0')).join(' ');
function logEvent(msg) {
  diag.events.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (diag.events.length > 100) diag.events.shift();
}
function logFrame(dv, parsed) {
  diag.frames += 1;
  diag.firstAt ??= Date.now();
  diag.lastAt = Date.now();
  diag.sizes[dv.byteLength] = (diag.sizes[dv.byteLength] ?? 0) + 1;
  if (parsed.moreData) diag.moreData += 1;
  if (parsed.truncated) diag.truncated += 1;
  const f = `0x${(parsed.flags ?? 0).toString(16).padStart(4, '0')}`;
  diag.flags[f] = (diag.flags[f] ?? 0) + 1;
  diag.last.push(hex(dv));
  if (diag.last.length > 20) diag.last.shift();
  // Full raw capture (ms since first frame, hex), to build test fixtures from real sessions.
  diag.raw.push([diag.lastAt - diag.firstAt, hex(dv)]);
  if (diag.raw.length > 10000) diag.raw.shift();
}

// Screen stays on during a session, otherwise the page freezes and Bluetooth drops.
const keepAwake = createKeepAwake({ log: logEvent });

// ---------- Rendering ----------
// Several notifications can arrive within the same frame (split messages):
// render at most once per animation frame.
let renderPending = false;
function scheduleRender() {
  if (renderPending || !view) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    view.update({ values: display, history, status, sourceLabel });
  });
}

function record(values) {
  const t = values.elapsedTime;
  if (t == null || history.at(-1)?.t === t) return;
  history.push({ t, pace: values.instPace, power: values.instPower });
  diag.series.push({ at: new Date().toISOString().slice(11, 19), ...values });
  if (diag.series.length > 600) diag.series.shift();
  if (history.length > HISTORY_MAX) history.shift();
}

async function enterFullscreenLandscape() {
  // Needs a user gesture; orientation lock only works in fullscreen on Android. Best effort.
  if (document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    await window.screen.orientation?.lock?.('landscape');
  } catch { /* desktop browser or refused: the CSS layout still works */ }
}

// ---------- Sources ----------
function bindSource(source) {
  source.addEventListener('status', (e) => { status = e.detail; logEvent(`état : ${e.detail}`); scheduleRender(); });
  source.addEventListener('log', (e) => logEvent(e.detail));
  source.addEventListener('data', (e) => {
    const parsed = parseRowerData(e.detail);
    logFrame(e.detail, parsed);
    display = activity.update(rower.apply(parsed), Date.now());
    record(display);
    scheduleRender();
  });
}

function showSession(label) {
  sourceLabel = label;
  document.getElementById('start').hidden = true;
  const screenEl = document.getElementById('screen');
  screenEl.hidden = false;
  view = mountLayout(screenEl, LAYOUTS.free());
  // A tap on the session screen (re)enters fullscreen, e.g. after the Bluetooth chooser.
  screenEl.addEventListener('click', enterFullscreenLandscape);
  keepAwake.start();
  scheduleRender();
}

function startSimulator(scenario) {
  const params = new URLSearchParams(location.search);
  const speed = Number(params.get('speed')) || 1;  // ?speed=10 to fast-forward while developing
  const source = createSimSource({ scenario, intervalMs: 1000 / speed, maxFrameBytes: 20 });
  bindSource(source);
  showSession(`Simulateur · ${scenario}`);
  source.connect();
}

const startMsg = document.getElementById('start-msg');
const BLE_ERRORS = {
  NotFoundError: 'Aucun rameur choisi. Réveille le moniteur S4 (appuie sur un bouton) et ferme WaterRower Connect, puis réessaie.',
  SecurityError: 'Bluetooth refusé : la page doit être servie en HTTPS ou depuis localhost.',
  NotAllowedError: 'Autorisation Bluetooth refusée.',
  NetworkError: 'Connexion au rameur impossible. Il est peut-être déjà connecté à une autre appli, ou en veille.',
};

async function startRower() {
  // The device chooser needs the user gesture: requestDevice must be the first thing called.
  // Fullscreen comes after, with a tap on the session screen.
  const source = createBleSource();
  bindSource(source);
  startMsg.textContent = 'Recherche du rameur…';
  try {
    await source.connect();
    startMsg.textContent = '';
    showSession(source.deviceName() ?? 'Rameur');
  } catch (err) {
    logEvent(`erreur : ${err.name} ${err.message}`);
    startMsg.textContent = BLE_ERRORS[err.name] ?? `Erreur : ${err.message}`;
  }
}

// ---------- Start screen ----------
const btnBle = document.getElementById('btn-ble');
if (isBleAvailable()) {
  btnBle.disabled = false;
  btnBle.addEventListener('click', startRower);
} else {
  btnBle.querySelector('small').textContent = '(Bluetooth web indisponible : Chrome Android requis)';
}

document.querySelectorAll('[data-sim]').forEach((btn) => btn.addEventListener('click', () => {
  enterFullscreenLandscape();
  startSimulator(btn.dataset.sim);
}));

// ?sim=hiit starts directly (handy during development)
const autoSim = new URLSearchParams(location.search).get('sim');
if (autoSim) startSimulator(autoSim);

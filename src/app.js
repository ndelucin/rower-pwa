// Wiring: data source -> decoder -> merged state -> activity filter -> session -> screen.
// The source is either the simulator or the real rower (ble.js): same contract, see CLAUDE.md.
// Screens and their behaviour: docs/ECRAN.md ; plan: docs/PLAN-ecran-v1.md.
import { parseRowerData, createRowerState } from './ftms.js';
import { createSimSource } from './sim.js';
import { createBleSource, isBleAvailable } from './ble.js';
import { LAYOUTS, mountLayout } from './ui/layouts.js';
import { formatLastSession } from './ui/format.js';
import { createKeepAwake } from './wakelock.js';
import { createActivityFilter } from './activity.js';
import { createSession } from './session.js';
import { createStore } from './store.js';
import { exportFile } from './export.js';
import { BUILD, formatBuild } from './version.js';

const DRAFT_EVERY_MS = 5000; // backup copy of the running session

let source = null;
let rower = createRowerState();
let activity = createActivityFilter(); // hides the S4's stale values when not rowing
let session = null;                    // createSession(), null outside a session
let values = {};                       // rower state after the activity filter
let snapshot = {};                     // session.snapshot() or, on the summary screen, session.summary()
let status = 'disconnected';
let sourceLabel = '';
let view = null;
let draftTimer = null;
const store = createStore();

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
  session: () => session?.snapshot(),
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
// Several notifications can arrive within the same frame: render at most once per animation frame.
let renderPending = false;
function scheduleRender() {
  if (renderPending || !view) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    view.update({ values, session: snapshot, status, sourceLabel });
  });
}

function logSeries(v) {
  // One line per S4 second, to compare with the real device behaviour (scripts/phone-eval.js).
  if (v.elapsedTime == null || diag.series.at(-1)?.elapsedTime === v.elapsedTime) return;
  diag.series.push({ at: new Date().toISOString().slice(11, 19), ...v, session: snapshot.status });
  if (diag.series.length > 600) diag.series.shift();
}

// The start screen follows the phone (portrait by default); the session screen is landscape.
// Once connected we ask for landscape ourselves. Chrome Android allows the lock in an installed
// PWA (fullscreen display) or in fullscreen; otherwise the CSS asks the user to rotate the phone.
async function lockLandscape() {
  const orientation = window.screen.orientation;
  try {
    await orientation?.lock?.('landscape');
    return;
  } catch { /* not allowed yet: try fullscreen first */ }
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    await orientation?.lock?.('landscape');
  } catch { /* desktop browser or refused: the rotate hint shows in portrait */ }
}
// Back to free rotation for the start screen. unlock() alone would fall back to the manifest's orientation,
// which an already installed app may still carry as "landscape"; lock('any') overrides it explicitly.
async function freeOrientation() {
  const orientation = window.screen.orientation;
  try {
    await orientation?.lock?.('any');
  } catch {
    try { orientation?.unlock?.(); } catch { /* unsupported */ }
  }
}

// ---------- Screens ----------
const startEl = document.getElementById('start');
const screenEl = document.getElementById('screen');
// A tap on the session screen retries the landscape lock (a user gesture may be needed).
screenEl.addEventListener('click', lockLandscape);

function show(layout) {
  startEl.hidden = true;
  screenEl.hidden = false;
  view = mountLayout(screenEl, layout);
  scheduleRender();
}

// Last saved session, shown at the bottom of the start screen.
function showLastSession() {
  store.listSessions()
    .then((list) => { document.getElementById('last-session').textContent = formatLastSession(list.at(-1), Date.now()); })
    .catch(() => {});
}

function goHome() {
  view = null;
  session = null;
  snapshot = {};
  clearInterval(draftTimer);
  keepAwake.stop();
  freeOrientation();
  source?.disconnect();
  source = null;
  screenEl.hidden = true;
  startEl.hidden = false;
  showLastSession();
}

const saveDraft = () => {
  if (!session || session.snapshot().status === 'waiting') return;
  store.saveDraft({ sourceLabel, savedAt: Date.now(), session: session.toJSON() })
    .catch((err) => logEvent(`copie de secours impossible : ${err.message}`));
};

function startSession(label) {
  sourceLabel = label;
  rower = createRowerState();
  activity = createActivityFilter();
  session = createSession();
  snapshot = session.snapshot();
  show(LAYOUTS.free({ onEnd: finishSession }));
  lockLandscape();
  keepAwake.start();
  clearInterval(draftTimer);
  draftTimer = setInterval(saveDraft, DRAFT_EVERY_MS);
}

function finishSession() {
  clearInterval(draftTimer);
  saveDraft(); // the draft survives until the summary is kept or discarded
  showSummary(session.end(Date.now()));
}

// Hands the session file to Android's share sheet (Drive, Claude…); plain download where sharing
// files is unsupported. Never rejects: the outcome goes to the diagnostic journal.
function shareSession(summary) {
  try {
    const file = exportFile(summary);
    if (navigator.canShare?.({ files: [file] })) {
      return navigator.share({ files: [file], title: 'Séance RowerMonitor' })
        .then(() => logEvent('séance partagée'))
        .catch((err) => logEvent(err.name === 'AbortError' ? 'partage annulé' : `partage impossible : ${err.name} ${err.message}`));
    }
    logEvent('partage de fichier indisponible : téléchargement');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (err) {
    logEvent(`export impossible : ${err.name} ${err.message}`);
  }
  return Promise.resolve();
}

function showSummary(summary) {
  session = null; // the session is over: frames still arriving must not touch the summary
  snapshot = summary;
  show(LAYOUTS.summary({
    onKeep: () => {
      // Web Share needs the tap's user gesture: it is started first, synchronously. The local copy
      // is the safety net (a cancelled share loses nothing).
      const sharing = shareSession(summary);
      const saved = store.saveSession(summary)
        .then(() => store.deleteDraft())
        .catch((err) => logEvent(`enregistrement impossible : ${err.message}`));
      Promise.all([sharing, saved]).finally(goHome);
    },
    onDiscard: () => store.deleteDraft()
      .catch((err) => logEvent(`suppression impossible : ${err.message}`))
      .finally(goHome),
  }));
}

// ---------- Sources ----------
function bindSource(src) {
  source = src;
  src.addEventListener('status', (e) => {
    status = e.detail;
    logEvent(`état : ${e.detail}`);
    if (status === 'disconnected' && session) snapshot = session.suspend(Date.now());
    scheduleRender();
  });
  src.addEventListener('log', (e) => logEvent(e.detail));
  src.addEventListener('data', (e) => {
    if (src !== source) return; // a source left behind after goHome()
    const parsed = parseRowerData(e.detail);
    logFrame(e.detail, parsed);
    const now = Date.now();
    values = activity.update(rower.apply(parsed), now);
    if (session) snapshot = session.update(values, now);
    logSeries(values);
    scheduleRender();
  });
}

function startSimulator(scenario) {
  const params = new URLSearchParams(location.search);
  const speed = Number(params.get('speed')) || 1;  // ?speed=10 to fast-forward while developing
  const src = createSimSource({ scenario, intervalMs: 1000 / speed, maxFrameBytes: 20 });
  bindSource(src);
  startSession(`Simulateur · ${scenario}`);
  src.connect();
}

const startMsg = document.getElementById('start-msg');
const BLE_ERRORS = {
  NotFoundError: 'Aucun rameur choisi. Réveille le moniteur S4 (appuie sur un bouton) et ferme WaterRower Connect, puis réessaie.',
  SecurityError: 'Bluetooth refusé : la page doit être servie en HTTPS ou depuis localhost.',
  NotAllowedError: 'Autorisation Bluetooth refusée.',
  NetworkError: 'Connexion au rameur impossible. Il est peut-être déjà connecté à une autre appli, ou en veille.',
  GestureNeeded: 'Rameur pas trouvé directement. Réveille le S4, puis touche à nouveau « Connecter le rameur » pour le choisir.',
};

async function startRower() {
  // The device chooser needs the user gesture: requestDevice must be the first thing called.
  // Landscape comes after the connection (startSession).
  const src = createBleSource();
  bindSource(src);
  startMsg.textContent = 'Recherche du rameur…';
  try {
    await src.connect();
    startMsg.textContent = '';
    startSession(src.deviceName() ?? 'Rameur');
  } catch (err) {
    logEvent(`erreur : ${err.name} ${err.message}`);
    startMsg.textContent = BLE_ERRORS[err.name] ?? `Erreur : ${err.message}`;
    source = null;
  }
}

// ---------- Offline start and silent updates (sw.js, docs/PLAN-pwa.md) ----------
// Not on localhost (the phone would keep old code while we edit it), unless ?sw=1.
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!isLocal || new URLSearchParams(location.search).has('sw'))) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => logEvent('service worker enregistré'))
    .catch((err) => logEvent(`service worker refusé : ${err.message}`));
}

// ---------- Start screen ----------
const btnBle = document.getElementById('btn-ble');
if (isBleAvailable()) {
  btnBle.disabled = false;
  btnBle.addEventListener('click', startRower);
} else {
  startMsg.textContent = 'Bluetooth web indisponible : ouvre l’appli dans Chrome sur Android.';
}

// Simulator buttons: development only (?dev in the address).
if (new URLSearchParams(location.search).has('dev')) document.getElementById('sim-choice').hidden = false;
showLastSession();
document.getElementById('build').textContent = formatBuild(BUILD);
freeOrientation(); // the start screen follows the phone, even if the installed manifest still says landscape

document.querySelectorAll('[data-sim]').forEach((btn) => btn.addEventListener('click', () => {
  startSimulator(btn.dataset.sim);
}));

// A session interrupted by a crash or a reload: show its summary, to keep it or discard it.
// Otherwise, ?sim=steady starts the simulator directly (handy during development).
const autoSim = new URLSearchParams(location.search).get('sim');
// IndexedDB that never answers (seen in headless Chrome) must not block the start: 1.5 s at most.
Promise.race([store.loadDraft(), new Promise((resolve) => setTimeout(resolve, 1500, null))])
  .catch(() => null)
  .then((draft) => {
    if (draft) {
      logEvent('séance interrompue retrouvée');
      sourceLabel = draft.sourceLabel;
      session = createSession({ restore: draft.session });
      showSummary(session.end(draft.savedAt));
    } else if (autoSim) startSimulator(autoSim);
  });

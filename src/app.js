// Wiring: data source -> decoder -> merged state -> activity filter -> session -> screen.
// The source is either the simulator or the real rower (ble.js): same contract, see CLAUDE.md.
// Screens and their behaviour: docs/ECRAN.md ; plan: docs/PLAN-ecran-v1.md.
import { parseRowerData, createRowerState } from './ftms.js';
import { createSimSource } from './sim.js';
import { createBleSource, isBleAvailable } from './ble.js';
import { LAYOUTS, mountLayout } from './ui/layouts.js';
import { mountChoice, mountPicker, mountPrograms } from './ui/choice.js';
import { GOAL_KINDS, goalProgress, goalExport } from './goal.js';
import { getProgram } from './programs.js';
import { DEFAULT_REFERENCE, referenceSplit } from './target.js';
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
let goal = null;                       // { kind: 'duration' | 'distance', target } or { kind: 'program', programId } of the running session, null = free session
let values = {};                       // rower state after the activity filter
let snapshot = {};                     // session.snapshot() or, on the summary screen, session.summary()
let status = 'disconnected';
let sourceLabel = '';
let view = null;
let draftTimer = null;
let draftReady = false;  // the initial read of the backup copy has answered: only then may we write one
let connecting = false;  // a connection to the rower is in progress (start button pressed)
let awakeWarning = false; // the screen could not be kept on during this session
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
    if (!view) return; // goHome() ran between the request and the frame
    view.update({ values, session: snapshot, status, sourceLabel, warning: awakeWarning ? 'Écran non maintenu allumé : il peut s’éteindre' : '' });
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
  // Leave the fullscreen that lockLandscape() may have requested (only if there is one: in an installed
  // fullscreen PWA document.fullscreenElement is null and the app stays fullscreen).
  try { if (document.fullscreenElement) await document.exitFullscreen?.(); } catch { /* already left */ }
  try {
    await orientation?.lock?.('any');
  } catch {
    try { orientation?.unlock?.(); } catch { /* unsupported */ }
  }
}

// ---------- Screens ----------
const startEl = document.getElementById('start');
const screenEl = document.getElementById('screen');
const choiceEl = document.getElementById('choice');
const pickerEl = document.getElementById('picker');
// A tap on the session screen retries the landscape lock (a user gesture may be needed).
screenEl.addEventListener('click', lockLandscape);

function show(layout) {
  startEl.hidden = true;
  choiceEl.hidden = true;
  pickerEl.hidden = true;
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

// Rower connected, no session yet: the four tiles, then the circular picker (duration / distance) or the programme list.
// Data keeps flowing (it is simply not used until a session starts); « Déconnecter » goes back home.
function showChoice() {
  view = null;
  startEl.hidden = true;
  screenEl.hidden = true;
  pickerEl.hidden = true;
  choiceEl.hidden = false;
  mountChoice(choiceEl, {
    onPick: (kind) => {
      if (GOAL_KINDS.includes(kind)) showPicker(kind);
      else if (kind === 'intervals') showPrograms();
      else startSession(sourceLabel, null);
    },
    onBack: goHome,
  });
  lockLandscape();
}

function showPrograms() {
  mountPrograms(choiceEl, {
    onPick: (programId) => startProgram(programId),
    onBack: showChoice,
  });
}

function showPicker(kind) {
  choiceEl.hidden = true;
  pickerEl.hidden = false;
  mountPicker(pickerEl, {
    kind,
    onStart: (target) => startSession(sourceLabel, { kind, target }),
    onBack: showChoice,
  });
}

// IndexedDB that never answers must not block the start of a session: default reference after 1.5 s.
const loadReference = () => Promise.race([
  store.listSessions().then(referenceSplit),
  new Promise((resolve) => setTimeout(resolve, 1500, DEFAULT_REFERENCE)),
]).catch(() => DEFAULT_REFERENCE);

function startProgram(programId) {
  const label = sourceLabel;
  loadReference().then((reference) => startSession(label, { kind: 'program', programId }, reference));
}

function goHome() {
  view = null;
  session = null;
  goal = null;
  snapshot = {};
  choiceEl.hidden = true;
  pickerEl.hidden = true;
  clearInterval(draftTimer);
  keepAwake.stop();
  freeOrientation();
  awakeWarning = false;
  source?.disconnect();
  source = null;
  screenEl.hidden = true;
  startEl.hidden = false;
  btnBle.disabled = !isBleAvailable();
  showLastSession();
}

const saveDraft = () => {
  // Not before the initial read of the previous backup has answered: we could overwrite a copy never shown.
  if (!draftReady || !session || session.snapshot().status === 'waiting') return;
  store.saveDraft({ sourceLabel, savedAt: Date.now(), session: session.toJSON(), goal })
    .catch((err) => logEvent(`copie de secours impossible : ${err.message}`));
};

// reference: personal split reference (s/500 m) of the target zone of programme efforts (src/target.js).
function startSession(label, sessionGoal = null, reference = DEFAULT_REFERENCE) {
  sourceLabel = label;
  goal = sessionGoal;
  rower = createRowerState();
  activity = createActivityFilter();
  session = createSession();
  snapshot = session.snapshot();
  show(LAYOUTS.session({ goal, reference, onEnd: () => finishSession() }));
  lockLandscape();
  awakeWarning = false;
  const mine = session;
  keepAwake.start().then(() => {
    if (session !== mine) return; // that session is over
    awakeWarning = !keepAwake.active && (keepAwake.denied || !keepAwake.supported);
    scheduleRender();
  });
  clearInterval(draftTimer);
  draftTimer = setInterval(saveDraft, DRAFT_EVERY_MS);
}

// goalReached: the session ends by itself because its duration / distance goal was reached (or its programme is over).
function finishSession(goalReached = false) {
  clearInterval(draftTimer);
  if (session.snapshot().status === 'waiting') { // connected but never rowed: back home, no summary
    if (draftReady) store.deleteDraft().catch(() => {});
    goHome();
    return;
  }
  saveDraft(); // the draft survives until the summary is kept or discarded
  showSummary(session.end(Date.now()), { goalReached });
}

// Hands the session file to Android's share sheet (Drive, Claude…); plain download where sharing
// files is unsupported. Never rejects: the outcome goes to the diagnostic journal.
function shareSession(summary, sessionGoal) {
  try {
    const program = goalExport(sessionGoal);
    const file = exportFile(summary, globalThis.File, program ? { program } : {});
    if (navigator.canShare?.({ files: [file] })) {
      // No `title`: the Drive share target would use it as the file name instead of the file's own name.
      return navigator.share({ files: [file] })
        .then(() => { logEvent('séance partagée'); return 'Fichier partagé.'; })
        .catch((err) => {
          logEvent(err.name === 'AbortError' ? 'partage annulé' : `partage impossible : ${err.name} ${err.message}`);
          return err.name === 'AbortError' ? 'Partage annulé.' : `Partage impossible (${err.name}${err.message ? ` : ${err.message}` : ''}).`;
        });
    }
    logEvent('partage de fichier indisponible : téléchargement');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return Promise.resolve('Partage de fichier indisponible : fichier téléchargé.');
  } catch (err) {
    logEvent(`export impossible : ${err.name} ${err.message}`);
    return Promise.resolve(`Export impossible (${err.name}).`);
  }
}

function showSummary(summary, { goalReached = false } = {}) {
  session = null; // the session is over: frames still arriving must not touch the summary
  snapshot = summary;
  const summaryGoal = goal;
  let settled = false; // one outcome per summary: a double tap must not share and save twice
  show(LAYOUTS.summary({
    goal: summaryGoal,
    goalReached,
    onKeep: () => {
      if (settled) return;
      settled = true;
      if (summary.startedAt == null) { // no stroke at all: nothing to keep, nothing to share
        store.deleteDraft().catch(() => {}).finally(() => { goHome(); startMsg.textContent = 'Séance vide : rien à enregistrer.'; });
        return;
      }
      // Web Share needs the tap's user gesture: it is started first, synchronously. The local copy
      // is the safety net (a cancelled share loses nothing).
      const sharing = shareSession(summary, summaryGoal);
      let saved = 'Séance enregistrée.';
      store.saveSession(summary)
        .then(() => store.deleteDraft())
        .catch((err) => { saved = 'Enregistrement local impossible.'; logEvent(`enregistrement impossible : ${err.message}`); })
        // Home right after the local copy: a share sheet that never answers must not freeze the summary.
        .finally(() => {
          goHome();
          startMsg.textContent = saved;
          sharing.then((outcome) => { startMsg.textContent = `${saved} ${outcome}`; });
        });
    },
    onDiscard: () => {
      if (settled) return;
      settled = true;
      store.deleteDraft()
        .catch((err) => logEvent(`suppression impossible : ${err.message}`))
        .finally(goHome);
    },
  }));
}

// ---------- Sources ----------
function bindSource(src) {
  source = src;
  src.addEventListener('status', (e) => {
    if (src !== source) return; // a source left behind after goHome()
    status = e.detail;
    logEvent(`état : ${e.detail}`);
    if (status === 'disconnected' && session) snapshot = session.suspend(Date.now());
    scheduleRender();
  });
  src.addEventListener('log', (e) => { if (src === source) logEvent(e.detail); });
  src.addEventListener('data', (e) => {
    if (src !== source) return; // a source left behind after goHome()
    const parsed = parseRowerData(e.detail);
    logFrame(e.detail, parsed);
    const now = Date.now();
    values = activity.update(rower.apply(parsed), now);
    if (session) {
      snapshot = session.update(values, now);
      if (goal && goalProgress(goal, snapshot).reached) { finishSession(true); return; } // the goal ends the session by itself
    }
    logSeries(values);
    scheduleRender();
  });
}

// Simulator. `direct`: start the session at once (?sim=… in the address); otherwise go through the choice
// screen like the real rower. ?mode=duration|distance&target=1200 (s) or 2000 (m) starts a goal session,
// ?mode=program&program=pyramide starts a programme, ?mode=choice stops on the choice screen.
// ?frames=full sends whole frames: the default 20-byte split makes activity.js see a phantom stroke
// and the session never leaves "waiting" (the real S4 sends whole frames).
function goalFromParams(params) {
  const mode = params.get('mode');
  const target = Number(params.get('target'));
  if (mode === 'program' && getProgram(params.get('program'))) return { kind: 'program', programId: params.get('program') };
  return GOAL_KINDS.includes(mode) && target > 0 ? { kind: mode, target } : null;
}

function startSimulator(scenario, { direct = false } = {}) {
  const params = new URLSearchParams(location.search);
  const speed = Number(params.get('speed')) || 1;  // ?speed=10 to fast-forward while developing
  const src = createSimSource({ scenario, intervalMs: 1000 / speed, maxFrameBytes: params.get('frames') === 'full' ? Infinity : 20 });
  bindSource(src);
  const label = `Simulateur · ${scenario}`;
  const mode = params.get('mode');
  sourceLabel = label;
  if (!direct || mode === 'choice') showChoice();
  else {
    const sessionGoal = goalFromParams(params);
    if (sessionGoal?.kind === 'program') startProgram(sessionGoal.programId);
    else startSession(label, sessionGoal);
  }
  src.connect();
}

const startMsg = document.getElementById('start-msg');
const BLE_ERRORS = {
  NotFoundError: 'Aucun rameur trouvé ou choisi. Vérifie que le Bluetooth du téléphone est activé, réveille le moniteur S4 (appuie sur un bouton) et ferme WaterRower Connect, puis réessaie.',
  AbortError: 'Connexion interrompue avant la fin. Réessaie.',
  SecurityError: 'Bluetooth refusé : la page doit être servie en HTTPS ou depuis localhost.',
  NotAllowedError: 'Autorisation Bluetooth refusée.',
  NetworkError: 'Connexion au rameur impossible. Il est peut-être déjà connecté à une autre appli, ou en veille.',
  GestureNeeded: 'Rameur pas trouvé directement. Réveille le S4, puis touche à nouveau « Connecter le rameur » pour le choisir.',
};

async function startRower() {
  if (connecting || session) return; // a second tap while connecting would open a second link (the S4 takes one)
  connecting = true;
  btnBle.disabled = true;
  // The device chooser needs the user gesture: requestDevice must be the first thing called.
  // Landscape comes after the connection (startSession).
  const src = createBleSource();
  bindSource(src);
  startMsg.textContent = 'Recherche du rameur…';
  try {
    await src.connect();
    startMsg.textContent = '';
    sourceLabel = src.deviceName() ?? 'Rameur';
    showChoice();
  } catch (err) {
    logEvent(`erreur : ${err.name} ${err.message}`);
    startMsg.textContent = BLE_ERRORS[err.name] ?? `Erreur : ${err.message}`;
    src.disconnect(); // close any half-open link: a ghost connection keeps the S4 busy
    source = null;
    btnBle.disabled = !isBleAvailable();
  } finally {
    connecting = false;
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

// The page going to the background (app switch, screen off) may be followed by its death: write the backup now.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });
window.addEventListener('pagehide', saveDraft);

// A session interrupted by a crash or a reload: show its summary, to keep it or discard it.
// Otherwise, ?sim=steady starts the simulator directly (handy during development).
const autoSim = new URLSearchParams(location.search).get('sim');
function showInterrupted(draft) {
  logEvent('séance interrompue retrouvée');
  sourceLabel = draft.sourceLabel;
  goal = draft.goal ?? null;
  session = createSession({ restore: draft.session });
  showSummary(session.end(draft.savedAt));
}
// IndexedDB that never answers (seen in headless Chrome) must not block the start: 1.5 s at most.
// Backups are not written before the read has answered, and a copy that arrives late is shown if nothing
// else is going on (home screen, no connection in progress).
let startupDone = false;
const draftRead = store.loadDraft().then((draft) => ({ draft }), () => ({ draft: null }));
draftRead.then(({ draft }) => {
  draftReady = true;
  if (startupDone && draft && !session && !view && !connecting) showInterrupted(draft);
  else if (startupDone && draft) logEvent('copie de secours tardive ignorée (séance en cours)');
});
Promise.race([draftRead, new Promise((resolve) => setTimeout(resolve, 1500, null))])
  .then((read) => {
    startupDone = true;
    if (read?.draft) showInterrupted(read.draft);
    else if (autoSim) startSimulator(autoSim, { direct: true });
  });

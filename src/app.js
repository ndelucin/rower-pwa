// Wiring: data source -> decoder -> merged state -> activity filter -> session -> screen.
// The source is either the simulator or the real rower (ble.js): same contract, see CLAUDE.md.
// Screens and their behaviour: docs/ECRAN.md ; plan: docs/PLAN-ecran-v1.md.
import { parseRowerData, createRowerState } from './ftms.js';
import { createSimSource } from './sim.js';
import { createBleSource, isBleAvailable } from './ble.js';
import { LAYOUTS, mountLayout } from './ui/layouts.js';
import { mountChoice, mountPicker, mountPrograms } from './ui/choice.js';
import { GOAL_KINDS, isGoalReached, goalExport, validGoal } from './goal.js';
import { getProgram } from './programs.js';
import { DEFAULT_REFERENCE, referenceSplit } from './target.js';
import { createKeepAwake } from './wakelock.js';
import { createActivityFilter } from './activity.js';
import { createSession } from './session.js';
import { createSmoother, DEFAULT_WINDOW, PROGRAMME_WINDOW } from './smooth.js';
import { createStore } from './store.js';
import { exportFile } from './export.js';
import { BUILD, formatBuild } from './version.js';

const DRAFT_EVERY_MS = 5000; // backup copy of the running session

let source = null;
let rower = createRowerState();
let activity = createActivityFilter(); // hides the S4's stale values when not rowing
let session = null;                    // createSession(), null outside a session
let goal = null;                       // { kind: 'duration' | 'distance', target } or { kind: 'program', programId } of the running session, null = free session
let values = {};                       // rower state after the activity filter (raw: session, series, export)
let display = {};                      // the same, power and split smoothed (src/smooth.js): what the screen shows
const smoother = createSmoother();
let navToken = 0;                      // changes at every screen change: a late answer (programme start) checks it
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
    if (!view) return; // backToChoice() ran between the request and the frame
    view.update({ values: display, session: snapshot, status, sourceLabel, warning: awakeWarning ? 'Écran non maintenu allumé : il peut s’éteindre' : '' });
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
// ---------- Screens ----------
const screenEl = document.getElementById('screen');
const choiceEl = document.getElementById('choice');
const pickerEl = document.getElementById('picker');
const devEl = document.getElementById('sim-choice'); // simulator buttons (?dev), on the session choice only
const isDev = new URLSearchParams(location.search).has('dev');
// A tap on the session screen or on the choice retries the landscape lock (a user gesture may be needed).
screenEl.addEventListener('click', lockLandscape);
choiceEl.addEventListener('click', lockLandscape);

// Short notification (the build, from « Information »): disappears by itself, or at a tap.
const toastEl = document.getElementById('toast');
let toastTimer = null;
function hideToast() { clearTimeout(toastTimer); toastEl.hidden = true; }
function showToast(text, ms = 4000) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
toastEl.addEventListener('click', hideToast);

// The rower link, as the choice screen shows it: 'off' | 'searching' | 'on' (the simulator counts as connected),
// and the one short line under the connection button (yellow).
let link = 'off';
let linkMessage = '';
let choice = null; // the mounted choice screen, null while another screen is shown
const renderChoice = () => choice?.update({ link, message: linkMessage, available: isBleAvailable() });
const setMessage = (text) => { linkMessage = text; renderChoice(); };

function show(layout) {
  choice = null;
  hideToast();
  devEl.hidden = true;
  choiceEl.hidden = true;
  pickerEl.hidden = true;
  screenEl.hidden = false;
  view = mountLayout(screenEl, layout);
  scheduleRender();
}

// The root screen: name, connection button, tiles (greyed until the rower is connected), then the circular picker
// (duration / distance) or the programme list. Data keeps flowing (it is simply not used until a session starts).
function showChoice() {
  navToken++;
  view = null;
  screenEl.hidden = true;
  pickerEl.hidden = true;
  choiceEl.hidden = false;
  devEl.hidden = !isDev;
  choice = mountChoice(choiceEl, {
    onInfo: () => showToast(formatBuild(BUILD)),
    onPick: (kind) => {
      if (GOAL_KINDS.includes(kind)) showPicker(kind);
      else if (kind === 'intervals') showPrograms();
      else startSession(sourceLabel, null);
    },
    onConnect: startRower,
    onDisconnect: disconnectRower,
  });
  renderChoice();
  lockLandscape();
}

function showPrograms() {
  navToken++;
  choice = null;
  mountPrograms(choiceEl, {
    onPick: (programId) => startProgram(programId),
    onBack: showChoice,
  });
}

function showPicker(kind) {
  navToken++;
  choice = null;
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

// The reference may take up to 1.5 s: Back, Disconnect or a second tap in the meantime change navToken,
// and the late start is dropped (otherwise a session screen would open without any rower).
function startProgram(programId) {
  const label = sourceLabel;
  const token = ++navToken;
  loadReference().then((reference) => {
    if (token === navToken) startSession(label, { kind: 'program', programId }, reference);
  });
}

// Session over (or abandoned before the first stroke): back to the session choice. The rower stays connected, so
// that a second session can follow; « ✓ Connecté » is what disconnects it.
function backToChoice() {
  view = null;
  session = null;
  goal = null;
  snapshot = {};
  clearInterval(draftTimer);
  keepAwake.stop();
  awakeWarning = false;
  showChoice();
}

// « ‹ Retour » before the first stroke: nothing was rowed, nothing to keep.
function leaveWaiting() {
  if (!session || session.snapshot().status !== 'waiting') return; // the first stroke came in the meantime
  if (draftReady) store.deleteDraft().catch(() => {});
  backToChoice();
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
  linkMessage = '';
  goal = sessionGoal;
  rower = createRowerState();
  activity = createActivityFilter();
  smoother.reset();
  smoother.setWindow(goal?.kind === 'program' ? PROGRAMME_WINDOW : DEFAULT_WINDOW);
  display = {};
  session = createSession();
  snapshot = session.snapshot();
  show(LAYOUTS.session({ goal, reference, onEnd: () => finishSession(), onBack: leaveWaiting }));
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
  if (session.snapshot().status === 'waiting') { // connected but never rowed: back to the choice, no summary
    leaveWaiting();
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
        store.deleteDraft().catch(() => {}).finally(() => { backToChoice(); setMessage('Séance vide : rien à enregistrer.'); });
        return;
      }
      // Web Share needs the tap's user gesture: it is started first, synchronously. The local copy
      // is the safety net (a cancelled share loses nothing).
      const sharing = shareSession(summary, summaryGoal);
      let saved = 'Séance enregistrée.';
      // goalKind (not part of the export): lets the split reference ignore programme sessions (src/target.js).
      store.saveSession({ ...summary, goalKind: summaryGoal?.kind ?? 'free' })
        .then(() => store.deleteDraft())
        .catch((err) => { saved = 'Enregistrement local impossible.'; logEvent(`enregistrement impossible : ${err.message}`); })
        // Back to the choice right after the local copy: a share sheet that never answers must not freeze the summary.
        .finally(() => {
          backToChoice();
          setMessage(saved);
          // The outcome of the share only completes the message it belongs to, never a newer one.
          sharing.then((outcome) => { if (linkMessage === saved) setMessage(`${saved} ${outcome}`); });
        });
    },
    onDiscard: () => {
      if (settled) return;
      settled = true;
      store.deleteDraft()
        .catch((err) => logEvent(`suppression impossible : ${err.message}`))
        .finally(backToChoice);
    },
  }));
}

// ---------- Sources ----------
function bindSource(src) {
  source = src;
  src.addEventListener('status', (e) => {
    if (src !== source) return; // a source left behind after disconnectRower()
    status = e.detail;
    logEvent(`état : ${e.detail}`);
    if (status === 'disconnected' && session) snapshot = session.suspend(Date.now());
    scheduleRender();
  });
  src.addEventListener('log', (e) => { if (src === source) logEvent(e.detail); });
  src.addEventListener('data', (e) => {
    if (src !== source) return; // a source left behind after disconnectRower()
    const parsed = parseRowerData(e.detail);
    logFrame(e.detail, parsed);
    const now = Date.now();
    values = activity.update(rower.apply(parsed), now);
    if (session) {
      snapshot = session.update(values, now);
      if (isGoalReached(goal, snapshot)) { finishSession(true); return; } // the goal ends the session by itself
    }
    display = smoother.update(values);
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
  link = 'on';
  if (!direct || mode === 'choice') showChoice();
  else {
    const sessionGoal = goalFromParams(params);
    if (sessionGoal?.kind === 'program') startProgram(sessionGoal.programId);
    else startSession(label, sessionGoal);
  }
  src.connect();
}

// Connection button of the choice screen. Any failure shows the same short « S4 non détecté »; the detail goes
// to the diagnostic journal (window.__rower.events).
async function startRower() {
  if (connecting || session || link !== 'off') return; // a second tap while connecting would open a second link (the S4 takes one)
  connecting = true;
  link = 'searching';
  linkMessage = '';
  renderChoice();
  // The device chooser needs the user gesture: requestDevice must be the first thing called.
  const src = createBleSource();
  bindSource(src);
  try {
    await src.connect();
    sourceLabel = src.deviceName() ?? 'Rameur';
    link = 'on';
    lockLandscape();
  } catch (err) {
    logEvent(`erreur : ${err.name} ${err.message}`);
    linkMessage = 'S4 non détecté';
    src.disconnect(); // close any half-open link: a ghost connection keeps the S4 busy
    source = null;
    link = 'off';
  } finally {
    connecting = false;
    renderChoice();
  }
}

// « ✓ Connecté »: frees the S4 (it accepts one connection at a time, WaterRower Connect needs it).
function disconnectRower() {
  if (session) return;
  navToken++;
  source?.disconnect();
  source = null;
  link = 'off';
  linkMessage = '';
  renderChoice();
}

// ---------- Offline start and silent updates (sw.js, docs/PLAN-pwa.md) ----------
// Not on localhost (the phone would keep old code while we edit it), unless ?sw=1.
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!isLocal || new URLSearchParams(location.search).has('sw'))) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => logEvent('service worker enregistré'))
    .catch((err) => logEvent(`service worker refusé : ${err.message}`));
}

// ---------- Launch ----------
// No home screen: the app opens on the session choice, rower not connected (landscape only, see the manifest).
if (!isBleAvailable()) linkMessage = 'Bluetooth indisponible';
showChoice();

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
  goal = validGoal(draft.goal); // a programme that no longer exists must not block the summary
  session = createSession({ restore: draft.session });
  showSummary(session.end(draft.savedAt));
}
// IndexedDB that never answers (seen in headless Chrome) must not block the start: 1.5 s at most.
// Backups are not written before the read has answered, and a copy that arrives late is shown if nothing
// else is going on (the session choice, no connection in progress).
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

// Session choice screen (4 tiles), programme list and circular goal picker. Maquette: docs/maquette-cinematique.html.
// Unlike the session screens these are not zones of the common template: each one fills its own container.
// Pure goal logic (ranges, angle -> value, display) lives in src/goal.js; this file only draws and listens.
import {
  GOAL_LIMITS, GOAL_PRESETS, clampGoal, stepGoal, goalFromAngle, goalDisplay, goalPresetLabel,
} from '../goal.js';
import { PROGRAMS } from '../programs.js';
import { ringCircumference } from './format.js';
import { INTERVAL_ICON } from './icons.js';

const GLYPH = { duration: '◔', distance: '↔' };
const TITLE = { duration: 'une durée', distance: 'une distance' };

// The heartbeat logo, shown under the name on the session choice.
const LOGO = '<svg viewBox="0 0 64 32" aria-hidden="true"><defs><linearGradient id="ecg" x1="0" x2="1"><stop offset="0" stop-color="#4fc3f7" stop-opacity="0"/><stop offset=".25" stop-color="#4fc3f7"/><stop offset=".75" stop-color="#4fc3f7"/><stop offset="1" stop-color="#4fc3f7" stop-opacity="0"/></linearGradient></defs><path d="M1 18H13L16.5 14.5L19.5 18H25L29 4L35 30L39 18H45L48.5 13.5L52 18H63" fill="none" stroke="url(#ecg)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * The root screen "Sélectionner la séance": name and logo, a discreet connection button under the title and the
 * four tiles (Libre, Durée, Distance, Intervalles), greyed until the rower is connected.
 * onPick('free' | 'duration' | 'distance' | 'intervals'), onConnect(), onDisconnect() (a tap on « ✓ Connecté »),
 * onInfo() (the discreet « Information » link: the app shows the build in a short notification).
 * Returns { update({ link, message, available }) }: link = 'off' | 'searching' | 'on', message = one short line
 * under the button (yellow), available = false when Web Bluetooth is missing (the button is disabled).
 */
export function mountChoice(el, { onPick, onConnect, onDisconnect, onInfo }) {
  el.innerHTML = `
    <div class="side">
      <div class="brand"><h1 class="wordmark"><b>Rower</b><span>Monitor</span></h1>${LOGO}</div>
      <div>
        <h2>Sélectionner<br>la séance</h2>
        <button type="button" class="conn-btn" data-conn></button>
        <p class="start-msg" role="status" data-msg></p>
      </div>
    </div>
    <button type="button" class="info-link" data-info>Information</button>
    <div class="tiles">
      <button type="button" class="tile free" data-pick="free"><i>∞</i><b>Libre</b><span>sans objectif</span></button>
      <button type="button" class="tile" data-pick="duration"><i class="dur">◔</i><b>Durée</b><span>0 à 60 min</span></button>
      <button type="button" class="tile" data-pick="distance"><i class="dist">↔</i><b>Distance</b><span>0 à 8 km</span></button>
      <button type="button" class="tile" data-pick="intervals"><i class="intv">${INTERVAL_ICON}</i><b>Intervalles</b><span>programmes</span></button>
    </div>`;
  const conn = el.querySelector('[data-conn]');
  const msg = el.querySelector('[data-msg]');
  const tiles = [...el.querySelectorAll('[data-pick]')];
  let link = 'off';
  el.querySelector('[data-info]').addEventListener('click', () => onInfo?.());
  conn.addEventListener('click', () => (link === 'on' ? onDisconnect?.() : onConnect?.()));
  tiles.forEach((b) => b.addEventListener('click', () => onPick?.(b.dataset.pick)));
  return {
    update({ link: next = 'off', message = '', available = true } = {}) {
      link = next;
      conn.className = `conn-btn${link === 'on' ? ' on' : link === 'searching' ? ' busy' : ''}`;
      conn.innerHTML = link === 'on' ? '<i>✓</i> Connecté' : `⌁ ${link === 'searching' ? 'Recherche…' : 'Connecter'}`;
      conn.disabled = link === 'searching' || (link === 'off' && !available);
      msg.textContent = message;
      tiles.forEach((b) => { b.disabled = link !== 'on'; });
    },
  };
}

/** Programme list: a grid of cards. onPick(programId), onBack() = back to the tiles. */
export function mountPrograms(el, { onPick, onBack }) {
  const card = (p) => `
    <button type="button" class="pcard" data-program="${p.id}">
      <span class="dots" title="Intensité ${p.level} / 3">${[1, 2, 3].map((n) => `<i${n <= p.level ? ' class="on"' : ''}></i>`).join('')}</span>
      <span class="pd">${p.minutes} MIN</span>
      <b>${p.name}</b>
      <span class="struct">${p.struct}</span>
    </button>`;
  el.innerHTML = `
    <div class="side">
      <button type="button" class="back" data-back>‹ Retour</button>
      <div class="side-title">Sélectionner<br>un programme</div>
      <i class="pk-ico intv">${INTERVAL_ICON}</i>
    </div>
    <div class="pgrid">${PROGRAMS.map(card).join('')}</div>`;
  el.querySelector('[data-back]').addEventListener('click', () => onBack?.());
  el.querySelectorAll('[data-program]').forEach((b) => b.addEventListener('click', () => onPick?.(b.dataset.program)));
}

/**
 * Circular picker for a goal of `kind` ('duration' | 'distance'): drag on the ring, − / + buttons,
 * four quick values, Start. onStart(target), onBack().
 */
export function mountPicker(el, { kind, onStart, onBack }) {
  const L = GOAL_LIMITS[kind];
  const tone = kind === 'duration' ? 'dur' : 'dist';
  let target = L.def;
  el.className = `screen picker ${tone}`;
  el.innerHTML = `
    <div class="col picker-left">
      <button type="button" class="back" data-back>‹ Retour</button>
      <div class="picker-title">Définir<br>${TITLE[kind]}</div>
      <i class="pk-ico">${GLYPH[kind]}</i>
    </div>
    <div class="ring" data-ring>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="ring-track" cx="50" cy="50" r="46"/>
        <circle class="ring-arc tone-${tone}" data-arc cx="50" cy="50" r="46"/>
        <circle class="knob" data-knob r="4.2"/>
      </svg>
      <div class="ring-center">
        <div class="chrono"><span data-value></span><span class="pu" data-unit></span></div>
        <div class="pm">
          <button type="button" data-step="-1" aria-label="Moins">−</button>
          <button type="button" data-step="1" aria-label="Plus">+</button>
        </div>
      </div>
    </div>
    <div class="col picker-right">
      <div class="presets">${GOAL_PRESETS[kind].map((v) => `<button type="button" data-preset="${v}">${goalPresetLabel(kind, v)}</button>`).join('')}</div>
      <button type="button" class="go" data-go>Démarrer</button>
    </div>`;

  const q = (s) => el.querySelector(s);
  const ringEl = q('[data-ring]');
  const arc = q('[data-arc]');
  const knob = q('[data-knob]');
  const C = ringCircumference(46);

  function render() {
    const f = target / L.max;
    arc.setAttribute('stroke-dasharray', `${(C * Math.min(f, 1)).toFixed(1)} ${C.toFixed(2)}`);
    arc.style.display = f > 0 ? '' : 'none';
    const a = f * 2 * Math.PI; // the SVG is already rotated by -90°: angle 0 = 12 o'clock
    knob.setAttribute('cx', (50 + 46 * Math.cos(a)).toFixed(2));
    knob.setAttribute('cy', (50 + 46 * Math.sin(a)).toFixed(2));
    const d = goalDisplay(kind, target);
    q('[data-value]').textContent = d.text;
    q('[data-unit]').textContent = d.unit;
    q('[data-go]').disabled = target <= 0;
  }

  const fromPointer = (e) => {
    const r = ringEl.getBoundingClientRect();
    let ang = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) + Math.PI / 2;
    if (ang < 0) ang += 2 * Math.PI;
    target = goalFromAngle(kind, ang, target);
    render();
  };
  let drag = false;
  ringEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // − / + are plain buttons
    drag = true;
    try { ringEl.setPointerCapture(e.pointerId); } catch { /* unknown pointer: the drag still works */ }
    fromPointer(e);
  });
  ringEl.addEventListener('pointermove', (e) => { if (drag) fromPointer(e); });
  for (const type of ['pointerup', 'pointercancel']) ringEl.addEventListener(type, () => { drag = false; });

  el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    target = stepGoal(kind, target, Number(b.dataset.step));
    render();
  }));
  el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    target = clampGoal(kind, Number(b.dataset.preset));
    render();
  }));
  q('[data-back]').addEventListener('click', () => onBack?.());
  q('[data-go]').addEventListener('click', () => { if (target > 0) onStart?.(target); });
  render();
}

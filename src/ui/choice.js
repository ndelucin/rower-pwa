// Session choice screen (4 tiles) and the circular goal picker. Maquette: docs/maquette-cinematique.html.
// Unlike the session screens these are not zones of the common template: each one fills its own container.
// Pure goal logic (ranges, angle -> value, display) lives in src/goal.js; this file only draws and listens.
import {
  GOAL_LIMITS, GOAL_PRESETS, clampGoal, stepGoal, goalFromAngle, goalDisplay, goalPresetLabel,
} from '../goal.js';
import { ringCircumference } from './format.js';

const GLYPH = { duration: '◔', distance: '↔' };
const TITLE = { duration: 'une durée', distance: 'une distance' };

/**
 * Tiles: Libre, Durée, Distance, Intervalles (the last one is not available yet: v2, programs).
 * onPick('free' | 'duration' | 'distance'), onBack() = disconnect.
 */
export function mountChoice(el, { onPick, onBack }) {
  el.innerHTML = `
    <div class="side">
      <button type="button" class="back" data-back>‹ Déconnecter</button>
      <div><h2>Démarrer<br>une séance</h2><p>Rameur connecté.</p></div>
      <span></span>
    </div>
    <div class="tiles">
      <button type="button" class="tile free" data-pick="free"><i>∞</i><b>Libre</b><span>sans objectif</span></button>
      <button type="button" class="tile" data-pick="duration"><i class="dur">◔</i><b>Durée</b><span>0 à 60 min</span></button>
      <button type="button" class="tile" data-pick="distance"><i class="dist">↔</i><b>Distance</b><span>0 à 8 km</span></button>
      <button type="button" class="tile" disabled><i class="intv">▮▯▮</i><b>Intervalles</b><span>bientôt</span></button>
    </div>`;
  el.querySelector('[data-back]').addEventListener('click', () => onBack?.());
  el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => onPick?.(b.dataset.pick)));
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

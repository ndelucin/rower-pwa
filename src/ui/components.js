// UI components. Each factory returns { mount(el), update(model) }:
//  - mount builds the DOM once inside its zone,
//  - update only changes texts / attributes (called on every new frame, ~1-2 times per second).
// model = { values, session, status, sourceLabel }:
//  values  = output of activity.update() (instPace, instPower, strokeRate… null when not rowing),
//  session = snapshot() of src/session.js (or its summary() on the summary screen),
//  status  = connection: 'connecting' | 'connected' | 'disconnected'.
import { ringArcs, splitBarPosition, formatPace } from './format.js';

const NS = 'http://www.w3.org/2000/svg';

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const setAttr = (el, name, value) => { if (el.getAttribute(name) !== String(value)) el.setAttribute(name, value); };

/**
 * Column of big metrics (left / right zones).
 * items: [{ label, unit, tone: 'pace' | 'power' | undefined, value(model) -> string }]
 */
export function metricColumn(items, { align = 'left' } = {}) {
  const valueEls = [];
  return {
    mount(el) {
      const col = h('div', `col col-${align}`);
      for (const it of items) {
        const metric = h('div', `metric${it.tone ? ` tone-${it.tone}` : ''}`);
        const value = h('div', 'value');
        const text = document.createTextNode('');
        value.append(text);
        if (it.unit) value.append(h('span', 'unit', it.unit));
        metric.append(h('div', 'label', it.label), value);
        col.append(metric);
        valueEls.push(text);
      }
      el.append(col);
    },
    update(m) {
      items.forEach((it, i) => {
        const text = it.value(m);
        if (valueEls[i].data === text) return;
        valueEls[i].data = text;
        // 6+ characters (e.g. "12 345" m) would overflow the column at full size.
        valueEls[i].parentNode.classList.toggle('long', text.length > 5);
      });
    },
  };
}

/**
 * Hold-to-confirm button: the callback fires after `duration` ms of continuous press
 * (pointer events; releasing early cancels). A fill shows the progress.
 * Exposes `element` after mount, and setVisible(bool).
 */
export function holdButton({ label, text = '', description = '', onHold, duration = 1500, cls = '' }) {
  let btn, timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    btn?.classList.remove('holding');
  };
  const api = {
    element: null,
    mount(el) {
      btn = h('button', `hold hold-pill ${cls}`.trim());
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      if (description) btn.setAttribute('aria-description', description);
      btn.style.setProperty('--hold-ms', `${duration}ms`);
      btn.append(h('span', 'hold-fill'));
      if (text) btn.append(h('span', 'hold-text', text));

      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        try { btn.setPointerCapture?.(e.pointerId); } catch { /* unknown pointer: hold still works */ }
        cancel();
        // Force a reflow so the CSS transition restarts from empty.
        void btn.offsetWidth;
        btn.classList.add('holding');
        timer = setTimeout(() => { cancel(); onHold?.(); }, duration);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, cancel);
      btn.addEventListener('contextmenu', (e) => e.preventDefault()); // long press opens a menu on Android
      api.element = btn;
      el.append(btn);
    },
    update() {},
    setVisible(visible) {
      if (btn.hidden === !visible) return;
      btn.hidden = !visible;
      if (!visible) cancel();
    },
  };
  return api;
}

/**
 * Round icon button with an immediate effect (plain tap, no confirmation).
 * Same interface as holdButton: exposes setVisible(bool).
 */
export function tapButton({ label, icon = 'pause', onTap, cls = '' }) {
  let btn;
  return {
    mount(el) {
      btn = h('button', `tap ${cls}`.trim());
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      if (icon === 'pause') {
        const s = svg('svg', { viewBox: '0 0 10 10', class: 'tap-icon', 'aria-hidden': 'true' });
        s.append(svg('rect', { x: 2, y: 1.5, width: 2, height: 7, rx: 0.5 }), svg('rect', { x: 6, y: 1.5, width: 2, height: 7, rx: 0.5 }));
        btn.append(s);
      }
      btn.addEventListener('click', () => onTap?.());
      el.append(btn);
    },
    update() {},
    setVisible(visible) { btn.hidden = !visible; },
  };
}

/**
 * "‹ Retour" pill (same look as the Back buttons of the other screens), shown before the first stroke.
 * Same interface as tapButton: setVisible(bool).
 */
export function backButton({ label = 'Retour', onTap }) {
  let btn;
  return {
    mount(el) {
      btn = h('button', 'back', `‹ ${label}`);
      btn.type = 'button';
      btn.addEventListener('click', () => onTap?.());
      el.append(btn);
    },
    update() {},
    setVisible(visible) { btn.hidden = !visible; },
  };
}

/**
 * Several controls in one block (the ring's `action`): items = [{ component, visible(model) }].
 * The block itself shows or hides through setVisible, like a single button.
 */
export function controlGroup(items) {
  let box;
  return {
    mount(el) {
      box = el;
      items.forEach((it) => it.component.mount(el));
    },
    update(m) {
      items.forEach((it) => {
        it.component.setVisible?.(!!it.visible(m));
        it.component.update(m);
      });
    },
    setVisible(visible) { box.hidden = !visible; },
  };
}

/**
 * Central ring: SVG arcs around a label, a big main text (chrono) and an optional line.
 *  arcs(model)    -> [{ from, to, tone, segment, faint, gap }] fractions of a turn (tone: 'pace' | 'power' | 'dur' | 'dist'
 *                    | 'work' | 'rest' | 'warm'); `segment` = flat ends, `faint` = dimmed (to come), `gap` = turn left empty at the end
 *  label(model)   -> small caps text above
 *  main(model)    -> big text (chrono / countdown)
 *  note(model)    -> small line under the main text ('' to leave empty)
 *  count(model)   -> optional big line under the main text (programmes: "S2 · 3 / 6")
 *  tone(model)    -> optional phase tone ('work' | 'rest' | 'warm'): colours the main text and tints the screen background
 *  dimmed(model)  -> true greys the main text (paused)
 *  action         -> optional component (e.g. tapButton) under the main text, shown when actionVisible(model)
 *  icon           -> optional { glyph | html, tone } shown at the top centre: the session type (∞ ◔ ↔ or the interval icon, src/ui/icons.js), tone 'free' | 'dur' | 'dist' | 'intv'
 */
export function ring({ arcs, label, main, note = () => '', count = null, tone = () => null, dimmed = () => false, action = null, actionVisible = () => true, icon = null }) {
  let root, arcGroup, labelEl, mainEl, noteEl, countEl;
  const arcEls = [];
  return {
    mount(el) {
      root = h('div', 'ring');
      const s = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
      s.append(svg('circle', { cx: 50, cy: 50, r: 46, class: 'ring-track' }));
      arcGroup = svg('g');
      s.append(arcGroup);
      const center = h('div', 'ring-center');
      center.append((labelEl = h('div', 'label')), (mainEl = h('div', 'chrono')), (noteEl = h('div', 'note')));
      if (count) {
        center.append((countEl = h('div', 'count')));
        root.classList.add('has-count');
      }
      if (action) {
        const controls = h('div', 'controls');
        action.mount(controls);
        center.append(controls);
      }
      root.append(s);
      if (icon) {
        const ico = h('i', `ring-ico ${icon.tone}`, icon.glyph);
        if (icon.html) ico.innerHTML = icon.html; // static markup (src/ui/icons.js)
        ico.setAttribute('aria-hidden', 'true');
        root.append(ico);
      }
      root.append(center);
      el.append(root);
    },
    update(m) {
      const list = arcs(m);
      const geo = ringArcs(list);
      while (arcEls.length < list.length) {
        const c = svg('circle', { cx: 50, cy: 50, r: 46, class: 'ring-arc' });
        arcGroup.append(c);
        arcEls.push(c);
      }
      arcEls.forEach((c, i) => {
        const g = geo[i];
        c.style.display = g && g.length > 0 ? '' : 'none';
        if (!g) return;
        setAttr(c, 'stroke-dasharray', g.dasharray);
        setAttr(c, 'stroke-dashoffset', g.dashoffset);
        const { tone: arcTone = 'pace', segment, faint } = list[i];
        setAttr(c, 'class', `ring-arc tone-${arcTone}${segment ? ' seg' : ''}${faint ? ' faint' : ''}`);
      });
      setText(labelEl, label(m));
      setText(mainEl, main(m));
      setText(noteEl, note(m));
      if (count) setText(countEl, count(m));
      for (const t of ['work', 'rest', 'warm']) root.classList.toggle(`t-${t}`, tone(m) === t);
      root.classList.toggle('dimmed', !!dimmed(m));
      if (action) {
        action.setVisible?.(!!actionVisible(m));
        action.update(m);
      }
    },
  };
}

/**
 * Split bar: fixed scale from `slow` (left) to `fast` (right), seconds per 500 m.
 * Cursor = values.instPace (smoothed by the app, src/smooth.js; hidden when null or paused),
 * white diamond = session.avgSplit.
 * Off scale: stuck to the edge with ◀ / ▶. target(model) -> { from, to } (s/500 m) | null
 * draws a yellow target zone (efforts of a programme).
 */
export function splitBar({ slow = 150, fast = 110, ticks = [140, 130, 120], target = () => null } = {}) {
  let zone, avg, avgArrow, cursor, cursorArrow;
  const pos = (s) => splitBarPosition(s, { slow, fast });
  const place = (el, arrow, p) => {
    el.hidden = !p;
    if (!p) return;
    el.style.left = `${(p.ratio * 100).toFixed(2)}%`;
    el.dataset.clamp = p.clamp ?? '';
    setText(arrow, p.clamp === 'left' ? '◀' : p.clamp === 'right' ? '▶' : '');
  };
  return {
    mount(el) {
      const bar = h('div', 'splitbar');
      const track = h('div', 'track');
      zone = h('div', 'target');
      zone.hidden = true;
      track.append(zone);
      for (const t of ticks) {
        const tick = h('div', 'tick');
        tick.style.left = `${pos(t).ratio * 100}%`;
        track.append(tick);
      }
      avg = h('div', 'avg');
      avg.append((avgArrow = h('span', 'arrow')));
      cursor = h('div', 'cursor');
      cursor.append((cursorArrow = h('span', 'arrow')));
      track.append(avg, cursor);
      const scale = h('div', 'scale');
      for (const s of [slow, ...ticks, fast]) {
        const span = h('span', null, formatPace(s));
        span.style.left = `${pos(s).ratio * 100}%`;
        scale.append(span);
      }
      bar.append(track, scale);
      el.append(bar);
    },
    update(m) {
      const paused = m.session?.status === 'paused';
      place(cursor, cursorArrow, paused ? null : pos(m.values?.instPace));
      place(avg, avgArrow, pos(m.session?.avgSplit));
      const t = target(m);
      zone.hidden = !t;
      if (t) {
        const a = pos(Math.max(t.from, t.to)).ratio; // slower bound on the left
        const b = pos(Math.min(t.from, t.to)).ratio;
        zone.style.left = `${a * 100}%`;
        zone.style.width = `${(b - a) * 100}%`;
      }
    },
  };
}

/** Summary actions (bar zone of the summary screen): tap to save the session, long press (fill shown) to discard it. */
export function summaryActions({ onKeep, onDiscard }) {
  const discard = holdButton({
    label: 'Ignorer la séance', text: 'Ignorer la séance', cls: 'discard', onHold: onDiscard,
    description: 'appui long 1,5 s pour supprimer la séance',
  });
  return {
    mount(el) {
      const row = h('div', 'actions');
      const keep = h('button', 'keep', 'Enregistrer la séance');
      keep.type = 'button';
      keep.addEventListener('click', () => onKeep?.());
      const discardWrap = h('div', 'discard-wrap');
      discard.mount(discardWrap);
      row.append(discardWrap, keep);
      el.append(row);
    },
    update() {},
  };
}

/**
 * Connection indicator: nothing while connected (a green dot was barely visible on the S23); a clearly visible
 * "Reconnexion…" band otherwise (connecting / disconnected during a session).
 * model.warning (optional text): a discreet line while connected (e.g. the screen may turn off).
 */
export function connection({ bandText = 'Reconnexion…' } = {}) {
  let band, warn;
  return {
    mount(el) {
      band = h('div', 'conn-band', bandText);
      band.setAttribute('role', 'status');
      warn = h('div', 'conn-warn');
      warn.hidden = true;
      el.append(band, warn);
    },
    update(m) {
      const ok = m.status === 'connected';
      band.hidden = ok;
      warn.hidden = !m.warning || !ok; // the red band has priority over a warning
      setText(warn, m.warning ?? '');
    },
  };
}

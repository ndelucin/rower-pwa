// UI components. Each factory returns { mount(el), update(model) }:
//  - mount builds the DOM once inside its zone,
//  - update only changes text / attributes (called on every new frame, ~1-2 times per second).
// model = { values, history, status, sourceLabel } (see app.js).
import { sparklinePath } from './format.js';

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

/** Banner: session title on the left, a live detail (e.g. elapsed time) next to it. */
export function banner({ title, detail }) {
  let detailEl;
  return {
    mount(el) {
      el.append(h('span', 'banner-name', title), (detailEl = h('span', 'banner-detail')));
    },
    update(m) { setText(detailEl, detail(m.values)); },
  };
}

const STATUS_TEXT = { connecting: 'Connexion…', connected: null, disconnected: 'Déconnecté' };

/** Connection indicator, always visible (brief § 5). */
export function statusPill() {
  let pill;
  return {
    mount(el) { el.append((pill = h('span', 'status'))); },
    update(m) {
      pill.dataset.state = m.status;
      setText(pill, STATUS_TEXT[m.status] ?? m.sourceLabel);
    },
  };
}

/** One very large number (main zone). */
export function bigMetric({ label, value, unit = '' }) {
  let valueEl;
  return {
    mount(el) {
      el.append(h('div', 'big-label', label), (valueEl = h('div', 'big-value')), h('div', 'big-unit', unit));
    },
    update(m) { setText(valueEl, value(m.values)); },
  };
}

/** 2 x 2 grid of secondary metrics. items: [{ label, unit, value(values) }] */
export function metricGrid(items) {
  const cells = [];
  return {
    mount(el) {
      for (const it of items) {
        const v = h('div', 'metric-value');
        const cell = h('div', 'metric');
        cell.append(h('div', 'metric-label', it.label), v, h('div', 'metric-unit', it.unit ?? ''));
        el.append(cell);
        cells.push(v);
      }
    },
    update(m) { items.forEach((it, i) => setText(cells[i], it.value(m.values))); },
  };
}

/**
 * Mini-curve of the split over the last `window` seconds (faster = higher).
 * Only one curve: on a WaterRower the power is computed from the speed, so a power curve
 * would be the same shape and add nothing.
 */
export function sparkline({ window = 180 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000, H = 100;
  let pacePath;
  return {
    mount(el) {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.classList.add('spark');
      pacePath = document.createElementNS(NS, 'path');
      pacePath.classList.add('spark-pace');
      svg.append(pacePath);
      el.append(svg, h('div', 'spark-legend', `Split · ${Math.round(window / 60)} dernières min · plus haut = plus rapide`));
      el.lastChild.classList.add('lg-pace');
    },
    update(m) {
      const recent = m.history.slice(-window);
      pacePath.setAttribute('d', sparklinePath(recent.map((s) => s.pace), { width: W, height: H, invert: true, minSpan: 40 }));
    },
  };
}

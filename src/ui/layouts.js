// One configuration per screen: which component goes into which zone of the common template
// (index.html: left, center, right, bar, conn). See docs/ECRAN.md.
// Adding a session type = adding an entry here; the template never changes.
import { metricColumn, ring, holdButton, splitBar, summaryActions, connection } from './components.js';
import { formatPace, formatDuration, formatNumber, formatDistance } from './format.js';

const RING_DISTANCE = 2000; // m: one full turn of the ring in a free session (reference rowing distance)

const sessionOf = (m) => m.session ?? {};
const isPaused = (m) => sessionOf(m).status === 'paused';
// Instantaneous values: "--" when the activity filter has nothing, and always while paused.
const inst = (m, key) => (isPaused(m) ? null : m.values?.[key]);
// Ring fraction: wraps every 2000 m so long sessions keep moving.
const distanceArc = (d) => {
  const f = d > 0 ? (d % RING_DISTANCE) / RING_DISTANCE : 0;
  return [{ from: 0, to: d > 0 && f === 0 ? 1 : f, tone: 'pace' }];
};

const NOTE = { waiting: 'Premier coup pour démarrer' };

export const LAYOUTS = {
  /** Free session. onEnd() is called after a long press on ■ (only shown while paused). */
  free: ({ onEnd } = {}) => ({
    left: metricColumn([
      { label: 'Split /500 m', tone: 'pace', value: (m) => formatPace(inst(m, 'instPace')) },
      { label: 'Puissance', unit: 'W', tone: 'power', value: (m) => formatNumber(inst(m, 'instPower')) },
    ]),
    center: ring({
      arcs: (m) => distanceArc(sessionOf(m).distance ?? 0),
      label: (m) => (isPaused(m) ? 'En pause' : 'Temps écoulé'),
      main: (m) => formatDuration(sessionOf(m).elapsed ?? 0),
      note: (m) => NOTE[sessionOf(m).status] ?? '',
      dimmed: isPaused,
      action: holdButton({ label: 'Terminer la séance (appui long)', icon: 'stop', cls: 'stop', onHold: onEnd }),
      actionVisible: isPaused,
    }),
    right: metricColumn([
      { label: 'Cadence', unit: '/min', value: (m) => formatNumber(inst(m, 'strokeRate')) },
      { label: 'Distance', unit: 'm', value: (m) => formatDistance(sessionOf(m).distance ?? 0) },
    ], { align: 'right' }),
    bar: splitBar(),
    conn: connection(),
  }),

  /** Summary after the end of a session. model.session = summary() of src/session.js. */
  summary: ({ onKeep, onDiscard } = {}) => ({
    left: metricColumn([
      { label: 'Split moyen', tone: 'pace', value: (m) => formatPace(sessionOf(m).avgSplit) },
      { label: 'Puissance moy.', unit: 'W', tone: 'power', value: (m) => formatNumber(sessionOf(m).avgPower) },
    ]),
    center: ring({
      arcs: (m) => distanceArc(sessionOf(m).distance ?? 0),
      label: () => 'Séance terminée',
      main: (m) => formatDuration(sessionOf(m).duration),
      note: (m) => (sessionOf(m).best500 != null ? `Meilleur 500 m  ${formatPace(sessionOf(m).best500)}` : ''),
    }),
    right: metricColumn([
      { label: 'Cadence moy.', unit: '/min', value: (m) => formatNumber(sessionOf(m).avgSpm) },
      { label: 'Distance', unit: 'm', value: (m) => formatDistance(sessionOf(m).distance) },
    ], { align: 'right' }),
    bar: summaryActions({ onKeep, onDiscard }),
  }),
};

/**
 * Mounts a layout into the template: every [data-zone] element is emptied, then the zones
 * named by the layout receive their component (a zone the layout does not use stays empty).
 */
export function mountLayout(root, layout) {
  root.querySelectorAll('[data-zone]').forEach((el) => el.replaceChildren());
  const components = Object.entries(layout).map(([zone, component]) => {
    component.mount(root.querySelector(`[data-zone="${zone}"]`));
    return component;
  });
  return { update: (model) => components.forEach((c) => c.update(model)) };
}

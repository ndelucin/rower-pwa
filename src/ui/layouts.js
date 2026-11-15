// One configuration per session type: which component goes into which zone (brief § 7).
// Adding a session type = adding an entry here; the template (index.html) never changes.
import { banner, statusPill, bigMetric, metricGrid, sparkline } from './components.js';
import { formatPace, formatDuration, formatNumber } from './format.js';

export const LAYOUTS = {
  free: () => ({
    banner: banner({ title: 'Séance libre', detail: (v) => formatDuration(v.elapsedTime) }),
    status: statusPill(),
    main: bigMetric({ label: 'Split', value: (v) => formatPace(v.instPace), unit: '/500 m' }),
    side: metricGrid([
      { label: 'Puissance', unit: 'W', value: (v) => formatNumber(v.instPower) },
      { label: 'Cadence', unit: 'coups/min', value: (v) => formatNumber(v.strokeRate) },
      { label: 'Distance', unit: 'm', value: (v) => formatNumber(v.totalDistance) },
      { label: 'Split moyen', unit: '/500 m', value: (v) => formatPace(v.avgPace) },
    ]),
    progress: sparkline({ window: 180 }),
  }),
};

/** Mounts a layout into the template: every [data-zone] element receives its component. */
export function mountLayout(root, layout) {
  const components = Object.entries(layout).map(([zone, component]) => {
    const el = root.querySelector(`[data-zone="${zone}"]`);
    el.replaceChildren();
    component.mount(el);
    return component;
  });
  return { update: (model) => components.forEach((c) => c.update(model)) };
}

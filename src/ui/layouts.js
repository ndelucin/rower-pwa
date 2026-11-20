// One configuration per screen: which component goes into which zone of the common template
// (index.html: left, center, right, bar, conn). See docs/ECRAN.md.
// Adding a session type = adding a case here; the template never changes.
import { metricColumn, ring, tapButton, backButton, controlGroup, splitBar, summaryActions, connection } from './components.js';
import { formatPace, formatDuration, formatNumber, formatDistance, formatDistanceShort } from './format.js';
import { goalProgress } from '../goal.js';
import { engineOf } from '../engine.js';
import { DEFAULT_REFERENCE, targetZone } from '../target.js';

const RING_DISTANCE = 2000; // m: one full turn of the ring in a free session (reference rowing distance)

// Colours carry the data, not the controls: blue = time, violet = distance, yellow = intervals, grey = free.
// The ring icon says which kind of session this is.
const ICON = {
  free: { glyph: '∞', tone: 'free' },
  duration: { glyph: '◔', tone: 'dur' },
  distance: { glyph: '↔', tone: 'dist' },
  program: { glyph: '▮▯▮', tone: 'intv' },
};
// Ring arc colour of a goal (the summary draws it in the colour of its session type).
const GOAL_TONE = { duration: 'dur', distance: 'dist', program: 'work' };

const sessionOf = (m) => m.session ?? {};
const isPaused = (m) => sessionOf(m).status === 'paused';
// Instantaneous values: "--" when the activity filter has nothing, and always while paused.
const inst = (m, key) => (isPaused(m) ? null : m.values?.[key]);
// Ring fraction: wraps every 2000 m so long sessions keep moving (free session).
const distanceArc = (d) => {
  const f = d > 0 ? (d % RING_DISTANCE) / RING_DISTANCE : 0;
  return [{ from: 0, to: d > 0 && f === 0 ? 1 : f, tone: 'dist' }];
};

const NOTE = { waiting: 'Premier coup pour démarrer' };
const elapsedOf = (m) => sessionOf(m).displayElapsed ?? sessionOf(m).elapsed ?? 0;

// Ring of a programme: the frieze of the current phase (one arc per segment, past ones bright, to-come ones faint,
// the running one filling up), phase name, countdown of the segment, "n / N" counter. Never shows a pause.
export function programCentre(goal) {
  const at = (m) => engineOf(goal.programId).positionAt(sessionOf(m).wallElapsed ?? 0);
  return {
    arcs: (m) => at(m).frieze.flatMap(({ from, to, tone, progress }) => {
      const arc = { from, to, tone, segment: true, gap: 0.004 };
      return progress > 0 ? [{ ...arc, faint: true }, { ...arc, to: from + (to - from) * progress }] : [{ ...arc, faint: true }];
    }),
    label: (m) => at(m).name,
    main: (m) => formatDuration(Math.ceil(at(m).remaining)),
    count: (m) => at(m).count,
    tone: (m) => at(m).tone,
    dimmed: () => false,
  };
}

/** Centre of the ring (label, big text, ring arc) per kind of session. */
export function centre(goal) {
  if (goal?.kind === 'program') return programCentre(goal);
  if (goal?.kind === 'duration') {
    return {
      arcs: (m) => [{ from: 0, to: goalProgress(goal, sessionOf(m)).fraction, tone: 'dur' }],
      label: (m) => (isPaused(m) ? 'En pause' : 'Temps restant'),
      main: (m) => formatDuration(goalProgress(goal, sessionOf(m)).remaining),
    };
  }
  if (goal?.kind === 'distance') {
    return {
      arcs: (m) => [{ from: 0, to: goalProgress(goal, sessionOf(m)).fraction, tone: 'dist' }],
      label: (m) => (isPaused(m) ? 'En pause' : 'Distance restante'),
      main: (m) => formatDistanceShort(goalProgress(goal, sessionOf(m)).remaining),
    };
  }
  return {
    arcs: (m) => distanceArc(sessionOf(m).distance ?? 0),
    label: (m) => (isPaused(m) ? 'En pause' : 'Temps écoulé'),
    main: (m) => formatDuration(elapsedOf(m)),
  };
}

// Target zone of the split bar: only during an effort.
export function programTarget(goal, reference, m) {
  const position = engineOf(goal.programId).positionAt(sessionOf(m).wallElapsed ?? 0);
  return position.tone === 'work' ? targetZone(reference, position.duration) : null;
}

export const LAYOUTS = {
  /**
   * Running session: free (no goal) or with a goal { kind: 'duration' | 'distance', target } or { kind: 'program', programId }.
   * Before the first stroke the ring shows « ‹ Retour » (onBack(): back to the session choice, nothing recorded);
   * while paused it shows ⏸ (onEnd(): ends the session at once).
   * The fourth value is the distance, or the time when the goal is a distance (the ring already shows the distance).
   * reference: personal split reference (s/500 m) of the target zone shown during the efforts of a programme.
   */
  session: ({ goal = null, reference = DEFAULT_REFERENCE, onEnd, onBack } = {}) => ({
    left: metricColumn([
      { label: 'Split /500 m', value: (m) => formatPace(inst(m, 'instPace')) },
      { label: 'Puissance', unit: 'W', value: (m) => formatNumber(inst(m, 'instPower')) },
    ]),
    center: ring({
      dimmed: isPaused,
      ...centre(goal),
      icon: ICON[goal?.kind ?? 'free'],
      note: (m) => NOTE[sessionOf(m).status] ?? '',
      action: controlGroup([
        { component: backButton({ onTap: onBack }), visible: (m) => sessionOf(m).status === 'waiting' },
        { component: tapButton({ label: 'Terminer la séance', icon: 'pause', cls: 'stop', onTap: onEnd }), visible: isPaused },
      ]),
      actionVisible: (m) => ['waiting', 'paused'].includes(sessionOf(m).status),
    }),
    right: metricColumn([
      { label: 'Cadence', unit: '/min', value: (m) => formatNumber(inst(m, 'strokeRate')) },
      goal?.kind === 'distance'
        ? { label: 'Temps', value: (m) => formatDuration(elapsedOf(m)) }
        : { label: 'Distance', unit: 'm', value: (m) => formatDistance(sessionOf(m).distance ?? 0) },
    ], { align: 'right' }),
    bar: splitBar(goal?.kind === 'program' ? { target: (m) => programTarget(goal, reference, m) } : {}),
    conn: connection(),
  }),

  /**
   * Summary after the end of a session. model.session = summary() of src/session.js.
   * goal: the goal of the session, if any; goalReached: it ended because the goal was reached.
   */
  summary: ({ goal = null, goalReached = false, onKeep, onDiscard } = {}) => ({
    left: metricColumn([
      { label: 'Split moyen', value: (m) => formatPace(sessionOf(m).avgSplit) },
      { label: 'Puissance moy.', unit: 'W', value: (m) => formatNumber(sessionOf(m).avgPower) },
    ]),
    center: ring({
      arcs: (m) => {
        if (!goal) return distanceArc(sessionOf(m).distance ?? 0);
        const elapsed = sessionOf(m).duration;
        const f = goalReached ? 1 : goalProgress(goal, { ...sessionOf(m), displayElapsed: elapsed, wallElapsed: elapsed }).fraction;
        return [{ from: 0, to: f, tone: GOAL_TONE[goal.kind] }];
      },
      icon: ICON[goal?.kind ?? 'free'],
      label: () => 'Séance terminée',
      main: (m) => formatDuration(sessionOf(m).duration),
      note: (m) => (goalReached ? 'Objectif atteint' : sessionOf(m).best500 != null ? `Meilleur 500 m  ${formatPace(sessionOf(m).best500)}` : ''),
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

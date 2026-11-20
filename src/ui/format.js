// Pure display helpers (no DOM): testable under Node.
import { formatPace } from '../ftms.js';
export { formatPace };

/** 754 -> "12:34" ; 3723 -> "1:02:03" ; null -> "--" */
export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '--';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** null -> "--", else the number (optionally with a fixed number of decimals). */
export function formatNumber(value, decimals = 0) {
  if (value == null || !Number.isFinite(value)) return '--';
  return decimals ? value.toFixed(decimals) : String(Math.round(value));
}

/** 1250.7 -> "1 250" (narrow no-break space as thousands separator) ; null -> "--" */
export function formatDistance(meters) {
  if (meters == null || !Number.isFinite(meters)) return '--';
  return String(Math.max(0, Math.floor(meters))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Remaining distance on the ring: 750 -> "750 m", 1500 -> "1,5 km" (rounded up: never "0 m" before the goal). */
export function formatDistanceShort(meters) {
  if (meters == null || !Number.isFinite(meters)) return '--';
  const m = Math.max(0, Math.ceil(meters));
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${m} m`;
}

/**
 * Position of a split (s/500 m) on the fixed split bar: slow on the left, fast on the right.
 * Returns { ratio in [0, 1], clamp: 'left' | 'right' | null } ; null when there is no split.
 */
export function splitBarPosition(split, { slow = 150, fast = 110 } = {}) {
  if (split == null || !Number.isFinite(split)) return null;
  const ratio = (slow - split) / (slow - fast);
  if (ratio < 0) return { ratio: 0, clamp: 'left' };
  if (ratio > 1) return { ratio: 1, clamp: 'right' };
  return { ratio, clamp: null };
}

/** Circumference of a ring of radius r (SVG user units). */
export const ringCircumference = (r = 46) => 2 * Math.PI * r;

/**
 * SVG stroke geometry for arcs on a ring (circle drawn from 12 o'clock, clockwise once the
 * SVG is rotated by -90°). segments: [{ from, to }] as fractions of a full turn (0..1).
 * gap: fraction of a turn left empty at the end of each arc (to separate v2 intervals).
 * Returns, per segment, the values for stroke-dasharray / stroke-dashoffset.
 */
export function ringArcs(segments, { r = 46, gap = 0 } = {}) {
  const c = ringCircumference(r);
  const round = (x) => Math.round(x * 100) / 100;
  return segments.map(({ from, to }) => {
    const a = Math.min(Math.max(from, 0), 1);
    const b = Math.min(Math.max(to, a), 1);
    const length = Math.max((b - a - gap) * c, 0);
    return { dasharray: `${round(length)} ${round(c)}`, dashoffset: round(-a * c) || 0, length: round(length) };
  });
}

/**
 * Start screen line for the last saved session (summary() of src/session.js), or '' if none.
 * "Dernière séance : hier · 2:17 · 604 m · 2:13 /500 m". `now` is passed in (testable).
 */
export function formatLastSession(summary, now) {
  if (!summary?.startedAt) return '';
  const day = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((day(now) - day(summary.startedAt)) / 86400000);
  const when = days === 0 ? "aujourd'hui" : days === 1 ? 'hier'
    : `le ${new Date(summary.startedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
  const parts = [when, formatDuration(summary.duration), `${formatDistance(summary.distance)} m`];
  if (summary.avgSplit != null) parts.push(`${formatPace(summary.avgSplit)} /500 m`);
  return `Dernière séance : ${parts.join(' · ')}`;
}

// Pure display helpers (no DOM): testable under Node.
export { formatPace } from '../ftms.js';

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

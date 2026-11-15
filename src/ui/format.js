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

/**
 * SVG path ("M x y L x y ...") for a mini-curve. Points are evenly spaced over `width`;
 * null values create a gap (new "M"). invert: true draws small values at the top
 * (used for the split: lower = faster = higher on screen). minSpan: smallest value range drawn.
 */
export function sparklinePath(values, { width = 100, height = 100, invert = false, pad = 0.1, minSpan = 2 } = {}) {
  const known = values.filter((v) => v != null && Number.isFinite(v));
  if (known.length === 0) return '';
  let min = Math.min(...known);
  let max = Math.max(...known);
  // minSpan: the vertical scale never zooms in more than this, so small noise stays small on screen.
  if (max - min < minSpan) {
    const mid = (min + max) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const span = max - min;
  min -= span * pad;
  max += span * pad;

  const step = values.length > 1 ? width / (values.length - 1) : 0;
  let d = '';
  let penDown = false;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { penDown = false; return; }
    const ratio = (v - min) / (max - min);
    const y = invert ? ratio * height : (1 - ratio) * height;
    d += `${penDown ? 'L' : 'M'}${(i * step).toFixed(1)} ${y.toFixed(1)} `;
    penDown = true;
  });
  return d.trim();
}

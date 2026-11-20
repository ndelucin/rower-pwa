// Build stamp shown discreetly on the start screen, to know which version runs on the phone.
// Rewritten by scripts/stamp-version.js before each commit: do not edit by hand.
export const BUILD = { number: 52, at: '2026-11-20T18:49:19.002Z' };

/** "build 14 · 15/11 21:34" (local time of the device). */
export function formatBuild({ number, at }, locale = 'fr-FR') {
  const d = new Date(at);
  const day = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `build ${number} · ${day} ${time}`;
}

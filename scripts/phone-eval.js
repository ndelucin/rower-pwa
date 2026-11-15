// Evaluates a JavaScript expression in the rower-pwa page open in Chrome on the phone (USB + adb),
// through the Chrome DevTools Protocol. Development tool: lets us read window.__rower from the Mac.
// Usage: node scripts/phone-eval.js ['expression']   (default: the diagnostic journal)
//        node scripts/phone-eval.js --reload          (reload bypassing the cache, after a code change)
import { execSync } from 'node:child_process';

const PORT = 9222;
const reload = process.argv[2] === '--reload';
const expression = process.argv[2]
  ?? 'JSON.stringify({ ...window.__rower, snapshot: window.__rower.snapshot() }, null, 2)';

// Chrome on Android exposes its DevTools on a local socket; adb forwards it to a Mac TCP port.
execSync(`adb forward tcp:${PORT} localabstract:chrome_devtools_remote`);
const pages = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = pages.find((p) => p.type === 'page' && p.url.startsWith('http://localhost:8080'));
if (!page) {
  // Never print the other tabs' URLs: they are the user's private browsing.
  console.error('Page rower-pwa (http://localhost:8080) introuvable dans Chrome sur le téléphone.');
  process.exit(1);
}

// Never hang: a page in the background or a stale target may never answer.
setTimeout(() => { console.error('Pas de réponse du téléphone (écran éteint, onglet en arrière-plan ?)'); process.exit(2); }, 8000).unref();

const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onopen = () => ws.send(JSON.stringify(reload
  ? { id: 1, method: 'Page.reload', params: { ignoreCache: true } }
  : { id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
ws.onmessage = (msg) => {
  const { id, result } = JSON.parse(msg.data);
  if (id !== 1) return;
  if (reload) { console.log('page rechargée sans cache'); ws.close(); return; }
  if (result?.exceptionDetails) console.error(result.exceptionDetails.exception?.description);
  else console.log(result?.result?.value);
  ws.close();
};
ws.onerror = (e) => { console.error('WebSocket :', e.message); process.exit(1); };

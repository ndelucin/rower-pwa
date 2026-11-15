import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The site is served under a sub-path on GitHub Pages: every path must be relative (brief § 13).
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root)));
const isRelative = (p) => !/^(\/|[a-z]+:)/i.test(p);

test('manifest: installable, fullscreen, free orientation (landscape is locked by the app), relative paths', () => {
  assert.equal(manifest.name, 'RowerMonitor');
  assert.equal(manifest.display, 'fullscreen');
  assert.equal(manifest.orientation, 'any'); // portrait start screen; app.js locks landscape for the session
  for (const p of [manifest.id, manifest.start_url, manifest.scope]) assert.ok(isRelative(p), p);
  assert.equal(manifest.id, './');
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone']);
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'Chrome needs 192 and 512 icons');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

test('manifest icons exist and use relative paths', () => {
  for (const { src } of manifest.icons) {
    assert.ok(isRelative(src), src);
    assert.ok(existsSync(new URL(src, root)), src);
  }
});

test('service worker and its registration use relative paths only', () => {
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  for (const [, p] of sw.matchAll(/'(\.?\/[^']*)'/g)) assert.ok(p.startsWith('./'), p);
  assert.match(readFileSync(new URL('src/app.js', root), 'utf8'), /register\('\.\/sw\.js'\)/);
  assert.match(readFileSync(new URL('index.html', root), 'utf8'), /href="manifest\.webmanifest"/);
});

test('service worker pre-caches every module of the app (import graph from src/app.js) and the icons', () => {
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const shell = new Set([...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]));
  const seen = new Set();
  const walk = (path) => { // path relative to the site root, e.g. "src/ui/layouts.js"
    if (seen.has(path)) return;
    seen.add(path);
    const text = readFileSync(new URL(path, root), 'utf8');
    for (const [, spec] of text.matchAll(/from '(\.[^']+)'/g)) {
      walk(fileURLToPath(new URL(spec, new URL(path, root))).slice(fileURLToPath(root).length));
    }
  };
  walk('src/app.js');
  for (const p of seen) assert.ok(shell.has(`./${p}`), `missing from SHELL: ${p}`);
  for (const { src } of manifest.icons) assert.ok(shell.has(`./${src}`), `icon missing from SHELL: ${src}`);
  for (const p of ['./', './index.html', './manifest.webmanifest', './src/ui/styles.css']) assert.ok(shell.has(p), p);
  for (const p of shell) if (p !== './') assert.ok(existsSync(new URL(p, root)), `SHELL lists a missing file: ${p}`);
});

test('index.html preloads the modules (flattens the import waterfall)', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const preloaded = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]));
  for (const p of ['src/ftms.js', 'src/ui/layouts.js', 'src/ble.js', 'src/session.js']) assert.ok(preloaded.has(p), p);
  for (const p of preloaded) assert.ok(isRelative(p) && existsSync(new URL(p, root)), p);
});

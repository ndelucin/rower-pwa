import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// The site is served under a sub-path on GitHub Pages: every path must be relative (brief § 13).
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root)));
const isRelative = (p) => !/^(\/|[a-z]+:)/i.test(p);

test('manifest: installable, fullscreen, free orientation (landscape is locked by the app), relative paths', () => {
  assert.equal(manifest.name, 'RowerMonitor');
  assert.equal(manifest.display, 'fullscreen');
  assert.equal(manifest.orientation, 'any'); // portrait start screen; app.js locks landscape for the session
  for (const p of [manifest.start_url, manifest.scope]) assert.ok(isRelative(p), p);
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

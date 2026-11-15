import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeepAwake } from '../src/wakelock.js';

function fakes() {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  let requests = 0;
  let current = null;
  const wakeLock = {
    request: async (type) => {
      assert.equal(type, 'screen');
      requests += 1;
      current = new EventTarget();
      current.release = async () => { current.dispatchEvent(new Event('release')); };
      return current;
    },
  };
  // What the browser does when the page is hidden: releases the lock.
  const hide = () => { doc.visibilityState = 'hidden'; current?.dispatchEvent(new Event('release')); doc.dispatchEvent(new Event('visibilitychange')); };
  const show = () => { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); };
  return { doc, wakeLock, hide, show, requests: () => requests };
}

const flush = () => new Promise((r) => setImmediate(r));

test('start keeps the screen on', async () => {
  const f = fakes();
  const k = createKeepAwake({ wakeLock: f.wakeLock, doc: f.doc });
  await k.start();
  assert.equal(k.active, true);
});

test('lock lost when the page is hidden is taken again when it comes back', async () => {
  const f = fakes();
  const k = createKeepAwake({ wakeLock: f.wakeLock, doc: f.doc });
  await k.start();
  f.hide();
  await flush();
  assert.equal(k.active, false);
  f.show();
  await flush();
  assert.equal(k.active, true);
  assert.equal(f.requests(), 2);
});

test('after stop, coming back does not take the lock again', async () => {
  const f = fakes();
  const k = createKeepAwake({ wakeLock: f.wakeLock, doc: f.doc });
  await k.start();
  await k.stop();
  f.hide();
  f.show();
  await flush();
  assert.equal(k.active, false);
  assert.equal(f.requests(), 1);
});

test('unsupported browser: no crash', async () => {
  const f = fakes();
  const k = createKeepAwake({ wakeLock: undefined, doc: f.doc });
  assert.equal(k.supported, false);
  await k.start();
  assert.equal(k.active, false);
});

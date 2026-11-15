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

// A wake lock whose request() only answers when we say so (the browser can take a while).
function slowFakes() {
  const f = fakes();
  const sentinels = [];
  let resolvers = [];
  f.wakeLock.request = () => new Promise((resolve) => {
    resolvers.push(() => {
      const s = new EventTarget();
      s.released = false;
      s.release = async () => { s.released = true; s.dispatchEvent(new Event('release')); };
      sentinels.push(s);
      resolve(s);
    });
  });
  return { ...f, sentinels, answer: () => { resolvers.forEach((r) => r()); resolvers = []; }, pendingRequests: () => resolvers.length };
}

test('stop() while the request is in flight: the late lock is released, not kept', async () => {
  const f = slowFakes();
  const k = createKeepAwake({ wakeLock: f.wakeLock, doc: f.doc });
  const starting = k.start();
  await flush();
  await k.stop();
  f.answer();
  await starting;
  await flush();
  assert.equal(k.active, false);
  assert.equal(f.sentinels.length, 1);
  assert.equal(f.sentinels[0].released, true);
});

test('start() and a visibility return at the same time: one request, one lock', async () => {
  const f = slowFakes();
  const k = createKeepAwake({ wakeLock: f.wakeLock, doc: f.doc });
  const starting = k.start();
  f.show(); // visibilitychange while the first request is pending
  await flush();
  assert.equal(f.pendingRequests(), 1);
  f.answer();
  await starting;
  await flush();
  assert.equal(k.active, true);
  assert.equal(f.sentinels.length, 1);
  assert.equal(f.sentinels[0].released, false);
});

test('request refused: denied is reported, active stays false', async () => {
  const f = fakes();
  f.wakeLock.request = async () => { throw Object.assign(new Error('low battery'), { name: 'NotAllowedError' }); };
  const k = createKeepAwake({ wakeLock: f.wakeLock, doc: f.doc });
  await k.start();
  assert.equal(k.active, false);
  assert.equal(k.denied, true);
});

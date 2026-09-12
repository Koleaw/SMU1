import assert from 'node:assert/strict';
import test from 'node:test';
import { createOverlayRenderGuard } from '../../src/admin/shell/overlay-render-guard.mjs';

function fixture() {
  const frames = [];
  let renders = 0;
  const guard = createOverlayRenderGuard(() => renders++, (callback) => frames.push(callback));
  return { guard, renders: () => renders, frame: () => frames.shift()?.() };
}

test('geometry leaves a pressed target alive through pointerup and native click', () => {
  const { guard, renders, frame } = fixture();
  guard.request();
  guard.hold(1);
  guard.request();
  guard.request();
  assert.equal(renders(), 1);
  guard.release(1);
  guard.request(); // The click handler can itself request fresh selection geometry.
  assert.equal(renders(), 1);
  frame();
  assert.equal(renders(), 2);
});

test('a new press before the deferred frame keeps its target intact', () => {
  const { guard, renders, frame } = fixture();
  guard.hold(1);
  guard.request();
  guard.release(1);
  guard.hold(2);
  frame();
  assert.equal(renders(), 0);
  guard.release(2);
  frame();
  assert.equal(renders(), 1);
});

test('cancelled pointers flush geometry instead of leaving a pressed gesture behind', () => {
  const { guard, renders, frame } = fixture();
  guard.hold(1);
  guard.request();
  guard.release(1);
  frame();
  assert.equal(renders(), 1);
  guard.request();
  assert.equal(renders(), 2);
});

test('lost pointer or window blur flushes pending geometry and does not freeze later updates', () => {
  const { guard, renders, frame } = fixture();
  guard.hold(1);
  guard.request();
  guard.releaseAll();
  frame();
  guard.request();
  assert.equal(renders(), 2);
});

test('keyboard and idle geometry renders without a frame delay', () => {
  const { guard, renders } = fixture();
  guard.release(99);
  guard.releaseAll();
  guard.request();
  guard.request();
  assert.equal(renders(), 2);
});

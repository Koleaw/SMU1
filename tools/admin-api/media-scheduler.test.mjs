import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import {
  MEDIA_QUEUE_STATUS,
  createMediaScheduler,
  planMediaWindows
} from './media-scheduler.mjs';

function items(count, bytes = 1024) {
  return Array.from({ length: count }, (_, index) => ({
    clientId: `client-${String(index).padStart(3, '0')}`,
    originalIndex: index,
    bytes,
    payload: index
  }));
}

async function rejectsCode(action, code) {
  await assert.rejects(async () => action(), (error) => error?.code === code);
}

test('window planner handles 1/2/10/11/25/50 items without exceeding item or byte bounds', () => {
  for (const count of [1, 2, 10, 11, 25, 50]) {
    const planned = planMediaWindows(items(count));
    assert.equal(planned.flat().length, count);
    assert.equal(planned.every((window) => window.length <= 10), true);
    assert.equal(planned.every((window) => window.reduce((sum, entry) => sum + entry.bytes, 0) <= 48 * 1024 * 1024), true);
    assert.deepEqual(planned.flat().map((entry) => entry.clientId), items(count).map((item) => item.clientId));
  }
  assert.deepEqual(planMediaWindows(items(11)).map((window) => window.length), [10, 1]);
  assert.deepEqual(planMediaWindows(items(25)).map((window) => window.length), [10, 10, 5]);
  assert.deepEqual(planMediaWindows(items(50)).map((window) => window.length), [10, 10, 10, 10, 10]);

  const tenMiB = 10 * 1024 * 1024;
  assert.deepEqual(planMediaWindows(items(6, tenMiB)).map((window) => window.length), [4, 2]);
});

test('scheduler never exceeds concurrency 2 and result order is queue order, not completion order', async () => {
  let active = 0;
  let maximumActive = 0;
  const completionOrder = [];
  const queue = items(10);
  const scheduler = createMediaScheduler({
    concurrency: 2,
    worker: async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await delay((10 - item.payload) * 2);
      completionOrder.push(item.clientId);
      active -= 1;
      return { serverId: `staged-${item.payload}` };
    }
  });
  const result = await scheduler.start(queue);
  assert.equal(maximumActive, 2);
  assert.notDeepEqual(completionOrder, queue.map((item) => item.clientId));
  assert.deepEqual(result.map((item) => item.clientId), queue.map((item) => item.clientId));
  assert.deepEqual(result.map((item) => item.result.serverId), queue.map((item) => `staged-${item.payload}`));
  assert.equal(result.every((item) => item.status === MEDIA_QUEUE_STATUS.UPLOADED), true);
});

test('next logical window starts only after the previous window settles', async () => {
  const queue = items(11);
  const completed = new Set();
  let eleventhStartedAfter = -1;
  const scheduler = createMediaScheduler({
    worker: async (item) => {
      if (item.payload === 10) eleventhStartedAfter = completed.size;
      await delay(2);
      completed.add(item.payload);
      return { ok: true };
    }
  });
  await scheduler.start(queue);
  assert.equal(eleventhStartedAfter, 10);
});

test('double start returns the same active promise and never duplicates requests', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const queue = items(2);
  const scheduler = createMediaScheduler({
    worker: async () => {
      calls += 1;
      await gate;
      return { ok: true };
    }
  });
  const first = scheduler.start(queue);
  const second = scheduler.start(queue);
  assert.strictEqual(second, first);
  await delay(5);
  assert.equal(calls, 2);
  release();
  await first;
  await scheduler.start(queue);
  assert.equal(calls, 2, 'A repeated click after completion does not upload successful items again.');
});

test('pending cancel never calls worker; in-flight abort remains an unknown server outcome', async () => {
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const calls = [];
  const queue = items(2);
  const scheduler = createMediaScheduler({
    concurrency: 1,
    worker: (item, { signal }) => new Promise((resolve, reject) => {
      calls.push(item.clientId);
      firstStarted();
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });
  const running = scheduler.start(queue);
  await started;
  scheduler.cancel(queue[1].clientId);
  scheduler.cancel(queue[0].clientId);
  const result = await running;
  assert.deepEqual(calls, [queue[0].clientId]);
  assert.equal(result[0].status, MEDIA_QUEUE_STATUS.CANCELLED);
  assert.equal(result[0].outcome, 'unknown');
  assert.equal(result[0].requiresStatusCheck, true);
  assert.equal(result[1].status, MEDIA_QUEUE_STATUS.CANCELLED);
  assert.equal(result[1].outcome, 'not-started');
  assert.equal(result[1].requiresStatusCheck, false);
});

test('partial failure stays visible and retryFailed retries failed items only', async () => {
  const attempts = new Map();
  const queue = items(3);
  const scheduler = createMediaScheduler({
    worker: async (item) => {
      const attempt = (attempts.get(item.clientId) ?? 0) + 1;
      attempts.set(item.clientId, attempt);
      if (item.payload === 1 && attempt === 1) {
        const error = new Error('synthetic network failure');
        error.code = 'NETWORK_FAILURE';
        throw error;
      }
      return item.payload === 2 ? { reused: true } : { uploaded: true };
    }
  });
  const first = await scheduler.start(queue);
  assert.deepEqual(first.map((item) => item.status), [
    MEDIA_QUEUE_STATUS.UPLOADED,
    MEDIA_QUEUE_STATUS.ERROR,
    MEDIA_QUEUE_STATUS.REUSED
  ]);
  assert.equal(first[1].error.code, 'NETWORK_FAILURE');

  const retried = await scheduler.retryFailed();
  assert.equal(retried.every((item) => [MEDIA_QUEUE_STATUS.UPLOADED, MEDIA_QUEUE_STATUS.REUSED].includes(item.status)), true);
  assert.deepEqual(Object.fromEntries(attempts), {
    'client-000': 1,
    'client-001': 2,
    'client-002': 1
  });
});

test('invalid policies, duplicate IDs and oversized window items fail before worker calls', async () => {
  assert.throws(() => createMediaScheduler({ concurrency: 3, worker: async () => ({}) }), {
    code: 'SCHEDULER_POLICY_INVALID'
  });
  assert.throws(() => planMediaWindows([
    { clientId: 'same-id', bytes: 1 },
    { clientId: 'same-id', bytes: 1 }
  ]), { code: 'MEDIA_CLIENT_ID_DUPLICATE' });
  assert.throws(() => planMediaWindows([
    { clientId: 'large-item', bytes: (48 * 1024 * 1024) + 1 }
  ]), { code: 'MEDIA_ITEM_EXCEEDS_WINDOW' });

  let calls = 0;
  const scheduler = createMediaScheduler({ worker: async () => { calls += 1; } });
  await rejectsCode(() => scheduler.start([{ clientId: '../escape', bytes: 10 }]), 'MEDIA_CLIENT_ID_INVALID');
  assert.equal(calls, 0);
});

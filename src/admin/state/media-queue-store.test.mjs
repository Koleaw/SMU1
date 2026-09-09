import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryMediaQueueStore, MediaQueueConflictError } from './media-queue-store.mjs';
import { mediaQueueFingerprint, mediaQueueIsDirty } from './media-queue-intent.mjs';

const IDENTITY = Object.freeze({
  repoIdentity: 'smu1-checkout',
  collection: 'projects',
  slug: 'central-square',
  fieldPath: 'gallery'
});
const ABSENT_VERSION = Object.freeze({ expectedRevision: 0, expectedToken: '' });

function versionOf(row) {
  return { expectedRevision: row.queueRevision, expectedToken: row.queueToken };
}

function queue({ alt = '', cancelled = false, items } = {}) {
  return {
    ...IDENTITY,
    batchId: 'batch-cas',
    intentVersion: 2,
    baselineFingerprint: '[{"path":"/assets/images/objects/base.jpg"}]',
    cancelled,
    items: items ?? [{
      clientId: 'cas-photo',
      file: null,
      canonicalPath: '/assets/images/objects/cas.jpg',
      alt,
      roles: ['gallery'],
      existing: true
    }]
  };
}

test('media recovery round-trip preserves one existing image in gallery, cover and hero roles', async () => {
  const store = createMemoryMediaQueueStore({ now: () => Date.parse('2026-09-01T09:00:00Z') });
  const input = {
    ...IDENTITY,
    batchId: 'batch-project-media',
    intentVersion: 2,
    baselineFingerprint: '[{"path":"/assets/images/objects/square.jpg"}]',
    baseQueueRevision: 17,
    baseQueueToken: 'base-token-a3c9',
    conflictForKey: 'smu1-checkout::projects::central-square::gallery',
    conflictOwner: 'tab-owner-7f8d',
    items: [{
      clientId: 'existing-project-photo',
      originalIndex: 3,
      file: null,
      name: 'square.jpg',
      type: 'image/jpeg',
      bytes: 412_000,
      width: 2400,
      height: 1600,
      alt: 'Благоустроенная центральная площадь',
      caption: 'После завершения работ',
      role: 'gallery',
      roles: ['gallery', 'cover', 'hero'],
      originalRoles: ['gallery', 'cover', 'hero'],
      roleChanged: true,
      existing: true,
      status: 'reused',
      error: '',
      canonicalPath: '/assets/images/objects/square.jpg',
      lease: { canonicalPath: '/assets/images/objects/square.jpg', validation: { sanitized: true } },
      duplicateAction: 'replace',
      privateMetadata: { detected: true, kinds: ['gps', 'device-serial'] }
    }]
  };

  await store.put(input);
  input.items[0].roles.splice(0);
  input.items[0].privateMetadata.kinds.push('mutated-after-put');

  const restored = await store.get(IDENTITY);
  assert.equal(restored.updatedAt, '2026-09-01T09:00:00.000Z');
  assert.equal(restored.intentVersion, 2);
  assert.equal(restored.baselineFingerprint, '[{"path":"/assets/images/objects/square.jpg"}]');
  assert.equal(restored.baseQueueRevision, 17);
  assert.equal(restored.baseQueueToken, 'base-token-a3c9');
  assert.equal(restored.conflictForKey, 'smu1-checkout::projects::central-square::gallery');
  assert.equal(restored.conflictOwner, 'tab-owner-7f8d');
  assert.deepEqual(restored.items[0].roles, ['gallery', 'cover', 'hero']);
  assert.deepEqual(restored.items[0].originalRoles, ['gallery', 'cover', 'hero']);
  assert.equal(restored.items[0].role, 'gallery');
  assert.equal(restored.items[0].roleChanged, true);
  assert.equal(restored.items[0].existing, true);
  assert.equal(restored.items[0].duplicateAction, 'replace');
  assert.deepEqual(restored.items[0].privateMetadata, {
    detected: true,
    kinds: ['gps', 'device-serial']
  });

  restored.items[0].roles.pop();
  assert.deepEqual((await store.get(IDENTITY)).items[0].roles, ['gallery', 'cover', 'hero'], 'get() must not expose the stored recovery object by reference');
});

test('legacy single-role queues migrate without inventing public roles', async () => {
  const store = createMemoryMediaQueueStore();
  await store.put({
    ...IDENTITY,
    items: [{
      clientId: 'legacy-excluded-photo',
      file: null,
      role: 'excluded',
      canonicalPath: '/assets/images/objects/raw-only.jpg',
      existing: true
    }]
  });
  const item = (await store.get(IDENTITY)).items[0];
  const legacy = await store.get(IDENTITY);
  assert.equal(legacy.intentVersion, 1);
  assert.equal(legacy.baselineFingerprint, '');
  assert.equal(legacy.baseQueueRevision, 0);
  assert.equal(legacy.baseQueueToken, '');
  assert.equal(legacy.conflictForKey, '');
  assert.equal(legacy.conflictOwner, '');
  assert.deepEqual(item.roles, ['excluded']);
  assert.deepEqual(item.originalRoles, ['excluded']);
  assert.equal(item.existing, true);
  assert.equal(item.roleChanged, false);
  assert.equal(item.duplicateAction, 'reuse');

  await assert.rejects(() => store.put({
    ...IDENTITY,
    items: [{ clientId: 'invalid-role-combination', file: null, roles: ['excluded', 'cover'] }]
  }), /cannot also have a public presentation role/u);
});

test('an empty queue is retained as an explicit removal intent', async () => {
  const store = createMemoryMediaQueueStore();
  await store.put({
    ...IDENTITY,
    batchId: 'batch-remove-all',
    intentVersion: 2,
    baselineFingerprint: '[{"path":"/assets/images/objects/old.jpg"}]',
    items: []
  });
  const restored = await store.get(IDENTITY);
  assert.deepEqual(restored.items, []);
  assert.equal(restored.intentVersion, 2);
  assert.match(restored.baselineFingerprint, /old\.jpg/u);
});

test('a durable cancellation tombstone is distinguishable from an intentional empty queue', async () => {
  const store = createMemoryMediaQueueStore();
  await store.put({
    ...IDENTITY,
    batchId: 'batch-cancelled',
    intentVersion: 2,
    baselineFingerprint: '[{"path":"/assets/images/objects/old.jpg"}]',
    cancelled: true,
    items: []
  });
  const restored = await store.get(IDENTITY);
  assert.equal(restored.cancelled, true);
  assert.deepEqual(restored.items, []);
});

test('a conflict candidate uses an ordinary unique fieldPath key and preserves its owner metadata', async () => {
  const store = createMemoryMediaQueueStore();
  const conflictIdentity = {
    ...IDENTITY,
    fieldPath: `${IDENTITY.fieldPath}::conflict::tab-owner-7f8d`
  };
  const stored = await store.put({
    ...queue({ alt: 'Conflict mine' }),
    ...conflictIdentity,
    baseQueueRevision: 4,
    baseQueueToken: 'base-token-4',
    conflictForKey: store.keyOf(IDENTITY),
    conflictOwner: 'tab-owner-7f8d'
  });
  const restored = await store.get(conflictIdentity);
  assert.equal(stored.key, store.keyOf(conflictIdentity));
  assert.equal(restored.key, store.keyOf(conflictIdentity));
  assert.equal(restored.conflictForKey, store.keyOf(IDENTITY));
  assert.equal(restored.conflictOwner, 'tab-owner-7f8d');
  assert.equal(restored.baseQueueRevision, 4);
  assert.equal(restored.baseQueueToken, 'base-token-4');
  assert.equal(await store.get(IDENTITY), null, 'conflict metadata must not alias the canonical queue key');
});

test('immutable media intent detects remove-all even when the live queue originally aliased the baseline array', () => {
  const baseline = [{
    clientId: 'existing-photo', canonicalPath: '/assets/images/objects/old.jpg',
    alt: 'До изменений', roles: ['gallery'], existing: true
  }];
  const baselineFingerprint = mediaQueueFingerprint(baseline);
  const liveQueue = baseline;
  liveQueue.splice(0, 1);
  assert.equal(mediaQueueIsDirty(liveQueue, baselineFingerprint), true);
  assert.equal(mediaQueueIsDirty([], '[]'), false);
});

test('compare-and-swap lets only one tab create an absent queue', async () => {
  const store = createMemoryMediaQueueStore();
  const results = await Promise.allSettled([
    store.compareAndSwap(queue({ alt: 'Первый таб' }), ABSENT_VERSION),
    store.compareAndSwap(queue({ alt: 'Второй таб' }), ABSENT_VERSION)
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const conflict = results.find((result) => result.status === 'rejected').reason;
  assert.ok(conflict instanceof MediaQueueConflictError);
  assert.equal(conflict.code, 'MEDIA_QUEUE_CONFLICT');
  assert.equal(conflict.expectedRevision, 0);
  assert.equal(conflict.expectedToken, '');
  assert.equal(conflict.actualRevision, 1);
  assert.equal(conflict.actualToken, conflict.current.queueToken);
  assert.ok(conflict.actualToken);
  assert.equal(conflict.current.queueRevision, 1);
  assert.doesNotMatch(conflict.message, /Первый таб|Второй таб|cas\.jpg/u);
  assert.equal((await store.get(IDENTITY)).queueRevision, 1);
});

test('a stale tab cannot overwrite or delete a newer queue revision', async () => {
  const store = createMemoryMediaQueueStore();
  const created = await store.compareAndSwap(queue({ alt: 'Основа' }), ABSENT_VERSION);
  const tabA = await store.get(IDENTITY);
  const tabB = await store.get(IDENTITY);
  assert.equal(created.queueRevision, 1);
  assert.equal(tabA.queueRevision, 1);
  assert.equal(tabB.queueRevision, 1);

  const advanced = await store.compareAndSwap(queue({ alt: 'Изменение A' }), {
    ...versionOf(tabA)
  });
  assert.equal(advanced.queueRevision, 2);

  await assert.rejects(
    store.compareAndSwap(queue({ alt: 'Изменение B' }), versionOf(tabB)),
    (error) => error instanceof MediaQueueConflictError
      && error.expectedRevision === 1
      && error.actualRevision === 2
      && error.expectedToken === tabB.queueToken
      && error.actualToken === advanced.queueToken
      && error.current.items[0].alt === 'Изменение A'
  );
  await assert.rejects(
    store.compareAndDelete(IDENTITY, versionOf(tabB)),
    (error) => error instanceof MediaQueueConflictError && error.actualRevision === 2
  );
  assert.equal((await store.get(IDENTITY)).items[0].alt, 'Изменение A');

  const deleted = await store.compareAndDelete(IDENTITY, versionOf(advanced));
  assert.equal(deleted.queueRevision, 2);
  assert.equal(await store.get(IDENTITY), null);
  assert.equal(await store.compareAndDelete(IDENTITY, ABSENT_VERSION), null);
});

test('a cancellation tombstone advances the same CAS stream as an empty removal intent', async () => {
  const store = createMemoryMediaQueueStore();
  const removal = await store.compareAndSwap(queue({ items: [] }), ABSENT_VERSION);
  assert.equal(removal.queueRevision, 1);
  assert.equal(removal.cancelled, false);
  assert.deepEqual(removal.items, []);

  const tombstone = await store.compareAndSwap(queue({ cancelled: true, items: [] }), {
    ...versionOf(removal)
  });
  assert.equal(tombstone.queueRevision, 2);
  assert.equal(tombstone.cancelled, true);
  await assert.rejects(
    store.compareAndSwap(queue({ alt: 'Устаревшее восстановление' }), versionOf(removal)),
    MediaQueueConflictError
  );
  assert.equal((await store.get(IDENTITY)).cancelled, true);
});

test('legacy rows participate in CAS as revision one', async () => {
  const store = createMemoryMediaQueueStore();
  const legacy = await store.put({ ...queue({ alt: 'Legacy' }), intentVersion: 1 });
  assert.equal(legacy.queueRevision, 1);
  const migrated = await store.compareAndSwap(queue({ alt: 'Migrated' }), versionOf(legacy));
  assert.equal(migrated.queueRevision, 2);
  assert.notEqual(migrated.queueToken, legacy.queueToken);
  assert.equal(migrated.items[0].alt, 'Migrated');
});

test('migration put rotates the opaque token as well as the revision', async () => {
  let token = 0;
  const store = createMemoryMediaQueueStore({ createToken: () => `put-token-${++token}` });
  const first = await store.put(queue({ alt: 'First migration write' }));
  const second = await store.put(queue({ alt: 'Second migration write' }));
  assert.equal(first.queueRevision, 1);
  assert.equal(second.queueRevision, 2);
  assert.notEqual(second.queueToken, first.queueToken);
});

test('queue token prevents revision-one ABA after delete and recreate', async () => {
  let token = 0;
  const store = createMemoryMediaQueueStore({ createToken: () => `opaque-${++token}` });
  const original = await store.compareAndSwap(queue({ alt: 'Original' }), ABSENT_VERSION);
  const staleVersion = versionOf(original);
  await store.compareAndDelete(IDENTITY, staleVersion);

  const recreated = await store.compareAndSwap(queue({ alt: 'Recreated' }), ABSENT_VERSION);
  assert.equal(original.queueRevision, 1);
  assert.equal(recreated.queueRevision, 1);
  assert.notEqual(recreated.queueToken, original.queueToken);

  await assert.rejects(
    store.compareAndSwap(queue({ alt: 'Stale overwrite' }), staleVersion),
    (error) => error instanceof MediaQueueConflictError
      && error.expectedRevision === 1
      && error.actualRevision === 1
      && error.expectedToken === original.queueToken
      && error.actualToken === recreated.queueToken
      && error.current.items[0].alt === 'Recreated'
  );
  await assert.rejects(
    store.compareAndDelete(IDENTITY, staleVersion),
    (error) => error instanceof MediaQueueConflictError
      && error.actualToken === recreated.queueToken
  );
  assert.equal((await store.get(IDENTITY)).items[0].alt, 'Recreated');
});

test('cleanup cannot delete a queue advanced after its listing snapshot', async () => {
  let clock = Date.parse('2026-09-01T09:00:00Z');
  const store = createMemoryMediaQueueStore({ now: () => clock });
  const created = await store.compareAndSwap(queue({ alt: 'Old' }), ABSENT_VERSION);
  clock += 60_000;
  const cleanup = store.cleanup({ olderThanMs: 1_000 });
  const advanced = await store.compareAndSwap(queue({ alt: 'Fresh' }), versionOf(created));
  const deleted = await cleanup;
  assert.equal(deleted, 0);
  assert.equal(advanced.queueRevision, 2);
  assert.equal((await store.get(IDENTITY)).items[0].alt, 'Fresh');
});

test('CAS rejects missing and invalid expected revisions instead of falling back to last-write-wins', async () => {
  const store = createMemoryMediaQueueStore();
  await assert.rejects(store.compareAndSwap(queue()), /expectedRevision/u);
  await assert.rejects(store.compareAndSwap(queue(), { expectedRevision: -1, expectedToken: '' }), /expectedRevision/u);
  await assert.rejects(store.compareAndSwap(queue(), { expectedRevision: 0 }), /expectedToken/u);
  await assert.rejects(store.compareAndDelete(IDENTITY), /expectedRevision/u);
  await assert.rejects(store.compareAndDelete(IDENTITY, { expectedRevision: 0 }), /expectedToken/u);
});

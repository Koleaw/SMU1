import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryMediaQueueStore } from './media-queue-store.mjs';

const IDENTITY = Object.freeze({
  repoIdentity: 'smu1-checkout',
  collection: 'projects',
  slug: 'central-square',
  fieldPath: 'gallery'
});

test('media recovery round-trip preserves one existing image in gallery, cover and hero roles', async () => {
  const store = createMemoryMediaQueueStore({ now: () => Date.parse('2026-09-01T09:00:00Z') });
  const input = {
    ...IDENTITY,
    batchId: 'batch-project-media',
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

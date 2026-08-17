import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDraftStore } from './draft-store.mjs';

test('draft identity includes repository, record, base revision and schema contract', async () => {
  let now = Date.parse('2026-08-13T00:00:00Z');
  const store = createMemoryDraftStore({ now: () => now });
  const input = {
    repoIdentity: 'smu1', collection: 'products', slug: 'bench',
    baseRevision: 'sha256:base', schemaVersion: 'h6-content-v1', content: { title: 'Скамья' }
  };
  const saved = await store.put(input);
  input.content.title = 'mutated outside';
  assert.equal(saved.updatedAt, '2026-08-13T00:00:00.000Z');
  assert.equal((await store.get(saved)).content.title, 'Скамья');
  now += 1_000;
  await store.put({ ...saved, content: { title: 'Новая версия' } });
  assert.equal((await store.list('smu1'))[0].content.title, 'Новая версия');
  await store.delete(saved);
  assert.equal(await store.get(saved), null);
});

test('draft store rejects incomplete identity, cycles and binary-like content', async () => {
  const store = createMemoryDraftStore();
  await assert.rejects(() => store.put({ repoIdentity: 'smu1', collection: 'products', content: {} }), /identity/u);
  const content = {};
  content.self = content;
  await assert.rejects(() => store.put({ repoIdentity: 'smu1', collection: 'products', slug: 'x', content }), /Circular/u);
  if (typeof Blob !== 'undefined') {
    await assert.rejects(() => store.put({ repoIdentity: 'smu1', collection: 'products', slug: 'x', content: { file: new Blob(['x']) } }), /Blob/u);
  }
});

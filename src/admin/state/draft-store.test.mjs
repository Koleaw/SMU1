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
    await assert.rejects(() => store.put({ repoIdentity: 'smu1', collection: 'products', slug: 'x', content: {}, stagedMedia: [new Blob(['large binary must stay in the media queue'])] }), /Blob/u);
  }
});

test('draft cleanup is bounded per repository, age-aware and preserves active recovery keys', async () => {
  const start = Date.parse('2026-08-13T00:00:00Z');
  let now = start;
  const store = createMemoryDraftStore({ now: () => now });
  const identity = (slug, repoIdentity = 'smu1') => ({ repoIdentity, collection: 'products', slug });
  const putAt = async (slug, offset, repoIdentity = 'smu1') => {
    now = start + offset;
    await store.put({ ...identity(slug, repoIdentity), content: { title: slug } });
  };

  await putAt('old-preserved', 0);
  await putAt('expired', 1_000);
  await putAt('over-limit', 2_000);
  await putAt('recent', 2_500);
  await putAt('newest', 3_000);
  await putAt('other-repository', 0, 'other');
  now = start + 4_000;

  const report = await store.cleanup({
    repoIdentity: 'smu1',
    keep: 2,
    olderThanMs: 2_500,
    preserveKeys: [identity('old-preserved')]
  });

  assert.deepEqual(report, {
    removed: 2,
    retained: 3,
    expired: 1,
    overLimit: 1,
    removedKeys: [
      'smu1::products::over-limit',
      'smu1::products::expired'
    ]
  });
  assert.deepEqual((await store.list('smu1')).map((draft) => draft.slug), ['newest', 'recent', 'old-preserved']);
  assert.equal((await store.get(identity('old-preserved'))).content.title, 'old-preserved');
  assert.equal((await store.get(identity('other-repository', 'other'))).content.title, 'other-repository');
  assert.equal((await store.cleanup({ repoIdentity: 'smu1', keep: 2, olderThanMs: 2_500 })).removed, 1, 'an unpreserved expired draft is removed on the next cleanup');
});

test('draft cleanup validates retention policy before deleting recovery data', async () => {
  const store = createMemoryDraftStore();
  await assert.rejects(() => store.cleanup({ keep: -1 }), /retention count/u);
  await assert.rejects(() => store.cleanup({ olderThanMs: Number.POSITIVE_INFINITY }), /retention age/u);
  await assert.rejects(() => store.cleanup({ preserveKeys: 'not-an-array' }), /preserveKeys/u);
});

test('default draft retention keeps at most 160 recent recoveries and expires records after 90 days', async () => {
  const start = Date.parse('2026-01-01T00:00:00Z');
  let now = start;
  const boundedStore = createMemoryDraftStore({ now: () => now });
  for (let index = 0; index < 162; index += 1) {
    now = start + index;
    await boundedStore.put({ repoIdentity: 'smu1', collection: 'products', slug: `draft-${index}`, content: { index } });
  }
  const boundedReport = await boundedStore.cleanup({ repoIdentity: 'smu1' });
  assert.equal(boundedReport.removed, 2);
  assert.equal(boundedReport.overLimit, 2);
  assert.equal((await boundedStore.list('smu1')).length, 160);

  const ageStore = createMemoryDraftStore({ now: () => now });
  now = start;
  await ageStore.put({ repoIdentity: 'smu1', collection: 'products', slug: 'old', content: {} });
  now = start + 90 * 24 * 60 * 60 * 1000 + 1;
  const ageReport = await ageStore.cleanup({ repoIdentity: 'smu1' });
  assert.equal(ageReport.removed, 1);
  assert.equal(ageReport.expired, 1);
});

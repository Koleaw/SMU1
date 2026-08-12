import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createContentTransactionService } from './transaction-service.mjs';
import { revisionForBytes } from './transaction-engine.mjs';

const SOURCE_ROOT = process.cwd();

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-content-transactions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src', 'data'), { recursive: true });
  await fs.cp(path.join(SOURCE_ROOT, 'src', 'content'), path.join(root, 'src', 'content'), { recursive: true });
  await Promise.all(['navigation.json', 'yandex.json'].map((name) => (
    fs.copyFile(path.join(SOURCE_ROOT, 'src', 'data', name), path.join(root, 'src', 'data', name))
  )));
  const collection = (name, options = {}) => ({
    type: options.type || 'directory',
    path: path.join(root, 'src', 'content', name),
    ...(options.slug ? { slug: options.slug } : {})
  });
  const createService = (extra = {}) => createContentTransactionService({
    repoRoot: root,
    runtimeDir: path.join(root, '.runtime'),
    collections: {
      'product-sections': collection('product-sections'),
      'product-categories': collection('product-categories'),
      products: collection('products'),
      services: collection('services'),
      projects: collection('projects'),
      jobs: collection('jobs'),
      'site-settings': {
        type: 'single-file',
        slug: 'global',
        path: path.join(root, 'src', 'content', 'site-settings', 'global.json')
      },
      'static-pages': collection('static-pages')
    },
    singletons: {
      navigation: { path: path.join(root, 'src', 'data', 'navigation.json') },
      yandex: { path: path.join(root, 'src', 'data', 'yandex.json') }
    },
    ...extra
  });
  const service = createService();
  await service.initialize();
  return { root, service, createService };
}

function context(suffix) {
  return {
    owner: 'editor',
    sessionFingerprint: 'session-a',
    recoveryClientId: 'browser-a',
    idempotencyKey: `test-${suffix}`
  };
}

test('typed multi-record preview has exact diff and apply writes through one journal', async (t) => {
  const { service } = await fixture(t);
  const first = await service.readRecord({ collection: 'products', slug: 'besedka-kofe' });
  const second = await service.readRecord({ collection: 'products', slug: 'besedka-kub' });
  const preview = await service.preview({
    ...context('multi'),
    metadata: { userSummary: 'Два товара' },
    operations: [
      { type: 'upsert-record', collection: 'products', slug: first.slug, baseRevision: first.revision, content: { ...first.content, title: `${first.content.title} A` } },
      { type: 'upsert-record', collection: 'products', slug: second.slug, baseRevision: second.revision, content: { ...second.content, title: `${second.content.title} B` } }
    ]
  });
  assert.equal(preview.state, 'prepared');
  assert.equal(preview.diff.length, 2);
  assert.ok(preview.diff.every((item) => item.beforeBytesBase64 && item.afterBytesBase64));
  const applied = await service.apply({ ...context('multi'), transactionId: preview.transactionId, payloadHash: preview.payloadHash });
  assert.equal(applied.state, 'committed');
  assert.match((await service.readRecord({ collection: 'products', slug: first.slug })).content.title, / A$/);
  assert.equal((await service.listHistory(context('history'))).length, 1);
});

test('rename cascades a category slug into products and removes the physical alias', async (t) => {
  const { root, service } = await fixture(t);
  const category = await service.readRecord({ collection: 'product-categories', slug: 'besedki-i-pergoly' });
  const preview = await service.preview({
    ...context('rename'),
    operations: [{
      type: 'rename-record',
      collection: 'product-categories',
      slug: category.slug,
      nextSlug: 'besedki-i-pergoly-new',
      baseRevision: category.revision
    }]
  });
  assert.equal(preview.state, 'prepared');
  assert.ok(preview.diff.some((item) => item.action === 'delete'));
  assert.ok(preview.diff.some((item) => item.action === 'create'));
  await service.apply({ ...context('rename'), transactionId: preview.transactionId });
  await assert.rejects(fs.access(path.join(root, 'src', 'content', 'product-categories', 'besedki-i-pergoly.json')));
  const product = await service.readRecord({ collection: 'products', slug: 'besedka-kofe' });
  assert.equal(product.content.productCategorySlug, 'besedki-i-pergoly-new');
});

test('hard delete is blocked without a relation plan and archive is atomic', async (t) => {
  const { service } = await fixture(t);
  const product = await service.readRecord({ collection: 'products', slug: 'besedka-kofe' });
  const blocked = await service.preview({
    ...context('blocked-delete'),
    operations: [{ type: 'delete-record', collection: 'products', slug: product.slug, baseRevision: product.revision }]
  });
  assert.equal(blocked.state, 'blocked');
  assert.ok(blocked.blockers.some((item) => item.code === 'RELATION_PLAN_REQUIRED'));

  const archived = await service.preview({
    ...context('archive'),
    operations: [{ type: 'archive-record', collection: 'products', slug: product.slug, baseRevision: product.revision }]
  });
  assert.equal(archived.state, 'prepared');
  await service.apply({ ...context('archive'), transactionId: archived.transactionId });
  assert.equal((await service.readRecord({ collection: 'products', slug: product.slug })).content.isActive, false);
});

test('hard delete can be restored from exact backup through a normal preview/apply', async (t) => {
  const { root, service } = await fixture(t);
  const record = await service.readRecord({ collection: 'jobs', slug: 'svarshchik-metallokonstruktsiy' });
  const originalPath = path.join(root, 'src', 'content', 'jobs', 'svarshchik.json');
  const original = await fs.readFile(originalPath);
  const preview = await service.preview({
    ...context('delete'),
    operations: [{
      type: 'delete-record', collection: 'jobs', slug: record.slug, baseRevision: record.revision,
      relationPlan: { strategy: 'hard-delete' }
    }]
  });
  assert.equal(preview.state, 'prepared');
  await service.apply({ ...context('delete'), transactionId: preview.transactionId });
  const restore = await service.previewRestore({
    ...context('restore'),
    sourceTransactionId: preview.transactionId
  });
  assert.equal(restore.state, 'prepared');
  await service.apply({ ...context('restore'), transactionId: restore.transactionId });
  const restored = await fs.readFile(originalPath);
  assert.equal(revisionForBytes(restored), revisionForBytes(original));
  assert.deepEqual(restored, original);
});

test('full read set rejects unrelated drift and semantic blockers never write', async (t) => {
  const { root, service } = await fixture(t);
  const record = await service.readRecord({ collection: 'products', slug: 'besedka-kofe' });
  const preview = await service.preview({
    ...context('drift'),
    operations: [{ type: 'upsert-record', collection: 'products', slug: record.slug, baseRevision: record.revision, content: { ...record.content, title: 'Новый заголовок' } }]
  });
  const unrelatedPath = path.join(root, 'src', 'content', 'products', 'besedka-kub.json');
  await fs.appendFile(unrelatedPath, ' ');
  await assert.rejects(
    service.apply({ ...context('drift'), transactionId: preview.transactionId }),
    (error) => error.code === 'TRANSACTION_REVISION_CONFLICT'
  );
  assert.notEqual((await service.readRecord({ collection: 'products', slug: record.slug })).content.title, 'Новый заголовок');

  const invalid = await service.preview({
    ...context('invalid'),
    operations: [{ type: 'upsert-record', collection: 'products', slug: record.slug, baseRevision: record.revision, content: { ...record.content, image: 'data:text/plain,bad' } }]
  });
  assert.equal(invalid.state, 'blocked');
  assert.equal(invalid.transactionId, null);
});

test('staged media promotion derives a canonical destination and is exactly restorable', async (t) => {
  const { root, service: disabledService, createService } = await fixture(t);
  const stagedDir = path.join(root, '.staging-adapter', 'blobs');
  const bytes = Buffer.from('staged-webp-test-bytes');
  const stagedId = crypto.createHash('sha256').update(bytes).digest('hex');
  const stagedPath = path.join(stagedDir, `${stagedId}.webp`);
  await fs.mkdir(stagedDir, { recursive: true });
  await fs.writeFile(stagedPath, bytes);
  const operation = {
    type: 'promote-staged-media',
    stagedId,
    baseRevision: revisionForBytes(bytes),
    destinationBaseRevision: 'missing'
  };
  await assert.rejects(
    disabledService.preview({ ...context('disabled-promote'), operations: [operation] }),
    (error) => error.code === 'STAGED_MEDIA_ADAPTER_REQUIRED'
  );

  const service = createService({
    runtimeDir: path.join(root, '.runtime-adapter'),
    stagingAdapter: {
      async resolveForPromotion({ stagedId: requestedId }) {
        assert.equal(requestedId, stagedId);
        return {
          bytes,
          sourcePath: path.relative(root, stagedPath),
          publicPath: `/uploads/${stagedId}.webp`
        };
      }
    }
  });
  await service.initialize();
  const preview = await service.preview({
    ...context('promote'),
    operations: [operation]
  });
  assert.equal(preview.state, 'prepared');
  assert.deepEqual(preview.metadata.stagingpaths, [path.relative(root, stagedPath).split(path.sep).join('/')]);
  assert.ok(preview.paths.includes(preview.metadata.stagingpaths[0]));
  assert.deepEqual(
    (await service.getTransaction({ ...context('promote'), transactionId: preview.transactionId })).metadata.stagingpaths,
    preview.metadata.stagingpaths
  );
  const publicPath = preview.metadata.mediaPromotions[0].publicPath;
  assert.match(publicPath, /^\/uploads\/[a-f0-9]{64}\.webp$/);
  await service.apply({ ...context('promote'), transactionId: preview.transactionId });
  await assert.rejects(fs.access(stagedPath));
  const destination = path.join(root, 'public', ...publicPath.split('/').filter(Boolean));
  assert.deepEqual(await fs.readFile(destination), bytes);

  const restore = await service.previewRestore({
    ...context('promote-restore'),
    sourceTransactionId: preview.transactionId
  });
  await service.apply({ ...context('promote-restore'), transactionId: restore.transactionId });
  assert.deepEqual(await fs.readFile(stagedPath), bytes);
  await assert.rejects(fs.access(destination));
});

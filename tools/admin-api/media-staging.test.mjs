import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  createMediaStagingService
} from './media-staging.mjs';

async function temporaryRoot(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-media-staging-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function jpeg(colour = { r: 20, g: 80, b: 160 }) {
  return sharp({ create: { width: 3, height: 2, channels: 3, background: colour } }).jpeg().toBuffer();
}

function stageInput(buffer, overrides = {}) {
  return {
    batchId: 'batch-test-001',
    ownerId: 'recovery-owner-001',
    clientId: 'client-item-001',
    originalIndex: 0,
    filename: 'Фото объекта.jpg',
    declaredMime: 'image/jpeg',
    buffer,
    ...overrides
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

test('staging is content-addressed, task-scoped and idempotent by batch/client', async (t) => {
  const root = await temporaryRoot(t);
  const service = createMediaStagingService({ stagingRoot: root });
  const bytes = await jpeg();
  const first = await service.stage(stageInput(bytes));
  assert.equal(first.idempotent, false);
  assert.equal(first.reused, false);
  assert.match(first.stagedId, /^[a-f0-9]{64}$/u);
  assert.equal(first.canonicalPath, `/uploads/${first.stagedId}.jpg`);
  assert.equal(first.originalFilename, 'Фото объекта.jpg');

  const repeated = await service.stage(stageInput(bytes, { filename: 'Другое имя.jpeg' }));
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.stagedId, first.stagedId);

  const shared = await service.stage(stageInput(bytes, {
    batchId: 'batch-test-002',
    clientId: 'client-item-002',
    filename: 'копия.jpg'
  }));
  assert.equal(shared.reused, true);
  assert.equal(shared.stagedId, first.stagedId);
  assert.deepEqual(await service.usage(), {
    bytes: bytes.length,
    blobs: 1,
    maxTotalBytes: 256 * 1024 * 1024,
    remainingBytes: (256 * 1024 * 1024) - bytes.length
  });

  const batch = await service.listBatch({ batchId: 'batch-test-001', ownerId: 'recovery-owner-001' });
  assert.equal(batch.length, 1);
  assert.equal(batch[0].clientId, 'client-item-001');
  assert.equal(JSON.stringify(batch).includes(root), false, 'Filesystem staging paths are never exposed.');
});

test('public media preparation has a server-side concurrency ceiling', async (t) => {
  const root = await temporaryRoot(t);
  let active = 0;
  let peak = 0;
  const service = createMediaStagingService({
    stagingRoot: root,
    maxConcurrentPrepares: 2,
    preparer: async ({ buffer, filename }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      const sha256 = (await import('node:crypto')).createHash('sha256').update(buffer).digest('hex');
      return {
        buffer,
        validation: {
          kind: 'raster', format: 'jpeg', extension: '.jpg', mime: 'image/jpeg',
          originalFilename: filename, bytes: buffer.length, sha256,
          width: 1, height: 1, pixels: 1, pages: 1, orientation: null,
          hasAlpha: false, privateMetadata: { detected: false }
        }
      };
    }
  });
  const uploads = Array.from({ length: 6 }, (_, index) => service.stage(stageInput(
    Buffer.from([0xff, 0xd8, 0xff, index + 1]),
    { clientId: `client-item-00${index + 1}`, originalIndex: index }
  )));
  await Promise.all(uploads);
  assert.equal(peak, 2);
  assert.equal((await service.listBatch({ batchId: 'batch-test-001', ownerId: 'recovery-owner-001' })).length, 6);
});

test('staging rejects a non-raster result even when an injected preparer accepts it', async (t) => {
  const root = await temporaryRoot(t);
  const bytes = Buffer.from('validated-video-fixture');
  const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  const service = createMediaStagingService({
    stagingRoot: root,
    preparer: async () => ({
      buffer: bytes,
      validation: {
        kind: 'video', format: 'mp4', extension: '.mp4', mime: 'video/mp4',
        originalFilename: 'hero.mp4', bytes: bytes.length, sha256
      }
    })
  });
  await rejectsCode(service.stage(stageInput(bytes, {
    filename: 'hero.mp4', declaredMime: 'video/mp4'
  })), 'MEDIA_UPLOAD_RASTER_ONLY');
  assert.deepEqual(await service.usage(), {
    bytes: 0,
    blobs: 0,
    maxTotalBytes: 256 * 1024 * 1024,
    remainingBytes: 256 * 1024 * 1024
  });
});

test('same user filename with different bytes produces different staged IDs', async (t) => {
  const root = await temporaryRoot(t);
  const service = createMediaStagingService({ stagingRoot: root });
  const first = await service.stage(stageInput(await jpeg({ r: 255, g: 0, b: 0 })));
  const second = await service.stage(stageInput(await jpeg({ r: 0, g: 255, b: 0 }), {
    clientId: 'client-item-002'
  }));
  assert.notEqual(first.stagedId, second.stagedId);
  assert.equal((await service.usage()).blobs, 2);
});

test('client ID reuse with different bytes is a conflict, never an overwrite', async (t) => {
  const root = await temporaryRoot(t);
  const service = createMediaStagingService({ stagingRoot: root });
  const firstBytes = await jpeg({ r: 255, g: 0, b: 0 });
  const secondBytes = await jpeg({ r: 0, g: 0, b: 255 });
  const first = await service.stage(stageInput(firstBytes));
  await rejectsCode(service.stage(stageInput(secondBytes)), 'STAGING_CLIENT_ID_CONFLICT');
  const status = await service.status(stageInput(Buffer.alloc(0)));
  assert.equal(status.stagedId, first.stagedId);
  assert.equal((await service.usage()).blobs, 1);
});

test('traversal identifiers and unsafe display filenames are rejected before filesystem writes', async (t) => {
  const root = await temporaryRoot(t);
  const service = createMediaStagingService({ stagingRoot: root });
  const bytes = await jpeg();
  await rejectsCode(service.stage(stageInput(bytes, { batchId: '../escape' })), 'STAGING_ID_INVALID');
  await rejectsCode(service.stage(stageInput(bytes, { ownerId: '..\\outside' })), 'STAGING_ID_INVALID');
  await rejectsCode(service.stage(stageInput(bytes, { clientId: 'item/path' })), 'STAGING_ID_INVALID');
  await rejectsCode(service.stage(stageInput(bytes, { filename: '..\\outside.jpg' })), 'FILENAME_UNSAFE');
  assert.deepEqual(await fs.readdir(root), []);
});

test('shared blob uses leases: cancelling one batch cannot delete another batch blob', async (t) => {
  const root = await temporaryRoot(t);
  await fs.writeFile(path.join(root, 'unrelated-sentinel.txt'), 'keep');
  const service = createMediaStagingService({ stagingRoot: root });
  const bytes = await jpeg();
  await service.stage(stageInput(bytes));
  await service.stage(stageInput(bytes, {
    batchId: 'batch-test-002',
    clientId: 'client-item-002'
  }));

  const firstCancel = await service.cancel({
    batchId: 'batch-test-001',
    ownerId: 'recovery-owner-001',
    clientId: 'client-item-001'
  });
  assert.equal(firstCancel.cancelled, true);
  assert.equal(firstCancel.removedBlob, false);
  assert.equal((await service.usage()).blobs, 1);
  assert.equal((await service.get({
    batchId: 'batch-test-002',
    ownerId: 'recovery-owner-001',
    clientId: 'client-item-002'
  })).stagedId, firstCancel.stagedId);

  const secondCancel = await service.cancel({
    batchId: 'batch-test-002',
    ownerId: 'recovery-owner-001',
    clientId: 'client-item-002'
  });
  assert.equal(secondCancel.removedBlob, true);
  assert.equal((await service.usage()).blobs, 0);
  assert.equal(await fs.readFile(path.join(root, 'unrelated-sentinel.txt'), 'utf8'), 'keep');
});

test('promoted blobs resist cancel but are cleaned after bounded recovery retention', async (t) => {
  const root = await temporaryRoot(t);
  let clock = 10_000;
  const service = createMediaStagingService({ stagingRoot: root, ttlMs: 1_000, promotedRetentionMs: 5_000, now: () => clock });
  const staged = await service.stage(stageInput(await jpeg()));
  const verified = await service.verifyForPromotion({
    batchId: staged.batchId,
    ownerId: 'recovery-owner-001',
    clientId: staged.clientId
  });
  assert.equal(verified.verified, true);
  const promoted = await service.markPromoted({
    batchId: staged.batchId,
    ownerId: 'recovery-owner-001',
    clientId: staged.clientId,
    canonicalPath: staged.canonicalPath
  });
  assert.equal(promoted.promoted, true);

  const cancel = await service.cancel({
    batchId: staged.batchId,
    ownerId: 'recovery-owner-001',
    clientId: staged.clientId
  });
  assert.deepEqual(cancel, {
    cancelled: false,
    reason: 'promoted',
    stagedId: staged.stagedId,
    removedBlob: false
  });
  clock += 4_999;
  assert.deepEqual(await service.cleanupExpired(), { at: clock, removedLeases: 0, removedBlobs: 0 });
  assert.equal((await service.usage()).blobs, 1);
  assert.equal((await service.get({
    batchId: staged.batchId,
    ownerId: 'recovery-owner-001',
    clientId: staged.clientId
  })).promoted, true);
  clock += 1;
  assert.deepEqual(await service.cleanupExpired(), { at: clock, removedLeases: 1, removedBlobs: 1 });
  assert.equal((await service.usage()).blobs, 0);
});

test('promotion rechecks immutable staged bytes and rejects post-validation tampering', async (t) => {
  const root = await temporaryRoot(t);
  const service = createMediaStagingService({ stagingRoot: root });
  const staged = await service.stage(stageInput(await jpeg()));
  const [blobName] = await fs.readdir(path.join(root, 'blobs'));
  const blobPath = path.join(root, 'blobs', blobName);
  const changed = Buffer.from(await fs.readFile(blobPath));
  changed[changed.length - 1] ^= 0xff;
  await fs.writeFile(blobPath, changed);
  await rejectsCode(service.verifyForPromotion({
    batchId: staged.batchId,
    ownerId: 'recovery-owner-001',
    clientId: staged.clientId
  }), 'STAGING_BLOB_CHANGED');
  await rejectsCode(service.markPromoted({
    batchId: staged.batchId,
    ownerId: 'recovery-owner-001',
    clientId: staged.clientId
  }), 'STAGING_BLOB_CHANGED');
});

test('promotion resolver returns the exact verified bytes without exposing them in ordinary status', async (t) => {
  const root = await temporaryRoot(t);
  const service = createMediaStagingService({ stagingRoot: root });
  const bytes = await jpeg();
  const staged = await service.stage(stageInput(bytes));
  const resolved = await service.resolveForPromotion({
    batchId: staged.batchId,
    ownerId: 'recovery-owner-001',
    clientId: staged.clientId,
    leaseId: staged.leaseId
  });
  assert.ok(Buffer.isBuffer(resolved.bytes));
  assert.deepEqual(resolved.bytes, await fs.readFile(resolved.filePath));
  assert.notDeepEqual(resolved.bytes, bytes, 'public staging stores sanitized canonical bytes, not the untouched upload');
  assert.equal(resolved.validation.metadataSanitized, true);
  assert.equal(resolved.validation.sourceBytes, bytes.length);
  const publicMetadata = await sharp(resolved.bytes).metadata();
  assert.equal(publicMetadata.exif, undefined);
  assert.equal(publicMetadata.xmp, undefined);
  assert.equal(path.dirname(resolved.filePath), path.join(root, 'blobs'));
  assert.equal(Object.hasOwn(await service.get({
    batchId: staged.batchId,
    ownerId: 'recovery-owner-001',
    clientId: staged.clientId
  }), 'bytes'), false);
});

test('TTL cleanup removes only expired unpromoted leases; explicit renewal extends recovery', async (t) => {
  const root = await temporaryRoot(t);
  let clock = 1_000;
  const service = createMediaStagingService({ stagingRoot: root, ttlMs: 1_000, now: () => clock });
  const bytes = await jpeg();
  await service.stage(stageInput(bytes, { batchId: 'batch-expire-001' }));
  await service.stage(stageInput(bytes, {
    batchId: 'batch-renew-001',
    clientId: 'client-renew-001'
  }));

  clock = 1_800;
  const renewed = await service.renewBatch({
    batchId: 'batch-renew-001',
    ownerId: 'recovery-owner-001',
    ttlMs: 2_000
  });
  assert.equal(renewed.renewed, 1);
  clock = 2_100;
  const cleanup = await service.cleanupExpired();
  assert.equal(cleanup.removedLeases, 1);
  assert.equal(cleanup.removedBlobs, 0, 'Renewed lease still owns the shared blob.');
  assert.equal((await service.listBatch({ batchId: 'batch-renew-001', ownerId: 'recovery-owner-001' })).length, 1);

  clock = 4_000;
  const finalCleanup = await service.cleanupExpired();
  assert.equal(finalCleanup.removedLeases, 1);
  assert.equal(finalCleanup.removedBlobs, 1);
  assert.equal((await service.usage()).blobs, 0);
});

test('owned crash-temporary files are removed without touching unrelated runtime data', async (t) => {
  const root = await temporaryRoot(t);
  const service = createMediaStagingService({ stagingRoot: root });
  await service.init();
  const batchDirectory = path.join(root, 'batches', 'batch-crash-001');
  await fs.mkdir(batchDirectory, { recursive: true });
  const temporaryName = '.smu1-999-aaaaaaaaaaaaaaaaaaaaaaaa.tmp';
  const temporaryPaths = [
    path.join(root, 'blobs', temporaryName),
    path.join(root, 'blob-meta', temporaryName),
    path.join(batchDirectory, temporaryName)
  ];
  await Promise.all(temporaryPaths.map((filePath, index) => fs.writeFile(filePath, Buffer.alloc(index + 3, index))));
  const sentinel = path.join(root, 'unrelated-sentinel.txt');
  await fs.writeFile(sentinel, 'keep');
  assert.equal((await service.usage()).bytes, 3, 'orphan temporary bytes are visible to the budget before cleanup');
  const cleanup = await service.cleanupExpired({ removeTemporary: true });
  assert.equal(cleanup.removedTemporaryFiles, 3);
  assert.equal(cleanup.removedTemporaryBytes, 12);
  await Promise.all(temporaryPaths.map((filePath) => assert.rejects(fs.access(filePath), { code: 'ENOENT' })));
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');

  const nextTemporary = path.join(root, 'blobs', temporaryName);
  await fs.writeFile(nextTemporary, Buffer.alloc(5));
  await service.stage(stageInput(await jpeg(), { batchId: 'batch-after-crash-001' }));
  await assert.rejects(fs.access(nextTemporary), { code: 'ENOENT' });
});

test('aggregate byte and per-batch item budgets fail closed without deleting existing data', async (t) => {
  const root = await temporaryRoot(t);
  const firstBytes = await jpeg({ r: 255, g: 0, b: 0 });
  const secondBytes = await jpeg({ r: 0, g: 255, b: 0 });
  const service = createMediaStagingService({
    stagingRoot: root,
    maxTotalBytes: firstBytes.length,
    maxBatchItems: 1
  });
  const first = await service.stage(stageInput(firstBytes));
  await rejectsCode(service.stage(stageInput(firstBytes, { clientId: 'client-item-002' })), 'STAGING_BATCH_LIMIT');
  await rejectsCode(service.stage(stageInput(secondBytes, {
    batchId: 'batch-test-002',
    clientId: 'client-item-003'
  })), 'STAGING_BUDGET_EXCEEDED');
  assert.equal((await service.get({
    batchId: first.batchId,
    ownerId: 'recovery-owner-001',
    clientId: first.clientId
  })).stagedId, first.stagedId);
  assert.deepEqual((await service.usage()).blobs, 1);
});

test('staging refuses a symlink/junction component and never follows it', async (t) => {
  const root = await temporaryRoot(t);
  const outside = await temporaryRoot(t);
  const linkPath = path.join(root, 'blobs');
  try {
    await fs.symlink(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
      t.skip(`Symlink creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const service = createMediaStagingService({ stagingRoot: root });
  await rejectsCode(service.init(), 'STAGING_SYMLINK_FORBIDDEN');
  assert.deepEqual(await fs.readdir(outside), []);
});

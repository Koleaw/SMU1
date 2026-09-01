import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBackupService } from './backup-service.mjs';

const OWNER = Object.freeze({ owner: 'pavel', recoveryClientId: 'backup-browser', sessionFingerprint: 'session-backup' });

async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-backup-service-'));
  const repoRoot = path.join(base, 'repo');
  const backupRoot = path.join(base, 'external-backups');
  await Promise.all([
    fs.mkdir(path.join(repoRoot, 'src', 'content', 'products'), { recursive: true }),
    fs.mkdir(path.join(repoRoot, 'src', 'data'), { recursive: true }),
    fs.mkdir(path.join(repoRoot, 'public', 'uploads'), { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(path.join(repoRoot, 'src', 'content', 'products', 'bench.json'), '{"slug":"bench","title":"Лавка"}\n'),
    fs.writeFile(path.join(repoRoot, 'src', 'data', 'navigation.json'), '[{"label":"Главная","href":"/"}]\n'),
    fs.writeFile(path.join(repoRoot, 'public', 'uploads', 'bench.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  ]);
  const transactionService = { async withStableRead(callback) { return callback(); } };
  let uuidIndex = 0;
  const uuids = [
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000003',
    '40000000-0000-0000-0000-000000000004',
    '50000000-0000-0000-0000-000000000005',
    '60000000-0000-0000-0000-000000000006'
  ];
  let clock = Date.parse('2026-09-01T10:00:00.000Z');
  const service = createBackupService({
    repoRoot,
    backupRoot,
    runtimeDir: path.join(repoRoot, '.admin-runtime', 'backup'),
    transactionService,
    retention: options.retention || 3,
    maxBytes: options.maxBytes || 16 * 1024 * 1024,
    minFreeBytes: 0,
    now: () => new Date(clock += 1000),
    randomUUID: () => uuids[uuidIndex++]
  });
  await service.initialize();
  t.after(async () => {
    await service.close();
    await fs.rm(base, { recursive: true, force: true });
  });
  return { service, repoRoot, backupRoot };
}

test('automatic backup is non-blocking, checksummed, deduplicated and retained separately', async (t) => {
  const fx = await fixture(t, { retention: 2 });
  const queued = fx.service.scheduleAfterSave({ transactionId: 'tx-one' });
  assert.deepEqual(queued, { queued: true, transactionId: 'tx-one' });
  assert.equal((await fx.service.status()).pending, 1);
  await fx.service.waitForIdle();
  const firstStatus = await fx.service.status();
  assert.equal(firstStatus.lastAttempt.status, 'success');
  assert.equal(firstStatus.lastSuccess.transactionId, 'tx-one');
  const first = (await fx.service.list()).backups[0];
  assert.equal((await fx.service.verify({ snapshotId: first.snapshotId })).ok, true);

  await fs.writeFile(path.join(fx.repoRoot, 'src', 'content', 'products', 'bench.json'), '{"slug":"bench","title":"Новая лавка"}\n');
  fx.service.scheduleAfterSave({ transactionId: 'tx-two' });
  await fx.service.waitForIdle();
  const second = (await fx.service.list()).backups[0];
  const secondManifest = JSON.parse(await fs.readFile(path.join(fx.backupRoot, 'snapshots', second.snapshotId, 'manifest.json'), 'utf8'));
  assert.ok(secondManifest.addedBlobBytes > 0);
  assert.ok(secondManifest.addedBlobBytes < secondManifest.totalBytes, 'unchanged navigation/media blobs are reused');

  fx.service.scheduleAfterSave({ transactionId: 'tx-three' });
  await fx.service.waitForIdle();
  assert.equal((await fx.service.list()).backups.length, 2, 'retention removes the oldest manifest');
  assert.equal((await fx.service.verify({ snapshotId: second.snapshotId })).ok, true);
});

test('portable full export contains content, settings, media and a verifiable manifest', async (t) => {
  const fx = await fixture(t);
  const snapshot = await fx.service.createSnapshot({ transactionId: 'tx-export', backupKind: 'manual' });
  const exported = await fx.service.exportPortable({ snapshotId: snapshot.snapshotId });
  assert.equal(exported.manifestSha256, snapshot.manifestSha256);
  assert.equal(await fs.readFile(path.join(exported.exportPath, 'files', 'src', 'content', 'products', 'bench.json'), 'utf8'), '{"slug":"bench","title":"Лавка"}\n');
  assert.deepEqual(
    await fs.readFile(path.join(exported.exportPath, 'files', 'public', 'uploads', 'bench.jpg')),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  );
  const marker = JSON.parse(await fs.readFile(path.join(exported.exportPath, 'RESTORE.json'), 'utf8'));
  assert.equal(marker.kind, 'smu1-portable-backup');

  const exportedProduct = path.join(exported.exportPath, 'files', 'src', 'content', 'products', 'bench.json');
  await fs.writeFile(exportedProduct, '{"slug":"bench","title":"Изменённая экспортная копия"}\n');
  assert.equal(
    (await fx.service.verify({ snapshotId: snapshot.snapshotId })).ok,
    true,
    'editing a portable export must never mutate the content-addressed backup blob'
  );
});

test('backup rejects a managed source root replaced by a symlink or junction', async (t) => {
  const fx = await fixture(t);
  const uploadsRoot = path.join(fx.repoRoot, 'public', 'uploads');
  const outside = path.join(path.dirname(fx.repoRoot), 'outside-uploads');
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, 'private.jpg'), Buffer.from([1, 2, 3]));
  await fs.rm(uploadsRoot, { recursive: true, force: true });
  try {
    await fs.symlink(outside, uploadsRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`filesystem cannot create a test symlink/junction: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    fx.service.createSnapshot({ transactionId: 'tx-source-link' }),
    (error) => error?.code === 'BACKUP_SOURCE_LINK_FORBIDDEN' || error?.code === 'BACKUP_SOURCE_ESCAPE'
  );
});

test('restore requires dry-run, detects conflicts and applies all files as a new atomic transaction', async (t) => {
  const fx = await fixture(t);
  const original = await fx.service.createSnapshot({ transactionId: 'tx-original' });
  const productPath = path.join(fx.repoRoot, 'src', 'content', 'products', 'bench.json');
  const mediaPath = path.join(fx.repoRoot, 'public', 'uploads', 'new.jpg');
  await fs.writeFile(productPath, '{"slug":"bench","title":"Повреждено"}\n');
  await fs.writeFile(mediaPath, Buffer.from([1, 2, 3]));

  const preview = await fx.service.previewRestore({ ...OWNER, snapshotId: original.snapshotId });
  assert.equal(preview.canApply, true);
  assert.ok(preview.changes.some((item) => item.path.endsWith('bench.json') && item.action === 'replace'));
  assert.ok(preview.changes.some((item) => item.path.endsWith('new.jpg') && item.action === 'delete'));

  await fs.writeFile(productPath, '{"slug":"bench","title":"Конфликт"}\n');
  await assert.rejects(
    fx.service.applyRestore({ ...OWNER, restoreId: preview.restoreId }),
    (error) => error.code === 'BACKUP_RESTORE_CONFLICT'
  );
  const retry = await fx.service.previewRestore({ ...OWNER, snapshotId: original.snapshotId });
  const restored = await fx.service.applyRestore({ ...OWNER, restoreId: retry.restoreId });
  assert.equal(restored.result, 'success');
  assert.ok(restored.transactionId);
  assert.equal(await fs.readFile(productPath, 'utf8'), '{"slug":"bench","title":"Лавка"}\n');
  await assert.rejects(fs.access(mediaPath), (error) => error.code === 'ENOENT');
  const receiptPath = path.join(fx.repoRoot, '.admin-runtime', 'backup', `receipt-${retry.restoreId}.json`);
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(receipt.restoreKind, undefined);
  assert.equal(receipt.state, 'committed');
  assert.equal(receipt.manifestSha256, original.manifestSha256);
});

test('a copied backup root restores content and media into a fresh checkout', async (t) => {
  const fx = await fixture(t);
  const snapshot = await fx.service.createSnapshot({ transactionId: 'tx-new-machine' });
  const freshRoot = path.join(path.dirname(fx.repoRoot), 'fresh-checkout');
  await fs.mkdir(freshRoot, { recursive: true });
  const freshService = createBackupService({
    repoRoot: freshRoot,
    backupRoot: fx.backupRoot,
    runtimeDir: path.join(freshRoot, '.admin-runtime', 'backup'),
    transactionService: { async withStableRead(callback) { return callback(); } },
    retention: 3,
    maxBytes: 16 * 1024 * 1024,
    minFreeBytes: 0,
    randomUUID: () => '70000000-0000-0000-0000-000000000007'
  });
  await freshService.initialize();
  const preview = await freshService.previewRestore({ ...OWNER, snapshotId: snapshot.snapshotId });
  assert.equal(preview.changeCount, snapshot.fileCount);
  assert.ok(preview.changes.every((item) => item.action === 'create'));
  const restored = await freshService.applyRestore({ ...OWNER, restoreId: preview.restoreId });
  assert.equal(restored.result, 'success');
  assert.equal(
    await fs.readFile(path.join(freshRoot, 'src', 'content', 'products', 'bench.json'), 'utf8'),
    '{"slug":"bench","title":"Лавка"}\n'
  );
  assert.deepEqual(
    await fs.readFile(path.join(freshRoot, 'public', 'uploads', 'bench.jpg')),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  );
  await freshService.close();
});

test('backup failure never throws into Save path and remains visible in status', async (t) => {
  const fx = await fixture(t, { maxBytes: 1024 * 1024 });
  await fs.writeFile(path.join(fx.repoRoot, 'public', 'uploads', 'too-large.jpg'), Buffer.alloc(2 * 1024 * 1024, 7));
  assert.doesNotThrow(() => fx.service.scheduleAfterSave({ transactionId: 'tx-disk-full' }));
  await fx.service.waitForIdle();
  const status = await fx.service.status();
  assert.equal(status.lastAttempt.status, 'failed');
  assert.equal(status.lastError.code, 'BACKUP_QUOTA_EXCEEDED');
  assert.equal(await fs.readFile(path.join(fx.repoRoot, 'src', 'content', 'products', 'bench.json'), 'utf8'), '{"slug":"bench","title":"Лавка"}\n');
});

import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import path from 'node:path';
import {
  canonicalMediaFilename,
  canonicalPublicMediaPath,
  validateMediaUpload
} from './media-validation.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIB = 1024 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const LEASE_ID_RE = /^[a-f0-9]{64}$/u;
const BLOB_FILE_RE = /^([a-f0-9]{64})(\.(?:jpg|png|webp|mp4|webm))$/u;
const TEMP_FILE_RE = /^\.smu1-[1-9][0-9]*-[a-f0-9]{24}\.tmp$/u;

export const DEFAULT_STAGING_TTL_MS = 7 * DAY_MS;
export const DEFAULT_PROMOTED_RETENTION_MS = DAY_MS;
export const DEFAULT_MAX_STAGED_BYTES = 256 * MIB;
export const DEFAULT_MAX_BATCH_ITEMS = 100;
export const DEFAULT_TEMP_RETENTION_MS = 15 * 60 * 1000;

export class MediaStagingError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'MediaStagingError';
    this.code = code;
    this.status = options.status ?? 400;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function assertMediaStagingId(value, label = 'id') {
  const normalized = String(value ?? '');
  if (!ID_RE.test(normalized)) {
    throw new MediaStagingError('STAGING_ID_INVALID', `Некорректный ${label}.`);
  }
  return normalized;
}

function assertLeaseId(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (!LEASE_ID_RE.test(normalized)) {
    throw new MediaStagingError('LEASE_ID_INVALID', 'Некорректный leaseId.');
  }
  return normalized;
}

function safePositiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new MediaStagingError('STAGING_CONFIG_INVALID', `Некорректное значение ${name}.`);
  }
  return parsed;
}

function safeTimestamp(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new MediaStagingError('STAGING_METADATA_INVALID', `Некорректная отметка времени ${name}.`);
  }
  return parsed;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertContained(root, candidate) {
  if (!isContained(root, candidate)) {
    throw new MediaStagingError('STAGING_PATH_ESCAPE', 'Путь staging выходит за разрешённую директорию.');
  }
  return candidate;
}

function leaseIdForClient(clientId) {
  return createHash('sha256').update(`smu1-media-lease\0${clientId}`, 'utf8').digest('hex');
}

function publicLease(lease, blobMeta, extras = {}) {
  return Object.freeze({
    leaseId: lease.leaseId,
    stagedId: lease.stagedId,
    batchId: lease.batchId,
    clientId: lease.clientId,
    originalIndex: lease.originalIndex,
    originalFilename: lease.originalFilename,
    status: lease.status,
    createdAt: lease.createdAt,
    expiresAt: lease.expiresAt,
    canonicalPath: blobMeta.canonicalPath,
    validation: Object.freeze({ ...blobMeta.validation }),
    promoted: blobMeta.promoted === true,
    ...extras
  });
}

async function lstatOptional(filePath) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertPlainDirectory(directory, root, { exactRoot = false } = {}) {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Staging directory не должна быть symlink/junction.');
  }
  const real = await fs.realpath(directory);
  if (exactRoot ? !samePath(real, root) : !isContained(root, real)) {
    throw new MediaStagingError('STAGING_REALPATH_ESCAPE', 'Realpath staging выходит за configured root.');
  }
  return real;
}

async function ensureDirectory(directory, root, { exactRoot = false } = {}) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700).catch(() => {});
  return assertPlainDirectory(directory, root, { exactRoot });
}

async function readFileNoFollow(filePath, root) {
  assertContained(root, filePath);
  const before = await lstatOptional(filePath);
  if (!before) return null;
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Staging file не должен быть symlink/junction.');
  }
  const real = await fs.realpath(filePath);
  if (!isContained(root, real)) {
    throw new MediaStagingError('STAGING_REALPATH_ESCAPE', 'Realpath staging file выходит за configured root.');
  }
  const noFollow = Number(fsConstants.O_NOFOLLOW || 0);
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow);
    const after = await handle.stat();
    if (!after.isFile()
      || (before.dev !== undefined && after.dev !== undefined && before.dev !== after.dev)
      || (before.ino && after.ino && before.ino !== after.ino)) {
      throw new MediaStagingError('STAGING_FILE_CHANGED', 'Staging file изменился во время безопасного чтения.');
    }
    return await handle.readFile();
  } catch (error) {
    if (error?.code === 'ELOOP') {
      throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Symlink staging file запрещён.', { cause: error });
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readJsonNoFollow(filePath, root) {
  const bytes = await readFileNoFollow(filePath, root);
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new MediaStagingError('STAGING_METADATA_CORRUPT', 'Staging metadata повреждена.', { cause: error });
  }
}

async function writeTemporary(directory, bytes, randomBytes) {
  const name = `.smu1-${process.pid}-${randomBytes(12).toString('hex')}.tmp`;
  const filePath = assertContained(directory, path.join(directory, name));
  const handle = await fs.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return filePath;
}

async function writeFileExclusive(filePath, bytes, directory, randomBytes) {
  const temporary = await writeTemporary(directory, bytes, randomBytes);
  try {
    await fs.link(temporary, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function replaceFileAtomic(filePath, bytes, directory, randomBytes) {
  const existing = await lstatOptional(filePath);
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Нельзя заменить symlink/non-file metadata.');
  }
  const temporary = await writeTemporary(directory, bytes, randomBytes);
  try {
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function hashFileNoFollow(filePath, root) {
  const bytes = await readFileNoFollow(filePath, root);
  if (bytes === null) return null;
  return createHash('sha256').update(bytes).digest('hex');
}

function validateLeaseShape(lease, expected = {}) {
  if (!lease || lease.version !== 1) throw new MediaStagingError('STAGING_METADATA_INVALID', 'Некорректная версия lease metadata.');
  assertLeaseId(lease.leaseId);
  assertMediaStagingId(lease.batchId, 'batchId');
  assertMediaStagingId(lease.ownerId, 'ownerId');
  assertMediaStagingId(lease.clientId, 'clientId');
  if (!/^[a-f0-9]{64}$/u.test(String(lease.stagedId ?? ''))) {
    throw new MediaStagingError('STAGING_METADATA_INVALID', 'Некорректный stagedId.');
  }
  safeTimestamp(lease.createdAt, 'createdAt');
  safeTimestamp(lease.expiresAt, 'expiresAt');
  if (!['ready', 'promoted'].includes(lease.status)) {
    throw new MediaStagingError('STAGING_METADATA_INVALID', 'Некорректный статус lease.');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && lease[key] !== value) {
      throw new MediaStagingError('STAGING_LEASE_MISMATCH', `Lease не соответствует ${key}.`, { status: 403 });
    }
  }
  return lease;
}

function validateBlobMeta(meta, stagedId) {
  if (!meta || meta.version !== 1 || meta.stagedId !== stagedId || meta.sha256 !== stagedId) {
    throw new MediaStagingError('STAGING_METADATA_INVALID', 'Некорректная blob metadata.');
  }
  if (!Number.isSafeInteger(meta.bytes) || meta.bytes <= 0 || typeof meta.canonicalPath !== 'string') {
    throw new MediaStagingError('STAGING_METADATA_INVALID', 'Blob metadata не содержит обязательных полей.');
  }
  if (canonicalPublicMediaPath(meta.validation) !== meta.canonicalPath) {
    throw new MediaStagingError('STAGING_METADATA_INVALID', 'Canonical path не соответствует validated blob.');
  }
  safeTimestamp(meta.createdAt, 'createdAt');
  return meta;
}

export function createMediaStagingService(options = {}) {
  if (!options.stagingRoot) {
    throw new MediaStagingError('STAGING_ROOT_REQUIRED', 'Не задан stagingRoot.');
  }
  const root = path.resolve(options.stagingRoot);
  const blobsDirectory = path.join(root, 'blobs');
  const metadataDirectory = path.join(root, 'blob-meta');
  const batchesDirectory = path.join(root, 'batches');
  const ttlMs = safePositiveInteger(options.ttlMs ?? DEFAULT_STAGING_TTL_MS, 'ttlMs', 90 * DAY_MS);
  const promotedRetentionMs = safePositiveInteger(options.promotedRetentionMs ?? DEFAULT_PROMOTED_RETENTION_MS, 'promotedRetentionMs', 30 * DAY_MS);
  const maxTotalBytes = safePositiveInteger(options.maxTotalBytes ?? DEFAULT_MAX_STAGED_BYTES, 'maxTotalBytes');
  const maxBatchItems = safePositiveInteger(options.maxBatchItems ?? DEFAULT_MAX_BATCH_ITEMS, 'maxBatchItems', 10_000);
  const tempRetentionMs = safePositiveInteger(options.tempRetentionMs ?? DEFAULT_TEMP_RETENTION_MS, 'tempRetentionMs', DAY_MS);
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const validator = options.validator ?? validateMediaUpload;
  let initialized = false;
  let operationTail = Promise.resolve();

  const exclusive = (work) => {
    const result = operationTail.then(work, work);
    operationTail = result.catch(() => {});
    return result;
  };

  async function init() {
    if (initialized) {
      await Promise.all([
        assertPlainDirectory(root, root, { exactRoot: true }),
        assertPlainDirectory(blobsDirectory, root),
        assertPlainDirectory(metadataDirectory, root),
        assertPlainDirectory(batchesDirectory, root)
      ]);
      return;
    }
    await ensureDirectory(root, root, { exactRoot: true });
    await ensureDirectory(blobsDirectory, root);
    await ensureDirectory(metadataDirectory, root);
    await ensureDirectory(batchesDirectory, root);
    initialized = true;
  }

  function batchDirectory(batchId) {
    return assertContained(batchesDirectory, path.join(batchesDirectory, assertMediaStagingId(batchId, 'batchId')));
  }

  function leasePath(batchId, leaseId) {
    return assertContained(batchDirectory(batchId), path.join(batchDirectory(batchId), `${assertLeaseId(leaseId)}.json`));
  }

  function metaPath(stagedId) {
    if (!/^[a-f0-9]{64}$/u.test(String(stagedId ?? ''))) {
      throw new MediaStagingError('STAGED_ID_INVALID', 'Некорректный stagedId.');
    }
    return assertContained(metadataDirectory, path.join(metadataDirectory, `${stagedId}.json`));
  }

  function blobPath(validation) {
    return assertContained(blobsDirectory, path.join(blobsDirectory, canonicalMediaFilename(validation)));
  }

  async function ensureBatchDirectory(batchId) {
    const directory = batchDirectory(batchId);
    await ensureDirectory(directory, root);
    return directory;
  }

  async function readLease({ batchId, clientId, leaseId, ownerId, required = true }) {
    const safeBatch = assertMediaStagingId(batchId, 'batchId');
    const safeOwner = ownerId === undefined ? undefined : assertMediaStagingId(ownerId, 'ownerId');
    const safeClient = clientId === undefined ? undefined : assertMediaStagingId(clientId, 'clientId');
    const resolvedLeaseId = leaseId === undefined ? leaseIdForClient(safeClient) : assertLeaseId(leaseId);
    const lease = await readJsonNoFollow(leasePath(safeBatch, resolvedLeaseId), root);
    if (!lease) {
      if (!required) return null;
      throw new MediaStagingError('STAGING_LEASE_NOT_FOUND', 'Staged item не найден или уже истёк.', { status: 404 });
    }
    return validateLeaseShape(lease, {
      batchId: safeBatch,
      ownerId: safeOwner,
      clientId: safeClient,
      leaseId: resolvedLeaseId
    });
  }

  async function readBlobMeta(stagedId) {
    const meta = await readJsonNoFollow(metaPath(stagedId), root);
    if (!meta) throw new MediaStagingError('STAGING_BLOB_NOT_FOUND', 'Staged blob не найден или истёк.', { status: 404 });
    return validateBlobMeta(meta, stagedId);
  }

  async function listBatchLeases(batchId) {
    const directory = batchDirectory(batchId);
    const stat = await lstatOptional(directory);
    if (!stat) return [];
    await assertPlainDirectory(directory, root);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const leases = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) {
        if (entry.isSymbolicLink()) {
          throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Symlink в batch directory запрещён.');
        }
        continue;
      }
      const lease = await readJsonNoFollow(path.join(directory, entry.name), root);
      leases.push(validateLeaseShape(lease, { batchId }));
    }
    return leases.sort((left, right) => left.originalIndex - right.originalIndex || left.createdAt - right.createdAt);
  }

  async function allLeases() {
    await init();
    const entries = await fs.readdir(batchesDirectory, { withFileTypes: true });
    const leases = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Symlink batch directory запрещён.');
      }
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
      leases.push(...await listBatchLeases(entry.name));
    }
    return leases;
  }

  async function cleanupTemporaryFiles({ at = now(), removeAll = false } = {}) {
    const cutoff = safeTimestamp(at, 'temporary cleanup at');
    let removedTemporaryFiles = 0;
    let removedTemporaryBytes = 0;
    const cleanDirectory = async (directory) => {
      await assertPlainDirectory(directory, root);
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!TEMP_FILE_RE.test(entry.name)) continue;
        if (entry.isSymbolicLink() || !entry.isFile()) {
          throw new MediaStagingError('STAGING_TEMP_UNSAFE', 'Temporary staging object не является обычным файлом.');
        }
        const filePath = assertContained(directory, path.join(directory, entry.name));
        const stat = await fs.lstat(filePath);
        if (!removeAll && stat.mtimeMs + tempRetentionMs > cutoff) continue;
        await fs.unlink(filePath);
        removedTemporaryFiles += 1;
        removedTemporaryBytes += stat.size;
      }
    };
    await cleanDirectory(blobsDirectory);
    await cleanDirectory(metadataDirectory);
    const batches = await fs.readdir(batchesDirectory, { withFileTypes: true });
    for (const entry of batches) {
      if (entry.isSymbolicLink()) {
        throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Symlink batch directory запрещён.');
      }
      if (entry.isDirectory() && ID_RE.test(entry.name)) await cleanDirectory(path.join(batchesDirectory, entry.name));
    }
    return { removedTemporaryFiles, removedTemporaryBytes };
  }

  async function usageUnlocked() {
    await init();
    const entries = await fs.readdir(blobsDirectory, { withFileTypes: true });
    let bytes = 0;
    let blobs = 0;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Symlink staged blob запрещён.');
      }
      if (!entry.isFile()) continue;
      const filePath = path.join(blobsDirectory, entry.name);
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Некорректный staged blob.');
      }
      bytes += stat.size;
      if (BLOB_FILE_RE.test(entry.name)) blobs += 1;
    }
    return Object.freeze({ bytes, blobs, maxTotalBytes, remainingBytes: Math.max(0, maxTotalBytes - bytes) });
  }

  async function ensureBlob(validation, buffer) {
    const target = blobPath(validation);
    const existing = await lstatOptional(target);
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Existing staged blob не является обычным файлом.');
      }
      const existingHash = await hashFileNoFollow(target, root);
      if (existingHash !== validation.sha256 || existing.size !== validation.bytes) {
        throw new MediaStagingError('STAGING_HASH_COLLISION', 'Existing staged blob не соответствует content hash.');
      }
      return { target, reused: true };
    }
    const currentUsage = await usageUnlocked();
    if (currentUsage.bytes + validation.bytes > maxTotalBytes) {
      throw new MediaStagingError('STAGING_BUDGET_EXCEEDED', 'Локальное staging-хранилище достигло безопасного лимита.', {
        status: 413,
        details: { currentBytes: currentUsage.bytes, incomingBytes: validation.bytes, maxTotalBytes }
      });
    }
    const created = await writeFileExclusive(target, buffer, blobsDirectory, randomBytes);
    if (!created) {
      const existingHash = await hashFileNoFollow(target, root);
      if (existingHash !== validation.sha256) {
        throw new MediaStagingError('STAGING_HASH_COLLISION', 'Concurrent staged blob не соответствует content hash.');
      }
      return { target, reused: true };
    }
    return { target, reused: false };
  }

  async function ensureBlobMeta(validation, createdAt) {
    const filePath = metaPath(validation.sha256);
    const metadata = {
      version: 1,
      stagedId: validation.sha256,
      sha256: validation.sha256,
      bytes: validation.bytes,
      extension: validation.extension,
      canonicalPath: canonicalPublicMediaPath(validation),
      createdAt,
      promoted: false,
      promotedAt: null,
      validation: { ...validation, originalFilename: undefined }
    };
    delete metadata.validation.originalFilename;
    const created = await writeFileExclusive(filePath, jsonBytes(metadata), metadataDirectory, randomBytes);
    if (created) return metadata;
    const existing = validateBlobMeta(await readJsonNoFollow(filePath, root), validation.sha256);
    if (existing.bytes !== validation.bytes || existing.extension !== validation.extension) {
      throw new MediaStagingError('STAGING_METADATA_CONFLICT', 'Blob metadata конфликтует с validated upload.');
    }
    return existing;
  }

  async function removeEmptyBatchDirectory(batchId) {
    const directory = batchDirectory(batchId);
    try {
      await fs.rmdir(directory);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error;
    }
  }

  async function removeBlobIfUnleased(stagedId) {
    const leases = await allLeases();
    if (leases.some((lease) => lease.stagedId === stagedId)) return false;
    const metadata = await readJsonNoFollow(metaPath(stagedId), root);
    if (!metadata) return false;
    const checked = validateBlobMeta(metadata, stagedId);
    const filePath = blobPath(checked.validation);
    const fileStat = await lstatOptional(filePath);
    if (fileStat) {
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Orphan blob не является обычным файлом.');
      }
      await fs.unlink(filePath);
    }
    await fs.unlink(metaPath(stagedId)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    return true;
  }

  async function verifyLeaseBlob(lease, { allowExpired = false } = {}) {
    const meta = await readBlobMeta(lease.stagedId);
    if (!allowExpired && lease.status !== 'promoted' && now() >= lease.expiresAt) {
      throw new MediaStagingError('STAGING_LEASE_EXPIRED', 'Staged item истёк. Файл нужно выбрать снова.', {
        status: 410
      });
    }
    const filePath = blobPath(meta.validation);
    const stat = await lstatOptional(filePath);
    if (!stat) {
      throw new MediaStagingError('STAGING_BLOB_NOT_FOUND', 'Staged blob отсутствует.', { status: 410 });
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Staged blob не является обычным файлом.');
    }
    if (stat.size !== meta.bytes) {
      throw new MediaStagingError('STAGING_BLOB_CHANGED', 'Размер staged blob изменился после validation.');
    }
    const digest = await hashFileNoFollow(filePath, root);
    if (digest !== meta.sha256) {
      throw new MediaStagingError('STAGING_BLOB_CHANGED', 'Hash staged blob изменился после validation.');
    }
    return { meta, filePath };
  }

  async function stage(input = {}) {
    const batchId = assertMediaStagingId(input.batchId, 'batchId');
    const ownerId = assertMediaStagingId(input.ownerId, 'ownerId');
    const clientId = assertMediaStagingId(input.clientId, 'clientId');
    const originalIndex = Number(input.originalIndex ?? 0);
    if (!Number.isSafeInteger(originalIndex) || originalIndex < 0 || originalIndex > 1_000_000) {
      throw new MediaStagingError('ORIGINAL_INDEX_INVALID', 'Некорректный originalIndex.');
    }
    const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer ?? []);
    const validation = await validator({
      buffer,
      filename: input.filename,
      declaredMime: input.declaredMime,
      limits: input.limits ?? options.limits
    });

    return exclusive(async () => {
      await init();
      await cleanupTemporaryFiles({ at: now(), removeAll: true });
      const directory = await ensureBatchDirectory(batchId);
      const leaseId = leaseIdForClient(clientId);
      const existingLease = await readLease({ batchId, ownerId, clientId, leaseId, required: false });
      if (existingLease) {
        if (existingLease.stagedId !== validation.sha256) {
          throw new MediaStagingError('STAGING_CLIENT_ID_CONFLICT', 'clientId уже связан с другим содержимым.', { status: 409 });
        }
        const existingMeta = await readBlobMeta(existingLease.stagedId);
        return publicLease(existingLease, existingMeta, { reused: true, idempotent: true });
      }
      const batchLeases = await listBatchLeases(batchId);
      if (batchLeases.length >= maxBatchItems) {
        throw new MediaStagingError('STAGING_BATCH_LIMIT', 'В одном staging batch слишком много файлов.', {
          status: 413,
          details: { maxBatchItems }
        });
      }

      const createdAt = now();
      const blob = await ensureBlob(validation, buffer);
      const blobMeta = await ensureBlobMeta(validation, createdAt);
      const lease = {
        version: 1,
        leaseId,
        stagedId: validation.sha256,
        batchId,
        ownerId,
        clientId,
        originalIndex,
        originalFilename: validation.originalFilename,
        status: blobMeta.promoted ? 'promoted' : 'ready',
        createdAt,
        expiresAt: createdAt + ttlMs
      };
      const createdLease = await writeFileExclusive(leasePath(batchId, leaseId), jsonBytes(lease), directory, randomBytes);
      if (!createdLease) {
        const concurrentLease = await readLease({ batchId, ownerId, clientId, leaseId });
        if (concurrentLease.stagedId !== validation.sha256) {
          throw new MediaStagingError('STAGING_CLIENT_ID_CONFLICT', 'Concurrent clientId связан с другим содержимым.', { status: 409 });
        }
        return publicLease(concurrentLease, blobMeta, { reused: true, idempotent: true });
      }
      return publicLease(lease, blobMeta, { reused: blob.reused, idempotent: false });
    });
  }

  async function get(input = {}) {
    return exclusive(async () => {
      await init();
      const lease = await readLease(input);
      const meta = await readBlobMeta(lease.stagedId);
      if (now() >= lease.expiresAt && lease.status !== 'promoted') {
        throw new MediaStagingError('STAGING_LEASE_EXPIRED', 'Staged item истёк. Текстовый draft можно сохранить, файл нужно выбрать снова.', {
          status: 410
        });
      }
      return publicLease(lease, meta);
    });
  }

  async function listBatch(input = {}) {
    const batchId = assertMediaStagingId(input.batchId, 'batchId');
    const ownerId = assertMediaStagingId(input.ownerId, 'ownerId');
    return exclusive(async () => {
      await init();
      const leases = await listBatchLeases(batchId);
      const results = [];
      for (const lease of leases) {
        validateLeaseShape(lease, { ownerId });
        const meta = await readBlobMeta(lease.stagedId);
        results.push(publicLease(lease, meta, { expired: now() >= lease.expiresAt && lease.status !== 'promoted' }));
      }
      return Object.freeze(results);
    });
  }

  async function renewBatch(input = {}) {
    const batchId = assertMediaStagingId(input.batchId, 'batchId');
    const ownerId = assertMediaStagingId(input.ownerId, 'ownerId');
    const extensionMs = safePositiveInteger(input.ttlMs ?? ttlMs, 'ttlMs', 90 * DAY_MS);
    return exclusive(async () => {
      await init();
      const leases = await listBatchLeases(batchId);
      const renewedAt = now();
      let renewed = 0;
      for (const lease of leases) {
        validateLeaseShape(lease, { ownerId });
        if (lease.status === 'promoted') continue;
        const next = { ...lease, expiresAt: renewedAt + extensionMs };
        await replaceFileAtomic(leasePath(batchId, lease.leaseId), jsonBytes(next), batchDirectory(batchId), randomBytes);
        renewed += 1;
      }
      return Object.freeze({ batchId, renewed, expiresAt: renewedAt + extensionMs });
    });
  }

  async function markPromoted(input = {}) {
    return exclusive(async () => {
      await init();
      const lease = await readLease(input);
      const { meta } = await verifyLeaseBlob(lease);
      const expectedCanonical = meta.canonicalPath;
      if (input.canonicalPath !== undefined && input.canonicalPath !== expectedCanonical) {
        throw new MediaStagingError('CANONICAL_PATH_MISMATCH', 'Promotion path не соответствует content-addressed staged blob.');
      }
      const promotedAt = now();
      const nextMeta = { ...meta, promoted: true, promotedAt, canonicalPath: expectedCanonical };
      const nextLease = { ...lease, status: 'promoted', promotedAt, expiresAt: promotedAt + promotedRetentionMs };
      await replaceFileAtomic(metaPath(lease.stagedId), jsonBytes(nextMeta), metadataDirectory, randomBytes);
      await replaceFileAtomic(leasePath(lease.batchId, lease.leaseId), jsonBytes(nextLease), batchDirectory(lease.batchId), randomBytes);
      return publicLease(nextLease, nextMeta);
    });
  }

  async function resolveForPromotion(input = {}) {
    return exclusive(async () => {
      await init();
      const lease = await readLease(input);
      const { meta, filePath } = await verifyLeaseBlob(lease);
      const bytes = await readFileNoFollow(filePath, root);
      if (bytes.length !== meta.bytes || createHash('sha256').update(bytes).digest('hex') !== meta.sha256) {
        throw new MediaStagingError('STAGING_BLOB_CHANGED', 'Staged blob изменился во время подготовки транзакции.');
      }
      return Object.freeze({
        ...publicLease(lease, meta, { verified: true }),
        filePath,
        bytes
      });
    });
  }

  async function verifyForPromotion(input = {}) {
    return exclusive(async () => {
      await init();
      const lease = await readLease(input);
      const { meta } = await verifyLeaseBlob(lease);
      return publicLease(lease, meta, { verified: true });
    });
  }

  async function cancel(input = {}) {
    return exclusive(async () => {
      await init();
      const lease = await readLease(input);
      const meta = await readBlobMeta(lease.stagedId);
      if (lease.status === 'promoted') {
        return Object.freeze({ cancelled: false, reason: 'promoted', stagedId: lease.stagedId, removedBlob: false });
      }
      await fs.unlink(leasePath(lease.batchId, lease.leaseId));
      await removeEmptyBatchDirectory(lease.batchId);
      const removedBlob = await removeBlobIfUnleased(lease.stagedId);
      return Object.freeze({ cancelled: true, reason: 'cancelled', stagedId: lease.stagedId, removedBlob });
    });
  }

  async function cleanupExpired(input = {}) {
    return exclusive(async () => {
      await init();
      const at = input.at === undefined ? now() : safeTimestamp(input.at, 'cleanup at');
      const temporaryCleanup = await cleanupTemporaryFiles({ at, removeAll: input.removeTemporary === true });
      const leases = await allLeases();
      const expired = leases.filter((lease) => lease.expiresAt <= at);
      const affectedBlobs = new Set();
      const affectedBatches = new Set();
      for (const lease of expired) {
        await fs.unlink(leasePath(lease.batchId, lease.leaseId)).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
        affectedBlobs.add(lease.stagedId);
        affectedBatches.add(lease.batchId);
      }
      for (const batchId of affectedBatches) await removeEmptyBatchDirectory(batchId);

      let removedBlobs = 0;
      for (const stagedId of affectedBlobs) {
        if (await removeBlobIfUnleased(stagedId)) removedBlobs += 1;
      }

      const metadataEntries = await fs.readdir(metadataDirectory, { withFileTypes: true });
      for (const entry of metadataEntries) {
        if (entry.isSymbolicLink()) {
          throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Symlink blob metadata запрещён.');
        }
        const match = entry.isFile() && entry.name.match(/^([a-f0-9]{64})\.json$/u);
        if (!match) continue;
        const stagedId = match[1];
        const meta = validateBlobMeta(await readJsonNoFollow(path.join(metadataDirectory, entry.name), root), stagedId);
        const retentionBoundary = meta.promoted
          ? (meta.promotedAt ?? meta.createdAt) + promotedRetentionMs
          : meta.createdAt + ttlMs;
        if (retentionBoundary <= at && await removeBlobIfUnleased(stagedId)) removedBlobs += 1;
      }

      const blobEntries = await fs.readdir(blobsDirectory, { withFileTypes: true });
      for (const entry of blobEntries) {
        if (entry.isSymbolicLink()) {
          throw new MediaStagingError('STAGING_SYMLINK_FORBIDDEN', 'Symlink staged blob запрещён.');
        }
        const match = entry.isFile() && entry.name.match(BLOB_FILE_RE);
        if (!match) continue;
        const stagedId = match[1];
        if (await lstatOptional(metaPath(stagedId))) continue;
        const filePath = path.join(blobsDirectory, entry.name);
        const stat = await fs.lstat(filePath);
        if (stat.mtimeMs + ttlMs <= at) {
          await fs.unlink(filePath);
          removedBlobs += 1;
        }
      }
      return Object.freeze({
        at,
        removedLeases: expired.length,
        removedBlobs,
        ...(temporaryCleanup.removedTemporaryFiles ? temporaryCleanup : {})
      });
    });
  }

  return Object.freeze({
    root,
    init,
    stage,
    get,
    status: get,
    listBatch,
    renewBatch,
    verifyForPromotion,
    resolveForPromotion,
    markPromoted,
    cancel,
    cleanupExpired,
    usage: () => exclusive(usageUnlocked)
  });
}

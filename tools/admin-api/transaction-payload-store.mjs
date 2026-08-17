import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SHA256_RE = /^[a-f0-9]{64}$/u;
const TEMP_FILE_RE = /^\.payload-[a-f0-9]{64}-\d+-[a-f0-9-]{36}\.tmp$/u;
const BLOB_FILE_RE = /^([a-f0-9]{64})\.blob$/u;
const SHARD_RE = /^[a-f0-9]{2}$/u;
const DEFAULT_CHUNK_BYTES = 64 * 1024;

export class TransactionPayloadStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TransactionPayloadStoreError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, error: this.message, details: this.details };
  }
}

function fail(code, message, details = {}) {
  throw new TransactionPayloadStoreError(code, message, details);
}

function isMissingError(error) {
  return error?.code === 'ENOENT';
}

function isExistsError(error) {
  return error?.code === 'EEXIST';
}

function isInsideOrEqual(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sameRef(left, right) {
  return left.sha256 === right.sha256 && left.size === right.size;
}

export function normalizePayloadRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'sha256,size'
    || typeof value.sha256 !== 'string' || !SHA256_RE.test(value.sha256)
    || !Number.isSafeInteger(value.size) || value.size < 0) {
    fail(
      'TRANSACTION_PAYLOAD_REF_INVALID',
      'Transaction payload reference is invalid.',
      { expected: '{ sha256: 64 lowercase hex characters, size: non-negative safe integer }' }
    );
  }
  return Object.freeze({ sha256: value.sha256, size: value.size });
}

export function createTransactionPayloadStore(options = {}) {
  const fileSystem = options.fileSystem ?? fs;
  const runtimeDir = path.resolve(options.runtimeDir ?? process.cwd());
  const payloadRoot = path.resolve(options.payloadRoot ?? path.join(runtimeDir, 'payloads', 'sha256'));
  const chunkBytes = Number(options.chunkBytes ?? DEFAULT_CHUNK_BYTES);
  const syncDirectory = typeof options.syncDirectory === 'function' ? options.syncDirectory : async () => {};

  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 4 * 1024 || chunkBytes > 4 * 1024 * 1024
    || !isInsideOrEqual(runtimeDir, payloadRoot) || payloadRoot === runtimeDir) {
    fail('TRANSACTION_PAYLOAD_CONFIG_INVALID', 'Transaction payload store configuration is invalid.');
  }

  let runtimeRealRoot = null;
  let payloadRealRoot = null;

  async function assertDirectorySafe(directory, boundary, code = 'TRANSACTION_PAYLOAD_PATH_UNSAFE') {
    let stats;
    try {
      stats = await fileSystem.lstat(directory);
    } catch (error) {
      if (isMissingError(error)) {
        fail(code, 'Transaction payload directory is missing.');
      }
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      fail(code, 'Transaction payload path is not a safe directory.');
    }
    const real = await fileSystem.realpath(directory);
    if (boundary && !isInsideOrEqual(boundary, real)) {
      fail(code, 'Transaction payload path escapes its runtime boundary.');
    }
    return real;
  }

  async function ensureLayout() {
    await fileSystem.mkdir(runtimeDir, { recursive: true });
    runtimeRealRoot = await assertDirectorySafe(runtimeDir, null);
    await fileSystem.mkdir(payloadRoot, { recursive: true });
    let cursor = runtimeDir;
    for (const segment of path.relative(runtimeDir, payloadRoot).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      await assertDirectorySafe(cursor, runtimeRealRoot);
    }
    payloadRealRoot = await fileSystem.realpath(payloadRoot);
    if (!isInsideOrEqual(runtimeRealRoot, payloadRealRoot) || payloadRealRoot === runtimeRealRoot) {
      fail('TRANSACTION_PAYLOAD_PATH_UNSAFE', 'Transaction payload root escapes its runtime boundary.');
    }
  }

  function shardPath(digest) {
    return path.join(payloadRoot, digest.slice(0, 2));
  }

  function blobPath(ref) {
    return path.join(shardPath(ref.sha256), `${ref.sha256}.blob`);
  }

  async function ensureShard(digest) {
    if (!SHA256_RE.test(digest)) {
      fail('TRANSACTION_PAYLOAD_REF_INVALID', 'Transaction payload digest is invalid.');
    }
    if (!payloadRealRoot) await ensureLayout();
    const currentPayloadRealRoot = await assertDirectorySafe(payloadRoot, runtimeRealRoot);
    if (currentPayloadRealRoot !== payloadRealRoot) {
      fail('TRANSACTION_PAYLOAD_PATH_UNSAFE', 'Transaction payload root changed after initialization.');
    }
    const shard = shardPath(digest);
    await fileSystem.mkdir(shard, { recursive: true });
    await assertDirectorySafe(shard, payloadRealRoot);
    return shard;
  }

  async function assertExistingBlobSafe(ref) {
    const normalized = normalizePayloadRef(ref);
    await ensureShard(normalized.sha256);
    const target = blobPath(normalized);
    let stats;
    try {
      stats = await fileSystem.lstat(target);
    } catch (error) {
      if (isMissingError(error)) {
        fail('TRANSACTION_PAYLOAD_MISSING', 'Required transaction payload is missing.', {
          sha256: normalized.sha256,
          size: normalized.size
        });
      }
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      fail('TRANSACTION_PAYLOAD_PATH_UNSAFE', 'Transaction payload is not a safe regular file.', {
        sha256: normalized.sha256
      });
    }
    const real = await fileSystem.realpath(target);
    if (!isInsideOrEqual(payloadRealRoot, real)) {
      fail('TRANSACTION_PAYLOAD_PATH_UNSAFE', 'Transaction payload escapes its runtime boundary.', {
        sha256: normalized.sha256
      });
    }
    if (stats.size !== normalized.size) {
      fail('TRANSACTION_PAYLOAD_CORRUPT', 'Transaction payload size does not match its reference.', {
        sha256: normalized.sha256,
        expectedSize: normalized.size,
        actualSize: stats.size
      });
    }
    return { normalized, target };
  }

  async function streamVerified(ref, destinationHandle = null) {
    const { normalized, target } = await assertExistingBlobSafe(ref);
    let sourceHandle;
    const digest = crypto.createHash('sha256');
    let total = 0;
    try {
      sourceHandle = await fileSystem.open(target, 'r');
      const openedStats = await sourceHandle.stat();
      if (!openedStats.isFile() || openedStats.size !== normalized.size) {
        fail('TRANSACTION_PAYLOAD_CORRUPT', 'Transaction payload changed while it was opened.', {
          sha256: normalized.sha256
        });
      }
      const chunk = Buffer.allocUnsafe(chunkBytes);
      while (true) {
        const { bytesRead } = await sourceHandle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        const bytes = chunk.subarray(0, bytesRead);
        digest.update(bytes);
        total += bytesRead;
        if (total > normalized.size) {
          fail('TRANSACTION_PAYLOAD_CORRUPT', 'Transaction payload exceeds its referenced size.', {
            sha256: normalized.sha256
          });
        }
        if (destinationHandle) {
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesWritten } = await destinationHandle.write(bytes, offset, bytes.length - offset, null);
            if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) {
              fail('TRANSACTION_PAYLOAD_WRITE_FAILED', 'Transaction payload destination accepted no bytes.', {
                sha256: normalized.sha256
              });
            }
            offset += bytesWritten;
          }
        }
      }
    } finally {
      await sourceHandle?.close().catch(() => {});
    }
    const actualDigest = digest.digest('hex');
    if (total !== normalized.size || actualDigest !== normalized.sha256) {
      fail('TRANSACTION_PAYLOAD_CORRUPT', 'Transaction payload hash does not match its reference.', {
        sha256: normalized.sha256,
        expectedSize: normalized.size,
        actualSize: total
      });
    }
    return normalized;
  }

  async function verify(ref) {
    return streamVerified(ref);
  }

  async function writeToHandle(ref, destinationHandle) {
    if (!destinationHandle || typeof destinationHandle.write !== 'function') {
      fail('TRANSACTION_PAYLOAD_DESTINATION_INVALID', 'Transaction payload destination is invalid.');
    }
    return streamVerified(ref, destinationHandle);
  }

  async function read(ref) {
    const { normalized, target } = await assertExistingBlobSafe(ref);
    const bytes = await fileSystem.readFile(target);
    const actual = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    if (!sameRef(normalized, actual)) {
      fail('TRANSACTION_PAYLOAD_CORRUPT', 'Transaction payload hash does not match its reference.', {
        sha256: normalized.sha256,
        expectedSize: normalized.size,
        actualSize: actual.size
      });
    }
    return bytes;
  }

  async function put(value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '');
    const ref = normalizePayloadRef({
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length
    });
    const shard = await ensureShard(ref.sha256);
    const target = blobPath(ref);
    try {
      await fileSystem.lstat(target);
      await verify(ref);
      return ref;
    } catch (error) {
      if (!isMissingError(error) && error?.code !== 'TRANSACTION_PAYLOAD_MISSING') throw error;
    }

    const temporary = path.join(
      shard,
      `.payload-${ref.sha256}-${process.pid}-${crypto.randomUUID()}.tmp`
    );
    let handle;
    try {
      handle = await fileSystem.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      try {
        await fileSystem.rename(temporary, target);
      } catch (error) {
        if (!isExistsError(error)) throw error;
        await fileSystem.rm(temporary, { force: true });
      }
      await syncDirectory(shard);
      await verify(ref);
      return ref;
    } catch (error) {
      await handle?.close().catch(() => {});
      await fileSystem.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function safeDirectoryEntries(directory) {
    try {
      return await fileSystem.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingError(error)) return [];
      throw error;
    }
  }

  async function cleanupTemporaryFiles() {
    if (!payloadRealRoot) await ensureLayout();
    let removed = 0;
    const directories = [payloadRoot];
    for (const entry of await safeDirectoryEntries(payloadRoot)) {
      if (!SHARD_RE.test(entry.name)) continue;
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        fail('TRANSACTION_PAYLOAD_PATH_UNSAFE', 'Transaction payload shard is unsafe.');
      }
      directories.push(path.join(payloadRoot, entry.name));
    }
    for (const directory of directories) {
      await assertDirectorySafe(directory, payloadRealRoot);
      for (const entry of await safeDirectoryEntries(directory)) {
        if (!TEMP_FILE_RE.test(entry.name)) continue;
        const target = path.join(directory, entry.name);
        const stats = await fileSystem.lstat(target);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          fail('TRANSACTION_PAYLOAD_PATH_UNSAFE', 'Crash-temporary payload path is unsafe.');
        }
        await fileSystem.unlink(target);
        removed += 1;
      }
      if (removed) await syncDirectory(directory);
    }
    return removed;
  }

  async function garbageCollect(referencedDigests) {
    if (!(referencedDigests instanceof Set)
      || [...referencedDigests].some((digest) => typeof digest !== 'string' || !SHA256_RE.test(digest))) {
      fail('TRANSACTION_PAYLOAD_GC_REFS_INVALID', 'Transaction payload GC references are invalid.');
    }
    await cleanupTemporaryFiles();
    let removed = 0;
    for (const shardEntry of await safeDirectoryEntries(payloadRoot)) {
      if (!SHARD_RE.test(shardEntry.name)) continue;
      if (shardEntry.isSymbolicLink() || !shardEntry.isDirectory()) {
        fail('TRANSACTION_PAYLOAD_PATH_UNSAFE', 'Transaction payload shard is unsafe.');
      }
      const shard = path.join(payloadRoot, shardEntry.name);
      await assertDirectorySafe(shard, payloadRealRoot);
      for (const entry of await safeDirectoryEntries(shard)) {
        const match = BLOB_FILE_RE.exec(entry.name);
        if (!match || !match[1].startsWith(shardEntry.name) || referencedDigests.has(match[1])) continue;
        const target = path.join(shard, entry.name);
        const stats = await fileSystem.lstat(target);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          fail('TRANSACTION_PAYLOAD_PATH_UNSAFE', 'Unreferenced payload path is unsafe.', { sha256: match[1] });
        }
        await fileSystem.unlink(target);
        removed += 1;
      }
      await syncDirectory(shard);
    }
    return Object.freeze({ removed });
  }

  return Object.freeze({
    ensureLayout,
    put,
    read,
    verify,
    writeToHandle,
    cleanupTemporaryFiles,
    garbageCollect,
    normalizeRef: normalizePayloadRef,
    payloadRoot
  });
}

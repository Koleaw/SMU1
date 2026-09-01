import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createTransactionEngine, revisionForBytes } from './transaction-engine.mjs';

const execFileAsync = promisify(execFile);
const SNAPSHOT_ID_RE = /^backup-[0-9]{8}t[0-9]{6}z-[a-f0-9]{12}$/u;
const RESTORE_ID_RE = /^restore-[a-f0-9]{32}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const DEFAULT_RETENTION = 20;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_MIN_FREE_BYTES = 512 * 1024 * 1024;
const RESTORE_PREVIEW_TTL_MS = 30 * 60 * 1000;
const SOURCE_ROOTS = Object.freeze([
  { path: 'src/content', jsonOnly: true },
  { path: 'src/data', jsonOnly: true },
  { path: 'public/uploads' },
  { path: 'public/assets/brand' },
  { path: 'public/assets/icons' },
  { path: 'public/assets/images' },
  { path: 'public/assets/video' },
  { path: 'public/brand' },
  { path: 'public/icons' },
  { path: 'public/images' },
  { path: 'public/video' }
]);

export class BackupServiceError extends Error {
  constructor(code, message, { status = 400, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BackupServiceError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function contained(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (!normalized
    || normalized.startsWith('/')
    || normalized.includes('\0')
    || normalized.includes(':')
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new BackupServiceError('BACKUP_PATH_INVALID', 'Backup содержит небезопасный путь.', {
      status: 500,
      details: { path: String(value || '') }
    });
  }
  return normalized;
}

function managedPath(value) {
  const normalized = normalizeRelativePath(value);
  return SOURCE_ROOTS.some((root) => normalized === root.path || normalized.startsWith(`${root.path}/`));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function digest(value) {
  return sha256(Buffer.from(JSON.stringify(value), 'utf8'));
}

function ownerKey(request = {}) {
  const owner = String(request.owner || '').trim();
  const recovery = String(request.recoveryClientId || '').trim();
  if (!owner || !recovery) throw new BackupServiceError('BACKUP_OWNERSHIP_REQUIRED', 'Нужна локальная сессия и recovery id.', { status: 401 });
  return sha256(Buffer.from(`smu1-backup\0${owner}\0${recovery}`, 'utf8'));
}

function snapshotId(value) {
  const id = String(value || '').toLowerCase();
  if (!SNAPSHOT_ID_RE.test(id)) throw new BackupServiceError('BACKUP_NOT_FOUND', 'Резервная копия не найдена.', { status: 404 });
  return id;
}

function restoreId(value) {
  const id = String(value || '').toLowerCase();
  if (!RESTORE_ID_RE.test(id)) throw new BackupServiceError('BACKUP_RESTORE_NOT_FOUND', 'Проверка восстановления не найдена.', { status: 404 });
  return id;
}

async function syncDirectory(directory) {
  try {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error?.code)) throw error;
  }
}

async function atomicWrite(target, bytes) {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
    await syncDirectory(path.dirname(target));
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
}

async function atomicWriteJson(target, value) {
  return atomicWrite(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, 'utf8'));
}

async function assertPlainDirectory(directory, code = 'BACKUP_DIRECTORY_UNSAFE') {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new BackupServiceError(code, 'Каталог резервных копий должен быть обычным локальным каталогом.', { status: 500 });
  }
  return stat;
}

async function walkRoot(repoRoot, definition) {
  const root = path.join(repoRoot, ...definition.path.split('/'));
  const answer = [];
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    if (error?.code === 'ENOENT') return answer;
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new BackupServiceError(
      'BACKUP_SOURCE_LINK_FORBIDDEN',
      'Корневой каталог content/media должен быть обычным каталогом, не symlink/junction.',
      { status: 409, details: { path: definition.path } }
    );
  }
  const [repoRealRoot, sourceRealRoot] = await Promise.all([
    fs.realpath(repoRoot),
    fs.realpath(root)
  ]);
  if (!contained(repoRealRoot, sourceRealRoot)) {
    throw new BackupServiceError('BACKUP_SOURCE_ESCAPE', 'Source root вышел за repository через symlink/junction.', {
      status: 409,
      details: { path: definition.path }
    });
  }
  async function visit(directory, relativeRoot) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relative = `${relativeRoot}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (!contained(root, absolute)) throw new BackupServiceError('BACKUP_SOURCE_ESCAPE', 'Source path вышел за разрешённый корень.', { status: 500 });
      if (entry.isSymbolicLink()) throw new BackupServiceError('BACKUP_SOURCE_LINK_FORBIDDEN', 'Symlink/junction в content/media запрещён.', { status: 409, details: { path: relative } });
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile() && (!definition.jsonOnly || entry.name.toLowerCase().endsWith('.json'))) answer.push(normalizeRelativePath(relative));
    }
  }
  await visit(root, definition.path);
  return answer;
}

async function enumerateSourceFiles(repoRoot) {
  const nested = await Promise.all(SOURCE_ROOTS.map((definition) => walkRoot(repoRoot, definition)));
  return nested.flat().sort((left, right) => left.localeCompare(right, 'en'));
}

async function gitHead(repoRoot) {
  try {
    const result = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, windowsHide: true, maxBuffer: 1024 * 1024 });
    const sha = String(result.stdout || '').trim().toLowerCase();
    return /^[a-f0-9]{40}$/u.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function manifestCore(manifest) {
  const { manifestSha256: omitted, ...core } = manifest;
  return core;
}

function validateManifest(value, expectedId = null) {
  if (!value || value.version !== 1 || value.kind !== 'smu1-full-backup' || !SNAPSHOT_ID_RE.test(String(value.snapshotId || ''))) {
    throw new BackupServiceError('BACKUP_MANIFEST_INVALID', 'Manifest резервной копии повреждён.', { status: 422 });
  }
  if (expectedId && value.snapshotId !== expectedId) throw new BackupServiceError('BACKUP_MANIFEST_ID_MISMATCH', 'Backup manifest относится к другому snapshot.', { status: 422 });
  if (!Array.isArray(value.files) || value.files.length > 100_000) throw new BackupServiceError('BACKUP_MANIFEST_INVALID', 'Список файлов backup повреждён.', { status: 422 });
  const seen = new Set();
  for (const item of value.files) {
    const relative = normalizeRelativePath(item?.path);
    if (!managedPath(relative) || seen.has(relative) || !SHA256_RE.test(String(item?.sha256 || '')) || !Number.isSafeInteger(item?.bytes) || item.bytes < 0) {
      throw new BackupServiceError('BACKUP_MANIFEST_INVALID', 'Manifest содержит небезопасную или дублирующую запись.', { status: 422, details: { path: relative } });
    }
    seen.add(relative);
  }
  if (!SHA256_RE.test(String(value.manifestSha256 || '')) || digest(manifestCore(value)) !== value.manifestSha256) {
    throw new BackupServiceError('BACKUP_MANIFEST_CHECKSUM_MISMATCH', 'Checksum manifest не совпадает.', { status: 422 });
  }
  return value;
}

export function createBackupService(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const backupRoot = path.resolve(options.backupRoot || path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-backups`));
  const runtimeDir = path.resolve(options.runtimeDir || path.join(repoRoot, '.admin-runtime', 'backup'));
  if (contained(repoRoot, backupRoot) || contained(backupRoot, repoRoot) || backupRoot === repoRoot) {
    throw new BackupServiceError('BACKUP_ROOT_NOT_SEPARATE', 'Backup directory должен быть отдельным от repository.', { status: 500 });
  }
  if (!contained(repoRoot, runtimeDir) || runtimeDir === repoRoot) {
    throw new BackupServiceError('BACKUP_RUNTIME_INVALID', 'Backup runtime должен находиться внутри repository runtime.', { status: 500 });
  }
  const retention = Number(options.retention || DEFAULT_RETENTION);
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  const minFreeBytes = Number(options.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES);
  if (!Number.isSafeInteger(retention) || retention < 2 || retention > 365
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 * 1024
    || !Number.isSafeInteger(minFreeBytes) || minFreeBytes < 0) {
    throw new BackupServiceError('BACKUP_CONFIG_INVALID', 'Некорректные retention/quota настройки.', { status: 500 });
  }
  const transactionService = options.transactionService || null;
  const now = options.now || (() => new Date());
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const snapshotsRoot = path.join(backupRoot, 'snapshots');
  const blobsRoot = path.join(backupRoot, 'blobs', 'sha256');
  const exportsRoot = path.join(backupRoot, 'exports');
  const statusPath = path.join(runtimeDir, 'status.json');
  const restoreRuntime = path.join(runtimeDir, 'restore-transactions');
  const restoreEngine = options.restoreEngine || createTransactionEngine({ repoRoot, runtimeDir: restoreRuntime, lockAcquireTimeoutMs: 5_000 });
  let initialized = false;
  let queue = Promise.resolve();
  let pending = 0;
  let lastManifest = null;
  let status = {
    version: 1,
    configured: true,
    backupRoot,
    pending: 0,
    lastAttempt: null,
    lastSuccess: null,
    lastError: null
  };
  const restorePreviews = new Map();

  function timestamp() {
    const value = now();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  async function persistStatus() {
    await atomicWriteJson(statusPath, status);
  }

  async function initialize() {
    if (initialized) return;
    await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
    await assertPlainDirectory(backupRoot);
    await Promise.all([
      fs.mkdir(snapshotsRoot, { recursive: true, mode: 0o700 }),
      fs.mkdir(blobsRoot, { recursive: true, mode: 0o700 }),
      fs.mkdir(exportsRoot, { recursive: true, mode: 0o700 }),
      fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 })
    ]);
    await Promise.all([assertPlainDirectory(snapshotsRoot), assertPlainDirectory(blobsRoot), assertPlainDirectory(exportsRoot), assertPlainDirectory(runtimeDir)]);
    await restoreEngine.initialize?.();
    try {
      const previous = await readJson(statusPath);
      status = { ...status, ...previous, configured: true, backupRoot, pending: 0 };
    } catch (error) {
      if (error?.code !== 'ENOENT') status.lastError = { code: 'BACKUP_STATUS_CORRUPT', message: 'Локальный status backup был повреждён и создан заново.', at: timestamp() };
    }
    const listed = await listInternal();
    if (listed.length) lastManifest = await loadManifest(listed[0].snapshotId);
    await persistStatus();
    initialized = true;
  }

  function blobPath(hash) {
    if (!SHA256_RE.test(hash)) throw new BackupServiceError('BACKUP_BLOB_ID_INVALID', 'Некорректный blob hash.', { status: 500 });
    const target = path.join(blobsRoot, hash.slice(0, 2), hash.slice(2));
    if (!contained(blobsRoot, target)) throw new BackupServiceError('BACKUP_BLOB_ESCAPE', 'Blob path вышел за backup root.', { status: 500 });
    return target;
  }

  function snapshotPath(id) {
    const target = path.join(snapshotsRoot, snapshotId(id));
    if (path.dirname(target) !== snapshotsRoot) throw new BackupServiceError('BACKUP_SNAPSHOT_ESCAPE', 'Snapshot path вышел за backup root.', { status: 500 });
    return target;
  }

  async function loadManifest(id) {
    const target = snapshotPath(id);
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new BackupServiceError('BACKUP_NOT_FOUND', 'Резервная копия не найдена.', { status: 404 });
    return validateManifest(await readJson(path.join(target, 'manifest.json')), id);
  }

  async function listInternal() {
    let entries;
    try { entries = await fs.readdir(snapshotsRoot, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    const manifests = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || !SNAPSHOT_ID_RE.test(entry.name)) {
        throw new BackupServiceError('BACKUP_LAYOUT_UNSAFE', 'В backup snapshots найден неизвестный объект.', { status: 500, details: { name: entry.name } });
      }
      const manifest = await loadManifest(entry.name);
      manifests.push({
        snapshotId: manifest.snapshotId,
        createdAt: manifest.createdAt,
        transactionId: manifest.transactionId,
        sourceSha: manifest.sourceSha,
        manifestSha256: manifest.manifestSha256,
        fileCount: manifest.fileCount,
        totalBytes: manifest.totalBytes,
        kind: manifest.backupKind
      });
    }
    return manifests.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  async function diskUsage() {
    let usedBytes = 0;
    async function visit(directory) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new BackupServiceError('BACKUP_LAYOUT_UNSAFE', 'Symlink в backup directory запрещён.', { status: 500 });
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else if (entry.isFile()) usedBytes += (await fs.stat(target)).size;
      }
    }
    await visit(backupRoot);
    let freeBytes = null;
    if (typeof fs.statfs === 'function') {
      const stats = await fs.statfs(backupRoot);
      freeBytes = Number(stats.bavail) * Number(stats.bsize);
    }
    return { usedBytes, freeBytes };
  }

  async function ensureBlob(source, hash, bytes, quotaState) {
    const target = blobPath(hash);
    const existing = await fs.lstat(target).catch(() => null);
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isFile() || existing.size !== bytes) throw new BackupServiceError('BACKUP_BLOB_CORRUPT', 'Content-addressed backup blob повреждён.', { status: 500, details: { hash } });
      return false;
    }
    if (quotaState.usedBytes + bytes > maxBytes) throw new BackupServiceError('BACKUP_QUOTA_EXCEEDED', 'Недостаточно выделенной квоты для резервной копии.', { status: 507, details: { maxBytes, usedBytes: quotaState.usedBytes, requestedBytes: bytes } });
    if (quotaState.freeBytes !== null && quotaState.freeBytes - bytes < minFreeBytes) throw new BackupServiceError('BACKUP_DISK_SPACE_LOW', 'Недостаточно свободного места для резервной копии.', { status: 507, details: { freeBytes: quotaState.freeBytes, minFreeBytes, requestedBytes: bytes } });
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const payload = await fs.readFile(source);
    if (payload.length !== bytes || sha256(payload) !== hash) throw new BackupServiceError('BACKUP_SOURCE_CHANGED', 'Файл изменился во время создания backup; операция будет повторена после следующего Save.', { status: 409 });
    await atomicWrite(target, payload);
    quotaState.usedBytes += bytes;
    if (quotaState.freeBytes !== null) quotaState.freeBytes -= bytes;
    return true;
  }

  async function scanAndStore() {
    const paths = await enumerateSourceFiles(repoRoot);
    const quotaState = await diskUsage();
    const previous = new Map((lastManifest?.files || []).map((item) => [item.path, item]));
    const files = [];
    let addedBlobBytes = 0;
    for (const relative of paths) {
      const source = path.join(repoRoot, ...relative.split('/'));
      if (!contained(repoRoot, source)) throw new BackupServiceError('BACKUP_SOURCE_ESCAPE', 'Source path вышел за repository.', { status: 500 });
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new BackupServiceError('BACKUP_SOURCE_LINK_FORBIDDEN', 'Backup читает только обычные файлы.', { status: 409, details: { path: relative } });
      let hash;
      const cached = previous.get(relative);
      if (cached && cached.bytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
        const blob = await fs.lstat(blobPath(cached.sha256)).catch(() => null);
        if (blob?.isFile() && !blob.isSymbolicLink() && blob.size === cached.bytes) hash = cached.sha256;
      }
      if (!hash) hash = sha256(await fs.readFile(source));
      if (await ensureBlob(source, hash, stat.size, quotaState)) addedBlobBytes += stat.size;
      files.push({ path: relative, sha256: hash, bytes: stat.size, mtimeMs: stat.mtimeMs });
    }
    return { files, addedBlobBytes };
  }

  async function assertSourceStable(files) {
    const currentPaths = await enumerateSourceFiles(repoRoot);
    const expectedPaths = files.map((item) => item.path);
    if (currentPaths.length !== expectedPaths.length
      || currentPaths.some((item, index) => item !== expectedPaths[index])) {
      throw new BackupServiceError('BACKUP_SOURCE_CHANGED', 'Состав файлов изменился во время backup. Следующее сохранение запустит новую копию.', { status: 409 });
    }
    for (const item of files) {
      const source = path.join(repoRoot, ...item.path.split('/'));
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== item.bytes || stat.mtimeMs !== item.mtimeMs) {
        throw new BackupServiceError('BACKUP_SOURCE_CHANGED', 'Файл изменился во время backup. Следующее сохранение запустит новую копию.', { status: 409, details: { path: item.path } });
      }
    }
  }

  async function referencedBlobs() {
    const references = new Set();
    for (const item of await listInternal()) {
      const manifest = await loadManifest(item.snapshotId);
      for (const file of manifest.files) references.add(file.sha256);
    }
    return references;
  }

  async function prune() {
    const snapshots = await listInternal();
    for (const item of snapshots.slice(retention)) {
      const target = snapshotPath(item.snapshotId);
      if (path.dirname(target) !== snapshotsRoot) throw new BackupServiceError('BACKUP_DELETE_UNSAFE', 'Небезопасная очистка backup остановлена.', { status: 500 });
      await fs.rm(target, { recursive: true, force: true });
    }
    const referenced = await referencedBlobs();
    const prefixes = await fs.readdir(blobsRoot, { withFileTypes: true });
    for (const prefix of prefixes) {
      if (prefix.isSymbolicLink() || !prefix.isDirectory() || !/^[a-f0-9]{2}$/u.test(prefix.name)) throw new BackupServiceError('BACKUP_LAYOUT_UNSAFE', 'Blob store содержит неизвестный объект.', { status: 500 });
      const directory = path.join(blobsRoot, prefix.name);
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const hash = `${prefix.name}${entry.name}`;
        if (entry.isSymbolicLink() || !entry.isFile() || !SHA256_RE.test(hash)) throw new BackupServiceError('BACKUP_LAYOUT_UNSAFE', 'Blob store содержит неизвестный объект.', { status: 500 });
        if (!referenced.has(hash)) await fs.unlink(path.join(directory, entry.name));
      }
    }
  }

  async function createSnapshot({ transactionId = null, backupKind = 'automatic' } = {}) {
    await initialize();
    const createdAt = timestamp();
    const compactTime = createdAt.replace(/[-:]/gu, '').replace(/\.\d{3}/u, '').toLowerCase();
    const id = `backup-${compactTime}-${String(randomUUID()).replace(/-/gu, '').slice(0, 12).toLowerCase()}`;
    if (!SNAPSHOT_ID_RE.test(id)) throw new BackupServiceError('BACKUP_ID_INVALID', 'Не удалось создать безопасный backup id.', { status: 500 });
    const build = async () => {
      const { files, addedBlobBytes } = await scanAndStore();
      if (transactionService?.withStableRead) {
        await transactionService.withStableRead(() => assertSourceStable(files));
      } else {
        await assertSourceStable(files);
      }
      const manifest = {
        version: 1,
        kind: 'smu1-full-backup',
        snapshotId: id,
        backupKind,
        createdAt,
        transactionId,
        sourceSha: await gitHead(repoRoot),
        schemaVersion: 'h6-content-v1',
        fileCount: files.length,
        totalBytes: files.reduce((sum, item) => sum + item.bytes, 0),
        addedBlobBytes,
        roots: SOURCE_ROOTS.map((item) => item.path),
        files
      };
      manifest.manifestSha256 = digest(manifest);
      const temporary = path.join(snapshotsRoot, `.creating-${crypto.randomUUID()}`);
      const destination = snapshotPath(id);
      await fs.mkdir(temporary, { mode: 0o700 });
      try {
        await atomicWriteJson(path.join(temporary, 'manifest.json'), manifest);
        await fs.rename(temporary, destination);
        await syncDirectory(snapshotsRoot);
      } finally {
        await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
      }
      lastManifest = manifest;
      await prune();
      return manifest;
    };
    return build();
  }

  function scheduleAfterSave({ transactionId } = {}) {
    pending += 1;
    status = { ...status, pending, lastAttempt: { transactionId: transactionId || null, status: 'queued', at: timestamp() } };
    void persistStatus().catch(() => {});
    const task = queue.then(async () => {
      status = { ...status, lastAttempt: { transactionId: transactionId || null, status: 'running', at: timestamp() } };
      await persistStatus();
      try {
        const manifest = await createSnapshot({ transactionId, backupKind: 'automatic' });
        status = {
          ...status,
          lastSuccess: {
            snapshotId: manifest.snapshotId,
            transactionId: manifest.transactionId,
            manifestSha256: manifest.manifestSha256,
            fileCount: manifest.fileCount,
            totalBytes: manifest.totalBytes,
            at: manifest.createdAt
          },
          lastAttempt: { transactionId: transactionId || null, status: 'success', at: timestamp() },
          lastError: null
        };
      } catch (error) {
        status = {
          ...status,
          lastAttempt: { transactionId: transactionId || null, status: 'failed', at: timestamp() },
          lastError: { code: error?.code || 'BACKUP_FAILED', message: String(error?.message || error), at: timestamp() }
        };
      } finally {
        pending = Math.max(0, pending - 1);
        status = { ...status, pending };
        await persistStatus().catch(() => {});
      }
    });
    queue = task.catch(() => {});
    return { queued: true, transactionId: transactionId || null };
  }

  async function statusReport() {
    await initialize();
    const usage = await diskUsage().catch(() => ({ usedBytes: null, freeBytes: null }));
    return clone({
      ...status,
      retention,
      maxBytes,
      minFreeBytes,
      usedBytes: usage.usedBytes,
      freeBytes: usage.freeBytes
    });
  }

  async function list() {
    await initialize();
    return { backups: await listInternal() };
  }

  async function verify(request = {}) {
    await initialize();
    const manifest = await loadManifest(request.snapshotId);
    const failures = [];
    for (const item of manifest.files) {
      const target = blobPath(item.sha256);
      const bytes = await fs.readFile(target).catch(() => null);
      if (!bytes || bytes.length !== item.bytes || sha256(bytes) !== item.sha256) failures.push({ path: item.path, code: 'BACKUP_BLOB_CHECKSUM_MISMATCH' });
    }
    return {
      snapshotId: manifest.snapshotId,
      ok: failures.length === 0,
      manifestSha256: manifest.manifestSha256,
      checkedFiles: manifest.files.length,
      failures
    };
  }

  async function exportPortable(request = {}) {
    await initialize();
    const manifest = await loadManifest(request.snapshotId);
    const verified = await verify({ snapshotId: manifest.snapshotId });
    if (!verified.ok) throw new BackupServiceError('BACKUP_VERIFY_FAILED', 'Нельзя экспортировать повреждённую резервную копию.', { status: 422, details: verified });
    const destination = path.join(exportsRoot, manifest.snapshotId);
    if (!contained(exportsRoot, destination)) throw new BackupServiceError('BACKUP_EXPORT_ESCAPE', 'Export path вышел за backup root.', { status: 500 });
    const existing = await fs.lstat(destination).catch(() => null);
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new BackupServiceError('BACKUP_EXPORT_UNSAFE', 'Export path небезопасен.', { status: 500 });
      return { snapshotId: manifest.snapshotId, exportPath: destination, reused: true, manifestSha256: manifest.manifestSha256 };
    }
    const temporary = path.join(exportsRoot, `.creating-${crypto.randomUUID()}`);
    await fs.mkdir(path.join(temporary, 'files'), { recursive: true, mode: 0o700 });
    try {
      for (const item of manifest.files) {
        const target = path.join(temporary, 'files', ...item.path.split('/'));
        if (!contained(path.join(temporary, 'files'), target)) throw new BackupServiceError('BACKUP_EXPORT_ESCAPE', 'Export file path вышел за root.', { status: 500 });
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const source = blobPath(item.sha256);
        // Portable exports must not share writable inodes with the deduplicated
        // blob store. A hard link would let editing the export corrupt every
        // snapshot that references that content-addressed blob.
        await fs.copyFile(source, target);
      }
      await atomicWriteJson(path.join(temporary, 'manifest.json'), manifest);
      await atomicWriteJson(path.join(temporary, 'RESTORE.json'), {
        version: 1,
        kind: 'smu1-portable-backup',
        snapshotId: manifest.snapshotId,
        manifestSha256: manifest.manifestSha256,
        instruction: 'Скопируйте весь каталог и используйте мастер восстановления СМУ-1.'
      });
      await fs.rename(temporary, destination);
      await syncDirectory(exportsRoot);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
    return { snapshotId: manifest.snapshotId, exportPath: destination, reused: false, manifestSha256: manifest.manifestSha256 };
  }

  async function currentStateDigest(paths) {
    const entries = [];
    for (const relative of paths) {
      const target = path.join(repoRoot, ...relative.split('/'));
      let bytes = null;
      try {
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new BackupServiceError('BACKUP_RESTORE_TARGET_UNSAFE', 'Restore target небезопасен.', { status: 409, details: { path: relative } });
        bytes = await fs.readFile(target);
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      entries.push({ path: relative, revision: revisionForBytes(bytes) });
    }
    return { entries, digest: digest(entries) };
  }

  async function previewRestore(request = {}) {
    await initialize();
    const manifest = await loadManifest(request.snapshotId);
    const verified = await verify({ snapshotId: manifest.snapshotId });
    if (!verified.ok) throw new BackupServiceError('BACKUP_VERIFY_FAILED', 'Восстановление заблокировано: backup повреждён.', { status: 422, details: verified });
    const currentPaths = await enumerateSourceFiles(repoRoot);
    const allPaths = [...new Set([...currentPaths, ...manifest.files.map((item) => item.path)])].sort();
    const current = await currentStateDigest(allPaths);
    const byPath = new Map(current.entries.map((item) => [item.path, item.revision]));
    const backupByPath = new Map(manifest.files.map((item) => [item.path, item]));
    const changes = [];
    for (const relative of allPaths) {
      const item = backupByPath.get(relative);
      const nextRevision = item ? `sha256:${item.sha256}:${item.bytes}` : 'missing';
      const beforeRevision = byPath.get(relative) || 'missing';
      if (beforeRevision !== nextRevision) changes.push({ path: relative, action: item ? (beforeRevision === 'missing' ? 'create' : 'replace') : 'delete', beforeRevision, nextRevision });
    }
    const id = `restore-${String(randomUUID()).replace(/-/gu, '').toLowerCase()}`;
    if (!RESTORE_ID_RE.test(id)) throw new BackupServiceError('BACKUP_RESTORE_ID_INVALID', 'Некорректный restore id.', { status: 500 });
    const preview = {
      restoreId: id,
      snapshotId: manifest.snapshotId,
      manifestSha256: manifest.manifestSha256,
      ownerKey: ownerKey(request),
      currentDigest: current.digest,
      allPaths,
      changes,
      createdAt: Date.now(),
      expiresAt: Date.now() + RESTORE_PREVIEW_TTL_MS
    };
    restorePreviews.set(id, preview);
    return clone({
      restoreId: id,
      snapshotId: manifest.snapshotId,
      manifestSha256: manifest.manifestSha256,
      canApply: true,
      changeCount: changes.length,
      changes,
      expiresAt: new Date(preview.expiresAt).toISOString()
    });
  }

  async function applyRestore(request = {}) {
    await initialize();
    const id = restoreId(request.restoreId);
    const preview = restorePreviews.get(id);
    if (!preview || preview.ownerKey !== ownerKey(request) || preview.expiresAt <= Date.now()) {
      restorePreviews.delete(id);
      throw new BackupServiceError('BACKUP_RESTORE_NOT_FOUND', 'Проверка восстановления устарела или принадлежит другой сессии.', { status: 404 });
    }
    const manifest = await loadManifest(preview.snapshotId);
    if (manifest.manifestSha256 !== preview.manifestSha256) throw new BackupServiceError('BACKUP_RESTORE_MANIFEST_CHANGED', 'Backup изменился после dry-run.', { status: 409 });
    const execute = async () => {
      const current = await currentStateDigest(preview.allPaths);
      if (current.digest !== preview.currentDigest) throw new BackupServiceError('BACKUP_RESTORE_CONFLICT', 'Файлы изменились после dry-run. Запустите проверку восстановления заново.', { status: 409 });
      const byCurrent = new Map(current.entries.map((item) => [item.path, item.revision]));
      const backupByPath = new Map(manifest.files.map((item) => [item.path, item]));
      const mutations = [];
      for (const change of preview.changes) {
        const item = backupByPath.get(change.path);
        mutations.push(item
          ? {
              path: change.path,
              operation: 'write',
              bytes: await fs.readFile(blobPath(item.sha256)),
              expectedRevision: byCurrent.get(change.path) || 'missing'
            }
          : { path: change.path, operation: 'delete', expectedRevision: byCurrent.get(change.path) || 'missing' });
      }
      if (!mutations.length) return { state: 'no-op', transactionId: null };
      const recoveryClientId = String(request.recoveryClientId);
      const idempotencyKey = String(request.idempotencyKey || `backup-${id}`);
      const owner = `backup-restore:${preview.ownerKey}`;
      const prepared = await restoreEngine.preview({
        owner,
        recoveryClientId,
        idempotencyKey,
        mutations,
        metadata: {
          userSummary: `Восстановление резервной копии ${manifest.snapshotId}`,
          backupSnapshotId: manifest.snapshotId,
          backupManifestSha256: manifest.manifestSha256,
          restoreKind: 'new-transaction'
        }
      });
      const applied = prepared.state === 'no-op' ? prepared : await restoreEngine.apply({
        owner,
        recoveryClientId,
        idempotencyKey,
        transactionId: prepared.transactionId,
        payloadHash: prepared.payloadHash
      });
      await atomicWriteJson(path.join(runtimeDir, `receipt-${id}.json`), {
        version: 1,
        kind: 'smu1-backup-restore-receipt',
        restoreId: id,
        snapshotId: manifest.snapshotId,
        manifestSha256: manifest.manifestSha256,
        transactionId: applied.transactionId || null,
        state: applied.state,
        restoredAt: timestamp(),
        changedPaths: preview.changes.map((item) => item.path)
      });
      return applied;
    };
    const applied = transactionService?.withStableRead ? await transactionService.withStableRead(execute) : await execute();
    restorePreviews.delete(id);
    return clone({
      result: applied.state === 'committed' || applied.state === 'no-op' ? 'success' : applied.state,
      state: applied.state,
      transactionId: applied.transactionId || null,
      snapshotId: manifest.snapshotId,
      manifestSha256: manifest.manifestSha256,
      restoredPaths: preview.changes.map((item) => item.path)
    });
  }

  async function createManual() {
    const manifest = await createSnapshot({ backupKind: 'manual-export' });
    return exportPortable({ snapshotId: manifest.snapshotId });
  }

  async function close() {
    await queue.catch(() => {});
  }

  return Object.freeze({
    initialize,
    scheduleAfterSave,
    createSnapshot,
    createManual,
    status: statusReport,
    list,
    verify,
    exportPortable,
    previewRestore,
    applyRestore,
    close,
    backupRoot,
    runtimeDir
  });
}

export const backupContract = Object.freeze({
  version: 1,
  managedRoots: SOURCE_ROOTS.map((item) => item.path),
  defaultRetention: DEFAULT_RETENTION
});

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createSafeNodeChildEnvironment } from './runtime-identity.mjs';
import { exactRouteManifestSha256 } from './exact-prerender-integration.mjs';

const execFileAsync = promisify(execFile);
const RUN_ID_RE = /^exact-[a-f0-9]{32}$/u;
const TRANSACTION_ID_RE = /^[a-z0-9][a-z0-9-]{2,127}$/iu;
const SHA_RE = /^[a-f0-9]{40}$/u;
const TERMINAL = new Set(['passed', 'failed', 'stale', 'superseded']);
const EDITABLE_ROOTS = Object.freeze([
  'src/content/',
  'src/data/',
  'public/uploads/',
  'public/assets/brand/',
  'public/assets/images/',
  'public/assets/video/',
  'public/brand/',
  'public/icons/',
  'public/images/',
  'public/video/'
]);
const IGNORED_DIRTY_ROOTS = Object.freeze(['.admin-runtime/', '.astro/', 'dist/', 'node_modules/', 'public/_media/h5/']);
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

// These lists are part of the release identity contract. Keep them explicit:
// silently dropping a renamed schema, binding or media implementation file
// would let an old exact result appear valid for different renderer behavior.
export const EXACT_CONTENT_SCHEMA_PATHS = Object.freeze([
  'src/content.config.ts',
  'src/content-schemas.mjs',
  'tools/admin-api/content-registry.mjs',
  'tools/admin-api/content-validation.mjs',
  'tools/admin-api/url-policy.mjs'
]);

export const EXACT_BINDING_REGISTRY_PATHS = Object.freeze([
  'src/admin/bindings/adminBinding.ts',
  'src/admin/metadata/content-completeness.mjs',
  'src/admin/metadata/content-coverage-registry.mjs',
  'src/admin/metadata/editor-fields.mjs'
]);

export const EXACT_H5_PIPELINE_PATHS = Object.freeze([
  'package.json',
  'package-lock.json',
  'astro.config.mjs',
  'tools/admin-api/exact-prerender-integration.mjs',
  'tools/performance/prepare-media.mjs',
  'tools/performance/deploy-media-reachability.mjs',
  'tools/performance/qa-performance.mjs',
  'src/utils/v2ResponsiveMedia.ts',
  'src/components/v2/mediaRoleAdapter.ts',
  'src/components/v2/V2ResponsiveImage.astro',
  'src/components/v2/V2ProductGallery.astro',
  'src/components/v2/projects/V2ProjectGallery.astro'
]);

export class ExactValidationError extends Error {
  constructor(code, message, { status = 400, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ExactValidationError';
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
    throw new ExactValidationError('EXACT_PATH_INVALID', 'Snapshot содержит небезопасный путь.', {
      status: 500,
      details: { path: String(value || '') }
    });
  }
  return normalized;
}

function editablePath(value) {
  const normalized = normalizeRelativePath(value);
  return EDITABLE_ROOTS.some((root) => normalized.startsWith(root));
}

function ignoredDirtyPath(value) {
  const normalized = normalizeRelativePath(value);
  return IGNORED_DIRTY_ROOTS.some((root) => normalized.startsWith(root));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function exactBuildBasePath(value) {
  const raw = String(value || '/').trim();
  if (!raw || raw === '/') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('?') || raw.includes('#')
    || raw.split('/').some((segment) => segment === '.' || segment === '..')
    || !/^\/(?:[A-Za-z0-9._~-]+\/?)+$/u.test(raw)) {
    throw new ExactValidationError('EXACT_BASE_PATH_INVALID', 'Exact build получил небезопасный BASE_PATH.', { status: 500 });
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function exactBuildTestSiteUrl(value) {
  const raw = String(value || 'http://127.0.0.1').trim();
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('unsafe');
    return parsed.origin;
  } catch {
    throw new ExactValidationError('EXACT_TEST_SITE_URL_INVALID', 'Exact build получил небезопасный TEST_SITE_URL.', { status: 500 });
  }
}

function digest(value) {
  return sha256(Buffer.from(JSON.stringify(value), 'utf8'));
}

function ownerKey(request = {}) {
  const owner = String(request.owner || '').trim();
  const recovery = String(request.recoveryClientId || '').trim();
  if (!owner || !recovery) {
    throw new ExactValidationError('EXACT_OWNERSHIP_REQUIRED', 'Для exact-проверки нужна локальная сессия и recovery id.', { status: 401 });
  }
  return sha256(Buffer.from(`smu1-exact\0${owner}\0${recovery}`, 'utf8'));
}

function safeTransactionId(value) {
  const transactionId = String(value || '');
  if (!TRANSACTION_ID_RE.test(transactionId)) {
    throw new ExactValidationError('EXACT_TRANSACTION_ID_INVALID', 'Некорректный идентификатор сохранения.');
  }
  return transactionId;
}

function safeRunId(value) {
  const runId = String(value || '').toLowerCase();
  if (!RUN_ID_RE.test(runId)) throw new ExactValidationError('EXACT_RUN_NOT_FOUND', 'Exact-проверка не найдена.', { status: 404 });
  return runId;
}

function publicRun(run) {
  if (!run) return null;
  return clone({
    runId: run.runId,
    transactionId: run.transactionId,
    revision: run.revision,
    sourceSha: run.sourceSha,
    schemaHash: run.schemaHash,
    bindingRegistryHash: run.bindingRegistryHash,
    h5PipelineHash: run.h5PipelineHash,
    snapshotSha256: run.snapshotSha256,
    status: run.status,
    current: run.current === true,
    publishEligible: run.status === 'passed' && run.current === true,
    message: run.message,
    requestSequence: run.requestSequence,
    affectedRoutes: run.affectedRoutes || [],
    routeExpectations: run.routeExpectations || [],
    closureTransactionIds: run.closureTransactionIds || [],
    artifact: run.artifact || null,
    diagnostics: run.diagnostics || null,
    requestedAt: run.requestedAt,
    startedAt: run.startedAt || null,
    finishedAt: run.finishedAt || null,
    supersededBy: run.supersededBy || null
  });
}

async function syncDirectory(directory) {
  try {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error?.code)) throw error;
  }
}

export async function renameAtomicWithTransientRetry(source, target, options = {}) {
  const renameFile = options.rename || fs.rename.bind(fs);
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const delays = options.delays || [20, 50, 100, 200, 400, 800];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(source, target);
      return;
    } catch (error) {
      const transient = ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code);
      if (!transient || attempt >= delays.length) throw error;
      await wait(delays[attempt]);
    }
  }
}

function assertSnapshotBlobStat(stat, expectedBytes) {
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size !== expectedBytes) {
    throw new ExactValidationError('EXACT_SNAPSHOT_BLOB_CORRUPT', 'Content-addressed snapshot blob повреждён.', { status: 500 });
  }
}

async function optionalLstat(target, lstatFile) {
  try {
    return await lstatFile(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function installSnapshotBlobAtomically(temporary, destination, expectedBytes, options = {}) {
  const lstatFile = options.lstat || fs.lstat.bind(fs);
  const unlinkFile = options.unlink || fs.unlink.bind(fs);
  let collision = false;
  try {
    await renameAtomicWithTransientRetry(temporary, destination, options);
  } catch (error) {
    const collisionCode = error?.code === 'EEXIST';
    const possibleWindowsCollision = ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code);
    if (!collisionCode && !possibleWindowsCollision) throw error;
    const competing = await optionalLstat(destination, lstatFile);
    if (!competing) throw error;
    assertSnapshotBlobStat(competing, expectedBytes);
    collision = true;
  }

  const written = await optionalLstat(destination, lstatFile);
  assertSnapshotBlobStat(written, expectedBytes);
  if (collision) {
    await unlinkFile(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
  return { deduplicated: collision };
}

async function atomicWriteJson(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await renameAtomicWithTransientRetry(temporary, target);
    await syncDirectory(path.dirname(target));
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
}

async function runGit(repoRoot, args) {
  const result = await execFileAsync('git', args, {
    cwd: repoRoot,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '', 'utf8');
}

function nulPaths(bytes) {
  return bytes.toString('utf8').split('\0').filter(Boolean).map((item) => normalizeRelativePath(item));
}

async function readOptionalFile(filePath) {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new ExactValidationError('EXACT_SOURCE_PATH_UNSAFE', 'Snapshot может читать только обычные файлы.', {
        status: 500,
        details: { path: filePath }
      });
    }
    return await fs.readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function hashFiles(repoRoot, paths, identityKind) {
  const entries = [];
  for (const relativePath of paths) {
    const bytes = await readOptionalFile(path.join(repoRoot, ...relativePath.split('/')));
    if (bytes === null) {
      throw new ExactValidationError(
        'EXACT_IDENTITY_INPUT_MISSING',
        `Не найден обязательный файл ${identityKind} identity. Exact-проверка остановлена.`,
        { status: 500, details: { identityKind, path: relativePath } }
      );
    }
    entries.push({ path: relativePath, sha256: sha256(bytes), bytes: bytes.length });
  }
  return digest(entries);
}

export async function proveExactRunIdentity({ repoRoot, run }) {
  try {
    const sourceSha = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).toString('utf8').trim().toLowerCase();
    const tracked = nulPaths(await runGit(repoRoot, ['diff', '--name-only', '-z', 'HEAD', '--', '.']));
    const untracked = nulPaths(await runGit(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.']));
    const dirty = [...new Set([...tracked, ...untracked])].sort();
    const unsafeDirty = dirty.filter((item) => !editablePath(item) && !ignoredDirtyPath(item));
    const files = [];
    for (const relativePath of dirty.filter((item) => editablePath(item))) {
      const bytes = await readOptionalFile(path.join(repoRoot, ...relativePath.split('/')));
      files.push(bytes === null
        ? { path: relativePath, operation: 'delete', sha256: 'missing', bytes: 0 }
        : { path: relativePath, operation: 'write', sha256: sha256(bytes), bytes: bytes.length });
    }
    files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    const expectedFiles = (run?.snapshot?.files || []).map(({ path: filePath, operation, sha256: hash, bytes }) => ({
      path: filePath, operation, sha256: hash, bytes
    })).sort((left, right) => left.path.localeCompare(right.path, 'en'));
    const [schemaHash, bindingRegistryHash, h5PipelineHash] = await Promise.all([
      hashFiles(repoRoot, EXACT_CONTENT_SCHEMA_PATHS, 'content-schema'),
      hashFiles(repoRoot, EXACT_BINDING_REGISTRY_PATHS, 'binding-registry'),
      hashFiles(repoRoot, EXACT_H5_PIPELINE_PATHS, 'h5-pipeline')
    ]);
    const reasons = [];
    if (sourceSha !== run?.sourceSha) reasons.push('source-sha');
    if (unsafeDirty.length) reasons.push('unsafe-source-dirty');
    if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) reasons.push('snapshot-files');
    if (schemaHash !== run?.schemaHash) reasons.push('schema-hash');
    if (bindingRegistryHash !== run?.bindingRegistryHash) reasons.push('binding-registry-hash');
    if (h5PipelineHash !== run?.h5PipelineHash) reasons.push('h5-pipeline-hash');
    return { ok: reasons.length === 0, checkedAt: new Date().toISOString(), reasons, sourceSha, unsafeDirty };
  } catch (error) {
    return { ok: false, checkedAt: new Date().toISOString(), reasons: ['identity-read-failed'], error: safeOutput(error?.message || error) };
  }
}

/**
 * Capture only editable working-tree deltas. The immutable Git source SHA is
 * materialized later as a detached worktree, then these exact bytes are overlaid.
 */
export async function createExactSnapshot({ repoRoot, runtimeDir, runId, transaction }) {
  const sourceSha = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).toString('utf8').trim().toLowerCase();
  if (!SHA_RE.test(sourceSha)) throw new ExactValidationError('EXACT_SOURCE_SHA_INVALID', 'Не удалось определить source SHA.', { status: 500 });

  const tracked = nulPaths(await runGit(repoRoot, ['diff', '--name-only', '-z', 'HEAD', '--', '.']));
  const untracked = nulPaths(await runGit(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.']));
  const dirty = [...new Set([...tracked, ...untracked])].sort();
  const unsafeDirty = dirty.filter((item) => !editablePath(item) && !ignoredDirtyPath(item));
  if (unsafeDirty.length) {
    throw new ExactValidationError(
      'EXACT_SOURCE_DIRTY',
      'Исходный код редактора изменён вне content/media. Зафиксируйте H6 source commit перед exact-проверкой.',
      { status: 409, details: { paths: unsafeDirty.slice(0, 100), total: unsafeDirty.length } }
    );
  }
  const editable = dirty.filter((item) => editablePath(item));
  const snapshotRoot = path.join(runtimeDir, 'snapshots', runId);
  const blobRoot = path.join(runtimeDir, 'blobs', 'sha256');
  if (!contained(runtimeDir, snapshotRoot)) throw new ExactValidationError('EXACT_RUNTIME_ESCAPE', 'Snapshot path вышел за runtime.', { status: 500 });
  await fs.mkdir(blobRoot, { recursive: true, mode: 0o700 });
  await fs.mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
  const files = [];
  for (const relativePath of editable) {
    const source = path.join(repoRoot, ...relativePath.split('/'));
    const bytes = await readOptionalFile(source);
    if (bytes === null) {
      files.push({ path: relativePath, operation: 'delete', sha256: 'missing', bytes: 0 });
      continue;
    }
    const hash = sha256(bytes);
    const destination = path.join(blobRoot, hash.slice(0, 2), hash.slice(2));
    if (!contained(blobRoot, destination)) throw new ExactValidationError('EXACT_PAYLOAD_ESCAPE', 'Snapshot payload вышел за runtime.', { status: 500 });
    const existing = await fs.lstat(destination).catch(() => null);
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isFile() || existing.size !== bytes.length) {
        throw new ExactValidationError('EXACT_SNAPSHOT_BLOB_CORRUPT', 'Content-addressed snapshot blob повреждён.', { status: 500 });
      }
    } else {
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await installSnapshotBlobAtomically(temporary, destination, bytes.length);
    }
    files.push({ path: relativePath, operation: 'write', sha256: hash, bytes: bytes.length });
  }
  const schemaHash = await hashFiles(repoRoot, EXACT_CONTENT_SCHEMA_PATHS, 'content-schema');
  const bindingRegistryHash = await hashFiles(repoRoot, EXACT_BINDING_REGISTRY_PATHS, 'binding-registry');
  const h5PipelineHash = await hashFiles(repoRoot, EXACT_H5_PIPELINE_PATHS, 'h5-pipeline');
  const manifest = {
    version: 1,
    kind: 'smu1-exact-snapshot',
    runId,
    transactionId: transaction.transactionId,
    sourceSha,
    schemaHash,
    bindingRegistryHash,
    h5PipelineHash,
    affectedRoutes: clone(transaction.metadata?.affectedRoutes || []),
    routeExpectations: clone(transaction.metadata?.routeExpectations || []),
    closureTransactionIds: clone(transaction.metadata?.exactClosureTransactionIds || [transaction.transactionId]),
    files
  };
  manifest.snapshotSha256 = digest(manifest);
  await atomicWriteJson(path.join(snapshotRoot, 'manifest.json'), manifest);
  return { ...manifest, snapshotRoot };
}

export function transactionWithCumulativeExactClosure(transaction, priorRun) {
  const current = clone(transaction);
  const byRoute = new Map();
  const transactionIds = [];
  const add = (expectations, ids) => {
    for (const transactionId of Array.isArray(ids) ? ids : [ids]) {
      if (transactionId && !transactionIds.includes(transactionId)) transactionIds.push(transactionId);
    }
    for (const item of Array.isArray(expectations) ? expectations : []) {
      if (item && typeof item.route === 'string' && ['html', 'not-found'].includes(item.expected)) {
        byRoute.set(item.route, item.expected);
      }
    }
  };
  if (priorRun && priorRun.status !== 'passed') {
    add(priorRun.routeExpectations, priorRun.closureTransactionIds || [priorRun.transactionId]);
  }
  add(current.metadata?.routeExpectations, current.transactionId);
  const routeExpectations = [...byRoute].sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([route, expected]) => ({ route, expected }));
  current.metadata = {
    ...(current.metadata || {}),
    affectedRoutes: routeExpectations.map((item) => item.route),
    routeExpectations,
    exactClosureTransactionIds: transactionIds
  };
  return current;
}

function routeArtifactPath(distRoot, route, expected = 'html') {
  const normalized = String(route || '/').split(/[?#]/u, 1)[0];
  if (expected === 'not-found' || normalized === '/404.html') return path.join(distRoot, '404.html');
  if (normalized === '/') return path.join(distRoot, 'index.html');
  const clean = normalized.replace(/^\/+|\/+$/gu, '');
  return path.extname(clean) ? path.join(distRoot, ...clean.split('/')) : path.join(distRoot, ...clean.split('/'), 'index.html');
}

async function artifactEvidence(distRoot) {
  const files = [];
  async function visit(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new ExactValidationError('EXACT_ARTIFACT_SYMLINK', 'Build artifact содержит symlink.', { status: 422 });
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(absolute);
        files.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length });
      }
    }
  }
  await visit(distRoot);
  const totalBytes = files.reduce((sum, item) => sum + item.bytes, 0);
  const largest = [...files].sort((left, right) => right.bytes - left.bytes)[0] || null;
  return {
    manifestSha256: digest(files),
    fileCount: files.length,
    totalBytes,
    largestFile: largest
  };
}

export async function hydrateExactMediaCache({ sourceRoot, destinationRoot, maxFiles = 20_000, maxBytes = 2 * 1024 * 1024 * 1024 }) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  if (source === destination || contained(source, destination) || contained(destination, source)) {
    throw new ExactValidationError('EXACT_MEDIA_CACHE_PATH_INVALID', 'Media cache source и exact workspace должны быть раздельными.', { status: 500 });
  }
  const rootStat = await fs.lstat(source).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!rootStat) return { available: false, files: 0, bytes: 0, hardlinked: 0, copied: 0 };
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ExactValidationError('EXACT_MEDIA_CACHE_UNSAFE', 'Media cache должен быть обычным каталогом без symlink.', { status: 500 });
  }
  await fs.mkdir(destination, { recursive: true });
  const destinationStat = await fs.lstat(destination);
  if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
    throw new ExactValidationError('EXACT_MEDIA_CACHE_UNSAFE', 'Exact media cache destination должен быть обычным каталогом.', { status: 500 });
  }
  const evidence = { available: true, files: 0, bytes: 0, hardlinked: 0, copied: 0 };
  async function visit(directory, relative = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const from = path.join(source, ...relativePath.split('/'));
      const to = path.join(destination, ...relativePath.split('/'));
      if (!contained(source, from) || !contained(destination, to) || entry.isSymbolicLink()) {
        throw new ExactValidationError('EXACT_MEDIA_CACHE_ESCAPE', 'Media cache содержит небезопасный путь.', { status: 500, details: { path: relativePath } });
      }
      if (entry.isDirectory()) {
        await fs.mkdir(to, { recursive: true });
        await visit(from, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new ExactValidationError('EXACT_MEDIA_CACHE_UNSAFE', 'Media cache содержит не обычный файл.', { status: 500, details: { path: relativePath } });
      }
      const stat = await fs.lstat(from);
      evidence.files += 1;
      evidence.bytes += stat.size;
      if (evidence.files > maxFiles || evidence.bytes > maxBytes) {
        throw new ExactValidationError('EXACT_MEDIA_CACHE_LIMIT', 'Media cache превышает безопасный лимит exact hydration.', { status: 500 });
      }
      await fs.mkdir(path.dirname(to), { recursive: true });
      try {
        await fs.link(from, to);
        evidence.hardlinked += 1;
      } catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
        await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
        evidence.copied += 1;
      }
    }
  }
  await visit(source);
  return evidence;
}

export async function prepareExactDependencies({ sourceRoot, destinationRoot, platform = process.platform }) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  const sourceStat = await fs.lstat(source).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!sourceStat || !sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new ExactValidationError(
      'EXACT_DEPENDENCIES_UNSAFE',
      'Exact build требует установленный обычный каталог node_modules.',
      { status: 500 }
    );
  }
  if (platform === 'win32') {
    const hydrated = await hydrateExactMediaCache({
      sourceRoot: source,
      destinationRoot: destination,
      maxFiles: 200_000,
      maxBytes: 4 * 1024 * 1024 * 1024
    });
    return { ...hydrated, mode: 'hardlink-copy-tree' };
  }
  await fs.symlink(source, destination, 'dir');
  return { available: true, mode: 'directory-symlink', files: null, bytes: null, hardlinked: null, copied: null };
}

function safeOutput(value) {
  return String(value || '')
    .replace(/github_pat_[A-Za-z0-9_]+/gu, '[secret]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/gu, '[secret]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, 'Bearer [secret]')
    .slice(-20_000);
}

function trustedNpmCliPath(value, pathApi = path) {
  const raw = String(value || '').trim();
  if (!raw || !pathApi.isAbsolute(raw)) return null;
  const normalized = pathApi.normalize(raw).replace(/\\/gu, '/').toLowerCase();
  return normalized.endsWith('/node_modules/npm/bin/npm-cli.js') ? pathApi.normalize(raw) : null;
}

/**
 * Node 24 no longer executes `.cmd` files through execFile on Windows. Invoke
 * npm's JavaScript entrypoint with the already-running Node binary instead of
 * enabling a shell for an exact-build command.
 */
export function exactBuildInvocation(options = {}) {
  const platform = String(options.platform || process.platform);
  if (platform !== 'win32') {
    return Object.freeze({ command: 'npm', args: Object.freeze(['run', 'build:exact']) });
  }
  const pathApi = path.win32;
  const nodeExecutable = pathApi.resolve(String(options.nodeExecutable || process.execPath));
  const environment = options.environment || process.env;
  const npmCli = trustedNpmCliPath(environment.npm_execpath, pathApi)
    || pathApi.join(pathApi.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return Object.freeze({
    command: nodeExecutable,
    args: Object.freeze([npmCli, 'run', 'build:exact'])
  });
}

export async function runExactSnapshot({ repoRoot, snapshot, environment = process.env, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const workspace = path.join(snapshot.snapshotRoot, 'workspace');
  const nodeModules = path.join(workspace, 'node_modules');
  if (!contained(snapshot.snapshotRoot, workspace)) throw new ExactValidationError('EXACT_WORKSPACE_ESCAPE', 'Exact workspace вышел за snapshot.', { status: 500 });
  let worktreeAdded = false;
  let dependencyLinkInstalled = false;
  try {
    await execFileAsync('git', ['worktree', 'add', '--detach', workspace, snapshot.sourceSha], {
      cwd: repoRoot, windowsHide: true, timeout: 120_000, maxBuffer: 10 * 1024 * 1024
    });
    worktreeAdded = true;
    for (const item of snapshot.files) {
      const destination = path.join(workspace, ...item.path.split('/'));
      if (!contained(workspace, destination)) throw new ExactValidationError('EXACT_OVERLAY_ESCAPE', 'Snapshot overlay вышел за workspace.', { status: 500 });
      if (item.operation === 'delete') {
        await fs.unlink(destination).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
        continue;
      }
      const runtimeRoot = path.resolve(snapshot.snapshotRoot, '..', '..');
      const source = path.join(runtimeRoot, 'blobs', 'sha256', item.sha256.slice(0, 2), item.sha256.slice(2));
      if (!contained(path.join(runtimeRoot, 'blobs', 'sha256'), source)) {
        throw new ExactValidationError('EXACT_PAYLOAD_ESCAPE', 'Snapshot blob вышел за runtime.', { status: 500 });
      }
      const bytes = await readOptionalFile(source);
      if (!bytes || sha256(bytes) !== item.sha256 || bytes.length !== item.bytes) {
        throw new ExactValidationError('EXACT_SNAPSHOT_CORRUPT', 'Immutable snapshot повреждён.', { status: 500, details: { path: item.path } });
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes);
    }
    const dependencies = await prepareExactDependencies({
      sourceRoot: path.join(repoRoot, 'node_modules'),
      destinationRoot: nodeModules
    });
    dependencyLinkInstalled = dependencies.mode === 'directory-symlink';
    const mediaCache = await hydrateExactMediaCache({
      sourceRoot: path.join(repoRoot, 'public', '_media', 'h5'),
      destinationRoot: path.join(workspace, 'public', '_media', 'h5')
    });
    const expectations = snapshot.routeExpectations.length
      ? snapshot.routeExpectations
      : snapshot.affectedRoutes.map((route) => ({ route, expected: 'html' }));
    if (!expectations.length) {
      throw new ExactValidationError('EXACT_ROUTE_CLOSURE_MISSING', 'Exact-проверка требует server-derived closure затронутых маршрутов.', { status: 422 });
    }
    const exactRouteManifest = path.join(workspace, '.smu1-exact-route-closure.json');
    const exactRouteManifestValue = {
      version: 1,
      kind: 'smu1-exact-route-closure',
      runId: snapshot.runId,
      transactionId: snapshot.transactionId,
      expectations
    };
    const exactRouteManifestHash = exactRouteManifestSha256(exactRouteManifestValue);
    await atomicWriteJson(exactRouteManifest, exactRouteManifestValue);
    const npm = exactBuildInvocation({ environment });
    const exactBasePath = exactBuildBasePath(environment.BASE_PATH || environment.TEST_BASE_PATH || '/');
    const exactTestSiteUrl = exactBuildTestSiteUrl(environment.TEST_SITE_URL || 'http://127.0.0.1');
    const exactCi = String(environment.CI || '').toLowerCase() === 'true' ? 'true' : 'false';
    const result = await execFileAsync(npm.command, [...npm.args], {
      cwd: workspace,
      windowsHide: true,
      timeout: Number(timeoutMs) || DEFAULT_TIMEOUT_MS,
      maxBuffer: 24 * 1024 * 1024,
      env: {
        ...createSafeNodeChildEnvironment(environment),
        NODE_ENV: 'production',
        DEPLOY_TARGET: 'test',
        PRODUCTION_DEPLOY_ENABLED: 'false',
        REQUIRE_SITE_URL: 'false',
        SITE_URL: '',
        TEST_SITE_URL: exactTestSiteUrl,
        BASE_PATH: exactBasePath,
        TEST_BASE_PATH: exactBasePath,
        ASTRO_TELEMETRY_DISABLED: '1',
        CI: exactCi,
        SMU1_LOCAL_ADMIN: 'false',
        SMU1_EXACT_PRERENDER: 'true',
        SMU1_EXACT_ROUTE_MANIFEST: exactRouteManifest
      }
    });
    const distRoot = path.join(workspace, 'dist');
    const routeChecks = [];
    for (const expectation of expectations) {
      const target = routeArtifactPath(distRoot, expectation.route, 'html');
      const routeExists = await fs.lstat(target).then((stat) => stat.isFile() && !stat.isSymbolicLink()).catch(() => false);
      const routeBytes = routeExists ? await fs.readFile(target) : null;
      const fallback404 = expectation.expected === 'not-found'
        ? await fs.lstat(path.join(distRoot, '404.html')).then((stat) => stat.isFile() && !stat.isSymbolicLink()).catch(() => false)
        : null;
      const fallbackBytes = fallback404 ? await fs.readFile(path.join(distRoot, '404.html')) : null;
      const ok = expectation.expected === 'not-found' ? !routeExists && fallback404 : routeExists;
      routeChecks.push({
        route: expectation.route,
        expected: expectation.expected,
        routeExists,
        routeSha256: routeBytes ? sha256(routeBytes) : null,
        routeBytes: routeBytes?.length || 0,
        fallback404,
        fallback404Sha256: fallbackBytes ? sha256(fallbackBytes) : null,
        fallback404Bytes: fallbackBytes?.length || 0,
        ok
      });
    }
    const missing = routeChecks.filter((item) => !item.ok);
    if (missing.length) {
      throw new ExactValidationError('EXACT_AFFECTED_ROUTE_MISSING', 'Exact build не создал затронутые страницы.', {
        status: 422,
        details: { missing }
      });
    }
    const prerenderEvidencePath = `${exactRouteManifest}.result.json`;
    const prerenderEvidence = JSON.parse(await fs.readFile(prerenderEvidencePath, 'utf8'));
    if (prerenderEvidence?.kind !== 'smu1-exact-prerender-result'
      || prerenderEvidence?.mode !== 'targeted-production-ssg'
      || prerenderEvidence?.runId !== snapshot.runId
      || prerenderEvidence?.transactionId !== snapshot.transactionId
      || prerenderEvidence?.manifestSha256 !== exactRouteManifestHash) {
      throw new ExactValidationError('EXACT_PRERENDER_EVIDENCE_INVALID', 'Astro targeted prerender не подтвердил identity exact snapshot.', { status: 422 });
    }
    const targetedHtmlRoutes = [];
    const collectHtml = async (directory, prefix = '') => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new ExactValidationError('EXACT_ARTIFACT_SYMLINK', 'Build artifact содержит symlink.', { status: 422 });
        if (entry.isDirectory()) await collectHtml(absolute, relative);
        else if (entry.isFile() && relative.endsWith('.html')) {
          targetedHtmlRoutes.push(relative === 'index.html' ? '/' : relative.endsWith('/index.html')
            ? `/${relative.slice(0, -'index.html'.length)}` : `/${relative}`);
        }
      }
    };
    await collectHtml(distRoot);
    targetedHtmlRoutes.sort((left, right) => left.localeCompare(right, 'en'));
    return {
      artifact: await artifactEvidence(distRoot),
      diagnostics: {
        mode: 'targeted-production-ssg',
        dependencies,
        mediaCache,
        prerender: prerenderEvidence,
        routeChecks,
        targetedHtmlRoutes,
        stdout: safeOutput(result.stdout),
        stderr: safeOutput(result.stderr)
      }
    };
  } catch (error) {
    if (error instanceof ExactValidationError) throw error;
    throw new ExactValidationError('EXACT_BUILD_FAILED', 'Точная сборка сохранённой версии не прошла.', {
      status: 422,
      details: { output: safeOutput(`${error?.stdout || ''}\n${error?.stderr || ''}\n${error?.message || error}`) },
      cause: error
    });
  } finally {
    let dependencyCleanupError = null;
    if (dependencyLinkInstalled) {
      try {
        const linkStat = await fs.lstat(nodeModules);
        if (!linkStat.isSymbolicLink()) throw new Error('dependency link was replaced');
        await fs.unlink(nodeModules);
      } catch (error) {
        dependencyCleanupError = error;
      }
    }
    if (worktreeAdded && !dependencyCleanupError) {
      await execFileAsync('git', ['worktree', 'remove', '--force', workspace], {
        cwd: repoRoot, windowsHide: true, timeout: 120_000, maxBuffer: 10 * 1024 * 1024
      }).catch(() => {});
      await execFileAsync('git', ['worktree', 'prune'], {
        cwd: repoRoot, windowsHide: true, timeout: 120_000, maxBuffer: 10 * 1024 * 1024
      }).catch(() => {});
    }
    if (dependencyCleanupError) {
      throw new ExactValidationError(
        'EXACT_DEPENDENCY_LINK_CLEANUP_FAILED',
        'Exact workspace сохранён: безопасно удалить ссылку зависимостей не удалось.',
        { status: 500, cause: dependencyCleanupError }
      );
    }
  }
}

export function createExactValidationService(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const runtimeDir = path.resolve(options.runtimeDir || path.join(repoRoot, '.admin-runtime', 'exact-validation'));
  if (!contained(repoRoot, runtimeDir) || runtimeDir === repoRoot) {
    throw new ExactValidationError('EXACT_RUNTIME_INVALID', 'Exact runtime должен находиться в отдельном каталоге внутри repository.', { status: 500 });
  }
  const transactionService = options.transactionService;
  if (!transactionService?.getTransaction || !transactionService?.listHistory || !transactionService?.withStableRead) {
    throw new ExactValidationError('EXACT_TRANSACTION_SERVICE_REQUIRED', 'Exact validation требует transaction service.', { status: 500 });
  }
  const snapshotBuilder = options.snapshotBuilder || ((request) => createExactSnapshot({ repoRoot, runtimeDir, ...request }));
  const runner = options.runner || ((request) => runExactSnapshot({ repoRoot, environment: options.environment, ...request }));
  const identityValidator = options.identityValidator || ((run) => proveExactRunIdentity({ repoRoot, run }));
  const now = options.now || (() => new Date());
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const maxRuns = Number(options.maxRuns || 50);
  const statePath = path.join(runtimeDir, 'state.json');
  let state = { version: 1, sequence: 0, currentRunId: null, activeRunId: null, pendingRunId: null, runs: {} };
  let initialized = false;
  let stateQueue = Promise.resolve();
  let requestQueue = Promise.resolve();
  let activePromise = null;
  let closed = false;

  function timestamp() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  }

  async function persist() {
    const ordered = Object.values(state.runs).sort((left, right) => (
      (Date.parse(right.requestedAt) - Date.parse(left.requestedAt))
      || (Number(right.requestSequence || 0) - Number(left.requestSequence || 0))
    ));
    for (const item of ordered.slice(maxRuns)) {
      if (item.runId !== state.activeRunId && item.runId !== state.pendingRunId) delete state.runs[item.runId];
    }
    await atomicWriteJson(statePath, state);
  }

  async function update(mutator) {
    let answer;
    const task = stateQueue.then(async () => {
      answer = await mutator(state);
      state.sequence += 1;
      await persist();
    });
    stateQueue = task.catch(() => {});
    await task;
    return answer;
  }

  async function initialize() {
    if (initialized) return;
    await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(runtimeDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ExactValidationError('EXACT_RUNTIME_UNSAFE', 'Exact runtime должен быть обычным каталогом.', { status: 500 });
    try {
      const loaded = JSON.parse(await fs.readFile(statePath, 'utf8'));
      if (loaded?.version !== 1 || !loaded.runs || typeof loaded.runs !== 'object') throw new Error('invalid state');
      state = loaded;
      for (const run of Object.values(state.runs)) {
        if (['running', 'queued'].includes(run.status)) run.status = 'queued';
      }
      const queued = Object.values(state.runs).filter((run) => run.status === 'queued').sort((a, b) => a.requestSequence - b.requestSequence);
      state.activeRunId = null;
      state.pendingRunId = queued.at(-1)?.runId || null;
      for (const run of queued.slice(0, -1)) {
        run.status = 'superseded';
        run.current = false;
        run.message = 'Проверка заменена более новой сохранённой редакцией.';
      }
      await persist();
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new ExactValidationError('EXACT_STATE_CORRUPT', 'Состояние exact validation повреждено.', { status: 500, cause: error });
      }
      await persist();
    }
    initialized = true;
    schedulePump();
  }

  function schedulePump() {
    if (closed || activePromise || !state.pendingRunId) return;
    activePromise = Promise.resolve().then(pump).finally(() => {
      activePromise = null;
      schedulePump();
    });
  }

  async function revalidatePassedRun(runId) {
    const candidate = runId ? state.runs[runId] : null;
    if (!candidate || candidate.status !== 'passed' || candidate.current !== true) return candidate;
    const proof = await identityValidator(clone(candidate));
    if (proof?.ok === true) return candidate;
    await update((draft) => {
      const target = draft.runs[runId];
      if (!target || target.status !== 'passed' || target.current !== true) return;
      target.status = 'stale';
      target.current = false;
      target.message = 'Проверенная редакция устарела: source model или renderer изменились. Запустите проверку снова.';
      target.diagnostics = { ...(target.diagnostics || {}), identityRevalidation: clone(proof || { ok: false, reasons: ['identity-validator-empty'] }) };
    });
    return state.runs[runId];
  }

  async function pump() {
    let run;
    await update((draft) => {
      const runId = draft.pendingRunId;
      if (!runId) return;
      draft.pendingRunId = null;
      draft.activeRunId = runId;
      run = draft.runs[runId];
      run.status = 'running';
      run.startedAt = timestamp();
      run.message = 'Проверяется точный результат сохранённой редакции.';
    });
    if (!run) return;
    let result;
    let failure;
    try {
      result = await runner({ snapshot: clone(run.snapshot), run: publicRun(run) });
    } catch (error) {
      failure = error;
    }
    await update((draft) => {
      const target = draft.runs[run.runId];
      const isCurrent = draft.currentRunId === run.runId && !draft.pendingRunId;
      target.finishedAt = timestamp();
      target.current = isCurrent;
      if (failure) {
        target.status = isCurrent ? 'failed' : 'stale';
        target.message = isCurrent
          ? 'Изменения сохранены на компьютере, но проверка сайта не прошла. Тестовая публикация заблокирована.'
          : 'Результат устарел: уже сохранена более новая редакция.';
        target.diagnostics = {
          code: failure?.code || 'EXACT_BUILD_FAILED',
          message: String(failure?.message || failure),
          details: clone(failure?.details || null)
        };
      } else if (!isCurrent) {
        target.status = 'stale';
        target.message = 'Проверка завершилась, но относится к устаревшей редакции.';
        target.artifact = clone(result?.artifact || null);
        target.diagnostics = clone(result?.diagnostics || null);
      } else {
        target.status = 'passed';
        target.message = 'Точная проверка пройдена. Редакция готова к тестовой публикации.';
        target.artifact = clone(result?.artifact || null);
        target.diagnostics = clone(result?.diagnostics || null);
      }
      draft.activeRunId = null;
    });
  }

  async function requestSerialized(request = {}) {
    await initialize();
    if (closed) throw new ExactValidationError('EXACT_SERVICE_CLOSED', 'Exact validation остановлен.', { status: 503 });
    const transactionId = safeTransactionId(request.transactionId);
    const key = ownerKey(request);
    await stateQueue;
    let reusable = Object.values(state.runs)
      .filter((run) => run.ownerKey === key
        && run.transactionId === transactionId
        && ['queued', 'running', 'passed'].includes(run.status))
      .sort((left, right) => right.requestSequence - left.requestSequence)[0] || null;
    if (reusable?.status === 'passed') reusable = await revalidatePassedRun(reusable.runId);
    if (reusable && ['queued', 'running', 'passed'].includes(reusable.status)) {
      return publicRun(reusable);
    }
    const transaction = await transactionService.getTransaction({
      owner: request.owner,
      sessionFingerprint: request.sessionFingerprint,
      transactionId
    });
    if (transaction.state !== 'committed') throw new ExactValidationError('EXACT_TRANSACTION_NOT_COMMITTED', 'Проверять можно только сохранённую редакцию.', { status: 409 });
    await stateQueue;
    const priorRun = state.currentRunId && state.runs[state.currentRunId]
      ? clone(state.runs[state.currentRunId])
      : null;
    const closureTransaction = transactionWithCumulativeExactClosure(transaction, priorRun);
    const runId = `exact-${String(randomUUID()).replace(/-/gu, '').toLowerCase()}`;
    if (!RUN_ID_RE.test(runId)) throw new ExactValidationError('EXACT_RUN_ID_INVALID', 'Генератор exact run id вернул некорректное значение.', { status: 500 });
    const snapshot = await transactionService.withStableRead(() => snapshotBuilder({ runId, transaction: clone(closureTransaction) }));
    const revision = digest({ transactionId, sourceSha: snapshot.sourceSha, snapshotSha256: snapshot.snapshotSha256 });
    const requestedAt = timestamp();
    await update((draft) => {
      if (draft.currentRunId && draft.runs[draft.currentRunId]) draft.runs[draft.currentRunId].current = false;
      if (draft.pendingRunId && draft.runs[draft.pendingRunId]) {
        const previous = draft.runs[draft.pendingRunId];
        previous.status = 'superseded';
        previous.current = false;
        previous.finishedAt = requestedAt;
        previous.supersededBy = runId;
        previous.message = 'Проверка заменена более новой сохранённой редакцией.';
      }
      if (draft.activeRunId && draft.runs[draft.activeRunId]) draft.runs[draft.activeRunId].supersededBy = runId;
      draft.runs[runId] = {
        runId,
        transactionId,
        revision,
        sourceSha: snapshot.sourceSha,
        schemaHash: snapshot.schemaHash,
        bindingRegistryHash: snapshot.bindingRegistryHash,
        h5PipelineHash: snapshot.h5PipelineHash,
        snapshotSha256: snapshot.snapshotSha256,
        affectedRoutes: snapshot.affectedRoutes || [],
        routeExpectations: snapshot.routeExpectations || [],
        closureTransactionIds: snapshot.closureTransactionIds || closureTransaction.metadata.exactClosureTransactionIds || [transactionId],
        snapshot: clone(snapshot),
        ownerKey: key,
        status: 'queued',
        current: true,
        message: 'Exact-проверка поставлена в очередь.',
        requestSequence: draft.sequence + 1,
        requestedAt
      };
      draft.currentRunId = runId;
      draft.pendingRunId = runId;
    });
    schedulePump();
    return publicRun(state.runs[runId]);
  }

  async function request(request = {}) {
    let result;
    const task = requestQueue.then(async () => { result = await requestSerialized(request); });
    requestQueue = task.catch(() => {});
    await task;
    return result;
  }

  async function get(request = {}) {
    await initialize();
    const runId = safeRunId(request.runId);
    let run = state.runs[runId];
    if (!run || run.ownerKey !== ownerKey(request)) throw new ExactValidationError('EXACT_RUN_NOT_FOUND', 'Exact-проверка не найдена.', { status: 404 });
    run = await revalidatePassedRun(runId);
    return publicRun(run);
  }

  async function assertPublishable(request = {}) {
    await initialize();
    const key = ownerKey(request);
    const selected = Array.isArray(request.transactionIds) ? request.transactionIds.map(safeTransactionId) : [];
    if (!selected.length) throw new ExactValidationError('EXACT_PUBLISH_SELECTION_REQUIRED', 'Для публикации нужна проверенная сохранённая редакция.', { status: 409 });
    let run = state.runs[state.currentRunId];
    if (run?.ownerKey === key) run = await revalidatePassedRun(run.runId);
    if (!run || run.ownerKey !== key || run.status !== 'passed' || run.current !== true || !selected.includes(run.transactionId)) {
      throw new ExactValidationError('EXACT_PUBLISH_BLOCKED', 'Тестовая публикация заблокирована: exact-проверка текущей редакции отсутствует, не прошла или устарела.', { status: 409 });
    }
    const history = await transactionService.listHistory({ owner: request.owner, sessionFingerprint: request.sessionFingerprint });
    const latest = history.filter((item) => item.state === 'committed').sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    if (!latest || latest.transactionId !== run.transactionId) {
      throw new ExactValidationError('EXACT_RESULT_STALE', 'После exact-проверки появилась более новая сохранённая редакция.', {
        status: 409,
        details: { checkedTransactionId: run.transactionId, latestTransactionId: latest?.transactionId || null }
      });
    }
    return publicRun(run);
  }

  async function overview(request = {}) {
    await initialize();
    const key = ownerKey(request);
    const ownedCurrent = state.currentRunId && state.runs[state.currentRunId]?.ownerKey === key
      ? state.currentRunId
      : null;
    if (ownedCurrent) await revalidatePassedRun(ownedCurrent);
    const runs = Object.values(state.runs)
      .filter((run) => run.ownerKey === key)
      .sort((left, right) => (Date.parse(right.requestedAt) - Date.parse(left.requestedAt))
        || (right.requestSequence - left.requestSequence))
      .map(publicRun);
    return { current: runs.find((run) => run.current) || null, runs };
  }

  async function close() {
    closed = true;
    await requestQueue;
    await activePromise?.catch(() => {});
    await stateQueue;
  }

  return Object.freeze({ initialize, request, get, overview, assertPublishable, close, runtimeDir });
}

export const exactValidationContract = Object.freeze({
  editableRoots: EDITABLE_ROOTS,
  statuses: Object.freeze(['queued', 'running', 'passed', 'failed', 'stale', 'superseded'])
});

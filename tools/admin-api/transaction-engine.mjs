import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createTransactionPayloadStore,
  normalizePayloadRef
} from './transaction-payload-store.mjs';

export const TRANSACTION_STATES = Object.freeze({
  PREPARED: 'prepared',
  APPLYING: 'applying',
  COMMITTED: 'committed',
  ROLLED_BACK: 'rolled-back',
  NO_OP: 'no-op'
});

export const TRANSACTION_FAULT_PHASES = Object.freeze([
  'preview:after-read',
  'preview:before-journal',
  'preview:after-journal',
  'preview:after-idempotency',
  'apply:after-lock',
  'apply:after-recheck',
  'apply:after-backup',
  'apply:after-journal-applying',
  'apply:before-mutation',
  'apply:after-mutation-write',
  'apply:after-mutation',
  'apply:before-commit',
  'apply:after-commit-journal',
  'apply:after-commit',
  'rollback:before',
  'rollback:after-restore',
  'rollback:after',
  'recovery:before',
  'recovery:after'
]);

const JOURNAL_VERSION = 3;
const LEGACY_INLINE_JOURNAL_VERSIONS = new Set([1, 2]);
const IDEMPOTENCY_VERSION = 1;
const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_TRANSACTION_TTL_MS = 30 * 60_000;
const REVISION_RE = /^(?:missing|sha256:[a-f0-9]{64}:\d+)$/u;
const TRANSACTION_ID_RE = /^[a-z0-9-]{8,128}$/iu;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_METADATA_BYTES = 64 * 1024;

export class TransactionEngineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TransactionEngineError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, error: this.message, details: this.details };
  }
}

export class SimulatedCrashError extends Error {
  constructor(phase = '') {
    super(`Simulated transaction crash at ${phase || 'unknown phase'}.`);
    this.name = 'SimulatedCrashError';
    this.code = 'SIMULATED_TRANSACTION_CRASH';
    this.phase = phase;
    this.simulateCrash = true;
  }
}

function fail(code, message, details = {}) {
  throw new TransactionEngineError(code, message, details);
}

function isMissingError(error) {
  return error?.code === 'ENOENT';
}

function isExistsError(error) {
  return error?.code === 'EEXIST';
}

function isTransientLockIoError(error) {
  return ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code);
}

function isSimulatedCrash(error) {
  return error instanceof SimulatedCrashError
    || error?.simulateCrash === true
    || error?.code === 'SIMULATED_TRANSACTION_CRASH';
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function hashBytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function hashPayload(value) {
  return `sha256:${hashBytes(Buffer.from(stableStringify(value), 'utf8'))}`;
}

export function revisionForBytes(value) {
  if (value === null || value === undefined) return 'missing';
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return `sha256:${hashBytes(bytes)}:${bytes.length}`;
}

function timestamp(now) {
  return new Date(now()).toISOString();
}

function ensureNonEmptyString(value, field, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maxLength) {
    fail(
      'TRANSACTION_INPUT_INVALID',
      `Поле ${field} заполнено некорректно.`,
      { field, expected: `non-empty normalized string up to ${maxLength} characters` }
    );
  }
  return value;
}

function isInsideOrEqual(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\0')) {
    fail('TRANSACTION_PATH_INVALID', 'Путь файла указан некорректно.', { path: String(value ?? '') });
  }
  if (value.includes('\\') || path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    fail('TRANSACTION_PATH_INVALID', 'Разрешены только относительные пути внутри проекта.', { path: value });
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('TRANSACTION_PATH_INVALID', 'Путь должен быть нормализован и не содержать переходов “.” или “..”.', { path: value });
  }
  return segments.join('/');
}

function validateRevision(value, field = 'expectedRevision') {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !REVISION_RE.test(value)) {
    fail('TRANSACTION_INPUT_INVALID', `Поле ${field} содержит некорректную ревизию.`, { field });
  }
  return value;
}

function decodeWriteBytes(mutation) {
  const hasBase64 = Object.hasOwn(mutation, 'bytesBase64');
  const hasContent = Object.hasOwn(mutation, 'content');
  const hasBytes = Object.hasOwn(mutation, 'bytes');
  if ([hasBase64, hasContent, hasBytes].filter(Boolean).length !== 1) {
    fail(
      'TRANSACTION_INPUT_INVALID',
      'Для записи укажите ровно одно поле: content, bytes или bytesBase64.',
      { path: mutation.path }
    );
  }
  if (hasBase64) {
    if (typeof mutation.bytesBase64 !== 'string' || !BASE64_RE.test(mutation.bytesBase64)) {
      fail('TRANSACTION_INPUT_INVALID', 'Поле bytesBase64 содержит некорректные данные.', { path: mutation.path });
    }
    const bytes = Buffer.from(mutation.bytesBase64, 'base64');
    if (bytes.toString('base64') !== mutation.bytesBase64) {
      fail('TRANSACTION_INPUT_INVALID', 'Поле bytesBase64 не является каноническим Base64.', { path: mutation.path });
    }
    return bytes;
  }
  if (hasContent) {
    if (typeof mutation.content !== 'string') {
      fail('TRANSACTION_INPUT_INVALID', 'Поле content должно быть строкой UTF-8.', { path: mutation.path });
    }
    return Buffer.from(mutation.content, 'utf8');
  }
  if (!(Buffer.isBuffer(mutation.bytes) || mutation.bytes instanceof Uint8Array)) {
    fail('TRANSACTION_INPUT_INVALID', 'Поле bytes должно содержать Buffer или Uint8Array.', { path: mutation.path });
  }
  return Buffer.from(mutation.bytes);
}

function normalizeAffectedRoute(value, index) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 2_048
    || CONTROL_CHARACTER_RE.test(value) || /[\\?#]/u.test(value) || /%(?:2e|2f|5c)/iu.test(value)
    || value.startsWith('//') || !value.startsWith('/')) {
    fail('TRANSACTION_METADATA_INVALID', 'affectedRoutes содержит некорректный внутренний маршрут.', {
      field: `metadata.affectedRoutes[${index}]`
    });
  }
  const inspected = value.split(/[?#]/u, 1)[0];
  if (inspected.split('/').some((segment) => segment === '.' || segment === '..')) {
    fail('TRANSACTION_METADATA_INVALID', 'affectedRoutes содержит ненормализованный маршрут.', {
      field: `metadata.affectedRoutes[${index}]`
    });
  }
  return value;
}

function normalizeRouteExpectations(value) {
  if (!Array.isArray(value) || value.length > 500) {
    fail('TRANSACTION_METADATA_INVALID', 'metadata.routeExpectations должно быть массивом типизированных ожиданий.', {
      field: 'metadata.routeExpectations'
    });
  }
  const byRoute = new Map();
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'expected,route') {
      fail('TRANSACTION_METADATA_INVALID', 'routeExpectations содержит некорректное ожидание.', {
        field: `metadata.routeExpectations[${index}]`
      });
    }
    const route = normalizeAffectedRoute(item.route, index);
    if (!['html', 'not-found'].includes(item.expected)) {
      fail('TRANSACTION_METADATA_INVALID', 'routeExpectations.expected должен быть html или not-found.', {
        field: `metadata.routeExpectations[${index}].expected`
      });
    }
    const previous = byRoute.get(route);
    if (previous && previous !== item.expected) {
      fail('TRANSACTION_METADATA_INVALID', 'Один маршрут содержит противоречивые smoke-ожидания.', {
        field: `metadata.routeExpectations[${index}]`, route
      });
    }
    byRoute.set(route, item.expected);
  });
  return [...byRoute].sort(([left], [right]) => left.localeCompare(right))
    .map(([route, expected]) => ({ route, expected }));
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('TRANSACTION_METADATA_INVALID', 'metadata должна быть обычным JSON-объектом.');
  }
  let cloned;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_METADATA_BYTES) {
      fail('TRANSACTION_METADATA_INVALID', 'metadata слишком велика.', { maxBytes: MAX_METADATA_BYTES });
    }
    cloned = JSON.parse(serialized);
  } catch (error) {
    if (error instanceof TransactionEngineError) throw error;
    fail('TRANSACTION_METADATA_INVALID', 'metadata должна содержать только JSON-значения.');
  }
  const userSummary = cloned.userSummary;
  if (userSummary !== undefined && (typeof userSummary !== 'string' || !userSummary.trim()
    || userSummary !== userSummary.trim() || userSummary.length > 500 || CONTROL_CHARACTER_RE.test(userSummary))) {
    fail('TRANSACTION_METADATA_INVALID', 'metadata.userSummary заполнено некорректно.', {
      field: 'metadata.userSummary'
    });
  }
  if (cloned.affectedRoutes !== undefined) {
    if (!Array.isArray(cloned.affectedRoutes) || cloned.affectedRoutes.length > 500) {
      fail('TRANSACTION_METADATA_INVALID', 'metadata.affectedRoutes должно быть массивом внутренних маршрутов.', {
        field: 'metadata.affectedRoutes'
      });
    }
    cloned.affectedRoutes = [...new Set(cloned.affectedRoutes.map(normalizeAffectedRoute))].sort();
  }
  if (cloned.routeExpectations !== undefined) {
    cloned.routeExpectations = normalizeRouteExpectations(cloned.routeExpectations);
  }
  if (cloned.affectedRoutes !== undefined || cloned.routeExpectations !== undefined) {
    const routes = cloned.affectedRoutes ?? [];
    const expectationRoutes = (cloned.routeExpectations ?? []).map((item) => item.route);
    if (routes.length !== expectationRoutes.length
      || routes.some((route, index) => route !== expectationRoutes[index])) {
      fail('TRANSACTION_METADATA_INVALID', 'affectedRoutes и routeExpectations должны описывать один точный набор маршрутов.', {
        field: 'metadata.routeExpectations'
      });
    }
  }
  if (cloned.baseHead !== undefined && (typeof cloned.baseHead !== 'string' || !GIT_OBJECT_ID_RE.test(cloned.baseHead))) {
    fail('TRANSACTION_METADATA_INVALID', 'metadata.baseHead должно содержать полный Git SHA.', {
      field: 'metadata.baseHead'
    });
  }
  return stableValue(cloned);
}

function normalizeRequest({ owner, recoveryClientId, idempotencyKey, mutations, readSet = [], metadata }) {
  const normalizedOwner = ensureNonEmptyString(owner, 'owner');
  const normalizedClientId = ensureNonEmptyString(recoveryClientId, 'recoveryClientId');
  const normalizedKey = ensureNonEmptyString(idempotencyKey, 'idempotencyKey');
  if (!Array.isArray(mutations) || !Array.isArray(readSet)) {
    fail('TRANSACTION_INPUT_INVALID', 'mutations и readSet должны быть массивами.');
  }

  const seenMutations = new Set();
  const normalizedMutations = mutations.map((mutation, index) => {
    if (!mutation || typeof mutation !== 'object' || Array.isArray(mutation)) {
      fail('TRANSACTION_INPUT_INVALID', 'Каждая mutation должна быть объектом.', { index });
    }
    const relativePath = normalizeRelativePath(mutation.path);
    if (seenMutations.has(relativePath)) {
      fail('TRANSACTION_INPUT_INVALID', 'Один путь нельзя изменить дважды в одной транзакции.', { path: relativePath });
    }
    seenMutations.add(relativePath);
    const operation = mutation.operation;
    if (operation !== 'write' && operation !== 'delete') {
      fail('TRANSACTION_INPUT_INVALID', 'operation должна быть write или delete.', { path: relativePath });
    }
    const expectedRevision = validateRevision(mutation.expectedRevision);
    if (operation === 'delete') {
      if (Object.hasOwn(mutation, 'content') || Object.hasOwn(mutation, 'bytes') || Object.hasOwn(mutation, 'bytesBase64')) {
        fail('TRANSACTION_INPUT_INVALID', 'Удаление не должно содержать новые байты.', { path: relativePath });
      }
      return { path: relativePath, operation, expectedRevision };
    }
    const bytes = decodeWriteBytes(mutation);
    const payloadRef = {
      sha256: hashBytes(bytes),
      size: bytes.length
    };
    return {
      path: relativePath,
      operation,
      expectedRevision,
      contentBytes: bytes,
      payloadRef,
      nextRevision: revisionForBytes(bytes)
    };
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'));

  const normalizedReadsByPath = new Map();
  readSet.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('TRANSACTION_INPUT_INVALID', 'Каждый элемент readSet должен быть объектом.', { index });
    }
    const relativePath = normalizeRelativePath(entry.path);
    const expectedRevision = validateRevision(entry.expectedRevision, 'readSet.expectedRevision');
    if (normalizedReadsByPath.has(relativePath)) {
      const current = normalizedReadsByPath.get(relativePath);
      if (current.expectedRevision !== expectedRevision) {
        fail('TRANSACTION_INPUT_INVALID', 'Для одного readSet-пути указаны разные ревизии.', { path: relativePath });
      }
      return;
    }
    normalizedReadsByPath.set(relativePath, { path: relativePath, expectedRevision });
  });
  const normalizedReadSet = [...normalizedReadsByPath.values()]
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));

  const payloadDescriptor = {
    mutations: normalizedMutations.map((mutation) => ({
      path: mutation.path,
      operation: mutation.operation,
      expectedRevision: mutation.expectedRevision ?? null,
      payloadRef: mutation.operation === 'write' ? mutation.payloadRef : null
    })),
    readSet: normalizedReadSet.map((entry) => ({
      path: entry.path,
      expectedRevision: entry.expectedRevision ?? null
    })),
    metadata: normalizeMetadata(metadata)
  };

  const legacyPayloadHash = () => hashPayload({
    mutations: normalizedMutations.map((mutation) => ({
      path: mutation.path,
      operation: mutation.operation,
      expectedRevision: mutation.expectedRevision ?? null,
      contentBase64: mutation.operation === 'write' ? mutation.contentBytes.toString('base64') : null
    })),
    readSet: normalizedReadSet.map((entry) => ({
      path: entry.path,
      expectedRevision: entry.expectedRevision ?? null
    })),
    metadata: payloadDescriptor.metadata
  });

  return {
    owner: normalizedOwner,
    recoveryClientId: normalizedClientId,
    idempotencyKey: normalizedKey,
    mutations: normalizedMutations,
    readSet: normalizedReadSet,
    metadata: payloadDescriptor.metadata,
    payloadHash: hashPayload(payloadDescriptor),
    legacyPayloadHash
  };
}

function idempotencyEntryId(recoveryClientId, idempotencyKey) {
  return hashPayload({ recoveryClientId, idempotencyKey }).slice('sha256:'.length);
}

function publicPreview(journal, reused = false) {
  return Object.freeze({
    transactionId: journal.transactionId,
    state: journal.state,
    result: journal.state,
    payloadHash: journal.payloadHash,
    createdAt: journal.createdAt,
    expiresAt: journal.expiresAt,
    paths: Object.freeze(journal.mutations.filter((item) => item.willChange).map((item) => item.path)),
    readSet: Object.freeze(journal.revisions.map((entry) => ({ path: entry.path, revision: entry.revision }))),
    metadata: Object.freeze(clone(journal.metadata ?? {})),
    reused
  });
}

function publicNoOp(entry, reused = false) {
  return Object.freeze({
    transactionId: null,
    state: TRANSACTION_STATES.NO_OP,
    result: TRANSACTION_STATES.NO_OP,
    payloadHash: entry.payloadHash,
    paths: Object.freeze([]),
    metadata: Object.freeze(clone(entry.metadata ?? {})),
    reused
  });
}

function publicApplyResult(journal, reused = false) {
  return Object.freeze({ ...(journal.result ?? {
    transactionId: journal.transactionId,
    state: journal.state,
    result: journal.state,
    payloadHash: journal.payloadHash
  }), metadata: Object.freeze(clone(journal.metadata ?? {})), reused });
}

export function createTransactionEngine(options = {}) {
  const fileSystem = options.fileSystem ?? fs;
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const runtimeDir = path.resolve(options.runtimeDir ?? path.join(repoRoot, '.admin-runtime', 'transactions'));
  const journalDir = path.join(runtimeDir, 'journals');
  const backupRoot = path.join(runtimeDir, 'backups');
  const payloadRoot = path.join(runtimeDir, 'payloads', 'sha256');
  const idempotencyPath = path.join(runtimeDir, 'idempotency.json');
  const lockPath = path.join(runtimeDir, 'repo.lock');
  const lockTtlMs = Number(options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS);
  const transactionTtlMs = Number(options.transactionTtlMs ?? DEFAULT_TRANSACTION_TTL_MS);
  const lockAcquireTimeoutMs = Number(options.lockAcquireTimeoutMs ?? 0);
  const lockRetryMs = Number(options.lockRetryMs ?? 25);
  const recoveryMode = options.recoveryMode ?? 'rollback';
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : null;
  const instanceId = options.instanceId ?? crypto.randomUUID();
  const payloadStore = createTransactionPayloadStore({
    fileSystem,
    runtimeDir,
    payloadRoot,
    syncDirectory: (directory) => syncDirectory(directory)
  });

  if (!Number.isFinite(lockTtlMs) || lockTtlMs < 100 || !Number.isFinite(transactionTtlMs) || transactionTtlMs < 1) {
    fail('TRANSACTION_CONFIG_INVALID', 'Некорректные TTL-настройки transaction engine.');
  }
  if (!['rollback', 'complete'].includes(recoveryMode)) {
    fail('TRANSACTION_CONFIG_INVALID', 'recoveryMode должен быть rollback или complete.');
  }
  if (isInsideOrEqual(runtimeDir, repoRoot)) {
    fail('TRANSACTION_CONFIG_INVALID', 'runtimeDir не может содержать корень проекта.', {
      repoRoot,
      runtimeDir
    });
  }

  let initialized = false;
  let initializePromise = null;
  let repoRealRoot = null;

  async function invokeFault(phase, context = {}) {
    if (!faultInjector) return;
    await faultInjector(Object.freeze({ phase, ...context }));
  }

  async function ensureLayout() {
    await fileSystem.mkdir(repoRoot, { recursive: true });
    await fileSystem.mkdir(journalDir, { recursive: true });
    await fileSystem.mkdir(backupRoot, { recursive: true });
    await payloadStore.ensureLayout();
    repoRealRoot = await fileSystem.realpath(repoRoot);
  }

  function absoluteManagedPath(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    const target = path.resolve(repoRoot, ...normalized.split('/'));
    if (!isInsideOrEqual(repoRoot, target) || target === repoRoot) {
      fail('TRANSACTION_PATH_FORBIDDEN', 'Путь выходит за пределы проекта.', { path: normalized });
    }
    if (isInsideOrEqual(runtimeDir, target)) {
      fail('TRANSACTION_RUNTIME_PATH_FORBIDDEN', 'Служебный runtime transaction engine нельзя изменять через транзакцию.', {
        path: normalized
      });
    }
    return { relativePath: normalized, target };
  }

  async function assertManagedPathSafe(relativePath) {
    const resolved = absoluteManagedPath(relativePath);
    let cursor = repoRoot;
    for (const segment of resolved.relativePath.split('/')) {
      cursor = path.join(cursor, segment);
      try {
        const stats = await fileSystem.lstat(cursor);
        if (stats.isSymbolicLink()) {
          fail('TRANSACTION_SYMLINK_FORBIDDEN', 'Транзакция не работает через символические ссылки.', {
            path: resolved.relativePath
          });
        }
      } catch (error) {
        if (isMissingError(error)) break;
        throw error;
      }
    }
    const existingAncestor = await nearestExistingAncestor(path.dirname(resolved.target));
    const ancestorReal = await fileSystem.realpath(existingAncestor);
    if (!isInsideOrEqual(repoRealRoot, ancestorReal)) {
      fail('TRANSACTION_PATH_FORBIDDEN', 'Фактический путь выходит за пределы проекта.', { path: resolved.relativePath });
    }
    return resolved;
  }

  async function nearestExistingAncestor(candidate) {
    let cursor = candidate;
    while (true) {
      try {
        const stats = await fileSystem.lstat(cursor);
        if (!stats.isDirectory()) {
          fail('TRANSACTION_PATH_INVALID', 'Родительский путь не является каталогом.', {
            path: path.relative(repoRoot, cursor).replace(/\\/gu, '/')
          });
        }
        return cursor;
      } catch (error) {
        if (!isMissingError(error)) throw error;
        const parent = path.dirname(cursor);
        if (parent === cursor) throw error;
        cursor = parent;
      }
    }
  }

  async function readPathState(relativePath) {
    const { target } = await assertManagedPathSafe(relativePath);
    try {
      const stats = await fileSystem.lstat(target);
      if (stats.isSymbolicLink()) {
        fail('TRANSACTION_SYMLINK_FORBIDDEN', 'Транзакция не работает с символическими ссылками.', { path: relativePath });
      }
      if (!stats.isFile()) {
        fail('TRANSACTION_PATH_INVALID', 'Транзакция может изменять только обычные файлы.', { path: relativePath });
      }
      const bytes = await fileSystem.readFile(target);
      return { exists: true, bytes, revision: revisionForBytes(bytes), mode: stats.mode & 0o777 };
    } catch (error) {
      if (isMissingError(error)) return { exists: false, bytes: null, revision: 'missing', mode: null };
      throw error;
    }
  }

  async function syncDirectory(directory) {
    let handle;
    try {
      handle = await fileSystem.open(directory, 'r');
      await handle.sync();
    } catch {
      // Directory fsync is unavailable on some Windows filesystems.
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async function atomicWriteRuntime(target, bytes, mode = 0o600) {
    await fileSystem.mkdir(path.dirname(target), { recursive: true });
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fileSystem.open(temporary, 'wx', mode);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await fileSystem.rename(temporary, target);
      await syncDirectory(path.dirname(target));
    } catch (error) {
      await handle?.close().catch(() => {});
      await fileSystem.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function atomicWriteJson(target, value) {
    await atomicWriteRuntime(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
  }

  function journalPath(transactionId) {
    if (typeof transactionId !== 'string' || !TRANSACTION_ID_RE.test(transactionId)) {
      fail('TRANSACTION_ID_INVALID', 'Некорректный идентификатор транзакции.');
    }
    return path.join(journalDir, `${transactionId}.json`);
  }

  function validatePersistedJournal(journal, transactionId, { allowLegacy = false } = {}) {
    const supportedVersion = journal?.version === JOURNAL_VERSION
      || (allowLegacy && LEGACY_INLINE_JOURNAL_VERSIONS.has(journal?.version));
    if (!supportedVersion || journal.transactionId !== transactionId
      || !Object.values(TRANSACTION_STATES).includes(journal.state)
      || !Array.isArray(journal.mutations)) {
      fail('TRANSACTION_JOURNAL_CORRUPT', 'Журнал транзакции имеет неизвестный формат.', { transactionId });
    }
    for (const mutation of journal.mutations) {
      if (!mutation || typeof mutation !== 'object' || Array.isArray(mutation)
        || !['write', 'delete'].includes(mutation.operation)) {
        fail('TRANSACTION_JOURNAL_CORRUPT', 'Журнал транзакции содержит некорректную mutation.', { transactionId });
      }
      try {
        normalizeRelativePath(mutation.path);
      } catch {
        fail('TRANSACTION_JOURNAL_CORRUPT', 'Журнал транзакции содержит небезопасный путь.', { transactionId });
      }
      if (mutation.operation === 'delete') {
        if (Object.hasOwn(mutation, 'payloadRef') || Object.hasOwn(mutation, 'contentBase64')
          || Object.hasOwn(mutation, 'bytesBase64')) {
          fail('TRANSACTION_JOURNAL_CORRUPT', 'Delete mutation содержит payload.', { transactionId });
        }
        continue;
      }
      if (journal.version === JOURNAL_VERSION) {
        if (Object.hasOwn(mutation, 'contentBase64') || Object.hasOwn(mutation, 'bytesBase64')) {
          fail(
            'TRANSACTION_JOURNAL_INLINE_PAYLOAD_FORBIDDEN',
            'Новый формат transaction journal не может содержать inline payload.',
            { transactionId, path: mutation.path }
          );
        }
        const ref = normalizePayloadRef(mutation.payloadRef);
        if (mutation.nextRevision !== `sha256:${ref.sha256}:${ref.size}`) {
          fail('TRANSACTION_JOURNAL_CORRUPT', 'Payload reference не совпадает с nextRevision.', {
            transactionId,
            path: mutation.path
          });
        }
        mutation.payloadRef = { ...ref };
      } else {
        const inlineFields = ['contentBase64', 'bytesBase64'].filter((field) => Object.hasOwn(mutation, field));
        if (inlineFields.length !== 1 || Object.hasOwn(mutation, 'payloadRef')) {
          fail('TRANSACTION_JOURNAL_CORRUPT', 'Legacy transaction journal не содержит exact inline payload.', {
            transactionId,
            path: mutation.path
          });
        }
        const encoded = mutation[inlineFields[0]];
        if (typeof encoded !== 'string' || !BASE64_RE.test(encoded)) {
          fail('TRANSACTION_JOURNAL_CORRUPT', 'Legacy transaction journal содержит некорректный Base64.', {
            transactionId,
            path: mutation.path
          });
        }
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.toString('base64') !== encoded || revisionForBytes(bytes) !== mutation.nextRevision) {
          fail('TRANSACTION_JOURNAL_CORRUPT', 'Legacy inline payload не совпадает с nextRevision.', {
            transactionId,
            path: mutation.path
          });
        }
      }
    }
    return journal;
  }

  async function loadJournal(transactionId, options = {}) {
    let raw;
    try {
      raw = await fileSystem.readFile(journalPath(transactionId), 'utf8');
    } catch (error) {
      if (isMissingError(error)) {
        fail('TRANSACTION_NOT_FOUND', 'Транзакция не найдена.', { transactionId });
      }
      throw error;
    }
    let journal;
    try {
      journal = JSON.parse(raw);
    } catch {
      fail('TRANSACTION_JOURNAL_CORRUPT', 'Журнал транзакции повреждён.', { transactionId });
    }
    return validatePersistedJournal(journal, transactionId, options);
  }

  async function saveJournal(journal) {
    journal.updatedAt = timestamp(now);
    await atomicWriteJson(journalPath(journal.transactionId), journal);
    return journal;
  }

  async function listJournalIds() {
    let names;
    try {
      names = await fileSystem.readdir(journalDir);
    } catch (error) {
      if (isMissingError(error)) return [];
      throw error;
    }
    const transactionIds = [];
    for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
      const transactionId = name.slice(0, -'.json'.length);
      if (!TRANSACTION_ID_RE.test(transactionId)) {
        fail('TRANSACTION_JOURNAL_CORRUPT', 'Каталог journals содержит некорректное имя.', { name });
      }
      transactionIds.push(transactionId);
    }
    return transactionIds;
  }

  async function* iterateJournals() {
    for (const transactionId of await listJournalIds()) yield await loadJournal(transactionId);
  }

  async function migrateLegacyJournalsUnderLock() {
    let migrated = 0;
    for (const transactionId of await listJournalIds()) {
      const journal = await loadJournal(transactionId, { allowLegacy: true });
      if (journal.version === JOURNAL_VERSION) continue;
      for (let index = 0; index < journal.mutations.length; index += 1) {
        const mutation = journal.mutations[index];
        if (mutation.operation === 'delete') continue;
        const encoded = mutation.contentBase64 ?? mutation.bytesBase64;
        const payloadRef = await payloadStore.put(Buffer.from(encoded, 'base64'));
        const { contentBase64, bytesBase64, ...metadata } = mutation;
        journal.mutations[index] = { ...metadata, payloadRef: { ...payloadRef } };
      }
      journal.version = JOURNAL_VERSION;
      await atomicWriteJson(journalPath(transactionId), journal);
      migrated += 1;
    }
    return migrated;
  }

  async function readIdempotency() {
    let raw;
    try {
      raw = await fileSystem.readFile(idempotencyPath, 'utf8');
    } catch (error) {
      if (isMissingError(error)) return { version: IDEMPOTENCY_VERSION, entries: {} };
      throw error;
    }
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      fail('IDEMPOTENCY_STORE_CORRUPT', 'Хранилище идемпотентности повреждено.');
    }
    if (value?.version !== IDEMPOTENCY_VERSION || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) {
      fail('IDEMPOTENCY_STORE_CORRUPT', 'Хранилище идемпотентности имеет неизвестный формат.');
    }
    return value;
  }

  async function saveIdempotency(store) {
    await atomicWriteJson(idempotencyPath, store);
  }

  function idempotencyFromJournal(journal) {
    return {
      recoveryClientId: journal.recoveryClientId,
      idempotencyKey: journal.idempotencyKey,
      payloadHash: journal.payloadHash,
      owner: journal.owner,
      transactionId: journal.transactionId,
      state: journal.state,
      result: journal.result ?? null,
      metadata: clone(journal.metadata ?? {}),
      updatedAt: journal.updatedAt
    };
  }

  async function reconcileIdempotencyUnderLock() {
    const store = await readIdempotency();
    let changed = false;
    for await (const journal of iterateJournals()) {
      const entryId = idempotencyEntryId(journal.recoveryClientId, journal.idempotencyKey);
      const current = store.entries[entryId];
      if (current && (current.payloadHash !== journal.payloadHash
        || current.recoveryClientId !== journal.recoveryClientId
        || current.idempotencyKey !== journal.idempotencyKey)) {
        fail('IDEMPOTENCY_STORE_CORRUPT', 'Один idempotency key связан с разными payload.', {
          transactionId: journal.transactionId
        });
      }
      const next = idempotencyFromJournal(journal);
      if (!current || current.state !== next.state || current.transactionId !== next.transactionId
        || stableStringify(current.result) !== stableStringify(next.result)) {
        store.entries[entryId] = next;
        changed = true;
      }
    }
    if (changed) await saveIdempotency(store);
    return store;
  }

  function parseLock(raw) {
    try {
      const value = JSON.parse(raw);
      if (typeof value.ownerToken !== 'string' || !Number.isFinite(value.expiresAtMs)) return null;
      return value;
    } catch {
      return null;
    }
  }

  async function createLockFile() {
    const ownerToken = `${instanceId}:${crypto.randomUUID()}`;
    const acquiredAtMs = now();
    const pendingLockPath = `${lockPath}.pending-${process.pid}-${crypto.randomUUID()}`;
    const metadata = {
      version: 1,
      ownerToken,
      instanceId,
      pid: process.pid,
      acquiredAt: timestamp(() => acquiredAtMs),
      acquiredAtMs,
      expiresAt: timestamp(() => acquiredAtMs + lockTtlMs),
      expiresAtMs: acquiredAtMs + lockTtlMs
    };
    let handle;
    try {
      handle = await fileSystem.open(pendingLockPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      // Publish only a fully written lease. Creating the hard link is atomic and
      // fails with EEXIST when another process already owns the repository lock.
      await fileSystem.link(pendingLockPath, lockPath);
    } catch (error) {
      await handle?.close().catch(() => {});
      throw error;
    } finally {
      await fileSystem.unlink(pendingLockPath).catch(() => {
        // A leftover pending file is inert: it is never treated as a lock.
        // Do not turn an acquired, valid lock into an ambiguous failed acquire.
      });
    }

    const refresh = async () => {
      let lockHandle;
      try {
        lockHandle = await fileSystem.open(lockPath, 'r+');
        const raw = await lockHandle.readFile('utf8');
        const current = parseLock(raw);
        if (!current || current.ownerToken !== ownerToken) {
          fail('TRANSACTION_LOCK_LOST', 'Блокировка репозитория была потеряна.');
        }
        const refreshedAtMs = now();
        const next = {
          ...current,
          refreshedAt: timestamp(() => refreshedAtMs),
          refreshedAtMs,
          expiresAt: timestamp(() => refreshedAtMs + lockTtlMs),
          expiresAtMs: refreshedAtMs + lockTtlMs
        };
        const serialized = Buffer.from(`${JSON.stringify(next)}\n`, 'utf8');
        // Keep the previous valid lease visible until replacement bytes exist.
        // Acquisition performs a bounded reread if it catches a mixed short write.
        await lockHandle.write(serialized, 0, serialized.length, 0);
        await lockHandle.truncate(serialized.length);
        await lockHandle.sync();
      } finally {
        await lockHandle?.close().catch(() => {});
      }
    };

    const release = async () => {
      let raw;
      try {
        raw = await fileSystem.readFile(lockPath, 'utf8');
      } catch (error) {
        if (isMissingError(error)) return;
        throw error;
      }
      const current = parseLock(raw);
      if (current?.ownerToken === ownerToken) {
        await fileSystem.unlink(lockPath).catch((error) => {
          if (!isMissingError(error)) throw error;
        });
      }
    };
    return { ownerToken, refresh, release };
  }

  async function takeoverExpiredLock(initialRaw) {
    const first = parseLock(initialRaw);
    if (!first) {
      fail('TRANSACTION_LOCK_INVALID', 'Файл блокировки повреждён; автоматический захват запрещён.');
    }
    if (first.expiresAtMs > now()) return false;

    let verifiedRaw;
    try {
      verifiedRaw = await fileSystem.readFile(lockPath, 'utf8');
    } catch (error) {
      if (isMissingError(error)) return true;
      throw error;
    }
    const verified = parseLock(verifiedRaw);
    if (!verified || verifiedRaw !== initialRaw || verified.expiresAtMs > now()) return false;

    const stalePath = `${lockPath}.stale-${crypto.randomUUID()}`;
    try {
      await fileSystem.rename(lockPath, stalePath);
    } catch (error) {
      if (isMissingError(error)) return true;
      throw error;
    }

    let movedRaw;
    try {
      movedRaw = await fileSystem.readFile(stalePath, 'utf8');
      const moved = parseLock(movedRaw);
      if (!moved || movedRaw !== verifiedRaw || moved.expiresAtMs > now()) {
        try {
          await fileSystem.rename(stalePath, lockPath);
        } catch {
          // Another verified owner may already hold lockPath; fail closed below.
        }
        return false;
      }
      return true;
    } finally {
      if (movedRaw !== undefined) await fileSystem.rm(stalePath, { force: true }).catch(() => {});
    }
  }

  async function acquireRepoLock() {
    const startedAt = now();
    const retryTransientLockIo = async (error) => {
      if (!isTransientLockIoError(error) || now() - startedAt >= lockAcquireTimeoutMs) return false;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, lockRetryMs)));
      return true;
    };
    while (true) {
      try {
        return await createLockFile();
      } catch (error) {
        if (!isExistsError(error)) {
          if (await retryTransientLockIo(error)) continue;
          throw error;
        }
      }

      let raw;
      try {
        raw = await fileSystem.readFile(lockPath, 'utf8');
      } catch (error) {
        if (isMissingError(error)) continue;
        if (await retryTransientLockIo(error)) continue;
        throw error;
      }
      const lock = parseLock(raw);
      if (!lock) {
        if (now() - startedAt < lockAcquireTimeoutMs) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(1, lockRetryMs)));
          continue;
        }
        fail('TRANSACTION_LOCK_INVALID', 'Файл блокировки повреждён; автоматический захват запрещён.');
      }
      if (lock.expiresAtMs <= now()) {
        let removed;
        try {
          removed = await takeoverExpiredLock(raw);
        } catch (error) {
          if (await retryTransientLockIo(error)) continue;
          throw error;
        }
        if (removed) continue;
      }
      if (now() - startedAt >= lockAcquireTimeoutMs) {
        fail('TRANSACTION_LOCKED', 'Репозиторий уже изменяется другой сессией.', {
          owner: lock.instanceId,
          expiresAt: lock.expiresAt
        });
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, lockRetryMs)));
    }
  }

  async function withRepoLock(callback) {
    const lease = await acquireRepoLock();
    try {
      return await callback(lease);
    } finally {
      await lease.release();
    }
  }

  async function currentRevisions(paths) {
    const entries = [];
    for (const relativePath of [...new Set(paths)].sort((a, b) => a.localeCompare(b, 'en'))) {
      const state = await readPathState(relativePath);
      entries.push({ path: relativePath, revision: state.revision });
    }
    return entries;
  }

  function checkExpectedRevisions(entries, expectedByPath) {
    const conflicts = [];
    for (const entry of entries) {
      const expected = expectedByPath.get(entry.path);
      if (expected && expected !== entry.revision) {
        conflicts.push({ path: entry.path, expectedRevision: expected, actualRevision: entry.revision });
      }
    }
    if (conflicts.length) {
      fail('TRANSACTION_REVISION_CONFLICT', 'Данные изменились. Обновите страницу и повторите действие.', { conflicts });
    }
  }

  async function missingParentDirectories(target) {
    const missing = [];
    let cursor = path.dirname(target);
    while (cursor !== repoRoot && isInsideOrEqual(repoRoot, cursor)) {
      try {
        const stats = await fileSystem.lstat(cursor);
        if (stats.isSymbolicLink()) {
          fail('TRANSACTION_SYMLINK_FORBIDDEN', 'Транзакция не создаёт файлы через символические ссылки.');
        }
        if (!stats.isDirectory()) fail('TRANSACTION_PATH_INVALID', 'Родительский путь не является каталогом.');
        break;
      } catch (error) {
        if (!isMissingError(error)) throw error;
        missing.push(path.relative(repoRoot, cursor).replace(/\\/gu, '/'));
        cursor = path.dirname(cursor);
      }
    }
    return missing;
  }

  async function createBackups(journal) {
    const transactionBackupDir = path.join(backupRoot, journal.transactionId);
    await fileSystem.rm(transactionBackupDir, { recursive: true, force: true });
    await fileSystem.mkdir(transactionBackupDir, { recursive: true });
    const backups = [];
    const createdDirectorySet = new Set();
    const changed = journal.mutations.filter((mutation) => mutation.willChange);
    for (let index = 0; index < changed.length; index += 1) {
      const mutation = changed[index];
      const state = await readPathState(mutation.path);
      if (state.revision !== mutation.baseRevision) {
        fail('TRANSACTION_REVISION_CONFLICT', 'Данные изменились во время подготовки резервной копии.', {
          conflicts: [{ path: mutation.path, expectedRevision: mutation.baseRevision, actualRevision: state.revision }]
        });
      }
      const backupFile = state.exists ? `${String(index).padStart(4, '0')}.bin` : null;
      if (backupFile) {
        await atomicWriteRuntime(path.join(transactionBackupDir, backupFile), state.bytes, 0o600);
      }
      const { target } = absoluteManagedPath(mutation.path);
      for (const directory of await missingParentDirectories(target)) createdDirectorySet.add(directory);
      backups.push({
        path: mutation.path,
        exists: state.exists,
        revision: state.revision,
        bytes: state.exists ? state.bytes.length : 0,
        mode: state.mode,
        file: backupFile,
        nextRevision: mutation.nextRevision
      });
    }
    return {
      backups,
      createdDirectories: [...createdDirectorySet].sort((left, right) => right.length - left.length)
    };
  }

  function targetTemporaryPath(target, transactionId, index) {
    return path.join(path.dirname(target), `.${path.basename(target)}.admin-tx-${transactionId}-${index}.tmp`);
  }

  async function atomicWriteTarget(mutation, journal, index, mode = 0o644, writeSource = null) {
    const { target } = await assertManagedPathSafe(mutation.path);
    await fileSystem.mkdir(path.dirname(target), { recursive: true });
    const temporary = targetTemporaryPath(target, journal.transactionId, index);
    await fileSystem.rm(temporary, { force: true }).catch(() => {});
    let handle;
    try {
      handle = await fileSystem.open(temporary, 'wx', mode || 0o644);
      if (writeSource) {
        await writeSource(handle);
      } else if (mutation.payloadRef) {
        await payloadStore.writeToHandle(mutation.payloadRef, handle);
      } else if (Buffer.isBuffer(mutation.bytes)) {
        await handle.writeFile(mutation.bytes);
      } else {
        fail('TRANSACTION_PAYLOAD_REF_INVALID', 'Write mutation does not contain an exact payload source.', {
          path: mutation.path
        });
      }
      await handle.sync();
      await handle.close();
      handle = null;
      await fileSystem.rename(temporary, target);
      await syncDirectory(path.dirname(target));
    } catch (error) {
      await handle?.close().catch(() => {});
      await fileSystem.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function deleteTarget(mutation) {
    const { target } = await assertManagedPathSafe(mutation.path);
    await fileSystem.unlink(target).catch((error) => {
      if (!isMissingError(error)) throw error;
    });
    await syncDirectory(path.dirname(target));
  }

  async function applyMutation(mutation, journal, index) {
    if (mutation.operation === 'write') {
      const backup = journal.backups.find((entry) => entry.path === mutation.path);
      await atomicWriteTarget(mutation, journal, index, backup?.mode ?? 0o644);
    } else {
      await deleteTarget(mutation);
    }
  }

  async function cleanupTemporaryTargets(journal) {
    const changed = journal.mutations.filter((mutation) => mutation.willChange);
    await Promise.all(changed.map(async (mutation, index) => {
      const { target } = absoluteManagedPath(mutation.path);
      await fileSystem.rm(targetTemporaryPath(target, journal.transactionId, index), { force: true }).catch(() => {});
    }));
  }

  async function readBackupBytes(journal, backup) {
    if (!backup.exists || !backup.file) return null;
    if (typeof backup.file !== 'string' || !/^\d{4,}\.bin$/u.test(backup.file)) {
      fail('TRANSACTION_BACKUP_CORRUPT', 'Backup contains an unsafe file name.', {
        transactionId: journal.transactionId,
        path: backup.path
      });
    }
    let bytes;
    const source = path.join(backupRoot, journal.transactionId, backup.file);
    try {
      const stats = await fileSystem.lstat(source);
      const real = await fileSystem.realpath(source);
      if (stats.isSymbolicLink() || !stats.isFile()
        || !isInsideOrEqual(path.join(backupRoot, journal.transactionId), real)) {
        fail('TRANSACTION_BACKUP_CORRUPT', 'Backup path is unsafe.', {
          transactionId: journal.transactionId,
          path: backup.path
        });
      }
      bytes = await fileSystem.readFile(source);
    } catch (error) {
      if (isMissingError(error)) {
        fail('TRANSACTION_BACKUP_MISSING', 'Не найдена обязательная резервная копия.', {
          transactionId: journal.transactionId,
          path: backup.path
        });
      }
      throw error;
    }
    if (revisionForBytes(bytes) !== backup.revision || bytes.length !== backup.bytes) {
      fail('TRANSACTION_BACKUP_CORRUPT', 'Резервная копия повреждена.', {
        transactionId: journal.transactionId,
        path: backup.path
      });
    }
    return bytes;
  }

  async function writeBackupToHandle(journal, backup, destinationHandle) {
    if (!backup.exists || typeof backup.file !== 'string' || !/^\d{4,}\.bin$/u.test(backup.file)) {
      fail('TRANSACTION_BACKUP_CORRUPT', 'Backup contains an unsafe file name.', {
        transactionId: journal.transactionId,
        path: backup.path
      });
    }
    const source = path.join(backupRoot, journal.transactionId, backup.file);
    let sourceHandle;
    const digest = crypto.createHash('sha256');
    let total = 0;
    try {
      const stats = await fileSystem.lstat(source);
      const real = await fileSystem.realpath(source);
      if (stats.isSymbolicLink() || !stats.isFile() || stats.size !== backup.bytes
        || !isInsideOrEqual(path.join(backupRoot, journal.transactionId), real)) {
        fail('TRANSACTION_BACKUP_CORRUPT', 'Backup is corrupt.', {
          transactionId: journal.transactionId,
          path: backup.path
        });
      }
      sourceHandle = await fileSystem.open(source, 'r');
      const chunk = Buffer.allocUnsafe(64 * 1024);
      while (true) {
        const { bytesRead } = await sourceHandle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        const bytes = chunk.subarray(0, bytesRead);
        digest.update(bytes);
        total += bytesRead;
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await destinationHandle.write(bytes, offset, bytes.length - offset, null);
          if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) {
            fail('TRANSACTION_BACKUP_CORRUPT', 'Could not restore exact bytes from backup.', {
              transactionId: journal.transactionId,
              path: backup.path
            });
          }
          offset += bytesWritten;
        }
      }
    } catch (error) {
      if (isMissingError(error)) {
        fail('TRANSACTION_BACKUP_MISSING', 'Required backup is missing.', {
          transactionId: journal.transactionId,
          path: backup.path
        });
      }
      throw error;
    } finally {
      await sourceHandle?.close().catch(() => {});
    }
    if (`sha256:${digest.digest('hex')}:${total}` !== backup.revision || total !== backup.bytes) {
      fail('TRANSACTION_BACKUP_CORRUPT', 'Backup is corrupt.', {
        transactionId: journal.transactionId,
        path: backup.path
      });
    }
  }

  async function removeCreatedDirectories(journal) {
    for (const relativePath of journal.createdDirectories ?? []) {
      const { target } = absoluteManagedPath(relativePath);
      await fileSystem.rmdir(target).catch((error) => {
        if (!isMissingError(error) && error?.code !== 'ENOTEMPTY' && error?.code !== 'EEXIST') throw error;
      });
    }
  }

  async function updateIdempotencyFromJournal(journal) {
    const store = await readIdempotency();
    const entryId = idempotencyEntryId(journal.recoveryClientId, journal.idempotencyKey);
    const existing = store.entries[entryId];
    if (existing && existing.payloadHash !== journal.payloadHash) {
      fail('IDEMPOTENCY_KEY_REUSED', 'Этот ключ уже использован для другого набора изменений.');
    }
    store.entries[entryId] = idempotencyFromJournal(journal);
    await saveIdempotency(store);
  }

  async function rollbackJournal(journal, reason, { injectFaults = true } = {}) {
    if (journal.state !== TRANSACTION_STATES.APPLYING) return journal;
    if (injectFaults) await invokeFault('rollback:before', { transactionId: journal.transactionId, state: journal.state });
    await cleanupTemporaryTargets(journal);

    for (const backup of journal.backups ?? []) {
      const current = await readPathState(backup.path);
      if (current.revision !== backup.revision && current.revision !== backup.nextRevision) {
        fail('TRANSACTION_RECOVERY_CONFLICT', 'Файл был изменён вне транзакции; автоматический откат остановлен.', {
          path: backup.path,
          expectedRevisions: [backup.revision, backup.nextRevision],
          actualRevision: current.revision
        });
      }
    }

    const reverseBackups = [...(journal.backups ?? [])].reverse();
    for (let index = 0; index < reverseBackups.length; index += 1) {
      const backup = reverseBackups[index];
      if (backup.exists) {
        await atomicWriteTarget(
          { path: backup.path },
          journal,
          index,
          backup.mode ?? 0o644,
          (handle) => writeBackupToHandle(journal, backup, handle)
        );
      } else {
        await deleteTarget({ path: backup.path });
      }
    }
    await removeCreatedDirectories(journal);
    if (injectFaults) await invokeFault('rollback:after-restore', { transactionId: journal.transactionId });

    journal.state = TRANSACTION_STATES.ROLLED_BACK;
    journal.rolledBackAt = timestamp(now);
    journal.rollbackReason = String(reason || 'rollback').slice(0, 240);
    journal.result = {
      transactionId: journal.transactionId,
      state: TRANSACTION_STATES.ROLLED_BACK,
      result: TRANSACTION_STATES.ROLLED_BACK,
      payloadHash: journal.payloadHash,
      restoredPaths: (journal.backups ?? []).map((entry) => entry.path)
    };
    await saveJournal(journal);
    await updateIdempotencyFromJournal(journal);
    if (injectFaults) await invokeFault('rollback:after', { transactionId: journal.transactionId, state: journal.state });
    return journal;
  }

  async function commitJournal(journal) {
    const revisions = [];
    for (const mutation of journal.mutations.filter((item) => item.willChange)) {
      const state = await readPathState(mutation.path);
      if (state.revision !== mutation.nextRevision) {
        fail('TRANSACTION_COMMIT_VERIFY_FAILED', 'Итоговые байты транзакции не совпали с планом.', {
          path: mutation.path,
          expectedRevision: mutation.nextRevision,
          actualRevision: state.revision
        });
      }
      revisions.push({ path: mutation.path, revision: state.revision });
    }
    journal.state = TRANSACTION_STATES.COMMITTED;
    journal.committedAt = timestamp(now);
    journal.result = {
      transactionId: journal.transactionId,
      state: TRANSACTION_STATES.COMMITTED,
      result: TRANSACTION_STATES.COMMITTED,
      payloadHash: journal.payloadHash,
      changedPaths: journal.mutations.filter((item) => item.willChange).map((item) => item.path),
      revisions
    };
    await saveJournal(journal);
    return journal;
  }

  async function completeJournalDuringRecovery(journal, lease) {
    const changed = journal.mutations.filter((mutation) => mutation.willChange);
    for (let index = 0; index < changed.length; index += 1) {
      const mutation = changed[index];
      const current = await readPathState(mutation.path);
      if (current.revision === mutation.nextRevision) continue;
      if (current.revision !== mutation.baseRevision) {
        fail('TRANSACTION_RECOVERY_CONFLICT', 'Невозможно безопасно завершить прерванную транзакцию.', {
          path: mutation.path,
          expectedRevisions: [mutation.baseRevision, mutation.nextRevision],
          actualRevision: current.revision
        });
      }
      await lease.refresh();
      await applyMutation(mutation, journal, index);
      journal.appliedCount = index + 1;
      await saveJournal(journal);
    }
    await cleanupTemporaryTargets(journal);
    await commitJournal(journal);
    await updateIdempotencyFromJournal(journal);
    return journal;
  }

  function collectEmbeddedPayloadRefs(value, referenced) {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && Object.hasOwn(value, 'payloadRef')) {
      try {
        referenced.add(normalizePayloadRef(value.payloadRef).sha256);
      } catch {
        // Unknown metadata is not trusted as a reference and cannot make a blob collectible.
      }
    }
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      collectEmbeddedPayloadRefs(item, referenced);
    }
  }

  async function referencedPayloadDigestsUnderLock() {
    const referenced = new Set();
    const journalIds = new Set();
    for await (const journal of iterateJournals()) {
      journalIds.add(journal.transactionId);
      for (const mutation of journal.mutations) {
        if (mutation.operation === 'write') referenced.add(normalizePayloadRef(mutation.payloadRef).sha256);
      }
      collectEmbeddedPayloadRefs(journal.metadata, referenced);
      collectEmbeddedPayloadRefs(journal.result, referenced);
    }
    const idempotency = await readIdempotency();
    for (const entry of Object.values(idempotency.entries)) {
      if (entry?.transactionId !== null && entry?.transactionId !== undefined
        && (!TRANSACTION_ID_RE.test(String(entry.transactionId)) || !journalIds.has(entry.transactionId))) {
        fail('IDEMPOTENCY_STORE_CORRUPT', 'Idempotency entry references a missing transaction journal.', {
          transactionId: String(entry?.transactionId ?? '')
        });
      }
    }
    collectEmbeddedPayloadRefs(idempotency, referenced);
    return referenced;
  }

  async function garbageCollectPayloadsUnderLock() {
    const referenced = await referencedPayloadDigestsUnderLock();
    return payloadStore.garbageCollect(referenced);
  }

  async function recoverUnderLock(lease) {
    await payloadStore.cleanupTemporaryFiles();
    await migrateLegacyJournalsUnderLock();
    await invokeFault('recovery:before', {});
    const recovered = [];
    for await (const journal of iterateJournals()) {
      if (journal.state !== TRANSACTION_STATES.APPLYING) continue;
      await lease.refresh();
      if (recoveryMode === 'complete') {
        await completeJournalDuringRecovery(journal, lease);
      } else {
        await rollbackJournal(journal, 'startup-recovery', { injectFaults: false });
      }
      recovered.push({ transactionId: journal.transactionId, state: journal.state });
    }
    await reconcileIdempotencyUnderLock();
    await garbageCollectPayloadsUnderLock();
    await invokeFault('recovery:after', { recovered: clone(recovered) });
    return Object.freeze({ recovered: Object.freeze(recovered) });
  }

  async function applyingTransactions() {
    const transactionIds = [];
    for await (const journal of iterateJournals()) {
      if (journal.state === TRANSACTION_STATES.APPLYING) transactionIds.push(journal.transactionId);
    }
    return transactionIds;
  }

  async function assertNoApplyingTransactions() {
    const transactionIds = await applyingTransactions();
    if (transactionIds.length) {
      fail(
        'TRANSACTION_RECOVERY_REQUIRED',
        'Обнаружена незавершённая транзакция. Сначала выполните восстановление.',
        { transactionIds }
      );
    }
    return true;
  }

  async function initialize() {
    if (initialized) return Object.freeze({ recovered: Object.freeze([]) });
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      await ensureLayout();
      const result = await withRepoLock((lease) => recoverUnderLock(lease));
      initialized = true;
      return result;
    })();
    try {
      return await initializePromise;
    } finally {
      if (!initialized) initializePromise = null;
    }
  }

  async function ensureInitialized() {
    if (!initialized) await initialize();
  }

  async function recover() {
    await ensureLayout();
    const result = await withRepoLock((lease) => recoverUnderLock(lease));
    initialized = true;
    return result;
  }

  async function garbageCollectPayloads() {
    await ensureInitialized();
    return withRepoLock(async () => {
      await assertNoApplyingTransactions();
      return garbageCollectPayloadsUnderLock();
    });
  }

  async function preview(request) {
    await ensureInitialized();
    const normalized = normalizeRequest(request ?? {});
    return withRepoLock(async (lease) => {
      await lease.refresh();
      await assertNoApplyingTransactions();
      const store = await reconcileIdempotencyUnderLock();
      const entryId = idempotencyEntryId(normalized.recoveryClientId, normalized.idempotencyKey);
      const existing = store.entries[entryId];
      if (existing) {
        if (existing.recoveryClientId !== normalized.recoveryClientId
          || existing.idempotencyKey !== normalized.idempotencyKey
          || (existing.payloadHash !== normalized.payloadHash
            && existing.payloadHash !== normalized.legacyPayloadHash())) {
          fail('IDEMPOTENCY_KEY_REUSED', 'Этот ключ уже использован для другого набора изменений.', {
            recoveryClientId: normalized.recoveryClientId,
            idempotencyKey: normalized.idempotencyKey
          });
        }
        if (existing.owner !== normalized.owner) {
          fail('TRANSACTION_BINDING_MISMATCH', 'Транзакция принадлежит другой сессии.');
        }
        if (existing.state === TRANSACTION_STATES.NO_OP) return publicNoOp(existing, true);
        const journal = await loadJournal(existing.transactionId);
        return journal.state === TRANSACTION_STATES.COMMITTED || journal.state === TRANSACTION_STATES.ROLLED_BACK
          ? publicApplyResult(journal, true)
          : publicPreview(journal, true);
      }

      const allPaths = [
        ...normalized.mutations.map((mutation) => mutation.path),
        ...normalized.readSet.map((entry) => entry.path)
      ];
      const revisions = await currentRevisions(allPaths);
      const expectedByPath = new Map();
      for (const mutation of normalized.mutations) {
        if (mutation.expectedRevision) expectedByPath.set(mutation.path, mutation.expectedRevision);
      }
      for (const entry of normalized.readSet) {
        if (!entry.expectedRevision) continue;
        const existingExpected = expectedByPath.get(entry.path);
        if (existingExpected && existingExpected !== entry.expectedRevision) {
          fail('TRANSACTION_INPUT_INVALID', 'readSet и mutation содержат разные ожидаемые ревизии.', { path: entry.path });
        }
        expectedByPath.set(entry.path, entry.expectedRevision);
      }
      checkExpectedRevisions(revisions, expectedByPath);
      const revisionByPath = new Map(revisions.map((entry) => [entry.path, entry.revision]));
      const mutations = normalized.mutations.map((mutation) => {
        const baseRevision = revisionByPath.get(mutation.path);
        const nextRevision = mutation.operation === 'delete' ? 'missing' : mutation.nextRevision;
        return { ...mutation, baseRevision, nextRevision, willChange: baseRevision !== nextRevision };
      });
      await invokeFault('preview:after-read', { paths: allPaths.length });

      if (!mutations.some((mutation) => mutation.willChange)) {
        const noOpEntry = {
          recoveryClientId: normalized.recoveryClientId,
          idempotencyKey: normalized.idempotencyKey,
          payloadHash: normalized.payloadHash,
          owner: normalized.owner,
          transactionId: null,
          state: TRANSACTION_STATES.NO_OP,
          result: TRANSACTION_STATES.NO_OP,
          metadata: clone(normalized.metadata),
          updatedAt: timestamp(now)
        };
        store.entries[entryId] = noOpEntry;
        await saveIdempotency(store);
        await invokeFault('preview:after-idempotency', { state: TRANSACTION_STATES.NO_OP });
        return publicNoOp(noOpEntry);
      }

      const persistedMutations = [];
      for (const mutation of mutations) {
        if (mutation.operation === 'delete') {
          persistedMutations.push({ ...mutation });
          continue;
        }
        const payloadRef = await payloadStore.put(mutation.contentBytes);
        if (payloadRef.sha256 !== mutation.payloadRef.sha256 || payloadRef.size !== mutation.payloadRef.size) {
          fail('TRANSACTION_PAYLOAD_CORRUPT', 'Stored payload reference differs from the normalized transaction intent.', {
            path: mutation.path
          });
        }
        const { contentBytes, ...persistentMutation } = mutation;
        persistedMutations.push({ ...persistentMutation, payloadRef: { ...payloadRef } });
      }

      const createdAtMs = now();
      const transactionId = crypto.randomUUID();
      const journal = {
        version: JOURNAL_VERSION,
        transactionId,
        state: TRANSACTION_STATES.PREPARED,
        owner: normalized.owner,
        recoveryClientId: normalized.recoveryClientId,
        idempotencyKey: normalized.idempotencyKey,
        payloadHash: normalized.payloadHash,
        metadata: clone(normalized.metadata),
        createdAt: timestamp(() => createdAtMs),
        updatedAt: timestamp(() => createdAtMs),
        expiresAt: timestamp(() => createdAtMs + transactionTtlMs),
        expiresAtMs: createdAtMs + transactionTtlMs,
        revisions,
        mutations: persistedMutations,
        backups: [],
        createdDirectories: [],
        appliedCount: 0,
        result: null
      };
      await invokeFault('preview:before-journal', { transactionId });
      await saveJournal(journal);
      await invokeFault('preview:after-journal', { transactionId, state: journal.state });
      store.entries[entryId] = idempotencyFromJournal(journal);
      await saveIdempotency(store);
      await invokeFault('preview:after-idempotency', { transactionId, state: journal.state });
      return publicPreview(journal);
    });
  }

  async function journalForBeforeApply(journal) {
    const projection = clone(journal);
    for (const mutation of projection.mutations) {
      if (mutation.operation !== 'write') continue;
      const bytes = await payloadStore.read(mutation.payloadRef);
      mutation.contentBase64 = bytes.toString('base64');
    }
    return projection;
  }

  async function apply(request = {}, hooks = {}) {
    await ensureInitialized();
    const owner = ensureNonEmptyString(request.owner, 'owner');
    const recoveryClientId = ensureNonEmptyString(request.recoveryClientId, 'recoveryClientId');
    const idempotencyKey = ensureNonEmptyString(request.idempotencyKey, 'idempotencyKey');
    const transactionId = ensureNonEmptyString(request.transactionId, 'transactionId');
    if (!TRANSACTION_ID_RE.test(transactionId)) fail('TRANSACTION_ID_INVALID', 'Некорректный идентификатор транзакции.');

    return withRepoLock(async (lease) => {
      let journal = await loadJournal(transactionId);
      try {
        await assertNoApplyingTransactions();
        const store = await reconcileIdempotencyUnderLock();
        const entryId = idempotencyEntryId(recoveryClientId, idempotencyKey);
        const idempotency = store.entries[entryId];
        if (!idempotency || idempotency.transactionId !== transactionId
          || journal.owner !== owner || journal.recoveryClientId !== recoveryClientId
          || journal.idempotencyKey !== idempotencyKey) {
          fail('TRANSACTION_BINDING_MISMATCH', 'Параметры apply не соответствуют подготовленной транзакции.');
        }
        if (request.payloadHash && request.payloadHash !== journal.payloadHash) {
          fail('TRANSACTION_PAYLOAD_MISMATCH', 'Payload транзакции изменился после preview.');
        }
        if (journal.state === TRANSACTION_STATES.COMMITTED) return publicApplyResult(journal, true);
        if (journal.state === TRANSACTION_STATES.ROLLED_BACK) {
          fail('TRANSACTION_ROLLED_BACK', 'Транзакция уже была отменена и не может быть применена повторно.', { transactionId });
        }
        if (journal.state !== TRANSACTION_STATES.PREPARED) {
          fail('TRANSACTION_STATE_INVALID', 'Транзакция находится в некорректном состоянии.', {
            transactionId,
            state: journal.state
          });
        }
        if (journal.expiresAtMs <= now()) {
          fail('TRANSACTION_EXPIRED', 'Срок действия preview истёк. Подготовьте изменения заново.', { transactionId });
        }

        await invokeFault('apply:after-lock', { transactionId, state: journal.state });
        await lease.refresh();
        const actualRevisions = await currentRevisions(journal.revisions.map((entry) => entry.path));
        checkExpectedRevisions(actualRevisions, new Map(journal.revisions.map((entry) => [entry.path, entry.revision])));
        await invokeFault('apply:after-recheck', { transactionId, state: journal.state });

        if (hooks.beforeApply !== undefined) {
          if (typeof hooks.beforeApply !== 'function') {
            fail('TRANSACTION_INPUT_INVALID', 'beforeApply должен быть функцией проверки транзакции.');
          }
          const hookJournal = await journalForBeforeApply(journal);
          await hooks.beforeApply(Object.freeze({
            transactionId,
            journal: Object.freeze(hookJournal),
            repoRoot,
            refreshLease: lease.refresh
          }));
          await lease.refresh();
        }

        const backupPlan = await createBackups(journal);
        journal.backups = backupPlan.backups;
        journal.createdDirectories = backupPlan.createdDirectories;
        await invokeFault('apply:after-backup', { transactionId, backups: journal.backups.length });
        journal.state = TRANSACTION_STATES.APPLYING;
        journal.applyingAt = timestamp(now);
        journal.appliedCount = 0;
        await saveJournal(journal);
        await updateIdempotencyFromJournal(journal);
        await invokeFault('apply:after-journal-applying', { transactionId, state: journal.state });

        const changed = journal.mutations.filter((mutation) => mutation.willChange);
        for (let index = 0; index < changed.length; index += 1) {
          const mutation = changed[index];
          await lease.refresh();
          await invokeFault('apply:before-mutation', { transactionId, index, path: mutation.path });
          await applyMutation(mutation, journal, index);
          await invokeFault('apply:after-mutation-write', { transactionId, index, path: mutation.path });
          journal.appliedCount = index + 1;
          await saveJournal(journal);
          await invokeFault('apply:after-mutation', { transactionId, index, path: mutation.path });
        }
        await cleanupTemporaryTargets(journal);
        await invokeFault('apply:before-commit', { transactionId, state: journal.state });
        await commitJournal(journal);
        await invokeFault('apply:after-commit-journal', { transactionId, state: journal.state });
        await updateIdempotencyFromJournal(journal);
        await invokeFault('apply:after-commit', { transactionId, state: journal.state });
        return publicApplyResult(journal);
      } catch (error) {
        if (isSimulatedCrash(error)) throw error;
        if (journal.state === TRANSACTION_STATES.APPLYING) {
          try {
            journal = await rollbackJournal(journal, error?.code || error?.name || 'apply-error');
          } catch (rollbackError) {
            throw new TransactionEngineError(
              'TRANSACTION_ROLLBACK_FAILED',
              'Применение остановлено, а автоматический откат не завершён. Требуется recovery.',
              {
                transactionId,
                applyErrorCode: error?.code || 'UNKNOWN',
                rollbackErrorCode: rollbackError?.code || 'UNKNOWN'
              }
            );
          }
        }
        throw error;
      }
    });
  }

  async function getTransaction(transactionId) {
    await ensureInitialized();
    return clone(await loadJournal(transactionId));
  }

  async function listHistory() {
    await ensureInitialized();
    const finalStates = new Set([TRANSACTION_STATES.COMMITTED, TRANSACTION_STATES.ROLLED_BACK]);
    const history = [];
    for await (const journal of iterateJournals()) {
      if (!finalStates.has(journal.state)) continue;
      history.push(Object.freeze({
        transactionId: journal.transactionId,
        state: journal.state,
        owner: journal.owner,
        payloadHash: journal.payloadHash,
        createdAt: journal.createdAt,
        updatedAt: journal.updatedAt,
        metadata: Object.freeze(clone(journal.metadata ?? {})),
        changedPaths: Object.freeze(journal.mutations.filter((item) => item.willChange).map((item) => item.path))
      }));
    }
    history.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return Object.freeze(history);
  }

  async function assertStable() {
    await ensureInitialized();
    return withRepoLock(async () => {
      await assertNoApplyingTransactions();
      return true;
    });
  }

  async function withStableRead(callback) {
    if (typeof callback !== 'function') {
      fail('TRANSACTION_INPUT_INVALID', 'withStableRead ожидает функцию чтения.');
    }
    await ensureInitialized();
    return withRepoLock(async (lease) => {
      await assertNoApplyingTransactions();
      return callback(Object.freeze({
        repoRoot,
        refreshLease: lease.refresh
      }));
    });
  }

  async function createRestorePlan(transactionId) {
    await ensureInitialized();
    return withRepoLock(async () => {
      await assertNoApplyingTransactions();
      const journal = await loadJournal(transactionId);
      if (journal.state !== TRANSACTION_STATES.COMMITTED) {
        fail('TRANSACTION_RESTORE_NOT_AVAILABLE', 'Восстановление доступно только для завершённой транзакции.', {
          transactionId,
          state: journal.state
        });
      }
      const mutations = [];
      for (const backup of journal.backups ?? []) {
        if (backup.exists) {
          const bytes = await readBackupBytes(journal, backup);
          mutations.push(Object.freeze({
            path: backup.path,
            operation: 'write',
            bytesBase64: bytes.toString('base64'),
            expectedRevision: backup.nextRevision
          }));
        } else {
          mutations.push(Object.freeze({
            path: backup.path,
            operation: 'delete',
            expectedRevision: backup.nextRevision
          }));
        }
      }
      const restoreMetadata = {
        userSummary: `Восстановление версии до транзакции ${transactionId}`,
        restoresTransactionId: transactionId
      };
      if (journal.metadata?.baseHead) restoreMetadata.baseHead = journal.metadata.baseHead;
      return Object.freeze({
        restoresTransactionId: transactionId,
        mutations: Object.freeze(mutations),
        metadata: Object.freeze(restoreMetadata)
      });
    });
  }

  return Object.freeze({
    initialize,
    recover,
    preview,
    apply,
    getTransaction,
    listHistory,
    garbageCollectPayloads,
    assertStable,
    withStableRead,
    createRestorePlan,
    runtimePaths: Object.freeze({ repoRoot, runtimeDir, journalDir, backupRoot, payloadRoot, idempotencyPath, lockPath })
  });
}

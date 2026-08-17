import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const PUBLISH_MANIFEST_VERSION = 1;
export const DEFAULT_PUBLISH_REFS = Object.freeze({
  candidate: 'v4-product-final-candidate',
  preview: 'preview',
  protected: 'main'
});
export const CONTENT_ONLY_GATES = Object.freeze([
  'schema-transaction-validation',
  'targeted-admin-tests',
  'astro-check',
  'build-media-prepare',
  'h5-media-budgets',
  'deploy-isolation',
  'exact-media-references',
  'publish-plan-consistency'
]);

const TRANSACTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const SHA_RE = /^[a-f0-9]{40}$/u;
const GIT_OBJECT_RE = /^(?:missing|[a-f0-9]{40})$/u;
const REVISION_RE = /^(?:missing|sha256:[a-f0-9]{64}:[0-9]+)$/u;
const COLLECTIONS = new Set([
  'jobs',
  'product-categories',
  'product-sections',
  'products',
  'projects',
  'services',
  'site-settings',
  'static-pages'
]);
const CANONICAL_UPLOAD_RE = /^public\/uploads\/[a-f0-9]{64}\.(?:jpg|png|webp|mp4|webm)$/u;
const SOURCE_ADMIN_PREFIXES = [
  '.github/', 'tools/', 'src/pages/admin/', 'src/components/admin/', 'src/scripts/admin/',
  'src/content-schemas.', 'src/content.config.', 'package.json', 'package-lock.json',
  'astro.config.', 'tsconfig.json'
];

export class PublishPlanError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'PublishPlanError';
    this.code = code;
    this.status = options.status ?? 409;
    if (options.details !== undefined) this.details = options.details;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function normalizePath(value) {
  const candidate = String(value ?? '');
  if (!candidate
    || candidate !== candidate.trim()
    || candidate.includes('\\')
    || candidate.includes('\0')
    || path.posix.isAbsolute(candidate)
    || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new PublishPlanError('PUBLISH_PATH_INVALID', 'Некорректный transaction path.', {
      details: { path: candidate }
    });
  }
  return candidate;
}

function safePublishRoute(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !/[\\?#\u0000-\u001f\u007f]/u.test(value)
    && !/%(?:2e|2f|5c)/iu.test(value)
    && !value.split('/').some((segment) => segment === '.' || segment === '..');
}

function normalizeRouteContract(affectedRoutes, routeExpectations) {
  if (!Array.isArray(affectedRoutes) || !Array.isArray(routeExpectations)
    || affectedRoutes.length === 0 || routeExpectations.length === 0
    || affectedRoutes.length > 500 || routeExpectations.length > 500) {
    throw new PublishPlanError(
      'PUBLISH_MANIFEST_ROUTE_EXPECTATIONS_REQUIRED',
      'Committed manifest requires typed smoke expectations for every affected route.',
    );
  }
  const routes = [...new Set(affectedRoutes)];
  if (routes.some((route) => !safePublishRoute(route))) {
    throw new PublishPlanError('PUBLISH_MANIFEST_ROUTE_INVALID', 'affectedRoutes contains an invalid route.');
  }
  routes.sort();
  const byRoute = new Map();
  for (const item of routeExpectations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'expected,route'
      || !safePublishRoute(item.route)
      || !['html', 'not-found'].includes(item.expected)) {
      throw new PublishPlanError(
        'PUBLISH_MANIFEST_ROUTE_EXPECTATION_INVALID',
        'routeExpectations contains an invalid typed smoke expectation.',
      );
    }
    const previous = byRoute.get(item.route);
    if (previous && previous !== item.expected) {
      throw new PublishPlanError(
        'PUBLISH_ROUTE_EXPECTATION_CONFLICT',
        'The same route has contradictory smoke expectations.',
        { details: { route: item.route, previous, expected: item.expected } },
      );
    }
    byRoute.set(item.route, item.expected);
  }
  const expectationRoutes = [...byRoute.keys()].sort();
  if (routes.length !== expectationRoutes.length
    || routes.some((route, index) => route !== expectationRoutes[index])) {
    throw new PublishPlanError(
      'PUBLISH_MANIFEST_ROUTE_EXPECTATIONS_MISMATCH',
      'affectedRoutes and routeExpectations must describe the same exact route set.',
    );
  }
  return {
    affectedRoutes: routes,
    routeExpectations: expectationRoutes.map((route) => ({ route, expected: byRoute.get(route) })),
  };
}

function assertSha(value, field) {
  const normalized = String(value ?? '').toLowerCase();
  if (!SHA_RE.test(normalized)) {
    throw new PublishPlanError('PUBLISH_SHA_INVALID', `Некорректный ${field}.`);
  }
  return normalized;
}

function assertRevision(value, field) {
  const normalized = String(value ?? '').toLowerCase();
  if (!REVISION_RE.test(normalized)) {
    throw new PublishPlanError('PUBLISH_REVISION_INVALID', `Некорректный ${field}.`);
  }
  return normalized;
}

function assertGitObject(value, field) {
  const normalized = String(value ?? '').toLowerCase();
  if (!GIT_OBJECT_RE.test(normalized)) {
    throw new PublishPlanError('PUBLISH_GIT_OBJECT_INVALID', `Некорректный ${field}.`);
  }
  return normalized;
}

function assertTransactionId(value, field = 'transactionId') {
  const normalized = String(value ?? '');
  if (!TRANSACTION_ID_RE.test(normalized)) {
    throw new PublishPlanError('PUBLISH_TRANSACTION_ID_INVALID', `Некорректный ${field}.`);
  }
  return normalized;
}

function buffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(String(value ?? ''), 'utf8');
}

export function hashPublishBytes(value) {
  if (value === null || value === undefined) return 'missing';
  const bytes = buffer(value);
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}:${bytes.length}`;
}

export function createPublishGitEnvironment(environment = process.env) {
  const safe = { ...environment };
  for (const key of Object.keys(safe)) {
    const upperKey = key.toUpperCase();
    if (upperKey === 'GIT_DIR'
      || upperKey === 'GIT_WORK_TREE'
      || upperKey === 'GIT_COMMON_DIR'
      || upperKey === 'GIT_INDEX_FILE'
      || upperKey === 'GIT_OBJECT_DIRECTORY'
      || upperKey === 'GIT_ALTERNATE_OBJECT_DIRECTORIES'
      || upperKey === 'GIT_CONFIG_COUNT'
      || upperKey === 'GIT_CONFIG_PARAMETERS'
      || upperKey === 'GIT_CONFIG_GLOBAL'
      || upperKey === 'GIT_CONFIG_SYSTEM'
      || upperKey === 'GIT_CONFIG_NOSYSTEM'
      || upperKey === 'GIT_TERMINAL_PROMPT'
      || /^GIT_CONFIG_(?:KEY|VALUE)_[0-9]+$/u.test(upperKey)) {
      delete safe[key];
    }
  }
  safe.GIT_TERMINAL_PROMPT = '0';
  return safe;
}

export function classifyPublishPath(value) {
  let relativePath;
  try {
    relativePath = normalizePath(value);
  } catch {
    return Object.freeze({ path: String(value ?? ''), allowed: false, kind: 'invalid', profile: 'forbidden' });
  }
  const contentMatch = relativePath.match(/^src\/content\/([^/]+)\/([a-z0-9]+(?:-[a-z0-9]+)*\.json)$/u);
  if (contentMatch && COLLECTIONS.has(contentMatch[1])) {
    return Object.freeze({ path: relativePath, allowed: true, kind: 'content-record', profile: 'content-only' });
  }
  if (relativePath === 'src/data/navigation.json' || relativePath === 'src/data/yandex.json') {
    return Object.freeze({ path: relativePath, allowed: true, kind: 'data-singleton', profile: 'content-only' });
  }
  if (CANONICAL_UPLOAD_RE.test(relativePath)) {
    return Object.freeze({ path: relativePath, allowed: true, kind: 'canonical-upload', profile: 'content-only' });
  }
  if (relativePath.startsWith('public/_media/h5/')
    || relativePath.startsWith('.admin-runtime/')
    || relativePath.startsWith('dist/')
    || relativePath.includes('/staging/')
    || relativePath.endsWith('.tmp')) {
    return Object.freeze({ path: relativePath, allowed: false, kind: 'runtime-generated', profile: 'forbidden' });
  }
  if (SOURCE_ADMIN_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix))) {
    return Object.freeze({ path: relativePath, allowed: false, kind: 'source-admin', profile: 'source-admin-release' });
  }
  return Object.freeze({ path: relativePath, allowed: false, kind: 'unknown', profile: 'source-admin-release' });
}

export function validateCommittedTransactionManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PublishPlanError('PUBLISH_MANIFEST_INVALID', 'Transaction manifest должен быть объектом.');
  }
  if (input.version !== PUBLISH_MANIFEST_VERSION || input.kind !== 'smu1-content-transaction') {
    throw new PublishPlanError('PUBLISH_MANIFEST_VERSION', 'Неизвестная версия transaction manifest.');
  }
  const transactionId = assertTransactionId(input.transactionId);
  if (input.state !== 'committed') {
    throw new PublishPlanError('PUBLISH_TRANSACTION_NOT_COMMITTED', 'Публиковать можно только committed transaction.', {
      details: { transactionId, state: input.state }
    });
  }
  const committedAtMs = Date.parse(input.committedAt);
  if (!Number.isFinite(committedAtMs)) {
    throw new PublishPlanError('PUBLISH_MANIFEST_TIME_INVALID', 'Некорректный committedAt.', { details: { transactionId } });
  }
  const baseHead = assertSha(input.baseHead, 'baseHead');
  if (input.dependencies !== undefined && !Array.isArray(input.dependencies)) {
    throw new PublishPlanError('PUBLISH_MANIFEST_DEPENDENCIES_INVALID', 'dependencies must be an array.');
  }
  const dependencies = [...new Set((input.dependencies ?? []).map((value) => assertTransactionId(value, 'dependency')))].sort();
  if (!Array.isArray(input.mutations) || input.mutations.length === 0) {
    throw new PublishPlanError('PUBLISH_MANIFEST_EMPTY', 'Committed transaction manifest не содержит mutations.', {
      details: { transactionId }
    });
  }
  const seenPaths = new Set();
  const mutations = input.mutations.map((mutation) => {
    const relativePath = normalizePath(mutation?.path);
    if (seenPaths.has(relativePath)) {
      throw new PublishPlanError('PUBLISH_MANIFEST_DUPLICATE_PATH', 'Один path повторяется внутри transaction.', {
        details: { transactionId, path: relativePath }
      });
    }
    seenPaths.add(relativePath);
    const operation = String(mutation?.operation ?? '');
    if (!['write', 'delete'].includes(operation)) {
      throw new PublishPlanError('PUBLISH_MANIFEST_OPERATION', 'Mutation operation должна быть write/delete.');
    }
    const beforeHash = assertRevision(mutation.beforeHash ?? mutation.baseRevision, 'beforeHash');
    const afterHash = assertRevision(mutation.afterHash ?? mutation.nextRevision, 'afterHash');
    const hasBeforeGitOid = mutation.beforeGitOid !== undefined;
    const hasAfterGitOid = mutation.afterGitOid !== undefined;
    if (hasBeforeGitOid !== hasAfterGitOid) {
      throw new PublishPlanError('PUBLISH_MANIFEST_GIT_OBJECT_PAIR', 'beforeGitOid and afterGitOid must be provided together.', {
        details: { transactionId, path: relativePath }
      });
    }
    const beforeGitOid = hasBeforeGitOid ? assertGitObject(mutation.beforeGitOid, 'beforeGitOid') : undefined;
    const afterGitOid = hasAfterGitOid ? assertGitObject(mutation.afterGitOid, 'afterGitOid') : undefined;
    if ((operation === 'delete') !== (afterHash === 'missing')) {
      throw new PublishPlanError('PUBLISH_MANIFEST_OPERATION_HASH', 'Operation не соответствует afterHash.', {
        details: { transactionId, path: relativePath }
      });
    }
    if (afterGitOid !== undefined && (operation === 'delete') !== (afterGitOid === 'missing')) {
      throw new PublishPlanError('PUBLISH_MANIFEST_OPERATION_GIT_OBJECT', 'Operation does not match afterGitOid.', {
        details: { transactionId, path: relativePath }
      });
    }
    if (beforeGitOid !== undefined && (beforeHash === 'missing') !== (beforeGitOid === 'missing')) {
      throw new PublishPlanError('PUBLISH_MANIFEST_BEFORE_GIT_OBJECT', 'beforeHash absence does not match beforeGitOid.', {
        details: { transactionId, path: relativePath }
      });
    }
    if (beforeHash === afterHash) {
      throw new PublishPlanError('PUBLISH_MANIFEST_NO_OP', 'Committed manifest не должен содержать no-op mutation.', {
        details: { transactionId, path: relativePath }
      });
    }
    return Object.freeze({
      path: relativePath,
      operation,
      beforeHash,
      afterHash,
      ...(beforeGitOid === undefined ? {} : { beforeGitOid, afterGitOid })
    });
  }).sort((left, right) => left.path.localeCompare(right.path));
  const routeContract = normalizeRouteContract(input.affectedRoutes, input.routeExpectations);
  if (input.canonicalMedia !== undefined && !Array.isArray(input.canonicalMedia)) {
    throw new PublishPlanError('PUBLISH_CANONICAL_MEDIA_INVALID', 'canonicalMedia must be an array.');
  }
  const canonicalMedia = [...new Set((input.canonicalMedia ?? []).map(normalizePath))].sort();
  const mutationsByPath = new Map(mutations.map((mutation) => [mutation.path, mutation]));
  for (const mediaPath of canonicalMedia) {
    if (classifyPublishPath(mediaPath).kind !== 'canonical-upload') {
      throw new PublishPlanError('PUBLISH_CANONICAL_MEDIA_INVALID', 'canonicalMedia содержит неканонический path.', {
        details: { transactionId, path: mediaPath }
      });
    }
    if (mutationsByPath.get(mediaPath)?.operation !== 'write') {
      throw new PublishPlanError('PUBLISH_CANONICAL_MEDIA_NOT_MUTATED', 'canonicalMedia must be included as a write mutation.', {
        details: { transactionId, path: mediaPath }
      });
    }
  }
  for (const mutation of mutations) {
    if (mutation.operation === 'write'
      && classifyPublishPath(mutation.path).kind === 'canonical-upload'
      && !canonicalMedia.includes(mutation.path)) {
      throw new PublishPlanError('PUBLISH_CANONICAL_MEDIA_UNDECLARED', 'Canonical upload mutations must be declared in canonicalMedia.', {
        details: { transactionId, path: mutation.path }
      });
    }
  }
  return deepFreeze({
    version: PUBLISH_MANIFEST_VERSION,
    kind: 'smu1-content-transaction',
    transactionId,
    state: 'committed',
    committedAt: new Date(committedAtMs).toISOString(),
    committedAtMs,
    baseHead,
    dependencies,
    mutations,
    affectedRoutes: routeContract.affectedRoutes,
    routeExpectations: routeContract.routeExpectations,
    canonicalMedia,
    summary: String(input.summary ?? input.userSummary ?? 'Изменение контента').slice(0, 500)
  });
}

export function createCommittedTransactionManifest(input) {
  return validateCommittedTransactionManifest({
    version: PUBLISH_MANIFEST_VERSION,
    kind: 'smu1-content-transaction',
    state: 'committed',
    ...input
  });
}

function orderedManifests(manifests) {
  if (!Array.isArray(manifests)) {
    throw new PublishPlanError('PUBLISH_MANIFESTS_INVALID', 'manifests должен быть массивом.');
  }
  const checked = manifests.map(validateCommittedTransactionManifest)
    .sort((left, right) => left.committedAtMs - right.committedAtMs || left.transactionId.localeCompare(right.transactionId));
  const ids = new Set();
  for (const manifest of checked) {
    if (ids.has(manifest.transactionId)) {
      throw new PublishPlanError('PUBLISH_MANIFEST_ID_DUPLICATE', 'transactionId повторяется.', {
        details: { transactionId: manifest.transactionId }
      });
    }
    ids.add(manifest.transactionId);
  }
  return checked;
}

function assertNoDependencyCycle(byId) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new PublishPlanError('PUBLISH_DEPENDENCY_CYCLE', 'Transaction dependencies содержат цикл.', {
        details: { transactionId: id }
      });
    }
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (byId.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

export function resolveTransactionSelection(options = {}) {
  const ordered = orderedManifests(options.manifests ?? []);
  const byId = new Map(ordered.map((manifest) => [manifest.transactionId, manifest]));
  assertNoDependencyCycle(byId);
  const orderIndex = new Map(ordered.map((manifest, index) => [manifest.transactionId, index]));
  for (const manifest of ordered) {
    for (const dependency of manifest.dependencies) {
      if (byId.has(dependency) && orderIndex.get(dependency) >= orderIndex.get(manifest.transactionId)) {
        throw new PublishPlanError('PUBLISH_DEPENDENCY_CHRONOLOGY', 'A transaction dependency must precede its dependent transaction.', {
          details: { transactionId: manifest.transactionId, dependency }
        });
      }
    }
  }
  const published = new Set((options.publishedTransactionIds ?? []).map((id) => assertTransactionId(id)));
  const selected = new Set((options.selectedTransactionIds ?? []).map((id) => assertTransactionId(id)));
  for (const id of selected) {
    if (!byId.has(id) && !published.has(id)) {
      throw new PublishPlanError('PUBLISH_TRANSACTION_NOT_FOUND', 'Выбранная transaction не найдена.', { details: { transactionId: id } });
    }
  }

  const automaticDependencies = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < ordered.length; index += 1) {
      const manifest = ordered[index];
      if (!selected.has(manifest.transactionId) || published.has(manifest.transactionId)) continue;
      for (const dependency of manifest.dependencies) {
        if (published.has(dependency)) continue;
        if (!byId.has(dependency)) {
          throw new PublishPlanError('PUBLISH_DEPENDENCY_MISSING', 'Не найдена dependency выбранной transaction.', {
            details: { transactionId: manifest.transactionId, dependency }
          });
        }
        if (!selected.has(dependency)) {
          selected.add(dependency);
          automaticDependencies.add(dependency);
          changed = true;
        }
      }
      const touched = new Set(manifest.mutations.map((mutation) => mutation.path));
      for (let earlier = 0; earlier < index; earlier += 1) {
        const candidate = ordered[earlier];
        if (published.has(candidate.transactionId)) continue;
        if (candidate.mutations.some((mutation) => touched.has(mutation.path)) && !selected.has(candidate.transactionId)) {
          selected.add(candidate.transactionId);
          automaticDependencies.add(candidate.transactionId);
          changed = true;
        }
      }
    }
  }

  const selectedManifests = ordered.filter((manifest) => selected.has(manifest.transactionId) && !published.has(manifest.transactionId));
  const selectedPaths = new Set(selectedManifests.flatMap((manifest) => manifest.mutations.map((mutation) => mutation.path)));
  for (const manifest of ordered) {
    if (published.has(manifest.transactionId) || selected.has(manifest.transactionId)) continue;
    const overlap = manifest.mutations.find((mutation) => selectedPaths.has(mutation.path));
    if (overlap) {
      throw new PublishPlanError(
        'PUBLISH_NEWER_OVERLAP_NOT_SELECTED',
        'Выбранная версия path перекрыта более новой неопубликованной transaction. Выберите готовую новую версию явно.',
        { details: { transactionId: manifest.transactionId, path: overlap.path } }
      );
    }
  }

  return deepFreeze({
    selectedManifests,
    selectedTransactionIds: selectedManifests.map((manifest) => manifest.transactionId),
    automaticDependencyIds: ordered.filter((manifest) => automaticDependencies.has(manifest.transactionId)).map((manifest) => manifest.transactionId),
    excludedTransactionIds: ordered
      .filter((manifest) => !published.has(manifest.transactionId) && !selected.has(manifest.transactionId))
      .map((manifest) => manifest.transactionId),
    unpublishedTransactionIds: ordered
      .filter((manifest) => !published.has(manifest.transactionId))
      .map((manifest) => manifest.transactionId)
  });
}

export function runGitProcess(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: options.cwd,
      env: options.env,
      encoding: null,
      windowsHide: true,
      ...(Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? { timeout: options.timeoutMs, killSignal: 'SIGTERM' } : {}),
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024
    }, (error, stdout, stderr) => {
      const result = {
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''),
        stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? '')
      };
      if (error && options.allowFailure !== true) {
        const failure = new PublishPlanError('GIT_COMMAND_FAILED', 'Git-команда publish planner завершилась ошибкой.', {
          cause: error,
          details: { args: [...args], stderr: result.stderr.toString('utf8').slice(-4000) }
        });
        failure.exitCode = result.exitCode;
        reject(failure);
      } else resolve(result);
    });
  });
}

function parseNullList(bytes) {
  return bytes.toString('utf8').split('\0').filter(Boolean).map((item) => item.replace(/\\/gu, '/'));
}

function parseRemoteRefs(bytes) {
  const refs = new Map();
  for (const line of bytes.toString('utf8').split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const [sha, ref] = line.trim().split(/\s+/u);
    if (SHA_RE.test(sha) && ref) refs.set(ref, sha.toLowerCase());
  }
  return refs;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function planFingerprint(value) {
  const serialized = stableJson(value);
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

export function fingerprintPublishPlan(plan) {
  return planFingerprint({
    baseHead: plan?.baseHead,
    anchorSha: plan?.anchorSha,
    protectedMainSha: plan?.protectedMainSha,
    selectedTransactionIds: plan?.selectedTransactionIds,
    transactionManifests: plan?.transactionManifests,
    commitTimestamp: plan?.commitTimestamp,
    paths: (plan?.paths ?? []).map(({
      path: relativePath,
      operation,
      beforeHash,
      afterHash,
      beforeGitOid,
      afterGitOid
    }) => ({ path: relativePath, operation, beforeHash, afterHash, beforeGitOid, afterGitOid })),
    targetRefs: plan?.targetRefs
  });
}

export function createPublishPlanner(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const remote = String(options.remote ?? 'origin');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(remote)) {
    throw new PublishPlanError('PUBLISH_REMOTE_INVALID', 'Invalid Git remote name.');
  }
  const refs = Object.freeze({ ...DEFAULT_PUBLISH_REFS, ...(options.refs ?? {}) });
  for (const [name, value] of Object.entries(refs)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) || value.includes('..')) {
      throw new PublishPlanError('PUBLISH_REF_INVALID', `Некорректная ветка ${name}.`);
    }
  }
  const commandLedger = [];
  const injectedRunGit = options.runGit;
  const gitEnvironment = createPublishGitEnvironment(options.environment ?? process.env);
  const git = async (args, commandOptions = {}) => {
    commandLedger.push(Object.freeze([...args]));
    const completeOptions = {
      cwd: repoRoot,
      ...commandOptions,
      env: commandOptions.env ?? gitEnvironment
    };
    return injectedRunGit
      ? injectedRunGit([...args], completeOptions)
      : runGitProcess(args, completeOptions);
  };

  async function currentSnapshot(relativePath) {
    const absolute = path.resolve(repoRoot, relativePath);
    if (!absolute.startsWith(`${repoRoot}${path.sep}`)) {
      throw new PublishPlanError('PUBLISH_PATH_ESCAPE', 'Publish path выходит за repoRoot.');
    }
    try {
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new PublishPlanError('PUBLISH_PATH_NOT_REGULAR', 'Publish path должен быть обычным файлом.', {
          details: { path: relativePath }
        });
      }
      const rawRevision = hashPublishBytes(await fs.readFile(absolute));
      const gitOid = assertGitObject(
        (await git(['hash-object', `--path=${relativePath}`, relativePath])).stdout.toString('utf8').trim(),
        `current Git object for ${relativePath}`
      );
      return { rawRevision, gitOid };
    } catch (error) {
      if (error?.code === 'ENOENT') return { rawRevision: 'missing', gitOid: 'missing' };
      throw error;
    }
  }

  async function commitSnapshot(sha, relativePath) {
    const oidResult = await git(['rev-parse', `${sha}:${relativePath}`], { allowFailure: true });
    if (oidResult.exitCode !== 0) return { rawRevision: 'missing', gitOid: 'missing' };
    const gitOid = assertGitObject(oidResult.stdout.toString('utf8').trim(), `anchor Git object for ${relativePath}`);
    const checkoutBytes = await git(['cat-file', '--filters', `--path=${relativePath}`, `${sha}:${relativePath}`]);
    return { rawRevision: hashPublishBytes(checkoutBytes.stdout), gitOid };
  }

  async function remoteSnapshot() {
    const refNames = {
      candidate: `refs/heads/${refs.candidate}`,
      preview: `refs/heads/${refs.preview}`,
      protected: `refs/heads/${refs.protected}`
    };
    const result = await git(['ls-remote', '--heads', remote, refNames.candidate, refNames.preview, refNames.protected]);
    const parsed = parseRemoteRefs(result.stdout);
    const snapshot = Object.fromEntries(Object.entries(refNames).map(([key, ref]) => [key, parsed.get(ref) ?? null]));
    if (!snapshot.candidate || !snapshot.preview || !snapshot.protected) {
      throw new PublishPlanError('PUBLISH_REMOTE_REF_MISSING', 'Не найдены обязательные remote refs.', {
        details: { remote, snapshot }
      });
    }
    return snapshot;
  }

  async function plan(request = {}) {
    commandLedger.length = 0;
    const target = String(request.target ?? 'preview').toLowerCase();
    if (!['preview', 'test'].includes(target)) {
      throw new PublishPlanError('PRODUCTION_PUBLISH_FORBIDDEN', 'H6 publish разрешает только тестовый preview; main не изменяется.', {
        status: 403
      });
    }
    const anchorSha = assertSha(request.lastSuccessfulPreviewSHA, 'lastSuccessfulPreviewSHA');
    const selection = resolveTransactionSelection({
      manifests: request.manifests,
      selectedTransactionIds: request.selectedTransactionIds,
      publishedTransactionIds: request.publishedTransactionIds
    });
    const branch = (await git(['branch', '--show-current'])).stdout.toString('utf8').trim();
    const headSha = assertSha((await git(['rev-parse', 'HEAD'])).stdout.toString('utf8').trim(), 'HEAD');
    const anchorCheck = await git(['cat-file', '-e', `${anchorSha}^{commit}`], { allowFailure: true });
    if (anchorCheck.exitCode !== 0) {
      throw new PublishPlanError('PUBLISH_ANCHOR_NOT_FOUND', 'lastSuccessfulPreviewSHA отсутствует в local object database.');
    }
    const remoteRefs = await remoteSnapshot();
    if (branch !== refs.candidate) {
      throw new PublishPlanError('PUBLISH_BRANCH_MISMATCH', 'Publish запускается только из candidate branch.', {
        details: { expected: refs.candidate, actual: branch }
      });
    }
    if (remoteRefs.candidate !== remoteRefs.preview) {
      throw new PublishPlanError('PUBLISH_REMOTE_REFS_DIVERGED', 'Remote candidate и preview уже расходятся; автоматический publish остановлен.', {
        details: remoteRefs
      });
    }
    if (remoteRefs.preview !== anchorSha) {
      throw new PublishPlanError('PUBLISH_REMOTE_NOT_SUCCESSFUL_ANCHOR', 'Remote preview не совпадает с последним успешным Pages SHA.', {
        details: { anchorSha, remotePreview: remoteRefs.preview }
      });
    }
    if (headSha !== remoteRefs.candidate) {
      throw new PublishPlanError('PUBLISH_BASE_HEAD_NOT_REMOTE', 'Content-only publish не может захватить локальные source commits поверх remote candidate.', {
        details: { headSha, remoteCandidate: remoteRefs.candidate }
      });
    }
    for (const manifest of selection.selectedManifests) {
      if (manifest.baseHead === headSha) continue;
      const ancestry = await git(['merge-base', '--is-ancestor', manifest.baseHead, headSha], { allowFailure: true });
      if (ancestry.exitCode !== 0) {
        throw new PublishPlanError('PUBLISH_MANIFEST_BASE_HEAD_MISMATCH', 'Transaction создана от несовместимого Git HEAD.', {
          details: { transactionId: manifest.transactionId, expectedAncestorOf: headSha, actual: manifest.baseHead }
        });
      }
      // A local save may finish while the previous exact publish is still running.
      // The byte-chain checks below re-anchor every selected path to the new proven
      // preview commit; accepting only ancestors keeps that safe without blocking
      // browser drafts or making Save depend on the network.
    }

    const stagedPaths = parseNullList((await git(['diff', '--cached', '--name-only', '-z'])).stdout);
    const unstagedTracked = parseNullList((await git(['diff', '--name-only', '-z'])).stdout);
    const untracked = parseNullList((await git(['ls-files', '--others', '--exclude-standard', '-z'])).stdout);
    const selectedPathSet = new Set(selection.selectedManifests.flatMap((manifest) => manifest.mutations.map((mutation) => mutation.path)));
    const unrelatedStaged = stagedPaths.filter((relativePath) => !selectedPathSet.has(relativePath));
    if (unrelatedStaged.length) {
      throw new PublishPlanError('PUBLISH_UNRELATED_STAGED', 'В Git index есть unrelated staged changes; publish остановлен.', {
        details: { paths: unrelatedStaged.sort() }
      });
    }

    const chains = new Map();
    for (const manifest of selection.selectedManifests) {
      for (const mutation of manifest.mutations) {
        const classification = classifyPublishPath(mutation.path);
        if (!classification.allowed || classification.profile !== 'content-only') {
          throw new PublishPlanError('PUBLISH_PATH_NOT_CONTENT_ONLY', 'Owner publish содержит source/runtime/unknown path.', {
            details: { transactionId: manifest.transactionId, path: mutation.path, classification }
          });
        }
        const chain = chains.get(mutation.path) ?? [];
        chain.push({ transactionId: manifest.transactionId, mutation });
        chains.set(mutation.path, chain);
      }
    }

    const allPaths = [];
    const netPaths = [];
    for (const relativePath of [...chains.keys()].sort()) {
      const chain = chains.get(relativePath);
      const anchor = await commitSnapshot(anchorSha, relativePath);
      const firstMutation = chain[0].mutation;
      const anchorMatches = firstMutation.beforeGitOid === undefined
        ? firstMutation.beforeHash === anchor.rawRevision
        : firstMutation.beforeGitOid === anchor.gitOid;
      if (!anchorMatches) {
        throw new PublishPlanError('PUBLISH_ANCHOR_HASH_MISMATCH', 'Transaction chain не начинается с exact preview anchor bytes.', {
          details: {
            path: relativePath,
            anchorHash: anchor.rawRevision,
            anchorGitOid: anchor.gitOid,
            transactionBeforeHash: firstMutation.beforeHash,
            transactionBeforeGitOid: firstMutation.beforeGitOid
          }
        });
      }
      for (let index = 1; index < chain.length; index += 1) {
        if (chain[index].mutation.beforeHash !== chain[index - 1].mutation.afterHash) {
          throw new PublishPlanError('PUBLISH_TRANSACTION_CHAIN_BROKEN', 'Последовательность overlapping transactions повреждена.', {
            details: { path: relativePath, previous: chain[index - 1].transactionId, next: chain[index].transactionId }
          });
        }
        if (chain[index].mutation.beforeGitOid !== undefined
          && chain[index - 1].mutation.afterGitOid !== undefined
          && chain[index].mutation.beforeGitOid !== chain[index - 1].mutation.afterGitOid) {
          throw new PublishPlanError('PUBLISH_TRANSACTION_GIT_CHAIN_BROKEN', 'Git object chronology of overlapping transactions is broken.', {
            details: { path: relativePath, previous: chain[index - 1].transactionId, next: chain[index].transactionId }
          });
        }
      }
      const finalHash = chain.at(-1).mutation.afterHash;
      const current = await currentSnapshot(relativePath);
      if (current.rawRevision !== finalHash) {
        throw new PublishPlanError('PUBLISH_OVERLAPPING_EXTERNAL_EDIT', 'Текущие bytes выбранного path не совпадают с committed transaction.', {
          details: { path: relativePath, expected: finalHash, actual: current.rawRevision }
        });
      }
      const declaredFinalGitOid = chain.at(-1).mutation.afterGitOid;
      if (declaredFinalGitOid !== undefined && current.gitOid !== declaredFinalGitOid) {
        throw new PublishPlanError('PUBLISH_CURRENT_GIT_OBJECT_MISMATCH', 'Current filtered Git object differs from the transaction manifest.', {
          details: { path: relativePath, expected: declaredFinalGitOid, actual: current.gitOid }
        });
      }
      const classification = classifyPublishPath(relativePath);
      if (classification.kind === 'canonical-upload' && finalHash !== 'missing') {
        const filenameDigest = path.posix.basename(relativePath).split('.')[0];
        const contentDigest = finalHash.split(':')[1];
        if (filenameDigest !== contentDigest) {
          throw new PublishPlanError('PUBLISH_CANONICAL_MEDIA_HASH_MISMATCH', 'Canonical upload filename does not match its exact current bytes.', {
            details: { path: relativePath, filenameDigest, contentDigest }
          });
        }
      }
      const entry = deepFreeze({
        path: relativePath,
        operation: finalHash === 'missing' ? 'delete' : 'write',
        beforeHash: anchor.rawRevision,
        afterHash: finalHash,
        beforeGitOid: anchor.gitOid,
        afterGitOid: current.gitOid,
        currentHash: current.rawRevision,
        transactionIds: chain.map((item) => item.transactionId),
        classification,
        netChanged: current.gitOid !== anchor.gitOid
      });
      allPaths.push(entry);
      if (entry.netChanged) netPaths.push(entry);
    }

    for (const stagedPath of stagedPaths) {
      const expected = allPaths.find((entry) => entry.path === stagedPath)?.afterGitOid;
      const staged = await git(['rev-parse', `:${stagedPath}`], { allowFailure: true });
      const stagedGitOid = staged.exitCode === 0 ? staged.stdout.toString('utf8').trim().toLowerCase() : 'missing';
      if (expected !== stagedGitOid) {
        throw new PublishPlanError('PUBLISH_OVERLAPPING_STAGED_EDIT', 'Staged bytes выбранного path не совпадают с transaction.', {
          details: { path: stagedPath, expected, stagedGitOid }
        });
      }
    }

    const unrelatedUnstaged = [...new Set([...unstagedTracked, ...untracked])]
      .filter((relativePath) => !selectedPathSet.has(relativePath))
      .sort();
    const contributingTransactionIds = new Set(netPaths.flatMap((entry) => entry.transactionIds));
    const contributingManifests = selection.selectedManifests
      .filter((manifest) => contributingTransactionIds.has(manifest.transactionId));
    const expectationByRoute = new Map();
    for (const manifest of contributingManifests) {
      for (const expectation of manifest.routeExpectations) {
        const previous = expectationByRoute.get(expectation.route);
        if (previous && previous !== expectation.expected) {
          throw new PublishPlanError(
            'PUBLISH_ROUTE_EXPECTATION_CONFLICT',
            'Selected transactions contain contradictory smoke expectations.',
            { details: { route: expectation.route, previous, expected: expectation.expected } },
          );
        }
        expectationByRoute.set(expectation.route, expectation.expected);
      }
    }
    const routeExpectations = [...expectationByRoute].sort(([left], [right]) => left.localeCompare(right))
      .map(([route, expected]) => ({ route, expected }));
    const affectedRoutes = routeExpectations.map((item) => item.route);
    const netCanonicalMedia = new Set(netPaths
      .filter((entry) => entry.operation === 'write' && entry.classification.kind === 'canonical-upload')
      .map((entry) => entry.path));
    const canonicalMedia = [...new Set(selection.selectedManifests.flatMap((manifest) => manifest.canonicalMedia))]
      .filter((mediaPath) => netCanonicalMedia.has(mediaPath))
      .sort();
    const commitTimestamp = selection.selectedManifests.length > 0
      ? selection.selectedManifests.at(-1).committedAt
      : null;
    const core = {
      version: 1,
      kind: 'smu1-content-publish-plan',
      target: 'preview',
      profile: 'content-only',
      remote,
      refs,
      baseHead: headSha,
      anchorSha,
      protectedMainSha: remoteRefs.protected,
      remoteRefs,
      transactionManifests: selection.selectedManifests,
      unpublishedTransactionIds: selection.unpublishedTransactionIds,
      selectedTransactionIds: selection.selectedTransactionIds,
      automaticDependencyIds: selection.automaticDependencyIds,
      excludedTransactionIds: selection.excludedTransactionIds,
      allPaths,
      paths: netPaths,
      affectedRoutes,
      routeExpectations,
      canonicalMedia,
      commitTimestamp,
      gates: [...CONTENT_ONLY_GATES],
      unrelatedUnstaged,
      warnings: ['GitHub Pages preview имеет noindex, но не является приватным. Не публикуйте секреты и персональные данные.'],
      targetRefs: [`refs/heads/${refs.candidate}`, `refs/heads/${refs.preview}`],
      empty: netPaths.length === 0
    };
    const fingerprint = fingerprintPublishPlan(core);
    return deepFreeze({
      ...core,
      fingerprint,
      planFingerprint: fingerprint,
      commands: commandLedger.map((args) => Object.freeze([...args]))
    });
  }

  return Object.freeze({ repoRoot, remote, refs, plan });
}

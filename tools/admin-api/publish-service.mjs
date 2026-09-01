import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_PUBLISH_REFS,
  classifyPublishPath,
  createCommittedTransactionManifest,
  createPublishGitEnvironment,
  createPublishPlanner,
  runGitProcess,
} from './publish-planner.mjs';
import { createPublishRunner } from './publish-runner.mjs';
import {
  PUBLISH_STATUSES,
  createPublishStatusTracker,
  transitionPublishStatus,
} from './publish-status.mjs';
import { normalizeReleaseIdentityEvidence } from '../release/artifact-identity.mjs';

const STATE_VERSION = 1;
const SHA_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const EXACT_RUN_ID_RE = /^exact-[a-f0-9]{32}$/u;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/u;
const TRANSACTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const TERMINAL_STATUSES = new Set([PUBLISH_STATUSES.DEPLOY_SUCCESS, PUBLISH_STATUSES.FAILURE, 'empty']);
const POLLABLE_STATUSES = new Set([
  PUBLISH_STATUSES.PUSHED,
  PUBLISH_STATUSES.WORKFLOW_QUEUED,
  PUBLISH_STATUSES.BUILDING,
]);
const RESUMABLE_STATUSES = new Set([
  PUBLISH_STATUSES.PREPARING,
  PUBLISH_STATUSES.LOCAL_GATES,
  PUBLISH_STATUSES.COMMITTED,
  PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT,
  ...POLLABLE_STATUSES,
]);

export class PublishServiceError extends Error {
  constructor(code, message, { status = 409, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PublishServiceError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function requiredId(value, field) {
  const normalized = String(value ?? '').trim();
  if (!ID_RE.test(normalized)) {
    throw new PublishServiceError('PUBLISH_ID_INVALID', `Некорректный ${field}.`, {
      status: 400,
      details: { field },
    });
  }
  return normalized;
}

function requiredSha(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SHA_RE.test(normalized)) {
    throw new PublishServiceError('PUBLISH_SHA_INVALID', `Некорректный ${field}.`, {
      status: 400,
      details: { field },
    });
  }
  return normalized;
}

function assertPreviewTarget(value) {
  const target = String(value ?? 'preview').toLowerCase();
  if (target === 'production' || target === 'main') {
    throw new PublishServiceError('PUBLISH_PRODUCTION_FORBIDDEN', 'Production/main недоступны в H6.', { status: 403 });
  }
  if (!['preview', 'test'].includes(target)) {
    throw new PublishServiceError('PUBLISH_TARGET_INVALID', 'Разрешён только тестовый preview.', { status: 400 });
  }
  return 'preview';
}

function normalizeTransactionIds(values) {
  if (!Array.isArray(values)) {
    throw new PublishServiceError('PUBLISH_SELECTION_INVALID', 'transactionIds должен быть массивом.', { status: 400 });
  }
  const ids = values.map((value) => String(value ?? '').trim());
  if (ids.some((value) => !TRANSACTION_ID_RE.test(value))) {
    throw new PublishServiceError('PUBLISH_TRANSACTION_ID_INVALID', 'Выбор содержит некорректный transaction ID.', { status: 400 });
  }
  return [...new Set(ids)].sort();
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requiredSha256(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw new PublishServiceError('PUBLISH_EXACT_EVIDENCE_INVALID', `Exact evidence содержит некорректный ${field}.`, {
      status: 409,
      details: { field },
    });
  }
  return normalized;
}

function normalizeVerifiedArtifact(value, expectedTransactionIds, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      throw new PublishServiceError(
        'PUBLISH_EXACT_EVIDENCE_REQUIRED',
        'План и запуск тестовой публикации требуют текущую exact-проверку.',
        { status: 409 },
      );
    }
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1 || value.kind !== 'smu1-verified-local-revision') {
    throw new PublishServiceError('PUBLISH_EXACT_EVIDENCE_INVALID', 'Exact evidence имеет неверный формат.', { status: 409 });
  }
  const exactRunId = String(value.exactRunId || '').toLowerCase();
  if (!EXACT_RUN_ID_RE.test(exactRunId)) {
    throw new PublishServiceError('PUBLISH_EXACT_EVIDENCE_INVALID', 'Exact evidence содержит некорректный run id.', { status: 409 });
  }
  const transactionIds = normalizeTransactionIds(value.transactionIds);
  const expected = normalizeTransactionIds(expectedTransactionIds);
  if (!sameStrings(transactionIds, expected)) {
    throw new PublishServiceError(
      'PUBLISH_EXACT_SELECTION_MISMATCH',
      'Exact evidence относится к другому набору сохранений.',
      { status: 409, details: { expected, actual: transactionIds } },
    );
  }
  const sourceTransactionId = String(value.sourceTransactionId || '').trim();
  if (!TRANSACTION_ID_RE.test(sourceTransactionId) || !transactionIds.includes(sourceTransactionId)) {
    throw new PublishServiceError('PUBLISH_EXACT_EVIDENCE_INVALID', 'Exact source transaction не связана с выбранной редакцией.', { status: 409 });
  }
  const fileCount = Number(value.fileCount);
  const totalBytes = Number(value.totalBytes);
  if (!Number.isSafeInteger(fileCount) || fileCount < 0 || !Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new PublishServiceError('PUBLISH_EXACT_EVIDENCE_INVALID', 'Exact artifact size evidence некорректно.', { status: 409 });
  }
  const normalized = {
    version: 1,
    kind: 'smu1-verified-local-revision',
    exactRunId,
    sourceTransactionId,
    sourceRevision: requiredSha256(value.sourceRevision, 'sourceRevision'),
    sourceBaseSha: requiredSha(value.sourceBaseSha, 'sourceBaseSha'),
    transactionIds,
    contentSchemaHash: requiredSha256(value.contentSchemaHash, 'contentSchemaHash'),
    bindingRegistryHash: requiredSha256(value.bindingRegistryHash, 'bindingRegistryHash'),
    h5PipelineHash: requiredSha256(value.h5PipelineHash, 'h5PipelineHash'),
    snapshotSha256: requiredSha256(value.snapshotSha256, 'snapshotSha256'),
    artifactManifestSha256: requiredSha256(value.artifactManifestSha256, 'artifactManifestSha256'),
    fileCount,
    totalBytes,
    largestFile: clone(value.largestFile || null),
  };
  return normalized;
}

function verifiedArtifactFingerprint(value) {
  return value ? digest({ kind: 'smu1-exact-plan-binding', value }) : null;
}

function ownership(request) {
  const owner = requiredId(request?.owner, 'owner');
  const sessionFingerprint = requiredId(request?.sessionFingerprint, 'sessionFingerprint');
  return Object.freeze({
    owner,
    sessionFingerprint,
    ownerKey: digest({ scope: 'publish-owner', owner }),
    sessionKey: digest({ scope: 'publish-session', owner, sessionFingerprint }),
  });
}

function recoveryOwnership(request, principal) {
  const recoveryClientId = requiredId(request?.recoveryClientId, 'recoveryClientId');
  return Object.freeze({
    recoveryClientId,
    recoveryKey: digest({
      scope: 'publish-recovery',
      ownerKey: principal.ownerKey,
      recoveryClientId,
    }),
  });
}

function publicError(error, retryable = false) {
  return Object.freeze({
    code: String(error?.code || 'PUBLISH_SERVICE_FAILED').slice(0, 120),
    message: String(error?.message || 'Не удалось обновить тестовый сайт.').slice(0, 1000),
    retryable: Boolean(retryable),
  });
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function stateChecksum(payload) {
  return digest({ kind: 'smu1-publish-state', payload });
}

function stateEnvelope(payload) {
  return {
    version: STATE_VERSION,
    kind: 'smu1-publish-state-envelope',
    checksum: stateChecksum(payload),
    payload,
  };
}

function validateStateEnvelope(value) {
  if (!value || value.version !== STATE_VERSION || value.kind !== 'smu1-publish-state-envelope'
    || typeof value.payload !== 'object' || value.payload === null
    || value.checksum !== stateChecksum(value.payload)) {
    throw new PublishServiceError('PUBLISH_STATE_CORRUPT', 'Publish state повреждён или имеет неверную контрольную сумму.', {
      status: 500,
    });
  }
  const payload = value.payload;
  requiredSha(payload.lastSuccessfulPreviewSHA, 'lastSuccessfulPreviewSHA');
  if (payload.version !== STATE_VERSION || payload.kind !== 'smu1-publish-state'
    || typeof payload.jobs !== 'object' || payload.jobs === null
    || typeof payload.plans !== 'object' || payload.plans === null
    || typeof payload.idempotency !== 'object' || payload.idempotency === null
    || typeof payload.publishedTransactions !== 'object' || payload.publishedTransactions === null) {
    throw new PublishServiceError('PUBLISH_STATE_CORRUPT', 'Publish state имеет неверную структуру.', { status: 500 });
  }
  return payload;
}

function cleanPlan(plan) {
  const result = clone(plan);
  if (result && typeof result === 'object') delete result.commands;
  return result;
}

function cleanGateEvidence(gates, testedSha) {
  const results = {};
  for (const [name, evidence] of Object.entries(gates?.results ?? {})) {
    results[name] = evidence === 'passed' || evidence?.ok === true ? { ok: true } : { ok: false };
  }
  let artifactIdentity;
  try {
    artifactIdentity = normalizeReleaseIdentityEvidence(gates?.artifactIdentity, {
      expectedTestedCommitSha: testedSha,
    });
  } catch (error) {
    throw new PublishServiceError(
      'PUBLISH_GATE_ARTIFACT_IDENTITY_INVALID',
      'Local gate receipt does not contain the exact deterministic dist identity.',
      { status: 500, details: { code: error?.code || null } },
    );
  }
  return { ok: gates?.ok === true, testedSha, artifactIdentity, results };
}

function cleanReceipt(receipt) {
  if (receipt?.empty === true) {
    return {
      version: 1,
      status: 'empty',
      empty: true,
      testedSha: receipt.testedSha,
      baseHead: receipt.baseHead,
      anchorSha: receipt.anchorSha,
      protectedSha: receipt.protectedSha ?? receipt.remoteBefore?.protected,
      remoteBefore: clone(receipt.remoteBefore),
      paths: [],
    };
  }
  return {
    version: 1,
    status: 'committed',
    empty: false,
    planFingerprint: receipt.planFingerprint,
    selectedTransactionIds: [...(receipt.selectedTransactionIds ?? [])],
    baseHead: receipt.baseHead,
    anchorSha: receipt.anchorSha,
    treeSha: receipt.treeSha,
    testedSha: receipt.testedSha,
    protectedSha: receipt.protectedSha,
    remoteBefore: clone(receipt.remoteBefore),
    paths: clone(receipt.paths ?? []),
    gates: cleanGateEvidence(receipt.gates, receipt.testedSha),
  };
}

function cleanPushResult(result) {
  return {
    status: result?.status,
    pushed: result?.pushed === true,
    retryable: result?.retryable === true,
    reconciled: result?.reconciled === true,
    testedSha: result?.testedSha,
    ...(result?.refs ? { refs: clone(result.refs) } : {}),
  };
}

function transactionRouteContract(metadata) {
  if (metadata?.service !== 'content-transaction' || metadata?.serviceVersion !== 2) {
    throw new PublishServiceError(
      'PUBLISH_TRANSACTION_ROUTE_EXPECTATIONS_UNTRUSTED',
      'Smoke-ожидания должны быть выведены content transaction service v2 из exact before/after state.',
    );
  }
  if (!Array.isArray(metadata?.affectedRoutes) || !Array.isArray(metadata?.routeExpectations)
    || metadata.affectedRoutes.length === 0 || metadata.routeExpectations.length === 0
    || metadata.affectedRoutes.length > 500 || metadata.routeExpectations.length > 500) {
    throw new PublishServiceError(
      'PUBLISH_TRANSACTION_ROUTE_EXPECTATIONS_MISSING',
      'В committed transaction отсутствуют типизированные smoke-ожидания маршрутов.',
    );
  }
  const affectedRoutes = [...new Set(metadata.affectedRoutes)];
  const safeRoute = (route) => typeof route === 'string'
    && route.startsWith('/')
    && !route.startsWith('//')
    && !/[\\?#\u0000-\u001f\u007f]/u.test(route)
    && !/%(?:2e|2f|5c)/iu.test(route)
    && !route.split('/').some((segment) => segment === '.' || segment === '..');
  if (affectedRoutes.some((route) => !safeRoute(route))) {
    throw new PublishServiceError(
      'PUBLISH_TRANSACTION_ROUTE_EXPECTATIONS_INVALID',
      'Committed transaction содержит некорректный affected route.',
    );
  }
  affectedRoutes.sort();
  const byRoute = new Map();
  for (const item of metadata.routeExpectations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'expected,route'
      || !safeRoute(item.route) || !['html', 'not-found'].includes(item.expected)) {
      throw new PublishServiceError(
        'PUBLISH_TRANSACTION_ROUTE_EXPECTATIONS_INVALID',
        'Committed transaction содержит некорректное smoke-ожидание.',
      );
    }
    const previous = byRoute.get(item.route);
    if (previous && previous !== item.expected) {
      throw new PublishServiceError(
        'PUBLISH_TRANSACTION_ROUTE_EXPECTATIONS_CONFLICT',
        'Committed transaction содержит противоречивые smoke-ожидания.',
        { details: { route: item.route, previous, expected: item.expected } },
      );
    }
    byRoute.set(item.route, item.expected);
  }
  const expectationRoutes = [...byRoute.keys()].sort();
  if (affectedRoutes.length !== expectationRoutes.length
    || affectedRoutes.some((route, index) => route !== expectationRoutes[index])) {
    throw new PublishServiceError(
      'PUBLISH_TRANSACTION_ROUTE_EXPECTATIONS_MISMATCH',
      'affectedRoutes и routeExpectations committed transaction не совпадают.',
    );
  }
  return {
    affectedRoutes,
    routeExpectations: expectationRoutes.map((route) => ({ route, expected: byRoute.get(route) })),
  };
}

/** Build the typed, content-only manifest exclusively from an owned committed journal. */
export function createManifestFromCommittedTransaction(transaction) {
  if (!transaction || transaction.state !== 'committed') {
    throw new PublishServiceError('PUBLISH_TRANSACTION_NOT_COMMITTED', 'Публиковать можно только committed transaction.');
  }
  const mutations = (transaction.mutations ?? [])
    .filter((mutation) => mutation?.willChange !== false && mutation?.baseRevision !== mutation?.nextRevision)
    .map((mutation) => ({
      path: mutation.path,
      operation: mutation.operation,
      beforeHash: mutation.baseRevision,
      afterHash: mutation.nextRevision,
    }));
  if (mutations.length === 0) {
    throw new PublishServiceError('PUBLISH_TRANSACTION_EMPTY', 'Committed transaction не содержит фактических изменений.');
  }
  const baseHead = transaction.metadata?.baseHead;
  if (!SHA_RE.test(String(baseHead ?? '').toLowerCase())) {
    throw new PublishServiceError(
      'PUBLISH_TRANSACTION_BASE_HEAD_MISSING',
      'В истории сохранения отсутствует exact Git baseHead; безопасная публикация невозможна.',
      { details: { transactionId: transaction.transactionId } },
    );
  }
  const dependencies = Array.isArray(transaction.metadata?.publishDependencies)
    ? transaction.metadata.publishDependencies
    : Array.isArray(transaction.metadata?.dependencies)
      ? transaction.metadata.dependencies
      : [];
  const canonicalMedia = mutations
    .filter((mutation) => mutation.operation === 'write' && classifyPublishPath(mutation.path).kind === 'canonical-upload')
    .map((mutation) => mutation.path);
  const routeContract = transactionRouteContract(transaction.metadata);
  const manifest = createCommittedTransactionManifest({
    transactionId: transaction.transactionId,
    committedAt: transaction.updatedAt ?? transaction.createdAt,
    baseHead,
    dependencies,
    mutations,
    affectedRoutes: routeContract.affectedRoutes,
    routeExpectations: routeContract.routeExpectations,
    canonicalMedia,
    summary: transaction.metadata?.userSummary ?? 'Изменение контента',
  });
  return {
    ...manifest,
    routeTransitions: clone(transaction.metadata?.routeTransitions ?? []),
    recordRenames: clone(transaction.metadata?.recordRenames ?? []),
  };
}

function publicJob(job) {
  if (!job) return null;
  const status = job.statusRecord?.status ?? job.status;
  const testedSha = job.statusRecord?.testedSha ?? job.receipt?.testedSha ?? null;
  const exactPush = job.pushResult?.status === PUBLISH_STATUSES.PUSHED
    && job.pushResult?.pushed === true
    && job.pushResult?.testedSha === testedSha
    && job.pushResult?.refs?.candidate === testedSha
    && job.pushResult?.refs?.preview === testedSha;
  const deploymentEvidence = job.statusRecord?.evidence ?? job.evidence ?? {};
  return clone({
    jobId: job.jobId,
    planId: job.planId,
    target: 'preview',
    status,
    success: job.statusRecord?.success === true || job.status === 'empty',
    testedSha,
    retryable: status === PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT
      || (status === PUBLISH_STATUSES.FAILURE && exactPush),
    selectedTransactionIds: job.selectedTransactionIds,
    planFingerprint: job.planFingerprint,
    affectedRoutes: job.plan?.affectedRoutes ?? [],
    routeExpectations: job.plan?.routeExpectations ?? [],
    error: job.error ?? null,
    retryResult: job.retryResult ?? null,
    attempts: job.attempts,
    timeline: job.statusRecord?.timeline ?? [],
    verification: job.verifiedArtifact ?? null,
    evidence: {
      ...deploymentEvidence,
      ...(job.verifiedArtifact ? { sourceVerification: job.verifiedArtifact } : {}),
    },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

export function createPublishService(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const runtimeDir = path.resolve(options.runtimeDir ?? path.join(repoRoot, '.admin-runtime', 'publish'));
  if (!isInside(repoRoot, runtimeDir)) {
    throw new PublishServiceError('PUBLISH_RUNTIME_PATH_INVALID', 'Publish runtimeDir должен находиться внутри repoRoot.', {
      status: 500,
    });
  }
  const ownedRefs = Object.freeze({ ...DEFAULT_PUBLISH_REFS, ...(options.refs ?? {}) });
  if (ownedRefs.candidate !== DEFAULT_PUBLISH_REFS.candidate
    || ownedRefs.preview !== DEFAULT_PUBLISH_REFS.preview
    || ownedRefs.protected !== DEFAULT_PUBLISH_REFS.protected) {
    throw new PublishServiceError(
      'PUBLISH_REF_OWNERSHIP_INVALID',
      'Owner publish должен владеть только v4-product-final-candidate + preview и защищать main.',
      { status: 500, details: { refs: ownedRefs } },
    );
  }
  const statePath = path.join(runtimeDir, 'state.json');
  const backupPath = path.join(runtimeDir, 'state.previous.json');
  const fileSystem = options.fileSystem ?? fs;
  const now = options.now ?? (() => new Date());
  const randomUUID = options.randomUUID ?? crypto.randomUUID;
  const planTtlMs = options.planTtlMs ?? 30 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const maxPollAttempts = options.maxPollAttempts ?? 240;
  const maxAutomaticPushRetries = options.maxAutomaticPushRetries ?? 3;
  const maxJobs = options.maxJobs ?? 100;
  const requireVerifiedArtifact = options.requireVerifiedArtifact === true;
  const autoRun = options.autoRun !== false;
  const transactionService = options.transactionService;
  if (!transactionService || typeof transactionService.listHistory !== 'function'
    || typeof transactionService.getTransaction !== 'function') {
    throw new PublishServiceError('PUBLISH_TRANSACTION_SERVICE_REQUIRED', 'Нужен content transaction service.', { status: 500 });
  }
  const planner = options.planner ?? createPublishPlanner({
    repoRoot,
    remote: options.remote,
    refs: ownedRefs,
    runGit: options.runGit,
  });
  const runner = options.runner ?? createPublishRunner({
    repoRoot,
    remote: options.remote,
    refs: ownedRefs,
    runGit: options.runGit,
    gateRunner: options.gateRunner,
    tempRoot: options.tempRoot,
  });
  const tracker = options.statusTracker ?? createPublishStatusTracker({
    workflowProvider: options.workflowProvider,
    pagesProvider: options.pagesProvider,
    smokeRunner: options.smokeRunner,
    now,
  });
  const retryProvider = typeof options.retryProvider === 'function'
    ? options.retryProvider
    : async ({ testedSha }) => ({ action: 'repoll', testedSha, requested: false });
  const git = options.runGit ?? runGitProcess;
  const gitEnvironment = createPublishGitEnvironment(options.environment ?? process.env);
  const scheduleLater = options.scheduleLater ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref?.();
    return timer;
  });
  const cancelScheduled = options.cancelScheduled ?? ((timer) => clearTimeout(timer));
  const assertStable = options.assertStable ?? (async () => {
    if (typeof transactionService.withStableRead === 'function') {
      await transactionService.withStableRead(async () => true);
    }
  });

  let state;
  let initializePromise;
  let stateQueue = Promise.resolve();
  let closed = false;
  const activeJobs = new Map();
  const timers = new Map();

  function nowIso() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new PublishServiceError('PUBLISH_TIME_INVALID', 'Publish clock вернул некорректное время.', { status: 500 });
    }
    return date.toISOString();
  }

  async function assertRegularOrMissing(target) {
    try {
      const stat = await fileSystem.lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new PublishServiceError('PUBLISH_STATE_PATH_UNSAFE', 'Publish state path должен быть обычным файлом.', {
          status: 500,
          details: { path: target },
        });
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async function readEnvelope(target) {
    await assertRegularOrMissing(target);
    const bytes = await fileSystem.readFile(target);
    if (bytes.length > 16 * 1024 * 1024) {
      throw new PublishServiceError('PUBLISH_STATE_TOO_LARGE', 'Publish state превышает безопасный лимит.', { status: 500 });
    }
    return validateStateEnvelope(JSON.parse(bytes.toString('utf8')));
  }

  async function syncDirectory(directory) {
    try {
      const handle = await fileSystem.open(directory, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
    } catch (error) {
      if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error?.code)) throw error;
    }
  }

  async function atomicWrite(target, bytes) {
    await fileSystem.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fileSystem.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await fileSystem.rename(temporary, target);
      await syncDirectory(path.dirname(target));
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fileSystem.unlink(temporary).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }

  async function persist(nextState) {
    const serialized = Buffer.from(`${JSON.stringify(stateEnvelope(nextState), null, 2)}\n`, 'utf8');
    try {
      const previous = await fileSystem.readFile(statePath);
      await atomicWrite(backupPath, previous);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await atomicWrite(statePath, serialized);
  }

  async function restorePrimary(nextState) {
    const serialized = Buffer.from(`${JSON.stringify(stateEnvelope(nextState), null, 2)}\n`, 'utf8');
    await atomicWrite(statePath, serialized);
  }

  function prune(draft) {
    const planNow = Date.parse(nowIso());
    for (const [planId, planRecord] of Object.entries(draft.plans)) {
      if (!planRecord.consumedByJobId && Date.parse(planRecord.expiresAt) <= planNow) delete draft.plans[planId];
    }
    const jobs = Object.values(draft.jobs).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const removable = jobs.filter((job) => TERMINAL_STATUSES.has(job.statusRecord?.status ?? job.status)).slice(maxJobs);
    for (const job of removable) {
      delete draft.jobs[job.jobId];
      if (draft.plans[job.planId]?.consumedByJobId === job.jobId) delete draft.plans[job.planId];
      for (const [key, entry] of Object.entries(draft.idempotency)) {
        if (entry.jobId === job.jobId) delete draft.idempotency[key];
      }
    }
  }

  async function updateState(mutator) {
    let answer;
    const operation = stateQueue.then(async () => {
      const draft = clone(state);
      answer = await mutator(draft);
      draft.sequence = Number(draft.sequence || 0) + 1;
      draft.updatedAt = nowIso();
      prune(draft);
      await persist(draft);
      state = draft;
    });
    stateQueue = operation.catch(() => {});
    await operation;
    return clone(answer);
  }

  function initialState(anchor) {
    const at = nowIso();
    return {
      version: STATE_VERSION,
      kind: 'smu1-publish-state',
      sequence: 0,
      lastSuccessfulPreviewSHA: anchor,
      publishedTransactions: {},
      plans: {},
      jobs: {},
      idempotency: {},
      createdAt: at,
      updatedAt: at,
    };
  }

  async function initialize() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      await fileSystem.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
      const runtimeStat = await fileSystem.lstat(runtimeDir);
      if (runtimeStat.isSymbolicLink() || !runtimeStat.isDirectory()) {
        throw new PublishServiceError('PUBLISH_RUNTIME_PATH_UNSAFE', 'Publish runtimeDir должен быть обычным каталогом.', { status: 500 });
      }
      await runner.initialize?.();
      try {
        state = await readEnvelope(statePath);
      } catch (primaryError) {
        if (primaryError?.code === 'ENOENT') {
          try {
            state = await readEnvelope(backupPath);
            await restorePrimary(state);
          } catch (backupError) {
            if (backupError?.code !== 'ENOENT') {
              throw new PublishServiceError('PUBLISH_STATE_UNRECOVERABLE', 'Не удалось восстановить publish state.', {
                status: 500,
                details: { primaryCode: primaryError?.code, backupCode: backupError?.code },
                cause: backupError,
              });
            }
            const anchor = requiredSha(options.initialLastSuccessfulPreviewSHA, 'initialLastSuccessfulPreviewSHA');
            state = initialState(anchor);
            await persist(state);
          }
        } else {
          try {
            state = await readEnvelope(backupPath);
            await restorePrimary(state);
          } catch (backupError) {
            throw new PublishServiceError('PUBLISH_STATE_UNRECOVERABLE', 'Не удалось восстановить publish state.', {
              status: 500,
              details: { primaryCode: primaryError?.code, backupCode: backupError?.code },
              cause: primaryError,
            });
          }
        }
      }
      if (autoRun) {
        for (const job of Object.values(state.jobs)) {
          if (RESUMABLE_STATUSES.has(job.statusRecord?.status ?? job.status)) scheduleJob(job.jobId, 0);
        }
      }
      return statusSummary();
    })();
    return initializePromise;
  }

  async function ensureInitialized() {
    await initialize();
    if (closed) throw new PublishServiceError('PUBLISH_SERVICE_CLOSED', 'Publish service остановлен.', { status: 503 });
  }

  function assertOwned(record, principal, kind, recovery = null) {
    if (!record || record.ownerKey !== principal.ownerKey
      || (recovery && record.recoveryKey !== recovery.recoveryKey)) {
      throw new PublishServiceError(`PUBLISH_${kind.toUpperCase()}_NOT_FOUND`, `${kind} не найден.`, { status: 404 });
    }
    return record;
  }

  async function adoptSession(principal, recovery) {
    const hasAdoptable = [
      ...Object.values(state.plans || {}),
      ...Object.values(state.jobs || {}),
    ].some((record) => record.ownerKey === principal.ownerKey
      && record.recoveryKey === recovery.recoveryKey
      && record.sessionKey !== principal.sessionKey);
    if (!hasAdoptable) return;
    await updateState((draft) => {
      const adoptedAt = nowIso();
      for (const record of [...Object.values(draft.plans), ...Object.values(draft.jobs)]) {
        if (record.ownerKey !== principal.ownerKey
          || record.recoveryKey !== recovery.recoveryKey
          || record.sessionKey === principal.sessionKey) continue;
        const previousSessionKey = record.sessionKey;
        record.sessionKey = principal.sessionKey;
        record.sessionAdoptions = [
          ...(record.sessionAdoptions || []).slice(-19),
          { previousSessionKey, nextSessionKey: principal.sessionKey, adoptedAt },
        ];
      }
    });
  }

  async function committedManifests(principal) {
    const request = { owner: principal.owner, sessionFingerprint: principal.sessionFingerprint };
    const history = await transactionService.listHistory(request);
    const manifests = [];
    for (const entry of history) {
      if (entry.state !== 'committed') continue;
      const transaction = await transactionService.getTransaction({ ...request, transactionId: entry.transactionId });
      manifests.push(createManifestFromCommittedTransaction(transaction));
    }
    return manifests;
  }

  async function buildPlan(principal, selectedTransactionIds) {
    const manifests = await committedManifests(principal);
    const snapshot = clone(state);
    await assertStable();
    return planner.plan({
      target: 'preview',
      lastSuccessfulPreviewSHA: snapshot.lastSuccessfulPreviewSHA,
      manifests,
      selectedTransactionIds,
      publishedTransactionIds: Object.keys(snapshot.publishedTransactions),
    });
  }

  async function preview(request = {}) {
    await ensureInitialized();
    assertPreviewTarget(request.target);
    const principal = ownership(request);
    const recovery = recoveryOwnership(request, principal);
    const selectedTransactionIds = normalizeTransactionIds(request.transactionIds ?? request.selectedTransactionIds ?? []);
    const requestedVerification = normalizeVerifiedArtifact(request.verifiedArtifact, selectedTransactionIds, {
      required: requireVerifiedArtifact,
    });
    const plan = cleanPlan(await buildPlan(principal, selectedTransactionIds));
    const verifiedArtifact = requestedVerification;
    const verificationFingerprint = verifiedArtifactFingerprint(verifiedArtifact);
    const planId = `plan-${randomUUID()}`;
    const createdAt = nowIso();
    const expiresAt = new Date(Date.parse(createdAt) + planTtlMs).toISOString();
    await updateState((draft) => {
      draft.plans[planId] = {
        planId,
        ownerKey: principal.ownerKey,
        sessionKey: principal.sessionKey,
        recoveryKey: recovery.recoveryKey,
        selectedTransactionIds,
        planFingerprint: plan.fingerprint ?? plan.planFingerprint,
        verifiedArtifact,
        verificationFingerprint,
        plan,
        createdAt,
        expiresAt,
        consumedByJobId: null,
      };
    });
    return clone({ planId, expiresAt, ...plan, verification: verifiedArtifact });
  }

  async function getPlan(request = {}) {
    await ensureInitialized();
    const principal = ownership(request);
    const recovery = recoveryOwnership(request, principal);
    await adoptSession(principal, recovery);
    const planId = requiredId(request.planId, 'planId');
    const record = assertOwned(state.plans[planId], principal, 'plan', recovery);
    return clone({
      planId: record.planId,
      expiresAt: record.expiresAt,
      consumedByJobId: record.consumedByJobId,
      selectedTransactionIds: record.selectedTransactionIds,
      planFingerprint: record.planFingerprint,
      verification: record.verifiedArtifact ?? null,
    });
  }

  function statusSummary(principal = null, recovery = null) {
    const jobs = Object.values(state?.jobs ?? {})
      .filter((job) => !principal || (job.ownerKey === principal.ownerKey
        && (!recovery || job.recoveryKey === recovery.recoveryKey)))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return clone({
      target: 'preview',
      lastSuccessfulPreviewSHA: state?.lastSuccessfulPreviewSHA ?? null,
      activeJob: publicJob(jobs.find((job) => !TERMINAL_STATUSES.has(job.statusRecord?.status ?? job.status))),
      latestJob: publicJob(jobs[0]),
      updatedAt: state?.updatedAt ?? null,
    });
  }

  async function overview(request = {}) {
    await ensureInitialized();
    const principal = ownership(request);
    const recovery = recoveryOwnership(request, principal);
    await adoptSession(principal, recovery);
    const manifests = await committedManifests(principal);
    const published = new Set(Object.keys(state.publishedTransactions));
    return {
      ...statusSummary(principal, recovery),
      transactions: manifests.map((manifest) => ({
        transactionId: manifest.transactionId,
        committedAt: manifest.committedAt,
        summary: manifest.summary,
        changedPaths: manifest.mutations.map((mutation) => mutation.path),
        affectedRoutes: manifest.affectedRoutes,
        routeExpectations: manifest.routeExpectations,
        routeTransitions: manifest.routeTransitions || [],
        recordRenames: manifest.recordRenames || [],
        canonicalMedia: manifest.canonicalMedia,
        published: published.has(manifest.transactionId),
      })),
    };
  }

  async function start(request = {}) {
    await ensureInitialized();
    assertPreviewTarget(request.target);
    const principal = ownership(request);
    const recovery = recoveryOwnership(request, principal);
    await adoptSession(principal, recovery);
    const planId = requiredId(request.planId, 'planId');
    const idempotencyKey = requiredId(request.idempotencyKey ?? `apply-${planId}`, 'idempotencyKey');
    const planRecord = assertOwned(state.plans[planId], principal, 'plan', recovery);
    if (!planRecord.consumedByJobId && Date.parse(planRecord.expiresAt) <= Date.parse(nowIso())) {
      throw new PublishServiceError('PUBLISH_PLAN_EXPIRED', 'План устарел; подготовьте его заново.', { status: 410 });
    }
    const verifiedArtifact = normalizeVerifiedArtifact(request.verifiedArtifact, planRecord.selectedTransactionIds, {
      required: requireVerifiedArtifact || Boolean(planRecord.verifiedArtifact),
    });
    const verificationFingerprint = verifiedArtifactFingerprint(verifiedArtifact);
    if (verificationFingerprint !== (planRecord.verificationFingerprint ?? null)) {
      throw new PublishServiceError(
        'PUBLISH_EXACT_EVIDENCE_STALE',
        'Текущая exact-проверка не совпадает с revision и snapshot, к которым привязан план.',
        { status: 409, details: { planId } },
      );
    }
    const payloadHash = digest({
      target: 'preview',
      planId,
      planFingerprint: planRecord.planFingerprint,
      selectedTransactionIds: planRecord.selectedTransactionIds,
      verificationFingerprint,
    });
    const idempotencyId = digest({
      ownerKey: principal.ownerKey,
      recoveryKey: recovery.recoveryKey,
      idempotencyKey,
    });
    const previous = state.idempotency[idempotencyId];
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new PublishServiceError('PUBLISH_IDEMPOTENCY_CONFLICT', 'Idempotency key уже использован для другого publish payload.');
      }
      return publicJob(assertOwned(state.jobs[previous.jobId], principal, 'job', recovery));
    }
    if (planRecord.consumedByJobId) {
      const consumedJob = assertOwned(state.jobs[planRecord.consumedByJobId], principal, 'job', recovery);
      if (consumedJob.recoveryKey !== recovery.recoveryKey) {
        throw new PublishServiceError('PUBLISH_PLAN_CONSUMED', 'План уже запущен другим recovery client.', { status: 409 });
      }
      return publicJob(consumedJob);
    }
    const recomputed = cleanPlan(await buildPlan(principal, planRecord.selectedTransactionIds));
    if ((recomputed.fingerprint ?? recomputed.planFingerprint) !== planRecord.planFingerprint) {
      throw new PublishServiceError('PUBLISH_PLAN_STALE', 'Состояние изменилось после подготовки плана; проверьте новый план.', {
        details: {
          expected: planRecord.planFingerprint,
          actual: recomputed.fingerprint ?? recomputed.planFingerprint,
        },
      });
    }
    let createdJobId;
    const existing = await updateState((draft) => {
      const previous = draft.idempotency[idempotencyId];
      if (previous) {
        if (previous.payloadHash !== payloadHash) {
          throw new PublishServiceError('PUBLISH_IDEMPOTENCY_CONFLICT', 'Idempotency key уже использован для другого publish payload.');
        }
        return previous.jobId;
      }
      const currentPlan = assertOwned(draft.plans[planId], principal, 'plan', recovery);
      if (currentPlan.consumedByJobId) {
        const consumedJob = assertOwned(draft.jobs[currentPlan.consumedByJobId], principal, 'job', recovery);
        if (consumedJob.recoveryKey !== recovery.recoveryKey) {
          throw new PublishServiceError('PUBLISH_PLAN_CONSUMED', 'План уже запущен другим recovery client.', { status: 409 });
        }
        return currentPlan.consumedByJobId;
      }
      const active = Object.values(draft.jobs).find((job) => !TERMINAL_STATUSES.has(job.statusRecord?.status ?? job.status));
      if (active) {
        throw new PublishServiceError('PUBLISH_JOB_ACTIVE', 'Другое обновление тестового сайта уже выполняется.', {
          details: { jobId: active.jobId },
        });
      }
      const jobId = `job-${randomUUID()}`;
      const at = nowIso();
      const statusRecord = tracker.begin(recomputed);
      const empty = recomputed.empty === true || recomputed.paths?.length === 0;
      draft.jobs[jobId] = {
        jobId,
        planId,
        ownerKey: principal.ownerKey,
        sessionKey: principal.sessionKey,
        recoveryKey: recovery.recoveryKey,
        idempotencyId,
        payloadHash,
        target: 'preview',
        selectedTransactionIds: [...recomputed.selectedTransactionIds],
        planFingerprint: recomputed.fingerprint ?? recomputed.planFingerprint,
        verifiedArtifact,
        verificationFingerprint,
        plan: recomputed,
        commitMessage: `content(preview): ${recomputed.selectedTransactionIds.join(', ')}`,
        status: empty ? 'empty' : PUBLISH_STATUSES.PREPARING,
        statusRecord: empty ? null : statusRecord,
        receipt: null,
        pushResult: null,
        error: null,
        attempts: { prepare: 0, push: 0, poll: 0, retry: 0 },
        retryResult: null,
        createdAt: at,
        updatedAt: at,
      };
      currentPlan.consumedByJobId = jobId;
      draft.idempotency[idempotencyId] = { payloadHash, jobId, createdAt: at };
      if (empty) {
        for (const transactionId of recomputed.selectedTransactionIds) {
          draft.publishedTransactions[transactionId] = {
            sha: draft.lastSuccessfulPreviewSHA,
            jobId,
            publishedAt: at,
            disposition: 'already-deployed-anchor',
          };
        }
      }
      createdJobId = jobId;
      return jobId;
    });
    const jobId = existing ?? createdJobId;
    const job = assertOwned(state.jobs[jobId], principal, 'job', recovery);
    if (autoRun && !TERMINAL_STATUSES.has(job.statusRecord?.status ?? job.status)) scheduleJob(jobId, 0);
    return publicJob(job);
  }

  async function executeGit(args, commandOptions = {}) {
    return git(args, { cwd: repoRoot, env: commandOptions.env ?? gitEnvironment, allowFailure: commandOptions.allowFailure });
  }

  function nulPaths(value) {
    return (Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? ''))
      .split('\0').filter(Boolean).map((item) => item.replaceAll('\\', '/')).sort();
  }

  async function recoverPreparedReceipt(job) {
    if (typeof options.receiptRecovery === 'function') return options.receiptRecovery(job);
    const plan = job.plan;
    const head = (await executeGit(['rev-parse', 'HEAD'])).stdout.toString('utf8').trim().toLowerCase();
    if (head === plan.baseHead) return null;
    if (!SHA_RE.test(head)) return null;
    const branch = (await executeGit(['branch', '--show-current'])).stdout.toString('utf8').trim();
    if (branch !== plan.refs?.candidate) return null;
    const parent = (await executeGit(['rev-parse', `${head}^`], { allowFailure: true }));
    if (parent.exitCode !== 0 || parent.stdout.toString('utf8').trim().toLowerCase() !== plan.baseHead) return null;
    const changed = nulPaths((await executeGit(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', head])).stdout);
    const planned = [...plan.paths.map((item) => item.path)].sort();
    if (changed.length !== planned.length || changed.some((item, index) => item !== planned[index])) return null;
    for (const item of plan.paths) {
      const oid = await executeGit(['rev-parse', `${head}:${item.path}`], { allowFailure: true });
      const actual = oid.exitCode === 0 ? oid.stdout.toString('utf8').trim().toLowerCase() : 'missing';
      if (actual !== item.afterGitOid) return null;
    }
    const treeSha = (await executeGit(['rev-parse', `${head}^{tree}`])).stdout.toString('utf8').trim().toLowerCase();
    const commitEnvironment = {
      ...gitEnvironment,
      GIT_AUTHOR_NAME: 'SMU-1 Admin',
      GIT_AUTHOR_EMAIL: 'admin@localhost.invalid',
      GIT_COMMITTER_NAME: 'SMU-1 Admin',
      GIT_COMMITTER_EMAIL: 'admin@localhost.invalid',
      GIT_AUTHOR_DATE: plan.commitTimestamp,
      GIT_COMMITTER_DATE: plan.commitTimestamp,
    };
    const expected = (await executeGit(
      ['commit-tree', treeSha, '-p', plan.baseHead, '-m', job.commitMessage],
      { env: commitEnvironment },
    )).stdout.toString('utf8').trim().toLowerCase();
    if (expected !== head) return null;
    return {
      version: 1,
      status: 'committed',
      empty: false,
      planFingerprint: job.planFingerprint,
      selectedTransactionIds: [...job.selectedTransactionIds],
      baseHead: plan.baseHead,
      anchorSha: plan.anchorSha,
      treeSha,
      testedSha: head,
      protectedSha: plan.protectedMainSha,
      remoteBefore: clone(plan.remoteRefs),
      paths: clone(plan.paths),
      gates: {
        ok: true,
        testedSha: head,
        results: Object.fromEntries((plan.gates ?? []).map((gate) => [gate, { ok: true, recoveredAfterCommit: true }])),
      },
    };
  }

  async function markFailure(jobId, error) {
    await updateState((draft) => {
      const job = draft.jobs[jobId];
      if (!job) return;
      const testedSha = job.statusRecord?.testedSha ?? job.receipt?.testedSha;
      try {
        job.statusRecord = transitionPublishStatus(job.statusRecord, {
          status: PUBLISH_STATUSES.FAILURE,
          testedSha,
          error: error?.message,
        }, { now });
      } catch {
        // A terminal record stays terminal; the service error is still persisted below.
      }
      job.status = PUBLISH_STATUSES.FAILURE;
      job.error = publicError(error, false);
      job.updatedAt = nowIso();
    });
  }

  async function persistPrepared(jobId, receipt) {
    const safeReceipt = cleanReceipt(receipt);
    await updateState((draft) => {
      const job = draft.jobs[jobId];
      let statusRecord = job.statusRecord;
      if (statusRecord.status === PUBLISH_STATUSES.PREPARING) {
        statusRecord = tracker.localGates(statusRecord, safeReceipt.testedSha);
      }
      if (statusRecord.status === PUBLISH_STATUSES.LOCAL_GATES) {
        statusRecord = tracker.prepared(statusRecord, safeReceipt);
      }
      job.receipt = safeReceipt;
      job.statusRecord = statusRecord;
      job.status = statusRecord.status;
      job.error = null;
      job.updatedAt = nowIso();
    });
  }

  async function prepareJob(jobId) {
    await updateState((draft) => {
      const job = draft.jobs[jobId];
      job.attempts.prepare += 1;
      job.status = PUBLISH_STATUSES.PREPARING;
      job.updatedAt = nowIso();
    });
    const job = clone(state.jobs[jobId]);
    let receipt;
    try {
      await assertStable();
      receipt = await runner.prepare(job.plan, { target: 'preview', commitMessage: job.commitMessage });
    } catch (error) {
      try { receipt = await recoverPreparedReceipt(job); } catch { receipt = null; }
      if (!receipt) throw error;
    }
    await persistPrepared(jobId, receipt);
  }

  async function pushJob(jobId) {
    await updateState((draft) => {
      const job = draft.jobs[jobId];
      job.attempts.push += 1;
      job.updatedAt = nowIso();
    });
    const job = clone(state.jobs[jobId]);
    const result = cleanPushResult(await runner.push(job.receipt, { target: 'preview' }));
    await updateState((draft) => {
      const current = draft.jobs[jobId];
      current.pushResult = result;
      current.statusRecord = tracker.pushed(current.statusRecord, result);
      current.status = current.statusRecord.status;
      current.error = result.status === PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT
        ? publicError({ code: 'PUBLISH_UNKNOWN_NETWORK_RESULT', message: 'Результат сети неизвестен; обе refs будут сверены повторно.' }, true)
        : null;
      current.updatedAt = nowIso();
    });
  }

  async function pollJob(jobId) {
    await updateState((draft) => {
      draft.jobs[jobId].attempts.poll += 1;
      draft.jobs[jobId].updatedAt = nowIso();
    });
    const job = clone(state.jobs[jobId]);
    if (job.attempts.poll > maxPollAttempts) {
      throw new PublishServiceError('PUBLISH_DEPLOY_TIMEOUT', 'Истёк срок ожидания exact-SHA deployment.', { status: 504 });
    }
    let statusRecord;
    try {
      statusRecord = await tracker.poll(job.statusRecord);
    } catch (error) {
      await updateState((draft) => {
        const current = draft.jobs[jobId];
        current.error = publicError(error, true);
        current.updatedAt = nowIso();
      });
      if (autoRun) scheduleJob(jobId, pollIntervalMs);
      return;
    }
    await updateState((draft) => {
      const current = draft.jobs[jobId];
      current.statusRecord = statusRecord;
      current.status = statusRecord.status;
      current.error = null;
      current.updatedAt = nowIso();
      if (statusRecord.status === PUBLISH_STATUSES.DEPLOY_SUCCESS) {
        draft.lastSuccessfulPreviewSHA = requiredSha(statusRecord.testedSha, 'testedSha');
        for (const transactionId of current.selectedTransactionIds) {
          draft.publishedTransactions[transactionId] = {
            sha: statusRecord.testedSha,
            jobId,
            publishedAt: current.updatedAt,
            disposition: 'exact-deployment-success',
          };
        }
      }
    });
    if (autoRun && POLLABLE_STATUSES.has(statusRecord.status)) scheduleJob(jobId, pollIntervalMs);
  }

  async function runFlow(jobId) {
    try {
      let job = clone(state.jobs[jobId]);
      if (!job || TERMINAL_STATUSES.has(job.statusRecord?.status ?? job.status)) return;
      if (!job.receipt) {
        await prepareJob(jobId);
        job = clone(state.jobs[jobId]);
      }
      if ([PUBLISH_STATUSES.COMMITTED, PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT].includes(job.statusRecord?.status)) {
        if (job.statusRecord.status === PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT
          && job.attempts.push >= maxAutomaticPushRetries) return;
        await pushJob(jobId);
        job = clone(state.jobs[jobId]);
        if (job.statusRecord?.status === PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT) {
          if (autoRun && job.attempts.push < maxAutomaticPushRetries) scheduleJob(jobId, pollIntervalMs);
          return;
        }
      }
      if (POLLABLE_STATUSES.has(job.statusRecord?.status)) await pollJob(jobId);
    } catch (error) {
      await markFailure(jobId, error);
    }
  }

  function runNow(jobId) {
    if (activeJobs.has(jobId)) return activeJobs.get(jobId);
    const promise = runFlow(jobId).finally(() => activeJobs.delete(jobId));
    activeJobs.set(jobId, promise);
    return promise;
  }

  function scheduleJob(jobId, delay) {
    if (closed || timers.has(jobId)) return;
    const timer = scheduleLater(() => {
      timers.delete(jobId);
      void runNow(jobId);
    }, Math.max(0, delay));
    timers.set(jobId, timer);
  }

  async function getStatus(request = {}) {
    await ensureInitialized();
    const principal = ownership(request);
    const recovery = recoveryOwnership(request, principal);
    await adoptSession(principal, recovery);
    const jobId = requiredId(request.jobId, 'jobId');
    return publicJob(assertOwned(state.jobs[jobId], principal, 'job', recovery));
  }

  async function retry(request = {}) {
    await ensureInitialized();
    assertPreviewTarget(request.target);
    const principal = ownership(request);
    const recovery = recoveryOwnership(request, principal);
    await adoptSession(principal, recovery);
    const jobId = requiredId(request.jobId, 'jobId');
    const job = assertOwned(state.jobs[jobId], principal, 'job', recovery);
    if (job.recoveryKey !== recovery.recoveryKey) {
      throw new PublishServiceError('PUBLISH_JOB_NOT_FOUND', 'job не найден.', { status: 404 });
    }
    const status = job.statusRecord?.status ?? job.status;
    if (TERMINAL_STATUSES.has(status)) {
      if (status === PUBLISH_STATUSES.FAILURE) {
        const testedSha = job.statusRecord?.testedSha ?? job.receipt?.testedSha;
        const exactPush = job.pushResult?.status === PUBLISH_STATUSES.PUSHED
          && job.pushResult?.pushed === true
          && job.pushResult?.testedSha === testedSha
          && job.pushResult?.refs?.candidate === testedSha
          && job.pushResult?.refs?.preview === testedSha;
        if (!exactPush) {
          throw new PublishServiceError(
            'PUBLISH_JOB_NOT_RETRYABLE',
            'Ошибка произошла до доказанного atomic push. Подготовьте новый план; refs не изменялись.',
          );
        }
        await updateState((draft) => {
          const current = draft.jobs[jobId];
          current.statusRecord = tracker.resumePushed(current.statusRecord, {
            requestedAt: nowIso(),
            reason: current.error?.code ?? 'post-push-failure',
          });
          current.status = current.statusRecord.status;
          current.error = null;
          current.retryResult = null;
          current.attempts.retry = (current.attempts.retry ?? 0) + 1;
          current.attempts.poll = 0;
          current.updatedAt = nowIso();
        });
        try {
          const retryResult = await retryProvider({
            testedSha,
            statusRecord: clone(job.statusRecord),
            evidence: clone(job.statusRecord?.evidence ?? {}),
          });
          if (retryResult?.testedSha && retryResult.testedSha !== testedSha) {
            throw new PublishServiceError('PUBLISH_RETRY_SHA_MISMATCH', 'Recovery provider вернул другой SHA.', {
              status: 500,
              details: { expected: testedSha, actual: retryResult.testedSha },
            });
          }
          await updateState((draft) => {
            const active = draft.jobs[jobId];
            active.retryResult = retryResult ?? { action: 'repoll', testedSha, requested: false };
            active.updatedAt = nowIso();
          });
        } catch (error) {
          await markFailure(jobId, error);
          throw error;
        }
      } else {
        return publicJob(job);
      }
    }
    const timer = timers.get(jobId);
    if (timer) {
      cancelScheduled(timer);
      timers.delete(jobId);
    }
    await runNow(jobId);
    return publicJob(state.jobs[jobId]);
  }

  async function poll(request = {}) {
    await ensureInitialized();
    const principal = ownership(request);
    const recovery = recoveryOwnership(request, principal);
    await adoptSession(principal, recovery);
    const jobId = requiredId(request.jobId, 'jobId');
    const job = assertOwned(state.jobs[jobId], principal, 'job', recovery);
    const status = job.statusRecord?.status ?? job.status;
    if (!POLLABLE_STATUSES.has(status)) return publicJob(job);
    const timer = timers.get(jobId);
    if (timer) {
      cancelScheduled(timer);
      timers.delete(jobId);
    }
    await runNow(jobId);
    return publicJob(state.jobs[jobId]);
  }

  async function report(request = {}) {
    await ensureInitialized();
    const principal = ownership(request);
    const recovery = recoveryOwnership(request, principal);
    await adoptSession(principal, recovery);
    const jobId = requiredId(request.jobId, 'jobId');
    const job = assertOwned(state.jobs[jobId], principal, 'job', recovery);
    return clone({
      version: 1,
      kind: 'smu1-publish-report',
      generatedAt: nowIso(),
      job: publicJob(job),
      plan: job.plan,
      receipt: job.receipt,
      pushResult: job.pushResult,
      lastSuccessfulPreviewSHA: state.lastSuccessfulPreviewSHA,
      protectedRef: ownedRefs.protected,
      productionEnabled: false,
    });
  }

  async function close() {
    closed = true;
    for (const timer of timers.values()) cancelScheduled(timer);
    timers.clear();
    await Promise.allSettled([...activeJobs.values()]);
    await stateQueue;
  }

  return Object.freeze({
    initialize,
    preview,
    getPlan,
    start,
    overview,
    getStatus,
    poll,
    retry,
    report,
    close,
    runtimePaths: Object.freeze({ runtimeDir, statePath, backupPath }),
  });
}

import crypto from 'node:crypto';

export class ReleaseControlError extends Error {
  constructor(code, message, { status = 400, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReleaseControlError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function disabledProduction() {
  throw new ReleaseControlError(
    'H6_PRODUCTION_DISABLED',
    'Основной сайт будет подключён при запуске H7. Сейчас доступна только тестовая публикация.',
    { status: 403 }
  );
}

function requiredFunction(object, key) {
  if (typeof object?.[key] !== 'function') {
    throw new ReleaseControlError('HOSTING_ADAPTER_INVALID', `HostingAdapter не реализует ${key}().`, { status: 500 });
  }
}

export function assertHostingAdapter(adapter) {
  for (const key of ['preparePreview', 'deployPreview', 'stageProduction', 'promote', 'rollback', 'verify']) requiredFunction(adapter, key);
  return adapter;
}

function transactionIds(request = {}) {
  const values = request.transactionIds ?? request.selectedTransactionIds ?? [];
  if (!Array.isArray(values) || values.length === 0) {
    throw new ReleaseControlError('RELEASE_TRANSACTION_SELECTION_REQUIRED', 'Нужна сохранённая редакция для тестовой публикации.');
  }
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function verifiedArtifactFromExact(exact, selectedTransactionIds, request = {}) {
  if (!exact?.runId || !exact?.transactionId || !exact?.revision || !exact?.snapshotSha256) {
    throw new ReleaseControlError(
      'RELEASE_EXACT_EVIDENCE_INCOMPLETE',
      'Exact-проверка не вернула полную identity сохранённой редакции.',
      { status: 500 }
    );
  }
  if (!selectedTransactionIds.includes(exact.transactionId)) {
    throw new ReleaseControlError(
      'RELEASE_EXACT_TRANSACTION_MISMATCH',
      'Exact-проверка относится к другой сохранённой редакции.',
      { status: 409 }
    );
  }
  if (request.sourceRevision && String(request.sourceRevision) !== String(exact.revision)) {
    throw new ReleaseControlError(
      'RELEASE_SOURCE_REVISION_MISMATCH',
      'План относится к другой exact revision. Подготовьте его заново.',
      { status: 409, details: { expected: request.sourceRevision, actual: exact.revision } }
    );
  }
  return Object.freeze({
    version: 1,
    kind: 'smu1-verified-local-revision',
    exactRunId: exact.runId,
    sourceTransactionId: exact.transactionId,
    sourceRevision: exact.revision,
    sourceBaseSha: exact.sourceSha,
    transactionIds: clone(selectedTransactionIds),
    contentSchemaHash: exact.schemaHash,
    bindingRegistryHash: exact.bindingRegistryHash,
    h5PipelineHash: exact.h5PipelineHash,
    snapshotSha256: exact.snapshotSha256,
    artifactManifestSha256: exact.artifact?.manifestSha256 || null,
    fileCount: exact.artifact?.fileCount ?? null,
    totalBytes: exact.artifact?.totalBytes ?? null,
    largestFile: clone(exact.artifact?.largestFile || null)
  });
}

/**
 * Provider-neutral admin boundary. Hosting credentials stay behind adapter;
 * ReleaseControl receives only revision/evidence identifiers.
 */
export function createReleaseControl(options = {}) {
  const exactValidation = options.exactValidation;
  if (!exactValidation?.assertPublishable) {
    throw new ReleaseControlError('RELEASE_EXACT_SERVICE_REQUIRED', 'ReleaseControl требует exact validation service.', { status: 500 });
  }
  const hosting = assertHostingAdapter(options.hostingAdapter);

  async function exactEvidence(request = {}) {
    const selectedTransactionIds = transactionIds(request);
    const exact = await exactValidation.assertPublishable({
      ...request,
      transactionIds: selectedTransactionIds
    });
    return verifiedArtifactFromExact(exact, selectedTransactionIds, request);
  }

  async function preparePreview(request = {}) {
    const verifiedArtifact = await exactEvidence(request);
    return hosting.preparePreview({ verifiedArtifact, request: clone(request) });
  }

  async function requestPreview(request = {}) {
    // This is intentionally repeated after the user confirms the plan. A
    // passed gate at plan time is not authority to deploy a later revision.
    const verifiedArtifact = await exactEvidence(request);
    return hosting.deployPreview({ verifiedArtifact, request: clone(request) });
  }

  async function getStatus(runId) {
    return hosting.verify({ deploymentId: String(runId || ''), target: 'preview' });
  }

  async function getPreviewEvidence(runId) {
    const status = await getStatus(runId);
    const evidence = status?.evidence || status;
    const sourceVerification = evidence?.sourceVerification || status?.verification || null;
    const liveSmoke = evidence?.liveSmoke || evidence?.smoke || null;
    const byteIdentityVerified = evidence?.byteIdentityVerified === true;
    return clone({
      runId: String(runId || ''),
      exactRunId: sourceVerification?.exactRunId || null,
      sourceTransactionId: sourceVerification?.sourceTransactionId || null,
      sourceRevision: sourceVerification?.sourceRevision || null,
      sourceBaseSha: sourceVerification?.sourceBaseSha || null,
      testedCommitSha: evidence?.testedCommitSha || status?.testedSha || null,
      contentSchemaHash: sourceVerification?.contentSchemaHash || null,
      bindingRegistryHash: sourceVerification?.bindingRegistryHash || null,
      h5PipelineHash: sourceVerification?.h5PipelineHash || null,
      snapshotSha256: sourceVerification?.snapshotSha256 || null,
      artifactManifestSha256: sourceVerification?.artifactManifestSha256 || null,
      fileCount: sourceVerification?.fileCount ?? null,
      totalBytes: sourceVerification?.totalBytes ?? null,
      largestFile: sourceVerification?.largestFile || null,
      ciRunId: evidence?.ciRunId || evidence?.workflowRunId || null,
      providerDeploymentId: evidence?.providerDeploymentId || evidence?.deploymentId || null,
      mutablePreviewUrl: evidence?.mutablePreviewUrl || evidence?.previewUrl || null,
      previewUrlIsImmutable: false,
      productionUrl: null,
      previousProductionDeployment: null,
      liveSmoke,
      artifactIdentity: evidence?.artifactIdentity || liveSmoke?.artifactIdentity || null,
      byteIdentityVerified,
      identityVerified: byteIdentityVerified && liveSmoke?.ok === true && evidence?.identityVerified === true,
      status: status?.status || null
    });
  }

  return Object.freeze({
    preparePreview,
    requestPreview,
    getStatus,
    getPreviewEvidence,
    requestProduction: disabledProduction,
    rollback: disabledProduction,
    capabilities: Object.freeze({ preview: true, production: false, rollback: false })
  });
}

/** Adapter for the current candidate/preview GitHub publish service. */
export function createH6PreviewHostingAdapter({ getPublishService } = {}) {
  if (typeof getPublishService !== 'function') {
    throw new ReleaseControlError('PUBLISH_SERVICE_PROVIDER_REQUIRED', 'Нужен lazy provider publish service.', { status: 500 });
  }
  return assertHostingAdapter(Object.freeze({
    async preparePreview({ verifiedArtifact, request } = {}) {
      const service = await getPublishService();
      return service.preview({
        ...request,
        target: 'preview',
        transactionIds: verifiedArtifact?.transactionIds || [],
        verifiedArtifact
      });
    },
    async deployPreview({ verifiedArtifact, request } = {}) {
      const service = await getPublishService();
      const plan = request?.planId
        ? null
        : await service.preview({
            ...request,
            target: 'preview',
            transactionIds: verifiedArtifact?.transactionIds || [],
            verifiedArtifact
          });
      const job = await service.start({
        ...request,
        target: 'preview',
        planId: request?.planId || plan?.planId,
        idempotencyKey: request?.idempotencyKey || `release-${crypto.randomUUID()}`,
        verifiedArtifact
      });
      return job;
    },
    stageProduction: disabledProduction,
    promote: disabledProduction,
    rollback: disabledProduction,
    async verify({ deploymentId, request } = {}) {
      const service = await getPublishService();
      const job = await service.getStatus({ ...request, target: 'preview', jobId: deploymentId });
      const smoke = job.evidence?.smoke || null;
      const byteIdentityVerified = job.success === true && smoke?.byteIdentityVerified === true;
      return {
        ...job,
        evidence: {
          ...(job.evidence || {}),
          sourceVerification: clone(job.verification || null),
          testedCommitSha: job.testedSha,
          providerDeploymentId: job.evidence?.pages?.deploymentId || null,
          mutablePreviewUrl: job.evidence?.pages?.url || null,
          previewUrlIsImmutable: false,
          liveSmoke: smoke,
          artifactIdentity: smoke?.artifactIdentity || null,
          byteIdentityVerified,
          identityVerified: byteIdentityVerified && smoke?.identityVerified === true
        }
      };
    }
  }));
}

export const hostingAdapterContract = Object.freeze({
  version: 1,
  methods: Object.freeze(['preparePreview', 'deployPreview', 'stageProduction', 'promote', 'rollback', 'verify']),
  productionEnabledInH6: false
});

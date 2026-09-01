const FULL_SHA_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const PIPELINE_HASH_RE = /^[a-f0-9]{8,64}$/u;
const CANONICAL_PATH_RE = /^\/uploads\/([a-f0-9]{64})\.jpg$/u;
const H5_PATH_RE = /^\/_media\/h5\/([a-f0-9]{2})\/([a-f0-9]{64})-([a-f0-9]{8,64})-w([1-9]\d*)\.(avif|webp|jpe?g|png)$/u;
const STAGING_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const nonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const exactArray = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function normalizeMediaPrivacyBasePath(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw === '/') return '/';
  if (raw.includes('\\') || raw.includes('?') || raw.includes('#') || raw.includes('//')) return null;
  const normalized = `/${raw.replace(/^\/+|\/+$/gu, '')}`;
  return normalized.split('/').some((part) => part === '.' || part === '..') ? null : normalized;
}

function rasterAuditIssues(audit, prefix, { expectedPath = '', expected = null } = {}) {
  const issues = [];
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return [`${prefix}:missing`];
  if (expectedPath && audit.path !== expectedPath) issues.push(`${prefix}:path`);
  if (audit.pass !== true) issues.push(`${prefix}:pass`);
  if (!positiveInteger(audit.bytes)) issues.push(`${prefix}:bytes`);
  if (!SHA256_RE.test(audit.sha256 || '')) issues.push(`${prefix}:sha256`);
  if (!Array.isArray(audit.dimensions) || audit.dimensions.length !== 2 || !audit.dimensions.every(positiveInteger)) {
    issues.push(`${prefix}:dimensions`);
  }
  if (audit.exif !== false || audit.xmp !== false || audit.iptc !== false
    || audit.comments !== 0 || audit.orientation !== null
    || !Array.isArray(audit.leakedMarkers) || audit.leakedMarkers.length !== 0) {
    issues.push(`${prefix}:metadata`);
  }
  if (expected) {
    if (audit.sha256 !== expected.sha256 || audit.bytes !== expected.bytes
      || audit.format !== expected.format || !exactArray(audit.dimensions, expected.dimensions)) {
      issues.push(`${prefix}:byte-identity`);
    }
  }
  return issues;
}

function uploadAuditIssues(audit, prefix) {
  const issues = [];
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return [`${prefix}:missing`];
  if (audit.absent !== true) issues.push(`${prefix}:private-master-present`);
  if (!positiveInteger(audit.filesAudited)) issues.push(`${prefix}:files-audited`);
  if (!nonNegativeInteger(audit.candidateHashesAudited)
    || audit.candidateHashesAudited > (audit.filesAudited || -1)) issues.push(`${prefix}:candidate-hashes`);
  return issues;
}

export function validateMediaPrivacyEvidence(report, {
  expectedSourceSHA = '',
  expectedBranch = '',
  expectedBasePath = '',
  expectedPipelineHash = '',
  expectedArtifactFingerprint = '',
  expectedArtifactFileCount = null,
  expectedArtifactBytes = null,
  nowMs = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS
} = {}) {
  const issues = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { ok: false, issues: ['media-privacy:report-missing'], ageMs: null };
  }
  if (report.schemaVersion !== 1) issues.push('media-privacy:schema-version');
  if (report.ok !== true) issues.push('media-privacy:report-failed');
  if (report.disposable !== true) issues.push('media-privacy:not-disposable');

  const createdMs = Date.parse(report.createdAt || '');
  const ageMs = Number.isFinite(createdMs) ? nowMs - createdMs : null;
  if (!Number.isFinite(createdMs) || new Date(createdMs).toISOString() !== report.createdAt) {
    issues.push('media-privacy:created-at');
  } else {
    if (ageMs < -MAX_FUTURE_SKEW_MS) issues.push('media-privacy:future-report');
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || ageMs > maxAgeMs) issues.push('media-privacy:stale-report');
  }

  if (!FULL_SHA_RE.test(report.sourceSHA || '')) issues.push('media-privacy:source-sha');
  if (expectedSourceSHA && report.sourceSHA !== expectedSourceSHA) issues.push('media-privacy:source-sha-mismatch');
  if (typeof report.branch !== 'string' || !report.branch.trim()) issues.push('media-privacy:branch');
  if (expectedBranch && report.branch !== expectedBranch) issues.push('media-privacy:branch-mismatch');
  const basePath = normalizeMediaPrivacyBasePath(report.basePath);
  const expectedBase = expectedBasePath ? normalizeMediaPrivacyBasePath(expectedBasePath) : null;
  if (!basePath) issues.push('media-privacy:base-path');
  if (expectedBasePath && (!expectedBase || basePath !== expectedBase)) issues.push('media-privacy:base-path-mismatch');

  const releaseArtifact = report.releaseArtifact;
  if (!releaseArtifact || !SHA256_RE.test(releaseArtifact.sha256 || '')
    || !positiveInteger(releaseArtifact.fileCount) || !positiveInteger(releaseArtifact.bytes)) {
    issues.push('media-privacy:release-artifact');
  } else {
    if (expectedArtifactFingerprint && releaseArtifact.sha256 !== expectedArtifactFingerprint) {
      issues.push('media-privacy:artifact-fingerprint-mismatch');
    }
    if (expectedArtifactFileCount !== null && releaseArtifact.fileCount !== expectedArtifactFileCount) {
      issues.push('media-privacy:artifact-file-count-mismatch');
    }
    if (expectedArtifactBytes !== null && releaseArtifact.bytes !== expectedArtifactBytes) {
      issues.push('media-privacy:artifact-bytes-mismatch');
    }
  }

  const canonical = report.canonical;
  const canonicalPathMatch = CANONICAL_PATH_RE.exec(canonical?.path || '');
  issues.push(...rasterAuditIssues(canonical, 'media-privacy:canonical'));
  if (!canonicalPathMatch || canonicalPathMatch[1] !== canonical?.sha256 || canonical?.format !== 'jpeg') {
    issues.push('media-privacy:canonical-path-hash');
  }

  const privateSource = report.privateSource;
  if (!privateSource || privateSource.generatedInMemoryOnly !== true || !positiveInteger(privateSource.bytes)
    || !SHA256_RE.test(privateSource.sha256 || '') || privateSource.gpsDetected !== true
    || privateSource.deviceDetected !== true || privateSource.orientationApplied !== true
    || privateSource.absentFromStaging !== true
    || privateSource.absentFromPublicUploads !== true || privateSource.absentFromDeployUploads !== true) {
    issues.push('media-privacy:private-source');
  }
  if (privateSource?.sha256 && privateSource.sha256 === canonical?.sha256) issues.push('media-privacy:source-not-sanitized');
  issues.push(...uploadAuditIssues(privateSource?.stagingAudit, 'media-privacy:staging-audit'));
  issues.push(...uploadAuditIssues(privateSource?.publicUploadAudit, 'media-privacy:public-upload-audit'));
  issues.push(...uploadAuditIssues(privateSource?.deployUploadAudit, 'media-privacy:deploy-upload-audit'));

  const mutations = report.transaction?.mutations;
  if (!report.transaction || report.transaction.state !== 'committed'
    || typeof report.transaction.transactionId !== 'string' || !report.transaction.transactionId
    || !Array.isArray(mutations) || mutations.length !== 2 || new Set(mutations).size !== 2
    || !mutations.some((value) => /^src\/content\/products\/[A-Za-z0-9._-]+\.json$/u.test(value))
    || !mutations.includes(`public${canonical?.path || ''}`)) {
    issues.push('media-privacy:transaction');
  }

  const staging = report.staging;
  const staged = staging?.staged;
  const resolved = staging?.resolved;
  const promoted = staging?.promoted;
  if (!staging || staging.service !== 'createMediaStagingService'
    || !exactArray(staging.sequence, ['stage', 'resolveForPromotion', 'atomic transaction', 'markPromoted'])
    || staging.rootWithinDisposableRuntime !== true) {
    issues.push('media-privacy:staging-chain');
  }
  if (!staged || !STAGING_ID_RE.test(staged.batchId || '') || !STAGING_ID_RE.test(staged.ownerId || '')
    || !STAGING_ID_RE.test(staged.clientId || '') || staged.status !== 'ready' || staged.promoted !== false
    || staged.stagedId !== canonical?.sha256 || staged.canonicalPath !== canonical?.path
    || staged.sourceSha256 !== privateSource?.sha256 || staged.sanitizedSha256 !== canonical?.sha256
    || staged.sourceBytes !== privateSource?.bytes || staged.sanitizedBytes !== canonical?.bytes
    || staged.metadataSanitized !== true) {
    issues.push('media-privacy:staged-media');
  }
  if (!resolved || resolved.verified !== true || resolved.fileWithinQuarantine !== true
    || resolved.bytes !== canonical?.bytes || resolved.sha256 !== canonical?.sha256) {
    issues.push('media-privacy:promotion-resolution');
  }
  if (!promoted || promoted.afterCommittedTransaction !== true || promoted.promoted !== true
    || promoted.status !== 'promoted' || promoted.stagedId !== staged?.stagedId
    || promoted.canonicalPath !== canonical?.path || report.transaction?.state !== 'committed') {
    issues.push('media-privacy:promotion-mark');
  }

  const pipelineHash = report.h5?.pipelineHash;
  if (!PIPELINE_HASH_RE.test(pipelineHash || '')) issues.push('media-privacy:h5-pipeline');
  if (expectedPipelineHash && pipelineHash !== expectedPipelineHash) issues.push('media-privacy:h5-pipeline-mismatch');
  const variants = Array.isArray(report.h5?.variants) ? report.h5.variants : [];
  if (!positiveInteger(report.h5?.variantCount) || report.h5.variantCount !== variants.length) {
    issues.push('media-privacy:h5-count');
  }
  const variantByPath = new Map();
  const variantHashes = new Set();
  for (const [index, variant] of variants.entries()) {
    const prefix = `media-privacy:h5-variant:${index}`;
    issues.push(...rasterAuditIssues(variant, prefix));
    const match = H5_PATH_RE.exec(variant?.path || '');
    const extension = match?.[5] || '';
    const expectedFormat = extension === 'avif' ? ['avif', 'heif'] : extension === 'jpg' || extension === 'jpeg' ? ['jpeg'] : [extension];
    if (!match || match[1] !== canonical?.sha256?.slice(0, 2) || match[2] !== canonical?.sha256
      || match[3] !== pipelineHash || Number(match[4]) !== variant?.dimensions?.[0]
      || !expectedFormat.includes(variant?.format)) issues.push(`${prefix}:path-contract`);
    if (variantByPath.has(variant?.path)) issues.push(`${prefix}:duplicate-path`);
    else variantByPath.set(variant?.path, variant);
    if (variantHashes.has(variant?.sha256)) issues.push(`${prefix}:duplicate-hash`);
    else variantHashes.add(variant?.sha256);
    if (Array.isArray(canonical?.dimensions) && Array.isArray(variant?.dimensions)
      && (variant.dimensions[0] > canonical.dimensions[0] || variant.dimensions[1] > canonical.dimensions[1])) {
      issues.push(`${prefix}:upscale`);
    }
    if (variant?.sha256 === privateSource?.sha256) issues.push(`${prefix}:private-master-hash`);
  }

  const deployFiles = Array.isArray(report.deployArtifact?.files) ? report.deployArtifact.files : [];
  if (!report.deployArtifact || report.deployArtifact.routeReferencesCanonical !== true
    || !/^\/(?:[A-Za-z0-9._~-]+\/)+$/u.test(report.deployArtifact.route || '')
    || !positiveInteger(report.deployArtifact.fileCount) || report.deployArtifact.fileCount !== deployFiles.length
    || deployFiles.length !== variants.length + 1) {
    issues.push('media-privacy:deploy-artifact');
  }
  const expectedDeploy = new Map([[canonical?.path, canonical], ...variantByPath.entries()]);
  const seenDeploy = new Set();
  for (const [index, file] of deployFiles.entries()) {
    const prefix = `media-privacy:deploy-file:${index}`;
    const expected = expectedDeploy.get(file?.path);
    issues.push(...rasterAuditIssues(file, prefix, { expectedPath: file?.path || '', expected }));
    if (!expected) issues.push(`${prefix}:unexpected`);
    if (seenDeploy.has(file?.path)) issues.push(`${prefix}:duplicate`);
    seenDeploy.add(file?.path);
    if (file?.sha256 === privateSource?.sha256) issues.push(`${prefix}:private-master-hash`);
  }
  for (const expectedPath of expectedDeploy.keys()) {
    if (!seenDeploy.has(expectedPath)) issues.push(`media-privacy:deploy-file-missing:${expectedPath || '?'}`);
  }

  const expectedStages = ['H5 media prepare', 'isolated Astro build', 'isolated deploy preparation'];
  if (!Array.isArray(report.stages) || !exactArray(report.stages.map((stage) => stage?.label), expectedStages)
    || report.stages.some((stage) => !nonNegativeInteger(stage?.durationMs))) {
    issues.push('media-privacy:stages');
  }

  return {
    ok: issues.length === 0,
    issues,
    sourceSHA: FULL_SHA_RE.test(report.sourceSHA || '') ? report.sourceSHA : null,
    pipelineHash: PIPELINE_HASH_RE.test(pipelineHash || '') ? pipelineHash : null,
    ageMs
  };
}

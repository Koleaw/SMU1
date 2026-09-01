import assert from 'node:assert/strict';
import test from 'node:test';

import { validateMediaPrivacyEvidence } from './media-privacy-evidence.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const PRIVATE_SHA = 'b'.repeat(64);
const CANONICAL_SHA = 'c'.repeat(64);
const PIPELINE = 'd'.repeat(12);
const ARTIFACT_SHA = 'e'.repeat(64);
const CREATED_AT = '2026-09-01T10:00:00.000Z';
const NOW = Date.parse('2026-09-01T10:05:00.000Z');
const canonicalPath = `/uploads/${CANONICAL_SHA}.jpg`;
const variantPath = `/_media/h5/${CANONICAL_SHA.slice(0, 2)}/${CANONICAL_SHA}-${PIPELINE}-w160.webp`;
const raster = (overrides = {}) => ({
  path: canonicalPath,
  bytes: 1024,
  sha256: CANONICAL_SHA,
  format: 'jpeg',
  dimensions: [360, 640],
  exif: false,
  xmp: false,
  iptc: false,
  comments: 0,
  orientation: null,
  leakedMarkers: [],
  pass: true,
  ...overrides
});

function validReport() {
  const canonical = raster();
  const variant = raster({ path: variantPath, bytes: 512, sha256: 'f'.repeat(64), format: 'webp', dimensions: [160, 284] });
  return {
    schemaVersion: 1,
    ok: true,
    createdAt: CREATED_AT,
    sourceSHA: SOURCE_SHA,
    branch: 'candidate',
    basePath: '/SMU1',
    disposable: true,
    releaseArtifact: { sha256: ARTIFACT_SHA, fileCount: 100, bytes: 100_000 },
    transaction: {
      transactionId: 'tx-media-privacy',
      state: 'committed',
      mutations: ['src/content/products/fixture.json', `public${canonicalPath}`]
    },
    staging: {
      service: 'createMediaStagingService',
      sequence: ['stage', 'resolveForPromotion', 'atomic transaction', 'markPromoted'],
      rootWithinDisposableRuntime: true,
      staged: {
        batchId: 'h6-media-privacy-batch',
        ownerId: 'h6-media-privacy-owner',
        clientId: 'h6-media-privacy-item',
        status: 'ready',
        promoted: false,
        stagedId: CANONICAL_SHA,
        canonicalPath,
        sourceSha256: PRIVATE_SHA,
        sanitizedSha256: CANONICAL_SHA,
        sourceBytes: 2048,
        sanitizedBytes: 1024,
        metadataSanitized: true
      },
      resolved: {
        verified: true,
        bytes: 1024,
        sha256: CANONICAL_SHA,
        fileWithinQuarantine: true
      },
      promoted: {
        afterCommittedTransaction: true,
        promoted: true,
        status: 'promoted',
        stagedId: CANONICAL_SHA,
        canonicalPath
      }
    },
    privateSource: {
      generatedInMemoryOnly: true,
      bytes: 2048,
      sha256: PRIVATE_SHA,
      gpsDetected: true,
      deviceDetected: true,
      orientationApplied: true,
      absentFromStaging: true,
      absentFromPublicUploads: true,
      absentFromDeployUploads: true,
      stagingAudit: { absent: true, filesAudited: 3, candidateHashesAudited: 0 },
      publicUploadAudit: { absent: true, filesAudited: 3, candidateHashesAudited: 1 },
      deployUploadAudit: { absent: true, filesAudited: 2, candidateHashesAudited: 0 }
    },
    canonical,
    h5: { pipelineHash: PIPELINE, variantCount: 1, variants: [variant] },
    deployArtifact: {
      route: '/catalog/fixture/',
      routeReferencesCanonical: true,
      fileCount: 2,
      files: [structuredClone(canonical), structuredClone(variant)]
    },
    stages: [
      { label: 'H5 media prepare', durationMs: 100 },
      { label: 'isolated Astro build', durationMs: 200 },
      { label: 'isolated deploy preparation', durationMs: 50 }
    ]
  };
}

const options = {
  expectedSourceSHA: SOURCE_SHA,
  expectedBranch: 'candidate',
  expectedBasePath: '/SMU1/',
  expectedPipelineHash: PIPELINE,
  expectedArtifactFingerprint: ARTIFACT_SHA,
  expectedArtifactFileCount: 100,
  expectedArtifactBytes: 100_000,
  nowMs: NOW
};

test('media privacy evidence accepts only a complete exact GPS-to-deploy chain', () => {
  assert.deepEqual(validateMediaPrivacyEvidence(validReport(), options).issues, []);
});

test('media privacy evidence rejects stale, foreign and incomplete reports', () => {
  const stale = validReport();
  stale.createdAt = '2026-08-31T00:00:00.000Z';
  assert.match(validateMediaPrivacyEvidence(stale, options).issues.join('\n'), /stale-report/u);

  const foreign = validReport();
  foreign.sourceSHA = '0'.repeat(40);
  foreign.basePath = '/other';
  foreign.h5.pipelineHash = '1'.repeat(12);
  foreign.releaseArtifact.sha256 = '2'.repeat(64);
  const foreignIssues = validateMediaPrivacyEvidence(foreign, options).issues.join('\n');
  assert.match(foreignIssues, /source-sha-mismatch/u);
  assert.match(foreignIssues, /base-path-mismatch/u);
  assert.match(foreignIssues, /h5-pipeline-mismatch/u);
  assert.match(foreignIssues, /artifact-fingerprint-mismatch/u);

  const incomplete = validReport();
  incomplete.privateSource.gpsDetected = false;
  incomplete.canonical.xmp = true;
  incomplete.canonical.pass = true;
  incomplete.h5.variants = [];
  incomplete.deployArtifact.files = [];
  incomplete.deployArtifact.fileCount = 0;
  const incompleteIssues = validateMediaPrivacyEvidence(incomplete, options).issues.join('\n');
  assert.match(incompleteIssues, /private-source/u);
  assert.match(incompleteIssues, /canonical:metadata/u);
  assert.match(incompleteIssues, /h5-count/u);
  assert.match(incompleteIssues, /deploy-file-missing/u);
});

test('media privacy evidence rejects direct sanitization claims without the real staging promotion chain', () => {
  const missing = validReport();
  delete missing.staging;
  const missingIssues = validateMediaPrivacyEvidence(missing, options).issues.join('\n');
  assert.match(missingIssues, /staging-chain/u);
  assert.match(missingIssues, /staged-media/u);
  assert.match(missingIssues, /promotion-resolution/u);
  assert.match(missingIssues, /promotion-mark/u);

  const reordered = validReport();
  reordered.staging.sequence = ['stage', 'resolveForPromotion', 'markPromoted', 'atomic transaction'];
  reordered.staging.promoted.afterCommittedTransaction = false;
  const reorderedIssues = validateMediaPrivacyEvidence(reordered, options).issues.join('\n');
  assert.match(reorderedIssues, /staging-chain/u);
  assert.match(reorderedIssues, /promotion-mark/u);
});

test('media privacy evidence rejects leaked or substituted deploy bytes even when pass flags are forged', () => {
  const leaked = validReport();
  leaked.privateSource.publicUploadAudit.absent = false;
  leaked.deployArtifact.files[1].sha256 = PRIVATE_SHA;
  leaked.deployArtifact.files[1].pass = true;
  const issues = validateMediaPrivacyEvidence(leaked, options).issues.join('\n');
  assert.match(issues, /private-master-present/u);
  assert.match(issues, /byte-identity/u);
  assert.match(issues, /private-master-hash/u);
});

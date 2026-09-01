import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReleaseControl,
  createH6PreviewHostingAdapter,
  hostingAdapterContract,
  ReleaseControlError
} from './release-control.mjs';

test('ReleaseControl reasserts exact evidence for plan and apply and keeps source/deploy identities distinct', async () => {
  const calls = [];
  let exactCalls = 0;
  const exactValidation = {
    async assertPublishable(request) {
      exactCalls += 1;
      assert.deepEqual(request.transactionIds, ['tx-verified']);
      return {
        runId: `exact-${'1'.repeat(32)}`,
        transactionId: 'tx-verified',
        revision: '2'.repeat(64),
        sourceSha: 'a'.repeat(40),
        schemaHash: 'b'.repeat(64),
        bindingRegistryHash: 'c'.repeat(64),
        h5PipelineHash: 'd'.repeat(64),
        snapshotSha256: 'e'.repeat(64),
        artifact: {
          manifestSha256: 'f'.repeat(64),
          fileCount: 4322,
          totalBytes: 423278606,
          largestFile: { path: 'assets/video/hero.mp4', bytes: 19322916 }
        }
      };
    }
  };
  const hostingAdapter = {
    async preparePreview(payload) { calls.push({ kind: 'plan', ...payload }); return { planId: 'plan-1' }; },
    async deployPreview(payload) { calls.push(payload); return { runId: 'preview-1', status: 'queued' }; },
    async stageProduction() {},
    async promote() {},
    async rollback() {},
    async verify() {
      return {
        status: 'success',
        evidence: {
          sourceVerification: calls[0].verifiedArtifact,
          testedCommitSha: '9'.repeat(40),
          deploymentId: 42,
          previewUrl: 'https://example.invalid/site/',
          smoke: { ok: true },
          identityVerified: true
        }
      };
    }
  };
  const control = createReleaseControl({ exactValidation, hostingAdapter });
  const plan = await control.preparePreview({
    transactionIds: ['tx-verified'],
    owner: 'pavel',
    recoveryClientId: 'browser'
  });
  assert.equal(plan.planId, 'plan-1');
  const job = await control.requestPreview({
    sourceRevision: '2'.repeat(64),
    transactionIds: ['tx-verified'],
    owner: 'pavel',
    recoveryClientId: 'browser'
  });
  assert.equal(job.runId, 'preview-1');
  assert.equal(exactCalls, 2, 'Apply must re-run the exact publishability assertion');
  assert.equal(calls[0].verifiedArtifact.artifactManifestSha256, 'f'.repeat(64));
  assert.equal(calls[0].verifiedArtifact.fileCount, 4322);
  assert.equal(calls[0].verifiedArtifact.largestFile.path, 'assets/video/hero.mp4');
  assert.equal(calls[0].verifiedArtifact.sourceBaseSha, 'a'.repeat(40));
  assert.equal(calls[0].verifiedArtifact.sourceRevision, '2'.repeat(64));
  assert.equal(calls[0].verifiedArtifact.bindingRegistryHash, 'c'.repeat(64));
  assert.deepEqual(calls[0].verifiedArtifact, calls[1].verifiedArtifact);

  const evidence = await control.getPreviewEvidence('preview-1');
  assert.equal(evidence.sourceBaseSha, 'a'.repeat(40));
  assert.equal(evidence.testedCommitSha, '9'.repeat(40));
  assert.equal(evidence.mutablePreviewUrl, 'https://example.invalid/site/');
  assert.equal(evidence.previewUrlIsImmutable, false);
  assert.equal(evidence.byteIdentityVerified, false);
  assert.equal(evidence.identityVerified, false, 'HTTP/live smoke without byte identity must not claim identity');
  assert.equal(control.capabilities.production, false);
  assert.deepEqual(hostingAdapterContract.methods, ['preparePreview', 'deployPreview', 'stageProduction', 'promote', 'rollback', 'verify']);
});

test('H6 production and rollback boundaries reject server-side without invoking hosting', async () => {
  const control = createReleaseControl({
    exactValidation: { async assertPublishable() { throw new Error('not used'); } },
    hostingAdapter: {
      async preparePreview() {}, async deployPreview() {}, async stageProduction() {}, async promote() {}, async rollback() {}, async verify() {}
    }
  });
  await assert.rejects(
    control.requestProduction({}),
    (error) => error instanceof ReleaseControlError && error.code === 'H6_PRODUCTION_DISABLED' && error.status === 403
  );
  await assert.rejects(
    control.rollback('deployment-1'),
    (error) => error.code === 'H6_PRODUCTION_DISABLED'
  );
});

test('preview gate failures stop before the hosting adapter', async () => {
  let deployed = false;
  const control = createReleaseControl({
    exactValidation: {
      async assertPublishable() {
        throw new ReleaseControlError('EXACT_PUBLISH_BLOCKED', 'stale', { status: 409 });
      }
    },
    hostingAdapter: {
      async preparePreview() {}, async deployPreview() { deployed = true; },
      async stageProduction() {}, async promote() {}, async rollback() {}, async verify() {}
    }
  });
  await assert.rejects(
    control.requestPreview({ transactionIds: ['tx-stale'] }),
    (error) => error.code === 'EXACT_PUBLISH_BLOCKED'
  );
  assert.equal(deployed, false);
});

test('H6 preview adapter exposes verified remote artifact identity only after successful byte smoke', async () => {
  const identity = {
    version: 1,
    kind: 'smu1-release-artifact-identity',
    testedCommitSha: '9'.repeat(40),
    artifactManifestSha256: '8'.repeat(64),
    fileCount: 12,
    totalBytes: 3456,
    largestFile: { path: 'assets/hero.webp', bytes: 1000, sha256: '7'.repeat(64) },
    markerSha256: '6'.repeat(64)
  };
  const adapter = createH6PreviewHostingAdapter({
    getPublishService: async () => ({
      async getStatus() {
        return {
          status: 'deploy-success',
          success: true,
          testedSha: identity.testedCommitSha,
          verification: { exactRunId: `exact-${'1'.repeat(32)}` },
          evidence: {
            pages: { deploymentId: 52, url: 'https://owner.github.io/repo/' },
            smoke: {
              ok: true,
              byteIdentityVerified: true,
              identityVerified: true,
              artifactIdentity: identity
            }
          }
        };
      }
    })
  });

  const result = await adapter.verify({ deploymentId: 'job-1' });
  assert.equal(result.status, 'deploy-success');
  assert.equal(result.evidence.byteIdentityVerified, true);
  assert.equal(result.evidence.identityVerified, true);
  assert.deepEqual(result.evidence.artifactIdentity, identity);
  assert.equal(result.evidence.mutablePreviewUrl, 'https://owner.github.io/repo/');
  assert.equal(result.evidence.previewUrlIsImmutable, false);
});

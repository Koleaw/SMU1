import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPublishStatusTracker } from './publish-status.mjs';
import {
  PublishServiceError,
  createManifestFromCommittedTransaction,
  createPublishService,
} from './publish-service.mjs';

const BASE = '1'.repeat(40);
const TESTED = '2'.repeat(40);
const MAIN = '3'.repeat(40);
const BEFORE = `sha256:${'a'.repeat(64)}:18`;
const AFTER = `sha256:${'b'.repeat(64)}:19`;
const ACTOR = {
  owner: 'owner-pavel',
  sessionFingerprint: 'session-abc123',
  recoveryClientId: 'recovery-browser-001',
};

const fp = (value) => `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

function tx(overrides = {}) {
  return {
    transactionId: 'txn-001',
    state: 'committed',
    createdAt: '2026-08-17T09:00:00.000Z',
    updatedAt: '2026-08-17T09:01:00.000Z',
    metadata: {
      baseHead: BASE,
      service: 'content-transaction',
      serviceVersion: 2,
      userSummary: 'Изменить карточку',
      affectedRoutes: ['/catalog/item/'],
      routeExpectations: [{ route: '/catalog/item/', expected: 'html' }],
    },
    mutations: [{
      path: 'src/content/products/item.json',
      operation: 'write',
      baseRevision: BEFORE,
      nextRevision: AFTER,
      willChange: true,
    }],
    ...overrides,
  };
}

function transactions(records = [tx()]) {
  const byId = new Map(records.map((record) => [record.transactionId, record]));
  return {
    async listHistory() {
      return records.map(({ mutations, ...record }) => record);
    },
    async getTransaction({ transactionId }) {
      return structuredClone(byId.get(transactionId));
    },
    async withStableRead(callback) {
      return callback();
    },
  };
}

function planner() {
  const calls = [];
  return {
    calls,
    async plan(request) {
      calls.push(structuredClone(request));
      const published = new Set(request.publishedTransactionIds);
      const selected = request.manifests.filter((manifest) => (
        request.selectedTransactionIds.includes(manifest.transactionId)
        && !published.has(manifest.transactionId)
      ));
      const ids = selected.map((manifest) => manifest.transactionId);
      const empty = !ids.length;
      const core = {
        version: 1,
        kind: 'smu1-content-publish-plan',
        target: 'preview',
        profile: 'content-only',
        remote: 'origin',
        refs: { candidate: 'v4-product-final-candidate', preview: 'preview', protected: 'main' },
        baseHead: request.lastSuccessfulPreviewSHA,
        anchorSha: request.lastSuccessfulPreviewSHA,
        protectedMainSha: MAIN,
        remoteRefs: { candidate: request.lastSuccessfulPreviewSHA, preview: request.lastSuccessfulPreviewSHA, protected: MAIN },
        transactionManifests: selected,
        unpublishedTransactionIds: request.manifests
          .filter((manifest) => !published.has(manifest.transactionId))
          .map((manifest) => manifest.transactionId),
        selectedTransactionIds: ids,
        automaticDependencyIds: [],
        excludedTransactionIds: [],
        paths: empty ? [] : [{
          path: 'src/content/products/item.json',
          operation: 'write',
          beforeHash: BEFORE,
          afterHash: AFTER,
          beforeGitOid: '4'.repeat(40),
          afterGitOid: '5'.repeat(40),
        }],
        affectedRoutes: empty ? [] : ['/catalog/item/'],
        routeExpectations: empty ? [] : [{ route: '/catalog/item/', expected: 'html' }],
        canonicalMedia: [],
        commitTimestamp: empty ? null : selected.at(-1).committedAt,
        gates: ['schema-transaction-validation'],
        targetRefs: ['refs/heads/v4-product-final-candidate', 'refs/heads/preview'],
        empty,
      };
      const fingerprint = fp({ anchor: core.anchorSha, ids, paths: core.paths });
      return { ...core, fingerprint, planFingerprint: fingerprint, commands: [['ls-remote']] };
    },
  };
}

function tracker() {
  return createPublishStatusTracker({
    workflowProvider: async ({ testedSha }) => ({ sha: testedSha, status: 'completed', conclusion: 'success' }),
    pagesProvider: async ({ testedSha }) => ({ sha: testedSha, status: 'completed', conclusion: 'success' }),
    smokeRunner: async ({ testedSha, affectedRoutes, routeExpectations }) => ({
      sha: testedSha,
      ok: true,
      checkedRoutes: affectedRoutes,
      routeExpectations,
      checks: routeExpectations.map(({ route, expected }) => ({
        route,
        expected,
        ok: true,
        status: expected === 'html' ? 200 : 404,
        outcome: expected === 'html' ? 'html' : 'intentional-not-found',
      })),
    }),
    now: () => new Date('2026-08-17T10:00:00Z'),
  });
}

function runner(count = { prepare: 0, push: 0 }) {
  return {
    async prepare(plan) {
      count.prepare += 1;
      return {
        version: 1,
        status: 'committed',
        empty: false,
        planFingerprint: plan.planFingerprint,
        selectedTransactionIds: plan.selectedTransactionIds,
        baseHead: plan.baseHead,
        anchorSha: plan.anchorSha,
        treeSha: '6'.repeat(40),
        testedSha: TESTED,
        protectedSha: MAIN,
        remoteBefore: plan.remoteRefs,
        paths: plan.paths,
        gates: {
          ok: true,
          testedSha: TESTED,
          results: { 'schema-transaction-validation': { ok: true, log: 'strip-me' } },
        },
        commands: [{ args: ['strip-me'] }],
      };
    },
    async push() {
      count.push += 1;
      return {
        status: 'pushed',
        pushed: true,
        testedSha: TESTED,
        refs: { candidate: TESTED, preview: TESTED, protected: MAIN },
        commands: [{ args: ['strip-me'] }],
      };
    },
  };
}

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-publish-service-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function options(root, overrides = {}) {
  return {
    repoRoot: root,
    runtimeDir: path.join(root, '.admin-runtime', 'publish'),
    initialLastSuccessfulPreviewSHA: BASE,
    transactionService: transactions(),
    planner: planner(),
    runner: runner(),
    statusTracker: tracker(),
    now: () => new Date('2026-08-17T10:00:00Z'),
    autoRun: false,
    ...overrides,
  };
}

test('history journal becomes typed manifest and missing baseHead fails closed', () => {
  const manifest = createManifestFromCommittedTransaction(tx());
  assert.equal(manifest.kind, 'smu1-content-transaction');
  assert.equal(manifest.baseHead, BASE);
  assert.deepEqual(manifest.affectedRoutes, ['/catalog/item/']);
  assert.deepEqual(manifest.routeExpectations, [{ route: '/catalog/item/', expected: 'html' }]);
  assert.deepEqual(manifest.mutations, [{
    path: 'src/content/products/item.json',
    operation: 'write',
    beforeHash: BEFORE,
    afterHash: AFTER,
  }]);
  assert.throws(
    () => createManifestFromCommittedTransaction(tx({ metadata: { userSummary: 'legacy' } })),
    (error) => error instanceof PublishServiceError && error.code === 'PUBLISH_TRANSACTION_BASE_HEAD_MISSING',
  );
  assert.throws(
    () => createManifestFromCommittedTransaction(tx({
      metadata: {
        baseHead: BASE,
        service: 'content-transaction',
        serviceVersion: 2,
        affectedRoutes: ['/catalog/item/']
      },
    })),
    (error) => error instanceof PublishServiceError
      && error.code === 'PUBLISH_TRANSACTION_ROUTE_EXPECTATIONS_MISSING',
  );
  assert.throws(
    () => createManifestFromCommittedTransaction(tx({
      metadata: { ...tx().metadata, serviceVersion: 1 },
    })),
    (error) => error instanceof PublishServiceError
      && error.code === 'PUBLISH_TRANSACTION_ROUTE_EXPECTATIONS_UNTRUSTED',
  );
});

test('preview is owner/recovery-bound and survives authenticated session rotation', async (t) => {
  const root = await temporaryRoot(t);
  const testPlanner = planner();
  const service = createPublishService(options(root, { planner: testPlanner }));
  const plan = await service.preview({ ...ACTOR, transactionIds: ['txn-001'] });
  assert.match(plan.planId, /^plan-/u);
  assert.equal(plan.commands, undefined);
  assert.deepEqual(plan.selectedTransactionIds, ['txn-001']);
  assert.equal(testPlanner.calls[0].manifests[0].kind, 'smu1-content-transaction');
  const rotated = await service.start({ ...ACTOR, sessionFingerprint: 'session-other', planId: plan.planId });
  assert.equal(rotated.planId, plan.planId);
  await assert.rejects(
    () => service.getStatus({ ...ACTOR, recoveryClientId: 'recovery-other-browser', sessionFingerprint: 'session-other', jobId: rotated.jobId }),
    (error) => error.code === 'PUBLISH_JOB_NOT_FOUND' && error.status === 404,
  );
  await service.close();
});

test('prepare, push, exact deployment persistence and idempotent terminal repeat', async (t) => {
  const root = await temporaryRoot(t);
  const count = { prepare: 0, push: 0 };
  const testPlanner = planner();
  const service = createPublishService(options(root, { planner: testPlanner, runner: runner(count) }));
  const plan = await service.preview({ ...ACTOR, transactionIds: ['txn-001'] });
  const queued = await service.start({ ...ACTOR, planId: plan.planId, idempotencyKey: 'publish-request-001' });
  assert.equal(queued.status, 'preparing');
  const done = await service.retry({ ...ACTOR, jobId: queued.jobId });
  assert.equal(done.status, 'deploy-success');
  assert.equal(done.success, true);
  assert.equal(done.testedSha, TESTED);
  assert.deepEqual(count, { prepare: 1, push: 1 });
  const repeated = await service.start({ ...ACTOR, planId: plan.planId, idempotencyKey: 'publish-request-001' });
  assert.equal(repeated.jobId, queued.jobId);
  assert.deepEqual(count, { prepare: 1, push: 1 });
  const report = await service.report({ ...ACTOR, jobId: queued.jobId });
  assert.equal(report.receipt.commands, undefined);
  assert.deepEqual(report.receipt.gates.results, { 'schema-transaction-validation': { ok: true } });
  await service.close();

  const reloaded = createPublishService(options(root, {
    planner: testPlanner,
    runner: {
      async prepare() { assert.fail('must not prepare'); },
      async push() { assert.fail('must not push'); },
    },
  }));
  const initialized = await reloaded.initialize();
  assert.equal(initialized.lastSuccessfulPreviewSHA, TESTED);
  const overview = await reloaded.overview(ACTOR);
  assert.equal(overview.transactions[0].published, true);
  assert.equal(overview.latestJob.jobId, queued.jobId);
  await reloaded.close();
});

test('post-push failure retries the same tested SHA without another commit or push', async (t) => {
  const root = await temporaryRoot(t);
  const count = { prepare: 0, push: 0 };
  let workflowCalls = 0;
  const retryCalls = [];
  const statusTracker = createPublishStatusTracker({
    workflowProvider: async ({ testedSha }) => ({
      sha: testedSha,
      status: 'completed',
      conclusion: workflowCalls++ === 0 ? 'failure' : 'success',
      id: 101,
    }),
    pagesProvider: async ({ testedSha }) => ({ sha: testedSha, status: 'completed', conclusion: 'success' }),
    smokeRunner: async ({ testedSha, affectedRoutes, routeExpectations }) => ({
      sha: testedSha,
      ok: true,
      checkedRoutes: affectedRoutes,
      routeExpectations,
      checks: routeExpectations.map(({ route, expected }) => ({
        route,
        expected,
        ok: true,
        status: expected === 'html' ? 200 : 404,
        outcome: expected === 'html' ? 'html' : 'intentional-not-found',
      })),
    }),
    now: () => new Date('2026-08-17T10:00:00Z'),
  });
  const service = createPublishService(options(root, {
    runner: runner(count),
    statusTracker,
    retryProvider: async (request) => {
      retryCalls.push(structuredClone(request));
      return { action: 'workflow-rerun-failed-jobs', testedSha: request.testedSha, requested: true, runId: 101 };
    },
  }));
  const plan = await service.preview({ ...ACTOR, transactionIds: ['txn-001'] });
  const queued = await service.start({ ...ACTOR, planId: plan.planId, idempotencyKey: 'publish-request-post-push-retry' });
  const failed = await service.retry({ ...ACTOR, jobId: queued.jobId });
  assert.equal(failed.status, 'failure');
  assert.equal(failed.testedSha, TESTED);
  assert.equal(failed.retryable, true);
  assert.deepEqual(count, { prepare: 1, push: 1 });

  const recovered = await service.retry({ ...ACTOR, jobId: queued.jobId });
  assert.equal(recovered.status, 'deploy-success');
  assert.equal(recovered.retryable, false);
  assert.equal(recovered.testedSha, TESTED);
  assert.equal(recovered.attempts.retry, 1);
  assert.deepEqual(count, { prepare: 1, push: 1 });
  assert.equal(retryCalls.length, 1);
  assert.equal(retryCalls[0].testedSha, TESTED);
  assert.equal(retryCalls[0].evidence.workflow.conclusion, 'failure');
  assert.equal(recovered.retryResult.action, 'workflow-rerun-failed-jobs');
  await service.close();
});

test('unknown push result survives restart and reuses the same receipt', async (t) => {
  const root = await temporaryRoot(t);
  const testPlanner = planner();
  let firstPrepare = 0;
  const first = createPublishService(options(root, {
    planner: testPlanner,
    runner: {
      async prepare(plan) {
        firstPrepare += 1;
        return runner().prepare(plan);
      },
      async push(receipt) {
        return { status: 'unknown-network-result', pushed: false, retryable: true, testedSha: receipt.testedSha };
      },
    },
  }));
  const plan = await first.preview({ ...ACTOR, transactionIds: ['txn-001'] });
  const queued = await first.start({ ...ACTOR, planId: plan.planId, idempotencyKey: 'publish-request-unknown' });
  const unknown = await first.retry({ ...ACTOR, jobId: queued.jobId });
  assert.equal(unknown.status, 'unknown-network-result');
  assert.equal(firstPrepare, 1);
  await first.close();

  let secondPrepare = 0;
  let pushedSha;
  const resumed = createPublishService(options(root, {
    planner: testPlanner,
    runner: {
      async prepare() {
        secondPrepare += 1;
        throw new Error('must not prepare');
      },
      async push(receipt) {
        pushedSha = receipt.testedSha;
        return {
          status: 'pushed',
          pushed: true,
          reconciled: true,
          testedSha: receipt.testedSha,
          refs: { candidate: receipt.testedSha, preview: receipt.testedSha, protected: MAIN },
        };
      },
    },
  }));
  await resumed.initialize();
  const done = await resumed.retry({ ...ACTOR, jobId: queued.jobId });
  assert.equal(done.status, 'deploy-success');
  assert.equal(secondPrepare, 0);
  assert.equal(pushedSha, TESTED);
  await resumed.close();
});

test('corrupt primary recovers a checksum-verified backup without overwriting it', async (t) => {
  const root = await temporaryRoot(t);
  const serviceOptions = options(root);
  const service = createPublishService(serviceOptions);
  await service.preview({ ...ACTOR, transactionIds: ['txn-001'] });
  await service.preview({ ...ACTOR, transactionIds: ['txn-001'] });
  const { statePath } = service.runtimePaths;
  await service.close();
  await fs.writeFile(statePath, '{"corrupt":true}\n', 'utf8');
  const recovered = createPublishService(serviceOptions);
  const status = await recovered.initialize();
  assert.equal(status.lastSuccessfulPreviewSHA, BASE);
  const repaired = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(repaired.kind, 'smu1-publish-state-envelope');
  assert.match(repaired.checksum, /^sha256:[a-f0-9]{64}$/u);
  await recovered.close();
});

test('production and custom ref ownership are fail-closed', async (t) => {
  const root = await temporaryRoot(t);
  let historyCalls = 0;
  const service = createPublishService(options(root, {
    transactionService: {
      async listHistory() { historyCalls += 1; return []; },
      async getTransaction() { assert.fail('must not read'); },
    },
  }));
  await assert.rejects(
    () => service.preview({ ...ACTOR, target: 'production', transactionIds: [] }),
    (error) => error.code === 'PUBLISH_PRODUCTION_FORBIDDEN' && error.status === 403,
  );
  assert.equal(historyCalls, 0);
  await service.close();
  assert.throws(
    () => createPublishService(options(root, { refs: { protected: 'not-main' } })),
    (error) => error.code === 'PUBLISH_REF_OWNERSHIP_INVALID',
  );
});

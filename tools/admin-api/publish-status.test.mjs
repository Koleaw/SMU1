import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLISH_STATUSES,
  PublishStatusError,
  createPublishStatus,
  createPublishStatusTracker,
  transitionPublishStatus,
} from './publish-status.mjs';
import { parseReleaseIdentityBytes, serializeReleaseIdentity } from '../release/artifact-identity.mjs';

const BASE_SHA = '1'.repeat(40);
const TESTED_SHA = '2'.repeat(40);
const OTHER_SHA = '3'.repeat(40);
const ROUTE_EXPECTATIONS = [
  { route: '/', expected: 'html' },
  { route: '/catalog/item/', expected: 'not-found' },
];

function artifactIdentity(testedCommitSha = TESTED_SHA) {
  return parseReleaseIdentityBytes(serializeReleaseIdentity({
    version: 1,
    kind: 'smu1-release-artifact-identity',
    testedCommitSha,
    artifactManifestSha256: 'a'.repeat(64),
    fileCount: 2,
    totalBytes: 30,
    largestFile: { path: 'index.html', bytes: 20, sha256: 'b'.repeat(64) },
  }));
}

function plan() {
  return {
    target: 'preview',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    baseHead: BASE_SHA,
    affectedRoutes: ['/catalog/item/', '/'],
    routeExpectations: ROUTE_EXPECTATIONS,
  };
}

function successfulSmoke(testedSha, affectedRoutes, routeExpectations, identity = artifactIdentity(testedSha)) {
  return {
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
    artifactIdentity: identity,
    byteIdentityVerified: true,
    identityVerified: true,
  };
}

function receipt() {
  return {
    status: 'committed',
    empty: false,
    testedSha: TESTED_SHA,
    gates: { ok: true, testedSha: TESTED_SHA, artifactIdentity: artifactIdentity() },
  };
}

function pushedResult(status = 'pushed') {
  return {
    status,
    pushed: status === 'pushed',
    testedSha: TESTED_SHA,
    refs: status === 'pushed' ? { candidate: TESTED_SHA, preview: TESTED_SHA, protected: BASE_SHA } : undefined,
  };
}

function reachPushed(tracker) {
  let record = tracker.begin(plan());
  record = tracker.localGates(record, TESTED_SHA);
  record = tracker.prepared(record, receipt());
  return tracker.pushed(record, pushedResult());
}

test('status succeeds only after workflow, Pages, and live smoke all prove the exact tested SHA', async () => {
  const calls = [];
  const tracker = createPublishStatusTracker({
    workflowProvider: async ({ testedSha }) => {
      calls.push(['workflow', testedSha]);
      return { sha: testedSha, status: 'completed', conclusion: 'success', url: 'workflow-url' };
    },
    pagesProvider: async ({ testedSha }) => {
      calls.push(['pages', testedSha]);
      return { sha: testedSha, status: 'completed', conclusion: 'success', url: 'pages-url' };
    },
    smokeRunner: async ({ testedSha, affectedRoutes, routeExpectations, artifactIdentity: identity }) => {
      calls.push(['smoke', testedSha, affectedRoutes, routeExpectations, identity]);
      return successfulSmoke(testedSha, affectedRoutes, routeExpectations, identity);
    },
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
  const result = await tracker.poll(reachPushed(tracker));
  assert.equal(result.status, PUBLISH_STATUSES.DEPLOY_SUCCESS);
  assert.equal(result.success, true);
  assert.equal(result.testedSha, TESTED_SHA);
  assert.deepEqual(calls, [
    ['workflow', TESTED_SHA],
    ['pages', TESTED_SHA],
    ['smoke', TESTED_SHA, ['/', '/catalog/item/'], ROUTE_EXPECTATIONS, artifactIdentity()],
  ]);
  assert.equal(result.evidence.workflow.sha, TESTED_SHA);
  assert.equal(result.evidence.pages.sha, TESTED_SHA);
  assert.equal(result.evidence.smoke.sha, TESTED_SHA);
  assert.equal(result.evidence.smoke.byteIdentityVerified, true);
});

test('status refuses deploy success when smoke claims a different artifact manifest', async () => {
  const tracker = createPublishStatusTracker({
    workflowProvider: async () => ({ sha: TESTED_SHA, status: 'completed', conclusion: 'success' }),
    pagesProvider: async () => ({ sha: TESTED_SHA, status: 'completed', conclusion: 'success' }),
    smokeRunner: async ({ testedSha, affectedRoutes, routeExpectations }) => successfulSmoke(
      testedSha,
      affectedRoutes,
      routeExpectations,
      parseReleaseIdentityBytes(serializeReleaseIdentity({
        version: 1,
        kind: 'smu1-release-artifact-identity',
        testedCommitSha: TESTED_SHA,
        artifactManifestSha256: 'c'.repeat(64),
        fileCount: 2,
        totalBytes: 30,
        largestFile: { path: 'index.html', bytes: 20, sha256: 'b'.repeat(64) },
      })),
    ),
  });
  const result = await tracker.poll(reachPushed(tracker));
  assert.equal(result.status, PUBLISH_STATUSES.FAILURE);
  assert.equal(result.success, false);
  assert.equal(result.evidence.smoke.byteIdentityVerified, true, 'provider claim alone is not sufficient');
});

test('a successful workflow for another SHA is treated as queued and cannot produce success', async () => {
  let pagesCalls = 0;
  let smokeCalls = 0;
  const tracker = createPublishStatusTracker({
    workflowProvider: async () => ({ sha: OTHER_SHA, status: 'completed', conclusion: 'success' }),
    pagesProvider: async () => {
      pagesCalls += 1;
      return { sha: TESTED_SHA, status: 'completed', conclusion: 'success' };
    },
    smokeRunner: async () => {
      smokeCalls += 1;
      return { sha: TESTED_SHA, ok: true };
    },
  });
  const result = await tracker.poll(reachPushed(tracker));
  assert.equal(result.status, PUBLISH_STATUSES.WORKFLOW_QUEUED);
  assert.equal(result.success, false);
  assert.equal(pagesCalls, 0);
  assert.equal(smokeCalls, 0);
});

test('Pages evidence for another SHA stays building and does not run live smoke', async () => {
  let smokeCalls = 0;
  const tracker = createPublishStatusTracker({
    workflowProvider: async () => ({ sha: TESTED_SHA, status: 'completed', conclusion: 'success' }),
    pagesProvider: async () => ({ sha: OTHER_SHA, status: 'completed', conclusion: 'success' }),
    smokeRunner: async () => {
      smokeCalls += 1;
      return { sha: TESTED_SHA, ok: true };
    },
  });
  const result = await tracker.poll(reachPushed(tracker));
  assert.equal(result.status, PUBLISH_STATUSES.BUILDING);
  assert.equal(result.success, false);
  assert.equal(smokeCalls, 0);
});

test('workflow, Pages, and smoke failures remain failures and never report success', async (t) => {
  await t.test('workflow failure', async () => {
    const tracker = createPublishStatusTracker({
      workflowProvider: async () => ({ sha: TESTED_SHA, status: 'completed', conclusion: 'failure' }),
      pagesProvider: async () => assert.fail('Pages must not be queried'),
      smokeRunner: async () => assert.fail('Smoke must not run'),
    });
    const result = await tracker.poll(reachPushed(tracker));
    assert.equal(result.status, PUBLISH_STATUSES.FAILURE);
    assert.equal(result.success, false);
  });

  await t.test('Pages failure', async () => {
    const tracker = createPublishStatusTracker({
      workflowProvider: async () => ({ sha: TESTED_SHA, status: 'completed', conclusion: 'success' }),
      pagesProvider: async () => ({ sha: TESTED_SHA, status: 'completed', conclusion: 'failure' }),
      smokeRunner: async () => assert.fail('Smoke must not run'),
    });
    const result = await tracker.poll(reachPushed(tracker));
    assert.equal(result.status, PUBLISH_STATUSES.FAILURE);
    assert.equal(result.success, false);
  });

  await t.test('live smoke failure', async () => {
    const tracker = createPublishStatusTracker({
      workflowProvider: async () => ({ sha: TESTED_SHA, status: 'completed', conclusion: 'success' }),
      pagesProvider: async () => ({ sha: TESTED_SHA, status: 'completed', conclusion: 'success' }),
      smokeRunner: async ({ testedSha, affectedRoutes, routeExpectations }) => {
        const smoke = successfulSmoke(testedSha, affectedRoutes, routeExpectations);
        delete smoke.checks[0].status;
        return smoke;
      },
    });
    const result = await tracker.poll(reachPushed(tracker));
    assert.equal(result.status, PUBLISH_STATUSES.FAILURE);
    assert.equal(result.success, false);
  });
});

test('a proven post-push failure can resume the same exact SHA, while pre-push failure cannot', async () => {
  const tracker = createPublishStatusTracker({
    workflowProvider: async () => ({ sha: TESTED_SHA, status: 'completed', conclusion: 'failure' }),
    pagesProvider: async () => assert.fail('Pages must not be queried'),
    smokeRunner: async () => assert.fail('Smoke must not run'),
  });
  const failed = await tracker.poll(reachPushed(tracker));
  const resumed = tracker.resumePushed(failed, { action: 'workflow-rerun-failed-jobs', testedSha: TESTED_SHA });
  assert.equal(resumed.status, PUBLISH_STATUSES.PUSHED);
  assert.equal(resumed.testedSha, TESTED_SHA);
  assert.equal(resumed.success, false);
  assert.equal(resumed.timeline.at(-1).recovery, 'post-push-retry');
  assert.equal(resumed.evidence.retry.action, 'workflow-rerun-failed-jobs');

  const prePush = transitionPublishStatus(tracker.begin(plan()), {
    status: PUBLISH_STATUSES.FAILURE,
    error: 'local gate failed',
  });
  assert.throws(() => tracker.resumePushed(prePush), (error) => (
    error instanceof PublishStatusError && error.code === 'PUBLISH_STATUS_NOT_RECOVERABLE'
  ));
});

test('unknown network result remains retryable and can reconcile to pushed for the same SHA', () => {
  const tracker = createPublishStatusTracker({
    workflowProvider: async () => null,
    pagesProvider: async () => null,
    smokeRunner: async () => null,
  });
  let record = tracker.begin(plan());
  record = tracker.localGates(record, TESTED_SHA);
  record = tracker.prepared(record, receipt());
  record = tracker.pushed(record, pushedResult('unknown-network-result'));
  assert.equal(record.status, PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT);
  assert.equal(record.success, false);
  record = tracker.pushed(record, pushedResult());
  assert.equal(record.status, PUBLISH_STATUSES.PUSHED);
  assert.equal(record.testedSha, TESTED_SHA);
});

test('status rejects SHA switching, incomplete success evidence, and production target', () => {
  const base = createPublishStatus({ baseHead: BASE_SHA, target: 'preview' });
  const gates = transitionPublishStatus(base, { status: PUBLISH_STATUSES.LOCAL_GATES, testedSha: TESTED_SHA });
  assert.throws(() => transitionPublishStatus(gates, {
    status: PUBLISH_STATUSES.COMMITTED,
    testedSha: OTHER_SHA,
  }), (error) => error instanceof PublishStatusError && error.code === 'PUBLISH_STATUS_SHA_MISMATCH');

  let record = transitionPublishStatus(gates, { status: PUBLISH_STATUSES.COMMITTED, testedSha: TESTED_SHA });
  record = transitionPublishStatus(record, { status: PUBLISH_STATUSES.PUSHED, testedSha: TESTED_SHA });
  assert.throws(() => transitionPublishStatus(record, {
    status: PUBLISH_STATUSES.DEPLOY_SUCCESS,
    testedSha: TESTED_SHA,
    evidence: {
      workflow: { sha: TESTED_SHA, status: 'completed', conclusion: 'success' },
      pages: { sha: TESTED_SHA, status: 'completed', conclusion: 'success' },
      smoke: { sha: OTHER_SHA, ok: true },
    },
  }), (error) => error.code === 'PUBLISH_SUCCESS_EVIDENCE_INVALID');
  assert.throws(() => createPublishStatus({ baseHead: BASE_SHA, target: 'production' }), {
    code: 'PUBLISH_PRODUCTION_FORBIDDEN',
  });

  const tracker = createPublishStatusTracker({
    workflowProvider: async () => null,
    pagesProvider: async () => null,
    smokeRunner: async () => null,
  });
  assert.throws(() => tracker.begin({ ...plan(), routeExpectations: [] }), {
    code: 'PUBLISH_STATUS_ROUTE_EXPECTATIONS_MISSING',
  });
  assert.throws(() => tracker.begin({
    ...plan(),
    routeExpectations: [
      { route: '/', expected: 'html' },
      { route: '/', expected: 'not-found' },
      { route: '/catalog/item/', expected: 'html' },
    ],
  }), { code: 'PUBLISH_STATUS_ROUTE_EXPECTATIONS_CONFLICT' });
});

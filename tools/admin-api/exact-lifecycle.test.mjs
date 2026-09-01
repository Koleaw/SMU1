import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decoratePublishOverviewWithExact,
  isCommittedSave,
  queuedExactReceipt,
  secondaryExactLifecycleContract
} from './exact-lifecycle.mjs';
import { publishableLocalTransactions } from '../../src/admin/publish/publish-panel.mjs';

function transaction(transactionId, committedAt, overrides = {}) {
  return { transactionId, committedAt, published: false, changedPaths: [], affectedRoutes: [], ...overrides };
}

function run(transactionId, status, overrides = {}) {
  return {
    runId: `exact-${transactionId.padEnd(32, 'a').slice(0, 32).replace(/[^a-f0-9]/gu, 'a')}`,
    transactionId,
    status,
    current: true,
    publishEligible: status === 'passed',
    ...overrides
  };
}

test('publish overview exposes queued/running/failed/stale/ready and only current passed latest is selectable', () => {
  for (const [internalStatus, expected] of [
    ['queued', 'queued'],
    ['running', 'running'],
    ['failed', 'failed'],
    ['stale', 'stale'],
    ['passed', 'ready']
  ]) {
    const exactRun = run('tx-latest', internalStatus, {
      current: internalStatus !== 'stale',
      publishEligible: internalStatus === 'passed'
    });
    const overview = decoratePublishOverviewWithExact(
      { transactions: [transaction('tx-latest', '2026-09-01T10:00:00.000Z')] },
      { current: exactRun.current ? exactRun : null, runs: [exactRun] }
    );
    assert.equal(overview.transactions[0].exactStatus, expected);
    assert.equal(overview.transactions[0].publishEligible, expected === 'ready');
    assert.equal(publishableLocalTransactions(overview.transactions).length, expected === 'ready' ? 1 : 0);
  }
  assert.deepEqual(secondaryExactLifecycleContract.visibleStatuses, ['queued', 'running', 'failed', 'stale', 'ready']);
});

test('an older passed run is stale and cannot be selected after a newer local commit', () => {
  const older = run('tx-older', 'passed');
  const newer = run('tx-newer', 'queued');
  const overview = decoratePublishOverviewWithExact({
    transactions: [
      transaction('tx-newer', '2026-09-01T10:01:00.000Z'),
      transaction('tx-older', '2026-09-01T10:00:00.000Z')
    ]
  }, { current: newer, runs: [newer, older] });
  assert.equal(overview.transactions[0].exactStatus, 'queued');
  assert.equal(overview.transactions[1].exactStatus, 'stale');
  assert.equal(overview.transactions[1].exactRetryEligible, false, 'an older revision cannot displace the latest exact run');
  assert.deepEqual(publishableLocalTransactions(overview.transactions), []);
});

test('authoritative newest-first transaction order wins when commits share a timestamp', () => {
  const committedAt = '2026-09-01T10:00:00.000Z';
  const newest = run('tx-newest', 'passed', { requestedAt: committedAt, requestSequence: 2 });
  const older = run('tx-older', 'passed', { requestedAt: committedAt, requestSequence: 1, current: false });
  const overview = decoratePublishOverviewWithExact({
    transactions: [
      transaction('tx-newest', committedAt),
      transaction('tx-older', committedAt)
    ]
  }, { current: newest, runs: [older, newest] });
  assert.equal(overview.transactions[0].exactStatus, 'ready');
  assert.equal(overview.transactions[0].publishEligible, true);
  assert.equal(overview.transactions[1].exactStatus, 'stale');
  assert.equal(overview.transactions[1].exactRetryEligible, false);
  assert.deepEqual(publishableLocalTransactions(overview.transactions).map((item) => item.transactionId), ['tx-newest']);
});

test('latest retry requestSequence wins when exact runs share a timestamp', () => {
  const requestedAt = '2026-09-01T10:00:00.000Z';
  const failed = run('tx-retry', 'failed', { requestedAt, requestSequence: 1, current: false, publishEligible: false });
  const retry = run('tx-retry', 'passed', { requestedAt, requestSequence: 2 });
  const overview = decoratePublishOverviewWithExact(
    { transactions: [transaction('tx-retry', requestedAt)] },
    { current: retry, runs: [failed, retry] }
  );
  assert.equal(overview.transactions[0].exactValidation.runId, retry.runId);
  assert.equal(overview.transactions[0].exactValidation.requestSequence, 2);
  assert.equal(overview.transactions[0].exactStatus, 'ready');
  assert.equal(overview.transactions[0].publishEligible, true);
});

test('only the latest failed or stale transaction offers an exact retry', () => {
  const failed = run('tx-failed', 'failed', { publishEligible: false });
  const failedOverview = decoratePublishOverviewWithExact(
    { transactions: [transaction('tx-failed', '2026-09-01T10:02:00.000Z')] },
    { current: failed, runs: [failed] }
  );
  assert.equal(failedOverview.transactions[0].exactRetryEligible, true);

  const missingOverview = decoratePublishOverviewWithExact(
    { transactions: [transaction('tx-missing', '2026-09-01T10:03:00.000Z')] },
    { current: null, runs: [] }
  );
  assert.equal(missingOverview.transactions[0].exactStatus, 'stale');
  assert.equal(missingOverview.transactions[0].exactRetryEligible, true);
});

test('post-commit scheduling receipt is immediate data and ignores no-op/blocked results', () => {
  assert.equal(isCommittedSave({ state: 'committed' }), true);
  assert.equal(isCommittedSave({ result: 'success' }), true);
  assert.equal(isCommittedSave({ state: 'no-op' }), false);
  assert.equal(isCommittedSave({ state: 'blocked' }), false);
  assert.deepEqual(queuedExactReceipt('tx-save'), {
    transactionId: 'tx-save',
    status: 'queued',
    current: true,
    publishEligible: false,
    message: 'Exact-проверка поставлена в очередь.'
  });
});

const ACTIVE_STATUSES = new Set(['queued', 'running']);

function latestRunByTransaction(runs = []) {
  const byTransaction = new Map();
  const ordered = [...(Array.isArray(runs) ? runs : [])].sort((left, right) => (
    (Date.parse(right?.requestedAt || 0) - Date.parse(left?.requestedAt || 0))
    || (Number(right?.requestSequence || 0) - Number(left?.requestSequence || 0))
  ));
  for (const run of ordered) {
    const transactionId = String(run?.transactionId || '');
    if (!transactionId || byTransaction.has(transactionId)) continue;
    byTransaction.set(transactionId, run);
  }
  return byTransaction;
}

export function queuedExactReceipt(transactionId) {
  return Object.freeze({
    transactionId: String(transactionId || ''),
    status: 'queued',
    current: true,
    publishEligible: false,
    message: 'Exact-проверка поставлена в очередь.'
  });
}

export function isCommittedSave(result) {
  return ['committed', 'success'].includes(String(result?.state || result?.result || ''));
}

export function decoratePublishOverviewWithExact(publishOverview = {}, exactOverview = {}) {
  const transactions = Array.isArray(publishOverview.transactions) ? publishOverview.transactions : [];
  // PublishService preserves transaction history in authoritative newest-first
  // order. Do not re-sort equal-millisecond commits and accidentally select an
  // older transaction on stable-sort edge cases.
  const latestTransaction = transactions[0] || null;
  const runsByTransaction = latestRunByTransaction(exactOverview.runs);
  const decorated = transactions.map((entry) => {
    const run = runsByTransaction.get(String(entry.transactionId || '')) || null;
    const isLatest = entry.transactionId === latestTransaction?.transactionId;
    const publishEligible = entry.published !== true
      && isLatest
      && run?.status === 'passed'
      && run?.current === true
      && run?.publishEligible === true;
    let exactStatus = 'stale';
    if (publishEligible) exactStatus = 'ready';
    else if (run?.current === true && ACTIVE_STATUSES.has(run.status)) exactStatus = run.status;
    else if (run?.current === true && run.status === 'failed') exactStatus = 'failed';
    else if (run?.status === 'stale' || run?.status === 'superseded' || run?.status === 'passed') exactStatus = 'stale';
    return {
      ...entry,
      exactStatus,
      exactRetryEligible: entry.published !== true && isLatest && ['failed', 'stale'].includes(exactStatus),
      publishEligible,
      exactValidation: run ? { ...run, publishEligible } : null
    };
  });
  const current = exactOverview.current || null;
  return {
    ...publishOverview,
    exactValidation: {
      current,
      runs: Array.isArray(exactOverview.runs) ? exactOverview.runs : []
    },
    transactions: decorated
  };
}

export const secondaryExactLifecycleContract = Object.freeze({
  visibleStatuses: Object.freeze(['queued', 'running', 'failed', 'stale', 'ready'])
});

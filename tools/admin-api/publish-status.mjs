const FULL_GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

export const PUBLISH_STATUSES = Object.freeze({
  PREPARING: 'preparing',
  LOCAL_GATES: 'local-gates',
  COMMITTED: 'committed',
  PUSHED: 'pushed',
  WORKFLOW_QUEUED: 'workflow-queued',
  BUILDING: 'building',
  DEPLOY_SUCCESS: 'deploy-success',
  FAILURE: 'failure',
  UNKNOWN_NETWORK_RESULT: 'unknown-network-result',
});

const STATUS_VALUES = new Set(Object.values(PUBLISH_STATUSES));
const TRANSITIONS = new Map([
  [PUBLISH_STATUSES.PREPARING, new Set([PUBLISH_STATUSES.LOCAL_GATES, PUBLISH_STATUSES.FAILURE])],
  [PUBLISH_STATUSES.LOCAL_GATES, new Set([PUBLISH_STATUSES.COMMITTED, PUBLISH_STATUSES.FAILURE])],
  [PUBLISH_STATUSES.COMMITTED, new Set([
    PUBLISH_STATUSES.PUSHED,
    PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT,
    PUBLISH_STATUSES.FAILURE,
  ])],
  [PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT, new Set([
    PUBLISH_STATUSES.PUSHED,
    PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT,
    PUBLISH_STATUSES.FAILURE,
  ])],
  [PUBLISH_STATUSES.PUSHED, new Set([
    PUBLISH_STATUSES.WORKFLOW_QUEUED,
    PUBLISH_STATUSES.BUILDING,
    PUBLISH_STATUSES.DEPLOY_SUCCESS,
    PUBLISH_STATUSES.FAILURE,
  ])],
  [PUBLISH_STATUSES.WORKFLOW_QUEUED, new Set([
    PUBLISH_STATUSES.WORKFLOW_QUEUED,
    PUBLISH_STATUSES.BUILDING,
    PUBLISH_STATUSES.DEPLOY_SUCCESS,
    PUBLISH_STATUSES.FAILURE,
  ])],
  [PUBLISH_STATUSES.BUILDING, new Set([
    PUBLISH_STATUSES.BUILDING,
    PUBLISH_STATUSES.DEPLOY_SUCCESS,
    PUBLISH_STATUSES.FAILURE,
  ])],
  [PUBLISH_STATUSES.DEPLOY_SUCCESS, new Set()],
  [PUBLISH_STATUSES.FAILURE, new Set()],
]);

export class PublishStatusError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'PublishStatusError';
    this.code = code;
    this.details = details;
  }
}

function assertSha(value, field = 'testedSha') {
  if (!FULL_GIT_SHA_PATTERN.test(String(value ?? ''))) {
    throw new PublishStatusError('PUBLISH_STATUS_SHA_INVALID', `${field} must be a full Git SHA.`, { field, value });
  }
  return value;
}

function isoTime(now) {
  const value = typeof now === 'function' ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new PublishStatusError('PUBLISH_STATUS_TIME_INVALID', 'Status time is invalid.');
  }
  return date.toISOString();
}

function freezeRecord(record) {
  Object.freeze(record.affectedRoutes);
  for (const expectation of record.routeExpectations) Object.freeze(expectation);
  Object.freeze(record.routeExpectations);
  Object.freeze(record.evidence);
  for (const event of record.timeline) Object.freeze(event);
  Object.freeze(record.timeline);
  return Object.freeze(record);
}

function normalizeRoutes(routes) {
  if (!Array.isArray(routes) || routes.length > 500) {
    throw new PublishStatusError('PUBLISH_STATUS_ROUTES_INVALID', 'affectedRoutes must be an array.');
  }
  const normalized = [...new Set(routes.map(String))].sort();
  if (normalized.some((route) => !route.startsWith('/')
    || route.startsWith('//')
    || /[\\?#\u0000-\u001f\u007f]/u.test(route)
    || /%(?:2e|2f|5c)/iu.test(route)
    || route.split('/').some((segment) => segment === '.' || segment === '..'))) {
    throw new PublishStatusError('PUBLISH_STATUS_ROUTE_INVALID', 'affectedRoutes contains an unsafe route.');
  }
  return normalized;
}

function normalizeRouteExpectations(affectedRoutes, routeExpectations) {
  if (!Array.isArray(routeExpectations)) {
    throw new PublishStatusError(
      'PUBLISH_STATUS_ROUTE_EXPECTATIONS_INVALID',
      'routeExpectations must be an array.',
    );
  }
  if (affectedRoutes.length === 0 && routeExpectations.length === 0) return [];
  if (affectedRoutes.length === 0 || routeExpectations.length === 0) {
    throw new PublishStatusError(
      'PUBLISH_STATUS_ROUTE_EXPECTATIONS_MISSING',
      'Every affected route requires a typed smoke expectation.',
    );
  }
  const byRoute = new Map();
  for (const item of routeExpectations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'expected,route'
      || !affectedRoutes.includes(item.route)
      || !['html', 'not-found'].includes(item.expected)) {
      throw new PublishStatusError(
        'PUBLISH_STATUS_ROUTE_EXPECTATIONS_INVALID',
        'routeExpectations contains an invalid typed expectation.',
      );
    }
    const previous = byRoute.get(item.route);
    if (previous && previous !== item.expected) {
      throw new PublishStatusError(
        'PUBLISH_STATUS_ROUTE_EXPECTATIONS_CONFLICT',
        'The same route has contradictory smoke expectations.',
        { route: item.route, previous, expected: item.expected },
      );
    }
    byRoute.set(item.route, item.expected);
  }
  const routes = [...byRoute.keys()].sort();
  if (routes.length !== affectedRoutes.length
    || affectedRoutes.some((route, index) => route !== routes[index])) {
    throw new PublishStatusError(
      'PUBLISH_STATUS_ROUTE_EXPECTATIONS_MISMATCH',
      'affectedRoutes and routeExpectations must describe the same route set.',
    );
  }
  return routes.map((route) => ({ route, expected: byRoute.get(route) }));
}

function smokeProvesRouteExpectations(smoke, affectedRoutes, routeExpectations) {
  if (!smoke || !Array.isArray(smoke.checkedRoutes)
    || !Array.isArray(smoke.routeExpectations) || !Array.isArray(smoke.checks)
    || smoke.checkedRoutes.length !== affectedRoutes.length
    || smoke.routeExpectations.length !== routeExpectations.length
    || smoke.checks.length !== affectedRoutes.length) return false;
  let normalizedChecked;
  let normalizedExpectations;
  try {
    normalizedChecked = normalizeRoutes(smoke.checkedRoutes);
    normalizedExpectations = normalizeRouteExpectations(normalizedChecked, smoke.routeExpectations);
  } catch {
    return false;
  }
  if (normalizedChecked.length !== affectedRoutes.length
    || normalizedChecked.some((route, index) => route !== affectedRoutes[index])
    || normalizedExpectations.some((item, index) => (
      item.route !== routeExpectations[index]?.route || item.expected !== routeExpectations[index]?.expected
    ))) return false;
  const checks = new Map(smoke.checks.map((item) => [item?.route, item]));
  if (checks.size !== affectedRoutes.length) return false;
  return routeExpectations.every(({ route, expected }) => {
    const check = checks.get(route);
    return check?.ok === true
      && check.expected === expected
      && (expected === 'html'
        ? check.outcome === 'html' && Number(check.status) >= 200 && Number(check.status) < 300
        : check.outcome === 'intentional-not-found' && Number(check.status) === 404);
  });
}

export function createPublishStatus({
  planFingerprint,
  baseHead,
  affectedRoutes = [],
  routeExpectations = [],
  target = 'preview',
  now,
} = {}) {
  if (target === 'production') {
    throw new PublishStatusError('PUBLISH_PRODUCTION_FORBIDDEN', 'Production publishing is not implemented.');
  }
  if (target !== 'preview') {
    throw new PublishStatusError('PUBLISH_TARGET_INVALID', 'Only the preview target is supported.', { target });
  }
  assertSha(baseHead, 'baseHead');
  const at = isoTime(now);
  const normalizedRoutes = normalizeRoutes(affectedRoutes);
  const normalizedExpectations = normalizeRouteExpectations(normalizedRoutes, routeExpectations);
  return freezeRecord({
    version: 1,
    kind: 'smu1-publish-status',
    target,
    planFingerprint: String(planFingerprint ?? ''),
    baseHead,
    testedSha: null,
    status: PUBLISH_STATUSES.PREPARING,
    success: false,
    affectedRoutes: normalizedRoutes,
    routeExpectations: normalizedExpectations,
    evidence: {},
    timeline: [{ status: PUBLISH_STATUSES.PREPARING, at, testedSha: null }],
    updatedAt: at,
  });
}

export function transitionPublishStatus(record, {
  status,
  testedSha = record?.testedSha,
  evidence = {},
  error = undefined,
} = {}, { now } = {}) {
  if (!record || record.kind !== 'smu1-publish-status' || !STATUS_VALUES.has(record.status)) {
    throw new PublishStatusError('PUBLISH_STATUS_INVALID', 'A valid publish status record is required.');
  }
  const recordRoutes = normalizeRoutes(record.affectedRoutes);
  const recordExpectations = normalizeRouteExpectations(recordRoutes, record.routeExpectations);
  if (recordRoutes.length !== record.affectedRoutes.length
    || recordRoutes.some((route, index) => route !== record.affectedRoutes[index])
    || recordExpectations.length !== record.routeExpectations.length
    || recordExpectations.some((item, index) => (
      item.route !== record.routeExpectations[index]?.route
      || item.expected !== record.routeExpectations[index]?.expected
    ))) {
    throw new PublishStatusError(
      'PUBLISH_STATUS_ROUTE_EXPECTATIONS_INVALID',
      'Publish status route expectations are not canonical.',
    );
  }
  if (!STATUS_VALUES.has(status)) {
    throw new PublishStatusError('PUBLISH_STATUS_VALUE_INVALID', 'Unknown publish status.', { status });
  }
  if (!TRANSITIONS.get(record.status)?.has(status)) {
    throw new PublishStatusError('PUBLISH_STATUS_TRANSITION_INVALID', `Cannot transition ${record.status} to ${status}.`, {
      from: record.status,
      to: status,
    });
  }

  let exactSha = testedSha;
  const preCommitFailure = status === PUBLISH_STATUSES.FAILURE && !record.testedSha && !testedSha;
  if (status !== PUBLISH_STATUSES.PREPARING && !preCommitFailure) {
    exactSha = assertSha(exactSha);
  }
  if (record.testedSha && exactSha !== record.testedSha) {
    throw new PublishStatusError('PUBLISH_STATUS_SHA_MISMATCH', 'A publish status cannot switch to a different commit SHA.', {
      expected: record.testedSha,
      actual: exactSha,
    });
  }

  if (status === PUBLISH_STATUSES.DEPLOY_SUCCESS) {
    const workflowSha = evidence.workflow?.sha ?? evidence.workflow?.headSha;
    const pagesSha = evidence.pages?.sha ?? evidence.pages?.commitSha;
    const smokeSha = evidence.smoke?.sha ?? evidence.smoke?.testedSha;
    if (workflowSha !== exactSha
      || evidence.workflow?.status !== 'completed'
      || evidence.workflow?.conclusion !== 'success'
      || pagesSha !== exactSha
      || evidence.pages?.status !== 'completed'
      || evidence.pages?.conclusion !== 'success'
      || smokeSha !== exactSha
      || evidence.smoke?.ok !== true
      || !smokeProvesRouteExpectations(evidence.smoke, record.affectedRoutes, record.routeExpectations)) {
      throw new PublishStatusError(
        'PUBLISH_SUCCESS_EVIDENCE_INVALID',
        'Deploy success requires successful workflow, Pages deployment, and live smoke for the exact tested SHA.',
        { testedSha: exactSha, evidence },
      );
    }
  }

  const at = isoTime(now);
  const nextEvidence = { ...record.evidence, ...evidence };
  const event = {
    status,
    at,
    testedSha: exactSha,
    ...(error === undefined ? {} : { error: String(error) }),
  };
  return freezeRecord({
    ...record,
    testedSha: exactSha,
    status,
    success: status === PUBLISH_STATUSES.DEPLOY_SUCCESS,
    evidence: nextEvidence,
    timeline: [...record.timeline, event],
    updatedAt: at,
    ...(error === undefined ? {} : { error: String(error) }),
  });
}

function providerSha(value) {
  return value?.sha ?? value?.headSha ?? value?.commitSha ?? null;
}

function isCompletedSuccess(value) {
  return value?.status === 'completed' && value?.conclusion === 'success';
}

export function createPublishStatusTracker({ workflowProvider, pagesProvider, smokeRunner, now } = {}) {
  if (typeof workflowProvider !== 'function' || typeof pagesProvider !== 'function' || typeof smokeRunner !== 'function') {
    throw new PublishStatusError(
      'PUBLISH_STATUS_PROVIDERS_REQUIRED',
      'workflowProvider, pagesProvider, and smokeRunner must be injected functions.',
    );
  }

  const transition = (record, event) => transitionPublishStatus(record, event, { now });

  function begin(plan) {
    if (!Array.isArray(plan?.affectedRoutes) || plan.affectedRoutes.length === 0
      || !Array.isArray(plan?.routeExpectations) || plan.routeExpectations.length === 0) {
      throw new PublishStatusError(
        'PUBLISH_STATUS_ROUTE_EXPECTATIONS_MISSING',
        'Publish plan must carry typed smoke expectations for every affected route.',
      );
    }
    return createPublishStatus({
      planFingerprint: plan?.fingerprint ?? plan?.planFingerprint,
      baseHead: plan?.baseHead,
      affectedRoutes: plan?.affectedRoutes ?? [],
      routeExpectations: plan?.routeExpectations ?? [],
      target: plan?.target ?? 'preview',
      now,
    });
  }

  function localGates(record, testedSha) {
    return transition(record, { status: PUBLISH_STATUSES.LOCAL_GATES, testedSha });
  }

  function prepared(record, receipt) {
    if (receipt?.empty === true) return record;
    if (receipt?.status !== PUBLISH_STATUSES.COMMITTED
      || receipt?.gates?.ok !== true
      || receipt?.gates?.testedSha !== receipt?.testedSha) {
      throw new PublishStatusError(
        'PUBLISH_STATUS_RECEIPT_INVALID',
        'Committed status requires passing local gates for the exact receipt SHA.',
        { receipt },
      );
    }
    return transition(record, {
      status: PUBLISH_STATUSES.COMMITTED,
      testedSha: receipt?.testedSha,
      evidence: { localGates: receipt?.gates },
    });
  }

  function pushed(record, pushResult) {
    if (pushResult?.testedSha !== record.testedSha) {
      throw new PublishStatusError('PUBLISH_STATUS_SHA_MISMATCH', 'Push result is for a different SHA.', {
        expected: record.testedSha,
        actual: pushResult?.testedSha,
      });
    }
    if (pushResult.status === PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT) {
      return transition(record, {
        status: PUBLISH_STATUSES.UNKNOWN_NETWORK_RESULT,
        testedSha: pushResult.testedSha,
        evidence: { push: pushResult },
      });
    }
    const refsMatch = pushResult?.refs?.candidate === record.testedSha
      && pushResult?.refs?.preview === record.testedSha;
    if (pushResult.status !== PUBLISH_STATUSES.PUSHED || pushResult.pushed !== true || !refsMatch) {
      return transition(record, {
        status: PUBLISH_STATUSES.FAILURE,
        testedSha: pushResult.testedSha,
        evidence: { push: pushResult },
        error: 'Atomic push did not succeed.',
      });
    }
    return transition(record, {
      status: PUBLISH_STATUSES.PUSHED,
      testedSha: pushResult.testedSha,
      evidence: { push: pushResult },
    });
  }

  function resumePushed(record, retry = {}) {
    if (record?.status !== PUBLISH_STATUSES.FAILURE) {
      throw new PublishStatusError('PUBLISH_STATUS_NOT_RECOVERABLE', 'Only a failed post-push publish can be resumed.', {
        status: record?.status,
      });
    }
    const testedSha = String(record.testedSha ?? '');
    const push = record.evidence?.push;
    const refsMatch = push?.refs?.candidate === testedSha && push?.refs?.preview === testedSha;
    if (!FULL_GIT_SHA_PATTERN.test(testedSha)
      || push?.status !== PUBLISH_STATUSES.PUSHED
      || push?.pushed !== true
      || !refsMatch) {
      throw new PublishStatusError(
        'PUBLISH_STATUS_NOT_RECOVERABLE',
        'A failed publish can resume only after the exact atomic push was proven.',
        { testedSha, push },
      );
    }
    const at = isoTime(now);
    const { error: _previousError, ...withoutError } = record;
    return freezeRecord({
      ...withoutError,
      status: PUBLISH_STATUSES.PUSHED,
      success: false,
      evidence: { ...record.evidence, retry },
      timeline: [...record.timeline, {
        status: PUBLISH_STATUSES.PUSHED,
        at,
        testedSha,
        recovery: 'post-push-retry',
      }],
      updatedAt: at,
    });
  }

  async function poll(record) {
    if (![PUBLISH_STATUSES.PUSHED, PUBLISH_STATUSES.WORKFLOW_QUEUED, PUBLISH_STATUSES.BUILDING].includes(record?.status)) {
      throw new PublishStatusError('PUBLISH_STATUS_NOT_POLLABLE', 'Only a pushed or building publish can be polled.', {
        status: record?.status,
      });
    }
    const testedSha = assertSha(record.testedSha);
    const workflow = await workflowProvider({ testedSha });
    if (!workflow || providerSha(workflow) !== testedSha) {
      return transition(record, {
        status: record.status === PUBLISH_STATUSES.PUSHED
          ? PUBLISH_STATUSES.WORKFLOW_QUEUED
          : record.status,
        testedSha,
        evidence: { workflowObservation: workflow ?? null },
      });
    }
    if (workflow.status === 'completed' && workflow.conclusion !== 'success') {
      return transition(record, {
        status: PUBLISH_STATUSES.FAILURE,
        testedSha,
        evidence: { workflow },
        error: `Workflow failed: ${workflow.conclusion ?? 'unknown conclusion'}`,
      });
    }
    if (!isCompletedSuccess(workflow)) {
      const status = workflow.status === 'queued' && record.status !== PUBLISH_STATUSES.BUILDING
        ? PUBLISH_STATUSES.WORKFLOW_QUEUED
        : PUBLISH_STATUSES.BUILDING;
      return transition(record, { status, testedSha, evidence: { workflow } });
    }

    const pages = await pagesProvider({ testedSha, workflow });
    if (!pages || providerSha(pages) !== testedSha) {
      return transition(record, {
        status: PUBLISH_STATUSES.BUILDING,
        testedSha,
        evidence: { workflow, pagesObservation: pages ?? null },
      });
    }
    if (pages.status === 'completed' && pages.conclusion !== 'success') {
      return transition(record, {
        status: PUBLISH_STATUSES.FAILURE,
        testedSha,
        evidence: { workflow, pages },
        error: `Pages deployment failed: ${pages.conclusion ?? 'unknown conclusion'}`,
      });
    }
    if (!isCompletedSuccess(pages)) {
      return transition(record, { status: PUBLISH_STATUSES.BUILDING, testedSha, evidence: { workflow, pages } });
    }

    const smokeRoutes = [...record.affectedRoutes];
    const routeExpectations = record.routeExpectations.map((item) => ({ ...item }));
    const smoke = await smokeRunner({
      testedSha,
      affectedRoutes: smokeRoutes,
      routeExpectations,
      pages,
    });
    if (!smoke
      || providerSha(smoke) !== testedSha
      || smoke.ok !== true
      || !smokeProvesRouteExpectations(smoke, smokeRoutes, routeExpectations)) {
      return transition(record, {
        status: PUBLISH_STATUSES.FAILURE,
        testedSha,
        evidence: { workflow, pages, smoke: smoke ?? null },
        error: 'Live route smoke failed or did not prove the exact SHA.',
      });
    }
    return transition(record, {
      status: PUBLISH_STATUSES.DEPLOY_SUCCESS,
      testedSha,
      evidence: { workflow, pages, smoke },
    });
  }

  return Object.freeze({ begin, localGates, prepared, pushed, resumePushed, poll });
}

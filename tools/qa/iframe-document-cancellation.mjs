const finite = Number.isFinite;
const successfulDocument = (request, origin) => request?.resourceType === 'Document'
  && request.method === 'GET' && request.url?.origin === origin
  && !/(?:^|\/)api(?:\/|$)/u.test(request.url?.pathname || '')
  && request.status >= 200 && request.status < 300
  && request.finished === true && request.failed === false
  && finite(request.requestTimestamp) && finite(request.finishedTimestamp)
  && finite(request.startedSequence) && finite(request.finishedSequence);
const sameAddress = (left, right) => left?.origin === right?.origin
  && left?.pathname === right?.pathname;

// No timing-only fallback: all identities and both successful documents must
// be recorded by CDP. An old report without loader/frame telemetry stays failed.
export function classifyIframeDocumentCancellation(request, { requests = [], frameNavigations = [], origin } = {}) {
  if (!origin || request?.method !== 'GET' || !['Image', 'Script'].includes(request.resourceType)
    || request.failed !== true || request.canceled !== true || request.finished !== false
    || request.failure !== 'net::ERR_ABORTED' || request.blockedReason || request.corsError
    || request.releaseEndpoint || request.releaseMutation
    || request.url?.origin !== origin || /(?:^|\/)api(?:\/|$)/u.test(request.url?.pathname || '')
    || (request.status !== null && !(request.status >= 200 && request.status < 300))
    || !request.frameId || !request.loaderId
    || !finite(request.requestTimestamp) || !finite(request.failureTimestamp)
    || !finite(request.startedSequence) || !finite(request.failureSequence)) return null;

  const previousDocument = requests.find((document) => successfulDocument(document, origin)
    && document.frameId === request.frameId && document.loaderId === request.loaderId
    && document.requestTimestamp <= request.requestTimestamp
    && document.finishedTimestamp <= request.requestTimestamp
    && document.finishedSequence < request.startedSequence);
  const previousCommit = previousDocument && frameNavigations.find((frame) => frame.frameId === request.frameId
    && frame.loaderId === request.loaderId && Boolean(frame.parentId)
    && frame.sequence > previousDocument.startedSequence && frame.sequence < previousDocument.finishedSequence
    && frame.sequence < request.startedSequence && sameAddress(frame.url, previousDocument.url));
  if (!previousCommit || frameNavigations.some((frame) => frame.frameId === request.frameId
    && frame.sequence > previousCommit.sequence && frame.sequence < request.startedSequence)) return null;

  for (const replacement of requests) {
    if (!successfulDocument(replacement, origin) || replacement.frameId !== request.frameId
      || !replacement.loaderId || replacement.loaderId === request.loaderId
      || !(request.requestTimestamp <= replacement.requestTimestamp
        && replacement.requestTimestamp <= request.failureTimestamp
        && request.failureTimestamp <= replacement.finishedTimestamp)
      || !(request.startedSequence < replacement.startedSequence
        && replacement.startedSequence < request.failureSequence
        && request.failureSequence < replacement.finishedSequence)) continue;
    const replacementCommit = frameNavigations.find((frame) => frame.frameId === request.frameId
      && frame.loaderId === replacement.loaderId && frame.parentId === previousCommit.parentId
      && frame.sequence > replacement.startedSequence && frame.sequence < replacement.finishedSequence
      && sameAddress(frame.url, replacement.url));
    if (!replacementCommit) continue;
    return {
      kind: 'iframe-document-replaced', frameId: request.frameId, parentId: previousCommit.parentId,
      previousLoaderId: request.loaderId, replacementLoaderId: replacement.loaderId,
      previousDocumentRequestId: previousDocument.requestId, replacementDocumentRequestId: replacement.requestId,
      previousCommitSequence: previousCommit.sequence, replacementCommitSequence: replacementCommit.sequence,
      resourceStartedSequence: request.startedSequence, resourceFailureSequence: request.failureSequence,
      replacementStartedSequence: replacement.startedSequence, replacementFinishedSequence: replacement.finishedSequence,
      resourceRequestTimestamp: request.requestTimestamp, resourceFailureTimestamp: request.failureTimestamp,
      replacementRequestTimestamp: replacement.requestTimestamp, replacementFinishedTimestamp: replacement.finishedTimestamp
    };
  }
  return null;
}

// A scenario can finish before the replacement Document. Remove only the exact
// generated counter; an initial failure may disappear only with new CDP proof.
// A later allowance/interception cannot retroactively erase an actual failure.
export function reconcileScenarioNetworkIssues(issues, initialFailures, lateFailures, telemetry) {
  const unresolved = new Set(lateFailures);
  for (const request of initialFailures) {
    if (!unresolved.has(request) && !classifyIframeDocumentCancellation(request, telemetry)) unresolved.add(request);
  }
  const reconciled = [...issues];
  if (initialFailures.length) {
    const index = reconciled.lastIndexOf(`network-errors:${initialFailures.length}`);
    if (index !== -1) reconciled.splice(index, 1);
  }
  if (unresolved.size) reconciled.push(`network-errors:${unresolved.size}`);
  return reconciled;
}
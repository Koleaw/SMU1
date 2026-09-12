import assert from 'node:assert/strict';
import test from 'node:test';
import { createTelemetry } from './visual-editor-acceptance.mjs';
import { classifyIframeDocumentCancellation, reconcileScenarioNetworkIssues } from './iframe-document-cancellation.mjs';

// The request/abort offsets reproduce the old two-tab diagnostic. New CDP
// identities and commits are explicit fixture evidence, not inferred from it.
function replacementFixture({ resourceType = 'Script', finishReplacement = true } = {}) {
  const listeners = new Map();
  const browser = { on(name, listener) { listeners.set(name, listener); } };
  const emit = (name, event) => listeners.get(name)?.(event);
  const origin = 'http://127.0.0.1:64037';
  const telemetry = createTelemetry(browser, origin);
  telemetry.setScenario('two-tab-conflict');
  const request = (requestId, loaderId, type, timestamp, pathname) => emit('Network.requestWillBeSent', {
    requestId, loaderId, frameId: 'canvas', type, timestamp,
    request: { method: 'GET', url: origin + pathname }
  });
  const response = (requestId, timestamp, status = 200) => emit('Network.responseReceived', {
    requestId, timestamp, response: { status, mimeType: 'text/html' }
  });
  const finish = (requestId, timestamp) => emit('Network.loadingFinished', { requestId, timestamp });
  const commit = (loaderId) => emit('Page.frameNavigated', {
    frame: { id: 'canvas', loaderId, parentId: 'shell', url: origin + '/product/?__smu1_editor=1&editorSession=secret-value' }
  });
  request('old-document', 'old', 'Document', 9.851, '/product/?__smu1_editor=1&editorSession=secret-value');
  response('old-document', 9.871);
  commit('old');
  finish('old-document', 9.927);
  request('old-resource', 'old', resourceType, 10.146, resourceType === 'Image' ? '/uploads/product.png' : '/@id/__x00__astro:prefetch');
  if (resourceType === 'Image') response('old-resource', 10.157);
  request('new-document', 'new', 'Document', 10.174, '/product/?__smu1_editor=1&editorSession=other-secret');
  response('new-document', 10.195);
  commit('new');
  emit('Network.loadingFailed', { requestId: 'old-resource', timestamp: 10.209, errorText: 'net::ERR_ABORTED', canceled: true });
  const complete = () => finish('new-document', 10.251);
  if (finishReplacement) complete();
  return {
    telemetry, emit, complete,
    resource: telemetry.requests.find((row) => row.requestId === 'old-resource'),
    oldDocument: telemetry.requests.find((row) => row.requestId === 'old-document'),
    newDocument: telemetry.requests.find((row) => row.requestId === 'new-document')
  };
}

for (const resourceType of ['Image', 'Script']) {
  test(`${resourceType} cancellation requires a completed replacement document with exact iframe and loaders`, () => {
    const fixture = replacementFixture({ resourceType });
    const proof = classifyIframeDocumentCancellation(fixture.resource, fixture.telemetry);
    assert.equal(proof?.kind, 'iframe-document-replaced');
    assert.equal(proof.frameId, 'canvas');
    assert.equal(proof.parentId, 'shell');
    assert.equal(proof.previousLoaderId, 'old');
    assert.equal(proof.replacementLoaderId, 'new');
    assert.equal(proof.previousDocumentRequestId, 'old-document');
    assert.equal(proof.replacementDocumentRequestId, 'new-document');
    assert.ok(proof.resourceStartedSequence < proof.replacementStartedSequence);
    assert.ok(proof.replacementStartedSequence < proof.resourceFailureSequence);
    assert.ok(proof.resourceFailureSequence < proof.replacementFinishedSequence);
    assert.equal(proof.resourceFailureTimestamp, 10.209);
    assert.equal(proof.replacementFinishedTimestamp, 10.251);
  });
}

test('telemetry preserves request, response and abort evidence separately and redacts query values', () => {
  const { resource, telemetry } = replacementFixture({ resourceType: 'Image' });
  assert.equal(resource.status, 200);
  assert.equal(resource.requestTimestamp, 10.146);
  assert.equal(resource.responseTimestamp, 10.157);
  assert.equal(resource.failureTimestamp, 10.209);
  assert.equal(resource.canceled, true);
  assert.equal(resource.finished, false);
  assert.equal(telemetry.frameNavigations.length, 2);
  assert.deepEqual(telemetry.frameNavigations[0].url.queryKeys, ['__smu1_editor', 'editorSession']);
  assert.ok(!JSON.stringify(telemetry).includes('secret'), 'session values must never enter reports');
});

test('a replacement that has not finished cannot excuse an aborted resource, even after its frame commit', () => {
  const fixture = replacementFixture({ finishReplacement: false });
  assert.equal(classifyIframeDocumentCancellation(fixture.resource, fixture.telemetry), null);
  fixture.complete();
  assert.ok(classifyIframeDocumentCancellation(fixture.resource, fixture.telemetry));
});

test('real network, HTTP, API, blocked and CORS failures are never classified as document replacement', () => {
  const negatives = [
    ['POST', ({ resource }) => { resource.method = 'POST'; }],
    ['Fetch', ({ resource }) => { resource.resourceType = 'Fetch'; }],
    ['XHR', ({ resource }) => { resource.resourceType = 'XHR'; }],
    ['Document', ({ resource }) => { resource.resourceType = 'Document'; }],
    ['connection reset', ({ resource }) => { resource.failure = 'net::ERR_CONNECTION_RESET'; }],
    ['not cancelled', ({ resource }) => { resource.canceled = false; }],
    ['not failed', ({ resource }) => { resource.failed = false; }],
    ['already finished', ({ resource }) => { resource.finished = true; }],
    ['HTTP 404', ({ resource }) => { resource.status = 404; }],
    ['HTTP 500', ({ resource }) => { resource.status = 500; }],
    ['blocked', ({ resource }) => { resource.blockedReason = 'inspector'; }],
    ['CORS', ({ resource }) => { resource.corsError = true; }],
    ['API', ({ resource }) => { resource.url.pathname = '/api/admin/media'; }],
    ['base-path API', ({ resource }) => { resource.url.pathname = '/SMU1/api/admin/media'; }],
    ['foreign origin', ({ resource }) => { resource.url.origin = 'https://example.org'; }],
    ['release endpoint', ({ resource }) => { resource.releaseEndpoint = true; }],
    ['release mutation', ({ resource }) => { resource.releaseMutation = true; }]
  ];
  for (const [reason, mutate] of negatives) {
    const fixture = replacementFixture();
    mutate(fixture);
    assert.equal(classifyIframeDocumentCancellation(fixture.resource, fixture.telemetry), null, reason);
  }
});

test('identities, successful documents, matching commits and event order are all mandatory evidence', () => {
  const negatives = [
    ['missing frame', ({ resource }) => { delete resource.frameId; }],
    ['missing loader', ({ resource }) => { delete resource.loaderId; }],
    ['missing CDP timestamp', ({ resource }) => { resource.failureTimestamp = null; }],
    ['non-finite CDP timestamp', ({ resource }) => { resource.failureTimestamp = NaN; }],
    ['missing sequence', ({ resource }) => { delete resource.failureSequence; }],
    ['abort before navigation', ({ resource }) => { resource.failureTimestamp = 10.170; }],
    ['abort after successful replacement', ({ resource }) => { resource.failureTimestamp = 10.260; }],
    ['resource began after navigation', ({ resource }) => { resource.requestTimestamp = 10.180; }],
    ['abort sequence before navigation', ({ resource, newDocument }) => { resource.failureSequence = newDocument.startedSequence - 1; }],
    ['abort sequence after finish', ({ resource, newDocument }) => { resource.failureSequence = newDocument.finishedSequence + 1; }],
    ['different replacement frame', ({ newDocument }) => { newDocument.frameId = 'other-canvas'; }],
    ['same loader', ({ newDocument }) => { newDocument.loaderId = 'old'; }],
    ['old document missing', ({ telemetry }) => { telemetry.requests.splice(0, 1); }],
    ['old document failed', ({ oldDocument }) => { oldDocument.failed = true; }],
    ['old document unfinished', ({ oldDocument }) => { oldDocument.finished = false; }],
    ['old document finished after resource', ({ oldDocument }) => { oldDocument.finishedTimestamp = 10.2; }],
    ['new document HTTP error', ({ newDocument }) => { newDocument.status = 500; }],
    ['new document failed', ({ newDocument }) => { newDocument.failed = true; }],
    ['new document is API', ({ newDocument }) => { newDocument.url.pathname = '/api/admin/media'; }],
    ['new document foreign origin', ({ newDocument }) => { newDocument.url.origin = 'https://example.org'; }],
    ['old commit missing', ({ telemetry }) => { telemetry.frameNavigations.shift(); }],
    ['new commit missing', ({ telemetry }) => { telemetry.frameNavigations.pop(); }],
    ['top-level document', ({ telemetry }) => { telemetry.frameNavigations[0].parentId = ''; }],
    ['different parent', ({ telemetry }) => { telemetry.frameNavigations[1].parentId = 'other-shell'; }],
    ['new commit URL mismatch', ({ telemetry }) => { telemetry.frameNavigations[1].url.pathname = '/other/'; }],
    ['new commit before navigation', ({ telemetry, newDocument }) => { telemetry.frameNavigations[1].sequence = newDocument.startedSequence - 1; }],
    ['new commit after finish', ({ telemetry, newDocument }) => { telemetry.frameNavigations[1].sequence = newDocument.finishedSequence + 1; }],
    ['old loader no longer active at resource start', ({ telemetry, resource }) => {
      telemetry.frameNavigations.push({ ...telemetry.frameNavigations[0], loaderId: 'intervening', sequence: resource.startedSequence - 0.5 });
    }]
  ];
  for (const [reason, mutate] of negatives) {
    const fixture = replacementFixture();
    mutate(fixture);
    assert.equal(classifyIframeDocumentCancellation(fixture.resource, fixture.telemetry), null, reason);
  }
});

test('old timing-only diagnostics remain failures and are never upgraded retrospectively', () => {
  const fixture = replacementFixture();
  const oldDiagnostic = {
    requestId: '7496.517', scenario: 'two-tab-conflict', method: 'GET', resourceType: 'Script',
    status: null, failed: true, finished: false, failure: 'net::ERR_ABORTED', atMs: 10146, responseAtMs: 10209,
    url: { origin: fixture.telemetry.origin, pathname: '/@id/__x00__astro:prefetch', queryKeys: [] }
  };
  assert.equal(classifyIframeDocumentCancellation(oldDiagnostic, fixture.telemetry), null);
});

test('failure telemetry records cancelled, blocked and CORS independently', () => {
  const fixture = replacementFixture();
  fixture.emit('Network.loadingFailed', {
    requestId: 'old-resource', timestamp: 10.210, errorText: 'net::ERR_ABORTED', canceled: true,
    blockedReason: 'origin', corsErrorStatus: { corsError: 'MissingAllowOriginHeader' }
  });
  assert.equal(fixture.resource.blockedReason, 'origin');
  assert.equal(fixture.resource.corsError, true);
  assert.equal(classifyIframeDocumentCancellation(fixture.resource, fixture.telemetry), null);
});

test('late reconciliation removes only the generated cancellation counter after completed document proof', () => {
  const fixture = replacementFixture({ finishReplacement: false });
  const initial = [fixture.resource];
  const issues = ['runtime-errors:1', 'network-errors:1'];
  assert.deepEqual(reconcileScenarioNetworkIssues(issues, initial, initial, fixture.telemetry), issues);
  fixture.complete();
  assert.deepEqual(reconcileScenarioNetworkIssues(issues, initial, [], fixture.telemetry), ['runtime-errors:1']);
  assert.deepEqual(issues, ['runtime-errors:1', 'network-errors:1'], 'reconciliation does not mutate evidence inputs');
});

test('late reconciliation preserves real initial errors and newly observed errors', () => {
  const fixture = replacementFixture();
  const apiFailure = { ...fixture.resource, requestId: 'api-failure', resourceType: 'Fetch' };
  const lateFailure = { ...fixture.resource, requestId: 'late-failure', failure: 'net::ERR_CONNECTION_RESET' };
  assert.deepEqual(reconcileScenarioNetworkIssues(['network-errors:2'], [fixture.resource, apiFailure], [], fixture.telemetry), ['network-errors:1'], 'a later allowance cannot erase a real initial API failure');
  assert.deepEqual(reconcileScenarioNetworkIssues(['network-errors:1'], [fixture.resource], [lateFailure], fixture.telemetry), ['network-errors:1']);
  assert.deepEqual(reconcileScenarioNetworkIssues([], [], [lateFailure], fixture.telemetry), ['network-errors:1']);
  assert.deepEqual(reconcileScenarioNetworkIssues(['network-errors:1'], [], [], fixture.telemetry), ['network-errors:1'], 'unrelated pre-existing issue is preserved');
});
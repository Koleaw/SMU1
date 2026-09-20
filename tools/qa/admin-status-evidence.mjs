import { isExpectedIsolatedPublishStatus } from './admin-action-state.mjs';

// A dialog opens before its status fetch completes. Keep that request alive
// through body inspection before the crawler resets the document for the next
// action. Never infer an error code from another response or from HTTP status.
export function observeIsolatedPublishStatus({ browser, origin, isolated, current, events, expected }) {
  const pending = new Map();
  const finish = (probe, failure) => {
    if (pending.get(probe.requestId) !== probe) return;
    if (failure) events.push({ ...probe.event, ...failure, requestId: probe.requestId, method: 'GET' });
    pending.delete(probe.requestId);
    probe.resolve();
  };
  browser.on('Network.requestWillBeSent', ({ requestId, request, type }) => {
    if (!isolated || request.method !== 'GET') return;
    let url;
    try { url = new URL(request.url); } catch { return; }
    if (url.origin !== origin || url.pathname !== '/api/admin/publish/status' || url.search) return;
    let resolve;
    const done = new Promise((value) => { resolve = value; });
    pending.set(requestId, { requestId, responseUrl: request.url, resolve, done, stage: 'awaiting-response',
      event: { ...current, kind: 'http-request', url: { origin: url.origin, pathname: url.pathname, queryKeys: [] }, resourceType: type } });
  });
  browser.on('Network.loadingFinished', ({ requestId }) => {
    const probe = pending.get(requestId);
    if (!probe) return;
    if (probe.event.status == null) { finish(probe, { reason: 'response-not-observed', stage: probe.stage }); return; }
    if (probe.event.status !== 403) { finish(probe); return; }
    probe.stage = 'reading-response-body';
    browser.send('Network.getResponseBody', { requestId }, { timeoutMs: 5000 }).then((body) => {
      if (pending.get(requestId) !== probe) return;
      let payload;
      try { payload = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body); }
      catch { finish(probe, { reason: 'invalid-response-json', stage: probe.stage }); return; }
      const code = typeof payload?.code === 'string' ? payload.code : '';
      if (isExpectedIsolatedPublishStatus({ method: 'GET', status: probe.event.status,
        origin, url: probe.responseUrl, code, isolated })) {
        expected.push({ ...probe.event, requestId, method: 'GET', code });
        finish(probe);
      } else finish(probe, { reason: 'unexpected-status-code', stage: probe.stage,
        code: /^[A-Z_]{1,80}$/u.test(code) ? code : '(missing or unrecognized)' });
    }).catch((error) => finish(probe, { reason: 'response-body-unavailable', stage: probe.stage,
      errorName: error?.name || 'Error', cdpCode: error?.cdpCode ?? null }));
  });
  browser.on('Network.loadingFailed', ({ requestId, errorText, canceled }) => {
    const probe = pending.get(requestId);
    if (probe) finish(probe, { reason: 'loading-failed', stage: probe.stage, errorText, canceled: Boolean(canceled) });
  });
  return {
    response({ response, type, requestId }) {
      const probe = pending.get(requestId);
      if (!probe) return false;
      probe.stage = 'awaiting-response-finish';
      probe.responseUrl = response.url;
      probe.event = { ...probe.event, kind: 'http-response', status: response.status, resourceType: type };
      return response.status === 403;
    },
    async settle({ timeoutMs = 5000 } = {}) {
      // Flush request events from the preceding trusted action before testing
      // emptiness; pending includes requests whose response headers are delayed.
      await browser.send('Runtime.evaluate', { expression: '0', returnByValue: true });
      const deadline = Date.now() + timeoutMs;
      while (pending.size) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          for (const probe of pending.values()) finish(probe, { reason: 'status-settle-timeout', stage: probe.stage });
          break;
        }
        let timer;
        try {
          await Promise.race([...pending.values()].map((probe) => probe.done).concat(
            new Promise((resolve) => { timer = setTimeout(resolve, remaining); })));
        } finally { clearTimeout(timer); }
      }
    }
  };
}

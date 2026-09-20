import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { observeIsolatedPublishStatus } from './admin-status-evidence.mjs';
import { CdpBrowser, preferredChromePath } from './cdp-browser.mjs';

const origin = 'http://127.0.0.1:4321';
const url = origin + '/api/admin/publish/status';
function fixture({ body = '{"code":"INSECURE_PUBLISH_DENIED"}', error, isolated = true } = {}) {
  const browser = new EventEmitter();
  browser.send = async (method) => {
    if (method !== 'Network.getResponseBody') return {};
    if (error) throw error;
    return { body };
  };
  const events = [], expected = [], current = { actionKey: 'status', mode: 'click' };
  const observer = observeIsolatedPublishStatus({ browser, origin, isolated, current, events, expected });
  browser.on('Network.responseReceived', (value) => {
    if (!observer.response(value) && value.response.status >= 400) events.push({ reason: 'unhandled-http-error' });
  });
  const request = (patch = {}) => browser.emit('Network.requestWillBeSent', {
    requestId: '1', type: 'Fetch', request: { method: 'GET', url, ...patch } });
  const response = (status = 403) => browser.emit('Network.responseReceived', { requestId: '1', type: 'Fetch', response: { status, url } });
  const finished = () => browser.emit('Network.loadingFinished', { requestId: '1' });
  return { browser, events, expected, current, observer, request, response, finished };
}

test('status settlement waits for delayed headers and body before the next action', async () => {
  const f = fixture(); f.request();
  let settled = false;
  const done = f.observer.settle().then(() => { settled = true; });
  await new Promise(setImmediate);
  assert.equal(settled, false, 'request without headers is already pending');
  f.response(); await new Promise(setImmediate);
  assert.equal(settled, false, 'headers alone do not establish the error code');
  f.current.actionKey = 'next';
  f.finished(); await done;
  assert.deepEqual(f.events, []);
  assert.equal(f.expected.length, 1);
  assert.equal(f.expected[0].actionKey, 'status');
  assert.equal(f.expected[0].requestId, '1');
  assert.equal(f.expected[0].code, 'INSECURE_PUBLISH_DENIED');
});

test('missing, malformed, different and unreadable response bodies remain failures', async () => {
  for (const options of [{ body: '{}' }, { body: '{broken' }, { body: '{"code":"AUTH_REQUIRED"}' },
    { error: Object.assign(new Error('body evicted'), { cdpCode: -32000 }) }]) {
    const f = fixture(options); f.request(); f.response(); f.finished(); await f.observer.settle();
    assert.equal(f.expected.length, 0);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].requestId, '1');
    assert.ok(f.events[0].reason);
  }
});

test('body inspection is awaited and a late body cannot reverse a timed out failure', async () => {
  for (const timeout of [false, true]) {
    const f = fixture(); let release;
    const body = new Promise(resolve => { release = resolve; });
    f.browser.send = async method => method === 'Network.getResponseBody' ? body : {};
    f.request(); f.response(); f.finished();
    let settled = false;
    const done = f.observer.settle({ timeoutMs: timeout ? 5 : 5000 }).then(() => { settled = true; });
    await new Promise(setImmediate);
    assert.equal(settled, false);
    if (timeout) await done;
    release({ body: Buffer.from('{"code":"INSECURE_PUBLISH_DENIED"}').toString('base64'), base64Encoded: true });
    await done; await new Promise(setImmediate);
    assert.equal(f.events.length, timeout ? 1 : 0);
    assert.equal(f.expected.length, timeout ? 0 : 1);
  }
});

test('cancellation, missing response events and settlement timeout fail closed once', async () => {
  for (const mode of ['cancel', 'missing-response', 'timeout']) {
    const f = fixture(); f.request();
    if (mode === 'cancel') { f.response(); f.browser.emit('Network.loadingFailed', { requestId: '1', errorText: 'net::ERR_ABORTED', canceled: true }); }
    if (mode === 'missing-response') f.finished();
    await f.observer.settle({ timeoutMs: 5 });
    f.finished(); await f.observer.settle();
    assert.equal(f.events.length, 1, mode);
    assert.equal(f.expected.length, 0, mode);
  }
});

test('other methods, origins, queries, routes and non-isolated runs never gain an exception', async () => {
  for (const options of [{ method: 'POST' }, { url: 'https://example.org/api/admin/publish/status' },
    { url: url + '?publish=1' }, { url: origin + '/api/admin/publish/preview-apply' }, { isolated: false }]) {
    const f = fixture(options); f.request(options); f.response(); f.finished(); await f.observer.settle();
    assert.equal(f.expected.length, 0);
    assert.equal(f.events.length, 1);
  }
});

test('native status click: immediate reset loses the body; settlement preserves the exact denial',
  { skip: !preferredChromePath(), timeout: 30000 }, async (t) => {
    let heldResponse;
    const server = createServer((req, res) => {
      if (req.url === '/api/admin/publish/status') {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.write('{"code":'); heldResponse = res;
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><button id="status" style="width:180px;height:40px">Status</button><dialog id="dialog">Status loading</dialog><script>statusButton=document.querySelector("#status");statusButton.onclick=()=>{document.querySelector("#dialog").showModal();fetch("/api/admin/publish/status").then(r=>r.json()).catch(()=>{});};</script>');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const localOrigin = `http://127.0.0.1:${server.address().port}`;
    const browser = await new CdpBrowser({ safetyMode: 'admin-no-release' }).start();
    const events = [], expected = [], current = { actionKey: 'status', mode: 'click' };
    const observer = observeIsolatedPublishStatus({ browser, origin: localOrigin, isolated: true, current, events, expected });
    browser.on('Network.responseReceived', value => observer.response(value));
    const waitForHeaders = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('status headers not received')), 5000);
      browser.on('Network.responseReceived', ({ response }) => {
        if (response.url === localOrigin + '/api/admin/publish/status') { clearTimeout(timer); resolve(); }
      });
    });
    try {
      for (const settleBeforeReset of [false, true]) {
        heldResponse = null;
        await browser.navigate(localOrigin + '/', { waitAfterMs: 0 });
        const headers = waitForHeaders();
        await browser.dispatchClick({ x: 80, y: 28 }); await headers;
        assert.equal(await browser.evaluate('document.querySelector("#dialog").open'), true, 'UI postcondition already passes');
        if (settleBeforeReset) {
          let settled = false;
          const done = observer.settle().then(() => { settled = true; });
          await new Promise(setImmediate);
          assert.equal(settled, false);
          heldResponse.end('"INSECURE_PUBLISH_DENIED"}');
          await done;
          await browser.navigate(localOrigin + '/', { waitAfterMs: 0 });
        } else {
          await browser.navigate(localOrigin + '/', { waitAfterMs: 0 });
          heldResponse.end('"INSECURE_PUBLISH_DENIED"}');
          await observer.settle({ timeoutMs: 1000 });
          assert.equal(expected.length, 0);
          assert.equal(events.length, 1);
          t.diagnostic(`reset before body inspection: ${events[0].reason} (${events[0].stage})`);
          assert.ok(['loading-failed', 'response-body-unavailable', 'invalid-response-json', 'status-settle-timeout'].includes(events[0].reason), JSON.stringify(events[0]));
          events.length = 0;
        }
      }
      assert.deepEqual(events, []);
      assert.equal(expected.length, 1);
      assert.equal(expected[0].code, 'INSECURE_PUBLISH_DENIED');
    } finally {
      heldResponse?.end();
      await browser.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });

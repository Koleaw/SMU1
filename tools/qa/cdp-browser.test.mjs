import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CdpBrowser, createDistServer, isAdminReleaseMutationRequest, preferredChromePath } from './cdp-browser.mjs';

test('admin-no-release matcher blocks canonical and legacy release mutations but permits reads and exact validation', () => {
  for (const pathname of [
    '/api/admin/publish', '/api/admin/publish/preview-plan', '/api/admin/publish-all',
    '/api/admin/publish-status', '/api/admin/publish-report', '/api/admin/release/production',
    '/api/admin/rollback/x', '/api/admin/production/promote'
  ]) assert.equal(isAdminReleaseMutationRequest({ method: 'POST', url: `http://127.0.0.1:4321${pathname}` }), true, pathname);
  assert.equal(isAdminReleaseMutationRequest({ method: 'GET', url: 'http://127.0.0.1:4321/api/admin/publish/status' }), false);
  assert.equal(isAdminReleaseMutationRequest({ method: 'POST', url: 'http://127.0.0.1:4321/api/admin/validation/request' }), false);
});

test('CDP commands fail within their bound and clear pending state', async () => {
  const browser = new CdpBrowser({ chromePath: 'synthetic-chrome', commandTimeoutMs: 25 });
  browser.socket = { send() {} };
  await assert.rejects(browser.send('Runtime.evaluate', {}, { timeoutMs: 15 }), /Timed out waiting for Chrome DevTools command Runtime\.evaluate/u);
  assert.equal(browser.pending.size, 0);
});

test('background dialog drain clears every queued failure before rejecting', async () => {
  const browser = new CdpBrowser({ chromePath: 'synthetic-chrome' });
  browser.backgroundDialogFailures.push(new Error('first dialog'), new Error('second dialog'));
  await assert.rejects(browser.drainBackgroundDialogs(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map((entry) => entry.message), ['first dialog', 'second dialog']);
    return true;
  });
  assert.equal(browser.backgroundDialogFailures.length, 0);
  await browser.drainBackgroundDialogs();
});

test('dist server enforces configured BASE_PATH and is read-only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-h6-dist-server-'));
  await mkdir(path.join(root, 'kontakty'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<h1>Home</h1>', 'utf8');
  await writeFile(path.join(root, '404.html'), '<h1>404</h1>', 'utf8');
  await writeFile(path.join(root, 'kontakty', 'index.html'), '<h1>Contacts</h1>', 'utf8');
  const server = await createDistServer({ distRoot: root, basePath: '/SMU1' });
  try {
    assert.equal((await fetch(`${server.origin}/SMU1/kontakty/`)).status, 200);
    assert.equal((await fetch(`${server.origin}/kontakty/`)).status, 404);
    assert.equal((await fetch(`${server.origin}/SMU1/kontakty/`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${server.origin}/SMU1/missing/`)).status, 404);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('frozen-build caching is opt-in, caches assets and never caches documents or missing resources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-h6-dist-cache-'));
  await writeFile(path.join(root, 'index.html'), '<h1>First build</h1>', 'utf8');
  await writeFile(path.join(root, '404.html'), '<h1>404</h1>', 'utf8');
  await writeFile(path.join(root, 'asset.css'), 'h1{color:navy}', 'utf8');
  const ordinary = await createDistServer({ distRoot: root });
  const frozen = await createDistServer({ distRoot: root, cacheStaticAssets: true });
  try {
    assert.equal((await fetch(`${ordinary.origin}/asset.css`)).headers.get('cache-control'), 'no-store');
    const asset = await fetch(`${frozen.origin}/asset.css`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'h1{color:navy}');
    assert.equal(asset.headers.get('cache-control'), 'private, max-age=3600, immutable');
    assert.equal((await fetch(frozen.origin)).headers.get('cache-control'), 'no-store');
    await writeFile(path.join(root, 'index.html'), '<h1>Changed document</h1>', 'utf8');
    assert.equal(await (await fetch(frozen.origin)).text(), '<h1>Changed document</h1>');
    const missing = await fetch(`${frozen.origin}/missing.css`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), 'no-store');
  } finally {
    await ordinary.close();
    await frozen.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('CDP keyboard Enter activates focused native controls', { skip: !preferredChromePath() }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-h6-cdp-keyboard-'));
  await writeFile(path.join(root, 'index.html'), `<!doctype html><html><body>
    <button id="action" type="button">Action</button><output id="count">0</output>
    <details id="details"><summary id="summary">Details</summary><p>Body</p></details>
    <script>document.querySelector('#action').addEventListener('click', () => { document.querySelector('#count').value = '1'; });</script>
  </body></html>`, 'utf8');
  await writeFile(path.join(root, '404.html'), '<h1>404</h1>', 'utf8');
  const server = await createDistServer({ distRoot: root });
  const browser = await new CdpBrowser().start();
  try {
    const [assignedPort] = (await readFile(path.join(browser.profileDir, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/u);
    assert.equal(browser.debugPort, Number(assignedPort));
    assert.ok(browser.debugPort > 0 && browser.debugPort <= 65_535);
    await browser.navigate(server.origin);
    await browser.evaluate(`document.querySelector('#action').focus()`);
    await browser.dispatchKey('Enter', { code: 'Enter' });
    assert.equal(await browser.evaluate(`document.querySelector('#count').value`), '1');
    await browser.evaluate(`document.querySelector('#summary').focus()`);
    await browser.dispatchKey('Enter', { code: 'Enter' });
    assert.equal(await browser.evaluate(`document.querySelector('#details').open`), true);
  } finally {
    await browser.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('same-document navigation stays ready without waiting for a new DOMContentLoaded', { skip: !preferredChromePath() }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-h6-cdp-same-document-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><h1 id="anchor">Ready</h1>', 'utf8');
  await writeFile(path.join(root, '404.html'), '<h1>404</h1>', 'utf8');
  const server = await createDistServer({ distRoot: root });
  const browser = await new CdpBrowser().start();
  let documentEvents = 0;
  browser.on('Page.domContentEventFired', () => { documentEvents += 1; });
  try {
    const initial = await browser.navigate(`${server.origin}/`);
    assert.ok(initial.loaderId);
    await browser.evaluate('window.__sameDocumentMarker = true');
    const previousEvents = documentEvents;
    const started = performance.now();
    const sameDocument = await browser.navigate(`${server.origin}/#anchor`);
    assert.equal(sameDocument.loaderId, undefined);
    assert.ok(performance.now() - started < 5000, 'a hash change must not wait for the 20-second document event timeout');
    assert.equal(documentEvents, previousEvents);
    assert.equal(await browser.evaluate('window.__sameDocumentMarker'), true);
    assert.equal(await browser.evaluate('location.hash'), '#anchor');
    assert.equal(browser.lastNavigation.phase, 'settled');
    assert.equal(browser.listeners.get('Page.domContentEventFired')?.length, 1);
    const reloaded = await browser.navigate(`${server.origin}/`);
    assert.ok(reloaded.loaderId);
    assert.notEqual(reloaded.loaderId, initial.loaderId);
    assert.ok(documentEvents > previousEvents);
    assert.equal(await browser.evaluate('Boolean(window.__sameDocumentMarker)'), false);
    assert.equal(browser.pending.size, 0);
  } finally {
    await browser.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('explicit QA baseline navigation accepts only beforeunload and records no dialog text', { skip: !preferredChromePath() }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-h6-cdp-beforeunload-'));
  await mkdir(path.join(root, 'next'), { recursive: true });
  await mkdir(path.join(root, 'late-alert'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), `<!doctype html><html><body>
    <button id="dirty" type="button">Dirty</button>
    <script>
      document.querySelector('#dirty').addEventListener('click', (clickEvent) => {
        window.addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; });
        window.__beforeUnloadArm = {
          armed: true,
          trustedClick: clickEvent.isTrusted,
          hasBeenActive: navigator.userActivation.hasBeenActive
        };
      });
    </script>
  </body></html>`, 'utf8');
  await writeFile(path.join(root, 'next', 'index.html'), '<h1>Next</h1>', 'utf8');
  await writeFile(path.join(root, 'late-alert', 'index.html'), `<!doctype html><html><body><h1>Late alert</h1><script>
    window.addEventListener('load', () => setTimeout(() => alert('dialog-secret-must-not-be-recorded'), 20));
  </script></body></html>`, 'utf8');
  await writeFile(path.join(root, '404.html'), '<h1>404</h1>', 'utf8');
  const server = await createDistServer({ distRoot: root });
  const browser = await new CdpBrowser().start();
  try {
    await browser.navigate(server.origin);
    const point = await browser.evaluate(`(() => {
      const rect = document.querySelector('#dirty').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await browser.dispatchClick(point);
    // Observe the actual click handler before testing navigation. Ordinary
    // browser.evaluate enables userGesture, which could create the activation
    // this fixture must observe rather than supply itself.
    const readiness = await browser.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        const deadline = performance.now() + 1000;
        const inspect = () => {
          if (window.__beforeUnloadArm || performance.now() >= deadline) {
            resolve(window.__beforeUnloadArm || null);
          } else setTimeout(inspect, 20);
        };
        inspect();
      })`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false
    }, { timeoutMs: 1500 });
    assert.equal(readiness.exceptionDetails, undefined, 'beforeunload readiness must be readable without creating a user gesture');
    assert.deepEqual(readiness.result?.value, { armed: true, trustedClick: true, hasBeenActive: true },
      'the real click must install beforeunload and establish sticky activation before navigation');
    await assert.rejects(
      browser.navigate(`${server.origin}/next/`),
      /Unexpected JavaScript beforeunload dialog blocked navigation/u
    );
    assert.equal(await browser.evaluate(`document.querySelector('#dirty')?.textContent`), 'Dirty');
    await browser.navigate(`${server.origin}/next/`, { beforeUnloadPolicy: 'accept-qa-reset' });
    assert.equal(await browser.evaluate(`document.querySelector('h1')?.textContent`), 'Next');
    await browser.evaluate(`(() => { setTimeout(() => alert('preexisting-dialog-secret'), 0); return true; })()`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(
      browser.navigate(server.origin),
      /Unexpected JavaScript alert dialog blocked navigation/u
    );
    assert.equal(await browser.evaluate(`document.querySelector('h1')?.textContent`), 'Next');
    await assert.rejects(
      browser.navigate(`${server.origin}/late-alert/`, { waitAfterMs: 100 }),
      /Unexpected JavaScript alert dialog blocked navigation/u
    );
    await browser.navigate(`${server.origin}/next/`);
    assert.equal(await browser.evaluate(`document.querySelector('h1')?.textContent`), 'Next');
    await browser.drainBackgroundDialogs();
    assert.deepEqual(browser.safetyEvidence().navigationDialogs, [
      { type: 'beforeunload', accepted: false, reason: 'unexpected-navigation-dialog' },
      { type: 'beforeunload', accepted: true, reason: 'qa-baseline-reset' },
      { type: 'alert', accepted: false, reason: 'unexpected-navigation-dialog' },
      { type: 'alert', accepted: false, reason: 'unexpected-navigation-dialog' }
    ]);
    assert.equal(JSON.stringify(browser.safetyEvidence()).includes('Dirty'), false);
    assert.equal(JSON.stringify(browser.safetyEvidence()).includes('dialog-secret'), false);
    assert.equal(JSON.stringify(browser.safetyEvidence()).includes('preexisting-dialog-secret'), false);
    assert.equal(browser.activeDialogContext, null);
    assert.equal(browser.backgroundDialogTasks.length, 0);
    assert.equal(browser.backgroundDialogFailures.length, 0);
    assert.equal(browser.pending.size, 0);
    assert.equal(browser.listeners.get('Page.javascriptDialogOpening')?.length, 1);
  } finally {
    await browser.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('real Escape closes a top dialog before the visual inspector', { skip: !preferredChromePath() }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-h6-editor-escape-'));
  const helperSource = await readFile(new URL('../../src/admin/core/editor-escape.mjs', import.meta.url), 'utf8');
  await writeFile(path.join(root, 'editor-escape.js'), helperSource, 'utf8');
  await writeFile(path.join(root, 'index.html'), `<!doctype html><html><body>
    <aside id="inspector">Inspector</aside>
    <dialog id="modal"><button id="inside" type="button">Inside</button></dialog>
    <output id="outcome"></output>
    <script type="module">
      import { handleVisualEditorEscape } from './editor-escape.js';
      const inspector = document.querySelector('#inspector');
      document.addEventListener('keydown', (event) => {
        document.querySelector('#outcome').value = handleVisualEditorEscape(event, {
          documentValue: document,
          inspectorOpen: () => !inspector.hidden,
          closeInspector: () => { inspector.hidden = true; }
        });
      });
      document.querySelector('#modal').showModal();
      document.querySelector('#inside').focus();
      window.__escapeReady = true;
    </script>
  </body></html>`, 'utf8');
  await writeFile(path.join(root, '404.html'), '<h1>404</h1>', 'utf8');
  const server = await createDistServer({ distRoot: root });
  const browser = await new CdpBrowser().start();
  try {
    await browser.navigate(server.origin);
    await browser.evaluate(`new Promise((resolve) => {
      if (window.__escapeReady) resolve(true);
      else setTimeout(() => resolve(Boolean(window.__escapeReady)), 1000);
    })`);
    await browser.dispatchKey('Escape', { code: 'Escape' });
    assert.deepEqual(await browser.evaluate(`({
      dialogOpen: document.querySelector('#modal').open,
      inspectorHidden: document.querySelector('#inspector').hidden,
      outcome: document.querySelector('#outcome').value
    })`), { dialogOpen: false, inspectorHidden: false, outcome: 'dialog' });

    await browser.dispatchKey('Escape', { code: 'Escape' });
    assert.deepEqual(await browser.evaluate(`({
      dialogOpen: document.querySelector('#modal').open,
      inspectorHidden: document.querySelector('#inspector').hidden,
      outcome: document.querySelector('#outcome').value
    })`), { dialogOpen: false, inspectorHidden: true, outcome: 'inspector' });
  } finally {
    await browser.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

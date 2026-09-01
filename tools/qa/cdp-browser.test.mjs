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

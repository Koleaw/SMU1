import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

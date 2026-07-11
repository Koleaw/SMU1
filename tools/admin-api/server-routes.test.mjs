import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer(t) {
  const port = await freePort();
  const child = spawn(process.execPath, ['tools/admin-api/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADMIN_API_PORT: String(port),
      ADMIN_USERNAME: 'route-test-admin',
      ADMIN_PASSWORD: 'route-test-password',
      SESSION_SECRET: 'route-test-session-secret'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Admin API did not start in time.')), 10000);
    const onData = (chunk) => {
      if (!String(chunk).includes('[admin-api] running')) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Admin API exited before startup: ${code}`));
    });
  });
  return { base: `http://127.0.0.1:${port}/api/admin` };
}

test('registered JSON routes export home and preview the same file without changes', async (t) => {
  const { base } = await startServer(t);
  const login = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'route-test-admin', password: 'route-test-password' })
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.capabilities.contentJson, 1);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const exported = await fetch(`${base}/json-export/static-pages/home`, { method: 'GET', headers: { cookie } });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /export-static-page-home\.json/);
  const rawJson = await exported.text();
  assert.equal(JSON.parse(rawJson).slug, 'home');

  const preview = await fetch(`${base}/json-import/preview`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ collection: 'static-pages', scope: 'single', currentSlug: 'home', writeMode: 'merge', rawJson })
  });
  assert.equal(preview.status, 200);
  const result = await preview.json();
  assert.equal(result.rows[0].action, 'skip');
  assert.equal(result.canApply, false);

  const pageBundleResponse = await fetch(`${base}/json-export/page/static-pages/vypolnennye-obekty`, { method: 'GET', headers: { cookie } });
  assert.equal(pageBundleResponse.status, 200);
  const pageBundle = await pageBundleResponse.json();
  assert.equal(pageBundle.type, 'smu1_page_bundle');
  assert.equal(pageBundle.page.kind, 'completed-projects-index');
  assert.ok(Array.isArray(pageBundle.related.collections.projects.items));

  const fullResponse = await fetch(`${base}/json-export/full-site`, { method: 'GET', headers: { cookie } });
  assert.equal(fullResponse.status, 200);
  const fullPayload = await fullResponse.json();
  assert.equal(fullPayload.type, 'smu1_full_site_export');
  assert.ok(fullPayload.collections.projects);
  assert.ok(fullPayload.singletons.navigation);

  const fullPreviewResponse = await fetch(`${base}/json-import/preview`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'full-site', writeMode: 'merge', rawJson: JSON.stringify(fullPayload) })
  });
  assert.equal(fullPreviewResponse.status, 200);
  const fullPreview = await fullPreviewResponse.json();
  assert.equal(fullPreview.result, 'ready');
  assert.equal(fullPreview.canApply, false);
});

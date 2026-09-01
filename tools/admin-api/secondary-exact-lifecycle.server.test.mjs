import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ORIGIN = 'http://127.0.0.1:4321';
const RECOVERY = 'secondary-exact-browser';

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

async function contentRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-secondary-exact-'));
  await Promise.all([
    'product-categories', 'product-sections', 'products', 'static-pages', 'services', 'projects', 'jobs'
  ].map((collection) => fs.mkdir(path.join(root, collection), { recursive: true })));
  await Promise.all([
    fs.copyFile(
      path.join(process.cwd(), 'src', 'content', 'product-categories', 'besedki-i-pergoly.json'),
      path.join(root, 'product-categories', 'besedki-i-pergoly.json')
    ),
    fs.copyFile(
      path.join(process.cwd(), 'src', 'content', 'product-sections', 'ulichnaya-mebel.json'),
      path.join(root, 'product-sections', 'ulichnaya-mebel.json')
    )
  ]);
  await fs.mkdir(path.join(root, '.admin-data'), { recursive: true });
  await Promise.all([
    fs.copyFile(path.join(process.cwd(), 'src', 'data', 'navigation.json'), path.join(root, '.admin-data', 'navigation.json')),
    fs.copyFile(path.join(process.cwd(), 'src', 'data', 'yandex.json'), path.join(root, '.admin-data', 'yandex.json'))
  ]);
  return root;
}

async function startServer(t, root, delayMs = 25) {
  const port = await freePort();
  let stderr = '';
  const child = spawn(process.execPath, ['tools/admin-api/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADMIN_API_PORT: String(port),
      ADMIN_API_HOST: '127.0.0.1',
      ADMIN_UI_HOST: '127.0.0.1',
      ADMIN_UI_PORT: '4321',
      ADMIN_ALLOWED_ORIGINS: ORIGIN,
      ADMIN_TEST_MODE: 'true',
      CONTENT_WRITE_MODE: 'local',
      ADMIN_USERNAME: 'secondary-exact-admin',
      ADMIN_PASSWORD: 'secondary-exact-password',
      SESSION_SECRET: 'secondary-exact-session-secret-at-least-32-bytes',
      ADMIN_TEST_CONTENT_ROOT: root,
      ADMIN_TEST_FAULTS_ENABLED: 'true',
      ADMIN_TEST_EXACT_MODE: 'deterministic',
      ADMIN_TEST_EXACT_DELAY_MS: String(delayMs)
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Admin API did not start. ${stderr}`)), 15_000);
    child.stdout.on('data', (chunk) => {
      if (!String(chunk).includes('[admin-api] running')) return;
      clearTimeout(timeout);
      resolve();
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Admin API exited before startup (${code}). ${stderr}`));
    });
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 8_000);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
      });
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return `http://127.0.0.1:${port}/api/admin`;
}

async function login(base) {
  const response = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'secondary-exact-admin', password: 'secondary-exact-password' })
  });
  assert.equal(response.status, 200);
  return {
    session: await response.json(),
    cookie: response.headers.get('set-cookie').split(';')[0]
  };
}

function headers(auth) {
  return {
    cookie: auth.cookie,
    origin: ORIGIN,
    'content-type': 'application/json',
    'x-admin-csrf': auth.session.csrfToken,
    'x-admin-recovery-client-id': RECOVERY
  };
}

async function json(response) {
  const payload = await response.json();
  assert.ok(response.ok, `${response.status}: ${payload?.error || JSON.stringify(payload)}`);
  return payload;
}

async function exactOverview(base, auth) {
  return json(await fetch(`${base}/validation/status`, {
    headers: { cookie: auth.cookie, 'x-admin-recovery-client-id': RECOVERY }
  }));
}

async function waitExact(base, auth, transactionId, expected = 'passed', timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const overview = await exactOverview(base, auth);
    const run = overview.runs.find((item) => item.transactionId === transactionId);
    if (run?.status === expected) return { run, overview };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Exact ${expected} timeout for ${transactionId}`);
}

async function genericApply(base, auth, operations, userSummary) {
  const idempotencyKey = `focused-${crypto.randomUUID()}`;
  const preview = await json(await fetch(`${base}/transactions/preview`, {
    method: 'POST',
    headers: headers(auth),
    body: JSON.stringify({ recoveryClientId: RECOVERY, idempotencyKey, userSummary, operations })
  }));
  assert.equal(preview.state, 'prepared');
  const applied = await json(await fetch(`${base}/transactions/apply`, {
    method: 'POST',
    headers: headers(auth),
    body: JSON.stringify({
      recoveryClientId: RECOVERY,
      idempotencyKey,
      transactionId: preview.transactionId,
      payloadHash: preview.payloadHash
    })
  }));
  assert.equal(applied.state, 'committed');
  assert.deepEqual(applied.exactScheduling, {
    transactionId: preview.transactionId,
    status: 'queued',
    current: true,
    publishEligible: false,
    message: 'Exact-проверка поставлена в очередь.'
  });
  await waitExact(base, auth, preview.transactionId);
  return { preview, applied };
}

async function fixtureProduct(slug) {
  const value = JSON.parse(await fs.readFile(path.join(process.cwd(), 'src', 'content', 'products', 'besedka-kofe.json'), 'utf8'));
  return { ...value, slug, title: 'Exact lifecycle fixture', sku: 'H6-EXACT-FIXTURE', relatedProductSlugs: [] };
}

test('secondary Save response is independent of the exact runner and duplicate request reuses one run', async (t) => {
  const root = await contentRoot();
  const base = await startServer(t, root, 2_500);
  const auth = await login(base);
  const product = await fixtureProduct('h6-exact-latency');
  const started = performance.now();
  const saved = await json(await fetch(`${base}/content/products`, {
    method: 'POST', headers: headers(auth),
    body: JSON.stringify({ recoveryClientId: RECOVERY, slug: product.slug, content: product, baseRevision: 'missing' })
  }));
  const latencyMs = performance.now() - started;
  t.diagnostic(`secondary Save response latency: ${latencyMs.toFixed(1)} ms (exact runner delay: 2500 ms)`);
  assert.ok(latencyMs < 2_000, `Save waited too long (${latencyMs.toFixed(1)} ms)`);
  assert.equal(saved.exactScheduling?.status, 'queued');

  const duplicate = await json(await fetch(`${base}/validation/request`, {
    method: 'POST', headers: headers(auth),
    body: JSON.stringify({ recoveryClientId: RECOVERY, transactionId: saved.transactionId })
  }));
  const passed = await waitExact(base, auth, saved.transactionId, 'passed', 8_000);
  assert.equal(duplicate.runId, passed.run.runId);
  assert.equal(passed.overview.runs.filter((run) => run.transactionId === saved.transactionId).length, 1);
});

test('every secondary commit family queues exact, failure preserves Save, and retry creates one new run', async (t) => {
  const root = await contentRoot();
  const base = await startServer(t, root, 25);
  const auth = await login(base);
  const mutationHeaders = headers(auth);
  const slug = 'h6-secondary-lifecycle';
  const product = await fixtureProduct(slug);

  const created = await json(await fetch(`${base}/content/products`, {
    method: 'POST', headers: mutationHeaders,
    body: JSON.stringify({ recoveryClientId: RECOVERY, slug, content: product, baseRevision: 'missing' })
  }));
  assert.equal(created.exactScheduling?.status, 'queued', 'create');
  await waitExact(base, auth, created.transactionId);

  const saved = await json(await fetch(`${base}/content/products/${slug}`, {
    method: 'PUT', headers: mutationHeaders,
    body: JSON.stringify({ recoveryClientId: RECOVERY, content: { ...created.content, shortDescription: 'Secondary exact save' }, baseRevision: created.revision })
  }));
  assert.equal(saved.exactScheduling?.status, 'queued', 'save');
  await waitExact(base, auth, saved.transactionId);

  const navigation = await json(await fetch(`${base}/navigation`, { headers: { cookie: auth.cookie } }));
  const navigationSaved = await json(await fetch(`${base}/navigation`, {
    method: 'PUT', headers: mutationHeaders,
    body: JSON.stringify({ recoveryClientId: RECOVERY, baseRevision: navigation.revision, items: navigation.items.map((item, index) => index ? item : { ...item, title: `${item.title} QA` }) })
  }));
  assert.equal(navigationSaved.exactScheduling?.status, 'queued', 'navigation');
  await waitExact(base, auth, navigationSaved.transactionId);

  const singleton = await json(await fetch(`${base}/singletons/yandex`, { headers: { cookie: auth.cookie } }));
  const singletonSaved = await json(await fetch(`${base}/singletons/yandex`, {
    method: 'PUT', headers: mutationHeaders,
    body: JSON.stringify({ recoveryClientId: RECOVERY, baseRevision: singleton.revision, content: { ...singleton.content, map: { ...singleton.content.map, height: singleton.content.map.height + 1 } } })
  }));
  assert.equal(singletonSaved.exactScheduling?.status, 'queued', 'singleton');
  await waitExact(base, auth, singletonSaved.transactionId);

  let current = await json(await fetch(`${base}/content/products/${slug}`, { headers: { cookie: auth.cookie } }));
  await genericApply(base, auth, [{
    type: 'upsert-record', collection: 'products', slug, baseRevision: current.revision,
    content: { ...current.content, order: Number(current.content.order || 0) + 10 }
  }], 'Reorder fixture');

  current = await json(await fetch(`${base}/content/products/${slug}`, { headers: { cookie: auth.cookie } }));
  const renamedSlug = `${slug}-renamed`;
  await genericApply(base, auth, [{
    type: 'rename-record', collection: 'products', slug, nextSlug: renamedSlug, baseRevision: current.revision
  }], 'Rename fixture');

  current = await json(await fetch(`${base}/content/products/${renamedSlug}`, { headers: { cookie: auth.cookie } }));
  const deleted = await genericApply(base, auth, [{
    type: 'delete-record', collection: 'products', slug: renamedSlug, baseRevision: current.revision,
    hardDelete: true, relationPlan: { strategy: 'hard-delete' }
  }], 'Delete fixture');

  const restorePreview = await json(await fetch(`${base}/history/${deleted.preview.transactionId}/restore-preview`, {
    method: 'POST', headers: mutationHeaders,
    body: JSON.stringify({ recoveryClientId: RECOVERY, idempotencyKey: `restore-${crypto.randomUUID()}` })
  }));
  const restored = await json(await fetch(`${base}/transactions/apply`, {
    method: 'POST', headers: mutationHeaders,
    body: JSON.stringify({
      recoveryClientId: RECOVERY,
      transactionId: restorePreview.transactionId,
      idempotencyKey: restorePreview.idempotencyKey,
      payloadHash: restorePreview.payloadHash
    })
  }));
  assert.equal(restored.exactScheduling?.status, 'queued', 'history restore');
  await waitExact(base, auth, restorePreview.transactionId);

  current = await json(await fetch(`${base}/content/products/${renamedSlug}`, { headers: { cookie: auth.cookie } }));
  const importPreview = await json(await fetch(`${base}/json-import/preview`, {
    method: 'POST', headers: mutationHeaders,
    body: JSON.stringify({
      recoveryClientId: RECOVERY,
      collection: 'products', scope: 'single', currentSlug: renamedSlug, writeMode: 'merge',
      rawJson: JSON.stringify({ ...current.content, shortDescription: 'Secondary import exact' })
    })
  }));
  const imported = await json(await fetch(`${base}/json-import/apply`, {
    method: 'POST', headers: mutationHeaders,
    body: JSON.stringify({ recoveryClientId: RECOVERY, operationId: importPreview.operationId })
  }));
  assert.equal(imported.transactionId, importPreview.transactionId);
  assert.equal(imported.exactScheduling?.status, 'queued', 'JSON import');
  await waitExact(base, auth, imported.transactionId);

  const armed = await json(await fetch(`${base}/__test__/faults`, {
    method: 'POST', headers: mutationHeaders, body: JSON.stringify({ nextExactFailure: true })
  }));
  assert.equal(armed.armed.nextExactFailure, true);
  current = await json(await fetch(`${base}/content/products/${renamedSlug}`, { headers: { cookie: auth.cookie } }));
  const failedSave = await json(await fetch(`${base}/content/products/${renamedSlug}`, {
    method: 'PUT', headers: mutationHeaders,
    body: JSON.stringify({ recoveryClientId: RECOVERY, baseRevision: current.revision, content: { ...current.content, leadText: 'Saved despite exact failure' } })
  }));
  assert.equal(failedSave.exactScheduling?.status, 'queued');
  const failed = await waitExact(base, auth, failedSave.transactionId, 'failed');
  assert.match(failed.run.message, /Изменения сохранены на компьютере/u);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'products', `${renamedSlug}.json`), 'utf8')).leadText, 'Saved despite exact failure');
  const retried = await json(await fetch(`${base}/validation/request`, {
    method: 'POST', headers: mutationHeaders,
    body: JSON.stringify({ recoveryClientId: RECOVERY, transactionId: failedSave.transactionId })
  }));
  assert.notEqual(retried.runId, failed.run.runId);
  const passedRetry = await waitExact(base, auth, failedSave.transactionId, 'passed');
  assert.equal(passedRetry.overview.runs.filter((run) => run.transactionId === failedSave.transactionId).length, 2);
});

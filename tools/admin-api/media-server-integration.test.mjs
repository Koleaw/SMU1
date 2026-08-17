import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import sharp from 'sharp';

const TEST_ORIGIN = 'http://127.0.0.1:4321';
const TEST_USERNAME = 'media-integration-admin';
const TEST_PASSWORD = 'media-integration-password';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COLLECTIONS = [
  'product-categories',
  'product-sections',
  'products',
  'services',
  'projects',
  'jobs',
  'site-settings',
  'static-pages'
];

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

async function temporaryContentRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-media-http-'));
  await Promise.all(COLLECTIONS.map((collection) => fs.mkdir(path.join(root, collection), { recursive: true })));
  await fs.mkdir(path.join(root, 'no-executables'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function startServer(t, contentRoot) {
  const port = await freePort();
  const inheritedWithoutPath = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path')
  );
  const child = spawn(process.execPath, ['tools/admin-api/server.mjs'], {
    cwd: REPO_ROOT,
    env: {
      ...inheritedWithoutPath,
      PATH: path.join(contentRoot, 'no-executables'),
      ADMIN_API_PORT: String(port),
      ADMIN_API_HOST: '127.0.0.1',
      ADMIN_UI_HOST: '127.0.0.1',
      ADMIN_UI_PORT: '4321',
      ADMIN_ALLOWED_ORIGINS: TEST_ORIGIN,
      ADMIN_TEST_MODE: 'true',
      CONTENT_WRITE_MODE: 'local',
      ADMIN_USERNAME: TEST_USERNAME,
      ADMIN_PASSWORD: TEST_PASSWORD,
      SESSION_SECRET: 'media-integration-session-secret-at-least-32-bytes',
      ADMIN_TEST_CONTENT_ROOT: contentRoot
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill();
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Admin API did not start in time.\n${stderr}`));
    }, 10000);
    const onData = (chunk) => {
      if (!String(chunk).includes('[admin-api] running')) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Admin API exited before startup (${code}).\n${stderr}`));
    });
  });
  return `http://127.0.0.1:${port}/api/admin`;
}

async function login(base) {
  const response = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: TEST_ORIGIN },
    body: JSON.stringify({ login: TEST_USERNAME, password: TEST_PASSWORD })
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  return {
    cookie: response.headers.get('set-cookie').split(';')[0],
    csrfToken: payload.csrfToken
  };
}

function authenticatedHeaders(auth, json = false) {
  return {
    cookie: auth.cookie,
    origin: TEST_ORIGIN,
    'x-admin-csrf': auth.csrfToken,
    ...(json ? { 'content-type': 'application/json' } : {})
  };
}

async function postStagedFile(base, auth, options) {
  const form = new FormData();
  form.set('batchId', options.batchId);
  form.set('clientId', options.clientId);
  form.set('originalIndex', String(options.originalIndex ?? 0));
  form.set('file', new Blob([options.bytes], { type: options.mime }), options.filename);
  return fetch(`${base}/media/staging`, {
    method: 'POST',
    headers: authenticatedHeaders(auth),
    body: form
  });
}

async function jpegBytes() {
  return sharp({
    create: { width: 5, height: 4, channels: 3, background: { r: 28, g: 96, b: 172 } }
  }).jpeg().toBuffer();
}

function hiddenProject(image) {
  return {
    title: 'Скрытый объект со staged media',
    slug: 'hidden-staged-project',
    city: 'Курган',
    shortDescription: 'Проверка атомарного сохранения карточки и фотографии.',
    whatWasDone: 'Фотография подготовлена в staging и сохранена вместе с карточкой.',
    image,
    gallery: [image],
    order: 900,
    isActive: false,
    year: 2026,
    seoTitle: 'Скрытый тестовый объект — СМУ-1',
    seoDescription: 'Скрытая карточка для проверки транзакционного сохранения staged media.'
  };
}

async function uploadNames(contentRoot) {
  try {
    return (await fs.readdir(path.join(contentRoot, 'public', 'uploads'))).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

test('authenticated staging and hidden-record save promote JPEG and JSON in one transaction without publishing', { timeout: 30000 }, async (t) => {
  const contentRoot = await temporaryContentRoot(t);
  const base = await startServer(t, contentRoot);
  const auth = await login(base);
  const bytes = await jpegBytes();

  const stagingResponse = await postStagedFile(base, auth, {
    batchId: 'batch-hidden-project',
    clientId: 'cover-photo',
    filename: 'Объект.jpg',
    mime: 'image/jpeg',
    bytes
  });
  const staged = await stagingResponse.json();
  assert.equal(stagingResponse.status, 201, JSON.stringify(staged));
  assert.match(staged.stagedId, /^[a-f0-9]{64}$/u);
  assert.equal(staged.canonicalPath, `/uploads/${staged.stagedId}.jpg`);
  assert.equal(staged.validation.format, 'jpeg');

  const unauthenticatedPreview = await fetch(`${base}/media/staging/${staged.batchId}/${staged.leaseId}/preview`);
  assert.equal(unauthenticatedPreview.status, 401);
  assert.match(unauthenticatedPreview.headers.get('content-type') || '', /application\/json/u);
  assert.equal(Object.hasOwn(await unauthenticatedPreview.json(), 'error'), true);

  const stagedPreviewResponse = await fetch(`${base}/media/staging/${staged.batchId}/${staged.leaseId}/preview`, {
    headers: { cookie: auth.cookie }
  });
  assert.equal(stagedPreviewResponse.status, 200);
  assert.equal(stagedPreviewResponse.headers.get('content-type'), 'image/jpeg');
  assert.equal(stagedPreviewResponse.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(stagedPreviewResponse.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.deepEqual(Buffer.from(await stagedPreviewResponse.arrayBuffer()), bytes);

  const canonicalFile = path.join(contentRoot, 'public', ...staged.canonicalPath.split('/').filter(Boolean));
  const recordFile = path.join(contentRoot, 'projects', 'hidden-staged-project.json');
  await assert.rejects(fs.access(canonicalFile), { code: 'ENOENT' });
  await assert.rejects(fs.access(recordFile), { code: 'ENOENT' });

  const saveResponse = await fetch(`${base}/content/projects`, {
    method: 'POST',
    headers: authenticatedHeaders(auth, true),
    body: JSON.stringify({
      slug: 'hidden-staged-project',
      baseRevision: 'missing',
      content: hiddenProject(staged.canonicalPath),
      stagedMedia: [{
        stagedId: staged.stagedId,
        batchId: staged.batchId,
        leaseId: staged.leaseId,
        baseRevision: staged.baseRevision,
        destinationBaseRevision: staged.destinationBaseRevision
      }]
    })
  });
  const saved = await saveResponse.json();
  assert.equal(saveResponse.status, 201, JSON.stringify(saved));
  assert.equal(saved.result, 'saved');
  assert.equal(saved.content.isActive, false);
  assert.equal(saved.content.image, staged.canonicalPath);
  assert.match(saved.transactionId, /^[a-f0-9-]+$/iu);

  assert.deepEqual(await fs.readFile(canonicalFile), bytes);
  const onDisk = JSON.parse(await fs.readFile(recordFile, 'utf8'));
  assert.equal(onDisk.isActive, false);
  assert.equal(onDisk.image, staged.canonicalPath);

  const transactionResponse = await fetch(`${base}/transactions/${saved.transactionId}`, {
    headers: { cookie: auth.cookie }
  });
  assert.equal(transactionResponse.status, 200);
  const transaction = await transactionResponse.json();
  assert.equal(transaction.state, 'committed');
  assert.deepEqual(
    transaction.mutations.map((mutation) => mutation.path).sort(),
    [`projects/hidden-staged-project.json`, `public/uploads/${staged.stagedId}.jpg`].sort()
  );

  const historyResponse = await fetch(`${base}/history`, { headers: { cookie: auth.cookie } });
  assert.equal(historyResponse.status, 200);
  const { history } = await historyResponse.json();
  assert.equal(history.length, 1, 'Staging itself creates no content history and save creates one transaction.');
  assert.equal(history[0].transactionId, saved.transactionId);
  assert.deepEqual(
    history[0].changedPaths.sort(),
    [`projects/hidden-staged-project.json`, `public/uploads/${staged.stagedId}.jpg`].sort()
  );

  const batchResponse = await fetch(`${base}/media/staging/${staged.batchId}`, {
    headers: { cookie: auth.cookie }
  });
  assert.equal(batchResponse.status, 200);
  const batch = await batchResponse.json();
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].status, 'promoted');
  assert.equal(batch.items[0].canonicalPath, staged.canonicalPath);
  assert.equal(Object.hasOwn(saved, 'published'), false);
});

test('corrupt JPEG, SVG and MIME mismatch are rejected before any permanent upload', { timeout: 30000 }, async (t) => {
  const contentRoot = await temporaryContentRoot(t);
  const base = await startServer(t, contentRoot);
  const auth = await login(base);
  const validJpeg = await jpegBytes();
  const cases = [
    {
      name: 'corrupt JPEG',
      expectedCode: 'RASTER_DECODE_FAILED',
      filename: 'corrupt.jpg',
      mime: 'image/jpeg',
      bytes: Buffer.from([0xff, 0xd8, 0xff])
    },
    {
      name: 'SVG',
      expectedCode: 'SVG_FORBIDDEN',
      filename: 'vector.svg',
      mime: 'image/svg+xml',
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    },
    {
      name: 'MIME mismatch',
      expectedCode: 'MEDIA_MIME_MISMATCH',
      filename: 'mismatch.jpg',
      mime: 'image/png',
      bytes: validJpeg
    }
  ];

  for (const [index, fixture] of cases.entries()) {
    const before = await uploadNames(contentRoot);
    const response = await postStagedFile(base, auth, {
      batchId: `batch-rejected-${index}`,
      clientId: `rejected-${index}`,
      filename: fixture.filename,
      mime: fixture.mime,
      bytes: fixture.bytes
    });
    assert.equal(response.status, 400, `${fixture.name} must be rejected.`);
    const payload = await response.json();
    assert.equal(payload.code, fixture.expectedCode, fixture.name);
    assert.deepEqual(await uploadNames(contentRoot), before, `${fixture.name} must not reach public/uploads.`);
  }

  const usageResponse = await fetch(`${base}/media/staging/usage`, { headers: { cookie: auth.cookie } });
  assert.equal(usageResponse.status, 200);
  assert.deepEqual(await usageResponse.json(), {
    bytes: 0,
    blobs: 0,
    maxTotalBytes: 256 * 1024 * 1024,
    remainingBytes: 256 * 1024 * 1024
  });
  const historyResponse = await fetch(`${base}/history`, { headers: { cookie: auth.cookie } });
  assert.equal(historyResponse.status, 200);
  assert.deepEqual((await historyResponse.json()).history, []);
});

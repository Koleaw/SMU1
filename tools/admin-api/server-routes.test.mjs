import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  resolveProductImportEnvelope,
  validateProductContentForWrite
} from './product-presentation.mjs';

const TEST_ORIGIN = 'http://127.0.0.1:4321';

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

async function startServer(t, options = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['tools/admin-api/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADMIN_API_PORT: String(port),
      ADMIN_API_HOST: '127.0.0.1',
      ADMIN_UI_HOST: '127.0.0.1',
      ADMIN_UI_PORT: '4321',
      ADMIN_ALLOWED_ORIGINS: TEST_ORIGIN,
      ADMIN_TEST_MODE: 'true',
      CONTENT_WRITE_MODE: 'local',
      ADMIN_USERNAME: 'route-test-admin',
      ADMIN_PASSWORD: 'route-test-password',
      SESSION_SECRET: 'route-test-session-secret-at-least-32-bytes',
      ...(options.contentRoot ? { ADMIN_TEST_CONTENT_ROOT: options.contentRoot } : {}),
      ...(options.env || {})
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

async function login(base) {
  const response = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: TEST_ORIGIN },
    body: JSON.stringify({ login: 'route-test-admin', password: 'route-test-password' })
  });
  assert.equal(response.status, 200);
  return {
    payload: await response.json(),
    cookie: response.headers.get('set-cookie').split(';')[0]
  };
}

function product(overrides = {}) {
  return {
    title: 'Тестовый товар',
    slug: 'test-product',
    productCategorySlug: 'besedki-i-pergoly',
    sku: 'TEST-1',
    shortDescription: 'Краткое описание.',
    leadText: 'Лид-текст.',
    description: 'Подробное описание.',
    materials: ['Сталь'],
    colors: ['RAL 5005'],
    dimensions: [{ id: 'primary-spec', label: 'Размер', value: '1000 × 500 мм', order: 10, isActive: true }],
    features: ['Преимущество'],
    customizationItems: ['Размер'],
    showDeliveryBlock: true,
    deliveryText: 'Доставка по России.',
    relatedProductSlugs: [],
    showCustomProjectBlock: true,
    customProjectTitle: 'Нужен другой вариант?',
    customProjectText: 'Адаптируем под объект.',
    priceMode: 'on_request',
    priceFrom: null,
    currency: 'RUB',
    image: '/assets/images/test-product.webp',
    gallery: ['/assets/images/test-product-2.webp'],
    placeholderLabel: '',
    order: 10,
    isActive: true,
    showInCatalog: true,
    seoTitle: 'Тестовый товар',
    seoDescription: 'Описание тестового товара.',
    ...overrides
  };
}

async function createContentRoot(t, { full = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-admin-routes-'));
  if (full) {
    await fs.cp(path.join(process.cwd(), 'src', 'content'), root, { recursive: true, force: true });
  }
  await Promise.all([
    'product-categories', 'product-sections', 'products', 'static-pages', 'services', 'projects', 'jobs', '.admin-data'
  ].map((collection) => (
    fs.mkdir(path.join(root, collection), { recursive: true })
  )));
  if (!full) await Promise.all([
    fs.copyFile(
      path.join(process.cwd(), 'src', 'content', 'product-categories', 'besedki-i-pergoly.json'),
      path.join(root, 'product-categories', 'besedki-i-pergoly.json')
    ),
    fs.copyFile(
      path.join(process.cwd(), 'src', 'content', 'product-sections', 'ulichnaya-mebel.json'),
      path.join(root, 'product-sections', 'ulichnaya-mebel.json')
    )
  ]);
  await Promise.all([
    fs.copyFile(path.join(process.cwd(), 'src', 'data', 'navigation.json'), path.join(root, '.admin-data', 'navigation.json')),
    fs.copyFile(path.join(process.cwd(), 'src', 'data', 'yandex.json'), path.join(root, '.admin-data', 'yandex.json'))
  ]);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('publish namespace is advertised but fails closed before Git/network side effects in ADMIN_TEST_MODE', async (t) => {
  const contentRoot = await createContentRoot(t, { full: true });
  const { base } = await startServer(t, {
    contentRoot,
    env: {
      ADMIN_GIT_REMOTE: 'publish-test-remote-must-not-run',
      GITHUB_REPOSITORY: 'invalid/nonexistent',
      TEST_SITE_URL: 'https://owner.github.io',
      TEST_BASE_PATH: '/repo'
    }
  });
  const { payload: session, cookie } = await login(base);
  assert.equal(session.capabilities.publish, 1);
  const mutationHeaders = {
    cookie,
    'content-type': 'application/json',
    origin: TEST_ORIGIN,
    'x-admin-csrf': session.csrfToken,
    'x-admin-recovery-client-id': 'route-test-browser'
  };

  const protectedRoutes = [
    { method: 'POST', path: '/publish/preview-plan', body: { target: 'preview', transactionIds: [] } },
    { method: 'POST', path: '/publish/preview-apply', body: { target: 'preview', planId: 'plan-route-test' } },
    { method: 'GET', path: '/publish/status' },
    { method: 'GET', path: '/publish/jobs/job-route-test' },
    { method: 'POST', path: '/publish/jobs/job-route-test/poll', body: { target: 'preview' } },
    { method: 'POST', path: '/publish/jobs/job-route-test/retry', body: { target: 'preview', recoveryClientId: 'route-test-browser' } },
    { method: 'GET', path: '/publish/jobs/job-route-test/report' }
  ];
  for (const route of protectedRoutes) {
    const response = await fetch(`${base}${route.path}`, {
      method: route.method,
      headers: route.method === 'GET' ? { cookie } : mutationHeaders,
      ...(route.body ? { body: JSON.stringify(route.body) } : {})
    });
    assert.equal(response.status, 403, `${route.method} ${route.path}`);
    const payload = await response.json();
    assert.equal(payload.code, 'INSECURE_PUBLISH_DENIED', `${route.method} ${route.path}`);
  }

  const legacyRoutes = [
    { method: 'POST', path: '/publish' },
    { method: 'POST', path: '/publish-all' },
    { method: 'GET', path: '/publish-status' },
    { method: 'GET', path: '/publish-report' }
  ];
  for (const route of legacyRoutes) {
    const response = await fetch(`${base}${route.path}`, {
      method: route.method,
      headers: route.method === 'GET' ? { cookie } : mutationHeaders,
      ...(route.method === 'POST' ? { body: '{}' } : {})
    });
    assert.equal(response.status, 410, `${route.method} ${route.path}`);
    assert.match((await response.json()).code, /^LEGACY_PUBLISH/u);
  }

  await assert.rejects(
    fs.access(path.join(contentRoot, '.admin-runtime', 'publish')),
    (error) => error?.code === 'ENOENT'
  );
});

test('H6 validation, backup and production-disabled release routes are authenticated and fail closed', async (t) => {
  const contentRoot = await createContentRoot(t);
  const { base } = await startServer(t, { contentRoot });
  const { payload: session, cookie } = await login(base);
  assert.equal(session.capabilities.exactValidation, 1);
  assert.equal(session.capabilities.backups, 1);
  assert.equal(session.capabilities.releaseControl, 1);

  const backupStatus = await fetch(`${base}/backups/status`, { headers: { cookie } });
  assert.equal(backupStatus.status, 200);
  assert.equal((await backupStatus.json()).configured, false, 'test runtime never writes an external backup');

  const production = await fetch(`${base}/release/production`, {
    method: 'POST',
    headers: {
      cookie,
      origin: TEST_ORIGIN,
      'content-type': 'application/json',
      'x-admin-csrf': session.csrfToken,
      'x-admin-recovery-client-id': 'route-test-browser'
    },
    body: '{}'
  });
  assert.equal(production.status, 403);
  assert.equal((await production.json()).code, 'H6_PRODUCTION_DISABLED');

  const missingRun = await fetch(`${base}/validation/runs/exact-${'a'.repeat(32)}`, {
    headers: { cookie, 'x-admin-recovery-client-id': 'route-test-browser' }
  });
  assert.equal(missingRun.status, 404);
  assert.equal((await missingRun.json()).code, 'EXACT_RUN_NOT_FOUND');
});

test('registered JSON routes export home and preview the same file without changes', async (t) => {
  const contentRoot = await createContentRoot(t, { full: true });
  const { base } = await startServer(t, { contentRoot });
  const { payload: session, cookie } = await login(base);
  assert.equal(session.capabilities.contentJson, 1);
  const mutationHeaders = { cookie, 'content-type': 'application/json', origin: TEST_ORIGIN, 'x-admin-csrf': session.csrfToken };

  const yandexResponse = await fetch(`${base}/singletons/yandex`, { headers: { cookie } });
  assert.equal(yandexResponse.status, 200);
  const yandex = await yandexResponse.json();
  const yandexSave = await fetch(`${base}/singletons/yandex`, {
    method: 'PUT',
    headers: mutationHeaders,
    body: JSON.stringify({ content: { ...yandex.content, map: { ...yandex.content.map, height: yandex.content.map.height + 1 } }, baseRevision: yandex.revision })
  });
  assert.equal(yandexSave.status, 200);
  assert.equal((await yandexSave.json()).content.map.height, yandex.content.map.height + 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(contentRoot, '.admin-data', 'yandex.json'), 'utf8')).map.height, yandex.content.map.height + 1);

  const exported = await fetch(`${base}/json-export/static-pages/home`, { method: 'GET', headers: { cookie } });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /export-static-page-home\.json/);
  const rawJson = await exported.text();
  assert.equal(JSON.parse(rawJson).slug, 'home');

  const preview = await fetch(`${base}/json-import/preview`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: TEST_ORIGIN, 'x-admin-csrf': session.csrfToken },
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
    method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: TEST_ORIGIN, 'x-admin-csrf': session.csrfToken },
    body: JSON.stringify({ scope: 'full-site', writeMode: 'merge', rawJson: JSON.stringify(fullPayload) })
  });
  assert.equal(fullPreviewResponse.status, 200);
  const fullPreview = await fullPreviewResponse.json();
  assert.equal(fullPreview.result, 'ready');
  assert.equal(fullPreview.canApply, false);
});

test('staged media batches can be renewed by the owning authenticated browser', async (t) => {
  const contentRoot = await createContentRoot(t);
  const { base } = await startServer(t, { contentRoot });
  const { payload: session, cookie } = await login(base);
  const response = await fetch(`${base}/media/staging/draft-batch-001/renew`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      origin: TEST_ORIGIN,
      'x-admin-csrf': session.csrfToken
    },
    body: '{}'
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.batchId, 'draft-batch-001');
  assert.equal(payload.renewed, 0);
  assert.deepEqual(payload.items, []);
});

test('product writes validate presentation data and catalog export round-trips through productImport', async (t) => {
  const contentRoot = await createContentRoot(t);
  const { base } = await startServer(t, { contentRoot });
  const { payload: session, cookie } = await login(base);
  const headers = { cookie, 'content-type': 'application/json', origin: TEST_ORIGIN, 'x-admin-csrf': session.csrfToken };

  const createResponse = await fetch(`${base}/content/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ slug: 'test-product', content: product(), baseRevision: 'missing' })
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.content.presentationType, 'standard');
  assert.equal(JSON.parse(await fs.readFile(path.join(contentRoot, 'products', 'test-product.json'), 'utf8')).presentationType, 'standard');

  const premium = product({
    presentationType: 'premium',
    solutionKicker: 'Инженерное решение',
    applicationItems: ['Общественные пространства'],
    executionVariants: ['По размерам объекта']
  });
  const premiumResponse = await fetch(`${base}/content/products/test-product`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ content: premium, baseRevision: created.revision })
  });
  assert.equal(premiumResponse.status, 200);
  const premiumPayload = await premiumResponse.json();
  const savedPremium = premiumPayload.content;
  assert.equal(savedPremium.presentationType, 'premium');
  assert.equal(savedPremium.solutionKicker, premium.solutionKicker);
  assert.deepEqual(savedPremium.applicationItems, premium.applicationItems);
  assert.deepEqual(savedPremium.executionVariants, premium.executionVariants);

  const beforeInvalid = await fs.readFile(path.join(contentRoot, 'products', 'test-product.json'), 'utf8');
  const invalidResponse = await fetch(`${base}/content/products/test-product`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ content: { ...premium, presentationType: 'featured' }, baseRevision: premiumPayload.revision })
  });
  assert.equal(invalidResponse.status, 400);
  const invalidPayload = await invalidResponse.json();
  assert.equal(invalidPayload.code, 'PRODUCT_SCHEMA_VALIDATION_FAILED');
  assert.ok(invalidPayload.validationIssues.some((issue) => issue.path === 'presentationType'));
  assert.equal(await fs.readFile(path.join(contentRoot, 'products', 'test-product.json'), 'utf8'), beforeInvalid);

  const transactionPreviewResponse = await fetch(`${base}/transactions/preview`, {
    method: 'POST',
    headers: { ...headers, 'x-admin-recovery-client-id': 'route-test-browser', 'x-admin-idempotency-key': 'typed-product-update' },
    body: JSON.stringify({
      userSummary: 'Типизированное обновление товара',
      operations: [{
        type: 'upsert-record',
        collection: 'products',
        slug: 'test-product',
        baseRevision: premiumPayload.revision,
        content: { ...premium, title: 'Типизированное название' }
      }]
    })
  });
  assert.equal(transactionPreviewResponse.status, 200);
  const transactionPreview = await transactionPreviewResponse.json();
  assert.equal(transactionPreview.state, 'prepared');
  assert.equal(transactionPreview.diff.length, 1);

  const transactionApplyResponse = await fetch(`${base}/transactions/apply`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transactionId: transactionPreview.transactionId, payloadHash: transactionPreview.payloadHash })
  });
  assert.equal(transactionApplyResponse.status, 200);
  assert.equal((await transactionApplyResponse.json()).state, 'committed');
  const transactionResponse = await fetch(`${base}/transactions/${transactionPreview.transactionId}`, { headers: { cookie } });
  assert.equal(transactionResponse.status, 200);
  assert.equal((await transactionResponse.json()).metadata.userSummary, 'Типизированное обновление товара');
  const historyResponse = await fetch(`${base}/history`, { headers: { cookie } });
  assert.equal(historyResponse.status, 200);
  assert.equal((await historyResponse.json()).history.length, 3);

  const currentResponse = await fetch(`${base}/content/products/test-product`, { headers: { cookie } });
  const currentProduct = (await currentResponse.json()).content;
  const importPreviewResponse = await fetch(`${base}/json-import/preview`, {
    method: 'POST',
    headers: { ...headers, 'x-admin-recovery-client-id': 'route-test-browser', 'x-admin-idempotency-key': 'generic-import-update' },
    body: JSON.stringify({
      collection: 'products',
      scope: 'single',
      currentSlug: 'test-product',
      writeMode: 'merge',
      rawJson: JSON.stringify({ ...currentProduct, shortDescription: 'Обновлено импортом' })
    })
  });
  assert.equal(importPreviewResponse.status, 200);
  const importPreview = await importPreviewResponse.json();
  assert.equal(importPreview.canApply, true);
  assert.ok(importPreview.transactionId);
  const importApplyResponse = await fetch(`${base}/json-import/apply`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ operationId: importPreview.operationId })
  });
  assert.equal(importApplyResponse.status, 200);
  assert.equal((await importApplyResponse.json()).result, 'success');
  assert.equal(JSON.parse(await fs.readFile(path.join(contentRoot, 'products', 'test-product.json'), 'utf8')).shortDescription, 'Обновлено импортом');
  const afterImportHistory = await fetch(`${base}/history`, { headers: { cookie } });
  assert.equal((await afterImportHistory.json()).history.length, 4);

  const exportResponse = await fetch(`${base}/export-catalog`, { headers: { cookie } });
  assert.equal(exportResponse.status, 200);
  const catalog = await exportResponse.json();
  assert.equal(catalog.type, 'catalog_export');
  assert.equal(catalog.products[0].presentationType, 'premium');
  assert.deepEqual(catalog.products[0].applicationItems, premium.applicationItems);

  const resolved = resolveProductImportEnvelope(catalog);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.payload.type, 'products_import');
  assert.equal(resolved.payload.version, 1);
  assert.equal(resolved.payload.items.length, 1);
  const item = resolved.payload.items[0];
  assert.equal(item.presentationType, 'premium');
  assert.equal(item.solutionKicker, premium.solutionKicker);
  assert.deepEqual(item.applicationItems, premium.applicationItems);
  assert.deepEqual(item.executionVariants, premium.executionVariants);
  assert.deepEqual(item.images, [premium.image, ...premium.gallery]);
  assert.deepEqual(item.specs, [{ id: 'primary-spec', name: 'Размер', value: '1000 × 500 мм', order: 10, isActive: true }]);
  assert.deepEqual(item.advantages, premium.features);
  assert.deepEqual(item.customProduction, premium.customizationItems);
  assert.equal(item.showDelivery, premium.showDeliveryBlock);
  assert.equal(item.showCustomProject, premium.showCustomProjectBlock);

  const reconstructed = validateProductContentForWrite({
    ...premium,
    presentationType: item.presentationType,
    solutionKicker: item.solutionKicker,
    applicationItems: item.applicationItems,
    executionVariants: item.executionVariants,
    image: item.images[0],
    gallery: item.images.slice(1),
    dimensions: item.specs.map(({ name, ...spec }) => ({ label: name, ...spec })),
    features: item.advantages,
    customizationItems: item.customProduction,
    showDeliveryBlock: item.showDelivery,
    showCustomProjectBlock: item.showCustomProject
  });
  assert.deepEqual(reconstructed, premium);

  const oldCatalog = resolveProductImportEnvelope({ type: 'catalog_export', version: 1, products: [] });
  assert.equal(oldCatalog.ok, false);
  assert.match(oldCatalog.error, /не содержит совместимый productImport/);
  assert.equal(resolveProductImportEnvelope({ type: 'products_import', version: 1, items: [] }).ok, true);

});

test('admin routes stay thin local-only adapters and public builds select the inert shell', async () => {
  const adapters = [
    { file: ['src', 'pages', 'admin', 'index.astro'], shell: 'VisualAdminShell', initial: 'initialRoute="/"' },
    { file: ['src', 'pages', 'admin', 'catalog.astro'], shell: 'AdminShell', initial: 'initialView="catalog"' },
    { file: ['src', 'pages', 'admin', 'visual.astro'], shell: 'VisualAdminShell', initial: 'initialRoute="/"' },
    { file: ['src', 'pages', 'admin', 'technical.astro'], shell: 'AdminShell', initial: 'initialView="settings"' },
    {
      file: ['src', 'pages', 'admin', 'pages', 'navesy.astro'],
      shell: 'VisualAdminShell',
      initial: 'initialRoute="/navesy-i-kozyrki/"'
    }
  ];

  for (const adapter of adapters) {
    const source = await fs.readFile(path.join(process.cwd(), ...adapter.file), 'utf8');
    const label = adapter.file.join('/');
    assert.match(source, /import\.meta\.env\.DEV\s*&&\s*process\.env\.SMU1_LOCAL_ADMIN\s*===\s*['"]true['"]/u, label);
    assert.match(source, new RegExp(`import\\(['"][^'"]*admin/shell/${adapter.shell}\\.astro['"]\\)`, 'u'), label);
    assert.match(source, /import\(['"][^'"]*admin\/shell\/AdminUnavailable\.astro['"]\)/u, label);
    assert.equal(source.match(/<Shell\b/gu)?.length, 1, `${label} must render exactly one selected shell`);
    assert.ok(source.includes(adapter.initial), `${label} must preserve its initial editor destination`);
    assert.doesNotMatch(source, /<(?:script|style|form|button|dialog|section)\b/iu, `${label} must not restore a route-local editor`);
  }
});

test('shared settings UI wires lossless full-site JSON export and preview-before-apply import', async () => {
  const [shellSource, appSource, apiSource, dataToolsSource] = await Promise.all([
    fs.readFile(path.join(process.cwd(), 'src', 'admin', 'shell', 'AdminShell.astro'), 'utf8'),
    fs.readFile(path.join(process.cwd(), 'src', 'admin', 'shell', 'admin-app.mjs'), 'utf8'),
    fs.readFile(path.join(process.cwd(), 'src', 'admin', 'core', 'api-client.mjs'), 'utf8'),
    fs.readFile(path.join(process.cwd(), 'src', 'admin', 'settings', 'data-tools.mjs'), 'utf8')
  ]);

  assert.match(shellSource, /import \{ startAdminApp \} from ['"]\.\/admin-app\.mjs['"]/u);
  assert.match(shellSource, /data-view=["']settings["']/u);
  assert.match(appSource, /import \{ renderDataTools \} from ['"]\.\.\/settings\/data-tools\.mjs['"]/u);
  assert.match(appSource, /route\.view === ['"]settings['"][\s\S]{0,300}renderDataTools\(/u);

  for (const controlId of [
    'adminJsonTools',
    'adminJsonExportFullSite',
    'adminJsonImportFile',
    'adminJsonImportPreview',
    'adminJsonImportApply'
  ]) {
    assert.match(dataToolsSource, new RegExp(`id: ["']${controlId}["']`, 'u'), `${controlId} must be rendered by the shared settings module`);
  }
  assert.match(dataToolsSource, /lossless/u);
  assert.match(dataToolsSource, /api\.exportFullSite\(\)/u);
  assert.match(dataToolsSource, /api\.importPreview\(/u);
  assert.match(dataToolsSource, /api\.importApply\(/u);
  assert.match(dataToolsSource, /disabled: true[^\n]+id: ['"]adminJsonImportApply['"]/u);

  assert.match(apiSource, /exportFullSite:[^\n]+download\(['"]\/json-export\/full-site['"]\)/u);
  assert.match(apiSource, /importPreview:[\s\S]{0,240}request\(['"]\/json-import\/preview['"]/u);
  assert.match(apiSource, /importApply:[\s\S]{0,240}request\(['"]\/json-import\/apply['"]/u);
});

test('publish server wiring fixes ref ownership and exposes only the exact-SHA namespace', async () => {
  const source = await fs.readFile(path.join(process.cwd(), 'tools', 'admin-api', 'server.mjs'), 'utf8');
  const brokerSource = await fs.readFile(path.join(process.cwd(), 'tools', 'admin-api', 'github-credential-broker.mjs'), 'utf8');
  assert.match(source, /createContentPublishGateRunner, createGitHubPublishProviders/u);
  assert.match(source, /candidate:\s*['"]v4-product-final-candidate['"]/u);
  assert.match(source, /preview:\s*['"]preview['"]/u);
  assert.match(source, /protected:\s*['"]main['"]/u);
  assert.match(source, /assertSecureOperation\(config, ['"]publish['"]\)/u);
  assert.match(source, /pathname === ['"]\/api\/admin\/publish\/preview-plan['"]/u);
  assert.match(source, /pathname === ['"]\/api\/admin\/publish\/preview-apply['"]/u);
  assert.match(source, /pathname === ['"]\/api\/admin\/publish\/status['"]/u);
  assert.match(source, /publish\/jobs/u);
  assert.match(source, /previewUrl:\s*configuredPublishSite\(\)\.previewUrl/u);
  assert.match(source, /previewUrlKind:\s*['"]mutable-github-pages['"]/u);
  assert.match(source, /previewUrlIsImmutable:\s*false/u);
  assert.match(source, /requireVerifiedArtifact:\s*true/u);
  assert.match(source, /releaseControl\.preparePreview\(/u);
  assert.match(source, /publishService\.getPlan\(/u);
  assert.match(source, /releaseControl\.requestPreview\([\s\S]{0,300}transactionIds:\s*ownedPlan\.selectedTransactionIds/u);
  assert.match(source, /sourceRevision:\s*ownedPlan\.verification\?\.sourceRevision/u);
  assert.match(source, /routeExpectations:\s*\[\{\s*route:\s*['"]\/['"],\s*expected:\s*['"]html['"]\s*\}\]/u);
  assert.match(source, /routeExpectations:[\s\S]{0,160}\bpages\b/u);
  assert.match(source, /retryProvider:\s*providers\.retryProvider/u);
  assert.match(source, /createGitHubApiRequest\(\{/u);
  assert.match(brokerSource, /PUBLISH_GITHUB_WRITE_CREDENTIAL_REQUIRED/u);
  assert.match(brokerSource, /rerun-failed-jobs\|rerun/u);
  assert.match(brokerSource, /\['credential', 'fill'\]/u);
  assert.doesNotMatch(source, /GITHUB_(?:DEPLOY_)?TOKEN/u);
  assert.doesNotMatch(brokerSource, /gh\s+auth\s+token/iu);
  assert.match(source, /await publishService\?\.close\(\)/u);
  assert.doesNotMatch(source, /runGit\(\[['"]push['"]/u);
  assert.doesNotMatch(source, /git add -A|publishPaths\(|publishWholeSiteChanges\(|publishContentChanges\(/u);
});

test('Pages workflow deploys only an exact candidate-preview pair from preview', async () => {
  const source = await fs.readFile(path.join(process.cwd(), '.github', 'workflows', 'deploy.yml'), 'utf8');
  assert.match(source, /workflow_dispatch test may deploy only the preview ref/u);
  assert.match(source, /develop is check-only; only preview may update GitHub Pages/u);
  assert.match(source, /elif \[ "\$\{GITHUB_REF_NAME\}" = "preview" \]; then[\s\S]{0,160}deploy_kind="test"/u);
  assert.doesNotMatch(source, /"preview" \] \|\| \[ "\$\{GITHUB_REF_NAME\}" = "develop"/u);
  assert.equal((source.match(/git ls-remote --refs origin refs\/heads\/v4-product-final-candidate/gu) || []).length, 2);
  assert.equal((source.match(/"\$candidate_sha" != "\$preview_sha"/gu) || []).length, 2);
  assert.equal((source.match(/"\$preview_sha" != "\$GITHUB_SHA"/gu) || []).length, 2);
  assert.match(source, /deploy-test:\s*\n\s*if: needs\.build\.outputs\.deploy_kind == 'test'/u);
  assert.match(source, /permissions:\s*\{\}/u);
  assert.match(source, /build:[\s\S]{0,100}permissions:\s*\n\s*contents:\s*read/u);
  assert.match(source, /deploy-test:[\s\S]{0,240}permissions:\s*\n\s*contents:\s*read\s*\n\s*pages:\s*write\s*\n\s*id-token:\s*write/u);
  assert.match(source, /H6 production deploy is hard-disabled; the production request is check-only/u);
  assert.doesNotMatch(source, /PRODUCTION_DEPLOY_ENABLED_VAR|target="production"|deploy_kind="production"/u);
  assert.match(source, /name: Open and reconcile every production route in public and editor modes[\s\S]{0,220}DEPLOY_TARGET: \$\{\{ steps\.deploy-meta\.outputs\.deploy_target \}\}[\s\S]{0,100}BASE_PATH: \$\{\{ steps\.deploy-meta\.outputs\.base_path \}\}/u);
  const isolationIndex = source.indexOf('npm run qa:deploy-isolation');
  const identityIndex = source.indexOf('node tools/release/artifact-identity.mjs --dist dist --tested-sha "${GITHUB_SHA}"');
  const uploadIndex = source.indexOf('actions/upload-pages-artifact@');
  assert.ok(isolationIndex >= 0 && identityIndex > isolationIndex, 'artifact identity must follow every dist mutation/gate');
  assert.ok(uploadIndex > identityIndex, 'artifact identity must be written before Pages upload');

  const actionUses = [...source.matchAll(/^\s+(?:-\s+)?uses:\s*([^\s#]+)/gmu)].map((match) => match[1]);
  assert.equal(actionUses.length, 6);
  for (const action of actionUses) assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/u, action);
});

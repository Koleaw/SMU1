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
      ADMIN_USERNAME: 'route-test-admin',
      ADMIN_PASSWORD: 'route-test-password',
      SESSION_SECRET: 'route-test-session-secret',
      ...(options.contentRoot ? { ADMIN_TEST_CONTENT_ROOT: options.contentRoot } : {})
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
    headers: { 'content-type': 'application/json' },
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
    productCategorySlug: 'test-category',
    sku: 'TEST-1',
    shortDescription: 'Краткое описание.',
    leadText: 'Лид-текст.',
    description: 'Подробное описание.',
    materials: ['Сталь'],
    colors: ['RAL 5005'],
    dimensions: [{ label: 'Размер', value: '1000 × 500 мм', order: 10, isActive: true }],
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

async function createContentRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-admin-routes-'));
  await Promise.all(['product-categories', 'product-sections', 'products'].map((collection) => (
    fs.mkdir(path.join(root, collection), { recursive: true })
  )));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('registered JSON routes export home and preview the same file without changes', async (t) => {
  const { base } = await startServer(t);
  const { payload: session, cookie } = await login(base);
  assert.equal(session.capabilities.contentJson, 1);

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

test('product writes validate presentation data and catalog export round-trips through productImport', async (t) => {
  const contentRoot = await createContentRoot(t);
  const { base } = await startServer(t, { contentRoot });
  const { cookie } = await login(base);
  const headers = { cookie, 'content-type': 'application/json' };

  const createResponse = await fetch(`${base}/content/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ slug: 'test-product', content: product() })
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
    body: JSON.stringify(premium)
  });
  assert.equal(premiumResponse.status, 200);
  const savedPremium = (await premiumResponse.json()).content;
  assert.equal(savedPremium.presentationType, 'premium');
  assert.equal(savedPremium.solutionKicker, premium.solutionKicker);
  assert.deepEqual(savedPremium.applicationItems, premium.applicationItems);
  assert.deepEqual(savedPremium.executionVariants, premium.executionVariants);

  const beforeInvalid = await fs.readFile(path.join(contentRoot, 'products', 'test-product.json'), 'utf8');
  const invalidResponse = await fetch(`${base}/content/products/test-product`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...premium, presentationType: 'featured' })
  });
  assert.equal(invalidResponse.status, 400);
  const invalidPayload = await invalidResponse.json();
  assert.equal(invalidPayload.code, 'PRODUCT_SCHEMA_VALIDATION_FAILED');
  assert.ok(invalidPayload.validationIssues.some((issue) => issue.path === 'presentationType'));
  assert.equal(await fs.readFile(path.join(contentRoot, 'products', 'test-product.json'), 'utf8'), beforeInvalid);

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
  assert.deepEqual(item.specs, [{ name: 'Размер', value: '1000 × 500 мм', order: 10, isActive: true }]);
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

  const visualSource = await fs.readFile(path.join(process.cwd(), 'src/pages/admin/visual.astro'), 'utf8');
  assert.match(visualSource, /payload\?\.type === 'catalog_export'/);
  assert.match(visualSource, /payload\.productImport\?\.type === 'products_import'/);
  assert.match(visualSource, /не содержит совместимый productImport/);
});

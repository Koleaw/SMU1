import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(os.tmpdir(), `smu1-admin-roundtrip-${crypto.randomUUID()}`);
const sandboxA = path.join(tempRoot, 'source-edit');
const sandboxB = path.join(tempRoot, 'import-target');
const port = 18787;
const marker = '[roundtrip-test]';

const walk = async (directory) => {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
};
const digestTree = async (directories) => {
  const files = (await Promise.all(directories.map(async (directory) => {
    if (!fsSync.existsSync(directory)) return [];
    return walk(directory);
  }))).flat();
  const result = new Map();
  for (const file of files.sort()) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const content = await fs.readFile(file);
    result.set(relative, crypto.createHash('sha256').update(content).digest('hex'));
  }
  return result;
};
const diffMaps = (before, after) => {
  const changed = [];
  for (const [file, hash] of before) if (after.get(file) !== hash) changed.push(file);
  for (const file of after.keys()) if (!before.has(file)) changed.push(file);
  return changed;
};
const stripExportTimestamps = (value) => {
  if (Array.isArray(value)) return value.map(stripExportTimestamps);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'exportedAt')
    .map(([key, item]) => [key, stripExportTimestamps(item)]));
};
const findItem = (payload, collection, slug) => {
  const item = payload.collections?.[collection]?.items?.find((entry) => entry.slug === slug);
  if (!item) throw new Error(`${collection}/${slug} is missing from full-site export.`);
  return item;
};

async function prepareSandbox(target) {
  await fs.mkdir(target, { recursive: true });
  await fs.cp(path.join(root, 'src'), path.join(target, 'src'), { recursive: true });
  await fs.cp(path.join(root, 'tools'), path.join(target, 'tools'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json', 'astro.config.mjs', 'tsconfig.json']) {
    await fs.copyFile(path.join(root, file), path.join(target, file));
  }
  await fs.mkdir(path.join(target, 'public'), { recursive: true });
  await fs.symlink(path.join(root, 'node_modules'), path.join(target, 'node_modules'), 'junction');
  await fs.symlink(path.join(root, 'public', 'assets'), path.join(target, 'public', 'assets'), 'junction');
  await fs.symlink(path.join(root, 'public', 'uploads'), path.join(target, 'public', 'uploads'), 'junction');
}

async function startApi(cwd) {
  const child = spawn(process.execPath, ['tools/admin-api/server.mjs'], {
    cwd,
    env: {
      ...process.env,
      ADMIN_API_PORT: String(port),
      ADMIN_USERNAME: 'roundtrip',
      ADMIN_PASSWORD: 'roundtrip-only',
      SESSION_SECRET: 'roundtrip-isolated-session-secret',
      PRODUCTION_DEPLOY_ENABLED: 'false',
      CONTENT_WRITE_MODE: 'local',
      SITE_URL: '',
      TEST_SITE_URL: 'http://127.0.0.1:4321',
      ADMIN_ALLOWED_ORIGINS: 'http://127.0.0.1:4321'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Admin API exited early (${child.exitCode}).\n${logs}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/me`);
      if (response.ok) return { child, logs: () => logs };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`Admin API did not start.\n${logs}`);
}

async function stopApi(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function session() {
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'roundtrip', password: 'roundtrip-only' })
  });
  if (!response.ok) throw new Error(`Admin login failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Admin login did not return a session cookie.');
  const request = async (pathname, options = {}) => {
    const result = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      ...options,
      headers: { 'content-type': 'application/json', cookie, ...(options.headers || {}) }
    });
    const raw = await result.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = raw; }
    if (!result.ok) throw new Error(`${pathname} failed: ${result.status} ${raw}`);
    return payload;
  };
  return request;
}

async function importFullSite(request, payload) {
  const preview = await request('/api/admin/json-import/preview', {
    method: 'POST',
    body: JSON.stringify({ collection: '', scope: 'full-site', currentSlug: '', writeMode: 'merge', rawJson: JSON.stringify(payload) })
  });
  if (preview.result !== 'ready' || !preview.operationId || !preview.canApply) {
    throw new Error(`Full-site preview was not applicable: ${JSON.stringify(preview)}`);
  }
  const applied = await request('/api/admin/json-import/apply', {
    method: 'POST',
    body: JSON.stringify({ operationId: preview.operationId, replaceConfirmed: false })
  });
  if (applied.result !== 'success') throw new Error(`Full-site apply failed: ${JSON.stringify(applied)}`);
  return { preview, applied };
}

const liveBefore = await digestTree([
  path.join(root, 'src', 'content'),
  path.join(root, 'src', 'data'),
  path.join(root, 'public', 'assets'),
  path.join(root, 'public', 'uploads')
]);
let api;
let result;

try {
  await prepareSandbox(sandboxA);
  await prepareSandbox(sandboxB);

  api = await startApi(sandboxA);
  const requestA = await session();
  const readProduct = await requestA('/api/admin/content/products/skamya-loft');
  const readProject = await requestA('/api/admin/content/projects/blagoustroystvo-naberezhnoy-reki-tobol');
  const readSettings = await requestA('/api/admin/content/site-settings/global');
  if (!readProduct.content || !readProject.content || !readSettings.content) throw new Error('Admin content reads returned incomplete records.');
  const exportedOriginal = await requestA('/api/admin/json-export/full-site');

  const editedPayload = structuredClone(exportedOriginal);
  const product = findItem(editedPayload, 'products', 'skamya-loft');
  const project = findItem(editedPayload, 'projects', 'blagoustroystvo-naberezhnoy-reki-tobol');
  product.shortDescription = `${product.shortDescription} ${marker}`;
  product.image = '/uploads/chatgpt-image-23-2026-11-44-15-4-1779528754678.png';
  product.isActive = false;
  product.showInCatalog = false;
  project.shortDescription = `${project.shortDescription} ${marker}`;
  project.isActive = false;
  editedPayload.singletons['site-settings'].vacanciesEmptyTitle = `${editedPayload.singletons['site-settings'].vacanciesEmptyTitle} ${marker}`;

  const appliedA = await importFullSite(requestA, editedPayload);
  const exportedEdited = await requestA('/api/admin/json-export/full-site');
  await stopApi(api.child);
  api = null;

  api = await startApi(sandboxB);
  const requestB = await session();
  const appliedB = await importFullSite(requestB, exportedEdited);
  const exportedRoundtrip = await requestB('/api/admin/json-export/full-site');

  const normalizedEdited = JSON.stringify(stripExportTimestamps(exportedEdited));
  const normalizedRoundtrip = JSON.stringify(stripExportTimestamps(exportedRoundtrip));
  if (normalizedEdited !== normalizedRoundtrip) throw new Error('Full-site export differs after isolated import/export round-trip.');

  const roundtripProduct = findItem(exportedRoundtrip, 'products', 'skamya-loft');
  const roundtripProject = findItem(exportedRoundtrip, 'projects', 'blagoustroystvo-naberezhnoy-reki-tobol');
  if (!roundtripProduct.shortDescription.endsWith(marker)
    || roundtripProduct.image !== product.image
    || roundtripProduct.isActive !== false
    || roundtripProduct.showInCatalog !== false
    || !roundtripProject.shortDescription.endsWith(marker)
    || roundtripProject.isActive !== false
    || !exportedRoundtrip.singletons['site-settings'].vacanciesEmptyTitle.endsWith(marker)) {
    throw new Error('Edited text/media/active/showInCatalog/project/site-settings fields did not survive round-trip.');
  }

  result = {
    status: 'pass',
    readRecords: ['products/skamya-loft', 'projects/blagoustroystvo-naberezhnoy-reki-tobol', 'site-settings/global'],
    editedFields: ['product.shortDescription', 'product.image', 'product.isActive', 'product.showInCatalog', 'project.shortDescription', 'project.isActive', 'site-settings.vacanciesEmptyTitle'],
    sourcePreview: { updated: appliedA.preview.updated, skipped: appliedA.preview.skipped, warnings: appliedA.preview.warnings?.length || 0 },
    targetPreview: { updated: appliedB.preview.updated, skipped: appliedB.preview.skipped, warnings: appliedB.preview.warnings?.length || 0 },
    normalizedExportEqual: true,
    publishCalled: false,
    gitPresentInSandbox: false
  };
} finally {
  if (api) await stopApi(api.child);
  const liveAfter = await digestTree([
    path.join(root, 'src', 'content'),
    path.join(root, 'src', 'data'),
    path.join(root, 'public', 'assets'),
    path.join(root, 'public', 'uploads')
  ]);
  const liveChanges = diffMaps(liveBefore, liveAfter);
  if (liveChanges.length) throw new Error(`Live records/data/media changed during round-trip: ${liveChanges.join(', ')}`);
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ ...result, liveChanges: 0, tempRemoved: !fsSync.existsSync(tempRoot) }, null, 2));

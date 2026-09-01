import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveAstroCli } from './astro-cli.mjs';
import { createSafeNodeChildEnvironment } from './runtime-identity.mjs';

const execFileAsync = promisify(execFile);
const TOKEN_RE = /^[a-f0-9]{32}$/u;
const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const COLLECTIONS = new Set(['product-sections', 'product-categories', 'products', 'services', 'projects', 'jobs', 'static-pages']);
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class LocalPreviewError extends Error {
  constructor(code, message, { status = 400, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LocalPreviewError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function contained(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeToken(value) {
  const token = String(value || '').toLowerCase();
  if (!TOKEN_RE.test(token)) throw new LocalPreviewError('LOCAL_PREVIEW_TOKEN_INVALID', 'Некорректный token локального preview.', { status: 404 });
  return token;
}

function safeSlug(value) {
  const slug = String(value || '').toLowerCase();
  if (!SAFE_SLUG_RE.test(slug)) throw new LocalPreviewError('LOCAL_PREVIEW_SLUG_INVALID', 'Некорректный slug записи.');
  return slug;
}

function ownerHash(owner) {
  return crypto.createHash('sha256').update(`smu1-local-preview\0${String(owner || '')}`, 'utf8').digest('hex');
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
  })[extension] || 'application/octet-stream';
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, jsonBytes(value), { encoding: 'utf8', flag: 'w' });
}

export async function runLocalPreviewAstroBuild({ workspace, repoRoot, environment, execute = execFileAsync }) {
  const astroCli = await resolveAstroCli(repoRoot);
  const result = await execute(process.execPath, [astroCli, 'build'], {
    cwd: workspace,
    env: environment,
    windowsHide: true,
    timeout: 10 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function defaultBuildRunner(options) {
  return runLocalPreviewAstroBuild(options);
}

export function createLocalPreviewService(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const runtimeDir = path.resolve(options.runtimeDir || path.join(repoRoot, '.admin-runtime', 'local-preview'));
  if (!contained(repoRoot, runtimeDir) || runtimeDir === repoRoot) {
    throw new LocalPreviewError('LOCAL_PREVIEW_RUNTIME_INVALID', 'Runtime local preview должен находиться в отдельном каталоге внутри repo.', { status: 500 });
  }
  const ttlMs = Number(options.ttlMs || DEFAULT_TTL_MS);
  const maxEntries = Number(options.maxEntries || 3);
  const now = options.now || Date.now;
  const randomToken = options.randomToken || (() => crypto.randomBytes(16).toString('hex'));
  const buildRunner = options.buildRunner || defaultBuildRunner;
  const sourceEnvironment = options.environment || process.env;
  const origin = String(options.origin || 'http://127.0.0.1:8787').replace(/\/$/u, '');
  let queue = Promise.resolve();

  function tokenRoot(token) {
    const target = path.join(runtimeDir, safeToken(token));
    if (!contained(runtimeDir, target)) throw new LocalPreviewError('LOCAL_PREVIEW_PATH_ESCAPE', 'Путь preview вышел за runtime.', { status: 500 });
    return target;
  }

  async function assertPlainDirectory(directory) {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new LocalPreviewError('LOCAL_PREVIEW_PATH_UNSAFE', 'Preview runtime не является обычным каталогом.', { status: 500 });
  }

  async function initialize() {
    await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    await assertPlainDirectory(runtimeDir);
    await cleanupExpired();
  }

  async function removeToken(token) {
    const target = tokenRoot(token);
    if (path.dirname(target) !== runtimeDir) throw new LocalPreviewError('LOCAL_PREVIEW_DELETE_UNSAFE', 'Отказано в небезопасной очистке preview.', { status: 500 });
    await fs.rm(target, { recursive: true, force: true });
  }

  async function metadataFor(token) {
    const metadataPath = path.join(tokenRoot(token), 'metadata.json');
    let metadata;
    try { metadata = await readJson(metadataPath); }
    catch (error) {
      if (error?.code === 'ENOENT') throw new LocalPreviewError('LOCAL_PREVIEW_NOT_FOUND', 'Локальный preview не найден или уже очищен.', { status: 404 });
      throw new LocalPreviewError('LOCAL_PREVIEW_METADATA_INVALID', 'Metadata локального preview повреждена.', { status: 500, cause: error });
    }
    if (metadata?.token !== token || !Number.isSafeInteger(metadata.expiresAt)) {
      throw new LocalPreviewError('LOCAL_PREVIEW_METADATA_INVALID', 'Metadata локального preview повреждена.', { status: 500 });
    }
    return metadata;
  }

  async function cleanupExpired() {
    await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    const entries = await fs.readdir(runtimeDir, { withFileTypes: true });
    const valid = [];
    const invalidTokens = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || !TOKEN_RE.test(entry.name)) {
        if (entry.name !== '.keep') throw new LocalPreviewError('LOCAL_PREVIEW_RUNTIME_UNSAFE', 'В runtime local preview найден неожиданный объект.', { status: 500, details: { name: entry.name } });
        continue;
      }
      try {
        const metadata = await metadataFor(entry.name);
        valid.push(metadata);
      } catch (error) {
        if (!['LOCAL_PREVIEW_NOT_FOUND', 'LOCAL_PREVIEW_METADATA_INVALID'].includes(error.code)) throw error;
        invalidTokens.push(entry.name);
      }
    }
    const ordered = valid.sort((left, right) => right.createdAt - left.createdAt);
    const expired = ordered.filter((entry, index) => entry.expiresAt <= now() || index >= maxEntries);
    for (const token of invalidTokens) await removeToken(token);
    for (const entry of expired) await removeToken(entry.token);
    return { removed: invalidTokens.length + expired.length, invalidRemoved: invalidTokens.length };
  }

  async function findRecordPath(workspace, collection, slug) {
    const directory = path.join(workspace, 'src', 'content', collection);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const matches = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const candidate = path.join(directory, entry.name);
      const content = await readJson(candidate);
      if (content?.slug === slug) matches.push(candidate);
    }
    if (matches.length !== 1) {
      throw new LocalPreviewError(
        matches.length ? 'LOCAL_PREVIEW_RECORD_AMBIGUOUS' : 'LOCAL_PREVIEW_RECORD_NOT_FOUND',
        matches.length ? 'Найдено несколько записей с одинаковым slug.' : 'Сохранённая запись не найдена.',
        { status: matches.length ? 409 : 404, details: { collection, slug } }
      );
    }
    return matches[0];
  }

  async function enableRecord(workspace, collection, slug) {
    const recordPath = await findRecordPath(workspace, collection, slug);
    const content = await readJson(recordPath).catch((error) => {
      throw new LocalPreviewError('LOCAL_PREVIEW_RECORD_NOT_FOUND', 'Сохранённая запись не найдена.', { status: 404, cause: error });
    });
    content.isActive = true;
    await writeJson(recordPath, content);

    if (collection === 'products') {
      const categorySlug = safeSlug(content.productCategorySlug);
      const categoryPath = await findRecordPath(workspace, 'product-categories', categorySlug);
      const category = await readJson(categoryPath);
      category.isActive = true;
      await writeJson(categoryPath, category);
      const sectionSlug = safeSlug(category.parentSectionSlug);
      const sectionPath = await findRecordPath(workspace, 'product-sections', sectionSlug);
      const section = await readJson(sectionPath);
      section.isActive = true;
      await writeJson(sectionPath, section);
      return { content, route: `/${sectionSlug}/${categorySlug}/${slug}/` };
    }
    if (collection === 'product-categories') {
      const sectionSlug = safeSlug(content.parentSectionSlug);
      const sectionPath = await findRecordPath(workspace, 'product-sections', sectionSlug);
      const section = await readJson(sectionPath);
      section.isActive = true;
      await writeJson(sectionPath, section);
      return { content, route: `/${sectionSlug}/${slug}/` };
    }
    if (collection === 'projects') return { content, route: `/vypolnennye-obekty/${slug}/` };
    if (collection === 'jobs') return { content, route: `/vakansii/${slug}/` };
    if (collection === 'static-pages') {
      if (slug === 'home') return { content, route: '/' };
      if (slug === 'custom-order') return { content, route: '/izgotovlenie-na-zakaz/' };
      return { content, route: `/${slug}/` };
    }
    return { content, route: `/${slug}/` };
  }

  async function prepareWorkspace(workspace) {
    await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
    await fs.cp(path.join(repoRoot, 'src'), path.join(workspace, 'src'), { recursive: true, force: true });
    for (const filename of ['package.json', 'package-lock.json', 'tsconfig.json']) {
      await fs.copyFile(path.join(repoRoot, filename), path.join(workspace, filename));
    }
    const baseConfig = await fs.readFile(path.join(repoRoot, 'astro.config.mjs'), 'utf8');
    await fs.writeFile(path.join(workspace, 'astro.base.config.mjs'), baseConfig, 'utf8');
    await fs.writeFile(path.join(workspace, 'astro.config.mjs'), "import base from './astro.base.config.mjs';\nexport default { ...base, publicDir: false };\n", 'utf8');
    await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
  }

  async function build(request = {}) {
    const collection = String(request.collection || '');
    if (!COLLECTIONS.has(collection)) throw new LocalPreviewError('LOCAL_PREVIEW_COLLECTION_INVALID', 'Для этой сущности нет отдельной public-страницы.');
    const slug = safeSlug(request.slug);
    const token = safeToken(randomToken());
    const createdAt = now();
    const root = tokenRoot(token);
    const workspace = path.join(root, 'workspace');
    const basePath = `/api/admin/local-preview/${token}`;
    const task = queue.then(async () => {
      await initialize();
      await fs.mkdir(root, { recursive: false, mode: 0o700 });
      let leaseRefresh = Promise.resolve();
      let leaseRefreshError = null;
      const refreshLease = typeof request.refreshLease === 'function'
        ? () => {
            leaseRefresh = leaseRefresh
              .then(() => request.refreshLease())
              .catch((error) => { leaseRefreshError = error; });
            return leaseRefresh;
          }
        : null;
      let leaseTimer = null;
      try {
        if (refreshLease) {
          await refreshLease();
          if (leaseRefreshError) throw new LocalPreviewError('LOCAL_PREVIEW_STABLE_READ_LOST', 'Не удалось зафиксировать стабильный снимок данных.', { status: 409, cause: leaseRefreshError });
          leaseTimer = setInterval(() => { void refreshLease(); }, 5_000);
          leaseTimer.unref?.();
        }
        await prepareWorkspace(workspace);
        const selected = await enableRecord(workspace, collection, slug);
        await buildRunner({
          workspace,
          repoRoot,
          environment: {
            ...createSafeNodeChildEnvironment(sourceEnvironment),
            NODE_ENV: 'production',
            DEPLOY_TARGET: 'test',
            TEST_SITE_URL: origin,
            BASE_PATH: basePath,
            ADMIN_LOCAL_PREVIEW: 'true',
            CI: 'false',
            REQUIRE_SITE_URL: 'false',
            PRODUCTION_DEPLOY_ENABLED: 'false',
            ASTRO_TELEMETRY_DISABLED: '1'
          }
        });
        if (refreshLease) await refreshLease();
        if (leaseRefreshError) {
          throw new LocalPreviewError('LOCAL_PREVIEW_STABLE_READ_LOST', 'Стабильное чтение данных прервано. Соберите preview заново.', { status: 409, cause: leaseRefreshError });
        }
        const routeFile = path.join(workspace, 'dist', selected.route.replace(/^\/+|\/+$/gu, ''), 'index.html');
        const normalizedRouteFile = selected.route === '/' ? path.join(workspace, 'dist', 'index.html') : routeFile;
        await fs.access(normalizedRouteFile);
        await fs.rename(path.join(workspace, 'dist'), path.join(root, 'dist'));
        const metadata = {
          version: 1, token, ownerHash: ownerHash(request.owner), collection, slug,
          revision: String(request.revision || ''), route: selected.route,
          createdAt, expiresAt: createdAt + ttlMs, basePath
        };
        await writeJson(path.join(root, 'metadata.json'), metadata);
        await fs.rm(workspace, { recursive: true, force: true });
        await cleanupExpired();
        return Object.freeze({
          token, route: selected.route, expiresAt: metadata.expiresAt,
          url: `${origin}${basePath}${selected.route.replace(/^\//u, '/')}`,
          exactSavedRevision: metadata.revision,
          analyticsDisabled: true
        });
      } catch (error) {
        await removeToken(token).catch(() => {});
        if (error instanceof LocalPreviewError) throw error;
        throw new LocalPreviewError('LOCAL_PREVIEW_BUILD_FAILED', 'Точная локальная сборка не прошла. Сохранённые данные не изменены.', { status: 422, cause: error, details: { message: String(error?.message || error).slice(0, 2000) } });
      } finally {
        if (leaseTimer) clearInterval(leaseTimer);
        await leaseRefresh;
      }
    });
    queue = task.catch(() => {});
    return task;
  }

  async function resolveAsset({ token: rawToken, relativePath = '', owner } = {}) {
    const token = safeToken(rawToken);
    const metadata = await metadataFor(token);
    if (metadata.expiresAt <= now()) {
      await removeToken(token);
      throw new LocalPreviewError('LOCAL_PREVIEW_EXPIRED', 'Локальный preview истёк. Соберите его заново.', { status: 410 });
    }
    if (metadata.ownerHash !== ownerHash(owner)) throw new LocalPreviewError('LOCAL_PREVIEW_FORBIDDEN', 'Этот preview принадлежит другой сессии.', { status: 403 });
    let decoded;
    try { decoded = decodeURIComponent(String(relativePath || '')).replace(/\\/gu, '/'); }
    catch { throw new LocalPreviewError('LOCAL_PREVIEW_PATH_INVALID', 'Некорректный путь preview.', { status: 404 }); }
    if (decoded.includes('\0') || decoded.split('/').some((part) => part === '..')) throw new LocalPreviewError('LOCAL_PREVIEW_PATH_INVALID', 'Некорректный путь preview.', { status: 404 });
    const clean = decoded.replace(/^\/+|\/+$/gu, '');
    const distRoot = path.join(tokenRoot(token), 'dist');
    const candidate = path.join(distRoot, clean || 'index.html');
    const htmlCandidate = clean && !path.extname(clean) ? path.join(candidate, 'index.html') : candidate;
    if (!contained(distRoot, htmlCandidate)) throw new LocalPreviewError('LOCAL_PREVIEW_PATH_ESCAPE', 'Путь preview вышел за dist.', { status: 404 });
    let filePath = htmlCandidate;
    try { await fs.access(filePath); }
    catch {
      const publicRoot = path.join(repoRoot, 'public');
      filePath = path.join(publicRoot, clean);
      if (!clean || !contained(publicRoot, filePath)) throw new LocalPreviewError('LOCAL_PREVIEW_ASSET_NOT_FOUND', 'Файл preview не найден.', { status: 404 });
    }
    const stat = await fs.lstat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new LocalPreviewError('LOCAL_PREVIEW_ASSET_NOT_FOUND', 'Файл preview не найден.', { status: 404 });
    return Object.freeze({ bytes: await fs.readFile(filePath), contentType: contentType(filePath), metadata });
  }

  return Object.freeze({ initialize, build, resolveAsset, cleanupExpired, runtimeDir });
}

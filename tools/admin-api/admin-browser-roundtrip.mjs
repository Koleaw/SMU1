import crypto from 'node:crypto';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolveAstroCli } from './astro-cli.mjs';
import { hashPassword } from './security.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const optionValue = (name) => argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const options = {
  help: hasFlag('--help') || hasFlag('-h'),
  headful: hasFlag('--headful'),
  json: hasFlag('--json'),
  productSlug: optionValue('--product') || 'skamya-smu1-bazovaya'
};

if (options.help) {
  process.stdout.write('Isolated browser round-trip for unified /admin\n\n');
  process.stdout.write('  npm run qa:admin-browser\n');
  process.stdout.write('  node tools/admin-api/admin-browser-roundtrip.mjs --product=skamya-smu1-bazovaya\n\n');
  process.stdout.write('Options: --headful, --json, --product=<standard-product-slug>, CHROME_PATH=<path>.\n');
  process.stdout.write('The gate starts one Chromium, one minimal Astro server and one isolated test-mode admin API.\n');
  process.stdout.write('All writable content, data, uploads, runtime state and browser data stay outside the repository.\n');
  process.stdout.write('The complete publish namespace is intercepted and cannot reach git or a remote.\n');
  process.exit(0);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checks = [];
const failures = [];
const record = (id, ok, details = {}) => {
  const row = { id, ...details, status: ok ? 'pass' : 'fail' };
  checks.push(row);
  if (!ok) failures.push(row);
  return ok;
};
const requireCheck = (id, ok, details = {}) => {
  record(id, ok, details);
  if (!ok) throw new Error(`${id} failed: ${JSON.stringify(details)}`);
};
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const exists = async (filename) => Boolean(await stat(filename).catch(() => null));
const mediaPath = (item) => typeof item === 'string' ? item : item?.src || item?.image || item?.url || '';

async function walkFiles(directory) {
  const info = await stat(directory).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return [directory];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function digestPaths(paths) {
  const entries = [];
  for (const target of paths) {
    for (const filename of await walkFiles(target)) {
      entries.push([
        path.relative(root, filename).replaceAll('\\', '/'),
        sha256(await readFile(filename))
      ]);
    }
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return sha256(JSON.stringify(entries));
}

async function gitSafetyState() {
  const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true })).stdout.trim();
  const indexValue = (await execFileAsync('git', ['rev-parse', '--git-path', 'index'], { cwd: root, windowsHide: true })).stdout.trim();
  const indexPath = path.isAbsolute(indexValue) ? indexValue : path.resolve(root, indexValue);
  const indexHash = await exists(indexPath) ? sha256(await readFile(indexPath)) : '';
  const protectedHash = await digestPaths([
    path.join(root, 'src', 'content'),
    path.join(root, 'src', 'data'),
    path.join(root, 'public', 'assets'),
    path.join(root, 'public', 'uploads')
  ]);
  return { head, indexHash, protectedHash };
}

async function freePort(used) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const server = createServer();
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    await new Promise((resolve) => server.close(resolve));
    if (!used.has(port)) {
      used.add(port);
      return port;
    }
  }
  throw new Error('Could not reserve local ports for the admin browser gate.');
}

function safeChildEnvironment(extra = {}) {
  const allowed = [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'SystemDrive',
    'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'TERM'
  ];
  const environment = {};
  for (const key of allowed) {
    if (typeof process.env[key] === 'string' && process.env[key]) environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}

function startChild(label, command, args, config) {
  const child = spawn(command, args, {
    ...config,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let logs = '';
  const append = (chunk) => { logs = `${logs}${chunk.toString()}`.slice(-100_000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  return { label, child, logs: () => logs };
}

async function stopChild(handle) {
  if (!handle?.child || handle.child.exitCode !== null) return;
  const child = handle.child;
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 8_000
    }).catch(() => {});
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(2_000)
    ]);
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(4_000)
  ]);
  if (child.exitCode !== null) return;
  child.kill('SIGKILL');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2_000)
  ]);
}

async function waitForHttp(url, handle, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle?.child?.exitCode !== null) {
      throw new Error(`${label} exited early (${handle.child.exitCode}).\n${handle.logs()}`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return response;
    } catch {}
    await delay(120);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms.\n${handle?.logs?.() || ''}`);
}

async function readRequestBody(request, limit = 96 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error(`Proxy request exceeded ${limit} bytes.`);
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function corsHeaders(siteOrigin, extra = {}) {
  return {
    'access-control-allow-origin': siteOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'Content-Type, X-Admin-CSRF, X-Admin-Recovery-Client-Id, X-Admin-Session-Fingerprint, X-Admin-Idempotency-Key',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    vary: 'Origin',
    ...extra
  };
}

async function startSafetyProxy({ backendOrigin, siteOrigin, port, stats }) {
  const server = createServer(async (request, response) => {
    try {
      const incoming = new URL(request.url || '/', `http://127.0.0.1:${port}`);
      const method = String(request.method || 'GET').toUpperCase();
      const row = {
        index: stats.requests.length,
        method,
        pathname: incoming.pathname,
        hasCsrf: Boolean(request.headers['x-admin-csrf']),
        origin: String(request.headers.origin || '')
      };
      stats.requests.push(row);

      if (incoming.pathname.startsWith('/api/admin/publish')) {
        stats.publishRequests.push(row);
        if (method === 'OPTIONS') {
          response.writeHead(204, corsHeaders(siteOrigin)).end();
          return;
        }
        if (method === 'GET' && incoming.pathname === '/api/admin/publish/status') {
          const body = Buffer.from(JSON.stringify({
            transactions: [],
            activeJob: null,
            latestJob: null,
            previewUrl: `${siteOrigin}/qa-preview/`,
            lastSuccessfulPreviewSHA: null,
            updatedAt: new Date(0).toISOString(),
            qaIntercepted: true
          }));
          response.writeHead(200, corsHeaders(siteOrigin, {
            'content-type': 'application/json; charset=utf-8',
            'content-length': String(body.length),
            'cache-control': 'no-store',
            'x-admin-qa-publish-intercept': 'read-only-status'
          })).end(body);
          return;
        }
        const body = Buffer.from(JSON.stringify({
          error: 'Publish is disabled by the isolated admin browser gate.',
          code: 'QA_PUBLISH_INTERCEPTED'
        }));
        response.writeHead(409, corsHeaders(siteOrigin, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(body.length),
          'cache-control': 'no-store',
          'x-admin-qa-publish-intercept': 'blocked'
        })).end(body);
        return;
      }

      const body = ['GET', 'HEAD'].includes(method) ? undefined : await readRequestBody(request);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined || ['host', 'connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const target = new URL(`${incoming.pathname}${incoming.search}`, backendOrigin);
      const backendResponse = await fetch(target, { method, headers, body, redirect: 'manual' });
      const responseBody = Buffer.from(await backendResponse.arrayBuffer());
      const responseHeaders = {};
      backendResponse.headers.forEach((value, key) => {
        if (!['connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) responseHeaders[key] = value;
      });
      responseHeaders['content-length'] = String(responseBody.length);
      responseHeaders['cache-control'] = 'no-store';
      responseHeaders['x-admin-qa-proxy'] = 'isolated';
      response.writeHead(backendResponse.status, responseHeaders).end(method === 'HEAD' ? undefined : responseBody);
      row.status = backendResponse.status;
      stats.forwarded.push(row);

      if (/^\/api\/admin\/content\/products(?:\/|$)/u.test(incoming.pathname)
        && ['POST', 'PUT', 'DELETE'].includes(method)) stats.contentWrites.push(row);
      if (/^\/api\/admin\/media\/staging\/[A-Za-z0-9_-]+\/renew$/u.test(incoming.pathname)
        && method === 'POST') stats.stagingRenew.push(row);
    } catch (error) {
      const body = Buffer.from(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      response.writeHead(502, corsHeaders(siteOrigin, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(body.length)
      })).end(body);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    delay(3_000)
  ]);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('CDP connection closed.'));
      }
      this.pending.clear();
    }, { once: true });
  }

  send(method, params = {}, timeoutMs = 25_000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), listener]);
  }

  close() {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

async function waitForDebugger(port, browser) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = response.ok ? await response.json() : [];
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(120);
  }
  throw new Error(`Chromium DevTools endpoint did not start within 30 seconds (launcher exit: ${browser.exitCode}).`);
}

async function copyIfPresent(source, destination) {
  if (!await exists(source)) return false;
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  return true;
}

async function prepareSandbox(tempRoot, sourceProduct) {
  const sandbox = path.join(tempRoot, 'sandbox');
  const contentRoot = path.join(tempRoot, 'isolated-content');
  await Promise.all([mkdir(sandbox, { recursive: true }), mkdir(contentRoot, { recursive: true })]);

  for (const filename of ['package.json', 'tsconfig.json', 'src/content-schemas.mjs', 'src/utils/withBase.ts', 'src/utils/projectMedia.mjs']) {
    await copyIfPresent(path.join(root, filename), path.join(sandbox, filename));
  }
  await Promise.all([
    cp(path.join(root, 'src', 'admin'), path.join(sandbox, 'src', 'admin'), { recursive: true }),
    cp(path.join(root, 'src', 'pages', 'admin'), path.join(sandbox, 'src', 'pages', 'admin'), { recursive: true }),
    cp(path.join(root, 'tools', 'admin-api'), path.join(sandbox, 'tools', 'admin-api'), { recursive: true })
  ]);
  await copyIfPresent(
    path.join(root, 'public', 'assets', 'brand', 'favicon.svg'),
    path.join(sandbox, 'public', 'assets', 'brand', 'favicon.svg')
  );

  await writeFile(path.join(sandbox, 'astro.config.mjs'), `import { defineConfig } from 'astro/config';

const adminApiProxyTarget = process.env.ADMIN_API_PROXY_TARGET || 'http://127.0.0.1:8787';

export default defineConfig({
  site: process.env.TEST_SITE_URL || 'http://127.0.0.1:4321',
  base: '/',
  output: 'static',
  devToolbar: { enabled: false },
  vite: {
    server: {
      fs: { allow: [${JSON.stringify(sandbox)}, ${JSON.stringify(path.join(root, 'node_modules'))}] },
      proxy: { '/api/admin': { target: adminApiProxyTarget, changeOrigin: true } }
    }
  }
});
`, 'utf8');

  await symlink(
    path.join(root, 'node_modules'),
    path.join(sandbox, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  const collections = ['jobs', 'product-categories', 'product-sections', 'products', 'projects', 'services', 'site-settings', 'static-pages'];
  await Promise.all(collections.map((collection) => mkdir(path.join(contentRoot, collection), { recursive: true })));
  await Promise.all([
    mkdir(path.join(contentRoot, '.admin-data'), { recursive: true }),
    mkdir(path.join(contentRoot, 'public', 'uploads'), { recursive: true }),
    mkdir(path.join(contentRoot, '.admin-runtime'), { recursive: true }),
    mkdir(path.join(sandbox, 'src', 'data'), { recursive: true }),
    mkdir(path.join(sandbox, 'public'), { recursive: true })
  ]);
  await symlink(
    path.join(contentRoot, 'public', 'uploads'),
    path.join(sandbox, 'public', 'uploads'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  const categoryPath = path.join(root, 'src', 'content', 'product-categories', `${sourceProduct.productCategorySlug}.json`);
  const category = JSON.parse(await readFile(categoryPath, 'utf8'));
  const sectionPath = path.join(root, 'src', 'content', 'product-sections', `${category.parentSectionSlug}.json`);
  const productDestination = path.join(contentRoot, 'products', `${sourceProduct.slug}.json`);
  const records = [
    [path.join(root, 'src', 'content', 'products', `${sourceProduct.slug}.json`), productDestination],
    [categoryPath, path.join(contentRoot, 'product-categories', `${category.slug}.json`)],
    [sectionPath, path.join(contentRoot, 'product-sections', `${category.parentSectionSlug}.json`)],
    [path.join(root, 'src', 'content', 'site-settings', 'global.json'), path.join(contentRoot, 'site-settings', 'global.json')]
  ];
  for (const [source, destination] of records) await copyIfPresent(source, destination);

  const isolatedProduct = structuredClone(sourceProduct);
  if (!Array.isArray(isolatedProduct.gallery) || isolatedProduct.gallery.length < 2) {
    const productDirectory = path.join(root, 'src', 'content', 'products');
    for (const filename of await readdir(productDirectory)) {
      if (!filename.endsWith('.json')) continue;
      const candidate = JSON.parse(await readFile(path.join(productDirectory, filename), 'utf8'));
      if (Array.isArray(candidate.gallery) && candidate.gallery.length >= 2) {
        isolatedProduct.gallery = structuredClone(candidate.gallery.slice(0, 2));
        break;
      }
    }
  }
  if (!Array.isArray(isolatedProduct.gallery) || isolatedProduct.gallery.length < 2) {
    throw new Error('The isolated gallery QA fixture requires two existing media entries.');
  }
  await writeFile(productDestination, `${JSON.stringify(isolatedProduct, null, 2)}\n`, 'utf8');

  for (const name of ['navigation.json', 'yandex.json']) {
    const source = path.join(root, 'src', 'data', name);
    await copyIfPresent(source, path.join(sandbox, 'src', 'data', name));
    await copyIfPresent(source, path.join(contentRoot, '.admin-data', name));
  }

  const media = [isolatedProduct.image, ...isolatedProduct.gallery]
    .map((item) => typeof item === 'string' ? item : item?.src)
    .filter((item) => typeof item === 'string' && item.startsWith('/'));
  for (const mediaPath of media) {
    const source = path.resolve(path.join(root, 'public'), `.${mediaPath}`);
    const publicRoot = path.resolve(path.join(root, 'public'));
    if (source === publicRoot || !source.startsWith(`${publicRoot}${path.sep}`) || !await exists(source)) continue;
    await copyIfPresent(source, path.resolve(path.join(contentRoot, 'public'), `.${mediaPath}`));
  }

  return {
    sandbox,
    contentRoot,
    productFile: productDestination,
    initialGallery: structuredClone(isolatedProduct.gallery)
  };
}

function layoutExpression(label) {
  return `(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const selectors = ['.admin-topbar', '#adminMain', '.admin-editor', '.admin-editor__header', '.admin-editor__body', '.admin-mobile-actionbar', '#adminNavToggle', '#adminLogout'];
    const clipped = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.right > innerWidth + 1 || rect.left < -1 || rect.width > innerWidth + 1) {
          clipped.push({ selector, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) });
        }
      }
    }
    return {
      label: ${JSON.stringify(label)},
      innerWidth,
      innerHeight,
      devicePixelRatio,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      clipped,
      appVisible: !document.querySelector('#adminApp')?.hidden
    };
  })()`;
}

const productSourcePath = path.join(root, 'src', 'content', 'products', `${options.productSlug}.json`);
if (!await exists(productSourcePath)) throw new Error(`Product ${options.productSlug} was not found.`);
const sourceProduct = JSON.parse(await readFile(productSourcePath, 'utf8'));
if (sourceProduct.presentationType !== 'standard') {
  throw new Error(`Admin browser round-trip requires a standard source product; ${sourceProduct.slug} is ${sourceProduct.presentationType}.`);
}

const chromePath = chromeCandidates.find((candidate) => fsSync.existsSync(candidate));
if (!chromePath) throw new Error('Chrome/Edge was not found. Set CHROME_PATH to a local Chromium executable.');
if (typeof WebSocket !== 'function') throw new Error('This gate requires Node.js with global WebSocket support.');

const liveBefore = await gitSafetyState();
const defaultTempBase = process.platform === 'win32'
  ? path.join(path.parse(root).root, 'CodexTemp', 'smu1-admin-browser')
  : path.join(os.tmpdir(), 'smu1-admin-browser');
const tempBase = path.resolve(process.env.SMU1_ADMIN_QA_TEMP_ROOT || defaultTempBase);
const tempRelativeToRepo = path.relative(root, tempBase);
if (!tempRelativeToRepo.startsWith('..') && !path.isAbsolute(tempRelativeToRepo)) {
  throw new Error(`SMU1_ADMIN_QA_TEMP_ROOT must be outside the repository: ${tempBase}`);
}
if (process.platform === 'win32' && path.parse(tempBase).root.toLowerCase() !== path.parse(root).root.toLowerCase()) {
  throw new Error(`Admin browser QA temp must stay on the project drive: ${tempBase}`);
}
await mkdir(tempBase, { recursive: true });
const tempRoot = await mkdtemp(path.join(tempBase, 'admin-browser-roundtrip-'));
const processTempDir = path.join(tempRoot, 'process-temp');
await mkdir(processTempDir, { recursive: true });

let apiHandle = null;
let astroHandle = null;
let proxyServer = null;
let browserProcess = null;
let cdp = null;
let productFile = '';
let tempRemoved = false;
let isolatedProductChanged = false;
const runtimeErrors = [];
let runtimePhase = 'startup';
const proxyStats = { requests: [], forwarded: [], publishRequests: [], contentWrites: [], stagingRenew: [] };

try {
  const prepared = await prepareSandbox(tempRoot, sourceProduct);
  productFile = prepared.productFile;
  const isolatedBaselineHash = sha256(await readFile(productFile));
  const sandboxSeesGit = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: prepared.sandbox,
    windowsHide: true,
    env: safeChildEnvironment({ GIT_CEILING_DIRECTORIES: path.dirname(prepared.sandbox) })
  }).then(() => true, () => false);
  requireCheck('infrastructure.sandbox-outside-git', !sandboxSeesGit, { sandboxSeesGit });

  const usedPorts = new Set();
  const backendPort = await freePort(usedPorts);
  const proxyPort = await freePort(usedPorts);
  const sitePort = await freePort(usedPorts);
  const debugPort = await freePort(usedPorts);
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  const siteOrigin = `http://127.0.0.1:${sitePort}`;
  const credentials = { login: 'admin-browser-qa', password: `Qa-${crypto.randomBytes(24).toString('base64url')}` };
  const passwordHash = await hashPassword(credentials.password);
  const sessionSecret = crypto.randomBytes(48).toString('base64url');
  const canonicalSandbox = process.platform === 'win32'
    ? path.normalize(path.resolve(prepared.sandbox)).toLocaleLowerCase('en-US')
    : path.normalize(path.resolve(prepared.sandbox));
  const repoIdentity = sha256(`smu1-admin-repo-v1\0${canonicalSandbox}`);

  const envFile = [
    '# Isolated admin browser gate. This directory is deleted after the run.',
    `ADMIN_USERNAME=${credentials.login}`,
    `ADMIN_PASSWORD_HASH=${passwordHash}`,
    `SESSION_SECRET=${sessionSecret}`,
    'ADMIN_API_HOST=127.0.0.1',
    `ADMIN_API_PORT=${backendPort}`,
    'ADMIN_UI_HOST=127.0.0.1',
    `ADMIN_UI_PORT=${sitePort}`,
    `ADMIN_ALLOWED_ORIGINS=${siteOrigin}`,
    `PUBLIC_ADMIN_API_BASE=${proxyOrigin}/api/admin`,
    'CONTENT_WRITE_MODE=local',
    'ADMIN_TEST_MODE=false',
    'PRODUCTION_DEPLOY_ENABLED=false',
    'ADMIN_ALLOW_PRODUCTION_PUBLISH=false',
    ''
  ].join('\n');
  await writeFile(path.join(prepared.sandbox, '.env.admin.local'), envFile, { encoding: 'utf8', mode: 0o600 });
  await chmod(path.join(prepared.sandbox, '.env.admin.local'), 0o600).catch(() => {});

  apiHandle = startChild('isolated admin API', process.execPath, ['tools/admin-api/server.mjs'], {
    cwd: prepared.sandbox,
    env: safeChildEnvironment({
      NODE_ENV: 'test',
      ADMIN_API_HOST: '127.0.0.1',
      ADMIN_API_PORT: String(backendPort),
      ADMIN_UI_HOST: '127.0.0.1',
      ADMIN_UI_PORT: String(sitePort),
      ADMIN_ALLOWED_ORIGINS: siteOrigin,
      PUBLIC_ADMIN_API_BASE: `${proxyOrigin}/api/admin`,
      ADMIN_TEST_MODE: 'true',
      ADMIN_TEST_CONTENT_ROOT: prepared.contentRoot,
      ADMIN_USERNAME: credentials.login,
      ADMIN_PASSWORD: credentials.password,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: sessionSecret,
      CONTENT_WRITE_MODE: 'local',
      ADMIN_GIT_REMOTE: 'qa-disabled',
      PRODUCTION_DEPLOY_ENABLED: 'false',
      ADMIN_ALLOW_PRODUCTION_PUBLISH: 'false',
      SITE_URL: '',
      TEST_SITE_URL: siteOrigin,
      GIT_CEILING_DIRECTORIES: path.dirname(prepared.sandbox),
      TEMP: processTempDir,
      TMP: processTempDir
    })
  });
  const health = await waitForHttp(`${backendOrigin}/api/admin/health`, apiHandle, 'isolated admin API', 25_000);
  const healthPayload = await health.json().catch(() => null);
  requireCheck('infrastructure.api-health-identity', health.ok
    && healthPayload?.kind === 'smu1-admin-runtime'
    && healthPayload?.service === 'api'
    && healthPayload?.repoIdentity === repoIdentity, { status: health.status, healthPayload, repoIdentity });

  proxyServer = await startSafetyProxy({ backendOrigin, siteOrigin, port: proxyPort, stats: proxyStats });
  const proxyReady = await fetch(`${proxyOrigin}/api/admin/health`);
  requireCheck('infrastructure.proxy', proxyReady.ok
    && proxyStats.forwarded.some((item) => item.pathname === '/api/admin/health' && item.status === 200), {
    status: proxyReady.status
  });

  const astroCli = await resolveAstroCli(prepared.sandbox);
  astroHandle = startChild('minimal Astro admin server', process.execPath, [
    astroCli,
    'dev', '--host', '127.0.0.1', '--port', String(sitePort)
  ], {
    cwd: prepared.sandbox,
    env: safeChildEnvironment({
      NODE_ENV: 'development',
      ASTRO_TELEMETRY_DISABLED: '1',
      ADMIN_API_PROXY_TARGET: proxyOrigin,
      PUBLIC_ADMIN_API_BASE: `${proxyOrigin}/api/admin`,
      PUBLIC_ADMIN_HEALTH_MARKER: `smu1-admin-runtime:v1:ui:${repoIdentity}`,
      TEST_SITE_URL: siteOrigin,
      BASE_PATH: '/',
      DEPLOY_TARGET: 'development',
      SMU1_LOCAL_ADMIN: 'true',
      TEMP: processTempDir,
      TMP: processTempDir
    })
  });
  await waitForHttp(`${siteOrigin}/admin/`, astroHandle, 'minimal Astro admin server', 45_000);

  const profileDir = path.join(tempRoot, 'chromium-profile');
  await mkdir(profileDir, { recursive: true });
  browserProcess = spawn(chromePath, [
    options.headful ? '--new-window' : '--headless=new',
    '--disable-background-networking',
    '--disable-component-extensions-with-background-pages',
    '--disable-component-update',
    '--disable-crash-reporter',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-service-autorun',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    `--disk-cache-dir=${path.join(profileDir, 'cache')}`,
    '--window-size=1440,900',
    'about:blank'
  ], {
    stdio: 'ignore',
    windowsHide: true,
    env: safeChildEnvironment({ TEMP: processTempDir, TMP: processTempDir })
  });

  const websocketUrl = await waitForDebugger(debugPort, browserProcess);
  cdp = new CdpClient(websocketUrl);
  await cdp.connect();
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    runtimeErrors.push({ type: 'exception', message: exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception' });
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error' || type === 'assert') {
      runtimeErrors.push({ type: `console.${type}`, message: args?.map((item) => item.value || item.description || '').join(' ') || type });
    }
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry?.level === 'error') runtimeErrors.push({
      type: 'log.error',
      message: entry.text || entry.url || 'Browser log error',
      url: entry.url || '',
      source: entry.source || '',
      phase: runtimePhase
    });
  });
  cdp.on('Page.javascriptDialogOpening', () => {
    void cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable'),
    cdp.send('Log.enable')
  ]);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1440, screenHeight: 900
  });

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed.');
    }
    return result.result?.value;
  };
  const waitForCondition = async (expression, timeoutMs = 20_000, intervalMs = 60) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (await evaluate(expression)) return true; } catch {}
      await delay(intervalMs);
    }
    return false;
  };
  const settle = async (milliseconds = 100) => evaluate(`(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, ${milliseconds}));
    return document.readyState;
  })()`);
  const navigate = async (url) => {
    const result = await cdp.send('Page.navigate', { url });
    if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
    const ready = await waitForCondition(`location.href.startsWith(${JSON.stringify(url.split('?')[0])}) && document.readyState === 'complete'`, 30_000);
    if (!ready) throw new Error(`Navigation readiness timed out for ${url}.`);
    await settle(160);
  };
  const fieldState = (fieldPath) => evaluate(`(() => {
    const shell = document.querySelector('[data-field-path=${JSON.stringify(fieldPath)}]');
    const control = shell?.querySelector('input,select,textarea');
    return {
      exists: Boolean(shell && control),
      hidden: Boolean(shell?.hidden),
      type: control?.type || control?.tagName?.toLowerCase() || '',
      value: control?.type === 'checkbox' ? control.checked : control?.value,
      disabled: Boolean(control?.disabled)
    };
  })()`);
  const setField = async (fieldPath, value) => {
    const available = await waitForCondition(`Boolean(document.querySelector('[data-field-path=${JSON.stringify(fieldPath)}] input, [data-field-path=${JSON.stringify(fieldPath)}] select, [data-field-path=${JSON.stringify(fieldPath)}] textarea'))`, 10_000);
    if (!available) throw new Error(`Admin field ${fieldPath} was not rendered.`);
    const changed = await evaluate(`(() => {
      const control = document.querySelector('[data-field-path=${JSON.stringify(fieldPath)}] input, [data-field-path=${JSON.stringify(fieldPath)}] select, [data-field-path=${JSON.stringify(fieldPath)}] textarea');
      if (!control) return false;
      if (control.type === 'checkbox') control.checked = Boolean(${JSON.stringify(value)});
      else control.value = ${JSON.stringify(value)};
      control.dispatchEvent(new Event(control.tagName === 'SELECT' || control.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
      return true;
    })()`);
    if (!changed) throw new Error(`Admin field ${fieldPath} could not be changed.`);
    await settle(60);
  };
  const clickSave = async () => {
    const enabled = await waitForCondition(`(() => {
      const button = document.querySelector('.admin-editor__actions .admin-btn--primary');
      return Boolean(button && !button.disabled);
    })()`, 10_000);
    if (!enabled) {
      const diagnostic = await evaluate(`(() => {
        const button = document.querySelector('.admin-editor__actions .admin-btn--primary');
        const alert = document.querySelector('.admin-editor__body > .admin-alert');
        return {
          buttonExists: Boolean(button),
          disabled: Boolean(button?.disabled),
          alertText: alert?.textContent?.trim() || '',
          fieldValues: Object.fromEntries(['title', 'productCategorySlug', 'presentationType', 'shortDescription', 'leadText', 'image', 'priceMode', 'priceFrom', 'currency', 'isActive', 'showInCatalog']
            .map((field) => {
              const control = document.querySelector('[data-field-path="' + field + '"] input, [data-field-path="' + field + '"] select, [data-field-path="' + field + '"] textarea');
              return [field, control?.type === 'checkbox' ? control.checked : control?.value];
            }))
        };
      })()`);
      throw new Error(`Desktop save button did not become enabled: ${JSON.stringify(diagnostic)}`);
    }
    await evaluate(`document.querySelector('.admin-editor__actions .admin-btn--primary').click()`);
  };
  const waitForProductWrite = async (startIndex, timeoutMs = 12_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const writes = proxyStats.contentWrites.slice(startIndex);
      if (writes.some((item) => item.method === 'PUT' && item.status === 200)) return writes;
      await delay(50);
    }
    return proxyStats.contentWrites.slice(startIndex);
  };
  const waitForSaveSettled = () => waitForCondition(`(() => {
    const save = document.querySelector('.admin-editor__actions .admin-btn--primary');
    const badge = document.querySelector('.admin-editor__meta .admin-badge');
    return Boolean(save && !save.disabled && badge?.classList.contains('admin-badge--success'));
  })()`, 20_000);
  const assertNoPublishMutation = (id, startIndex) => {
    const during = proxyStats.publishRequests.slice(startIndex);
    const mutations = during.filter((item) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(item.method));
    requireCheck(id, mutations.length === 0, { requests: during, mutations });
    record(`${id}.readonly-observation-only`, during.every((item) => ['GET', 'OPTIONS'].includes(item.method)
      && item.pathname === '/api/admin/publish/status'), { requests: during });
  };

  const editorUrl = `${siteOrigin}/admin/all-materials/?view=catalog&collection=products&slug=${encodeURIComponent(sourceProduct.slug)}`;
  await navigate(editorUrl);
  requireCheck('admin.login-screen', await waitForCondition(`!document.querySelector('#adminLogin')?.hidden && document.querySelector('#adminApp')?.hidden === true`, 12_000), {});

  const wrongLoginStart = proxyStats.requests.length;
  runtimePhase = 'wrong-login';
  await evaluate(`(() => {
    document.querySelector('#adminLoginName').value = ${JSON.stringify(credentials.login)};
    document.querySelector('#adminLoginPassword').value = 'definitely-wrong';
    document.querySelector('#adminLoginForm').requestSubmit();
  })()`);
  const wrongRejected = await waitForCondition(`(() => {
    const status = document.querySelector('#adminLoginStatus')?.textContent?.trim() || '';
    return status.length > 0 && !document.querySelector('#adminLoginSubmit')?.disabled && document.querySelector('#adminApp')?.hidden === true;
  })()`, 12_000);
  const wrongRequest = proxyStats.requests.slice(wrongLoginStart).find((item) => item.pathname === '/api/admin/login' && item.method === 'POST');
  requireCheck('admin.login-wrong-rejected', wrongRejected && wrongRequest?.status === 401, { wrongRejected, wrongRequest });
  runtimePhase = 'authenticated-editor';

  await evaluate(`(() => {
    document.querySelector('#adminLoginName').value = ${JSON.stringify(credentials.login)};
    document.querySelector('#adminLoginPassword').value = ${JSON.stringify(credentials.password)};
    document.querySelector('#adminLoginForm').requestSubmit();
  })()`);
  const editorReady = await waitForCondition(`(() => {
    const presentation = document.querySelector('[data-field-path="presentationType"] select');
    return !document.querySelector('#adminApp')?.hidden && document.querySelector('#adminLogin')?.hidden === true && presentation?.value === 'standard';
  })()`, 35_000);
  requireCheck('admin.login-right-and-editor-load', editorReady, { product: sourceProduct.slug });
  const readCategoryFixtureState = async () => {
    const result = await evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(`${proxyOrigin}/api/admin/content/product-categories`)}, { credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      const select = document.querySelector('[data-field-path="productCategorySlug"] select');
      return {
        status: response.status,
        entries: (payload.entries || []).map((entry) => ({ slug: entry.slug, isActive: entry.isActive })),
        selectExists: Boolean(select),
        selected: select?.value || '',
        optionValues: Array.from(select?.options || []).map((option) => option.value)
      };
    })()`);
    result.bootstrapRequests = proxyStats.forwarded
      .filter((item) => item.pathname === '/api/admin/content/product-categories')
      .map(({ method, status }) => ({ method, status }));
    return result;
  };
  const categoryFixtureReady = (value) => value.status === 200
    && value.entries.some((entry) => entry.slug === sourceProduct.productCategorySlug && entry.isActive === true)
    && value.selected === sourceProduct.productCategorySlug;
  const categoryFixtureState = await readCategoryFixtureState();
  requireCheck('infrastructure.product-category-relation-fixture-first-bootstrap', categoryFixtureReady(categoryFixtureState), categoryFixtureState);

  const standardMarker = `QA standard ${crypto.randomUUID()}`;
  await setField('shortDescription', standardMarker);
  requireCheck('admin.standard-dirty', await waitForCondition(`document.querySelector('.admin-editor__meta .admin-badge')?.classList.contains('admin-badge--warning')`, 8_000), {});
  const standardPublishStart = proxyStats.publishRequests.length;
  const standardWritesStart = proxyStats.contentWrites.length;
  await clickSave();
  const standardPersisted = await (async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const saved = JSON.parse(await readFile(productFile, 'utf8'));
      if (saved.shortDescription === standardMarker && saved.presentationType === 'standard') return saved;
      await delay(100);
    }
    return null;
  })();
  const standardWrites = await waitForProductWrite(standardWritesStart);
  requireCheck('admin.save-standard-persistence', Boolean(standardPersisted)
    && standardWrites.some((item) => item.method === 'PUT' && item.status === 200), {
    saved: standardPersisted && { presentationType: standardPersisted.presentationType, shortDescription: standardPersisted.shortDescription },
    writes: standardWrites
  });
  requireCheck('admin.save-standard-ui-settled', await waitForSaveSettled(), {});
  assertNoPublishMutation('admin.save-standard-zero-publish-side-effects', standardPublishStart);

  const premiumMarker = `QA premium ${crypto.randomUUID()}`;
  await setField('presentationType', 'premium');
  await setField('solutionKicker', premiumMarker);
  await setField('applicationItems', 'QA application one\nQA application two');
  await setField('executionVariants', 'QA execution one\nQA execution two');
  const premiumVisible = await waitForCondition(`(() => {
    const first = document.querySelector('[data-field-path="applicationItems"]');
    const second = document.querySelector('[data-field-path="executionVariants"]');
    return first && second && !first.hidden && !second.hidden;
  })()`, 10_000);
  requireCheck('admin.premium-fields-render', premiumVisible, {});
  const premiumPublishStart = proxyStats.publishRequests.length;
  const premiumWritesStart = proxyStats.contentWrites.length;
  await clickSave();
  const premiumPersisted = await (async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const saved = JSON.parse(await readFile(productFile, 'utf8'));
      if (saved.presentationType === 'premium' && saved.solutionKicker === premiumMarker) return saved;
      await delay(100);
    }
    return null;
  })();
  const premiumWrites = await waitForProductWrite(premiumWritesStart);
  requireCheck('admin.save-premium-persistence', Boolean(premiumPersisted)
    && JSON.stringify(premiumPersisted.applicationItems) === JSON.stringify(['QA application one', 'QA application two'])
    && JSON.stringify(premiumPersisted.executionVariants) === JSON.stringify(['QA execution one', 'QA execution two'])
    && premiumWrites.some((item) => item.method === 'PUT' && item.status === 200), {
    saved: premiumPersisted && { presentationType: premiumPersisted.presentationType, solutionKicker: premiumPersisted.solutionKicker },
    writes: premiumWrites
  });
  requireCheck('admin.save-premium-ui-settled', await waitForSaveSettled(), {});
  assertNoPublishMutation('admin.save-premium-zero-publish-side-effects', premiumPublishStart);

  const existingGalleryPaths = prepared.initialGallery.map(mediaPath).filter(Boolean);
  await evaluate(`document.querySelector('[data-field-path="gallery"] .admin-media-grid > button:last-child')?.click()`);
  const existingQueueReady = await waitForCondition(`document.querySelectorAll('#adminMediaBody > .admin-section-stack > article.admin-record-row').length === ${existingGalleryPaths.length}`, 12_000);
  const existingQueuePaths = await evaluate(`Array.from(document.querySelectorAll('#adminMediaBody > .admin-section-stack > article.admin-record-row img')).map((image) => image.getAttribute('src'))`);
  requireCheck('admin.gallery-existing-prepopulated', existingQueueReady
    && JSON.stringify(existingQueuePaths) === JSON.stringify(existingGalleryPaths), {
    expected: existingGalleryPaths,
    actual: existingQueuePaths
  });
  const galleryFileContract = await evaluate(`(() => {
    const input = document.querySelector('#adminMediaBody input[type="file"]');
    return { exists: Boolean(input), accept: input?.accept || '', multiple: Boolean(input?.multiple) };
  })()`);
  const galleryAcceptedExtensions = galleryFileContract.accept.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  requireCheck('admin.gallery-picker-image-only-multiple-contract', galleryFileContract.exists
    && galleryFileContract.multiple
    && ['.jpg', '.jpeg', '.png', '.webp'].every((extension) => galleryAcceptedExtensions.includes(extension))
    && !galleryAcceptedExtensions.some((extension) => ['.mp4', '.webm'].includes(extension)), galleryFileContract);

  const newGalleryFilename = `qa-gallery-${crypto.randomUUID()}.png`;
  const newQueued = await evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(sourceProduct.image)});
    if (!response.ok) throw new Error('Could not load the isolated source image for gallery QA.');
    const sourceBlob = await response.blob();
    const input = document.querySelector('#adminMediaBody input[type="file"]');
    if (!input) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([sourceBlob], ${JSON.stringify(newGalleryFilename)}, { type: sourceBlob.type || 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const combinedQueueReady = await waitForCondition(`(() => {
    const rows = Array.from(document.querySelectorAll('#adminMediaBody > .admin-section-stack > article.admin-record-row'));
    return rows.length === ${existingGalleryPaths.length + 1} && rows.some((row) => row.querySelector('strong')?.textContent?.includes(${JSON.stringify(newGalleryFilename)}));
  })()`, 12_000);
  requireCheck('admin.gallery-existing-plus-new-one-queue', newQueued && combinedQueueReady, {
    expectedCount: existingGalleryPaths.length + 1
  });

  const movedNewToStart = await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('#adminMediaBody > .admin-section-stack > article.admin-record-row'));
    const row = rows.find((candidate) => candidate.querySelector('strong')?.textContent?.includes(${JSON.stringify(newGalleryFilename)}));
    const actions = Array.from(row?.querySelectorAll('.admin-list-editor__actions button') || []);
    const moveToStart = actions.at(-5);
    if (!moveToStart || moveToStart.disabled) return false;
    moveToStart.click();
    return true;
  })()`);
  const visibleQueueOrder = await (async () => {
    const moved = await waitForCondition(`document.querySelector('#adminMediaBody > .admin-section-stack > article.admin-record-row:first-child strong')?.textContent?.includes(${JSON.stringify(newGalleryFilename)})`, 8_000);
    if (!moved) return [];
    return evaluate(`Array.from(document.querySelectorAll('#adminMediaBody > .admin-section-stack > article.admin-record-row strong')).map((node) => node.textContent)`);
  })();
  requireCheck('admin.gallery-visible-queue-reordered', movedNewToStart
    && visibleQueueOrder.length === existingGalleryPaths.length + 1
    && visibleQueueOrder[0].includes(newGalleryFilename), { visibleQueueOrder });

  const galleryPublishStart = proxyStats.publishRequests.length;
  const galleryWritesStart = proxyStats.contentWrites.length;
  runtimePhase = 'gallery-staging';
  await evaluate(`document.querySelector('#adminMediaConfirm')?.click()`);
  const galleryApplied = await waitForCondition(`(() => {
    if (document.querySelector('#adminMediaDialog')?.open) return false;
    let draft;
    try { draft = JSON.parse(document.querySelector('.admin-editor .admin-json-editor[aria-label]')?.textContent || '{}'); }
    catch { return false; }
    const paths = (draft.gallery || []).map((item) => typeof item === 'string' ? item : item?.src || item?.image || item?.url || '').filter(Boolean);
    return paths.length === ${existingGalleryPaths.length + 1}
      && paths[0]?.startsWith('/uploads/')
      && !${JSON.stringify(existingGalleryPaths)}.includes(paths[0])
      && JSON.stringify(paths.slice(1)) === JSON.stringify(${JSON.stringify(existingGalleryPaths)});
  })()`, 35_000);
  const appliedGalleryPaths = await evaluate(`(() => {
    const draft = JSON.parse(document.querySelector('.admin-editor .admin-json-editor[aria-label]')?.textContent || '{}');
    return (draft.gallery || []).map((item) => typeof item === 'string' ? item : item?.src || item?.image || item?.url || '').filter(Boolean);
  })()`);
  const galleryDialogDiagnostic = await evaluate(`(() => ({
    dialogOpen: Boolean(document.querySelector('#adminMediaDialog')?.open),
    ariaBusy: document.querySelector('#adminMediaBody')?.getAttribute('aria-busy'),
    queue: Array.from(document.querySelectorAll('#adminMediaBody > .admin-section-stack > article.admin-record-row')).map((row) => ({
      name: row.querySelector('strong')?.textContent || '',
      status: row.querySelector('.admin-badge')?.textContent || ''
    })),
    toasts: Array.from(document.querySelectorAll('#adminToastRegion [role="status"], #adminToastRegion .admin-toast')).map((node) => node.textContent?.trim()).filter(Boolean)
  }))()`);
  requireCheck('admin.gallery-confirm-applies-exact-visible-order', galleryApplied, {
    visibleQueueOrder,
    appliedGalleryPaths,
    existingGalleryPaths,
    dialog: galleryDialogDiagnostic,
    mediaRequests: proxyStats.forwarded
      .filter((item) => item.pathname.startsWith('/api/admin/media/staging'))
      .map(({ method, pathname, status }) => ({ method, pathname, status }))
  });
  await clickSave();
  const galleryPersisted = await (async () => {
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      const saved = JSON.parse(await readFile(productFile, 'utf8'));
      const paths = (saved.gallery || []).map(mediaPath);
      if (JSON.stringify(paths) === JSON.stringify(appliedGalleryPaths)) return saved;
      await delay(120);
    }
    return null;
  })();
  const promotedGalleryFile = appliedGalleryPaths[0]
    ? path.join(prepared.contentRoot, 'public', ...appliedGalleryPaths[0].split('/').filter(Boolean))
    : '';
  const galleryWrites = await waitForProductWrite(galleryWritesStart);
  requireCheck('admin.gallery-order-and-new-media-persist', Boolean(galleryPersisted)
    && Boolean(promotedGalleryFile) && await exists(promotedGalleryFile)
    && galleryWrites.some((item) => item.method === 'PUT' && item.status === 200), {
    gallery: galleryPersisted?.gallery,
    promotedGalleryFile,
    writes: galleryWrites
  });
  requireCheck('admin.save-gallery-ui-settled', await waitForSaveSettled(), {});
  assertNoPublishMutation('admin.save-gallery-zero-publish-side-effects', galleryPublishStart);
  runtimePhase = 'authenticated-editor';

  const deployedControl = await evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('.admin-editor__actions > button'));
    const button = buttons[5];
    return { exists: Boolean(button), visible: Boolean(button && !button.hidden && getComputedStyle(button).display !== 'none'), buttonCount: buttons.length };
  })()`);
  requireCheck('admin.record-test-site-control-in-header', deployedControl.exists && deployedControl.visible, deployedControl);
  const unsavedSlug = `unsaved-${crypto.randomUUID()}`;
  await evaluate(`(() => {
    const input = document.querySelector('[data-field-path="slug"] input');
    if (!input) return false;
    input.disabled = false;
    input.value = ${JSON.stringify(unsavedSlug)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.__qaOpenedUrls = [];
    window.open = (url) => { window.__qaOpenedUrls.push(String(url)); return null; };
    return true;
  })()`);
  const slugDraftDirty = await waitForCondition(`document.querySelector('.admin-editor__meta .admin-badge')?.classList.contains('admin-badge--warning')`, 8_000);
  await evaluate(`document.querySelectorAll('.admin-editor__actions > button')[5]?.click()`);
  const deployedOpen = await waitForCondition(`Array.isArray(window.__qaOpenedUrls) && window.__qaOpenedUrls.length === 1`, 8_000);
  const deployedUrl = await evaluate(`window.__qaOpenedUrls?.[0] || ''`);
  requireCheck('admin.dirty-record-test-site-uses-last-saved-route', slugDraftDirty && deployedOpen
    && deployedUrl.startsWith(`${siteOrigin}/qa-preview/`)
    && deployedUrl.includes(`/${sourceProduct.slug}/`)
    && !deployedUrl.includes(unsavedSlug), { deployedUrl, unsavedSlug, savedSlug: sourceProduct.slug });
  const resetControl = await evaluate(`(() => {
    const button = document.querySelectorAll('.admin-editor__actions > button')[3];
    const state = { exists: Boolean(button), disabled: Boolean(button?.disabled), text: button?.textContent?.trim() || '' };
    button?.click();
    return state;
  })()`);
  const slugReset = await waitForCondition(`document.querySelector('.admin-editor__meta .admin-badge')?.classList.contains('admin-badge--success')`, 12_000);
  const slugResetDiagnostic = await evaluate(`(() => {
    const badge = document.querySelector('.admin-editor__meta .admin-badge');
    const input = document.querySelector('[data-field-path="slug"] input');
    let draft = {};
    try { draft = JSON.parse(document.querySelector('.admin-editor .admin-json-editor[aria-label]')?.textContent || '{}'); } catch {}
    return { badgeClass: badge?.className || '', badgeText: badge?.textContent?.trim() || '', inputSlug: input?.value || '', draftSlug: draft.slug || '' };
  })()`);
  requireCheck('admin.dirty-slug-reset-after-route-check', slugReset
    && slugResetDiagnostic.inputSlug === sourceProduct.slug
    && slugResetDiagnostic.draftSlug === sourceProduct.slug, { resetControl, ...slugResetDiagnostic });
  isolatedProductChanged = sha256(await readFile(productFile)) !== isolatedBaselineHash;

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1440, screenHeight: 900
  });
  await settle(120);
  const desktopLayout = await evaluate(layoutExpression('desktop-1440x900'));
  requireCheck('layout.desktop-1440x900', desktopLayout.appVisible
    && desktopLayout.documentScrollWidth <= desktopLayout.documentClientWidth + 1
    && desktopLayout.bodyScrollWidth <= desktopLayout.bodyClientWidth + 1
    && desktopLayout.clipped.length === 0, desktopLayout);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 720, height: 450, deviceScaleFactor: 2, mobile: false,
    screenWidth: 1440, screenHeight: 900, scale: 1
  });
  await settle(160);
  const zoomLayout = await evaluate(layoutExpression('desktop-200-percent-effective'));
  requireCheck('layout.desktop-200-percent-zoom', zoomLayout.appVisible
    && zoomLayout.documentScrollWidth <= zoomLayout.documentClientWidth + 1
    && zoomLayout.bodyScrollWidth <= zoomLayout.bodyClientWidth + 1
    && zoomLayout.clipped.length === 0, zoomLayout);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    screenWidth: 390, screenHeight: 844
  });
  await settle(180);
  const mobileLayout = await evaluate(layoutExpression('mobile-390x844-dpr2'));
  requireCheck('layout.mobile-390x844-dpr2', mobileLayout.appVisible
    && mobileLayout.documentScrollWidth <= mobileLayout.documentClientWidth + 1
    && mobileLayout.bodyScrollWidth <= mobileLayout.bodyClientWidth + 1
    && mobileLayout.clipped.length === 0, mobileLayout);

  const smallButtonHeights = await evaluate(`Array.from(document.querySelectorAll('.admin-btn--small'))
    .filter((button) => !button.hidden && getComputedStyle(button).display !== 'none' && button.getClientRects().length > 0)
    .map((button) => ({ height: button.getBoundingClientRect().height, label: button.getAttribute('aria-label') || button.textContent?.trim() || '' }))`);
  requireCheck('layout.mobile-small-buttons-minimum-44px', smallButtonHeights.length > 0
    && smallButtonHeights.every((button) => button.height >= 43.5), { buttons: smallButtonHeights });

  const dispatchKey = async (key, { code = key, windowsVirtualKeyCode = 0, modifiers = 0 } = {}) => {
    const text = key === 'Enter' ? '\r' : undefined;
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, modifiers,
      ...(text ? { text, unmodifiedText: text } : {})
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, modifiers });
  };
  await evaluate(`document.querySelector('#adminNavToggle')?.focus()`);
  await dispatchKey('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 });
  const drawerOpened = await waitForCondition(`(() => {
    const nav = document.querySelector('#adminNav');
    const active = document.activeElement;
    const expected = nav?.querySelector('[data-view][aria-current="page"]') || nav?.querySelector('[data-view]');
    return nav?.dataset.open === 'true'
      && document.querySelector('#adminNavToggle')?.getAttribute('aria-expanded') === 'true'
      && nav?.inert === false
      && nav?.getAttribute('aria-hidden') === 'false'
      && active === expected;
  })()`, 8_000);
  const openedDrawerState = await evaluate(`(() => ({
    open: document.querySelector('#adminNav')?.dataset.open,
    expanded: document.querySelector('#adminNavToggle')?.getAttribute('aria-expanded'),
    inert: document.querySelector('#adminNav')?.inert,
    ariaHidden: document.querySelector('#adminNav')?.getAttribute('aria-hidden'),
    activeView: document.activeElement?.dataset?.view || document.activeElement?.id || ''
  }))()`);
  requireCheck('layout.mobile-drawer-enter-focus', drawerOpened, openedDrawerState);

  await evaluate(`(() => {
    const nav = document.querySelector('#adminNav');
    const focusable = Array.from(nav.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getClientRects().length > 0);
    focusable.at(-1)?.focus();
  })()`);
  await dispatchKey('Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
  const forwardTrap = await evaluate(`(() => {
    const nav = document.querySelector('#adminNav');
    const focusable = Array.from(nav.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getClientRects().length > 0);
    return { trapped: document.activeElement === focusable[0], activeView: document.activeElement?.dataset?.view || '', count: focusable.length };
  })()`);
  await evaluate(`(() => {
    const nav = document.querySelector('#adminNav');
    const focusable = Array.from(nav.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getClientRects().length > 0);
    focusable[0]?.focus();
  })()`);
  await dispatchKey('Tab', { code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
  const backwardTrap = await evaluate(`(() => {
    const nav = document.querySelector('#adminNav');
    const focusable = Array.from(nav.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getClientRects().length > 0);
    return { trapped: document.activeElement === focusable.at(-1), activeView: document.activeElement?.dataset?.view || '', count: focusable.length };
  })()`);
  requireCheck('layout.mobile-drawer-tab-focus-trap', forwardTrap.trapped && backwardTrap.trapped
    && forwardTrap.count > 1 && backwardTrap.count === forwardTrap.count, { forwardTrap, backwardTrap });

  await dispatchKey('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  const drawerClosed = await waitForCondition(`(() => {
    const nav = document.querySelector('#adminNav');
    return nav?.dataset.open === 'false'
      && document.querySelector('#adminNavToggle')?.getAttribute('aria-expanded') === 'false'
      && nav?.inert === true
      && nav?.getAttribute('aria-hidden') === 'true'
      && document.activeElement === document.querySelector('#adminNavToggle');
  })()`, 8_000);
  const closedDrawerState = await evaluate(`(() => ({
    open: document.querySelector('#adminNav')?.dataset.open,
    expanded: document.querySelector('#adminNavToggle')?.getAttribute('aria-expanded'),
    inert: document.querySelector('#adminNav')?.inert,
    ariaHidden: document.querySelector('#adminNav')?.getAttribute('aria-hidden'),
    activeId: document.activeElement?.id || ''
  }))()`);
  requireCheck('layout.mobile-drawer-escape-restores-toggle', drawerClosed, closedDrawerState);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1440, screenHeight: 900
  });
  await settle(120);

  await evaluate(`document.querySelector('[data-view="settings"]')?.click()`);
  const dataToolsReady = await waitForCondition(`Boolean(document.querySelector('#adminJsonTools'))`, 20_000);
  const dataTools = await evaluate(`(() => {
    const visible = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    return {
      fullExport: visible('#adminJsonExportFullSite'),
      importFile: visible('#adminJsonImportFile'),
      importPreview: visible('#adminJsonImportPreview'),
      importApply: visible('#adminJsonImportApply'),
      importApplyInitiallyDisabled: Boolean(document.querySelector('#adminJsonImportApply')?.disabled)
    };
  })()`);
  requireCheck('admin.json-export-import-controls-visible', dataToolsReady
    && dataTools.fullExport && dataTools.importFile && dataTools.importPreview
    && dataTools.importApply && dataTools.importApplyInitiallyDisabled, dataTools);

  const stagingStart = proxyStats.requests.length;
  runtimePhase = 'staging-renew';
  const stagingContract = await evaluate(`(async () => {
    const { createAdminApiClient } = await import('/src/admin/core/api-client.mjs');
    const client = createAdminApiClient({ baseUrl: ${JSON.stringify(`${proxyOrigin}/api/admin`)} });
    await client.me();
    const sourceResponse = await fetch(${JSON.stringify(sourceProduct.image)});
    if (!sourceResponse.ok) throw new Error('Could not load the isolated image fixture for staging renew QA.');
    const sourceBlob = await sourceResponse.blob();
    const batchId = 'qa-renew-' + crypto.randomUUID();
    const file = new File([sourceBlob], 'qa-renew.png', { type: sourceBlob.type || 'image/png' });
    const staged = await client.stageMedia({ batchId, clientId: 'qa-client-1', originalIndex: 0, file });
    const renewed = await client.renewStagedBatch(batchId);
    const listed = await client.stagedBatch(batchId);
    await client.cancelStagedMedia({ batchId, leaseId: staged.leaseId });
    return {
      batchId,
      stagedLeaseId: staged.leaseId,
      renewedCount: renewed.items?.length || renewed.renewed || 0,
      listedLeaseIds: (listed.items || []).map((item) => item.leaseId)
    };
  })()`);
  const stagingRequests = proxyStats.requests.slice(stagingStart)
    .filter((item) => item.pathname.startsWith('/api/admin/media/staging') && item.method !== 'OPTIONS');
  const renewRequest = stagingRequests.find((item) => item.method === 'POST' && item.pathname.endsWith('/renew'));
  requireCheck('admin.staging-renew-csrf-contract', Boolean(stagingContract.stagedLeaseId)
    && stagingContract.listedLeaseIds.includes(stagingContract.stagedLeaseId)
    && Boolean(renewRequest?.hasCsrf)
    && stagingRequests.filter((item) => ['POST', 'DELETE'].includes(item.method)).every((item) => item.hasCsrf), {
    stagingContract,
    stagingRequests
  });
  runtimePhase = 'authenticated-editor';

  await evaluate(`document.querySelector('[data-view="catalog"]')?.click()`);
  const catalogReady = await waitForCondition(`Boolean(document.querySelector('.admin-entity-list__title-row button'))`, 20_000);
  requireCheck('admin.catalog-list-ready', catalogReady, {});
  const draftTitle = `QA browser draft ${Date.now()}`;
  await evaluate(`document.querySelector('.admin-entity-list__title-row button')?.click()`);
  const createOpen = await waitForCondition(`document.querySelector('#adminCreateDialog')?.open === true`, 8_000);
  requireCheck('admin.create-dialog-open', createOpen, {});
  await evaluate(`(() => {
    const form = document.querySelector('#adminCreateForm');
    form.querySelector('#adminCreateType').value = 'products';
    form.querySelector('#adminCreateType').dispatchEvent(new Event('change', { bubbles: true }));
    const parent = form.querySelector('#adminCreateParent');
    parent.value = ${JSON.stringify(sourceProduct.productCategorySlug)};
    form.querySelector('#adminCreatePresentation').value = 'standard';
    form.querySelector('#adminCreateName').value = ${JSON.stringify(draftTitle)};
    form.requestSubmit();
  })()`);
  const draftReady = await waitForCondition(`(() => {
    const params = new URLSearchParams(location.search);
    const title = document.querySelector('[data-field-path="title"] input')?.value;
    return params.get('collection') === 'products' && params.get('slug')?.startsWith('qa-browser-draft-') && title === ${JSON.stringify(draftTitle)};
  })()`, 20_000);
  const draftRoute = await evaluate(`(() => ({
    slug: new URLSearchParams(location.search).get('slug'),
    href: location.href
  }))()`);
  const draftFile = path.join(prepared.contentRoot, 'products', `${draftRoute.slug}.json`);
  const draftActive = await fieldState('isActive');
  const draftCatalog = await fieldState('showInCatalog');
  requireCheck('admin.create-browser-only-hidden-draft', draftReady
    && draftActive.value === false && draftCatalog.value === false
    && !await exists(draftFile), { draftRoute, draftActive, draftCatalog, diskExists: await exists(draftFile) });

  await delay(700);
  runtimePhase = 'draft-reload';
  const documentTimeOrigin = await evaluate('performance.timeOrigin');
  await cdp.send('Page.reload', { ignoreCache: true });
  const documentReloaded = await waitForCondition(`performance.timeOrigin !== ${JSON.stringify(documentTimeOrigin)} && document.readyState === 'complete'`, 30_000);
  const draftReloaded = documentReloaded && await waitForCondition(`(() => {
    const title = document.querySelector('[data-field-path="title"] input')?.value;
    const active = document.querySelector('[data-field-path="isActive"] input')?.checked;
    const catalog = document.querySelector('[data-field-path="showInCatalog"] input')?.checked;
    return document.readyState === 'complete'
      && !document.querySelector('#adminApp')?.hidden
      && title === ${JSON.stringify(draftTitle)}
      && active === false && catalog === false
      && !document.querySelector('#adminRecoveryDialog')?.open
      && !document.querySelector('#adminConflictDialog')?.open;
  })()`, 30_000);
  requireCheck('admin.browser-only-draft-survives-reload-without-disk', draftReloaded && !await exists(draftFile), {
    documentReloaded,
    draftReloaded,
    diskExists: await exists(draftFile),
    draftRoute
  });

  const logoutStart = proxyStats.requests.length;
  runtimePhase = 'logout';
  const logoutControl = await evaluate(`(() => {
    const button = document.querySelector('#adminLogout');
    const state = { exists: Boolean(button), disabled: Boolean(button?.disabled), hidden: Boolean(button?.hidden), appHidden: Boolean(document.querySelector('#adminApp')?.hidden) };
    button?.click();
    return state;
  })()`);
  const loggedOut = await waitForCondition(`!document.querySelector('#adminLogin')?.hidden && document.querySelector('#adminApp')?.hidden === true`, 12_000);
  const logoutRequest = await (async () => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const request = proxyStats.requests.slice(logoutStart).find((item) => item.pathname === '/api/admin/logout' && item.method === 'POST');
      if (request?.status === 200) return request;
      await delay(50);
    }
    return proxyStats.requests.slice(logoutStart).find((item) => item.pathname === '/api/admin/logout' && item.method === 'POST');
  })();
  requireCheck('admin.logout', loggedOut && logoutRequest?.status === 200 && logoutRequest?.hasCsrf === true, {
    loggedOut,
    logoutControl,
    logoutRequest,
    traffic: proxyStats.requests.slice(logoutStart)
      .filter((item) => item.pathname === '/api/admin/logout')
      .map(({ method, pathname, status, hasCsrf }) => ({ method, pathname, status, hasCsrf }))
  });

  const publishMutations = proxyStats.publishRequests.filter((item) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(item.method));
  record('safety.publish-namespace-intercepted', publishMutations.length === 0
    && proxyStats.publishRequests.every((item) => item.pathname.startsWith('/api/admin/publish')),
  { publishRequests: proxyStats.publishRequests, publishMutations });
  record('security.mutating-content-writes-have-csrf', proxyStats.contentWrites.length >= 2
    && proxyStats.contentWrites.every((item) => item.hasCsrf), { contentWrites: proxyStats.contentWrites });
  const expectedNetworkErrors = runtimeErrors.filter((error) => error.type === 'log.error'
    && error.source === 'network'
    && error.phase === 'wrong-login'
    && error.url === `${proxyOrigin}/api/admin/login`
    && error.message.includes('401'));
  const expectedNetworkSet = new Set(expectedNetworkErrors);
  const unexpectedRuntimeErrors = runtimeErrors.filter((error) => !expectedNetworkSet.has(error));
  record('runtime.console-and-exceptions-zero', unexpectedRuntimeErrors.length === 0, {
    total: unexpectedRuntimeErrors.length,
    errors: unexpectedRuntimeErrors.slice(0, 16),
    expectedNegativeNetworkObservations: expectedNetworkErrors
  });
  record('sandbox.isolated-product-mutated', isolatedProductChanged, { isolatedProductChanged });
} catch (error) {
  record('admin-browser.fatal', false, {
    error: error instanceof Error ? error.stack : String(error),
    apiLog: apiHandle?.logs?.().slice(-12_000) || '',
    astroLog: astroHandle?.logs?.().slice(-12_000) || ''
  });
} finally {
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  }
  if (browserProcess) {
    if (browserProcess.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => browserProcess.once('exit', resolve)),
        delay(3_500)
      ]);
    }
    if (browserProcess.exitCode === null) {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 8_000
        }).catch(() => {});
      } else browserProcess.kill('SIGKILL');
    }
  }
  await stopChild(astroHandle);
  await closeServer(proxyServer);
  await stopChild(apiHandle);
  const safeTempTarget = path.dirname(tempRoot) === tempBase && path.basename(tempRoot).startsWith('admin-browser-roundtrip-');
  if (safeTempTarget) {
    for (let attempt = 0; attempt < 8 && await exists(tempRoot); attempt += 1) {
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 120 }).catch(() => {});
      if (await exists(tempRoot)) await delay(180 * (attempt + 1));
    }
  }
  tempRemoved = safeTempTarget && !await exists(tempRoot);
}

const liveAfter = await gitSafetyState();
record('safety.live-protected-files-unchanged', liveAfter.protectedHash === liveBefore.protectedHash, {
  before: liveBefore.protectedHash,
  after: liveAfter.protectedHash
});
record('safety.git-head-unchanged', liveAfter.head === liveBefore.head, { before: liveBefore.head, after: liveAfter.head });
record('safety.git-index-unchanged', liveAfter.indexHash === liveBefore.indexHash, { before: liveBefore.indexHash, after: liveAfter.indexHash });
record('safety.temp-sandbox-removed', tempRemoved, { tempRemoved, tempRoot });

const summary = {
  result: failures.length ? 'fail' : 'pass',
  checks: checks.length,
  passed: checks.length - failures.length,
  failed: failures.length,
  product: sourceProduct.slug,
  browserInstances: 1,
  publishRequests: proxyStats.publishRequests,
  contentWrites: proxyStats.contentWrites,
  productionProtectedFilesChanged: liveAfter.protectedHash !== liveBefore.protectedHash,
  gitHeadChanged: liveAfter.head !== liveBefore.head,
  gitIndexChanged: liveAfter.indexHash !== liveBefore.indexHash,
  tempRemoved,
  failures
};

if (options.json) {
  process.stdout.write(`${JSON.stringify({ ...summary, checkDetails: checks }, null, 2)}\n`);
} else {
  for (const check of checks) {
    const details = check.status === 'fail'
      ? ` ${JSON.stringify(Object.fromEntries(Object.entries(check).filter(([key]) => !['id', 'status'].includes(key))))}`
      : '';
    process.stdout.write(`${check.status === 'pass' ? 'PASS' : 'FAIL'} ${check.id}${details}\n`);
  }
  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
}
if (failures.length) process.exitCode = 1;

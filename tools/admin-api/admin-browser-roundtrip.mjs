import crypto from 'node:crypto';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
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
  process.stdout.write(`Isolated browser round-trip for /admin/visual\n\n`);
  process.stdout.write(`  npm run qa:admin-browser\n`);
  process.stdout.write(`  node tools/admin-api/admin-browser-roundtrip.mjs --product=skamya-smu1-bazovaya\n\n`);
  process.stdout.write(`Options: --headful, --json, --product=<standard-product-slug>, CHROME_PATH=<path>.\n`);
  process.stdout.write(`The script starts one Chromium, one minimal Astro dev server and one isolated admin API.\n`);
  process.stdout.write(`All writable content and browser data stay in an external temp sandbox on the project drive.\n`);
  process.stdout.write(`The admin publish endpoints are intercepted locally and never reach git or a remote.\n`);
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
  const liveHash = await digestPaths([
    path.join(root, 'src', 'content'),
    path.join(root, 'src', 'data')
  ]);
  return { head, indexHash, liveHash };
}

async function freePort(used) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
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
  throw new Error('Could not reserve a local port for admin browser QA.');
}

function startChild(label, command, args, config) {
  const child = spawn(command, args, {
    ...config,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let logs = '';
  const append = (chunk) => {
    logs = `${logs}${chunk.toString()}`.slice(-80_000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  return { label, child, logs: () => logs };
}

async function stopChild(handle) {
  if (!handle?.child || handle.child.exitCode !== null) return;
  handle.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => handle.child.once('exit', resolve)),
    delay(4_000)
  ]);
  if (handle.child.exitCode === null) {
    handle.child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => handle.child.once('exit', resolve)),
      delay(2_000)
    ]);
  }
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

async function readRequestBody(request, limit = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error(`Proxy request exceeded ${limit} bytes.`);
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function startSafetyProxy({ backendOrigin, siteOrigin, port, stats }) {
  const server = createServer(async (request, response) => {
    try {
      const incoming = new URL(request.url || '/', `http://127.0.0.1:${port}`);
      const method = String(request.method || 'GET').toUpperCase();
      const isPublish = method === 'POST' && new Set([
        '/api/admin/publish',
        '/api/admin/publish-all'
      ]).has(incoming.pathname);

      if (isPublish) {
        stats.blockedPublishRequests.push({ method, pathname: incoming.pathname });
        const body = Buffer.from(JSON.stringify({
          ok: true,
          published: false,
          status: 'success',
          mode: 'test',
          target: 'test',
          branch: 'qa-isolated',
          productionDeployEnabled: false,
          siteUrlConfigured: false,
          message: 'QA: сохранено в изолированный content root; публикация отключена.'
        }));
        response.writeHead(200, {
          'access-control-allow-origin': siteOrigin,
          'access-control-allow-credentials': 'true',
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(body.length),
          'cache-control': 'no-store'
        }).end(body);
        return;
      }

      const body = ['GET', 'HEAD'].includes(method) ? undefined : await readRequestBody(request);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined || ['host', 'connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const target = new URL(`${incoming.pathname}${incoming.search}`, backendOrigin);
      const backendResponse = await fetch(target, {
        method,
        headers,
        body,
        redirect: 'manual'
      });
      const responseBody = Buffer.from(await backendResponse.arrayBuffer());
      const responseHeaders = {};
      backendResponse.headers.forEach((value, key) => {
        if (!['connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) responseHeaders[key] = value;
      });
      responseHeaders['content-length'] = String(responseBody.length);
      responseHeaders['cache-control'] = 'no-store';
      responseHeaders['x-admin-qa-proxy'] = 'isolated';
      response.writeHead(backendResponse.status, responseHeaders).end(method === 'HEAD' ? undefined : responseBody);

      if (/^\/api\/admin\/content\/products(?:\/|$)/.test(incoming.pathname)
        && ['POST', 'PUT', 'DELETE'].includes(method)) {
        stats.contentWrites.push({ method, pathname: incoming.pathname, status: backendResponse.status });
      }
      stats.forwarded.push({ method, pathname: incoming.pathname, status: backendResponse.status });
    } catch (error) {
      const body = Buffer.from(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      response.writeHead(502, {
        'access-control-allow-origin': siteOrigin,
        'access-control-allow-credentials': 'true',
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(body.length)
      }).end(body);
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
    if (browser.exitCode !== null) throw new Error(`Chromium exited early (${browser.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = response.ok ? await response.json() : [];
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(120);
  }
  throw new Error('Chromium DevTools endpoint did not start within 30 seconds.');
}

async function waitForDownload(directory, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const names = await readdir(directory).catch(() => []);
    const ready = names.filter((name) => name.endsWith('.json') && !name.endsWith('.crdownload'));
    for (const name of ready) {
      const filename = path.join(directory, name);
      const info = await stat(filename).catch(() => null);
      if (info?.isFile() && info.size > 0) return filename;
    }
    await delay(100);
  }
  throw new Error(`Catalog export was not downloaded within ${timeoutMs}ms.`);
}

async function prepareSandbox(tempRoot, sourceProduct) {
  const sandbox = path.join(tempRoot, 'sandbox');
  const contentRoot = path.join(sandbox, 'content');
  const copyPairs = [
    ['package.json', 'package.json'],
    ['astro.config.mjs', 'astro.config.mjs'],
    ['tsconfig.json', 'tsconfig.json'],
    ['src/pages/admin/visual.astro', 'src/pages/admin/visual.astro'],
    ['src/styles/global.css', 'src/styles/global.css'],
    ['src/utils/withBase.ts', 'src/utils/withBase.ts'],
    ['src/utils/projectMedia.mjs', 'src/utils/projectMedia.mjs'],
    ['src/content-schemas.mjs', 'src/content-schemas.mjs']
  ];

  for (const [source, target] of copyPairs) {
    const destination = path.join(sandbox, target);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, source), destination);
  }
  await writeFile(path.join(sandbox, 'astro.config.mjs'), `import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.TEST_SITE_URL || 'http://127.0.0.1:4321',
  base: '/',
  output: 'static',
  devToolbar: { enabled: false },
  vite: {
    server: {
      fs: {
        allow: [${JSON.stringify(sandbox)}, ${JSON.stringify(path.join(root, 'node_modules'))}]
      }
    }
  }
});
`, 'utf8');
  await mkdir(path.join(sandbox, 'public', 'uploads'), { recursive: true });
  await cp(path.join(root, 'tools', 'admin-api'), path.join(sandbox, 'tools', 'admin-api'), { recursive: true });
  await symlink(
    path.join(root, 'node_modules'),
    path.join(sandbox, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  const categoryPath = path.join(root, 'src', 'content', 'product-categories', `${sourceProduct.productCategorySlug}.json`);
  const category = JSON.parse(await readFile(categoryPath, 'utf8'));
  const sectionPath = path.join(root, 'src', 'content', 'product-sections', `${category.parentSectionSlug}.json`);
  const records = [
    [path.join(root, 'src', 'content', 'products', `${sourceProduct.slug}.json`), path.join(contentRoot, 'products', `${sourceProduct.slug}.json`)],
    [categoryPath, path.join(contentRoot, 'product-categories', `${category.slug}.json`)],
    [sectionPath, path.join(contentRoot, 'product-sections', `${category.parentSectionSlug}.json`)]
  ];
  for (const [source, destination] of records) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  const media = [sourceProduct.image, ...(Array.isArray(sourceProduct.gallery) ? sourceProduct.gallery : [])]
    .map((item) => typeof item === 'string' ? item : item?.src)
    .filter((item) => typeof item === 'string' && item.startsWith('/'));
  for (const mediaPath of media) {
    const source = path.resolve(path.join(root, 'public'), `.${mediaPath}`);
    const publicRoot = path.resolve(path.join(root, 'public'));
    if (source !== publicRoot && !source.startsWith(`${publicRoot}${path.sep}`)) continue;
    if (!await exists(source)) continue;
    const destination = path.resolve(path.join(sandbox, 'public'), `.${mediaPath}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  return {
    sandbox,
    contentRoot,
    productFile: path.join(contentRoot, 'products', `${sourceProduct.slug}.json`)
  };
}

const productSourcePath = path.join(root, 'src', 'content', 'products', `${options.productSlug}.json`);
if (!await exists(productSourcePath)) throw new Error(`Product ${options.productSlug} was not found.`);
const sourceProduct = JSON.parse(await readFile(productSourcePath, 'utf8'));
if (sourceProduct.presentationType !== 'standard') {
  throw new Error(`Admin browser round-trip requires a standard source product; ${sourceProduct.slug} is ${sourceProduct.presentationType}.`);
}

const chromePath = chromeCandidates.find((candidate) => fsSync.existsSync(candidate));
if (!chromePath) throw new Error('Chrome/Edge was not found. Set CHROME_PATH to a local Chromium executable.');
if (typeof WebSocket !== 'function') throw new Error('This QA script requires a Node.js runtime with global WebSocket support.');

const liveBefore = await gitSafetyState();
const defaultTempBase = process.platform === 'win32'
  ? path.join(path.parse(root).root, 'CodexTemp', 'smu1-admin-browser')
  : path.join(os.tmpdir(), 'smu1-admin-browser');
const tempBase = path.resolve(process.env.SMU1_ADMIN_QA_TEMP_ROOT || defaultTempBase);
const tempRelativeToRepo = path.relative(root, tempBase);
if (!tempRelativeToRepo.startsWith('..') && !path.isAbsolute(tempRelativeToRepo)) {
  throw new Error(`SMU1_ADMIN_QA_TEMP_ROOT must be outside the repository: ${tempBase}`);
}
if (process.platform === 'win32'
  && path.parse(tempBase).root.toLowerCase() !== path.parse(root).root.toLowerCase()) {
  throw new Error(`Admin browser QA temp must stay on the project drive: ${tempBase}`);
}
await mkdir(tempBase, { recursive: true });
const tempRoot = await mkdtemp(path.join(tempBase, 'admin-browser-roundtrip-'));
const downloadsDir = path.join(tempRoot, 'downloads');
const processTempDir = path.join(tempRoot, 'process-temp');
await mkdir(downloadsDir, { recursive: true });
await mkdir(processTempDir, { recursive: true });

let apiHandle = null;
let astroHandle = null;
let proxyServer = null;
let browser = null;
let cdp = null;
let productFile = '';
let baselineBytes = null;
let sandboxRestored = false;
let tempRemoved = false;
const runtimeErrors = [];
const proxyStats = { blockedPublishRequests: [], contentWrites: [], forwarded: [] };

try {
  const prepared = await prepareSandbox(tempRoot, sourceProduct);
  productFile = prepared.productFile;
  baselineBytes = await readFile(productFile);
  const baselineHash = sha256(baselineBytes);
  const sandboxSeesGit = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: prepared.sandbox,
    windowsHide: true
  }).then(() => true, () => false);
  requireCheck('infrastructure.sandbox-outside-git', !sandboxSeesGit, {
    sandbox: prepared.sandbox,
    sandboxSeesGit
  });

  const usedPorts = new Set();
  const backendPort = await freePort(usedPorts);
  const proxyPort = await freePort(usedPorts);
  const sitePort = await freePort(usedPorts);
  const debugPort = await freePort(usedPorts);
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  const siteOrigin = `http://127.0.0.1:${sitePort}`;
  const credentials = { login: 'admin-browser-qa', password: `qa-${crypto.randomUUID()}` };

  apiHandle = startChild('isolated admin API', process.execPath, ['tools/admin-api/server.mjs'], {
    cwd: prepared.sandbox,
    env: {
      ...process.env,
      ADMIN_API_PORT: String(backendPort),
      ADMIN_USERNAME: credentials.login,
      ADMIN_PASSWORD: credentials.password,
      SESSION_SECRET: `qa-session-${crypto.randomUUID()}`,
      ADMIN_ALLOWED_ORIGIN: siteOrigin,
      ADMIN_TEST_CONTENT_ROOT: prepared.contentRoot,
      CONTENT_WRITE_MODE: 'local',
      ADMIN_GIT_REMOTE: 'qa-disabled',
      PRODUCTION_DEPLOY_ENABLED: 'false',
      SITE_URL: '',
      TEST_SITE_URL: siteOrigin,
      GIT_CEILING_DIRECTORIES: path.dirname(prepared.sandbox),
      TEMP: processTempDir,
      TMP: processTempDir
    }
  });
  await waitForHttp(`${backendOrigin}/api/admin/me`, apiHandle, 'isolated admin API', 20_000);

  proxyServer = await startSafetyProxy({ backendOrigin, siteOrigin, port: proxyPort, stats: proxyStats });
  const proxyReady = await fetch(`${proxyOrigin}/api/admin/me`);
  requireCheck('infrastructure.proxy', proxyReady.ok
    && proxyStats.forwarded.some((item) => item.pathname === '/api/admin/me' && item.status === 200), {
    status: proxyReady.status,
    forwarded: proxyStats.forwarded.slice(-3)
  });

  astroHandle = startChild('minimal Astro admin server', process.execPath, [
    path.join(prepared.sandbox, 'node_modules', 'astro', 'astro.js'),
    'dev',
    '--host', '127.0.0.1',
    '--port', String(sitePort)
  ], {
    cwd: prepared.sandbox,
    env: {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: '1',
      PUBLIC_ADMIN_API_BASE: `${proxyOrigin}/api/admin`,
      TEST_SITE_URL: siteOrigin,
      BASE_PATH: '/',
      DEPLOY_TARGET: 'development',
      TEMP: processTempDir,
      TMP: processTempDir
    }
  });
  await waitForHttp(`${siteOrigin}/admin/visual/`, astroHandle, 'minimal Astro admin server', 35_000);

  const profileDir = path.join(tempRoot, 'chromium-profile');
  await mkdir(profileDir, { recursive: true });
  browser = spawn(chromePath, [
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
    '--window-size=1440,1000',
    'about:blank'
  ], {
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, TEMP: processTempDir, TMP: processTempDir }
  });

  const websocketUrl = await waitForDebugger(debugPort, browser);
  cdp = new CdpClient(websocketUrl);
  await cdp.connect();
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    runtimeErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception');
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error' || type === 'assert') {
      runtimeErrors.push(args?.map((item) => item.value || item.description || '').join(' ') || `console.${type}`);
    }
  });
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable'),
    cdp.send('Log.enable')
  ]);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.setBlockedURLs', {
    urls: ['*://fonts.googleapis.com/*', '*://fonts.gstatic.com/*', '*://mc.yandex.ru/*', '*://api-maps.yandex.ru/*']
  });
  try {
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir });
  } catch {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir });
  }

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
    const ready = await waitForCondition(`location.href.startsWith(${JSON.stringify(url.split('?')[0])}) && document.readyState === 'complete'`, 25_000);
    if (!ready) throw new Error(`Navigation readiness timed out for ${url}.`);
    await settle(120);
  };
  const editorState = () => evaluate(`(() => {
    const presentation = Array.from(document.querySelectorAll('[data-field-path]'))
      .find((element) => element.dataset.fieldPath === 'presentationType');
    const value = (fieldPath) => Array.from(document.querySelectorAll('[data-field-path]'))
      .find((element) => element.dataset.fieldPath === fieldPath)?.value || '';
    const arrayValues = (fieldPath) => Array.from(document.querySelectorAll('[data-editable][data-path]'))
      .filter((element) => element.dataset.path?.startsWith(fieldPath + '.'))
      .map((element) => (element.innerText || '').trim());
    return {
      appVisible: !document.getElementById('appView')?.classList.contains('hidden'),
      presentationType: presentation?.value || '',
      premiumFieldsVisible: Boolean(document.querySelector('[data-premium-product-fields]')),
      solutionKicker: value('solutionKicker'),
      applicationItems: arrayValues('applicationItems'),
      executionVariants: arrayValues('executionVariants'),
      dirty: document.getElementById('dirtyStatus')?.textContent?.trim() || '',
      alert: document.getElementById('alertBox')?.textContent?.trim() || ''
    };
  })()`);
  const setField = async (fieldPath, value) => {
    const available = await waitForCondition(`Array.from(document.querySelectorAll('[data-field-path]'))
      .some((candidate) => candidate.dataset.fieldPath === ${JSON.stringify(fieldPath)})`, 8_000);
    if (!available) throw new Error(`Admin field ${fieldPath} was not rendered.`);
    const changed = await evaluate(`(() => {
      const fieldPath = ${JSON.stringify(fieldPath)};
      const element = Array.from(document.querySelectorAll('[data-field-path]'))
        .find((candidate) => candidate.dataset.fieldPath === fieldPath);
      if (!element) return false;
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!changed) throw new Error(`Admin field ${fieldPath} was not found.`);
    await settle(40);
  };
  const setArrayItems = async (fieldPath, values) => {
    for (let index = 0; index < values.length; index += 1) {
      const added = await evaluate(`(() => {
        const fieldPath = ${JSON.stringify(fieldPath)};
        const button = Array.from(document.querySelectorAll('[data-action="add-array-item"][data-path]'))
          .find((candidate) => candidate.dataset.path === fieldPath);
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!added) throw new Error(`Array editor ${fieldPath} was not rendered.`);
      const itemPath = `${fieldPath}.${index}`;
      const available = await waitForCondition(`Array.from(document.querySelectorAll('[data-editable][data-path]'))
        .some((candidate) => candidate.dataset.path === ${JSON.stringify(itemPath)})`, 8_000);
      if (!available) throw new Error(`Array item ${itemPath} was not rendered.`);
      const changed = await evaluate(`(() => {
        const itemPath = ${JSON.stringify(itemPath)};
        const item = Array.from(document.querySelectorAll('[data-editable][data-path]'))
          .find((candidate) => candidate.dataset.path === itemPath);
        if (!item) return false;
        item.innerText = ${JSON.stringify(values[index])};
        item.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      if (!changed) throw new Error(`Array item ${itemPath} could not be edited.`);
      await settle(40);
    }
  };
  const openImport = async () => {
    await navigate(`${siteOrigin}/admin/visual/?collection=data-import`);
    const ready = await waitForCondition(`Boolean(document.querySelector('[data-import-json]'))`, 20_000);
    if (!ready) throw new Error('Admin product import page did not render.');
  };
  const setImportText = async (payload) => {
    const raw = JSON.stringify(payload);
    const changed = await evaluate(`(() => {
      const mode = document.querySelector('[data-import-mode]');
      if (mode && mode.value !== 'update-only') {
        mode.value = 'update-only';
        mode.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const textarea = document.querySelector('[data-import-json]');
      if (!textarea) return false;
      textarea.value = ${JSON.stringify(raw)};
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!changed) throw new Error('Admin import textarea was not found.');
  };
  const runValidUiImport = async (payload, id) => {
    await setImportText(payload);
    await evaluate(`document.querySelector('[data-action="validate-products-import"]')?.click()`);
    const ready = await waitForCondition(`(() => {
      const button = document.querySelector('[data-action="run-products-import"]');
      const text = document.querySelector('#workspace')?.textContent || '';
      return Boolean(button && !button.disabled && text.includes('Ошибок: 0'));
    })()`, 12_000);
    requireCheck(`${id}.preview`, ready, {});
    const writesBefore = proxyStats.contentWrites.length;
    await evaluate(`document.querySelector('[data-action="run-products-import"]')?.click()`);
    const applied = await waitForCondition(`(() => {
      const text = document.querySelector('#workspace')?.textContent || '';
      return text.includes('Результат импорта') && text.includes('Обновлено: 1') && text.includes('Ошибок: 0');
    })()`, 20_000);
    requireCheck(`${id}.apply`, applied && proxyStats.contentWrites.length === writesBefore + 1, {
      applied,
      writes: proxyStats.contentWrites.slice(writesBefore)
    });
  };

  const editorUrl = `${siteOrigin}/admin/visual/?collection=products&slug=${encodeURIComponent(sourceProduct.slug)}`;
  await navigate(editorUrl);
  const loginVisible = await waitForCondition(`!document.getElementById('loginView')?.classList.contains('hidden')`, 10_000);
  requireCheck('admin.login-screen', loginVisible, {});
  await evaluate(`(() => {
    document.getElementById('login').value = ${JSON.stringify(credentials.login)};
    document.getElementById('password').value = ${JSON.stringify(credentials.password)};
    document.getElementById('loginForm').requestSubmit();
    return true;
  })()`);
  const editorReady = await waitForCondition(`(() => {
    const select = Array.from(document.querySelectorAll('[data-field-path]'))
      .find((element) => element.dataset.fieldPath === 'presentationType');
    return !document.getElementById('appView')?.classList.contains('hidden') && select?.value === 'standard';
  })()`, 25_000);
  requireCheck('admin.editor-load', editorReady, { product: sourceProduct.slug });
  let state = await editorState();
  requireCheck('admin.initial-standard', state.presentationType === 'standard' && !state.premiumFieldsVisible, state);

  const marker = `QA premium round-trip ${crypto.randomUUID()}`;
  const applications = `QA application one\nQA application two`;
  const variants = `QA execution one\nQA execution two`;
  await setField('presentationType', 'premium');
  const premiumFieldsReady = await waitForCondition(`Boolean(document.querySelector('[data-premium-product-fields]'))`, 8_000);
  requireCheck('admin.premium-fields-render', premiumFieldsReady, {});
  await setField('solutionKicker', marker);
  await setArrayItems('applicationItems', applications.split('\n'));
  await setArrayItems('executionVariants', variants.split('\n'));
  state = await editorState();
  requireCheck('admin.switch-standard-to-premium', state.presentationType === 'premium'
    && state.premiumFieldsVisible && state.dirty.includes('Есть изменения'), state);

  await evaluate(`document.getElementById('saveBtn')?.click()`);
  const saved = await waitForCondition(`(() => {
    const dirty = document.getElementById('dirtyStatus')?.textContent || '';
    const alert = document.getElementById('alertBox')?.textContent || '';
    return dirty.includes('Нет изменений') && alert.includes('QA:');
  })()`, 25_000);
  const savedProduct = JSON.parse(await readFile(productFile, 'utf8'));
  requireCheck('admin.save', saved
    && savedProduct.presentationType === 'premium'
    && savedProduct.solutionKicker === marker
    && JSON.stringify(savedProduct.applicationItems) === JSON.stringify(applications.split('\n'))
    && JSON.stringify(savedProduct.executionVariants) === JSON.stringify(variants.split('\n')),
  { saved, presentationType: savedProduct.presentationType });
  requireCheck('safety.publish-intercept', proxyStats.blockedPublishRequests.length === 1, {
    blocked: proxyStats.blockedPublishRequests
  });

  await cdp.send('Page.reload', { ignoreCache: true });
  const reloaded = await waitForCondition(`(() => {
    const select = Array.from(document.querySelectorAll('[data-field-path]'))
      .find((element) => element.dataset.fieldPath === 'presentationType');
    const kicker = Array.from(document.querySelectorAll('[data-field-path]'))
      .find((element) => element.dataset.fieldPath === 'solutionKicker');
    return document.readyState === 'complete' && select?.value === 'premium' && kicker?.value === ${JSON.stringify(marker)};
  })()`, 25_000);
  requireCheck('admin.reload-load', reloaded, await editorState());

  await openImport();
  await evaluate(`document.querySelector('[data-action="download-catalog-export"]')?.click()`);
  const exportFile = await waitForDownload(downloadsDir, 20_000);
  const catalogExport = JSON.parse(await readFile(exportFile, 'utf8'));
  const exportedItem = catalogExport.productImport?.items?.find((item) => item.slug === sourceProduct.slug);
  const exportedRaw = catalogExport.products?.find((item) => item.slug === sourceProduct.slug);
  requireCheck('admin.ui-export', catalogExport.type === 'catalog_export'
    && exportedItem?.presentationType === 'premium'
    && exportedItem?.solutionKicker === marker
    && exportedRaw?.presentationType === 'premium', {
    filename: path.basename(exportFile),
    type: catalogExport.type,
    presentationType: exportedItem?.presentationType
  });

  const standardEnvelope = structuredClone(catalogExport);
  const standardItem = standardEnvelope.productImport.items.find((item) => item.slug === sourceProduct.slug);
  standardItem.presentationType = 'standard';
  await runValidUiImport(standardEnvelope, 'admin.ui-import-standard');
  let importedProduct = JSON.parse(await readFile(productFile, 'utf8'));
  requireCheck('admin.import-standard-persisted', importedProduct.presentationType === 'standard'
    && importedProduct.solutionKicker === marker
    && JSON.stringify(importedProduct.applicationItems) === JSON.stringify(applications.split('\n')),
  { presentationType: importedProduct.presentationType, solutionKicker: importedProduct.solutionKicker });

  await navigate(editorUrl);
  const standardReloaded = await waitForCondition(`(() => {
    const select = Array.from(document.querySelectorAll('[data-field-path]'))
      .find((element) => element.dataset.fieldPath === 'presentationType');
    return select?.value === 'standard' && !document.querySelector('[data-premium-product-fields]');
  })()`, 20_000);
  requireCheck('admin.import-standard-ui', standardReloaded, await editorState());

  await openImport();
  await runValidUiImport(catalogExport, 'admin.ui-import-premium-roundtrip');
  importedProduct = JSON.parse(await readFile(productFile, 'utf8'));
  requireCheck('admin.import-premium-persisted', importedProduct.presentationType === 'premium'
    && importedProduct.solutionKicker === marker
    && JSON.stringify(importedProduct.executionVariants) === JSON.stringify(variants.split('\n')),
  { presentationType: importedProduct.presentationType, solutionKicker: importedProduct.solutionKicker });

  await navigate(editorUrl);
  const premiumRoundtripUi = await waitForCondition(`(() => {
    const fields = Array.from(document.querySelectorAll('[data-field-path]'));
    const value = (path) => fields.find((element) => element.dataset.fieldPath === path)?.value || '';
    const arrayValues = (path) => Array.from(document.querySelectorAll('[data-editable][data-path]'))
      .filter((element) => element.dataset.path?.startsWith(path + '.'))
      .map((element) => (element.innerText || '').trim());
    return value('presentationType') === 'premium'
      && value('solutionKicker') === ${JSON.stringify(marker)}
      && arrayValues('applicationItems').includes('QA application two')
      && arrayValues('executionVariants').includes('QA execution two')
      && Boolean(document.querySelector('[data-premium-product-fields]'));
  })()`, 20_000);
  requireCheck('admin.ui-import-roundtrip-load', premiumRoundtripUi, await editorState());

  await openImport();
  const invalidEnvelope = structuredClone(catalogExport);
  invalidEnvelope.productImport.items.find((item) => item.slug === sourceProduct.slug).presentationType = 'enterprise';
  const hashBeforeInvalidUi = sha256(await readFile(productFile));
  const writesBeforeInvalidUi = proxyStats.contentWrites.length;
  await setImportText(invalidEnvelope);
  await evaluate(`document.querySelector('[data-action="validate-products-import"]')?.click()`);
  const invalidBlocked = await waitForCondition(`(() => {
    const button = document.querySelector('[data-action="run-products-import"]');
    const text = document.querySelector('#workspace')?.textContent || '';
    return Boolean(button?.disabled && text.includes('presentationType') && text.includes('standard') && text.includes('premium'));
  })()`, 12_000);
  await evaluate(`document.querySelector('[data-action="run-products-import"]')?.click()`);
  await delay(250);
  requireCheck('admin.invalid-ui-no-write', invalidBlocked
    && proxyStats.contentWrites.length === writesBeforeInvalidUi
    && sha256(await readFile(productFile)) === hashBeforeInvalidUi, {
    invalidBlocked,
    writesBefore: writesBeforeInvalidUi,
    writesAfter: proxyStats.contentWrites.length
  });

  const currentProduct = JSON.parse(await readFile(productFile, 'utf8'));
  const hashBeforeInvalidApi = sha256(await readFile(productFile));
  const invalidResponse = await evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(`${proxyOrigin}/api/admin/content/products/${sourceProduct.slug}`)}, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(${JSON.stringify({ ...currentProduct, presentationType: 'enterprise' })})
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  })()`);
  requireCheck('admin.invalid-api-no-write', invalidResponse.status === 400
    && invalidResponse.body?.code === 'PRODUCT_SCHEMA_VALIDATION_FAILED'
    && sha256(await readFile(productFile)) === hashBeforeInvalidApi, invalidResponse);

  const writeStatuses = proxyStats.contentWrites.map((item) => item.status);
  record('admin.write-sequence', JSON.stringify(writeStatuses) === JSON.stringify([200, 200, 200, 400]), {
    writes: proxyStats.contentWrites
  });
  record('runtime.console', runtimeErrors.length === 0, { total: runtimeErrors.length, errors: runtimeErrors.slice(0, 12) });
  const forwardedPublishPosts = proxyStats.forwarded.filter((item) => item.method === 'POST'
    && ['/api/admin/publish', '/api/admin/publish-all'].includes(item.pathname));
  record('safety.no-forwarded-publish', proxyStats.blockedPublishRequests.length >= 1
    && forwardedPublishPosts.length === 0, {
    blocked: proxyStats.blockedPublishRequests.length,
    forwardedPublishPosts,
    allowedPreflights: proxyStats.forwarded.filter((item) => item.method === 'OPTIONS'
      && item.pathname.startsWith('/api/admin/publish')).length
  });
  record('sandbox.baseline-available', baselineHash.length === 64, { baselineHash });
} catch (error) {
  record('admin-browser.fatal', false, {
    error: error instanceof Error ? error.stack : String(error),
    apiLog: apiHandle?.logs?.().slice(-8_000) || '',
    astroLog: astroHandle?.logs?.().slice(-8_000) || ''
  });
} finally {
  if (baselineBytes && productFile && await exists(productFile)) {
    await writeFile(productFile, baselineBytes).catch(() => {});
    sandboxRestored = await exists(productFile)
      && sha256(await readFile(productFile)) === sha256(baselineBytes);
  }
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  }
  if (browser) {
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      delay(3_500)
    ]);
    if (browser.exitCode === null) browser.kill('SIGKILL');
  }
  await stopChild(astroHandle);
  await closeServer(proxyServer);
  await stopChild(apiHandle);
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  tempRemoved = !await exists(tempRoot);
}

const liveAfter = await gitSafetyState();
record('safety.live-content-unchanged', liveAfter.liveHash === liveBefore.liveHash, {
  before: liveBefore.liveHash,
  after: liveAfter.liveHash
});
record('safety.git-head-unchanged', liveAfter.head === liveBefore.head, {
  before: liveBefore.head,
  after: liveAfter.head
});
record('safety.git-index-unchanged', liveAfter.indexHash === liveBefore.indexHash, {
  before: liveBefore.indexHash,
  after: liveAfter.indexHash
});
record('safety.sandbox-restored-and-removed', sandboxRestored && tempRemoved, {
  sandboxRestored,
  tempRemoved,
  tempRoot
});

const summary = {
  result: failures.length ? 'fail' : 'pass',
  checks: checks.length,
  passed: checks.length - failures.length,
  failed: failures.length,
  product: sourceProduct.slug,
  browserInstances: 1,
  blockedPublishRequests: proxyStats.blockedPublishRequests.length,
  contentWrites: proxyStats.contentWrites,
  productionContentChanged: liveAfter.liveHash !== liveBefore.liveHash,
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

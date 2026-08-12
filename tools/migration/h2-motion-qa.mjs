import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import {
  V2_COMPATIBILITY_ROUTES,
  classifyV2Route,
  createV2RouteRegistry,
  resolveV2TransitionMode,
  v2PathnameWithBase
} from '../../src/utils/v2TransitionRouting.mjs';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const optionValue = (name) => argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const normalizeBase = (value) => {
  const raw = String(value || '/').trim();
  if (!raw || raw === '/') return '/';
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`;
};
const options = {
  help: hasFlag('--help') || hasFlag('-h'),
  headful: hasFlag('--headful'),
  json: hasFlag('--json'),
  keepProfile: hasFlag('--keep-profile'),
  skipBaseBuild: hasFlag('--skip-base-build'),
  externalOrigin: optionValue('--origin').trim().replace(/\/$/, ''),
  artifacts: optionValue('--artifacts').trim() || String(process.env.SMU1_H4_ARTIFACT_ROOT || '').trim(),
  githubBase: normalizeBase(optionValue('--github-base') || '/SMU1/')
};

if (options.help) {
  process.stdout.write(`H2/H4 first-entry, hierarchical transitions and universal entrance browser QA\n\n`);
  process.stdout.write(`  node tools/migration/h2-motion-qa.mjs\n`);
  process.stdout.write(`      Serve ./dist, run the complete H2 motion suite, build a temporary /SMU1/ copy,\n`);
  process.stdout.write(`      and save H3/calm/entrance/scroll/responsive evidence below the operating-system temp directory.\n`);
  process.stdout.write(`  node tools/migration/h2-motion-qa.mjs --origin=http://127.0.0.1:4321\n`);
  process.stdout.write(`      Test an existing local origin. Deterministic media faults and the temporary base build are skipped.\n`);
  process.stdout.write(`  Optional: --headful, --json, --artifacts=/absolute/path, --github-base=/SMU1/,\n`);
  process.stdout.write(`            --skip-base-build, --keep-profile, SMU1_H4_ARTIFACT_ROOT=/absolute/path,\n`);
  process.stdout.write(`            CHROME_PATH=/path/to/chrome.\n`);
  process.exit(0);
}

const ENTRY_KEY = 'smu1:entry-intro:v2';
const HANDOFF_KEY = 'smu1:page-transition:v2';
const TAB_KEY = 'smu1:browser-tab:v1';
const TAB_NAME_MARKER = '__smu1_browser_tab_v1__:';
const TRACE_KEY = '__smu1:h2-motion-qa:trace';
const TOKEN_VERSION = 2;
const TOKEN_TTL_MS = 20_000;
const PAGE_DEADLINE_MS = 1_200;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checks = [];
const failures = [];
const record = (id, ok, details = {}) => {
  const row = { id, status: ok ? 'pass' : 'fail', ...details };
  checks.push(row);
  if (!ok) failures.push(row);
  return ok;
};

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactRoot = path.resolve(options.artifacts || path.join(os.tmpdir(), `smu1-h4-motion-qa-${timestamp}`));
await mkdir(artifactRoot, { recursive: true });
const artifactDirectories = [
  'reference-rmk',
  'baseline-smu1',
  'final/transitions/h3',
  'final/transitions/calm',
  'final/entrance',
  'final/scroll',
  'final/responsive',
  'crash-dumps'
];
await Promise.all(artifactDirectories.map((directory) => mkdir(path.join(artifactRoot, directory), { recursive: true })));
const gitHead = (() => {
  try {
    return {
      branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() || 'detached',
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    };
  } catch {
    return { branch: process.env.GITHUB_REF_NAME || 'unknown', sha: process.env.GITHUB_SHA || 'unknown' };
  }
})();
const baselineSha = String(process.env.ACTUAL_H4_BASELINE || process.env.SMU1_H4_BASELINE_SHA
  || '322b9ea0b9b125d71353ed0a2c755767dc9a25fb');
const captureManifest = [];
const responsiveMetrics = [];
const longTextIssues = [];
const traceEvidence = [];
const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'smu1-h2-motion-profile-'));
let baseBuildRoot = null;
let server = null;
let browser = null;
let chromiumStderr = null;
const chromiumStderrPath = path.join(artifactRoot, 'chromium-stderr.log');
const browserExit = { code: null, signal: null, at: null };
let browserExitPromise = Promise.resolve({ code: null, signal: null });
let cdp = null;
let browserFatalError = '';
const runtimeErrors = [];
const runtimeWarnings = [];
const networkErrors = [];
const storageEvents = [];
let origin = '';
let localPort = 0;
let primaryBase = '/';
let routeRegistryPayload = { version: 'unavailable', routes: [] };
let routeRegistry = [];
let routes = {};

try {

const parsedExternal = options.externalOrigin ? new URL(options.externalOrigin) : null;
if (parsedExternal && !['127.0.0.1', 'localhost', '::1'].includes(parsedExternal.hostname)) {
  throw new Error(`--origin must be local; received ${parsedExternal.hostname}.`);
}
origin = parsedExternal?.origin || `http://127.0.0.1:${5200 + Math.floor(Math.random() * 500)}`;
localPort = Number.parseInt(new URL(origin).port, 10);
primaryBase = parsedExternal ? normalizeBase(parsedExternal.pathname) : '/';

const content = (collection) => fs.readdirSync(path.join(root, 'src', 'content', collection))
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'content', collection, name), 'utf8')));
const products = content('products');
const productSections = content('product-sections');
const services = content('services');
const categories = content('product-categories');
const projects = content('projects');
const jobs = content('jobs');
const categoryBySlug = new Map(categories.map((item) => [item.slug, item]));
routeRegistryPayload = createV2RouteRegistry({
  productSections,
  services,
  categories,
  products,
  projects,
  jobs
});
routeRegistry = routeRegistryPayload.routes;
const productRoute = (product) => {
  if (!product) return '';
  const category = categoryBySlug.get(product.productCategorySlug);
  return category ? `/${category.parentSectionSlug}/${category.slug}/${product.slug}/` : '';
};
const standardProduct = products.find((product) => product.slug === 'skamya-park' && product.presentationType === 'standard')
  || products.find((product) => product.presentationType === 'standard' && product.image);
const premiumProduct = products.find((product) => product.slug === 'kachel-portal' && product.presentationType === 'premium')
  || products.find((product) => product.presentationType === 'premium' && product.image);
const activeProject = projects.find((project) => project.isActive);
const activeJob = jobs.find((job) => job.isActive);
const streetCategory = categories.find((category) => category.isActive
  && category.parentSectionSlug === 'ulichnaya-mebel' && category.slug === 'urny')
  || categories.find((category) => category.isActive && category.parentSectionSlug === 'ulichnaya-mebel');
const streetCategoryRoute = streetCategory
  ? `/ulichnaya-mebel/${streetCategory.slug}/`
  : '/ulichnaya-mebel/lavochki-i-skameyki/';
const streetCategoryProduct = products.find((product) => product.isActive
  && product.productCategorySlug === streetCategory?.slug);
routes = {
  home: '/',
  deep: '/topiarii/',
  street: '/ulichnaya-mebel/',
  streetCategory: streetCategoryRoute,
  streetProduct: productRoute(streetCategoryProduct),
  fences: '/ograzhdeniya-i-zabory/',
  business: '/metallokonstruktsii-dlya-biznesa/',
  about: '/o-nas/',
  contacts: '/kontakty/',
  projects: '/vypolnennye-obekty/',
  project: activeProject ? `/vypolnennye-obekty/${activeProject.slug}/` : '',
  careers: '/vakansii/',
  job: activeJob ? `/vakansii/${activeJob.slug}/` : '',
  customOrder: '/izgotovlenie-na-zakaz/',
  privacy: '/politika-konfidencialnosti/',
  notFound: '/404.html',
  standard: productRoute(standardProduct),
  premium: productRoute(premiumProduct)
};
if (!routes.standard || !routes.premium) throw new Error('H2 QA requires both a standard and a premium product route.');

const mimeTypes = {
  '.avif': 'image/avif', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml', '.webm': 'video/webm',
  '.webp': 'image/webp', '.xml': 'application/xml; charset=utf-8'
};

const hrefFor = (route, base = primaryBase) => {
  const normalizedRoute = route === '/' ? '' : route.replace(/^\/+/, '');
  return new URL(`${base}${normalizedRoute}`, origin).href;
};
const targetValue = (href) => {
  const url = new URL(href);
  return `${url.pathname}${url.search}${url.hash}`;
};
const classify = (value, basePath = primaryBase) => classifyV2Route(value, {
  origin,
  basePath,
  registry: routeRegistry,
  registryComplete: true
});
const classifierResolverTableAudit = () => {
  const registryRows = routeRegistry.map((descriptor) => {
    const pathname = v2PathnameWithBase(descriptor.pathname, primaryBase);
    const actual = classify(`${origin}${pathname}`);
    const compatibility = V2_COMPATIBILITY_ROUTES.includes(descriptor.pathname);
    const ok = actual.normalizedPathname === descriptor.pathname
      && actual.routeKind === descriptor.routeKind
      && actual.rootSectionId === descriptor.rootSectionId
      && (compatibility
        ? (!actual.interceptEligible && actual.exclusionReason === 'compatibility-route')
        : (actual.interceptEligible === (descriptor.interceptEligible !== false)
          && actual.isClassified === Boolean(descriptor.classified !== false && descriptor.rootSectionId)));
    return { pathname: descriptor.pathname, expected: descriptor, actual, ok };
  });
  record('routing.classifier-current-registry-exhaustive', registryRows.every((row) => row.ok), {
    version: routeRegistryPayload.version,
    audited: registryRows.length,
    failures: registryRows.filter((row) => !row.ok),
    roots: [...new Set(routeRegistry.map((route) => route.rootSectionId).filter(Boolean))]
  });
  const productionEntries = routeRegistry.filter((route) => route.interceptEligible !== false);
  const compatibilityAliases = routeRegistry.filter((route) => route.routeKind === 'legacy-redirect');
  record('routing.registry-108-production-plus-3-aliases', productionEntries.length === 108
    && compatibilityAliases.length === 3 && routeRegistry.length === 111,
  { productionEntries: productionEntries.length, compatibilityAliases: compatibilityAliases.length,
    total: routeRegistry.length, aliases: compatibilityAliases.map((route) => route.pathname) });

  const routeCases = [
    { id: 'root', input: '/', pathname: '/', eligible: true, classified: true },
    { id: 'trailing-slash-alias', input: '/ulichnaya-mebel', pathname: '/ulichnaya-mebel/', eligible: true, classified: true },
    { id: 'base-root', input: '/SMU1', base: '/SMU1/', pathname: '/', eligible: true, classified: true },
    { id: 'base-descendant', input: '/SMU1/ulichnaya-mebel/urny?qa=1#target', base: '/SMU1/', pathname: '/ulichnaya-mebel/urny/', eligible: true, classified: true,
      navigationTarget: '/SMU1/ulichnaya-mebel/urny/?qa=1#target' },
    { id: 'outside-base', input: '/ulichnaya-mebel/', base: '/SMU1/', eligible: false, reason: 'outside-base' },
    { id: 'unknown-public', input: '/h4-unknown-public/', pathname: '/h4-unknown-public/', eligible: true, classified: false },
    { id: 'external', input: 'https://example.invalid/h4', eligible: false, reason: 'external-origin' },
    { id: 'mailto', input: 'mailto:qa@example.invalid', eligible: false, reason: 'protocol' },
    { id: 'asset', input: '/assets/brand/favicon.svg', eligible: false, reason: 'non-production-path' },
    { id: 'upload', input: '/uploads/qa.jpg', eligible: false, reason: 'non-production-path' },
    { id: 'admin', input: '/admin/', eligible: false, reason: 'non-production-path' },
    { id: 'api', input: '/api/qa', eligible: false, reason: 'non-production-path' },
    { id: 'design-lab', input: '/design-lab/home-final/', eligible: false, reason: 'design-lab' },
    ...V2_COMPATIBILITY_ROUTES.map((input) => ({
      id: `compat-${input.replaceAll('/', '')}`,
      input,
      eligible: false,
      reason: 'compatibility-route'
    }))
  ].map((spec) => {
    const base = spec.base || '/';
    const actual = classifyV2Route(new URL(spec.input, origin), {
      origin, basePath: base, registry: routeRegistry, registryComplete: true
    });
    const ok = actual.interceptEligible === spec.eligible
      && (spec.pathname === undefined || actual.normalizedPathname === spec.pathname)
      && (spec.classified === undefined || actual.isClassified === spec.classified)
      && (spec.reason === undefined || actual.exclusionReason === spec.reason)
      && (spec.navigationTarget === undefined || actual.navigationTarget === spec.navigationTarget);
    return { ...spec, actual, ok };
  });
  record('routing.classifier-alias-base-unknown-exclusions', routeCases.every((row) => row.ok), {
    audited: routeCases.length,
    failures: routeCases.filter((row) => !row.ok),
    rows: routeCases
  });

  const classificationFor = (route) => classifyV2Route(new URL(route, origin), {
    origin, basePath: '/', registry: routeRegistry, registryComplete: true
  });
  const resolverCases = [
    { id: 'direct', from: null, to: routes.home, expected: 'none' },
    { id: 'home-to-street', from: routes.home, to: routes.street, expected: 'h3' },
    { id: 'street-to-category', from: routes.street, to: routes.streetCategory, expected: 'calm' },
    { id: 'category-to-product', from: routes.streetCategory, to: routes.streetProduct || routes.standard, expected: 'calm' },
    { id: 'product-to-fences', from: routes.streetProduct || routes.standard, to: routes.fences, expected: 'h3' },
    { id: 'projects-family', from: routes.projects, to: routes.project, expected: 'calm' },
    { id: 'careers-family', from: routes.careers, to: routes.job, expected: 'calm' },
    { id: 'same-url', from: routes.contacts, to: routes.contacts, expected: 'native' },
    { id: 'same-hash', from: routes.contacts, to: `${routes.contacts}#main-content`, expected: 'native' },
    { id: 'query-only', from: routes.contacts, to: `${routes.contacts}?h4=query`, expected: 'native' },
    { id: 'unknown-fallback', from: routes.home, to: '/h4-unknown-public/', expected: 'calm' },
    { id: 'unknown-to-known', from: '/h4-unknown-public/', to: routes.home, expected: 'calm' },
    { id: 'external', from: routes.home, to: 'https://example.invalid/h4', expected: 'native' },
    { id: 'cross-document-hash', from: routes.home, to: `${routes.business}?h4=exact#main-content`, expected: 'h3' }
  ].filter((spec) => spec.to).map((spec) => {
    const from = spec.from ? classificationFor(spec.from) : null;
    const to = classificationFor(spec.to);
    const actual = resolveV2TransitionMode(from, to);
    return { ...spec, fromClassification: from, toClassification: to, actual, ok: actual === spec.expected };
  });
  record('routing.resolver-ordered-table', resolverCases.every((row) => row.ok), {
    audited: resolverCases.length,
    failures: resolverCases.filter((row) => !row.ok),
    rows: resolverCases
  });
};
const handoffFixture = ({
  fromRoute = routes.home,
  toRoute = routes.about,
  targetHref = hrefFor(toRoute),
  variant = 'h3',
  timestamp: fixtureTimestamp = Date.now(),
  navigationId = `h4-fixture-${Date.now().toString(36)}`
} = {}) => {
  const from = classify(hrefFor(fromRoute));
  const to = classify(hrefFor(toRoute));
  return {
    version: TOKEN_VERSION,
    variant,
    target: targetValue(targetHref),
    label: variant === 'h3' ? (to.canonicalLabel || 'Целевая страница') : '',
    ...(variant === 'calm' && to.canonicalLabel ? { calmLabel: to.canonicalLabel } : {}),
    from: { pathname: from.normalizedPathname, rootSectionId: from.rootSectionId },
    to: { pathname: to.normalizedPathname, rootSectionId: to.rootSectionId },
    timestamp: fixtureTimestamp,
    nonce: navigationId,
    navigationId
  };
};

if (!options.externalOrigin && !options.skipBaseBuild) {
  baseBuildRoot = await mkdtemp(path.join(os.tmpdir(), 'smu1-h2-base-build-'));
  const { build } = await import('astro');
  await build({
    root: pathToFileURL(`${root}${path.sep}`),
    outDir: baseBuildRoot,
    site: origin,
    base: options.githubBase,
    logLevel: 'error'
  });
}

const serverFault = {
  pathname: '',
  mode: '',
  delayMs: 0,
  remaining: 0,
  hits: 0
};
const configureFault = (pathname, mode, faultDelay = 0) => {
  serverFault.pathname = pathname;
  serverFault.mode = mode;
  serverFault.delayMs = faultDelay;
  serverFault.remaining = 1;
  serverFault.hits = 0;
};
const clearFault = () => configureFault('', '', 0);

if (!options.externalOrigin) {
  const distInfo = await stat(distRoot).catch(() => null);
  if (!distInfo?.isDirectory()) throw new Error('dist is missing; run npm run build before H2 browser QA.');
  server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', origin);
      const pathname = decodeURIComponent(requestUrl.pathname);
      const basePrefix = options.githubBase === '/' ? '' : options.githubBase.slice(0, -1);
      const usesBaseBuild = Boolean(baseBuildRoot && (pathname === basePrefix || pathname.startsWith(`${basePrefix}/`)));
      const mountRoot = usesBaseBuild ? baseBuildRoot : distRoot;
      const mountedPath = usesBaseBuild ? pathname.slice(basePrefix.length) || '/' : pathname;
      let filename = mountedPath === '/404.html'
        ? path.join(mountRoot, '404.html')
        : path.resolve(mountRoot, `.${mountedPath}`);
      if (filename !== mountRoot && !filename.startsWith(`${mountRoot}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      let info = await stat(filename).catch(() => null);
      if (info?.isDirectory()) {
        filename = path.join(filename, 'index.html');
        info = await stat(filename).catch(() => null);
      }
      if (!info?.isFile()) {
        const fallback = await readFile(path.join(mountRoot, '404.html'));
        response.writeHead(404, {
          'cache-control': 'no-cache',
          'content-length': String(fallback.length),
          'content-type': 'text/html; charset=utf-8'
        }).end(request.method === 'HEAD' ? undefined : fallback);
        return;
      }

      const faultMatch = request.method !== 'HEAD' && serverFault.remaining > 0
        && pathname === serverFault.pathname;
      if (faultMatch) {
        serverFault.remaining -= 1;
        serverFault.hits += 1;
        if (serverFault.mode === 'delay') await delay(serverFault.delayMs);
        if (serverFault.mode === 'invalid') {
          const invalidImage = Buffer.from('smu1-h2-invalid-image');
          response.writeHead(200, {
            'cache-control': 'no-cache',
            'content-length': String(invalidImage.length),
            'content-type': mimeTypes[path.extname(filename).toLowerCase()] || 'image/jpeg'
          }).end(invalidImage);
          return;
        }
      }

      const body = request.method === 'HEAD' ? null : await readFile(filename);
      response.writeHead(200, {
        'cache-control': 'no-cache',
        'content-length': String(info.size),
        'content-type': mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream'
      }).end(body || undefined);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(localPort, '127.0.0.1', resolve);
  });
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chromePath) {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (baseBuildRoot) await rm(baseBuildRoot, { recursive: true, force: true });
  throw new Error('Chrome/Edge was not found. Set CHROME_PATH to a local Chromium executable.');
}

const debugPort = 12500 + Math.floor(Math.random() * 400);
chromiumStderr = fs.createWriteStream(chromiumStderrPath, { flags: 'w' });
browser = spawn(chromePath, [
  options.headful ? '--new-window' : '--headless=new',
  '--disable-component-extensions-with-background-pages',
  '--disable-extensions',
  '--disable-features=Translate',
  '--no-default-browser-check',
  '--no-first-run',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileRoot}`,
  `--disk-cache-dir=${path.join(profileRoot, 'cache')}`,
  `--crash-dumps-dir=${path.join(artifactRoot, 'crash-dumps')}`,
  '--window-size=1600,1000',
  'about:blank'
], {
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
  env: { ...process.env, TEMP: profileRoot, TMP: profileRoot }
});
browser.stderr?.pipe(chromiumStderr);
browserExitPromise = new Promise((resolve) => {
  browser.once('exit', (code, signal) => {
    browserExit.code = code;
    browserExit.signal = signal;
    browserExit.at = new Date().toISOString();
    resolve({ code, signal });
  });
});

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
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP connection closed while ${pending.method} (command ${id}) was pending.`));
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
      this.pending.set(id, { resolve, reject, timer, method });
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

const waitForDebugger = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = response.ok ? await response.json() : [];
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(120);
  }
  throw new Error('Chrome DevTools endpoint did not start.');
};

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
const waitForCondition = async (expression, timeoutMs = 15_000, intervalMs = 35) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return true; } catch {}
    await delay(intervalMs);
  }
  return false;
};
const setViewport = (width, height, mobile = false, deviceScaleFactor = 1) => cdp.send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor, mobile, screenWidth: width, screenHeight: height,
  positionX: 0, positionY: 0, dontSetVisibleSize: false
});
const settle = (milliseconds = 80) => evaluate(`(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, ${milliseconds}));
  return { href: location.href, readyState: document.readyState };
})()`);
const navigateHref = async (href, { complete = true, settleMs = 80 } = {}) => {
  const target = new URL(href);
  const result = await cdp.send('Page.navigate', { url: target.href });
  if (result.errorText) throw new Error(`Navigation failed for ${target.href}: ${result.errorText}`);
  const expected = `${target.pathname}${target.search}${target.hash}`;
  const readyExpression = complete
    ? `location.pathname + location.search + location.hash === ${JSON.stringify(expected)} && document.readyState === 'complete'`
    : `location.pathname + location.search + location.hash === ${JSON.stringify(expected)} && document.documentElement !== null`;
  const ready = await waitForCondition(readyExpression, 30_000);
  if (!ready) throw new Error(`Page readiness timed out for ${target.href}.`);
  await settle(settleMs);
};
const screenshot = async (name, metadata = {}) => {
  const viewport = await evaluate(`({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })`).catch(() => ({}));
  const outputScale = Number.isFinite(metadata.outputScale) ? metadata.outputScale : 1;
  const capture = /** @type {Record<string, unknown>} */ ({
    format: 'png', fromSurface: true, captureBeyondViewport: false
  });
  // Chrome 151 on Windows can close the CDP target while allocating a single
  // 2880x1800 PNG surface. Keep the page rendered at DPR 2, but allow a
  // downsampled evidence file for that one visual audit.
  if (outputScale !== 1 && viewport.width > 0 && viewport.height > 0) {
    capture.clip = { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: outputScale };
  }
  const result = await cdp.send('Page.captureScreenshot', capture, 40_000);
  const directory = String(metadata.directory || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const safeName = String(name).replace(/[^a-z0-9а-яё._-]+/gi, '-').replace(/^-+|-+$/g, '');
  const filename = path.join(artifactRoot, directory, `${safeName}.png`);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, Buffer.from(result.data, 'base64'));
  const href = await evaluate('location.href').catch(() => '');
  captureManifest.push({
    branch: gitHead.branch,
    baselineSha,
    finalSha: gitHead.sha,
    route: metadata.route || href,
    flow: metadata.flow || name,
    viewport,
    outputScale,
    activationSource: metadata.activationSource || '',
    variant: metadata.variant || '',
    captureOffset: Number.isFinite(metadata.offset) ? metadata.offset : null,
    actualCaptureOffset: Number.isFinite(metadata.actualOffset) ? metadata.actualOffset : null,
    classification: options.externalOrigin ? 'external-local-origin-cdp' : 'repo-dist-cdp-chromium',
    console: runtimeErrors.length || runtimeWarnings.length
      ? `errors:${runtimeErrors.length},warnings:${runtimeWarnings.length}` : 'clean-at-capture',
    filename: path.relative(artifactRoot, filename).replace(/\\/g, '/')
  });
  return filename;
};
const analyzeH3MediaPixels = async (filename, geometry) => {
  const viewportWidth = Number(geometry?.viewport?.width || 0);
  const viewportHeight = Number(geometry?.viewport?.height || 0);
  const rect = geometry?.hostRect;
  const metadata = await sharp(filename).metadata();
  if (!metadata.width || !metadata.height || !viewportWidth || !viewportHeight || !rect?.width || !rect?.height) {
    return null;
  }
  const scaleX = metadata.width / viewportWidth;
  const scaleY = metadata.height / viewportHeight;
  const cssCrop = {
    left: Math.max(0, rect.left + rect.width * 0.09),
    top: Math.max(0, rect.top + rect.height * 0.13),
    width: rect.width * 0.82,
    height: rect.height * 0.55
  };
  const left = Math.max(0, Math.min(metadata.width - 1, Math.round(cssCrop.left * scaleX)));
  const top = Math.max(0, Math.min(metadata.height - 1, Math.round(cssCrop.top * scaleY)));
  const width = Math.max(1, Math.min(metadata.width - left, Math.round(cssCrop.width * scaleX)));
  const height = Math.max(1, Math.min(metadata.height - top, Math.round(cssCrop.height * scaleY)));
  const { data, info } = await sharp(filename)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let darkPixels = 0;
  let chromaticPixels = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    if (luminance < 210) darkPixels += 1;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 18) chromaticPixels += 1;
  }
  const pixels = data.length / info.channels;
  return {
    crop: { left, top, width, height },
    pixels,
    darkRatio: darkPixels / pixels,
    chromaticRatio: chromaticPixels / pixels
  };
};
const clearOriginStorage = async () => {
  // Storage.clearDataForOrigin is inconsistent about sessionStorage across
  // Chromium versions. Clear the live browsing context explicitly as well so
  // each cold-entry audit really models a fresh tab, including window.name.
  await evaluate(`(() => {
    try {
      if (location.origin === ${JSON.stringify(origin)}) {
        localStorage.clear();
        sessionStorage.clear();
        window.name = '';
      }
    } catch {}
  })()`).catch(() => {});
  await cdp.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'local_storage,session_storage'
  }).catch(() => {});
  storageEvents.length = 0;
};
const getTrace = () => evaluate(`(() => {
  try { return JSON.parse(localStorage.getItem(${JSON.stringify(TRACE_KEY)}) || '[]'); }
  catch { return []; }
})()`);
const stateSnapshot = () => evaluate(`(() => {
  const html = document.documentElement;
  const overlay = document.querySelector('[data-v2-page-transition]');
  const sheet = overlay?.querySelector('[data-v2-page-sheet]');
  const label = overlay?.querySelector('[data-v2-page-label]');
  const entry = document.querySelector('[data-v2-entry-root]');
  const rect = overlay?.getBoundingClientRect();
  const sheetRect = sheet?.getBoundingClientRect();
  const style = overlay ? getComputedStyle(overlay) : null;
  const sheetStyle = sheet ? getComputedStyle(sheet) : null;
  const labelStyle = label ? getComputedStyle(label) : null;
  const edge = overlay?.querySelector('[data-v2-page-edge="cover"]');
  const trail = overlay?.querySelector('[data-v2-page-trail="cover"]');
  const edgeStyle = edge ? getComputedStyle(edge) : null;
  const trailStyle = trail ? getComputedStyle(trail) : null;
  const rootStyle = getComputedStyle(html);
  const entranceRoot = document.querySelector('[data-v2-entrance-root]') || document.querySelector('[data-v2-motion-root]');
  const entranceRoles = Array.from(document.querySelectorAll(
    '[data-v2-entrance-role],[data-v2-entry-role],[data-v2-entry]'
  ));
  const revealGroups = Array.from(document.querySelectorAll('[data-v2-scroll-group],[data-v2-reveal]'));
  const pendingSelector = [
    '[data-v2-entrance-state="armed"]','[data-v2-entrance-state="waiting"]','[data-v2-entrance-state="revealing"]',
    '[data-v2-entrance-node="pending"]','[data-v2-entrance-node="revealing"]',
    '[data-v2-reveal-state="pending"]','[data-v2-reveal-state="revealing"]','[data-v2-scroll-state="pending"]',
    '.v2-entrance-pending','.hv2-reveal-pending'
  ].join(',');
  const pendingElements = Array.from(document.querySelectorAll(pendingSelector));
  const entrancePendingElements = Array.from(document.querySelectorAll(
    '[data-v2-entrance-node="pending"],[data-v2-entrance-node="revealing"],.v2-entrance-pending'
  ));
  const scrollPendingElements = Array.from(document.querySelectorAll(
    '[data-v2-reveal-state="pending"],[data-v2-reveal-state="revealing"],[data-v2-scroll-state="pending"]'
  ));
  const newMotionElements = [...new Set([...entranceRoles, ...revealGroups])];
  const newWillChange = newMotionElements.filter((element) => {
    const value = getComputedStyle(element).willChange;
    // These two elements keep the accepted local hero-scroll owner. H4 uses
    // individual opacity/translate/scale properties and must clean those up,
    // but it must not erase the pre-existing transform optimization.
    if (element.matches('[data-v2-hero-scroll-media], [data-v2-hero-scroll-copy]')) return false;
    return value && value !== 'auto';
  });
  const isVisuallyPresent = (element, elementStyle) => {
    if (!element || !elementStyle) return false;
    const bounds = element.getBoundingClientRect();
    return elementStyle.display !== 'none' && elementStyle.visibility !== 'hidden'
      && Number.parseFloat(elementStyle.opacity || '1') > .01 && bounds.width > 0 && bounds.height > 0;
  };
  const critical = document.querySelector('[data-v2-page-critical]');
  const criticalImage = critical instanceof HTMLImageElement ? critical : critical?.querySelector('img');
  return {
    href: location.href,
    pathname: location.pathname,
    pageBootstrap: html.dataset.v2PageBootstrap || '',
    pageBootstrapReason: html.dataset.v2PageBootstrapReason || '',
    pageState: html.dataset.v2PageState || overlay?.getAttribute('data-v2-page-state') || '',
    pageVariant: html.dataset.v2PageVariant || overlay?.getAttribute('data-v2-page-variant') || '',
    navigationId: html.dataset.v2PageNavigationId || html.dataset.v2NavigationId
      || overlay?.getAttribute('data-v2-page-navigation-id') || '',
    pageCriticalStatus: html.dataset.v2PageCriticalStatus || '',
    motionProfile: html.dataset.v2MotionProfile || entranceRoot?.getAttribute('data-v2-motion-profile') || '',
    entranceState: html.dataset.v2EntranceState || entranceRoot?.getAttribute('data-v2-entrance-state') || '',
    entranceSource: html.dataset.v2EntranceSource || entranceRoot?.getAttribute('data-v2-entrance-source') || '',
    entranceScope: html.dataset.v2EntranceScope || entranceRoot?.getAttribute('data-v2-entrance-scope') || '',
    activationId: html.dataset.v2EntranceActivationId || html.dataset.v2ActivationId
      || entranceRoot?.getAttribute('data-v2-entrance-activation-id')
      || entranceRoot?.getAttribute('data-v2-entrance-activation') || '',
    entryBootstrap: html.dataset.v2EntryBootstrap || '',
    entryState: entry?.getAttribute('data-v2-entry-state') || '',
    entrySession: (() => { try { return sessionStorage.getItem(${JSON.stringify(ENTRY_KEY)}); } catch { return 'storage-error'; } })(),
    token: (() => { try { return sessionStorage.getItem(${JSON.stringify(HANDOFF_KEY)}); } catch { return 'storage-error'; } })(),
    locked: html.classList.contains('v2-page-transition-locked') || html.dataset.v2PageLock === 'true'
      || html.classList.contains('v2-entry-scroll-locked') || html.dataset.v2ScrollLocked === 'true',
    overlayExists: Boolean(overlay),
    overlayFirst: Boolean(overlay && document.body?.firstElementChild === overlay),
    overlayAriaHidden: overlay?.getAttribute('aria-hidden') || '',
    overlayInert: Boolean(overlay?.inert || overlay?.hasAttribute('inert')),
    overlayDisplay: style?.display || '',
    overlayVisibility: style?.visibility || '',
    overlayOpacity: style ? Number.parseFloat(style.opacity) : -1,
    overlayBackground: style?.backgroundColor || '',
    overlayLeft: rect?.left ?? 0,
    overlayWidth: rect?.width ?? 0,
    sheetLeft: sheetRect?.left ?? 0,
    sheetRight: sheetRect?.right ?? 0,
    sheetWidth: sheetRect?.width ?? 0,
    sheetBackground: sheetStyle?.backgroundColor || '',
    sheetBackgroundImage: sheetStyle?.backgroundImage || '',
    sheetBackgroundSize: sheetStyle?.backgroundSize || '',
    sheetTransform: sheetStyle?.transform || '',
    sheetOpacity: sheetStyle ? Number.parseFloat(sheetStyle.opacity) : -1,
    sheetTransitionProperty: sheetStyle?.transitionProperty || '',
    overlayTransitionProperty: style?.transitionProperty || '',
    transitionLabel: label?.textContent?.trim() || '',
    transitionLabelWeight: labelStyle?.fontWeight || '',
    transitionLabelColor: labelStyle?.color || '',
    transitionLabelFontSize: labelStyle?.fontSize || '',
    transitionLabelLineClamp: labelStyle?.webkitLineClamp || '',
    transitionLabelMaxWidth: labelStyle?.maxWidth || '',
    edgeColor: edgeStyle?.backgroundColor || '',
    edgeWidth: edgeStyle?.width || '',
    trailWidth: trailStyle?.width || '',
    gridVisible: Boolean(sheetStyle && sheetStyle.backgroundImage !== 'none'
      && isVisuallyPresent(sheet, sheetStyle)),
    labelVisible: isVisuallyPresent(label, labelStyle),
    edgeVisible: isVisuallyPresent(edge, edgeStyle),
    trailVisible: isVisuallyPresent(trail, trailStyle),
    coverDuration: rootStyle.getPropertyValue('--v2-page-cover-duration').trim(),
    revealDuration: rootStyle.getPropertyValue('--v2-page-reveal-duration').trim(),
    sheetEasing: rootStyle.getPropertyValue('--v2-page-sheet-ease').trim(),
    calmCoverDuration: rootStyle.getPropertyValue('--v2-page-calm-cover-duration').trim(),
    calmRevealDuration: rootStyle.getPropertyValue('--v2-page-calm-reveal-duration').trim(),
    calmFailOpenDuration: rootStyle.getPropertyValue('--v2-page-calm-fail-open-duration').trim(),
    calmEasing: rootStyle.getPropertyValue('--v2-page-calm-ease').trim(),
    viewportWidth: innerWidth,
    criticalSrc: criticalImage ? (criticalImage.currentSrc || criticalImage.src || '') : '',
    criticalComplete: criticalImage?.complete ?? null,
    criticalNaturalWidth: criticalImage?.naturalWidth ?? null,
    horizontalOverflow: Math.max(0, html.scrollWidth - html.clientWidth),
    htmlOverflow: rootStyle.overflow,
    bodyOverflow: document.body ? getComputedStyle(document.body).overflow : '',
    pendingCount: pendingElements.length,
    entrancePendingCount: entrancePendingElements.length,
    scrollPendingCount: scrollPendingElements.length,
    pendingSamples: pendingElements.slice(0, 12).map((element) => ({
      tag: element.tagName.toLowerCase(),
      state: element.getAttribute('data-v2-entrance-state') || element.getAttribute('data-v2-reveal-state')
        || element.getAttribute('data-v2-scroll-state') || '',
      className: typeof element.className === 'string' ? element.className.slice(0, 160) : ''
    })),
    newWillChangeCount: newWillChange.length,
    newWillChange: newWillChange.slice(0, 12).map((element) => ({
      tag: element.tagName.toLowerCase(), value: getComputedStyle(element).willChange,
      role: element.getAttribute('data-v2-entrance-role') || element.getAttribute('data-v2-entry')
        || element.getAttribute('data-v2-reveal') || ''
    })),
    entranceRoleCount: entranceRoles.length,
    entranceRoles: entranceRoles.slice(0, 40).map((element) => {
      const computed = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        role: element.getAttribute('data-v2-entrance-role') || element.getAttribute('data-v2-entry-role')
          || element.getAttribute('data-v2-entry') || '',
        nodeState: element.getAttribute('data-v2-entrance-node') || '',
        opacity: Number.parseFloat(computed.opacity),
        transform: computed.transform,
        willChange: computed.willChange,
        top: bounds.top,
        bottom: bounds.bottom
      };
    }),
    revealGroupCount: revealGroups.length,
    layoutShift: window.__smu1H4LayoutShift || 0,
    entranceMarkCount: performance.getEntriesByName('v2:entrance-start').length,
    bodyOpacity: document.body ? Number.parseFloat(getComputedStyle(document.body).opacity) : -1,
    mainOpacity: document.querySelector('main') ? Number.parseFloat(getComputedStyle(document.querySelector('main')).opacity) : -1,
    bodyBackground: document.body ? getComputedStyle(document.body).backgroundColor : '',
    htmlBackground: rootStyle.backgroundColor
  };
})()`);
const waitUntilUsable = async (timeoutMs = 10_000) => {
  const ok = await waitForCondition(`(() => {
    const html = document.documentElement;
    const page = html.dataset.v2PageState || document.querySelector('[data-v2-page-transition]')?.getAttribute('data-v2-page-state') || '';
    const entry = document.querySelector('[data-v2-entry-root]')?.getAttribute('data-v2-entry-state') || '';
    const entrance = html.dataset.v2EntranceState
      || document.querySelector('[data-v2-entrance-root]')?.getAttribute('data-v2-entrance-state') || '';
    const pageDone = !['arrival','waiting','revealing','covering','covered','navigating'].includes(page);
    const entryDone = !['armed','logo','waiting','opening','assembling'].includes(entry);
    const entranceDone = !['armed','waiting','revealing'].includes(entrance);
    return pageDone && entryDone && entranceDone && !html.classList.contains('v2-page-transition-locked')
      && html.dataset.v2PageLock !== 'true' && !html.classList.contains('v2-entry-scroll-locked')
      && html.dataset.v2ScrollLocked !== 'true';
  })()`, timeoutMs);
  return ok ? stateSnapshot() : null;
};
const seedEntrySeenAndNavigate = async (href) => {
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      const id = 'h2-qa-tab';
      window.name = ${JSON.stringify(TAB_NAME_MARKER)} + id;
      sessionStorage.setItem(${JSON.stringify(TAB_KEY)}, id);
      sessionStorage.setItem(${JSON.stringify(ENTRY_KEY)}, 'seen');
    } catch {}`
  });
  try { await navigateHref(href); }
  finally { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: result.identifier }).catch(() => {}); }
};
const setReducedMotion = (enabled) => cdp.send('Emulation.setEmulatedMedia', {
  media: '',
  features: enabled ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : []
});
const fireRouteClick = (href, { double = false, label = 'Целевая страница' } = {}) => evaluate(`(() => {
  let link = document.querySelector('a[data-h2-qa-route-link]');
  if (!(link instanceof HTMLAnchorElement)) {
    link = document.createElement('a');
    link.dataset.h2QaRouteLink = '';
    link.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;';
    document.body.append(link);
  }
  link.href = ${JSON.stringify(href)};
  link.dataset.v2TransitionLabel = ${JSON.stringify(label)};
  link.removeAttribute('target');
  link.removeAttribute('download');
  delete link.dataset.v2Transition;
  link.click();
  ${double ? 'link.click();' : ''}
  return true;
})()`);
const readTokenEvents = () => storageEvents.filter((event) => event.key === HANDOFF_KEY);

const TRACE_BOOTSTRAP = `(() => {
  const key = ${JSON.stringify(TRACE_KEY)};
  const doc = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  window.__smu1H4LayoutShift = 0;
  let last = '';
  const push = (kind, extra = {}) => {
    try {
      const html = document.documentElement;
      const entry = document.querySelector?.('[data-v2-entry-root]');
      const entrance = document.querySelector?.('[data-v2-entrance-root]')
        || document.querySelector?.('[data-v2-motion-root]');
      const overlay = document.querySelector?.('[data-v2-page-transition]');
      const label = overlay?.querySelector?.('[data-v2-page-label]');
      const bootstrapOverlay = document.querySelector?.('[data-v2-page-bootstrap-overlay]');
      const bootstrapLabel = bootstrapOverlay?.querySelector?.('.v2-page-transition-bootstrap__label');
      const row = {
        at: Date.now(), performanceNow: performance.now(), timeOrigin: performance.timeOrigin,
        doc, kind, href: location.href,
        pageBootstrap: html?.dataset.v2PageBootstrap || '',
        pageState: html?.dataset.v2PageState || overlay?.getAttribute('data-v2-page-state') || '',
        pageVariant: html?.dataset.v2PageVariant || overlay?.getAttribute('data-v2-page-variant') || '',
        navigationId: html?.dataset.v2PageNavigationId || html?.dataset.v2NavigationId
          || overlay?.getAttribute('data-v2-page-navigation-id') || '',
        criticalStatus: html?.dataset.v2PageCriticalStatus || '',
        motionProfile: html?.dataset.v2MotionProfile || entrance?.getAttribute('data-v2-motion-profile') || '',
        entranceState: html?.dataset.v2EntranceState || entrance?.getAttribute('data-v2-entrance-state') || '',
        entranceSource: html?.dataset.v2EntranceSource || entrance?.getAttribute('data-v2-entrance-source') || '',
        entranceScope: html?.dataset.v2EntranceScope || entrance?.getAttribute('data-v2-entrance-scope') || '',
        activationId: html?.dataset.v2EntranceActivationId || html?.dataset.v2ActivationId
          || entrance?.getAttribute('data-v2-entrance-activation-id')
          || entrance?.getAttribute('data-v2-entrance-activation') || '',
        entryBootstrap: html?.dataset.v2EntryBootstrap || '',
        entryState: entry?.getAttribute('data-v2-entry-state') || '',
        transitionLabel: label?.textContent?.trim() || '',
        transitionLabelPresent: Boolean(label),
        bootstrapOverlayPresent: Boolean(bootstrapOverlay),
        bootstrapTransitionLabel: bootstrapLabel?.textContent?.trim() || '',
        pendingCount: document.querySelectorAll?.('[data-v2-entrance-node="pending"],[data-v2-reveal-state="pending"],[data-v2-scroll-state="pending"],.v2-entrance-pending,.hv2-reveal-pending').length || 0,
        entranceNodes: Array.from(document.querySelectorAll?.('[data-v2-entrance-role],[data-v2-entrance-runtime-role]') || [])
          .map((element) => ({
            role: element.getAttribute('data-v2-entrance-role') || element.getAttribute('data-v2-entrance-runtime-role') || '',
            runtime: element.hasAttribute('data-v2-entrance-runtime-role'),
            state: element.getAttribute('data-v2-entrance-node') || '',
            top: element.getBoundingClientRect().top
          })),
        willChangeCount: Array.from(document.querySelectorAll?.('[data-v2-entrance-role],[data-v2-entrance-runtime-role],[data-v2-reveal]') || [])
          .filter((element) => getComputedStyle(element).willChange !== 'auto').length,
        layoutShift: window.__smu1H4LayoutShift || 0,
        locked: Boolean(html?.classList.contains('v2-page-transition-locked') || html?.dataset.v2PageLock === 'true'
          || html?.classList.contains('v2-entry-scroll-locked') || html?.dataset.v2ScrollLocked === 'true'),
        ...extra
      };
      const signature = JSON.stringify([row.kind, row.href, row.pageBootstrap, row.pageState, row.criticalStatus,
        row.entryBootstrap, row.entryState, row.transitionLabel, row.transitionLabelPresent,
        row.bootstrapOverlayPresent, row.bootstrapTransitionLabel, row.locked, row.persisted,
        row.pageVariant, row.navigationId, row.entranceState, row.entranceSource, row.entranceScope,
        row.activationId, row.eventName, row.pendingCount, row.willChangeCount]);
      if (signature === last && kind === 'mutation') return;
      last = signature;
      const rows = JSON.parse(localStorage.getItem(key) || '[]');
      rows.push(row);
      localStorage.setItem(key, JSON.stringify(rows.slice(-2500)));
    } catch {}
  };
  const events = [
    'v2:entrance-ready','v2:page-covering','v2:page-covered','v2:page-revealing','v2:entrance-start',
    'v2:entrance-done','v2:entrance-fail-open','v2:page-fail-open','v2:page-done',
    'v2:prepare-bfcache','v2:entrance-cancel'
  ];
  events.forEach((eventName) => document.addEventListener(eventName, (event) => {
    const raw = event instanceof CustomEvent && event.detail && typeof event.detail === 'object'
      ? event.detail : {};
    const detail = {};
    for (const [name, value] of Object.entries(raw)) {
      if (['string','number','boolean'].includes(typeof value) || value === null) detail[name] = value;
    }
    try { performance.mark('h4-qa:' + eventName); } catch {}
    push('event', {
      eventName,
      detail,
      activationId: String(detail.activationId || ''),
      navigationId: String(detail.navigationId || ''),
      entranceSource: String(detail.source || ''),
      entranceScope: String(detail.scope || '')
    });
  }, { capture: true }));
  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (!entry.hadRecentInput) window.__smu1H4LayoutShift += entry.value || 0;
      });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  const observer = new MutationObserver(() => push('mutation'));
  observer.observe(document, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-v2-page-bootstrap','data-v2-page-state','data-v2-page-critical-status',
      'data-v2-page-variant','data-v2-page-navigation-id','data-v2-motion-profile',
      'data-v2-entrance-state','data-v2-entrance-source','data-v2-entrance-scope',
      'data-v2-entrance-activation-id','data-v2-entrance-activation','data-v2-entrance-node',
      'data-v2-scroll-state','data-v2-scroll-group-state','data-v2-entry-bootstrap','data-v2-entry-state',
      'data-v2-page-lock','data-v2-scroll-locked','class','style'] });
  document.addEventListener('DOMContentLoaded', () => push('dom-content-loaded'), { once: true });
  window.addEventListener('pagehide', (event) => push('pagehide', { persisted: event.persisted }));
  window.addEventListener('pageshow', (event) => push('pageshow', { persisted: event.persisted }));
  queueMicrotask(() => push('document-start'));
})();`;

const resetTrace = () => evaluate(`try { localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]'); } catch {}`);
const traceEvents = (trace, eventName) => trace.filter((row) => row.kind === 'event' && row.eventName === eventName);
const waitForTraceEvent = async (eventName, afterAt = 0, timeoutMs = 5000) => {
  const expression = `(() => {
    try {
      const rows = JSON.parse(localStorage.getItem(${JSON.stringify(TRACE_KEY)}) || '[]');
      return [...rows].reverse().find((row) => row.kind === 'event'
        && row.eventName === ${JSON.stringify(eventName)} && row.at >= ${Number(afterAt)}) || null;
    } catch { return null; }
  })()`;
  const found = await waitForCondition(`Boolean(${expression})`, timeoutMs, 5);
  return found ? evaluate(expression) : null;
};
const cleanupContract = (state) => state
  && !state.locked
  && state.entrancePendingCount === 0
  && state.newWillChangeCount === 0
  && !['armed', 'waiting', 'revealing'].includes(state.entranceState)
  && !['covering', 'covered', 'navigating', 'arrival', 'waiting', 'revealing'].includes(state.pageState)
  && state.htmlOverflow !== 'hidden'
  && state.bodyOverflow !== 'hidden';
const lifecycleContract = (trace, { expectedSource = '', expectedScope = '' } = {}) => {
  const readyRows = traceEvents(trace, 'v2:entrance-ready');
  const startRows = traceEvents(trace, 'v2:entrance-start');
  const terminalRows = trace.filter((row) => row.kind === 'event'
    && ['v2:entrance-done', 'v2:entrance-fail-open'].includes(row.eventName));
  const activations = [...new Set([...readyRows, ...startRows, ...terminalRows]
    .map((row) => row.activationId || row.detail?.activationId).filter(Boolean))];
  const activationChecks = activations.map((activationId) => {
    const ready = readyRows.filter((row) => (row.activationId || row.detail?.activationId) === activationId);
    const start = startRows.filter((row) => (row.activationId || row.detail?.activationId) === activationId);
    const terminal = terminalRows.filter((row) => (row.activationId || row.detail?.activationId) === activationId);
    const source = ready[0]?.entranceSource || ready[0]?.detail?.source || start[0]?.entranceSource || start[0]?.detail?.source || '';
    const scope = ready[0]?.entranceScope || ready[0]?.detail?.scope || start[0]?.entranceScope || start[0]?.detail?.scope || '';
    const pageReveals = traceEvents(trace, 'v2:page-revealing').filter((row) => row.doc === ready[0]?.doc);
    const transitionOrder = !source.startsWith('mpa-') || pageReveals.some((row) => (
      row.at >= ready[0]?.at && row.at <= start[0]?.at
    ));
    return {
      activationId,
      source,
      scope,
      ready: ready.length,
      start: start.length,
      terminal: terminal.length,
      ordered: ready.length === 1 && start.length === 1 && terminal.length === 1
        && ready[0].at <= start[0].at && start[0].at <= terminal[0].at && transitionOrder,
      productionMarkObserved: start[0]?.detail !== undefined
    };
  });
  const expectedRows = activationChecks.filter((row) => (!expectedSource || row.source === expectedSource)
    && (!expectedScope || row.scope === expectedScope));
  return {
    ok: activationChecks.length > 0 && activationChecks.every((row) => row.ordered)
      && (!expectedSource || expectedRows.length > 0),
    activations: activationChecks,
    expectedSource,
    expectedScope
  };
};
const captureAtOffsets = async ({
  eventRow,
  offsets,
  directory,
  prefix,
  flow,
  variant = '',
  activationSource = '',
  toleranceMs = 50
}) => {
  const frames = [];
  for (const offset of offsets) {
    const remaining = eventRow.at + offset - Date.now();
    if (remaining > 0) await delay(remaining);
    // Observe semantic state before captureScreenshot. The PNG RPC can take
    // hundreds of milliseconds and must not timestamp a later state as if it
    // belonged to the requested filmstrip offset.
    const actualOffset = Date.now() - eventRow.at;
    const state = await stateSnapshot();
    const withinTolerance = Math.abs(actualOffset - offset) <= toleranceMs;
    const filename = await screenshot(`${prefix}-${String(offset).padStart(4, '0')}ms`, {
      directory,
      flow,
      variant,
      activationSource,
      offset,
      actualOffset
    });
    frames.push({ offset, actualOffset, withinTolerance, filename, state });
  }
  return frames;
};

const captureTransitionReplays = async ({
  fromHref,
  targetHref,
  variant,
  phase,
  offsets,
  directory,
  prefix,
  flow,
  toleranceMs = 50
}) => {
  const eventName = phase === 'cover' ? 'v2:page-covering' : 'v2:page-revealing';
  const frames = [];
  let lastRun = null;
  for (const offset of offsets) {
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(fromHref);
    await waitUntilUsable(6500);
    await resetTrace();
    storageEvents.length = 0;
    const startedAt = Date.now();
    await fireRouteClick(targetHref, {
      label: variant === 'calm' ? '' : classify(targetHref).canonicalLabel
    });
    const eventRow = await waitForTraceEvent(eventName, startedAt, phase === 'cover' ? 2500 : 12_000);
    if (!eventRow) {
      frames.push({ offset, actualOffset: null, withinTolerance: false, filename: '', state: null, eventRow: null });
      lastRun = { eventRow: null, arrived: false, usable: null, trace: await getTrace(),
        finalState: await stateSnapshot(), tokenEvents: [...readTokenEvents()] };
      continue;
    }
    const remaining = eventRow.at + offset - Date.now();
    if (remaining > 0) await delay(remaining);
    const actualOffset = Date.now() - eventRow.at;
    const state = await stateSnapshot();
    const withinTolerance = Math.abs(actualOffset - offset) <= toleranceMs;
    const filename = await screenshot(`${prefix}-${String(offset).padStart(4, '0')}ms`, {
      directory,
      flow,
      variant,
      activationSource: phase === 'reveal' ? `mpa-${variant}` : '',
      offset,
      actualOffset
    });
    const arrived = await waitForCondition(
      `location.pathname + location.search + location.hash === ${JSON.stringify(targetValue(targetHref))}`,
      10_000,
      10
    );
    const usable = arrived ? await waitUntilUsable(6500) : null;
    lastRun = {
      eventRow,
      arrived,
      usable,
      trace: await getTrace(),
      finalState: await stateSnapshot(),
      tokenEvents: [...readTokenEvents()]
    };
    frames.push({ offset, actualOffset, withinTolerance, filename, state, eventRow });
  }
  return { frames, lastRun };
};

const captureH3CoveredAtEvent = async ({ fromHref, targetHref }) => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(fromHref);
  await waitUntilUsable(6500);
  await resetTrace();
  storageEvents.length = 0;

  const interceptionReady = await evaluate(`(() => {
    if (!window.navigation || typeof window.navigation.addEventListener !== 'function') return false;
    window.__smu1H4CoveredNavigation = { prevented: false, cancelable: false, destination: '' };
    window.navigation.addEventListener('navigate', (event) => {
      const destination = event.destination?.url || '';
      if (destination !== ${JSON.stringify(targetHref)}) return;
      window.__smu1H4CoveredNavigation.cancelable = event.cancelable;
      window.__smu1H4CoveredNavigation.destination = destination;
      if (!event.cancelable) return;
      event.preventDefault();
      window.__smu1H4CoveredNavigation.prevented = true;
    }, { once: true });
    return true;
  })()`);
  if (!interceptionReady) throw new Error('Navigation API is unavailable for H3 covered capture.');

  await fireRouteClick(targetHref, {
    label: classify(targetHref).canonicalLabel
  });
  const held = await waitForCondition(`window.__smu1H4CoveredNavigation?.prevented === true
    && document.documentElement.dataset.v2PageState === 'navigating'`, 3500, 5);
  const expectedLabel = classify(targetHref).canonicalLabel;
  const coveredGeometryExpression = `(() => {
    const html = document.documentElement;
    const overlay = document.querySelector('[data-v2-page-transition]');
    const sheet = document.querySelector('[data-v2-page-sheet]');
    const label = document.querySelector('[data-v2-page-label]');
    const visible = (element, requireBox = false) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > .01
        && (!requireBox || (rect.width > 1 && rect.height > 1));
    };
    const overlayRect = overlay?.getBoundingClientRect();
    const sheetRect = sheet?.getBoundingClientRect();
    const sheetStyle = sheet instanceof HTMLElement ? getComputedStyle(sheet) : null;
    let token = null;
    try { token = sessionStorage.getItem(${JSON.stringify(HANDOFF_KEY)}); }
    catch { token = 'storage-error'; }
    return {
      sampledAt: Date.now(),
      href: location.href,
      pageState: html.dataset.v2PageState || overlay?.getAttribute('data-v2-page-state') || '',
      pageVariant: html.dataset.v2PageVariant || overlay?.getAttribute('data-v2-page-variant') || '',
      locked: html.classList.contains('v2-page-transition-locked') || html.dataset.v2PageLock === 'true',
      overlayWidth: overlayRect?.width || 0,
      sheetLeft: sheetRect?.left ?? Number.POSITIVE_INFINITY,
      sheetRight: sheetRect?.right ?? Number.NEGATIVE_INFINITY,
      sheetBackgroundImage: sheetStyle?.backgroundImage || '',
      sheetBackgroundSize: sheetStyle?.backgroundSize || '',
      gridVisible: Boolean(sheetStyle && sheetStyle.backgroundImage !== 'none'
        && sheetStyle.backgroundImage.includes('linear-gradient')),
      labelVisible: visible(label, true) && label?.textContent?.trim() === ${JSON.stringify(expectedLabel)},
      transitionLabel: label?.textContent?.trim() || '',
      token,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      interception: window.__smu1H4CoveredNavigation || null
    };
  })()`;
  const geometry = await evaluate(coveredGeometryExpression);
  const filename = held ? await screenshot('sheet-03-covered-event', {
    directory: 'final/transitions/h3',
    flow: 'home-to-topiary-covered-event',
    variant: 'h3',
    offset: 300
  }) : '';
  const postCaptureGeometry = held ? await evaluate(coveredGeometryExpression) : null;

  const outgoingTrace = await getTrace();
  const covering = traceEvents(outgoingTrace, 'v2:page-covering')[0]
    || outgoingTrace.find((row) => row.pageState === 'covering');
  const covered = traceEvents(outgoingTrace, 'v2:page-covered')[0]
    || outgoingTrace.find((row) => row.pageState === 'covered');
  const actualOffset = covering && Number.isFinite(geometry?.sampledAt)
    ? geometry.sampledAt - covering.at : null;
  const captureEndOffset = covering && Number.isFinite(postCaptureGeometry?.sampledAt)
    ? postCaptureGeometry.sampledAt - covering.at : null;
  const coveredEventOffset = covering && covered ? covered.at - covering.at : null;
  if (filename) {
    const capture = captureManifest.at(-1);
    if (capture?.filename.endsWith('sheet-03-covered-event.png')) {
      capture.actualCaptureOffset = actualOffset;
      capture.captureWindowEndOffset = captureEndOffset;
      capture.coveredEventOffset = coveredEventOffset;
    }
  }

  const manualNavigation = await cdp.send('Page.navigate', { url: targetHref });
  if (manualNavigation.errorText) {
    throw new Error(`H3 covered continuation failed: ${manualNavigation.errorText}`);
  }

  const arrived = await waitForCondition(
    `location.pathname + location.search + location.hash === ${JSON.stringify(targetValue(targetHref))}`,
    10_000,
    10
  );
  const usable = arrived ? await waitUntilUsable(6500) : null;
  const trace = await getTrace();
  const arrivalProof = arrived ? await evaluate(`(() => {
    const html = document.documentElement;
    let token = null;
    try { token = sessionStorage.getItem(${JSON.stringify(HANDOFF_KEY)}); }
    catch { token = 'storage-error'; }
    return {
      handoffConsumed: html.dataset.v2PageHandoffConsumed === 'true',
      bootstrapReason: html.dataset.v2PageBootstrapReason || '',
      navigationId: html.dataset.v2PageNavigationId || '',
      pageVariant: html.dataset.v2PageVariant || '',
      token
    };
  })()`) : null;
  return {
    filename,
    geometry,
    postCaptureGeometry,
    actualOffset,
    captureEndOffset,
    coveredEventOffset,
    held,
    arrived,
    usable: Boolean(usable),
    trace,
    arrivalProof,
    tokenEvents: [...readTokenEvents()]
  };
};

const cssTimeMs = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return normalized.endsWith('ms') ? numeric : numeric * 1000;
};

const captureDirectEntranceReplays = async ({
  href,
  offsets,
  directory,
  prefix,
  flow,
  tabId
}) => {
  const frames = [];
  for (const offset of offsets) {
    await clearOriginStorage();
    await evaluate(`(() => {
      window.name = ${JSON.stringify(TAB_NAME_MARKER)} + ${JSON.stringify(tabId)};
      sessionStorage.setItem(${JSON.stringify(TAB_KEY)}, ${JSON.stringify(tabId)});
      sessionStorage.setItem(${JSON.stringify(ENTRY_KEY)}, 'seen');
      sessionStorage.removeItem(${JSON.stringify(HANDOFF_KEY)});
      localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]');
    })()`);
    const replayUrl = new URL(href);
    replayUrl.searchParams.set('h4-frame', String(offset));
    replayUrl.searchParams.set('h4-replay', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const navigationStartedAt = Date.now();
    const navigation = await cdp.send('Page.navigate', { url: replayUrl.href });
    if (navigation.errorText) throw new Error(`Entrance replay navigation failed: ${navigation.errorText}`);
    const start = await waitForTraceEvent('v2:entrance-start', navigationStartedAt, 5000);
    if (!start) {
      frames.push({ offset, actualOffset: null, filename: '', state: null, start: null, trace: [], usableState: null });
      continue;
    }
    const remaining = start.at + offset - Date.now();
    if (remaining > 0) await delay(remaining);
    // Sample state before the PNG RPC: captureScreenshot can cost hundreds of
    // milliseconds and must not move the semantic observation timestamp.
    const actualOffset = Date.now() - start.at;
    const state = await stateSnapshot();
    const filename = await screenshot(`${prefix}-${String(offset).padStart(4, '0')}ms`, {
      directory,
      flow,
      activationSource: start.entranceSource || start.detail?.source || 'direct',
      offset,
      actualOffset
    });
    const usableState = await waitUntilUsable(5000);
    const trace = await getTrace();
    frames.push({ offset, actualOffset, filename, state, start, trace, usableState });
  }
  return frames;
};

const introAudit = async (id, href) => {
  await clearOriginStorage();
  await navigateHref(href, { complete: false, settleMs: 30 });
  const armed = await waitForCondition(`(() => {
    const html = document.documentElement;
    const state = document.querySelector('[data-v2-entry-root]')?.getAttribute('data-v2-entry-state') || '';
    return html.dataset.v2EntryBootstrap === 'armed' || ['logo','waiting','opening','assembling'].includes(state);
  })()`, 2500);
  const early = await stateSnapshot();
  const baselineFile = await screenshot(`first-entry-${id}`, {
    directory: 'baseline-smu1', flow: `first-entry-${id}`, activationSource: 'first-entry'
  });
  const usable = await waitUntilUsable(10_000);
  const trace = await getTrace();
  traceEvidence.push({ flow: `first-entry-${id}`, trace });
  const lifecycle = lifecycleContract(trace, { expectedSource: 'first-entry', expectedScope: 'hero' });
  const thisPath = new URL(href).pathname;
  const states = trace.filter((row) => new URL(row.href).pathname === thisPath).map((row) => row.entryState).filter(Boolean);
  record(`entry.${id}`, armed && early.overlayExists && early.entrySession === 'seen' && Boolean(usable)
    && states.some((state) => ['logo','waiting','opening','assembling'].includes(state))
    && lifecycle.ok && lifecycle.activations.length === 1
    && cleanupContract(usable) && usable.horizontalOverflow <= 1,
  { href, armed, early, baselineFile, lifecycle, states: [...new Set(states)], usable });
};

const invalidTokenAudit = async (id, token, href) => {
  await clearOriginStorage();
  const seed = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      const id = 'h2-qa-tab';
      window.name = ${JSON.stringify(TAB_NAME_MARKER)} + id;
      sessionStorage.setItem(${JSON.stringify(TAB_KEY)}, id);
      sessionStorage.setItem(${JSON.stringify(ENTRY_KEY)}, 'seen');
      sessionStorage.setItem(${JSON.stringify(HANDOFF_KEY)}, ${JSON.stringify(token)});
    } catch {}`
  });
  try { await navigateHref(href); }
  finally { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier }).catch(() => {}); }
  await settle(160);
  const state = await stateSnapshot();
  const trace = await getTrace();
  traceEvidence.push({ flow: `invalid-token-${id}`, trace });
  const arrivalStates = trace.filter((row) => ['arrival','waiting','revealing'].includes(row.pageState));
  const expectedReason = id === 'mismatched' ? 'target-mismatch'
    : id === 'stale' ? 'stale-token' : 'invalid-token';
  record(`token.${id}`, arrivalStates.length === 0 && !state.locked
    && !['arrival','waiting','revealing'].includes(state.pageState) && state.token === null
    && state.pageBootstrapReason === expectedReason,
  { state, expectedReason, arrivalStates, consumed: state.token === null });
};

const consumedTokenReplayAudit = async () => {
  await clearOriginStorage();
  storageEvents.length = 0;
  const fixture = handoffFixture({
    fromRoute: routes.home,
    toRoute: routes.about,
    navigationId: 'h4-consumed-once'
  });
  const seed = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      const id = 'h4-consumed-tab';
      window.name = ${JSON.stringify(TAB_NAME_MARKER)} + id;
      sessionStorage.setItem(${JSON.stringify(TAB_KEY)}, id);
      sessionStorage.setItem(${JSON.stringify(ENTRY_KEY)}, 'seen');
      sessionStorage.setItem(${JSON.stringify(HANDOFF_KEY)}, ${JSON.stringify(JSON.stringify(fixture))});
    } catch {}`
  });
  try { await navigateHref(hrefFor(routes.about)); }
  finally { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier }).catch(() => {}); }
  await waitUntilUsable(6000);
  const firstTrace = await getTrace();
  const firstState = await stateSnapshot();
  const accepted = firstTrace.some((row) => row.pageBootstrap === 'arrival' || row.pageState === 'arrival');
  await resetTrace();
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntilUsable(6000);
  const reloadTrace = await getTrace();
  const reloadState = await stateSnapshot();
  const replayed = reloadTrace.some((row) => ['arrival', 'waiting', 'revealing'].includes(row.pageState)
    && row.pageVariant === 'h3');
  const reloadLifecycle = lifecycleContract(reloadTrace, { expectedSource: 'reload' });
  record('token.consumed-cannot-replay', accepted && firstState.token === null
    && !replayed && reloadState.token === null && reloadLifecycle.ok && cleanupContract(reloadState),
  { fixture, accepted, replayed, reloadLifecycle, firstState, reloadState });
};

const hashEntrySkipAudit = async () => {
  await clearOriginStorage();
  const hashHref = `${hrefFor(routes.contacts)}#main-content`;
  await navigateHref(hashHref);
  await settle(140);
  const skipped = await stateSnapshot();
  const traceStart = (await getTrace()).length;
  await navigateHref(hrefFor(routes.home));
  await settle(180);
  const next = await stateSnapshot();
  const nextTrace = (await getTrace()).slice(traceStart);
  const repeated = nextTrace.some((row) => ['logo','waiting','opening','assembling'].includes(row.entryState));
  record('entry.hash-skip-consumes-session', skipped.entryBootstrap === 'skipped'
    && skipped.entrySession === 'seen' && !skipped.locked
    && ['static','skipped','fail-open'].includes(next.entryBootstrap) && !repeated && !next.locked,
  { hashHref, skipped, next, nextStates: nextTrace.map((row) => row.entryState).filter(Boolean) });
};

const clickFilterAudit = async () => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.contacts));
  await waitUntilUsable();
  const currentHref = await evaluate('location.href');
  const base = new URL(currentHref);
  const cases = [
    { id: 'current-url', href: currentHref },
    { id: 'same-page-hash', href: `${base.origin}${base.pathname}${base.search}#main-content` },
    { id: 'same-page-query', href: `${base.origin}${base.pathname}?h2=query-only` },
    { id: 'ctrl-click', href: hrefFor(routes.about), ctrlKey: true },
    { id: 'meta-click', href: hrefFor(routes.about), metaKey: true },
    { id: 'shift-click', href: hrefFor(routes.about), shiftKey: true },
    { id: 'alt-click', href: hrefFor(routes.about), altKey: true },
    { id: 'middle-click', href: hrefFor(routes.about), button: 1 },
    { id: 'target-blank', href: hrefFor(routes.about), target: '_blank' },
    { id: 'download', href: `${base.origin}${primaryBase}assets/brand/favicon.svg`, download: true },
    { id: 'external-http', href: 'https://example.invalid/h2' },
    { id: 'tel', href: 'tel:+79129735006' },
    { id: 'mailto', href: 'mailto:qa@example.invalid' },
    { id: 'external-protocol', href: 'tg://resolve?domain=smu1build' },
    { id: 'assets', href: `${base.origin}${primaryBase}assets/brand/favicon.svg` },
    { id: 'uploads', href: `${base.origin}${primaryBase}uploads/h2-qa.jpg` },
    { id: 'admin', href: `${base.origin}${primaryBase}admin/` },
    { id: 'api', href: `${base.origin}${primaryBase}api/h2-qa` },
    { id: 'design-lab', href: `${base.origin}${primaryBase}design-lab/home-final/` },
    { id: 'compat-lavochki', href: `${base.origin}${primaryBase}lavochki-i-skameyki/` },
    { id: 'compat-urny', href: `${base.origin}${primaryBase}urny/` },
    { id: 'compat-navesy', href: `${base.origin}${primaryBase}navesy/` },
    { id: 'explicit-opt-out', href: hrefFor(routes.about), optOut: true }
  ];
  const results = await evaluate(`(async () => {
    const cases = ${JSON.stringify(cases)};
    const results = [];
    for (const spec of cases) {
      try { sessionStorage.removeItem(${JSON.stringify(HANDOFF_KEY)}); } catch {}
      const anchor = document.createElement('a');
      anchor.href = spec.href;
      anchor.dataset.h2QaFilter = spec.id;
      if (spec.target) anchor.target = spec.target;
      if (spec.download) anchor.download = 'h2-qa';
      if (spec.optOut) anchor.dataset.v2Transition = 'off';
      document.body.append(anchor);
      const preventDefault = (event) => {
        if (event.target === anchor) event.preventDefault();
      };
      document.addEventListener('click', preventDefault);
      const before = document.documentElement.dataset.v2PageState
        || document.querySelector('[data-v2-page-transition]')?.getAttribute('data-v2-page-state') || '';
      anchor.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, button: spec.button || 0,
        ctrlKey: Boolean(spec.ctrlKey), metaKey: Boolean(spec.metaKey),
        shiftKey: Boolean(spec.shiftKey), altKey: Boolean(spec.altKey)
      }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const after = document.documentElement.dataset.v2PageState
        || document.querySelector('[data-v2-page-transition]')?.getAttribute('data-v2-page-state') || '';
      let token = null;
      try { token = sessionStorage.getItem(${JSON.stringify(HANDOFF_KEY)}); } catch { token = 'storage-error'; }
      results.push({ id: spec.id, before, after, token,
        locked: document.documentElement.classList.contains('v2-page-transition-locked')
          || document.documentElement.dataset.v2PageLock === 'true' });
      document.removeEventListener('click', preventDefault);
      anchor.remove();
    }
    return results;
  })()`);
  const formResult = await evaluate(`(async () => {
    try { sessionStorage.removeItem(${JSON.stringify(HANDOFF_KEY)}); } catch {}
    const form = document.createElement('form');
    form.action = ${JSON.stringify(hrefFor(routes.about))};
    form.method = 'get';
    document.body.append(form);
    const prevent = (event) => event.preventDefault();
    form.addEventListener('submit', prevent);
    form.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 80));
    let token = null;
    try { token = sessionStorage.getItem(${JSON.stringify(HANDOFF_KEY)}); } catch { token = 'storage-error'; }
    const result = { token, locked: document.documentElement.classList.contains('v2-page-transition-locked')
      || document.documentElement.dataset.v2PageLock === 'true' };
    form.removeEventListener('submit', prevent);
    form.remove();
    return result;
  })()`);
  const invalid = results.filter((item) => item.token !== null || item.locked || ['covering','covered','navigating'].includes(item.after));
  record('click-filter.matrix', invalid.length === 0 && formResult.token === null && !formResult.locked,
    { audited: results.length + 1, invalid, formResult, results });
};

const transitionFilmstripAudit = async () => {
  let filmstripCriticalPath = '';
  let directPlaceholderAudit = null;
  if (!options.externalOrigin) {
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.deep));
    await waitUntilUsable();
    const probe = await stateSnapshot();
    if (probe.criticalSrc) filmstripCriticalPath = new URL(probe.criticalSrc).pathname;
    directPlaceholderAudit = await evaluate(`(() => {
      const host = document.querySelector('[data-v2-transition-placeholder]');
      const url = host?.dataset.v2TransitionPlaceholderSrc || '';
      const absoluteUrl = url ? new URL(url, location.href).href : '';
      return {
        url: absoluteUrl,
        requested: Boolean(absoluteUrl && performance.getEntriesByType('resource').some((entry) => entry.name === absoluteUrl)),
        preloadPresent: Boolean(document.querySelector('[data-v2-transition-placeholder-preload]'))
      };
    })()`);
  }
  record('transition.placeholder-not-requested-on-direct-load', options.externalOrigin
    || Boolean(directPlaceholderAudit?.url && !directPlaceholderAudit.requested && !directPlaceholderAudit.preloadPresent),
  { skipped: options.externalOrigin, directPlaceholderAudit });
  // The controller intentionally keeps the exact `covered` state for only
  // one animation frame before navigation. Hold the real navigation after
  // that semantic event so captureScreenshot cannot drift into the new document.
  const coveredCapture = await captureH3CoveredAtEvent({
    fromHref: hrefFor(routes.home),
    targetHref: hrefFor(routes.deep)
  });
  const coveredGeometry = coveredCapture.geometry;
  const coveredPostGeometry = coveredCapture.postCaptureGeometry;
  const coveredExpectedLabel = classify(hrefFor(routes.deep)).canonicalLabel;
  let coveredToken = null;
  try { coveredToken = JSON.parse(coveredGeometry?.token || 'null'); } catch {}
  const coveredLifecycle = lifecycleContract(coveredCapture.trace, {
    expectedSource: 'mpa-h3',
    expectedScope: 'hero'
  });
  const coveredTokenAdded = coveredCapture.tokenEvents.some((event) => ['added','updated'].includes(event.type));
  const coveredTokenRemoved = coveredCapture.tokenEvents.some((event) => event.type === 'removed');
  const coveredSemanticEvent = traceEvents(coveredCapture.trace, 'v2:page-covered')
    .some((row) => row.doc === coveredCapture.trace.find((item) => item.pageState === 'covering')?.doc);
  const coveredFrameVerified = Boolean(coveredCapture.filename && coveredCapture.held
    && coveredCapture.arrived
    && coveredCapture.usable && coveredGeometry?.href === hrefFor(routes.home)
    && coveredGeometry?.pageState === 'navigating'
    && coveredGeometry?.pageVariant === 'h3'
    && coveredGeometry?.locked
    && coveredGeometry?.interception?.cancelable
    && coveredGeometry?.interception?.prevented
    && coveredGeometry?.sheetLeft <= 3
    && coveredGeometry?.sheetRight >= coveredGeometry?.overlayWidth - 3
    && coveredGeometry?.gridVisible
    && coveredGeometry?.labelVisible
    && coveredGeometry?.transitionLabel === coveredExpectedLabel
    && coveredPostGeometry?.href === coveredGeometry.href
    && coveredPostGeometry?.pageState === 'navigating'
    && coveredPostGeometry?.locked
    && coveredPostGeometry?.sheetLeft <= 3
    && coveredPostGeometry?.sheetRight >= coveredPostGeometry?.overlayWidth - 3
    && coveredPostGeometry?.gridVisible
    && coveredPostGeometry?.labelVisible
    && coveredPostGeometry?.token === coveredGeometry.token
    && coveredToken?.version === TOKEN_VERSION
    && coveredToken?.variant === 'h3'
    && coveredToken?.target === targetValue(hrefFor(routes.deep))
    && coveredToken?.label === coveredExpectedLabel
    && coveredSemanticEvent
    && coveredCapture.actualOffset >= 250
    && coveredCapture.actualOffset <= 360
    && coveredCapture.captureEndOffset >= coveredCapture.actualOffset
    && coveredCapture.captureEndOffset < 1000
    && coveredCapture.coveredEventOffset >= 250
    && coveredCapture.coveredEventOffset <= 360
    && coveredCapture.arrivalProof?.handoffConsumed
    && coveredCapture.arrivalProof?.bootstrapReason === 'valid-token'
    && coveredCapture.arrivalProof?.navigationId === coveredToken?.navigationId
    && coveredCapture.arrivalProof?.pageVariant === 'h3'
    && coveredCapture.arrivalProof?.token === null
    && coveredTokenAdded && coveredTokenRemoved
    && coveredLifecycle.ok);
  const coveredFile = coveredFrameVerified ? coveredCapture.filename : '';

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.home));
  await waitUntilUsable();
  await evaluate(`try { localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]'); sessionStorage.removeItem(${JSON.stringify(ENTRY_KEY)}); } catch {}`);
  storageEvents.length = 0;
  const oldHref = await evaluate('location.href');
  const targetHref = hrefFor(routes.deep);
  const targetLabel = classify(targetHref).canonicalLabel || 'Топиарии';
  const h3Capture = { directory: 'final/transitions/h3', flow: 'home-to-topiary', variant: 'h3' };
  const files = [];
  files.push(await screenshot('sheet-01-old-page', h3Capture));
  if (filmstripCriticalPath) configureFault(filmstripCriticalPath, 'delay', 900);
  await fireRouteClick(targetHref, { double: true, label: targetLabel });
  const covering = await waitForCondition(`(() => {
    const overlay = document.querySelector('[data-v2-page-transition]');
    const state = document.documentElement.dataset.v2PageState || overlay?.getAttribute('data-v2-page-state');
    return location.href === ${JSON.stringify(oldHref)} && state === 'covering';
  })()`, 2000);
  const partial = await waitForCondition(`(() => {
    const sheet = document.querySelector('[data-v2-page-sheet]');
    if (!sheet) return false;
    const rect = sheet.getBoundingClientRect();
    const coverage = Math.max(0, Math.min(1, (innerWidth - rect.left) / Math.max(1, innerWidth)));
    return location.href === ${JSON.stringify(oldHref)} && coverage >= .25 && coverage <= .62;
  })()`, 800, 8);
  if (partial) files.push(await screenshot('sheet-02-cover-35-percent', h3Capture));
  if (coveredFile) files.push(coveredFile);
  const arrived = await waitForCondition(`location.pathname === ${JSON.stringify(new URL(targetHref).pathname)}
    && ['arrival','waiting','revealing','done','fail-open'].includes(document.documentElement.dataset.v2PageState || '')`, 10_000);
  if (arrived) {
    const arrivalFile = await screenshot('sheet-04-incoming-arrival', h3Capture);
    files.push(arrivalFile);
  }
  const revealing = await waitForCondition(`document.documentElement.dataset.v2PageState === 'revealing'`, 3000, 12);
  let revealingMediaVisual = null;
  if (revealing) {
    await delay(220);
    revealingMediaVisual = await evaluate(`(() => {
      const image = document.querySelector('.immersive-direction-hero__media [data-v2-page-critical]')
        || document.querySelector('[data-v2-page-critical]');
      const host = image?.closest('[data-v2-transition-placeholder]');
      const placeholder = host?.querySelector('[data-v2-transition-placeholder-layer]');
      const placeholderImage = placeholder?.querySelector('[data-v2-transition-placeholder-image]');
      const hostStyle = host ? getComputedStyle(host) : null;
      const imageStyle = image ? getComputedStyle(image) : null;
      const placeholderStyle = placeholder ? getComputedStyle(placeholder) : null;
      const placeholderImageStyle = placeholderImage ? getComputedStyle(placeholderImage) : null;
      const highImages = Array.from(document.querySelectorAll('img[fetchpriority="high"]'));
      const hostOpacity = Number.parseFloat(hostStyle?.opacity || '0');
      const imageOpacity = Number.parseFloat(imageStyle?.opacity || '0');
      const actualVisible = Boolean(image && image.complete && image.naturalWidth > 0 && !image.hidden
        && imageStyle?.display !== 'none' && imageStyle?.visibility !== 'hidden'
        && imageOpacity > 0.01 && hostOpacity > 0.01);
      const placeholderLoaded = Boolean(placeholderImage?.complete && placeholderImage.naturalWidth > 0);
      const placeholderVisible = Boolean(host && placeholder && placeholderImage && hostOpacity > 0.5
        && placeholderStyle?.display !== 'none' && placeholderStyle?.visibility !== 'hidden'
        && placeholderImageStyle?.display !== 'none' && placeholderImageStyle?.visibility !== 'hidden'
        && placeholderLoaded);
      return {
        actualVisible,
        placeholderVisible,
        placeholderSource: placeholderImage?.currentSrc || placeholderImage?.src || '',
        placeholderLoaded,
        placeholderNaturalWidth: placeholderImage?.naturalWidth ?? null,
        placeholderFetchPriority: placeholderImage?.fetchPriority || '',
        semanticFetchPriority: image?.fetchPriority || '',
        highImageCount: highImages.length,
        preloadPresent: Boolean(document.querySelector('[data-v2-transition-placeholder-preload]')),
        preloadState: host?.getAttribute('data-v2-transition-placeholder-preload') || '',
        hostOpacity,
        imageOpacity,
        imageComplete: image?.complete ?? null,
        imageNaturalWidth: image?.naturalWidth ?? null,
        imageState: image?.getAttribute('data-v2-image-state') || '',
        hostState: host?.getAttribute('data-v2-media-state') || '',
        currentSrc: image?.currentSrc || image?.src || '',
        pageBootstrap: document.documentElement.dataset.v2PageBootstrap || '',
        pageState: document.documentElement.dataset.v2PageState || '',
        entranceNode: host?.getAttribute('data-v2-entrance-node') || '',
        hostClass: host?.className || '',
        hostMatchesArrivalRule: Boolean(host?.matches('[data-v2-reveal][data-v2-transition-placeholder].v2-image-awaiting')),
        hostRect: host ? (() => {
          const rect = host.getBoundingClientRect();
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        })() : null,
        placeholderRect: placeholder ? (() => {
          const rect = placeholder.getBoundingClientRect();
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        })() : null,
        placeholderStyle: placeholderStyle ? {
          opacity: placeholderStyle.opacity,
          position: placeholderStyle.position,
          zIndex: placeholderStyle.zIndex,
          inset: placeholderStyle.inset,
          transform: placeholderStyle.transform
        } : null,
        placeholderImageStyle: placeholderImageStyle ? {
          opacity: placeholderImageStyle.opacity,
          objectFit: placeholderImageStyle.objectFit,
          objectPosition: placeholderImageStyle.objectPosition,
          transform: placeholderImageStyle.transform
        } : null,
        paintStack: host ? (() => {
          const rect = host.getBoundingClientRect();
          const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width * 0.68));
          const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height * 0.42));
          return document.elementsFromPoint(x, y).slice(0, 8).map((element) => ({
            tag: element.tagName,
            className: String(element.className || ''),
            placeholder: element.hasAttribute('data-v2-transition-placeholder-layer'),
            responsivePicture: element.hasAttribute('data-v2-responsive-picture')
          }));
        })() : [],
        viewport: { width: innerWidth, height: innerHeight }
      };
    })()`);
    const revealingFile = await screenshot('sheet-05-revealing', h3Capture);
    files.push(revealingFile);
    revealingMediaVisual.filmstripCriticalPath = filmstripCriticalPath;
    revealingMediaVisual.fault = { hits: serverFault.hits, pathname: serverFault.pathname, mode: serverFault.mode };
    revealingMediaVisual.pixels = await analyzeH3MediaPixels(revealingFile, revealingMediaVisual);
    await writeFile(
      path.join(artifactRoot, 'final', 'transitions', 'h3', 'reveal-media.json'),
      JSON.stringify(revealingMediaVisual, null, 2)
    );
  }
  const usable = await waitUntilUsable(5000);
  const readyMediaVisual = await evaluate(`(() => {
    const image = document.querySelector('.immersive-direction-hero__media [data-v2-page-critical]')
      || document.querySelector('[data-v2-page-critical]');
    const host = image?.closest('[data-v2-transition-placeholder]');
    const layer = host?.querySelector('[data-v2-transition-placeholder-layer]');
    const picture = image?.closest('[data-v2-responsive-picture]');
    const layerStyle = layer ? getComputedStyle(layer) : null;
    const pictureStyle = picture ? getComputedStyle(picture) : null;
    return {
      imageComplete: image?.complete ?? null,
      imageNaturalWidth: image?.naturalWidth ?? null,
      hostClass: host?.className || '',
      hostState: host?.getAttribute('data-v2-media-state') || '',
      imageState: image?.getAttribute('data-v2-image-state') || '',
      layerDisplay: layerStyle?.display || '',
      pictureVisibility: pictureStyle?.visibility || '',
      placeholderImages: layer?.querySelectorAll('[data-v2-transition-placeholder-image]').length || 0,
      fallbackExposed: Boolean(Array.from(host?.querySelectorAll('[data-v2-image-fallback]') || [])
        .some((fallback) => fallback.getAttribute('aria-hidden') !== 'true')),
      liveStatusExposed: Boolean(Array.from(host?.querySelectorAll('[role="status"]') || [])
        .some((status) => status.getAttribute('aria-hidden') !== 'true'))
    };
  })()`);
  clearFault();
  files.push(await screenshot('sheet-06-ready-hero', h3Capture));

  const trace = await getTrace();
  traceEvidence.push({ flow: 'h3-home-to-topiary', trace });
  const pageStates = trace.filter((row) => row.pageState).map((row) => row.pageState);
  const targetRows = trace.filter((row) => {
    try { return new URL(row.href).pathname === new URL(targetHref).pathname; } catch { return false; }
  });
  const forbiddenLogo = targetRows.filter((row) => ['logo','waiting','opening','assembling'].includes(row.entryState));
  const labelledTransitionRows = trace.filter((row) => row.transitionLabelPresent && (row.locked || row.criticalStatus)
    && ['covering','covered','navigating','arrival','waiting','revealing'].includes(row.pageState));
  const labelsAcrossDocuments = new Set(labelledTransitionRows.map((row) => row.transitionLabel).filter(Boolean));
  const blankTransitionRows = labelledTransitionRows.filter((row) => !row.transitionLabel);
  const labelledDocuments = new Set(labelledTransitionRows.map((row) => row.doc));
  const bootstrapLabelRows = targetRows.filter((row) => row.bootstrapOverlayPresent);
  const coveringRows = trace.filter((row) => row.pageState === 'covering');
  const coveringDocuments = new Set(coveringRows.map((row) => row.doc));
  const coveredRow = trace.find((row) => row.pageState === 'covered');
  const revealingRow = trace.find((row) => row.pageState === 'revealing');
  const doneRow = trace.find((row) => row.pageState === 'done'
    && row.doc === revealingRow?.doc && row.at >= revealingRow.at);
  const tokenEvents = readTokenEvents();
  const tokenWrites = tokenEvents.filter((event) => ['added','updated'].includes(event.type));
  const setEvent = tokenWrites[0];
  const removeEvent = tokenEvents.find((event) => event.type === 'removed');
  let token = null;
  try { token = JSON.parse(setEvent?.newValue || 'null'); } catch {}
  const expectedTarget = targetValue(targetHref);
  const fromClassification = classify(oldHref);
  const toClassification = classify(targetHref);
  const now = Date.now();
  const tokenOk = token?.version === TOKEN_VERSION && token?.variant === 'h3' && token?.target === expectedTarget
    && token?.label === targetLabel && typeof token.label === 'string' && token.label.length <= 80
    && typeof token?.nonce === 'string' && token.nonce.length >= 6
    && token?.from?.pathname === fromClassification.normalizedPathname
    && token?.from?.rootSectionId === fromClassification.rootSectionId
    && token?.to?.pathname === toClassification.normalizedPathname
    && token?.to?.rootSectionId === toClassification.rootSectionId
    && Number.isFinite(token?.timestamp) && Math.abs(now - token.timestamp) < TOKEN_TTL_MS;
  const timings = {
    outgoingMs: coveredRow && coveringRows[0] ? coveredRow.at - coveringRows[0].at : null,
    incomingMs: doneRow && revealingRow ? doneRow.at - revealingRow.at : null,
    totalMs: doneRow && coveringRows[0] ? doneRow.at - coveringRows[0].at : null
  };
  const state = await stateSnapshot();
  const h3Lifecycle = lifecycleContract(trace, { expectedSource: 'mpa-h3', expectedScope: 'hero' });
  const coveredEvidence = Boolean(coveredFile);
  const revealingEvidence = revealing || pageStates.includes('revealing');
  record('transition.filmstrip-and-states', covering && partial && coveredEvidence && arrived && revealingEvidence && Boolean(usable)
    && ['covering','covered','arrival','waiting','revealing','done'].every((item) => pageStates.includes(item))
    && state.horizontalOverflow <= 1, {
      files,
      pageStates: [...new Set(pageStates)],
      timings,
      state,
      coveredCapture: {
        filename: coveredCapture.filename,
        verified: coveredFrameVerified,
        geometry: coveredCapture.geometry,
        postCaptureGeometry: coveredCapture.postCaptureGeometry,
        actualOffset: coveredCapture.actualOffset,
        captureEndOffset: coveredCapture.captureEndOffset,
        coveredEventOffset: coveredCapture.coveredEventOffset,
        arrivalProof: coveredCapture.arrivalProof,
        lifecycle: coveredLifecycle,
        tokenEvents: coveredCapture.tokenEvents
      }
    });
  record('transition.h3-reveal-media-visible', Boolean(revealingMediaVisual
    && (revealingMediaVisual.actualVisible || revealingMediaVisual.placeholderVisible)
    && revealingMediaVisual.hostState === 'pending'
    && revealingMediaVisual.placeholderFetchPriority !== 'high'
    && revealingMediaVisual.semanticFetchPriority === 'high'
    && revealingMediaVisual.highImageCount === 1
    && revealingMediaVisual.placeholderRect?.width > 0
    && revealingMediaVisual.placeholderRect?.height > 0
    && revealingMediaVisual.pixels?.darkRatio > 0.08
    && revealingMediaVisual.pixels?.chromaticRatio > 0.05), {
      filmstripCriticalPath,
      faultHits: revealingMediaVisual?.fault?.hits ?? 0,
      revealingMediaVisual
    });
  record('transition.h3-ready-media-handoff', Boolean(usable
    && readyMediaVisual?.imageComplete && readyMediaVisual.imageNaturalWidth > 0
    && readyMediaVisual.hostState === 'ready'
    && readyMediaVisual.imageState === 'ready'
    && !readyMediaVisual.hostClass.includes('is-broken')
    && readyMediaVisual.layerDisplay === 'none'
    && readyMediaVisual.pictureVisibility !== 'hidden'
    && !readyMediaVisual.fallbackExposed
    && !readyMediaVisual.liveStatusExposed), { usable, readyMediaVisual });
  record('transition.exact-token-and-consumption', tokenOk && Boolean(removeEvent) && state.token === null,
    { expectedTarget, expectedVariant: 'h3', fromClassification, toClassification,
      navigationId: token?.navigationId || token?.nonce, token, tokenEvents, consumedValue: state.token });
  record('transition.label-token-and-mpa-continuity', blankTransitionRows.length === 0
    && labelsAcrossDocuments.size === 1 && labelsAcrossDocuments.has(targetLabel)
    && labelledDocuments.size >= 2
    && bootstrapLabelRows.length > 0
    && bootstrapLabelRows.every((row) => row.bootstrapTransitionLabel === targetLabel)
    && state.transitionLabel === targetLabel,
  { targetLabel, labelsAcrossDocuments: [...labelsAcrossDocuments], labelledDocuments: [...labelledDocuments],
    bootstrapLabelRows, blankTransitionRows, finalLabel: state.transitionLabel });
  record('transition.no-logo-and-double-click-guard', forbiddenLogo.length === 0
    && coveringDocuments.size === 1 && tokenWrites.length === 1,
  { forbiddenLogo, coveringRows: coveringRows.length, coveringDocuments: [...coveringDocuments],
    tokenWrites: tokenWrites.length, targetStates: targetRows.map((row) => row.entryState).filter(Boolean) });
  record('transition.timings', timings.outgoingMs !== null && timings.outgoingMs >= 180 && timings.outgoingMs <= 650
    && timings.incomingMs !== null && timings.incomingMs >= 250 && timings.incomingMs <= 900
    && timings.totalMs !== null && timings.totalMs <= 2200, { timings });
  record('transition.overlay-contract', state.overlayExists && state.overlayFirst
    && state.overlayAriaHidden === 'true' && state.overlayInert, state);
  const coverMs = state.coverDuration.endsWith('ms')
    ? Number.parseFloat(state.coverDuration)
    : Number.parseFloat(state.coverDuration) * 1000;
  const revealMs = state.revealDuration.endsWith('ms')
    ? Number.parseFloat(state.revealDuration)
    : Number.parseFloat(state.revealDuration) * 1000;
  const normalizedEase = state.sheetEasing.replace(/\s+/g, '')
    .replace(/(?<=\(|,)0\./g, '.');
  record('transition.sheet-visual-contract', state.sheetBackground === 'rgb(11, 29, 54)'
    && state.sheetBackgroundImage.split('linear-gradient').length - 1 === 2
    && state.sheetBackgroundSize.includes('64px 64px')
    && state.edgeColor === 'rgb(23, 89, 183)' && state.edgeWidth === '2px'
    && state.trailWidth === '10px' && state.transitionLabel
    && state.transitionLabelWeight === '600' && state.transitionLabelColor === 'rgb(255, 255, 255)'
    && coverMs === 300 && revealMs === 480
    && normalizedEase === 'cubic-bezier(.76,0,.24,1)', state);
  record('transition.h3-cross-root-exclusive', fromClassification.rootSectionId !== toClassification.rootSectionId
    && token?.variant === 'h3' && !trace.some((row) => row.pageVariant === 'calm'),
  { fromClassification, toClassification, token,
    variants: [...new Set(trace.map((row) => row.pageVariant).filter(Boolean))] });
  record('entrance.h3-arrival-lifecycle-order', h3Lifecycle.ok && cleanupContract(state),
    { lifecycle: h3Lifecycle, state });
  let placeholderFaultAudit = { skipped: true, reason: 'external origin or missing transition derivative' };
  if (!options.externalOrigin && directPlaceholderAudit?.url) {
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.home));
    await waitUntilUsable();
    const placeholderPathname = new URL(directPlaceholderAudit.url).pathname;
    configureFault(placeholderPathname, 'invalid');
    await fireRouteClick(targetHref, { label: targetLabel });
    const faultArrived = await waitForCondition(
      `location.pathname === ${JSON.stringify(new URL(targetHref).pathname)}`,
      10_000
    );
    const placeholderFailed = faultArrived && await waitForCondition(`(() => {
      const host = document.querySelector('[data-v2-transition-placeholder]');
      return host?.getAttribute('data-v2-transition-placeholder-preload') === 'error';
    })()`, 3000, 8);
    const transientState = await evaluate(`(() => {
      const host = document.querySelector('[data-v2-transition-placeholder]');
      const layer = host?.querySelector('[data-v2-transition-placeholder-layer]');
      return {
        placeholderImages: layer?.querySelectorAll('[data-v2-transition-placeholder-image]').length || 0,
        hostClass: host?.className || '',
        fallbackExposed: Boolean(Array.from(host?.querySelectorAll('[data-v2-image-fallback]') || [])
          .some((fallback) => fallback.getAttribute('aria-hidden') !== 'true')),
        liveStatusExposed: Boolean(Array.from(host?.querySelectorAll('[role="status"]') || [])
          .some((status) => status.getAttribute('aria-hidden') !== 'true'))
      };
    })()`);
    const faultUsable = faultArrived ? await waitUntilUsable(6500) : null;
    const faultHits = serverFault.hits;
    const stateAfterFault = await evaluate(`(() => {
      const image = document.querySelector('.immersive-direction-hero__media [data-v2-page-critical]')
        || document.querySelector('[data-v2-page-critical]');
      const host = image?.closest('[data-v2-transition-placeholder]');
      const layer = host?.querySelector('[data-v2-transition-placeholder-layer]');
      return {
        imageComplete: image?.complete ?? null,
        imageNaturalWidth: image?.naturalWidth ?? null,
        imageState: image?.getAttribute('data-v2-image-state') || '',
        hostState: host?.getAttribute('data-v2-media-state') || '',
        hostClass: host?.className || '',
        placeholderState: host?.getAttribute('data-v2-transition-placeholder-preload') || '',
        layerDisplay: layer ? getComputedStyle(layer).display : '',
        fallbackExposed: Boolean(Array.from(host?.querySelectorAll('[data-v2-image-fallback]') || [])
          .some((fallback) => fallback.getAttribute('aria-hidden') !== 'true')),
        liveStatusExposed: Boolean(Array.from(host?.querySelectorAll('[role="status"]') || [])
          .some((status) => status.getAttribute('aria-hidden') !== 'true'))
      };
    })()`);
    placeholderFaultAudit = { skipped: false, faultArrived, placeholderFailed, transientState,
      faultUsable: Boolean(faultUsable), faultHits, placeholderPathname, state: stateAfterFault };
    clearFault();
  }
  record('transition.placeholder-error-does-not-poison-readiness', options.externalOrigin
    || Boolean(placeholderFaultAudit.faultArrived && placeholderFaultAudit.faultUsable
      && placeholderFaultAudit.placeholderFailed
      && placeholderFaultAudit.faultHits === 1
      && placeholderFaultAudit.transientState?.placeholderImages === 0
      && !placeholderFaultAudit.transientState?.hostClass.includes('is-broken')
      && !placeholderFaultAudit.transientState?.fallbackExposed
      && !placeholderFaultAudit.transientState?.liveStatusExposed
      && placeholderFaultAudit.state?.placeholderState === 'error'
      && placeholderFaultAudit.state?.imageComplete
      && placeholderFaultAudit.state?.imageNaturalWidth > 0
      && placeholderFaultAudit.state?.imageState === 'ready'
      && placeholderFaultAudit.state?.hostState === 'ready'
      && !placeholderFaultAudit.state?.hostClass.includes('is-broken')
      && placeholderFaultAudit.state?.layerDisplay === 'none'
      && !placeholderFaultAudit.state?.fallbackExposed
      && !placeholderFaultAudit.state?.liveStatusExposed), placeholderFaultAudit);
  return { files, timings };
};

const fullBleedTransitionMediaAudit = async () => {
  if (options.externalOrigin) {
    record('transition.full-bleed-placeholder-dpr', true, {
      skipped: true,
      reason: '--origin cannot inject a deterministic delay into the semantic hero candidate'
    });
    return;
  }
  const results = [];
  for (const dpr of [1, 2]) {
    await setViewport(1440, 900, false, dpr);
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.business));
    await waitUntilUsable();
    const direct = await evaluate(`(() => {
      const host = document.querySelector('[data-v2-transition-placeholder]');
      const image = document.querySelector('.immersive-direction-hero__media [data-v2-page-critical]')
        || document.querySelector('[data-v2-page-critical]');
      const placeholderUrl = host?.dataset.v2TransitionPlaceholderSrc || '';
      const absolutePlaceholderUrl = placeholderUrl ? new URL(placeholderUrl, location.href).href : '';
      return {
        criticalUrl: image?.currentSrc || image?.src || '',
        placeholderUrl: absolutePlaceholderUrl,
        placeholderRequested: Boolean(absolutePlaceholderUrl
          && performance.getEntriesByType('resource').some((entry) => entry.name === absolutePlaceholderUrl))
      };
    })()`);
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.home));
    await waitUntilUsable();
    const criticalPathname = direct.criticalUrl ? new URL(direct.criticalUrl).pathname : '';
    if (criticalPathname) configureFault(criticalPathname, 'delay', 900);
    await fireRouteClick(hrefFor(routes.business), { label: classify(hrefFor(routes.business)).canonicalLabel });
    const arrived = await waitForCondition(
      `location.pathname === ${JSON.stringify(new URL(hrefFor(routes.business)).pathname)}`,
      10_000
    );
    const revealing = arrived && await waitForCondition(
      `document.documentElement.dataset.v2PageState === 'revealing'`,
      3000,
      12
    );
    if (revealing) await delay(220);
    const visual = await evaluate(`(() => {
      const host = document.querySelector('[data-v2-transition-placeholder]');
      const image = document.querySelector('.immersive-direction-hero__media [data-v2-page-critical]')
        || document.querySelector('[data-v2-page-critical]');
      const placeholder = host?.querySelector('[data-v2-transition-placeholder-image]');
      const hostRect = host?.getBoundingClientRect();
      const resource = placeholder?.currentSrc
        ? performance.getEntriesByType('resource').find((entry) => entry.name === placeholder.currentSrc)
        : null;
      return {
        hostRect: hostRect ? { left: hostRect.left, top: hostRect.top, width: hostRect.width, height: hostRect.height } : null,
        placeholderUrl: placeholder?.currentSrc || placeholder?.src || '',
        placeholderLoaded: Boolean(placeholder?.complete && placeholder.naturalWidth > 0),
        placeholderNaturalWidth: placeholder?.naturalWidth || 0,
        placeholderBytes: resource?.encodedBodySize || resource?.transferSize || 0,
        placeholderFetchPriority: placeholder?.fetchPriority || '',
        semanticFetchPriority: image?.fetchPriority || '',
        semanticPending: !image?.complete || image.naturalWidth === 0,
        highImageCount: document.querySelectorAll('img[fetchpriority="high"]').length,
        hostState: host?.getAttribute('data-v2-media-state') || '',
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }
      };
    })()`);
    const filename = await screenshot(`sheet-full-bleed-dpr-${dpr}`, {
      directory: 'final/transitions/h3',
      flow: 'home-to-metalworks-full-bleed',
      variant: 'h3',
      dpr,
      outputScale: dpr === 2 ? 0.5 : 1
    });
    visual.pixels = await analyzeH3MediaPixels(filename, visual);
    const captureMetadata = await sharp(filename).metadata();
    visual.capture = {
      width: captureMetadata.width || 0,
      height: captureMetadata.height || 0,
      outputScale: dpr === 2 ? 0.5 : 1
    };
    const usable = await waitUntilUsable(6500);
    const faultHits = serverFault.hits;
    clearFault();
    results.push({ dpr, arrived, revealing, usable: Boolean(usable), direct, faultHits, filename, visual });
  }
  await setViewport(1440, 900, false, 1);
  record('transition.full-bleed-placeholder-dpr', results.length === 2 && results.every((result) => (
    result.arrived && result.revealing && result.usable
    && result.direct.placeholderUrl && !result.direct.placeholderRequested
    && result.faultHits === 1
    && result.visual.placeholderLoaded
    && result.visual.placeholderNaturalWidth >= 1400
    && result.visual.placeholderBytes > 0 && result.visual.placeholderBytes <= 500 * 1024
    && result.visual.placeholderFetchPriority !== 'high'
    && result.visual.semanticFetchPriority === 'high'
    && result.visual.highImageCount === 1
    && result.visual.semanticPending && result.visual.hostState === 'pending'
    && result.visual.hostRect?.width >= result.visual.viewport.width * 0.95
    && result.visual.hostRect?.height >= result.visual.viewport.height * 0.95
    && result.visual.capture?.width === 1440
    && result.visual.capture?.height === 900
    && result.visual.pixels?.darkRatio > 0.08
    && result.visual.pixels?.chromaticRatio > 0.05
  )), { results });
};

const transitionMobileVisualContractAudit = async () => {
  try {
    await setViewport(390, 844, true, 1);
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.home));
    await waitUntilUsable();
    const state = await stateSnapshot();
    const durationMs = (value) => value.endsWith('ms')
      ? Number.parseFloat(value)
      : Number.parseFloat(value) * 1000;
    const fontSize = Number.parseFloat(state.transitionLabelFontSize);
    record('transition.mobile-visual-contract', durationMs(state.coverDuration) === 240
      && durationMs(state.revealDuration) === 380
      && state.edgeWidth === '2px' && state.trailWidth === '10px'
      && state.sheetBackground === 'rgb(11, 29, 54)'
      && state.sheetBackgroundImage.split('linear-gradient').length - 1 === 2
      && state.transitionLabelWeight === '600'
      && fontSize >= 27 && fontSize <= 38
      && state.transitionLabelLineClamp === '2'
      && state.horizontalOverflow <= 1,
    { viewport: '390x844', state });
  } finally {
    await setViewport(1440, 900, false, 1);
  }
};

const transitionMobileFilmstripsAudit = async () => {
  const run = async ({ fromRoute, toRoute, variant, coverOffsets, revealOffsets }) => {
    const fromHref = hrefFor(fromRoute);
    const targetHref = hrefFor(toRoute);
    const coverReplay = await captureTransitionReplays({
      fromHref,
      targetHref,
      variant,
      phase: 'cover',
      offsets: coverOffsets,
      directory: `final/transitions/${variant}`,
      prefix: `${variant}-mobile-cover`,
      flow: `${variant}-mobile-cover`
    });
    const revealReplay = await captureTransitionReplays({
      fromHref,
      targetHref,
      variant,
      phase: 'reveal',
      offsets: revealOffsets,
      directory: `final/transitions/${variant}`,
      prefix: `${variant}-mobile-reveal`,
      flow: `${variant}-mobile-reveal`
    });
    const coverFrames = coverReplay.frames;
    const revealFrames = revealReplay.frames;
    const authoritative = revealReplay.lastRun;
    const trace = authoritative?.trace || [];
    const state = authoritative?.finalState || await stateSnapshot();
    const tokenEvent = authoritative?.tokenEvents
      ?.find((event) => ['added', 'updated'].includes(event.type));
    let token = null;
    try { token = JSON.parse(tokenEvent?.newValue || 'null'); } catch {}
    return {
      ok: coverFrames.length === coverOffsets.length && revealFrames.length === revealOffsets.length
        && [...coverFrames, ...revealFrames].every((frame) => frame.eventRow && frame.withinTolerance)
        && Boolean(authoritative?.arrived && authoritative?.usable)
        && token?.variant === variant && cleanupContract(state),
      cover: coverFrames[0]?.eventRow || null,
      reveal: revealFrames[0]?.eventRow || null,
      coverFrames,
      revealFrames,
      trace,
      token,
      state
    };
  };
  try {
    await setViewport(390, 844, true, 1);
    const h3 = await run({
      fromRoute: routes.home,
      toRoute: routes.deep,
      variant: 'h3',
      // Capture the fully covered outgoing frame one animation frame before
      // the exact navigation boundary so the screenshot command cannot race
      // the document teardown.
      coverOffsets: [0, 120, 224],
      revealOffsets: [0, 190, 380]
    });
    const calm = await run({
      fromRoute: routes.street,
      toRoute: routes.streetCategory,
      variant: 'calm',
      coverOffsets: [0, 90, 164],
      revealOffsets: [0, 160, 320]
    });
    const calmForbidden = [...calm.coverFrames, ...calm.revealFrames].filter(({ state }) => (
      !state || state.gridVisible || state.labelVisible || state.edgeVisible || state.trailVisible
      || (state.sheetTransform && state.sheetTransform !== 'none')
    ));
    record('transition.mobile-h3-calm-filmstrips', h3.ok && calm.ok && calmForbidden.length === 0
      && cssTimeMs(h3.state.coverDuration) === 240
      && cssTimeMs(h3.state.revealDuration) === 380
      && cssTimeMs(calm.state.calmCoverDuration) === 180
      && cssTimeMs(calm.state.calmRevealDuration) === 320,
    { h3: { ...h3, trace: undefined }, calm: { ...calm, trace: undefined }, calmForbidden });
  } finally {
    await setViewport(1440, 900, false, 1);
  }
};

const calmTransitionFilmstripAudit = async () => {
  await setViewport(1440, 900, false, 1);
  const sourceHref = hrefFor(routes.street);
  const targetHref = hrefFor(routes.streetCategory);
  const coverReplay = await captureTransitionReplays({
    fromHref: sourceHref,
    targetHref,
    variant: 'calm',
    phase: 'cover',
    offsets: [0, 110, 220],
    directory: 'final/transitions/calm',
    prefix: 'calm-cover',
    flow: 'street-to-category-cover'
  });
  const revealReplay = await captureTransitionReplays({
    fromHref: sourceHref,
    targetHref,
    variant: 'calm',
    phase: 'reveal',
    offsets: [0, 210, 420],
    directory: 'final/transitions/calm',
    prefix: 'calm-reveal',
    flow: 'street-to-category-reveal'
  });
  const coverFrames = coverReplay.frames;
  const revealFrames = revealReplay.frames;
  const authoritative = revealReplay.lastRun;
  const coverStart = coverFrames[0]?.eventRow || null;
  const revealStart = revealFrames[0]?.eventRow || null;
  const arrived = Boolean(authoritative?.arrived);
  const usable = authoritative?.usable || null;
  const state = authoritative?.finalState || await stateSnapshot();
  const trace = authoritative?.trace || [];
  traceEvidence.push({ flow: 'calm-street-to-category', trace });
  const tokenEvents = authoritative?.tokenEvents || [];
  const tokenWrite = tokenEvents.find((event) => ['added', 'updated'].includes(event.type));
  let token = null;
  try { token = JSON.parse(tokenWrite?.newValue || 'null'); } catch {}
  const from = classify(sourceHref);
  const to = classify(targetHref);
  const activeFrames = [...coverFrames, ...revealFrames];
  const forbiddenFrames = activeFrames.filter(({ state: frame }) => !frame || frame.gridVisible || frame.labelVisible
    || frame.edgeVisible || frame.trailVisible || (frame.sheetTransform && frame.sheetTransform !== 'none'));
  const nonOpacityFrames = activeFrames.filter(({ state: frame }) => {
    if (!frame) return true;
    const properties = `${frame.sheetTransitionProperty},${frame.overlayTransitionProperty}`
      .split(',').map((value) => value.trim()).filter(Boolean);
    return properties.some((property) => !['opacity', 'none'].includes(property));
  });
  const normalizedCalmEase = state.calmEasing.replace(/\s+/g, '').replace(/(?<=\(|,)0\./g, '.');
  const durationMs = (value) => value.endsWith('ms')
    ? Number.parseFloat(value)
    : Number.parseFloat(value) * 1000;
  const coveringRow = trace.find((row) => row.pageState === 'covering' && row.pageVariant === 'calm');
  const coveredRow = trace.find((row) => row.pageState === 'covered' && row.pageVariant === 'calm');
  const revealingRow = trace.find((row) => row.pageState === 'revealing' && row.pageVariant === 'calm');
  const doneRow = trace.find((row) => row.pageState === 'done' && row.pageVariant === 'calm'
    && row.doc === revealingRow?.doc && row.at >= revealingRow.at);
  const timings = {
    cover: coveringRow && coveredRow ? coveredRow.at - coveringRow.at : null,
    reveal: revealingRow && doneRow ? doneRow.at - revealingRow.at : null
  };
  const lifecycle = lifecycleContract(trace, { expectedSource: 'mpa-calm', expectedScope: 'hero' });
  const tokenOk = token?.version === TOKEN_VERSION && token?.variant === 'calm'
    && token?.target === targetValue(targetHref) && token?.label === ''
    && token?.from?.pathname === from.normalizedPathname && token?.from?.rootSectionId === from.rootSectionId
    && token?.to?.pathname === to.normalizedPathname && token?.to?.rootSectionId === to.rootSectionId
    && token?.nonce === token?.navigationId && typeof token?.navigationId === 'string';
  record('transition.calm-same-root-filmstrip', Boolean(coverStart && arrived && revealStart && usable)
    && coverFrames.length === 3 && revealFrames.length === 3
    && activeFrames.every((frame) => frame.withinTolerance)
    && from.rootSectionId === to.rootSectionId,
  { sourceHref, targetHref, from, to, coverStart, revealStart, timings,
    files: activeFrames.map((frame) => frame.filename) });
  record('transition.calm-opacity-only-no-drawing', forbiddenFrames.length === 0 && nonOpacityFrames.length === 0
    && state.sheetBackground === 'rgb(11, 29, 54)' && !trace.some((row) => row.pageVariant === 'h3'),
  { forbiddenFrames, nonOpacityFrames, final: state,
    variants: [...new Set(trace.map((row) => row.pageVariant).filter(Boolean))] });
  record('transition.calm-timings', durationMs(state.calmCoverDuration) === 220
    && durationMs(state.calmRevealDuration) === 420
    && durationMs(state.calmFailOpenDuration) === 140
    && normalizedCalmEase === 'cubic-bezier(.4,0,.2,1)'
    && timings.cover !== null && timings.cover >= 170 && timings.cover <= 370
    && timings.reveal !== null && timings.reveal >= 330 && timings.reveal <= 590,
  { timings, state });
  record('transition.calm-token-consumed-once', tokenOk
    && tokenEvents.filter((event) => ['added', 'updated'].includes(event.type)).length === 1
    && tokenEvents.filter((event) => event.type === 'removed').length === 1
    && state.token === null,
  { token, tokenEvents, navigationId: token?.navigationId });
  record('entrance.calm-arrival-lifecycle', lifecycle.ok && cleanupContract(state), { lifecycle, state });
};

const followActualLink = async ({ targetHref = '', selector = 'a[href]', expectedVariant = '' } = {}) => {
  const fromHref = await evaluate('location.href');
  await resetTrace();
  storageEvents.length = 0;
  const clicked = await evaluate(`(() => {
    const selector = ${JSON.stringify(selector)};
    const expected = ${JSON.stringify(targetHref)} ? new URL(${JSON.stringify(targetHref)}) : null;
    const links = Array.from(document.querySelectorAll(selector)).filter((element) => element instanceof HTMLAnchorElement);
    const anchor = links.find((element) => !expected
      || (new URL(element.href).pathname === expected.pathname
        && new URL(element.href).search === expected.search
        && new URL(element.href).hash === expected.hash));
    if (!(anchor instanceof HTMLAnchorElement)) {
      return { found: false, selector, candidates: links.slice(0, 12).map((element) => element.href) };
    }
    const result = {
      found: true,
      href: anchor.href,
      label: anchor.dataset.v2TransitionLabel || '',
      ariaLabel: anchor.getAttribute('aria-label') || '',
      text: (anchor.innerText || anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    };
    anchor.click();
    return result;
  })()`);
  if (!clicked?.found) return { ok: false, clicked, reason: 'link-not-found' };

  const exactTarget = targetValue(clicked.href);
  const fromClassification = classify(fromHref);
  const toClassification = classify(clicked.href);
  const resolvedVariant = expectedVariant || resolveV2TransitionMode(fromClassification, toClassification);
  const arrived = await waitForCondition(
    `location.pathname + location.search + location.hash === ${JSON.stringify(exactTarget)}`,
    10_000
  );
  const usable = arrived ? await waitUntilUsable(6_000) : null;
  const trace = await getTrace();
  const transitionRows = trace.filter((row) => (row.locked || row.criticalStatus)
    && ['covering','covered','navigating','arrival','waiting','revealing'].includes(row.pageState));
  const blankRows = transitionRows.filter((row) => !row.transitionLabel && !row.bootstrapTransitionLabel);
  const labels = [...new Set(transitionRows
    .flatMap((row) => [row.transitionLabel, row.bootstrapTransitionLabel]).filter(Boolean))];
  const tokenEvent = readTokenEvents().find((event) => ['added','updated'].includes(event.type));
  let token = null;
  try { token = JSON.parse(tokenEvent?.newValue || 'null'); } catch {}
  const state = await stateSnapshot();
  const expectedLabel = token?.label || '';
  const tokenShape = token?.version === TOKEN_VERSION && token?.variant === resolvedVariant
    && token?.target === exactTarget && token?.nonce === token?.navigationId
    && token?.from?.pathname === fromClassification.normalizedPathname
    && token?.from?.rootSectionId === fromClassification.rootSectionId
    && token?.to?.pathname === toClassification.normalizedPathname
    && token?.to?.rootSectionId === toClassification.rootSectionId;
  const h3Contract = resolvedVariant !== 'h3' || (expectedLabel && labels.length === 1
    && labels[0] === expectedLabel && blankRows.length === 0);
  const calmContract = resolvedVariant !== 'calm' || (token?.label === ''
    && labels.length === 0 && transitionRows.every((row) => !row.transitionLabelPresent && !row.bootstrapTransitionLabel)
    && !trace.some((row) => row.pageVariant === 'h3'));
  const lifecycle = lifecycleContract(trace, {
    expectedSource: resolvedVariant === 'h3' ? 'mpa-h3' : resolvedVariant === 'calm' ? 'mpa-calm' : ''
  });
  const activationId = lifecycle.activations.find((row) => row.source === `mpa-${resolvedVariant}`)?.activationId || '';
  const ok = Boolean(arrived && usable && ['h3', 'calm'].includes(resolvedVariant) && tokenShape
    && h3Contract && calmContract && lifecycle.ok && state.token === null && cleanupContract(state));
  return {
    ok, clicked, fromHref, exactTarget, expectedVariant: resolvedVariant, expectedLabel,
    fromClassification, toClassification, token, navigationId: token?.navigationId || token?.nonce || '',
    activationId, labels, blankRows, lifecycle, arrived, usable: Boolean(usable), state
  };
};

const actualNavigationFamiliesAudit = async () => {
  const results = {};

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.home));
  await waitUntilUsable();
  results.homeToMetal = await followActualLink({
    targetHref: hrefFor(routes.business),
    selector: 'a[data-v2-transition-label]',
    expectedVariant: 'h3'
  });
  record('actual.home-to-metal', results.homeToMetal.ok, results.homeToMetal);

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.business));
  await waitUntilUsable();
  const dropdown = await evaluate(`(() => {
    const trigger = document.querySelector('[data-hv2-dropdown-trigger][aria-controls="home-v2-company-menu"]');
    if (!(trigger instanceof HTMLButtonElement)) return { found: false };
    trigger.click();
    const panel = document.getElementById('home-v2-company-menu');
    return { found: true, expanded: trigger.getAttribute('aria-expanded'), panelHidden: panel?.hasAttribute('hidden') ?? true };
  })()`);
  results.headerDropdown = await followActualLink({
    targetHref: hrefFor(routes.about),
    selector: '#home-v2-company-menu a[data-v2-transition-label]',
    expectedVariant: 'h3'
  });
  record('actual.header-dropdown-metal-to-about', dropdown?.found && dropdown.expanded === 'true'
    && !dropdown.panelHidden && results.headerDropdown.ok,
  { dropdown, transition: results.headerDropdown });

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.street));
  await waitUntilUsable();
  results.streetToFences = await followActualLink({
    targetHref: hrefFor(routes.fences), selector: 'a[data-v2-transition-label]', expectedVariant: 'h3'
  });
  record('actual.street-to-fences-h3', results.streetToFences.ok, results.streetToFences);

  if (routes.streetProduct) {
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.streetCategory));
    await waitUntilUsable();
    results.urnCategoryToProduct = await followActualLink({
      targetHref: hrefFor(routes.streetProduct),
      selector: '.v2-product-card[data-v2-transition-label],a[data-v2-transition-label]',
      expectedVariant: 'calm'
    });
    results.urnProductToFences = results.urnCategoryToProduct.ok
      ? await followActualLink({
        targetHref: hrefFor(routes.fences), selector: 'a[data-v2-transition-label]', expectedVariant: 'h3'
      })
      : { ok: false, reason: 'product-not-reached' };
    record('actual.urn-category-product-calm-then-fences-h3', results.urnCategoryToProduct.ok
      && results.urnProductToFences.ok,
    { categoryToProduct: results.urnCategoryToProduct, productToFences: results.urnProductToFences });
  }

  const benchesCategory = '/ulichnaya-mebel/lavochki-i-skameyki/';
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor('/ulichnaya-mebel/'));
  await waitUntilUsable();
  const streetToCategory = await followActualLink({
    targetHref: hrefFor(benchesCategory),
    selector: '.v2-category-card[data-v2-transition-label]',
    expectedVariant: 'calm'
  });
  const categoryToStandard = streetToCategory.ok
    ? await followActualLink({ targetHref: hrefFor(routes.standard),
      selector: '.v2-product-card[data-v2-transition-label]', expectedVariant: 'calm' })
    : { ok: false, reason: 'category-not-reached' };
  results.streetToStandard = { streetToCategory, categoryToStandard };
  record('actual.street-furniture-to-standard', streetToCategory.ok && categoryToStandard.ok,
    results.streetToStandard);

  const premiumCategory = '/ulichnaya-mebel/kacheli/';
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(premiumCategory));
  await waitUntilUsable();
  results.categoryToPremium = await followActualLink({
    targetHref: hrefFor(routes.premium),
    selector: '.v2-product-card[data-v2-transition-label]',
    expectedVariant: 'calm'
  });
  record('actual.category-to-premium', results.categoryToPremium.ok, results.categoryToPremium);

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.standard));
  await waitUntilUsable();
  results.breadcrumb = await followActualLink({
    targetHref: hrefFor(benchesCategory),
    selector: '.v2-breadcrumbs a[data-v2-transition-label]',
    expectedVariant: 'calm'
  });
  record('actual.breadcrumb', results.breadcrumb.ok, results.breadcrumb);

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.standard));
  await waitUntilUsable();
  results.relatedCard = await followActualLink({
    selector: '.v2-product-card--related[data-v2-transition-label]', expectedVariant: 'calm'
  });
  record('actual.related-card', results.relatedCard.ok, results.relatedCard);

  try {
    await setViewport(390, 844, true, 1);
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.home));
    await waitUntilUsable();
    const mobileMenu = await evaluate(`(() => {
      const trigger = document.querySelector('[data-hv2-mobile-open]');
      const menu = document.querySelector('[data-hv2-mobile-menu]');
      if (!(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) return { found: false };
      trigger.click();
      return { found: true, expanded: trigger.getAttribute('aria-expanded'), hidden: menu.hidden,
        ariaHidden: menu.getAttribute('aria-hidden') };
    })()`);
    results.mobileMenu = await followActualLink({
      targetHref: hrefFor(routes.contacts),
      selector: '[data-hv2-mobile-menu] a[data-v2-transition-label]',
      expectedVariant: 'h3'
    });
    record('actual.mobile-menu', mobileMenu?.found && mobileMenu.expanded === 'true'
      && !mobileMenu.hidden && mobileMenu.ariaHidden === 'false' && results.mobileMenu.ok,
    { mobileMenu, transition: results.mobileMenu });
  } finally {
    await setViewport(1440, 900, false, 1);
  }

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.home));
  await waitUntilUsable();
  const sequenceTargets = [routes.business, routes.about, '/ulichnaya-mebel/', benchesCategory, routes.standard];
  const sequence = [];
  for (const route of sequenceTargets) {
    sequence.push(await followActualLink({ targetHref: hrefFor(route), selector: 'a[data-v2-transition-label]' }));
    if (!sequence.at(-1)?.ok) break;
  }
  results.fiveConsecutive = sequence;
  const navigationIds = sequence.map((item) => item.navigationId).filter(Boolean);
  const activationIds = sequence.map((item) => item.activationId).filter(Boolean);
  record('actual.five-consecutive', sequence.length === sequenceTargets.length && sequence.every((item) => item.ok)
    && navigationIds.length === 5 && new Set(navigationIds).size === 5
    && activationIds.length === 5 && new Set(activationIds).size === 5,
  { targets: sequenceTargets, variants: sequence.map((item) => item.expectedVariant),
    navigationIds, activationIds, sequence });

  if (routes.project) {
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.projects));
    await waitUntilUsable();
    results.projectsToDetail = await followActualLink({
      targetHref: hrefFor(routes.project), selector: 'a[data-v2-transition-label]', expectedVariant: 'calm'
    });
    record('actual.projects-archive-to-detail-calm', results.projectsToDetail.ok, results.projectsToDetail);
  }
  if (routes.job) {
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.careers));
    await waitUntilUsable();
    results.careersToDetail = await followActualLink({
      targetHref: hrefFor(routes.job), selector: '.practical-vacancy-card a[href]', expectedVariant: 'calm'
    });
    record('actual.careers-archive-to-detail-calm', results.careersToDetail.ok, results.careersToDetail);
  }
};

const crossPageHashAudit = async () => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.deep));
  await waitUntilUsable();
  await evaluate(`try { localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]'); } catch {}`);
  storageEvents.length = 0;
  const targetHref = `${hrefFor(routes.business)}?h2=exact#engineering-proof`;
  await fireRouteClick(targetHref);
  const arrived = await waitForCondition(`location.pathname + location.search + location.hash === ${JSON.stringify(targetValue(targetHref))}`, 10_000);
  await waitUntilUsable();
  const trace = await getTrace();
  const tokenEvent = readTokenEvents().find((event) => ['added','updated'].includes(event.type));
  let token = null;
  try { token = JSON.parse(tokenEvent?.newValue || 'null'); } catch {}
  const state = await stateSnapshot();
  const lifecycle = lifecycleContract(trace, { expectedSource: 'mpa-h3', expectedScope: 'hash-target' });
  const targetConsumption = await evaluate(`(() => {
    const target = document.getElementById('engineering-proof');
    const group = target?.closest('[data-v2-scroll-group-state]')
      || target?.querySelector('[data-v2-scroll-group-state]');
    return { found: Boolean(target), groupState: group?.getAttribute('data-v2-scroll-group-state') || '' };
  })()`);
  const starts = traceEvents(trace, 'v2:entrance-start');
  const hashStart = starts[0];
  const offscreenHeroPending = hashStart?.entranceNodes?.some((node) => !node.runtime
    && !String(node.role).startsWith('header-') && ['pending', 'revealing'].includes(node.state)) || false;
  const targetRuntimeRoles = hashStart?.entranceNodes?.filter((node) => node.runtime) || [];
  record('transition.cross-page-hash-exact-target', arrived && token?.target === targetValue(targetHref)
    && token?.variant === 'h3' && state.token === null && lifecycle.ok
    && starts.length === 1 && targetConsumption.found && !offscreenHeroPending && targetRuntimeRoles.length > 0,
  { target: targetValue(targetHref), token, lifecycle, targetConsumption,
    offscreenHeroPending, targetRuntimeRoles, state });
};

const sameDocumentHashLifecycleAudit = async () => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.contacts));
  await waitUntilUsable();
  await resetTrace();
  storageEvents.length = 0;
  const beforeActivation = await evaluate(`document.documentElement.dataset.v2EntranceActivationId
    || document.querySelector('[data-v2-motion-root]')?.getAttribute('data-v2-entrance-activation') || ''`);
  const changed = await evaluate(`(() => {
    const anchor = document.createElement('a');
    anchor.href = '#main-content';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return location.hash;
  })()`);
  await settle(160);
  const trace = await getTrace();
  const state = await stateSnapshot();
  record('entrance.same-document-hash-native-no-activation', changed === '#main-content'
    && traceEvents(trace, 'v2:entrance-ready').length === 0
    && traceEvents(trace, 'v2:entrance-start').length === 0
    && readTokenEvents().length === 0 && cleanupContract(state),
  { beforeActivation, changed, events: trace.filter((row) => row.kind === 'event'), state });
};

const queryNativeLifecycleAudit = async () => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.contacts));
  await waitUntilUsable();
  await resetTrace();
  storageEvents.length = 0;
  const historyQuery = await evaluate(`(() => {
    history.pushState({ h4: true }, '', '?h4=history-query');
    return location.pathname + location.search + location.hash;
  })()`);
  await settle(100);
  let trace = await getTrace();
  const historyNative = traceEvents(trace, 'v2:entrance-start').length === 0
    && traceEvents(trace, 'v2:page-covering').length === 0 && readTokenEvents().length === 0;

  await resetTrace();
  storageEvents.length = 0;
  const target = `${hrefFor(routes.contacts)}?h4=mpa-query`;
  const startedAt = Date.now();
  await evaluate(`(() => {
    const anchor = document.createElement('a');
    anchor.href = ${JSON.stringify(target)};
    document.body.append(anchor);
    anchor.click();
  })()`);
  const arrived = await waitForCondition(
    `location.pathname + location.search === ${JSON.stringify(new URL(target).pathname + new URL(target).search)}`,
    8000
  );
  const start = arrived ? await waitForTraceEvent('v2:entrance-start', startedAt, 5000) : null;
  await waitUntilUsable(5000);
  trace = await getTrace();
  const lifecycle = lifecycleContract(trace, { expectedSource: 'direct' });
  const state = await stateSnapshot();
  record('routing.query-native-history-and-mpa', historyNative && historyQuery.endsWith('?h4=history-query')
    && arrived && start && traceEvents(trace, 'v2:page-covering').length === 0
    && readTokenEvents().length === 0 && lifecycle.ok && cleanupContract(state),
  { historyQuery, historyNative, target, arrived, start, lifecycle,
    events: trace.filter((row) => row.kind === 'event'), state });
};

const entranceFilmstripAudit = async () => {
  await setViewport(1440, 900, false, 1);
  const targetHref = `${hrefFor(routes.business)}?h4=entrance-filmstrip`;
  const offsets = [0, 240, 480, 720, 960, 1280, 1600, 2100];
  const frames = await captureDirectEntranceReplays({
    href: targetHref,
    offsets,
    directory: 'final/entrance',
    prefix: 'direct-entrance',
    flow: 'direct-business-entrance',
    tabId: 'h4-qa-tab'
  });
  const finalReplay = frames.find((frame) => frame.offset === 2100) || frames.at(-1);
  const start = frames[0]?.start || null;
  const trace = finalReplay?.trace || [];
  traceEvidence.push({ flow: 'entrance-direct-filmstrip', trace });
  const state = finalReplay?.usableState || await stateSnapshot();
  const lifecycle = lifecycleContract(trace, { expectedSource: 'direct', expectedScope: 'hero' });
  const frameAt = (offset) => frames.find((frame) => frame.offset === offset)?.state;
  const role = (frame, name) => frame?.entranceRoles.find((item) => item.role === name);
  const f0 = frameAt(0);
  const f240 = frameAt(240);
  const f480 = frameAt(480);
  const f720 = frameAt(720);
  const f960 = frameAt(960);
  const f1280 = frameAt(1280);
  const f2100 = frameAt(2100);
  const exactOffsets = frames.every((frame) => Number.isFinite(frame.actualOffset)
    && Math.abs(frame.actualOffset - frame.offset) <= 50);
  const staged = Boolean(
    role(f0, 'media')?.nodeState === 'revealing'
    && role(f0, 'title-primary')?.nodeState === 'pending'
    && ['revealing', 'settled'].includes(role(f240, 'header-logo')?.nodeState)
    && role(f240, 'title-primary')?.nodeState === 'pending'
    && ['revealing', 'settled'].includes(role(f480, 'context')?.nodeState)
    && role(f480, 'title-primary')?.nodeState === 'pending'
    && role(f720, 'title-primary')?.nodeState === 'revealing'
    && ['revealing', 'settled'].includes(role(f960, 'lead')?.nodeState)
    && ['revealing', 'settled'].includes(role(f1280, 'actions-meta')?.nodeState)
    && f2100?.entranceRoles.filter((item) => item.nodeState)
      .every((item) => item.nodeState === 'settled')
  );
  const replayStartsValid = frames.every((frame) => frame.start?.detail?.activationId
    && frame.start?.detail?.source === 'direct');
  record('entrance.filmstrip-exact-event-offsets', Boolean(start) && frames.length === offsets.length
    && exactOffsets && replayStartsValid,
  { start, replayStarts: frames.map((frame) => frame.start), offsets,
    actualOffsets: frames.map(({ offset, actualOffset }) => ({ offset, actualOffset })),
    files: frames.map((frame) => frame.filename) });
  record('entrance.staged-role-order', staged, {
    frames: frames.map(({ offset, state: frame }) => ({
      offset,
      entranceState: frame?.entranceState || '',
      roles: (frame?.entranceRoles || []).map(({ role: roleName, nodeState, opacity }) => ({ role: roleName, nodeState, opacity }))
    }))
  });
  record('entrance.direct-lifecycle-and-cleanup', lifecycle.ok && state.entranceMarkCount === 1
    && cleanupContract(state) && state.bodyOpacity === 1 && state.mainOpacity === 1
    && state.horizontalOverflow <= 1 && state.layoutShift <= .001,
  { lifecycle, state });
  record('entrance.domcontentloaded-pageshow-idempotent', lifecycle.activations.length === 1
    && trace.filter((row) => row.kind === 'dom-content-loaded').length === 1
    && trace.filter((row) => row.kind === 'pageshow' && row.persisted === false).length === 1,
  { lifecycle, domContentLoaded: trace.filter((row) => row.kind === 'dom-content-loaded'),
    pageshow: trace.filter((row) => row.kind === 'pageshow') });
};

const mobileEntranceFilmstripAudit = async () => {
  try {
    await setViewport(390, 844, true, 1);
    const offsets = [0, 240, 480, 720, 960, 1280, 1600, 2100];
    const frames = await captureDirectEntranceReplays({
      href: `${hrefFor(routes.contacts)}?h4=mobile-entrance-filmstrip`,
      offsets,
      directory: 'final/entrance',
      prefix: 'mobile-entrance',
      flow: 'mobile-direct-entrance',
      tabId: 'h4-mobile-entrance'
    });
    const finalReplay = frames.find((frame) => frame.offset === 2100) || frames.at(-1);
    const start = frames[0]?.start || null;
    const trace = finalReplay?.trace || [];
    traceEvidence.push({ flow: 'entrance-mobile-filmstrip', trace });
    const state = finalReplay?.usableState || await stateSnapshot();
    const lifecycle = lifecycleContract(trace, { expectedSource: 'direct', expectedScope: 'hero' });
    const exactOffsets = frames.every((frame) => Number.isFinite(frame.actualOffset)
      && Math.abs(frame.actualOffset - frame.offset) <= 50);
    const finalFrame = frames.find((frame) => frame.offset === 2100)?.state;
    record('entrance.mobile-filmstrip-exact-event-offsets', Boolean(start)
      && frames.length === offsets.length && exactOffsets && lifecycle.ok
      && finalFrame?.entranceRoles.filter((item) => item.nodeState)
        .every((item) => item.nodeState === 'settled')
      && cleanupContract(state),
    { start, lifecycle, offsets: frames.map(({ offset, actualOffset }) => ({ offset, actualOffset })),
      files: frames.map((frame) => frame.filename), state });
  } finally {
    await setViewport(1440, 900, false, 1);
  }
};

const directReloadAndDeepScrollAudit = async () => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.about));
  await waitUntilUsable();
  let trace = await getTrace();
  let lifecycle = lifecycleContract(trace, { expectedSource: 'direct', expectedScope: 'hero' });
  let state = await stateSnapshot();
  record('entrance.direct-single-activation', lifecycle.ok && lifecycle.activations.length === 1
    && cleanupContract(state), { lifecycle, state });

  await resetTrace();
  const reloadStartedAt = Date.now();
  await cdp.send('Page.reload', { ignoreCache: true });
  const reloadStart = await waitForTraceEvent('v2:entrance-start', reloadStartedAt, 5000);
  await waitUntilUsable(6000);
  trace = await getTrace();
  lifecycle = lifecycleContract(trace, { expectedSource: 'reload', expectedScope: 'hero' });
  state = await stateSnapshot();
  record('entrance.reload-single-activation', Boolean(reloadStart) && lifecycle.ok
    && lifecycle.activations.length === 1 && cleanupContract(state), { lifecycle, reloadStart, state });

  const deep = await evaluate(`(() => {
    const candidates = Array.from(document.querySelectorAll('[data-v2-reveal]'));
    const target = candidates.find((element) => element.getBoundingClientRect().top > innerHeight * 1.2)
      || document.querySelector('main > :last-child');
    if (!(target instanceof HTMLElement)) return null;
    target.scrollIntoView({ block: 'start' });
    return { top: target.getBoundingClientRect().top, scrollY, tag: target.tagName, id: target.id };
  })()`);
  await settle(1200);
  const scrollBeforeReload = await evaluate('scrollY');
  await resetTrace();
  const deepReloadStartedAt = Date.now();
  await cdp.send('Page.reload', { ignoreCache: true });
  const deepReloadStart = await waitForTraceEvent('v2:entrance-start', deepReloadStartedAt, 5000);
  await waitUntilUsable(6000);
  const scrollAfterReload = await evaluate('scrollY');
  trace = await getTrace();
  lifecycle = lifecycleContract(trace, { expectedSource: 'reload', expectedScope: 'viewport' });
  state = await stateSnapshot();
  const viewportStartRow = traceEvents(trace, 'v2:entrance-start').find((row) => row.entranceScope === 'viewport');
  const heroWasPending = viewportStartRow?.entranceNodes?.some((node) => !node.runtime
    && !String(node.role).startsWith('header-') && ['pending', 'revealing'].includes(node.state)) || false;
  record('entrance.reload-deep-scroll-preserved', Boolean(deep && deepReloadStart)
    && Math.abs(scrollAfterReload - scrollBeforeReload) <= 1 && scrollAfterReload > 0
    && lifecycle.ok && !heroWasPending && cleanupContract(state),
  { deep, scrollBeforeReload, scrollAfterReload, lifecycle, viewportStartRow, heroWasPending, state });
  await evaluate('scrollTo(0, 0)');
};

const productionNotFoundEntranceAudit = async () => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.notFound));
  await waitUntilUsable(6000);
  const trace = await getTrace();
  const state = await stateSnapshot();
  const lifecycle = lifecycleContract(trace, { expectedSource: 'direct', expectedScope: 'hero' });
  const meaningful = await evaluate(`Boolean(document.querySelector('main h1'))
    && (document.querySelector('main')?.innerText || '').trim().length > 40`);
  record('entrance.production-404-single-activation', meaningful && lifecycle.ok
    && lifecycle.activations.length === 1 && cleanupContract(state),
  { lifecycle, meaningful, state });
};

const sectionScrollAudit = async () => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.business));
  await waitUntilUsable();
  await resetTrace();
  const beforeStarts = traceEvents(await getTrace(), 'v2:entrance-start').length;
  const target = await evaluate(`(() => {
    const groups = Array.from(document.querySelectorAll('[data-v2-scroll-group-state="pending"]'));
    const group = groups.find((element) => element.getBoundingClientRect().top > innerHeight * .8) || groups[0];
    if (!(group instanceof HTMLElement)) return null;
    group.dataset.h4QaScrollTarget = 'true';
    const items = Array.from(group.querySelectorAll('[data-v2-scroll-state]'));
    const result = { index: groups.indexOf(group), before: group.dataset.v2ScrollGroupState,
      itemStates: items.map((item) => item.getAttribute('data-v2-scroll-state')),
      top: group.getBoundingClientRect().top };
    group.scrollIntoView({ block: 'center' });
    return result;
  })()`);
  const revealing = target ? await waitForCondition(
    `['revealing','settled','consumed'].includes(document.querySelector('[data-h4-qa-scroll-target]')?.getAttribute('data-v2-scroll-group-state') || '')`,
    2000,
    12
  ) : false;
  const settled = target ? await waitForCondition(
    `['settled','consumed'].includes(document.querySelector('[data-h4-qa-scroll-target]')?.getAttribute('data-v2-scroll-group-state') || '')`,
    2500,
    12
  ) : false;
  await settle(40);
  const after = await evaluate(`(() => {
    const groups = Array.from(document.querySelectorAll('[data-v2-scroll-group-state]'));
    return groups.map((group) => ({ state: group.getAttribute('data-v2-scroll-group-state'),
      target: group.hasAttribute('data-h4-qa-scroll-target'),
      top: group.getBoundingClientRect().top,
      bottom: group.getBoundingClientRect().bottom,
      items: Array.from(group.querySelectorAll('[data-v2-scroll-state]')).map((item) => ({
        state: item.getAttribute('data-v2-scroll-state'), willChange: getComputedStyle(item).willChange
      })) }));
  })()`);
  const trace = await getTrace();
  const afterStarts = traceEvents(trace, 'v2:entrance-start').length;
  traceEvidence.push({ flow: 'section-scroll', trace });
  const visibleSettledGroups = after.filter((group) => group.bottom > 0 && group.top < 900
    && ['settled', 'consumed'].includes(group.state));
  const targetAfter = after.find((group) => group.target);
  const file = await screenshot('section-local-reveal', {
    directory: 'final/scroll', flow: 'business-section-scroll', activationSource: 'scroll'
  });
  const state = await stateSnapshot();
  record('scroll.section-local-once-no-hero-replay', Boolean(target && revealing && settled)
    && visibleSettledGroups.length >= 1 && ['settled', 'consumed'].includes(targetAfter?.state)
    && beforeStarts === afterStarts
    && after.every((group) => group.items.every((item) => item.willChange === 'auto'))
    && !state.locked && state.horizontalOverflow <= 1,
  { target, targetAfter, revealing, settled, beforeStarts, afterStarts, after, file, state });
};

const noIntersectionObserverAudit = async () => {
  await clearOriginStorage();
  const injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { delete window.IntersectionObserver; } catch { window.IntersectionObserver = undefined; }`
  });
  try {
    await seedEntrySeenAndNavigate(hrefFor(routes.business));
    await waitUntilUsable(6000);
    const state = await stateSnapshot();
    const groups = await evaluate(`Array.from(document.querySelectorAll('[data-v2-scroll-group-state]'))
      .map((element) => element.getAttribute('data-v2-scroll-group-state'))`);
    const nodes = await evaluate(`(() => {
      const elements = Array.from(document.querySelectorAll('[data-v2-entrance-node],[data-v2-scroll-state]'));
      const rendered = elements.filter((element) => element.getClientRects().length > 0);
      return {
        total: elements.length,
        pending: elements.filter((element) => ['pending','revealing'].includes(
          element.getAttribute('data-v2-entrance-node') || element.getAttribute('data-v2-scroll-state') || ''
        )).length,
        rendered: rendered.length,
        renderedVisible: rendered.every((element) => {
          const style = getComputedStyle(element);
          return style.visibility !== 'hidden' && Number.parseFloat(style.opacity) > .99;
        })
      };
    })()`);
    record('fail-open.no-intersection-observer-reveals-all', nodes.total > 0 && nodes.pending === 0
      && nodes.renderedVisible
      && groups.length > 0 && groups.every((value) => ['settled', 'consumed'].includes(value))
      && state.scrollPendingCount === 0 && cleanupContract(state),
    { groups, nodes, state });
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
  }
};

const controllerFailOpenAudit = async () => {
  await clearOriginStorage();
  const injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.IntersectionObserver = class H4QaBrokenIntersectionObserver {
      constructor() { throw new Error('H4 QA deterministic entrance controller failure'); }
    };`
  });
  try {
    await seedEntrySeenAndNavigate(hrefFor(routes.business));
    await waitUntilUsable(6000);
    const trace = await getTrace();
    const state = await stateSnapshot();
    const ready = traceEvents(trace, 'v2:entrance-ready');
    const failed = traceEvents(trace, 'v2:entrance-fail-open');
    record('fail-open.entrance-controller-error', ready.length === 1 && failed.length === 1
      && ready[0].activationId === failed[0].activationId && ready[0].at <= failed[0].at
      && state.entranceState === 'fail-open' && cleanupContract(state)
      && state.bodyOpacity === 1 && state.mainOpacity === 1,
    { ready, failed, state });
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
  }
};

const entryCancelPersistenceAudit = async () => {
  await setReducedMotion(false);
  await clearOriginStorage();
  await navigateHref(`${hrefFor(routes.home)}?h4=entry-cancel`, { complete: false, settleMs: 20 });
  const armed = await waitForCondition(`(() => {
    const state = document.querySelector('[data-v2-entry-root]')?.getAttribute('data-v2-entry-state') || '';
    return ['armed','logo','waiting'].includes(state);
  })()`, 1800, 10);
  const cancelled = armed ? await evaluate(`(() => {
    const html = document.documentElement;
    const root = document.querySelector('[data-v2-motion-root][data-v2-entry-mode="public"]');
    if (!(root instanceof HTMLElement)) return false;
    html.dataset.v2EntranceState = 'fail-open';
    root.dispatchEvent(new CustomEvent('v2:entry-cancel', {
      detail: { state: 'fail-open', reason: 'h4-qa-head-timeout' }
    }));
    document.dispatchEvent(new CustomEvent('v2:entrance-fail-open-request', {
      detail: { owner: 'h4-qa', state: 'fail-open', reason: 'h4-qa-head-timeout' }
    }));
    root.dispatchEvent(new CustomEvent('v2:entry-done', {
      detail: { state: 'fail-open', reason: 'h4-qa-head-timeout' }
    }));
    return true;
  })()`) : false;
  await delay(2700);
  const stable = await evaluate(`(() => {
    const html = document.documentElement;
    const root = document.querySelector('[data-v2-motion-root][data-v2-entry-mode="public"]');
    const overlay = document.querySelector('[data-v2-entry-root]');
    return {
      entranceState: html.dataset.v2EntranceState || '',
      motionState: root?.getAttribute('data-v2-motion-state') || '',
      entryState: overlay?.getAttribute('data-v2-entry-state') || '',
      settled: root?.getAttribute('data-v2-entry-settled') || '',
      locked: html.classList.contains('v2-entry-scroll-locked') || html.dataset.v2ScrollLocked === 'true'
    };
  })()`);
  const state = await stateSnapshot();
  record('fail-open.head-timeout-cancels-first-entry-persistently', armed && cancelled
    && stable.entranceState === 'fail-open' && stable.motionState === 'fail-open'
    && stable.entryState === 'fail-open' && stable.settled === 'true' && !stable.locked
    && cleanupContract(state),
  { armed, cancelled, stable, state });
};

const incomingReadinessDeadlineAudit = async () => {
  await clearOriginStorage();
  const fixture = handoffFixture({
    fromRoute: routes.home,
    toRoute: routes.about,
    navigationId: `h4-ready-deadline-${Date.now().toString(36)}`
  });
  const injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      try {
        const id = 'h4-ready-deadline';
        window.name = ${JSON.stringify(TAB_NAME_MARKER)} + id;
        sessionStorage.setItem(${JSON.stringify(TAB_KEY)}, id);
        sessionStorage.setItem(${JSON.stringify(ENTRY_KEY)}, 'seen');
        sessionStorage.setItem(${JSON.stringify(HANDOFF_KEY)}, ${JSON.stringify(JSON.stringify(fixture))});
        localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]');
      } catch {}
      const dispatch = Document.prototype.dispatchEvent;
      Document.prototype.dispatchEvent = function(event) {
        if (event?.type === 'v2:entrance-ready') return true;
        return dispatch.call(this, event);
      };
    })();`
  });
  try {
    await navigateHref(hrefFor(routes.about), { settleMs: 20 });
    const usable = await waitUntilUsable(3500);
    await delay(900);
    const trace = await getTrace();
    const state = await stateSnapshot();
    const diagnostics = await evaluate(`(() => {
      const html = document.documentElement;
      const root = document.querySelector('[data-v2-motion-root][data-v2-entry-mode="public"]');
      return {
        pageFailure: document.querySelector('[data-v2-page-transition]')?.getAttribute('data-v2-page-failure') || '',
        entranceController: html.dataset.v2EntranceController || root?.getAttribute('data-v2-entrance-controller') || '',
        motionStatic: root?.getAttribute('data-v2-motion-static') || '',
        pending: document.querySelectorAll('[data-v2-entrance-node="pending"],[data-v2-entrance-node="revealing"],[data-v2-scroll-state="pending"]').length
      };
    })()`);
    const revealing = traceEvents(trace, 'v2:page-revealing');
    const starts = traceEvents(trace, 'v2:entrance-start');
    const entranceFailures = traceEvents(trace, 'v2:entrance-fail-open');
    record('fail-open.incoming-deadline-terminalizes-before-reveal', Boolean(usable)
      && revealing.length === 1 && revealing[0].detail?.outcome === 'fail-open'
      && starts.length === 0 && entranceFailures.length === 1
      && entranceFailures[0].at <= revealing[0].at
      && diagnostics.pageFailure === 'entrance-timeout' && state.entranceState === 'fail-open'
      && ['ready', 'fail-open'].includes(diagnostics.entranceController) && diagnostics.motionStatic === 'true'
      && diagnostics.pending === 0 && cleanupContract(state),
    { fixture, revealing, starts, entranceFailures, diagnostics, state });
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
  }
};

const previewIsolationAudit = async () => {
  await clearOriginStorage();
  await navigateHref(hrefFor('/design-lab/home-final/'), { settleMs: 20 });
  const usable = await waitUntilUsable(7000);
  const previewSettled = usable && await waitForCondition(
    `document.querySelector('[data-v2-motion-root][data-v2-entry-mode="preview"]')
      ?.getAttribute('data-v2-entry-settled') === 'true'`,
    2500,
    12
  );
  const preview = await evaluate(`(() => {
    const html = document.documentElement;
    const root = document.querySelector('[data-v2-motion-root]');
    const header = document.querySelector('[data-home-v2-header]');
    const revealStates = Array.from(document.querySelectorAll('[data-v2-reveal-state]'))
      .map((element) => element.getAttribute('data-v2-reveal-state'));
    return {
      mode: root?.getAttribute('data-v2-entry-mode') || '',
      active: root?.getAttribute('data-v2-motion-active') || '',
      controller: root?.getAttribute('data-v2-motion-controller') || '',
      entryState: document.querySelector('[data-v2-entry-root]')?.getAttribute('data-v2-entry-state') || '',
      settled: root?.getAttribute('data-v2-entry-settled') || '',
      publicRoute: html.dataset.v2PublicRoute || '',
      publicEntranceState: html.dataset.v2EntranceState || '',
      pageOverlay: Boolean(document.querySelector('[data-v2-page-transition]')),
      h4EntranceStyles: Boolean(document.querySelector('[data-v2-entrance-styles]')),
      h4ScaleStyles: Boolean(document.querySelector('[data-v2-h4-scale-styles]')),
      headerEntry: header?.getAttribute('data-v2-entry') || '',
      headerReady: header?.classList.contains('is-ready') || false,
      revealStates
    };
  })()`);
  const file = await screenshot('design-lab-preview-preserved', {
    directory: 'final/entrance', flow: 'design-lab-preview', activationSource: 'legacy-preview'
  });
  record('isolation.design-lab-preview-keeps-legacy-owner', Boolean(usable && previewSettled)
    && preview.mode === 'preview' && preview.active === 'true' && preview.controller === 'ready'
    && ['done','static','skipped','fail-open'].includes(preview.entryState) && preview.settled === 'true'
    && !preview.publicRoute && !preview.publicEntranceState && !preview.pageOverlay
    && !preview.h4EntranceStyles && !preview.h4ScaleStyles
    && preview.headerEntry === 'header' && preview.headerReady && preview.revealStates.length > 0,
  { previewSettled, preview, file });
};

const mobileMenuSnapshotAudit = async () => {
  try {
    await setViewport(390, 844, true, 1);
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.contacts));
    await waitUntilUsable(6000);
    const destination = await evaluate(`(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.body.style.scrollBehavior = 'auto';
      const destination = Math.min(560, Math.max(0, document.documentElement.scrollHeight - innerHeight));
      scrollTo(0, destination);
      return destination;
    })()`);
    await settle(50);
    const before = await evaluate(`({ destination: ${destination}, scrollY })`);
    const opened = await evaluate(`(() => {
      const button = document.querySelector('[data-hv2-mobile-open]');
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`);
    const menuOpened = opened && await waitForCondition(
      `document.querySelector('[data-hv2-mobile-menu]')?.hidden === false`, 1000, 10
    );
    const locked = await evaluate(`({ scrollY, bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top, expanded: document.querySelector('[data-hv2-mobile-open]')?.getAttribute('aria-expanded') })`);
    await evaluate(`document.dispatchEvent(new CustomEvent('v2:prepare-bfcache', {
      detail: { state: 'settled', persisted: true, source: 'h4-qa' }
    }))`);
    await settle(50);
    const restored = await evaluate(`(() => ({
      scrollY,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      menuHidden: document.querySelector('[data-hv2-mobile-menu]')?.hidden,
      expanded: document.querySelector('[data-hv2-mobile-open]')?.getAttribute('aria-expanded'),
      mainInert: document.querySelector('main')?.hasAttribute('inert') || false,
      headerInert: document.querySelector('[data-home-v2-header]')?.hasAttribute('inert') || false
    }))()`);
    const lockedScrollY = Math.abs(Number.parseFloat(locked.bodyTop) || 0);
    record('bfcache.mobile-menu-restores-scroll-and-inert-state', menuOpened
      && locked.bodyPosition === 'fixed' && locked.expanded === 'true'
      && before.scrollY > 0 && lockedScrollY > 0
      && Math.abs(before.scrollY - lockedScrollY) <= 6
      && Math.abs(restored.scrollY - lockedScrollY) <= 6
      && restored.bodyPosition === '' && restored.bodyTop === ''
      && restored.menuHidden === true && restored.expanded === 'false'
      && !restored.mainInert && !restored.headerInert,
    { before, menuOpened, locked, lockedScrollY, restored });
  } finally {
    await setViewport(1440, 900, false, 1);
  }
};

const scrollOwnershipAudit = async () => {
  const grids = [
    { route: routes.standard, selector: '.v2-technical-grid', id: 'standard' },
    { route: routes.premium, selector: '.v2-premium-technical__grid', id: 'premium' },
    ...(routes.project ? [{
      route: routes.project,
      selector: '.v2-project-detail__facts-grid',
      id: 'project',
      optional: true
    }] : [])
  ];
  const rows = [];
  for (const fixture of grids) {
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(fixture.route));
    await waitUntilUsable(6000);
    const row = await evaluate(`(() => {
      const grid = document.querySelector(${JSON.stringify(fixture.selector)});
      if (!(grid instanceof HTMLElement)) return { found: false };
      const cards = Array.from(grid.children).filter((element) => element.matches('section[data-v2-reveal]'));
      return {
        found: true,
        boundary: grid.hasAttribute('data-v2-scroll-section'),
        groupState: grid.getAttribute('data-v2-scroll-group-state') || '',
        cards: cards.length,
        cardRoles: cards.map((card) => card.getAttribute('data-v2-scroll-role') || ''),
        cardStates: cards.map((card) => card.getAttribute('data-v2-scroll-state') || '')
      };
    })()`);
    rows.push({ ...fixture, ...row });
  }

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.home));
  await waitUntilUsable(6000);
  const anchor = await evaluate(`(() => {
    const item = document.querySelector('a.hf-direction-rail__item[data-v2-reveal="group"]');
    if (!(item instanceof HTMLAnchorElement)) return { found: false };
    const state = item.getAttribute('data-v2-scroll-state') || '';
    return {
      found: true,
      state,
      role: item.getAttribute('data-v2-scroll-role') || '',
      descendantStates: item.querySelectorAll('[data-v2-scroll-state]').length,
      pointerEvents: getComputedStyle(item).pointerEvents
    };
  })()`);
  const gridsOk = rows.length >= 2 && rows.every((row) => (row.optional && !row.found)
    || (row.found && row.boundary && row.groupState && row.cards > 0
      && row.cardRoles.every((role) => role === 'card')
      && row.cardStates.every(Boolean)));
  const anchorOk = anchor.found && anchor.role === 'card' && anchor.descendantStates === 0
    && (anchor.state !== 'pending' || anchor.pointerEvents === 'none');
  record('scroll.explicit-grid-and-interactive-card-ownership', gridsOk && anchorOk, { rows, anchor });
};

const runtimePreferenceAndKeyboardAudit = async () => {
  await setReducedMotion(false);
  await clearOriginStorage();
  await evaluate(`(() => {
    const id = 'h4-runtime-pref';
    window.name = ${JSON.stringify(TAB_NAME_MARKER)} + id;
    sessionStorage.setItem(${JSON.stringify(TAB_KEY)}, id);
    sessionStorage.setItem(${JSON.stringify(ENTRY_KEY)}, 'seen');
    localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]');
  })()`);
  let startedAt = Date.now();
  await cdp.send('Page.navigate', { url: `${hrefFor(routes.about)}?h4=runtime-preference` });
  const start = await waitForTraceEvent('v2:entrance-start', startedAt, 5000);
  if (start) await delay(100);
  await setReducedMotion(true);
  const done = start ? await waitForTraceEvent('v2:entrance-done', start.at, 1200) : null;
  const state = await stateSnapshot();
  record('accessibility.runtime-preference-change-cleans-up', Boolean(start && done)
    && done.at - start.at < 700 && cleanupContract(state), { start, done, state });
  await setReducedMotion(false);

  await clearOriginStorage();
  await evaluate(`(() => {
    const id = 'h4-keyboard';
    window.name = ${JSON.stringify(TAB_NAME_MARKER)} + id;
    sessionStorage.setItem(${JSON.stringify(TAB_KEY)}, id);
    sessionStorage.setItem(${JSON.stringify(ENTRY_KEY)}, 'seen');
    localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]');
  })()`);
  startedAt = Date.now();
  await cdp.send('Page.navigate', { url: `${hrefFor(routes.contacts)}?h4=keyboard` });
  const keyboardStart = await waitForTraceEvent('v2:entrance-start', startedAt, 5000);
  const keyboard = keyboardStart ? await evaluate(`(async () => {
    const skip = document.querySelector('a[href="#main-content"], .skip-link, [data-skip-link]');
    const pending = Array.from(document.querySelectorAll('[data-v2-entrance-node="pending"]'))
      .find((element) => element.matches('a,button') || element.querySelector('a,button'));
    const control = pending?.matches('a,button') ? pending : pending?.querySelector('a,button');
    if (!(pending instanceof HTMLElement) || !(control instanceof HTMLElement)) {
      return { found: false, skipFirst: Boolean(skip && document.querySelector('a,button,input,select,textarea,[tabindex]') === skip) };
    }
    const before = pending.dataset.v2EntranceNode;
    control.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { found: true, before, after: pending.dataset.v2EntranceNode,
      active: document.activeElement === control,
      skipFirst: Boolean(skip && document.querySelector('a,button,input,select,textarea,[tabindex]') === skip),
      skipOwned: Boolean(skip?.closest('[data-v2-entrance-role]')) };
  })()`) : null;
  await waitUntilUsable(5000);
  const keyboardState = await stateSnapshot();
  record('accessibility.keyboard-pending-control-and-skip-link', Boolean(keyboard?.found)
    && keyboard.before === 'pending' && keyboard.after === 'settled' && keyboard.active
    && keyboard.skipFirst && !keyboard.skipOwned && cleanupContract(keyboardState),
  { keyboardStart, keyboard, state: keyboardState });
};

const reducedMotionAudit = async () => {
  await setReducedMotion(true);
  await clearOriginStorage();
  await navigateHref(hrefFor(routes.deep));
  await settle(160);
  const entry = await stateSnapshot();
  const traceStart = (await getTrace()).length;
  storageEvents.length = 0;
  const targetHref = hrefFor(routes.about);
  const startedAt = Date.now();
  await fireRouteClick(targetHref);
  const arrived = await waitForCondition(`location.pathname === ${JSON.stringify(new URL(targetHref).pathname)}`, 5000);
  await waitUntilUsable(1500);
  const trace = (await getTrace()).slice(traceStart);
  const state = await stateSnapshot();
  const intercepted = trace.some((row) => ['covering','covered','arrival','waiting','revealing'].includes(row.pageState));
  const lifecycle = lifecycleContract(trace, { expectedSource: 'direct' });
  const normalFlash = trace.some((row) => row.motionProfile === 'normal');
  record('accessibility.reduced-motion', arrived && entry.entrySession === 'seen'
    && ['static','skipped','fail-open'].includes(entry.entryBootstrap) && !entry.locked
    && entry.motionProfile === 'reduce' && state.motionProfile === 'reduce' && !normalFlash
    && lifecycle.ok && !intercepted && readTokenEvents().length === 0
    && cleanupContract(state) && Date.now() - startedAt < 1500,
  { entry, intercepted, normalFlash, lifecycle, tokenEvents: readTokenEvents(), elapsedMs: Date.now() - startedAt, state });
  await setReducedMotion(false);
};

const saveDataAudit = async () => {
  await clearOriginStorage();
  const injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: Object.assign(new EventTarget(), { saveData: true, effectiveType: '4g' })
      });
    } catch {}`
  });
  try {
    await navigateHref(hrefFor(routes.deep));
    await settle(160);
    const entry = await stateSnapshot();
    const traceStart = (await getTrace()).length;
    storageEvents.length = 0;
    const targetHref = hrefFor(routes.business);
    const startedAt = Date.now();
    await fireRouteClick(targetHref);
    const arrived = await waitForCondition(`location.pathname === ${JSON.stringify(new URL(targetHref).pathname)}`, 5000);
    await waitUntilUsable(1500);
    const trace = (await getTrace()).slice(traceStart);
    const state = await stateSnapshot();
    const intercepted = trace.some((row) => ['covering','covered','arrival','waiting','revealing'].includes(row.pageState));
    const lifecycle = lifecycleContract(trace, { expectedSource: 'direct' });
    const normalFlash = trace.some((row) => row.motionProfile === 'normal');
    record('accessibility.save-data', arrived && entry.entrySession === 'seen'
      && ['static','skipped','fail-open'].includes(entry.entryBootstrap) && !entry.locked
      && entry.motionProfile === 'save-data' && state.motionProfile === 'save-data' && !normalFlash
      && lifecycle.ok && !intercepted && readTokenEvents().length === 0
      && cleanupContract(state) && Date.now() - startedAt < 1500,
    { entry, intercepted, normalFlash, lifecycle, tokenEvents: readTokenEvents(), elapsedMs: Date.now() - startedAt, state });
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
  }
};

const compactIncomingHandoffAudit = async ({
  profile,
  fromRoute,
  toRoute,
  variant
}) => {
  const reduced = profile === 'reduce';
  await setReducedMotion(reduced);
  await clearOriginStorage();
  const navigationId = `h4-${profile}-incoming-${Date.now().toString(36)}`;
  const fixture = handoffFixture({ fromRoute, toRoute, variant, navigationId });
  const targetHref = hrefFor(toRoute);
  const connectionBootstrap = profile === 'save-data'
    ? `try {
        Object.defineProperty(navigator, 'connection', {
          configurable: true,
          value: Object.assign(new EventTarget(), { saveData: true, effectiveType: '4g' })
        });
      } catch {}`
    : '';
  const injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      ${connectionBootstrap}
      try {
        const id = ${JSON.stringify(`h4-${profile}-incoming`)};
        window.name = ${JSON.stringify(TAB_NAME_MARKER)} + id;
        sessionStorage.setItem(${JSON.stringify(TAB_KEY)}, id);
        sessionStorage.setItem(${JSON.stringify(ENTRY_KEY)}, 'seen');
        sessionStorage.setItem(${JSON.stringify(HANDOFF_KEY)}, ${JSON.stringify(JSON.stringify(fixture))});
        localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]');
      } catch {}
      window.__smu1H4CompactHeaderStyles = null;
      document.addEventListener('v2:entrance-start', () => queueMicrotask(() => {
        window.__smu1H4CompactHeaderStyles = Array.from(document.querySelectorAll(
          '[data-v2-entrance-role="header-logo"], [data-v2-entrance-role="header-nav"], [data-v2-entrance-role="header-actions"]'
        )).filter((element) => getComputedStyle(element).display !== 'none').map((element) => {
          const style = getComputedStyle(element);
          return {
            role: element.getAttribute('data-v2-entrance-role') || '',
            transform: style.transform,
            translate: style.translate,
            scale: style.scale,
            transitionProperty: style.transitionProperty,
            transitionDelay: style.transitionDelay,
            transitionDuration: style.transitionDuration,
            willChange: style.willChange
          };
        });
      }), { once: true });
    })();`
  });

  try {
    await navigateHref(targetHref, { settleMs: 20 });
    await waitUntilUsable(4000);
    const trace = await getTrace();
    const state = await stateSnapshot();
    const headerStyles = await evaluate('window.__smu1H4CompactHeaderStyles || []');
    const compactPlaceholderState = await evaluate(`({
      images: document.querySelectorAll('[data-v2-transition-placeholder-image]').length,
      preloads: document.querySelectorAll('[data-v2-transition-placeholder-preload]').length
    })`);
    const eventRows = trace.filter((row) => row.kind === 'event');
    const readyRows = traceEvents(trace, 'v2:entrance-ready');
    const startRows = traceEvents(trace, 'v2:entrance-start');
    const terminalRows = eventRows.filter((row) => (
      ['v2:entrance-done', 'v2:entrance-fail-open'].includes(row.eventName)
    ));
    const activationIds = [...new Set([...readyRows, ...startRows, ...terminalRows]
      .map((row) => row.activationId || row.detail?.activationId).filter(Boolean))];
    const [ready] = readyRows;
    const [start] = startRows;
    const [terminal] = terminalRows;
    const compactElapsed = start && terminal ? terminal.at - start.at : null;
    const expectedDuration = reduced ? 120 : 160;
    const compactActivation = activationIds.length === 1
      && readyRows.length === 1 && startRows.length === 1 && terminalRows.length === 1
      && terminal?.eventName === 'v2:entrance-done'
      && [ready, start, terminal].every((row) => (
        (row?.activationId || row?.detail?.activationId) === activationIds[0]
      ))
      && (ready?.entranceSource || ready?.detail?.source) === `mpa-${variant}`
      && ready.at <= start.at && start.at <= terminal.at
      && compactElapsed <= expectedDuration + 35;
    const pageReveals = traceEvents(trace, 'v2:page-revealing');
    const pageDoneRows = traceEvents(trace, 'v2:page-done');
    const [pageReveal] = pageReveals;
    const [pageDone] = pageDoneRows;
    const forbiddenTimedPageStates = trace.filter((row) => (
      ['covering', 'covered', 'navigating', 'waiting', 'revealing'].includes(row.pageState)
    ));
    const expectedFailure = reduced ? 'reduced-motion' : 'save-data';
    const pageImmediateFailOpen = pageReveals.length === 1 && pageDoneRows.length === 1
      && pageReveal.detail?.variant === variant
      && pageReveal.detail?.outcome === 'fail-open'
      && pageReveal.detail?.reason === expectedFailure
      && pageDone.detail?.outcome === 'fail-open'
      && pageReveal.at <= pageDone.at && pageDone.at - pageReveal.at <= 50
      && Boolean(ready) && pageDone.at <= ready.at
      && !pageDone.locked && forbiddenTimedPageStates.length === 0;
    const noNormalFlash = !trace.some((row) => row.motionProfile === 'normal');
    const compactDurations = headerStyles.flatMap((style) => (
      style.transitionDuration.split(',').map((value) => cssTimeMs(value))
    ));
    const compactDurationOk = compactDurations.length >= 2
      && compactDurations.every((duration) => Number.isFinite(duration) && duration <= expectedDuration + .5);
    const noLegacyHeaderMotion = headerStyles.length >= 2 && headerStyles.every((style) => (
      style.transform === 'none'
      && ['none', '0px', '0px 0px'].includes(style.translate)
      && ['none', '1'].includes(style.scale)
      && style.transitionProperty.split(',').map((value) => value.trim()).every((value) => value === 'opacity')
      && style.transitionDelay.split(',').every((value) => cssTimeMs(value) === 0)
      && style.willChange === 'auto'
    ));
    record(`accessibility.${profile}-incoming-${variant}-handoff`, compactActivation && pageImmediateFailOpen
      && state.pageVariant === variant && state.motionProfile === profile && state.token === null
      && compactPlaceholderState.images === 0 && compactPlaceholderState.preloads === 0
      && noNormalFlash && compactDurationOk && noLegacyHeaderMotion && cleanupContract(state),
    { fixture, expectedDuration, compactElapsed, compactActivation, activationIds,
      pageImmediateFailOpen, forbiddenTimedPageStates, eventOrder: eventRows.map((row) => row.eventName),
      noNormalFlash, compactDurationOk, compactDurations, noLegacyHeaderMotion, headerStyles,
      compactPlaceholderState, state });
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
    await setReducedMotion(false);
  }
};

const storageFailOpenAudit = async () => {
  await clearOriginStorage();
  const injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function(key) {
        if (this === sessionStorage && String(key).startsWith('smu1:')) throw new Error('H2 QA storage read failure');
        return getItem.call(this, key);
      };
      Storage.prototype.setItem = function(key, value) {
        if (this === sessionStorage && String(key).startsWith('smu1:')) throw new Error('H2 QA storage write failure');
        return setItem.call(this, key, value);
      };
    })();`
  });
  try {
    await navigateHref(hrefFor(routes.home));
    await waitUntilUsable(6000);
    const state = await stateSnapshot();
    record('fail-open.storage-error', ['fail-open','static','skipped'].includes(state.entryBootstrap)
      && cleanupContract(state) && state.horizontalOverflow <= 1, state);
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
  }
};

const jsDisabledAudit = async () => {
  const targetHref = hrefFor(routes.contacts);
  let executionDisabled = false;

  const waitForLoadEvent = (timeoutMs = 30_000) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`JS-disabled navigation load timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    cdp.on('Page.loadEventFired', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });

  const attributesFor = async (nodeId) => {
    if (!nodeId) return {};
    const { attributes = [] } = await cdp.send('DOM.getAttributes', { nodeId });
    const result = {};
    for (let index = 0; index < attributes.length; index += 2) {
      result[attributes[index]] = attributes[index + 1] ?? '';
    }
    return result;
  };
  const styleFor = async (nodeId) => {
    if (!nodeId) return {};
    const { computedStyle = [] } = await cdp.send('CSS.getComputedStyleForNode', { nodeId });
    return Object.fromEntries(computedStyle.map(({ name, value }) => [name, value]));
  };
  const boxFor = async (nodeId) => {
    if (!nodeId) return { width: 0, height: 0 };
    try {
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
      const quad = model?.border || model?.content || [];
      const x = quad.filter((_, index) => index % 2 === 0);
      const y = quad.filter((_, index) => index % 2 === 1);
      return {
        width: x.length ? Math.max(...x) - Math.min(...x) : 0,
        height: y.length ? Math.max(...y) - Math.min(...y) : 0
      };
    } catch {
      return { width: 0, height: 0 };
    }
  };

  try {
    await clearOriginStorage();
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
    executionDisabled = true;

    const loaded = waitForLoadEvent();
    const navigation = await cdp.send('Page.navigate', { url: targetHref });
    if (navigation.errorText) throw new Error(`JS-disabled navigation failed: ${navigation.errorText}`);
    await loaded;
    await delay(180);

    const { root: documentNode } = await cdp.send('DOM.getDocument', { depth: 1, pierce: true });
    const query = async (selector) => (await cdp.send('DOM.querySelector', {
      nodeId: documentNode.nodeId,
      selector
    })).nodeId || 0;
    const queryAll = async (selector) => (await cdp.send('DOM.querySelectorAll', {
      nodeId: documentNode.nodeId,
      selector
    })).nodeIds || [];
    const [htmlId, bodyId, mainId, headerId, brandId, entryOverlayId, pageOverlayId] = await Promise.all([
      query('html'),
      query('body'),
      query('main'),
      query('[data-home-v2-header]'),
      query('[data-home-v2-header] .hv2-header__brand'),
      query('[data-v2-entry-root]'),
      query('[data-v2-page-transition]')
    ]);
    const motionRoleIds = await queryAll(
      '[data-v2-entrance-role]:not([hidden]):not([aria-hidden="true"]), [data-v2-reveal]:not([hidden]):not([aria-hidden="true"])'
    );
    const [motionRoleStyles, motionRoleBoxes] = await Promise.all([
      Promise.all(motionRoleIds.map(styleFor)),
      Promise.all(motionRoleIds.map(boxFor))
    ]);
    const [htmlAttributes, htmlStyle, bodyStyle, mainStyle, headerStyle, brandStyle,
      entryStyle, pageStyle, mainBox, headerBox, mainMarkup, history] = await Promise.all([
      attributesFor(htmlId),
      styleFor(htmlId),
      styleFor(bodyId),
      styleFor(mainId),
      styleFor(headerId),
      styleFor(brandId),
      styleFor(entryOverlayId),
      styleFor(pageOverlayId),
      boxFor(mainId),
      boxFor(headerId),
      mainId ? cdp.send('DOM.getOuterHTML', { nodeId: mainId }) : Promise.resolve({ outerHTML: '' }),
      cdp.send('Page.getNavigationHistory')
    ]);
    const currentUrl = history.entries?.[history.currentIndex]?.url || '';
    const classNames = String(htmlAttributes.class || '').split(/\s+/).filter(Boolean);
    const locked = classNames.some((name) => ['v2-page-transition-locked', 'v2-entry-scroll-locked'].includes(name))
      || htmlAttributes['data-v2-page-lock'] === 'true'
      || htmlAttributes['data-v2-scroll-locked'] === 'true';
    const blocksInput = (style) => style.display !== 'none'
      && style.visibility !== 'hidden'
      && style['pointer-events'] !== 'none';
    const details = {
      currentUrl,
      expectedUrl: targetHref,
      nodes: {
        main: Boolean(mainId), header: Boolean(headerId), brand: Boolean(brandId),
        entryOverlay: Boolean(entryOverlayId), pageOverlay: Boolean(pageOverlayId)
      },
      boxes: { main: mainBox, header: headerBox },
      styles: {
        htmlOverflow: htmlStyle['overflow-y'], bodyOverflow: bodyStyle['overflow-y'],
        mainDisplay: mainStyle.display, mainVisibility: mainStyle.visibility,
        headerDisplay: headerStyle.display, headerVisibility: headerStyle.visibility,
        brandOpacity: brandStyle.opacity,
        entryDisplay: entryStyle.display, entryVisibility: entryStyle.visibility,
        entryPointerEvents: entryStyle['pointer-events'],
        pageDisplay: pageStyle.display, pageVisibility: pageStyle.visibility,
        pagePointerEvents: pageStyle['pointer-events']
      },
      locked,
      mainMarkupLength: mainMarkup.outerHTML?.length || 0,
      motionProfile: htmlAttributes['data-v2-motion-profile'] || '',
      entranceState: htmlAttributes['data-v2-entrance-state'] || '',
      motionRoles: motionRoleIds.length,
      renderedMotionRoles: motionRoleBoxes.filter((box) => box.width > 0 && box.height > 0).length,
      hiddenMotionRoles: motionRoleStyles.map((style, index) => ({
        index,
        style,
        box: motionRoleBoxes[index]
      })).filter(({ style, box }) => box.width > 0 && box.height > 0
        && (style.display === 'none' || style.visibility === 'hidden'
          || Number.parseFloat(style.opacity || '1') === 0))
    };
    const ok = currentUrl === targetHref
      && Boolean(mainId && headerId && brandId && entryOverlayId && pageOverlayId)
      && mainBox.width > 0 && mainBox.height > 0 && headerBox.width > 0 && headerBox.height > 0
      && mainStyle.display !== 'none' && mainStyle.visibility !== 'hidden'
      && headerStyle.display !== 'none' && headerStyle.visibility !== 'hidden'
      && brandStyle.opacity !== '0'
      && !blocksInput(entryStyle) && !blocksInput(pageStyle)
      && htmlStyle['overflow-y'] !== 'hidden' && bodyStyle['overflow-y'] !== 'hidden'
      && !locked && !details.motionProfile && !details.entranceState
      && details.motionRoles > 0 && details.renderedMotionRoles > 0
      && details.hiddenMotionRoles.length === 0
      && (mainMarkup.outerHTML?.length || 0) > 100;
    record('accessibility.js-disabled', ok, details);
  } finally {
    if (executionDisabled) {
      await cdp.send('Emulation.setScriptExecutionDisabled', { value: false }).catch(() => {});
    }
  }
};

const bfcacheAudit = async () => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.contacts));
  await waitUntilUsable();
  await resetTrace();
  const synthetic = await evaluate(`(async () => {
    const html = document.documentElement;
    const overlay = document.querySelector('[data-v2-page-transition]');
    html.classList.add('v2-page-transition-locked');
    html.dataset.v2PageLock = 'true';
    html.dataset.v2PageState = 'covering';
    if (overlay) overlay.dataset.v2PageState = 'covering';
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      state: html.dataset.v2PageState || overlay?.dataset.v2PageState || '',
      locked: html.classList.contains('v2-page-transition-locked') || html.dataset.v2PageLock === 'true'
    };
  })()`);
  const syntheticTrace = await getTrace();
  record('bfcache.synthetic-pageshow-cleanup', !synthetic.locked
    && !['covering','covered','navigating'].includes(synthetic.state)
    && traceEvents(syntheticTrace, 'v2:entrance-ready').length === 0
    && traceEvents(syntheticTrace, 'v2:entrance-start').length === 0,
  { ...synthetic, events: syntheticTrace.filter((row) => row.kind === 'event') });

  const fromHref = await evaluate('location.href');
  await resetTrace();
  await fireRouteClick(hrefFor(routes.about));
  await waitForCondition(`location.pathname === ${JSON.stringify(new URL(hrefFor(routes.about)).pathname)}`, 8000);
  await waitUntilUsable();
  await evaluate('history.back()');
  const returned = await waitForCondition(`location.href === ${JSON.stringify(fromHref)}`, 8000);
  await settle(120);
  let trace = await getTrace();
  const persistedObserved = trace.some((row) => row.kind === 'pageshow' && row.persisted === true);
  if (!persistedObserved) await waitUntilUsable(6000);
  const state = await stateSnapshot();
  trace = await getTrace();
  const persistedRow = trace.find((row) => row.kind === 'pageshow' && row.persisted === true);
  const prepareRows = traceEvents(trace, 'v2:prepare-bfcache');
  const replayedAfterRestore = persistedRow
    ? traceEvents(trace, 'v2:entrance-start').filter((row) => row.doc === persistedRow.doc && row.at > persistedRow.at)
    : [];
  const historyLifecycle = persistedObserved ? null : lifecycleContract(trace, { expectedSource: 'history-document' });
  record('bfcache.real-back-forward-cleanup', returned && !state.locked
    && !['covering','covered','navigating','arrival','waiting','revealing'].includes(state.pageState)
    && cleanupContract(state) && prepareRows.length >= 1
    && (persistedObserved ? replayedAfterRestore.length === 0 : historyLifecycle?.ok),
  { returned, persistedObserved, prepareRows, replayedAfterRestore, historyLifecycle, state });
};

const mediaFailOpenAudit = async () => {
  if (options.externalOrigin) {
    record('media.delay-does-not-hold-entrance', true, { skipped: true, reason: '--origin cannot inject deterministic image latency' });
    record('media.error-does-not-hide-content', true, { skipped: true, reason: '--origin cannot inject invalid image bytes' });
    return;
  }
  const candidates = [routes.deep, routes.business, routes.standard, routes.premium, routes.home];
  let criticalRoute = '';
  let criticalSrc = '';
  for (const route of candidates) {
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(route));
    await waitUntilUsable();
    const snapshot = await stateSnapshot();
    if (snapshot.criticalSrc) {
      criticalRoute = route;
      criticalSrc = snapshot.criticalSrc;
      break;
    }
  }
  record('critical.marker-present', Boolean(criticalRoute && criticalSrc), { criticalRoute, criticalSrc });
  if (!criticalRoute || !criticalSrc) return;
  const criticalPathname = new URL(criticalSrc).pathname;

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.contacts));
  await waitUntilUsable();
  await resetTrace();
  configureFault(criticalPathname, 'delay', PAGE_DEADLINE_MS + 1800);
  const delayStart = Date.now();
  await fireRouteClick(`${hrefFor(criticalRoute)}?h2=deadline`);
  const entranceStart = await waitForTraceEvent('v2:entrance-start', delayStart, 5000);
  const usable = await waitUntilUsable(5000);
  const deadlineState = await stateSnapshot();
  const trace = await getTrace();
  const readyRow = traceEvents(trace, 'v2:entrance-ready').find((row) => row.doc === entranceStart?.doc);
  const revealingRow = traceEvents(trace, 'v2:page-revealing').find((row) => row.doc === entranceStart?.doc);
  const startAfterReady = readyRow && entranceStart ? entranceStart.at - readyRow.at : null;
  const startAfterReveal = revealingRow && entranceStart ? entranceStart.at - revealingRow.at : null;
  const mediaFile = await screenshot('media-delay-content-ready', {
    directory: 'final/entrance', flow: 'media-delay', activationSource: entranceStart?.detail?.source || '', offset: 2100,
    actualOffset: entranceStart ? Date.now() - entranceStart.at : null
  });
  record('media.delay-does-not-hold-entrance', Boolean(entranceStart && usable)
    && startAfterReady !== null && startAfterReady <= 250
    && startAfterReveal !== null && startAfterReveal <= 80
    && serverFault.hits === 1 && cleanupContract(deadlineState),
  { startAfterReady, startAfterReveal, hits: serverFault.hits, entranceStart, mediaFile, state: deadlineState });
  await delay(Math.max(0, PAGE_DEADLINE_MS + 1900 - (Date.now() - delayStart)));
  clearFault();

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.contacts));
  await waitUntilUsable();
  await resetTrace();
  configureFault(criticalPathname, 'invalid');
  const errorStartedAt = Date.now();
  await fireRouteClick(`${hrefFor(criticalRoute)}?h2=image-error`);
  const errorEntranceStart = await waitForTraceEvent('v2:entrance-start', errorStartedAt, 5000);
  const errorUsable = await waitUntilUsable(3500);
  const errorState = await stateSnapshot();
  const errorTrace = await getTrace();
  const errorLifecycle = lifecycleContract(errorTrace, {
    expectedSource: classify(hrefFor(routes.contacts)).rootSectionId === classify(hrefFor(criticalRoute)).rootSectionId
      ? 'mpa-calm' : 'mpa-h3'
  });
  record('media.error-does-not-hide-content', Boolean(errorEntranceStart && errorUsable)
    && serverFault.hits === 1 && errorState.criticalNaturalWidth === 0
    && errorLifecycle.ok && cleanupContract(errorState) && errorState.bodyOpacity === 1 && errorState.mainOpacity === 1,
  { hits: serverFault.hits, errorEntranceStart, errorLifecycle, state: errorState });
  clearFault();
};

const responsiveHeaderTypographyAudit = async () => {
  const viewports = [
    { width: 1920, height: 1080, mobile: false },
    { width: 1440, height: 900, mobile: false },
    { width: 1280, height: 800, mobile: false },
    { width: 1181, height: 800, mobile: false },
    { width: 390, height: 844, mobile: true },
    { width: 320, height: 700, mobile: true }
  ];
  const byKind = new Map();
  routeRegistry.forEach((descriptor) => {
    if (descriptor.interceptEligible === false || descriptor.routeKind === 'legacy-redirect') return;
    if (!byKind.has(descriptor.routeKind)) byKind.set(descriptor.routeKind, descriptor);
  });
  const representatives = [...byKind.values()];
  const readMetrics = () => evaluate(`(() => {
    const html = document.documentElement;
    const header = document.querySelector('[data-home-v2-header]');
    const brand = header?.querySelector('.hv2-header__brand');
    const brandImage = brand?.querySelector('img,svg');
    const navLink = header?.querySelector('.hv2-header__nav-link,[data-hv2-dropdown-trigger]');
    const actions = header?.querySelector('.hv2-header__actions');
    const phone = header?.querySelector('.hv2-header__phone');
    const telegram = header?.querySelector('.hv2-header__telegram');
    const telegramLabel = telegram?.querySelector('.hv2-header__telegram-label');
    const cta = header?.querySelector('.hv2-button--header');
    const menu = header?.querySelector('[data-hv2-mobile-open]');
    const main = document.querySelector('main');
    const h1 = main?.querySelector('h1,[data-v2-entrance-role="title-primary"]');
    const h2 = main?.querySelector([
      '.home-final .hf-section-head h2',
      '.home-final .hf-intake__intro h2',
      '.catalog-v2 .v2-section-heading h2',
      '.catalog-v2 .v2-custom-cta h2',
      '.catalog-v2 .v2-product-custom-project h2',
      '.catalog-v2 .v2-direct-contact__intro h2',
      '.catalog-product--premium .v2-premium-solution h2',
      '.catalog-product--premium .v2-premium-applications h2',
      '.catalog-product--premium .v2-premium-gallery h2',
      '.catalog-product--premium .v2-premium-adaptation h2',
      '.catalog-product--premium .v2-premium-variants h2',
      '.catalog-product--premium .v2-premium-technical h2',
      '.catalog-product--premium .v2-premium-delivery h2',
      '.catalog-product--premium .v2-premium-related h2',
      '.direction-v2 .direction-section-heading h2',
      '.direction-v2 .direction-intro__heading h2',
      '.direction-v2 .direction-scope__heading h2',
      '.direction-v2 .direction-brief__heading h2',
      '.direction-v2 .engineering-scope__heading h2',
      '.direction-v2 .engineering-tasks__heading h2',
      '.direction-v2 .engineering-proof__heading h2',
      '.direction-v2 .engineering-brief__heading h2',
      '.direction-v2 .place-section-heading h2',
      '.direction-v2 .place-intro__heading h2',
      '.direction-v2 .place-contexts__heading h2',
      '.direction-v2 .place-brief__heading h2',
      '.direction-v2 .project-scope__heading h2',
      '.direction-v2 .project-contexts__heading h2',
      '.direction-v2 .project-proof__heading h2',
      '.direction-v2 .project-brief__heading h2',
      '.projects-v2--archive .v2-project-archive__heading h2',
      '.projects-v2 .v2-project-detail__work h2',
      '.projects-v2 .v2-project-detail__section-heading h2',
      '.projects-v2 .v2-project-detail__facts > .hv2-shell > header h2',
      '.practical-v2 .practical-section-heading h2',
      '.practical-v2 .practical-company__details h2',
      '.practical-v2 .practical-contacts__details h2',
      '.practical-v2 .practical-contacts__brief h2',
      '.practical-v2 .practical-contacts__cta h2',
      '.practical-v2 .practical-vacancy__content h2',
      '.practical-v2 .practical-vacancy__contact h2',
      '.custom-order-v2 .custom-order-brief h2',
      '.custom-order-v2 .custom-order-directions h2',
      '.custom-order-v2 .custom-order-contact h2'
    ].join(','));
    const lead = main?.querySelector([
      '.home-final .hf-hero__lead',
      '.hv2-hero__lead',
      '.catalog-v2[data-product-final-prototype="hub"] .v2-catalog-hero__lead',
      '.catalog-v2[data-product-final-prototype="category"] .v2-catalog-hero__lead',
      '.catalog-v2[data-product-final-prototype="standard-product"] .v2-product-summary__lead',
      '.catalog-v2[data-product-final-prototype="premium-product"] .v2-premium-product-hero__lead',
      '.direction-hero__lead',
      '.engineering-hero__offer > p',
      '.place-hero__lead',
      '.project-hero__lead',
      '.immersive-direction-hero__lead',
      '.projects-v2--archive .v2-project-archive-hero__grid > p',
      '.projects-v2 .v2-project-detail__lead',
      '.practical-company__hero-lead',
      '.practical-hero__lead',
      '.practical-v2--contacts .practical-contacts__hero-grid > p',
      '.practical-v2--vacancies .practical-vacancies__hero-grid > p',
      '.custom-order-v2 .custom-order-hero__lead',
      '.not-found-v2__copy > p:last-of-type'
    ].join(','));
    const metric = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const lineHeight = Number.parseFloat(style.lineHeight);
      return {
        selector: element.tagName.toLowerCase() + (element.classList.length ? '.' + [...element.classList].slice(0, 2).join('.') : ''),
        text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight,
        fontWeight: style.fontWeight,
        maxWidth: style.maxWidth,
        width: rect.width,
        height: rect.height,
        lines: lineHeight > 0 ? Math.round(rect.height / lineHeight * 100) / 100 : null,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        overflow: Math.max(0, element.scrollWidth - element.clientWidth)
      };
    };
    const rectMetric = (element) => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        fontSize: Number.parseFloat(style.fontSize), minHeight: Number.parseFloat(style.minHeight) || 0,
        color: style.color, background: style.backgroundColor, display: style.display };
    };
    const textRangeMetric = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 };
    };
    const headerStyle = header ? getComputedStyle(header) : null;
    return {
      href: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      meaningfulDom: Boolean(main && (main.innerText || '').trim().length > 100),
      frameworkError: Boolean(document.querySelector('vite-error-overlay, astro-dev-overlay, [data-error-overlay]')),
      header: header ? {
        mode: header.getAttribute('data-hv2-header-mode') || '',
        scrolled: header.classList.contains('is-scrolled'),
        hidden: header.classList.contains('is-hidden'),
        cssHeight: Number.parseFloat(getComputedStyle(html).getPropertyValue('--hv2-header-height')),
        rect: rectMetric(header),
        brand: rectMetric(brand),
        brandImage: rectMetric(brandImage),
        nav: rectMetric(navLink),
        actions: rectMetric(actions),
        phone: rectMetric(phone),
        telegram: rectMetric(telegram),
        telegramLabel: rectMetric(telegramLabel),
        telegramText: textRangeMetric(telegramLabel),
        cta: rectMetric(cta),
        menu: rectMetric(menu),
        background: headerStyle.backgroundColor,
        borderBottomWidth: headerStyle.borderBottomWidth,
        borderBottomColor: headerStyle.borderBottomColor,
        boxShadow: headerStyle.boxShadow,
        backdropFilter: headerStyle.backdropFilter || headerStyle.webkitBackdropFilter || 'none'
      } : null,
      type: { h1: metric(h1), h2: metric(h2), lead: metric(lead) },
      overflow: Math.max(0, html.scrollWidth - html.clientWidth),
      scrollY,
      bodyOpacity: Number.parseFloat(getComputedStyle(document.body).opacity),
      mainOpacity: main ? Number.parseFloat(getComputedStyle(main).opacity) : -1
    };
  })()`);
  const expectedHeaderHeight = (width) => width >= 1440 ? 92 : width >= 1181 ? 88 : width >= 761 ? 80 : 72;
  const expectedLogoWidth = (width) => width >= 1440 ? 80 : width >= 1181 ? 76 : width >= 761 ? 72 : 66;
  const typeFamilyForRouteKind = (routeKind) => {
    if (routeKind === 'home') return 'home';
    if (['projects-archive', 'contacts', 'careers-archive', 'custom-order', 'not-found'].includes(routeKind)) {
      return 'short';
    }
    if (['section-hub', 'category', 'direction', 'company'].includes(routeKind)) return 'direction';
    if (routeKind.startsWith('product-') || ['project-detail', 'career-detail', 'legal'].includes(routeKind)) {
      return 'long';
    }
    return null;
  };
  const typeScaleFor = (routeKind, width) => {
    const family = typeFamilyForRouteKind(routeKind);
    if (!family) return null;
    const breakpoint = width <= 760 ? 'mobile' : width <= 1180 ? 'tablet' : 'desktop';
    const clampPx = (minimum, preferredRatio, maximum) => (
      Math.min(maximum, Math.max(minimum, width * preferredRatio))
    );
    const h1 = {
      desktop: {
        home: () => clampPx(88, .05, 96),
        short: () => clampPx(88, .059, 112),
        direction: () => clampPx(72, .054, 96),
        long: () => clampPx(56, .04, 76)
      },
      tablet: {
        home: () => clampPx(64, .074, 88),
        short: () => clampPx(64, .074, 88),
        direction: () => clampPx(58, .063, 72),
        long: () => clampPx(48, .05, 56)
      },
      mobile: {
        home: () => clampPx(44, .118, 48),
        short: () => clampPx(44, .128, 52),
        direction: () => clampPx(44, .12, 52),
        long: () => clampPx(38, .113, 46)
      }
    }[breakpoint][family]();
    const h2 = breakpoint === 'desktop'
      ? clampPx(44, .0325, 62)
      : breakpoint === 'tablet' ? clampPx(38, .04, 44) : clampPx(32, .098, 42);
    const lead = breakpoint === 'desktop'
      ? clampPx(22, .016, 28)
      : breakpoint === 'tablet' ? clampPx(20, .019, 22) : clampPx(18, .05, 21);
    return { family, breakpoint, h1, h2, lead, tolerance: .25 };
  };
  const colorAlpha = (value) => {
    const match = String(value || '').match(/rgba?\([^/)]*(?:\/|,)\s*([\d.]+)%?\s*\)$/i);
    if (!String(value || '').startsWith('rgba')) return 1;
    return match ? Number.parseFloat(match[1]) : 0;
  };

  for (const viewport of viewports) {
    await setViewport(viewport.width, viewport.height, viewport.mobile, 1);
    for (const descriptor of representatives) {
      await clearOriginStorage();
      const routeHref = hrefFor(descriptor.pathname);
      await seedEntrySeenAndNavigate(routeHref);
      await waitUntilUsable(6500);
      await evaluate(`(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        document.body.style.scrollBehavior = 'auto';
        scrollTo(0, 0);
      })()`);
      await settle(80);
      const initial = await readMetrics();
      const scrollTarget = await evaluate(`(() => {
        const header = document.querySelector('[data-home-v2-header]');
        const boundary = document.querySelector('[data-hv2-hero], [data-immersive-direction-hero], [data-v2-hero-scroll]');
        const maxScroll = Math.max(0,
          Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) - innerHeight);
        const boundaryBottom = boundary
          ? boundary.getBoundingClientRect().bottom + scrollY
          : 0;
        const solidAt = boundary
          ? Math.max(0, boundaryBottom - (header?.offsetHeight || 0) + 1)
          : 0;
        const destination = Math.min(maxScroll, Math.max(innerHeight + 180, solidAt + 120));
        scrollTo(0, destination);
        return { destination, maxScroll, boundaryBottom, solidAt, canCross: maxScroll >= solidAt };
      })()`);
      await settle(120);
      await evaluate('scrollBy(0, -24)');
      await settle(80);
      const scrolled = await readMetrics();
      const metricId = `${descriptor.routeKind}-${viewport.width}x${viewport.height}`;
      const headerExpected = expectedHeaderHeight(viewport.width);
      const logoExpected = expectedLogoWidth(viewport.width);
      const menuVisible = Boolean(initial.header?.menu
        && initial.header.menu.display !== 'none'
        && initial.header.menu.width > 0 && initial.header.menu.height > 0);
      const fullNavVisible = Boolean(initial.header?.nav
        && initial.header.nav.display !== 'none'
        && initial.header.nav.width > 0 && initial.header.nav.height > 0);
      const controlsOk = menuVisible
        ? initial.header.menu.height >= 44 && initial.header.menu.height <= 52
          && initial.header.menu.width >= (viewport.width <= 760 ? 44 : 87)
        : fullNavVisible && initial.header.nav.fontSize >= 12.5 && initial.header.nav.fontSize <= 15
          && initial.header.nav.height >= 44 && initial.header.cta?.height >= 44;
      const telegramVisible = Boolean(initial.header?.actions
        && initial.header.actions.display !== 'none'
        && initial.header.actions.width > 0 && initial.header.actions.height > 0);
      const telegramGeometryOk = !telegramVisible || Boolean(
        initial.header.telegram && initial.header.telegramText && scrolled.header.telegram && scrolled.header.telegramText
        && initial.header.telegram.width >= 44 && initial.header.telegram.height >= 44
        && scrolled.header.telegram.width >= 44 && scrolled.header.telegram.height >= 44
        && Math.abs(initial.header.telegramText.centerY
          - (initial.header.telegram.top + initial.header.telegram.height / 2)) <= 1
        && Math.abs((initial.header.telegram.top + initial.header.telegram.height / 2)
          - (initial.header.actions.top + initial.header.actions.height / 2)) <= 1
        && Math.abs(scrolled.header.telegramText.centerY
          - (scrolled.header.telegram.top + scrolled.header.telegram.height / 2)) <= 1
        && Math.abs((scrolled.header.telegram.top + scrolled.header.telegram.height / 2)
          - (scrolled.header.actions.top + scrolled.header.actions.height / 2)) <= 1
        && Math.abs(scrolled.header.phone.top - initial.header.phone.top) <= 1
        && Math.abs(scrolled.header.phone.height - initial.header.phone.height) <= 1
        && Math.abs(scrolled.header.cta.top - initial.header.cta.top) <= 1
        && Math.abs(scrolled.header.cta.height - initial.header.cta.height) <= 1
      );
      const headerOk = Boolean(initial.header && scrolled.header)
        && Math.abs(initial.header.cssHeight - headerExpected) <= .5
        && Math.abs(initial.header.rect.height - headerExpected) <= 1
        && Math.abs(scrolled.header.rect.height - initial.header.rect.height) <= 1
        && Math.abs(initial.header.brand.width - logoExpected) <= 9
        && Math.abs(scrolled.header.brand.width - initial.header.brand.width) <= 1
        && controlsOk && telegramGeometryOk
        && (viewport.width > 760 || menuVisible);
      const visualContract = (header) => {
        if (!header) return false;
        const overlay = header.mode === 'overlay' && !header.scrolled;
        return overlay
          ? colorAlpha(header.background) <= .01
            && header.borderBottomWidth === '0px'
            && header.boxShadow === 'none' && header.backdropFilter === 'none'
          : header.scrolled && colorAlpha(header.background) >= .9
            && header.boxShadow !== 'none' && header.backdropFilter === 'none';
      };
      const initialVisualOk = visualContract(initial.header);
      const scrolledVisualOk = visualContract(scrolled.header);
      const headerVisualOk = Boolean(initial.header && scrolled.header) && initialVisualOk && scrolledVisualOk
        && (!scrollTarget.canCross || scrolled.header.scrolled)
        && initial.header.backdropFilter === 'none' && scrolled.header.backdropFilter === 'none';
      const h1 = initial.type.h1;
      const h2 = initial.type.h2;
      const lead = initial.type.lead;
      const typeScale = typeScaleFor(descriptor.routeKind, viewport.width);
      const h2Ok = !h2 || Boolean(typeScale)
        && Math.abs(h2.fontSize - typeScale.h2) <= typeScale.tolerance;
      const leadOk = !lead || Boolean(typeScale)
        && Math.abs(lead.fontSize - typeScale.lead) <= typeScale.tolerance;
      const typeOk = Boolean(typeScale && h1)
        && Math.abs(h1.fontSize - typeScale.h1) <= typeScale.tolerance
        && h2Ok && leadOk;
      const overflowOk = initial.overflow <= 1 && scrolled.overflow <= 1
        && !initial.frameworkError && initial.meaningfulDom && initial.bodyOpacity === 1 && initial.mainOpacity === 1;
      const tooLong = [h1, h2, lead].filter(Boolean).filter((item) => item.overflow > 1
        || (item === h1 && item.lines > (viewport.width <= 760 ? 4.2 : 3.2)));
      if (tooLong.length) longTextIssues.push({ route: descriptor.pathname, routeKind: descriptor.routeKind,
        viewport: `${viewport.width}x${viewport.height}`, issues: tooLong });
      const file = await screenshot(metricId, {
        directory: 'final/responsive',
        flow: `responsive-${descriptor.routeKind}`,
        route: descriptor.pathname,
        activationSource: 'direct'
      });
      const evidenceOk = Boolean(file);
      const row = {
        route: descriptor.pathname,
        routeKind: descriptor.routeKind,
        viewport: `${viewport.width}x${viewport.height}`,
        expected: { headerHeight: headerExpected, logoWidth: logoExpected, typeScale },
        headerOk,
        telegramGeometryOk,
        headerVisualOk,
        typeOk,
        overflowOk,
        evidenceOk,
        scrollTarget,
        initial,
        scrolled,
        file
      };
      responsiveMetrics.push(row);
      record(`responsive.${metricId}`, headerOk && headerVisualOk && typeOk && overflowOk && evidenceOk, row);
    }
  }
  record('responsive.six-viewports-all-production-templates', responsiveMetrics.length === viewports.length * representatives.length
    && responsiveMetrics.every((row) => row.headerOk && row.headerVisualOk && row.typeOk && row.overflowOk && row.evidenceOk),
  { viewports: viewports.map(({ width, height }) => `${width}x${height}`),
    templates: representatives.map(({ routeKind, pathname }) => ({ routeKind, pathname })),
    audited: responsiveMetrics.length,
    failures: responsiveMetrics.filter((row) => !row.headerOk || !row.headerVisualOk || !row.typeOk || !row.overflowOk || !row.evidenceOk)
      .map(({ route, routeKind, viewport, headerOk, telegramGeometryOk, headerVisualOk, typeOk, overflowOk, evidenceOk }) => (
        { route, routeKind, viewport, headerOk, telegramGeometryOk, headerVisualOk, typeOk, overflowOk, evidenceOk }
      )),
    longTextIssues });
  await setViewport(1440, 900, false, 1);
};

const githubBaseAudit = async () => {
  if (!baseBuildRoot) {
    record('base.github-pages', true, {
      skipped: true,
      reason: options.externalOrigin ? '--origin supplied; use an origin whose path is /SMU1/ for deployed QA' : '--skip-base-build supplied'
    });
    return;
  }
  const baseRootHref = hrefFor('/', options.githubBase);
  const baseTargetHref = hrefFor(routes.deep, options.githubBase);
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(baseRootHref);
  await waitUntilUsable();
  storageEvents.length = 0;
  await fireRouteClick(baseTargetHref);
  const arrived = await waitForCondition(`location.pathname === ${JSON.stringify(new URL(baseTargetHref).pathname)}`, 10_000);
  await waitUntilUsable();
  const tokenEvent = readTokenEvents().find((event) => ['added','updated'].includes(event.type));
  let token = null;
  try { token = JSON.parse(tokenEvent?.newValue || 'null'); } catch {}
  const snapshot = await stateSnapshot();
  const trace = await getTrace();
  const lifecycle = lifecycleContract(trace, { expectedSource: 'mpa-h3' });
  const assetIssues = await evaluate(`Array.from(document.querySelectorAll('link[href],script[src],img[src]'))
    .map((element) => element.href || element.src).filter((value) => {
      try { const url = new URL(value); return url.origin === location.origin && !url.pathname.startsWith(${JSON.stringify(options.githubBase)}); }
      catch { return false; }
    }).slice(0, 20)`);
  const baseMedia = await evaluate(`(async () => {
    const placeholder = document.querySelector('[data-v2-transition-placeholder-image]');
    const semantic = document.querySelector('.immersive-direction-hero__media [data-v2-page-critical]')
      || document.querySelector('[data-v2-page-critical]');
    const placeholderUrl = placeholder?.currentSrc || placeholder?.src || '';
    let placeholderStatus = null;
    if (placeholderUrl) {
      try { placeholderStatus = (await fetch(placeholderUrl, { method: 'HEAD', cache: 'no-store' })).status; }
      catch { placeholderStatus = 0; }
    }
    return {
      placeholderUrl,
      placeholderPathname: placeholderUrl ? new URL(placeholderUrl).pathname : '',
      placeholderLoaded: Boolean(placeholder?.complete && placeholder.naturalWidth > 0),
      placeholderStatus,
      semanticUrl: semantic?.currentSrc || semantic?.src || '',
      semanticPathname: semantic ? new URL(semantic.currentSrc || semantic.src, location.href).pathname : ''
    };
  })()`);
  record('base.github-pages', arrived && snapshot.pathname.startsWith(options.githubBase)
    && token?.version === TOKEN_VERSION && token?.variant === 'h3'
    && token?.target === targetValue(baseTargetHref) && token?.nonce === token?.navigationId
    && snapshot.token === null && lifecycle.ok
    && assetIssues.length === 0
    && baseMedia.placeholderLoaded && baseMedia.placeholderStatus === 200
    && baseMedia.placeholderPathname.startsWith(`${options.githubBase}_media/h5/`)
    && baseMedia.semanticPathname.startsWith(`${options.githubBase}_media/h5/`)
    && cleanupContract(snapshot),
  { base: options.githubBase, token, lifecycle, snapshot, assetIssues, baseMedia });
};

try {
  const websocketUrl = await waitForDebugger();
  cdp = new CdpClient(websocketUrl);
  await cdp.connect();
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    runtimeErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception');
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error' || type === 'assert') runtimeErrors.push(args?.map((item) => item.value || item.description || '').join(' ') || `console.${type}`);
    if (type === 'warning') runtimeWarnings.push(args?.map((item) => item.value || item.description || '').join(' ') || 'console.warning');
  });
  cdp.on('Network.responseReceived', ({ response }) => {
    if (response?.url?.startsWith(origin) && response.status >= 400) networkErrors.push(`${response.status}:${response.url}`);
  });
  for (const [method, type] of [
    ['DOMStorage.domStorageItemAdded', 'added'],
    ['DOMStorage.domStorageItemUpdated', 'updated'],
    ['DOMStorage.domStorageItemRemoved', 'removed'],
    ['DOMStorage.domStorageItemsCleared', 'cleared']
  ]) cdp.on(method, (event) => storageEvents.push({ type, at: Date.now(), ...event }));
  await Promise.all([
    cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable'),
    cdp.send('Log.enable'), cdp.send('DOMStorage.enable')
  ]);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.setBlockedURLs', {
    urls: [
      '*://fonts.googleapis.com/*', '*://fonts.gstatic.com/*', '*://mc.yandex.ru/*',
      '*://api-maps.yandex.ru/*', '*://yandex.ru/*', '*.mp4', '*.webm'
    ]
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: TRACE_BOOTSTRAP });
  await setViewport(1440, 900, false, 1);
  classifierResolverTableAudit();

  await introAudit('cold-root', hrefFor(routes.home));
  await introAudit('cold-deep-entry', hrefFor(routes.deep));

  const reloadTraceStart = (await getTrace()).length;
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitForCondition(`document.readyState === 'complete'`, 20_000);
  await settle(180);
  const reloadState = await stateSnapshot();
  const reloadTrace = (await getTrace()).slice(reloadTraceStart);
  record('entry.reload-does-not-repeat', !reloadTrace.some((row) => ['logo','waiting','opening','assembling'].includes(row.entryState))
    && ['static','skipped','fail-open'].includes(reloadState.entryBootstrap) && !reloadState.locked,
  { state: reloadState, states: reloadTrace.map((row) => row.entryState).filter(Boolean) });

  await hashEntrySkipAudit();

  await transitionFilmstripAudit();
  await fullBleedTransitionMediaAudit();
  await transitionMobileVisualContractAudit();
  await transitionMobileFilmstripsAudit();
  await calmTransitionFilmstripAudit();
  await entranceFilmstripAudit();
  await mobileEntranceFilmstripAudit();
  await directReloadAndDeepScrollAudit();
  await productionNotFoundEntranceAudit();
  await actualNavigationFamiliesAudit();
  await crossPageHashAudit();
  await sameDocumentHashLifecycleAudit();
  await queryNativeLifecycleAudit();
  await sectionScrollAudit();
  await scrollOwnershipAudit();

  await invalidTokenAudit('mismatched', JSON.stringify(handoffFixture({
    toRoute: routes.contacts,
    targetHref: hrefFor(routes.about),
    navigationId: 'h4-mismatch'
  })), hrefFor(routes.contacts));
  await invalidTokenAudit('stale', JSON.stringify(handoffFixture({
    toRoute: routes.about,
    timestamp: Date.now() - TOKEN_TTL_MS - 1000,
    navigationId: 'h4-stale'
  })), hrefFor(routes.about));
  await invalidTokenAudit('malformed', '{not-json', hrefFor(routes.contacts));
  await consumedTokenReplayAudit();

  await clickFilterAudit();
  await reducedMotionAudit();
  await saveDataAudit();
  await compactIncomingHandoffAudit({
    profile: 'reduce',
    fromRoute: routes.home,
    toRoute: routes.about,
    variant: 'h3'
  });
  await compactIncomingHandoffAudit({
    profile: 'save-data',
    fromRoute: routes.street,
    toRoute: routes.streetCategory,
    variant: 'calm'
  });
  await runtimePreferenceAndKeyboardAudit();
  await noIntersectionObserverAudit();
  await controllerFailOpenAudit();
  await entryCancelPersistenceAudit();
  await incomingReadinessDeadlineAudit();
  await storageFailOpenAudit();
  await previewIsolationAudit();
  await mobileMenuSnapshotAudit();
  await bfcacheAudit();
  await mediaFailOpenAudit();
  await githubBaseAudit();
  await responsiveHeaderTypographyAudit();
  await jsDisabledAudit();

  const unexpectedRuntimeErrors = runtimeErrors.filter((error) => !/H2 QA storage (?:read|write) failure/.test(error));
  const expectedFaultPath = serverFault.pathname;
  const unexpectedNetworkErrors = networkErrors.filter((error) => (
    (!expectedFaultPath || !error.includes(expectedFaultPath))
    && !/\/404(?:\.html)?(?:[?#]|$)/.test(error)
  ));
  record('runtime.console-and-exceptions', unexpectedRuntimeErrors.length === 0,
    { errors: unexpectedRuntimeErrors.slice(0, 25), total: unexpectedRuntimeErrors.length });
  record('runtime.console-warnings', runtimeWarnings.length === 0,
    { warnings: runtimeWarnings.slice(0, 25), total: runtimeWarnings.length });
  record('runtime.local-network', unexpectedNetworkErrors.length === 0,
    { errors: unexpectedNetworkErrors.slice(0, 25), total: unexpectedNetworkErrors.length });
} catch (error) {
  browserFatalError = error instanceof Error ? (error.stack || error.message) : String(error);
  record('browser.fatal', false, {
    error: browserFatalError,
    browserExit,
    chromiumStderr: chromiumStderrPath,
    profile: profileRoot
  });
} finally {
  clearFault();
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  }
  await Promise.race([browserExitPromise, delay(3500)]);
  if (browser.exitCode === null) {
    browser.kill('SIGKILL');
    await Promise.race([browserExitPromise, delay(1200)]);
  }
  await Promise.race([
    new Promise((resolve) => chromiumStderr.writableFinished
      ? resolve()
      : chromiumStderr.once('finish', resolve)),
    delay(1000)
  ]);
  if (server) await new Promise((resolve) => server.close(resolve));
  if (!options.keepProfile && !browserFatalError) await rm(profileRoot, { recursive: true, force: true }).catch(() => {});
  if (baseBuildRoot) await rm(baseBuildRoot, { recursive: true, force: true }).catch(() => {});
}

const summary = {
  result: failures.length ? 'fail' : 'pass',
  checks: checks.length,
  passed: checks.length - failures.length,
  failed: failures.length,
  origin,
  primaryBase,
  githubBase: options.githubBase,
  routes,
  artifacts: artifactRoot,
  manifest: path.join(artifactRoot, 'manifest.json'),
  captures: captureManifest.length,
  responsiveMetricRows: responsiveMetrics.length,
  registryEntries: routeRegistry.length,
  profile: options.keepProfile || browserFatalError ? profileRoot : null,
  browser: { ...browserExit, chromiumStderr: chromiumStderrPath },
  failures
};
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  branch: gitHead.branch,
  baselineSha,
  finalSha: gitHead.sha,
  origin,
  artifactRoot,
  classification: options.externalOrigin ? 'external-local-origin-cdp' : 'repo-dist-cdp-chromium',
  registry: {
    version: routeRegistryPayload.version,
    entries: routeRegistry.length,
    compatibilityAliases: V2_COMPATIBILITY_ROUTES.length
  },
  captures: captureManifest,
  counts: {
    total: captureManifest.length,
    h3: captureManifest.filter((item) => item.variant === 'h3').length,
    calm: captureManifest.filter((item) => item.variant === 'calm').length,
    entrance: captureManifest.filter((item) => item.filename.startsWith('final/entrance/')).length,
    scroll: captureManifest.filter((item) => item.filename.startsWith('final/scroll/')).length,
    responsive: captureManifest.filter((item) => item.filename.startsWith('final/responsive/')).length
  },
  console: {
    errors: runtimeErrors,
    warnings: runtimeWarnings,
    networkErrors
  }
};
await Promise.all([
  writeFile(path.join(artifactRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(path.join(artifactRoot, 'traces.json'), `${JSON.stringify(traceEvidence, null, 2)}\n`),
  writeFile(path.join(artifactRoot, 'responsive-metrics.json'), `${JSON.stringify({ rows: responsiveMetrics, longTextIssues }, null, 2)}\n`)
]);
await writeFile(path.join(artifactRoot, 'summary.json'), `${JSON.stringify({ ...summary, checkDetails: checks }, null, 2)}\n`);
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
} catch (error) {
  browserFatalError = error instanceof Error ? (error.stack || error.message) : String(error);
  if (!checks.some((check) => check.id === 'browser.fatal')) {
    record('browser.fatal', false, {
      error: browserFatalError,
      browserExit,
      chromiumStderr: chromiumStderrPath,
      profile: profileRoot
    });
  }
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  }
  if (browser?.exitCode === null) {
    browser.kill('SIGKILL');
    await Promise.race([browserExitPromise, delay(1200)]);
  }
  if (chromiumStderr && !chromiumStderr.writableEnded) chromiumStderr.end();
  if (server) await new Promise((resolve) => server.close(() => resolve())).catch(() => {});
  if (baseBuildRoot) await rm(baseBuildRoot, { recursive: true, force: true }).catch(() => {});
  if (!options.keepProfile) await rm(profileRoot, { recursive: true, force: true }).catch(() => {});

  const fatalManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    branch: gitHead.branch,
    baselineSha,
    finalSha: gitHead.sha,
    origin,
    artifactRoot,
    classification: options.externalOrigin ? 'external-local-origin-cdp' : 'repo-dist-cdp-chromium',
    registry: {
      version: routeRegistryPayload.version,
      entries: routeRegistry.length,
      compatibilityAliases: V2_COMPATIBILITY_ROUTES.length
    },
    captures: captureManifest,
    counts: {
      total: captureManifest.length,
      h3: captureManifest.filter((item) => item.variant === 'h3').length,
      calm: captureManifest.filter((item) => item.variant === 'calm').length,
      entrance: captureManifest.filter((item) => item.filename.startsWith('final/entrance/')).length,
      scroll: captureManifest.filter((item) => item.filename.startsWith('final/scroll/')).length,
      responsive: captureManifest.filter((item) => item.filename.startsWith('final/responsive/')).length
    },
    console: { errors: runtimeErrors, warnings: runtimeWarnings, networkErrors },
    fatal: browserFatalError
  };
  const fatalSummary = {
    result: 'fail',
    checks: checks.length,
    passed: checks.length - failures.length,
    failed: failures.length,
    origin,
    primaryBase,
    githubBase: options.githubBase,
    routes,
    artifacts: artifactRoot,
    manifest: path.join(artifactRoot, 'manifest.json'),
    captures: captureManifest.length,
    responsiveMetricRows: responsiveMetrics.length,
    registryEntries: routeRegistry.length,
    profile: options.keepProfile ? profileRoot : null,
    browser: { ...browserExit, chromiumStderr: chromiumStderrPath },
    failures
  };
  await Promise.all([
    writeFile(path.join(artifactRoot, 'manifest.json'), `${JSON.stringify(fatalManifest, null, 2)}\n`),
    writeFile(path.join(artifactRoot, 'traces.json'), `${JSON.stringify(traceEvidence, null, 2)}\n`),
    writeFile(path.join(artifactRoot, 'responsive-metrics.json'), `${JSON.stringify({ rows: responsiveMetrics, longTextIssues }, null, 2)}\n`),
    writeFile(path.join(artifactRoot, 'summary.json'), `${JSON.stringify({ ...fatalSummary, checkDetails: checks }, null, 2)}\n`)
  ]);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...fatalSummary, checkDetails: checks }, null, 2)}\n`);
  } else {
    for (const check of checks) {
      const details = check.status === 'fail'
        ? ` ${JSON.stringify(Object.fromEntries(Object.entries(check).filter(([key]) => !['id', 'status'].includes(key))))}`
        : '';
      process.stdout.write(`${check.status === 'pass' ? 'PASS' : 'FAIL'} ${check.id}${details}\n`);
    }
    process.stdout.write(`\n${JSON.stringify(fatalSummary, null, 2)}\n`);
  }
  process.exitCode = 1;
}

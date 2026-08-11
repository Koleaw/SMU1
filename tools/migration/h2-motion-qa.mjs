import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

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
  artifacts: optionValue('--artifacts').trim(),
  githubBase: normalizeBase(optionValue('--github-base') || '/SMU1/')
};

if (options.help) {
  process.stdout.write(`H2 first-entry and Navigation Drawing browser QA\n\n`);
  process.stdout.write(`  node tools/migration/h2-motion-qa.mjs\n`);
  process.stdout.write(`      Serve ./dist, run the complete H2 motion suite, build a temporary /SMU1/ copy,\n`);
  process.stdout.write(`      and save a transition filmstrip below the operating-system temp directory.\n`);
  process.stdout.write(`  node tools/migration/h2-motion-qa.mjs --origin=http://127.0.0.1:4321\n`);
  process.stdout.write(`      Test an existing local origin. Deterministic media faults and the temporary base build are skipped.\n`);
  process.stdout.write(`  Optional: --headful, --json, --artifacts=/absolute/path, --github-base=/SMU1/,\n`);
  process.stdout.write(`            --skip-base-build, --keep-profile, CHROME_PATH=/path/to/chrome.\n`);
  process.exit(0);
}

const ENTRY_KEY = 'smu1:entry-intro:v2';
const HANDOFF_KEY = 'smu1:page-transition:v1';
const TAB_KEY = 'smu1:browser-tab:v1';
const TAB_NAME_MARKER = '__smu1_browser_tab_v1__:';
const TRACE_KEY = '__smu1:h2-motion-qa:trace';
const TOKEN_VERSION = 1;
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
const artifactRoot = path.resolve(options.artifacts || path.join(os.tmpdir(), `smu1-h2-motion-qa-${timestamp}`));
await mkdir(artifactRoot, { recursive: true });
const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'smu1-h2-motion-profile-'));
let baseBuildRoot = null;

const content = (collection) => fs.readdirSync(path.join(root, 'src', 'content', collection))
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'content', collection, name), 'utf8')));
const products = content('products');
const categoryBySlug = new Map(content('product-categories').map((item) => [item.slug, item]));
const productRoute = (product) => {
  const category = categoryBySlug.get(product.productCategorySlug);
  return category ? `/${category.parentSectionSlug}/${category.slug}/${product.slug}/` : '';
};
const standardProduct = products.find((product) => product.slug === 'skamya-park' && product.presentationType === 'standard')
  || products.find((product) => product.presentationType === 'standard' && product.image);
const premiumProduct = products.find((product) => product.slug === 'kachel-portal' && product.presentationType === 'premium')
  || products.find((product) => product.presentationType === 'premium' && product.image);
const routes = {
  home: '/',
  deep: '/topiarii/',
  business: '/metallokonstruktsii-dlya-biznesa/',
  about: '/o-nas/',
  contacts: '/kontakty/',
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

const localPort = 5200 + Math.floor(Math.random() * 500);
const localOrigin = `http://127.0.0.1:${localPort}`;
const parsedExternal = options.externalOrigin ? new URL(options.externalOrigin) : null;
if (parsedExternal && !['127.0.0.1', 'localhost', '::1'].includes(parsedExternal.hostname)) {
  throw new Error(`--origin must be local; received ${parsedExternal.hostname}.`);
}
const origin = parsedExternal?.origin || localOrigin;
const primaryBase = parsedExternal ? normalizeBase(parsedExternal.pathname) : '/';
const hrefFor = (route, base = primaryBase) => {
  const normalizedRoute = route === '/' ? '' : route.replace(/^\/+/, '');
  return new URL(`${base}${normalizedRoute}`, origin).href;
};
const targetValue = (href) => {
  const url = new URL(href);
  return `${url.pathname}${url.search}${url.hash}`;
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

let server = null;
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
const browser = spawn(chromePath, [
  options.headful ? '--new-window' : '--headless=new',
  '--disable-component-extensions-with-background-pages',
  '--disable-crash-reporter',
  '--disable-extensions',
  '--disable-features=Translate',
  '--no-default-browser-check',
  '--no-first-run',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileRoot}`,
  `--disk-cache-dir=${path.join(profileRoot, 'cache')}`,
  '--window-size=1600,1000',
  'about:blank'
], {
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, TEMP: profileRoot, TMP: profileRoot }
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
        pending.reject(new Error(`CDP connection closed while command ${id} was pending.`));
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

let cdp = null;
const runtimeErrors = [];
const networkErrors = [];
const storageEvents = [];
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
const screenshot = async (name) => {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false
  });
  const filename = path.join(artifactRoot, `${name}.png`);
  await writeFile(filename, Buffer.from(result.data, 'base64'));
  return filename;
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
  const critical = document.querySelector('[data-v2-page-critical]');
  const criticalImage = critical instanceof HTMLImageElement ? critical : critical?.querySelector('img');
  return {
    href: location.href,
    pathname: location.pathname,
    pageBootstrap: html.dataset.v2PageBootstrap || '',
    pageState: html.dataset.v2PageState || overlay?.getAttribute('data-v2-page-state') || '',
    pageCriticalStatus: html.dataset.v2PageCriticalStatus || '',
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
    transitionLabel: label?.textContent?.trim() || '',
    transitionLabelWeight: labelStyle?.fontWeight || '',
    transitionLabelColor: labelStyle?.color || '',
    transitionLabelFontSize: labelStyle?.fontSize || '',
    transitionLabelLineClamp: labelStyle?.webkitLineClamp || '',
    transitionLabelMaxWidth: labelStyle?.maxWidth || '',
    edgeColor: edgeStyle?.backgroundColor || '',
    edgeWidth: edgeStyle?.width || '',
    trailWidth: trailStyle?.width || '',
    coverDuration: rootStyle.getPropertyValue('--v2-page-cover-duration').trim(),
    revealDuration: rootStyle.getPropertyValue('--v2-page-reveal-duration').trim(),
    sheetEasing: rootStyle.getPropertyValue('--v2-page-sheet-ease').trim(),
    viewportWidth: innerWidth,
    criticalSrc: criticalImage ? (criticalImage.currentSrc || criticalImage.src || '') : '',
    criticalComplete: criticalImage?.complete ?? null,
    criticalNaturalWidth: criticalImage?.naturalWidth ?? null,
    horizontalOverflow: Math.max(0, html.scrollWidth - html.clientWidth),
    htmlOverflow: rootStyle.overflow,
    bodyOverflow: document.body ? getComputedStyle(document.body).overflow : ''
  };
})()`);
const waitUntilUsable = async (timeoutMs = 10_000) => {
  const ok = await waitForCondition(`(() => {
    const html = document.documentElement;
    const page = html.dataset.v2PageState || document.querySelector('[data-v2-page-transition]')?.getAttribute('data-v2-page-state') || '';
    const entry = document.querySelector('[data-v2-entry-root]')?.getAttribute('data-v2-entry-state') || '';
    const pageDone = !['arrival','waiting','revealing','covering','covered','navigating'].includes(page);
    const entryDone = !['armed','logo','waiting','opening','assembling'].includes(entry);
    return pageDone && entryDone && !html.classList.contains('v2-page-transition-locked')
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
  let last = '';
  const push = (kind, extra = {}) => {
    try {
      const html = document.documentElement;
      const entry = document.querySelector?.('[data-v2-entry-root]');
      const overlay = document.querySelector?.('[data-v2-page-transition]');
      const label = overlay?.querySelector?.('[data-v2-page-label]');
      const bootstrapOverlay = document.querySelector?.('[data-v2-page-bootstrap-overlay]');
      const bootstrapLabel = bootstrapOverlay?.querySelector?.('.v2-page-transition-bootstrap__label');
      const row = {
        at: Date.now(), doc, kind, href: location.href,
        pageBootstrap: html?.dataset.v2PageBootstrap || '',
        pageState: html?.dataset.v2PageState || overlay?.getAttribute('data-v2-page-state') || '',
        criticalStatus: html?.dataset.v2PageCriticalStatus || '',
        entryBootstrap: html?.dataset.v2EntryBootstrap || '',
        entryState: entry?.getAttribute('data-v2-entry-state') || '',
        transitionLabel: label?.textContent?.trim() || '',
        transitionLabelPresent: Boolean(label),
        bootstrapOverlayPresent: Boolean(bootstrapOverlay),
        bootstrapTransitionLabel: bootstrapLabel?.textContent?.trim() || '',
        locked: Boolean(html?.classList.contains('v2-page-transition-locked') || html?.dataset.v2PageLock === 'true'
          || html?.classList.contains('v2-entry-scroll-locked') || html?.dataset.v2ScrollLocked === 'true'),
        ...extra
      };
      const signature = JSON.stringify([row.kind, row.href, row.pageBootstrap, row.pageState, row.criticalStatus,
        row.entryBootstrap, row.entryState, row.transitionLabel, row.transitionLabelPresent,
        row.bootstrapOverlayPresent, row.bootstrapTransitionLabel, row.locked, row.persisted]);
      if (signature === last && kind === 'mutation') return;
      last = signature;
      const rows = JSON.parse(localStorage.getItem(key) || '[]');
      rows.push(row);
      localStorage.setItem(key, JSON.stringify(rows.slice(-500)));
    } catch {}
  };
  const observer = new MutationObserver(() => push('mutation'));
  observer.observe(document, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-v2-page-bootstrap','data-v2-page-state','data-v2-page-critical-status',
      'data-v2-entry-bootstrap','data-v2-entry-state','data-v2-page-lock','data-v2-scroll-locked','class'] });
  document.addEventListener('DOMContentLoaded', () => push('dom-content-loaded'), { once: true });
  window.addEventListener('pageshow', (event) => push('pageshow', { persisted: event.persisted }));
  queueMicrotask(() => push('document-start'));
})();`;

const introAudit = async (id, href) => {
  await clearOriginStorage();
  await navigateHref(href, { complete: false, settleMs: 30 });
  const armed = await waitForCondition(`(() => {
    const html = document.documentElement;
    const state = document.querySelector('[data-v2-entry-root]')?.getAttribute('data-v2-entry-state') || '';
    return html.dataset.v2EntryBootstrap === 'armed' || ['logo','waiting','opening','assembling'].includes(state);
  })()`, 2500);
  const early = await stateSnapshot();
  const usable = await waitUntilUsable(10_000);
  const trace = await getTrace();
  const thisPath = new URL(href).pathname;
  const states = trace.filter((row) => new URL(row.href).pathname === thisPath).map((row) => row.entryState).filter(Boolean);
  record(`entry.${id}`, armed && early.overlayExists && early.entrySession === 'seen' && Boolean(usable)
    && states.some((state) => ['logo','waiting','opening','assembling'].includes(state))
    && !usable.locked && usable.horizontalOverflow <= 2, { href, armed, early, states: [...new Set(states)], usable });
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
  const arrivalStates = trace.filter((row) => ['arrival','waiting','revealing'].includes(row.pageState));
  record(`token.${id}`, arrivalStates.length === 0 && !state.locked
    && !['arrival','waiting','revealing'].includes(state.pageState) && state.token === null,
  { state, arrivalStates, consumed: state.token === null });
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
    { id: 'not-found', href: `${base.origin}${primaryBase}404.html` },
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
  const invalid = results.filter((item) => item.token !== null || item.locked || ['covering','covered','navigating'].includes(item.after));
  record('click-filter.matrix', invalid.length === 0, { audited: results.length, invalid, results });
};

const transitionFilmstripAudit = async () => {
  let filmstripCriticalPath = '';
  if (!options.externalOrigin) {
    await clearOriginStorage();
    await seedEntrySeenAndNavigate(hrefFor(routes.deep));
    await waitUntilUsable();
    const probe = await stateSnapshot();
    if (probe.criticalSrc) filmstripCriticalPath = new URL(probe.criticalSrc).pathname;
  }
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.home));
  await waitUntilUsable();
  await evaluate(`try { localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]'); sessionStorage.removeItem(${JSON.stringify(ENTRY_KEY)}); } catch {}`);
  storageEvents.length = 0;
  const oldHref = await evaluate('location.href');
  const targetHref = hrefFor(routes.deep);
  const targetLabel = 'Топиарии';
  const files = [];
  files.push(await screenshot('sheet-01-old-page'));
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
  if (partial) files.push(await screenshot('sheet-02-cover-35-percent'));
  const covered = await waitForCondition(`(() => {
    const overlay = document.querySelector('[data-v2-page-transition]');
    const sheet = document.querySelector('[data-v2-page-sheet]');
    if (!overlay || !sheet || location.href !== ${JSON.stringify(oldHref)}) return false;
    const rect = sheet.getBoundingClientRect();
    const state = document.documentElement.dataset.v2PageState || overlay.getAttribute('data-v2-page-state');
    return state === 'covered' || rect.left <= 2;
  })()`, 180, 8);
  let coveredFile = '';
  if (covered) {
    coveredFile = await screenshot('sheet-03-covered');
    files.push(coveredFile);
  }
  const arrived = await waitForCondition(`location.pathname === ${JSON.stringify(new URL(targetHref).pathname)}
    && ['arrival','waiting','revealing','done','fail-open'].includes(document.documentElement.dataset.v2PageState || '')`, 10_000);
  if (arrived) {
    const arrivalFile = await screenshot('sheet-04-incoming-arrival');
    if (!coveredFile) {
      coveredFile = path.join(artifactRoot, 'sheet-03-covered.png');
      await writeFile(coveredFile, await readFile(arrivalFile));
      files.push(coveredFile);
    }
    files.push(arrivalFile);
  }
  const revealing = await waitForCondition(`document.documentElement.dataset.v2PageState === 'revealing'`, 3000, 12);
  if (revealing) {
    await delay(220);
    files.push(await screenshot('sheet-05-revealing'));
  }
  const usable = await waitUntilUsable(5000);
  clearFault();
  files.push(await screenshot('sheet-06-ready-hero'));

  const trace = await getTrace();
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
  const doneRow = [...trace].reverse().find((row) => row.pageState === 'done');
  const tokenEvents = readTokenEvents();
  const tokenWrites = tokenEvents.filter((event) => ['added','updated'].includes(event.type));
  const setEvent = tokenWrites[0];
  const removeEvent = tokenEvents.find((event) => event.type === 'removed');
  let token = null;
  try { token = JSON.parse(setEvent?.newValue || 'null'); } catch {}
  const expectedTarget = targetValue(targetHref);
  const now = Date.now();
  const tokenOk = token?.version === TOKEN_VERSION && token?.target === expectedTarget
    && token?.label === targetLabel && typeof token.label === 'string' && token.label.length <= 80
    && typeof token?.nonce === 'string' && token.nonce.length >= 6
    && Number.isFinite(token?.timestamp) && Math.abs(now - token.timestamp) < TOKEN_TTL_MS;
  const timings = {
    outgoingMs: coveredRow && coveringRows[0] ? coveredRow.at - coveringRows[0].at : null,
    incomingMs: doneRow && revealingRow ? doneRow.at - revealingRow.at : null,
    totalMs: doneRow && coveringRows[0] ? doneRow.at - coveringRows[0].at : null
  };
  const state = await stateSnapshot();
  const coveredEvidence = covered || pageStates.includes('covered');
  const revealingEvidence = revealing || pageStates.includes('revealing');
  record('transition.filmstrip-and-states', covering && partial && coveredEvidence && arrived && revealingEvidence && Boolean(usable)
    && ['covering','covered','arrival','waiting','revealing','done'].every((item) => pageStates.includes(item))
    && state.horizontalOverflow <= 2, { files, pageStates: [...new Set(pageStates)], timings, state });
  record('transition.exact-token-and-consumption', tokenOk && Boolean(removeEvent) && state.token === null,
    { expectedTarget, token, tokenEvents, consumedValue: state.token });
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
  return { files, timings };
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
      && state.horizontalOverflow <= 2,
    { viewport: '390x844', state });
  } finally {
    await setViewport(1440, 900, false, 1);
  }
};

const followActualLink = async ({ targetHref = '', selector = 'a[href]' } = {}) => {
  await evaluate(`try { localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]'); } catch {}`);
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
  const arrived = await waitForCondition(
    `location.pathname + location.search + location.hash === ${JSON.stringify(exactTarget)}`,
    10_000
  );
  const usable = arrived ? await waitUntilUsable(6_000) : null;
  const trace = await getTrace();
  const transitionRows = trace.filter((row) => row.transitionLabelPresent && (row.locked || row.criticalStatus)
    && ['covering','covered','navigating','arrival','waiting','revealing'].includes(row.pageState));
  const blankRows = transitionRows.filter((row) => !row.transitionLabel);
  const labels = [...new Set(transitionRows.map((row) => row.transitionLabel).filter(Boolean))];
  const tokenEvent = readTokenEvents().find((event) => ['added','updated'].includes(event.type));
  let token = null;
  try { token = JSON.parse(tokenEvent?.newValue || 'null'); } catch {}
  const state = await stateSnapshot();
  const expectedLabel = clicked.label || token?.label || '';
  const ok = Boolean(arrived && usable && expectedLabel && token?.target === exactTarget
    && token?.label === expectedLabel && labels.length === 1 && labels[0] === expectedLabel
    && blankRows.length === 0 && state.token === null && !state.locked);
  return { ok, clicked, exactTarget, expectedLabel, token, labels, blankRows, arrived, usable: Boolean(usable), state };
};

const actualNavigationFamiliesAudit = async () => {
  const results = {};

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.home));
  await waitUntilUsable();
  results.homeToMetal = await followActualLink({
    targetHref: hrefFor(routes.business),
    selector: 'a[data-v2-transition-label]'
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
    selector: '#home-v2-company-menu a[data-v2-transition-label]'
  });
  record('actual.header-dropdown-metal-to-about', dropdown?.found && dropdown.expanded === 'true'
    && !dropdown.panelHidden && results.headerDropdown.ok,
  { dropdown, transition: results.headerDropdown });

  const benchesCategory = '/ulichnaya-mebel/lavochki-i-skameyki/';
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor('/ulichnaya-mebel/'));
  await waitUntilUsable();
  const streetToCategory = await followActualLink({
    targetHref: hrefFor(benchesCategory),
    selector: '.v2-category-card[data-v2-transition-label]'
  });
  const categoryToStandard = streetToCategory.ok
    ? await followActualLink({ targetHref: hrefFor(routes.standard), selector: '.v2-product-card[data-v2-transition-label]' })
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
    selector: '.v2-product-card[data-v2-transition-label]'
  });
  record('actual.category-to-premium', results.categoryToPremium.ok, results.categoryToPremium);

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.standard));
  await waitUntilUsable();
  results.breadcrumb = await followActualLink({
    targetHref: hrefFor(benchesCategory),
    selector: '.v2-breadcrumbs a[data-v2-transition-label]'
  });
  record('actual.breadcrumb', results.breadcrumb.ok, results.breadcrumb);

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.standard));
  await waitUntilUsable();
  results.relatedCard = await followActualLink({ selector: '.v2-product-card--related[data-v2-transition-label]' });
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
      selector: '[data-hv2-mobile-menu] a[data-v2-transition-label]'
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
  record('actual.five-consecutive', sequence.length === sequenceTargets.length && sequence.every((item) => item.ok),
    { targets: sequenceTargets, sequence });
};

const crossPageHashAudit = async () => {
  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.deep));
  await waitUntilUsable();
  await evaluate(`try { localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]'); } catch {}`);
  storageEvents.length = 0;
  const targetHref = `${hrefFor(routes.business)}?h2=exact#main-content`;
  await fireRouteClick(targetHref);
  const arrived = await waitForCondition(`location.pathname + location.search + location.hash === ${JSON.stringify(targetValue(targetHref))}`, 10_000);
  await waitUntilUsable();
  const tokenEvent = readTokenEvents().find((event) => ['added','updated'].includes(event.type));
  let token = null;
  try { token = JSON.parse(tokenEvent?.newValue || 'null'); } catch {}
  record('transition.cross-page-hash-exact-target', arrived && token?.target === targetValue(targetHref)
    && (await stateSnapshot()).token === null, { target: targetValue(targetHref), token });
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
  await settle(100);
  const trace = (await getTrace()).slice(traceStart);
  const state = await stateSnapshot();
  const intercepted = trace.some((row) => ['covering','covered','arrival','waiting','revealing'].includes(row.pageState));
  record('accessibility.reduced-motion', arrived && entry.entrySession === 'seen'
    && ['static','skipped','fail-open'].includes(entry.entryBootstrap) && !entry.locked
    && !intercepted && readTokenEvents().length === 0 && !state.locked && Date.now() - startedAt < 1500,
  { entry, intercepted, tokenEvents: readTokenEvents(), elapsedMs: Date.now() - startedAt, state });
  await setReducedMotion(false);
};

const saveDataAudit = async () => {
  await clearOriginStorage();
  const injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true, effectiveType: '4g' }
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
    await settle(100);
    const trace = (await getTrace()).slice(traceStart);
    const state = await stateSnapshot();
    const intercepted = trace.some((row) => ['covering','covered','arrival','waiting','revealing'].includes(row.pageState));
    record('accessibility.save-data', arrived && entry.entrySession === 'seen'
      && ['static','skipped','fail-open'].includes(entry.entryBootstrap) && !entry.locked
      && !intercepted && readTokenEvents().length === 0 && !state.locked && Date.now() - startedAt < 1500,
    { entry, intercepted, tokenEvents: readTokenEvents(), elapsedMs: Date.now() - startedAt, state });
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
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
      && !state.locked && state.horizontalOverflow <= 2, state);
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
    const [htmlId, bodyId, mainId, headerId, brandId, entryOverlayId, pageOverlayId] = await Promise.all([
      query('html'),
      query('body'),
      query('main'),
      query('[data-home-v2-header]'),
      query('[data-home-v2-header] .hv2-header__brand'),
      query('[data-v2-entry-root]'),
      query('[data-v2-page-transition]')
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
      mainMarkupLength: mainMarkup.outerHTML?.length || 0
    };
    const ok = currentUrl === targetHref
      && Boolean(mainId && headerId && brandId && entryOverlayId && pageOverlayId)
      && mainBox.width > 0 && mainBox.height > 0 && headerBox.width > 0 && headerBox.height > 0
      && mainStyle.display !== 'none' && mainStyle.visibility !== 'hidden'
      && headerStyle.display !== 'none' && headerStyle.visibility !== 'hidden'
      && brandStyle.opacity !== '0'
      && !blocksInput(entryStyle) && !blocksInput(pageStyle)
      && htmlStyle['overflow-y'] !== 'hidden' && bodyStyle['overflow-y'] !== 'hidden'
      && !locked && (mainMarkup.outerHTML?.length || 0) > 100;
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
  record('bfcache.synthetic-pageshow-cleanup', !synthetic.locked
    && !['covering','covered','navigating'].includes(synthetic.state), synthetic);

  const fromHref = await evaluate('location.href');
  await fireRouteClick(hrefFor(routes.about));
  await waitForCondition(`location.pathname === ${JSON.stringify(new URL(hrefFor(routes.about)).pathname)}`, 8000);
  await waitUntilUsable();
  await evaluate('history.back()');
  const returned = await waitForCondition(`location.href === ${JSON.stringify(fromHref)}`, 8000);
  await settle(120);
  const state = await stateSnapshot();
  const trace = await getTrace();
  const persistedObserved = trace.some((row) => row.kind === 'pageshow' && row.persisted === true);
  record('bfcache.real-back-forward-cleanup', returned && !state.locked
    && !['covering','covered','navigating','arrival','waiting','revealing'].includes(state.pageState),
  { returned, persistedObserved, state });
};

const mediaFailOpenAudit = async () => {
  if (options.externalOrigin) {
    record('critical.deadline-fail-open', true, { skipped: true, reason: '--origin cannot inject deterministic image latency' });
    record('critical.image-error-fail-open', true, { skipped: true, reason: '--origin cannot inject invalid image bytes' });
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
  await evaluate(`try { localStorage.setItem(${JSON.stringify(TRACE_KEY)}, '[]'); } catch {}`);
  configureFault(criticalPathname, 'delay', PAGE_DEADLINE_MS + 1400);
  const delayStart = Date.now();
  await fireRouteClick(`${hrefFor(criticalRoute)}?h2=deadline`);
  const deadline = await waitForCondition(`['deadline','fail-open'].includes(document.documentElement.dataset.v2PageCriticalStatus || '')
    || document.documentElement.dataset.v2PageState === 'fail-open'`, 7000);
  const usable = await waitUntilUsable(4000);
  const deadlineState = await stateSnapshot();
  const trace = await getTrace();
  const arrivalRow = trace.find((row) => row.pageState === 'arrival' || row.pageState === 'waiting');
  const deadlineRow = trace.find((row) => row.criticalStatus === 'deadline' || row.pageState === 'fail-open');
  const deadlineElapsed = arrivalRow && deadlineRow ? deadlineRow.at - arrivalRow.at : Date.now() - delayStart;
  record('critical.deadline-fail-open', deadline && Boolean(usable) && !deadlineState.locked
    && deadlineState.pageBootstrap !== 'arrival' && deadlineState.htmlOverflow !== 'hidden'
    && serverFault.hits === 1 && deadlineElapsed >= 900 && deadlineElapsed <= 1900,
  { deadline, deadlineElapsed, hits: serverFault.hits, state: deadlineState });
  await delay(Math.max(0, PAGE_DEADLINE_MS + 1500 - (Date.now() - delayStart)));
  clearFault();

  await clearOriginStorage();
  await seedEntrySeenAndNavigate(hrefFor(routes.contacts));
  await waitUntilUsable();
  configureFault(criticalPathname, 'invalid');
  await fireRouteClick(`${hrefFor(criticalRoute)}?h2=image-error`);
  const errored = await waitForCondition(`['image-error','fail-open'].includes(document.documentElement.dataset.v2PageCriticalStatus || '')
    || document.documentElement.dataset.v2PageState === 'fail-open'`, 6000);
  const errorUsable = await waitUntilUsable(3500);
  const errorState = await stateSnapshot();
  record('critical.image-error-fail-open', errored && Boolean(errorUsable) && !errorState.locked
    && errorState.pageBootstrap !== 'arrival' && errorState.htmlOverflow !== 'hidden'
    && serverFault.hits === 1 && errorState.criticalNaturalWidth === 0,
  { errored, hits: serverFault.hits, state: errorState });
  clearFault();
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
  const assetIssues = await evaluate(`Array.from(document.querySelectorAll('link[href],script[src],img[src]'))
    .map((element) => element.href || element.src).filter((value) => {
      try { const url = new URL(value); return url.origin === location.origin && !url.pathname.startsWith(${JSON.stringify(options.githubBase)}); }
      catch { return false; }
    }).slice(0, 20)`);
  record('base.github-pages', arrived && snapshot.pathname.startsWith(options.githubBase)
    && token?.target === targetValue(baseTargetHref) && snapshot.token === null
    && assetIssues.length === 0 && !snapshot.locked, { base: options.githubBase, token, snapshot, assetIssues });
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
  await transitionMobileVisualContractAudit();
  await actualNavigationFamiliesAudit();
  await crossPageHashAudit();

  await invalidTokenAudit('mismatched', JSON.stringify({
    version: TOKEN_VERSION, target: targetValue(hrefFor(routes.about)), timestamp: Date.now(), nonce: 'h2-mismatch'
  }), hrefFor(routes.contacts));
  await invalidTokenAudit('stale', JSON.stringify({
    version: TOKEN_VERSION, target: targetValue(hrefFor(routes.about)), timestamp: Date.now() - TOKEN_TTL_MS - 1000, nonce: 'h2-stale'
  }), hrefFor(routes.about));
  await invalidTokenAudit('malformed', '{not-json', hrefFor(routes.contacts));

  await clickFilterAudit();
  await reducedMotionAudit();
  await saveDataAudit();
  await storageFailOpenAudit();
  await bfcacheAudit();
  await mediaFailOpenAudit();
  await githubBaseAudit();
  await jsDisabledAudit();

  const unexpectedRuntimeErrors = runtimeErrors.filter((error) => !/H2 QA storage (?:read|write) failure/.test(error));
  const expectedFaultPath = serverFault.pathname;
  const unexpectedNetworkErrors = networkErrors.filter((error) => !expectedFaultPath || !error.includes(expectedFaultPath));
  record('runtime.console-and-exceptions', unexpectedRuntimeErrors.length === 0,
    { errors: unexpectedRuntimeErrors.slice(0, 25), total: unexpectedRuntimeErrors.length });
  record('runtime.local-network', unexpectedNetworkErrors.length === 0,
    { errors: unexpectedNetworkErrors.slice(0, 25), total: unexpectedNetworkErrors.length });
} catch (error) {
  record('browser.fatal', false, { error: error instanceof Error ? error.stack : String(error) });
} finally {
  clearFault();
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  }
  await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), delay(3500)]);
  if (browser.exitCode === null) browser.kill('SIGKILL');
  if (server) await new Promise((resolve) => server.close(resolve));
  if (!options.keepProfile) await rm(profileRoot, { recursive: true, force: true }).catch(() => {});
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
  profile: options.keepProfile ? profileRoot : null,
  failures
};
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

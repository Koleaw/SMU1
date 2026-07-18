import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const distRoot = path.join(root, 'dist');
const astroRoot = path.join(root, '.astro');
const captureRoot = path.join(astroRoot, 'visual-polish-review');
const manifestPath = path.join(captureRoot, 'manifest.json');
const generatorPath = path.join(root, 'tools', 'migration', 'generate-visual-polish-review.mjs');
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const optionValue = (name) => {
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || '' : '';
};

const options = {
  help: hasFlag('--help') || hasFlag('-h'),
  capture: hasFlag('--capture'),
  explicitPlan: hasFlag('--plan'),
  headful: hasFlag('--headful'),
  externalOrigin: optionValue('--origin').trim().replace(/\/$/, '')
};

const usage = `
Capture an optional local proof set for human visual review.

  node tools/migration/capture-visual-review.mjs
  node tools/migration/capture-visual-review.mjs --plan
      Print the deterministic 41-shot plan. This is the default and writes nothing.

  node tools/migration/capture-visual-review.mjs --capture
      Capture from ./dist into .astro/visual-polish-review/ and write manifest.json.

  --origin <url>   Use an already running local origin instead of ./dist.
  --headful        Show Chrome during --capture.

The helper never writes proof images to docs/ or Git-controlled paths.
`;

if (options.help) {
  process.stdout.write(usage);
  process.exit(0);
}
if (options.capture && options.explicitPlan) {
  throw new Error('Choose either --plan or --capture, not both.');
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalizeRoute = (value) => {
  const url = new URL(value || '/', 'http://visual-review.local/');
  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (pathname !== '/' && !path.extname(pathname) && !pathname.endsWith('/')) pathname += '/';
  return pathname;
};
const routeStem = (route) => route === '/'
  ? 'home'
  : route.replace(/^\/+|\/+$/g, '').replaceAll('/', '--').replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-');
const relativeToRoot = (filename) => path.relative(root, filename).replaceAll('\\', '/');
const assertInside = (child, parent, label) => {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  if (resolvedChild === resolvedParent || !resolvedChild.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`${label} must stay inside ${resolvedParent}; received ${resolvedChild}.`);
  }
};

const { stdout: generatorStdout } = await execFileAsync(process.execPath, [generatorPath, '--plan'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024
});
const reviewPlan = JSON.parse(generatorStdout);
if (reviewPlan.canonicalRoutes !== 107 || reviewPlan.reviewRoutes !== 108 || reviewPlan.representativeRoutes !== 31) {
  throw new Error(`Expected 107 canonical/108 review/31 representative routes; received ${reviewPlan.canonicalRoutes}/${reviewPlan.reviewRoutes}/${reviewPlan.representativeRoutes}.`);
}
if (!Array.isArray(reviewPlan.representatives) || reviewPlan.representatives.length !== 31) {
  throw new Error('Generator plan has no complete representative route list.');
}

const viewports = {
  home: { name: '1920x1080', width: 1920, height: 1080, mobile: false },
  immersive: { name: '1706x958', width: 1706, height: 958, mobile: false },
  standard: { name: '1440x900', width: 1440, height: 900, mobile: false },
  mobile: { name: '390x844', width: 390, height: 844, mobile: true }
};
const mobileReviewRoutes = new Set([
  '/',
  '/metallokonstruktsii-dlya-biznesa/',
  '/blagoustroystvo-territoriy/',
  '/stroitelstvo-i-remonty/',
  '/navesy-i-kozyrki/',
  '/topiarii/',
  '/ulichnaya-mebel/kacheli/',
  '/ulichnaya-mebel/kacheli/kachel-duga/',
  '/o-nas/',
  '/kontakty/'
]);

const primaryViewport = ({ pageType, reason }) => {
  if (pageType === 'home') return viewports.home;
  if (reason.startsWith('immersive-')) return viewports.immersive;
  return viewports.standard;
};
const representatives = reviewPlan.representatives.map((entry) => ({
  route: normalizeRoute(entry.route),
  pageType: entry.pageType,
  reason: entry.reason
}));
const representativeByRoute = new Map(representatives.map((entry) => [entry.route, entry]));
if (representativeByRoute.size !== 31) throw new Error('Representative capture routes are not unique.');
for (const route of mobileReviewRoutes) {
  if (!representativeByRoute.has(route)) throw new Error(`Mobile review route is not representative: ${route}`);
}

const shots = representatives.flatMap((entry, index) => {
  const sequence = String(index + 1).padStart(2, '0');
  const stem = routeStem(entry.route);
  const primary = primaryViewport(entry);
  const result = [{
    sequence: index + 1,
    route: entry.route,
    pageType: entry.pageType,
    reason: entry.reason,
    variant: 'primary',
    viewport: primary,
    file: `${sequence}-${stem}--primary-${primary.name}.png`
  }];
  if (mobileReviewRoutes.has(entry.route)) {
    result.push({
      sequence: index + 1,
      route: entry.route,
      pageType: entry.pageType,
      reason: entry.reason,
      variant: 'mobile',
      viewport: viewports.mobile,
      file: `${sequence}-${stem}--mobile-${viewports.mobile.name}.png`
    });
  }
  return result;
});

if (shots.length !== 41 || new Set(shots.map((shot) => shot.file)).size !== 41) {
  throw new Error(`Expected 41 unique captures (31 primary + 10 mobile); planned ${shots.length}.`);
}

const printablePlan = {
  mode: options.capture ? 'capture' : 'plan',
  source: 'tools/migration/generate-visual-polish-review.mjs --plan',
  representativeRoutes: representatives.length,
  primaryCaptures: shots.filter((shot) => shot.variant === 'primary').length,
  mobileCaptures: shots.filter((shot) => shot.variant === 'mobile').length,
  totalCaptures: shots.length,
  outputRoot: relativeToRoot(captureRoot),
  manifest: relativeToRoot(manifestPath),
  writesGitControlledFiles: false,
  shots: shots.map((shot) => ({
    file: shot.file,
    route: shot.route,
    pageType: shot.pageType,
    reason: shot.reason,
    variant: shot.variant,
    viewport: shot.viewport.name
  }))
};

if (!options.capture) {
  process.stdout.write(`${JSON.stringify(printablePlan, null, 2)}\n`);
  process.exit(0);
}

assertInside(captureRoot, astroRoot, 'Capture root');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chromeInfo = await stat(chromePath).catch(() => null);
if (!chromeInfo?.isFile()) throw new Error(`Chrome executable not found: ${chromePath}`);
if (!options.externalOrigin) {
  const distInfo = await stat(distRoot).catch(() => null);
  if (!distInfo?.isDirectory()) throw new Error('dist is missing; run npm run build before --capture.');
}
await rm(captureRoot, { recursive: true, force: true });
await mkdir(captureRoot, { recursive: true });

const mimeTypes = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8'
};

let staticServer = null;
let origin = options.externalOrigin;
if (origin) {
  const originUrl = new URL(origin);
  if (!['http:', 'https:'].includes(originUrl.protocol)) {
    throw new Error(`--origin must use HTTP(S); received ${originUrl.protocol}.`);
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(originUrl.hostname)) {
    throw new Error(`--origin must be local; received ${originUrl.hostname}.`);
  }
} else {
  staticServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1/');
      const pathname = decodeURIComponent(url.pathname);
      let filename = pathname === '/404.html'
        ? path.join(distRoot, '404.html')
        : path.resolve(distRoot, `.${pathname}`);
      if (filename !== distRoot && !filename.startsWith(`${distRoot}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      let info = await stat(filename).catch(() => null);
      if (info?.isDirectory()) {
        filename = path.join(filename, 'index.html');
        info = await stat(filename).catch(() => null);
      }
      if (!info?.isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      const body = request.method === 'HEAD' ? null : await readFile(filename);
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': String(info.size),
        'content-type': mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream'
      }).end(body || undefined);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    staticServer.once('error', reject);
    staticServer.listen(0, '127.0.0.1', resolve);
  });
  const address = staticServer.address();
  if (!address || typeof address === 'string') throw new Error('Static server did not expose a TCP port.');
  origin = `http://127.0.0.1:${address.port}`;
}

await mkdir(astroRoot, { recursive: true });
const profileDir = await mkdtemp(path.join(astroRoot, 'smu1-visual-review-'));
assertInside(profileDir, astroRoot, 'Chrome profile');
const debugPort = 11600 + Math.floor(Math.random() * 300);
const browser = spawn(chromePath, [
  options.headful ? '--new-window' : '--headless=new',
  '--disable-component-extensions-with-background-pages',
  '--disable-crash-reporter',
  '--disable-extensions',
  '--no-default-browser-check',
  '--no-first-run',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  `--disk-cache-dir=${path.join(profileDir, 'cache')}`,
  '--window-size=1920,1080',
  'about:blank'
], {
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, TEMP: profileDir, TMP: profileDir }
});

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
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
const manifest = {
  startedAt: new Date().toISOString(),
  finishedAt: '',
  result: 'running',
  origin,
  outputRoot: relativeToRoot(captureRoot),
  representativeRoutes: representatives.length,
  plannedCaptures: shots.length,
  completedCaptures: 0,
  failedCaptures: 0,
  totalBytes: 0,
  captures: []
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

const waitForCondition = async (expression, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true;
    } catch {}
    await delay(60);
  }
  return false;
};

const setViewport = async (viewport) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    positionX: 0,
    positionY: 0,
    dontSetVisibleSize: false
  });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: viewport.mobile,
    maxTouchPoints: viewport.mobile ? 5 : 1
  });
};

const navigate = async (route) => {
  const target = new URL(route, origin);
  const navigation = await cdp.send('Page.navigate', { url: target.href });
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  const ready = await waitForCondition(`document.readyState !== 'loading'
    && location.pathname === ${JSON.stringify(target.pathname)}`);
  if (!ready) throw new Error(`Timed out loading ${route}.`);
  await evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
};

const dismissCookie = async () => evaluate(`(async () => {
  const close = document.querySelector('[data-cookie-notice-close]');
  if (close) close.click();
  try { localStorage.setItem('smu1_cookie_notice_closed', 'true'); } catch {}
  const banner = document.querySelector('[data-cookie-banner]');
  if (banner) {
    banner.hidden = true;
    banner.setAttribute('hidden', 'hidden');
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return Boolean(banner);
})()`);

const forceAndDecodeMedia = async (timeoutMs = 10_000) => evaluate(`(async () => {
  const images = Array.from(document.images);
  const videos = Array.from(document.querySelectorAll('video'));
  const frames = Array.from(document.querySelectorAll('iframe'));
  images.forEach((image) => { image.loading = 'eager'; });
  videos.forEach((video) => { video.preload = 'auto'; });
  frames.forEach((frame) => { frame.loading = 'eager'; });
  await Promise.race([
    Promise.all([
      ...images.map(async (image) => {
        if (!image.complete) await new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        });
        if (image.complete && image.naturalWidth > 0 && image.decode) await image.decode().catch(() => {});
      }),
      ...videos.map(async (video) => {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !video.error) {
          video.load();
          await new Promise((resolve) => {
            video.addEventListener('loadeddata', resolve, { once: true });
            video.addEventListener('error', resolve, { once: true });
          });
        }
        if (!video.error && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) video.pause();
      })
    ]),
    new Promise((resolve) => setTimeout(resolve, ${timeoutMs}))
  ]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { images: images.length, videos: videos.length, frames: frames.length };
})()`);

const settleRevealsAndReturnTop = async () => evaluate(`(async () => {
  const root = document.documentElement;
  const previousInlineBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  const max = Math.max(0, root.scrollHeight - innerHeight);
  const step = Math.max(280, Math.floor(innerHeight * 0.74));
  for (let top = 0; top <= max; top += step) {
    window.scrollTo({ top: Math.min(top, max), left: 0, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 48));
  }
  window.scrollTo({ top: max, left: 0, behavior: 'instant' });
  await new Promise((resolve) => setTimeout(resolve, 140));
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 360));
  root.style.scrollBehavior = previousInlineBehavior;
  return scrollY;
})()`);

const waitForEmbeddedMap = async () => {
  const hasMap = await evaluate(`Boolean(document.querySelector('iframe[src*="yandex" i], .practical-yandex-map iframe'))`);
  if (hasMap) await delay(2500);
};

const returnTop = async () => evaluate(`(async () => {
  const root = document.documentElement;
  const previousInlineBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 420));
  root.style.scrollBehavior = previousInlineBehavior;
  return scrollY;
})()`);

const diagnostics = async () => evaluate(`(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number.parseFloat(style.opacity || '1') > 0.01 && rect.width > 0 && rect.height > 0;
  };
  const visibleBrokenImages = Array.from(document.images).filter((image) =>
    visible(image) && image.complete && image.naturalWidth === 0
  ).map((image) => image.currentSrc || image.src || '(image)');
  const visiblePendingImages = Array.from(document.images).filter((image) =>
    visible(image) && !image.complete
  ).map((image) => image.currentSrc || image.src || '(image)');
  const visibleBrokenVideos = Array.from(document.querySelectorAll('video')).filter((video) =>
    visible(video) && Boolean(video.error)
  ).map((video) => video.currentSrc || video.querySelector('source')?.src || '(video)');
  const visibleUnreadyVideos = Array.from(document.querySelectorAll('video')).filter((video) =>
    visible(video) && !video.error && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ).map((video) => video.currentSrc || video.querySelector('source')?.src || '(video)');
  const visibleLoaders = Array.from(document.querySelectorAll(
    '[class*="spinner" i], [class*="loader" i], [aria-busy="true"]'
  )).filter(visible).map((element) => ({ tag: element.tagName, className: String(element.className || '') }));
  const pendingReveals = Array.from(document.querySelectorAll('.hv2-reveal-pending')).filter(visible).length;
  const hiddenVisibleReveals = Array.from(document.querySelectorAll(
    '[data-reveal], [data-v2-reveal], [data-v2-reveal-stage]'
  )).filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.bottom >= 0 && rect.top <= innerHeight && rect.width > 0 && rect.height > 0
      && (style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') < 0.01);
  }).length;
  const banner = document.querySelector('[data-cookie-banner]');
  return {
    route: location.pathname,
    scrollY,
    width: innerWidth,
    height: innerHeight,
    visibleBrokenImages,
    visiblePendingImages,
    visibleBrokenVideos,
    visibleUnreadyVideos,
    visibleLoaders,
    pendingReveals,
    hiddenVisibleReveals,
    cookieVisible: Boolean(banner && visible(banner)),
    devOverlayVisible: Array.from(document.querySelectorAll(
      'astro-dev-toolbar, [data-astro-dev-toolbar], vite-error-overlay'
    )).some(visible)
  };
})()`);

const assertionFailures = (state) => [
  Math.abs(state.scrollY) > 2 ? `scrollY=${state.scrollY}` : '',
  state.visibleBrokenImages.length ? `broken-images=${state.visibleBrokenImages.length}` : '',
  state.visiblePendingImages.length ? `pending-images=${state.visiblePendingImages.length}` : '',
  state.visibleBrokenVideos.length ? `broken-videos=${state.visibleBrokenVideos.length}` : '',
  state.visibleUnreadyVideos.length ? `unready-videos=${state.visibleUnreadyVideos.length}` : '',
  state.visibleLoaders.length ? `visible-loaders=${state.visibleLoaders.length}` : '',
  state.pendingReveals ? `pending-reveals=${state.pendingReveals}` : '',
  state.hiddenVisibleReveals ? `hidden-visible-reveals=${state.hiddenVisibleReveals}` : '',
  state.cookieVisible ? 'cookie-banner-visible' : '',
  state.devOverlayVisible ? 'dev-overlay-visible' : ''
].filter(Boolean);

try {
  cdp = new CdpClient(await waitForDebugger());
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  });

  for (const shot of shots) {
    const startedAt = new Date().toISOString();
    const destination = path.join(captureRoot, shot.file);
    assertInside(destination, captureRoot, 'Screenshot destination');
    try {
      await setViewport(shot.viewport);
      await navigate(shot.route);
      await dismissCookie();
      await forceAndDecodeMedia();
      await settleRevealsAndReturnTop();
      await forceAndDecodeMedia();
      await waitForEmbeddedMap();
      await returnTop();
      const state = await diagnostics();
      const failures = assertionFailures(state);
      if (failures.length) throw new Error(`Capture readiness failed: ${failures.join(', ')}`);
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
      });
      const buffer = Buffer.from(screenshot.data, 'base64');
      if (buffer.length < 10_000) throw new Error(`Screenshot is unexpectedly small (${buffer.length} bytes).`);
      await writeFile(destination, buffer);
      manifest.completedCaptures += 1;
      manifest.totalBytes += buffer.length;
      manifest.captures.push({
        file: shot.file,
        route: shot.route,
        pageType: shot.pageType,
        reason: shot.reason,
        variant: shot.variant,
        viewport: shot.viewport.name,
        bytes: buffer.length,
        startedAt,
        status: 'pass',
        diagnostics: state
      });
      process.stderr.write(`[visual-review] ${manifest.completedCaptures + manifest.failedCaptures}/${shots.length} ${shot.file}\n`);
    } catch (error) {
      manifest.failedCaptures += 1;
      manifest.captures.push({
        file: shot.file,
        route: shot.route,
        pageType: shot.pageType,
        reason: shot.reason,
        variant: shot.variant,
        viewport: shot.viewport.name,
        startedAt,
        status: 'fail',
        error: error instanceof Error ? error.stack : String(error)
      });
      process.stderr.write(`[visual-review] FAIL ${shot.file}: ${String(error)}\n`);
    }
  }
  manifest.finishedAt = new Date().toISOString();
  manifest.result = manifest.failedCaptures ? 'fail' : 'pass';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    result: manifest.result,
    representativeRoutes: manifest.representativeRoutes,
    completedCaptures: manifest.completedCaptures,
    failedCaptures: manifest.failedCaptures,
    totalBytes: manifest.totalBytes,
    outputRoot: manifest.outputRoot,
    manifest: relativeToRoot(manifestPath)
  }, null, 2)}\n`);
  if (manifest.failedCaptures) process.exitCode = 1;
} catch (error) {
  manifest.finishedAt = new Date().toISOString();
  manifest.result = 'fail';
  manifest.fatal = error instanceof Error ? error.stack : String(error);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8').catch(() => {});
  process.stderr.write(`${manifest.fatal}\n`);
  process.exitCode = 1;
} finally {
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  }
  if (browser.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      delay(3000)
    ]);
  }
  if (browser.exitCode === null) browser.kill('SIGKILL');
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

import { spawn } from 'node:child_process';
import { readFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import sharp from 'sharp';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin = process.env.PROJECTS_V2_ORIGIN || 'http://127.0.0.1:4323';
const outputDir = path.resolve('docs/design-lab/v2');
const distDir = path.resolve('dist');
const debugPort = 10020 + Math.floor(Math.random() * 60);
const profileDir = await mkdtemp(path.join(outputDir, '.projects-chrome-profile-'));

const routes = {
  home: '/design-lab/home-v2/',
  furniture: '/design-lab/v2/ulichnaya-mebel/',
  furnitureCategory: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/',
  furnitureProduct: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/bolshaya-skameyka-amplituda/',
  fences: '/design-lab/v2/ograzhdeniya-i-zabory/',
  fencesCategory: '/design-lab/v2/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/',
  fencesProduct: '/design-lab/v2/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-modul/',
  canopies: '/design-lab/v2/navesy-i-kozyrki/',
  topiary: '/design-lab/v2/topiarii/',
  metalworks: '/design-lab/v2/metallokonstruktsii-dlya-biznesa/',
  construction: '/design-lab/v2/stroitelstvo-i-remonty/',
  landscaping: '/design-lab/v2/blagoustroystvo-territoriy/',
  archive: '/design-lab/v2/vypolnennye-obekty/',
  embankment: '/design-lab/v2/vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/',
  square: '/design-lab/v2/vypolnennye-obekty/remont-skvera-na-ulitse-gogolya/',
  industrial: '/design-lab/v2/vypolnennye-obekty/kompleks-rabot-na-proizvodstvennoy-territorii/',
  swings: '/design-lab/v2/vypolnennye-obekty/gorodskie-kacheli-dlya-obshchestvennyh-territoriy/',
  company: '/design-lab/v2/o-nas/',
  contacts: '/design-lab/v2/kontakty/',
  vacancies: '/design-lab/v2/vakansii/',
  vacancy: '/design-lab/v2/vakansii/svarshchik-metallokonstruktsiy/',
  legal: '/design-lab/v2/politika-konfidencialnosti/'
};

const projectRoutes = [routes.embankment, routes.square, routes.industrial, routes.swings];
const v2HtmlFiles = await readdir(path.join(distDir, 'design-lab', 'v2'), { recursive: true });
const discoveredV2Routes = v2HtmlFiles
  .filter((file) => String(file).replaceAll('\\', '/').endsWith('/index.html') || file === 'index.html')
  .map((file) => `/design-lab/v2/${String(file).replaceAll('\\', '/').replace(/index\.html$/, '')}`);
const allV2Routes = [...new Set([routes.home, ...discoveredV2Routes])].sort();
const implementedProductionPaths = allV2Routes.map((route) => {
  if (route === routes.home) return '/';
  return route.replace(/^\/design-lab\/v2/, '');
});
const responsiveRepresentativeRoutes = [
  routes.landscaping,
  routes.archive,
  routes.industrial,
  routes.square,
  routes.company,
  routes.contacts,
  routes.vacancy,
  routes.legal
];
const requiredScreenshots = [
  'landscaping-direction-full.png',
  'landscaping-proof.png',
  'projects-archive-desktop.png',
  'projects-archive-mobile.png',
  'projects-archive-full.png',
  'project-industrial-desktop.png',
  'project-industrial-mobile.png',
  'project-industrial-full.png',
  'project-industrial-gallery-fullscreen.png',
  'project-landscaping-desktop.png',
  'project-landscaping-mobile.png',
  'project-landscaping-full.png',
  'project-landscaping-gallery-fullscreen.png',
  'project-sparse-desktop.png',
  'project-sparse-mobile.png',
  'project-swings-desktop.png',
  'project-swings-mobile.png',
  'company-desktop.png',
  'company-mobile.png',
  'company-full.png',
  'contacts-desktop.png',
  'contacts-mobile.png',
  'contacts-full.png',
  'vacancies-archive-desktop.png',
  'vacancies-archive-mobile.png',
  'vacancy-detail-desktop.png',
  'vacancy-detail-mobile.png',
  'legal-desktop.png',
  'legal-mobile.png'
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const progress = (message) => process.stderr.write(`[projects-v2] ${message}\n`);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

const staticServer = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', origin).pathname);
    let filename = path.resolve(distDir, `.${pathname}`);
    if (filename !== distDir && !filename.startsWith(`${distDir}${path.sep}`)) {
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
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': String(info.size),
      'content-type': mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream'
    });
    if (request.method === 'HEAD') response.end();
    else response.end(await readFile(filename));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error));
  }
});

await new Promise((resolve, reject) => {
  staticServer.once('error', reject);
  staticServer.listen(4323, '127.0.0.1', resolve);
});
await mkdir(outputDir, { recursive: true });

const browser = spawn(chromePath, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages',
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore', windowsHide: true });

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
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
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      (this.events.get(message.method) || []).forEach((listener) => listener(message.params || {}));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    this.events.set(method, [...(this.events.get(method) || []), listener]);
  }
  close() {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

const waitForBrowser = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) {
        const value = await response.json();
        if (value.webSocketDebuggerUrl) return value.webSocketDebuggerUrl;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome DevTools endpoint did not start.');
};

const waitForTargetSocket = async (targetId) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (response.ok) {
      const target = (await response.json()).find((item) => item.id === targetId);
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    }
    await delay(50);
  }
  throw new Error(`DevTools target ${targetId} did not appear.`);
};

const browserCdp = new CdpClient(await waitForBrowser());
await browserCdp.connect();
const initialTargets = (await browserCdp.send('Target.getTargets')).targetInfos || [];
for (const target of initialTargets.filter((item) => item.type === 'page')) {
  await browserCdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
}

const evaluate = async (page, expression) => {
  const response = await page.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Evaluation failed.');
  }
  return response.result?.value;
};

const createPage = async ({ width, height, mobile = false, reducedMotion = false, scale = 1 }) => {
  const { targetId } = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
  const page = new CdpClient(await waitForTargetSocket(targetId));
  await page.connect();
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile, screenWidth: width, screenHeight: height,
    positionX: 0, positionY: 0
  });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }]
  });
  return { page, targetId };
};

const runtimeErrors = [];
const withPage = async (options, callback) => {
  const { page, targetId } = await createPage(options);
  const pageErrors = [];
  page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception');
  });
  page.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') pageErrors.push(args?.map((item) => item.value || item.description).filter(Boolean).join(' '));
  });
  try {
    const value = await callback(page);
    runtimeErrors.push(...pageErrors);
    assert(pageErrors.length === 0, `Console errors: ${pageErrors.join(' | ')}`);
    return value;
  } finally {
    page.close();
    await browserCdp.send('Target.closeTarget', { targetId }).catch(() => {});
    await delay(80);
  }
};

const navigate = async (page, route, warm = false) => {
  const response = await page.send('Page.navigate', { url: `${origin}${route}?palette=olive` });
  if (response.errorText) throw new Error(`Navigation failed for ${route}: ${response.errorText}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    const ready = await evaluate(page, `document.readyState === 'complete' && location.pathname === ${JSON.stringify(route)}`).catch(() => false);
    if (ready) break;
    await delay(60);
  }
  assert(await evaluate(page, `document.readyState === 'complete' && location.pathname === ${JSON.stringify(route)}`), `Timed out waiting for ${route}.`);
  await evaluate(page, `(async () => {
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1600))]);
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    if (${warm}) {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 720) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      window.scrollTo(0, 0);
      await Promise.race([
        Promise.all(Array.from(document.images).map((image) => {
          if (image.complete && image.naturalWidth > 0) return Promise.resolve();
          return new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          });
        })),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    document.querySelectorAll('[data-v2-reveal], [data-reveal]').forEach((element) => {
      element.classList.remove('hv2-reveal-pending');
      element.classList.add('hv2-reveal-visible');
    });
    const palette = document.querySelector('.v2-palette-switch, .hv2-palette-switch');
    if (palette) palette.style.display = 'none';
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  await delay(120);
};

const saveViewport = async (page, filename) => {
  await evaluate(page, `(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  })()`);
  await delay(100);
  const metrics = await page.send('Page.getLayoutMetrics');
  const viewport = metrics.cssLayoutViewport || metrics.layoutViewport;
  const result = await page.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: viewport.clientWidth, height: viewport.clientHeight, scale: 1 }
  });
  await sharp(Buffer.from(result.data, 'base64'))
    .flatten({ background: '#f3f5f1' })
    .png({ compressionLevel: 8 })
    .toFile(path.join(outputDir, filename));
};

const saveElement = async (page, selector, filename) => {
  const clip = await evaluate(page, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing screenshot element: ${selector}');
    const rect = element.getBoundingClientRect();
    return {
      x: 0,
      y: Math.max(0, rect.top + window.scrollY),
      width: document.documentElement.clientWidth,
      height: Math.ceil(rect.height),
      scale: 1
    };
  })()`);
  assert(clip.height > 100 && clip.height < 10000, `Invalid element height for ${filename}: ${clip.height}.`);
  const segmentHeight = 900;
  const segments = [];
  for (let offset = 0; offset < clip.height; offset += segmentHeight) {
    const tileHeight = Math.min(segmentHeight, clip.height - offset);
    const result = await page.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: true, optimizeForSpeed: true,
      clip: { x: clip.x, y: clip.y + offset, width: clip.width, height: tileHeight, scale: 1 }
    });
    segments.push({ input: Buffer.from(result.data, 'base64'), left: 0, top: offset });
  }
  await sharp({
    create: { width: clip.width, height: clip.height, channels: 4, background: '#f3f5f1' }
  })
    .composite(segments)
    .png({ compressionLevel: 8 })
    .toFile(path.join(outputDir, filename));
};

const saveFullPage = async (page, filename) => {
  const metrics = await page.send('Page.getLayoutMetrics');
  const size = metrics.cssContentSize || metrics.contentSize;
  const width = Math.ceil(size.width);
  const height = Math.ceil(size.height);
  assert(width >= 320 && height >= 300 && height <= 20000, `Invalid full-page size ${width}x${height} for ${filename}.`);
  await evaluate(page, `window.scrollTo(0, 0)`);
  await delay(150);
  const segmentHeight = 1200;
  const segments = [];
  for (let y = 0; y < height; y += segmentHeight) {
    const tileHeight = Math.min(segmentHeight, height - y);
    const result = await page.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: true, optimizeForSpeed: true,
      clip: { x: 0, y, width, height: tileHeight, scale: 1 }
    });
    segments.push({ input: Buffer.from(result.data, 'base64'), left: 0, top: y });
  }
  await sharp({ create: { width, height, channels: 4, background: '#f3f5f1' } })
    .composite(segments)
    .png({ compressionLevel: 8 })
    .toFile(path.join(outputDir, filename));
};

const scrollToSelector = async (page, selector, hideHeader = false) => {
  await evaluate(page, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error('Missing selector: ${selector}');
    if (${hideHeader}) {
      const header = document.querySelector('[data-home-v2-header]');
      if (header) header.style.display = 'none';
      const skipLink = document.querySelector('.v2-skip-link');
      if (skipLink) skipLink.style.display = 'none';
    }
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY);
  })()`);
  await delay(180);
};

const pressKey = async (page, key, code = key, shift = false) => {
  const keys = { Escape: 27, Tab: 9, ArrowLeft: 37, ArrowRight: 39 };
  const windowsVirtualKeyCode = keys[key] || 0;
  const modifiers = shift ? 8 : 0;
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode, modifiers });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
};

const diagnostics = async (page) => evaluate(page, `(() => {
  const implementedProductionPaths = new Set(${JSON.stringify(implementedProductionPaths)});
  const ids = Array.from(document.querySelectorAll('[id]')).map((item) => item.id);
  const duplicateIds = Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
  const brokenImages = Array.from(document.images)
    .filter((image) => image.complete && Boolean(image.currentSrc) && image.naturalWidth === 0)
    .map((image) => image.currentSrc);
  const unlabeledButtons = Array.from(document.querySelectorAll('button')).filter((button) => {
    const text = (button.textContent || '').trim();
    return !text && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby');
  }).length;
  const oldImplementedLinks = Array.from(document.querySelectorAll('a[href]'))
    .map((link) => new URL(link.href, location.href))
    .filter((url) => url.origin === location.origin && implementedProductionPaths.has(url.pathname) && !url.pathname.startsWith('/design-lab/'))
    .map((url) => url.pathname);
  const emptyHrefs = Array.from(document.querySelectorAll('a[href]'))
    .filter((link) => link.getAttribute('href') === '').length;
  const invalidTel = Array.from(document.querySelectorAll('a[href^="tel:"]'))
    .map((link) => link.getAttribute('href'))
    .filter((href) => !/^tel:\\+\\d{11,15}$/.test(href || ''));
  const invalidMailto = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
    .map((link) => link.getAttribute('href'))
    .filter((href) => !/^mailto:[^@\\s]+@[^@\\s]+$/i.test(href || ''));
  const invalidTelegram = Array.from(document.querySelectorAll('a[href*="t.me/"]'))
    .map((link) => link.getAttribute('href'))
    .filter((href) => !/^https:\\/\\/t\\.me\\/[a-z0-9_]+\\/?$/i.test(href || ''));
  const invalidAriaCurrent = Array.from(document.querySelectorAll('[aria-current]'))
    .map((element) => element.getAttribute('aria-current'))
    .filter((value) => !['page', 'location', 'step', 'date', 'time', 'true'].includes(value || ''));
  const bodyText = document.body.innerText;
  return {
    path: location.pathname,
    width: document.documentElement.clientWidth,
    overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    duplicateIds,
    brokenImages,
    unlabeledButtons,
    h1Count: document.querySelectorAll('h1').length,
    noindex: document.querySelector('meta[name="robots"]')?.content || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    oldImplementedLinks,
    emptyHrefs,
    invalidTel,
    invalidMailto,
    invalidTelegram,
    invalidAriaCurrent,
    internalTerms: /(?:\\bV2\\b|design[- ]lab|Фактический состав|фактическим составом)/i.test(bodyText),
    internalV2Label: document.querySelector('.v2-breadcrumbs')?.innerText.includes('Главная V2') || false,
    objectCurrent: document.querySelectorAll('a[href*="/design-lab/v2/vypolnennye-obekty/"][aria-current]').length,
    footerAccordions: document.querySelectorAll('[data-v2-footer-accordion]').length
  };
})()`);

const checkLocalLinks = async (page) => {
  const links = await evaluate(page, `Array.from(new Set(Array.from(document.querySelectorAll('a[href]'))
    .map((link) => link.href)
    .filter((href) => href.startsWith(location.origin) && !href.includes('#'))))`);
  const failed = [];
  for (const href of links) {
    const response = await fetch(href, { method: 'HEAD' }).catch(() => null);
    if (!response?.ok) failed.push({ href, status: response?.status || 0 });
  }
  return failed;
};

const screenshotTasks = [
  { filename: 'landscaping-direction-full.png', route: routes.landscaping, width: 1440, height: 900, full: true, warm: true },
  { filename: 'landscaping-proof.png', route: routes.landscaping, width: 1440, height: 1000, selector: '#landscaping-proof', element: true, warm: true, hideHeader: true },
  { filename: 'projects-archive-desktop.png', route: routes.archive, width: 1440, height: 1000 },
  { filename: 'projects-archive-mobile.png', route: routes.archive, width: 390, height: 844, mobile: true },
  { filename: 'projects-archive-full.png', route: routes.archive, width: 1440, height: 900, full: true, warm: true },
  { filename: 'project-industrial-desktop.png', route: routes.industrial, width: 1440, height: 1000 },
  { filename: 'project-industrial-mobile.png', route: routes.industrial, width: 390, height: 844, mobile: true },
  { filename: 'project-industrial-full.png', route: routes.industrial, width: 1440, height: 900, full: true, warm: true },
  { filename: 'project-landscaping-desktop.png', route: routes.embankment, width: 1440, height: 1000 },
  { filename: 'project-landscaping-mobile.png', route: routes.embankment, width: 390, height: 844, mobile: true },
  { filename: 'project-landscaping-full.png', route: routes.embankment, width: 1440, height: 900, full: true, warm: true },
  { filename: 'project-sparse-desktop.png', route: routes.square, width: 1440, height: 1000 },
  { filename: 'project-sparse-mobile.png', route: routes.square, width: 390, height: 844, mobile: true },
  { filename: 'project-swings-desktop.png', route: routes.swings, width: 1440, height: 1000 },
  { filename: 'project-swings-mobile.png', route: routes.swings, width: 390, height: 844, mobile: true },
  { filename: 'company-desktop.png', route: routes.company, width: 1440, height: 1000 },
  { filename: 'company-mobile.png', route: routes.company, width: 390, height: 844, mobile: true },
  { filename: 'company-full.png', route: routes.company, width: 1440, height: 900, full: true, warm: true },
  { filename: 'contacts-desktop.png', route: routes.contacts, width: 1440, height: 1000 },
  { filename: 'contacts-mobile.png', route: routes.contacts, width: 390, height: 844, mobile: true },
  { filename: 'contacts-full.png', route: routes.contacts, width: 1440, height: 900, full: true, warm: true },
  { filename: 'vacancies-archive-desktop.png', route: routes.vacancies, width: 1440, height: 1000 },
  { filename: 'vacancies-archive-mobile.png', route: routes.vacancies, width: 390, height: 844, mobile: true },
  { filename: 'vacancy-detail-desktop.png', route: routes.vacancy, width: 1440, height: 1000 },
  { filename: 'vacancy-detail-mobile.png', route: routes.vacancy, width: 390, height: 844, mobile: true },
  { filename: 'legal-desktop.png', route: routes.legal, width: 1440, height: 1000 },
  { filename: 'legal-mobile.png', route: routes.legal, width: 390, height: 844, mobile: true }
];
const screenshotFilter = new Set(String(process.env.PROJECTS_V2_SCREENSHOT_FILTER || '').split(',').map((item) => item.trim()).filter(Boolean));
const activeScreenshotTasks = screenshotFilter.size > 0
  ? screenshotTasks.filter((task) => screenshotFilter.has(task.filename))
  : screenshotTasks;
const screenshotsOnly = screenshotFilter.size > 0;

const report = { screenshots: [], diagnostics: [], linkFailures: {}, gallery: {}, navigation: {}, projectSystem: {}, practical: {}, reducedMotion: {} };

try {
  progress('capturing requested screenshots with one browser and one page at a time');
  for (const task of activeScreenshotTasks) {
    await withPage({ width: task.width, height: task.height, mobile: Boolean(task.mobile) }, async (page) => {
      await navigate(page, task.route, Boolean(task.warm));
      if (task.selector) await scrollToSelector(page, task.selector, Boolean(task.hideHeader));
      if (task.element) await saveElement(page, task.selector, task.filename);
      else if (task.full) await saveFullPage(page, task.filename);
      else await saveViewport(page, task.filename);
    });
    report.screenshots.push(task.filename);
    progress(`saved ${task.filename}`);
  }

  if (!screenshotsOnly) {
  for (const [route, filename, preferredSrc] of [
    [routes.industrial, 'project-industrial-gallery-fullscreen.png', '/uploads/img-20250724-134235-1783272745917.jpg'],
    [routes.embankment, 'project-landscaping-gallery-fullscreen.png', '/uploads/project-da0872c68d9a09f0a7d2f995.jpg']
  ]) {
    await withPage({ width: 1440, height: 1000 }, async (page) => {
      await navigate(page, route, true);
      await evaluate(page, `(() => {
        const root = document.querySelector('[data-v2-project-gallery]');
        const data = JSON.parse(root.querySelector('[data-v2-project-gallery-data]').textContent);
        const index = data.images.findIndex((image) => image.src.endsWith(${JSON.stringify(preferredSrc)}));
        if (index >= 0) root.querySelectorAll('[data-v2-project-gallery-thumb]')[index]?.click();
        root.querySelector('[data-v2-project-gallery-open]').click();
      })()`);
      await delay(220);
      assert(await evaluate(page, `document.querySelector('[data-v2-project-lightbox]')?.open === true`), 'Project lightbox did not open.');
      await saveViewport(page, filename);
    });
    report.screenshots.push(filename);
    progress(`saved ${filename}`);
  }

  progress('checking every V2 route at desktop and mobile widths');
  for (const width of [1440, 390]) {
    for (const route of allV2Routes) {
      await withPage({ width, height: width === 390 ? 844 : 900, mobile: width === 390 }, async (page) => {
        await navigate(page, route);
        const value = await diagnostics(page);
        report.diagnostics.push(value);
        if (width === 1440) report.linkFailures[route] = await checkLocalLinks(page);
      });
    }
  }

  progress('checking representative pages at 1280, 1024, 768, 320 and 200% reflow');
  for (const setup of [
    { width: 1280, height: 900 },
    { width: 1024, height: 900 },
    { width: 768, height: 900, mobile: true },
    { width: 320, height: 844, mobile: true },
    { width: 720, height: 650, scale: 2 }
  ]) {
    for (const route of responsiveRepresentativeRoutes) {
      await withPage(setup, async (page) => {
        await navigate(page, route);
        report.diagnostics.push(await diagnostics(page));
      });
    }
  }

  progress('checking archive parity, project variants and public media selection');
  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.archive, true);
    report.projectSystem.archive = await evaluate(page, `(() => ({
      cards: document.querySelectorAll('.v2-project-archive__item').length,
      rich: document.querySelectorAll('.v2-project-archive__visual-grid .v2-project-archive__item').length,
      sparse: document.querySelectorAll('.v2-project-archive__text-grid .v2-project-archive__item').length,
      visualCards: document.querySelectorAll('.v2-project-archive__visual-grid .v2-project-card--visual').length,
      textCards: document.querySelectorAll('.v2-project-archive__text-grid .v2-project-card--text').length,
      textMedia: document.querySelectorAll('.v2-project-archive__text-grid figure').length,
      hrefs: Array.from(document.querySelectorAll('.v2-project-card__link')).map((link) => new URL(link.href).pathname),
      placeholders: document.querySelectorAll('img[src*="/placeholders/"]').length,
      helperMessages: /Не указано|Данных нет|Фотографии отсутствуют/.test(document.body.innerText),
      introHeight: Math.round(document.querySelector('.v2-project-archive-hero').getBoundingClientRect().height),
      coverFit: Array.from(document.querySelectorAll('.v2-project-archive__visual-grid .v2-project-card__media img')).map((image) => getComputedStyle(image).objectFit),
      swingsCover: Array.from(document.querySelectorAll('.v2-project-card')).find((card) => card.innerText.includes('Городские качели'))?.querySelector('img')?.getAttribute('src') || ''
    }))()`);
  });

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.industrial, true);
    report.projectSystem.industrial = await evaluate(page, `(() => {
      const data = JSON.parse(document.querySelector('[data-v2-project-gallery-data]').textContent);
      return {
        hero: document.querySelector('.v2-project-detail__hero-media img')?.getAttribute('src'),
        images: data.images.length,
        thumbs: document.querySelectorAll('[data-v2-project-gallery-thumb]').length,
        heroFit: getComputedStyle(document.querySelector('.v2-project-detail__hero-media img')).objectFit,
        prohibited: data.images.filter((item) => /134252|134312|134415/.test(item.src)),
        directions: Array.from(document.querySelectorAll('.v2-project-detail__direction-grid a')).map((link) => new URL(link.href).pathname),
        exactWork: document.querySelector('.v2-project-detail__work-grid > p')?.textContent.trim()
      };
    })()`);
  });

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.embankment, true);
    report.projectSystem.embankment = await evaluate(page, `(() => {
      const data = JSON.parse(document.querySelector('[data-v2-project-gallery-data]').textContent);
      return {
        hero: document.querySelector('.v2-project-detail__hero-media img')?.getAttribute('src'),
        images: data.images.length,
        heroFit: getComputedStyle(document.querySelector('.v2-project-detail__hero-media img')).objectFit,
        directions: Array.from(document.querySelectorAll('.v2-project-detail__direction-grid a')).map((link) => new URL(link.href).pathname)
      };
    })()`);
  });

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.swings, true);
    report.projectSystem.swings = await evaluate(page, `(() => {
      const data = JSON.parse(document.querySelector('[data-v2-project-gallery-data]').textContent);
      return {
        hero: document.querySelector('.v2-project-detail__hero-media img')?.getAttribute('src'),
        images: data.images.length,
        firstGalleryImage: data.images[0]?.src || '',
        heroFit: getComputedStyle(document.querySelector('.v2-project-detail__hero-media img')).objectFit,
        prohibited: data.images.filter((item) => /c9865e|93a94b/.test(item.src)),
        mountingInGallery: data.images.some((item) => item.src.includes('project-05e1cb18f1d596a46bdacc90.jpg')),
        mountingIsHero: document.querySelector('.v2-project-detail__hero-media img')?.getAttribute('src')?.includes('project-05e1cb18f1d596a46bdacc90.jpg') || false,
        publicWording: document.body.innerText.includes('Что было выполнено'),
        hasInternalWording: document.body.innerText.includes('Фактический состав')
      };
    })()`);
  });

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.square, true);
    report.projectSystem.sparse = await evaluate(page, `(() => ({
      heroMedia: document.querySelectorAll('.v2-project-detail__hero-media').length,
      galleries: document.querySelectorAll('[data-v2-project-gallery]').length,
      placeholderImages: document.querySelectorAll('img[src*="/placeholders/"]').length,
      hasWork: Boolean(document.querySelector('.v2-project-detail__work-grid > p')?.textContent.trim()),
      pageHeight: document.documentElement.scrollHeight
    }))()`);
  });

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.landscaping, true);
    report.projectSystem.landscapingProof = await evaluate(page, `(() => {
      const section = document.querySelector('#landscaping-proof');
      const data = JSON.parse(section.querySelector('[data-v2-project-gallery-data]').textContent);
      return {
        title: section.querySelector('h2')?.textContent.trim(),
        feature: section.querySelectorAll('.v2-project-proof__feature').length,
        proofImages: data.images.length,
        sparseCards: section.querySelectorAll('.v2-project-card--text').length,
        sparseMedia: section.querySelectorAll('.v2-project-proof__sparse figure').length,
        helperText: section.innerText.includes('Основной пример показывает'),
        height: Math.round(section.getBoundingClientRect().height)
      };
    })()`);
  });

  progress('checking company, contacts, vacancies and legal source parity');
  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.company, true);
    report.practical.company = await evaluate(page, `(() => ({
      h1: document.querySelector('h1')?.textContent.trim(),
      directionLinks: Array.from(document.querySelectorAll('.practical-company__direction-list a')).map((link) => new URL(link.href).pathname),
      projectLinks: Array.from(document.querySelectorAll('.practical-company__projects a[href]')).map((link) => new URL(link.href).pathname),
      images: Array.from(document.querySelectorAll('.practical-company img')).map((image) => image.getAttribute('src')),
      internalProductionImages: Array.from(document.querySelectorAll('.practical-company img')).map((image) => image.getAttribute('src')).filter((src) => /img-202|production|proizvod/i.test(src || '')),
      legalFacts: Array.from(document.querySelectorAll('.practical-company__legal dd')).map((item) => item.textContent.trim()),
      companyCurrent: Array.from(document.querySelectorAll('[data-hv2-dropdown-trigger]')).find((button) => button.textContent.includes('Компания'))?.getAttribute('aria-current'),
      aboutCurrent: Array.from(document.querySelectorAll('#home-v2-company-menu a')).find((link) => link.textContent.includes('О компании'))?.getAttribute('aria-current')
    }))()`);
  });

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.contacts);
    report.practical.contacts = await evaluate(page, `(() => ({
      h1: document.querySelector('h1')?.textContent.trim(),
      hrefs: Array.from(document.querySelectorAll('.practical-contacts a[href]')).map((link) => link.getAttribute('href')),
      contactHrefs: Array.from(document.querySelectorAll('.practical-contact-card')).map((link) => link.getAttribute('href')),
      addressVisible: document.body.innerText.includes('ул. Промышленная, 17, Курган'),
      legalVisible: ['4501220540', '450101001', '1184501003719'].every((value) => document.body.innerText.includes(value)),
      embeds: document.querySelectorAll('.practical-contacts iframe, .practical-contacts [class*="map"]').length,
      emptyCards: Array.from(document.querySelectorAll('.practical-contact-card strong')).filter((item) => !item.textContent.trim()).length
    }))()`);
  });

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.vacancies);
    report.practical.vacancies = await evaluate(page, `(() => ({
      h1: document.querySelector('h1')?.textContent.trim(),
      cards: document.querySelectorAll('.practical-vacancy-card').length,
      titles: Array.from(document.querySelectorAll('.practical-vacancy-card h3')).map((item) => item.textContent.trim()),
      detailLinks: Array.from(document.querySelectorAll('.practical-vacancy-card a')).map((link) => new URL(link.href).pathname),
      salaryVisible: document.body.innerText.includes('По результатам собеседования'),
      emptyState: document.querySelectorAll('.practical-vacancies__empty').length
    }))()`);
  });

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.vacancy);
    report.practical.vacancy = await evaluate(page, `(() => ({
      h1: document.querySelector('h1')?.textContent.trim(),
      sectionTitles: Array.from(document.querySelectorAll('.practical-vacancy__content h2')).map((item) => item.textContent.trim()),
      sectionItems: document.querySelectorAll('.practical-vacancy__content li').length,
      salaryVisible: document.body.innerText.includes('По результатам собеседования'),
      contactHrefs: Array.from(document.querySelectorAll('.practical-vacancy__channels a')).map((link) => link.getAttribute('href')),
      archiveBack: new URL(document.querySelector('.practical-vacancy__back').href).pathname,
      missingValueText: /Не указано|Нет данных/.test(document.body.innerText)
    }))()`);
  });

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.legal);
    const v2Text = await evaluate(page, `document.querySelector('.practical-legal__document').innerText.replace(/\\s+/g, ' ').trim()`);
    const v2Structure = await evaluate(page, `(() => ({
      h1: document.querySelector('.practical-legal__document h1')?.textContent.trim(),
      headings: document.querySelectorAll('.practical-legal__document h1, .practical-legal__document h2, .practical-legal__document h3').length,
      links: document.querySelectorAll('.practical-legal__document a[href]').length
    }))()`);
    await navigate(page, '/politika-konfidencialnosti/');
    const productionText = await evaluate(page, `document.querySelector('.policy-page__container').innerText.replace(/\\s+/g, ' ').trim()`);
    report.practical.legal = {
      ...v2Structure,
      sourceTextMatches: v2Text === productionText,
      v2TextLength: v2Text.length,
      productionTextLength: productionText.length
    };
  });

  progress('checking gallery keyboard, fullscreen, focus return and swipe');
  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, routes.industrial);
    report.gallery.initial = await evaluate(page, `(() => ({
      count: JSON.parse(document.querySelector('[data-v2-project-gallery-data]').textContent).images.length,
      thumbs: document.querySelectorAll('[data-v2-project-gallery-thumb]').length,
      status: document.querySelector('[data-v2-project-gallery-status]').textContent.trim(),
      heroLoading: document.querySelector('.v2-project-detail__hero-media img').getAttribute('loading'),
      galleryLoading: document.querySelector('[data-v2-project-gallery-main]').getAttribute('loading')
    }))()`);
    report.gallery.navigation = await evaluate(page, `(async () => {
      const open = document.querySelector('[data-v2-project-gallery-open]');
      open.focus();
      open.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      const afterRight = document.querySelector('[data-v2-project-gallery-status]').textContent.trim();
      document.querySelector('[data-v2-project-gallery-prev]').click();
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { afterRight, afterPrevious: document.querySelector('[data-v2-project-gallery-status]').textContent.trim() };
    })()`);
    report.gallery.lightboxOpen = await evaluate(page, `(async () => {
      const opener = document.querySelector('[data-v2-project-gallery-open]');
      opener.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const dialog = document.querySelector('[data-v2-project-lightbox]');
      const close = dialog.querySelector('[data-v2-project-lightbox-close]');
      const items = Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      const first = items[0];
      const last = items.at(-1);
      const initialFocus = document.activeElement === close;
      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      return { open: dialog.open, initialFocus, wrapped: document.activeElement === first };
    })()`);
    await pressKey(page, 'Escape');
    await delay(80);
    report.gallery.lightboxClosed = await evaluate(page, `(() => ({
      open: document.querySelector('[data-v2-project-lightbox]').open,
      focusReturned: document.activeElement === document.querySelector('[data-v2-project-gallery-open]')
    }))()`);
  });

  await withPage({ width: 390, height: 844, mobile: true }, async (page) => {
    await navigate(page, routes.embankment);
    report.gallery.mobileSwipe = await evaluate(page, `(async () => {
      const stage = document.querySelector('[data-v2-project-gallery-swipe]');
      const status = document.querySelector('[data-v2-project-gallery-status]');
      const before = status.textContent.trim();
      stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 31, clientX: 320, clientY: 360 }));
      stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 31, clientX: 90, clientY: 366 }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      const afterHorizontal = status.textContent.trim();
      stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 32, clientX: 200, clientY: 240 }));
      stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 32, clientX: 207, clientY: 390 }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { before, afterHorizontal, afterVertical: status.textContent.trim(), touchAction: getComputedStyle(stage).touchAction };
    })()`);
  });

  progress('checking Header, MobileMenu, Footer and reduced motion');
  await withPage({ width: 1440, height: 900 }, async (page) => {
    await navigate(page, routes.archive);
    report.navigation.desktop = await evaluate(page, `(async () => {
      const objectLink = Array.from(document.querySelectorAll('.hv2-header__nav-link')).find((link) => link.textContent.trim() === 'Объекты');
      const trigger = document.querySelector('[data-hv2-dropdown-trigger]');
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 40));
      const opened = trigger.getAttribute('aria-expanded') === 'true';
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { objectCurrent: objectLink?.getAttribute('aria-current'), opened, closed: trigger.getAttribute('aria-expanded') === 'false', focusReturned: document.activeElement === trigger };
    })()`);
  });

  await withPage({ width: 1440, height: 900 }, async (page) => {
    await navigate(page, routes.company);
    report.navigation.companyDesktop = await evaluate(page, `(async () => {
      const trigger = Array.from(document.querySelectorAll('[data-hv2-dropdown-trigger]')).find((button) => button.textContent.includes('Компания'));
      const currentLink = Array.from(document.querySelectorAll('#home-v2-company-menu a')).find((link) => link.textContent.includes('О компании'));
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 40));
      const firstFocused = document.activeElement === currentLink;
      currentLink.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        triggerCurrent: trigger.getAttribute('aria-current'),
        linkCurrent: currentLink.getAttribute('aria-current'),
        firstFocused,
        closed: trigger.getAttribute('aria-expanded') === 'false',
        focusReturned: document.activeElement === trigger
      };
    })()`);
  });

  await withPage({ width: 390, height: 844, mobile: true }, async (page) => {
    await navigate(page, routes.archive);
    report.navigation.mobileOpen = await evaluate(page, `(async () => {
      const opener = document.querySelector('[data-hv2-mobile-open]');
      opener.click();
      await new Promise((resolve) => setTimeout(resolve, 340));
      const menu = document.querySelector('[data-hv2-mobile-menu]');
      const objectLink = Array.from(menu.querySelectorAll('a')).find((link) => link.textContent.trim() === 'Выполненные объекты');
      return {
        visible: !menu.hidden && menu.getAttribute('aria-hidden') === 'false',
        initialFocus: document.activeElement === menu.querySelector('[data-hv2-mobile-close]'),
        bodyLocked: getComputedStyle(document.body).position === 'fixed',
        mainInert: document.querySelector('main').hasAttribute('inert'),
        objectCurrent: objectLink?.getAttribute('aria-current')
      };
    })()`);
    await pressKey(page, 'Escape');
    await delay(340);
    report.navigation.mobileClosed = await evaluate(page, `(() => ({
      hidden: document.querySelector('[data-hv2-mobile-menu]').hidden,
      focusReturned: document.activeElement === document.querySelector('[data-hv2-mobile-open]'),
      bodyUnlocked: getComputedStyle(document.body).position !== 'fixed',
      mainActive: !document.querySelector('main').hasAttribute('inert'),
      footerAccordions: document.querySelectorAll('[data-v2-footer-accordion]').length
    }))()`);
  });

  await withPage({ width: 390, height: 844, mobile: true }, async (page) => {
    await navigate(page, routes.contacts);
    report.navigation.companyMobile = await evaluate(page, `(async () => {
      const opener = document.querySelector('[data-hv2-mobile-open]');
      opener.click();
      await new Promise((resolve) => setTimeout(resolve, 340));
      const menu = document.querySelector('[data-hv2-mobile-menu]');
      const link = Array.from(menu.querySelectorAll('a')).find((item) => item.textContent.trim() === 'Контакты');
      return {
        href: new URL(link.href).pathname,
        current: link.getAttribute('aria-current'),
        companyHrefs: Array.from(menu.querySelectorAll('.hv2-mobile-menu__group:last-of-type a')).map((item) => new URL(item.href).pathname)
      };
    })()`);
  });

  await withPage({ width: 390, height: 844, mobile: true, reducedMotion: true }, async (page) => {
    await navigate(page, routes.industrial);
    report.reducedMotion = await evaluate(page, `(() => ({
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      pendingReveals: document.querySelectorAll('.hv2-reveal-pending').length,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      imageTransition: getComputedStyle(document.querySelector('[data-v2-project-gallery-main]')).transitionDuration
    }))()`);
  });

  const sitemap = await readFile(path.join(distDir, 'sitemap-0.xml'), 'utf8').catch(async () => {
    const index = await readFile(path.join(distDir, 'sitemap-index.xml'), 'utf8');
    const match = index.match(/<loc>[^<]*\/(sitemap-[^<]+)<\/loc>/);
    return match ? readFile(path.join(distDir, match[1]), 'utf8') : '';
  });
  report.projectSystem.sitemapHasDesignLab = String(sitemap).includes('/design-lab/');

  const failedDiagnostics = report.diagnostics.filter((item) =>
    item.overflow > 1 || item.duplicateIds.length || item.brokenImages.length || item.unlabeledButtons ||
    item.h1Count !== 1 || !item.noindex.includes('noindex') || !item.noindex.includes('nofollow') ||
    !item.canonical || item.canonical.includes('/design-lab/') || item.oldImplementedLinks.length ||
    item.emptyHrefs || item.invalidTel.length || item.invalidMailto.length || item.invalidTelegram.length ||
    item.invalidAriaCurrent.length || item.internalTerms || item.internalV2Label
  );
  assert(failedDiagnostics.length === 0, `Responsive/a11y diagnostics failed: ${JSON.stringify(failedDiagnostics)}`);
  assert(Object.values(report.linkFailures).every((items) => items.length === 0), `Broken local links: ${JSON.stringify(report.linkFailures)}`);
  assert(report.projectSystem.archive.cards === 4 && report.projectSystem.archive.rich === 3 && report.projectSystem.archive.sparse === 1, 'Archive does not show the four published projects in the expected variants.');
  assert(report.projectSystem.archive.visualCards === 3 && report.projectSystem.archive.textCards === 1 && report.projectSystem.archive.textMedia === 0, 'Archive card variants are incorrect.');
  assert(report.projectSystem.archive.introHeight < 430 && report.projectSystem.archive.coverFit.every((value) => value === 'cover'), 'Archive intro or cover presentation is incorrect.');
  assert(report.projectSystem.archive.swingsCover?.endsWith('/uploads/project-05c77513c1a391e5a71a7dee.jpg'), 'Archive still uses the mounting image for the swings cover.');
  assert(projectRoutes.every((route) => report.projectSystem.archive.hrefs.includes(route)), 'Archive is missing a V2 project route.');
  assert(report.projectSystem.archive.placeholders === 0 && !report.projectSystem.archive.helperMessages, 'Archive exposes a placeholder or service message.');
  assert(report.projectSystem.industrial.images === 10 && report.projectSystem.industrial.thumbs === 10 && report.projectSystem.industrial.prohibited.length === 0, 'Industrial public gallery selection is incorrect.');
  assert(report.projectSystem.industrial.hero?.endsWith('/uploads/img-20250724-134235-1783272745917.jpg') && report.projectSystem.industrial.heroFit === 'cover', 'Industrial hero selection is incorrect.');
  assert(report.projectSystem.embankment.images === 3 && report.projectSystem.embankment.hero?.endsWith('/uploads/project-da0872c68d9a09f0a7d2f995.jpg') && report.projectSystem.embankment.heroFit === 'cover', 'Embankment media selection is incorrect.');
  assert(report.projectSystem.swings.images === 4 && report.projectSystem.swings.prohibited.length === 0 && report.projectSystem.swings.hero?.endsWith('/uploads/project-05c77513c1a391e5a71a7dee.jpg') && report.projectSystem.swings.firstGalleryImage?.endsWith('/uploads/project-05c77513c1a391e5a71a7dee.jpg') && report.projectSystem.swings.heroFit === 'cover', 'Swings media selection is incorrect.');
  assert(report.projectSystem.swings.mountingInGallery && !report.projectSystem.swings.mountingIsHero, 'The swings mounting image was removed or still appears as the hero.');
  assert(report.projectSystem.swings.publicWording && !report.projectSystem.swings.hasInternalWording, 'Project work wording is not public-facing.');
  assert(report.projectSystem.sparse.heroMedia === 0 && report.projectSystem.sparse.galleries === 0 && report.projectSystem.sparse.placeholderImages === 0 && report.projectSystem.sparse.hasWork && report.projectSystem.sparse.pageHeight < 2600, 'Sparse detail variant is incorrect.');
  assert(report.projectSystem.landscapingProof.title === 'Примеры благоустройства' && report.projectSystem.landscapingProof.feature === 1 && report.projectSystem.landscapingProof.proofImages === 2, 'Landscaping feature proof is incorrect.');
  assert(report.projectSystem.landscapingProof.sparseCards === 1 && report.projectSystem.landscapingProof.sparseMedia === 0 && !report.projectSystem.landscapingProof.helperText, 'Landscaping sparse proof is incorrect.');
  assert(report.practical.company.h1 === 'СМУ-1 делает прикладные решения под задачу объекта' && report.practical.company.directionLinks.length === 7 && report.practical.company.directionLinks.every((href) => href.startsWith('/design-lab/v2/')), 'Company content or direction links are incorrect.');
  assert(report.practical.company.images.length === 3 && report.practical.company.internalProductionImages.length === 0 && report.practical.company.images.every((src) => /project-(?:248f17177df30b29ab9b231a|da0872c68d9a09f0a7d2f995|05c77513c1a391e5a71a7dee)\.jpg$/.test(src || '')), 'Company page uses unapproved or internal production media.');
  assert(report.practical.company.legalFacts.includes('4501220540') && report.practical.company.legalFacts.includes('1184501003719') && report.practical.company.companyCurrent === 'location' && report.practical.company.aboutCurrent === 'page', 'Company legal facts or active navigation state are incorrect.');
  assert(report.practical.contacts.h1 === 'Контакты' && report.practical.contacts.addressVisible && report.practical.contacts.legalVisible && report.practical.contacts.embeds === 0 && report.practical.contacts.emptyCards === 0, 'Contacts content is incomplete or includes an unsupported map.');
  assert(['tel:+79129735006', 'tel:+79125799665', 'https://t.me/smu1build', 'mailto:smu1.kurgan@yandex.ru'].every((href) => report.practical.contacts.contactHrefs.includes(href)), 'Contacts links do not match site settings.');
  assert(report.practical.vacancies.h1 === 'Вакансии' && report.practical.vacancies.cards === 1 && report.practical.vacancies.titles[0] === 'Сварщик металлоконструкций' && report.practical.vacancies.salaryVisible && report.practical.vacancies.emptyState === 0 && report.practical.vacancies.detailLinks.includes(routes.vacancy), 'Vacancy archive does not reflect the active record.');
  assert(report.practical.vacancy.h1 === 'Сварщик металлоконструкций' && ['Обязанности', 'Требования', 'Условия'].every((title) => report.practical.vacancy.sectionTitles.includes(title)) && report.practical.vacancy.sectionItems === 9 && report.practical.vacancy.salaryVisible && !report.practical.vacancy.missingValueText, 'Vacancy detail loses or invents record fields.');
  assert(['mailto:smu1.kurgan@yandex.ru', 'tel:+79129735006', 'https://t.me/smu1build'].every((href) => report.practical.vacancy.contactHrefs.includes(href)) && report.practical.vacancy.archiveBack === routes.vacancies, 'Vacancy response contacts or archive link are incorrect.');
  assert(report.practical.legal.sourceTextMatches && report.practical.legal.v2TextLength > 1000 && report.practical.legal.v2TextLength === report.practical.legal.productionTextLength, 'V2 legal text differs from the production legal source.');
  assert(report.gallery.initial.count === 10 && report.gallery.initial.thumbs === 10 && report.gallery.initial.heroLoading === 'eager' && report.gallery.initial.galleryLoading === 'lazy', 'Gallery count or loading priority is incorrect.');
  assert(report.gallery.navigation.afterRight === '2 / 10' && report.gallery.navigation.afterPrevious === '1 / 10', 'Gallery keyboard/arrow navigation failed.');
  assert(report.gallery.lightboxOpen.open && report.gallery.lightboxOpen.initialFocus && report.gallery.lightboxOpen.wrapped, 'Lightbox modal or focus trap failed.');
  assert(!report.gallery.lightboxClosed.open && report.gallery.lightboxClosed.focusReturned, 'Lightbox Escape or focus return failed.');
  assert(report.gallery.mobileSwipe.before === '1 / 3' && report.gallery.mobileSwipe.afterHorizontal === '2 / 3' && report.gallery.mobileSwipe.afterVertical === '2 / 3' && report.gallery.mobileSwipe.touchAction.includes('pan-y'), 'Mobile swipe or vertical-scroll safety failed.');
  assert(report.navigation.desktop.objectCurrent && report.navigation.desktop.opened && report.navigation.desktop.closed && report.navigation.desktop.focusReturned, 'Desktop header state or dropdown keyboard behavior failed.');
  assert(report.navigation.companyDesktop.triggerCurrent === 'location' && report.navigation.companyDesktop.linkCurrent === 'page' && report.navigation.companyDesktop.firstFocused && report.navigation.companyDesktop.closed && report.navigation.companyDesktop.focusReturned, 'Company dropdown active state or keyboard behavior failed.');
  assert(report.navigation.mobileOpen.visible && report.navigation.mobileOpen.initialFocus && report.navigation.mobileOpen.bodyLocked && report.navigation.mobileOpen.mainInert && report.navigation.mobileOpen.objectCurrent, 'Mobile menu open/current state failed.');
  assert(report.navigation.mobileClosed.hidden && report.navigation.mobileClosed.focusReturned && report.navigation.mobileClosed.bodyUnlocked && report.navigation.mobileClosed.mainActive && report.navigation.mobileClosed.footerAccordions === 2, 'Mobile menu close or footer state failed.');
  assert(report.navigation.companyMobile.href === routes.contacts && report.navigation.companyMobile.current === 'page' && [routes.archive, routes.company, routes.contacts, routes.vacancies].every((href) => report.navigation.companyMobile.companyHrefs.includes(href)), 'Mobile company navigation is not fully routed to V2.');
  assert(report.reducedMotion.matches && report.reducedMotion.pendingReveals === 0 && report.reducedMotion.scrollBehavior === 'auto', 'Reduced-motion behavior failed.');
  assert(!report.projectSystem.sitemapHasDesignLab, 'Design-lab route leaked into sitemap.');
  assert(runtimeErrors.length === 0, `Runtime errors detected: ${runtimeErrors.join(' | ')}`);
  assert(requiredScreenshots.every((file) => report.screenshots.includes(file)), 'Not every required screenshot was captured.');
  for (const file of requiredScreenshots) {
    const info = await stat(path.join(outputDir, file));
    assert(info.size > 1000, `Screenshot ${file} is empty.`);
  }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  progress(screenshotsOnly ? 'requested V2 screenshots captured' : 'all project V2 browser checks passed');
} finally {
  await browserCdp.send('Browser.close').catch(() => {});
  browserCdp.close();
  await Promise.race([
    new Promise((resolve) => browser.once('exit', resolve)),
    delay(1500).then(() => browser.kill())
  ]).catch(() => {});
  await new Promise((resolve) => staticServer.close(resolve));
  await delay(250);
  const resolvedProfile = path.resolve(profileDir);
  if (resolvedProfile.startsWith(`${outputDir}${path.sep}`)) {
    await rm(resolvedProfile, { recursive: true, force: true }).catch(() => {});
  }
}

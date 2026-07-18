import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const outputDir = path.join(root, 'docs', 'migration', 'screenshots');
const reportPath = path.join(root, 'docs', 'migration', 'browser-production-qa.json');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 4326;
const origin = `http://127.0.0.1:${port}`;
const debugPort = 10500 + Math.floor(Math.random() * 300);
const profileRoot = path.join(root, '.astro');
await mkdir(profileRoot, { recursive: true });
const profileDir = await mkdtemp(path.join(profileRoot, 'smu1-production-qa-'));
const homeRecord = JSON.parse(await readFile(path.join(root, 'src', 'content', 'static-pages', 'home.json'), 'utf8'));
const yandexRecord = JSON.parse(await readFile(path.join(root, 'src', 'data', 'yandex.json'), 'utf8'));
const expectedConstructorId = new URL(yandexRecord.map.constructorSrc).searchParams.get('um');

const routes = {
  home: '/',
  catalog: '/ulichnaya-mebel/',
  categoryFilled: '/ulichnaya-mebel/lavochki-i-skameyki/',
  categorySparse: '/ograzhdeniya-i-zabory/zabory/',
  productMedia: '/ulichnaya-mebel/kacheli/kachel-portal/',
  productSingle: '/ulichnaya-mebel/lavochki-i-skameyki/skamya-smu1-bazovaya/',
  productZero: '/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-zakrytaya/',
  fences: '/ograzhdeniya-i-zabory/',
  canopies: '/navesy-i-kozyrki/',
  topiary: '/topiarii/',
  metalworks: '/metallokonstruktsii-dlya-biznesa/',
  construction: '/stroitelstvo-i-remonty/',
  landscaping: '/blagoustroystvo-territoriy/',
  projects: '/vypolnennye-obekty/',
  industrialProject: '/vypolnennye-obekty/kompleks-rabot-na-proizvodstvennoy-territorii/',
  landscapingProject: '/vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/',
  sparseProject: '/vypolnennye-obekty/remont-skvera-na-ulitse-gogolya/',
  company: '/o-nas/',
  contacts: '/kontakty/',
  vacancies: '/vakansii/',
  vacancy: '/vakansii/svarshchik-metallokonstruktsiy/',
  privacy: '/politika-konfidencialnosti/',
  customOrder: '/izgotovlenie-na-zakaz/',
  notFound: '/404.html'
};

const representativeRoutes = Object.values(routes);
const crossViewportRoutes = representativeRoutes;
const viewports = [
  { name: '1440', width: 1440, height: 1000, mobile: false, scale: 1 },
  { name: '1280', width: 1280, height: 900, mobile: false, scale: 1 },
  { name: '1024', width: 1024, height: 900, mobile: false, scale: 1 },
  { name: '768', width: 768, height: 900, mobile: true, scale: 1 },
  { name: '390', width: 390, height: 844, mobile: true, scale: 1 },
  { name: '320', width: 320, height: 844, mobile: true, scale: 1 },
  { name: 'reflow-200', width: 640, height: 760, mobile: false, scale: 2 }
];

const screenshots = [
  { route: routes.home, width: 1440, height: 1000, name: 'production-home-desktop.png' },
  { route: routes.home, width: 390, height: 844, mobile: true, name: 'production-home-mobile.png' },
  { route: routes.catalog, width: 1440, height: 1000, name: 'production-catalog-desktop.png' },
  { route: routes.productMedia, width: 1440, height: 1000, name: 'production-product-desktop.png' },
  { route: routes.canopies, width: 1440, height: 1000, name: 'production-direction-desktop.png' },
  { route: routes.projects, width: 1440, height: 1000, name: 'production-projects-desktop.png', warm: true },
  { route: routes.industrialProject, width: 1440, height: 1000, name: 'production-project-detail-desktop.png', warm: true },
  { route: routes.company, width: 1440, height: 1000, name: 'production-company-desktop.png', warm: true },
  { route: routes.contacts, width: 1440, height: 1000, name: 'production-contacts-desktop.png', map: true },
  { route: routes.customOrder, width: 1440, height: 1000, name: 'production-custom-order-desktop.png' },
  { route: routes.notFound, width: 1440, height: 1000, name: 'production-404-desktop.png' }
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const progress = (message) => process.stderr.write(`[production-browser-qa] ${message}\n`);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webm': 'video/webm', '.xml': 'application/xml; charset=utf-8'
};

const staticServer = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', origin).pathname);
    let filename = pathname === '/404.html' ? path.join(distDir, '404.html') : path.resolve(distDir, `.${pathname}`);
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
      const notFoundFile = path.join(distDir, '404.html');
      const notFoundBody = await readFile(notFoundFile);
      response.writeHead(404, {
        'cache-control': 'no-store',
        'content-length': String(notFoundBody.length),
        'content-type': 'text/html; charset=utf-8'
      }).end(request.method === 'HEAD' ? undefined : notFoundBody);
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
  staticServer.listen(port, '127.0.0.1', resolve);
});
await mkdir(outputDir, { recursive: true });

const browser = spawn(chromePath, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages',
  '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const waitForDebugger = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = response.ok ? await response.json() : [];
      const page = pages.find((item) => item.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(120);
  }
  throw new Error('Chrome DevTools endpoint did not start.');
};

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
      for (const listener of this.events.get(message.method) || []) listener(message.params || {});
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
  once(method, timeoutMs = 25_000) {
    return new Promise((resolve, reject) => {
      const listener = (params) => {
        clearTimeout(timer);
        this.events.set(method, (this.events.get(method) || []).filter((item) => item !== listener));
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.events.set(method, (this.events.get(method) || []).filter((item) => item !== listener));
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.on(method, listener);
    });
  }
  close() {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

let cdp;
let currentRoute = 'about:blank';
const runtimeErrors = [];
const report = {
  startedAt: new Date().toISOString(),
  counts: { productionHttp: 0, representativeRoutes: representativeRoutes.length, viewports: viewports.length, diagnostics: 0 },
  http: [], diagnostics: [], screenshots: [], navigation: {}, home: {}, contacts: {}, company: {},
  customOrder: {}, notFound: {}, legacy: {}, productGallery: {}, projectGallery: {}, reducedMotion: {}, runtimeErrors
};

const evaluate = async (expression, awaitPromise = true) => {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed.');
  return result.result?.value;
};

const setViewport = async ({ width, height, mobile = false, scale = 1 }) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height,
    positionX: 0, positionY: 0, dontSetVisibleSize: false
  });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
};

const navigate = async (route, waitMs = 60) => {
  currentRoute = route;
  const domReady = cdp.once('Page.domContentEventFired', 18_000).then(() => true).catch(() => false);
  const navigation = await cdp.send('Page.navigate', { url: `${origin}${route}` });
  if (navigation.errorText) throw new Error(`Navigation failed for ${route}: ${navigation.errorText}`);
  let ready = await domReady;
  const deadline = Date.now() + 5_000;
  while (!ready && Date.now() < deadline) {
    try { ready = await evaluate("document.readyState !== 'loading'"); } catch {}
    if (!ready) await delay(60);
  }
  if (!ready) throw new Error(`DOM readiness timed out for ${route}.`);
  await evaluate(`(async () => {
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1200))]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
  await delay(waitMs);
};

const warmLazyMedia = async () => evaluate(`(async () => {
  document.querySelectorAll('img[loading="lazy"]').forEach((image) => { image.loading = 'eager'; });
  const height = document.documentElement.scrollHeight;
  for (let y = 0; y < height; y += 650) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  window.scrollTo(0, 0);
  await Promise.race([
    Promise.all(Array.from(document.images).map(async (image) => {
      if (!image.complete) await new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
      if (image.naturalWidth > 0 && image.decode) await image.decode().catch(() => {});
    })),
    new Promise((resolve) => setTimeout(resolve, 9000))
  ]);
  return true;
})()`);

const diagnostics = (viewportName) => evaluate(`(() => {
  const root = document.documentElement;
  const ids = Array.from(document.querySelectorAll('[id]')).map((item) => item.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const clippedByAncestor = (element) => {
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.body) {
      if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(ancestor).overflowX)) return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  const unlabeled = Array.from(document.querySelectorAll('button, input, select, textarea')).filter((control) => {
    if (control.hidden || control.getAttribute('aria-hidden') === 'true') return false;
    const text = (control.textContent || '').trim();
    const labelledBy = control.getAttribute('aria-labelledby');
    return !text && !control.getAttribute('aria-label') && !control.getAttribute('title')
      && !(labelledBy && document.getElementById(labelledBy)?.textContent?.trim());
  });
  return {
    viewport: ${JSON.stringify(viewportName)}, route: ${JSON.stringify(currentRoute)}, location: location.pathname,
    width: innerWidth, scale: visualViewport?.scale || 1, height: root.scrollHeight,
    overflow: Math.max(0, root.scrollWidth - root.clientWidth),
    horizontalOffenders: Array.from(document.querySelectorAll('body *')).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.position !== 'fixed' && rect.width > 0 && (rect.left < -1 || rect.right > root.clientWidth + 1)
        && !clippedByAncestor(element) && element.getAttribute('aria-hidden') !== 'true';
    }).slice(0, 8).map((element) => ({ tag: element.tagName, className: String(element.className || '') })),
    h1Count: document.querySelectorAll('h1').length,
    h1: document.querySelector('h1')?.textContent.trim() || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    robots: document.querySelector('meta[name="robots"]')?.content || '',
    duplicateIds,
    brokenImages: Array.from(document.images).filter((image) => (image.currentSrc || image.src) && image.complete && image.naturalWidth === 0).map((image) => image.currentSrc || image.src),
    emptyHrefs: document.querySelectorAll('a[href=""], a:not([href])').length,
    unlabeledControls: unlabeled.length,
    designLabLinks: Array.from(document.querySelectorAll('a[href]')).filter((link) => new URL(link.href, location.href).pathname.startsWith('/design-lab/')).length,
    paletteSwitches: document.querySelectorAll('.hv2-palette-switch').length,
    footer: Boolean(document.querySelector('footer')),
    header: Boolean(document.querySelector('.hv2-header'))
  };
})()`);

const pressKey = async (key, code = key, windowsVirtualKeyCode = key === 'Escape' ? 27 : 0) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
};

const waitForMap = async () => evaluate(`new Promise((resolve) => {
  const started = performance.now();
  const inspect = () => {
    const frame = document.querySelector('.practical-yandex-map iframe');
    const rect = frame?.getBoundingClientRect();
    if (frame && rect?.width > 100 && rect?.height > 100) {
      resolve({ title: frame.title, src: frame.src, width: Math.round(rect.width), height: Math.round(rect.height) });
      return;
    }
    if (performance.now() - started > 25000) { resolve(null); return; }
    setTimeout(inspect, 150);
  };
  inspect();
})`);

const saveScreenshot = async (name) => {
  await evaluate('window.scrollTo(0, 0)');
  await delay(100);
  const viewport = await evaluate('({ width: innerWidth, height: innerHeight })');
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: 1 }
  });
  const target = path.join(outputDir, name);
  const buffer = Buffer.from(result.data, 'base64');
  assert(buffer.length > 10_000, `${name} is unexpectedly small (${buffer.length} bytes).`);
  await writeFile(target, buffer);
  report.screenshots.push({ name, bytes: buffer.length, width: viewport.width, height: viewport.height });
};

try {
  cdp = new CdpClient(await waitForDebugger());
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    runtimeErrors.push({ route: currentRoute, type: 'exception', text: exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception' });
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') runtimeErrors.push({ route: currentRoute, type: 'console', text: args?.map((item) => item.value || item.description).filter(Boolean).join(' ') || 'console.error' });
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry?.level === 'error' && (!entry.url || entry.url.startsWith(origin))) {
      runtimeErrors.push({ route: currentRoute, type: 'log', text: entry.text || 'Browser log error', url: entry.url || '' });
    }
  });

  progress('capturing the required proof set before the diagnostic crawl');
  await setViewport({ width: 1440, height: 1000 });
  await navigate(routes.home, 150);
  await evaluate(`(() => {
    const banner = document.querySelector('[data-cookie-banner]');
    const close = document.querySelector('[data-cookie-notice-close]');
    if (banner && !banner.hidden && close) close.click();
    return !banner || banner.hidden;
  })()`);
  await delay(120);
  for (const shot of screenshots) {
    await setViewport(shot);
    await navigate(shot.route, shot.map ? 250 : 150);
    if (shot.warm) await warmLazyMedia();
    if (shot.map) {
      const map = await waitForMap();
      assert(map, 'Yandex map was not available for contacts screenshot.');
      await evaluate(`(() => {
        const frame = document.querySelector('.practical-yandex-map iframe');
        frame?.scrollIntoView({ block: 'center', inline: 'nearest' });
        window.dispatchEvent(new Event('resize'));
        return Boolean(frame);
      })()`);
      await delay(4000);
    }
    await saveScreenshot(shot.name);
  }

  progress('checking local HTTP for every audited production route');
  const routeAudit = await readFile(path.join(root, 'docs', 'migration', 'v2-production-route-audit.csv'), 'utf8');
  const auditedRoutes = routeAudit.trim().split(/\r?\n/).slice(1).map((line) => line.split(',')[0]).filter(Boolean);
  for (const route of auditedRoutes) {
    const response = await fetch(`${origin}${route}`, { method: 'HEAD', redirect: 'manual' });
    report.http.push({ route, status: response.status });
  }
  report.counts.productionHttp = auditedRoutes.length;
  assert(report.http.every((item) => item.status === 200), `Production HTTP failures: ${JSON.stringify(report.http.filter((item) => item.status !== 200))}`);

  const baseViewport = viewports.find((item) => item.name === '1280');
  const responsivePlan = [
    ...representativeRoutes.map((route) => ({ route, viewport: baseViewport })),
    ...viewports.filter((item) => item.name !== '1280').flatMap((viewport) => crossViewportRoutes.map((route) => ({ route, viewport })))
  ];
  progress(`running ${responsivePlan.length} representative responsive render diagnostics in one Chrome page`);
  for (let index = 0; index < responsivePlan.length; index += 1) {
    const { route, viewport } = responsivePlan[index];
    await setViewport(viewport);
    await navigate(route);
    // Navigation resets Chrome's page scale. Re-apply it after DOM readiness so the reflow-200
    // specimen is an actual 200% visual viewport, not only a 640 px layout approximation.
    await setViewport(viewport);
    await delay(50);
    report.diagnostics.push(await diagnostics(viewport.name));
    if ((index + 1) % 12 === 0) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  }
  report.counts.diagnostics = report.diagnostics.length;
  const layoutFailures = report.diagnostics.filter((item) => item.overflow > 1 || item.horizontalOffenders.length
    || item.h1Count !== 1 || !item.h1 || item.duplicateIds.length || item.brokenImages.length
    || item.emptyHrefs || item.unlabeledControls || item.designLabLinks || item.paletteSwitches || !item.header || !item.footer);
  assert(layoutFailures.length === 0, `Responsive render failures: ${JSON.stringify(layoutFailures.slice(0, 12))}`);
  const reflowFailures = report.diagnostics.filter((item) => item.viewport === 'reflow-200' && Math.abs(item.scale - 2) > 0.05);
  assert(reflowFailures.length === 0, `200% reflow scale was not applied: ${JSON.stringify(reflowFailures)}`);

  progress('checking production shell, navigation, video and practical pages');
  await setViewport({ width: 1440, height: 1000 });
  await navigate(routes.home, 250);
  report.home = await evaluate(`(() => {
    const header = document.querySelector('.hv2-header');
    const video = document.querySelector('[data-hv2-hero-video]');
    return {
      palette: document.documentElement.dataset.homeV2Theme,
      paletteSwitches: document.querySelectorAll('.hv2-palette-switch').length,
      videoSources: Array.from(video.querySelectorAll('source')).map((source) => source.getAttribute('src')),
      deferredVideoSrc: video.dataset.hv2VideoSrc,
      poster: video.getAttribute('poster'),
      initialScrolled: header.classList.contains('is-scrolled'),
      productionLinks: Array.from(document.querySelectorAll('a[href]')).every((link) => !new URL(link.href, location.href).pathname.startsWith('/design-lab/'))
    };
  })()`);
  await evaluate(`(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    const hero = document.querySelector('[data-hv2-hero]');
    window.scrollTo(0, Math.max(1200, (hero?.offsetHeight || 0) + 320));
  })()`);
  await delay(180);
  report.home.headerAfterDown = await evaluate(`(() => {
    const header = document.querySelector('.hv2-header');
    return {
      solid: header.classList.contains('is-scrolled'),
      hidden: header.classList.contains('is-hidden')
    };
  })()`);
  await evaluate('window.scrollBy(0, -64)');
  await delay(180);
  report.home.headerAfterUp = await evaluate(`(() => {
    const header = document.querySelector('.hv2-header');
    return {
      solid: header.classList.contains('is-scrolled'),
      hidden: header.classList.contains('is-hidden')
    };
  })()`);
  assert(report.home.palette === 'engineering' && report.home.paletteSwitches === 0 && report.home.productionLinks
    && report.home.headerAfterDown.solid && report.home.headerAfterDown.hidden
    && report.home.headerAfterUp.solid && !report.home.headerAfterUp.hidden
    && report.home.deferredVideoSrc === homeRecord.heroMediaVideo
    && !report.home.videoSources.includes(homeRecord.heroMediaVideoMobile)
    && report.home.poster === null, 'Production home shell/video/header check failed.');

  await navigate(routes.categoryFilled, 120);
  report.navigation.dropdown = await evaluate(`(async () => {
    const trigger = document.querySelector('[data-hv2-dropdown-trigger]');
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const first = trigger.closest('[data-hv2-dropdown]').querySelector('[data-hv2-dropdown-link]');
    const opened = trigger.getAttribute('aria-expanded') === 'true' && document.activeElement === first;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { opened, closed: trigger.getAttribute('aria-expanded') === 'false', focusReturned: document.activeElement === trigger };
  })()`);
  await setViewport({ width: 390, height: 844, mobile: true });
  await navigate(routes.categoryFilled, 120);
  report.navigation.mobile = await evaluate(`(async () => {
    const opener = document.querySelector('[data-hv2-mobile-open]');
    opener.focus(); opener.click();
    await new Promise((resolve) => setTimeout(resolve, 360));
    const menu = document.querySelector('[data-hv2-mobile-menu]');
    const items = Array.from(menu.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((item) => !item.hidden);
    const first = items[0], last = items.at(-1);
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    return { visible: !menu.hidden, focusWrapped: document.activeElement === first, bodyLocked: getComputedStyle(document.body).position === 'fixed', mainInert: document.querySelector('main').hasAttribute('inert') };
  })()`);
  await pressKey('Escape');
  await delay(360);
  report.navigation.mobile.closed = await evaluate("document.querySelector('[data-hv2-mobile-menu]').hidden");
  report.navigation.mobile.focusReturned = await evaluate("document.activeElement === document.querySelector('[data-hv2-mobile-open]')");
  assert(report.navigation.dropdown.opened && report.navigation.dropdown.closed && report.navigation.dropdown.focusReturned, 'Desktop dropdown keyboard behavior failed.');
  assert(report.navigation.mobile.visible && report.navigation.mobile.focusWrapped && report.navigation.mobile.bodyLocked
    && report.navigation.mobile.mainInert && report.navigation.mobile.closed && report.navigation.mobile.focusReturned, 'Mobile menu focus/close behavior failed.');

  await setViewport({ width: 1440, height: 1000 });
  await navigate(routes.company, 160);
  await warmLazyMedia();
  report.company = await evaluate(`(() => ({
    heroImages: Array.from(document.querySelectorAll('.practical-company__hero-frame img')).map((image) => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight })),
    projectImages: Array.from(document.querySelectorAll('.practical-company__project-media img')).map((image) => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight })),
    projects: document.querySelectorAll('.practical-company__project-grid article').length
  }))()`);
  assert(report.company.heroImages.length === 2 && report.company.heroImages.every((image) => image.width > 0)
    && report.company.projectImages.length === 2 && report.company.projectImages.every((image) => image.width > 0), 'Company hero/project media decode failed.');

  await navigate(routes.contacts, 250);
  report.contacts.map = await waitForMap();
  report.contacts.details = await evaluate(`(() => ({
    mapLink: document.querySelector('.practical-contacts__map-link')?.href || '',
    contactHrefs: Array.from(document.querySelectorAll('.practical-contact-card')).map((link) => link.getAttribute('href')),
    frameTitle: document.querySelector('.practical-yandex-map iframe')?.title || '',
    geographyBlock: Array.from(document.querySelectorAll('h2, h3')).some((heading) => heading.textContent.includes('География работ'))
  }))()`);
  const mapFrameConstructorId = report.contacts.map ? new URL(report.contacts.map.src).searchParams.get('um') : '';
  const mapLinkConstructorId = report.contacts.details.mapLink ? new URL(report.contacts.details.mapLink).searchParams.get('um') : '';
  assert(report.contacts.map && report.contacts.map.title.includes('Яндекс') && mapFrameConstructorId === expectedConstructorId
    && mapLinkConstructorId === expectedConstructorId && report.contacts.details.contactHrefs.every(Boolean)
    && !report.contacts.details.geographyBlock, 'Contacts map/link/content check failed.');

  await navigate(routes.customOrder, 120);
  report.customOrder = await evaluate(`(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    directions: Array.from(document.querySelectorAll('.custom-order-directions__grid > a')).map((link) => new URL(link.href).pathname),
    changes: document.querySelectorAll('.custom-order-changes__list li').length,
    inputs: document.querySelectorAll('.custom-order-inputs__list li').length,
    examples: document.querySelectorAll('.custom-order-examples__grid > a').length,
    contacts: Array.from(document.querySelectorAll('.custom-order-contact__channels a')).map((link) => link.getAttribute('href'))
  }))()`);
  assert(report.customOrder.h1 === 'Изготовление под задачу объекта' && report.customOrder.directions.length === 7
    && report.customOrder.directions.every((item) => !item.startsWith('/design-lab/')) && report.customOrder.changes > 0
    && report.customOrder.inputs === 6 && report.customOrder.examples === 3 && report.customOrder.contacts.length === 3
    && report.customOrder.contacts.every(Boolean), 'Custom-order production structure failed.');

  await navigate(routes.notFound, 100);
  report.notFound = await evaluate(`(() => ({
    h1: document.querySelector('h1')?.textContent.trim(),
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    robots: document.querySelector('meta[name="robots"]')?.content || '',
    actions: Array.from(document.querySelectorAll('.not-found-v2 a[href]')).map((link) => link.getAttribute('href'))
  }))()`);
  assert(report.notFound.h1 === 'Страница не найдена' && !report.notFound.canonical && report.notFound.robots.includes('noindex')
    && report.notFound.actions.length >= 2, 'Production 404 check failed.');
  const missingResponse = await fetch(`${origin}/__qa-missing-route__/`, { redirect: 'manual' });
  const missingBody = await missingResponse.text();
  report.notFound.missingRoute = {
    status: missingResponse.status,
    customBody: missingBody.includes('Страница не найдена')
  };
  assert(report.notFound.missingRoute.status === 404 && report.notFound.missingRoute.customBody,
    'Local 404 status/custom artifact integration failed.');

  progress('checking product and project gallery interaction');
  await navigate(routes.productMedia, 140);
  report.productGallery.navigation = await evaluate(`(async () => {
    const status = document.querySelector('[data-v2-gallery-status]');
    const before = status.textContent.trim();
    document.querySelector('[data-v2-gallery-next]').click(); await new Promise((resolve) => setTimeout(resolve, 70));
    const afterNext = status.textContent.trim();
    document.querySelector('[data-v2-gallery-prev]').click(); await new Promise((resolve) => setTimeout(resolve, 70));
    return { before, afterNext, afterPrevious: status.textContent.trim() };
  })()`);
  report.productGallery.open = await evaluate(`(async () => {
    const opener = document.querySelector('[data-v2-gallery-open]');
    opener.focus(); opener.click(); await new Promise((resolve) => setTimeout(resolve, 100));
    const dialog = document.querySelector('[data-v2-product-lightbox]');
    const close = dialog.querySelector('[data-v2-lightbox-close]');
    const items = Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
    const first = items[0], last = items.at(-1);
    const initialFocus = document.activeElement === close;
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    return { open: dialog.open, initialFocus, focusWrapped: document.activeElement === first, fit: getComputedStyle(dialog.querySelector('[data-v2-lightbox-image]')).objectFit };
  })()`);
  await pressKey('Escape'); await delay(100);
  report.productGallery.closed = await evaluate(`({ open: document.querySelector('[data-v2-product-lightbox]').open, focusReturned: document.activeElement === document.querySelector('[data-v2-gallery-open]') })`);
  await setViewport({ width: 390, height: 844, mobile: true });
  await navigate(routes.productMedia, 120);
  report.productGallery.swipe = await evaluate(`(async () => {
    const stage = document.querySelector('.v2-product-gallery__stage');
    const status = document.querySelector('[data-v2-gallery-status]');
    const before = status.textContent.trim();
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 41, clientX: 320, clientY: 330 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 41, clientX: 90, clientY: 336 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterHorizontal = status.textContent.trim();
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 42, clientX: 200, clientY: 220 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 42, clientX: 207, clientY: 380 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { before, afterHorizontal, afterVertical: status.textContent.trim(), touchAction: getComputedStyle(stage).touchAction };
  })()`);

  await setViewport({ width: 1440, height: 1000 });
  await navigate(routes.industrialProject, 140);
  report.projectGallery.open = await evaluate(`(async () => {
    const opener = document.querySelector('[data-v2-project-gallery-open]');
    opener.focus(); opener.click(); await new Promise((resolve) => setTimeout(resolve, 100));
    const dialog = document.querySelector('[data-v2-project-lightbox]');
    const close = dialog.querySelector('[data-v2-project-lightbox-close]');
    const items = Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
    const first = items[0], last = items.at(-1);
    const initialFocus = document.activeElement === close;
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    return { open: dialog.open, initialFocus, focusWrapped: document.activeElement === first, fit: getComputedStyle(dialog.querySelector('[data-v2-project-lightbox-image]')).objectFit };
  })()`);
  await pressKey('Escape'); await delay(100);
  report.projectGallery.closed = await evaluate(`({ open: document.querySelector('[data-v2-project-lightbox]').open, focusReturned: document.activeElement === document.querySelector('[data-v2-project-gallery-open]') })`);
  await setViewport({ width: 390, height: 844, mobile: true });
  await navigate(routes.landscapingProject, 120);
  report.projectGallery.swipe = await evaluate(`(async () => {
    const stage = document.querySelector('[data-v2-project-gallery-swipe]');
    const status = document.querySelector('[data-v2-project-gallery-status]');
    const before = status.textContent.trim();
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 51, clientX: 320, clientY: 350 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 51, clientX: 90, clientY: 356 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterHorizontal = status.textContent.trim();
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 52, clientX: 200, clientY: 220 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 52, clientX: 207, clientY: 380 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { before, afterHorizontal, afterVertical: status.textContent.trim(), touchAction: getComputedStyle(stage).touchAction };
  })()`);
  assert(report.productGallery.navigation.before !== report.productGallery.navigation.afterNext
    && report.productGallery.navigation.before === report.productGallery.navigation.afterPrevious, 'Product gallery arrows/counter failed.');
  assert(report.productGallery.open.open && report.productGallery.open.initialFocus && report.productGallery.open.focusWrapped
    && report.productGallery.open.fit === 'contain' && !report.productGallery.closed.open && report.productGallery.closed.focusReturned, 'Product fullscreen/focus/Escape failed.');
  assert(report.productGallery.swipe.before !== report.productGallery.swipe.afterHorizontal
    && report.productGallery.swipe.afterHorizontal === report.productGallery.swipe.afterVertical, 'Product gallery swipe/vertical-scroll behavior failed.');
  assert(report.projectGallery.open.open && report.projectGallery.open.initialFocus && report.projectGallery.open.focusWrapped
    && report.projectGallery.open.fit === 'contain' && !report.projectGallery.closed.open && report.projectGallery.closed.focusReturned, 'Project fullscreen/focus/Escape failed.');
  assert(report.projectGallery.swipe.before !== report.projectGallery.swipe.afterHorizontal
    && report.projectGallery.swipe.afterHorizontal === report.projectGallery.swipe.afterVertical, 'Project gallery swipe/vertical-scroll behavior failed.');

  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await navigate(routes.productMedia, 100);
  report.reducedMotion = await evaluate(`(() => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    pendingReveals: document.querySelectorAll('.hv2-reveal-pending').length,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    imageTransition: getComputedStyle(document.querySelector('[data-v2-gallery-main]')).transitionDuration
  }))()`);
  assert(report.reducedMotion.matches && report.reducedMotion.pendingReveals === 0 && report.reducedMotion.scrollBehavior === 'auto', 'Reduced-motion check failed.');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  progress('checking static legacy fallback behavior in the browser');
  for (const [alias, target] of Object.entries({
    '/lavochki-i-skameyki/': '/ulichnaya-mebel/lavochki-i-skameyki/',
    '/urny/': '/ulichnaya-mebel/urny/',
    '/navesy/': '/navesy-i-kozyrki/'
  })) {
    currentRoute = alias;
    const navigation = await cdp.send('Page.navigate', { url: `${origin}${alias}` });
    if (navigation.errorText) throw new Error(`Legacy navigation failed for ${alias}: ${navigation.errorText}`);
    await delay(650);
    let landed = '';
    for (let attempt = 0; attempt < 20 && !landed; attempt += 1) {
      try { landed = await evaluate(`location.pathname === ${JSON.stringify(target)} ? location.pathname : ''`); } catch {}
      if (!landed) await delay(80);
    }
    report.legacy[alias] = { target, landed };
  }
  assert(Object.values(report.legacy).every((item) => item.landed === item.target), `Static legacy fallback did not reach targets: ${JSON.stringify(report.legacy)}`);

  assert(runtimeErrors.length === 0, `Browser runtime/console errors: ${JSON.stringify(runtimeErrors.slice(0, 20))}`);
  report.finishedAt = new Date().toISOString();
  report.result = 'pass';
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    result: report.result,
    productionHttp: report.counts.productionHttp,
    diagnostics: report.counts.diagnostics,
    screenshots: report.screenshots.length,
    runtimeErrors: runtimeErrors.length,
    map: report.contacts.map,
    legacy: report.legacy
  }, null, 2)}\n`);
} catch (error) {
  report.finishedAt = new Date().toISOString();
  report.result = 'fail';
  report.failure = error instanceof Error ? error.stack : String(error);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {});
  throw error;
} finally {
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  }
  await Promise.race([
    new Promise((resolve) => browser.once('exit', resolve)),
    delay(4000)
  ]);
  if (browser.exitCode === null) browser.kill('SIGKILL');
  await new Promise((resolve) => staticServer.close(resolve));
  await delay(300);
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

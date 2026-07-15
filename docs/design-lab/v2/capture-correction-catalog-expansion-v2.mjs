import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin = 'http://127.0.0.1:4324';
const outputDir = path.resolve('docs/design-lab/v2');
const distDir = path.resolve('dist');
const debugPort = 10120 + Math.floor(Math.random() * 100);
const profileDir = await mkdtemp(path.join(outputDir, '.correction-catalog-profile-'));
const captureExisting = process.env.CAPTURE_EXISTING === 'true';

const routes = {
  home: '/design-lab/home-v2/',
  company: '/design-lab/v2/o-nas/',
  contacts: '/design-lab/v2/kontakty/',
  vacancies: '/design-lab/v2/vakansii/',
  vacancy: '/design-lab/v2/vakansii/svarshchik-metallokonstruktsiy/',
  legal: '/design-lab/v2/politika-konfidencialnosti/',
  project: '/design-lab/v2/vypolnennye-obekty/kompleks-rabot-na-proizvodstvennoy-territorii/',
  projectSwipe: '/design-lab/v2/vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/',
  projectArchive: '/design-lab/v2/vypolnennye-obekty/',
  catalogSection: '/design-lab/v2/ulichnaya-mebel/',
  direction: '/design-lab/v2/metallokonstruktsii-dlya-biznesa/',
  customOrder: '/design-lab/v2/izgotovlenie-na-zakaz/',
  notFound: '/design-lab/v2/404/',
  categoryFilled: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/',
  categorySmall: '/design-lab/v2/ulichnaya-mebel/stoly-i-komplekty/',
  categorySparse: '/design-lab/v2/ograzhdeniya-i-zabory/zabory/',
  categoryNoMedia: '/design-lab/v2/ograzhdeniya-i-zabory/dekorativnye-ograzhdeniya/',
  categoryLong: '/design-lab/v2/ulichnaya-mebel/vazony-i-tsvetochnitsy/',
  productMedia: '/design-lab/v2/ulichnaya-mebel/kacheli/kachel-portal/',
  productSingle: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/skamya-smu1-bazovaya/',
  productZero: '/design-lab/v2/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-zakrytaya/',
  productSpecs: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/bolshaya-skameyka-amplituda/',
  productPortrait: '/design-lab/v2/ulichnaya-mebel/ulichnoe-osveshchenie/fonar-prizma/'
};

const representativeRoutes = [
  routes.categoryFilled,
  routes.categorySmall,
  routes.categorySparse,
  routes.categoryNoMedia,
  routes.categoryLong,
  routes.productMedia,
  routes.productSingle,
  routes.productZero,
  routes.productSpecs,
  routes.productPortrait
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const progress = (message) => process.stderr.write(`[correction-catalog-v2] ${message}\n`);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
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
  staticServer.listen(4324, '127.0.0.1', resolve);
});
await mkdir(outputDir, { recursive: true });

const v2Files = await readdir(path.join(distDir, 'design-lab', 'v2'), { recursive: true });
const catalogRoutes = v2Files
  .map((file) => String(file).replaceAll('\\', '/'))
  .filter((file) => file.endsWith('/index.html'))
  .map((file) => `/design-lab/v2/${file.replace(/index\.html$/, '')}`)
  .filter((route) => {
    const parts = route.split('/').filter(Boolean);
    return ['ulichnaya-mebel', 'ograzhdeniya-i-zabory'].includes(parts[2]) && [4, 5].includes(parts.length);
  })
  .sort();

const allV2Routes = [
  routes.home,
  ...v2Files
    .map((file) => String(file).replaceAll('\\', '/'))
    .filter((file) => file.endsWith('/index.html'))
    .map((file) => `/design-lab/v2/${file.replace(/index\.html$/, '')}`)
].sort();

const regressionRoutes = [
  routes.home, routes.contacts, routes.company, routes.catalogSection,
  routes.categoryFilled, routes.categorySparse, routes.productMedia, routes.productZero,
  routes.direction, routes.projectArchive, routes.project, routes.vacancies,
  routes.vacancy, routes.legal, routes.customOrder, routes.notFound
];

const browser = spawn(chromePath, [
  '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages',
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const waitForDebugger = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = response.ok ? await response.json() : [];
      const page = pages.find((item) => item.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
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
  once(method, timeoutMs = 20000) {
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
  counts: { v2Routes: allV2Routes.length, catalogRoutes: catalogRoutes.length, representativeRoutes: representativeRoutes.length },
  http: [], allV2: [], catalog: [], representative: [], customOrder: [], customOrderFull: null, notFound: [], regression: [], screenshots: [], practical: {},
  navigation: {}, productGallery: {}, projectGallery: {}, reducedMotion: {}, runtimeErrors
};

const evaluate = async (expression, awaitPromise = true) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true, userGesture: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed.');
  return result.result?.value;
};

const setViewport = async (width, height, mobile = false, deviceScaleFactor = 1) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor, mobile, screenWidth: width, screenHeight: height,
    positionX: 0, positionY: 0, dontSetVisibleSize: false
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
};

const navigate = async (route, waitMs = 180) => {
  currentRoute = route;
  const loaded = cdp.once('Page.loadEventFired');
  const navigation = await cdp.send('Page.navigate', { url: `${origin}${route}?palette=olive` });
  if (navigation.errorText) throw new Error(`Navigation failed for ${route}: ${navigation.errorText}`);
  await loaded;
  await evaluate(`(async () => {
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1800))]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
  await delay(waitMs);
};

const warmLazyMedia = async () => evaluate(`(async () => {
  document.querySelectorAll('img[loading="lazy"]').forEach((image) => { image.loading = 'eager'; });
  const height = document.documentElement.scrollHeight;
  for (let y = 0; y < height; y += 620) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 36));
  }
  window.scrollTo(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 260));
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
  document.querySelectorAll('.hv2-reveal-pending').forEach((element) => {
    element.classList.remove('hv2-reveal-pending');
    element.classList.add('hv2-reveal-visible');
  });
  return true;
})()`);

const waitForMap = async () => evaluate(`new Promise((resolve) => {
  const started = performance.now();
  const inspect = () => {
    const frame = document.querySelector('.practical-yandex-map iframe');
    const rect = frame?.getBoundingClientRect();
    if (frame && rect?.width > 100 && rect?.height > 100) {
      resolve({ title: frame.title, src: frame.src, width: Math.round(rect.width), height: Math.round(rect.height) });
      return;
    }
    if (performance.now() - started > 20000) { resolve(null); return; }
    setTimeout(inspect, 120);
  };
  inspect();
})`);

const saveViewport = async (filename) => {
  const viewport = await evaluate(`({ pageX: window.scrollX, pageY: window.scrollY, clientWidth: window.innerWidth, clientHeight: window.innerHeight })`);
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: {
      x: viewport.pageX || 0,
      y: viewport.pageY || 0,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      scale: 1
    }
  });
  await writeFile(path.join(outputDir, filename), Buffer.from(result.data, 'base64'));
  report.screenshots.push(filename);
};

const saveFullPage = async (filename) => {
  const initialViewport = await evaluate(`({ width: window.innerWidth, height: window.innerHeight })`);
  const chunkHeight = Math.min(1000, initialViewport.height || 1000);
  await setViewport(initialViewport.width, chunkHeight);
  await evaluate(`(() => {
    const style = document.createElement('style');
    style.id = 'qa-full-page-capture-style';
    style.textContent = 'html{scroll-behavior:auto!important}.hv2-header{position:static!important}.hv2-palette-switch{position:absolute!important}';
    document.head.append(style);
    window.scrollTo(0, 0);
    return true;
  })()`);

  const metrics = await cdp.send('Page.getLayoutMetrics');
  const width = Math.ceil(metrics.cssContentSize?.width || metrics.contentSize.width);
  const height = Math.ceil(metrics.cssContentSize?.height || metrics.contentSize.height);
  const offsets = [];
  for (let y = 0; y < height; y += chunkHeight) offsets.push(Math.min(y, Math.max(0, height - chunkHeight)));
  const uniqueOffsets = [...new Set(offsets)];
  const chunks = [];

  for (const requestedY of uniqueOffsets) {
    const actualY = await evaluate(`new Promise((resolve) => {
      window.scrollTo(0, ${requestedY});
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(window.scrollY))));
    })`);
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true
    });
    chunks.push({ input: Buffer.from(result.data, 'base64'), left: 0, top: actualY });
  }

  const png = await sharp({
    create: { width, height, channels: 4, background: { r: 247, g: 246, b: 240, alpha: 1 } }
  }).composite(chunks).png().toBuffer();
  await writeFile(path.join(outputDir, filename), png);
  await evaluate(`document.querySelector('#qa-full-page-capture-style')?.remove(); window.scrollTo(0, 0)`);
  await setViewport(initialViewport.width, initialViewport.height);
  report.screenshots.push(filename);
  return { width, height };
};

const pressKey = async (key, code = key, windowsVirtualKeyCode = key === 'Escape' ? 27 : 0) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
};

const diagnostics = () => evaluate(`(() => {
  const root = document.documentElement;
  const ids = Array.from(document.querySelectorAll('[id]')).map((item) => item.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const bodyText = document.body.innerText;
  const clippedByAncestor = (element) => {
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.body) {
      if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(ancestor).overflowX)) return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  return {
    route: location.pathname,
    width: innerWidth,
    height: root.scrollHeight,
    overflow: Math.max(0, root.scrollWidth - root.clientWidth),
    horizontalOffenders: Array.from(document.querySelectorAll('body *')).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.position !== 'fixed' && rect.width > 0 && (rect.left < -1 || rect.right > root.clientWidth + 1) && !clippedByAncestor(element);
    }).slice(0, 6).map((element) => ({ tag: element.tagName, className: String(element.className || '') })),
    h1Count: document.querySelectorAll('h1').length,
    h1: document.querySelector('h1')?.textContent.trim() || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    robots: document.querySelector('meta[name="robots"]')?.content || '',
    duplicateIds,
    brokenImages: Array.from(document.images).filter((image) => (image.currentSrc || image.src) && image.complete && image.naturalWidth === 0).map((image) => image.currentSrc || image.src),
    emptyHrefs: document.querySelectorAll('a[href=""], a:not([href])').length,
    unlabeledButtons: Array.from(document.querySelectorAll('button')).filter((button) => !(button.textContent || '').trim() && !button.getAttribute('aria-label')).length,
    publicSku: />\\s*\\u0410\\u0440\\u0442\\u0438\\u043a\\u0443\\u043b\\s*</i.test(document.documentElement.innerHTML) || /\\bSKU\\b/.test(bodyText),
    oldCategoryLinks: Array.from(document.querySelectorAll('a[href]')).map((link) => new URL(link.href).pathname).filter((href) => /^\\/(?:ulichnaya-mebel|ograzhdeniya-i-zabory)\\/[^/]+\\/$/.test(href)),
    oldProductLinks: Array.from(document.querySelectorAll('a[href]')).map((link) => new URL(link.href).pathname).filter((href) => /^\\/(?:ulichnaya-mebel|ograzhdeniya-i-zabory)\\/[^/]+\\/[^/]+\\/$/.test(href)),
    galleryImages: document.querySelector('[data-v2-gallery-data]') ? JSON.parse(document.querySelector('[data-v2-gallery-data]').textContent).images.length : null,
    placeholders: document.querySelectorAll('img[src*="/assets/images/placeholders/"]').length
  };
})()`);

try {
  cdp = new CdpClient(await waitForDebugger());
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    runtimeErrors.push({ route: currentRoute, type: 'exception', text: exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception' });
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type !== 'error') return;
    runtimeErrors.push({ route: currentRoute, type: 'console', text: args?.map((item) => item.value || item.description).filter(Boolean).join(' ') || 'console.error' });
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry?.level !== 'error') return;
    runtimeErrors.push({ route: currentRoute, type: 'log', text: entry.text || 'Browser log error', url: entry.url || '' });
  });

  progress('checking HTTP success for all generated V2 routes');
  for (const route of allV2Routes) {
    const response = await fetch(`${origin}${route}`, { method: 'HEAD' });
    report.http.push({ route, status: response.status });
  }

  progress('checking render, canonical, robots, controls and console for all V2 routes');
  await setViewport(1280, 900);
  for (let index = 0; index < allV2Routes.length; index += 1) {
    const route = allV2Routes[index];
    await navigate(route, 90);
    const result = await diagnostics();
    report.allV2.push(result);
    if (catalogRoutes.includes(route)) report.catalog.push(result);
    if ((index + 1) % 20 === 0) progress(`checked ${index + 1}/${allV2Routes.length} V2 routes`);
  }

  progress('checking representative catalog pages at required widths and 200% reflow');
  for (const setup of [
    { width: 1440, height: 1000 }, { width: 1280, height: 900 }, { width: 1024, height: 900 },
    { width: 768, height: 900, mobile: true }, { width: 390, height: 844, mobile: true },
    { width: 320, height: 844, mobile: true }, { width: 720, height: 650, scale: 2 }
  ]) {
    await setViewport(setup.width, setup.height, Boolean(setup.mobile), setup.scale || 1);
    for (const route of representativeRoutes) {
      await navigate(route, 110);
      report.representative.push({ setup, ...(await diagnostics()) });
    }
  }

  progress('checking custom-order and 404 responsive layouts, including 200% equivalent reflow');
  for (const setup of [
    { width: 1440, height: 1000 }, { width: 1280, height: 900 }, { width: 1024, height: 900 },
    { width: 768, height: 900, mobile: true }, { width: 390, height: 844, mobile: true },
    { width: 320, height: 844, mobile: true }, { width: 640, height: 900, reflow: '200%@1280' }
  ]) {
    await setViewport(setup.width, setup.height, Boolean(setup.mobile));
    await navigate(routes.customOrder, 130);
    report.customOrder.push({ setup, ...(await diagnostics()) });
  }
  report.customOrderDetails = await evaluate(`(() => ({
    directions: Array.from(document.querySelectorAll('.custom-order-directions__grid > a')).map((link) => link.getAttribute('href')),
    changes: document.querySelectorAll('.custom-order-changes__list > li').length,
    inputs: document.querySelectorAll('.custom-order-inputs__list > li').length,
    examples: document.querySelectorAll('.custom-order-examples__grid > a').length,
    contacts: Array.from(document.querySelectorAll('.custom-order-contact__channels > a')).map((link) => link.getAttribute('href')),
    heroImages: Array.from(document.querySelectorAll('.custom-order-hero__media img')).map((image) => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight }))
  }))()`);
  for (const setup of [
    { width: 1440, height: 1000 }, { width: 390, height: 844, mobile: true },
    { width: 320, height: 844, mobile: true }, { width: 640, height: 900, reflow: '200%@1280' }
  ]) {
    await setViewport(setup.width, setup.height, Boolean(setup.mobile));
    await navigate(routes.notFound, 130);
    report.notFound.push({ setup, ...(await diagnostics()) });
  }
  report.notFoundDetails = await evaluate(`(() => ({
    actions: Array.from(document.querySelectorAll('.not-found-v2__actions a')).map((link) => link.getAttribute('href')),
    contacts: Array.from(document.querySelectorAll('.not-found-v2__contacts a')).map((link) => link.getAttribute('href'))
  }))()`);

  progress('capturing custom-order and 404 screenshots');
  for (const task of [
    ['custom-order-desktop.png', routes.customOrder, 1440, 1000, false],
    ['custom-order-mobile.png', routes.customOrder, 390, 844, true],
    ['404-desktop.png', routes.notFound, 1440, 1000, false],
    ['404-mobile.png', routes.notFound, 390, 844, true]
  ]) {
    const [filename, route, width, height, mobile] = task;
    await setViewport(width, height, mobile);
    await navigate(route, 250);
    await warmLazyMedia();
    await saveViewport(filename);
  }
  await setViewport(1440, 900);
  await navigate(routes.customOrder, 300);
  await warmLazyMedia();
  report.customOrderFull = await saveFullPage('custom-order-full.png');

  progress('regression-checking representative V2 page families at desktop and mobile widths');
  for (const setup of [
    { width: 1280, height: 900 }, { width: 390, height: 844, mobile: true }
  ]) {
    await setViewport(setup.width, setup.height, Boolean(setup.mobile));
    for (const route of regressionRoutes) {
      await navigate(route, 110);
      report.regression.push({ setup, ...(await diagnostics()) });
    }
  }

  let companyFull = null;
  let mapForCapture = null;
  let contactsFull = null;
  if (captureExisting) {
    progress('recapturing existing practical and catalog screenshots by explicit request');
    for (const task of [
      ['company-desktop.png', routes.company, 1440, 1000, false],
      ['company-mobile.png', routes.company, 390, 844, true],
      ['contacts-desktop.png', routes.contacts, 1440, 1000, false],
      ['contacts-mobile.png', routes.contacts, 390, 844, true],
      ['vacancies-archive-desktop.png', routes.vacancies, 1440, 1000, false],
      ['vacancies-archive-mobile.png', routes.vacancies, 390, 844, true],
      ['vacancy-detail-desktop.png', routes.vacancy, 1440, 1000, false],
      ['vacancy-detail-mobile.png', routes.vacancy, 390, 844, true],
      ['legal-desktop.png', routes.legal, 1440, 1000, false],
      ['legal-mobile.png', routes.legal, 390, 844, true]
    ]) {
      const [filename, route, width, height, mobile] = task;
      await setViewport(width, height, mobile);
      await navigate(route, 300);
      await warmLazyMedia();
      if (route === routes.contacts) {
        await waitForMap();
        await delay(1600);
        if (mobile) await evaluate(`new Promise((resolve) => {
          document.documentElement.style.scrollBehavior = 'auto';
          const target = document.querySelector('.practical-contacts__details');
          window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY)));
        })`);
      }
      await saveViewport(filename);
    }

    await setViewport(1440, 900);
    await navigate(routes.company, 350);
    await warmLazyMedia();
    companyFull = await saveFullPage('company-full.png');
    await navigate(routes.contacts, 350);
    mapForCapture = await waitForMap();
    await warmLazyMedia();
    contactsFull = await saveFullPage('contacts-full.png');

    for (const task of [
      ['catalog-expansion-category-filled-desktop.png', routes.categoryFilled, 1440, 1000, false],
      ['catalog-expansion-category-filled-mobile.png', routes.categoryFilled, 390, 844, true],
      ['catalog-expansion-category-sparse-desktop.png', routes.categorySparse, 1440, 1000, false],
      ['catalog-expansion-product-media-desktop.png', routes.productMedia, 1440, 1000, false],
      ['catalog-expansion-product-media-mobile.png', routes.productMedia, 390, 844, true],
      ['catalog-expansion-product-zero-media-desktop.png', routes.productZero, 1440, 1000, false],
      ['catalog-expansion-product-zero-media-mobile.png', routes.productZero, 390, 844, true]
    ]) {
      const [filename, route, width, height, mobile] = task;
      await setViewport(width, height, mobile);
      await navigate(route, 250);
      await warmLazyMedia();
      await saveFullPage(filename);
    }
  }

  progress('checking product fullscreen, arrows, focus trap, Escape, return focus and swipe');
  await setViewport(1440, 1000);
  await navigate(routes.productMedia, 220);
  report.productGallery.navigation = await evaluate(`(async () => {
    const status = document.querySelector('[data-v2-gallery-status]');
    const before = status.textContent.trim();
    document.querySelector('[data-v2-gallery-next]').click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterNext = status.textContent.trim();
    document.querySelector('[data-v2-gallery-prev]').click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { before, afterNext, afterPrevious: status.textContent.trim() };
  })()`);
  report.productGallery.open = await evaluate(`(async () => {
    const opener = document.querySelector('[data-v2-gallery-open]');
    opener.focus(); opener.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const dialog = document.querySelector('[data-v2-product-lightbox]');
    const close = dialog.querySelector('[data-v2-lightbox-close]');
    const items = Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
    const first = items[0], last = items.at(-1);
    const initialFocus = document.activeElement === close;
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    return { open: dialog.open, modal: dialog.matches(':modal'), initialFocus, focusWrapped: document.activeElement === first, fit: getComputedStyle(dialog.querySelector('[data-v2-lightbox-image]')).objectFit };
  })()`);
  if (captureExisting) await saveViewport('catalog-expansion-product-fullscreen.png');
  await pressKey('Escape');
  await delay(100);
  report.productGallery.closed = await evaluate(`({ open: document.querySelector('[data-v2-product-lightbox]').open, focusReturned: document.activeElement === document.querySelector('[data-v2-gallery-open]') })`);

  await setViewport(390, 844, true);
  await navigate(routes.productMedia, 180);
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

  progress('regression-checking existing project fullscreen gallery');
  await setViewport(1440, 1000);
  await navigate(routes.project, 220);
  report.projectGallery.navigation = await evaluate(`(async () => {
    const status = document.querySelector('[data-v2-project-gallery-status]');
    const before = status.textContent.trim();
    document.querySelector('[data-v2-project-gallery-next]').click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterNext = status.textContent.trim();
    document.querySelector('[data-v2-project-gallery-prev]').click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { before, afterNext, afterPrevious: status.textContent.trim() };
  })()`);
  report.projectGallery.open = await evaluate(`(async () => {
    const opener = document.querySelector('[data-v2-project-gallery-open]');
    opener.focus(); opener.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const dialog = document.querySelector('[data-v2-project-lightbox]');
    const close = dialog.querySelector('[data-v2-project-lightbox-close]');
    const items = Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
    const first = items[0], last = items.at(-1);
    const initialFocus = document.activeElement === close;
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    return { open: dialog.open, initialFocus, focusWrapped: document.activeElement === first, fit: getComputedStyle(dialog.querySelector('[data-v2-project-lightbox-image]')).objectFit };
  })()`);
  await pressKey('Escape');
  await delay(100);
  report.projectGallery.closed = await evaluate(`({ open: document.querySelector('[data-v2-project-lightbox]').open, focusReturned: document.activeElement === document.querySelector('[data-v2-project-gallery-open]') })`);
  await setViewport(390, 844, true);
  await navigate(routes.projectSwipe, 180);
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

  progress('checking practical pages, map, navigation and legal parity');
  await setViewport(1440, 1000);
  await navigate(routes.company, 220);
  await warmLazyMedia();
  report.practical.company = await evaluate(`(() => ({
    h1: document.querySelector('h1')?.textContent.trim(),
    heroImages: Array.from(document.querySelectorAll('.practical-company__hero-frame img')).map((image) => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight })),
    projectImages: Array.from(document.querySelectorAll('.practical-company__project-media img')).map((image) => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight, loading: image.loading })),
    projectCards: document.querySelectorAll('.practical-company__project-grid article').length
  }))()`);
  await navigate(routes.contacts, 250);
  const mapState = await waitForMap();
  report.practical.contacts = await evaluate(`(() => {
    const card = document.querySelector('.practical-contact-card--primary');
    const style = getComputedStyle(card);
    const rgb = (value) => value.match(/[\\d.]+/g).slice(0, 3).map(Number);
    const luminance = (value) => {
      const values = rgb(value).map((item) => { const c = item / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
      return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
    };
    const l1 = luminance(style.color), l2 = luminance(style.backgroundColor);
    return {
      pageHeight: document.documentElement.scrollHeight,
      sectionHeights: Object.fromEntries(Array.from(document.querySelectorAll('.practical-contacts > header, .practical-contacts > section')).map((section) => [section.className, Math.round(section.getBoundingClientRect().height)])),
      contactHrefs: Array.from(document.querySelectorAll('.practical-contact-card')).map((link) => link.getAttribute('href')),
      touchTargets: Array.from(document.querySelectorAll('.practical-contact-card')).map((link) => ({ width: Math.round(link.getBoundingClientRect().width), height: Math.round(link.getBoundingClientRect().height) })),
      primaryColor: style.color, primaryBackground: style.backgroundColor,
      contrast: (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05),
      geographyHeading: Array.from(document.querySelectorAll('h2, h3')).some((heading) => heading.textContent.includes('География работ')),
      mapScripts: Array.from(document.querySelectorAll('.practical-yandex-map script[src]')).map((script) => script.src),
      ratingFrames: document.querySelectorAll('.practical-contacts__rating').length
    };
  })()`);
  report.practical.contacts.map = mapState;
  report.practical.contacts.mapForCapture = mapForCapture;
  report.practical.contacts.fullSize = contactsFull;
  report.practical.company.fullSize = companyFull;

  await navigate(routes.vacancies, 180);
  report.practical.vacancies = await evaluate(`(() => ({
    cards: document.querySelectorAll('.practical-vacancy-card').length,
    headings: Array.from(document.querySelectorAll('h1, h2')).map((item) => item.textContent.trim()),
    cardTop: Math.round(document.querySelector('.practical-vacancy-card').getBoundingClientRect().top + scrollY),
    heroBottom: Math.round(document.querySelector('.practical-vacancies__hero').getBoundingClientRect().bottom + scrollY),
    pageHeight: document.documentElement.scrollHeight
  }))()`);
  await navigate(routes.vacancy, 180);
  report.practical.vacancy = await evaluate(`(() => ({
    heroHeight: Math.round(document.querySelector('.practical-vacancy__hero').getBoundingClientRect().height),
    contentTop: Math.round(document.querySelector('.practical-vacancy__content').getBoundingClientRect().top + scrollY),
    sections: Array.from(document.querySelectorAll('.practical-vacancy__content h2')).map((item) => item.textContent.trim()),
    contacts: Array.from(document.querySelectorAll('.practical-vacancy__channels a')).map((link) => link.getAttribute('href'))
  }))()`);
  await navigate(routes.legal, 180);
  const v2LegalText = await evaluate(`document.querySelector('.practical-legal__document').innerText.replace(/\\s+/g, ' ').trim()`);
  report.practical.legal = await evaluate(`(() => ({
    h1: document.querySelector('.practical-legal__document h1').textContent.trim(),
    h1Size: getComputedStyle(document.querySelector('.practical-legal__document h1')).fontSize,
    h1Width: Math.round(document.querySelector('.practical-legal__document h1').getBoundingClientRect().width),
    documentWidth: Math.round(document.querySelector('.practical-legal__document').getBoundingClientRect().width),
    headings: document.querySelectorAll('.practical-legal__document h1, .practical-legal__document h2, .practical-legal__document h3').length
  }))()`);
  await navigate('/politika-konfidencialnosti/', 150);
  const productionLegalText = await evaluate(`document.querySelector('.policy-page__container').innerText.replace(/\\s+/g, ' ').trim()`);
  report.practical.legal.sourceTextMatches = v2LegalText === productionLegalText;

  await navigate(routes.categoryFilled, 150);
  report.navigation.dropdown = await evaluate(`(async () => {
    const trigger = document.querySelector('[data-hv2-dropdown-trigger]');
    trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const first = trigger.closest('[data-hv2-dropdown]').querySelector('[data-hv2-dropdown-link]');
    const opened = trigger.getAttribute('aria-expanded') === 'true' && document.activeElement === first;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { opened, closed: trigger.getAttribute('aria-expanded') === 'false', focusReturned: document.activeElement === trigger };
  })()`);
  await setViewport(390, 844, true);
  await navigate(routes.categoryFilled, 160);
  report.navigation.mobile = await evaluate(`(async () => {
    const opener = document.querySelector('[data-hv2-mobile-open]');
    opener.focus(); opener.click(); await new Promise((resolve) => setTimeout(resolve, 340));
    const menu = document.querySelector('[data-hv2-mobile-menu]');
    const items = Array.from(menu.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((item) => !item.hidden);
    const first = items[0], last = items.at(-1);
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    return { visible: !menu.hidden, initialTrap: document.activeElement === first, bodyLocked: getComputedStyle(document.body).position === 'fixed', mainInert: document.querySelector('main').hasAttribute('inert') };
  })()`);
  await pressKey('Escape');
  await delay(340);
  report.navigation.mobile.closed = await evaluate(`document.querySelector('[data-hv2-mobile-menu]').hidden`);
  report.navigation.mobile.focusReturned = await evaluate(`document.activeElement === document.querySelector('[data-hv2-mobile-open]')`);

  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await navigate(routes.productMedia, 160);
  report.reducedMotion = await evaluate(`(() => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    pendingReveals: document.querySelectorAll('.hv2-reveal-pending').length,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    imageTransition: getComputedStyle(document.querySelector('[data-v2-gallery-main]')).transitionDuration
  }))()`);

  const catalogFailures = report.catalog.filter((item) => (
    item.h1Count !== 1 || !item.h1 || !item.robots.includes('noindex') || !item.robots.includes('nofollow') ||
    item.canonical.includes('/design-lab/') || item.duplicateIds.length || item.emptyHrefs || item.unlabeledButtons ||
    item.publicSku || item.oldCategoryLinks.length || item.oldProductLinks.length
  ));
  const allV2Failures = report.allV2.filter((item) => (
    item.h1Count !== 1 || !item.h1 || !item.robots.includes('noindex') || !item.robots.includes('nofollow') ||
    (item.route === routes.notFound ? Boolean(item.canonical) : (!item.canonical || item.canonical.includes('/design-lab/'))) ||
    item.duplicateIds.length || item.emptyHrefs || item.unlabeledButtons || item.publicSku ||
    item.oldCategoryLinks.length || item.oldProductLinks.length || item.brokenImages.length
  ));
  const representativeFailures = report.representative.filter((item) => item.overflow > 1 || item.horizontalOffenders.length || item.h1Count !== 1);
  const customOrderFailures = report.customOrder.filter((item) => item.overflow > 1 || item.horizontalOffenders.length || item.h1 !== 'Изготовление под задачу объекта');
  const notFoundFailures = report.notFound.filter((item) => item.overflow > 1 || item.horizontalOffenders.length || item.h1 !== 'Страница не найдена' || item.canonical);
  const regressionFailures = report.regression.filter((item) => item.overflow > 1 || item.horizontalOffenders.length || item.h1Count !== 1 || item.brokenImages.length);
  assert(report.counts.v2Routes === 108, `Expected 108 generated V2 routes, received ${report.counts.v2Routes}.`);
  assert(report.counts.catalogRoutes === 88, `Expected 88 generated catalog routes, received ${report.counts.catalogRoutes}.`);
  assert(report.http.every((item) => item.status === 200), `HTTP failures: ${JSON.stringify(report.http.filter((item) => item.status !== 200))}`);
  assert(allV2Failures.length === 0, `V2 render failures: ${JSON.stringify(allV2Failures)}`);
  assert(catalogFailures.length === 0, `Catalog render failures: ${JSON.stringify(catalogFailures)}`);
  assert(representativeFailures.length === 0, `Representative reflow failures: ${JSON.stringify(representativeFailures)}`);
  assert(customOrderFailures.length === 0, `Custom-order reflow failures: ${JSON.stringify(customOrderFailures)}`);
  assert(notFoundFailures.length === 0, `404 reflow failures: ${JSON.stringify(notFoundFailures)}`);
  assert(regressionFailures.length === 0, `Regression layout failures: ${JSON.stringify(regressionFailures)}`);
  assert(report.customOrderDetails.directions.length === 7 && report.customOrderDetails.directions.every((href) => href.startsWith('/design-lab/')), 'Custom-order direction links failed.');
  assert(report.customOrderDetails.changes === 7 && report.customOrderDetails.inputs === 6 && report.customOrderDetails.examples === 3 && report.customOrderDetails.contacts.length === 3 && report.customOrderDetails.contacts.every(Boolean), 'Custom-order content/contact structure failed.');
  assert(report.customOrderDetails.heroImages.length === 2 && report.customOrderDetails.heroImages.every((image) => image.src && !/^https?:/i.test(image.src)), 'Custom-order hero media failed.');
  assert(report.notFoundDetails.actions.length === 2 && report.notFoundDetails.contacts.length === 3 && [...report.notFoundDetails.actions, ...report.notFoundDetails.contacts].every(Boolean), '404 navigation/contact structure failed.');
  assert(runtimeErrors.length === 0, `Runtime errors: ${JSON.stringify(runtimeErrors)}`);
  assert(report.productGallery.navigation.before === '1 / 3' && report.productGallery.navigation.afterNext === '2 / 3' && report.productGallery.navigation.afterPrevious === '1 / 3', 'Product gallery arrows/counter failed.');
  assert(report.productGallery.open.open && report.productGallery.open.modal && report.productGallery.open.initialFocus && report.productGallery.open.focusWrapped && report.productGallery.open.fit === 'contain', 'Product fullscreen/focus/contain failed.');
  assert(!report.productGallery.closed.open && report.productGallery.closed.focusReturned, 'Product Escape/return focus failed.');
  assert(report.productGallery.swipe.before === '1 / 3' && report.productGallery.swipe.afterHorizontal === '2 / 3' && report.productGallery.swipe.afterVertical === '2 / 3', 'Product swipe failed.');
  assert(report.projectGallery.open.open && report.projectGallery.open.initialFocus && report.projectGallery.open.focusWrapped && report.projectGallery.open.fit === 'contain', 'Project gallery fullscreen regression.');
  assert(!report.projectGallery.closed.open && report.projectGallery.closed.focusReturned, 'Project gallery Escape/return focus regression.');
  assert(report.projectGallery.swipe.afterHorizontal !== report.projectGallery.swipe.before && report.projectGallery.swipe.afterVertical === report.projectGallery.swipe.afterHorizontal, 'Project gallery swipe regression.');
  assert(report.practical.company.h1 === 'Изделия, конструкции и работы под задачу объекта' && report.practical.company.heroImages.length === 2 && report.practical.company.projectImages.every((image) => image.width > 0), 'Company correction failed.');
  assert(report.practical.contacts.map && report.practical.contacts.map.title.includes('Яндекс Карта') && report.practical.contacts.contrast >= 4.5 && !report.practical.contacts.geographyHeading && report.practical.contacts.pageHeight <= 2350, 'Contacts map/contrast/layout failed.');
  assert(report.practical.contacts.contactHrefs.every(Boolean) && report.practical.contacts.touchTargets.every((item) => item.height >= 44), 'Contact link/touch target failed.');
  assert(report.practical.vacancies.cards === 1 && !report.practical.vacancies.headings.includes('Актуальные вакансии'), 'Vacancy archive correction failed.');
  assert(report.practical.vacancy.sections.join('|') === 'Обязанности|Требования|Условия' && report.practical.vacancy.contacts.length === 3, 'Vacancy detail content/contact regression.');
  assert(report.practical.legal.sourceTextMatches && Number.parseFloat(report.practical.legal.h1Size) <= 52, 'Legal typography/source parity failed.');
  assert(report.navigation.dropdown.opened && report.navigation.dropdown.closed && report.navigation.dropdown.focusReturned, 'Dropdown keyboard regression.');
  assert(report.navigation.mobile.visible && report.navigation.mobile.initialTrap && report.navigation.mobile.closed && report.navigation.mobile.focusReturned, 'Mobile menu focus regression.');
  assert(report.reducedMotion.matches && report.reducedMotion.pendingReveals === 0 && report.reducedMotion.scrollBehavior === 'auto', 'Reduced-motion regression.');

  await writeFile(path.join(outputDir, 'browser-pre-migration-v2-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    counts: report.counts,
    screenshots: report.screenshots,
    runtimeErrors: report.runtimeErrors.length,
    customOrderChecks: report.customOrder.length,
    notFoundChecks: report.notFound.length,
    regressionChecks: report.regression.length
  }, null, 2)}\n`);
  progress('all browser checks passed');
} finally {
  cdp?.close();
  browser.kill();
  await new Promise((resolve) => staticServer.close(resolve));
  await delay(500);
  const resolvedProfile = path.resolve(profileDir);
  if (resolvedProfile.startsWith(`${outputDir}${path.sep}`)) await rm(resolvedProfile, { recursive: true, force: true }).catch(() => {});
}

import { spawn } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import sharp from 'sharp';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin = process.env.DIRECTIONS_V2_ORIGIN || 'http://127.0.0.1:4322';
const outputDir = path.resolve('docs/design-lab/v2');
const distDir = path.resolve('dist');
const debugPort = 9900 + Math.floor(Math.random() * 80);
const profileDir = await mkdtemp(path.join(outputDir, '.directions-chrome-profile-'));
const canopiesRoute = '/design-lab/v2/navesy-i-kozyrki/';
const topiaryRoute = '/design-lab/v2/topiarii/';
const metalworksRoute = '/design-lab/v2/metallokonstruktsii-dlya-biznesa/';
const constructionRoute = '/design-lab/v2/stroitelstvo-i-remonty/';
const landscapingRoute = '/design-lab/v2/blagoustroystvo-territoriy/';
const requiredScreenshots = [
  'canopies-direction-desktop.png',
  'canopies-direction-mobile.png',
  'canopies-direction-full.png',
  'topiary-direction-desktop.png',
  'topiary-direction-mobile.png',
  'topiary-direction-full.png',
  'direction-gallery-fullscreen.png',
  'direction-mobile-footer.png',
  'metalworks-direction-desktop.png',
  'metalworks-direction-mobile.png',
  'metalworks-direction-full.png',
  'metalworks-direction-top.png',
  'metalworks-gallery-fullscreen.png',
  'metalworks-mobile-footer.png',
  'construction-direction-desktop.png',
  'construction-direction-mobile.png',
  'construction-direction-full.png',
  'construction-direction-top.png',
  'construction-proof.png',
  'construction-gallery-fullscreen.png',
  'construction-mobile-footer.png',
  'landscaping-direction-desktop.png',
  'landscaping-direction-mobile.png',
  'landscaping-direction-full.png',
  'landscaping-direction-top.png',
  'landscaping-proof.png',
  'landscaping-gallery-fullscreen.png',
  'landscaping-mobile-footer.png'
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const progress = (message) => process.stderr.write(`[directions-v2] ${message}\n`);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
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
    const headers = {
      'cache-control': 'no-store',
      'content-length': String(info.size),
      'content-type': mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream'
    };
    response.writeHead(200, headers);
    if (request.method === 'HEAD') response.end();
    else response.end(await readFile(filename));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error));
  }
});

await new Promise((resolve, reject) => {
  staticServer.once('error', reject);
  staticServer.listen(4322, '127.0.0.1', resolve);
});

await mkdir(outputDir, { recursive: true });
const browser = spawn(chromePath, [
  '--headless=new',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  '--window-size=1440,1000',
  'about:blank'
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
        const version = await response.json();
        if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
      }
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error('Chrome DevTools browser endpoint did not start.');
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
  throw new Error(`DevTools page endpoint did not appear for ${targetId}.`);
};

const browserCdp = new CdpClient(await waitForBrowser());
await browserCdp.connect();

const createPage = async ({ width, height, mobile = false, reducedMotion = false }) => {
  const { targetId } = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
  const page = new CdpClient(await waitForTargetSocket(targetId));
  await page.connect();
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
    positionX: 0,
    positionY: 0
  });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  if (reducedMotion) {
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
  }
  return { page, targetId };
};

const evaluate = async (page, expression) => {
  const result = await page.send('Runtime.evaluate', {
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

const navigate = async (page, route, warmMedia = false) => {
  const navigation = await page.send('Page.navigate', { url: `${origin}${route}?palette=olive` });
  if (navigation.errorText) throw new Error(`Navigation failed for ${route}: ${navigation.errorText}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    const ready = await evaluate(page, `document.readyState === 'complete' && location.pathname === ${JSON.stringify(route)}`).catch(() => false);
    if (ready) break;
    await delay(60);
  }
  assert(await evaluate(page, `document.readyState === 'complete' && location.pathname === ${JSON.stringify(route)}`), `Timed out waiting for ${route}.`);
  await evaluate(page, `(async () => {
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1800))]);
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    if (${warmMedia}) {
      document.querySelectorAll('img[loading="lazy"]').forEach((image) => { image.loading = 'eager'; });
      for (let y = 0; y < document.documentElement.scrollHeight; y += 680) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 28));
      }
      window.scrollTo(0, 0);
      await Promise.race([
        Promise.all(Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }))),
        new Promise((resolve) => setTimeout(resolve, 6500))
      ]);
      document.querySelectorAll('[data-v2-reveal]').forEach((element) => {
        element.classList.remove('hv2-reveal-pending');
        element.classList.add('hv2-reveal-visible');
      });
      await new Promise((resolve) => setTimeout(resolve, 1550));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  await delay(180);
};

const withPage = async (options, callback) => {
  const { page, targetId } = await createPage(options);
  const consoleErrors = [];
  page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    consoleErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception');
  });
  page.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') consoleErrors.push(args?.map((item) => item.value || item.description).filter(Boolean).join(' '));
  });
  try {
    const value = await callback(page, consoleErrors);
    assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    return value;
  } finally {
    page.close();
    await browserCdp.send('Target.closeTarget', { targetId }).catch(() => {});
    await delay(70);
  }
};

const pressKey = async (page, key, code = key) => {
  const virtualKeys = { Escape: 27, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
  const windowsVirtualKeyCode = virtualKeys[key] || 0;
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
};

const saveViewport = async (page, filename) => {
  const result = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(path.join(outputDir, filename), Buffer.from(result.data, 'base64'));
};

const saveFullPage = async (page, filename) => {
  const metrics = await page.send('Page.getLayoutMetrics');
  const size = metrics.cssContentSize || metrics.contentSize;
  const width = Math.ceil(size.width);
  const height = Math.ceil(size.height);
  assert(width >= 320 && height >= 280 && height <= 20000, `Invalid full-page metrics for ${filename}: ${width}x${height}.`);
  await evaluate(page, `(async () => {
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  await delay(250);
  const segmentHeight = 1200;
  const segments = [];
  for (let y = 0; y < height; y += segmentHeight) {
    const tileHeight = Math.min(segmentHeight, height - y);
    const result = await page.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      optimizeForSpeed: true,
      clip: { x: 0, y, width, height: tileHeight, scale: 1 }
    });
    segments.push({ input: Buffer.from(result.data, 'base64'), left: 0, top: y });
  }
  await sharp({
    create: { width, height, channels: 4, background: '#f3f5f1' }
  })
    .composite(segments)
    .png({ compressionLevel: 8 })
    .toFile(path.join(outputDir, filename));
};

const captureTasks = [
  { filename: 'metalworks-direction-desktop.png', route: metalworksRoute, width: 1440, height: 1100 },
  { filename: 'metalworks-direction-mobile.png', route: metalworksRoute, width: 390, height: 844, mobile: true },
  { filename: 'metalworks-direction-full.png', route: metalworksRoute, width: 1440, height: 900, full: true, warm: true },
  { filename: 'metalworks-direction-top.png', route: metalworksRoute, width: 1440, height: 760 },
  { filename: 'construction-direction-desktop.png', route: constructionRoute, width: 1440, height: 1000 },
  { filename: 'construction-direction-mobile.png', route: constructionRoute, width: 390, height: 844, mobile: true },
  { filename: 'construction-direction-full.png', route: constructionRoute, width: 1440, height: 900, full: true, warm: true },
  { filename: 'construction-direction-top.png', route: constructionRoute, width: 1440, height: 760 },
  { filename: 'landscaping-direction-desktop.png', route: landscapingRoute, width: 1440, height: 1000 },
  { filename: 'landscaping-direction-mobile.png', route: landscapingRoute, width: 390, height: 844, mobile: true },
  { filename: 'landscaping-direction-full.png', route: landscapingRoute, width: 1440, height: 900, full: true, warm: true },
  { filename: 'landscaping-direction-top.png', route: landscapingRoute, width: 1440, height: 760 }
];

const diagnostics = async (page) => evaluate(page, `(() => {
  const root = document.documentElement;
  const ids = Array.from(document.querySelectorAll('[id]')).map((item) => item.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const unlabeledButtons = Array.from(document.querySelectorAll('button')).filter((button) => {
    const text = (button.textContent || '').trim();
    return !text && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby');
  }).length;
  const brokenImages = Array.from(document.images)
    .filter((image) => Boolean(image.currentSrc) && image.complete && image.naturalWidth === 0)
    .map((image) => image.currentSrc);
  const landscapingH1 = document.querySelector('.place-hero h1');
  const firstWord = landscapingH1?.firstChild;
  let landscapingFirstWordLines = 0;
  if (firstWord?.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    range.setStart(firstWord, 0);
    range.setEnd(firstWord, Math.min('Благоустройство'.length, firstWord.textContent?.length || 0));
    landscapingFirstWordLines = range.getClientRects().length;
  }
  return {
    path: location.pathname,
    overflow: root.scrollWidth - root.clientWidth,
    duplicates: Array.from(new Set(duplicates)),
    unlabeledButtons,
    brokenImages,
    noindex: document.querySelector('meta[name="robots"]')?.content === 'noindex, nofollow',
    h1: document.querySelectorAll('h1').length,
    footerAccordions: document.querySelectorAll('[data-v2-footer-accordion]').length,
    footerContacts: document.querySelectorAll('.hv2-footer__contacts a').length,
    landscapingFirstWordLines,
    landscapingH1Top: landscapingH1?.getBoundingClientRect().top ?? -1
  };
})()`);

try {
  progress('capturing required screenshots with one browser and one loaded page at a time');
  for (const task of captureTasks) {
    await withPage({ width: task.width, height: task.height, mobile: Boolean(task.mobile) }, async (page) => {
      await navigate(page, task.route, Boolean(task.warm));
      if (task.full) {
        await saveFullPage(page, task.filename);
      } else {
        await delay(120);
        await evaluate(page, `(async () => {
          window.scrollTo(0, 0);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
        await delay(180);
        await saveViewport(page, task.filename);
      }
    });
    progress(`saved ${task.filename}`);
  }

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, canopiesRoute, true);
    await evaluate(page, `document.querySelector('[data-v2-gallery-open]')?.click()`);
    await delay(180);
    assert(await evaluate(page, `document.querySelector('[data-v2-product-lightbox]')?.open === true`), 'Direction gallery did not open.');
    await saveViewport(page, 'direction-gallery-fullscreen.png');
  });
  progress('saved direction-gallery-fullscreen.png');

  await withPage({ width: 390, height: 844, mobile: true }, async (page) => {
    await navigate(page, topiaryRoute, true);
    await evaluate(page, `window.scrollTo(0, document.documentElement.scrollHeight)`);
    await delay(160);
    await saveViewport(page, 'direction-mobile-footer.png');
  });
  progress('saved direction-mobile-footer.png');

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, metalworksRoute, true);
    await evaluate(page, `document.querySelector('[data-v2-gallery-open]')?.click()`);
    await delay(180);
    assert(await evaluate(page, `document.querySelector('[data-v2-product-lightbox]')?.open === true`), 'Metalworks gallery did not open.');
    await saveViewport(page, 'metalworks-gallery-fullscreen.png');
  });
  progress('saved metalworks-gallery-fullscreen.png');

  await withPage({ width: 390, height: 844, mobile: true }, async (page) => {
    await navigate(page, metalworksRoute, true);
    await evaluate(page, `window.scrollTo(0, document.documentElement.scrollHeight)`);
    await delay(160);
    await saveViewport(page, 'metalworks-mobile-footer.png');
  });
  progress('saved metalworks-mobile-footer.png');

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, constructionRoute, true);
    await evaluate(page, `(() => {
      const section = document.querySelector('#construction-proof');
      const header = document.querySelector('[data-home-v2-header]');
      const palette = document.querySelector('.v2-palette-switch');
      if (header) header.style.display = 'none';
      if (palette) palette.style.display = 'none';
      document.documentElement.style.scrollBehavior = 'auto';
      if (section) window.scrollTo({ top: section.offsetTop, behavior: 'auto' });
    })()`);
    await delay(260);
    await saveViewport(page, 'construction-proof.png');
  });
  progress('saved construction-proof.png');

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, constructionRoute, true);
    await evaluate(page, `document.querySelector('.project-proof [data-v2-gallery-open]')?.click()`);
    await delay(180);
    assert(await evaluate(page, `document.querySelector('[data-v2-product-lightbox]')?.open === true`), 'Construction gallery did not open.');
    await saveViewport(page, 'construction-gallery-fullscreen.png');
  });
  progress('saved construction-gallery-fullscreen.png');

  await withPage({ width: 390, height: 844, mobile: true }, async (page) => {
    await navigate(page, constructionRoute, true);
    await evaluate(page, `window.scrollTo(0, document.documentElement.scrollHeight)`);
    await delay(160);
    await saveViewport(page, 'construction-mobile-footer.png');
  });
  progress('saved construction-mobile-footer.png');

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, landscapingRoute, true);
    await evaluate(page, `(() => {
      const section = document.querySelector('#landscaping-proof');
      const header = document.querySelector('[data-home-v2-header]');
      const palette = document.querySelector('.v2-palette-switch');
      if (header) header.style.display = 'none';
      if (palette) palette.style.display = 'none';
      document.documentElement.style.scrollBehavior = 'auto';
      if (section) window.scrollTo({ top: section.offsetTop, behavior: 'auto' });
    })()`);
    await delay(260);
    await saveViewport(page, 'landscaping-proof.png');
  });
  progress('saved landscaping-proof.png');

  await withPage({ width: 1440, height: 1000 }, async (page) => {
    await navigate(page, landscapingRoute, true);
    await evaluate(page, `document.querySelector('.place-projects [data-v2-gallery-open]')?.click()`);
    await delay(180);
    assert(await evaluate(page, `document.querySelector('[data-v2-product-lightbox]')?.open === true`), 'Landscaping gallery did not open.');
    await saveViewport(page, 'landscaping-gallery-fullscreen.png');
  });
  progress('saved landscaping-gallery-fullscreen.png');

  await withPage({ width: 390, height: 844, mobile: true }, async (page) => {
    await navigate(page, landscapingRoute, true);
    await evaluate(page, `window.scrollTo(0, document.documentElement.scrollHeight)`);
    await delay(160);
    await saveViewport(page, 'landscaping-mobile-footer.png');
  });
  progress('saved landscaping-mobile-footer.png');

  progress('running responsive and regression diagnostics');
  const matrix = [
    ...[1440, 1024, 768, 720, 390, 320].flatMap((width) => [
      { route: canopiesRoute, width },
      { route: topiaryRoute, width },
      { route: metalworksRoute, width },
      { route: constructionRoute, width },
      { route: landscapingRoute, width }
    ]),
    { route: '/design-lab/home-v2/', width: 1440 },
    { route: '/design-lab/home-v2/', width: 390 },
    { route: '/design-lab/v2/ulichnaya-mebel/', width: 1440 },
    { route: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/', width: 390 },
    { route: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/bolshaya-skameyka-amplituda/', width: 1440 },
    { route: '/design-lab/v2/ograzhdeniya-i-zabory/', width: 1440 },
    { route: '/design-lab/v2/ograzhdeniya-i-zabory/dekorativnye-ograzhdeniya/', width: 390 },
    { route: '/design-lab/v2/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-duo/', width: 390 }
  ];
  for (const item of matrix) {
    await withPage({ width: item.width, height: item.width <= 390 ? 844 : 900, mobile: item.width <= 390 }, async (page) => {
      await navigate(page, item.route, false);
      const result = await diagnostics(page);
      assert(result.overflow <= 1, `Horizontal overflow ${result.overflow}px at ${item.width}px on ${item.route}.`);
      assert(result.duplicates.length === 0, `Duplicate IDs on ${item.route}: ${result.duplicates.join(', ')}`);
      assert(result.unlabeledButtons === 0, `Unlabeled buttons on ${item.route}.`);
      assert(result.brokenImages.length === 0, `Broken images on ${item.route}: ${result.brokenImages.join(', ')}`);
      assert(result.noindex, `Noindex is missing on ${item.route}.`);
      assert(result.h1 === 1, `Expected one H1 on ${item.route}, got ${result.h1}.`);
      if (item.route.includes('/design-lab/v2/')) {
        assert(result.footerAccordions === 2, `Mobile footer accordions missing on ${item.route}.`);
        assert(result.footerContacts >= 5, `Footer contacts incomplete on ${item.route}.`);
      }
      if (item.route === landscapingRoute) {
        assert(result.landscapingFirstWordLines === 1, `Landscaping H1 breaks inside its first word at ${item.width}px.`);
        assert(result.landscapingH1Top >= 0 && result.landscapingH1Top < (item.width <= 390 ? 844 : 900), `Landscaping H1 is outside the first viewport at ${item.width}px.`);
      }
    });
  }

  progress('checking factual media, CTA, links and composition');
  for (const route of [canopiesRoute, topiaryRoute, metalworksRoute, constructionRoute, landscapingRoute]) {
    await withPage({ width: 1440, height: 900 }, async (page) => {
      await navigate(page, route, false);
      const result = await evaluate(page, `(async () => {
        const main = document.querySelector('main');
        const text = main?.innerText || '';
        const local = Array.from(document.querySelectorAll('a[href]'))
          .map((link) => link.href)
          .filter((href) => href.startsWith(location.origin));
        const urls = Array.from(new Set(local.map((href) => href.split('#')[0]).filter(Boolean)));
        const responses = await Promise.all(urls.map(async (url) => {
          try { const response = await fetch(url, { method: 'HEAD' }); return { url, status: response.status }; }
          catch { return { url, status: 0 }; }
        }));
        return {
          primary: Array.from(main?.querySelectorAll('a') || []).filter((link) => link.textContent?.includes('Получить расчёт')).length,
          secondary: Array.from(main?.querySelectorAll('a') || []).filter((link) => link.textContent?.includes('Обсудить')).length,
          channels: {
            phone: Boolean(main?.querySelector('a[href^="tel:"]')),
            telegram: Boolean(main?.querySelector('a[href*="t.me"]')),
            email: Boolean(main?.querySelector('a[href^="mailto:"]'))
          },
          badLinks: responses.filter((item) => item.status < 200 || item.status >= 400),
          forbiddenCopy: /снегов|ветров|сечени|фундамент|толщин|гаранти|срок изготовления|тип кровли|способ крепления|мощност|марки? стали|способ сварки|кмд|нагрузк|техническ(?:ий|ая|ие) уз/iu.test(text),
          internalCopy: /инженерно-визуальн|визуальное направление|гибридное направление|вариант композиции|тип страницы|инженерное направление|инженерно-коммерческ|проектный шаблон/iu.test(text),
          internalProductionCopy: /собственн(?:ый|ого|ое|ая) (?:цех|производств)|станк|оборудование (?:цеха|производства)|сотрудники производства|внутренние мощности/iu.test(text),
          galleryCount: main?.querySelectorAll('[data-v2-product-gallery]').length || 0,
          sectionNames: Array.from(main?.querySelectorAll('section h2') || []).map((item) => item.textContent?.trim()),
          uploadImages: Array.from(new Set(Array.from(main?.querySelectorAll('img[src*="/uploads/"]') || []).map((item) => item.getAttribute('src')))),
          h1: main?.querySelector('h1')?.textContent?.trim() || '',
          activeMetal: Boolean(document.querySelector('.hv2-header__nav-link[aria-current="page"]')?.textContent?.includes('Металлоконструкции')),
          activeConstruction: Boolean(document.querySelector('.hv2-header__nav-link[aria-current="page"]')?.textContent?.includes('Строительство')),
          activeLandscaping: Boolean(document.querySelector('.hv2-header__nav-link[aria-current="page"]')?.textContent?.includes('Благоустройство')),
          projectLinks: Array.from(main?.querySelectorAll('a[href*="/vypolnennye-obekty/"]') || []).map((link) => link.getAttribute('href')),
          placeholderImages: Array.from(main?.querySelectorAll('img[src*="/placeholders/"]') || []).map((item) => item.getAttribute('src')),
          correctionCopy: {
            canopiesTypes: text.includes('Какие навесы и козырьки делаем'),
            canopiesCta: text.includes('Обсудим навес или козырёк для вашего объекта'),
            canopiesCatalog: text.includes('Навесы в каталоге'),
            topiaryCompact: Boolean(main?.querySelector('.direction-related--compact')),
            topiaryRelatedTitle: text.includes('Топиарии в благоустройстве'),
            topiaryRelatedHeight: Math.round(main?.querySelector('.direction-related--compact')?.getBoundingClientRect().height || 0),
            metalHero: text.includes('конкретную металлоконструкцию или металлическую часть объекта'),
            metalRelated: text.includes('Смежные направления'),
            metalCta: text.includes('Обсудим металлоконструкции для вашего объекта'),
            metalProof: text.includes('открытый каркас и его элементы'),
            constructionHeroSingle: document.querySelectorAll('.project-hero__figure').length === 1,
            constructionOldDisclaimer: text.includes('Каждый пример подтверждает только факты, опубликованные'),
            landscapingHero: text.includes('от отдельных элементов до цельного результата'),
            landscapingTechnical: /водоотвед|дренаж|инженерн(?:ые|ых) сет|дорожн(?:ый|ого) пирог|подготовк(?:а|и) грунт|техническ(?:ий|ие|их) сло|уклон|толщин|норматив/iu.test(text)
          },
          canonical: document.querySelector('link[rel="canonical"]')?.href || ''
        };
      })()`);
      assert(result.primary >= 2 && result.secondary >= 2, `CTA system incomplete on ${route}.`);
      assert(result.channels.phone && result.channels.telegram && result.channels.email, `Direct contacts incomplete on ${route}.`);
      assert(result.badLinks.length === 0, `Broken local links on ${route}: ${JSON.stringify(result.badLinks)}`);
      assert(!result.forbiddenCopy, `Unapproved technical copy found on ${route}.`);
      assert(!result.internalCopy, `Internal design terminology found on ${route}.`);
      assert(!result.internalProductionCopy, `Internal production copy found on ${route}.`);
      const expectedCanonical = route === canopiesRoute
        ? '/navesy-i-kozyrki/'
        : route === topiaryRoute
          ? '/topiarii/'
          : route === metalworksRoute
            ? '/metallokonstruktsii-dlya-biznesa/'
            : route === constructionRoute
              ? '/stroitelstvo-i-remonty/'
              : '/blagoustroystvo-territoriy/';
      assert(result.canonical.endsWith(expectedCanonical), `Canonical mismatch on ${route}.`);
      if (route === canopiesRoute) {
        assert(result.h1.includes('Навесы и козырьки'), 'Canopies H1 does not cover both canopies and entrance canopies.');
        assert(result.sectionNames.includes('Примеры навесов и козырьков'), 'Canopies full positioning was not preserved below the hero.');
        assert(result.correctionCopy.canopiesTypes && result.correctionCopy.canopiesCta && result.correctionCopy.canopiesCatalog, 'Second canopies correction pass is incomplete.');
        assert(result.galleryCount === 1, 'Canopies factual gallery is missing.');
        assert(!result.uploadImages.some((src) => src.includes('2026-03-08-221112')), 'Unrelated section media leaked into canopies V2.');
      } else if (route === topiaryRoute) {
        assert(result.galleryCount === 0, 'Topiary must not have an artificial gallery.');
        assert(result.uploadImages.filter((src) => src.includes('chatgpt-image-5-2026')).length === 1, 'Topiary unique media is repeated.');
        assert(result.correctionCopy.topiaryCompact && result.correctionCopy.topiaryRelatedTitle && result.correctionCopy.topiaryRelatedHeight > 0 && result.correctionCopy.topiaryRelatedHeight < 520, 'Topiary related block is not compact.');
      } else if (route === metalworksRoute) {
        const allowed = [
          'img-20250724-134010-1783272745899.jpg',
          'img-20231013-135454-1783272745548.jpg',
          'img-20231102-142552-1783272745634.jpg',
          'img-20231223-222338-1783272745821.jpg',
          'img-20231227-171915-1783272745842.jpg'
        ];
        assert(result.galleryCount === 1, 'Metalworks proof gallery is missing.');
        assert(result.uploadImages.length === allowed.length && result.uploadImages.every((src) => allowed.some((name) => src.includes(name))), 'Metalworks media selection contains an unapproved image.');
        assert(result.activeMetal, 'Metalworks header item is not active.');
        assert(result.projectLinks.some((href) => href?.includes('/kompleks-rabot-na-proizvodstvennoy-territorii/')), 'Confirmed industrial project link is missing.');
        assert(result.correctionCopy.metalHero && result.correctionCopy.metalRelated && result.correctionCopy.metalCta && result.correctionCopy.metalProof, 'Metalworks copy/proof correction is incomplete.');
        assert(result.sectionNames[0] === 'Для каких объектов' && result.sectionNames[1] === 'Что изготавливаем', 'Metalworks composition order regressed.');
      } else if (route === constructionRoute) {
        const allowed = [
          'img-20250724-133811-1783272616313.jpg',
          'img-20250724-134235-1783272745917.jpg',
          'img-20250724-134355-1783272745972.jpg'
        ];
        const projectSlugs = [
          'kompleks-rabot-na-proizvodstvennoy-territorii',
          'remont-skvera-na-ulitse-gogolya'
        ];
        assert(result.h1 === 'Строительные и ремонтные работы', 'Construction H1 is not the approved natural wording.');
        assert(result.galleryCount === 1, 'Construction factual gallery is missing.');
        assert(result.uploadImages.length === allowed.length && result.uploadImages.every((src) => allowed.some((name) => src.includes(name))), 'Construction media selection contains an unapproved image.');
        assert(result.activeConstruction, 'Construction header item is not active.');
        assert(projectSlugs.every((slug) => result.projectLinks.some((href) => href?.includes(`/${slug}/`))), 'A confirmed construction project link is missing.');
        assert(!result.projectLinks.some((href) => href?.includes('/blagoustroystvo-naberezhnoy-reki-tobol/')), 'Landscaping project leaked into construction proof.');
        assert(result.correctionCopy.constructionHeroSingle, 'Construction hero must use one finished-result image.');
        assert(!result.correctionCopy.constructionOldDisclaimer, 'Internal project-record disclaimer is still public.');
        const proofIndex = result.sectionNames.indexOf('Результат на реальных объектах');
        const scopeIndex = result.sectionNames.indexOf('Что делаем');
        const contextIndex = result.sectionNames.indexOf('Для каких объектов');
        assert(proofIndex > 0 && proofIndex < scopeIndex && scopeIndex < contextIndex, 'Construction project composition order regressed.');
      } else {
        const allowed = [
          'project-248f17177df30b29ab9b231a.jpg',
          'project-da0872c68d9a09f0a7d2f995.jpg'
        ];
        const projectSlugs = [
          'blagoustroystvo-naberezhnoy-reki-tobol',
          'remont-skvera-na-ulitse-gogolya'
        ];
        assert(result.h1 === 'Благоустройство территорий', 'Landscaping H1 is not the approved natural wording.');
        assert(result.galleryCount === 1, 'Landscaping factual gallery is missing.');
        assert(result.uploadImages.length === allowed.length && result.uploadImages.every((src) => allowed.some((name) => src.includes(name))), 'Landscaping media selection contains an unapproved image.');
        assert(result.placeholderImages.length === 0, 'A placeholder leaked into landscaping V2.');
        assert(result.activeLandscaping, 'Landscaping header item is not active.');
        assert(projectSlugs.every((slug) => result.projectLinks.some((href) => href?.includes(`/${slug}/`))), 'A confirmed landscaping project link is missing.');
        assert(result.correctionCopy.landscapingHero, 'Landscaping result positioning is missing.');
        assert(!result.correctionCopy.landscapingTechnical, 'Unapproved landscaping technical detail is public.');
        assert(result.sectionNames.indexOf('Что делаем') < result.sectionNames.indexOf('Для каких объектов'), 'Landscaping scope/context order regressed.');
        assert(result.sectionNames.indexOf('Для каких объектов') < result.sectionNames.indexOf('Результат в масштабе территории'), 'Landscaping proof order regressed.');
      }
    });
  }

  progress('checking Header, MobileMenu, gallery and footer interactions');
  await withPage({ width: 1440, height: 900 }, async (page) => {
    await navigate(page, canopiesRoute, false);
    await evaluate(page, `document.querySelector('[data-hv2-dropdown-trigger]')?.focus()`);
    await pressKey(page, 'ArrowDown', 'ArrowDown');
    const opened = await evaluate(page, `(() => {
      const trigger = document.querySelector('[data-hv2-dropdown-trigger]');
      return trigger?.getAttribute('aria-expanded') === 'true' && Boolean(document.activeElement?.matches('[data-hv2-dropdown-link]'));
    })()`);
    assert(opened, 'Desktop dropdown did not open from keyboard.');
    await pressKey(page, 'Escape', 'Escape');
    assert(await evaluate(page, `document.querySelector('[data-hv2-dropdown-trigger]')?.getAttribute('aria-expanded') === 'false'`), 'Desktop dropdown did not close with Escape.');

    await evaluate(page, `document.querySelector('[data-v2-gallery-open]')?.focus(); document.querySelector('[data-v2-gallery-open]')?.click()`);
    await delay(100);
    const initial = await evaluate(page, `document.querySelector('[data-v2-lightbox-status]')?.textContent?.trim()`);
    await pressKey(page, 'ArrowRight', 'ArrowRight');
    const next = await evaluate(page, `document.querySelector('[data-v2-lightbox-status]')?.textContent?.trim()`);
    assert(initial !== next, 'Gallery ArrowRight did not change the image.');
    await evaluate(page, `(() => { const dialog = document.querySelector('[data-v2-product-lightbox]'); const items = dialog?.querySelectorAll('button'); items?.[items.length - 1]?.focus(); })()`);
    await pressKey(page, 'Tab', 'Tab');
    assert(await evaluate(page, `Boolean(document.activeElement?.closest('[data-v2-product-lightbox]'))`), 'Gallery focus escaped the dialog.');
    await pressKey(page, 'Escape', 'Escape');
    await delay(80);
    assert(await evaluate(page, `document.querySelector('[data-v2-product-lightbox]')?.open === false && document.activeElement?.matches('[data-v2-gallery-open]')`), 'Gallery Escape/return focus failed.');

    const beforeSwipe = await evaluate(page, `document.querySelector('[data-v2-gallery-status]')?.textContent?.trim()`);
    await evaluate(page, `(() => {
      const stage = document.querySelector('.v2-product-gallery__stage');
      stage?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: 220, clientY: 180 }));
      stage?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: 90, clientY: 184 }));
    })()`);
    const afterSwipe = await evaluate(page, `document.querySelector('[data-v2-gallery-status]')?.textContent?.trim()`);
    assert(beforeSwipe !== afterSwipe, 'Gallery swipe did not change the image.');

    await evaluate(page, `(async () => {
      const image = document.querySelector('.direction-hero__media img');
      if (!image) return;
      image.src = '/__direction-broken-media-test__.png';
      await new Promise((resolve) => image.addEventListener('error', resolve, { once: true }));
    })()`);
    assert(await evaluate(page, `document.querySelector('.direction-hero__media')?.classList.contains('is-broken')`), 'Broken direction media fallback did not activate.');
  });

  await withPage({ width: 1440, height: 900 }, async (page) => {
    await navigate(page, metalworksRoute, false);
    await evaluate(page, `document.querySelector('[data-v2-gallery-open]')?.focus(); document.querySelector('[data-v2-gallery-open]')?.click()`);
    await delay(100);
    const initial = await evaluate(page, `document.querySelector('[data-v2-lightbox-status]')?.textContent?.trim()`);
    await pressKey(page, 'ArrowRight', 'ArrowRight');
    const next = await evaluate(page, `document.querySelector('[data-v2-lightbox-status]')?.textContent?.trim()`);
    assert(initial !== next, 'Metalworks gallery ArrowRight did not change the image.');
    await evaluate(page, `(() => { const dialog = document.querySelector('[data-v2-product-lightbox]'); const items = dialog?.querySelectorAll('button'); items?.[items.length - 1]?.focus(); })()`);
    await pressKey(page, 'Tab', 'Tab');
    assert(await evaluate(page, `Boolean(document.activeElement?.closest('[data-v2-product-lightbox]'))`), 'Metalworks gallery focus escaped the dialog.');
    await pressKey(page, 'Escape', 'Escape');
    await delay(80);
    assert(await evaluate(page, `document.querySelector('[data-v2-product-lightbox]')?.open === false && document.activeElement?.matches('[data-v2-gallery-open]')`), 'Metalworks gallery Escape/return focus failed.');

    const beforeSwipe = await evaluate(page, `document.querySelector('[data-v2-gallery-status]')?.textContent?.trim()`);
    await evaluate(page, `(() => {
      const stage = document.querySelector('.engineering-proof .v2-product-gallery__stage');
      stage?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: 240, clientY: 180 }));
      stage?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: 90, clientY: 184 }));
    })()`);
    const afterSwipe = await evaluate(page, `document.querySelector('[data-v2-gallery-status]')?.textContent?.trim()`);
    assert(beforeSwipe !== afterSwipe, 'Metalworks gallery swipe did not change the image.');

    await evaluate(page, `(async () => {
      const image = document.querySelector('.engineering-hero__media img');
      if (!image) return;
      image.src = '/__engineering-broken-media-test__.png';
      await new Promise((resolve) => image.addEventListener('error', resolve, { once: true }));
    })()`);
    assert(await evaluate(page, `document.querySelector('.engineering-hero__media')?.classList.contains('is-broken')`), 'Broken engineering hero fallback did not activate.');
  });

  await withPage({ width: 1440, height: 900 }, async (page) => {
    await navigate(page, constructionRoute, false);
    await evaluate(page, `document.querySelector('.project-proof [data-v2-gallery-open]')?.focus(); document.querySelector('.project-proof [data-v2-gallery-open]')?.click()`);
    await delay(100);
    const initial = await evaluate(page, `document.querySelector('[data-v2-lightbox-status]')?.textContent?.trim()`);
    await pressKey(page, 'ArrowRight', 'ArrowRight');
    const next = await evaluate(page, `document.querySelector('[data-v2-lightbox-status]')?.textContent?.trim()`);
    assert(initial !== next, 'Construction gallery ArrowRight did not change the image.');
    await evaluate(page, `(() => { const dialog = document.querySelector('[data-v2-product-lightbox]'); const items = dialog?.querySelectorAll('button'); items?.[items.length - 1]?.focus(); })()`);
    await pressKey(page, 'Tab', 'Tab');
    assert(await evaluate(page, `Boolean(document.activeElement?.closest('[data-v2-product-lightbox]'))`), 'Construction gallery focus escaped the dialog.');
    await pressKey(page, 'Escape', 'Escape');
    await delay(80);
    assert(await evaluate(page, `document.querySelector('[data-v2-product-lightbox]')?.open === false && document.activeElement?.matches('.project-proof [data-v2-gallery-open]')`), 'Construction gallery Escape/return focus failed.');

    const beforeSwipe = await evaluate(page, `document.querySelector('.project-proof [data-v2-gallery-status]')?.textContent?.trim()`);
    await evaluate(page, `(() => {
      const stage = document.querySelector('.project-proof .v2-product-gallery__stage');
      stage?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, pointerType: 'touch', clientX: 240, clientY: 180 }));
      stage?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11, pointerType: 'touch', clientX: 90, clientY: 184 }));
    })()`);
    const afterSwipe = await evaluate(page, `document.querySelector('.project-proof [data-v2-gallery-status]')?.textContent?.trim()`);
    assert(beforeSwipe !== afterSwipe, 'Construction gallery swipe did not change the image.');

    await evaluate(page, `(async () => {
      const image = document.querySelector('.project-hero__figure img');
      if (!image) return;
      image.src = '/__project-broken-media-test__.png';
      await new Promise((resolve) => image.addEventListener('error', resolve, { once: true }));
    })()`);
    assert(await evaluate(page, `document.querySelector('.project-hero__figure')?.classList.contains('is-broken')`), 'Broken construction hero fallback did not activate.');
  });

  await withPage({ width: 1440, height: 900 }, async (page) => {
    await navigate(page, landscapingRoute, false);
    await evaluate(page, `document.querySelector('.place-projects [data-v2-gallery-open]')?.focus(); document.querySelector('.place-projects [data-v2-gallery-open]')?.click()`);
    await delay(100);
    const initial = await evaluate(page, `document.querySelector('[data-v2-lightbox-status]')?.textContent?.trim()`);
    await pressKey(page, 'ArrowRight', 'ArrowRight');
    const next = await evaluate(page, `document.querySelector('[data-v2-lightbox-status]')?.textContent?.trim()`);
    assert(initial !== next, 'Landscaping gallery ArrowRight did not change the image.');
    await evaluate(page, `(() => { const dialog = document.querySelector('[data-v2-product-lightbox]'); const items = dialog?.querySelectorAll('button'); items?.[items.length - 1]?.focus(); })()`);
    await pressKey(page, 'Tab', 'Tab');
    assert(await evaluate(page, `Boolean(document.activeElement?.closest('[data-v2-product-lightbox]'))`), 'Landscaping gallery focus escaped the dialog.');
    await pressKey(page, 'Escape', 'Escape');
    await delay(80);
    assert(await evaluate(page, `document.querySelector('[data-v2-product-lightbox]')?.open === false && document.activeElement?.matches('.place-projects [data-v2-gallery-open]')`), 'Landscaping gallery Escape/return focus failed.');

    const beforeSwipe = await evaluate(page, `document.querySelector('.place-projects [data-v2-gallery-status]')?.textContent?.trim()`);
    await evaluate(page, `(() => {
      const stage = document.querySelector('.place-projects .v2-product-gallery__stage');
      stage?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 13, pointerType: 'touch', clientX: 240, clientY: 180 }));
      stage?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 13, pointerType: 'touch', clientX: 90, clientY: 184 }));
    })()`);
    const afterSwipe = await evaluate(page, `document.querySelector('.place-projects [data-v2-gallery-status]')?.textContent?.trim()`);
    assert(beforeSwipe !== afterSwipe, 'Landscaping gallery swipe did not change the image.');

    await evaluate(page, `(async () => {
      const image = document.querySelector('.place-hero__media img');
      if (!image) return;
      image.src = '/__place-broken-media-test__.png';
      await new Promise((resolve) => image.addEventListener('error', resolve, { once: true }));
    })()`);
    assert(await evaluate(page, `document.querySelector('.place-hero__media')?.classList.contains('is-broken')`), 'Broken landscaping hero fallback did not activate.');
  });

  await withPage({ width: 390, height: 844, mobile: true }, async (page) => {
    await navigate(page, landscapingRoute, false);
    await evaluate(page, `document.querySelector('[data-hv2-mobile-open]')?.focus(); document.querySelector('[data-hv2-mobile-open]')?.click()`);
    await delay(90);
    const menuOpen = await evaluate(page, `(() => {
      const menu = document.querySelector('[data-hv2-mobile-menu]');
       const activeLandscaping = Array.from(menu?.querySelectorAll('a[aria-current="page"]') || []).some((link) => link.textContent?.includes('Благоустройство'));
       return !menu?.hidden && menu?.getAttribute('aria-hidden') === 'false' && document.activeElement?.matches('[data-hv2-mobile-close]') && document.body.style.position === 'fixed' && activeLandscaping;
    })()`);
    assert(menuOpen, 'MobileMenu open/focus/scroll lock failed.');
    await evaluate(page, `(() => { const menu = document.querySelector('[data-hv2-mobile-menu]'); const items = menu?.querySelectorAll('a[href],button:not([disabled])'); items?.[items.length - 1]?.focus(); })()`);
    await pressKey(page, 'Tab', 'Tab');
    assert(await evaluate(page, `Boolean(document.activeElement?.closest('[data-hv2-mobile-menu]'))`), 'MobileMenu focus trap failed.');
    await pressKey(page, 'Escape', 'Escape');
    await delay(340);
    assert(await evaluate(page, `document.querySelector('[data-hv2-mobile-menu]')?.hidden === true && document.activeElement?.matches('[data-hv2-mobile-open]')`), 'MobileMenu Escape/return focus failed.');

    await evaluate(page, `window.scrollTo(0, document.documentElement.scrollHeight)`);
    const footer = await evaluate(page, `(() => {
      const accordions = Array.from(document.querySelectorAll('[data-v2-footer-accordion]'));
      accordions[0]?.querySelector('summary')?.click();
      return { count: accordions.length, opened: accordions[0]?.open, cta: document.querySelector('.hv2-footer__mobile-cta')?.textContent?.trim() };
    })()`);
    assert(footer.count === 2 && footer.opened && footer.cta.includes('Получить расчёт'), 'Mobile footer accordion/CTA failed.');
  });

  await withPage({ width: 1440, height: 900, reducedMotion: true }, async (page) => {
    await navigate(page, landscapingRoute, false);
    const reduced = await evaluate(page, `(() => {
      const card = document.querySelector('.place-scope__list li');
      const style = card ? getComputedStyle(card) : null;
      return matchMedia('(prefers-reduced-motion: reduce)').matches && !document.querySelector('.hv2-reveal-pending') && (!style || style.animationName === 'none');
    })()`);
    assert(reduced, 'Reduced-motion behavior failed.');
  });

  await withPage({ width: 390, height: 844, mobile: true }, async (page) => {
    await navigate(page, '/design-lab/v2/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-duo/', false);
    const empty = await evaluate(page, `(() => ({
      empty: Boolean(document.querySelector('.v2-product-gallery--empty')),
      arrows: document.querySelectorAll('[data-v2-gallery-prev],[data-v2-gallery-next]').length,
      dialog: document.querySelectorAll('[data-v2-product-lightbox]').length
    }))()`);
    assert(empty.empty && empty.arrows === 0 && empty.dialog === 0, 'Existing V2 zero-media gallery regressed.');
  });

  for (const filename of requiredScreenshots) {
    const screenshotPath = path.join(outputDir, filename);
    const info = await stat(screenshotPath);
    assert(info.size > 10000, `Screenshot is missing or empty: ${filename}.`);
    const header = await readFile(screenshotPath);
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    assert(width >= 320 && height >= 280, `Screenshot dimensions are invalid: ${filename} (${width}x${height}).`);
  }
  progress(`complete: ${requiredScreenshots.length} screenshots; ${matrix.length} responsive/regression checks`);
} finally {
  await browserCdp.send('Browser.close').catch(() => {});
  browserCdp.close();
  await Promise.race([
    new Promise((resolve) => browser.once('exit', resolve)),
    delay(2500)
  ]);
  if (browser.exitCode === null) browser.kill();
  await new Promise((resolve) => staticServer.close(resolve));
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

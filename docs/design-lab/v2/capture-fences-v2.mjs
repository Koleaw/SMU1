import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin = process.env.FENCES_V2_ORIGIN || 'http://127.0.0.1:4322';
const outputDir = path.resolve('docs/design-lab/v2');
const captureScreenshots = process.env.FENCES_V2_VERIFY_ONLY !== '1';
const screenshotNames = [
  'fences-section-desktop.png',
  'fences-section-mobile.png',
  'fences-category-filled-desktop.png',
  'fences-category-filled-mobile.png',
  'fences-category-sparse-desktop.png',
  'fences-category-sparse-mobile.png',
  'fences-product-desktop-top.png',
  'fences-product-desktop-full.png',
  'fences-product-mobile.png',
  'fences-product-gallery-fullscreen.png',
  'fences-mobile-footer.png'
];
const debugPort = 9850 + Math.floor(Math.random() * 100);
const profileDir = await mkdtemp(path.join(outputDir, '.fences-chrome-profile-'));
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const readJsonDirectory = async (directory) => Promise.all(
  (await readdir(directory)).filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(directory, name)))
);

const section = await readJson('src/content/product-sections/ograzhdeniya-i-zabory.json');
const categories = (await readJsonDirectory('src/content/product-categories'))
  .filter((item) => item.isActive && item.parentSectionSlug === section.slug)
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));
const categorySlugs = new Set(categories.map((item) => item.slug));
const products = (await readJsonDirectory('src/content/products'))
  .filter((item) => item.isActive && item.showInCatalog && categorySlugs.has(item.productCategorySlug))
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));
const productsFor = (category) => products.filter((item) => item.productCategorySlug === category.slug);
const mediaCount = (category) => Number(Boolean(category.image)) + (Array.isArray(category.gallery) ? category.gallery.length : 0);
const filledCategory = categories.slice().sort((a, b) => (
  productsFor(b).length - productsFor(a).length || mediaCount(b) - mediaCount(a)
))[0];
const sparseCategory = categories.filter((item) => productsFor(item).length === 0).sort((a, b) => (
  mediaCount(a) - mediaCount(b) ||
  ((a.shortDescription?.length || 0) + (a.heroDescription?.length || 0)) -
    ((b.shortDescription?.length || 0) + (b.heroDescription?.length || 0)) ||
  a.order - b.order
))[0];
const singleMediaCategory = categories.find((item) => (
  productsFor(item).length === 0 && item.image && (!Array.isArray(item.gallery) || item.gallery.length === 0)
));
const productScore = (item) => [
  item.description?.length || 0,
  item.features?.length || 0,
  item.dimensions?.length || 0,
  item.materials?.length || 0,
  item.colors?.length || 0,
  item.customizationItems?.length || 0,
  item.gallery?.length || 0,
  Number(Boolean(item.image))
].reduce((sum, value) => sum + value, 0);
const selectedProduct = products.slice().sort((a, b) => productScore(b) - productScore(a) || a.order - b.order)[0];

if (!section?.slug || !filledCategory || !sparseCategory || !singleMediaCategory || !selectedProduct) {
  throw new Error('Could not select factual fence routes for capture.');
}

const sectionRoute = `/design-lab/v2/${section.slug}/`;
const categoryRoute = (category) => `${sectionRoute}${category.slug}/`;
const productRoute = (product) => `${sectionRoute}${product.productCategorySlug}/${product.slug}/`;
const allRoutes = [sectionRoute, ...categories.map(categoryRoute), ...products.map(productRoute)];
const routes = {
  section: sectionRoute,
  filled: categoryRoute(filledCategory),
  sparse: categoryRoute(sparseCategory),
  single: categoryRoute(singleMediaCategory),
  product: productRoute(selectedProduct),
  urbanSection: '/design-lab/v2/ulichnaya-mebel/',
  urbanCategory: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/',
  amplitude: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/bolshaya-skameyka-amplituda/',
  home: '/design-lab/home-v2/'
};

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const progress = (message) => process.stderr.write(`[fences-v2] ${message}\n`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const waitForDebugger = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const page = (await response.json()).find((item) => item.type === 'page');
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
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
  once(method, timeoutMs = 15000) {
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
  close() { this.socket.close(); }
}

const cdp = new CdpClient(await waitForDebugger());
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
const runtimeErrors = [];
cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
  runtimeErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception');
});
cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
  if (type === 'error') runtimeErrors.push(args?.map((item) => item.value || item.description).filter(Boolean).join(' '));
});

const evaluate = async (expression) => {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const setViewport = async (width, height, mobile = false, deviceScaleFactor = 1) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor, mobile, screenWidth: width, screenHeight: height, positionX: 0, positionY: 0
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
};
const navigate = async (route, warmMedia = false) => {
  const navigation = await cdp.send('Page.navigate', { url: `${origin}${route}?palette=olive` });
  if (navigation.errorText) throw new Error(`Navigation failed for ${route}: ${navigation.errorText}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    const ready = await evaluate(`document.readyState === 'complete' && location.pathname === ${JSON.stringify(route)}`).catch(() => false);
    if (ready) break;
    await delay(50);
  }
  const ready = await evaluate(`document.readyState === 'complete' && location.pathname === ${JSON.stringify(route)}`).catch(() => false);
  if (!ready) throw new Error(`Timed out waiting for ${route}`);
  await evaluate(`(async () => {
    ${warmMedia ? `
      if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1800))]);
      document.querySelectorAll('img[loading="lazy"]').forEach((image) => { image.loading = 'eager'; });
      for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      document.documentElement.style.scrollBehavior = 'auto';
      document.scrollingElement.scrollTop = 0;
      await Promise.race([
        Promise.all(Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }))),
        new Promise((resolve) => setTimeout(resolve, 7000))
      ]);
    ` : ''}
    document.querySelectorAll('.hv2-reveal-pending').forEach((element) => {
      element.classList.remove('hv2-reveal-pending');
      element.classList.add('hv2-reveal-visible');
    });
    document.querySelectorAll('astro-dev-toolbar').forEach((element) => element.remove());
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
  await delay(warmMedia ? 160 : 45);
};
const saveViewport = async (filename) => {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(outputDir, filename), Buffer.from(result.data, 'base64'));
};
const saveFullPage = async (filename) => {
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const width = Math.ceil(metrics.cssContentSize?.width || metrics.contentSize.width);
  const height = Math.ceil(metrics.cssContentSize?.height || metrics.contentSize.height);
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 }
  });
  await writeFile(path.join(outputDir, filename), Buffer.from(result.data, 'base64'));
};
const diagnostics = () => evaluate(`(() => {
  const root = document.documentElement;
  const ids = Array.from(document.querySelectorAll('[id]')).map((item) => item.id);
  return {
    path: location.pathname,
    width: innerWidth,
    overflow: root.scrollWidth > innerWidth,
    scrollWidth: root.scrollWidth,
    h1: document.querySelectorAll('h1').length,
    noindex: document.querySelector('meta[name="robots"]')?.content || '',
    duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
    unlabeledButtons: Array.from(document.querySelectorAll('button')).filter((button) => !(button.textContent || '').trim() && !button.getAttribute('aria-label')).length,
    hiddenReveals: Array.from(document.querySelectorAll('[data-v2-reveal]')).filter((item) => getComputedStyle(item).opacity === '0' || getComputedStyle(item).visibility === 'hidden').length,
    publicSku: Array.from(document.querySelectorAll('dt')).filter((item) => item.textContent.trim() === 'Артикул').length
  };
})()`);
const dispatchKey = async (key, code = key) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 });
};

const report = {
  data: {
    categories: categories.length,
    products: products.length,
    filledCategory: { title: filledCategory.title, slug: filledCategory.slug },
    sparseCategory: { title: sparseCategory.title, slug: sparseCategory.slug },
    selectedProduct: { title: selectedProduct.title, slug: selectedProduct.slug },
    routes: allRoutes
  },
  responsive: [],
  links: {},
  sparse: {},
  product: {},
  gallery: {},
  navigation: {},
  footer: {},
  reducedMotion: {},
  screenshots: screenshotNames,
  runtimeErrors
};

try {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  if (captureScreenshots) {
    progress('capturing required screenshots');
    await setViewport(1440, 1000);
    await navigate(routes.section, true);
    await saveFullPage('fences-section-desktop.png');
    await setViewport(390, 844, true);
    await navigate(routes.section, true);
    await saveFullPage('fences-section-mobile.png');

    await setViewport(1440, 1000);
    await navigate(routes.filled, true);
    await saveFullPage('fences-category-filled-desktop.png');
    await setViewport(390, 844, true);
    await navigate(routes.filled, true);
    await saveFullPage('fences-category-filled-mobile.png');

    await setViewport(1440, 1000);
    await navigate(routes.sparse, true);
    await saveFullPage('fences-category-sparse-desktop.png');
    await setViewport(390, 844, true);
    await navigate(routes.sparse, true);
    await saveFullPage('fences-category-sparse-mobile.png');

    await setViewport(1440, 1000);
    await navigate(routes.product, true);
    await saveViewport('fences-product-desktop-top.png');
    await navigate(routes.product, true);
    await saveFullPage('fences-product-desktop-full.png');
    await setViewport(390, 844, true);
    await navigate(routes.product, true);
    await saveFullPage('fences-product-mobile.png');

    await setViewport(1440, 1000);
    await navigate(routes.filled);
    await evaluate(`document.querySelector('[data-v2-gallery-open]').click()`);
    await delay(120);
    await saveViewport('fences-product-gallery-fullscreen.png');
    await dispatchKey('Escape');

    await setViewport(390, 1000, true);
    await navigate(routes.product);
    await evaluate(`(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      const footer = document.querySelector('.hv2-footer');
      window.scrollTo(0, footer.getBoundingClientRect().top + window.scrollY);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { scrollY, footerTop: footer.getBoundingClientRect().top };
    })()`);
    await delay(80);
    await saveViewport('fences-mobile-footer.png');
  }

  progress('checking all factual routes and responsive widths');
  await setViewport(1440, 900);
  for (const route of allRoutes) {
    await navigate(route);
    report.responsive.push(await diagnostics());
  }
  for (const width of [1024, 768, 390, 320]) {
    await setViewport(width, width <= 390 ? 844 : 900, width <= 768);
    for (const route of [routes.section, routes.filled, routes.sparse, routes.product]) {
      await navigate(route);
      report.responsive.push(await diagnostics());
    }
  }
  await setViewport(720, 500, false, 2);
  for (const route of [routes.section, routes.filled, routes.sparse, routes.product]) {
    await navigate(route);
    report.responsive.push(await diagnostics());
  }

  progress('checking V2-only links and sparse/product states');
  await setViewport(1440, 1000);
  await navigate(routes.section);
  report.links.section = await evaluate(`(() => ({
    cards: Array.from(document.querySelectorAll('.v2-category-card')).map((item) => item.pathname),
    states: Array.from(document.querySelectorAll('.v2-category-card')).map((item) => item.dataset.v2CategoryState),
    oldFenceAnchors: Array.from(document.querySelectorAll('a[href]')).map((item) => item.pathname).filter((pathname) => pathname.startsWith('/${section.slug}/'))
  }))()`);
  report.navigation.dropdowns = await evaluate(`(async () => {
    const results = [];
    for (const trigger of document.querySelectorAll('[data-hv2-dropdown-trigger]')) {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      const first = trigger.closest('[data-hv2-dropdown]').querySelector('[data-hv2-dropdown-link]');
      const opened = trigger.getAttribute('aria-expanded') === 'true' && document.activeElement === first;
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      results.push({ opened, closed: trigger.getAttribute('aria-expanded') === 'false', returned: document.activeElement === trigger });
    }
    return results;
  })()`);

  await navigate(routes.sparse);
  report.sparse = await evaluate(`(() => ({
    state: document.querySelectorAll('.v2-sparse-state').length,
    galleryImages: JSON.parse(document.querySelector('[data-v2-gallery-data]').textContent).images.length,
    fallbackVisible: getComputedStyle(document.querySelector('[data-v2-gallery-empty]')).display !== 'none',
    discussCta: Array.from(document.querySelectorAll('#contact a')).some((item) => item.textContent.includes('Обсудить задачу')),
    backHref: document.querySelector('.v2-sparse-state .hv2-text-link')?.pathname,
    channels: document.querySelectorAll('#contact .v2-direct-contact__channels > a').length
  }))()`);

  await navigate(routes.filled);
  report.links.filled = await evaluate(`(() => ({
    cards: Array.from(document.querySelectorAll('#product-grid .v2-product-card')).map((item) => item.pathname),
    oldFenceAnchors: Array.from(document.querySelectorAll('a[href]')).map((item) => item.pathname).filter((pathname) => pathname.startsWith('/${section.slug}/'))
  }))()`);
  report.gallery.multiple = await evaluate(`(() => ({
    images: JSON.parse(document.querySelector('[data-v2-gallery-data]').textContent).images.length,
    arrows: document.querySelectorAll('[data-v2-gallery-prev], [data-v2-gallery-next]').length,
    thumbs: document.querySelectorAll('[data-v2-gallery-thumb]').length,
    status: document.querySelector('[data-v2-gallery-status]')?.textContent.trim()
  }))()`);
  report.gallery.keyboard = await evaluate(`(async () => {
    const opener = document.querySelector('[data-v2-gallery-open]');
    opener.focus();
    opener.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    return document.querySelector('[data-v2-gallery-status]').textContent.trim();
  })()`);
  report.gallery.lightboxOpen = await evaluate(`(async () => {
    const opener = document.querySelector('[data-v2-gallery-open]');
    opener.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const dialog = document.querySelector('[data-v2-product-lightbox]');
    const controls = Array.from(dialog.querySelectorAll('button:not([disabled])'));
    const first = controls[0];
    const last = controls.at(-1);
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    return { open: dialog.open, modal: dialog.matches(':modal'), focusWrapped: document.activeElement === first };
  })()`);
  await dispatchKey('Escape');
  await delay(60);
  report.gallery.lightboxClosed = await evaluate(`(() => ({
    open: document.querySelector('[data-v2-product-lightbox]').open,
    focusReturned: document.activeElement === document.querySelector('[data-v2-gallery-open]')
  }))()`);

  await navigate(routes.single);
  report.gallery.single = await evaluate(`(() => ({
    images: JSON.parse(document.querySelector('[data-v2-gallery-data]').textContent).images.length,
    arrows: document.querySelectorAll('[data-v2-gallery-prev], [data-v2-gallery-next]').length,
    thumbs: document.querySelectorAll('[data-v2-gallery-thumb]').length,
    statuses: document.querySelectorAll('[data-v2-gallery-status], [data-v2-lightbox-status]').length,
    fullscreen: Boolean(document.querySelector('[data-v2-product-lightbox]'))
  }))()`);
  report.gallery.singleFullscreen = await evaluate(`(async () => {
    const opener = document.querySelector('[data-v2-gallery-open]');
    opener.focus();
    opener.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    return document.querySelector('[data-v2-product-lightbox]').open;
  })()`);
  await dispatchKey('Escape');
  report.gallery.brokenFallback = await evaluate(`(() => {
    const image = document.querySelector('[data-v2-gallery-main]');
    image.dispatchEvent(new Event('error'));
    const fallback = document.querySelector('[data-v2-gallery-empty]');
    return { visible: getComputedStyle(fallback).display !== 'none', ariaHidden: fallback.getAttribute('aria-hidden') };
  })()`);

  await navigate(routes.product);
  report.product = await evaluate(`(() => ({
    images: JSON.parse(document.querySelector('[data-v2-gallery-data]').textContent).images.length,
    galleryControls: document.querySelectorAll('[data-v2-gallery-prev], [data-v2-gallery-next], [data-v2-gallery-status], [data-v2-gallery-thumb], [data-v2-product-lightbox]').length,
    fallbackVisible: getComputedStyle(document.querySelector('[data-v2-gallery-empty]')).display !== 'none',
    related: Array.from(document.querySelectorAll('.v2-related-products .v2-product-card')).map((item) => item.pathname),
    tables: document.querySelectorAll('.v2-technical-panel--specs table').length,
    definitionPairs: document.querySelectorAll('.v2-spec-definitions > div').length,
    specCopies: document.querySelectorAll('.v2-spec-copy').length,
    sku: Array.from(document.querySelectorAll('dt')).filter((item) => item.textContent.trim() === 'Артикул').length,
    finalBlocks: document.querySelectorAll('.v2-direct-contact--product').length,
    finalActions: Array.from(document.querySelectorAll('.v2-direct-contact--product .hv2-actions a')).map((item) => item.textContent.trim()),
    oldFenceAnchors: Array.from(document.querySelectorAll('a[href]')).map((item) => item.pathname).filter((pathname) => pathname.startsWith('/${section.slug}/'))
  }))()`);

  await setViewport(390, 844, true);
  await navigate(routes.filled);
  report.gallery.swipe = await evaluate(`(async () => {
    const stage = document.querySelector('.v2-product-gallery__stage');
    const status = document.querySelector('[data-v2-gallery-status]');
    const before = status.textContent.trim();
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 8, clientX: 320, clientY: 300 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 8, clientX: 90, clientY: 306 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterHorizontal = status.textContent.trim();
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 9, clientX: 200, clientY: 260 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 9, clientX: 208, clientY: 410 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { before, afterHorizontal, afterVertical: status.textContent.trim(), touchAction: getComputedStyle(stage).touchAction };
  })()`);

  await navigate(routes.section);
  report.navigation.mobileOpen = await evaluate(`(async () => {
    const opener = document.querySelector('[data-hv2-mobile-open]');
    opener.click();
    await new Promise((resolve) => setTimeout(resolve, 320));
    const menu = document.querySelector('[data-hv2-mobile-menu]');
    return {
      open: !menu.hidden && menu.getAttribute('aria-hidden') === 'false',
      initialFocus: document.activeElement === menu.querySelector('[data-hv2-mobile-close]'),
      bodyLocked: getComputedStyle(document.body).position === 'fixed',
      mainInert: document.querySelector('main').hasAttribute('inert'),
      fenceHref: menu.querySelector('a[href*="/design-lab/v2/${section.slug}/"]')?.pathname
    };
  })()`);
  await dispatchKey('Escape');
  await delay(320);
  report.navigation.mobileClosed = await evaluate(`(() => ({
    hidden: document.querySelector('[data-hv2-mobile-menu]').hidden,
    focusReturned: document.activeElement === document.querySelector('[data-hv2-mobile-open]'),
    bodyUnlocked: getComputedStyle(document.body).position !== 'fixed'
  }))()`);

  await navigate(routes.product);
  report.footer.mobile = await evaluate(`(() => ({
    cta: document.querySelector('.hv2-footer__mobile-cta')?.textContent.trim(),
    contacts: document.querySelectorAll('.hv2-footer__contacts > a:not(.hv2-footer__mobile-cta), .hv2-footer__contacts address').length,
    accordions: document.querySelectorAll('[data-v2-footer-accordion]').length,
    closed: Array.from(document.querySelectorAll('[data-v2-footer-accordion]')).every((item) => !item.open)
  }))()`);

  progress('checking reduced motion and existing V2 regression routes');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await navigate(routes.filled);
  report.reducedMotion = await evaluate(`(() => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    pending: document.querySelectorAll('.hv2-reveal-pending').length,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    imageTransition: getComputedStyle(document.querySelector('[data-v2-gallery-main]')).transitionDuration
  }))()`);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  for (const route of [routes.home, routes.urbanSection, routes.urbanCategory, routes.amplitude]) {
    await navigate(route);
    const item = await diagnostics();
    assert(!item.overflow && item.h1 === 1 && item.noindex.includes('noindex'), `Existing V2 regression failed: ${route}`);
  }

  for (const route of allRoutes) {
    const response = await fetch(`${origin}${route}`);
    assert(response.ok, `Route did not return 200: ${route}`);
  }
  for (const filename of report.screenshots) {
    const info = await stat(path.join(outputDir, filename));
    assert(info.size > 1000, `Screenshot is empty: ${filename}`);
  }

  assert(categories.length === 9 && products.length === 3, 'Unexpected factual fence counts.');
  assert(report.responsive.every((item) => !item.overflow && item.h1 === 1 && item.noindex.includes('noindex') && item.duplicateIds.length === 0 && item.unlabeledButtons === 0 && item.publicSku === 0), 'Responsive or accessibility diagnostics failed.');
  assert(report.links.section.cards.length === categories.length && report.links.section.cards.every((item) => item.startsWith(sectionRoute)), 'A category card leaves V2.');
  assert(report.links.section.oldFenceAnchors.length === 0 && report.links.filled.oldFenceAnchors.length === 0 && report.product.oldFenceAnchors.length === 0, 'A fence link points to the production category/product contour.');
  assert(report.links.filled.cards.length === products.length && report.links.filled.cards.every((item) => item.startsWith(sectionRoute)), 'A product card leaves V2.');
  assert(report.sparse.state === 1 && report.sparse.galleryImages === 0 && report.sparse.fallbackVisible && report.sparse.discussCta && report.sparse.channels === 4, 'Sparse state is incomplete.');
  assert(report.gallery.multiple.images === 2 && report.gallery.multiple.arrows === 2 && report.gallery.multiple.thumbs === 2, 'Multiple-image gallery controls are incomplete.');
  assert(report.gallery.keyboard === '2 / 2' && report.gallery.lightboxOpen.open && report.gallery.lightboxOpen.focusWrapped && !report.gallery.lightboxClosed.open && report.gallery.lightboxClosed.focusReturned, 'Gallery keyboard or fullscreen behavior failed.');
  assert(report.gallery.single.images === 1 && report.gallery.single.arrows === 0 && report.gallery.single.thumbs === 0 && report.gallery.single.statuses === 0 && report.gallery.single.fullscreen && report.gallery.singleFullscreen, 'Single-image gallery state is incorrect.');
  assert(report.gallery.brokenFallback.visible && report.gallery.brokenFallback.ariaHidden === 'false', 'Broken-media fallback is inaccessible.');
  assert(report.gallery.swipe.before !== report.gallery.swipe.afterHorizontal && report.gallery.swipe.afterHorizontal === report.gallery.swipe.afterVertical && report.gallery.swipe.touchAction === 'pan-y', 'Mobile swipe blocks or fails vertical scrolling.');
  assert(report.product.images === 0 && report.product.galleryControls === 0 && report.product.fallbackVisible && report.product.related.length === 2 && report.product.related.every((item) => item.startsWith(sectionRoute)), 'Zero-media product or related-product state is incorrect.');
  assert(report.product.tables === 0 && report.product.specCopies === 1 && report.product.sku === 0 && report.product.finalBlocks === 1, 'Product renderer or final commercial block regressed.');
  assert(report.navigation.dropdowns.every((item) => item.opened && item.closed && item.returned), 'Desktop dropdown keyboard behavior failed.');
  assert(report.navigation.mobileOpen.open && report.navigation.mobileOpen.initialFocus && report.navigation.mobileOpen.bodyLocked && report.navigation.mobileOpen.mainInert && report.navigation.mobileClosed.hidden && report.navigation.mobileClosed.focusReturned, 'Mobile menu behavior failed.');
  assert(report.footer.mobile.cta.includes('Запросить расчёт') && report.footer.mobile.contacts === 5 && report.footer.mobile.accordions === 2 && report.footer.mobile.closed, 'Mobile footer is incomplete.');
  assert(report.reducedMotion.matches && report.reducedMotion.pending === 0 && report.reducedMotion.scrollBehavior === 'auto', 'Reduced-motion behavior failed.');
  assert(runtimeErrors.filter(Boolean).length === 0, `Runtime errors: ${runtimeErrors.filter(Boolean).join('; ')}`);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  progress('all checks passed');
} finally {
  cdp.close();
  browser.kill();
  await delay(300);
  const resolvedProfile = path.resolve(profileDir);
  if (resolvedProfile.startsWith(`${outputDir}${path.sep}`)) {
    await rm(resolvedProfile, { recursive: true, force: true }).catch(() => {});
  }
}

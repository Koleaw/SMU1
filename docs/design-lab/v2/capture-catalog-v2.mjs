import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const origin = process.env.CATALOG_V2_ORIGIN || 'http://127.0.0.1:4321';
const outputDir = path.resolve('docs/design-lab/v2');
const debugPort = 9600 + Math.floor(Math.random() * 250);
const profileDir = await mkdtemp(path.join(outputDir, '.chrome-profile-'));

const routes = {
  home: '/design-lab/home-v2/',
  section: '/design-lab/v2/ulichnaya-mebel/',
  category: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/',
  product: '/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/bolshaya-skameyka-amplituda/'
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
const progress = (message) => process.stderr.write(`[catalog-v2] ${message}\n`);

const waitForDebugger = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find((item) => item.type === 'page');
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
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
    const listeners = this.events.get(method) || [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  once(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const done = (params) => {
        clearTimeout(timer);
        this.events.set(method, (this.events.get(method) || []).filter((listener) => listener !== done));
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.events.set(method, (this.events.get(method) || []).filter((listener) => listener !== done));
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.on(method, done);
    });
  }

  close() {
    this.socket.close();
  }
}

const cdp = new CdpClient(await waitForDebugger());
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const runtimeErrors = [];
cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
  runtimeErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'Unspecified runtime exception');
});
cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
  if (type !== 'error') return;
  runtimeErrors.push(args?.map((item) => item.value || item.description).filter(Boolean).join(' ') || 'console.error');
});

const evaluate = async (expression, awaitPromise = true) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed.');
  }
  return result.result?.value;
};

const setViewport = async (width, height, mobile = false, deviceScaleFactor = 1) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile,
    screenWidth: width,
    screenHeight: height,
    positionX: 0,
    positionY: 0,
    dontSetVisibleSize: false
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
};

const navigate = async (route, palette = 'olive') => {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${origin}${route}?palette=${palette}` });
  await loaded;
  await evaluate(`(async () => {
    if (document.fonts?.ready) {
      await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 2400))]);
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
  await delay(650);
};

const warmLazyMedia = async () => {
  await evaluate(`(async () => {
    document.querySelectorAll('img[loading="lazy"]').forEach((image) => { image.loading = 'eager'; });
    const height = document.documentElement.scrollHeight;
    for (let y = 0; y < height; y += 640) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 42));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 240));
    await Promise.race([
      Promise.all(Array.from(document.images).map(async (image) => {
        if (!image.complete) {
          await new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          });
        }
        if (image.naturalWidth > 0 && typeof image.decode === 'function') await image.decode().catch(() => {});
      })),
      new Promise((resolve) => setTimeout(resolve, 10000))
    ]);
    document.querySelectorAll('.hv2-reveal-pending').forEach((element) => {
      element.classList.remove('hv2-reveal-pending');
      element.classList.add('hv2-reveal-visible');
    });
    await new Promise((resolve) => setTimeout(resolve, 220));
    return true;
  })()`);
};

const saveViewport = async (filename) => {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  await writeFile(path.join(outputDir, filename), Buffer.from(result.data, 'base64'));
};

const saveFullPage = async (filename, width, viewportHeight) => {
  const pageHeight = await evaluate(`(() => {
    document.documentElement.dataset.v2CaptureScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    return document.documentElement.scrollHeight;
  })()`);
  const maxScroll = Math.max(0, pageHeight - viewportHeight);
  const offsets = [];
  for (let offset = 0; offset <= maxScroll; offset += viewportHeight) offsets.push(offset);
  if (offsets.at(-1) !== maxScroll) offsets.push(maxScroll);

  const partsDir = await mkdtemp(path.join(outputDir, '.capture-parts-'));
  const segments = [];
  for (let index = 0; index < offsets.length; index += 1) {
    const requestedOffset = offsets[index];
    const actualOffset = await evaluate(`(async () => {
      document.querySelectorAll('.hv2-header, .hv2-palette-switch').forEach((element) => {
        element.style.visibility = ${index === 0 ? "'visible'" : "'hidden'"};
      });
      window.scrollTo(0, ${requestedOffset});
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 220));
      return window.scrollY;
    })()`);
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    });
    const partPath = path.join(partsDir, `part-${String(index).padStart(2, '0')}.png`);
    await writeFile(partPath, Buffer.from(result.data, 'base64'));
    segments.push({ path: partPath, y: Math.round(actualOffset) });
  }

  await sharp({
    create: {
      width,
      height: pageHeight,
      channels: 4,
      background: { r: 243, g: 245, b: 241, alpha: 1 }
    }
  })
    .composite(segments.map((segment) => ({ input: segment.path, left: 0, top: segment.y })))
    .png({ compressionLevel: 8 })
    .toFile(path.join(outputDir, filename));

  await evaluate(`(() => {
    document.documentElement.style.scrollBehavior = document.documentElement.dataset.v2CaptureScrollBehavior || '';
    delete document.documentElement.dataset.v2CaptureScrollBehavior;
    document.querySelectorAll('.hv2-header, .hv2-palette-switch').forEach((element) => { element.style.visibility = ''; });
    window.scrollTo(0, 0);
  })()`);
  const resolvedParts = path.resolve(partsDir);
  if (resolvedParts.startsWith(`${outputDir}${path.sep}`)) await rm(resolvedParts, { recursive: true, force: true });
};

const pageDiagnostics = () => evaluate(`(() => {
  const root = document.documentElement;
  const allIds = Array.from(document.querySelectorAll('[id]')).map((element) => element.id);
  const activeCurrent = Array.from(document.querySelectorAll('[aria-current]')).map((element) => ({
    text: (element.textContent || '').trim().replace(/\\s+/g, ' '),
    current: element.getAttribute('aria-current')
  }));
  return {
    path: location.pathname,
    viewport: { width: innerWidth, height: innerHeight },
    page: { scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight, overflow: root.scrollWidth > innerWidth },
    title: document.title,
    h1Count: document.querySelectorAll('h1').length,
    noindex: document.querySelector('meta[name="robots"]')?.content || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    categoryCards: document.querySelectorAll('.v2-category-card').length,
    productCards: document.querySelectorAll('.v2-product-card').length,
    activeCurrent,
    brokenImages: Array.from(document.images)
      .filter((image) => (image.currentSrc || image.getAttribute('src')) && image.complete && image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.src),
    duplicateIds: allIds.filter((id, index) => allIds.indexOf(id) !== index),
    unlabeledButtons: Array.from(document.querySelectorAll('button'))
      .filter((button) => !(button.textContent || '').trim() && !button.getAttribute('aria-label'))
      .length,
    hiddenRevealItems: Array.from(document.querySelectorAll('[data-v2-reveal]'))
      .filter((element) => getComputedStyle(element).visibility === 'hidden' || Number(getComputedStyle(element).opacity) === 0)
      .length,
    horizontalOffenders: Array.from(document.querySelectorAll('body *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.position !== 'fixed' && rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
      })
      .slice(0, 8)
      .map((element) => ({ tag: element.tagName, className: String(element.className || ''), rect: element.getBoundingClientRect().toJSON() }))
  };
})()`);

const checkLocalLinks = async () => {
  const links = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('a[href]'))
    .map((link) => link.href)
    .filter((href) => href.startsWith(location.origin))))`);
  const failed = [];
  for (const href of links) {
    const url = new URL(href);
    url.hash = '';
    const response = await fetch(url);
    if (!response.ok) failed.push({ url: url.toString(), status: response.status });
  }
  return { count: links.length, failed };
};

const dispatchEscape = async () => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
};

const report = {
  screenshots: [],
  responsive: {},
  navigation: {},
  gallery: {},
  productCorrection: {},
  footer: {},
  links: {},
  reducedMotion: {},
  homeRegression: {},
  runtimeErrors
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  progress('capturing section at 1440px');
  await setViewport(1440, 1000);
  await navigate(routes.section);
  await warmLazyMedia();
  report.responsive.section1440 = await pageDiagnostics();
  report.links.section = await checkLocalLinks();
  await saveFullPage('catalog-section-desktop.png', 1440, 1000);
  report.screenshots.push('catalog-section-desktop.png');

  progress('checking desktop dropdown keyboard behavior');
  report.navigation.dropdowns = await evaluate(`(async () => {
    const result = [];
    for (const trigger of document.querySelectorAll('[data-hv2-dropdown-trigger]')) {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const group = trigger.closest('[data-hv2-dropdown]');
      const firstLink = group?.querySelector('[data-hv2-dropdown-link]');
      const opened = trigger.getAttribute('aria-expanded') === 'true' && document.activeElement === firstLink;
      firstLink?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      result.push({
        controls: trigger.getAttribute('aria-controls'),
        opened,
        closed: trigger.getAttribute('aria-expanded') === 'false',
        focusReturned: document.activeElement === trigger
      });
    }
    return result;
  })()`);

  progress('capturing section at 390px and checking mobile menu');
  await setViewport(390, 844, true);
  await navigate(routes.section);
  await warmLazyMedia();
  report.responsive.section390 = await pageDiagnostics();
  await saveFullPage('catalog-section-mobile.png', 390, 844);
  report.screenshots.push('catalog-section-mobile.png');
  await navigate(routes.section);
  report.navigation.mobileOpen = await evaluate(`(async () => {
    const opener = document.querySelector('[data-hv2-mobile-open]');
    opener.click();
    await new Promise((resolve) => setTimeout(resolve, 360));
    const menu = document.querySelector('[data-hv2-mobile-menu]');
    return {
      expanded: opener.getAttribute('aria-expanded'),
      visible: !menu.hidden && menu.getAttribute('aria-hidden') === 'false',
      initialFocus: document.activeElement === menu.querySelector('[data-hv2-mobile-close]'),
      bodyLocked: getComputedStyle(document.body).position === 'fixed',
      mainInert: document.querySelector('main').hasAttribute('inert'),
      currentStreetFurnitureLinks: menu.querySelectorAll('a[aria-current]').length
    };
  })()`);
  await dispatchEscape();
  await delay(340);
  report.navigation.mobileClosed = await evaluate(`(() => ({
    expanded: document.querySelector('[data-hv2-mobile-open]').getAttribute('aria-expanded'),
    hidden: document.querySelector('[data-hv2-mobile-menu]').hidden,
    focusReturned: document.activeElement === document.querySelector('[data-hv2-mobile-open]'),
    bodyUnlocked: getComputedStyle(document.body).position !== 'fixed',
    mainActive: !document.querySelector('main').hasAttribute('inert')
  }))()`);

  progress('capturing category at 1440px');
  await setViewport(1440, 1000);
  await navigate(routes.category);
  await warmLazyMedia();
  report.responsive.category1440 = await pageDiagnostics();
  report.links.category = await checkLocalLinks();
  await saveFullPage('category-desktop.png', 1440, 1000);
  report.screenshots.push('category-desktop.png');

  progress('capturing category at 390px');
  await setViewport(390, 844, true);
  await navigate(routes.category);
  await warmLazyMedia();
  report.responsive.category390 = await pageDiagnostics();
  await saveFullPage('category-mobile.png', 390, 844);
  report.screenshots.push('category-mobile.png');

  progress('capturing product and checking desktop gallery');
  await setViewport(1440, 1000);
  await navigate(routes.product);
  await saveViewport('product-desktop-top.png');
  report.screenshots.push('product-desktop-top.png');
  await warmLazyMedia();
  report.responsive.product1440 = await pageDiagnostics();
  report.productCorrection.desktop = await evaluate(`(() => ({
    publicSkuLabels: Array.from(document.querySelectorAll('.v2-product-summary dt')).filter((item) => item.textContent.trim() === 'Артикул').length,
    publicSkuEmptyText: document.body.innerText.includes('Не указан'),
    tablesInSpecifications: document.querySelectorAll('.v2-technical-panel--specs table').length,
    definitionPairs: document.querySelectorAll('.v2-spec-definitions > div').length,
    textSpecifications: document.querySelectorAll('.v2-spec-points > li').length,
    specificationText: Array.from(document.querySelectorAll('.v2-spec-points > li, .v2-spec-copy, .v2-spec-definitions dd')).map((item) => item.textContent.trim()),
    standaloneCustomProjectBlocks: document.querySelectorAll('.v2-product-custom-project').length,
    finalContactBlocks: document.querySelectorAll('.v2-direct-contact--product').length,
    finalActions: Array.from(document.querySelectorAll('.v2-direct-contact--product .hv2-actions a')).map((item) => item.textContent.trim()),
    finalChannels: Array.from(document.querySelectorAll('.v2-direct-contact--product .v2-direct-contact__channels > a')).map((item) => item.getAttribute('href')),
    pageHeight: document.documentElement.scrollHeight
  }))()`);
  report.footer.desktop = await evaluate(`(() => ({
    height: Math.round(document.querySelector('.hv2-footer').getBoundingClientRect().height),
    desktopNavVisible: Array.from(document.querySelectorAll('.hv2-footer__catalog-desktop-nav')).every((item) => getComputedStyle(item).display !== 'none'),
    accordionsHidden: Array.from(document.querySelectorAll('[data-v2-footer-accordion]')).every((item) => getComputedStyle(item).display === 'none')
  }))()`);
  report.links.product = await checkLocalLinks();
  await saveFullPage('product-desktop-full.png', 1440, 1000);
  report.screenshots.push('product-desktop-full.png');
  await navigate(routes.product);

  report.gallery.initial = await evaluate(`(() => ({
    images: JSON.parse(document.querySelector('[data-v2-gallery-data]').textContent).images.length,
    status: document.querySelector('[data-v2-gallery-status]')?.textContent.trim(),
    thumbs: document.querySelectorAll('[data-v2-gallery-thumb]').length,
    priority: document.querySelector('[data-v2-gallery-main]')?.getAttribute('fetchpriority'),
    loading: document.querySelector('[data-v2-gallery-main]')?.getAttribute('loading')
  }))()`);
  report.gallery.navigation = await evaluate(`(async () => {
    const open = document.querySelector('[data-v2-gallery-open]');
    open.focus();
    open.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterRight = document.querySelector('[data-v2-gallery-status]').textContent.trim();
    document.querySelector('[data-v2-gallery-prev]').click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterPrevious = document.querySelector('[data-v2-gallery-status]').textContent.trim();
    document.querySelectorAll('[data-v2-gallery-thumb]')[1].click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      afterRight,
      afterPrevious,
      afterThumb: document.querySelector('[data-v2-gallery-status]').textContent.trim(),
      currentThumbs: document.querySelectorAll('[data-v2-gallery-thumb][aria-pressed="true"]').length
    };
  })()`);
  report.gallery.lightboxOpen = await evaluate(`(async () => {
    const opener = document.querySelector('[data-v2-gallery-open]');
    opener.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const dialog = document.querySelector('[data-v2-product-lightbox]');
    const close = dialog.querySelector('[data-v2-lightbox-close]');
    const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
    const first = focusable[0];
    const last = focusable.at(-1);
    const initiallyFocused = document.activeElement === close;
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    const mediaRect = dialog.querySelector('[data-v2-lightbox-media]').getBoundingClientRect();
    const toolbarRect = dialog.querySelector('.v2-product-lightbox__toolbar').getBoundingClientRect();
    return {
      open: dialog.open,
      modal: dialog.matches(':modal'),
      initiallyFocused,
      focusWrapped: document.activeElement === first,
      status: dialog.querySelector('[data-v2-lightbox-status]').textContent.trim(),
      rootLocked: document.documentElement.classList.contains('v2-lightbox-open'),
      controlsOutsideMedia: toolbarRect.bottom <= mediaRect.top + 1,
      mediaRect: mediaRect.toJSON()
    };
  })()`);
  await saveViewport('product-gallery-fullscreen.png');
  report.screenshots.push('product-gallery-fullscreen.png');
  await dispatchEscape();
  await delay(120);
  report.gallery.lightboxClosed = await evaluate(`(() => ({
    open: document.querySelector('[data-v2-product-lightbox]').open,
    focusReturned: document.activeElement === document.querySelector('[data-v2-gallery-open]'),
    rootUnlocked: !document.documentElement.classList.contains('v2-lightbox-open')
  }))()`);

  progress('capturing product and gallery at 390px');
  await setViewport(390, 844, true);
  await navigate(routes.product);
  await warmLazyMedia();
  report.responsive.product390 = await pageDiagnostics();
  await saveFullPage('product-mobile.png', 390, 844);
  report.screenshots.push('product-mobile.png');
  const mobileFooterBox = await evaluate(`(() => {
    const footer = document.querySelector('.hv2-footer');
    const rect = footer.getBoundingClientRect();
    return { top: Math.round(rect.top + window.scrollY), height: Math.floor(rect.height) };
  })()`);
  await sharp(path.join(outputDir, 'product-mobile.png'))
    .extract({ left: 0, top: mobileFooterBox.top, width: 390, height: mobileFooterBox.height })
    .png({ compressionLevel: 8 })
    .toFile(path.join(outputDir, 'product-mobile-footer.png'));
  report.screenshots.push('product-mobile-footer.png');
  report.footer.mobile = await evaluate(`(() => ({
    height: Math.round(document.querySelector('.hv2-footer').getBoundingClientRect().height),
    accordionCount: document.querySelectorAll('[data-v2-footer-accordion]').length,
    accordionsClosed: Array.from(document.querySelectorAll('[data-v2-footer-accordion]')).every((item) => !item.open),
    summariesVisible: Array.from(document.querySelectorAll('[data-v2-footer-accordion] summary')).every((item) => getComputedStyle(item).display !== 'none'),
    desktopNavHidden: Array.from(document.querySelectorAll('.hv2-footer__catalog-desktop-nav')).every((item) => getComputedStyle(item).display === 'none'),
    cta: document.querySelector('.hv2-footer__mobile-cta')?.textContent.trim(),
    directContactValues: Array.from(document.querySelectorAll('.hv2-footer__contacts > a:not(.hv2-footer__mobile-cta), .hv2-footer__contacts address')).map((item) => item.textContent.trim()),
    privacyVisible: getComputedStyle(document.querySelector('.hv2-footer__legal a')).display !== 'none',
    cookieVisible: getComputedStyle(document.querySelector('[data-hv2-cookie-open]')).display !== 'none'
  }))()`);
  await evaluate(`document.querySelector('[data-v2-footer-accordion] summary').focus()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await delay(100);
  report.footer.keyboardOpen = await evaluate(`(() => ({
    open: document.querySelector('[data-v2-footer-accordion]').open,
    focusStayedOnSummary: document.activeElement === document.querySelector('[data-v2-footer-accordion] summary')
  }))()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await navigate(routes.product);
  report.gallery.mobileSwipe = await evaluate(`(async () => {
    const stage = document.querySelector('.v2-product-gallery__stage');
    const status = document.querySelector('[data-v2-gallery-status]');
    const before = status.textContent.trim();
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 17, clientX: 310, clientY: 320 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 17, clientX: 100, clientY: 326 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterHorizontal = status.textContent.trim();
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 18, clientX: 200, clientY: 250 }));
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 18, clientX: 208, clientY: 380 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { before, afterHorizontal, afterVertical: status.textContent.trim(), touchAction: getComputedStyle(stage).touchAction };
  })()`);
  await evaluate(`document.querySelector('[data-v2-gallery-open]').click()`);
  await delay(120);
  await saveViewport('product-gallery-mobile.png');
  report.screenshots.push('product-gallery-mobile.png');
  await dispatchEscape();

  progress('checking 1024px, 768px, 320px and 200% reflow');
  for (const width of [1024, 768, 320]) {
    await setViewport(width, width === 320 ? 844 : 900, width <= 768);
    for (const [routeName, route] of Object.entries({ section: routes.section, category: routes.category, product: routes.product })) {
      await navigate(route);
      await warmLazyMedia();
      report.responsive[`${routeName}${width}`] = await pageDiagnostics();
    }
  }
  await setViewport(720, 500, false, 2);
  await navigate(routes.product);
  await warmLazyMedia();
  report.responsive.productZoom200 = await pageDiagnostics();

  progress('checking reduced motion');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await setViewport(390, 844, true);
  await navigate(routes.product);
  report.reducedMotion = await evaluate(`(() => {
    const reveal = document.querySelector('[data-v2-reveal]');
    const image = document.querySelector('[data-v2-gallery-main]');
    return {
      mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      pendingReveals: document.querySelectorAll('.hv2-reveal-pending').length,
      revealOpacity: reveal ? getComputedStyle(reveal).opacity : null,
      imageTransitionDuration: image ? getComputedStyle(image).transitionDuration : null,
      thumbScrollBehavior: getComputedStyle(document.querySelector('.v2-product-gallery__thumbs')).scrollBehavior
    };
  })()`);

  progress('checking home-v2 regression surface');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await setViewport(1440, 1000);
  await navigate(routes.home);
  await warmLazyMedia();
  report.homeRegression = await pageDiagnostics();
  report.homeRegression.footerAccordions = await evaluate(`document.querySelectorAll('[data-v2-footer-accordion]').length`);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  const allDiagnostics = Object.values(report.responsive);
  assert(report.responsive.section1440.categoryCards === 11, 'The section must render exactly 11 category cards.');
  assert(report.responsive.category1440.productCards === 16, 'The category must render exactly 16 catalog products.');
  assert(report.gallery.initial.images === 2 && report.gallery.initial.thumbs === 2, 'The selected product must expose both real gallery images.');
  assert(report.productCorrection.desktop.publicSkuLabels === 0 && !report.productCorrection.desktop.publicSkuEmptyText, 'Public SKU output remains visible.');
  assert(report.productCorrection.desktop.tablesInSpecifications === 0 && report.productCorrection.desktop.textSpecifications === 5, 'Specification renderer did not select the expected text-list presentation.');
  assert(report.productCorrection.desktop.standaloneCustomProjectBlocks === 0 && report.productCorrection.desktop.finalContactBlocks === 1, 'Product CTA blocks were not merged.');
  assert(report.productCorrection.desktop.finalActions.includes('Запросить расчёт↗') && report.productCorrection.desktop.finalActions.includes('Обсудить задачу↗'), 'Product CTA labels are incorrect.');
  assert(report.gallery.navigation.afterRight === '2 / 2' && report.gallery.navigation.afterPrevious === '1 / 2', 'Desktop gallery navigation failed.');
  assert(report.gallery.lightboxOpen.open && report.gallery.lightboxOpen.focusWrapped && report.gallery.lightboxOpen.controlsOutsideMedia, 'Lightbox modal, controls, or focus trap failed.');
  assert(!report.gallery.lightboxClosed.open && report.gallery.lightboxClosed.focusReturned, 'Lightbox close or focus return failed.');
  assert(report.gallery.mobileSwipe.afterHorizontal === '2 / 2' && report.gallery.mobileSwipe.afterVertical === '2 / 2', 'Mobile swipe handling failed.');
  assert(report.navigation.dropdowns.every((item) => item.controls && item.opened && item.closed && item.focusReturned), 'Desktop dropdown keyboard behavior failed.');
  assert(report.navigation.mobileOpen.visible && report.navigation.mobileOpen.initialFocus && report.navigation.mobileOpen.bodyLocked && report.navigation.mobileOpen.mainInert, 'Mobile menu open state failed.');
  assert(report.navigation.mobileClosed.hidden && report.navigation.mobileClosed.focusReturned && report.navigation.mobileClosed.bodyUnlocked, 'Mobile menu close state failed.');
  assert(report.footer.desktop.desktopNavVisible && report.footer.desktop.accordionsHidden, 'Desktop footer presentation regressed.');
  assert(report.footer.mobile.accordionCount === 2 && report.footer.mobile.accordionsClosed && report.footer.mobile.desktopNavHidden, 'Mobile footer accordion presentation failed.');
  assert(report.footer.mobile.cta.includes('Запросить расчёт') && report.footer.mobile.directContactValues.length === 5, 'Mobile footer contacts or CTA are incomplete.');
  assert(report.footer.keyboardOpen.open && report.footer.keyboardOpen.focusStayedOnSummary, 'Native footer accordion keyboard behavior failed.');
  assert(allDiagnostics.every((item) => !item.page.overflow), 'Horizontal page overflow detected.');
  assert(allDiagnostics.every((item) => item.brokenImages.length === 0), 'Broken image detected.');
  assert(allDiagnostics.every((item) => item.duplicateIds.length === 0), 'Duplicate ID detected.');
  assert(allDiagnostics.every((item) => item.unlabeledButtons === 0), 'Unlabeled button detected.');
  assert(allDiagnostics.every((item) => item.h1Count === 1), 'Each V2 page must contain exactly one H1.');
  assert(allDiagnostics.every((item) => item.noindex.includes('noindex')), 'V2 route missing noindex.');
  assert(Object.values(report.links).every((item) => item.failed.length === 0), 'Broken local link detected.');
  assert(report.reducedMotion.mediaMatches && report.reducedMotion.pendingReveals === 0 && report.reducedMotion.scrollBehavior === 'auto', 'Reduced-motion fallback failed.');
  assert(report.homeRegression.footerAccordions === 0, 'home-v2 footer markup changed unexpectedly.');
  assert(runtimeErrors.length === 0, 'Runtime or console error detected.');

  progress('all checks passed');
} finally {
  cdp.close();
  browser.kill();
  await delay(450);
  const resolvedProfile = path.resolve(profileDir);
  if (resolvedProfile.startsWith(`${outputDir}${path.sep}`)) {
    await rm(resolvedProfile, { recursive: true, force: true }).catch(() => {});
  }
}

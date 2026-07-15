import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.env.HOME_V2_URL || 'http://127.0.0.1:4321/design-lab/home-v2/';
const outputDir = path.resolve('docs/design-lab/prototypes');
const externalDebugPort = Number(process.env.HOME_V2_CDP_PORT || 0);
const debugPort = externalDebugPort || (9300 + Math.floor(Math.random() * 300));
const profileDir = externalDebugPort ? null : await mkdtemp(path.join(os.tmpdir(), 'smu1-home-v2-chrome-'));

await mkdir(outputDir, { recursive: true });

const browser = externalDebugPort
  ? null
  : spawn(chromePath, [
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
const progress = (message) => process.stderr.write(`[home-v2 capture] ${message}\n`);

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
      const listeners = this.events.get(message.method) || [];
      listeners.forEach((listener) => listener(message.params || {}));
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const listeners = this.events.get(method) || [];
        this.events.set(method, listeners.filter((listener) => listener !== done));
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const done = (params) => {
        clearTimeout(timer);
        const listeners = this.events.get(method) || [];
        this.events.set(method, listeners.filter((listener) => listener !== done));
        resolve(params);
      };
      const listeners = this.events.get(method) || [];
      listeners.push(done);
      this.events.set(method, listeners);
    });
  }

  close() {
    this.socket.close();
  }
}

const webSocketUrl = await waitForDebugger();
const cdp = new CdpClient(webSocketUrl);
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const evaluate = async (expression, awaitPromise = true) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed.');
  return result.result?.value;
};

const setViewport = async (width, height, mobile = false) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
    positionX: 0,
    positionY: 0,
    dontSetVisibleSize: false
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
};

const navigate = async (url) => {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  await evaluate(`(async () => {
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 1800))
      ]);
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
  await delay(700);
};

const warmLazyMedia = async () => {
  await evaluate(`(async () => {
    document.querySelectorAll('[data-hv2-gallery-pause]').forEach((button) => {
      if (button.getAttribute('aria-pressed') === 'false') button.click();
    });
    document.querySelectorAll('img[loading="lazy"]').forEach((image) => {
      image.loading = 'eager';
    });
    const height = document.documentElement.scrollHeight;
    for (let y = 0; y < height; y += 620) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 55));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 240));
    await Promise.race([Promise.all(Array.from(document.images).map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        });
      }
      if (typeof image.decode === 'function' && image.naturalWidth > 0) {
        await image.decode().catch(() => {});
      }
    })), new Promise((resolve) => setTimeout(resolve, 8000))]);
    document.querySelectorAll('.hv2-reveal-pending').forEach((element) => {
      element.classList.remove('hv2-reveal-pending');
      element.classList.add('hv2-reveal-visible');
    });
    document.querySelectorAll('[data-reveal]').forEach((element) => {
      element.style.opacity = '1';
      element.style.transform = 'none';
      element.style.transition = 'none';
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
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

const saveFullPage = async (filename, width, viewportHeight, mobile) => {
  await evaluate(`(() => {
    document.documentElement.dataset.hv2CaptureScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
  })()`);

  const pageHeight = await evaluate('document.documentElement.scrollHeight');
  const maxScroll = Math.max(0, pageHeight - viewportHeight);
  const requestedOffsets = [];
  const captureStep = Math.max(1, Math.floor(viewportHeight / 2));
  for (let offset = 0; offset <= maxScroll; offset += captureStep) requestedOffsets.push(offset);
  if (requestedOffsets.at(-1) !== maxScroll) requestedOffsets.push(maxScroll);

  const partsDir = await mkdtemp(path.join(outputDir, '.home-v2-parts-'));
  const segments = [];

  for (let index = 0; index < requestedOffsets.length; index += 1) {
    const requestedOffset = requestedOffsets[index];
    const actualOffset = await evaluate(`(async () => {
      const header = document.querySelector('.hv2-header');
      const palette = document.querySelector('.hv2-palette-switch');
      const sectionNav = document.querySelector('.hv2-section-nav');
      if (header) header.style.visibility = ${index === 0 ? "'visible'" : "'hidden'"};
      if (palette) palette.style.visibility = ${index === 0 ? "'visible'" : "'hidden'"};
      if (sectionNav) sectionNav.style.visibility = ${requestedOffset === viewportHeight ? "'visible'" : "'hidden'"};
      window.scrollTo(0, ${requestedOffset});
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 720));
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

  const outputPath = path.join(outputDir, filename);
  await sharp({
    create: {
      width,
      height: pageHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite(segments.map((segment) => ({
      input: segment.path,
      left: 0,
      top: segment.y
    })))
    .png()
    .toFile(outputPath);

  await evaluate(`(() => {
    document.documentElement.style.scrollBehavior = document.documentElement.dataset.hv2CaptureScrollBehavior;
    delete document.documentElement.dataset.hv2CaptureScrollBehavior;
    document.querySelectorAll('.hv2-header, .hv2-palette-switch, .hv2-section-nav').forEach((element) => {
      element.style.visibility = '';
    });
    window.scrollTo(0, 0);
  })()`);
  const resolvedParts = path.resolve(partsDir);
  const resolvedOutput = path.resolve(outputDir);
  if (resolvedParts.startsWith(`${resolvedOutput}${path.sep}`)) {
    await rm(resolvedParts, { recursive: true, force: true });
  }
  await delay(300);
};

const collectPageDiagnostics = () => evaluate(`(() => ({
  viewport: { width: innerWidth, height: innerHeight },
  page: {
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    overflow: document.documentElement.scrollWidth > innerWidth
  },
  brokenImages: Array.from(document.images)
    .filter((image) => image.complete && image.naturalWidth === 0)
    .map((image) => image.getAttribute('src')),
  duplicateIds: Array.from(document.querySelectorAll('[id]'))
    .map((element) => element.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index),
  unlabeledButtons: Array.from(document.querySelectorAll('button'))
    .filter((button) => !(button.textContent || '').trim() && !button.getAttribute('aria-label'))
    .length,
  competencyNames: ['Уличная мебель','Ограждения и заборы','Навесы и козырьки','Металлоконструкции','Топиарии','Благоустройство территорий','Строительство и ремонты']
    .filter((name) => document.body.innerText.includes(name)),
  videos: Array.from(document.querySelectorAll('video source')).map((source) => source.getAttribute('src')),
  headerScrolled: document.querySelector('[data-home-v2-header]')?.classList.contains('is-scrolled') || false
}))()`);

const report = { screenshots: [], diagnostics: {} };

try {
  progress('starting desktop Olive');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  await setViewport(1440, 1000, false);
  await navigate(`${baseUrl}?palette=olive`);
  await saveViewport('home-v2-olive-desktop-top.png');
  progress('saved desktop top');
  report.screenshots.push('home-v2-olive-desktop-top.png');
  report.diagnostics.desktopTop = await collectPageDiagnostics();

  const desktopDropdowns = await evaluate(`(async () => {
    const triggers = Array.from(document.querySelectorAll('[data-hv2-dropdown-trigger]'));
    const states = [];
    for (const trigger of triggers) {
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
      states.push({ label: trigger.textContent.trim(), expanded: trigger.getAttribute('aria-expanded') });
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }
    return states;
  })()`);
  report.diagnostics.desktopDropdowns = desktopDropdowns;

  await warmLazyMedia();
  progress('warmed desktop media');
  await saveFullPage('home-v2-olive-desktop-full.png', 1440, 1000, false);
  progress('saved desktop full');
  report.screenshots.push('home-v2-olive-desktop-full.png');
  await evaluate(`window.scrollTo(0, document.querySelector('#directions').offsetTop + 260)`);
  await delay(380);
  await saveViewport('home-v2-olive-desktop-scrolled.png');
  progress('saved desktop scrolled');
  report.screenshots.push('home-v2-olive-desktop-scrolled.png');
  report.diagnostics.desktopScrolled = await collectPageDiagnostics();

  await setViewport(390, 844, true);
  progress('starting mobile Olive');
  await navigate(`${baseUrl}?palette=olive`);
  await saveViewport('home-v2-olive-mobile-top.png');
  progress('saved mobile top');
  report.screenshots.push('home-v2-olive-mobile-top.png');
  report.diagnostics.mobile390Top = await collectPageDiagnostics();
  await warmLazyMedia();
  await saveFullPage('home-v2-olive-mobile-full.png', 390, 844, true);
  progress('saved mobile full');
  report.screenshots.push('home-v2-olive-mobile-full.png');

  await navigate(`${baseUrl}?palette=olive`);
  const mobileMenuOpen = await evaluate(`(async () => {
    const button = document.querySelector('[data-hv2-mobile-open]');
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 360));
    return {
      expanded: button.getAttribute('aria-expanded'),
      menuHidden: document.querySelector('[data-hv2-mobile-menu]').hidden,
      activeLabel: document.activeElement?.getAttribute('aria-label'),
      bodyLocked: getComputedStyle(document.body).position === 'fixed',
      mainInert: document.querySelector('main').hasAttribute('inert')
    };
  })()`);
  report.diagnostics.mobileMenuOpen = mobileMenuOpen;
  await saveViewport('home-v2-olive-mobile-menu.png');
  progress('saved mobile menu');
  report.screenshots.push('home-v2-olive-mobile-menu.png');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await delay(340);
  report.diagnostics.mobileMenuClosed = await evaluate(`(() => ({
    expanded: document.querySelector('[data-hv2-mobile-open]').getAttribute('aria-expanded'),
    menuHidden: document.querySelector('[data-hv2-mobile-menu]').hidden,
    focusReturned: document.activeElement === document.querySelector('[data-hv2-mobile-open]'),
    bodyUnlocked: getComputedStyle(document.body).position !== 'fixed'
  }))()`);

  await setViewport(1440, 1000, false);
  progress('starting Steel captures');
  await navigate(`${baseUrl}?palette=steel`);
  await saveViewport('home-v2-steel-desktop-top.png');
  progress('saved Steel desktop');
  report.screenshots.push('home-v2-steel-desktop-top.png');

  await setViewport(390, 844, true);
  await navigate(`${baseUrl}?palette=steel`);
  await saveViewport('home-v2-steel-mobile-top.png');
  progress('saved Steel mobile');
  report.screenshots.push('home-v2-steel-mobile-top.png');

  await setViewport(320, 844, true);
  await navigate(`${baseUrl}?palette=olive`);
  report.diagnostics.mobile320 = await collectPageDiagnostics();

  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  progress('checking reduced motion');
  await navigate(`${baseUrl}?palette=olive`);
  const reducedBefore = await evaluate(`(() => ({
    videoPaused: document.querySelector('[data-hv2-hero-video]').paused,
    videoVisible: document.querySelector('[data-hv2-hero]').classList.contains('is-video-playing'),
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    galleryStates: Array.from(document.querySelectorAll('[data-hv2-gallery-status]')).map((item) => item.textContent.trim()),
    pendingReveals: document.querySelectorAll('.hv2-reveal-pending').length
  }))()`);
  await delay(5900);
  const reducedAfter = await evaluate(`Array.from(document.querySelectorAll('[data-hv2-gallery-status]')).map((item) => item.textContent.trim())`);
  report.diagnostics.reducedMotion = { ...reducedBefore, galleryStatesAfter: reducedAfter };

  const localLinks = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('a[href]'))
    .map((link) => link.href)
    .filter((href) => href.startsWith(location.origin))))`);
  const failedLinks = [];
  for (const href of localLinks) {
    const cleanUrl = new URL(href);
    cleanUrl.hash = '';
    const response = await fetch(cleanUrl);
    if (!response.ok) failedLinks.push({ href: cleanUrl.toString(), status: response.status });
  }
  report.diagnostics.localLinkCount = localLinks.length;
  report.diagnostics.failedLinks = failedLinks;

  progress('completed diagnostics');

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  cdp.close();
  browser?.kill();
  await delay(500);
  if (profileDir) {
    const resolvedProfile = path.resolve(profileDir);
    const resolvedTemp = path.resolve(os.tmpdir());
    if (resolvedProfile.startsWith(`${resolvedTemp}${path.sep}`)) {
      await rm(resolvedProfile, { recursive: true, force: true }).catch(() => {});
    }
  }
}

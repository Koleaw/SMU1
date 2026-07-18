import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const optionValue = (name) => argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const options = {
  help: hasFlag('--help') || hasFlag('-h'),
  headful: hasFlag('--headful'),
  json: hasFlag('--json'),
  externalOrigin: optionValue('--origin').trim().replace(/\/$/, '')
};

if (options.help) {
  process.stdout.write(`Focused final-design browser QA\n\n`);
  process.stdout.write(`  node tools/migration/browser-final-design-qa.mjs\n`);
  process.stdout.write(`      Serve ./dist locally and test product split, image-ready reveal, hero handoff and sticky nav.\n`);
  process.stdout.write(`  node tools/migration/browser-final-design-qa.mjs --origin=http://127.0.0.1:4321\n`);
  process.stdout.write(`      Test an existing local server (image delay assertion is skipped).\n`);
  process.stdout.write(`  Optional: --headful, --json, CHROME_PATH=/path/to/chrome.\n`);
  process.stdout.write(`  The script uses only local resources and never writes reports or screenshots.\n`);
  process.exit(0);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const content = (collection) => fs.readdirSync(path.join(root, 'src', 'content', collection))
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(fs.readFileSync(path.join(root, 'src', 'content', collection, name), 'utf8')));
const products = content('products');
const categoryBySlug = new Map(content('product-categories').map((record) => [record.slug, record]));
const productRoute = (product) => {
  const category = categoryBySlug.get(product.productCategorySlug);
  if (!category) throw new Error(`Category ${product.productCategorySlug} was not found for ${product.slug}.`);
  return `/${category.parentSectionSlug}/${category.slug}/${product.slug}/`;
};
const premiumProduct = products.find((product) => product.slug === 'kachel-portal' && product.presentationType === 'premium')
  || products.find((product) => product.presentationType === 'premium' && product.image);
const standardProduct = products.find((product) => product.slug === 'skamya-park' && product.presentationType === 'standard')
  || products.find((product) => product.presentationType === 'standard' && product.image);
if (!premiumProduct || !standardProduct) throw new Error('Both an image-backed premium and standard product are required for browser QA.');

const routes = {
  home: '/',
  premium: productRoute(premiumProduct),
  standard: productRoute(standardProduct),
  premiumCategory: (() => {
    const category = categoryBySlug.get(premiumProduct.productCategorySlug);
    return `/${category.parentSectionSlug}/${category.slug}/`;
  })()
};
const checks = [];
const failures = [];
const record = (id, ok, details = {}) => {
  const row = { id, status: ok ? 'pass' : 'fail', ...details };
  checks.push(row);
  if (!ok) failures.push(row);
  return ok;
};
const mimeTypes = {
  '.avif': 'image/avif', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml', '.webm': 'video/webm',
  '.webp': 'image/webp', '.xml': 'application/xml; charset=utf-8'
};
const imageDelayMs = Math.max(6500, Number.parseInt(process.env.FINAL_QA_IMAGE_DELAY_MS || '6800', 10) || 6800);
const delayedImagePath = new URL(premiumProduct.image, 'http://qa.local/').pathname;
let delayedImageRequestUsed = false;
let invalidImageRequestPending = false;

let server = null;
let origin = options.externalOrigin;
if (origin) {
  const parsed = new URL(origin);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error(`--origin must be local; received ${parsed.hostname}.`);
  }
} else {
  const distInfo = await stat(distRoot).catch(() => null);
  if (!distInfo?.isDirectory()) throw new Error('dist is missing; run npm run build before browser QA.');
  const port = 4800 + Math.floor(Math.random() * 500);
  origin = `http://127.0.0.1:${port}`;
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', origin);
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
        const fallback = await readFile(path.join(distRoot, '404.html'));
        response.writeHead(404, {
          'cache-control': 'no-store',
          'content-length': String(fallback.length),
          'content-type': 'text/html; charset=utf-8'
        }).end(request.method === 'HEAD' ? undefined : fallback);
        return;
      }
      if (request.method !== 'HEAD' && pathname === delayedImagePath && invalidImageRequestPending) {
        invalidImageRequestPending = false;
        const invalidImage = Buffer.from('not-a-decodable-image');
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-length': String(invalidImage.length),
          'content-type': 'image/jpeg'
        }).end(invalidImage);
        return;
      }
      const body = request.method === 'HEAD' ? null : await readFile(filename);
      if (request.method !== 'HEAD' && pathname === delayedImagePath && !delayedImageRequestUsed) {
        delayedImageRequestUsed = true;
        await delay(imageDelayMs);
      }
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
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chromePath) {
  if (server) await new Promise((resolve) => server.close(resolve));
  throw new Error('Chrome/Edge was not found. Set CHROME_PATH to a local Chromium executable.');
}

const profileRoot = path.join(root, '.astro');
await mkdir(profileRoot, { recursive: true });
const profileDir = await mkdtemp(path.join(profileRoot, 'smu1-final-design-qa-'));
const debugPort = 11500 + Math.floor(Math.random() * 400);
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
  '--window-size=1600,1000',
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

  send(method, params = {}, timeoutMs = 20_000) {
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
const waitForCondition = async (expression, timeoutMs = 15_000, intervalMs = 50) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return true; } catch {}
    await delay(intervalMs);
  }
  return false;
};
const setViewport = (width, height, mobile = false) => cdp.send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height,
  positionX: 0, positionY: 0, dontSetVisibleSize: false
});
const settle = (milliseconds = 100) => evaluate(`(async () => {
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1000))]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, ${milliseconds}));
  return { pathname: location.pathname, readyState: document.readyState };
})()`);
const navigate = async (route, milliseconds = 100) => {
  const target = new URL(route, origin);
  const result = await cdp.send('Page.navigate', { url: target.href });
  if (result.errorText) throw new Error(`Navigation failed for ${route}: ${result.errorText}`);
  const ready = await waitForCondition(`location.pathname === ${JSON.stringify(target.pathname)} && document.readyState === 'complete'`, 25_000);
  if (!ready) throw new Error(`Page readiness timed out for ${route}.`);
  await settle(milliseconds);
};
const waitForLocalImages = (timeoutMs = 5000) => evaluate(`(async () => {
  const images = Array.from(document.images).filter((image) => {
    const source = image.currentSrc || image.src;
    try { return source && new URL(source, location.href).origin === location.origin; } catch { return false; }
  });
  images.forEach((image) => { image.loading = 'eager'; });
  await Promise.race([
    Promise.all(images.map(async (image) => {
      if (!image.complete) await new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
      if (image.complete && image.naturalWidth > 0 && image.decode) await image.decode().catch(() => {});
    })),
    new Promise((resolve) => setTimeout(resolve, ${timeoutMs}))
  ]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return images.length;
})()`);

const pageDiagnostics = () => evaluate(`(() => {
  const root = document.documentElement;
  const localImages = Array.from(document.images).filter((image) => {
    const source = image.currentSrc || image.src;
    try { return source && new URL(source, location.href).origin === location.origin; } catch { return false; }
  });
  const visible = (element) => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const h1 = document.querySelector('h1');
  const h1Rect = h1?.getBoundingClientRect();
  return {
    route: location.pathname,
    h1Count: document.querySelectorAll('h1').length,
    h1FontSize: h1 ? Number.parseFloat(getComputedStyle(h1).fontSize) : 0,
    h1OutsideViewport: h1Rect ? h1Rect.left < -1 || h1Rect.right > root.clientWidth + 1 : true,
    horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
    brokenImages: localImages.filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.currentSrc || image.src),
    unreadyVisibleImages: localImages.filter((image) => visible(image) && !image.complete).map((image) => image.currentSrc || image.src),
    pendingRevealInViewport: Array.from(document.querySelectorAll('.hv2-reveal-pending')).filter((element) => {
      const rect = element.getBoundingClientRect();
      return visible(element) && rect.bottom >= 0 && rect.top <= innerHeight;
    }).length
  };
})()`);

const inspectProduct = () => evaluate(`(() => {
  const root = document.querySelector('[data-product-presentation]');
  const premiumSections = Array.from(document.querySelectorAll('[data-premium-product-section]'));
  return {
    presentation: root?.getAttribute('data-product-presentation') || '',
    premiumSections: premiumSections.length,
    emptyPremiumSections: premiumSections.filter((section) => (section.textContent || '').replace(/\s+/g, ' ').trim().length < 20).length,
    h1Count: document.querySelectorAll('h1').length,
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    productOverview: Boolean(document.getElementById('product-overview')),
    sectionNav: Boolean(document.querySelector('[data-v2-section-nav]'))
  };
})()`);

const runListingPresentationAudit = async () => {
  await setViewport(1440, 900, false);
  await navigate(routes.premiumCategory, 120);
  const listing = await evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('[data-product-card-presentation]'));
    const standard = cards.filter((card) => card.getAttribute('data-product-card-presentation') === 'standard');
    const premium = cards.filter((card) => card.getAttribute('data-product-card-presentation') === 'premium');
    return {
      total: cards.length,
      standard: standard.length,
      premium: premium.length,
      premiumWithIndicator: premium.filter((card) => card.querySelector('[data-product-presentation-indicator="premium"]')
        ?.textContent?.replace(/\s+/g, ' ').trim() === 'Решение для объекта').length,
      standardWithIndicator: standard.filter((card) => card.querySelector('[data-product-presentation-indicator]')).length,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
    };
  })()`);
  record('presentation.listing-indicator', listing.total > 0 && listing.standard > 0 && listing.premium > 0
    && listing.premiumWithIndicator === listing.premium && listing.standardWithIndicator === 0
    && listing.horizontalOverflow <= 2, { route: routes.premiumCategory, listing });
};

const runImageReadyAudit = async () => {
  if (options.externalOrigin) {
    record('image-ready.delayed-reveal', true, { skippedPendingPhase: true, reason: '--origin cannot inject deterministic image latency' });
    await navigate(routes.premium, 160);
    await waitForLocalImages();
    const final = await evaluate(`(() => {
      const image = document.querySelector('[data-product-presentation="premium"] [data-v2-image]');
      const reveal = image?.closest('[data-v2-reveal], [data-reveal]');
      return { complete: image?.complete || false, naturalWidth: image?.naturalWidth || 0,
        ready: reveal?.classList.contains('v2-image-ready') || false,
        awaiting: reveal?.classList.contains('v2-image-awaiting') || false };
    })()`);
    record('image-ready.final-state', final.complete && final.naturalWidth > 0 && final.ready && !final.awaiting, final);
    return;
  }

  const target = new URL(routes.premium, origin);
  const navigation = await cdp.send('Page.navigate', { url: target.href });
  if (navigation.errorText) throw new Error(`Navigation failed for image-ready audit: ${navigation.errorText}`);
  const pendingObserved = await waitForCondition(`(() => {
    if (location.pathname !== ${JSON.stringify(target.pathname)}) return false;
    const image = document.querySelector('[data-product-presentation="premium"] [data-v2-image]');
    const catalog = document.querySelector('[data-catalog-v2-root]');
    return Boolean(image && catalog?.dataset.enhancementsReady === 'true' && !image.complete);
  })()`, 6000);
  await delay(160);
  const pending = await evaluate(`(() => {
    const image = document.querySelector('[data-product-presentation="premium"] [data-v2-image]');
    const reveal = image?.closest('[data-v2-reveal], [data-reveal]');
    const style = reveal ? getComputedStyle(reveal) : null;
    return {
      observed: ${pendingObserved},
      imageComplete: image?.complete || false,
      awaiting: reveal?.classList.contains('v2-image-awaiting') || false,
      ready: reveal?.classList.contains('v2-image-ready') || false,
      revealVisible: reveal?.classList.contains('hv2-reveal-visible') || false,
      opacity: style ? Number.parseFloat(style.opacity || '1') : 1
    };
  })()`);
  record('image-ready.delayed-reveal', pending.observed && !pending.imageComplete && pending.awaiting
    && !pending.ready && !pending.revealVisible && pending.opacity <= 0.05, pending);

  await delay(Math.max(0, 6200 - 160));
  const slowNetwork = await evaluate(`(() => {
    const image = document.querySelector('[data-product-presentation="premium"] [data-v2-image]');
    const reveal = image?.closest('[data-v2-reveal], [data-reveal]');
    const host = image?.closest('[data-v2-media]');
    const fallback = host?.querySelector('[data-v2-image-fallback]');
    const fallbackStyle = fallback ? getComputedStyle(fallback) : null;
    return {
      imageComplete: image?.complete || false,
      imageHidden: image?.hidden || false,
      awaiting: reveal?.classList.contains('v2-image-awaiting') || false,
      ready: reveal?.classList.contains('v2-image-ready') || false,
      fallbackState: reveal?.classList.contains('v2-image-fallback') || false,
      revealVisible: reveal?.classList.contains('hv2-reveal-visible') || false,
      readiness: reveal?.getAttribute('data-v2-image-ready') || '',
      mediaState: host?.getAttribute('data-v2-media-state') || '',
      fallbackVisible: Boolean(fallback && fallbackStyle?.display !== 'none' && fallback.getBoundingClientRect().height > 0),
      fallbackText: fallback?.textContent?.replace(/\s+/g, ' ').trim() || '',
      fallbackAriaHidden: fallback?.getAttribute('aria-hidden') || ''
    };
  })()`);
  record('image-ready.timeout-fallback', !slowNetwork.imageComplete && slowNetwork.imageHidden
    && !slowNetwork.awaiting && !slowNetwork.ready && slowNetwork.fallbackState && slowNetwork.revealVisible
    && slowNetwork.readiness === 'fallback' && slowNetwork.mediaState === 'fallback'
    && slowNetwork.fallbackVisible && slowNetwork.fallbackText.length > 5
    && slowNetwork.fallbackAriaHidden === 'false', slowNetwork);

  const loaded = await waitForCondition(`(() => {
    const image = document.querySelector('[data-product-presentation="premium"] [data-v2-image]');
    return Boolean(image?.complete && image.naturalWidth > 0);
  })()`, 10_000);
  await settle(700);
  const final = await evaluate(`(() => {
    const image = document.querySelector('[data-product-presentation="premium"] [data-v2-image]');
    const reveal = image?.closest('[data-v2-reveal], [data-reveal]');
    const host = image?.closest('[data-v2-media]');
    const fallback = host?.querySelector('[data-v2-image-fallback]');
    return {
      loaded: ${loaded}, complete: image?.complete || false, naturalWidth: image?.naturalWidth || 0,
      imageHidden: image?.hidden || false,
      awaiting: reveal?.classList.contains('v2-image-awaiting') || false,
      ready: reveal?.classList.contains('v2-image-ready') || false,
      revealVisible: reveal?.classList.contains('hv2-reveal-visible') || false,
      readiness: reveal?.getAttribute('data-v2-image-ready') || '',
      mediaState: host?.getAttribute('data-v2-media-state') || '',
      fallbackAriaHidden: fallback?.getAttribute('aria-hidden') || ''
    };
  })()`);
  record('image-ready.final-state', final.loaded && final.complete && final.naturalWidth > 0
    && !final.imageHidden && final.ready && !final.awaiting && final.revealVisible
    && final.readiness === 'ready' && final.mediaState === 'ready'
    && final.fallbackAriaHidden === 'true', final);
};

const runImageErrorAudit = async () => {
  if (options.externalOrigin) {
    record('image-ready.error-fallback', true, { skipped: true, reason: '--origin cannot inject deterministic invalid image bytes' });
    return;
  }

  invalidImageRequestPending = true;
  await navigate(routes.premium, 120);
  const reachedFallback = await waitForCondition(`(() => {
    const image = document.querySelector('[data-product-presentation="premium"] [data-v2-image]');
    const reveal = image?.closest('[data-v2-reveal], [data-reveal]');
    return reveal?.getAttribute('data-v2-image-ready') === 'fallback';
  })()`, 8000);
  const state = await evaluate(`(() => {
    const image = document.querySelector('[data-product-presentation="premium"] [data-v2-image]');
    const reveal = image?.closest('[data-v2-reveal], [data-reveal]');
    const host = image?.closest('[data-v2-media]');
    const fallback = host?.querySelector('[data-v2-image-fallback]');
    const style = fallback ? getComputedStyle(fallback) : null;
    return {
      reachedFallback: ${reachedFallback},
      imageComplete: image?.complete || false,
      naturalWidth: image?.naturalWidth || 0,
      imageHidden: image?.hidden || false,
      readiness: reveal?.getAttribute('data-v2-image-ready') || '',
      revealVisible: reveal?.classList.contains('hv2-reveal-visible') || false,
      mediaState: host?.getAttribute('data-v2-media-state') || '',
      fallbackVisible: Boolean(fallback && style?.display !== 'none' && fallback.getBoundingClientRect().height > 0),
      fallbackText: fallback?.textContent?.replace(/\s+/g, ' ').trim() || '',
      fallbackAriaHidden: fallback?.getAttribute('aria-hidden') || ''
    };
  })()`);
  record('image-ready.error-fallback', state.reachedFallback && state.imageComplete && state.naturalWidth === 0
    && state.imageHidden && state.readiness === 'fallback' && state.revealVisible
    && state.mediaState === 'fallback' && state.fallbackVisible && state.fallbackText.length > 5
    && state.fallbackAriaHidden === 'false', state);
};

const runHeroScrollAudit = async (name, route) => {
  await navigate(route, 180);
  await evaluate(`scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
  await settle(80);
  const initial = await evaluate(`(() => {
    const hero = document.querySelector('[data-v2-hero-scroll]');
    const copy = hero?.querySelector('[data-v2-hero-scroll-copy]');
    const header = document.querySelector('[data-home-v2-header]');
    if (!hero || !copy) return null;
    const heroRect = hero.getBoundingClientRect(), copyRect = copy.getBoundingClientRect();
    return { heroHeight: heroRect.height, heroTop: heroRect.top, copyTop: copyRect.top, copyBottom: copyRect.bottom,
      copyOpacity: Number.parseFloat(getComputedStyle(copy).opacity || '1'), headerHeight: header?.offsetHeight || 0,
      scrollVar: getComputedStyle(hero).getPropertyValue('--v2-hero-scroll-y').trim() };
  })()`);
  if (!initial) {
    record(`hero-scroll.${name}`, false, { route, issue: 'missing [data-v2-hero-scroll] / copy marker' });
    return;
  }
  const requestedScroll = Math.min(620, Math.max(300, Math.round(initial.heroHeight * 0.55)));
  const middle = await evaluate(`(async () => {
    window.scrollTo({ top: ${requestedScroll}, left: 0, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 140));
    const hero = document.querySelector('[data-v2-hero-scroll]');
    const copy = hero.querySelector('[data-v2-hero-scroll-copy]');
    const header = document.querySelector('[data-home-v2-header]');
    const copyRect = copy.getBoundingClientRect(), headerRect = header?.getBoundingClientRect();
    const headerVisible = Boolean(header && !header.classList.contains('is-hidden') && headerRect.bottom > 1);
    let headerOwnsOverlap = true;
    if (headerVisible && copyRect.top < headerRect.bottom && copyRect.bottom > headerRect.top) {
      const x = Math.max(1, Math.min(innerWidth - 1, copyRect.left + Math.min(copyRect.width / 2, 100)));
      const y = Math.max(1, Math.min(headerRect.bottom - 1, Math.max(headerRect.top + 1, copyRect.top + 1)));
      headerOwnsOverlap = Boolean(document.elementFromPoint(x, y)?.closest('[data-home-v2-header]'));
    }
    return { scrollY, copyTop: copyRect.top, copyBottom: copyRect.bottom,
      copyOpacity: Number.parseFloat(getComputedStyle(copy).opacity || '1'),
      scrollVar: getComputedStyle(hero).getPropertyValue('--v2-hero-scroll-y').trim(),
      headerVisible, headerOwnsOverlap };
  })()`);
  const movement = initial.copyTop - middle.copyTop;
  const movementRatio = middle.scrollY ? movement / middle.scrollY : 0;
  const handoffScroll = Math.min(initial.heroHeight + 120, await evaluate(`Math.max(0, document.documentElement.scrollHeight - innerHeight)`));
  const end = await evaluate(`(async () => {
    window.scrollTo({ top: ${handoffScroll}, left: 0, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 140));
    const hero = document.querySelector('[data-v2-hero-scroll]');
    const copy = hero.querySelector('[data-v2-hero-scroll-copy]');
    const rect = copy.getBoundingClientRect();
    return { scrollY, top: rect.top, bottom: rect.bottom, opacity: Number.parseFloat(getComputedStyle(copy).opacity || '1'),
      scrollVar: getComputedStyle(hero).getPropertyValue('--v2-hero-scroll-y').trim() };
  })()`);
  const changedVariable = middle.scrollVar && middle.scrollVar !== initial.scrollVar && !/^0(?:px)?$/.test(middle.scrollVar);
  const slowerThanPage = movementRatio >= 0.35 && movementRatio <= 0.96;
  const fullyHandedOff = end.bottom <= 2 || end.opacity <= 0.08;
  record(`hero-scroll.${name}`, changedVariable && slowerThanPage && middle.copyOpacity <= initial.copyOpacity
    && middle.headerOwnsOverlap && fullyHandedOff, {
    route, initial, middle, end, movement, movementRatio, changedVariable, slowerThanPage, fullyHandedOff
  });
};

const runStickyNavAudit = async (viewportName, width, height, mobile = false) => {
  await setViewport(width, height, mobile);
  await navigate(routes.premium, 180);
  const initial = await evaluate(`(() => {
    const nav = document.querySelector('[data-v2-section-nav]');
    const link = nav?.querySelector('[data-v2-section-nav-link]');
    if (!nav || !link) return null;
    const navStyle = getComputedStyle(nav), linkStyle = getComputedStyle(link);
    return { position: navStyle.position, navHeight: nav.getBoundingClientRect().height,
      fontSize: Number.parseFloat(linkStyle.fontSize), fontWeight: Number.parseInt(linkStyle.fontWeight, 10) || 0,
      offsetTop: nav.offsetTop, links: nav.querySelectorAll('[data-v2-section-nav-link]').length };
  })()`);
  if (!initial) {
    record(`sticky-nav.${viewportName}`, false, { issue: 'missing sticky nav' });
    return;
  }
  const stuck = await evaluate(`(async () => {
    const nav = document.querySelector('[data-v2-section-nav]');
    window.scrollTo({ top: nav.offsetTop + Math.max(180, innerHeight * 0.35), left: 0, behavior: 'instant' });
    await new Promise((resolve) => setTimeout(resolve, 520));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const header = document.querySelector('[data-home-v2-header]');
    const navRect = nav.getBoundingClientRect(), headerRect = header?.getBoundingClientRect();
    const headerVisible = Boolean(header && !header.classList.contains('is-hidden') && headerRect.bottom > 1);
    const overlap = headerVisible && navRect.top < headerRect.bottom - 2;
    const links = Array.from(nav.querySelectorAll('[data-v2-section-nav-link]'));
    const targetLink = links[1] || links[0];
    targetLink?.click();
    await new Promise((resolve) => setTimeout(resolve, 1050));
    const target = targetLink?.hash ? document.getElementById(decodeURIComponent(targetLink.hash.slice(1))) : null;
    const finalHeaderRect = header?.getBoundingClientRect();
    const finalHeaderVisible = Boolean(header && !header.classList.contains('is-hidden') && finalHeaderRect.bottom > 1);
    const requiredTop = (finalHeaderVisible ? finalHeaderRect.bottom : 0) + nav.getBoundingClientRect().height;
    return { navTop: navRect.top, headerBottom: headerRect?.bottom || 0, headerVisible, overlap,
      currentLinks: nav.querySelectorAll('[aria-current="location"]').length,
      clickedCurrent: targetLink?.getAttribute('aria-current') || '',
      targetTop: target?.getBoundingClientRect().top ?? -9999, requiredTop,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth) };
  })()`);
  const typographyOk = initial.fontSize >= (mobile ? 12 : 12.5) && initial.fontWeight >= 600 && initial.navHeight >= 48;
  const topTarget = stuck.headerVisible ? stuck.headerBottom : 0;
  const placementOk = !stuck.overlap && stuck.navTop >= -1 && stuck.navTop <= topTarget + 4;
  const anchorOk = stuck.currentLinks === 1 && stuck.clickedCurrent === 'location' && stuck.targetTop >= stuck.requiredTop - 18;
  record(`sticky-nav.${viewportName}`, initial.position === 'sticky' && typographyOk && placementOk && anchorOk
    && stuck.horizontalOverflow <= 2, { initial, stuck, typographyOk, placementOk, anchorOk });
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
  await Promise.all([
    cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable'), cdp.send('Log.enable')
  ]);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.setBlockedURLs', {
    urls: [
      '*://fonts.googleapis.com/*', '*://fonts.gstatic.com/*',
      '*://mc.yandex.ru/*', '*://api-maps.yandex.ru/*', '*://yandex.ru/*'
    ]
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } }); } catch {}`
  });
  await setViewport(1440, 900, false);

  await runImageReadyAudit();
  await runImageErrorAudit();

  for (const [expected, route] of [['standard', routes.standard], ['premium', routes.premium]]) {
    await navigate(route, 180);
    await waitForLocalImages();
    const product = await inspectProduct();
    const diagnostics = await pageDiagnostics();
    const structureOk = product.presentation === expected && product.h1Count === 1 && product.productOverview
      && (expected === 'standard' ? product.premiumSections === 0 : product.premiumSections >= 1 && product.emptyPremiumSections === 0);
    record(`presentation.${expected}`, structureOk, { route, product });
    record(`responsive.${expected}-desktop`, diagnostics.horizontalOverflow <= 2 && diagnostics.h1Count === 1
      && !diagnostics.h1OutsideViewport && diagnostics.brokenImages.length === 0
      && diagnostics.unreadyVisibleImages.length === 0, diagnostics);
  }

  await runListingPresentationAudit();

  await runHeroScrollAudit('home', routes.home);
  await runHeroScrollAudit('premium-product', routes.premium);
  await runStickyNavAudit('desktop', 1440, 900, false);
  await runStickyNavAudit('mobile', 390, 844, true);

  for (const [expected, route] of [['standard', routes.standard], ['premium', routes.premium]]) {
    await setViewport(390, 844, true);
    await navigate(route, 120);
    await waitForLocalImages();
    const diagnostics = await pageDiagnostics();
    record(`responsive.${expected}-mobile`, diagnostics.horizontalOverflow <= 2 && diagnostics.h1Count === 1
      && !diagnostics.h1OutsideViewport && diagnostics.h1FontSize >= 32 && diagnostics.brokenImages.length === 0
      && diagnostics.unreadyVisibleImages.length === 0, diagnostics);
  }

  record('runtime.console-and-exceptions', runtimeErrors.length === 0, { errors: runtimeErrors.slice(0, 20), total: runtimeErrors.length });
  record('runtime.local-network', networkErrors.length === 0, { errors: networkErrors.slice(0, 20), total: networkErrors.length });
} catch (error) {
  record('browser.fatal', false, { error: error instanceof Error ? error.stack : String(error) });
} finally {
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  }
  await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), delay(3500)]);
  if (browser.exitCode === null) browser.kill('SIGKILL');
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

const summary = {
  result: failures.length ? 'fail' : 'pass',
  checks: checks.length,
  passed: checks.length - failures.length,
  failed: failures.length,
  routes,
  failures
};
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

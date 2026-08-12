import fs, { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { gzip as gzipCallback } from 'node:zlib';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const gzip = promisify(gzipCallback);
const root = process.cwd();
const argv = process.argv.slice(2);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const argumentValue = (name) => {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '') : '';
};
const hasFlag = (name) => argv.includes(name);
const options = {
  help: hasFlag('--help') || hasFlag('-h'),
  headful: hasFlag('--headful'),
  origin: argumentValue('--origin').trim(),
  artifacts: argumentValue('--artifacts').trim(),
  sha: argumentValue('--sha').trim(),
  phase: argumentValue('--phase').trim(),
  profile: argumentValue('--profile').trim(),
  resume: hasFlag('--resume'),
  overwrite: hasFlag('--overwrite'),
  validateResume: hasFlag('--validate-resume')
};

if (options.help) {
  process.stdout.write(`SMU-1 H5 report-only laboratory performance capture\n\n`);
  process.stdout.write(`  node tools/performance/lab-performance.mjs \\\n`);
  process.stdout.write(`    --origin=http://127.0.0.1:4321/ --artifacts=/tmp/smu1-h5-performance-qa \\\n`);
  process.stdout.write(`    --sha=<exact-tested-sha> --phase=baseline|final\n\n`);
  process.stdout.write(`The command never builds or edits production files. It creates deterministic artifact paths,\n`);
  process.stdout.write(`uses raw Chrome DevTools Protocol, and is intentionally not a blocking CI gate.\n`);
  process.stdout.write(`Optional: --headful, --profile=mobile-slow4g-cpu4|desktop-fixed, and CHROME_PATH.\n`);
  process.stdout.write(`Existing report semantics:\n`);
  process.stdout.write(`  --resume     Keep completed matching runs and retry missing/failed runs.\n`);
  process.stdout.write(`  --overwrite  Start a new report and overwrite prior report JSON for this phase.\n`);
  process.stdout.write(`  --validate-resume  Validate report identity and exit before launching Chrome.\n`);
  process.exit(0);
}

if (!options.origin || !options.artifacts || !options.sha || !['baseline', 'final'].includes(options.phase)) {
  throw new Error('Required arguments: --origin, --artifacts, --sha and --phase=baseline|final. Use --help for details.');
}
if (options.resume && options.overwrite) throw new Error('--resume and --overwrite are mutually exclusive.');
if (options.validateResume && !options.resume) throw new Error('--validate-resume requires --resume.');

const suppliedOrigin = new URL(options.origin);
if (!['http:', 'https:'].includes(suppliedOrigin.protocol)) {
  throw new Error(`--origin must use http or https; received ${suppliedOrigin.protocol}`);
}
suppliedOrigin.hash = '';
suppliedOrigin.search = '';
const basePath = suppliedOrigin.pathname === '/'
  ? '/'
  : `/${suppliedOrigin.pathname.replace(/^\/+|\/+$/g, '')}/`;
const siteOrigin = suppliedOrigin.origin;
const artifactRoot = path.resolve(options.artifacts, options.phase);

const stableSort = (value) => {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSort(value[key])]));
};
const stableJson = (value) => `${JSON.stringify(stableSort(value), null, 2)}\n`;
const writeJson = async (filename, value) => {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, stableJson(value), 'utf8');
};
const relativeArtifact = (filename) => path.relative(artifactRoot, filename).split(path.sep).join('/');
const safeName = (value) => String(value).replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
const routeHref = (route) => {
  const suffix = route === '/' ? '' : route.replace(/^\/+/, '');
  return new URL(`${basePath}${suffix}`, siteOrigin).href;
};

const readProjectRoute = async () => {
  const directory = path.join(root, 'src', 'content', 'projects');
  const names = await fs.promises.readdir(directory).catch(() => []);
  const projects = [];
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    try {
      const project = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      if (project?.isActive && project?.slug) projects.push(project);
    } catch {}
  }
  projects.sort((left, right) => Number(left.order || 0) - Number(right.order || 0)
    || String(left.slug).localeCompare(String(right.slug), 'en'));
  return projects[0]?.slug ? `/vypolnennye-obekty/${projects[0].slug}/` : '';
};

const projectDetailRoute = await readProjectRoute();
if (!projectDetailRoute) throw new Error('No active project detail route could be resolved from src/content/projects.');

const routeProfiles = [
  { key: 'home', template: 'home', route: '/', repetitions: 3, entryModes: ['first-entry', 'subsequent'] },
  { key: 'section-hub', template: 'section-hub', route: '/ulichnaya-mebel/', repetitions: 3, entryModes: ['subsequent'] },
  { key: 'category', template: 'category', route: '/ulichnaya-mebel/urny/', repetitions: 3, entryModes: ['subsequent'] },
  { key: 'standard-product', template: 'standard-product', route: '/ulichnaya-mebel/urny/urna-ellips/', repetitions: 3, entryModes: ['subsequent'] },
  { key: 'premium-product', template: 'premium-product', route: '/ulichnaya-mebel/lavochki-i-skameyki/bolshaya-skameyka-amplituda/', repetitions: 3, entryModes: ['subsequent'] },
  { key: 'projects-archive', template: 'projects-archive', route: '/vypolnennye-obekty/', repetitions: 3, entryModes: ['subsequent'] },
  { key: 'topiary', template: 'topiary', route: '/topiarii/', repetitions: 3, entryModes: ['subsequent'] },
  { key: 'project-detail', template: 'project-detail', route: projectDetailRoute, repetitions: 1, entryModes: ['subsequent'] },
  { key: 'company', template: 'company-practical', route: '/o-nas/', repetitions: 1, entryModes: ['subsequent'] },
  { key: 'contacts', template: 'contacts', route: '/kontakty/', repetitions: 1, entryModes: ['subsequent'] }
];

// Throughput is expressed in bytes per second, as required by CDP.
const deviceProfiles = [
  {
    key: 'mobile-slow4g-cpu4',
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true },
    network: {
      label: 'Slow 4G',
      latencyMs: 150,
      downloadBytesPerSecond: 1_600_000 / 8,
      uploadBytesPerSecond: 750_000 / 8,
      connectionType: 'cellular4g'
    },
    cpuSlowdown: 4
  },
  {
    key: 'desktop-fixed',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, touch: false },
    network: {
      label: 'Fixed desktop 10 Mbps / 5 Mbps / 40 ms',
      latencyMs: 40,
      downloadBytesPerSecond: 10_000_000 / 8,
      uploadBytesPerSecond: 5_000_000 / 8,
      connectionType: 'wifi'
    },
    cpuSlowdown: 1
  }
];
const selectedDeviceProfiles = options.profile
  ? deviceProfiles.filter((profile) => profile.key === options.profile)
  : deviceProfiles;
if (selectedDeviceProfiles.length === 0) {
  throw new Error(`Unknown --profile=${options.profile}; expected ${deviceProfiles.map((profile) => profile.key).join(' or ')}.`);
}

const expectedReportIdentity = {
  kind: 'smu1-h5-report-only-lab-performance',
  phase: options.phase,
  sha: options.sha,
  origin: `${siteOrigin}${basePath}`
};
const existingReportFile = path.join(artifactRoot, 'report.json');
const existingPartialReportFile = path.join(artifactRoot, 'report.partial.json');
let resumeSeed = null;
if (options.resume) {
  const filename = existsSync(existingReportFile)
    ? existingReportFile
    : existsSync(existingPartialReportFile) ? existingPartialReportFile : '';
  if (!filename) {
    throw new Error(`--resume requested, but neither ${existingReportFile} nor ${existingPartialReportFile} exists.`);
  }
  const previous = JSON.parse(await readFile(filename, 'utf8'));
  const mismatches = Object.entries(expectedReportIdentity)
    .filter(([key, expected]) => previous[key] !== expected)
    .map(([key, expected]) => `${key}=${JSON.stringify(previous[key])} (expected ${JSON.stringify(expected)})`);
  if (mismatches.length) throw new Error(`Refusing --resume because report identity differs: ${mismatches.join(', ')}`);
  if (!Array.isArray(previous.runs)) throw new Error(`Cannot resume malformed runs from ${filename}.`);
  resumeSeed = { filename, report: previous };
} else if (!options.overwrite && (existsSync(existingReportFile) || existsSync(existingPartialReportFile))) {
  throw new Error(`Performance report already exists below ${artifactRoot}; use --resume or --overwrite explicitly.`);
}
if (options.validateResume) {
  process.stdout.write(stableJson({
    status: 'pass',
    report: resumeSeed.filename,
    identity: expectedReportIdentity,
    runs: resumeSeed.report.runs.length,
    completedRuns: resumeSeed.report.runs.filter((run) => run.status === 'completed').length
  }));
  process.exit(0);
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chromePath) throw new Error('Chrome/Edge was not found. Set CHROME_PATH to a Chromium executable.');

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
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
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        try { listener(message.params || {}); } catch {}
      }
    });
    this.socket.addEventListener('close', () => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP connection closed during ${pending.method} (${id}).`));
      }
      this.pending.clear();
    }, { once: true });
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  once(method, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        dispose();
        reject(new Error(`CDP event ${method} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      const dispose = this.on(method, (params) => {
        clearTimeout(timer);
        dispose();
        resolve(params);
      });
    });
  }

  close() {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

const debugPort = 13100 + Math.floor(Math.random() * 500);
const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'smu1-h5-performance-profile-'));
const chromiumStderrPath = path.join(artifactRoot, 'chromium-stderr.log');
await mkdir(artifactRoot, { recursive: true });
const chromiumStderr = fs.createWriteStream(chromiumStderrPath, { flags: 'w' });
const browserProcess = spawn(chromePath, [
  options.headful ? '--new-window' : '--headless=new',
  '--disable-background-networking',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-features=Translate',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-default-browser-check',
  '--no-first-run',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileRoot}`,
  `--disk-cache-dir=${path.join(profileRoot, 'cache')}`,
  `--crash-dumps-dir=${path.join(artifactRoot, 'crash-dumps')}`,
  '--window-size=1600,1000',
  'about:blank'
], {
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
  env: { ...process.env, TEMP: profileRoot, TMP: profileRoot }
});
browserProcess.stderr?.pipe(chromiumStderr);
let browserSpawnError = '';
browserProcess.once('error', (error) => { browserSpawnError = String(error?.message || error); });
const browserExit = new Promise((resolve) => {
  browserProcess.once('exit', (code, signal) => resolve({ code, signal }));
  browserProcess.once('error', (error) => resolve({ code: null, signal: null, error: String(error?.message || error) }));
});

const waitForBrowserEndpoint = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (browserSpawnError) throw new Error(`Chrome failed to start: ${browserSpawnError}`);
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) {
        const descriptor = await response.json();
        if (descriptor.webSocketDebuggerUrl) return descriptor;
      }
    } catch {}
    await delay(120);
  }
  throw new Error('Chrome DevTools endpoint did not become available.');
};

const waitForTargetSocket = async (targetId) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = response.ok ? await response.json() : [];
      const target = targets.find((candidate) => candidate.id === targetId || candidate.targetId === targetId);
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch {}
    await delay(80);
  }
  throw new Error(`Page target ${targetId} did not expose a DevTools socket.`);
};

const evaluate = async (cdp, expression) => {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed.');
  }
  return response.result?.value;
};

const waitForExpression = async (cdp, expression, timeoutMs, intervalMs = 100) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return true;
    } catch {}
    await delay(intervalMs);
  }
  return false;
};

const entryAndMetricsBootstrap = (entryMode) => `(() => {
  try {
    const id = 'h5-performance-tab';
    window.name = '__smu1_browser_tab_v1__:' + id;
    sessionStorage.setItem('smu1:browser-tab:v1', id);
    sessionStorage.removeItem('smu1:page-transition:v2');
    if (${JSON.stringify(entryMode)} === 'subsequent') sessionStorage.setItem('smu1:entry-intro:v2', 'seen');
    else sessionStorage.removeItem('smu1:entry-intro:v2');
  } catch {}

  const state = {
    paints: {},
    lcp: null,
    layoutShifts: [],
    longTasks: [],
    observerErrors: []
  };
  Object.defineProperty(globalThis, '__SMU1_H5_PERFORMANCE__', {
    configurable: true,
    value: state
  });
  const selectorFor = (node) => {
    if (!(node instanceof Element)) return '';
    const tag = node.tagName.toLowerCase();
    const id = node.id ? '#' + node.id : '';
    const classes = [...node.classList].slice(0, 3).map((name) => '.' + name).join('');
    return (tag + id + classes).slice(0, 240);
  };
  const rectFor = (rect) => rect ? {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left
  } : null;
  const observe = (type, callback) => {
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe({ type, buffered: true });
    } catch (error) {
      state.observerErrors.push({ type, message: String(error && error.message || error) });
    }
  };
  observe('paint', (entries) => {
    for (const entry of entries) state.paints[entry.name] = entry.startTime;
  });
  observe('largest-contentful-paint', (entries) => {
    for (const entry of entries) {
      const element = entry.element;
      const rect = element instanceof Element ? element.getBoundingClientRect() : null;
      state.lcp = {
        startTime: entry.startTime,
        renderTime: entry.renderTime || 0,
        loadTime: entry.loadTime || 0,
        size: entry.size || 0,
        url: entry.url || '',
        id: entry.id || '',
        element: selectorFor(element),
        currentSrc: element instanceof HTMLImageElement ? element.currentSrc : '',
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
      };
    }
  });
  observe('layout-shift', (entries) => {
    for (const entry of entries) {
      if (entry.hadRecentInput) continue;
      state.layoutShifts.push({
        startTime: entry.startTime,
        value: entry.value,
        sources: (entry.sources || []).map((source) => ({
          node: selectorFor(source.node),
          previousRect: rectFor(source.previousRect),
          currentRect: rectFor(source.currentRect)
        }))
      });
    }
  });
  observe('longtask', (entries) => {
    for (const entry of entries) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  });
})()`;

const collectPageMetricsExpression = `(() => {
  const state = globalThis.__SMU1_H5_PERFORMANCE__ || { paints: {}, layoutShifts: [], longTasks: [] };
  const navigation = performance.getEntriesByType('navigation')[0] || null;
  const measurementEnd = performance.now();
  const fcp = Number(state.paints && state.paints['first-contentful-paint']) || null;
  const shifts = (state.layoutShifts || []).slice().sort((a, b) => a.startTime - b.startTime);
  let cls = 0;
  let windowValue = 0;
  let windowStart = 0;
  let previous = 0;
  for (const shift of shifts) {
    if (!windowStart || shift.startTime - previous > 1000 || shift.startTime - windowStart > 5000) {
      windowStart = shift.startTime;
      windowValue = shift.value;
    } else {
      windowValue += shift.value;
    }
    previous = shift.startTime;
    cls = Math.max(cls, windowValue);
  }
  const longTasks = (state.longTasks || []).filter((entry) => !fcp || entry.startTime + entry.duration >= fcp);
  const tbt = longTasks.reduce((sum, entry) => {
    const effectiveStart = fcp ? Math.max(entry.startTime, fcp) : entry.startTime;
    const duration = Math.max(0, Math.min(entry.startTime + entry.duration, measurementEnd) - effectiveStart);
    return sum + Math.max(0, duration - 50);
  }, 0);
  return {
    measurementEnd,
    fcp,
    lcp: state.lcp || null,
    cls,
    clsTotal: shifts.reduce((sum, entry) => sum + entry.value, 0),
    layoutShifts: shifts,
    tbt,
    longTasks,
    observerErrors: state.observerErrors || [],
    navigation: navigation ? {
      type: navigation.type,
      startTime: navigation.startTime,
      redirectStart: navigation.redirectStart,
      redirectEnd: navigation.redirectEnd,
      fetchStart: navigation.fetchStart,
      domainLookupStart: navigation.domainLookupStart,
      domainLookupEnd: navigation.domainLookupEnd,
      connectStart: navigation.connectStart,
      secureConnectionStart: navigation.secureConnectionStart,
      connectEnd: navigation.connectEnd,
      requestStart: navigation.requestStart,
      responseStart: navigation.responseStart,
      responseEnd: navigation.responseEnd,
      domInteractive: navigation.domInteractive,
      domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
      loadEventEnd: navigation.loadEventEnd,
      transferSize: navigation.transferSize,
      encodedBodySize: navigation.encodedBodySize,
      decodedBodySize: navigation.decodedBodySize,
      ttfb: Math.max(0, navigation.responseStart - navigation.requestStart)
    } : null,
    document: {
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      pageState: document.documentElement.dataset.v2PageState || '',
      entryState: document.querySelector('[data-v2-entry-root]')?.getAttribute('data-v2-entry-state') || '',
      entryBootstrap: document.documentElement.dataset.v2EntryBootstrap || '',
      entranceState: document.documentElement.dataset.v2EntranceState || ''
    }
  };
})()`;

const collectMediaExpression = `(() => ({
  images: [...document.images].map((image, index) => {
    const rect = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    return {
      index,
      src: image.getAttribute('src') || '',
      currentSrc: image.currentSrc || '',
      srcset: image.getAttribute('srcset') || '',
      sizes: image.getAttribute('sizes') || '',
      loading: image.loading || image.getAttribute('loading') || '',
      fetchPriority: image.fetchPriority || image.getAttribute('fetchpriority') || '',
      decoding: image.decoding || image.getAttribute('decoding') || '',
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      declaredWidth: image.getAttribute('width') || '',
      declaredHeight: image.getAttribute('height') || '',
      rendered: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      devicePixelRatio,
      requiredPhysicalWidth: rect.width * devicePixelRatio,
      selectedWidthRatio: rect.width > 0 && image.naturalWidth > 0
        ? image.naturalWidth / (rect.width * devicePixelRatio)
        : null,
      firstViewport: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
      opacity: style.opacity,
      pictureSources: image.closest('picture')
        ? [...image.closest('picture').querySelectorAll('source')].map((source) => ({
            type: source.type || '', media: source.media || '', srcset: source.srcset || '', sizes: source.sizes || ''
          }))
        : []
    };
  }),
  videos: [...document.querySelectorAll('video')].map((video, index) => {
    const rect = video.getBoundingClientRect();
    return {
      index,
      currentSrc: video.currentSrc || '',
      poster: video.poster || video.getAttribute('poster') || '',
      preload: video.preload,
      autoplay: video.autoplay,
      paused: video.paused,
      readyState: video.readyState,
      networkState: video.networkState,
      rendered: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      sources: [...video.querySelectorAll('source')].map((source) => ({
        src: source.src || source.getAttribute('src') || '', type: source.type || '', media: source.media || ''
      }))
    };
  })
}))()`;

const mergeRanges = (ranges) => {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.startOffset) && Number.isFinite(range.endOffset) && range.endOffset > range.startOffset)
    .sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.startOffset <= previous.endOffset) previous.endOffset = Math.max(previous.endOffset, range.endOffset);
    else merged.push({ startOffset: range.startOffset, endOffset: range.endOffset });
  }
  return merged;
};
const rangesLength = (ranges) => ranges.reduce((sum, range) => sum + range.endOffset - range.startOffset, 0);
const subtractRanges = (totalCharacters, excludedRanges) => {
  const excluded = mergeRanges(excludedRanges).map((range) => ({
    startOffset: Math.max(0, Math.min(totalCharacters, range.startOffset)),
    endOffset: Math.max(0, Math.min(totalCharacters, range.endOffset))
  })).filter((range) => range.endOffset > range.startOffset);
  const included = [];
  let cursor = 0;
  for (const range of excluded) {
    if (range.startOffset > cursor) included.push({ startOffset: cursor, endOffset: range.startOffset });
    cursor = Math.max(cursor, range.endOffset);
  }
  if (cursor < totalCharacters) included.push({ startOffset: cursor, endOffset: totalCharacters });
  return included;
};

const createNetworkTracker = () => ({
  requests: new Map(),
  completedRedirects: [],
  failures: [],
  documentTimestamp: null,
  loadTimestamp: null,
  measurementTimestamp: null
});

const compileNetwork = (tracker, pageMetrics) => {
  const navigationTimestamp = tracker.documentTimestamp
    ?? Math.min(...[...tracker.requests.values()].map((request) => request.timestamp).filter(Number.isFinite));
  const loadMs = pageMetrics?.navigation?.loadEventEnd || null;
  const lcpMs = pageMetrics?.lcp?.startTime || null;
  const rows = [...tracker.completedRedirects, ...tracker.requests.values()].map((request) => {
    const transferBytes = Math.max(request.finishedEncodedDataLength || 0, request.encodedDataReceived || 0);
    const startMs = Number.isFinite(navigationTimestamp) ? (request.timestamp - navigationTimestamp) * 1000 : null;
    const endMs = Number.isFinite(request.endTimestamp) && Number.isFinite(navigationTimestamp)
      ? (request.endTimestamp - navigationTimestamp) * 1000
      : null;
    return {
      requestId: request.requestId,
      redirectIndex: request.redirectIndex || 0,
      url: request.url,
      method: request.method,
      resourceType: request.resourceType || request.responseType || 'Other',
      mimeType: request.mimeType || '',
      status: request.status ?? null,
      protocol: request.protocol || '',
      priority: request.priority || '',
      initiator: request.initiator || null,
      startMs,
      endMs,
      durationMs: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null,
      transferBytes,
      decodedBodyBytes: request.decodedBodyReceived || 0,
      fromDiskCache: Boolean(request.fromDiskCache),
      fromPrefetchCache: Boolean(request.fromPrefetchCache),
      fromServiceWorker: Boolean(request.fromServiceWorker),
      servedFromCache: Boolean(request.servedFromCache),
      startedBeforeLoad: Number.isFinite(startMs) && Number.isFinite(loadMs) ? startMs <= loadMs : null,
      completedBeforeLoad: Number.isFinite(endMs) && Number.isFinite(loadMs) ? endMs <= loadMs : null,
      startedBeforeLcp: Number.isFinite(startMs) && Number.isFinite(lcpMs) ? startMs <= lcpMs : null,
      completedBeforeLcp: Number.isFinite(endMs) && Number.isFinite(lcpMs) ? endMs <= lcpMs : null,
      failed: Boolean(request.failed),
      canceled: Boolean(request.canceled),
      errorText: request.errorText || '',
      dataEvents: request.dataEvents.map((event) => ({
        atMs: Number.isFinite(navigationTimestamp) ? (event.timestamp - navigationTimestamp) * 1000 : null,
        encodedBytes: event.encodedBytes,
        decodedBytes: event.decodedBytes
      }))
    };
  }).sort((left, right) => (left.startMs ?? Number.MAX_VALUE) - (right.startMs ?? Number.MAX_VALUE)
    || left.url.localeCompare(right.url, 'en'));

  const bytesByType = {};
  for (const row of rows) bytesByType[row.resourceType] = (bytesByType[row.resourceType] || 0) + row.transferBytes;
  const lcpResourceUrl = pageMetrics?.lcp?.currentSrc || pageMetrics?.lcp?.url || '';
  const lcpRequest = lcpResourceUrl
    ? rows.find((row) => row.url === lcpResourceUrl || row.url.split('#')[0] === lcpResourceUrl.split('#')[0]) || null
    : null;
  const bodyBytesBefore = (limitMs) => rows.reduce((total, row) => total + row.dataEvents
    .filter((event) => Number.isFinite(event.atMs) && event.atMs <= limitMs)
    .reduce((sum, event) => sum + event.encodedBytes, 0), 0);
  return {
    requestCount: rows.length,
    transferBytes: rows.reduce((sum, row) => sum + row.transferBytes, 0),
    encodedBodyBytesBeforeLoad: Number.isFinite(loadMs) ? bodyBytesBefore(loadMs) : null,
    encodedBodyBytesBeforeLcp: Number.isFinite(lcpMs) ? bodyBytesBefore(lcpMs) : null,
    lcpResourceUrl,
    lcpRequest,
    bytesByType,
    requests: rows,
    errors: [
      ...tracker.failures,
      ...rows.filter((row) => Number(row.status) >= 400).map((row) => ({
        kind: 'http', url: row.url, status: row.status, resourceType: row.resourceType
      }))
    ]
  };
};

const attachPageObservers = (cdp, active) => {
  cdp.on('Network.requestWillBeSent', (params) => {
    const tracker = active.network;
    if (!tracker) return;
    const previous = tracker.requests.get(params.requestId);
    let redirectIndex = previous?.redirectIndex || 0;
    if (previous && params.redirectResponse) {
      previous.status = params.redirectResponse.status;
      previous.mimeType = params.redirectResponse.mimeType;
      previous.protocol = params.redirectResponse.protocol;
      previous.endTimestamp = params.timestamp;
      previous.finishedEncodedDataLength = params.redirectResponse.encodedDataLength || previous.encodedDataReceived || 0;
      tracker.completedRedirects.push(previous);
      redirectIndex += 1;
    }
    const request = {
      requestId: params.requestId,
      redirectIndex,
      url: params.request.url,
      method: params.request.method,
      timestamp: params.timestamp,
      resourceType: params.type || 'Other',
      priority: params.request.initialPriority || '',
      initiator: params.initiator ? {
        type: params.initiator.type || '',
        url: params.initiator.url || '',
        lineNumber: params.initiator.lineNumber ?? null
      } : null,
      encodedDataReceived: 0,
      decodedBodyReceived: 0,
      dataEvents: []
    };
    tracker.requests.set(params.requestId, request);
    if (params.type === 'Document' && !Number.isFinite(tracker.documentTimestamp)) tracker.documentTimestamp = params.timestamp;
  });
  cdp.on('Network.responseReceived', (params) => {
    const request = active.network?.requests.get(params.requestId);
    if (!request) return;
    request.responseType = params.type || '';
    request.status = params.response.status;
    request.mimeType = params.response.mimeType || '';
    request.protocol = params.response.protocol || '';
    request.fromDiskCache = params.response.fromDiskCache;
    request.fromPrefetchCache = params.response.fromPrefetchCache;
    request.fromServiceWorker = params.response.fromServiceWorker;
  });
  cdp.on('Network.dataReceived', (params) => {
    const request = active.network?.requests.get(params.requestId);
    if (!request) return;
    request.encodedDataReceived += params.encodedDataLength || 0;
    request.decodedBodyReceived += params.dataLength || 0;
    request.dataEvents.push({
      timestamp: params.timestamp,
      encodedBytes: params.encodedDataLength || 0,
      decodedBytes: params.dataLength || 0
    });
  });
  cdp.on('Network.loadingFinished', (params) => {
    const request = active.network?.requests.get(params.requestId);
    if (!request) return;
    request.endTimestamp = params.timestamp;
    request.finishedEncodedDataLength = params.encodedDataLength || 0;
  });
  cdp.on('Network.loadingFailed', (params) => {
    const tracker = active.network;
    const request = tracker?.requests.get(params.requestId);
    if (!tracker || !request) return;
    request.endTimestamp = params.timestamp;
    request.failed = true;
    request.canceled = params.canceled;
    request.errorText = params.errorText || '';
    tracker.failures.push({
      kind: 'network',
      url: request.url,
      resourceType: params.type || request.resourceType,
      errorText: params.errorText || '',
      canceled: Boolean(params.canceled),
      blockedReason: params.blockedReason || '',
      corsErrorStatus: params.corsErrorStatus || null
    });
  });
  cdp.on('Network.requestServedFromCache', (params) => {
    const request = active.network?.requests.get(params.requestId);
    if (request) request.servedFromCache = true;
  });
  cdp.on('Network.resourceChangedPriority', (params) => {
    const request = active.network?.requests.get(params.requestId);
    if (request) request.priority = params.newPriority || request.priority;
  });
  cdp.on('Page.loadEventFired', (params) => {
    if (active.network) active.network.loadTimestamp = params.timestamp;
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    if (!active.console) return;
    active.console.push({
      kind: 'exception',
      level: 'error',
      text: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Uncaught exception',
      url: params.exceptionDetails?.url || '',
      lineNumber: params.exceptionDetails?.lineNumber ?? null,
      columnNumber: params.exceptionDetails?.columnNumber ?? null
    });
  });
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (!active.console || !['error', 'warning', 'assert'].includes(params.type)) return;
    active.console.push({
      kind: 'console',
      level: params.type,
      text: params.args.map((argument) => argument.value ?? argument.description ?? '').join(' '),
      url: params.stackTrace?.callFrames?.[0]?.url || '',
      lineNumber: params.stackTrace?.callFrames?.[0]?.lineNumber ?? null
    });
  });
  cdp.on('Log.entryAdded', (params) => {
    if (!active.console || !['error', 'warning'].includes(params.entry?.level)) return;
    active.console.push({
      kind: 'log',
      level: params.entry.level,
      text: params.entry.text || '',
      url: params.entry.url || '',
      lineNumber: params.entry.lineNumber ?? null,
      source: params.entry.source || ''
    });
  });
};

const startEvidence = async (cdp) => {
  const state = {
    trace: { enabled: false, events: [], error: '' },
    coverage: { enabled: false, styleSheets: new Map(), error: '' }
  };
  cdp.on('Tracing.dataCollected', (params) => {
    if (state.trace.enabled) state.trace.events.push(...(params.value || []));
  });
  cdp.on('CSS.styleSheetAdded', (params) => {
    const header = params.header;
    if (header?.styleSheetId) state.coverage.styleSheets.set(header.styleSheetId, header);
  });
  try {
    await Promise.all([
      cdp.send('DOM.enable'),
      cdp.send('CSS.enable'),
      cdp.send('Profiler.enable'),
      cdp.send('Debugger.enable', { maxScriptsCacheSize: 20_000_000 })
    ]);
    await cdp.send('CSS.startRuleUsageTracking');
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true, allowTriggeredUpdates: false });
    state.coverage.enabled = true;
  } catch (error) {
    state.coverage.error = String(error?.message || error);
  }
  try {
    await cdp.send('Tracing.start', {
      categories: [
        '-*',
        'blink.user_timing',
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
        'disabled-by-default-devtools.screenshot',
        'loading',
        'rail'
      ].join(','),
      options: 'sampling-frequency=10000',
      transferMode: 'ReportEvents'
    });
    state.trace.enabled = true;
  } catch (error) {
    state.trace.error = String(error?.message || error);
  }
  return state;
};

const finishCoverage = async (cdp, state) => {
  if (!state.coverage.enabled) return { available: false, error: state.coverage.error, css: [], js: [] };
  try {
    const [cssDelta, jsDelta] = await Promise.all([
      cdp.send('CSS.takeCoverageDelta'),
      cdp.send('Profiler.takePreciseCoverage')
    ]);
    await Promise.allSettled([
      cdp.send('CSS.stopRuleUsageTracking'),
      cdp.send('Profiler.stopPreciseCoverage')
    ]);

    const cssUsage = new Map();
    for (const entry of cssDelta.coverage || []) {
      const row = cssUsage.get(entry.styleSheetId) || { used: [], seen: [] };
      row.seen.push({ startOffset: entry.startOffset, endOffset: entry.endOffset });
      if (entry.used) row.used.push({ startOffset: entry.startOffset, endOffset: entry.endOffset });
      cssUsage.set(entry.styleSheetId, row);
    }
    const css = [];
    for (const [styleSheetId, usage] of cssUsage) {
      const header = state.coverage.styleSheets.get(styleSheetId) || {};
      const source = await cdp.send('CSS.getStyleSheetText', { styleSheetId }).catch(() => ({ text: '' }));
      const usedRanges = mergeRanges(usage.used);
      const totalCharacters = String(source.text || '').length || Math.max(0, ...usage.seen.map((range) => range.endOffset));
      const usedCharacters = Math.min(totalCharacters, rangesLength(usedRanges));
      css.push({
        styleSheetId,
        url: header.sourceURL || header.sourceMapURL || '',
        inline: Boolean(header.isInline),
        totalCharacters,
        utf8Bytes: Buffer.byteLength(String(source.text || ''), 'utf8'),
        usedCharacters,
        usedRatio: totalCharacters ? usedCharacters / totalCharacters : null,
        usedRanges
      });
    }
    css.sort((left, right) => left.url.localeCompare(right.url, 'en') || left.styleSheetId.localeCompare(right.styleSheetId, 'en'));

    const js = [];
    for (const script of jsDelta.result || []) {
      const allRanges = script.functions.flatMap((fn) => fn.ranges || []);
      const source = await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId }).catch(() => ({ scriptSource: '' }));
      const totalCharacters = String(source.scriptSource || '').length
        || Math.max(0, ...allRanges.map((range) => range.endOffset));
      // V8 ranges are nested: an executed script/root range may contain an
      // unexecuted function range. Subtracting zero-count ranges preserves
      // those nested exclusions instead of incorrectly marking the full
      // parent range as used.
      const unusedRanges = mergeRanges(allRanges.filter((range) => range.count === 0));
      const usedRanges = allRanges.length ? subtractRanges(totalCharacters, unusedRanges) : [];
      const usedCharacters = Math.min(totalCharacters, rangesLength(usedRanges));
      js.push({
        scriptId: script.scriptId,
        url: script.url || '',
        functionCount: script.functions.length,
        totalCharacters,
        utf8Bytes: Buffer.byteLength(String(source.scriptSource || ''), 'utf8'),
        usedCharacters,
        usedRatio: totalCharacters ? usedCharacters / totalCharacters : null,
        usedRanges,
        unusedRanges
      });
    }
    js.sort((left, right) => left.url.localeCompare(right.url, 'en') || left.scriptId.localeCompare(right.scriptId, 'en'));
    return { available: true, error: '', css, js };
  } catch (error) {
    await Promise.allSettled([
      cdp.send('CSS.stopRuleUsageTracking'),
      cdp.send('Profiler.stopPreciseCoverage')
    ]);
    return { available: false, error: String(error?.message || error), css: [], js: [] };
  }
};

const finishTrace = async (cdp, state) => {
  if (!state.trace.enabled) return { available: false, error: state.trace.error, events: [] };
  try {
    const complete = cdp.once('Tracing.tracingComplete', 45_000);
    await cdp.send('Tracing.end');
    await complete;
    state.trace.enabled = false;
    return { available: true, error: '', events: state.trace.events };
  } catch (error) {
    state.trace.enabled = false;
    return { available: false, error: String(error?.message || error), events: state.trace.events };
  }
};

const writeEvidenceArtifacts = async ({ trace, coverage, artifactStem }) => {
  const artifacts = { trace: '', coverage: '', filmstrip: [] };
  if (coverage) {
    const filename = path.join(artifactRoot, 'coverage', `${artifactStem}.coverage.json`);
    await writeJson(filename, coverage);
    artifacts.coverage = relativeArtifact(filename);
  }
  if (trace) {
    const traceFilename = path.join(artifactRoot, 'traces', `${artifactStem}.trace.json.gz`);
    await mkdir(path.dirname(traceFilename), { recursive: true });
    const payload = await gzip(Buffer.from(JSON.stringify({ traceEvents: trace.events }), 'utf8'), { level: 6 });
    await writeFile(traceFilename, payload);
    artifacts.trace = relativeArtifact(traceFilename);

    const screenshotEvents = trace.events.filter((event) => event.name === 'Screenshot' && event.args?.snapshot);
    const maximumFrames = 30;
    const selected = screenshotEvents.length <= maximumFrames
      ? screenshotEvents
      : Array.from({ length: maximumFrames }, (_, index) => screenshotEvents[Math.round(index * (screenshotEvents.length - 1) / (maximumFrames - 1))]);
    const unique = [...new Map(selected.map((event) => [`${event.ts}:${event.args.snapshot.length}`, event])).values()];
    for (const [index, event] of unique.entries()) {
      const buffer = Buffer.from(event.args.snapshot, 'base64');
      const extension = buffer[0] === 0xff && buffer[1] === 0xd8 ? 'jpg' : 'png';
      const filename = path.join(artifactRoot, 'filmstrips', artifactStem, `frame-${String(index + 1).padStart(3, '0')}.${extension}`);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, buffer);
      artifacts.filmstrip.push({
        file: relativeArtifact(filename),
        traceTimestampMicroseconds: event.ts
      });
    }
  }
  return artifacts;
};

const configurePage = async (cdp, profile, cacheMode) => {
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable'),
    cdp.send('Log.enable'),
    cdp.send('Performance.enable', { timeDomain: 'timeTicks' }),
    cdp.send('Page.setLifecycleEventsEnabled', { enabled: true })
  ]);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: profile.viewport.width,
    height: profile.viewport.height,
    deviceScaleFactor: profile.viewport.deviceScaleFactor,
    mobile: profile.viewport.mobile,
    screenWidth: profile.viewport.width,
    screenHeight: profile.viewport.height,
    screenOrientation: profile.viewport.width > profile.viewport.height
      ? { type: 'landscapePrimary', angle: 90 }
      : { type: 'portraitPrimary', angle: 0 }
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', profile.viewport.touch
    ? { enabled: true, maxTouchPoints: 5 }
    : { enabled: false });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuSlowdown });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.network.latencyMs,
    downloadThroughput: profile.network.downloadBytesPerSecond,
    uploadThroughput: profile.network.uploadBytesPerSecond,
    connectionType: profile.network.connectionType
  });
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: cacheMode === 'cold' });
  if (cacheMode === 'cold') await cdp.send('Network.clearBrowserCache');
};

const settleExpression = `(() => {
  if (document.readyState !== 'complete') return false;
  const html = document.documentElement;
  const page = html.dataset.v2PageState || document.querySelector('[data-v2-page-transition]')?.getAttribute('data-v2-page-state') || '';
  const entry = document.querySelector('[data-v2-entry-root]')?.getAttribute('data-v2-entry-state') || '';
  const entrance = html.dataset.v2EntranceState || document.querySelector('[data-v2-entrance-root]')?.getAttribute('data-v2-entrance-state') || '';
  const pageDone = !['arrival', 'waiting', 'revealing', 'covering', 'covered', 'navigating'].includes(page);
  const entryDone = !['armed', 'logo', 'waiting', 'opening', 'assembling'].includes(entry);
  const entranceDone = !['armed', 'waiting', 'revealing'].includes(entrance);
  return pageDone && entryDone && entranceDone
    && !html.classList.contains('v2-page-transition-locked')
    && !html.classList.contains('v2-entry-scroll-locked');
})()`;

const capturePageRun = async ({
  cdp,
  active,
  profile,
  routeProfile,
  entryMode,
  cacheMode,
  runNumber,
  deepEvidence
}) => {
  const runLabel = `${cacheMode}-${String(runNumber).padStart(2, '0')}`;
  const artifactStem = [profile.key, routeProfile.key, entryMode, runLabel].map(safeName).join('/');
  active.network = createNetworkTracker();
  active.console = [];
  await configurePage(cdp, profile, cacheMode);
  const evidenceState = deepEvidence ? await startEvidence(cdp) : null;
  let pageMetrics = null;
  let performanceMetrics = [];
  let media = { images: [], videos: [] };
  let screenshotFile = '';
  let settled = false;
  let status = 'completed';
  let error = '';
  const startedAt = new Date().toISOString();

  try {
    const loadEvent = cdp.once('Page.loadEventFired', 90_000);
    const navigation = await cdp.send('Page.navigate', { url: routeHref(routeProfile.route) }, 30_000);
    if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
    await loadEvent;
    settled = await waitForExpression(cdp, settleExpression, 25_000, 125);
    await delay(1_500);
    pageMetrics = await evaluate(cdp, collectPageMetricsExpression);
    performanceMetrics = (await cdp.send('Performance.getMetrics')).metrics || [];
    media = await evaluate(cdp, collectMediaExpression);
    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    });
    const filename = path.join(artifactRoot, 'screenshots', `${artifactStem}.png`);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, Buffer.from(screenshot.data, 'base64'));
    screenshotFile = relativeArtifact(filename);
  } catch (runError) {
    status = 'failed';
    error = String(runError?.stack || runError?.message || runError);
    pageMetrics = await evaluate(cdp, collectPageMetricsExpression).catch(() => null);
    media = await evaluate(cdp, collectMediaExpression).catch(() => ({ images: [], videos: [] }));
  }

  active.network.measurementTimestamp = active.network.documentTimestamp === null
    ? null
    : active.network.documentTimestamp + Number(pageMetrics?.measurementEnd || 0) / 1000;
  const coverage = evidenceState ? await finishCoverage(cdp, evidenceState) : null;
  const trace = evidenceState ? await finishTrace(cdp, evidenceState) : null;
  const evidenceArtifacts = evidenceState
    ? await writeEvidenceArtifacts({ trace, coverage, artifactStem })
    : { trace: '', coverage: '', filmstrip: [] };
  const network = compileNetwork(active.network, pageMetrics);
  const consoleErrors = active.console.slice();
  active.network = null;
  active.console = null;

  const result = {
    schemaVersion: 1,
    phase: options.phase,
    sha: options.sha,
    profile: profile.key,
    routeKey: routeProfile.key,
    template: routeProfile.template,
    route: routeProfile.route,
    url: routeHref(routeProfile.route),
    entryMode,
    cacheMode,
    runNumber,
    deepEvidence,
    status,
    error,
    startedAt,
    settled,
    metrics: {
      lcpMs: pageMetrics?.lcp?.startTime ?? null,
      fcpMs: pageMetrics?.fcp ?? null,
      cls: pageMetrics?.cls ?? null,
      tbtMs: pageMetrics?.tbt ?? null,
      ttfbMs: pageMetrics?.navigation?.ttfb ?? null,
      longTaskCount: pageMetrics?.longTasks?.length ?? null,
      requestCount: network.requestCount,
      transferBytes: network.transferBytes,
      imageBytes: network.bytesByType.Image || 0,
      mediaBytes: network.bytesByType.Media || 0,
      stylesheetBytes: network.bytesByType.Stylesheet || 0,
      scriptBytes: network.bytesByType.Script || 0,
      fontBytes: network.bytesByType.Font || 0
    },
    pageMetrics,
    performanceMetrics,
    network,
    media,
    consoleErrors,
    artifacts: {
      screenshot: screenshotFile,
      ...evidenceArtifacts
    },
    evidenceErrors: {
      trace: trace?.error || '',
      coverage: coverage?.error || ''
    }
  };
  const resultFilename = path.join(artifactRoot, 'runs', `${artifactStem}.json`);
  await writeJson(resultFilename, result);
  return { ...result, resultFile: relativeArtifact(resultFilename) };
};

const createPageContext = async (browserCdp, profile, entryMode) => {
  let browserContextId = '';
  let pageCdp = null;
  try {
    ({ browserContextId } = await browserCdp.send('Target.createBrowserContext', {
      disposeOnDetach: false
    }));
    const { targetId } = await browserCdp.send('Target.createTarget', {
      url: 'about:blank',
      browserContextId,
      width: profile.viewport.width,
      height: profile.viewport.height
    });
    pageCdp = new CdpClient(await waitForTargetSocket(targetId));
    await pageCdp.connect();
    const active = { network: null, console: null };
    attachPageObservers(pageCdp, active);
    await Promise.all([
      pageCdp.send('Page.enable'),
      pageCdp.send('Runtime.enable')
    ]);
    await pageCdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: entryAndMetricsBootstrap(entryMode)
    });
    return { browserContextId, targetId, pageCdp, active };
  } catch (error) {
    pageCdp?.close();
    if (browserContextId) {
      await browserCdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    }
    throw error;
  }
};

const closePageContext = async (browserCdp, context) => {
  context.pageCdp.close();
  await browserCdp.send('Target.disposeBrowserContext', {
    browserContextId: context.browserContextId
  }).catch(() => {});
};

const numericSummary = (values) => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return { count: 0, min: null, median: null, max: null };
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { count: sorted.length, min: sorted[0], median, max: sorted.at(-1) };
};

const summarizeRuns = (runs) => {
  const groups = new Map();
  for (const run of runs.filter((candidate) => candidate.status === 'completed')) {
    const key = [run.profile, run.routeKey, run.entryMode, run.cacheMode].join('|');
    const group = groups.get(key) || [];
    group.push(run);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [profile, routeKey, entryMode, cacheMode] = key.split('|');
    const metric = (name) => numericSummary(group.map((run) => run.metrics[name]));
    return {
      profile,
      routeKey,
      route: group[0].route,
      entryMode,
      cacheMode,
      runs: group.length,
      lcpMs: metric('lcpMs'),
      fcpMs: metric('fcpMs'),
      cls: metric('cls'),
      tbtMs: metric('tbtMs'),
      ttfbMs: metric('ttfbMs'),
      requestCount: metric('requestCount'),
      transferBytes: metric('transferBytes'),
      imageBytes: metric('imageBytes'),
      stylesheetBytes: metric('stylesheetBytes'),
      scriptBytes: metric('scriptBytes'),
      fontBytes: metric('fontBytes')
    };
  }).sort((left, right) => left.profile.localeCompare(right.profile, 'en')
    || left.routeKey.localeCompare(right.routeKey, 'en')
    || left.entryMode.localeCompare(right.entryMode, 'en')
    || left.cacheMode.localeCompare(right.cacheMode, 'en'));
};

let browserCdp = null;
const report = {
  schemaVersion: 1,
  kind: 'smu1-h5-report-only-lab-performance',
  phase: options.phase,
  sha: options.sha,
  origin: `${siteOrigin}${basePath}`,
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    chromePath,
    browser: null
  },
  methodology: {
    independentColdRuns: 'A fresh incognito BrowserContext with disabled and cleared cache is used for every cold run.',
    warmRuns: 'One cache-enabled same-context repeat follows cold run 1 for each seven mandatory template profiles.',
    homeProfiles: ['first-entry', 'subsequent'],
    instrumentation: 'Run 1 of every route/profile/entry combination captures trace, filmstrip, CSS and JS coverage.',
    tbt: 'Laboratory approximation: sum(max(0, long-task portion after FCP minus 50 ms)) through measurement end.',
    cls: 'Maximum standard 1-second-gap/5-second layout-shift session window; shifts with recent input are excluded.',
    transfer: 'CDP Network.loadingFinished encodedDataLength; partial requests use received encoded chunks.',
    settle: 'Load event, H3/H4/entrance terminal-state polling, then a fixed 1500 ms observation window.'
  },
  limitations: {
    inp: 'No field data; INP is intentionally not reported.',
    speedIndex: 'Not calculated. Filmstrips and trace screenshots are retained for external analysis.',
    tbt: 'Reported TBT uses measurement end instead of Lighthouse time-to-interactive.',
    coverage: 'Coverage collection adds profiling overhead to instrumented run 1; medians include this marked run.',
    cache: 'Warm-cache transfer depends on the tested origin cache headers.'
  },
  profiles: deviceProfiles,
  routes: routeProfiles,
  runs: [],
  summaries: [],
  failures: []
};
const reportFile = existingReportFile;
const partialReportFile = existingPartialReportFile;
const runIdentity = ({ profile, routeKey, entryMode, cacheMode, runNumber }) => (
  [profile, routeKey, entryMode, cacheMode, runNumber].join('|')
);

if (resumeSeed) {
  const { filename, report: previous } = resumeSeed;
  // Last record for an identity wins. Failed records for selected profiles are
  // discarded so they are retried; completed records and out-of-scope profile
  // results are retained without duplication.
  const latest = new Map();
  for (const run of previous.runs) latest.set(runIdentity(run), run);
  report.runs = [...latest.values()].filter((run) => (
    run.status === 'completed' || !selectedDeviceProfiles.some((profile) => profile.key === run.profile)
  ));
  report.resumedFrom = relativeArtifact(filename);
  report.generatedAt = previous.generatedAt || report.generatedAt;
}

const persistPartialReport = async () => {
  report.summaries = summarizeRuns(report.runs);
  report.failures = report.runs.filter((run) => run.status !== 'completed').map((run) => ({
    profile: run.profile,
    routeKey: run.routeKey,
    entryMode: run.entryMode,
    cacheMode: run.cacheMode,
    runNumber: run.runNumber,
    error: run.error
  }));
  await writeJson(partialReportFile, report);
};

try {
  const endpoint = await waitForBrowserEndpoint();
  browserCdp = new CdpClient(endpoint.webSocketDebuggerUrl);
  await browserCdp.connect();
  const browserVersion = await browserCdp.send('Browser.getVersion');
  report.environment.browser = browserVersion;
  await writeJson(path.join(artifactRoot, 'manifests', 'capture-plan.json'), {
    schemaVersion: 1,
    phase: options.phase,
    sha: options.sha,
    origin: report.origin,
    profiles: selectedDeviceProfiles,
    routes: routeProfiles
  });

  for (const profile of selectedDeviceProfiles) {
    for (const routeProfile of routeProfiles) {
      for (const entryMode of routeProfile.entryModes) {
        for (let runNumber = 1; runNumber <= routeProfile.repetitions; runNumber += 1) {
          const warmRequired = runNumber === 1
            && routeProfile.repetitions === 3
            && entryMode === 'subsequent';
          const coldKey = runIdentity({ profile: profile.key, routeKey: routeProfile.key, entryMode, cacheMode: 'cold', runNumber });
          const warmKey = runIdentity({ profile: profile.key, routeKey: routeProfile.key, entryMode, cacheMode: 'warm', runNumber: 1 });
          const completed = new Set(report.runs.filter((run) => run.status === 'completed').map(runIdentity));
          if (completed.has(coldKey) && (!warmRequired || completed.has(warmKey))) {
            process.stdout.write(`SKIP ${profile.key} ${routeProfile.key} ${entryMode} run ${runNumber} (completed)\n`);
            continue;
          }
          // Warm evidence is only valid directly after its paired cold load.
          // Remove an incomplete pair before retrying both in one context.
          report.runs = report.runs.filter((run) => {
            const key = runIdentity(run);
            return key !== coldKey && (!warmRequired || key !== warmKey);
          });
          let context = null;
          try {
            context = await createPageContext(browserCdp, profile, entryMode);
            const cold = await capturePageRun({
              ...context,
              cdp: context.pageCdp,
              profile,
              routeProfile,
              entryMode,
              cacheMode: 'cold',
              runNumber,
              deepEvidence: runNumber === 1
            });
            report.runs.push(cold);

            if (cold.status === 'completed'
              && warmRequired) {
              const warm = await capturePageRun({
                ...context,
                cdp: context.pageCdp,
                profile,
                routeProfile,
                entryMode,
                cacheMode: 'warm',
                runNumber: 1,
                deepEvidence: false
              });
              report.runs.push(warm);
            }
          } catch (error) {
            report.runs.push({
              schemaVersion: 1,
              phase: options.phase,
              sha: options.sha,
              profile: profile.key,
              routeKey: routeProfile.key,
              template: routeProfile.template,
              route: routeProfile.route,
              entryMode,
              cacheMode: 'cold',
              runNumber,
              deepEvidence: runNumber === 1,
              status: 'failed',
              error: String(error?.stack || error?.message || error),
              metrics: {}
            });
          } finally {
            if (context) await closePageContext(browserCdp, context);
          }
          await persistPartialReport();
          const latest = report.runs.at(-1);
          process.stdout.write(`${latest?.status === 'completed' ? 'PASS' : 'FAIL'} ${profile.key} ${routeProfile.key} ${entryMode} run ${runNumber}\n`);
        }
      }
    }
  }

  report.summaries = summarizeRuns(report.runs);
  report.failures = report.runs.filter((run) => run.status !== 'completed').map((run) => ({
    profile: run.profile,
    routeKey: run.routeKey,
    entryMode: run.entryMode,
    cacheMode: run.cacheMode,
    runNumber: run.runNumber,
    error: run.error
  }));
  report.completedAt = new Date().toISOString();
  await writeJson(reportFile, report);
  process.stdout.write(`H5 performance report: ${reportFile}\n`);
  process.stdout.write(`Runs: ${report.runs.length}; failures: ${report.failures.length}\n`);
  if (report.failures.length) process.exitCode = 1;
} finally {
  browserCdp?.close();
  browserProcess.kill();
  await Promise.race([browserExit, delay(5_000)]).catch(() => {});
  chromiumStderr.end();
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {});
}

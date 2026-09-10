import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classifyPublicAction, validateContactProtocol } from './action-crawl-core.mjs';
import { exercisePublicSearch } from './public-search-probe.mjs';
import { CdpBrowser, createDistServer } from './cdp-browser.mjs';
import { PUBLIC_LIFECYCLE_SEMANTIC_IDS } from './evidence-contract.mjs';
import { sourceWorkingTreeDirty } from './git-evidence.mjs';
import { currentPublicActionInputs } from './public-action-cache.mjs';
import { parsePublicActionShard, routesForPublicActionShard } from './public-action-shards.mjs';
import {
  assessDistFreshness,
  buildExpectedRouteModel,
  discoverArtifactFiles,
  discoverProductionHtml,
  fingerprintArtifact,
  fingerprintProductionHtml,
  inspectPublicArtifactIsolation,
  productionHtmlFilename,
  reconcileRouteSets,
  REQUIRED_VIEWPORTS,
  REAL_UNKNOWN_ROUTE
} from './route-passport-model.mjs';

const root = process.cwd();
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const option = (name, fallback = '') => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const shard = parsePublicActionShard(option('--shard'));
const explicitOutput = option('--output');
const options = {
  help: hasFlag('--help') || hasFlag('-h'), headful: hasFlag('--headful'), json: hasFlag('--json'),
  noJsEveryRoute: option('--no-js', 'on') !== 'off',
  allowStaleDist: hasFlag('--allow-stale-dist'),
  distRoot: path.resolve(root, option('--dist', 'dist')),
  basePath: option('--base', process.env.BASE_PATH || '/'),
  origin: option('--origin').replace(/\/$/u, ''),
  onlyRoute: option('--route'),
  shard,
  output: path.resolve(root, explicitOutput || (shard
    ? `.admin-runtime/h6-qa/public-action-crawl-shard-${shard.index}-of-${shard.total}.json`
    : '.admin-runtime/h6-qa/public-action-crawl.json'))
};
if (options.help) {
  process.stdout.write(`H6 exhaustive public action crawl\n\n`);
  process.stdout.write(`  node tools/qa/public-action-crawl.mjs\n`);
  process.stdout.write(`      Inventory every control on every production route at both required viewports, execute safe UI buttons by click and keyboard,\n`);
  process.stdout.write(`      reconcile every internal link with the route manifest, and load every route once with JavaScript disabled.\n`);
  process.stdout.write(`  Options: --dist=<dir>, --base=/SMU1, --origin=<url>, --output=<json>, --no-js=off, --headful, --json.\n`);
  process.stdout.write(`  Parallel release crawl: run every --shard=<index>/<total>, then merge only the complete deterministic set.\n`);
  process.stdout.write(`  Developer-only smoke: --route=/exact/url/ (never valid as final evidence).\n`);
  process.stdout.write(`  Developer-only stale artifact audit: --allow-stale-dist.\n`);
  process.stdout.write(`  Lead submits, analytics, contact-protocol launches and external navigation are intentionally forbidden.\n`);
  process.exit(0);
}

const progress = (message) => process.stderr.write(`[h6-public-actions] ${message}\n`);
const DEFAULT_BLOCKED_PUBLIC_URLS = Object.freeze([
  '*mc.yandex.ru*',
  '*google-analytics.com*',
  '*googletagmanager.com*',
  '*formspree.io*',
  '*api.web3forms.com*'
]);
const LEAD_OR_ANALYTICS_URL = /(?:mc\.yandex\.ru|metrika|webvisor|google-analytics\.com|googletagmanager\.com|formspree\.io|api\.web3forms\.com)/iu;
const VIDEO_ASSET_URL = /\.(?:mp4|webm)(?:$|[?#])/iu;
const git = (...args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); }
  catch { return ''; }
};
const normalizeBase = (value) => {
  const raw = String(value || '/').trim();
  if (!raw || raw === '/') return '/';
  const result = raw.startsWith('/') ? raw : `/${raw}`;
  return result.endsWith('/') ? result.slice(0, -1) : result;
};
const basePath = normalizeBase(options.basePath);
const withBase = (route) => basePath === '/' ? route : route === '/' ? `${basePath}/` : `${basePath}${route}`;
const withoutBase = (pathname) => basePath !== '/' && (pathname === basePath || pathname.startsWith(`${basePath}/`))
  ? pathname.slice(basePath.length) || '/'
  : pathname;
const normalizeRoute = (pathname) => {
  const logical = withoutBase(pathname);
  if (logical === '/' || path.posix.extname(logical)) return logical;
  return logical.endsWith('/') ? logical : `${logical}/`;
};
const decodeHtmlAttribute = (value) => String(value || '')
  .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#([0-9]+);/gu, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/&quot;/giu, '"')
  .replace(/&apos;|&#39;/giu, "'")
  .replace(/&lt;/giu, '<')
  .replace(/&gt;/giu, '>')
  .replace(/&amp;/giu, '&');
const artifactAnchorIds = (distRoot, route) => {
  const html = readFileSync(productionHtmlFilename(distRoot, route), 'utf8');
  return [...html.matchAll(/\sid\s*=\s*(?:"([^"]+)"|'([^']+)')/giu)]
    .map((match) => decodeHtmlAttribute(match[1] ?? match[2] ?? ''))
    .filter(Boolean);
};

const model = buildExpectedRouteModel({ root });
const discovered = discoverProductionHtml(options.distRoot);
const distFreshness = assessDistFreshness({ root, distRoot: options.distRoot });
if (!distFreshness.fresh && !options.allowStaleDist) throw new Error(`dist is older than source/public inputs; run a clean production build first. ${JSON.stringify(distFreshness)}`);
const reconciliation = reconcileRouteSets(model.routes.map((route) => route.pathname), discovered);
if (!reconciliation.exact) throw new Error(`Route manifest mismatch: ${JSON.stringify(reconciliation)}`);
const distFingerprint = fingerprintProductionHtml(options.distRoot, discovered);
const artifactFiles = discoverArtifactFiles(options.distRoot);
const artifactFingerprint = fingerprintArtifact(options.distRoot, artifactFiles);
const publicInputs = await currentPublicActionInputs({ root, distRoot: options.distRoot, basePath });
const expectedInputKey = option('--expected-input-key');
if (expectedInputKey && expectedInputKey !== publicInputs.key) throw new Error('Public QA artifact, harness or runtime differs from the prepared input identity.');
const artifactIsolation = inspectPublicArtifactIsolation(options.distRoot, artifactFiles);
const expectedRouteSet = new Set(model.routes.map((route) => route.pathname));
const expectedRouteByPath = new Map(model.routes.map((route) => [route.pathname, route]));
if (options.onlyRoute && options.shard) throw new Error('--route and --shard are mutually exclusive.');
const routesToCrawl = options.onlyRoute
  ? model.routes.filter((route) => route.pathname === options.onlyRoute)
  : routesForPublicActionShard(model.routes, options.shard);
if (options.onlyRoute && routesToCrawl.length !== 1) throw new Error(`--route must match one authoritative URL exactly: ${options.onlyRoute}`);
const runUnknownProbe = !options.shard || options.shard.index === 1;

let distServer = null;
const origin = options.origin || (distServer = await createDistServer({
  distRoot: options.distRoot, basePath, cacheStaticAssets: true
})).origin;
const originValue = new URL(origin).origin;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error(`Public action crawl accepts only loopback origins, received ${originValue}.`);
}
const browser = await new CdpBrowser({ headful: options.headful }).start();
const context = { route: '', viewport: '', actionId: '' };
const searchProbeCoverage = new Map();
const events = [];
const requests = [];
const documentResponses = [];
browser.on('Runtime.exceptionThrown', ({ exceptionDetails }) => events.push({ ...context, kind: 'runtime-exception', text: exceptionDetails?.exception?.description || exceptionDetails?.text || '' }));
browser.on('Runtime.consoleAPICalled', ({ type, args }) => {
  if (['error', 'assert'].includes(type)) events.push({ ...context, kind: `console-${type}`, text: args?.map((item) => item.value ?? item.description ?? '').join(' ') || '' });
});
browser.on('Network.responseReceived', ({ response, type }) => {
  if (type === 'Document') documentResponses.push({ ...context, status: response.status, url: response.url });
  if (response.status >= 400) events.push({ ...context, kind: 'http-response', status: response.status, url: response.url, resourceType: type });
});
browser.on('Network.loadingFailed', ({ blockedReason, canceled, errorText, type }) => {
  const expectedBlock = blockedReason === 'inspector' || /ERR_BLOCKED_BY_CLIENT/iu.test(errorText || '');
  if (!canceled && !expectedBlock) events.push({ ...context, kind: 'network-failure', text: errorText || '', resourceType: type });
});
browser.on('Network.requestWillBeSent', ({ request, type }) => {
  requests.push({ ...context, method: request.method, url: request.url, resourceType: type });
});

const registerExpression = `(() => {
  const clean = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
  const visible = (element) => {
    const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
    const hiddenAncestor = element.closest('[hidden],[inert],[aria-hidden="true"]');
    const closedDetails = element.closest('details:not([open])');
    const concealedByDetails = closedDetails && element !== closedDetails.querySelector(':scope > summary') && !element.closest('summary');
    return !hiddenAncestor && !concealedByDetails && style.display !== 'none' && style.visibility !== 'hidden'
      && !element.hidden && rect.width > 0 && rect.height > 0;
  };
  const nameOf = (element) => clean(element.getAttribute('aria-label')
    || (element.getAttribute('aria-labelledby') ? document.getElementById(element.getAttribute('aria-labelledby'))?.textContent : '')
    || element.alt || element.textContent || element.title || element.value);
  return Array.from(document.querySelectorAll('a[href],button,input,select,textarea,summary,details,video[controls],[role="button"],[tabindex]')).map((element) => {
    let nextId = Number(document.documentElement.dataset.h6NextActionId || 1);
    const id = element.dataset.h6ActionId || 'a' + nextId++;
    element.dataset.h6ActionId = id;
    document.documentElement.dataset.h6NextActionId = String(nextId);
    return {
      id, tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || '', name: nameOf(element),
      href: element.href || element.getAttribute('href') || '', type: element.type || '', target: element.target || '',
      download: element.hasAttribute('download'), inForm: Boolean(element.closest('form')),
      formAction: element.formAction || element.closest('form')?.action || '', formMethod: element.formMethod || element.closest('form')?.method || '',
      visible: visible(element), disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
      selected: element.getAttribute('aria-current') === 'true' || element.getAttribute('aria-current') === 'page'
        || element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-pressed') === 'true',
      tabIndex: element.tabIndex, dataActions: [
        ...Array.from(element.attributes).filter((item) => item.name.startsWith('data-') && item.name !== 'data-h6-action-id').map((item) => item.name),
        ...(element.closest('[data-search-dialog]') ? ['data-public-search-control'] : [])
      ]
    };
  });
})()`;
const stateExpression = (id) => `(() => {
  const element = document.querySelector('[data-h6-action-id="${String(id).replaceAll('"', '\\"')}"]');
  if (!element) return null;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const visible = style.display !== 'none' && style.visibility !== 'hidden' && !element.hidden && rect.width > 0 && rect.height > 0;
  const hiddenAncestor = element.closest('[hidden],[inert],[aria-hidden="true"]');
  const closedDetails = element.closest('details:not([open])');
  const concealedByDetails = closedDetails && element !== closedDetails.querySelector(':scope > summary') && !element.closest('summary');
  const actuallyVisible = visible && !hiddenAncestor && !concealedByDetails;
  const hit = actuallyVisible ? document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2))) : null;
  const interactable = Boolean(hit && (hit === element || element.contains(hit)));
  const fingerprint = JSON.stringify({
    location: location.href,
    className: element.className,
    expanded: element.getAttribute('aria-expanded'),
    pressed: element.getAttribute('aria-pressed'),
    selected: element.getAttribute('aria-selected'),
    dialogs: Array.from(document.querySelectorAll('dialog,[role="dialog"]')).map((dialog) => ({ open: dialog.open || dialog.getAttribute('aria-hidden') !== 'true', hidden: dialog.hidden })),
    details: Array.from(document.querySelectorAll('details')).map((item) => item.open),
    hiddenCount: document.querySelectorAll('[hidden]').length,
    cookieBanner: (() => { const item = document.querySelector('[data-cookie-banner]'); return item ? { hidden: item.hidden, ariaHidden: item.getAttribute('aria-hidden') } : null; })(),
    htmlClass: document.documentElement.className,
    htmlData: { ...document.documentElement.dataset },
    bodyClass: document.body.className,
    bodyData: { ...document.body.dataset },
    scroll: [Math.round(scrollX), Math.round(scrollY)],
    frames: document.querySelectorAll('iframe').length,
    media: Array.from(document.querySelectorAll('video,audio')).map((item) => ({ paused: item.paused, currentTime: Math.round(item.currentTime * 10) / 10 })),
    selected: Array.from(document.querySelectorAll('[aria-current],[aria-selected="true"],[data-active]')).map((item) => item.getAttribute('aria-current') || item.getAttribute('aria-selected') || item.getAttribute('data-active')).slice(0, 30),
    currentImages: Array.from(document.images).filter((item) => item.offsetWidth > 0 && item.offsetHeight > 0).map((item) => item.currentSrc || item.src).slice(0, 20),
    status: Array.from(document.querySelectorAll('[aria-live]')).map((item) => item.textContent?.trim()).filter(Boolean).slice(0, 12)
  });
  return {
    visible: actuallyVisible,
    interactable,
    hitTarget: hit ? { tag: hit.tagName.toLowerCase(), id: hit.id || '', classes: Array.from(hit.classList).slice(0, 8) } : null,
    disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
    focused: document.activeElement === element,
    focusVisible: element.matches(':focus-visible'),
    focusIndicator: { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow },
    fingerprint
  };
})()`;

const preparedActionState = async (id) => {
  await browser.evaluate(`document.querySelector('[data-h6-action-id="${String(id).replaceAll('"', '\\"')}"]')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })`).catch(() => {});
  return browser.evaluate(stateExpression(id)).catch(() => null);
};

const settleInteractiveSurface = async () => {
  const deadline = Date.now() + 2_500;
  while (Date.now() < deadline) {
    const settled = await browser.evaluate(`(() => {
      const overlay = document.querySelector('[data-v2-page-transition],[data-v2-page-bootstrap-overlay]');
      const style = overlay ? getComputedStyle(overlay) : null;
      const blocking = Boolean(overlay && !overlay.hidden && style.display !== 'none' && style.visibility !== 'hidden'
        && style.pointerEvents !== 'none' && Number(style.opacity || 1) > 0.01);
      return !blocking && document.readyState !== 'loading';
    })()`).catch(() => false);
    if (settled) return true;
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  return false;
};

const executeAction = async (action, mode) => {
  const before = await preparedActionState(action.id);
  if (!before?.visible || before.disabled || (mode === 'click' && !before.interactable)) return { mode, status: 'state-changed-before-execution', before };
  const eventIndex = events.length;
  const requestIndex = requests.length;
  let focusPrepared = false;
  if (mode === 'click') {
    const point = await browser.evaluate(`(() => {
      const element = document.querySelector('[data-h6-action-id="${action.id}"]');
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      element.focus({ preventScroll: true });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, focused: document.activeElement === element };
    })()`);
    focusPrepared = Boolean(point.focused);
    await browser.dispatchClick(point);
  } else {
    focusPrepared = await browser.evaluate(`(() => { const element = document.querySelector('[data-h6-action-id="${action.id}"]'); element?.focus({ preventScroll: true }); return document.activeElement === element; })()`);
    await browser.dispatchKey('Enter', { code: 'Enter' });
  }
  await new Promise((resolve) => setTimeout(resolve, 35));
  let searchSemantics = null;
  let searchOpenState = null;
  if ((action.dataActions || []).includes('data-search-open')) {
    searchOpenState = await browser.evaluate(stateExpression(action.id)).catch(() => null);
    const extended = !searchProbeCoverage.has(context.viewport);
    searchSemantics = await exercisePublicSearch(browser, { extended });
    if (extended) searchProbeCoverage.set(context.viewport, { route: context.route, ...searchSemantics });
  }
  const after = await browser.evaluate(stateExpression(action.id)).catch(() => null);
  const actionEvents = events.slice(eventIndex);
  const failures = actionEvents.filter((event) => {
    if (!event.url) return true;
    try { return new URL(event.url).origin === originValue; } catch { return true; }
  });
  const actionRequests = requests.slice(requestIndex);
  const unexpectedMutationRequests = actionRequests.filter((request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method));
  const observableChange = Boolean(before && (!after || before.fingerprint !== after.fingerprint
    || searchOpenState && before.fingerprint !== searchOpenState.fingerprint));
  return {
    mode,
    before,
    after,
    focusPrepared,
    observableChange,
    searchSemantics,
    searchOpenState,
    events: actionEvents,
    requests: actionRequests,
    unexpectedMutationRequests,
    status: !focusPrepared || (searchSemantics ? searchSemantics.status !== 'pass' : !observableChange && !action.selected) || failures.length || unexpectedMutationRequests.length ? 'fail' : 'pass'
  };
};

const validateLink = (action, pageUrl) => {
  let target;
  try { target = new URL(action.href, pageUrl); }
  catch { return { status: 'fail', issue: 'invalid-url' }; }
  if (target.protocol === 'tel:' || target.protocol === 'mailto:' || target.protocol === 'sms:' || target.protocol === 'tg:') {
    return { status: validateContactProtocol(target.href) ? 'pass' : 'fail', kind: 'contact-protocol', target: target.href };
  }
  if (!['http:', 'https:'].includes(target.protocol)) return { status: 'fail', kind: 'unsupported-protocol', target: target.href };
  if (target.origin !== originValue) return { status: 'pass', kind: 'external-not-launched', target: target.href };
  if (basePath !== '/' && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) {
    return { status: 'fail', kind: 'missing-base-path', target: target.href, basePath };
  }
  const route = normalizeRoute(target.pathname);
  const currentRoute = normalizeRoute(new URL(pageUrl).pathname);
  if (target.hash && route === currentRoute) {
    return { status: 'pass', kind: 'same-page-anchor', route, expectedFinalRoute: route, anchor: decodeURIComponent(target.hash.slice(1)) };
  }
  if (/^\/(?:assets|uploads|_astro|_media)\//u.test(route)) return { status: 'pass', kind: 'local-asset', target: target.href };
  const routeCovered = expectedRouteSet.has(route);
  if (!routeCovered) return { status: 'fail', kind: 'unmanifested-internal-route', route, target: target.href };
  const descriptor = expectedRouteByPath.get(route);
  const expectedFinalRoute = descriptor?.routeClass === 'alias' ? descriptor.canonicalTarget : route;
  if (target.hash) {
    const anchor = decodeURIComponent(target.hash.slice(1));
    return { status: 'pass', kind: 'cross-page-anchor-deferred', route, expectedFinalRoute, anchor };
  }
  return { status: 'pass', kind: 'internal-route', route, expectedFinalRoute };
};

const restoreInitialPage = async (requestedUrl) => {
  await browser.send('Storage.clearDataForOrigin', { origin: originValue, storageTypes: 'all' }).catch(() => {});
  await browser.navigate(requestedUrl, { waitForFonts: false });
  await settleInteractiveSurface();
  await browser.evaluate(registerExpression);
};

const ensureActionExecutable = async (action, requestedUrl, { requireHit = true } = {}) => {
  let state = await preparedActionState(action.id);
  if (state?.visible && (!requireHit || state.interactable) && !state.disabled) return { state, restored: false, opener: null };
  await restoreInitialPage(requestedUrl);
  state = await preparedActionState(action.id);
  if (state?.visible && (!requireHit || state.interactable) && !state.disabled) return { state, restored: true, opener: null };

  const candidates = (await browser.evaluate(registerExpression)).filter((candidate) => {
    const policy = classifyPublicAction(candidate);
    return candidate.id !== action.id && candidate.visible && !candidate.disabled && policy.policy === 'safe-ui-action';
  });
  for (const candidate of candidates) {
    const candidateState = await preparedActionState(candidate.id);
    if (!candidateState?.visible || candidateState.disabled || !candidateState.interactable) continue;
    const point = await browser.evaluate(`(() => {
      const element = document.querySelector('[data-h6-action-id="${candidate.id}"]');
      if (!element) return null;
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!point) continue;
    await browser.dispatchClick(point);
    await new Promise((resolve) => setTimeout(resolve, 45));
    await browser.evaluate(registerExpression).catch(() => []);
    state = await preparedActionState(action.id);
    if (state?.visible && (!requireHit || state.interactable) && !state.disabled) {
      return { state, restored: true, opener: { id: candidate.id, name: candidate.name } };
    }
    await restoreInitialPage(requestedUrl);
  }
  return { state: await preparedActionState(action.id), restored: true, opener: null };
};

const executeInternalLink = async (action, link, mode) => {
  const before = await preparedActionState(action.id);
  if (!before?.visible || before.disabled || (mode === 'click' && !before.interactable)) return { mode, status: 'state-changed-before-execution', before };
  const eventIndex = events.length;
  const requestIndex = requests.length;
  let focusPrepared = false;
  if (mode === 'click') {
    const point = await browser.evaluate(`(() => {
      const element = document.querySelector('[data-h6-action-id="${action.id}"]');
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      element.focus({ preventScroll: true });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, focused: document.activeElement === element };
    })()`);
    focusPrepared = Boolean(point.focused);
    await browser.dispatchClick(point);
  } else {
    focusPrepared = await browser.evaluate(`(() => { const element = document.querySelector('[data-h6-action-id="${action.id}"]'); element?.focus({ preventScroll: true }); return document.activeElement === element; })()`);
    await browser.dispatchKey('Enter', { code: 'Enter' });
  }

  const deadline = Date.now() + 5_000;
  let destination = null;
  while (Date.now() < deadline) {
    destination = await browser.evaluate(`(() => ({
      location: location.href,
      readyState: document.readyState,
      h1: Array.from(document.querySelectorAll('h1')).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean),
      frameworkOverlay: Boolean(document.querySelector('vite-error-overlay,nextjs-portal,[data-nextjs-dialog-overlay],[data-error-overlay]')),
      anchorExists: ${JSON.stringify(link.anchor || '')} ? Boolean(document.getElementById(${JSON.stringify(link.anchor || '')})) : true
    }))()`).catch(() => null);
    const finalRoute = destination?.location ? normalizeRoute(new URL(destination.location).pathname) : '';
    if (destination?.readyState !== 'loading' && finalRoute === link.expectedFinalRoute) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  await new Promise((resolve) => setTimeout(resolve, 45));
  const actionEvents = events.slice(eventIndex);
  const actionRequests = requests.slice(requestIndex);
  const failures = actionEvents.filter((event) => {
    if (!event.url) return true;
    try { return new URL(event.url).origin === originValue; } catch { return true; }
  });
  const unexpectedMutationRequests = actionRequests.filter((request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method));
  const finalRoute = destination?.location ? normalizeRoute(new URL(destination.location).pathname) : '';
  const finalHash = destination?.location ? decodeURIComponent(new URL(destination.location).hash.slice(1)) : '';
  const routeMatches = finalRoute === link.expectedFinalRoute;
  const anchorMatches = !link.anchor || (destination?.anchorExists && finalHash === link.anchor);
  return {
    mode,
    before,
    focusPrepared,
    destination,
    expectedFinalRoute: link.expectedFinalRoute,
    expectedAnchor: link.anchor || '',
    routeMatches,
    anchorMatches,
    events: actionEvents,
    requests: actionRequests,
    unexpectedMutationRequests,
    status: focusPrepared && routeMatches && anchorMatches && destination?.h1?.length === 1
      && !destination?.frameworkOverlay && failures.length === 0 && unexpectedMutationRequests.length === 0 ? 'pass' : 'fail'
  };
};

const exerciseCurrentSurface = async ({ requestedUrl, loadedLocation }) => {
  const actionResultsById = new Map();
  let inventoried = 0;
  for (let wave = 0; wave < 3; wave += 1) {
    const actions = await browser.evaluate(registerExpression);
    for (const action of actions) {
      const previous = actionResultsById.get(action.id);
      if (previous && !(previous.policy === 'hidden-state' && action.visible)) continue;
      const policy = classifyPublicAction(action);
      context.actionId = action.id;
      const result = { action, policy: policy.policy, discoveryWave: wave + 1, executions: [], status: 'pass' };
      if (action.tag === 'a') {
        result.link = validateLink(action, loadedLocation);
        if (result.link.status === 'fail') result.status = 'fail';
        if (policy.execute && result.link.status === 'pass' && action.visible && !action.disabled) {
          for (const mode of policy.modes || ['click', 'keyboard-enter']) {
            const preparation = await ensureActionExecutable(action, requestedUrl, { requireHit: policy.policy !== 'keyboard-focus-action' });
            if (!preparation.state?.visible || preparation.state.disabled || (mode === 'click' && !preparation.state.interactable)) {
              result.executions.push({ mode, status: 'state-changed-before-execution', preparation });
              result.status = 'fail';
              continue;
            }
            const execution = await executeInternalLink(action, result.link, mode);
            execution.preparation = preparation;
            result.executions.push(execution);
            if (execution.status !== 'pass') result.status = 'fail';
            await restoreInitialPage(requestedUrl);
          }
        } else if (policy.execute && action.visible && !action.disabled) {
          result.status = 'fail';
        }
      } else if (policy.execute) {
        for (const mode of policy.modes || ['click', 'keyboard-enter']) {
          const preparation = await ensureActionExecutable(action, requestedUrl, { requireHit: true });
          const executable = preparation.state?.visible && !preparation.state.disabled && (mode !== 'click' || preparation.state.interactable);
          const locationBeforeAction = await browser.evaluate('location.href');
          const execution = executable
            ? await executeAction(action, mode)
            : { mode, status: 'state-changed-before-execution', before: preparation.state };
          execution.preparation = preparation;
          result.executions.push(execution);
          const postLocation = await browser.evaluate('location.href');
          if (new URL(postLocation).origin !== originValue || normalizeRoute(new URL(postLocation).pathname) !== normalizeRoute(new URL(locationBeforeAction).pathname)) {
            execution.status = 'fail';
            execution.unexpectedNavigation = postLocation;
          }
          if (execution.status !== 'pass') result.status = 'fail';
          if (mode === 'click') await restoreInitialPage(requestedUrl);
        }
      } else if (policy.policy === 'protected-form-action') {
        result.executionNote = 'Intentionally not executed: QA must not send a lead or open a file picker.';
      } else if (policy.policy === 'public-search-semantic-coverage') {
        result.executionNote = 'Exercised by the public search semantic probe: query, result focus, clear, examples, pagination, close and Escape.';
      }
      actionResultsById.set(action.id, result);
      inventoried += 1;
      if (inventoried % 25 === 0) progress(`${context.route} ${context.viewport}: exercised/inventoried ${inventoried} concrete controls`);
    }
  }
  const actionResults = [...actionResultsById.values()];
  const finalActions = await browser.evaluate(registerExpression);
  const finalById = new Map(finalActions.map((action) => [action.id, action]));
  for (const result of actionResults) result.finalState = finalById.get(result.action.id) || null;
  return actionResults;
};

const galleryInventoryExpression = `(() => ({
  product: Array.from(document.querySelectorAll('[data-v2-product-gallery]')).map((root, index) => ({
    kind: 'product', index, multiple: Boolean(root.querySelector('[data-v2-gallery-status]'))
  })),
  project: Array.from(document.querySelectorAll('[data-v2-project-gallery]')).map((root, index) => ({
    kind: 'project', index, multiple: Boolean(root.querySelector('[data-v2-project-gallery-status]'))
  }))
}))()`;

const exerciseGallerySemantics = async (viewport) => {
  const inventory = await browser.evaluate(galleryInventoryExpression);
  const results = [];
  for (const descriptor of [...inventory.product, ...inventory.project]) {
    const rootSelector = descriptor.kind === 'product' ? '[data-v2-product-gallery]' : '[data-v2-project-gallery]';
    if (viewport.mobile) {
      if (!descriptor.multiple) {
        results.push({ ...descriptor, mode: 'mobile-swipe', status: 'not-applicable', reason: 'single-image-gallery' });
        continue;
      }
      const swipe = await browser.evaluate(`(async () => {
        const root = document.querySelectorAll(${JSON.stringify(rootSelector)})[${descriptor.index}];
        const stage = root?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '.v2-product-gallery__stage' : '[data-v2-project-gallery-swipe]')});
        const status = root?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-gallery-status]' : '[data-v2-project-gallery-status]')});
        if (!stage || !status) return null;
        const before = status.textContent?.replace(/\\s+/gu, ' ').trim() || '';
        stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 701, clientX: 330, clientY: 330 }));
        stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 701, clientX: 80, clientY: 336 }));
        await new Promise((resolve) => setTimeout(resolve, 90));
        const afterHorizontal = status.textContent?.replace(/\\s+/gu, ' ').trim() || '';
        stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 702, clientX: 205, clientY: 210 }));
        stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 702, clientX: 211, clientY: 390 }));
        await new Promise((resolve) => setTimeout(resolve, 90));
        return {
          before,
          afterHorizontal,
          afterVertical: status.textContent?.replace(/\\s+/gu, ' ').trim() || '',
          touchAction: getComputedStyle(stage).touchAction
        };
      })()`);
      const passed = Boolean(swipe && swipe.before && swipe.afterHorizontal
        && swipe.before !== swipe.afterHorizontal && swipe.afterHorizontal === swipe.afterVertical);
      results.push({ ...descriptor, mode: 'mobile-swipe', status: passed ? 'pass' : 'fail', swipe });
      continue;
    }

    const opened = await browser.evaluate(`(async () => {
      const root = document.querySelectorAll(${JSON.stringify(rootSelector)})[${descriptor.index}];
      const status = root?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-gallery-status]' : '[data-v2-project-gallery-status]')});
      const next = root?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-gallery-next]' : '[data-v2-project-gallery-next]')});
      const previous = root?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-gallery-prev]' : '[data-v2-project-gallery-prev]')});
      let navigation = null;
      if (status && next && previous) {
        const before = status.textContent?.replace(/\\s+/gu, ' ').trim() || '';
        next.click(); await new Promise((resolve) => setTimeout(resolve, 80));
        const afterNext = status.textContent?.replace(/\\s+/gu, ' ').trim() || '';
        previous.click(); await new Promise((resolve) => setTimeout(resolve, 80));
        navigation = { before, afterNext, afterPrevious: status.textContent?.replace(/\\s+/gu, ' ').trim() || '' };
      }
      const opener = root?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-gallery-open]' : '[data-v2-project-gallery-open]')});
      const dialog = root?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-product-lightbox]' : '[data-v2-project-lightbox]')});
      const close = dialog?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-lightbox-close]' : '[data-v2-project-lightbox-close]')});
      const image = dialog?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-lightbox-image]' : '[data-v2-project-lightbox-image]')});
      if (!opener || !dialog || !close || !image) return { navigation, missing: true };
      opener.focus(); opener.click(); await new Promise((resolve) => setTimeout(resolve, 100));
      const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'))
        .filter((item) => !item.hasAttribute('hidden'));
      const first = focusable[0]; const last = focusable.at(-1);
      const initialFocus = document.activeElement === close;
      last?.focus();
      last?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }));
      return {
        navigation,
        open: dialog.open,
        initialFocus,
        focusWrapped: Boolean(first && document.activeElement === first),
        fit: getComputedStyle(image).objectFit
      };
    })()`);
    await browser.dispatchKey('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const closed = await browser.evaluate(`(() => {
      const root = document.querySelectorAll(${JSON.stringify(rootSelector)})[${descriptor.index}];
      const opener = root?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-gallery-open]' : '[data-v2-project-gallery-open]')});
      const dialog = root?.querySelector(${JSON.stringify(descriptor.kind === 'product' ? '[data-v2-product-lightbox]' : '[data-v2-project-lightbox]')});
      return { open: Boolean(dialog?.open), focusReturned: Boolean(opener && document.activeElement === opener) };
    })()`);
    const navigationPassed = !descriptor.multiple || Boolean(opened?.navigation
      && opened.navigation.before !== opened.navigation.afterNext
      && opened.navigation.before === opened.navigation.afterPrevious);
    const passed = navigationPassed && opened?.open === true && opened?.initialFocus === true
      && opened?.focusWrapped === true && opened?.fit === 'contain'
      && closed?.open === false && closed?.focusReturned === true;
    results.push({ ...descriptor, mode: 'desktop-lightbox', status: passed ? 'pass' : 'fail', opened, closed });
  }
  return { inventory, results };
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitForBrowserValue = async (expression, { timeoutMs = 8_000, label = 'browser condition' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await browser.evaluate(expression).catch(() => null);
    if (lastValue) return lastValue;
    await delay(60);
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
};
const clickLifecycleControl = async (selector) => {
  const clicked = await browser.evaluate(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)});
    if (!(control instanceof HTMLElement)) return false;
    control.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    control.focus({ preventScroll: true });
    control.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Lifecycle control is missing: ${selector}`);
};
const lifecycleSafetySince = (requestIndex, interceptIndex) => {
  const scenarioRequests = requests.slice(requestIndex);
  const intercepted = browser.safetyEvidence().intercepted.slice(interceptIndex);
  const stateChanging = scenarioRequests.filter((request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method));
  const leadOrAnalytics = scenarioRequests.filter((request) => LEAD_OR_ANALYTICS_URL.test(request.url || ''));
  return {
    stateChangingRequests: stateChanging.length
      + intercepted.filter((request) => request.reason === 'state-changing-request').length,
    leadOrAnalyticsRequests: leadOrAnalytics.length
      + intercepted.filter((request) => request.reason === 'analytics-or-form').length,
    interceptedAttempts: intercepted.length,
    unexpectedRequests: [...stateChanging, ...leadOrAnalytics],
    intercepted
  };
};
const executeLifecycleSemantic = async ({ id, route, run }) => {
  context.route = route;
  context.viewport = REQUIRED_VIEWPORTS[0].id;
  context.actionId = `lifecycle:${id}`;
  const eventIndex = events.length;
  const requestIndex = requests.length;
  const interceptIndex = browser.safetyEvidence().intercepted.length;
  const issues = [];
  let evidence = {};
  try {
    const result = await run();
    evidence = result?.evidence || {};
    issues.push(...(result?.issues || []));
  } catch (error) {
    issues.push(`probe-error:${error instanceof Error ? error.message : String(error)}`);
  }
  const scenarioEvents = events.slice(eventIndex);
  const safety = lifecycleSafetySince(requestIndex, interceptIndex);
  if (scenarioEvents.length) issues.push(`runtime-errors:${scenarioEvents.length}`);
  if (safety.stateChangingRequests) issues.push(`state-changing-requests:${safety.stateChangingRequests}`);
  if (safety.leadOrAnalyticsRequests) issues.push(`lead-or-analytics-requests:${safety.leadOrAnalyticsRequests}`);
  if (safety.interceptedAttempts) issues.push(`safety-intercepts:${safety.interceptedAttempts}`);
  return { id, route, status: issues.length ? 'fail' : 'pass', issues, evidence, events: scenarioEvents, safety };
};

const homeVideoStateExpression = `(() => {
  const video = document.querySelector('[data-hf-hero-video]');
  const toggle = document.querySelector('[data-hf-video-toggle]');
  const label = document.querySelector('[data-hf-video-toggle-label]');
  if (!(video instanceof HTMLVideoElement) || !(toggle instanceof HTMLButtonElement)) return null;
  const controlRect = toggle.getBoundingClientRect();
  const controlStyle = getComputedStyle(toggle);
  return {
    paused: video.paused,
    ended: video.ended,
    readyState: video.readyState,
    currentTime: video.currentTime,
    source: video.getAttribute('src') || '',
    currentSource: video.currentSrc || '',
    sourceLoaded: Boolean(video.getAttribute('src') || video.currentSrc),
    controlReady: !toggle.hidden && !toggle.disabled && toggle.getAttribute('aria-hidden') !== 'true'
      && controlRect.width > 0 && controlRect.height > 0 && controlStyle.display !== 'none'
      && controlStyle.visibility !== 'hidden' && Number(controlStyle.opacity) > 0,
    label: label?.textContent?.replace(/\\s+/gu, ' ').trim() || '',
    ariaLabel: toggle.getAttribute('aria-label') || ''
  };
})()`;

const exerciseHomeVideoLifecycle = () => executeLifecycleSemantic({
  id: 'home-video',
  route: '/',
  run: async () => {
    const homeUrl = `${origin}${withBase('/')}`;
    const evidence = {};
    const clickVideoAsUser = async () => {
      const point = await browser.evaluate(`(() => {
        const control = document.querySelector('[data-hf-video-toggle]');
        if (!(control instanceof HTMLButtonElement) || control.hidden || control.disabled) return null;
        control.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const rect = control.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (!point) throw new Error('Explicit video control is unavailable');
      await browser.dispatchClick(point);
    };
    const exerciseExplicitPlayback = async () => {
      const requestIndex = requests.length;
      await clickVideoAsUser();
      const playing = await waitForBrowserValue(`(() => { const state = (${homeVideoStateExpression}); return state && !state.paused && state.readyState >= 2 ? state : null; })()`, {
        timeoutMs: 12_000, label: 'explicit Home video playback'
      });
      const advanced = await waitForBrowserValue(`(() => { const state = (${homeVideoStateExpression}); return state && !state.paused && state.currentTime > ${Number(playing.currentTime) + 0.05} ? state : null; })()`, {
        timeoutMs: 12_000, label: 'explicit Home video time advancement'
      });
      await clickVideoAsUser();
      const paused = await waitForBrowserValue(`(() => { const state = (${homeVideoStateExpression}); return state?.paused ? state : null; })()`, { label: 'explicit Home video pause' });
      await delay(350);
      const settledPause = await browser.evaluate(homeVideoStateExpression);
      return {
        controlReady: playing.controlReady === true,
        sourceLoaded: playing.sourceLoaded === true,
        videoRequestCount: requests.slice(requestIndex).filter((request) => VIDEO_ASSET_URL.test(request.url || '')).length,
        playing: playing.paused === false,
        startTime: playing.currentTime,
        advancedTime: advanced.currentTime,
        pausedAfterPause: paused.paused === true && settledPause?.paused === true,
        pausedTime: paused.currentTime,
        settledPauseTime: settledPause?.currentTime,
        labelAfterPause: settledPause?.label || '',
        ariaAfterPause: settledPause?.ariaLabel || ''
      };
    };
    let saveDataScriptIdentifier = '';
    try {
      await browser.setViewport(REQUIRED_VIEWPORTS[0]);
      await browser.emulateMedia({ reducedMotion: false });
      await browser.send('Storage.clearDataForOrigin', { origin: originValue, storageTypes: 'all' }).catch(() => {});
      const normalRequestIndex = requests.length;
      context.actionId = 'lifecycle:home-video:normal-motion';
      await browser.navigate(homeUrl);
      await settleInteractiveSurface();
      await waitForBrowserValue(`(() => { const state = (${homeVideoStateExpression}); return state?.controlReady && state?.sourceLoaded ? state : null; })()`, {
        timeoutMs: 12_000,
        label: 'normal-motion Home video control'
      });
      let playing = await browser.evaluate(homeVideoStateExpression);
      if (playing?.paused) {
        await clickLifecycleControl('[data-hf-video-toggle]');
      }
      playing = await waitForBrowserValue(`(() => { const state = (${homeVideoStateExpression}); return state && !state.paused && state.readyState >= 2 ? state : null; })()`, {
        timeoutMs: 12_000,
        label: 'Home video playback'
      });
      await clickLifecycleControl('[data-hf-video-toggle]');
      const paused = await waitForBrowserValue(`(() => { const state = (${homeVideoStateExpression}); return state?.paused ? state : null; })()`, {
        label: 'Home video pause'
      });
      await clickLifecycleControl('[data-hf-video-toggle]');
      const resumed = await waitForBrowserValue(`(() => { const state = (${homeVideoStateExpression}); return state && !state.paused ? state : null; })()`, {
        label: 'Home video resume'
      });
      evidence.normalMotion = {
        reducedMotion: false,
        saveData: false,
        controlReady: playing.controlReady === true,
        sourceLoaded: playing.sourceLoaded === true,
        videoRequestCount: requests.slice(normalRequestIndex).filter((request) => VIDEO_ASSET_URL.test(request.url || '')).length,
        playingBeforePause: playing.paused === false,
        pausedAfterPause: paused.paused === true,
        playingAfterResume: resumed.paused === false,
        labelAfterPause: paused.label,
        labelAfterResume: resumed.label,
        ariaAfterPause: paused.ariaLabel,
        ariaAfterResume: resumed.ariaLabel
      };

      await browser.emulateMedia({ reducedMotion: true });
      await browser.send('Storage.clearDataForOrigin', { origin: originValue, storageTypes: 'all' }).catch(() => {});
      const reducedRequestIndex = requests.length;
      context.actionId = 'lifecycle:home-video:reduced-motion';
      await browser.navigate(homeUrl);
      await settleInteractiveSurface();
      await delay(700);
      const reduced = await browser.evaluate(homeVideoStateExpression);
      evidence.reducedMotion = {
        reducedMotion: true,
        saveData: false,
        controlReady: reduced?.controlReady === true,
        sourceLoaded: reduced?.sourceLoaded === true,
        videoRequestCount: requests.slice(reducedRequestIndex).filter((request) => VIDEO_ASSET_URL.test(request.url || '')).length
      };
      evidence.reducedMotion.explicitPlayback = await exerciseExplicitPlayback();

      await browser.emulateMedia({ reducedMotion: false });
      const saveDataScript = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
          const original = navigator.connection;
          const constrained = original ? new Proxy(original, {
            get(target, property) {
              if (property === 'saveData') return true;
              if (property === 'effectiveType') return '4g';
              const value = Reflect.get(target, property, target);
              return typeof value === 'function' ? value.bind(target) : value;
            }
          }) : { saveData: true, effectiveType: '4g' };
          Object.defineProperty(navigator, 'connection', { configurable: true, get: () => constrained });
        })();`
      });
      saveDataScriptIdentifier = saveDataScript.identifier || '';
      await browser.send('Storage.clearDataForOrigin', { origin: originValue, storageTypes: 'all' }).catch(() => {});
      const saveDataRequestIndex = requests.length;
      context.actionId = 'lifecycle:home-video:save-data';
      await browser.navigate(homeUrl);
      await settleInteractiveSurface();
      await delay(700);
      const saveData = await browser.evaluate(homeVideoStateExpression);
      evidence.saveData = {
        reducedMotion: false,
        saveData: await browser.evaluate('navigator.connection?.saveData === true'),
        controlReady: saveData?.controlReady === true,
        sourceLoaded: saveData?.sourceLoaded === true,
        videoRequestCount: requests.slice(saveDataRequestIndex).filter((request) => VIDEO_ASSET_URL.test(request.url || '')).length
      };
      evidence.saveData.explicitPlayback = await exerciseExplicitPlayback();
    } finally {
      if (saveDataScriptIdentifier) {
        await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: saveDataScriptIdentifier }).catch(() => {});
      }
      await browser.emulateMedia({ reducedMotion: true }).catch(() => {});
    }
    const issues = [];
    const normal = evidence.normalMotion;
    if (!normal?.controlReady || !normal?.sourceLoaded || !(normal.videoRequestCount > 0)
      || !normal.playingBeforePause || !normal.pausedAfterPause || !normal.playingAfterResume
      || !/включить видео/iu.test(normal.labelAfterPause || '') || !/пауза видео/iu.test(normal.labelAfterResume || '')) {
      issues.push('normal-motion-pause-resume');
    }
    for (const [profile, value] of [['reduced-motion', evidence.reducedMotion], ['save-data', evidence.saveData]]) {
      if (!value?.controlReady || value?.sourceLoaded !== false || value?.videoRequestCount !== 0) issues.push(`${profile}-autoplay-suppression`);
      const explicit = value?.explicitPlayback;
      if (!explicit?.controlReady || !explicit?.sourceLoaded || !(explicit?.videoRequestCount > 0)
        || explicit?.playing !== true || !Number.isFinite(explicit?.startTime) || !Number.isFinite(explicit?.advancedTime)
        || !(explicit.advancedTime > explicit.startTime + 0.05) || explicit?.pausedAfterPause !== true
        || !Number.isFinite(explicit?.pausedTime) || !Number.isFinite(explicit?.settledPauseTime)
        || Math.abs(explicit.settledPauseTime - explicit.pausedTime) > 0.1
        || !/включить видео/iu.test(explicit?.labelAfterPause || '')
        || !/включить фоновое видео/iu.test(explicit?.ariaAfterPause || '')) issues.push(`${profile}-explicit-playback`);
    }
    return { evidence, issues };
  }
});

const cookieStateExpression = `(() => {
  const banner = document.querySelector('[data-cookie-banner]');
  return {
    present: Boolean(banner),
    visible: Boolean(banner && !banner.hidden && !banner.hasAttribute('hidden')),
    hidden: Boolean(banner?.hidden || banner?.hasAttribute('hidden')),
    noticeKey: localStorage.getItem('smu1_cookie_notice_closed'),
    legacyKey: localStorage.getItem('smu1_cookie_consent')
  };
})()`;
const exerciseCookieLifecycle = () => executeLifecycleSemantic({
  id: 'cookie-notice',
  route: '/',
  run: async () => {
    const homeUrl = `${origin}${withBase('/')}`;
    await browser.setViewport(REQUIRED_VIEWPORTS[0]);
    await browser.emulateMedia({ reducedMotion: true });
    await browser.send('Storage.clearDataForOrigin', { origin: originValue, storageTypes: 'all' }).catch(() => {});
    context.actionId = 'lifecycle:cookie:initial';
    await browser.navigate(homeUrl);
    await settleInteractiveSurface();
    const initial = await waitForBrowserValue(`(() => { const state = (${cookieStateExpression}); return state.present && state.visible ? state : null; })()`, { label: 'initial cookie notice' });
    context.actionId = 'lifecycle:cookie:dismiss';
    await clickLifecycleControl('[data-cookie-notice-close]');
    const dismissed = await waitForBrowserValue(`(() => { const state = (${cookieStateExpression}); return state.hidden && state.noticeKey === 'true' ? state : null; })()`, { label: 'cookie dismissal persistence' });
    context.actionId = 'lifecycle:cookie:persisted-reload';
    await browser.navigate(homeUrl);
    await settleInteractiveSurface();
    const persistedReload = await waitForBrowserValue(`(() => { const state = (${cookieStateExpression}); return state.hidden && state.noticeKey === 'true' ? state : null; })()`, { label: 'persisted cookie dismissal after reload' });
    context.actionId = 'lifecycle:cookie:footer-reopen';
    await clickLifecycleControl('[data-open-cookie-settings]');
    const footerReopen = await waitForBrowserValue(`(() => { const state = (${cookieStateExpression}); return state.visible && state.noticeKey === null && state.legacyKey === null ? state : null; })()`, { label: 'footer cookie notice reopen' });
    await clickLifecycleControl('[data-cookie-notice-close]');
    const evidence = { initial, dismissed, persistedReload, footerReopen };
    const issues = [];
    if (initial.noticeKey !== null || initial.legacyKey !== null || !initial.visible) issues.push('initial-state');
    if (!dismissed.hidden || dismissed.noticeKey !== 'true') issues.push('dismiss-state');
    if (!persistedReload.hidden || persistedReload.noticeKey !== 'true') issues.push('persisted-reload');
    if (!footerReopen.visible || footerReopen.noticeKey !== null || footerReopen.legacyKey !== null) issues.push('footer-reopen');
    return { evidence, issues };
  }
});

const mapStateExpression = `(() => {
  const root = document.querySelector('[data-v2-yandex-map]');
  const placeholder = root?.querySelector('[data-v2-map-placeholder]');
  const activate = root?.querySelector('[data-v2-map-activate]');
  const status = root?.querySelector('[data-v2-map-status]');
  const frame = root?.querySelector('iframe');
  return {
    present: Boolean(root),
    state: root?.getAttribute('data-v2-map-state') || '',
    iframeCount: root?.querySelectorAll('iframe').length || 0,
    placeholderVisible: Boolean(placeholder && !placeholder.hasAttribute('hidden')),
    activateEnabled: Boolean(activate && !activate.disabled),
    statusText: status?.textContent?.replace(/\\s+/gu, ' ').trim() || '',
    iframeTitle: frame?.getAttribute('title') || '',
    iframeTabIndex: frame?.getAttribute('tabindex') || '',
    focusTarget: document.activeElement === frame ? 'iframe' : document.activeElement === activate ? 'activate' : 'other'
  };
})()`;
const exerciseContactsMapLifecycle = () => executeLifecycleSemantic({
  id: 'contacts-map',
  route: '/kontakty/',
  run: async () => {
    const contactsUrl = `${origin}${withBase('/kontakty/')}`;
    await browser.setViewport(REQUIRED_VIEWPORTS[0]);
    await browser.emulateMedia({ reducedMotion: true });
    await browser.send('Network.setBlockedURLs', { urls: [...DEFAULT_BLOCKED_PUBLIC_URLS, '*api-maps.yandex.ru*'] });
    try {
      await browser.send('Storage.clearDataForOrigin', { origin: originValue, storageTypes: 'all' }).catch(() => {});
      context.actionId = 'lifecycle:contacts-map:deferred';
      await browser.navigate(contactsUrl);
      await settleInteractiveSurface();
      const before = await waitForBrowserValue(`(() => { const state = (${mapStateExpression}); return state.present && state.state === 'idle' ? state : null; })()`, { label: 'deferred Contacts map' });
      context.actionId = 'lifecycle:contacts-map:activate';
      await clickLifecycleControl('[data-v2-map-activate]');
      const terminal = await waitForBrowserValue(`(() => { const state = (${mapStateExpression}); return state && (state.state === 'ready' || state.state === 'error') ? state : null; })()`, {
        timeoutMs: 8_000,
        label: 'Contacts map terminal state'
      });
      const evidence = { before, activation: { clicked: true }, terminal };
      const ready = terminal.state === 'ready' && terminal.iframeCount > 0 && !terminal.placeholderVisible
        && Boolean(terminal.statusText) && Boolean(terminal.iframeTitle) && terminal.iframeTabIndex === '0' && terminal.focusTarget === 'iframe';
      const failOpen = terminal.state === 'error' && terminal.iframeCount === 0 && terminal.placeholderVisible
        && terminal.activateEnabled && Boolean(terminal.statusText) && terminal.focusTarget === 'activate';
      const issues = [];
      if (before.iframeCount !== 0 || !before.placeholderVisible || !before.activateEnabled) issues.push('not-deferred-before-activation');
      if (!ready && !failOpen) issues.push('missing-ready-or-fail-open-terminal');
      return { evidence, issues };
    } finally {
      await browser.send('Network.setBlockedURLs', { urls: [...DEFAULT_BLOCKED_PUBLIC_URLS] }).catch(() => {});
    }
  }
});

const routeResults = [];
const noJsResults = [];
const publicLifecycleSemantics = [];
// Cross-page anchors must stay verifiable when routes are divided between workers.
// Indexing each concrete emitted HTML file is deterministic and does not substitute
// for the required browser opening of every route/viewport pair.
const anchorIndex = new Map(model.routes
  .filter((route) => route.routeClass !== 'alias')
  .map((route) => [route.pathname, artifactAnchorIds(options.distRoot, route.pathname)]));
try {
  let completed = 0;
  for (const expected of routesToCrawl) {
    for (const viewport of REQUIRED_VIEWPORTS) {
      context.route = expected.pathname;
      context.viewport = viewport.id;
      context.actionId = '';
      await browser.setViewport(viewport);
      await browser.emulateMedia({ reducedMotion: true });
      const requestedUrl = `${origin}${withBase(expected.pathname)}`;
      await browser.send('Storage.clearDataForOrigin', { origin: originValue, storageTypes: 'all' }).catch(() => {});
      const routeEventIndex = events.length;
      await browser.navigate(requestedUrl);
      await settleInteractiveSurface();
      const pageIdentity = await browser.evaluate(`(() => ({
        location: location.href,
        title: document.title,
        h1: Array.from(document.querySelectorAll('h1')).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean),
        bodyTextLength: document.body?.innerText?.trim().length || 0,
        frameworkOverlay: Boolean(document.querySelector('vite-error-overlay,nextjs-portal,[data-nextjs-dialog-overlay],[data-error-overlay]')),
        galleryInventory: (${galleryInventoryExpression})
      }))()`);
      const loadedLocation = pageIdentity.location;
      anchorIndex.set(normalizeRoute(new URL(loadedLocation).pathname), await browser.evaluate(`Array.from(document.querySelectorAll('[id]')).map((item) => item.id)`));
      const actionResults = await exerciseCurrentSurface({ requestedUrl, loadedLocation });
      const gallerySemantics = await exerciseGallerySemantics(viewport);
      const routeEvents = events.slice(routeEventIndex);
      const issues = [];
      const expectedFinalRoute = expected.routeClass === 'alias' ? expected.canonicalTarget : expected.pathname;
      if (normalizeRoute(new URL(pageIdentity.location).pathname) !== expectedFinalRoute) issues.push(`page-identity:${normalizeRoute(new URL(pageIdentity.location).pathname)}`);
      if (pageIdentity.h1.length !== 1) issues.push(`h1-count:${pageIdentity.h1.length}`);
      if (!pageIdentity.bodyTextLength) issues.push('blank-page');
      if (pageIdentity.frameworkOverlay) issues.push('framework-error-overlay');
      if (actionResults.length === 0) issues.push('empty-action-registry');
      if (actionResults.some((result) => result.status === 'fail')) issues.push(`actions-failed:${actionResults.filter((result) => result.status === 'fail').length}`);
      if (gallerySemantics.results.some((result) => result.status === 'fail')) issues.push(`gallery-semantics-failed:${gallerySemantics.results.filter((result) => result.status === 'fail').length}`);
      if (routeEvents.length) issues.push(`route-runtime-errors:${routeEvents.length}`);
      routeResults.push({
        route: expected.pathname, routeClass: expected.routeClass, viewport, requestedUrl,
        pageIdentity, actionCount: actionResults.length, actionResults, gallerySemantics, events: routeEvents, issues, status: issues.length ? 'fail' : 'pass'
      });
      if (issues.length) progress(`route failed ${JSON.stringify({
        route: expected.pathname, viewport: viewport.id, issues,
        actions: actionResults.filter((result) => result.status === 'fail').map((result) => ({
          id: result.action.id, name: result.action.name, policy: result.policy,
          executions: result.executions.map((execution) => ({ mode: execution.mode, status: execution.status }))
        }))
      })}`);
      completed += 1;
      if (completed % 20 === 0 || completed === routesToCrawl.length * REQUIRED_VIEWPORTS.length) {
        progress(`crawled ${completed}/${routesToCrawl.length * REQUIRED_VIEWPORTS.length} route/viewport action surfaces`);
      }
    }
    if (options.noJsEveryRoute) {
      context.route = expected.pathname;
      context.viewport = 'desktop-1440x900';
      context.actionId = 'no-js';
      await browser.setViewport(REQUIRED_VIEWPORTS[0]);
      await browser.emulateMedia({ reducedMotion: true });
      await browser.send('Emulation.setScriptExecutionDisabled', { value: true });
      const responseIndex = documentResponses.length;
      const eventIndex = events.length;
      await browser.navigate(`${origin}${withBase(expected.pathname)}`, { scriptExecutionDisabled: true });
      const snapshot = await browser.evaluate(`(() => ({
        location: location.href,
        h1: Array.from(document.querySelectorAll('h1')).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean),
        navLinks: document.querySelectorAll('nav a[href],header a[href]').length,
        images: document.images.length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        noScriptText: Array.from(document.querySelectorAll('noscript')).map((item) => item.textContent?.trim()).filter(Boolean)
      }))()`, { awaitPromise: false });
      const issues = [];
      const expectedFinalRoute = expected.routeClass === 'alias' ? expected.canonicalTarget : expected.pathname;
      const documentStatus = documentResponses.slice(responseIndex)
        .find((response) => normalizeRoute(new URL(response.url).pathname) === expected.pathname)?.status || 0;
      if (documentStatus !== 200) issues.push(`document-status:${documentStatus}`);
      if (normalizeRoute(new URL(snapshot.location).pathname) !== expectedFinalRoute) issues.push(`page-identity:${normalizeRoute(new URL(snapshot.location).pathname)}`);
      if (snapshot.h1.length !== 1) issues.push(`h1-count:${snapshot.h1.length}`);
      if (snapshot.overflow > 1) issues.push(`horizontal-overflow:${snapshot.overflow}`);
      if (expected.routeClass === 'canonical' && snapshot.navLinks === 0) issues.push('no-navigation-links');
      const noJsEvents = events.slice(eventIndex);
      if (noJsEvents.length) issues.push(`runtime-or-network:${noJsEvents.length}`);
      noJsResults.push({ route: expected.pathname, viewport: REQUIRED_VIEWPORTS[0], documentStatus, snapshot, events: noJsEvents, issues, status: issues.length ? 'fail' : 'pass' });
      await browser.send('Emulation.setScriptExecutionDisabled', { value: false });
    }
  }

  const ownedRoutes = new Set(routesToCrawl.map((route) => route.pathname));
  const lifecycleExercises = new Map([
    ['home-video', { route: '/', exercise: exerciseHomeVideoLifecycle }],
    ['cookie-notice', { route: '/', exercise: exerciseCookieLifecycle }],
    ['contacts-map', { route: '/kontakty/', exercise: exerciseContactsMapLifecycle }]
  ]);
  for (const id of PUBLIC_LIFECYCLE_SEMANTIC_IDS) {
    const descriptor = lifecycleExercises.get(id);
    if (!descriptor || !ownedRoutes.has(descriptor.route)) continue;
    progress(`checking public lifecycle semantic ${id}`);
    publicLifecycleSemantics.push(await descriptor.exercise());
  }

  const unknownResults = [];
  for (const viewport of runUnknownProbe ? REQUIRED_VIEWPORTS : []) {
    context.route = REAL_UNKNOWN_ROUTE;
    context.viewport = viewport.id;
    context.actionId = '';
    await browser.setViewport(viewport);
    await browser.emulateMedia({ reducedMotion: true });
    await browser.send('Storage.clearDataForOrigin', { origin: originValue, storageTypes: 'all' }).catch(() => {});
    const requestedUrl = `${origin}${withBase(REAL_UNKNOWN_ROUTE)}`;
    const eventIndex = events.length;
    const responseIndex = documentResponses.length;
    await browser.navigate(requestedUrl);
    await settleInteractiveSurface();
    const pageIdentity = await browser.evaluate(`(() => ({
      location: location.href,
      title: document.title,
      h1: Array.from(document.querySelectorAll('h1')).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean),
      bodyTextLength: document.body?.innerText?.trim().length || 0,
      robots: document.querySelector('meta[name="robots"]')?.content || '',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      frameworkOverlay: Boolean(document.querySelector('vite-error-overlay,nextjs-portal,[data-nextjs-dialog-overlay],[data-error-overlay]'))
    }))()`);
    const actionResults = await exerciseCurrentSurface({ requestedUrl, loadedLocation: pageIdentity.location });
    const documentStatus = documentResponses.slice(responseIndex)
      .find((response) => normalizeRoute(new URL(response.url).pathname) === REAL_UNKNOWN_ROUTE)?.status || 0;
    const routeEvents = events.slice(eventIndex).filter((event) => {
      if (event.kind !== 'http-response' || event.status !== 404 || event.resourceType !== 'Document' || !event.url) return true;
      return normalizeRoute(new URL(event.url).pathname) !== REAL_UNKNOWN_ROUTE;
    });
    const issues = [];
    if (documentStatus !== 404) issues.push(`document-status:${documentStatus}`);
    if (normalizeRoute(new URL(pageIdentity.location).pathname) !== REAL_UNKNOWN_ROUTE) issues.push('page-identity');
    if (pageIdentity.h1.length !== 1) issues.push(`h1-count:${pageIdentity.h1.length}`);
    if (!pageIdentity.bodyTextLength) issues.push('blank-page');
    if (!/noindex/iu.test(pageIdentity.robots)) issues.push('unknown-not-noindex');
    if (pageIdentity.overflow > 1) issues.push(`horizontal-overflow:${pageIdentity.overflow}`);
    if (pageIdentity.frameworkOverlay) issues.push('framework-error-overlay');
    if (actionResults.length === 0) issues.push('empty-action-registry');
    if (actionResults.some((result) => result.status === 'fail')) issues.push(`actions-failed:${actionResults.filter((result) => result.status === 'fail').length}`);
    if (routeEvents.length) issues.push(`route-runtime-errors:${routeEvents.length}`);
    unknownResults.push({
      route: REAL_UNKNOWN_ROUTE,
      viewport,
      requestedUrl,
      documentStatus,
      pageIdentity,
      actionCount: actionResults.length,
      actionResults,
      gallerySemantics: { inventory: { product: [], project: [] }, results: [] },
      events: routeEvents,
      issues,
      status: issues.length ? 'fail' : 'pass'
    });
  }

  let unknownNoJsResult = null;
  if (options.noJsEveryRoute && runUnknownProbe) {
    context.route = REAL_UNKNOWN_ROUTE;
    context.viewport = 'desktop-1440x900';
    context.actionId = 'no-js';
    await browser.setViewport(REQUIRED_VIEWPORTS[0]);
    await browser.emulateMedia({ reducedMotion: true });
    const responseIndex = documentResponses.length;
    const eventIndex = events.length;
    await browser.send('Emulation.setScriptExecutionDisabled', { value: true });
    await browser.navigate(`${origin}${withBase(REAL_UNKNOWN_ROUTE)}`, { scriptExecutionDisabled: true });
    const snapshot = await browser.evaluate(`(() => ({
      location: location.href,
      h1: Array.from(document.querySelectorAll('h1')).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean),
      navLinks: document.querySelectorAll('nav a[href],header a[href]').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      robots: document.querySelector('meta[name="robots"]')?.content || ''
    }))()`, { awaitPromise: false });
    const documentStatus = documentResponses.slice(responseIndex)
      .find((response) => normalizeRoute(new URL(response.url).pathname) === REAL_UNKNOWN_ROUTE)?.status || 0;
    const issues = [];
    if (documentStatus !== 404) issues.push(`document-status:${documentStatus}`);
    if (snapshot.h1.length !== 1) issues.push(`h1-count:${snapshot.h1.length}`);
    if (snapshot.overflow > 1) issues.push(`horizontal-overflow:${snapshot.overflow}`);
    if (!/noindex/iu.test(snapshot.robots)) issues.push('unknown-not-noindex');
    const noJsEvents = events.slice(eventIndex).filter((event) => {
      if (event.kind !== 'http-response' || event.status !== 404 || event.resourceType !== 'Document' || !event.url) return true;
      return normalizeRoute(new URL(event.url).pathname) !== REAL_UNKNOWN_ROUTE;
    });
    if (noJsEvents.length) issues.push(`runtime-or-network:${noJsEvents.length}`);
    unknownNoJsResult = { route: REAL_UNKNOWN_ROUTE, documentStatus, snapshot, events: noJsEvents, issues, status: issues.length ? 'fail' : 'pass' };
    await browser.send('Emulation.setScriptExecutionDisabled', { value: false });
  }

  for (const routeResult of [...routeResults, ...unknownResults]) {
    for (const actionResult of routeResult.actionResults) {
      if (actionResult.link?.kind !== 'cross-page-anchor-deferred') continue;
      const anchors = anchorIndex.get(actionResult.link.expectedFinalRoute || actionResult.link.route) || [];
      actionResult.link.kind = 'cross-page-anchor';
      actionResult.link.status = anchors.includes(actionResult.link.anchor) ? 'pass' : 'fail';
      actionResult.link.anchorFound = anchors.includes(actionResult.link.anchor);
      if (actionResult.link.status === 'fail') {
        actionResult.status = 'fail';
        if (!routeResult.issues.includes('broken-cross-page-anchor')) routeResult.issues.push('broken-cross-page-anchor');
        routeResult.status = 'fail';
      }
    }
  }

  let finalDialogDrainError = null;
  await browser.send('Runtime.evaluate', { expression: 'void 0', returnByValue: true }, { timeoutMs: 1_500 }).catch((error) => {
    finalDialogDrainError = error;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await browser.drainBackgroundDialogs().catch((error) => {
    finalDialogDrainError ||= error;
  });
  const browserSafety = browser.safetyEvidence();
  const unexpectedNavigationDialogs = browserSafety.navigationDialogs.slice();
  const dialogAudit = {
    finalDrainPassed: finalDialogDrainError === null,
    unexpectedCount: unexpectedNavigationDialogs.length,
    passed: finalDialogDrainError === null && unexpectedNavigationDialogs.length === 0
  };
  const failedActions = routeResults.filter((result) => result.status === 'fail');
  const failedNoJs = noJsResults.filter((result) => result.status === 'fail');
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evidence: {
      publicActionInputsKey: publicInputs.key,
      sourceSHA: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current') || '(detached)', dirty: sourceWorkingTreeDirty(root),
      origin, basePath,
      browserSafety,
      dialogAudit,
      emulation: { reducedMotion: true, deviceScaleFactor: 1 },
      analyticsAndLeadSubmissionBlocked: browserSafety.mode === 'public-read-only',
      distFreshness,
      distFingerprintSHA256: distFingerprint.aggregate,
      htmlFileHashes: distFingerprint.entries,
      artifactFingerprintSHA256: artifactFingerprint.aggregate,
      artifactFileHashes: artifactFingerprint.entries,
      artifactFileCount: artifactFingerprint.fileCount,
      artifactBytes: artifactFingerprint.totalBytes,
      artifactIsolation
    },
    manifest: {
      ...reconciliation,
      expectedCount: model.routes.length,
      openedRouteViewportPairs: routeResults.length,
      requiredRouteViewportPairs: model.routes.length * REQUIRED_VIEWPORTS.length,
      concreteCoverage: !options.onlyRoute && !options.shard && routeResults.length === model.routes.length * REQUIRED_VIEWPORTS.length,
      developmentFilter: options.onlyRoute || null,
      shard: options.shard ? {
        index: options.shard.index,
        total: options.shard.total,
        assignedRoutes: routesToCrawl.map((route) => route.pathname),
        ownsUnknownProbe: runUnknownProbe
      } : null
    },
    routeResults,
    noJsResults,
    publicLifecycleSemantics,
    publicSearchSemantics: Object.fromEntries(searchProbeCoverage),
    unknownResults,
    unknownNoJsResult,
    aggregate: {
      routeViewportsPassed: routeResults.length - failedActions.length,
      routeViewportsFailed: failedActions.length,
      actionOccurrences: routeResults.reduce((count, result) => count + result.actionCount, 0),
      safeExecutions: routeResults.reduce((count, result) => count + result.actionResults.reduce((total, action) => total + action.executions.length, 0), 0),
      gallerySemanticOccurrences: routeResults.reduce((count, result) => count + (result.gallerySemantics?.results?.length || 0), 0),
      gallerySemanticPassed: routeResults.reduce((count, result) => count + (result.gallerySemantics?.results || []).filter((item) => item.status === 'pass').length, 0),
      gallerySemanticFailed: routeResults.reduce((count, result) => count + (result.gallerySemantics?.results || []).filter((item) => item.status === 'fail').length, 0),
      lifecycleSemanticOccurrences: publicLifecycleSemantics.length,
      lifecycleSemanticsPassed: publicLifecycleSemantics.filter((item) => item.status === 'pass').length,
      lifecycleSemanticsFailed: publicLifecycleSemantics.filter((item) => item.status === 'fail').length,
      protectedLeadOrFileActions: routeResults.reduce((count, result) => count + result.actionResults.filter((action) => action.policy === 'protected-form-action').length, 0),
      unknownViewportsPassed: unknownResults.filter((result) => result.status === 'pass').length,
      unknownViewportsFailed: unknownResults.filter((result) => result.status === 'fail').length,
      unknownNoJsPassed: unknownNoJsResult?.status === 'pass',
      publicArtifactIsolation: artifactIsolation.clean,
      publicArtifactLeaks: artifactIsolation.leaks.length,
      unexpectedNavigationDialogs: unexpectedNavigationDialogs.length,
      dialogDrainPassed: dialogAudit.finalDrainPassed,
      noJsPassed: noJsResults.length - failedNoJs.length,
      noJsFailed: failedNoJs.length,
      noJsRequired: options.noJsEveryRoute ? routesToCrawl.length : 0
    }
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  progress(`action crawl written to ${path.relative(root, options.output)}`);
  if (options.json) process.stdout.write(`${JSON.stringify(output)}\n`);
  else process.stdout.write(`${JSON.stringify({ manifest: output.manifest, aggregate: output.aggregate, output: options.output }, null, 2)}\n`);
  if (!artifactIsolation.clean || failedActions.length || failedNoJs.length
    || !dialogAudit.passed
    || publicLifecycleSemantics.some((result) => result.status === 'fail')
    || unknownResults.some((result) => result.status === 'fail') || unknownNoJsResult?.status === 'fail') process.exitCode = 1;
} catch (error) {
  const partial = {
    complete: false, sourceSHA: git('rev-parse', 'HEAD'),
    error: String(error.stack || error), context: { ...context }, navigation: browser.lastNavigation,
    openedRouteViewportPairs: routeResults.length,
    requiredRouteViewportPairs: routesToCrawl.length * REQUIRED_VIEWPORTS.length,
    routes: routeResults.map((result) => ({
      route: result.route, viewport: result.viewport.id, status: result.status, issues: result.issues,
      failedActions: result.actionResults.filter((action) => action.status === 'fail').map((action) => ({
        id: action.action.id, name: action.action.name, policy: action.policy,
        executions: action.executions.map((execution) => ({ mode: execution.mode, status: execution.status }))
      }))
    }))
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  // This diagnostic is deliberately not a final evidence file or merger input.
  await writeFile(`${options.output}.partial.json`, `${JSON.stringify(partial, null, 2)}\n`, 'utf8');
  progress(`incomplete crawl ${JSON.stringify(partial)}`);
  throw error;
} finally {
  await browser.send('Emulation.setScriptExecutionDisabled', { value: false }).catch(() => {});
  await browser.close();
  await distServer?.close();
}

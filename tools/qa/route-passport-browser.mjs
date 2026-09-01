import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CdpBrowser, createDistServer } from './cdp-browser.mjs';
import { sourceWorkingTreeDirty } from './git-evidence.mjs';
import {
  bindingFieldPathExists,
  comparableBusinessText,
  compareMediaSnapshots,
  compareStableGeometry,
  isDirectMediaBindingTool
} from './route-passport-equivalence.mjs';
import { DECLARED_SCHEMA_PATHS } from '../../src/admin/metadata/content-coverage-registry.mjs';
import {
  objectListBindingSupportsMedia,
  structuredObjectListBindingIssues
} from './structured-list-binding.mjs';
import {
  buildExpectedRouteModel,
  assessDistFreshness,
  discoverArtifactFiles,
  discoverProductionHtml,
  fingerprintArtifact,
  fingerprintProductionHtml,
  inspectPublicArtifactIsolation,
  REAL_UNKNOWN_ROUTE,
  reconcileRouteSets,
  REQUIRED_VIEWPORTS,
  ROUTE_PASSPORT_SCHEMA_VERSION,
  summarizeRouteModel
} from './route-passport-model.mjs';

const root = process.cwd();
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const option = (name, fallback = '') => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const options = {
  help: hasFlag('--help') || hasFlag('-h'),
  headful: hasFlag('--headful'),
  json: hasFlag('--json'),
  requireEditorCoverage: hasFlag('--require-editor-coverage'),
  allowStaleDist: hasFlag('--allow-stale-dist'),
  distRoot: path.resolve(root, option('--dist', 'dist')),
  basePath: option('--base', process.env.BASE_PATH || '/'),
  origin: option('--origin').replace(/\/$/u, ''),
  editorOrigin: option('--editor-origin').replace(/\/$/u, ''),
  onlyRoute: option('--route'),
  output: path.resolve(root, option('--output', '.admin-runtime/h6-qa/route-passport.json'))
};

if (options.help) {
  process.stdout.write(`H6 exhaustive production route passport\n\n`);
  process.stdout.write(`  node tools/qa/route-passport-browser.mjs\n`);
  process.stdout.write(`      Serve ./dist locally and open every emitted production URL at 1440x900 and 390x844.\n`);
  process.stdout.write(`  node tools/qa/route-passport-browser.mjs --editor-origin=http://127.0.0.1:4321 --require-editor-coverage\n`);
  process.stdout.write(`      Also open every URL in the explicit local editor render mode and reconcile admin-only bindings.\n`);
  process.stdout.write(`  Options: --dist=<dir>, --base=/SMU1, --origin=<url>, --output=<json>, --headful, --json.\n`);
  process.stdout.write(`  Developer-only smoke: --route=/exact/url/ (evidence verifier will correctly reject the incomplete report).\n`);
  process.stdout.write(`  Developer-only stale artifact audit: --allow-stale-dist (never valid as release evidence).\n`);
  process.stdout.write(`  The crawl blocks analytics/form endpoints, never submits a form and probes both /404.html and a real unknown URL.\n`);
  process.exit(0);
}

const progress = (message) => process.stderr.write(`[h6-route-passport] ${message}\n`);
const git = (...args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); }
  catch { return ''; }
};
const normalizeBase = (value) => {
  const raw = String(value || '/').trim();
  if (!raw || raw === '/') return '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
};
const normalizedBase = normalizeBase(options.basePath);
const deployTarget = String(process.env.DEPLOY_TARGET || process.env.DEPLOY_ENV || 'development').trim().toLowerCase();
const testDeployArtifact = deployTarget === 'test';
const canonicalOrigin = (() => {
  if (testDeployArtifact) return '';
  const raw = String(process.env.SITE_URL || '').trim();
  if (!raw) throw new Error('Production route passport requires SITE_URL to verify canonical origin identity.');
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error(`Production canonical origin must use HTTPS, received ${parsed.protocol}`);
  if (parsed.username || parsed.password) throw new Error('Production canonical origin must not contain URL credentials.');
  return parsed.origin;
})();
const withBase = (route) => normalizedBase === '/' ? route : route === '/' ? `${normalizedBase}/` : `${normalizedBase}${route}`;
const withoutBase = (pathname) => normalizedBase !== '/' && (pathname === normalizedBase || pathname.startsWith(`${normalizedBase}/`))
  ? pathname.slice(normalizedBase.length) || '/'
  : pathname;
const canonicalPathWithoutBase = (pathname) => {
  if (normalizedBase === '/') return pathname;
  if (pathname === normalizedBase) return '/';
  return pathname.startsWith(`${normalizedBase}/`) ? pathname.slice(normalizedBase.length) || '/' : null;
};
const logicalPathname = (value) => withoutBase(new URL(value, 'http://route-passport.local/').pathname);
const canonicalIdentity = (value) => {
  if (!value) return { valid: false, reason: 'missing', logicalPathname: '' };
  try {
    const parsed = new URL(value);
    const logicalCanonicalPath = canonicalPathWithoutBase(parsed.pathname);
    const valid = parsed.protocol === 'https:'
      && parsed.origin === canonicalOrigin
      && !parsed.username
      && !parsed.password
      && logicalCanonicalPath !== null
      && !parsed.search
      && !parsed.hash;
    return {
      valid,
      reason: valid ? '' : `identity:${parsed.protocol}//${parsed.host}${parsed.search}${parsed.hash}`,
      logicalPathname: logicalCanonicalPath || ''
    };
  } catch {
    return { valid: false, reason: 'invalid-url', logicalPathname: '' };
  }
};
const partitionExpectedNotFoundDocumentEvents = (input, expectedPathname = REAL_UNKNOWN_ROUTE) => {
  const expected = [];
  const unexpected = [];
  for (const event of input) {
    let sameUnknownUrl = false;
    try { sameUnknownUrl = Boolean(event.url) && logicalPathname(event.url) === expectedPathname; }
    catch {}
    const expectedDocument404 = sameUnknownUrl && (
      (event.kind === 'http-response' && event.status === 404 && event.resourceType === 'Document')
      || (event.kind === 'log-error' && /status of 404|404 \(Not Found\)/iu.test(event.text || ''))
    );
    (expectedDocument404 ? expected : unexpected).push(event);
  }
  return { expected, unexpected };
};

const model = buildExpectedRouteModel({ root });
const expectedRouteByPath = new Map(model.routes.map((route) => [route.pathname, route]));
const bindingRecords = new Map();
for (const entry of fs.readdirSync(path.join(root, 'src', 'content'), { withFileTypes: true }).filter((item) => item.isDirectory())) {
  const directory = path.join(root, 'src', 'content', entry.name);
  for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'));
    bindingRecords.set(`${entry.name}:${data.slug || path.basename(filename, '.json')}`, data);
  }
}
const navigationDataPath = path.join(root, 'src', 'data', 'navigation.json');
if (fs.existsSync(navigationDataPath)) bindingRecords.set('navigation:navigation', { items: JSON.parse(fs.readFileSync(navigationDataPath, 'utf8')) });
const discovered = discoverProductionHtml(options.distRoot);
const distFreshness = assessDistFreshness({ root, distRoot: options.distRoot });
if (!distFreshness.fresh && !options.allowStaleDist) {
  throw new Error(`dist is older than source/public inputs; run a clean production build first. ${JSON.stringify(distFreshness)}`);
}
const reconciliation = reconcileRouteSets(model.routes.map((route) => route.pathname), discovered);
if (!reconciliation.exact) {
  throw new Error(`Clean production route manifest does not match the source topology:\n${JSON.stringify(reconciliation, null, 2)}`);
}
const routesToCrawl = options.onlyRoute
  ? model.routes.filter((route) => route.pathname === options.onlyRoute)
  : model.routes;
if (options.onlyRoute && routesToCrawl.length !== 1) throw new Error(`--route must match one authoritative URL exactly: ${options.onlyRoute}`);

const distFingerprint = fingerprintProductionHtml(options.distRoot, discovered);
const artifactFiles = discoverArtifactFiles(options.distRoot);
const artifactFingerprint = fingerprintArtifact(options.distRoot, artifactFiles);
const artifactIsolation = inspectPublicArtifactIsolation(options.distRoot, artifactFiles);

let distServer = null;
const origin = options.origin || (distServer = await createDistServer({ distRoot: options.distRoot, basePath: normalizedBase })).origin;
const assertLoopbackOrigin = (value, label) => {
  const parsed = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error(`${label} must be an exact loopback origin, received ${parsed.origin}.`);
  }
  return parsed.origin;
};
assertLoopbackOrigin(origin, 'Production crawl origin');
if (options.editorOrigin) assertLoopbackOrigin(options.editorOrigin, 'Editor crawl origin');
const mediaComparisonOptions = {
  localOrigins: [
    { origin, basePath: normalizedBase },
    ...(options.editorOrigin ? [{ origin: options.editorOrigin, basePath: '/' }] : [])
  ]
};
const browser = await new CdpBrowser({ headful: options.headful }).start();
const current = { route: '', viewport: '', mode: 'public' };
const events = [];
const documentResponses = [];
const resourceRequests = [];

browser.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
  events.push({ ...current, kind: 'runtime-exception', text: exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception' });
});
browser.on('Runtime.consoleAPICalled', ({ type, args }) => {
  if (!['error', 'warning', 'assert'].includes(type)) return;
  events.push({ ...current, kind: `console-${type}`, text: args?.map((arg) => arg.value ?? arg.description ?? '').join(' ') || type });
});
browser.on('Log.entryAdded', ({ entry }) => {
  if (!['error', 'warning'].includes(entry?.level)) return;
  events.push({ ...current, kind: `log-${entry.level}`, text: entry.text || '', url: entry.url || '' });
});
browser.on('Network.responseReceived', ({ response, type }) => {
  const row = { ...current, kind: 'http-response', status: response.status, url: response.url, resourceType: type };
  if (type === 'Document') documentResponses.push(row);
  if (response.status >= 400) events.push(row);
});
browser.on('Network.requestWillBeSent', ({ request, type }) => {
  resourceRequests.push({ ...current, method: request.method, url: request.url, resourceType: type });
});
browser.on('Network.loadingFailed', ({ blockedReason, canceled, errorText, type }) => {
  const expectedBlock = blockedReason === 'inspector' || /ERR_BLOCKED_BY_CLIENT/iu.test(errorText || '');
  if (!canceled && !expectedBlock) events.push({ ...current, kind: 'network-failure', resourceType: type, blockedReason, text: errorText || '' });
});

const settleMediaAndScroll = () => browser.evaluate(`(async () => {
  const initialY = window.scrollY;
  const height = document.documentElement.scrollHeight;
  const fontStylesheet = document.querySelector('[data-v2-font-stylesheet]');
  if (fontStylesheet instanceof HTMLLinkElement && !fontStylesheet.dataset.v2FontState) {
    await Promise.race([
      new Promise((resolve) => {
        fontStylesheet.addEventListener('load', resolve, { once: true });
        fontStylesheet.addEventListener('error', resolve, { once: true });
      }),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
  }
  if (document.fonts?.load) {
    const heading = document.querySelector('h1');
    const headingStyle = heading ? getComputedStyle(heading) : null;
    const headingWeight = headingStyle?.fontWeight || '600';
    const headingSize = headingStyle?.fontSize || '64px';
    const cyrillicSample = String(heading?.textContent || 'СМУ-1 Проверка сайта').trim().slice(0, 160) || 'СМУ-1';
    await Promise.race([
      Promise.all([
        document.fonts.load(headingWeight + ' ' + headingSize + ' Manrope', cyrillicSample).catch(() => []),
        ...[400, 500, 600, 700].map((weight) => document.fonts.load(weight + ' 32px Manrope', 'СМУ-1 Проверка сайта').catch(() => []))
      ]),
      new Promise((resolve) => setTimeout(resolve, 4000))
    ]);
  }
  if (document.fonts?.ready) {
    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1200))]);
  }
  for (let y = 0; y <= height; y += 720) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  window.scrollTo(0, initialY);
  await Promise.race([
    Promise.all(Array.from(document.images).map((image) => image.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }))),
    new Promise((resolve) => setTimeout(resolve, 1800))
  ]);
  const finiteAnimations = document.getAnimations().filter((animation) => {
    const iterations = animation.effect?.getTiming?.().iterations;
    return animation.playState === 'running' && iterations !== Infinity;
  });
  if (finiteAnimations.length) {
    await Promise.race([
      Promise.allSettled(finiteAnimations.map((animation) => animation.finished)),
      new Promise((resolve) => setTimeout(resolve, 1200))
    ]);
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()`);

const inventoryExpression = `(() => {
  const clean = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
  const visuallyVisible = (element) => {
    if (element.closest('dialog:not([open]), [hidden]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hidden && rect.width > 0 && rect.height > 0;
  };
  const accessibilityVisible = (element) => visuallyVisible(element)
    && !element.closest('[aria-hidden="true"],[inert]');
  const nameOf = (element) => clean(element.getAttribute('aria-label')
    || (element.getAttribute('aria-labelledby') ? document.getElementById(element.getAttribute('aria-labelledby'))?.textContent : '')
    || element.alt || element.textContent || element.title || element.value);
  const runtimeSurfaceOf = (element) => {
    if (element.closest('[data-smu1-editor-affordance]')) return 'editor-affordance';
    if (element.closest('[data-cookie-banner]')) return 'cookie-banner';
    if (element.closest('[data-v2-entry-skip-link]')) return 'entry-skip-link';
    if (element.closest('[data-v2-entry-root],[data-v2-entry-overlay],[data-v2-page-transition],[data-v2-page-bootstrap-overlay]')) return 'entry-transition';
    if (element.closest('[data-hf-video-toggle]')) return 'media-control';
    if (element.closest('[data-v2-gallery-prev],[data-v2-gallery-next],[data-v2-gallery-status],[data-v2-project-gallery-prev],[data-v2-project-gallery-next],[data-v2-project-gallery-status]')) return 'gallery-control';
    if (element.closest('[data-v2-product-lightbox],[data-v2-project-lightbox]')) return 'lightbox-control';
    return '';
  };
  const parseBinding = (owner) => {
    try {
      const ownedTextNodes = [owner, ...owner.querySelectorAll('*')]
        .flatMap((element) => Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE && clean(node.nodeValue))
          .map((node) => ({ element, text: clean(node.nodeValue) })))
        .filter(({ element }) => element.closest('[data-smu1-binding]') === owner)
        .filter(({ element }) => visuallyVisible(element) && !runtimeSurfaceOf(element));
      const ownedMedia = Array.from(owner.querySelectorAll('img,video,picture source,video source'))
        .filter((element) => element.closest('[data-smu1-binding]') === owner)
        .filter((element) => visuallyVisible(element) && !runtimeSurfaceOf(element));
      const ownedListItems = Array.from(owner.querySelectorAll('[data-smu1-list-item]'))
        .filter((element) => element.closest('[data-smu1-binding]') === owner)
        .map((element) => ({
          id: element.getAttribute('data-smu1-list-item') || '',
          fields: [
            ...(element.hasAttribute('data-smu1-list-field') ? [element] : []),
            ...element.querySelectorAll('[data-smu1-list-field]')
          ]
            .filter((field) => field.closest('[data-smu1-list-item]') === element)
            .map((field) => field.getAttribute('data-smu1-list-field') || '')
            .filter(Boolean)
            .concat((element.getAttribute('data-smu1-list-context-field') || '').split(/\s+/u).filter(Boolean))
        }));
      return {
        ...JSON.parse(owner.getAttribute('data-smu1-binding')),
        domTarget: {
          tag: owner.tagName.toLowerCase(),
          id: owner.id || '',
          bindingIdAttribute: owner.getAttribute('data-smu1-binding-id') || '',
          descendantTextNodes: Array.from(owner.querySelectorAll('*')).reduce((count, element) => count + Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && clean(node.nodeValue)).length, 0)
            + Array.from(owner.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && clean(node.nodeValue)).length,
          descendantMedia: owner.querySelectorAll('img,video,picture source').length,
          ownedBusinessText: ownedTextNodes.map((item) => item.text),
          ownedMedia: ownedMedia.length,
          ownedListItems
        }
      };
    }
    catch { return { invalid: true, raw: owner.getAttribute('data-smu1-binding') }; }
  };
  const bindingOf = (element) => {
    const owner = element.closest('[data-smu1-binding]');
    if (owner) return parseBinding(owner);
    if (!['A', 'BUTTON', 'SUMMARY'].includes(element.tagName)) return null;
    const descendants = Array.from(element.querySelectorAll('[data-smu1-binding]')).map(parseBinding);
    const unique = [...new Map(descendants.filter((binding) => binding?.bindingId).map((binding) => [binding.bindingId, binding])).values()];
    return unique.length === 1 ? unique[0] : unique.length > 1 ? { ambiguous: true, bindingIds: unique.map((binding) => binding.bindingId) } : null;
  };
  const dispositionOf = (element) => {
    const owner = element.closest('[data-smu1-editor-disposition]');
    if (!owner) return null;
    return {
      kind: owner.getAttribute('data-smu1-editor-disposition') || '',
      reason: owner.getAttribute('data-smu1-editor-reason') || '',
      source: owner.getAttribute('data-smu1-editor-source') || '',
      tool: owner.getAttribute('data-smu1-editor-tool') || '',
      domTarget: { tag: owner.tagName.toLowerCase(), id: owner.id || '' }
    };
  };
  const locator = (element) => {
    if (element.id) return '#' + CSS.escape(element.id);
    if (element.getAttribute('data-smu1-binding-id')) return '[data-smu1-binding-id="' + CSS.escape(element.getAttribute('data-smu1-binding-id')) + '"]';
    const segments = [];
    for (let current = element; current && current !== document.body; current = current.parentElement) {
      if (current.id) { segments.unshift('#' + CSS.escape(current.id)); break; }
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(current.parentElement?.children || []).filter((item) => item.tagName === current.tagName);
      segments.unshift(tag + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')');
    }
    return ['body', ...segments].join(' > ');
  };
  const sectionNodes = Array.from(document.querySelectorAll('header,main,main section,main article,main [role="region"],aside,footer,[role="dialog"],[role="status"]'));
  const sections = sectionNodes.map((element, index) => ({
    locator: locator(element, index),
    tag: element.tagName.toLowerCase(),
    id: element.id || '',
    classes: Array.from(element.classList),
    heading: clean(element.querySelector('h1,h2,h3')?.textContent),
    visible: visuallyVisible(element), accessible: accessibilityVisible(element), binding: bindingOf(element), disposition: dispositionOf(element)
  }));
  const mediaNodes = Array.from(document.querySelectorAll('img,video,picture source,video source'));
  const media = mediaNodes.map((element, index) => ({
    locator: locator(element, index), tag: element.tagName.toLowerCase(),
    src: element.getAttribute('src') || element.src || '',
    currentSrc: element.currentSrc || '',
    srcset: element.srcset || element.getAttribute('srcset') || '',
    declaredSources: [...new Set([
      element.getAttribute('data-v2-desktop-src'), element.getAttribute('data-v2-mobile-src'),
      element.getAttribute('data-hf-desktop-src'), element.getAttribute('data-hf-mobile-src')
    ].filter(Boolean))],
    poster: element.poster || '', alt: element.alt || '', loading: element.loading || '',
    complete: element.tagName === 'IMG' ? element.complete : true,
    naturalWidth: element.tagName === 'IMG' ? element.naturalWidth : 0,
    naturalHeight: element.tagName === 'IMG' ? element.naturalHeight : 0,
    visible: visuallyVisible(element), accessible: accessibilityVisible(element),
    runtimeSurface: runtimeSurfaceOf(element),
    gallery: Boolean(element.closest('[data-v2-product-gallery],[data-v2-project-gallery],[class*="gallery"]')),
    binding: bindingOf(element), disposition: dispositionOf(element)
  }));
  const backgroundMedia = Array.from(document.body.querySelectorAll('*')).map((element, index) => {
    const background = getComputedStyle(element).backgroundImage;
    return background && background !== 'none' && /url\\(/iu.test(background)
      ? { locator: locator(element, index), background, visible: visuallyVisible(element), accessible: accessibilityVisible(element), runtimeSurface: runtimeSurfaceOf(element), binding: bindingOf(element), disposition: dispositionOf(element) }
      : null;
  }).filter(Boolean);
  const actionNodes = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,summary,details,video[controls],[role="button"],[tabindex]'));
  const interactions = actionNodes.map((element, index) => ({
    locator: locator(element, index), tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || '',
    name: nameOf(element), href: element.href || element.getAttribute('href') || '', type: element.type || '', target: element.target || '',
    download: element.hasAttribute('download'), inForm: Boolean(element.closest('form')),
    visible: visuallyVisible(element), accessible: accessibilityVisible(element), disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
    tabIndex: element.tabIndex, dataActions: Array.from(element.attributes).filter((item) => item.name.startsWith('data-')).map((item) => item.name),
    binding: bindingOf(element), disposition: dispositionOf(element)
  }));
  const businessOccurrences = [];
  const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode;
  let textNodeIndex = 0;
  while ((textNode = textWalker.nextNode())) {
    const element = textNode.parentElement;
    const text = clean(textNode.nodeValue);
    if (!element || !text || element.closest('script,style,noscript,template,svg')) continue;
    const occurrenceElement = element.closest('[data-smu1-binding],[data-smu1-editor-disposition],h1,h2,h3,h4,h5,h6,p,li,dt,dd,figcaption,a,button,summary,label,legend,th,td') || element;
    businessOccurrences.push({
      locator: locator(occurrenceElement, textNodeIndex),
      textNodeIndex: textNodeIndex++,
      tag: occurrenceElement.tagName.toLowerCase(),
      sourceTag: element.tagName.toLowerCase(),
      text,
      visible: visuallyVisible(element), accessible: accessibilityVisible(element),
      runtimeSurface: runtimeSurfaceOf(element),
      binding: bindingOf(element),
      disposition: dispositionOf(element)
    });
  }
  const galleries = Array.from(document.querySelectorAll('[data-v2-product-gallery],[data-v2-project-gallery],[class*="gallery"]')).map((element, index) => ({
    locator: locator(element, index), classes: Array.from(element.classList), visible: visuallyVisible(element), accessible: accessibilityVisible(element), binding: bindingOf(element), disposition: dispositionOf(element),
    imageCount: element.querySelectorAll('img').length,
    controlCount: element.querySelectorAll('button,[role="button"]').length
  }));
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const overflowOffenders = Array.from(document.body.querySelectorAll('*')).map((element, index) => {
    const rect = element.getBoundingClientRect();
    return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1
      ? { locator: locator(element, index), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }
      : null;
  }).filter(Boolean).slice(0, 30);
  const bindings = Array.from(document.querySelectorAll('[data-smu1-binding]')).map(parseBinding);
  const listMarkers = Array.from(document.querySelectorAll('[data-smu1-list-item],[data-smu1-list-field],[data-smu1-list-value]')).map((element, index) => ({
    locator: locator(element, index),
    item: element.getAttribute('data-smu1-list-item') || '',
    field: element.getAttribute('data-smu1-list-field') || '',
    value: element.getAttribute('data-smu1-list-value') || ''
  }));
  const dispositions = Array.from(document.querySelectorAll('[data-smu1-editor-disposition]')).map((element, index) => ({
    locator: locator(element, index), ...dispositionOf(element)
  }));
  const archiveRows = Array.from(document.querySelectorAll('.v2-project-archive-row')).map((row) => ({
    href: row.querySelector('a[href]')?.href || '', classes: Array.from(row.classList)
  }));
  const catalogPrototype = document.querySelector('[data-catalog-v2-root]')?.getAttribute('data-product-final-prototype') || '';
  const productPresentation = document.querySelector('[data-product-presentation]')?.getAttribute('data-product-presentation') || '';
  const directionVariant = Array.from(document.querySelector('[data-direction-v2-root]')?.classList || []).find((item) => item.startsWith('direction-v2--'))?.slice('direction-v2--'.length) || '';
  const practicalKind = Array.from(document.querySelector('[data-practical-v2-root]')?.classList || []).find((item) => item.startsWith('practical-v2--'))?.slice('practical-v2--'.length) || '';
  const categoryHasProducts = Boolean(document.querySelector('.v2-product-list'));
  const categoryHasExamples = Boolean(document.querySelector('.v2-category-examples'));
  const projectSparse = Boolean(document.querySelector('.v2-project-detail--media-sparse'));
  const projectGalleryCount = document.querySelectorAll('[data-v2-project-gallery-thumb]').length
    || document.querySelectorAll('[data-v2-project-gallery] img').length;
  const productGalleryCount = document.querySelectorAll('[data-v2-product-gallery] img[src], [data-v2-product-gallery] source[srcset]').length;
  const publicAssets = Array.from(document.querySelectorAll('script[src],link[href],iframe[src],object[data],embed[src]')).map((element, index) => ({
    locator: locator(element, index),
    tag: element.tagName.toLowerCase(),
    url: element.src || element.href || element.data || element.getAttribute('src') || element.getAttribute('href') || element.getAttribute('data') || '',
    rel: element.rel || '', type: element.type || '', visible: visuallyVisible(element), accessible: accessibilityVisible(element)
  })).filter((item) => item.url);
  const geometryTarget = (element, dimensions = ['width', 'height']) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      dimensions,
      // offset* is the stable layout box. getBoundingClientRect() includes
      // transient reveal/entrance transforms and would compare animation
      // progress instead of production layout geometry.
      width: element.offsetWidth,
      height: element.offsetHeight,
      visualWidth: Math.round(rect.width * 10) / 10,
      visualHeight: Math.round(rect.height * 10) / 10
    };
  };
  const contentLandmarks = Array.from(document.querySelectorAll('#main-content h1, #main-content header[id], #main-content nav, #main-content section, #main-content article, #main-content [data-v2-page-handoff], #main-content [data-v2-media], #main-content [data-v2-entrance-role]'))
    .filter((element) => !runtimeSurfaceOf(element))
    .map((element, index) => ['content-' + index + ':' + (element.id || element.tagName.toLowerCase()), geometryTarget(element)]);
  const stableGeometry = Object.fromEntries([
    ['main-frame', geometryTarget(document.querySelector('#main-content, main'), ['width'])],
    ...contentLandmarks,
    ['footer', geometryTarget(document.querySelector('.hv2-footer, body > footer, footer'))]
  ].filter(([, value]) => value));
  const fontHeading = document.querySelector('h1');
  const fontHeadingStyle = fontHeading ? getComputedStyle(fontHeading) : null;
  const fontStylesheet = document.querySelector('[data-v2-font-stylesheet]');
  const fontMeasure = document.createElement('canvas').getContext('2d');
  if (fontMeasure) fontMeasure.font = (fontHeadingStyle?.fontWeight || '600') + ' ' + (fontHeadingStyle?.fontSize || '64px') + ' Manrope';
  const fontDiagnostics = {
    status: document.fonts?.status || 'unsupported',
    headingCheck: document.fonts?.check
      ? document.fonts.check((fontHeadingStyle?.fontWeight || '600') + ' ' + (fontHeadingStyle?.fontSize || '64px') + ' Manrope', clean(fontHeading?.textContent || 'СМУ-1'))
      : false,
    stylesheetState: fontStylesheet?.getAttribute('data-v2-font-state') || '',
    stylesheetMedia: fontStylesheet?.getAttribute('media') || '',
    stylesheetHref: fontStylesheet?.getAttribute('href') || '',
    headingFontFamily: fontHeadingStyle?.fontFamily || '',
    headingFontWeight: fontHeadingStyle?.fontWeight || '',
    headingFontSize: fontHeadingStyle?.fontSize || '',
    headingMaxWidth: fontHeadingStyle?.maxWidth || '',
    zeroAdvance: fontMeasure ? Math.round(fontMeasure.measureText('0').width * 1000) / 1000 : 0
  };
  const runtimeSurfaces = Array.from(document.querySelectorAll('[data-smu1-editor-affordance],[data-v2-entry-skip-link],[data-v2-entry-root],[data-v2-entry-overlay],[data-v2-page-transition],[data-v2-page-bootstrap-overlay],[data-cookie-banner]'))
    .map((element, index) => ({ locator: locator(element, index), kind: runtimeSurfaceOf(element), visible: visuallyVisible(element), accessible: accessibilityVisible(element) }));
  const actualRendererFamily = document.querySelector('[data-home-final-root]') ? 'home'
    : document.querySelector('.v2-project-detail') ? 'project'
    : document.querySelector('.v2-project-archive') ? 'project-archive'
    : document.querySelector('[data-practical-v2-root]') ? 'practical'
    : document.querySelector('.custom-order-v2') ? 'custom-order'
    : document.querySelector('.not-found-v2') ? 'not-found'
    : document.querySelector('[data-product-presentation]') ? 'product'
    : document.querySelector('[data-direction-v2-root]') ? 'direction'
    : catalogPrototype === 'category' ? 'category'
    : document.querySelector('[data-catalog-v2-root]') ? 'catalog'
    : 'unclassified';
  return {
    location: location.href, title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    robots: document.querySelector('meta[name="robots"]')?.content || '',
    h1: Array.from(document.querySelectorAll('h1')).map((element) => clean(element.textContent)),
    sections, media, backgroundMedia, interactions, businessOccurrences, galleries, bindings, listMarkers, dispositions, archiveRows, publicAssets,
    catalogPrototype, productPresentation, productGalleryCount, directionVariant, practicalKind,
    categoryHasProducts, categoryHasExamples, projectSparse, projectGalleryCount, actualRendererFamily,
    documentSize: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
    stableGeometry, runtimeSurfaces, fontDiagnostics,
    horizontalOverflow: overflow, overflowOffenders,
    brokenImages: media.filter((item) => item.tag === 'img' && (item.currentSrc || item.src) && item.complete && item.naturalWidth === 0).map((item) => item.currentSrc || item.src || item.locator),
    activeElement: document.activeElement?.tagName?.toLowerCase() || ''
  };
})()`;

const mediaUrls = (snapshot) => [...new Set([
  ...snapshot.media.flatMap((item) => {
    const fromSrcset = String(item.srcset || '').split(',').map((candidate) => candidate.trim().split(/\s+/u)[0]).filter(Boolean);
    return [item.src, item.currentSrc, item.poster, ...(item.declaredSources || []), ...fromSrcset];
  }),
  ...snapshot.backgroundMedia.flatMap((item) => Array.from(
    String(item.background || '').matchAll(/url\(["']?([^"')]+)["']?\)/giu),
    (match) => match[1]
  ))
].filter(Boolean))];

const verifyLocalMedia = async (snapshot, crawlOrigin) => {
  const baseOrigin = new URL(crawlOrigin).origin;
  const results = [];
  for (const value of mediaUrls(snapshot)) {
    let url;
    try { url = new URL(value, snapshot.location); } catch { continue; }
    if (url.origin !== baseOrigin || url.protocol === 'data:') continue;
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'manual' });
      results.push({ url: url.href, status: response.status, ok: response.ok });
    } catch (error) {
      results.push({ url: url.href, status: 0, ok: false, error: String(error) });
    }
  }
  return results;
};

const runtimeVariant = (expected, snapshot) => {
  if (expected.rendererFamily === 'category') {
    if (snapshot.categoryHasProducts && snapshot.categoryHasExamples) return 'mixed';
    if (snapshot.categoryHasProducts) return 'product-list';
    if (snapshot.categoryHasExamples) return 'gallery-only';
    return 'text-only';
  }
  if (expected.rendererFamily === 'product') {
    const mediaCount = snapshot.productGalleryCount;
    return `${snapshot.productPresentation || 'unknown'}-${mediaCount ? 'media' : 'no-media'}`;
  }
  if (expected.rendererFamily === 'project') {
    if (snapshot.projectSparse) return 'text-only';
    return snapshot.projectGalleryCount >= 8 ? 'large-gallery' : snapshot.projectGalleryCount ? 'gallery' : 'media-hero-only';
  }
  if (expected.rendererFamily === 'direction') return `direction-${snapshot.directionVariant || 'unknown'}`;
  if (expected.rendererFamily === 'practical') {
    const variants = { vacancies: 'vacancies-archive', vacancy: 'vacancy-detail', legal: 'privacy-legal' };
    return variants[snapshot.practicalKind] || snapshot.practicalKind || 'unknown';
  }
  const singleVariantByFamily = {
    home: 'home-final', catalog: 'catalog-hub', 'custom-order': 'custom-order',
    'not-found': '404', 'project-archive': 'archive'
  };
  return singleVariantByFamily[snapshot.actualRendererFamily] || 'unknown';
};

const bindingContractIssues = (binding, expectedRoute) => {
  const issues = [];
  if (!binding || typeof binding !== 'object' || binding.invalid) return ['invalid-json'];
  if (!binding.bindingId) issues.push('bindingId');
  if (binding.domTarget?.bindingIdAttribute !== binding.bindingId) issues.push('bindingId-attribute-mismatch');
  if (!binding.domTarget?.tag || ['html', 'body', 'main'].includes(binding.domTarget.tag)) issues.push(`blanket-dom-target:${binding.domTarget?.tag || 'missing'}`);
  if (!binding.route || logicalPathname(binding.route) !== expectedRoute) issues.push(`route:${binding.route || 'missing'}`);
  if (!binding.renderer?.family || !binding.renderer?.version) issues.push('renderer');
  if (!binding.ownerCollection || !binding.recordSlug || binding.owner?.collection !== binding.ownerCollection || binding.owner?.slug !== binding.recordSlug) issues.push('owner');
  if (!binding.fieldPath) issues.push('fieldPath');
  const sourceRecord = bindingRecords.get(`${binding.ownerCollection}:${binding.recordSlug}`);
  if (!sourceRecord) issues.push(`owner-not-found:${binding.ownerCollection}:${binding.recordSlug}`);
  const declaredPaths = DECLARED_SCHEMA_PATHS[binding.ownerCollection] || [];
  if (sourceRecord && !bindingFieldPathExists(sourceRecord, binding.fieldPath, declaredPaths)) {
    issues.push(`field-not-found:${binding.fieldPath || 'missing'}`);
  }
  issues.push(...structuredObjectListBindingIssues(binding, sourceRecord));
  if (!binding.stableItemId) issues.push('stableItemId');
  if (!['local', 'shared', 'global', 'legal', 'derived'].includes(binding.scope)) issues.push('scope');
  if (!binding.projection?.kind) issues.push('projection');
  if (binding.projection?.kind === 'derived' && !binding.projection?.formula) issues.push('projection-formula');
  if (binding.projection?.kind === 'fallback' && !binding.projection?.formula && !binding.projection?.fallback) issues.push('projection-fallback');
  if (!binding.tool) issues.push('tool');
  if (!Array.isArray(binding.affectedRoutes) || binding.affectedRoutes.length === 0) issues.push('affectedRoutes');
  else {
    if (binding.scope === 'global' && !binding.affectedRoutes.includes('*')) issues.push('global-impact');
    const affectsExpectedRoute = binding.affectedRoutes.some((route) => {
      const value = String(route || '');
      if (value === '*') return true;
      if (value.endsWith('/*')) return expectedRoute.startsWith(logicalPathname(value.slice(0, -1)));
      return logicalPathname(value) === expectedRoute;
    });
    const affects404Owner = expectedRoute === REAL_UNKNOWN_ROUTE
      && binding.affectedRoutes.some((route) => logicalPathname(route) === '/404.html');
    if (!affectsExpectedRoute && !affects404Owner) issues.push('route-impact');
  }
  if (!binding.permissions || typeof binding.permissions !== 'object') issues.push('permissions');
  else if (typeof binding.permissions.edit !== 'boolean' || typeof binding.permissions.reorder !== 'boolean' || typeof binding.permissions.delete !== 'boolean') issues.push('permission-flags');
  if (!binding.validation || typeof binding.validation !== 'object') issues.push('validation');
  const scalarTextTools = new Set(['button-label', 'heading', 'link', 'link-label', 'long-text', 'short-text']);
  const structuralTextTarget = binding.domTarget?.descendantTextNodes > 1 || binding.domTarget?.descendantMedia > 0;
  const safeStructuralTargets = new Set(['attribute:aria-label', 'paragraphs']);
  if (scalarTextTools.has(binding.tool) && structuralTextTarget && !safeStructuralTargets.has(binding.projection?.target)) {
    issues.push(`unsafe-structural-text-target:${binding.projection?.target || 'text'}`);
  }
  if (binding.currentDraftRevision !== 1) issues.push(`currentDraftRevision:${binding.currentDraftRevision ?? 'missing'}`);
  return issues;
};

const validDisposition = (occurrence) => Boolean(
  ['computed', 'contextual', 'derived', 'global', 'legal', 'template-fixed'].includes(occurrence.disposition?.kind)
  && occurrence.disposition?.reason
  && occurrence.disposition?.source
  && !['html', 'body', 'main'].includes(occurrence.disposition?.domTarget?.tag)
);

const coverageFor = (items, invalidBindingIds, kind) => {
  const visibleItems = items.filter((item) => item.visible && !item.runtimeSurface);
  const itemBound = (item) => Boolean(
    item.binding?.bindingId && !item.binding.ambiguous && !invalidBindingIds.has(item.binding.bindingId)
    && (kind === 'media'
      ? isDirectMediaBindingTool(item.binding.tool) || objectListBindingSupportsMedia(item.binding)
      : !['crop', 'gallery', 'image', 'media', 'reorder-item'].includes(item.binding.tool))
  );
  const bound = visibleItems.filter(itemBound);
  const declared = visibleItems.filter((item) => !itemBound(item) && validDisposition(item));
  const ambiguous = visibleItems.filter((item) => item.binding?.ambiguous && !validDisposition(item));
  const unclassifiedItems = visibleItems.filter((item) => !itemBound(item) && !validDisposition(item));
  return {
    total: items.length,
    visible: visibleItems.length,
    bound: bound.length,
    declaredNonDirect: declared.length,
    ambiguous: ambiguous.length,
    unclassified: unclassifiedItems.length,
    unclassifiedItems
  };
};

const NON_BINDING_TOOL_EXPECTATIONS = new Set(['integration-settings', 'legal-confirmation', 'record-actions']);
const RELATION_BINDING_TOOLS = new Set(['relation-list', 'relation-select', 'project-direction-relations']);
const bindingToolCapabilities = (bindings) => {
  const actual = new Set(bindings.map((binding) => binding.tool).filter(Boolean));
  const capabilities = new Set(actual);
  if (['button-label', 'heading', 'link-label', 'short-text'].some((tool) => actual.has(tool))) capabilities.add('inline-text');
  if (['gallery', 'media'].some((tool) => actual.has(tool))) capabilities.add('media');
  if (actual.has('reorder-item')) capabilities.add('reorder');
  if (bindings.some((binding) => binding.permissions?.reorder === true)) capabilities.add('reorder');
  if ([...RELATION_BINDING_TOOLS].some((tool) => actual.has(tool))) capabilities.add('relation');
  if (actual.has('list')) capabilities.add('legal-structure');
  if (['link', 'long-text', 'short-text'].some((tool) => actual.has(tool))) capabilities.add('contact');
  return capabilities;
};

const expectedToolCoverage = (expectedTools, bindings) => {
  const capabilities = bindingToolCapabilities(bindings);
  const expectedBindingTools = expectedTools.filter((tool) => !NON_BINDING_TOOL_EXPECTATIONS.has(tool));
  const missing = expectedBindingTools.filter((tool) => !capabilities.has(tool));
  return {
    expected: expectedTools,
    expectedBindingTools,
    nonBindingExpectations: expectedTools.filter((tool) => NON_BINDING_TOOL_EXPECTATIONS.has(tool)),
    actualBindingTools: [...new Set(bindings.map((binding) => binding.tool).filter(Boolean))].sort(),
    capabilities: [...capabilities].sort(),
    missing
  };
};

const warmFontCache = async () => {
  // font-display:optional deliberately preserves the cold first paint. That
  // performance state is covered by the H5/motion suites; route equivalence
  // compares the fully available renderer state so public and editor do not
  // inherit different metrics merely because they are opened sequentially.
  const warmRoute = routesToCrawl[0]?.pathname || '/';
  current.route = warmRoute;
  current.viewport = REQUIRED_VIEWPORTS[0].id;
  current.mode = 'font-cache-warmup';
  const eventIndex = events.length;
  const requestIndex = resourceRequests.length;
  await browser.setViewport(REQUIRED_VIEWPORTS[0]);
  await browser.emulateMedia({ reducedMotion: false });
  await browser.navigate(`${origin}${withBase(warmRoute)}`);
  await settleMediaAndScroll();
  const warmupEvents = events.slice(eventIndex);
  return {
    route: warmRoute,
    viewport: REQUIRED_VIEWPORTS[0].id,
    events: warmupEvents,
    failures: warmupEvents.filter((event) => !['console-warning', 'log-warning'].includes(event.kind)),
    resourceRequests: resourceRequests.slice(requestIndex)
  };
};

const routeResults = [];
const archivePresentation = new Map();
try {
  const fontWarmup = await warmFontCache();
  progress(`authoritative manifest reconciled: ${model.routes.length} concrete routes`);
  let completed = 0;
  for (const expected of routesToCrawl) {
    for (const viewport of REQUIRED_VIEWPORTS) {
      current.route = expected.pathname;
      current.viewport = viewport.id;
      current.mode = 'public';
      const startedEventIndex = events.length;
      const startedResponseIndex = documentResponses.length;
      const startedRequestIndex = resourceRequests.length;
      await browser.setViewport(viewport);
      await browser.emulateMedia({ reducedMotion: false });
      const requestedUrl = `${origin}${withBase(expected.pathname)}`;
      await browser.navigate(requestedUrl);
      await settleMediaAndScroll();
      const snapshot = await browser.evaluate(inventoryExpression);
      const localMedia = await verifyLocalMedia(snapshot, origin);
      const canonicalEvidence = testDeployArtifact
        ? { valid: !snapshot.canonical, reason: snapshot.canonical ? 'preview-canonical-present' : '', logicalPathname: '' }
        : canonicalIdentity(snapshot.canonical);
      const canonicalPathname = canonicalEvidence.logicalPathname;
      const finalPathname = logicalPathname(snapshot.location);
      const resultEvents = events.slice(startedEventIndex);
      const responses = documentResponses.slice(startedResponseIndex);
      const routeRequests = resourceRequests.slice(startedRequestIndex);
      const requestedDocumentStatus = responses.find((response) => logicalPathname(response.url) === expected.pathname)?.status || 0;
      const finalDocumentStatus = responses.findLast((response) => logicalPathname(response.url) === finalPathname)?.status || requestedDocumentStatus;
      const runtimeFailures = resultEvents.filter((event) => !['console-warning', 'log-warning'].includes(event.kind));
      const issues = [];
      if (expected === routesToCrawl[0] && viewport.id === REQUIRED_VIEWPORTS[0].id && fontWarmup.failures.length) {
        issues.push(`cold-font-warmup-runtime-or-network:${fontWarmup.failures.length}`);
      }
      if (requestedDocumentStatus !== 200) issues.push(`document-status:${requestedDocumentStatus}`);
      if (finalDocumentStatus !== 200) issues.push(`final-document-status:${finalDocumentStatus}`);
      if (snapshot.h1.length !== 1) issues.push(`h1-count:${snapshot.h1.length}`);
      if (testDeployArtifact && snapshot.canonical) issues.push(`test-canonical-present:${snapshot.canonical}`);
      if (testDeployArtifact && !/noindex/iu.test(snapshot.robots)) issues.push('test-preview-not-noindex');
      if (!testDeployArtifact && expected.routeClass !== '404' && !canonicalEvidence.valid) issues.push(`canonical-identity:${canonicalEvidence.reason}`);
      if (!testDeployArtifact && expected.routeClass === 'canonical' && canonicalPathname !== expected.pathname) issues.push(`canonical:${canonicalPathname || 'missing'}`);
      if (!testDeployArtifact && expected.routeClass === 'alias' && canonicalPathname !== expected.canonicalTarget) issues.push(`alias-canonical:${canonicalPathname || 'missing'}`);
      if (!testDeployArtifact && expected.routeClass === '404' && snapshot.canonical) issues.push('404-canonical-present');
      if (expected.routeClass === '404' && !/noindex/iu.test(snapshot.robots)) issues.push('404-not-noindex');
      if (expected.routeClass === 'alias' && finalPathname !== expected.canonicalTarget) issues.push(`alias-final:${finalPathname}`);
      if (snapshot.horizontalOverflow > 1) issues.push(`horizontal-overflow:${snapshot.horizontalOverflow}`);
      if (snapshot.brokenImages.length) issues.push(`broken-images:${snapshot.brokenImages.length}`);
      const failedMedia = localMedia.filter((item) => !item.ok);
      if (failedMedia.length) issues.push(`broken-local-media:${failedMedia.length}`);
      if (runtimeFailures.length) issues.push(`runtime-or-network:${runtimeFailures.length}`);
      if (snapshot.bindings.length) issues.push(`public-binding-leak:${snapshot.bindings.length}`);
      if (snapshot.listMarkers.length) issues.push(`public-list-marker-leak:${snapshot.listMarkers.length}`);
      if (snapshot.dispositions.length) issues.push(`public-editor-disposition-leak:${snapshot.dispositions.length}`);
      const adminAssetLeaks = snapshot.publicAssets.filter((asset) => {
        try {
          const pathname = new URL(asset.url, snapshot.location).pathname;
          return /\/(?:admin|api\/admin)(?:\/|$)|\/(?:[^/]*(?:visual-editor|editor-bridge|binding-registry)[^/]*)$/iu.test(pathname);
        } catch { return false; }
      });
      if (adminAssetLeaks.length) issues.push(`public-admin-asset-leak:${adminAssetLeaks.length}`);
      const runtimeDescriptor = expected.routeClass === 'alias'
        ? expectedRouteByPath.get(expected.canonicalTarget) || expected
        : expected;
      const actualVariant = runtimeVariant(runtimeDescriptor, snapshot);
      const acceptedRuntimeFamilies = expected.rendererFamily === 'category'
        ? ['category']
        : expected.rendererFamily === 'catalog'
          ? ['catalog']
          : [expected.rendererFamily];
      if (expected.routeClass === 'canonical' && !acceptedRuntimeFamilies.includes(snapshot.actualRendererFamily)) {
        issues.push(`renderer-family:${snapshot.actualRendererFamily}`);
      }
      if (expected.routeClass !== 'alias' && expected.rendererFamily !== 'project' && actualVariant !== expected.rendererVariant) {
        issues.push(`renderer-variant:${actualVariant}`);
      }
      for (const row of snapshot.archiveRows) {
        const route = logicalPathname(row.href);
        archivePresentation.set(route, {
          orientation: row.classes.includes('v2-project-archive-row--portrait') ? 'portrait' : 'landscape',
          placement: row.classes.includes('v2-project-archive-row--media-start') ? 'media-first'
            : row.classes.includes('v2-project-archive-row--media-end') ? 'media-last' : 'text-only',
          classes: row.classes
        });
      }
      let editor = {
        status: options.editorOrigin ? (expected.routeClass === 'alias' ? 'not-applicable-alias' : 'pending') : 'not-collected',
        bindings: [], invalidBindings: [], bindingMultiplicity: [], tools: [], owners: [], occurrences: [], occurrenceCoverage: null,
        mediaOccurrences: [], mediaCoverage: null, toolCoverage: null, equivalence: null, events: [], expectedDocumentEvents: []
      };
      if (options.editorOrigin && expected.routeClass !== 'alias') {
        current.mode = 'editor-canvas';
        const session = crypto.randomUUID();
        const editorEventIndex = events.length;
        // The production artifact may live under a deploy base (for example
        // GitHub Pages /SMU1), while the explicit loopback editor always owns
        // its local routes at `/`. Keep those two routing domains independent.
        const editorUrl = new URL(expected.pathname, `${options.editorOrigin}/`);
        editorUrl.searchParams.set('__smu1_editor', '1');
        editorUrl.searchParams.set('editorSession', session);
        editorUrl.searchParams.set('editorRevision', '1');
        await browser.navigate(editorUrl.href);
        await settleMediaAndScroll();
        const editorSnapshot = await browser.evaluate(inventoryExpression);
        const editorEventPartition = expected.routeClass === '404'
          ? partitionExpectedNotFoundDocumentEvents(events.slice(editorEventIndex), expected.pathname)
          : { expected: [], unexpected: events.slice(editorEventIndex) };
        const editorEvents = editorEventPartition.unexpected;
        const invalidBindings = editorSnapshot.bindings.map((binding) => ({
          binding,
          issues: bindingContractIssues(binding, expected.pathname)
        })).filter((entry) => entry.issues.length);
        const bindingIdCounts = editorSnapshot.bindings.reduce((counts, binding) => {
          if (binding?.bindingId) counts.set(binding.bindingId, (counts.get(binding.bindingId) || 0) + 1);
          return counts;
        }, new Map());
        const bindingMultiplicity = [...bindingIdCounts].filter(([, count]) => count > 1).map(([bindingId, count]) => ({ bindingId, count }));
        const invalidBindingIds = new Set(invalidBindings.map((entry) => entry.binding?.bindingId).filter(Boolean));
        const occurrenceCoverage = coverageFor(editorSnapshot.businessOccurrences, invalidBindingIds, 'text');
        const editorMedia = [
          ...editorSnapshot.media.filter((item) => ['img', 'video'].includes(item.tag) && (item.src || item.currentSrc || item.poster || item.declaredSources?.length)),
          ...editorSnapshot.backgroundMedia
        ];
        const mediaCoverage = coverageFor(editorMedia, invalidBindingIds, 'media');
        const toolCoverage = expectedToolCoverage(expected.expectedTools, editorSnapshot.bindings);
        const mediaComparison = compareMediaSnapshots(snapshot, editorSnapshot, mediaComparisonOptions);
        const mediaPathsMatch = mediaComparison.match;
        const mediaDiff = mediaComparison.diff;
        const equivalenceIssues = [];
        const editorLocation = new URL(editorSnapshot.location);
        if (logicalPathname(editorSnapshot.location) !== expected.pathname) equivalenceIssues.push('logical-route');
        if (editorLocation.searchParams.get('__smu1_editor') !== '1'
          || editorLocation.searchParams.get('editorSession') !== session
          || editorLocation.searchParams.get('editorRevision') !== '1') equivalenceIssues.push('editor-session');
        if (JSON.stringify(editorSnapshot.h1) !== JSON.stringify(snapshot.h1)) equivalenceIssues.push('h1');
        if (editorSnapshot.actualRendererFamily !== snapshot.actualRendererFamily) equivalenceIssues.push('renderer-family');
        if (runtimeVariant(expected, editorSnapshot) !== runtimeVariant(expected, snapshot)) equivalenceIssues.push('renderer-variant');
        const publicComparableText = comparableBusinessText(snapshot);
        const editorComparableText = comparableBusinessText(editorSnapshot);
        if (JSON.stringify(editorComparableText) !== JSON.stringify(publicComparableText)) equivalenceIssues.push('stable-content-text');
        if (!mediaPathsMatch) equivalenceIssues.push('media');
        const stableGeometryIssues = compareStableGeometry(snapshot.stableGeometry, editorSnapshot.stableGeometry);
        if (stableGeometryIssues.length) equivalenceIssues.push(`stable-geometry:${stableGeometryIssues.join('|')}`);
        const editorFailures = editorEvents.filter((event) => !['console-warning', 'log-warning'].includes(event.kind));
        if (editorFailures.length) equivalenceIssues.push(`runtime-or-network:${editorFailures.length}`);
        editor = {
          status: invalidBindings.length || bindingMultiplicity.length || occurrenceCoverage.ambiguous || mediaCoverage.ambiguous || toolCoverage.missing.length || equivalenceIssues.length
            ? 'invalid'
            : editorSnapshot.bindings.length && occurrenceCoverage.unclassified === 0 && mediaCoverage.unclassified === 0 ? 'covered' : 'uncovered',
          bindings: editorSnapshot.bindings,
          invalidBindings,
          bindingMultiplicity,
          tools: [...new Set(editorSnapshot.bindings.map((binding) => binding.tool).filter(Boolean))].sort(),
          owners: [...new Set(editorSnapshot.bindings.map((binding) => `${binding.ownerCollection}:${binding.recordSlug}`).filter(Boolean))].sort(),
          occurrences: editorSnapshot.businessOccurrences,
          occurrenceCoverage,
          mediaOccurrences: editorMedia,
          mediaCoverage,
          toolCoverage,
          equivalence: {
            status: equivalenceIssues.length ? 'fail' : 'pass',
            issues: equivalenceIssues,
            normalization: {
              excludedRuntimeSurfaces: ['cookie-banner', 'entry-skip-link', 'entry-transition'],
              publicRuntimeSurfaces: snapshot.runtimeSurfaces,
              editorRuntimeSurfaces: editorSnapshot.runtimeSurfaces,
              publicComparableTextOccurrences: publicComparableText.length,
              editorComparableTextOccurrences: editorComparableText.length,
              publicStableGeometry: snapshot.stableGeometry,
              editorStableGeometry: editorSnapshot.stableGeometry,
            mediaDiff,
            publicFontDiagnostics: snapshot.fontDiagnostics,
            editorFontDiagnostics: editorSnapshot.fontDiagnostics,
            stableGeometryIssues
            }
          },
          events: editorEvents,
          expectedDocumentEvents: editorEventPartition.expected
        };
        if (invalidBindings.length) issues.push(`invalid-editor-bindings:${invalidBindings.length}`);
        if (bindingMultiplicity.length) issues.push(`duplicate-editor-binding-ids:${bindingMultiplicity.length}`);
        if (occurrenceCoverage.ambiguous) issues.push(`ambiguous-editor-occurrences:${occurrenceCoverage.ambiguous}`);
        if (occurrenceCoverage.unclassified) issues.push(`unclassified-editor-occurrences:${occurrenceCoverage.unclassified}`);
        if (mediaCoverage.ambiguous) issues.push(`ambiguous-editor-media:${mediaCoverage.ambiguous}`);
        if (mediaCoverage.unclassified) issues.push(`unclassified-editor-media:${mediaCoverage.unclassified}`);
        if (toolCoverage.missing.length) issues.push(`missing-editor-tools:${toolCoverage.missing.join(',')}`);
        if (equivalenceIssues.length) issues.push(`editor-production-mismatch:${equivalenceIssues.join(',')}`);
        if (options.requireEditorCoverage && expected.routeClass !== 'alias' && editor.status !== 'covered') {
          issues.push(`editor-coverage:${editor.status}`);
        }
      }
      routeResults.push({
        route: expected.pathname,
        requestedUrl,
        viewport,
        routeClass: expected.routeClass,
        canonicalTarget: expected.canonicalTarget,
        renderer: { family: expected.rendererFamily, actualFamily: snapshot.actualRendererFamily, expectedVariant: expected.rendererVariant, actualVariant },
        h1: snapshot.h1,
        title: snapshot.title,
        canonical: snapshot.canonical,
        canonicalPolicy: testDeployArtifact ? 'suppressed-noindex-preview' : 'required-production-canonical',
        robots: snapshot.robots,
        finalUrl: snapshot.location,
        requestedDocumentStatus,
        finalDocumentStatus,
        documentResponses: responses,
        visibleSections: snapshot.sections,
        media: snapshot.media,
        backgroundMedia: snapshot.backgroundMedia,
        galleries: snapshot.galleries,
        interactions: snapshot.interactions,
        publicAssets: snapshot.publicAssets,
        businessOccurrences: snapshot.businessOccurrences,
        runtimeSurfaces: snapshot.runtimeSurfaces,
        sourceOwners: expected.sourceOwners,
        expectedTools: expected.expectedTools,
        editor,
        diagnostics: {
          stableGeometry: snapshot.stableGeometry,
          horizontalOverflow: snapshot.horizontalOverflow,
          overflowOffenders: snapshot.overflowOffenders,
          brokenImages: snapshot.brokenImages,
          localMedia,
          resourceRequests: routeRequests,
          adminAssetLeaks,
          events: resultEvents
        },
        issues,
        status: issues.length ? 'fail' : 'pass'
      });
      completed += 1;
      if (completed % 20 === 0 || completed === routesToCrawl.length * REQUIRED_VIEWPORTS.length) {
        progress(`opened ${completed}/${routesToCrawl.length * REQUIRED_VIEWPORTS.length} required route/viewport pairs`);
      }
    }
  }

  const unknownResults = [];
  const notFoundExpected = model.routes.find((route) => route.pathname === '/404.html');
  for (const viewport of REQUIRED_VIEWPORTS) {
    current.route = REAL_UNKNOWN_ROUTE;
    current.viewport = viewport.id;
    current.mode = 'public-unknown-probe';
    const eventIndex = events.length;
    const requestIndex = resourceRequests.length;
    const responseIndex = documentResponses.length;
    await browser.setViewport(viewport);
    await browser.navigate(`${origin}${withBase(REAL_UNKNOWN_ROUTE)}`);
    await settleMediaAndScroll();
    const snapshot = await browser.evaluate(inventoryExpression);
    const localMedia = await verifyLocalMedia(snapshot, origin);
    const responses = documentResponses.slice(responseIndex);
    const unknownEventPartition = partitionExpectedNotFoundDocumentEvents(events.slice(eventIndex));
    const unknownEvents = unknownEventPartition.unexpected;
    const unknownRequests = resourceRequests.slice(requestIndex);
    const documentStatus = responses.findLast((response) => logicalPathname(response.url) === REAL_UNKNOWN_ROUTE)?.status || 0;
    const issues = [];
    if (documentStatus !== 404) issues.push(`http-status:${documentStatus}`);
    if (snapshot.h1.length !== 1) issues.push(`h1-count:${snapshot.h1.length}`);
    if (!/noindex/iu.test(snapshot.robots)) issues.push('unknown-not-noindex');
    if (snapshot.actualRendererFamily !== 'not-found') issues.push(`renderer-family:${snapshot.actualRendererFamily}`);
    if (snapshot.horizontalOverflow > 1) issues.push(`horizontal-overflow:${snapshot.horizontalOverflow}`);
    if (snapshot.brokenImages.length) issues.push(`broken-images:${snapshot.brokenImages.length}`);
    if (localMedia.some((item) => !item.ok)) issues.push(`broken-local-media:${localMedia.filter((item) => !item.ok).length}`);
    if (unknownEvents.some((event) => !['console-warning', 'log-warning'].includes(event.kind))) issues.push(`runtime-or-network:${unknownEvents.length}`);
    if (snapshot.bindings.length) issues.push(`public-binding-leak:${snapshot.bindings.length}`);
    if (snapshot.listMarkers.length) issues.push(`public-list-marker-leak:${snapshot.listMarkers.length}`);
    if (snapshot.dispositions.length) issues.push(`public-editor-disposition-leak:${snapshot.dispositions.length}`);
    const adminAssetLeaks = snapshot.publicAssets.filter((asset) => {
      try {
        const pathname = new URL(asset.url, snapshot.location).pathname;
        return /\/(?:admin|api\/admin)(?:\/|$)|\/(?:[^/]*(?:visual-editor|editor-bridge|binding-registry)[^/]*)$/iu.test(pathname);
      } catch { return false; }
    });
    if (adminAssetLeaks.length) issues.push(`public-admin-asset-leak:${adminAssetLeaks.length}`);

    let editor = { status: options.editorOrigin ? 'pending' : 'not-collected', bindings: [], invalidBindings: [], bindingMultiplicity: [], occurrences: [], mediaOccurrences: [], occurrenceCoverage: null, mediaCoverage: null, toolCoverage: null, equivalence: null, events: [] };
    if (options.editorOrigin) {
      current.mode = 'editor-canvas-unknown';
      const session = crypto.randomUUID();
      const editorEventIndex = events.length;
      const editorUrl = new URL(REAL_UNKNOWN_ROUTE, `${options.editorOrigin}/`);
      editorUrl.searchParams.set('__smu1_editor', '1');
      editorUrl.searchParams.set('editorSession', session);
      editorUrl.searchParams.set('editorRevision', '1');
      await browser.navigate(editorUrl.href);
      await settleMediaAndScroll();
      const editorSnapshot = await browser.evaluate(inventoryExpression);
      const editorEventPartition = partitionExpectedNotFoundDocumentEvents(events.slice(editorEventIndex));
      const editorEvents = editorEventPartition.unexpected;
      const invalidBindings = editorSnapshot.bindings.map((binding) => ({ binding, issues: bindingContractIssues(binding, REAL_UNKNOWN_ROUTE) })).filter((entry) => entry.issues.length);
      const bindingIdCounts = editorSnapshot.bindings.reduce((counts, binding) => {
        if (binding?.bindingId) counts.set(binding.bindingId, (counts.get(binding.bindingId) || 0) + 1);
        return counts;
      }, new Map());
      const bindingMultiplicity = [...bindingIdCounts].filter(([, count]) => count > 1).map(([bindingId, count]) => ({ bindingId, count }));
      const invalidBindingIds = new Set(invalidBindings.map((entry) => entry.binding?.bindingId).filter(Boolean));
      const occurrenceCoverage = coverageFor(editorSnapshot.businessOccurrences, invalidBindingIds, 'text');
      const editorMedia = [
        ...editorSnapshot.media.filter((item) => ['img', 'video'].includes(item.tag) && (item.src || item.currentSrc || item.poster || item.declaredSources?.length)),
        ...editorSnapshot.backgroundMedia
      ];
      const mediaCoverage = coverageFor(editorMedia, invalidBindingIds, 'media');
      const toolCoverage = expectedToolCoverage(notFoundExpected?.expectedTools || [], editorSnapshot.bindings);
      const mediaComparison = compareMediaSnapshots(snapshot, editorSnapshot, mediaComparisonOptions);
      const equivalenceIssues = [];
      const editorLocation = new URL(editorSnapshot.location);
      if (logicalPathname(editorSnapshot.location) !== REAL_UNKNOWN_ROUTE) equivalenceIssues.push('logical-route');
      if (editorLocation.searchParams.get('__smu1_editor') !== '1'
        || editorLocation.searchParams.get('editorSession') !== session
        || editorLocation.searchParams.get('editorRevision') !== '1') equivalenceIssues.push('editor-session');
      if (JSON.stringify(editorSnapshot.h1) !== JSON.stringify(snapshot.h1)) equivalenceIssues.push('h1');
      if (editorSnapshot.actualRendererFamily !== snapshot.actualRendererFamily) equivalenceIssues.push('renderer-family');
      const publicComparableText = comparableBusinessText(snapshot);
      const editorComparableText = comparableBusinessText(editorSnapshot);
      if (JSON.stringify(editorComparableText) !== JSON.stringify(publicComparableText)) equivalenceIssues.push('stable-content-text');
      if (!mediaComparison.match) equivalenceIssues.push('media');
      const stableGeometryIssues = compareStableGeometry(snapshot.stableGeometry, editorSnapshot.stableGeometry);
      if (stableGeometryIssues.length) equivalenceIssues.push(`stable-geometry:${stableGeometryIssues.join('|')}`);
      if (editorEvents.some((event) => !['console-warning', 'log-warning'].includes(event.kind))) equivalenceIssues.push(`runtime-or-network:${editorEvents.length}`);
      editor = {
        status: invalidBindings.length || bindingMultiplicity.length || occurrenceCoverage.ambiguous || mediaCoverage.ambiguous || toolCoverage.missing.length || equivalenceIssues.length
          ? 'invalid'
          : editorSnapshot.bindings.length && occurrenceCoverage.unclassified === 0 && mediaCoverage.unclassified === 0 ? 'covered' : 'uncovered',
        bindings: editorSnapshot.bindings,
        invalidBindings,
        bindingMultiplicity,
        occurrences: editorSnapshot.businessOccurrences,
        mediaOccurrences: editorMedia,
        occurrenceCoverage,
        mediaCoverage,
        toolCoverage,
        equivalence: {
          status: equivalenceIssues.length ? 'fail' : 'pass',
          issues: equivalenceIssues,
          normalization: {
            excludedRuntimeSurfaces: ['cookie-banner', 'entry-skip-link', 'entry-transition'],
            publicRuntimeSurfaces: snapshot.runtimeSurfaces,
            editorRuntimeSurfaces: editorSnapshot.runtimeSurfaces,
            publicComparableTextOccurrences: publicComparableText.length,
            editorComparableTextOccurrences: editorComparableText.length,
            publicStableGeometry: snapshot.stableGeometry,
            editorStableGeometry: editorSnapshot.stableGeometry,
            mediaDiff: mediaComparison.diff,
            stableGeometryIssues
          }
        },
        events: editorEvents,
        expectedDocumentEvents: editorEventPartition.expected
      };
      if (invalidBindings.length) issues.push(`invalid-editor-bindings:${invalidBindings.length}`);
      if (bindingMultiplicity.length) issues.push(`duplicate-editor-binding-ids:${bindingMultiplicity.length}`);
      if (occurrenceCoverage.ambiguous) issues.push(`ambiguous-editor-occurrences:${occurrenceCoverage.ambiguous}`);
      if (occurrenceCoverage.unclassified) issues.push(`unclassified-editor-occurrences:${occurrenceCoverage.unclassified}`);
      if (mediaCoverage.ambiguous) issues.push(`ambiguous-editor-media:${mediaCoverage.ambiguous}`);
      if (mediaCoverage.unclassified) issues.push(`unclassified-editor-media:${mediaCoverage.unclassified}`);
      if (toolCoverage.missing.length) issues.push(`missing-editor-tools:${toolCoverage.missing.join(',')}`);
      if (equivalenceIssues.length) issues.push(`editor-production-mismatch:${equivalenceIssues.join(',')}`);
      if (options.requireEditorCoverage && editor.status !== 'covered') issues.push(`editor-coverage:${editor.status}`);
    }
    unknownResults.push({
      route: REAL_UNKNOWN_ROUTE,
      routeClass: 'unknown-404',
      canonicalTarget: '/404.html',
      viewport,
      documentStatus,
      finalUrl: snapshot.location,
      renderer: { family: 'not-found', actualFamily: snapshot.actualRendererFamily, expectedVariant: '404', actualVariant: runtimeVariant(notFoundExpected, snapshot) },
      h1: snapshot.h1,
      robots: snapshot.robots,
      visibleSections: snapshot.sections,
      media: snapshot.media,
      backgroundMedia: snapshot.backgroundMedia,
      galleries: snapshot.galleries,
      interactions: snapshot.interactions,
      businessOccurrences: snapshot.businessOccurrences,
      runtimeSurfaces: snapshot.runtimeSurfaces,
      publicAssets: snapshot.publicAssets,
      sourceOwners: notFoundExpected?.sourceOwners || [],
      expectedTools: notFoundExpected?.expectedTools || [],
      editor,
      diagnostics: {
        stableGeometry: snapshot.stableGeometry,
        horizontalOverflow: snapshot.horizontalOverflow,
        overflowOffenders: snapshot.overflowOffenders,
        brokenImages: snapshot.brokenImages,
        localMedia,
        events: unknownEvents,
        expectedDocumentEvents: unknownEventPartition.expected,
        resourceRequests: unknownRequests,
        adminAssetLeaks
      },
      issues,
      status: issues.length ? 'fail' : 'pass'
    });
  }

  for (const result of routeResults) {
    if (result.renderer.family !== 'project') continue;
    const presentation = archivePresentation.get(result.route) || null;
    result.renderer.archivePresentation = presentation;
    if (!presentation) {
      result.issues.push('project-archive-presentation-unreconciled');
      result.status = 'fail';
    } else {
      result.renderer.actualVariant = `${result.renderer.actualVariant}+${presentation.orientation}+${presentation.placement}`;
      if (result.renderer.actualVariant !== result.renderer.expectedVariant) {
        result.issues.push(`renderer-variant:${result.renderer.actualVariant}`);
        result.status = 'fail';
      }
    }
  }

  const failed = routeResults.filter((result) => result.status === 'fail');
  const routeRepresentatives = routeResults.filter((result) => result.viewport.id === REQUIRED_VIEWPORTS[0].id);
  const tally = (values) => values.reduce((counts, value) => {
    const key = String(value || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const output = {
    schemaVersion: ROUTE_PASSPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    evidence: {
      sourceSHA: git('rev-parse', 'HEAD'),
      branch: git('branch', '--show-current') || '(detached)',
      dirty: sourceWorkingTreeDirty(root),
      distFingerprintSHA256: distFingerprint.aggregate,
      htmlFileHashes: distFingerprint.entries,
      artifactFingerprintSHA256: artifactFingerprint.aggregate,
      artifactFileHashes: artifactFingerprint.entries,
      artifactFileCount: artifactFingerprint.fileCount,
      artifactBytes: artifactFingerprint.totalBytes,
      artifactIsolation,
      origin,
      editorOrigin: options.editorOrigin || null,
      basePath: normalizedBase,
      canonicalOrigin,
      distFreshness,
      browserSafety: browser.safetyEvidence()
    },
    fontWarmup,
    manifest: {
      ...reconciliation,
      summary: summarizeRouteModel(model.routes),
      expectedCount: model.routes.length,
      discoveredCount: discovered.length,
      openedRouteViewportPairs: routeResults.length,
      requiredRouteViewportPairs: model.routes.length * REQUIRED_VIEWPORTS.length,
      concreteCoverage: !options.onlyRoute && routeResults.length === model.routes.length * REQUIRED_VIEWPORTS.length,
      developmentFilter: options.onlyRoute || null
    },
    routeResults,
    unknownResults,
    aggregate: {
      passed: routeResults.length - failed.length,
      failed: failed.length,
      unknownPassed: unknownResults.filter((result) => result.status === 'pass').length,
      editorCovered: routeResults.filter((result) => result.editor.status === 'covered').length,
      bindingOccurrences: routeResults.reduce((count, result) => count + result.editor.bindings.length, 0),
      interactions: routeResults.reduce((count, result) => count + result.interactions.length, 0),
      images: routeResults.reduce((count, result) => count + result.media.filter((item) => item.tag === 'img').length, 0),
      galleries: routeResults.reduce((count, result) => count + result.galleries.length, 0),
      consoleNetworkEvents: fontWarmup.failures.length + routeResults.reduce((count, result) => count + result.diagnostics.events.length, 0),
      publicArtifactIsolation: artifactIsolation.clean,
      publicArtifactLeaks: artifactIsolation.leaks.length,
      actualRendererFamilies: tally(routeRepresentatives.map((result) => result.renderer.actualFamily)),
      actualRendererVariants: tally(routeRepresentatives.map((result) => result.renderer.actualVariant)),
      routeClasses: tally(routeRepresentatives.map((result) => result.routeClass))
    }
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  progress(`passport written to ${path.relative(root, options.output)}; ${output.aggregate.passed}/${routeResults.length} route/viewports passed`);
  if (options.json) process.stdout.write(`${JSON.stringify(output)}\n`);
  else process.stdout.write(`${JSON.stringify({ manifest: output.manifest, aggregate: output.aggregate, output: options.output }, null, 2)}\n`);
  if (!artifactIsolation.clean || failed.length || unknownResults.some((result) => result.status === 'fail')) process.exitCode = 1;
} finally {
  await browser.close();
  await distServer?.close();
}

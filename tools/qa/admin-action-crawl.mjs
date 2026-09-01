import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classifyAdminAction } from './action-crawl-core.mjs';
import {
  ADMIN_EDITOR_REVISION_PATTERN_SOURCE,
  ADMIN_EDITOR_SESSION_PATTERN_SOURCE,
  isAdminHomeCanvasReady
} from './admin-canvas-contract.mjs';
import { CdpBrowser } from './cdp-browser.mjs';
import { buildExpectedRouteModel, reconcileRouteSets } from './route-passport-model.mjs';

const root = process.cwd();
const routeModel = buildExpectedRouteModel({ root });
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const option = (name, fallback = '') => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const options = {
  help: hasFlag('--help') || hasFlag('-h'), headful: hasFlag('--headful'), json: hasFlag('--json'),
  isolatedMutations: hasFlag('--isolated-mutations'),
  origin: option('--origin', process.env.H6_QA_ADMIN_ORIGIN || '').replace(/\/$/u, ''),
  usernameEnv: option('--username-env', 'H6_QA_ADMIN_USERNAME'),
  passwordEnv: option('--password-env', 'H6_QA_ADMIN_PASSWORD'),
  isolationProof: option('--isolation-proof', process.env.H6_QA_ISOLATION_PROOF || ''),
  output: path.resolve(root, option('--output', '.admin-runtime/h6-qa/admin-action-crawl.json'))
};
const verboseProgress = process.env.H6_QA_VERBOSE === 'true';
if (options.help) {
  process.stdout.write(`H6 visual-editor action registry and safe crawl\n\n`);
  process.stdout.write(`  H6_QA_ADMIN_ORIGIN=http://127.0.0.1:<port> H6_QA_ADMIN_USERNAME=<synthetic> H6_QA_ADMIN_PASSWORD=<synthetic> node tools/qa/admin-action-crawl.mjs\n`);
  process.stdout.write(`  Options: --origin=<loopback>, --output=<json>, --isolated-mutations --isolation-proof=<json>, --headful, --json.\n`);
  process.stdout.write(`  Credentials are read only from named environment variables. Release/publish actions and file pickers are never executed.\n`);
  process.stdout.write(`  --isolated-mutations is valid only behind the repository's isolated writable fixture and intercepted publish namespace.\n`);
  process.exit(0);
}
if (!options.origin) throw new Error('A running local editor origin is required via --origin or H6_QA_ADMIN_ORIGIN.');
const parsedOrigin = new URL(options.origin);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsedOrigin.hostname)) throw new Error(`Admin action crawl accepts only loopback origins, received ${parsedOrigin.hostname}.`);
let isolationProof = null;
if (options.isolatedMutations) {
  if (!options.isolationProof) throw new Error('--isolated-mutations requires --isolation-proof=<json> issued by the disposable fixture launcher.');
  const proof = JSON.parse(await readFile(path.resolve(root, options.isolationProof), 'utf8'));
  const valid = proof?.schemaVersion === 1
    && path.resolve(proof.disposableRoot || '') === root
    && new URL(proof.origin || '').origin === parsedOrigin.origin
    && proof.publishIntercepted === true
    && proof.sourceWritesDisposable === true
    && typeof proof.nonce === 'string' && proof.nonce.length >= 24;
  if (!valid) throw new Error('The isolated-mutation proof does not match this checkout/origin or lacks publish interception.');
  isolationProof = {
    valid: true,
    schemaVersion: proof.schemaVersion,
    disposableRoot: path.resolve(proof.disposableRoot),
    origin: new URL(proof.origin).origin,
    publishIntercepted: true,
    sourceWritesDisposable: true,
    nonceSHA256: (await import('node:crypto')).createHash('sha256').update(proof.nonce).digest('hex')
  };
}

const progress = (message) => process.stderr.write(`[h6-admin-actions] ${message}\n`);
const git = (...args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); }
  catch { return ''; }
};
const sanitizeObservedUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    return { origin: url.origin, pathname: url.pathname, queryKeys: [...new Set(url.searchParams.keys())].sort() };
  } catch {
    return { origin: '', pathname: '', queryKeys: [] };
  }
};
const browser = await new CdpBrowser({ headful: options.headful, safetyMode: 'admin-no-release' }).start();
const current = { actionKey: '', mode: '' };
const events = [];
const requests = [];
browser.on('Runtime.exceptionThrown', ({ exceptionDetails }) => events.push({ ...current, kind: 'runtime-exception', text: exceptionDetails?.exception?.description || exceptionDetails?.text || '' }));
browser.on('Runtime.consoleAPICalled', ({ type, args }) => {
  if (['error', 'assert'].includes(type)) events.push({ ...current, kind: `console-${type}`, text: args?.map((item) => item.value ?? item.description ?? '').join(' ') || '' });
});
browser.on('Network.responseReceived', ({ response, type }) => {
  const url = sanitizeObservedUrl(response.url);
  const expectedNotFoundCanvas = response.status === 404 && current.actionKey === 'canvas-route:/404.html'
    && ['/404', '/404.html'].includes(url.pathname);
  if (response.status >= 400 && !expectedNotFoundCanvas) events.push({ ...current, kind: 'http-response', status: response.status, url, resourceType: type });
});
browser.on('Network.requestWillBeSent', ({ request, type }) => {
  const url = sanitizeObservedUrl(request.url);
  if (url.origin === parsedOrigin.origin) requests.push({ ...current, method: request.method, url, resourceType: type });
});

const inventoryExpression = `(() => {
  const clean = (value) => String(value || '').replace(/\\s+/gu, ' ').trim();
  const visible = (element) => { const style = element.ownerDocument.defaultView.getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && !element.hidden && rect.width > 0 && rect.height > 0; };
  const collect = (documentValue, contextName) => Array.from(documentValue.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="treeitem"],[tabindex]')).map((element) => {
    let nextId = Number(documentValue.documentElement.dataset.h6AdminNextActionId || 1);
    const id = element.dataset.h6AdminActionId || 'a' + nextId++;
    element.dataset.h6AdminActionId = id;
    documentValue.documentElement.dataset.h6AdminNextActionId = String(nextId);
    return {
      context: contextName, id, domId: element.id || '', tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || '',
      classes: Array.from(element.classList),
      containerId: element.parentElement?.closest('[id]')?.id || '',
      name: clean(element.getAttribute('aria-label') || element.title || element.textContent || element.value),
      href: element.getAttribute('href') || '', type: element.type || '', visible: visible(element),
      disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'), tabIndex: element.tabIndex,
      dataActions: Array.from(element.attributes).filter((item) => item.name.startsWith('data-') && item.name !== 'data-h6-admin-action-id').map((item) => item.name),
      dataAttributes: Object.fromEntries(Array.from(element.attributes).filter((item) => item.name.startsWith('data-') && item.name !== 'data-h6-admin-action-id').map((item) => [item.name, item.value]))
    };
  });
  const result = collect(document, 'shell');
  for (const [index, frame] of Array.from(document.querySelectorAll('iframe')).entries()) {
    try { if (frame.contentDocument) result.push(...collect(frame.contentDocument, 'iframe-' + (frame.id || index + 1))); } catch {}
  }
  return result;
})()`;

const actionExpression = (action) => `(() => {
  const frameValue = ${action.context === 'shell'
    ? 'null'
    : `Array.from(document.querySelectorAll('iframe')).find((frame, index) => 'iframe-' + (frame.id || index + 1) === ${JSON.stringify(action.context)})`};
  const documentValue = ${action.context === 'shell' ? 'document' : 'frameValue?.contentDocument'};
  const element = documentValue?.querySelector('[data-h6-admin-action-id="${action.id}"]');
  if (!element) return { found: false };
  const visible = (() => { const style = element.ownerDocument.defaultView.getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && !element.hidden && rect.width > 0 && rect.height > 0; })();
  if (!visible || element.disabled || element.getAttribute('aria-disabled') === 'true') return { found: true, executable: false };
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  element.focus({ preventScroll: true });
  const before = JSON.stringify({
    className: element.className, expanded: element.getAttribute('aria-expanded'), pressed: element.getAttribute('aria-pressed'), selected: element.getAttribute('aria-selected'),
    body: documentValue.body.className, html: documentValue.documentElement.className,
    dialogs: documentValue.querySelectorAll('dialog[open],[role="dialog"]:not([hidden])').length,
    hidden: Array.from(documentValue.querySelectorAll('[hidden]')).length,
    status: Array.from(documentValue.querySelectorAll('[aria-live]')).map((item) => item.textContent?.trim()).filter(Boolean).slice(0, 12)
  });
  const rect = element.getBoundingClientRect();
  const frameRect = frameValue?.getBoundingClientRect() || { left: 0, top: 0 };
  return { found: true, executable: true, before, point: { x: frameRect.left + rect.left + rect.width / 2, y: frameRect.top + rect.top + rect.height / 2 }, active: documentValue.activeElement === element };
})()`;

const actionStateExpression = (action) => `(() => {
  const documentValue = ${action.context === 'shell'
    ? 'document'
    : `Array.from(document.querySelectorAll('iframe')).find((frame, index) => 'iframe-' + (frame.id || index + 1) === ${JSON.stringify(action.context)})?.contentDocument`};
  const element = documentValue?.querySelector('[data-h6-admin-action-id="${action.id}"]');
  if (!element) return null;
  return JSON.stringify({
    className: element.className, expanded: element.getAttribute('aria-expanded'), pressed: element.getAttribute('aria-pressed'), selected: element.getAttribute('aria-selected'),
    body: documentValue.body.className, html: documentValue.documentElement.className,
    dialogs: documentValue.querySelectorAll('dialog[open],[role="dialog"]:not([hidden])').length,
    hidden: Array.from(documentValue.querySelectorAll('[hidden]')).length,
    status: Array.from(documentValue.querySelectorAll('[aria-live]')).map((item) => item.textContent?.trim()).filter(Boolean).slice(0, 12)
  });
})()`;

const loginIfNeeded = async () => {
  const login = await browser.evaluate(`(() => ({
    username: Boolean(document.querySelector('input[name="username"],input[autocomplete="username"]')),
    password: Boolean(document.querySelector('input[type="password"]')),
    authenticatedShell: Boolean(document.querySelector('#veApp:not([hidden]),[data-visual-admin-root],[data-admin-app],[data-admin-shell]'))
  }))()`);
  if (!login.username || !login.password || login.authenticatedShell) return { attempted: false, reason: 'login-not-required-or-session-reused' };
  const username = process.env[options.usernameEnv] || '';
  const password = process.env[options.passwordEnv] || '';
  if (!username || !password) throw new Error(`Login is required. Provide synthetic credentials in ${options.usernameEnv} and ${options.passwordEnv}; values are never written to the report.`);
  await browser.evaluate(`(() => {
    const set = (element, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); };
    set(document.querySelector('input[name="username"],input[autocomplete="username"]'), ${JSON.stringify(username)});
    set(document.querySelector('input[type="password"]'), ${JSON.stringify(password)});
    document.querySelector('form button[type="submit"],form input[type="submit"]')?.click();
    return true;
  })()`);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await browser.evaluate(`Boolean(document.querySelector('#veApp:not([hidden]),[data-visual-admin-root],[data-admin-app],[data-admin-shell]'))`).catch(() => false)) {
      return { attempted: true, success: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return { attempted: true, success: false };
};

const homeCanvasSnapshotExpression = () => `(() => {
  const frame = document.querySelector('#veFrame');
  const documentValue = frame?.contentDocument;
  const locationValue = frame?.contentWindow?.location?.href || '';
  const locationUrl = locationValue ? new URL(locationValue) : null;
  const srcValue = frame?.src || '';
  const srcUrl = srcValue ? new URL(srcValue) : null;
  const siteBase = document.querySelector('[data-site-base]')?.dataset.siteBase || '/';
  const pathname = locationUrl?.pathname || '';
  const normalizedBase = siteBase === '/' ? '/' : ('/' + siteBase.replace(/^\\/+|\\/+$/gu, ''));
  const logicalRoute = normalizedBase !== '/' && (pathname === normalizedBase || pathname.startsWith(normalizedBase + '/'))
    ? pathname.slice(normalizedBase.length) || '/'
    : pathname;
  const sessionPattern = new RegExp(${JSON.stringify(ADMIN_EDITOR_SESSION_PATTERN_SOURCE)}, 'iu');
  const revisionPattern = new RegExp(${JSON.stringify(ADMIN_EDITOR_REVISION_PATTERN_SOURCE)}, 'u');
  return {
    ready: Boolean(documentValue?.body && documentValue.readyState !== 'loading'),
    srcOriginPath: srcUrl ? srcUrl.origin + srcUrl.pathname : '',
    locationOriginPath: locationUrl ? locationUrl.origin + locationUrl.pathname : '',
    queryKeys: locationUrl ? [...new Set(locationUrl.searchParams.keys())].sort() : [],
    siteBase,
    logicalRoute,
    editorMode: locationUrl?.searchParams.get('__smu1_editor') || '',
    editorSessionShape: sessionPattern.test(locationUrl?.searchParams.get('editorSession') || ''),
    editorRevisionShape: revisionPattern.test(locationUrl?.searchParams.get('editorRevision') || ''),
    h1: Array.from(documentValue?.querySelectorAll('h1') || []).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean),
    bindings: documentValue?.querySelectorAll('[data-smu1-binding]').length || 0,
    interactions: documentValue?.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[tabindex]').length || 0,
    overlays: document.querySelectorAll('#veOverlay [data-binding-id]').length || 0
  };
})()`;

const evaluateWithin = async (expression, timeoutMs) => {
  const timeoutMarker = Symbol('canvas-evaluation-timeout');
  let timer;
  const value = await Promise.race([
    browser.evaluate(expression).catch(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(timeoutMarker), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
  return value === timeoutMarker ? { timedOut: true, value: null } : { timedOut: false, value };
};

const waitForAdminHomeCanvas = async ({ timeoutMs = 20_000 } = {}) => {
  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  let canvas = null;
  let attempts = 0;
  let evaluationTimedOut = false;
  while (performance.now() < deadline) {
    attempts += 1;
    const remainingMs = Math.max(1, Math.ceil(deadline - performance.now()));
    const evaluation = await evaluateWithin(homeCanvasSnapshotExpression(), remainingMs);
    if (evaluation.timedOut) {
      evaluationTimedOut = true;
      break;
    }
    if (evaluation.value) canvas = evaluation.value;
    if (isAdminHomeCanvasReady(canvas)) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return {
    canvas,
    diagnostics: {
      attempts,
      elapsedMs: Math.round(performance.now() - startedAt),
      evaluationTimedOut
    }
  };
};

const restoreAdminHome = async () => {
  await browser.navigate(`${parsedOrigin.origin}/admin/`, { waitAfterMs: 100 });
  const login = await loginIfNeeded();
  if (login.attempted && !login.success) throw new Error('Synthetic admin login did not restore the editor shell.');
  const wait = await waitForAdminHomeCanvas();
  if (!isAdminHomeCanvasReady(wait.canvas)) {
    throw new Error(`Admin Home canvas did not recover after restoring action baseline: ${JSON.stringify({ ...wait.diagnostics, snapshot: wait.canvas })}`);
  }
  await browser.evaluate(inventoryExpression);
};

const clickShellSelector = async (selector) => {
  const point = await browser.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Navigation acceptance control is missing: ${selector}`);
  await browser.dispatchClick(point);
};

const waitForCanvasPath = async (expectedPath, { exact = false } = {}) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await browser.evaluate(`(() => {
      const frame = document.querySelector('#veFrame');
      const locationValue = frame?.contentWindow?.location?.href || '';
      const siteBase = document.querySelector('[data-site-base]')?.dataset.siteBase || '/';
      const normalizedBase = siteBase === '/' ? '/' : ('/' + siteBase.replace(/^\\/+|\\/+$/gu, ''));
      const pathname = locationValue ? new URL(locationValue).pathname : '';
      const logicalPathname = normalizedBase !== '/' && (pathname === normalizedBase || pathname.startsWith(normalizedBase + '/'))
        ? pathname.slice(normalizedBase.length) || '/'
        : pathname;
      const locationUrl = locationValue ? new URL(locationValue) : null;
      return {
        locationOriginPath: locationUrl ? locationUrl.origin + locationUrl.pathname : '',
        queryKeys: locationUrl ? [...new Set(locationUrl.searchParams.keys())].sort() : [],
        pathname,
        logicalPathname,
        h1: Array.from(frame?.contentDocument?.querySelectorAll('h1') || []).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean)
      };
    })()`).catch(() => null);
    if (result && (exact ? result.logicalPathname === expectedPath : result.logicalPathname === expectedPath) && result.h1.length === 1) return result;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Canvas did not open ${expectedPath}`);
};

const openPageBySearch = async ({ query, expectedPath, exactPath = false, mode, routeText = '' }) => {
  await clickShellSelector('#vePagePicker');
  const ready = await browser.evaluate(`Boolean(document.querySelector('#vePageDialog')?.open)`);
  if (!ready) throw new Error('Page picker did not open.');
  const result = await browser.evaluate(`(() => {
    const input = document.querySelector('#vePageDialogSearch');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(query)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const buttons = Array.from(document.querySelectorAll('#vePageDialogResults button'));
    const routeText = ${JSON.stringify(routeText)};
    const button = routeText
      ? buttons.find((candidate) => Array.from(candidate.querySelectorAll('small')).some((item) => {
          const text = item.textContent?.replace(/\\s+/gu, ' ').trim() || '';
          return text === routeText || text.endsWith('· ' + routeText);
        }))
      : buttons[0];
    if (!button) return null;
    button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    button.focus({ preventScroll: true });
    const rect = button.getBoundingClientRect();
    return { label: button.textContent?.replace(/\\s+/gu, ' ').trim() || '', point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
  })()`);
  if (!result) throw new Error(`Page picker found no result for ${query}`);
  if (mode === 'keyboard-enter') await browser.dispatchKey('Enter', { code: 'Enter' });
  else await browser.dispatchClick(result.point);
  return { query, expectedPath, mode, selectedLabel: result.label, canvas: await waitForCanvasPath(expectedPath, { exact: exactPath }) };
};

const runNavigationAcceptance = async (homePath) => {
  current.actionKey = 'navigation-acceptance';
  current.mode = 'search-click-keyboard';
  const eventIndex = events.length;
  const requestIndex = requests.length;
  try {
    const click = await openPageBySearch({ query: 'Контакты', expectedPath: '/kontakty/', mode: 'click' });
    const keyboard = await openPageBySearch({ query: 'Политика конфиденциальности', expectedPath: '/politika-konfidencialnosti/', mode: 'keyboard-enter' });
    const restoredHome = await openPageBySearch({ query: 'Главная', expectedPath: homePath, exactPath: true, mode: 'click' });
    const acceptanceEvents = events.slice(eventIndex);
    return {
      status: acceptanceEvents.length ? 'fail' : 'pass', click, keyboard, restoredHome,
      events: acceptanceEvents, requests: requests.slice(requestIndex)
    };
  } catch (error) {
    return { status: 'fail', error: String(error), events: events.slice(eventIndex), requests: requests.slice(requestIndex) };
  }
};

const ensureAdminActionExecutable = async (action) => {
  let prepared = await browser.evaluate(actionExpression(action));
  if (prepared?.executable) return { prepared, restored: false, opener: null };
  await restoreAdminHome();
  prepared = await browser.evaluate(actionExpression(action));
  if (prepared?.executable) return { prepared, restored: true, opener: null };
  const candidates = (await browser.evaluate(inventoryExpression)).filter((candidate) => {
    const policy = classifyAdminAction(candidate, { isolatedMutations: false });
    return `${candidate.context}:${candidate.id}` !== `${action.context}:${action.id}`
      && candidate.context === 'shell' && candidate.visible && !candidate.disabled && policy.policy === 'safe-ui-action';
  });
  for (const candidate of candidates) {
    const opener = await browser.evaluate(actionExpression(candidate));
    if (!opener?.executable) continue;
    await browser.dispatchClick(opener.point);
    await new Promise((resolve) => setTimeout(resolve, 45));
    await browser.evaluate(inventoryExpression);
    prepared = await browser.evaluate(actionExpression(action));
    if (prepared?.executable) return { prepared, restored: true, opener: { key: `${candidate.context}:${candidate.id}`, name: candidate.name } };
    await restoreAdminHome();
  }
  return { prepared, restored: true, opener: null };
};

const runCanvasRouteAudit = async () => {
  const results = [];
  let completed = 0;
  for (const descriptor of routeModel.routes) {
    if (verboseProgress) progress(`opening canvas route ${completed + 1}/${routeModel.routes.length}: ${descriptor.pathname}`);
    current.actionKey = `canvas-route:${descriptor.pathname}`;
    current.mode = 'navigator-click';
    const eventIndex = events.length;
    const requestIndex = requests.length;
    const expectedCanvasPath = descriptor.routeClass === 'alias' ? descriptor.canonicalTarget : descriptor.pathname;
    try {
      const navigation = await openPageBySearch({
        query: descriptor.pathname === '/' ? 'Главная' : descriptor.pathname,
        routeText: descriptor.pathname,
        expectedPath: expectedCanvasPath,
        exactPath: true,
        mode: 'click'
      });
      const deadline = Date.now() + 8_000;
      let snapshot = null;
      while (Date.now() < deadline) {
        snapshot = await browser.evaluate(`(() => {
          const frame = document.querySelector('#veFrame');
          const documentValue = frame?.contentDocument;
          const frameLocation = frame?.contentWindow?.location?.href || '';
          const frameRevision = frameLocation ? new URL(frameLocation).searchParams.get('editorRevision') || '' : '';
          const aliasCanvasRevision = document.querySelector('#veApp')?.dataset.aliasCanvasRevision || '';
          const overlayTargets = Array.from(document.querySelectorAll('.ve-overlay-target')).filter((item) => {
            const style = getComputedStyle(item); const rect = item.getBoundingClientRect();
            return !item.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
              && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
          });
          const describedTargets = overlayTargets.map((item) => {
            const bindingId = item.dataset.bindingId || '';
            const bindingElement = Array.from(documentValue?.querySelectorAll('[data-smu1-binding-id][data-smu1-binding]') || [])
              .find((candidate) => candidate.getAttribute('data-smu1-binding-id') === bindingId);
            let tool = '';
            try { tool = JSON.parse(bindingElement?.getAttribute('data-smu1-binding') || 'null')?.tool || ''; } catch {}
            return { item, tool };
          });
          return {
            h1: Array.from(documentValue?.querySelectorAll('h1') || []).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean),
            canvasHint: document.querySelector('#veCanvasHint')?.textContent?.replace(/\\s+/gu, ' ').trim() || '',
            aliasBridgeReady: document.querySelector('#veApp')?.dataset.aliasCanvasReady === 'true',
            aliasBridgeRevisionMatch: Boolean(frameRevision && aliasCanvasRevision === frameRevision),
            bindings: documentValue?.querySelectorAll('[data-smu1-binding]').length || 0,
            bindingIds: new Set(Array.from(documentValue?.querySelectorAll('[data-smu1-binding-id]') || []).map((item) => item.getAttribute('data-smu1-binding-id'))).size,
            interactions: documentValue?.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[tabindex]').length || 0,
            overlays: overlayTargets.length,
            overlayPoint: (() => {
              const editable = describedTargets.filter((candidate) => !['media', 'gallery'].includes(candidate.tool));
              const selected = editable.find((candidate) => candidate.item.dataset.priority === 'primary')
                || editable[0]
                || describedTargets.find((candidate) => candidate.item.dataset.priority === 'primary')
                || describedTargets[0];
              if (!selected) return null;
              const rect = selected.item.getBoundingClientRect();
              return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
                tool: selected.tool,
                bindingId: selected.item.dataset.bindingId || ''
              };
            })()
          };
        })()`).catch(() => null);
        if (snapshot?.h1?.length === 1 && (descriptor.routeClass === 'alias'
          ? snapshot.aliasBridgeReady && snapshot.aliasBridgeRevisionMatch
          : snapshot.bindings > 0 && snapshot.overlays > 0)) break;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      let contextual = { applicable: descriptor.routeClass !== 'alias', opened: false, controls: 0, escapeClosed: false };
      if (descriptor.routeClass !== 'alias' && snapshot?.overlayPoint) {
        for (let attempt = 0; attempt < 2 && !contextual.opened; attempt += 1) {
          const clickPoint = await browser.evaluate(`(() => {
            const bindingId = ${JSON.stringify(snapshot.overlayPoint.bindingId || '')};
            const item = Array.from(document.querySelectorAll('.ve-overlay-target'))
              .find((candidate) => candidate.dataset.bindingId === bindingId);
            if (!item) return null;
            const rect = item.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          })()`);
          if (!clickPoint) break;
          await browser.dispatchClick(clickPoint);
          const inspectorDeadline = Date.now() + 2_500;
          while (Date.now() < inspectorDeadline) {
            contextual = await browser.evaluate(`(() => {
              const inspector = document.querySelector('#veInspector');
              const inline = document.querySelector('#veInlineEditor');
              const media = document.querySelector('#veMediaDialog');
              const opened = Boolean((inspector && !inspector.hidden) || (inline && !inline.hidden) || media?.open);
              const owner = inspector && !inspector.hidden ? inspector : inline && !inline.hidden ? inline : media?.open ? media : null;
              return { applicable: true, opened, controls: owner?.querySelectorAll('button,input,select,textarea,[role="button"],[tabindex]').length || 0, escapeClosed: false };
            })()`);
            if (contextual.opened) break;
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
        }
        if (contextual.opened) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          await browser.dispatchKey('Escape', { code: 'Escape' });
          const closeDeadline = Date.now() + 2_000;
          while (Date.now() < closeDeadline) {
            contextual.escapeClosed = await browser.evaluate(`Boolean(
              document.querySelector('#veInspector')?.hidden
              && document.querySelector('#veInlineEditor')?.hidden
              && !document.querySelector('#veMediaDialog')?.open
            )`);
            if (contextual.escapeClosed) break;
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
        }
      }
      const routeEvents = events.slice(eventIndex);
      const routeRequests = requests.slice(requestIndex);
      const issues = [];
      if (navigation.canvas.logicalPathname !== expectedCanvasPath) issues.push(`canvas-route:${navigation.canvas.logicalPathname}`);
      if (snapshot?.h1?.length !== 1) issues.push(`h1-count:${snapshot?.h1?.length || 0}`);
      if (descriptor.routeClass !== 'alias' && (!snapshot?.bindings || !snapshot?.bindingIds || !snapshot?.overlays)) issues.push('binding-overlay-coverage');
      if (descriptor.routeClass !== 'alias' && (!contextual.opened || !contextual.controls || !contextual.escapeClosed)) issues.push('contextual-tool-or-escape');
      if (descriptor.routeClass === 'alias' && (!snapshot?.aliasBridgeReady || !snapshot?.aliasBridgeRevisionMatch
        || snapshot?.overlays !== 0 || !snapshot?.canvasHint?.includes(descriptor.canonicalTarget))) {
        issues.push('alias-read-only-provenance');
      }
      if (routeEvents.length) issues.push(`runtime-or-network:${routeEvents.length}`);
      if (routeRequests.some((request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method))) issues.push('unexpected-mutation-request');
      results.push({
        route: descriptor.pathname,
        routeClass: descriptor.routeClass,
        canonicalTarget: descriptor.canonicalTarget,
        expectedCanvasPath,
        navigation,
        snapshot,
        contextual,
        requests: routeRequests,
        events: routeEvents,
        issues,
        status: issues.length ? 'fail' : 'pass'
      });
      if (verboseProgress) progress(`canvas route ${descriptor.pathname}: ${issues.length
        ? `fail (${issues.join(', ')}; tool=${snapshot?.overlayPoint?.tool || 'none'}; contextual=${JSON.stringify(contextual)})`
        : 'pass'}`);
    } catch (error) {
      if (verboseProgress) progress(`canvas route ${descriptor.pathname}: exception (${String(error)})`);
      results.push({
        route: descriptor.pathname,
        routeClass: descriptor.routeClass,
        canonicalTarget: descriptor.canonicalTarget,
        expectedCanvasPath,
        error: String(error),
        requests: requests.slice(requestIndex),
        events: events.slice(eventIndex),
        issues: ['navigation-or-canvas-exception'],
        status: 'fail'
      });
      await restoreAdminHome().catch(() => {});
    }
    completed += 1;
    if (completed % 20 === 0 || completed === routeModel.routes.length) progress(`opened ${completed}/${routeModel.routes.length} admin canvas routes`);
  }
  await restoreAdminHome();
  return results;
};

try {
  await browser.setViewport({ width: 1440, height: 900, mobile: false });
  await browser.navigate(`${parsedOrigin.origin}/admin/`, { waitAfterMs: 100 });
  const login = await loginIfNeeded();
  if (login.attempted && !login.success) throw new Error('Synthetic admin login did not reach the editor shell.');
  const canvasWait = await waitForAdminHomeCanvas();
  const canvas = canvasWait.canvas;
  if (!isAdminHomeCanvasReady(canvas)) {
    const diagnostics = { ...canvasWait.diagnostics, snapshot: canvas };
    throw new Error(`Exact Home editor canvas did not become ready for admin action crawl: ${JSON.stringify(diagnostics)}`);
  }
  if (verboseProgress) progress(`Home canvas ready after ${canvasWait.diagnostics.attempts} probe(s)`);
  const navigationAcceptance = await runNavigationAcceptance('/');
  if (verboseProgress) progress(`navigation acceptance: ${navigationAcceptance.status}`);
  const canvasRouteResults = await runCanvasRouteAudit();
  const discovered = new Map();
  const actionResults = [];
  for (let wave = 0; wave < 3; wave += 1) {
    const inventory = await browser.evaluate(inventoryExpression);
    for (const action of inventory) {
      const key = `${action.context}:${action.id}`;
      discovered.set(key, { ...discovered.get(key), ...action });
      const previousIndex = actionResults.findIndex((result) => result.key === key);
      if (previousIndex >= 0) {
        const previous = actionResults[previousIndex];
        if (previous.policy === 'hidden-state' && action.visible) actionResults.splice(previousIndex, 1);
        else continue;
      }
      const policy = classifyAdminAction(action, { isolatedMutations: options.isolatedMutations });
      const result = { key, action, policy: policy.policy, executions: [], status: 'pass' };
      if (verboseProgress) progress(`action ${key}: ${policy.policy}`);
      if (policy.execute && action.visible && !action.disabled) {
        for (const operation of ['click', 'keyboard']) {
          if (operation === 'keyboard') await restoreAdminHome();
          current.actionKey = key;
          current.mode = operation;
          const eventIndex = events.length;
          const requestIndex = requests.length;
          const preparation = await ensureAdminActionExecutable(action);
          const execution = preparation.prepared || { found: false, executable: false };
          execution.preparation = { restored: preparation.restored, opener: preparation.opener };
          if (execution?.executable) {
            if (operation === 'click') await browser.dispatchClick(execution.point);
            else await browser.dispatchKey('Enter', { code: 'Enter' });
          }
          await new Promise((resolve) => setTimeout(resolve, 45));
          if (execution?.executable) {
            execution.after = await browser.evaluate(actionStateExpression(action));
            execution.observableChange = execution.before !== execution.after;
          }
          const executionEvents = events.slice(eventIndex);
          execution.events = executionEvents;
          execution.requests = requests.slice(requestIndex);
          execution.operation = operation;
          execution.unexpectedMutationRequests = policy.policy === 'safe-ui-action'
            ? execution.requests.filter((request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method))
            : [];
          const postcondition = Boolean(execution.observableChange || execution.requests.length);
          execution.postcondition = postcondition;
          execution.status = executionEvents.length || !execution?.found || !execution?.executable || !execution.active
            || (policy.policy === 'safe-ui-action' && (!postcondition || execution.unexpectedMutationRequests.length))
            || (policy.policy === 'isolated-mutation' && !postcondition)
            ? 'fail'
            : 'pass';
          result.executions.push(execution);
        }
        if (result.executions.some((execution) => execution.status === 'fail')) result.status = 'fail';
      } else {
        result.executionNote = policy.policy === 'release-intercept-required'
          ? 'Never executed by this harness; publish requires the isolated round-trip proxy and exact-validation evidence.'
          : policy.policy === 'requires-isolated-fixture'
            ? 'Mutation inventoried but not executed against the shared working tree.'
            : 'State inventoried; execution is not applicable in this state.';
      }
      actionResults.push(result);
    }
  }
  const policies = actionResults.reduce((counts, result) => {
    counts[result.policy] = (counts[result.policy] || 0) + 1;
    return counts;
  }, {});
  const rawBrowserSafety = browser.safetyEvidence();
  const browserSafety = {
    ...rawBrowserSafety,
    intercepted: rawBrowserSafety.intercepted.map((entry) => ({ ...entry, url: sanitizeObservedUrl(entry.url) }))
  };
  const releaseMutationAttempts = requests.filter((request) => {
    try {
      return !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && /\/api\/admin\/(?:publish|release|rollback|production)(?:\/|$)/iu.test(request.url?.pathname || '');
    } catch { return false; }
  });
  const navigatorRoutes = [...new Set(actionResults
    .filter((result) => result.action.context === 'shell')
    .map((result) => result.action.dataAttributes?.['data-route'])
    .filter(Boolean))];
  const navigatorReconciliation = reconcileRouteSets(routeModel.routes.map((route) => route.pathname), navigatorRoutes);
  const output = {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    evidence: {
      sourceSHA: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current') || '(detached)', dirty: Boolean(git('status', '--porcelain')),
      origin: parsedOrigin.origin, loopbackOnly: true, credentialsPersisted: false,
      isolatedMutations: options.isolatedMutations,
      isolationProof,
      releaseActionsExecuted: releaseMutationAttempts.length > 0,
      releaseMutationAttempts,
      browserSafety,
      login,
      canvas,
      navigationAcceptance
    },
    actionResults,
    canvasRouteResults,
    navigator: { ...navigatorReconciliation, expectedCount: routeModel.routes.length, discoveredCount: navigatorRoutes.length },
    events,
    aggregate: {
      actions: actionResults.length,
      canvasRoutesPassed: canvasRouteResults.filter((result) => result.status === 'pass').length,
      canvasRoutesFailed: canvasRouteResults.filter((result) => result.status === 'fail').length,
      passed: actionResults.filter((result) => result.status === 'pass').length,
      failed: actionResults.filter((result) => result.status === 'fail').length,
      executions: actionResults.reduce((count, result) => count + result.executions.length, 0),
      policies,
      discoveredContexts: [...new Set(actionResults.map((result) => result.action.context))]
    }
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  progress(`registered ${output.aggregate.actions} actions; report: ${path.relative(root, options.output)}`);
  if (options.json) process.stdout.write(`${JSON.stringify(output)}\n`);
  else process.stdout.write(`${JSON.stringify({ aggregate: output.aggregate, output: options.output }, null, 2)}\n`);
  if (!navigatorReconciliation.exact || output.aggregate.failed || output.aggregate.canvasRoutesFailed || navigationAcceptance.status !== 'pass') process.exitCode = 1;
} finally {
  await browser.close();
}

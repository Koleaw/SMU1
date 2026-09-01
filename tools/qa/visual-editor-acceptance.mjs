import crypto from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

import { CdpBrowser } from './cdp-browser.mjs';
import { createAdminRepoIdentity, createAdminUiHealthMarker } from '../admin-api/runtime-identity.mjs';

const RUNNER_PATH = fileURLToPath(import.meta.url);
const RELEASE_ENDPOINT = /\/api\/admin\/(?:publish|release|rollback|production)(?=\/|-|$)/iu;
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RASTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const DEFAULT_PROFILE = Object.freeze({
  product: {
    query: 'bolshaya-skameyka-amplituda',
    slug: 'bolshaya-skameyka-amplituda'
  },
  category: {
    query: 'lavochki-i-skameyki',
    slug: 'lavochki-i-skameyki',
    route: '/ulichnaya-mebel/lavochki-i-skameyki/'
  },
  noPhotoProduct: {
    query: 'konteynernaya-ploshchadka-modul',
    slug: 'konteynernaya-ploshchadka-modul'
  }
});

const SELECTORS = Object.freeze({
  app: '#veApp:not([hidden])',
  loginUsername: 'input[name="username"],input[autocomplete="username"]',
  loginPassword: 'input[type="password"]',
  loginSubmit: '#veLoginSubmit,form button[type="submit"],form input[type="submit"]',
  pagePicker: '#vePagePicker',
  pagePickerTitle: '#vePagePickerTitle',
  pageDialog: '#vePageDialog',
  pageSearch: '#vePageDialogSearch',
  pageResults: '#vePageDialogResults button',
  frame: '#veFrame',
  overlay: '#veOverlay',
  inlineEditor: '#veInlineEditor',
  inlineInput: '#veInlineInput',
  inspector: '#veInspector',
  inspectorForm: '#veInspectorForm',
  inspectorDone: '#veInspectorDone',
  undo: '#veUndo',
  save: '#veSave',
  status: '#veStatusLabel',
  pageSettings: '#vePageSettings',
  settingsDrawer: '#veSettingsDrawer',
  settingsHistory: '[data-settings-tab="history"]',
  conflictDialog: '#veConflictDialog',
  publish: '#vePublish',
  publishDrawer: '#vePublishDrawer',
  mediaDialog: '#veMediaDialog',
  mediaBody: '#veMediaBody',
  mediaRows: '#veMediaBody .ve-media-row',
  mediaNumbers: '#veMediaBody .ve-media-row__number',
  mediaConfirm: '#veMediaConfirm'
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const rounded = (value) => Math.round(Number(value) * 10) / 10;
const textValue = (value) => String(value || '').replace(/\s+/gu, ' ').trim();
const json = (value) => JSON.stringify(value);
const redactDiagnostic = (value) => String(value || '')
  .replace(/([?&](?:editorSession|csrf|token|secret|password)=)[^&#\s]+/giu, '$1<redacted>')
  .replace(/((?:csrfToken|sessionSecret|password|token|secret)\s*[:=]\s*["']?)[^"',\s}\]]+/giu, '$1<redacted>')
  .replace(/(bearer\s+)[A-Za-z0-9._~-]+/giu, '$1<redacted>')
  .slice(0, 700);

export function parseLoopbackOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new TypeError('A running local editor origin is required via --origin or H6_QA_ADMIN_ORIGIN.');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError(`Unsupported editor protocol: ${parsed.protocol}`);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase())) {
    throw new TypeError(`Visual-editor acceptance accepts only loopback origins, received ${parsed.hostname}.`);
  }
  if (parsed.username || parsed.password) throw new TypeError('Credentials must not be embedded in the editor URL.');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new TypeError('Editor origin must not contain a path, query, or fragment.');
  }
  return parsed.origin;
}

export function percentile95(samples) {
  const values = (Array.isArray(samples) ? samples : [])
    .map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!values.length) return null;
  return rounded(values[Math.max(0, Math.ceil(values.length * 0.95) - 1)]);
}

export function sanitizeRequestUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return {
      origin: parsed.origin,
      pathname: parsed.pathname.slice(0, 600),
      queryKeys: [...parsed.searchParams.keys()].sort()
    };
  } catch {
    return { origin: '', pathname: textValue(value).slice(0, 240), queryKeys: [] };
  }
}

export function isReleaseMutation(method, requestUrl) {
  const parsed = sanitizeRequestUrl(requestUrl);
  return STATE_CHANGING_METHODS.has(String(method || 'GET').toUpperCase())
    && RELEASE_ENDPOINT.test(parsed.pathname);
}

function isWithin(parent, candidate, { allowEqual = false } = {}) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (allowEqual && relative === '') || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function existingRegularFile(filename) {
  const info = await lstat(filename).catch(() => null);
  return Boolean(info?.isFile() && !info.isSymbolicLink());
}

async function readJsonFile(filename, label) {
  if (!(await existingRegularFile(filename))) throw new Error(`${label} must be a regular non-symlink file: ${filename}`);
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
}

async function findManifest(fixturesRoot) {
  for (const name of ['visual-editor-acceptance.json', 'acceptance.json', 'manifest.json']) {
    const candidate = path.join(fixturesRoot, name);
    if (await existingRegularFile(candidate)) return candidate;
  }
  return '';
}

function mergePageDescriptor(candidate, fallback) {
  const value = candidate && typeof candidate === 'object' ? candidate : {};
  return {
    query: String(value.query || value.slug || fallback.query),
    slug: String(value.slug || fallback.slug),
    route: value.route ? String(value.route) : String(fallback.route || '')
  };
}

async function safeFixtureFile(fixturesRoot, relativeName) {
  if (typeof relativeName !== 'string' || !relativeName.trim() || path.isAbsolute(relativeName)) {
    throw new Error(`Fixture media path must be a non-empty relative path: ${relativeName}`);
  }
  const candidate = path.resolve(fixturesRoot, relativeName);
  if (!isWithin(fixturesRoot, candidate)) throw new Error(`Fixture media escapes --fixtures: ${relativeName}`);
  const info = await lstat(candidate).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Fixture media must be a regular non-symlink file: ${relativeName}`);
  const resolved = await realpath(candidate);
  if (!isWithin(fixturesRoot, resolved)) throw new Error(`Fixture media resolves outside --fixtures: ${relativeName}`);
  return resolved;
}

async function walkRasterFiles(directory, fixturesRoot, depth = 0) {
  if (depth > 4) return [];
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) throw new Error(`Symlinks are forbidden in acceptance fixtures: ${candidate}`);
    if (info.isDirectory()) result.push(...await walkRasterFiles(candidate, fixturesRoot, depth + 1));
    else if (info.isFile() && RASTER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const resolved = await realpath(candidate);
      if (!isWithin(fixturesRoot, resolved)) throw new Error(`Fixture media resolves outside --fixtures: ${candidate}`);
      result.push(resolved);
    }
  }
  return result;
}

export async function inspectAcceptanceRasterFixture(filename) {
  const buffer = await readFile(filename);
  if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
    throw new Error(`Fixture image must be between 1 byte and 10 MiB: ${path.basename(filename)}`);
  }
  const extension = path.extname(filename).toLowerCase();
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if ((extension === '.png' && !png) || (extension !== '.png' && !jpeg)) {
    throw new Error(`Fixture extension/signature mismatch: ${path.basename(filename)}`);
  }
  let metadata;
  let decoded;
  try {
    metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000, sequentialRead: true }).metadata();
    decoded = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000, sequentialRead: true })
      .rotate().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new Error(`Fixture image did not pass full pinned-Sharp decode: ${path.basename(filename)}: ${error.message}`);
  }
  if (!['jpeg', 'png'].includes(metadata.format) || decoded.info.width < 1 || decoded.info.height < 1
    || decoded.info.width * decoded.info.height > 40_000_000 || decoded.data.length < decoded.info.width * decoded.info.height) {
    throw new Error(`Fixture image has invalid decoded dimensions or format: ${path.basename(filename)}`);
  }
  return {
    name: path.basename(filename),
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    format: metadata.format,
    width: decoded.info.width,
    height: decoded.info.height,
    pixels: decoded.info.width * decoded.info.height,
    fullDecode: true,
    decoder: `sharp-${sharp.versions?.sharp || 'pinned-project-version'}`
  };
}

async function resolveFixtureBundle({ fixtures, origin, cwd }) {
  if (!fixtures) throw new Error('--fixtures=<dir> is required. It must contain the disposable proof and 20 JPEG/PNG fixtures.');
  const fixturePath = path.resolve(cwd, fixtures);
  const fixtureInfo = await lstat(fixturePath).catch(() => null);
  if (!fixtureInfo?.isDirectory() || fixtureInfo.isSymbolicLink()) throw new Error('--fixtures must be a real, non-symlink directory.');
  const fixturesRoot = await realpath(fixturePath);
  const manifestPath = await findManifest(fixturesRoot);
  const manifest = manifestPath ? await readJsonFile(manifestPath, 'Acceptance fixture manifest') : {};
  if (manifestPath && manifest.schemaVersion !== 1) throw new Error('Acceptance fixture manifest schemaVersion must be 1.');

  const proofCandidates = [
    manifest.isolationProof
      ? path.resolve(fixturesRoot, String(manifest.isolationProof))
      : '',
    path.join(fixturesRoot, 'isolation-proof.json'),
    path.join(fixturesRoot, '.admin-runtime', 'h6-qa', 'isolation-proof.json'),
    path.join(cwd, '.admin-runtime', 'h6-qa', 'isolation-proof.json')
  ].filter(Boolean);
  let proofPath = '';
  for (const candidate of proofCandidates) {
    if (await existingRegularFile(candidate)) { proofPath = candidate; break; }
  }
  if (!proofPath) throw new Error('Disposable isolation-proof.json was not found in --fixtures or .admin-runtime/h6-qa.');
  const proof = await readJsonFile(proofPath, 'Disposable isolation proof');
  const cwdReal = await realpath(cwd);
  const proofRoot = proof?.disposableRoot ? await realpath(path.resolve(proof.disposableRoot)).catch(() => '') : '';
  const isolatedContentRoot = proof?.isolatedContentRoot
    ? await realpath(path.resolve(proof.isolatedContentRoot)).catch(() => '')
    : '';
  const proofOrigin = (() => { try { return parseLoopbackOrigin(proof?.origin); } catch { return ''; } })();
  const validProof = proof?.schemaVersion === 1
    && proofRoot === cwdReal
    && isolatedContentRoot && isWithin(proofRoot, isolatedContentRoot)
    && proofOrigin === origin
    && proof.publishIntercepted === true
    && proof.testFaultsEnabled === true
    && proof.deterministicExact === true
    && proof.sourceWritesDisposable === true
    && typeof proof.nonce === 'string' && proof.nonce.length >= 24;
  if (!validProof) throw new Error('Isolation proof does not bind this disposable checkout to the requested origin and intercepted publish boundary.');
  const repoIdentity = createAdminRepoIdentity(proofRoot);

  let mediaFiles;
  if (Array.isArray(manifest.mediaFiles) && manifest.mediaFiles.length) {
    mediaFiles = await Promise.all(manifest.mediaFiles.map((entry) => safeFixtureFile(fixturesRoot, entry)));
  } else mediaFiles = await walkRasterFiles(fixturesRoot, fixturesRoot);
  mediaFiles = [...new Set(mediaFiles)].sort((left, right) => left.localeCompare(right, 'en')).slice(0, 20);
  if (mediaFiles.length !== 20) throw new Error(`Acceptance requires 20 JPEG/PNG fixtures; discovered ${mediaFiles.length}.`);
  const mediaEvidence = [];
  for (const mediaFile of mediaFiles) mediaEvidence.push(await inspectAcceptanceRasterFixture(mediaFile));
  const failedMediaFile = manifest.failedMediaFile
    ? await safeFixtureFile(fixturesRoot, String(manifest.failedMediaFile))
    : '';
  if (failedMediaFile) {
    const failedBytes = await readFile(failedMediaFile);
    if (!/\.jpe?g$/iu.test(failedMediaFile) || failedBytes.length < 1 || failedBytes.length > 1024 * 1024) {
      throw new Error('failedMediaFile must be a small regular .jpg/.jpeg negative-test fixture.');
    }
  }

  const pages = manifest.pages || {};
  return {
    fixturesRoot,
    manifestPath: manifestPath || null,
    proofPath,
    proof: {
      schemaVersion: 1,
      disposableRoot: proofRoot,
      isolatedContentRoot,
      origin: proofOrigin,
      sourceSHA: typeof proof.sourceSHA === 'string' ? proof.sourceSHA : null,
      branch: typeof proof.branch === 'string' ? proof.branch : null,
      sourceWritesDisposable: true,
      publishIntercepted: true,
      testFaultsEnabled: true,
      deterministicExact: true,
      repoIdentity,
      nonceSHA256: crypto.createHash('sha256').update(proof.nonce).digest('hex')
    },
    profile: {
      product: mergePageDescriptor(pages.product, DEFAULT_PROFILE.product),
      category: mergePageDescriptor(pages.category, DEFAULT_PROFILE.category),
      noPhotoProduct: mergePageDescriptor(pages.noPhotoProduct, DEFAULT_PROFILE.noPhotoProduct),
      feedbackBudgetMs: Number.isFinite(Number(manifest.feedbackBudgetMs)) ? Number(manifest.feedbackBudgetMs) : 100,
      saveBudgetMs: Number.isFinite(Number(manifest.saveBudgetMs)) ? Number(manifest.saveBudgetMs) : 2000,
      exactObservationMs: Number.isFinite(Number(manifest.exactObservationMs)) ? Number(manifest.exactObservationMs) : 15_000
    },
    mediaFiles,
    mediaEvidence,
    failedMediaFile
  };
}

function requestMatchesAllowance(request, allowance) {
  if (request.status < 400) return true;
  if (request.method === 'GET' && request.url.pathname.endsWith('/api/admin/publish/status') && request.status === 403) {
    // H6 has no production release endpoint. The editor may probe the read-only
    // status during bootstrap, but every release mutation remains forbidden.
    return true;
  }
  return (allowance || []).some((item) => {
    const endpoint = String(item.pathname || '');
    const statuses = Array.isArray(item.statuses) ? item.statuses.map(Number) : [];
    return request.url.pathname.endsWith(endpoint) && (!statuses.length || statuses.includes(Number(request.status)));
  });
}

function isBenignBrowserCancellation(request) {
  return request?.failed === true
    && request.resourceType === 'Media'
    && request.status === 206
    && request.failure === 'net::ERR_ABORTED';
}

function requestMatchesNetworkAllowance(request, allowance) {
  return (allowance || []).some((item) => {
    const resourceTypes = Array.isArray(item.resourceTypes) ? item.resourceTypes.map(String) : [];
    const failures = Array.isArray(item.failures) ? item.failures.map(String) : [];
    const prefixes = Array.isArray(item.pathnamePrefixes) ? item.pathnamePrefixes.map(String) : [];
    return (!resourceTypes.length || resourceTypes.includes(String(request.resourceType || '')))
      && (!failures.length || failures.includes(String(request.failure || '')))
      && (!prefixes.length || prefixes.some((prefix) => request.url.pathname.startsWith(prefix)));
  });
}

async function atomicWriteJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filename);
}

async function waitFor(browser, expression, { timeoutMs = 20_000, intervalMs = 40, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await browser.evaluate(expression).catch(() => null);
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}.${last == null ? '' : ` Last result: ${JSON.stringify(last)}`}`);
}

async function clickShell(browser, selector) {
  const point = await browser.evaluate(`(() => {
    const element = document.querySelector(${json(selector)});
    if (!element || element.hidden || element.disabled) return null;
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Clickable shell control is unavailable: ${selector}`);
  await browser.dispatchClick(point);
  return point;
}

async function setControlValue(browser, selector, value, { event = 'input' } = {}) {
  return browser.evaluate(`(() => {
    const element = document.querySelector(${json(selector)});
    if (!element) return false;
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${json(String(value))});
    element.dispatchEvent(new Event(${json(event)}, { bubbles: true }));
    return true;
  })()`);
}

function canvasSnapshotExpression() {
  return `(() => {
    const frame = document.querySelector('#veFrame');
    const documentValue = frame?.contentDocument;
    const locationValue = frame?.contentWindow?.location?.href || '';
    const siteBase = document.querySelector('[data-site-base]')?.dataset.siteBase || '/';
    const pathname = locationValue ? new URL(locationValue).pathname : '';
    const normalizedBase = siteBase === '/' ? '/' : ('/' + siteBase.replace(/^\\/+|\\/+$/gu, ''));
    const logicalRoute = normalizedBase !== '/' && (pathname === normalizedBase || pathname.startsWith(normalizedBase + '/'))
      ? pathname.slice(normalizedBase.length) || '/'
      : pathname;
    return {
      ready: Boolean(documentValue?.body && documentValue.readyState !== 'loading'),
      logicalRoute,
      pickerTitle: document.querySelector('#vePagePickerTitle')?.textContent?.replace(/\\s+/gu, ' ').trim() || '',
      h1: Array.from(documentValue?.querySelectorAll('h1') || []).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean),
      bindings: documentValue?.querySelectorAll('[data-smu1-binding]')?.length || 0,
      overlays: document.querySelectorAll('#veOverlay [data-binding-id]')?.length || 0,
      editorMode: locationValue ? new URL(locationValue).searchParams.get('__smu1_editor') || '' : '',
      editorSessionShape: locationValue ? /^[0-9a-f-]{36}$/iu.test(new URL(locationValue).searchParams.get('editorSession') || '') : false,
      editorRevision: locationValue ? new URL(locationValue).searchParams.get('editorRevision') || '' : ''
    };
  })()`;
}

async function waitForCanvas(browser, expectedRoute = '') {
  return waitFor(browser, `(() => {
    const value = (${canvasSnapshotExpression()});
    return value.ready && value.h1.length === 1 && value.bindings > 0 && value.overlays > 0
      && (!${json(expectedRoute)} || value.logicalRoute === ${json(expectedRoute)}) ? value : null;
  })()`, { timeoutMs: 25_000, intervalMs: 80, label: expectedRoute ? `canvas ${expectedRoute}` : 'editor canvas' });
}

async function attestDisposableRuntime(browser, origin, proof) {
  const expectedMarker = createAdminUiHealthMarker(proof.repoIdentity);
  const ui = await browser.evaluate(`(() => ({
    origin: location.origin,
    pathname: location.pathname,
    metaMarker: document.querySelector('meta[name="smu1-admin-health"]')?.content || '',
    rootMarker: document.querySelector('#visualEditorRoot')?.dataset.repoIdentity || ''
  }))()`);
  if (ui.origin !== origin || ui.pathname !== '/admin/' || ui.metaMarker !== expectedMarker || ui.rootMarker !== expectedMarker) {
    throw new Error('Disposable UI attestation failed before credentials: final origin/path or repo identity does not match the proof root.');
  }
  let response;
  try {
    response = await fetch(`${origin}/api/admin/health`, {
      method: 'GET', cache: 'no-store', redirect: 'error', headers: { accept: 'application/json' }
    });
  } catch (error) {
    throw new Error(`Disposable API health attestation failed before credentials: ${error.message}`);
  }
  const health = await response.json().catch(() => null);
  if (response.url !== `${origin}/api/admin/health` || response.status !== 200
    || health?.kind !== 'smu1-admin-runtime' || health?.version !== 1 || health?.service !== 'api'
    || health?.repoIdentity !== proof.repoIdentity) {
    throw new Error('Disposable API health identity does not match the proof root; credentials and mutations were not attempted.');
  }
  return {
    verifiedBeforeCredentials: true,
    expectedRepoIdentity: proof.repoIdentity,
    finalOrigin: ui.origin,
    finalPathname: ui.pathname,
    uiMetaMarkerMatches: true,
    uiRootMarkerMatches: true,
    api: { status: response.status, url: response.url, kind: health.kind, version: health.version, service: health.service, repoIdentity: health.repoIdentity }
  };
}

async function loginIfNeeded(browser, options) {
  const initial = await waitFor(browser, `(() => {
    const app = document.querySelector('#veApp');
    const login = document.querySelector('#veLogin');
    if (app && !app.hidden) return { app: true, username: false, password: false };
    if (login && !login.hidden) return {
      app: false,
      username: Boolean(login.querySelector(${json(SELECTORS.loginUsername)})),
      password: Boolean(login.querySelector(${json(SELECTORS.loginPassword)}))
    };
    return null;
  })()`, { timeoutMs: 12_000, intervalMs: 50, label: 'authenticated app or visible login form' });
  if (initial.app) return { attempted: false, success: true, reason: 'session-reused' };
  if (!initial.username || !initial.password) throw new Error('The local editor exposed neither an authenticated app nor the expected login form.');
  const username = process.env[options.usernameEnv] || '';
  const password = process.env[options.passwordEnv] || '';
  if (!username || !password) {
    throw new Error(`Synthetic credentials are required in ${options.usernameEnv} and ${options.passwordEnv}. Values are never written to evidence.`);
  }
  await browser.evaluate(`(() => {
    const set = (selector, value) => {
      const element = document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(${json(SELECTORS.loginUsername)}, ${json(username)});
    set(${json(SELECTORS.loginPassword)}, ${json(password)});
    return true;
  })()`);
  await clickShell(browser, SELECTORS.loginSubmit);
  await waitFor(browser, `Boolean(document.querySelector('#veApp:not([hidden])'))`, { timeoutMs: 20_000, label: 'synthetic login' });
  return { attempted: true, success: true, reason: 'synthetic-credentials' };
}

async function testFaultControl(browser, payload) {
  return browser.evaluate(`(async () => {
    const meResponse = await fetch('/api/admin/me', { credentials: 'include', cache: 'no-store' });
    const me = await meResponse.json();
    const response = await fetch('/api/admin/__test__/faults', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Admin-CSRF': me.csrfToken || '' },
      body: ${json(JSON.stringify(payload))}
    });
    return { status: response.status, payload: await response.json().catch(() => null) };
  })()`);
}

async function openPeerEditor(browser, origin) {
  const opened = await browser.evaluate(`(() => {
    window.__h6AcceptancePeer?.close?.();
    window.__h6AcceptancePeer = window.open(${json(`${origin}/admin/`)}, 'h6-acceptance-peer');
    return Boolean(window.__h6AcceptancePeer);
  })()`);
  if (!opened) throw new Error('The second same-origin editor tab could not be opened.');
  return waitFor(browser, `(() => {
    const peer = window.__h6AcceptancePeer;
    if (!peer || peer.closed) return null;
    try {
      const app = peer.document.querySelector('#veApp');
      const picker = peer.document.querySelector('#vePagePicker');
      const frame = peer.document.querySelector('#veFrame');
      const canvasReady = frame?.contentDocument?.readyState === 'complete'
        && frame.contentDocument.querySelectorAll('[data-smu1-binding]').length > 0;
      return app && !app.hidden && picker && !picker.disabled && canvasReady
        ? { ready: true, title: peer.document.title, pathname: peer.location.pathname }
        : null;
    } catch { return null; }
  })()`, { timeoutMs: 20_000, intervalMs: 50, label: 'second authenticated editor tab' });
}

async function openPageInPeer(browser, descriptor) {
  const pickerOpened = await browser.evaluate(`(() => {
    const peer = window.__h6AcceptancePeer;
    const picker = peer?.document.querySelector('#vePagePicker');
    if (!picker || picker.disabled) return false;
    picker.dispatchEvent(new peer.MouseEvent('click', { bubbles: true, cancelable: true, view: peer }));
    return true;
  })()`);
  if (!pickerOpened) throw new Error('The second editor tab page picker is unavailable.');
  await waitFor(browser, `Boolean(window.__h6AcceptancePeer?.document.querySelector('#vePageDialog')?.open)`, { label: 'peer page picker' });
  await browser.evaluate(`(() => {
    const peer = window.__h6AcceptancePeer;
    const input = peer.document.querySelector('#vePageDialogSearch');
    Object.getOwnPropertyDescriptor(peer.HTMLInputElement.prototype, 'value').set.call(input, ${json(descriptor.query)});
    input.dispatchEvent(new peer.Event('input', { bubbles: true }));
    input.dispatchEvent(new peer.Event('change', { bubbles: true }));
    return true;
  })()`);
  const selected = await waitFor(browser, `(() => {
    const peer = window.__h6AcceptancePeer;
    const slug = ${json(descriptor.slug)};
    const rows = Array.from(peer?.document.querySelectorAll('#vePageDialogResults button') || []);
    const button = rows.find((row) => {
      const details = row.querySelector('span small')?.textContent?.replace(/\\s+/gu, ' ').trim() || '';
      const route = details.includes(' · ') ? details.slice(details.lastIndexOf(' · ') + 3) : '';
      return route.split('/').filter(Boolean).at(-1) === slug;
    });
    if (!button) return null;
    const details = button.querySelector('span small')?.textContent?.replace(/\\s+/gu, ' ').trim() || '';
    const route = details.includes(' · ') ? details.slice(details.lastIndexOf(' · ') + 3) : '';
    button.click();
    return { route, label: button.textContent?.replace(/\\s+/gu, ' ').trim() || '' };
  })()`, { timeoutMs: 10_000, intervalMs: 50, label: 'peer page result' });
  await waitFor(browser, `(() => {
    const peer = window.__h6AcceptancePeer;
    const frame = peer?.document.querySelector('#veFrame');
    try {
      return frame?.contentDocument?.readyState === 'complete'
        && new URL(frame.contentWindow.location.href).pathname === ${json(selected.route)};
    } catch { return false; }
  })()`, { timeoutMs: 20_000, intervalMs: 50, label: 'peer production canvas' });
  return selected;
}

async function editPeerProductTitle(browser, marker) {
  const binding = await waitFor(browser, `(() => {
    const peer = window.__h6AcceptancePeer;
    const frame = peer?.document.querySelector('#veFrame');
    const rows = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding-id][data-smu1-binding]') || []);
    for (const element of rows) {
      try {
        const value = JSON.parse(element.getAttribute('data-smu1-binding') || 'null');
        if ((value.ownerCollection || value.owner?.collection) === 'products' && value.fieldPath === 'title' && value.tool === 'heading') {
          element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          frame.contentWindow.dispatchEvent(new peer.Event('scroll'));
          return { bindingId: value.bindingId, original: element.textContent?.replace(/\\s+/gu, ' ').trim() || '' };
        }
      } catch {}
    }
    return null;
  })()`, { timeoutMs: 12_000, intervalMs: 50, label: 'peer title binding' });
  await waitFor(browser, `(() => {
    const peer = window.__h6AcceptancePeer;
    const button = peer?.document.querySelector('#veOverlay [data-binding-id="' + CSS.escape(${json(binding.bindingId)}) + '"][data-control-key="target"]');
    if (!button || button.hidden || button.disabled) return null;
    button.click();
    return true;
  })()`, { timeoutMs: 8_000, intervalMs: 50, label: 'peer title overlay' });
  const title = `${binding.original} · ${marker}`;
  await waitFor(browser, `(() => {
    const peer = window.__h6AcceptancePeer;
    const input = peer?.document.querySelector('#veInlineInput');
    if (!input || peer.document.querySelector('#veInlineEditor')?.hidden) return null;
    Object.getOwnPropertyDescriptor(peer.HTMLInputElement.prototype, 'value').set.call(input, ${json(title)});
    input.dispatchEvent(new peer.Event('input', { bubbles: true }));
    peer.document.querySelector('#veInlineEditor')?.requestSubmit();
    return true;
  })()`, { timeoutMs: 8_000, intervalMs: 50, label: 'peer title edit' });
  await waitFor(browser, `(() => {
    const peer = window.__h6AcceptancePeer;
    const frame = peer?.document.querySelector('#veFrame');
    const element = frame?.contentDocument?.querySelector('[data-smu1-binding-id="' + CSS.escape(${json(binding.bindingId)}) + '"]');
    return peer.document.querySelector('#veInlineEditor')?.hidden
      ? { projected: (element?.textContent || '').includes(${json(marker)}) }
      : null;
  })()`, { label: 'peer title editor commit' });
  const draft = await waitFor(browser, `(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('smu1-admin-h6', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('record-drafts')) { resolve(null); database.close(); return; }
      const transaction = database.transaction('record-drafts', 'readonly');
      const rows = transaction.objectStore('record-drafts').getAll();
      rows.onerror = () => reject(rows.error);
      rows.onsuccess = () => {
        const row = rows.result.find((item) => item.content?.title?.includes(${json(marker)}));
        resolve(row ? { key: row.key, title: row.content.title, baseRevision: row.baseRevision } : null);
        database.close();
      };
    };
  }))()`, { timeoutMs: 8_000, intervalMs: 50, label: 'peer title IndexedDB draft' });
  return { ...binding, title, draftPersisted: Boolean(draft), draft };
}

async function savePeerEditor(browser) {
  const before = await browser.evaluate(`(() => {
    const peer = window.__h6AcceptancePeer;
    const key = Object.keys(peer.localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
    return key ? peer.localStorage.getItem(key) : null;
  })()`);
  await browser.evaluate(`window.__h6AcceptancePeer.document.querySelector('#veSave')?.click()`);
  return waitFor(browser, `(() => {
    const peer = window.__h6AcceptancePeer;
    const key = Object.keys(peer.localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
    const value = key ? peer.localStorage.getItem(key) : null;
    return value && value !== ${json(before)} && peer.document.querySelector('#veSave')?.dataset.busy !== 'true'
      ? JSON.parse(value) : null;
  })()`, { timeoutMs: 30_000, intervalMs: 50, label: 'peer local Save' });
}

async function openPage(browser, descriptor) {
  await clickShell(browser, SELECTORS.pagePicker);
  await waitFor(browser, `Boolean(document.querySelector('#vePageDialog')?.open)`, { label: 'page picker' });
  await setControlValue(browser, SELECTORS.pageSearch, descriptor.query);
  const selected = await waitFor(browser, `(() => {
    const routeWanted = ${json(descriptor.route || '')};
    const slugWanted = ${json(descriptor.slug || '')};
    const rows = Array.from(document.querySelectorAll('#vePageDialogResults button')).map((button) => {
      const details = button.querySelector('span small')?.textContent?.replace(/\\s+/gu, ' ').trim() || '';
      const route = details.includes(' · ') ? details.slice(details.lastIndexOf(' · ') + 3) : '';
      const rect = button.getBoundingClientRect();
      return { button, route, label: button.textContent?.replace(/\\s+/gu, ' ').trim() || '', area: rect.width * rect.height,
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    }).filter((row) => row.area > 0);
    const exact = routeWanted ? rows.find((row) => row.route === routeWanted) : null;
    const slugMatches = slugWanted ? rows.filter((row) => row.route.split('/').filter(Boolean).at(-1) === slugWanted) : [];
    const row = exact || slugMatches.sort((left, right) => left.route.length - right.route.length)[0] || rows[0];
    return row ? { route: row.route, label: row.label, point: row.point } : null;
  })()`, { timeoutMs: 10_000, label: `page result ${descriptor.query}` });
  await browser.dispatchClick(selected.point);
  const canvas = await waitForCanvas(browser, selected.route);
  return { query: descriptor.query, slug: descriptor.slug, selectedRoute: selected.route, selectedLabel: selected.label, canvas };
}

async function ensurePage(browser, descriptor) {
  const current = await browser.evaluate(canvasSnapshotExpression()).catch(() => null);
  const currentSlug = String(current?.logicalRoute || '').split('/').filter(Boolean).at(-1) || '';
  const expected = descriptor.route || '';
  if (current?.ready && current.bindings > 0 && current.overlays > 0
    && ((expected && current.logicalRoute === expected) || (!expected && currentSlug === descriptor.slug))) {
    return {
      query: descriptor.query,
      slug: descriptor.slug,
      selectedRoute: current.logicalRoute,
      selectedLabel: current.pickerTitle,
      canvas: current,
      alreadyOpen: true
    };
  }
  return openPage(browser, descriptor);
}

async function findBinding(browser, filter) {
  return waitFor(browser, `(() => {
    const frame = document.querySelector('#veFrame');
    const rows = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding-id][data-smu1-binding]') || []).flatMap((element) => {
      try {
        const binding = JSON.parse(element.getAttribute('data-smu1-binding') || 'null');
        const rect = element.getBoundingClientRect();
        return [{ binding, rect, text: element.textContent?.replace(/\\s+/gu, ' ').trim() || '' }];
      } catch { return []; }
    }).filter((row) => row.binding
      && (!${json(filter.ownerCollection || '')} || (row.binding.ownerCollection || row.binding.owner?.collection) === ${json(filter.ownerCollection || '')})
      && (!${json(filter.fieldPath || '')} || row.binding.fieldPath === ${json(filter.fieldPath || '')})
      && (!${json(filter.tool || '')} || row.binding.tool === ${json(filter.tool || '')})
      && (!${json(filter.role || '')} || row.binding.role === ${json(filter.role || '')}));
    const unique = [...new Map(rows.map((row) => [row.binding.bindingId, row])).values()];
    const row = unique.find((candidate) => candidate.rect.width > 2 && candidate.rect.height > 2) || unique[0];
    return row ? { binding: row.binding, text: row.text } : null;
  })()`, { timeoutMs: 12_000, label: `binding ${filter.ownerCollection || '*'}:${filter.fieldPath || filter.tool}` });
}

async function clickBinding(browser, bindingId, controlKey = 'target') {
  await browser.evaluate(`(() => {
    const frame = document.querySelector('#veFrame');
    const selector = '[data-smu1-binding-id="' + CSS.escape(${json(bindingId)}) + '"]';
    const element = frame?.contentDocument?.querySelector(selector);
    element?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    frame?.contentWindow?.dispatchEvent(new Event('scroll'));
    return Boolean(element);
  })()`);
  const selector = `#veOverlay [data-binding-id="${bindingId.replace(/["\\]/gu, '\\$&')}"][data-control-key="${controlKey}"]`;
  const point = await waitFor(browser, `(() => {
    const element = document.querySelector(${json(selector)});
    if (!element || element.hidden || element.disabled) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : null;
  })()`, { timeoutMs: 8_000, intervalMs: 50, label: `overlay ${controlKey}` });
  await browser.dispatchClick(point);
  return point;
}

async function projectedBindingText(browser, bindingId) {
  return browser.evaluate(`(() => {
    const frame = document.querySelector('#veFrame');
    const element = frame?.contentDocument?.querySelector('[data-smu1-binding-id="' + CSS.escape(${json(bindingId)}) + '"]');
    return element?.textContent?.replace(/\\s+/gu, ' ').trim() || '';
  })()`);
}

async function waitForProjectedText(browser, bindingId, expected, label) {
  return waitFor(browser, `(() => {
    const frame = document.querySelector('#veFrame');
    const element = frame?.contentDocument?.querySelector('[data-smu1-binding-id="' + CSS.escape(${json(bindingId)}) + '"]');
    const text = element?.textContent?.replace(/\\s+/gu, ' ').trim() || '';
    return text.includes(${json(expected)}) ? text : null;
  })()`, { timeoutMs: 5_000, intervalMs: 10, label });
}

async function setInlineText(browser, value) {
  return browser.evaluate(`(() => {
    const input = document.querySelector('#veInlineInput');
    if (!input || document.querySelector('#veInlineEditor')?.hidden) return false;
    input.focus({ preventScroll: true });
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${json(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

function indexedRecordExpression(storeName, predicateSource, projectionSource = '(row) => row') {
  return `(() => new Promise((resolve, reject) => {
    const project = ${projectionSource};
    const predicate = ${predicateSource};
    const request = indexedDB.open('smu1-admin-h6', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(${json(storeName)})) { resolve(null); database.close(); return; }
      const transaction = database.transaction(${json(storeName)}, 'readonly');
      const rows = transaction.objectStore(${json(storeName)}).getAll();
      rows.onerror = () => reject(rows.error);
      rows.onsuccess = () => { const result = rows.result.find(predicate) || null; resolve(result ? project(result) : null); database.close(); };
    };
  }))()`;
}

export function acceptanceBrowserExpressionsForTest() {
  return [
    canvasSnapshotExpression(),
    indexedRecordExpression('record-drafts', '(row) => row.slug === "fixture"', '(row) => ({ key: row.key })')
  ];
}

async function waitForIndexedRecord(browser, storeName, predicateSource, label, projectionSource) {
  return waitFor(browser, indexedRecordExpression(storeName, predicateSource, projectionSource), { timeoutMs: 8_000, intervalMs: 100, label });
}

async function mediaQueueSnapshot(browser) {
  return browser.evaluate(`(() => ({
    open: Boolean(document.querySelector('#veMediaDialog')?.open),
    count: document.querySelectorAll('#veMediaBody .ve-media-row').length,
    rows: Array.from(document.querySelectorAll('#veMediaBody .ve-media-row')).map((row, index) => ({
      position: row.querySelector('.ve-media-row__number')?.textContent?.trim() || '',
      name: row.querySelector('.ve-media-row__copy strong')?.textContent?.trim() || '',
      details: row.querySelector('.ve-media-row__copy small')?.textContent?.replace(/\\s+/gu, ' ').trim() || '',
      status: row.dataset.status || '',
      altLabel: row.querySelector('input[aria-label^="Alt"]')?.getAttribute('aria-label') || '',
      index
    })),
    confirmLabel: document.querySelector('#veMediaConfirm')?.textContent?.replace(/\\s+/gu, ' ').trim() || '',
    confirmDisabled: Boolean(document.querySelector('#veMediaConfirm')?.disabled)
  }))()`);
}

function createTelemetry(browser, origin) {
  const requests = [];
  const requestById = new Map();
  const events = [];
  const dialogs = [];
  let currentScenario = 'bootstrap';
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  browser.on('Network.requestWillBeSent', (event) => {
    const method = String(event.request?.method || 'GET').toUpperCase();
    const rawUrl = String(event.request?.url || '');
    const safeUrl = sanitizeRequestUrl(rawUrl);
    const record = {
      requestId: String(event.requestId || ''), scenario: currentScenario, atMs: elapsed(), method,
      url: safeUrl, resourceType: event.type || '', status: null, mimeType: '', fromDiskCache: false,
      failed: false, finished: false, failure: '', releaseEndpoint: RELEASE_ENDPOINT.test(safeUrl.pathname),
      releaseMutation: isReleaseMutation(method, rawUrl)
    };
    requests.push(record);
    requestById.set(record.requestId, record);
  });
  browser.on('Network.responseReceived', (event) => {
    const record = requestById.get(String(event.requestId || ''));
    if (!record) return;
    record.status = Number(event.response?.status || 0);
    record.mimeType = String(event.response?.mimeType || '');
    record.fromDiskCache = event.response?.fromDiskCache === true;
    record.responseAtMs = elapsed();
  });
  browser.on('Network.loadingFailed', (event) => {
    const record = requestById.get(String(event.requestId || ''));
    if (record) {
      record.failed = true;
      record.failure = redactDiagnostic(event.errorText || event.blockedReason || 'loading failed');
      record.responseAtMs = elapsed();
    }
  });
  browser.on('Network.loadingFinished', (event) => {
    const record = requestById.get(String(event.requestId || ''));
    if (record) {
      record.finished = true;
      record.finishedAtMs = elapsed();
    }
  });
  browser.on('Runtime.exceptionThrown', (event) => {
    events.push({ scenario: currentScenario, atMs: elapsed(), kind: 'runtime-exception',
      text: redactDiagnostic(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'Runtime exception') });
  });
  browser.on('Runtime.consoleAPICalled', (event) => {
    if (!['error', 'assert'].includes(event.type)) return;
    const message = redactDiagnostic((event.args || []).map((argument) => String(argument.value ?? argument.description ?? '')).join(' '));
    events.push({ scenario: currentScenario, atMs: elapsed(), kind: `console-${event.type}`, text: message });
  });
  browser.on('Page.javascriptDialogOpening', (event) => {
    dialogs.push({ scenario: currentScenario, atMs: elapsed(), type: event.type, message: redactDiagnostic(event.message), accepted: true });
    browser.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });

  return {
    requests, events, dialogs,
    setScenario(value) { currentScenario = value; },
    slices(requestIndex, eventIndex, dialogIndex) {
      return { requests: requests.slice(requestIndex), errors: events.slice(eventIndex), dialogs: dialogs.slice(dialogIndex) };
    },
    indices() { return { requestIndex: requests.length, eventIndex: events.length, dialogIndex: dialogs.length }; },
    origin
  };
}

async function structuredValidationResponse(browser, request) {
  if (!request?.requestId || request.status === null) return null;
  try {
    const deadline = Date.now() + 3_000;
    while (!request.finished && !request.failed && Date.now() < deadline) await sleep(20);
    const response = await browser.send('Network.getResponseBody', { requestId: request.requestId });
    const body = response.base64Encoded
      ? Buffer.from(response.body || '', 'base64').toString('utf8')
      : String(response.body || '');
    const payload = JSON.parse(body);
    const rows = [...(Array.isArray(payload?.blockers) ? payload.blockers : []), ...(Array.isArray(payload?.validationIssues) ? payload.validationIssues : [])];
    return {
      status: request.status,
      state: String(payload?.state || ''),
      result: String(payload?.result || ''),
      canApply: payload?.canApply === true,
      blockers: rows.map((item) => ({
        code: String(item?.code || ''),
        collection: String(item?.collection || ''),
        slug: String(item?.slug || item?.recordSlug || ''),
        path: String(item?.path || item?.reference?.path || ''),
        message: redactDiagnostic(item?.userMessage || item?.message || '')
      }))
    };
  } catch (error) {
    return { status: request.status, responseUnavailable: true, error: redactDiagnostic(error.message) };
  }
}

async function runAcceptance(options, bundle) {
  const browser = new CdpBrowser({ headful: options.headful, safetyMode: 'admin-no-release' });
  await browser.start();
  const telemetry = createTelemetry(browser, options.origin);
  const scenarios = [];
  const state = { productNavigation: null, productTitle: null, productDescription: null, noPhotoNavigation: null, queueOrder: null };

  async function scenario(id, title, callback) {
    telemetry.setScenario(id);
    const indices = telemetry.indices();
    const started = performance.now();
    const latencySamples = [];
    let returned = {};
    let thrown = null;
    try {
      returned = await callback({
        latency(label, milliseconds) { latencySamples.push({ label, milliseconds: rounded(milliseconds) }); }
      }) || {};
    } catch (error) { thrown = error; }
    finally {
      if (id === 'two-tab-conflict') {
        await browser.evaluate(`(() => { window.__h6AcceptancePeer?.close?.(); window.__h6AcceptancePeer = null; return true; })()`).catch(() => {});
      }
    }
    const slices = telemetry.slices(indices.requestIndex, indices.eventIndex, indices.dialogIndex);
    const issues = [...(returned.issues || [])];
    if (thrown) issues.push(`exception:${String(thrown.message || thrown)}`);
    const allowedRuntimeErrors = slices.errors.filter((entry) => (returned.allowedRuntimeErrors || [])
      .some((fragment) => entry.text.includes(String(fragment))));
    const unexpectedRuntimeErrors = slices.errors.filter((entry) => !allowedRuntimeErrors.includes(entry));
    if (unexpectedRuntimeErrors.length) issues.push(`runtime-errors:${unexpectedRuntimeErrors.length}`);
    const unexpectedHttp = slices.requests.filter((request) => request.status >= 400 && !requestMatchesAllowance(request, returned.allowedHttpFailures));
    const unexpectedNetwork = slices.requests.filter((request) => request.failed && !isBenignBrowserCancellation(request)
      && !requestMatchesNetworkAllowance(request, returned.allowedNetworkFailures)
      && !browser.safetyEvidence().intercepted.some((entry) => sanitizeRequestUrl(entry.url).pathname === request.url.pathname));
    if (unexpectedHttp.length) issues.push(`http-errors:${unexpectedHttp.length}`);
    if (unexpectedNetwork.length) issues.push(`network-errors:${unexpectedNetwork.length}`);
    const releaseMutations = slices.requests.filter((request) => request.releaseMutation);
    if (releaseMutations.length) issues.push(`release-mutations:${releaseMutations.length}`);
    const durationMs = rounded(performance.now() - started);
    scenarios.push({
      id, title, status: issues.length ? 'fail' : 'pass', durationMs,
      latency: {
        samples: latencySamples,
        p95Ms: percentile95(latencySamples.length ? latencySamples.map((entry) => entry.milliseconds) : [durationMs]),
        basis: latencySamples.length ? 'interaction-samples' : 'scenario-duration-fallback'
      },
      evidence: returned.evidence || null,
      limitations: returned.limitations || [],
      allowedHttpFailures: returned.allowedHttpFailures || [],
      allowedNetworkFailures: returned.allowedNetworkFailures || [],
      allowedRuntimeErrors: returned.allowedRuntimeErrors || [],
      issues,
      requests: slices.requests,
      errors: unexpectedRuntimeErrors,
      allowedErrors: allowedRuntimeErrors,
      dialogs: slices.dialogs
    });
    return { returned, thrown, issues };
  }

  try {
    await browser.setViewport({ width: 1440, height: 900, mobile: false });
    await browser.navigate(`${options.origin}/admin/`, { waitAfterMs: 100 });
    const runtimeAttestation = await attestDisposableRuntime(browser, options.origin, bundle.proof);
    const login = await loginIfNeeded(browser, options);
    await waitForCanvas(browser, '/');
    await sleep(350);

    await scenario('home-default', 'Home is the default exact production canvas', async () => {
      const canvas = await waitForCanvas(browser, '/');
      const issues = [];
      if (canvas.logicalRoute !== '/') issues.push(`route:${canvas.logicalRoute}`);
      if (canvas.pickerTitle !== 'Главная') issues.push(`picker-title:${canvas.pickerTitle}`);
      if (canvas.editorMode !== '1' || !canvas.editorSessionShape || !/^\d+$/u.test(canvas.editorRevision)) issues.push('editor-session-contract');
      if (canvas.h1.length !== 1 || !canvas.bindings || !canvas.overlays) issues.push('production-canvas-or-bindings');
      return { issues, evidence: { runtimeAttestation, login, canvas } };
    });

    // Run resilience and recovery acceptance before ordinary editing/media
    // scenarios mutate the disposable corpus. This keeps every failure proof
    // independent from the bulk uploader while still using the real UI/API.
    await runRequiredResilienceScenarios();

    if (!options.requiredResilienceOnly) {

    await scenario('product-h1-live-edit', 'Product H1 live projection, Escape, and commit', async ({ latency }) => {
      const navigation = await openPage(browser, bundle.profile.product);
      state.productNavigation = navigation;
      const titleBinding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'title', tool: 'heading' });
      const original = await projectedBindingText(browser, titleBinding.binding.bindingId);
      await clickBinding(browser, titleBinding.binding.bindingId);
      await waitFor(browser, `Boolean(!document.querySelector('#veInlineEditor')?.hidden && document.querySelector('#veInlineInput'))`, { label: 'H1 inline editor' });
      const feedback = [];
      for (let index = 1; index <= 5; index += 1) {
        const marker = `H6-live-${index}`;
        const value = `${original} · ${marker}`;
        const started = performance.now();
        if (!(await setInlineText(browser, value))) throw new Error('H1 inline input rejected the gesture.');
        await waitForProjectedText(browser, titleBinding.binding.bindingId, marker, `H1 projection ${index}`);
        const elapsed = performance.now() - started;
        latency(`h1-live-${index}`, elapsed);
        feedback.push(rounded(elapsed));
      }
      await browser.dispatchKey('Escape', { code: 'Escape' });
      const escaped = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const element = frame?.contentDocument?.querySelector('[data-smu1-binding-id="' + CSS.escape(${json(titleBinding.binding.bindingId)}) + '"]');
        return document.querySelector('#veInlineEditor')?.hidden && (element?.textContent?.replace(/\\s+/gu, ' ').trim() || '') === ${json(original)};
      })()`, { label: 'H1 Escape rollback' });

      await clickBinding(browser, titleBinding.binding.bindingId);
      await waitFor(browser, `Boolean(!document.querySelector('#veInlineEditor')?.hidden)`, { label: 'H1 commit editor' });
      const committed = `${original} · H6 acceptance ${crypto.randomBytes(3).toString('hex')}`;
      const commitStarted = performance.now();
      await setInlineText(browser, committed);
      await waitForProjectedText(browser, titleBinding.binding.bindingId, committed, 'committed H1 projection');
      latency('h1-commit-projection', performance.now() - commitStarted);
      await browser.dispatchKey('Enter', { code: 'Enter' });
      await waitFor(browser, `Boolean(document.querySelector('#veInlineEditor')?.hidden)`, { label: 'H1 commit close' });
      const projected = await projectedBindingText(browser, titleBinding.binding.bindingId);
      state.productTitle = { original, committed, bindingId: titleBinding.binding.bindingId };
      const p95 = percentile95(feedback);
      return {
        issues: [
          ...(!escaped ? ['escape-did-not-rollback'] : []),
          ...(projected !== committed ? ['commit-not-projected'] : []),
          ...(p95 !== null && p95 > bundle.profile.feedbackBudgetMs ? [`feedback-p95:${p95}`] : [])
        ],
        evidence: { navigation, binding: titleBinding.binding, original, committed, projected, escapeRestored: Boolean(escaped), feedbackP95Ms: p95,
          budgetMs: bundle.profile.feedbackBudgetMs }
      };
    });

    await scenario('product-long-text-contextual', 'Long product text opens and updates in the contextual inspector', async ({ latency }) => {
      const binding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'description', tool: 'long-text' });
      await clickBinding(browser, binding.binding.bindingId);
      const inspector = await waitFor(browser, `(() => {
        const panel = document.querySelector('#veInspector');
        const textarea = panel?.querySelector('#veInspectorForm textarea');
        return panel && !panel.hidden && textarea ? { value: textarea.value, title: document.querySelector('#veInspectorTitle')?.textContent?.trim() || '' } : null;
      })()`, { label: 'long-text inspector' });
      const marker = `H6-context-${crypto.randomBytes(3).toString('hex')}`;
      const next = `${inspector.value}\n\n${marker}`;
      const started = performance.now();
      const changed = await browser.evaluate(`(() => {
        const textarea = document.querySelector('#veInspectorForm textarea');
        if (!textarea) return false;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, ${json(next)});
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      if (!changed) throw new Error('Contextual textarea was not editable.');
      const projected = await waitForProjectedText(browser, binding.binding.bindingId, marker, 'long-text live projection');
      const elapsed = performance.now() - started;
      latency('long-text-live-projection', elapsed);
      await clickShell(browser, SELECTORS.inspectorDone);
      const closed = await waitFor(browser, `Boolean(document.querySelector('#veInspector')?.hidden)`, { label: 'contextual inspector close' });
      state.productDescription = { marker, bindingId: binding.binding.bindingId };
      return {
        issues: [
          ...(!closed ? ['inspector-did-not-close'] : []),
          ...(!projected.includes(marker) ? ['long-text-not-projected'] : []),
          ...(elapsed > bundle.profile.feedbackBudgetMs ? [`feedback:${rounded(elapsed)}`] : [])
        ],
        evidence: { binding: binding.binding, inspectorTitle: inspector.title, marker, projectedContainsMarker: projected.includes(marker),
          feedbackMs: rounded(elapsed), budgetMs: bundle.profile.feedbackBudgetMs }
      };
    });

    await scenario('typed-price-validation', 'Typed price keeps an invalid draft but blocks the save transaction', async () => {
      const binding = await findBinding(browser, { ownerCollection: 'products', tool: 'price' });
      await clickBinding(browser, binding.binding.bindingId);
      const original = await waitFor(browser, `(() => {
        const fieldset = document.querySelector('#veInspectorForm .ve-price-grid');
        const selects = fieldset?.querySelectorAll('select');
        const input = fieldset?.querySelector('input[type="number"]');
        return fieldset && selects?.length && input ? { mode: selects[0].value, amount: input.value, currency: selects[1]?.value || '' } : null;
      })()`, { label: 'typed price inspector' });
      await browser.evaluate(`(() => {
        const fieldset = document.querySelector('#veInspectorForm .ve-price-grid');
        const mode = fieldset.querySelector('select');
        const amount = fieldset.querySelector('input[type="number"]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(mode, 'exact');
        mode.dispatchEvent(new Event('change', { bubbles: true }));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(amount, '-1');
        amount.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      const invalid = await browser.evaluate(`(() => {
        const input = document.querySelector('#veInspectorForm .ve-price-grid input[type="number"]');
        return { value: input.value, valid: input.checkValidity(), rangeUnderflow: input.validity.rangeUnderflow, min: input.min };
      })()`);
      const invalidDraft = await waitForIndexedRecord(
        browser,
        'record-drafts',
        `(row) => row.slug === ${json(bundle.profile.product.slug)} && row.content?.priceMode === 'exact' && row.content?.priceFrom === -1`,
        'price-specific invalid draft checkpoint',
        '(row) => ({ key: row.key, slug: row.slug, baseRevision: row.baseRevision, priceMode: row.content.priceMode, priceFrom: row.content.priceFrom })'
      );
      const beforeRequestCount = telemetry.requests.length;
      await clickShell(browser, SELECTORS.save);
      const previewRequest = await (async () => {
        const deadline = Date.now() + 12_000;
        while (Date.now() < deadline) {
          const request = telemetry.requests.slice(beforeRequestCount).find((entry) => entry.url.pathname.endsWith('/transactions/preview'));
          if (request && (request.status !== null || request.failed)) return request;
          await sleep(50);
        }
        return null;
      })();
      await waitFor(browser, `document.querySelector('#veSave')?.dataset.busy !== 'true'`, { timeoutMs: 15_000, label: 'invalid save response' });
      const attempted = telemetry.requests.slice(beforeRequestCount);
      const applyRequest = attempted.find((entry) => entry.url.pathname.endsWith('/transactions/apply')) || null;
      const validationResponse = await structuredValidationResponse(browser, previewRequest);
      const priceBlockers = (validationResponse?.blockers || []).filter((entry) => entry.path === 'priceFrom' || entry.path.endsWith('.priceFrom'));
      const ui = await browser.evaluate(`(() => ({
        dirty: !document.querySelector('#veSave')?.disabled,
        status: document.querySelector('#veStatusLabel')?.textContent?.replace(/\\s+/gu, ' ').trim() || '',
        toasts: Array.from(document.querySelectorAll('#veToastRegion .ve-toast')).map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()).filter(Boolean)
      }))()`);
      await browser.evaluate(`(() => {
        const fieldset = document.querySelector('#veInspectorForm .ve-price-grid');
        const mode = fieldset.querySelector('select');
        const amount = fieldset.querySelector('input[type="number"]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(mode, ${json(original.mode)});
        mode.dispatchEvent(new Event('change', { bubbles: true }));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(amount, ${json(original.amount)});
        amount.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await clickShell(browser, SELECTORS.inspectorDone);
      return {
        issues: [
          ...(!invalid.rangeUnderflow || invalid.valid ? ['native-typed-validation-missing'] : []),
          ...(!invalidDraft ? ['price-invalid-draft-not-checkpointed'] : []),
          ...(!previewRequest ? ['validation-preview-not-requested'] : []),
          ...(!priceBlockers.length ? ['price-specific-validation-blocker-missing'] : []),
          ...(applyRequest ? ['invalid-price-was-applied'] : []),
          ...(!ui.dirty ? ['browser-draft-was-lost'] : [])
        ],
        allowedHttpFailures: [{ pathname: '/transactions/preview', statuses: [400, 409, 422] }],
        evidence: { binding: binding.binding, original, invalid, invalidDraft, previewRequest, validationResponse, priceBlockers, applyRequest, ui, restored: true }
      };
    });

    await scenario('category-reorder', 'Category item moves by drag, button and keyboard and Undo restores order', async ({ latency }) => {
      const navigation = await openPage(browser, bundle.profile.category);
      const before = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const values = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding]') || []).flatMap((element) => {
          try { const binding = JSON.parse(element.getAttribute('data-smu1-binding') || 'null'); return binding?.tool === 'reorder-item' ? [String(binding.stableItemId || binding.recordSlug || '')] : []; }
          catch { return []; }
        });
        const unique = [...new Set(values)]; return unique.length >= 2 ? unique : null;
      })()`, { label: 'category reorder bindings' });
      const firstBinding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'order', tool: 'reorder-item' });

      const dragStarted = performance.now();
      const dragGesture = await browser.evaluate(`(() => {
        const source = Array.from(document.querySelectorAll('.ve-reorder-handle[data-binding-id]'))
          .find((element) => element.dataset.bindingId === ${json(firstBinding.binding.bindingId)});
        const targets = Array.from(document.querySelectorAll('.ve-overlay-target[data-binding-id]'))
          .filter((element) => element.dataset.bindingId !== ${json(firstBinding.binding.bindingId)});
        const target = targets.find((element) => {
          try {
            const frame = document.querySelector('#veFrame');
            const bound = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding]') || [])
              .map((item) => { try { return JSON.parse(item.getAttribute('data-smu1-binding') || 'null'); } catch { return null; } })
              .find((binding) => binding?.bindingId === element.dataset.bindingId);
            return bound?.tool === 'reorder-item';
          } catch { return false; }
        });
        if (!source || !target) return { dispatched: false, indicator: false };
        const transfer = new DataTransfer();
        const event = (type, node) => node.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: node.getBoundingClientRect().left + 8,
          clientY: node.getBoundingClientRect().top + 8
        }));
        event('dragstart', source);
        event('dragover', target);
        const indicator = target.dataset.drop === 'true';
        event('drop', target);
        event('dragend', source);
        return { dispatched: true, indicator, targetBindingId: target.dataset.bindingId };
      })()`);
      const dragOrder = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const values = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding]') || []).flatMap((element) => {
          try { const binding = JSON.parse(element.getAttribute('data-smu1-binding') || 'null'); return binding?.tool === 'reorder-item' ? [String(binding.stableItemId || binding.recordSlug || '')] : []; }
          catch { return []; }
        });
        const unique = [...new Set(values)]; return unique[0] === ${json(before[1])} && unique[1] === ${json(before[0])} ? unique : null;
      })()`, { label: 'drag reorder projection' });
      latency('drag-reorder-feedback', performance.now() - dragStarted);
      await clickShell(browser, SELECTORS.undo);
      const dragUndo = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const values = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding]') || []).flatMap((element) => {
          try { const binding = JSON.parse(element.getAttribute('data-smu1-binding') || 'null'); return binding?.tool === 'reorder-item' ? [String(binding.stableItemId || binding.recordSlug || '')] : []; }
          catch { return []; }
        });
        const unique = [...new Set(values)]; return JSON.stringify(unique) === ${json(JSON.stringify(before))} ? unique : null;
      })()`, { label: 'drag reorder Undo' });

      const buttonStarted = performance.now();
      await clickBinding(browser, firstBinding.binding.bindingId, 'move-ArrowDown');
      const buttonOrder = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const values = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding]') || []).flatMap((element) => {
          try { const binding = JSON.parse(element.getAttribute('data-smu1-binding') || 'null'); return binding?.tool === 'reorder-item' ? [String(binding.stableItemId || binding.recordSlug || '')] : []; }
          catch { return []; }
        });
        const unique = [...new Set(values)]; return unique[0] === ${json(before[1])} && unique[1] === ${json(before[0])} ? unique : null;
      })()`, { label: 'button reorder projection' });
      latency('button-reorder-feedback', performance.now() - buttonStarted);
      await clickShell(browser, SELECTORS.undo);
      const buttonUndo = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const values = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding]') || []).flatMap((element) => {
          try { const binding = JSON.parse(element.getAttribute('data-smu1-binding') || 'null'); return binding?.tool === 'reorder-item' ? [String(binding.stableItemId || binding.recordSlug || '')] : []; }
          catch { return []; }
        });
        const unique = [...new Set(values)]; return JSON.stringify(unique) === ${json(JSON.stringify(before))} ? unique : null;
      })()`, { label: 'button reorder Undo' });

      await clickBinding(browser, firstBinding.binding.bindingId, 'handle');
      const keyboardStarted = performance.now();
      await browser.dispatchKey('ArrowDown', { code: 'ArrowDown', modifiers: 1 });
      const keyboardOrder = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const values = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding]') || []).flatMap((element) => {
          try { const binding = JSON.parse(element.getAttribute('data-smu1-binding') || 'null'); return binding?.tool === 'reorder-item' ? [String(binding.stableItemId || binding.recordSlug || '')] : []; }
          catch { return []; }
        });
        const unique = [...new Set(values)]; return unique[0] === ${json(before[1])} && unique[1] === ${json(before[0])} ? unique : null;
      })()`, { label: 'keyboard reorder projection' });
      latency('keyboard-reorder-feedback', performance.now() - keyboardStarted);
      await clickShell(browser, SELECTORS.undo);
      const keyboardUndo = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const values = Array.from(frame?.contentDocument?.querySelectorAll('[data-smu1-binding]') || []).flatMap((element) => {
          try { const binding = JSON.parse(element.getAttribute('data-smu1-binding') || 'null'); return binding?.tool === 'reorder-item' ? [String(binding.stableItemId || binding.recordSlug || '')] : []; }
          catch { return []; }
        });
        const unique = [...new Set(values)]; return JSON.stringify(unique) === ${json(JSON.stringify(before))} ? unique : null;
      })()`, { label: 'keyboard reorder Undo' });
      return {
        issues: [
          ...(!dragGesture?.dispatched ? ['drag-gesture-not-dispatched'] : []),
          ...(!dragGesture?.indicator ? ['drag-drop-indicator-not-visible'] : [])
        ],
        evidence: {
          navigation,
          binding: firstBinding.binding,
          before,
          dragGesture,
          dragOrder,
          dragUndo,
          buttonOrder,
          buttonUndo,
          keyboardOrder,
          keyboardUndo
        }
      };
    });

    await scenario('no-photo-affordance', 'A product without media exposes the real editor-only add-photo affordance', async () => {
      const navigation = await openPage(browser, bundle.profile.noPhotoProduct);
      state.noPhotoNavigation = navigation;
      const evidence = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const affordance = frame?.contentDocument?.querySelector('[data-smu1-editor-affordance="missing-product-media"]');
        const bindingElement = affordance?.closest('[data-smu1-binding]') || frame?.contentDocument?.querySelector('[data-smu1-binding*="missing-product-media"]');
        if (!affordance || !bindingElement) return null;
        try {
          const binding = JSON.parse(bindingElement.getAttribute('data-smu1-binding') || 'null');
          return { text: affordance.textContent?.replace(/\\s+/gu, ' ').trim() || '', binding };
        } catch { return null; }
      })()`, { label: 'missing-product-media affordance' });
      const issues = [];
      if (evidence.text !== 'Добавить фотографии') issues.push(`affordance-label:${evidence.text}`);
      if (!['media', 'gallery'].includes(evidence.binding?.tool) || evidence.binding?.role !== 'missing-product-media') issues.push('affordance-binding');
      return { issues, evidence: { navigation, ...evidence } };
    });

    await scenario('bulk-media-queue', 'Twenty raster files form a numbered, reorderable recovery queue', async ({ latency }) => {
      const binding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'gallery', tool: 'gallery', role: 'missing-product-media' });
      await clickBinding(browser, binding.binding.bindingId);
      await waitFor(browser, `Boolean(document.querySelector('#veMediaDialog')?.open && document.querySelector('#veMediaBody input[type="file"]'))`, { label: 'bulk media dialog' });
      const documentNode = await browser.send('DOM.getDocument', { depth: -1, pierce: true });
      const inputNode = await browser.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#veMediaBody input[type="file"]' });
      if (!inputNode.nodeId) throw new Error('Bulk media file input has no CDP node.');
      const started = performance.now();
      await browser.send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: bundle.mediaFiles });
      let queue;
      try {
        queue = await waitFor(browser, `(() => {
          const rows = document.querySelectorAll('#veMediaBody .ve-media-row');
          return rows.length === 20 ? true : null;
        })()`, { timeoutMs: 30_000, intervalMs: 100, label: '20-file media queue' });
      } catch {
        await browser.evaluate(`(() => { const input = document.querySelector('#veMediaBody input[type="file"]'); input?.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        queue = await waitFor(browser, `document.querySelectorAll('#veMediaBody .ve-media-row').length === 20`, { timeoutMs: 30_000, intervalMs: 100, label: '20-file media queue after explicit change' });
      }
      const loadMs = performance.now() - started;
      latency('20-file-queue', loadMs);
      const initial = await mediaQueueSnapshot(browser);
      const initialNames = initial.rows.map((row) => row.name);
      const positionsValid = initial.rows.every((row, index) => row.position === String(index + 1));
      const browserDecodeValid = initial.rows.every((row) => /^\d+\s*×\s*\d+\s*·/u.test(row.details));
      const reverseButton = await browser.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll('#veMediaBody button')).find((item) => item.textContent?.replace(/\\s+/gu, ' ').trim() === 'Обратный порядок');
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (!reverseButton) throw new Error('Media queue reverse-order control is missing.');
      const reorderStarted = performance.now();
      await browser.dispatchClick(reverseButton);
      const reversed = await waitFor(browser, `(() => {
        const names = Array.from(document.querySelectorAll('#veMediaBody .ve-media-row .ve-media-row__copy strong')).map((item) => item.textContent?.trim() || '');
        return names.length === 20 && names[0] === ${json(initialNames.at(-1))} && names.at(-1) === ${json(initialNames[0])} ? names : null;
      })()`, { label: 'media queue reverse order' });
      latency('queue-reorder-feedback', performance.now() - reorderStarted);
      const persisted = await waitForIndexedRecord(
        browser,
        'media-queues',
        `(row) => row.slug === ${json(bundle.profile.noPhotoProduct.slug)} && row.items?.length === 20 && row.items[0]?.name === ${json(initialNames.at(-1))}`,
        'persisted media queue',
        '(row) => ({ key: row.key, slug: row.slug, itemCount: row.items.length, names: row.items.map((item) => item.name) })'
      );
      state.queueOrder = reversed;
      return {
        issues: [
          ...(!queue ? ['queue-not-created'] : []),
          ...(!positionsValid ? ['queue-numbering'] : []),
          ...(!browserDecodeValid ? ['browser-thumbnail-decode-or-dimensions'] : []),
          ...(new Set(initialNames).size !== 20 ? ['fixture-name-uniqueness'] : []),
          ...(!persisted ? ['queue-not-checkpointed'] : [])
        ],
        evidence: {
          binding: binding.binding,
          fixtureCount: bundle.mediaFiles.length,
          fixtureEvidence: bundle.mediaEvidence,
          initial,
          reversedOrder: reversed,
          persisted,
          queueLoadMs: rounded(loadMs),
          meanPerFileMs: rounded(loadMs / 20)
        },
        limitations: ['Files remain in the browser recovery queue; this scenario intentionally does not stage or confirm them, so canonical bytes are untouched.']
      };
    });

    await scenario('reload-recovery', 'Reload restores both the product draft and numbered media queue', async () => {
      const storedDraft = await waitForIndexedRecord(
        browser,
        'record-drafts',
        `(row) => row.slug === ${json(bundle.profile.product.slug)} && row.content?.title === ${json(state.productTitle?.committed || '')}`,
        'persisted product draft',
        '(row) => ({ key: row.key, slug: row.slug, baseRevision: row.baseRevision, title: row.content?.title || "" })'
      );
      await browser.navigate(`${options.origin}/admin/`, { waitAfterMs: 120 });
      await loginIfNeeded(browser, options);
      await waitForCanvas(browser, '/');
      const product = await openPage(browser, bundle.profile.product);
      const titleBinding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'title', tool: 'heading' });
      const restoredTitle = await projectedBindingText(browser, titleBinding.binding.bindingId);
      const restoredDescription = state.productDescription
        ? await waitForProjectedText(browser, state.productDescription.bindingId, state.productDescription.marker, 'restored long-text draft')
        : '';
      const noPhoto = await openPage(browser, bundle.profile.noPhotoProduct);
      const mediaBinding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'gallery', tool: 'gallery', role: 'missing-product-media' });
      await clickBinding(browser, mediaBinding.binding.bindingId);
      const restoredQueue = await waitFor(browser, `(() => {
        const names = Array.from(document.querySelectorAll('#veMediaBody .ve-media-row .ve-media-row__copy strong')).map((item) => item.textContent?.trim() || '');
        return document.querySelector('#veMediaDialog')?.open && names.length === 20 ? names : null;
      })()`, { timeoutMs: 20_000, label: 'restored 20-file queue' });
      const queueMatches = JSON.stringify(restoredQueue) === JSON.stringify(state.queueOrder);
      const titleMatches = restoredTitle === state.productTitle?.committed;
      return {
        issues: [
          ...(!storedDraft ? ['draft-not-checkpointed-before-reload'] : []),
          ...(!titleMatches ? ['title-draft-not-restored'] : []),
          ...(!restoredDescription.includes(state.productDescription?.marker || '') ? ['long-text-draft-not-restored'] : []),
          ...(!queueMatches ? ['media-queue-order-not-restored'] : [])
        ],
        evidence: {
          beforeUnloadDialogAccepted: telemetry.dialogs.some((entry) => entry.scenario === 'reload-recovery' && entry.type === 'beforeunload'),
          storedDraft: storedDraft ? { key: storedDraft.key, slug: storedDraft.slug, baseRevision: storedDraft.baseRevision } : null,
          product, restoredTitle, expectedTitle: state.productTitle?.committed, restoredDescriptionMarker: state.productDescription?.marker,
          noPhoto, restoredQueue, expectedQueue: state.queueOrder, queueMatches
        }
      };
    });

    await scenario('local-save-and-exact', 'Local Save returns independently and starts exact validation asynchronously', async ({ latency }) => {
      if (await browser.evaluate(`Boolean(document.querySelector('#veMediaDialog')?.open)`)) {
        await browser.evaluate(`(() => { document.querySelector('#veMediaDialog')?.close('acceptance-continue'); return true; })()`);
      }
      await ensurePage(browser, bundle.profile.product);
      const beforeEvidence = await browser.evaluate(`(() => {
        const key = Object.keys(localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
        return { key: key || '', value: key ? localStorage.getItem(key) : null };
      })()`);
      const requestIndex = telemetry.requests.length;
      const statusTimeline = [];
      const started = performance.now();
      await clickShell(browser, SELECTORS.save);
      const deadline = Date.now() + 30_000;
      let afterEvidence = null;
      while (Date.now() < deadline) {
        const snapshot = await browser.evaluate(`(() => {
          const key = Object.keys(localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
          return {
            busy: document.querySelector('#veSave')?.dataset.busy === 'true',
            disabled: Boolean(document.querySelector('#veSave')?.disabled),
            status: document.querySelector('#veStatusLabel')?.textContent?.replace(/\\s+/gu, ' ').trim() || '',
            evidence: key ? localStorage.getItem(key) : null
          };
        })()`);
        if (!statusTimeline.length || statusTimeline.at(-1).status !== snapshot.status) statusTimeline.push({ atMs: rounded(performance.now() - started), status: snapshot.status });
        if (snapshot.evidence && snapshot.evidence !== beforeEvidence.value && !snapshot.busy) { afterEvidence = snapshot; break; }
        await sleep(25);
      }
      if (!afterEvidence) throw new Error('Local Save did not produce new latency evidence.');
      const wallLatency = performance.now() - started;
      const parsedEvidence = JSON.parse(afterEvidence.evidence);
      latency('save-wall', wallLatency);
      latency('save-ui-evidence', parsedEvidence.latencyMs);

      const transactionResponsesDeadline = Date.now() + 5_000;
      while (Date.now() < transactionResponsesDeadline) {
        const transactionRequests = telemetry.requests.slice(requestIndex)
          .filter((entry) => entry.url.pathname.endsWith('/transactions/preview') || entry.url.pathname.endsWith('/transactions/apply'));
        if (transactionRequests.length >= 2 && transactionRequests.every((entry) => entry.status !== null || entry.failed)) break;
        await sleep(25);
      }

      const exactDeadline = Date.now() + bundle.profile.exactObservationMs;
      let exactStatus = afterEvidence.status;
      while (Date.now() < exactDeadline) {
        exactStatus = await browser.evaluate(`document.querySelector('#veStatusLabel')?.textContent?.replace(/\\s+/gu, ' ').trim() || ''`);
        if (!statusTimeline.length || statusTimeline.at(-1).status !== exactStatus) statusTimeline.push({ atMs: rounded(performance.now() - started), status: exactStatus });
        const exactRequest = telemetry.requests.slice(requestIndex).find((entry) => entry.url.pathname.endsWith('/validation/request'));
        if (exactRequest && (exactStatus.startsWith('Проверяется') || exactStatus.startsWith('Готово к публикации') || exactStatus.startsWith('Сохранено, но проверка не прошла'))) break;
        await sleep(50);
      }
      const saveRequests = telemetry.requests.slice(requestIndex);
      const preview = saveRequests.find((entry) => entry.url.pathname.endsWith('/transactions/preview')) || null;
      const apply = saveRequests.find((entry) => entry.url.pathname.endsWith('/transactions/apply')) || null;
      const exactRequest = saveRequests.find((entry) => entry.url.pathname.endsWith('/validation/request')) || null;
      if (exactRequest) {
        const exactResponseDeadline = Date.now() + 8_000;
        while (Date.now() < exactResponseDeadline && exactRequest.status === null && !exactRequest.failed) await sleep(25);
      }
      const exactPoll = saveRequests.find((entry) => /\/validation\/runs\//u.test(entry.url.pathname)) || null;
      const asyncObserved = statusTimeline.some((entry) => entry.status.startsWith('Проверяется'))
        || Boolean(exactRequest && ['Готово к публикации', 'Сохранено, но проверка не прошла'].some((label) => exactStatus.startsWith(label)));
      const sourceSaved = Boolean(preview && apply && Number(apply.status) >= 200 && Number(apply.status) < 300);
      return {
        issues: [
          ...(!sourceSaved ? ['local-save-transaction-not-applied'] : []),
          ...(!exactRequest ? ['exact-validation-not-requested'] : []),
          ...(exactRequest && exactRequest.status === null && !exactRequest.failed ? ['exact-request-no-response'] : []),
          ...(!asyncObserved ? ['async-exact-status-not-observed'] : []),
          ...(exactStatus.startsWith('Сохранено, но проверка не прошла') ? ['exact-validation-failed'] : []),
          ...(Number(parsedEvidence.latencyMs) > bundle.profile.saveBudgetMs ? [`save-budget:${parsedEvidence.latencyMs}`] : [])
        ],
        evidence: {
          saveBudgetMs: bundle.profile.saveBudgetMs,
          wallLatencyMs: rounded(wallLatency),
          uiLatencyMs: Number(parsedEvidence.latencyMs),
          transactionId: parsedEvidence.transactionId || null,
          records: parsedEvidence.records,
          preview, apply, exactRequest, exactPoll,
          statusTimeline,
          exactStatusAtObservationEnd: exactStatus,
          saveReturnedWithoutWaitingForExactTerminal: statusTimeline.some((entry) => entry.status.startsWith('Проверяется'))
        },
        limitations: ['The runner observes the asynchronous exact request/status boundary; it does not wait for or publish a release artifact.']
      };
    });

    await scenario('bulk-media-stage-save', 'Twenty photos stage, one failed file retries alone, an explicit cover is assigned, and Save promotes the batch atomically', async ({ latency }) => {
      if (!bundle.failedMediaFile) throw new Error('The disposable bundle lacks failedMediaFile for retry acceptance.');
      const navigation = await openPage(browser, bundle.profile.noPhotoProduct);
      const mediaBinding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'gallery', tool: 'gallery', role: 'missing-product-media' });
      await clickBinding(browser, mediaBinding.binding.bindingId);
      await waitFor(browser, `document.querySelector('#veMediaDialog')?.open && document.querySelectorAll('#veMediaBody .ve-media-row').length === 20`, {
        timeoutMs: 20_000,
        label: 'restored queue before staging'
      });

      const documentNode = await browser.send('DOM.getDocument', { depth: -1, pierce: true });
      const inputNode = await browser.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#veMediaBody input[type="file"]' });
      if (!inputNode.nodeId) throw new Error('Media file input disappeared before negative fixture selection.');
      await browser.send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [bundle.failedMediaFile] });
      try {
        await waitFor(browser, `document.querySelectorAll('#veMediaBody .ve-media-row').length === 21`, { timeoutMs: 8_000, label: 'negative fixture appended' });
      } catch {
        await browser.evaluate(`(() => { document.querySelector('#veMediaBody input[type="file"]')?.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await waitFor(browser, `document.querySelectorAll('#veMediaBody .ve-media-row').length === 21`, { timeoutMs: 8_000, label: 'negative fixture appended after change' });
      }

      const roleAssignment = await browser.evaluate(`(() => {
        const first = document.querySelector('#veMediaBody .ve-media-row');
        const cover = first?.querySelector('.ve-media-role-picker input[value="cover"]');
        if (!cover) return { available: false, assigned: false };
        if (!cover.checked) {
          cover.checked = true;
          cover.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { available: true, assigned: true };
      })()`);
      await waitFor(browser, `document.querySelectorAll('#veMediaBody .ve-media-role-picker input[value="cover"]:checked').length === 1`, {
        label: 'one explicit cover assignment'
      });

      const stageRequestIndex = telemetry.requests.length;
      const stageStarted = performance.now();
      await clickShell(browser, SELECTORS.mediaConfirm);
      const staged = await waitFor(browser, `(() => {
        const rows = Array.from(document.querySelectorAll('#veMediaBody .ve-media-row'));
        const failed = rows.filter((row) => row.dataset.status === 'error');
        const ready = rows.filter((row) => ['uploaded', 'reused'].includes(row.dataset.status));
        return rows.length === 21 && failed.length === 1 && ready.length === 20
          ? { failedName: failed[0].querySelector('strong')?.textContent?.trim() || '', ready: ready.length }
          : null;
      })()`, { timeoutMs: 90_000, intervalMs: 100, label: '20 successful stages and one isolated failure' });
      latency('bulk-stage-20-plus-failure', performance.now() - stageStarted);
      const firstStageRequests = telemetry.requests.slice(stageRequestIndex)
        .filter((entry) => entry.method === 'POST' && entry.url.pathname.endsWith('/media/staging'));

      const retryStartedAt = telemetry.requests.length;
      const retryButton = await waitFor(browser, `(() => {
        const button = Array.from(document.querySelectorAll('#veMediaBody button')).find((item) => item.textContent?.replace(/\\s+/gu, ' ').trim() === 'Повторить ошибки');
        if (!button || button.disabled) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`, { label: 'retry failed media control' });
      await browser.dispatchClick(retryButton);
      await waitFor(browser, `(() => {
        const failed = document.querySelectorAll('#veMediaBody .ve-media-row[data-status="error"]');
        const retry = Array.from(document.querySelectorAll('#veMediaBody button')).find((item) => item.textContent?.replace(/\\s+/gu, ' ').trim() === 'Повторить ошибки');
        return failed.length === 1 && retry && !retry.disabled ? true : null;
      })()`, { timeoutMs: 30_000, intervalMs: 100, label: 'failed media retry completed' });
      const retryRequests = telemetry.requests.slice(retryStartedAt)
        .filter((entry) => entry.method === 'POST' && entry.url.pathname.endsWith('/media/staging'));

      const removedFailed = await browser.evaluate(`(() => {
        const row = document.querySelector('#veMediaBody .ve-media-row[data-status="error"]');
        const name = row?.querySelector('strong')?.textContent?.trim() || '';
        const remove = row?.querySelector('.ve-media-row__remove');
        remove?.click();
        return { found: Boolean(row && remove), name };
      })()`);
      await waitFor(browser, `document.querySelectorAll('#veMediaBody .ve-media-row').length === 20 && !document.querySelector('#veMediaBody .ve-media-row[data-status="error"]')`, {
        label: 'failed media removed'
      });
      const finalRoleCount = await browser.evaluate(`document.querySelectorAll('#veMediaBody .ve-media-role-picker input[value="cover"]:checked').length`);
      await clickShell(browser, SELECTORS.mediaConfirm);
      await waitFor(browser, `!document.querySelector('#veMediaDialog')?.open`, { timeoutMs: 15_000, label: 'media queue applied to browser draft' });

      const mediaDraft = await waitForIndexedRecord(
        browser,
        'record-drafts',
        `(row) => row.slug === ${json(bundle.profile.noPhotoProduct.slug)} && row.content?.gallery?.length === 20 && row.stagedMedia?.length === 20`,
        'media draft with twenty staged leases',
        '(row) => ({ key: row.key, slug: row.slug, galleryCount: row.content.gallery.length, cover: row.content.image || "", stagedCount: row.stagedMedia.length, paths: row.content.gallery.map((item) => item?.src || item) })'
      );
      const liveProjection = await waitFor(browser, `(() => {
        const frame = document.querySelector('#veFrame');
        const root = frame?.contentDocument?.querySelector('[data-smu1-binding-id="' + CSS.escape(${json(mediaBinding.binding.bindingId)}) + '"]');
        const images = Array.from(root?.querySelectorAll('img') || []).filter((image) => !image.hidden && image.getAttribute('src'));
        return images.length ? { count: images.length, stagedPreview: images.some((image) => image.src.includes('/media/staging/')) } : null;
      })()`, { timeoutMs: 8_000, label: 'live media projection on formerly empty product' });

      const beforeSaveEvidence = await browser.evaluate(`(() => {
        const key = Object.keys(localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
        return key ? localStorage.getItem(key) : null;
      })()`);
      const mediaSaveRequestIndex = telemetry.requests.length;
      const mediaSaveStarted = performance.now();
      await clickShell(browser, SELECTORS.save);
      const mediaSave = await waitFor(browser, `(() => {
        const key = Object.keys(localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
        const value = key ? localStorage.getItem(key) : null;
        const busy = document.querySelector('#veSave')?.dataset.busy === 'true';
        return value && value !== ${json(beforeSaveEvidence)} && !busy ? JSON.parse(value) : null;
      })()`, { timeoutMs: 90_000, intervalMs: 50, label: 'atomic media Save' });
      latency('media-save-wall', performance.now() - mediaSaveStarted);
      const mediaSaveRequests = telemetry.requests.slice(mediaSaveRequestIndex);
      const mediaApply = mediaSaveRequests.find((entry) => entry.url.pathname.endsWith('/transactions/apply')) || null;
      const savedRecord = await browser.evaluate(`(async () => {
        const response = await fetch('/api/admin/content/products/${encodeURIComponent(bundle.profile.noPhotoProduct.slug)}', { credentials: 'include', cache: 'no-store' });
        const payload = await response.json();
        const content = payload?.content || payload;
        return { status: response.status, galleryCount: content?.gallery?.length || 0, cover: content?.image || '', paths: (content?.gallery || []).map((item) => item?.src || item) };
      })()`);
      const queueAfterSave = await browser.evaluate(indexedRecordExpression(
        'media-queues',
        `(row) => row.slug === ${json(bundle.profile.noPhotoProduct.slug)}`,
        '(row) => ({ key: row.key, count: row.items?.length || 0 })'
      ));
      const canonicalPaths = [...new Set(savedRecord.paths || [])];

      return {
        issues: [
          ...(!roleAssignment.available || !roleAssignment.assigned || finalRoleCount !== 1 ? ['explicit-cover-role-not-preserved'] : []),
          ...(firstStageRequests.length !== 21 ? [`stage-request-count:${firstStageRequests.length}`] : []),
          ...(retryRequests.length !== 1 ? [`retry-was-not-failed-only:${retryRequests.length}`] : []),
          ...(!removedFailed.found ? ['failed-row-not-removable'] : []),
          ...(!mediaDraft || mediaDraft.galleryCount !== 20 || mediaDraft.stagedCount !== 20 ? ['staged-media-draft-incomplete'] : []),
          ...(!liveProjection?.stagedPreview ? ['validated-source-not-live-projected'] : []),
          ...(!mediaApply || Number(mediaApply.status) < 200 || Number(mediaApply.status) >= 300 ? ['media-transaction-not-applied'] : []),
          ...(savedRecord.status !== 200 || savedRecord.galleryCount !== 20 || canonicalPaths.length !== 20 ? ['canonical-media-record-incomplete'] : []),
          ...(!savedRecord.cover || !canonicalPaths.includes(savedRecord.cover) ? ['canonical-cover-not-explicitly-linked'] : []),
          ...(queueAfterSave ? ['media-recovery-queue-not-cleared'] : [])
        ],
        allowedHttpFailures: [{ pathname: '/media/staging', statuses: [400, 409, 415, 422] }],
        evidence: {
          navigation,
          binding: mediaBinding.binding,
          staged,
          firstStageRequestCount: firstStageRequests.length,
          retryRequestCount: retryRequests.length,
          failedName: removedFailed.name,
          explicitRole: { assignment: roleAssignment, finalCoverCount: finalRoleCount },
          mediaDraft,
          liveProjection,
          mediaSave,
          mediaApply,
          savedRecord: { ...savedRecord, paths: canonicalPaths },
          queueAfterSave
        }
      };
    });

    }

    async function runRequiredResilienceScenarios() {
    await scenario('export-import-lossless', 'A full-site export parses through the real import preview without any loss or writes', async () => {
      const roundTrip = await browser.evaluate(`(async () => {
        const normalize = (value) => {
          const visit = (node) => {
            if (Array.isArray(node)) return node.map(visit);
            if (!node || typeof node !== 'object') return node;
            return Object.fromEntries(Object.entries(node)
              .filter(([key]) => key !== 'exportedAt')
              .sort(([left], [right]) => left.localeCompare(right, 'en'))
              .map(([key, item]) => [key, visit(item)]));
          };
          return JSON.stringify(visit(value));
        };
        const firstResponse = await fetch('/api/admin/json-export/full-site', { credentials: 'include', cache: 'no-store' });
        const first = await firstResponse.json();
        const me = await (await fetch('/api/admin/me', { credentials: 'include', cache: 'no-store' })).json();
        const previewResponse = await fetch('/api/admin/json-import/preview', {
          method: 'POST', credentials: 'include', cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-CSRF': me.csrfToken || '',
            'X-Admin-Recovery-Client-Id': 'h6-acceptance-roundtrip'
          },
          body: JSON.stringify({ scope: 'full-site', writeMode: 'replace', rawJson: JSON.stringify(first) })
        });
        const preview = await previewResponse.json();
        const secondResponse = await fetch('/api/admin/json-export/full-site', { credentials: 'include', cache: 'no-store' });
        const second = await secondResponse.json();
        const rows = Array.isArray(preview.rows) ? preview.rows : [];
        return {
          exportStatuses: [firstResponse.status, secondResponse.status],
          previewStatus: previewResponse.status,
          type: first.type,
          version: first.version,
          rowCount: rows.length,
          nonSkipRows: rows.filter((row) => row.action !== 'skip').map((row) => ({ collection: row.collection || row.singleton || '', slug: row.slug || '', action: row.action || '' })),
          canApply: preview.canApply === true,
          normalizedEqual: normalize(first) === normalize(second),
          collectionKeys: Object.keys(first.collections || {}).sort(),
          singletonKeys: Object.keys(first.singletons || {}).sort()
        };
      })()`);
      return {
        issues: [
          ...(!roundTrip.exportStatuses.every((status) => status === 200) || roundTrip.previewStatus !== 200 ? ['roundtrip-http-status'] : []),
          ...(roundTrip.type !== 'smu1_full_site_export' || roundTrip.version !== 1 ? ['roundtrip-envelope'] : []),
          ...(roundTrip.canApply || roundTrip.nonSkipRows.length ? ['roundtrip-produced-diff'] : []),
          ...(!roundTrip.normalizedEqual ? ['roundtrip-export-not-lossless'] : []),
          ...(!roundTrip.collectionKeys.length || !roundTrip.singletonKeys.length ? ['roundtrip-scope-incomplete'] : [])
        ],
        evidence: { ...roundTrip, losslessRoundTrip: roundTrip.normalizedEqual && !roundTrip.canApply && roundTrip.nonSkipRows.length === 0 }
      };
    });

    await scenario('history-restore-new-transaction', 'History restore is confirmed in the UI and appends a new transaction', async () => {
      const navigation = await openPage(browser, bundle.profile.product);
      const titleBinding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'title', tool: 'heading' });
      const originalTitle = await projectedBindingText(browser, titleBinding.binding.bindingId);
      const marker = `H6-history-source-${Date.now()}`;
      await clickBinding(browser, titleBinding.binding.bindingId);
      await waitFor(browser, `Boolean(!document.querySelector('#veInlineEditor')?.hidden)`, { label: 'history source title editor' });
      await setInlineText(browser, `${originalTitle} · ${marker}`);
      await browser.dispatchKey('Enter', { code: 'Enter' });
      const beforeSaveEvidence = await browser.evaluate(`(() => {
        const key = Object.keys(localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
        return key ? localStorage.getItem(key) : null;
      })()`);
      await clickShell(browser, SELECTORS.save);
      const sourceSave = await waitFor(browser, `(() => {
        const key = Object.keys(localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
        const value = key ? localStorage.getItem(key) : null;
        return value && value !== ${json(beforeSaveEvidence)} && document.querySelector('#veSave')?.dataset.busy !== 'true'
          ? JSON.parse(value) : null;
      })()`, { timeoutMs: 30_000, intervalMs: 50, label: 'history source local Save' });
      const before = await browser.evaluate(`fetch('/api/admin/history', { credentials: 'include', cache: 'no-store' }).then((response) => response.json())`);
      const source = (before.history || []).find((entry) => entry.transactionId === sourceSave.transactionId) || null;
      if (!source?.transactionId) throw new Error('The UI Save did not create a product history source transaction.');
      await clickShell(browser, SELECTORS.pageSettings);
      await waitFor(browser, `Boolean(document.querySelector('#veSettingsDrawer')?.open)`, { label: 'page settings drawer' });
      await clickShell(browser, SELECTORS.settingsHistory);
      await waitFor(browser, `Boolean(document.querySelector('#veSettingsBody .ve-history-item button'))`, { timeoutMs: 12_000, label: 'history restore control' });
      await clickShell(browser, '#veSettingsBody .ve-history-item button');
      const beforeIds = (before.history || []).map((entry) => entry.transactionId);
      const restoreToast = await waitFor(browser, `(() => Array.from(document.querySelectorAll('#veToastRegion .ve-toast'))
        .map((node) => node.textContent || '')
        .find((text) => text.includes('как новая локальная транзакция')) || '')()`, {
        timeoutMs: 8_000,
        intervalMs: 40,
        label: 'history restore UI confirmation'
      });
      const after = await waitFor(browser, `(async () => {
        const payload = await (await fetch('/api/admin/history', { credentials: 'include', cache: 'no-store' })).json();
        const added = (payload.history || []).find((entry) => !${json(beforeIds)}.includes(entry.transactionId));
        return added ? { payload, added } : null;
      })()`, { timeoutMs: 20_000, intervalMs: 100, label: 'new restore transaction' });
      state.historyRestore = { sourceTransactionId: source.transactionId, transactionId: after.added.transactionId };
      return {
        issues: [
          ...(after.added.transactionId === source.transactionId ? ['restore-reused-source-transaction'] : []),
          ...(after.added.metadata?.restoresTransactionId !== source.transactionId ? ['restore-source-link-missing'] : []),
          ...(!restoreToast ? ['restore-ui-confirmation-missing'] : [])
        ],
        evidence: {
          navigation,
          sourceSave,
          sourceTransactionId: source.transactionId,
          restoredTransactionId: after.added.transactionId,
          restoresTransactionId: after.added.metadata?.restoresTransactionId || null,
          newTransaction: after.added.transactionId !== source.transactionId,
          historyCountBefore: before.history?.length || 0,
          historyCountAfter: after.payload.history?.length || 0,
          restoreToast
        }
      };
    });

    await scenario('two-tab-conflict', 'Two editor tabs expose mine, theirs and base and reject silent overwrite', async () => {
      await ensurePage(browser, bundle.profile.product);
      const titleBinding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'title', tool: 'heading' });
      const original = await projectedBindingText(browser, titleBinding.binding.bindingId);
      const peer = await openPeerEditor(browser, options.origin);
      const peerNavigation = await openPageInPeer(browser, bundle.profile.product);
      const mineMarker = `H6-mine-${Date.now()}`;
      const theirsMarker = `H6-theirs-${Date.now()}`;
      const mineTitle = `${original} · ${mineMarker}`;
      await clickBinding(browser, titleBinding.binding.bindingId);
      await waitFor(browser, `Boolean(!document.querySelector('#veInlineEditor')?.hidden)`, { label: 'main-tab title editor' });
      await setInlineText(browser, mineTitle);
      await browser.dispatchKey('Enter', { code: 'Enter' });
      await waitForProjectedText(browser, titleBinding.binding.bindingId, mineMarker, 'main-tab draft projection');
      const mineDraft = await waitForIndexedRecord(
        browser,
        'record-drafts',
        `(row) => row.slug === ${json(bundle.profile.product.slug)} && row.content?.title?.includes(${json(mineMarker)})`,
        'main-tab conflict draft',
        '(row) => ({ key: row.key, baseRevision: row.baseRevision, title: row.content.title })'
      );

      const peerEdit = await editPeerProductTitle(browser, theirsMarker);
      const peerSave = await savePeerEditor(browser);
      await waitFor(browser, `document.body.textContent.includes('сохранён в другой вкладке')`, { timeoutMs: 8_000, label: 'cross-tab conflict notification' });

      const conflictRequestIndex = telemetry.requests.length;
      await clickShell(browser, SELECTORS.save);
      const conflict = await waitFor(browser, `(() => {
        const dialog = document.querySelector('#veConflictDialog');
        if (!dialog?.open) return null;
        const text = dialog.textContent?.replace(/\\s+/gu, ' ').trim() || '';
        const pres = Array.from(dialog.querySelectorAll('pre')).map((node) => node.textContent || '');
        return { text, pres, hasMine: pres.some((value) => value.includes(${json(mineMarker)})), hasTheirs: pres.some((value) => value.includes(${json(theirsMarker)})), hasBase: pres.some((value) => value.includes(${json(original)})) };
      })()`, { timeoutMs: 12_000, intervalMs: 50, label: 'mine/theirs/base conflict dialog' });
      const conflictRequests = telemetry.requests.slice(conflictRequestIndex);
      const serverConflict = conflictRequests.find((request) => request.url.pathname.endsWith('/transactions/preview') && request.status === 409) || null;
      const canonical = await browser.evaluate(`(async () => {
        const response = await fetch('/api/admin/content/products/${encodeURIComponent(bundle.profile.product.slug)}', { credentials: 'include', cache: 'no-store' });
        const payload = await response.json();
        return { status: response.status, title: payload.content?.title || payload.title || '' };
      })()`);
      await clickShell(browser, '#veConflictDialog [data-reload-theirs]');
      await waitFor(browser, `!document.querySelector('#veConflictDialog')?.open`, { label: 'conflict resolution reload' });
      await waitForProjectedText(browser, titleBinding.binding.bindingId, theirsMarker, 'main tab reloaded theirs');
      await browser.evaluate(`(() => { window.__h6AcceptancePeer?.close?.(); window.__h6AcceptancePeer = null; return true; })()`);

      const silentOverwriteBlocked = Boolean(serverConflict)
        && canonical.title.includes(theirsMarker)
        && !canonical.title.includes(mineMarker);
      return {
        issues: [
          ...(!peer.ready || !peerNavigation.route || !peerSave.transactionId ? ['peer-tab-save-incomplete'] : []),
          ...(!conflict.hasMine || !conflict.hasTheirs || !conflict.hasBase ? ['conflict-three-way-state-missing'] : []),
          ...(!silentOverwriteBlocked ? ['silent-overwrite-not-blocked'] : [])
        ],
        allowedHttpFailures: [{ pathname: '/transactions/preview', statuses: [409] }],
        evidence: {
          mine: { title: mineTitle, baseRevision: mineDraft.baseRevision },
          theirs: { title: peerEdit.title, transactionId: peerSave.transactionId },
          base: { title: original },
          dialog: conflict,
          serverConflictStatus: serverConflict?.status || null,
          canonical,
          silentOverwriteBlocked
        }
      };
    });

    await scenario('expired-session-draft-recovery', 'An expired session returns to login without deleting the IndexedDB draft', async () => {
      await ensurePage(browser, bundle.profile.product);
      const titleBinding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'title', tool: 'heading' });
      const original = await projectedBindingText(browser, titleBinding.binding.bindingId);
      const marker = `H6-session-recovery-${Date.now()}`;
      const recoveredTitle = `${original} · ${marker}`;
      await clickBinding(browser, titleBinding.binding.bindingId);
      await waitFor(browser, `Boolean(!document.querySelector('#veInlineEditor')?.hidden)`, { label: 'session recovery title editor' });
      await setInlineText(browser, recoveredTitle);
      await browser.dispatchKey('Enter', { code: 'Enter' });
      const beforeExpiry = await waitForIndexedRecord(
        browser,
        'record-drafts',
        `(row) => row.slug === ${json(bundle.profile.product.slug)} && row.content?.title?.includes(${json(marker)})`,
        'draft before session expiry',
        '(row) => ({ key: row.key, baseRevision: row.baseRevision, title: row.content.title })'
      );
      const expired = await testFaultControl(browser, { expireSession: true });
      await clickShell(browser, SELECTORS.pageSettings);
      await waitFor(browser, `Boolean(document.querySelector('#veSettingsDrawer')?.open)`, { label: 'settings before expired request' });
      await clickShell(browser, SELECTORS.settingsHistory);
      const loginVisible = await waitFor(browser, `Boolean(!document.querySelector('#veLogin')?.hidden && document.querySelector('#veApp')?.hidden)`, { timeoutMs: 10_000, label: 'expired-session login' });
      const afterExpiry = await waitForIndexedRecord(
        browser,
        'record-drafts',
        `(row) => row.slug === ${json(bundle.profile.product.slug)} && row.content?.title?.includes(${json(marker)})`,
        'draft after session expiry',
        '(row) => ({ key: row.key, baseRevision: row.baseRevision, title: row.content.title })'
      );
      const relogin = await loginIfNeeded(browser, options);
      await ensurePage(browser, bundle.profile.product);
      const restoredBinding = await findBinding(browser, { ownerCollection: 'products', fieldPath: 'title', tool: 'heading' });
      const restoredProjection = await waitForProjectedText(browser, restoredBinding.binding.bindingId, marker, 'recovered draft projection after login');
      state.sessionRecovery = { marker, title: recoveredTitle };
      return {
        issues: [
          ...(expired.status !== 200 || expired.payload?.sessionExpired !== true ? ['session-expiry-hook-failed'] : []),
          ...(!loginVisible ? ['expired-session-login-not-shown'] : []),
          ...(!afterExpiry || afterExpiry.title !== beforeExpiry.title ? ['indexeddb-draft-lost-on-expiry'] : []),
          ...(!restoredProjection.includes(marker) ? ['draft-not-restored-after-login'] : [])
        ],
        evidence: {
          expired,
          loginVisible,
          beforeExpiry,
          afterExpiry,
          relogin,
          restoredProjection,
          indexedDbDraftPreserved: afterExpiry?.title === beforeExpiry?.title,
          draftRestoredAfterLogin: restoredProjection.includes(marker)
        },
        allowedHttpFailures: [{ pathname: '/history', statuses: [401] }],
        allowedNetworkFailures: [{
          resourceTypes: ['Script', 'Image', 'Media', 'Fetch'],
          failures: ['net::ERR_ABORTED'],
          pathnamePrefixes: ['/src/', '/uploads/', '/assets/']
        }],
        allowedRuntimeErrors: ["Error while running audit's match function: TypeError: Failed to fetch"]
      };
    });

    await scenario('failed-exact-after-save', 'A successful local Save survives an exact-build failure and keeps preview blocked', async ({ latency }) => {
      const armed = await testFaultControl(browser, { nextExactFailure: true, nextBackupFailure: true });
      const beforeSaveEvidence = await browser.evaluate(`(() => {
        const key = Object.keys(localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
        return key ? localStorage.getItem(key) : null;
      })()`);
      const started = performance.now();
      await clickShell(browser, SELECTORS.save);
      const save = await waitFor(browser, `(() => {
        const key = Object.keys(localStorage).find((entry) => entry.endsWith(':last-save-evidence'));
        const value = key ? localStorage.getItem(key) : null;
        return value && value !== ${json(beforeSaveEvidence)} && document.querySelector('#veSave')?.dataset.busy !== 'true'
          ? JSON.parse(value) : null;
      })()`, { timeoutMs: 30_000, intervalMs: 50, label: 'local Save before injected exact failure' });
      latency('failed-exact-local-save-wall', performance.now() - started);
      const canonical = await browser.evaluate(`(async () => {
        const response = await fetch('/api/admin/content/products/${encodeURIComponent(bundle.profile.product.slug)}', { credentials: 'include', cache: 'no-store' });
        const payload = await response.json();
        return { status: response.status, title: payload.content?.title || payload.title || '' };
      })()`);
      const exact = await waitFor(browser, `(async () => {
        const recoveryClientId = localStorage.getItem('smu1-admin:recovery-client') || '';
        const payload = await (await fetch('/api/admin/validation/status', {
          credentials: 'include', cache: 'no-store',
          headers: { 'X-Admin-Recovery-Client-Id': recoveryClientId }
        })).json();
        return payload.current?.transactionId === ${json(save.transactionId)} && payload.current?.status === 'failed' ? payload.current : null;
      })()`, { timeoutMs: 12_000, intervalMs: 100, label: 'injected exact failure' });
      await clickShell(browser, SELECTORS.publish);
      const drawer = await waitFor(browser, `(() => {
        const root = document.querySelector('#vePublishDrawer');
        const exactStep = root?.querySelector('[data-step="2"]');
        const preview = root?.querySelector('[data-preview-publish]');
        return root?.open && exactStep?.dataset.state === 'failed'
          ? { text: exactStep.textContent?.replace(/\\s+/gu, ' ').trim() || '', previewDisabled: Boolean(preview?.disabled), previewLabel: preview?.textContent?.replace(/\\s+/gu, ' ').trim() || '' }
          : null;
      })()`, { timeoutMs: 12_000, intervalMs: 100, label: 'failed exact publish gate' });
      const savedMarker = state.sessionRecovery?.marker || '';
      const canonicalPreserved = canonical.status === 200 && canonical.title.includes(savedMarker);
      state.failureSave = { transactionId: save.transactionId, save, exact, canonical, drawer };
      return {
        issues: [
          ...(armed.status !== 200 || !armed.payload?.armed?.nextExactFailure || !armed.payload?.armed?.nextBackupFailure ? ['failure-hooks-not-armed'] : []),
          ...(!save.transactionId ? ['failed-exact-save-missing-transaction'] : []),
          ...(!canonicalPreserved ? ['failed-exact-lost-saved-data'] : []),
          ...(exact.status !== 'failed' || exact.diagnostics?.code !== 'EXACT_TEST_INJECTED_FAILURE' ? ['exact-failure-not-observed'] : []),
          ...(!drawer.previewDisabled || !drawer.text.includes('Тестовая публикация заблокирована') ? ['preview-not-blocked-after-exact-failure'] : [])
        ],
        limitations: save.latencyMs > bundle.profile.saveBudgetMs
          ? [`Local Save ${save.latencyMs} ms exceeded the ${bundle.profile.saveBudgetMs} ms target; the dedicated Save latency gate remains authoritative.`]
          : [],
        allowedHttpFailures: [
          { pathname: '/publish/status', statuses: [403, 409] },
          { pathname: '/backups', statuses: [503] }
        ],
        evidence: {
          armed,
          save,
          canonical,
          exact,
          drawer,
          saveCommitted: Boolean(save.transactionId),
          saveWithinBudget: save.latencyMs <= bundle.profile.saveBudgetMs,
          canonicalPreserved,
          exactFailed: exact.status === 'failed',
          previewBlocked: drawer.previewDisabled === true
        }
      };
    });

    await scenario('backup-failure-after-save', 'Backup failure is visible while the successful local Save remains committed', async () => {
      const failureSave = state.failureSave;
      if (!failureSave?.transactionId) throw new Error('The preceding local Save evidence is unavailable.');
      const backup = await waitFor(browser, `(async () => {
        const payload = await (await fetch('/api/admin/backups/status', { credentials: 'include', cache: 'no-store' })).json();
        return payload.lastAttempt?.transactionId === ${json(failureSave.transactionId)} && payload.lastAttempt?.status === 'failed' ? payload : null;
      })()`, { timeoutMs: 8_000, intervalMs: 100, label: 'injected backup failure status' });
      const ui = await waitFor(browser, `(() => {
        const drawer = document.querySelector('#vePublishDrawer');
        const summary = drawer?.querySelector('.ve-backup-summary');
        const status = document.querySelector('#veStatusLabel')?.textContent?.replace(/\\s+/gu, ' ').trim() || '';
        return summary?.dataset.state === 'failed'
          ? { summary: summary.textContent?.replace(/\\s+/gu, ' ').trim() || '', status }
          : null;
      })()`, { timeoutMs: 8_000, intervalMs: 100, label: 'backup failure in publish drawer' });
      const canonical = await browser.evaluate(`(async () => {
        const response = await fetch('/api/admin/content/products/${encodeURIComponent(bundle.profile.product.slug)}', { credentials: 'include', cache: 'no-store' });
        const payload = await response.json();
        return { status: response.status, title: payload.content?.title || payload.title || '' };
      })()`);
      const saveRemains = canonical.status === 200 && canonical.title === failureSave.canonical.title;
      const backupFailureVisible = ui.status.includes('резервная копия не создана')
        && /недоступно|не создана/iu.test(ui.summary);
      return {
        issues: [
          ...(backup.lastError?.code !== 'BACKUP_TEST_INJECTED_FAILURE' ? ['backup-failure-code-missing'] : []),
          ...(!backupFailureVisible ? ['backup-failure-ui-missing'] : []),
          ...(!ui.status.includes('резервная копия не создана') ? ['backup-failure-human-status-missing'] : []),
          ...(!saveRemains ? ['backup-failure-lost-save'] : [])
        ],
        evidence: {
          transactionId: failureSave.transactionId,
          backup,
          ui,
          canonical,
          saveRemains,
          backupFailureVisible
        }
      };
    });
    }

    telemetry.setScenario('final-boundary');
    await sleep(200);
    const rawSafety = browser.safetyEvidence();
    const safety = {
      ...rawSafety,
      intercepted: rawSafety.intercepted.map((entry) => ({
        method: entry.method,
        url: sanitizeRequestUrl(entry.url),
        reason: entry.reason
      }))
    };
    const releaseRequests = telemetry.requests.filter((request) => request.releaseEndpoint);
    const releaseMutationRequests = releaseRequests.filter((request) => request.releaseMutation);
    const releaseIntercepts = rawSafety.intercepted.filter((entry) => isReleaseMutation(entry.method, entry.url)).map((entry) => ({
      method: entry.method,
      url: sanitizeRequestUrl(entry.url),
      reason: entry.reason
    }));
    const releaseMutationsReachedServer = releaseMutationRequests.filter((request) => request.status !== null && !request.failed);
    for (const entry of scenarios) {
      const lateHttp = entry.requests.filter((request) => request.status >= 400 && !requestMatchesAllowance(request, entry.allowedHttpFailures));
      const lateNetwork = entry.requests.filter((request) => request.failed && !isBenignBrowserCancellation(request)
        && !requestMatchesNetworkAllowance(request, entry.allowedNetworkFailures)
        && !rawSafety.intercepted.some((intercept) => sanitizeRequestUrl(intercept.url).pathname === request.url.pathname));
      if (lateHttp.length && !entry.issues.some((issue) => issue.startsWith('http-errors:'))) entry.issues.push(`http-errors:${lateHttp.length}`);
      if (lateNetwork.length && !entry.issues.some((issue) => issue.startsWith('network-errors:'))) entry.issues.push(`network-errors:${lateNetwork.length}`);
      entry.status = entry.issues.length ? 'fail' : 'pass';
    }
    const failedScenarios = scenarios.filter((entry) => entry.status === 'fail');
    const boundaryErrors = telemetry.events.filter((entry) => ['bootstrap', 'final-boundary'].includes(entry.scenario));
    const boundaryHttpErrors = telemetry.requests.filter((request) => ['bootstrap', 'final-boundary'].includes(request.scenario)
      && request.status >= 400 && !requestMatchesAllowance(request, []));
    const boundaryNetworkErrors = telemetry.requests.filter((request) => ['bootstrap', 'final-boundary'].includes(request.scenario)
      && request.failed && !isBenignBrowserCancellation(request)
      && !rawSafety.intercepted.some((entry) => sanitizeRequestUrl(entry.url).pathname === request.url.pathname));
    const boundaryFailed = boundaryErrors.length > 0 || boundaryHttpErrors.length > 0 || boundaryNetworkErrors.length > 0;
    const releaseFailed = releaseMutationRequests.length > 0 || releaseIntercepts.length > 0;
    const failedIds = [
      ...failedScenarios.map((entry) => entry.id),
      ...(boundaryFailed ? ['bootstrap-or-final-boundary'] : []),
      ...(releaseFailed ? ['release-boundary'] : [])
    ];
    const allLatency = scenarios.flatMap((entry) => entry.latency.samples.map((sample) => sample.milliseconds));
    return {
      ok: failedIds.length === 0,
      runtimeAttestation,
      login,
      scenarios,
      telemetry: {
        requestCount: telemetry.requests.length,
        errorCount: telemetry.events.length,
        dialogCount: telemetry.dialogs.length,
        requests: telemetry.requests,
        errors: telemetry.events,
        dialogs: telemetry.dialogs
      },
      releaseBoundary: {
        releaseRequests,
        releaseMutationRequests,
        readOnlyBootstrapRequests: releaseRequests.filter((request) => !request.releaseMutation),
        interceptedMutationAttempts: releaseIntercepts,
        mutationRequestsAttempted: releaseMutationRequests.length,
        mutationRequestsReachedServer: releaseMutationsReachedServer.length,
        mutationRequestsExecuted: releaseMutationsReachedServer.length > 0,
        note: 'The editor performs a read-only publish/status bootstrap. The runner never opens Publish and fails on every release mutation request or attempt.'
      },
      safety,
      aggregate: {
        checks: scenarios.length + 2,
        scenarios: scenarios.length,
        passed: scenarios.length - failedScenarios.length + (boundaryFailed ? 0 : 1) + (releaseFailed ? 0 : 1),
        failed: failedIds.length,
        failedIds,
        boundary: {
          status: boundaryFailed ? 'fail' : 'pass',
          errors: boundaryErrors,
          httpErrors: boundaryHttpErrors,
          networkErrors: boundaryNetworkErrors
        },
        latencyP95Ms: percentile95(allLatency)
      }
    };
  } finally {
    await browser.close();
  }
}

function cliOptions(argv, cwd) {
  const hasFlag = (name) => argv.includes(name);
  const option = (name, fallback = '') => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
  return {
    help: hasFlag('--help') || hasFlag('-h'),
    headful: hasFlag('--headful'),
    json: hasFlag('--json'),
    requiredResilienceOnly: hasFlag('--required-resilience-only'),
    originRaw: option('--origin', process.env.H6_QA_ADMIN_ORIGIN || ''),
    fixtures: option('--fixtures', process.env.H6_QA_ACCEPTANCE_FIXTURES || ''),
    output: path.resolve(cwd, option('--output', '.admin-runtime/h6-qa/visual-editor-acceptance.json')),
    usernameEnv: option('--username-env', 'H6_QA_ADMIN_USERNAME'),
    passwordEnv: option('--password-env', 'H6_QA_ADMIN_PASSWORD')
  };
}

async function main() {
  const cwd = process.cwd();
  const options = cliOptions(process.argv.slice(2), cwd);
  if (options.help) {
    process.stdout.write([
      'H6 disposable visual-editor browser acceptance',
      '',
      '  H6_QA_ADMIN_USERNAME=<synthetic> H6_QA_ADMIN_PASSWORD=<synthetic> node tools/qa/visual-editor-acceptance.mjs \\',
      '    --origin=http://127.0.0.1:<port> --fixtures=<dir> --output=<report.json>',
      '  Add --required-resilience-only for the bounded two-tab/failure/recovery gate during development.',
      '',
      'The fixture directory must contain 20 real .jpg/.jpeg/.png files and a launcher-issued isolation-proof.json.',
      'Optional visual-editor-acceptance.json schemaVersion 1 may define isolationProof, mediaFiles, pages.product/category/noPhotoProduct,',
      'feedbackBudgetMs, saveBudgetMs, and exactObservationMs. Credentials and session query values are never written to the report.',
      'The runner uses CdpBrowser(admin-no-release), accepts only loopback, and fails on any release mutation request/attempt.',
      ''
    ].join('\n'));
    return;
  }
  const startedAt = new Date().toISOString();
  let report;
  try {
    const origin = parseLoopbackOrigin(options.originRaw);
    options.origin = origin;
    const bundle = await resolveFixtureBundle({ fixtures: options.fixtures, origin, cwd });
    const result = await runAcceptance(options, bundle);
    const runnerSHA256 = crypto.createHash('sha256').update(await readFile(RUNNER_PATH)).digest('hex');
    report = {
      schemaVersion: 1,
      kind: 'h6-visual-editor-browser-acceptance',
      startedAt,
      completedAt: new Date().toISOString(),
      runner: { path: path.relative(cwd, RUNNER_PATH).replace(/\\/gu, '/'), sha256: runnerSHA256, browser: 'CdpBrowser', safetyMode: 'admin-no-release' },
      input: {
        origin,
        executionMode: options.requiredResilienceOnly ? 'required-resilience-only' : 'full',
        fixturesRoot: bundle.fixturesRoot,
        manifestPath: bundle.manifestPath,
        selectors: SELECTORS,
        profile: bundle.profile,
        isolation: bundle.proof,
        syntheticCredentialEnvNames: [options.usernameEnv, options.passwordEnv]
      },
      ...result
    };
  } catch (error) {
    report = {
      schemaVersion: 1,
      kind: 'h6-visual-editor-browser-acceptance',
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      fatal: { name: error?.name || 'Error', message: String(error?.message || error), stack: String(error?.stack || '').split(/\r?\n/u).slice(0, 8) },
      aggregate: { scenarios: 0, passed: 0, failed: 1, failedIds: ['fatal-precondition-or-runner'] }
    };
  }
  await atomicWriteJson(options.output, report);
  const summary = { ok: report.ok === true, output: options.output, aggregate: report.aggregate, releaseMutations: report.releaseBoundary?.releaseMutationRequests?.length || 0 };
  process.stdout.write(`${JSON.stringify(options.json ? report : summary, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();

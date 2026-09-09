import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ANALYTICS_OR_FORM_URL = /(?:mc\.yandex\.ru|metrika|webvisor|google-analytics\.com|googletagmanager\.com|formspree\.io|api\.web3forms\.com)/iu;
const ADMIN_RELEASE_URL = /\/api\/admin\/(?:publish|release|rollback|production)(?=\/|-|$|\?)/iu;
const documentReplacementError = (error) => error?.cdpMethod === 'Runtime.evaluate'
  && /^(?:Execution context was destroyed|Cannot find context with specified id|Inspected target navigated or closed)(?:[. :].*)?$/iu
    .test(String(error.cdpMessage || ''));

export function isAdminReleaseMutationRequest({ method = 'GET', url = '' } = {}) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase()) && ADMIN_RELEASE_URL.test(String(url));
}

const MIME_TYPES = {
  '.avif': 'image/avif', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml', '.webm': 'video/webm',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml; charset=utf-8'
};

const normalizeBase = (value) => {
  const raw = String(value || '/').trim();
  if (!raw || raw === '/') return '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
};

const playwrightChromiumCandidates = () => {
  const directory = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : '';
  if (!directory || !fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith('chromium-'))
    .sort().reverse()
    .flatMap((name) => [
      path.join(directory, name, 'chrome-win64', 'chrome.exe'),
      path.join(directory, name, 'chrome-linux', 'chrome')
    ])
    .filter((filename) => fs.existsSync(filename));
};

const playwrightHeadlessShellCandidates = () => {
  const directory = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : '';
  if (!directory || !fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort().reverse()
    .map((name) => path.join(directory, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'))
    .filter((filename) => fs.existsSync(filename));
};

const chromeCandidates = ({ headful = false } = {}) => process.platform === 'win32'
  ? [
      process.env.CHROME_PATH,
      ...(headful ? [] : playwrightHeadlessShellCandidates()),
      ...playwrightChromiumCandidates(),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ]
  : [process.env.CHROME_PATH, 'google-chrome', 'chromium', 'chromium-browser'];

export const preferredChromePath = (settings = {}) => chromeCandidates(settings).find((candidate) => candidate && (path.isAbsolute(candidate) ? fs.existsSync(candidate) : true));

export async function createDistServer({ distRoot, basePath = '/' }) {
  const normalizedBase = normalizeBase(basePath);
  const requests = [];
  let origin = '';
  const server = createServer(async (request, response) => {
    try {
      const incoming = new URL(request.url || '/', origin || 'http://127.0.0.1/');
      const originalPathname = decodeURIComponent(incoming.pathname);
      if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
        requests.push({ method: request.method, pathname: originalPathname, status: 405, localPathname: '' });
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }).end();
        return;
      }
      const insideConfiguredBase = normalizedBase === '/'
        || originalPathname === normalizedBase
        || originalPathname.startsWith(`${normalizedBase}/`);
      if (!insideConfiguredBase) {
        requests.push({ method: request.method, pathname: originalPathname, status: 404, localPathname: '' });
        response.writeHead(404, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
          .end(request.method === 'HEAD' ? undefined : 'Outside configured BASE_PATH');
        return;
      }
      const pathname = normalizedBase !== '/' && (originalPathname === normalizedBase || originalPathname.startsWith(`${normalizedBase}/`))
        ? originalPathname.slice(normalizedBase.length) || '/'
        : originalPathname;
      let filename = pathname === '/404.html'
        ? path.join(distRoot, '404.html')
        : path.resolve(distRoot, `.${pathname}`);
      if (filename !== distRoot && !filename.startsWith(`${distRoot}${path.sep}`)) {
        requests.push({ method: request.method, pathname: originalPathname, status: 403, localPathname: pathname });
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
        requests.push({ method: request.method, pathname: originalPathname, status: 404, localPathname: pathname });
        response.writeHead(404, {
          'cache-control': 'no-store',
          'content-length': String(fallback.length),
          'content-type': 'text/html; charset=utf-8',
          'x-h6-route-passport': 'unknown-route'
        }).end(request.method === 'HEAD' ? undefined : fallback);
        return;
      }
      requests.push({ method: request.method, pathname: originalPathname, status: 200, localPathname: pathname });
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': String(info.size),
        'content-type': MIME_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream'
      });
      response.end(request.method === 'HEAD' ? undefined : await readFile(filename));
    } catch (error) {
      requests.push({ method: request.method, pathname: request.url || '', status: 500, error: String(error) });
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      origin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
  return {
    origin,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

export class CdpBrowser {
  constructor({ chromePath, headful = false, safetyMode = 'public-read-only', commandTimeoutMs = 30_000 } = {}) {
    this.chromePath = chromePath || preferredChromePath({ headful });
    this.headful = headful;
    this.safetyMode = safetyMode;
    this.commandTimeoutMs = commandTimeoutMs;
    this.safetyIntercepts = [];
    this.navigationDialogs = [];
    this.activeDialogContext = null;
    this.backgroundDialogTasks = [];
    this.backgroundDialogFailures = [];
    this.child = null;
    this.profileDir = '';
    this.debugPort = 0;
    this.socket = null;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async start() {
    if (!this.chromePath) throw new Error('Chrome was not found. Set CHROME_PATH to a Chromium-compatible browser.');
    this.profileDir = await mkdtemp(path.join(os.tmpdir(), 'smu1-h6-cdp-'));
    this.child = spawn(this.chromePath, [
      ...(this.headful ? [] : [this.chromePath.includes('headless-shell') ? '--headless' : '--headless=new']),
      '--disable-extensions', '--disable-component-extensions-with-background-pages', '--no-first-run',
      '--no-default-browser-check', '--remote-allow-origins=*', '--autoplay-policy=no-user-gesture-required',
      '--remote-debugging-port=0', `--user-data-dir=${this.profileDir}`, '--window-size=1440,900', 'about:blank'
    ], { stdio: 'ignore', windowsHide: true });
    const deadline = Date.now() + 30_000;
    let debuggerUrl = '';
    const activePortFilename = path.join(this.profileDir, 'DevToolsActivePort');
    while (Date.now() < deadline && !debuggerUrl) {
      if (this.child.exitCode !== null) throw new Error(`Chrome exited before DevTools was ready (${this.child.exitCode}).`);
      if (!this.debugPort) {
        const activePort = await readFile(activePortFilename, 'utf8').catch(() => '');
        const [portLine = '', browserSocketPath = ''] = activePort.trim().split(/\r?\n/u);
        const assignedPort = Number(portLine);
        if (Number.isInteger(assignedPort) && assignedPort > 0 && assignedPort <= 65_535
          && /^\/devtools\/browser\/[a-z0-9-]+$/iu.test(browserSocketPath)) {
          this.debugPort = assignedPort;
        }
      }
      try {
        const response = this.debugPort
          ? await fetch(`http://127.0.0.1:${this.debugPort}/json/list`)
          : null;
        const pages = response.ok ? await response.json() : [];
        debuggerUrl = pages.find((item) => item.type === 'page')?.webSocketDebuggerUrl || '';
      } catch {}
      if (!debuggerUrl) await delay(100);
    }
    if (!debuggerUrl) throw new Error('Chrome DevTools endpoint did not become ready.');
    this.socket = new WebSocket(debuggerUrl);
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
        if (message.error) pending.reject(Object.assign(
          new Error(`Chrome DevTools ${pending.method} failed: ${message.error.message}`),
          { name: 'CdpProtocolError', cdpMethod: pending.method, cdpCode: message.error.code, cdpMessage: message.error.message }
        ));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
    this.socket.addEventListener('close', () => {
      for (const [id, pending] of this.pending) {
        this.pending.delete(id);
        pending.reject(new Error('Chrome DevTools connection closed before the command completed.'));
      }
    });
    await Promise.all([
      this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable'), this.send('Log.enable')
    ]);
    this.on('Page.javascriptDialogOpening', (dialog) => {
      const context = this.activeDialogContext;
      const type = String(dialog?.type || 'unknown');
      const accepted = Boolean(context && type === 'beforeunload' && context.beforeUnloadPolicy === 'accept-qa-reset');
      this.navigationDialogs.push({
        type,
        accepted,
        reason: accepted ? 'qa-baseline-reset' : 'unexpected-navigation-dialog'
      });
      const failure = accepted ? null : new Error(`Unexpected JavaScript ${type} dialog blocked navigation.`);
      if (context && failure && !context.failure) context.failure = failure;
      else if (!context && failure) this.backgroundDialogFailures.push(failure);
      const task = this.send('Page.handleJavaScriptDialog', { accept: accepted }).catch((error) => {
        if (context && !context.failure) context.failure = error;
        else if (!context) this.backgroundDialogFailures.push(error);
      });
      if (context) context.tasks.push(task);
      else this.backgroundDialogTasks.push(task);
    });
    await this.send('Network.setBlockedURLs', { urls: [
      '*mc.yandex.ru*', '*google-analytics.com*', '*googletagmanager.com*', '*formspree.io*', '*api.web3forms.com*'
    ] });
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    this.on('Fetch.requestPaused', ({ requestId, request }) => {
      const method = String(request?.method || 'GET').toUpperCase();
      const url = String(request?.url || '');
      const analyticsOrForm = ANALYTICS_OR_FORM_URL.test(url);
      const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      const adminRelease = isAdminReleaseMutationRequest({ method, url });
      const block = this.safetyMode === 'public-read-only'
        ? analyticsOrForm || stateChanging
        : this.safetyMode === 'admin-no-release'
          ? analyticsOrForm || adminRelease
          : analyticsOrForm;
      if (block) {
        this.safetyIntercepts.push({ method, url, reason: analyticsOrForm ? 'analytics-or-form' : adminRelease ? 'admin-release' : 'state-changing-request' });
        this.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      } else {
        this.send('Fetch.continueRequest', { requestId }).catch(() => {});
      }
    });
    await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const originalBeacon = navigator.sendBeacon?.bind(navigator);
        if (originalBeacon) Object.defineProperty(navigator, 'sendBeacon', {
          configurable: true,
          value(url, data) {
            const target = String(url || '');
            if (/analytics|metrika|mc\\.yandex|webvisor/iu.test(target)) return true;
            return originalBeacon(url, data);
          }
        });
      })();`
    });
    return this;
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), listener]);
    return () => this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
  }

  safetyEvidence() {
    return {
      mode: this.safetyMode,
      analyticsAndFormPattern: ANALYTICS_OR_FORM_URL.source,
      adminReleasePattern: ADMIN_RELEASE_URL.source,
      intercepted: this.safetyIntercepts.slice(),
      navigationDialogs: this.navigationDialogs.slice()
    };
  }

  send(method, params = {}, { timeoutMs = this.commandTimeoutMs } = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(id);
        callback(value);
      };
      this.pending.set(id, {
        method,
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error)
      });
      timer = setTimeout(() => {
        const pending = this.pending.get(id);
        pending?.reject(new Error(`Timed out waiting for Chrome DevTools command ${method}.`));
      }, Math.max(1, Number(timeoutMs) || this.commandTimeoutMs));
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.get(id)?.reject(error);
      }
    });
  }

  waitForEvent(method, timeoutMs = 20_000) {
    let cancel = () => {};
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        remove();
        callback(value);
      };
      const remove = this.on(method, (params) => {
        finish(resolve, params);
      });
      const timeout = setTimeout(() => {
        finish(reject, new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      cancel = () => finish(resolve, null);
    });
    return { promise, cancel: () => cancel() };
  }

  once(method, timeoutMs = 20_000) {
    return this.waitForEvent(method, timeoutMs).promise;
  }

  async drainBackgroundDialogs() {
    while (this.backgroundDialogTasks.length) {
      const tasks = this.backgroundDialogTasks.splice(0);
      await Promise.all(tasks);
      await delay(0);
    }
    const failures = this.backgroundDialogFailures.splice(0);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Multiple unexpected background JavaScript dialogs were observed.');
  }

  async evaluate(expression, { awaitPromise = true, timeoutMs = this.commandTimeoutMs } = {}) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true }, { timeoutMs });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime evaluation failed.');
    }
    return response.result?.value;
  }

  async setViewport({ width, height, mobile = false }) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height,
      positionX: 0, positionY: 0, dontSetVisibleSize: false
    });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  }

  async emulateMedia({ reducedMotion = false, colorScheme = 'light' } = {}) {
    await this.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
      { name: 'prefers-color-scheme', value: colorScheme }
    ] });
  }

  async navigate(url, {
    waitAfterMs = 40,
    scriptExecutionDisabled = false,
    waitForFonts = true,
    beforeUnloadPolicy = 'fail'
  } = {}) {
    if (!['fail', 'accept-qa-reset'].includes(beforeUnloadPolicy)) {
      throw new Error(`Unsupported beforeUnloadPolicy: ${beforeUnloadPolicy}`);
    }
    if (this.activeDialogContext) throw new Error('Concurrent CDP navigation is not supported.');
    await this.drainBackgroundDialogs();
    const dialogContext = { beforeUnloadPolicy, tasks: [], failure: null };
    this.activeDialogContext = dialogContext;
    const readyWaiter = this.waitForEvent('Page.domContentEventFired', 20_000);
    const ready = readyWaiter.promise.catch(() => null);
    let navigation = null;
    let navigationFailure = null;
    const diagnostics = { requestedUrl: url, phase: 'navigate', readinessAttempts: 0, replacements: [], finalUrl: '' };
    this.lastNavigation = diagnostics;
    try {
      navigation = await this.send('Page.navigate', { url });
      await Promise.all(dialogContext.tasks);
      if (dialogContext.failure) throw dialogContext.failure;
      if (navigation.errorText) throw new Error(`Navigation failed for ${url}: ${navigation.errorText}`);
      await ready;
      diagnostics.phase = 'document-readiness';
      const deadline = Date.now() + 5_000;
      let settled = false;
      while (Date.now() < deadline) {
        diagnostics.readinessAttempts += 1;
        const remaining = () => Math.max(1, deadline - Date.now());
        try {
          const before = (await this.send('Page.getFrameTree', {}, { timeoutMs: remaining() })).frameTree.frame;
          diagnostics.finalUrl = before.url;
          const documentReady = await this.evaluate("document.readyState !== 'loading'", {
            awaitPromise: !scriptExecutionDisabled, timeoutMs: remaining()
          });
          if (!documentReady) { await delay(40); continue; }
          if (!scriptExecutionDisabled) {
            await this.evaluate(`(async () => {
              if (${waitForFonts ? 'true' : 'false'} && document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 900))]);
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              return true;
            })()`, { timeoutMs: remaining() });
          }
          if (waitAfterMs) await delay(Math.min(waitAfterMs, remaining()));
          const after = (await this.send('Page.getFrameTree', {}, { timeoutMs: remaining() })).frameTree.frame;
          diagnostics.finalUrl = after.url;
          if (before.loaderId !== after.loaderId) {
            diagnostics.replacements.push({ reason: 'main-frame-loader-changed', from: before.url, to: after.url });
            continue;
          }
          settled = true;
          break;
        } catch (error) {
          // Only repeat our read-only document/font readiness after a redirect.
          // Never replay a caller's evaluate/click or swallow a JavaScript error.
          if (!documentReplacementError(error)) throw error;
          // A genuinely closed target also uses this CDP error text; this
          // context-independent command must still succeed before we retry.
          const frame = (await this.send('Page.getFrameTree', {}, { timeoutMs: remaining() })).frameTree.frame;
          diagnostics.finalUrl = frame.url;
          diagnostics.replacements.push({ reason: error.cdpMessage, url: frame.url });
          await delay(Math.min(40, remaining()));
        }
      }
      if (!settled) throw new Error(`Document readiness did not settle within 5000ms for ${url}.`);
      diagnostics.phase = 'settled';
    } catch (error) {
      navigationFailure = error;
    } finally {
      await this.send('Page.getFrameTree', {}, { timeoutMs: 1_500 }).catch((error) => {
        if (!navigationFailure && !dialogContext.failure) navigationFailure = error;
      });
      await delay(0);
      this.activeDialogContext = null;
      readyWaiter.cancel();
      await ready;
      await Promise.all(dialogContext.tasks);
      await this.drainBackgroundDialogs().catch((error) => {
        if (!navigationFailure && !dialogContext.failure) navigationFailure = error;
      });
    }
    if (dialogContext.failure) throw dialogContext.failure;
    if (navigationFailure) {
      navigationFailure.navigation = diagnostics;
      navigationFailure.message += ` [navigation ${JSON.stringify(diagnostics)}]`;
      throw navigationFailure;
    }
    return navigation;
  }

  async dispatchKey(key, { code = key, modifiers = 0 } = {}) {
    const keyCode = ({ Enter: 13, Escape: 27, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35 })[key] || 0;
    const payload = { key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    const textValue = key === 'Enter' ? '\r' : key === ' ' ? ' ' : '';
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...payload,
      ...(textValue ? { text: textValue, unmodifiedText: textValue } : {})
    });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...payload });
  }

  async dispatchClick({ x, y, button = 'left' }) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
  }

  async close() {
    try { if (this.socket?.readyState < WebSocket.CLOSING) this.socket.close(); } catch {}
    if (this.child?.exitCode === null) {
      const exited = new Promise((resolve) => {
        const timeout = setTimeout(resolve, 5_000);
        this.child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      if (process.platform === 'win32') {
        const { execFile } = await import('node:child_process');
        await new Promise((resolve) => execFile('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true }, resolve));
      } else {
        this.child.kill('SIGTERM');
      }
      await exited;
    }
    if (this.profileDir) await rm(this.profileDir, {
      recursive: true, force: true, maxRetries: 5, retryDelay: 100
    }).catch(() => {});
  }
}

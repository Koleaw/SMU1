import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ADMIN_ENV_FILE, isForbiddenLocalGitHubCredentialKey, loadAdminConfig } from './config.mjs';
import { resolveAstroCli } from './astro-cli.mjs';
import {
  createAdminHealthIdentity,
  createAdminRepoIdentity,
  createAdminShutdownMessage,
  createAdminUiHealthMarker,
  createSafeNodeChildEnvironment
} from './runtime-identity.mjs';
import { redactText } from './security.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..', '..');
const SESSION_FILE_NAME = 'admin-launcher-session.json';
const PORT_PREFERENCE_FILE_NAME = 'admin-launcher-ports.json';

export class AdminLauncherError extends Error {
  constructor(message, { code = 'ADMIN_LAUNCHER_ERROR', details } = {}) {
    super(message);
    this.name = 'AdminLauncherError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export async function resolveLauncherAstroCli(repoRoot) {
  try {
    return await resolveAstroCli(repoRoot);
  } catch (error) {
    throw new AdminLauncherError(
      'Зависимости не установлены или повреждены. Павлу нужно один раз выполнить npm ci.',
      { code: 'DEPENDENCIES_MISSING', details: { reason: error?.code || 'ASTRO_CLI_UNAVAILABLE' } }
    );
  }
}

const LAUNCHER_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);
const UI_PARENT_IDENTITY_ENV = 'SMU1_ADMIN_LAUNCHER_REPO_IDENTITY';
const UI_PARENT_BOOTSTRAP = [
  "import { pathToFileURL } from 'node:url';",
  `const expectedRepoIdentity = String(process.env.${UI_PARENT_IDENTITY_ENV} || '');`,
  "if (!/^[a-f0-9]{64}$/u.test(expectedRepoIdentity)) process.exit(1);",
  'let exiting = false;',
  'const finish = (code) => { if (exiting) return; exiting = true; process.exit(code); };',
  "process.once('disconnect', () => finish(1));",
  `process.on('message', (message) => { if (message && message.type === 'smu1-admin-runtime-shutdown' && message.version === 1 && message.repoIdentity === expectedRepoIdentity) finish(0); });`,
  'await import(pathToFileURL(process.argv[1]).href);'
].join('\n');

export function createParentBoundNodeArgs(entryPoint, args = []) {
  return Object.freeze([
    '--input-type=module',
    '--eval',
    UI_PARENT_BOOTSTRAP,
    path.resolve(entryPoint),
    ...args.map(String)
  ]);
}

export function installLauncherSignalHandlers(stop, options = {}) {
  if (typeof stop !== 'function') throw new TypeError('Launcher stop callback is required.');
  const processRef = options.processRef || process;
  let triggered = false;
  const cleanup = () => {
    for (const signal of LAUNCHER_SIGNALS) processRef.off(signal, handler);
  };
  const handler = () => {
    if (triggered) return;
    triggered = true;
    cleanup();
    void Promise.resolve().then(stop).then(
      () => { processRef.exitCode = 0; },
      () => { processRef.exitCode = 1; }
    );
  };
  for (const signal of LAUNCHER_SIGNALS) processRef.once(signal, handler);
  return cleanup;
}

export async function settleAdminSession(initial, options = {}) {
  let state = { ui: Boolean(initial?.ui), api: Boolean(initial?.api) };
  if (!state.ui && !state.api) return Object.freeze({ state: 'empty', ...state });
  const probe = options.probe;
  if (typeof probe !== 'function') throw new TypeError('Admin session probe callback is required.');
  const settleMs = options.settleMs ?? 1_200;
  const healthyConfirmMs = options.healthyConfirmMs ?? 250;
  const intervalMs = options.intervalMs ?? 100;
  const now = options.now || Date.now;
  const delay = options.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  let healthySince = state.ui && state.api ? startedAt : null;

  while (now() - startedAt < settleMs) {
    await delay(intervalMs);
    state = await probe();
    state = { ui: Boolean(state?.ui), api: Boolean(state?.api) };
    if (!state.ui && !state.api) return Object.freeze({ state: 'empty', ...state });
    if (state.ui && state.api) {
      if (healthySince === null) healthySince = now();
      if (now() - healthySince >= healthyConfirmMs) return Object.freeze({ state: 'existing', ...state });
    } else {
      healthySince = null;
    }
  }
  return Object.freeze({ state: state.ui && state.api ? 'existing' : 'partial', ...state });
}

function parseArguments(argv) {
  const options = { open: false, owner: false };
  for (const argument of argv) {
    if (argument === '--open') options.open = true;
    else if (argument === '--owner') options.owner = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new AdminLauncherError(`Неизвестный аргумент: ${argument}`, { code: 'LAUNCH_ARGUMENT_INVALID' });
  }
  return options;
}

async function assertFile(filePath, code, message) {
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new AdminLauncherError(message, { code });
    throw error;
  }
}

function git(repoRoot, args) {
  return spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function assertBranch(repoRoot, expectedBranch) {
  if (!expectedBranch) return;
  const result = git(repoRoot, ['branch', '--show-current']);
  const actual = result.status === 0 ? result.stdout.trim() : '';
  if (!actual || actual !== expectedBranch) {
    throw new AdminLauncherError(
      `Открыта ветка «${actual || 'detached HEAD'}», а настроена «${expectedBranch}». Запуск остановлен.`,
      { code: 'BRANCH_MISMATCH', details: { expectedBranch, actualBranch: actual } }
    );
  }
}

export async function checkPortAvailable(host, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findAvailablePort(host, { exclude = new Set() } = {}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen({ host, port: 0, exclusive: true }, () => {
        const address = server.address();
        const selected = address && typeof address === 'object' ? address.port : 0;
        server.close((error) => error ? reject(error) : resolve(selected));
      });
    });
    if (Number.isSafeInteger(port) && port >= 1024 && port <= 65535 && !exclude.has(port)) return port;
  }
  throw new AdminLauncherError('Не удалось безопасно выбрать свободный локальный порт.', { code: 'RANDOM_PORT_UNAVAILABLE' });
}

function isRuntimePort(value) {
  return Number.isSafeInteger(value) && value >= 1024 && value <= 65535;
}

function normalizePortPreference(payload, { repoIdentity, apiHost, uiHost }) {
  if (payload?.version !== 1
    || payload?.repoIdentity !== repoIdentity
    || payload?.apiHost !== apiHost
    || payload?.uiHost !== uiHost
    || !isRuntimePort(payload?.apiPort)
    || !isRuntimePort(payload?.uiPort)
    || payload.apiPort === payload.uiPort) return null;
  return Object.freeze({ apiPort: payload.apiPort, uiPort: payload.uiPort });
}

function portPreferenceFilePath(repoRoot) {
  return path.join(repoRoot, '.admin-runtime', PORT_PREFERENCE_FILE_NAME);
}

export async function readPreferredRuntimePorts(repoRoot, identity) {
  try {
    const payload = JSON.parse(await fs.readFile(portPreferenceFilePath(repoRoot), 'utf8'));
    return normalizePortPreference(payload, identity);
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writePreferredRuntimePorts(repoRoot, identity, ports) {
  const normalized = normalizePortPreference({ version: 1, ...identity, ...ports }, identity);
  if (!normalized) throw new TypeError('Preferred admin runtime ports are invalid.');
  const runtimeDir = path.join(repoRoot, '.admin-runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  const filePath = portPreferenceFilePath(repoRoot);
  const tempPath = path.join(runtimeDir, `.${PORT_PREFERENCE_FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
  const payload = {
    version: 1,
    repoIdentity: identity.repoIdentity,
    apiHost: identity.apiHost,
    uiHost: identity.uiHost,
    apiPort: normalized.apiPort,
    uiPort: normalized.uiPort,
    updatedAt: new Date().toISOString()
  };
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600
    });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch((cleanupError) => {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }
  return normalized;
}

export async function selectRuntimePorts(identity, options = {}) {
  const preferred = normalizePortPreference({ version: 1, ...identity, ...options.preferred }, identity);
  const checkAvailable = options.checkAvailable || checkPortAvailable;
  const findPort = options.findPort || findAvailablePort;
  const [preferredUiAvailable, preferredApiAvailable] = preferred
    ? await Promise.all([
        checkAvailable(identity.uiHost, preferred.uiPort),
        checkAvailable(identity.apiHost, preferred.apiPort)
      ])
    : [false, false];

  const uiExcluded = new Set(preferredApiAvailable ? [preferred.apiPort] : []);
  const uiPort = preferredUiAvailable
    ? preferred.uiPort
    : await findPort(identity.uiHost, { exclude: uiExcluded });
  const apiPort = preferredApiAvailable && preferred.apiPort !== uiPort
    ? preferred.apiPort
    : await findPort(identity.apiHost, { exclude: new Set([uiPort]) });
  if (!isRuntimePort(apiPort) || !isRuntimePort(uiPort) || apiPort === uiPort) {
    throw new AdminLauncherError('Не удалось безопасно выбрать разные локальные порты.', {
      code: 'RANDOM_PORT_UNAVAILABLE'
    });
  }
  return Object.freeze({ apiPort, uiPort });
}

function sessionFilePath(repoRoot) {
  return path.join(repoRoot, '.admin-runtime', SESSION_FILE_NAME);
}

async function readRuntimeSession(repoRoot, repoIdentity) {
  try {
    const payload = JSON.parse(await fs.readFile(sessionFilePath(repoRoot), 'utf8'));
    if (payload?.version !== 1 || payload?.repoIdentity !== repoIdentity
      || !isRuntimePort(payload?.apiPort) || !isRuntimePort(payload?.uiPort)
      || payload.apiPort === payload.uiPort) return null;
    return payload;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeRuntimeSession(repoRoot, payload) {
  const runtimeDir = path.join(repoRoot, '.admin-runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  const filePath = sessionFilePath(repoRoot);
  const tempPath = path.join(runtimeDir, `.${SESSION_FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

async function removeRuntimeSession(repoRoot, repoIdentity) {
  const filePath = sessionFilePath(repoRoot);
  const current = await readRuntimeSession(repoRoot, repoIdentity).catch(() => null);
  if (!current || current.repoIdentity !== repoIdentity) return;
  await fs.unlink(filePath).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
}

export async function probeHttp(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const service = String(options.service || '').toLowerCase();
  let expectedIdentity;
  let expectedUiMarker;
  try {
    expectedIdentity = createAdminHealthIdentity(service, options.repoIdentity);
    expectedUiMarker = service === 'ui' ? createAdminUiHealthMarker(options.repoIdentity) : '';
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      finish(false);
      return;
    }
    if (parsed.protocol !== 'http:') {
      finish(false);
      return;
    }
    const request = http.get(parsed, {
      headers: {
        Host: parsed.host,
        Accept: service === 'api' ? 'application/json' : 'text/html'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        finish(false);
        return;
      }
      const responseContentType = String(response.headers['content-type'] || '').toLowerCase();
      if ((service === 'api' && !responseContentType.includes('application/json'))
        || (service === 'ui' && !responseContentType.includes('text/html'))) {
        response.resume();
        finish(false);
        return;
      }
      const chunks = [];
      let length = 0;
      const maxBytes = service === 'api' ? 64 * 1024 : 1024 * 1024;
      response.on('data', (chunk) => {
        length += chunk.length;
        if (length > maxBytes) {
          response.destroy();
          finish(false);
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', () => finish(false));
      response.once('end', () => {
        if (settled) return;
        const body = Buffer.concat(chunks).toString('utf8');
        if (service === 'api') {
          let payload;
          try { payload = JSON.parse(body); }
          catch { finish(false); return; }
          finish(Boolean(payload && typeof payload === 'object'
            && payload.kind === expectedIdentity.kind
            && payload.version === expectedIdentity.version
            && payload.service === expectedIdentity.service
            && payload.repoIdentity === expectedIdentity.repoIdentity));
          return;
        }
        const exactMarker = `<meta name="smu1-admin-health" content="${expectedUiMarker}">`;
        finish(body.includes(exactMarker));
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Admin health probe timed out.')));
    request.once('error', () => finish(false));
  });
}

export async function waitForHttp(url, child, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 200;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new AdminLauncherError(`Процесс завершился до готовности (${child.exitCode}).`, {
        code: 'PROCESS_EARLY_EXIT'
      });
    }
    if (await probeHttp(url, { ...options, timeoutMs: Math.min(1_000, intervalMs * 4) })) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new AdminLauncherError(`Сервис не стал доступен вовремя: ${url}`, { code: 'HEALTH_TIMEOUT' });
}

function openBrowser(url) {
  const commands = process.platform === 'win32'
    ? [['cmd.exe', ['/d', '/s', '/c', 'start', '', url]]]
    : process.platform === 'darwin'
      ? [['open', [url]]]
      : [['xdg-open', [url]]];
  const [command, args] = commands[0];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function hostForUrl(host) {
  return host === '::1' ? '[::1]' : host;
}

export function createChildEnvironments(raw, config, options = {}) {
  const sourceEnvironment = options.environment || process.env;
  const repoIdentity = options.repoIdentity || createAdminRepoIdentity(options.repoRoot || DEFAULT_REPO_ROOT);
  const api = {
    ...sourceEnvironment,
    ...raw,
    ADMIN_API_HOST: config.ADMIN_API_HOST,
    ADMIN_API_PORT: String(config.ADMIN_API_PORT),
    ADMIN_UI_HOST: config.ADMIN_UI_HOST,
    ADMIN_UI_PORT: String(config.ADMIN_UI_PORT),
    ADMIN_ALLOWED_ORIGINS: `http://${hostForUrl(config.ADMIN_UI_HOST)}:${config.ADMIN_UI_PORT}`,
    CONTENT_WRITE_MODE: 'local',
    PUBLIC_ADMIN_API_BASE: config.PUBLIC_ADMIN_API_BASE
  };
  for (const key of Object.keys(api)) {
    if (isForbiddenLocalGitHubCredentialKey(key)) delete api[key];
  }
  const ui = {
    ...createSafeNodeChildEnvironment(sourceEnvironment),
    NODE_ENV: 'development',
    CI: 'false',
    DEPLOY_TARGET: 'development',
    REQUIRE_SITE_URL: 'false',
    PRODUCTION_DEPLOY_ENABLED: 'false',
    BASE_PATH: '/',
    TEST_SITE_URL: `http://${hostForUrl(config.ADMIN_UI_HOST)}:${config.ADMIN_UI_PORT}`,
    ADMIN_API_HOST: config.ADMIN_API_HOST,
    ADMIN_API_PORT: String(config.ADMIN_API_PORT),
    ADMIN_UI_HOST: config.ADMIN_UI_HOST,
    ADMIN_UI_PORT: String(config.ADMIN_UI_PORT),
    PUBLIC_ADMIN_API_BASE: config.PUBLIC_ADMIN_API_BASE,
    PUBLIC_ADMIN_HEALTH_MARKER: createAdminUiHealthMarker(repoIdentity),
    SMU1_LOCAL_ADMIN: 'true',
    [UI_PARENT_IDENTITY_ENV]: repoIdentity,
    // Astro 7 auto-daemonizes when it detects an agent environment. The
    // editor owns this child and must observe/stop it directly, so force the
    // foreground code path; --ignore-lock below keeps lifecycle ownership in
    // this launcher instead of Astro's workspace-global lock file.
    ASTRO_DEV_BACKGROUND: 'foreground-parent-bound',
    ASTRO_TELEMETRY_DISABLED: '1'
  };
  return Object.freeze({ api: Object.freeze(api), ui: Object.freeze(ui) });
}

function spawnService(command, args, options) {
  return spawn(command, args, {
    cwd: options.repoRoot,
    env: options.env,
    stdio: options.ipc ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
    windowsHide: true,
    shell: false
  });
}

export function createAdminUiAstroArgs(astroCli, config) {
  return createParentBoundNodeArgs(astroCli, [
    'dev',
    '--ignore-lock',
    '--host', config.ADMIN_UI_HOST,
    '--port', String(config.ADMIN_UI_PORT)
  ]);
}

function childHasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

export async function waitForChildExit(child, timeoutMs = 5_000) {
  if (childHasExited(child)) return true;
  return new Promise((resolve) => {
    let timer;
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
    if (childHasExited(child)) {
      child.off('exit', onExit);
      resolve(true);
      return;
    }
    timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(childHasExited(child));
    }, timeoutMs);
  });
}

function forceKillWindows(child) {
  return spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
    windowsHide: true,
    stdio: 'ignore'
  });
}

export async function stopChild(child, options = {}) {
  if (childHasExited(child)) return Object.freeze({ exited: true, forced: false });
  const role = options.role || 'service';
  const platform = options.platform || process.platform;
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 6_500;
  const forceExitTimeoutMs = options.forceExitTimeoutMs ?? 5_000;
  let forced = false;

  if (child.connected && typeof child.send === 'function') {
    try { child.send(createAdminShutdownMessage(options.repoIdentity), () => {}); }
    catch { /* force fallback below */ }
    if (await waitForChildExit(child, gracefulTimeoutMs)) {
      return Object.freeze({ exited: true, forced: false });
    }
  }

  if (platform !== 'win32') {
    try { child.kill('SIGTERM'); } catch { /* force fallback below */ }
    if (await waitForChildExit(child, options.signalTimeoutMs ?? 2_000)) {
      return Object.freeze({ exited: true, forced: false });
    }
    forced = true;
    try { child.kill('SIGKILL'); } catch { /* checked below */ }
  } else {
    forced = true;
    const forceKill = options.forceKillWindows || forceKillWindows;
    if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
      throw new AdminLauncherError('Не удалось безопасно определить PID процесса для остановки.', { code: 'PROCESS_PID_INVALID' });
    }
    forceKill(child);
  }

  if (!await waitForChildExit(child, forceExitTimeoutMs)) {
    throw new AdminLauncherError(
      `Не удалось подтвердить остановку процесса ${role}.`,
      { code: 'PROCESS_STOP_UNCONFIRMED', details: { role, pid: child.pid } }
    );
  }
  return Object.freeze({ exited: true, forced });
}

function printHelp() {
  process.stdout.write([
    'Единый launcher локальной админки СМУ-1',
    '',
    '  node tools/admin-api/launcher.mjs',
    '  node tools/admin-api/launcher.mjs --open',
    '  node tools/admin-api/launcher.mjs --owner --open',
    '',
    '--open открывает единственный local URL после health checks.',
    '--owner при уже запущенной healthy сессии только открывает её.',
    ''
  ].join('\n'));
}

export async function runAdminLauncher(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  await assertFile(path.join(repoRoot, 'package.json'), 'CHECKOUT_INVALID', 'Не найден package.json настроенного checkout.');
  await assertFile(path.join(repoRoot, ADMIN_ENV_FILE), 'ADMIN_SETUP_REQUIRED', 'Не выполнен setup. Сначала запустите npm run admin:setup.');
  const astroCli = await resolveLauncherAstroCli(repoRoot);
  const loaded = await loadAdminConfig({ repoRoot });
  const configured = loaded.config;
  assertBranch(repoRoot, configured.ADMIN_EXPECTED_BRANCH);
  const repoIdentity = createAdminRepoIdentity(repoRoot);

  const savedSession = await readRuntimeSession(repoRoot, repoIdentity);
  if (savedSession) {
    const savedAdminUrl = `http://${hostForUrl(configured.ADMIN_UI_HOST)}:${savedSession.uiPort}/admin/`;
    const savedApiHealthUrl = `http://${hostForUrl(configured.ADMIN_API_HOST)}:${savedSession.apiPort}/api/admin/health`;
    const [ui, api] = await Promise.all([
      probeHttp(savedAdminUrl, { service: 'ui', repoIdentity }),
      probeHttp(savedApiHealthUrl, { service: 'api', repoIdentity })
    ]);
    if (ui && api) {
      if (options.open === true) openBrowser(savedAdminUrl);
      process.stdout.write(`Админка уже запущена: ${savedAdminUrl}\n`);
      return { existing: true, adminUrl: savedAdminUrl, stop: async () => {} };
    }
    if (ui || api) {
      throw new AdminLauncherError('Найдена незавершённая локальная сессия. Закройте старое окно и повторите.', {
        code: 'PARTIAL_SESSION_DETECTED'
      });
    }
    await removeRuntimeSession(repoRoot, repoIdentity);
  }

  const fixedPorts = options.fixedPorts === true || loaded.raw.ADMIN_FIXED_PORTS === 'true';
  const runtimeIdentity = Object.freeze({
    repoIdentity,
    apiHost: configured.ADMIN_API_HOST,
    uiHost: configured.ADMIN_UI_HOST
  });
  const preferredPorts = fixedPorts
    ? null
    : await readPreferredRuntimePorts(repoRoot, runtimeIdentity)
      || (savedSession ? { apiPort: savedSession.apiPort, uiPort: savedSession.uiPort } : null);
  const runtimePorts = fixedPorts
    ? { apiPort: configured.ADMIN_API_PORT, uiPort: configured.ADMIN_UI_PORT }
    : await selectRuntimePorts(runtimeIdentity, { preferred: preferredPorts });
  const config = Object.freeze({
    ...configured,
    ADMIN_API_PORT: runtimePorts.apiPort,
    ADMIN_UI_PORT: runtimePorts.uiPort,
    ADMIN_ALLOWED_ORIGINS: Object.freeze([
      `http://${hostForUrl(configured.ADMIN_UI_HOST)}:${runtimePorts.uiPort}`.toLowerCase()
    ])
  });
  const raw = {
    ...loaded.raw,
    ADMIN_API_PORT: String(runtimePorts.apiPort),
    ADMIN_UI_PORT: String(runtimePorts.uiPort),
    ADMIN_ALLOWED_ORIGINS: `http://${hostForUrl(configured.ADMIN_UI_HOST)}:${runtimePorts.uiPort}`
  };

  const adminUrl = `http://${hostForUrl(config.ADMIN_UI_HOST)}:${config.ADMIN_UI_PORT}/admin/`;
  const apiHealthUrl = `http://${hostForUrl(config.ADMIN_API_HOST)}:${config.ADMIN_API_PORT}/api/admin/health`;
  const probeSession = async () => {
    const [ui, api] = await Promise.all([
      probeHttp(adminUrl, { service: 'ui', repoIdentity }),
      probeHttp(apiHealthUrl, { service: 'api', repoIdentity })
    ]);
    return { ui, api };
  };
  const initialSession = await probeSession();
  const session = await settleAdminSession(initialSession, {
    probe: probeSession,
    settleMs: options.partialSessionSettleMs,
    healthyConfirmMs: options.healthySessionConfirmMs,
    intervalMs: options.sessionProbeIntervalMs
  });
  if (session.state === 'existing') {
    if (options.open === true) openBrowser(adminUrl);
    process.stdout.write(`Админка уже запущена: ${adminUrl}\n`);
    return { existing: true, adminUrl, stop: async () => {} };
  }
  if (session.state === 'partial') {
    throw new AdminLauncherError('Один из портов занят посторонним/устаревшим процессом. Закройте старое окно и повторите.', {
      code: 'PARTIAL_SESSION_DETECTED'
    });
  }

  const [apiAvailable, uiAvailable] = await Promise.all([
    checkPortAvailable(config.ADMIN_API_HOST, config.ADMIN_API_PORT),
    checkPortAvailable(config.ADMIN_UI_HOST, config.ADMIN_UI_PORT)
  ]);
  if (!apiAvailable || !uiAvailable) {
    throw new AdminLauncherError(
      `Порт занят: ${!uiAvailable ? config.ADMIN_UI_PORT : config.ADMIN_API_PORT}. Закройте использующее его приложение.`,
      { code: 'PORT_IN_USE' }
    );
  }

  const environments = createChildEnvironments(raw, config, { repoRoot, repoIdentity });
  const api = spawnService(process.execPath, [path.join(repoRoot, 'tools', 'admin-api', 'server.mjs')], {
    repoRoot,
    env: environments.api,
    ipc: true
  });
  const ui = spawnService(process.execPath, createAdminUiAstroArgs(astroCli, config), {
    repoRoot,
    env: environments.ui,
    ipc: true
  });

  let stopPromise = null;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = Promise.all([
      stopChild(api, { role: 'api', repoIdentity }),
      stopChild(ui, { role: 'ui', repoIdentity })
    ]).finally(() => removeRuntimeSession(repoRoot, repoIdentity));
    return stopPromise;
  };
  const abortOnExit = (name, child) => child.once('exit', (code, signal) => {
    if (stopPromise) return;
    process.stderr.write(`${name} неожиданно завершён (${code ?? signal}). Останавливаю связанную сессию.\n`);
    void stop().then(() => { process.exitCode = 1; }, () => { process.exitCode = 1; });
  });
  abortOnExit('Admin API', api);
  abortOnExit('Astro', ui);

  try {
    await Promise.all([
      waitForHttp(apiHealthUrl, api, { timeoutMs: options.timeoutMs, service: 'api', repoIdentity }),
      waitForHttp(adminUrl, ui, { timeoutMs: options.timeoutMs, service: 'ui', repoIdentity })
    ]);
  } catch (error) {
    await stop();
    throw error;
  }

  try {
    if (!fixedPorts) await writePreferredRuntimePorts(repoRoot, runtimeIdentity, runtimePorts);
    await writeRuntimeSession(repoRoot, {
      version: 1,
      repoIdentity,
      launcherPid: process.pid,
      apiPort: config.ADMIN_API_PORT,
      uiPort: config.ADMIN_UI_PORT,
      startedAt: new Date().toISOString()
    });
  } catch (error) {
    await stop();
    throw error;
  }

  process.stdout.write(`Админка готова: ${adminUrl}\n`);
  if (options.open === true) openBrowser(adminUrl);
  if (options.keepAlive === false) return { existing: false, adminUrl, api, ui, stop };

  const removeSignalHandlers = installLauncherSignalHandlers(stop);
  try {
    await Promise.race([
      new Promise((resolve) => api.once('exit', resolve)),
      new Promise((resolve) => ui.once('exit', resolve))
    ]);
    await stop();
    return { existing: false, adminUrl, stop };
  } finally {
    removeSignalHandlers();
  }
}

export async function runLauncherCli(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  await runAdminLauncher({ ...args, keepAlive: true });
  return process.exitCode ?? 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLauncherCli().then(
    (code) => { process.exitCode = code; },
    (error) => {
      const message = redactText(error?.message || 'Неизвестная ошибка', { repoRoot: DEFAULT_REPO_ROOT });
      process.stderr.write(`Ошибка запуска [${error?.code || 'ADMIN_LAUNCHER_ERROR'}]: ${message}\n`);
      process.exitCode = 1;
    }
  );
}

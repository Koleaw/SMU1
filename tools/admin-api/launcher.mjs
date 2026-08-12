import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ADMIN_ENV_FILE, loadAdminConfig } from './config.mjs';
import { redactText } from './security.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..', '..');

export class AdminLauncherError extends Error {
  constructor(message, { code = 'ADMIN_LAUNCHER_ERROR', details } = {}) {
    super(message);
    this.name = 'AdminLauncherError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
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

export async function probeHttp(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1_000;
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    if (parsed.protocol !== 'http:') {
      resolve(false);
      return;
    }
    const request = http.get(parsed, {
      headers: {
        Host: parsed.host,
        Accept: 'application/json,text/html;q=0.9',
        Origin: parsed.origin
      }
    }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

export async function waitForHttp(url, child, options = {}) {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 200;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && child.exitCode !== null) {
      throw new AdminLauncherError(`Процесс завершился до готовности (${child.exitCode}).`, {
        code: 'PROCESS_EARLY_EXIT'
      });
    }
    if (await probeHttp(url, { timeoutMs: Math.min(1_000, intervalMs * 4) })) return true;
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

function childEnvironment(raw, config) {
  return {
    ...process.env,
    ...raw,
    ADMIN_API_HOST: config.ADMIN_API_HOST,
    ADMIN_API_PORT: String(config.ADMIN_API_PORT),
    ADMIN_UI_HOST: config.ADMIN_UI_HOST,
    ADMIN_UI_PORT: String(config.ADMIN_UI_PORT),
    CONTENT_WRITE_MODE: 'local',
    PUBLIC_ADMIN_API_BASE: config.PUBLIC_ADMIN_API_BASE
  };
}

function spawnService(command, args, options) {
  return spawn(command, args, {
    cwd: options.repoRoot,
    env: options.env,
    stdio: 'inherit',
    windowsHide: true,
    shell: false
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
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
  await assertFile(path.join(repoRoot, 'node_modules', 'astro', 'astro.js'), 'DEPENDENCIES_MISSING', 'Зависимости не установлены. Павлу нужно один раз выполнить npm ci.');
  const loaded = await loadAdminConfig({ repoRoot });
  const { config, raw } = loaded;
  assertBranch(repoRoot, config.ADMIN_EXPECTED_BRANCH);

  const adminUrl = `http://${config.ADMIN_UI_HOST}:${config.ADMIN_UI_PORT}/admin/`;
  const apiHealthUrl = `http://${config.ADMIN_API_HOST}:${config.ADMIN_API_PORT}/api/admin/me`;
  const existingUi = await probeHttp(adminUrl);
  const existingApi = await probeHttp(apiHealthUrl);
  if (existingUi && existingApi) {
    if (options.open === true) openBrowser(adminUrl);
    process.stdout.write(`Админка уже запущена: ${adminUrl}\n`);
    return { existing: true, adminUrl, stop: async () => {} };
  }
  if (existingUi !== existingApi) {
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

  const env = childEnvironment(raw, config);
  const api = spawnService(process.execPath, [path.join(repoRoot, 'tools', 'admin-api', 'server.mjs')], { repoRoot, env });
  const ui = spawnService(process.execPath, [
    path.join(repoRoot, 'node_modules', 'astro', 'astro.js'),
    'dev',
    '--host', config.ADMIN_UI_HOST,
    '--port', String(config.ADMIN_UI_PORT)
  ], { repoRoot, env });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.all([stopChild(api), stopChild(ui)]);
  };
  const abortOnExit = (name, child) => child.once('exit', (code, signal) => {
    if (stopping) return;
    process.stderr.write(`${name} неожиданно завершён (${code ?? signal}). Останавливаю связанную сессию.\n`);
    void stop().then(() => { process.exitCode = 1; });
  });
  abortOnExit('Admin API', api);
  abortOnExit('Astro', ui);

  try {
    await Promise.all([
      waitForHttp(apiHealthUrl, api, { timeoutMs: options.timeoutMs }),
      waitForHttp(adminUrl, ui, { timeoutMs: options.timeoutMs })
    ]);
  } catch (error) {
    await stop();
    throw error;
  }

  process.stdout.write(`Админка готова: ${adminUrl}\n`);
  if (options.open === true) openBrowser(adminUrl);
  if (options.keepAlive === false) return { existing: false, adminUrl, api, ui, stop };

  const signalHandler = () => { void stop().then(() => { process.exitCode = 0; }); };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);
  await Promise.race([
    new Promise((resolve) => api.once('exit', resolve)),
    new Promise((resolve) => ui.once('exit', resolve))
  ]);
  await stop();
  return { existing: false, adminUrl, stop };
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

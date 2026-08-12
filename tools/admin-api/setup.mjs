import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ADMIN_ENV_FILE,
  parseEnvText,
  serializeEnv
} from './config.mjs';
import { hashPassword, isPasswordHash } from './security.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..', '..');
const REQUIRED_CHECKOUT_FILES = ['package.json', 'tools/admin-api/server.mjs'];
const BLOCKED_PASSWORDS = new Set([
  'admin',
  'adminadmin',
  'change-me',
  'changeme',
  'password',
  'password123',
  'qwerty123456',
  'смy1',
  'сму1'
]);

export class AdminSetupError extends Error {
  constructor(message, { code = 'ADMIN_SETUP_ERROR', summary } = {}) {
    super(message);
    this.name = 'AdminSetupError';
    this.code = code;
    if (summary !== undefined) this.summary = summary;
  }
}

export function validateAdminUsername(value) {
  const username = String(value ?? '').trim();
  if (username.length < 3 || username.length > 64 || !/^[\p{L}\p{N}._-]+$/u.test(username)) {
    throw new AdminSetupError('Логин: 3–64 буквы/цифры, точка, дефис или подчёркивание.', {
      code: 'USERNAME_INVALID'
    });
  }
  return username;
}

export function validateAdminPassword(value, username = '') {
  const password = String(value ?? '');
  const bytes = Buffer.byteLength(password, 'utf8');
  if (password.length < 12 || bytes > 256) {
    throw new AdminSetupError('Пароль должен содержать от 12 до 256 байт.', { code: 'PASSWORD_POLICY' });
  }
  const normalized = password.trim().toLowerCase();
  if (BLOCKED_PASSWORDS.has(normalized)
    || normalized === String(username).trim().toLowerCase()
    || normalized.includes('change-me')) {
    throw new AdminSetupError('Выберите уникальный пароль: стандартные admin/change-me запрещены.', {
      code: 'PASSWORD_INSECURE_DEFAULT'
    });
  }
  return password;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertCheckout(repoRoot) {
  for (const relativePath of REQUIRED_CHECKOUT_FILES) {
    if (!await pathExists(path.join(repoRoot, relativePath))) {
      throw new AdminSetupError(`Не найден настроенный checkout: отсутствует ${relativePath}.`, {
        code: 'CHECKOUT_INVALID'
      });
    }
  }
}

function git(repoRoot, args) {
  return spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

export function currentBranch(repoRoot) {
  const result = git(repoRoot, ['branch', '--show-current']);
  return result.status === 0 ? result.stdout.trim() : '';
}

export function assertAdminEnvIgnored(repoRoot, envPath = path.join(repoRoot, ADMIN_ENV_FILE)) {
  const relative = path.relative(repoRoot, envPath).replace(/\\/gu, '/');
  const result = git(repoRoot, ['check-ignore', '--quiet', '--', relative]);
  if (result.status !== 0) {
    throw new AdminSetupError(
      `${ADMIN_ENV_FILE} не подтверждён как gitignored. Setup остановлен до безопасной настройки .gitignore.`,
      { code: 'ADMIN_ENV_NOT_IGNORED' }
    );
  }
  return true;
}

function safeSummary(values, filePath, exists = true) {
  const configuredKeys = Object.keys(values).filter((key) => String(values[key] ?? '').length > 0).sort();
  const secretKeys = ['ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'GITHUB_TOKEN', 'GITHUB_DEPLOY_TOKEN'];
  return Object.freeze({
    exists,
    file: filePath,
    configuredKeys,
    secretKeysPresent: secretKeys.filter((key) => configuredKeys.includes(key)),
    hasPasswordHash: isPasswordHash(values.ADMIN_PASSWORD_HASH),
    hasPlaintextPassword: Boolean(values.ADMIN_PASSWORD),
    hasSessionSecret: Boolean(values.SESSION_SECRET),
    testMode: values.ADMIN_TEST_MODE === 'true'
  });
}

export async function inspectAdminSetup(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const filePath = path.join(repoRoot, ADMIN_ENV_FILE);
  try {
    const values = parseEnvText(await fs.readFile(filePath, 'utf8'));
    return safeSummary(values, filePath, true);
  } catch (error) {
    if (error?.code === 'ENOENT') return safeSummary({}, filePath, false);
    throw error;
  }
}

async function atomicWrite(filePath, content, { createOnly }) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (createOnly) {
    await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return;
  }
  const temporary = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export async function setupAdmin(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const envPath = path.join(repoRoot, ADMIN_ENV_FILE);
  const action = options.action ?? 'create';
  if (!['create', 'update-password', 'rotate'].includes(action)) {
    throw new AdminSetupError('Неизвестное setup-действие.', { code: 'SETUP_ACTION_INVALID' });
  }
  if (options.validateCheckout !== false) await assertCheckout(repoRoot);
  if (options.checkIgnored !== false) assertAdminEnvIgnored(repoRoot, envPath);

  const exists = await pathExists(envPath);
  const existing = exists ? parseEnvText(await fs.readFile(envPath, 'utf8')) : {};
  if (exists && action === 'create') {
    throw new AdminSetupError(
      `${ADMIN_ENV_FILE} уже существует. Используйте явное update-password или rotate; файл не изменён.`,
      { code: 'SETUP_EXISTS', summary: safeSummary(existing, envPath, true) }
    );
  }
  if (!exists && action !== 'create') {
    throw new AdminSetupError(`${ADMIN_ENV_FILE} ещё не создан. Сначала выполните обычный setup.`, {
      code: 'SETUP_MISSING'
    });
  }

  const username = validateAdminUsername(options.username ?? existing.ADMIN_USERNAME ?? 'owner');
  const password = validateAdminPassword(options.password, username);
  const passwordHash = await hashPassword(password, options.scrypt);
  const branch = options.expectedBranch ?? existing.ADMIN_EXPECTED_BRANCH ?? currentBranch(repoRoot);
  if (options.validateCheckout !== false && !branch) {
    throw new AdminSetupError('Не удалось определить рабочую ветку; detached HEAD для owner launcher запрещён.', {
      code: 'BRANCH_UNAVAILABLE'
    });
  }

  const values = {
    ...existing,
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD_HASH: passwordHash,
    SESSION_SECRET: action === 'rotate' || !existing.SESSION_SECRET
      ? randomBytes(48).toString('base64url')
      : existing.SESSION_SECRET,
    ADMIN_API_HOST: existing.ADMIN_API_HOST || '127.0.0.1',
    ADMIN_API_PORT: existing.ADMIN_API_PORT || '8787',
    ADMIN_UI_HOST: existing.ADMIN_UI_HOST || '127.0.0.1',
    ADMIN_UI_PORT: existing.ADMIN_UI_PORT || '4321',
    ADMIN_ALLOWED_ORIGINS: existing.ADMIN_ALLOWED_ORIGINS || 'http://127.0.0.1:4321',
    PUBLIC_ADMIN_API_BASE: existing.PUBLIC_ADMIN_API_BASE || 'http://127.0.0.1:8787/api/admin',
    CONTENT_WRITE_MODE: 'local',
    ...(branch ? { ADMIN_EXPECTED_BRANCH: branch } : {}),
    ADMIN_TEST_MODE: 'false',
    PRODUCTION_DEPLOY_ENABLED: existing.PRODUCTION_DEPLOY_ENABLED || 'false',
    ADMIN_ALLOW_PRODUCTION_PUBLISH: existing.ADMIN_ALLOW_PRODUCTION_PUBLISH || 'false'
  };
  delete values.ADMIN_PASSWORD;
  if (values.PRODUCTION_DEPLOY_ENABLED === 'true' || values.ADMIN_ALLOW_PRODUCTION_PUBLISH === 'true') {
    throw new AdminSetupError('Setup не включает production publish автоматически. Отключите legacy production flags.', {
      code: 'PRODUCTION_FLAG_PRESENT'
    });
  }

  await atomicWrite(envPath, serializeEnv(values), { createOnly: !exists });
  return Object.freeze({
    ok: true,
    action,
    created: !exists,
    rotatedSessionSecret: action === 'rotate',
    summary: safeSummary(values, envPath, true),
    localUrl: `http://${values.ADMIN_UI_HOST}:${values.ADMIN_UI_PORT}/admin/`
  });
}

function parseArguments(argv) {
  const result = { action: 'create', open: false, yes: false, passwordStdin: false };
  for (const argument of argv) {
    if (argument === '--rotate') result.action = 'rotate';
    else if (argument === '--update-password') result.action = 'update-password';
    else if (argument === '--yes') result.yes = true;
    else if (argument === '--password-stdin') result.passwordStdin = true;
    else if (argument.startsWith('--username=')) result.username = argument.slice('--username='.length);
    else if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument.startsWith('--password=')) {
      throw new AdminSetupError('Не передавайте пароль в command line. Используйте скрытый prompt или --password-stdin.', {
        code: 'PASSWORD_ARGUMENT_FORBIDDEN'
      });
    } else {
      throw new AdminSetupError(`Неизвестный аргумент: ${argument}`, { code: 'SETUP_ARGUMENT_INVALID' });
    }
  }
  return result;
}

async function promptText(question, fallback = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

async function promptSecret(question) {
  if (!process.stdin.isTTY) {
    throw new AdminSetupError('Для non-interactive setup используйте --password-stdin.', {
      code: 'TTY_REQUIRED'
    });
  }
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    }
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    process.stdout.write(question);
    muted = true;
    const answer = await rl.question('');
    muted = false;
    process.stdout.write('\n');
    return answer;
  } finally {
    muted = false;
    rl.close();
  }
}

async function passwordFromStdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value.replace(/\r?\n$/u, '');
}

function printHelp() {
  process.stdout.write([
    'Безопасная первичная настройка локальной админки СМУ-1',
    '',
    '  node tools/admin-api/setup.mjs',
    '  node tools/admin-api/setup.mjs --update-password',
    '  node tools/admin-api/setup.mjs --rotate',
    '',
    'Пароль не принимается через аргумент командной строки и не выводится в лог.',
    '--password-stdin предназначен только для контролируемой автоматизации.',
    ''
  ].join('\n'));
}

export async function runSetupCli(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const current = await inspectAdminSetup({ repoRoot: DEFAULT_REPO_ROOT });
  if (current.exists && args.action === 'create') {
    process.stdout.write([
      `${ADMIN_ENV_FILE} уже настроен; secret values не показаны.`,
      `Настроенные поля: ${current.configuredKeys.join(', ')}`,
      'Файл не изменён. Для смены пароля используйте --update-password.',
      'Для смены пароля и session secret используйте --rotate (это завершит активные сессии).',
      ''
    ].join('\n'));
    return 2;
  }
  if ((args.action === 'rotate' || args.action === 'update-password') && !args.yes) {
    const warning = args.action === 'rotate'
      ? 'Rotate завершит активные сессии. Убедитесь, что browser draft сохранён/recoverable. Продолжить? [yes/N] '
      : 'Сменить password hash? Активную работу сначала сохраните на компьютере. Продолжить? [yes/N] ';
    const confirmed = await promptText(warning);
    if (confirmed.toLowerCase() !== 'yes') {
      process.stdout.write('Настройка отменена, файл не изменён.\n');
      return 2;
    }
  }

  const username = args.username ?? await promptText('Логин владельца [owner]: ', 'owner');
  const password = args.passwordStdin ? await passwordFromStdin() : await promptSecret('Новый пароль (ввод скрыт): ');
  if (!args.passwordStdin) {
    const confirmation = await promptSecret('Повторите пароль: ');
    if (password !== confirmation) throw new AdminSetupError('Пароли не совпадают.', { code: 'PASSWORD_CONFIRMATION' });
  }

  const result = await setupAdmin({
    repoRoot: DEFAULT_REPO_ROOT,
    action: args.action,
    username,
    password
  });
  process.stdout.write([
    result.created ? 'Локальная настройка создана.' : 'Локальная настройка безопасно обновлена.',
    'Пароль не сохранён в открытом виде.',
    `Админка после запуска: ${result.localUrl}`,
    'Запуск: npm run admin (или Windows owner launcher двойным кликом).',
    ''
  ].join('\n'));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runSetupCli().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`Ошибка настройки [${error?.code || 'ADMIN_SETUP_ERROR'}]: ${error?.message || 'Неизвестная ошибка'}\n`);
      process.exitCode = 1;
    }
  );
}

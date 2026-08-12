import fs from 'node:fs/promises';
import path from 'node:path';
import { isLoopbackHostname, isPasswordHash } from './security.mjs';

export const ADMIN_ENV_FILE = '.env.admin.local';
export const DEFAULT_ADMIN_API_HOST = '127.0.0.1';
export const DEFAULT_ADMIN_API_PORT = 8787;
export const DEFAULT_ADMIN_UI_HOST = '127.0.0.1';
export const DEFAULT_ADMIN_UI_PORT = 4321;

const INSECURE_VALUES = new Set([
  '',
  'admin',
  'change-me',
  'changeme',
  'password',
  'dev-session-secret',
  'dev-session-secret-change-me',
  'change-me-long-random-string'
]);

export class AdminConfigError extends Error {
  constructor(message, { code = 'ADMIN_CONFIG_INVALID', details } = {}) {
    super(message);
    this.name = 'AdminConfigError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function decodeQuoted(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new AdminConfigError('Некорректное quoted-значение в env-файле.', { code: 'ENV_PARSE_ERROR' });
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

export function parseEnvText(source = '') {
  const result = {};
  const lines = String(source).replace(/^\uFEFF/u, '').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      throw new AdminConfigError(`Некорректная строка env ${index + 1}.`, {
        code: 'ENV_PARSE_ERROR',
        details: { line: index + 1 }
      });
    }
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
      throw new AdminConfigError(`Некорректное имя env-переменной в строке ${index + 1}.`, {
        code: 'ENV_PARSE_ERROR',
        details: { line: index + 1 }
      });
    }
    result[key] = decodeQuoted(trimmed.slice(separator + 1));
  }
  return result;
}

export function encodeEnvValue(value) {
  const normalized = String(value ?? '');
  return /^[A-Za-z0-9_./:@+-]*$/u.test(normalized) ? normalized : JSON.stringify(normalized);
}

export function serializeEnv(values, options = {}) {
  const preferredOrder = options.order ?? [
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_HASH',
    'SESSION_SECRET',
    'ADMIN_API_HOST',
    'ADMIN_API_PORT',
    'ADMIN_UI_HOST',
    'ADMIN_UI_PORT',
    'ADMIN_ALLOWED_ORIGINS',
    'PUBLIC_ADMIN_API_BASE',
    'CONTENT_WRITE_MODE',
    'ADMIN_EXPECTED_BRANCH',
    'ADMIN_TEST_MODE',
    'PRODUCTION_DEPLOY_ENABLED',
    'ADMIN_ALLOW_PRODUCTION_PUBLISH'
  ];
  const keys = [
    ...preferredOrder.filter((key) => Object.hasOwn(values, key)),
    ...Object.keys(values).filter((key) => !preferredOrder.includes(key)).sort()
  ];
  const header = options.header === false
    ? []
    : ['# Локальная конфигурация админки СМУ-1. Не коммитить.', '# Пароль здесь не хранится — только scrypt hash.'];
  return `${[...header, ...keys.map((key) => `${key}=${encodeEnvValue(values[key])}`)].join('\n')}\n`;
}

export async function readEnvFile(filePath, options = {}) {
  try {
    return parseEnvText(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' && options.optional === true) return {};
    throw error;
  }
}

export async function loadAdminEnvironment(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const fileNames = options.fileNames ?? ['.env.local', ADMIN_ENV_FILE];
  const values = {};
  const loadedFiles = [];
  for (const fileName of fileNames) {
    const filePath = path.resolve(repoRoot, fileName);
    try {
      const parsed = await readEnvFile(filePath);
      Object.assign(values, parsed);
      loadedFiles.push(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  for (const [key, value] of Object.entries(options.env ?? process.env)) {
    if (typeof value === 'string' && value.length > 0) values[key] = value;
  }
  return { repoRoot, values, loadedFiles };
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (String(value).toLowerCase() === 'true') return true;
  if (String(value).toLowerCase() === 'false') return false;
  throw new AdminConfigError(`Ожидалось true/false, получено: ${value}`, { code: 'BOOLEAN_CONFIG_INVALID' });
}

function portValue(value, fallback, key) {
  const port = Number(value ?? fallback);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new AdminConfigError(`${key} должен быть портом от 1024 до 65535.`, { code: 'PORT_CONFIG_INVALID' });
  }
  return port;
}

function hostForUrl(host) {
  return host === '::1' ? '[::1]' : host;
}

function splitOrigins(value) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function exactLoopbackOrigin(value, allowIpv6) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AdminConfigError(`Некорректный разрешённый Origin: ${value}`, { code: 'ORIGIN_CONFIG_INVALID' });
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !isLoopbackHostname(url.hostname, { allowIpv6, allowLocalhost: false })) {
    throw new AdminConfigError('Mutation API разрешает только точные Origin на loopback.', {
      code: 'ORIGIN_CONFIG_NOT_LOOPBACK'
    });
  }
  return url.origin.toLowerCase();
}

function validateBrowserApiBase(value, allowIpv6) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('/')) {
    if (!normalized.startsWith('/api/admin') || normalized.includes('\\') || normalized.includes('..')) {
      throw new AdminConfigError('PUBLIC_ADMIN_API_BASE должен начинаться с /api/admin.', {
        code: 'API_BASE_CONFIG_INVALID'
      });
    }
    return normalized.replace(/\/$/u, '');
  }
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new AdminConfigError('PUBLIC_ADMIN_API_BASE не является URL.', { code: 'API_BASE_CONFIG_INVALID' });
  }
  if (!isLoopbackHostname(url.hostname, { allowIpv6, allowLocalhost: false })
    || !['http:', 'https:'].includes(url.protocol)
    || !url.pathname.startsWith('/api/admin')
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new AdminConfigError('PUBLIC_ADMIN_API_BASE должен указывать только на local loopback API.', {
      code: 'API_BASE_CONFIG_NOT_LOOPBACK'
    });
  }
  return normalized.replace(/\/$/u, '');
}

function insecure(value) {
  return INSECURE_VALUES.has(String(value ?? '').trim().toLowerCase());
}

export function validateAdminConfig(rawValues = {}, options = {}) {
  const raw = { ...rawValues };
  const testMode = raw.ADMIN_TEST_MODE === 'true';
  const allowIpv6 = booleanValue(raw.ADMIN_ALLOW_IPV6_LOOPBACK, false);
  const apiHost = String(raw.ADMIN_API_HOST ?? DEFAULT_ADMIN_API_HOST).trim().toLowerCase();
  const uiHost = String(raw.ADMIN_UI_HOST ?? DEFAULT_ADMIN_UI_HOST).trim().toLowerCase();
  if (!isLoopbackHostname(apiHost, { allowIpv6, allowLocalhost: false })) {
    throw new AdminConfigError('ADMIN_API_HOST обязан быть 127.0.0.1 (или ::1 после явного opt-in).', {
      code: 'API_BIND_NOT_LOOPBACK'
    });
  }
  if (!isLoopbackHostname(uiHost, { allowIpv6, allowLocalhost: false })) {
    throw new AdminConfigError('ADMIN_UI_HOST обязан быть loopback-адресом.', { code: 'UI_BIND_NOT_LOOPBACK' });
  }
  const apiPort = portValue(raw.ADMIN_API_PORT, DEFAULT_ADMIN_API_PORT, 'ADMIN_API_PORT');
  const uiPort = portValue(raw.ADMIN_UI_PORT, DEFAULT_ADMIN_UI_PORT, 'ADMIN_UI_PORT');
  const username = String(raw.ADMIN_USERNAME ?? '').trim();
  const passwordHash = String(raw.ADMIN_PASSWORD_HASH ?? '').trim();
  const plaintextPassword = String(raw.ADMIN_PASSWORD ?? '');
  const sessionSecret = String(raw.SESSION_SECRET ?? '').trim();
  const writeMode = String(raw.CONTENT_WRITE_MODE ?? '').trim();

  if (!username) {
    throw new AdminConfigError('ADMIN_USERNAME не настроен. Запустите npm run admin:setup.', {
      code: 'ADMIN_SETUP_REQUIRED'
    });
  }
  if (!testMode) {
    if (plaintextPassword) {
      throw new AdminConfigError('Plaintext ADMIN_PASSWORD запрещён. Запустите setup для создания scrypt hash.', {
        code: 'PLAINTEXT_PASSWORD_FORBIDDEN'
      });
    }
    if (!isPasswordHash(passwordHash)) {
      throw new AdminConfigError('ADMIN_PASSWORD_HASH отсутствует или повреждён. Запустите npm run admin:setup.', {
        code: 'ADMIN_SETUP_REQUIRED'
      });
    }
    if (sessionSecret.length < 43 || insecure(sessionSecret)) {
      throw new AdminConfigError('SESSION_SECRET отсутствует, короткий или небезопасный. Выполните setup/rotate.', {
        code: 'SESSION_SECRET_INSECURE'
      });
    }
  } else if (!passwordHash && !plaintextPassword) {
    throw new AdminConfigError('Explicit test mode всё равно требует тестовые credentials.', {
      code: 'TEST_CREDENTIALS_REQUIRED'
    });
  }

  if (writeMode !== 'local') {
    throw new AdminConfigError('CONTENT_WRITE_MODE должен быть ровно local; запуск заблокирован.', {
      code: 'WRITE_MODE_DENIED'
    });
  }

  const productionEnabled = booleanValue(raw.PRODUCTION_DEPLOY_ENABLED, false)
    || booleanValue(raw.ADMIN_ALLOW_PRODUCTION_PUBLISH, false);
  if (productionEnabled && testMode) {
    throw new AdminConfigError('Publish запрещён в insecure test mode.', { code: 'INSECURE_PUBLISH_DENIED' });
  }

  const defaultUiOrigin = `http://${hostForUrl(uiHost)}:${uiPort}`;
  const configuredOrigins = splitOrigins(raw.ADMIN_ALLOWED_ORIGINS || raw.ADMIN_ALLOWED_ORIGIN);
  const allowedOrigins = [...new Set((configuredOrigins.length ? configuredOrigins : [defaultUiOrigin])
    .map((origin) => exactLoopbackOrigin(origin, allowIpv6)))];
  const browserApiBase = validateBrowserApiBase(
    raw.PUBLIC_ADMIN_API_BASE || `http://${hostForUrl(apiHost)}:${apiPort}/api/admin`,
    allowIpv6
  );

  return Object.freeze({
    ...raw,
    ADMIN_TEST_MODE: testMode,
    ADMIN_ALLOW_IPV6_LOOPBACK: allowIpv6,
    ADMIN_API_HOST: apiHost,
    ADMIN_API_PORT: apiPort,
    ADMIN_UI_HOST: uiHost,
    ADMIN_UI_PORT: uiPort,
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD_HASH: passwordHash,
    ADMIN_PASSWORD: testMode ? plaintextPassword : '',
    SESSION_SECRET: sessionSecret,
    CONTENT_WRITE_MODE: writeMode,
    ADMIN_ALLOWED_ORIGINS: Object.freeze(allowedOrigins),
    PUBLIC_ADMIN_API_BASE: browserApiBase,
    PRODUCTION_DEPLOY_ENABLED: productionEnabled,
    secureCredentials: !testMode,
    repoRoot: options.repoRoot ? path.resolve(options.repoRoot) : undefined
  });
}

export async function loadAdminConfig(options = {}) {
  const loaded = await loadAdminEnvironment(options);
  return {
    config: validateAdminConfig(loaded.values, { repoRoot: loaded.repoRoot }),
    raw: loaded.values,
    loadedFiles: loaded.loadedFiles,
    repoRoot: loaded.repoRoot
  };
}

export function assertSecureOperation(config, operation = 'startup') {
  if (!config || config.CONTENT_WRITE_MODE !== 'local') {
    throw new AdminConfigError('Local write mode не подтверждён.', { code: 'WRITE_MODE_DENIED' });
  }
  if (operation === 'publish' && (config.ADMIN_TEST_MODE || !config.secureCredentials)) {
    throw new AdminConfigError('Publish невозможен в insecure test mode.', { code: 'INSECURE_PUBLISH_DENIED' });
  }
  if (!isLoopbackHostname(config.ADMIN_API_HOST, {
    allowIpv6: config.ADMIN_ALLOW_IPV6_LOOPBACK === true,
    allowLocalhost: false
  })) {
    throw new AdminConfigError('Admin API не может слушать внешний интерфейс.', { code: 'API_BIND_NOT_LOOPBACK' });
  }
  return true;
}

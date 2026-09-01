import {
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(nodeScrypt);

export const ADMIN_SESSION_COOKIE = 'admin_session';
export const ADMIN_CSRF_HEADER = 'x-admin-csrf';
export const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const PASSWORD_HASH_VERSION = 'v=1';
const DEFAULT_SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 64 });
const MIN_SCRYPT_N = 16384;
const MAX_SCRYPT_N = 131072;
const MAX_PASSWORD_BYTES = 1024;
const TOKEN_BYTES = 32;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_RE = /(?:authorization|cookie|credential|csrf|pass(?:word|wd)?|secret|session|token|api[-_]?key|private[-_]?key|password[-_]?hash)/iu;

export class AdminSecurityError extends Error {
  constructor(message, { code = 'ADMIN_SECURITY_ERROR', status = 400, details } = {}) {
    super(message);
    this.name = 'AdminSecurityError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
}

function safeInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AdminSecurityError(`Invalid scrypt parameter: ${name}`, { code: 'INVALID_PASSWORD_HASH' });
  }
  return parsed;
}

function isPowerOfTwo(value) {
  return value > 1 && (value & (value - 1)) === 0;
}

function decodeBase64Url(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new AdminSecurityError(`Invalid ${name} encoding`, { code: 'INVALID_PASSWORD_HASH' });
  }
  const decoded = Buffer.from(value, 'base64url');
  if (!decoded.length || decoded.toString('base64url') !== value) {
    throw new AdminSecurityError(`Invalid ${name} encoding`, { code: 'INVALID_PASSWORD_HASH' });
  }
  return decoded;
}

export function parsePasswordHash(encoded) {
  const parts = String(encoded ?? '').split('$');
  if (parts.length !== 8 || parts[0] !== 'scrypt' || parts[1] !== PASSWORD_HASH_VERSION) {
    throw new AdminSecurityError('Unsupported password hash format', { code: 'INVALID_PASSWORD_HASH' });
  }

  const readParameter = (part, key) => {
    const prefix = `${key}=`;
    if (!part.startsWith(prefix)) {
      throw new AdminSecurityError(`Missing scrypt parameter: ${key}`, { code: 'INVALID_PASSWORD_HASH' });
    }
    return part.slice(prefix.length);
  };

  const N = safeInteger(readParameter(parts[2], 'N'), 'N', MIN_SCRYPT_N, MAX_SCRYPT_N);
  const r = safeInteger(readParameter(parts[3], 'r'), 'r', 8, 16);
  const p = safeInteger(readParameter(parts[4], 'p'), 'p', 1, 4);
  const keyLength = safeInteger(readParameter(parts[5], 'k'), 'k', 32, 64);
  if (!isPowerOfTwo(N)) {
    throw new AdminSecurityError('Invalid scrypt cost parameter', { code: 'INVALID_PASSWORD_HASH' });
  }

  const salt = decodeBase64Url(parts[6], 'salt');
  const derivedKey = decodeBase64Url(parts[7], 'derived key');
  if (salt.length < 16 || salt.length > 64 || derivedKey.length !== keyLength) {
    throw new AdminSecurityError('Invalid password hash lengths', { code: 'INVALID_PASSWORD_HASH' });
  }

  return { N, r, p, keyLength, salt, derivedKey };
}

function scryptMaxmem({ N, r }) {
  return Math.max(64 * 1024 * 1024, (128 * N * r) + (8 * 1024 * 1024));
}

async function derivePassword(password, salt, options) {
  const passwordBytes = toBuffer(password);
  if (passwordBytes.length > MAX_PASSWORD_BYTES) {
    throw new AdminSecurityError('Password is too long', { code: 'PASSWORD_TOO_LONG' });
  }
  return scryptAsync(passwordBytes, salt, options.keyLength, {
    N: options.N,
    r: options.r,
    p: options.p,
    maxmem: scryptMaxmem(options)
  });
}

export async function hashPassword(password, options = {}) {
  const normalized = String(password ?? '');
  if (!normalized) {
    throw new AdminSecurityError('Password cannot be empty', { code: 'PASSWORD_REQUIRED' });
  }

  const parameters = {
    N: options.N ?? DEFAULT_SCRYPT.N,
    r: options.r ?? DEFAULT_SCRYPT.r,
    p: options.p ?? DEFAULT_SCRYPT.p,
    keyLength: options.keyLength ?? DEFAULT_SCRYPT.keyLength
  };
  safeInteger(parameters.N, 'N', MIN_SCRYPT_N, MAX_SCRYPT_N);
  safeInteger(parameters.r, 'r', 8, 16);
  safeInteger(parameters.p, 'p', 1, 4);
  safeInteger(parameters.keyLength, 'k', 32, 64);
  if (!isPowerOfTwo(parameters.N)) {
    throw new AdminSecurityError('Invalid scrypt cost parameter', { code: 'INVALID_PASSWORD_HASH' });
  }

  const random = options.randomBytes ?? nodeRandomBytes;
  const salt = options.salt ? toBuffer(options.salt) : random(24);
  if (salt.length < 16 || salt.length > 64) {
    throw new AdminSecurityError('Password salt must contain 16-64 bytes', { code: 'INVALID_PASSWORD_SALT' });
  }
  const derivedKey = await derivePassword(normalized, salt, parameters);
  return [
    'scrypt',
    PASSWORD_HASH_VERSION,
    `N=${parameters.N}`,
    `r=${parameters.r}`,
    `p=${parameters.p}`,
    `k=${parameters.keyLength}`,
    salt.toString('base64url'),
    derivedKey.toString('base64url')
  ].join('$');
}

async function dummyPasswordVerification(password) {
  const salt = Buffer.from('smu1-admin-invalid-hash-salt', 'utf8');
  const actual = await derivePassword(password, salt, DEFAULT_SCRYPT).catch(() => Buffer.alloc(DEFAULT_SCRYPT.keyLength));
  timingSafeEqual(Buffer.alloc(DEFAULT_SCRYPT.keyLength), Buffer.from(actual));
}

export async function verifyPassword(password, encoded) {
  let parsed;
  try {
    parsed = parsePasswordHash(encoded);
  } catch {
    await dummyPasswordVerification(password);
    return false;
  }

  let actual;
  try {
    actual = await derivePassword(String(password ?? ''), parsed.salt, parsed);
  } catch {
    await dummyPasswordVerification('');
    return false;
  }
  return actual.length === parsed.derivedKey.length && timingSafeEqual(actual, parsed.derivedKey);
}

export function isPasswordHash(value) {
  try {
    parsePasswordHash(value);
    return true;
  } catch {
    return false;
  }
}

export function timingSafeEqualText(left, right) {
  const leftDigest = createHash('sha256').update(String(left ?? ''), 'utf8').digest();
  const rightDigest = createHash('sha256').update(String(right ?? ''), 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export async function verifyCredentials(expected, supplied) {
  const usernameMatches = timingSafeEqualText(expected?.username, supplied?.username);
  const passwordMatches = await verifyPassword(supplied?.password, expected?.passwordHash);
  return usernameMatches && passwordMatches;
}

function tokenFrom(randomBytes) {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function publicSession(record) {
  return Object.freeze({
    username: record.username,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    idleExpiresAt: record.idleExpiresAt,
    absoluteExpiresAt: record.absoluteExpiresAt,
    csrfToken: record.csrfToken,
    data: record.data
  });
}

export class SessionStore {
  constructor(options = {}) {
    this.idleTtlMs = safeInteger(
      options.idleTtlMs ?? DEFAULT_SESSION_IDLE_TTL_MS,
      'idleTtlMs',
      1,
      31 * 24 * 60 * 60 * 1000
    );
    this.absoluteTtlMs = safeInteger(
      options.absoluteTtlMs ?? DEFAULT_SESSION_ABSOLUTE_TTL_MS,
      'absoluteTtlMs',
      this.idleTtlMs,
      90 * 24 * 60 * 60 * 1000
    );
    this.maxSessions = safeInteger(options.maxSessions ?? 16, 'maxSessions', 1, 10000);
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.secret = options.secret ? toBuffer(options.secret) : this.randomBytes(32);
    if (this.secret.length < 32) {
      throw new AdminSecurityError('Session secret must contain at least 32 bytes', {
        code: 'SESSION_SECRET_TOO_SHORT'
      });
    }
    this.sessions = new Map();
    this.expiredTokens = new Map();
  }

  fingerprint(token) {
    return createHmac('sha256', this.secret).update(String(token ?? ''), 'utf8').digest('base64url');
  }

  prune(now = this.now()) {
    for (const [fingerprint, record] of this.sessions) {
      if (now >= record.absoluteExpiresAt || now >= record.idleExpiresAt) {
        this.sessions.delete(fingerprint);
        this.expiredTokens.set(fingerprint, now + Math.min(this.idleTtlMs, 60_000));
      }
    }
    for (const [fingerprint, expiresAt] of this.expiredTokens) {
      if (now >= expiresAt) this.expiredTokens.delete(fingerprint);
    }
  }

  create(username, options = {}) {
    const normalizedUsername = String(username ?? '').trim();
    if (!normalizedUsername) {
      throw new AdminSecurityError('Session username is required', { code: 'SESSION_USERNAME_REQUIRED' });
    }
    if (options.replaceToken) this.logout(options.replaceToken);
    const now = this.now();
    this.prune(now);
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      this.sessions.delete(oldest);
    }

    const token = tokenFrom(this.randomBytes);
    const record = {
      username: normalizedUsername,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: Math.min(now + this.idleTtlMs, now + this.absoluteTtlMs),
      absoluteExpiresAt: now + this.absoluteTtlMs,
      csrfToken: tokenFrom(this.randomBytes),
      data: options.data === undefined ? undefined : structuredClone(options.data)
    };
    this.sessions.set(this.fingerprint(token), record);
    return { ok: true, token, session: publicSession(record) };
  }

  issue(username, options = {}) {
    return this.create(username, options);
  }

  get(token, options = {}) {
    const fingerprint = this.fingerprint(token);
    const now = this.now();
    const record = this.sessions.get(fingerprint);
    if (!record) {
      this.prune(now);
      return this.expiredTokens.has(fingerprint)
        ? { ok: false, code: 'SESSION_EXPIRED' }
        : { ok: false, code: 'SESSION_INVALID' };
    }
    if (now >= record.absoluteExpiresAt || now >= record.idleExpiresAt) {
      this.sessions.delete(fingerprint);
      this.expiredTokens.set(fingerprint, now + Math.min(this.idleTtlMs, 60_000));
      return { ok: false, code: 'SESSION_EXPIRED' };
    }
    if (options.touch !== false) {
      record.lastSeenAt = now;
      record.idleExpiresAt = Math.min(now + this.idleTtlMs, record.absoluteExpiresAt);
    }
    return { ok: true, session: publicSession(record) };
  }

  rotate(token, options = {}) {
    const current = this.get(token, { touch: false });
    if (!current.ok) return current;
    this.sessions.delete(this.fingerprint(token));
    return this.create(current.session.username, {
      data: options.data ?? current.session.data
    });
  }

  verifyCsrf(token, candidate, options = {}) {
    const current = this.get(token, { touch: options.touch === true });
    if (!current.ok) return current;
    return verifyCsrfToken(current.session.csrfToken, candidate)
      ? { ok: true, session: current.session }
      : { ok: false, code: 'CSRF_INVALID' };
  }

  logout(token) {
    if (!token) return false;
    const fingerprint = this.fingerprint(token);
    this.expiredTokens.delete(fingerprint);
    return this.sessions.delete(fingerprint);
  }

  expire(token) {
    if (!token) return false;
    const fingerprint = this.fingerprint(token);
    const existed = this.sessions.delete(fingerprint);
    if (existed) {
      const now = this.now();
      this.expiredTokens.set(fingerprint, now + Math.min(this.idleTtlMs, 60_000));
    }
    return existed;
  }

  invalidateUser(username) {
    let removed = 0;
    for (const [fingerprint, record] of this.sessions) {
      if (timingSafeEqualText(record.username, username)) {
        this.sessions.delete(fingerprint);
        removed += 1;
      }
    }
    return removed;
  }

  get size() {
    this.prune();
    return this.sessions.size;
  }
}

export class LoginLimiter {
  constructor(options = {}) {
    this.failuresBeforeBackoff = safeInteger(options.failuresBeforeBackoff ?? 3, 'failuresBeforeBackoff', 1, 100);
    this.baseDelayMs = safeInteger(options.baseDelayMs ?? 500, 'baseDelayMs', 1, 60_000);
    this.maxDelayMs = safeInteger(options.maxDelayMs ?? 30_000, 'maxDelayMs', this.baseDelayMs, 60 * 60 * 1000);
    this.windowMs = safeInteger(options.windowMs ?? 15 * 60 * 1000, 'windowMs', this.maxDelayMs, 24 * 60 * 60 * 1000);
    this.maxEntries = safeInteger(options.maxEntries ?? 256, 'maxEntries', 1, 100_000);
    this.now = options.now ?? Date.now;
    this.secret = options.secret ? toBuffer(options.secret) : nodeRandomBytes(32);
    this.entries = new Map();
  }

  key(identifier) {
    return createHmac('sha256', this.secret).update(String(identifier ?? ''), 'utf8').digest('base64url');
  }

  prune(now = this.now()) {
    for (const [key, entry] of this.entries) {
      if (now - entry.lastFailureAt >= this.windowMs) this.entries.delete(key);
    }
  }

  check(identifier) {
    const now = this.now();
    this.prune(now);
    const entry = this.entries.get(this.key(identifier));
    const retryAfterMs = entry ? Math.max(0, entry.nextAllowedAt - now) : 0;
    return retryAfterMs > 0
      ? { allowed: false, code: 'LOGIN_RATE_LIMITED', retryAfterMs, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
      : { allowed: true, retryAfterMs: 0, retryAfterSeconds: 0 };
  }

  recordFailure(identifier) {
    const now = this.now();
    this.prune(now);
    const key = this.key(identifier);
    const previous = this.entries.get(key);
    const failures = previous ? previous.failures + 1 : 1;
    const exponent = Math.max(0, failures - this.failuresBeforeBackoff);
    const delay = failures < this.failuresBeforeBackoff
      ? 0
      : Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** exponent));
    this.entries.delete(key);
    this.entries.set(key, { failures, lastFailureAt: now, nextAllowedAt: now + delay });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    return this.check(identifier);
  }

  recordSuccess(identifier) {
    return this.entries.delete(this.key(identifier));
  }

  reset(identifier) {
    return this.recordSuccess(identifier);
  }
}

export function loginLimiterKey(request, username = '') {
  const address = request?.socket?.remoteAddress ?? request?.connection?.remoteAddress ?? 'unknown';
  return `${String(address).toLowerCase()}\u0000${String(username).trim().toLowerCase()}`;
}

function getHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) ?? '';
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  if (!entry) return '';
  return Array.isArray(entry[1]) ? entry[1].join(',') : String(entry[1] ?? '');
}

export function isLoopbackHostname(hostname, { allowIpv6 = true, allowLocalhost = true } = {}) {
  const normalized = String(hostname ?? '').replace(/^\[|\]$/gu, '').toLowerCase();
  return normalized === '127.0.0.1'
    || (allowIpv6 && normalized === '::1')
    || (allowLocalhost && normalized === 'localhost');
}

export function canonicalLocalOrigin(value, options = {}) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new AdminSecurityError('Origin is not a valid URL', { code: 'ORIGIN_INVALID', status: 403 });
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !isLoopbackHostname(url.hostname, options)) {
    throw new AdminSecurityError('Only an exact loopback origin is allowed', { code: 'ORIGIN_NOT_LOOPBACK', status: 403 });
  }
  return url.origin.toLowerCase();
}

export function canonicalHost(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.includes(',') || /[\\/@?#\s]/u.test(raw)) {
    throw new AdminSecurityError('Host header is invalid', { code: 'HOST_INVALID', status: 403 });
  }
  let url;
  try {
    url = new URL(`http://${raw}`);
  } catch {
    throw new AdminSecurityError('Host header is invalid', { code: 'HOST_INVALID', status: 403 });
  }
  if (!isLoopbackHostname(url.hostname, options)) {
    throw new AdminSecurityError('Host is not loopback', { code: 'HOST_NOT_LOOPBACK', status: 403 });
  }
  return url.host.toLowerCase();
}

export function createLocalRequestPolicy(options = {}) {
  const loopbackOptions = {
    allowIpv6: options.allowIpv6 === true,
    allowLocalhost: options.allowLocalhost === true
  };
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map((origin) => canonicalLocalOrigin(origin, loopbackOptions)));
  const allowedHosts = new Set((options.allowedHosts ?? []).map((host) => canonicalHost(host, loopbackOptions)));
  if (!allowedOrigins.size || !allowedHosts.size) {
    throw new AdminSecurityError('Host and Origin allowlists cannot be empty', { code: 'LOCAL_POLICY_EMPTY' });
  }

  const allowedHeaders = Object.freeze([
    'Content-Type',
    'X-Admin-CSRF',
    'X-Admin-Recovery-Client-Id',
    'X-Admin-Session-Fingerprint'
  ]);
  const allowedMethods = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

  function evaluate(request) {
    const method = String(request?.method ?? 'GET').toUpperCase();
    if (getHeader(request?.headers, 'forwarded') || getHeader(request?.headers, 'x-forwarded-host')) {
      return { ok: false, code: 'FORWARDED_HOST_REJECTED', status: 403 };
    }
    let host;
    try {
      host = canonicalHost(getHeader(request?.headers, 'host'), loopbackOptions);
    } catch (error) {
      return { ok: false, code: error.code ?? 'HOST_INVALID', status: 403 };
    }
    if (!allowedHosts.has(host)) return { ok: false, code: 'HOST_REJECTED', status: 403 };

    const originHeader = getHeader(request?.headers, 'origin');
    const preflightMethod = getHeader(request?.headers, 'access-control-request-method').toUpperCase();
    const needsOrigin = MUTATING_METHODS.has(method) || method === 'OPTIONS';
    if (!originHeader) {
      return needsOrigin
        ? { ok: false, code: 'ORIGIN_REQUIRED', status: 403 }
        : { ok: true, host, origin: '', corsHeaders: {} };
    }

    let origin;
    try {
      origin = canonicalLocalOrigin(originHeader, loopbackOptions);
    } catch (error) {
      return { ok: false, code: error.code ?? 'ORIGIN_INVALID', status: 403 };
    }
    if (!allowedOrigins.has(origin)) return { ok: false, code: 'ORIGIN_REJECTED', status: 403 };
    if (method === 'OPTIONS' && (!preflightMethod || !allowedMethods.includes(preflightMethod))) {
      return { ok: false, code: 'PREFLIGHT_METHOD_REJECTED', status: 403 };
    }
    const fetchSite = getHeader(request?.headers, 'sec-fetch-site').toLowerCase();
    if (fetchSite === 'cross-site') return { ok: false, code: 'CROSS_SITE_REJECTED', status: 403 };

    return {
      ok: true,
      host,
      origin,
      corsHeaders: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': allowedHeaders.join(', '),
        'Access-Control-Allow-Methods': allowedMethods.join(', '),
        Vary: 'Origin'
      }
    };
  }

  return Object.freeze({
    allowedHosts: new Set(allowedHosts),
    allowedOrigins: new Set(allowedOrigins),
    evaluate
  });
}

export function generateCsrfToken(randomBytes = nodeRandomBytes) {
  return tokenFrom(randomBytes);
}

export function verifyCsrfToken(expected, supplied) {
  const expectedDigest = createHash('sha256').update(String(expected ?? ''), 'utf8').digest();
  const suppliedDigest = createHash('sha256').update(String(supplied ?? ''), 'utf8').digest();
  return Boolean(expected) && Boolean(supplied) && timingSafeEqual(expectedDigest, suppliedDigest);
}

export function extractCsrfToken(request) {
  return getHeader(request?.headers, ADMIN_CSRF_HEADER).trim();
}

export function assertCsrf(request, expectedToken) {
  if (!verifyCsrfToken(expectedToken, extractCsrfToken(request))) {
    throw new AdminSecurityError('CSRF token is invalid or missing', { code: 'CSRF_INVALID', status: 403 });
  }
  return true;
}

export function parseCookies(request) {
  const header = getHeader(request?.headers, 'cookie');
  if (!header || header.length > 8192) return {};
  const result = Object.create(null);
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) continue;
    try {
      result[name] = decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      // Ignore malformed cookie values instead of partially authenticating them.
    }
  }
  return result;
}

function cookiePath(value) {
  const normalized = String(value ?? '/api/admin');
  if (!normalized.startsWith('/') || /[;\r\n]/u.test(normalized)) {
    throw new AdminSecurityError('Cookie path is invalid', { code: 'COOKIE_PATH_INVALID' });
  }
  return normalized;
}

export function buildSessionCookie(token, options = {}) {
  const value = encodeURIComponent(String(token ?? ''));
  if (!value || /[;\r\n]/u.test(value)) {
    throw new AdminSecurityError('Session token is invalid', { code: 'SESSION_TOKEN_INVALID' });
  }
  const parts = [
    `${options.name ?? ADMIN_SESSION_COOKIE}=${value}`,
    `Path=${cookiePath(options.path)}`,
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (options.secure === true) parts.push('Secure');
  if (Number.isSafeInteger(options.maxAgeSeconds) && options.maxAgeSeconds > 0) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  return parts.join('; ');
}

export function clearSessionCookie(options = {}) {
  const parts = [
    `${options.name ?? ADMIN_SESSION_COOKIE}=`,
    `Path=${cookiePath(options.path)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];
  if (options.secure === true) parts.push('Secure');
  return parts.join('; ');
}

export function apiSecurityHeaders(options = {}) {
  return Object.freeze({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...(options.https === true ? { 'Strict-Transport-Security': 'max-age=31536000' } : {})
  });
}

export function applyHeaders(response, headers) {
  for (const [name, value] of Object.entries(headers ?? {})) response.setHeader(name, value);
  return response;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function redactText(input, options = {}) {
  let text = String(input ?? '');
  const secrets = [...new Set((options.secrets ?? []).map(String).filter((value) => value.length >= 4))]
    .sort((left, right) => right.length - left.length);
  for (const secret of secrets) text = text.replace(new RegExp(escapeRegExp(secret), 'gu'), REDACTED);
  if (options.repoRoot) text = text.replace(new RegExp(escapeRegExp(String(options.repoRoot)), 'giu'), '[REPO]');
  if (options.homeDir) text = text.replace(new RegExp(escapeRegExp(String(options.homeDir)), 'giu'), '[HOME]');

  return text
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/giu, `Bearer ${REDACTED}`)
    .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/giu, REDACTED)
    .replace(/\b(authorization|cookie|set-cookie|password|passwd|secret|session(?:_secret)?|csrf(?:_token)?|token|api[-_]?key|password[-_]?hash)(\s*[:=]\s*)([^\s,;]+)/giu, `$1$2${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, `$1${REDACTED}@`);
}

export function redactSensitive(value, options = {}, seen = new WeakSet()) {
  if (typeof value === 'string') return redactText(value, options);
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[Binary ${value.byteLength} bytes]`;
  if (value instanceof Error) return sanitizeError(value, options);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, options, seen));

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : redactSensitive(item, options, seen);
  }
  return result;
}

export function sanitizeError(error, options = {}) {
  const safe = {
    name: redactText(error?.name || 'Error', options),
    message: redactText(error?.message || 'Unknown error', options),
    code: redactText(error?.code || 'ADMIN_API_ERROR', options)
  };
  if (options.includeStack === true && error?.stack) safe.stack = redactText(error.stack, options);
  return safe;
}

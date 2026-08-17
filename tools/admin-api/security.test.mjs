import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LoginLimiter,
  SessionStore,
  apiSecurityHeaders,
  assertCsrf,
  buildSessionCookie,
  clearSessionCookie,
  createLocalRequestPolicy,
  hashPassword,
  parseCookies,
  redactSensitive,
  redactText,
  verifyCredentials,
  verifyPassword
} from './security.mjs';
import { assertSecureOperation, serializeEnv, validateAdminConfig } from './config.mjs';

const fastScrypt = { N: 16384, r: 8, p: 1, keyLength: 32, salt: Buffer.alloc(24, 7) };

test('scrypt password hash verifies the right password and never contains plaintext', async () => {
  const password = 'Очень-сильный пароль 2026!';
  const encoded = await hashPassword(password, fastScrypt);
  assert.match(encoded, /^scrypt\$v=1\$N=16384\$r=8\$p=1\$k=32\$/u);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword(`${password}x`, encoded), false);
  assert.equal(await verifyPassword(password, 'not-a-valid-hash'), false);
  assert.equal(await verifyCredentials(
    { username: 'owner', passwordHash: encoded },
    { username: 'owner', password }
  ), true);
  assert.equal(await verifyCredentials(
    { username: 'owner', passwordHash: encoded },
    { username: 'Owner', password }
  ), false);
});

test('session store enforces idle and absolute TTL, rotation, CSRF and logout', () => {
  let clock = 1_000;
  let entropy = 0;
  const store = new SessionStore({
    idleTtlMs: 100,
    absoluteTtlMs: 250,
    now: () => clock,
    secret: Buffer.alloc(32, 1),
    randomBytes: (size) => Buffer.alloc(size, ++entropy)
  });

  const issued = store.issue('owner');
  assert.equal(issued.ok, true);
  assert.equal(store.get(issued.token).session.username, 'owner');
  assert.equal(store.verifyCsrf(issued.token, issued.session.csrfToken).ok, true);
  assert.equal(store.verifyCsrf(issued.token, 'wrong').code, 'CSRF_INVALID');

  clock += 80;
  assert.equal(store.get(issued.token).ok, true);
  clock += 80;
  assert.equal(store.get(issued.token).ok, true, 'touch extends the idle deadline');
  clock += 91;
  assert.equal(store.get(issued.token).code, 'SESSION_EXPIRED', 'absolute TTL cannot be extended');

  const first = store.issue('owner');
  const rotated = store.rotate(first.token);
  assert.equal(rotated.ok, true);
  assert.notEqual(rotated.token, first.token);
  assert.equal(store.get(first.token).code, 'SESSION_INVALID');
  assert.equal(store.get(rotated.token).ok, true);
  assert.equal(store.logout(rotated.token), true);
  assert.equal(store.get(rotated.token).code, 'SESSION_INVALID');
});

test('login limiter applies bounded exponential backoff and resets on success', () => {
  let clock = 0;
  const limiter = new LoginLimiter({
    failuresBeforeBackoff: 2,
    baseDelayMs: 100,
    maxDelayMs: 400,
    windowMs: 1_000,
    now: () => clock,
    secret: Buffer.alloc(32, 2)
  });
  assert.equal(limiter.recordFailure('127.0.0.1\0owner').allowed, true);
  let result = limiter.recordFailure('127.0.0.1\0owner');
  assert.deepEqual(result, {
    allowed: false,
    code: 'LOGIN_RATE_LIMITED',
    retryAfterMs: 100,
    retryAfterSeconds: 1
  });
  clock += 100;
  assert.equal(limiter.check('127.0.0.1\0owner').allowed, true);
  result = limiter.recordFailure('127.0.0.1\0owner');
  assert.equal(result.retryAfterMs, 200);
  limiter.recordSuccess('127.0.0.1\0owner');
  assert.equal(limiter.check('127.0.0.1\0owner').allowed, true);
});

test('local request policy requires exact loopback Host and Origin', () => {
  const policy = createLocalRequestPolicy({
    allowedHosts: ['127.0.0.1:8787'],
    allowedOrigins: ['http://127.0.0.1:4321']
  });
  const accepted = policy.evaluate({
    method: 'POST',
    headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:4321', 'sec-fetch-site': 'same-site' }
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.corsHeaders['Access-Control-Allow-Origin'], 'http://127.0.0.1:4321');
  assert.equal(accepted.corsHeaders['Access-Control-Allow-Credentials'], 'true');
  assert.equal(Object.values(accepted.corsHeaders).includes('*'), false);

  assert.equal(policy.evaluate({
    method: 'POST', headers: { host: '127.0.0.1:8787' }
  }).code, 'ORIGIN_REQUIRED');
  assert.equal(policy.evaluate({
    method: 'POST', headers: { host: 'localhost:8787', origin: 'http://127.0.0.1:4321' }
  }).code, 'HOST_NOT_LOOPBACK');
  assert.equal(policy.evaluate({
    method: 'POST', headers: { host: 'evil.test:8787', origin: 'http://127.0.0.1:4321' }
  }).code, 'HOST_NOT_LOOPBACK');
  assert.equal(policy.evaluate({
    method: 'POST', headers: { host: '127.0.0.1:8787', origin: 'https://example.github.io' }
  }).code, 'ORIGIN_NOT_LOOPBACK');
  assert.equal(policy.evaluate({
    method: 'GET', headers: { host: '127.0.0.1:8787' }
  }).ok, true);

  const preflight = policy.evaluate({
    method: 'OPTIONS',
    headers: {
      host: '127.0.0.1:8787',
      origin: 'http://127.0.0.1:4321',
      'access-control-request-method': 'POST'
    }
  });
  assert.equal(preflight.ok, true);
  assert.match(preflight.corsHeaders['Access-Control-Allow-Headers'], /X-Admin-CSRF/u);
  assert.match(preflight.corsHeaders['Access-Control-Allow-Headers'], /X-Admin-Recovery-Client-Id/u);
  assert.match(preflight.corsHeaders['Access-Control-Allow-Headers'], /X-Admin-Session-Fingerprint/u);
  assert.equal(policy.evaluate({
    method: 'OPTIONS',
    headers: {
      host: '127.0.0.1:8787',
      origin: 'http://127.0.0.1:4321',
      'access-control-request-method': 'TRACE'
    }
  }).code, 'PREFLIGHT_METHOD_REJECTED');
});

test('CSRF, cookies and response headers use fail-closed browser semantics', () => {
  assert.equal(assertCsrf({ headers: { 'x-admin-csrf': 'token' } }, 'token'), true);
  assert.throws(() => assertCsrf({ headers: {} }, 'token'), { code: 'CSRF_INVALID' });
  const cookie = buildSessionCookie('opaque token');
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.match(cookie, /Path=\/api\/admin/u);
  assert.doesNotMatch(cookie, /Secure/u);
  assert.match(buildSessionCookie('opaque', { secure: true }), /; Secure/u);
  assert.match(clearSessionCookie(), /Max-Age=0/u);
  assert.equal(parseCookies({ headers: { cookie: 'a=1; admin_session=opaque%20token' } }).admin_session, 'opaque token');
  const headers = apiSecurityHeaders();
  assert.equal(headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
});

test('diagnostic redaction removes configured and well-known secret forms', () => {
  const secret = 'top-secret-session-value';
  const text = redactText(
    `Authorization: Bearer abc.def.ghi Cookie: admin_session=${secret} path=C:\\Users\\Owner\\repo`,
    { secrets: [secret], repoRoot: 'C:\\Users\\Owner\\repo' }
  );
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes('abc.def.ghi'), false);
  assert.equal(text.includes('C:\\Users\\Owner\\repo'), false);
  const structured = redactSensitive({ password: 'plain', nested: { token: 'opaque', title: 'safe' } });
  assert.deepEqual(structured, { password: '[REDACTED]', nested: { token: '[REDACTED]', title: 'safe' } });
});

test('normal config rejects insecure defaults, external bind and non-local write mode', async () => {
  const hash = await hashPassword('secure password 2026!', fastScrypt);
  const safe = {
    ADMIN_USERNAME: 'owner',
    ADMIN_PASSWORD_HASH: hash,
    SESSION_SECRET: 'x'.repeat(64),
    CONTENT_WRITE_MODE: 'local'
  };
  const parsed = validateAdminConfig(safe);
  assert.equal(parsed.ADMIN_API_HOST, '127.0.0.1');
  assert.equal(assertSecureOperation(parsed), true);
  assert.throws(() => validateAdminConfig({ ...safe, ADMIN_PASSWORD: 'admin' }), {
    code: 'PLAINTEXT_PASSWORD_FORBIDDEN'
  });
  assert.throws(() => validateAdminConfig({ ...safe, ADMIN_API_HOST: '0.0.0.0' }), {
    code: 'API_BIND_NOT_LOOPBACK'
  });
  assert.throws(() => validateAdminConfig({ ...safe, CONTENT_WRITE_MODE: 'remote' }), {
    code: 'WRITE_MODE_DENIED'
  });
  assert.throws(() => validateAdminConfig({
    ...safe,
    ADMIN_ALLOWED_ORIGINS: 'https://example.github.io'
  }), { code: 'ORIGIN_CONFIG_NOT_LOOPBACK' });
  const testConfig = validateAdminConfig({
    ADMIN_TEST_MODE: 'true',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin',
    CONTENT_WRITE_MODE: 'local'
  });
  assert.equal(testConfig.ADMIN_TEST_MODE, true);
  assert.throws(() => assertSecureOperation(testConfig, 'publish'), { code: 'INSECURE_PUBLISH_DENIED' });
});

test('env serialization keeps publish and Pages configuration in a stable preferred order', () => {
  const serialized = serializeEnv({
    SITE_URL: 'https://www.example.test',
    TEST_BASE_PATH: '/preview',
    GITHUB_TOKEN: 'read-token',
    ADMIN_ALLOW_PRODUCTION_PUBLISH: 'false',
    GITHUB_REPOSITORY: 'owner/repo',
    ADMIN_GIT_REMOTE: 'origin',
    TEST_SITE_URL: 'https://owner.github.io',
    GITHUB_DEPLOY_TOKEN: 'deploy-token',
    PRODUCTION_DEPLOY_ENABLED: 'false',
    BASE_PATH: '/production',
    ADMIN_TEST_MODE: 'false',
    ADMIN_EXPECTED_BRANCH: 'candidate',
    Z_EXTRA: 'last',
    A_EXTRA: 'first'
  }, { header: false });
  assert.deepEqual(serialized.trimEnd().split('\n').map((line) => line.slice(0, line.indexOf('='))), [
    'ADMIN_EXPECTED_BRANCH',
    'ADMIN_GIT_REMOTE',
    'GITHUB_REPOSITORY',
    'GITHUB_DEPLOY_TOKEN',
    'GITHUB_TOKEN',
    'TEST_SITE_URL',
    'TEST_BASE_PATH',
    'BASE_PATH',
    'ADMIN_TEST_MODE',
    'PRODUCTION_DEPLOY_ENABLED',
    'ADMIN_ALLOW_PRODUCTION_PUBLISH',
    'SITE_URL',
    'A_EXTRA',
    'Z_EXTRA'
  ]);
});

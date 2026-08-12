import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SERVER_PATH = fileURLToPath(new URL('./server.mjs', import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(SERVER_PATH), '..', '..');
const TEST_USERNAME = 'security-test-owner';
const TEST_PASSWORD = 'security-test-password';
const START_TIMEOUT_MS = 10_000;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function createContentRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-admin-security-'));
  await Promise.all([
    'jobs',
    'product-categories',
    'product-sections',
    'products',
    'projects',
    'services',
    'site-settings',
    'static-pages'
  ].map((collection) => fs.mkdir(path.join(root, collection), { recursive: true })));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function serverEnvironment({ port, uiPort, contentRoot, overrides = {} }) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    ADMIN_TEST_MODE: 'true',
    ADMIN_TEST_CONTENT_ROOT: contentRoot,
    ADMIN_USERNAME: TEST_USERNAME,
    ADMIN_PASSWORD: TEST_PASSWORD,
    ADMIN_PASSWORD_HASH: 'unused-in-explicit-test-mode',
    SESSION_SECRET: 'security-test-session-secret-with-more-than-32-bytes',
    ADMIN_API_HOST: '127.0.0.1',
    ADMIN_API_PORT: String(port),
    ADMIN_UI_HOST: '127.0.0.1',
    ADMIN_UI_PORT: String(uiPort),
    ADMIN_ALLOWED_ORIGINS: `http://127.0.0.1:${uiPort}`,
    ADMIN_ALLOW_IPV6_LOOPBACK: 'false',
    PUBLIC_ADMIN_API_BASE: `http://127.0.0.1:${port}/api/admin`,
    CONTENT_WRITE_MODE: 'local',
    PRODUCTION_DEPLOY_ENABLED: 'false',
    ADMIN_ALLOW_PRODUCTION_PUBLISH: 'false',
    ...overrides
  };
}

function spawnServer(environment) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPO_ROOT,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function startServer(t, options = {}) {
  const contentRoot = options.contentRoot ?? await createContentRoot(t);
  const port = options.port ?? await freePort();
  const uiPort = options.uiPort ?? await freePort();
  const origin = `http://127.0.0.1:${uiPort}`;
  const child = spawnServer(serverEnvironment({
    port,
    uiPort,
    contentRoot,
    overrides: options.overrides
  }));
  t.after(() => stopServer(child));

  let output = '';
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Admin API startup timed out.\n${output}`)), START_TIMEOUT_MS);
    const inspect = (chunk) => {
      output += chunk;
      if (!output.includes('[admin-api] running')) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Admin API exited before startup (${code ?? signal}).\n${output}`));
    });
  });
  await started;
  return { child, contentRoot, origin, port };
}

async function expectStartupRejection(t, overrides) {
  const contentRoot = await createContentRoot(t);
  const port = await freePort();
  const uiPort = await freePort();
  const child = spawnServer(serverEnvironment({ port, uiPort, contentRoot, overrides }));
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      await stopServer(child);
      reject(new Error(`Insecure server unexpectedly remained running.\n${output}`));
    }, START_TIMEOUT_MS);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  assert.notEqual(result.code, 0, output);
  return output;
}

async function request({ port, method = 'GET', pathname = '/api/admin/me', host, origin, cookie, csrf, body, headers = {} }) {
  const encodedBody = body === undefined
    ? null
    : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  const requestHeaders = {
    Host: host ?? `127.0.0.1:${port}`,
    Accept: 'application/json',
    ...headers
  };
  if (origin !== undefined) requestHeaders.Origin = origin;
  if (cookie !== undefined) requestHeaders.Cookie = cookie;
  if (csrf !== undefined) requestHeaders['X-Admin-CSRF'] = csrf;
  if (encodedBody) {
    requestHeaders['Content-Type'] ??= 'application/json';
    requestHeaders['Content-Length'] = String(encodedBody.length);
  }

  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: requestHeaders
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          // Callers can inspect raw text for non-JSON responses.
        }
        resolve({ status: response.statusCode, headers: response.headers, text, json });
      });
    });
    outgoing.once('error', reject);
    if (encodedBody) outgoing.write(encodedBody);
    outgoing.end();
  });
}

function firstSetCookie(response) {
  const values = response.headers['set-cookie'];
  const value = Array.isArray(values) ? values[0] : values;
  assert.ok(value, 'Response must include Set-Cookie.');
  return value;
}

async function login(server, credentials = {}) {
  return request({
    port: server.port,
    method: 'POST',
    pathname: '/api/admin/login',
    origin: server.origin,
    body: {
      login: credentials.username ?? TEST_USERNAME,
      password: credentials.password ?? TEST_PASSWORD
    }
  });
}

test('startup rejects missing credentials, insecure defaults and non-loopback binding', async (t) => {
  const missing = await expectStartupRejection(t, {
    ADMIN_TEST_MODE: 'false',
    ADMIN_USERNAME: ' ',
    ADMIN_PASSWORD: ' ',
    ADMIN_PASSWORD_HASH: 'invalid',
    SESSION_SECRET: 'x'.repeat(64)
  });
  assert.match(missing, /ADMIN_USERNAME не настроен|ADMIN_SETUP_REQUIRED/u);

  const defaults = await expectStartupRejection(t, {
    ADMIN_TEST_MODE: 'false',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin',
    ADMIN_PASSWORD_HASH: 'invalid',
    SESSION_SECRET: 'x'.repeat(64)
  });
  assert.match(defaults, /Plaintext ADMIN_PASSWORD запрещён|PLAINTEXT_PASSWORD_FORBIDDEN/u);

  const nonLoopback = await expectStartupRejection(t, {
    ADMIN_API_HOST: '0.0.0.0'
  });
  assert.match(nonLoopback, /ADMIN_API_HOST обязан быть 127\.0\.0\.1|API_BIND_NOT_LOOPBACK/u);
});

test('server accepts only exact loopback Host and Origin, including preflight', async (t) => {
  const server = await startServer(t);

  const accepted = await request({ port: server.port });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.authenticated, false);

  const wrongHost = await request({
    port: server.port,
    host: `127.0.0.1:${server.port === 65535 ? 65534 : server.port + 1}`
  });
  assert.equal(wrongHost.status, 403);
  assert.equal(wrongHost.json.code, 'HOST_REJECTED');

  const noOrigin = await request({
    port: server.port,
    method: 'POST',
    pathname: '/api/admin/login',
    body: { login: TEST_USERNAME, password: TEST_PASSWORD }
  });
  assert.equal(noOrigin.status, 403);
  assert.equal(noOrigin.json.code, 'ORIGIN_REQUIRED');

  const wrongOrigin = await request({
    port: server.port,
    method: 'POST',
    pathname: '/api/admin/login',
    origin: 'http://127.0.0.1:65534',
    body: { login: TEST_USERNAME, password: TEST_PASSWORD }
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.json.code, 'ORIGIN_REJECTED');

  const pagesOrigin = await request({
    port: server.port,
    method: 'POST',
    pathname: '/api/admin/login',
    origin: 'https://example.github.io',
    body: { login: TEST_USERNAME, password: TEST_PASSWORD }
  });
  assert.equal(pagesOrigin.status, 403);
  assert.equal(pagesOrigin.json.code, 'ORIGIN_NOT_LOOPBACK');

  const exactOrigin = await login(server, { password: 'incorrect' });
  assert.equal(exactOrigin.status, 401, 'Exact Origin reaches authentication instead of policy rejection.');

  const preflight = await request({
    port: server.port,
    method: 'OPTIONS',
    pathname: '/api/admin/login',
    origin: server.origin,
    headers: { 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], server.origin);
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
  assert.match(preflight.headers['access-control-allow-headers'], /X-Admin-CSRF/u);
  assert.notEqual(preflight.headers['access-control-allow-origin'], '*');
});

test('login returns strict HTTP cookie, CSRF token and no-store headers', async (t) => {
  const server = await startServer(t);
  const response = await login(server);
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.username, TEST_USERNAME);
  assert.match(response.json.csrfToken, /^[A-Za-z0-9_-]{40,}$/u);

  const cookie = firstSetCookie(response);
  assert.match(cookie, /^admin_session=[A-Za-z0-9_-]+;/u);
  assert.match(cookie, /Path=\/api\/admin/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.match(cookie, /Max-Age=28800/u);
  assert.doesNotMatch(cookie, /; Secure/u, 'Local HTTP cookie must remain usable without a false Secure flag.');
  assert.equal(response.headers['cache-control'], 'no-store, max-age=0');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['access-control-allow-origin'], server.origin);
  assert.equal(response.headers['access-control-allow-credentials'], 'true');
});

test('missing or wrong CSRF cannot write any content bytes', async (t) => {
  const server = await startServer(t);
  const session = await login(server);
  assert.equal(session.status, 200);
  const cookie = firstSetCookie(session).split(';')[0];
  const body = {
    slug: 'must-not-exist',
    baseRevision: 'missing',
    content: { slug: 'must-not-exist', title: 'CSRF test' }
  };

  const missing = await request({
    port: server.port,
    method: 'POST',
    pathname: '/api/admin/content/products',
    origin: server.origin,
    cookie,
    body
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.json.code, 'CSRF_INVALID');

  const wrong = await request({
    port: server.port,
    method: 'POST',
    pathname: '/api/admin/content/products',
    origin: server.origin,
    cookie,
    csrf: 'wrong-csrf-token',
    body
  });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.json.code, 'CSRF_INVALID');

  assert.deepEqual(await fs.readdir(path.join(server.contentRoot, 'products')), []);
});

test('session is authenticated until CSRF-protected logout invalidates it', async (t) => {
  const server = await startServer(t);
  const session = await login(server);
  assert.equal(session.status, 200);
  const cookie = firstSetCookie(session).split(';')[0];

  const before = await request({ port: server.port, cookie });
  assert.equal(before.status, 200);
  assert.equal(before.json.authenticated, true);
  assert.equal(before.json.username, TEST_USERNAME);
  assert.equal(before.json.csrfToken, session.json.csrfToken);

  const rejectedLogout = await request({
    port: server.port,
    method: 'POST',
    pathname: '/api/admin/logout',
    origin: server.origin,
    cookie,
    csrf: 'wrong-csrf-token'
  });
  assert.equal(rejectedLogout.status, 403);
  assert.equal((await request({ port: server.port, cookie })).json.authenticated, true);

  const logout = await request({
    port: server.port,
    method: 'POST',
    pathname: '/api/admin/logout',
    origin: server.origin,
    cookie,
    csrf: session.json.csrfToken
  });
  assert.equal(logout.status, 200);
  assert.equal(logout.json.ok, true);
  assert.match(firstSetCookie(logout), /Max-Age=0/u);
  assert.match(firstSetCookie(logout), /SameSite=Strict/u);

  const after = await request({ port: server.port, cookie });
  assert.equal(after.status, 200);
  assert.equal(after.json.authenticated, false);
});

test('repeated failed login receives bounded rate-limit response', async (t) => {
  const server = await startServer(t);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await login(server, { password: `incorrect-${attempt}` });
    assert.equal(response.status, 401);
  }

  const limited = await login(server, { password: TEST_PASSWORD });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.code, 'LOGIN_RATE_LIMITED');
  assert.equal(limited.json.retryAfterSeconds >= 1, true);
  assert.equal(Number(limited.headers['retry-after']) >= 1, true);
  assert.equal(limited.headers['set-cookie'], undefined);
});

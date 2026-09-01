import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createAdminUiAstroArgs,
  createParentBoundNodeArgs,
  createChildEnvironments,
  findAvailablePort,
  installLauncherSignalHandlers,
  probeHttp,
  readPreferredRuntimePorts,
  resolveLauncherAstroCli,
  selectRuntimePorts,
  settleAdminSession,
  stopChild,
  writePreferredRuntimePorts
} from './launcher.mjs';
import {
  createAdminHealthIdentity,
  createAdminRepoIdentity,
  createAdminUiHealthMarker
} from './runtime-identity.mjs';

const REPO_IDENTITY = 'a'.repeat(64);
const TEST_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(TEST_FILE), '..', '..');
const SERVER_PATH = path.join(REPO_ROOT, 'tools', 'admin-api', 'server.mjs');

test('launcher resolves the installed Astro 7 CLI and fails fast for an incomplete install', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-launcher-astro-cli-'));
  const packageRoot = path.join(root, 'node_modules', 'astro');
  const cli = path.join(packageRoot, 'bin', 'astro.mjs');
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ bin: { astro: './bin/astro.mjs' } }));
  await fs.writeFile(cli, 'export {};\n');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  assert.equal(await resolveLauncherAstroCli(root), await fs.realpath(cli));
  await fs.unlink(cli);
  await assert.rejects(
    () => resolveLauncherAstroCli(root),
    (error) => error?.code === 'DEPENDENCIES_MISSING' && error?.details?.reason === 'ASTRO_CLI_MISSING'
  );
});

test('launcher selects distinct random loopback ports instead of requiring fixed defaults', async () => {
  const apiPort = await findAvailablePort('127.0.0.1');
  const uiPort = await findAvailablePort('127.0.0.1', { exclude: new Set([apiPort]) });
  assert.match(String(apiPort), /^[1-9][0-9]{3,4}$/u);
  assert.match(String(uiPort), /^[1-9][0-9]{3,4}$/u);
  assert.notEqual(apiPort, uiPort);
});

test('launcher reuses persisted loopback ports and falls back only for a collided service', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-launcher-ports-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = {
    repoIdentity: REPO_IDENTITY,
    apiHost: '127.0.0.1',
    uiHost: '127.0.0.1'
  };

  const first = await selectRuntimePorts(identity);
  assert.notEqual(first.apiPort, first.uiPort);
  await writePreferredRuntimePorts(root, identity, first);
  const persisted = await readPreferredRuntimePorts(root, identity);
  assert.deepEqual(persisted, first);

  const restart = await selectRuntimePorts(identity, { preferred: persisted });
  assert.deepEqual(restart, first, 'a normal launcher restart must preserve the browser origin');
  await writePreferredRuntimePorts(root, identity, restart);
  assert.deepEqual(await readPreferredRuntimePorts(root, identity), first, 'a completed restart atomically refreshes the preference file');

  const collision = net.createServer();
  await new Promise((resolve, reject) => {
    collision.once('error', reject);
    collision.listen(first.apiPort, identity.apiHost, resolve);
  });
  t.after(() => new Promise((resolve) => collision.close(resolve)));

  const fallback = await selectRuntimePorts(identity, { preferred: persisted });
  assert.equal(fallback.uiPort, first.uiPort, 'an API collision must not discard the stable UI origin');
  assert.notEqual(fallback.apiPort, first.apiPort);
  assert.notEqual(fallback.apiPort, fallback.uiPort);
});

test('launcher ignores a port preference from another checkout or loopback host', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-launcher-ports-scope-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = {
    repoIdentity: REPO_IDENTITY,
    apiHost: '127.0.0.1',
    uiHost: '127.0.0.1'
  };
  const ports = await selectRuntimePorts(identity);
  await writePreferredRuntimePorts(root, identity, ports);

  assert.equal(await readPreferredRuntimePorts(root, { ...identity, repoIdentity: 'b'.repeat(64) }), null);
  assert.equal(await readPreferredRuntimePorts(root, { ...identity, uiHost: '::1' }), null);
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function isolatedContentRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-launcher-api-'));
  await Promise.all([
    'jobs', 'product-categories', 'product-sections', 'products', 'projects',
    'services', 'site-settings', 'static-pages'
  ].map((collection) => fs.mkdir(path.join(root, collection), { recursive: true })));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function waitForServerStartup(child) {
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Admin API startup timed out.\n${output}`)), 10_000);
    const inspect = (chunk) => {
      output += String(chunk);
      if (!output.includes('[admin-api] running')) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Admin API exited before startup (${code ?? signal}).\n${output}`));
    });
  });
}

async function healthServer(t) {
  const apiIdentity = createAdminHealthIdentity('api', REPO_IDENTITY);
  const uiMarker = createAdminUiHealthMarker(REPO_IDENTITY);
  const server = http.createServer((request, response) => {
    if (request.url === '/api-good') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(apiIdentity));
      return;
    }
    if (request.url === '/api-foreign') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ...apiIdentity, repoIdentity: 'b'.repeat(64) }));
      return;
    }
    if (request.url === '/api-forbidden') {
      response.statusCode = 403;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(apiIdentity));
      return;
    }
    if (request.url === '/ui-good') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><head><meta name="smu1-admin-health" content="${uiMarker}"></head>`);
      return;
    }
    if (request.url === '/ui-foreign') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><head><meta name="smu1-admin-health" content="${createAdminUiHealthMarker('b'.repeat(64))}"></head>`);
      return;
    }
    response.statusCode = 404;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><head><meta name="smu1-admin-health" content="${uiMarker}"></head>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

class FakeChild extends EventEmitter {
  constructor({ pid = 4242, connected = true, onSend, onKill } = {}) {
    super();
    this.pid = pid;
    this.connected = connected;
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
    this.messages = [];
    this.signals = [];
    this.onSend = onSend;
    this.onKill = onKill;
  }

  send(message, callback) {
    this.messages.push(message);
    this.onSend?.(this, message);
    callback?.(null);
    return true;
  }

  kill(signal) {
    this.killed = true;
    this.signals.push(signal);
    this.onKill?.(this, signal);
    return true;
  }

  finish(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.connected = false;
    this.emit('exit', code, signal);
  }
}

test('health probes accept only exact 200 API and UI identities for this checkout', async (t) => {
  const origin = await healthServer(t);
  assert.equal(await probeHttp(`${origin}/api-good`, { service: 'api', repoIdentity: REPO_IDENTITY }), true);
  assert.equal(await probeHttp(`${origin}/ui-good`, { service: 'ui', repoIdentity: REPO_IDENTITY }), true);
  assert.equal(await probeHttp(`${origin}/api-foreign`, { service: 'api', repoIdentity: REPO_IDENTITY }), false);
  assert.equal(await probeHttp(`${origin}/api-forbidden`, { service: 'api', repoIdentity: REPO_IDENTITY }), false);
  assert.equal(await probeHttp(`${origin}/ui-foreign`, { service: 'ui', repoIdentity: REPO_IDENTITY }), false);
  assert.equal(await probeHttp(`${origin}/missing`, { service: 'ui', repoIdentity: REPO_IDENTITY }), false);
});

test('real Admin API exposes exact health identity and releases writer lease on IPC shutdown', async (t) => {
  const contentRoot = await isolatedContentRoot(t);
  const [apiPort, uiPort] = await Promise.all([freePort(), freePort()]);
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ADMIN_TEST_MODE: 'true',
      ADMIN_TEST_CONTENT_ROOT: contentRoot,
      ADMIN_USERNAME: 'launcher-test-owner',
      ADMIN_PASSWORD: 'launcher-test-password',
      ADMIN_PASSWORD_HASH: 'unused-in-explicit-test-mode',
      SESSION_SECRET: 'launcher-test-session-secret-with-more-than-32-bytes',
      ADMIN_API_HOST: '127.0.0.1',
      ADMIN_API_PORT: String(apiPort),
      ADMIN_UI_HOST: '127.0.0.1',
      ADMIN_UI_PORT: String(uiPort),
      ADMIN_ALLOWED_ORIGINS: `http://127.0.0.1:${uiPort}`,
      PUBLIC_ADMIN_API_BASE: `http://127.0.0.1:${apiPort}/api/admin`,
      CONTENT_WRITE_MODE: 'local',
      PRODUCTION_DEPLOY_ENABLED: 'false',
      ADMIN_ALLOW_PRODUCTION_PUBLISH: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  });
  await waitForServerStartup(child);

  const repoIdentity = createAdminRepoIdentity(REPO_ROOT);
  assert.equal(await probeHttp(`http://127.0.0.1:${apiPort}/api/admin/health`, {
    service: 'api', repoIdentity
  }), true);
  const stopped = await stopChild(child, {
    role: 'api',
    platform: process.platform,
    repoIdentity,
    gracefulTimeoutMs: 2_000,
    forceExitTimeoutMs: 2_000,
    forceKillWindows: () => { throw new Error('Graceful IPC shutdown unexpectedly needed taskkill.'); }
  });
  assert.deepEqual(stopped, { exited: true, forced: false });
  await assert.rejects(() => fs.access(path.join(contentRoot, '.admin-runtime', 'writer-owner.lock')), { code: 'ENOENT' });
});

test('Astro UI receives only a safe allowlist while API retains admin secrets but drops GitHub tokens', () => {
  const environment = {
    PATH: 'safe-path',
    TEMP: 'safe-temp',
    ADMIN_PASSWORD_HASH: 'process-password-hash',
    SESSION_SECRET: 'process-session-secret',
    GITHUB_TOKEN: 'process-token',
    github_deploy_token: 'process-case-variant-token',
    GIT_CONFIG_COUNT: '1',
    NODE_OPTIONS: '--require=unexpected-code'
  };
  const raw = {
    ADMIN_PASSWORD_HASH: 'configured-password-hash',
    SESSION_SECRET: 'configured-session-secret',
    GITHUB_DEPLOY_TOKEN: 'configured-deploy-token'
  };
  const config = {
    ADMIN_API_HOST: '127.0.0.1', ADMIN_API_PORT: 8787,
    ADMIN_UI_HOST: '127.0.0.1', ADMIN_UI_PORT: 4321,
    PUBLIC_ADMIN_API_BASE: '/api/admin'
  };
  const childEnvironments = createChildEnvironments(raw, config, { environment, repoIdentity: REPO_IDENTITY });

  assert.equal(childEnvironments.api.ADMIN_PASSWORD_HASH, 'configured-password-hash');
  assert.equal(childEnvironments.api.SESSION_SECRET, 'configured-session-secret');
  for (const forbidden of ['GITHUB_TOKEN', 'GITHUB_DEPLOY_TOKEN', 'github_deploy_token']) {
    assert.equal(Object.hasOwn(childEnvironments.api, forbidden), false, `${forbidden} must not reach Admin API`);
  }
  assert.equal(childEnvironments.ui.PATH, 'safe-path');
  assert.equal(childEnvironments.ui.PUBLIC_ADMIN_HEALTH_MARKER, createAdminUiHealthMarker(REPO_IDENTITY));
  assert.equal(childEnvironments.ui.SMU1_ADMIN_LAUNCHER_REPO_IDENTITY, REPO_IDENTITY);
  assert.equal(childEnvironments.ui.ASTRO_DEV_BACKGROUND, 'foreground-parent-bound');
  for (const forbidden of ['ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'GITHUB_TOKEN', 'GITHUB_DEPLOY_TOKEN', 'GIT_CONFIG_COUNT', 'NODE_OPTIONS']) {
    assert.equal(Object.hasOwn(childEnvironments.ui, forbidden), false, `${forbidden} must not reach Astro UI`);
  }
});

test('Astro UI stays parent-bound and bypasses the workspace-global dev lock', () => {
  const astroCli = path.join(REPO_ROOT, 'node_modules', 'astro', 'astro.js');
  const args = createAdminUiAstroArgs(astroCli, {
    ADMIN_UI_HOST: '127.0.0.1',
    ADMIN_UI_PORT: 4321
  });
  assert.deepEqual(args.slice(-6), [
    'dev', '--ignore-lock', '--host', '127.0.0.1', '--port', '4321'
  ]);
});

test('SIGHUP uses the same idempotent graceful launcher stop contract and removes all signal listeners', async () => {
  const processRef = new EventEmitter();
  processRef.exitCode = null;
  let stops = 0;
  const cleanup = installLauncherSignalHandlers(async () => { stops += 1; }, { processRef });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(processRef.listenerCount(signal), 1);

  processRef.emit('SIGHUP');
  processRef.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(stops, 1);
  assert.equal(processRef.exitCode, 0);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(processRef.listenerCount(signal), 0);
  cleanup();
});

test('an exact parent-bound UI child exits when launcher IPC disappears', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-launcher-ui-child-'));
  const entryPoint = path.join(root, 'fixture.mjs');
  await fs.writeFile(entryPoint, [
    "process.send?.({ type: 'ready', argv: process.argv.slice(1) });",
    'setInterval(() => {}, 1_000);'
  ].join('\n'), 'utf8');
  const child = spawn(process.execPath, createParentBoundNodeArgs(entryPoint, ['dev', '--port', '4321']), {
    cwd: root,
    env: { ...process.env, SMU1_ADMIN_LAUNCHER_REPO_IDENTITY: REPO_IDENTITY },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Parent-bound UI fixture did not start.')), 5_000);
    child.once('message', (message) => { clearTimeout(timer); resolve(message); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Parent-bound UI fixture exited early (${code ?? signal}).`));
    });
  });
  assert.deepEqual(ready.argv, [entryPoint, 'dev', '--port', '4321']);

  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.disconnect();
  assert.deepEqual(await exited, { code: 1, signal: null });
});

test('session settling lets exact orphan children disappear before immediate restart', async () => {
  let clock = 0;
  const sequence = [
    { ui: true, api: false },
    { ui: false, api: false }
  ];
  const state = await settleAdminSession({ ui: true, api: true }, {
    settleMs: 50,
    healthyConfirmMs: 20,
    intervalMs: 5,
    now: () => clock,
    delay: async (ms) => { clock += ms; },
    probe: async () => sequence.shift() || { ui: false, api: false }
  });
  assert.deepEqual(state, { state: 'empty', ui: false, api: false });
});

test('AdminShell emits the launcher-owned exact health marker only from the safe public value', async () => {
  const source = await fs.readFile(new URL('../../src/admin/shell/AdminShell.astro', import.meta.url), 'utf8');
  assert.match(source, /PUBLIC_ADMIN_HEALTH_MARKER/u);
  assert.match(source, /<meta name="smu1-admin-health" content=\{adminHealthMarker\}/u);
});

test('API shutdown uses parent IPC first and confirms graceful exit without taskkill', async () => {
  const child = new FakeChild({
    onSend: (target) => setImmediate(() => target.finish(0, null))
  });
  let forced = 0;
  const result = await stopChild(child, {
    role: 'api',
    platform: 'win32',
    repoIdentity: REPO_IDENTITY,
    gracefulTimeoutMs: 50,
    forceExitTimeoutMs: 50,
    forceKillWindows: () => { forced += 1; }
  });
  assert.deepEqual(result, { exited: true, forced: false });
  assert.equal(forced, 0);
  assert.equal(child.messages.length, 1);
  assert.equal(child.messages[0].repoIdentity, REPO_IDENTITY);
});

test('parent-bound UI shutdown uses authenticated IPC before taskkill', async () => {
  const child = new FakeChild({
    onSend: (target) => setImmediate(() => target.finish(0, null))
  });
  let forced = 0;
  const result = await stopChild(child, {
    role: 'ui',
    platform: 'win32',
    repoIdentity: REPO_IDENTITY,
    gracefulTimeoutMs: 50,
    forceExitTimeoutMs: 50,
    forceKillWindows: () => { forced += 1; }
  });
  assert.deepEqual(result, { exited: true, forced: false });
  assert.equal(forced, 0);
  assert.equal(child.messages[0].repoIdentity, REPO_IDENTITY);
});

test('Windows shutdown force-kills only after IPC timeout and still requires an exit', async () => {
  const child = new FakeChild();
  let forced = 0;
  const result = await stopChild(child, {
    role: 'api',
    platform: 'win32',
    repoIdentity: REPO_IDENTITY,
    gracefulTimeoutMs: 5,
    forceExitTimeoutMs: 50,
    forceKillWindows: (target) => {
      forced += 1;
      setImmediate(() => target.finish(null, 'SIGKILL'));
    }
  });
  assert.deepEqual(result, { exited: true, forced: true });
  assert.equal(forced, 1);

  const stuck = new FakeChild({ connected: false });
  await assert.rejects(() => stopChild(stuck, {
    role: 'api',
    platform: 'win32',
    repoIdentity: REPO_IDENTITY,
    forceExitTimeoutMs: 5,
    forceKillWindows: () => {}
  }), { code: 'PROCESS_STOP_UNCONFIRMED' });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { loadAdminEnvironment, parseEnvText } from './config.mjs';
import {
  inferGitHubPagesConfig,
  inspectAdminSetup,
  runSetupCli,
  setupAdmin,
  validateAdminPassword,
  validateAdminUsername
} from './setup.mjs';
import { verifyPassword } from './security.mjs';

const tempDirs = [];
const scrypt = { N: 16384, r: 8, p: 1, keyLength: 32, salt: Buffer.alloc(24, 3) };
const stoppedRuntime = Object.freeze({
  probeHttp: async () => false,
  checkPortAvailable: async () => true
});

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-admin-setup-'));
  tempDirs.push(directory);
  return directory;
}

function runGit(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

async function temporaryRepository(remoteUrl) {
  const repoRoot = await temporaryDirectory();
  runGit(repoRoot, ['init', '--quiet']);
  runGit(repoRoot, ['remote', 'add', 'origin', remoteUrl]);
  return repoRoot;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test('guided setup creates a local env atomically with hash, never plaintext', async () => {
  const repoRoot = await temporaryDirectory();
  const password = 'Надёжный пароль 2026!';
  const result = await setupAdmin({
    repoRoot,
    username: 'owner',
    password,
    expectedBranch: 'candidate',
    validateCheckout: false,
    checkIgnored: false,
    scrypt
  });
  assert.equal(result.created, true);
  assert.equal(result.localUrl, 'http://127.0.0.1:4321/admin/');

  const envText = await fs.readFile(path.join(repoRoot, '.env.admin.local'), 'utf8');
  const env = parseEnvText(envText);
  assert.equal(envText.includes(password), false);
  assert.equal(Object.hasOwn(env, 'ADMIN_PASSWORD'), false);
  assert.equal(await verifyPassword(password, env.ADMIN_PASSWORD_HASH), true);
  assert.equal(env.SESSION_SECRET.length >= 64, true);
  assert.equal(env.CONTENT_WRITE_MODE, 'local');
  assert.equal(env.ADMIN_TEST_MODE, 'false');
  assert.equal(env.ADMIN_API_HOST, '127.0.0.1');
  assert.equal(env.ADMIN_EXPECTED_BRANCH, 'candidate');

  const summary = await inspectAdminSetup({ repoRoot });
  assert.equal(summary.hasPasswordHash, true);
  assert.equal(JSON.stringify(summary).includes(env.SESSION_SECRET), false);
  assert.equal(JSON.stringify(summary).includes(env.ADMIN_PASSWORD_HASH), false);
});

test('existing setup is fail-safe and remains byte-for-byte unchanged without explicit action', async () => {
  const repoRoot = await temporaryDirectory();
  const options = {
    repoRoot,
    username: 'owner',
    password: 'first secure password!',
    expectedBranch: 'candidate',
    validateCheckout: false,
    checkIgnored: false,
    scrypt
  };
  await setupAdmin(options);
  const filePath = path.join(repoRoot, '.env.admin.local');
  const before = await fs.readFile(filePath);
  await assert.rejects(
    setupAdmin({ ...options, password: 'second secure password!' }),
    (error) => error.code === 'SETUP_EXISTS'
      && error.summary.hasPasswordHash === true
      && !JSON.stringify(error.summary).includes('first secure password!')
  );
  assert.deepEqual(await fs.readFile(filePath), before);
});

test('explicit password update preserves session secret; rotate replaces it with warning metadata', async () => {
  const repoRoot = await temporaryDirectory();
  const common = {
    repoRoot,
    username: 'owner',
    expectedBranch: 'candidate',
    validateCheckout: false,
    checkIgnored: false,
    scrypt,
    ...stoppedRuntime
  };
  await setupAdmin({ ...common, password: 'first secure password!' });
  const filePath = path.join(repoRoot, '.env.admin.local');
  const initial = parseEnvText(await fs.readFile(filePath, 'utf8'));

  await setupAdmin({ ...common, action: 'update-password', password: 'second secure password!' });
  const updated = parseEnvText(await fs.readFile(filePath, 'utf8'));
  assert.equal(updated.SESSION_SECRET, initial.SESSION_SECRET);
  assert.equal(await verifyPassword('second secure password!', updated.ADMIN_PASSWORD_HASH), true);

  const rotatedResult = await setupAdmin({ ...common, action: 'rotate', password: 'third secure password!' });
  const rotated = parseEnvText(await fs.readFile(filePath, 'utf8'));
  assert.equal(rotatedResult.rotatedSessionSecret, true);
  assert.notEqual(rotated.SESSION_SECRET, initial.SESSION_SECRET);
  assert.equal(await verifyPassword('third secure password!', rotated.ADMIN_PASSWORD_HASH), true);
  assert.equal((await fs.readdir(repoRoot)).some((name) => name.endsWith('.tmp')), false);
});

test('legacy GitHub tokens are fail-closed at load and removed by update/rotate without disclosure', async () => {
  const repoRoot = await temporaryDirectory();
  const common = {
    repoRoot,
    username: 'owner',
    expectedBranch: 'candidate',
    validateCheckout: false,
    checkIgnored: false,
    scrypt,
    ...stoppedRuntime
  };
  await setupAdmin({ ...common, password: 'first secure password!' });
  const filePath = path.join(repoRoot, '.env.admin.local');
  const firstSecret = 'ghp_LEGACY_VALUE_MUST_NOT_ESCAPE_123';
  await fs.appendFile(filePath, `GITHUB_TOKEN=${firstSecret}\n`, 'utf8');

  const summary = await inspectAdminSetup({ repoRoot });
  assert.equal(summary.hasLegacyGitHubCredential, true);
  assert.equal(summary.configuredKeys.includes('GITHUB_TOKEN'), false);
  assert.equal(summary.secretKeysPresent.includes('GITHUB_TOKEN'), false);
  assert.equal(JSON.stringify(summary).includes(firstSecret), false);
  await assert.rejects(
    loadAdminEnvironment({ repoRoot, env: {} }),
    (error) => error.code === 'PLAINTEXT_GITHUB_CREDENTIAL_FORBIDDEN'
      && !String(error.message).includes(firstSecret)
      && !JSON.stringify(error).includes(firstSecret)
  );

  const updatedResult = await setupAdmin({
    ...common,
    action: 'update-password',
    password: 'second secure password!'
  });
  const updatedText = await fs.readFile(filePath, 'utf8');
  assert.equal(updatedResult.removedLegacyGitHubCredentials, true);
  assert.equal(updatedText.includes(firstSecret), false);
  assert.doesNotMatch(updatedText, /GITHUB_TOKEN/iu);

  const secondSecret = 'github_pat_LEGACY_DEPLOY_VALUE_MUST_NOT_ESCAPE_456';
  await fs.appendFile(filePath, `GITHUB_DEPLOY_TOKEN=${secondSecret}\n`, 'utf8');
  const rotatedResult = await setupAdmin({
    ...common,
    action: 'rotate',
    password: 'third secure password!'
  });
  const rotatedText = await fs.readFile(filePath, 'utf8');
  assert.equal(rotatedResult.removedLegacyGitHubCredentials, true);
  assert.equal(rotatedText.includes(secondSecret), false);
  assert.doesNotMatch(rotatedText, /GITHUB_(?:DEPLOY_)?TOKEN/iu);
  assert.equal(JSON.stringify(rotatedResult).includes(secondSecret), false);
});

test('password update fails closed while the exact configured admin runtime is active', async () => {
  const repoRoot = await temporaryDirectory();
  const common = {
    repoRoot,
    username: 'owner',
    expectedBranch: 'candidate',
    validateCheckout: false,
    checkIgnored: false,
    scrypt
  };
  await setupAdmin({ ...common, password: 'first secure password!' });
  const filePath = path.join(repoRoot, '.env.admin.local');
  const before = await fs.readFile(filePath);
  const probes = [];
  const ports = [];

  await assert.rejects(
    setupAdmin({
      ...common,
      action: 'update-password',
      password: 'second secure password!',
      probeHttp: async (url, options) => {
        probes.push({ url, options });
        return true;
      },
      checkPortAvailable: async (host, port) => {
        ports.push({ host, port });
        return false;
      }
    }),
    { code: 'ADMIN_RUNTIME_ACTIVE' }
  );

  assert.deepEqual(await fs.readFile(filePath), before);
  assert.equal(probes.length, 1);
  assert.equal(probes[0].url, 'http://127.0.0.1:8787/api/admin/health');
  assert.equal(probes[0].options.service, 'api');
  assert.match(probes[0].options.repoIdentity, /^[a-f0-9]{64}$/u);
  assert.deepEqual(ports, [{ host: '127.0.0.1', port: 8787 }]);
});

test('rotate CLI refuses a foreign listener before reading a password and preserves env bytes', async () => {
  const repoRoot = await temporaryDirectory();
  const common = {
    repoRoot,
    username: 'owner',
    expectedBranch: 'candidate',
    validateCheckout: false,
    checkIgnored: false,
    scrypt
  };
  await setupAdmin({ ...common, password: 'first secure password!' });
  const filePath = path.join(repoRoot, '.env.admin.local');
  const before = await fs.readFile(filePath);

  await assert.rejects(
    runSetupCli(['--rotate', '--yes'], {
      repoRoot,
      probeHttp: async () => false,
      checkPortAvailable: async () => false
    }),
    { code: 'ADMIN_API_PORT_OCCUPIED' }
  );

  assert.deepEqual(await fs.readFile(filePath), before);
});

test('setup validation rejects default passwords and malformed usernames', () => {
  assert.throws(() => validateAdminPassword('admin', 'admin'), { code: 'PASSWORD_POLICY' });
  assert.throws(() => validateAdminPassword('change-me-forever', 'owner'), { code: 'PASSWORD_INSECURE_DEFAULT' });
  assert.throws(() => validateAdminUsername('../owner'), { code: 'USERNAME_INVALID' });
  assert.equal(validateAdminUsername('Павел.owner'), 'Павел.owner');
});

test('GitHub Pages inference supports exact HTTPS and SSH GitHub remotes', async () => {
  const repoRoot = await temporaryRepository('https://github.com/Acme-Co/Industrial-Catalog.git');
  assert.deepEqual(inferGitHubPagesConfig(repoRoot), {
    repository: 'Acme-Co/Industrial-Catalog',
    siteUrl: 'https://acme-co.github.io',
    basePath: '/Industrial-Catalog'
  });

  runGit(repoRoot, ['remote', 'set-url', 'origin', 'ssh://git@github.com/Acme-Co/Acme-Co.github.io.git']);
  assert.deepEqual(inferGitHubPagesConfig(repoRoot), {
    repository: 'Acme-Co/Acme-Co.github.io',
    siteUrl: 'https://acme-co.github.io',
    basePath: '/'
  });

  runGit(repoRoot, ['remote', 'set-url', 'origin', 'git@github.com:Acme-Co/second-site.git']);
  assert.deepEqual(inferGitHubPagesConfig(repoRoot), {
    repository: 'Acme-Co/second-site',
    siteUrl: 'https://acme-co.github.io',
    basePath: '/second-site'
  });
});

test('GitHub Pages inference rejects ambiguous remotes and unsafe remote names', async () => {
  const repoRoot = await temporaryRepository('https://gitlab.com/acme/site.git');
  assert.equal(inferGitHubPagesConfig(repoRoot), null);

  for (const remote of [
    'http://github.com/acme/site.git',
    'https://token@github.com/acme/site.git',
    'https://github.com/acme/team/site.git',
    'https://github.com/acme/site.git?token=secret'
  ]) {
    runGit(repoRoot, ['remote', 'set-url', 'origin', remote]);
    assert.equal(inferGitHubPagesConfig(repoRoot), null, remote);
  }

  assert.throws(() => inferGitHubPagesConfig(repoRoot, '../origin'), { code: 'GIT_REMOTE_INVALID' });
});

test('setup backfills inferred Pages settings and preserves them across password updates', async () => {
  const repoRoot = await temporaryDirectory();
  const common = {
    repoRoot,
    username: 'owner',
    expectedBranch: 'candidate',
    validateCheckout: false,
    checkIgnored: false,
    scrypt,
    ...stoppedRuntime
  };
  await setupAdmin({ ...common, password: 'first secure password!' });
  runGit(repoRoot, ['init', '--quiet']);
  runGit(repoRoot, ['remote', 'add', 'origin', 'https://github.com/Acme-Co/Industrial-Catalog.git']);

  await setupAdmin({
    ...common,
    action: 'update-password',
    password: 'second secure password!'
  });
  const filePath = path.join(repoRoot, '.env.admin.local');
  const inferred = parseEnvText(await fs.readFile(filePath, 'utf8'));
  assert.equal(inferred.ADMIN_GIT_REMOTE, 'origin');
  assert.equal(inferred.GITHUB_REPOSITORY, 'Acme-Co/Industrial-Catalog');
  assert.equal(inferred.TEST_SITE_URL, 'https://acme-co.github.io');
  assert.equal(inferred.TEST_BASE_PATH, '/Industrial-Catalog');

  runGit(repoRoot, ['remote', 'set-url', 'origin', 'https://github.com/Other/new-site.git']);
  await setupAdmin({
    ...common,
    action: 'update-password',
    password: 'third secure password!'
  });
  const preserved = parseEnvText(await fs.readFile(filePath, 'utf8'));
  assert.equal(preserved.GITHUB_REPOSITORY, inferred.GITHUB_REPOSITORY);
  assert.equal(preserved.TEST_SITE_URL, inferred.TEST_SITE_URL);
  assert.equal(preserved.TEST_BASE_PATH, inferred.TEST_BASE_PATH);
});

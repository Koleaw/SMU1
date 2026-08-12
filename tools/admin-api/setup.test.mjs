import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { parseEnvText } from './config.mjs';
import {
  inspectAdminSetup,
  setupAdmin,
  validateAdminPassword,
  validateAdminUsername
} from './setup.mjs';
import { verifyPassword } from './security.mjs';

const tempDirs = [];
const scrypt = { N: 16384, r: 8, p: 1, keyLength: 32, salt: Buffer.alloc(24, 3) };

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-admin-setup-'));
  tempDirs.push(directory);
  return directory;
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
    scrypt
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

test('setup validation rejects default passwords and malformed usernames', () => {
  assert.throws(() => validateAdminPassword('admin', 'admin'), { code: 'PASSWORD_POLICY' });
  assert.throws(() => validateAdminPassword('change-me-forever', 'owner'), { code: 'PASSWORD_INSECURE_DEFAULT' });
  assert.throws(() => validateAdminUsername('../owner'), { code: 'USERNAME_INVALID' });
  assert.equal(validateAdminUsername('Павел.owner'), 'Павел.owner');
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLocalPreviewService, runLocalPreviewAstroBuild } from './local-preview.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-local-preview-'));
  await fs.mkdir(path.join(root, 'src', 'content', 'projects'), { recursive: true });
  await fs.mkdir(path.join(root, 'public', 'assets'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'content', 'projects', 'hidden.json'), JSON.stringify({ title: 'Hidden', slug: 'hidden', isActive: false }));
  await fs.writeFile(path.join(root, 'public', 'assets', 'sentinel.txt'), 'asset');
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) await fs.writeFile(path.join(root, file), '{}');
  await fs.writeFile(path.join(root, 'astro.config.mjs'), 'export default {};');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('local preview invokes the Astro CLI declared by the installed package and fails before spawn if missing', async (t) => {
  const root = await fixture(t);
  const packageRoot = path.join(root, 'node_modules', 'astro');
  const cli = path.join(packageRoot, 'bin', 'astro.mjs');
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ bin: { astro: './bin/astro.mjs' } }));
  await fs.writeFile(cli, 'export {};\n');
  const calls = [];
  const result = await runLocalPreviewAstroBuild({
    workspace: root,
    repoRoot: root,
    environment: { PATH: 'safe' },
    execute: async (...args) => {
      calls.push(args);
      return { stdout: 'built', stderr: '' };
    }
  });
  assert.deepEqual(result, { stdout: 'built', stderr: '' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [await fs.realpath(cli), 'build']);
  assert.equal(calls[0][2].cwd, root);

  await fs.unlink(cli);
  await assert.rejects(
    () => runLocalPreviewAstroBuild({
      workspace: root,
      repoRoot: root,
      environment: {},
      execute: async () => { throw new Error('must not spawn'); }
    }),
    { code: 'ASTRO_CLI_MISSING' }
  );
  assert.equal(calls.length, 1);
});

test('isolated preview enables only the copied record and serves built/public bytes to its owner', async (t) => {
  const root = await fixture(t);
  let clock = 10_000;
  let leaseRefreshes = 0;
  const service = createLocalPreviewService({
    repoRoot: root,
    runtimeDir: path.join(root, '.admin-runtime', 'local-preview'),
    now: () => clock,
    ttlMs: 1_000,
    randomToken: () => 'a'.repeat(32),
    origin: 'http://127.0.0.1:9999',
    environment: {
      PATH: 'safe-path',
      ADMIN_PASSWORD_HASH: 'must-not-reach-build',
      SESSION_SECRET: 'must-not-reach-build',
      GITHUB_TOKEN: 'must-not-reach-build',
      GITHUB_DEPLOY_TOKEN: 'must-not-reach-build',
      GIT_CONFIG_COUNT: '1',
      GIT_DIR: 'must-not-reach-build',
      NODE_OPTIONS: '--require=must-not-reach-build'
    },
    buildRunner: async ({ workspace, environment }) => {
      const overlaid = JSON.parse(await fs.readFile(path.join(workspace, 'src', 'content', 'projects', 'hidden.json'), 'utf8'));
      assert.equal(overlaid.isActive, true);
      assert.equal(environment.BASE_PATH, `/api/admin/local-preview/${'a'.repeat(32)}`);
      assert.equal(environment.PATH, 'safe-path');
      assert.equal(environment.NODE_ENV, 'production');
      for (const forbidden of ['ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'GITHUB_TOKEN', 'GITHUB_DEPLOY_TOKEN', 'GIT_CONFIG_COUNT', 'GIT_DIR', 'NODE_OPTIONS']) {
        assert.equal(Object.hasOwn(environment, forbidden), false, `${forbidden} must not reach the Astro preview build`);
      }
      const output = path.join(workspace, 'dist', 'vypolnennye-obekty', 'hidden');
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(path.join(output, 'index.html'), '<h1>preview</h1>');
    }
  });
  const result = await service.build({
    collection: 'projects', slug: 'hidden', revision: 'sha256:test', owner: 'owner-1',
    refreshLease: async () => { leaseRefreshes += 1; }
  });
  assert.ok(leaseRefreshes >= 2);
  assert.match(result.url, /vypolnennye-obekty\/hidden\/$/u);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'src', 'content', 'projects', 'hidden.json'), 'utf8')).isActive, false);
  assert.equal((await service.resolveAsset({ token: result.token, relativePath: 'vypolnennye-obekty/hidden/', owner: 'owner-1' })).bytes.toString(), '<h1>preview</h1>');
  assert.equal((await service.resolveAsset({ token: result.token, relativePath: 'assets/sentinel.txt', owner: 'owner-1' })).bytes.toString(), 'asset');
  await assert.rejects(() => service.resolveAsset({ token: result.token, relativePath: '../secret', owner: 'owner-1' }), { code: 'LOCAL_PREVIEW_PATH_INVALID' });
  await assert.rejects(() => service.resolveAsset({ token: result.token, relativePath: '', owner: 'owner-2' }), { code: 'LOCAL_PREVIEW_FORBIDDEN' });
  clock += 1_001;
  await assert.rejects(() => service.resolveAsset({ token: result.token, relativePath: '', owner: 'owner-1' }), { code: 'LOCAL_PREVIEW_EXPIRED' });
});

test('isolated preview resolves a preserved physical filename by the public content slug', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'src', 'content', 'static-pages'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'content', 'static-pages', 'about.json'),
    JSON.stringify({ title: 'О компании', slug: 'o-nas', isActive: false })
  );
  const service = createLocalPreviewService({
    repoRoot: root,
    runtimeDir: path.join(root, '.admin-runtime', 'local-preview'),
    randomToken: () => 'b'.repeat(32),
    origin: 'http://127.0.0.1:9999',
    buildRunner: async ({ workspace }) => {
      const overlaid = JSON.parse(await fs.readFile(path.join(workspace, 'src', 'content', 'static-pages', 'about.json'), 'utf8'));
      assert.equal(overlaid.isActive, true);
      const output = path.join(workspace, 'dist', 'o-nas');
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(path.join(output, 'index.html'), '<h1>alias preview</h1>');
    }
  });
  const result = await service.build({ collection: 'static-pages', slug: 'o-nas', revision: 'sha256:test', owner: 'owner-1' });
  assert.match(result.url, /o-nas\/$/u);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'src', 'content', 'static-pages', 'about.json'), 'utf8')).isActive, false);
});

test('startup cleanup removes only controlled incomplete or corrupt preview token directories', async (t) => {
  const root = await fixture(t);
  const runtimeDir = path.join(root, '.admin-runtime', 'local-preview');
  const incomplete = path.join(runtimeDir, 'c'.repeat(32));
  const corrupt = path.join(runtimeDir, 'd'.repeat(32));
  await fs.mkdir(path.join(incomplete, 'workspace'), { recursive: true });
  await fs.writeFile(path.join(incomplete, 'workspace', 'partial.txt'), 'partial');
  await fs.mkdir(corrupt, { recursive: true });
  await fs.writeFile(path.join(corrupt, 'metadata.json'), '{broken json');
  const sentinel = path.join(root, 'outside-sentinel.txt');
  await fs.writeFile(sentinel, 'keep');

  const service = createLocalPreviewService({ repoRoot: root, runtimeDir });
  await service.initialize();

  await assert.rejects(() => fs.access(incomplete), { code: 'ENOENT' });
  await assert.rejects(() => fs.access(corrupt), { code: 'ENOENT' });
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
});

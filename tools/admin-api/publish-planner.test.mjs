import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  PublishPlanError,
  classifyPublishPath,
  createCommittedTransactionManifest,
  createPublishGitEnvironment,
  createPublishPlanner,
  hashPublishBytes,
  resolveTransactionSelection,
} from './publish-planner.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return result.stdout.trim();
}

async function write(root, relativePath, value) {
  const absolute = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, value);
}

async function fixture(t) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'smu1-publish-planner-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const remote = path.join(sandbox, 'remote.git');
  const seed = path.join(sandbox, 'seed');
  await git(sandbox, 'init', '--bare', '--initial-branch=main', remote);
  await git(sandbox, 'init', '--initial-branch=main', seed);
  await git(seed, 'config', 'user.name', 'Publish Test');
  await git(seed, 'config', 'user.email', 'publish@example.invalid');
  await git(seed, 'config', 'core.autocrlf', 'false');
  await write(seed, 'src/content/products/item.json', '{"title":"base"}\n');
  await write(seed, 'src/data/yandex.json', '{"verification":"base"}\n');
  await write(seed, 'notes.txt', 'base\n');
  await git(seed, 'add', '--', 'src/content/products/item.json', 'src/data/yandex.json', 'notes.txt');
  await git(seed, 'commit', '-m', 'base');
  const base = await git(seed, 'rev-parse', 'HEAD');
  await git(seed, 'remote', 'add', 'origin', remote);
  await git(seed, 'push', 'origin', `${base}:refs/heads/main`, `${base}:refs/heads/v4-product-final-candidate`, `${base}:refs/heads/preview`);
  await git(seed, 'switch', '-c', 'v4-product-final-candidate');
  await git(seed, 'branch', '--set-upstream-to=origin/v4-product-final-candidate');
  return { sandbox, remote, seed, base };
}

function manifest({
  id,
  baseHead,
  at,
  mutations,
  dependencies = [],
  routes = ['/'],
  expectations = routes.map((route) => ({ route, expected: 'html' })),
  media = [],
}) {
  return createCommittedTransactionManifest({
    transactionId: id,
    baseHead,
    committedAt: at,
    dependencies,
    mutations,
    affectedRoutes: routes,
    routeExpectations: expectations,
    canonicalMedia: media,
    summary: id,
  });
}

test('strict classifier allows only exact content records, singletons, and canonical uploads', () => {
  const digest = 'a'.repeat(64);
  assert.equal(classifyPublishPath('src/content/products/item.json').kind, 'content-record');
  assert.equal(classifyPublishPath('src/data/navigation.json').allowed, true);
  assert.equal(classifyPublishPath('src/data/yandex.json').allowed, true);
  assert.equal(classifyPublishPath(`public/uploads/${digest}.webp`).kind, 'canonical-upload');
  for (const forbidden of [
    'src/content/products/Item.json',
    'src/data/other.json',
    'public/uploads/image.webp',
    'public/uploads/a.svg',
    'public/_media/h5/a.webp',
    '.admin-runtime/jobs/a.json',
    'tools/admin-api/server.mjs',
    '../src/content/products/item.json',
  ]) assert.equal(classifyPublishPath(forbidden).allowed, false, forbidden);
});

test('Git subprocess environment ignores inherited repository/index/config overrides', () => {
  const safe = createPublishGitEnvironment({
    PATH: 'git-path',
    GIT_DIR: 'outside.git',
    GIT_WORK_TREE: 'outside',
    GIT_INDEX_FILE: 'outside.index',
    GIT_OBJECT_DIRECTORY: 'outside.objects',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_PARAMETERS: "'alias.push'='!malicious'",
    GIT_CONFIG_GLOBAL: 'outside.gitconfig',
    GIT_CONFIG_KEY_0: 'alias.push',
    GIT_CONFIG_VALUE_0: '!malicious',
  });
  assert.equal(safe.PATH, 'git-path');
  assert.equal(safe.GIT_TERMINAL_PROMPT, '0');
  for (const key of [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0',
  ]) assert.equal(key in safe, false, key);
});

test('manifest selection includes explicit dependencies and earlier overlaps but blocks newer overlap', () => {
  const baseHead = '1'.repeat(40);
  const a = hashPublishBytes('a');
  const b = hashPublishBytes('b');
  const c = hashPublishBytes('c');
  const first = manifest({
    id: 'tx-first', baseHead, at: '2026-01-01T00:00:00Z',
    mutations: [{ path: 'src/content/products/item.json', operation: 'write', beforeHash: a, afterHash: b }],
  });
  const second = manifest({
    id: 'tx-second', baseHead, at: '2026-01-01T00:01:00Z', dependencies: ['tx-first'],
    mutations: [{ path: 'src/content/products/item.json', operation: 'write', beforeHash: b, afterHash: c }],
  });
  assert.deepEqual(resolveTransactionSelection({
    manifests: [second, first], selectedTransactionIds: ['tx-second'],
  }).selectedTransactionIds, ['tx-first', 'tx-second']);
  assert.throws(() => resolveTransactionSelection({
    manifests: [first, second], selectedTransactionIds: ['tx-first'],
  }), (error) => error instanceof PublishPlanError && error.code === 'PUBLISH_NEWER_OVERLAP_NOT_SELECTED');
  assert.throws(() => createCommittedTransactionManifest({
    transactionId: 'tx-missing-smoke',
    baseHead,
    committedAt: '2026-01-01T00:02:00Z',
    mutations: [{ path: 'src/content/products/item.json', operation: 'write', beforeHash: a, afterHash: b }],
    affectedRoutes: ['/catalog/item/'],
  }), (error) => error.code === 'PUBLISH_MANIFEST_ROUTE_EXPECTATIONS_REQUIRED');
});

test('planner returns the exact current net snapshot including yandex and ignores unrelated unstaged files', async (t) => {
  const repo = await fixture(t);
  const productPath = 'src/content/products/item.json';
  const yandexPath = 'src/data/yandex.json';
  const beforeProduct = hashPublishBytes(await readFile(path.join(repo.seed, ...productPath.split('/'))));
  const beforeYandex = hashPublishBytes(await readFile(path.join(repo.seed, ...yandexPath.split('/'))));
  const productBytes = '{"title":"selected"}\n';
  const yandexBytes = '{"verification":"selected"}\n';
  await write(repo.seed, productPath, productBytes);
  await write(repo.seed, yandexPath, yandexBytes);
  await write(repo.seed, 'notes.txt', 'unrelated unstaged\n');
  const tx = manifest({
    id: 'tx-content', baseHead: repo.base, at: '2026-01-01T00:00:00Z', routes: ['/catalog/item/'],
    mutations: [
      { path: productPath, operation: 'write', beforeHash: beforeProduct, afterHash: hashPublishBytes(productBytes) },
      { path: yandexPath, operation: 'write', beforeHash: beforeYandex, afterHash: hashPublishBytes(yandexBytes) },
    ],
  });

  const plan = await createPublishPlanner({ repoRoot: repo.seed }).plan({
    target: 'preview', lastSuccessfulPreviewSHA: repo.base,
    manifests: [tx], selectedTransactionIds: ['tx-content'],
  });
  assert.deepEqual(plan.paths.map((item) => item.path), [productPath, yandexPath]);
  assert.deepEqual(plan.affectedRoutes, ['/catalog/item/']);
  assert.deepEqual(plan.routeExpectations, [{ route: '/catalog/item/', expected: 'html' }]);
  assert.deepEqual(plan.unrelatedUnstaged, ['notes.txt']);
  assert.equal(plan.paths[0].currentHash, hashPublishBytes(productBytes));
  assert.equal(plan.remoteRefs.candidate, repo.base);
  assert.equal(plan.remoteRefs.preview, repo.base);
  assert.equal(plan.protectedMainSha, repo.base);
  assert.match(plan.fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(plan.commands, [
    ['branch', '--show-current'],
    ['rev-parse', 'HEAD'],
    ['cat-file', '-e', `${repo.base}^{commit}`],
    [
      'ls-remote', '--heads', 'origin',
      'refs/heads/v4-product-final-candidate',
      'refs/heads/preview',
      'refs/heads/main',
    ],
    ['diff', '--cached', '--name-only', '-z'],
    ['diff', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
    ['rev-parse', `${repo.base}:${productPath}`],
    ['cat-file', '--filters', `--path=${productPath}`, `${repo.base}:${productPath}`],
    ['hash-object', `--path=${productPath}`, productPath],
    ['rev-parse', `${repo.base}:${yandexPath}`],
    ['cat-file', '--filters', `--path=${yandexPath}`, `${repo.base}:${yandexPath}`],
    ['hash-object', `--path=${yandexPath}`, yandexPath],
  ]);

  const activeManifest = manifest({
    id: 'tx-active-route',
    baseHead: repo.base,
    at: '2026-01-01T00:01:00Z',
    routes: ['/catalog/item/'],
    mutations: [{
      path: productPath,
      operation: 'write',
      beforeHash: beforeProduct,
      afterHash: hashPublishBytes(productBytes),
    }],
  });
  const deletedManifest = manifest({
    id: 'tx-deleted-route',
    baseHead: repo.base,
    at: '2026-01-01T00:02:00Z',
    routes: ['/catalog/item/'],
    expectations: [{ route: '/catalog/item/', expected: 'not-found' }],
    mutations: [{
      path: yandexPath,
      operation: 'write',
      beforeHash: beforeYandex,
      afterHash: hashPublishBytes(yandexBytes),
    }],
  });
  await assert.rejects(
    createPublishPlanner({ repoRoot: repo.seed }).plan({
      target: 'preview',
      lastSuccessfulPreviewSHA: repo.base,
      manifests: [activeManifest, deletedManifest],
      selectedTransactionIds: [activeManifest.transactionId, deletedManifest.transactionId],
    }),
    (error) => error.code === 'PUBLISH_ROUTE_EXPECTATION_CONFLICT',
  );
});

test('planner safely re-anchors a transaction saved while the preceding exact publish was running', async (t) => {
  const repo = await fixture(t);
  const productPath = 'src/content/products/item.json';
  const yandexPath = 'src/data/yandex.json';
  await write(repo.seed, productPath, '{"title":"already published"}\n');
  await git(repo.seed, 'add', '--', productPath);
  await git(repo.seed, 'commit', '-m', 'content preview publish');
  const newAnchor = await git(repo.seed, 'rev-parse', 'HEAD');
  await git(repo.seed, 'push', 'origin', `${newAnchor}:refs/heads/v4-product-final-candidate`, `${newAnchor}:refs/heads/preview`);

  const before = hashPublishBytes(await readFile(path.join(repo.seed, ...yandexPath.split('/'))));
  const afterBytes = '{"verification":"saved during publish"}\n';
  await write(repo.seed, yandexPath, afterBytes);
  const savedDuringPublish = manifest({
    id: 'tx-saved-during-publish',
    baseHead: repo.base,
    at: '2026-01-01T00:01:00Z',
    mutations: [{ path: yandexPath, operation: 'write', beforeHash: before, afterHash: hashPublishBytes(afterBytes) }],
    routes: ['/kontakty/'],
  });

  const plan = await createPublishPlanner({ repoRoot: repo.seed }).plan({
    lastSuccessfulPreviewSHA: newAnchor,
    manifests: [savedDuringPublish],
    selectedTransactionIds: [savedDuringPublish.transactionId],
  });
  assert.equal(plan.baseHead, newAnchor);
  assert.deepEqual(plan.paths.map((item) => item.path), [yandexPath]);
  assert.deepEqual(plan.affectedRoutes, ['/kontakty/']);
  assert.deepEqual(plan.routeExpectations, [{ route: '/kontakty/', expected: 'html' }]);
});

test('planner separates raw transaction hashes from filtered Git objects under autocrlf', async (t) => {
  const repo = await fixture(t);
  const productPath = 'src/content/products/item.json';
  await git(repo.seed, 'config', 'core.autocrlf', 'true');
  const checkoutView = Buffer.from('{"title":"base"}\r\n', 'utf8');
  await write(repo.seed, productPath, checkoutView);
  const nextBytes = Buffer.from('{"title":"next"}\n', 'utf8');
  const beforeHash = hashPublishBytes(checkoutView);
  await write(repo.seed, productPath, nextBytes);
  const tx = manifest({
    id: 'tx-crlf', baseHead: repo.base, at: '2026-01-01T00:00:00Z',
    mutations: [{
      path: productPath,
      operation: 'write',
      beforeHash,
      afterHash: hashPublishBytes(nextBytes),
    }],
  });
  const plan = await createPublishPlanner({ repoRoot: repo.seed }).plan({
    lastSuccessfulPreviewSHA: repo.base,
    manifests: [tx],
    selectedTransactionIds: ['tx-crlf'],
  });
  assert.equal(plan.paths[0].beforeHash, beforeHash);
  assert.match(plan.paths[0].beforeGitOid, /^[a-f0-9]{40}$/u);
  assert.match(plan.paths[0].afterGitOid, /^[a-f0-9]{40}$/u);
  assert.notEqual(plan.paths[0].beforeGitOid, plan.paths[0].afterGitOid);
});

test('planner blocks unrelated staged changes, but accepts selected staged bytes only when exact', async (t) => {
  const repo = await fixture(t);
  const productPath = 'src/content/products/item.json';
  const before = hashPublishBytes(await readFile(path.join(repo.seed, ...productPath.split('/'))));
  const afterBytes = '{"title":"selected"}\n';
  await write(repo.seed, productPath, afterBytes);
  const tx = manifest({
    id: 'tx-stage', baseHead: repo.base, at: '2026-01-01T00:00:00Z',
    mutations: [{ path: productPath, operation: 'write', beforeHash: before, afterHash: hashPublishBytes(afterBytes) }],
  });
  const planner = createPublishPlanner({ repoRoot: repo.seed });

  await write(repo.seed, 'notes.txt', 'staged external\n');
  await git(repo.seed, 'add', '--', 'notes.txt');
  await assert.rejects(() => planner.plan({
    lastSuccessfulPreviewSHA: repo.base, manifests: [tx], selectedTransactionIds: ['tx-stage'],
  }), (error) => error.code === 'PUBLISH_UNRELATED_STAGED');

  await git(repo.seed, 'restore', '--staged', 'notes.txt');
  await git(repo.seed, 'add', '--', productPath);
  const exact = await planner.plan({
    lastSuccessfulPreviewSHA: repo.base, manifests: [tx], selectedTransactionIds: ['tx-stage'],
  });
  assert.deepEqual(exact.paths.map((item) => item.path), [productPath]);

  await write(repo.seed, productPath, '{"title":"external overlap"}\n');
  await assert.rejects(() => planner.plan({
    lastSuccessfulPreviewSHA: repo.base, manifests: [tx], selectedTransactionIds: ['tx-stage'],
  }), (error) => error.code === 'PUBLISH_OVERLAPPING_EXTERNAL_EDIT');
});

test('planner collapses transaction chains whose final bytes equal the successful anchor', async (t) => {
  const repo = await fixture(t);
  const productPath = 'src/content/products/item.json';
  const baseBytes = await readFile(path.join(repo.seed, ...productPath.split('/')));
  const baseHash = hashPublishBytes(baseBytes);
  const interimBytes = '{"title":"temporary"}\n';
  const interimHash = hashPublishBytes(interimBytes);
  const first = manifest({
    id: 'tx-away', baseHead: repo.base, at: '2026-01-01T00:00:00Z',
    mutations: [{ path: productPath, operation: 'write', beforeHash: baseHash, afterHash: interimHash }],
  });
  const second = manifest({
    id: 'tx-back', baseHead: repo.base, at: '2026-01-01T00:01:00Z', dependencies: ['tx-away'],
    mutations: [{ path: productPath, operation: 'write', beforeHash: interimHash, afterHash: baseHash }],
  });
  const plan = await createPublishPlanner({ repoRoot: repo.seed }).plan({
    lastSuccessfulPreviewSHA: repo.base, manifests: [first, second], selectedTransactionIds: ['tx-back'],
  });
  assert.equal(plan.empty, true);
  assert.equal(plan.paths.length, 0);
  assert.equal(plan.allPaths[0].netChanged, false);
});

test('production target is rejected before any Git subprocess is called', async () => {
  const commands = [];
  const planner = createPublishPlanner({
    repoRoot: process.cwd(),
    runGit: async (args) => {
      commands.push(args);
      throw new Error('must not run');
    },
  });
  await assert.rejects(() => planner.plan({ target: 'production' }), (error) => error.code === 'PRODUCTION_PUBLISH_FORBIDDEN');
  assert.deepEqual(commands, []);
});

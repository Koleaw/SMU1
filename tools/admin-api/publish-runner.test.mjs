import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  createCommittedTransactionManifest,
  createPublishPlanner,
  fingerprintPublishPlan,
  hashPublishBytes,
  runGitProcess,
} from './publish-planner.mjs';
import { createPublishRunner, PublishRunError } from './publish-runner.mjs';

const execFileAsync = promisify(execFile);
const BASE_SHA_FOR_EMPTY = '1'.repeat(40);

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
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'smu1-publish-runner-'));
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

async function createPlan(repo, changes) {
  const mutations = [];
  for (const [relativePath, nextBytes] of Object.entries(changes)) {
    const absolute = path.join(repo.seed, ...relativePath.split('/'));
    let before = 'missing';
    try {
      before = hashPublishBytes(await readFile(absolute));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (nextBytes === null) {
      await rm(absolute);
      mutations.push({ path: relativePath, operation: 'delete', beforeHash: before, afterHash: 'missing' });
    } else {
      await write(repo.seed, relativePath, nextBytes);
      mutations.push({
        path: relativePath,
        operation: 'write',
        beforeHash: before,
        afterHash: hashPublishBytes(nextBytes),
      });
    }
  }
  const manifest = createCommittedTransactionManifest({
    transactionId: 'tx-publish',
    baseHead: repo.base,
    committedAt: '2026-01-01T00:00:00Z',
    mutations,
    affectedRoutes: ['/catalog/item/'],
    routeExpectations: [{ route: '/catalog/item/', expected: 'html' }],
    canonicalMedia: mutations
      .filter((mutation) => mutation.operation === 'write' && mutation.path.startsWith('public/uploads/'))
      .map((mutation) => mutation.path),
  });
  return createPublishPlanner({ repoRoot: repo.seed }).plan({
    target: 'preview',
    lastSuccessfulPreviewSHA: repo.base,
    manifests: [manifest],
    selectedTransactionIds: ['tx-publish'],
  });
}

async function remoteRefs(repo) {
  return Object.fromEntries((await git(repo.seed, 'ls-remote', '--heads', 'origin'))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split(/\s+/u);
      return [ref, sha];
    }));
}

function successfulGate(assertion = async () => {}) {
  return async ({ checkoutDir, testedSha, gates, profile }) => {
    assert.equal(profile, 'content-only');
    assert.deepEqual(gates, [
      'schema-transaction-validation',
      'targeted-admin-tests',
      'astro-check',
      'build-media-prepare',
      'h5-media-budgets',
      'deploy-isolation',
      'exact-media-references',
      'publish-plan-consistency',
    ]);
    assert.equal(await git(checkoutDir, 'rev-parse', 'HEAD'), testedSha);
    assert.equal(await git(checkoutDir, 'status', '--porcelain', '--untracked-files=no'), '');
    await assertion(checkoutDir, testedSha);
    return { ok: true, testedSha, results: Object.fromEntries(gates.map((gate) => [gate, 'passed'])) };
  };
}

async function pathExists(value) {
  try {
    await access(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

test('runner startup janitor removes only stale owned publish workspaces', async (t) => {
  const repo = await fixture(t);
  const tempRoot = path.join(repo.sandbox, 'controlled-temp');
  const currentTime = Date.parse('2026-08-17T12:00:00.000Z');
  const retention = 60_000;
  const alivePid = 4242;
  const runner = createPublishRunner({
    repoRoot: repo.seed,
    tempRoot,
    gateRunner: successfulGate(),
    workspaceMaxAgeMs: retention,
    now: () => currentTime,
    isProcessAlive: (pid) => pid === alivePid,
  });
  const { workspacePrefix, markerName, repoRootIdentity } = runner.runtimePaths;

  async function createWorkspace(suffix, { marker = undefined, ageMs = retention * 2 } = {}) {
    const directory = path.join(tempRoot, `${workspacePrefix}${suffix}`);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'payload.bin'), 'left by interrupted publish');
    if (marker) await writeFile(path.join(directory, markerName), `${JSON.stringify(marker)}\n`, 'utf8');
    const timestamp = new Date(currentTime - ageMs);
    await utimes(directory, timestamp, timestamp);
    return directory;
  }

  const ownedMarker = (pid) => ({
    kind: 'smu1-publish-workspace',
    version: 1,
    repoRootIdentity,
    pid,
    createdAt: new Date(currentTime - retention * 2).toISOString(),
  });
  const stale = await createWorkspace('AAA111', { marker: ownedMarker(1111) });
  const active = await createWorkspace('BBB222', { marker: ownedMarker(alivePid) });
  const orphanedBeforeMarker = await createWorkspace('CCC333');
  const freshBeforeMarker = await createWorkspace('DDD444', { ageMs: 1_000 });
  const foreignMarker = await createWorkspace('EEE555', {
    marker: { ...ownedMarker(1111), repoRootIdentity: `sha256:${'f'.repeat(64)}` },
  });
  const unrelated = path.join(tempRoot, 'smu1-publish-someone-else');
  await mkdir(unrelated, { recursive: true });

  const result = await runner.initialize();
  assert.deepEqual(result, { scanned: 5, removed: 2, preserved: 3 });
  assert.equal(await pathExists(stale), false);
  assert.equal(await pathExists(orphanedBeforeMarker), false);
  assert.equal(await pathExists(active), true);
  assert.equal(await pathExists(freshBeforeMarker), true);
  assert.equal(await pathExists(foreignMarker), true);
  assert.equal(await pathExists(unrelated), true);
});

test('runner builds exact prospective commit in a temporary index, gates a clean clone, and atomically updates two refs only', async (t) => {
  const repo = await fixture(t);
  const productBytes = '{"title":"published"}\n';
  const yandexBytes = '{"verification":"published"}\n';
  const plan = await createPlan(repo, {
    'src/content/products/item.json': productBytes,
    'src/data/yandex.json': yandexBytes,
  });
  const tampered = structuredClone(plan);
  tampered.paths[0].afterHash = `sha256:${'0'.repeat(64)}:1`;
  let tamperedGitCalls = 0;
  const rejectingTamperedPlan = createPublishRunner({
    repoRoot: repo.seed,
    runGit: async () => {
      tamperedGitCalls += 1;
      throw new Error('must not run');
    },
    gateRunner: successfulGate(),
  });
  await assert.rejects(
    () => rejectingTamperedPlan.prepare(tampered),
    (error) => error.code === 'PUBLISH_PLAN_FINGERPRINT_MISMATCH',
  );
  assert.equal(tamperedGitCalls, 0);
  await write(repo.seed, 'notes.txt', 'unrelated unstaged stays local\n');
  const captured = {};
  const runner = createPublishRunner({
    repoRoot: repo.seed,
    tempRoot: path.join(repo.sandbox, 'controlled-temp'),
    gateRunner: successfulGate(async (checkoutDir, testedSha) => {
      captured.checkoutDir = checkoutDir;
      assert.equal(await readFile(path.join(checkoutDir, 'src/content/products/item.json'), 'utf8'), productBytes);
      assert.equal(await readFile(path.join(checkoutDir, 'src/data/yandex.json'), 'utf8'), yandexBytes);
      assert.equal(await readFile(path.join(checkoutDir, 'notes.txt'), 'utf8'), 'base\n');
      assert.equal(await git(checkoutDir, 'show', '--format=%H', '--no-patch'), testedSha);
    }),
  });

  const receipt = await runner.prepare(plan);
  assert.equal(receipt.status, 'committed');
  assert.match(receipt.testedSha, /^[a-f0-9]{40}$/u);
  assert.notEqual(receipt.testedSha, repo.base);
  assert.equal(await git(repo.seed, 'rev-parse', 'HEAD'), receipt.testedSha, 'local candidate must retain the tested commit');
  assert.equal(await git(repo.seed, 'diff', '--cached', '--name-only'), '', 'real index must match the committed exact tree');
  assert.equal(await git(repo.seed, 'status', '--short', '--', 'notes.txt'), 'M notes.txt', 'unrelated unstaged bytes must remain local');
  assert.equal(await git(repo.seed, 'show', `${receipt.testedSha}:notes.txt`), 'base');
  assert.equal(await git(repo.seed, 'show', `${receipt.testedSha}:src/content/products/item.json`), productBytes.trim());
  assert.equal(await git(repo.seed, 'show', `${receipt.testedSha}:src/data/yandex.json`), yandexBytes.trim());
  assert.deepEqual((await git(repo.seed, 'diff-tree', '--no-commit-id', '--name-only', '-r', receipt.testedSha)).split(/\r?\n/u), [
    'src/content/products/item.json',
    'src/data/yandex.json',
  ]);
  await assert.rejects(() => readFile(path.join(captured.checkoutDir, '.git', 'HEAD')), { code: 'ENOENT' });

  const broadCommands = receipt.commands.filter(({ args }) => args.includes('.') || args.includes('-A'));
  assert.deepEqual(broadCommands, []);
  assert.deepEqual(receipt.commands.filter(({ args, environment }) => args[0] === 'add' && environment === 'temporary-index').map(({ args }) => args), [
    ['add', '--', 'src/content/products/item.json'],
    ['add', '--', 'src/data/yandex.json'],
  ]);
  assert.deepEqual(receipt.commands.filter(({ args, environment }) => args[0] === 'add' && environment === 'default').map(({ args }) => args), [
    ['add', '--', 'src/content/products/item.json'],
    ['add', '--', 'src/data/yandex.json'],
  ]);
  assert.deepEqual(receipt.commands.find(({ args }) => args[0] === 'update-ref').args, [
    'update-ref',
    '-m',
    `smu1 admin content publish ${plan.fingerprint}`,
    'refs/heads/v4-product-final-candidate',
    receipt.testedSha,
    repo.base,
  ]);
  assert.deepEqual(receipt.commands.find(({ args }) => args[0] === 'fetch').args, [
    'fetch', '--no-tags', 'origin',
    '+refs/heads/v4-product-final-candidate:refs/remotes/origin/v4-product-final-candidate',
    '+refs/heads/preview:refs/remotes/origin/preview',
    '+refs/heads/main:refs/remotes/origin/main',
  ]);
  assert.deepEqual(receipt.commands.find(({ args }) => args[0] === 'merge-base').args, [
    'merge-base', '--is-ancestor', repo.base, repo.base,
  ]);
  assert.deepEqual(receipt.commands.find(({ args }) => args[0] === 'clone').args, [
    'clone', '--no-checkout', '--quiet', '--no-hardlinks', repo.seed, captured.checkoutDir,
  ]);

  const pushed = await runner.push(receipt);
  assert.equal(pushed.status, 'pushed');
  const pushCommands = pushed.commands.filter(({ args }) => args[0] === 'push');
  assert.deepEqual(pushCommands.map(({ args }) => args), [[
    'push',
    '--atomic',
    'origin',
    `${receipt.testedSha}:refs/heads/v4-product-final-candidate`,
    `${receipt.testedSha}:refs/heads/preview`,
  ]]);
  const refs = await remoteRefs(repo);
  assert.equal(refs['refs/heads/v4-product-final-candidate'], receipt.testedSha);
  assert.equal(refs['refs/heads/preview'], receipt.testedSha);
  assert.equal(refs['refs/heads/main'], repo.base);

  const retry = await runner.push(receipt);
  assert.equal(retry.testedSha, receipt.testedSha);
  assert.equal(retry.reconciled, true);
  assert.equal(retry.commands.some(({ args }) => args[0] === 'push'), false, 'successful retry must not create or push another commit');
});

test('runner stages a rename as exact delete/write paths and includes canonical media by content hash', async (t) => {
  const repo = await fixture(t);
  const mediaBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x01]);
  const mediaDigest = hashPublishBytes(mediaBytes).split(':')[1];
  const mediaPath = `public/uploads/${mediaDigest}.jpg`;
  const newPath = 'src/content/products/item-renamed.json';
  const plan = await createPlan(repo, {
    'src/content/products/item.json': null,
    [newPath]: '{"title":"renamed"}\n',
    [mediaPath]: mediaBytes,
  });
  const runner = createPublishRunner({ repoRoot: repo.seed, gateRunner: successfulGate() });
  const receipt = await runner.prepare(plan);
  assert.deepEqual(receipt.paths.map((item) => [item.path, item.operation]), [
    [mediaPath, 'write'],
    ['src/content/products/item-renamed.json', 'write'],
    ['src/content/products/item.json', 'delete'],
  ]);
  await assert.rejects(
    () => execFileAsync('git', ['cat-file', '-e', `${receipt.testedSha}:src/content/products/item.json`], {
      cwd: repo.seed,
      windowsHide: true,
    }),
  );
  assert.equal(await git(repo.seed, 'show', `${receipt.testedSha}:${newPath}`), '{"title":"renamed"}');
  const committedMedia = await execFileAsync('git', ['show', `${receipt.testedSha}:${mediaPath}`], {
    cwd: repo.seed,
    encoding: null,
    windowsHide: true,
  });
  assert.deepEqual(committedMedia.stdout, mediaBytes);
  assert.deepEqual(receipt.commands.filter(({ args }) => args[0] === 'update-index').map(({ args }) => args), [
    ['update-index', '--remove', '--', 'src/content/products/item.json'],
    ['update-index', '--remove', '--', 'src/content/products/item.json'],
  ]);
});

test('empty plan performs no Git operation, gate, commit, or push', async () => {
  let gitCalls = 0;
  let gateCalls = 0;
  const runner = createPublishRunner({
    repoRoot: process.cwd(),
    runGit: async () => {
      gitCalls += 1;
      throw new Error('must not run');
    },
    gateRunner: async () => {
      gateCalls += 1;
      throw new Error('must not run');
    },
  });
  const plan = {
    version: 1,
    target: 'preview',
    profile: 'content-only',
    remote: 'origin',
    refs: { candidate: 'v4-product-final-candidate', preview: 'preview', protected: 'main' },
    empty: true,
    paths: [],
    baseHead: BASE_SHA_FOR_EMPTY,
    anchorSha: BASE_SHA_FOR_EMPTY,
    protectedMainSha: BASE_SHA_FOR_EMPTY,
    remoteRefs: { candidate: BASE_SHA_FOR_EMPTY, preview: BASE_SHA_FOR_EMPTY, protected: BASE_SHA_FOR_EMPTY },
    selectedTransactionIds: [],
    transactionManifests: [],
    commitTimestamp: '2026-01-01T00:00:00.000Z',
    targetRefs: ['refs/heads/v4-product-final-candidate', 'refs/heads/preview'],
  };
  plan.fingerprint = fingerprintPublishPlan(plan);
  plan.planFingerprint = plan.fingerprint;
  const receipt = await runner.prepare(plan);
  assert.equal(receipt.status, 'empty');
  const result = await runner.push(receipt);
  assert.equal(result.status, 'empty');
  assert.equal(result.pushed, false);
  assert.equal(gitCalls, 0);
  assert.equal(gateCalls, 0);
});

test('runner detects remote-ahead after planning and does not create a prospective commit', async (t) => {
  const repo = await fixture(t);
  const plan = await createPlan(repo, { 'src/content/products/item.json': '{"title":"planned"}\n' });
  const attacker = path.join(repo.sandbox, 'attacker');
  await git(repo.sandbox, 'clone', '--branch', 'v4-product-final-candidate', repo.remote, attacker);
  await git(attacker, 'config', 'user.name', 'Remote Test');
  await git(attacker, 'config', 'user.email', 'remote@example.invalid');
  await write(attacker, 'notes.txt', 'remote ahead\n');
  await git(attacker, 'add', '--', 'notes.txt');
  await git(attacker, 'commit', '-m', 'remote ahead');
  const ahead = await git(attacker, 'rev-parse', 'HEAD');
  await git(attacker, 'push', '--atomic', 'origin', `${ahead}:refs/heads/v4-product-final-candidate`, `${ahead}:refs/heads/preview`);

  const runner = createPublishRunner({ repoRoot: repo.seed, gateRunner: successfulGate() });
  await assert.rejects(() => runner.prepare(plan), (error) => error instanceof PublishRunError && error.code === 'PUBLISH_REMOTE_AHEAD');
  const refs = await remoteRefs(repo);
  assert.equal(refs['refs/heads/main'], repo.base);
  assert.equal(refs['refs/heads/v4-product-final-candidate'], ahead);
  assert.equal(refs['refs/heads/preview'], ahead);
});

test('unrelated staged change introduced after planning blocks runner preparation', async (t) => {
  const repo = await fixture(t);
  const plan = await createPlan(repo, { 'src/content/products/item.json': '{"title":"planned"}\n' });
  await write(repo.seed, 'notes.txt', 'staged later\n');
  await git(repo.seed, 'add', '--', 'notes.txt');
  const runner = createPublishRunner({ repoRoot: repo.seed, gateRunner: successfulGate() });
  await assert.rejects(() => runner.prepare(plan), (error) => error.code === 'PUBLISH_UNRELATED_STAGED');
});

test('missing exact gate evidence fails closed before local commit or remote update', async (t) => {
  const repo = await fixture(t);
  const plan = await createPlan(repo, { 'src/content/products/item.json': '{"title":"gate-fail"}\n' });
  const runner = createPublishRunner({
    repoRoot: repo.seed,
    tempRoot: path.join(repo.sandbox, 'controlled-temp'),
    gateRunner: async ({ testedSha }) => ({ ok: true, testedSha, results: {} }),
  });
  await assert.rejects(() => runner.prepare(plan), (error) => {
    assert.equal(error.code, 'PUBLISH_GATES_FAILED');
    assert.equal(error.details.missingGateEvidence.length, 8);
    return true;
  });
  assert.equal(await git(repo.seed, 'rev-parse', 'HEAD'), repo.base);
  assert.equal(await git(repo.seed, 'diff', '--cached', '--name-only'), '');
  const refs = await remoteRefs(repo);
  assert.equal(refs['refs/heads/v4-product-final-candidate'], repo.base);
  assert.equal(refs['refs/heads/preview'], repo.base);
  assert.equal(refs['refs/heads/main'], repo.base);
});

test('unsupported atomic push is rejected without a sequential fallback or partial ref update', async (t) => {
  const repo = await fixture(t);
  const plan = await createPlan(repo, { 'src/content/products/item.json': '{"title":"atomic"}\n' });
  const runner = createPublishRunner({ repoRoot: repo.seed, gateRunner: successfulGate() });
  const receipt = await runner.prepare(plan);
  await git(repo.remote, 'config', 'receive.advertiseAtomic', 'false');

  const rejection = await runner.push(receipt).then(
    (value) => value,
    (error) => error,
  );
  assert.equal(rejection instanceof PublishRunError, true);
  assert.equal(rejection.code, 'PUBLISH_PUSH_REJECTED', JSON.stringify(rejection));
  assert.deepEqual(rejection.details.pushArgs, [
    'push', '--atomic', 'origin',
    `${receipt.testedSha}:refs/heads/v4-product-final-candidate`,
    `${receipt.testedSha}:refs/heads/preview`,
  ]);
  const refs = await remoteRefs(repo);
  assert.equal(refs['refs/heads/v4-product-final-candidate'], repo.base);
  assert.equal(refs['refs/heads/preview'], repo.base);
  assert.equal(refs['refs/heads/main'], repo.base);
});

test('explicit push rejection is reconciled without fallback and preserves every remote ref', async (t) => {
  const repo = await fixture(t);
  const plan = await createPlan(repo, { 'src/content/products/item.json': '{"title":"rejected"}\n' });
  const preparer = createPublishRunner({ repoRoot: repo.seed, gateRunner: successfulGate() });
  const receipt = await preparer.prepare(plan);
  const commands = [];
  const rejectingGit = async (args, options) => {
    commands.push([...args]);
    if (args[0] === 'push') {
      const error = new Error('remote rejected update');
      error.code = 'REMOTE_REJECTED';
      throw error;
    }
    return runGitProcess(args, options);
  };
  const runner = createPublishRunner({
    repoRoot: repo.seed,
    gateRunner: successfulGate(),
    runGit: rejectingGit,
  });
  await assert.rejects(() => runner.push(receipt), (error) => error.code === 'PUBLISH_PUSH_REJECTED');
  assert.deepEqual(commands.filter((args) => args[0] === 'push'), [[
    'push', '--atomic', 'origin',
    `${receipt.testedSha}:refs/heads/v4-product-final-candidate`,
    `${receipt.testedSha}:refs/heads/preview`,
  ]]);
  const refs = await remoteRefs(repo);
  assert.equal(refs['refs/heads/v4-product-final-candidate'], repo.base);
  assert.equal(refs['refs/heads/preview'], repo.base);
  assert.equal(refs['refs/heads/main'], repo.base);
});

test('unknown push result is reconciled by refs and a retry reuses the same tested commit', async (t) => {
  const repo = await fixture(t);
  const plan = await createPlan(repo, { 'src/content/products/item.json': '{"title":"unknown"}\n' });
  const preparer = createPublishRunner({ repoRoot: repo.seed, gateRunner: successfulGate() });
  const receipt = await preparer.prepare(plan);
  let interceptedPushes = 0;
  const unknownWithoutDelivery = async (args, options) => {
    if (args[0] === 'push') {
      interceptedPushes += 1;
      const error = new Error('connection lost before result');
      error.unknownResult = true;
      throw error;
    }
    return runGitProcess(args, options);
  };
  const uncertain = createPublishRunner({
    repoRoot: repo.seed,
    gateRunner: successfulGate(),
    runGit: unknownWithoutDelivery,
  });
  const unknown = await uncertain.push(receipt);
  assert.equal(unknown.status, 'unknown-network-result');
  assert.equal(unknown.retryable, true);
  assert.equal(unknown.testedSha, receipt.testedSha);
  assert.equal(interceptedPushes, 1);

  const retryRunner = createPublishRunner({ repoRoot: repo.seed, gateRunner: successfulGate() });
  const retried = await retryRunner.push(receipt);
  assert.equal(retried.status, 'pushed');
  assert.equal(retried.testedSha, receipt.testedSha);
  const refs = await remoteRefs(repo);
  assert.equal(refs['refs/heads/v4-product-final-candidate'], receipt.testedSha);
  assert.equal(refs['refs/heads/preview'], receipt.testedSha);
  assert.equal(refs['refs/heads/main'], repo.base);
});

test('network error after a successful atomic update reconciles to pushed', async (t) => {
  const repo = await fixture(t);
  const plan = await createPlan(repo, { 'src/content/products/item.json': '{"title":"delivered"}\n' });
  const preparer = createPublishRunner({ repoRoot: repo.seed, gateRunner: successfulGate() });
  const receipt = await preparer.prepare(plan);
  const deliveredThenUnknown = async (args, options) => {
    if (args[0] === 'push') {
      await runGitProcess(args, options);
      const error = new Error('connection lost after receive');
      error.unknownResult = true;
      throw error;
    }
    return runGitProcess(args, options);
  };
  const runner = createPublishRunner({
    repoRoot: repo.seed,
    gateRunner: successfulGate(),
    runGit: deliveredThenUnknown,
  });
  const result = await runner.push(receipt);
  assert.equal(result.status, 'pushed');
  assert.equal(result.reconciled, true);
  assert.equal(result.testedSha, receipt.testedSha);
});

test('split ref reconciliation blocks and production is rejected before Git', async (t) => {
  const repo = await fixture(t);
  const plan = await createPlan(repo, { 'src/content/products/item.json': '{"title":"split"}\n' });
  const runner = createPublishRunner({ repoRoot: repo.seed, gateRunner: successfulGate() });
  const receipt = await runner.prepare(plan);
  await git(repo.seed, 'push', 'origin', `${receipt.testedSha}:refs/heads/v4-product-final-candidate`);
  await assert.rejects(() => runner.push(receipt), (error) => error.code === 'PUBLISH_ATOMICITY_VIOLATION');

  let calls = 0;
  const noGitRunner = createPublishRunner({
    repoRoot: repo.seed,
    gateRunner: successfulGate(),
    runGit: async () => {
      calls += 1;
      throw new Error('must not run');
    },
  });
  await assert.rejects(() => noGitRunner.push(receipt, { target: 'production' }), (error) => error.code === 'PUBLISH_PRODUCTION_FORBIDDEN');
  assert.equal(calls, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  createExactSnapshot,
  createExactValidationService,
  ExactValidationError,
  exactBuildInvocation,
  hydrateExactMediaCache,
  installSnapshotBlobAtomically,
  renameAtomicWithTransientRetry,
  proveExactRunIdentity,
  transactionWithCumulativeExactClosure,
  EXACT_BINDING_REGISTRY_PATHS,
  EXACT_CONTENT_SCHEMA_PATHS,
  EXACT_H5_PIPELINE_PATHS
} from './exact-validation-service.mjs';

const execFileAsync = promisify(execFile);

const OWNER = Object.freeze({ owner: 'pavel', sessionFingerprint: 'session-test', recoveryClientId: 'browser-test' });

test('exact build invokes npm without a Windows command shell', () => {
  const windows = exactBuildInvocation({
    platform: 'win32',
    nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
    environment: { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' }
  });
  assert.deepEqual(windows, {
    command: path.win32.resolve('C:\\Program Files\\nodejs\\node.exe'),
    args: [
      path.win32.normalize('C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'),
      'run',
      'build:exact'
    ]
  });
  assert.equal(windows.args.some((value) => /(?:cmd\.exe|npm\.cmd)/iu.test(value)), false);

  const rejectedOverride = exactBuildInvocation({
    platform: 'win32',
    nodeExecutable: 'C:\\Node\\node.exe',
    environment: { npm_execpath: 'C:\\temp\\untrusted-runner.js' }
  });
  assert.equal(rejectedOverride.args[0], path.win32.normalize('C:\\Node\\node_modules\\npm\\bin\\npm-cli.js'));
  assert.deepEqual(exactBuildInvocation({ platform: 'linux' }), { command: 'npm', args: ['run', 'build:exact'] });
});

test('exact state atomic rename retries transient Windows sharing failures without a non-atomic fallback', async () => {
  const attempts = [];
  const waits = [];
  await renameAtomicWithTransientRetry('state.tmp', 'state.json', {
    delays: [1, 2, 3],
    wait: async (milliseconds) => { waits.push(milliseconds); },
    rename: async (...paths) => {
      attempts.push(paths);
      if (attempts.length < 3) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
    }
  });
  assert.equal(attempts.length, 3);
  assert.deepEqual(waits, [1, 2]);
  assert.ok(attempts.every(([source, target]) => source === 'state.tmp' && target === 'state.json'));

  let permanentAttempts = 0;
  await assert.rejects(
    renameAtomicWithTransientRetry('state.tmp', 'state.json', {
      wait: async () => { throw new Error('must not wait'); },
      rename: async () => {
        permanentAttempts += 1;
        throw Object.assign(new Error('missing source'), { code: 'ENOENT' });
      }
    }),
    { code: 'ENOENT' }
  );
  assert.equal(permanentAttempts, 1);
});

test('snapshot blob install retries transient Windows rename errors and preserves temp unless a validated collision exists', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-blob-rename-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const retriedTemp = path.join(root, 'retried.tmp');
  const retriedDestination = path.join(root, 'retried.blob');
  const retriedBytes = Buffer.from('retry-me');
  await fs.writeFile(retriedTemp, retriedBytes);
  let attempts = 0;
  const retried = await installSnapshotBlobAtomically(retriedTemp, retriedDestination, retriedBytes.length, {
    delays: [0],
    wait: async () => {},
    rename: async (source, target) => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
      await fs.rename(source, target);
    }
  });
  assert.equal(attempts, 2);
  assert.deepEqual(retried, { deduplicated: false });
  assert.deepEqual(await fs.readFile(retriedDestination), retriedBytes);
  await assert.rejects(fs.lstat(retriedTemp), (error) => error?.code === 'ENOENT');

  const collisionTemp = path.join(root, 'collision.tmp');
  const collisionDestination = path.join(root, 'collision.blob');
  const collisionBytes = Buffer.from('same-content');
  await Promise.all([
    fs.writeFile(collisionTemp, collisionBytes),
    fs.writeFile(collisionDestination, collisionBytes)
  ]);
  const collision = await installSnapshotBlobAtomically(collisionTemp, collisionDestination, collisionBytes.length, {
    rename: async () => { throw Object.assign(new Error('already exists'), { code: 'EEXIST' }); }
  });
  assert.deepEqual(collision, { deduplicated: true });
  assert.deepEqual(await fs.readFile(collisionDestination), collisionBytes);
  await assert.rejects(fs.lstat(collisionTemp), (error) => error?.code === 'ENOENT');

  const failedTemp = path.join(root, 'failed.tmp');
  const failedDestination = path.join(root, 'failed.blob');
  await fs.writeFile(failedTemp, retriedBytes);
  await assert.rejects(
    installSnapshotBlobAtomically(failedTemp, failedDestination, retriedBytes.length, {
      delays: [0],
      wait: async () => {},
      rename: async () => { throw Object.assign(new Error('still locked'), { code: 'EPERM' }); }
    }),
    (error) => error?.code === 'EPERM'
  );
  assert.deepEqual(await fs.readFile(failedTemp), retriedBytes, 'failed transient rename keeps the owned temp for recovery');
  await assert.rejects(fs.lstat(failedDestination), (error) => error?.code === 'ENOENT');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const started = Date.now();
  while (!await predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fixture(t, options = {}) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-service-'));
  const transactions = new Map();
  const history = [];
  function commit(transactionId, order) {
    const transaction = {
      transactionId,
      state: 'committed',
      createdAt: new Date(1_700_000_000_000 + order * 1000).toISOString(),
      updatedAt: new Date(1_700_000_000_000 + order * 1000).toISOString(),
      metadata: { affectedRoutes: [`/route-${order}/`], routeExpectations: [{ route: `/route-${order}/`, expected: 'html' }] },
      mutations: [{ path: `src/content/products/route-${order}.json`, operation: 'write', willChange: true }]
    };
    transactions.set(transactionId, transaction);
    history.push(transaction);
    return transaction;
  }
  const transactionService = {
    async getTransaction({ transactionId }) {
      const value = transactions.get(transactionId);
      if (!value) throw new Error('missing transaction');
      return structuredClone(value);
    },
    async listHistory() { return history.map((item) => structuredClone(item)); },
    async withStableRead(callback) { return callback(); }
  };
  let uuidIndex = 0;
  const uuids = options.uuids || [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004'
  ];
  const controls = [];
  let active = 0;
  let maxActive = 0;
  const runner = options.runner || (async ({ run, snapshot }) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const control = deferred();
    controls.push({ runId: run.runId, snapshot, control });
    try { return await control.promise; } finally { active -= 1; }
  });
  const service = createExactValidationService({
    repoRoot,
    runtimeDir: path.join(repoRoot, '.admin-runtime', 'exact'),
    transactionService,
    randomUUID: () => uuids[uuidIndex++],
    snapshotBuilder: async ({ runId, transaction }) => ({
      runId,
      transactionId: transaction.transactionId,
      sourceSha: 'a'.repeat(40),
      schemaHash: 'b'.repeat(64),
      bindingRegistryHash: 'c'.repeat(64),
      h5PipelineHash: 'd'.repeat(64),
      snapshotSha256: String(transaction.transactionId).padEnd(64, '0').slice(0, 64).replace(/[^a-f0-9]/gu, 'd'),
      affectedRoutes: transaction.metadata.affectedRoutes,
      routeExpectations: transaction.metadata.routeExpectations,
      closureTransactionIds: transaction.metadata.exactClosureTransactionIds,
      files: [],
      snapshotRoot: path.join(repoRoot, '.admin-runtime', 'exact', 'snapshots', runId)
    }),
    runner,
    identityValidator: options.identityValidator || (async () => ({ ok: true, reasons: [] })),
    ...(options.now ? { now: options.now } : {})
  });
  await service.initialize();
  t.after(async () => {
    await service.close();
    await fs.rm(repoRoot, { recursive: true, force: true });
  });
  return { service, commit, controls, get maxActive() { return maxActive; } };
}

test('exact queue runs one active build, keeps only latest pending, and rejects stale result', async (t) => {
  const fx = await fixture(t);
  fx.commit('tx-one', 1);
  fx.commit('tx-two', 2);
  fx.commit('tx-three', 3);

  const one = await fx.service.request({ ...OWNER, transactionId: 'tx-one' });
  await waitFor(() => fx.controls.length === 1);
  const two = await fx.service.request({ ...OWNER, transactionId: 'tx-two' });
  const three = await fx.service.request({ ...OWNER, transactionId: 'tx-three' });
  assert.equal((await fx.service.get({ ...OWNER, runId: two.runId })).status, 'superseded');
  assert.equal(fx.controls.length, 1, 'pending snapshots do not start alongside the active build');

  fx.controls[0].control.resolve({ artifact: { manifestSha256: 'e'.repeat(64), fileCount: 10, totalBytes: 100 }, diagnostics: { routeChecks: [] } });
  await waitFor(() => fx.controls.length === 2);
  assert.equal((await fx.service.get({ ...OWNER, runId: one.runId })).status, 'stale');
  assert.equal(fx.controls[1].runId, three.runId);
  assert.deepEqual(fx.controls[1].snapshot.routeExpectations, [
    { route: '/route-1/', expected: 'html' },
    { route: '/route-2/', expected: 'html' },
    { route: '/route-3/', expected: 'html' }
  ], 'latest pending exact snapshot carries the cumulative unverified route closure');
  fx.controls[1].control.resolve({ artifact: { manifestSha256: 'f'.repeat(64), fileCount: 11, totalBytes: 110 }, diagnostics: { routeChecks: [] } });
  await waitFor(async () => (await fx.service.get({ ...OWNER, runId: three.runId })).status === 'passed');

  const passed = await fx.service.get({ ...OWNER, runId: three.runId });
  assert.equal(passed.publishEligible, true);
  assert.equal(fx.maxActive, 1);
  assert.equal((await fx.service.assertPublishable({ ...OWNER, transactionIds: ['tx-three'] })).runId, three.runId);
  await assert.rejects(
    fx.service.assertPublishable({ ...OWNER, transactionIds: ['tx-one'] }),
    (error) => error instanceof ExactValidationError && error.code === 'EXACT_PUBLISH_BLOCKED'
  );
});

test('concurrent requests from different recovery profiles serialize snapshot closure repo-wide', async (t) => {
  const fx = await fixture(t);
  fx.commit('tx-tab-one', 1);
  fx.commit('tx-tab-two', 2);
  const firstPromise = fx.service.request({ ...OWNER, recoveryClientId: 'tab-one', transactionId: 'tx-tab-one' });
  const secondPromise = fx.service.request({ ...OWNER, recoveryClientId: 'tab-two', transactionId: 'tx-tab-two' });
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  await waitFor(() => fx.controls.length === 1);
  fx.controls[0].control.resolve({ artifact: { manifestSha256: '1'.repeat(64), fileCount: 1, totalBytes: 1 }, diagnostics: { routeChecks: [] } });
  await waitFor(() => fx.controls.length === 2);
  assert.equal(fx.controls[1].runId, second.runId);
  assert.deepEqual(fx.controls[1].snapshot.routeExpectations, [
    { route: '/route-1/', expected: 'html' },
    { route: '/route-2/', expected: 'html' }
  ]);
  assert.deepEqual(fx.controls[1].snapshot.closureTransactionIds, ['tx-tab-one', 'tx-tab-two']);
  fx.controls[1].control.resolve({ artifact: { manifestSha256: '2'.repeat(64), fileCount: 1, totalBytes: 1 }, diagnostics: { routeChecks: [] } });
  await waitFor(async () => (await fx.service.get({ ...OWNER, recoveryClientId: 'tab-two', runId: second.runId })).status === 'passed');
  await assert.rejects(
    fx.service.get({ ...OWNER, recoveryClientId: 'tab-one', runId: second.runId }),
    (error) => error.code === 'EXACT_RUN_NOT_FOUND'
  );
  assert.ok(first.runId);
});

test('the same owner transaction reuses queued, running and passed exact runs without duplicate work', async (t) => {
  const fx = await fixture(t);
  fx.commit('tx-idempotent', 1);
  const firstPromise = fx.service.request({ ...OWNER, transactionId: 'tx-idempotent' });
  const duplicatePromise = fx.service.request({ ...OWNER, transactionId: 'tx-idempotent' });
  const [first, duplicate] = await Promise.all([firstPromise, duplicatePromise]);
  assert.equal(duplicate.runId, first.runId);
  await waitFor(() => fx.controls.length === 1);
  fx.controls[0].control.resolve({ artifact: { manifestSha256: '3'.repeat(64), fileCount: 1, totalBytes: 1 }, diagnostics: { routeChecks: [] } });
  await waitFor(async () => (await fx.service.get({ ...OWNER, runId: first.runId })).status === 'passed');
  const afterPass = await fx.service.request({ ...OWNER, transactionId: 'tx-idempotent' });
  assert.equal(afterPass.runId, first.runId);
  assert.equal(fx.controls.length, 1, 'duplicate requests never start a second runner');
  assert.equal((await fx.service.overview(OWNER)).runs.filter((run) => run.transactionId === 'tx-idempotent').length, 1);
});

test('a passed exact revision resets the cumulative closure while latest semantics win for repeated routes', () => {
  const transaction = {
    transactionId: 'tx-current',
    metadata: {
      affectedRoutes: ['/same/', '/new/'],
      routeExpectations: [
        { route: '/same/', expected: 'html' },
        { route: '/new/', expected: 'html' }
      ]
    }
  };
  const prior = {
    transactionId: 'tx-prior',
    status: 'failed',
    closureTransactionIds: ['tx-older', 'tx-prior'],
    routeExpectations: [
      { route: '/old/', expected: 'html' },
      { route: '/same/', expected: 'not-found' }
    ]
  };
  const cumulative = transactionWithCumulativeExactClosure(transaction, prior);
  assert.deepEqual(cumulative.metadata.routeExpectations, [
    { route: '/new/', expected: 'html' },
    { route: '/old/', expected: 'html' },
    { route: '/same/', expected: 'html' }
  ]);
  assert.deepEqual(cumulative.metadata.exactClosureTransactionIds, ['tx-older', 'tx-prior', 'tx-current']);
  const reset = transactionWithCumulativeExactClosure(transaction, { ...prior, status: 'passed' });
  assert.deepEqual(reset.metadata.routeExpectations, transaction.metadata.routeExpectations.sort((a, b) => a.route.localeCompare(b.route, 'en')));
  assert.deepEqual(reset.metadata.exactClosureTransactionIds, ['tx-current']);
});

test('exact media cache hydration is bounded and uses independent workspace directory entries', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-media-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'workspace', 'public', '_media', 'h5');
  await fs.mkdir(path.join(source, 'aa'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(source, 'manifest.json'), '{"schemaVersion":1}\n'),
    fs.writeFile(path.join(source, 'aa', 'variant.webp'), Buffer.from('fixture-variant'))
  ]);
  const result = await hydrateExactMediaCache({ sourceRoot: source, destinationRoot: destination, maxFiles: 3, maxBytes: 100 });
  assert.equal(result.available, true);
  assert.equal(result.files, 2);
  assert.equal(result.hardlinked + result.copied, 2);
  assert.deepEqual(await fs.readFile(path.join(destination, 'aa', 'variant.webp')), Buffer.from('fixture-variant'));
  await fs.unlink(path.join(destination, 'aa', 'variant.webp'));
  assert.deepEqual(await fs.readFile(path.join(source, 'aa', 'variant.webp')), Buffer.from('fixture-variant'), 'workspace unlink cannot remove source cache');
  await assert.rejects(
    hydrateExactMediaCache({ sourceRoot: source, destinationRoot: path.join(source, 'nested') }),
    (error) => error.code === 'EXACT_MEDIA_CACHE_PATH_INVALID'
  );
  await assert.rejects(
    hydrateExactMediaCache({ sourceRoot: source, destinationRoot: path.join(root, 'too-many'), maxFiles: 1 }),
    (error) => error.code === 'EXACT_MEDIA_CACHE_LIMIT'
  );
});

test('failed exact build preserves committed revision, blocks publish, and can be retried', async (t) => {
  let attempt = 0;
  const fixedNow = new Date('2026-09-01T12:00:00.000Z');
  const fx = await fixture(t, {
    now: () => fixedNow,
    runner: async () => {
      attempt += 1;
      if (attempt === 1) throw new ExactValidationError('EXACT_BUILD_FAILED', 'fixture failure', { status: 422 });
      return { artifact: { manifestSha256: 'a'.repeat(64), fileCount: 1, totalBytes: 10 }, diagnostics: { routeChecks: [] } };
    }
  });
  fx.commit('tx-retry', 1);
  const failedRun = await fx.service.request({ ...OWNER, transactionId: 'tx-retry' });
  await waitFor(async () => (await fx.service.get({ ...OWNER, runId: failedRun.runId })).status === 'failed');
  await assert.rejects(
    fx.service.assertPublishable({ ...OWNER, transactionIds: ['tx-retry'] }),
    (error) => error.code === 'EXACT_PUBLISH_BLOCKED'
  );

  const retried = await fx.service.request({ ...OWNER, transactionId: 'tx-retry' });
  assert.notEqual(retried.runId, failedRun.runId, 'a failed run remains explicitly retryable');
  await waitFor(async () => (await fx.service.get({ ...OWNER, runId: retried.runId })).status === 'passed');
  assert.equal((await fx.service.get({ ...OWNER, runId: failedRun.runId })).current, false);
  assert.equal((await fx.service.assertPublishable({ ...OWNER, transactionIds: ['tx-retry'] })).runId, retried.runId);
  const overview = await fx.service.overview(OWNER);
  assert.equal(overview.runs[0].runId, retried.runId, 'requestSequence breaks equal requestedAt retry ties');
  assert.equal(overview.runs[0].requestSequence > overview.runs[1].requestSequence, true);
});

test('a later committed save makes a previously passed exact result stale at server publish gate', async (t) => {
  const fx = await fixture(t, {
    runner: async () => ({ artifact: { manifestSha256: 'b'.repeat(64), fileCount: 1, totalBytes: 10 } })
  });
  fx.commit('tx-current', 1);
  const run = await fx.service.request({ ...OWNER, transactionId: 'tx-current' });
  await waitFor(async () => (await fx.service.get({ ...OWNER, runId: run.runId })).status === 'passed');
  fx.commit('tx-newer', 2);
  await assert.rejects(
    fx.service.assertPublishable({ ...OWNER, transactionIds: ['tx-current'] }),
    (error) => error.code === 'EXACT_RESULT_STALE' && error.details.latestTransactionId === 'tx-newer'
  );
});

test('a persisted passed result becomes stale before overview or publish when source identity changes', async (t) => {
  let identityCurrent = true;
  const fx = await fixture(t, {
    runner: async () => ({ artifact: { manifestSha256: 'b'.repeat(64), fileCount: 1, totalBytes: 10 } }),
    identityValidator: async () => ({ ok: identityCurrent, reasons: identityCurrent ? [] : ['source-sha'] })
  });
  fx.commit('tx-identity', 1);
  const run = await fx.service.request({ ...OWNER, transactionId: 'tx-identity' });
  await waitFor(async () => (await fx.service.get({ ...OWNER, runId: run.runId })).status === 'passed');
  identityCurrent = false;
  const overview = await fx.service.overview(OWNER);
  assert.equal(overview.current, null);
  assert.equal(overview.runs[0].status, 'stale');
  assert.deepEqual(overview.runs[0].diagnostics.identityRevalidation.reasons, ['source-sha']);
  await assert.rejects(
    fx.service.assertPublishable({ ...OWNER, transactionIds: ['tx-identity'] }),
    (error) => error.code === 'EXACT_PUBLISH_BLOCKED'
  );
});

test('default immutable snapshot anchors Git source SHA, content bytes, schema and H5 hashes', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-snapshot-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(repoRoot, 'src', 'content', 'products'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(repoRoot, '.gitignore'), '.admin-runtime/\n'),
    fs.writeFile(path.join(repoRoot, 'src', 'content', 'products', 'bench.json'), '{"title":"До"}\n')
  ]);
  for (const relativePath of [
    ...EXACT_CONTENT_SCHEMA_PATHS,
    ...EXACT_BINDING_REGISTRY_PATHS,
    ...EXACT_H5_PIPELINE_PATHS
  ]) {
    const target = path.join(repoRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `fixture identity: ${relativePath}\n`);
  }
  await execFileAsync('git', ['init'], { cwd: repoRoot });
  await execFileAsync('git', ['config', 'user.email', 'exact@example.invalid'], { cwd: repoRoot });
  await execFileAsync('git', ['config', 'user.name', 'Exact Fixture'], { cwd: repoRoot });
  await execFileAsync('git', ['add', '.'], { cwd: repoRoot });
  await execFileAsync('git', ['commit', '-m', 'baseline'], { cwd: repoRoot });
  const nextBytes = Buffer.from('{"title":"После"}\n');
  await fs.writeFile(path.join(repoRoot, 'src', 'content', 'products', 'bench.json'), nextBytes);
  const runtimeDir = path.join(repoRoot, '.admin-runtime', 'exact');
  const snapshot = await createExactSnapshot({
    repoRoot,
    runtimeDir,
    runId: `exact-${'1'.repeat(32)}`,
    transaction: {
      transactionId: 'tx-snapshot',
      metadata: { affectedRoutes: ['/bench/'], routeExpectations: [{ route: '/bench/', expected: 'html' }] }
    }
  });
  assert.match(snapshot.sourceSha, /^[a-f0-9]{40}$/u);
  assert.match(snapshot.schemaHash, /^[a-f0-9]{64}$/u);
  assert.match(snapshot.bindingRegistryHash, /^[a-f0-9]{64}$/u);
  assert.match(snapshot.h5PipelineHash, /^[a-f0-9]{64}$/u);
  assert.equal(snapshot.files.length, 1);
  const item = snapshot.files[0];
  const blob = path.join(runtimeDir, 'blobs', 'sha256', item.sha256.slice(0, 2), item.sha256.slice(2));
  assert.deepEqual(await fs.readFile(blob), nextBytes);
  const identityRun = {
    sourceSha: snapshot.sourceSha,
    schemaHash: snapshot.schemaHash,
    bindingRegistryHash: snapshot.bindingRegistryHash,
    h5PipelineHash: snapshot.h5PipelineHash,
    snapshot
  };
  assert.equal((await proveExactRunIdentity({ repoRoot, run: identityRun })).ok, true);
  await fs.writeFile(path.join(repoRoot, 'src', 'content', 'products', 'bench.json'), '{"title":"Ещё новее"}\n');
  assert.deepEqual(await fs.readFile(blob), nextBytes, 'snapshot bytes do not follow later working-tree writes');
  const changedIdentity = await proveExactRunIdentity({ repoRoot, run: identityRun });
  assert.equal(changedIdentity.ok, false);
  assert.ok(changedIdentity.reasons.includes('snapshot-files'));

  await fs.writeFile(path.join(repoRoot, 'src', 'renderer.ts'), 'export const dirty = true;\n');
  await assert.rejects(
    createExactSnapshot({
      repoRoot,
      runtimeDir,
      runId: `exact-${'2'.repeat(32)}`,
      transaction: { transactionId: 'tx-dirty-source', metadata: {} }
    }),
    (error) => error.code === 'EXACT_SOURCE_DIRTY' && error.details.paths.includes('src/renderer.ts')
  );
});

test('every named exact schema, binding and H5 identity input exists in the repository', async () => {
  const groups = {
    schema: EXACT_CONTENT_SCHEMA_PATHS,
    bindings: EXACT_BINDING_REGISTRY_PATHS,
    h5: EXACT_H5_PIPELINE_PATHS
  };
  for (const [label, paths] of Object.entries(groups)) {
    assert.equal(new Set(paths).size, paths.length, `${label} identity paths must be unique`);
    for (const relativePath of paths) {
      const stat = await fs.lstat(path.join(process.cwd(), ...relativePath.split('/')));
      assert.equal(stat.isFile() && !stat.isSymbolicLink(), true, `${label}: ${relativePath}`);
    }
  }
  assert.equal(EXACT_H5_PIPELINE_PATHS.includes('tools/performance/media-config.mjs'), false);
});

test('real exact runner keeps the release BASE_PATH identity and returns per-route byte evidence', async () => {
  const source = await fs.readFile(new URL('./exact-validation-service.mjs', import.meta.url), 'utf8');
  assert.match(source, /const exactBasePath = exactBuildBasePath\(environment\.BASE_PATH \|\| environment\.TEST_BASE_PATH \|\| '\/'\)/u);
  assert.match(source, /BASE_PATH: exactBasePath,\s*TEST_BASE_PATH: exactBasePath/u);
  assert.match(source, /routeSha256: routeBytes \? sha256\(routeBytes\) : null/u);
  assert.match(source, /fallback404Sha256: fallbackBytes \? sha256\(fallbackBytes\) : null/u);
  assert.match(source, /targetedHtmlRoutes,/u);
});

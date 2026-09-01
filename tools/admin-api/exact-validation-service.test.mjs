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
  installSnapshotBlobAtomically,
  renameAtomicWithTransientRetry,
  EXACT_BINDING_REGISTRY_PATHS,
  EXACT_CONTENT_SCHEMA_PATHS,
  EXACT_H5_PIPELINE_PATHS
} from './exact-validation-service.mjs';

const execFileAsync = promisify(execFile);

const OWNER = Object.freeze({ owner: 'pavel', sessionFingerprint: 'session-test', recoveryClientId: 'browser-test' });

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
  const runner = options.runner || (async ({ run }) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const control = deferred();
    controls.push({ runId: run.runId, control });
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
      files: [],
      snapshotRoot: path.join(repoRoot, '.admin-runtime', 'exact', 'snapshots', runId)
    }),
    runner
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

test('failed exact build preserves committed revision, blocks publish, and can be retried', async (t) => {
  let attempt = 0;
  const fx = await fixture(t, {
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
  await waitFor(async () => (await fx.service.get({ ...OWNER, runId: retried.runId })).status === 'passed');
  assert.equal((await fx.service.get({ ...OWNER, runId: failedRun.runId })).current, false);
  assert.equal((await fx.service.assertPublishable({ ...OWNER, transactionIds: ['tx-retry'] })).runId, retried.runId);
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
  await fs.writeFile(path.join(repoRoot, 'src', 'content', 'products', 'bench.json'), '{"title":"Ещё новее"}\n');
  assert.deepEqual(await fs.readFile(blob), nextBytes, 'snapshot bytes do not follow later working-tree writes');

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  cleanupExactWorkspace,
  createExactSnapshot,
  createExactValidationService,
  ExactValidationError,
  exactBuildInvocation,
  garbageCollectExactRuntime,
  hydrateExactMediaCache,
  installSnapshotBlobAtomically,
  prepareExactDependencies,
  renameAtomicWithTransientRetry,
  runExactSnapshot,
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

test('Windows exact dependencies use independent hardlinks and survive workspace cleanup', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-dependencies-'));
  const source = path.join(root, 'source-node-modules');
  const destination = path.join(root, 'workspace-node-modules');
  await fs.mkdir(path.join(source, 'sharp'), { recursive: true });
  await fs.writeFile(path.join(source, 'sharp', 'package.json'), '{"name":"sharp"}\n');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const evidence = await prepareExactDependencies({ sourceRoot: source, destinationRoot: destination, platform: 'win32' });
  assert.equal(evidence.mode, 'hardlink-copy-tree');
  assert.equal(evidence.files, 1);
  assert.equal(evidence.hardlinked, 1);
  await fs.rm(destination, { recursive: true, force: true });
  assert.equal(await fs.readFile(path.join(source, 'sharp', 'package.json'), 'utf8'), '{"name":"sharp"}\n');
});

test('exact cleanup unlinks a dependency symlink without following it', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-cleanup-link-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  await execFileAsync('git', ['init'], { cwd: repoRoot });
  const runtimeDir = path.join(repoRoot, '.admin-runtime', 'exact');
  const runId = `exact-${'9'.repeat(32)}`;
  const workspace = path.join(runtimeDir, 'snapshots', runId, 'workspace');
  const external = path.join(repoRoot, 'external-dependencies');
  await Promise.all([
    fs.mkdir(workspace, { recursive: true }),
    fs.mkdir(external, { recursive: true })
  ]);
  await fs.writeFile(path.join(external, 'sentinel.txt'), 'do not delete\n');
  await fs.symlink(external, path.join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

  const cleaned = await cleanupExactWorkspace({ repoRoot, runtimeDir, runId, dependencyLinkInstalled: true });
  assert.deepEqual(cleaned, { removed: true, registered: false });
  assert.equal(await fs.readFile(path.join(external, 'sentinel.txt'), 'utf8'), 'do not delete\n');
  await assert.rejects(fs.lstat(workspace), (error) => error?.code === 'ENOENT');
});

test('registered exact cleanup retries transient Git removal and fails closed without orphaning registry state', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-cleanup-failure-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const runtimeDir = path.join(repoRoot, '.admin-runtime', 'exact');
  const runId = `exact-${'8'.repeat(32)}`;
  const workspace = path.join(runtimeDir, 'snapshots', runId, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  let attempts = 0;
  await assert.rejects(
    cleanupExactWorkspace({ repoRoot, runtimeDir, runId }, {
      registeredWorktrees: [workspace],
      delays: [0, 0],
      wait: async () => {},
      execFile: async (_command, args) => {
        assert.deepEqual(args.slice(0, 3), ['worktree', 'remove', '--force']);
        attempts += 1;
        throw Object.assign(new Error('fixture lock'), { code: 'EBUSY' });
      }
    }),
    (error) => error.code === 'EXACT_WORKTREE_REMOVE_FAILED'
  );
  assert.equal(attempts, 3, 'Git worktree removal is bounded and retried');
  assert.equal((await fs.lstat(workspace)).isDirectory(), true, 'registered workspace remains diagnosable after cleanup failure');
});

test('stale exact registry reconciliation prunes only owned runtime entries', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-stale-registry-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const runtimeDir = path.join(repoRoot, '.admin-runtime', 'exact');
  const runId = `exact-${'7'.repeat(32)}`;
  const snapshotRoot = path.join(runtimeDir, 'snapshots', runId);
  const workspace = path.join(snapshotRoot, 'workspace');
  await fs.mkdir(snapshotRoot, { recursive: true });
  let registered = true;
  const commands = [];
  const cleaned = await cleanupExactWorkspace({ repoRoot, runtimeDir, runId }, {
    listWorktrees: async () => registered ? [{ path: workspace, prunable: true }] : [],
    execFile: async (_command, args) => {
      commands.push(args);
      assert.deepEqual(args, ['worktree', 'prune', '--expire=now']);
      registered = false;
      return { stdout: '' };
    }
  });
  assert.deepEqual(cleaned, { removed: false, registered: true });
  assert.equal(commands.length, 1);

  const foreign = path.join(repoRoot, 'foreign-missing-worktree');
  registered = true;
  await assert.rejects(
    cleanupExactWorkspace({ repoRoot, runtimeDir, runId }, {
      listWorktrees: async () => [
        { path: workspace, prunable: true },
        { path: foreign, prunable: true }
      ],
      execFile: async () => { throw new Error('must not prune foreign state'); }
    }),
    (error) => error.code === 'EXACT_WORKTREE_PRUNE_BLOCKED'
  );
});

test('exact runner rejects a corrupted persisted snapshotRoot before Git or filesystem mutation', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-root-boundary-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-foreign-root-'));
  t.after(() => Promise.all([
    fs.rm(repoRoot, { recursive: true, force: true }),
    fs.rm(external, { recursive: true, force: true })
  ]));
  const runtimeDir = path.join(repoRoot, '.admin-runtime', 'exact');
  await Promise.all([fs.mkdir(runtimeDir, { recursive: true }), fs.writeFile(path.join(external, 'sentinel.txt'), 'safe\n')]);
  await assert.rejects(
    runExactSnapshot({
      repoRoot,
      runtimeDir,
      snapshot: {
        runId: `exact-${'6'.repeat(32)}`,
        transactionId: 'tx-corrupt-root',
        sourceSha: 'a'.repeat(40),
        snapshotRoot: external,
        files: [],
        affectedRoutes: ['/'],
        routeExpectations: [{ route: '/', expected: 'html' }]
      }
    }),
    (error) => error.code === 'EXACT_SNAPSHOT_ROOT_INVALID'
  );
  assert.equal(await fs.readFile(path.join(external, 'sentinel.txt'), 'utf8'), 'safe\n');
});

test('exact runtime GC retains live snapshots/blobs and removes only owned unreferenced data', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-runtime-gc-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  await execFileAsync('git', ['init'], { cwd: repoRoot });
  const runtimeDir = path.join(repoRoot, '.admin-runtime', 'exact');
  const keepRunId = `exact-${'5'.repeat(32)}`;
  const dropRunId = `exact-${'4'.repeat(32)}`;
  const keepHash = 'a'.repeat(64);
  const dropHash = 'b'.repeat(64);
  await Promise.all([
    fs.mkdir(path.join(runtimeDir, 'snapshots', keepRunId), { recursive: true }),
    fs.mkdir(path.join(runtimeDir, 'snapshots', dropRunId), { recursive: true }),
    fs.mkdir(path.join(runtimeDir, 'blobs', 'sha256', keepHash.slice(0, 2)), { recursive: true }),
    fs.mkdir(path.join(runtimeDir, 'blobs', 'sha256', dropHash.slice(0, 2)), { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(path.join(runtimeDir, 'blobs', 'sha256', keepHash.slice(0, 2), keepHash.slice(2)), 'keep'),
    fs.writeFile(path.join(runtimeDir, 'blobs', 'sha256', dropHash.slice(0, 2), dropHash.slice(2)), 'drop')
  ]);
  await garbageCollectExactRuntime({
    repoRoot,
    runtimeDir,
    retainedRuns: [{ runId: keepRunId, snapshot: { files: [{ operation: 'write', sha256: keepHash }] } }]
  });
  assert.equal((await fs.lstat(path.join(runtimeDir, 'snapshots', keepRunId))).isDirectory(), true);
  await assert.rejects(fs.lstat(path.join(runtimeDir, 'snapshots', dropRunId)), (error) => error?.code === 'ENOENT');
  assert.equal(await fs.readFile(path.join(runtimeDir, 'blobs', 'sha256', keepHash.slice(0, 2), keepHash.slice(2)), 'utf8'), 'keep');
  await assert.rejects(
    fs.lstat(path.join(runtimeDir, 'blobs', 'sha256', dropHash.slice(0, 2), dropHash.slice(2))),
    (error) => error?.code === 'ENOENT'
  );
});

test('exact runtime GC fails before deleting owned data when a foreign snapshot entry exists', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-runtime-foreign-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  await execFileAsync('git', ['init'], { cwd: repoRoot });
  const runtimeDir = path.join(repoRoot, '.admin-runtime', 'exact');
  const ownedRunId = `exact-${'2'.repeat(32)}`;
  const owned = path.join(runtimeDir, 'snapshots', ownedRunId);
  const foreign = path.join(runtimeDir, 'snapshots', 'foreign-data');
  await Promise.all([fs.mkdir(owned, { recursive: true }), fs.mkdir(foreign, { recursive: true })]);
  await assert.rejects(
    garbageCollectExactRuntime({ repoRoot, runtimeDir, retainedRuns: [] }),
    (error) => error.code === 'EXACT_RUNTIME_FOREIGN_ENTRY'
  );
  assert.equal((await fs.lstat(owned)).isDirectory(), true);
  assert.equal((await fs.lstat(foreign)).isDirectory(), true);
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

test('service restart removes a crash orphan safely and resumes only the persisted queued snapshot', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-crash-recovery-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(repoRoot, '.gitignore'), '.admin-runtime/\n');
  await execFileAsync('git', ['init'], { cwd: repoRoot });
  await execFileAsync('git', ['config', 'user.email', 'exact@example.invalid'], { cwd: repoRoot });
  await execFileAsync('git', ['config', 'user.name', 'Exact Fixture'], { cwd: repoRoot });
  await execFileAsync('git', ['add', '.'], { cwd: repoRoot });
  await execFileAsync('git', ['commit', '-m', 'baseline'], { cwd: repoRoot });
  const sourceSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' })).stdout.trim();
  const runtimeDir = path.join(repoRoot, '.admin-runtime', 'exact');
  const runId = `exact-${'3'.repeat(32)}`;
  const transactionId = 'tx-crash-recovery';
  const snapshotRoot = path.join(runtimeDir, 'snapshots', runId);
  const workspace = path.join(snapshotRoot, 'workspace');
  const external = path.join(repoRoot, 'external-node-modules');
  await Promise.all([fs.mkdir(workspace, { recursive: true }), fs.mkdir(external, { recursive: true })]);
  await fs.writeFile(path.join(external, 'sentinel.txt'), 'survives restart\n');
  await fs.symlink(external, path.join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const snapshotManifest = {
    version: 1,
    kind: 'smu1-exact-snapshot',
    runId,
    transactionId,
    sourceSha,
    schemaHash: 'b'.repeat(64),
    bindingRegistryHash: 'c'.repeat(64),
    h5PipelineHash: 'd'.repeat(64),
    affectedRoutes: ['/'],
    routeExpectations: [{ route: '/', expected: 'html' }],
    closureTransactionIds: [transactionId],
    files: []
  };
  const snapshotSha256 = crypto.createHash('sha256').update(JSON.stringify(snapshotManifest)).digest('hex');
  const snapshot = { ...snapshotManifest, snapshotSha256, snapshotRoot };
  const ownerKey = crypto.createHash('sha256')
    .update(`smu1-exact\0${OWNER.owner}\0${OWNER.recoveryClientId}`)
    .digest('hex');
  const timestamp = '2026-09-01T12:00:00.000Z';
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, 'state.json'), `${JSON.stringify({
    version: 1,
    sequence: 1,
    currentRunId: runId,
    activeRunId: runId,
    pendingRunId: null,
    runs: {
      [runId]: {
        runId,
        transactionId,
        revision: 'e'.repeat(64),
        sourceSha,
        schemaHash: snapshot.schemaHash,
        bindingRegistryHash: snapshot.bindingRegistryHash,
        h5PipelineHash: snapshot.h5PipelineHash,
        snapshotSha256,
        affectedRoutes: snapshot.affectedRoutes,
        routeExpectations: snapshot.routeExpectations,
        closureTransactionIds: snapshot.closureTransactionIds,
        snapshot,
        ownerKey,
        status: 'running',
        current: true,
        message: 'interrupted',
        requestSequence: 1,
        requestedAt: timestamp,
        startedAt: timestamp
      }
    }
  }, null, 2)}\n`);

  let resumed = 0;
  const service = createExactValidationService({
    repoRoot,
    runtimeDir,
    transactionService: {
      async getTransaction() { throw new Error('resume must not rebuild the transaction'); },
      async listHistory() { return []; },
      async withStableRead(callback) { return callback(); }
    },
    runner: async ({ snapshot: resumedSnapshot }) => {
      resumed += 1;
      assert.equal(resumedSnapshot.runId, runId);
      assert.equal(await fs.lstat(workspace).then(() => true).catch(() => false), false, 'orphan is removed before runner resumes');
      return { artifact: { manifestSha256: 'f'.repeat(64), fileCount: 1, totalBytes: 1 }, diagnostics: { recovered: true } };
    },
    identityValidator: async () => ({ ok: true, reasons: [] })
  });
  t.after(() => service.close());
  await service.initialize();
  await waitFor(async () => (await service.get({ ...OWNER, runId })).status === 'passed');
  assert.equal(resumed, 1);
  assert.equal(await fs.readFile(path.join(external, 'sentinel.txt'), 'utf8'), 'survives restart\n');
});

test('corrupted persisted snapshotRoot blocks recovery without touching a foreign directory', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-corrupt-state-'));
  const foreign = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-exact-corrupt-state-foreign-'));
  t.after(() => Promise.all([
    fs.rm(repoRoot, { recursive: true, force: true }),
    fs.rm(foreign, { recursive: true, force: true })
  ]));
  const runtimeDir = path.join(repoRoot, '.admin-runtime', 'exact');
  const runId = `exact-${'1'.repeat(32)}`;
  const transactionId = 'tx-corrupt-state';
  const manifest = {
    version: 1,
    kind: 'smu1-exact-snapshot',
    runId,
    transactionId,
    sourceSha: 'a'.repeat(40),
    schemaHash: 'b'.repeat(64),
    bindingRegistryHash: 'c'.repeat(64),
    h5PipelineHash: 'd'.repeat(64),
    affectedRoutes: ['/'],
    routeExpectations: [{ route: '/', expected: 'html' }],
    closureTransactionIds: [transactionId],
    files: []
  };
  const snapshotSha256 = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  await Promise.all([
    fs.mkdir(runtimeDir, { recursive: true }),
    fs.writeFile(path.join(foreign, 'sentinel.txt'), 'foreign survives\n')
  ]);
  await fs.writeFile(path.join(runtimeDir, 'state.json'), `${JSON.stringify({
    version: 1,
    sequence: 1,
    currentRunId: runId,
    activeRunId: runId,
    pendingRunId: null,
    runs: {
      [runId]: {
        runId,
        transactionId,
        revision: 'e'.repeat(64),
        sourceSha: manifest.sourceSha,
        schemaHash: manifest.schemaHash,
        bindingRegistryHash: manifest.bindingRegistryHash,
        h5PipelineHash: manifest.h5PipelineHash,
        snapshotSha256,
        affectedRoutes: manifest.affectedRoutes,
        routeExpectations: manifest.routeExpectations,
        closureTransactionIds: manifest.closureTransactionIds,
        snapshot: { ...manifest, snapshotSha256, snapshotRoot: foreign },
        ownerKey: 'f'.repeat(64),
        status: 'running',
        current: true,
        message: 'corrupt',
        requestSequence: 1,
        requestedAt: '2026-09-01T12:00:00.000Z'
      }
    }
  }, null, 2)}\n`);
  const service = createExactValidationService({
    repoRoot,
    runtimeDir,
    transactionService: {
      async getTransaction() { throw new Error('unused'); },
      async listHistory() { return []; },
      async withStableRead(callback) { return callback(); }
    },
    runner: async () => { throw new Error('must not run'); }
  });
  await assert.rejects(service.initialize(), (error) => error.code === 'EXACT_STATE_CORRUPT');
  assert.equal(await fs.readFile(path.join(foreign, 'sentinel.txt'), 'utf8'), 'foreign survives\n');
});

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

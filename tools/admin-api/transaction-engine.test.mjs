import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SimulatedCrashError,
  TRANSACTION_FAULT_PHASES,
  TRANSACTION_STATES,
  createTransactionEngine,
  hashPayload,
  revisionForBytes
} from './transaction-engine.mjs';

async function createFixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-transaction-engine-'));
  const repoRoot = path.join(root, 'repo');
  const runtimeDir = options.runtimeInsideRepo
    ? path.join(repoRoot, '.admin-runtime', 'transactions')
    : path.join(root, 'runtime');
  await fs.mkdir(repoRoot, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const engine = createTransactionEngine({
    repoRoot,
    runtimeDir,
    lockTtlMs: 2_000,
    ...options.engineOptions
  });
  if (options.initialize !== false) await engine.initialize();

  const write = async (relativePath, value) => {
    const target = path.join(repoRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, value);
  };
  const read = (relativePath) => fs.readFile(path.join(repoRoot, ...relativePath.split('/')));
  const exists = async (relativePath) => fs.access(path.join(repoRoot, ...relativePath.split('/')))
    .then(() => true, () => false);

  return { root, repoRoot, runtimeDir, engine, write, read, exists };
}

function request(key, mutations, readSet = []) {
  return {
    owner: 'pavel',
    recoveryClientId: 'browser-installation-a',
    idempotencyKey: key,
    mutations,
    readSet
  };
}

function applyRequest(preview, key) {
  return {
    owner: 'pavel',
    recoveryClientId: 'browser-installation-a',
    idempotencyKey: key,
    transactionId: preview.transactionId,
    payloadHash: preview.payloadHash
  };
}

test('preview/apply writes exact paths, stores exact backups and commits idempotently', async (t) => {
  const fixture = await createFixture(t);
  const oldBytes = Buffer.from([0, 1, 2, 3, 255, 10]);
  const newBytes = Buffer.from([9, 0, 8, 7, 6, 255]);
  await fixture.write('content/a.bin', oldBytes);
  await fixture.write('content/remove.txt', 'remove me exactly\r\n');
  await fixture.write('content/guard.txt', 'guard-v1');

  const key = 'commit-exact-files';
  const preview = await fixture.engine.preview(request(key, [
    { path: 'content/a.bin', operation: 'write', bytes: newBytes },
    { path: 'content/new.txt', operation: 'write', content: 'новый файл\n' },
    { path: 'content/remove.txt', operation: 'delete' }
  ], [{ path: 'content/guard.txt' }]));

  assert.equal(preview.state, TRANSACTION_STATES.PREPARED);
  assert.equal(preview.reused, false);
  assert.deepEqual(await fixture.engine.listHistory(), []);
  const prepared = await fixture.engine.getTransaction(preview.transactionId);
  assert.equal(prepared.state, TRANSACTION_STATES.PREPARED);
  assert.deepEqual(prepared.backups, []);
  assert.ok(prepared.revisions.some((entry) => entry.path === 'content/guard.txt'));

  const applied = await fixture.engine.apply(applyRequest(preview, key));
  assert.equal(applied.state, TRANSACTION_STATES.COMMITTED);
  assert.deepEqual(await fixture.read('content/a.bin'), newBytes);
  assert.equal((await fixture.read('content/new.txt')).toString('utf8'), 'новый файл\n');
  assert.equal(await fixture.exists('content/remove.txt'), false);

  const committed = await fixture.engine.getTransaction(preview.transactionId);
  assert.equal(committed.state, TRANSACTION_STATES.COMMITTED);
  assert.equal(committed.backups.length, 3);
  const oldBackup = committed.backups.find((entry) => entry.path === 'content/a.bin');
  const newFileMarker = committed.backups.find((entry) => entry.path === 'content/new.txt');
  assert.equal(oldBackup.exists, true);
  assert.equal(oldBackup.revision, revisionForBytes(oldBytes));
  assert.deepEqual(
    await fs.readFile(path.join(fixture.engine.runtimePaths.backupRoot, preview.transactionId, oldBackup.file)),
    oldBytes
  );
  assert.deepEqual(
    { exists: newFileMarker.exists, revision: newFileMarker.revision, file: newFileMarker.file },
    { exists: false, revision: 'missing', file: null }
  );
  assert.equal((await fixture.engine.listHistory()).length, 1);

  const repeated = await fixture.engine.apply(applyRequest(preview, key));
  assert.equal(repeated.state, TRANSACTION_STATES.COMMITTED);
  assert.equal(repeated.reused, true);
  assert.equal((await fixture.engine.listHistory()).length, 1);
});

test('beforeApply runs under the writer lease after revision recheck and before backup or write', async (t) => {
  const fixture = await createFixture(t);
  await fixture.write('content/checked.txt', 'before');
  const key = 'semantic-before-apply';
  const preview = await fixture.engine.preview(request(key, [
    { path: 'content/checked.txt', operation: 'write', content: 'after' }
  ]));
  let hookJournal;
  await assert.rejects(
    fixture.engine.apply(applyRequest(preview, key), {
      beforeApply({ journal }) {
        hookJournal = journal;
        const error = new Error('semantic validation rejected');
        error.code = 'SEMANTIC_RECHECK_FAILED';
        throw error;
      }
    }),
    (error) => error.code === 'SEMANTIC_RECHECK_FAILED'
  );
  assert.equal(hookJournal.state, TRANSACTION_STATES.PREPARED);
  assert.equal((await fixture.read('content/checked.txt')).toString('utf8'), 'before');
  const journal = await fixture.engine.getTransaction(preview.transactionId);
  assert.equal(journal.state, TRANSACTION_STATES.PREPARED);
  assert.deepEqual(journal.backups, []);
});

test('an exact no-op persists idempotency but creates no journal, backup or history', async (t) => {
  const fixture = await createFixture(t);
  await fixture.write('content/same.txt', 'same bytes');
  const key = 'no-op-key';
  const first = await fixture.engine.preview(request(key, [
    { path: 'content/same.txt', operation: 'write', content: 'same bytes' },
    { path: 'content/already-missing.txt', operation: 'delete' }
  ]));
  assert.deepEqual(
    { transactionId: first.transactionId, state: first.state, reused: first.reused },
    { transactionId: null, state: TRANSACTION_STATES.NO_OP, reused: false }
  );
  const second = await fixture.engine.preview(request(key, [
    { path: 'content/same.txt', operation: 'write', content: 'same bytes' },
    { path: 'content/already-missing.txt', operation: 'delete' }
  ]));
  assert.equal(second.reused, true);
  assert.deepEqual(await fs.readdir(fixture.engine.runtimePaths.journalDir), []);
  assert.deepEqual(await fs.readdir(fixture.engine.runtimePaths.backupRoot), []);
  assert.deepEqual(await fixture.engine.listHistory(), []);
});

test('idempotency binding survives restart and rejects the same key with a different payload', async (t) => {
  const fixture = await createFixture(t);
  await fixture.write('content/value.txt', 'old');
  const key = 'persistent-idempotency';
  const originalRequest = request(key, [{ path: 'content/value.txt', operation: 'write', content: 'new' }]);
  const first = await fixture.engine.preview(originalRequest);

  await assert.rejects(
    fixture.engine.preview(request(key, [{ path: 'content/value.txt', operation: 'write', content: 'different' }])),
    (error) => error.code === 'IDEMPOTENCY_KEY_REUSED'
  );

  const restarted = createTransactionEngine({
    repoRoot: fixture.repoRoot,
    runtimeDir: fixture.runtimeDir,
    lockTtlMs: 2_000
  });
  await restarted.initialize();
  const reused = await restarted.preview(originalRequest);
  assert.equal(reused.transactionId, first.transactionId);
  assert.equal(reused.payloadHash, first.payloadHash);
  assert.equal(reused.reused, true);
});

test('preview persists validated history metadata and restore plan exposes exact inverse bytes', async (t) => {
  const fixture = await createFixture(t);
  const exactBefore = Buffer.from([123, 13, 10, 0, 255, 125]);
  await fixture.write('content/record.json', exactBefore);
  const metadata = {
    userSummary: 'Обновлена карточка объекта',
    affectedRoutes: ['/objects/b/', '/objects/a/', '/objects/a/'],
    baseHead: 'a'.repeat(40),
    relationImpact: { products: 2 }
  };
  const key = 'metadata-and-restore';
  const preview = await fixture.engine.preview({
    ...request(key, [
      { path: 'content/record.json', operation: 'write', content: '{"next":true}\n' },
      { path: 'content/created.json', operation: 'write', content: '{}\n' }
    ]),
    metadata
  });
  assert.deepEqual(preview.metadata, {
    affectedRoutes: ['/objects/a/', '/objects/b/'],
    baseHead: 'a'.repeat(40),
    relationImpact: { products: 2 },
    userSummary: 'Обновлена карточка объекта'
  });
  await fixture.engine.apply(applyRequest(preview, key));
  const [history] = await fixture.engine.listHistory();
  assert.deepEqual(history.metadata, preview.metadata);

  const restore = await fixture.engine.createRestorePlan(preview.transactionId);
  const restoreExisting = restore.mutations.find((entry) => entry.path === 'content/record.json');
  const restoreCreated = restore.mutations.find((entry) => entry.path === 'content/created.json');
  assert.deepEqual(Buffer.from(restoreExisting.bytesBase64, 'base64'), exactBefore);
  assert.equal(restoreExisting.operation, 'write');
  assert.equal(restoreCreated.operation, 'delete');
  assert.equal(restore.metadata.restoresTransactionId, preview.transactionId);
  assert.deepEqual(restore.metadata.affectedRoutes, ['/objects/a/', '/objects/b/']);

  const restorePreview = await fixture.engine.preview({
    ...request('apply-restore', restore.mutations),
    metadata: restore.metadata
  });
  await fixture.engine.apply(applyRequest(restorePreview, 'apply-restore'));
  assert.deepEqual(await fixture.read('content/record.json'), exactBefore);
  assert.equal(await fixture.exists('content/created.json'), false);

  await assert.rejects(
    fixture.engine.preview({
      ...request('bad-metadata', [{ path: 'content/x.json', operation: 'write', content: '{}' }]),
      metadata: { userSummary: ' bad ', affectedRoutes: ['//evil.example'], baseHead: 'short' }
    }),
    (error) => error.code === 'TRANSACTION_METADATA_INVALID'
  );
});

test('apply rechecks the complete read set and write set while holding the repository lock', async (t) => {
  await t.test('read-set conflict', async (t) => {
    const fixture = await createFixture(t);
    await fixture.write('content/value.txt', 'old');
    await fixture.write('content/guard.txt', 'guard-v1');
    const key = 'read-set-conflict';
    const preview = await fixture.engine.preview(request(key, [
      { path: 'content/value.txt', operation: 'write', content: 'new' }
    ], [{ path: 'content/guard.txt' }]));
    await fixture.write('content/guard.txt', 'guard-v2');

    await assert.rejects(
      fixture.engine.apply(applyRequest(preview, key)),
      (error) => error.code === 'TRANSACTION_REVISION_CONFLICT'
        && error.details.conflicts.some((entry) => entry.path === 'content/guard.txt')
    );
    assert.equal((await fixture.read('content/value.txt')).toString(), 'old');
    assert.equal((await fixture.engine.getTransaction(preview.transactionId)).state, TRANSACTION_STATES.PREPARED);
  });

  await t.test('write-set conflict', async (t) => {
    const fixture = await createFixture(t);
    await fixture.write('content/value.txt', 'old');
    const key = 'write-set-conflict';
    const preview = await fixture.engine.preview(request(key, [
      { path: 'content/value.txt', operation: 'write', content: 'new' }
    ]));
    await fixture.write('content/value.txt', 'external edit');

    await assert.rejects(
      fixture.engine.apply(applyRequest(preview, key)),
      (error) => error.code === 'TRANSACTION_REVISION_CONFLICT'
        && error.details.conflicts.some((entry) => entry.path === 'content/value.txt')
    );
    assert.equal((await fixture.read('content/value.txt')).toString(), 'external edit');
  });
});

test('managed paths stay inside repo, cannot target runtime, and reject symlink traversal', async (t) => {
  const fixture = await createFixture(t, { runtimeInsideRepo: true });

  await assert.rejects(
    fixture.engine.preview(request('traversal', [{ path: '../escape.txt', operation: 'write', content: 'x' }])),
    (error) => error.code === 'TRANSACTION_PATH_INVALID'
  );
  await assert.rejects(
    fixture.engine.preview(request('absolute', [{ path: path.join(fixture.repoRoot, 'escape.txt'), operation: 'write', content: 'x' }])),
    (error) => error.code === 'TRANSACTION_PATH_INVALID'
  );
  await assert.rejects(
    fixture.engine.preview(request('runtime', [{ path: '.admin-runtime/transactions/idempotency.json', operation: 'delete' }])),
    (error) => error.code === 'TRANSACTION_RUNTIME_PATH_FORBIDDEN'
  );

  const outside = path.join(fixture.root, 'outside');
  await fs.mkdir(outside);
  try {
    await fs.symlink(outside, path.join(fixture.repoRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.diagnostic('Symlink creation is unavailable; containment/runtime assertions still ran.');
      return;
    }
    throw error;
  }
  await assert.rejects(
    fixture.engine.preview(request('symlink', [{ path: 'linked/escape.txt', operation: 'write', content: 'x' }])),
    (error) => error.code === 'TRANSACTION_SYMLINK_FORBIDDEN'
  );
  assert.equal(await fixture.exists('../outside/escape.txt'), false);
});

test('repo lock uses exclusive creation and only takes over a verified expired lease', async (t) => {
  const fixture = await createFixture(t, { initialize: false });
  await fs.mkdir(fixture.runtimeDir, { recursive: true });
  const lockPath = path.join(fixture.runtimeDir, 'repo.lock');
  const active = {
    version: 1,
    ownerToken: 'active-owner',
    instanceId: 'other-process',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expiresAtMs: Date.now() + 60_000
  };
  await fs.writeFile(lockPath, `${JSON.stringify(active)}\n`);
  await assert.rejects(fixture.engine.initialize(), (error) => error.code === 'TRANSACTION_LOCKED');

  await fs.writeFile(lockPath, '{not-json}\n');
  const invalidEngine = createTransactionEngine({
    repoRoot: fixture.repoRoot,
    runtimeDir: fixture.runtimeDir,
    lockTtlMs: 2_000
  });
  await assert.rejects(invalidEngine.initialize(), (error) => error.code === 'TRANSACTION_LOCK_INVALID');

  const expired = {
    ...active,
    ownerToken: 'expired-owner',
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAtMs: Date.now() - 60_000
  };
  await fs.writeFile(lockPath, `${JSON.stringify(expired)}\n`);
  const takeoverEngine = createTransactionEngine({
    repoRoot: fixture.repoRoot,
    runtimeDir: fixture.runtimeDir,
    lockTtlMs: 2_000
  });
  await takeoverEngine.initialize();
  assert.equal(await fs.access(lockPath).then(() => true, () => false), false);
  assert.equal((await fs.readdir(fixture.runtimeDir)).some((name) => name.includes('.stale-')), false);
});

test('stable read boundary blocks during apply and requires recovery after a simulated crash', async (t) => {
  let enteredApplying;
  let releaseApplying;
  const applying = new Promise((resolve) => { enteredApplying = resolve; });
  const gate = new Promise((resolve) => { releaseApplying = resolve; });
  let waitOnce = true;
  const fixture = await createFixture(t, {
    engineOptions: {
      async faultInjector(event) {
        if (waitOnce && event.phase === 'apply:after-journal-applying') {
          waitOnce = false;
          enteredApplying();
          await gate;
        }
      }
    }
  });
  await fixture.write('content/value.txt', 'old');
  const key = 'read-boundary-applying';
  const preview = await fixture.engine.preview(request(key, [
    { path: 'content/value.txt', operation: 'write', content: 'new' }
  ]));
  const applyPromise = fixture.engine.apply(applyRequest(preview, key));
  await applying;
  await assert.rejects(
    fixture.engine.withStableRead(() => fixture.read('content/value.txt')),
    (error) => error.code === 'TRANSACTION_LOCKED'
  );
  releaseApplying();
  await applyPromise;
  const stableBytes = await fixture.engine.withStableRead(() => fixture.read('content/value.txt'));
  assert.equal(stableBytes.toString(), 'new');

  let crashed = false;
  const crashEngine = createTransactionEngine({
    repoRoot: fixture.repoRoot,
    runtimeDir: fixture.runtimeDir,
    lockTtlMs: 2_000,
    faultInjector(event) {
      if (!crashed && event.phase === 'apply:after-mutation-write') {
        crashed = true;
        throw new SimulatedCrashError(event.phase);
      }
    }
  });
  await crashEngine.initialize();
  const crashKey = 'read-boundary-recovery';
  const crashPreview = await crashEngine.preview(request(crashKey, [
    { path: 'content/value.txt', operation: 'write', content: 'crashed-new' }
  ]));
  await assert.rejects(
    crashEngine.apply(applyRequest(crashPreview, crashKey)),
    (error) => error.code === 'SIMULATED_TRANSACTION_CRASH'
  );
  await assert.rejects(crashEngine.assertStable(), (error) => error.code === 'TRANSACTION_RECOVERY_REQUIRED');
  await assert.rejects(
    crashEngine.withStableRead(() => fixture.read('content/value.txt')),
    (error) => error.code === 'TRANSACTION_RECOVERY_REQUIRED'
  );
  await crashEngine.recover();
  assert.equal(await crashEngine.assertStable(), true);
  assert.equal((await fixture.read('content/value.txt')).toString(), 'new');
});

test('fault hooks cover every apply phase and regular failures rollback after applying begins', async (t) => {
  const expectations = new Map([
    ['apply:after-lock', TRANSACTION_STATES.PREPARED],
    ['apply:after-recheck', TRANSACTION_STATES.PREPARED],
    ['apply:after-backup', TRANSACTION_STATES.PREPARED],
    ['apply:after-journal-applying', TRANSACTION_STATES.ROLLED_BACK],
    ['apply:before-mutation', TRANSACTION_STATES.ROLLED_BACK],
    ['apply:after-mutation-write', TRANSACTION_STATES.ROLLED_BACK],
    ['apply:after-mutation', TRANSACTION_STATES.ROLLED_BACK],
    ['apply:before-commit', TRANSACTION_STATES.ROLLED_BACK],
    ['apply:after-commit-journal', TRANSACTION_STATES.COMMITTED],
    ['apply:after-commit', TRANSACTION_STATES.COMMITTED]
  ]);
  for (const [phase, expectedState] of expectations) {
    await t.test(phase, async (t) => {
      let fired = false;
      const fixture = await createFixture(t, {
        engineOptions: {
          faultInjector(event) {
            if (!fired && event.phase === phase) {
              fired = true;
              throw new Error(`fault at ${phase}`);
            }
          }
        }
      });
      await fixture.write('content/value.txt', 'old');
      const key = `fault-${phase}`;
      const preview = await fixture.engine.preview(request(key, [
        { path: 'content/value.txt', operation: 'write', content: 'new' }
      ]));
      await assert.rejects(fixture.engine.apply(applyRequest(preview, key)), /fault at/u);
      assert.equal(fired, true);
      const journal = await fixture.engine.getTransaction(preview.transactionId);
      assert.equal(journal.state, expectedState);
      const expectedContent = expectedState === TRANSACTION_STATES.COMMITTED ? 'new' : 'old';
      assert.equal((await fixture.read('content/value.txt')).toString(), expectedContent);
      assert.equal(
        (await fixture.engine.listHistory()).length,
        expectedState === TRANSACTION_STATES.PREPARED ? 0 : 1
      );
    });
  }
  for (const phase of expectations.keys()) assert.ok(TRANSACTION_FAULT_PHASES.includes(phase));
});

test('fault hooks cover preview, rollback and recovery durability windows', async (t) => {
  for (const phase of ['preview:after-read', 'preview:before-journal', 'preview:after-journal', 'preview:after-idempotency']) {
    await t.test(phase, async (t) => {
      let fired = false;
      const fixture = await createFixture(t, {
        engineOptions: {
          faultInjector(event) {
            if (!fired && event.phase === phase) {
              fired = true;
              throw new Error(`fault at ${phase}`);
            }
          }
        }
      });
      await fixture.write('content/value.txt', 'old');
      const payload = request(`fault-${phase}`, [
        { path: 'content/value.txt', operation: 'write', content: 'new' }
      ]);
      await assert.rejects(fixture.engine.preview(payload), /fault at/u);
      assert.equal((await fixture.read('content/value.txt')).toString(), 'old');
      const retry = await fixture.engine.preview(payload);
      assert.equal(retry.state, TRANSACTION_STATES.PREPARED);
      assert.equal(retry.reused, phase === 'preview:after-journal' || phase === 'preview:after-idempotency');
    });
  }

  for (const phase of ['rollback:before', 'rollback:after-restore', 'rollback:after']) {
    await t.test(phase, async (t) => {
      let applyFaulted = false;
      let rollbackFaulted = false;
      const fixture = await createFixture(t, {
        engineOptions: {
          faultInjector(event) {
            if (!applyFaulted && event.phase === 'apply:after-mutation-write') {
              applyFaulted = true;
              throw new Error('trigger rollback');
            }
            if (!rollbackFaulted && event.phase === phase) {
              rollbackFaulted = true;
              throw new Error(`fault at ${phase}`);
            }
          }
        }
      });
      await fixture.write('content/value.txt', 'old');
      const key = `fault-${phase}`;
      const preview = await fixture.engine.preview(request(key, [
        { path: 'content/value.txt', operation: 'write', content: 'new' }
      ]));
      await assert.rejects(
        fixture.engine.apply(applyRequest(preview, key)),
        (error) => error.code === 'TRANSACTION_ROLLBACK_FAILED'
      );
      assert.equal(rollbackFaulted, true);

      const restarted = createTransactionEngine({
        repoRoot: fixture.repoRoot,
        runtimeDir: fixture.runtimeDir,
        lockTtlMs: 2_000
      });
      await restarted.initialize();
      assert.equal((await fixture.read('content/value.txt')).toString(), 'old');
      assert.equal((await restarted.getTransaction(preview.transactionId)).state, TRANSACTION_STATES.ROLLED_BACK);
    });
  }

  for (const phase of ['recovery:before', 'recovery:after']) {
    await t.test(phase, async (t) => {
      let crashFired = false;
      const fixture = await createFixture(t, {
        engineOptions: {
          faultInjector(event) {
            if (!crashFired && event.phase === 'apply:after-mutation-write') {
              crashFired = true;
              throw new SimulatedCrashError(event.phase);
            }
          }
        }
      });
      await fixture.write('content/value.txt', 'old');
      const key = `fault-${phase}`;
      const preview = await fixture.engine.preview(request(key, [
        { path: 'content/value.txt', operation: 'write', content: 'new' }
      ]));
      await assert.rejects(
        fixture.engine.apply(applyRequest(preview, key)),
        (error) => error.code === 'SIMULATED_TRANSACTION_CRASH'
      );

      let recoveryFaulted = false;
      const failingRecovery = createTransactionEngine({
        repoRoot: fixture.repoRoot,
        runtimeDir: fixture.runtimeDir,
        lockTtlMs: 2_000,
        faultInjector(event) {
          if (!recoveryFaulted && event.phase === phase) {
            recoveryFaulted = true;
            throw new Error(`fault at ${phase}`);
          }
        }
      });
      await assert.rejects(failingRecovery.initialize(), /fault at/u);
      assert.equal(recoveryFaulted, true);

      const finalRecovery = createTransactionEngine({
        repoRoot: fixture.repoRoot,
        runtimeDir: fixture.runtimeDir,
        lockTtlMs: 2_000
      });
      await finalRecovery.initialize();
      assert.equal((await fixture.read('content/value.txt')).toString(), 'old');
      assert.equal((await finalRecovery.getTransaction(preview.transactionId)).state, TRANSACTION_STATES.ROLLED_BACK);
    });
  }

  const covered = new Set([
    'preview:after-read', 'preview:before-journal', 'preview:after-journal', 'preview:after-idempotency',
    'apply:after-lock', 'apply:after-recheck', 'apply:after-backup', 'apply:after-journal-applying',
    'apply:before-mutation', 'apply:after-mutation-write', 'apply:after-mutation', 'apply:before-commit',
    'apply:after-commit-journal', 'apply:after-commit',
    'rollback:before', 'rollback:after-restore', 'rollback:after',
    'recovery:before', 'recovery:after'
  ]);
  assert.deepEqual([...covered].sort(), [...TRANSACTION_FAULT_PHASES].sort());
});

test('startup recovery deterministically rolls back a crash after a partial write', async (t) => {
  let crashed = false;
  const fixture = await createFixture(t, {
    engineOptions: {
      faultInjector(event) {
        if (!crashed && event.phase === 'apply:after-mutation-write') {
          crashed = true;
          throw new SimulatedCrashError(event.phase);
        }
      }
    }
  });
  const exactOriginal = Buffer.from([0, 10, 13, 255, 42]);
  await fixture.write('content/a.bin', exactOriginal);
  const key = 'crash-rollback';
  const preview = await fixture.engine.preview(request(key, [
    { path: 'content/a.bin', operation: 'write', bytes: Buffer.from('changed') },
    { path: 'content/new.txt', operation: 'write', content: 'new' }
  ]));
  await assert.rejects(
    fixture.engine.apply(applyRequest(preview, key)),
    (error) => error.code === 'SIMULATED_TRANSACTION_CRASH'
  );
  assert.equal((await fixture.engine.getTransaction(preview.transactionId)).state, TRANSACTION_STATES.APPLYING);
  assert.notDeepEqual(await fixture.read('content/a.bin'), exactOriginal);

  const restarted = createTransactionEngine({
    repoRoot: fixture.repoRoot,
    runtimeDir: fixture.runtimeDir,
    lockTtlMs: 2_000,
    recoveryMode: 'rollback'
  });
  const recovery = await restarted.initialize();
  assert.deepEqual(recovery.recovered, [{ transactionId: preview.transactionId, state: TRANSACTION_STATES.ROLLED_BACK }]);
  assert.deepEqual(await fixture.read('content/a.bin'), exactOriginal);
  assert.equal(await fixture.exists('content/new.txt'), false);
  assert.equal((await restarted.getTransaction(preview.transactionId)).state, TRANSACTION_STATES.ROLLED_BACK);
  await assert.rejects(
    restarted.apply(applyRequest(preview, key)),
    (error) => error.code === 'TRANSACTION_ROLLED_BACK'
  );
});

test('startup recovery can deterministically complete from intent even when progress journal was not updated', async (t) => {
  let crashed = false;
  const fixture = await createFixture(t, {
    engineOptions: {
      faultInjector(event) {
        if (!crashed && event.phase === 'apply:after-mutation-write') {
          crashed = true;
          throw new SimulatedCrashError(event.phase);
        }
      }
    }
  });
  await fixture.write('content/a.txt', 'a-old');
  await fixture.write('content/b.txt', 'b-old');
  const key = 'crash-complete';
  const preview = await fixture.engine.preview(request(key, [
    { path: 'content/a.txt', operation: 'write', content: 'a-new' },
    { path: 'content/b.txt', operation: 'write', content: 'b-new' }
  ]));
  await assert.rejects(
    fixture.engine.apply(applyRequest(preview, key)),
    (error) => error.code === 'SIMULATED_TRANSACTION_CRASH'
  );
  assert.equal((await fixture.engine.getTransaction(preview.transactionId)).appliedCount, 0);

  const restarted = createTransactionEngine({
    repoRoot: fixture.repoRoot,
    runtimeDir: fixture.runtimeDir,
    lockTtlMs: 2_000,
    recoveryMode: 'complete'
  });
  const recovery = await restarted.initialize();
  assert.deepEqual(recovery.recovered, [{ transactionId: preview.transactionId, state: TRANSACTION_STATES.COMMITTED }]);
  assert.equal((await fixture.read('content/a.txt')).toString(), 'a-new');
  assert.equal((await fixture.read('content/b.txt')).toString(), 'b-new');
  const committed = await restarted.apply(applyRequest(preview, key));
  assert.equal(committed.state, TRANSACTION_STATES.COMMITTED);
  assert.equal(committed.reused, true);
});

test('a crash after committed journal is reconciled without replaying writes', async (t) => {
  let crashed = false;
  const fixture = await createFixture(t, {
    engineOptions: {
      faultInjector(event) {
        if (!crashed && event.phase === 'apply:after-commit-journal') {
          crashed = true;
          throw new SimulatedCrashError(event.phase);
        }
      }
    }
  });
  await fixture.write('content/value.txt', 'old');
  const key = 'crash-after-commit';
  const payload = request(key, [{ path: 'content/value.txt', operation: 'write', content: 'new' }]);
  const preview = await fixture.engine.preview(payload);
  await assert.rejects(
    fixture.engine.apply(applyRequest(preview, key)),
    (error) => error.code === 'SIMULATED_TRANSACTION_CRASH'
  );
  assert.equal((await fixture.engine.getTransaction(preview.transactionId)).state, TRANSACTION_STATES.COMMITTED);

  const restarted = createTransactionEngine({
    repoRoot: fixture.repoRoot,
    runtimeDir: fixture.runtimeDir,
    lockTtlMs: 2_000
  });
  await restarted.initialize();
  const reused = await restarted.preview(payload);
  assert.equal(reused.transactionId, preview.transactionId);
  assert.equal(reused.state, TRANSACTION_STATES.COMMITTED);
  assert.equal(reused.reused, true);
  assert.equal((await fixture.read('content/value.txt')).toString(), 'new');
});

test('hash helpers are deterministic and distinguish missing from empty bytes', () => {
  assert.equal(hashPayload({ b: 2, a: 1 }), hashPayload({ a: 1, b: 2 }));
  assert.equal(revisionForBytes(null), 'missing');
  assert.notEqual(revisionForBytes(Buffer.alloc(0)), 'missing');
});

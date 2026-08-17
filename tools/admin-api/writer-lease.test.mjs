import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createWriterLease, probeProcessLiveness } from './writer-lease.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-writer-lease-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('only one Admin API process can own a checkout and release is exact-owner safe', async (t) => {
  const root = await fixture(t);
  const first = createWriterLease({ repoRoot: root, randomUUID: () => 'first-owner-token-0000000000000001' });
  const second = createWriterLease({ repoRoot: root, randomUUID: () => 'second-owner-token-000000000000002' });
  await first.acquire();
  await assert.rejects(() => second.acquire(), { code: 'WRITER_ALREADY_ACTIVE' });
  await first.release();
  await second.acquire();
  await second.release();
});

test('malformed leases always fail closed because owner PID and checkout identity cannot be proven', async (t) => {
  const root = await fixture(t);
  const runtimeDir = path.join(root, '.admin-runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  const probe = createWriterLease({ repoRoot: root, runtimeDir, now: () => 100_000, ttlMs: 5_000, heartbeatMs: 1_000 });
  await fs.writeFile(path.join(runtimeDir, 'writer-owner.lock'), '{not-json}\n');
  await assert.rejects(() => probe.acquire(), { code: 'WRITER_LEASE_INVALID' });
  await fs.utimes(path.join(runtimeDir, 'writer-owner.lock'), new Date(0), new Date(0));
  await assert.rejects(() => probe.acquire(), { code: 'WRITER_LEASE_INVALID' });
});

test('a fresh lease is reclaimed immediately only when the exact recorded PID is proven dead', async (t) => {
  const root = await fixture(t);
  const runtimeDir = path.join(root, '.admin-runtime');
  let clock = 10_000;
  const staleOwner = createWriterLease({
    repoRoot: root,
    runtimeDir,
    pid: 414141,
    now: () => clock,
    ttlMs: 30_000,
    heartbeatMs: 10_000
  });
  await staleOwner.acquire();
  const takeover = createWriterLease({
    repoRoot: root,
    runtimeDir,
    pid: 424242,
    now: () => clock,
    ttlMs: 30_000,
    heartbeatMs: 10_000,
    probeProcessLiveness: (pid) => pid === 414141 ? 'dead' : 'alive'
  });
  await takeover.acquire();
  assert.equal(takeover.status().acquired, true);
  await takeover.release();
  await staleOwner.release();
});

test('dead-owner reclaim never steals a lease replaced by a concurrent starter', async (t) => {
  const root = await fixture(t);
  const runtimeDir = path.join(root, '.admin-runtime');
  const leasePath = path.join(runtimeDir, 'writer-owner.lock');
  const owner = createWriterLease({
    repoRoot: root, runtimeDir, pid: 616160, ttlMs: 30_000, heartbeatMs: 10_000
  });
  await owner.acquire();

  let injected = false;
  const fileSystem = Object.create(fs);
  fileSystem.rename = async (source, target) => {
    if (!injected && path.resolve(source) === path.resolve(leasePath) && String(target).includes('writer-owner.stale-')) {
      injected = true;
      const displaced = path.join(runtimeDir, 'displaced-owner.lock');
      await fs.rename(source, displaced);
      const replacement = JSON.parse(await fs.readFile(displaced, 'utf8'));
      replacement.pid = 616161;
      replacement.ownerToken = '616161:concurrent-live-owner-token-0000000000000001';
      await fs.writeFile(source, `${JSON.stringify(replacement)}\n`, { encoding: 'utf8', flag: 'wx' });
    }
    return fs.rename(source, target);
  };
  const contender = createWriterLease({
    repoRoot: root,
    runtimeDir,
    pid: 616162,
    ttlMs: 30_000,
    heartbeatMs: 10_000,
    fileSystem,
    probeProcessLiveness: (pid) => pid === 616160 ? 'dead' : 'alive'
  });
  await assert.rejects(() => contender.acquire(), { code: 'WRITER_LEASE_CHANGED' });
  const persisted = JSON.parse(await fs.readFile(leasePath, 'utf8'));
  assert.equal(persisted.pid, 616161);
  assert.equal(persisted.ownerToken, '616161:concurrent-live-owner-token-0000000000000001');
  await owner.release();
});

test('live or unknown owner liveness remains fail-closed even after lease expiry', async (t) => {
  const root = await fixture(t);
  const runtimeDir = path.join(root, '.admin-runtime');
  let clock = 1_000;
  const owner = createWriterLease({ repoRoot: root, runtimeDir, pid: 515151, now: () => clock, ttlMs: 5_000, heartbeatMs: 1_000 });
  await owner.acquire();
  clock = 20_000;

  const live = createWriterLease({
    repoRoot: root, runtimeDir, now: () => clock, ttlMs: 5_000, heartbeatMs: 1_000,
    probeProcessLiveness: () => 'alive'
  });
  await assert.rejects(() => live.acquire(), { code: 'WRITER_ALREADY_ACTIVE' });
  const unknown = createWriterLease({
    repoRoot: root, runtimeDir, now: () => clock, ttlMs: 5_000, heartbeatMs: 1_000,
    probeProcessLiveness: () => 'unknown'
  });
  await assert.rejects(() => unknown.acquire(), { code: 'WRITER_PROCESS_LIVENESS_UNKNOWN' });
  await owner.release();
});

test('OS liveness probing treats only ESRCH as proof of death', () => {
  assert.equal(probeProcessLiveness(123, { kill: () => {} }), 'alive');
  assert.equal(probeProcessLiveness(123, { kill: () => { const error = new Error('missing'); error.code = 'ESRCH'; throw error; } }), 'dead');
  assert.equal(probeProcessLiveness(123, { kill: () => { const error = new Error('denied'); error.code = 'EPERM'; throw error; } }), 'unknown');
  assert.equal(probeProcessLiveness(0, { kill: () => { throw new Error('must not run'); } }), 'unknown');
});

test('heartbeat replaces a complete lease atomically and never truncates the ownership file', async (t) => {
  const root = await fixture(t);
  let truncateCalls = 0;
  const fileSystem = Object.create(fs);
  fileSystem.open = async (...args) => {
    const handle = await fs.open(...args);
    return new Proxy(handle, {
      get(target, property) {
        if (property === 'truncate') return async (...values) => { truncateCalls += 1; return target.truncate(...values); };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
  let clock = 50_000;
  const lease = createWriterLease({
    repoRoot: root,
    fileSystem,
    now: () => clock,
    ttlMs: 5_000,
    heartbeatMs: 1_000,
    randomUUID: () => `atomic-owner-${clock}`.padEnd(40, 'a')
  });
  await lease.acquire();
  clock += 1_000;
  await lease.refresh();
  const persisted = JSON.parse(await fs.readFile(path.join(root, '.admin-runtime', 'writer-owner.lock'), 'utf8'));
  assert.equal(persisted.heartbeatAtMs, clock);
  assert.equal(truncateCalls, 0);
  await lease.release();
});

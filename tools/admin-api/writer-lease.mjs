import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const STATE_VERSION = 1;

export class WriterLeaseError extends Error {
  constructor(code, message, { status = 423, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'WriterLeaseError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function parseLease(raw) {
  let value;
  try { value = JSON.parse(raw); }
  catch { return null; }
  if (!value || value.version !== STATE_VERSION || value.kind !== 'smu1-admin-writer-lease'
    || typeof value.ownerToken !== 'string' || value.ownerToken.length < 32
    || !Number.isSafeInteger(value.pid) || value.pid < 1
    || !Number.isFinite(value.heartbeatAtMs) || !Number.isFinite(value.expiresAtMs)
    || typeof value.repoIdentity !== 'string') return null;
  return value;
}

export function probeProcessLiveness(pid, options = {}) {
  if (!Number.isSafeInteger(pid) || pid < 1) return 'unknown';
  const kill = options.kill || process.kill.bind(process);
  try {
    kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

export function createWriterLease(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const runtimeDir = path.resolve(options.runtimeDir || path.join(repoRoot, '.admin-runtime'));
  const leasePath = path.resolve(options.leasePath || path.join(runtimeDir, 'writer-owner.lock'));
  if (!inside(repoRoot, runtimeDir) || !inside(runtimeDir, leasePath)) {
    throw new WriterLeaseError('WRITER_LEASE_PATH_INVALID', 'Writer lease должна находиться в отдельном runtime-каталоге внутри checkout.', { status: 500 });
  }
  const ttlMs = Number(options.ttlMs || 30_000);
  const heartbeatMs = Number(options.heartbeatMs || Math.max(1_000, Math.floor(ttlMs / 3)));
  if (!Number.isFinite(ttlMs) || ttlMs < 5_000 || !Number.isFinite(heartbeatMs) || heartbeatMs < 500 || heartbeatMs >= ttlMs) {
    throw new WriterLeaseError('WRITER_LEASE_TIMING_INVALID', 'Некорректные интервалы writer lease.', { status: 500 });
  }
  const fileSystem = options.fileSystem || fs;
  const now = options.now || Date.now;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const processLiveness = options.probeProcessLiveness || probeProcessLiveness;
  const pid = Number(options.pid || process.pid);
  const repoIdentity = crypto.createHash('sha256').update(repoRoot.toLocaleLowerCase('en-US')).digest('hex');
  const ownerToken = `${pid}:${randomUUID()}`;
  let timer = null;
  let acquired = false;
  let closed = false;
  let queue = Promise.resolve();

  function record(timestamp = now()) {
    return {
      version: STATE_VERSION,
      kind: 'smu1-admin-writer-lease',
      ownerToken,
      repoIdentity,
      pid,
      startedAt: iso(startedAtMs),
      heartbeatAt: iso(timestamp),
      heartbeatAtMs: timestamp,
      expiresAt: iso(timestamp + ttlMs),
      expiresAtMs: timestamp + ttlMs
    };
  }

  const startedAtMs = now();

  async function assertLeasePathSafe({ allowMissing = true } = {}) {
    try {
      const stat = await fileSystem.lstat(leasePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new WriterLeaseError('WRITER_LEASE_PATH_UNSAFE', 'Writer lease path не является обычным файлом.', { status: 500 });
      }
      return stat;
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function writeExclusive() {
    const handle = await fileSystem.open(leasePath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record())}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  function refreshTempPath() {
    const suffix = crypto.createHash('sha256')
      .update(`${ownerToken}\0${randomUUID()}\0${now()}`, 'utf8')
      .digest('hex');
    const target = path.join(runtimeDir, `.writer-owner.${suffix}.tmp`);
    if (!inside(runtimeDir, target)) {
      throw new WriterLeaseError('WRITER_LEASE_PATH_UNSAFE', 'Небезопасный temporary writer lease path.', { status: 500 });
    }
    return target;
  }

  async function replaceAtomically(nextRecord) {
    const temporaryPath = refreshTempPath();
    let temporaryCreated = false;
    try {
      const handle = await fileSystem.open(temporaryPath, 'wx', 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(`${JSON.stringify(nextRecord)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      const temporaryStat = await fileSystem.lstat(temporaryPath);
      if (temporaryStat.isSymbolicLink() || !temporaryStat.isFile()) {
        throw new WriterLeaseError('WRITER_LEASE_PATH_UNSAFE', 'Temporary writer lease path не является обычным файлом.', { status: 500 });
      }
      await fileSystem.rename(temporaryPath, leasePath);
      temporaryCreated = false;
    } finally {
      if (temporaryCreated) {
        await fileSystem.unlink(temporaryPath).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
      }
    }
  }

  async function readCurrent() {
    await assertLeasePathSafe({ allowMissing: false });
    const current = parseLease(await fileSystem.readFile(leasePath, 'utf8'));
    if (!current || current.repoIdentity !== repoIdentity) {
      throw new WriterLeaseError('WRITER_LEASE_INVALID', 'Существующая writer lease повреждена или относится к другому checkout.', { status: 500 });
    }
    return current;
  }

  async function recoverDeadOwner(current) {
    let liveness = 'unknown';
    try { liveness = await processLiveness(current.pid); }
    catch { /* unknown is deliberately fail-closed */ }
    if (liveness !== 'dead') {
      throw new WriterLeaseError(
        liveness === 'alive' ? 'WRITER_ALREADY_ACTIVE' : 'WRITER_PROCESS_LIVENESS_UNKNOWN',
        liveness === 'alive'
          ? 'Для этого checkout уже запущена активная локальная админка.'
          : 'Не удалось доказать, что предыдущий процесс локальной админки завершён. Автоматический перехват writer lease остановлен.',
        { details: { pid: current.pid, startedAt: current.startedAt, expiresAt: current.expiresAt, liveness } }
      );
    }
    const stalePath = path.join(runtimeDir, `writer-owner.stale-${randomUUID()}.lock`);
    if (!inside(runtimeDir, stalePath)) throw new WriterLeaseError('WRITER_LEASE_PATH_UNSAFE', 'Небезопасный stale lease path.', { status: 500 });
    await fileSystem.rename(leasePath, stalePath);
    let stalePresent = true;
    const restoreMovedLease = async () => {
      if (!stalePresent) return;
      await fileSystem.rename(stalePath, leasePath);
      stalePresent = false;
    };
    try {
      const moved = parseLease(await fileSystem.readFile(stalePath, 'utf8'));
      if (!moved || moved.repoIdentity !== current.repoIdentity
        || moved.ownerToken !== current.ownerToken || moved.pid !== current.pid) {
        await restoreMovedLease();
        throw new WriterLeaseError(
          'WRITER_LEASE_CHANGED',
          'Writer lease изменился во время безопасного перезапуска. Автоматический перехват остановлен.',
          { details: { expectedPid: current.pid, actualPid: moved?.pid ?? null } }
        );
      }
      await writeExclusive();
    } catch (error) {
      if (stalePresent) await restoreMovedLease().catch(() => {});
      throw error;
    }
    await fileSystem.unlink(stalePath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    stalePresent = false;
  }

  async function refreshNow() {
    if (!acquired || closed) {
      throw new WriterLeaseError('WRITER_LEASE_LOST', 'Admin API больше не владеет writer lease.', { status: 423 });
    }
    const current = await readCurrent();
    if (current.ownerToken !== ownerToken || current.repoIdentity !== repoIdentity) {
      acquired = false;
      throw new WriterLeaseError('WRITER_LEASE_LOST', 'Admin API потерял ownership writer lease.', { status: 500 });
    }
    await replaceAtomically(record());
  }

  function serialize(operation) {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  }

  async function acquire() {
    if (acquired) return publicState();
    if (closed) throw new WriterLeaseError('WRITER_LEASE_CLOSED', 'Writer lease уже закрыта.', { status: 500 });
    await fileSystem.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    const runtimeStat = await fileSystem.lstat(runtimeDir);
    if (runtimeStat.isSymbolicLink() || !runtimeStat.isDirectory()) {
      throw new WriterLeaseError('WRITER_RUNTIME_UNSAFE', 'Runtime writer lease не является обычным каталогом.', { status: 500 });
    }
    try {
      await writeExclusive();
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let current;
      try { current = await readCurrent(); }
      catch (readError) {
        throw readError;
      }
      if (current) await recoverDeadOwner(current);
    }
    acquired = true;
    timer = setInterval(() => {
      void serialize(refreshNow).catch((error) => {
        acquired = false;
        clearInterval(timer);
        timer = null;
        options.onLost?.(error);
      });
    }, heartbeatMs);
    timer.unref?.();
    return publicState();
  }

  function publicState() {
    return Object.freeze({ acquired, pid, startedAt: iso(startedAtMs), leasePath });
  }

  async function release() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    await queue;
    if (!acquired) return;
    let current;
    try { current = await readCurrent(); }
    catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (current.ownerToken === ownerToken) {
      await fileSystem.unlink(leasePath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
    acquired = false;
  }

  return Object.freeze({ acquire, assertOwned: () => serialize(refreshNow), refresh: () => serialize(refreshNow), release, status: publicState, runtimePaths: Object.freeze({ runtimeDir, leasePath }) });
}

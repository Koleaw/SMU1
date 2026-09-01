import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { backupContract, createBackupService } from '../admin-api/backup-service.mjs';

const execFileAsync = promisify(execFile);
const SHA1_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const OWNED_TEMP_PREFIX = 'smu1-h6-backup-restore-';
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const OWNER = Object.freeze({
  owner: 'h6-backup-restore-drill',
  recoveryClientId: 'fresh-checkout-restore'
});
const MANAGED_ROOTS = Object.freeze([
  { path: 'src/content', jsonOnly: true },
  { path: 'src/data', jsonOnly: true },
  { path: 'public/uploads', jsonOnly: false },
  { path: 'public/assets/brand', jsonOnly: false },
  { path: 'public/assets/icons', jsonOnly: false },
  { path: 'public/assets/images', jsonOnly: false },
  { path: 'public/assets/video', jsonOnly: false },
  { path: 'public/brand', jsonOnly: false },
  { path: 'public/icons', jsonOnly: false },
  { path: 'public/images', jsonOnly: false },
  { path: 'public/video', jsonOnly: false }
]);

class DrillError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'BackupRestoreDrillError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const lexicalCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const inventoryDigest = (entries) => sha256(Buffer.from(JSON.stringify(entries), 'utf8'));
const isContentPath = (relative) => relative.startsWith('src/content/') || relative.startsWith('src/data/');
const isMediaPath = (relative) => relative.startsWith('public/');

function contained(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function fail(code, message, details) {
  throw new DrillError(code, message, details);
}

function requireCondition(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function normalizeRelative(relative) {
  const normalized = String(relative || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.includes(':')
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail('DRILL_PATH_INVALID', 'QA drill encountered an unsafe relative path.', { path: String(relative || '') });
  }
  return normalized;
}

async function runGit(cwd, args, { allowFailure = false } = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * MIB
    });
    return { ok: true, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
  } catch (error) {
    if (allowFailure) {
      return {
        ok: false,
        stdout: String(error?.stdout || '').trim(),
        stderr: String(error?.stderr || '').trim(),
        code: error?.code ?? null
      };
    }
    throw new DrillError('DRILL_GIT_FAILED', 'Git command failed during the disposable-checkout drill.', {
      args,
      stderr: String(error?.stderr || error?.message || error).trim()
    });
  }
}

async function gitValue(cwd, args) {
  return (await runGit(cwd, args)).stdout;
}

async function retryTransientFileOperation(operation, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { value: await operation(), retries: attempt - 1 };
    } catch (error) {
      lastError = error;
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
  throw lastError;
}

async function assertPlainDirectory(directory, code) {
  const stat = await fs.lstat(directory);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), code, 'QA drill requires a plain directory.', { directory });
  return fs.realpath(directory);
}

async function createOwnedTemp(tempBase) {
  const requestedBase = path.resolve(tempBase);
  await fs.mkdir(requestedBase, { recursive: true });
  const base = await assertPlainDirectory(requestedBase, 'DRILL_TEMP_BASE_UNSAFE');
  const created = await fs.mkdtemp(path.join(base, OWNED_TEMP_PREFIX));
  const root = await assertPlainDirectory(created, 'DRILL_TEMP_ROOT_UNSAFE');
  requireCondition(path.dirname(root) === base && path.basename(root).startsWith(OWNED_TEMP_PREFIX),
    'DRILL_TEMP_OWNERSHIP_INVALID', 'QA drill refused an unowned temporary root.', { base, root });
  return { base, root };
}

async function cleanupOwnedTemp(owned, keepTemp) {
  if (!owned) {
    return { attempted: false, completed: true, retained: false, safeOwnershipCheck: true };
  }
  const base = await assertPlainDirectory(owned.base, 'DRILL_TEMP_BASE_UNSAFE');
  const stat = await fs.lstat(owned.root).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!stat) {
    return { attempted: true, completed: true, retained: false, safeOwnershipCheck: true };
  }
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'DRILL_TEMP_ROOT_UNSAFE',
    'QA drill refused to recursively clean a non-directory or link.', { root: owned.root });
  const root = await fs.realpath(owned.root);
  requireCondition(path.dirname(root) === base && path.basename(root).startsWith(OWNED_TEMP_PREFIX),
    'DRILL_TEMP_OWNERSHIP_INVALID', 'QA drill refused to recursively clean an unowned path.', { base, root });
  if (keepTemp) {
    return {
      attempted: true,
      completed: true,
      retained: true,
      safeOwnershipCheck: true,
      ownedLeaf: path.basename(root)
    };
  }
  await fs.rm(root, { recursive: true, force: true });
  return {
    attempted: true,
    completed: true,
    retained: false,
    safeOwnershipCheck: true,
    ownedLeaf: path.basename(root)
  };
}

async function atomicWriteJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), '.' + path.basename(filename) + '.' + crypto.randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'));
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filename);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function hashFile(filename) {
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filename);
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      digest.update(chunk);
    });
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return { sha256: digest.digest('hex'), bytes };
}

async function walkManagedRoot(repoRoot, definition) {
  const root = path.join(repoRoot, ...definition.path.split('/'));
  const rootStat = await fs.lstat(root).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!rootStat) return [];
  requireCondition(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'DRILL_MANAGED_ROOT_UNSAFE',
    'Managed root in the fresh checkout is not a plain directory.', { path: definition.path });
  const repoReal = await fs.realpath(repoRoot);
  const rootReal = await fs.realpath(root);
  requireCondition(contained(repoReal, rootReal), 'DRILL_MANAGED_ROOT_ESCAPE',
    'Managed root escaped the disposable checkout.', { path: definition.path });
  const answer = [];
  async function visit(directory, relativeRoot) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => lexicalCompare(left.name, right.name));
    for (const entry of entries) {
      const relative = normalizeRelative(relativeRoot + '/' + entry.name);
      const absolute = path.join(directory, entry.name);
      requireCondition(contained(root, absolute), 'DRILL_MANAGED_PATH_ESCAPE',
        'Managed file escaped its root.', { path: relative });
      requireCondition(!entry.isSymbolicLink(), 'DRILL_MANAGED_LINK_FORBIDDEN',
        'Managed content/media may not traverse a symlink or junction.', { path: relative });
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile() && (!definition.jsonOnly || entry.name.toLowerCase().endsWith('.json'))) answer.push(relative);
    }
  }
  await visit(root, definition.path);
  return answer;
}

async function inventory(repoRoot) {
  const nested = await Promise.all(MANAGED_ROOTS.map((definition) => walkManagedRoot(repoRoot, definition)));
  const paths = nested.flat().sort(lexicalCompare);
  const entries = [];
  for (const relative of paths) {
    const absolute = path.join(repoRoot, ...relative.split('/'));
    const stat = await fs.lstat(absolute);
    requireCondition(stat.isFile() && !stat.isSymbolicLink(), 'DRILL_MANAGED_FILE_UNSAFE',
      'Managed inventory contains a non-file or link.', { path: relative });
    const hashed = await hashFile(absolute);
    requireCondition(hashed.bytes === stat.size, 'DRILL_FILE_CHANGED_DURING_HASH',
      'Managed file changed while the drill hashed it.', { path: relative });
    entries.push({ path: relative, sha256: hashed.sha256, bytes: hashed.bytes });
  }
  const contentFileCount = entries.filter((item) => isContentPath(item.path)).length;
  const mediaFileCount = entries.filter((item) => isMediaPath(item.path)).length;
  return {
    entries,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, item) => sum + item.bytes, 0),
    contentFileCount,
    mediaFileCount,
    sha256: inventoryDigest(entries)
  };
}

function inventoryFromManifest(manifest) {
  const entries = manifest.files.map((item) => ({
    path: normalizeRelative(item.path),
    sha256: String(item.sha256 || ''),
    bytes: Number(item.bytes)
  })).sort((left, right) => lexicalCompare(left.path, right.path));
  return {
    entries,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, item) => sum + item.bytes, 0),
    contentFileCount: entries.filter((item) => isContentPath(item.path)).length,
    mediaFileCount: entries.filter((item) => isMediaPath(item.path)).length,
    sha256: inventoryDigest(entries)
  };
}

function compareInventories(expected, actual) {
  const expectedByPath = new Map(expected.entries.map((item) => [item.path, item]));
  const actualByPath = new Map(actual.entries.map((item) => [item.path, item]));
  const paths = [...new Set([...expectedByPath.keys(), ...actualByPath.keys()])].sort(lexicalCompare);
  const mismatches = [];
  for (const relative of paths) {
    const left = expectedByPath.get(relative) || null;
    const right = actualByPath.get(relative) || null;
    if (!left || !right || left.sha256 !== right.sha256 || left.bytes !== right.bytes) {
      mismatches.push({ path: relative, expected: left, actual: right });
    }
  }
  return { exact: mismatches.length === 0, mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 50) };
}

function assertInventory(label, expected, actual) {
  const comparison = compareInventories(expected, actual);
  requireCondition(comparison.exact, 'DRILL_INVENTORY_MISMATCH', label + ' inventory differs.', comparison);
  requireCondition(expected.sha256 === actual.sha256, 'DRILL_INVENTORY_DIGEST_MISMATCH',
    label + ' aggregate checksum differs.', { expected: expected.sha256, actual: actual.sha256 });
  return comparison;
}

async function cloneExact(repoRoot, sourceSha, destination) {
  await runGit(repoRoot, ['clone', '--quiet', '--shared', '--no-checkout', '--', repoRoot, destination]);
  await runGit(destination, ['config', 'core.autocrlf', 'false']);
  await runGit(destination, ['config', 'core.filemode', 'false']);
  await runGit(destination, ['checkout', '--quiet', '--detach', sourceSha]);
  const checkoutSha = (await gitValue(destination, ['rev-parse', 'HEAD'])).toLowerCase();
  const branch = await gitValue(destination, ['branch', '--show-current']);
  const status = await gitValue(destination, ['status', '--porcelain=v1', '--untracked-files=all']);
  requireCondition(checkoutSha === sourceSha, 'DRILL_CHECKOUT_SHA_MISMATCH',
    'Disposable checkout did not resolve to the requested source SHA.', { sourceSha, checkoutSha });
  requireCondition(branch === '', 'DRILL_CHECKOUT_NOT_DETACHED',
    'Disposable checkout must be detached at the exact source SHA.', { branch });
  requireCondition(status === '', 'DRILL_CHECKOUT_NOT_CLEAN',
    'Fresh disposable checkout is unexpectedly dirty.', { status });
  return { sha: checkoutSha, detached: true, cleanBefore: true, mode: 'fresh-local-clone' };
}

async function availableBytes(directory) {
  const stats = await fs.statfs(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function verifyPortableExport(exportPath, expectedManifest) {
  const [marker, manifest] = await Promise.all([
    fs.readFile(path.join(exportPath, 'RESTORE.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(exportPath, 'manifest.json'), 'utf8').then(JSON.parse)
  ]);
  requireCondition(marker?.kind === 'smu1-portable-backup' && marker?.version === 1,
    'DRILL_EXPORT_MARKER_INVALID', 'Portable export restore marker is invalid.', { marker });
  requireCondition(marker.snapshotId === expectedManifest.snapshotId
    && marker.manifestSha256 === expectedManifest.manifestSha256,
  'DRILL_EXPORT_IDENTITY_MISMATCH', 'Portable export marker does not identify the snapshot.', { marker });
  requireCondition(manifest.manifestSha256 === expectedManifest.manifestSha256
    && manifest.snapshotId === expectedManifest.snapshotId,
  'DRILL_EXPORT_MANIFEST_MISMATCH', 'Portable export manifest identity differs from the snapshot.');
  const exportedInventory = await inventory(path.join(exportPath, 'files'));
  const manifestInventory = inventoryFromManifest(expectedManifest);
  assertInventory('portable export', manifestInventory, exportedInventory);
  return {
    verified: true,
    markerKind: marker.kind,
    snapshotId: marker.snapshotId,
    manifestSha256: marker.manifestSha256,
    fileCount: exportedInventory.fileCount,
    totalBytes: exportedInventory.totalBytes,
    inventorySha256: exportedInventory.sha256
  };
}

async function mutateRestoreCheckout(repoRoot, sourceInventory) {
  const content = sourceInventory.entries.filter((item) => isContentPath(item.path)).sort((left, right) => left.bytes - right.bytes || lexicalCompare(left.path, right.path));
  const media = sourceInventory.entries.filter((item) => isMediaPath(item.path)).sort((left, right) => left.bytes - right.bytes || lexicalCompare(left.path, right.path));
  requireCondition(content.length >= 2 && media.length >= 2, 'DRILL_FIXTURES_UNAVAILABLE',
    'The exact checkout needs at least two content and two media files for a meaningful restore drill.', {
      contentFiles: content.length,
      mediaFiles: media.length
    });
  const replace = [content[0], media[0]];
  const remove = [content[1], media[1]];
  const extras = [
    { path: 'src/data/__h6_backup_restore_drill_extra__.json', bytes: Buffer.from('{"h6BackupRestoreDrill":"delete-me"}\n', 'utf8') },
    { path: 'public/uploads/__h6_backup_restore_drill_extra__.jpg', bytes: Buffer.from('H6 BACKUP RESTORE DRILL EXTRA\n', 'utf8') }
  ];
  const manifestPaths = new Set(sourceInventory.entries.map((item) => item.path));
  for (const extra of extras) {
    requireCondition(!manifestPaths.has(extra.path), 'DRILL_FIXTURE_COLLISION',
      'A drill-only fixture path already belongs to source content.', { path: extra.path });
  }
  const replacementBytes = [
    Buffer.from('{"h6BackupRestoreDrill":"replace-me"}\n', 'utf8'),
    Buffer.from('H6 BACKUP RESTORE DRILL REPLACE\n', 'utf8')
  ];
  for (let index = 0; index < replace.length; index += 1) {
    const target = path.join(repoRoot, ...replace[index].path.split('/'));
    requireCondition(contained(repoRoot, target), 'DRILL_FIXTURE_ESCAPE', 'Drill fixture path escaped checkout.', { path: replace[index].path });
    await fs.writeFile(target, replacementBytes[index]);
  }
  for (const item of remove) {
    const target = path.join(repoRoot, ...item.path.split('/'));
    requireCondition(contained(repoRoot, target), 'DRILL_FIXTURE_ESCAPE', 'Drill fixture path escaped checkout.', { path: item.path });
    await fs.rm(target, { force: true });
  }
  for (const extra of extras) {
    const target = path.join(repoRoot, ...extra.path.split('/'));
    requireCondition(contained(repoRoot, target), 'DRILL_FIXTURE_ESCAPE', 'Drill fixture path escaped checkout.', { path: extra.path });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, extra.bytes);
  }
  const expected = [
    ...replace.map((item) => ({ path: item.path, action: 'replace' })),
    ...remove.map((item) => ({ path: item.path, action: 'create' })),
    ...extras.map((item) => ({ path: item.path, action: 'delete' }))
  ].sort((left, right) => lexicalCompare(left.path, right.path));
  return { expected, replace: replace.map((item) => item.path), create: remove.map((item) => item.path), delete: extras.map((item) => item.path) };
}

function actionCounts(changes) {
  const counts = { create: 0, replace: 0, delete: 0 };
  for (const change of changes) {
    if (Object.hasOwn(counts, change.action)) counts[change.action] += 1;
  }
  return counts;
}

function assertPreview(preview, perturbation) {
  const actual = preview.changes.map((item) => ({ path: item.path, action: item.action }))
    .sort((left, right) => lexicalCompare(left.path, right.path));
  requireCondition(JSON.stringify(actual) === JSON.stringify(perturbation.expected),
    'DRILL_DRY_RUN_UNEXPECTED', 'Restore dry-run did not report the exact planned create/replace/delete set.', {
      expected: perturbation.expected,
      actual
    });
  const counts = actionCounts(actual);
  requireCondition(counts.create > 0 && counts.replace > 0 && counts.delete > 0,
    'DRILL_DRY_RUN_INCOMPLETE', 'Restore dry-run must prove create, replace and delete operations.', { counts });
  return {
    canApply: preview.canApply === true,
    changeCount: preview.changeCount,
    actionCounts: counts,
    changes: actual,
    restoreId: preview.restoreId
  };
}

function managedGitPathspec() {
  return MANAGED_ROOTS.map((item) => item.path);
}

function summarizeError(error) {
  return {
    name: String(error?.name || 'Error'),
    code: String(error?.code || 'DRILL_FAILED'),
    message: String(error?.message || error),
    details: error?.details ?? undefined
  };
}

function parseArgs(argv) {
  const answer = { keepTemp: false, help: false };
  for (const value of argv) {
    if (value === '--keep-temp') answer.keepTemp = true;
    else if (value === '--help' || value === '-h') answer.help = true;
    else if (value.startsWith('--repo-root=')) answer.repoRoot = value.slice('--repo-root='.length);
    else if (value.startsWith('--temp-base=')) answer.tempBase = value.slice('--temp-base='.length);
    else if (value.startsWith('--output=')) answer.output = value.slice('--output='.length);
    else fail('DRILL_ARGUMENT_INVALID', 'Unknown backup/restore drill argument.', { argument: value });
  }
  return answer;
}

export function validateBackupRestoreDrillEvidence(report, {
  expectedSourceSHA = '',
  expectedBranch = ''
} = {}) {
  const issues = [];
  const issue = (value) => issues.push(value);
  if (report?.schemaVersion !== 1) issue('backup-restore:schema-version');
  if (report?.kind !== 'smu1-h6-backup-restore-drill') issue('backup-restore:kind');
  if (report?.status !== 'passed') issue('backup-restore:status');
  if (!Number.isFinite(Date.parse(String(report?.generatedAt || '')))) issue('backup-restore:generated-at');
  const sourceSha = String(report?.source?.sha || '');
  if (!SHA1_RE.test(sourceSha)) issue('backup-restore:source-sha');
  if (expectedSourceSHA && sourceSha !== expectedSourceSHA) issue('backup-restore:source-sha-mismatch');
  if (typeof report?.source?.branch !== 'string' || !report.source.branch.trim()) issue('backup-restore:branch');
  if (expectedBranch && report?.source?.branch !== expectedBranch) issue('backup-restore:branch-mismatch');
  if (report?.source?.checkout?.sha !== sourceSha || report?.restoreCheckout?.sha !== sourceSha) issue('backup-restore:checkout-sha');
  if (report?.source?.checkout?.mode !== 'fresh-local-clone' || report?.restoreCheckout?.mode !== 'fresh-local-clone') issue('backup-restore:fresh-checkout');
  if (report?.source?.checkout?.detached !== true || report?.restoreCheckout?.detached !== true) issue('backup-restore:detached-checkout');
  if (report?.source?.checkout?.cleanBefore !== true || report?.restoreCheckout?.cleanBefore !== true) issue('backup-restore:clean-checkout');
  if (report?.backup?.sourceSha !== sourceSha) issue('backup-restore:backup-source-sha');
  if (!SHA256_RE.test(String(report?.backup?.manifestSha256 || ''))) issue('backup-restore:manifest-sha');
  if (!SHA256_RE.test(String(report?.backup?.inventorySha256 || ''))) issue('backup-restore:inventory-sha');
  if (report?.backup?.verify?.ok !== true || report?.backup?.verify?.failures !== 0) issue('backup-restore:backup-verify');
  if (!Number.isSafeInteger(report?.backup?.fileCount) || report.backup.fileCount <= 0
    || !Number.isSafeInteger(report?.backup?.totalBytes) || report.backup.totalBytes <= 0) issue('backup-restore:backup-size');
  if (!Number.isSafeInteger(report?.backup?.contentFileCount) || report.backup.contentFileCount <= 0
    || !Number.isSafeInteger(report?.backup?.mediaFileCount) || report.backup.mediaFileCount <= 0
    || report.backup.contentFileCount + report.backup.mediaFileCount !== report.backup.fileCount) issue('backup-restore:content-media-coverage');
  if (report?.portableExport?.verified !== true || report?.portableExport?.markerKind !== 'smu1-portable-backup') issue('backup-restore:portable-export');
  if (!Number.isSafeInteger(report?.portableExport?.transientRetryCount) || report.portableExport.transientRetryCount < 0) issue('backup-restore:portable-export-retries');
  if (report?.portableExport?.manifestSha256 !== report?.backup?.manifestSha256
    || report?.portableExport?.inventorySha256 !== report?.backup?.inventorySha256
    || report?.portableExport?.fileCount !== report?.backup?.fileCount
    || report?.portableExport?.totalBytes !== report?.backup?.totalBytes) issue('backup-restore:portable-export-identity');
  if (report?.backupTransport?.mode !== 'external-backup-root-used-by-second-fresh-checkout'
    || report?.backupTransport?.separateFromBothCheckouts !== true
    || report?.backupTransport?.verifiedFromRestoreCheckout !== true) issue('backup-restore:backup-transport');
  const counts = report?.dryRun?.actionCounts;
  if (report?.dryRun?.canApply !== true || !Number.isSafeInteger(report?.dryRun?.changeCount) || report.dryRun.changeCount <= 0
    || !counts || counts.create <= 0 || counts.replace <= 0 || counts.delete <= 0
    || counts.create + counts.replace + counts.delete !== report.dryRun.changeCount) issue('backup-restore:dry-run');
  if (report?.restore?.result !== 'success' || report?.restore?.state !== 'committed'
    || typeof report?.restore?.transactionId !== 'string' || !report.restore.transactionId) issue('backup-restore:atomic-restore');
  if (report?.restore?.receipt?.kind !== 'smu1-backup-restore-receipt'
    || report?.restore?.receipt?.state !== 'committed'
    || report?.restore?.receipt?.transactionId !== report?.restore?.transactionId
    || report?.restore?.receipt?.manifestSha256 !== report?.backup?.manifestSha256) issue('backup-restore:receipt');
  if (report?.restore?.journal?.state !== 'committed'
    || report?.restore?.journal?.metadata?.restoreKind !== 'new-transaction'
    || report?.restore?.journal?.metadata?.backupManifestSha256 !== report?.backup?.manifestSha256) issue('backup-restore:transaction-journal');
  if (report?.comparison?.exact !== true || report?.comparison?.mismatchCount !== 0
    || report?.comparison?.sourceInventorySha256 !== report?.backup?.inventorySha256
    || report?.comparison?.restoredInventorySha256 !== report?.backup?.inventorySha256
    || report?.comparison?.fileCount !== report?.backup?.fileCount
    || report?.comparison?.totalBytes !== report?.backup?.totalBytes) issue('backup-restore:byte-comparison');
  if (report?.restoreCheckout?.managedGitStatusAfterRestore !== '' || report?.restoreCheckout?.managedTreeCleanAfterRestore !== true) issue('backup-restore:git-clean-after');
  if (report?.cleanup?.attempted !== true || report?.cleanup?.completed !== true
    || report?.cleanup?.safeOwnershipCheck !== true) issue('backup-restore:safe-cleanup');
  return { ok: issues.length === 0, issues };
}

async function executeDrill({ repoRoot, sourceSha, sourceBranch, owned, log }) {
  const started = Date.now();
  const sourceCheckoutRoot = path.join(owned.root, 'source-checkout');
  const restoreCheckoutRoot = path.join(owned.root, 'restore-checkout');
  const backupRoot = path.join(owned.root, 'external-backup-root');
  log('Cloning source checkout at exact HEAD');
  const sourceCheckout = await cloneExact(repoRoot, sourceSha, sourceCheckoutRoot);
  const sourceInventory = await inventory(sourceCheckoutRoot);
  requireCondition(sourceInventory.contentFileCount > 0 && sourceInventory.mediaFileCount > 0,
    'DRILL_MANAGED_CONTENT_MISSING', 'Exact source checkout must contain both content and media.', sourceInventory);
  const freeBytes = await availableBytes(owned.root);
  const requiredFreeBytes = Math.max(GIB, Math.ceil(sourceInventory.totalBytes * 3.25 + 256 * MIB));
  requireCondition(freeBytes >= requiredFreeBytes, 'DRILL_DISK_SPACE_INSUFFICIENT',
    'Not enough disposable disk space for two checkouts, backup blobs and portable export.', {
      availableBytes: freeBytes,
      requiredFreeBytes,
      managedBytes: sourceInventory.totalBytes
    });

  log('Creating checksummed full snapshot and portable export');
  const sourceRuntime = path.join(sourceCheckoutRoot, '.admin-runtime', 'backup-restore-drill');
  const sourceService = createBackupService({
    repoRoot: sourceCheckoutRoot,
    backupRoot,
    runtimeDir: sourceRuntime,
    retention: 2,
    maxBytes: Math.max(MIB, sourceInventory.totalBytes + 256 * MIB),
    minFreeBytes: 0
  });
  let manifest;
  let backupVerify;
  let portableExport;
  try {
    await sourceService.initialize();
    manifest = await sourceService.createSnapshot({ transactionId: 'h6-real-restore-drill', backupKind: 'restore-drill' });
    backupVerify = await sourceService.verify({ snapshotId: manifest.snapshotId });
    requireCondition(backupVerify.ok === true && backupVerify.failures.length === 0,
      'DRILL_BACKUP_VERIFY_FAILED', 'Checksummed snapshot verification failed.', backupVerify);
    const manifestInventory = inventoryFromManifest(manifest);
    assertInventory('snapshot', sourceInventory, manifestInventory);
    const exportedAttempt = await retryTransientFileOperation(
      () => sourceService.exportPortable({ snapshotId: manifest.snapshotId })
    );
    portableExport = {
      ...await verifyPortableExport(exportedAttempt.value.exportPath, manifest),
      transientRetryCount: exportedAttempt.retries
    };
  } finally {
    await sourceService.close().catch(() => {});
  }

  log('Cloning independent restore checkout at the same exact HEAD');
  const restoreCheckout = await cloneExact(repoRoot, sourceSha, restoreCheckoutRoot);
  const pristineRestoreInventory = await inventory(restoreCheckoutRoot);
  assertInventory('fresh restore checkout', sourceInventory, pristineRestoreInventory);
  const perturbation = await mutateRestoreCheckout(restoreCheckoutRoot, sourceInventory);

  log('Running restore dry-run and one atomic restore transaction');
  const restoreRuntime = path.join(restoreCheckoutRoot, '.admin-runtime', 'backup-restore-drill');
  const restoreService = createBackupService({
    repoRoot: restoreCheckoutRoot,
    backupRoot,
    runtimeDir: restoreRuntime,
    retention: 2,
    maxBytes: Math.max(MIB, sourceInventory.totalBytes + 256 * MIB),
    minFreeBytes: 0
  });
  let dryRun;
  let restore;
  let receipt;
  let journal;
  let verifyFromRestore;
  try {
    await restoreService.initialize();
    verifyFromRestore = await restoreService.verify({ snapshotId: manifest.snapshotId });
    requireCondition(verifyFromRestore.ok === true, 'DRILL_TRANSFER_VERIFY_FAILED',
      'The second checkout could not verify the external backup root.', verifyFromRestore);
    const preview = await restoreService.previewRestore({ ...OWNER, snapshotId: manifest.snapshotId });
    dryRun = assertPreview(preview, perturbation);
    requireCondition(dryRun.canApply, 'DRILL_DRY_RUN_BLOCKED', 'Restore dry-run unexpectedly blocked apply.', dryRun);
    restore = await restoreService.applyRestore({
      ...OWNER,
      restoreId: preview.restoreId,
      idempotencyKey: 'h6-backup-restore-drill-' + manifest.manifestSha256.slice(0, 24)
    });
    requireCondition(restore.result === 'success' && restore.state === 'committed' && restore.transactionId,
      'DRILL_ATOMIC_RESTORE_FAILED', 'Backup restore did not commit as one transaction.', restore);
    receipt = JSON.parse(await fs.readFile(path.join(restoreRuntime, 'receipt-' + preview.restoreId + '.json'), 'utf8'));
    journal = JSON.parse(await fs.readFile(path.join(restoreRuntime, 'restore-transactions', 'journals', restore.transactionId + '.json'), 'utf8'));
  } finally {
    await restoreService.close().catch(() => {});
  }

  log('Comparing every restored content/media byte with the source snapshot');
  const restoredInventory = await inventory(restoreCheckoutRoot);
  const comparison = assertInventory('restored checkout', sourceInventory, restoredInventory);
  const managedGitStatusAfterRestore = await gitValue(restoreCheckoutRoot, [
    'status', '--porcelain=v1', '--untracked-files=all', '--', ...managedGitPathspec()
  ]);
  requireCondition(managedGitStatusAfterRestore === '', 'DRILL_RESTORE_GIT_DIRTY',
    'Restored managed content/media differs from the exact Git checkout.', { managedGitStatusAfterRestore });
  requireCondition(receipt.kind === 'smu1-backup-restore-receipt' && receipt.state === 'committed'
    && receipt.transactionId === restore.transactionId && receipt.manifestSha256 === manifest.manifestSha256,
  'DRILL_RECEIPT_INVALID', 'Restore receipt does not prove the committed transaction.', receipt);
  requireCondition(journal.state === 'committed' && journal.metadata?.restoreKind === 'new-transaction'
    && journal.metadata?.backupManifestSha256 === manifest.manifestSha256,
  'DRILL_JOURNAL_INVALID', 'Transaction journal does not prove an atomic backup restore.', {
    state: journal.state,
    metadata: journal.metadata
  });

  return {
    source: { sha: sourceSha, branch: sourceBranch, checkout: sourceCheckout },
    diskPreflight: {
      availableBytes: freeBytes,
      requiredFreeBytes,
      managedBytes: sourceInventory.totalBytes,
      passed: true
    },
    backup: {
      snapshotId: manifest.snapshotId,
      sourceSha: manifest.sourceSha,
      schemaVersion: manifest.schemaVersion,
      manifestSha256: manifest.manifestSha256,
      inventorySha256: sourceInventory.sha256,
      fileCount: sourceInventory.fileCount,
      totalBytes: sourceInventory.totalBytes,
      contentFileCount: sourceInventory.contentFileCount,
      mediaFileCount: sourceInventory.mediaFileCount,
      verify: {
        ok: backupVerify.ok,
        checkedFiles: backupVerify.checkedFiles,
        failures: backupVerify.failures.length
      }
    },
    portableExport,
    backupTransport: {
      mode: 'external-backup-root-used-by-second-fresh-checkout',
      separateFromBothCheckouts: !contained(sourceCheckoutRoot, backupRoot) && !contained(restoreCheckoutRoot, backupRoot),
      verifiedFromRestoreCheckout: verifyFromRestore.ok === true,
      checkedFiles: verifyFromRestore.checkedFiles
    },
    perturbation: {
      replace: perturbation.replace,
      create: perturbation.create,
      delete: perturbation.delete
    },
    dryRun: {
      canApply: dryRun.canApply,
      changeCount: dryRun.changeCount,
      actionCounts: dryRun.actionCounts,
      changes: dryRun.changes
    },
    restore: {
      result: restore.result,
      state: restore.state,
      transactionId: restore.transactionId,
      restoredPathCount: restore.restoredPaths.length,
      receipt: {
        kind: receipt.kind,
        state: receipt.state,
        transactionId: receipt.transactionId,
        manifestSha256: receipt.manifestSha256,
        changedPathCount: receipt.changedPaths.length
      },
      journal: {
        state: journal.state,
        mutationCount: journal.mutations.length,
        metadata: {
          restoreKind: journal.metadata.restoreKind,
          backupSnapshotId: journal.metadata.backupSnapshotId,
          backupManifestSha256: journal.metadata.backupManifestSha256
        }
      }
    },
    restoreCheckout: {
      ...restoreCheckout,
      managedGitStatusAfterRestore,
      managedTreeCleanAfterRestore: managedGitStatusAfterRestore === ''
    },
    comparison: {
      exact: comparison.exact,
      mismatchCount: comparison.mismatchCount,
      mismatches: comparison.mismatches,
      sourceInventorySha256: sourceInventory.sha256,
      restoredInventorySha256: restoredInventory.sha256,
      fileCount: restoredInventory.fileCount,
      totalBytes: restoredInventory.totalBytes,
      contentFileCount: restoredInventory.contentFileCount,
      mediaFileCount: restoredInventory.mediaFileCount
    },
    drillDurationMs: Date.now() - started
  };
}

export async function runBackupRestoreDrill(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const output = path.resolve(options.output || path.join(repoRoot, '.admin-runtime', 'h6-qa', 'backup-restore-drill.json'));
  const tempBase = path.resolve(options.tempBase || process.env.SMU1_H6_QA_TEMP_BASE || path.join(os.tmpdir(), 'smu1-h6-qa'));
  const keepTemp = options.keepTemp === true;
  const generatedAt = new Date().toISOString();
  const evidence = {
    schemaVersion: 1,
    kind: 'smu1-h6-backup-restore-drill',
    status: 'running',
    generatedAt
  };
  let owned = null;
  let failure = null;
  const log = options.log || ((message) => process.stdout.write('[backup-restore-drill] ' + message + '\n'));
  try {
    const contractRoots = backupContract.managedRoots;
    requireCondition(JSON.stringify(contractRoots) === JSON.stringify(MANAGED_ROOTS.map((item) => item.path)),
      'DRILL_BACKUP_CONTRACT_DRIFT', 'QA inventory roots must match the backup service contract.', {
        service: contractRoots,
        drill: MANAGED_ROOTS.map((item) => item.path)
      });
    const sourceSha = (await gitValue(repoRoot, ['rev-parse', 'HEAD'])).toLowerCase();
    requireCondition(SHA1_RE.test(sourceSha), 'DRILL_SOURCE_SHA_INVALID', 'Repository HEAD is not a full Git SHA.', { sourceSha });
    const sourceBranch = await gitValue(repoRoot, ['branch', '--show-current']) || '(detached)';
    owned = await createOwnedTemp(tempBase);
    requireCondition(!contained(owned.root, output), 'DRILL_OUTPUT_INSIDE_TEMP',
      'Evidence output must survive cleanup and cannot be inside the owned temp root.', { output });
    Object.assign(evidence, await executeDrill({ repoRoot, sourceSha, sourceBranch, owned, log }));
    evidence.status = 'passed';
  } catch (error) {
    failure = error;
    evidence.status = 'failed';
    evidence.error = summarizeError(error);
  }
  try {
    evidence.cleanup = await cleanupOwnedTemp(owned, keepTemp);
  } catch (cleanupError) {
    failure ||= cleanupError;
    evidence.status = 'failed';
    evidence.cleanup = {
      attempted: true,
      completed: false,
      retained: true,
      safeOwnershipCheck: false,
      error: summarizeError(cleanupError)
    };
    evidence.error ||= summarizeError(cleanupError);
  }
  evidence.completedAt = new Date().toISOString();
  evidence.totalDurationMs = Math.max(0, Date.parse(evidence.completedAt) - Date.parse(generatedAt));
  if (evidence.status === 'passed') {
    const contract = validateBackupRestoreDrillEvidence(evidence);
    if (!contract.ok) {
      failure = new DrillError('DRILL_EVIDENCE_CONTRACT_FAILED', 'Generated drill evidence violates its contract.', { issues: contract.issues });
      evidence.status = 'failed';
      evidence.error = summarizeError(failure);
    }
  }
  await atomicWriteJson(output, evidence);
  if (failure) {
    failure.evidencePath = output;
    throw failure;
  }
  return { evidence, output };
}

function help() {
  return [
    'H6 real backup/restore drill',
    '',
    '  node tools/qa/backup-restore-drill.mjs [options]',
    '',
    'Options:',
    '  --repo-root=<path>  Repository whose exact HEAD is cloned twice.',
    '  --temp-base=<path>  Parent for one owned disposable directory.',
    '  --output=<path>     JSON evidence file outside the disposable directory.',
    '  --keep-temp         Keep the owned directory for local debugging.',
    '  --help              Show this help.'
  ].join('\n') + '\n';
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  let cli;
  try {
    cli = parseArgs(process.argv.slice(2));
    if (cli.help) {
      process.stdout.write(help());
    } else {
      const result = await runBackupRestoreDrill(cli);
      process.stdout.write(JSON.stringify({
        ok: true,
        sourceSha: result.evidence.source.sha,
        snapshotId: result.evidence.backup.snapshotId,
        fileCount: result.evidence.backup.fileCount,
        totalBytes: result.evidence.backup.totalBytes,
        transactionId: result.evidence.restore.transactionId,
        output: result.output
      }, null, 2) + '\n');
    }
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ok: false,
      error: summarizeError(error),
      evidencePath: error?.evidencePath || null
    }, null, 2) + '\n');
    process.exitCode = 1;
  }
}

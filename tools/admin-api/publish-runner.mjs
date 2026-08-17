import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CONTENT_ONLY_GATES,
  DEFAULT_PUBLISH_REFS,
  classifyPublishPath,
  createPublishGitEnvironment,
  fingerprintPublishPlan,
  hashPublishBytes,
  runGitProcess,
  validateCommittedTransactionManifest,
} from './publish-planner.mjs';

const FULL_GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const PUBLISH_WORKSPACE_KIND = 'smu1-publish-workspace';
const PUBLISH_WORKSPACE_VERSION = 1;
const PUBLISH_WORKSPACE_MARKER = '.smu1-publish-workspace.json';
const DEFAULT_WORKSPACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class PublishRunError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'PublishRunError';
    this.code = code;
    this.details = details;
  }
}

function normalizeGitText(value) {
  return Buffer.isBuffer(value) ? value.toString('utf8').trim() : String(value ?? '').trim();
}

function parseNulPaths(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');
  return text.split('\0').filter(Boolean).map((item) => item.replaceAll('\\', '/'));
}

function assertGitSha(value, field) {
  if (!FULL_GIT_SHA_PATTERN.test(value)) {
    throw new PublishRunError('PUBLISH_INVALID_SHA', `${field} must be a full Git SHA.`, { field, value });
  }
}

function assertPlan(plan) {
  if (!plan || plan.version !== 1 || plan.target !== 'preview' || plan.profile !== 'content-only') {
    throw new PublishRunError('PUBLISH_INVALID_PLAN', 'Only a version 1 preview publish plan is supported.');
  }
  if (!Array.isArray(plan.paths) || !plan.baseHead || !plan.anchorSha) {
    throw new PublishRunError('PUBLISH_INVALID_PLAN', 'The publish plan is incomplete.');
  }
  assertGitSha(plan.baseHead, 'plan.baseHead');
  assertGitSha(plan.anchorSha, 'plan.anchorSha');
  if (!Array.isArray(plan.selectedTransactionIds)
    || (plan.paths.length > 0 && plan.selectedTransactionIds.length === 0)
    || plan.selectedTransactionIds.some((id) => !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(id))) {
    throw new PublishRunError('PUBLISH_INVALID_PLAN', 'The publish plan has invalid selected transaction IDs.');
  }
  if (new Set(plan.selectedTransactionIds).size !== plan.selectedTransactionIds.length
    || !Array.isArray(plan.transactionManifests)) {
    throw new PublishRunError('PUBLISH_INVALID_PLAN', 'The publish plan transaction manifest set is invalid.');
  }
  let validatedManifestIds;
  try {
    validatedManifestIds = plan.transactionManifests
      .map(validateCommittedTransactionManifest)
      .map((manifest) => manifest.transactionId);
  } catch (error) {
    throw new PublishRunError('PUBLISH_INVALID_PLAN', 'The publish plan contains an invalid transaction manifest.', {
      causeCode: error?.code,
    }, { cause: error });
  }
  if (validatedManifestIds.length !== plan.selectedTransactionIds.length
    || validatedManifestIds.some((id, index) => id !== plan.selectedTransactionIds[index])) {
    throw new PublishRunError('PUBLISH_INVALID_PLAN', 'Selected transaction IDs do not match the typed manifests.');
  }
  if (plan.paths.length > 0 && !Number.isFinite(Date.parse(plan.commitTimestamp))) {
    throw new PublishRunError('PUBLISH_INVALID_PLAN', 'A non-empty plan requires a deterministic commitTimestamp.');
  }
  for (const item of plan.paths) {
    if (!item || typeof item.path !== 'string' || !['write', 'delete'].includes(item.operation)) {
      throw new PublishRunError('PUBLISH_INVALID_PLAN', 'The publish plan contains an invalid path entry.', { item });
    }
    if (!classifyPublishPath(item.path).allowed) {
      throw new PublishRunError('PUBLISH_NON_CONTENT_PATH', `Path is outside the content-only allowlist: ${item.path}`, {
        path: item.path,
      });
    }
    if (!/^(?:missing|sha256:[a-f0-9]{64}:[0-9]+)$/u.test(item.beforeHash)
      || !/^(?:missing|sha256:[a-f0-9]{64}:[0-9]+)$/u.test(item.afterHash)
      || (item.operation === 'delete') !== (item.afterHash === 'missing')) {
      throw new PublishRunError('PUBLISH_INVALID_PLAN', 'The publish plan contains invalid raw content revisions.', {
        item,
      });
    }
    if (!/^(?:missing|[a-f0-9]{40})$/u.test(item.beforeGitOid)
      || !/^(?:missing|[a-f0-9]{40})$/u.test(item.afterGitOid)
      || (item.operation === 'delete') !== (item.afterGitOid === 'missing')) {
      throw new PublishRunError('PUBLISH_INVALID_PLAN', 'The publish plan is missing exact Git object identities.', {
        item,
      });
    }
  }
  if (new Set(plan.paths.map((item) => item.path)).size !== plan.paths.length) {
    throw new PublishRunError('PUBLISH_INVALID_PLAN', 'The publish plan contains duplicate paths.');
  }
  const suppliedFingerprint = plan.fingerprint ?? plan.planFingerprint;
  if (!/^sha256:[a-f0-9]{64}$/u.test(suppliedFingerprint)
    || (plan.fingerprint && plan.planFingerprint && plan.fingerprint !== plan.planFingerprint)
    || fingerprintPublishPlan(plan) !== suppliedFingerprint) {
    throw new PublishRunError('PUBLISH_PLAN_FINGERPRINT_MISMATCH', 'The publish plan fingerprint is invalid.');
  }
}

function refName(remote, branch) {
  return `refs/remotes/${remote}/${branch}`;
}

function samePathSet(left, right) {
  const sortedLeft = [...new Set(left)].sort();
  const sortedRight = [...new Set(right)].sort();
  return sortedLeft.length === left.length
    && sortedRight.length === right.length
    && sortedLeft.length === sortedRight.length
    && sortedLeft.every((item, index) => item === sortedRight[index]);
}

function isUnknownPushError(error) {
  if (error?.unknownResult === true) return true;
  const code = error?.code ?? error?.cause?.code;
  if (['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(code)) return true;
  const diagnostic = `${error?.message ?? ''}\n${error?.details?.stderr ?? ''}`;
  if (/(?:does not support --atomic push|atomic push (?:failed|is not supported)|\[remote rejected\]|remote rejected)/iu.test(diagnostic)) {
    return false;
  }
  return /(?:could not resolve host|connection (?:timed out|reset|closed)|failed to connect|network is unreachable|remote end hung up|unexpected disconnect|early eof|rpc failed)/iu.test(diagnostic);
}

async function removeControlledDirectory(directory, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(directory));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PublishRunError('PUBLISH_TEMP_PATH_INVALID', 'Refusing to clean a directory outside the controlled temp root.', {
      directory,
      parent,
    });
  }
  await rm(directory, { recursive: true, force: true });
}

function defaultIsProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function normalizedRootIdentity(root) {
  const normalized = process.platform === 'win32' ? root.toLowerCase() : root;
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

async function writeWorkspaceMarker(directory, marker) {
  const markerPath = path.join(directory, PUBLISH_WORKSPACE_MARKER);
  const temporaryPath = path.join(directory, `.smu1-marker-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(marker)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporaryPath, markerPath);
}

export function createPublishRunner({
  repoRoot,
  remote = 'origin',
  refs = DEFAULT_PUBLISH_REFS,
  runGit = runGitProcess,
  gateRunner,
  tempRoot = os.tmpdir(),
  workspaceMaxAgeMs = DEFAULT_WORKSPACE_MAX_AGE_MS,
  now = () => Date.now(),
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  if (!repoRoot || typeof repoRoot !== 'string') {
    throw new PublishRunError('PUBLISH_REPO_REQUIRED', 'repoRoot is required.');
  }
  if (typeof runGit !== 'function') {
    throw new PublishRunError('PUBLISH_GIT_RUNNER_REQUIRED', 'runGit must be a function.');
  }
  if (typeof gateRunner !== 'function') {
    throw new PublishRunError('PUBLISH_GATE_RUNNER_REQUIRED', 'gateRunner must be an injected function.');
  }
  if (!Number.isSafeInteger(workspaceMaxAgeMs) || workspaceMaxAgeMs < 60_000) {
    throw new PublishRunError('PUBLISH_TEMP_RETENTION_INVALID', 'workspaceMaxAgeMs must be an integer of at least one minute.');
  }
  if (typeof now !== 'function' || typeof isProcessAlive !== 'function') {
    throw new PublishRunError('PUBLISH_TEMP_CLEANUP_INVALID', 'now and isProcessAlive must be functions.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(remote)) {
    throw new PublishRunError('PUBLISH_REMOTE_INVALID', 'Invalid Git remote name.');
  }
  refs = Object.freeze({ ...DEFAULT_PUBLISH_REFS, ...refs });
  for (const [name, value] of Object.entries(refs)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) || value.includes('..')) {
      throw new PublishRunError('PUBLISH_REF_INVALID', `Invalid ${name} branch name.`, { name, value });
    }
  }

  const root = path.resolve(repoRoot);
  const controlledTempRoot = path.resolve(tempRoot);
  const repoRootIdentity = normalizedRootIdentity(root);
  const workspacePrefix = `smu1-publish-${repoRootIdentity.slice(7, 23)}-`;
  const workspaceNamePattern = new RegExp(`^${workspacePrefix}[A-Za-z0-9_-]{6}$`, 'u');
  const gitEnvironment = createPublishGitEnvironment(process.env);
  let initializePromise;

  function nowMs() {
    const value = now();
    const milliseconds = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(milliseconds)) {
      throw new PublishRunError('PUBLISH_CLOCK_INVALID', 'Publish workspace cleanup clock returned an invalid value.');
    }
    return milliseconds;
  }

  async function cleanupStaleWorkspaces() {
    await mkdir(controlledTempRoot, { recursive: true });
    const summary = { scanned: 0, removed: 0, preserved: 0 };
    const entries = await readdir(controlledTempRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!workspaceNamePattern.test(entry.name)) continue;
      summary.scanned += 1;
      const directory = path.join(controlledTempRoot, entry.name);
      let directoryStat;
      try {
        directoryStat = await lstat(directory);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        summary.preserved += 1;
        continue;
      }

      let marker = null;
      try {
        marker = JSON.parse(await readFile(path.join(directory, PUBLISH_WORKSPACE_MARKER), 'utf8'));
      } catch (error) {
        if (!['ENOENT', 'EISDIR'].includes(error?.code) && !(error instanceof SyntaxError)) throw error;
      }
      const markerValid = marker?.kind === PUBLISH_WORKSPACE_KIND
        && marker?.version === PUBLISH_WORKSPACE_VERSION
        && marker?.repoRootIdentity === repoRootIdentity
        && Number.isSafeInteger(marker?.pid)
        && marker.pid > 0
        && Number.isFinite(Date.parse(marker?.createdAt));
      if (marker && !markerValid) {
        summary.preserved += 1;
        continue;
      }
      // A crash can leave the directory before its marker exists. mtime is the
      // portable age signal here: unlike birthtime, tests and recovery tools can
      // set it consistently on NTFS as well as POSIX filesystems.
      const createdAt = markerValid ? Date.parse(marker.createdAt) : directoryStat.mtimeMs;
      const stale = nowMs() - createdAt >= workspaceMaxAgeMs;
      const ownerAlive = markerValid ? await isProcessAlive(marker.pid) : false;
      if (!stale || ownerAlive) {
        summary.preserved += 1;
        continue;
      }

      const finalStat = await lstat(directory).catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      if (!finalStat) continue;
      if (finalStat.isSymbolicLink() || !finalStat.isDirectory()) {
        summary.preserved += 1;
        continue;
      }
      await removeControlledDirectory(directory, controlledTempRoot);
      summary.removed += 1;
    }
    return Object.freeze(summary);
  }

  async function initialize() {
    if (!initializePromise) initializePromise = cleanupStaleWorkspaces();
    return initializePromise;
  }

  async function execute(args, options = {}, ledger = undefined) {
    ledger?.push({ args: [...args], cwd: options.cwd ?? root, environment: options.env?.GIT_INDEX_FILE ? 'temporary-index' : 'default' });
    return runGit(args, {
      cwd: options.cwd ?? root,
      env: options.env ?? gitEnvironment,
      allowFailure: options.allowFailure,
    });
  }

  async function readRefs(ledger) {
    await execute([
      'fetch',
      '--no-tags',
      remote,
      `+refs/heads/${refs.candidate}:${refName(remote, refs.candidate)}`,
      `+refs/heads/${refs.preview}:${refName(remote, refs.preview)}`,
      `+refs/heads/${refs.protected}:${refName(remote, refs.protected)}`,
    ], {}, ledger);
    const snapshot = {};
    for (const [key, branch] of Object.entries(refs)) {
      snapshot[key] = normalizeGitText((await execute(['rev-parse', refName(remote, branch)], {}, ledger)).stdout);
      assertGitSha(snapshot[key], `remote ${branch}`);
    }
    return snapshot;
  }

  function assertProtectedSnapshot(snapshot, expected) {
    if (snapshot.protected !== expected) {
      throw new PublishRunError('PUBLISH_PROTECTED_REF_CHANGED', `${refs.protected} changed during the publish attempt.`, {
        expected,
        actual: snapshot.protected,
      });
    }
  }

  async function verifyCurrentContent(paths) {
    for (const item of paths) {
      const absolute = path.resolve(root, ...item.path.split('/'));
      let currentRevision = 'missing';
      try {
        const stats = await lstat(absolute);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          throw new PublishRunError('PUBLISH_PATH_NOT_REGULAR', `Publish path is not a regular file: ${item.path}`, {
            path: item.path,
          });
        }
        currentRevision = hashPublishBytes(await readFile(absolute));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (currentRevision !== item.afterHash) {
        throw new PublishRunError('PUBLISH_CONTENT_CHANGED', `Content changed after planning: ${item.path}`, {
          path: item.path,
          expected: item.afterHash,
          actual: currentRevision,
        });
      }
    }
  }

  async function prepare(plan, { target = 'preview', commitMessage } = {}) {
    if (target === 'production') {
      throw new PublishRunError('PUBLISH_PRODUCTION_FORBIDDEN', 'Production publishing is not implemented.');
    }
    if (target !== 'preview') {
      throw new PublishRunError('PUBLISH_TARGET_INVALID', 'Only the preview target is supported.', { target });
    }
    assertPlan(plan);
    await initialize();
    if (plan.remote !== remote
      || plan.refs?.candidate !== refs.candidate
      || plan.refs?.preview !== refs.preview
      || plan.refs?.protected !== refs.protected
      || plan.targetRefs?.[0] !== `refs/heads/${refs.candidate}`
      || plan.targetRefs?.[1] !== `refs/heads/${refs.preview}`) {
      throw new PublishRunError('PUBLISH_PLAN_REMOTE_MISMATCH', 'The publish plan remote/ref ownership differs from the runner configuration.');
    }
    for (const [key, value] of Object.entries(plan.remoteRefs ?? {})) assertGitSha(value, `plan.remoteRefs.${key}`);
    if (Object.keys(plan.remoteRefs ?? {}).length !== 3
      || plan.baseHead !== plan.anchorSha
      || plan.remoteRefs.candidate !== plan.baseHead
      || plan.remoteRefs.preview !== plan.anchorSha
      || plan.remoteRefs.protected !== plan.protectedMainSha) {
      throw new PublishRunError('PUBLISH_INVALID_PLAN', 'The publish plan base/anchor/ref snapshot is inconsistent.');
    }

    if (plan.empty === true || plan.paths.length === 0) {
      return Object.freeze({
        version: 1,
        status: 'empty',
        empty: true,
        planFingerprint: plan.planFingerprint,
        testedSha: plan.baseHead,
        baseHead: plan.baseHead,
        anchorSha: plan.anchorSha,
        remoteBefore: plan.remoteRefs,
        protectedSha: plan.remoteRefs.protected,
        paths: [],
        commands: [],
      });
    }

    const commands = [];
    await execute([
      'fetch',
      '--no-tags',
      remote,
      `+refs/heads/${refs.candidate}:${refName(remote, refs.candidate)}`,
      `+refs/heads/${refs.preview}:${refName(remote, refs.preview)}`,
      `+refs/heads/${refs.protected}:${refName(remote, refs.protected)}`,
    ], {}, commands);

    const branch = normalizeGitText((await execute(['branch', '--show-current'], {}, commands)).stdout);
    const head = normalizeGitText((await execute(['rev-parse', 'HEAD'], {}, commands)).stdout);
    const remoteCandidate = normalizeGitText((await execute(['rev-parse', refName(remote, refs.candidate)], {}, commands)).stdout);
    const remotePreview = normalizeGitText((await execute(['rev-parse', refName(remote, refs.preview)], {}, commands)).stdout);
    const protectedSha = normalizeGitText((await execute(['rev-parse', refName(remote, refs.protected)], {}, commands)).stdout);

    if (branch !== refs.candidate) {
      throw new PublishRunError('PUBLISH_BRANCH_MISMATCH', `Publish preparation requires branch ${refs.candidate}.`, {
        expected: refs.candidate,
        actual: branch,
      });
    }
    if (head !== plan.baseHead) {
      throw new PublishRunError('PUBLISH_HEAD_CHANGED', 'HEAD changed after the plan was created.', {
        planned: plan.baseHead,
        actual: head,
      });
    }
    if (remoteCandidate !== plan.remoteRefs.candidate || remotePreview !== plan.remoteRefs.preview) {
      throw new PublishRunError('PUBLISH_REMOTE_AHEAD', 'Remote preview refs changed after the plan was created.', {
        planned: plan.remoteRefs,
        actual: { candidate: remoteCandidate, preview: remotePreview, protected: protectedSha },
      });
    }
    if (remoteCandidate !== head || remotePreview !== plan.anchorSha) {
      throw new PublishRunError('PUBLISH_REMOTE_AHEAD', 'The publish base is no longer the exact remote snapshot.', {
        head,
        anchorSha: plan.anchorSha,
        remoteCandidate,
        remotePreview,
      });
    }
    if (protectedSha !== plan.remoteRefs.protected) {
      throw new PublishRunError('PUBLISH_PROTECTED_REF_CHANGED', `${refs.protected} changed after planning.`, {
        planned: plan.remoteRefs.protected,
        actual: protectedSha,
      });
    }

    const ancestry = await execute(['merge-base', '--is-ancestor', remoteCandidate, head], { allowFailure: true }, commands);
    if (ancestry.exitCode !== 0) {
      throw new PublishRunError('PUBLISH_NON_FAST_FORWARD', 'The candidate branch is not descended from its remote ref.');
    }

    const staged = parseNulPaths((await execute(['diff', '--cached', '--name-only', '-z'], {}, commands)).stdout);
    const selectedPathSet = new Set(plan.paths.map((item) => item.path));
    const unrelatedStaged = staged.filter((item) => !selectedPathSet.has(item));
    if (unrelatedStaged.length > 0) {
      throw new PublishRunError('PUBLISH_UNRELATED_STAGED', 'Unrelated staged changes block publishing.', {
        paths: unrelatedStaged,
      });
    }

    await verifyCurrentContent(plan.paths);

    await mkdir(controlledTempRoot, { recursive: true });
    const workDirectory = await mkdtemp(path.join(controlledTempRoot, workspacePrefix));
    await writeWorkspaceMarker(workDirectory, {
      kind: PUBLISH_WORKSPACE_KIND,
      version: PUBLISH_WORKSPACE_VERSION,
      repoRootIdentity,
      pid: process.pid,
      createdAt: new Date(nowMs()).toISOString(),
    });
    const indexPath = path.join(workDirectory, `index-${randomUUID()}`);
    const checkoutDirectory = path.join(workDirectory, 'clean-checkout');
    const indexEnvironment = { ...gitEnvironment, GIT_INDEX_FILE: indexPath };

    try {
      await execute(['read-tree', head], { env: indexEnvironment }, commands);
      for (const item of plan.paths) {
        if (item.operation === 'delete') {
          await execute(['update-index', '--remove', '--', item.path], { env: indexEnvironment }, commands);
        } else {
          await execute(['add', '--', item.path], { env: indexEnvironment }, commands);
        }
      }

      const indexedPaths = parseNulPaths((await execute(
        ['diff', '--cached', '--name-only', '-z', head],
        { env: indexEnvironment },
        commands,
      )).stdout);
      const plannedPaths = plan.paths.map((item) => item.path);
      if (!samePathSet(indexedPaths, plannedPaths)) {
        throw new PublishRunError('PUBLISH_INDEX_SCOPE_MISMATCH', 'The temporary index does not contain the exact planned path set.', {
          plannedPaths,
          indexedPaths,
        });
      }

      for (const item of plan.paths) {
        if (item.operation === 'delete') continue;
        const stagedGitOid = normalizeGitText((await execute(
          ['rev-parse', `:${item.path}`],
          { env: indexEnvironment },
          commands,
        )).stdout);
        if (stagedGitOid !== item.afterGitOid) {
          throw new PublishRunError('PUBLISH_INDEX_HASH_MISMATCH', `Temporary index Git object mismatch: ${item.path}`, {
            path: item.path,
            expected: item.afterGitOid,
            actual: stagedGitOid,
          });
        }
      }

      const treeSha = normalizeGitText((await execute(['write-tree'], { env: indexEnvironment }, commands)).stdout);
      const finalCommitMessage = String(commitMessage ?? `content(preview): ${plan.selectedTransactionIds.join(', ')}`);
      if (!finalCommitMessage || finalCommitMessage.length > 500 || finalCommitMessage.includes('\0')) {
        throw new PublishRunError('PUBLISH_COMMIT_MESSAGE_INVALID', 'Commit message must contain 1-500 characters and no NUL byte.');
      }
      const commitEnvironment = {
        ...indexEnvironment,
        GIT_AUTHOR_NAME: 'SMU-1 Admin',
        GIT_AUTHOR_EMAIL: 'admin@localhost.invalid',
        GIT_COMMITTER_NAME: 'SMU-1 Admin',
        GIT_COMMITTER_EMAIL: 'admin@localhost.invalid',
        GIT_AUTHOR_DATE: plan.commitTimestamp,
        GIT_COMMITTER_DATE: plan.commitTimestamp,
      };
      const testedSha = normalizeGitText((await execute(
        ['commit-tree', treeSha, '-p', head, '-m', finalCommitMessage],
        { env: commitEnvironment },
        commands,
      )).stdout);
      assertGitSha(testedSha, 'testedSha');

      const commitPaths = parseNulPaths((await execute(
        ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', testedSha],
        {},
        commands,
      )).stdout);
      if (!samePathSet(commitPaths, plannedPaths)) {
        throw new PublishRunError('PUBLISH_COMMIT_SCOPE_MISMATCH', 'Prospective commit paths do not exactly match the plan.', {
          plannedPaths,
          commitPaths,
        });
      }
      for (const contentPath of commitPaths) {
        if (!classifyPublishPath(contentPath).allowed) {
          throw new PublishRunError('PUBLISH_NON_CONTENT_PATH', `Prospective commit contains a forbidden path: ${contentPath}`);
        }
      }

      await execute(['clone', '--no-checkout', '--quiet', '--no-hardlinks', root, checkoutDirectory], {
        cwd: workDirectory,
      }, commands);
      await execute(['config', '--local', 'core.autocrlf', 'false'], { cwd: checkoutDirectory }, commands);
      await execute(['config', '--local', 'core.eol', 'lf'], { cwd: checkoutDirectory }, commands);
      await execute(['checkout', '--detach', '--quiet', testedSha], { cwd: checkoutDirectory }, commands);
      const checkedOutSha = normalizeGitText((await execute(['rev-parse', 'HEAD'], { cwd: checkoutDirectory }, commands)).stdout);
      if (checkedOutSha !== testedSha) {
        throw new PublishRunError('PUBLISH_GATE_SHA_MISMATCH', 'The gate checkout is not the prospective commit.', {
          expected: testedSha,
          actual: checkedOutSha,
        });
      }
      const beforeGateStatus = normalizeGitText((await execute(['status', '--porcelain', '--untracked-files=no'], {
        cwd: checkoutDirectory,
      }, commands)).stdout);
      if (beforeGateStatus) {
        throw new PublishRunError('PUBLISH_GATE_CHECKOUT_DIRTY', 'The independent gate checkout is not clean.', {
          status: beforeGateStatus,
        });
      }

      const gateResult = await gateRunner({
        checkoutDir: checkoutDirectory,
        testedSha,
        profile: 'content-only',
        gates: [...CONTENT_ONLY_GATES],
        plan,
      });
      const missingGateEvidence = CONTENT_ONLY_GATES.filter((gate) => {
        const evidence = gateResult?.results?.[gate];
        return evidence !== 'passed' && evidence?.ok !== true;
      });
      if (!gateResult
        || gateResult.ok !== true
        || gateResult.testedSha !== testedSha
        || missingGateEvidence.length > 0) {
        throw new PublishRunError('PUBLISH_GATES_FAILED', 'Content-only gates did not pass for the exact prospective commit.', {
          testedSha,
          gateResult,
          missingGateEvidence,
        });
      }

      const remoteAfterGates = await readRefs(commands);
      if (remoteAfterGates.candidate !== remoteCandidate
        || remoteAfterGates.preview !== remotePreview) {
        throw new PublishRunError('PUBLISH_REMOTE_AHEAD', 'Remote preview refs changed while local gates were running.', {
          before: { candidate: remoteCandidate, preview: remotePreview },
          after: remoteAfterGates,
        });
      }
      assertProtectedSnapshot(remoteAfterGates, protectedSha);

      await verifyCurrentContent(plan.paths);
      const headBeforeCommit = normalizeGitText((await execute(['rev-parse', 'HEAD'], {}, commands)).stdout);
      if (headBeforeCommit !== head) {
        throw new PublishRunError('PUBLISH_HEAD_CHANGED', 'HEAD changed while the prospective commit was being tested.', {
          expected: head,
          actual: headBeforeCommit,
        });
      }
      const stagedBeforeCommit = parseNulPaths((await execute(['diff', '--cached', '--name-only', '-z'], {}, commands)).stdout);
      const unrelatedBeforeCommit = stagedBeforeCommit.filter((item) => !selectedPathSet.has(item));
      if (unrelatedBeforeCommit.length > 0) {
        throw new PublishRunError('PUBLISH_UNRELATED_STAGED', 'Unrelated staged changes appeared while gates were running.', {
          paths: unrelatedBeforeCommit,
        });
      }
      for (const item of plan.paths) {
        if (item.operation === 'delete') {
          await execute(['update-index', '--remove', '--', item.path], {}, commands);
        } else {
          await execute(['add', '--', item.path], {}, commands);
        }
      }
      const localIndexPaths = parseNulPaths((await execute(
        ['diff', '--cached', '--name-only', '-z', head],
        {},
        commands,
      )).stdout);
      if (!samePathSet(localIndexPaths, plannedPaths)) {
        throw new PublishRunError('PUBLISH_LOCAL_INDEX_SCOPE_MISMATCH', 'Local commit index does not exactly match the tested plan.', {
          plannedPaths,
          localIndexPaths,
        });
      }
      const localTreeSha = normalizeGitText((await execute(['write-tree'], {}, commands)).stdout);
      if (localTreeSha !== treeSha) {
        throw new PublishRunError('PUBLISH_LOCAL_TREE_MISMATCH', 'Local exact-path index differs from the tested tree.', {
          expected: treeSha,
          actual: localTreeSha,
        });
      }
      await execute([
        'update-ref',
        '-m',
        `smu1 admin content publish ${plan.fingerprint ?? plan.planFingerprint}`,
        `refs/heads/${refs.candidate}`,
        testedSha,
        head,
      ], {}, commands);
      const committedHead = normalizeGitText((await execute(['rev-parse', 'HEAD'], {}, commands)).stdout);
      if (committedHead !== testedSha) {
        throw new PublishRunError('PUBLISH_LOCAL_COMMIT_MISMATCH', 'Local candidate ref did not move to the tested commit.', {
          expected: testedSha,
          actual: committedHead,
        });
      }

      return Object.freeze({
        version: 1,
        status: 'committed',
        empty: false,
        planFingerprint: plan.planFingerprint,
        selectedTransactionIds: [...plan.selectedTransactionIds],
        baseHead: head,
        anchorSha: plan.anchorSha,
        treeSha,
        testedSha,
        protectedSha,
        remoteBefore: Object.freeze({ candidate: remoteCandidate, preview: remotePreview, protected: protectedSha }),
        paths: plan.paths.map((item) => Object.freeze({ ...item })),
        gates: Object.freeze({ ...gateResult, testedSha }),
        commands: Object.freeze(commands.map((item) => Object.freeze({ ...item, args: Object.freeze([...item.args]) }))),
      });
    } finally {
      await removeControlledDirectory(workDirectory, controlledTempRoot);
    }
  }

  async function reconcile(receipt, ledger = []) {
    if (!receipt || receipt.empty || !FULL_GIT_SHA_PATTERN.test(receipt.testedSha)) {
      throw new PublishRunError('PUBLISH_INVALID_RECEIPT', 'A non-empty prepared receipt is required.');
    }
    const snapshot = await readRefs(ledger);
    assertProtectedSnapshot(snapshot, receipt.protectedSha);
    const candidateMatches = snapshot.candidate === receipt.testedSha;
    const previewMatches = snapshot.preview === receipt.testedSha;
    let disposition = 'not-pushed';
    if (candidateMatches && previewMatches) disposition = 'pushed';
    else if (candidateMatches || previewMatches) disposition = 'partial';
    return { disposition, refs: snapshot, commands: ledger };
  }

  async function push(receipt, { target = 'preview' } = {}) {
    if (target === 'production') {
      throw new PublishRunError('PUBLISH_PRODUCTION_FORBIDDEN', 'Production publishing is not implemented.');
    }
    if (target !== 'preview') {
      throw new PublishRunError('PUBLISH_TARGET_INVALID', 'Only the preview target is supported.', { target });
    }
    if (receipt?.empty === true) {
      return Object.freeze({ status: 'empty', pushed: false, testedSha: receipt.testedSha, commands: [] });
    }

    const commands = [];
    const before = await reconcile(receipt, commands);
    if (before.disposition === 'partial') {
      throw new PublishRunError('PUBLISH_ATOMICITY_VIOLATION', 'Only one preview ref contains the tested SHA.', {
        testedSha: receipt.testedSha,
        refs: before.refs,
      });
    }
    if (before.disposition === 'pushed') {
      return Object.freeze({
        status: 'pushed',
        pushed: true,
        reconciled: true,
        testedSha: receipt.testedSha,
        refs: Object.freeze(before.refs),
        commands: Object.freeze(commands),
      });
    }
    if (before.refs.candidate !== receipt.remoteBefore.candidate || before.refs.preview !== receipt.remoteBefore.preview) {
      throw new PublishRunError('PUBLISH_REMOTE_AHEAD', 'Remote refs no longer match the prepared base.', {
        expected: receipt.remoteBefore,
        actual: before.refs,
      });
    }

    const pushArgs = [
      'push',
      '--atomic',
      remote,
      `${receipt.testedSha}:refs/heads/${refs.candidate}`,
      `${receipt.testedSha}:refs/heads/${refs.preview}`,
    ];
    let pushError;
    try {
      await execute(pushArgs, {}, commands);
    } catch (error) {
      pushError = error;
    }

    let after;
    try {
      after = await reconcile(receipt, commands);
    } catch (error) {
      if (pushError && isUnknownPushError(pushError)) {
        return Object.freeze({
          status: 'unknown-network-result',
          pushed: false,
          retryable: true,
          testedSha: receipt.testedSha,
          commands: Object.freeze(commands),
        });
      }
      throw error;
    }

    if (after.disposition === 'pushed') {
      return Object.freeze({
        status: 'pushed',
        pushed: true,
        reconciled: Boolean(pushError),
        testedSha: receipt.testedSha,
        refs: Object.freeze(after.refs),
        commands: Object.freeze(commands),
      });
    }
    if (after.disposition === 'partial') {
      throw new PublishRunError('PUBLISH_ATOMICITY_VIOLATION', 'Atomic push reconciliation found a partial ref update.', {
        testedSha: receipt.testedSha,
        refs: after.refs,
      });
    }
    if (pushError && isUnknownPushError(pushError)) {
      return Object.freeze({
        status: 'unknown-network-result',
        pushed: false,
        retryable: true,
        testedSha: receipt.testedSha,
        refs: Object.freeze(after.refs),
        commands: Object.freeze(commands),
      });
    }
    if (pushError) {
      throw new PublishRunError('PUBLISH_PUSH_REJECTED', 'Atomic preview push was rejected; no fallback was attempted.', {
        testedSha: receipt.testedSha,
        refs: after.refs,
        pushArgs,
      }, { cause: pushError });
    }
    throw new PublishRunError('PUBLISH_PUSH_NOT_APPLIED', 'Atomic push returned without updating either preview ref.', {
      testedSha: receipt.testedSha,
      refs: after.refs,
    });
  }

  return Object.freeze({
    initialize,
    cleanupStaleWorkspaces,
    prepare,
    push,
    reconcile,
    runtimePaths: Object.freeze({
      tempRoot: controlledTempRoot,
      workspacePrefix,
      markerName: PUBLISH_WORKSPACE_MARKER,
      repoRootIdentity,
    }),
  });
}

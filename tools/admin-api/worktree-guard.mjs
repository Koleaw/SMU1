import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class AdminWorktreeGuardError extends Error {
  constructor(code, message, { status = 423, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AdminWorktreeGuardError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function comparablePath(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function exactExpectedBranch(value) {
  const branch = String(value ?? '').trim();
  if (!branch || branch === 'HEAD' || branch.startsWith('refs/heads/')) {
    throw new AdminWorktreeGuardError(
      'ADMIN_EXPECTED_BRANCH_REQUIRED',
      'ADMIN_EXPECTED_BRANCH должен содержать точное короткое имя рабочей ветки.',
      { status: 500 }
    );
  }
  return branch;
}

async function defaultExecuteGit(repoRoot, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return String(stdout ?? '');
}

async function realPathFromGit(repoRoot, value, fileSystem) {
  const reported = String(value ?? '').trim();
  if (!reported) {
    throw new Error('Git returned an empty path.');
  }
  return fileSystem.realpath(path.isAbsolute(reported) ? reported : path.resolve(repoRoot, reported));
}

export function createWorktreeMutationGuard(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const expectedBranch = exactExpectedBranch(options.expectedBranch);
  const fileSystem = options.fileSystem ?? fs;
  const executeGit = options.executeGit ?? ((args) => defaultExecuteGit(repoRoot, args));
  let baseline = null;

  async function inspect() {
    try {
      const [pathsOutput, branchOutput] = await Promise.all([
        executeGit(['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir']),
        executeGit(['branch', '--show-current'])
      ]);
      const reportedPaths = String(pathsOutput ?? '').trim().split(/\r?\n/u);
      if (reportedPaths.length !== 3) throw new Error('Git returned an incomplete worktree identity.');
      const [rootRealPath, topLevel, gitDir, commonDir] = await Promise.all([
        fileSystem.realpath(repoRoot),
        realPathFromGit(repoRoot, reportedPaths[0], fileSystem),
        realPathFromGit(repoRoot, reportedPaths[1], fileSystem),
        realPathFromGit(repoRoot, reportedPaths[2], fileSystem)
      ]);
      if (comparablePath(rootRealPath) !== comparablePath(topLevel)) {
        throw new AdminWorktreeGuardError(
          'ADMIN_WORKTREE_IDENTITY_MISMATCH',
          'Admin API больше не связан с исходным корнем Git checkout. Запись заблокирована.',
          { details: { phase: baseline ? 'mutation' : 'startup' } }
        );
      }
      return Object.freeze({
        branch: String(branchOutput ?? '').trim(),
        root: comparablePath(rootRealPath),
        gitDir: comparablePath(gitDir),
        commonDir: comparablePath(commonDir)
      });
    } catch (cause) {
      if (cause instanceof AdminWorktreeGuardError) throw cause;
      throw new AdminWorktreeGuardError(
        'ADMIN_WORKTREE_UNVERIFIED',
        'Не удалось подтвердить текущую ветку и Git worktree. Запись заблокирована до перезапуска админки.',
        { cause }
      );
    }
  }

  function assertExpectedBranch(state, phase) {
    if (state.branch !== expectedBranch) {
      throw new AdminWorktreeGuardError(
        'ADMIN_EXPECTED_BRANCH_MISMATCH',
        `Открыта ветка «${state.branch || 'detached HEAD'}», а админка настроена на «${expectedBranch}». Запись заблокирована.`,
        {
          status: 409,
          details: { expectedBranch, actualBranch: state.branch || '', phase }
        }
      );
    }
  }

  function sameIdentity(left, right) {
    return left.root === right.root && left.gitDir === right.gitDir && left.commonDir === right.commonDir;
  }

  async function initialize() {
    if (baseline) return publicState();
    const initial = await inspect();
    assertExpectedBranch(initial, 'startup');
    baseline = Object.freeze({ root: initial.root, gitDir: initial.gitDir, commonDir: initial.commonDir });
    return publicState();
  }

  async function assertMutable() {
    if (!baseline) {
      throw new AdminWorktreeGuardError(
        'ADMIN_WORKTREE_GUARD_NOT_INITIALIZED',
        'Worktree guard не инициализирован. Запись заблокирована.',
        { status: 500 }
      );
    }
    const current = await inspect();
    if (!sameIdentity(baseline, current)) {
      throw new AdminWorktreeGuardError(
        'ADMIN_WORKTREE_IDENTITY_MISMATCH',
        'Git worktree изменился после запуска админки. Запись заблокирована до перезапуска.',
        { details: { phase: 'mutation' } }
      );
    }
    assertExpectedBranch(current, 'mutation');
    return Object.freeze({ branch: current.branch, verified: true });
  }

  function publicState() {
    return Object.freeze({ initialized: Boolean(baseline), expectedBranch, repoRoot });
  }

  return Object.freeze({ initialize, assertMutable, status: publicState });
}

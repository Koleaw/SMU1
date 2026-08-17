import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { createWorktreeMutationGuard } from './worktree-guard.mjs';

const execFileAsync = promisify(execFile);

async function git(repoRoot, ...args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return String(stdout ?? '').trim();
}

async function repositoryFixture(t) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-worktree-guard-'));
  // Windows can keep a just-renamed .git directory briefly busy after the
  // final child process exits. Bounded native retries keep teardown
  // deterministic without weakening any guard assertion.
  t.after(() => fs.rm(repoRoot, {
    recursive: true,
    force: true,
    maxRetries: 12,
    retryDelay: 100
  }));
  await git(repoRoot, 'init');
  await git(repoRoot, 'config', 'user.name', 'SMU1 Guard Test');
  await git(repoRoot, 'config', 'user.email', 'guard-test@example.invalid');
  await fs.writeFile(path.join(repoRoot, 'content.json'), '{"title":"initial"}\n', 'utf8');
  await git(repoRoot, 'add', 'content.json');
  await git(repoRoot, 'commit', '-m', 'initial');
  await git(repoRoot, 'branch', '-M', 'candidate');
  return repoRoot;
}

test('mutation guard permits the configured branch and detects an external branch switch', async (t) => {
  const repoRoot = await repositoryFixture(t);
  const guard = createWorktreeMutationGuard({ repoRoot, expectedBranch: 'candidate' });
  await guard.initialize();
  assert.deepEqual(await guard.assertMutable(), { branch: 'candidate', verified: true });

  await git(repoRoot, 'checkout', '-b', 'unexpected-branch');

  await assert.rejects(
    () => guard.assertMutable(),
    (error) => {
      assert.equal(error.code, 'ADMIN_EXPECTED_BRANCH_MISMATCH');
      assert.equal(error.status, 409);
      assert.deepEqual(error.details, {
        expectedBranch: 'candidate',
        actualBranch: 'unexpected-branch',
        phase: 'mutation'
      });
      return true;
    }
  );
});

test('mutation guard fails closed for detached HEAD and an unverifiable checkout', async (t) => {
  const repoRoot = await repositoryFixture(t);
  const guard = createWorktreeMutationGuard({ repoRoot, expectedBranch: 'candidate' });
  await guard.initialize();

  await git(repoRoot, 'checkout', '--detach');
  await assert.rejects(() => guard.assertMutable(), { code: 'ADMIN_EXPECTED_BRANCH_MISMATCH', status: 409 });

  const gitDirectory = path.join(repoRoot, '.git');
  const unavailableGitDirectory = path.join(repoRoot, '.git-unavailable');
  await fs.rename(gitDirectory, unavailableGitDirectory);
  try {
    await assert.rejects(() => guard.assertMutable(), { code: 'ADMIN_WORKTREE_UNVERIFIED', status: 423 });
  } finally {
    await fs.rename(unavailableGitDirectory, gitDirectory);
  }
});

test('mutation guard rejects a wrong configured branch during startup', async (t) => {
  const repoRoot = await repositoryFixture(t);
  const guard = createWorktreeMutationGuard({ repoRoot, expectedBranch: 'other' });
  await assert.rejects(() => guard.initialize(), {
    code: 'ADMIN_EXPECTED_BRANCH_MISMATCH',
    status: 409
  });
});

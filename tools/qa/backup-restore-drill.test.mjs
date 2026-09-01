import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  runBackupRestoreDrill,
  validateBackupRestoreDrillEvidence
} from './backup-restore-drill.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
}).trim();

async function createFixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-h6-real-restore-contract-'));
  const repoRoot = path.join(base, 'repo');
  const tempBase = path.join(base, 'owned-drill-temp');
  const output = path.join(base, 'evidence', 'backup-restore-drill.json');
  await Promise.all([
    fs.mkdir(path.join(repoRoot, 'src', 'content', 'products'), { recursive: true }),
    fs.mkdir(path.join(repoRoot, 'src', 'data'), { recursive: true }),
    fs.mkdir(path.join(repoRoot, 'public', 'uploads'), { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(path.join(repoRoot, 'src', 'content', 'products', 'bench.json'), '{"slug":"bench","title":"Лавка"}\n'),
    fs.writeFile(path.join(repoRoot, 'src', 'data', 'navigation.json'), '[{"label":"Главная","href":"/"}]\n'),
    fs.writeFile(path.join(repoRoot, 'public', 'uploads', 'bench.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    fs.writeFile(path.join(repoRoot, 'public', 'uploads', 'project.jpg'), Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]))
  ]);
  git(repoRoot, 'init', '--quiet');
  git(repoRoot, 'config', 'user.email', 'h6-restore-drill@example.invalid');
  git(repoRoot, 'config', 'user.name', 'H6 restore drill');
  git(repoRoot, 'config', 'core.autocrlf', 'false');
  git(repoRoot, 'add', '.');
  git(repoRoot, 'commit', '--quiet', '-m', 'exact restore fixture');
  t.after(async () => fs.rm(base, { recursive: true, force: true }));
  return { base, repoRoot, tempBase, output };
}

test('real drill clones exact HEAD twice, exports, dry-runs and atomically restores bytes', async (t) => {
  const fixture = await createFixture(t);
  const result = await runBackupRestoreDrill({
    repoRoot: fixture.repoRoot,
    tempBase: fixture.tempBase,
    output: fixture.output,
    log: () => {}
  });
  const evidence = JSON.parse(await fs.readFile(fixture.output, 'utf8'));
  assert.deepEqual(evidence, result.evidence);
  const expectedSourceSHA = git(fixture.repoRoot, 'rev-parse', 'HEAD');
  const expectedBranch = git(fixture.repoRoot, 'branch', '--show-current');
  assert.deepEqual(validateBackupRestoreDrillEvidence(evidence, { expectedSourceSHA, expectedBranch }), { ok: true, issues: [] });
  assert.equal(evidence.source.sha, expectedSourceSHA);
  assert.equal(evidence.source.branch, expectedBranch);
  assert.equal(evidence.backup.fileCount, 4);
  assert.equal(evidence.backup.contentFileCount, 2);
  assert.equal(evidence.backup.mediaFileCount, 2);
  assert.deepEqual(evidence.dryRun.actionCounts, { create: 2, replace: 2, delete: 2 });
  assert.equal(evidence.restore.restoredPathCount, 6);
  assert.equal(evidence.restore.receipt.changedPathCount, 6);
  assert.equal(evidence.restore.journal.mutationCount, 6);
  assert.equal(evidence.comparison.exact, true);
  assert.equal(evidence.cleanup.retained, false);
  const leftovers = await fs.readdir(fixture.tempBase);
  assert.deepEqual(leftovers, [], 'only the owned mkdtemp child is recursively removed');
});

test('evidence contract rejects identity, dry-run and byte-integrity tampering', async (t) => {
  const fixture = await createFixture(t);
  const { evidence } = await runBackupRestoreDrill({
    repoRoot: fixture.repoRoot,
    tempBase: fixture.tempBase,
    output: fixture.output,
    log: () => {}
  });

  const identity = structuredClone(evidence);
  identity.restoreCheckout.sha = '0'.repeat(40);
  assert.match(validateBackupRestoreDrillEvidence(identity).issues.join('\n'), /checkout-sha/u);

  const foreignSource = structuredClone(evidence);
  foreignSource.source.sha = '0'.repeat(40);
  assert.match(validateBackupRestoreDrillEvidence(foreignSource, {
    expectedSourceSHA: evidence.source.sha,
    expectedBranch: evidence.source.branch
  }).issues.join('\n'), /source-sha-mismatch/u);

  const foreignBranch = structuredClone(evidence);
  foreignBranch.source.branch = 'foreign-branch';
  assert.match(validateBackupRestoreDrillEvidence(foreignBranch, {
    expectedSourceSHA: evidence.source.sha,
    expectedBranch: evidence.source.branch
  }).issues.join('\n'), /branch-mismatch/u);

  const dryRun = structuredClone(evidence);
  dryRun.dryRun.actionCounts.delete = 0;
  assert.match(validateBackupRestoreDrillEvidence(dryRun).issues.join('\n'), /dry-run/u);

  const bytes = structuredClone(evidence);
  bytes.comparison.exact = false;
  bytes.comparison.mismatchCount = 1;
  assert.match(validateBackupRestoreDrillEvidence(bytes).issues.join('\n'), /byte-comparison/u);
});

test('real drill works from the shallow exact checkout used by CI', async (t) => {
  const fixture = await createFixture(t);
  const shallowRoot = path.join(fixture.base, 'shallow-source');
  git(fixture.base, 'clone', '--quiet', '--depth', '1', pathToFileURL(fixture.repoRoot).href, shallowRoot);
  assert.equal(git(shallowRoot, 'rev-parse', '--is-shallow-repository'), 'true');
  const output = path.join(fixture.base, 'shallow-evidence', 'backup-restore-drill.json');
  const { evidence } = await runBackupRestoreDrill({
    repoRoot: shallowRoot,
    tempBase: path.join(fixture.base, 'shallow-owned-temp'),
    output,
    log: () => {}
  });
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.source.sha, git(shallowRoot, 'rev-parse', 'HEAD'));
  assert.deepEqual(validateBackupRestoreDrillEvidence(evidence, {
    expectedSourceSHA: evidence.source.sha,
    expectedBranch: evidence.source.branch
  }), { ok: true, issues: [] });
});

test('H6 evidence verifier requires backup restore and binds it to current SHA and branch', async () => {
  const source = await fs.readFile(new URL('./verify-h6-evidence.mjs', import.meta.url), 'utf8');
  assert.match(source, /backupRestore:\s*path\.resolve\([^\n]+backup-restore-drill\.json/u);
  assert.match(source, /backupRestore:\s*await readJson\(filenames\.backupRestore\)/u);
  assert.match(source, /validateBackupRestoreDrillEvidence\(reports\.backupRestore,\s*\{[\s\S]*?expectedSourceSHA:\s*currentEvidence\.sourceSHA,[\s\S]*?expectedBranch:\s*currentEvidence\.branch/u);
  assert.match(source, /identity:\s*validateEvidenceIdentity\(reports,\s*\{\s*currentEvidence\s*\}\)/u);
});

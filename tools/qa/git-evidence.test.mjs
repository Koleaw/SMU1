import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sourceWorkingTreeDirty, sourceWorkingTreeStatus } from './git-evidence.mjs';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });

test('disposable dependency symlink is ignored without hiding real source changes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'smu1-h6-dependency-link-'));
  try {
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.email', 'h6-qa@example.invalid');
    git(root, 'config', 'user.name', 'H6 QA');
    git(root, 'config', 'core.autocrlf', 'false');
    mkdirSync(path.join(root, '.admin-runtime', 'dependencies'), { recursive: true });
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'page.txt'), 'source\n');
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.admin-runtime/\n');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'fixture');
    symlinkSync(path.join(root, '.admin-runtime', 'dependencies'), path.join(root, 'node_modules'), 'dir');
    assert.equal(sourceWorkingTreeStatus(root), '?? node_modules', 'trailing slash fails for a real directory symlink');
    writeFileSync(path.join(root, '.gitignore'), readFileSync(new URL('../../.gitignore', import.meta.url)));
    git(root, 'add', '.gitignore');
    git(root, 'commit', '--quiet', '-m', 'ignore dependencies in either form');
    assert.equal(sourceWorkingTreeStatus(root), '');
    writeFileSync(path.join(root, 'src', 'page.txt'), 'changed source\n');
    assert.match(sourceWorkingTreeStatus(root), /src\/page\.txt/u);
  } finally {
    // This freshly created test root contains both ends of the link.
    rmSync(root, { recursive: true, force: true });
  }
});

test('source dirty identity ignores only generated build/evidence paths', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'smu1-h6-git-evidence-'));
  try {
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.email', 'h6-qa@example.invalid');
    git(root, 'config', 'user.name', 'H6 QA');
    git(root, 'config', 'core.autocrlf', 'false');
    mkdirSync(path.join(root, 'src'));
    mkdirSync(path.join(root, 'dist'));
    mkdirSync(path.join(root, '.astro'));
    mkdirSync(path.join(root, '.admin-runtime'));
    writeFileSync(path.join(root, 'src', 'page.txt'), 'source\n');
    writeFileSync(path.join(root, 'dist', 'index.html'), 'artifact\n');
    writeFileSync(path.join(root, '.astro', 'types.d.ts'), 'generated\n');
    writeFileSync(path.join(root, '.admin-runtime', 'evidence.json'), '{}\n');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'fixture');

    writeFileSync(path.join(root, 'dist', 'index.html'), 'new artifact\n');
    writeFileSync(path.join(root, 'dist', 'new-generated.html'), 'new generated artifact\n');
    writeFileSync(path.join(root, '.astro', 'types.d.ts'), 'new generated\n');
    writeFileSync(path.join(root, '.astro', 'new-generated.d.ts'), 'new generated type\n');
    writeFileSync(path.join(root, '.admin-runtime', 'evidence.json'), '{"new":true}\n');
    writeFileSync(path.join(root, '.admin-runtime', 'new-evidence.json'), '{}\n');
    assert.equal(sourceWorkingTreeStatus(root), '');
    assert.equal(sourceWorkingTreeDirty(root), false);

    writeFileSync(path.join(root, 'src', 'page.txt'), 'changed source\n');
    assert.match(sourceWorkingTreeStatus(root), /src\/page\.txt/u);
    assert.equal(sourceWorkingTreeDirty(root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

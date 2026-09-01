import { execFileSync } from 'node:child_process';

export const SOURCE_ONLY_PATHSPEC = Object.freeze([
  '.',
  ':(exclude)dist', ':(exclude)dist/**',
  ':(exclude).astro', ':(exclude).astro/**',
  ':(exclude).admin-runtime', ':(exclude).admin-runtime/**'
]);

export function sourceWorkingTreeStatus(root) {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', ...SOURCE_ONLY_PATHSPEC], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true
    }).trim();
  } catch {
    return '__git_status_unavailable__';
  }
}

export const sourceWorkingTreeDirty = (root) => Boolean(sourceWorkingTreeStatus(root));

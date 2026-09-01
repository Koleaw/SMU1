import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveAstroCli } from './astro-cli.mjs';

async function fixture(t, packageJson = { bin: { astro: './bin/astro.mjs' } }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-astro-cli-'));
  const packageRoot = path.join(root, 'node_modules', 'astro');
  await fs.mkdir(path.join(packageRoot, 'bin'), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify(packageJson));
  await fs.writeFile(path.join(packageRoot, 'bin', 'astro.mjs'), 'export {};\n');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, packageRoot };
}

test('Astro CLI resolver follows package.json bin.astro and does not depend on removed Astro 6 path', async (t) => {
  const { root, packageRoot } = await fixture(t);
  await assert.rejects(() => fs.access(path.join(packageRoot, 'astro.js')), { code: 'ENOENT' });
  assert.equal(
    await resolveAstroCli(root),
    await fs.realpath(path.join(packageRoot, 'bin', 'astro.mjs'))
  );
});

test('Astro CLI resolver fails before spawn when package bin is missing or escapes the package', async (t) => {
  const missing = await fixture(t, { bin: { astro: './bin/missing.mjs' } });
  await assert.rejects(() => resolveAstroCli(missing.root), { code: 'ASTRO_CLI_MISSING' });

  const escaping = await fixture(t, { bin: { astro: '../../../outside.mjs' } });
  await assert.rejects(() => resolveAstroCli(escaping.root), { code: 'ASTRO_CLI_PATH_ESCAPE' });
});

test('Astro CLI resolver rejects a bin symlink or junction that resolves outside the package', async (t) => {
  const { root, packageRoot } = await fixture(t, { bin: { astro: './external/astro.mjs' } });
  const outside = path.join(root, 'outside-bin');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'astro.mjs'), 'export {};\n');
  await fs.symlink(outside, path.join(packageRoot, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => resolveAstroCli(root), { code: 'ASTRO_CLI_PATH_ESCAPE' });
});

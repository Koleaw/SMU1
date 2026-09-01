import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  createBrowserFinalMountTable,
  normalizeBrowserFinalBasePath,
  resolveBrowserFinalMountRequest,
  resolveBrowserFinalDistRequest,
  withBrowserFinalBasePath,
  withoutBrowserFinalBasePath
} from '../migration/browser-final-base-path.mjs';

test('final browser QA mounts and navigates the exact configured BASE_PATH', () => {
  const distRoot = path.resolve('fixture-dist');
  assert.equal(normalizeBrowserFinalBasePath('SMU1/'), '/SMU1');
  assert.equal(withBrowserFinalBasePath('/', '/SMU1/'), '/SMU1/');
  assert.equal(withBrowserFinalBasePath('/catalog/item/?view=qa#hero', '/SMU1'), '/SMU1/catalog/item/?view=qa#hero');
  assert.equal(withoutBrowserFinalBasePath('/SMU1/_astro/page.js', '/SMU1'), '/_astro/page.js');
  assert.equal(withoutBrowserFinalBasePath('/_astro/page.js', '/SMU1'), null);

  const mounted = resolveBrowserFinalDistRequest(distRoot, '/SMU1/_astro/page.js', '/SMU1');
  assert.equal(mounted.status, 'ok');
  assert.equal(mounted.logicalPathname, '/_astro/page.js');
  assert.equal(mounted.filename, path.join(distRoot, '_astro', 'page.js'));

  const rootMounted = resolveBrowserFinalDistRequest(distRoot, '/SMU1/', '/SMU1');
  assert.equal(rootMounted.status, 'ok');
  assert.equal(rootMounted.filename, distRoot);
  assert.equal(resolveBrowserFinalDistRequest(distRoot, '/outside/', '/SMU1').status, 'outside-base');
});

test('final browser QA base-path parser rejects ambiguous or escaping inputs', () => {
  for (const value of ['/SMU1/../private', '/SMU1?mode=qa', '\\SMU1']) {
    assert.throws(() => normalizeBrowserFinalBasePath(value), /Invalid browser QA BASE_PATH/u);
  }
  assert.throws(() => withBrowserFinalBasePath('https://example.test/', '/SMU1'), /absolute pathname/u);
});

test('motion QA keeps the temporary Astro outDir on the checkout filesystem', async () => {
  const source = await readFile(path.resolve('tools/migration/h2-motion-qa.mjs'), 'utf8');
  assert.match(source, /path\.join\(root, '\.admin-runtime', 'h2-motion-base-build'\)/u);
  assert.match(source, /Promise\.all\(\[stat\(root\), stat\(baseBuildTempBase\)\]\)/u);
  assert.match(source, /repoDevice\.dev !== tempDevice\.dev/u);
  assert.doesNotMatch(source, /mkdtemp\(path\.join\(os\.tmpdir\(\), 'smu1-h2-base-build-'\)\)/u);
});

test('motion QA mount resolver is boundary-aware, deduplicated, and longest-base-first', () => {
  const primary = (basePath) => ({ kind: 'primary-dist', basePath, root: `fixture/primary${basePath}` });
  const github = (basePath) => ({ kind: 'temporary-base-build', basePath, root: `fixture/github${basePath}` });
  const resolveKind = (mounts, pathname) => resolveBrowserFinalMountRequest(mounts, pathname).mount?.kind || 'outside';

  const matrix = [
    {
      name: 'root primary and /SMU1 GitHub mount',
      mounts: [primary('/'), github('/SMU1/')],
      cases: [['/', 'primary-dist'], ['/catalog/', 'primary-dist'], ['/SMU1/', 'temporary-base-build'], ['/SMU1/item/', 'temporary-base-build']]
    },
    {
      name: 'equal /SMU1 bases reuse the first primary artifact',
      mounts: [primary('/SMU1/'), github('/SMU1')],
      expectedMounts: 1,
      cases: [['/SMU1', 'primary-dist'], ['/SMU1/item/', 'primary-dist'], ['/', 'outside']]
    },
    {
      name: 'more-specific primary wins an overlapping GitHub mount',
      mounts: [primary('/SMU1/custom/'), github('/SMU1/')],
      cases: [['/SMU1/custom/item/', 'primary-dist'], ['/SMU1/other/', 'temporary-base-build']]
    },
    {
      name: 'more-specific primary wins when GitHub mount is root',
      mounts: [primary('/custom/'), github('/')],
      cases: [['/custom/item/', 'primary-dist'], ['/other/', 'temporary-base-build']]
    },
    {
      name: 'disjoint bases remain scoped',
      mounts: [primary('/custom/'), github('/SMU1/')],
      cases: [['/custom/item/', 'primary-dist'], ['/SMU1/item/', 'temporary-base-build'], ['/other/', 'outside']]
    },
    {
      name: 'base boundary rejects a lookalike prefix',
      mounts: [primary('/SMU1/')],
      cases: [['/SMU1/item/', 'primary-dist'], ['/SMU1-evil/item/', 'outside']]
    },
    {
      name: 'outside every configured base has no fallback mount',
      mounts: [primary('/alpha/'), github('/beta/')],
      cases: [['/', 'outside'], ['/gamma/', 'outside']]
    }
  ];

  for (const row of matrix) {
    const table = createBrowserFinalMountTable(row.mounts);
    if (row.expectedMounts !== undefined) assert.equal(table.length, row.expectedMounts, row.name);
    for (const [pathname, expectedKind] of row.cases) {
      assert.equal(resolveKind(row.mounts, pathname), expectedKind, `${row.name}: ${pathname}`);
    }
  }
});

test('motion QA integrates the pure mount resolver and rejects unmatched paths before filesystem lookup', async () => {
  const source = await readFile(path.resolve('tools/migration/h2-motion-qa.mjs'), 'utf8');
  assert.match(source, /normalizeBase\(process\.env\.BASE_PATH \|\| '\/'\)/u);
  assert.match(source, /primaryBase !== options\.githubBase/u);
  assert.match(source, /resolveBrowserFinalMountRequest\(mounts, pathname\)/u);
  assert.match(source, /resolvedMount\.status === 'outside-base'/u);
  assert.doesNotMatch(source, /__outside-configured-base__/u);
  assert.match(source, /const coveredByPrimaryArtifact = primaryBase === options\.githubBase/u);
  assert.match(source, /artifact: coveredByPrimaryArtifact \? 'primary-dist' : 'temporary-base-build'/u);
});

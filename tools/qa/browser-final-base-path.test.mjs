import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeBrowserFinalBasePath,
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

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateExactTargetedBuildEvidence } from './exact-targeted-build-evidence.mjs';

const SHA = 'a'.repeat(40);
const base = () => ({
  schemaVersion: 1,
  kind: 'smu1-h6-exact-targeted-build',
  status: 'pass',
  sourceSHA: SHA,
  branch: 'candidate',
  dirty: false,
  basePath: '/SMU1',
  fullBuild: { routeSetExact: true, routeCount: 111 },
  selection: {
    expectations: [{ route: '/', expected: 'html' }, { route: '/missing/', expected: 'not-found' }],
    expectedSelectedRoutes: ['/', '/404.html'],
    expectedTargetedHtmlRoutes: ['/', '/404.html'],
    rendererFamilies: ['home', 'catalog', 'direction', 'category', 'product', 'project-archive', 'project', 'practical', 'custom-order', 'not-found', 'compatibility-alias'],
    rendererVariants: ['home-final']
  },
  runner: {
    mode: 'targeted-production-ssg', artifact: { manifestSha256: 'b'.repeat(64), fileCount: 10 },
    prerender: { selectedRoutes: ['/', '/404.html'] }, targetedHtmlRoutes: ['/', '/404.html']
  },
  comparisons: [
    { route: '/', expected: 'html', fullSha256: 'd'.repeat(64), status: 'byte-identical' },
    { route: '/missing/', expected: 'not-found', fullSha256: 'e'.repeat(64), routeAbsent: true, fallback404ByteIdentical: true, status: 'byte-identical' }
  ],
  h5SourceCache: {
    before: { aggregateSha256: 'c'.repeat(64), fileCount: 10, totalBytes: 100 },
    after: { aggregateSha256: 'c'.repeat(64), fileCount: 10, totalBytes: 100 }, unchanged: true
  }
});

test('real exact targeted smoke is mandatory in every release DAG and final evidence reconciliation', async () => {
  const [packageSource, workflow, runtime, verifier] = await Promise.all([
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
    readFile(new URL('../admin-api/publish-runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./verify-h6-evidence.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(packageSource, /"qa:h6:exact-targeted":\s*"node tools\/qa\/exact-targeted-build\.mjs"/u);
  assert.match(packageSource, /"qa:final":[^\n]+npm run build && npm run qa:h6:exact-targeted/u);
  assert.match(workflow, /run: npm run build[\s\S]{0,500}run: npm run qa:h6:exact-targeted/u);
  assert.match(runtime, /id: 'build'[\s\S]{0,180}id: 'exact-targeted-build'/u);
  assert.match(verifier, /exactTargeted:[\s\S]*validateExactTargetedBuildEvidence/u);
});

test('exact targeted evidence requires real route selection, byte parity, not-found and immutable H5 cache', () => {
  const expectedHtmlFileHashes = [['/', 'd'.repeat(64)], ['/404.html', 'e'.repeat(64)]];
  assert.equal(validateExactTargetedBuildEvidence(base(), { expectedSourceSHA: SHA, expectedBranch: 'candidate', expectedBasePath: '/SMU1', expectedHtmlFileHashes }).ok, true);
  for (const mutate of [
    (value) => { value.runner.targetedHtmlRoutes.push('/unrelated/'); },
    (value) => { value.comparisons[0].status = 'fail'; },
    (value) => { value.comparisons[1].routeAbsent = false; },
    (value) => { value.h5SourceCache.after.aggregateSha256 = 'd'.repeat(64); },
    (value) => { value.dirty = true; }
  ]) {
    const value = base();
    mutate(value);
    assert.equal(validateExactTargetedBuildEvidence(value, { expectedSourceSHA: SHA, expectedBranch: 'candidate', expectedBasePath: '/SMU1', expectedHtmlFileHashes }).ok, false);
  }
  const stale = base();
  assert.match(validateExactTargetedBuildEvidence(stale, { expectedHtmlFileHashes: [['/', 'f'.repeat(64)], ['/404.html', 'e'.repeat(64)]] }).issues.join('\n'), /current-html-identity/u);
});

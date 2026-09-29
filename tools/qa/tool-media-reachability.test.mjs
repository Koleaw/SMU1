import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditDeployMediaReachability } from '../performance/deploy-media-reachability.mjs';

async function catalogFixture(t, { filename = 'instrumenty/catalog.json', thumbnail = '/_media/small.webp', includeThumbnail = true } = {}) {
  const distRoot = await mkdtemp(path.join(os.tmpdir(), 'smu-tool-media-'));
  t.after(() => rm(distRoot, { recursive: true, force: true }));
  const files = {
    'index.html': '<!doctype html><html><body>Catalog</body></html>',
    'assets/original.jpg': 'original source bytes',
    '_media/small.webp': 'smaller browser bytes',
    [filename]: JSON.stringify({ version: '1.0.0', products: [{ image: '/assets/original.jpg', ...(includeThumbnail ? { thumbnail } : {}) }] })
  };
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(distRoot, name)), { recursive: true });
    await writeFile(path.join(distRoot, name), body);
  }
  return distRoot;
}

for (const basePath of ['/', '/SMU1/']) test(`tool catalog retains its display thumbnail and treats source identity as metadata (${basePath})`, async (t) => {
  const distRoot = await catalogFixture(t);
  const result = await auditDeployMediaReachability({ distRoot, expectedHtmlCount: 1, basePath });
  assert.equal(result.failClosed.pass, true);
  assert.deepEqual(result.unreferencedCandidates.map(item => item.path), ['assets/original.jpg']);
  assert.ok(result.referencedLocalFiles.some(item => item.path === '_media/small.webp'));
});

test('catalog fallback still retains its original and arbitrary JSON gets no exception', async (t) => {
  for (const config of [{ thumbnail: '/assets/original.jpg' }, { thumbnail: '/' }, { includeThumbnail: false }, { filename: 'other.json' }]) {
    const distRoot = await catalogFixture(t, config);
    const result = await auditDeployMediaReachability({ distRoot, expectedHtmlCount: 1, basePath: '/' });
    assert.equal(result.failClosed.pass, true);
    assert.ok(result.referencedLocalFiles.some(item => item.path === 'assets/original.jpg'));
  }
});

test('missing catalog thumbnail fails closed instead of silently pruning a usable resource', async (t) => {
  const distRoot = await catalogFixture(t, { thumbnail: '/_media/missing.webp' });
  const result = await auditDeployMediaReachability({ distRoot, expectedHtmlCount: 1, basePath: '/' });
  assert.equal(result.failClosed.pass, false);
  assert.equal(result.errors.missingReferences.length, 1);
  await assert.rejects(auditDeployMediaReachability({ distRoot, expectedHtmlCount: 1, basePath: '/', apply: true }), /Refusing --apply/u);
});

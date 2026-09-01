import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildExpectedRouteModel,
  discoverArtifactFiles,
  discoverProductionHtml,
  fingerprintArtifact,
  fingerprintProductionHtml,
  inspectPublicArtifactIsolation,
  productionHtmlFilename,
  reconcileRouteSets,
  REQUIRED_VIEWPORTS,
  summarizeRouteModel
} from './route-passport-model.mjs';

test('authoritative source model describes every current production route and required viewport', () => {
  const model = buildExpectedRouteModel();
  const summary = summarizeRouteModel(model.routes);
  assert.equal(summary.total, 111);
  assert.deepEqual(summary.routeClasses, { canonical: 107, '404': 1, alias: 3 });
  assert.equal(summary.rendererVariants['product-list'], 11);
  assert.equal(summary.rendererVariants['gallery-only'], 6);
  assert.equal(summary.rendererVariants['text-only'], 2);
  assert.equal(summary.rendererVariants.mixed, 1);
  assert.equal(summary.rendererVariants['standard-media'], 56);
  assert.equal(summary.rendererVariants['standard-no-media'], 3);
  assert.equal(summary.rendererVariants['premium-media'], 9);
  assert.equal(summary.rendererFamilies.practical, 5);
  assert.equal(summary.rendererVariants['vacancy-detail'], 1);
  for (const variant of [
    'direction-engineering-visual', 'direction-visual', 'direction-engineering-commercial',
    'direction-project-commercial', 'direction-place-commercial'
  ]) assert.equal(summary.rendererVariants[variant], 1);
  for (const variant of [
    'gallery+landscape+media-first',
    'text-only+landscape+text-only',
    'large-gallery+landscape+media-first',
    'gallery+portrait+media-last'
  ]) assert.equal(summary.rendererVariants[variant], 1);
  assert.deepEqual(REQUIRED_VIEWPORTS.map(({ id, width, height }) => ({ id, width, height })), [
    { id: 'desktop-1440x900', width: 1440, height: 900 },
    { id: 'mobile-390x844', width: 390, height: 844 }
  ]);
});

test('dist discovery excludes admin and design-lab but retains 404 and aliases', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'smu1-route-passport-'));
  try {
    for (const relative of [
      'index.html', '404.html', 'canonical/index.html', 'alias/index.html',
      'admin/index.html', 'design-lab/v2/canonical/index.html'
    ]) {
      const filename = path.join(temporaryRoot, relative);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, '<!doctype html>', 'utf8');
    }
    const discovered = discoverProductionHtml(temporaryRoot);
    assert.deepEqual(discovered, ['/', '/404.html', '/alias/', '/canonical/']);
    const fingerprint = fingerprintProductionHtml(temporaryRoot, discovered);
    assert.match(fingerprint.aggregate, /^[a-f0-9]{64}$/u);
    assert.deepEqual(fingerprint.entries.map(([route]) => route), discovered);
    assert.equal(productionHtmlFilename(temporaryRoot, '/404.html'), path.join(temporaryRoot, '404.html'));
    assert.equal(productionHtmlFilename(temporaryRoot, '/custom.html'), path.join(temporaryRoot, 'custom.html'));
    const artifactFiles = discoverArtifactFiles(temporaryRoot);
    const artifactFingerprint = fingerprintArtifact(temporaryRoot, artifactFiles);
    assert.equal(artifactFingerprint.fileCount, 6);
    assert.match(artifactFingerprint.aggregate, /^[a-f0-9]{64}$/u);
    const isolation = inspectPublicArtifactIsolation(temporaryRoot, artifactFiles);
    assert.equal(isolation.clean, false);
    assert.ok(isolation.leaks.some((issue) => issue.kind === 'admin-route-not-noindex'));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('route reconciliation reports concrete missing and unexpected URLs', () => {
  assert.deepEqual(reconcileRouteSets(['/', '/one/'], ['/', '/two/']), {
    expected: ['/', '/one/'],
    discovered: ['/', '/two/'],
    missing: ['/one/'],
    unexpected: ['/two/'],
    exact: false
  });
});

test('inert admin compatibility pages may share public prefetch but never an editor bundle', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'smu1-artifact-isolation-'));
  try {
    await mkdir(path.join(temporaryRoot, 'admin'), { recursive: true });
    await mkdir(path.join(temporaryRoot, '_astro'), { recursive: true });
    await writeFile(
      path.join(temporaryRoot, 'admin/index.html'),
      '<meta name="robots" content="noindex"><h1>Локальный редактор</h1><script type="module" src="/_astro/page.abc.js"></script>',
      'utf8'
    );
    await writeFile(path.join(temporaryRoot, '_astro/page.abc.js'), 'const publicPrefetch = true;', 'utf8');
    assert.equal(inspectPublicArtifactIsolation(temporaryRoot).clean, true);

    await writeFile(path.join(temporaryRoot, '_astro/page.abc.js'), 'fetch("/api/admin/session", { headers: { "x-admin-csrf": "secret" } });', 'utf8');
    const isolation = inspectPublicArtifactIsolation(temporaryRoot);
    assert.equal(isolation.clean, false);
    assert.ok(isolation.leaks.some((issue) => issue.relative === '_astro/page.abc.js' && issue.kind === 'admin-api-client'));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

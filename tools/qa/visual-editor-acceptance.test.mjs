import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import {
  acceptanceBrowserExpressionsForTest,
  inspectAcceptanceRasterFixture,
  isReleaseMutation,
  parseLoopbackOrigin,
  percentile95,
  sanitizeRequestUrl
} from './visual-editor-acceptance.mjs';

test('visual acceptance raster preflight performs a full decode, not a magic-only check', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smu1-ve-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const malformed = path.join(directory, 'magic-only.jpg');
  const valid = path.join(directory, 'valid.png');
  await writeFile(malformed, Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(valid, await sharp({ create: { width: 2, height: 3, channels: 3, background: '#6d897c' } }).png().toBuffer());
  await assert.rejects(() => inspectAcceptanceRasterFixture(malformed), /full pinned-Sharp decode/u);
  const evidence = await inspectAcceptanceRasterFixture(valid);
  assert.equal(evidence.name, 'valid.png');
  assert.equal(evidence.format, 'png');
  assert.equal(evidence.width, 2);
  assert.equal(evidence.height, 3);
  assert.equal(evidence.pixels, 6);
  assert.equal(evidence.fullDecode, true);
  assert.match(evidence.sha256, /^[a-f0-9]{64}$/u);
});

test('visual acceptance core browser probes are syntactically valid JavaScript', () => {
  for (const expression of acceptanceBrowserExpressionsForTest()) {
    assert.doesNotThrow(() => new Function(`return (${expression});`));
  }
});

test('local production canvas excludes the unrelated Astro developer toolbar', async () => {
  const config = await readFile(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
  assert.match(config, /devToolbar:\s*\{\s*enabled:\s*false\s*\}/u);
});

test('isolated admin browser sandbox includes every runtime release dependency', async () => {
  const source = await readFile(new URL('../admin-api/admin-browser-roundtrip.mjs', import.meta.url), 'utf8');
  assert.match(source, /cp\(path\.join\(root, 'tools', 'release'\),\s*path\.join\(sandbox, 'tools', 'release'\),\s*\{ recursive: true \}\)/u);
});

test('secondary editor keeps reloadable History API routes on its own document', async () => {
  const source = await readFile(new URL('../../src/admin/shell/AdminShell.astro', import.meta.url), 'utf8');
  assert.match(source, /const adminBase = withBase\('\/admin\/all-materials\/'\);/u);
});

test('legacy final static gate enforces H6 public isolation and schema-owned premium copy', async () => {
  const source = await readFile(new URL('../migration/final-design-qa.mjs', import.meta.url), 'utf8');
  assert.match(source, /rendering\.admin-public-isolation/u);
  assert.doesNotMatch(source, /rendering\.admin-presentation-control/u);
  assert.match(source, /settings\.productUi\.cardPremiumLabel/u);
  assert.match(source, /site-settings\/global\.json#productUi\.cardPremiumLabel/u);
});

test('visual acceptance origin parser is loopback-only and accepts no URL credentials or paths', () => {
  assert.equal(parseLoopbackOrigin('http://127.0.0.1:4321'), 'http://127.0.0.1:4321');
  assert.equal(parseLoopbackOrigin('http://localhost:4321/'), 'http://localhost:4321');
  assert.equal(parseLoopbackOrigin('http://[::1]:4321'), 'http://[::1]:4321');
  assert.throws(() => parseLoopbackOrigin('http://0.0.0.0:4321'), /loopback/u);
  assert.throws(() => parseLoopbackOrigin('http://192.168.1.4:4321'), /loopback/u);
  assert.throws(() => parseLoopbackOrigin('http://user:secret@127.0.0.1:4321'), /Credentials/u);
  assert.throws(() => parseLoopbackOrigin('http://127.0.0.1:4321/admin/'), /must not contain/u);
});

test('visual acceptance percentile is deterministic and uses nearest-rank p95', () => {
  assert.equal(percentile95([]), null);
  assert.equal(percentile95([10]), 10);
  assert.equal(percentile95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), 19);
  assert.equal(percentile95([20, Number.NaN, 10]), 20);
});

test('visual acceptance redacts query values and distinguishes release reads from mutations', () => {
  assert.deepEqual(sanitizeRequestUrl('http://127.0.0.1:4321/page?editorSession=secret&revision=2'), {
    origin: 'http://127.0.0.1:4321', pathname: '/page', queryKeys: ['editorSession', 'revision']
  });
  assert.equal(isReleaseMutation('GET', 'http://127.0.0.1:4321/api/admin/publish/status'), false);
  assert.equal(isReleaseMutation('POST', 'http://127.0.0.1:4321/api/admin/publish/preview'), true);
  assert.equal(isReleaseMutation('POST', 'http://127.0.0.1:4321/api/admin/publish-all'), true);
  assert.equal(isReleaseMutation('POST', 'http://127.0.0.1:4321/api/admin/publish-status'), true);
  assert.equal(isReleaseMutation('POST', 'http://127.0.0.1:4321/api/admin/publish-report'), true);
  assert.equal(isReleaseMutation('DELETE', 'http://127.0.0.1:4321/api/admin/rollback/x'), true);
  assert.equal(isReleaseMutation('POST', 'http://127.0.0.1:4321/api/admin/validation/request'), false);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  hasAdminEditorRevisionShape,
  hasAdminEditorSessionShape,
  isAdminHomeCanvasReady
} from './admin-canvas-contract.mjs';

const readyCanvas = () => ({
  ready: true,
  srcOriginPath: 'http://127.0.0.1:4321/',
  locationOriginPath: 'http://127.0.0.1:4321/',
  queryKeys: ['__smu1_editor', 'editorMode', 'editorRevision', 'editorSession'],
  logicalRoute: '/',
  editorMode: '1',
  editorSessionShape: true,
  editorRevisionShape: true,
  h1: ['Главная'],
  bindings: 12,
  interactions: 8,
  overlays: 7
});

test('admin Home canvas waits for production bindings, interactions, overlays, and bridge parameters', () => {
  assert.equal(isAdminHomeCanvasReady(readyCanvas()), true);
  for (const patch of [
    { locationOriginPath: '' },
    { logicalRoute: 'blank' },
    { editorMode: '' },
    { editorSessionShape: false },
    { editorRevisionShape: false },
    { h1: [] },
    { bindings: 0 },
    { interactions: 0 },
    { overlays: 0 }
  ]) {
    assert.equal(isAdminHomeCanvasReady({ ...readyCanvas(), ...patch }), false, JSON.stringify(patch));
  }
});

test('admin editor nonce and revision shapes are exact and bounded', () => {
  assert.equal(hasAdminEditorSessionShape('6e978464-ea27-49de-92d4-44cb175166e8'), true);
  assert.equal(hasAdminEditorSessionShape('6e978464-ea27-19de-92d4-44cb175166e8'), false);
  assert.equal(hasAdminEditorSessionShape('------------------------------------'), false);
  assert.equal(hasAdminEditorRevisionShape('1'), true);
  assert.equal(hasAdminEditorRevisionShape('123456789012'), true);
  assert.equal(hasAdminEditorRevisionShape('1234567890123'), false);
  assert.equal(hasAdminEditorRevisionShape('-1'), false);
});

test('admin action inventory keeps iframe links unresolved so editor nonces cannot enter evidence', async () => {
  const source = await readFile(new URL('./admin-action-crawl.mjs', import.meta.url), 'utf8');
  assert.match(source, /href:\s*element\.getAttribute\('href'\)\s*\|\|\s*''/u);
  assert.doesNotMatch(source, /href:\s*element\.href/u);
  assert.match(source, /button\.scrollIntoView\(\{ block: 'center', inline: 'nearest', behavior: 'instant' \}\);\s*button\.focus/u);
});

test('compatibility aliases render their canonical target in the editor canvas', async () => {
  const source = await readFile(new URL('../../src/admin/shell/visual-editor-app.mjs', import.meta.url), 'utf8');
  assert.match(source, /withBase\(siteBase,\s*page\.canonicalTarget\s*\|\|\s*page\.route\)/u);
  assert.match(source, /const aliasPreview = Boolean\(state\.currentPage\?\.readOnly && state\.currentPage\?\.canonicalTarget\)/u);
  assert.match(source, /app\.dataset\.aliasCanvasReady = 'false'[\s\S]*app\.dataset\.aliasCanvasRevision = ''[\s\S]*frame\.src = buildCanvasUrl/u);
  assert.match(source, /if \(aliasPreview\) \{[\s\S]*state\.bindingRows = \[\][\s\S]*overlay\.replaceChildren\(\)[\s\S]*aliasCanvasReady = 'true'[\s\S]*aliasCanvasRevision = String\(state\.frameRevision\)[\s\S]*Совместимый адрес/u);
  assert.match(source, /handleVisualEditorEscape\(event,[\s\S]*cancelInline: cancelInlineEditor[\s\S]*closeInspector/u);
});

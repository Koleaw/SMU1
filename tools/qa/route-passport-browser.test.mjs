import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('binding registry inventory preserves DOM provenance through parseBinding', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /const parseBinding = \(owner\) => \{[\s\S]*?domTarget:\s*\{[\s\S]*?bindingIdAttribute:/u);
  assert.match(source, /const bindings = Array\.from\(document\.querySelectorAll\('\[data-smu1-binding\]'\)\)\.map\(parseBinding\);/u);
  assert.doesNotMatch(source, /const bindings = [\s\S]{0,240}JSON\.parse\(element\.getAttribute\('data-smu1-binding'\)\)/u);
});

test('editor equivalence explicitly classifies runtime-only surfaces and uses stable landmarks', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  for (const marker of ['data-cookie-banner', 'data-v2-entry-skip-link', 'data-v2-entry-root']) assert.match(source, new RegExp(marker, 'u'));
  assert.match(source, /comparableBusinessText\(snapshot\)/u);
  assert.match(source, /compareStableGeometry\(snapshot\.stableGeometry, editorSnapshot\.stableGeometry\)/u);
  assert.doesNotMatch(source, /editorSnapshot\.documentSize\.scrollHeight\s*!==\s*snapshot\.documentSize\.scrollHeight/u);
});

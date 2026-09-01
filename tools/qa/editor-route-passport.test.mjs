import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./editor-route-passport.mjs', import.meta.url), 'utf8');

test('editor route passport keeps the loopback renderer at root while preserving the public deployment base', () => {
  assert.match(source, /BASE_PATH:\s*'\/'/u);
  assert.match(source, /waitForHttp\(`\$\{origin\}\/`,\s*editor\)/u);
  assert.match(source, /`--base=\$\{basePath\}`/u);
  assert.match(source, /TEST_SITE_URL:\s*origin/u);
  assert.doesNotMatch(source, /BASE_PATH:\s*basePath/u);
  assert.doesNotMatch(source, /waitForHttp\(`\$\{origin\}\$\{normalizedBase\}/u);
});

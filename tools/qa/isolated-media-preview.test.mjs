import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { isolatedMediaPreview } from './isolated-media-preview.mjs';

test('isolated preview serves newly promoted bytes and refuses noncanonical paths', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-isolated-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const uploads = path.join(root, 'public', 'uploads');
  await mkdir(uploads, { recursive: true });
  let middleware;
  isolatedMediaPreview(root).configureServer({ middlewares: { use(value) { middleware = value; } } });
  const file = `${'a'.repeat(64)}.png`;
  const request = async (url, method = 'GET') => {
    const result = { headers: {}, next: false };
    await middleware({ url, method }, {
      set statusCode(value) { result.status = value; },
      setHeader(key, value) { result.headers[key] = value; },
      end(bytes) { result.bytes = bytes; }
    }, (error) => { assert.ifError(error); result.next = true; });
    return result;
  };
  assert.equal((await request(`/uploads/${file}`)).next, true);
  const bytes = Buffer.from('canonical promotion proof');
  await writeFile(path.join(uploads, file), bytes);
  const served = await request(`/uploads/${file}?v=1`);
  assert.equal(served.status, 200);
  assert.deepEqual(served.bytes, bytes);
  assert.equal(served.headers['Content-Type'], 'image/png');
  assert.equal(served.headers['Cache-Control'], 'no-store');
  assert.equal((await request(`/uploads/${file}`, 'HEAD')).bytes, undefined);
  for (const url of ['/uploads/../secret', '/uploads/%2e%2e/secret', '/.admin-runtime/secret', '/uploads/private.json']) {
    assert.equal((await request(url)).next, true, url);
  }
  assert.equal((await request(`/uploads/${file}`, 'POST')).next, true);
});

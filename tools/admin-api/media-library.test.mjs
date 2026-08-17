import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createMediaLibraryService } from './media-library.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-media-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src', 'content', 'products'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'data'), { recursive: true });
  await fs.mkdir(path.join(root, 'public', 'uploads'), { recursive: true });
  await fs.mkdir(path.join(root, 'public', '_media', 'h5'), { recursive: true });
  const red = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#f00' } }).jpeg().toBuffer();
  const blue = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#00f' } }).webp().toBuffer();
  await fs.writeFile(path.join(root, 'public', 'uploads', 'red.jpg'), red);
  await fs.writeFile(path.join(root, 'public', 'uploads', 'blue.webp'), blue);
  await fs.writeFile(path.join(root, 'public', '_media', 'h5', 'generated.jpg'), red);
  await fs.writeFile(path.join(root, 'src', 'content', 'products', 'bench.json'), JSON.stringify({
    slug: 'bench', image: '/uploads/red.jpg', gallery: ['/uploads/red.jpg', '/_media/h5/generated.jpg']
  }));
  await fs.writeFile(path.join(root, 'src', 'data', 'navigation.json'), '[]');
  await fs.writeFile(path.join(root, 'src', 'data', 'yandex.json'), '{}');
  return { root, red, blue };
}

test('library indexes canonical originals with pagination, metadata and exact references', async (t) => {
  const { root } = await fixture(t);
  const service = createMediaLibraryService({ repoRoot: root });
  const all = await service.list({ page: 1, pageSize: 1 });
  assert.equal(all.total, 2);
  assert.equal(all.items.length, 1);
  assert.equal(all.pages, 2);
  const used = await service.list({ usage: 'used', search: 'red' });
  assert.equal(used.total, 1);
  assert.equal(used.items[0].path, '/uploads/red.jpg');
  assert.equal(used.items[0].usageCount, 2);
  assert.equal(used.items[0].width, 40);
  assert.equal(used.items[0].height, 30);
  assert.equal(used.items[0].sha256.length, 64);
  assert.equal(used.items.some((item) => item.path.includes('_media/h5')), false);
  const unreferenced = await service.list({ usage: 'unreferenced' });
  assert.deepEqual(unreferenced.items.map((item) => item.path), ['/uploads/blue.webp']);
});

test('library rejects unsafe paging without returning the whole repository inventory', async (t) => {
  const { root } = await fixture(t);
  const service = createMediaLibraryService({ repoRoot: root });
  await assert.rejects(service.list({ pageSize: 51 }), (error) => error.code === 'MEDIA_LIBRARY_PAGE_INVALID');
  await assert.rejects(service.list({ page: 0 }), (error) => error.code === 'MEDIA_LIBRARY_PAGE_INVALID');
});

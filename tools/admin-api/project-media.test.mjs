import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseMultipartFiles,
  projectMediaFilename,
  saveProjectMediaFiles
} from './project-media.mjs';

function multipartBody(boundary, files) {
  const parts = [];
  for (const file of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.body);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

test('batch multipart parser returns every selected file', () => {
  const boundary = 'smu1-test-boundary';
  const body = multipartBody(boundary, [
    { name: 'one.jpg', type: 'image/jpeg', body: Buffer.from('first') },
    { name: 'two.png', type: 'image/png', body: Buffer.from('second') }
  ]);
  const files = parseMultipartFiles(body, `multipart/form-data; boundary=${boundary}`);
  assert.deepEqual(files.map((file) => file.filename), ['one.jpg', 'two.png']);
  assert.deepEqual(files.map((file) => file.fileBuffer.toString()), ['first', 'second']);
});

test('project uploads use content-addressed names and reuse an identical file', async (t) => {
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-project-media-'));
  t.after(() => fs.rm(uploadsDir, { recursive: true, force: true }));
  const body = Buffer.from('same image bytes');
  const first = await saveProjectMediaFiles([{ filename: 'photo.jpg', fileBuffer: body }], { uploadsDir });
  const second = await saveProjectMediaFiles([{ filename: 'copy.jpg', fileBuffer: body }], { uploadsDir });
  assert.equal(first.files.length, 1);
  assert.equal(first.files[0].reused, false);
  assert.equal(second.files[0].reused, true);
  assert.equal(second.files[0].path, first.files[0].path);
  assert.equal(path.basename(first.files[0].path), projectMediaFilename('photo.jpg', body));
  assert.equal((await fs.readdir(uploadsDir)).length, 1);
});

test('batch upload keeps valid files and reports invalid files without aborting the batch', async (t) => {
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-project-media-'));
  t.after(() => fs.rm(uploadsDir, { recursive: true, force: true }));
  const result = await saveProjectMediaFiles([
    { filename: 'valid.webp', fileBuffer: Buffer.from('valid') },
    { filename: 'invalid.exe', fileBuffer: Buffer.from('invalid') }
  ], { uploadsDir });
  assert.equal(result.files.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].name, 'invalid.exe');
});

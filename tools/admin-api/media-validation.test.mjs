import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  canonicalMediaFilename,
  canonicalPublicMediaPath,
  detectMediaFormat,
  validateMediaUpload,
  validateRasterMedia,
  validateVideoMedia
} from './media-validation.mjs';

function created(width, height, background) {
  return sharp({ create: { width, height, channels: 4, background } });
}

async function fixtures() {
  const jpeg = await created(4, 3, { r: 140, g: 80, b: 20, alpha: 1 }).jpeg().toBuffer();
  const png = await created(3, 2, { r: 20, g: 100, b: 180, alpha: 0.4 }).png().toBuffer();
  const webp = await created(5, 2, { r: 80, g: 160, b: 30, alpha: 1 }).webp().toBuffer();
  return { jpeg, png, webp };
}

function minimalMp4() {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  buffer.writeUInt32BE(0x200, 12);
  buffer.write('isom', 16, 'ascii');
  buffer.write('mp42', 20, 'ascii');
  buffer.writeUInt32BE(8, 24);
  buffer.write('mdat', 28, 'ascii');
  return buffer;
}

function minimalWebm() {
  return Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3,
    0x87,
    0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
    0x18, 0x53, 0x80, 0x67, 0x80
  ]);
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

test('magic-byte detection and full decode accept JPEG, transparent PNG and WebP', async () => {
  const { jpeg, png, webp } = await fixtures();
  assert.equal(detectMediaFormat(jpeg), 'jpeg');
  assert.equal(detectMediaFormat(png), 'png');
  assert.equal(detectMediaFormat(webp), 'webp');

  const jpegResult = await validateRasterMedia({ buffer: jpeg, filename: 'Фото с телефона.JPG', declaredMime: 'image/jpeg' });
  assert.equal(jpegResult.format, 'jpeg');
  assert.equal(jpegResult.extension, '.jpg');
  assert.deepEqual([jpegResult.width, jpegResult.height, jpegResult.pages], [4, 3, 1]);
  assert.equal(jpegResult.hasAlpha, false);

  const pngResult = await validateMediaUpload({ buffer: png, filename: 'прозрачный фон.png', declaredMime: 'image/png' });
  assert.equal(pngResult.format, 'png');
  assert.equal(pngResult.hasAlpha, true);

  const webpResult = await validateMediaUpload({ buffer: webp, filename: `${'длинное имя '.repeat(20)}.webp`, declaredMime: 'image/webp' });
  assert.equal(webpResult.format, 'webp');
  assert.equal(webpResult.width, 5);
  assert.match(webpResult.sha256, /^[a-f0-9]{64}$/u);
});

test('EXIF orientation is retained and display dimensions are correctly oriented', async () => {
  const rotated = await created(7, 3, { r: 10, g: 20, b: 30, alpha: 1 })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await validateRasterMedia({ buffer: rotated, filename: 'portrait.jpeg', declaredMime: 'image/jpeg' });
  assert.equal(result.orientation, 6);
  assert.deepEqual([result.storedWidth, result.storedHeight], [7, 3]);
  assert.deepEqual([result.width, result.height], [3, 7]);
});

test('extension and MIME must match decoded magic bytes', async () => {
  const { jpeg, png } = await fixtures();
  await rejectsCode(
    validateRasterMedia({ buffer: jpeg, filename: 'disguised.png', declaredMime: 'image/jpeg' }),
    'MEDIA_EXTENSION_MISMATCH'
  );
  await rejectsCode(
    validateRasterMedia({ buffer: png, filename: 'image.png', declaredMime: 'image/jpeg' }),
    'MEDIA_MIME_MISMATCH'
  );
  await rejectsCode(
    validateRasterMedia({ buffer: jpeg, filename: '../escape.jpg', declaredMime: 'image/jpeg' }),
    'FILENAME_UNSAFE'
  );
});

test('unsafe, unsupported, empty and corrupt media fail closed', async () => {
  await rejectsCode(
    validateMediaUpload({ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), filename: 'shape.svg', declaredMime: 'image/svg+xml' }),
    'SVG_FORBIDDEN'
  );
  await rejectsCode(
    validateMediaUpload({ buffer: Buffer.from('GIF89a', 'ascii'), filename: 'animated.gif', declaredMime: 'image/gif' }),
    'GIF_FORBIDDEN'
  );
  await rejectsCode(
    validateMediaUpload({ buffer: Buffer.from('%PDF-1.7', 'ascii'), filename: 'document.pdf', declaredMime: 'application/pdf' }),
    'PDF_FORBIDDEN'
  );
  await rejectsCode(
    validateMediaUpload({ buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]), filename: 'photo.jpg', declaredMime: 'image/jpeg' }),
    'EXECUTABLE_FORBIDDEN'
  );
  await rejectsCode(
    validateMediaUpload({ buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), filename: 'photo.jpg', declaredMime: 'image/jpeg' }),
    'ARCHIVE_FORBIDDEN'
  );
  const heif = Buffer.alloc(24);
  heif.writeUInt32BE(24, 0);
  heif.write('ftyp', 4, 'ascii');
  heif.write('heic', 8, 'ascii');
  await rejectsCode(
    validateMediaUpload({ buffer: heif, filename: 'phone.heic', declaredMime: 'image/heic' }),
    'HEIF_UNSUPPORTED'
  );
  await rejectsCode(
    validateMediaUpload({ buffer: Buffer.alloc(0), filename: 'empty.jpg', declaredMime: 'image/jpeg' }),
    'MEDIA_EMPTY'
  );
  await rejectsCode(
    validateRasterMedia({ buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]), filename: 'broken.jpg', declaredMime: 'image/jpeg' }),
    'RASTER_DECODE_FAILED'
  );
});

test('decoded pixel, edge, byte and frame limits are configurable and fail closed', async () => {
  const { png } = await fixtures();
  await rejectsCode(
    validateRasterMedia({ buffer: png, filename: 'small.png', declaredMime: 'image/png', limits: { maxPixels: 5 } }),
    'RASTER_PIXEL_LIMIT'
  );
  await rejectsCode(
    validateRasterMedia({ buffer: png, filename: 'small.png', declaredMime: 'image/png', limits: { maxEdge: 2 } }),
    'RASTER_EDGE_LIMIT'
  );
  await rejectsCode(
    validateRasterMedia({ buffer: png, filename: 'small.png', declaredMime: 'image/png', limits: { rasterMaxBytes: png.length - 1 } }),
    'RASTER_BYTES_LIMIT'
  );

  const frameOne = await created(2, 2, { r: 255, g: 0, b: 0, alpha: 1 }).png().toBuffer();
  const frameTwo = await created(2, 2, { r: 0, g: 0, b: 255, alpha: 1 }).png().toBuffer();
  const animatedWebp = await sharp([frameOne, frameTwo], { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  await rejectsCode(
    validateRasterMedia({ buffer: animatedWebp, filename: 'animated.webp', declaredMime: 'image/webp' }),
    'RASTER_FRAME_LIMIT'
  );
});

test('video policy accepts conservative MP4/WebM magic and rejects mismatches', async () => {
  const mp4 = minimalMp4();
  const webm = minimalWebm();
  assert.equal(detectMediaFormat(mp4), 'mp4');
  assert.equal(detectMediaFormat(webm), 'webm');
  assert.equal((await validateVideoMedia({ buffer: mp4, filename: 'hero.mp4', declaredMime: 'video/mp4' })).format, 'mp4');
  assert.equal((await validateMediaUpload({ buffer: webm, filename: 'hero.webm', declaredMime: 'video/webm' })).format, 'webm');
  await rejectsCode(
    validateVideoMedia({ buffer: minimalMp4().subarray(0, 24), filename: 'header-only.mp4', declaredMime: 'video/mp4' }),
    'VIDEO_CONTAINER_INVALID'
  );
  await rejectsCode(
    validateVideoMedia({ buffer: mp4, filename: 'hero.webm', declaredMime: 'video/mp4' }),
    'MEDIA_EXTENSION_MISMATCH'
  );
  await rejectsCode(
    validateVideoMedia({ buffer: webm, filename: 'hero.webm', declaredMime: 'video/mp4' }),
    'MEDIA_MIME_MISMATCH'
  );
  await rejectsCode(
    validateVideoMedia({ buffer: mp4, filename: 'hero.mp4', declaredMime: 'video/mp4', limits: { videoMaxBytes: mp4.length - 1 } }),
    'VIDEO_BYTES_LIMIT'
  );
});

test('canonical filenames depend only on bytes and decoded format', async () => {
  const { jpeg } = await fixtures();
  const first = await validateRasterMedia({ buffer: jpeg, filename: 'первое имя.jpg', declaredMime: 'image/jpeg' });
  const second = await validateRasterMedia({ buffer: jpeg, filename: 'another-name.jpeg', declaredMime: 'image/jpeg' });
  assert.equal(canonicalMediaFilename(first), canonicalMediaFilename(second));
  assert.equal(canonicalPublicMediaPath(first), `/uploads/${first.sha256}.jpg`);

  const changed = await created(4, 3, { r: 220, g: 20, b: 180, alpha: 1 }).jpeg().toBuffer();
  const third = await validateRasterMedia({ buffer: changed, filename: 'первое имя.jpg', declaredMime: 'image/jpeg' });
  assert.notEqual(canonicalMediaFilename(first), canonicalMediaFilename(third));
});

import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const MIB = 1024 * 1024;

export const DEFAULT_MEDIA_LIMITS = Object.freeze({
  rasterMaxBytes: 10 * MIB,
  videoMaxBytes: 90 * MIB,
  maxPixels: 50_000_000,
  maxEdge: 12_000,
  maxFrames: 1,
  maxFilenameBytes: 1024
});

export const MEDIA_FORMATS = Object.freeze({
  jpeg: Object.freeze({ kind: 'raster', extension: '.jpg', mime: 'image/jpeg', filenameExtensions: ['.jpg', '.jpeg'] }),
  png: Object.freeze({ kind: 'raster', extension: '.png', mime: 'image/png', filenameExtensions: ['.png'] }),
  webp: Object.freeze({ kind: 'raster', extension: '.webp', mime: 'image/webp', filenameExtensions: ['.webp'] }),
  mp4: Object.freeze({ kind: 'video', extension: '.mp4', mime: 'video/mp4', filenameExtensions: ['.mp4'] }),
  webm: Object.freeze({ kind: 'video', extension: '.webm', mime: 'video/webm', filenameExtensions: ['.webm'] })
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBM_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const WEBM_SEGMENT_SIGNATURE = Buffer.from([0x18, 0x53, 0x80, 0x67]);
const GIF87_SIGNATURE = Buffer.from('GIF87a', 'ascii');
const GIF89_SIGNATURE = Buffer.from('GIF89a', 'ascii');
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const ZIP_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08])
];
const ISO_VIDEO_BRANDS = new Set([
  '3gp4', '3gp5', '3gp6', '3ge6', '3gg6',
  'avc1', 'dash', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9',
  'isom', 'm4v ', 'mp41', 'mp42', 'msnv', 'qt  '
]);
const ISO_IMAGE_BRANDS = new Set(['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);
const UNSUPPORTED_CODES = Object.freeze({
  svg: ['SVG_FORBIDDEN', 'Новые SVG-файлы запрещены. Используйте JPEG, PNG или WebP.'],
  gif: ['GIF_FORBIDDEN', 'GIF не поддерживается. Сохраните изображение как JPEG, PNG или WebP.'],
  pdf: ['PDF_FORBIDDEN', 'PDF нельзя загрузить как медиафайл.'],
  heif: ['HEIF_UNSUPPORTED', 'HEIC/HEIF пока не поддерживается. Конвертируйте фото в JPEG.'],
  archive: ['ARCHIVE_FORBIDDEN', 'Архив нельзя загрузить как медиафайл.'],
  executable: ['EXECUTABLE_FORBIDDEN', 'Исполняемый файл нельзя загрузить как медиафайл.']
});

export class MediaValidationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'MediaValidationError';
    this.code = code;
    this.status = options.status ?? 400;
    if (options.details !== undefined) this.details = options.details;
  }
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new MediaValidationError('MEDIA_BYTES_REQUIRED', 'Ожидаются бинарные данные файла.');
}

function startsWith(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

function detectIsoFormat(buffer) {
  if (buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') return null;
  const boxSize = buffer.readUInt32BE(0);
  if (boxSize < 16 || boxSize > buffer.length) return 'invalid-iso';
  const brand = buffer.toString('ascii', 8, 12).toLowerCase();
  if (ISO_IMAGE_BRANDS.has(brand)) return 'heif';
  if (!ISO_VIDEO_BRANDS.has(brand)) return 'invalid-iso';
  let offset = 0;
  let mediaBoxFound = false;
  let boxCount = 0;
  while (offset + 8 <= buffer.length && boxCount < 100_000) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerBytes = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) return 'invalid-iso';
      const extended = buffer.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return 'invalid-iso';
      size = Number(extended);
      headerBytes = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < headerBytes || offset + size > buffer.length) return 'invalid-iso';
    if (type === 'moov' || type === 'mdat' || type === 'moof') mediaBoxFound = true;
    offset += size;
    boxCount += 1;
  }
  return offset === buffer.length && mediaBoxFound ? 'mp4' : 'invalid-iso';
}

function webmDocTypePresent(buffer) {
  const limit = Math.min(buffer.length, 4096);
  for (let index = 4; index + 4 <= limit; index += 1) {
    if (buffer[index] !== 0x42 || buffer[index + 1] !== 0x82) continue;
    const first = buffer[index + 2];
    let width = 1;
    let marker = 0x80;
    while (width <= 8 && (first & marker) === 0) {
      width += 1;
      marker >>= 1;
    }
    if (width > 4 || index + 2 + width > limit) continue;
    let length = first & (marker - 1);
    for (let part = 1; part < width; part += 1) length = (length * 256) + buffer[index + 2 + part];
    const valueStart = index + 2 + width;
    if (length !== 4 || valueStart + length > limit) continue;
    if (buffer.toString('ascii', valueStart, valueStart + length).toLowerCase() === 'webm') return true;
  }
  return false;
}

function looksLikeSvg(buffer) {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8')
    .replace(/^\uFEFF/u, '')
    .trimStart();
  return /^(?:<\?xml\b[^>]*>\s*)?(?:<!--[^]*?-->\s*)*<svg(?:\s|>)/iu.test(prefix);
}

export function detectMediaFormat(input) {
  const buffer = asBuffer(input);
  if (buffer.length === 0) return 'empty';
  if (startsWith(buffer, PNG_SIGNATURE)) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  const isoFormat = detectIsoFormat(buffer);
  if (isoFormat) return isoFormat;
  if (startsWith(buffer, WEBM_SIGNATURE)) {
    const segmentOffset = buffer.indexOf(WEBM_SEGMENT_SIGNATURE, 4);
    return segmentOffset !== -1 && segmentOffset < 4096 && webmDocTypePresent(buffer) ? 'webm' : 'invalid-ebml';
  }
  if (startsWith(buffer, GIF87_SIGNATURE) || startsWith(buffer, GIF89_SIGNATURE)) return 'gif';
  if (startsWith(buffer, PDF_SIGNATURE)) return 'pdf';
  if (ZIP_SIGNATURES.some((signature) => startsWith(buffer, signature))) return 'archive';
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return 'executable';
  if (looksLikeSvg(buffer)) return 'svg';
  return 'unknown';
}

export function normalizeDisplayFilename(value, limits = DEFAULT_MEDIA_LIMITS) {
  const filename = String(value ?? '').normalize('NFC').trim();
  if (!filename || filename === '.' || filename === '..') {
    throw new MediaValidationError('FILENAME_REQUIRED', 'У файла отсутствует имя.');
  }
  if (/[\u0000-\u001f\u007f/\\:]/u.test(filename) || path.isAbsolute(filename)) {
    throw new MediaValidationError('FILENAME_UNSAFE', 'Имя файла содержит небезопасный путь или служебные символы.');
  }
  if (Buffer.byteLength(filename, 'utf8') > limits.maxFilenameBytes) {
    throw new MediaValidationError('FILENAME_TOO_LONG', 'Имя файла слишком длинное.', { status: 413 });
  }
  return filename;
}

function normalizedLimits(overrides = {}) {
  const limits = { ...DEFAULT_MEDIA_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new MediaValidationError('MEDIA_LIMIT_INVALID', `Некорректный лимит ${name}.`);
    }
  }
  return Object.freeze(limits);
}

function validateDeclaredType({ format, filename, declaredMime, limits }) {
  const descriptor = MEDIA_FORMATS[format];
  const safeFilename = normalizeDisplayFilename(filename, limits);
  const extension = path.extname(safeFilename).toLowerCase();
  if (!descriptor.filenameExtensions.includes(extension)) {
    throw new MediaValidationError(
      'MEDIA_EXTENSION_MISMATCH',
      `Расширение «${extension || 'без расширения'}» не соответствует содержимому ${format.toUpperCase()}.`,
      { details: { detectedFormat: format, extension } }
    );
  }
  const normalizedMime = String(declaredMime ?? '').trim().toLowerCase();
  if (normalizedMime && normalizedMime !== descriptor.mime) {
    throw new MediaValidationError(
      'MEDIA_MIME_MISMATCH',
      `Заявленный MIME «${normalizedMime}» не соответствует содержимому ${descriptor.mime}.`,
      { details: { detectedFormat: format, declaredMime: normalizedMime } }
    );
  }
  return { descriptor, safeFilename, declaredMime: normalizedMime || null };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function rejectUnsupported(format) {
  const definition = UNSUPPORTED_CODES[format];
  if (definition) throw new MediaValidationError(definition[0], definition[1]);
  if (format === 'empty') throw new MediaValidationError('MEDIA_EMPTY', 'Пустой файл нельзя загрузить.');
  if (format === 'invalid-iso' || format === 'invalid-ebml') {
    throw new MediaValidationError('VIDEO_CONTAINER_INVALID', 'Видео-контейнер повреждён или не поддерживается.');
  }
  throw new MediaValidationError('MEDIA_FORMAT_UNSUPPORTED', 'Формат файла не распознан или не поддерживается.');
}

function decodeError(error) {
  if (error instanceof MediaValidationError) return error;
  const message = String(error?.message ?? '');
  if (/pixel limit|exceeds.*pixels/iu.test(message)) {
    return new MediaValidationError('RASTER_PIXEL_LIMIT', 'Изображение превышает безопасный лимит пикселей.', {
      status: 413,
      cause: error
    });
  }
  return new MediaValidationError('RASTER_DECODE_FAILED', 'Изображение повреждено или не декодируется полностью.', {
    cause: error
  });
}

export async function validateRasterMedia(options = {}) {
  const buffer = asBuffer(options.buffer);
  const limits = normalizedLimits(options.limits);
  if (!buffer.length) rejectUnsupported('empty');
  if (buffer.length > limits.rasterMaxBytes) {
    throw new MediaValidationError('RASTER_BYTES_LIMIT', 'Фотография превышает допустимый размер 10 МБ. Уменьшите файл и повторите.', {
      status: 413,
      details: { bytes: buffer.length, maxBytes: limits.rasterMaxBytes }
    });
  }
  const format = detectMediaFormat(buffer);
  if (!MEDIA_FORMATS[format] || MEDIA_FORMATS[format].kind !== 'raster') rejectUnsupported(format);
  const declared = validateDeclaredType({
    format,
    filename: options.filename,
    declaredMime: options.declaredMime,
    limits
  });

  let metadata;
  try {
    metadata = await sharp(buffer, {
      animated: true,
      failOn: 'error',
      limitInputPixels: limits.maxPixels,
      sequentialRead: true
    }).metadata();
  } catch (error) {
    throw decodeError(error);
  }
  if (metadata.format !== format) {
    throw new MediaValidationError('RASTER_FORMAT_MISMATCH', 'Magic bytes и декодированный формат не совпадают.');
  }
  const storedWidth = Number(metadata.width);
  const pageHeight = Number(metadata.pageHeight || metadata.height);
  const pages = Number(metadata.pages || 1);
  const storedHeight = pageHeight;
  if (!Number.isSafeInteger(storedWidth) || !Number.isSafeInteger(storedHeight) || storedWidth <= 0 || storedHeight <= 0) {
    throw new MediaValidationError('RASTER_DIMENSIONS_INVALID', 'Не удалось определить безопасные размеры изображения.');
  }
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > limits.maxFrames) {
    throw new MediaValidationError('RASTER_FRAME_LIMIT', 'Анимированные или многостраничные изображения не поддерживаются.', {
      details: { pages, maxFrames: limits.maxFrames }
    });
  }
  const pixels = storedWidth * storedHeight * pages;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
    throw new MediaValidationError('RASTER_PIXEL_LIMIT', 'Изображение превышает безопасный лимит пикселей.', {
      status: 413,
      details: { pixels, maxPixels: limits.maxPixels }
    });
  }
  if (storedWidth > limits.maxEdge || storedHeight > limits.maxEdge) {
    throw new MediaValidationError('RASTER_EDGE_LIMIT', 'Одна из сторон изображения превышает безопасный лимит.', {
      status: 413,
      details: { width: storedWidth, height: storedHeight, maxEdge: limits.maxEdge }
    });
  }

  try {
    await sharp(buffer, {
      animated: false,
      failOn: 'error',
      limitInputPixels: limits.maxPixels,
      sequentialRead: true
    }).stats();
  } catch (error) {
    throw decodeError(error);
  }

  const orientation = Number.isSafeInteger(metadata.orientation) ? metadata.orientation : null;
  const swapsAxes = orientation !== null && orientation >= 5 && orientation <= 8;
  return Object.freeze({
    kind: 'raster',
    format,
    extension: declared.descriptor.extension,
    mime: declared.descriptor.mime,
    declaredMime: declared.declaredMime,
    originalFilename: declared.safeFilename,
    bytes: buffer.length,
    sha256: sha256(buffer),
    width: swapsAxes ? storedHeight : storedWidth,
    height: swapsAxes ? storedWidth : storedHeight,
    storedWidth,
    storedHeight,
    pixels,
    pages,
    orientation,
    hasAlpha: metadata.hasAlpha === true,
    channels: Number(metadata.channels || 0) || null,
    colourspace: metadata.space || null
  });
}

export async function validateVideoMedia(options = {}) {
  const buffer = asBuffer(options.buffer);
  const limits = normalizedLimits(options.limits);
  if (!buffer.length) rejectUnsupported('empty');
  if (buffer.length > limits.videoMaxBytes) {
    throw new MediaValidationError('VIDEO_BYTES_LIMIT', 'Видео превышает допустимый размер 90 МБ.', {
      status: 413,
      details: { bytes: buffer.length, maxBytes: limits.videoMaxBytes }
    });
  }
  const format = detectMediaFormat(buffer);
  if (!MEDIA_FORMATS[format] || MEDIA_FORMATS[format].kind !== 'video') rejectUnsupported(format);
  const declared = validateDeclaredType({
    format,
    filename: options.filename,
    declaredMime: options.declaredMime,
    limits
  });
  return Object.freeze({
    kind: 'video',
    format,
    extension: declared.descriptor.extension,
    mime: declared.descriptor.mime,
    declaredMime: declared.declaredMime,
    originalFilename: declared.safeFilename,
    bytes: buffer.length,
    sha256: sha256(buffer),
    width: null,
    height: null,
    pixels: null,
    pages: null,
    orientation: null,
    hasAlpha: false
  });
}

export async function validateMediaUpload(options = {}) {
  const format = detectMediaFormat(options.buffer);
  if (MEDIA_FORMATS[format]?.kind === 'raster') return validateRasterMedia(options);
  if (MEDIA_FORMATS[format]?.kind === 'video') return validateVideoMedia(options);
  rejectUnsupported(format);
}

export function canonicalMediaFilename(validated) {
  const digest = String(validated?.sha256 ?? '').toLowerCase();
  const extension = String(validated?.extension ?? '').toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(digest) || !new Set(Object.values(MEDIA_FORMATS).map((item) => item.extension)).has(extension)) {
    throw new MediaValidationError('CANONICAL_MEDIA_ID_INVALID', 'Некорректные данные canonical media.');
  }
  return `${digest}${extension}`;
}

export function canonicalPublicMediaPath(validated) {
  return `/uploads/${canonicalMediaFilename(validated)}`;
}

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_PROJECT_MEDIA_FILES = 10;
export const MAX_PROJECT_MEDIA_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_PROJECT_MEDIA_REQUEST_SIZE = 50 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);

export function parseMultipartFiles(buffer, contentType, acceptedNames = new Set(['files', 'file'])) {
  const boundaryMatch = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('Некорректный multipart/form-data');
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const delimiter = Buffer.from(`--${boundary}`);
  const files = [];
  let start = buffer.indexOf(delimiter);
  while (start !== -1) {
    const next = buffer.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const partStart = start + delimiter.length + 2;
    const partEnd = next >= 2 ? next - 2 : next;
    const part = buffer.slice(partStart, partEnd);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      const name = headers.match(/name="([^"]+)"/i)?.[1] || '';
      const filename = headers.match(/filename="([^"]*)"/i)?.[1] || '';
      if (acceptedNames.has(name) && filename) files.push({ fieldName: name, filename, fileBuffer: part.slice(headerEnd + 4) });
    }
    start = next;
  }
  if (!files.length) throw new Error('Файлы не найдены в multipart-запросе');
  return files;
}

export function projectMediaFilename(filename, fileBuffer) {
  let ext = path.extname(String(filename || '')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error('Разрешены только jpg, jpeg, png, webp и svg');
  if (ext === '.jpeg') ext = '.jpg';
  const digest = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 24);
  return `project-${digest}${ext}`;
}

export async function saveProjectMediaFiles(parts, { uploadsDir, fileSystem = fs } = {}) {
  if (!uploadsDir) throw new Error('Не задана директория uploads');
  if (parts.length > MAX_PROJECT_MEDIA_FILES) throw new Error(`За один запрос можно загрузить не более ${MAX_PROJECT_MEDIA_FILES} файлов.`);
  await fileSystem.mkdir(uploadsDir, { recursive: true });
  const files = [];
  const errors = [];
  for (const part of parts) {
    try {
      if (!part.fileBuffer?.length) throw new Error('пустой файл');
      if (part.fileBuffer.length > MAX_PROJECT_MEDIA_FILE_SIZE) throw new Error('файл превышает 10 МБ');
      const safeName = projectMediaFilename(part.filename, part.fileBuffer);
      const filePath = path.join(uploadsDir, safeName);
      let reused = false;
      try { await fileSystem.access(filePath); reused = true; }
      catch { await fileSystem.writeFile(filePath, part.fileBuffer); }
      files.push({ name: part.filename, path: `/uploads/${safeName}`, reused });
    } catch (error) {
      errors.push({ name: part.filename || 'unknown', error: error.message || 'ошибка загрузки' });
    }
  }
  return { files, errors };
}

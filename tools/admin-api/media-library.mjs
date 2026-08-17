import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MEDIA_PATH_RE = /^\/(?:assets|uploads)\/[A-Za-z0-9_./%+()@-]+$/u;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.mp4', '.webm']);
const MAX_PAGE_SIZE = 50;

export class MediaLibraryError extends Error {
  constructor(code, message, { status = 400, details } = {}) {
    super(message);
    this.name = 'MediaLibraryError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizedMediaPath(value) {
  const raw = String(value || '').split(/[?#]/u)[0];
  if (!MEDIA_PATH_RE.test(raw) || raw.includes('/_media/h5/') || raw.includes('/../')) return null;
  const normalized = path.posix.normalize(raw);
  return normalized === raw ? normalized : null;
}

function decodeSafe(value) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

async function jsonFiles(directory) {
  const result = [];
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return result; throw error; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new MediaLibraryError('MEDIA_LIBRARY_SYMLINK', 'Symlink в content index запрещён.');
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await jsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(full);
  }
  return result;
}

function collectReferences(value, owner, fieldPath, result) {
  if (typeof value === 'string') {
    const mediaPath = normalizedMediaPath(value);
    if (mediaPath) {
      if (!result.has(mediaPath)) result.set(mediaPath, []);
      result.get(mediaPath).push({ ...owner, fieldPath });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferences(item, owner, `${fieldPath}[${index}]`, result));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    collectReferences(child, owner, fieldPath ? `${fieldPath}.${key}` : key, result);
  }
}

function safePositiveInteger(value, fallback, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new MediaLibraryError('MEDIA_LIBRARY_PAGE_INVALID', 'Некорректный номер страницы или размер выдачи.');
  }
  return parsed;
}

async function metadataFor(bytes, extension) {
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) return { width: null, height: null, format: extension.slice(1) };
  try {
    const metadata = await sharp(bytes, { animated: false, failOn: 'error' }).metadata();
    return { width: metadata.autoOrient?.width ?? metadata.width ?? null, height: metadata.autoOrient?.height ?? metadata.height ?? null, format: metadata.format || extension.slice(1) };
  } catch {
    return { width: null, height: null, format: extension.slice(1), unreadable: true };
  }
}

export function createMediaLibraryService({ repoRoot = process.cwd() } = {}) {
  const root = path.resolve(repoRoot);
  const publicRoot = path.join(root, 'public');
  const contentRoot = path.join(root, 'src', 'content');
  const dataFiles = [path.join(root, 'src', 'data', 'navigation.json'), path.join(root, 'src', 'data', 'yandex.json')];

  async function referenceIndex() {
    const references = new Map();
    for (const filePath of [...await jsonFiles(contentRoot), ...dataFiles]) {
      let raw;
      try { raw = await fs.readFile(filePath, 'utf8'); }
      catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
      let value;
      try { value = JSON.parse(raw); }
      catch { continue; }
      const relative = path.relative(contentRoot, filePath).split(path.sep).join('/');
      const parts = relative.split('/');
      const owner = filePath.startsWith(contentRoot)
        ? { collection: parts.length > 1 ? parts[0] : 'content', slug: path.posix.basename(relative, '.json') }
        : { singleton: path.basename(filePath, '.json') };
      collectReferences(value, owner, '', references);
    }
    for (const list of references.values()) list.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return references;
  }

  async function uploadPaths() {
    const directory = path.join(publicRoot, 'uploads');
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    const result = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new MediaLibraryError('MEDIA_LIBRARY_SYMLINK', 'Symlink в uploads запрещён.');
      const extension = path.extname(entry.name).toLowerCase();
      if (entry.isFile() && ALLOWED_EXTENSIONS.has(extension)) result.push(`/uploads/${entry.name}`);
    }
    return result;
  }

  async function list(input = {}) {
    const page = safePositiveInteger(input.page, 1, 1_000_000);
    const pageSize = safePositiveInteger(input.pageSize, 24, MAX_PAGE_SIZE);
    const search = String(input.search || '').trim().toLocaleLowerCase('ru-RU').slice(0, 200);
    const usage = ['all', 'used', 'unreferenced'].includes(input.usage) ? input.usage : 'all';
    const references = await referenceIndex();
    const candidates = new Set([...references.keys(), ...await uploadPaths()]);
    let paths = [...candidates].filter((mediaPath) => {
      if (search && !decodeSafe(mediaPath).toLocaleLowerCase('ru-RU').includes(search)) return false;
      const used = (references.get(mediaPath)?.length || 0) > 0;
      return usage === 'all' || (usage === 'used' ? used : !used);
    });
    const stats = new Map();
    for (const mediaPath of paths) {
      const filePath = path.join(publicRoot, ...mediaPath.split('/').filter(Boolean));
      if (!inside(publicRoot, filePath)) continue;
      try {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        stats.set(mediaPath, { filePath, stat });
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    paths = paths.filter((mediaPath) => stats.has(mediaPath)).sort((left, right) => {
      const time = stats.get(right).stat.mtimeMs - stats.get(left).stat.mtimeMs;
      return time || left.localeCompare(right, 'ru');
    });
    const total = paths.length;
    const selected = paths.slice((page - 1) * pageSize, page * pageSize);
    const items = [];
    for (const mediaPath of selected) {
      const { filePath, stat } = stats.get(mediaPath);
      const extension = path.extname(mediaPath).toLowerCase();
      const bytes = await fs.readFile(filePath);
      const metadata = await metadataFor(bytes, extension);
      items.push({
        path: mediaPath,
        filename: decodeSafe(path.posix.basename(mediaPath)),
        extension,
        bytes: stat.size,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        modifiedAt: new Date(stat.mtimeMs).toISOString(),
        ...metadata,
        usageCount: references.get(mediaPath)?.length || 0,
        references: references.get(mediaPath) || []
      });
    }
    return Object.freeze({ page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)), items });
  }

  return Object.freeze({ list });
}

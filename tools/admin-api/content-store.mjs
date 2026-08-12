import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const CONTENT_SCHEMA_VERSION = 'h6-content-v1';
export const MISSING_REVISION = 'missing';

const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ContentStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ContentStoreError';
    this.code = code;
    this.status = options.status ?? 500;
    this.collection = options.collection ?? null;
    this.slug = options.slug ?? null;
    this.current = options.current ?? null;
  }
}

export function revisionForBytes(bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? '');
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}:${value.length}`;
}

export function serializeContent(content) {
  return Buffer.from(`${JSON.stringify(content, null, 2)}\n`, 'utf8');
}

function normalizeSlug(value) {
  const slug = String(value ?? '').trim().toLowerCase();
  if (!SAFE_SLUG_RE.test(slug)) {
    throw new ContentStoreError(
      'INVALID_SLUG',
      'Некорректный slug. Разрешены латинские буквы, цифры и дефисы.',
      { status: 400, slug }
    );
  }
  return slug;
}

function resolveConfiguredPath(repoRoot, configuredPath) {
  if (typeof configuredPath !== 'string' || configuredPath.length === 0) {
    throw new ContentStoreError('INVALID_REGISTRY', 'Для записи не настроен путь к файлу.', { status: 500 });
  }
  return path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(repoRoot, configuredPath);
}

function resolveEntry({ repoRoot, collections, singletons }, collection, slugValue) {
  const collectionConfig = collections?.[collection];
  const singletonConfig = singletons?.[collection];
  const config = collectionConfig ?? singletonConfig;
  if (!config) {
    throw new ContentStoreError('UNKNOWN_COLLECTION', 'Коллекция не разрешена.', {
      status: 404,
      collection,
      slug: slugValue ?? null
    });
  }

  const isSingleFile = Boolean(singletonConfig) || config.type === 'single-file';
  if (isSingleFile) {
    const slug = normalizeSlug(slugValue ?? config.slug ?? collection);
    const expectedSlug = normalizeSlug(config.slug ?? collection);
    if (slug !== expectedSlug) {
      throw new ContentStoreError('RECORD_NOT_FOUND', 'Запись не найдена.', {
        status: 404,
        collection,
        slug
      });
    }
    return {
      collection,
      slug,
      filePath: resolveConfiguredPath(repoRoot, config.path),
      config,
      isSingleFile: true
    };
  }

  if (config.type && config.type !== 'directory') {
    throw new ContentStoreError('INVALID_REGISTRY', 'Неизвестный тип коллекции.', {
      status: 500,
      collection,
      slug: slugValue ?? null
    });
  }

  const slug = normalizeSlug(slugValue);
  const directory = resolveConfiguredPath(repoRoot, config.path);
  const filePath = path.resolve(directory, `${slug}.json`);
  if (path.dirname(filePath) !== directory) {
    throw new ContentStoreError('INVALID_PATH', 'Путь записи выходит за пределы коллекции.', {
      status: 400,
      collection,
      slug
    });
  }
  return { collection, slug, filePath, config, isSingleFile: false };
}

async function readSnapshot(entry, fileSystem) {
  let bytes;
  let stat;
  try {
    [bytes, stat] = await Promise.all([
      fileSystem.readFile(entry.filePath),
      fileSystem.stat(entry.filePath)
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new ContentStoreError('READ_FAILED', 'Не удалось прочитать запись.', {
      status: 500,
      collection: entry.collection,
      slug: entry.slug,
      cause: error
    });
  }

  let content;
  try {
    content = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new ContentStoreError('INVALID_JSON_ON_DISK', 'JSON-файл записи повреждён.', {
      status: 500,
      collection: entry.collection,
      slug: entry.slug,
      cause: error
    });
  }

  return {
    content,
    bytes,
    revision: revisionForBytes(bytes),
    lastModified: stat?.mtime instanceof Date ? stat.mtime.toISOString() : null
  };
}

function formatJsonPath(parts) {
  return parts.reduce(
    (result, part) => typeof part === 'number'
      ? `${result}[${part}]`
      : result
        ? `${result}.${part}`
        : String(part),
    ''
  );
}

export function diffContentPaths(before, after) {
  const changed = [];
  const visit = (left, right, parts = []) => {
    if (isDeepStrictEqual(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        if (index >= left.length || index >= right.length) changed.push(formatJsonPath([...parts, index]));
        else visit(left[index], right[index], [...parts, index]);
      }
      return;
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) {
        if (!(key in left) || !(key in right)) changed.push(formatJsonPath([...parts, key]));
        else visit(left[key], right[key], [...parts, key]);
      }
      return;
    }
    changed.push(formatJsonPath(parts) || '(root)');
  };
  visit(before, after);
  return [...new Set(changed)].sort();
}

async function durableReplace(fileSystem, filePath, bytes) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let handle;
  try {
    await fileSystem.mkdir(directory, { recursive: true });
    handle = await fileSystem.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(bytes);
    if (typeof handle.sync === 'function') await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fileSystem.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function conflict(entry, current) {
  return new ContentStoreError(
    'REVISION_CONFLICT',
    'Запись изменилась после открытия. Локальный черновик сохранён; сравните версии перед повторным сохранением.',
    {
      status: 409,
      collection: entry.collection,
      slug: entry.slug,
      current: current
        ? {
            content: current.content,
            revision: current.revision,
            schemaVersion: CONTENT_SCHEMA_VERSION,
            lastModified: current.lastModified
          }
        : { content: null, revision: MISSING_REVISION, schemaVersion: CONTENT_SCHEMA_VERSION }
    }
  );
}

export function createContentStore({
  repoRoot = process.cwd(),
  collections = {},
  singletons = {},
  fileSystem = fs,
  schemaVersion = CONTENT_SCHEMA_VERSION
} = {}) {
  const registry = { repoRoot: path.resolve(repoRoot), collections, singletons };

  return {
    async read(collection, slug) {
      const entry = resolveEntry(registry, collection, slug);
      const snapshot = await readSnapshot(entry, fileSystem);
      if (!snapshot) {
        throw new ContentStoreError('RECORD_NOT_FOUND', 'Запись не найдена.', {
          status: 404,
          collection: entry.collection,
          slug: entry.slug
        });
      }
      return {
        content: snapshot.content,
        revision: snapshot.revision,
        schemaVersion,
        lastModified: snapshot.lastModified
      };
    },

    async save({ collection, slug, content, baseRevision, create = false } = {}) {
      const entry = resolveEntry(registry, collection, slug);
      const initial = await readSnapshot(entry, fileSystem);

      if (create) {
        if (initial || (baseRevision != null && baseRevision !== MISSING_REVISION)) {
          throw conflict(entry, initial);
        }
      } else {
        if (!initial) {
          throw new ContentStoreError('RECORD_NOT_FOUND', 'Запись не найдена.', {
            status: 404,
            collection: entry.collection,
            slug: entry.slug
          });
        }
        if (typeof baseRevision !== 'string' || baseRevision !== initial.revision) {
          throw conflict(entry, initial);
        }
      }

      if (initial && isDeepStrictEqual(initial.content, content)) {
        return {
          result: 'noop',
          content: initial.content,
          revision: initial.revision,
          schemaVersion,
          lastModified: initial.lastModified,
          changedPaths: []
        };
      }

      const bytes = serializeContent(content);
      const latest = await readSnapshot(entry, fileSystem);
      const expectedRevision = initial?.revision ?? MISSING_REVISION;
      const latestRevision = latest?.revision ?? MISSING_REVISION;
      if (latestRevision !== expectedRevision) throw conflict(entry, latest);

      try {
        await durableReplace(fileSystem, entry.filePath, bytes);
      } catch (error) {
        throw new ContentStoreError('WRITE_FAILED', 'Не удалось безопасно сохранить запись.', {
          status: 500,
          collection: entry.collection,
          slug: entry.slug,
          cause: error
        });
      }

      const saved = await readSnapshot(entry, fileSystem);
      return {
        result: 'saved',
        content: saved.content,
        revision: saved.revision,
        previousRevision: initial?.revision ?? MISSING_REVISION,
        schemaVersion,
        lastModified: saved.lastModified,
        changedPaths: diffContentPaths(initial?.content ?? null, saved.content)
      };
    }
  };
}

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export const DIRECTORY_COLLECTIONS = Object.freeze([
  'product-sections',
  'product-categories',
  'products',
  'services',
  'projects',
  'jobs',
  'static-pages'
]);

export const COLLECTION_NAMES = Object.freeze([
  ...DIRECTORY_COLLECTIONS,
  'site-settings'
]);

const EDITABLE_SINGLETON_PATHS = Object.freeze([
  'src/data/navigation.json',
  'src/data/yandex.json'
]);

const MEDIA_ROOTS = Object.freeze([
  'public/assets',
  'public/uploads'
]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function contentStoreConfig(repoRoot) {
  const contentRoot = path.join(repoRoot, 'src', 'content');
  const collections = Object.fromEntries(DIRECTORY_COLLECTIONS.map((collection) => [
    collection,
    { type: 'directory', path: path.join(contentRoot, collection) }
  ]));
  collections['site-settings'] = {
    type: 'single-file',
    path: path.join(contentRoot, 'site-settings', 'global.json'),
    slug: 'global'
  };

  return {
    repoRoot,
    collections,
    singletons: {
      navigation: { path: path.join(repoRoot, 'src', 'data', 'navigation.json') },
      yandex: { path: path.join(repoRoot, 'src', 'data', 'yandex.json') }
    }
  };
}

async function walkFiles(rootPath) {
  const files = [];
  const pending = [rootPath];

  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

export async function listCorpusRecords(repoRoot = REPO_ROOT) {
  const { collections } = contentStoreConfig(repoRoot);
  const records = [];

  for (const collection of COLLECTION_NAMES) {
    const config = collections[collection];
    if (config.type === 'single-file') {
      records.push({
        collection,
        slug: config.slug,
        filePath: config.path,
        relativePath: toPosix(path.relative(repoRoot, config.path))
      });
      continue;
    }

    const entries = (await fs.readdir(config.path, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const filePath = path.join(config.path, entry.name);
      records.push({
        collection,
        slug: path.basename(entry.name, '.json'),
        filePath,
        relativePath: toPosix(path.relative(repoRoot, filePath))
      });
    }
  }

  return records;
}

export async function readFileFingerprint(filePath, repoRoot = REPO_ROOT, { retainRaw = true } = {}) {
  const [bytes, stats] = await Promise.all([
    fs.readFile(filePath),
    fs.stat(filePath, { bigint: true })
  ]);

  return {
    path: toPosix(path.relative(repoRoot, filePath)),
    bytes: Number(stats.size),
    sha256: sha256(bytes),
    mtimeNs: stats.mtimeNs.toString(),
    ...(retainRaw ? { raw: bytes } : {})
  };
}

export async function snapshotFiles(filePaths, repoRoot = REPO_ROOT, { retainRaw = true } = {}) {
  // Keep this sequential: the complete preservation corpus includes large source
  // media and must not place every file buffer in memory at the same time.
  const entries = [];
  for (const filePath of filePaths) {
    entries.push(await readFileFingerprint(filePath, repoRoot, { retainRaw }));
  }
  return new Map(entries
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
    .map((entry) => [entry.path, entry]));
}

export async function snapshotRecordCorpus(repoRoot = REPO_ROOT) {
  const records = await listCorpusRecords(repoRoot);
  const singletonPaths = EDITABLE_SINGLETON_PATHS.map((relativePath) => path.join(repoRoot, relativePath));
  return snapshotFiles([...records.map((record) => record.filePath), ...singletonPaths], repoRoot);
}

export async function snapshotFullPreservationCorpus(repoRoot = REPO_ROOT) {
  const recordSnapshotPaths = [...(await listCorpusRecords(repoRoot)).map((record) => record.filePath)];
  const singletonPaths = EDITABLE_SINGLETON_PATHS.map((relativePath) => path.join(repoRoot, relativePath));
  const mediaPaths = (await Promise.all(MEDIA_ROOTS.map((relativePath) => walkFiles(path.join(repoRoot, relativePath))))).flat();
  return snapshotFiles([...recordSnapshotPaths, ...singletonPaths, ...mediaPaths], repoRoot, { retainRaw: false });
}

export function assertFingerprintEqual(before, after, message = before.path) {
  assert.equal(after.path, before.path, `${message}: path changed`);
  assert.equal(after.bytes, before.bytes, `${message}: byte length changed`);
  assert.equal(after.sha256, before.sha256, `${message}: SHA-256 changed`);
  assert.equal(after.mtimeNs, before.mtimeNs, `${message}: mtime changed`);
  if (before.raw !== undefined || after.raw !== undefined) {
    assert.deepEqual(after.raw, before.raw, `${message}: exact bytes changed`);
  }
}

export function assertSnapshotEqual(before, after, message = 'preservation corpus') {
  assert.deepEqual([...after.keys()], [...before.keys()], `${message}: file inventory changed`);
  for (const [relativePath, beforeEntry] of before) {
    assertFingerprintEqual(beforeEntry, after.get(relativePath), `${message}: ${relativePath}`);
  }
}

export async function createCorpusFixture(t, { includeMedia = false } = {}) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-content-store-'));
  const sourceRecords = await listCorpusRecords(REPO_ROOT);
  const sourcePaths = [
    ...sourceRecords.map((record) => record.filePath),
    ...EDITABLE_SINGLETON_PATHS.map((relativePath) => path.join(REPO_ROOT, relativePath))
  ];

  if (includeMedia) {
    const mediaPaths = (await Promise.all(MEDIA_ROOTS.map((relativePath) => walkFiles(path.join(REPO_ROOT, relativePath))))).flat();
    sourcePaths.push(...mediaPaths);
  } else {
    await fs.mkdir(path.join(repoRoot, 'public'), { recursive: true });
  }

  for (const sourcePath of sourcePaths) {
    const destinationPath = path.join(repoRoot, path.relative(REPO_ROOT, sourcePath));
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }

  t?.after(() => fs.rm(repoRoot, { recursive: true, force: true }));

  const config = contentStoreConfig(repoRoot);
  return {
    ...config,
    recordPath(collection, slug) {
      const collectionConfig = config.collections[collection];
      assert.ok(collectionConfig, `Unknown fixture collection: ${collection}`);
      return collectionConfig.type === 'single-file'
        ? collectionConfig.path
        : path.join(collectionConfig.path, `${slug}.json`);
    },
    async readJson(collection, slug) {
      return JSON.parse(await fs.readFile(this.recordPath(collection, slug), 'utf8'));
    },
    async writeJson(collection, slug, value) {
      await fs.writeFile(this.recordPath(collection, slug), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    },
    fingerprint(collection, slug) {
      return readFileFingerprint(this.recordPath(collection, slug), repoRoot);
    },
    snapshot() {
      return snapshotRecordCorpus(repoRoot);
    },
    cleanup() {
      return fs.rm(repoRoot, { recursive: true, force: true });
    }
  };
}

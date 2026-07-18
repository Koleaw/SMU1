#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const mediaRoots = [
  path.join(repositoryRoot, 'public', 'assets'),
  path.join(repositoryRoot, 'public', 'uploads'),
];
const defaultManifest = path.join(
  repositoryRoot,
  'docs',
  'migration',
  'v2-production-media-audit.csv',
);
const header = [
  'path',
  'size_before',
  'sha256_before',
  'size_after',
  'sha256_after',
  'status',
];

function usage() {
  console.error(
    'Usage: node tools/migration/media-audit.mjs <baseline|verify> [--manifest <path>] [--force]',
  );
}

function parseArguments(argv) {
  const mode = argv[2];
  let manifest = defaultManifest;
  let force = false;

  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') {
      const value = argv[index + 1];
      if (!value) throw new Error('--manifest requires a path');
      manifest = path.resolve(repositoryRoot, value);
      index += 1;
    } else if (argument === '--force') {
      force = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { mode, manifest, force };
}

function toRepositoryPath(absolutePath) {
  return path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function walk(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to follow media symlink: ${toRepositoryPath(absolutePath)}`);
    }
    if (entry.isDirectory()) {
      await walk(absolutePath, files);
      continue;
    }
    if (!entry.isFile()) continue;

    const metadata = await stat(absolutePath);
    files.push({
      path: toRepositoryPath(absolutePath),
      size: metadata.size,
      sha256: await hashFile(absolutePath),
    });
  }
}

async function scanMedia() {
  const files = [];
  for (const root of mediaRoots) {
    await walk(root, files);
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return files;
}

function escapeCsv(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serialiseCsv(rows) {
  return [header, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n') + '\n';
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value !== ''));
}

async function writeManifest(manifestPath, rows) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, serialiseCsv(rows), 'utf8');
    await rename(temporaryPath, manifestPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function manifestExists(manifestPath) {
  try {
    await stat(manifestPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assertUnique(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.path)) throw new Error(`Duplicate ${label} path: ${item.path}`);
    seen.add(item.path);
  }
}

async function createBaseline(manifestPath, force) {
  if (!force && (await manifestExists(manifestPath))) {
    throw new Error(`Baseline already exists: ${toRepositoryPath(manifestPath)} (use --force to replace it)`);
  }

  const current = await scanMedia();
  assertUnique(current, 'media');
  const rows = current.map((file) => [
    file.path,
    file.size,
    file.sha256,
    '',
    '',
    'baseline',
  ]);
  await writeManifest(manifestPath, rows);
  const totalBytes = current.reduce((sum, file) => sum + file.size, 0);
  console.log(`baseline files=${current.length} bytes=${totalBytes}`);
  console.log(`manifest=${toRepositoryPath(manifestPath)}`);
}

async function readBaseline(manifestPath) {
  const csv = parseCsv(await readFile(manifestPath, 'utf8'));
  const [actualHeader, ...dataRows] = csv;
  if (!actualHeader || header.some((column, index) => actualHeader[index] !== column)) {
    throw new Error(`Unexpected manifest header in ${toRepositoryPath(manifestPath)}`);
  }

  const baseline = dataRows
    .filter((row) => row[0] && row[1] && row[2])
    .map((row) => ({
      path: row[0],
      size: Number(row[1]),
      sha256: row[2],
    }));

  for (const file of baseline) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`Invalid baseline size for ${file.path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`Invalid baseline SHA-256 for ${file.path}`);
    }
  }
  assertUnique(baseline, 'baseline');
  return baseline;
}

function fingerprint(file) {
  return `${file.size}:${file.sha256}`;
}

async function verifyBaseline(manifestPath) {
  const baseline = await readBaseline(manifestPath);
  const current = await scanMedia();
  assertUnique(current, 'media');

  const baselineByPath = new Map(baseline.map((file) => [file.path, file]));
  const currentByPath = new Map(current.map((file) => [file.path, file]));
  const extras = current.filter((file) => !baselineByPath.has(file.path));
  const extrasByFingerprint = new Map();
  for (const file of extras) {
    const key = fingerprint(file);
    const group = extrasByFingerprint.get(key) ?? [];
    group.push(file);
    extrasByFingerprint.set(key, group);
  }

  const claimedRenameTargets = new Set();
  const statuses = {
    unchanged: 0,
    removed: 0,
    renamed: 0,
    overwritten: 0,
    unexpectedCopied: 0,
    unexpectedAdded: 0,
  };
  const rows = [];

  for (const before of baseline) {
    const after = currentByPath.get(before.path);
    if (after) {
      const unchanged = before.size === after.size && before.sha256 === after.sha256;
      const status = unchanged ? 'unchanged' : 'overwritten';
      statuses[status] += 1;
      rows.push([before.path, before.size, before.sha256, after.size, after.sha256, status]);
      continue;
    }

    const candidates = extrasByFingerprint.get(fingerprint(before)) ?? [];
    const renameTarget = candidates.find((candidate) => !claimedRenameTargets.has(candidate.path));
    if (renameTarget) {
      claimedRenameTargets.add(renameTarget.path);
      statuses.renamed += 1;
      rows.push([
        before.path,
        before.size,
        before.sha256,
        renameTarget.size,
        renameTarget.sha256,
        `renamed-to:${renameTarget.path}`,
      ]);
    } else {
      statuses.removed += 1;
      rows.push([before.path, before.size, before.sha256, '', '', 'removed']);
    }
  }

  const baselineByFingerprint = new Map();
  for (const file of baseline) {
    const key = fingerprint(file);
    const group = baselineByFingerprint.get(key) ?? [];
    group.push(file.path);
    baselineByFingerprint.set(key, group);
  }

  for (const after of extras) {
    if (claimedRenameTargets.has(after.path)) continue;
    const sources = baselineByFingerprint.get(fingerprint(after)) ?? [];
    if (sources.length > 0) {
      statuses.unexpectedCopied += 1;
      rows.push([
        after.path,
        '',
        '',
        after.size,
        after.sha256,
        `unexpected-copied-from:${sources.join('|')}`,
      ]);
    } else {
      statuses.unexpectedAdded += 1;
      rows.push([after.path, '', '', after.size, after.sha256, 'unexpected-added']);
    }
  }

  rows.sort((left, right) => String(left[0]).localeCompare(String(right[0]), 'en'));
  await writeManifest(manifestPath, rows);
  console.log(
    [
      `verify baseline=${baseline.length}`,
      `current=${current.length}`,
      `unchanged=${statuses.unchanged}`,
      `removed=${statuses.removed}`,
      `renamed=${statuses.renamed}`,
      `overwritten=${statuses.overwritten}`,
      `unexpected-copied=${statuses.unexpectedCopied}`,
      `unexpected-added=${statuses.unexpectedAdded}`,
    ].join(' '),
  );
  console.log(`manifest=${toRepositoryPath(manifestPath)}`);

  const anomalyCount =
    statuses.removed +
    statuses.renamed +
    statuses.overwritten +
    statuses.unexpectedCopied +
    statuses.unexpectedAdded;
  if (anomalyCount > 0) process.exitCode = 2;
}

async function main() {
  const { mode, manifest, force } = parseArguments(process.argv);
  if (!['baseline', 'verify'].includes(mode)) {
    usage();
    process.exitCode = 1;
    return;
  }
  if (mode === 'baseline') await createBaseline(manifest, force);
  else await verifyBaseline(manifest);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

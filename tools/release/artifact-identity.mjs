import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_IDENTITY_RELATIVE_PATH = '_release/identity.json';

const FULL_SHA_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const OWNED_TEMP_RE = /^\.identity\.[0-9a-f-]{36}\.tmp$/u;

export class ReleaseArtifactIdentityError extends Error {
  constructor(code, message, { details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReleaseArtifactIdentityError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value, pretty = false) {
  return `${JSON.stringify(stableValue(value), null, pretty ? 2 : 0)}\n`;
}

function safeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_INVALID', `Invalid ${field}.`, { details: { field } });
  }
  return number;
}

function normalizedLargestFile(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'bytes,path,sha256') {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_INVALID', 'Invalid largestFile evidence.');
  }
  const relativePath = String(value.path || '');
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\')
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_INVALID', 'Invalid largestFile path.');
  }
  const digest = String(value.sha256 || '').toLowerCase();
  if (!SHA256_RE.test(digest)) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_INVALID', 'Invalid largestFile SHA-256.');
  }
  return { path: relativePath, bytes: safeInteger(value.bytes, 'largestFile.bytes'), sha256: digest };
}

export function normalizeReleaseIdentity(value, { expectedTestedCommitSha } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'artifactManifestSha256,fileCount,kind,largestFile,testedCommitSha,totalBytes,version'
    || value.version !== 1 || value.kind !== 'smu1-release-artifact-identity') {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_INVALID', 'Release identity marker has an invalid structure.');
  }
  const testedCommitSha = String(value.testedCommitSha || '').toLowerCase();
  if (!FULL_SHA_RE.test(testedCommitSha)) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_INVALID', 'Release identity marker has an invalid tested commit SHA.');
  }
  if (expectedTestedCommitSha && testedCommitSha !== String(expectedTestedCommitSha).toLowerCase()) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_SHA_MISMATCH', 'Release identity marker belongs to another tested commit.', {
      details: { expected: String(expectedTestedCommitSha).toLowerCase(), actual: testedCommitSha }
    });
  }
  const artifactManifestSha256 = String(value.artifactManifestSha256 || '').toLowerCase();
  if (!SHA256_RE.test(artifactManifestSha256)) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_INVALID', 'Release identity marker has an invalid artifact manifest SHA-256.');
  }
  const fileCount = safeInteger(value.fileCount, 'fileCount');
  const totalBytes = safeInteger(value.totalBytes, 'totalBytes');
  const largestFile = normalizedLargestFile(value.largestFile);
  if ((fileCount === 0) !== (largestFile === null)
    || (fileCount === 0 && totalBytes !== 0)
    || (largestFile && (largestFile.bytes > totalBytes || largestFile.bytes === 0 && totalBytes > 0))) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_INVALID', 'Release identity aggregate evidence is inconsistent.');
  }
  return Object.freeze({
    version: 1,
    kind: 'smu1-release-artifact-identity',
    testedCommitSha,
    artifactManifestSha256,
    fileCount,
    totalBytes,
    largestFile: largestFile ? Object.freeze(largestFile) : null
  });
}

export function serializeReleaseIdentity(value) {
  return Buffer.from(stableJson(normalizeReleaseIdentity(value), true), 'utf8');
}

export function parseReleaseIdentityBytes(bytes, options = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  if (buffer.length === 0 || buffer.length > 64 * 1024) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_SIZE_INVALID', 'Release identity marker has an invalid byte size.');
  }
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch (cause) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_JSON_INVALID', 'Release identity marker is not valid JSON.', { cause });
  }
  const identity = normalizeReleaseIdentity(parsed, options);
  const canonical = serializeReleaseIdentity(identity);
  if (!buffer.equals(canonical)) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_NOT_CANONICAL', 'Release identity marker is not canonical.');
  }
  return Object.freeze({ ...identity, markerSha256: sha256(buffer) });
}

export function normalizeReleaseIdentityEvidence(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_EVIDENCE_INVALID', 'Release identity evidence is missing.');
  }
  const { markerSha256, ...marker } = value;
  const identity = normalizeReleaseIdentity(marker, options);
  const markerHash = String(markerSha256 || '').toLowerCase();
  if (!SHA256_RE.test(markerHash) || sha256(serializeReleaseIdentity(identity)) !== markerHash) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_EVIDENCE_INVALID', 'Release identity marker hash is invalid.');
  }
  return Object.freeze({ ...identity, markerSha256: markerHash });
}

export function releaseIdentityEvidenceMatches(left, right, options = {}) {
  try {
    const normalizedLeft = normalizeReleaseIdentityEvidence(left, options);
    const normalizedRight = normalizeReleaseIdentityEvidence(right, options);
    return normalizedLeft.markerSha256 === normalizedRight.markerSha256
      && normalizedLeft.testedCommitSha === normalizedRight.testedCommitSha
      && normalizedLeft.artifactManifestSha256 === normalizedRight.artifactManifestSha256
      && normalizedLeft.fileCount === normalizedRight.fileCount
      && normalizedLeft.totalBytes === normalizedRight.totalBytes;
  } catch {
    return false;
  }
}

function inside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function cleanupOwnedTemps(distRoot) {
  const releaseDir = path.join(distRoot, '_release');
  let entries;
  try {
    const stat = await fs.lstat(releaseDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_PATH_UNSAFE', 'dist/_release must be a regular directory.');
    }
    entries = await fs.readdir(releaseDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!OWNED_TEMP_RE.test(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_PATH_UNSAFE', 'Owned identity temp path is unsafe.');
    }
    await fs.unlink(path.join(releaseDir, entry.name));
  }
}

export async function buildReleaseArtifactManifest(distRoot) {
  const root = path.resolve(distRoot);
  const rootStat = await fs.lstat(root).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new ReleaseArtifactIdentityError('RELEASE_DIST_MISSING', 'Release dist directory does not exist.', { cause: error });
    }
    throw error;
  });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ReleaseArtifactIdentityError('RELEASE_DIST_UNSAFE', 'Release dist must be a regular directory.');
  }
  await cleanupOwnedTemps(root);
  const files = [];
  async function visit(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (!inside(root, absolute) || entry.isSymbolicLink()) {
        throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_PATH_UNSAFE', 'Release artifact contains an unsafe path.');
      }
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(absolute, relativePath);
      } else if (entry.isFile()) {
        if (relativePath === RELEASE_IDENTITY_RELATIVE_PATH) continue;
        const bytes = await fs.readFile(absolute);
        files.push({ path: relativePath, sha256: sha256(bytes), bytes: bytes.length });
      } else {
        throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_PATH_UNSAFE', 'Release artifact contains a non-regular file.');
      }
    }
  }
  await visit(root);
  files.sort((left, right) => compareText(left.path, right.path));
  const totalBytes = files.reduce((sum, item) => {
    const next = sum + item.bytes;
    if (!Number.isSafeInteger(next)) throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_SIZE_INVALID', 'Release artifact is too large to measure safely.');
    return next;
  }, 0);
  const largestFile = [...files].sort((left, right) => right.bytes - left.bytes || compareText(left.path, right.path))[0] || null;
  return Object.freeze({
    artifactManifestSha256: sha256(Buffer.from(stableJson(files), 'utf8')),
    fileCount: files.length,
    totalBytes,
    largestFile: largestFile ? Object.freeze({ ...largestFile }) : null
  });
}

export async function writeReleaseIdentity({ distRoot, testedCommitSha } = {}) {
  const root = path.resolve(distRoot || 'dist');
  const sha = String(testedCommitSha || '').toLowerCase();
  if (!FULL_SHA_RE.test(sha)) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_SHA_INVALID', 'A full tested commit SHA is required.');
  }
  const manifest = await buildReleaseArtifactManifest(root);
  const identity = normalizeReleaseIdentity({
    version: 1,
    kind: 'smu1-release-artifact-identity',
    testedCommitSha: sha,
    ...manifest
  });
  const releaseDir = path.join(root, '_release');
  await fs.mkdir(releaseDir, { recursive: true });
  const releaseStat = await fs.lstat(releaseDir);
  if (releaseStat.isSymbolicLink() || !releaseStat.isDirectory()) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_PATH_UNSAFE', 'dist/_release must be a regular directory.');
  }
  const target = path.join(root, ...RELEASE_IDENTITY_RELATIVE_PATH.split('/'));
  if (!inside(root, target)) throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_PATH_UNSAFE', 'Release identity path escaped dist.');
  const bytes = serializeReleaseIdentity(identity);
  const temporary = path.join(releaseDir, `.identity.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
  return Object.freeze({ ...identity, markerSha256: sha256(bytes) });
}

export async function readAndVerifyReleaseIdentity({ distRoot, expectedTestedCommitSha } = {}) {
  const root = path.resolve(distRoot || 'dist');
  const target = path.join(root, ...RELEASE_IDENTITY_RELATIVE_PATH.split('/'));
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_PATH_UNSAFE', 'Release identity marker must be a regular file.');
  }
  const evidence = parseReleaseIdentityBytes(await fs.readFile(target), { expectedTestedCommitSha });
  const actual = await buildReleaseArtifactManifest(root);
  const largestMatches = actual.largestFile === null
    ? evidence.largestFile === null
    : evidence.largestFile !== null
      && actual.largestFile.path === evidence.largestFile.path
      && actual.largestFile.bytes === evidence.largestFile.bytes
      && actual.largestFile.sha256 === evidence.largestFile.sha256;
  if (actual.artifactManifestSha256 !== evidence.artifactManifestSha256
    || actual.fileCount !== evidence.fileCount
    || actual.totalBytes !== evidence.totalBytes
    || !largestMatches) {
    throw new ReleaseArtifactIdentityError('RELEASE_IDENTITY_MANIFEST_MISMATCH', 'Release identity marker does not match current dist bytes.', {
      details: { expected: evidence, actual }
    });
  }
  return evidence;
}

function cliValue(args, name) {
  const inline = args.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const evidence = await writeReleaseIdentity({
    distRoot: cliValue(args, '--dist') || 'dist',
    testedCommitSha: cliValue(args, '--tested-sha') || process.env.GITHUB_SHA
  });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error?.code || 'RELEASE_IDENTITY_FAILED'}: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}

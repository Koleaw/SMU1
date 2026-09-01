import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

import { resolveAstroCli } from '../admin-api/astro-cli.mjs';
import { createMediaStagingService } from '../admin-api/media-staging.mjs';
import { createTransactionEngine } from '../admin-api/transaction-engine.mjs';
import { discoverArtifactFiles, fingerprintArtifact } from './route-passport-model.mjs';

const execFileAsync = promisify(execFile);
const sourceRoot = process.cwd();
const argv = process.argv.slice(2);
const option = (name, fallback = '') => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const outputPath = path.resolve(sourceRoot, option('--output', '.admin-runtime/h6-qa/media-privacy-chain.json'));
const keepFixture = argv.includes('--keep-fixture');
const basePath = normalizeBase(option('--base', process.env.BASE_PATH || '/'));

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write([
    'H6 GPS/private-metadata end-to-end media drill',
    '',
    '  node tools/qa/media-privacy-chain.mjs [--base=/SMU1] [--output=<json>] [--keep-fixture]',
    '',
    'Runs only in a disposable clone of exact HEAD. It creates a private source in memory,',
    'atomically promotes sanitized canonical bytes, runs H5 + Astro + deploy preparation,',
    'and verifies canonical, derivatives and deploy artifact contain no private metadata.',
    ''
  ].join('\n'));
  process.exit(0);
}

function normalizeBase(value) {
  const trimmed = String(value || '/').trim();
  if (trimmed === '' || trimmed === '/') return '/';
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\/?$/u.test(trimmed) || trimmed.includes('..') || trimmed.includes('//')) {
    throw new Error(`Unsafe BASE_PATH: ${trimmed}`);
  }
  return `/${trimmed.replace(/^\/+|\/+$/gu, '')}`;
}

const git = async (cwd, args) => (await execFileAsync('git', args, {
  cwd,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 32 * 1024 * 1024
})).stdout.trim();

const contained = (parent, candidate) => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();

async function resolveExistingPublicFile(rootDir, publicPath, label) {
  const value = String(publicPath || '');
  if (!/^\/[A-Za-z0-9._/-]+$/u.test(value) || value.includes('//')
    || value.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`${label} has an unsafe public path: ${value}`);
  }
  const root = path.resolve(rootDir);
  const target = path.resolve(root, ...value.split('/').filter(Boolean));
  if (!contained(root, target)) throw new Error(`${label} escaped its public root: ${value}`);
  const [rootReal, targetInfo, targetReal] = await Promise.all([
    realpath(root), lstat(target), realpath(target)
  ]);
  if (targetInfo.isSymbolicLink() || !targetInfo.isFile() || !contained(rootReal, targetReal)) {
    throw new Error(`${label} is not a regular contained file: ${value}`);
  }
  return target;
}

async function auditPrivateMasterAbsence(directory, privateSha256, privateBytes) {
  const root = path.resolve(directory);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error(`Unsafe upload audit root: ${root}`);
  let filesAudited = 0;
  let candidateHashesAudited = 0;
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (!contained(root, target)) throw new Error(`Upload audit escaped its root: ${target}`);
      if (entry.isSymbolicLink()) throw new Error(`Upload audit refuses a symlink: ${target}`);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        filesAudited += 1;
        const info = await lstat(target);
        if (info.isSymbolicLink()) throw new Error(`Upload audit refuses a reparse/symlink file: ${target}`);
        if (info.size !== privateBytes) continue;
        candidateHashesAudited += 1;
        if (sha256(await readFile(target)) === privateSha256) {
          throw new Error(`Untouched private master leaked into upload tree: ${target}`);
        }
      } else {
        throw new Error(`Upload audit refuses a non-regular entry: ${target}`);
      }
    }
  };
  await visit(root);
  return { absent: true, filesAudited, candidateHashesAudited };
}

const run = (command, args, { cwd, env, label }) => new Promise((resolve, reject) => {
  const started = Date.now();
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
    shell: false
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) resolve({ label, durationMs: Date.now() - started });
    else reject(new Error(`${label} exited with ${code ?? signal}.`));
  });
});

async function inspectSanitizedRaster(filename, expectedDimensions) {
  const bytes = await readFile(filename);
  const metadata = await sharp(bytes, { failOn: 'warning' }).metadata();
  const lowered = bytes.toString('latin1').toLowerCase();
  const privateMarkers = ['gpslatitude', 'gpslongitude', 'private camera', 'serial device', 'ownername'];
  const leakedMarkers = privateMarkers.filter((marker) => lowered.includes(marker));
  const actualDimensions = [metadata.width, metadata.height];
  return {
    path: filename,
    bytes: bytes.length,
    sha256: sha256(bytes),
    format: metadata.format,
    dimensions: actualDimensions,
    exif: Boolean(metadata.exif),
    xmp: Boolean(metadata.xmp),
    iptc: Boolean(metadata.iptc),
    comments: Array.isArray(metadata.comments) ? metadata.comments.length : 0,
    orientation: metadata.orientation ?? null,
    leakedMarkers,
    pass: !metadata.exif && !metadata.xmp && !metadata.iptc
      && (!Array.isArray(metadata.comments) || metadata.comments.length === 0)
      && !metadata.orientation && leakedMarkers.length === 0
      && (!expectedDimensions || actualDimensions.join('x') === expectedDimensions.join('x'))
  };
}

const branchName = await git(sourceRoot, ['branch', '--show-current']);
const branch = branchName || '(detached)';
const sourceSHA = await git(sourceRoot, ['rev-parse', 'HEAD']);
if (!/^[a-f0-9]{40}$/u.test(sourceSHA)) throw new Error('Invalid exact source SHA.');
const releaseArtifactFiles = discoverArtifactFiles(path.join(sourceRoot, 'dist'));
const releaseArtifactFingerprint = fingerprintArtifact(path.join(sourceRoot, 'dist'), releaseArtifactFiles);

const fixtureBase = process.platform === 'win32'
  ? path.join(path.parse(sourceRoot).root, 'CodexTemp', 'smu1-h6-media-privacy')
  : path.join(os.tmpdir(), 'smu1-h6-media-privacy');
await mkdir(fixtureBase, { recursive: true });
const fixtureRoot = await mkdtemp(path.join(fixtureBase, 'run-'));
const checkoutRoot = path.join(fixtureRoot, 'checkout');
const stages = [];

try {
  const cloneArgs = branchName
    ? ['clone', '--no-reject-shallow', '--shared', '--single-branch', '--branch', branchName, '--no-tags', sourceRoot, checkoutRoot]
    : ['clone', '--no-reject-shallow', '--shared', '--no-checkout', '--no-tags', sourceRoot, checkoutRoot];
  await execFileAsync('git', cloneArgs, { cwd: fixtureRoot, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (!branchName) await execFileAsync('git', ['checkout', '--detach', '--quiet', sourceSHA], { cwd: checkoutRoot, windowsHide: true });
  const clonedSHA = await git(checkoutRoot, ['rev-parse', 'HEAD']);
  if (clonedSHA !== sourceSHA) throw new Error(`Disposable clone SHA mismatch: ${clonedSHA}.`);

  await symlink(path.join(sourceRoot, 'node_modules'), path.join(checkoutRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const sourceH5 = path.join(sourceRoot, 'public', '_media', 'h5');
  try {
    await cp(sourceH5, path.join(checkoutRoot, 'public', '_media', 'h5'), { recursive: true, force: false });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('H5 cache is absent. Run the canonical build before the media privacy drill.');
    throw error;
  }

  const privateXmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description exif:GPSLatitude="55,45.1N" exif:GPSLongitude="037,37.2E" tiff:Make="Private Camera" tiff:Model="Serial Device" tiff:OwnerName="Pavel Private"/></rdf:RDF></x:xmpmeta>';
  const privateSource = await sharp({
    create: { width: 640, height: 360, channels: 3, background: { r: 28, g: 96, b: 172 } }
  }).jpeg({ quality: 88 }).withMetadata({ orientation: 6 }).withXmp(privateXmp).toBuffer();
  const stagingIdentity = {
    batchId: 'h6-media-privacy-batch',
    ownerId: 'h6-media-privacy-owner',
    clientId: 'h6-media-privacy-item'
  };
  const staging = createMediaStagingService({
    stagingRoot: path.join(checkoutRoot, '.admin-runtime', 'media-privacy-staging')
  });
  await staging.init();
  const stagingSequence = [];
  const staged = await staging.stage({
    ...stagingIdentity,
    originalIndex: 0,
    buffer: privateSource,
    filename: 'h6-gps-private-source.jpg',
    declaredMime: 'image/jpeg'
  });
  stagingSequence.push('stage');
  if (staged.status !== 'ready' || staged.promoted !== false) {
    throw new Error('Fresh privacy fixture did not enter the ready staging state.');
  }
  if (!staged.validation.privateMetadata?.gps || !staged.validation.privateMetadata?.device || !staged.validation.metadataSanitized) {
    throw new Error('Private GPS/device metadata was not detected and sanitized.');
  }
  if (staged.validation.sourceSha256 === staged.validation.sha256) throw new Error('Sanitized canonical bytes equal private source bytes.');
  const resolved = await staging.resolveForPromotion(stagingIdentity);
  stagingSequence.push('resolveForPromotion');
  if (!resolved.verified || resolved.stagedId !== staged.stagedId || resolved.canonicalPath !== staged.canonicalPath
    || sha256(resolved.bytes) !== staged.validation.sha256) {
    throw new Error('Staging promotion resolver did not return the exact verified sanitized bytes.');
  }
  const [stagingRootReal, resolvedInfo, resolvedReal] = await Promise.all([
    realpath(staging.root), lstat(resolved.filePath), realpath(resolved.filePath)
  ]);
  if (resolvedInfo.isSymbolicLink() || !resolvedInfo.isFile() || !contained(stagingRootReal, resolvedReal)) {
    throw new Error('Resolved promotion bytes escaped the owned staging quarantine.');
  }

  const productRelative = 'src/content/products/konteynernaya-ploshchadka-modul.json';
  const productPath = path.join(checkoutRoot, ...productRelative.split('/'));
  const product = JSON.parse(await readFile(productPath, 'utf8'));
  const canonicalPath = resolved.canonicalPath;
  product.image = canonicalPath;
  product.gallery = [{
    src: canonicalPath,
    alt: 'H6 metadata privacy verification fixture',
    caption: ''
  }];
  const productBytes = Buffer.from(`${JSON.stringify(product, null, 2)}\n`, 'utf8');
  const canonicalRelative = `public${canonicalPath}`;

  const engine = createTransactionEngine({
    repoRoot: checkoutRoot,
    runtimeDir: path.join(checkoutRoot, '.admin-runtime', 'media-privacy-transaction')
  });
  await engine.initialize();
  const idempotencyKey = `h6-media-privacy-${sourceSHA}`;
  const preview = await engine.preview({
    owner: 'h6-media-privacy-drill',
    recoveryClientId: 'disposable-clone',
    idempotencyKey,
    mutations: [
      { path: productRelative, operation: 'write', bytes: productBytes },
      { path: canonicalRelative, operation: 'write', bytes: resolved.bytes }
    ]
  });
  const committed = await engine.apply({
    owner: 'h6-media-privacy-drill',
    recoveryClientId: 'disposable-clone',
    idempotencyKey,
    transactionId: preview.transactionId,
    payloadHash: preview.payloadHash
  });
  if (committed.state !== 'committed') throw new Error(`Media promotion transaction is ${committed.state}.`);
  stagingSequence.push('atomic transaction');
  const promoted = await staging.markPromoted({ ...stagingIdentity, canonicalPath });
  stagingSequence.push('markPromoted');
  if (!promoted.promoted || promoted.status !== 'promoted' || promoted.stagedId !== staged.stagedId
    || promoted.canonicalPath !== canonicalPath) {
    throw new Error('Staged media was not marked promoted after the committed atomic transaction.');
  }

  const canonicalAbsolute = await resolveExistingPublicFile(path.join(checkoutRoot, 'public'), canonicalPath, 'Canonical upload');
  const canonicalAudit = await inspectSanitizedRaster(canonicalAbsolute, [360, 640]);
  if (!canonicalAudit.pass || canonicalAudit.sha256 !== staged.validation.sha256) {
    throw new Error('Canonical promoted raster failed privacy/hash/orientation audit.');
  }

  const childEnv = {
    ...process.env,
    BASE_PATH: basePath,
    DEPLOY_TARGET: 'test',
    PRODUCTION_DEPLOY_ENABLED: 'false',
    SITE_URL: '',
    TEST_SITE_URL: 'https://preview.smu1-qa.invalid'
  };
  stages.push(await run(process.execPath, ['tools/performance/prepare-media.mjs'], {
    cwd: checkoutRoot, env: childEnv, label: 'H5 media prepare'
  }));
  const manifestPath = path.join(checkoutRoot, 'public', '_media', 'h5', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifestEntry = manifest.entries?.[canonicalPath];
  if (!manifestEntry || !Array.isArray(manifestEntry.variants) || manifestEntry.variants.length === 0) {
    throw new Error('H5 manifest has no variants for the sanitized canonical fixture.');
  }
  const h5Audits = [];
  for (const variant of manifestEntry.variants) {
    const target = await resolveExistingPublicFile(path.join(checkoutRoot, 'public'), variant.path, 'H5 variant');
    const audit = await inspectSanitizedRaster(target, [variant.width, variant.height]);
    if (!audit.pass || audit.sha256 !== variant.sha256) throw new Error(`H5 variant failed privacy/hash audit: ${variant.path}`);
    h5Audits.push({ ...audit, path: variant.path });
  }

  const astroCli = await resolveAstroCli(checkoutRoot);
  stages.push(await run(process.execPath, [astroCli, 'build'], { cwd: checkoutRoot, env: childEnv, label: 'isolated Astro build' }));
  stages.push(await run(process.execPath, ['tools/performance/deploy-media-reachability.mjs', '--apply', `--base=${basePath}`], {
    cwd: checkoutRoot, env: childEnv, label: 'isolated deploy preparation'
  }));

  const routeHtml = path.join(
    checkoutRoot,
    'dist',
    'ograzhdeniya-i-zabory',
    'ograzhdeniya-kontejnernyh-ploshchadok',
    'konteynernaya-ploshchadka-modul',
    'index.html'
  );
  const html = await readFile(routeHtml, 'utf8');
  if (!html.includes(canonicalPath)) throw new Error('Built product route does not reference sanitized canonical media.');

  const deployPaths = [canonicalPath, ...manifestEntry.variants.map((variant) => variant.path)];
  const deployAudits = [];
  for (const publicPath of deployPaths) {
    const target = await resolveExistingPublicFile(path.join(checkoutRoot, 'dist'), publicPath, 'Deploy artifact media');
    const expected = publicPath === canonicalPath
      ? [canonicalAudit.dimensions[0], canonicalAudit.dimensions[1]]
      : (() => {
          const variant = manifestEntry.variants.find((entry) => entry.path === publicPath);
          return [variant.width, variant.height];
        })();
    const audit = await inspectSanitizedRaster(target, expected);
    if (!audit.pass) throw new Error(`Deploy artifact media failed privacy audit: ${publicPath}`);
    deployAudits.push({ ...audit, path: publicPath });
  }

  const [stagingAudit, publicUploadAudit, deployUploadAudit] = await Promise.all([
    auditPrivateMasterAbsence(
      staging.root,
      staged.validation.sourceSha256,
      privateSource.length
    ),
    auditPrivateMasterAbsence(
      path.join(checkoutRoot, 'public', 'uploads'),
      staged.validation.sourceSha256,
      privateSource.length
    ),
    auditPrivateMasterAbsence(
      path.join(checkoutRoot, 'dist', 'uploads'),
      staged.validation.sourceSha256,
      privateSource.length
    )
  ]);

  const report = {
    schemaVersion: 1,
    ok: true,
    createdAt: now(),
    sourceSHA,
    branch,
    basePath,
    disposable: true,
    releaseArtifact: {
      sha256: releaseArtifactFingerprint.aggregate,
      fileCount: releaseArtifactFingerprint.fileCount,
      bytes: releaseArtifactFingerprint.totalBytes
    },
    transaction: {
      transactionId: committed.transactionId,
      state: committed.state,
      mutations: [productRelative, canonicalRelative]
    },
    staging: {
      service: 'createMediaStagingService',
      sequence: stagingSequence,
      rootWithinDisposableRuntime: contained(path.join(checkoutRoot, '.admin-runtime'), staging.root),
      staged: {
        ...stagingIdentity,
        status: staged.status,
        promoted: staged.promoted,
        stagedId: staged.stagedId,
        canonicalPath: staged.canonicalPath,
        sourceSha256: staged.validation.sourceSha256,
        sanitizedSha256: staged.validation.sha256,
        sourceBytes: staged.validation.sourceBytes,
        sanitizedBytes: staged.validation.bytes,
        metadataSanitized: staged.validation.metadataSanitized
      },
      resolved: {
        verified: resolved.verified,
        bytes: resolved.bytes.length,
        sha256: sha256(resolved.bytes),
        fileWithinQuarantine: contained(stagingRootReal, resolvedReal)
      },
      promoted: {
        afterCommittedTransaction: committed.state === 'committed',
        promoted: promoted.promoted,
        status: promoted.status,
        stagedId: promoted.stagedId,
        canonicalPath: promoted.canonicalPath
      }
    },
    privateSource: {
      generatedInMemoryOnly: true,
      bytes: privateSource.length,
      sha256: staged.validation.sourceSha256,
      gpsDetected: staged.validation.privateMetadata.gps,
      deviceDetected: staged.validation.privateMetadata.device,
      orientationApplied: true,
      absentFromStaging: stagingAudit.absent,
      absentFromPublicUploads: publicUploadAudit.absent,
      absentFromDeployUploads: deployUploadAudit.absent,
      stagingAudit,
      publicUploadAudit,
      deployUploadAudit
    },
    canonical: { ...canonicalAudit, path: canonicalPath },
    h5: {
      pipelineHash: manifest.generator?.pipelineHash || null,
      variantCount: h5Audits.length,
      variants: h5Audits
    },
    deployArtifact: {
      route: '/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-modul/',
      routeReferencesCanonical: true,
      fileCount: deployAudits.length,
      files: deployAudits
    },
    stages
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, sourceSHA, output: outputPath, variants: h5Audits.length, deployFiles: deployAudits.length, stages }, null, 2)}\n`);
} finally {
  if (!keepFixture) {
    if (!contained(fixtureBase, fixtureRoot)) throw new Error(`Refusing to remove unsafe fixture path: ${fixtureRoot}`);
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }).catch((error) => {
      process.stderr.write(`[h6-media-privacy] Could not remove disposable fixture: ${error.message}\n`);
    });
  } else {
    process.stderr.write(`[h6-media-privacy] Disposable fixture retained: ${fixtureRoot}\n`);
  }
}

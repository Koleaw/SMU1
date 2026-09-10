import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

import { runAdminLauncher } from '../admin-api/launcher.mjs';
import { validateVisualEditorAcceptanceEvidence } from './evidence-contract.mjs';
import { buildExpectedRouteModel } from './route-passport-model.mjs';

const execFileAsync = promisify(execFile);
const sourceRoot = process.cwd();
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const option = (name, fallback = '') => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const outputPath = path.resolve(sourceRoot, option('--output', '.admin-runtime/h6-qa/admin-action-crawl.json'));
const acceptanceOutputPath = path.resolve(sourceRoot, option('--acceptance-output', '.admin-runtime/h6-qa/visual-editor-acceptance.json'));
const keepFixture = hasFlag('--keep-fixture');
const headful = hasFlag('--headful');
const qaUsername = 'h6-browser-qa';
const qaPassword = 'H6-browser-qa-only-2026';

if (hasFlag('--help') || hasFlag('-h')) {
  process.stdout.write([
    'H6 disposable visual-editor action crawl',
    '',
    '  node tools/qa/isolated-admin-action-qa.mjs',
    '  Options: --output=<action-json>, --acceptance-output=<acceptance-json>, --headful, --keep-fixture.',
    '',
    'The command clones the exact current commit, uses an ignored isolated content root,',
    'starts the loopback-only editor with synthetic credentials, executes action + visual acceptance,',
    'and never executes release actions.',
    ''
  ].join('\n'));
  process.exit(0);
}

const git = async (cwd, args) => (await execFileAsync('git', args, {
  cwd,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024
})).stdout.trim();

const isWithin = (parent, candidate) => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const run = (command, args, { cwd, env }) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
    shell: false
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${path.basename(command)} exited with ${code ?? signal}.`));
  });
});

const activeBranch = await git(sourceRoot, ['branch', '--show-current']);
const branch = activeBranch || '(detached)';
const sourceSHA = await git(sourceRoot, ['rev-parse', 'HEAD']);
if (!/^[a-f0-9]{40}$/u.test(sourceSHA)) throw new Error('The current source SHA is invalid.');

const fixtureBase = process.platform === 'win32'
  ? path.join(path.parse(sourceRoot).root, 'CodexTemp', 'smu1-h6-admin-actions')
  : path.join(os.tmpdir(), 'smu1-h6-admin-actions');
await mkdir(fixtureBase, { recursive: true });
const fixtureRoot = await mkdtemp(path.join(fixtureBase, 'run-'));
const checkoutRoot = path.join(fixtureRoot, 'checkout');
const isolatedContentRoot = path.join(checkoutRoot, '.admin-runtime', 'isolated-content');
let launcher = null;

try {
  const cloneArgs = activeBranch
    ? ['clone', '--shared', '--single-branch', '--branch', activeBranch, '--no-tags', sourceRoot, checkoutRoot]
    : ['clone', '--shared', '--no-checkout', '--no-tags', sourceRoot, checkoutRoot];
  await execFileAsync('git', cloneArgs, { cwd: fixtureRoot, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (!activeBranch) {
    await execFileAsync('git', ['checkout', '--detach', '--quiet', sourceSHA], {
      cwd: checkoutRoot, windowsHide: true, maxBuffer: 16 * 1024 * 1024
    });
  }
  const clonedSHA = await git(checkoutRoot, ['rev-parse', 'HEAD']);
  if (clonedSHA !== sourceSHA) throw new Error(`Disposable clone SHA mismatch: ${clonedSHA}.`);

  const nodeModulesTarget = path.join(checkoutRoot, 'node_modules');
  await symlink(path.join(sourceRoot, 'node_modules'), nodeModulesTarget, process.platform === 'win32' ? 'junction' : 'dir');
  await cp(path.join(checkoutRoot, 'src', 'content'), isolatedContentRoot, { recursive: true, force: false });
  await Promise.all([
    mkdir(path.join(isolatedContentRoot, '.admin-data'), { recursive: true }),
    mkdir(path.join(isolatedContentRoot, 'public', 'uploads'), { recursive: true })
  ]);
  for (const filename of ['navigation.json', 'yandex.json']) {
    await cp(
      path.join(checkoutRoot, 'src', 'data', filename),
      path.join(isolatedContentRoot, '.admin-data', filename),
      { force: false }
    );
  }

  const sessionSecret = crypto.randomBytes(48).toString('base64url');
  const envFile = [
    '# Synthetic H6 browser QA credentials. The disposable checkout is removed after the run.',
    `ADMIN_USERNAME=${qaUsername}`,
    `ADMIN_PASSWORD=${qaPassword}`,
    `SESSION_SECRET=${sessionSecret}`,
    'ADMIN_API_HOST=127.0.0.1',
    'ADMIN_UI_HOST=127.0.0.1',
    'PUBLIC_ADMIN_API_BASE=/api/admin',
    'CONTENT_WRITE_MODE=local',
    ...(activeBranch ? [`ADMIN_EXPECTED_BRANCH=${activeBranch}`] : []),
    'ADMIN_TEST_MODE=true',
    'ADMIN_TEST_FAULTS_ENABLED=true',
    'ADMIN_TEST_EXACT_MODE=deterministic',
    // Let the UI join the server-scheduled exact run before its terminal result,
    // as it does with a real build. An instant synthetic failure invites a retry.
    'ADMIN_TEST_EXACT_DELAY_MS=5000',
    'PRODUCTION_DEPLOY_ENABLED=false',
    'ADMIN_ALLOW_PRODUCTION_PUBLISH=false',
    ''
  ].join('\n');
  await writeFile(path.join(checkoutRoot, '.env.admin.local'), envFile, { encoding: 'utf8', mode: 0o600 });

  const previousTestContentRoot = process.env.ADMIN_TEST_CONTENT_ROOT;
  const previousTestMode = process.env.ADMIN_TEST_MODE;
  const previousTestFaults = process.env.ADMIN_TEST_FAULTS_ENABLED;
  const previousTestExactMode = process.env.ADMIN_TEST_EXACT_MODE;
  const previousProduction = process.env.PRODUCTION_DEPLOY_ENABLED;
  const previousProductionLegacy = process.env.ADMIN_ALLOW_PRODUCTION_PUBLISH;
  process.env.ADMIN_TEST_CONTENT_ROOT = isolatedContentRoot;
  process.env.ADMIN_TEST_MODE = 'true';
  process.env.ADMIN_TEST_FAULTS_ENABLED = 'true';
  process.env.ADMIN_TEST_EXACT_MODE = 'deterministic';
  process.env.PRODUCTION_DEPLOY_ENABLED = 'false';
  process.env.ADMIN_ALLOW_PRODUCTION_PUBLISH = 'false';
  try {
    launcher = await runAdminLauncher({ repoRoot: checkoutRoot, keepAlive: false, open: false, timeoutMs: 60_000 });
  } finally {
    if (previousTestContentRoot === undefined) delete process.env.ADMIN_TEST_CONTENT_ROOT;
    else process.env.ADMIN_TEST_CONTENT_ROOT = previousTestContentRoot;
    if (previousTestMode === undefined) delete process.env.ADMIN_TEST_MODE;
    else process.env.ADMIN_TEST_MODE = previousTestMode;
    if (previousTestFaults === undefined) delete process.env.ADMIN_TEST_FAULTS_ENABLED;
    else process.env.ADMIN_TEST_FAULTS_ENABLED = previousTestFaults;
    if (previousTestExactMode === undefined) delete process.env.ADMIN_TEST_EXACT_MODE;
    else process.env.ADMIN_TEST_EXACT_MODE = previousTestExactMode;
    if (previousProduction === undefined) delete process.env.PRODUCTION_DEPLOY_ENABLED;
    else process.env.PRODUCTION_DEPLOY_ENABLED = previousProduction;
    if (previousProductionLegacy === undefined) delete process.env.ADMIN_ALLOW_PRODUCTION_PUBLISH;
    else process.env.ADMIN_ALLOW_PRODUCTION_PUBLISH = previousProductionLegacy;
  }

  const origin = new URL(launcher.adminUrl).origin;
  const proofRelative = '.admin-runtime/h6-qa/isolation-proof.json';
  const proofPath = path.join(checkoutRoot, ...proofRelative.split('/'));
  await mkdir(path.dirname(proofPath), { recursive: true });
  await writeFile(proofPath, `${JSON.stringify({
    schemaVersion: 1,
    disposableRoot: checkoutRoot,
    isolatedContentRoot,
    origin,
    sourceSHA,
    branch,
    publishIntercepted: true,
    publishBoundary: 'ADMIN_TEST_MODE=true; production endpoints server-side rejected',
    testFaultsEnabled: true,
    deterministicExact: true,
    sourceWritesDisposable: true,
    nonce: crypto.randomBytes(32).toString('base64url')
  }, null, 2)}\n`, 'utf8');

  const fixturesRelative = '.admin-runtime/h6-qa/visual-editor-fixtures';
  const fixturesRoot = path.join(checkoutRoot, ...fixturesRelative.split('/'));
  await mkdir(fixturesRoot, { recursive: true });
  const mediaFiles = [];
  for (let index = 1; index <= 20; index += 1) {
    const filename = `h6-acceptance-${String(index).padStart(2, '0')}.${index % 2 === 0 ? 'png' : 'jpg'}`;
    const relative = filename;
    const target = path.join(fixturesRoot, filename);
    const color = {
      r: (37 + index * 17) % 256,
      g: (83 + index * 29) % 256,
      b: (149 + index * 41) % 256,
      alpha: 1
    };
    const pipeline = sharp({
      create: { width: 320 + index, height: 220 + index, channels: 4, background: color }
    });
    if (filename.endsWith('.png')) await pipeline.png({ compressionLevel: 9 }).toFile(target);
    else await pipeline.jpeg({ quality: 84, chromaSubsampling: '4:4:4' }).toFile(target);
    mediaFiles.push(relative);
  }
  const failedMediaFile = 'h6-malformed.jpg';
  await writeFile(path.join(fixturesRoot, failedMediaFile), Buffer.from('not-a-raster-image', 'utf8'));
  const projectRoutes = buildExpectedRouteModel({ root: checkoutRoot }).routes
    .map(route => route.pathname).filter(route => /^\/vypolnennye-obekty\/[^/]+\/$/u.test(route)).sort();
  let projectRoute;
  for (const route of projectRoutes) {
    const slug = route.split('/').filter(Boolean).at(-1);
    const content = JSON.parse(await readFile(path.join(isolatedContentRoot, 'projects', `${slug}.json`), 'utf8'));
    const presentation = content.presentation || {};
    if (!presentation.archiveCoverMedia && !presentation.detailHeroMedia && !presentation.publicGallery?.length) {
      projectRoute = route;
      break;
    }
  }
  if (!projectRoute) throw new Error('Project media-role acceptance requires a current published text-only project.');
  const projectSlug = projectRoute.split('/').filter(Boolean).at(-1);
  await writeFile(path.join(fixturesRoot, 'visual-editor-acceptance.json'), `${JSON.stringify({
    schemaVersion: 1,
    pages: { project: { query: projectSlug, slug: projectSlug, route: projectRoute } },
    isolationProof: path.relative(fixturesRoot, proofPath).replace(/\\/gu, '/'),
    mediaFiles,
    failedMediaFile,
    feedbackBudgetMs: 100,
    saveBudgetMs: 2000,
    exactObservationMs: 15000
  }, null, 2)}\n`, 'utf8');

  const reportRelative = '.admin-runtime/h6-qa/admin-action-crawl.json';
  await run(process.execPath, [
    'tools/qa/admin-action-crawl.mjs',
    `--origin=${origin}`,
    '--isolated-mutations',
    `--isolation-proof=${proofRelative}`,
    `--output=${reportRelative}`,
    ...(headful ? ['--headful'] : [])
  ], {
    cwd: checkoutRoot,
    env: {
      ...process.env,
      H6_QA_ADMIN_USERNAME: qaUsername,
      H6_QA_ADMIN_PASSWORD: qaPassword,
      ADMIN_TEST_MODE: 'true',
      ADMIN_TEST_FAULTS_ENABLED: 'true',
      ADMIN_TEST_EXACT_MODE: 'deterministic',
      ADMIN_TEST_CONTENT_ROOT: isolatedContentRoot,
      PRODUCTION_DEPLOY_ENABLED: 'false',
      ADMIN_ALLOW_PRODUCTION_PUBLISH: 'false'
    }
  });

  const report = JSON.parse(await readFile(path.join(checkoutRoot, ...reportRelative.split('/')), 'utf8'));
  if (report?.evidence?.sourceSHA !== sourceSHA || report?.evidence?.branch !== branch || report?.evidence?.dirty) {
    throw new Error('Admin action evidence is not bound to the clean exact source revision.');
  }
  if (report?.evidence?.releaseActionsExecuted || report?.aggregate?.failed || report?.aggregate?.canvasRoutesFailed) {
    throw new Error('The isolated visual-editor action crawl reported a failure or a release mutation.');
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const acceptanceRelative = '.admin-runtime/h6-qa/visual-editor-acceptance.json';
  await run(process.execPath, [
    'tools/qa/visual-editor-acceptance.mjs',
    `--origin=${origin}`,
    `--fixtures=${fixturesRelative}`,
    `--output=${acceptanceRelative}`,
    ...(headful ? ['--headful'] : [])
  ], {
    cwd: checkoutRoot,
    env: {
      ...process.env,
      H6_QA_ADMIN_USERNAME: qaUsername,
      H6_QA_ADMIN_PASSWORD: qaPassword,
      ADMIN_TEST_MODE: 'true',
      ADMIN_TEST_FAULTS_ENABLED: 'true',
      ADMIN_TEST_EXACT_MODE: 'deterministic',
      ADMIN_TEST_CONTENT_ROOT: isolatedContentRoot,
      PRODUCTION_DEPLOY_ENABLED: 'false',
      ADMIN_ALLOW_PRODUCTION_PUBLISH: 'false'
    }
  });
  const acceptance = JSON.parse(await readFile(path.join(checkoutRoot, ...acceptanceRelative.split('/')), 'utf8'));
  const acceptedSHA = acceptance?.input?.isolation?.sourceSHA;
  if (acceptance?.ok !== true || acceptance?.aggregate?.failed || acceptedSHA !== sourceSHA
    || acceptance?.releaseBoundary?.releaseMutationRequests?.length) {
    throw new Error('The isolated visual-editor acceptance reported a failure, stale source, or release mutation.');
  }
  const promotedProductPath = path.join(isolatedContentRoot, 'products', 'konteynernaya-ploshchadka-modul.json');
  const promotedProduct = JSON.parse(await readFile(promotedProductPath, 'utf8'));
  const canonicalPaths = [...new Set((promotedProduct.gallery || []).map((item) => item?.src || item).filter(Boolean))];
  if (canonicalPaths.length !== 20 || !canonicalPaths.includes(promotedProduct.image)) {
    throw new Error('Disposable canonical product does not contain the exact 20-photo gallery and explicit cover.');
  }
  const uploadRoot = path.join(isolatedContentRoot, 'public', 'uploads');
  const promotedFiles = [];
  for (const publicPath of canonicalPaths) {
    if (!/^\/uploads\/[a-f0-9]{64}\.(?:jpe?g|png)$/u.test(publicPath)) {
      throw new Error(`Unsafe promoted media path in disposable content: ${publicPath}`);
    }
    const absolute = path.resolve(isolatedContentRoot, 'public', `.${publicPath}`);
    if (!isWithin(path.join(isolatedContentRoot, 'public'), absolute)) {
      throw new Error(`Promoted media escaped disposable public root: ${publicPath}`);
    }
    const bytes = await readFile(absolute);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (path.basename(publicPath).split('.')[0] !== sha256) {
      throw new Error(`Promoted filename/hash mismatch: ${publicPath}`);
    }
    promotedFiles.push({ path: publicPath, bytes: bytes.length, sha256 });
  }
  const unexpectedUploads = (await readdir(uploadRoot)).filter((name) => !canonicalPaths.some((entry) => path.basename(entry) === name));
  if (unexpectedUploads.length) throw new Error(`Disposable media promotion left unexpected files: ${unexpectedUploads.join(', ')}`);
  acceptance.orchestratorEvidence = {
    schemaVersion: 1,
    disposableCanonicalMedia: true,
    productSlug: 'konteynernaya-ploshchadka-modul',
    galleryCount: canonicalPaths.length,
    explicitCover: promotedProduct.image,
    promotedFiles
  };
  const acceptanceContract = validateVisualEditorAcceptanceEvidence(acceptance, { expectedSourceSHA: sourceSHA });
  if (!acceptanceContract.ok) {
    throw new Error(`The visual-editor acceptance evidence contract failed: ${acceptanceContract.issues.join(', ')}`);
  }
  await mkdir(path.dirname(acceptanceOutputPath), { recursive: true });
  await writeFile(acceptanceOutputPath, `${JSON.stringify(acceptance, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    sourceSHA,
    branch,
    output: outputPath,
    acceptanceOutput: acceptanceOutputPath,
    aggregate: report.aggregate,
    acceptanceAggregate: acceptance.aggregate,
    disposable: true,
    releaseActionsExecuted: false
  }, null, 2)}\n`);
} finally {
  await launcher?.stop?.().catch(() => {});
  if (!keepFixture) {
    if (!isWithin(fixtureBase, fixtureRoot)) throw new Error(`Refusing to remove an unexpected fixture path: ${fixtureRoot}`);
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }).catch((error) => {
      process.stderr.write(`[h6-admin-actions] Could not remove disposable fixture: ${error.message}\n`);
    });
  } else {
    process.stderr.write(`[h6-admin-actions] Disposable fixture retained: ${fixtureRoot}\n`);
  }
}

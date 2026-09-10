import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  validateAdminActionEvidence,
  validateEvidenceIdentity,
  validatePublicActionEvidence,
  validateRoutePassportEvidence,
  validateVisualEditorAcceptanceEvidence
} from './evidence-contract.mjs';
import {
  discoverArtifactFiles,
  discoverProductionHtml,
  fingerprintArtifact,
  fingerprintProductionHtml
} from './route-passport-model.mjs';
import { sourceWorkingTreeDirty } from './git-evidence.mjs';
import { validateMediaPrivacyEvidence } from './media-privacy-evidence.mjs';
import { validateBackupRestoreDrillEvidence } from './backup-restore-drill.mjs';
import { validateExactTargetedBuildEvidence } from './exact-targeted-build-evidence.mjs';
import { currentPublicActionInputs, validatePublicActionReuse } from './public-action-cache.mjs';

const root = process.cwd();
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const option = (name, fallback) => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
if (hasFlag('--help') || hasFlag('-h')) {
  process.stdout.write(`Verify H6 machine-readable browser evidence\n\n`);
  process.stdout.write(`  node tools/qa/verify-h6-evidence.mjs --passport=<json> --public-actions=<json> --admin-actions=<json> --visual-acceptance=<json> --media-privacy=<json> --backup-restore=<json> --exact-targeted=<json>\n`);
  process.stdout.write(`  Strict editor and isolated-admin gates are enabled by default.\n`);
  process.stdout.write(`  Developer-only relaxations: --allow-missing-editor-coverage --allow-deferred-admin-actions.\n`);
  process.exit(0);
}
const filenames = {
  passport: path.resolve(root, option('--passport', '.admin-runtime/h6-qa/route-passport.json')),
  publicActions: path.resolve(root, option('--public-actions', '.admin-runtime/h6-qa/public-action-crawl.json')),
  adminActions: path.resolve(root, option('--admin-actions', '.admin-runtime/h6-qa/admin-action-crawl.json')),
  visualAcceptance: path.resolve(root, option('--visual-acceptance', '.admin-runtime/h6-qa/visual-editor-acceptance.json')),
  mediaPrivacy: path.resolve(root, option('--media-privacy', '.admin-runtime/h6-qa/media-privacy-chain.json')),
  backupRestore: path.resolve(root, option('--backup-restore', '.admin-runtime/h6-qa/backup-restore-drill.json')),
  exactTargeted: path.resolve(root, option('--exact-targeted', '.admin-runtime/h6-qa/exact-targeted-build.json'))
};
const distRoot = path.resolve(root, option('--dist', 'dist'));
const readJson = async (filename) => JSON.parse(await readFile(filename, 'utf8'));
const reports = {
  routePassport: await readJson(filenames.passport),
  publicActions: await readJson(filenames.publicActions),
  adminActions: await readJson(filenames.adminActions),
  visualAcceptance: await readJson(filenames.visualAcceptance),
  mediaPrivacy: await readJson(filenames.mediaPrivacy),
  backupRestore: await readJson(filenames.backupRestore),
  exactTargeted: await readJson(filenames.exactTargeted)
};
const git = (...args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); }
  catch { return ''; }
};
const artifactFiles = discoverArtifactFiles(distRoot);
const artifactFingerprint = fingerprintArtifact(distRoot, artifactFiles);
const productionRoutes = discoverProductionHtml(distRoot);
const htmlFingerprint = fingerprintProductionHtml(distRoot, productionRoutes);
const h5Manifest = await readJson(path.join(distRoot, '_media', 'h5', 'manifest.json'));
const currentEvidence = {
  sourceSHA: git('rev-parse', 'HEAD'),
  branch: git('branch', '--show-current') || '(detached)',
  dirty: sourceWorkingTreeDirty(root),
  distFingerprintSHA256: htmlFingerprint.aggregate,
  htmlFileHashes: htmlFingerprint.entries,
  artifactFingerprintSHA256: artifactFingerprint.aggregate,
  artifactFileHashes: artifactFingerprint.entries,
  artifactFileCount: artifactFingerprint.fileCount,
  artifactBytes: artifactFingerprint.totalBytes,
  h5PipelineHash: h5Manifest?.generator?.pipelineHash || ''
};
const requireEditorCoverage = !hasFlag('--allow-missing-editor-coverage');
const requireIsolatedMutations = !hasFlag('--allow-deferred-admin-actions');
let publicActionsReuse = null;
const receiptFile = path.join(root, '.admin-runtime/h6-qa/public-action-reuse.json');
try {
  const receipt = await readJson(receiptFile);
  publicActionsReuse = validatePublicActionReuse(reports.publicActions, receipt,
    await currentPublicActionInputs({ root, distRoot, basePath: reports.routePassport?.evidence?.basePath }),
    { sourceSHA: currentEvidence.sourceSHA, branch: currentEvidence.branch });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const results = {
  routePassport: validateRoutePassportEvidence(reports.routePassport, { requireEditorCoverage }),
  publicActions: validatePublicActionEvidence(reports.publicActions),
  adminActions: validateAdminActionEvidence(reports.adminActions, { requireIsolatedMutations }),
  visualAcceptance: validateVisualEditorAcceptanceEvidence(reports.visualAcceptance, { expectedSourceSHA: currentEvidence.sourceSHA }),
  mediaPrivacy: validateMediaPrivacyEvidence(reports.mediaPrivacy, {
    expectedSourceSHA: currentEvidence.sourceSHA,
    expectedBranch: currentEvidence.branch,
    expectedBasePath: reports.routePassport?.evidence?.basePath,
    expectedPipelineHash: currentEvidence.h5PipelineHash,
    expectedArtifactFingerprint: currentEvidence.artifactFingerprintSHA256,
    expectedArtifactFileCount: currentEvidence.artifactFileCount,
    expectedArtifactBytes: currentEvidence.artifactBytes
  }),
  backupRestore: validateBackupRestoreDrillEvidence(reports.backupRestore, {
    expectedSourceSHA: currentEvidence.sourceSHA,
    expectedBranch: currentEvidence.branch
  }),
  exactTargeted: validateExactTargetedBuildEvidence(reports.exactTargeted, {
    expectedSourceSHA: currentEvidence.sourceSHA,
    expectedBranch: currentEvidence.branch,
    expectedBasePath: reports.routePassport?.evidence?.basePath,
    expectedHtmlFileHashes: currentEvidence.htmlFileHashes,
    expectedRouteCount: productionRoutes.length
  }),
  ...(publicActionsReuse ? { publicActionsReuse } : {}),
  identity: validateEvidenceIdentity(reports, { currentEvidence, publicActionsReuse })
};
const issues = Object.values(results).flatMap((result) => result.issues);
process.stdout.write(`${JSON.stringify({ ok: issues.length === 0, files: filenames, results, issues }, null, 2)}\n`);
if (issues.length) process.exitCode = 1;

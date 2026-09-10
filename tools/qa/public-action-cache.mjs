import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { CdpBrowser } from './cdp-browser.mjs';
import { buildExpectedRouteModel, fingerprintArtifact, discoverArtifactFiles } from './route-passport-model.mjs';
import { validatePublicActionEvidence } from './evidence-contract.mjs';
import { sourceWorkingTreeDirty } from './git-evidence.mjs';

export const PUBLIC_CRAWL_SHARDS = 8;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const publicReportFingerprint = report => digest(JSON.stringify(report));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();

// Follow actual ESM imports, including literal dynamic imports. An admin-only
// helper does not invalidate public evidence unless the public harness uses it.
export function publicHarnessFiles(root, entries = [
  'tools/qa/public-action-crawl.mjs', 'tools/qa/public-action-shards.mjs', 'tools/qa/public-action-cache.mjs'
]) {
  const found = new Set();
  function visit(relative) {
    const absolute = path.resolve(root, relative);
    const normalized = path.relative(root, absolute).replaceAll('\\', '/');
    if (normalized.startsWith('../') || path.isAbsolute(normalized)) throw new Error('QA dependency escapes the checkout.');
    if (found.has(normalized)) return;
    found.add(normalized);
    const source = fs.readFileSync(absolute, 'utf8');
    const tree = ts.createSourceFile(normalized, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function scan(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        specifier = node.arguments[0];
        if (!specifier || !ts.isStringLiteralLike(specifier)) throw new Error(`Untracked dynamic QA import in ${normalized}.`);
      }
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) {
        visit(path.relative(root, path.resolve(path.dirname(absolute), specifier.text)));
      }
      ts.forEachChild(node, scan);
    }
    scan(tree);
  }
  entries.forEach(visit);
  return [...found].sort().map(relative => [relative, digest(fs.readFileSync(path.join(root, relative)))]);
}

export async function currentPublicActionInputs({ root = process.cwd(), distRoot = path.join(root, 'dist'), basePath = process.env.BASE_PATH || '/' } = {}) {
  const browser = await new CdpBrowser().start();
  let chromium;
  try { chromium = await browser.send('Browser.getVersion'); }
  finally { await browser.close(); }
  const artifact = fingerprintArtifact(distRoot, discoverArtifactFiles(distRoot));
  const inputs = {
    schemaVersion: 1,
    basePath: basePath === '/' ? '/' : '/' + basePath.replace(/^\/+|\/+$/gu, ''),
    artifactFingerprintSHA256: artifact.aggregate,
    artifactFileCount: artifact.fileCount,
    artifactBytes: artifact.totalBytes,
    harness: publicHarnessFiles(root),
    dependencies: ['package.json', 'package-lock.json'].map(file => [file, digest(fs.readFileSync(path.join(root, file)))]),
    routes: buildExpectedRouteModel({ root }).routes,
    runtime: {
      node: process.versions.node, platform: process.platform, arch: process.arch,
      image: process.env.ImageVersion || process.env.RUNNER_OS || process.platform,
      chromium
    }
  };
  return { key: digest(JSON.stringify(inputs)), inputs };
}

export function validatePublicActionReuse(report, receipt, current, { sourceSHA, branch, authoritativeRoutes } = {}) {
  const issues = [];
  if (receipt?.schemaVersion !== 1 || receipt?.kind !== 'public-action-input-reuse') issues.push('public-cache:receipt-schema');
  if (!current?.key || receipt?.key !== current.key || !equal(receipt?.inputs, current.inputs)) issues.push('public-cache:changed-inputs');
  if (receipt?.key !== digest(JSON.stringify(receipt?.inputs ?? null))) issues.push('public-cache:input-checksum');
  if (receipt?.reportFingerprint !== publicReportFingerprint(report)) issues.push('public-cache:report-checksum');
  if (!/^[a-f0-9]{40}$/u.test(report?.evidence?.sourceSHA || '') || receipt?.validatedSourceSHA !== report?.evidence?.sourceSHA) issues.push('public-cache:original-source');
  if (receipt?.currentSourceSHA !== sourceSHA || receipt?.branch !== branch || report?.evidence?.branch !== branch) issues.push('public-cache:current-source');
  if (report?.evidence?.dirty || report?.evidence?.artifactFingerprintSHA256 !== current?.inputs?.artifactFingerprintSHA256
    || report?.evidence?.artifactFileCount !== current?.inputs?.artifactFileCount
    || report?.evidence?.artifactBytes !== current?.inputs?.artifactBytes
    || report?.evidence?.basePath !== current?.inputs?.basePath) issues.push('public-cache:artifact-identity');
  if (report?.evidence?.publicActionInputsKey !== current?.key) issues.push('public-cache:executed-inputs');
  issues.push(...validatePublicActionEvidence(report, authoritativeRoutes ? { authoritativeRoutes } : {}).issues);
  return { ...receipt, ok: !issues.length, issues };
}

export function publicActionReceipt(report, current, { sourceSHA, branch }) {
  return { schemaVersion: 1, kind: 'public-action-input-reuse', ...current,
    validatedSourceSHA: report.evidence.sourceSHA, currentSourceSHA: sourceSHA, branch,
    reportFingerprint: publicReportFingerprint(report) };
}

async function main() {
  const root = process.cwd(), command = process.argv[2];
  const directory = path.join(root, '.admin-runtime/h6-qa/public-action-cache');
  const stored = path.join(directory, 'stored');
  const reportFile = path.join(root, '.admin-runtime/h6-qa/public-action-crawl.json');
  const receiptFile = path.join(root, '.admin-runtime/h6-qa/public-action-reuse.json');
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  const output = (name, value) => { console.log(`${name}=${value}`); if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`); };
  if (sourceWorkingTreeDirty(root)) throw new Error('Public evidence cannot be cached or reused from a dirty source checkout.');
  const sourceSHA = git(root, 'rev-parse', 'HEAD'), branch = git(root, 'branch', '--show-current') || '(detached)';
  const current = await currentPublicActionInputs({ root });
  if (command === 'prepare') {
    write(path.join(directory, 'current.json'), current);
    output('cache_key', `public-actions-v1-${current.key}`);
    output('input_key', current.key);
  } else if (command === 'restore') {
    if (!fs.existsSync(path.join(stored, 'report.json')) || !fs.existsSync(path.join(stored, 'inputs.json'))) {
      output('cache_hit', 'false'); return;
    }
    const report = read(path.join(stored, 'report.json')), previous = read(path.join(stored, 'inputs.json'));
    // Keep the original report untouched; only the separate receipt identifies
    // the new release and proves equality of artifact, tests and runtime.
    const receipt = { ...previous, currentSourceSHA: sourceSHA };
    const checked = validatePublicActionReuse(report, receipt, current, { sourceSHA, branch });
    if (!checked.ok) { console.warn(`Cached evidence rejected: ${checked.issues.join(', ')}`); output('cache_hit', 'false'); return; }
    fs.copyFileSync(path.join(stored, 'report.json'), reportFile);
    write(receiptFile, receipt);
    output('cache_hit', 'true');
    console.log(`Reused complete public evidence from ${receipt.validatedSourceSHA}; current release ${sourceSHA}.`);
  } else if (command === 'seal') {
    const report = read(reportFile);
    if (report?.evidence?.sourceSHA !== sourceSHA) throw new Error('A new cache entry must come from this exact commit.');
    const receipt = publicActionReceipt(report, current, { sourceSHA, branch });
    const checked = validatePublicActionReuse(report, receipt, current, { sourceSHA, branch });
    if (!checked.ok) throw new Error(`Public evidence cannot be cached: ${checked.issues.join(', ')}`);
    write(path.join(stored, 'inputs.json'), receipt);
    fs.copyFileSync(reportFile, path.join(stored, 'report.json'));
    write(receiptFile, receipt);
    output('cache_key', `public-actions-v1-${current.key}`);
  } else throw new Error('Expected prepare, restore or seal.');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();

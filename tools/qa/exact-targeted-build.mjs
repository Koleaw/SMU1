import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { runExactSnapshot } from '../admin-api/exact-validation-service.mjs';
import { normalizeExactRoute } from '../admin-api/exact-prerender-integration.mjs';
import { validateExactTargetedBuildEvidence } from './exact-targeted-build-evidence.mjs';
import { sourceWorkingTreeDirty } from './git-evidence.mjs';
import {
  assessDistFreshness,
  buildExpectedRouteModel,
  discoverProductionHtml,
  productionHtmlFilename,
  reconcileRouteSets
} from './route-passport-model.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const argv = process.argv.slice(2);
const option = (name, fallback = '') => argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const output = path.resolve(root, option('--output', '.admin-runtime/h6-qa/exact-targeted-build.json'));
const distRoot = path.resolve(root, option('--dist', 'dist'));
const runtimeRoot = path.join(root, '.admin-runtime', 'h6-exact-targeted-build');
const basePath = (() => {
  const raw = String(option('--base', process.env.BASE_PATH || '/')).trim();
  if (!raw || raw === '/') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('?') || raw.includes('#')
    || raw.split('/').some((part) => part === '.' || part === '..')) throw new Error(`Unsafe exact QA BASE_PATH: ${raw}`);
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
})();

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const normalizeRouteSet = (routes) => [...new Set(routes.map((route) => normalizeExactRoute(route)))].sort((a, b) => a.localeCompare(b, 'en'));

async function fingerprintTree(directory) {
  const rows = [];
  async function visit(current, relative = '') {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`H5 cache contains a symlink: ${nextRelative}`);
      if (entry.isDirectory()) await visit(absolute, nextRelative);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(absolute);
        rows.push([nextRelative, sha256(bytes), bytes.length]);
      } else throw new Error(`H5 cache contains a non-file entry: ${nextRelative}`);
    }
  }
  await visit(directory);
  return {
    algorithm: 'sha256',
    aggregateSha256: sha256(Buffer.from(JSON.stringify(rows), 'utf8')),
    fileCount: rows.length,
    totalBytes: rows.reduce((total, row) => total + row[2], 0)
  };
}

function selectRepresentativeRoutes(routes) {
  const selected = new Map();
  for (const route of routes) {
    const key = `${route.rendererFamily}\0${route.rendererVariant}`;
    if (!selected.has(key)) selected.set(key, route);
  }
  return [...selected.values()].sort((left, right) => left.pathname.localeCompare(right.pathname, 'en'));
}

async function main() {
  const sourceSHA = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true })).stdout.trim();
  const branch = (await execFileAsync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', windowsHide: true })).stdout.trim() || '(detached)';
  if (!/^[a-f0-9]{40}$/u.test(sourceSHA)) throw new Error('Exact targeted QA could not resolve a full source SHA.');
  const dirty = sourceWorkingTreeDirty(root);
  if (dirty) throw new Error('Exact targeted QA requires committed source; generated dist/.astro/runtime files may remain untracked or modified.');

  const model = buildExpectedRouteModel({ root });
  const discovered = discoverProductionHtml(distRoot);
  const reconciliation = reconcileRouteSets(model.routes.map((route) => route.pathname), discovered);
  if (!reconciliation.exact) throw new Error(`Full production build route set is stale: ${JSON.stringify({ missing: reconciliation.missing, unexpected: reconciliation.unexpected })}`);
  const freshness = assessDistFreshness({ root, distRoot });
  if (!freshness.fresh) throw new Error('Full production dist is older than source inputs. Run npm run build immediately before exact targeted QA.');

  const representatives = selectRepresentativeRoutes(model.routes);
  const removedRoute = '/__h6-exact-removed-route__/';
  const expectations = [
    ...representatives.map((route) => ({ route: route.pathname, expected: 'html' })),
    { route: removedRoute, expected: 'not-found' }
  ];
  const expectedSelectedRoutes = normalizeRouteSet([
    ...representatives.map((route) => route.pathname),
    '/404.html'
  ]);
  const expectedTargetedHtmlRoutes = normalizeRouteSet(expectedSelectedRoutes);
  const runId = `exact-${crypto.randomBytes(16).toString('hex')}`;
  const transactionId = `qa-${sourceSHA.slice(0, 12)}`;
  const snapshotRoot = path.join(runtimeRoot, 'snapshots', runId);
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(snapshotRoot, { recursive: true });
  const h5Root = path.join(root, 'public', '_media', 'h5');
  const beforeH5 = await fingerprintTree(h5Root);
  let exact;
  const exactStartedAt = new Date();
  const exactStarted = performance.now();
  try {
    exact = await runExactSnapshot({
      repoRoot: root,
      runtimeDir: runtimeRoot,
      snapshot: {
        runId,
        transactionId,
        sourceSha: sourceSHA,
        files: [],
        affectedRoutes: expectations.map((item) => item.route),
        routeExpectations: expectations,
        snapshotRoot
      },
      environment: {
        ...process.env,
        BASE_PATH: basePath,
        TEST_BASE_PATH: basePath,
        TEST_SITE_URL: process.env.TEST_SITE_URL || 'http://127.0.0.1'
      }
    });
  } finally {
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
  const afterH5 = await fingerprintTree(h5Root);
  const checks = new Map(exact.diagnostics.routeChecks.map((item) => [item.route, item]));
  const comparisons = [];
  for (const expectation of expectations) {
    const check = checks.get(expectation.route);
    if (!check) throw new Error(`Exact runner omitted route check: ${expectation.route}`);
    if (expectation.expected === 'not-found') {
      const full404 = await fs.readFile(productionHtmlFilename(distRoot, '/404.html'));
      const fallback404ByteIdentical = check.fallback404Sha256 === sha256(full404) && check.fallback404Bytes === full404.length;
      comparisons.push({
        route: expectation.route,
        expected: expectation.expected,
        routeAbsent: check.routeExists === false,
        fallback404ByteIdentical,
        fullSha256: sha256(full404),
        targetedSha256: check.fallback404Sha256,
        status: check.routeExists === false && fallback404ByteIdentical ? 'byte-identical' : 'fail'
      });
      continue;
    }
    const fullBytes = await fs.readFile(productionHtmlFilename(distRoot, expectation.route));
    const identical = check.routeSha256 === sha256(fullBytes) && check.routeBytes === fullBytes.length;
    comparisons.push({
      route: expectation.route,
      expected: expectation.expected,
      fullSha256: sha256(fullBytes),
      targetedSha256: check.routeSha256,
      bytes: fullBytes.length,
      status: identical ? 'byte-identical' : 'fail'
    });
  }
  const report = {
    schemaVersion: 1,
    kind: 'smu1-h6-exact-targeted-build',
    status: 'pass',
    sourceSHA,
    branch,
    dirty,
    basePath,
    generatedAt: new Date().toISOString(),
    fullBuild: {
      routeSetExact: reconciliation.exact,
      routeCount: reconciliation.expected.length,
      freshness
    },
    selection: {
      expectations,
      expectedSelectedRoutes,
      expectedTargetedHtmlRoutes,
      rendererFamilies: [...new Set(representatives.map((route) => route.rendererFamily))].sort(),
      rendererVariants: [...new Set(representatives.map((route) => route.rendererVariant))].sort()
    },
    runner: {
      mode: exact.diagnostics.mode,
      startedAt: exactStartedAt.toISOString(),
      durationMs: Math.round((performance.now() - exactStarted) * 100) / 100,
      artifact: exact.artifact,
      prerender: exact.diagnostics.prerender,
      targetedHtmlRoutes: normalizeRouteSet(exact.diagnostics.targetedHtmlRoutes),
      mediaCache: exact.diagnostics.mediaCache
    },
    comparisons,
    h5SourceCache: {
      before: beforeH5,
      after: afterH5,
      unchanged: JSON.stringify(beforeH5) === JSON.stringify(afterH5)
    }
  };
  const validation = validateExactTargetedBuildEvidence(report, {
    expectedSourceSHA: sourceSHA,
    expectedBranch: branch,
    expectedBasePath: basePath,
    expectedRouteCount: model.routes.length
  });
  if (!validation.ok) throw new Error(`Exact targeted build evidence failed: ${validation.issues.join(', ')}`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(temporary, output);
  process.stdout.write(`${JSON.stringify({ ok: true, output, routes: comparisons.length, rendererVariants: report.selection.rendererVariants.length, h5Files: beforeH5.fileCount }, null, 2)}\n`);
}

await main();

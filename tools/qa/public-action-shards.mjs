import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC_LIFECYCLE_SEMANTIC_IDS } from './evidence-contract.mjs';
import { REQUIRED_VIEWPORTS, REAL_UNKNOWN_ROUTE } from './route-passport-model.mjs';

const exactJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const pairKey = (route, viewport) => `${route}\u0000${viewport}`;

export function parsePublicActionShard(value) {
  if (!value) return null;
  const match = /^(\d+)\/(\d+)$/u.exec(String(value).trim());
  if (!match) throw new Error('--shard must use the 1-based <index>/<total> form, for example --shard=2/4.');
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || total < 2 || total > 16 || index < 1 || index > total) {
    throw new Error('--shard requires 1 <= index <= total and 2 <= total <= 16.');
  }
  return Object.freeze({ index, total });
}

export function routesForPublicActionShard(routes, shard) {
  if (!shard) return routes;
  return routes.filter((_, routeIndex) => routeIndex % shard.total === shard.index - 1);
}

const requireSame = (reports, selector, label) => {
  const expected = selector(reports[0]);
  for (const [reportIndex, report] of reports.entries()) {
    if (!exactJson(selector(report), expected)) throw new Error(`Shard ${reportIndex + 1} disagrees on ${label}.`);
  }
  return expected;
};

const requireExactKeys = (actualItems, expectedKeys, keyOf, label) => {
  const expected = new Set(expectedKeys);
  const seen = new Set();
  for (const item of actualItems) {
    const key = keyOf(item);
    if (!expected.has(key)) throw new Error(`${label} contains unexpected item ${key}.`);
    if (seen.has(key)) throw new Error(`${label} contains duplicate item ${key}.`);
    seen.add(key);
  }
  for (const key of expected) if (!seen.has(key)) throw new Error(`${label} is missing ${key}.`);
};

export function mergePublicActionShards(reports, {
  generatedAt = new Date().toISOString(),
  sourceFiles = []
} = {}) {
  if (!Array.isArray(reports) || reports.length < 2) throw new Error('At least two public action shard reports are required.');
  if (reports.some((report) => report?.schemaVersion !== 1)) throw new Error('Every public action shard must use schemaVersion 1.');
  const sourceFileByReport = new Map(reports.map((report, index) => [report, sourceFiles[index] || null]));

  const total = reports[0]?.manifest?.shard?.total;
  if (!Number.isSafeInteger(total) || total < 2 || reports.length !== total) {
    throw new Error(`Expected exactly ${total || '?'} shard reports, received ${reports.length}.`);
  }
  const byIndex = new Map();
  for (const report of reports) {
    const shard = report?.manifest?.shard;
    if (shard?.total !== total || !Number.isSafeInteger(shard?.index) || shard.index < 1 || shard.index > total) {
      throw new Error('Shard index/total metadata is invalid or inconsistent.');
    }
    if (byIndex.has(shard.index)) throw new Error(`Duplicate public action shard index ${shard.index}/${total}.`);
    byIndex.set(shard.index, report);
  }
  const ordered = Array.from({ length: total }, (_, index) => byIndex.get(index + 1));
  if (ordered.some((report) => !report)) throw new Error('Public action shard indexes are not a complete 1..total sequence.');

  const expected = requireSame(ordered, (report) => report.manifest?.expected, 'authoritative expected routes');
  const discovered = requireSame(ordered, (report) => report.manifest?.discovered, 'emitted routes');
  if (!Array.isArray(expected) || !expected.length || !exactJson(expected, discovered)) throw new Error('Shard manifests are not an exact emitted route set.');
  if (ordered.some((report) => report.manifest?.exact !== true || report.manifest?.developmentFilter)) {
    throw new Error('A development-filtered or non-exact report cannot become release evidence.');
  }

  for (const [zeroIndex, report] of ordered.entries()) {
    const shard = report.manifest.shard;
    const deterministicRoutes = expected.filter((_, routeIndex) => routeIndex % total === zeroIndex);
    if (!exactJson(shard.assignedRoutes, deterministicRoutes)) {
      throw new Error(`Shard ${shard.index}/${total} does not contain its deterministic concrete route partition.`);
    }
    if (Boolean(shard.ownsUnknownProbe) !== (shard.index === 1)) {
      throw new Error(`Shard ${shard.index}/${total} has invalid unknown-probe ownership.`);
    }
    const routeKeys = deterministicRoutes.flatMap((route) => REQUIRED_VIEWPORTS.map((viewport) => pairKey(route, viewport.id)));
    requireExactKeys(report.routeResults || [], routeKeys, (result) => pairKey(result.route, result.viewport?.id), `shard ${shard.index} route results`);
    requireExactKeys(report.noJsResults || [], deterministicRoutes, (result) => result.route, `shard ${shard.index} no-JS results`);
    const lifecycleIds = [
      ...(deterministicRoutes.includes('/') ? ['home-video', 'cookie-notice'] : []),
      ...(deterministicRoutes.includes('/kontakty/') ? ['contacts-map'] : [])
    ];
    requireExactKeys(report.publicLifecycleSemantics || [], lifecycleIds, (result) => result.id, `shard ${shard.index} public lifecycle semantics`);
  }

  const identityFields = [
    ['public QA input identity', (report) => report.evidence?.publicActionInputsKey],
    ['source SHA', (report) => report.evidence?.sourceSHA],
    ['branch', (report) => report.evidence?.branch],
    ['source dirty state', (report) => report.evidence?.dirty],
    ['base path', (report) => report.evidence?.basePath],
    ['dist freshness', (report) => report.evidence?.distFreshness],
    ['production HTML fingerprint', (report) => [report.evidence?.distFingerprintSHA256, report.evidence?.htmlFileHashes]],
    ['full artifact fingerprint', (report) => [report.evidence?.artifactFingerprintSHA256, report.evidence?.artifactFileHashes]],
    ['artifact size', (report) => [report.evidence?.artifactFileCount, report.evidence?.artifactBytes]],
    ['artifact isolation', (report) => report.evidence?.artifactIsolation],
    ['emulation', (report) => report.evidence?.emulation],
    ['safety boundary', (report) => report.evidence?.analyticsAndLeadSubmissionBlocked]
  ];
  for (const [label, selector] of identityFields) requireSame(ordered, selector, label);
  if (ordered.some((report) => report.evidence?.browserSafety?.mode !== 'public-read-only')) {
    throw new Error('Every shard must use the public-read-only browser safety boundary.');
  }

  const routeResults = ordered.flatMap((report) => report.routeResults || []);
  const noJsResults = ordered.flatMap((report) => report.noJsResults || []);
  const publicLifecycleSemantics = ordered.flatMap((report) => report.publicLifecycleSemantics || []);
  const routeOrder = new Map(expected.map((route, index) => [route, index]));
  const viewportOrder = new Map(REQUIRED_VIEWPORTS.map((viewport, index) => [viewport.id, index]));
  routeResults.sort((left, right) => (routeOrder.get(left.route) - routeOrder.get(right.route))
    || (viewportOrder.get(left.viewport?.id) - viewportOrder.get(right.viewport?.id)));
  noJsResults.sort((left, right) => routeOrder.get(left.route) - routeOrder.get(right.route));

  const expectedPairs = expected.flatMap((route) => REQUIRED_VIEWPORTS.map((viewport) => pairKey(route, viewport.id)));
  requireExactKeys(routeResults, expectedPairs, (result) => pairKey(result.route, result.viewport?.id), 'merged route results');
  requireExactKeys(noJsResults, expected, (result) => result.route, 'merged no-JS results');
  const requiredLifecycleIds = PUBLIC_LIFECYCLE_SEMANTIC_IDS.filter((id) => id === 'contacts-map'
    ? expected.includes('/kontakty/')
    : expected.includes('/'));
  requireExactKeys(publicLifecycleSemantics, requiredLifecycleIds, (result) => result.id, 'merged public lifecycle semantics');
  publicLifecycleSemantics.sort((left, right) => PUBLIC_LIFECYCLE_SEMANTIC_IDS.indexOf(left.id) - PUBLIC_LIFECYCLE_SEMANTIC_IDS.indexOf(right.id));

  const unknownResults = ordered.flatMap((report) => report.unknownResults || []);
  requireExactKeys(
    unknownResults,
    REQUIRED_VIEWPORTS.map((viewport) => pairKey(REAL_UNKNOWN_ROUTE, viewport.id)),
    (result) => pairKey(result.route, result.viewport?.id),
    'unknown URL results'
  );
  const unknownNoJs = ordered.map((report) => report.unknownNoJsResult).filter(Boolean);
  if (unknownNoJs.length !== 1 || unknownNoJs[0].route !== REAL_UNKNOWN_ROUTE) {
    throw new Error('Exactly one real-unknown no-JS result owned by shard 1 is required.');
  }

  const first = ordered[0];
  const failedRoutes = routeResults.filter((result) => result.status === 'fail').length;
  const failedNoJs = noJsResults.filter((result) => result.status === 'fail').length;
  const intercepted = ordered.flatMap((report) => report.evidence?.browserSafety?.intercepted || []);
  const navigationDialogs = ordered.flatMap((report) => report.evidence?.browserSafety?.navigationDialogs || []);
  const workerDialogAudits = ordered.map((report, index) => {
    const observedCount = (report.evidence?.browserSafety?.navigationDialogs || []).length;
    const reportedCount = Number(report.evidence?.dialogAudit?.unexpectedCount || 0);
    const finalDrainPassed = report.evidence?.dialogAudit?.finalDrainPassed === true;
    return {
      index: index + 1,
      finalDrainPassed,
      unexpectedCount: observedCount,
      passed: report.evidence?.dialogAudit?.passed === true
        && finalDrainPassed
        && reportedCount === observedCount
        && observedCount === 0
    };
  });
  const dialogAudit = {
    workers: workerDialogAudits,
    finalDrainPassed: workerDialogAudits.every((audit) => audit.finalDrainPassed),
    unexpectedCount: navigationDialogs.length,
    passed: workerDialogAudits.every((audit) => audit.passed) && navigationDialogs.length === 0
  };
  const shardEvidence = ordered.map((report, index) => ({
    index: index + 1,
    total,
    sourceFile: sourceFileByReport.get(report),
    generatedAt: report.generatedAt,
    origin: report.evidence?.origin,
    assignedRoutes: report.manifest.shard.assignedRoutes.length,
    routeViewportPairs: report.routeResults?.length || 0,
    noJsRoutes: report.noJsResults?.length || 0
  }));

  return {
    schemaVersion: 1,
    generatedAt,
    evidence: {
      ...first.evidence,
      origin: 'multiple isolated loopback workers',
      shardOrigins: shardEvidence.map((item) => item.origin),
      shards: shardEvidence,
      browserSafety: {
        ...first.evidence.browserSafety,
        mode: 'public-read-only',
        intercepted,
        navigationDialogs,
        workers: shardEvidence.map((item) => ({ index: item.index, origin: item.origin }))
      },
      dialogAudit,
      analyticsAndLeadSubmissionBlocked: ordered.every((report) => report.evidence?.analyticsAndLeadSubmissionBlocked === true)
    },
    manifest: {
      ...first.manifest,
      expected,
      discovered,
      exact: true,
      expectedCount: expected.length,
      openedRouteViewportPairs: routeResults.length,
      requiredRouteViewportPairs: expectedPairs.length,
      concreteCoverage: true,
      developmentFilter: null,
      shard: null,
      mergedShards: { total, indexes: shardEvidence.map((item) => item.index) }
    },
    routeResults,
    noJsResults,
    publicLifecycleSemantics,
    publicSearchSemantics: ordered.map((report) => ({ shard: report.manifest.shard.index, viewports: report.publicSearchSemantics || {} })),
    unknownResults,
    unknownNoJsResult: unknownNoJs[0],
    aggregate: {
      routeViewportsPassed: routeResults.length - failedRoutes,
      routeViewportsFailed: failedRoutes,
      actionOccurrences: routeResults.reduce((count, result) => count + (result.actionCount || 0), 0),
      safeExecutions: routeResults.reduce((count, result) => count + (result.actionResults || [])
        .reduce((totalExecutions, action) => totalExecutions + (action.executions?.length || 0), 0), 0),
      gallerySemanticOccurrences: routeResults.reduce((count, result) => count + (result.gallerySemantics?.results?.length || 0), 0),
      gallerySemanticPassed: routeResults.reduce((count, result) => count + (result.gallerySemantics?.results || []).filter((item) => item.status === 'pass').length, 0),
      gallerySemanticFailed: routeResults.reduce((count, result) => count + (result.gallerySemantics?.results || []).filter((item) => item.status === 'fail').length, 0),
      lifecycleSemanticOccurrences: publicLifecycleSemantics.length,
      lifecycleSemanticsPassed: publicLifecycleSemantics.filter((item) => item.status === 'pass').length,
      lifecycleSemanticsFailed: publicLifecycleSemantics.filter((item) => item.status === 'fail').length,
      protectedLeadOrFileActions: routeResults.reduce((count, result) => count + (result.actionResults || [])
        .filter((action) => action.policy === 'protected-form-action').length, 0),
      unknownViewportsPassed: unknownResults.filter((result) => result.status === 'pass').length,
      unknownViewportsFailed: unknownResults.filter((result) => result.status === 'fail').length,
      unknownNoJsPassed: unknownNoJs[0].status === 'pass',
      publicArtifactIsolation: first.evidence?.artifactIsolation?.clean === true,
      publicArtifactLeaks: first.evidence?.artifactIsolation?.leaks?.length || 0,
      unexpectedNavigationDialogs: navigationDialogs.length,
      dialogDrainPassed: dialogAudit.finalDrainPassed,
      noJsPassed: noJsResults.length - failedNoJs,
      noJsFailed: failedNoJs,
      noJsRequired: expected.length
    }
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Merge a complete deterministic H6 public action crawl shard set.\n\n');
    process.stdout.write('  node tools/qa/public-action-shards.mjs --input=shard-1.json --input=shard-2.json --output=public-action-crawl.json\n');
    return;
  }
  const root = process.cwd();
  const inputs = argv.filter((value) => value.startsWith('--input=')).map((value) => path.resolve(root, value.slice('--input='.length)));
  const outputArg = argv.find((value) => value.startsWith('--output='))?.slice('--output='.length)
    || '.admin-runtime/h6-qa/public-action-crawl.json';
  const output = path.resolve(root, outputArg);
  const reports = await Promise.all(inputs.map(async (filename) => JSON.parse(await readFile(filename, 'utf8'))));
  const merged = mergePublicActionShards(reports, {
    sourceFiles: inputs.map((filename) => path.relative(root, filename).replaceAll('\\', '/'))
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output, manifest: merged.manifest, aggregate: merged.aggregate }, null, 2)}\n`);
  if (merged.evidence?.dialogAudit?.passed !== true) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}

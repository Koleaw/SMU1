import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePublicActionEvidence } from './evidence-contract.mjs';
import {
  mergePublicActionShards,
  parsePublicActionShard,
  routesForPublicActionShard
} from './public-action-shards.mjs';
import { REQUIRED_VIEWPORTS, REAL_UNKNOWN_ROUTE } from './route-passport-model.mjs';

const routes = ['/first/', '/second/'];
const baseEvidence = {
  sourceSHA: 'abc123',
  branch: 'candidate',
  dirty: false,
  origin: 'http://127.0.0.1:40001',
  basePath: '/',
  browserSafety: { mode: 'public-read-only', intercepted: [] },
  emulation: { reducedMotion: true, deviceScaleFactor: 1 },
  analyticsAndLeadSubmissionBlocked: true,
  distFreshness: { fresh: true },
  distFingerprintSHA256: 'html-fingerprint',
  htmlFileHashes: routes.map((route) => [route, `hash-${route}`]),
  artifactFingerprintSHA256: 'a'.repeat(64),
  artifactFileHashes: [['index.html', 'b'.repeat(64), 10]],
  artifactFileCount: 1,
  artifactBytes: 10,
  artifactIsolation: { clean: true, leaks: [] }
};

const routeResult = (route, viewport) => ({
  route,
  viewport,
  status: 'pass',
  pageIdentity: { h1: [route], bodyTextLength: 10, frameworkOverlay: false },
  actionCount: 0,
  actionResults: [],
  events: [],
  issues: []
});
const noJsResult = (route) => ({
  route,
  viewport: REQUIRED_VIEWPORTS[0],
  documentStatus: 200,
  snapshot: { h1: [route], overflow: 0 },
  events: [],
  issues: [],
  status: 'pass'
});
const unknownResult = (viewport) => ({
  route: REAL_UNKNOWN_ROUTE,
  viewport,
  documentStatus: 404,
  status: 'pass',
  pageIdentity: { h1: ['Не найдено'], bodyTextLength: 10, robots: 'noindex', overflow: 0 },
  actionCount: 0,
  actionResults: [],
  events: [],
  issues: []
});

const shardReport = (index) => {
  const assignedRoutes = routesForPublicActionShard(routes, { index, total: 2 });
  return {
    schemaVersion: 1,
    generatedAt: `2026-01-0${index}T00:00:00.000Z`,
    evidence: { ...structuredClone(baseEvidence), origin: `http://127.0.0.1:4000${index}` },
    manifest: {
      expected: routes,
      discovered: routes,
      missing: [],
      unexpected: [],
      exact: true,
      expectedCount: routes.length,
      openedRouteViewportPairs: assignedRoutes.length * REQUIRED_VIEWPORTS.length,
      requiredRouteViewportPairs: routes.length * REQUIRED_VIEWPORTS.length,
      concreteCoverage: false,
      developmentFilter: null,
      shard: { index, total: 2, assignedRoutes, ownsUnknownProbe: index === 1 }
    },
    routeResults: assignedRoutes.flatMap((route) => REQUIRED_VIEWPORTS.map((viewport) => routeResult(route, viewport))),
    noJsResults: assignedRoutes.map(noJsResult),
    unknownResults: index === 1 ? REQUIRED_VIEWPORTS.map(unknownResult) : [],
    unknownNoJsResult: index === 1 ? {
      route: REAL_UNKNOWN_ROUTE,
      documentStatus: 404,
      status: 'pass',
      snapshot: { h1: ['Не найдено'], robots: 'noindex', overflow: 0 },
      events: [],
      issues: []
    } : null
  };
};

test('public action shard syntax and deterministic partitions are strict', () => {
  assert.deepEqual(parsePublicActionShard('2/4'), { index: 2, total: 4 });
  assert.deepEqual(routesForPublicActionShard(['a', 'b', 'c', 'd', 'e'], { index: 2, total: 2 }), ['b', 'd']);
  assert.throws(() => parsePublicActionShard('0/4'), /1 <= index/u);
  assert.throws(() => parsePublicActionShard('2-of-4'), /<index>\/<total>/u);
});

test('merger accepts only a complete concrete shard set and produces verifier-compatible evidence', () => {
  const reports = [shardReport(1), shardReport(2)];
  const merged = mergePublicActionShards([reports[1], reports[0]], {
    generatedAt: '2026-01-03T00:00:00.000Z',
    sourceFiles: ['shard-2.json', 'shard-1.json']
  });
  assert.equal(merged.manifest.concreteCoverage, true);
  assert.equal(merged.manifest.openedRouteViewportPairs, 4);
  assert.deepEqual(merged.routeResults.map((result) => [result.route, result.viewport.id]), [
    ['/first/', 'desktop-1440x900'], ['/first/', 'mobile-390x844'],
    ['/second/', 'desktop-1440x900'], ['/second/', 'mobile-390x844']
  ]);
  assert.equal(merged.evidence.shards.length, 2);
  assert.deepEqual(merged.evidence.shards.map((item) => item.sourceFile), ['shard-1.json', 'shard-2.json']);
  assert.equal(validatePublicActionEvidence(merged, { authoritativeRoutes: routes }).ok, true);

  assert.throws(() => mergePublicActionShards([reports[0], structuredClone(reports[0])]), /Duplicate public action shard/u);
  const missingPair = structuredClone(reports);
  missingPair[1].routeResults.pop();
  assert.throws(() => mergePublicActionShards(missingPair), /route results is missing/u);
  const wrongArtifact = structuredClone(reports);
  wrongArtifact[1].evidence.artifactFingerprintSHA256 = 'c'.repeat(64);
  assert.throws(() => mergePublicActionShards(wrongArtifact), /full artifact fingerprint/u);
});

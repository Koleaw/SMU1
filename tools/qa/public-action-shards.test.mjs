import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePublicActionEvidence } from './evidence-contract.mjs';
import {
  mergePublicActionShards,
  parsePublicActionShard,
  routesForPublicActionShard
} from './public-action-shards.mjs';
import { REQUIRED_VIEWPORTS, REAL_UNKNOWN_ROUTE } from './route-passport-model.mjs';

const routes = ['/', '/kontakty/'];
const baseEvidence = {
  sourceSHA: 'abc123',
  branch: 'candidate',
  dirty: false,
  origin: 'http://127.0.0.1:40001',
  basePath: '/',
  browserSafety: { mode: 'public-read-only', intercepted: [], navigationDialogs: [] },
  dialogAudit: { finalDrainPassed: true, unexpectedCount: 0, passed: true },
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
  pageIdentity: { h1: [route], bodyTextLength: 10, frameworkOverlay: false, galleryInventory: { product: [], project: [] } },
  actionCount: 1,
  actionResults: [{
    action: { id: `${route}-link`, visible: true, disabled: false },
    policy: 'internal-link-action',
    status: 'pass',
    executions: [
      { mode: 'click', status: 'pass', routeMatches: true, anchorMatches: true },
      { mode: 'keyboard-enter', status: 'pass', routeMatches: true, anchorMatches: true }
    ],
    link: { status: 'pass' }
  }],
  gallerySemantics: { inventory: { product: [], project: [] }, results: [] },
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
  actionCount: 1,
  actionResults: [{
    action: { id: 'unknown-link', visible: true, disabled: false }, policy: 'internal-link-action', status: 'pass',
    executions: [{ mode: 'click', status: 'pass' }, { mode: 'keyboard-enter', status: 'pass' }]
  }],
  gallerySemantics: { inventory: { product: [], project: [] }, results: [] },
  events: [],
  issues: []
});
const lifecycleResult = (id) => {
  const common = {
    id,
    route: id === 'contacts-map' ? '/kontakty/' : '/',
    status: 'pass',
    issues: [],
    events: [],
    safety: { stateChangingRequests: 0, leadOrAnalyticsRequests: 0, interceptedAttempts: 0 }
  };
  if (id === 'home-video') return {
    ...common,
    evidence: {
      normalMotion: {
        reducedMotion: false, saveData: false, controlReady: true, sourceLoaded: true, videoRequestCount: 1,
        playingBeforePause: true, pausedAfterPause: true, playingAfterResume: true,
        labelAfterPause: 'Включить видео', labelAfterResume: 'Пауза видео',
        ariaAfterPause: 'Включить фоновое видео', ariaAfterResume: 'Приостановить фоновое видео'
      },
      reducedMotion: { reducedMotion: true, saveData: false, controlReady: true, sourceLoaded: false, videoRequestCount: 0,
          explicitPlayback: { controlReady: true, sourceLoaded: true, videoRequestCount: 1, playing: true,
            startTime: 0, advancedTime: 0.25, pausedAfterPause: true, pausedTime: 0.3, settledPauseTime: 0.3,
            labelAfterPause: 'Включить видео', ariaAfterPause: 'Включить фоновое видео' } },
      saveData: { reducedMotion: false, saveData: true, controlReady: true, sourceLoaded: false, videoRequestCount: 0,
          explicitPlayback: { controlReady: true, sourceLoaded: true, videoRequestCount: 1, playing: true,
            startTime: 0, advancedTime: 0.25, pausedAfterPause: true, pausedTime: 0.3, settledPauseTime: 0.3,
            labelAfterPause: 'Включить видео', ariaAfterPause: 'Включить фоновое видео' } }
    }
  };
  if (id === 'cookie-notice') return {
    ...common,
    evidence: {
      initial: { visible: true, noticeKey: null, legacyKey: null },
      dismissed: { hidden: true, noticeKey: 'true' },
      persistedReload: { hidden: true, noticeKey: 'true' },
      footerReopen: { visible: true, noticeKey: null, legacyKey: null }
    }
  };
  return {
    ...common,
    evidence: {
      before: { state: 'idle', iframeCount: 0, placeholderVisible: true, activateEnabled: true },
      activation: { clicked: true },
      terminal: {
        state: 'error', iframeCount: 0, placeholderVisible: true, activateEnabled: true,
        statusText: 'Карту не удалось загрузить. Используйте ссылку ниже.',
        iframeTitle: '', iframeTabIndex: '', focusTarget: 'activate'
      }
    }
  };
};

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
    publicLifecycleSemantics: [
      ...(assignedRoutes.includes('/') ? [lifecycleResult('home-video'), lifecycleResult('cookie-notice')] : []),
      ...(assignedRoutes.includes('/kontakty/') ? [lifecycleResult('contacts-map')] : [])
    ],
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
    ['/', 'desktop-1440x900'], ['/', 'mobile-390x844'],
    ['/kontakty/', 'desktop-1440x900'], ['/kontakty/', 'mobile-390x844']
  ]);
  assert.deepEqual(merged.publicLifecycleSemantics.map((result) => result.id), ['home-video', 'cookie-notice', 'contacts-map']);
  assert.equal(merged.evidence.shards.length, 2);
  assert.deepEqual(merged.evidence.shards.map((item) => item.sourceFile), ['shard-1.json', 'shard-2.json']);
  assert.deepEqual(merged.evidence.browserSafety.navigationDialogs, []);
  assert.deepEqual(merged.evidence.dialogAudit, {
    workers: [
      { index: 1, finalDrainPassed: true, unexpectedCount: 0, passed: true },
      { index: 2, finalDrainPassed: true, unexpectedCount: 0, passed: true }
    ],
    finalDrainPassed: true,
    unexpectedCount: 0,
    passed: true
  });
  assert.equal(validatePublicActionEvidence(merged, { authoritativeRoutes: routes }).ok, true);
  const brokenMapTerminal = structuredClone(merged);
  brokenMapTerminal.publicLifecycleSemantics.find((result) => result.id === 'contacts-map').evidence.terminal.focusTarget = 'other';
  assert.match(validatePublicActionEvidence(brokenMapTerminal, { authoritativeRoutes: routes }).issues.join('\n'), /lifecycle-map-terminal/u);

  assert.throws(() => mergePublicActionShards([reports[0], structuredClone(reports[0])]), /Duplicate public action shard/u);
  const missingPair = structuredClone(reports);
  missingPair[1].routeResults.pop();
  assert.throws(() => mergePublicActionShards(missingPair), /route results is missing/u);
  const wrongArtifact = structuredClone(reports);
  wrongArtifact[1].evidence.artifactFingerprintSHA256 = 'c'.repeat(64);
  assert.throws(() => mergePublicActionShards(wrongArtifact), /full artifact fingerprint/u);
  const missingLifecycle = structuredClone(reports);
  missingLifecycle[0].publicLifecycleSemantics.pop();
  assert.throws(() => mergePublicActionShards(missingLifecycle), /public lifecycle semantics is missing/u);

  const dialogReports = structuredClone(reports);
  dialogReports[0].evidence.browserSafety.navigationDialogs.push({ type: 'alert', accepted: false, reason: 'unexpected-navigation-dialog' });
  dialogReports[0].evidence.dialogAudit = { finalDrainPassed: true, unexpectedCount: 1, passed: false };
  dialogReports[1].evidence.browserSafety.navigationDialogs.push({ type: 'confirm', accepted: false, reason: 'unexpected-navigation-dialog' });
  dialogReports[1].evidence.dialogAudit = { finalDrainPassed: true, unexpectedCount: 1, passed: false };
  const dialogMerged = mergePublicActionShards(dialogReports);
  assert.deepEqual(dialogMerged.evidence.browserSafety.navigationDialogs.map((dialog) => dialog.type), ['alert', 'confirm']);
  assert.equal(dialogMerged.evidence.dialogAudit.unexpectedCount, 2);
  assert.equal(dialogMerged.evidence.dialogAudit.passed, false);
  assert.equal(dialogMerged.aggregate.unexpectedNavigationDialogs, 2);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAdminActionEvidence,
  validateEvidenceIdentity,
  validatePublicActionEvidence,
  validateRoutePassportEvidence,
  validateVisualEditorAcceptanceEvidence
} from './evidence-contract.mjs';
import { REQUIRED_VIEWPORTS, REAL_UNKNOWN_ROUTE } from './route-passport-model.mjs';

test('route evidence contract rejects by-analogy coverage and accepts concrete pairs only', () => {
  const route = '/';
  const baseResult = (viewport) => ({
    route, viewport, routeClass: 'canonical', status: 'pass', requestedDocumentStatus: 200, finalDocumentStatus: 200, h1: ['Главная'],
    renderer: { family: 'home', actualVariant: 'home-final' },
    visibleSections: [], media: [], backgroundMedia: [], galleries: [], interactions: [], businessOccurrences: [], sourceOwners: [], publicAssets: [], expectedTools: [],
    diagnostics: { events: [], localMedia: [], resourceRequests: [], adminAssetLeaks: [] },
    editor: {
      status: 'covered', occurrences: [], mediaOccurrences: [], invalidBindings: [], bindingMultiplicity: [],
      occurrenceCoverage: { unclassified: 0, ambiguous: 0 },
      mediaCoverage: { unclassified: 0, ambiguous: 0 },
      toolCoverage: { missing: [] },
      equivalence: { status: 'pass', issues: [] }, events: []
    }
  });
  const report = {
    schemaVersion: 1,
    evidence: {
      sourceSHA: 'abc123', branch: 'candidate', dirty: false,
      distFreshness: { fresh: true }, distFingerprintSHA256: 'artifact123',
      artifactFingerprintSHA256: 'a'.repeat(64), artifactFileHashes: [['index.html', 'page123', 10]], artifactIsolation: { clean: true, leaks: [] },
      browserSafety: { mode: 'public-read-only', intercepted: [] }
    },
    manifest: { exact: true, expected: [route], discovered: [route], concreteCoverage: true },
    routeResults: REQUIRED_VIEWPORTS.map(baseResult),
    unknownResults: REQUIRED_VIEWPORTS.map((viewport) => ({
      route: REAL_UNKNOWN_ROUTE, viewport, status: 'pass', documentStatus: 404, h1: ['Не найдено'], robots: 'noindex',
      renderer: { actualFamily: 'not-found', actualVariant: '404' }, visibleSections: [], media: [], backgroundMedia: [], galleries: [],
      interactions: [], businessOccurrences: [], publicAssets: [], sourceOwners: [],
      diagnostics: { events: [], localMedia: [], resourceRequests: [], adminAssetLeaks: [], horizontalOverflow: 0, brokenImages: [] },
      editor: {
        status: 'covered', invalidBindings: [], bindingMultiplicity: [], occurrenceCoverage: { unclassified: 0 }, mediaCoverage: { unclassified: 0 },
        toolCoverage: { missing: [] }, equivalence: { status: 'pass', issues: [] }
      }
    }))
  };
  assert.equal(validateRoutePassportEvidence(report, { requireEditorCoverage: true, authoritativeRoutes: [route] }).ok, true);
  report.routeResults[0].editor.bindingMultiplicity = [{ bindingId: 'duplicate', count: 2 }];
  assert.match(validateRoutePassportEvidence(report, { requireEditorCoverage: true, authoritativeRoutes: [route] }).issues.join('\n'), /duplicate-binding-ids/u);
  report.routeResults[0].editor.bindingMultiplicity = [];
  report.routeResults.pop();
  const invalid = validateRoutePassportEvidence(report, { authoritativeRoutes: [route] });
  assert.equal(invalid.ok, false);
  assert.match(invalid.issues.join('\n'), /missing-pair/u);
});

test('public action evidence requires each viewport, click, keyboard and no-JS route', () => {
  const route = '/';
  const actionResult = {
    action: { id: 'menu', visible: true, disabled: false }, policy: 'safe-ui-action', status: 'pass',
    executions: [{ mode: 'click', status: 'pass', observableChange: true }, { mode: 'keyboard-enter', status: 'pass', observableChange: true }]
  };
  const report = {
    schemaVersion: 1,
    evidence: {
      sourceSHA: 'abc123', dirty: false, distFreshness: { fresh: true },
      distFingerprintSHA256: 'artifact123', analyticsAndLeadSubmissionBlocked: true,
      artifactFingerprintSHA256: 'a'.repeat(64), artifactFileHashes: [['index.html', 'page123', 10]], artifactIsolation: { clean: true, leaks: [] },
      browserSafety: { mode: 'public-read-only', intercepted: [] }, emulation: { reducedMotion: true, deviceScaleFactor: 1 }
    },
    manifest: { exact: true, expected: [route], discovered: [route], concreteCoverage: true },
    routeResults: REQUIRED_VIEWPORTS.map((viewport) => ({
      route, viewport, status: 'pass',
      pageIdentity: { h1: ['Главная'], bodyTextLength: 100, frameworkOverlay: false },
      actionResults: [structuredClone(actionResult)]
    })),
    noJsResults: [{ route, viewport: REQUIRED_VIEWPORTS[0], documentStatus: 200, snapshot: { h1: ['Главная'], overflow: 0 }, events: [], status: 'pass' }],
    unknownResults: REQUIRED_VIEWPORTS.map((viewport) => ({
      route: REAL_UNKNOWN_ROUTE, viewport, documentStatus: 404, status: 'pass',
      pageIdentity: { h1: ['Не найдено'], robots: 'noindex', overflow: 0 }, events: [], actionResults: []
    })),
    unknownNoJsResult: { documentStatus: 404, status: 'pass', snapshot: { h1: ['Не найдено'], robots: 'noindex', overflow: 0 }, events: [] }
  };
  assert.equal(validatePublicActionEvidence(report, { authoritativeRoutes: [route] }).ok, true);
  report.routeResults[0].actionResults[0].executions.pop();
  assert.match(validatePublicActionEvidence(report, { authoritativeRoutes: [route] }).issues.join('\n'), /execution-gap/u);

  report.routeResults[0].actionResults[0] = {
    action: { id: 'home-link', visible: true, disabled: false }, policy: 'internal-link-action', status: 'pass',
    executions: [{ mode: 'click', status: 'pass' }], link: { status: 'pass' }
  };
  assert.match(validatePublicActionEvidence(report, { authoritativeRoutes: [route] }).issues.join('\n'), /execution-gap/u);

  report.routeResults[0].actionResults[0] = structuredClone(actionResult);
  report.noJsResults[0].events.push({ kind: 'runtime-exception' });
  assert.match(validatePublicActionEvidence(report, { authoritativeRoutes: [route] }).issues.join('\n'), /no-js-contract/u);
});

test('admin action evidence rejects generic execution of release controls', () => {
  const report = {
    schemaVersion: 1,
    evidence: {
      sourceSHA: 'abc123', dirty: false, loopbackOnly: true, credentialsPersisted: false,
      releaseActionsExecuted: false, canvas: { ready: true, h1: ['Главная'], bindings: 12, interactions: 8 },
      releaseMutationAttempts: [], browserSafety: { mode: 'admin-no-release', intercepted: [] },
      navigationAcceptance: { status: 'pass', click: { mode: 'click' }, keyboard: { mode: 'keyboard-enter' } }
    },
    actionResults: [{
      key: 'shell:publish', action: { context: 'shell', visible: true, disabled: false },
      policy: 'release-intercept-required', status: 'pass', executions: []
    }, {
      key: 'iframe-home:preview', action: { context: 'iframe-home', visible: false, disabled: false },
      policy: 'hidden-state', status: 'pass', executions: []
    }],
    navigator: { exact: true, expected: ['/'], discovered: ['/'] },
    canvasRouteResults: [{
      route: '/', routeClass: 'canonical', canonicalTarget: '/', status: 'pass', navigation: { mode: 'click' },
      snapshot: { h1: ['Главная'], bindings: 10, bindingIds: 10, overlays: 8 },
      contextual: { opened: true, controls: 2, escapeClosed: true }, requests: [], events: []
    }],
    events: [],
    aggregate: { discoveredContexts: ['shell', 'iframe-home'] }
  };
  assert.equal(validateAdminActionEvidence(report, { authoritativeRoutes: ['/'] }).ok, true);
  report.actionResults[0].executions.push({ operation: 'click', status: 'pass' });
  assert.match(validateAdminActionEvidence(report, { authoritativeRoutes: ['/'] }).issues.join('\n'), /forbidden-execution/u);
});

test('visual editor acceptance fails closed unless every destructive/failure recovery scenario has semantic evidence', () => {
  const evidenceById = {
    'two-tab-conflict': {
      mine: { title: 'Моя версия' }, theirs: { title: 'Сохранённая версия' }, base: { title: 'База' },
      canonical: { title: 'Сохранённая версия' }, serverConflictStatus: 409, silentOverwriteBlocked: true
    },
    'failed-exact-after-save': {
      saveCommitted: true, canonicalPreserved: true, exactFailed: true, previewBlocked: true,
      exact: { diagnostics: { code: 'EXACT_TEST_INJECTED_FAILURE' } }
    },
    'history-restore-new-transaction': {
      sourceTransactionId: 'tx-source', restoredTransactionId: 'tx-restored', restoresTransactionId: 'tx-source', newTransaction: true
    },
    'backup-failure-after-save': {
      backupFailureVisible: true, saveRemains: true, backup: { lastError: { code: 'BACKUP_TEST_INJECTED_FAILURE' } }
    },
    'export-import-lossless': {
      losslessRoundTrip: true, canApply: false, normalizedEqual: true, nonSkipRows: []
    },
    'expired-session-draft-recovery': {
      indexedDbDraftPreserved: true, draftRestoredAfterLogin: true, expired: { payload: { sessionExpired: true } }
    }
  };
  const report = {
    schemaVersion: 1,
    kind: 'h6-visual-editor-browser-acceptance',
    ok: true,
    runner: { browser: 'CdpBrowser', safetyMode: 'admin-no-release' },
    input: { isolation: {
      sourceSHA: 'abc123', branch: 'candidate', publishIntercepted: true, sourceWritesDisposable: true,
      testFaultsEnabled: true, deterministicExact: true
    }, executionMode: 'full' },
    safety: { mode: 'admin-no-release' },
    releaseBoundary: {
      releaseMutationRequests: [], interceptedMutationAttempts: [], mutationRequestsAttempted: 0,
      mutationRequestsReachedServer: 0, mutationRequestsExecuted: false
    },
    aggregate: { failed: 0 },
    scenarios: Object.entries(evidenceById).map(([id, evidence]) => ({ id, status: 'pass', issues: [], errors: [], evidence }))
  };
  assert.equal(validateVisualEditorAcceptanceEvidence(report, { expectedSourceSHA: 'abc123' }).ok, true);
  const targeted = structuredClone(report);
  targeted.input.executionMode = 'required-resilience-only';
  assert.match(validateVisualEditorAcceptanceEvidence(targeted).issues.join('\n'), /execution-mode/u);
  assert.equal(validateVisualEditorAcceptanceEvidence(targeted, { allowRequiredResilienceOnly: true }).ok, true);
  const missing = structuredClone(report);
  missing.scenarios = missing.scenarios.filter((scenario) => scenario.id !== 'two-tab-conflict');
  assert.match(validateVisualEditorAcceptanceEvidence(missing).issues.join('\n'), /missing-scenario:two-tab-conflict/u);
  const weakened = structuredClone(report);
  weakened.scenarios.find((scenario) => scenario.id === 'failed-exact-after-save').evidence.previewBlocked = false;
  assert.match(validateVisualEditorAcceptanceEvidence(weakened).issues.join('\n'), /failed-exact-contract/u);
  const releaseAttempt = structuredClone(report);
  releaseAttempt.releaseBoundary.releaseMutationRequests.push({ method: 'POST' });
  assert.match(validateVisualEditorAcceptanceEvidence(releaseAttempt).issues.join('\n'), /release-mutation/u);
});

test('evidence identity requires the same source and immutable production HTML artifact', () => {
  const shared = {
    evidence: {
      sourceSHA: 'abc123', branch: 'candidate', distFingerprintSHA256: 'artifact123',
      basePath: '/',
      htmlFileHashes: [['/', 'page123']], artifactFingerprintSHA256: 'artifact-full-123',
      artifactFileHashes: [['index.html', 'page123', 10]]
    },
    manifest: { expected: ['/'] }
  };
  const reports = {
    routePassport: structuredClone(shared),
    publicActions: structuredClone(shared),
    adminActions: { evidence: { sourceSHA: 'abc123', branch: 'candidate' } },
    backupRestore: { source: { sha: 'abc123', branch: 'candidate' } }
  };
  assert.equal(validateEvidenceIdentity(reports).ok, true);
  reports.publicActions.evidence.distFingerprintSHA256 = 'different';
  const invalid = validateEvidenceIdentity(reports);
  assert.equal(invalid.ok, false);
  assert.match(invalid.issues.join('\n'), /dist-fingerprint-mismatch/u);

  reports.publicActions.evidence.distFingerprintSHA256 = 'artifact123';
  reports.publicActions.evidence.basePath = '/SMU1/';
  assert.match(validateEvidenceIdentity(reports).issues.join('\n'), /base-path-mismatch/u);
  reports.publicActions.evidence.basePath = '/';
  reports.backupRestore.source.branch = 'foreign';
  assert.match(validateEvidenceIdentity(reports).issues.join('\n'), /branch-mismatch/u);
  reports.backupRestore.source.branch = 'candidate';
  reports.backupRestore.source.sha = 'foreign';
  assert.match(validateEvidenceIdentity(reports).issues.join('\n'), /source-sha-mismatch/u);
  reports.backupRestore.source.sha = 'abc123';
  const currentMismatch = validateEvidenceIdentity(reports, { currentEvidence: {
    sourceSHA: 'different', branch: 'candidate', dirty: false,
    distFingerprintSHA256: 'artifact123', htmlFileHashes: [['/', 'page123']],
    artifactFingerprintSHA256: 'artifact-full-123', artifactFileHashes: [['index.html', 'page123', 10]]
  } });
  assert.match(currentMismatch.issues.join('\n'), /current-source-sha-mismatch/u);
});

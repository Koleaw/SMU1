import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAdminActionEvidence,
  validateEvidenceIdentity,
  validatePublicActionEvidence,
  validateRoutePassportEvidence,
  validateVisualEditorAcceptanceEvidence
} from './evidence-contract.mjs';
import { buildExpectedRouteModel, REQUIRED_VIEWPORTS, REAL_UNKNOWN_ROUTE } from './route-passport-model.mjs';
import {
  FULL_VISUAL_ACCEPTANCE_SCENARIOS,
  REQUIRED_RESILIENCE_VISUAL_ACCEPTANCE_SCENARIOS
} from './visual-editor-scenarios.mjs';

test('route evidence contract rejects by-analogy coverage and accepts concrete pairs only', () => {
  const route = '/';
  const baseResult = (viewport) => ({
    route, viewport, routeClass: 'canonical', status: 'pass', requestedDocumentStatus: 200, finalDocumentStatus: 200, h1: ['Главная'],
    canonical: '', canonicalPolicy: 'suppressed-noindex-preview', robots: 'noindex, nofollow, noarchive',
    renderer: { family: 'home', actualVariant: 'home-final' },
    visibleSections: [], media: [], backgroundMedia: [], galleries: [], interactions: [], businessOccurrences: [], sourceOwners: [], publicAssets: [], expectedTools: [],
    diagnostics: { events: [], localMedia: [], resourceRequests: [], adminAssetLeaks: [] },
    editor: {
      status: 'covered', occurrences: [], mediaOccurrences: [], invalidBindings: [], bindingMultiplicity: [],
      occurrenceCoverage: { unclassified: 0, ambiguous: 0 },
      mediaCoverage: { unclassified: 0, ambiguous: 0 },
      toolCoverage: { missing: [] },
      equivalence: { status: 'pass', issues: [] }, events: [], expectedDocumentEvents: []
    }
  });
  const report = {
    schemaVersion: 1,
    evidence: {
      sourceSHA: 'abc123', branch: 'candidate', dirty: false,
      basePath: '/SMU1',
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
        toolCoverage: { missing: [] }, equivalence: { status: 'pass', issues: [] }, events: [],
        expectedDocumentEvents: [{ kind: 'http-response', status: 404, resourceType: 'Document' }]
      }
    }))
  };
  assert.equal(validateRoutePassportEvidence(report, { requireEditorCoverage: true, authoritativeRoutes: [route] }).ok, true);
  const previewCanonical = structuredClone(report);
  previewCanonical.routeResults[0].canonical = 'https://example.test/SMU1/';
  assert.match(validateRoutePassportEvidence(previewCanonical, { authoritativeRoutes: [route] }).issues.join('\n'), /preview-canonical/u);
  const previewIndexable = structuredClone(report);
  previewIndexable.routeResults[0].robots = 'index, follow';
  assert.match(validateRoutePassportEvidence(previewIndexable, { authoritativeRoutes: [route] }).issues.join('\n'), /preview-robots/u);
  const missingSeoEvidence = structuredClone(report);
  delete missingSeoEvidence.routeResults[0].canonical;
  delete missingSeoEvidence.routeResults[0].robots;
  assert.match(validateRoutePassportEvidence(missingSeoEvidence, { authoritativeRoutes: [route] }).issues.join('\n'), /canonical-evidence[\s\S]*robots-evidence/u);
  const malformedSeoEvidence = structuredClone(report);
  malformedSeoEvidence.routeResults[0].canonical = null;
  assert.match(validateRoutePassportEvidence(malformedSeoEvidence, { authoritativeRoutes: [route] }).issues.join('\n'), /canonical-evidence/u);
  const mixedPolicy = structuredClone(report);
  mixedPolicy.routeResults[0].canonicalPolicy = 'required-production-canonical';
  assert.match(validateRoutePassportEvidence(mixedPolicy, { authoritativeRoutes: [route] }).issues.join('\n'), /mixed-canonical-policy/u);

  const production = structuredClone(report);
  production.evidence.canonicalOrigin = 'https://example.test';
  for (const result of production.routeResults) {
    result.canonical = 'https://example.test/SMU1/';
    result.canonicalPolicy = 'required-production-canonical';
    result.robots = 'index, follow';
  }
  assert.equal(validateRoutePassportEvidence(production, { authoritativeRoutes: [route] }).ok, true);
  production.routeResults[0].canonical = 'https://hostile.example/SMU1/';
  assert.match(validateRoutePassportEvidence(production, { authoritativeRoutes: [route] }).issues.join('\n'), /production-canonical/u);
  production.routeResults[0].canonical = 'http://example.test/SMU1/';
  assert.match(validateRoutePassportEvidence(production, { authoritativeRoutes: [route] }).issues.join('\n'), /production-canonical/u);
  production.routeResults[0].canonical = 'https://secret@example.test/SMU1/';
  assert.match(validateRoutePassportEvidence(production, { authoritativeRoutes: [route] }).issues.join('\n'), /production-canonical/u);
  production.routeResults[0].canonical = 'https://example.test/';
  assert.match(validateRoutePassportEvidence(production, { authoritativeRoutes: [route] }).issues.join('\n'), /production-canonical/u);
  production.routeResults[0].canonical = 'https://example.test/SMU1/?stale=1';
  assert.match(validateRoutePassportEvidence(production, { authoritativeRoutes: [route] }).issues.join('\n'), /production-canonical/u);
  production.routeResults[0].canonical = 'https://example.test/SMU1/wrong/';
  assert.match(validateRoutePassportEvidence(production, { authoritativeRoutes: [route] }).issues.join('\n'), /production-canonical/u);
  production.routeResults[0].canonical = 'https://example.test/SMU1/';
  production.routeResults[0].robots = 'noindex, follow';
  assert.match(validateRoutePassportEvidence(production, { authoritativeRoutes: [route] }).issues.join('\n'), /production-robots/u);

  const productionAlias = structuredClone(report);
  productionAlias.evidence.canonicalOrigin = 'https://example.test';
  for (const result of productionAlias.routeResults) {
    result.route = '/old/';
    result.routeClass = 'alias';
    result.canonicalTarget = '/';
    result.canonical = 'https://example.test/SMU1/';
    result.canonicalPolicy = 'required-production-canonical';
    result.robots = 'noindex, nofollow, noarchive';
  }
  productionAlias.manifest.expected = ['/old/'];
  productionAlias.manifest.discovered = ['/old/'];
  assert.equal(validateRoutePassportEvidence(productionAlias, { authoritativeRoutes: ['/old/'] }).ok, true);
  productionAlias.routeResults[0].robots = 'index, follow';
  assert.match(validateRoutePassportEvidence(productionAlias, { authoritativeRoutes: ['/old/'] }).issues.join('\n'), /production-alias-robots/u);

  const production404 = structuredClone(report);
  production404.evidence.canonicalOrigin = 'https://example.test';
  production404.manifest.expected = ['/404.html'];
  production404.manifest.discovered = ['/404.html'];
  for (const result of production404.routeResults) {
    result.route = '/404.html';
    result.routeClass = '404';
    result.canonicalTarget = '/404.html';
    result.canonical = '';
    result.canonicalPolicy = 'required-production-canonical';
    result.robots = 'noindex, nofollow';
  }
  assert.equal(validateRoutePassportEvidence(production404, { authoritativeRoutes: ['/404.html'] }).ok, true);
  production404.routeResults[0].canonical = 'https://example.test/SMU1/404.html';
  assert.match(validateRoutePassportEvidence(production404, { authoritativeRoutes: ['/404.html'] }).issues.join('\n'), /production-404-canonical/u);

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
      pageIdentity: { h1: ['Главная'], bodyTextLength: 100, frameworkOverlay: false, galleryInventory: { product: [], project: [] } },
      actionCount: 1,
      actionResults: [structuredClone(actionResult)],
      gallerySemantics: { inventory: { product: [], project: [] }, results: [] }
    })),
    noJsResults: [{ route, viewport: REQUIRED_VIEWPORTS[0], documentStatus: 200, snapshot: { h1: ['Главная'], overflow: 0 }, events: [], status: 'pass' }],
    publicLifecycleSemantics: [{
      id: 'home-video', route: '/', status: 'pass', issues: [], events: [],
      safety: { stateChangingRequests: 0, leadOrAnalyticsRequests: 0, interceptedAttempts: 0 },
      evidence: {
        normalMotion: {
          reducedMotion: false, saveData: false, controlReady: true, sourceLoaded: true, videoRequestCount: 1,
          playingBeforePause: true, pausedAfterPause: true, playingAfterResume: true,
          labelAfterPause: 'Включить видео', labelAfterResume: 'Пауза видео',
          ariaAfterPause: 'Включить фоновое видео', ariaAfterResume: 'Приостановить фоновое видео'
        },
        reducedMotion: { reducedMotion: true, saveData: false, controlSuppressed: true, sourceLoaded: false, videoRequestCount: 0 },
        saveData: { reducedMotion: false, saveData: true, controlSuppressed: true, sourceLoaded: false, videoRequestCount: 0 }
      }
    }, {
      id: 'cookie-notice', route: '/', status: 'pass', issues: [], events: [],
      safety: { stateChangingRequests: 0, leadOrAnalyticsRequests: 0, interceptedAttempts: 0 },
      evidence: {
        initial: { visible: true, noticeKey: null, legacyKey: null },
        dismissed: { hidden: true, noticeKey: 'true' },
        persistedReload: { hidden: true, noticeKey: 'true' },
        footerReopen: { visible: true, noticeKey: null, legacyKey: null }
      }
    }],
    unknownResults: REQUIRED_VIEWPORTS.map((viewport) => ({
      route: REAL_UNKNOWN_ROUTE, viewport, documentStatus: 404, status: 'pass',
      pageIdentity: { h1: ['Не найдено'], robots: 'noindex', overflow: 0 }, events: [], actionResults: []
    })),
    unknownNoJsResult: { documentStatus: 404, status: 'pass', snapshot: { h1: ['Не найдено'], robots: 'noindex', overflow: 0 }, events: [] },
    aggregate: {
      actionOccurrences: 2, safeExecutions: 4,
      gallerySemanticOccurrences: 0, gallerySemanticPassed: 0, gallerySemanticFailed: 0,
      lifecycleSemanticOccurrences: 2, lifecycleSemanticsPassed: 2, lifecycleSemanticsFailed: 0
    }
  };
  for (const result of report.unknownResults) {
    result.actionCount = 1;
    result.actionResults = [structuredClone(actionResult)];
  }
  assert.equal(validatePublicActionEvidence(report, { authoritativeRoutes: [route] }).ok, true);
  const missingLifecycle = structuredClone(report);
  missingLifecycle.publicLifecycleSemantics.pop();
  assert.match(validatePublicActionEvidence(missingLifecycle, { authoritativeRoutes: [route] }).issues.join('\n'), /lifecycle-missing:cookie-notice/u);
  const unsafeLifecycle = structuredClone(report);
  unsafeLifecycle.publicLifecycleSemantics[0].safety.leadOrAnalyticsRequests = 1;
  assert.match(validatePublicActionEvidence(unsafeLifecycle, { authoritativeRoutes: [route] }).issues.join('\n'), /lifecycle-safety:home-video/u);
  const unsuppressedVideo = structuredClone(report);
  unsuppressedVideo.publicLifecycleSemantics[0].evidence.saveData.sourceLoaded = true;
  assert.match(validatePublicActionEvidence(unsuppressedVideo, { authoritativeRoutes: [route] }).issues.join('\n'), /lifecycle-home-video-save-data/u);
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

  const emptyRegistry = structuredClone(report);
  emptyRegistry.noJsResults[0].events = [];
  emptyRegistry.routeResults[0].actionCount = 0;
  emptyRegistry.routeResults[0].actionResults = [];
  emptyRegistry.aggregate.actionOccurrences = 1;
  emptyRegistry.aggregate.safeExecutions = 2;
  assert.match(validatePublicActionEvidence(emptyRegistry, { authoritativeRoutes: [route] }).issues.join('\n'), /missing-or-empty-registry/u);
});

test('admin action evidence rejects generic execution of release controls', () => {
  const report = {
    schemaVersion: 1,
    evidence: {
      sourceSHA: 'abc123', dirty: false, loopbackOnly: true, credentialsPersisted: false,
      releaseActionsExecuted: false,
      canvas: {
        ready: true, h1: ['Главная'], bindings: 12, interactions: 8, overlays: 7,
        editorSessionShape: true, editorRevisionShape: true,
        srcOriginPath: 'http://127.0.0.1:4321/', locationOriginPath: 'http://127.0.0.1:4321/',
        queryKeys: ['__smu1_editor', 'editorMode', 'editorRevision', 'editorSession']
      },
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
  const leakedSession = structuredClone(report);
  leakedSession.evidence.canvas.editorSession = '6e978464-ea27-49de-92d4-44cb175166e8';
  leakedSession.evidence.canvas.location = 'http://127.0.0.1:4321/?editorSession=6e978464-ea27-49de-92d4-44cb175166e8';
  assert.match(validateAdminActionEvidence(leakedSession, { authoritativeRoutes: ['/'] }).issues.join('\n'), /canvas-session-leak/u);
  const aliasReport = structuredClone(report);
  aliasReport.navigator = { exact: true, expected: ['/legacy/'], discovered: ['/legacy/'] };
  aliasReport.canvasRouteResults = [{
    route: '/legacy/', routeClass: 'alias', canonicalTarget: '/canonical/', status: 'pass', navigation: { mode: 'click' },
    snapshot: {
      h1: ['Каноническая'], bindings: 10, bindingIds: 10, overlays: 0,
      aliasBridgeReady: true, aliasBridgeRevisionMatch: true,
      canvasHint: 'Совместимый адрес. Каноническая страница: /canonical/'
    },
    contextual: { applicable: false, opened: false, controls: 0, escapeClosed: false }, requests: [], events: []
  }];
  assert.equal(validateAdminActionEvidence(aliasReport, { authoritativeRoutes: ['/legacy/'] }).ok, true);
  aliasReport.canvasRouteResults[0].snapshot.overlays = 1;
  assert.match(validateAdminActionEvidence(aliasReport, { authoritativeRoutes: ['/legacy/'] }).issues.join('\n'), /alias-editable/u);
  report.actionResults[0].executions.push({ operation: 'click', status: 'pass' });
  assert.match(validateAdminActionEvidence(report, { authoritativeRoutes: ['/'] }).issues.join('\n'), /forbidden-execution/u);
});

test('visual editor acceptance fails closed unless every required editor scenario has semantic evidence', () => {
  const authoritativeImpactRoutes = buildExpectedRouteModel().routes.map((route) => route.pathname)
    .sort((left, right) => left.localeCompare(right, 'en'));
  const evidenceById = {
    'link-label-href-independent': {
      navigation: { selectedRoute: '/' },
      binding: {
        bindingId: 'home-primary-link', ownerCollection: 'static-pages', ownerSlug: 'home',
        fieldPath: 'heroPrimaryLabel', hrefPath: 'heroPrimaryHref', tool: 'link'
      },
      inspector: {
        open: true, labelField: 'Основная кнопка', addressField: 'Адрес ссылки',
        fields: [{ label: 'Основная кнопка', value: 'Получить расчёт' }, { label: 'Адрес ссылки', value: '#contact' }]
      },
      original: { label: 'Получить расчёт', hrefAttribute: '#contact', pathname: '/', hash: '#contact' },
      afterLabel: { label: 'H6: подпись изменена отдельно', hrefAttribute: '#contact', pathname: '/', hash: '#contact' },
      afterHref: { label: 'H6: подпись изменена отдельно', hrefAttribute: '/kontakty/', pathname: '/kontakty/', hash: '' },
      restored: { label: 'Получить расчёт', hrefAttribute: '#contact', exact: true },
      saveOrBuildRequests: [], noSaveOrBuildRequested: true
    },
    'global-phone-authoritative-impact': {
      navigation: { selectedRoute: '/' },
      binding: {
        bindingId: 'global-phone', ownerCollection: 'site-settings', ownerSlug: 'global', fieldPath: 'phonePrimary',
        hrefPath: 'phonePrimary', tool: 'link', scope: 'global', affectedRoutes: ['*']
      },
      provenance: { visible: true, label: `Используется на ${authoritativeImpactRoutes.length} страницах`, declaredCount: authoritativeImpactRoutes.length },
      authoritativeRoutes: authoritativeImpactRoutes,
      displayedRoutes: authoritativeImpactRoutes,
      uniqueDisplayedRoutes: authoritativeImpactRoutes,
      exactAuthoritativeImpact: true
    },
    'project-media-role-independence': {
      navigation: { selectedRoute: '/vypolnennye-obekty/objekt-parkovaya-zona/' },
      binding: {
        bindingId: 'project-gallery', ownerCollection: 'projects', recordSlug: 'objekt-parkovaya-zona',
        fieldPath: 'gallery', tool: 'gallery', role: 'missing-project-media'
      },
      original: {
        status: 200, revision: 'project-revision-1', rawGalleryCount: 2,
        archiveCoverMedia: '', detailHeroMedia: '', publicGallery: []
      },
      defaultRoleRows: [
        { name: 'one.jpg', roles: ['gallery'] },
        { name: 'two.jpg', roles: ['gallery'] }
      ],
      firstStageRequestCount: 2,
      firstStageRequests: [
        { method: 'POST', url: { pathname: '/api/admin/media/staging' } },
        { method: 'POST', url: { pathname: '/api/admin/media/staging' } }
      ],
      uploadedPaths: ['/uploads/one.jpg', '/uploads/two.jpg'],
      firstDraft: {
        rawGalleryCount: 4, publicGallery: ['/uploads/one.jpg', '/uploads/two.jpg'],
        archiveCoverMedia: '', detailHeroMedia: '', stagedCount: 2
      },
      explicitAssignments: {
        cover: { available: true, path: '/uploads/one.jpg', role: 'cover' },
        hero: { available: true, path: '/uploads/two.jpg', role: 'hero' },
        rows: {
          cover: { pathname: '/uploads/one.jpg', roles: ['cover', 'gallery'] },
          hero: { pathname: '/uploads/two.jpg', roles: ['gallery', 'hero'] }
        }
      },
      secondDraft: {
        rawGalleryCount: 4, publicGallery: ['/uploads/one.jpg', '/uploads/two.jpg'],
        archiveCoverMedia: '/uploads/one.jpg', detailHeroMedia: '/uploads/two.jpg'
      },
      recoveryCleared: { cleared: true },
      canonical: {
        status: 200, revision: 'project-revision-1', rawGalleryCount: 2,
        archiveCoverMedia: '', detailHeroMedia: '', publicGallery: []
      },
      canonicalUnchanged: true,
      saveOrBuildRequests: [], noSaveOrBuildRequested: true
    },
    'borrowed-relation-media-live-projection': {
      route: '/o-nas/',
      relationBinding: {
        bindingId: 'relation-company-hero', mediaBindingId: 'media-company-hero',
        ownerCollection: 'static-pages', ownerSlug: 'o-nas', fieldPath: 'companyHeroProjectSlug',
        tool: 'relation-select', relationCollection: 'projects', projectionKind: 'relation'
      },
      inspector: { open: true, provenanceVisible: true, optionCount: 3, provenance: 'Источник: static-pages · o-nas' },
      selection: {
        originalSlug: 'kompleks-rabot-na-proizvodstvennoy-territorii',
        nextSlug: 'blagoustroystvo-naberezhnoy-reki-tobol',
        nextSource: { fieldPath: 'presentation.detailHeroMedia', path: '/uploads/next.jpg' }
      },
      before: {
        media: {
          bindingId: 'media-company-hero', ownerCollection: 'projects',
          ownerSlug: 'kompleks-rabot-na-proizvodstvennoy-territorii', fieldPath: 'presentation.detailHeroMedia',
          scope: 'shared', tool: 'media', affectedRoutes: ['/o-nas/', '/vypolnennye-obekty/kompleks-rabot-na-proizvodstvennoy-territorii/']
        },
        image: { visible: true, src: '/uploads/original.jpg', currentSrc: '/_h5/original.webp' },
        sourceAction: { available: true, bindingId: 'media-company-hero', controlKey: 'target' },
        relationAction: { available: true, bindingId: 'relation-company-hero', controlKey: 'relation' }
      },
      after: {
        media: {
          bindingId: 'media-company-hero', ownerCollection: 'projects',
          ownerSlug: 'blagoustroystvo-naberezhnoy-reki-tobol', fieldPath: 'presentation.detailHeroMedia',
          scope: 'shared', tool: 'media', affectedRoutes: ['/o-nas/', '/vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/']
        },
        image: { visible: true, src: '/uploads/next.jpg', currentSrc: '/uploads/next.jpg', srcset: '', sourceSrcsets: ['', ''] },
        sourceAction: { available: true, bindingId: 'media-company-hero', controlKey: 'target' },
        relationAction: { available: true, bindingId: 'relation-company-hero', controlKey: 'relation' }
      },
      liveImageChanged: true,
      sourceRetargeted: true,
      staleResponsiveSourcesCleared: true,
      sharedImpact: true,
      draftRecovery: { key: 'static-pages:o-nas', baseRevision: 'revision-1', value: 'blagoustroystvo-naberezhnoy-reki-tobol' },
      mediaDialog: {
        open: true, sourceMatches: true, impactMatches: true,
        subtitle: 'Источник: Набережная · projects/presentation.detailHeroMedia. Используется на: /o-nas/, /vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/'
      },
      undo: {
        restoredSource: true,
        restored: { media: { ownerSlug: 'kompleks-rabot-na-proizvodstvennoy-territorii' } },
        recoveryAfterUndo: { present: false, value: '' }
      },
      saveEvidenceUnchanged: true,
      saveOrBuildRequests: [],
      noSaveOrBuildRequested: true
    },
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
    aggregate: {
      scenarios: FULL_VISUAL_ACCEPTANCE_SCENARIOS.length,
      checks: FULL_VISUAL_ACCEPTANCE_SCENARIOS.length + 2,
      passed: FULL_VISUAL_ACCEPTANCE_SCENARIOS.length + 2,
      failed: 0,
      failedIds: []
    },
    scenarios: FULL_VISUAL_ACCEPTANCE_SCENARIOS.map((id) => ({
      id,
      status: 'pass',
      issues: [],
      errors: [],
      evidence: evidenceById[id] || {}
    }))
  };
  assert.equal(validateVisualEditorAcceptanceEvidence(report, { expectedSourceSHA: 'abc123' }).ok, true);
  const targeted = structuredClone(report);
  targeted.input.executionMode = 'required-resilience-only';
  targeted.scenarios = targeted.scenarios.filter((scenario) => REQUIRED_RESILIENCE_VISUAL_ACCEPTANCE_SCENARIOS.includes(scenario.id));
  targeted.aggregate.scenarios = REQUIRED_RESILIENCE_VISUAL_ACCEPTANCE_SCENARIOS.length;
  targeted.aggregate.checks = REQUIRED_RESILIENCE_VISUAL_ACCEPTANCE_SCENARIOS.length + 2;
  targeted.aggregate.passed = REQUIRED_RESILIENCE_VISUAL_ACCEPTANCE_SCENARIOS.length + 2;
  assert.match(validateVisualEditorAcceptanceEvidence(targeted).issues.join('\n'), /execution-mode/u);
  assert.equal(validateVisualEditorAcceptanceEvidence(targeted, { allowRequiredResilienceOnly: true }).ok, true);
  const missing = structuredClone(report);
  missing.scenarios = missing.scenarios.filter((scenario) => scenario.id !== 'two-tab-conflict');
  assert.match(validateVisualEditorAcceptanceEvidence(missing).issues.join('\n'), /missing-scenario:two-tab-conflict/u);
  const missingCore = structuredClone(report);
  missingCore.scenarios = missingCore.scenarios.filter((scenario) => scenario.id !== 'product-h1-live-edit');
  assert.match(validateVisualEditorAcceptanceEvidence(missingCore).issues.join('\n'), /missing-scenario:product-h1-live-edit/u);
  const missingBulk = structuredClone(report);
  missingBulk.scenarios = missingBulk.scenarios.filter((scenario) => scenario.id !== 'bulk-media-queue');
  assert.match(validateVisualEditorAcceptanceEvidence(missingBulk).issues.join('\n'), /missing-scenario:bulk-media-queue/u);
  const weakened = structuredClone(report);
  weakened.scenarios.find((scenario) => scenario.id === 'failed-exact-after-save').evidence.previewBlocked = false;
  assert.match(validateVisualEditorAcceptanceEvidence(weakened).issues.join('\n'), /failed-exact-contract/u);
  const staleBorrowedMedia = structuredClone(report);
  staleBorrowedMedia.scenarios.find((scenario) => scenario.id === 'borrowed-relation-media-live-projection').evidence.liveImageChanged = false;
  assert.match(validateVisualEditorAcceptanceEvidence(staleBorrowedMedia).issues.join('\n'), /borrowed-relation-media-contract/u);
  const hiddenSourceAction = structuredClone(report);
  hiddenSourceAction.scenarios.find((scenario) => scenario.id === 'borrowed-relation-media-live-projection').evidence.after.sourceAction.available = false;
  assert.match(validateVisualEditorAcceptanceEvidence(hiddenSourceAction).issues.join('\n'), /borrowed-relation-media-contract/u);
  const implicitSave = structuredClone(report);
  implicitSave.scenarios.find((scenario) => scenario.id === 'borrowed-relation-media-live-projection').evidence.saveOrBuildRequests.push({ method: 'POST' });
  assert.match(validateVisualEditorAcceptanceEvidence(implicitSave).issues.join('\n'), /borrowed-relation-media-contract/u);
  const coupledLink = structuredClone(report);
  coupledLink.scenarios.find((scenario) => scenario.id === 'link-label-href-independent').evidence.afterLabel.hrefAttribute = '/kontakty/';
  assert.match(validateVisualEditorAcceptanceEvidence(coupledLink).issues.join('\n'), /link-label-href-contract/u);
  const incompletePhoneImpact = structuredClone(report);
  incompletePhoneImpact.scenarios.find((scenario) => scenario.id === 'global-phone-authoritative-impact').evidence.displayedRoutes.pop();
  assert.match(validateVisualEditorAcceptanceEvidence(incompletePhoneImpact).issues.join('\n'), /global-phone-impact-contract/u);
  const implicitProjectCover = structuredClone(report);
  implicitProjectCover.scenarios.find((scenario) => scenario.id === 'project-media-role-independence').evidence.firstDraft.archiveCoverMedia = '/uploads/one.jpg';
  assert.match(validateVisualEditorAcceptanceEvidence(implicitProjectCover).issues.join('\n'), /project-media-role-contract/u);
  const coupledProjectRoles = structuredClone(report);
  coupledProjectRoles.scenarios.find((scenario) => scenario.id === 'project-media-role-independence').evidence.secondDraft.detailHeroMedia = '/uploads/one.jpg';
  assert.match(validateVisualEditorAcceptanceEvidence(coupledProjectRoles).issues.join('\n'), /project-media-role-contract/u);
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

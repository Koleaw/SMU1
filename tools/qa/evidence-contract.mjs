import {
  buildExpectedRouteModel,
  REQUIRED_VIEWPORTS,
  REAL_UNKNOWN_ROUTE
} from './route-passport-model.mjs';

const pairKey = (route, viewport) => `${route}@@${viewport}`;
const canonicalJson = (value) => JSON.stringify(value);
const exactArray = (left, right) => canonicalJson(left) === canonicalJson(right);
const normalizedEvidenceBasePath = (value) => {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw === '/') return '/';
  if (raw.includes('\\') || raw.includes('?') || raw.includes('#')) return null;
  const normalized = `/${raw.replace(/^\/+|\/+$/gu, '')}`;
  return normalized.split('/').some((part) => part === '.' || part === '..') ? null : normalized;
};
const defaultAuthoritativeRoutes = () => buildExpectedRouteModel().routes.map((route) => route.pathname);
export const REQUIRED_VISUAL_ACCEPTANCE_SCENARIOS = Object.freeze([
  'two-tab-conflict',
  'failed-exact-after-save',
  'history-restore-new-transaction',
  'backup-failure-after-save',
  'export-import-lossless',
  'expired-session-draft-recovery'
]);
const artifactEvidenceIssues = (report, prefix) => {
  const issues = [];
  if (!/^[a-f0-9]{64}$/u.test(report?.evidence?.artifactFingerprintSHA256 || '')) issues.push(`${prefix}:artifact-fingerprint`);
  if (!Array.isArray(report?.evidence?.artifactFileHashes) || report.evidence.artifactFileHashes.length === 0) issues.push(`${prefix}:artifact-file-hashes`);
  if (!report?.evidence?.artifactIsolation?.clean || report.evidence.artifactIsolation?.leaks?.length) issues.push(`${prefix}:artifact-isolation`);
  return issues;
};
const viewportMatches = (actual) => {
  const expected = REQUIRED_VIEWPORTS.find((viewport) => viewport.id === actual?.id);
  return Boolean(expected && expected.width === actual.width && expected.height === actual.height && expected.mobile === actual.mobile);
};

const validateManifest = (report, prefix, authoritativeRoutes) => {
  const issues = [];
  const expected = Array.isArray(report?.manifest?.expected) ? report.manifest.expected : [];
  const discovered = Array.isArray(report?.manifest?.discovered) ? report.manifest.discovered : [];
  if (!report?.manifest?.exact) issues.push(`${prefix}:manifest-not-exact`);
  if (!exactArray(expected, authoritativeRoutes)) issues.push(`${prefix}:source-model-mismatch`);
  if (!exactArray(expected, discovered)) issues.push(`${prefix}:emitted-manifest-mismatch`);
  if (expected.length === 0 || expected.length !== discovered.length) issues.push(`${prefix}:manifest-count`);
  return { issues, expected };
};

export function validateRoutePassportEvidence(report, options = {}) {
  const requireEditorCoverage = options.requireEditorCoverage ?? false;
  const authoritativeModel = options.authoritativeModel || buildExpectedRouteModel();
  const authoritativeRoutes = options.authoritativeRoutes || authoritativeModel.routes.map((route) => route.pathname);
  const authoritativeDescriptors = options.authoritativeRoutes
    ? new Map()
    : new Map(authoritativeModel.routes.map((route) => [route.pathname, route]));
  const issues = [];
  if (report?.schemaVersion !== 1) issues.push('route-passport:schema-version');
  if (!report?.evidence?.sourceSHA) issues.push('route-passport:source-sha');
  if (report?.evidence?.dirty) issues.push('route-passport:dirty-source');
  if (!report?.evidence?.distFreshness?.fresh) issues.push('route-passport:stale-dist');
  if (!report?.evidence?.distFingerprintSHA256) issues.push('route-passport:dist-fingerprint');
  if (report?.evidence?.browserSafety?.mode !== 'public-read-only') issues.push('route-passport:browser-safety');
  issues.push(...artifactEvidenceIssues(report, 'route-passport'));
  const manifest = validateManifest(report, 'route-passport', authoritativeRoutes);
  issues.push(...manifest.issues);
  const expected = manifest.expected;
  const expectedPairs = new Set(expected.flatMap((route) => REQUIRED_VIEWPORTS.map((viewport) => pairKey(route, viewport.id))));
  const seenPairs = new Set();
  for (const result of report?.routeResults || []) {
    const key = pairKey(result.route, result.viewport?.id);
    if (!expectedPairs.has(key)) issues.push(`route-passport:unexpected-pair:${key}`);
    if (seenPairs.has(key)) issues.push(`route-passport:duplicate-pair:${key}`);
    seenPairs.add(key);
    if (!viewportMatches(result.viewport)) issues.push(`route-passport:viewport-contract:${key}`);
    const authoritative = authoritativeDescriptors.get(result.route);
    if (authoritative) {
      if (result.routeClass !== authoritative.routeClass) issues.push(`route-passport:route-class:${key}`);
      if (result.canonicalTarget !== authoritative.canonicalTarget) issues.push(`route-passport:canonical-target:${key}`);
      if (result.renderer?.family !== authoritative.rendererFamily) issues.push(`route-passport:renderer-family:${key}`);
      if (result.renderer?.expectedVariant !== authoritative.rendererVariant) issues.push(`route-passport:expected-variant:${key}`);
      if (!exactArray(result.sourceOwners, authoritative.sourceOwners)) issues.push(`route-passport:source-owners:${key}`);
      if (!exactArray(result.expectedTools, authoritative.expectedTools)) issues.push(`route-passport:expected-tools:${key}`);
    }
    if (result.status !== 'pass') issues.push(`route-passport:failed:${key}`);
    if (result.requestedDocumentStatus !== 200 || result.finalDocumentStatus !== 200) issues.push(`route-passport:document-status:${key}`);
    if (!Array.isArray(result.h1) || result.h1.length !== 1) issues.push(`route-passport:h1:${key}`);
    for (const field of ['visibleSections', 'media', 'backgroundMedia', 'galleries', 'interactions', 'businessOccurrences', 'sourceOwners', 'publicAssets']) {
      if (!Array.isArray(result[field])) issues.push(`route-passport:${field}:${key}`);
    }
    if (!result.diagnostics || !Array.isArray(result.diagnostics.events) || !Array.isArray(result.diagnostics.localMedia)
      || !Array.isArray(result.diagnostics.resourceRequests) || !Array.isArray(result.diagnostics.adminAssetLeaks)) {
      issues.push(`route-passport:diagnostics:${key}`);
    }
    if ((result.diagnostics?.adminAssetLeaks || []).length) issues.push(`route-passport:admin-assets:${key}`);
    if (!result.renderer?.family || !result.renderer?.actualVariant) issues.push(`route-passport:renderer:${key}`);
    if (requireEditorCoverage && result.routeClass !== 'alias') {
      if (result.editor?.status !== 'covered') issues.push(`route-passport:editor-uncovered:${key}`);
      if (result.editor?.equivalence?.status !== 'pass' || result.editor?.equivalence?.issues?.length) issues.push(`route-passport:editor-equivalence:${key}`);
      if (!Array.isArray(result.editor?.events) || result.editor.events.some((event) => !['console-warning', 'log-warning'].includes(event.kind))) {
        issues.push(`route-passport:editor-errors:${key}`);
      }
      if (!Array.isArray(result.editor?.occurrences)) issues.push(`route-passport:occurrence-coverage-missing:${key}`);
      if (!Array.isArray(result.editor?.mediaOccurrences)) issues.push(`route-passport:media-coverage-missing:${key}`);
      if (result.editor?.invalidBindings?.length) issues.push(`route-passport:invalid-bindings:${key}`);
      if (!Array.isArray(result.editor?.bindingMultiplicity) || result.editor.bindingMultiplicity.length) issues.push(`route-passport:duplicate-binding-ids:${key}`);
      if (result.editor?.occurrenceCoverage?.unclassified !== 0) issues.push(`route-passport:unclassified-occurrences:${key}`);
      if (result.editor?.occurrenceCoverage?.ambiguous !== 0) issues.push(`route-passport:ambiguous-occurrences:${key}`);
      if (result.editor?.mediaCoverage?.unclassified !== 0) issues.push(`route-passport:unclassified-media:${key}`);
      if (result.editor?.mediaCoverage?.ambiguous !== 0) issues.push(`route-passport:ambiguous-media:${key}`);
      if (!result.editor?.toolCoverage || result.editor.toolCoverage.missing?.length) issues.push(`route-passport:missing-tools:${key}`);
    }
  }
  for (const key of expectedPairs) if (!seenPairs.has(key)) issues.push(`route-passport:missing-pair:${key}`);
  if (report?.manifest?.concreteCoverage !== true) issues.push('route-passport:not-concrete-full-coverage');

  const unknownExpected = new Set(REQUIRED_VIEWPORTS.map((viewport) => pairKey(REAL_UNKNOWN_ROUTE, viewport.id)));
  const unknownSeen = new Set();
  for (const result of report?.unknownResults || []) {
    const key = pairKey(result.route, result.viewport?.id);
    if (!unknownExpected.has(key)) issues.push(`route-passport:unknown-unexpected:${key}`);
    if (unknownSeen.has(key)) issues.push(`route-passport:unknown-duplicate:${key}`);
    unknownSeen.add(key);
    if (!viewportMatches(result.viewport)) issues.push(`route-passport:unknown-viewport-contract:${key}`);
    if (result.status !== 'pass' || result.documentStatus !== 404) issues.push(`route-passport:unknown-failed:${key}`);
    if (result.renderer?.actualFamily !== 'not-found' || result.renderer?.actualVariant !== '404') issues.push(`route-passport:unknown-renderer:${key}`);
    if (!Array.isArray(result.h1) || result.h1.length !== 1 || !/noindex/iu.test(result.robots || '')) issues.push(`route-passport:unknown-identity:${key}`);
    for (const field of ['visibleSections', 'media', 'backgroundMedia', 'galleries', 'interactions', 'businessOccurrences', 'publicAssets', 'sourceOwners']) {
      if (!Array.isArray(result[field])) issues.push(`route-passport:unknown-${field}:${key}`);
    }
    if (!result.diagnostics || !Array.isArray(result.diagnostics.events) || !Array.isArray(result.diagnostics.localMedia)
      || !Array.isArray(result.diagnostics.resourceRequests) || result.diagnostics.adminAssetLeaks?.length
      || result.diagnostics.horizontalOverflow > 1 || result.diagnostics.brokenImages?.length
      || result.diagnostics.localMedia?.some((item) => !item.ok)) issues.push(`route-passport:unknown-diagnostics:${key}`);
    if (requireEditorCoverage) {
      if (result.editor?.status !== 'covered' || result.editor?.equivalence?.status !== 'pass'
        || result.editor?.invalidBindings?.length || !Array.isArray(result.editor?.bindingMultiplicity) || result.editor.bindingMultiplicity.length
        || result.editor?.occurrenceCoverage?.unclassified !== 0
        || result.editor?.mediaCoverage?.unclassified !== 0 || result.editor?.toolCoverage?.missing?.length) issues.push(`route-passport:unknown-editor:${key}`);
    }
  }
  for (const key of unknownExpected) if (!unknownSeen.has(key)) issues.push(`route-passport:unknown-missing:${key}`);
  return { ok: issues.length === 0, issues, expectedPairs: expectedPairs.size, seenPairs: seenPairs.size };
}

export function validatePublicActionEvidence(report, {
  authoritativeRoutes = defaultAuthoritativeRoutes()
} = {}) {
  const issues = [];
  if (report?.schemaVersion !== 1) issues.push('public-actions:schema-version');
  if (!report?.evidence?.sourceSHA) issues.push('public-actions:source-sha');
  if (report?.evidence?.dirty) issues.push('public-actions:dirty-source');
  if (!report?.evidence?.distFreshness?.fresh) issues.push('public-actions:stale-dist');
  if (!report?.evidence?.distFingerprintSHA256) issues.push('public-actions:dist-fingerprint');
  issues.push(...artifactEvidenceIssues(report, 'public-actions'));
  if (!report?.evidence?.analyticsAndLeadSubmissionBlocked) issues.push('public-actions:safety-boundary');
  if (report?.evidence?.browserSafety?.mode !== 'public-read-only') issues.push('public-actions:browser-safety-mode');
  if (report?.evidence?.emulation?.reducedMotion !== true || report?.evidence?.emulation?.deviceScaleFactor !== 1) {
    issues.push('public-actions:emulation-contract');
  }
  if ((report?.evidence?.browserSafety?.intercepted || []).some((request) => request.reason === 'state-changing-request'
    || /formspree\.io|web3forms\.com/iu.test(request.url || ''))) issues.push('public-actions:blocked-side-effect-attempt');
  const manifest = validateManifest(report, 'public-actions', authoritativeRoutes);
  issues.push(...manifest.issues);
  const expected = manifest.expected;
  const expectedPairs = new Set(expected.flatMap((route) => REQUIRED_VIEWPORTS.map((viewport) => pairKey(route, viewport.id))));
  const seenPairs = new Set();
  for (const routeResult of report?.routeResults || []) {
    const key = pairKey(routeResult.route, routeResult.viewport?.id);
    if (!expectedPairs.has(key)) issues.push(`public-actions:unexpected-pair:${key}`);
    if (seenPairs.has(key)) issues.push(`public-actions:duplicate-pair:${key}`);
    seenPairs.add(key);
    if (!viewportMatches(routeResult.viewport)) issues.push(`public-actions:viewport-contract:${key}`);
    if (routeResult.status !== 'pass') issues.push(`public-actions:failed:${key}`);
    if (routeResult.pageIdentity?.h1?.length !== 1 || !routeResult.pageIdentity?.bodyTextLength || routeResult.pageIdentity?.frameworkOverlay) {
      issues.push(`public-actions:page-identity:${key}`);
    }
    if (!Array.isArray(routeResult.actionResults)) issues.push(`public-actions:missing-registry:${key}`);
    for (const action of routeResult.actionResults || []) {
      const actionId = action.action?.id || '?';
      if (!action.policy) issues.push(`public-actions:missing-policy:${key}`);
      if (action.status !== 'pass') issues.push(`public-actions:action-failed:${key}:${actionId}`);
      if (['safe-ui-action', 'internal-link-action'].includes(action.policy)) {
        const modes = new Set((action.executions || []).filter((execution) => execution.status === 'pass').map((execution) => execution.mode));
        if (action.action?.visible && !action.action?.disabled && (!modes.has('click') || !modes.has('keyboard-enter'))) {
          issues.push(`public-actions:execution-gap:${key}:${actionId}`);
        }
      }
      if (action.policy === 'keyboard-focus-action') {
        const modes = new Set((action.executions || []).filter((execution) => execution.status === 'pass').map((execution) => execution.mode));
        if (!modes.has('keyboard-enter') || modes.has('click')) issues.push(`public-actions:keyboard-focus-gap:${key}:${actionId}`);
      }
      if (action.policy === 'safe-ui-action' && action.action?.visible && !action.action?.disabled
        && !action.action?.selected && (action.executions || []).some((execution) => execution.status === 'pass' && execution.observableChange !== true)) {
        issues.push(`public-actions:no-postcondition:${key}:${actionId}`);
      }
      if (action.policy === 'internal-link-action' && action.action?.visible && !action.action?.disabled
        && (action.executions || []).some((execution) => execution.status === 'pass' && (!execution.routeMatches || !execution.anchorMatches))) {
        issues.push(`public-actions:navigation-postcondition:${key}:${actionId}`);
      }
      if (['protected-form-action', 'external-link-no-launch', 'contact-protocol-format', 'new-context-or-download-no-launch'].includes(action.policy) && action.executions?.length) {
        issues.push(`public-actions:forbidden-execution:${key}:${actionId}`);
      }
      if (action.link?.status === 'fail') issues.push(`public-actions:link-failed:${key}:${actionId}`);
    }
  }
  for (const key of expectedPairs) if (!seenPairs.has(key)) issues.push(`public-actions:missing-pair:${key}`);
  if (report?.manifest?.concreteCoverage !== true) issues.push('public-actions:not-concrete-full-coverage');

  const noJsExpected = new Set(expected);
  const noJsSeen = new Set();
  for (const result of report?.noJsResults || []) {
    if (!noJsExpected.has(result.route)) issues.push(`public-actions:no-js-unexpected:${result.route}`);
    if (noJsSeen.has(result.route)) issues.push(`public-actions:no-js-duplicate:${result.route}`);
    noJsSeen.add(result.route);
    if (result.status !== 'pass') issues.push(`public-actions:no-js-failed:${result.route}`);
    if (!viewportMatches(result.viewport) || result.viewport.id !== REQUIRED_VIEWPORTS[0].id
      || result.documentStatus !== 200 || result.snapshot?.h1?.length !== 1
      || result.snapshot?.overflow > 1 || !Array.isArray(result.events) || result.events.length) {
      issues.push(`public-actions:no-js-contract:${result.route}`);
    }
  }
  for (const route of noJsExpected) if (!noJsSeen.has(route)) issues.push(`public-actions:no-js-missing:${route}`);

  const unknownExpected = new Set(REQUIRED_VIEWPORTS.map((viewport) => pairKey(REAL_UNKNOWN_ROUTE, viewport.id)));
  const unknownSeen = new Set();
  for (const routeResult of report?.unknownResults || []) {
    const key = pairKey(routeResult.route, routeResult.viewport?.id);
    if (!unknownExpected.has(key)) issues.push(`public-actions:unknown-unexpected:${key}`);
    if (unknownSeen.has(key)) issues.push(`public-actions:unknown-duplicate:${key}`);
    unknownSeen.add(key);
    if (!viewportMatches(routeResult.viewport) || routeResult.status !== 'pass' || routeResult.documentStatus !== 404
      || routeResult.pageIdentity?.h1?.length !== 1 || !/noindex/iu.test(routeResult.pageIdentity?.robots || '')
      || routeResult.pageIdentity?.overflow > 1 || routeResult.events?.length) issues.push(`public-actions:unknown-identity:${key}`);
    if (!Array.isArray(routeResult.actionResults)) issues.push(`public-actions:unknown-registry:${key}`);
    for (const action of routeResult.actionResults || []) {
      const actionId = action.action?.id || '?';
      if (!action.policy || action.status !== 'pass') issues.push(`public-actions:unknown-action:${key}:${actionId}`);
      if (['safe-ui-action', 'internal-link-action'].includes(action.policy) && action.action?.visible && !action.action?.disabled) {
        const modes = new Set((action.executions || []).filter((execution) => execution.status === 'pass').map((execution) => execution.mode));
        if (!modes.has('click') || !modes.has('keyboard-enter')) issues.push(`public-actions:unknown-execution-gap:${key}:${actionId}`);
      }
      if (action.policy === 'keyboard-focus-action') {
        const modes = new Set((action.executions || []).filter((execution) => execution.status === 'pass').map((execution) => execution.mode));
        if (!modes.has('keyboard-enter') || modes.has('click')) issues.push(`public-actions:unknown-keyboard-focus-gap:${key}:${actionId}`);
      }
      if (action.policy === 'safe-ui-action' && !action.action?.selected
        && (action.executions || []).some((execution) => execution.status === 'pass' && !execution.observableChange)) {
        issues.push(`public-actions:unknown-no-postcondition:${key}:${actionId}`);
      }
      if (['protected-form-action', 'external-link-no-launch', 'contact-protocol-format', 'new-context-or-download-no-launch'].includes(action.policy)
        && action.executions?.length) issues.push(`public-actions:unknown-forbidden-execution:${key}:${actionId}`);
    }
  }
  for (const key of unknownExpected) if (!unknownSeen.has(key)) issues.push(`public-actions:unknown-missing:${key}`);
  if (report?.unknownNoJsResult?.status !== 'pass' || report.unknownNoJsResult.documentStatus !== 404
    || report.unknownNoJsResult.snapshot?.h1?.length !== 1 || report.unknownNoJsResult.snapshot?.overflow > 1
    || !/noindex/iu.test(report.unknownNoJsResult.snapshot?.robots || '')
    || !Array.isArray(report.unknownNoJsResult.events) || report.unknownNoJsResult.events.length) {
    issues.push('public-actions:unknown-no-js');
  }
  return { ok: issues.length === 0, issues, expectedPairs: expectedPairs.size, seenPairs: seenPairs.size };
}

export function validateAdminActionEvidence(report, options = {}) {
  const requireIsolatedMutations = options.requireIsolatedMutations ?? false;
  const authoritativeModel = options.authoritativeModel || buildExpectedRouteModel();
  const authoritativeRoutes = options.authoritativeRoutes || authoritativeModel.routes.map((route) => route.pathname);
  const descriptors = options.authoritativeRoutes ? new Map() : new Map(authoritativeModel.routes.map((route) => [route.pathname, route]));
  const issues = [];
  if (report?.schemaVersion !== 1) issues.push('admin-actions:schema-version');
  if (!report?.evidence?.sourceSHA) issues.push('admin-actions:source-sha');
  if (report?.evidence?.dirty) issues.push('admin-actions:dirty-source');
  if (!report?.evidence?.loopbackOnly) issues.push('admin-actions:not-loopback');
  if (report?.evidence?.credentialsPersisted) issues.push('admin-actions:credentials-persisted');
  if (report?.evidence?.releaseActionsExecuted) issues.push('admin-actions:release-executed');
  if (report?.evidence?.browserSafety?.mode !== 'admin-no-release') issues.push('admin-actions:browser-safety');
  if (report?.evidence?.releaseMutationAttempts?.length) issues.push('admin-actions:release-attempted');
  if (requireIsolatedMutations && (!report?.evidence?.isolatedMutations || !report?.evidence?.isolationProof?.valid
    || !report.evidence.isolationProof.publishIntercepted || !report.evidence.isolationProof.sourceWritesDisposable)) {
    issues.push('admin-actions:isolation-proof');
  }
  if (!Array.isArray(report?.actionResults) || report.actionResults.length === 0) issues.push('admin-actions:empty');
  if (!Array.isArray(report?.events) || report.events.length) issues.push('admin-actions:global-errors');
  if (!report?.navigator?.exact || !exactArray(report.navigator.expected, authoritativeRoutes)
    || !exactArray(report.navigator.expected, report.navigator.discovered)) issues.push('admin-actions:navigator-manifest');
  const canvasSeen = new Set();
  for (const result of report?.canvasRouteResults || []) {
    if (!authoritativeRoutes.includes(result.route)) issues.push(`admin-actions:canvas-unexpected:${result.route}`);
    if (canvasSeen.has(result.route)) issues.push(`admin-actions:canvas-duplicate:${result.route}`);
    canvasSeen.add(result.route);
    const descriptor = descriptors.get(result.route);
    if (descriptor && (result.routeClass !== descriptor.routeClass || result.canonicalTarget !== descriptor.canonicalTarget)) {
      issues.push(`admin-actions:canvas-descriptor:${result.route}`);
    }
    if (result.status !== 'pass' || result.navigation?.mode !== 'click' || result.snapshot?.h1?.length !== 1) {
      issues.push(`admin-actions:canvas-failed:${result.route}`);
    }
    if (result.routeClass !== 'alias' && (!result.snapshot?.bindings || !result.snapshot?.bindingIds || !result.snapshot?.overlays
      || !result.contextual?.opened || !result.contextual?.controls || !result.contextual?.escapeClosed)) {
      issues.push(`admin-actions:canvas-tool-coverage:${result.route}`);
    }
    if (result.events?.length || result.requests?.some((request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method))) {
      issues.push(`admin-actions:canvas-side-effect:${result.route}`);
    }
  }
  for (const route of authoritativeRoutes) if (!canvasSeen.has(route)) issues.push(`admin-actions:canvas-missing:${route}`);
  if (!report?.evidence?.canvas?.ready || report.evidence.canvas.h1?.length !== 1
    || !report.evidence.canvas.bindings || !report.evidence.canvas.interactions) issues.push('admin-actions:canvas-not-ready');
  if (report?.evidence?.navigationAcceptance?.status !== 'pass'
    || report.evidence.navigationAcceptance.click?.mode !== 'click'
    || report.evidence.navigationAcceptance.keyboard?.mode !== 'keyboard-enter') {
    issues.push('admin-actions:navigation-acceptance');
  }
  const keys = new Set();
  for (const action of report?.actionResults || []) {
    if (keys.has(action.key)) issues.push(`admin-actions:duplicate:${action.key}`);
    keys.add(action.key);
    if (action.status !== 'pass') issues.push(`admin-actions:failed:${action.key}`);
    if (!action.policy) issues.push(`admin-actions:missing-policy:${action.key}`);
    if (action.policy === 'safe-ui-action' && action.action?.visible && !action.action?.disabled) {
      const modes = new Set((action.executions || []).filter((execution) => execution.status === 'pass' && execution.executable).map((execution) => execution.operation));
      if (!modes.has('click') || !modes.has('keyboard')) issues.push(`admin-actions:safe-execution-gap:${action.key}`);
      if ((action.executions || []).some((execution) => execution.status === 'pass' && (!execution.active || !execution.postcondition))) {
        issues.push(`admin-actions:safe-postcondition:${action.key}`);
      }
    }
    if (['release-intercept-required', 'requires-isolated-fixture', 'requires-file-fixture'].includes(action.policy) && action.executions?.length) {
      issues.push(`admin-actions:forbidden-execution:${action.key}`);
    }
    if (requireIsolatedMutations && action.policy === 'requires-isolated-fixture') issues.push(`admin-actions:mutation-deferred:${action.key}`);
    if (requireIsolatedMutations && action.policy === 'requires-file-fixture') issues.push(`admin-actions:file-fixture-deferred:${action.key}`);
    if (requireIsolatedMutations && action.policy === 'isolated-mutation' && !action.executions?.length) issues.push(`admin-actions:mutation-unexecuted:${action.key}`);
  }
  if (!(report?.aggregate?.discoveredContexts || []).some((context) => String(context).startsWith('iframe-'))) {
    issues.push('admin-actions:iframe-context-missing');
  }
  return { ok: issues.length === 0, issues, actions: report?.actionResults?.length || 0 };
}

export function validateVisualEditorAcceptanceEvidence(report, options = {}) {
  const issues = [];
  if (report?.schemaVersion !== 1) issues.push('visual-acceptance:schema-version');
  if (report?.kind !== 'h6-visual-editor-browser-acceptance') issues.push('visual-acceptance:kind');
  if (report?.runner?.browser !== 'CdpBrowser' || report?.runner?.safetyMode !== 'admin-no-release') {
    issues.push('visual-acceptance:runner-boundary');
  }
  const executionMode = report?.input?.executionMode;
  if (executionMode !== 'full'
    && !(options.allowRequiredResilienceOnly === true && executionMode === 'required-resilience-only')) {
    issues.push('visual-acceptance:execution-mode');
  }
  const isolation = report?.input?.isolation;
  if (!isolation?.sourceSHA || !isolation?.branch || isolation?.publishIntercepted !== true
    || isolation?.sourceWritesDisposable !== true || isolation?.testFaultsEnabled !== true
    || isolation?.deterministicExact !== true) {
    issues.push('visual-acceptance:isolation-proof');
  }
  if (options.expectedSourceSHA && isolation?.sourceSHA !== options.expectedSourceSHA) {
    issues.push('visual-acceptance:source-sha-mismatch');
  }
  if (report?.safety?.mode !== 'admin-no-release') issues.push('visual-acceptance:safety-mode');
  if (report?.releaseBoundary?.releaseMutationRequests?.length
    || report?.releaseBoundary?.interceptedMutationAttempts?.length
    || report?.releaseBoundary?.mutationRequestsAttempted !== 0
    || report?.releaseBoundary?.mutationRequestsReachedServer !== 0
    || report?.releaseBoundary?.mutationRequestsExecuted !== false) {
    issues.push('visual-acceptance:release-mutation');
  }
  if (report?.ok !== true || report?.aggregate?.failed !== 0) issues.push('visual-acceptance:failed');
  const scenarios = Array.isArray(report?.scenarios) ? report.scenarios : [];
  const byId = new Map();
  for (const scenario of scenarios) {
    if (!scenario?.id || byId.has(scenario.id)) issues.push(`visual-acceptance:duplicate-or-invalid-scenario:${scenario?.id || '?'}`);
    else byId.set(scenario.id, scenario);
  }
  for (const id of REQUIRED_VISUAL_ACCEPTANCE_SCENARIOS) {
    const scenario = byId.get(id);
    if (!scenario) {
      issues.push(`visual-acceptance:missing-scenario:${id}`);
      continue;
    }
    if (scenario.status !== 'pass' || scenario.issues?.length || scenario.errors?.length) {
      issues.push(`visual-acceptance:scenario-failed:${id}`);
    }
  }
  const evidence = (id) => byId.get(id)?.evidence || {};
  const conflict = evidence('two-tab-conflict');
  if (conflict.silentOverwriteBlocked !== true || conflict.serverConflictStatus !== 409
    || !conflict.mine?.title || !conflict.theirs?.title || !conflict.base?.title
    || conflict.canonical?.title !== conflict.theirs.title) {
    issues.push('visual-acceptance:two-tab-contract');
  }
  const exact = evidence('failed-exact-after-save');
  if (exact.saveCommitted !== true || exact.canonicalPreserved !== true
    || exact.exactFailed !== true || exact.previewBlocked !== true
    || exact.exact?.diagnostics?.code !== 'EXACT_TEST_INJECTED_FAILURE') {
    issues.push('visual-acceptance:failed-exact-contract');
  }
  const restore = evidence('history-restore-new-transaction');
  if (restore.newTransaction !== true || !restore.sourceTransactionId || !restore.restoredTransactionId
    || restore.restoresTransactionId !== restore.sourceTransactionId
    || restore.restoredTransactionId === restore.sourceTransactionId) {
    issues.push('visual-acceptance:history-restore-contract');
  }
  const backup = evidence('backup-failure-after-save');
  if (backup.backupFailureVisible !== true || backup.saveRemains !== true
    || backup.backup?.lastError?.code !== 'BACKUP_TEST_INJECTED_FAILURE') {
    issues.push('visual-acceptance:backup-failure-contract');
  }
  const roundTrip = evidence('export-import-lossless');
  if (roundTrip.losslessRoundTrip !== true || roundTrip.canApply !== false
    || roundTrip.normalizedEqual !== true || roundTrip.nonSkipRows?.length) {
    issues.push('visual-acceptance:export-import-contract');
  }
  const expired = evidence('expired-session-draft-recovery');
  if (expired.indexedDbDraftPreserved !== true || expired.draftRestoredAfterLogin !== true
    || expired.expired?.payload?.sessionExpired !== true) {
    issues.push('visual-acceptance:session-recovery-contract');
  }
  return { ok: issues.length === 0, issues, requiredScenarios: REQUIRED_VISUAL_ACCEPTANCE_SCENARIOS.length, seenScenarios: byId.size };
}

export function validateEvidenceIdentity({ routePassport, publicActions, adminActions, visualAcceptance, backupRestore }, { currentEvidence = null } = {}) {
  const issues = [];
  const reports = [routePassport, publicActions, adminActions,
    ...(visualAcceptance ? [visualAcceptance] : []),
    ...(backupRestore ? [backupRestore] : [])];
  const sourceOf = (report) => report?.evidence?.sourceSHA || report?.input?.isolation?.sourceSHA || report?.source?.sha || '';
  const branchOf = (report) => report?.evidence?.branch || report?.input?.isolation?.branch || report?.source?.branch || '';
  const sourceSHAs = new Set(reports.map(sourceOf).filter(Boolean));
  if (sourceSHAs.size !== 1 || reports.some((report) => !sourceOf(report))) issues.push('identity:source-sha-mismatch');
  const branches = new Set(reports.map(branchOf).filter(Boolean));
  if (branches.size !== 1 || reports.some((report) => !branchOf(report))) issues.push('identity:branch-mismatch');
  const routePassportBasePath = normalizedEvidenceBasePath(routePassport?.evidence?.basePath);
  const publicActionsBasePath = normalizedEvidenceBasePath(publicActions?.evidence?.basePath);
  if (!routePassportBasePath || !publicActionsBasePath || routePassportBasePath !== publicActionsBasePath) {
    issues.push('identity:base-path-mismatch');
  }
  if (routePassport?.evidence?.distFingerprintSHA256 !== publicActions?.evidence?.distFingerprintSHA256) {
    issues.push('identity:dist-fingerprint-mismatch');
  }
  if (!exactArray(routePassport?.evidence?.htmlFileHashes, publicActions?.evidence?.htmlFileHashes)) {
    issues.push('identity:html-hashes-mismatch');
  }
  if (!Array.isArray(routePassport?.evidence?.htmlFileHashes) || routePassport.evidence.htmlFileHashes.length === 0
    || !Array.isArray(publicActions?.evidence?.htmlFileHashes) || publicActions.evidence.htmlFileHashes.length === 0) {
    issues.push('identity:html-hashes-missing');
  }
  if (routePassport?.evidence?.artifactFingerprintSHA256 !== publicActions?.evidence?.artifactFingerprintSHA256) {
    issues.push('identity:artifact-fingerprint-mismatch');
  }
  if (!exactArray(routePassport?.evidence?.artifactFileHashes, publicActions?.evidence?.artifactFileHashes)) {
    issues.push('identity:artifact-hashes-mismatch');
  }
  if (!Array.isArray(routePassport?.evidence?.artifactFileHashes) || routePassport.evidence.artifactFileHashes.length === 0
    || !Array.isArray(publicActions?.evidence?.artifactFileHashes) || publicActions.evidence.artifactFileHashes.length === 0) {
    issues.push('identity:artifact-hashes-missing');
  }
  if (!exactArray(routePassport?.manifest?.expected, publicActions?.manifest?.expected)) {
    issues.push('identity:manifest-mismatch');
  }
  if (currentEvidence) {
    if (currentEvidence.dirty) issues.push('identity:current-checkout-dirty');
    if (!currentEvidence.sourceSHA || currentEvidence.sourceSHA !== routePassport?.evidence?.sourceSHA) issues.push('identity:current-source-sha-mismatch');
    if (!currentEvidence.branch || currentEvidence.branch !== routePassport?.evidence?.branch) issues.push('identity:current-branch-mismatch');
    if (!currentEvidence.artifactFingerprintSHA256
      || currentEvidence.artifactFingerprintSHA256 !== routePassport?.evidence?.artifactFingerprintSHA256) {
      issues.push('identity:current-artifact-fingerprint-mismatch');
    }
    if (!exactArray(currentEvidence.artifactFileHashes, routePassport?.evidence?.artifactFileHashes)) {
      issues.push('identity:current-artifact-hashes-mismatch');
    }
    if (!currentEvidence.distFingerprintSHA256
      || currentEvidence.distFingerprintSHA256 !== routePassport?.evidence?.distFingerprintSHA256) {
      issues.push('identity:current-html-fingerprint-mismatch');
    }
    if (!exactArray(currentEvidence.htmlFileHashes, routePassport?.evidence?.htmlFileHashes)) {
      issues.push('identity:current-html-hashes-mismatch');
    }
  }
  return { ok: issues.length === 0, issues, sourceSHA: [...sourceSHAs][0] || null };
}

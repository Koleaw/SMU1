import { createHash } from 'node:crypto';
import {
  buildExpectedRouteModel,
  REQUIRED_VIEWPORTS,
  REAL_UNKNOWN_ROUTE
} from './route-passport-model.mjs';
import {
  FULL_VISUAL_ACCEPTANCE_SCENARIOS,
  REQUIRED_RESILIENCE_VISUAL_ACCEPTANCE_SCENARIOS,
  expectedVisualAcceptanceScenarios,
  visualAcceptanceScenarioSetIssues
} from './visual-editor-scenarios.mjs';

const pairKey = (route, viewport) => `${route}@@${viewport}`;
const canonicalJson = (value) => JSON.stringify(value);
const exactArray = (left, right) => canonicalJson(left) === canonicalJson(right);
export const PUBLIC_LIFECYCLE_SEMANTIC_IDS = Object.freeze([
  'home-video',
  'cookie-notice',
  'contacts-map'
]);
const normalizedEvidenceBasePath = (value) => {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw === '/') return '/';
  if (raw.includes('\\') || raw.includes('?') || raw.includes('#')) return null;
  const normalized = `/${raw.replace(/^\/+|\/+$/gu, '')}`;
  return normalized.split('/').some((part) => part === '.' || part === '..') ? null : normalized;
};
const canonicalEvidencePath = (value, basePath, expectedOrigin) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.origin !== expectedOrigin || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const pathname = parsed.pathname;
    if (basePath === '/') return pathname;
    if (pathname === basePath) return '/';
    return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) || '/' : null;
  } catch {
    return null;
  }
};
const robotsDirectives = (value) => new Set(String(value || '').toLowerCase().split(/[,\s]+/u).filter(Boolean));
const routeSeoEvidenceIssues = (result, key, basePath, canonicalOrigin) => {
  const issues = [];
  const policy = result?.canonicalPolicy;
  const hasCanonicalEvidence = Object.hasOwn(result || {}, 'canonical') && typeof result.canonical === 'string';
  const hasRobotsEvidence = Boolean(Object.hasOwn(result || {}, 'robots') && typeof result.robots === 'string' && result.robots.trim());
  const canonical = hasCanonicalEvidence ? String(result.canonical || '').trim() : null;
  const directives = robotsDirectives(result?.robots);
  if (!hasCanonicalEvidence) issues.push(`route-passport:canonical-evidence:${key}`);
  if (!hasRobotsEvidence) issues.push(`route-passport:robots-evidence:${key}`);

  if (policy === 'suppressed-noindex-preview') {
    if (canonical !== '') issues.push(`route-passport:preview-canonical:${key}`);
    if (!directives.has('noindex')) issues.push(`route-passport:preview-robots:${key}`);
    return issues;
  }
  if (policy !== 'required-production-canonical') {
    issues.push(`route-passport:canonical-policy:${key}`);
    return issues;
  }

  if (result.routeClass === '404') {
    if (canonical !== '') issues.push(`route-passport:production-404-canonical:${key}`);
    if (!directives.has('noindex')) issues.push(`route-passport:production-404-robots:${key}`);
    return issues;
  }
  if (!['canonical', 'alias'].includes(result.routeClass)) {
    issues.push(`route-passport:production-route-class:${key}`);
    return issues;
  }
  const expectedPath = result.routeClass === 'alias' ? result.canonicalTarget : result.route;
  const actualPath = canonicalEvidencePath(canonical, basePath, canonicalOrigin);
  if (!actualPath || actualPath !== expectedPath) issues.push(`route-passport:production-canonical:${key}`);
  if (result.routeClass === 'alias') {
    if (!directives.has('noindex') || !directives.has('nofollow') || !directives.has('noarchive')
      || directives.has('index') || directives.has('follow') || directives.has('none')) {
      issues.push(`route-passport:production-alias-robots:${key}`);
    }
    return issues;
  }
  if (!directives.has('index') || !directives.has('follow')
    || directives.has('noindex') || directives.has('nofollow') || directives.has('none')) {
    issues.push(`route-passport:production-robots:${key}`);
  }
  return issues;
};
const defaultAuthoritativeRoutes = () => buildExpectedRouteModel().routes.map((route) => route.pathname);
export const REQUIRED_VISUAL_ACCEPTANCE_SCENARIOS = FULL_VISUAL_ACCEPTANCE_SCENARIOS;
export { REQUIRED_RESILIENCE_VISUAL_ACCEPTANCE_SCENARIOS };
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
  const evidenceBasePath = normalizedEvidenceBasePath(report?.evidence?.basePath);
  if (report?.schemaVersion !== 1) issues.push('route-passport:schema-version');
  if (!report?.evidence?.sourceSHA) issues.push('route-passport:source-sha');
  if (report?.evidence?.dirty) issues.push('route-passport:dirty-source');
  if (!report?.evidence?.distFreshness?.fresh) issues.push('route-passport:stale-dist');
  if (!report?.evidence?.distFingerprintSHA256) issues.push('route-passport:dist-fingerprint');
  if (report?.evidence?.browserSafety?.mode !== 'public-read-only') issues.push('route-passport:browser-safety');
  if (evidenceBasePath === null) issues.push('route-passport:base-path');
  issues.push(...artifactEvidenceIssues(report, 'route-passport'));
  const manifest = validateManifest(report, 'route-passport', authoritativeRoutes);
  issues.push(...manifest.issues);
  const expected = manifest.expected;
  const expectedPairs = new Set(expected.flatMap((route) => REQUIRED_VIEWPORTS.map((viewport) => pairKey(route, viewport.id))));
  const seenPairs = new Set();
  const canonicalPolicies = new Set((report?.routeResults || []).map((result) => result?.canonicalPolicy));
  if (canonicalPolicies.size !== 1) issues.push('route-passport:mixed-canonical-policy');
  const productionCanonicalPolicy = canonicalPolicies.size === 1 && canonicalPolicies.has('required-production-canonical');
  let canonicalOrigin = '';
  if (productionCanonicalPolicy) {
    try {
      const parsed = new URL(String(report?.evidence?.canonicalOrigin || ''));
      if (parsed.protocol !== 'https:' || parsed.origin !== report.evidence.canonicalOrigin || parsed.pathname !== '/') {
        issues.push('route-passport:canonical-origin');
      } else canonicalOrigin = parsed.origin;
    } catch {
      issues.push('route-passport:canonical-origin');
    }
  }
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
    issues.push(...routeSeoEvidenceIssues(result, key, evidenceBasePath || '/', canonicalOrigin));
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
      if (!Array.isArray(result.editor?.expectedDocumentEvents)) issues.push(`route-passport:editor-expected-document-events:${key}`);
      if (result.routeClass === '404' && !result.editor?.expectedDocumentEvents?.some((event) =>
        event.kind === 'http-response' && event.status === 404 && event.resourceType === 'Document')) {
        issues.push(`route-passport:editor-404-document-evidence:${key}`);
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
        || result.editor?.mediaCoverage?.unclassified !== 0 || result.editor?.toolCoverage?.missing?.length
        || !Array.isArray(result.editor?.events)
        || result.editor.events.some((event) => !['console-warning', 'log-warning'].includes(event.kind))
        || !Array.isArray(result.editor?.expectedDocumentEvents)
        || !result.editor.expectedDocumentEvents.some((event) => event.kind === 'http-response' && event.status === 404 && event.resourceType === 'Document')) {
        issues.push(`route-passport:unknown-editor:${key}`);
      }
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
  const requiredLifecycleIds = [
    ...(expected.includes('/') ? ['home-video', 'cookie-notice'] : []),
    ...(expected.includes('/kontakty/') ? ['contacts-map'] : [])
  ];
  const lifecycleSemantics = Array.isArray(report?.publicLifecycleSemantics) ? report.publicLifecycleSemantics : [];
  const lifecycleSeen = new Set();
  let lifecycleSemanticsPassed = 0;
  let lifecycleSemanticsFailed = 0;
  for (const semantic of lifecycleSemantics) {
    const id = semantic?.id || '?';
    if (!requiredLifecycleIds.includes(id)) issues.push(`public-actions:lifecycle-unexpected:${id}`);
    if (lifecycleSeen.has(id)) issues.push(`public-actions:lifecycle-duplicate:${id}`);
    lifecycleSeen.add(id);
    const expectedRoute = id === 'contacts-map' ? '/kontakty/' : '/';
    if (semantic?.route !== expectedRoute || semantic?.status !== 'pass'
      || !Array.isArray(semantic?.issues) || semantic.issues.length
      || !Array.isArray(semantic?.events) || semantic.events.length) {
      issues.push(`public-actions:lifecycle-status:${id}`);
    }
    if (semantic?.status === 'pass') lifecycleSemanticsPassed += 1;
    else lifecycleSemanticsFailed += 1;
    const safety = semantic?.safety;
    if (safety?.stateChangingRequests !== 0 || safety?.leadOrAnalyticsRequests !== 0 || safety?.interceptedAttempts !== 0) {
      issues.push(`public-actions:lifecycle-safety:${id}`);
    }

    if (id === 'home-video') {
      const normal = semantic?.evidence?.normalMotion;
      const reduced = semantic?.evidence?.reducedMotion;
      const saveData = semantic?.evidence?.saveData;
      if (normal?.reducedMotion !== false || normal?.saveData !== false || normal?.controlReady !== true
        || normal?.sourceLoaded !== true || !(normal?.videoRequestCount > 0)
        || normal?.playingBeforePause !== true || normal?.pausedAfterPause !== true || normal?.playingAfterResume !== true
        || !/включить видео/iu.test(normal?.labelAfterPause || '') || !/пауза видео/iu.test(normal?.labelAfterResume || '')
        || !/включить фоновое видео/iu.test(normal?.ariaAfterPause || '')
        || !/приостановить фоновое видео/iu.test(normal?.ariaAfterResume || '')) {
        issues.push('public-actions:lifecycle-home-video-normal');
      }
      for (const [profile, value] of [['reduced-motion', reduced], ['save-data', saveData]]) {
        const profileIdentity = profile === 'reduced-motion'
          ? value?.reducedMotion === true && value?.saveData === false
          : value?.reducedMotion === false && value?.saveData === true;
        if (!profileIdentity || value?.controlReady !== true || value?.sourceLoaded !== false || value?.videoRequestCount !== 0) {
          issues.push(`public-actions:lifecycle-home-video-${profile}`);
        }
        const explicit = value?.explicitPlayback;
        if (explicit?.controlReady !== true || explicit?.sourceLoaded !== true || !(explicit?.videoRequestCount > 0)
          || explicit?.playing !== true || !Number.isFinite(explicit?.startTime) || !Number.isFinite(explicit?.advancedTime)
          || !(explicit.advancedTime > explicit.startTime + 0.05) || explicit?.pausedAfterPause !== true
          || !Number.isFinite(explicit?.pausedTime) || !Number.isFinite(explicit?.settledPauseTime)
          || Math.abs(explicit.settledPauseTime - explicit.pausedTime) > 0.1
          || !/включить видео/iu.test(explicit?.labelAfterPause || '')
          || !/включить фоновое видео/iu.test(explicit?.ariaAfterPause || '')) {
          issues.push(`public-actions:lifecycle-home-video-${profile}-explicit-playback`);
        }
      }
    } else if (id === 'cookie-notice') {
      const initial = semantic?.evidence?.initial;
      const dismissed = semantic?.evidence?.dismissed;
      const persisted = semantic?.evidence?.persistedReload;
      const reopened = semantic?.evidence?.footerReopen;
      if (initial?.visible !== true || initial?.noticeKey !== null || initial?.legacyKey !== null
        || dismissed?.hidden !== true || dismissed?.noticeKey !== 'true'
        || persisted?.hidden !== true || persisted?.noticeKey !== 'true'
        || reopened?.visible !== true || reopened?.noticeKey !== null || reopened?.legacyKey !== null) {
        issues.push('public-actions:lifecycle-cookie-order');
      }
    } else if (id === 'contacts-map') {
      const before = semantic?.evidence?.before;
      const activation = semantic?.evidence?.activation;
      const terminal = semantic?.evidence?.terminal;
      if (before?.state !== 'idle' || before?.iframeCount !== 0 || before?.placeholderVisible !== true
        || before?.activateEnabled !== true || activation?.clicked !== true) {
        issues.push('public-actions:lifecycle-map-deferred');
      }
      const ready = terminal?.state === 'ready' && terminal?.iframeCount > 0
        && terminal?.placeholderVisible === false && Boolean(terminal?.statusText)
        && Boolean(terminal?.iframeTitle) && terminal?.iframeTabIndex === '0' && terminal?.focusTarget === 'iframe';
      const failOpen = terminal?.state === 'error' && terminal?.iframeCount === 0
        && terminal?.placeholderVisible === true && terminal?.activateEnabled === true
        && Boolean(terminal?.statusText) && terminal?.focusTarget === 'activate';
      if (!ready && !failOpen) issues.push('public-actions:lifecycle-map-terminal');
    }
  }
  for (const id of requiredLifecycleIds) if (!lifecycleSeen.has(id)) issues.push(`public-actions:lifecycle-missing:${id}`);
  const expectedPairs = new Set(expected.flatMap((route) => REQUIRED_VIEWPORTS.map((viewport) => pairKey(route, viewport.id))));
  const seenPairs = new Set();
  const gallerySemanticCoverage = new Set();
  let actionOccurrences = 0;
  let safeExecutions = 0;
  let gallerySemanticOccurrences = 0;
  let gallerySemanticPassed = 0;
  let gallerySemanticFailed = 0;
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
    if (!Array.isArray(routeResult.actionResults) || routeResult.actionResults.length === 0) issues.push(`public-actions:missing-or-empty-registry:${key}`);
    if (routeResult.actionCount !== routeResult.actionResults?.length) issues.push(`public-actions:action-count:${key}`);
    actionOccurrences += routeResult.actionResults?.length || 0;
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
      safeExecutions += action.executions?.length || 0;
    }
    const inventory = routeResult.pageIdentity?.galleryInventory;
    const productGalleries = Array.isArray(inventory?.product) ? inventory.product : null;
    const projectGalleries = Array.isArray(inventory?.project) ? inventory.project : null;
    const semanticResults = Array.isArray(routeResult.gallerySemantics?.results) ? routeResult.gallerySemantics.results : null;
    if (!productGalleries || !projectGalleries || !semanticResults) {
      issues.push(`public-actions:gallery-semantic-registry:${key}`);
    } else {
      const expectedGalleries = [...productGalleries, ...projectGalleries];
      if (semanticResults.length !== expectedGalleries.length) issues.push(`public-actions:gallery-semantic-count:${key}`);
      const expectedMode = routeResult.viewport?.mobile ? 'mobile-swipe' : 'desktop-lightbox';
      const expectedByKey = new Map(expectedGalleries.map((item) => [`${item.kind}:${item.index}`, item]));
      const seenGallery = new Set();
      for (const semantic of semanticResults) {
        const semanticKey = `${semantic?.kind}:${semantic?.index}`;
        if (!expectedByKey.has(semanticKey) || seenGallery.has(semanticKey) || semantic.mode !== expectedMode) {
          issues.push(`public-actions:gallery-semantic-identity:${key}:${semanticKey}`);
          continue;
        }
        seenGallery.add(semanticKey);
        const gallery = expectedByKey.get(semanticKey);
        const expectedStatus = routeResult.viewport?.mobile && gallery.multiple !== true ? 'not-applicable' : 'pass';
        if (semantic.status !== expectedStatus) issues.push(`public-actions:gallery-semantic-failed:${key}:${semanticKey}`);
        gallerySemanticOccurrences += 1;
        if (semantic.status === 'pass') {
          gallerySemanticPassed += 1;
          gallerySemanticCoverage.add(`${semantic.kind}:${semantic.mode}`);
        } else if (semantic.status === 'fail') gallerySemanticFailed += 1;
      }
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
    if (!Array.isArray(routeResult.actionResults) || routeResult.actionResults.length === 0) issues.push(`public-actions:unknown-empty-registry:${key}`);
    if (routeResult.actionCount !== routeResult.actionResults?.length) issues.push(`public-actions:unknown-action-count:${key}`);
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
  if (report?.aggregate?.actionOccurrences !== actionOccurrences
    || report?.aggregate?.safeExecutions !== safeExecutions
    || report?.aggregate?.gallerySemanticOccurrences !== gallerySemanticOccurrences
    || report?.aggregate?.gallerySemanticPassed !== gallerySemanticPassed
    || report?.aggregate?.gallerySemanticFailed !== gallerySemanticFailed
    || report?.aggregate?.lifecycleSemanticOccurrences !== lifecycleSemantics.length
    || report?.aggregate?.lifecycleSemanticsPassed !== lifecycleSemanticsPassed
    || report?.aggregate?.lifecycleSemanticsFailed !== lifecycleSemanticsFailed) {
    issues.push('public-actions:aggregate-counts');
  }
  if (expected.length >= 100) {
    for (const required of ['product:desktop-lightbox', 'product:mobile-swipe', 'project:desktop-lightbox', 'project:mobile-swipe']) {
      if (!gallerySemanticCoverage.has(required)) issues.push(`public-actions:gallery-semantic-coverage:${required}`);
    }
  }
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
  const navigationDialogs = Array.isArray(report?.evidence?.browserSafety?.navigationDialogs)
    ? report.evidence.browserSafety.navigationDialogs
    : [];
  const baselineResets = Array.isArray(report?.evidence?.baselineResets) ? report.evidence.baselineResets : null;
  const resetDialogs = baselineResets?.flatMap((reset) => Array.isArray(reset?.dialogs) ? reset.dialogs : []) || [];
  const resetPreflightValid = baselineResets?.every((reset) => {
    const preflight = reset?.preflight || {};
    const dialogs = Array.isArray(reset?.dialogs) ? reset.dialogs : [];
    const evidencedDurableState = preflight.mediaQueueRunning !== true
      && Number(preflight.pendingMediaQueues || 0) > 0
      && Number(preflight.durableMediaQueues || 0) > 0
      && Number(preflight.volatileMediaQueues || 0) === 0;
    const expectedDialogCount = preflight.acceptBeforeUnload === true ? 1 : 0;
    return dialogs.length === expectedDialogCount
      && dialogs.every((dialog) => dialog?.accepted === true
        && dialog.type === 'beforeunload'
        && evidencedDurableState);
  }) === true;
  if (report?.evidence?.resetEvidenceValid !== true || !baselineResets || !resetPreflightValid
    || report?.evidence?.dialogAudit?.drained !== true
    || report?.evidence?.dialogAudit?.error
    || Number(report?.evidence?.dialogAudit?.unexpected || 0) !== 0
    || navigationDialogs.some((dialog) => dialog?.accepted !== true || dialog.type !== 'beforeunload')
    || JSON.stringify(navigationDialogs) !== JSON.stringify(resetDialogs)) {
    issues.push('admin-actions:reset-evidence');
  }
  if (report?.evidence?.releaseMutationAttempts?.length) issues.push('admin-actions:release-attempted');
  if (requireIsolatedMutations && (!report?.evidence?.isolatedMutations || !report?.evidence?.isolationProof?.valid
    || !report.evidence.isolationProof.publishIntercepted || !report.evidence.isolationProof.sourceWritesDisposable)) {
    issues.push('admin-actions:isolation-proof');
  }
  if (!Array.isArray(report?.actionResults) || report.actionResults.length === 0) issues.push('admin-actions:empty');
  if (!Array.isArray(report?.events) || report.events.length) issues.push('admin-actions:global-errors');
  if (!report?.navigator?.exact || !exactArray(report.navigator.expected, authoritativeRoutes)
    || !exactArray(report.navigator.expected, report.navigator.discovered)) issues.push('admin-actions:navigator-manifest');
  if (report?.navigator?.rawDiscovered) {
    const excluded = report.navigator.excludedUnpublished || [];
    if (excluded.some((route) => !(authoritativeModel.editorOnlyRoutes || []).includes(route))
      || !exactArray([...report.navigator.rawDiscovered].sort(), [...report.navigator.discovered, ...excluded].sort())) {
      issues.push('admin-actions:navigator-unpublished-reconciliation');
    }
  }
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
    if (result.routeClass === 'alias'
      && (!result.snapshot?.aliasBridgeReady || !result.snapshot?.aliasBridgeRevisionMatch
        || result.snapshot?.overlays !== 0 || !result.snapshot?.canvasHint?.includes(result.canonicalTarget))) {
      issues.push(`admin-actions:alias-editable:${result.route}`);
    }
    if (result.events?.length || result.requests?.some((request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method))) {
      issues.push(`admin-actions:canvas-side-effect:${result.route}`);
    }
  }
  for (const route of authoritativeRoutes) if (!canvasSeen.has(route)) issues.push(`admin-actions:canvas-missing:${route}`);
  const homeCanvas = report?.evidence?.canvas;
  if (!homeCanvas?.ready || homeCanvas.h1?.length !== 1
    || !homeCanvas.bindings || !homeCanvas.interactions || !homeCanvas.overlays
    || !homeCanvas.editorSessionShape || !homeCanvas.editorRevisionShape) issues.push('admin-actions:canvas-not-ready');
  const serializedAdminActionReport = JSON.stringify(report || {});
  if (Object.hasOwn(homeCanvas || {}, 'editorSession')
    || /"(?:editorSession|csrf|token|secret|password)"\s*:/iu.test(serializedAdminActionReport)
    || /[?&](?:editorSession|csrf|token|secret|password)=/iu.test(serializedAdminActionReport)) {
    issues.push('admin-actions:canvas-session-leak');
  }
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
  const expectedScenarios = expectedVisualAcceptanceScenarios(executionMode);
  const registry = visualAcceptanceScenarioSetIssues(scenarios.map((scenario) => scenario?.id), executionMode);
  if (!registry.ok) {
    for (const id of registry.missing) issues.push(`visual-acceptance:missing-scenario:${id}`);
    for (const id of registry.unexpected) issues.push(`visual-acceptance:unexpected-scenario:${id}`);
    if (registry.duplicates.length) issues.push(`visual-acceptance:duplicate-scenarios:${registry.duplicates.join(',')}`);
    if (scenarios.length !== expectedScenarios.length) issues.push('visual-acceptance:scenario-count');
  }
  for (const id of expectedScenarios) {
    const scenario = byId.get(id);
    if (!scenario) {
      continue;
    }
    if (scenario.status !== 'pass' || scenario.issues?.length || scenario.errors?.length) {
      issues.push(`visual-acceptance:scenario-failed:${id}`);
    }
  }
  if (report?.aggregate?.scenarios !== expectedScenarios.length
    || report?.aggregate?.checks !== expectedScenarios.length + 2
    || report?.aggregate?.passed !== expectedScenarios.length + 2
    || report?.aggregate?.failed !== 0
    || !Array.isArray(report?.aggregate?.failedIds)
    || report.aggregate.failedIds.length) {
    issues.push('visual-acceptance:aggregate-counts');
  }
  const evidence = (id) => byId.get(id)?.evidence || {};
  if (byId.has('reload-recovery')) {
    const recovery = evidence('reload-recovery');
    const navigation = recovery.recoveryNavigation || {};
    const dialogs = Array.isArray(navigation.dialogs) ? navigation.dialogs : [];
    if (recovery.beforeUnloadDialogAccepted !== true
      || navigation.allowed !== true
      || navigation.storedMediaQueue?.intentVersion !== 2
      || !navigation.storedMediaQueue?.baselineFingerprint
      || navigation.preflight?.running !== false
      || Number(navigation.preflight?.pending || 0) < 1
      || Number(navigation.preflight?.durable || 0) < 1
      || Number(navigation.preflight?.volatile || 0) !== 0
      || dialogs.length !== 1
      || dialogs[0]?.type !== 'beforeunload'
      || dialogs[0]?.accepted !== true) {
      issues.push('visual-acceptance:reload-recovery-contract');
    }
  }
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
  const expectedActionDialogs = [
    { evidence: restore.confirmation, kind: 'history-restore' },
    { evidence: conflict.confirmation, kind: 'discard-conflicting-drafts' }
  ];
  if (expectedActionDialogs.some(({ evidence: confirmation, kind }) => confirmation?.type !== 'confirm'
    || confirmation.accepted !== true || confirmation.kind !== kind || confirmation.reason !== `qa-isolated-${kind}`)
    || !Array.isArray(report?.safety?.actionDialogs)
    || JSON.stringify(report.safety.actionDialogs) !== JSON.stringify(expectedActionDialogs.map(entry => entry.evidence))) {
    issues.push('visual-acceptance:action-confirmation-contract');
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
  if (byId.has('link-label-href-independent')) {
    const link = evidence('link-label-href-independent');
    const binding = link.binding || {};
    if (link.navigation?.selectedRoute !== '/'
      || binding.ownerCollection !== 'static-pages' || binding.ownerSlug !== 'home'
      || binding.fieldPath !== 'heroPrimaryLabel' || binding.hrefPath !== 'heroPrimaryHref'
      || binding.fieldPath === binding.hrefPath || binding.tool !== 'link' || !binding.bindingId
      || link.inspector?.open !== true || link.inspector?.addressField !== 'Адрес ссылки'
      || !Array.isArray(link.inspector?.fields) || link.inspector.fields.length !== 2
      || !link.original?.label || !link.original?.hrefAttribute
      || link.afterLabel?.label === link.original.label
      || link.afterLabel?.hrefAttribute !== link.original.hrefAttribute
      || link.afterHref?.label !== link.afterLabel?.label
      || !link.afterHref?.hrefAttribute || link.afterHref.hrefAttribute === link.afterLabel?.hrefAttribute
      || link.afterHref?.pathname !== '/kontakty/'
      || link.restored?.exact !== true
      || link.restored?.label !== link.original.label || link.restored?.hrefAttribute !== link.original.hrefAttribute
      || link.noSaveOrBuildRequested !== true
      || !Array.isArray(link.saveOrBuildRequests) || link.saveOrBuildRequests.length) {
      issues.push('visual-acceptance:link-label-href-contract');
    }
  }
  if (byId.has('global-phone-authoritative-impact')) {
    const phone = evidence('global-phone-authoritative-impact');
    const binding = phone.binding || {};
    const normalizeRoutes = (values) => [...new Set((Array.isArray(values) ? values : []).map(String))]
      .sort((left, right) => left.localeCompare(right, 'en'));
    const expectedRoutes = normalizeRoutes(defaultAuthoritativeRoutes());
    const authoritativeRoutes = normalizeRoutes(phone.authoritativeRoutes);
    const displayedRoutes = normalizeRoutes(phone.displayedRoutes);
    const displayedHasDuplicates = Array.isArray(phone.displayedRoutes)
      && displayedRoutes.length !== phone.displayedRoutes.length;
    if (phone.navigation?.selectedRoute !== '/'
      || binding.ownerCollection !== 'site-settings' || binding.ownerSlug !== 'global'
      || binding.fieldPath !== 'phonePrimary' || binding.tool !== 'link'
      || binding.scope !== 'global' || !exactArray(binding.affectedRoutes, ['*'])
      || phone.provenance?.visible !== true
      || !/^Используется на \d+ страницах$/u.test(String(phone.provenance?.label || ''))
      || Number(phone.provenance?.declaredCount || 0) !== expectedRoutes.length
      || !exactArray(authoritativeRoutes, expectedRoutes)
      || !exactArray(displayedRoutes, expectedRoutes) || displayedHasDuplicates
      || !exactArray(normalizeRoutes(phone.uniqueDisplayedRoutes), expectedRoutes)
      || phone.exactAuthoritativeImpact !== true) {
      issues.push('visual-acceptance:global-phone-impact-contract');
    }
  }
  if (byId.has('project-media-role-independence')) {
    const projectMedia = evidence('project-media-role-independence');
    const binding = projectMedia.binding || {};
    const original = projectMedia.original || {};
    const firstDraft = projectMedia.firstDraft || {};
    const secondDraft = projectMedia.secondDraft || {};
    const uploadedPaths = Array.isArray(projectMedia.uploadedPaths) ? projectMedia.uploadedPaths : [];
    const cover = projectMedia.explicitAssignments?.cover || {};
    const hero = projectMedia.explicitAssignments?.hero || {};
    const explicitRows = projectMedia.explicitAssignments?.rows || {};
    const cleanGallery = projectMedia.cleanExistingGallery || {};
    const mediaCas = projectMedia.mediaCasConflict || {};
    const emptyRemoval = projectMedia.emptyRemoval || {};
    const defaultRolesValid = Array.isArray(projectMedia.defaultRoleRows)
      && projectMedia.defaultRoleRows.length === 2
      && projectMedia.defaultRoleRows.every((row) => exactArray(row?.roles, ['gallery']));
    if (!binding.recordSlug
      || projectMedia.navigation?.selectedRoute !== `/vypolnennye-obekty/${binding.recordSlug}/`
      || binding.ownerCollection !== 'projects' || binding.fieldPath !== 'gallery'
      || binding.tool !== 'gallery' || binding.role !== 'missing-project-media'
      || original.status !== 200 || original.archiveCoverMedia !== '' || original.detailHeroMedia !== ''
      || !Array.isArray(original.publicGallery) || original.publicGallery.length
      || !defaultRolesValid || projectMedia.doubleSubmitAttempted !== true || Number(projectMedia.firstStageRequestCount || 0) !== 2
      || !Array.isArray(projectMedia.firstStageRequests) || projectMedia.firstStageRequests.length !== 2
      || projectMedia.firstStageRequests.some((request) => request?.method !== 'POST' || !String(request?.url?.pathname || '').endsWith('/media/staging'))
      || uploadedPaths.length !== 2 || new Set(uploadedPaths).size !== 2 || uploadedPaths.some((value) => !String(value).startsWith('/'))
      || !exactArray(firstDraft.publicGallery, uploadedPaths)
      || firstDraft.archiveCoverMedia !== original.archiveCoverMedia
      || firstDraft.detailHeroMedia !== original.detailHeroMedia
      || Number(firstDraft.rawGalleryCount) !== Number(original.rawGalleryCount) + 2
      || cleanGallery.recoveryRow !== null
      || cleanGallery.state?.dirty !== false
      || Number(cleanGallery.state?.pending || 0) !== 0
      || Number(cleanGallery.state?.durable || 0) !== 0
      || Number(cleanGallery.state?.volatile || 0) !== 0
      || !Array.isArray(cleanGallery.navigationDialogs) || cleanGallery.navigationDialogs.length
      || mediaCas.silentOverwriteBlocked !== true || mediaCas.controlsFrozen !== true
      || mediaCas.conflictSurvivedReopen !== true || mediaCas.cleanup?.clean !== true
      || mediaCas.mine?.minePresent !== true || mediaCas.mine?.queueTokenPresent !== true || Number(mediaCas.mine?.queueRevision || 0) < 1
      || mediaCas.peerWrite?.minePresent !== false || mediaCas.peerWrite?.theirsPresent !== true || mediaCas.peerWrite?.queueTokenChanged !== true
      || Number(mediaCas.peerWrite?.queueRevision || 0) <= Number(mediaCas.mine?.queueRevision || 0)
      || mediaCas.durableAfterConflict?.queueTokenPresent !== true
      || mediaCas.durableAfterConflict?.minePresent !== false || mediaCas.durableAfterConflict?.theirsPresent !== true
      || Number(mediaCas.durableAfterConflict?.queueRevision || 0) !== Number(mediaCas.peerWrite?.queueRevision || -1)
      || mediaCas.thirdPeerWrite?.thirdPresent !== true
      || Number(mediaCas.thirdPeerWrite?.queueRevision || 0) <= Number(mediaCas.peerWrite?.queueRevision || 0)
      || mediaCas.mineRecovery?.minePresent !== true || mediaCas.mineRecovery?.queueTokenPresent !== true
      || mediaCas.mineRecovery?.conflictForKey !== mediaCas.mine?.key
      || mediaCas.conflictRecoveryAfterCleanup !== null || mediaCas.reloadAllowed !== true
      || mediaCas.reloadPreflight?.running !== false
      || Number(mediaCas.reloadPreflight?.pending || 0) < 1 || Number(mediaCas.reloadPreflight?.durable || 0) < 1
      || Number(mediaCas.reloadPreflight?.volatile || 0) < 1
      || !Array.isArray(mediaCas.recoveryDialogs) || mediaCas.recoveryDialogs.length !== 1
      || mediaCas.recoveryDialogs[0]?.type !== 'beforeunload' || mediaCas.recoveryDialogs[0]?.accepted !== true
      || Number(mediaCas.conflict?.controls || 0) < 1 || mediaCas.conflict?.disabled !== mediaCas.conflict?.controls
      || Number(mediaCas.reopened?.controls || 0) < 1 || mediaCas.reopened?.disabled !== mediaCas.reopened?.controls
      || mediaCas.reopened?.latestPeerVisible !== true
      || emptyRemoval.queue?.itemCount !== 0 || emptyRemoval.queue?.intentVersion !== 2
      || emptyRemoval.queue?.baselineFingerprintPresent !== true
      || emptyRemoval.state?.dirty !== true
      || Number(emptyRemoval.state?.pending || 0) < 1
      || Number(emptyRemoval.state?.durable || 0) < 1
      || Number(emptyRemoval.state?.volatile || 0) !== 0
      || emptyRemoval.reloadAllowed !== true
      || !Array.isArray(emptyRemoval.recoveryDialogs) || emptyRemoval.recoveryDialogs.length !== 1
      || emptyRemoval.recoveryDialogs[0]?.type !== 'beforeunload' || emptyRemoval.recoveryDialogs[0]?.accepted !== true
      || Number(emptyRemoval.reopened?.rows) !== 0 || emptyRemoval.reopened?.dirty !== true
      || Number(emptyRemoval.reopened?.pending || 0) < 1
      || Number(emptyRemoval.reopened?.durable || 0) < 1
      || Number(emptyRemoval.reopened?.volatile || 0) !== 0
      || Number(emptyRemoval.resetToCurrent?.rows || 0) !== Number(original.rawGalleryCount) + 2
      || emptyRemoval.resetToCurrent?.dirty !== 'false' || emptyRemoval.resetToCurrent?.pending !== '0'
      || emptyRemoval.resetRecoveryRow !== null
      || cover.available !== true || cover.role !== 'cover' || cover.path !== uploadedPaths[0]
      || hero.available !== true || hero.role !== 'hero' || hero.path !== uploadedPaths[1]
      || explicitRows.cover?.pathname !== uploadedPaths[0] || !explicitRows.cover?.roles?.includes('cover')
      || explicitRows.hero?.pathname !== uploadedPaths[1] || !explicitRows.hero?.roles?.includes('hero')
      || secondDraft.archiveCoverMedia !== uploadedPaths[0]
      || secondDraft.detailHeroMedia !== uploadedPaths[1]
      || secondDraft.archiveCoverMedia === secondDraft.detailHeroMedia
      || !exactArray(secondDraft.publicGallery, uploadedPaths)
      || projectMedia.recoveryCleared?.cleared !== true
      || projectMedia.canonicalUnchanged !== true
      || projectMedia.canonical?.status !== 200
      || projectMedia.canonical?.revision !== original.revision
      || Number(projectMedia.canonical?.rawGalleryCount) !== Number(original.rawGalleryCount)
      || !exactArray(projectMedia.canonical?.publicGallery, original.publicGallery)
      || projectMedia.canonical?.archiveCoverMedia !== original.archiveCoverMedia
      || projectMedia.canonical?.detailHeroMedia !== original.detailHeroMedia
      || projectMedia.noSaveOrBuildRequested !== true
      || !Array.isArray(projectMedia.saveOrBuildRequests) || projectMedia.saveOrBuildRequests.length) {
      issues.push('visual-acceptance:project-media-role-contract');
    }
  }
  const borrowed = evidence('borrowed-relation-media-live-projection');
  const relation = borrowed.relationBinding || {};
  const beforeSource = borrowed.before?.media || {};
  const afterSource = borrowed.after?.media || {};
  const beforeImage = borrowed.before?.image || {};
  const afterImage = borrowed.after?.image || {};
  const selected = borrowed.selection || {};
  const originalDetailRoute = selected.originalSlug ? `/vypolnennye-obekty/${selected.originalSlug}/` : '';
  const expectedDetailRoute = selected.nextSlug ? `/vypolnennye-obekty/${selected.nextSlug}/` : '';
  if (borrowed.route !== '/o-nas/'
    || relation.ownerCollection !== 'static-pages' || relation.ownerSlug !== 'o-nas'
    || relation.fieldPath !== 'companyHeroProjectSlug' || relation.tool !== 'relation-select'
    || relation.relationCollection !== 'projects' || relation.projectionKind !== 'relation'
    || !relation.bindingId || !relation.mediaBindingId
    || borrowed.inspector?.open !== true || borrowed.inspector?.provenanceVisible !== true
    || Number(borrowed.inspector?.optionCount || 0) < 2 || !String(borrowed.inspector?.provenance || '').includes('Источник')
    || !selected.originalSlug || !selected.nextSlug || selected.originalSlug === selected.nextSlug
    || !selected.nextSource?.path || !selected.nextSource?.fieldPath
    || beforeSource.bindingId !== relation.mediaBindingId || afterSource.bindingId !== relation.mediaBindingId
    || beforeSource.ownerCollection !== 'projects' || afterSource.ownerCollection !== 'projects'
    || !beforeSource.ownerSlug || beforeSource.ownerSlug === afterSource.ownerSlug
    || afterSource.ownerSlug !== selected.nextSlug || afterSource.fieldPath !== selected.nextSource?.fieldPath
    || beforeSource.scope !== 'shared' || beforeSource.tool !== 'media'
    || afterSource.scope !== 'shared' || afterSource.tool !== 'media'
    || beforeImage.visible !== true || (!beforeImage.src && !beforeImage.currentSrc)
    || afterImage.visible !== true || (!afterImage.src && !afterImage.currentSrc)
    || afterImage.srcset !== '' || !Array.isArray(afterImage.sourceSrcsets)
    || afterImage.sourceSrcsets.some(Boolean)
    || !Array.isArray(beforeSource.affectedRoutes) || !beforeSource.affectedRoutes.includes('/o-nas/')
    || !originalDetailRoute || !beforeSource.affectedRoutes.includes(originalDetailRoute)
    || !Array.isArray(afterSource.affectedRoutes) || !afterSource.affectedRoutes.includes('/o-nas/')
    || !expectedDetailRoute || !afterSource.affectedRoutes.includes(expectedDetailRoute)
    || borrowed.before?.sourceAction?.available !== true || borrowed.before?.sourceAction?.bindingId !== relation.mediaBindingId
    || borrowed.before?.sourceAction?.controlKey !== 'target'
    || borrowed.before?.relationAction?.available !== true || borrowed.before?.relationAction?.bindingId !== relation.bindingId
    || borrowed.before?.relationAction?.controlKey !== 'relation'
    || borrowed.after?.sourceAction?.available !== true || borrowed.after?.sourceAction?.bindingId !== relation.mediaBindingId
    || borrowed.after?.sourceAction?.controlKey !== 'target'
    || borrowed.after?.relationAction?.available !== true || borrowed.after?.relationAction?.bindingId !== relation.bindingId
    || borrowed.after?.relationAction?.controlKey !== 'relation'
    || borrowed.liveImageChanged !== true || borrowed.sourceRetargeted !== true
    || borrowed.staleResponsiveSourcesCleared !== true || borrowed.sharedImpact !== true
    || !borrowed.draftRecovery?.key || !borrowed.draftRecovery?.baseRevision
    || borrowed.draftRecovery?.value !== selected.nextSlug
    || borrowed.mediaDialog?.open !== true || borrowed.mediaDialog?.sourceMatches !== true
    || borrowed.mediaDialog?.impactMatches !== true
    || !String(borrowed.mediaDialog?.subtitle || '').includes('/o-nas/')
    || !String(borrowed.mediaDialog?.subtitle || '').includes(expectedDetailRoute)
    || borrowed.undo?.restoredSource !== true || borrowed.undo?.restored?.media?.ownerSlug !== selected.originalSlug
    || borrowed.undo?.recoveryAfterUndo?.value === selected.nextSlug
    || borrowed.saveEvidenceUnchanged !== true || borrowed.noSaveOrBuildRequested !== true
    || !Array.isArray(borrowed.saveOrBuildRequests) || borrowed.saveOrBuildRequests.length) {
    issues.push('visual-acceptance:borrowed-relation-media-contract');
  }
  return { ok: issues.length === 0, issues, requiredScenarios: expectedScenarios.length, seenScenarios: byId.size };
}

export function validateEvidenceIdentity({ routePassport, publicActions, adminActions, visualAcceptance, backupRestore }, { currentEvidence = null, publicActionsReuse = null } = {}) {
  const issues = [];
  const reusedPublicActions = publicActionsReuse?.ok === true && currentEvidence
    && publicActionsReuse.currentSourceSHA === currentEvidence.sourceSHA
    && publicActionsReuse.validatedSourceSHA === publicActions?.evidence?.sourceSHA
    && publicActionsReuse.branch === currentEvidence.branch
    && publicActions?.evidence?.branch === currentEvidence.branch
    && /^[a-f0-9]{64}$/u.test(publicActionsReuse.key || '')
    && publicActionsReuse.reportFingerprint === createHash('sha256').update(JSON.stringify(publicActions)).digest('hex');
  if (publicActionsReuse && !reusedPublicActions) issues.push('identity:invalid-public-actions-reuse');
  const reports = [routePassport, ...(!reusedPublicActions ? [publicActions] : []), adminActions,
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

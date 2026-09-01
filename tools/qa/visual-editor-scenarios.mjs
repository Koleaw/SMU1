export const FULL_VISUAL_ACCEPTANCE_SCENARIOS = Object.freeze([
  'home-default',
  'borrowed-relation-media-live-projection',
  'link-label-href-independent',
  'global-phone-authoritative-impact',
  'product-h1-live-edit',
  'product-long-text-contextual',
  'typed-price-validation',
  'category-reorder',
  'no-photo-affordance',
  'bulk-media-queue',
  'reload-recovery',
  'local-save-and-exact',
  'bulk-media-stage-save',
  'project-media-role-independence',
  'export-import-lossless',
  'history-restore-new-transaction',
  'two-tab-conflict',
  'expired-session-draft-recovery',
  'failed-exact-after-save',
  'backup-failure-after-save'
]);

export const REQUIRED_RESILIENCE_VISUAL_ACCEPTANCE_SCENARIOS = Object.freeze([
  'borrowed-relation-media-live-projection',
  'two-tab-conflict',
  'failed-exact-after-save',
  'history-restore-new-transaction',
  'backup-failure-after-save',
  'export-import-lossless',
  'expired-session-draft-recovery'
]);

export function expectedVisualAcceptanceScenarios(executionMode = 'full') {
  return executionMode === 'required-resilience-only'
    ? REQUIRED_RESILIENCE_VISUAL_ACCEPTANCE_SCENARIOS
    : FULL_VISUAL_ACCEPTANCE_SCENARIOS;
}

export function visualAcceptanceScenarioSetIssues(actualIds, executionMode = 'full') {
  const actual = Array.isArray(actualIds) ? actualIds.map((value) => String(value || '')) : [];
  const expected = expectedVisualAcceptanceScenarios(executionMode);
  const duplicates = actual.filter((id, index) => !id || actual.indexOf(id) !== index);
  const actualSet = new Set(actual);
  const missing = expected.filter((id) => !actualSet.has(id));
  const unexpected = actual.filter((id) => !expected.includes(id));
  return {
    ok: duplicates.length === 0 && missing.length === 0 && unexpected.length === 0 && actual.length === expected.length,
    expected: [...expected],
    actual,
    duplicates: [...new Set(duplicates)],
    missing,
    unexpected
  };
}

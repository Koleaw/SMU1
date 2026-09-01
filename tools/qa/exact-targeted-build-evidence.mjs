const exactArray = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function validateExactTargetedBuildEvidence(report, {
  expectedSourceSHA = '',
  expectedBranch = '',
  expectedBasePath = '',
  expectedHtmlFileHashes = null,
  expectedRouteCount = null
} = {}) {
  const issues = [];
  if (report?.schemaVersion !== 1 || report?.kind !== 'smu1-h6-exact-targeted-build') issues.push('exact-targeted:schema');
  if (report?.status !== 'pass') issues.push('exact-targeted:status');
  if (!/^[a-f0-9]{40}$/u.test(report?.sourceSHA || '')) issues.push('exact-targeted:source-sha');
  if (expectedSourceSHA && report?.sourceSHA !== expectedSourceSHA) issues.push('exact-targeted:source-sha-identity');
  if (!report?.branch || (expectedBranch && report.branch !== expectedBranch)) issues.push('exact-targeted:branch-identity');
  if (report?.dirty !== false) issues.push('exact-targeted:dirty-source');
  if (expectedBasePath && report?.basePath !== expectedBasePath) issues.push('exact-targeted:base-path');
  if (report?.fullBuild?.routeSetExact !== true || !Number.isSafeInteger(report?.fullBuild?.routeCount) || report.fullBuild.routeCount < 1) {
    issues.push('exact-targeted:full-route-set');
  }
  if (Number.isSafeInteger(expectedRouteCount) && report?.fullBuild?.routeCount !== expectedRouteCount) issues.push('exact-targeted:full-route-count');
  const expectations = Array.isArray(report?.selection?.expectations) ? report.selection.expectations : [];
  const htmlExpectations = expectations.filter((item) => item?.expected === 'html');
  const notFoundExpectations = expectations.filter((item) => item?.expected === 'not-found');
  if (!htmlExpectations.length || notFoundExpectations.length !== 1) issues.push('exact-targeted:expectations');
  if (htmlExpectations.length >= (report?.fullBuild?.routeCount || 0)) issues.push('exact-targeted:not-targeted');
  const families = new Set(report?.selection?.rendererFamilies || []);
  for (const required of ['home', 'catalog', 'direction', 'category', 'product', 'project-archive', 'project', 'practical', 'custom-order', 'not-found', 'compatibility-alias']) {
    if (!families.has(required)) issues.push(`exact-targeted:renderer-family:${required}`);
  }
  if (!Array.isArray(report?.selection?.rendererVariants) || !report.selection.rendererVariants.length) issues.push('exact-targeted:renderer-variants');
  if (report?.runner?.mode !== 'targeted-production-ssg') issues.push('exact-targeted:runner-mode');
  if (!report?.runner?.artifact?.manifestSha256 || !Number.isSafeInteger(report?.runner?.artifact?.fileCount)) issues.push('exact-targeted:artifact');
  const selectedRoutes = report?.runner?.prerender?.selectedRoutes;
  const expectedSelected = report?.selection?.expectedSelectedRoutes;
  if (!Array.isArray(selectedRoutes) || !Array.isArray(expectedSelected) || !exactArray(selectedRoutes, expectedSelected)) {
    issues.push('exact-targeted:selected-routes');
  }
  if (!Array.isArray(report?.runner?.targetedHtmlRoutes)
    || !exactArray(report.runner.targetedHtmlRoutes, report?.selection?.expectedTargetedHtmlRoutes)) {
    issues.push('exact-targeted:unrelated-html');
  }
  const comparisons = Array.isArray(report?.comparisons) ? report.comparisons : [];
  if (comparisons.length !== expectations.length || comparisons.some((item) => item?.status !== 'byte-identical')) {
    issues.push('exact-targeted:html-byte-equivalence');
  }
  if (!comparisons.some((item) => item?.expected === 'not-found' && item?.routeAbsent === true && item?.fallback404ByteIdentical === true)) {
    issues.push('exact-targeted:not-found-semantics');
  }
  if (expectedHtmlFileHashes) {
    const current = new Map(Array.isArray(expectedHtmlFileHashes) ? expectedHtmlFileHashes : []);
    for (const comparison of comparisons) {
      const route = comparison.expected === 'not-found' ? '/404.html' : comparison.route;
      if (!current.has(route) || current.get(route) !== comparison.fullSha256) {
        issues.push(`exact-targeted:current-html-identity:${route}`);
      }
    }
  }
  const before = report?.h5SourceCache?.before;
  const after = report?.h5SourceCache?.after;
  if (!before?.aggregateSha256 || before.fileCount < 1 || before.totalBytes < 1
    || report?.h5SourceCache?.unchanged !== true || !exactArray(before, after)) {
    issues.push('exact-targeted:h5-source-cache');
  }
  return { ok: issues.length === 0, issues };
}

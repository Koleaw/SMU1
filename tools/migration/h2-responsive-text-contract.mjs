// Text can overflow its own column even when the document has no scrollbar.
// Line count is intentionally excluded: wrapped, readable headings are valid.
export function evaluateResponsiveTextOverflow(snapshots) {
  const issues = [];
  for (const [state, metrics] of Object.entries(snapshots)) {
    for (const [role, metric] of Object.entries(metrics || {})) {
      if (!metric) continue;
      if (!Number.isFinite(metric.overflow) || metric.overflow > 2) {
        issues.push({ ...metric, state, role });
      }
    }
  }
  return { ok: issues.length === 0, maximumOverflowPx: 2, issues };
}

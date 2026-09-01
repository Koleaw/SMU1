const dimensions = Object.freeze(['width', 'height']);

export function comparableBusinessText(snapshot) {
  return (snapshot?.businessOccurrences || [])
    .filter((occurrence) => !occurrence.runtimeSurface)
    .map((occurrence) => occurrence.text);
}

export function compareStableGeometry(publicGeometry, editorGeometry, { tolerance = 1 } = {}) {
  const issues = [];
  const publicKeys = Object.keys(publicGeometry || {}).sort();
  const editorKeys = Object.keys(editorGeometry || {}).sort();
  if (JSON.stringify(publicKeys) !== JSON.stringify(editorKeys)) {
    issues.push(`targets:${publicKeys.join(',')}!=${editorKeys.join(',')}`);
    return issues;
  }
  for (const key of publicKeys) {
    const publicTarget = publicGeometry[key];
    const editorTarget = editorGeometry[key];
    if (publicTarget?.tag !== editorTarget?.tag || publicTarget?.id !== editorTarget?.id) {
      issues.push(`${key}:identity`);
      continue;
    }
    const comparedDimensions = Array.isArray(publicTarget?.dimensions) ? publicTarget.dimensions : dimensions;
    if (!exactDimensions(comparedDimensions, editorTarget?.dimensions)) {
      issues.push(`${key}:dimensions`);
      continue;
    }
    for (const dimension of comparedDimensions) {
      const publicValue = Number(publicTarget?.[dimension]);
      const editorValue = Number(editorTarget?.[dimension]);
      if (!Number.isFinite(publicValue) || !Number.isFinite(editorValue)
        || Math.abs(publicValue - editorValue) > tolerance) {
        issues.push(`${key}:${dimension}:${publicValue}->${editorValue}`);
      }
    }
  }
  return issues;
}

function exactDimensions(publicDimensions, editorDimensions) {
  const normalizedEditor = Array.isArray(editorDimensions) ? editorDimensions : dimensions;
  return JSON.stringify(publicDimensions) === JSON.stringify(normalizedEditor);
}

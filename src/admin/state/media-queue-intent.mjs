function normalizedRoles(item) {
  const roles = Array.isArray(item?.roles) && item.roles.length
    ? item.roles
    : Array.isArray(item?.originalRoles) && item.originalRoles.length
      ? item.originalRoles
      : [item?.role || 'gallery'];
  return [...new Set(roles.filter(Boolean).map(String))];
}

export function mediaQueueFingerprint(items) {
  return JSON.stringify((Array.isArray(items) ? items : []).map((item) => ({
    path: String(item?.canonicalPath || item?.lease?.canonicalPath || ''),
    file: item?.file ? {
      name: String(item.name || item.file.name || ''),
      type: String(item.type || item.file.type || ''),
      bytes: Number(item.bytes || item.file.size || 0)
    } : null,
    alt: String(item?.alt || ''),
    caption: String(item?.caption || ''),
    roles: normalizedRoles(item),
    duplicateAction: String(item?.duplicateAction || 'reuse'),
    existing: item?.existing === true
  })));
}

export function mediaQueueIsDirty(items, baselineFingerprint) {
  return mediaQueueFingerprint(items) !== String(baselineFingerprint || '[]');
}

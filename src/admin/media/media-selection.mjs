export function planCanonicalMediaSelection(items, leasesByClientId) {
  const orderedItems = Array.isArray(items) ? items : [];
  const leaseLookup = leasesByClientId instanceof Map
    ? leasesByClientId
    : new Map(Object.entries(leasesByClientId || {}));
  const knownCanonicalPaths = new Set(orderedItems
    .filter((item) => item && Object.hasOwn(item, 'existingValue'))
    .map((item) => item.existingPath)
    .filter(Boolean));
  const leases = [];
  const omittedDuplicates = [];

  for (const item of orderedItems) {
    const lease = item ? leaseLookup.get(item.clientId) : null;
    if (!lease?.canonicalPath) continue;
    const preservesExistingEntry = Object.hasOwn(item, 'existingValue');
    if (!preservesExistingEntry && knownCanonicalPaths.has(lease.canonicalPath)) {
      omittedDuplicates.push({ clientId: item.clientId, canonicalPath: lease.canonicalPath });
      continue;
    }
    leases.push(lease);
    knownCanonicalPaths.add(lease.canonicalPath);
  }

  return Object.freeze({
    leases: Object.freeze(leases),
    omittedDuplicates: Object.freeze(omittedDuplicates)
  });
}

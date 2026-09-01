const COLLECTION_KIND = Object.freeze({
  'product-categories': 'category',
  products: 'product',
  projects: 'project',
  jobs: 'job'
});

/**
 * Resolves a reorder zone to the page-registry entity it owns. The binding
 * owner is authoritative: a category hub must never fall through to the
 * product-list behavior merely because both entities use an `order` field.
 */
export function reorderEntityKind(binding, zoneId = '') {
  const collection = String(binding?.ownerCollection || binding?.owner?.collection || '');
  if (COLLECTION_KIND[collection]) return COLLECTION_KIND[collection];
  if (zoneId === 'project-archive') return 'project';
  if (zoneId === 'vacancies') return 'job';
  return 'product';
}

/**
 * Selects the complete data-backed set that is atomically renumbered for a
 * visible reorder zone. Hidden category cards stay outside the hub ordering
 * gesture, matching the production renderer's showInSectionGrid filter.
 */
export function reorderEntityPages(pages, binding, zoneId = '') {
  const kind = reorderEntityKind(binding, zoneId);
  return pages.filter((page) => {
    if (!page?.isActive || page.kind !== kind) return false;
    if ((kind === 'product' || kind === 'category') && page.parentSlug !== zoneId) return false;
    if (kind === 'category' && page.entry?.summary?.showInSectionGrid === false) return false;
    return true;
  });
}

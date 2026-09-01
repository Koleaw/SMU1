const TARGET_COLLECTIONS = new Set(['product-sections', 'product-categories', 'services']);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertItems(items) {
  if (!Array.isArray(items)) throw new TypeError('Direction presentation items must be an array.');
  const ids = new Set();
  for (const item of items) {
    const id = String(item?.id || '').trim();
    if (!id) throw new TypeError('Every direction presentation item requires a stable id.');
    if (ids.has(id)) throw new TypeError(`Duplicate direction presentation item id: ${id}`);
    ids.add(id);
  }
}

function compareItems(left, right) {
  return Number(left.item.order || 0) - Number(right.item.order || 0)
    || String(left.item.id).localeCompare(String(right.item.id), 'ru')
    || left.sourceIndex - right.sourceIndex;
}

/**
 * Returns the exact user-facing order without changing the source array. Source
 * indexes remain stable so live bindings keep pointing at the same occurrence.
 */
export function orderedDirectionItems(items) {
  assertItems(items);
  return items
    .map((item, sourceIndex) => ({ item: clone(item), sourceIndex }))
    .sort(compareItems);
}

export function renumberDirectionItems(items, orderedIds) {
  assertItems(items);
  if (!Array.isArray(orderedIds) || orderedIds.length !== items.length) {
    throw new TypeError('The reordered id list must contain every direction presentation item.');
  }
  const expected = new Set(items.map((item) => String(item.id)));
  const received = new Set(orderedIds.map((id) => String(id)));
  if (received.size !== orderedIds.length || received.size !== expected.size
    || [...received].some((id) => !expected.has(id))) {
    throw new TypeError('The reordered id list must contain each stable id exactly once.');
  }
  const orderById = new Map(orderedIds.map((id, index) => [String(id), (index + 1) * 10]));
  return items.map((item) => ({ ...clone(item), order: orderById.get(String(item.id)) }));
}

export function moveDirectionItem(items, stableId, destination) {
  const rows = orderedDirectionItems(items);
  const fromIndex = rows.findIndex(({ item }) => String(item.id) === String(stableId));
  if (fromIndex < 0) throw new TypeError(`Unknown direction presentation item: ${stableId}`);
  const toIndex = destination === 'start'
    ? 0
    : destination === 'end'
      ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, fromIndex + Number(destination || 0)));
  if (fromIndex === toIndex) return clone(items);
  const next = rows.map(({ item }) => String(item.id));
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return renumberDirectionItems(items, next);
}

export function updateDirectionItem(items, stableId, patch) {
  assertItems(items);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('Direction presentation item patch must be an object.');
  }
  let found = false;
  const next = items.map((item) => {
    if (String(item.id) !== String(stableId)) return clone(item);
    found = true;
    return { ...clone(item), ...clone(patch), id: item.id };
  });
  if (!found) throw new TypeError(`Unknown direction presentation item: ${stableId}`);
  return next;
}

export function removeDirectionRelation(items, stableId) {
  assertItems(items);
  if (!items.some((item) => String(item.id) === String(stableId))) {
    throw new TypeError(`Unknown direction presentation relation: ${stableId}`);
  }
  const remaining = items.filter((item) => String(item.id) !== String(stableId));
  return renumberDirectionItems(remaining, orderedDirectionItems(remaining).map(({ item }) => String(item.id)));
}

export function directionTargetKey(targetCollection, targetSlug) {
  return `${String(targetCollection)}:${String(targetSlug)}`;
}

function stableRelationId(items, targetCollection, targetSlug) {
  const stem = `related-${String(targetCollection).replace(/[^a-z0-9]+/gu, '-')}-${String(targetSlug).replace(/[^a-z0-9-]+/gu, '-')}`
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
  const used = new Set(items.map((item) => String(item.id)));
  if (!used.has(stem)) return stem;
  let suffix = 2;
  while (used.has(`${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

export function addDirectionRelation(items, target, { eyebrow = 'Связанное направление' } = {}) {
  assertItems(items);
  const targetCollection = String(target?.targetCollection || '');
  const targetSlug = String(target?.targetSlug || '').trim();
  if (!TARGET_COLLECTIONS.has(targetCollection) || !/^[a-z0-9-]+$/u.test(targetSlug)) {
    throw new TypeError('Direction relation target must use an allowed collection and a safe slug.');
  }
  const key = directionTargetKey(targetCollection, targetSlug);
  if (items.some((item) => directionTargetKey(item.targetCollection, item.targetSlug) === key)) {
    throw new TypeError('This page is already present in the related set.');
  }
  const ordered = orderedDirectionItems(items);
  const relation = {
    id: stableRelationId(items, targetCollection, targetSlug),
    targetCollection,
    targetSlug,
    eyebrow: String(eyebrow || 'Связанное направление'),
    order: (ordered.length + 1) * 10,
    isActive: true
  };
  const combined = [...clone(items), relation];
  return renumberDirectionItems(combined, [...ordered.map(({ item }) => String(item.id)), relation.id]);
}

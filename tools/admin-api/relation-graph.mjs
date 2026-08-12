const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const COLLECTION_ORDER = Object.freeze([
  'static-pages',
  'services',
  'product-sections',
  'product-categories',
  'products',
  'projects',
  'jobs',
  'site-settings'
]);

const COLLECTION_RANK = new Map(COLLECTION_ORDER.map((collection, index) => [collection, index]));
const TOP_LEVEL_ROUTE_COLLECTIONS = new Set(['static-pages', 'services', 'product-sections']);
const MEDIA_PATH_RE = /^\/(?:assets|uploads|_media)(?:\/|$)/i;

export const RELATION_GRAPH_VERSION = 1;

export const DEFAULT_LOCKED_STATIC_SLUGS = Object.freeze([
  'home',
  'custom-order',
  'vypolnennye-obekty'
]);

export const DEFAULT_RESERVED_TOP_LEVEL_SLUGS = Object.freeze([
  'admin',
  'izgotovlenie-na-zakaz',
  '404'
]);

export const DEFAULT_FIXED_ROUTES = Object.freeze([
  { id: 'home', path: '/', aliasFor: { collection: 'static-pages', slug: 'home' } },
  { id: 'custom-order', path: '/izgotovlenie-na-zakaz/', aliasFor: { collection: 'static-pages', slug: 'custom-order' } },
  { id: 'projects-archive', path: '/vypolnennye-obekty/', aliasFor: { collection: 'static-pages', slug: 'vypolnennye-obekty' } },
  { id: 'contacts', path: '/kontakty/' },
  { id: 'vacancies-archive', path: '/vakansii/' },
  { id: 'privacy', path: '/politika-konfidencialnosti/' },
  { id: 'legacy-benches', path: '/lavochki-i-skameyki/' },
  { id: 'legacy-bins', path: '/urny/' },
  { id: 'legacy-canopies', path: '/navesy/' },
  { id: 'admin', path: '/admin/' },
  { id: 'not-found', path: '/404/' },
  { id: 'robots', path: '/robots.txt' }
]);

const VISIBILITY_FIELDS = Object.freeze({
  'static-pages': 'isActive',
  services: 'isActive',
  'product-sections': 'isActive',
  'product-categories': 'isActive',
  products: 'isActive',
  projects: 'isActive',
  jobs: 'isActive'
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), 'en');
}

function compareRecord(left, right) {
  const rank = (COLLECTION_RANK.get(left.collection) ?? Number.MAX_SAFE_INTEGER)
    - (COLLECTION_RANK.get(right.collection) ?? Number.MAX_SAFE_INTEGER);
  return rank || compareText(left.collection, right.collection) || compareText(left.slug, right.slug);
}

function recordId(collection, slug) {
  return `${collection}:${slug}`;
}

function recordRef(record) {
  return {
    kind: 'record',
    id: record.id,
    collection: record.collection,
    slug: record.slug,
    title: record.title
  };
}

function sourceRef(source) {
  if (source.kind === 'record' || (source.collection && source.slug)) return recordRef(source);
  return { kind: 'singleton', id: source.id, name: source.name };
}

function normalizeFixedRoute(route, index) {
  const source = typeof route === 'string' ? { path: route } : route;
  const path = normalizeRoutePathname(source?.path);
  if (!path) return null;
  return {
    id: String(source.id || `fixed-${index + 1}`),
    path,
    ...(source.aliasFor ? {
      aliasFor: {
        collection: String(source.aliasFor.collection),
        slug: String(source.aliasFor.slug)
      }
    } : {})
  };
}

/**
 * Return an exact canonical pathname for an internal route reference. Query and
 * hash suffixes are deliberately excluded from relation identity.
 */
export function normalizeRoutePathname(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('?') || trimmed.startsWith('//')) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return null;
  if(/[\u0000-\u001f\u007f]/.test(trimmed)) return null;

  const suffixIndex = trimmed.search(/[?#]/);
  let pathname = suffixIndex >= 0 ? trimmed.slice(0, suffixIndex) : trimmed;
  if (!pathname) return null;
  pathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  pathname = pathname.replace(/\/{2,}/g, '/');
  if (pathname.split('/').some((part) => part === '.' || part === '..')) return null;
  if (pathname !== '/' && !/\/[^/]+\.[a-z\d]+$/i.test(pathname) && !pathname.endsWith('/')) pathname += '/';
  return pathname;
}

function normalizeMediaPath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const suffixIndex = trimmed.search(/[?#]/);
  const pathname = suffixIndex >= 0 ? trimmed.slice(0, suffixIndex) : trimmed;
  if (!MEDIA_PATH_RE.test(pathname)) return null;
  return pathname.replace(/\/{2,}/g, '/');
}

function replaceHrefPath(value, nextPath) {
  const trimmed = String(value).trim();
  const suffixIndex = trimmed.search(/[?#]/);
  const suffix = suffixIndex >= 0 ? trimmed.slice(suffixIndex) : '';
  return `${nextPath}${suffix}`;
}

function unwrapContent(item, fallbackSlug = '') {
  const wrapped = isPlainObject(item?.content)
    ? item.content
    : isPlainObject(item?.data)
      ? item.data
      : item;
  if (!isPlainObject(wrapped)) return null;
  const content = clone(wrapped);
  const slug = String(content.slug ?? item?.slug ?? fallbackSlug).trim();
  return { content, slug };
}

function collectionItems(value) {
  if (value instanceof Map) return [...value.entries()].map(([slug, item]) => ({ slug, item }));
  if (Array.isArray(value)) return value.map((item) => ({ slug: '', item }));
  if (isPlainObject(value)) return Object.entries(value).map(([slug, item]) => ({ slug, item }));
  return [];
}

function normalizeRecords(collections) {
  const records = [];
  const duplicates = [];
  const seen = new Set();

  const collectionEntries = collections instanceof Map
    ? [...collections.entries()]
    : Object.entries(collections || {});
  collectionEntries.sort(([left], [right]) => {
    const rank = (COLLECTION_RANK.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (COLLECTION_RANK.get(right) ?? Number.MAX_SAFE_INTEGER);
    return rank || compareText(left, right);
  });

  for (const [collection, value] of collectionEntries) {
    for (const { slug: fallbackSlug, item } of collectionItems(value)) {
      const unwrapped = unwrapContent(item, fallbackSlug);
      if (!unwrapped) continue;
      const slug = unwrapped.slug || (collection === 'site-settings' ? 'global' : '');
      if (!slug) continue;
      const id = recordId(collection, slug);
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
      records.push({
        id,
        collection,
        slug,
        title: String(unwrapped.content.title ?? unwrapped.content.companyName ?? slug),
        content: unwrapped.content
      });
    }
  }

  records.sort(compareRecord);
  return { records, duplicates: [...new Set(duplicates)].sort(compareText) };
}

function recordRoute(record, indexes) {
  if (record.collection === 'static-pages') {
    if (record.slug === 'home') return '/';
    if (record.slug === 'custom-order') return '/izgotovlenie-na-zakaz/';
    return normalizeRoutePathname(`/${record.slug}/`);
  }
  if (record.collection === 'services' || record.collection === 'product-sections') {
    return normalizeRoutePathname(`/${record.slug}/`);
  }
  if (record.collection === 'product-categories') {
    const parent = String(record.content.parentSectionSlug || '').trim();
    return parent ? normalizeRoutePathname(`/${parent}/${record.slug}/`) : null;
  }
  if (record.collection === 'products') {
    const categorySlug = String(record.content.productCategorySlug || '').trim();
    const category = indexes.byId.get(recordId('product-categories', categorySlug));
    const sectionSlug = String(category?.content?.parentSectionSlug || '').trim();
    return category && sectionSlug
      ? normalizeRoutePathname(`/${sectionSlug}/${category.slug}/${record.slug}/`)
      : null;
  }
  if (record.collection === 'projects') return normalizeRoutePathname(`/vypolnennye-obekty/${record.slug}/`);
  if (record.collection === 'jobs') return normalizeRoutePathname(`/vakansii/${record.slug}/`);
  return null;
}

function walk(value, visitor, currentPath = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemPath = `${currentPath}[${index}]`;
      visitor(item, String(index), itemPath);
      walk(item, visitor, itemPath);
    });
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value).sort(compareText)) {
    const item = value[key];
    const itemPath = currentPath ? `${currentPath}.${key}` : key;
    visitor(item, key, itemPath);
    walk(item, visitor, itemPath);
  }
}

function routeTarget(path, routesByPath) {
  const owners = routesByPath.get(path) || [];
  return {
    kind: 'route',
    path,
    exists: owners.length > 0,
    owners: owners.map((owner) => clone(owner.owner))
  };
}

function missingRecordTarget(collection, slug) {
  return {
    kind: 'record',
    id: recordId(collection, slug),
    collection,
    slug,
    exists: false
  };
}

function existingRecordTarget(record) {
  return { ...recordRef(record), exists: true };
}

function pushRecordRelation(relations, indexes, source, type, path, value, targetCollection, targetSlug) {
  const normalizedSlug = String(targetSlug ?? '').trim();
  if (!normalizedSlug) return;
  const targetRecord = indexes.byId.get(recordId(targetCollection, normalizedSlug));
  relations.push({
    type,
    source: sourceRef(source),
    path,
    value,
    target: targetRecord
      ? existingRecordTarget(targetRecord)
      : missingRecordTarget(targetCollection, normalizedSlug)
  });
}

function relationSortValue(relation) {
  const target = relation.target.kind === 'record'
    ? relation.target.id
    : relation.target.kind === 'route'
      ? relation.target.path
      : relation.target.path;
  return `${relation.type}\0${relation.source.id}\0${relation.path}\0${target}`;
}

function buildHierarchy(records, indexes) {
  const sections = records
    .filter((record) => record.collection === 'product-sections')
    .map((section) => ({
      section: recordRef(section),
      categories: records
        .filter((record) => record.collection === 'product-categories' && record.content.parentSectionSlug === section.slug)
        .map(recordRef)
        .sort((left, right) => compareText(left.id, right.id))
    }));
  const categories = records
    .filter((record) => record.collection === 'product-categories')
    .map((category) => ({
      category: recordRef(category),
      section: indexes.byId.has(recordId('product-sections', category.content.parentSectionSlug))
        ? recordRef(indexes.byId.get(recordId('product-sections', category.content.parentSectionSlug)))
        : null,
      products: records
        .filter((record) => record.collection === 'products' && record.content.productCategorySlug === category.slug)
        .map(recordRef)
        .sort((left, right) => compareText(left.id, right.id))
    }));
  const relatedProducts = records
    .filter((record) => record.collection === 'products')
    .map((product) => ({
      product: recordRef(product),
      outgoing: (Array.isArray(product.content.relatedProductSlugs) ? product.content.relatedProductSlugs : [])
        .map((slug) => indexes.byId.get(recordId('products', String(slug).trim())))
        .filter(Boolean)
        .map(recordRef)
        .sort((left, right) => compareText(left.id, right.id)),
      incoming: records
        .filter((candidate) => candidate.collection === 'products'
          && Array.isArray(candidate.content.relatedProductSlugs)
          && candidate.content.relatedProductSlugs.includes(product.slug))
        .map(recordRef)
        .sort((left, right) => compareText(left.id, right.id))
    }));
  return { sections, categories, relatedProducts };
}

function buildIssues(duplicates, routeCollisions, relations) {
  const issues = duplicates.map((id) => ({
    code: 'DUPLICATE_RECORD',
    severity: 'error',
    recordId: id,
    message: `Запись ${id} встречается больше одного раза.`
  }));
  issues.push(...routeCollisions.map((collision) => ({
    code: 'ROUTE_COLLISION',
    severity: 'error',
    path: collision.path,
    owners: clone(collision.owners),
    message: `Публичный адрес ${collision.path} занят несколькими сущностями.`
  })));
  issues.push(...relations
    .filter((relation) => relation.target.exists === false)
    .map((relation) => ({
      code: relation.target.kind === 'route' ? 'UNRESOLVED_INTERNAL_ROUTE' : 'MISSING_RELATION_TARGET',
      severity: relation.target.kind === 'route' ? 'warning' : 'error',
      source: clone(relation.source),
      path: relation.path,
      target: clone(relation.target),
      message: relation.target.kind === 'route'
        ? `Внутренний адрес ${relation.target.path} не найден в графе маршрутов.`
        : `Связанная запись ${relation.target.id} не найдена.`
    })));
  return issues.sort((left, right) => compareText(
    `${left.severity}\0${left.code}\0${left.recordId || left.path || left.source?.id || ''}`,
    `${right.severity}\0${right.code}\0${right.recordId || right.path || right.source?.id || ''}`
  ));
}

/**
 * Build a deterministic, serializable graph from in-memory content. The input is
 * never mutated. Collections may contain raw records, {content}, {data}, Maps,
 * or slug-keyed objects. Navigation may be the stored array or {items} envelope.
 */
export function buildRelationGraph({
  collections = {},
  navigation = [],
  fixedRoutes = DEFAULT_FIXED_ROUTES,
  lockedStaticSlugs = DEFAULT_LOCKED_STATIC_SLUGS,
  reservedTopLevelSlugs = DEFAULT_RESERVED_TOP_LEVEL_SLUGS
} = {}) {
  const { records, duplicates } = normalizeRecords(collections);
  const indexes = {
    byId: new Map(records.map((record) => [record.id, record]))
  };
  for (const record of records) record.route = recordRoute(record, indexes);

  const normalizedFixedRoutes = fixedRoutes
    .map(normalizeFixedRoute)
    .filter(Boolean)
    .sort((left, right) => compareText(`${left.path}\0${left.id}`, `${right.path}\0${right.id}`));
  const routes = records
    .filter((record) => record.route)
    .map((record) => ({ path: record.route, owner: recordRef(record), fixed: false }));
  for (const fixed of normalizedFixedRoutes) {
    const aliasId = fixed.aliasFor ? recordId(fixed.aliasFor.collection, fixed.aliasFor.slug) : '';
    const aliasRecord = aliasId ? indexes.byId.get(aliasId) : null;
    if (aliasRecord?.route === fixed.path) continue;
    routes.push({
      path: fixed.path,
      owner: { kind: 'fixed-route', id: fixed.id, ...(fixed.aliasFor ? { aliasFor: clone(fixed.aliasFor) } : {}) },
      fixed: true
    });
  }
  routes.sort((left, right) => compareText(
    `${left.path}\0${left.owner.kind}\0${left.owner.id}`,
    `${right.path}\0${right.owner.kind}\0${right.owner.id}`
  ));
  const routesByPath = new Map();
  for (const route of routes) {
    if (!routesByPath.has(route.path)) routesByPath.set(route.path, []);
    routesByPath.get(route.path).push(route);
  }
  const routeCollisions = [...routesByPath.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([path, owners]) => ({ path, owners: owners.map((item) => clone(item.owner)) }))
    .sort((left, right) => compareText(left.path, right.path));

  const relations = [];
  for (const record of records) {
    if (record.collection === 'product-categories') {
      pushRecordRelation(relations, indexes, record, 'category-section', 'parentSectionSlug', record.content.parentSectionSlug, 'product-sections', record.content.parentSectionSlug);
    }
    if (record.collection === 'products') {
      pushRecordRelation(relations, indexes, record, 'product-category', 'productCategorySlug', record.content.productCategorySlug, 'product-categories', record.content.productCategorySlug);
      (Array.isArray(record.content.relatedProductSlugs) ? record.content.relatedProductSlugs : [])
        .forEach((slug, index) => pushRecordRelation(relations, indexes, record, 'product-related', `relatedProductSlugs[${index}]`, slug, 'products', slug));
    }

    walk(record.content, (value, key, path) => {
      if (typeof value !== 'string') return;
      const mediaPath = normalizeMediaPath(value);
      if (mediaPath) {
        relations.push({
          type: 'record-media',
          source: recordRef(record),
          path,
          value,
          target: { kind: 'media', path: mediaPath, exists: true }
        });
      }

      if (/href$/i.test(key)) {
        const routePath = normalizeRoutePathname(value);
        if (routePath && !MEDIA_PATH_RE.test(routePath)) {
          relations.push({
            type: 'content-route',
            source: recordRef(record),
            path,
            value,
            target: routeTarget(routePath, routesByPath)
          });
        }
      }

      if (key === 'categorySlug') {
        pushRecordRelation(relations, indexes, record, 'content-category', path, value, 'product-categories', value);
      } else if (key === 'sectionSlug') {
        pushRecordRelation(relations, indexes, record, 'content-section', path, value, 'product-sections', value);
      } else if (key === 'productSlug') {
        pushRecordRelation(relations, indexes, record, 'content-product', path, value, 'products', value);
      } else if (key === 'projectSlug') {
        pushRecordRelation(relations, indexes, record, 'content-project', path, value, 'projects', value);
      } else if (key === 'serviceSlug') {
        pushRecordRelation(relations, indexes, record, 'content-service', path, value, 'services', value);
      }
    });
  }

  const storedNavigation = clone(navigation ?? []);
  const navigationItems = Array.isArray(storedNavigation)
    ? storedNavigation
    : Array.isArray(storedNavigation?.items)
      ? storedNavigation.items
      : [];
  const navigationPrefix = Array.isArray(storedNavigation) ? '' : 'items';
  navigationItems.forEach((item, index) => {
    if (typeof item?.href !== 'string') return;
    const routePath = normalizeRoutePathname(item.href);
    if (!routePath || MEDIA_PATH_RE.test(routePath)) return;
    relations.push({
      type: 'navigation-route',
      source: { kind: 'singleton', id: 'singleton:navigation', name: 'navigation' },
      path: `${navigationPrefix}${navigationPrefix ? '' : ''}[${index}].href`,
      value: item.href,
      target: routeTarget(routePath, routesByPath)
    });
  });

  relations.sort((left, right) => compareText(relationSortValue(left), relationSortValue(right)));
  relations.forEach((relation, index) => { relation.id = `relation:${index + 1}`; });

  const mediaByPath = new Map();
  for (const relation of relations.filter((item) => item.type === 'record-media')) {
    if (!mediaByPath.has(relation.target.path)) mediaByPath.set(relation.target.path, []);
    mediaByPath.get(relation.target.path).push({
      source: clone(relation.source),
      path: relation.path,
      value: relation.value
    });
  }
  const media = [...mediaByPath.entries()]
    .map(([path, references]) => ({
      path,
      referenceCount: references.length,
      recordCount: new Set(references.map((reference) => reference.source.id)).size,
      references
    }))
    .sort((left, right) => compareText(left.path, right.path));

  const graph = {
    version: RELATION_GRAPH_VERSION,
    records,
    routes,
    relations,
    hierarchy: buildHierarchy(records, indexes),
    media,
    routeCollisions,
    lockedStaticSlugs: [...new Set(lockedStaticSlugs.map(String))].sort(compareText),
    reservedTopLevelSlugs: [...new Set(reservedTopLevelSlugs.map(String))].sort(compareText),
    fixedRoutes: normalizedFixedRoutes,
    navigation: storedNavigation
  };
  graph.issues = buildIssues(duplicates, routeCollisions, relations);
  return graph;
}

function relationSourceIsTarget(relation, target) {
  return relation.source.kind === 'record' && relation.source.id === target.id;
}

function blocker(code, message, relation = undefined, extra = {}) {
  return {
    code,
    message,
    ...(relation ? { reference: clone(relation) } : {}),
    ...extra
  };
}

function warning(code, message, extra = {}) {
  return { code, message, ...extra };
}

function uniqueBy(items, key) {
  const result = new Map();
  for (const item of items) result.set(key(item), item);
  return [...result.values()];
}

function sortedBlockers(items) {
  return uniqueBy(items, (item) => `${item.code}\0${item.reference?.id || ''}\0${item.path || ''}`)
    .sort((left, right) => compareText(
      `${left.code}\0${left.reference?.source?.id || ''}\0${left.reference?.path || ''}\0${left.path || ''}`,
      `${right.code}\0${right.reference?.source?.id || ''}\0${right.reference?.path || ''}\0${right.path || ''}`
    ));
}

function findRecord(graph, collection, slug) {
  return graph.records.find((record) => record.collection === collection && record.slug === slug);
}

function descendantRecords(graph, target) {
  if (target.collection === 'product-sections') {
    const categories = graph.records.filter((record) => record.collection === 'product-categories' && record.content.parentSectionSlug === target.slug);
    const categorySlugs = new Set(categories.map((record) => record.slug));
    const products = graph.records.filter((record) => record.collection === 'products' && categorySlugs.has(record.content.productCategorySlug));
    return [...categories, ...products].sort(compareRecord);
  }
  if (target.collection === 'product-categories') {
    return graph.records
      .filter((record) => record.collection === 'products' && record.content.productCategorySlug === target.slug)
      .sort(compareRecord);
  }
  return [];
}

function inboundReferences(graph, targets, routePaths = new Set()) {
  const targetList = Array.isArray(targets) ? targets : [targets];
  const targetIds = new Set(targetList.map((target) => target.id));
  const defaultRoutePaths = new Set(targetList.map((target) => target.route).filter(Boolean));
  const matchedRoutePaths = routePaths.size ? routePaths : defaultRoutePaths;
  return graph.relations.filter((relation) => {
    if (relation.source.kind === 'record' && targetIds.has(relation.source.id)) return false;
    if (relation.target.kind === 'record' && targetIds.has(relation.target.id)) return true;
    return relation.target.kind === 'route' && matchedRoutePaths.has(relation.target.path);
  });
}

function mediaImpact(graph, target) {
  const paths = [...new Set(graph.relations
    .filter((relation) => relation.type === 'record-media' && relation.source.id === target.id)
    .map((relation) => relation.target.path))]
    .sort(compareText);
  return paths.map((path) => {
    const entry = graph.media.find((item) => item.path === path);
    const ownedReferences = entry.references.filter((reference) => reference.source.id === target.id).length;
    return {
      path,
      referenceCount: entry.referenceCount,
      remainingReferenceCount: entry.referenceCount - ownedReferences,
      deleteOriginal: false
    };
  });
}

function reconstructCollections(graph) {
  const collections = {};
  for (const record of graph.records) {
    if (!collections[record.collection]) collections[record.collection] = [];
    collections[record.collection].push(clone(record.content));
  }
  return collections;
}

function projectedRenameGraph(graph, target, nextSlug) {
  const collections = reconstructCollections(graph);
  for (const content of collections[target.collection] || []) {
    if (content.slug === target.slug || (target.collection === 'site-settings' && target.slug === 'global')) {
      content.slug = nextSlug;
    }
  }
  if (target.collection === 'product-sections') {
    for (const category of collections['product-categories'] || []) {
      if (category.parentSectionSlug === target.slug) category.parentSectionSlug = nextSlug;
    }
  }
  if (target.collection === 'product-categories') {
    for (const product of collections.products || []) {
      if (product.productCategorySlug === target.slug) product.productCategorySlug = nextSlug;
    }
  }
  if (target.collection === 'products') {
    for (const product of collections.products || []) {
      if (!Array.isArray(product.relatedProductSlugs)) continue;
      product.relatedProductSlugs = product.relatedProductSlugs.map((slug) => slug === target.slug ? nextSlug : slug);
    }
  }
  return buildRelationGraph({
    collections,
    navigation: graph.navigation,
    fixedRoutes: graph.fixedRoutes,
    lockedStaticSlugs: graph.lockedStaticSlugs,
    reservedTopLevelSlugs: graph.reservedTopLevelSlugs
  });
}

function updateDescriptor(source, path, from, to, reason) {
  return { target: clone(source), path, from: clone(from), to: clone(to), reason };
}

function renamePreview(graph, target, nextSlug) {
  const blockers = [];
  const warnings = [];
  const relationUpdates = [];
  const trimmedNextSlug = String(nextSlug ?? '').trim();

  if (!Object.hasOwn(target.content, 'slug')) {
    blockers.push(blocker('SLUG_RENAME_UNSUPPORTED', `Запись ${target.id} не имеет изменяемого slug.`));
  }
  if (target.collection === 'static-pages' && graph.lockedStaticSlugs.includes(target.slug)) {
    blockers.push(blocker('LOCKED_SLUG', `Системный slug ${target.slug} нельзя переименовать.`));
  }
  if (!SAFE_SLUG_RE.test(trimmedNextSlug)) {
    blockers.push(blocker('INVALID_SLUG', 'Slug должен состоять из строчных латинских букв, цифр и одиночных дефисов.'));
  }
  if (TOP_LEVEL_ROUTE_COLLECTIONS.has(target.collection) && graph.reservedTopLevelSlugs.includes(trimmedNextSlug)) {
    blockers.push(blocker('RESERVED_SLUG', `Slug ${trimmedNextSlug} занят системным маршрутом.`));
  }
  if (graph.records.some((record) => record.collection === target.collection && record.slug === trimmedNextSlug && record.id !== target.id)) {
    blockers.push(blocker('SLUG_COLLISION', `Slug ${trimmedNextSlug} уже используется в коллекции ${target.collection}.`));
  }
  if (trimmedNextSlug === target.slug) {
    warnings.push(warning('SLUG_UNCHANGED', 'Новый slug совпадает с текущим; изменений нет.'));
    return { blockers: sortedBlockers(blockers), warnings, relationUpdates, affectedRecords: [], affectedRoutes: [] };
  }
  if (!SAFE_SLUG_RE.test(trimmedNextSlug) || !Object.hasOwn(target.content, 'slug')) {
    return { blockers: sortedBlockers(blockers), warnings, relationUpdates, affectedRecords: [], affectedRoutes: [] };
  }

  const projected = projectedRenameGraph(graph, target, trimmedNextSlug);
  const projectedTarget = findRecord(projected, target.collection, trimmedNextSlug);
  const descendants = descendantRecords(graph, target);
  const affected = [target, ...descendants];
  const projectedRecord = (record) => record.id === target.id
    ? projectedTarget
    : findRecord(projected, record.collection, record.slug);
  const affectedRoutes = affected
    .map((record) => ({
      record: recordRef(record),
      from: record.route,
      to: projectedRecord(record)?.route || null,
      status: record.route === projectedRecord(record)?.route ? 'unchanged' : 'renamed'
    }))
    .filter((route) => route.from || route.to)
    .sort((left, right) => compareText(left.record.id, right.record.id));
  const routeMapping = new Map(affectedRoutes
    .filter((route) => route.from && route.to && route.from !== route.to)
    .map((route) => [route.from, route.to]));

  relationUpdates.push(updateDescriptor(recordRef(target), 'slug', target.slug, trimmedNextSlug, 'slug-rename'));
  if (target.collection === 'product-sections') {
    for (const relation of graph.relations.filter((item) => item.type === 'category-section' && item.target.id === target.id)) {
      relationUpdates.push(updateDescriptor(relation.source, relation.path, target.slug, trimmedNextSlug, 'section-child-cascade'));
    }
  }
  if (target.collection === 'product-categories') {
    for (const relation of graph.relations.filter((item) => item.type === 'product-category' && item.target.id === target.id)) {
      relationUpdates.push(updateDescriptor(relation.source, relation.path, target.slug, trimmedNextSlug, 'category-child-cascade'));
    }
  }
  const directReferenceTypes = new Set([
    target.collection === 'products' ? 'product-related' : '',
    target.collection === 'product-categories' ? 'content-category' : '',
    target.collection === 'product-sections' ? 'content-section' : '',
    target.collection === 'products' ? 'content-product' : '',
    target.collection === 'projects' ? 'content-project' : '',
    target.collection === 'services' ? 'content-service' : ''
  ]);
  for (const relation of graph.relations.filter((item) => directReferenceTypes.has(item.type) && item.target.id === target.id)) {
    if (relationSourceIsTarget(relation, target) && relation.path === 'slug') continue;
    relationUpdates.push(updateDescriptor(relation.source, relation.path, relation.value, trimmedNextSlug, 'record-reference-cascade'));
  }
  for (const relation of graph.relations.filter((item) => (
    (item.type === 'content-route' || item.type === 'navigation-route')
    && routeMapping.has(item.target.path)
  ))) {
    relationUpdates.push(updateDescriptor(
      relation.source,
      relation.path,
      relation.value,
      replaceHrefPath(relation.value, routeMapping.get(relation.target.path)),
      'internal-href-cascade'
    ));
  }

  const affectedProjectedIds = new Set(affected.map((record) => (
    record.id === target.id ? projectedTarget?.id : record.id
  )));
  for (const collision of projected.routeCollisions) {
    if (!collision.owners.some((owner) => owner.kind === 'record' && affectedProjectedIds.has(owner.id))) continue;
    blockers.push(blocker('ROUTE_COLLISION', `Новый публичный адрес ${collision.path} уже занят.`, undefined, {
      path: collision.path,
      owners: clone(collision.owners)
    }));
  }
  if (affectedRoutes.some((route) => route.status === 'renamed')) {
    warnings.push(warning('NO_AUTOMATIC_REDIRECT', 'Переименование меняет публичный URL; автоматический redirect не создаётся.'));
  }

  const normalizedUpdates = uniqueBy(relationUpdates, (update) => `${update.target.id}\0${update.path}`)
    .sort((left, right) => compareText(`${left.target.id}\0${left.path}`, `${right.target.id}\0${right.path}`));
  const affectedRecordIds = new Set([target.id, ...normalizedUpdates
    .filter((update) => update.target.kind === 'record')
    .map((update) => update.target.id)]);
  for (const route of affectedRoutes) affectedRecordIds.add(route.record.id);
  const affectedRecords = [...affectedRecordIds]
    .map((id) => graph.records.find((record) => record.id === id) || (id === projectedTarget?.id ? target : null))
    .filter(Boolean)
    .map(recordRef)
    .sort((left, right) => compareText(left.id, right.id));

  return {
    blockers: sortedBlockers(blockers),
    warnings,
    relationUpdates: normalizedUpdates,
    affectedRecords,
    affectedRoutes,
    oldRoute: target.route,
    newRoute: projectedTarget?.route || null,
    redirect: { created: false }
  };
}

function deletePreview(graph, target) {
  const blockers = [];
  const warnings = [];
  if (target.collection === 'site-settings') {
    blockers.push(blocker('DELETE_UNSUPPORTED', 'Глобальные настройки сайта нельзя удалить как обычную запись.'));
  }
  if (target.collection === 'static-pages' && graph.lockedStaticSlugs.includes(target.slug)) {
    blockers.push(blocker('LOCKED_SLUG', `Системную страницу ${target.slug} нельзя удалить.`));
  }

  for (const relation of graph.relations.filter((item) => item.target.kind === 'record' && item.target.id === target.id)) {
    if (relationSourceIsTarget(relation, target)) continue;
    if (relation.type === 'category-section') {
      blockers.push(blocker('CHILD_CATEGORY', `Сначала перенесите или удалите категорию ${relation.source.slug}.`, relation));
    } else if (relation.type === 'product-category') {
      blockers.push(blocker('CHILD_PRODUCT', `Сначала перенесите или удалите товар ${relation.source.slug}.`, relation));
    } else if (relation.type === 'product-related') {
      blockers.push(blocker('INBOUND_RELATED_PRODUCT', `Товар указан в связанных товарах записи ${relation.source.slug}.`, relation));
    } else {
      blockers.push(blocker('INBOUND_RECORD_REFERENCE', `Запись ${relation.source.id} ссылается на удаляемую сущность.`, relation));
    }
  }
  for (const relation of graph.relations.filter((item) => (
    item.target.kind === 'route'
    && item.target.path === target.route
    && !relationSourceIsTarget(item, target)
  ))) {
    blockers.push(blocker('INBOUND_ROUTE_REFERENCE', `Внутренняя ссылка ${relation.value} ведёт на удаляемую страницу.`, relation));
  }

  const media = mediaImpact(graph, target);
  if (media.length) {
    warnings.push(warning('MEDIA_RETAINED', 'Исходные медиафайлы не будут удалены вместе с записью.', {
      paths: media.map((item) => item.path)
    }));
  }
  return {
    blockers: sortedBlockers(blockers),
    warnings,
    relationUpdates: [],
    affectedRecords: [recordRef(target)],
    affectedRoutes: target.route ? [{ record: recordRef(target), from: target.route, to: null, status: 'removed' }] : [],
    media
  };
}

function archivePreview(graph, target) {
  const visibilityField = VISIBILITY_FIELDS[target.collection];
  if (!visibilityField) {
    return {
      blockers: [blocker('ARCHIVE_UNSUPPORTED', `Коллекция ${target.collection} не имеет безопасного поля видимости.`)],
      warnings: [],
      relationUpdates: [],
      affectedRecords: [],
      affectedRoutes: [],
      media: mediaImpact(graph, target)
    };
  }

  const descendants = descendantRecords(graph, target);
  const affected = [target, ...descendants];
  const affectedPaths = new Set(affected.map((record) => record.route).filter(Boolean));
  const inbound = inboundReferences(graph, affected, affectedPaths)
    .filter((relation) => !affected.some((record) => relation.source.id === record.id));
  const warnings = [];
  if (descendants.length) {
    warnings.push(warning('DEPENDENT_ROUTES_HIDDEN', 'Вместе с родительской страницей станут недоступны дочерние публичные маршруты.', {
      records: descendants.map(recordRef)
    }));
  }
  if (inbound.length) {
    warnings.push(warning('INBOUND_REFERENCES_REMAIN', 'Ссылки на скрываемую страницу останутся в сохранённых записях.', {
      references: clone(inbound)
    }));
  }
  if (target.content[visibilityField] === false) warnings.push(warning('ALREADY_ARCHIVED', 'Запись уже скрыта с сайта.'));

  return {
    blockers: [],
    warnings,
    relationUpdates: [updateDescriptor(recordRef(target), visibilityField, target.content[visibilityField], false, 'archive')],
    affectedRecords: affected.map(recordRef).sort((left, right) => compareText(left.id, right.id)),
    affectedRoutes: affected
      .filter((record) => record.route)
      .map((record) => ({ record: recordRef(record), from: record.route, to: null, status: 'unavailable' }))
      .sort((left, right) => compareText(left.record.id, right.record.id)),
    media: mediaImpact(graph, target)
  };
}

/**
 * Preview the referential impact of archive, hard delete, or slug rename. This
 * function only describes mutations; it never mutates the graph or content.
 */
export function previewRelationImpact(graph, operation = {}) {
  const action = operation.action === 'slug-rename' ? 'rename' : operation.action;
  const collection = String(operation.collection || '').trim();
  const slug = String(operation.slug || '').trim();
  const target = findRecord(graph, collection, slug);
  const base = {
    action,
    target: target ? recordRef(target) : { kind: 'record', id: recordId(collection, slug), collection, slug },
    allowed: false,
    blockers: [],
    warnings: [],
    relationUpdates: [],
    affectedRecords: [],
    affectedRoutes: [],
    media: []
  };
  if (!target) {
    base.blockers = [blocker('TARGET_NOT_FOUND', `Запись ${collection}:${slug} не найдена.`)];
    return base;
  }

  let detail;
  if (action === 'archive') detail = archivePreview(graph, target);
  else if (action === 'delete') detail = deletePreview(graph, target);
  else if (action === 'rename') detail = renamePreview(graph, target, operation.nextSlug);
  else detail = { blockers: [blocker('UNSUPPORTED_ACTION', `Операция ${action || '<empty>'} не поддерживается.`)] };

  const result = { ...base, ...detail };
  result.allowed = result.blockers.length === 0;
  return result;
}

export function findBlockingReferences(graph, operation) {
  return previewRelationImpact(graph, operation).blockers;
}

export function getMediaReferences(graph, value) {
  const path = normalizeMediaPath(value);
  const entry = path ? graph.media.find((item) => item.path === path) : null;
  return entry
    ? clone(entry)
    : { path: path || String(value ?? ''), referenceCount: 0, recordCount: 0, references: [] };
}

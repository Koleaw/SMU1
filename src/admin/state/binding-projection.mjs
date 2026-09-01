import { getAtPath } from './history-store.mjs';

const RECORD_COLLECTIONS = Object.freeze([
  'product-sections',
  'product-categories',
  'products',
  'services',
  'projects',
  'jobs',
  'site-settings',
  'static-pages',
  'navigation'
]);
const COLLECTION_PREFIXES = [...RECORD_COLLECTIONS].sort((left, right) => right.length - left.length);
const NAMED_SELECTOR_RE = /^([A-Za-z_$][\w$-]*)\[([A-Za-z_$][\w$-]*)\](?:\.(.+))?$/u;
const SAFE_PATH_RE = /^[A-Za-z_$][\w$-]*(?:(?:\.[A-Za-z_$][\w$-]*)|(?:\[(?:\d+|[A-Za-z_$][\w$-]*)\]))*$/u;
const STRUCTURAL_FALLBACKS = new Set(['category order']);
const PRESERVED_PROJECTION_KINDS = new Set(['derived', 'relation']);
const PRESERVED_TOOLS = new Set([
  'relation-select',
  'relation-list',
  'project-direction-relations',
  'direction-related-relations',
  'reorder-item'
]);

function ownerOf(binding) {
  const owner = binding?.owner || {};
  const collection = String(binding?.ownerCollection || owner.collection || owner.key || '');
  const slug = String(binding?.recordSlug || owner.slug || '');
  return collection && slug ? { collection, slug } : null;
}

function sameOwner(left, right) {
  return left?.collection === right?.collection && left?.slug === right?.slug;
}

function dependency(owner) {
  return Object.freeze({ collection: owner.collection, slug: owner.slug });
}

export function bindingOwnerDependency(binding) {
  const owner = ownerOf(binding);
  return owner ? dependency(owner) : null;
}

function safeRelationMediaConfig(binding) {
  const config = binding?.relationProjection;
  if (!config || !['relation-select', 'relation-list'].includes(binding?.tool)) return null;
  const declaredCollections = [
    binding?.relationCollection,
    ...(Array.isArray(binding?.relationCollections) ? binding.relationCollections : [])
  ].map((value) => String(value || '')).filter(Boolean);
  const collection = [...new Set(declaredCollections)].length === 1 ? declaredCollections[0] : '';
  const mediaBindingId = String(config.mediaBindingId || '');
  const mediaFieldPaths = Array.isArray(config.mediaFieldPaths)
    ? config.mediaFieldPaths.map((value) => String(value || '')).filter((value) => SAFE_PATH_RE.test(value))
    : [];
  if (!RECORD_COLLECTIONS.includes(collection) || mediaBindingId.length < 9 || mediaBindingId.length > 240 || !mediaFieldPaths.length) return null;
  const strategy = config.strategy === 'gateway-frame' ? 'gateway-frame' : 'first-relation';
  const frameOffset = Number.isSafeInteger(config.frameOffset) && config.frameOffset >= 0 && config.frameOffset <= 5
    ? config.frameOffset
    : 0;
  const excludedMediaPaths = new Set((Array.isArray(config.excludedMediaPaths) ? config.excludedMediaPaths : [])
    .map((value) => String(value || '')).filter((value) => value.startsWith('/')));
  return { collection, mediaBindingId, mediaFieldPaths, strategy, frameOffset, excludedMediaPaths };
}

function relationMediaSources(targetContent, config) {
  const rolesByPath = targetContent?.presentation?.mediaRoles || {};
  const gatewaySafe = (value) => {
    const path = typeof value === 'object' && value ? String(value.src || value.path || '') : String(value || '');
    if (!path || config.excludedMediaPaths.has(path) || /\/assets\/images\/placeholders\//iu.test(path)) return false;
    if (config.strategy !== 'gateway-frame') return true;
    const roles = Array.isArray(rolesByPath[path]) ? rolesByPath[path] : [];
    return (roles.includes('finished-result') || roles.includes('proof'))
      && !roles.includes('process')
      && !roles.includes('excluded');
  };
  const sources = [];
  const seen = new Set();
  for (const fieldPath of config.mediaFieldPaths) {
    const candidate = readProjectionPath(targetContent, fieldPath);
    const values = Array.isArray(candidate) ? candidate : [candidate];
    values.forEach((sourceValue, index) => {
      if (isMissingScalar(sourceValue) || !gatewaySafe(sourceValue)) return;
      const mediaPath = typeof sourceValue === 'object' && sourceValue
        ? String(sourceValue.src || sourceValue.path || '')
        : String(sourceValue || '');
      if (!mediaPath || seen.has(mediaPath)) return;
      seen.add(mediaPath);
      sources.push({
        sourceFieldPath: Array.isArray(candidate) ? `${fieldPath}[${index}]` : fieldPath,
        mediaPath
      });
    });
  }
  return sources;
}

/**
 * Resolves an explicitly declared borrowed-media relation without projecting
 * the relation slug into renderer-owned DOM. The caller retargets the already
 * registered visible media occurrence after the dependency has loaded.
 */
export function resolveRelationMediaProjection(binding, readRecordContent) {
  const owner = ownerOf(binding);
  const config = safeRelationMediaConfig(binding);
  if (!owner || !config) return Object.freeze({ status: 'preserve', reason: 'no-live-relation-media', dependencies: [] });

  const ownerContent = readRecordContent(owner.collection, owner.slug);
  if (ownerContent === undefined) return Object.freeze({ status: 'pending', dependencies: [dependency(owner)] });
  const relationValue = readProjectionPath(ownerContent, String(binding.fieldPath || ''));
  const targetSlugs = (binding.tool === 'relation-list' && Array.isArray(relationValue) ? relationValue : [relationValue])
    .filter((value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/u.test(value));
  if (!targetSlugs.length) {
    return Object.freeze({ status: 'preserve', reason: 'empty-relation-target', dependencies: [] });
  }

  const projectionTargetSlugs = config.strategy === 'gateway-frame' ? targetSlugs : targetSlugs.slice(0, 1);
  const targets = projectionTargetSlugs.map((slug) => ({
    owner: { collection: config.collection, slug },
    content: readRecordContent(config.collection, slug)
  }));
  const missing = targets.filter((target) => target.content === undefined).map((target) => dependency(target.owner));
  if (missing.length) return Object.freeze({ status: 'pending', dependencies: missing });
  const resolvedTargets = targets.map((target) => ({ ...target, sources: relationMediaSources(target.content, config) }));
  let selected = { ...resolvedTargets[0], source: resolvedTargets[0].sources[0] || { sourceFieldPath: config.mediaFieldPaths[0], mediaPath: '' } };
  if (config.strategy === 'gateway-frame') {
    const selectedFrames = [];
    const selectedPaths = new Set();
    let added = true;
    while (selectedFrames.length < 6 && added) {
      added = false;
      for (const target of resolvedTargets) {
        const source = target.sources.find((candidate) => !selectedPaths.has(candidate.mediaPath));
        if (!source) continue;
        selectedFrames.push({ ...target, source });
        selectedPaths.add(source.mediaPath);
        added = true;
        if (selectedFrames.length >= 6) break;
      }
    }
    if (selectedFrames.length) {
      selected = selectedFrames[config.frameOffset % selectedFrames.length];
    }
  }
  const targetOwner = selected.owner;
  const targetContent = selected.content;
  const targetSlug = targetOwner.slug;
  const { sourceFieldPath, mediaPath } = selected.source;
  const altOverrides = readProjectionPath(targetContent, 'presentation.altOverrides');
  const rawMedia = [
    targetContent.image,
    targetContent.coverImage,
    ...(Array.isArray(targetContent.gallery) ? targetContent.gallery : []),
    ...(Array.isArray(targetContent.images) ? targetContent.images : [])
  ].find((item) => item && typeof item === 'object' && String(item.src || item.path || '') === mediaPath);
  const alt = mediaPath && altOverrides && typeof altOverrides === 'object' && altOverrides[mediaPath]
    ? String(altOverrides[mediaPath])
    : String(rawMedia?.alt || targetContent.title || 'Выполненный объект');
  const sourcePosition = sourceFieldPath.startsWith('presentation.archiveCoverMedia')
    ? String(readProjectionPath(targetContent, 'presentation.archiveCoverPosition') || '50% 50%')
    : sourceFieldPath.startsWith('presentation.detailHeroMedia')
      ? String(readProjectionPath(targetContent, 'presentation.detailHeroPosition') || '50% 50%')
      : '50% 50%';

  return Object.freeze({
    status: 'value',
    value: Object.freeze({
      mediaBindingId: config.mediaBindingId,
      targetOwner: dependency(targetOwner),
      sourceFieldPath,
      mediaPath,
      alt,
      sourcePosition,
      title: String(targetContent.title || targetSlug)
    }),
    dependencies: []
  });
}

function isMissingScalar(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

function parseReference(candidate, inheritedOwner) {
  const source = String(candidate || '').trim();
  if (!source || !inheritedOwner) return null;
  for (const collection of COLLECTION_PREFIXES) {
    const prefix = `${collection}.`;
    if (!source.startsWith(prefix)) continue;
    const remainder = source.slice(prefix.length);
    if (collection === 'site-settings' || collection === 'navigation') {
      return SAFE_PATH_RE.test(remainder)
        ? { owner: { collection, slug: collection === 'site-settings' ? 'global' : 'navigation' }, path: remainder }
        : null;
    }
    const separator = remainder.indexOf('.');
    if (separator < 1) return null;
    const slug = remainder.slice(0, separator);
    const path = remainder.slice(separator + 1);
    return /^[a-z0-9][a-z0-9-]*$/u.test(slug) && SAFE_PATH_RE.test(path)
      ? { owner: { collection, slug }, path }
      : null;
  }
  return SAFE_PATH_RE.test(source) ? { owner: inheritedOwner, path: source } : null;
}

function readProjectionPath(content, path) {
  if (!content || typeof content !== 'object') return undefined;
  const selector = NAMED_SELECTOR_RE.exec(path);
  if (!selector) {
    try { return getAtPath(content, path); }
    catch { return undefined; }
  }
  const [, listPath, stableSelector, remainder] = selector;
  let items;
  try { items = getAtPath(content, listPath); }
  catch { return undefined; }
  if (!Array.isArray(items)) return undefined;
  const selected = items
    .filter((item) => item && typeof item === 'object' && item.isActive !== false)
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .find((item) => [item.id, item.type, item.slug].some((value) => String(value || '') === stableSelector));
  if (!selected) return undefined;
  if (!remainder) return selected;
  try { return getAtPath(selected, remainder); }
  catch { return undefined; }
}

/**
 * Resolves the value that may safely be projected into the already-rendered
 * production canvas. Fallbacks are replacements, never array merges.
 * Structural relations keep their production-rendered DOM until the exact
 * renderer can reconcile the complete related records.
 */
export function resolveBindingProjection(binding, readRecordContent) {
  const owner = ownerOf(binding);
  const projection = binding?.projection || {};
  const fallbackExpression = String(projection.fallback || '').trim();

  if (!owner) return Object.freeze({ status: 'preserve', reason: 'missing-owner', dependencies: [] });
  const sharedMediaProjection = projection.kind === 'shared-media' && ['media', 'gallery'].includes(binding?.tool);
  if (PRESERVED_TOOLS.has(binding?.tool) || (PRESERVED_PROJECTION_KINDS.has(projection.kind) && !sharedMediaProjection)) {
    return Object.freeze({ status: 'preserve', reason: 'structural-projection', dependencies: [] });
  }
  if (STRUCTURAL_FALLBACKS.has(fallbackExpression)) {
    return Object.freeze({ status: 'preserve', reason: 'structural-fallback', dependencies: [] });
  }

  const content = readRecordContent(owner.collection, owner.slug);
  if (content === undefined) {
    return Object.freeze({ status: 'pending', dependencies: [dependency(owner)] });
  }

  const directValue = readProjectionPath(content, String(binding?.fieldPath || ''));
  if (!isMissingScalar(directValue) || !fallbackExpression) {
    return directValue === undefined
      ? Object.freeze({ status: 'preserve', reason: 'undefined-direct-value', dependencies: [] })
      : Object.freeze({ status: 'value', value: directValue, dependencies: [] });
  }

  let inheritedOwner = owner;
  const dependencies = [];
  for (const candidate of fallbackExpression.split('||').map((item) => item.trim()).filter(Boolean)) {
    const reference = parseReference(candidate, inheritedOwner);
    if (!reference) return Object.freeze({ status: 'preserve', reason: 'descriptive-fallback', dependencies: [] });
    inheritedOwner = reference.owner;
    const fallbackContent = readRecordContent(reference.owner.collection, reference.owner.slug);
    if (fallbackContent === undefined) {
      if (!sameOwner(reference.owner, owner)) dependencies.push(dependency(reference.owner));
      continue;
    }
    const fallbackValue = readProjectionPath(fallbackContent, reference.path);
    if (!isMissingScalar(fallbackValue)) {
      return Object.freeze({ status: 'value', value: fallbackValue, dependencies: [] });
    }
  }

  if (dependencies.length) {
    const unique = new Map(dependencies.map((item) => [`${item.collection}:${item.slug}`, item]));
    return Object.freeze({ status: 'pending', dependencies: [...unique.values()] });
  }
  return Object.freeze({ status: 'preserve', reason: 'empty-fallback', dependencies: [] });
}

const dimensions = Object.freeze(['width', 'height']);
const visualDimensionByLayoutDimension = Object.freeze({
  width: 'visualWidth',
  height: 'visualHeight'
});
const directMediaBindingTools = new Set(['crop', 'gallery', 'media', 'video']);

export function isDirectMediaBindingTool(tool) {
  return directMediaBindingTools.has(tool);
}

const normalizeBase = (value) => {
  const raw = String(value || '/').trim();
  if (!raw || raw === '/') return '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
};

const withoutBase = (pathname, basePath) => {
  const normalizedBase = normalizeBase(basePath);
  return normalizedBase !== '/' && (pathname === normalizedBase || pathname.startsWith(`${normalizedBase}/`))
    ? pathname.slice(normalizedBase.length) || '/'
    : pathname;
};

function parseFieldPath(fieldPath) {
  const raw = String(fieldPath || '');
  if (!raw) return null;
  const segments = raw.split('.');
  const tokens = [];
  const normalized = [];
  for (const segment of segments) {
    const match = segment.match(/^([A-Za-z_$][\w$-]*)((?:\[\d+\])*)$/u);
    if (!match) return null;
    const indexes = [...match[2].matchAll(/\[(\d+)\]/gu)].map((item) => Number(item[1]));
    tokens.push({ property: match[1], indexes });
    normalized.push(`${match[1]}${'[]'.repeat(indexes.length)}`);
  }
  return { tokens, normalized: normalized.join('.') };
}

/**
 * A binding is valid when it resolves through the concrete record, or when its
 * complete array-normalized path is declared by the schema registry. The
 * latter keeps optional/schema-backed fields valid without accepting a typo
 * merely because its root object exists.
 */
export function bindingFieldPathExists(record, fieldPath, declaredPaths = []) {
  const parsed = parseFieldPath(fieldPath);
  if (!parsed) return false;

  let value = record;
  let failure = '';
  for (const { property, indexes } of parsed.tokens) {
    if (!value || typeof value !== 'object') {
      failure = 'shape';
      break;
    }
    if (!Object.hasOwn(value, property)) {
      failure = 'optional-property';
      break;
    }
    value = value[property];
    for (const index of indexes) {
      if (!Array.isArray(value)) {
        failure = 'array-shape';
        break;
      }
      if (!Object.hasOwn(value, index)) {
        failure = 'array-index';
        break;
      }
      value = value[index];
    }
    if (failure) break;
  }
  if (!failure) return true;
  // A declared optional property on an existing object/item is valid. A
  // missing array element or incompatible runtime shape is not: accepting it
  // would let a stale occurrence write a sparse or unrelated list item.
  return failure === 'optional-property' && declaredPaths.includes(parsed.normalized);
}

const comparableMediaUrl = (value, snapshotLocation, localBaseByOrigin) => {
  if (!value) return '';
  let url;
  try { url = new URL(value, snapshotLocation); }
  catch { return `invalid:${String(value)}`; }
  const localBase = localBaseByOrigin.get(url.origin);
  if (localBase !== undefined && ['http:', 'https:'].includes(url.protocol)) {
    return `${withoutBase(url.pathname, localBase)}${url.search}${url.hash}`;
  }
  return url.href;
};

const normalizeSrcset = (value, snapshotLocation, localBaseByOrigin) => String(value || '')
  .split(',')
  .map((candidate) => candidate.trim())
  .filter(Boolean)
  .map((candidate) => {
    const [url, ...descriptor] = candidate.split(/\s+/u);
    return [comparableMediaUrl(url, snapshotLocation, localBaseByOrigin), ...descriptor].join(' ');
  });

const backgroundUrls = (value) => Array.from(
  String(value || '').matchAll(/url\(["']?([^"')]+)["']?\)/giu),
  (match) => match[1]
);

const mediaGroupOf = (item, index) => {
  const declared = String(item?.mediaGroup || '').trim();
  // Old snapshots did not expose picture/source ownership. Treat those items
  // as separate groups rather than pooling all page candidates: this remains
  // safe and prevents one image from borrowing another image's declaration.
  return declared || `media:${index}`;
};

const comparableMediaEntries = (snapshot) => (snapshot?.media || [])
  .map((item, index) => ({ item, index }))
  .filter(({ item }) => !item.runtimeSurface && (item.src || item.currentSrc || item.poster || item.srcset || item.declaredSources?.length));

/**
 * The browser inventory's mediaGroup is an intra-document association key. It
 * can be a generated counter and therefore legitimately shifts when the editor
 * adds runtime-only DOM. For cross-document comparison, retain the grouping
 * topology and first-occurrence order, but replace raw values with ordinals.
 */
const comparableGroupOrdinals = (entries) => {
  const ordinals = new Map();
  for (const { item, index } of entries) {
    const group = mediaGroupOf(item, index);
    if (!ordinals.has(group)) ordinals.set(group, `group:${ordinals.size + 1}`);
  }
  return ordinals;
};

const comparableGroupOf = (item, index, ordinals) => ordinals.get(mediaGroupOf(item, index));

const declaredMediaCandidates = (item, normalizeUrl, snapshotLocation, localBaseByOrigin) => {
  const candidates = new Set();
  for (const value of [item?.src, item?.poster, ...(item?.declaredSources || [])]) {
    const normalized = normalizeUrl(value);
    if (normalized) candidates.add(normalized);
  }
  for (const candidate of normalizeSrcset(item?.srcset, snapshotLocation, localBaseByOrigin)) {
    const [value] = candidate.split(/\s+/u);
    if (value) candidates.add(value);
  }
  return candidates;
};

/**
 * Produces a deterministic media descriptor. Only explicitly local origins
 * and their configured deploy bases are collapsed; external origins, query
 * strings, fragments, direct video sources and CSS background URLs survive.
 */
export function comparableMedia(snapshot, { localOrigins = [] } = {}) {
  const snapshotLocation = snapshot?.location || 'http://route-passport.invalid/';
  const localBaseByOrigin = new Map(localOrigins.map(({ origin, basePath = '/' }) => [new URL(origin).origin, normalizeBase(basePath)]));
  const normalizeUrl = (value) => comparableMediaUrl(value, snapshotLocation, localBaseByOrigin);

  const entries = comparableMediaEntries(snapshot);
  const groupOrdinals = comparableGroupOrdinals(entries);
  const elementMedia = entries
    .map(({ item, index }) => ({
      tag: item.tag,
      mediaGroup: comparableGroupOf(item, index, groupOrdinals),
      mediaAttribute: String(item.mediaAttribute || ''),
      src: normalizeUrl(item.src),
      poster: normalizeUrl(item.poster),
      srcset: normalizeSrcset(item.srcset, snapshotLocation, localBaseByOrigin),
      declaredSources: (item.declaredSources || []).map(normalizeUrl),
      sizes: String(item.sizes || ''),
      mimeType: String(item.mimeType || '')
    }));
  const backgrounds = (snapshot?.backgroundMedia || [])
    .filter((item) => !item.runtimeSurface)
    .map((item) => ({
      tag: 'background',
      sources: backgroundUrls(item.background).map(normalizeUrl)
    }))
    .filter((item) => item.sources.length);
  return [...elementMedia, ...backgrounds];
}

/**
 * `currentSrc` is a runtime observation rather than renderer source data. It
 * may be empty for a lazy image in one sequential crawl and selected in the
 * next one. Validate every non-empty selection against its own declared
 * picture/media group, never against candidates elsewhere on the page.
 */
export function runtimeMediaSelectionIssues(snapshot, { localOrigins = [] } = {}) {
  const snapshotLocation = snapshot?.location || 'http://route-passport.invalid/';
  const localBaseByOrigin = new Map(localOrigins.map(({ origin, basePath = '/' }) => [new URL(origin).origin, normalizeBase(basePath)]));
  const normalizeUrl = (value) => comparableMediaUrl(value, snapshotLocation, localBaseByOrigin);
  const candidatesByGroup = new Map();
  for (const [index, item] of (snapshot?.media || []).entries()) {
    if (item.runtimeSurface) continue;
    const group = mediaGroupOf(item, index);
    const candidates = candidatesByGroup.get(group) || new Set();
    for (const candidate of declaredMediaCandidates(item, normalizeUrl, snapshotLocation, localBaseByOrigin)) candidates.add(candidate);
    candidatesByGroup.set(group, candidates);
  }
  const issues = [];
  for (const [index, item] of (snapshot?.media || []).entries()) {
    if (item.runtimeSurface || !item.currentSrc) continue;
    const selected = normalizeUrl(item.currentSrc);
    const mediaGroup = mediaGroupOf(item, index);
    if (selected && !candidatesByGroup.get(mediaGroup)?.has(selected)) {
      issues.push({ index, tag: item.tag, mediaGroup, selected });
    }
  }
  return issues;
}

const comparableCurrentSelections = (snapshot, { localOrigins = [] } = {}) => {
  const snapshotLocation = snapshot?.location || 'http://route-passport.invalid/';
  const localBaseByOrigin = new Map(localOrigins.map(({ origin, basePath = '/' }) => [new URL(origin).origin, normalizeBase(basePath)]));
  const entries = comparableMediaEntries(snapshot);
  const groupOrdinals = comparableGroupOrdinals(entries);
  return entries
    .map(({ item, index }) => ({
      index,
      tag: item.tag,
      mediaGroup: comparableGroupOf(item, index, groupOrdinals),
      currentSrc: comparableMediaUrl(item.currentSrc, snapshotLocation, localBaseByOrigin),
      // A source element does not render media itself. For an image, absence
      // is tolerated only if *both* equivalent items prove they are explicitly
      // lazy and not visible; otherwise one renderer may have accidentally
      // hidden or skipped a visible settled image.
      nonRenderingSource: String(item.tag || '').toLowerCase() === 'source',
      lazyAndInvisible: item.loading === 'lazy' && item.visible === false,
      loading: String(item.loading || ''),
      complete: item.complete === true,
      naturalWidth: Number(item.naturalWidth || 0),
      visible: item.visible === true,
      viewportIntersecting: item.viewportIntersecting === true
    }));
};

const h5WidthVariantFamily = (value) => {
  const match = String(value || '').match(/^\/_media\/h5\/([a-f0-9]{2})\/([a-f0-9]{64})-([a-f0-9]{12})-w\d+\.(avif|webp|jpe?g)([?#].*)?$/u);
  if (!match || match[1] !== match[2].slice(0, 2)) return '';
  return `${match[1]}/${match[2]}-${match[3]}.${match[4]}${match[5] || ''}`;
};

const sameH5WidthVariantFamily = (left, right) => {
  const leftFamily = h5WidthVariantFamily(left);
  return Boolean(leftFamily && leftFamily === h5WidthVariantFamily(right));
};

const currentSelectionDifferences = (publicSnapshot, editorSnapshot, options) => {
  const publicSelections = comparableCurrentSelections(publicSnapshot, options);
  const editorSelections = comparableCurrentSelections(editorSnapshot, options);
  const differences = [];
  const count = Math.max(publicSelections.length, editorSelections.length);
  for (let index = 0; index < count; index += 1) {
    const publicSelection = publicSelections[index];
    const editorSelection = editorSelections[index];
    if (!publicSelection || !editorSelection
      || publicSelection.tag !== editorSelection.tag
      || publicSelection.mediaGroup !== editorSelection.mediaGroup) {
      differences.push({ index, publicSelection: publicSelection || null, editorSelection: editorSelection || null });
      continue;
    }
    // `currentSrc` is selected by the browser, not the renderer. Chrome may
    // retain a cached larger H5 derivative across sequential origin/viewport
    // visits. Width variants are equivalent only when the immutable source
    // digest, pipeline hash, format and query/hash remain identical. Generic
    // art-direction candidates still fail closed.
    if (publicSelection.currentSrc && editorSelection.currentSrc
      && publicSelection.currentSrc !== editorSelection.currentSrc
      && !sameH5WidthVariantFamily(publicSelection.currentSrc, editorSelection.currentSrc)) {
      differences.push({ index, kind: 'different-selected-candidate', publicSelection, editorSelection });
      continue;
    }
    if (Boolean(publicSelection.currentSrc) !== Boolean(editorSelection.currentSrc)) {
      const emptySelection = publicSelection.currentSrc ? editorSelection : publicSelection;
      const allowedMissingSelection = publicSelection.nonRenderingSource && editorSelection.nonRenderingSource
        || (publicSelection.lazyAndInvisible && editorSelection.lazyAndInvisible)
        || (emptySelection.loading === 'lazy' && emptySelection.visible && !emptySelection.complete
          && emptySelection.naturalWidth === 0 && !emptySelection.viewportIntersecting);
      if (!allowedMissingSelection) {
        differences.push({
          index,
          kind: 'unexpected-empty-current-src',
          emptySide: publicSelection.currentSrc ? 'editor' : 'public',
          publicSelection,
          editorSelection
        });
      }
    }
  }
  return differences;
};

export function compareMediaSnapshots(publicSnapshot, editorSnapshot, options = {}) {
  const publicMedia = comparableMedia(publicSnapshot, options);
  const editorMedia = comparableMedia(editorSnapshot, options);
  const publicSelectionIssues = runtimeMediaSelectionIssues(publicSnapshot, options);
  const editorSelectionIssues = runtimeMediaSelectionIssues(editorSnapshot, options);
  const selectionDifferences = currentSelectionDifferences(publicSnapshot, editorSnapshot, options);
  const declarationsMatch = JSON.stringify(publicMedia) === JSON.stringify(editorMedia);
  const match = declarationsMatch && publicSelectionIssues.length === 0 && editorSelectionIssues.length === 0 && selectionDifferences.length === 0;
  if (match) return { match, publicMedia, editorMedia, publicSelectionIssues, editorSelectionIssues, selectionDifferences, diff: null };

  const publicKeys = publicMedia.map((item) => JSON.stringify(item));
  const editorKeys = editorMedia.map((item) => JSON.stringify(item));
  const subtract = (left, right) => {
    const remaining = [...right];
    return left.filter((item) => {
      const index = remaining.indexOf(item);
      if (index < 0) return true;
      remaining.splice(index, 1);
      return false;
    }).map((item) => JSON.parse(item));
  };
  const publicOnly = subtract(publicKeys, editorKeys);
  const editorOnly = subtract(editorKeys, publicKeys);
  const declarationDifferences = {
    publicOnly: publicOnly.slice(0, 12),
    editorOnly: editorOnly.slice(0, 12),
    orderOnly: publicOnly.length === 0 && editorOnly.length === 0
  };
  return {
    match,
    publicMedia,
    editorMedia,
    publicSelectionIssues,
    editorSelectionIssues,
    selectionDifferences,
    diff: {
      // Keep the flattened fields for existing evidence consumers, and carry
      // each independent failure class so a selection-only mismatch is never
      // reported as an opaque declaration diff.
      ...declarationDifferences,
      declarationDifferences,
      selectionDifferences,
      selectionIssues: {
        public: publicSelectionIssues,
        editor: editorSelectionIssues
      }
    }
  };
}

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
      const visualDimension = visualDimensionByLayoutDimension[dimension];
      const publicVisualValue = Number(publicTarget?.[visualDimension]);
      const editorVisualValue = Number(editorTarget?.[visualDimension]);
      if (!Number.isFinite(publicVisualValue) || !Number.isFinite(editorVisualValue)
        || Math.abs(publicVisualValue - editorVisualValue) > tolerance) {
        issues.push(`${key}:${visualDimension}:${publicVisualValue}->${editorVisualValue}`);
      }
    }
  }
  return issues;
}

function exactDimensions(publicDimensions, editorDimensions) {
  const normalizedEditor = Array.isArray(editorDimensions) ? editorDimensions : dimensions;
  return JSON.stringify(publicDimensions) === JSON.stringify(normalizedEditor);
}

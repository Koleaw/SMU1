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

/**
 * Produces a deterministic media descriptor. Only explicitly local origins
 * and their configured deploy bases are collapsed; external origins, query
 * strings, fragments, direct video sources and CSS background URLs survive.
 */
export function comparableMedia(snapshot, { localOrigins = [] } = {}) {
  const snapshotLocation = snapshot?.location || 'http://route-passport.invalid/';
  const localBaseByOrigin = new Map(localOrigins.map(({ origin, basePath = '/' }) => [new URL(origin).origin, normalizeBase(basePath)]));
  const normalizeUrl = (value) => comparableMediaUrl(value, snapshotLocation, localBaseByOrigin);

  const elementMedia = (snapshot?.media || [])
    .filter((item) => !item.runtimeSurface && (item.src || item.currentSrc || item.poster || item.srcset || item.declaredSources?.length))
    .map((item) => ({
      tag: item.tag,
      src: normalizeUrl(item.src),
      currentSrc: normalizeUrl(item.currentSrc),
      poster: normalizeUrl(item.poster),
      srcset: normalizeSrcset(item.srcset, snapshotLocation, localBaseByOrigin),
      declaredSources: (item.declaredSources || []).map(normalizeUrl)
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

export function compareMediaSnapshots(publicSnapshot, editorSnapshot, options = {}) {
  const publicMedia = comparableMedia(publicSnapshot, options);
  const editorMedia = comparableMedia(editorSnapshot, options);
  const match = JSON.stringify(publicMedia) === JSON.stringify(editorMedia);
  if (match) return { match, publicMedia, editorMedia, diff: null };

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
  return {
    match,
    publicMedia,
    editorMedia,
    diff: {
      publicOnly: publicOnly.slice(0, 12),
      editorOnly: editorOnly.slice(0, 12),
      orderOnly: publicOnly.length === 0 && editorOnly.length === 0
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

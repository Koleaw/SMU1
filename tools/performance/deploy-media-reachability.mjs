import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile
} from 'node:fs/promises';
import {
  dirname,
  extname,
  posix,
  relative,
  resolve,
  sep
} from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_DIST_ROOT = resolve(ROOT, 'dist');
const GENERATED_MEDIA_MANIFEST = '_media/h5/manifest.json';

export const MEDIA_EXTENSIONS = new Set([
  '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.m4a', '.m4v', '.mov',
  '.mp3', '.mp4', '.ogg', '.ogv', '.png', '.svg', '.tif', '.tiff', '.wav',
  '.webm', '.webp'
]);
export const TEXT_EXTENSIONS = new Set([
  '.css', '.cjs', '.html', '.js', '.json', '.map', '.mjs', '.svg', '.txt', '.webmanifest', '.xml'
]);
const RESOURCE_EXTENSIONS = new Set([
  ...MEDIA_EXTENSIONS,
  '.css', '.csv', '.doc', '.docx', '.eot', '.html', '.js', '.json', '.map',
  '.mjs', '.pdf', '.ppt', '.pptx', '.rtf', '.ttf', '.txt', '.wasm',
  '.webmanifest', '.woff', '.woff2', '.xls', '.xlsx', '.xml', '.zip'
]);
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'
]);
const URL_SCHEMES_TO_IGNORE = /^(?:about|blob|cid|data|javascript|mailto|sms|tel):/iu;

const posixPath = (value) => value.split(sep).join('/');
const sortedUnique = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
const stableSort = (value) => {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSort(value[key])]));
};
const stableJson = (value) => `${JSON.stringify(stableSort(value), null, 2)}\n`;
const normalizeBase = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/gu, '')}/`;
};
const decodeHtmlEntities = (value) => String(value)
  .replace(/&quot;/giu, '"')
  .replace(/&#39;|&apos;/giu, "'")
  .replace(/&amp;/giu, '&')
  .replace(/&lt;/giu, '<')
  .replace(/&gt;/giu, '>')
  .replace(/&#x([\da-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
const decodeEscapedSlashes = (value) => String(value)
  .replaceAll('\\/', '/')
  .replace(/\\u002f/giu, '/')
  .replace(/\\x2f/giu, '/');
const extensionForReference = (value) => extname(String(value).split(/[?#]/u, 1)[0]).toLocaleLowerCase('en');
export const isMediaPath = (value) => MEDIA_EXTENSIONS.has(extensionForReference(value));

export const sha256File = (filename) => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(filename);
  stream.on('error', reject);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => resolveHash(hash.digest('hex')));
});

const mapLimit = async (items, limit, callback) => {
  const output = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      output[index] = await callback(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, worker));
  return output;
};

const assertInside = (root, filename, label) => {
  const rootPrefix = `${root}${sep}`;
  if (filename === root || filename.startsWith(rootPrefix)) return;
  throw new Error(`${label} escapes dist: ${filename}`);
};

export const inventoryArtifact = async (distRoot = DEFAULT_DIST_ROOT) => {
  const absoluteRoot = resolve(distRoot);
  const rootDetails = await lstat(absoluteRoot).catch(() => null);
  if (!rootDetails?.isDirectory()) throw new Error(`dist directory does not exist: ${absoluteRoot}`);
  if (rootDetails.isSymbolicLink()) throw new Error(`Refusing symlinked dist root: ${absoluteRoot}`);
  const resolvedRoot = await realpath(absoluteRoot);
  if (resolvedRoot !== absoluteRoot) {
    throw new Error(`Refusing a dist root whose real path differs: ${absoluteRoot} -> ${resolvedRoot}`);
  }

  const files = [];
  const visit = async (directory) => {
    assertInside(absoluteRoot, directory, 'Directory');
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      assertInside(absoluteRoot, absolute, 'Artifact entry');
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) throw new Error(`Refusing symlink inside dist: ${absolute}`);
      if (details.isDirectory()) {
        await visit(absolute);
      } else if (details.isFile()) {
        files.push({
          path: posixPath(relative(absoluteRoot, absolute)),
          absolute,
          bytes: details.size,
          extension: extname(entry.name).toLocaleLowerCase('en')
        });
      } else {
        throw new Error(`Unsupported non-file artifact entry: ${absolute}`);
      }
    }
  };
  await visit(absoluteRoot);
  return { distRoot: absoluteRoot, files };
};

const parseAttributes = (source) => {
  const attributes = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLocaleLowerCase('en');
    if (!name || name === '/') continue;
    attributes[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
};

/**
 * Lightweight structural HTML reader for deterministic build assertions. It
 * is intentionally not a rendering parser, but preserves ancestor context for
 * picture/thumbnail/priority checks without adding a browser dependency.
 */
export const parseHtmlElements = (html) => {
  const root = { tag: '#document', attributes: {}, children: [], parent: null };
  const stack = [root];
  const tokenPattern = /<!--[\s\S]*?-->|<(?:script|style|textarea)\b[^>]*>[\s\S]*?<\/(?:script|style|textarea)\s*>|<![^>]*>|<\/?[a-z][^>]*>/giu;
  let match;
  while ((match = tokenPattern.exec(html))) {
    let token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    const rawContainer = /^<(?:script|style|textarea)\b/iu.test(token);
    if (rawContainer) token = token.slice(0, token.indexOf('>') + 1);
    const closing = /^<\//u.test(token);
    const nameMatch = token.match(/^<\/?\s*([a-z][\w:-]*)/iu);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLocaleLowerCase('en');
    if (closing) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const attributeSource = token
      .slice(nameMatch[0].length, token.length - 1)
      .replace(/\/\s*$/u, '');
    const parent = stack.at(-1);
    const node = { tag, attributes: parseAttributes(attributeSource), children: [], parent };
    parent.children.push(node);
    if (!rawContainer && !VOID_ELEMENTS.has(tag) && !/\/\s*>$/u.test(token)) stack.push(node);
  }
  return root;
};

export const walkHtmlElements = (rootNode, callback) => {
  const visit = (node) => {
    if (node.tag !== '#document') callback(node);
    node.children.forEach(visit);
  };
  visit(rootNode);
};

const splitSrcset = (value) => {
  const decoded = decodeHtmlEntities(value).trim();
  if (!decoded || /^data:/iu.test(decoded)) return [];
  return decoded.split(',').map((candidate) => candidate.trim().split(/\s+/u)[0]).filter(Boolean);
};

const extractCssReferences = (source, add) => {
  const urlPattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)'";]+))\s*\)/giu;
  let match;
  while ((match = urlPattern.exec(source))) add(match[1] ?? match[2] ?? match[3], 'css-url');
  const importPattern = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)')\s*\)?/giu;
  while ((match = importPattern.exec(source))) add(match[1] ?? match[2], 'css-import');
};

const visitJsonStrings = (value, callback, keyPath = []) => {
  if (typeof value === 'string') {
    callback(value, keyPath);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => visitJsonStrings(item, callback, [...keyPath, index]));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => visitJsonStrings(child, callback, [...keyPath, key]));
  }
};

const extractAssetTokens = (source, add, kind = 'embedded-token') => {
  // Deliberately requires an asset-like extension. This catches serialized
  // gallery and gateway payloads without treating arbitrary JS route strings
  // as deploy resources.
  const pattern = /(?:https?:\\?\/\\?\/[^\s"'`<>(){}$*,;]+|(?:\.{0,2}\\?\/|\\?\/)[^\s"'`<>(){}$*,;]+?)\.(?:avif|bmp|cjs|css|csv|docx?|eot|gif|html?|ico|jpe?g|js|json|m4a|m4v|map|mov|mp3|mp4|mjs|ogg|ogv|pdf|png|pptx?|svg|tiff?|ttf|txt|wasm|webmanifest|webm|webp|woff2?|xlsx?|xml|zip)(?=$|[?#\s"'`<>()])(?:[?#][^\s"'`<>()]*)?/giu;
  for (const match of source.matchAll(pattern)) add(decodeEscapedSlashes(match[0]), kind);
};

const extractHtmlReferences = (html, add, parseErrors) => {
  const tree = parseHtmlElements(html);
  walkHtmlElements(tree, (node) => {
    const attributes = node.attributes;
    const addAttribute = (name, kind = `${node.tag}-${name}`) => {
      if (attributes[name]) add(attributes[name], kind);
    };
    if (node.tag === 'img') {
      addAttribute('src');
      splitSrcset(attributes.srcset || '').forEach((value) => add(value, 'img-srcset'));
    } else if (node.tag === 'source') {
      addAttribute('src');
      splitSrcset(attributes.srcset || '').forEach((value) => add(value, 'source-srcset'));
    } else if (node.tag === 'script') {
      addAttribute('src');
    } else if (node.tag === 'video') {
      addAttribute('src');
      addAttribute('poster');
    } else if (node.tag === 'audio' || node.tag === 'track' || node.tag === 'embed' || node.tag === 'iframe'
      || node.tag === 'input') {
      addAttribute('src');
    } else if (node.tag === 'use' || node.tag === 'image') {
      addAttribute('href');
      addAttribute('xlink:href');
    } else if (node.tag === 'object') {
      addAttribute('data');
    } else if (node.tag === 'link') {
      const rel = String(attributes.rel || '').toLocaleLowerCase('en');
      if (/(?:stylesheet|icon|preload|prefetch|modulepreload|manifest)/u.test(rel)) addAttribute('href', `link-${rel || 'resource'}`);
      splitSrcset(attributes.imagesrcset || '').forEach((value) => add(value, 'link-imagesrcset'));
    } else if (node.tag === 'meta') {
      const property = String(attributes.property || attributes.name || attributes.itemprop || '').toLocaleLowerCase('en');
      if (/^(?:og:image(?::.+)?|twitter:image(?::.+)?|msapplication-tileimage)$/u.test(property)) {
        addAttribute('content', `meta-${property}`);
      }
    } else if (node.tag === 'a') {
      const href = attributes.href || '';
      if ('download' in attributes || RESOURCE_EXTENSIONS.has(extensionForReference(href))) add(href, 'download-or-asset-link');
      else if (/^(?:\.{0,2}\/|\/)/u.test(href)) add(href, 'internal-link');
    }
    if (attributes.style) extractCssReferences(attributes.style, add);
    for (const [name, rawValue] of Object.entries(attributes)) {
      if (!name.startsWith('data-') || !rawValue) continue;
      const value = decodeHtmlEntities(rawValue).trim();
      if (/^[\[{]/u.test(value)) {
        try {
          const parsed = JSON.parse(value);
          visitJsonStrings(parsed, (candidate, keyPath) => {
            extractAssetTokens(candidate, (reference) => add(reference, `data-json:${name}:${keyPath.join('.')}`));
          });
        } catch (error) {
          // Only JSON-shaped data attributes are considered parse failures.
          parseErrors.push(`Invalid embedded JSON in ${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        extractAssetTokens(value, (reference) => add(reference, `data:${name}`));
      }
    }
  });

  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)) {
    extractCssReferences(match[1], add);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    const attributes = parseAttributes(match[1]);
    if (/^application\/(?:ld\+)?json$/iu.test(attributes.type || '')) {
      try {
        const parsed = JSON.parse(decodeHtmlEntities(match[2]));
        visitJsonStrings(parsed, (candidate, keyPath) => {
          extractAssetTokens(candidate, (reference) => add(reference, `script-json:${keyPath.join('.')}`));
        });
      } catch (error) {
        parseErrors.push(`Invalid embedded script JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      extractAssetTokens(match[2], add, 'inline-script-token');
    }
  }
  extractAssetTokens(html, add);
};

const validateSimpleXml = (source) => {
  if (!/^\s*(?:<\?xml\b[^>]*>\s*)?</u.test(source)) throw new Error('XML does not begin with a document element.');
  const withoutOpaque = source
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gu, '')
    .replace(/<\?[^>]*>/gu, '');
  const stack = [];
  for (const match of withoutOpaque.matchAll(/<\/?\s*([\w:-]+)(?:\s[^<>]*)?\/?>/gu)) {
    const token = match[0];
    const tag = match[1];
    if (/^<\//u.test(token)) {
      if (stack.pop() !== tag) throw new Error(`Mismatched XML closing tag: ${tag}`);
    } else if (!/\/>$/u.test(token)) {
      stack.push(tag);
    }
  }
  if (stack.length) throw new Error(`Unclosed XML element: ${stack.at(-1)}`);
};

const extractTextReferences = (file, source, add, parseErrors) => {
  if (file.extension === '.html') {
    extractHtmlReferences(source, add, parseErrors);
  } else if (file.extension === '.css') {
    extractCssReferences(source, add);
    extractAssetTokens(source, add);
  } else if (['.json', '.map', '.webmanifest'].includes(file.extension)) {
    try {
      const parsed = JSON.parse(source);
      // The generated build-time media manifest is an inventory, not a
      // browser runtime root. Its paths are audited by qa-performance, while
      // actual deploy reachability must be established by emitted consumers.
      if (file.path !== GENERATED_MEDIA_MANIFEST) {
        visitJsonStrings(parsed, (candidate, keyPath) => {
          extractAssetTokens(candidate, (reference) => add(reference, `json:${keyPath.join('.')}`));
        });
      }
    } catch (error) {
      parseErrors.push(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (file.extension === '.xml' || file.extension === '.svg') {
    try { validateSimpleXml(source); } catch (error) {
      parseErrors.push(`Invalid XML: ${error instanceof Error ? error.message : String(error)}`);
    }
    extractAssetTokens(source, add);
  } else if (file.extension === '.txt') {
    extractCssReferences(source, add);
    extractAssetTokens(source, add);
  } else {
    extractAssetTokens(source, add);
  }
};

const inferBasePath = (textFiles, sourcesByPath) => {
  const candidates = new Map();
  const knownRoot = '(?:_astro|_media|assets|uploads)';
  // Do not mistake the authority in `https://host/_astro/...` for a BASE_PATH.
  // A real base candidate begins at a URL-path slash, never at the second
  // slash of a scheme delimiter.
  const pattern = new RegExp(`(?<![:/])/(?:[\\p{L}\\p{N}._~%+-]+/)+(?=${knownRoot}/)`, 'gu');
  for (const { source } of textFiles) {
    for (const match of source.matchAll(pattern)) {
      const candidate = normalizeBase(match[0]);
      if (candidate === '/') continue;
      const strippedRoot = match.input.slice((match.index || 0) + candidate.length).split(/[?#"'\s<>]/u, 1)[0];
      if (sourcesByPath.has(strippedRoot) || [...sourcesByPath.keys()].some((key) => key.startsWith(`${strippedRoot}/`))) {
        candidates.set(candidate, (candidates.get(candidate) || 0) + 1);
      }
    }
  }
  return [...candidates.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))[0]?.[0] || '/';
};

const normalizeRawReference = (raw) => {
  let value = decodeEscapedSlashes(decodeHtmlEntities(String(raw || ''))).trim();
  value = value.replace(/^['"]|['"]$/gu, '');
  if (!value || value === '#' || /(?:\$\{|<%|\{\{)/u.test(value)
    || URL_SCHEMES_TO_IGNORE.test(value) || value.startsWith('//')) return null;
  try { value = decodeURI(value); } catch { return null; }
  return value;
};

const artifactCandidates = ({ raw, sourcePath, basePath }) => {
  const normalized = normalizeRawReference(raw);
  if (!normalized) return { external: false, candidates: [], normalized: '' };
  let pathname = normalized;
  let external = false;
  try {
    const absolute = new URL(normalized);
    if (!['http:', 'https:'].includes(absolute.protocol)) return { external: true, candidates: [], normalized };
    pathname = absolute.pathname;
    external = true;
  } catch {}
  pathname = pathname.split(/[?#]/u, 1)[0].replaceAll('\\', '/');
  if (!pathname || pathname === '/') return { external, candidates: ['index.html'], normalized };
  const candidates = [];
  const add = (candidate) => {
    const clean = candidate.replace(/^\/+|\/+$/gu, '');
    if (!clean || clean.split('/').some((segment) => segment === '..' || segment === '.')) return;
    candidates.push(clean);
    if (pathname.endsWith('/') || !extname(clean)) {
      candidates.push(`${clean}/index.html`);
      candidates.push(`${clean}.html`);
    }
  };
  if (pathname.startsWith('/')) {
    if (basePath !== '/' && pathname.startsWith(basePath)) add(pathname.slice(basePath.length));
    add(pathname);
  } else {
    // Emitted references are URL paths even on Windows. Using node:path.resolve
    // here would inject a drive letter and silently break relative CSS/JS/media
    // reachability on the CI runner that produced this repository.
    add(posix.resolve('/', posix.dirname(sourcePath), pathname).replace(/^\//u, ''));
  }
  return { external, candidates: sortedUnique(candidates), normalized };
};

export const resolveArtifactReference = ({ raw, sourcePath, basePath = '/', filesByPath }) => {
  const parsed = artifactCandidates({ raw, sourcePath, basePath });
  for (const candidate of parsed.candidates) {
    if (filesByPath.has(candidate)) return { ...parsed, resolvedPath: candidate };
  }
  // Robust BASE_PATH fallback: only strip path prefixes when that produces an
  // actual unique artifact. This supports /SMU1/ without guessing repository
  // names and cannot escape the artifact root.
  // Cross-origin references may share a final segment with a local artifact
  // (`https://fonts.googleapis.com/css2` previously aliased to `index.html`).
  // Exact path matches remain conservative for absolute self-site OG URLs,
  // but prefix-stripping is valid only for local BASE_PATH references.
  if (parsed.external) return { ...parsed, resolvedPath: '' };
  const suffixMatches = [];
  for (const candidate of parsed.candidates) {
    const segments = candidate.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const suffix = segments.slice(index).join('/');
      if (filesByPath.has(suffix)) suffixMatches.push(suffix);
    }
  }
  const uniqueMatches = sortedUnique(suffixMatches);
  return { ...parsed, resolvedPath: uniqueMatches.length === 1 ? uniqueMatches[0] : '' };
};

const shouldRequireReference = (raw, kind, external) => {
  if (external) return false;
  const normalized = normalizeRawReference(raw);
  if (!normalized) return false;
  // Asset-like strings in executable JS can be examples, templates or
  // branches that are not runtime references (the admin visual specimen, for
  // example, intentionally contains `/uploads/photo.jpg`). Existing matches
  // are retained conservatively, while missing executable-string tokens are
  // reported but cannot make the deletion proof fail. Structured JSON/data
  // references remain fail-closed below.
  if (kind === 'embedded-token' || kind === 'inline-script-token') return false;
  if (kind === 'internal-link') return /^(?:\.{0,2}\/|\/)/u.test(normalized);
  if (/^(?:img|source|video|audio|track|embed|object|script|link|meta|css|download|data|json)/u.test(kind)) return true;
  return RESOURCE_EXTENSIONS.has(extensionForReference(normalized));
};

export const auditDeployMediaReachability = async ({
  distRoot = DEFAULT_DIST_ROOT,
  basePath = '',
  expectedHtmlCount = 229,
  apply = false,
  reportPath = ''
} = {}) => {
  const inventory = await inventoryArtifact(distRoot);
  const filesByPath = new Map(inventory.files.map((file) => [file.path, file]));
  const textFiles = [];
  const readErrors = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const file of inventory.files.filter((candidate) => TEXT_EXTENSIONS.has(candidate.extension))) {
    try {
      const buffer = await readFile(file.absolute);
      textFiles.push({ file, source: decoder.decode(buffer) });
    } catch (error) {
      readErrors.push({ path: file.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const effectiveBasePath = basePath ? normalizeBase(basePath) : inferBasePath(textFiles, filesByPath);
  const references = [];
  const parseErrors = [];
  for (const { file, source } of textFiles) {
    const localParseErrors = [];
    const extracted = [];
    extractTextReferences(file, source, (raw, kind) => {
      if (raw) extracted.push({ raw: String(raw), kind });
    }, localParseErrors);
    localParseErrors.forEach((error) => parseErrors.push({ path: file.path, error }));
    extracted.forEach(({ raw, kind }) => references.push({ sourcePath: file.path, raw, kind }));
  }

  const resolvedReferences = [];
  const missingReferences = [];
  const referencedPaths = new Set();
  const provenanceByPath = new Map();
  for (const reference of references) {
    const result = resolveArtifactReference({ ...reference, basePath: effectiveBasePath, filesByPath });
    const row = { ...reference, ...result };
    resolvedReferences.push(row);
    if (row.resolvedPath) {
      referencedPaths.add(row.resolvedPath);
      const provenance = provenanceByPath.get(row.resolvedPath) || [];
      provenance.push({ sourcePath: row.sourcePath, kind: row.kind, raw: row.raw });
      provenanceByPath.set(row.resolvedPath, provenance);
    } else if (shouldRequireReference(row.raw, row.kind, row.external)) {
      missingReferences.push({ sourcePath: row.sourcePath, kind: row.kind, raw: row.raw });
    }
  }

  const mediaFiles = inventory.files.filter((file) => isMediaPath(file.path));
  const hashedMedia = await mapLimit(mediaFiles, 4, async (file) => ({
    path: file.path,
    bytes: file.bytes,
    extension: file.extension,
    sha256: await sha256File(file.absolute),
    referenced: referencedPaths.has(file.path),
    references: (provenanceByPath.get(file.path) || []).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'en')
      || left.kind.localeCompare(right.kind, 'en') || left.raw.localeCompare(right.raw, 'en'))
  }));
  hashedMedia.sort((left, right) => left.path.localeCompare(right.path, 'en'));

  const duplicateGroupsFor = (files) => {
    const duplicateMap = new Map();
    for (const file of files) {
      const group = duplicateMap.get(file.sha256) || [];
      group.push(file);
      duplicateMap.set(file.sha256, group);
    }
    return [...duplicateMap.entries()]
      .filter(([, groupedFiles]) => groupedFiles.length > 1)
      .map(([sha256, groupedFiles]) => ({
        sha256,
        bytesPerFile: groupedFiles[0].bytes,
        paths: groupedFiles.map((file) => file.path).sort((left, right) => left.localeCompare(right, 'en')),
        totalBytes: groupedFiles.reduce((sum, file) => sum + file.bytes, 0),
        wastedBytes: groupedFiles.slice(1).reduce((sum, file) => sum + file.bytes, 0)
      }))
      .sort((left, right) => right.wastedBytes - left.wastedBytes || left.sha256.localeCompare(right.sha256, 'en'));
  };
  const duplicateGroups = duplicateGroupsFor(hashedMedia);
  const unreferencedCandidates = hashedMedia.filter((file) => !file.referenced);
  const projectedMedia = hashedMedia.filter((file) => file.referenced);
  const projectedDuplicateGroups = duplicateGroupsFor(projectedMedia);
  const htmlFiles = inventory.files.filter((file) => file.extension === '.html');
  const failClosed = {
    expectedHtmlCount,
    actualHtmlCount: htmlFiles.length,
    htmlCountMatches: htmlFiles.length === expectedHtmlCount,
    textualFilesExpected: inventory.files.filter((file) => TEXT_EXTENSIONS.has(file.extension)).length,
    textualFilesRead: textFiles.length,
    allTextualFilesRead: readErrors.length === 0,
    allTextualDocumentsParsed: parseErrors.length === 0,
    everyExtractedLocalReferenceExists: missingReferences.length === 0,
    noSymlinksOrTraversal: true
  };
  failClosed.pass = failClosed.htmlCountMatches
    && failClosed.allTextualFilesRead
    && failClosed.allTextualDocumentsParsed
    && failClosed.everyExtractedLocalReferenceExists;

  const beforeBytes = inventory.files.reduce((sum, file) => sum + file.bytes, 0);
  const removableBytes = unreferencedCandidates.reduce((sum, file) => sum + file.bytes, 0);
  const referencedLocalFiles = [...referencedPaths].sort((left, right) => left.localeCompare(right, 'en')).map((filePath) => ({
    path: filePath,
    bytes: filesByPath.get(filePath)?.bytes ?? null,
    media: isMediaPath(filePath),
    references: (provenanceByPath.get(filePath) || []).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'en')
      || left.kind.localeCompare(right.kind, 'en') || left.raw.localeCompare(right.raw, 'en'))
  }));
  const report = {
    schemaVersion: 1,
    kind: 'smu1-h5-deploy-media-reachability',
    mode: apply ? 'apply' : 'dry-run',
    distRoot: inventory.distRoot,
    basePath: effectiveBasePath,
    generatedAt: new Date().toISOString(),
    failClosed,
    errors: { read: readErrors, parse: parseErrors, missingReferences },
    artifact: {
      files: inventory.files.length,
      bytesBefore: beforeBytes,
      bytesAfter: beforeBytes,
      nonMediaFiles: inventory.files.length - hashedMedia.length,
      nonMediaBytes: inventory.files.filter((file) => !isMediaPath(file.path)).reduce((sum, file) => sum + file.bytes, 0),
      mediaFiles: hashedMedia.length,
      mediaBytes: hashedMedia.reduce((sum, file) => sum + file.bytes, 0),
      referencedMediaFiles: hashedMedia.length - unreferencedCandidates.length,
      referencedMediaBytes: hashedMedia.filter((file) => file.referenced).reduce((sum, file) => sum + file.bytes, 0),
      removableMediaFiles: unreferencedCandidates.length,
      removableMediaBytes: removableBytes,
      duplicateGroups: duplicateGroups.length,
      duplicateWastedBytes: duplicateGroups.reduce((sum, group) => sum + group.wastedBytes, 0)
    },
    media: hashedMedia,
    referencedLocalFiles,
    duplicateGroups,
    projectedAfterPruning: {
      files: inventory.files.length - unreferencedCandidates.length,
      bytes: beforeBytes - removableBytes,
      mediaFiles: projectedMedia.length,
      mediaBytes: projectedMedia.reduce((sum, file) => sum + file.bytes, 0),
      duplicateGroups: projectedDuplicateGroups.length,
      duplicateWastedBytes: projectedDuplicateGroups.reduce((sum, group) => sum + group.wastedBytes, 0),
      duplicateGroupDetails: projectedDuplicateGroups,
      mp4: projectedMedia.filter((file) => file.extension === '.mp4')
        .map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }))
    },
    unreferencedCandidates,
    mp4: hashedMedia.filter((file) => file.extension === '.mp4'),
    references: {
      extracted: references.length,
      resolved: resolvedReferences.filter((reference) => reference.resolvedPath).length,
      externalOrIgnored: resolvedReferences.filter((reference) => reference.external && !reference.resolvedPath).length
    },
    applied: { files: [], bytes: 0, verified: false, remainingBytes: beforeBytes }
  };

  if (apply) {
    if (!failClosed.pass) {
      throw new Error(`Refusing --apply because fail-closed checks failed:\n${stableJson(failClosed)}`);
    }
    const deletionPlan = [];
    for (const candidate of unreferencedCandidates) {
      const absolute = resolve(inventory.distRoot, ...candidate.path.split('/'));
      assertInside(inventory.distRoot, absolute, 'Deletion candidate');
      const details = await lstat(absolute);
      if (!details.isFile() || details.isSymbolicLink() || details.size !== candidate.bytes) {
        throw new Error(`Deletion candidate changed after audit: ${candidate.path}`);
      }
      if (await sha256File(absolute) !== candidate.sha256) {
        throw new Error(`Deletion candidate hash changed after audit: ${candidate.path}`);
      }
      deletionPlan.push({ candidate, absolute });
    }
    // Nothing is removed until every candidate has passed the second
    // path/type/size/hash preflight, avoiding partial pruning on a stale plan.
    for (const { candidate, absolute } of deletionPlan) {
      await unlink(absolute);
      report.applied.files.push(candidate.path);
      report.applied.bytes += candidate.bytes;
    }
    report.artifact.bytesAfter = beforeBytes - report.applied.bytes;
    const remainingInventory = await inventoryArtifact(inventory.distRoot);
    const removedStillPresent = report.applied.files.filter((filePath) => (
      remainingInventory.files.some((file) => file.path === filePath)
    ));
    const missingReferencedAfterApply = referencedLocalFiles.filter((file) => (
      !remainingInventory.files.some((candidate) => candidate.path === file.path)
    ));
    report.applied.remainingBytes = remainingInventory.files.reduce((sum, file) => sum + file.bytes, 0);
    report.applied.verified = removedStillPresent.length === 0
      && missingReferencedAfterApply.length === 0
      && report.applied.remainingBytes === report.projectedAfterPruning.bytes;
    report.applied.verification = { removedStillPresent, missingReferencedAfterApply };
    if (!report.applied.verified) {
      throw new Error(`Post-apply artifact verification failed:\n${stableJson(report.applied)}`);
    }
  }

  if (reportPath) {
    const filename = resolve(reportPath);
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, stableJson(report), 'utf8');
  }
  return report;
};

const argumentValue = (argv, name) => {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '') : '';
};

const runCli = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`SMU-1 H5 deploy media reachability and safe generated-artifact pruning\n\n`);
    process.stdout.write(`  node tools/performance/deploy-media-reachability.mjs [options]\n\n`);
    process.stdout.write(`Options:\n`);
    process.stdout.write(`  --dist=<path>            Built artifact (default: ./dist)\n`);
    process.stdout.write(`  --base=/SMU1/            Optional explicit GitHub Pages base path\n`);
    process.stdout.write(`  --expected-html=229      Fail-closed emitted HTML count\n`);
    process.stdout.write(`  --report=<path>          Optional deterministic JSON report\n`);
    process.stdout.write(`  --apply                  Delete only proven-unreferenced media from dist\n\n`);
    process.stdout.write(`Without --apply this command is read-only. It never changes public/ or source files.\n`);
    return;
  }
  const expectedHtmlCount = Number.parseInt(argumentValue(argv, '--expected-html') || '229', 10);
  if (!Number.isInteger(expectedHtmlCount) || expectedHtmlCount <= 0) throw new Error('--expected-html must be a positive integer.');
  const report = await auditDeployMediaReachability({
    distRoot: argumentValue(argv, '--dist') || DEFAULT_DIST_ROOT,
    basePath: argumentValue(argv, '--base'),
    expectedHtmlCount,
    apply: argv.includes('--apply'),
    reportPath: argumentValue(argv, '--report')
  });
  process.stdout.write(stableJson({
    mode: report.mode,
    failClosed: report.failClosed,
    artifact: report.artifact,
    projectedAfterPruning: {
      files: report.projectedAfterPruning.files,
      bytes: report.projectedAfterPruning.bytes,
      mediaFiles: report.projectedAfterPruning.mediaFiles,
      mediaBytes: report.projectedAfterPruning.mediaBytes,
      duplicateGroups: report.projectedAfterPruning.duplicateGroups,
      duplicateWastedBytes: report.projectedAfterPruning.duplicateWastedBytes,
      mp4: report.projectedAfterPruning.mp4
    },
    unreferencedMp4: report.mp4.filter((file) => !file.referenced).map((file) => ({ path: file.path, bytes: file.bytes })),
    applied: {
      files: report.applied.files.length,
      bytes: report.applied.bytes,
      remainingBytes: report.applied.remainingBytes,
      verified: report.applied.verified,
      verification: report.applied.verification || null
    }
  }));
  if (!report.failClosed.pass) process.exitCode = 1;
};

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}

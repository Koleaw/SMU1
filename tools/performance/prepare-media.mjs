import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTENT_ROOT = resolve(ROOT, 'src/content');
const SOURCE_ROOT = resolve(ROOT, 'src');
const PUBLIC_ROOT = resolve(ROOT, 'public');
const OUTPUT_ROOT = resolve(PUBLIC_ROOT, '_media/h5');
const MANIFEST_PATH = resolve(OUTPUT_ROOT, 'manifest.json');
const MANIFEST_PUBLIC_PATH = '/_media/h5/manifest.json';

const SCHEMA_VERSION = 1;
const ALLOWED_WIDTHS = [160, 240, 320, 480, 768, 1024, 1440, 1920];
const ROLE_WIDTHS = Object.freeze({
  hero: ALLOWED_WIDTHS,
  card: [320, 480, 768, 1024],
  gallery: ALLOWED_WIDTHS,
  thumbnail: [160, 240, 320],
  lightbox: [768, 1024, 1440, 1920],
  archive: [320, 480, 768, 1024, 1440],
  gateway: [480, 768, 1024, 1440, 1920],
  poster: [480, 768, 1024, 1440, 1920],
  'home-card': [320, 480, 768, 1024],
  proof: [320, 480, 768, 1024, 1440],
  project: [320, 480, 768, 1024, 1440],
  approved: ALLOWED_WIDTHS,
  content: ALLOWED_WIDTHS
});
const ENCODERS = Object.freeze({
  avif: { quality: 58, effort: 5, chromaSubsampling: '4:2:0' },
  webp: { quality: 78, effort: 5, smartSubsample: true },
  jpeg: { quality: 82, chromaSubsampling: '4:2:0', mozjpeg: true, progressive: true },
  png: { compressionLevel: 9, adaptiveFiltering: true, effort: 10, palette: false }
});
const PIPELINE_CONFIG = {
  implementationVersion: 2,
  schemaVersion: SCHEMA_VERSION,
  allowedWidths: ALLOWED_WIDTHS,
  roleWidths: ROLE_WIDTHS,
  encoders: ENCODERS,
  autoOrient: true,
  outputColourspace: 'srgb',
  sharpVersion: sharp.versions.sharp,
  vipsVersion: sharp.versions.vips
};
const PIPELINE_HASH = createHash('sha256')
  .update(JSON.stringify(PIPELINE_CONFIG))
  .digest('hex')
  .slice(0, 12);

const RASTER_EXTENSION = /\.(?:avif|jpe?g|png|webp)$/iu;
const SOURCE_MEDIA_REFERENCE = /\/(?:uploads|assets\/images)\/[^"'`\s?#<>{}|\\]+?\.(?:avif|jpe?g|png|webp)\b/giu;
const SOURCE_EXTENSIONS = new Set(['.astro', '.mjs', '.ts']);
const ALLOWED_MISSING_SOURCE_REFERENCES = new Set(['/uploads/photo.jpg']);

const posixPath = (value) => value.split(sep).join('/');
const sortStrings = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const walkFiles = async (root, predicate = () => true) => {
  if (!existsSync(root)) return [];
  const output = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && predicate(absolute)) {
        output.push(absolute);
      }
    }
  };
  await visit(root);
  return output;
};

const normalizeCanonicalPath = (value) => {
  if (typeof value !== 'string') return undefined;
  let candidate = value.trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return undefined;
  candidate = candidate.split(/[?#]/u, 1)[0].replaceAll('\\', '/');
  try {
    candidate = decodeURI(candidate);
  } catch {
    return undefined;
  }
  if (!RASTER_EXTENSION.test(candidate) || candidate.startsWith('/_media/h5/')) return undefined;
  const segments = candidate.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) return undefined;
  return candidate;
};

const ensureSafeFile = async (root, file, label) => {
  const details = await lstat(file);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`${label} is not a regular file: ${file}`);
  const [rootReal, fileReal] = await Promise.all([realpath(root), realpath(file)]);
  if (!fileReal.startsWith(`${rootReal}${sep}`)) throw new Error(`${label} escapes ${root}: ${file}`);
};

const ensureSafeDirectory = async (root, directory, label) => {
  await mkdir(directory, { recursive: true });
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`${label} is not a regular directory: ${directory}`);
  const [rootReal, directoryReal] = await Promise.all([realpath(root), realpath(directory)]);
  if (directoryReal !== rootReal && !directoryReal.startsWith(`${rootReal}${sep}`)) {
    throw new Error(`${label} escapes ${root}: ${directory}`);
  }
};

const publicFileFor = (canonicalPath) => {
  const absolute = resolve(PUBLIC_ROOT, `.${canonicalPath}`);
  const rootPrefix = `${PUBLIC_ROOT}${sep}`;
  if (absolute !== PUBLIC_ROOT && !absolute.startsWith(rootPrefix)) {
    throw new Error(`Media reference escapes public/: ${canonicalPath}`);
  }
  return absolute;
};

const references = new Map();
const addReference = (canonicalPath, roles, consumers, origin) => {
  const normalized = normalizeCanonicalPath(canonicalPath);
  if (!normalized) return;
  const current = references.get(normalized) ?? {
    path: normalized,
    roles: new Set(),
    consumers: new Set(),
    origins: new Set()
  };
  for (const role of roles) current.roles.add(role);
  for (const consumer of consumers) current.consumers.add(consumer);
  current.origins.add(origin);
  references.set(normalized, current);
};

const contentRoles = (collection, keyPath) => {
  const normalizedKeys = keyPath.map((key) => String(key).toLocaleLowerCase('en'));
  const pathText = normalizedKeys.join('.');
  const isGallery = normalizedKeys.some((key) => key === 'gallery' || key === 'images');
  const isPoster = pathText.includes('poster');
  const isCover = normalizedKeys.some((key) => key === 'coverimage' || key === 'image');

  if (isPoster) return ['poster', 'hero'];
  if (collection === 'products') {
    return isGallery
      ? ['gallery', 'thumbnail', 'lightbox']
      : ['card', 'gallery', 'thumbnail', 'lightbox'];
  }
  if (collection === 'product-categories') {
    return isGallery
      ? ['gallery', 'thumbnail', 'lightbox']
      : ['hero', 'card'];
  }
  if (collection === 'product-sections' || collection === 'services') {
    return isGallery
      ? ['gallery', 'thumbnail', 'lightbox']
      : ['hero', 'home-card'];
  }
  if (collection === 'projects') {
    return isGallery && !isCover
      ? ['gallery', 'thumbnail', 'lightbox', 'gateway', 'proof', 'project']
      : ['hero', 'archive', 'card', 'gateway', 'proof', 'project'];
  }
  if (collection === 'static-pages') return ['hero'];
  return ['content'];
};

const routeConsumers = (record, categoryParents) => {
  const data = record.data;
  const slug = typeof data?.slug === 'string' ? data.slug.trim() : '';
  const consumers = [`content:${record.relativePath}`];
  if (!slug) return consumers;

  if (record.collection === 'product-categories') {
    const section = typeof data.parentSectionSlug === 'string' ? data.parentSectionSlug.trim() : '';
    if (section) consumers.push(`/${section}/${slug}/`);
  } else if (record.collection === 'products') {
    const category = typeof data.productCategorySlug === 'string' ? data.productCategorySlug.trim() : '';
    const section = categoryParents.get(category);
    if (section && category) consumers.push(`/${section}/${category}/${slug}/`);
  } else if (record.collection === 'projects') {
    consumers.push('/vypolnennye-obekty/', `/vypolnennye-obekty/${slug}/`);
  } else if (record.collection === 'static-pages' && slug === 'home') {
    consumers.push('/');
  } else if (['product-sections', 'services', 'static-pages'].includes(record.collection)) {
    consumers.push(`/${slug}/`);
  }
  return consumers;
};

const visitContentValue = (value, keyPath, callback) => {
  if (typeof value === 'string') {
    callback(value, keyPath);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitContentValue(item, [...keyPath, index], callback));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visitContentValue(child, [...keyPath, key], callback);
    }
  }
};

const discoverContentReferences = async () => {
  const files = await walkFiles(CONTENT_ROOT, (file) => extname(file).toLocaleLowerCase('en') === '.json');
  const records = [];
  for (const file of files) {
    const relativePath = posixPath(relative(CONTENT_ROOT, file));
    const collection = relativePath.split('/')[0] ?? '';
    let data;
    try {
      data = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot parse ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    records.push({ file, relativePath, collection, data });
  }

  const categoryParents = new Map(
    records
      .filter(({ collection, data }) => collection === 'product-categories' && typeof data?.slug === 'string')
      .map(({ data }) => [data.slug.trim(), typeof data.parentSectionSlug === 'string' ? data.parentSectionSlug.trim() : ''])
  );

  for (const record of records) {
    const consumers = routeConsumers(record, categoryParents);
    visitContentValue(record.data, [], (value, keyPath) => {
      addReference(value, contentRoles(record.collection, keyPath), consumers, `content:${record.relativePath}`);
    });
  }
};

const sourceRoles = (relativePath) => {
  const value = relativePath.toLocaleLowerCase('en');
  if (value.includes('projectarchivegateway')) return ['gateway'];
  if (value.includes('mediaroleadapter')) return ['hero', 'archive', 'gallery', 'thumbnail', 'lightbox', 'gateway', 'proof', 'project'];
  if (value.includes('v2directions')) return ['hero', 'home-card'];
  if (value.includes('customorder')) return ['hero'];
  if (value.includes('hero')) return ['hero'];
  return ['approved'];
};

const discoverSourceReferences = async () => {
  const files = await walkFiles(SOURCE_ROOT, (file) => SOURCE_EXTENSIONS.has(extname(file).toLocaleLowerCase('en')));
  for (const file of files) {
    const relativePath = posixPath(relative(ROOT, file));
    const source = await readFile(file, 'utf8');
    const matches = source.matchAll(SOURCE_MEDIA_REFERENCE);
    for (const match of matches) {
      addReference(match[0], sourceRoles(relativePath), [`source:${relativePath}`], `source:${relativePath}`);
    }
  }
};

const mapLimit = async (items, limit, callback) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, worker));
  return results;
};

const inspectReference = async (reference) => {
  const file = publicFileFor(reference.path);
  let sourceBuffer;
  try {
    sourceBuffer = await readFile(file);
  } catch (error) {
    return { reference, missing: true, error };
  }
  await ensureSafeFile(PUBLIC_ROOT, file, 'Canonical media source');
  const sourceHash = sha256(sourceBuffer);
  const metadata = await sharp(sourceBuffer, { failOn: 'warning' }).metadata();
  const oriented = metadata.autoOrient ?? { width: metadata.width, height: metadata.height };
  if (!Number.isInteger(oriented.width) || !Number.isInteger(oriented.height)) {
    throw new Error(`Cannot determine dimensions for ${reference.path}`);
  }
  return {
    reference,
    missing: false,
    file,
    sourceBuffer,
    source: {
      path: reference.path,
      sha256: sourceHash,
      bytes: sourceBuffer.byteLength,
      width: oriented.width,
      height: oriented.height,
      format: metadata.format === 'heif'
        ? 'avif'
        : metadata.format ?? extname(file).slice(1).toLocaleLowerCase('en'),
      orientation: metadata.orientation ?? 1,
      alpha: metadata.hasAlpha === true
    }
  };
};

const widthsForRoles = (roles, sourceWidth) => {
  const widths = new Set();
  for (const role of roles) {
    for (const width of ROLE_WIDTHS[role] ?? ALLOWED_WIDTHS) widths.add(width);
  }
  if (widths.size === 0) ALLOWED_WIDTHS.forEach((width) => widths.add(width));
  return [...widths].filter((width) => width <= sourceWidth).sort((left, right) => left - right);
};

const readPreviousManifest = async () => {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    return manifest?.schemaVersion === SCHEMA_VERSION ? manifest : undefined;
  } catch {
    return undefined;
  }
};

const previousVariantsByPath = (manifest) => {
  const variants = new Map();
  if (!manifest?.entries || typeof manifest.entries !== 'object') return variants;
  for (const entry of Object.values(manifest.entries)) {
    if (!Array.isArray(entry?.variants)) continue;
    for (const variant of entry.variants) {
      if (typeof variant?.path === 'string' && !variants.has(variant.path)) variants.set(variant.path, variant);
    }
  }
  return variants;
};

const outputPathFor = (sourceHash, width, format) => {
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `/_media/h5/${sourceHash.slice(0, 2)}/${sourceHash}-${PIPELINE_HASH}-w${width}.${extension}`;
};

const cachedVariant = async (publicPath, previous, expected) => {
  if (!previous || previous.path !== publicPath) return undefined;
  if (previous.format !== expected.format || previous.width !== expected.width) return undefined;
  if (!Number.isInteger(previous.bytes) || previous.bytes <= 0 || typeof previous.sha256 !== 'string') return undefined;
  const file = publicFileFor(publicPath);
  try {
    const fileStat = await stat(file);
    if (!fileStat.isFile() || fileStat.size !== previous.bytes) return undefined;
    const buffer = await readFile(file);
    if (sha256(buffer) !== previous.sha256) return undefined;
    const metadata = await sharp(buffer, { failOn: 'warning' }).metadata();
    const actualFormat = metadata.format === 'heif' ? 'avif' : metadata.format;
    if (actualFormat !== expected.format || metadata.width !== previous.width || metadata.height !== previous.height) return undefined;
    return previous;
  } catch {
    return undefined;
  }
};

const encodeVariant = async (sourceBuffer, source, width, format) => {
  let pipeline = sharp(sourceBuffer, { failOn: 'warning' })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .toColourspace('srgb');
  if (format === 'avif') pipeline = pipeline.avif(ENCODERS.avif);
  else if (format === 'webp') pipeline = pipeline.webp(ENCODERS.webp);
  else if (format === 'jpeg') pipeline = pipeline.jpeg(ENCODERS.jpeg);
  else pipeline = pipeline.png(ENCODERS.png);

  const output = await pipeline.toBuffer({ resolveWithObject: true });
  if (output.info.width !== width || output.info.width > source.width) {
    throw new Error(`Unexpected ${format} width ${output.info.width} for ${source.path} at ${width}`);
  }
  if (source.alpha && format === 'png' && output.info.channels < 4) {
    throw new Error(`PNG fallback lost alpha for ${source.path}`);
  }
  return {
    buffer: output.data,
    width: output.info.width,
    height: output.info.height
  };
};

const prepareGroup = async (group, previousByPath, counters) => {
  const representative = group.items[0];
  const fallbackFormat = representative.source.alpha ? 'png' : 'jpeg';
  const formats = ['avif', 'webp', fallbackFormat];
  const widths = widthsForRoles(group.roles, representative.source.width);
  const variants = [];

  for (const width of widths) {
    for (const format of formats) {
      const publicPath = outputPathFor(group.sha256, width, format);
      const previous = previousByPath.get(publicPath);
      const cached = await cachedVariant(publicPath, previous, { format, width });
      if (cached) {
        counters.cached += 1;
        variants.push(cached);
        continue;
      }

      const encoded = await encodeVariant(representative.sourceBuffer, representative.source, width, format);
      const file = publicFileFor(publicPath);
      await ensureSafeDirectory(OUTPUT_ROOT, dirname(file), 'Derivative output directory');
      await writeFile(file, encoded.buffer);
      const variant = {
        path: publicPath,
        format,
        width: encoded.width,
        height: encoded.height,
        bytes: encoded.buffer.byteLength,
        sha256: sha256(encoded.buffer)
      };
      counters.generated += 1;
      variants.push(variant);
    }
  }

  variants.sort((left, right) => left.width - right.width || left.format.localeCompare(right.format, 'en'));
  return variants;
};

const removeStaleOutputs = async (expectedPublicPaths) => {
  const files = await walkFiles(OUTPUT_ROOT);
  let removed = 0;
  for (const file of files) {
    const publicPath = `/${posixPath(relative(PUBLIC_ROOT, file))}`;
    if (expectedPublicPaths.has(publicPath)) continue;
    await unlink(file);
    removed += 1;
  }
  return removed;
};

const main = async () => {
  await ensureSafeDirectory(PUBLIC_ROOT, OUTPUT_ROOT, 'Media output root');
  await Promise.all([discoverContentReferences(), discoverSourceReferences()]);
  const orderedReferences = [...references.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const inspected = await mapLimit(orderedReferences, 4, inspectReference);
  const missingContent = inspected.filter((item) => item.missing && [...item.reference.origins].some((origin) => origin.startsWith('content:')));
  if (missingContent.length > 0) {
    throw new Error(`Missing content raster media:\n${missingContent.map((item) => `- ${item.reference.path}`).join('\n')}`);
  }
  const missingSourceOnly = inspected.filter((item) => item.missing && !missingContent.includes(item));
  const unexpectedMissingSource = missingSourceOnly.filter((item) => !ALLOWED_MISSING_SOURCE_REFERENCES.has(item.reference.path));
  if (unexpectedMissingSource.length > 0) {
    throw new Error(`Missing source raster media:\n${unexpectedMissingSource.map((item) => `- ${item.reference.path}`).join('\n')}`);
  }

  const valid = inspected.filter((item) => !item.missing);
  const groups = new Map();
  for (const item of valid) {
    const group = groups.get(item.source.sha256) ?? {
      sha256: item.source.sha256,
      items: [],
      roles: new Set()
    };
    group.items.push(item);
    item.reference.roles.forEach((role) => group.roles.add(role));
    groups.set(item.source.sha256, group);
  }

  const orderedGroups = [...groups.values()].sort((left, right) => left.sha256.localeCompare(right.sha256, 'en'));
  const previous = await readPreviousManifest();
  const previousByPath = previousVariantsByPath(previous);
  const counters = { cached: 0, generated: 0 };
  const concurrency = Math.max(1, Math.min(4, Number.parseInt(process.env.SMU1_MEDIA_CONCURRENCY ?? '2', 10) || 2));
  const groupVariants = await mapLimit(
    orderedGroups,
    concurrency,
    async (group) => [group.sha256, await prepareGroup(group, previousByPath, counters)]
  );
  const variantsBySourceHash = new Map(groupVariants);

  const entries = {};
  const expectedPublicPaths = new Set([MANIFEST_PUBLIC_PATH]);
  for (const item of valid.sort((left, right) => left.reference.path.localeCompare(right.reference.path, 'en'))) {
    const roles = sortStrings(item.reference.roles);
    const allowed = new Set(widthsForRoles(roles, item.source.width));
    const variants = (variantsBySourceHash.get(item.source.sha256) ?? []).filter((variant) => allowed.has(variant.width));
    variants.forEach((variant) => expectedPublicPaths.add(variant.path));
    entries[item.reference.path] = {
      source: item.source,
      roles,
      consumers: sortStrings(item.reference.consumers),
      variants
    };
  }

  const uniqueVariants = new Map();
  for (const entry of Object.values(entries)) {
    for (const variant of entry.variants) uniqueVariants.set(variant.path, variant);
  }
  const derivativeBytes = [...uniqueVariants.values()].reduce((total, variant) => total + variant.bytes, 0);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generator: {
      name: 'smu1-h5-responsive-media',
      pipelineHash: PIPELINE_HASH,
      sharpVersion: sharp.versions.sharp,
      allowedWidths: ALLOWED_WIDTHS,
      roleWidths: ROLE_WIDTHS,
      formats: ['avif', 'webp', 'jpeg-or-png-fallback']
    },
    stats: {
      canonicalSources: Object.keys(entries).length,
      uniqueSources: orderedGroups.length,
      derivatives: uniqueVariants.size,
      derivativeBytes
    },
    entries
  };

  await ensureSafeDirectory(PUBLIC_ROOT, OUTPUT_ROOT, 'Media output root');
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const removed = await removeStaleOutputs(expectedPublicPaths);

  console.log(JSON.stringify({
    manifest: MANIFEST_PUBLIC_PATH,
    canonicalSources: manifest.stats.canonicalSources,
    uniqueSources: manifest.stats.uniqueSources,
    derivatives: manifest.stats.derivatives,
    derivativeBytes: manifest.stats.derivativeBytes,
    generated: counters.generated,
    cached: counters.cached,
    staleRemoved: removed,
    ignoredMissingSourceReferences: missingSourceOnly.map((item) => item.reference.path).sort()
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

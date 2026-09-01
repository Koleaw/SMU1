import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile
} from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  auditDeployMediaReachability,
  inventoryArtifact,
  isMediaPath,
  parseHtmlElements,
  resolveArtifactReference,
  sha256File,
  walkHtmlElements
} from './deploy-media-reachability.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_DIST_ROOT = resolve(ROOT, 'dist');
const DEFAULT_PUBLIC_ROOT = resolve(ROOT, 'public');
const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_PUBLIC_ROOT, '_media/h5/manifest.json');
const MIB = 1024 * 1024;
const KIB = 1024;
const RASTER_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);
const FONT_EXTENSIONS = new Set(['.eot', '.otf', '.ttf', '.woff', '.woff2']);

export const PERFORMANCE_BUDGETS = Object.freeze({
  artifactBytes: 700 * MIB,
  duplicateMediaBytes: 25 * MIB,
  htmlGzipBytes: 25 * KIB,
  cssGzipBytes: 75 * KIB,
  jsGzipBytes: 25 * KIB,
  fontBytes: 120 * KIB,
  lcpRaster: {
    mobile: { target: 180 * KIB, hard: 250 * KIB },
    desktop: { target: 300 * KIB, hard: 500 * KIB }
  },
  initialImages: {
    mobile: { ordinary: 800 * KIB, dense: 1.5 * MIB },
    desktop: { ordinary: 1.2 * MIB, dense: 2 * MIB }
  },
  initialTotal: {
    mobile: { ordinary: 1 * MIB, dense: 1.8 * MIB },
    desktop: { ordinary: 1.5 * MIB, dense: 2.5 * MIB }
  },
  oversizedRasterBytes: 1 * MIB,
  oversizedRasterSlotCssPx: 700,
  selectedWidthRatio: 1.55
});

const argv = process.argv.slice(2);
const argumentValue = (name) => {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '') : '';
};
const hasFlag = (name) => argv.includes(name);
const options = {
  help: hasFlag('--help') || hasFlag('-h'),
  distRoot: resolve(argumentValue('--dist') || DEFAULT_DIST_ROOT),
  publicRoot: resolve(argumentValue('--public') || DEFAULT_PUBLIC_ROOT),
  manifestPath: resolve(argumentValue('--manifest') || DEFAULT_MANIFEST_PATH),
  basePath: argumentValue('--base') || process.env.BASE_PATH || '',
  reportPath: argumentValue('--report') ? resolve(argumentValue('--report')) : '',
  expectedHtml: Number.parseInt(argumentValue('--expected-html') || '229', 10),
  expectedProduction: Number.parseInt(argumentValue('--expected-production') || '111', 10),
  expectedDesignLab: Number.parseInt(argumentValue('--expected-design-lab') || '112', 10),
  expectedAdmin: Number.parseInt(argumentValue('--expected-admin') || '6', 10),
  json: hasFlag('--json')
};

if (options.help) {
  process.stdout.write(`SMU-1 H5 deterministic post-build performance QA\n\n`);
  process.stdout.write(`  node tools/performance/qa-performance.mjs [options]\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --dist=<path>                 Built artifact (default: ./dist)\n`);
  process.stdout.write(`  --public=<path>               Canonical public tree (default: ./public)\n`);
  process.stdout.write(`  --manifest=<path>             Production media manifest\n`);
  process.stdout.write(`  --base=/SMU1/                 Optional explicit Pages BASE_PATH\n`);
  process.stdout.write(`  --expected-html=229           Total emitted HTML\n`);
  process.stdout.write(`  --expected-production=111     Public/production HTML\n`);
  process.stdout.write(`  --expected-design-lab=112     Design Lab HTML\n`);
  process.stdout.write(`  --expected-admin=6            Inert admin compatibility HTML\n`);
  process.stdout.write(`  --report=<path>               Optional full JSON report\n`);
  process.stdout.write(`  --json                        Print full JSON instead of the concise summary\n\n`);
  process.stdout.write(`This command is read-only. Artifact pruning is a separate, explicitly applied step.\n`);
  process.exit(0);
}

for (const [name, value] of [
  ['--expected-html', options.expectedHtml],
  ['--expected-production', options.expectedProduction],
  ['--expected-design-lab', options.expectedDesignLab],
  ['--expected-admin', options.expectedAdmin]
]) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
}
if (options.expectedProduction + options.expectedDesignLab + options.expectedAdmin !== options.expectedHtml) {
  throw new Error('Expected production + design-lab + admin counts must equal --expected-html.');
}
const { default: sharp } = await import('sharp');

const normalizeBase = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/gu, '')}/`;
};
const stableSort = (value) => {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSort(value[key])]));
};
const stableJson = (value) => `${JSON.stringify(stableSort(value), null, 2)}\n`;
const sortedUnique = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isSha256 = (value) => typeof value === 'string' && /^[a-f\d]{64}$/u.test(value);
const fileInside = (root, publicPath) => {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/') || publicPath.startsWith('//')) return '';
  let decoded;
  try { decoded = decodeURI(publicPath.split(/[?#]/u, 1)[0]); } catch { return ''; }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) return '';
  const filename = resolve(root, ...segments);
  return filename.startsWith(`${root}${sep}`) ? filename : '';
};
const sourceFormatMatches = (manifestFormat, actualFormat) => {
  const declared = String(manifestFormat).toLocaleLowerCase('en');
  const expected = declared === 'heif' ? 'avif' : declared;
  const reported = String(actualFormat).toLocaleLowerCase('en');
  // libvips/Sharp exposes AVIF through the HEIF container decoder.
  const actual = reported === 'heif' ? 'avif' : reported;
  return expected === actual
    || (['jpg', 'jpeg'].includes(expected) && actual === 'jpeg')
    || (expected === 'tif' && actual === 'tiff');
};
const variantFormatMatches = (manifestFormat, actualFormat) => {
  const actual = actualFormat === 'heif' ? 'avif' : actualFormat;
  return manifestFormat === actual;
};

const checks = [];
const failures = [];
const warnings = [];
const record = (id, pass, details = {}) => {
  const row = { id, status: pass ? 'pass' : 'fail', ...details };
  checks.push(row);
  if (!pass) failures.push(row);
  return pass;
};
const warn = (id, details = {}) => {
  const row = { id, status: 'warn', ...details };
  warnings.push(row);
  return row;
};

const validateRoot = async (directory, label) => {
  const details = await lstat(directory).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`${label} does not exist: ${directory}`);
  if (details.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${directory}`);
  if (await realpath(directory) !== directory) throw new Error(`${label} real path differs: ${directory}`);
};
await validateRoot(options.publicRoot, 'public root');

const manifestBuffer = await readFile(options.manifestPath);
let manifest;
try { manifest = JSON.parse(manifestBuffer.toString('utf8')); } catch (error) {
  throw new Error(`Cannot parse media manifest ${options.manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
}

record('manifest.schema-version', manifest?.schemaVersion === 1, { actual: manifest?.schemaVersion, expected: 1 });
record('manifest.generator', isRecord(manifest?.generator)
  && manifest.generator.name === 'smu1-h5-responsive-media'
  && typeof manifest.generator.pipelineHash === 'string'
  && manifest.generator.pipelineHash.length >= 8
  && typeof manifest.generator.sharpVersion === 'string'
  && Array.isArray(manifest.generator.allowedWidths)
  && isRecord(manifest.generator.roleWidths)
  && Array.isArray(manifest.generator.formats), {
  generator: manifest?.generator || null
});
record('manifest.stats-shape', isRecord(manifest?.stats)
  && isPositiveInteger(manifest.stats.canonicalSources)
  && isPositiveInteger(manifest.stats.uniqueSources)
  && Number.isInteger(manifest.stats.derivatives)
  && manifest.stats.derivatives >= 0
  && Number.isInteger(manifest.stats.derivativeBytes)
  && manifest.stats.derivativeBytes >= 0, { stats: manifest?.stats || null });
record('manifest.entries-shape', isRecord(manifest?.entries) && Object.keys(manifest.entries).length > 0, {
  entries: isRecord(manifest?.entries) ? Object.keys(manifest.entries).length : null
});
if (failures.length) {
  const summary = { status: 'fail', checks, failures, warnings };
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, stableJson(summary), 'utf8');
  }
  process.stdout.write(stableJson(summary));
  process.exit(1);
}

const allowedWidths = new Set(manifest.generator.allowedWidths);
record('manifest.allowed-widths', manifest.generator.allowedWidths.every(isPositiveInteger)
  && allowedWidths.size === manifest.generator.allowedWidths.length, { widths: manifest.generator.allowedWidths });
const roleWidthsValid = Object.entries(manifest.generator.roleWidths).every(([role, widths]) => (
  typeof role === 'string' && role.length > 0 && Array.isArray(widths) && widths.length > 0
  && widths.every((width) => isPositiveInteger(width) && allowedWidths.has(width))
));
record('manifest.role-widths', roleWidthsValid, { roleWidths: manifest.generator.roleWidths });

const manifestEntries = Object.entries(manifest.entries).sort(([left], [right]) => left.localeCompare(right, 'en'));
const uniqueVariants = new Map();
const uniqueSourceHashes = new Set();
const manifestErrors = [];
const canonicalPaths = new Set();

for (const [canonicalPath, entry] of manifestEntries) {
  canonicalPaths.add(canonicalPath.replace(/^\//u, ''));
  if (!isRecord(entry) || !isRecord(entry.source) || !Array.isArray(entry.roles)
    || !Array.isArray(entry.consumers) || !Array.isArray(entry.variants)) {
    manifestErrors.push({ path: canonicalPath, error: 'Entry shape is invalid.' });
    continue;
  }
  const source = entry.source;
  if (canonicalPath !== source.path || !canonicalPath.startsWith('/') || canonicalPath.startsWith('/_media/h5/')
    || !isSha256(source.sha256) || !isPositiveInteger(source.bytes)
    || !isPositiveInteger(source.width) || !isPositiveInteger(source.height)
    || typeof source.format !== 'string' || !isPositiveInteger(source.orientation)
    || typeof source.alpha !== 'boolean') {
    manifestErrors.push({ path: canonicalPath, error: 'Source schema/key mismatch.', source });
    continue;
  }
  uniqueSourceHashes.add(source.sha256);
  const roleWidthUnion = new Set(entry.roles.flatMap((role) => manifest.generator.roleWidths[role] || []));
  const variantWidths = new Set();
  const variantsByWidth = new Map();
  for (const variant of entry.variants) {
    if (!isRecord(variant) || typeof variant.path !== 'string' || !variant.path.startsWith('/_media/h5/')
      || !['avif', 'webp', 'jpeg', 'png'].includes(variant.format)
      || !isPositiveInteger(variant.width) || !isPositiveInteger(variant.height)
      || !isPositiveInteger(variant.bytes) || !isSha256(variant.sha256)) {
      manifestErrors.push({ path: canonicalPath, error: 'Variant schema is invalid.', variant });
      continue;
    }
    if (variant.width > source.width || variant.height > source.height) {
      manifestErrors.push({ path: canonicalPath, error: 'Variant is upscaled.', variant, sourceDimensions: [source.width, source.height] });
    }
    if (!allowedWidths.has(variant.width) || (roleWidthUnion.size > 0 && !roleWidthUnion.has(variant.width))) {
      manifestErrors.push({ path: canonicalPath, error: 'Variant width is not allowed for its media roles.', variant, roles: entry.roles });
    }
    variantWidths.add(variant.width);
    const formats = variantsByWidth.get(variant.width) || new Set();
    formats.add(variant.format);
    variantsByWidth.set(variant.width, formats);
    const previous = uniqueVariants.get(variant.path);
    if (previous && stableJson(previous) !== stableJson(variant)) {
      manifestErrors.push({ path: canonicalPath, error: 'Shared derivative path has conflicting metadata.', variant, previous });
    }
    uniqueVariants.set(variant.path, variant);
  }
  const fallback = source.alpha ? 'png' : 'jpeg';
  const expectedWidths = [...roleWidthUnion].filter((width) => width <= source.width);
  for (const width of expectedWidths) {
    if (!variantWidths.has(width)) manifestErrors.push({ path: canonicalPath, error: `Missing derivative width ${width}.`, roles: entry.roles });
  }
  for (const width of variantWidths) {
    const formats = variantsByWidth.get(width) || new Set();
    for (const required of ['avif', 'webp', fallback]) {
      if (!formats.has(required)) manifestErrors.push({ path: canonicalPath, error: `Missing ${required} at width ${width}.` });
    }
  }
}
record('manifest.entry-schema-no-upscale-format-sets', manifestErrors.length === 0, {
  errors: manifestErrors.slice(0, 100), totalErrors: manifestErrors.length
});
record('manifest.stats-counts', manifest.stats.canonicalSources === manifestEntries.length
  && manifest.stats.uniqueSources === uniqueSourceHashes.size
  && manifest.stats.derivatives === uniqueVariants.size
  && manifest.stats.derivativeBytes === [...uniqueVariants.values()].reduce((sum, variant) => sum + variant.bytes, 0), {
  declared: manifest.stats,
  actual: {
    canonicalSources: manifestEntries.length,
    uniqueSources: uniqueSourceHashes.size,
    derivatives: uniqueVariants.size,
    derivativeBytes: [...uniqueVariants.values()].reduce((sum, variant) => sum + variant.bytes, 0)
  }
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

const sourceAudit = await mapLimit(manifestEntries, 4, async ([canonicalPath, entry]) => {
  if (!isRecord(entry) || !isRecord(entry.source)) {
    return { path: canonicalPath, errors: ['Cannot audit malformed source entry.'] };
  }
  const filename = fileInside(options.publicRoot, canonicalPath);
  if (!filename) return { path: canonicalPath, errors: ['Unsafe canonical source path.'] };
  const errors = [];
  try {
    const details = await stat(filename);
    if (!details.isFile() || details.size !== entry.source.bytes) errors.push(`bytes ${details.size} != ${entry.source.bytes}`);
    if (await sha256File(filename) !== entry.source.sha256) errors.push('SHA-256 mismatch.');
    const metadata = await sharp(filename, { failOn: 'warning' }).metadata();
    const oriented = metadata.autoOrient || { width: metadata.width, height: metadata.height };
    if (oriented.width !== entry.source.width || oriented.height !== entry.source.height) {
      errors.push(`oriented dimensions ${oriented.width}x${oriented.height} != ${entry.source.width}x${entry.source.height}`);
    }
    if (!sourceFormatMatches(entry.source.format, metadata.format)) errors.push(`format ${metadata.format} != ${entry.source.format}`);
    if (metadata.orientation && metadata.orientation !== entry.source.orientation) errors.push(`orientation ${metadata.orientation} != ${entry.source.orientation}`);
    if (Boolean(metadata.hasAlpha) !== entry.source.alpha) errors.push(`alpha ${Boolean(metadata.hasAlpha)} != ${entry.source.alpha}`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { path: canonicalPath, errors };
});
const sourceFailures = sourceAudit.filter((row) => row.errors.length > 0);
record('manifest.source-hash-bytes-dimensions-format-alpha', sourceFailures.length === 0, {
  audited: sourceAudit.length,
  failures: sourceFailures.slice(0, 50),
  totalFailures: sourceFailures.length
});

const variantAudit = await mapLimit([...uniqueVariants.entries()], 6, async ([publicPath, variant]) => {
  const filename = fileInside(options.publicRoot, publicPath);
  if (!filename) return { path: publicPath, errors: ['Unsafe derivative path.'] };
  const errors = [];
  try {
    const details = await stat(filename);
    if (!details.isFile() || details.size !== variant.bytes) errors.push(`bytes ${details.size} != ${variant.bytes}`);
    if (await sha256File(filename) !== variant.sha256) errors.push('SHA-256 mismatch.');
    const metadata = await sharp(filename, { failOn: 'warning' }).metadata();
    if (metadata.width !== variant.width || metadata.height !== variant.height) {
      errors.push(`dimensions ${metadata.width}x${metadata.height} != ${variant.width}x${variant.height}`);
    }
    if (!variantFormatMatches(variant.format, metadata.format)) errors.push(`format ${metadata.format} != ${variant.format}`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { path: publicPath, errors };
});
const variantFailures = variantAudit.filter((row) => row.errors.length > 0);
record('manifest.derivative-hash-bytes-dimensions-format', variantFailures.length === 0, {
  audited: variantAudit.length,
  failures: variantFailures.slice(0, 50),
  totalFailures: variantFailures.length
});

const alphaFallbackAudit = await mapLimit(
  manifestEntries.filter(([, entry]) => isRecord(entry) && isRecord(entry.source)
    && entry.source.alpha === true && Array.isArray(entry.variants)),
  4,
  async ([canonicalPath, entry]) => {
    const pngs = entry.variants.filter((variant) => variant.format === 'png');
    const failures = [];
    if (entry.variants.length > 0 && pngs.length === 0) failures.push('No PNG fallback variants.');
    for (const variant of pngs) {
      const filename = fileInside(options.publicRoot, variant.path);
      try {
        const metadata = await sharp(filename, { failOn: 'warning' }).metadata();
        if (!metadata.hasAlpha) failures.push(`${variant.path} has no alpha channel.`);
      } catch (error) {
        failures.push(`${variant.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { path: canonicalPath, failures };
  }
);
const alphaFailures = alphaFallbackAudit.filter((row) => row.failures.length > 0);
record('manifest.transparent-source-alpha-fallback', alphaFailures.length === 0, {
  transparentSources: alphaFallbackAudit.length,
  failures: alphaFailures.slice(0, 50),
  totalFailures: alphaFailures.length
});

const inventory = await inventoryArtifact(options.distRoot);
const filesByPath = new Map(inventory.files.map((file) => [file.path, file]));
const distManifest = filesByPath.get('_media/h5/manifest.json');
if (distManifest) {
  const emittedManifestBuffer = await readFile(distManifest.absolute);
  record('manifest.emitted-copy-matches-production-manifest',
    createHash('sha256').update(emittedManifestBuffer).digest('hex')
      === createHash('sha256').update(manifestBuffer).digest('hex'), {
      emittedPath: distManifest.path
    });
} else {
  warn('manifest.not-emitted-runtime', {
    message: 'Build-time manifest is not a runtime root; absence from dist is allowed when pipeline excludes it intentionally.'
  });
}

const reachability = await auditDeployMediaReachability({
  distRoot: options.distRoot,
  basePath: options.basePath,
  expectedHtmlCount: options.expectedHtml,
  apply: false
});
record('artifact.reachability-fail-closed', reachability.failClosed.pass, {
  failClosed: reachability.failClosed,
  errors: {
    read: reachability.errors.read.slice(0, 20),
    parse: reachability.errors.parse.slice(0, 20),
    missingReferences: reachability.errors.missingReferences.slice(0, 100)
  }
});

const htmlFiles = inventory.files.filter((file) => file.extension === '.html');
const htmlGroups = {
  admin: htmlFiles.filter((file) => file.path.startsWith('admin/')),
  designLab: htmlFiles.filter((file) => file.path.startsWith('design-lab/')),
  production: htmlFiles.filter((file) => !file.path.startsWith('admin/') && !file.path.startsWith('design-lab/'))
};
record('isolation.html-counts', htmlFiles.length === options.expectedHtml
  && htmlGroups.production.length === options.expectedProduction
  && htmlGroups.designLab.length === options.expectedDesignLab
  && htmlGroups.admin.length === options.expectedAdmin, {
  expected: {
    total: options.expectedHtml,
    production: options.expectedProduction,
    designLab: options.expectedDesignLab,
    admin: options.expectedAdmin
  },
  actual: {
    total: htmlFiles.length,
    production: htmlGroups.production.length,
    designLab: htmlGroups.designLab.length,
    admin: htmlGroups.admin.length
  }
});

const htmlPathToRoute = (filename) => {
  if (filename === 'index.html') return '/';
  if (filename.endsWith('/index.html')) return `/${filename.slice(0, -'index.html'.length)}`;
  return `/${filename}`;
};
const splitSrcset = (value) => String(value || '').split(',').map((part) => {
  const [url, descriptor = ''] = part.trim().split(/\s+/u);
  if (!url) return null;
  const width = descriptor.endsWith('w') ? Number.parseFloat(descriptor.slice(0, -1)) : null;
  const density = descriptor.endsWith('x') ? Number.parseFloat(descriptor.slice(0, -1)) : null;
  return { url, width: Number.isFinite(width) ? width : null, density: Number.isFinite(density) ? density : null };
}).filter(Boolean);
const topLevelSplit = (value) => {
  const output = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    else if (value[index] === ')') depth = Math.max(0, depth - 1);
    else if (value[index] === ',' && depth === 0) {
      output.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  output.push(value.slice(start).trim());
  return output.filter(Boolean);
};
const evaluateMediaCondition = (condition, viewportWidth) => {
  if (!condition) return true;
  const minimums = [...condition.matchAll(/min-width\s*:\s*([\d.]+)px/giu)].map((match) => Number(match[1]));
  const maximums = [...condition.matchAll(/max-width\s*:\s*([\d.]+)px/giu)].map((match) => Number(match[1]));
  return minimums.every((value) => viewportWidth >= value) && maximums.every((value) => viewportWidth <= value);
};
const evaluateLength = (input, viewportWidth) => {
  const value = String(input || '').trim().toLocaleLowerCase('en');
  if (!value) return null;
  const wrapper = value.match(/^(min|max)\((.*)\)$/u);
  if (wrapper) {
    const values = topLevelSplit(wrapper[2]).map((item) => evaluateLength(item, viewportWidth)).filter(Number.isFinite);
    return values.length ? Math[wrapper[1]](...values) : null;
  }
  if (/^calc\(.+\)$/u.test(value)) return evaluateLength(value.slice(5, -1), viewportWidth);
  if (/^[\d.]+px$/u.test(value)) return Number.parseFloat(value);
  if (/^[\d.]+vw$/u.test(value)) return viewportWidth * Number.parseFloat(value) / 100;
  const terms = value.match(/[+-]?\s*[\d.]+(?:px|vw)/gu);
  if (terms && terms.join('').replaceAll(/\s/gu, '') === value.replaceAll(/\s/gu, '')) {
    return terms.reduce((sum, term) => {
      const compact = term.replaceAll(/\s/gu, '');
      const sign = compact.startsWith('-') ? -1 : 1;
      const numeric = Number.parseFloat(compact.replace(/^[+-]/u, ''));
      return sum + sign * (compact.endsWith('vw') ? viewportWidth * numeric / 100 : numeric);
    }, 0);
  }
  return null;
};
const evaluateSizes = (sizes, viewportWidth) => {
  if (!sizes) return viewportWidth;
  for (const part of topLevelSplit(sizes)) {
    let condition = '';
    let length = part;
    if (part.startsWith('(')) {
      let depth = 0;
      let closeIndex = -1;
      for (let index = 0; index < part.length; index += 1) {
        if (part[index] === '(') depth += 1;
        else if (part[index] === ')') {
          depth -= 1;
          if (depth === 0) { closeIndex = index; break; }
        }
      }
      if (closeIndex >= 0) {
        condition = part.slice(0, closeIndex + 1);
        length = part.slice(closeIndex + 1).trim();
      }
    }
    if (evaluateMediaCondition(condition, viewportWidth)) {
      const pixels = evaluateLength(length, viewportWidth);
      if (Number.isFinite(pixels) && pixels > 0) return Math.min(viewportWidth, pixels);
    }
  }
  return viewportWidth;
};
const logicalPublicPath = (raw, basePath) => {
  let value = String(raw || '').trim();
  if (!value || /^(?:data|blob):/iu.test(value)) return '';
  try {
    const url = new URL(value, 'https://smu1.invalid/');
    value = url.pathname;
  } catch { return ''; }
  const normalizedBase = normalizeBase(basePath);
  if (normalizedBase !== '/' && value.startsWith(normalizedBase)) value = `/${value.slice(normalizedBase.length)}`;
  return value.replace(/^\//u, '');
};
const nodeHasThumbnailContext = (node) => {
  let current = node.parent;
  while (current && current.tag !== '#document') {
    if (String(current.attributes['data-v2-responsive-picture'] || '') === 'thumbnail') return true;
    if (/thumb/iu.test(String(current.attributes.class || ''))) return true;
    if (Object.keys(current.attributes).some((name) => /thumb/iu.test(name))) return true;
    current = current.parent;
  }
  return false;
};
const selectImageCandidate = (image, profile, basePath) => {
  const width = profile.viewportWidth;
  const dpr = profile.dpr;
  let srcset = image.attributes.srcset || '';
  let sizes = image.attributes.sizes || '';
  let sourceTag = 'img';
  if (image.parent?.tag === 'picture') {
    for (const child of image.parent.children) {
      if (child === image) break;
      if (child.tag !== 'source' || !child.attributes.srcset) continue;
      if (!evaluateMediaCondition(child.attributes.media || '', width)) continue;
      const type = String(child.attributes.type || '').toLocaleLowerCase('en');
      if (type && !['image/avif', 'image/webp', 'image/jpeg', 'image/png'].includes(type)) continue;
      srcset = child.attributes.srcset;
      sizes = child.attributes.sizes || sizes;
      sourceTag = `source:${type || 'untyped'}`;
      break;
    }
  }
  const candidates = splitSrcset(srcset);
  const slotCssPx = evaluateSizes(sizes, width);
  const physicalWidth = slotCssPx * dpr;
  let selected = null;
  if (candidates.some((candidate) => candidate.width)) {
    const ordered = candidates.filter((candidate) => candidate.width).sort((left, right) => left.width - right.width);
    selected = ordered.find((candidate) => candidate.width >= physicalWidth) || ordered.at(-1);
  } else if (candidates.some((candidate) => candidate.density)) {
    const ordered = candidates.filter((candidate) => candidate.density).sort((left, right) => left.density - right.density);
    selected = ordered.find((candidate) => candidate.density >= dpr) || ordered.at(-1);
  }
  const url = selected?.url || image.attributes.src || '';
  return {
    url,
    logicalPath: logicalPublicPath(url, basePath),
    sourceTag,
    slotCssPx,
    physicalWidth,
    candidateWidth: selected?.width || null,
    density: selected?.density || null,
    selectedWidthRatio: selected?.width ? selected.width / physicalWidth : null
  };
};

const extractCssUrls = (source) => {
  const output = [];
  for (const match of source.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)'";]+))\s*\)/giu)) {
    output.push(match[1] ?? match[2] ?? match[3]);
  }
  for (const match of source.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)')\s*\)?/giu)) {
    output.push(match[1] ?? match[2]);
  }
  return output;
};
const extractJsImports = (source) => {
  const output = [];
  const pattern = /(?:\bimport\s*(?:\(\s*|[^"']*?\bfrom\s*)|\bexport\s+[^"']*?\bfrom\s*)["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) output.push(match[1]);
  return output;
};
const resolveDistResource = (raw, sourcePath, basePath) => {
  const result = resolveArtifactReference({ raw, sourcePath, basePath, filesByPath });
  return result.resolvedPath || '';
};
const collectRecursiveAssets = async (seeds, type, basePath) => {
  const visited = new Set();
  const related = new Set();
  // Browser transfer accounting is URL-based: repeated link/modulepreload
  // declarations for the same resolved artifact still cause one fetch.
  const queue = sortedUnique(seeds);
  while (queue.length) {
    const filePath = queue.shift();
    if (!filePath || visited.has(filePath)) continue;
    visited.add(filePath);
    const file = filesByPath.get(filePath);
    if (!file) continue;
    const source = (await readFile(file.absolute)).toString('utf8');
    const refs = type === 'css' ? extractCssUrls(source) : extractJsImports(source);
    for (const raw of refs) {
      const resolvedPath = resolveDistResource(raw, filePath, basePath);
      if (!resolvedPath) continue;
      const extension = extname(resolvedPath).toLocaleLowerCase('en');
      if (extension === `.${type}` || (type === 'js' && ['.js', '.mjs'].includes(extension))) queue.push(resolvedPath);
      else related.add(resolvedPath);
    }
  }
  return {
    files: sortedUnique(visited),
    related: sortedUnique(related)
  };
};
const gzipCache = new Map();
const gzipBytesFor = async (filePath) => {
  if (gzipCache.has(filePath)) return gzipCache.get(filePath);
  const file = filesByPath.get(filePath);
  if (!file) return 0;
  const bytes = gzipSync(await readFile(file.absolute), { level: 9 }).byteLength;
  gzipCache.set(filePath, bytes);
  return bytes;
};

const resourceProfiles = [
  { key: 'mobile', viewportWidth: 390, dpr: 2 },
  { key: 'desktop', viewportWidth: 1440, dpr: 1 }
];
const routeReports = [];
const priorityFailures = [];
const thumbnailFailures = [];
const inlineBackgroundFailures = [];
const isolationFailures = [];
const routeBudgetFailures = [];
const lcpTargetExceptions = [];

for (const htmlFile of htmlGroups.production.sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
  const htmlBuffer = await readFile(htmlFile.absolute);
  const html = htmlBuffer.toString('utf8');
  const tree = parseHtmlElements(html);
  const nodes = [];
  walkHtmlElements(tree, (node) => nodes.push(node));
  const route = htmlPathToRoute(htmlFile.path);
  const dense = /\bv2-(?:catalog-index|product-list|project-archive)\b/u.test(html);
  const inlineStyleMediaPaths = sortedUnique(nodes.flatMap((node) => (
    node.attributes.style
      ? extractCssUrls(node.attributes.style).map((url) => logicalPublicPath(url, reachability.basePath))
      : []
  )).filter((filePath) => filePath && isMediaPath(filePath)));
  for (const filePath of inlineStyleMediaPaths) {
    if (canonicalPaths.has(filePath) && RASTER_EXTENSIONS.has(extname(filePath).toLocaleLowerCase('en'))) {
      inlineBackgroundFailures.push({ route, error: 'Inline background references a canonical raster original.', path: filePath });
    }
  }
  if (/(?:href|src)=["'][^"']*\/(?:design-lab|admin)\//iu.test(html)) {
    isolationFailures.push({ route, path: htmlFile.path, error: 'Production HTML links to Design Lab or admin scope.' });
  }

  const images = nodes.filter((node) => node.tag === 'img');
  const highImages = images.filter((image) => String(image.attributes.fetchpriority || '').toLocaleLowerCase('en') === 'high');
  const pageCriticalImages = images.filter((image) => 'data-v2-page-critical' in image.attributes);
  if (highImages.length > 1) priorityFailures.push({ route, error: 'More than one fetchpriority=high image.', count: highImages.length });
  if (pageCriticalImages.length > 1) priorityFailures.push({ route, error: 'More than one declared first-viewport/LCP image.', count: pageCriticalImages.length });
  for (const image of highImages) {
    if (String(image.attributes.loading || '').toLocaleLowerCase('en') === 'lazy') {
      priorityFailures.push({ route, error: 'High-priority image is lazy.', src: image.attributes.src || '' });
    }
    if (!('data-v2-page-critical' in image.attributes)) {
      priorityFailures.push({
        route,
        error: 'High-priority image lacks the deterministic first-viewport/LCP marker.',
        src: image.attributes.src || ''
      });
    }
    const logical = logicalPublicPath(image.attributes.src || '', reachability.basePath);
    if (logical && !canonicalPaths.has(logical) && !uniqueVariants.has(`/${logical}`)) {
      priorityFailures.push({ route, error: 'High-priority image is absent from media manifest.', src: image.attributes.src || '' });
    }
  }
  for (const image of pageCriticalImages) {
    if (String(image.attributes.loading || '').toLocaleLowerCase('en') === 'lazy') {
      priorityFailures.push({ route, error: 'Declared page-critical image is lazy.', src: image.attributes.src || '' });
    }
    if (String(image.attributes.fetchpriority || '').toLocaleLowerCase('en') !== 'high') {
      priorityFailures.push({ route, error: 'Declared page-critical image is not fetchpriority=high.', src: image.attributes.src || '' });
    }
  }
  const priorityUrls = [];
  highImages.forEach((image) => {
    if (image.attributes.src) priorityUrls.push({ kind: 'high', url: logicalPublicPath(image.attributes.src, reachability.basePath) });
  });
  nodes.filter((node) => node.tag === 'link'
    && String(node.attributes.rel || '').toLocaleLowerCase('en').split(/\s+/u).includes('preload')
    && String(node.attributes.as || '').toLocaleLowerCase('en') === 'image')
    .forEach((link) => {
      if (link.attributes.href) priorityUrls.push({ kind: 'preload', url: logicalPublicPath(link.attributes.href, reachability.basePath) });
      splitSrcset(link.attributes.imagesrcset || '').forEach((candidate) => {
        priorityUrls.push({ kind: 'preload-srcset', url: logicalPublicPath(candidate.url, reachability.basePath) });
      });
    });
  const priorityGroups = new Map();
  for (const declaration of priorityUrls.filter((item) => item.url)) {
    const declarations = priorityGroups.get(declaration.url) || [];
    declarations.push(declaration);
    priorityGroups.set(declaration.url, declarations);
  }
  for (const [url, declarations] of priorityGroups) {
    if (declarations.length > 1) priorityFailures.push({ route, error: 'Duplicate high/preload URL.', url, declarations });
  }

  for (const image of images.filter(nodeHasThumbnailContext)) {
    const urls = [image.attributes.src, ...splitSrcset(image.attributes.srcset || '').map((candidate) => candidate.url)].filter(Boolean);
    if (image.parent?.tag === 'picture') {
      image.parent.children.filter((node) => node.tag === 'source').forEach((source) => {
        urls.push(...splitSrcset(source.attributes.srcset || '').map((candidate) => candidate.url));
      });
    }
    const canonicalHits = sortedUnique(urls.map((url) => logicalPublicPath(url, reachability.basePath)).filter((url) => canonicalPaths.has(url)));
    if (canonicalHits.length) thumbnailFailures.push({ route, error: 'Thumbnail references canonical original.', paths: canonicalHits });
  }

  const cssSeeds = nodes.filter((node) => node.tag === 'link'
    && String(node.attributes.rel || '').toLocaleLowerCase('en').split(/\s+/u).includes('stylesheet'))
    .map((node) => resolveDistResource(node.attributes.href || '', htmlFile.path, reachability.basePath)).filter(Boolean);
  const jsSeeds = [
    ...nodes.filter((node) => node.tag === 'script' && node.attributes.src)
      .map((node) => resolveDistResource(node.attributes.src, htmlFile.path, reachability.basePath)),
    ...nodes.filter((node) => node.tag === 'link'
      && String(node.attributes.rel || '').toLocaleLowerCase('en').split(/\s+/u).includes('modulepreload'))
      .map((node) => resolveDistResource(node.attributes.href || '', htmlFile.path, reachability.basePath))
  ].filter(Boolean);
  const [cssGraph, jsGraph] = await Promise.all([
    collectRecursiveAssets(sortedUnique(cssSeeds), 'css', reachability.basePath),
    collectRecursiveAssets(sortedUnique(jsSeeds), 'js', reachability.basePath)
  ]);
  const fontPaths = sortedUnique(cssGraph.related.filter((filePath) => FONT_EXTENSIONS.has(extname(filePath).toLocaleLowerCase('en'))));
  const cssMediaPaths = sortedUnique(cssGraph.related.filter((filePath) => isMediaPath(filePath)));
  const cssGzipBytes = (await Promise.all(cssGraph.files.map(gzipBytesFor))).reduce((sum, bytes) => sum + bytes, 0);
  const jsGzipBytes = (await Promise.all(jsGraph.files.map(gzipBytesFor))).reduce((sum, bytes) => sum + bytes, 0);
  const htmlGzipBytes = gzipSync(htmlBuffer, { level: 9 }).byteLength;
  const fontBytes = fontPaths.reduce((sum, filePath) => sum + (filesByPath.get(filePath)?.bytes || 0), 0);

  const profileReports = [];
  for (const profile of resourceProfiles) {
    const selected = images.map((image) => ({
      image,
      selected: selectImageCandidate(image, profile, reachability.basePath)
    })).filter((row) => row.selected.url);
    const initial = selected.filter(({ image }) => String(image.attributes.loading || '').toLocaleLowerCase('en') !== 'lazy');
    const preloadPaths = priorityUrls.filter((row) => row.kind.startsWith('preload')).map((row) => row.url);
    const initialPaths = new Set(initial.map((row) => row.selected.logicalPath).filter(Boolean));
    preloadPaths.filter(Boolean).forEach((filePath) => initialPaths.add(filePath));
    inlineStyleMediaPaths.forEach((filePath) => initialPaths.add(filePath));
    cssMediaPaths.forEach((filePath) => initialPaths.add(filePath));
    const missingSelected = [];
    const selectedResources = [];
    for (const row of selected) {
      const pathInDist = row.selected.logicalPath;
      const file = filesByPath.get(pathInDist);
      if (!file && !/^https?:/iu.test(row.selected.url)) missingSelected.push({ src: row.selected.url, logicalPath: pathInDist });
      selectedResources.push({
        src: row.selected.url,
        logicalPath: pathInDist,
        bytes: file?.bytes ?? null,
        loading: row.image.attributes.loading || 'auto',
        fetchpriority: row.image.attributes.fetchpriority || 'auto',
        thumbnail: nodeHasThumbnailContext(row.image),
        ...row.selected
      });
    }
    if (missingSelected.length) routeBudgetFailures.push({ route, profile: profile.key, error: 'Selected image candidate is missing.', missing: missingSelected });
    const initialResources = [...initialPaths].map((filePath) => filesByPath.get(filePath)).filter(Boolean);
    const initialImageBytes = initialResources.filter((file) => isMediaPath(file.path)).reduce((sum, file) => sum + file.bytes, 0);
    const initialTotalBytes = htmlGzipBytes + cssGzipBytes + jsGzipBytes + fontBytes + initialImageBytes;
    const highResource = selectedResources.find((resource) => resource.fetchpriority === 'high') || null;
    const kind = dense ? 'dense' : 'ordinary';
    const budget = {
      initialImageBytes: PERFORMANCE_BUDGETS.initialImages[profile.key][kind],
      initialTotalBytes: PERFORMANCE_BUDGETS.initialTotal[profile.key][kind]
    };
    if (initialImageBytes > budget.initialImageBytes) {
      routeBudgetFailures.push({ route, profile: profile.key, error: 'Initial image budget exceeded.', actual: initialImageBytes, budget: budget.initialImageBytes, kind });
    }
    if (initialTotalBytes > budget.initialTotalBytes) {
      routeBudgetFailures.push({ route, profile: profile.key, error: 'Initial total budget exceeded.', actual: initialTotalBytes, budget: budget.initialTotalBytes, kind });
    }
    if (highResource && RASTER_EXTENSIONS.has(extname(highResource.logicalPath).toLocaleLowerCase('en'))
      && Number.isFinite(highResource.bytes)
      && highResource.bytes > PERFORMANCE_BUDGETS.lcpRaster[profile.key].hard) {
      routeBudgetFailures.push({ route, profile: profile.key, error: 'High/LCP raster hard budget exceeded.', resource: highResource, budget: PERFORMANCE_BUDGETS.lcpRaster[profile.key] });
    } else if (highResource && RASTER_EXTENSIONS.has(extname(highResource.logicalPath).toLocaleLowerCase('en'))
      && Number.isFinite(highResource.bytes)
      && highResource.bytes > PERFORMANCE_BUDGETS.lcpRaster[profile.key].target) {
      lcpTargetExceptions.push({
        route,
        profile: profile.key,
        resource: highResource,
        target: PERFORMANCE_BUDGETS.lcpRaster[profile.key].target,
        hardExceptionLimit: PERFORMANCE_BUDGETS.lcpRaster[profile.key].hard
      });
    }
    for (const resource of selectedResources) {
      if (!RASTER_EXTENSIONS.has(extname(resource.logicalPath).toLocaleLowerCase('en'))) continue;
      if (resource.slotCssPx < PERFORMANCE_BUDGETS.oversizedRasterSlotCssPx
        && resource.bytes > PERFORMANCE_BUDGETS.oversizedRasterBytes) {
        routeBudgetFailures.push({ route, profile: profile.key, error: 'Raster over 1 MiB selected for a sub-700 CSS px slot.', resource });
      }
      if (resource.candidateWidth && resource.physicalWidth >= 200
        && resource.selectedWidthRatio > PERFORMANCE_BUDGETS.selectedWidthRatio) {
        routeBudgetFailures.push({ route, profile: profile.key, error: 'Responsive candidate exceeds physical slot width ratio.', resource, budgetRatio: PERFORMANCE_BUDGETS.selectedWidthRatio });
      }
    }
    profileReports.push({
      profile: profile.key,
      viewportWidth: profile.viewportWidth,
      dpr: profile.dpr,
      budgetKind: kind,
      selectedImages: selectedResources,
      initialImageBytes,
      initialTotalBytes,
      initialResourcePaths: initialResources.map((file) => file.path).sort((left, right) => left.localeCompare(right, 'en')),
      highResource,
      budgets: budget
    });
  }

  if (htmlGzipBytes > PERFORMANCE_BUDGETS.htmlGzipBytes) routeBudgetFailures.push({ route, error: 'HTML gzip budget exceeded.', actual: htmlGzipBytes, budget: PERFORMANCE_BUDGETS.htmlGzipBytes });
  if (cssGzipBytes > PERFORMANCE_BUDGETS.cssGzipBytes) routeBudgetFailures.push({ route, error: 'CSS gzip budget exceeded.', actual: cssGzipBytes, budget: PERFORMANCE_BUDGETS.cssGzipBytes });
  if (jsGzipBytes > PERFORMANCE_BUDGETS.jsGzipBytes) routeBudgetFailures.push({ route, error: 'JS gzip budget exceeded.', actual: jsGzipBytes, budget: PERFORMANCE_BUDGETS.jsGzipBytes });
  if (fontBytes > PERFORMANCE_BUDGETS.fontBytes) routeBudgetFailures.push({ route, error: 'Initial local font budget exceeded.', actual: fontBytes, budget: PERFORMANCE_BUDGETS.fontBytes });
  routeReports.push({
    route,
    htmlPath: htmlFile.path,
    dense,
    assets: {
      htmlRawBytes: htmlFile.bytes,
      htmlGzipBytes,
      cssRawBytes: cssGraph.files.reduce((sum, filePath) => sum + (filesByPath.get(filePath)?.bytes || 0), 0),
      cssGzipBytes,
      cssFiles: cssGraph.files,
      cssMediaFiles: cssMediaPaths,
      inlineStyleMediaFiles: inlineStyleMediaPaths,
      jsRawBytes: jsGraph.files.reduce((sum, filePath) => sum + (filesByPath.get(filePath)?.bytes || 0), 0),
      jsGzipBytes,
      jsFiles: jsGraph.files,
      fontBytes,
      fontFiles: fontPaths
    },
    profiles: profileReports
  });
}

record('priority.single-first-viewport-high-not-lazy-no-duplicate', priorityFailures.length === 0, {
  failures: priorityFailures.slice(0, 100), totalFailures: priorityFailures.length
});
record('gallery.thumbnails-use-derivatives', thumbnailFailures.length === 0, {
  failures: thumbnailFailures.slice(0, 100), totalFailures: thumbnailFailures.length
});
record('media.inline-backgrounds-use-derivatives', inlineBackgroundFailures.length === 0, {
  failures: inlineBackgroundFailures.slice(0, 100), totalFailures: inlineBackgroundFailures.length
});
record('isolation.production-no-admin-design-links', isolationFailures.length === 0, {
  failures: isolationFailures.slice(0, 100), totalFailures: isolationFailures.length
});
record('routes.deterministic-byte-budgets', routeBudgetFailures.length === 0, {
  budgets: PERFORMANCE_BUDGETS,
  failures: routeBudgetFailures.slice(0, 200),
  totalFailures: routeBudgetFailures.length
});
if (lcpTargetExceptions.length) {
  warn('routes.lcp-raster-target-exceptions', {
    message: 'These resources pass the hard exception limit but require visual-quality evidence in the H5 report.',
    exceptions: lcpTargetExceptions
  });
}

record('artifact.projected-hard-size-budget', reachability.failClosed.pass
  && reachability.projectedAfterPruning.bytes <= PERFORMANCE_BUDGETS.artifactBytes, {
  actualBeforePruning: reachability.artifact.bytesBefore,
  projectedAfterPruning: reachability.projectedAfterPruning.bytes,
  budget: PERFORMANCE_BUDGETS.artifactBytes,
  removableMediaBytes: reachability.artifact.removableMediaBytes
});
const unreferencedMp4 = reachability.mp4.filter((file) => !file.referenced);
record('artifact.no-unreferenced-mp4-after-proven-pruning', reachability.failClosed.pass
  && reachability.projectedAfterPruning.mp4.length === reachability.mp4.length - unreferencedMp4.length, {
  removableBeforePruning: unreferencedMp4.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
  retainedAfterPruning: reachability.projectedAfterPruning.mp4
});
record('artifact.projected-duplicate-media-budget', reachability.failClosed.pass
  && reachability.projectedAfterPruning.duplicateWastedBytes < PERFORMANCE_BUDGETS.duplicateMediaBytes, {
  actualBeforePruning: reachability.artifact.duplicateWastedBytes,
  projectedAfterPruning: reachability.projectedAfterPruning.duplicateWastedBytes,
  budget: PERFORMANCE_BUDGETS.duplicateMediaBytes,
  groupsAfterPruning: reachability.projectedAfterPruning.duplicateGroupDetails.slice(0, 30)
});
if (reachability.artifact.bytesBefore > PERFORMANCE_BUDGETS.artifactBytes) {
  warn('artifact.apply-pruning-before-upload', {
    actualBytes: reachability.artifact.bytesBefore,
    projectedBytes: reachability.projectedAfterPruning.bytes,
    message: 'The current dist exceeds the deploy budget; run the explicit reachability --apply step before Pages upload.'
  });
}

const report = {
  schemaVersion: 1,
  kind: 'smu1-h5-deterministic-performance-qa',
  status: failures.length === 0 ? 'pass' : 'fail',
  generatedAt: new Date().toISOString(),
  inputs: {
    distRoot: options.distRoot,
    publicRoot: options.publicRoot,
    manifestPath: options.manifestPath,
    basePath: reachability.basePath
  },
  budgets: PERFORMANCE_BUDGETS,
  summary: {
    checks: checks.length,
    passed: checks.filter((check) => check.status === 'pass').length,
    failed: failures.length,
    warnings: warnings.length,
    html: {
      total: htmlFiles.length,
      production: htmlGroups.production.length,
      designLab: htmlGroups.designLab.length,
      admin: htmlGroups.admin.length
    },
    manifest: {
      canonicalSources: manifestEntries.length,
      uniqueSources: uniqueSourceHashes.size,
      derivatives: uniqueVariants.size,
      derivativeBytes: [...uniqueVariants.values()].reduce((sum, variant) => sum + variant.bytes, 0)
    },
    artifact: reachability.artifact
  },
  checks,
  failures,
  warnings,
  routes: routeReports,
  reachability: {
    failClosed: reachability.failClosed,
    errors: reachability.errors,
    unreferencedCandidates: reachability.unreferencedCandidates,
    duplicateGroups: reachability.duplicateGroups,
    projectedAfterPruning: reachability.projectedAfterPruning,
    mp4: reachability.mp4
  }
};

if (options.reportPath) {
  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, stableJson(report), 'utf8');
}

if (options.json) {
  process.stdout.write(stableJson(report));
} else {
  process.stdout.write(stableJson({
    status: report.status,
    summary: report.summary,
    failedChecks: failures.map((check) => check.id),
    warningChecks: warnings.map((check) => check.id),
    report: options.reportPath || null
  }));
}
if (failures.length) process.exitCode = 1;

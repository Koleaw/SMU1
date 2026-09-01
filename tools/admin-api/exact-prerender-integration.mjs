import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_ROUTES = 500;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const ENCODED_SEPARATOR_RE = /%(?:2e|2f|5c)/iu;

export class ExactPrerenderManifestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExactPrerenderManifestError';
    this.code = code;
    this.details = details;
  }
}

export function normalizeExactRoute(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 2_048
    || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')
    || value.includes('?') || value.includes('#') || CONTROL_RE.test(value)
    || ENCODED_SEPARATOR_RE.test(value) || /\/{2,}/u.test(value)) {
    throw new ExactPrerenderManifestError('EXACT_ROUTE_INVALID', 'Exact route closure содержит небезопасный маршрут.', { route: String(value || '') });
  }
  if (value.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new ExactPrerenderManifestError('EXACT_ROUTE_INVALID', 'Exact route closure содержит ненормализованный маршрут.', { route: value });
  }
  return value === '/' ? '/' : value.replace(/\/$/u, '');
}

export function normalizeExactRouteManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1 || value.kind !== 'smu1-exact-route-closure'
    || typeof value.runId !== 'string' || !/^exact-[a-f0-9]{32}$/u.test(value.runId)
    || typeof value.transactionId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,127}$/iu.test(value.transactionId)
    || !Array.isArray(value.expectations) || value.expectations.length < 1 || value.expectations.length > MAX_ROUTES) {
    throw new ExactPrerenderManifestError('EXACT_MANIFEST_INVALID', 'Exact route closure manifest имеет неверную схему.');
  }
  const seen = new Set();
  const expectations = value.expectations.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'expected,route'
      || !['html', 'not-found'].includes(item.expected)) {
      throw new ExactPrerenderManifestError('EXACT_EXPECTATION_INVALID', 'Exact route expectation имеет неверную схему.', { index });
    }
    const normalizedRoute = normalizeExactRoute(item.route);
    if (seen.has(normalizedRoute)) {
      throw new ExactPrerenderManifestError('EXACT_ROUTE_DUPLICATE', 'Exact route closure содержит повторяющийся маршрут.', { route: item.route });
    }
    seen.add(normalizedRoute);
    return { route: item.route, normalizedRoute, expected: item.expected };
  });
  return {
    version: 1,
    kind: value.kind,
    runId: value.runId,
    transactionId: value.transactionId,
    expectations
  };
}

export function exactRouteManifestSha256(value) {
  const normalized = normalizeExactRouteManifest(value);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function selectExactStaticPaths(paths, manifest) {
  if (!Array.isArray(paths) || paths.some((entry) => !entry || typeof entry.pathname !== 'string' || !entry.route)) {
    throw new ExactPrerenderManifestError('EXACT_PRERENDER_PATHS_INVALID', 'Astro prerenderer вернул некорректный route set.');
  }
  const normalized = normalizeExactRouteManifest(manifest);
  const pathRows = paths.map((entry) => ({ entry, normalizedRoute: normalizeExactRoute(entry.pathname) }));
  const emitted = new Set(pathRows.map((row) => row.normalizedRoute));
  const requested = new Set();
  const topologyChecks = [];
  let needs404 = false;
  for (const expectation of normalized.expectations) {
    const exists = emitted.has(expectation.normalizedRoute);
    if (expectation.expected === 'html') {
      if (!exists) {
        throw new ExactPrerenderManifestError('EXACT_AFFECTED_ROUTE_MISSING', 'Затронутый маршрут отсутствует в production route topology.', { route: expectation.route });
      }
      requested.add(expectation.normalizedRoute);
    } else {
      if (exists) {
        throw new ExactPrerenderManifestError('EXACT_NOT_FOUND_ROUTE_PRESENT', 'Маршрут, который должен исчезнуть, всё ещё присутствует в production route topology.', { route: expectation.route });
      }
      needs404 = true;
    }
    topologyChecks.push({ route: expectation.route, expected: expectation.expected, presentInProductionTopology: exists });
  }
  if (needs404) {
    if (!emitted.has('/404.html')) {
      throw new ExactPrerenderManifestError('EXACT_404_ROUTE_MISSING', 'Production route topology не содержит canonical 404 artifact.');
    }
    requested.add('/404.html');
  }
  const selected = pathRows.filter((row) => requested.has(row.normalizedRoute)).map((row) => row.entry);
  const selectedRoutes = [...new Set(selected.map((entry) => normalizeExactRoute(entry.pathname)))].sort();
  return {
    selected,
    evidence: {
      mode: 'targeted-production-ssg',
      authoritativePathCount: paths.length,
      authoritativeUniquePathCount: emitted.size,
      selectedPathCount: selected.length,
      selectedRoutes,
      topologyChecks
    }
  };
}

async function readOwnedManifest(manifestPath) {
  const resolved = path.resolve(String(manifestPath || ''));
  if (!path.isAbsolute(resolved) || path.dirname(resolved) !== path.resolve(process.cwd())
    || path.basename(resolved) !== '.smu1-exact-route-closure.json') {
    throw new ExactPrerenderManifestError('EXACT_MANIFEST_PATH_INVALID', 'Exact route manifest должен быть owned-файлом в корне immutable workspace.');
  }
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_MANIFEST_BYTES) {
    throw new ExactPrerenderManifestError('EXACT_MANIFEST_FILE_INVALID', 'Exact route manifest должен быть небольшим обычным файлом.');
  }
  let value;
  try { value = JSON.parse(await fs.readFile(resolved, 'utf8')); }
  catch (error) { throw new ExactPrerenderManifestError('EXACT_MANIFEST_JSON_INVALID', 'Exact route manifest содержит некорректный JSON.', { cause: error?.message }); }
  return { path: resolved, manifest: normalizeExactRouteManifest(value) };
}

async function writeEvidence(manifestPath, evidence) {
  const target = `${manifestPath}.result.json`;
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, target);
}

export function exactPrerenderIntegration({ manifestPath }) {
  return {
    name: 'smu1-exact-production-ssg-closure',
    hooks: {
      'astro:build:start': async ({ setPrerenderer }) => {
        const owned = await readOwnedManifest(manifestPath);
        setPrerenderer((defaultPrerenderer) => ({
          name: 'smu1-exact-production-ssg-closure',
          setup: defaultPrerenderer.setup ? () => defaultPrerenderer.setup() : undefined,
          render: (request, options) => defaultPrerenderer.render(request, options),
          collectStaticImages: defaultPrerenderer.collectStaticImages
            ? () => defaultPrerenderer.collectStaticImages()
            : undefined,
          teardown: defaultPrerenderer.teardown ? () => defaultPrerenderer.teardown() : undefined,
          getStaticPaths: async () => {
            const allPaths = await defaultPrerenderer.getStaticPaths();
            const result = selectExactStaticPaths(allPaths, owned.manifest);
            await writeEvidence(owned.path, {
              schemaVersion: 1,
              kind: 'smu1-exact-prerender-result',
              runId: owned.manifest.runId,
              transactionId: owned.manifest.transactionId,
              manifestSha256: exactRouteManifestSha256(owned.manifest),
              ...result.evidence
            });
            return result.selected;
          }
        }));
      }
    }
  };
}

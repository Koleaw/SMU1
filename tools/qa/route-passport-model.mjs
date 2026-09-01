import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createV2RouteRegistry, V2_COMPATIBILITY_ROUTES } from '../../src/utils/v2TransitionRouting.mjs';

const JSON_FILE = /\.json$/iu;
const HTML_FILE = /\.html$/iu;
const PLACEHOLDER_MEDIA = /\/assets\/images\/placeholders\//iu;
const TEXT_ARTIFACT_FILE = /\.(?:css|html?|js|json|map|mjs|svg|txt|webmanifest|xml)$/iu;

export const ROUTE_PASSPORT_SCHEMA_VERSION = 1;
export const REQUIRED_VIEWPORTS = Object.freeze([
  { id: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { id: 'mobile-390x844', width: 390, height: 844, mobile: true }
]);
export const REAL_UNKNOWN_ROUTE = '/__h6-route-passport-unknown__/';

const normalizeRoute = (value) => {
  const pathname = new URL(String(value || '/'), 'http://route-passport.local/').pathname.replace(/\/{2,}/gu, '/');
  if (pathname === '/' || path.posix.extname(pathname)) return pathname;
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
};

const relativeRoute = (root, filename) => {
  const relative = path.relative(root, filename).replaceAll('\\', '/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative}`;
};

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
});

export function discoverArtifactFiles(distRoot) {
  if (!fs.existsSync(distRoot)) throw new Error(`Production dist directory is missing: ${distRoot}`);
  return walk(distRoot)
    .filter((filename) => fs.statSync(filename).isFile())
    .map((filename) => path.relative(distRoot, filename).replaceAll('\\', '/'))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function discoverProductionHtml(distRoot) {
  if (!fs.existsSync(distRoot)) throw new Error(`Production dist directory is missing: ${distRoot}`);
  return walk(distRoot)
    .filter((filename) => HTML_FILE.test(filename))
    .map((filename) => normalizeRoute(relativeRoute(distRoot, filename)))
    .filter((route) => !route.startsWith('/admin/') && !route.startsWith('/design-lab/'))
    .sort((left, right) => left.localeCompare(right, 'ru'));
}

export function productionHtmlFilename(distRoot, route) {
  const normalized = normalizeRoute(route);
  const relative = normalized === '/'
    ? 'index.html'
    : path.posix.extname(normalized)
      ? normalized.slice(1)
      : `${normalized.slice(1)}index.html`;
  const filename = path.resolve(distRoot, relative);
  const resolvedRoot = path.resolve(distRoot);
  if (filename !== resolvedRoot && !filename.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Production route escaped dist: ${route}`);
  }
  return filename;
}

export function fingerprintProductionHtml(distRoot, routes = discoverProductionHtml(distRoot)) {
  const entries = routes.map((route) => {
    const body = fs.readFileSync(productionHtmlFilename(distRoot, route));
    return [normalizeRoute(route), crypto.createHash('sha256').update(body).digest('hex')];
  });
  return {
    algorithm: 'sha256',
    aggregate: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    entries
  };
}

export function fingerprintArtifact(distRoot, relativeFiles = discoverArtifactFiles(distRoot)) {
  const entries = relativeFiles.map((relative) => {
    const filename = path.resolve(distRoot, relative);
    const resolvedRoot = path.resolve(distRoot);
    if (filename !== resolvedRoot && !filename.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`Artifact file escaped dist: ${relative}`);
    }
    const body = fs.readFileSync(filename);
    return [relative, crypto.createHash('sha256').update(body).digest('hex'), body.length];
  });
  return {
    algorithm: 'sha256',
    aggregate: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry[2], 0),
    entries
  };
}

export function inspectPublicArtifactIsolation(distRoot, relativeFiles = discoverArtifactFiles(distRoot)) {
  const forbiddenPatterns = [
    ['binding-metadata', /data-smu1-(?:binding|list-(?:item|field|value)|editor-(?:affordance|canvas|disposition))/iu],
    ['editor-render-flag', /__smu1_editor|editorSession|editorRevision/iu],
    ['admin-api-client', /\/api\/admin(?:\/|['"`?])/iu],
    ['admin-csrf', /x-admin-csrf/iu],
    ['active-admin-shell', /data-(?:visual-admin-root|admin-shell)|id\s*=\s*["'](?:veApp|adminRoot)["']/iu],
    ['editor-bridge-or-bundle', /visual-editor-app|editor-bridge|binding-registry|--editor-(?:affordance|missing-media)/iu]
  ];
  const leaks = [];
  const adminHtml = relativeFiles.filter((relative) => relative.startsWith('admin/') && HTML_FILE.test(relative));
  for (const relative of relativeFiles) {
    if (!TEXT_ARTIFACT_FILE.test(relative)) continue;
    const body = fs.readFileSync(path.join(distRoot, relative), 'utf8');
    for (const [kind, pattern] of forbiddenPatterns) {
      if (pattern.test(body)) leaks.push({ relative, kind });
    }
    if (relative.startsWith('admin/') && HTML_FILE.test(relative)) {
      if (!/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/iu.test(body)
        && !/<meta\b[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["']/iu.test(body)) {
        leaks.push({ relative, kind: 'admin-route-not-noindex' });
      }
      // A public Astro build may attach its site-wide prefetch helper to every
      // route. That does not turn the compatibility page into an active admin
      // surface. Active editor/login bundles are caught both by their explicit
      // script name here and by the full-artifact forbidden-pattern scan above.
      if (/<input\b[^>]*type=["']password["']|<form\b[^>]*(?:login|auth)|<script\b[^>]*src=["'][^"']*(?:admin|editor|visual)[^"']*["']/iu.test(body)) {
        leaks.push({ relative, kind: 'active-admin-route' });
      }
    }
  }
  const adminSourceMaps = relativeFiles.filter((relative) => /(?:admin|editor)[^/]*\.map$/iu.test(relative));
  leaks.push(...adminSourceMaps.map((relative) => ({ relative, kind: 'admin-source-map' })));
  return {
    clean: leaks.length === 0,
    checkedFiles: relativeFiles.length,
    adminHtml,
    adminSourceMaps,
    leaks
  };
}

export function assessDistFreshness({ root = process.cwd(), distRoot = path.join(root, 'dist') } = {}) {
  const sourceRoots = ['src', 'public'].map((directory) => path.join(root, directory)).filter((directory) => fs.existsSync(directory));
  const sourceFiles = sourceRoots.flatMap(walk).filter((filename) => /\.(?:astro|avif|cjs|css|gif|html|jpe?g|js|json|md|mdx|mjs|mp4|png|scss|svg|ts|ttf|webm|webp|woff2?|ya?ml)$/iu.test(filename));
  for (const filename of ['astro.config.mjs', 'package-lock.json', 'package.json']) {
    const target = path.join(root, filename);
    if (fs.existsSync(target)) sourceFiles.push(target);
  }
  const htmlFiles = walk(distRoot).filter((filename) => HTML_FILE.test(filename));
  const latestSourceMtimeMs = Math.max(0, ...sourceFiles.map((filename) => fs.statSync(filename).mtimeMs));
  const oldestHtmlMtimeMs = htmlFiles.length ? Math.min(...htmlFiles.map((filename) => fs.statSync(filename).mtimeMs)) : 0;
  return {
    fresh: Boolean(htmlFiles.length && oldestHtmlMtimeMs >= latestSourceMtimeMs),
    sourceFiles: sourceFiles.length,
    htmlFiles: htmlFiles.length,
    latestSourceMtime: latestSourceMtimeMs ? new Date(latestSourceMtimeMs).toISOString() : null,
    oldestHtmlMtime: oldestHtmlMtimeMs ? new Date(oldestHtmlMtimeMs).toISOString() : null
  };
}

const readCollection = (contentRoot, collection, repositoryRoot) => {
  const directory = path.join(contentRoot, collection);
  return fs.readdirSync(directory)
    .filter((name) => JSON_FILE.test(name))
    .sort((left, right) => left.localeCompare(right, 'ru'))
    .map((name) => ({
      collection,
      filename: path.join(directory, name),
      sourcePath: path.relative(repositoryRoot, path.join(directory, name)).replaceAll('\\', '/'),
      data: JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
    }));
};

const nonPlaceholderMedia = (value) => {
  const source = typeof value === 'string' ? value.trim() : String(value?.src || '').trim();
  return source && !PLACEHOLDER_MEDIA.test(source) ? source : '';
};

const categoryPublicMedia = (category) => {
  const gallery = Array.isArray(category.gallery)
    ? category.gallery.map(nonPlaceholderMedia).filter(Boolean)
    : [];
  if (gallery.length) return [...new Set(gallery)];
  const image = nonPlaceholderMedia(category.image);
  return image ? [image] : [];
};

const productMedia = (product) => [...new Set([
  nonPlaceholderMedia(product.image),
  ...(Array.isArray(product.gallery) ? product.gallery.map(nonPlaceholderMedia) : [])
].filter(Boolean))];

const owner = (entry, fields = []) => ({
  kind: 'content-record',
  collection: entry.collection,
  slug: String(entry.data.slug || path.basename(entry.filename, '.json')),
  sourcePath: entry.sourcePath,
  fields
});

const templateOwner = (sourcePath, note) => ({ kind: 'template-or-adapter', sourcePath, note });

const fixedPageModel = {
  '/': {
    rendererFamily: 'home', rendererVariant: 'home-final',
    owners: [{ collection: 'static-pages', slug: 'home' }],
    expectedTools: ['inline-text', 'long-text', 'link', 'media', 'reorder']
  },
  '/vypolnennye-obekty/': {
    rendererFamily: 'project-archive', rendererVariant: 'archive',
    owners: [{ collection: 'static-pages', slug: 'vypolnennye-obekty' }, { collection: 'projects', slug: '*' }],
    expectedTools: ['inline-text', 'long-text', 'media', 'reorder', 'record-actions']
  },
  '/o-nas/': {
    rendererFamily: 'practical', rendererVariant: 'company',
    owners: [{ collection: 'static-pages', slug: 'about' }],
    expectedTools: ['inline-text', 'long-text', 'media', 'relation']
  },
  '/kontakty/': {
    rendererFamily: 'practical', rendererVariant: 'contacts', owners: [{ collection: 'site-settings', slug: 'global' }],
    expectedTools: ['inline-text', 'long-text', 'contact', 'integration-settings']
  },
  '/vakansii/': {
    rendererFamily: 'practical', rendererVariant: 'vacancies-archive', owners: [{ collection: 'jobs', slug: '*' }],
    expectedTools: ['inline-text', 'long-text', 'reorder', 'record-actions']
  },
  '/politika-konfidencialnosti/': {
    rendererFamily: 'practical', rendererVariant: 'privacy-legal', owners: [],
    expectedTools: ['legal-structure', 'legal-confirmation']
  },
  '/izgotovlenie-na-zakaz/': {
    rendererFamily: 'custom-order', rendererVariant: 'custom-order',
    owners: [{ collection: 'static-pages', slug: 'custom-order' }],
    expectedTools: ['inline-text', 'long-text', 'list', 'link', 'media']
  }
};

const toolsByKind = {
  'section-hub': ['inline-text', 'long-text', 'media', 'reorder', 'record-actions'],
  direction: ['inline-text', 'long-text', 'list', 'media', 'relation'],
  category: ['inline-text', 'long-text', 'media', 'reorder', 'record-actions'],
  'product-standard': ['inline-text', 'long-text', 'price', 'list', 'media', 'relation'],
  'product-premium': ['inline-text', 'long-text', 'price', 'list', 'media', 'relation', 'crop'],
  'project-detail': ['inline-text', 'long-text', 'list', 'media', 'relation'],
  'career-detail': ['inline-text', 'long-text', 'list', 'contact']
};

const directionRendererVariants = {
  'navesy-i-kozyrki': 'direction-engineering-visual',
  topiarii: 'direction-visual',
  'metallokonstruktsii-dlya-biznesa': 'direction-engineering-commercial',
  'stroitelstvo-i-remonty': 'direction-project-commercial',
  'blagoustroystvo-territoriy': 'direction-place-commercial'
};

const resolveDeclaredOwners = (declarations, byCollectionSlug) => declarations.flatMap((declaration) => {
  if (declaration.slug === '*') {
    return [...(byCollectionSlug.get(declaration.collection)?.values() || [])].map((entry) => owner(entry));
  }
  const entry = byCollectionSlug.get(declaration.collection)?.get(declaration.slug);
  return entry ? [owner(entry)] : [];
});

export function buildExpectedRouteModel({ root = process.cwd() } = {}) {
  const contentRoot = path.join(root, 'src', 'content');
  const collections = Object.fromEntries([
    'product-sections', 'services', 'product-categories', 'products', 'projects', 'jobs', 'site-settings', 'static-pages'
  ].map((name) => [name, readCollection(contentRoot, name, root)]));
  const active = (name) => collections[name].filter((entry) => entry.data.isActive !== false);
  const byCollectionSlug = new Map(Object.entries(collections).map(([name, entries]) => [
    name,
    new Map(entries.map((entry) => [String(entry.data.slug || path.basename(entry.filename, '.json')), entry]))
  ]));
  const registry = createV2RouteRegistry({
    productSections: active('product-sections').map((entry) => entry.data),
    services: active('services').map((entry) => entry.data),
    categories: active('product-categories').map((entry) => entry.data),
    products: active('products').map((entry) => entry.data),
    projects: active('projects').map((entry) => entry.data),
    jobs: active('jobs').map((entry) => entry.data)
  });
  const sections = new Map(active('product-sections').map((entry) => [entry.data.slug, entry]));
  const services = new Map(active('services').map((entry) => [entry.data.slug, entry]));
  const categories = new Map(active('product-categories').map((entry) => [entry.data.slug, entry]));
  const products = new Map(active('products').map((entry) => [entry.data.slug, entry]));
  const projects = new Map(active('projects').map((entry) => [entry.data.slug, entry]));
  const jobs = new Map(active('jobs').map((entry) => [entry.data.slug, entry]));
  const productsByCategory = active('products').reduce((map, entry) => {
    const key = entry.data.productCategorySlug;
    map.set(key, [...(map.get(key) || []), entry]);
    return map;
  }, new Map());
  const orderedProjects = active('projects').slice().sort((left, right) =>
    (left.data.order - right.data.order) || String(left.data.title).localeCompare(String(right.data.title), 'ru'));
  const projectArchiveIndex = new Map(orderedProjects.map((entry, index) => [entry.data.slug, index]));

  const routes = registry.routes.map((descriptor) => {
    const pathname = normalizeRoute(descriptor.pathname);
    const base = {
      pathname,
      routeClass: descriptor.routeKind === 'legacy-redirect' ? 'alias' : descriptor.routeKind === 'not-found' ? '404' : 'canonical',
      canonicalTarget: pathname,
      rendererFamily: descriptor.routeKind,
      rendererVariant: descriptor.presentationType || descriptor.routeKind,
      sourceOwners: [],
      expectedTools: toolsByKind[descriptor.routeKind] || [],
      expectedLabel: descriptor.label,
      modelEvidence: {}
    };
    if (V2_COMPATIBILITY_ROUTES.includes(pathname)) {
      const targets = {
        '/lavochki-i-skameyki/': '/ulichnaya-mebel/lavochki-i-skameyki/',
        '/urny/': '/ulichnaya-mebel/urny/',
        '/navesy/': '/navesy-i-kozyrki/'
      };
      return {
        ...base, canonicalTarget: targets[pathname], rendererFamily: 'compatibility-alias', rendererVariant: 'static-redirect',
        sourceOwners: [templateOwner(`src/pages${pathname.replace(/\/$/u, '')}.astro`, 'Compatibility route; canonical target is the editable page.')]
      };
    }
    if (pathname === '/404.html') {
      const settingsEntry = byCollectionSlug.get('site-settings')?.get('global');
      return {
        ...base, rendererFamily: 'not-found', rendererVariant: '404',
        sourceOwners: [
          ...(settingsEntry ? [owner(settingsEntry, ['notFoundPage', 'phonePrimary', 'telegram', 'email'])] : []),
          templateOwner('src/components/v2/not-found/V2NotFoundPage.astro', '404 renderer and validated recovery links.')
        ],
        expectedTools: ['inline-text', 'link']
      };
    }
    if (fixedPageModel[pathname]) {
      const fixed = fixedPageModel[pathname];
      return {
        ...base, ...fixed,
        sourceOwners: [
          ...resolveDeclaredOwners(fixed.owners, byCollectionSlug),
          ...(pathname === '/kontakty/' ? [templateOwner('src/components/v2/practical/practicalV2Data.ts', 'Contact presentation adapter.')] : []),
          ...(pathname === '/politika-konfidencialnosti/' ? [templateOwner('src/components/v2/practical/V2PrivacyPolicy.astro', 'Legal structure must be materialized and explicitly confirmed.')] : [])
        ]
      };
    }
    if (descriptor.routeKind === 'section-hub' || descriptor.routeKind === 'direction') {
      const entry = sections.get(pathname.slice(1, -1)) || services.get(pathname.slice(1, -1));
      return {
        ...base,
        rendererFamily: descriptor.routeKind === 'section-hub' ? 'catalog' : 'direction',
        rendererVariant: descriptor.routeKind === 'section-hub'
          ? 'catalog-hub'
          : directionRendererVariants[entry?.data.slug] || `direction-${entry?.data.mode || 'default'}`,
        sourceOwners: entry ? [owner(entry)] : [],
        modelEvidence: { collection: entry?.collection || '', mode: entry?.data.mode || '' }
      };
    }
    if (descriptor.routeKind === 'category') {
      const segments = pathname.split('/').filter(Boolean);
      const entry = categories.get(segments.at(-1));
      const relatedProducts = entry ? productsByCategory.get(entry.data.slug) || [] : [];
      const publicMedia = entry ? categoryPublicMedia(entry.data) : [];
      const galleryCount = Array.isArray(entry?.data.gallery) ? entry.data.gallery.map(nonPlaceholderMedia).filter(Boolean).length : 0;
      const rendererVariant = relatedProducts.length && galleryCount
        ? 'mixed'
        : relatedProducts.length
          ? 'product-list'
          : publicMedia.length
            ? 'gallery-only'
            : 'text-only';
      return {
        ...base, rendererFamily: 'category', rendererVariant,
        sourceOwners: entry ? [owner(entry), ...relatedProducts.map((product) => owner(product))] : [],
        modelEvidence: { productCount: relatedProducts.length, publicMediaCount: publicMedia.length, galleryCount }
      };
    }
    if (descriptor.routeKind.startsWith('product-')) {
      const segments = pathname.split('/').filter(Boolean);
      const entry = products.get(segments.at(-1));
      const media = entry ? productMedia(entry.data) : [];
      return {
        ...base, rendererFamily: 'product',
        rendererVariant: `${descriptor.presentationType || 'standard'}-${media.length ? 'media' : 'no-media'}`,
        sourceOwners: entry ? [owner(entry), owner(categories.get(entry.data.productCategorySlug))] : [],
        modelEvidence: { presentationType: descriptor.presentationType || 'standard', publicMediaCount: media.length }
      };
    }
    if (descriptor.routeKind === 'project-detail') {
      const entry = projects.get(pathname.split('/').filter(Boolean).at(-1));
      const publicGalleryCount = Array.isArray(entry?.data.presentation?.publicGallery)
        ? entry.data.presentation.publicGallery.length
        : 0;
      const hasHero = Boolean(entry?.data.presentation?.detailHeroMedia);
      const isTextOnly = !entry?.data.presentation?.archiveCoverMedia && !hasHero && publicGalleryCount === 0;
      const detailVariant = isTextOnly
        ? 'text-only'
        : publicGalleryCount >= 8
          ? 'large-gallery'
          : publicGalleryCount > 0
            ? 'gallery'
            : 'media-hero-only';
      const archiveOrientation = entry?.data.presentation?.archiveCoverOrientation || 'landscape';
      const index = projectArchiveIndex.get(entry?.data.slug);
      const archivePlacement = entry?.data.presentation?.archiveCoverMedia
        ? (index ?? 0) % 2 === 0 ? 'media-first' : 'media-last'
        : 'text-only';
      return {
        ...base, rendererFamily: 'project', rendererVariant: `${detailVariant}+${archiveOrientation}+${archivePlacement}`,
        sourceOwners: entry ? [owner(entry), templateOwner('src/components/v2/mediaRoleAdapter.ts', 'Legacy project presentation roles; expected to migrate to record-backed roles.')] : [],
        modelEvidence: {
          rawGalleryCount: Array.isArray(entry?.data.gallery) ? entry.data.gallery.length : 0,
          publicGalleryCount,
          detailVariant,
          archiveOrientation,
          archivePlacement
        }
      };
    }
    if (descriptor.routeKind === 'career-detail') {
      const entry = jobs.get(pathname.split('/').filter(Boolean).at(-1));
      const settingsEntry = byCollectionSlug.get('site-settings')?.get('global');
      return {
        ...base,
        rendererFamily: 'practical',
        rendererVariant: 'vacancy-detail',
        sourceOwners: [
          ...(entry ? [owner(entry)] : []),
          ...(settingsEntry ? [owner(settingsEntry, ['vacancyDetailPage', 'phonePrimary', 'telegram', 'email'])] : [])
        ]
      };
    }
    return base;
  }).sort((left, right) => left.pathname.localeCompare(right.pathname, 'ru'));

  return {
    schemaVersion: ROUTE_PASSPORT_SCHEMA_VERSION,
    registryVersion: registry.version,
    routes,
    collections: Object.fromEntries(Object.entries(collections).map(([name, entries]) => [name, entries.length]))
  };
}

export function reconcileRouteSets(expectedRoutes, discoveredRoutes) {
  const expected = [...new Set(expectedRoutes.map(normalizeRoute))].sort((a, b) => a.localeCompare(b, 'ru'));
  const discovered = [...new Set(discoveredRoutes.map(normalizeRoute))].sort((a, b) => a.localeCompare(b, 'ru'));
  const expectedSet = new Set(expected);
  const discoveredSet = new Set(discovered);
  const missing = expected.filter((route) => !discoveredSet.has(route));
  const unexpected = discovered.filter((route) => !expectedSet.has(route));
  return { expected, discovered, missing, unexpected, exact: missing.length === 0 && unexpected.length === 0 };
}

export function summarizeRouteModel(routes) {
  const tally = (field) => routes.reduce((counts, route) => {
    const value = String(route[field] || 'unknown');
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
  return {
    total: routes.length,
    routeClasses: tally('routeClass'),
    rendererFamilies: tally('rendererFamily'),
    rendererVariants: tally('rendererVariant')
  };
}

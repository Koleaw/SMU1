import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const contentRoot = path.join(root, 'src', 'content');
const docsRoot = path.join(root, 'docs', 'design-lab', 'v2');

const readRecords = (collection) => fs.readdirSync(path.join(contentRoot, collection))
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({
    file: `src/content/${collection}/${name}`,
    data: JSON.parse(fs.readFileSync(path.join(contentRoot, collection, name), 'utf8'))
  }));

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
});

const routeFromHtml = (file) => {
  const relative = path.relative(distRoot, file).replaceAll('\\', '/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative}`;
};

const distTarget = (route) => {
  const clean = route.replace(/^\//, '');
  if (!clean) return path.join(distRoot, 'index.html');
  return route.endsWith('/') ? path.join(distRoot, clean, 'index.html') : path.join(distRoot, clean);
};

const canonicalFromHtml = (route) => {
  const file = distTarget(route);
  if (!fs.existsSync(file)) return '';
  const html = fs.readFileSync(file, 'utf8');
  const tag = html.match(/<link\b[^>]*rel=(?:"canonical"|'canonical')[^>]*>/i)?.[0]
    || html.match(/<link\b[^>]*href=(?:"[^"]+"|'[^']+')[^>]*rel=(?:"canonical"|'canonical')[^>]*>/i)?.[0]
    || '';
  const href = tag.match(/href=(?:"([^"]+)"|'([^']+)')/i);
  return href ? new URL(href[1] || href[2], 'http://manifest.local/').pathname : '';
};

const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const toCsv = (columns, rows) => [
  columns.join(','),
  ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))
].join('\n') + '\n';

const isPlaceholder = (value) => /\/assets\/images\/placeholders\//i.test(String(value || ''));
const usableProductMedia = (record) => [record.image, ...(record.gallery || [])]
  .map((item) => typeof item === 'string' ? item.trim() : '')
  .filter((item) => item && !isPlaceholder(item));
const usableCategoryMedia = (record) => [
  record.image,
  ...(record.gallery || []).map((item) => typeof item === 'string' ? item : item?.src)
].map((item) => String(item || '').trim()).filter((item) => item && !isPlaceholder(item));

const sectionEntries = readRecords('product-sections').filter(({ data }) => data.isActive);
const categoryEntries = readRecords('product-categories').filter(({ data }) => data.isActive);
const productEntries = readRecords('products').filter(({ data }) => data.isActive);
const serviceEntries = readRecords('services').filter(({ data }) => data.isActive);
const projectEntries = readRecords('projects').filter(({ data }) => data.isActive);
const staticEntries = readRecords('static-pages').filter(({ data }) => data.isActive !== false);
const jobEntries = readRecords('jobs').filter(({ data }) => data.isActive);

const sectionsBySlug = new Map(sectionEntries.map((entry) => [entry.data.slug, entry]));
const categoriesBySlug = new Map(categoryEntries.map((entry) => [entry.data.slug, entry]));
const productsByCategory = new Map();
for (const entry of productEntries) {
  const list = productsByCategory.get(entry.data.productCategorySlug) || [];
  list.push(entry);
  productsByCategory.set(entry.data.productCategorySlug, list);
}

const rowsByRoute = new Map();
const add = (row) => {
  if (rowsByRoute.has(row.production_route)) throw new Error(`Duplicate manifest route: ${row.production_route}`);
  rowsByRoute.set(row.production_route, {
    production_route: row.production_route,
    page_type: row.page_type,
    v2_route_or_pattern: row.v2_route_or_pattern,
    v2_component_template: row.v2_component_template,
    data_source: row.data_source,
    media_source: row.media_source,
    canonical_target: row.canonical_target,
    migration_action: row.migration_action,
    dependencies: row.dependencies,
    known_gaps: row.known_gaps || '',
    blocking_status: row.blocking_status || 'ready'
  });
};

const staticBySlug = (slug) => staticEntries.find(({ data }) => data.slug === slug);
add({
  production_route: '/', page_type: 'home', v2_route_or_pattern: '/design-lab/home-v2/',
  v2_component_template: 'HomeV2', data_source: `${staticBySlug('home')?.file || 'src/content/static-pages/home.json'}; src/content/site-settings/global.json`,
  media_source: 'home record media; existing desktop/mobile hero video and public uploads', canonical_target: '/',
  migration_action: 'replace', dependencies: 'V2 shared Header/MobileMenu/Footer; production URL preserved'
});

const directionComponents = {
  'navesy-i-kozyrki': 'DirectionV2Layout + directionV2Data',
  topiarii: 'DirectionV2Layout + directionV2Data',
  'metallokonstruktsii-dlya-biznesa': 'EngineeringDirectionV2Layout + engineeringDirectionV2Data',
  'blagoustroystvo-territoriy': 'PlaceDirectionV2Layout + project media adapter',
  'stroitelstvo-i-remonty': 'ProjectDirectionV2Layout + project media adapter'
};
const catalogSectionSlugs = new Set(['ulichnaya-mebel', 'ograzhdeniya-i-zabory']);
for (const entry of sectionEntries) {
  const { slug } = entry.data;
  const route = `/${slug}/`;
  const isCatalog = catalogSectionSlugs.has(slug);
  add({
    production_route: route,
    page_type: isCatalog ? 'catalog-section' : 'direction',
    v2_route_or_pattern: `/design-lab/v2/${slug}/`,
    v2_component_template: isCatalog ? 'CatalogSectionV2' : directionComponents[slug],
    data_source: entry.file,
    media_source: isCatalog ? `${entry.file} image/pageBlocks` : `${entry.file}; V2 project/media-role adapter where assigned`,
    canonical_target: route,
    migration_action: 'replace',
    dependencies: isCatalog ? 'Catalog V2 data layer; active category records' : 'Direction V2 adapter; shared gallery where present',
    known_gaps: slug === 'blagoustroystvo-territoriy' ? 'One linked project remains text-only; non-blocking' : ''
  });
}

for (const entry of serviceEntries) {
  const { slug } = entry.data;
  const route = `/${slug}/`;
  add({
    production_route: route,
    page_type: 'direction',
    v2_route_or_pattern: `/design-lab/v2/${slug}/`,
    v2_component_template: directionComponents[slug],
    data_source: entry.file,
    media_source: `${entry.file}; V2 project/media-role adapter`,
    canonical_target: route,
    migration_action: 'replace',
    dependencies: 'Direction V2 adapter; project presentation data',
    known_gaps: slug === 'blagoustroystvo-territoriy' ? 'One linked project remains text-only; non-blocking' : ''
  });
}

for (const entry of categoryEntries) {
  const category = entry.data;
  const section = sectionsBySlug.get(category.parentSectionSlug);
  if (!section) throw new Error(`Active category ${category.slug} lost active section ${category.parentSectionSlug}.`);
  const route = `/${section.data.slug}/${category.slug}/`;
  const products = productsByCategory.get(category.slug) || [];
  const gaps = [];
  if (products.length === 0) gaps.push('sparse: no active products; shared honest sparse state');
  if (usableCategoryMedia(category).length === 0) gaps.push('no usable category media; text/graphic fallback');
  add({
    production_route: route,
    page_type: 'catalog-category',
    v2_route_or_pattern: `/design-lab/v2/${section.data.slug}/${category.slug}/`,
    v2_component_template: 'CatalogCategoryV2 via [section]/[category]/index.astro',
    data_source: entry.file,
    media_source: `${entry.file} image/gallery; child product media`,
    canonical_target: route,
    migration_action: 'dynamic-template',
    dependencies: 'Catalog V2 data layer; active section and product associations',
    known_gaps: gaps.join('; ')
  });
}

for (const entry of productEntries) {
  const product = entry.data;
  const category = categoriesBySlug.get(product.productCategorySlug);
  const section = category ? sectionsBySlug.get(category.data.parentSectionSlug) : undefined;
  if (!category || !section) throw new Error(`Active product ${product.slug} lost its category/section.`);
  const route = `/${section.data.slug}/${category.data.slug}/${product.slug}/`;
  add({
    production_route: route,
    page_type: 'catalog-product',
    v2_route_or_pattern: `/design-lab/v2/${section.data.slug}/${category.data.slug}/${product.slug}/`,
    v2_component_template: 'CatalogProductV2 via [section]/[category]/[product]/index.astro',
    data_source: entry.file,
    media_source: `${entry.file} image/gallery`,
    canonical_target: route,
    migration_action: 'dynamic-template',
    dependencies: 'Catalog V2 data layer; category association; related-product resolver',
    known_gaps: usableProductMedia(product).length === 0 ? 'zero-media record; honest zero-media fallback' : ''
  });
}

add({
  production_route: '/vypolnennye-obekty/', page_type: 'projects-archive',
  v2_route_or_pattern: '/design-lab/v2/vypolnennye-obekty/', v2_component_template: 'V2ProjectArchive + V2ProjectsLayout',
  data_source: 'src/content/projects/*.json', media_source: 'project image/gallery through mediaRoleAdapter',
  canonical_target: '/vypolnennye-obekty/', migration_action: 'replace',
  dependencies: 'Active project records; V2-only presentation adapter', known_gaps: 'One active project is text-only; non-blocking'
});
for (const entry of projectEntries) {
  const route = `/vypolnennye-obekty/${entry.data.slug}/`;
  const textOnly = [entry.data.image, ...(entry.data.gallery || [])]
    .filter((item) => item && !isPlaceholder(item)).length === 0;
  add({
    production_route: route, page_type: 'project-detail',
    v2_route_or_pattern: `/design-lab/v2/vypolnennye-obekty/${entry.data.slug}/`,
    v2_component_template: 'V2ProjectDetail via vypolnennye-obekty/[slug]/index.astro',
    data_source: entry.file, media_source: `${entry.file} image/gallery through mediaRoleAdapter`,
    canonical_target: route, migration_action: 'replace',
    dependencies: 'V2 project presentation adapter and fullscreen gallery',
    known_gaps: textOnly ? 'No real public media; text-only state' : ''
  });
}

const practical = [
  {
    production_route: '/o-nas/', page_type: 'about', v2: '/design-lab/v2/o-nas/', component: 'V2CompanyPage + PracticalV2Layout',
    data: `${staticBySlug('o-nas')?.file || 'src/content/static-pages/about.json'}; src/content/site-settings/global.json`,
    media: 'approved finished-result project media through mediaRoleAdapter', gaps: ''
  },
  {
    production_route: '/kontakty/', page_type: 'contacts', v2: '/design-lab/v2/kontakty/', component: 'V2ContactsPage + V2YandexMap',
    data: 'src/pages/kontakty.astro; src/data/yandex.json; src/content/site-settings/global.json',
    media: 'existing Yandex Constructor widget configuration; no new map/media', gaps: ''
  },
  {
    production_route: '/vakansii/', page_type: 'vacancies-archive', v2: '/design-lab/v2/vakansii/', component: 'V2VacanciesArchive + PracticalV2Layout',
    data: `${jobEntries.map((entry) => entry.file).join('; ')}; src/content/site-settings/global.json`,
    media: 'none', gaps: 'Production vacancy detail URL remains an owner/architecture decision outside the 110-route manifest'
  },
  {
    production_route: '/politika-konfidencialnosti/', page_type: 'legal', v2: '/design-lab/v2/politika-konfidencialnosti/', component: 'V2PrivacyPolicy + PracticalV2Layout',
    data: 'src/pages/politika-konfidencialnosti/index.astro', media: 'none', gaps: ''
  }
];
for (const item of practical) add({
  production_route: item.production_route, page_type: item.page_type, v2_route_or_pattern: item.v2,
  v2_component_template: item.component, data_source: item.data, media_source: item.media,
  canonical_target: item.production_route, migration_action: 'replace',
  dependencies: 'V2 shared practical-page shell and current production data', known_gaps: item.gaps
});

add({
  production_route: '/izgotovlenie-na-zakaz/', page_type: 'custom-order',
  v2_route_or_pattern: '/design-lab/v2/izgotovlenie-na-zakaz/',
  v2_component_template: 'CustomOrderV2Page + customOrderV2Data + CatalogV2Layout',
  data_source: `${staticBySlug('custom-order')?.file || 'src/content/static-pages/custom-order.json'}; selected active product/service/project records; site settings`,
  media_source: 'existing approved finished-result project media and assigned catalog renders; V2-only adapter',
  canonical_target: '/izgotovlenie-na-zakaz/', migration_action: 'replace',
  dependencies: 'V2 shared shell; active directions/products/projects; direct contacts'
});

const legacyRows = [
  ['/lavochki-i-skameyki/', '/ulichnaya-mebel/lavochki-i-skameyki/', 'src/pages/lavochki-i-skameyki.astro'],
  ['/urny/', '/ulichnaya-mebel/urny/', 'src/pages/urny.astro'],
  ['/navesy/', '/navesy-i-kozyrki/', 'src/pages/navesy/index.astro']
];
for (const [route, target, source] of legacyRows) add({
  production_route: route, page_type: 'legacy-alias', v2_route_or_pattern: '(no V2 content duplicate)',
  v2_component_template: 'redirect policy only', data_source: source, media_source: 'none',
  canonical_target: target, migration_action: 'redirect',
  dependencies: 'Production routing/deployment layer capable of real HTTP 301',
  known_gaps: route === '/navesy/' ? 'Current production uses indexable self-canonical meta refresh' : 'Current static output includes meta-refresh fallback',
  blocking_status: 'blocked-routing'
});

add({
  production_route: '/404.html', page_type: 'error-document',
  v2_route_or_pattern: '/design-lab/v2/404/', v2_component_template: 'V2NotFoundPage + CatalogV2Layout',
  data_source: 'src/pages/404.astro (copy reference); isolated V2 specimen', media_source: 'none', canonical_target: '',
  migration_action: '404', dependencies: 'Host must serve future production document with real HTTP 404',
  known_gaps: 'Design-lab specimen is a normal static route; future production response status must be configured during migration',
  blocking_status: 'ready-specimen'
});

const htmlFiles = walk(distRoot).filter((file) => file.endsWith('.html'));
const productionRoutes = htmlFiles.map(routeFromHtml)
  .filter((route) => !route.startsWith('/admin/') && !route.startsWith('/design-lab/'))
  .sort();
const manifestRoutes = [...rowsByRoute.keys()].sort();
const missingRows = productionRoutes.filter((route) => !rowsByRoute.has(route));
const extraRows = manifestRoutes.filter((route) => !productionRoutes.includes(route));
if (productionRoutes.length !== 110 || rowsByRoute.size !== 110 || missingRows.length || extraRows.length) {
  throw new Error(JSON.stringify({ productionCount: productionRoutes.length, manifestCount: rowsByRoute.size, missingRows, extraRows }, null, 2));
}

const rows = productionRoutes.map((route) => rowsByRoute.get(route));
const fullAnalogRows = rows.filter((row) => ['replace', 'dynamic-template'].includes(row.migration_action));
for (const row of fullAnalogRows) {
  if (!fs.existsSync(distTarget(row.v2_route_or_pattern))) throw new Error(`Missing built V2 route: ${row.v2_route_or_pattern}`);
  const canonical = canonicalFromHtml(row.v2_route_or_pattern);
  if (canonical !== row.canonical_target) throw new Error(`Canonical mismatch for ${row.v2_route_or_pattern}: ${canonical} != ${row.canonical_target}`);
}
if (canonicalFromHtml('/design-lab/v2/404/')) throw new Error('The isolated V2 404 specimen must not have a canonical.');

const manifestColumns = [
  'production_route', 'page_type', 'v2_route_or_pattern', 'v2_component_template', 'data_source',
  'media_source', 'canonical_target', 'migration_action', 'dependencies', 'known_gaps', 'blocking_status'
];
fs.writeFileSync(path.join(docsRoot, 'v2-production-migration-manifest.csv'), toCsv(manifestColumns, rows), 'utf8');

const matrixRows = rows.map((row) => ({
  production_route: row.production_route,
  page_type: row.page_type,
  v2_route_or_pattern: row.v2_route_or_pattern,
  relationship: ['replace', 'dynamic-template'].includes(row.migration_action) ? 'full-v2-analog'
    : row.migration_action === 'redirect' ? 'redirect-only'
      : 'future-production-404',
  migration_action: row.migration_action,
  canonical_or_target: row.canonical_target,
  blocking_status: row.blocking_status,
  notes: row.known_gaps
}));
matrixRows.push({
  production_route: '(no production route)', page_type: 'vacancy-detail',
  v2_route_or_pattern: '/design-lab/v2/vakansii/svarshchik-metallokonstruktsiy/',
  relationship: 'additional-v2-owner-decision', migration_action: 'owner-decision',
  canonical_or_target: '/vakansii/ (temporary V2 canonical)', blocking_status: 'owner-decision',
  notes: 'Approve whether a public production detail route exists, its URL pattern and canonical; do not count it among 110 production routes.'
});
const matrixColumns = [
  'production_route', 'page_type', 'v2_route_or_pattern', 'relationship', 'migration_action',
  'canonical_or_target', 'blocking_status', 'notes'
];
fs.writeFileSync(path.join(docsRoot, 'public-v2-route-matrix.csv'), toCsv(matrixColumns, matrixRows), 'utf8');

const report = {
  productionRoutes: productionRoutes.length,
  manifestRows: rows.length,
  fullV2Analogs: fullAnalogRows.length,
  replace: rows.filter((row) => row.migration_action === 'replace').length,
  dynamicTemplate: rows.filter((row) => row.migration_action === 'dynamic-template').length,
  redirects: rows.filter((row) => row.migration_action === 'redirect').length,
  future404: rows.filter((row) => row.migration_action === '404').length,
  routeLevelBlocked: rows.filter((row) => row.blocking_status.startsWith('blocked')).length,
  additionalV2OwnerDecisions: 1,
  v2Routes: htmlFiles.map(routeFromHtml).filter((route) => route === '/design-lab/home-v2/' || route.startsWith('/design-lab/v2/')).length
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

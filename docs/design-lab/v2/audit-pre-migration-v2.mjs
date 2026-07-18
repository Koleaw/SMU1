import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const contentRoot = path.join(root, 'src', 'content');

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
const normalizeRoute = (value) => {
  const pathname = new URL(value || '/', 'http://audit.local/').pathname.replace(/\/{2,}/g, '/');
  if (pathname === '/' || path.extname(pathname)) return pathname;
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
};
const routeFromHtml = (file) => {
  const relative = path.relative(distRoot, file).replaceAll('\\', '/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative}`;
};
const distTarget = (route) => {
  const normalized = normalizeRoute(route).replace(/^\//, '');
  if (!normalized) return path.join(distRoot, 'index.html');
  if (normalized.endsWith('/')) return path.join(distRoot, normalized, 'index.html');
  return path.join(distRoot, normalized);
};
const attributes = (tag) => Object.fromEntries(Array.from(tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
  .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? '']));
const openTags = (html, name) => Array.from(html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi')), (match) => match[0]);
const pairedTags = (html, name) => Array.from(html.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'gi')),
  (match) => ({ open: `<${name}${match[1]}>`, inner: match[2] }));
const decodeEntities = (value) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const plainText = (value) => decodeEntities(String(value || '').replace(/<[^>]+>/g, ' '));
const normalizedText = (value) => plainText(value).replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');
const duplicates = (values) => [...values.reduce((map, value) => {
  if (!value) return map;
  map.set(value, (map.get(value) || 0) + 1);
  return map;
}, new Map())].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
const isPlaceholder = (value) => /\/assets\/images\/placeholders\//i.test(String(value || ''));

const allHtmlFiles = walk(distRoot).filter((file) => file.endsWith('.html'));
const allRoutes = allHtmlFiles.map(routeFromHtml);
const productionRoutes = allRoutes.filter((route) => !route.startsWith('/admin/') && !route.startsWith('/design-lab/'));
const v2Files = allHtmlFiles.filter((file) => {
  const route = routeFromHtml(file);
  return route === '/design-lab/home-v2/' || route.startsWith('/design-lab/v2/');
});
const v2Routes = v2Files.map(routeFromHtml);
const productionSet = new Set(productionRoutes);

const sectionEntries = readRecords('product-sections');
const categoryEntries = readRecords('product-categories');
const productEntries = readRecords('products');
const projectEntries = readRecords('projects');
const serviceEntries = readRecords('services');
const jobEntries = readRecords('jobs');
const staticEntries = readRecords('static-pages');
const activeSections = sectionEntries.filter(({ data }) => data.isActive);
const sectionsBySlug = new Map(activeSections.map((entry) => [entry.data.slug, entry]));
const activeCategories = categoryEntries.filter(({ data }) => data.isActive && sectionsBySlug.has(data.parentSectionSlug));
const categoriesBySlug = new Map(activeCategories.map((entry) => [entry.data.slug, entry]));
const activeProducts = productEntries.filter(({ data }) => data.isActive && categoriesBySlug.has(data.productCategorySlug));
const activeProjects = projectEntries.filter(({ data }) => data.isActive);
const activeServices = serviceEntries.filter(({ data }) => data.isActive);
const activeJobs = jobEntries.filter(({ data }) => data.isActive);

const categoryRouteBySlug = new Map(activeCategories.map(({ data }) => [
  data.slug, `/${data.parentSectionSlug}/${data.slug}/`
]));
const productRouteBySlug = new Map(activeProducts.map(({ data }) => {
  const category = categoriesBySlug.get(data.productCategorySlug).data;
  return [data.slug, `/${category.parentSectionSlug}/${category.slug}/${data.slug}/`];
}));
const productionCategorySet = new Set(categoryRouteBySlug.values());
const productionProductSet = new Set(productRouteBySlug.values());
const v2ProductByRoute = new Map(activeProducts.map(({ data }) => {
  const production = productRouteBySlug.get(data.slug);
  return [`/design-lab/v2${production}`, data];
}));

const issues = {
  counts: [], seo: [], emptyH1: [], duplicateIds: [], emptyHrefs: [], brokenLinks: [], brokenAnchors: [],
  productionLinks: [], legacyLinks: [], oldCategoryLinks: [], oldProductLinks: [], brokenMedia: [], externalMedia: [],
  unlabeledControls: [], publicSku: [], relatedProducts: [], dataPreservation: [], specialPages: []
};
const note = (bucket, value) => issues[bucket].push(value);

if (productionRoutes.length !== 110) note('counts', { issue: 'production-route-count', actual: productionRoutes.length, expected: 110 });
if (v2Routes.length !== 108) note('counts', { issue: 'v2-route-count', actual: v2Routes.length, expected: 108 });
if (activeCategories.length !== 20) note('counts', { issue: 'active-category-count', actual: activeCategories.length, expected: 20 });
if (activeProducts.length !== 68) note('counts', { issue: 'active-product-count', actual: activeProducts.length, expected: 68 });
if (duplicates(allRoutes).length) note('counts', { issue: 'duplicate-built-routes', duplicates: duplicates(allRoutes) });

const expectedCanonical = (route) => {
  if (route === '/design-lab/home-v2/') return '/';
  if (route === '/design-lab/v2/404/') return '';
  if (route.startsWith('/design-lab/v2/vakansii/') && route !== '/design-lab/v2/vakansii/') return '/vakansii/';
  return normalizeRoute(route.replace('/design-lab/v2', '') || '/');
};
const legacyTargets = new Set(['/urny/', '/lavochki-i-skameyki/', '/navesy/']);
const allAnchorTargets = [];

for (const file of v2Files) {
  const route = routeFromHtml(file);
  const html = fs.readFileSync(file, 'utf8');
  const text = normalizedText(html);
  const canonicalTag = openTags(html, 'link').find((tag) => attributes(tag).rel?.toLowerCase() === 'canonical');
  const canonical = canonicalTag ? normalizeRoute(new URL(attributes(canonicalTag).href, 'http://audit.local/').pathname) : '';
  const expected = expectedCanonical(route);
  if (canonical !== expected) note('seo', { route, issue: 'canonical', expected, actual: canonical });
  const robotsTag = openTags(html, 'meta').find((tag) => attributes(tag).name?.toLowerCase() === 'robots');
  const robots = robotsTag ? attributes(robotsTag).content.toLowerCase() : '';
  if (!robots.includes('noindex') || !robots.includes('nofollow')) note('seo', { route, issue: 'robots', actual: robots });

  const h1s = pairedTags(html, 'h1').map(({ inner }) => normalizedText(inner)).filter(Boolean);
  if (h1s.length !== 1) note('emptyH1', { route, h1Count: h1s.length, h1s });
  const ids = openTags(html, '[a-z][\\w:-]*').map((tag) => attributes(tag).id).filter(Boolean);
  const repeated = duplicates(ids);
  if (repeated.length) note('duplicateIds', { route, ids: repeated });
  if (text.includes('артикул')) note('publicSku', { route });

  for (const anchor of pairedTags(html, 'a')) {
    const attrs = attributes(anchor.open);
    const href = decodeEntities(attrs.href || '');
    if (!href.trim()) {
      note('emptyHrefs', { route, tag: anchor.open });
      continue;
    }
    const accessibleName = [attrs['aria-label'], plainText(anchor.inner), ...openTags(anchor.inner, 'img').map((tag) => attributes(tag).alt)]
      .map((item) => String(item || '').trim()).filter(Boolean).join(' ');
    if (!accessibleName) note('unlabeledControls', { route, control: 'a', tag: anchor.open });
    if (/^(?:mailto:|tel:|https?:|data:|javascript:)/i.test(href)) continue;
    const resolved = new URL(href, `http://audit.local${route}`);
    const target = normalizeRoute(resolved.pathname);
    allAnchorTargets.push({ source: route, target, hash: resolved.hash });
    if (productionSet.has(target)) note('productionLinks', { source: route, target });
    if (legacyTargets.has(target)) note('legacyLinks', { source: route, target });
    if (productionCategorySet.has(target)) note('oldCategoryLinks', { source: route, target });
    if (productionProductSet.has(target)) note('oldProductLinks', { source: route, target });
    if (!fs.existsSync(distTarget(target))) {
      note('brokenLinks', { source: route, target });
      continue;
    }
    if (resolved.hash) {
      const id = decodeURIComponent(resolved.hash.slice(1));
      const targetHtml = fs.readFileSync(distTarget(target), 'utf8');
      const targetIds = new Set(openTags(targetHtml, '[a-z][\\w:-]*').map((tag) => attributes(tag).id).filter(Boolean));
      if (!id || !targetIds.has(id)) note('brokenAnchors', { source: route, target, hash: resolved.hash });
    }
  }

  for (const button of pairedTags(html, 'button')) {
    const attrs = attributes(button.open);
    const name = [attrs['aria-label'], attrs['aria-labelledby'], plainText(button.inner)].map((item) => String(item || '').trim()).filter(Boolean).join(' ');
    if (!name) note('unlabeledControls', { route, control: 'button', tag: button.open });
  }

  const mediaCandidates = [
    ...openTags(html, 'img').map((tag) => ({ tag: 'img', src: attributes(tag).src })),
    ...openTags(html, 'source').flatMap((tag) => {
      const attrs = attributes(tag);
      const value = attrs.src || attrs.srcset?.split(',')[0]?.trim().split(/\s+/)[0];
      return value ? [{ tag: 'source', src: value }] : [];
    }),
    ...openTags(html, 'video').flatMap((tag) => attributes(tag).poster ? [{ tag: 'video-poster', src: attributes(tag).poster }] : [])
  ];
  for (const media of mediaCandidates) {
    const src = decodeEntities(media.src || '');
    if (!src || src.startsWith('data:')) continue;
    const url = new URL(src, `http://audit.local${route}`);
    if (url.origin !== 'http://audit.local') {
      note('externalMedia', { route, tag: media.tag, src });
      continue;
    }
    const target = url.pathname;
    if (!fs.existsSync(path.join(distRoot, target.replace(/^\//, '')))) note('brokenMedia', { route, tag: media.tag, src: target });
  }

  const currentProduct = v2ProductByRoute.get(route);
  if (currentProduct) {
    const currentCategory = categoriesBySlug.get(currentProduct.productCategorySlug)?.data;
    const allowedManual = new Set(currentProduct.relatedProductSlugs || []);
    for (const anchor of pairedTags(html, 'a')) {
      const attrs = attributes(anchor.open);
      if (!/\bv2-product-card\b/.test(attrs.class || '')) continue;
      const target = normalizeRoute(new URL(decodeEntities(attrs.href || ''), `http://audit.local${route}`).pathname);
      const related = v2ProductByRoute.get(target);
      if (!related || related.slug === currentProduct.slug) {
        note('relatedProducts', { route, target, issue: !related ? 'inactive-or-unknown' : 'current-product' });
      } else if (related.productCategorySlug !== currentCategory?.slug && !allowedManual.has(related.slug)) {
        note('relatedProducts', { route, target, issue: 'unapproved-cross-category' });
      }
    }
  }
}

const sitemapFiles = walk(distRoot).filter((file) => /sitemap.*\.xml$/i.test(path.basename(file)));
if (sitemapFiles.some((file) => fs.readFileSync(file, 'utf8').includes('/design-lab/'))) {
  note('seo', { issue: 'design-lab-in-sitemap' });
}

const pageText = (route) => normalizedText(fs.readFileSync(distTarget(route), 'utf8'));
const mustContain = (route, value, field, source) => {
  const expected = normalizedText(value);
  if (expected && !pageText(route).includes(expected)) note('dataPreservation', { route, field, source, value });
};
const mustContainAny = (route, values, field, source) => {
  const normalized = values.map(normalizedText).filter(Boolean);
  if (normalized.length && !normalized.some((item) => pageText(route).includes(item))) {
    note('dataPreservation', { route, field, source, values });
  }
};
const mustContainAnyDocument = (route, values, field, source) => {
  const document = decodeEntities(fs.readFileSync(distTarget(route), 'utf8')).replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  const normalized = values.map((value) => decodeEntities(String(value || '')).replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru')).filter(Boolean);
  if (normalized.length && !normalized.some((item) => document.includes(item))) {
    note('dataPreservation', { route, field, source, values });
  }
};

for (const { file, data } of activeSections) {
  const route = `/design-lab/v2/${data.slug}/`;
  mustContainAny(route, [data.title, data.heroTitle], 'section-title', file);
  mustContainAnyDocument(route, [data.heroDescription, data.shortDescription, data.seoDescription], 'section-description', file);
  for (const { data: category } of activeCategories.filter((entry) => entry.data.parentSectionSlug === data.slug)) {
    const href = `/design-lab/v2${categoryRouteBySlug.get(category.slug)}`;
    if (!allAnchorTargets.some((link) => link.source === route && link.target === href)) {
      note('dataPreservation', { route, field: 'active-category-link', source: file, value: href });
    }
  }
}
for (const { file, data } of activeServices) {
  const route = `/design-lab/v2/${data.slug}/`;
  mustContainAny(route, [data.title, data.heroTitle], 'service-title', file);
  mustContainAnyDocument(route, [data.heroDescription, data.shortDescription, data.seoDescription], 'service-description', file);
}
for (const { file, data } of activeCategories) {
  const production = categoryRouteBySlug.get(data.slug);
  const route = `/design-lab/v2${production}`;
  mustContainAny(route, [data.title, data.heroTitle], 'category-title', file);
  mustContainAny(route, [data.heroDescription, data.shortDescription], 'category-description', file);
  const visibleProducts = activeProducts.filter((entry) => entry.data.productCategorySlug === data.slug && entry.data.showInCatalog !== false);
  for (const { data: product } of visibleProducts) {
    const href = `/design-lab/v2${productRouteBySlug.get(product.slug)}`;
    if (!allAnchorTargets.some((link) => link.source === route && link.target === href)) {
      note('dataPreservation', { route, field: 'active-product-link', source: file, value: href });
    }
  }
}
for (const { file, data } of activeProducts) {
  const route = `/design-lab/v2${productRouteBySlug.get(data.slug)}`;
  mustContain(route, data.title, 'product-title', file);
  mustContainAny(route, [data.leadText, data.shortDescription], 'product-summary', file);
  for (const paragraph of String(data.description || data.leadText || data.shortDescription || '').split(/\n{2,}/)) {
    mustContain(route, paragraph, 'product-description', file);
  }
  for (const field of ['features', 'materials', 'colors', 'customizationItems']) {
    for (const item of data[field] || []) mustContain(route, item, field, file);
  }
  for (const item of (data.dimensions || []).filter((item) => item.isActive !== false)) {
    mustContain(route, item.value, 'dimensions', file);
  }
  if (data.showDeliveryBlock !== false && data.deliveryText?.trim()) mustContain(route, data.deliveryText, 'delivery', file);
  const text = pageText(route);
  if (data.priceMode === 'on_request' && !text.includes('цена по запросу')) note('dataPreservation', { route, field: 'price-mode', source: file });
  if (data.priceMode === 'from' && typeof data.priceFrom === 'number') {
    const digits = String(data.priceFrom);
    if (!text.replace(/\s/g, '').includes(digits)) note('dataPreservation', { route, field: 'price', source: file, value: data.priceFrom });
  }
  const expectedMedia = [data.image, ...(data.gallery || [])]
    .map((item) => String(item || '').trim()).filter((item) => item && !isPlaceholder(item));
  const html = fs.readFileSync(distTarget(route), 'utf8');
  for (const media of expectedMedia) {
    if (!decodeEntities(html).includes(media)) note('dataPreservation', { route, field: 'gallery-media', source: file, value: media });
  }
}

const projectArchiveRoute = '/design-lab/v2/vypolnennye-obekty/';
for (const { file, data } of activeProjects) {
  mustContain(projectArchiveRoute, data.title, 'project-archive-title', file);
  const route = `${projectArchiveRoute}${data.slug}/`;
  mustContain(route, data.title, 'project-title', file);
  mustContain(route, data.shortDescription, 'project-summary', file);
  mustContain(route, data.whatWasDone, 'project-result', file);
}

const settings = JSON.parse(fs.readFileSync(path.join(contentRoot, 'site-settings', 'global.json'), 'utf8'));
for (const value of [settings.phonePrimary, settings.phoneSecondary, settings.email, settings.address]) {
  mustContain('/design-lab/v2/kontakty/', value, 'contacts', 'src/content/site-settings/global.json');
}
for (const value of [settings.inn, settings.kpp, settings.ogrn, settings.legalAddress]) {
  mustContain('/design-lab/v2/o-nas/', value, 'requisites', 'src/content/site-settings/global.json');
}
const contactsHtml = fs.readFileSync(distTarget('/design-lab/v2/kontakty/'), 'utf8');
for (const href of [
  `tel:${settings.phonePrimary.replace(/[^+\d]/g, '')}`,
  `tel:${settings.phoneSecondary.replace(/[^+\d]/g, '')}`,
  `mailto:${settings.email}`,
  settings.telegram
]) {
  if (!decodeEntities(contactsHtml).includes(href)) note('specialPages', { route: '/design-lab/v2/kontakty/', issue: 'contact-scheme', href });
}
const yandex = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'yandex.json'), 'utf8'));
if (!decodeEntities(contactsHtml).includes(yandex.map.constructorSrc)) note('specialPages', { route: '/design-lab/v2/kontakty/', issue: 'map-source' });
if (!/title="[^"]+"/i.test(contactsHtml.match(/<iframe\b[^>]*>/i)?.[0] || '') && !/data-v2-yandex-map/i.test(contactsHtml)) {
  note('specialPages', { route: '/design-lab/v2/kontakty/', issue: 'map-accessible-title' });
}

for (const { file, data } of activeJobs) {
  mustContain('/design-lab/v2/vakansii/', data.title, 'vacancy-archive-title', file);
  const route = `/design-lab/v2/vakansii/${data.slug}/`;
  for (const value of [data.title, data.city, data.employmentType, data.salary, data.shortDescription]) mustContain(route, value, 'vacancy-field', file);
  for (const field of ['responsibilities', 'requirements', 'conditions']) {
    for (const item of data[field] || []) mustContain(route, item, field, file);
  }
}

const privacyAdapter = fs.readFileSync(path.join(root, 'src', 'components', 'design-lab', 'v2', 'practical', 'V2PrivacyPolicy.astro'), 'utf8');
if (!privacyAdapter.includes("politika-konfidencialnosti/index.astro?raw") || !privacyAdapter.includes('set:html={policyMarkup}')) {
  note('specialPages', { route: '/design-lab/v2/politika-konfidencialnosti/', issue: 'privacy-not-derived-from-production-source' });
}
const customHtml = fs.readFileSync(distTarget('/design-lab/v2/izgotovlenie-na-zakaz/'), 'utf8');
if (!normalizedText(customHtml).includes('изготовление под задачу объекта')) note('specialPages', { route: '/design-lab/v2/izgotovlenie-na-zakaz/', issue: 'custom-h1' });
const customDirections = [
  '/design-lab/v2/ulichnaya-mebel/', '/design-lab/v2/ograzhdeniya-i-zabory/', '/design-lab/v2/navesy-i-kozyrki/',
  '/design-lab/v2/metallokonstruktsii-dlya-biznesa/', '/design-lab/v2/topiarii/',
  '/design-lab/v2/blagoustroystvo-territoriy/', '/design-lab/v2/stroitelstvo-i-remonty/'
];
for (const target of customDirections) {
  if (!allAnchorTargets.some((link) => link.source === '/design-lab/v2/izgotovlenie-na-zakaz/' && link.target === target)) {
    note('specialPages', { route: '/design-lab/v2/izgotovlenie-na-zakaz/', issue: 'missing-direction-link', target });
  }
}
const customProductionLinks = allAnchorTargets.filter((link) => link.target === '/izgotovlenie-na-zakaz/');
if (customProductionLinks.length) note('specialPages', { issue: 'v2-custom-order-production-links', links: customProductionLinks });

const notFoundHtml = fs.readFileSync(distTarget('/design-lab/v2/404/'), 'utf8');
if (!normalizedText(notFoundHtml).includes('страница не найдена')) note('specialPages', { route: '/design-lab/v2/404/', issue: '404-h1' });
if (openTags(notFoundHtml, 'link').some((tag) => attributes(tag).rel?.toLowerCase() === 'canonical')) {
  note('specialPages', { route: '/design-lab/v2/404/', issue: '404-has-canonical' });
}

const homeRecord = staticEntries.find(({ data }) => data.slug === 'home')?.data;
const homeHtml = decodeEntities(fs.readFileSync(distTarget('/design-lab/home-v2/'), 'utf8'));
for (const field of ['heroMediaVideo', 'heroMediaVideoMobile', 'heroMediaPoster', 'heroMediaPosterMobile']) {
  const value = homeRecord?.[field];
  if (value && !homeHtml.includes(value)) note('dataPreservation', { route: '/design-lab/home-v2/', field, value });
}

const report = {
  counts: {
    productionRoutes: productionRoutes.length,
    v2Routes: v2Routes.length,
    fullProductionAnalogs: new Set(v2Files.map((file) => expectedCanonical(routeFromHtml(file))).filter((route) => productionSet.has(route))).size,
    activeCategories: activeCategories.length,
    activeProducts: activeProducts.length,
    checkedV2Pages: v2Files.length
  },
  checks: Object.fromEntries(Object.entries(issues).map(([key, values]) => [key, { count: values.length, items: values }])),
  sitemapIncludesDesignLab: sitemapFiles.some((file) => fs.readFileSync(file, 'utf8').includes('/design-lab/')),
  expectedDecisions: {
    legacyRedirects: ['/lavochki-i-skameyki/', '/urny/', '/navesy/'],
    vacancyDetail: '/design-lab/v2/vakansii/svarshchik-metallokonstruktsiy/'
  }
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
const failures = Object.values(issues).flat();
if (failures.length || report.sitemapIncludesDesignLab) process.exitCode = 1;

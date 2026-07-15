import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const contentRoot = path.join(root, 'src', 'content');

const normalizePath = (value) => {
  const pathname = new URL(value || '/', 'http://audit.local/').pathname.replace(/\/{2,}/g, '/');
  if (pathname === '/') return '/';
  return pathname.endsWith('/') || path.extname(pathname) ? pathname : `${pathname}/`;
};

const readRecords = (collection) => fs.readdirSync(path.join(contentRoot, collection))
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({
    file: path.join('src', 'content', collection, name).replaceAll('\\', '/'),
    data: JSON.parse(fs.readFileSync(path.join(contentRoot, collection, name), 'utf8'))
  }));

const walk = (directory, extension = '') => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target, extension);
    return !extension || entry.name.endsWith(extension) ? [target] : [];
  });
};

const routeFromHtml = (file) => {
  const relative = path.relative(distRoot, file).replaceAll('\\', '/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative}`;
};

const distTarget = (route) => {
  const normalized = normalizePath(route).replace(/^\//, '');
  if (!normalized) return path.join(distRoot, 'index.html');
  if (normalized.endsWith('/')) return path.join(distRoot, normalized, 'index.html');
  return path.join(distRoot, normalized);
};

const attributes = (tag) => Object.fromEntries(Array.from(tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
  .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? '']));
const tags = (html, name) => Array.from(html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi')), (match) => match[0]);
const anchors = (html) => tags(html, 'a').map((tag) => ({ tag, attrs: attributes(tag) }));
const localPath = (href) => {
  if (!href || /^(?:#|mailto:|tel:|javascript:)/i.test(href)) return '';
  const url = new URL(href.replaceAll('&amp;', '&'), 'http://audit.local/');
  if (url.origin !== 'http://audit.local') return '';
  return normalizePath(url.pathname);
};
const duplicates = (values) => Array.from(values.reduce((groups, value) => {
  const key = String(value || '').trim();
  if (!key) return groups;
  groups.set(key, (groups.get(key) || 0) + 1);
  return groups;
}, new Map())).filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));

const sectionEntries = readRecords('product-sections');
const categoryEntries = readRecords('product-categories');
const productEntries = readRecords('products');
const sections = sectionEntries.filter(({ data }) => data.isActive);
const sectionsBySlug = new Map(sections.map((entry) => [entry.data.slug, entry]));
const categories = categoryEntries.filter(({ data }) => data.isActive && sectionsBySlug.has(data.parentSectionSlug));
const categoriesBySlug = new Map(categories.map((entry) => [entry.data.slug, entry]));
const products = productEntries.filter(({ data }) => data.isActive);

const dataGaps = {
  categoriesWithoutActiveSection: categoryEntries
    .filter(({ data }) => data.isActive && !sectionsBySlug.has(data.parentSectionSlug))
    .map(({ file, data }) => ({ file, slug: data.slug, parentSectionSlug: data.parentSectionSlug })),
  productsWithoutActiveCategory: products
    .filter(({ data }) => !categoriesBySlug.has(data.productCategorySlug))
    .map(({ file, data }) => ({ file, slug: data.slug, productCategorySlug: data.productCategorySlug }))
};

const routedProducts = products.flatMap((entry) => {
  const category = categoriesBySlug.get(entry.data.productCategorySlug);
  const section = category ? sectionsBySlug.get(category.data.parentSectionSlug) : undefined;
  return category && section ? [{ entry, category, section }] : [];
});

const expectedCategories = categories.map(({ data }) => ({
  slug: data.slug,
  production: `/${data.parentSectionSlug}/${data.slug}/`,
  v2: `/design-lab/v2/${data.parentSectionSlug}/${data.slug}/`
}));
const expectedProducts = routedProducts.map(({ entry, category, section }) => ({
  slug: entry.data.slug,
  active: entry.data.isActive,
  visible: entry.data.showInCatalog !== false,
  production: `/${section.data.slug}/${category.data.slug}/${entry.data.slug}/`,
  v2: `/design-lab/v2/${section.data.slug}/${category.data.slug}/${entry.data.slug}/`
}));

const allHtmlFiles = walk(distRoot, '.html');
const allBuiltRoutes = allHtmlFiles.map(routeFromHtml);
const productSectionSlugs = new Set(sections.map(({ data }) => data.slug));
const generatedCategoryRoutes = allBuiltRoutes.filter((route) => {
  const parts = route.split('/').filter(Boolean);
  return parts.length === 4 && parts[0] === 'design-lab' && parts[1] === 'v2' && productSectionSlugs.has(parts[2]);
});
const generatedProductRoutes = allBuiltRoutes.filter((route) => {
  const parts = route.split('/').filter(Boolean);
  return parts.length === 5 && parts[0] === 'design-lab' && parts[1] === 'v2' && productSectionSlugs.has(parts[2]);
});

const expectedCategorySet = new Set(expectedCategories.map((item) => item.v2));
const expectedProductSet = new Set(expectedProducts.map((item) => item.v2));
const generatedCategorySet = new Set(generatedCategoryRoutes);
const generatedProductSet = new Set(generatedProductRoutes);
const productionCategorySet = new Set(expectedCategories.map((item) => item.production));
const productionProductSet = new Set(expectedProducts.map((item) => item.production));

const catalogRoutes = [...expectedCategories, ...expectedProducts];
const pageIssues = [];
const brokenMedia = [];
const placeholderMedia = [];
const duplicateIds = [];
for (const item of catalogRoutes) {
  const file = distTarget(item.v2);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() || '';
  const canonicalTag = tags(html, 'link').find((tag) => attributes(tag).rel?.toLowerCase() === 'canonical');
  const canonical = canonicalTag ? normalizePath(new URL(attributes(canonicalTag).href, 'http://audit.local/').pathname) : '';
  const robotsTag = tags(html, 'meta').find((tag) => attributes(tag).name?.toLowerCase() === 'robots');
  const robots = robotsTag ? attributes(robotsTag).content.toLowerCase() : '';
  if (!h1) pageIssues.push({ route: item.v2, issue: 'empty-h1' });
  if (canonical !== item.production) pageIssues.push({ route: item.v2, issue: 'broken-canonical', expected: item.production, actual: canonical });
  if (!robots.includes('noindex') || !robots.includes('nofollow')) pageIssues.push({ route: item.v2, issue: 'robots', actual: robots });
  if (/>\s*Артикул\s*</i.test(html)) pageIssues.push({ route: item.v2, issue: 'public-sku' });

  const ids = tags(html, '[a-z][\\w:-]*').map((tag) => attributes(tag).id).filter(Boolean);
  const repeatedIds = duplicates(ids);
  if (repeatedIds.length) duplicateIds.push({ route: item.v2, ids: repeatedIds });

  for (const imageTag of tags(html, 'img')) {
    const src = attributes(imageTag).src || '';
    const mediaPath = localPath(src);
    if (!mediaPath) continue;
    if (mediaPath.includes('/assets/images/placeholders/')) placeholderMedia.push({ route: item.v2, src: mediaPath });
    if (!fs.existsSync(path.join(distRoot, mediaPath.replace(/^\//, '')))) brokenMedia.push({ route: item.v2, src: mediaPath });
  }
}

const v2HtmlFiles = allHtmlFiles.filter((file) => {
  const route = routeFromHtml(file);
  return route === '/design-lab/home-v2/' || route.startsWith('/design-lab/v2/');
});
const oldCategoryLinks = [];
const oldProductLinks = [];
const cardProductionLinks = [];
const inactiveProductCards = [];
const emptyHrefs = [];
const brokenInternalLinks = [];

for (const file of v2HtmlFiles) {
  const sourceRoute = routeFromHtml(file);
  const html = fs.readFileSync(file, 'utf8');
  for (const anchor of anchors(html)) {
    const href = anchor.attrs.href ?? '';
    if (!href.trim()) {
      emptyHrefs.push({ source: sourceRoute, tag: anchor.tag });
      continue;
    }
    const target = localPath(href);
    if (!target) continue;
    if (productionCategorySet.has(target)) oldCategoryLinks.push({ source: sourceRoute, target });
    if (productionProductSet.has(target)) oldProductLinks.push({ source: sourceRoute, target });
    if (/\bv2-(?:category|product)-card\b/.test(anchor.attrs.class || '') && (productionCategorySet.has(target) || productionProductSet.has(target))) {
      cardProductionLinks.push({ source: sourceRoute, target });
    }
    if (/\bv2-product-card\b/.test(anchor.attrs.class || '') && target.startsWith('/design-lab/v2/') && !expectedProductSet.has(target)) {
      inactiveProductCards.push({ source: sourceRoute, target });
    }
    if (target.startsWith('/assets/') || target.startsWith('/uploads/') || target.startsWith('/_astro/')) continue;
    if (!fs.existsSync(distTarget(target))) brokenInternalLinks.push({ source: sourceRoute, target });
  }
}

const publicProductionRoutes = allBuiltRoutes.filter((route) => (
  !route.startsWith('/admin/') && !route.startsWith('/design-lab/')
));
const v2Routes = allBuiltRoutes.filter((route) => route === '/design-lab/home-v2/' || route.startsWith('/design-lab/v2/'));
const canonicalCoverage = new Set(v2HtmlFiles.flatMap((file) => {
  const html = fs.readFileSync(file, 'utf8');
  const tag = tags(html, 'link').find((candidate) => attributes(candidate).rel?.toLowerCase() === 'canonical');
  return tag?.length ? [normalizePath(new URL(attributes(tag).href, 'http://audit.local/').pathname)] : [];
}));
const productionWithoutV2 = publicProductionRoutes.filter((route) => !canonicalCoverage.has(route));
const sitemapFiles = walk(distRoot).filter((file) => /sitemap.*\.xml$/i.test(path.basename(file)));
const sitemapIncludesDesignLab = sitemapFiles.some((file) => fs.readFileSync(file, 'utf8').includes('/design-lab/'));

const report = {
  counts: {
    activeSections: sections.length,
    activeCategories: categories.length,
    activeProducts: routedProducts.length,
    generatedV2CategoryRoutes: generatedCategoryRoutes.length,
    generatedV2ProductRoutes: generatedProductRoutes.length,
    publicProductionRoutes: publicProductionRoutes.length,
    v2Routes: v2Routes.length,
    productionWithoutV2: productionWithoutV2.length
  },
  coverage: {
    missingCategories: expectedCategories.filter((item) => !generatedCategorySet.has(item.v2)).map((item) => item.v2),
    extraCategories: generatedCategoryRoutes.filter((route) => !expectedCategorySet.has(route)),
    missingProducts: expectedProducts.filter((item) => !generatedProductSet.has(item.v2)).map((item) => item.v2),
    extraProducts: generatedProductRoutes.filter((route) => !expectedProductSet.has(route))
  },
  duplicates: {
    categorySlugs: duplicates(categories.map(({ data }) => data.slug)),
    productSlugs: duplicates(routedProducts.map(({ entry }) => entry.data.slug)),
    categoryRoutes: duplicates(expectedCategories.map((item) => item.v2)),
    productRoutes: duplicates(expectedProducts.map((item) => item.v2))
  },
  dataGaps,
  pageIssues,
  linkIssues: {
    oldCategoryLinks,
    oldProductLinks,
    cardProductionLinks,
    inactiveProductCards,
    emptyHrefs,
    brokenInternalLinks
  },
  mediaIssues: { brokenMedia, placeholderMedia },
  duplicateIds,
  sitemapIncludesDesignLab,
  productionWithoutV2
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

const failures = [
  ...Object.values(report.coverage),
  ...Object.values(report.duplicates),
  ...Object.values(report.dataGaps),
  report.pageIssues,
  ...Object.values(report.linkIssues),
  ...Object.values(report.mediaIssues),
  report.duplicateIds
].flat();
if (failures.length > 0 || sitemapIncludesDesignLab) process.exitCode = 1;

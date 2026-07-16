import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const contentRoot = path.join(root, 'src', 'content');
const docsRoot = path.join(root, 'docs', 'migration');
const checkpoint = process.env.V2_CHECKPOINT || '0d5fc8f';

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
});
const records = (collection) => fs.readdirSync(path.join(contentRoot, collection))
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ file: `src/content/${collection}/${name}`, data: JSON.parse(fs.readFileSync(path.join(contentRoot, collection, name), 'utf8')) }));
const decode = (value) => String(value || '')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const text = (value) => decode(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const normalizedText = (value) => text(value).toLocaleLowerCase('ru');
const attrs = (tag) => Object.fromEntries(Array.from(tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
  .map((match) => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? '')]));
const openTags = (html, name) => Array.from(html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi')), (match) => match[0]);
const pairedTags = (html, name) => Array.from(html.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'gi')),
  (match) => ({ open: `<${name}${match[1]}>`, inner: match[2] }));
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
const htmlTarget = (route) => {
  const relative = normalizeRoute(route).replace(/^\//, '');
  if (!relative) return path.join(distRoot, 'index.html');
  if (relative.endsWith('/')) return path.join(distRoot, relative, 'index.html');
  return path.join(distRoot, relative);
};
const csv = (rows) => rows.map((row) => row.map((value) => {
  const string = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}).join(',')).join('\n') + '\n';
const duplicates = (values) => [...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map())]
  .filter(([, count]) => count > 1);
const contains = (html, value) => !String(value || '').trim() || normalizedText(html).includes(normalizedText(value));

if (!fs.existsSync(distRoot)) throw new Error('dist is missing; run npm run build first.');
fs.mkdirSync(docsRoot, { recursive: true });

const sections = records('product-sections').filter(({ data }) => data.isActive);
const sectionBySlug = new Map(sections.map((entry) => [entry.data.slug, entry]));
const services = records('services').filter(({ data }) => data.isActive);
const categories = records('product-categories').filter(({ data }) => data.isActive && sectionBySlug.has(data.parentSectionSlug));
const categoryBySlug = new Map(categories.map((entry) => [entry.data.slug, entry]));
const products = records('products').filter(({ data }) => data.isActive && categoryBySlug.has(data.productCategorySlug));
const projects = records('projects').filter(({ data }) => data.isActive);
const jobs = records('jobs').filter(({ data }) => data.isActive);

const expectedCanonical = [
  { route: '/', type: 'home' },
  ...sections.map(({ data }) => ({ route: `/${data.slug}/`, type: 'direction' })),
  ...services.map(({ data }) => ({ route: `/${data.slug}/`, type: 'direction' })),
  ...categories.map(({ data }) => ({ route: `/${data.parentSectionSlug}/${data.slug}/`, type: 'category' })),
  ...products.map(({ data }) => {
    const category = categoryBySlug.get(data.productCategorySlug).data;
    return { route: `/${category.parentSectionSlug}/${category.slug}/${data.slug}/`, type: 'product' };
  }),
  { route: '/vypolnennye-obekty/', type: 'projects-archive' },
  ...projects.map(({ data }) => ({ route: `/vypolnennye-obekty/${data.slug}/`, type: 'project' })),
  { route: '/o-nas/', type: 'company' },
  { route: '/kontakty/', type: 'contacts' },
  { route: '/vakansii/', type: 'vacancies' },
  ...jobs.map(({ data }) => ({ route: `/vakansii/${data.slug}/`, type: 'vacancy' })),
  { route: '/politika-konfidencialnosti/', type: 'privacy' },
  { route: '/izgotovlenie-na-zakaz/', type: 'custom-order' }
].map((item) => ({ ...item, expectedCanonical: item.route, expectedRobots: 'index, follow' }));
const aliases = [
  { route: '/lavochki-i-skameyki/', type: 'legacy', expectedCanonical: '/ulichnaya-mebel/lavochki-i-skameyki/', expectedRobots: 'noindex, nofollow' },
  { route: '/urny/', type: 'legacy', expectedCanonical: '/ulichnaya-mebel/urny/', expectedRobots: 'noindex, nofollow' },
  { route: '/navesy/', type: 'legacy', expectedCanonical: '/navesy-i-kozyrki/', expectedRobots: 'noindex, nofollow' }
];
const notFound = { route: '/404.html', type: '404', expectedCanonical: '', expectedRobots: 'noindex, nofollow' };
const expectedRoutes = [...expectedCanonical, ...aliases, notFound];
const expectedSet = new Set(expectedRoutes.map(({ route }) => route));
const categorySet = new Set(expectedCanonical.filter(({ type }) => type === 'category').map(({ route }) => route));
const productSet = new Set(expectedCanonical.filter(({ type }) => type === 'product').map(({ route }) => route));
const aliasSet = new Set(aliases.map(({ route }) => route));

const htmlFiles = walk(distRoot).filter((file) => file.endsWith('.html'));
const allRoutes = htmlFiles.map(routeFromHtml);
const productionRoutes = allRoutes.filter((route) => !route.startsWith('/admin/') && !route.startsWith('/design-lab/'));
const productionSet = new Set(productionRoutes);
const designLabV2Routes = allRoutes.filter((route) => route === '/design-lab/home-v2/' || route.startsWith('/design-lab/v2/'));
const issues = [];
const routeRows = [['route', 'type', 'html_exists', 'canonical', 'canonical_ok', 'robots', 'robots_ok', 'h1_count', 'h1', 'v2_shell', 'design_lab_links', 'duplicate_ids', 'broken_media', 'status', 'notes']];
const linkRows = [['source_route', 'href', 'resolved_target', 'target_exists', 'anchor_exists', 'kind', 'status', 'issue']];

if (expectedCanonical.length !== 107) issues.push(`canonical-route-count:${expectedCanonical.length}:expected-107`);
if (productionRoutes.length !== 111) issues.push(`production-route-count:${productionRoutes.length}:expected-111`);
if (htmlFiles.length !== 227) issues.push(`build-page-count:${htmlFiles.length}:expected-227`);
if (designLabV2Routes.length !== 108) issues.push(`design-lab-v2-route-count:${designLabV2Routes.length}:expected-108`);
if (categories.length !== 20) issues.push(`category-count:${categories.length}:expected-20`);
if (products.length !== 68) issues.push(`product-count:${products.length}:expected-68`);
if (projects.length !== 4) issues.push(`project-count:${projects.length}:expected-4`);
if (sections.length + services.length !== 7) issues.push(`direction-count:${sections.length + services.length}:expected-7`);
for (const [route, count] of duplicates(allRoutes)) issues.push(`duplicate-route:${route}:${count}`);
for (const route of expectedSet) if (!productionSet.has(route)) issues.push(`missing-route:${route}`);
for (const route of productionSet) if (!expectedSet.has(route)) issues.push(`unexpected-production-route:${route}`);

for (const route of designLabV2Routes) {
  const html = fs.readFileSync(htmlTarget(route), 'utf8');
  const robotsTag = openTags(html, 'meta').find((tag) => attrs(tag).name?.toLowerCase() === 'robots');
  const robots = robotsTag ? attrs(robotsTag).content.toLowerCase() : '';
  if (!robots.includes('noindex') || !robots.includes('nofollow')) issues.push(`${route}:design-lab-robots`);
  const canonicalTag = openTags(html, 'link').find((tag) => attrs(tag).rel?.toLowerCase() === 'canonical');
  const canonical = canonicalTag ? normalizeRoute(new URL(attrs(canonicalTag).href, 'http://audit.local/').pathname) : '';
  const expected = route === '/design-lab/home-v2/'
    ? '/'
    : route === '/design-lab/v2/404/'
      ? ''
      : normalizeRoute(route.replace('/design-lab/v2', ''));
  if (canonical !== expected) issues.push(`${route}:design-lab-canonical:${canonical || '(missing)'}:expected:${expected || '(none)'}`);
  for (const anchor of pairedTags(html, 'a')) {
    const href = (attrs(anchor.open).href || '').trim();
    if (!href || /^(?:#|[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
    const target = normalizeRoute(new URL(href, `http://audit.local${route}`).pathname);
    if (!target.startsWith('/design-lab/')) issues.push(`${route}:design-lab-to-production:${target}`);
  }
}

const pageIds = new Map();
for (const expected of expectedRoutes) {
  const file = htmlTarget(expected.route);
  const exists = fs.existsSync(file);
  const pageIssues = [];
  let canonical = '';
  let robots = '';
  let h1s = [];
  let hasV2Shell = false;
  let designLabLinks = 0;
  let duplicateIds = [];
  let brokenMedia = 0;

  if (!exists) {
    pageIssues.push('missing-html');
  } else {
    const html = fs.readFileSync(file, 'utf8');
    const canonicalTag = openTags(html, 'link').find((tag) => attrs(tag).rel?.toLowerCase() === 'canonical');
    canonical = canonicalTag ? normalizeRoute(new URL(attrs(canonicalTag).href, 'http://audit.local/').pathname) : '';
    const robotsTag = openTags(html, 'meta').find((tag) => attrs(tag).name?.toLowerCase() === 'robots');
    robots = robotsTag ? attrs(robotsTag).content.toLowerCase().replace(/\s+/g, ' ').trim() : '';
    if (canonical !== expected.expectedCanonical) pageIssues.push(`canonical:${canonical || '(missing)'}`);
    const expectedTokens = expected.expectedRobots.split(',').map((item) => item.trim());
    if (!expectedTokens.every((token) => robots.includes(token))) pageIssues.push(`robots:${robots || '(missing)'}`);
    if (expected.type !== 'legacy' && expected.type !== '404' && (robots.includes('noindex') || robots.includes('nofollow'))) pageIssues.push('canonical-page-noindex');

    h1s = pairedTags(html, 'h1').map(({ inner }) => text(inner)).filter(Boolean);
    if (h1s.length !== 1) pageIssues.push(`h1-count:${h1s.length}`);
    const ids = openTags(html, '[a-z][\\w:-]*').map((tag) => attrs(tag).id).filter(Boolean);
    pageIds.set(expected.route, new Set(ids));
    duplicateIds = duplicates(ids);
    if (duplicateIds.length) pageIssues.push(`duplicate-ids:${duplicateIds.map(([id]) => id).join('|')}`);

    hasV2Shell = html.includes('data-home-v2-root') || html.includes('data-catalog-v2-root');
    if (!hasV2Shell) pageIssues.push('missing-v2-shell');
    designLabLinks = openTags(html, 'a').filter((tag) => /\/design-lab\//.test(attrs(tag).href || '')).length;
    if (designLabLinks) pageIssues.push(`design-lab-links:${designLabLinks}`);
    if (/\bГлавная V2\b/i.test(text(html))) pageIssues.push('v2-label');
    if (/\bАртикул\s*:/i.test(text(html))) pageIssues.push('public-sku');
    if (expected.type !== 'legacy' && html.includes('data-home-v2-palette-switch')) pageIssues.push('production-palette-switch');
    if (expected.type === 'legacy') {
      const refresh = openTags(html, 'meta').find((tag) => attrs(tag)['http-equiv']?.toLowerCase() === 'refresh');
      if (!refresh || !attrs(refresh).content.includes(expected.expectedCanonical)) pageIssues.push('missing-static-refresh');
    }

    const media = [
      ...openTags(html, 'img').map((tag) => attrs(tag).src),
      ...openTags(html, 'source').map((tag) => attrs(tag).src || (attrs(tag).srcset || '').split(',')[0]?.trim().split(/\s+/)[0]),
      ...openTags(html, 'video').map((tag) => attrs(tag).poster)
    ].filter(Boolean);
    for (const source of media) {
      if (/^(?:data:|https?:|\/\/)/i.test(source)) continue;
      const pathname = new URL(source, `http://audit.local${expected.route}`).pathname;
      if (!fs.existsSync(path.join(distRoot, pathname.replace(/^\//, '')))) brokenMedia += 1;
    }
    if (brokenMedia) pageIssues.push(`broken-media:${brokenMedia}`);

    for (const iframe of openTags(html, 'iframe')) {
      if (!attrs(iframe).title?.trim()) pageIssues.push('unlabeled-iframe');
    }
    for (const button of pairedTags(html, 'button')) {
      const attributes = attrs(button.open);
      if (![attributes['aria-label'], attributes['aria-labelledby'], text(button.inner)].some((value) => String(value || '').trim())) {
        pageIssues.push('unlabeled-button');
      }
    }

    for (const anchor of pairedTags(html, 'a')) {
      const attributes = attrs(anchor.open);
      const href = (attributes.href || '').trim();
      let target = '';
      let targetExists = true;
      let anchorExists = true;
      let kind = 'external';
      let issue = '';
      if (!href) {
        issue = 'empty-href';
      } else if (/^javascript:/i.test(href)) {
        issue = 'javascript-href';
      } else if (/^(?:tel:|mailto:)/i.test(href)) {
        kind = href.toLowerCase().startsWith('tel:') ? 'tel' : 'mailto';
        if (!href.split(':')[1]?.trim()) issue = `invalid-${kind}`;
      } else if (/^(?:https?:|\/\/)/i.test(href)) {
        kind = 'external';
      } else if (href.startsWith('#')) {
        kind = 'anchor';
        target = expected.route;
        anchorExists = Boolean(href.slice(1)) && (pageIds.get(expected.route) || new Set()).has(decodeURIComponent(href.slice(1)));
        if (!anchorExists) issue = 'broken-anchor';
      } else {
        kind = 'internal';
        const resolved = new URL(href, `http://audit.local${expected.route}`);
        target = normalizeRoute(resolved.pathname);
        const targetFile = htmlTarget(target);
        targetExists = fs.existsSync(targetFile) || fs.existsSync(path.join(distRoot, resolved.pathname.replace(/^\//, '')));
        if (!targetExists) issue = 'broken-internal-link';
        else if (target.startsWith('/design-lab/')) issue = 'production-to-design-lab';
        else if (aliasSet.has(target)) issue = 'production-to-legacy';
        if (!issue && resolved.hash) {
          const idsForTarget = pageIds.get(target) || (fs.existsSync(targetFile)
            ? new Set(openTags(fs.readFileSync(targetFile, 'utf8'), '[a-z][\\w:-]*').map((tag) => attrs(tag).id).filter(Boolean))
            : new Set());
          anchorExists = idsForTarget.has(decodeURIComponent(resolved.hash.slice(1)));
          if (!anchorExists) issue = 'broken-anchor';
        }
      }
      const accessibleName = [attributes['aria-label'], text(anchor.inner), ...openTags(anchor.inner, 'img').map((tag) => attrs(tag).alt)]
        .some((value) => String(value || '').trim());
      if (!issue && !accessibleName) issue = 'unlabeled-link';
      if (issue) pageIssues.push(issue);
      linkRows.push([expected.route, href, target, targetExists, anchorExists, kind, issue ? 'fail' : 'pass', issue]);
    }
  }

  const uniquePageIssues = [...new Set(pageIssues)];
  if (uniquePageIssues.length) issues.push(...uniquePageIssues.map((issue) => `${expected.route}:${issue}`));
  routeRows.push([
    expected.route, expected.type, exists, canonical, canonical === expected.expectedCanonical, robots,
    expected.expectedRobots.split(',').every((token) => robots.includes(token.trim())), h1s.length,
    h1s.join(' | '), hasV2Shell, designLabLinks, duplicateIds.length, brokenMedia,
    uniquePageIssues.length ? 'fail' : 'pass', uniquePageIssues.join('; ')
  ]);
}

const builtText = (route) => fs.readFileSync(htmlTarget(route), 'utf8');
for (const { file, data } of sections) {
  const html = builtText(`/${data.slug}/`);
  if (![data.title, data.heroTitle].some((value) => contains(html, value))) issues.push(`${file}:section-title-not-rendered`);
}
for (const { file, data } of services) {
  const html = builtText(`/${data.slug}/`);
  if (![data.title, data.heroTitle].some((value) => contains(html, value))) issues.push(`${file}:service-title-not-rendered`);
}
for (const { file, data } of categories) {
  const route = `/${data.parentSectionSlug}/${data.slug}/`;
  const html = builtText(route);
  if (![data.title, data.heroTitle].some((value) => contains(html, value))) issues.push(`${file}:category-title-not-rendered`);
  for (const { data: product } of products.filter((entry) => entry.data.productCategorySlug === data.slug && entry.data.showInCatalog !== false)) {
    const productRoute = `/${data.parentSectionSlug}/${data.slug}/${product.slug}/`;
    if (!openTags(html, 'a').some((tag) => normalizeRoute(new URL(attrs(tag).href || '/', `http://audit.local${route}`).pathname) === productRoute)) {
      issues.push(`${file}:missing-active-product-link:${product.slug}`);
    }
  }
}
for (const { file, data } of products) {
  const category = categoryBySlug.get(data.productCategorySlug).data;
  const route = `/${category.parentSectionSlug}/${category.slug}/${data.slug}/`;
  const html = builtText(route);
  const requiredValues = [data.title, data.leadText || data.shortDescription, data.description];
  for (const value of requiredValues.filter(Boolean)) if (!contains(html, value)) issues.push(`${file}:product-text-not-rendered:${String(value).slice(0, 40)}`);
  for (const field of ['materials', 'colors', 'customizationItems']) {
    for (const value of (Array.isArray(data[field]) ? data[field] : []).filter(Boolean)) {
      if (!contains(html, value)) issues.push(`${file}:${field}-not-rendered:${value}`);
    }
  }
  for (const item of (Array.isArray(data.dimensions) ? data.dimensions : []).filter((entry) => entry && entry.isActive !== false)) {
    for (const value of [item.label, item.value].filter(Boolean)) if (!contains(html, value)) issues.push(`${file}:dimension-not-rendered:${value}`);
  }
  if (data.deliveryText && data.showDeliveryBlock !== false && !contains(html, data.deliveryText)) issues.push(`${file}:delivery-not-rendered`);
}
for (const { file, data } of projects) {
  if (!contains(builtText(`/vypolnennye-obekty/${data.slug}/`), data.title)) issues.push(`${file}:project-title-not-rendered`);
}
for (const { file, data } of jobs) {
  const html = builtText(`/vakansii/${data.slug}/`);
  for (const field of ['responsibilities', 'requirements', 'conditions']) {
    for (const value of (data[field] || []).filter(Boolean)) if (!contains(html, value)) issues.push(`${file}:${field}-not-rendered:${value}`);
  }
}

try {
  const oldPolicy = execFileSync('git', ['show', `${checkpoint}:src/pages/politika-konfidencialnosti/index.astro`], { cwd: root, encoding: 'utf8' });
  const marker = '<div class="container policy-page__container">';
  const oldBody = oldPolicy.slice(oldPolicy.indexOf(marker) + marker.length, oldPolicy.lastIndexOf('\n    </div>\n  </section>'));
  const currentHtml = builtText('/politika-konfidencialnosti/');
  const match = currentHtml.match(/<div class="container policy-page__container">([\s\S]*?)<\/div>\s*<\/section>/i);
  if (!match || normalizedText(match[1]) !== normalizedText(oldBody)) issues.push('privacy:normalized-legal-text-diff');
} catch (error) {
  issues.push(`privacy:checkpoint-compare-failed:${error.message}`);
}

const sitemap = walk(distRoot).filter((file) => /sitemap.*\.xml$/i.test(path.basename(file))).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const sitemapRoutes = new Set(Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => normalizeRoute(decode(match[1]))));
for (const { route } of expectedCanonical) if (!sitemapRoutes.has(route)) issues.push(`sitemap:missing:${route}`);
for (const { route } of aliases) if (sitemapRoutes.has(route)) issues.push(`sitemap:legacy-present:${route}`);
if ([...sitemapRoutes].some((route) => route.startsWith('/design-lab/') || route === '/404.html' || route === '/404/')) issues.push('sitemap:isolated-route-present');

fs.writeFileSync(path.join(docsRoot, 'v2-production-route-audit.csv'), csv(routeRows), 'utf8');
fs.writeFileSync(path.join(docsRoot, 'v2-production-link-audit.csv'), csv(linkRows), 'utf8');

const uniqueIssues = [...new Set(issues)];
const summary = {
  checkpoint,
  buildPages: htmlFiles.length,
  productionRoutes: productionRoutes.length,
  designLabV2Routes: designLabV2Routes.length,
  canonicalRoutes: expectedCanonical.length,
  aliases: aliases.length,
  future404: 1,
  categories: categories.length,
  products: products.length,
  projects: projects.length,
  directions: sections.length + services.length,
  vacancies: jobs.length,
  links: linkRows.length - 1,
  issues: uniqueIssues.length
};
console.log(JSON.stringify(summary, null, 2));
if (uniqueIssues.length) {
  console.error(uniqueIssues.slice(0, 120).join('\n'));
  process.exitCode = 1;
}

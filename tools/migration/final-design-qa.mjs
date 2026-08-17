import fs from 'node:fs';
import path from 'node:path';
import { contentSchemas } from '../../src/content-schemas.mjs';

const root = process.cwd();
const contentRoot = path.join(root, 'src', 'content');
const distRoot = path.join(root, 'dist');
const argv = new Set(process.argv.slice(2));
const sourceOnly = argv.has('--source-only');
const distOnly = argv.has('--dist-only');
const jsonOutput = argv.has('--json');

if (argv.has('--help') || argv.has('-h')) {
  process.stdout.write(`Final design contract QA\n\n`);
  process.stdout.write(`  node tools/migration/final-design-qa.mjs\n`);
  process.stdout.write(`      Validate source/CMS contracts and the current ./dist build.\n`);
  process.stdout.write(`  node tools/migration/final-design-qa.mjs --source-only\n`);
  process.stdout.write(`      Validate data, schema and admin contracts without a build.\n`);
  process.stdout.write(`  node tools/migration/final-design-qa.mjs --dist-only\n`);
  process.stdout.write(`      Validate routes, links, media and rendered presentation markers.\n`);
  process.stdout.write(`  Add --json for machine-readable stdout. The script never writes reports.\n`);
  process.exit(0);
}

if (sourceOnly && distOnly) throw new Error('--source-only and --dist-only are mutually exclusive.');

const checks = [];
const failures = [];
const warnings = [];
const addCheck = (id, ok, details = {}) => {
  const row = { id, status: ok ? 'pass' : 'fail', ...details };
  checks.push(row);
  if (!ok) failures.push(row);
  return ok;
};

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(target) : [target];
});
const read = (filename) => fs.readFileSync(path.join(root, filename), 'utf8');
const records = (collection) => fs.readdirSync(path.join(contentRoot, collection))
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => ({
    file: `src/content/${collection}/${name}`,
    data: JSON.parse(fs.readFileSync(path.join(contentRoot, collection, name), 'utf8'))
  }));
const decodeHtml = (value) => String(value || '')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const attrs = (tag) => Object.fromEntries(Array.from(tag.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g))
  .slice(1)
  .map((match) => [match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? '')]));
const openTags = (html, name) => Array.from(html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi')), (match) => match[0]);
const pairedTags = (html, name) => Array.from(html.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'gi')),
  (match) => ({ open: `<${name}${match[1]}>`, inner: match[2] }));
const text = (value) => decodeHtml(String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const duplicates = (values) => [...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map())]
  .filter(([, count]) => count > 1);
const normalizeRoute = (value) => {
  const pathname = new URL(value || '/', 'http://qa.local/').pathname.replace(/\/{2,}/g, '/');
  if (pathname === '/' || path.extname(pathname)) return pathname;
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
};
const configuredBase = (() => {
  const raw = String(process.env.BASE_PATH || '/').trim();
  if (!raw || raw === '/') return '/';
  const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
  return prefixed.endsWith('/') ? prefixed.slice(0, -1) : prefixed;
})();
const artifactDeployTarget = String(process.env.DEPLOY_TARGET || '').trim().toLowerCase();
const isTestArtifact = artifactDeployTarget === 'test';
const withoutBase = (pathname) => configuredBase !== '/' && (pathname === configuredBase || pathname.startsWith(`${configuredBase}/`))
  ? pathname.slice(configuredBase.length) || '/'
  : pathname;
const htmlTarget = (route) => {
  const relative = normalizeRoute(route).replace(/^\//, '');
  if (!relative) return path.join(distRoot, 'index.html');
  if (relative.endsWith('/')) return path.join(distRoot, relative, 'index.html');
  return path.join(distRoot, relative);
};
const routeFromHtml = (file) => {
  const relative = path.relative(distRoot, file).replaceAll('\\', '/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative}`;
};
const localFileForPathname = (pathname) => {
  const relative = decodeURIComponent(withoutBase(pathname)).replace(/^\//, '');
  const candidate = path.resolve(distRoot, relative);
  if (candidate !== distRoot && !candidate.startsWith(`${distRoot}${path.sep}`)) return '';
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  const index = path.join(candidate, 'index.html');
  return fs.existsSync(index) ? index : '';
};

const productRecords = records('products');
const categoryRecords = records('product-categories');
const categoryBySlug = new Map(categoryRecords.map((entry) => [entry.data.slug, entry.data]));
const productRoute = (product) => {
  const category = categoryBySlug.get(product.productCategorySlug);
  return category ? `/${category.parentSectionSlug}/${category.slug}/${product.slug}/` : '';
};

const initialPremiumSlugs = new Set([
  'kachel-portal',
  'kacheli-pergola',
  'kacheli-s-dlinnym-navesom',
  'pergola-lamel',
  'pergola-s-lavkoy',
  'naves-galereya',
  'besedka-kub',
  'besedka-kofe',
  'bolshaya-skameyka-amplituda'
]);
const explicitStandardExamples = new Set([
  'skamya-park',
  'skamya-smu1-bazovaya',
  'urna-blok',
  'naves-terra',
  'ekran-s-navesom',
  'konteynernaya-ploshchadka-modul'
]);

const runSourceChecks = () => {
  const schemaSource = read('src/content-schemas.mjs');
  const schemaContract = /presentationType\s*:\s*z\.enum\(\s*\[\s*['"]standard['"]\s*,\s*['"]premium['"]\s*\]\s*\)\.default\(\s*['"]standard['"]\s*\)/s
    .test(schemaSource);
  addCheck('schema.presentation-type-enum-default', schemaContract, {
    expected: "z.enum(['standard', 'premium']).default('standard')"
  });
  for (const field of ['solutionKicker', 'applicationItems', 'executionVariants']) {
    addCheck(`schema.optional-${field}`, new RegExp(`${field}\\s*:[^\\n]+\\.optional\\(\\)`).test(schemaSource), { field });
  }

  const sample = structuredClone(productRecords[0]?.data || {});
  const variants = {
    legacy: (() => { const value = structuredClone(sample); delete value.presentationType; return value; })(),
    standard: { ...structuredClone(sample), presentationType: 'standard' },
    premium: { ...structuredClone(sample), presentationType: 'premium' },
    invalid: { ...structuredClone(sample), presentationType: 'featured' }
  };
  const parsedLegacy = contentSchemas.products.safeParse(variants.legacy);
  addCheck('schema.legacy-default-runtime', parsedLegacy.success && parsedLegacy.data.presentationType === 'standard', {
    parsed: parsedLegacy.success ? parsedLegacy.data.presentationType : parsedLegacy.error?.issues?.[0]?.message
  });
  addCheck('schema.standard-runtime', contentSchemas.products.safeParse(variants.standard).success);
  addCheck('schema.premium-runtime', contentSchemas.products.safeParse(variants.premium).success);
  addCheck('schema.invalid-runtime-rejected', !contentSchemas.products.safeParse(variants.invalid).success);

  const missingPresentation = productRecords.filter(({ data }) => !Object.hasOwn(data, 'presentationType')).map(({ file }) => file);
  const invalidPresentation = productRecords.filter(({ data }) => !['standard', 'premium'].includes(data.presentationType))
    .map(({ file, data }) => `${file}:${String(data.presentationType)}`);
  addCheck('content.presentation-explicit', missingPresentation.length === 0, { missing: missingPresentation });
  addCheck('content.presentation-values', invalidPresentation.length === 0, { invalid: invalidPresentation });

  const productBySlug = new Map(productRecords.map((entry) => [entry.data.slug, entry]));
  const misclassifiedPremium = [...initialPremiumSlugs].filter((slug) => productBySlug.get(slug)?.data.presentationType !== 'premium');
  const misclassifiedStandard = [...explicitStandardExamples].filter((slug) => productBySlug.get(slug)?.data.presentationType !== 'standard');
  addCheck('content.initial-premium-classification', misclassifiedPremium.length === 0, { expectedPremium: [...initialPremiumSlugs], invalid: misclassifiedPremium });
  addCheck('content.standard-guardrails', misclassifiedStandard.length === 0, { expectedStandard: [...explicitStandardExamples], invalid: misclassifiedStandard });
  const counts = productRecords.reduce((result, { data }) => {
    result[data.presentationType] = (result[data.presentationType] || 0) + 1;
    return result;
  }, {});
  addCheck('content.both-presentations-exist', counts.standard > 0 && counts.premium > 0, { counts });

  const isAdminSourceFile = (file) => /\.(?:astro|ts|js|mjs)$/.test(file) && !/\.test\.(?:ts|js|mjs)$/.test(file);
  const adminFiles = [
    ...walk(path.join(root, 'src', 'pages', 'admin')).filter(isAdminSourceFile),
    ...walk(path.join(root, 'src', 'admin')).filter(isAdminSourceFile),
    ...walk(path.join(root, 'tools', 'admin-api')).filter(isAdminSourceFile)
  ];
  const adminSource = adminFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const editorMetadataSource = read('src/admin/metadata/editor-fields.mjs');
  const recordEditorSource = read('src/admin/editors/record-editor.mjs');
  const legacyPresentationSelect = /data-field-path\s*=\s*["'{][^\n}]*presentationType|data-field-path=["']presentationType["']/.test(adminSource);
  const metadataPresentationSelect = /field\(\s*['"]presentationType['"][\s\S]*?['"]select['"]/.test(editorMetadataSource)
    && /definition\.kind\s*===\s*['"]select['"]/.test(recordEditorSource)
    && /dataset\s*:\s*\{\s*fieldPath\s*:\s*definition\.path\s*\}/.test(recordEditorSource);
  addCheck('admin.presentation-select', legacyPresentationSelect || metadataPresentationSelect, {
    expected: 'presentationType select metadata rendered by a data-field-path control'
  });
  addCheck('admin.presentation-options', adminSource.includes('standard') && adminSource.includes('premium') && adminSource.includes('presentationType'));
  const legacyPremiumFieldWrapper = adminSource.includes('data-premium-product-fields');
  const metadataPremiumFieldWrapper = /premiumOnly\s*:\s*true/.test(editorMetadataSource)
    && /fieldDefinition\.premiumOnly/.test(recordEditorSource)
    && /presentationType\s*!==\s*['"]premium['"]/.test(recordEditorSource)
    && /premiumOnlyNodes/.test(recordEditorSource);
  addCheck('admin.premium-field-wrapper', legacyPremiumFieldWrapper || metadataPremiumFieldWrapper, {
    expected: 'premiumOnly field metadata rendered only for presentationType=premium'
  });
  addCheck('admin.new-product-default', /presentationType\s*:\s*['"]standard['"]/.test(adminSource));
  addCheck('admin.optional-premium-fields', ['solutionKicker', 'applicationItems', 'executionVariants'].every((field) => adminSource.includes(field)));
  const productPresentationSource = read('tools/admin-api/product-presentation.mjs');
  addCheck('admin.product-write-validation', adminSource.includes('validateProductContentForWrite')
    && productPresentationSource.includes('contentSchemas.products.safeParse')
    && productPresentationSource.includes('PRODUCT_SCHEMA_VALIDATION_FAILED'));
  addCheck('admin.catalog-presentation-roundtrip', adminSource.includes('buildProductImportPayload')
    && adminSource.includes('productImport')
    && productPresentationSource.includes("type: 'products_import'")
    && ['presentationType', 'solutionKicker', 'applicationItems', 'executionVariants']
      .every((field) => productPresentationSource.includes(field)));

  const renderingSource = [
    ...walk(path.join(root, 'src', 'components')).filter((file) => /\.(?:astro|ts)$/.test(file)),
    ...walk(path.join(root, 'src', 'pages')).filter((file) => /\.(?:astro|ts)$/.test(file))
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  addCheck('rendering.presentation-selector', renderingSource.includes("presentationType === 'premium'") || renderingSource.includes('presentationType === "premium"'));
  addCheck('rendering.public-presentation-marker', renderingSource.includes('data-product-presentation'));
  addCheck('rendering.premium-section-marker', renderingSource.includes('data-premium-product-section'));
  addCheck('rendering.premium-listing-indicator', renderingSource.includes('data-product-card-presentation')
    && renderingSource.includes('data-product-presentation-indicator="premium"')
    && renderingSource.includes('Решение для объекта'));

  const imageReadySource = fs.existsSync(path.join(root, 'src', 'utils', 'v2ImageReady.ts'))
    ? read('src/utils/v2ImageReady.ts')
    : '';
  addCheck('motion.image-ready-contract', imageReadySource.includes('image.complete')
    && imageReadySource.includes("image.addEventListener('load'")
    && imageReadySource.includes('image.decode()')
    && imageReadySource.includes('v2-image-awaiting')
    && imageReadySource.includes('v2-image-ready')
    && imageReadySource.includes('v2-image-fallback')
    && imageReadySource.includes("'pending' | 'ready' | 'fallback'")
    && imageReadySource.includes('useTimeoutFallback')
    && imageReadySource.includes('Изображение не удалось загрузить')
    && !/\.finally\([^)]*\)[\s\S]{0,240}v2-image-ready/.test(imageReadySource));
  const publicLayoutSource = read('src/layouts/PublicV2Layout.astro');
  addCheck('motion.hero-scroll-contract', renderingSource.includes('data-v2-hero-scroll')
    && renderingSource.includes('data-v2-hero-scroll-copy')
    && publicLayoutSource.includes('--v2-hero-scroll-y')
    && publicLayoutSource.includes('requestAnimationFrame(sync)'));
  const navSource = read('src/components/v2/V2SectionNav.astro');
  const finalCssSource = fs.existsSync(path.join(root, 'src', 'styles', 'v2', 'final-art-direction-v2.css'))
    ? read('src/styles/v2/final-art-direction-v2.css')
    : '';
  addCheck('navigation.sticky-contract', navSource.includes('data-v2-section-nav')
    && /\.v2-section-nav\s*\{[^}]*position\s*:\s*sticky/s.test(finalCssSource)
    && finalCssSource.includes('scroll-margin-top')
    && navSource.includes('targetLockTimeout')
    && navSource.includes('pendingTarget')
    && navSource.includes('clearPendingTarget'));

  return counts;
};

const runDistChecks = () => {
  addCheck('dist.exists', fs.existsSync(distRoot) && fs.statSync(distRoot).isDirectory(), { hint: 'Run npm run build first.' });
  if (!fs.existsSync(distRoot)) return { routes: 0, links: 0, media: 0 };

  const sections = records('product-sections').filter(({ data }) => data.isActive !== false);
  const activeSectionSlugs = new Set(sections.map(({ data }) => data.slug));
  const services = records('services').filter(({ data }) => data.isActive !== false);
  const categories = categoryRecords.filter(({ data }) => data.isActive !== false && activeSectionSlugs.has(data.parentSectionSlug));
  const activeCategorySlugs = new Set(categories.map(({ data }) => data.slug));
  const products = productRecords.filter(({ data }) => data.isActive !== false && activeCategorySlugs.has(data.productCategorySlug));
  const projects = records('projects').filter(({ data }) => data.isActive !== false);
  const jobs = records('jobs').filter(({ data }) => data.isActive !== false);
  const expectedRoutes = [
    '/',
    ...sections.map(({ data }) => `/${data.slug}/`),
    ...services.map(({ data }) => `/${data.slug}/`),
    ...categories.map(({ data }) => `/${data.parentSectionSlug}/${data.slug}/`),
    ...products.map(({ data }) => productRoute(data)),
    '/vypolnennye-obekty/',
    ...projects.map(({ data }) => `/vypolnennye-obekty/${data.slug}/`),
    '/o-nas/', '/kontakty/', '/vakansii/',
    ...jobs.map(({ data }) => `/vakansii/${data.slug}/`),
    '/politika-konfidencialnosti/', '/izgotovlenie-na-zakaz/'
  ].filter(Boolean).map(normalizeRoute);
  const uniqueExpectedRoutes = [...new Set(expectedRoutes)];
  const missingRoutes = uniqueExpectedRoutes.filter((route) => !fs.existsSync(htmlTarget(route)));
  addCheck('routes.expected-html', missingRoutes.length === 0, { expected: uniqueExpectedRoutes.length, missing: missingRoutes });

  const htmlFiles = walk(distRoot).filter((file) => file.endsWith('.html'));
  const htmlByRoute = new Map(htmlFiles.map((file) => [normalizeRoute(routeFromHtml(file)), fs.readFileSync(file, 'utf8')]));
  const compatibilityRoutes = new Map([
    ['/lavochki-i-skameyki/', '/ulichnaya-mebel/lavochki-i-skameyki/'],
    ['/urny/', '/ulichnaya-mebel/urny/'],
    ['/navesy/', '/navesy-i-kozyrki/']
  ]);
  const expectedProductionArtifacts = new Set([...uniqueExpectedRoutes, ...compatibilityRoutes.keys(), '/404.html']);
  const actualProductionArtifacts = new Set([...htmlByRoute.keys()].filter((route) => (
    !route.startsWith('/admin/') && !route.startsWith('/design-lab/')
  )));
  const missingArtifacts = [...expectedProductionArtifacts].filter((route) => !actualProductionArtifacts.has(route));
  const unexpectedArtifacts = [...actualProductionArtifacts].filter((route) => !expectedProductionArtifacts.has(route));
  addCheck('routes.production-artifact-set', missingArtifacts.length === 0 && unexpectedArtifacts.length === 0, {
    expected: expectedProductionArtifacts.size,
    actual: actualProductionArtifacts.size,
    missing: missingArtifacts,
    unexpected: unexpectedArtifacts
  });
  const compatibilityIssues = [];
  for (const [route, target] of compatibilityRoutes) {
    const html = htmlByRoute.get(route) || '';
    const canonicalTag = openTags(html, 'link').find((tag) => (attrs(tag).rel || '').toLowerCase() === 'canonical');
    const canonical = canonicalTag ? normalizeRoute(withoutBase(new URL(attrs(canonicalTag).href, 'http://qa.local/').pathname)) : '';
    const refreshTag = openTags(html, 'meta').find((tag) => (attrs(tag)['http-equiv'] || '').toLowerCase() === 'refresh');
    const robotsTag = openTags(html, 'meta').find((tag) => (attrs(tag).name || '').toLowerCase() === 'robots');
    const robots = (attrs(robotsTag || '').content || '').toLowerCase();
    const canonicalMatchesArtifact = isTestArtifact ? canonical === '' : canonical === target;
    if (!canonicalMatchesArtifact || !attrs(refreshTag || '').content?.includes(target) || !robots.includes('noindex')) {
      compatibilityIssues.push(`${route}:canonical=${canonical || '(missing)'}:target=${target}:robots=${robots || '(missing)'}`);
    }
  }
  const notFoundHtml = htmlByRoute.get('/404.html') || '';
  const notFoundRobots = openTags(notFoundHtml, 'meta').find((tag) => (attrs(tag).name || '').toLowerCase() === 'robots');
  if (!(attrs(notFoundRobots || '').content || '').toLowerCase().includes('noindex')) compatibilityIssues.push('/404.html:missing-noindex');
  if (openTags(notFoundHtml, 'link').some((tag) => (attrs(tag).rel || '').toLowerCase() === 'canonical')) compatibilityIssues.push('/404.html:unexpected-canonical');
  addCheck('routes.compatibility-and-404', compatibilityIssues.length === 0, { issues: compatibilityIssues });

  const sitemapFiles = walk(distRoot).filter((file) => /(?:^|[\\/])sitemap(?:-[^\\/]+)?\.xml$/i.test(file));
  const sitemapRoutes = new Set(sitemapFiles.flatMap((file) => Array.from(fs.readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/gi), (match) => {
    try { return normalizeRoute(withoutBase(new URL(decodeHtml(match[1])).pathname)); } catch { return ''; }
  })).filter((route) => route && !/\.xml$/i.test(route)));
  const missingFromSitemap = uniqueExpectedRoutes.filter((route) => !sitemapRoutes.has(route));
  const forbiddenSitemapRoutes = [...sitemapRoutes].filter((route) => route.startsWith('/admin/') || route.startsWith('/design-lab/')
    || compatibilityRoutes.has(route) || route === '/404.html');
  const sitemapMatchesArtifact = isTestArtifact
    ? sitemapFiles.length === 0
    : sitemapFiles.length > 0 && missingFromSitemap.length === 0 && forbiddenSitemapRoutes.length === 0;
  addCheck('routes.sitemap', sitemapMatchesArtifact, {
    artifactDeployTarget: artifactDeployTarget || 'default',
    expected: isTestArtifact ? 'disabled' : 'complete-production-route-set',
    files: sitemapFiles.map((file) => path.relative(root, file).replaceAll('\\', '/')),
    routes: sitemapRoutes.size,
    missing: isTestArtifact ? [] : missingFromSitemap,
    forbidden: forbiddenSitemapRoutes
  });
  const idsByRoute = new Map([...htmlByRoute].map(([route, html]) => [route,
    new Set(openTags(html, '[a-z][\\w:-]*').map((tag) => attrs(tag).id).filter(Boolean))
  ]));
  const pageIssues = [];
  const linkIssues = [];
  const mediaIssues = [];
  let auditedLinks = 0;
  let auditedMedia = 0;

  for (const route of uniqueExpectedRoutes) {
    const html = htmlByRoute.get(route);
    if (!html) continue;
    const h1s = pairedTags(html, 'h1').map(({ inner }) => text(inner)).filter(Boolean);
    if (h1s.length !== 1) pageIssues.push(`${route}:h1-count:${h1s.length}`);
    const ids = openTags(html, '[a-z][\\w:-]*').map((tag) => attrs(tag).id).filter(Boolean);
    for (const [id, count] of duplicates(ids)) pageIssues.push(`${route}:duplicate-id:${id}:${count}`);

    const canonicalTag = openTags(html, 'link').find((tag) => (attrs(tag).rel || '').toLowerCase() === 'canonical');
    const canonical = canonicalTag ? normalizeRoute(withoutBase(new URL(attrs(canonicalTag).href, 'http://qa.local/').pathname)) : '';
    const robotsTag = openTags(html, 'meta').find((tag) => (attrs(tag).name || '').toLowerCase() === 'robots');
    const robots = (attrs(robotsTag || '').content || '').toLowerCase();
    if (isTestArtifact) {
      if (canonical) pageIssues.push(`${route}:unexpected-test-canonical:${canonical}`);
      if (!robots.includes('noindex')) pageIssues.push(`${route}:test-missing-noindex`);
    } else if (canonical !== route) {
      pageIssues.push(`${route}:canonical:${canonical || '(missing)'}`);
    }
    if (/\/design-lab\//.test(html)) pageIssues.push(`${route}:design-lab-reference`);

    for (const anchor of openTags(html, 'a')) {
      auditedLinks += 1;
      const attributes = attrs(anchor);
      const href = (attributes.href || '').trim();
      if (!href) {
        linkIssues.push(`${route}:empty-href`);
        continue;
      }
      if (/^(?:tel:|mailto:|https?:|\/\/|data:)/i.test(href)) continue;
      if (/^javascript:/i.test(href)) {
        linkIssues.push(`${route}:javascript-href:${href}`);
        continue;
      }
      const resolved = new URL(href, `http://qa.local${route}`);
      const targetPathname = withoutBase(resolved.pathname);
      const targetRoute = normalizeRoute(targetPathname);
      if (!localFileForPathname(targetPathname)) linkIssues.push(`${route}:missing-target:${href}`);
      if (targetRoute.startsWith('/design-lab/')) linkIssues.push(`${route}:design-lab-target:${href}`);
      if (compatibilityRoutes.has(targetRoute)) linkIssues.push(`${route}:legacy-target:${href}`);
      if (resolved.hash) {
        let id = '';
        try { id = decodeURIComponent(resolved.hash.slice(1)); } catch { id = resolved.hash.slice(1); }
        const targetIds = idsByRoute.get(targetRoute);
        if (!id || !targetIds?.has(id)) linkIssues.push(`${route}:missing-anchor:${href}`);
      }
    }

    const imageTags = openTags(html, 'img');
    for (const tag of imageTags) {
      const attributes = attrs(tag);
      if (!Object.hasOwn(attributes, 'alt')) mediaIssues.push(`${route}:img-missing-alt:${attributes.src || '(dynamic)'}`);
      if (attributes.src && (!attributes.width || !attributes.height)) mediaIssues.push(`${route}:img-missing-dimensions:${attributes.src}`);
    }
    const mediaSources = [
      ...imageTags.map((tag) => attrs(tag).src),
      ...imageTags.flatMap((tag) => (attrs(tag).srcset || '').split(',').map((candidate) => candidate.trim().split(/\s+/)[0])),
      ...openTags(html, 'source').flatMap((tag) => [attrs(tag).src, ...(attrs(tag).srcset || '').split(',').map((candidate) => candidate.trim().split(/\s+/)[0])]),
      ...openTags(html, 'video').map((tag) => attrs(tag).poster),
      ...openTags(html, 'script').map((tag) => attrs(tag).src),
      ...openTags(html, 'link').filter((tag) => /(?:stylesheet|preload|icon)/i.test(attrs(tag).rel || '')).map((tag) => attrs(tag).href)
    ].filter(Boolean);
    for (const source of mediaSources) {
      auditedMedia += 1;
      if (/^(?:data:|https?:|\/\/)/i.test(source)) continue;
      let pathname = '';
      try { pathname = new URL(source, `http://qa.local${route}`).pathname; } catch {
        mediaIssues.push(`${route}:invalid-media-url:${source}`);
        continue;
      }
      if (!localFileForPathname(pathname)) mediaIssues.push(`${route}:missing-media:${source}`);
    }
  }

  addCheck('pages.semantic-shell', pageIssues.length === 0, { issues: pageIssues.slice(0, 80), totalIssues: pageIssues.length });
  addCheck('links.internal-targets-and-anchors', linkIssues.length === 0, { audited: auditedLinks, issues: linkIssues.slice(0, 80), totalIssues: linkIssues.length });
  addCheck('media.local-targets-alt-dimensions', mediaIssues.length === 0, { audited: auditedMedia, issues: mediaIssues.slice(0, 80), totalIssues: mediaIssues.length });

  const presentationIssues = [];
  const renderedCounts = { standard: 0, premium: 0, premiumSections: 0 };
  for (const { file, data } of products) {
    const route = productRoute(data);
    const html = htmlByRoute.get(normalizeRoute(route));
    if (!html) continue;
    const markerTags = Array.from(html.matchAll(/<[a-z][\w:-]*\b[^>]*\bdata-product-presentation(?=\s|=|>)(?:\s*=\s*(?:"[^"]*"|'[^']*'))?[^>]*>/gi), (match) => match[0]);
    const values = markerTags.map((tag) => attrs(tag)['data-product-presentation']);
    if (values.length !== 1 || values[0] !== data.presentationType) {
      presentationIssues.push(`${file}:rendered-marker:${values.join('|') || '(missing)'}`);
    } else {
      renderedCounts[data.presentationType] += 1;
    }
    const premiumSections = (html.match(/\bdata-premium-product-section(?:\s*=|[\s>])/gi) || []).length;
    renderedCounts.premiumSections += premiumSections;
    if (data.presentationType === 'standard' && premiumSections !== 0) presentationIssues.push(`${file}:standard-has-premium-sections:${premiumSections}`);
    if (data.presentationType === 'premium' && premiumSections < 1) presentationIssues.push(`${file}:premium-has-no-premium-sections`);
  }
  addCheck('rendering.product-presentation-contract', presentationIssues.length === 0, {
    counts: renderedCounts,
    issues: presentationIssues.slice(0, 80),
    totalIssues: presentationIssues.length
  });

  const listingCards = [...htmlByRoute.values()].flatMap((html) => Array.from(
    html.matchAll(/<a\b([^>]*\bdata-product-card-presentation\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*)>([\s\S]*?)<\/a>/gi),
    (match) => ({ presentation: match[2] || match[3] || '', body: match[4] || '' })
  ));
  const listingCounts = { standard: 0, premium: 0 };
  const listingIssues = [];
  for (const [index, card] of listingCards.entries()) {
    const indicatorCount = (card.body.match(/\bdata-product-presentation-indicator\s*=\s*(?:"premium"|'premium')/gi) || []).length;
    if (card.presentation === 'standard') {
      listingCounts.standard += 1;
      if (indicatorCount !== 0) listingIssues.push(`card-${index}:standard-has-premium-indicator`);
    } else if (card.presentation === 'premium') {
      listingCounts.premium += 1;
      if (indicatorCount !== 1 || !text(card.body).includes('Решение для объекта')) {
        listingIssues.push(`card-${index}:premium-indicator-count-${indicatorCount}`);
      }
    } else {
      listingIssues.push(`card-${index}:invalid-presentation-${card.presentation || '(empty)'}`);
    }
  }
  addCheck('rendering.product-listing-presentation', listingCards.length > 0
    && listingCounts.standard > 0 && listingCounts.premium > 0 && listingIssues.length === 0, {
    audited: listingCards.length,
    counts: listingCounts,
    issues: listingIssues.slice(0, 80),
    totalIssues: listingIssues.length
  });

  const adminRoutes = ['/admin/', '/admin/catalog/', '/admin/visual/', '/admin/technical/', '/admin/pages/navesy/'];
  const adminPresentationIssues = [];
  const adminShellAssets = new Set();
  for (const route of adminRoutes) {
    const html = htmlByRoute.get(route) || '';
    const shellAsset = html.match(/<script\b[^>]*\bsrc=(?:"([^"]*AdminShell[^"]*)"|'([^']*AdminShell[^']*)')[^>]*>/iu);
    if (!html.includes('id="adminRoot"') || !html.includes('data-admin-base=')) {
      adminPresentationIssues.push(`${route}:missing-unified-shell`);
    }
    if (!html.includes('id="adminCreatePresentation"') || !html.includes('name="presentationType"')
      || !html.includes('<option value="standard">') || !html.includes('<option value="premium">')) {
      adminPresentationIssues.push(`${route}:missing-presentation-control`);
    }
    if (!shellAsset) adminPresentationIssues.push(`${route}:missing-admin-shell-script`);
    else adminShellAssets.add(shellAsset[1] || shellAsset[2]);
  }
  if (adminShellAssets.size !== 1) {
    adminPresentationIssues.push(`shared-shell-assets:${[...adminShellAssets].join('|') || '(missing)'}`);
  }
  addCheck('rendering.admin-presentation-control', adminPresentationIssues.length === 0, {
    routes: adminRoutes,
    issues: adminPresentationIssues
  });
  return { routes: uniqueExpectedRoutes.length, links: auditedLinks, media: auditedMedia };
};

let presentationCounts = {};
let distCounts = {};
if (!distOnly) presentationCounts = runSourceChecks();
if (!sourceOnly) distCounts = runDistChecks();

const summary = {
  result: failures.length ? 'fail' : 'pass',
  checks: checks.length,
  passed: checks.length - failures.length,
  failed: failures.length,
  warnings: warnings.length,
  presentationCounts,
  distCounts,
  failures,
  warningDetails: warnings
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify({ ...summary, checkDetails: checks }, null, 2)}\n`);
} else {
  for (const check of checks) {
    const detail = check.status === 'fail' ? ` ${JSON.stringify(Object.fromEntries(Object.entries(check).filter(([key]) => !['id', 'status'].includes(key))))}` : '';
    process.stdout.write(`${check.status === 'pass' ? 'PASS' : 'FAIL'} ${check.id}${detail}\n`);
  }
  for (const warning of warnings) process.stdout.write(`WARN ${warning.id} ${JSON.stringify(warning)}\n`);
  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
}

if (failures.length) process.exitCode = 1;

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const contentRoot = path.join(root, 'src', 'content');
const docsRoot = path.join(root, 'docs', 'migration');
const proofRoot = path.join(docsRoot, 'visual-polish');
const ownerProofBase = path.join(root, 'docs', 'design', 'owner-visual-freeze');
const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const optionValue = (name) => {
  const exact = argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
};

const options = {
  help: hasFlag('--help') || hasFlag('-h'),
  plan: hasFlag('--plan'),
  screenshots: hasFlag('--screenshots') || process.env.V2_VISUAL_QA_SCREENSHOTS === '1',
  smoke: hasFlag('--smoke'),
  headful: hasFlag('--headful'),
  ownerFreezePhase: (optionValue('--owner-freeze') || '').trim().toLowerCase(),
  externalOrigin: optionValue('--origin').trim().replace(/\/$/, ''),
  routeValues: optionValue('--routes').split(',').map((value) => value.trim()).filter(Boolean),
  viewportValues: optionValue('--viewports').split(',').map((value) => value.trim()).filter(Boolean)
};
options.ownerFiles = optionValue('--owner-files').split(',').map((value) => value.trim()).filter(Boolean);
options.ownerFreeze = hasFlag('--owner-freeze') || Boolean(options.ownerFreezePhase);
if (options.ownerFreeze && !['', 'before', 'final', 'mobile'].includes(options.ownerFreezePhase)) {
  throw new Error(`Unknown --owner-freeze phase: ${options.ownerFreezePhase}. Use before, final or mobile.`);
}
if (options.ownerFreeze && !options.ownerFreezePhase) options.ownerFreezePhase = 'final';
const ownerProofRoot = options.ownerFreezePhase === 'before'
  ? path.join(ownerProofBase, 'before')
  : options.ownerFreezePhase === 'mobile'
    ? path.join(ownerProofBase, 'mobile')
    : ownerProofBase;

const usage = `
Visual-polish browser QA (local only)

  node tools/migration/browser-visual-polish-qa.mjs --plan
      Print the route/click/viewport plan without starting a browser or writing reports.

  node tools/migration/browser-visual-polish-qa.mjs
      Run the complete QA against ./dist and write the two audit CSV files plus JSON.

  node tools/migration/browser-visual-polish-qa.mjs --screenshots
      Run complete QA and additionally create the proof PNG set in docs/migration/visual-polish.

  node tools/migration/browser-visual-polish-qa.mjs --owner-freeze=before|final|mobile
      Capture only the canonical owner visual-freeze evidence set. Reports stay under .astro.

  node tools/migration/browser-visual-polish-qa.mjs --origin=http://127.0.0.1:4321
      Run against an already running local Astro server instead of ./dist.

  node tools/migration/browser-visual-polish-qa.mjs --smoke
      Short representative run; writes only under .astro and never replaces final audits.

  node tools/migration/browser-visual-polish-qa.mjs --routes=/,/vakansii/example/ --viewports=1440x900,320x700
      Targeted direct/reduced-motion/responsive regression run. Reports stay under .astro.

Environment:
  CHROME_PATH                  Chrome/Chromium executable.
  V2_VISUAL_QA_SCREENSHOTS=1   Equivalent to --screenshots.
`;

if (options.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalizeRoute = (value) => {
  const url = new URL(value || '/', 'http://visual-polish.local/');
  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (pathname !== '/' && !path.extname(pathname) && !pathname.endsWith('/')) pathname += '/';
  return `${pathname}${url.hash}`;
};
const pathnameOnly = (value) => new URL(value || '/', 'http://visual-polish.local/').pathname;
const csvEscape = (value) => {
  const string = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
};
const toCsv = (headers, rows) => [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))]
  .map((row) => row.map(csvEscape).join(','))
  .join('\n') + '\n';
const sortRecords = (entries) => entries.sort((left, right) =>
  (left.data.order ?? Number.MAX_SAFE_INTEGER) - (right.data.order ?? Number.MAX_SAFE_INTEGER)
  || String(left.data.title || left.data.slug).localeCompare(String(right.data.title || right.data.slug), 'ru'));
const readRecords = async (collection) => {
  const names = (await readdir(path.join(contentRoot, collection))).filter((name) => name.endsWith('.json'));
  const entries = await Promise.all(names.map(async (name) => ({
    file: `src/content/${collection}/${name}`,
    data: JSON.parse(await readFile(path.join(contentRoot, collection, name), 'utf8'))
  })));
  return sortRecords(entries);
};

const [
  sectionRecords,
  serviceRecords,
  categoryRecords,
  productRecords,
  projectRecords,
  jobRecords,
  homePageRecord,
  yandexRecord
] = await Promise.all([
  readRecords('product-sections'),
  readRecords('services'),
  readRecords('product-categories'),
  readRecords('products'),
  readRecords('projects'),
  readRecords('jobs'),
  readFile(path.join(contentRoot, 'static-pages', 'home.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'src', 'data', 'yandex.json'), 'utf8').then(JSON.parse)
]);
const expectedMapConstructorId = new URL(yandexRecord.map.constructorSrc).searchParams.get('um');
const active = (entry) => entry.data.isActive !== false;
const sections = sectionRecords.filter(active);
const services = serviceRecords.filter(active);
const sectionBySlug = new Map(sections.map((entry) => [entry.data.slug, entry]));
const categories = categoryRecords.filter((entry) => active(entry) && sectionBySlug.has(entry.data.parentSectionSlug));
const categoryBySlug = new Map(categories.map((entry) => [entry.data.slug, entry]));
const products = productRecords.filter((entry) => active(entry) && categoryBySlug.has(entry.data.productCategorySlug));
const projects = projectRecords.filter(active);
const jobs = jobRecords.filter(active);
const categoryRoute = (entry) => `/${entry.data.parentSectionSlug}/${entry.data.slug}/`;
const productRoute = (entry) => {
  const category = categoryBySlug.get(entry.data.productCategorySlug)?.data;
  if (!category) throw new Error(`Product ${entry.data.slug} has no active category.`);
  return `/${category.parentSectionSlug}/${category.slug}/${entry.data.slug}/`;
};

const canonicalRoutes = [
  { route: '/', type: 'home', title: 'Главная' },
  ...sections.map((entry) => ({ route: `/${entry.data.slug}/`, type: 'direction', title: entry.data.title })),
  ...services.map((entry) => ({ route: `/${entry.data.slug}/`, type: 'direction', title: entry.data.title })),
  ...categories.map((entry) => ({ route: categoryRoute(entry), type: 'category', title: entry.data.title })),
  ...products.map((entry) => ({ route: productRoute(entry), type: 'product', title: entry.data.title })),
  { route: '/vypolnennye-obekty/', type: 'projects-archive', title: 'Выполненные объекты' },
  ...projects.map((entry) => ({ route: `/vypolnennye-obekty/${entry.data.slug}/`, type: 'project', title: entry.data.title })),
  { route: '/o-nas/', type: 'company', title: 'Компания' },
  { route: '/kontakty/', type: 'contacts', title: 'Контакты' },
  { route: '/vakansii/', type: 'vacancies', title: 'Вакансии' },
  ...jobs.map((entry) => ({ route: `/vakansii/${entry.data.slug}/`, type: 'vacancy', title: entry.data.title })),
  { route: '/politika-konfidencialnosti/', type: 'privacy', title: 'Политика конфиденциальности' },
  { route: '/izgotovlenie-na-zakaz/', type: 'custom-order', title: 'Изготовление на заказ' }
].map((entry) => ({ ...entry, route: normalizeRoute(entry.route) }));
const canonicalByRoute = new Map(canonicalRoutes.map((entry) => [entry.route, entry]));
if (canonicalByRoute.size !== canonicalRoutes.length) {
  throw new Error(`Duplicate canonical routes in content plan: ${canonicalRoutes.length - canonicalByRoute.size}`);
}
const targetedRoutes = [...new Set(options.routeValues.map(normalizeRoute))];
const unknownTargetedRoutes = targetedRoutes.filter((route) => !canonicalByRoute.has(route));
if (unknownTargetedRoutes.length) {
  throw new Error(`Unknown --routes value(s): ${unknownTargetedRoutes.join(', ')}`);
}
const targetedMode = targetedRoutes.length > 0;

const routeOr = (preferred, fallbackType) => canonicalByRoute.has(preferred)
  ? preferred
  : canonicalRoutes.find((entry) => entry.type === fallbackType)?.route || '/';
const homeRoute = '/';
const metalworksRoute = routeOr('/metallokonstruktsii-dlya-biznesa/', 'direction');
const landscapingRoute = routeOr('/blagoustroystvo-territoriy/', 'direction');
const constructionRoute = routeOr('/stroitelstvo-i-remonty/', 'direction');
const canopiesRoute = routeOr('/navesy-i-kozyrki/', 'direction');
const topiaryRoute = routeOr('/topiarii/', 'direction');
const furnitureRoute = routeOr('/ulichnaya-mebel/', 'direction');
const fencesRoute = routeOr('/ograzhdeniya-i-zabory/', 'direction');
const swingsCategoryRoute = routeOr('/ulichnaya-mebel/kacheli/', 'category');
const benchesCategoryRoute = routeOr('/ulichnaya-mebel/lavochki-i-skameyki/', 'category');
const swingProductRoute = routeOr('/ulichnaya-mebel/kacheli/kachel-duga/', 'product');
const premiumPortalProductRoute = routeOr('/ulichnaya-mebel/kacheli/kachel-portal/', 'product');
const standardBenchProductRoute = routeOr(
  '/ulichnaya-mebel/lavochki-i-skameyki/skamya-smu1-bazovaya/',
  'product'
);
const mediaRichProductEntry = products
  .map((entry) => ({ entry, mediaCount: Number(Boolean(entry.data.image?.trim())) + (entry.data.gallery || []).filter(Boolean).length }))
  .sort((left, right) => right.mediaCount - left.mediaCount)[0]?.entry;
const zeroMediaProductEntry = products.find((entry) => !entry.data.image?.trim() && !(entry.data.gallery || []).some(Boolean));
const mediaRichProductRoute = mediaRichProductEntry ? productRoute(mediaRichProductEntry) : swingProductRoute;
const zeroMediaProductRoute = zeroMediaProductEntry ? productRoute(zeroMediaProductEntry) : swingProductRoute;
const singleImageMinimalProductRoute = routeOr(
  '/ulichnaya-mebel/lavochki-i-skameyki/skamya-smu1-bazovaya/',
  'product'
);
const portraitProductRoute = routeOr(
  '/ulichnaya-mebel/ulichnoe-osveshchenie/fonar-sektor/',
  'product'
);
const longTitleProductRoute = routeOr(
  '/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-zakrytaya/',
  'product'
);
const specsHeavyProductRoute = routeOr(
  '/ulichnaya-mebel/besedki-i-pergoly/besedka-kub/',
  'product'
);
const noMediaCategoryRoute = routeOr(
  '/ograzhdeniya-i-zabory/dekorativnye-ograzhdeniya/',
  'category'
);
const longTitleCategoryRoute = routeOr(
  '/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/',
  'category'
);
const sparseCategoryEntry = categories.find((category) => !products.some((product) =>
  product.data.productCategorySlug === category.data.slug && product.data.showInCatalog !== false));
const sparseCategoryRoute = sparseCategoryEntry ? categoryRoute(sparseCategoryEntry) : swingsCategoryRoute;
const projectsRoute = '/vypolnennye-obekty/';
const projectRouteBySlug = (slug, fallbackIndex = 0) => canonicalByRoute.has(`/vypolnennye-obekty/${slug}/`)
  ? `/vypolnennye-obekty/${slug}/`
  : `/vypolnennye-obekty/${projects[fallbackIndex]?.data.slug || projects[0]?.data.slug}/`;
const industrialProjectRoute = projectRouteBySlug('kompleks-rabot-na-proizvodstvennoy-territorii', 0);
const landscapingProjectRoute = projectRouteBySlug('blagoustroystvo-naberezhnoy-reki-tobol', 1);
const sparseProjectRoute = projectRouteBySlug('remont-skvera-na-ulitse-gogolya', 2);
const companyRoute = '/o-nas/';
const contactsRoute = '/kontakty/';
const vacanciesRoute = '/vakansii/';
const vacancyRoute = jobs[0] ? `/vakansii/${jobs[0].data.slug}/` : vacanciesRoute;
const customOrderRoute = '/izgotovlenie-na-zakaz/';
const privacyRoute = '/politika-konfidencialnosti/';
const notFoundRoute = '/404.html';

const exactViewports = [
  { name: '1920x1080', width: 1920, height: 1080, mobile: false, scale: 1 },
  { name: '1706x958', width: 1706, height: 958, mobile: false, scale: 1 },
  { name: '1440x900', width: 1440, height: 900, mobile: false, scale: 1 },
  { name: '1280x800', width: 1280, height: 800, mobile: false, scale: 1 },
  { name: '1024x768', width: 1024, height: 768, mobile: false, scale: 1 },
  { name: '768x1024', width: 768, height: 1024, mobile: true, scale: 1 },
  { name: '390x844', width: 390, height: 844, mobile: true, scale: 1 },
  { name: '320x700', width: 320, height: 700, mobile: true, scale: 1 },
  // A 1280px desktop viewport at 200% browser zoom has an effective 640px CSS
  // layout viewport. Device scale is kept separate from visual/pinch zoom so
  // media queries and line wrapping are exercised as real reflow.
  { name: 'reflow-200', width: 640, height: 400, mobile: false, scale: 1, deviceScaleFactor: 2, zoomPercent: 200 }
];

const representativeRoutes = [...new Set([
  homeRoute,
  metalworksRoute,
  landscapingRoute,
  constructionRoute,
  canopiesRoute,
  topiaryRoute,
  furnitureRoute,
  fencesRoute,
  swingsCategoryRoute,
  sparseCategoryRoute,
  noMediaCategoryRoute,
  longTitleCategoryRoute,
  mediaRichProductRoute,
  swingProductRoute,
  premiumPortalProductRoute,
  standardBenchProductRoute,
  zeroMediaProductRoute,
  singleImageMinimalProductRoute,
  portraitProductRoute,
  longTitleProductRoute,
  specsHeavyProductRoute,
  projectsRoute,
  industrialProjectRoute,
  landscapingProjectRoute,
  sparseProjectRoute,
  companyRoute,
  contactsRoute,
  vacanciesRoute,
  vacancyRoute,
  customOrderRoute,
  privacyRoute,
  notFoundRoute
])];

const reducedMotionRoutes = [...new Set([
  homeRoute,
  metalworksRoute,
  landscapingRoute,
  constructionRoute,
  canopiesRoute,
  topiaryRoute,
  furnitureRoute,
  swingsCategoryRoute,
  swingProductRoute,
  premiumPortalProductRoute,
  standardBenchProductRoute,
  projectsRoute,
  companyRoute,
  contactsRoute,
  vacanciesRoute,
  customOrderRoute,
  privacyRoute
])];

const immersiveMotionRoutes = new Set([
  metalworksRoute,
  landscapingRoute,
  constructionRoute,
  canopiesRoute,
  topiaryRoute
]);
const motionPresenceRoutes = new Set(reducedMotionRoutes);

const footerRoutes = [...new Set([
  homeRoute,
  metalworksRoute,
  swingsCategoryRoute,
  swingProductRoute,
  premiumPortalProductRoute,
  standardBenchProductRoute,
  industrialProjectRoute,
  contactsRoute,
  vacancyRoute,
  privacyRoute,
  notFoundRoute
])];

const clickPlan = [
  [homeRoute, metalworksRoute],
  [metalworksRoute, landscapingRoute],
  [landscapingRoute, constructionRoute],
  [constructionRoute, canopiesRoute],
  [canopiesRoute, topiaryRoute],
  [topiaryRoute, furnitureRoute],
  [furnitureRoute, swingsCategoryRoute],
  [swingsCategoryRoute, swingProductRoute],
  [swingProductRoute, swingsCategoryRoute],
  [swingsCategoryRoute, furnitureRoute],
  [furnitureRoute, fencesRoute],
  [fencesRoute, sparseCategoryRoute],
  [sparseCategoryRoute, customOrderRoute],
  [customOrderRoute, projectsRoute],
  [projectsRoute, industrialProjectRoute],
  [industrialProjectRoute, projectsRoute],
  [projectsRoute, landscapingProjectRoute],
  [landscapingProjectRoute, contactsRoute],
  [contactsRoute, vacanciesRoute],
  [vacanciesRoute, privacyRoute],
  [privacyRoute, homeRoute],
  [homeRoute, customOrderRoute],
  [customOrderRoute, canopiesRoute],
  [canopiesRoute, contactsRoute]
].filter(([source, target], index, pairs) => source !== target
  && (canonicalByRoute.has(source) || source === notFoundRoute)
  && (canonicalByRoute.has(target) || target === notFoundRoute)
  && pairs.findIndex(([left, right]) => left === source && right === target) === index);

if (clickPlan.length < 20) throw new Error(`Click-navigation plan has only ${clickPlan.length} transitions.`);

const functionalAuditPlan = [
  'desktop-dropdown-keyboard',
  'mobile-menu-lock-focus-escape',
  'product-gallery-navigation-fullscreen-swipe',
  'project-gallery-navigation-fullscreen',
  'contacts-map-frame',
  'home-video-desktop',
  'home-video-mobile'
];

const screenshotPlan = [
  { file: 'home-desktop.png', route: homeRoute, viewport: '1920x1080' },
  { file: 'home-mobile.png', route: homeRoute, viewport: '390x844' },
  { file: 'home-footer-desktop.png', route: homeRoute, viewport: '1440x900', action: 'footer' },
  { file: 'home-footer-mobile.png', route: homeRoute, viewport: '390x844', action: 'footer' },
  { file: 'metalworks-hero-desktop.png', route: metalworksRoute, viewport: '1706x958' },
  { file: 'metalworks-hero-mobile.png', route: metalworksRoute, viewport: '390x844' },
  { file: 'landscaping-hero-desktop.png', route: landscapingRoute, viewport: '1706x958' },
  { file: 'landscaping-hero-mobile.png', route: landscapingRoute, viewport: '390x844' },
  { file: 'construction-hero-desktop.png', route: constructionRoute, viewport: '1440x900' },
  { file: 'canopies-hero-desktop.png', route: canopiesRoute, viewport: '1440x900' },
  { file: 'topiary-hero-desktop.png', route: topiaryRoute, viewport: '1440x900' },
  { file: 'catalog-section-desktop.png', route: furnitureRoute, viewport: '1440x900' },
  { file: 'category-swings-desktop.png', route: swingsCategoryRoute, viewport: '1440x900' },
  { file: 'category-swings-mobile.png', route: swingsCategoryRoute, viewport: '390x844' },
  { file: 'category-sparse-desktop.png', route: sparseCategoryRoute, viewport: '1440x900' },
  { file: 'product-swing-desktop.png', route: swingProductRoute, viewport: '1440x900' },
  { file: 'product-swing-mobile.png', route: swingProductRoute, viewport: '390x844' },
  { file: 'product-standard-bench-desktop.png', route: standardBenchProductRoute, viewport: '1440x900' },
  { file: 'product-standard-bench-mobile.png', route: standardBenchProductRoute, viewport: '390x844' },
  { file: 'product-premium-portal-desktop.png', route: premiumPortalProductRoute, viewport: '1440x900' },
  { file: 'product-premium-portal-mobile.png', route: premiumPortalProductRoute, viewport: '390x844' },
  { file: 'product-zero-media-desktop.png', route: zeroMediaProductRoute, viewport: '1440x900' },
  { file: 'product-fullscreen.png', route: mediaRichProductRoute, viewport: '1440x900', action: 'product-fullscreen' },
  { file: 'projects-desktop.png', route: projectsRoute, viewport: '1440x900' },
  { file: 'project-detail-desktop.png', route: industrialProjectRoute, viewport: '1440x900' },
  { file: 'project-detail-mobile.png', route: industrialProjectRoute, viewport: '390x844' },
  { file: 'custom-order-desktop.png', route: customOrderRoute, viewport: '1440x900' },
  { file: 'custom-order-mobile.png', route: customOrderRoute, viewport: '390x844' },
  { file: 'company-desktop.png', route: companyRoute, viewport: '1440x900' },
  { file: 'contacts-desktop.png', route: contactsRoute, viewport: '1440x900', waitForMap: true },
  { file: 'vacancies-desktop.png', route: vacanciesRoute, viewport: '1440x900' }
];

const ownerDesktopScreenshotPlan = [
  { file: 'home-first-screen-1440.png', route: homeRoute, viewport: '1440x900' },
  { file: 'home-final-screen-1440.png', route: homeRoute, viewport: '1440x900', action: 'footer' },
  { file: 'home-final-screen-1920.png', route: homeRoute, viewport: '1920x1080', action: 'footer' },
  { file: 'street-furniture-entry.png', route: furnitureRoute, viewport: '1440x900' },
  { file: 'fences-entry.png', route: fencesRoute, viewport: '1440x900' },
  { file: 'category-benches-entry.png', route: benchesCategoryRoute, viewport: '1440x900' },
  { file: 'standard-product-entry.png', route: standardBenchProductRoute, viewport: '1440x900' },
  { file: 'portal-entry-1440.png', route: premiumPortalProductRoute, viewport: '1440x900' },
  { file: 'portal-entry-1920.png', route: premiumPortalProductRoute, viewport: '1920x1080' },
  { file: 'portal-scrolled-hero.png', route: premiumPortalProductRoute, viewport: '1440x900', action: 'hero-mid' },
  { file: 'portal-gallery.png', route: premiumPortalProductRoute, viewport: '1440x900', action: 'selector', selector: '#premium-gallery' },
  { file: 'portal-adaptation.png', route: premiumPortalProductRoute, viewport: '1440x900', action: 'selector', selector: '#premium-adaptation' },
  { file: 'portal-constructive.png', route: premiumPortalProductRoute, viewport: '1440x900', action: 'selector', selector: '#premium-technical' },
  { file: 'canopies-entry.png', route: canopiesRoute, viewport: '1440x900' },
  { file: 'topiary-entry.png', route: topiaryRoute, viewport: '1440x900' },
  { file: 'topiary-grid.png', route: topiaryRoute, viewport: '1440x900', action: 'selector', selector: '#direction-types' },
  { file: 'metalworks-entry.png', route: metalworksRoute, viewport: '1440x900' },
  { file: 'metalworks-content.png', route: metalworksRoute, viewport: '1440x900', action: 'selector', selector: '#engineering-scope' },
  { file: 'landscaping-content.png', route: landscapingRoute, viewport: '1440x900', action: 'selector', selector: '#landscaping-scope' },
  { file: 'construction-content.png', route: constructionRoute, viewport: '1440x900', action: 'selector', selector: '#construction-scope' },
  { file: 'custom-order-entry.png', route: customOrderRoute, viewport: '1440x900' },
  { file: 'custom-order-directions.png', route: customOrderRoute, viewport: '1440x900', action: 'selector', selector: '.custom-order-directions' },
  { file: 'projects-entry.png', route: projectsRoute, viewport: '1440x900' },
  { file: 'projects-grid.png', route: projectsRoute, viewport: '1440x900', action: 'selector', selector: '.v2-project-archive__visual-grid' },
  { file: 'company-entry.png', route: companyRoute, viewport: '1440x900' },
  { file: 'contacts-entry.png', route: contactsRoute, viewport: '1440x900', waitForMap: true },
  { file: 'vacancies-entry.png', route: vacanciesRoute, viewport: '1440x900' },
  { file: 'sticky-navigation.png', route: metalworksRoute, viewport: '1440x900', action: 'selector', selector: '#engineering-scope' },
  { file: 'footer-desktop.png', route: homeRoute, viewport: '1440x900', action: 'footer' },
  { file: 'footer-mobile.png', route: homeRoute, viewport: '390x844', action: 'footer' },
  { file: 'typography-editorial-section.png', route: companyRoute, viewport: '1440x900', action: 'selector', selector: '#company-intro-title' },
  { file: 'royal-blue-white-section.png', route: premiumPortalProductRoute, viewport: '1440x900', action: 'selector', selector: '#premium-applications' },
  { file: 'hero-handoff-mid-scroll.png', route: homeRoute, viewport: '1440x900', action: 'hero-mid' }
];

const ownerMobileScreenshotPlan = [
  ['home-390.png', homeRoute],
  ['street-furniture-390.png', furnitureRoute],
  ['fences-390.png', fencesRoute],
  ['category-benches-390.png', benchesCategoryRoute],
  ['standard-product-390.png', standardBenchProductRoute],
  ['portal-390.png', premiumPortalProductRoute],
  ['canopies-390.png', canopiesRoute],
  ['topiary-390.png', topiaryRoute],
  ['metalworks-390.png', metalworksRoute],
  ['landscaping-390.png', landscapingRoute],
  ['construction-390.png', constructionRoute],
  ['custom-order-390.png', customOrderRoute],
  ['projects-390.png', projectsRoute],
  ['company-390.png', companyRoute],
  ['contacts-390.png', contactsRoute],
  ['vacancies-390.png', vacanciesRoute]
].map(([file, route]) => ({ file, route, viewport: '390x844', waitForMap: route === contactsRoute }));

const ownerScreenshotPlanBase = options.ownerFreezePhase === 'mobile'
  ? ownerMobileScreenshotPlan
  : ownerDesktopScreenshotPlan;
const unknownOwnerFiles = options.ownerFiles.filter((file) => !ownerScreenshotPlanBase.some((item) => item.file === file));
if (unknownOwnerFiles.length) throw new Error(`Unknown --owner-files value(s): ${unknownOwnerFiles.join(', ')}`);
const ownerScreenshotPlan = options.ownerFiles.length
  ? ownerScreenshotPlanBase.filter((item) => options.ownerFiles.includes(item.file))
  : ownerScreenshotPlanBase;

if (options.plan) {
  process.stdout.write(`${JSON.stringify({
    canonicalRoutes: canonicalRoutes.length,
    types: Object.fromEntries([...new Set(canonicalRoutes.map((entry) => entry.type))]
      .map((type) => [type, canonicalRoutes.filter((entry) => entry.type === type).length])),
    clickNavigations: clickPlan.length,
    clickPlan: clickPlan.map(([source, target], index) => ({ sequence: index + 1, source, target })),
    representativeRoutes,
    reducedMotionRoutes,
    footerRoutes,
    functionalAudits: functionalAuditPlan,
    viewports: exactViewports,
    screenshots: screenshotPlan.map((entry) => entry.file),
    screenshotHint: 'Proof PNG files are written only with --screenshots; review total screenshotBytes before any manual git add.'
  }, null, 2)}\n`);
  process.exit(0);
}

const smokeRoot = path.join(root, '.astro');
const reportPath = options.smoke || targetedMode || options.ownerFreeze
  ? path.join(smokeRoot, 'browser-visual-polish-smoke.json')
  : path.join(docsRoot, 'v2-visual-polish-browser-qa.json');
const scrollAuditPath = options.smoke || targetedMode || options.ownerFreeze
  ? path.join(smokeRoot, 'v2-scroll-navigation-audit-smoke.csv')
  : path.join(docsRoot, 'v2-scroll-navigation-audit.csv');
const motionAuditPath = options.smoke || targetedMode || options.ownerFreeze
  ? path.join(smokeRoot, 'v2-motion-audit-smoke.csv')
  : path.join(docsRoot, 'v2-motion-audit.csv');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mimeTypes = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8'
};

let staticServer = null;
let origin = options.externalOrigin;
if (origin) {
  const originUrl = new URL(origin);
  if (!['127.0.0.1', 'localhost', '::1'].includes(originUrl.hostname)) {
    throw new Error(`--origin must be local; received ${originUrl.hostname}`);
  }
} else {
  const distInfo = await stat(distRoot).catch(() => null);
  if (!distInfo?.isDirectory()) throw new Error('dist is missing; run npm run build before full browser QA.');
  const port = 4400 + Math.floor(Math.random() * 400);
  origin = `http://127.0.0.1:${port}`;
  staticServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', origin);
      const pathname = decodeURIComponent(url.pathname);
      let filename = pathname === '/404.html'
        ? path.join(distRoot, '404.html')
        : path.resolve(distRoot, `.${pathname}`);
      if (filename !== distRoot && !filename.startsWith(`${distRoot}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      let info = await stat(filename).catch(() => null);
      if (info?.isDirectory()) {
        filename = path.join(filename, 'index.html');
        info = await stat(filename).catch(() => null);
      }
      if (!info?.isFile()) {
        const notFoundFile = path.join(distRoot, '404.html');
        const notFoundBody = await readFile(notFoundFile);
        response.writeHead(404, {
          'cache-control': 'no-store',
          'content-length': String(notFoundBody.length),
          'content-type': 'text/html; charset=utf-8'
        }).end(request.method === 'HEAD' ? undefined : notFoundBody);
        return;
      }
      const body = request.method === 'HEAD' ? null : await readFile(filename);
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': String(info.size),
        'content-type': mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream'
      }).end(body || undefined);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    staticServer.once('error', reject);
    staticServer.listen(port, '127.0.0.1', resolve);
  });
}

const profileRoot = path.join(root, '.astro');
await mkdir(profileRoot, { recursive: true });
const profileDir = await mkdtemp(path.join(profileRoot, 'smu1-visual-polish-qa-'));
const debugPort = 10900 + Math.floor(Math.random() * 300);
const browser = spawn(chromePath, [
  options.headful ? '--new-window' : '--headless=new',
  '--disable-component-extensions-with-background-pages',
  '--disable-crash-reporter',
  '--disable-extensions',
  '--no-default-browser-check',
  '--no-first-run',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  `--disk-cache-dir=${path.join(profileDir, 'cache')}`,
  '--window-size=1920,1080',
  'about:blank'
], {
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, TEMP: profileDir, TMP: profileDir }
});

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
    this.socket.addEventListener('close', () => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP connection closed while command ${id} was pending.`));
      }
      this.pending.clear();
    }, { once: true });
  }

  send(method, params = {}, timeoutMs = 20_000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), listener]);
  }

  once(method, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const listener = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      this.on(method, listener);
    });
  }

  close() {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

const waitForDebugger = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = response.ok ? await response.json() : [];
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(120);
  }
  throw new Error('Chrome DevTools endpoint did not start.');
};

let cdp = null;
let currentRoute = 'about:blank';
const runtimeErrors = [];
const localNetworkErrors = [];
const requestUrls = new Map();
const failures = [];
const scrollRows = [];
const motionRows = [];
const report = {
  startedAt: new Date().toISOString(),
  origin,
  mode: options.ownerFreeze ? `owner-freeze-${options.ownerFreezePhase}` : targetedMode ? 'targeted' : options.smoke ? 'smoke' : 'full',
  screenshotsEnabled: options.screenshots,
  counts: {
    canonicalRoutes: canonicalRoutes.length,
    clickNavigations: clickPlan.length,
    representativeRoutes: representativeRoutes.length,
    viewports: exactViewports.length,
    functionalAudits: functionalAuditPlan.length
  },
  directLoads: [],
  clickNavigations: [],
  history: [],
  hash: [],
  motion: [],
  responsive: [],
  footers: [],
  interactions: {},
  screenshots: [],
  screenshotBytes: 0,
  runtimeErrors,
  localNetworkErrors,
  failures
};

const fail = (kind, message, context = {}) => {
  failures.push({ kind, message, ...context });
};
const progress = (message) => process.stderr.write(`[visual-polish-qa] ${message}\n`);

const evaluate = async (expression, awaitPromise = true) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed.');
  }
  return result.result?.value;
};

const waitForCondition = async (expression, timeoutMs = 15_000, intervalMs = 60) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true;
    } catch {}
    await delay(intervalMs);
  }
  return false;
};

const setViewport = async (viewport) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    mobile: Boolean(viewport.mobile),
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    positionX: 0,
    positionY: 0,
    dontSetVisibleSize: false
  });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: viewport.scale || 1 });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: Boolean(viewport.mobile),
    maxTouchPoints: viewport.mobile ? 5 : 1
  });
};

const settlePage = async (waitMs = 120) => evaluate(`(async () => {
  if (document.fonts?.ready) {
    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1400))]);
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, ${waitMs}));
  return { pathname: location.pathname, hash: location.hash, scrollY };
})()`);

const dismissCookieBanner = async () => evaluate(`(async () => {
  const banner = document.querySelector('[data-cookie-banner]');
  const close = document.querySelector('[data-cookie-notice-close], [data-cookie-close]');
  if (banner && !banner.hidden && close) close.click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 60));
  if (!banner) return { exists: false, hidden: true, visible: false };
  const style = getComputedStyle(banner);
  const rect = banner.getBoundingClientRect();
  const visible = !banner.hidden && style.display !== 'none' && style.visibility !== 'hidden'
    && Number.parseFloat(style.opacity || '1') > 0.01 && rect.width > 0 && rect.height > 0;
  return { exists: true, hidden: banner.hidden, visible };
})()`).catch(() => false);

const navigateDirect = async (route, waitMs = 120) => {
  const normalized = normalizeRoute(route);
  const target = new URL(normalized, origin);
  currentRoute = `${target.pathname}${target.hash}`;
  const marker = `qa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const alreadyThere = await evaluate(`location.pathname === ${JSON.stringify(target.pathname)}
    && location.hash === ${JSON.stringify(target.hash)}`).catch(() => false);
  await evaluate(`window.__visualPolishQaDocumentMarker = ${JSON.stringify(marker)}`).catch(() => {});
  const navigation = alreadyThere
    ? await cdp.send('Page.reload', { ignoreCache: true })
    : await cdp.send('Page.navigate', { url: target.href });
  if (navigation.errorText) throw new Error(`Navigation failed for ${normalized}: ${navigation.errorText}`);
  const readyPromise = waitForCondition(`document.readyState !== 'loading'
    && location.pathname === ${JSON.stringify(target.pathname)}
    && location.hash === ${JSON.stringify(target.hash)}
    && (${alreadyThere ? `window.__visualPolishQaDocumentMarker !== ${JSON.stringify(marker)}` : 'true'})`, 20_000);
  const ready = await readyPromise;
  if (!ready) throw new Error(`DOM/location readiness timed out for ${normalized}.`);
  await settlePage(waitMs);
  await dismissCookieBanner();
};

const waitForLocalImages = async (timeoutMs = 2600) => evaluate(`(async () => {
  const images = Array.from(document.images).filter((image) => {
    const source = image.currentSrc || image.src;
    if (!source) return false;
    try { return new URL(source, location.href).origin === location.origin; } catch { return false; }
  });
  const videos = Array.from(document.querySelectorAll('video')).filter((video) => {
    const source = video.currentSrc || video.querySelector('source')?.src;
    const style = getComputedStyle(video);
    const rect = video.getBoundingClientRect();
    if (!source || style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return false;
    try { return new URL(source, location.href).origin === location.origin; } catch { return false; }
  });
  images.forEach((image) => { if (image.loading === 'lazy') image.loading = 'eager'; });
  videos.forEach((video) => { video.preload = 'auto'; });
  await Promise.race([
    Promise.all([
      ...images.map(async (image) => {
        if (!image.complete) await new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        });
        if (image.complete && image.naturalWidth > 0 && image.decode) await image.decode().catch(() => {});
      }),
      ...videos.map(async (video) => {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !video.error) {
          await new Promise((resolve) => {
            video.addEventListener('loadeddata', resolve, { once: true });
            video.addEventListener('error', resolve, { once: true });
          });
        }
      })
    ]),
    new Promise((resolve) => setTimeout(resolve, ${timeoutMs}))
  ]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { images: images.length, videos: videos.length };
})()`);

const revealSelector = '[data-reveal], [data-v2-reveal], [data-v2-reveal-stage], [data-v2-hero-scroll-copy]';
const inspectRevealState = async () => evaluate(`(() => {
  const elements = Array.from(document.querySelectorAll(${JSON.stringify(revealSelector)}));
  const rendered = elements.filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && rect.width > 0 && rect.height > 0;
  });
  const opacityZero = rendered.filter((element) => {
    const style = getComputedStyle(element);
    return style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') < 0.01;
  });
  const hidden = elements.filter((element) => element.hidden);
  const pending = elements.filter((element) => element.classList.contains('hv2-reveal-pending'));
  return {
    revealCount: elements.length,
    immersiveStageCount: document.querySelectorAll('.immersive-direction-hero [data-v2-reveal-stage]').length,
    renderedCount: rendered.length,
    pendingCount: pending.length,
    opacityZeroCount: opacityZero.length,
    hiddenCount: hidden.length,
    opacityZero: opacityZero.slice(0, 12).map((element) => ({
      tag: element.tagName,
      className: String(element.className || ''),
      reveal: element.getAttribute('data-v2-reveal') || element.getAttribute('data-reveal') || ''
    }))
  };
})()`);

const settleAllReveals = async () => evaluate(`(async () => {
  const root = document.documentElement;
  const previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  const waitForViewportReveals = async () => {
    const deadline = performance.now() + 420;
    do {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const waiting = Array.from(document.querySelectorAll('.hv2-reveal-pending')).some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom >= -2 && rect.top <= innerHeight + 2;
      });
      if (!waiting) return true;
      await new Promise((resolve) => setTimeout(resolve, 34));
    } while (performance.now() < deadline);
    return false;
  };
  const max = Math.max(0, root.scrollHeight - innerHeight);
  const step = Math.max(260, Math.floor(innerHeight * 0.72));
  for (let top = 0; top < max; top += step) {
    window.scrollTo({ top, left: 0, behavior: 'instant' });
    await waitForViewportReveals();
  }
  window.scrollTo({ top: max, left: 0, behavior: 'instant' });
  await waitForViewportReveals();
  await new Promise((resolve) => setTimeout(resolve, 120));
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 340));
  root.style.scrollBehavior = previousBehavior;
  return scrollY;
})()`);

const placeholderPatterns = [
  'Описание первого экрана',
  'Краткое описание типа изделий',
  'Заголовок блока',
  'Текст блока',
  'Lorem ipsum',
  'Placeholder',
  'Главная V2',
  'dev/internal V2',
  'internal V2 copy'
];

const pageDiagnostics = async (viewportName = '') => evaluate(`(() => {
  const root = document.documentElement;
  // textContent intentionally includes CSS-hidden/helper copy: the public HTML
  // itself must be clean, not merely concealed by a presentation rule.
  const bodyText = document.body?.textContent || '';
  const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id).filter(Boolean);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01
      && rect.width > 0 && rect.height > 0;
  };
  const clippedInline = (element) => {
    let ancestor = element.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  const brokenImages = Array.from(document.images).filter((image) => {
    const source = image.currentSrc || image.src;
    if (!source || !image.complete || image.naturalWidth > 0) return false;
    try { return new URL(source, location.href).origin === location.origin; } catch { return true; }
  }).map((image) => image.currentSrc || image.src);
  const pendingImages = Array.from(document.images).filter((image) => {
    const source = image.currentSrc || image.src;
    if (!source || image.complete) return false;
    try { return new URL(source, location.href).origin === location.origin; } catch { return true; }
  }).map((image) => image.currentSrc || image.src);
  const brokenVideos = Array.from(document.querySelectorAll('video')).filter((video) => video.error)
    .map((video) => video.currentSrc || video.querySelector('source')?.src || '(video)');
  const unreadyVisibleVideos = Array.from(document.querySelectorAll('video')).filter((video) => {
    const source = video.currentSrc || video.querySelector('source')?.src;
    if (!source || !visible(video) || video.error || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return false;
    try { return new URL(source, location.href).origin === location.origin; } catch { return true; }
  }).map((video) => video.currentSrc || video.querySelector('source')?.src || '(video)');
  const emptyHrefs = Array.from(document.querySelectorAll('a')).filter((anchor) =>
    !anchor.hasAttribute('href') || anchor.getAttribute('href')?.trim() === '').length;
  const designLabLinks = Array.from(document.querySelectorAll('a[href]')).filter((anchor) => {
    try { return new URL(anchor.href, location.href).pathname.startsWith('/design-lab/'); } catch { return false; }
  }).map((anchor) => anchor.getAttribute('href'));
  const placeholderHits = ${JSON.stringify(placeholderPatterns)}.filter((pattern) =>
    bodyText.toLocaleLowerCase('ru').includes(pattern.toLocaleLowerCase('ru')));
  const visibleSpinners = Array.from(document.querySelectorAll(
    '[class*="spinner" i], [class*="loader" i], [aria-busy="true"]'
  )).filter(visible).map((element) => ({ tag: element.tagName, className: String(element.className || '') }));
  const horizontalOffenders = Array.from(document.querySelectorAll('body *')).filter((element) => {
    if (!visible(element) || clippedInline(element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.position !== 'fixed' && (rect.left < -1 || rect.right > root.clientWidth + 1);
  }).slice(0, 12).map((element) => ({ tag: element.tagName, className: String(element.className || '') }));
  const horizontalCandidates = Array.from(document.querySelectorAll('body *')).filter((element) => {
    if (!visible(element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.position !== 'fixed' && (rect.left < -1 || rect.right > root.clientWidth + 1);
  }).slice(0, 60).map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      id: element.id || '',
      className: String(element.className || ''),
      text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 96),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflowX: style.overflowX,
      fontSize: style.fontSize,
      minWidth: style.minWidth,
      gridTemplateColumns: style.gridTemplateColumns,
      clippedByAncestor: clippedInline(element)
    };
  });
  const heroScrollCopies = Array.from(document.querySelectorAll('[data-v2-hero-scroll-copy]')).map((copy) => {
    const hero = copy.closest('[data-v2-hero-scroll]');
    const style = getComputedStyle(copy);
    const rect = copy.getBoundingClientRect();
    const heroRect = hero?.getBoundingClientRect();
    const parentRect = copy.parentElement?.getBoundingClientRect();
    const parentStyle = copy.parentElement ? getComputedStyle(copy.parentElement) : null;
    return {
      opacity: Number.parseFloat(style.opacity || '1'),
      transform: style.transform,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      heroTop: heroRect ? Math.round(heroRect.top) : null,
      heroBottom: heroRect ? Math.round(heroRect.bottom) : null,
      heroHeight: heroRect ? Math.round(heroRect.height) : null,
      parentTop: parentRect ? Math.round(parentRect.top) : null,
      parentBottom: parentRect ? Math.round(parentRect.bottom) : null,
      parentHeight: parentRect ? Math.round(parentRect.height) : null,
      parentGridRows: parentStyle?.gridTemplateRows || '',
      parentPaddingTop: parentStyle?.paddingTop || '',
      parentPaddingBottom: parentStyle?.paddingBottom || '',
      scrollOpacity: hero instanceof HTMLElement ? hero.style.getPropertyValue('--v2-hero-scroll-opacity') : ''
    };
  });
  return {
    viewport: ${JSON.stringify(viewportName)},
    route: location.pathname + location.hash,
    width: innerWidth,
    height: innerHeight,
    devicePixelRatio,
    visualScale: visualViewport?.scale || 1,
    scrollY,
    pageHeight: root.scrollHeight,
    horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
    horizontalOffenders,
    horizontalCandidates,
    heroScrollCopies,
    duplicateIds,
    brokenImages,
    pendingImages,
    brokenVideos,
    unreadyVisibleVideos,
    emptyHrefs,
    designLabLinks,
    placeholderHits,
    visibleSpinners,
    h1Count: document.querySelectorAll('h1').length,
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    pendingReveals: document.querySelectorAll('.hv2-reveal-pending').length
  };
})()`);

const waitForLocation = async (route, timeoutMs = 18_000) => {
  const target = new URL(normalizeRoute(route), origin);
  const ready = await waitForCondition(`location.pathname === ${JSON.stringify(target.pathname)}
    && location.hash === ${JSON.stringify(target.hash)}
    && document.readyState !== 'loading'`, timeoutMs);
  if (!ready) throw new Error(`Location did not reach ${target.pathname}${target.hash}.`);
  currentRoute = `${target.pathname}${target.hash}`;
  await settlePage(180);
  await dismissCookieBanner();
};

const prepareRealClick = async (targetRoute) => evaluate(`(async () => {
  const target = new URL(${JSON.stringify(normalizeRoute(targetRoute))}, location.origin);
  const hasLayout = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const candidates = Array.from(document.querySelectorAll('a[href]')).filter((anchor) => {
    if (!hasLayout(anchor) || anchor.target === '_blank') return false;
    try {
      const url = new URL(anchor.href, location.href);
      return url.origin === location.origin && url.pathname === target.pathname && url.hash === target.hash;
    } catch { return false; }
  }).sort((left, right) => {
    const score = (anchor) => anchor.closest('main') ? 0 : anchor.closest('.hv2-footer') ? 1 : anchor.closest('.hv2-header') ? 2 : 3;
    return score(left) - score(right);
  });
  const anchor = candidates[0];
  if (!anchor) return null;
  anchor.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  await new Promise((resolve) => setTimeout(resolve, 820));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const style = getComputedStyle(anchor);
    const rect = anchor.getBoundingClientRect();
    if (style.visibility === 'hidden' || style.pointerEvents === 'none'
      || Number.parseFloat(style.opacity || '1') < 0.01 || rect.width <= 0 || rect.height <= 0) return null;
    const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const hitAnchor = document.elementFromPoint(x, y)?.closest('a[href]');
    if (hitAnchor === anchor) {
      return {
        x,
        y,
        sourceScrollY: scrollY,
        href: anchor.getAttribute('href') || '',
        text: (anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      };
    }
  }
  return null;
})()`);

const dispatchMouseClick = async ({ x, y }) => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

const realClickNavigation = async (source, target, sequence, kind = 'click') => {
  await navigateDirect(source, 100);
  await evaluate(`(() => {
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    window.scrollTo({ top: Math.min(max, Math.max(360, innerHeight * 0.65)), left: 0, behavior: 'instant' });
    return scrollY;
  })()`);
  const click = await prepareRealClick(target);
  if (!click) throw new Error(`No visible real-click anchor from ${source} to ${target}.`);
  await dispatchMouseClick(click);
  try {
    await waitForLocation(target, 2500);
  } catch {
    const retryClick = await prepareRealClick(target);
    if (!retryClick) throw new Error(`Real-click target was obscured from ${source} to ${target}.`);
    await dispatchMouseClick(retryClick);
    await waitForLocation(target);
  }
  const final = await evaluate(`(async () => {
    const first = scrollY;
    await new Promise((resolve) => setTimeout(resolve, 260));
    return { first, settled: scrollY };
  })()`);
  const status = Math.max(Math.abs(final.first), Math.abs(final.settled)) <= 2 ? 'pass' : 'fail';
  const row = {
    kind,
    sequence,
    source_route: source,
    target_route: target,
    route_type: canonicalByRoute.get(target)?.type || '',
    viewport: '1440x900',
    initial_scroll_y: click.sourceScrollY,
    final_scroll_y: final.settled,
    expected_scroll_y: 0,
    hash: new URL(normalizeRoute(target), origin).hash,
    history_action: '',
    status,
    notes: `${click.text} | ${click.href}`
  };
  scrollRows.push(row);
  report.clickNavigations.push({ ...row, firstScrollY: final.first });
  if (status !== 'pass') fail('click-scroll', `${source} -> ${target} ended at scrollY=${final.settled}.`, row);
  return { click, final, row };
};

const invokeHistory = async (method) => {
  await cdp.send('Runtime.evaluate', { expression: `history.${method}()`, userGesture: true }).catch(() => {});
};

const runHistoryAudit = async () => {
  const source = companyRoute;
  const target = contactsRoute;
  await navigateDirect(source, 100);
  const click = await prepareRealClick(target);
  if (!click) throw new Error(`History audit cannot find ${target} on ${source}.`);
  await dispatchMouseClick(click);
  await waitForLocation(target);
  const targetScrollY = await evaluate('scrollY');

  await invokeHistory('back');
  await waitForLocation(source);
  const backScrollY = await evaluate(`(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
    return scrollY;
  })()`);
  const backStatus = Math.abs(backScrollY - click.sourceScrollY) <= 32 ? 'pass' : 'fail';
  const backRow = {
    kind: 'history', sequence: 1, source_route: target, target_route: source,
    route_type: canonicalByRoute.get(source)?.type || '', viewport: '1440x900',
    initial_scroll_y: targetScrollY, final_scroll_y: backScrollY, expected_scroll_y: click.sourceScrollY,
    hash: '', history_action: 'back', status: backStatus,
    notes: `native restoration tolerance 32px; source click scroll=${click.sourceScrollY}`
  };
  scrollRows.push(backRow);
  report.history.push(backRow);
  if (backStatus !== 'pass') fail('history-back', `Back restored ${backScrollY}, expected ${click.sourceScrollY}.`, backRow);

  await invokeHistory('forward');
  await waitForLocation(target);
  const forwardScrollY = await evaluate(`(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
    return scrollY;
  })()`);
  const forwardStatus = Math.abs(forwardScrollY - targetScrollY) <= 4 ? 'pass' : 'fail';
  const forwardRow = {
    kind: 'history', sequence: 2, source_route: source, target_route: target,
    route_type: canonicalByRoute.get(target)?.type || '', viewport: '1440x900',
    initial_scroll_y: backScrollY, final_scroll_y: forwardScrollY, expected_scroll_y: targetScrollY,
    hash: '', history_action: 'forward', status: forwardStatus,
    notes: 'native forward restoration tolerance 4px'
  };
  scrollRows.push(forwardRow);
  report.history.push(forwardRow);
  if (forwardStatus !== 'pass') fail('history-forward', `Forward restored ${forwardScrollY}, expected ${targetScrollY}.`, forwardRow);
};

const runHashAudit = async () => {
  // Product pages expose a real, visible #contact CTA and a matching contact
  // target. The company page has the target but no same-page anchor to click.
  const route = swingProductRoute;
  const hashRoute = `${route}#contact`;
  await navigateDirect(route, 100);
  const click = await prepareRealClick(hashRoute);
  if (!click) throw new Error(`Hash audit cannot find #contact link on ${route}.`);
  await dispatchMouseClick(click);
  await waitForLocation(hashRoute);
  await waitForScrollSettled();
  const clicked = await evaluate(`(() => {
    const target = document.getElementById('contact');
    const rect = target?.getBoundingClientRect();
    return { scrollY, targetTop: rect?.top ?? null, targetBottom: rect?.bottom ?? null, viewportHeight: innerHeight };
  })()`);
  const clickStatus = clicked.scrollY > 2 && clicked.targetTop !== null
    && clicked.targetBottom > 0 && clicked.targetTop < clicked.viewportHeight ? 'pass' : 'fail';
  const clickRow = {
    kind: 'hash', sequence: 1, source_route: route, target_route: hashRoute,
    route_type: canonicalByRoute.get(route)?.type || '', viewport: '1440x900',
    initial_scroll_y: click.sourceScrollY, final_scroll_y: clicked.scrollY, expected_scroll_y: 'anchor',
    hash: '#contact', history_action: 'click', status: clickStatus,
    notes: `targetTop=${clicked.targetTop}; targetBottom=${clicked.targetBottom}`
  };
  scrollRows.push(clickRow);
  report.hash.push(clickRow);
  if (clickStatus !== 'pass') fail('hash-click', `Native #contact click did not reach its anchor.`, clickRow);

  await invokeHistory('back');
  await waitForLocation(route);
  await waitForScrollSettled();
  const backY = await evaluate('scrollY');
  const backStatus = Math.abs(backY - click.sourceScrollY) <= 32 ? 'pass' : 'fail';
  const backRow = {
    kind: 'hash', sequence: 2, source_route: hashRoute, target_route: route,
    route_type: canonicalByRoute.get(route)?.type || '', viewport: '1440x900',
    initial_scroll_y: clicked.scrollY, final_scroll_y: backY, expected_scroll_y: click.sourceScrollY,
    hash: '', history_action: 'back', status: backStatus,
    notes: `remove hash via native Back; restoration tolerance 32px; source click scroll=${click.sourceScrollY}`
  };
  scrollRows.push(backRow);
  report.hash.push(backRow);
  if (backStatus !== 'pass') {
    fail('hash-back', `Back from hash ended at ${backY}, expected ${click.sourceScrollY}.`, backRow);
  }

  await invokeHistory('forward');
  await waitForLocation(hashRoute);
  await waitForScrollSettled();
  const forwarded = await evaluate(`(() => {
    const target = document.getElementById('contact');
    const rect = target?.getBoundingClientRect();
    return { scrollY, targetTop: rect?.top ?? null, targetBottom: rect?.bottom ?? null, viewportHeight: innerHeight };
  })()`);
  const forwardStatus = forwarded.scrollY > 2 && forwarded.targetTop !== null
    && forwarded.targetBottom > 0 && forwarded.targetTop < forwarded.viewportHeight ? 'pass' : 'fail';
  const forwardRow = {
    kind: 'hash', sequence: 3, source_route: route, target_route: hashRoute,
    route_type: canonicalByRoute.get(route)?.type || '', viewport: '1440x900',
    initial_scroll_y: backY, final_scroll_y: forwarded.scrollY, expected_scroll_y: 'anchor',
    hash: '#contact', history_action: 'forward', status: forwardStatus,
    notes: `restore hash via native Forward; targetTop=${forwarded.targetTop}; targetBottom=${forwarded.targetBottom}`
  };
  scrollRows.push(forwardRow);
  report.hash.push(forwardRow);
  if (forwardStatus !== 'pass') fail('hash-forward', `Forward to hash ended at ${forwarded.scrollY}.`, forwardRow);

  await navigateDirect(hashRoute, 100);
  await waitForLocalImages();
  await waitForScrollSettled();
  const directHash = await evaluate(`(() => {
    const target = document.getElementById('contact');
    const rect = target?.getBoundingClientRect();
    return { scrollY, targetTop: rect?.top ?? null, targetBottom: rect?.bottom ?? null, viewportHeight: innerHeight };
  })()`);
  const directStatus = directHash.scrollY > 2 && directHash.targetTop !== null
    && directHash.targetBottom > 0 && directHash.targetTop < directHash.viewportHeight ? 'pass' : 'fail';
  const directRow = {
    kind: 'hash', sequence: 4, source_route: '', target_route: hashRoute,
    route_type: canonicalByRoute.get(route)?.type || '', viewport: '1440x900',
    initial_scroll_y: '', final_scroll_y: directHash.scrollY, expected_scroll_y: 'anchor',
    hash: '#contact', history_action: 'direct', status: directStatus,
    notes: `targetTop=${directHash.targetTop}; targetBottom=${directHash.targetBottom}`
  };
  scrollRows.push(directRow);
  report.hash.push(directRow);
  if (directStatus !== 'pass') fail('hash-direct', `Direct hash load did not reach #contact.`, directRow);
};

const pressKey = async (key, code = key, windowsVirtualKeyCode = key === 'Escape' ? 27 : key === 'Enter' ? 13 : 0) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
};

const waitForScrollSettled = async (timeoutMs = 2200) => evaluate(`(async () => new Promise((resolve) => {
  const started = performance.now();
  let previous = scrollY;
  let stableFrames = 0;
  const sample = () => {
    const current = scrollY;
    stableFrames = Math.abs(current - previous) <= 0.5 ? stableFrames + 1 : 0;
    previous = current;
    if (stableFrames >= 8 || performance.now() - started >= ${timeoutMs}) {
      resolve({ scrollY: current, stableFrames, elapsed: performance.now() - started });
      return;
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}))()`);

const inspectFooter = async () => evaluate(`(() => {
  const footer = document.querySelector('.hv2-footer');
  if (!footer) return { exists: false };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const desktopNav = Array.from(footer.querySelectorAll('.hv2-footer__desktop-nav, .hv2-footer__catalog-desktop-nav'));
  const details = Array.from(footer.querySelectorAll('.hv2-footer__accordion, .hv2-footer__catalog-accordion'));
  const visibleLinks = Array.from(footer.querySelectorAll(
    '.hv2-footer__desktop-nav a[href], .hv2-footer__catalog-desktop-nav a[href], .hv2-footer__accordion-content a[href], .hv2-footer__catalog-accordion-content a[href]'
  )).filter(visible).map((anchor) => new URL(anchor.href, location.href).pathname);
  const duplicates = [...new Set(visibleLinks.filter((href, index) => visibleLinks.indexOf(href) !== index))];
  const firstSummary = details.find((detail) => visible(detail))?.querySelector('summary');
  firstSummary?.focus();
  return {
    exists: true,
    visibleDesktopNav: desktopNav.filter(visible).length,
    visibleDetails: details.filter(visible).length,
    detailsCount: details.length,
    openDetails: details.filter((detail) => detail.open).length,
    visibleLinkDuplicates: duplicates,
    summaryFocused: document.activeElement === firstSummary,
    summaryTag: firstSummary?.tagName || '',
    summaryTabIndex: firstSummary?.tabIndex ?? -1
  };
})()`);

const runFooterAudit = async (routes) => {
  for (const route of routes) {
    for (const viewport of [
      exactViewports.find((item) => item.name === '1440x900'),
      exactViewports.find((item) => item.name === '390x844')
    ]) {
      await setViewport(viewport);
      try {
        await navigateDirect(route, 80);
        const initial = await inspectFooter();
        let accordionOpened = null;
        if (viewport.mobile && initial.summaryFocused) {
          const summaryPoint = await evaluate(`(() => {
            const summary = Array.from(document.querySelectorAll(
              '.hv2-footer__accordion summary, .hv2-footer__catalog-accordion summary'
            )).find((element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            });
            summary?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            const rect = summary?.getBoundingClientRect();
            return rect ? {
              x: Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2)),
              y: Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2))
            } : null;
          })()`);
          if (summaryPoint) await dispatchMouseClick(summaryPoint);
          await delay(80);
          accordionOpened = await evaluate(`Array.from(document.querySelectorAll(
            '.hv2-footer__accordion, .hv2-footer__catalog-accordion'
          )).filter((detail) => getComputedStyle(detail).display !== 'none' && detail.open).length`);
        }
        const expected = viewport.mobile
          ? initial.exists && initial.visibleDesktopNav === 0 && initial.visibleDetails === 2
            && initial.summaryTag === 'SUMMARY' && initial.summaryTabIndex === 0
            && accordionOpened === 1 && initial.visibleLinkDuplicates.length === 0
          : initial.exists && initial.visibleDesktopNav === 2 && initial.visibleDetails === 0
            && initial.visibleLinkDuplicates.length === 0;
        const result = { route, viewport: viewport.name, ...initial, accordionOpened, status: expected ? 'pass' : 'fail' };
        report.footers.push(result);
        if (!expected) fail('footer-variant', `Footer variant failed on ${route} at ${viewport.name}.`, result);
      } catch (error) {
        const result = { route, viewport: viewport.name, status: 'fail', error: String(error) };
        report.footers.push(result);
        fail('footer-exception', String(error), result);
      }
    }
  }
};

const waitForMap = async (timeoutMs = 12_000) => evaluate(`new Promise((resolve) => {
  const started = performance.now();
  const inspect = () => {
    const frame = document.querySelector('.practical-yandex-map iframe')
      || document.querySelector('iframe[src*="map-widget" i], iframe[src*="api-maps" i]');
    const rect = frame?.getBoundingClientRect();
    if (frame && rect?.width > 100 && rect?.height > 100) {
      let loadObserved = false;
      frame.addEventListener('load', () => { loadObserved = true; }, { once: true });
      frame.loading = 'eager';
      frame.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const readyStarted = performance.now();
      const inspectReady = () => {
        const currentRect = frame.getBoundingClientRect();
        const resourceObserved = performance.getEntriesByName(frame.src).some((entry) => entry.responseEnd > 0);
        const ready = loadObserved || resourceObserved;
        if (ready || performance.now() - readyStarted >= Math.min(4800, ${timeoutMs})) {
          resolve({
            src: frame.src,
            title: frame.title,
            width: currentRect.width,
            height: currentRect.height,
            loadObserved,
            resourceObserved,
            ready,
            frameWindow: Boolean(frame.contentWindow),
            containerReady: frame.closest('[data-v2-yandex-map]')?.dataset.v2MapReady === 'true'
          });
          return;
        }
        setTimeout(inspectReady, 120);
      };
      setTimeout(inspectReady, 120);
      return;
    }
    if (performance.now() - started >= ${timeoutMs}) { resolve(null); return; }
    setTimeout(inspect, 160);
  };
  inspect();
})`);

const runInteractionAudit = async (name, audit) => {
  progress(`interaction ${name}`);
  try {
    const result = await audit();
    const { pass, ...details } = result || {};
    const recorded = { status: pass ? 'pass' : 'fail', ...details };
    report.interactions[name] = recorded;
    if (!pass) fail('functional-interaction', `${name} failed.`, { interaction: name, ...details });
  } catch (error) {
    const recorded = { status: 'fail', error: error instanceof Error ? error.stack : String(error) };
    report.interactions[name] = recorded;
    fail('functional-interaction-exception', `${name}: ${String(error)}`, { interaction: name });
  }
};

const auditHomeVideoInteraction = async (name, viewportName, mode) => runInteractionAudit(name, async () => {
  const viewport = exactViewports.find((item) => item.name === viewportName);
  await setViewport(viewport);
  await navigateDirect(homeRoute, 120);
  await waitForLocalImages(6500);
  const media = await evaluate(`(() => {
    const element = document.querySelector('[data-hv2-hero-video]');
    const hero = document.querySelector('[data-hv2-hero]');
    const poster = hero?.querySelector('.hv2-hero__poster img');
    const control = document.querySelector('[data-hv2-video-toggle]');
    if (!element) return { video: { exists: false, sources: [] }, poster: {}, control: {} };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      heroPlaying: hero?.classList.contains('is-video-playing') || false,
      video: {
        exists: true,
        sources: Array.from(element.querySelectorAll('source')).map((source) => ({
          src: source.getAttribute('src') || '',
          media: source.getAttribute('media') || ''
        })),
        dataSource: element.dataset.hv2VideoSrc || '',
        srcAttribute: element.getAttribute('src') || '',
        currentSrc: element.currentSrc,
        poster: element.getAttribute('poster') || '',
        readyState: element.readyState,
        paused: element.paused,
        error: element.error ? { code: element.error.code, message: element.error.message } : null,
        visible: style.display !== 'none' && style.visibility !== 'hidden'
          && Number.parseFloat(style.opacity || '1') > 0.01 && rect.width > 0 && rect.height > 0
      },
      poster: poster ? {
        exists: true,
        currentSrc: poster.currentSrc,
        complete: poster.complete,
        naturalWidth: poster.naturalWidth
      } : { exists: false },
      control: control ? {
        exists: true,
        hidden: control.hidden,
        visible: getComputedStyle(control).display !== 'none' && !control.hidden,
        label: control.textContent?.trim() || '',
        ariaLabel: control.getAttribute('aria-label') || ''
      } : { exists: false }
    };
  })()`);
  const video = media.video;
  const sourcePaths = video.sources.map((source) => {
    try { return new URL(source.src, origin).pathname; } catch { return source.src; }
  });
  const currentPath = (() => {
    if (!video.currentSrc) return '';
    try { return new URL(video.currentSrc, origin).pathname; } catch { return video.currentSrc || ''; }
  })();
  const dataSourcePath = (() => {
    if (!video.dataSource) return '';
    try { return new URL(video.dataSource, origin).pathname; } catch { return video.dataSource || ''; }
  })();
  const posterPath = (() => {
    if (!media.poster.currentSrc) return '';
    try { return new URL(media.poster.currentSrc, origin).pathname; } catch { return media.poster.currentSrc || ''; }
  })();
  const declarativeSourcesRemoved = sourcePaths.length === 0;
  const desktopContract = mode === 'desktop-video'
    && dataSourcePath === homePageRecord.heroMediaVideo
    && currentPath === homePageRecord.heroMediaVideo
    && declarativeSourcesRemoved
    && video.readyState >= 2
    && !video.error
    && video.visible
    && media.heroPlaying
    && media.control.exists
    && !media.control.hidden
    && media.control.visible;
  const mobileContract = mode === 'mobile-poster'
    && dataSourcePath === homePageRecord.heroMediaVideo
    && currentPath === ''
    && video.srcAttribute === ''
    && declarativeSourcesRemoved
    && !video.visible
    && !media.heroPlaying
    && media.poster.exists
    && media.poster.complete
    && media.poster.naturalWidth > 0
    && posterPath === homePageRecord.heroMediaPosterMobile
    && media.control.exists
    && (media.control.hidden || !media.control.visible);
  const controlCycle = desktopContract ? await evaluate(`(async () => {
    const element = document.querySelector('[data-hv2-hero-video]');
    const hero = document.querySelector('[data-hv2-hero]');
    const control = document.querySelector('[data-hv2-video-toggle]');
    if (!element || !control) return { pauseObserved: false, resumeObserved: false, released: false };
    control.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const pauseObserved = element.paused;
    const pauseLabel = control.textContent?.trim() || '';
    const playing = new Promise((resolve) => element.addEventListener('playing', () => resolve(true), { once: true }));
    control.click();
    const playingEvent = await Promise.race([
      playing,
      new Promise((resolve) => setTimeout(() => resolve(false), 1800))
    ]);
    const resumeObserved = Boolean(playingEvent) && !element.paused;
    element.pause();
    hero?.classList.remove('is-video-playing');
    return {
      pauseObserved,
      resumeObserved,
      pauseLabel,
      released: element.paused
    };
  })()`) : null;
  const interactionContract = mode === 'desktop-video'
    ? desktopContract && controlCycle?.pauseObserved && controlCycle?.resumeObserved && controlCycle?.released
    : mobileContract;
  return {
    pass: video.exists && interactionContract,
    route: homeRoute,
    viewport: viewport.name,
    mode,
    desktopContract,
    mobileContract,
    controlCycle,
    declarativeSourcesRemoved,
    sourcePaths,
    dataSourcePath,
    currentPath,
    posterPath,
    media
  };
});

const runFunctionalInteractionAudits = async () => {
  progress('bounded functional interaction assertions');

  await runInteractionAudit('desktop-dropdown-keyboard', async () => {
    const viewport = exactViewports.find((item) => item.name === '1440x900');
    await setViewport(viewport);
    await navigateDirect(swingsCategoryRoute, 100);
    const prepared = await evaluate(`(() => {
      const trigger = document.querySelector('[data-hv2-dropdown-trigger]');
      const group = trigger?.closest('[data-hv2-dropdown]');
      const first = group?.querySelector('[data-hv2-dropdown-link]');
      trigger?.focus();
      return { exists: Boolean(trigger && group && first), initiallyExpanded: trigger?.getAttribute('aria-expanded') || '' };
    })()`);
    await pressKey('ArrowDown', 'ArrowDown', 40);
    await delay(100);
    const opened = await evaluate(`(() => {
      const trigger = document.querySelector('[data-hv2-dropdown-trigger]');
      const group = trigger?.closest('[data-hv2-dropdown]');
      const panel = group?.querySelector('[data-hv2-dropdown-panel]');
      const first = group?.querySelector('[data-hv2-dropdown-link]');
      const style = panel ? getComputedStyle(panel) : null;
      return {
        expanded: trigger?.getAttribute('aria-expanded') === 'true',
        openClass: Boolean(group?.classList.contains('is-open')),
        panelVisible: Boolean(style && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01),
        firstLinkFocused: document.activeElement === first
      };
    })()`);
    await pressKey('Escape', 'Escape', 27);
    await delay(100);
    const closed = await evaluate(`(() => {
      const trigger = document.querySelector('[data-hv2-dropdown-trigger]');
      const group = trigger?.closest('[data-hv2-dropdown]');
      return {
        collapsed: trigger?.getAttribute('aria-expanded') === 'false',
        openClassRemoved: !group?.classList.contains('is-open'),
        focusReturned: document.activeElement === trigger
      };
    })()`);
    return {
      pass: prepared.exists && prepared.initiallyExpanded === 'false'
        && Object.values(opened).every(Boolean) && Object.values(closed).every(Boolean),
      route: swingsCategoryRoute,
      viewport: viewport.name,
      prepared,
      opened,
      closed
    };
  });

  await runInteractionAudit('mobile-menu-lock-focus-escape', async () => {
    const viewport = exactViewports.find((item) => item.name === '390x844');
    await setViewport(viewport);
    await navigateDirect(swingsCategoryRoute, 100);
    const before = await evaluate(`(async () => {
      const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      window.scrollTo({ top: Math.min(max, 500), left: 0, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const shell = document.querySelector('.hv2-header .hv2-shell')?.getBoundingClientRect();
      return {
        scrollY,
        clientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.getBoundingClientRect().width,
        shellWidth: shell?.width || 0
      };
    })()`);
    await evaluate(`(() => {
      const opener = document.querySelector('[data-hv2-mobile-open]');
      opener?.focus();
      opener?.click();
    })()`);
    await delay(380);
    const opened = await evaluate(`(() => {
      const menu = document.querySelector('[data-hv2-mobile-menu]');
      const close = document.querySelector('[data-hv2-mobile-close]');
      const opener = document.querySelector('[data-hv2-mobile-open]');
      const shell = document.querySelector('.hv2-header .hv2-shell')?.getBoundingClientRect();
      return {
        visible: Boolean(menu && !menu.hidden && menu.classList.contains('is-open')),
        ariaVisible: menu?.getAttribute('aria-hidden') === 'false',
        expanded: opener?.getAttribute('aria-expanded') === 'true',
        initialFocus: document.activeElement === close,
        bodyLocked: getComputedStyle(document.body).position === 'fixed'
          && document.body.style.overflow === 'hidden',
        bodyTop: document.body.style.top,
        htmlLocked: document.documentElement.classList.contains('hv2-menu-open'),
        mainInert: document.querySelector('main')?.hasAttribute('inert') || false,
        headerInert: document.querySelector('[data-home-v2-header]')?.hasAttribute('inert') || false,
        scrollY,
        clientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.getBoundingClientRect().width,
        shellWidth: shell?.width || 0
      };
    })()`);
    const trap = await evaluate(`(() => {
      const menu = document.querySelector('[data-hv2-mobile-menu]');
      const items = Array.from(menu?.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []).filter((item) => !item.hasAttribute('hidden'));
      const first = items[0];
      const last = items.at(-1);
      last?.focus();
      last?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      const forwardWrapped = document.activeElement === first;
      first?.focus();
      first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      return { itemCount: items.length, forwardWrapped, backwardWrapped: document.activeElement === last };
    })()`);
    await pressKey('Escape', 'Escape', 27);
    await delay(380);
    const closed = await evaluate(`(() => {
      const menu = document.querySelector('[data-hv2-mobile-menu]');
      const opener = document.querySelector('[data-hv2-mobile-open]');
      const shell = document.querySelector('.hv2-header .hv2-shell')?.getBoundingClientRect();
      return {
        hidden: Boolean(menu?.hidden),
        ariaHidden: menu?.getAttribute('aria-hidden') === 'true',
        collapsed: opener?.getAttribute('aria-expanded') === 'false',
        focusReturned: document.activeElement === opener,
        bodyUnlocked: getComputedStyle(document.body).position !== 'fixed'
          && document.body.style.overflow === '',
        htmlUnlocked: !document.documentElement.classList.contains('hv2-menu-open'),
        mainNotInert: !document.querySelector('main')?.hasAttribute('inert'),
        headerNotInert: !document.querySelector('[data-home-v2-header]')?.hasAttribute('inert'),
        scrollY,
        clientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.getBoundingClientRect().width,
        shellWidth: shell?.width || 0
      };
    })()`);
    const openingWidthStable = Math.abs(opened.clientWidth - before.clientWidth) <= 1
      && Math.abs(opened.bodyWidth - before.bodyWidth) <= 1
      && Math.abs(opened.shellWidth - before.shellWidth) <= 1;
    const closingWidthStable = Math.abs(closed.clientWidth - before.clientWidth) <= 1
      && Math.abs(closed.bodyWidth - before.bodyWidth) <= 1
      && Math.abs(closed.shellWidth - before.shellWidth) <= 1;
    const parsedBodyTop = Number.parseFloat(opened.bodyTop);
    const effectiveLockedScroll = Number.isFinite(parsedBodyTop) ? -parsedBodyTop : opened.scrollY;
    const openingScrollStable = Math.abs(effectiveLockedScroll - before.scrollY) <= 2;
    const restoredScroll = Math.abs(closed.scrollY - before.scrollY) <= 2;
    return {
      pass: before.scrollY > 2 && opened.visible && opened.ariaVisible && opened.expanded
        && opened.initialFocus && opened.bodyLocked && opened.htmlLocked && opened.mainInert && opened.headerInert
        && trap.itemCount > 2 && trap.forwardWrapped && trap.backwardWrapped
        && Object.values(closed).slice(0, 8).every(Boolean)
        && openingWidthStable && closingWidthStable && openingScrollStable && restoredScroll,
      route: swingsCategoryRoute,
      viewport: viewport.name,
      before,
      opened,
      trap,
      closed,
      openingWidthStable,
      closingWidthStable,
      openingScrollStable,
      effectiveLockedScroll,
      restoredScroll
    };
  });

  await runInteractionAudit('product-gallery-navigation-fullscreen-swipe', async () => {
    const desktop = exactViewports.find((item) => item.name === '1440x900');
    await setViewport(desktop);
    await navigateDirect(mediaRichProductRoute, 120);
    const navigation = await evaluate(`(async () => {
      const status = document.querySelector('[data-v2-gallery-status]');
      const main = document.querySelector('[data-v2-gallery-main]');
      const next = document.querySelector('[data-v2-gallery-next]');
      const thumbs = Array.from(document.querySelectorAll('[data-v2-gallery-thumb]'));
      const before = { status: status?.textContent.trim() || '', src: main?.getAttribute('src') || '' };
      next?.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const afterNext = { status: status?.textContent.trim() || '', src: main?.getAttribute('src') || '' };
      const target = thumbs.at(-1);
      target?.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const targetIndex = Number(target?.dataset.v2GalleryIndex || -1);
      const expectedStatus = targetIndex >= 0 ? String(targetIndex + 1) + ' / ' + String(thumbs.length) : '';
      let srcMatchesThumb = false;
      try {
        srcMatchesThumb = new URL(main?.getAttribute('src') || '', location.href).pathname
          === new URL(target?.dataset.v2GallerySrc || '', location.href).pathname;
      } catch {}
      return {
        before,
        afterNext,
        afterThumb: { status: status?.textContent.trim() || '', src: main?.getAttribute('src') || '' },
        thumbCount: thumbs.length,
        targetIndex,
        expectedStatus,
        targetPressed: target?.getAttribute('aria-pressed') === 'true',
        srcMatchesThumb
      };
    })()`);
    const opened = await evaluate(`(async () => {
      const opener = document.querySelector('[data-v2-gallery-open]');
      const dialog = document.querySelector('[data-v2-product-lightbox]');
      opener?.focus();
      opener?.click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      const image = dialog?.querySelector('[data-v2-lightbox-image]');
      if (image && !image.complete) await Promise.race([
        new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }),
        new Promise((resolve) => setTimeout(resolve, 2200))
      ]);
      return {
        open: Boolean(dialog?.open),
        closeFocused: document.activeElement === dialog?.querySelector('[data-v2-lightbox-close]'),
        htmlLocked: document.documentElement.classList.contains('v2-lightbox-open'),
        imageReady: Boolean(image?.complete && image.naturalWidth > 0),
        imageFit: image ? getComputedStyle(image).objectFit : ''
      };
    })()`);
    await pressKey('Escape', 'Escape', 27);
    await delay(140);
    const closed = await evaluate(`(() => ({
      closed: !document.querySelector('[data-v2-product-lightbox]')?.open,
      focusReturned: document.activeElement === document.querySelector('[data-v2-gallery-open]'),
      htmlUnlocked: !document.documentElement.classList.contains('v2-lightbox-open')
    }))()`);

    const mobile = exactViewports.find((item) => item.name === '390x844');
    await setViewport(mobile);
    await navigateDirect(mediaRichProductRoute, 100);
    const swipe = await evaluate(`(async () => {
      const stage = document.querySelector('.v2-product-gallery__stage');
      const status = document.querySelector('[data-v2-gallery-status]');
      stage?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 140));
      const before = status?.textContent.trim() || '';
      const scrollBefore = scrollY;
      stage?.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerType: 'touch', pointerId: 41, clientX: 320, clientY: 330
      }));
      stage?.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerType: 'touch', pointerId: 41, clientX: 90, clientY: 336
      }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterHorizontal = status?.textContent.trim() || '';
      stage?.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerType: 'touch', pointerId: 42, clientX: 200, clientY: 220
      }));
      stage?.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerType: 'touch', pointerId: 42, clientX: 207, clientY: 380
      }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        before,
        afterHorizontal,
        afterVertical: status?.textContent.trim() || '',
        scrollBefore,
        scrollAfter: scrollY,
        touchAction: stage ? getComputedStyle(stage).touchAction : ''
      };
    })()`);
    const navigationPassed = navigation.thumbCount > 1
      && navigation.before.status !== navigation.afterNext.status
      && navigation.before.src !== navigation.afterNext.src
      && navigation.afterThumb.status === navigation.expectedStatus
      && navigation.targetPressed && navigation.srcMatchesThumb;
    const fullscreenPassed = opened.open && opened.closeFocused && opened.htmlLocked
      && opened.imageReady && opened.imageFit === 'contain'
      && closed.closed && closed.focusReturned && closed.htmlUnlocked;
    const swipePassed = swipe.before !== swipe.afterHorizontal
      && swipe.afterHorizontal === swipe.afterVertical
      && Math.abs(swipe.scrollAfter - swipe.scrollBefore) <= 2;
    return {
      pass: navigationPassed && fullscreenPassed && swipePassed,
      route: mediaRichProductRoute,
      desktopViewport: desktop.name,
      mobileViewport: mobile.name,
      navigation,
      opened,
      closed,
      swipe,
      navigationPassed,
      fullscreenPassed,
      swipePassed
    };
  });

  await runInteractionAudit('project-gallery-navigation-fullscreen', async () => {
    const viewport = exactViewports.find((item) => item.name === '1440x900');
    await setViewport(viewport);
    await navigateDirect(industrialProjectRoute, 120);
    const navigation = await evaluate(`(async () => {
      const status = document.querySelector('[data-v2-project-gallery-status]');
      const main = document.querySelector('[data-v2-project-gallery-main]');
      const next = document.querySelector('[data-v2-project-gallery-next]');
      const before = { status: status?.textContent.trim() || '', src: main?.getAttribute('src') || '' };
      next?.click();
      await new Promise((resolve) => setTimeout(resolve, 140));
      return {
        before,
        after: { status: status?.textContent.trim() || '', src: main?.getAttribute('src') || '' }
      };
    })()`);
    const opened = await evaluate(`(async () => {
      const opener = document.querySelector('[data-v2-project-gallery-open]');
      const dialog = document.querySelector('[data-v2-project-lightbox]');
      opener?.focus();
      opener?.click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      const image = dialog?.querySelector('[data-v2-project-lightbox-image]');
      if (image && !image.complete) await Promise.race([
        new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }),
        new Promise((resolve) => setTimeout(resolve, 2200))
      ]);
      return {
        open: Boolean(dialog?.open),
        closeFocused: document.activeElement === dialog?.querySelector('[data-v2-project-lightbox-close]'),
        htmlLocked: document.documentElement.classList.contains('v2-project-lightbox-open'),
        imageReady: Boolean(image?.complete && image.naturalWidth > 0),
        imageFit: image ? getComputedStyle(image).objectFit : ''
      };
    })()`);
    await pressKey('Escape', 'Escape', 27);
    await delay(140);
    const closed = await evaluate(`(() => ({
      closed: !document.querySelector('[data-v2-project-lightbox]')?.open,
      focusReturned: document.activeElement === document.querySelector('[data-v2-project-gallery-open]'),
      htmlUnlocked: !document.documentElement.classList.contains('v2-project-lightbox-open')
    }))()`);
    return {
      pass: navigation.before.status !== navigation.after.status
        && navigation.before.src !== navigation.after.src
        && opened.open && opened.closeFocused && opened.htmlLocked
        && opened.imageReady && opened.imageFit === 'contain'
        && closed.closed && closed.focusReturned && closed.htmlUnlocked,
      route: industrialProjectRoute,
      viewport: viewport.name,
      navigation,
      opened,
      closed
    };
  });

  await runInteractionAudit('contacts-map-frame', async () => {
    const viewport = exactViewports.find((item) => item.name === '1440x900');
    await setViewport(viewport);
    await navigateDirect(contactsRoute, 120);
    const map = await waitForMap();
    const details = await evaluate(`(() => ({
      link: document.querySelector('.practical-contacts__map-link')?.href || '',
      containerReady: document.querySelector('[data-v2-yandex-map]')?.dataset.v2MapReady === 'true'
    }))()`);
    const frameConstructorId = map?.src ? new URL(map.src).searchParams.get('um') : '';
    const linkConstructorId = details.link ? new URL(details.link).searchParams.get('um') : '';
    return {
      pass: Boolean(map?.ready && map.frameWindow && map.containerReady && details.containerReady
        && map.width > 100 && map.height > 100 && map.title.includes('Яндекс')
        && frameConstructorId === expectedMapConstructorId
        && linkConstructorId === expectedMapConstructorId),
      route: contactsRoute,
      viewport: viewport.name,
      expectedMapConstructorId,
      frameConstructorId,
      linkConstructorId,
      map,
      details
    };
  });

  const auditHomeVideo = async (name, viewportName, mode) => runInteractionAudit(name, async () => {
    const viewport = exactViewports.find((item) => item.name === viewportName);
    await setViewport(viewport);
    await navigateDirect(homeRoute, 120);
    await waitForLocalImages(6500);
    const media = await evaluate(`(() => {
      const element = document.querySelector('[data-hv2-hero-video]');
      const hero = document.querySelector('[data-hv2-hero]');
      const poster = hero?.querySelector('.hv2-hero__poster img');
      const control = document.querySelector('[data-hv2-video-toggle]');
      if (!element) return { video: { exists: false, sources: [] }, poster: {}, control: {} };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        heroPlaying: hero?.classList.contains('is-video-playing') || false,
        video: {
          exists: true,
          sources: Array.from(element.querySelectorAll('source')).map((source) => ({
            src: source.getAttribute('src') || '',
            media: source.getAttribute('media') || ''
          })),
          dataSource: element.dataset.hv2VideoSrc || '',
          srcAttribute: element.getAttribute('src') || '',
          currentSrc: element.currentSrc,
          poster: element.getAttribute('poster') || '',
          readyState: element.readyState,
          paused: element.paused,
          error: element.error ? { code: element.error.code, message: element.error.message } : null,
          visible: style.display !== 'none' && style.visibility !== 'hidden'
            && Number.parseFloat(style.opacity || '1') > 0.01 && rect.width > 0 && rect.height > 0
        },
        poster: poster ? {
          exists: true,
          currentSrc: poster.currentSrc,
          complete: poster.complete,
          naturalWidth: poster.naturalWidth
        } : { exists: false },
        control: control ? {
          exists: true,
          hidden: control.hidden,
          visible: getComputedStyle(control).display !== 'none' && !control.hidden,
          label: control.textContent?.trim() || '',
          ariaLabel: control.getAttribute('aria-label') || ''
        } : { exists: false }
      };
    })()`);
    const video = media.video;
    const sourcePaths = video.sources.map((source) => {
      try { return new URL(source.src, origin).pathname; } catch { return source.src; }
    });
    const currentPath = (() => {
      if (!video.currentSrc) return '';
      try { return new URL(video.currentSrc, origin).pathname; } catch { return video.currentSrc || ''; }
    })();
    const dataSourcePath = (() => {
      if (!video.dataSource) return '';
      try { return new URL(video.dataSource, origin).pathname; } catch { return video.dataSource || ''; }
    })();
    const posterPath = (() => {
      if (!media.poster.currentSrc) return '';
      try { return new URL(media.poster.currentSrc, origin).pathname; } catch { return media.poster.currentSrc || ''; }
    })();
    const declarativeSourcesRemoved = sourcePaths.length === 0;
    const desktopContract = mode === 'desktop-video'
      && dataSourcePath === homePageRecord.heroMediaVideo
      && currentPath === homePageRecord.heroMediaVideo
      && declarativeSourcesRemoved
      && video.readyState >= 2
      && !video.error
      && video.visible
      && media.heroPlaying
      && media.control.exists
      && !media.control.hidden
      && media.control.visible;
    const mobileContract = mode === 'mobile-poster'
      && dataSourcePath === homePageRecord.heroMediaVideo
      && currentPath === ''
      && video.srcAttribute === ''
      && declarativeSourcesRemoved
      && !video.visible
      && !media.heroPlaying
      && media.poster.exists
      && media.poster.complete
      && media.poster.naturalWidth > 0
      && posterPath === homePageRecord.heroMediaPosterMobile
      && media.control.exists
      && (media.control.hidden || !media.control.visible);
    return {
      pass: video.exists && (desktopContract || mobileContract),
      route: homeRoute,
      viewport: viewport.name,
      mode,
      desktopContract,
      mobileContract,
      declarativeSourcesRemoved,
      sourcePaths,
      dataSourcePath,
      currentPath,
      posterPath,
      media
    };
  });

  if (!report.interactions['home-video-mobile']) {
    await auditHomeVideo('home-video-mobile', '390x844', 'mobile-poster');
  }
};

const prepareProofPage = async () => {
  await dismissCookieBanner();
  await waitForLocalImages(6500);
  await settleAllReveals();
  await evaluate(`(async () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 320));
    return scrollY;
  })()`);
  const cookie = await evaluate(`(() => {
    const banner = document.querySelector('[data-cookie-banner]');
    if (!banner) return { exists: false, visible: false };
    const style = getComputedStyle(banner);
    const rect = banner.getBoundingClientRect();
    return {
      exists: true,
      visible: !banner.hidden && style.display !== 'none' && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0.01 && rect.width > 0 && rect.height > 0
    };
  })()`);
  if (cookie.visible) throw new Error('Proof capture is obstructed by a visible cookie banner.');
  const diagnostics = await pageDiagnostics('proof');
  if (diagnostics.brokenImages.length || diagnostics.pendingImages.length || diagnostics.brokenVideos.length
    || diagnostics.unreadyVisibleVideos.length || diagnostics.visibleSpinners.length) {
    throw new Error(`Proof media is not ready: ${JSON.stringify({
      brokenImages: diagnostics.brokenImages,
      pendingImages: diagnostics.pendingImages,
      brokenVideos: diagnostics.brokenVideos,
      unreadyVisibleVideos: diagnostics.unreadyVisibleVideos,
      visibleSpinners: diagnostics.visibleSpinners
    })}`);
  }
};

const captureViewport = async (target) => {
  const viewport = exactViewports.find((item) => item.name === target.viewport);
  if (!viewport) throw new Error(`Unknown screenshot viewport ${target.viewport}.`);
  await setViewport(viewport);
  await navigateDirect(target.route, 160);
  if (target.waitForMap) {
    const map = await waitForMap();
    if (!map?.ready) throw new Error(`Yandex map did not become ready for ${target.file}: ${JSON.stringify(map)}.`);
  }
  await prepareProofPage();
  let geometry = null;
  if (target.action === 'footer') {
    await evaluate(`(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 220));
      return scrollY;
    })()`);
    geometry = await evaluate(`(() => {
      const footer = document.querySelector('.hv2-footer');
      const ctaCandidates = [...document.querySelectorAll('.hv2-contact, .v2-direct-contact, .custom-order-contact, .practical-contacts__cta')];
      const cta = ctaCandidates.at(-1) || null;
      const grid = footer?.querySelector('.hv2-footer__grid');
      const legal = footer?.querySelector('.hv2-footer__legal');
      const metrics = (element) => element ? {
        height: Math.round(element.getBoundingClientRect().height),
        minHeight: getComputedStyle(element).minHeight,
        paddingTop: getComputedStyle(element).paddingTop,
        paddingBottom: getComputedStyle(element).paddingBottom
      } : null;
      return {
        viewportHeight: innerHeight,
        cta: metrics(cta),
        footer: metrics(footer),
        grid: metrics(grid),
        legal: metrics(legal),
        combinedHeight: Math.round((cta?.getBoundingClientRect().height || 0) + (footer?.getBoundingClientRect().height || 0))
      };
    })()`);
  } else if (target.action === 'hero-mid') {
    const moved = await evaluate(`(async () => {
      const hero = document.querySelector('[data-v2-hero-scroll]');
      if (!hero) return null;
      const rect = hero.getBoundingClientRect();
      const top = scrollY + rect.top;
      window.scrollTo({ top: top + rect.height * 0.52, left: 0, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 260));
      return { scrollY, heroTop: top, heroHeight: rect.height };
    })()`);
    if (!moved) throw new Error(`Hero scroll target is missing for ${target.file}.`);
  } else if (target.action === 'selector') {
    const moved = await evaluate(`(async () => {
      const element = document.querySelector(${JSON.stringify(target.selector || '')});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const offset = Math.max(84, Math.min(118, innerHeight * 0.11));
      window.scrollTo({ top: Math.max(0, scrollY + rect.top - offset), left: 0, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 260));
      return { scrollY, selector: ${JSON.stringify(target.selector || '')} };
    })()`);
    if (!moved) throw new Error(`Selector ${target.selector} is missing for ${target.file}.`);
  } else if (target.action === 'gallery-second') {
    const moved = await evaluate(`(async () => {
      const section = document.querySelector(${JSON.stringify(target.selector || '')});
      const thumb = section?.querySelector('[data-v2-gallery-thumb][data-v2-gallery-index="1"]');
      if (!section || !thumb) return null;
      const rect = section.getBoundingClientRect();
      const offset = Math.max(84, Math.min(118, innerHeight * 0.11));
      window.scrollTo({ top: Math.max(0, scrollY + rect.top - offset), left: 0, behavior: 'instant' });
      thumb.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const image = section.querySelector('[data-v2-gallery-main]');
      if (image && !image.complete) await Promise.race([
        new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }),
        new Promise((resolve) => setTimeout(resolve, 4000))
      ]);
      if (image?.decode && image.naturalWidth > 0) await image.decode().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 180));
      return { current: section.querySelector('[data-v2-product-gallery]')?.dataset.v2GalleryCurrent || '' };
    })()`);
    if (!moved || moved.current !== '1') throw new Error(`Contextual gallery image did not open for ${target.file}.`);
  } else if (target.action === 'product-fullscreen') {
    const opened = await evaluate(`(async () => {
      const opener = document.querySelector('[data-v2-gallery-open]');
      const dialog = document.querySelector('[data-v2-product-lightbox]');
      if (!opener || !dialog) return false;
      opener.click();
      await new Promise((resolve) => setTimeout(resolve, 220));
      const image = dialog.querySelector('img');
      if (image && !image.complete) await Promise.race([
        new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }),
        new Promise((resolve) => setTimeout(resolve, 4000))
      ]);
      if (image?.decode && image.naturalWidth > 0) await image.decode().catch(() => {});
      return Boolean(dialog.open && image?.complete && image.naturalWidth > 0);
    })()`);
    if (!opened) throw new Error(`Product fullscreen did not open for ${target.file}.`);
  } else {
    const top = await evaluate('scrollY');
    if (Math.abs(top) > 2) throw new Error(`${target.file} is not at scrollY=0 (${top}).`);
  }
  if (!geometry) {
    geometry = await evaluate(`(() => {
      const metrics = (selector) => {
        if (!selector) return null;
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height),
          transform: getComputedStyle(element).transform
        };
      };
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        screenWidth: screen.width,
        documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
        viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
        visualViewport: window.visualViewport ? {
          width: Math.round(window.visualViewport.width),
          height: Math.round(window.visualViewport.height),
          scale: Number(window.visualViewport.scale.toFixed(3))
        } : null,
        widthCandidates: Array.from(document.querySelectorAll('body *')).map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            element: element.tagName.toLowerCase()
              + (element.id ? '#' + element.id : '')
              + (element.classList.length ? '.' + Array.from(element.classList).slice(0, 3).join('.') : ''),
            width: Math.round(rect.width),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            minWidth: style.minWidth,
            whiteSpace: style.whiteSpace,
            gridTemplateColumns: style.gridTemplateColumns
          };
        }).filter((entry) => entry.scrollWidth > screen.width + 1 || entry.width > screen.width + 1)
          .sort((a, b) => Math.max(b.scrollWidth, b.width) - Math.max(a.scrollWidth, a.width))
          .slice(0, 12),
        scrollY: Math.round(scrollY),
        header: metrics('.hv2-header'),
        headerBrand: (() => {
          const element = document.querySelector('.hv2-header__brand');
          const image = element?.querySelector('img');
          return element ? {
            ...metrics('.hv2-header__brand'),
            opacity: getComputedStyle(element).opacity,
            visibility: getComputedStyle(element).visibility,
            imageOpacity: image ? getComputedStyle(image).opacity : null,
            imageFilter: image ? getComputedStyle(image).filter : null,
            imageNaturalWidth: image?.naturalWidth || 0
          } : null;
        })(),
        breadcrumbs: metrics('.v2-breadcrumbs-bar'),
        hero: metrics('[data-v2-hero-scroll]'),
        heroGrid: metrics('[data-v2-hero-scroll] .v2-catalog-hero__grid'),
        heroCopy: metrics('[data-v2-hero-scroll-copy]'),
        heroMedia: metrics('[data-v2-hero-scroll-media]'),
        target: metrics(${JSON.stringify(target.selector || '')}),
        galleryComposition: (() => {
          const selector = ${JSON.stringify(target.selector || '')};
          if (!selector) return null;
          const section = document.querySelector(selector);
          const heading = section?.querySelector('.v2-section-heading');
          const thumbs = section?.querySelector('.v2-product-gallery__thumbs');
          const stage = section?.querySelector('.v2-product-gallery__stage');
          if (!section || !heading || !stage) return null;
          const top = heading.getBoundingClientRect().top;
          const bottom = (thumbs || stage).getBoundingClientRect().bottom;
          return {
            height: Math.round(bottom - top),
            viewportRatio: Number(((bottom - top) / innerHeight).toFixed(3)),
            stageHeight: Math.round(stage.getBoundingClientRect().height),
            hasThumbs: Boolean(thumbs)
          };
        })()
      };
    })()`);
  }
  const screenshotOptions = {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  };
  if (options.ownerFreeze) {
    // The first headless surface read primes fixed/composited layers on image-
    // heavy pages. Discard it and keep the stable second frame as proof.
    await cdp.send('Page.captureScreenshot', screenshotOptions);
    await delay(140);
  }
  const screenshot = await cdp.send('Page.captureScreenshot', screenshotOptions);
  const buffer = Buffer.from(screenshot.data, 'base64');
  if (buffer.length < 10_000) throw new Error(`${target.file} is unexpectedly small (${buffer.length} bytes).`);
  const destination = path.join(target.outputRoot || proofRoot, target.file);
  await writeFile(destination, buffer);
  report.screenshots.push({
    file: target.file,
    route: target.route,
    viewport: target.viewport,
    action: target.action || 'top',
    bytes: buffer.length,
    geometry
  });
};

const writeReports = async () => {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const scrollHeaders = [
    'kind', 'sequence', 'source_route', 'target_route', 'route_type', 'viewport',
    'initial_scroll_y', 'final_scroll_y', 'expected_scroll_y', 'hash', 'history_action', 'status', 'notes'
  ];
  const motionHeaders = [
    'route', 'route_type', 'mode', 'viewport', 'reveal_count', 'immersive_stage_count', 'rendered_count', 'pending_count',
    'opacity_zero_count', 'hidden_count', 'scroll_before', 'scroll_after', 'reduced_motion',
    'scroll_behavior', 'status', 'notes'
  ];
  await Promise.all([
    writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(scrollAuditPath, toCsv(scrollHeaders, scrollRows), 'utf8'),
    writeFile(motionAuditPath, toCsv(motionHeaders, motionRows), 'utf8')
  ]);
};

const auditDiagnosticFailures = (diagnostics, context, { checkScroll = false } = {}) => {
  const issues = [];
  if (diagnostics.horizontalOverflow > 1) issues.push(`horizontal-overflow:${diagnostics.horizontalOverflow}`);
  if (diagnostics.horizontalOffenders.length) issues.push(`horizontal-offenders:${diagnostics.horizontalOffenders.length}`);
  if (diagnostics.duplicateIds.length) issues.push(`duplicate-ids:${diagnostics.duplicateIds.join('|')}`);
  if (diagnostics.brokenImages.length) issues.push(`broken-images:${diagnostics.brokenImages.length}`);
  if (diagnostics.pendingImages.length) issues.push(`pending-images:${diagnostics.pendingImages.length}`);
  if (diagnostics.brokenVideos.length) issues.push(`broken-videos:${diagnostics.brokenVideos.length}`);
  if (diagnostics.unreadyVisibleVideos.length) issues.push(`unready-visible-videos:${diagnostics.unreadyVisibleVideos.length}`);
  if (diagnostics.emptyHrefs) issues.push(`empty-hrefs:${diagnostics.emptyHrefs}`);
  if (diagnostics.designLabLinks.length) issues.push(`design-lab-links:${diagnostics.designLabLinks.length}`);
  if (diagnostics.placeholderHits.length) issues.push(`placeholder-copy:${diagnostics.placeholderHits.join('|')}`);
  if (diagnostics.visibleSpinners.length) issues.push(`visible-loaders:${diagnostics.visibleSpinners.length}`);
  if (diagnostics.h1Count !== 1) issues.push(`h1-count:${diagnostics.h1Count}`);
  if (checkScroll && Math.abs(diagnostics.scrollY) > 2) issues.push(`scrollY:${diagnostics.scrollY}`);
  if (checkScroll) {
    diagnostics.heroScrollCopies.forEach((copy, index) => {
      if (copy.opacity < 0.99 || copy.bottom <= 0 || copy.top >= diagnostics.height) {
        issues.push(`hero-copy-outside-first-screen:${index + 1}`);
      }
    });
  }
  for (const issue of issues) fail('page-diagnostic', `${context}: ${issue}`, { ...diagnostics, context });
  return issues;
};

const directRouteEntries = targetedMode
  ? targetedRoutes.map((route) => canonicalByRoute.get(route))
  : options.smoke
    ? representativeRoutes.filter((route) => canonicalByRoute.has(route)).slice(0, 8).map((route) => canonicalByRoute.get(route))
    : canonicalRoutes;
const responsiveRoutes = targetedMode ? targetedRoutes : options.smoke ? representativeRoutes.slice(0, 6) : representativeRoutes;
const responsiveViewports = targetedMode
  ? exactViewports.filter((viewport) => !options.viewportValues.length || options.viewportValues.includes(viewport.name))
  : options.smoke
    ? exactViewports.filter((viewport) => ['1440x900', '390x844'].includes(viewport.name))
    : exactViewports;
if (targetedMode && options.viewportValues.length && responsiveViewports.length !== new Set(options.viewportValues).size) {
  const known = new Set(exactViewports.map((viewport) => viewport.name));
  throw new Error(`Unknown --viewports value(s): ${options.viewportValues.filter((name) => !known.has(name)).join(', ')}`);
}
const reducedRoutes = targetedMode ? targetedRoutes : options.smoke ? reducedMotionRoutes.slice(0, 4) : reducedMotionRoutes;
const footerAuditRoutes = targetedMode ? [] : options.smoke ? footerRoutes.slice(0, 2) : footerRoutes;
const navigationPlan = targetedMode ? [] : options.smoke ? clickPlan.slice(0, 3) : clickPlan;

try {
  cdp = new CdpClient(await waitForDebugger());
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  });

  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    runtimeErrors.push({
      route: currentRoute,
      kind: 'exception',
      text: exceptionDetails?.exception?.description || exceptionDetails?.text || 'Runtime exception'
    });
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type !== 'error' && type !== 'assert') return;
    runtimeErrors.push({
      route: currentRoute,
      kind: `console.${type}`,
      text: (args || []).map((argument) => argument.value || argument.description).filter(Boolean).join(' ') || type
    });
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry?.level !== 'error') return;
    if (entry.url && !entry.url.startsWith(origin)) return;
    runtimeErrors.push({ route: currentRoute, kind: 'log', text: entry.text || 'Browser log error', url: entry.url || '' });
  });
  cdp.on('Network.responseReceived', ({ response, type }) => {
    if (!response?.url?.startsWith(origin) || response.status < 400) return;
    localNetworkErrors.push({ route: currentRoute, kind: 'http', status: response.status, type, url: response.url });
  });
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (requestId && request?.url) requestUrls.set(requestId, request.url);
  });
  cdp.on('Network.loadingFailed', ({ errorText, canceled, type, requestId }) => {
    if (canceled || errorText === 'net::ERR_ABORTED') return;
    const url = requestUrls.get(requestId) || '';
    requestUrls.delete(requestId);
    if (!url.startsWith(origin)) return;
    localNetworkErrors.push({ route: currentRoute, kind: 'loading-failed', errorText, type, requestId, url });
  });

  if (options.ownerFreeze) {
    progress(`capturing ${ownerScreenshotPlan.length} owner-freeze screenshots (${options.ownerFreezePhase})`);
    await mkdir(ownerProofRoot, { recursive: true });
    for (const target of ownerScreenshotPlan) {
      try {
        await captureViewport({ ...target, outputRoot: ownerProofRoot });
        progress(`owner screenshot ${target.file}`);
      } catch (error) {
        fail('owner-screenshot', String(error), target);
      }
    }
    for (const error of runtimeErrors) fail('console-runtime', error.text, error);
    for (const error of localNetworkErrors) fail('local-network', error.errorText || `HTTP ${error.status}`, error);
    report.screenshotBytes = report.screenshots.reduce((sum, item) => sum + item.bytes, 0);
    report.finishedAt = new Date().toISOString();
    report.result = failures.length ? 'fail' : 'pass';
    await writeReports();
    process.stdout.write(`${JSON.stringify({
      result: report.result,
      phase: options.ownerFreezePhase,
      screenshots: report.screenshots.length,
      screenshotBytes: report.screenshotBytes,
      outputRoot: ownerProofRoot,
      runtimeErrors: runtimeErrors.length,
      localNetworkErrors: localNetworkErrors.length,
      failures: failures.length,
      reportPath
    }, null, 2)}\n`);
    if (failures.length) process.exitCode = 1;
  } else {
  if (!targetedMode) {
    await auditHomeVideoInteraction('home-video-mobile', '390x844', 'mobile-poster');
    await auditHomeVideoInteraction('home-video-desktop', '1920x1080', 'desktop-video');
  }

  progress(`direct-load and final-motion audit for ${directRouteEntries.length} canonical routes`);
  await setViewport(exactViewports.find((viewport) => viewport.name === '1440x900'));
  for (let index = 0; index < directRouteEntries.length; index += 1) {
    const entry = directRouteEntries[index];
    const directResult = { route: entry.route, type: entry.type, status: 'pass' };
    try {
      const response = await fetch(`${origin}${entry.route}`, { method: 'HEAD', redirect: 'manual' });
      directResult.httpStatus = response.status;
      if (response.status !== 200) {
        directResult.status = 'fail';
        fail('direct-http', `${entry.route} returned HTTP ${response.status}.`, directResult);
      }
      await navigateDirect(entry.route, 100);
      const afterLoad = await evaluate('scrollY');
      await waitForLocalImages();
      const afterMedia = await evaluate('scrollY');
      await delay(920);
      const afterEntrance = await evaluate('scrollY');
      const directStatus = Math.max(Math.abs(afterLoad), Math.abs(afterMedia), Math.abs(afterEntrance)) <= 2 ? 'pass' : 'fail';
      const directRow = {
        kind: 'direct', sequence: index + 1, source_route: '', target_route: entry.route,
        route_type: entry.type, viewport: '1440x900', initial_scroll_y: afterLoad,
        final_scroll_y: afterEntrance, expected_scroll_y: 0, hash: '', history_action: '',
        status: directStatus, notes: `after-media=${afterMedia}`
      };
      scrollRows.push(directRow);
      if (directStatus !== 'pass') {
        directResult.status = 'fail';
        fail('direct-scroll', `${entry.route} opened at ${afterLoad}/${afterMedia}/${afterEntrance}.`, directRow);
      }

      await settleAllReveals();
      const reveal = await inspectRevealState();
      const diagnostics = await pageDiagnostics('1440x900');
      const scrollBehavior = await evaluate("getComputedStyle(document.documentElement).scrollBehavior");
      const immersiveStagesPresent = !immersiveMotionRoutes.has(entry.route) || reveal.immersiveStageCount >= 5;
      const revealSystemPresent = !motionPresenceRoutes.has(entry.route) || reveal.revealCount > 0;
      const motionStatus = reveal.pendingCount === 0 && reveal.opacityZeroCount === 0
        && reveal.hiddenCount === 0 && immersiveStagesPresent && revealSystemPresent
        && Math.abs(afterEntrance - afterMedia) <= 2 ? 'pass' : 'fail';
      const motionRow = {
        route: entry.route, route_type: entry.type, mode: 'normal-final', viewport: '1440x900',
        reveal_count: reveal.revealCount, immersive_stage_count: reveal.immersiveStageCount,
        rendered_count: reveal.renderedCount,
        pending_count: reveal.pendingCount, opacity_zero_count: reveal.opacityZeroCount,
        hidden_count: reveal.hiddenCount, scroll_before: afterMedia, scroll_after: afterEntrance,
        reduced_motion: false, scroll_behavior: scrollBehavior, status: motionStatus,
        notes: [
          reveal.opacityZero.length ? JSON.stringify(reveal.opacityZero) : '',
          immersiveStagesPresent ? '' : `immersive-stages=${reveal.immersiveStageCount}`,
          revealSystemPresent ? '' : 'reveal-system-absent'
        ].filter(Boolean).join('; ')
      };
      motionRows.push(motionRow);
      report.motion.push(motionRow);
      if (motionStatus !== 'pass') {
        directResult.status = 'fail';
        fail('motion-final', `${entry.route} retained hidden/pending reveal content.`, motionRow);
      }
      const diagnosticIssues = auditDiagnosticFailures(diagnostics, `${entry.route}@1440x900`, { checkScroll: true });
      if (diagnosticIssues.length) directResult.status = 'fail';
      const canonicalPath = diagnostics.canonical ? new URL(diagnostics.canonical, origin).pathname : '';
      if (canonicalPath !== pathnameOnly(entry.route)) {
        directResult.status = 'fail';
        fail('canonical', `${entry.route} canonical is ${canonicalPath || '(missing)'}.`, { route: entry.route, canonical: diagnostics.canonical });
      }
      Object.assign(directResult, {
        scroll: { afterLoad, afterMedia, afterEntrance },
        reveal,
        diagnostics,
        canonicalPath
      });
    } catch (error) {
      directResult.status = 'fail';
      directResult.error = error instanceof Error ? error.stack : String(error);
      fail('direct-exception', String(error), { route: entry.route });
    }
    report.directLoads.push(directResult);
    if ((index + 1) % 10 === 0 || index + 1 === directRouteEntries.length) {
      progress(`direct routes ${index + 1}/${directRouteEntries.length}`);
    }
  }

  progress(`reduced-motion audit for ${reducedRoutes.length} representative routes`);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  for (const route of reducedRoutes) {
    try {
      await navigateDirect(route, 80);
      const scrollBefore = await evaluate('scrollY');
      await delay(180);
      const scrollAfter = await evaluate('scrollY');
      const reveal = await inspectRevealState();
      const reducedState = await evaluate(`({
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior
      })`);
      const status = reducedState.matches && reducedState.scrollBehavior === 'auto'
        && reveal.pendingCount === 0 && reveal.opacityZeroCount === 0 && reveal.hiddenCount === 0
        && reveal.revealCount > 0
        && (!immersiveMotionRoutes.has(route) || reveal.immersiveStageCount >= 5)
        && Math.abs(scrollAfter - scrollBefore) <= 2 ? 'pass' : 'fail';
      const row = {
        route, route_type: canonicalByRoute.get(route)?.type || '', mode: 'reduced-initial', viewport: '1440x900',
        reveal_count: reveal.revealCount, immersive_stage_count: reveal.immersiveStageCount,
        rendered_count: reveal.renderedCount,
        pending_count: reveal.pendingCount, opacity_zero_count: reveal.opacityZeroCount,
        hidden_count: reveal.hiddenCount, scroll_before: scrollBefore, scroll_after: scrollAfter,
        reduced_motion: reducedState.matches, scroll_behavior: reducedState.scrollBehavior,
        status,
        notes: [
          reveal.opacityZero.length ? JSON.stringify(reveal.opacityZero) : '',
          reveal.revealCount > 0 ? '' : 'reveal-system-absent',
          immersiveMotionRoutes.has(route) && reveal.immersiveStageCount < 5
            ? `immersive-stages=${reveal.immersiveStageCount}` : ''
        ].filter(Boolean).join('; ')
      };
      motionRows.push(row);
      report.motion.push(row);
      if (status !== 'pass') fail('reduced-motion', `Reduced-motion visibility failed on ${route}.`, row);
    } catch (error) {
      const row = {
        route, route_type: canonicalByRoute.get(route)?.type || '', mode: 'reduced-initial', viewport: '1440x900',
        status: 'fail', notes: String(error)
      };
      motionRows.push(row);
      report.motion.push(row);
      fail('reduced-motion-exception', String(error), { route });
    }
  }
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  });

  progress(`responsive diagnostics: ${responsiveRoutes.length} routes x ${responsiveViewports.length} viewports`);
  for (const viewport of responsiveViewports) {
    await setViewport(viewport);
    for (let index = 0; index < responsiveRoutes.length; index += 1) {
      const route = responsiveRoutes[index];
      try {
        await navigateDirect(route, 60);
        await waitForLocalImages(1800);
        const diagnostics = await pageDiagnostics(viewport.name);
        const issues = auditDiagnosticFailures(diagnostics, `${route}@${viewport.name}`, { checkScroll: true });
        if (viewport.name === 'reflow-200'
          && (diagnostics.width !== 640 || Math.abs(diagnostics.devicePixelRatio - 2) > 0.08
            || Math.abs(diagnostics.visualScale - 1) > 0.08)) {
          issues.push(`reflow-emulation:${diagnostics.width}/${diagnostics.devicePixelRatio}/${diagnostics.visualScale}`);
          fail('reflow-emulation', `${route} did not use a 640px reflow viewport at 200% device scale.`, diagnostics);
        }
        report.responsive.push({ route, viewport: viewport.name, status: issues.length ? 'fail' : 'pass', ...diagnostics });
      } catch (error) {
        report.responsive.push({ route, viewport: viewport.name, status: 'fail', error: String(error) });
        fail('responsive-exception', String(error), { route, viewport: viewport.name });
      }
    }
    progress(`responsive viewport ${viewport.name} complete`);
  }

  progress(`${navigationPlan.length} real mouse-click pathname navigations`);
  await setViewport(exactViewports.find((viewport) => viewport.name === '1440x900'));
  for (let index = 0; index < navigationPlan.length; index += 1) {
    const [source, target] = navigationPlan[index];
    try {
      await realClickNavigation(source, target, index + 1);
    } catch (error) {
      const row = {
        kind: 'click', sequence: index + 1, source_route: source, target_route: target,
        route_type: canonicalByRoute.get(target)?.type || '', viewport: '1440x900',
        status: 'fail', notes: String(error)
      };
      scrollRows.push(row);
      report.clickNavigations.push(row);
      fail('click-exception', String(error), { source, target });
    }
  }

  if (!options.smoke && !targetedMode) {
    progress('native Back/Forward and hash navigation');
    try { await runHistoryAudit(); } catch (error) { fail('history-exception', String(error)); }
    try { await runHashAudit(); } catch (error) { fail('hash-exception', String(error)); }
  }

  progress(`Footer desktop/mobile variants on ${footerAuditRoutes.length} routes`);
  await runFooterAudit(footerAuditRoutes);

  if (!targetedMode) await runFunctionalInteractionAudits();

  if (options.screenshots && !targetedMode) {
    progress(`capturing ${screenshotPlan.length} proof screenshots (files are not git-added)`);
    await mkdir(proofRoot, { recursive: true });
    for (const target of screenshotPlan) {
      try {
        await captureViewport(target);
        progress(`screenshot ${target.file}`);
      } catch (error) {
        fail('screenshot', String(error), target);
      }
    }
    report.screenshotBytes = report.screenshots.reduce((sum, item) => sum + item.bytes, 0);
  }

  for (const error of runtimeErrors) fail('console-runtime', error.text, error);
  for (const error of localNetworkErrors) fail('local-network', error.errorText || `HTTP ${error.status}`, error);
  report.finishedAt = new Date().toISOString();
  report.result = failures.length ? 'fail' : 'pass';
  await writeReports();
  process.stdout.write(`${JSON.stringify({
    result: report.result,
    canonicalRoutes: directRouteEntries.length,
    clickNavigations: report.clickNavigations.length,
    responsiveAssertions: report.responsive.length,
    motionAssertions: motionRows.length,
    footerAssertions: report.footers.length,
    functionalAssertions: Object.keys(report.interactions).length,
    runtimeErrors: runtimeErrors.length,
    localNetworkErrors: localNetworkErrors.length,
    failures: failures.length,
    screenshots: report.screenshots.length,
    screenshotBytes: report.screenshotBytes || 0,
    reportPath,
    scrollAuditPath,
    motionAuditPath
  }, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
  }
} catch (error) {
  report.finishedAt = new Date().toISOString();
  report.result = 'fail';
  report.fatal = error instanceof Error ? error.stack : String(error);
  fail('fatal', String(error));
  await writeReports().catch(() => {});
  process.stderr.write(`${report.fatal}\n`);
  process.exitCode = 1;
} finally {
  if (cdp) {
    await cdp.send('Browser.close', {}, 4000).catch(() => {});
    cdp.close();
  }
  await Promise.race([
    new Promise((resolve) => browser.once('exit', resolve)),
    delay(3500)
  ]);
  if (browser.exitCode === null) browser.kill('SIGKILL');
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
  const resolvedProfile = path.resolve(profileDir);
  const resolvedProfileRoot = path.resolve(profileRoot);
  if (resolvedProfile.startsWith(`${resolvedProfileRoot}${path.sep}`)) {
    await rm(resolvedProfile, { recursive: true, force: true }).catch(() => {});
  }
}

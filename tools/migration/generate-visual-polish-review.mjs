import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const migrationRoot = path.join(root, 'docs', 'migration');
const routeAuditPath = path.join(migrationRoot, 'v2-production-route-audit.csv');
const defaultQaPath = path.join(migrationRoot, 'v2-visual-polish-browser-qa.json');
const defaultOutputPath = path.join(migrationRoot, 'v2-visual-page-review.csv');
const argv = process.argv.slice(2);

const hasFlag = (flag) => argv.includes(flag);
const optionValue = (name, fallback) => {
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const options = {
  help: hasFlag('--help') || hasFlag('-h'),
  plan: hasFlag('--plan'),
  qaPath: path.resolve(root, optionValue('--qa', defaultQaPath)),
  outputPath: path.resolve(root, optionValue('--output', defaultOutputPath))
};

const usage = `
Generate the V2 visual-polish page review table.

  node tools/migration/generate-visual-polish-review.mjs --plan
      Validate and print the 107 canonical routes plus the production 404 review plan without requiring browser QA JSON
      and without writing any files.

  node tools/migration/generate-visual-polish-review.mjs
      Read docs/migration/v2-visual-polish-browser-qa.json and write
      docs/migration/v2-visual-page-review.csv.

  --qa <path>       Override the browser-QA JSON input.
  --output <path>   Override the CSV output.
`;

if (options.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const OUTPUT_COLUMNS = [
  'route',
  'page_type',
  'first_screen_quality',
  'hero_media_quality',
  'palette_consistency',
  'motion',
  'spacing',
  'mobile',
  'issue_found',
  'issue_fixed'
];

/*
 * This is intentionally an explicit, evidence-backed review matrix rather than
 * a heuristic. Keep a route here when its state represents a distinct page
 * entry, content density, media shape, or practical-page composition.
 */
const REPRESENTATIVE_REVIEW_ROUTES = new Map([
  ['/', 'home'],
  ['/metallokonstruktsii-dlya-biznesa/', 'immersive-metalworks'],
  ['/blagoustroystvo-territoriy/', 'immersive-landscaping'],
  ['/stroitelstvo-i-remonty/', 'immersive-construction'],
  ['/navesy-i-kozyrki/', 'immersive-canopies'],
  ['/topiarii/', 'immersive-topiary'],
  ['/ulichnaya-mebel/', 'catalog-section'],
  ['/ograzhdeniya-i-zabory/', 'catalog-section-fences'],

  // Categories: required, filled, sparse, no-media, and longest title.
  ['/ulichnaya-mebel/kacheli/', 'category-required-swings'],
  ['/ulichnaya-mebel/lavochki-i-skameyki/', 'category-filled-16-products'],
  ['/ulichnaya-mebel/stoly-i-komplekty/', 'category-sparse-1-product'],
  ['/ograzhdeniya-i-zabory/dekorativnye-ograzhdeniya/', 'category-no-media'],
  ['/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/', 'category-long-title'],

  // Products: required, richest gallery, single/minimal, zero-media, portrait,
  // longest title, and the densest specification record.
  ['/ulichnaya-mebel/kacheli/kachel-duga/', 'product-required-swing'],
  ['/ulichnaya-mebel/kacheli/kachel-portal/', 'product-media-rich'],
  ['/ulichnaya-mebel/lavochki-i-skameyki/skamya-smu1-bazovaya/', 'product-single-image-minimal'],
  ['/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-duo/', 'product-zero-media'],
  ['/ulichnaya-mebel/ulichnoe-osveshchenie/fonar-sektor/', 'product-portrait-gallery'],
  ['/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-zakrytaya/', 'product-long-title'],
  ['/ulichnaya-mebel/besedki-i-pergoly/besedka-kub/', 'product-specs-heavy'],

  // Archive plus industrial, landscaping, and placeholder-only sparse details.
  ['/vypolnennye-obekty/', 'projects-archive'],
  ['/vypolnennye-obekty/kompleks-rabot-na-proizvodstvennoy-territorii/', 'project-industrial'],
  ['/vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/', 'project-landscaping'],
  ['/vypolnennye-obekty/remont-skvera-na-ulitse-gogolya/', 'project-sparse-placeholder-media'],

  // Practical/editorial shells.
  ['/o-nas/', 'company'],
  ['/kontakty/', 'contacts'],
  ['/vakansii/', 'vacancies'],
  ['/vakansii/svarshchik-metallokonstruktsiy/', 'vacancy-detail'],
  ['/izgotovlenie-na-zakaz/', 'custom-order'],
  ['/politika-konfidencialnosti/', 'privacy'],
  ['/404.html', 'production-404']
]);

/*
 * Add a route here only after a human has inspected its requested proof
 * viewports/screenshots in the current build. An empty set is deliberate: the
 * generator never infers a visual pass from browser diagnostics alone.
 * Every entry must also exist in REPRESENTATIVE_REVIEW_ROUTES.
 */
const VISUALLY_REVIEWED_ROUTES = new Set([
  '/',
  '/metallokonstruktsii-dlya-biznesa/',
  '/blagoustroystvo-territoriy/',
  '/stroitelstvo-i-remonty/',
  '/navesy-i-kozyrki/',
  '/topiarii/',
  '/ulichnaya-mebel/',
  '/ograzhdeniya-i-zabory/',
  '/ulichnaya-mebel/kacheli/',
  '/ulichnaya-mebel/lavochki-i-skameyki/',
  '/ulichnaya-mebel/stoly-i-komplekty/',
  '/ograzhdeniya-i-zabory/dekorativnye-ograzhdeniya/',
  '/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/',
  '/ulichnaya-mebel/kacheli/kachel-duga/',
  '/ulichnaya-mebel/kacheli/kachel-portal/',
  '/ulichnaya-mebel/lavochki-i-skameyki/skamya-smu1-bazovaya/',
  '/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-duo/',
  '/ulichnaya-mebel/ulichnoe-osveshchenie/fonar-sektor/',
  '/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-zakrytaya/',
  '/ulichnaya-mebel/besedki-i-pergoly/besedka-kub/',
  '/vypolnennye-obekty/',
  '/vypolnennye-obekty/kompleks-rabot-na-proizvodstvennoy-territorii/',
  '/vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/',
  '/vypolnennye-obekty/remont-skvera-na-ulitse-gogolya/',
  '/o-nas/',
  '/kontakty/',
  '/vakansii/',
  '/vakansii/svarshchik-metallokonstruktsiy/',
  '/izgotovlenie-na-zakaz/',
  '/politika-konfidencialnosti/',
  '/404.html'
]);

const normalizeRoute = (value) => {
  const url = new URL(value || '/', 'http://visual-polish.local/');
  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (pathname !== '/' && !path.extname(pathname) && !pathname.endsWith('/')) pathname += '/';
  return pathname;
};

const csvEscape = (value) => {
  const string = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
};

const toCsv = (headers, rows) => [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))]
  .map((row) => row.map(csvEscape).join(','))
  .join('\n') + '\n';

const parseCsv = (source) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('Route audit CSV ends inside a quoted field.');
  if (field || row.length) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  const headers = rows.shift();
  if (!headers?.length) throw new Error('Route audit CSV has no header row.');
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
};

const groupCount = (values) => Object.fromEntries([...new Set(values)]
  .sort((left, right) => left.localeCompare(right))
  .map((value) => [value, values.filter((entry) => entry === value).length]));

const auditRows = parseCsv(await readFile(routeAuditPath, 'utf8'));
const canonicalRows = auditRows
  .filter((row) => !['legacy', '404'].includes(row.type))
  .map((row) => ({ route: normalizeRoute(row.route), type: row.type }));
const canonicalByRoute = new Map(canonicalRows.map((row) => [row.route, row]));
const notFoundRows = auditRows
  .filter((row) => row.type === '404')
  .map((row) => ({ route: normalizeRoute(row.route), type: row.type }));
const reviewRows = [...canonicalRows, ...notFoundRows];
const reviewByRoute = new Map(reviewRows.map((row) => [row.route, row]));

if (canonicalRows.length !== 107 || canonicalByRoute.size !== 107) {
  throw new Error(`Expected 107 unique canonical production routes; found ${canonicalRows.length} rows/${canonicalByRoute.size} unique.`);
}
if (notFoundRows.length !== 1 || reviewByRoute.size !== 108) {
  throw new Error(`Expected one production 404 and 108 review rows; found ${notFoundRows.length} 404 rows/${reviewByRoute.size} unique.`);
}
for (const row of canonicalRows) {
  if (!row.type) throw new Error(`Canonical route ${row.route} has no page type.`);
}
for (const route of REPRESENTATIVE_REVIEW_ROUTES.keys()) {
  if (!reviewByRoute.has(route)) throw new Error(`Representative route is not production output: ${route}`);
}
for (const route of VISUALLY_REVIEWED_ROUTES) {
  if (!REPRESENTATIVE_REVIEW_ROUTES.has(route)) {
    throw new Error(`Visually reviewed route is not in the representative matrix: ${route}`);
  }
}

const planSummary = {
  canonicalRoutes: canonicalRows.length,
  reviewRoutes: reviewRows.length,
  pageTypes: groupCount(canonicalRows.map((row) => row.type)),
  representativeRoutes: REPRESENTATIVE_REVIEW_ROUTES.size,
  visuallyReviewedRoutes: VISUALLY_REVIEWED_ROUTES.size,
  representatives: [...REPRESENTATIVE_REVIEW_ROUTES].map(([route, reason]) => ({
    route,
    pageType: reviewByRoute.get(route).type,
    reason
  })),
  qaInput: path.relative(root, options.qaPath).replaceAll('\\', '/'),
  csvOutput: path.relative(root, options.outputPath).replaceAll('\\', '/'),
  columns: OUTPUT_COLUMNS
};

if (options.plan) {
  process.stdout.write(`${JSON.stringify(planSummary, null, 2)}\n`);
  process.exit(0);
}

let report;
try {
  report = JSON.parse(await readFile(options.qaPath, 'utf8'));
} catch (error) {
  throw new Error(`Cannot read final browser QA JSON at ${options.qaPath}. Run browser QA first or use --plan. ${error.message}`);
}

const arrays = {
  directLoads: Array.isArray(report.directLoads) ? report.directLoads : [],
  motion: Array.isArray(report.motion) ? report.motion : [],
  responsive: Array.isArray(report.responsive) ? report.responsive : [],
  failures: Array.isArray(report.failures) ? report.failures : []
};
const directByRoute = new Map(arrays.directLoads.map((entry) => [normalizeRoute(entry.route), entry]));
const routeListByLength = [...reviewByRoute.keys()]
  .filter((route) => route !== '/')
  .sort((left, right) => right.length - left.length);

const routesReferencedBy = (value) => {
  const routes = new Set();
  const visit = (item, key = '') => {
    if (Array.isArray(item)) {
      item.forEach((entry) => visit(entry, key));
      return;
    }
    if (item && typeof item === 'object') {
      Object.entries(item).forEach(([childKey, entry]) => visit(entry, childKey));
      return;
    }
    if (typeof item !== 'string') return;
    if (['route', 'source', 'target', 'source_route', 'target_route', 'currentRoute'].includes(key)) {
      const normalized = normalizeRoute(item);
      if (reviewByRoute.has(normalized)) routes.add(normalized);
    }
    if (key === 'context') {
      const contextRoute = normalizeRoute(item.split('@')[0]);
      if (reviewByRoute.has(contextRoute)) routes.add(contextRoute);
    }
    for (const route of routeListByLength) {
      if (item.includes(route)) routes.add(route);
    }
  };
  visit(value);
  return routes;
};

const failuresByRoute = new Map(reviewRows.map(({ route }) => [route, []]));
let unscopedFailures = 0;
for (const failure of arrays.failures) {
  const routes = routesReferencedBy(failure);
  if (!routes.size) unscopedFailures += 1;
  for (const route of routes) failuresByRoute.get(route)?.push(failure);
}

const isPass = (entry) => entry?.status === 'pass';
const isFail = (entry) => Boolean(entry) && !isPass(entry);
const globalQaPassed = report.result === 'pass' && arrays.failures.length === 0;
const directCoverageComplete = canonicalRows.every(({ route }) => directByRoute.has(route));

const visualStateFor = (route, routeQaFailed, routeQaCovered) => {
  if (routeQaFailed) return 'qa-fail';
  if (!routeQaCovered) return 'qa-not-covered';
  if (!globalQaPassed) return 'qa-run-failed';
  if (!REPRESENTATIVE_REVIEW_ROUTES.has(route)) return 'not-visually-reviewed';
  return VISUALLY_REVIEWED_ROUTES.has(route) ? 'visual-pass' : 'visual-review-required';
};

const automatedStateFor = (entries, routeQaFailed) => {
  if (routeQaFailed || entries.some(isFail)) return 'qa-fail';
  if (!entries.length) return 'not-tested';
  if (!globalQaPassed) return 'qa-run-failed';
  return 'automated-pass';
};

const compactFailure = (failure) => {
  const kind = typeof failure?.kind === 'string' ? failure.kind : 'qa';
  const message = typeof failure?.message === 'string' ? failure.message.replace(/\s+/g, ' ').trim() : '';
  return message ? `${kind}:${message}` : kind;
};

const rows = reviewRows.map(({ route, type }) => {
  const direct = directByRoute.get(route);
  const motionEntries = arrays.motion.filter((entry) => normalizeRoute(entry.route) === route);
  const responsiveEntries = arrays.responsive.filter((entry) => normalizeRoute(entry.route) === route);
  const mobileEntries = responsiveEntries.filter((entry) => [
    '768x1024', '390x844', '320x700', 'reflow-200'
  ].includes(entry.viewport));
  const routeFailures = failuresByRoute.get(route) || [];
  const routeQaCovered = type === '404' ? responsiveEntries.length > 0 : Boolean(direct);
  const routeQaFailed = isFail(direct)
    || motionEntries.some(isFail)
    || responsiveEntries.some(isFail)
    || routeFailures.length > 0;
  const visualState = visualStateFor(route, routeQaFailed, routeQaCovered);

  let issueFound = 'none-detected';
  let issueFixed = 'not-applicable';
  if (routeFailures.length) {
    issueFound = [...new Set(routeFailures.map(compactFailure))].join('; ');
    issueFixed = 'no';
  } else if (routeQaFailed) {
    issueFound = 'automated-qa-failed';
    issueFixed = 'no';
  } else if (!routeQaCovered) {
    issueFound = 'qa-not-covered';
    issueFixed = 'unverified';
  } else if (!globalQaPassed) {
    issueFound = 'global-qa-run-failed';
    issueFixed = 'unverified';
  } else if (REPRESENTATIVE_REVIEW_ROUTES.has(route) && !VISUALLY_REVIEWED_ROUTES.has(route)) {
    issueFound = 'visual-review-pending';
    issueFixed = 'pending-visual-review';
  } else if (VISUALLY_REVIEWED_ROUTES.has(route)) {
    issueFixed = 'verified';
  }

  return {
    route,
    page_type: type,
    first_screen_quality: visualState,
    hero_media_quality: visualState,
    palette_consistency: visualState,
    motion: automatedStateFor(motionEntries, routeQaFailed),
    spacing: visualState,
    mobile: automatedStateFor(mobileEntries, routeQaFailed),
    issue_found: issueFound,
    issue_fixed: issueFixed
  };
});

await mkdir(path.dirname(options.outputPath), { recursive: true });
await writeFile(options.outputPath, toCsv(OUTPUT_COLUMNS, rows), 'utf8');

const resultSummary = {
  ...planSummary,
  qaResult: report.result || 'missing',
  qaFailures: arrays.failures.length,
  unscopedQaFailures: unscopedFailures,
  directLoadCoverage: `${directByRoute.size}/${canonicalRows.length}`,
  directCoverageComplete,
  outputRows: rows.length,
  firstScreenStatuses: groupCount(rows.map((row) => row.first_screen_quality)),
  motionStatuses: groupCount(rows.map((row) => row.motion)),
  mobileStatuses: groupCount(rows.map((row) => row.mobile))
};
process.stdout.write(`${JSON.stringify(resultSummary, null, 2)}\n`);

if (!globalQaPassed || !directCoverageComplete) process.exitCode = 1;

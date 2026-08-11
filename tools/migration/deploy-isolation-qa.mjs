import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';

const root = process.cwd();
const astroCli = path.join(root, 'node_modules', 'astro', 'astro.js');
const COUNTER_ID = '108664754';
const TEST_SITE_URL = 'https://preview.smu1-qa.invalid';
const PRODUCTION_SITE_URL = 'https://production.smu1-qa.invalid';
const REQUIRED_NOINDEX_TOKENS = ['noindex', 'nofollow', 'noarchive'];
const COMPATIBILITY_ROUTES = new Set(['/lavochki-i-skameyki/', '/urny/', '/navesy/']);

const checks = [];
const failures = [];
const record = (id, ok, details = {}) => {
  const row = { id, status: ok ? 'pass' : 'fail', ...details };
  checks.push(row);
  if (!ok) failures.push(row);
  return ok;
};

const decodeHtml = (value) => String(value || '')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const attrs = (tag) => Object.fromEntries(Array.from(String(tag || '').matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g))
  .slice(1)
  .map((match) => [match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? '')]));
const openTags = (html, name) => Array.from(html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi')), (match) => match[0]);
const robotsTokens = (html) => {
  const tag = openTags(html, 'meta').find((candidate) => attrs(candidate).name?.toLowerCase() === 'robots');
  return new Set(String(attrs(tag).content || '').toLowerCase().split(',').map((token) => token.trim()).filter(Boolean));
};
const canonicalFor = (html) => {
  const tag = openTags(html, 'link').find((candidate) => attrs(candidate).rel?.toLowerCase() === 'canonical');
  return tag ? attrs(tag).href || '' : '';
};
const hasAllTokens = (tokens, required) => required.every((token) => tokens.has(token));

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
};
const routeFromHtml = (filename, buildRoot) => {
  const relative = path.relative(buildRoot, filename).replaceAll('\\', '/');
  if (relative === 'index.html') return '/';
  if (relative === '404.html') return '/404.html';
  return relative.endsWith('/index.html')
    ? `/${relative.slice(0, -'index.html'.length)}`
    : `/${relative}`;
};
const isAdminOrDesignLab = (route) => route.startsWith('/admin/') || route.startsWith('/design-lab/');
const isExcludedProductionRoute = (route) => isAdminOrDesignLab(route)
  || COMPATIBILITY_ROUTES.has(route)
  || route === '/404.html'
  || route === '/404/';

const buildEnvironment = (values) => {
  const env = { ...process.env };
  for (const key of [
    'DEPLOY_ENV', 'DEPLOY_TARGET', 'SITE_URL', 'TEST_SITE_URL', 'BASE_PATH',
    'ALLOW_TEMPORARY_SITE_URL', 'SYNTHETIC_PRODUCTION_BUILD', 'REQUIRE_SITE_URL', 'PRODUCTION_DEPLOY_ENABLED'
  ]) delete env[key];
  return { ...env, ...values };
};

const runAstroBuild = ({ outDir, env }) => new Promise((resolve) => {
  const child = spawn(process.execPath, [astroCli, 'build', '--outDir', outDir], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}\n${error.stack || error}` }));
  child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
});

const readArtifact = async (buildRoot) => {
  const files = await walk(buildRoot);
  const htmlFiles = files.filter((file) => file.endsWith('.html'));
  const htmlRows = await Promise.all(htmlFiles.map(async (file) => ({
    file,
    route: routeFromHtml(file, buildRoot),
    html: await readFile(file, 'utf8')
  })));
  const textFiles = files.filter((file) => /\.(?:html|js|mjs|json|xml|txt)$/i.test(file));
  const textCorpus = (await Promise.all(textFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  const robots = await readFile(path.join(buildRoot, 'robots.txt'), 'utf8');
  const sitemapFiles = files.filter((file) => /(?:^|[\\/])sitemap(?:-[^\\/]+)?\.xml$/i.test(file));
  const sitemapCorpus = (await Promise.all(sitemapFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  return { buildRoot, files, htmlRows, textCorpus, robots, sitemapFiles, sitemapCorpus };
};

const analyticsSignals = (value) => ({
  counterId: value.includes(COUNTER_ID),
  metrikaHost: /mc\.yandex\.ru/i.test(value),
  ymCall: /\b(?:window\.)?ym\s*\(/i.test(value),
  ymInit: /\b(?:window\.)?ym\s*\([\s\S]{0,240}?['"]init['"]/i.test(value)
});

const assertTestArtifact = (artifact) => {
  const robotsIssues = artifact.htmlRows
    .filter(({ html }) => !hasAllTokens(robotsTokens(html), REQUIRED_NOINDEX_TOKENS))
    .map(({ route }) => route);
  record('test.html-noindex-all-routes', artifact.htmlRows.length > 0 && robotsIssues.length === 0, {
    pages: artifact.htmlRows.length,
    invalid: robotsIssues.slice(0, 25)
  });

  const publicCanonicals = artifact.htmlRows
    .filter(({ route }) => !isAdminOrDesignLab(route))
    .map(({ route, html }) => ({ route, canonical: canonicalFor(html) }))
    .filter(({ canonical }) => canonical);
  record('test.no-preview-canonical', publicCanonicals.length === 0, {
    invalid: publicCanonicals.slice(0, 25)
  });

  const normalizedRobots = artifact.robots.replace(/\r/g, '').trim();
  record('test.robots-disallow-all', normalizedRobots === 'User-agent: *\nDisallow: /', {
    robots: normalizedRobots
  });
  record('test.sitemap-not-advertised-or-generated', !/\bSitemap\s*:/i.test(artifact.robots)
    && artifact.sitemapFiles.length === 0, {
    sitemapFiles: artifact.sitemapFiles.map((file) => path.basename(file))
  });

  const analytics = analyticsSignals(artifact.textCorpus);
  record('test.metrika-isolated', Object.values(analytics).every((value) => value === false), analytics);
};

const assertProductionArtifact = (artifact) => {
  const indexableRows = artifact.htmlRows.filter(({ route }) => !isExcludedProductionRoute(route));
  const seoIssues = indexableRows.flatMap(({ route, html }) => {
    const tokens = robotsTokens(html);
    const canonical = canonicalFor(html);
    const expectedCanonical = new URL(route, `${PRODUCTION_SITE_URL}/`).toString();
    const issues = [];
    if (!tokens.has('index') || !tokens.has('follow') || tokens.has('noindex') || tokens.has('nofollow')) {
      issues.push(`${route}:robots=${[...tokens].join(',') || '(missing)'}`);
    }
    if (canonical !== expectedCanonical) issues.push(`${route}:canonical=${canonical || '(missing)'}`);
    return issues;
  });
  record('production.indexable-seo', indexableRows.length >= 100 && seoIssues.length === 0, {
    pages: indexableRows.length,
    invalid: seoIssues.slice(0, 25)
  });

  const excludedRows = artifact.htmlRows.filter(({ route }) => isExcludedProductionRoute(route));
  const excludedIssues = excludedRows.flatMap(({ route, html }) => {
    const tokens = robotsTokens(html);
    const analytics = analyticsSignals(html);
    const issues = [];
    if (!hasAllTokens(tokens, REQUIRED_NOINDEX_TOKENS)) {
      issues.push(`${route}:robots=${[...tokens].join(',') || '(missing)'}`);
    }
    if (Object.values(analytics).some(Boolean)) issues.push(`${route}:metrika-present`);
    return issues;
  });
  const excludedFamilies = {
    compatibility: excludedRows.filter(({ route }) => COMPATIBILITY_ROUTES.has(route)).length,
    designLab: excludedRows.filter(({ route }) => route.startsWith('/design-lab/')).length,
    admin: excludedRows.filter(({ route }) => route.startsWith('/admin/')).length
  };
  record('production.excluded-scopes-stay-noindex', Object.values(excludedFamilies).every((count) => count > 0)
    && excludedIssues.length === 0, {
    families: excludedFamilies,
    invalid: excludedIssues.slice(0, 25)
  });

  const home = artifact.htmlRows.find(({ route }) => route === '/')?.html || '';
  const analytics = analyticsSignals(home);
  record('production.metrika-enabled', analytics.counterId && analytics.metrikaHost
    && analytics.ymCall && analytics.ymInit, analytics);

  const expectedSitemapUrl = `${PRODUCTION_SITE_URL}/sitemap-index.xml`;
  record('production.robots-final-domain', /(?:^|\n)Allow:\s*\/(?:\n|$)/i.test(artifact.robots)
    && artifact.robots.includes(`Sitemap: ${expectedSitemapUrl}`)
    && /Disallow:\s*\/admin\//i.test(artifact.robots)
    && /Disallow:\s*\/design-lab\//i.test(artifact.robots), {
    expectedSitemapUrl,
    robots: artifact.robots.replace(/\r/g, '').trim()
  });

  const sitemapForbidden = ['/admin/', '/design-lab/', '/lavochki-i-skameyki/', '/urny/', '/navesy/']
    .filter((route) => artifact.sitemapCorpus.includes(new URL(route, `${PRODUCTION_SITE_URL}/`).toString()));
  record('production.sitemap-final-domain-and-scope', artifact.sitemapFiles.length > 0
    && artifact.sitemapCorpus.includes(`${PRODUCTION_SITE_URL}/`)
    && artifact.sitemapCorpus.includes(`${PRODUCTION_SITE_URL}/o-nas/`)
    && !artifact.sitemapCorpus.includes(TEST_SITE_URL)
    && sitemapForbidden.length === 0, {
    files: artifact.sitemapFiles.map((file) => path.basename(file)),
    forbidden: sitemapForbidden
  });
};

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'smu1-h3-deploy-qa-'));
const testRoot = path.join(tempRoot, 'test');
const productionRoot = path.join(tempRoot, 'production');

try {
  const missingSiteBuild = await runAstroBuild({
    outDir: path.join(tempRoot, 'missing-site'),
    env: buildEnvironment({ DEPLOY_TARGET: 'production' })
  });
  record('production.site-url-required', missingSiteBuild.code !== 0
    && /Production build requires SITE_URL/i.test(`${missingSiteBuild.stdout}\n${missingSiteBuild.stderr}`), {
    exitCode: missingSiteBuild.code
  });

  const temporarySiteBuild = await runAstroBuild({
    outDir: path.join(tempRoot, 'temporary-site'),
    env: buildEnvironment({
      DEPLOY_TARGET: 'production',
      SITE_URL: 'https://koleaw.github.io'
    })
  });
  record('production.temporary-site-url-rejected', temporarySiteBuild.code !== 0
    && /temporary\/dev host/i.test(`${temporarySiteBuild.stdout}\n${temporarySiteBuild.stderr}`), {
    exitCode: temporarySiteBuild.code
  });

  const testBuild = await runAstroBuild({
    outDir: testRoot,
    env: buildEnvironment({
      DEPLOY_TARGET: 'test',
      TEST_SITE_URL,
      BASE_PATH: '/SMU1'
    })
  });
  record('test.build', testBuild.code === 0, testBuild.code === 0 ? {} : {
    exitCode: testBuild.code,
    output: `${testBuild.stdout}\n${testBuild.stderr}`.slice(-4000)
  });
  if (testBuild.code === 0) assertTestArtifact(await readArtifact(testRoot));

  const productionBuild = await runAstroBuild({
    outDir: productionRoot,
    env: buildEnvironment({
      DEPLOY_TARGET: 'production',
      SITE_URL: PRODUCTION_SITE_URL,
      BASE_PATH: '/',
      SYNTHETIC_PRODUCTION_BUILD: 'true'
    })
  });
  record('production.synthetic-build', productionBuild.code === 0, productionBuild.code === 0 ? {} : {
    exitCode: productionBuild.code,
    output: `${productionBuild.stdout}\n${productionBuild.stderr}`.slice(-4000)
  });
  if (productionBuild.code === 0) assertProductionArtifact(await readArtifact(productionRoot));
} finally {
  if (process.env.KEEP_DEPLOY_QA_ARTIFACTS === 'true') {
    process.stdout.write(`Deploy QA artifacts kept at ${tempRoot}\n`);
  } else {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

for (const check of checks) {
  const details = check.status === 'fail'
    ? ` ${JSON.stringify(Object.fromEntries(Object.entries(check).filter(([key]) => !['id', 'status'].includes(key))))}`
    : '';
  process.stdout.write(`${check.status === 'pass' ? 'PASS' : 'FAIL'} ${check.id}${details}\n`);
}
process.stdout.write(`\n${JSON.stringify({
  result: failures.length ? 'fail' : 'pass',
  checks: checks.length,
  passed: checks.length - failures.length,
  failed: failures.length
}, null, 2)}\n`);
if (failures.length) process.exitCode = 1;

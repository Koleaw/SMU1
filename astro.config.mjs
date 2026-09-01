import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const DEV_SITE_URL = 'http://localhost:4321';
const inferDeployTarget = () => {
  const explicitTarget = process.env.DEPLOY_TARGET || process.env.DEPLOY_ENV;
  if (explicitTarget) return explicitTarget;

  if (process.env.CI === 'true') {
    const refName = String(process.env.GITHUB_REF_NAME || '').toLowerCase();
    if (['main', 'master'].includes(refName)) {
      return process.env.PRODUCTION_DEPLOY_ENABLED === 'true' ? 'production' : 'test';
    }
    if (['preview', 'develop'].includes(refName)) return 'test';
    return 'test';
  }

  return 'development';
};

const DEPLOY_TARGET = String(inferDeployTarget()).toLowerCase();
const IS_PRODUCTION_DEPLOY = DEPLOY_TARGET === 'production';
const IS_TEST_DEPLOY = DEPLOY_TARGET === 'test';
const IS_EXPLICIT_LOCAL_ADMIN = DEPLOY_TARGET === 'development'
  && process.env.SMU1_LOCAL_ADMIN === 'true';
const STRICT_SITE_URL_REQUIRED = IS_PRODUCTION_DEPLOY || process.env.REQUIRE_SITE_URL === 'true';
const TEMPORARY_SITE_URL_PATTERNS = [/example\./i, /\.invalid(?::\d+)?\/?$/i, /localhost/i, /127\.0\.0\.1/i, /\.github\.io/i];

const githubPagesSiteUrl = () => {
  const repository = process.env.GITHUB_REPOSITORY || '';
  const owner = process.env.GITHUB_REPOSITORY_OWNER || repository.split('/')[0];
  return owner ? `https://${owner}.github.io` : '';
};

const githubPagesBasePath = () => {
  const repository = process.env.GITHUB_REPOSITORY || '';
  const [owner, repo] = repository.split('/');
  if (!repo || repo.toLowerCase() === `${owner}.github.io`.toLowerCase()) return '/';
  return `/${repo}`;
};

const normalizeSiteUrl = (value) => {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
};

const normalizeBasePath = (value) => {
  const raw = String(value || '/').trim();
  if (!raw || raw === '/') return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
};

const rawProductionSiteUrl = process.env.SITE_URL?.trim();
const rawTestSiteUrl = process.env.TEST_SITE_URL?.trim();
const fallbackTestSiteUrl = process.env.CI === 'true' ? githubPagesSiteUrl() : DEV_SITE_URL;
const rawSiteUrl = IS_PRODUCTION_DEPLOY
  ? rawProductionSiteUrl
  : rawTestSiteUrl || rawProductionSiteUrl || fallbackTestSiteUrl;

if (STRICT_SITE_URL_REQUIRED && !rawProductionSiteUrl) {
  throw new Error('Production build requires SITE_URL. Set SITE_URL=https://final-domain.ru or use DEPLOY_TARGET=test with TEST_SITE_URL for test publication.');
}

if (!rawSiteUrl) {
  throw new Error('TEST_SITE_URL is not set and GitHub Pages URL could not be inferred. Set TEST_SITE_URL for test builds.');
}

const siteUrl = normalizeSiteUrl(rawSiteUrl);
const basePath = normalizeBasePath(process.env.BASE_PATH ?? (!IS_PRODUCTION_DEPLOY && process.env.CI === 'true' ? githubPagesBasePath() : '/'));
const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
const adminApiProxyTarget = `http://${process.env.ADMIN_API_HOST || '127.0.0.1'}:${process.env.ADMIN_API_PORT || '8787'}`;

if (STRICT_SITE_URL_REQUIRED) {
  const isSyntheticProductionQa = process.env.SYNTHETIC_PRODUCTION_BUILD === 'true';
  if (!isSyntheticProductionQa && TEMPORARY_SITE_URL_PATTERNS.some((pattern) => pattern.test(siteUrl))) {
    throw new Error(`Production SITE_URL points to a temporary/dev host: ${siteUrl}. Set the real domain or use DEPLOY_TARGET=test.`);
  }
}

const isSitemapPageAllowed = (page) => {
  const { pathname } = new URL(page);
  const routePath =
    normalizedBasePath !== '/' && pathname.startsWith(normalizedBasePath)
      ? `/${pathname.slice(normalizedBasePath.length)}`
      : pathname;

  const excludedCompatibilityRoutes = new Set([
    '/lavochki-i-skameyki/',
    '/urny/',
    '/navesy/'
  ]);

  return (
    !routePath.startsWith('/admin/') &&
    !routePath.startsWith('/api/') &&
    !routePath.startsWith('/design-lab/') &&
    routePath !== '/404.html' &&
    routePath !== '/404/' &&
    !excludedCompatibilityRoutes.has(routePath) &&
    routePath !== '/robots.txt'
  );
};

export default defineConfig({
  site: siteUrl,
  base: basePath,
  // The editor already owns its complete UI and strict loopback API boundary.
  // Astro's developer toolbar adds unrelated controls to screenshots and its
  // accessibility audit probes rejected local endpoints, producing false
  // console/network errors. Keep the production canvas free of that toolbar.
  devToolbar: { enabled: false },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover'
  },
  integrations: IS_TEST_DEPLOY
    ? []
    : [sitemap({
      filter: isSitemapPageAllowed
    })],
  vite: {
    server: {
      proxy: {
        '/api/admin': {
          target: adminApiProxyTarget,
          changeOrigin: true
        }
      }
    },
    define: {
      'import.meta.env.SMU1_DEPLOY_TARGET': JSON.stringify(DEPLOY_TARGET),
      // Vite exposes only explicitly defined non-PUBLIC environment values to
      // imported renderer helpers. Keep the editor switch compile-time false
      // for every preview/production build and true only for the local launcher.
      'import.meta.env.SMU1_LOCAL_ADMIN': JSON.stringify(IS_EXPLICIT_LOCAL_ADMIN ? 'true' : 'false')
    }
  },
  // The local editor needs request-scoped query/session data so bindings can
  // be emitted by the production components. Public artifacts remain strict
  // static SSG; only the explicit loopback editor runs Astro on demand.
  output: IS_EXPLICIT_LOCAL_ADMIN ? 'server' : 'static'
});

import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const DEV_SITE_URL = 'http://localhost:4321';
const STRICT_SITE_URL_REQUIRED = process.env.CI === 'true' || process.env.REQUIRE_SITE_URL === 'true';
const TEMPORARY_SITE_URL_PATTERNS = [/example\./i, /localhost/i, /127\.0\.0\.1/i, /koleaw\.github\.io/i];

const normalizeSiteUrl = (value) => {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
};

const rawSiteUrl = process.env.SITE_URL?.trim();
const siteUrl = normalizeSiteUrl(rawSiteUrl || DEV_SITE_URL);
const basePath = process.env.BASE_PATH ?? '/';
const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;

if (STRICT_SITE_URL_REQUIRED) {
  if (!rawSiteUrl) {
    throw new Error('SITE_URL must be set for production builds. Example: SITE_URL=https://final-domain.ru');
  }

  const allowTemporarySiteUrl = process.env.ALLOW_TEMPORARY_SITE_URL === 'true';
  if (!allowTemporarySiteUrl && TEMPORARY_SITE_URL_PATTERNS.some((pattern) => pattern.test(siteUrl))) {
    throw new Error(`SITE_URL points to a temporary/dev host: ${siteUrl}`);
  }
}

const isSitemapPageAllowed = (page) => {
  const { pathname } = new URL(page);
  const routePath =
    normalizedBasePath !== '/' && pathname.startsWith(normalizedBasePath)
      ? `/${pathname.slice(normalizedBasePath.length)}`
      : pathname;

  return (
    !routePath.startsWith('/admin/') &&
    !routePath.startsWith('/api/') &&
    routePath !== '/404.html' &&
    routePath !== '/robots.txt'
  );
};

export default defineConfig({
  site: siteUrl,
  base: basePath,
  integrations: [
    sitemap({
      filter: isSitemapPageAllowed
    })
  ],
  output: 'static'
});

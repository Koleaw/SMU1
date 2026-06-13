import type { APIRoute } from 'astro';

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');
const normalizeBasePath = (value: string): string => {
  if (!value || value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}/`;
};

export const GET: APIRoute = ({ site }) => {
  const siteUrl = trimTrailingSlash(site?.toString() ?? 'http://localhost:4321');
  const basePath = normalizeBasePath(import.meta.env.BASE_URL ?? '/');
  const sitemapUrl = new URL(`${basePath}sitemap-index.xml`, `${siteUrl}/`).toString();
  const baseAdminPath = `${basePath}admin/`;
  const baseApiPath = `${basePath}api/`;

  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    'Disallow: /admin/',
    'Disallow: /api/',
    ...(basePath === '/' ? [] : [`Disallow: ${baseAdminPath}`, `Disallow: ${baseApiPath}`]),
    '',
    `Sitemap: ${sitemapUrl}`,
    ''
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
};

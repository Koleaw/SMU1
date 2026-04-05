import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'SMU1';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://example.github.io',
  base: process.env.BASE_PATH ?? `/${repo}`,
  integrations: [sitemap()],
  output: 'static'
});

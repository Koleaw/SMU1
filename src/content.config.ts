import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { contentSchemas } from './content-schemas.mjs';

// Astro 7 no longer auto-loads legacy `type: 'data'` folders. Keep every
// collection on the content-layer loader so clean installs never depend on a
// previously generated content store.
// Preserve the legacy entry IDs (the JSON path without its extension). The
// content-layer glob otherwise prefers a record's `slug`, which is deliberately
// different from the filename for compatibility records such as `navesy.json`.
const jsonCollection = (directory: string) => glob({
  pattern: '**/*.json',
  base: `./src/content/${directory}`,
  generateId: ({ entry }) => entry.replace(/\.json$/u, '')
});

export const collections = {
  'product-sections': defineCollection({
    loader: jsonCollection('product-sections'),
    schema: contentSchemas['product-sections']
  }),
  'product-categories': defineCollection({
    loader: jsonCollection('product-categories'),
    schema: contentSchemas['product-categories']
  }),
  products: defineCollection({
    loader: jsonCollection('products'),
    schema: contentSchemas.products
  }),
  services: defineCollection({
    loader: jsonCollection('services'),
    schema: contentSchemas.services
  }),
  projects: defineCollection({
    loader: jsonCollection('projects'),
    schema: contentSchemas.projects
  }),
  jobs: defineCollection({
    loader: jsonCollection('jobs'),
    schema: contentSchemas.jobs
  }),
  'site-settings': defineCollection({
    loader: jsonCollection('site-settings'),
    schema: contentSchemas['site-settings']
  }),
  'static-pages': defineCollection({
    loader: jsonCollection('static-pages'),
    schema: contentSchemas['static-pages']
  })
};

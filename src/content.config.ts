import { defineCollection } from 'astro:content';
import { contentSchemas } from './content-schemas.mjs';

export const collections = {
  'product-sections': defineCollection({ type: 'data', schema: contentSchemas['product-sections'] }),
  'product-categories': defineCollection({ type: 'data', schema: contentSchemas['product-categories'] }),
  products: defineCollection({ type: 'data', schema: contentSchemas.products }),
  services: defineCollection({ type: 'data', schema: contentSchemas.services }),
  projects: defineCollection({ type: 'data', schema: contentSchemas.projects }),
  jobs: defineCollection({ type: 'data', schema: contentSchemas.jobs }),
  'site-settings': defineCollection({ type: 'data', schema: contentSchemas['site-settings'] }),
  'static-pages': defineCollection({ type: 'data', schema: contentSchemas['static-pages'] })
};

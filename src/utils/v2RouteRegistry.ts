import { getCollection } from 'astro:content';
import { createV2RouteRegistry } from './v2TransitionRouting.mjs';

let registryPromise: Promise<ReturnType<typeof createV2RouteRegistry>> | undefined;

export const loadV2TransitionRouteRegistry = () => {
  registryPromise ??= Promise.all([
    getCollection('product-sections'),
    getCollection('services'),
    getCollection('product-categories'),
    getCollection('products'),
    getCollection('projects'),
    getCollection('jobs')
  ]).then(([productSections, services, categories, products, projects, jobs]) => (
    createV2RouteRegistry({ productSections, services, categories, products, projects, jobs })
  ));
  return registryPromise;
};

const safeInlineJson = (value: unknown) => JSON.stringify(value)
  .replace(/&/g, '\\u0026')
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

export const loadV2TransitionRouteRegistryJson = async () => (
  safeInlineJson(await loadV2TransitionRouteRegistry())
);

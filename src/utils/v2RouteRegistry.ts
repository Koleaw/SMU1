import { getCollection } from 'astro:content';
import { createV2RouteRegistry } from './v2TransitionRouting.mjs';
import { safeInlineJson } from './safeInlineJson.mjs';

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

export const loadV2TransitionRouteRegistryJson = async () => (
  safeInlineJson(await loadV2TransitionRouteRegistry())
);

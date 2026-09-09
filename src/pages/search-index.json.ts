import { getCollection } from 'astro:content';
import { createPublicSearchIndex } from '../utils/publicSearchIndex.mjs';

export const prerender = true;

export async function GET() {
  const [productSections, services, categories, products, projects] = await Promise.all([
    getCollection('product-sections'), getCollection('services'),
    getCollection('product-categories'), getCollection('products'), getCollection('projects')
  ]);
  return new Response(JSON.stringify(createPublicSearchIndex({ productSections, services, categories, products, projects })), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

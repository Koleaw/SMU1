import { createV2RouteRegistry } from './v2TransitionRouting.mjs';

const searchableKinds = new Set(['section-hub', 'direction', 'category', 'product-standard', 'product-premium', 'project-detail']);
const plain = (value) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
const dataOf = (value) => value?.data || value;

/** Only fields already used in public copy are allowed into this artifact. */
export function createPublicSearchIndex(snapshot = {}) {
  const rows = ['productSections', 'services', 'categories', 'products', 'projects']
    .flatMap((key) => (snapshot[key] || []).map(dataOf));
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const categories = new Map((snapshot.categories || []).map(dataOf).map((row) => [row.slug, row]));
  const entries = createV2RouteRegistry(snapshot).routes.filter((route) => searchableKinds.has(route.routeKind)).map((route) => {
    const slug = route.pathname.split('/').filter(Boolean).pop();
    const record = bySlug.get(slug) || {};
    const category = categories.get(record.productCategorySlug);
    const kind = route.routeKind.startsWith('product-') ? 'product'
      : route.routeKind === 'category' || route.routeKind === 'section-hub' ? 'category'
        : route.routeKind === 'project-detail' ? 'project' : 'direction';
    const description = plain(record.shortDescription || record.heroDescription || record.seoDescription).slice(0, 210);
    const keywords = [record.sku, category?.title, record.city, record.whatWasDone,
      ...(record.materials || []), ...(record.colors || [])].map(plain).filter(Boolean).join(' ').slice(0, 900);
    return { href: route.pathname, title: route.label, kind, description, keywords };
  });
  return { version: 1, entries };
}

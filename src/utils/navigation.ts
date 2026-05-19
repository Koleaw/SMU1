import { getCollection } from 'astro:content';
import staticNavItems from '../data/navigation.json';

type CmsNavRecord = {
  title?: string;
  slug?: string;
  isActive?: boolean;
  showInMenu?: boolean;
  menuTitle?: string;
  order?: number;
};

export type SiteNavItem = {
  title: string;
  href: string;
};

const normalizeHref = (href: string) => {
  if (href === '/') return '/';
  const withLeadingSlash = href.startsWith('/') ? href : `/${href}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

const recordHref = (record: CmsNavRecord) => normalizeHref(`/${record.slug ?? ''}/`);
const isPublished = (record: CmsNavRecord) => record.isActive !== false && Boolean(record.slug);

const navTitle = (record: CmsNavRecord, fallback?: string) =>
  record.menuTitle?.trim() || fallback || record.title?.trim() || record.slug || '';

export async function getNavigationItems(): Promise<SiteNavItem[]> {
  const [productSections, services, staticPages] = await Promise.all([
    getCollection('product-sections'),
    getCollection('services'),
    getCollection('static-pages')
  ]);

  const cmsRecords = [
    ...productSections.map(({ data }) => data as CmsNavRecord),
    ...services.map(({ data }) => data as CmsNavRecord),
    ...staticPages
      .map(({ data }) => data as CmsNavRecord)
      .filter((record) => !['home', 'custom-order'].includes(record.slug ?? ''))
  ].filter(isPublished);

  const byHref = new Map(cmsRecords.map((record) => [recordHref(record), record]));
  const usedHrefs = new Set<string>();
  const items: SiteNavItem[] = [];

  for (const staticItem of staticNavItems) {
    const href = normalizeHref(staticItem.href);
    const record = byHref.get(href);

    if (!record) {
      items.push({ title: staticItem.title, href });
      continue;
    }

    usedHrefs.add(href);
    if (record.showInMenu === false) continue;
    items.push({ title: navTitle(record, staticItem.title), href });
  }

  const extraItems = cmsRecords
    .filter((record) => record.showInMenu === true)
    .filter((record) => !usedHrefs.has(recordHref(record)))
    .sort((a, b) => {
      const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return navTitle(a).localeCompare(navTitle(b), 'ru');
    })
    .map((record) => ({ title: navTitle(record), href: recordHref(record) }))
    .filter((item) => item.title);

  return [...items, ...extraItems];
}

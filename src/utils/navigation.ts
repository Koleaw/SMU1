import staticNavItems from '../data/navigation.json';

type RawNavItem = {
  title?: string;
  isActive?: boolean;
  href?: string;
  order?: number;
};

export type SiteNavItem = {
  title: string;
  href: string;
};

const normalizeHref = (href: string) => {
  if (/^(https?:|mailto:|tel:|#)/i.test(href)) return href;
  if (href === '/') return '/';
  const withLeadingSlash = href.startsWith('/') ? href : `/${href}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

export async function getNavigationItems(): Promise<SiteNavItem[]> {
  return (staticNavItems as RawNavItem[])
    .map((item, index) => {
      const href = item.href?.trim() ?? '';
      return {
        title: item.title?.trim() ?? '',
        href: href ? normalizeHref(href) : '',
        isActive: item.isActive !== false,
        order: typeof item.order === 'number' ? item.order : (index + 1) * 10
      };
    })
    .filter((item) => item.isActive && item.title && item.href)
    .sort((a, b) => a.order - b.order)
    .map(({ title, href }) => ({ title, href }));
}

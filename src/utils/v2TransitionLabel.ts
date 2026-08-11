import { V2_CANONICAL_ROUTE_LABELS } from './v2TransitionRouting.mjs';

const normalizeRoute = (value: string) => {
  const pathname = (String(value || '/').split(/[?#]/, 1)[0] || '/')
    .replace(/^\/design-lab\/v2(?=\/|$)/, '');
  if (pathname === '/') return '/';
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

export const v2TransitionLabelForRoute = (href: string, fallback = '') => (
  V2_CANONICAL_ROUTE_LABELS[normalizeRoute(href) as keyof typeof V2_CANONICAL_ROUTE_LABELS]
  || fallback.trim()
);

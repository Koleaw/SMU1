import { withBase } from './withBase';

export type V2Scope = 'production' | 'design-lab';

const EXTERNAL_OR_FRAGMENT = /^(?:#|[a-z][a-z\d+.-]*:|\/\/)/i;
const MEDIA_OR_TOOL_PATH = /^\/(?:assets|uploads|admin)(?:\/|$)/;

const normalizeRoute = (value: string) => {
  if (value === '/') return '/';
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

export const getV2Scope = (pathname: string): V2Scope =>
  pathname.includes('/design-lab/') ? 'design-lab' : 'production';

export const productionV2Path = (value: string) => {
  if (!value || EXTERNAL_OR_FRAGMENT.test(value)) return value;

  const suffixIndex = value.search(/[?#]/);
  const suffix = suffixIndex >= 0 ? value.slice(suffixIndex) : '';
  const pathname = suffixIndex >= 0 ? value.slice(0, suffixIndex) : value;

  const designLabHomeIndex = pathname.indexOf('/design-lab/home-v2');
  if (designLabHomeIndex >= 0) return `/${suffix}`;

  const designLabV2Index = pathname.indexOf('/design-lab/v2');
  if (designLabV2Index >= 0) {
    const route = pathname.slice(designLabV2Index + '/design-lab/v2'.length);
    return `${normalizeRoute(route || '/')}${suffix}`;
  }

  const baseRoot = withBase('/');
  const withoutBase = baseRoot !== '/' && pathname.startsWith(baseRoot)
    ? `/${pathname.slice(baseRoot.length)}`
    : pathname;

  const route = MEDIA_OR_TOOL_PATH.test(withoutBase) ? withoutBase : normalizeRoute(withoutBase);
  return `${route}${suffix}`;
};

export const v2Route = (value: string, scopeOrPathname: V2Scope | string) => {
  if (!value || EXTERNAL_OR_FRAGMENT.test(value)) return value;
  const productionPath = productionV2Path(value);
  if (MEDIA_OR_TOOL_PATH.test(productionPath)) return productionPath;

  const scope = scopeOrPathname === 'production' || scopeOrPathname === 'design-lab'
    ? scopeOrPathname
    : getV2Scope(scopeOrPathname);

  if (scope === 'production') return productionPath;
  if (productionPath === '/') return '/design-lab/home-v2/';
  if (productionPath.startsWith('/#') || productionPath.startsWith('/?')) {
    return `/design-lab/home-v2/${productionPath.slice(1)}`;
  }
  return `/design-lab/v2${productionPath}`;
};

export const v2Href = (value: string, scopeOrPathname: V2Scope | string) => {
  const route = v2Route(value, scopeOrPathname);
  return EXTERNAL_OR_FRAGMENT.test(route) ? route : withBase(route);
};

export const v2CurrentState = (
  currentPath: string,
  target: string,
  parentRoutes: readonly string[] = []
): 'page' | 'location' | undefined => {
  const current = productionV2Path(currentPath);
  const normalizedTarget = productionV2Path(target);
  if (current === normalizedTarget) return 'page';
  if (parentRoutes.map(productionV2Path).includes(normalizedTarget) && current.startsWith(normalizedTarget)) {
    return 'location';
  }
  return undefined;
};

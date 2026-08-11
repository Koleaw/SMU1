// @ts-check

export const V2_ROUTE_REGISTRY_VERSION = 1;

export const V2_COMPATIBILITY_ROUTES = Object.freeze([
  '/lavochki-i-skameyki/',
  '/urny/',
  '/navesy/'
]);

/** @type {Readonly<Record<string, string>>} */
export const V2_CANONICAL_ROUTE_LABELS = Object.freeze({
  '/': 'Главная',
  '/ulichnaya-mebel/': 'Уличная мебель',
  '/ograzhdeniya-i-zabory/': 'Ограждения и заборы',
  '/navesy-i-kozyrki/': 'Навесы и козырьки',
  '/metallokonstruktsii-dlya-biznesa/': 'Металлоконструкции для бизнеса',
  '/topiarii/': 'Топиарии',
  '/blagoustroystvo-territoriy/': 'Благоустройство территорий',
  '/stroitelstvo-i-remonty/': 'Строительство и ремонты',
  '/vypolnennye-obekty/': 'Выполненные объекты',
  '/o-nas/': 'О компании',
  '/kontakty/': 'Контакты',
  '/vakansii/': 'Вакансии',
  '/politika-konfidencialnosti/': 'Политика конфиденциальности',
  '/izgotovlenie-na-zakaz/': 'Изготовление на заказ'
});

/** @type {Readonly<Record<string, string>>} */
const ROOT_BY_TOP_LEVEL_PATH = Object.freeze({
  '/': 'home',
  '/ulichnaya-mebel/': 'ulichnaya-mebel',
  '/ograzhdeniya-i-zabory/': 'ograzhdeniya-i-zabory',
  '/navesy-i-kozyrki/': 'navesy-i-kozyrki',
  '/metallokonstruktsii-dlya-biznesa/': 'metallokonstruktsii-dlya-biznesa',
  '/topiarii/': 'topiarii',
  '/blagoustroystvo-territoriy/': 'blagoustroystvo-territoriy',
  '/stroitelstvo-i-remonty/': 'stroitelstvo-i-remonty',
  '/vypolnennye-obekty/': 'projects',
  '/o-nas/': 'company',
  '/kontakty/': 'company',
  '/politika-konfidencialnosti/': 'company',
  '/vakansii/': 'careers',
  '/izgotovlenie-na-zakaz/': 'custom-order'
});

/** @type {Readonly<Record<string, string>>} */
const FIXED_ROUTE_KINDS = Object.freeze({
  '/': 'home',
  '/vypolnennye-obekty/': 'projects-archive',
  '/o-nas/': 'company',
  '/kontakty/': 'contacts',
  '/vakansii/': 'careers-archive',
  '/politika-konfidencialnosti/': 'legal',
  '/izgotovlenie-na-zakaz/': 'custom-order'
});

const NON_PRODUCTION_PREFIX = /^\/(?:_astro|assets|uploads|admin|api)(?:\/|$)/i;
const DESIGN_LAB_PREFIX = /^\/design-lab(?:\/|$)/i;
const FILE_LIKE_PATH = /\.[a-z\d]{1,12}\/?$/i;
const ROOT_ID = /^[a-z\d][a-z\d-]{0,119}$/;

/** @param {unknown} value */
const recordData = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = /** @type {Record<string, any>} */ (value);
  const data = record.data;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : record;
};

/** @param {unknown} value */
const records = (value) => Array.isArray(value)
  ? value.map(recordData).filter(Boolean)
  : [];

/** @param {unknown} value */
const cleanSlug = (value) => String(value || '').trim().replace(/^\/+|\/+$/g, '');

/** @param {unknown} value */
const cleanLabel = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/** @param {string} pathname */
export const normalizeV2BasePath = (pathname) => {
  const raw = String(pathname || '/').trim();
  if (!raw || raw === '/') return '/';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

/** @param {string} pathname */
export const normalizeV2LogicalPathname = (pathname) => {
  const raw = String(pathname || '/');
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  if (withLeadingSlash === '/') return '/';
  if (withLeadingSlash === '/404.html/' || withLeadingSlash === '/404/') return '/404.html';
  if (FILE_LIKE_PATH.test(withLeadingSlash)) return withLeadingSlash.replace(/\/$/, '');
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

/**
 * @param {string} pathname
 * @param {string} basePath
 */
export const v2RouteWithinBase = (pathname, basePath) => {
  const normalizedBase = normalizeV2BasePath(basePath);
  if (normalizedBase === '/') return pathname || '/';
  const rootWithoutSlash = normalizedBase.slice(0, -1);
  if (pathname === rootWithoutSlash || pathname === normalizedBase) return '/';
  if (!pathname.startsWith(normalizedBase)) return null;
  return `/${pathname.slice(normalizedBase.length)}`;
};

/**
 * @param {string} logicalPathname
 * @param {string} basePath
 */
export const v2PathnameWithBase = (logicalPathname, basePath) => {
  const normalizedBase = normalizeV2BasePath(basePath);
  const route = normalizeV2LogicalPathname(logicalPathname);
  if (normalizedBase === '/') return route;
  if (route === '/') return normalizedBase;
  return `${normalizedBase}${route.slice(1)}`;
};

/**
 * @typedef {object} V2RouteDescriptor
 * @property {string} pathname
 * @property {string} routeKind
 * @property {string|null} rootSectionId
 * @property {string} label
 * @property {boolean} [classified]
 * @property {boolean} [interceptEligible]
 * @property {'standard'|'premium'} [presentationType]
 */

/**
 * @typedef {object} V2RouteRegistryPayload
 * @property {number} version
 * @property {V2RouteDescriptor[]} routes
 */

/**
 * @param {Partial<V2RouteDescriptor>} descriptor
 * @returns {V2RouteDescriptor|null}
 */
const normalizeDescriptor = (descriptor) => {
  const pathname = normalizeV2LogicalPathname(String(descriptor.pathname || '/'));
  const routeKind = String(descriptor.routeKind || '').trim();
  const root = descriptor.rootSectionId;
  const rootSectionId = typeof root === 'string' && ROOT_ID.test(root) ? root : null;
  if (!routeKind || (!rootSectionId && descriptor.classified !== false && routeKind !== 'not-found')) return null;
  return {
    pathname,
    routeKind,
    rootSectionId,
    label: cleanLabel(descriptor.label),
    classified: descriptor.classified !== false,
    interceptEligible: descriptor.interceptEligible !== false,
    ...(descriptor.presentationType === 'premium' || descriptor.presentationType === 'standard'
      ? { presentationType: descriptor.presentationType }
      : {})
  };
};

/** @param {V2RouteDescriptor[]} descriptors */
const uniqueDescriptors = (descriptors) => {
  const byPath = new Map();
  descriptors.forEach((descriptor) => {
    const normalized = normalizeDescriptor(descriptor);
    if (normalized) byPath.set(normalized.pathname, normalized);
  });
  return [...byPath.values()].sort((left, right) => left.pathname.localeCompare(right.pathname, 'ru'));
};

const fixedDescriptors = () => Object.entries(FIXED_ROUTE_KINDS).map(([pathname, routeKind]) => ({
  pathname,
  routeKind,
  rootSectionId: ROOT_BY_TOP_LEVEL_PATH[pathname] || null,
  label: V2_CANONICAL_ROUTE_LABELS[pathname] || ''
}));

export const V2_FALLBACK_ROUTE_REGISTRY = Object.freeze(uniqueDescriptors([
  ...fixedDescriptors(),
  ...Object.entries(ROOT_BY_TOP_LEVEL_PATH)
    .filter(([pathname]) => !FIXED_ROUTE_KINDS[pathname])
    .map(([pathname, rootSectionId]) => ({
      pathname,
      routeKind: ['ulichnaya-mebel', 'ograzhdeniya-i-zabory'].includes(rootSectionId)
        ? 'section-hub'
        : 'direction',
      rootSectionId,
      label: V2_CANONICAL_ROUTE_LABELS[pathname] || ''
    })),
  {
    pathname: '/404.html',
    routeKind: 'not-found',
    rootSectionId: null,
    label: 'Страница не найдена',
    classified: false
  },
  ...V2_COMPATIBILITY_ROUTES.map((pathname) => ({
    pathname,
    routeKind: 'legacy-redirect',
    rootSectionId: null,
    label: '',
    classified: false,
    interceptEligible: false
  }))
]));

/**
 * Builds the authoritative route index from the same active content entities
 * which create Astro's production paths. No product/category route is listed
 * by hand, and showInCatalog=false intentionally does not remove an active
 * detail route.
 *
 * @param {object} [snapshot]
 * @param {unknown[]} [snapshot.productSections]
 * @param {unknown[]} [snapshot.services]
 * @param {unknown[]} [snapshot.categories]
 * @param {unknown[]} [snapshot.products]
 * @param {unknown[]} [snapshot.projects]
 * @param {unknown[]} [snapshot.jobs]
 * @returns {V2RouteRegistryPayload}
 */
export const createV2RouteRegistry = (snapshot = {}) => {
  const sections = records(snapshot.productSections).filter((item) => item.isActive);
  const services = records(snapshot.services).filter((item) => item.isActive);
  const sectionBySlug = new Map(sections.map((item) => [cleanSlug(item.slug), item]));
  const categories = records(snapshot.categories).filter((item) => (
    item.isActive && sectionBySlug.has(cleanSlug(item.parentSectionSlug))
  ));
  const categoryBySlug = new Map(categories.map((item) => [cleanSlug(item.slug), item]));
  const products = records(snapshot.products).filter((item) => {
    if (!item.isActive) return false;
    const category = categoryBySlug.get(cleanSlug(item.productCategorySlug));
    return Boolean(category && sectionBySlug.has(cleanSlug(category.parentSectionSlug)));
  });
  const projects = records(snapshot.projects).filter((item) => item.isActive);
  const jobs = records(snapshot.jobs).filter((item) => item.isActive);
  const categoryCountBySection = categories.reduce((counts, category) => {
    const sectionSlug = cleanSlug(category.parentSectionSlug);
    counts.set(sectionSlug, (counts.get(sectionSlug) || 0) + 1);
    return counts;
  }, new Map());

  const descriptors = [
    ...fixedDescriptors(),
    ...sections.map((section) => {
      const slug = cleanSlug(section.slug);
      const pathname = `/${slug}/`;
      return {
        pathname,
        routeKind: categoryCountBySection.has(slug) ? 'section-hub' : 'direction',
        rootSectionId: slug,
        label: V2_CANONICAL_ROUTE_LABELS[pathname] || cleanLabel(section.title)
      };
    }),
    ...services.map((service) => {
      const slug = cleanSlug(service.slug);
      const pathname = `/${slug}/`;
      return {
        pathname,
        routeKind: 'direction',
        rootSectionId: slug,
        label: V2_CANONICAL_ROUTE_LABELS[pathname] || cleanLabel(service.title)
      };
    }),
    ...categories.map((category) => {
      const sectionSlug = cleanSlug(category.parentSectionSlug);
      return {
        pathname: `/${sectionSlug}/${cleanSlug(category.slug)}/`,
        routeKind: 'category',
        rootSectionId: sectionSlug,
        label: cleanLabel(category.title)
      };
    }),
    ...products.map((product) => {
      const category = categoryBySlug.get(cleanSlug(product.productCategorySlug));
      const sectionSlug = cleanSlug(category.parentSectionSlug);
      const presentationType = product.presentationType === 'premium' ? 'premium' : 'standard';
      return {
        pathname: `/${sectionSlug}/${cleanSlug(category.slug)}/${cleanSlug(product.slug)}/`,
        routeKind: `product-${presentationType}`,
        rootSectionId: sectionSlug,
        label: cleanLabel(product.title),
        presentationType
      };
    }),
    ...projects.map((project) => ({
      pathname: `/vypolnennye-obekty/${cleanSlug(project.slug)}/`,
      routeKind: 'project-detail',
      rootSectionId: 'projects',
      label: cleanLabel(project.title)
    })),
    ...jobs.map((job) => ({
      pathname: `/vakansii/${cleanSlug(job.slug)}/`,
      routeKind: 'career-detail',
      rootSectionId: 'careers',
      label: cleanLabel(job.title)
    })),
    {
      pathname: '/404.html',
      routeKind: 'not-found',
      rootSectionId: null,
      label: 'Страница не найдена',
      classified: false
    },
    ...V2_COMPATIBILITY_ROUTES.map((pathname) => ({
      pathname,
      routeKind: 'legacy-redirect',
      rootSectionId: null,
      label: '',
      classified: false,
      interceptEligible: false
    }))
  ];

  return {
    version: V2_ROUTE_REGISTRY_VERSION,
    routes: uniqueDescriptors(descriptors)
  };
};

/** @param {unknown} value */
export const parseV2RouteRegistry = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = /** @type {Record<string, any>} */ (value);
  if (payload.version !== V2_ROUTE_REGISTRY_VERSION || !Array.isArray(payload.routes)) return null;
  const routes = uniqueDescriptors(payload.routes);
  if (routes.length === 0 || routes.length !== payload.routes.length) return null;
  return { version: V2_ROUTE_REGISTRY_VERSION, routes };
};

/**
 * @typedef {object} V2RouteClassification
 * @property {string} requestedTarget
 * @property {string} navigationTarget
 * @property {string} normalizedTarget
 * @property {string} normalizedPathname
 * @property {string} routeKind
 * @property {string|null} rootSectionId
 * @property {string} canonicalLabel
 * @property {boolean} isProductionV2
 * @property {boolean} isClassified
 * @property {boolean} interceptEligible
 * @property {string} exclusionReason
 * @property {'standard'|'premium'|undefined} presentationType
 */

/**
 * @param {string|URL} input
 * @param {object} [options]
 * @param {string} [options.origin]
 * @param {string} [options.basePath]
 * @param {V2RouteDescriptor[]} [options.registry]
 * @param {boolean} [options.registryComplete]
 * @param {boolean} [options.allowDesignLab]
 * @returns {V2RouteClassification}
 */
export const classifyV2Route = (input, options = {}) => {
  const origin = (() => {
    try { return new URL(options.origin || 'http://route.local').origin; }
    catch { return 'http://route.local'; }
  })();
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input || '/'), `${origin}/`);
  } catch {
    url = new URL('/', `${origin}/`);
  }
  const requestedTarget = `${url.pathname}${url.search}${url.hash}`;
  const basePath = normalizeV2BasePath(options.basePath || '/');
  const logicalWithinBase = v2RouteWithinBase(url.pathname, basePath);
  const outsideOrigin = url.origin !== origin;
  const wrongProtocol = !['http:', 'https:'].includes(url.protocol);
  const outsideBase = logicalWithinBase === null;
  const logicalPathname = outsideBase
    ? normalizeV2LogicalPathname(url.pathname)
    : normalizeV2LogicalPathname(logicalWithinBase);
  const lowerPathname = logicalPathname.toLowerCase();
  const registry = Array.isArray(options.registry) && options.registry.length
    ? uniqueDescriptors(options.registry)
    : /** @type {V2RouteDescriptor[]} */ ([...V2_FALLBACK_ROUTE_REGISTRY]);
  const byPath = new Map(registry.map((descriptor) => [descriptor.pathname, descriptor]));
  const descriptor = byPath.get(logicalPathname) || null;

  let exclusionReason = '';
  if (wrongProtocol) exclusionReason = 'protocol';
  else if (outsideOrigin) exclusionReason = 'external-origin';
  else if (outsideBase) exclusionReason = 'outside-base';
  else if (NON_PRODUCTION_PREFIX.test(lowerPathname)) exclusionReason = 'non-production-path';
  else if (DESIGN_LAB_PREFIX.test(lowerPathname) && options.allowDesignLab !== true) exclusionReason = 'design-lab';
  else if (V2_COMPATIBILITY_ROUTES.includes(lowerPathname)) exclusionReason = 'compatibility-route';
  else if (descriptor?.interceptEligible === false) exclusionReason = 'route-opt-out';
  else if (!descriptor && FILE_LIKE_PATH.test(logicalPathname)) exclusionReason = 'file-like-path';

  const interceptEligible = !exclusionReason;
  const isProductionV2 = interceptEligible && !DESIGN_LAB_PREFIX.test(lowerPathname);
  const canonicalPathname = descriptor?.pathname || logicalPathname;
  const navigationPathname = descriptor
    ? v2PathnameWithBase(canonicalPathname, basePath)
    : url.pathname;
  const navigationTarget = `${navigationPathname}${url.search}${url.hash}`;
  const normalizedTarget = `${canonicalPathname}${url.search}${url.hash}`;

  return {
    requestedTarget,
    navigationTarget,
    normalizedTarget,
    normalizedPathname: canonicalPathname,
    routeKind: descriptor?.routeKind || 'unknown',
    rootSectionId: descriptor?.rootSectionId || null,
    canonicalLabel: descriptor?.label || '',
    isProductionV2,
    isClassified: Boolean(descriptor?.classified !== false && descriptor?.rootSectionId),
    interceptEligible,
    exclusionReason,
    presentationType: descriptor?.presentationType
  };
};

/**
 * @param {V2RouteClassification|null|undefined} from
 * @param {V2RouteClassification|null|undefined} to
 * @returns {'h3'|'calm'|'native'|'none'}
 */
export const resolveV2TransitionMode = (from, to) => {
  if (!to || !to.interceptEligible || !to.isProductionV2) return 'native';
  if (from && (!from.interceptEligible || !from.isProductionV2)) return 'native';
  if (from && (
    from.navigationTarget === to.navigationTarget
    || from.normalizedPathname === to.normalizedPathname
  )) return 'native';
  if (!from) return 'none';
  if (!from.isClassified || !to.isClassified || !from.rootSectionId || !to.rootSectionId) return 'calm';
  return from.rootSectionId === to.rootSectionId ? 'calm' : 'h3';
};

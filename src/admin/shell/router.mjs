export const ADMIN_VIEWS = Object.freeze({
  overview: Object.freeze({ title: 'Обзор', collectionGroups: [] }),
  pages: Object.freeze({ title: 'Страницы сайта', collectionGroups: ['static-pages', 'services', 'jobs', 'navigation'] }),
  catalog: Object.freeze({ title: 'Каталог', collectionGroups: ['product-sections', 'product-categories', 'products'] }),
  projects: Object.freeze({ title: 'Выполненные объекты', collectionGroups: ['projects'] }),
  preview: Object.freeze({ title: 'Тестовый сайт', collectionGroups: [] }),
  media: Object.freeze({ title: 'Медиа', collectionGroups: [] }),
  history: Object.freeze({ title: 'История и восстановление', collectionGroups: [] }),
  settings: Object.freeze({ title: 'Настройки и дополнительно', collectionGroups: ['site-settings', 'yandex'] })
});

const COLLECTION_VIEW = Object.freeze({
  'static-pages': 'pages', services: 'pages', jobs: 'pages', navigation: 'pages',
  'site-settings': 'settings', yandex: 'settings',
  'product-sections': 'catalog', 'product-categories': 'catalog', products: 'catalog',
  projects: 'projects'
});

function safeView(value, fallback = 'overview') {
  return Object.hasOwn(ADMIN_VIEWS, value) ? value : fallback;
}

export function routeForRecord(collection, slug, { basePath = '/admin/' } = {}) {
  const view = COLLECTION_VIEW[collection] || 'pages';
  const params = new URLSearchParams({ view, collection, slug });
  return `${basePath}?${params}`;
}

export function parseAdminRoute({ defaultView = 'overview', defaultCollection = '', defaultSlug = '' } = {}) {
  const params = new URLSearchParams(globalThis.location?.search || '');
  const collection = params.get('collection') || defaultCollection;
  const slug = params.get('slug') || defaultSlug;
  const inferredView = collection ? COLLECTION_VIEW[collection] : '';
  return Object.freeze({
    view: safeView(params.get('view') || inferredView || defaultView, defaultView),
    collection,
    slug
  });
}

export function createAdminRouter({ basePath = '/admin/', initialRoute, onRoute, guardRoute = () => true }) {
  let current = Object.freeze({ ...initialRoute });
  function routeUrl(route) {
    const params = new URLSearchParams();
    if (route.view && route.view !== 'overview') params.set('view', route.view);
    if (route.collection) params.set('collection', route.collection);
    if (route.slug) params.set('slug', route.slug);
    const query = params.toString();
    return `${basePath}${query ? `?${query}` : ''}`;
  }
  function navigate(next, { replace = false, notify = true } = {}) {
    current = Object.freeze({
      view: safeView(next.view || current.view),
      collection: next.collection ?? '',
      slug: next.slug ?? ''
    });
    const method = replace ? 'replaceState' : 'pushState';
    globalThis.history?.[method]?.(current, '', routeUrl(current));
    if (notify) onRoute(current);
    return current;
  }
  globalThis.addEventListener?.('popstate', (event) => {
    const next = event.state?.view
      ? Object.freeze(event.state)
      : parseAdminRoute({ defaultView: initialRoute.view });
    if (!guardRoute(next, { source: 'popstate', current })) {
      globalThis.history?.pushState?.(current, '', routeUrl(current));
      return;
    }
    current = next;
    onRoute(current);
  });
  return Object.freeze({ get current() { return current; }, navigate, routeUrl });
}

export function viewForCollection(collection) {
  return COLLECTION_VIEW[collection] || 'pages';
}

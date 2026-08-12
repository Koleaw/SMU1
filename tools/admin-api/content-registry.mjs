export const COLLECTION_KEYS = Object.freeze([
  'product-sections',
  'product-categories',
  'products',
  'services',
  'projects',
  'jobs',
  'site-settings',
  'static-pages'
]);

export const SINGLETON_KEYS = Object.freeze(['navigation', 'yandex']);

const PAGE_BLOCK_COLLECTIONS = new Set(['product-sections', 'services', 'static-pages']);

const COLLECTION_LABELS = Object.freeze({
  'product-sections': 'Страницы каталога',
  'product-categories': 'Подстраницы каталога',
  products: 'Товары каталога',
  services: 'Проектные страницы',
  projects: 'Выполненные объекты',
  jobs: 'Вакансии',
  'site-settings': 'Настройки сайта',
  'static-pages': 'Страницы'
});

const MEDIA_FIELDS_BY_COLLECTION = Object.freeze({
  'product-sections': Object.freeze([
    'image', 'gallery[]', 'gallery[].src',
    'heroMediaVideo', 'heroMediaVideoMobile', 'heroMediaPoster', 'heroMediaPosterMobile',
    'pageBlocks[].media', 'pageBlocks[].image', 'pageBlocks[].video', 'pageBlocks[].poster',
    'pageBlocks[].items[].image', 'pageBlocks[].items[].video', 'pageBlocks[].items[].poster',
    'pageBlocks[].items[].src', 'pageBlocks[].items[].url'
  ]),
  'product-categories': Object.freeze(['image', 'gallery[]', 'gallery[].src']),
  products: Object.freeze(['image', 'gallery[]']),
  services: Object.freeze([
    'image', 'heroMediaVideo', 'heroMediaVideoMobile', 'heroMediaPoster', 'heroMediaPosterMobile',
    'pageBlocks[].media', 'pageBlocks[].image', 'pageBlocks[].video', 'pageBlocks[].poster',
    'pageBlocks[].items[].image', 'pageBlocks[].items[].video', 'pageBlocks[].items[].poster',
    'pageBlocks[].items[].src', 'pageBlocks[].items[].url'
  ]),
  projects: Object.freeze([
    'image', 'coverImage', 'gallery[]', 'gallery[].src', 'gallery[].image', 'gallery[].url',
    'images[]', 'images[].src', 'images[].image', 'images[].url'
  ]),
  jobs: Object.freeze([]),
  'site-settings': Object.freeze([]),
  'static-pages': Object.freeze([
    'image', 'trustImage', 'heroMediaVideo', 'heroMediaVideoMobile', 'heroMediaPoster', 'heroMediaPosterMobile',
    'pathwayCards[].image', 'pageBlocks[].media', 'pageBlocks[].image', 'pageBlocks[].video', 'pageBlocks[].poster',
    'pageBlocks[].items[].image', 'pageBlocks[].items[].video', 'pageBlocks[].items[].poster',
    'pageBlocks[].items[].src', 'pageBlocks[].items[].url'
  ])
});

const URL_FIELDS_BY_COLLECTION = Object.freeze({
  'product-sections': Object.freeze([
    Object.freeze({ path: 'pageBlocks[].buttonHref', context: 'link' }),
    Object.freeze({ path: 'pageBlocks[].items[].buttonHref', context: 'link' })
  ]),
  'product-categories': Object.freeze([]),
  products: Object.freeze([]),
  services: Object.freeze([
    Object.freeze({ path: 'pageBlocks[].buttonHref', context: 'link' }),
    Object.freeze({ path: 'pageBlocks[].items[].buttonHref', context: 'link' })
  ]),
  projects: Object.freeze([]),
  jobs: Object.freeze([]),
  'site-settings': Object.freeze([
    Object.freeze({ path: 'telegram', context: 'https', allowEmpty: true, allowedHosts: Object.freeze(['t.me', 'telegram.me']) })
  ]),
  'static-pages': Object.freeze([
    Object.freeze({ path: 'pathwayCards[].buttonHref', context: 'link' }),
    Object.freeze({ path: 'pageBlocks[].buttonHref', context: 'link' }),
    Object.freeze({ path: 'pageBlocks[].items[].buttonHref', context: 'link' })
  ])
});

export const COLLECTION_REGISTRY = Object.freeze(Object.fromEntries(
  COLLECTION_KEYS.map((key) => [key, Object.freeze({
    key,
    kind: 'collection',
    label: COLLECTION_LABELS[key],
    storage: key === 'site-settings' ? 'single-file' : 'directory',
    fixedSlug: key === 'site-settings' ? 'global' : null,
    hasSlug: key !== 'site-settings',
    supportsPageBlocks: PAGE_BLOCK_COLLECTIONS.has(key),
    mediaFields: MEDIA_FIELDS_BY_COLLECTION[key],
    urlFields: URL_FIELDS_BY_COLLECTION[key]
  })])
));

export const SINGLETON_REGISTRY = Object.freeze({
  navigation: Object.freeze({
    key: 'navigation',
    kind: 'singleton',
    label: 'Навигация',
    storage: 'single-file-array',
    fixedSlug: 'navigation',
    urlFields: Object.freeze([
      Object.freeze({ path: 'items[].href', context: 'link' })
    ])
  }),
  yandex: Object.freeze({
    key: 'yandex',
    kind: 'singleton',
    label: 'Настройки Яндекса',
    storage: 'single-file-object',
    fixedSlug: 'yandex',
    urlFields: Object.freeze([
      Object.freeze({ path: 'metrika.scriptSrc', context: 'https', allowedHosts: Object.freeze(['mc.yandex.ru']) }),
      Object.freeze({ path: 'map.constructorSrc', context: 'https', allowedHosts: Object.freeze(['api-maps.yandex.ru']) }),
      Object.freeze({ path: 'ratingBadge.src', context: 'https', allowedHosts: Object.freeze(['yandex.ru']) }),
      Object.freeze({ path: 'links.yandexMapsCompanyUrl', context: 'https', allowEmpty: true, nullable: true, allowedHosts: Object.freeze(['yandex.ru', 'yandex.com', 'ya.ru']) }),
      Object.freeze({ path: 'links.yandexReviewUrl', context: 'https', allowEmpty: true, nullable: true, allowedHosts: Object.freeze(['yandex.ru', 'yandex.com', 'ya.ru']) })
    ])
  })
});

export const CONTENT_REGISTRY = Object.freeze({
  collections: COLLECTION_REGISTRY,
  singletons: SINGLETON_REGISTRY
});

const friendly = (label, itemPolicy = 'none') => Object.freeze({
  label,
  known: true,
  rendererSupported: true,
  editorMode: 'friendly',
  mutationPolicy: 'editable',
  itemPolicy
});

const advanced = (label, itemPolicy = 'none') => Object.freeze({
  label,
  known: true,
  rendererSupported: true,
  editorMode: 'advanced',
  mutationPolicy: 'editable',
  itemPolicy
});

export const PAGE_BLOCK_REGISTRY = Object.freeze({
  heroSection: friendly('Hero-секция'),
  textBlock: friendly('Текстовый блок'),
  whoWeAre: friendly('Кто мы и что мы делаем'),
  directionCards: friendly('Карточки направлений / решений', 'cards'),
  benefits: friendly('Преимущества', 'cards'),
  process: friendly('Этапы работы', 'steps'),
  gallery: friendly('Галерея', 'gallery'),
  cta: friendly('Призыв к действию'),
  faq: friendly('Вопросы и ответы', 'faq'),
  customOrder: friendly('Изготавливаем под объект'),
  costFactors: friendly('Что влияет на стоимость', 'text-list'),
  cardGrid: friendly('Карточки', 'cards'),
  listPanel: friendly('Список', 'text-list'),
  mediaText: friendly('Фото и текст'),
  notice: friendly('Текстовая вставка'),
  exampleGrid: advanced('Примеры', 'cards'),
  factorList: advanced('Факторы', 'text-list'),
  solutions: advanced('Решения', 'cards'),
  companyProof: advanced('Объекты компании'),
  companyDirections: advanced('Направления компании'),
  companyDetails: advanced('Реквизиты компании')
});

const UNKNOWN_PAGE_BLOCK_POLICY = Object.freeze({
  label: 'Legacy-блок',
  known: false,
  rendererSupported: false,
  editorMode: 'read-only',
  mutationPolicy: 'no-op-only',
  itemPolicy: 'opaque'
});

export function isCollectionKey(value) {
  return typeof value === 'string' && Object.hasOwn(COLLECTION_REGISTRY, value);
}

export function isSingletonKey(value) {
  return typeof value === 'string' && Object.hasOwn(SINGLETON_REGISTRY, value);
}

export function getCollectionDefinition(key) {
  return isCollectionKey(key) ? COLLECTION_REGISTRY[key] : null;
}

export function getSingletonDefinition(key) {
  return isSingletonKey(key) ? SINGLETON_REGISTRY[key] : null;
}

export function requireCollectionDefinition(key) {
  const definition = getCollectionDefinition(key);
  if (definition) return definition;
  const error = new Error(`Коллекция “${String(key)}” не зарегистрирована.`);
  error.code = 'CONTENT_COLLECTION_UNKNOWN';
  throw error;
}

export function requireSingletonDefinition(key) {
  const definition = getSingletonDefinition(key);
  if (definition) return definition;
  const error = new Error(`Singleton “${String(key)}” не зарегистрирован.`);
  error.code = 'CONTENT_SINGLETON_UNKNOWN';
  throw error;
}

export function getPageBlockPolicy(type) {
  const normalizedType = typeof type === 'string' ? type : '';
  const known = PAGE_BLOCK_REGISTRY[normalizedType];
  return known
    ? Object.freeze({ type: normalizedType, ...known })
    : Object.freeze({ type: normalizedType, ...UNKNOWN_PAGE_BLOCK_POLICY });
}

export function listCreatablePageBlockTypes() {
  return Object.entries(PAGE_BLOCK_REGISTRY)
    .filter(([, policy]) => policy.editorMode === 'friendly')
    .map(([type, policy]) => Object.freeze({ type, label: policy.label }));
}

export function classifyPageBlocks(pageBlocks) {
  if (!Array.isArray(pageBlocks)) return Object.freeze([]);
  return Object.freeze(pageBlocks.map((block, index) => Object.freeze({
    index,
    ...getPageBlockPolicy(block?.type)
  })));
}

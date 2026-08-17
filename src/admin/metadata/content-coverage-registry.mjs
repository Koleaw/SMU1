/**
 * Renderer-truth metadata for the H6 admin.
 *
 * This module intentionally contains data only. It is safe to import from the
 * browser-facing admin because it does not load Astro content collections or
 * public renderers. Tests compare the declared paths below with the real Zod
 * schemas and fail closed when either side changes.
 */

export const FIELD_COVERAGE_STATUS = Object.freeze({
  RENDERER_BACKED: 'renderer-backed',
  DELIBERATELY_HIDDEN: 'deliberately-hidden',
  LEGACY_ONLY: 'legacy-only'
});

export const EDITOR_FIELD_STATUS = Object.freeze({
  FRIENDLY: 'friendly',
  ADVANCED: 'advanced',
  COMPUTED: 'computed',
  READ_ONLY: 'read-only',
  LEGACY_NOT_RENDERED: 'legacy-not-rendered'
});

export const PAGE_BLOCK_SUPPORT_STATUS = Object.freeze({
  RENDERED: 'renderer-backed',
  SELECTOR_CONSTRAINED: 'selector-constrained',
  NOT_RENDERED: 'not-rendered'
});

const freezeArray = (values) => Object.freeze([...new Set(values)]);

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const objectPaths = (name, fields) => [name, ...fields.map((field) => `${name}.${field}`)];
const objectArrayPaths = (name, fields) => [name, ...fields.map((field) => `${name}[].${field}`)];
const scalarArrayPaths = (name) => [name, `${name}[]`];

const IMAGE_VIEW_FIELDS = Object.freeze(['fit', 'positionX', 'positionY', 'scale']);
const TEXT_STYLE_FIELDS = Object.freeze(['fontSize', 'fontWeight', 'italic', 'align', 'lineHeight', 'color']);
const TEXT_LAYOUT_FIELDS = Object.freeze(['width', 'widthPercent', 'maxWidth', 'position', 'padding', 'verticalPadding']);

export const PAGE_BLOCK_SCHEMA_FIELDS = freezeArray([
  'type', 'title', 'intro', 'text', 'theme', 'background', 'grid', 'columns', 'isActive', 'order', 'sectionId',
  'items', 'items[]', 'steps',
  ...objectArrayPaths('steps', ['title', 'text', 'order', 'isActive']).slice(1),
  'media', 'image', 'video', 'poster', 'placeholderLabel', 'mediaPosition',
  ...objectPaths('mediaView', IMAGE_VIEW_FIELDS),
  'buttonLabel', 'buttonHref', 'textWidth', 'textAlign', 'titleSize', 'textSize', 'textWeight', 'textItalic',
  ...objectPaths('textStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('titleStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('layout', TEXT_LAYOUT_FIELDS),
  'paddingTop', 'paddingBottom'
]);

const pageBlockPaths = () => [
  'pageBlocks',
  ...PAGE_BLOCK_SCHEMA_FIELDS.map((field) => `pageBlocks[].${field}`)
];

const categoryGalleryPaths = (name = 'gallery') => [
  name,
  `${name}[]`,
  `${name}[].src`,
  `${name}[].alt`,
  `${name}[].caption`
];

const projectMediaPaths = (name) => [
  name,
  `${name}[]`,
  `${name}[].src`,
  `${name}[].image`,
  `${name}[].url`,
  `${name}[].alt`,
  `${name}[].caption`
];

const PRODUCT_SECTION_PATHS = freezeArray([
  'title', 'slug', 'shortDescription', 'heroTitle', 'heroDescription', 'order', 'showOnHome', 'isActive', 'mode',
  'showInMenu', 'menuTitle', 'heroKicker', 'showBadge', 'heroMediaVideo', 'heroMediaVideoMobile',
  'heroMediaPoster', 'heroMediaPosterMobile', 'heroOverlayOpacity',
  ...objectPaths('heroTitleStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('heroDescriptionStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('heroLayout', TEXT_LAYOUT_FIELDS),
  'image', ...objectPaths('imageView', IMAGE_VIEW_FIELDS),
  ...categoryGalleryPaths(), 'galleryIntro', 'placeholderLabel',
  'contactTitle', 'contactDescription', 'contactTelegramLabel', 'contactEmailLabel', 'contactPhoneLabel',
  'seoTitle', 'seoDescription', ...pageBlockPaths()
]);

const PRODUCT_CATEGORY_PATHS = freezeArray([
  'title', 'slug', 'parentSectionSlug', 'shortDescription', 'heroTitle', 'heroDescription',
  ...objectPaths('heroTitleStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('heroDescriptionStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('heroLayout', TEXT_LAYOUT_FIELDS),
  'order', 'showInSectionGrid', 'isActive', 'image', ...objectPaths('imageView', IMAGE_VIEW_FIELDS),
  ...categoryGalleryPaths(), 'galleryIntro', 'placeholderLabel', 'mode', 'seoTitle', 'seoDescription'
]);

const PRODUCT_PATHS = freezeArray([
  'title', 'slug', 'productCategorySlug', 'sku', 'presentationType', 'shortDescription', 'leadText', 'description',
  'solutionKicker', ...scalarArrayPaths('applicationItems'), ...scalarArrayPaths('executionVariants'),
  ...scalarArrayPaths('materials'), ...scalarArrayPaths('colors'),
  ...objectArrayPaths('dimensions', ['label', 'value', 'order', 'isActive']),
  ...scalarArrayPaths('features'), 'priceMode', 'priceFrom', 'currency', 'image',
  ...objectPaths('imageView', IMAGE_VIEW_FIELDS), ...scalarArrayPaths('gallery'), 'placeholderLabel',
  ...scalarArrayPaths('customizationItems'), 'showDeliveryBlock', 'deliveryText',
  ...scalarArrayPaths('relatedProductSlugs'), 'showCustomProjectBlock', 'customProjectTitle', 'customProjectText',
  ...objectPaths('descriptionTextStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('descriptionLayout', TEXT_LAYOUT_FIELDS),
  'order', 'isActive', 'showInCatalog', 'seoTitle', 'seoDescription'
]);

const SERVICE_PATHS = freezeArray([
  'title', 'slug', 'shortDescription', 'heroTitle', 'heroDescription', 'order', 'showOnHome', 'isActive',
  'showInMenu', 'menuTitle', 'heroKicker', 'showBadge', 'heroMediaVideo', 'heroMediaVideoMobile',
  'heroMediaPoster', 'heroMediaPosterMobile', 'heroOverlayOpacity',
  ...objectPaths('heroTitleStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('heroDescriptionStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('heroLayout', TEXT_LAYOUT_FIELDS),
  'image', ...objectPaths('imageView', IMAGE_VIEW_FIELDS), 'placeholderLabel',
  'contactTitle', 'contactDescription', 'contactTelegramLabel', 'contactEmailLabel', 'contactPhoneLabel',
  'seoTitle', 'seoDescription', ...pageBlockPaths()
]);

const PROJECT_PATHS = freezeArray([
  'title', 'slug', 'city', 'region', 'workType', 'category', 'shortCategory', 'summary', 'task', 'locationLabel',
  ...scalarArrayPaths('workTypes'), 'scope', 'result', ...scalarArrayPaths('materials'), ...scalarArrayPaths('features'),
  'clientVisibility', 'shortDescription', 'whatWasDone', 'image', 'coverImage',
  ...projectMediaPaths('gallery'), ...projectMediaPaths('images'), ...scalarArrayPaths('captions'),
  'placeholderLabel', 'order', 'isActive', 'year', 'seoTitle', 'seoDescription'
]);

const JOB_PATHS = freezeArray([
  'title', 'slug', 'city', 'employmentType', 'salary', 'shortDescription',
  ...scalarArrayPaths('responsibilities'), ...scalarArrayPaths('requirements'), ...scalarArrayPaths('conditions'),
  'order', 'isActive'
]);

const SITE_SETTINGS_PATHS = freezeArray([
  'companyName', 'companyShortName', 'inn', 'kpp', 'ogrn', 'registrationDate', 'legalAddress',
  'phonePrimary', 'phoneSecondary', 'telegram', 'telegramLabel', 'email', 'city', 'address',
  ...scalarArrayPaths('regions'), 'vacanciesEmptyTitle', 'vacanciesEmptyText'
]);

const STATIC_PAGE_PATHS = freezeArray([
  'title', 'slug', 'seoTitle', 'seoDescription', 'isActive', 'order', 'showInMenu', 'menuTitle', 'showBadge',
  'heroKicker', 'heroTitle', 'heroDescription', 'heroPrimaryLabel', 'heroSecondaryLabel',
  'heroMediaVideo', 'heroMediaVideoMobile', 'heroMediaPoster', 'heroMediaPosterMobile', 'heroMediaCaption',
  'heroOverlayOpacity', ...objectPaths('heroTitleStyle', TEXT_STYLE_FIELDS),
  ...objectPaths('heroDescriptionStyle', TEXT_STYLE_FIELDS), ...objectPaths('heroLayout', TEXT_LAYOUT_FIELDS),
  'image', ...objectPaths('imageView', IMAGE_VIEW_FIELDS), 'placeholderLabel',
  'pathwaysKicker', 'pathwaysTitle',
  ...objectArrayPaths('pathwayCards', [
    'title', 'text', 'order', 'isActive', 'image',
    ...objectPaths('imageView', IMAGE_VIEW_FIELDS),
    'placeholderLabel', 'buttonLabel', 'buttonHref'
  ]),
  'productsTitle', 'productsIntro', 'servicesTitle', 'servicesIntro', 'trustTitle', 'trustText',
  'trustImage', 'trustCaption', 'contactTitle', 'contactDescription', ...pageBlockPaths()
]);

const NAVIGATION_PATHS = freezeArray([
  'items', 'items[].title', 'items[].href', 'items[].order', 'items[].isActive'
]);

const YANDEX_PATHS = freezeArray([
  'metrika', 'metrika.counterId', 'metrika.scriptSrc', 'metrika.init',
  'metrika.init.ssr', 'metrika.init.webvisor', 'metrika.init.clickmap', 'metrika.init.ecommerce',
  'metrika.init.accurateTrackBounce', 'metrika.init.trackLinks',
  'map', 'map.constructorSrc', 'map.height',
  'ratingBadge', 'ratingBadge.src', 'ratingBadge.width', 'ratingBadge.height',
  'links', 'links.yandexMapsCompanyUrl', 'links.yandexReviewUrl'
]);

export const DECLARED_SCHEMA_PATHS = deepFreeze({
  'product-sections': PRODUCT_SECTION_PATHS,
  'product-categories': PRODUCT_CATEGORY_PATHS,
  products: PRODUCT_PATHS,
  services: SERVICE_PATHS,
  projects: PROJECT_PATHS,
  jobs: JOB_PATHS,
  'site-settings': SITE_SETTINGS_PATHS,
  'static-pages': STATIC_PAGE_PATHS,
  navigation: NAVIGATION_PATHS,
  yandex: YANDEX_PATHS
});

export const TEMPLATE_FAMILIES = deepFreeze({
  HOME: { key: 'home', routeFamily: '/', consumers: ['src/components/v2/home-final/HomeFinal.astro', 'src/components/v2/home-v2/homeV2Presentation.ts'] },
  DIRECTION_HUB: { key: 'direction-hub', routeFamily: '/[slug]/', consumers: ['src/components/v2/CatalogSectionV2.astro'] },
  SPECIALIZED_DIRECTION: { key: 'specialized-direction', routeFamily: '/[slug]/', consumers: ['src/components/v2/pages/CanopiesV2Page.astro', 'src/components/v2/pages/MetalworksV2Page.astro', 'src/components/v2/pages/TopiaryV2Page.astro'] },
  CATEGORY: { key: 'category', routeFamily: '/[section]/[category]/', consumers: ['src/components/v2/CatalogCategoryV2.astro'] },
  STANDARD_PRODUCT: { key: 'standard-product', routeFamily: '/[section]/[category]/[product]/', consumers: ['src/components/v2/CatalogStandardProductV2.astro'] },
  PREMIUM_PRODUCT: { key: 'premium-product', routeFamily: '/[section]/[category]/[product]/', consumers: ['src/components/v2/CatalogPremiumProductV2.astro'] },
  PROJECT_ARCHIVE: { key: 'project-archive', routeFamily: '/vypolnennye-obekty/', consumers: ['src/components/v2/projects/V2ProjectArchivePage.astro'] },
  PROJECT_DETAIL: { key: 'project-detail', routeFamily: '/vypolnennye-obekty/[slug]/', consumers: ['src/components/v2/projects/V2ProjectDetail.astro'] },
  COMPANY: { key: 'company', routeFamily: '/o-nas/', consumers: ['src/components/v2/practical/V2CompanyPage.astro'] },
  CONTACTS: { key: 'contacts', routeFamily: '/kontakty/', consumers: ['src/components/v2/practical/V2ContactsPage.astro'] },
  JOB_ARCHIVE: { key: 'job-archive', routeFamily: '/vakansii/', consumers: ['src/components/v2/practical/V2VacanciesArchive.astro'] },
  JOB_DETAIL: { key: 'job-detail', routeFamily: '/vakansii/[slug]/', consumers: ['src/components/v2/practical/V2VacancyDetail.astro'] },
  CUSTOM_ORDER: { key: 'custom-order', routeFamily: '/izgotovlenie-na-zakaz/', consumers: ['src/components/v2/custom-order/CustomOrderV2Page.astro', 'src/components/v2/custom-order/customOrderV2Data.ts'] },
  SERVICE_DIRECTION: { key: 'service-direction', routeFamily: '/[slug]/', consumers: ['src/components/v2/pages/LandscapingV2Page.astro', 'src/components/v2/pages/ConstructionV2Page.astro'] },
  NAVIGATION_HEADER: { key: 'navigation-header', routeFamily: 'global', consumers: ['src/utils/navigation.ts', 'src/utils/v2Navigation.ts'] },
  GLOBAL_SETTINGS: { key: 'global-settings', routeFamily: 'global', consumers: ['src/components/v2/home-v2/HomeV2Header.astro', 'src/components/v2/home-v2/HomeV2Footer.astro', 'src/components/v2/practical/V2ContactsPage.astro'] },
  YANDEX_INTEGRATIONS: { key: 'yandex-integrations', routeFamily: 'global', consumers: ['src/layouts/PublicV2Layout.astro', 'src/components/v2/practical/V2YandexMap.astro', 'src/components/v2/practical/V2ContactsPage.astro'] }
});

const TEMPLATE_KEYS = Object.freeze(Object.fromEntries(
  Object.entries(TEMPLATE_FAMILIES).map(([name, definition]) => [name, definition.key])
));

const FIELD_LABELS = Object.freeze({
  title: 'Заголовок',
  slug: 'Адрес страницы',
  shortDescription: 'Краткое описание',
  heroTitle: 'Заголовок первого экрана',
  heroDescription: 'Описание первого экрана',
  order: 'Порядок',
  showOnHome: 'Показывать на главной',
  isActive: 'Показывать на сайте',
  mode: 'Режим страницы',
  showInMenu: 'Показывать в меню',
  menuTitle: 'Название в меню',
  heroKicker: 'Надзаголовок первого экрана',
  showBadge: 'Показывать метку',
  heroMediaVideo: 'Видео первого экрана',
  heroMediaVideoMobile: 'Видео первого экрана для телефона',
  heroMediaPoster: 'Обложка видео первого экрана',
  heroMediaPosterMobile: 'Мобильная обложка видео',
  heroMediaCaption: 'Подпись медиа первого экрана',
  heroOverlayOpacity: 'Затемнение первого экрана',
  heroTitleStyle: 'Оформление заголовка первого экрана',
  heroDescriptionStyle: 'Оформление описания первого экрана',
  heroLayout: 'Компоновка первого экрана',
  image: 'Основное изображение',
  imageView: 'Кадрирование изображения',
  fit: 'Режим заполнения',
  positionX: 'Позиция по горизонтали',
  positionY: 'Позиция по вертикали',
  scale: 'Масштаб',
  gallery: 'Галерея',
  src: 'Источник медиа',
  url: 'Ссылка на медиа',
  alt: 'Описание изображения',
  caption: 'Подпись изображения',
  galleryIntro: 'Вступление к галерее',
  placeholderLabel: 'Подпись заглушки',
  contactTitle: 'Заголовок контакта',
  contactDescription: 'Описание контакта',
  contactTelegramLabel: 'Подпись Telegram',
  contactEmailLabel: 'Подпись электронной почты',
  contactPhoneLabel: 'Подпись телефона',
  seoTitle: 'SEO-заголовок',
  seoDescription: 'SEO-описание',
  pageBlocks: 'Секции страницы',
  type: 'Тип секции',
  intro: 'Вступительный текст',
  text: 'Текст',
  theme: 'Тема оформления',
  background: 'Фон',
  grid: 'Сетка карточек',
  columns: 'Количество колонок',
  sectionId: 'Служебный идентификатор секции',
  items: 'Элементы',
  steps: 'Этапы',
  media: 'Медиа',
  video: 'Видео',
  poster: 'Обложка видео',
  mediaPosition: 'Положение медиа',
  mediaView: 'Кадрирование медиа',
  buttonLabel: 'Текст кнопки',
  buttonHref: 'Ссылка кнопки',
  secondaryButtonLabel: 'Текст второй кнопки',
  textWidth: 'Ширина текста',
  textAlign: 'Выравнивание текста',
  titleSize: 'Размер заголовка',
  textSize: 'Размер текста',
  textWeight: 'Насыщенность текста',
  textItalic: 'Курсив',
  textStyle: 'Оформление текста',
  titleStyle: 'Оформление заголовка',
  layout: 'Компоновка текста',
  fontSize: 'Размер шрифта',
  fontWeight: 'Насыщенность шрифта',
  italic: 'Курсивное начертание',
  align: 'Выравнивание',
  lineHeight: 'Межстрочный интервал',
  color: 'Цвет текста',
  width: 'Ширина',
  widthPercent: 'Ширина в процентах',
  maxWidth: 'Максимальная ширина',
  position: 'Положение',
  padding: 'Внутренний отступ',
  verticalPadding: 'Вертикальный отступ',
  paddingTop: 'Отступ сверху',
  paddingBottom: 'Отступ снизу',
  parentSectionSlug: 'Родительский раздел',
  showInSectionGrid: 'Показывать в разделе',
  productCategorySlug: 'Категория товара',
  sku: 'Артикул',
  presentationType: 'Формат карточки',
  leadText: 'Вводный текст',
  description: 'Полное описание',
  solutionKicker: 'Надзаголовок решения',
  applicationItems: 'Сферы применения',
  executionVariants: 'Варианты исполнения',
  materials: 'Материалы',
  colors: 'Цвета',
  dimensions: 'Размеры и характеристики',
  label: 'Название характеристики',
  value: 'Значение',
  features: 'Особенности',
  priceMode: 'Режим цены',
  priceFrom: 'Цена от',
  currency: 'Валюта',
  customizationItems: 'Возможности адаптации',
  showDeliveryBlock: 'Показывать доставку',
  deliveryText: 'Текст о доставке',
  relatedProductSlugs: 'Связанные товары',
  showCustomProjectBlock: 'Показывать индивидуальное исполнение',
  showInCatalog: 'Показывать в каталоге',
  customProjectTitle: 'Заголовок индивидуального исполнения',
  customProjectText: 'Описание индивидуального исполнения',
  descriptionTextStyle: 'Оформление описания',
  descriptionLayout: 'Компоновка описания',
  city: 'Город',
  region: 'Регион',
  workType: 'Старый тип работ',
  category: 'Категория объекта',
  shortCategory: 'Краткая категория',
  summary: 'Описание объекта',
  task: 'Задача',
  locationLabel: 'Подпись места',
  workTypes: 'Виды работ',
  scope: 'Объём работ',
  result: 'Результат',
  clientVisibility: 'Упоминание заказчика',
  whatWasDone: 'Что выполнено',
  coverImage: 'Обложка объекта',
  images: 'Дополнительные изображения',
  captions: 'Подписи изображений',
  year: 'Год',
  employmentType: 'Тип занятости',
  salary: 'Оплата',
  responsibilities: 'Обязанности',
  requirements: 'Требования',
  conditions: 'Условия',
  companyName: 'Полное название компании',
  companyShortName: 'Краткое название компании',
  inn: 'ИНН',
  kpp: 'КПП',
  ogrn: 'ОГРН',
  registrationDate: 'Дата регистрации',
  legalAddress: 'Юридический адрес',
  phonePrimary: 'Основной телефон',
  phoneSecondary: 'Дополнительный телефон',
  telegram: 'Ссылка на Telegram',
  telegramLabel: 'Название Telegram',
  email: 'Электронная почта',
  address: 'Фактический адрес',
  regions: 'Регионы работы',
  vacanciesEmptyTitle: 'Заголовок без вакансий',
  vacanciesEmptyText: 'Текст без вакансий',
  heroPrimaryLabel: 'Текст основной кнопки первого экрана',
  heroSecondaryLabel: 'Текст второй кнопки первого экрана',
  pathwaysKicker: 'Надзаголовок сценариев',
  pathwaysTitle: 'Заголовок сценариев',
  pathwayCards: 'Карточки сценариев',
  productsTitle: 'Заголовок продукции',
  productsIntro: 'Описание продукции',
  servicesTitle: 'Заголовок услуг',
  servicesIntro: 'Описание услуг',
  trustTitle: 'Заголовок доверительного блока',
  trustText: 'Текст доверительного блока',
  trustImage: 'Изображение доверительного блока',
  trustCaption: 'Подпись доверительного блока',
  href: 'Ссылка',
  metrika: 'Яндекс Метрика',
  counterId: 'Номер счётчика',
  scriptSrc: 'Адрес скрипта Метрики',
  init: 'Настройки Метрики',
  ssr: 'Отслеживание серверного перехода',
  webvisor: 'Вебвизор',
  clickmap: 'Карта кликов',
  ecommerce: 'Контейнер электронной торговли',
  accurateTrackBounce: 'Точный показатель отказов',
  trackLinks: 'Отслеживание ссылок',
  map: 'Яндекс Карта',
  constructorSrc: 'Адрес конструктора карты',
  height: 'Высота',
  ratingBadge: 'Бейдж рейтинга',
  links: 'Ссылки Яндекса',
  yandexMapsCompanyUrl: 'Страница компании в Яндекс Картах',
  yandexReviewUrl: 'Страница отзыва в Яндексе'
});

const REQUIRED_ROOT_FIELDS = deepFreeze({
  'product-sections': ['title', 'slug', 'shortDescription', 'heroTitle', 'heroDescription', 'order', 'showOnHome', 'isActive', 'mode', 'image', 'placeholderLabel', 'seoTitle', 'seoDescription'],
  'product-categories': ['title', 'slug', 'parentSectionSlug', 'shortDescription', 'heroTitle', 'heroDescription', 'order', 'showInSectionGrid', 'isActive', 'image', 'placeholderLabel', 'mode', 'seoTitle', 'seoDescription'],
  products: ['title', 'slug', 'productCategorySlug', 'shortDescription', 'leadText', 'priceMode', 'priceFrom', 'currency', 'image', 'placeholderLabel', 'order', 'isActive', 'showInCatalog', 'seoTitle', 'seoDescription'],
  services: ['title', 'slug', 'shortDescription', 'heroTitle', 'heroDescription', 'order', 'showOnHome', 'isActive', 'image', 'placeholderLabel', 'seoTitle', 'seoDescription'],
  projects: ['title', 'slug', 'city', 'shortDescription', 'whatWasDone', 'order', 'isActive', 'seoTitle', 'seoDescription'],
  jobs: ['title', 'slug', 'city', 'employmentType', 'salary', 'shortDescription', 'responsibilities', 'requirements', 'conditions', 'order', 'isActive'],
  'site-settings': ['companyName', 'companyShortName', 'inn', 'kpp', 'ogrn', 'registrationDate', 'legalAddress', 'phonePrimary', 'phoneSecondary', 'telegram', 'email', 'city', 'address', 'vacanciesEmptyTitle', 'vacanciesEmptyText'],
  'static-pages': ['title', 'slug', 'seoTitle', 'seoDescription', 'heroTitle'],
  navigation: ['items'],
  yandex: ['metrika', 'map', 'ratingBadge', 'links']
});

const CONDITIONAL_REQUIRED_PATHS = new Set([
  ...IMAGE_VIEW_FIELDS.map((field) => `imageView.${field}`),
  ...IMAGE_VIEW_FIELDS.map((field) => `pageBlocks[].mediaView.${field}`),
  'gallery[].src', 'dimensions[].label', 'dimensions[].value',
  'pageBlocks[].type', 'pageBlocks[].order', 'pageBlocks[].steps[].title', 'pageBlocks[].steps[].order',
  'pathwayCards[].title', 'pathwayCards[].text', 'pathwayCards[].order',
  ...IMAGE_VIEW_FIELDS.map((field) => `pathwayCards[].imageView.${field}`),
  'items[].title', 'items[].href',
  'metrika.counterId', 'metrika.scriptSrc', 'metrika.init',
  'map.constructorSrc', 'map.height', 'ratingBadge.src', 'ratingBadge.width', 'ratingBadge.height',
  'links.yandexMapsCompanyUrl', 'links.yandexReviewUrl'
]);

const LEGACY_PREFIXES_BY_OWNER = deepFreeze({
  'product-sections': [
    'showInMenu', 'menuTitle', 'showBadge', 'heroMediaVideo', 'heroMediaVideoMobile', 'heroMediaPoster',
    'heroMediaPosterMobile', 'heroOverlayOpacity', 'heroTitleStyle', 'heroDescriptionStyle', 'heroLayout',
    'gallery', 'galleryIntro', 'placeholderLabel'
  ],
  'product-categories': ['heroTitleStyle', 'heroDescriptionStyle', 'heroLayout', 'mode', 'placeholderLabel'],
  products: ['sku', 'descriptionTextStyle', 'descriptionLayout'],
  services: [
    'showInMenu', 'menuTitle', 'showBadge', 'heroMediaVideo', 'heroMediaVideoMobile', 'heroMediaPoster',
    'heroMediaPosterMobile', 'heroOverlayOpacity', 'heroTitleStyle', 'heroDescriptionStyle', 'heroLayout',
    'placeholderLabel'
  ],
  projects: ['clientVisibility'],
  jobs: [],
  'site-settings': ['companyShortName'],
  'static-pages': [
    'showInMenu', 'menuTitle', 'heroMediaCaption', 'heroOverlayOpacity', 'heroTitleStyle',
    'heroDescriptionStyle', 'heroLayout', 'imageView', 'placeholderLabel', 'pathwayCards', 'trustImage', 'trustCaption'
  ],
  navigation: [],
  yandex: ['map.height', 'links']
});

const PAGE_BLOCK_LEGACY_PREFIXES = Object.freeze([
  'pageBlocks[].theme', 'pageBlocks[].background', 'pageBlocks[].grid', 'pageBlocks[].columns',
  'pageBlocks[].steps[].text', 'pageBlocks[].media', 'pageBlocks[].image', 'pageBlocks[].video',
  'pageBlocks[].poster', 'pageBlocks[].placeholderLabel', 'pageBlocks[].mediaPosition', 'pageBlocks[].mediaView',
  'pageBlocks[].buttonHref', 'pageBlocks[].textWidth', 'pageBlocks[].textAlign', 'pageBlocks[].titleSize',
  'pageBlocks[].textSize', 'pageBlocks[].textWeight', 'pageBlocks[].textItalic', 'pageBlocks[].textStyle',
  'pageBlocks[].titleStyle', 'pageBlocks[].layout', 'pageBlocks[].paddingTop', 'pageBlocks[].paddingBottom'
]);

const DELIBERATELY_HIDDEN_PATHS = new Set([
  'slug', 'order', 'pageBlocks[].type', 'pageBlocks[].order', 'pageBlocks[].sectionId',
  'pageBlocks[].steps[].order', 'dimensions[].order', 'pathwayCards[].order', 'items[].order'
]);

const PUBLIC_REQUIRED_FIELDS = deepFreeze({
  'product-sections': ['title', 'slug', 'heroTitle', 'heroDescription', 'image'],
  'product-categories': ['title', 'slug', 'parentSectionSlug', 'heroTitle', 'heroDescription', 'image'],
  products: ['title', 'slug', 'productCategorySlug', 'shortDescription', 'leadText', 'image'],
  services: ['title', 'slug', 'heroTitle', 'heroDescription', 'image'],
  projects: ['title', 'slug', 'city', 'shortDescription', 'whatWasDone'],
  jobs: ['title', 'slug', 'city', 'employmentType', 'salary', 'shortDescription'],
  'site-settings': ['companyName', 'phonePrimary', 'telegram', 'email', 'address'],
  'static-pages': ['title', 'slug', 'heroTitle'],
  navigation: ['items[].title', 'items[].href'],
  yandex: ['map.constructorSrc', 'ratingBadge.src']
});

const DEFAULT_TEMPLATES_BY_OWNER = deepFreeze({
  'product-sections': [TEMPLATE_KEYS.DIRECTION_HUB, TEMPLATE_KEYS.SPECIALIZED_DIRECTION],
  'product-categories': [TEMPLATE_KEYS.CATEGORY, TEMPLATE_KEYS.DIRECTION_HUB],
  products: [TEMPLATE_KEYS.STANDARD_PRODUCT, TEMPLATE_KEYS.PREMIUM_PRODUCT],
  services: [TEMPLATE_KEYS.SERVICE_DIRECTION],
  projects: [TEMPLATE_KEYS.HOME, TEMPLATE_KEYS.PROJECT_ARCHIVE, TEMPLATE_KEYS.PROJECT_DETAIL, TEMPLATE_KEYS.SERVICE_DIRECTION],
  jobs: [TEMPLATE_KEYS.JOB_ARCHIVE, TEMPLATE_KEYS.JOB_DETAIL],
  'site-settings': [TEMPLATE_KEYS.GLOBAL_SETTINGS, TEMPLATE_KEYS.HOME, TEMPLATE_KEYS.COMPANY, TEMPLATE_KEYS.CONTACTS, TEMPLATE_KEYS.JOB_DETAIL],
  'static-pages': [TEMPLATE_KEYS.HOME, TEMPLATE_KEYS.COMPANY, TEMPLATE_KEYS.CUSTOM_ORDER, TEMPLATE_KEYS.PROJECT_ARCHIVE],
  navigation: [TEMPLATE_KEYS.NAVIGATION_HEADER],
  yandex: [TEMPLATE_KEYS.YANDEX_INTEGRATIONS, TEMPLATE_KEYS.CONTACTS]
});

const APPROVED_UNTIL_EDITED_FIELDS = deepFreeze({
  'product-sections': ['title', 'heroKicker', 'heroTitle', 'heroDescription', 'image', 'contactTitle', 'contactDescription', 'contactTelegramLabel', 'contactEmailLabel', 'contactPhoneLabel'],
  services: ['title', 'heroKicker', 'heroTitle', 'heroDescription', 'image', 'contactTitle', 'contactDescription', 'contactTelegramLabel', 'contactEmailLabel', 'contactPhoneLabel'],
  'static-pages': ['heroTitle', 'heroDescription', 'heroSecondaryLabel', 'pathwaysKicker', 'pathwaysTitle', 'productsTitle', 'productsIntro', 'servicesTitle', 'servicesIntro', 'trustText', 'contactTitle', 'contactDescription']
});

const CREATE_DEFAULTS = deepFreeze({
  'product-sections': { isActive: false, showOnHome: false },
  'product-categories': { isActive: false, showInSectionGrid: false },
  products: { presentationType: 'standard', priceMode: 'none', priceFrom: null, currency: 'RUB', isActive: false, showInCatalog: false },
  services: { isActive: false, showOnHome: false },
  projects: { isActive: false },
  jobs: { isActive: false },
  'static-pages': { isActive: false },
  navigation: { 'items[].isActive': true, 'items[].order': 'next' }
});

const matchesPrefix = (path, prefix) => (
  path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[]`)
);

const isLegacyPath = (owner, path) => {
  const ownerLegacy = LEGACY_PREFIXES_BY_OWNER[owner] ?? [];
  if (ownerLegacy.some((prefix) => matchesPrefix(path, prefix))) return true;
  if (['product-sections', 'services', 'static-pages'].includes(owner)
    && PAGE_BLOCK_LEGACY_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) return true;
  return false;
};

const labelForPath = (path) => {
  const leaf = path.replaceAll('[]', '').split('.').at(-1);
  return FIELD_LABELS[leaf] ?? `Поле «${leaf}»`;
};

const isMediaPath = (path) => /(?:^|\.)(?:image|coverImage|gallery|images|media|video|poster|heroMediaVideo|heroMediaVideoMobile|heroMediaPoster|heroMediaPosterMobile|trustImage|src)$/u.test(path.replace(/\[\]$/u, ''));

const mediaRoleFor = (owner, path) => {
  if (!isMediaPath(path)) return null;
  if (/heroMediaVideo/u.test(path)) return { role: 'hero-video', ordered: false };
  if (/heroMediaPoster/u.test(path)) return { role: 'hero-poster', ordered: false };
  if (/(?:gallery|images)(?:\[\]|$)/u.test(path)) return { role: owner === 'projects' ? 'project-gallery' : 'gallery', ordered: true };
  if (/coverImage/u.test(path)) return { role: 'cover', ordered: false };
  if (/trustImage/u.test(path)) return { role: 'trust-image', ordered: false };
  if (/video/u.test(path)) return { role: 'video', ordered: false };
  if (/poster/u.test(path)) return { role: 'video-poster', ordered: false };
  return { role: 'primary-image', ordered: false };
};

const relationRoleFor = (owner, path) => {
  if (path === 'parentSectionSlug') return { kind: 'belongs-to', target: 'product-sections', cardinality: 'one' };
  if (path === 'productCategorySlug') return { kind: 'belongs-to', target: 'product-categories', cardinality: 'one' };
  if (path === 'relatedProductSlugs' || path === 'relatedProductSlugs[]') return { kind: 'related-record', target: 'products', cardinality: 'many' };
  if (owner === 'navigation' && path === 'items[].href') return { kind: 'internal-route', target: 'route-registry', cardinality: 'one' };
  if (/buttonHref$/u.test(path)) return { kind: 'internal-or-approved-external-url', target: 'route-registry', cardinality: 'one' };
  if (path === 'slug') return { kind: 'route-key', target: owner, cardinality: 'self' };
  return null;
};

const BOOLEAN_LEAVES = new Set([
  'showOnHome', 'isActive', 'showInMenu', 'showBadge', 'showInSectionGrid', 'showDeliveryBlock',
  'showCustomProjectBlock', 'showInCatalog', 'italic', 'textItalic', 'ssr', 'webvisor', 'clickmap',
  'accurateTrackBounce', 'trackLinks'
]);

const NUMBER_LEAVES = new Set([
  'order', 'positionX', 'positionY', 'scale', 'widthPercent', 'maxWidth', 'columns', 'priceFrom',
  'year', 'counterId', 'height', 'heroOverlayOpacity'
]);

const SELECT_LEAVES = new Set([
  'mode', 'fit', 'fontSize', 'fontWeight', 'align', 'lineHeight', 'color', 'width', 'position',
  'padding', 'verticalPadding', 'theme', 'background', 'grid', 'mediaPosition', 'priceMode',
  'currency', 'presentationType', 'textAlign'
]);

const TEXTAREA_LEAVES = new Set([
  'shortDescription', 'heroDescription', 'description', 'leadText', 'intro', 'text', 'seoDescription',
  'contactDescription', 'deliveryText', 'customProjectText', 'summary', 'task', 'scope', 'result',
  'whatWasDone', 'vacanciesEmptyText', 'productsIntro', 'servicesIntro', 'trustText'
]);

const inferEditorControl = (owner, path, allPaths, coverageStatus) => {
  if (coverageStatus === FIELD_COVERAGE_STATUS.LEGACY_ONLY) return 'advanced-json-read-only';
  if (path === 'pageBlocks') return 'page-block-editor';
  if (path === 'slug') return 'slug-field';
  if (path === 'parentSectionSlug' || path === 'productCategorySlug') return 'relation-select';
  if (path === 'relatedProductSlugs' || path === 'relatedProductSlugs[]') return 'relation-multi-select';
  if (isMediaPath(path)) return /gallery|images/u.test(path) ? 'ordered-media-list' : 'media-picker';
  if (/Href$|Url$|scriptSrc$|constructorSrc$|telegram$/u.test(path)) return 'url-input';
  if (/seoTitle$/u.test(path)) return 'text-input';
  const leaf = path.replaceAll('[]', '').split('.').at(-1);
  if (BOOLEAN_LEAVES.has(leaf)) return 'switch';
  if (NUMBER_LEAVES.has(leaf)) return 'number-input';
  if (SELECT_LEAVES.has(leaf)) return 'select';
  if (TEXTAREA_LEAVES.has(leaf)) return 'textarea';
  if (path.endsWith('[]')) return 'ordered-list';
  if (allPaths.some((candidate) => candidate.startsWith(`${path}.`) || candidate.startsWith(`${path}[].`))) return 'field-group';
  return 'text-input';
};

const templateDefinitionByKey = new Map(
  Object.values(TEMPLATE_FAMILIES).map((definition) => [definition.key, definition])
);

const templatesForField = (owner, path, coverageStatus) => {
  if (coverageStatus === FIELD_COVERAGE_STATUS.LEGACY_ONLY) return [];
  if (owner === 'products' && ['solutionKicker', 'applicationItems', 'applicationItems[]', 'executionVariants', 'executionVariants[]'].includes(path)) {
    return [TEMPLATE_KEYS.PREMIUM_PRODUCT];
  }
  return DEFAULT_TEMPLATES_BY_OWNER[owner] ?? [];
};

const createSemanticsFor = (owner, path, requiredForSave) => {
  const defaults = CREATE_DEFAULTS[owner] ?? {};
  if (Object.hasOwn(defaults, path)) return { mode: 'defaulted', value: defaults[path] };
  if (requiredForSave) return { mode: 'required-input' };
  return { mode: 'omit-when-empty' };
};

const createFieldCoverage = (owner, path, allPaths) => {
  const legacy = isLegacyPath(owner, path);
  const deliberatelyHidden = DELIBERATELY_HIDDEN_PATHS.has(path);
  const coverageStatus = legacy
    ? FIELD_COVERAGE_STATUS.LEGACY_ONLY
    : deliberatelyHidden
      ? FIELD_COVERAGE_STATUS.DELIBERATELY_HIDDEN
      : FIELD_COVERAGE_STATUS.RENDERER_BACKED;
  const isContainer = allPaths.some((candidate) => candidate.startsWith(`${path}.`) || candidate.startsWith(`${path}[].`));
  const editorStatus = legacy
    ? EDITOR_FIELD_STATUS.LEGACY_NOT_RENDERED
    : isContainer
      ? EDITOR_FIELD_STATUS.COMPUTED
      : deliberatelyHidden || owner === 'yandex' || /^(?:seoTitle|seoDescription)$/u.test(path)
        ? EDITOR_FIELD_STATUS.ADVANCED
        : EDITOR_FIELD_STATUS.FRIENDLY;
  const requiredForSave = (REQUIRED_ROOT_FIELDS[owner] ?? []).includes(path);
  const templateFamilies = templatesForField(owner, path, coverageStatus);
  const consumers = freezeArray(templateFamilies.flatMap((template) => templateDefinitionByKey.get(template)?.consumers ?? []));

  return deepFreeze({
    owner,
    schemaPath: path,
    label: labelForPath(path),
    editorControl: inferEditorControl(owner, path, allPaths, coverageStatus),
    editorStatus,
    coverageStatus,
    validation: { source: 'zod-schema', schemaPath: path },
    requiredForSave,
    requiredWhenParentPresent: CONDITIONAL_REQUIRED_PATHS.has(path),
    requiredForPublic: (PUBLIC_REQUIRED_FIELDS[owner] ?? []).includes(path),
    create: createSemanticsFor(owner, path, requiredForSave),
    relationRole: relationRoleFor(owner, path),
    mediaRole: mediaRoleFor(owner, path),
    templateFamilies: freezeArray(templateFamilies),
    consumers,
    publicRouteFamilies: freezeArray(templateFamilies.map((template) => templateDefinitionByKey.get(template)?.routeFamily).filter(Boolean)),
    presentationPolicy: (APPROVED_UNTIL_EDITED_FIELDS[owner] ?? []).includes(path) ? 'approved-until-edited' : 'direct',
    testFixture: owner === 'navigation' || owner === 'yandex' ? `live-singleton:${owner}` : `live-collection:${owner}`,
    ...(deliberatelyHidden && !legacy ? { hiddenReason: 'Техническое поле доступно только в Advanced и не обещает прямой визуальный результат.' } : {}),
    ...(legacy ? { hiddenReason: 'Поле сохраняется без потерь, но текущий production V2 его не выводит.' } : {})
  });
};

const buildOwnerCoverage = (owner, paths, kind) => deepFreeze({
  owner,
  kind,
  fields: Object.fromEntries(paths.map((path) => [path, createFieldCoverage(owner, path, paths)]))
});

export const FIELD_RENDERER_COVERAGE = deepFreeze({
  collections: {
    'product-sections': buildOwnerCoverage('product-sections', PRODUCT_SECTION_PATHS, 'collection'),
    'product-categories': buildOwnerCoverage('product-categories', PRODUCT_CATEGORY_PATHS, 'collection'),
    products: buildOwnerCoverage('products', PRODUCT_PATHS, 'collection'),
    services: buildOwnerCoverage('services', SERVICE_PATHS, 'collection'),
    projects: buildOwnerCoverage('projects', PROJECT_PATHS, 'collection'),
    jobs: buildOwnerCoverage('jobs', JOB_PATHS, 'collection'),
    'site-settings': buildOwnerCoverage('site-settings', SITE_SETTINGS_PATHS, 'collection'),
    'static-pages': buildOwnerCoverage('static-pages', STATIC_PAGE_PATHS, 'collection')
  },
  singletons: {
    navigation: buildOwnerCoverage('navigation', NAVIGATION_PATHS, 'singleton'),
    yandex: buildOwnerCoverage('yandex', YANDEX_PATHS, 'singleton')
  }
});

export const CONTENT_COMPLETENESS_POLICIES = deepFreeze({
  'product-sections': {
    blocksSave: { source: 'contentSchemas', requiredFields: REQUIRED_ROOT_FIELDS['product-sections'] },
    blocksPublic: {
      appliesWhen: { path: 'isActive', equals: true },
      requiredFields: PUBLIC_REQUIRED_FIELDS['product-sections'],
      rules: [{ kind: 'media-path', path: 'image', role: 'hero-or-primary' }]
    },
    recommendations: ['seoTitle', 'seoDescription', 'contactTitle', 'contactDescription']
  },
  'product-categories': {
    blocksSave: { source: 'contentSchemas', requiredFields: REQUIRED_ROOT_FIELDS['product-categories'] },
    blocksPublic: {
      appliesWhen: { all: [{ path: 'isActive', equals: true }, { path: 'showInSectionGrid', equals: true }] },
      requiredFields: PUBLIC_REQUIRED_FIELDS['product-categories'],
      rules: [{ kind: 'relation-exists-and-public', path: 'parentSectionSlug', target: 'product-sections' }]
    },
    recommendations: ['seoTitle', 'seoDescription', 'gallery[].alt', 'gallery[].caption']
  },
  products: {
    blocksSave: { source: 'contentSchemas', requiredFields: REQUIRED_ROOT_FIELDS.products },
    blocksPublic: {
      appliesWhen: { all: [{ path: 'isActive', equals: true }, { path: 'showInCatalog', equals: true }] },
      requiredFields: PUBLIC_REQUIRED_FIELDS.products,
      rules: [{ kind: 'relation-exists-and-public', path: 'productCategorySlug', target: 'product-categories' }]
    },
    recommendations: ['seoTitle', 'seoDescription', 'gallery', 'dimensions', 'features'],
    explicitNonRequirements: ['priceFrom', 'gallery', 'features', 'dimensions', 'seoTitle', 'seoDescription']
  },
  services: {
    blocksSave: { source: 'contentSchemas', requiredFields: REQUIRED_ROOT_FIELDS.services },
    blocksPublic: {
      appliesWhen: { path: 'isActive', equals: true },
      requiredFields: PUBLIC_REQUIRED_FIELDS.services,
      rules: [{ kind: 'media-path', path: 'image', role: 'hero-or-approved-adapter-source' }]
    },
    recommendations: ['seoTitle', 'seoDescription', 'contactTitle', 'contactDescription']
  },
  projects: {
    blocksSave: { source: 'contentSchemas', requiredFields: REQUIRED_ROOT_FIELDS.projects },
    blocksPublic: {
      appliesWhen: { path: 'isActive', equals: true },
      requiredFields: PUBLIC_REQUIRED_FIELDS.projects,
      rules: [{ kind: 'at-least-one-media', paths: ['coverImage', 'image', 'gallery', 'images'], role: 'public-project-media' }]
    },
    recommendations: ['seoTitle', 'seoDescription', 'year', 'gallery[].alt', 'gallery[].caption']
  },
  jobs: {
    blocksSave: { source: 'contentSchemas', requiredFields: REQUIRED_ROOT_FIELDS.jobs },
    blocksPublic: {
      appliesWhen: { path: 'isActive', equals: true },
      requiredFields: PUBLIC_REQUIRED_FIELDS.jobs,
      rules: [
        { kind: 'non-empty-list', path: 'responsibilities' },
        { kind: 'non-empty-list', path: 'requirements' },
        { kind: 'non-empty-list', path: 'conditions' }
      ]
    },
    recommendations: []
  },
  'site-settings': {
    blocksSave: { source: 'contentSchemas', requiredFields: REQUIRED_ROOT_FIELDS['site-settings'] },
    blocksPublic: {
      appliesWhen: { kind: 'always' },
      requiredFields: PUBLIC_REQUIRED_FIELDS['site-settings'],
      rules: [
        { kind: 'contact-url', path: 'telegram' },
        { kind: 'email', path: 'email' },
        { kind: 'phone', path: 'phonePrimary' }
      ]
    },
    recommendations: ['regions', 'telegramLabel']
  },
  'static-pages': {
    blocksSave: { source: 'contentSchemas', requiredFields: REQUIRED_ROOT_FIELDS['static-pages'] },
    blocksPublic: {
      appliesWhen: { path: 'isActive', notEquals: false },
      requiredFields: PUBLIC_REQUIRED_FIELDS['static-pages'],
      byTemplate: {
        [TEMPLATE_KEYS.HOME]: ['heroDescription', 'heroMediaPoster'],
        [TEMPLATE_KEYS.COMPANY]: ['heroDescription'],
        [TEMPLATE_KEYS.CUSTOM_ORDER]: ['heroDescription'],
        [TEMPLATE_KEYS.PROJECT_ARCHIVE]: ['heroDescription']
      }
    },
    recommendations: ['seoTitle', 'seoDescription', 'contactTitle', 'contactDescription']
  },
  navigation: {
    blocksSave: { source: 'singleton-schema', requiredFields: REQUIRED_ROOT_FIELDS.navigation },
    blocksPublic: {
      appliesWhen: { kind: 'always' },
      requiredFields: PUBLIC_REQUIRED_FIELDS.navigation,
      rules: [{ kind: 'active-items-have-existing-routes', path: 'items[].href' }]
    },
    recommendations: []
  },
  yandex: {
    blocksSave: { source: 'singleton-schema', requiredFields: REQUIRED_ROOT_FIELDS.yandex },
    blocksPublic: {
      appliesWhen: { kind: 'always' },
      requiredFields: PUBLIC_REQUIRED_FIELDS.yandex,
      rules: [{ kind: 'trusted-remote-hosts', paths: ['metrika.scriptSrc', 'map.constructorSrc', 'ratingBadge.src'] }]
    },
    recommendations: ['links.yandexMapsCompanyUrl', 'links.yandexReviewUrl']
  }
});

export const KNOWN_PAGE_BLOCK_PASSTHROUGH_FIELDS = freezeArray([
  'secondaryButtonLabel',
  'items[].imageAlt',
  'items[].imageView',
  ...IMAGE_VIEW_FIELDS.map((field) => `items[].imageView.${field}`)
]);

export const KNOWN_PAGE_BLOCK_ITEM_FIELDS = freezeArray([
  'items[]', 'items[].title', 'items[].text', 'items[].question', 'items[].answer',
  'items[].image', 'items[].video', 'items[].poster', 'items[].src', 'items[].url',
  'items[].alt', 'items[].caption', 'items[].placeholderLabel', 'items[].buttonLabel',
  'items[].buttonHref', 'items[].order', 'items[].isActive',
  ...KNOWN_PAGE_BLOCK_PASSTHROUGH_FIELDS.filter((field) => field.startsWith('items[].'))
]);

const PAGE_BLOCK_TEMPLATE_KEYS = Object.freeze([
  TEMPLATE_KEYS.HOME,
  TEMPLATE_KEYS.DIRECTION_HUB,
  TEMPLATE_KEYS.SPECIALIZED_DIRECTION,
  TEMPLATE_KEYS.SERVICE_DIRECTION,
  TEMPLATE_KEYS.COMPANY,
  TEMPLATE_KEYS.CUSTOM_ORDER,
  TEMPLATE_KEYS.PROJECT_ARCHIVE
]);

const GENERIC_PAGE_BLOCK_CONSUMER = 'src/components/PageBlocksRenderer.astro';

const notRenderedSupport = () => ({
  status: PAGE_BLOCK_SUPPORT_STATUS.NOT_RENDERED,
  consumers: [],
  consumedFields: [],
  reason: 'Текущий production V2 template family не читает этот тип секции.'
});

const renderedSupport = ({ consumers, consumedFields, selector = null }) => ({
  status: selector ? PAGE_BLOCK_SUPPORT_STATUS.SELECTOR_CONSTRAINED : PAGE_BLOCK_SUPPORT_STATUS.RENDERED,
  consumers: freezeArray(consumers),
  consumedFields: freezeArray(consumedFields),
  ...(selector ? { selector } : {})
});

const blockPolicy = ({
  label,
  itemPolicy = 'none',
  editorMode = 'friendly',
  supportByTemplate = {},
  creatableFieldsByTemplate = {},
  genericBehavior = 'explicit'
}) => {
  const completeSupport = Object.fromEntries(PAGE_BLOCK_TEMPLATE_KEYS.map((template) => [
    template,
    supportByTemplate[template] ?? notRenderedSupport()
  ]));
  const productionConsumedFields = freezeArray(
    Object.values(completeSupport).flatMap((support) => support.consumedFields)
  );
  const coveredFields = freezeArray([
    ...PAGE_BLOCK_SCHEMA_FIELDS,
    ...KNOWN_PAGE_BLOCK_PASSTHROUGH_FIELDS,
    ...KNOWN_PAGE_BLOCK_ITEM_FIELDS
  ]);
  const fieldCoverage = Object.fromEntries(coveredFields.map((field) => [field, {
    status: productionConsumedFields.includes(field)
      ? FIELD_COVERAGE_STATUS.RENDERER_BACKED
      : FIELD_COVERAGE_STATUS.LEGACY_ONLY,
    editorStatus: productionConsumedFields.includes(field)
      ? (field === 'type' || field === 'order' ? EDITOR_FIELD_STATUS.ADVANCED : EDITOR_FIELD_STATUS.FRIENDLY)
      : EDITOR_FIELD_STATUS.LEGACY_NOT_RENDERED
  }]));
  const creatableIn = Object.keys(creatableFieldsByTemplate);

  return deepFreeze({
    label,
    itemPolicy,
    editorMode,
    primaryCreatable: editorMode === 'friendly' && creatableIn.length > 0,
    creatableIn: freezeArray(creatableIn),
    creatableFieldsByTemplate: Object.fromEntries(
      Object.entries(creatableFieldsByTemplate).map(([template, fields]) => [template, freezeArray(fields)])
    ),
    supportByTemplate: completeSupport,
    fieldCoverage,
    schemaFields: PAGE_BLOCK_SCHEMA_FIELDS,
    knownPassthroughFields: KNOWN_PAGE_BLOCK_PASSTHROUGH_FIELDS,
    knownItemFields: KNOWN_PAGE_BLOCK_ITEM_FIELDS,
    unknownPassthroughPolicy: 'preserve-losslessly-read-only',
    genericLegacyRenderer: {
      consumer: GENERIC_PAGE_BLOCK_CONSUMER,
      mountedOnProductionRoute: false,
      behavior: genericBehavior
    },
    testFixture: 'live-page-block-corpus'
  });
};

const cardFields = Object.freeze([
  'items', 'items[].title', 'items[].text', 'items[].image', 'items[].imageAlt',
  'items[].imageView', ...IMAGE_VIEW_FIELDS.map((field) => `items[].imageView.${field}`),
  'items[].order', 'items[].isActive'
]);
const textListFields = Object.freeze(['items', 'items[]']);
const stepFields = Object.freeze(['steps', 'steps[].title', 'steps[].order', 'steps[].isActive']);

const specializedDirectionConsumer = 'src/components/v2/directions/directionV2Data.ts';
const serviceDirectionConsumer = 'src/components/v2/project/projectDirectionV2Data.ts';

export const PAGE_BLOCK_TEMPLATE_POLICIES = deepFreeze({
  heroSection: blockPolicy({ label: 'Hero-секция' }),
  textBlock: blockPolicy({ label: 'Текстовый блок' }),
  whoWeAre: blockPolicy({
    label: 'Кто мы и что мы делаем',
    supportByTemplate: {
      [TEMPLATE_KEYS.HOME]: renderedSupport({
        consumers: ['src/components/v2/home-v2/homeV2Presentation.ts'],
        consumedFields: ['title', 'text', 'isActive', 'order'],
        selector: {
          kind: 'first-active-block',
          description: 'Первый активный блок по order; тип сейчас не проверяется адаптером.'
        }
      }),
      [TEMPLATE_KEYS.COMPANY]: renderedSupport({
        consumers: ['src/components/v2/practical/V2CompanyPage.astro'],
        consumedFields: ['type', 'title', 'text', 'isActive'],
        selector: { kind: 'first-active-block-of-type' }
      })
    },
    creatableFieldsByTemplate: {
      [TEMPLATE_KEYS.HOME]: ['type', 'title', 'text', 'isActive', 'order'],
      [TEMPLATE_KEYS.COMPANY]: ['type', 'title', 'text', 'isActive', 'order']
    }
  }),
  directionCards: blockPolicy({
    label: 'Карточки направлений / решений',
    itemPolicy: 'cards',
    supportByTemplate: {
      [TEMPLATE_KEYS.COMPANY]: renderedSupport({
        consumers: ['src/components/v2/practical/V2CompanyPage.astro'],
        consumedFields: ['type', 'isActive', 'order', 'items', 'items[].title', 'items[].text', 'items[].order', 'items[].isActive'],
        selector: { kind: 'first-active-block-of-type' }
      })
    },
    creatableFieldsByTemplate: {
      [TEMPLATE_KEYS.COMPANY]: ['type', 'isActive', 'order', 'items', 'items[].title', 'items[].text', 'items[].order', 'items[].isActive']
    }
  }),
  benefits: blockPolicy({ label: 'Преимущества', itemPolicy: 'cards' }),
  process: blockPolicy({
    label: 'Этапы работы',
    itemPolicy: 'steps',
    supportByTemplate: {
      [TEMPLATE_KEYS.SPECIALIZED_DIRECTION]: renderedSupport({
        consumers: ['src/components/v2/pages/MetalworksV2Page.astro', specializedDirectionConsumer],
        consumedFields: ['type', 'intro', 'text', 'isActive', 'order', ...stepFields],
        selector: {
          kind: 'all',
          selectors: [
            { kind: 'record-slug-in', values: ['metallokonstruktsii-dlya-biznesa'] },
            { kind: 'first-active-block-of-type' }
          ],
          description: 'process читается только MetalworksV2Page; navesy/topiarii получают brief из других данных.'
        }
      })
    },
    creatableFieldsByTemplate: {
      [TEMPLATE_KEYS.SPECIALIZED_DIRECTION]: ['type', 'intro', 'text', 'isActive', 'order', ...stepFields]
    }
  }),
  gallery: blockPolicy({ label: 'Галерея', itemPolicy: 'gallery' }),
  cta: blockPolicy({
    label: 'Призыв к действию',
    supportByTemplate: {
      [TEMPLATE_KEYS.COMPANY]: renderedSupport({
        consumers: ['src/components/v2/practical/V2CompanyPage.astro'],
        consumedFields: ['type', 'buttonLabel', 'secondaryButtonLabel', 'isActive'],
        selector: { kind: 'first-active-block-of-type' }
      })
    },
    creatableFieldsByTemplate: {
      [TEMPLATE_KEYS.COMPANY]: ['type', 'buttonLabel', 'secondaryButtonLabel', 'isActive', 'order']
    }
  }),
  faq: blockPolicy({ label: 'Вопросы и ответы', itemPolicy: 'faq' }),
  customOrder: blockPolicy({ label: 'Изготавливаем под объект' }),
  costFactors: blockPolicy({ label: 'Что влияет на стоимость', itemPolicy: 'text-list' }),
  cardGrid: blockPolicy({
    label: 'Карточки',
    itemPolicy: 'cards',
    supportByTemplate: {
      [TEMPLATE_KEYS.SPECIALIZED_DIRECTION]: renderedSupport({
        consumers: [specializedDirectionConsumer, 'src/components/v2/pages/CanopiesV2Page.astro', 'src/components/v2/pages/MetalworksV2Page.astro', 'src/components/v2/pages/TopiaryV2Page.astro'],
        consumedFields: ['type', 'title', 'intro', 'text', 'isActive', 'order', ...cardFields],
        selector: { kind: 'first-active-block-of-type' }
      }),
      [TEMPLATE_KEYS.SERVICE_DIRECTION]: renderedSupport({
        consumers: [serviceDirectionConsumer, 'src/components/v2/pages/LandscapingV2Page.astro', 'src/components/v2/pages/ConstructionV2Page.astro'],
        consumedFields: ['type', 'intro', 'sectionId', 'isActive', 'order', ...cardFields],
        selector: {
          kind: 'preferred-section-suffix-or-first-type',
          suffixes: ['-scope'],
          description: 'Предпочтительно sectionId *-scope; fallback — первый cardGrid.'
        }
      })
    },
    creatableFieldsByTemplate: {
      [TEMPLATE_KEYS.SPECIALIZED_DIRECTION]: ['type', 'title', 'intro', 'text', 'isActive', 'order', ...cardFields],
      [TEMPLATE_KEYS.SERVICE_DIRECTION]: ['type', 'intro', 'sectionId', 'isActive', 'order', ...cardFields]
    }
  }),
  listPanel: blockPolicy({
    label: 'Список',
    itemPolicy: 'text-list',
    supportByTemplate: {
      [TEMPLATE_KEYS.SPECIALIZED_DIRECTION]: renderedSupport({
        consumers: [specializedDirectionConsumer, 'src/components/v2/pages/CanopiesV2Page.astro', 'src/components/v2/pages/MetalworksV2Page.astro', 'src/components/v2/pages/TopiaryV2Page.astro'],
        consumedFields: ['type', 'title', 'intro', 'text', 'isActive', 'order', ...textListFields],
        selector: { kind: 'first-active-block-of-type' }
      }),
      [TEMPLATE_KEYS.SERVICE_DIRECTION]: renderedSupport({
        consumers: [serviceDirectionConsumer, 'src/components/v2/pages/LandscapingV2Page.astro', 'src/components/v2/pages/ConstructionV2Page.astro'],
        consumedFields: ['type', 'intro', 'sectionId', 'isActive', 'order', ...textListFields],
        selector: {
          kind: 'service-list-panel',
          selectedSuffixes: ['-contexts', '-brief'],
          fallbackUnlessSuffix: '-contexts',
          description: 'sectionId выбирает contexts/brief; fallback допустим только для первого listPanel.'
        }
      }),
      [TEMPLATE_KEYS.CUSTOM_ORDER]: renderedSupport({
        consumers: ['src/components/v2/custom-order/customOrderV2Data.ts'],
        consumedFields: ['type', 'title', 'isActive', ...textListFields],
        selector: {
          kind: 'block-field-equals',
          field: 'title',
          value: 'Что можно прислать',
          description: 'Только type=listPanel и точный title «Что можно прислать».'
        }
      })
    },
    creatableFieldsByTemplate: {
      [TEMPLATE_KEYS.SPECIALIZED_DIRECTION]: ['type', 'title', 'intro', 'text', 'isActive', 'order', ...textListFields],
      [TEMPLATE_KEYS.SERVICE_DIRECTION]: ['type', 'intro', 'sectionId', 'isActive', 'order', ...textListFields]
    }
  }),
  mediaText: blockPolicy({
    label: 'Фото и текст',
    supportByTemplate: {
      [TEMPLATE_KEYS.DIRECTION_HUB]: renderedSupport({
        consumers: ['src/components/v2/CatalogSectionV2.astro'],
        consumedFields: ['type', 'title', 'text', 'isActive', 'order'],
        selector: { kind: 'first-active-block-of-type' }
      })
    },
    creatableFieldsByTemplate: {
      [TEMPLATE_KEYS.DIRECTION_HUB]: ['type', 'title', 'text', 'isActive', 'order']
    }
  }),
  notice: blockPolicy({ label: 'Текстовая вставка' }),
  exampleGrid: blockPolicy({ label: 'Примеры', itemPolicy: 'cards', editorMode: 'advanced' }),
  factorList: blockPolicy({ label: 'Факторы', itemPolicy: 'text-list', editorMode: 'advanced' }),
  solutions: blockPolicy({ label: 'Решения', itemPolicy: 'cards', editorMode: 'advanced' }),
  companyProof: blockPolicy({
    label: 'Объекты компании',
    editorMode: 'advanced',
    supportByTemplate: {
      [TEMPLATE_KEYS.COMPANY]: renderedSupport({
        consumers: ['src/components/v2/practical/V2CompanyPage.astro'],
        consumedFields: ['type', 'title', 'text', 'buttonLabel', 'isActive'],
        selector: { kind: 'first-active-block-of-type' }
      })
    }
  }),
  companyDirections: blockPolicy({
    label: 'Направления компании',
    editorMode: 'advanced',
    supportByTemplate: {
      [TEMPLATE_KEYS.COMPANY]: renderedSupport({
        consumers: ['src/components/v2/practical/V2CompanyPage.astro'],
        consumedFields: ['type', 'title', 'intro', 'isActive'],
        selector: { kind: 'first-active-block-of-type' }
      })
    }
  }),
  companyDetails: blockPolicy({
    label: 'Реквизиты компании',
    editorMode: 'advanced',
    supportByTemplate: {
      [TEMPLATE_KEYS.COMPANY]: renderedSupport({
        consumers: ['src/components/v2/practical/V2CompanyPage.astro'],
        consumedFields: ['type', 'title', 'intro', 'isActive'],
        selector: { kind: 'first-active-block-of-type' }
      })
    }
  })
});

export const CREATABLE_PAGE_BLOCK_TYPES = freezeArray(
  Object.entries(PAGE_BLOCK_TEMPLATE_POLICIES)
    .filter(([, policy]) => policy.primaryCreatable)
    .map(([type]) => type)
);

const getOwnerDefinition = (owner) => (
  FIELD_RENDERER_COVERAGE.collections[owner]
  ?? FIELD_RENDERER_COVERAGE.singletons[owner]
  ?? null
);

export function getFieldCoverage(owner, schemaPath) {
  return getOwnerDefinition(owner)?.fields?.[schemaPath] ?? null;
}

export function listCoverageFields(owner) {
  return Object.freeze(Object.values(getOwnerDefinition(owner)?.fields ?? {}));
}

export function getPageBlockTemplatePolicy(type) {
  return typeof type === 'string' ? PAGE_BLOCK_TEMPLATE_POLICIES[type] ?? null : null;
}

const activeBlocksInOrder = (pageBlocks) => (Array.isArray(pageBlocks) ? pageBlocks : [])
  .filter((candidate) => candidate && candidate.isActive !== false)
  .map((candidate, sourceIndex) => ({ candidate, sourceIndex }))
  .sort((left, right) => (
    (left.candidate.order ?? 0) - (right.candidate.order ?? 0)
    || left.sourceIndex - right.sourceIndex
  ))
  .map(({ candidate }) => candidate);

const matchesSupportSelector = ({ selector, type, record, block, pageBlocks }) => {
  if (!selector) return true;
  if (selector.kind === 'all') {
    return selector.selectors.every((child) => matchesSupportSelector({ selector: child, type, record, block, pageBlocks }));
  }
  if (selector.kind === 'any') {
    return selector.selectors.some((child) => matchesSupportSelector({ selector: child, type, record, block, pageBlocks }));
  }
  if (selector.kind === 'record-slug-in') return selector.values.includes(record?.slug);
  if (selector.kind === 'block-field-equals') return block?.[selector.field] === selector.value;

  const active = activeBlocksInOrder(pageBlocks);
  if (selector.kind === 'first-active-block') return active[0] === block;
  if (selector.kind === 'first-active-block-of-type') {
    return active.find((candidate) => candidate.type === type) === block;
  }
  if (selector.kind === 'preferred-section-suffix-or-first-type') {
    const preferred = active.filter((candidate) => (
      candidate.type === type
      && selector.suffixes.some((suffix) => String(candidate.sectionId ?? '').endsWith(suffix))
    ));
    return preferred.length > 0
      ? preferred.includes(block)
      : active.find((candidate) => candidate.type === type) === block;
  }
  if (selector.kind === 'service-list-panel') {
    const sectionId = String(block?.sectionId ?? '');
    if (selector.selectedSuffixes.some((suffix) => sectionId.endsWith(suffix))) return true;
    const hasPreferredFallbackTarget = active.some((candidate) => (
      candidate.type === type
      && String(candidate.sectionId ?? '').endsWith(selector.fallbackUnlessSuffix)
    ));
    return !hasPreferredFallbackTarget && active.find((candidate) => candidate.type === type) === block;
  }
  return false;
};

export function isPageBlockRenderedForTemplate({ type, templateFamily, record = {}, block, pageBlocks = [] }) {
  const policy = getPageBlockTemplatePolicy(type);
  const support = policy?.supportByTemplate?.[templateFamily];
  if (!support || support.status === PAGE_BLOCK_SUPPORT_STATUS.NOT_RENDERED || block?.isActive === false) return false;
  return matchesSupportSelector({ selector: support.selector, type, record, block, pageBlocks });
}

export function getCreatablePageBlockTypes({ templateFamily } = {}) {
  return Object.freeze(CREATABLE_PAGE_BLOCK_TYPES.filter((type) => (
    !templateFamily || PAGE_BLOCK_TEMPLATE_POLICIES[type].creatableIn.includes(templateFamily)
  )));
}

const SPECIALIZED_DIRECTION_SLUGS = new Set([
  'navesy-i-kozyrki',
  'metallokonstruktsii-dlya-biznesa',
  'topiarii'
]);

export function resolvePageBlockTemplateFamily(collection, record = {}) {
  if (collection === 'product-sections') {
    return SPECIALIZED_DIRECTION_SLUGS.has(record.slug)
      ? TEMPLATE_KEYS.SPECIALIZED_DIRECTION
      : TEMPLATE_KEYS.DIRECTION_HUB;
  }
  if (collection === 'services') return TEMPLATE_KEYS.SERVICE_DIRECTION;
  if (collection !== 'static-pages') return null;
  if (record.slug === 'home') return TEMPLATE_KEYS.HOME;
  if (record.slug === 'o-nas') return TEMPLATE_KEYS.COMPANY;
  if (record.slug === 'custom-order') return TEMPLATE_KEYS.CUSTOM_ORDER;
  if (record.slug === 'vypolnennye-obekty') return TEMPLATE_KEYS.PROJECT_ARCHIVE;
  return null;
}

export function getRecordTemplateFamilies(owner, record = {}) {
  if (owner === 'product-sections' || owner === 'services' || owner === 'static-pages') {
    const family = resolvePageBlockTemplateFamily(owner, record);
    return Object.freeze(family ? [family] : []);
  }
  if (owner === 'product-categories') return Object.freeze([TEMPLATE_KEYS.CATEGORY]);
  if (owner === 'products') {
    return Object.freeze([
      record.presentationType === 'premium' ? TEMPLATE_KEYS.PREMIUM_PRODUCT : TEMPLATE_KEYS.STANDARD_PRODUCT
    ]);
  }
  if (owner === 'projects') return Object.freeze([TEMPLATE_KEYS.HOME, TEMPLATE_KEYS.PROJECT_ARCHIVE, TEMPLATE_KEYS.PROJECT_DETAIL, TEMPLATE_KEYS.SERVICE_DIRECTION]);
  if (owner === 'jobs') return Object.freeze([TEMPLATE_KEYS.JOB_ARCHIVE, TEMPLATE_KEYS.JOB_DETAIL]);
  if (owner === 'site-settings') return Object.freeze(DEFAULT_TEMPLATES_BY_OWNER['site-settings']);
  if (owner === 'navigation') return Object.freeze([TEMPLATE_KEYS.NAVIGATION_HEADER]);
  if (owner === 'yandex') return Object.freeze([TEMPLATE_KEYS.YANDEX_INTEGRATIONS, TEMPLATE_KEYS.CONTACTS]);
  return Object.freeze([]);
}

const coverageIssue = (code, details) => Object.freeze({ code, ...details });

/**
 * Compares externally enumerated schema paths with this registry. CI passes the
 * real Zod paths; the admin can also use this for diagnostics without importing
 * Zod into its browser bundle.
 */
export function auditContentCoverage({ schemaPathsByOwner = {}, creatableFieldsByType = {} } = {}) {
  const issues = [];
  const knownOwners = Object.keys(DECLARED_SCHEMA_PATHS);

  for (const owner of knownOwners) {
    const supplied = new Set(schemaPathsByOwner[owner] ?? []);
    const classified = new Set(listCoverageFields(owner).map((field) => field.schemaPath));
    for (const schemaPath of supplied) {
      if (!classified.has(schemaPath)) {
        issues.push(coverageIssue('SCHEMA_FIELD_UNCLASSIFIED', { owner, schemaPath }));
      }
    }
    for (const schemaPath of classified) {
      if (!supplied.has(schemaPath)) {
        issues.push(coverageIssue('COVERAGE_FIELD_NOT_IN_SCHEMA', { owner, schemaPath }));
      }
    }
  }

  for (const owner of Object.keys(schemaPathsByOwner)) {
    if (!knownOwners.includes(owner)) issues.push(coverageIssue('SCHEMA_OWNER_UNCLASSIFIED', { owner }));
  }

  for (const [type, policy] of Object.entries(PAGE_BLOCK_TEMPLATE_POLICIES)) {
    for (const templateFamily of policy.creatableIn) {
      const support = policy.supportByTemplate[templateFamily];
      if (!support || support.status === PAGE_BLOCK_SUPPORT_STATUS.NOT_RENDERED) {
        issues.push(coverageIssue('CREATABLE_TEMPLATE_NOT_RENDERED', { type, templateFamily }));
      }
      for (const field of policy.creatableFieldsByTemplate[templateFamily] ?? []) {
        if (!Object.hasOwn(policy.fieldCoverage, field)) {
          issues.push(coverageIssue('CREATABLE_FIELD_UNCOVERED', { type, templateFamily, field }));
        }
      }
    }
  }

  for (const [type, fields] of Object.entries(creatableFieldsByType)) {
    const policy = PAGE_BLOCK_TEMPLATE_POLICIES[type];
    if (!policy) {
      issues.push(coverageIssue('CREATABLE_BLOCK_UNCLASSIFIED', { type }));
      continue;
    }
    for (const field of fields) {
      if (!Object.hasOwn(policy.fieldCoverage, field)) {
        issues.push(coverageIssue('CREATABLE_FIELD_UNCOVERED', { type, field }));
      }
    }
  }

  return Object.freeze(issues);
}

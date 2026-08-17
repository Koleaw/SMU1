const field = (path, label, kind = 'text', options = {}) => Object.freeze({ path, label, kind, ...options });
const group = (id, title, fields, options = {}) => Object.freeze({ id, title, fields: Object.freeze(fields), ...options });

const text = (path, label, options) => field(path, label, 'text', options);
const area = (path, label, options) => field(path, label, 'textarea', { wide: true, ...options });
const toggle = (path, label, hint = '') => field(path, label, 'boolean', { hint });
const list = (path, label, options) => field(path, label, 'list', { wide: true, ...options });
const media = (path, label, options) => field(path, label, 'media', { wide: true, ...options });
const gallery = (path, label, options) => field(path, label, 'gallery', { wide: true, ...options });

const SEO_FIELDS = [
  text('seoTitle', 'Заголовок для поисковиков', { hint: 'Рекомендация: понятный заголовок до 60–65 символов.' }),
  area('seoDescription', 'Описание для поисковиков', { hint: 'Рекомендация: краткое содержание страницы без перечисления ключевых слов.' })
];

const ADVANCED_COMMON = [
  text('slug', 'Технический адрес (slug)', { advanced: true, hint: 'После первого сохранения адрес заблокирован. Переименование выполняется отдельным действием с проверкой ссылок.' }),
  field('order', 'Порядок', 'number', { advanced: true })
];

export const COLLECTION_LABELS = Object.freeze({
  'static-pages': 'Страница сайта',
  'product-sections': 'Раздел каталога',
  'product-categories': 'Тип изделий',
  products: 'Товар',
  services: 'Услуга',
  projects: 'Выполненный объект',
  jobs: 'Вакансия',
  'site-settings': 'Настройки компании',
  navigation: 'Навигация',
  yandex: 'Интеграции Яндекса'
});

export const VISIBILITY_FIELDS = Object.freeze({
  'static-pages': Object.freeze([{ path: 'isActive', visibleWhen: true, label: 'Страница доступна' }]),
  'product-sections': Object.freeze([
    { path: 'isActive', visibleWhen: true, label: 'Страница доступна' },
    { path: 'showOnHome', visibleWhen: true, label: 'Показывать на главной' }
  ]),
  'product-categories': Object.freeze([
    { path: 'isActive', visibleWhen: true, label: 'Страница доступна' },
    { path: 'showInSectionGrid', visibleWhen: true, label: 'Показывать в разделе' }
  ]),
  products: Object.freeze([
    { path: 'isActive', visibleWhen: true, label: 'Страница доступна' },
    { path: 'showInCatalog', visibleWhen: true, label: 'Показывать в каталоге' }
  ]),
  services: Object.freeze([
    { path: 'isActive', visibleWhen: true, label: 'Страница доступна' },
    { path: 'showOnHome', visibleWhen: true, label: 'Показывать на главной' }
  ]),
  projects: Object.freeze([{ path: 'isActive', visibleWhen: true, label: 'Показывать объект' }]),
  jobs: Object.freeze([{ path: 'isActive', visibleWhen: true, label: 'Показывать вакансию' }]),
  'site-settings': Object.freeze([]),
  navigation: Object.freeze([]),
  yandex: Object.freeze([])
});

export const EDITOR_GROUPS = Object.freeze({
  navigation: Object.freeze([
    group('navigation', 'Навигация и шапка', [field('items', 'Пункты меню', 'navigation-items', { wide: true })])
  ]),

  yandex: Object.freeze([
    group('map', 'Карта на странице контактов', [
      text('map.constructorSrc', 'Ссылка конструктора Яндекс Карт', { required: true, hint: 'Разрешён только адрес api-maps.yandex.ru.' }),
      field('map.height', 'Высота карты, пиксели', 'number', { required: true, min: 1, max: 4096 })
    ]),
    group('rating', 'Рейтинг компании', [
      text('ratingBadge.src', 'Ссылка виджета рейтинга', { required: true, hint: 'Разрешён только адрес yandex.ru.' }),
      field('ratingBadge.width', 'Ширина виджета', 'number', { required: true, min: 1, max: 4096 }),
      field('ratingBadge.height', 'Высота виджета', 'number', { required: true, min: 1, max: 4096 })
    ]),
    group('links', 'Ссылки Яндекса', [
      text('links.yandexMapsCompanyUrl', 'Страница компании в Яндекс Картах', { nullable: true }),
      text('links.yandexReviewUrl', 'Ссылка для отзыва', { nullable: true })
    ]),
    group('metrika', 'Служебные настройки Метрики', [
      field('metrika.counterId', 'Номер счётчика', 'number', { required: true, min: 1, advanced: true }),
      text('metrika.scriptSrc', 'Адрес скрипта', { required: true, advanced: true }),
      toggle('metrika.init.ssr', 'SSR', 'Сохраняется как существующая техническая настройка.'),
      toggle('metrika.init.webvisor', 'Вебвизор'),
      toggle('metrika.init.clickmap', 'Карта кликов'),
      text('metrika.init.ecommerce', 'Имя ecommerce data layer', { advanced: true }),
      toggle('metrika.init.accurateTrackBounce', 'Точный отказ'),
      toggle('metrika.init.trackLinks', 'Отслеживать ссылки')
    ], { advanced: true, collapsible: true })
  ]),

  products: Object.freeze([
    group('main', 'Основное', [
      text('title', 'Название', { required: true, maxLength: 140 }),
      field('productCategorySlug', 'Тип изделий', 'relation-select', { required: true, relationCollection: 'product-categories' }),
      field('presentationType', 'Подача товара', 'select', {
        required: true,
        options: [['standard', 'Обычная карточка'], ['premium', 'Расширенная проектная подача']]
      }),
      area('shortDescription', 'Краткое описание', { required: true, maxLength: 360 }),
      area('leadText', 'Основной вводный текст', { required: true }),
      area('description', 'Подробное описание')
    ]),
    group('visibility', 'Состояние материала', [
      toggle('isActive', 'Страница доступна', 'Включайте после проверки локальной страницы.'),
      toggle('showInCatalog', 'Показывать в каталоге', 'Не влияет на само существование страницы товара.')
    ]),
    group('photos', 'Фотографии', [
      media('image', 'Обложка', { requiredForPublic: true, role: 'cover' }),
      gallery('gallery', 'Галерея', { itemKind: 'string', role: 'gallery' })
    ]),
    group('price', 'Цена', [
      field('priceMode', 'Как показывать цену', 'select', { required: true, options: [['from', 'Цена от'], ['on_request', 'По запросу'], ['none', 'Не показывать']] }),
      field('priceFrom', 'Цена от', 'number', { nullable: true, min: 0 }),
      text('currency', 'Валюта', { required: true, hint: 'Например: ₽.' })
    ]),
    group('details', 'Материалы и характеристики', [
      list('materials', 'Материалы'),
      list('colors', 'Цвета'),
      field('dimensions', 'Размеры и параметры', 'specifications', { wide: true }),
      list('features', 'Особенности'),
      list('applicationItems', 'Где применяется', { premiumOnly: true }),
      list('executionVariants', 'Варианты исполнения', { premiumOnly: true }),
      list('customizationItems', 'Что можно изменить')
    ]),
    group('additional', 'Дополнительные блоки', [
      toggle('showDeliveryBlock', 'Показывать блок доставки'),
      area('deliveryText', 'Текст о доставке'),
      toggle('showCustomProjectBlock', 'Показывать проектный блок'),
      text('customProjectTitle', 'Заголовок проектного блока'),
      area('customProjectText', 'Текст проектного блока'),
      list('relatedProductSlugs', 'Связанные товары', { advanced: true }),
      text('solutionKicker', 'Надзаголовок решения', { advanced: true })
    ], { collapsible: true }),
    group('seo', 'Поиск и адрес', [
      ...SEO_FIELDS,
      ...ADVANCED_COMMON,
      text('sku', 'Артикул', { advanced: true }),
      text('placeholderLabel', 'Подпись, если фото нет', { advanced: true }),
      field('imageView', 'Кадрирование обложки', 'image-view', { advanced: true, wide: true }),
      field('descriptionTextStyle', 'Стиль подробного текста', 'json-readonly', { advanced: true, wide: true, legacy: true }),
      field('descriptionLayout', 'Размещение подробного текста', 'json-readonly', { advanced: true, wide: true, legacy: true })
    ], { advanced: true, collapsible: true })
  ]),

  projects: Object.freeze([
    group('main', 'Основное', [
      text('title', 'Название объекта', { required: true }),
      text('city', 'Город', { required: true }),
      text('region', 'Регион'),
      text('locationLabel', 'Подпись места'),
      field('year', 'Год', 'number', { min: 1900, max: 2200 }),
      text('shortCategory', 'Короткая категория'),
      text('category', 'Категория'),
      area('shortDescription', 'Краткое описание', { required: true }),
      area('summary', 'Итог в двух словах'),
      area('task', 'Задача'),
      area('whatWasDone', 'Что сделано', { required: true }),
      area('scope', 'Состав работ'),
      area('result', 'Результат')
    ]),
    group('visibility', 'Состояние материала', [toggle('isActive', 'Показывать объект', 'Скрытый объект можно сохранить и продолжить заполнять.')]),
    group('photos', 'Обложка и галерея', [
      media('coverImage', 'Обложка', { role: 'cover', hint: 'Выбирается явно и не меняется от первой новой загрузки.' }),
      media('image', 'Совместимое основное фото', { advanced: true, role: 'legacy-cover' }),
      gallery('gallery', 'Галерея', { itemKind: 'project', role: 'gallery' }),
      gallery('images', 'Дополнительная совместимая галерея', { advanced: true, itemKind: 'project', role: 'gallery' })
    ]),
    group('details', 'Подробности', [
      list('workTypes', 'Виды работ'),
      list('materials', 'Материалы'),
      list('features', 'Особенности'),
      list('captions', 'Подписи к фотографиям'),
      text('workType', 'Старое поле вида работ', { advanced: true, legacy: true }),
      text('clientVisibility', 'Служебная отметка клиента', { advanced: true, legacy: true })
    ]),
    group('seo', 'Поиск и адрес', [...SEO_FIELDS, ...ADVANCED_COMMON, text('placeholderLabel', 'Подпись без фото', { advanced: true })], { advanced: true, collapsible: true })
  ]),

  'product-categories': Object.freeze([
    group('main', 'Основное', [
      text('title', 'Название типа изделий', { required: true }),
      field('parentSectionSlug', 'Раздел каталога', 'relation-select', { required: true, relationCollection: 'product-sections' }),
      area('shortDescription', 'Краткое описание', { required: true }),
      text('heroTitle', 'Заголовок первого экрана', { required: true }),
      area('heroDescription', 'Описание первого экрана', { required: true }),
      field('mode', 'Вид списка', 'select', { required: true, options: [['catalog-list', 'Каталог товаров'], ['custom-list', 'Специальная подборка']] })
    ]),
    group('visibility', 'Состояние материала', [
      toggle('isActive', 'Страница доступна'),
      toggle('showInSectionGrid', 'Показывать в разделе')
    ]),
    group('photos', 'Фотографии', [media('image', 'Основное фото', { requiredForPublic: true, role: 'cover' }), gallery('gallery', 'Галерея', { itemKind: 'structured', role: 'gallery' }), area('galleryIntro', 'Введение к галерее')]),
    group('seo', 'Поиск и адрес', [...SEO_FIELDS, ...ADVANCED_COMMON, text('placeholderLabel', 'Подпись без фото', { advanced: true }), field('imageView', 'Кадрирование', 'image-view', { advanced: true, wide: true }), field('heroTitleStyle', 'Стиль заголовка', 'json-readonly', { advanced: true, legacy: true }), field('heroDescriptionStyle', 'Стиль описания', 'json-readonly', { advanced: true, legacy: true }), field('heroLayout', 'Размещение hero', 'json-readonly', { advanced: true, legacy: true })], { advanced: true, collapsible: true })
  ]),

  'product-sections': Object.freeze([
    group('main', 'Основное', [text('title', 'Название раздела', { required: true }), area('shortDescription', 'Краткое описание', { required: true }), text('heroKicker', 'Надзаголовок'), text('heroTitle', 'Заголовок первого экрана', { required: true }), area('heroDescription', 'Описание первого экрана', { required: true }), field('mode', 'Тип страницы', 'select', { options: [['catalog-hub', 'Каталог с типами изделий'], ['custom-direction', 'Специальное направление']] })]),
    group('visibility', 'Состояние материала', [toggle('isActive', 'Страница доступна'), toggle('showOnHome', 'Показывать на главной'), toggle('showInMenu', 'Показывать в меню'), toggle('showBadge', 'Показывать отметку')]),
    group('photos', 'Медиа', [media('image', 'Основное фото', { requiredForPublic: true, role: 'cover' }), gallery('gallery', 'Галерея', { itemKind: 'structured', role: 'gallery' }), area('galleryIntro', 'Введение к галерее'), media('heroMediaPoster', 'Постер первого экрана', { role: 'poster' }), media('heroMediaPosterMobile', 'Мобильный постер', { role: 'poster-mobile' }), media('heroMediaVideo', 'Видео первого экрана', { role: 'video' }), media('heroMediaVideoMobile', 'Мобильное видео', { role: 'video-mobile' })]),
    group('contact', 'Контактный блок', [text('contactTitle', 'Заголовок'), area('contactDescription', 'Описание'), text('contactTelegramLabel', 'Подпись Telegram'), text('contactEmailLabel', 'Подпись email'), text('contactPhoneLabel', 'Подпись телефона')]),
    group('blocks', 'Секции страницы', [field('pageBlocks', 'Секции', 'page-blocks', { wide: true })]),
    group('seo', 'Поиск и адрес', [...SEO_FIELDS, ...ADVANCED_COMMON, text('menuTitle', 'Название в меню', { advanced: true }), text('placeholderLabel', 'Подпись без фото', { advanced: true }), field('imageView', 'Кадрирование', 'image-view', { advanced: true, wide: true }), field('heroOverlayOpacity', 'Затемнение первого экрана', 'number', { advanced: true, min: 0, max: 100 }), field('heroTitleStyle', 'Стиль заголовка', 'json-readonly', { advanced: true, legacy: true }), field('heroDescriptionStyle', 'Стиль описания', 'json-readonly', { advanced: true, legacy: true }), field('heroLayout', 'Размещение hero', 'json-readonly', { advanced: true, legacy: true })], { advanced: true, collapsible: true })
  ]),

  services: Object.freeze([
    group('main', 'Основное', [text('title', 'Название услуги', { required: true }), area('shortDescription', 'Краткое описание', { required: true }), text('heroKicker', 'Надзаголовок'), text('heroTitle', 'Заголовок первого экрана', { required: true }), area('heroDescription', 'Описание первого экрана', { required: true })]),
    group('visibility', 'Состояние материала', [toggle('isActive', 'Страница доступна'), toggle('showOnHome', 'Показывать на главной'), toggle('showInMenu', 'Показывать в меню'), toggle('showBadge', 'Показывать отметку')]),
    group('photos', 'Медиа', [media('image', 'Основное фото', { requiredForPublic: true }), media('heroMediaPoster', 'Постер первого экрана'), media('heroMediaPosterMobile', 'Мобильный постер'), media('heroMediaVideo', 'Видео первого экрана'), media('heroMediaVideoMobile', 'Мобильное видео')]),
    group('contact', 'Контактный блок', [text('contactTitle', 'Заголовок'), area('contactDescription', 'Описание'), text('contactTelegramLabel', 'Подпись Telegram'), text('contactEmailLabel', 'Подпись email'), text('contactPhoneLabel', 'Подпись телефона')]),
    group('blocks', 'Секции страницы', [field('pageBlocks', 'Секции', 'page-blocks', { wide: true })]),
    group('seo', 'Поиск и адрес', [...SEO_FIELDS, ...ADVANCED_COMMON, text('menuTitle', 'Название в меню', { advanced: true }), text('placeholderLabel', 'Подпись без фото', { advanced: true }), field('imageView', 'Кадрирование', 'image-view', { advanced: true, wide: true }), field('heroOverlayOpacity', 'Затемнение', 'number', { advanced: true, min: 0, max: 100 }), field('heroTitleStyle', 'Стиль заголовка', 'json-readonly', { advanced: true, legacy: true }), field('heroDescriptionStyle', 'Стиль описания', 'json-readonly', { advanced: true, legacy: true }), field('heroLayout', 'Размещение hero', 'json-readonly', { advanced: true, legacy: true })], { advanced: true, collapsible: true })
  ]),

  jobs: Object.freeze([
    group('main', 'Вакансия', [text('title', 'Должность', { required: true }), text('city', 'Город', { required: true }), text('employmentType', 'Занятость', { required: true }), text('salary', 'Зарплата', { required: true }), area('shortDescription', 'Краткое описание', { required: true }), list('responsibilities', 'Обязанности'), list('requirements', 'Требования'), list('conditions', 'Условия')]),
    group('visibility', 'Состояние материала', [toggle('isActive', 'Показывать вакансию')]),
    group('advanced', 'Адрес и порядок', ADVANCED_COMMON, { advanced: true, collapsible: true })
  ]),

  'site-settings': Object.freeze([
    group('company', 'Компания', [text('companyName', 'Название компании', { required: true }), text('companyShortName', 'Короткое название', { required: true }), text('inn', 'ИНН', { required: true }), text('kpp', 'КПП', { required: true }), text('ogrn', 'ОГРН', { required: true }), text('registrationDate', 'Дата регистрации', { required: true }), area('legalAddress', 'Юридический адрес', { required: true })]),
    group('contacts', 'Контакты', [text('phonePrimary', 'Основной телефон', { required: true }), text('phoneSecondary', 'Дополнительный телефон', { required: true }), text('telegram', 'Ссылка на Telegram', { required: true }), text('telegramLabel', 'Подпись Telegram'), text('email', 'Email', { required: true }), text('city', 'Город', { required: true }), area('address', 'Адрес', { required: true }), list('regions', 'Регионы работы')]),
    group('jobs', 'Если вакансий нет', [text('vacanciesEmptyTitle', 'Заголовок', { required: true }), area('vacanciesEmptyText', 'Текст', { required: true })])
  ]),

  'static-pages': Object.freeze([
    group('main', 'Первый экран', [text('title', 'Название страницы', { required: true }), text('heroKicker', 'Надзаголовок'), text('heroTitle', 'Заголовок первого экрана', { required: true }), area('heroDescription', 'Описание первого экрана'), text('heroPrimaryLabel', 'Основная кнопка'), text('heroSecondaryLabel', 'Дополнительная кнопка')]),
    group('visibility', 'Состояние материала', [toggle('isActive', 'Страница доступна'), toggle('showInMenu', 'Показывать в меню'), toggle('showBadge', 'Показывать отметку')]),
    group('photos', 'Медиа', [media('image', 'Основное фото'), media('heroMediaPoster', 'Постер первого экрана'), media('heroMediaPosterMobile', 'Мобильный постер'), media('heroMediaVideo', 'Видео первого экрана'), media('heroMediaVideoMobile', 'Мобильное видео'), text('heroMediaCaption', 'Подпись к медиа')]),
    group('home', 'Блоки главной и доверия', [text('pathwaysKicker', 'Надзаголовок направлений'), text('pathwaysTitle', 'Заголовок направлений'), field('pathwayCards', 'Карточки направлений', 'json-readonly', { wide: true, legacy: true }), text('productsTitle', 'Заголовок товаров'), area('productsIntro', 'Введение к товарам'), text('servicesTitle', 'Заголовок услуг'), area('servicesIntro', 'Введение к услугам'), text('trustTitle', 'Заголовок доверительного блока'), area('trustText', 'Текст доверительного блока'), media('trustImage', 'Фото доверительного блока'), text('trustCaption', 'Подпись к фото'), text('contactTitle', 'Заголовок контактов'), area('contactDescription', 'Описание контактов')]),
    group('blocks', 'Секции страницы', [field('pageBlocks', 'Секции', 'page-blocks', { wide: true })]),
    group('seo', 'Поиск и адрес', [...SEO_FIELDS, ...ADVANCED_COMMON, text('menuTitle', 'Название в меню', { advanced: true }), text('placeholderLabel', 'Подпись без фото', { advanced: true }), field('imageView', 'Кадрирование', 'image-view', { advanced: true, wide: true }), field('heroOverlayOpacity', 'Затемнение', 'number', { advanced: true, min: 0, max: 100 }), field('heroTitleStyle', 'Стиль заголовка', 'json-readonly', { advanced: true, legacy: true }), field('heroDescriptionStyle', 'Стиль описания', 'json-readonly', { advanced: true, legacy: true }), field('heroLayout', 'Размещение hero', 'json-readonly', { advanced: true, legacy: true })], { advanced: true, collapsible: true })
  ])
});

export function groupsForCollection(collection) {
  return EDITOR_GROUPS[collection] ?? Object.freeze([]);
}

export function humanPresentationType(value) {
  return value === 'premium' ? 'Расширенная проектная подача' : 'Обычная карточка';
}

export function isVisibleRecord(collection, content = {}) {
  const rules = VISIBILITY_FIELDS[collection] ?? [];
  if (!rules.length) return null;
  // `isActive` owns direct public-route availability. Placement flags such as
  // showInCatalog/showOnHome only control listings and must never make an
  // addressable page look hidden or bypass public completeness checks.
  const routeRule = rules.find((rule) => rule.path === 'isActive') ?? rules[0];
  return content?.[routeRule.path] === routeRule.visibleWhen;
}

export function publicRouteFor(collection, content = {}, relations = {}) {
  const slug = content.slug;
  if (!slug) return '';
  if (collection === 'static-pages') {
    if (slug === 'home') return '/';
    if (slug === 'custom-order') return '/izgotovlenie-na-zakaz/';
    return `/${slug}/`;
  }
  if (collection === 'product-sections' || collection === 'services') return `/${slug}/`;
  if (collection === 'product-categories') return `/${content.parentSectionSlug || relations.sectionSlug || ''}/${slug}/`;
  if (collection === 'products') {
    const category = relations.categories?.get?.(content.productCategorySlug);
    return `/${category?.parentSectionSlug || relations.sectionSlug || ''}/${content.productCategorySlug || ''}/${slug}/`;
  }
  if (collection === 'projects') return `/vypolnennye-obekty/${slug}/`;
  if (collection === 'jobs') return `/vakansii/${slug}/`;
  if (collection === 'navigation') return '/';
  return '';
}

function summaryRecord(summaries, collection, slug) {
  if (!slug || typeof summaries?.get !== 'function') return null;
  return (summaries.get(collection) || []).find((entry) => entry?.slug === slug) || null;
}

/**
 * Whether the ordinary Astro dev build already contains this record's route.
 * Catalog routes exist only when the complete parent chain is active. When we
 * cannot prove that from the current summaries, callers must use the isolated
 * preview builder, which safely enables the record and its parents in a copy.
 */
export function isOrdinaryPublicRouteAvailable(collection, content = {}, relations = {}) {
  if (collection === 'navigation') return true;
  if (collection === 'static-pages') return content.isActive !== false;
  if (content.isActive !== true) return false;

  const summaries = relations.summaries;
  if (collection === 'product-categories') {
    return summaryRecord(summaries, 'product-sections', content.parentSectionSlug)?.isActive === true;
  }
  if (collection === 'products') {
    const category = summaryRecord(summaries, 'product-categories', content.productCategorySlug);
    const sectionSlug = category?.summary?.parentSectionSlug ?? category?.content?.parentSectionSlug;
    return category?.isActive === true
      && summaryRecord(summaries, 'product-sections', sectionSlug)?.isActive === true;
  }
  return true;
}

function slugify(value) {
  const table = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };
  return String(value || '').toLowerCase().split('').map((letter) => table[letter] ?? letter).join('')
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 90) || `draft-${Date.now()}`;
}

export function createDraftDefaults(collection, { title = 'Новая запись', parentSlug = '', order = 10, presentationType = 'standard' } = {}) {
  const slug = slugify(title);
  const defaults = {
    products: {
      title, slug, productCategorySlug: parentSlug, presentationType, shortDescription: '', leadText: '',
      priceMode: 'on_request', priceFrom: null, currency: '₽', image: '', gallery: [],
      placeholderLabel: 'Фото пока не добавлено', order, isActive: false, showInCatalog: false,
      seoTitle: '', seoDescription: ''
    },
    projects: {
      title, slug, city: '', shortDescription: '', whatWasDone: '', gallery: [], order, isActive: false,
      seoTitle: '', seoDescription: ''
    },
    jobs: {
      title, slug, city: '', employmentType: '', salary: '', shortDescription: '', responsibilities: [], requirements: [], conditions: [], order, isActive: false
    },
    'product-categories': {
      title, slug, parentSectionSlug: parentSlug, shortDescription: '', heroTitle: title, heroDescription: '', order,
      showInSectionGrid: false, isActive: false, image: '', placeholderLabel: 'Фото пока не добавлено',
      mode: 'catalog-list', seoTitle: '', seoDescription: ''
    }
  };
  return structuredClone(defaults[collection] ?? null);
}

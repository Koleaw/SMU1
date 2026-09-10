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

const DIRECTION_PRESENTATION_FIELDS = [
  text('directionPresentation.hero.primaryLabel', 'Основная кнопка первого экрана'),
  text('directionPresentation.hero.secondaryLabel', 'Вторая кнопка первого экрана'),
  text('directionPresentation.hero.imageAlt', 'Описание изображения первого экрана'),
  text('directionPresentation.sectionNav.label', 'Название навигации по странице'),
  field('directionPresentation.sectionNav.items', 'Пункты навигации', 'direction-section-nav', { wide: true }),
  text('directionPresentation.types.eyebrow', 'Надзаголовок первого блока'),
  text('directionPresentation.scope.eyebrow', 'Надзаголовок второго блока'),
  text('directionPresentation.brief.eyebrow', 'Надзаголовок исходных данных'),
  text('directionPresentation.brief.title', 'Заголовок исходных данных'),
  area('directionPresentation.brief.description', 'Описание исходных данных'),
  field('directionPresentation.brief.items', 'Что можно прислать', 'ordered-label-list', { wide: true }),
  text('directionPresentation.proof.eyebrow', 'Надзаголовок выполненного объекта'),
  text('directionPresentation.proof.title', 'Заголовок выполненного объекта'),
  area('directionPresentation.proof.description', 'Описание выполненного объекта'),
  text('directionPresentation.proof.linkLabel', 'Ссылка на основной объект'),
  text('directionPresentation.proof.supportingLinkLabel', 'Ссылка на дополнительный объект'),
  text('directionPresentation.related.eyebrow', 'Надзаголовок связанных направлений'),
  text('directionPresentation.related.title', 'Заголовок связанных направлений'),
  field('directionPresentation.related.items', 'Связанные направления и порядок', 'direction-related', { wide: true }),
  text('directionPresentation.contactEyebrow', 'Надзаголовок контакта'),
  text('directionPresentation.contactPhoneChannelLabel', 'Подпись телефона')
];

const PRODUCT_UI_FIELDS = [
  text('productUi.cardPremiumLabel', 'Метка премиальной карточки'),
  text('productUi.cardMaterialsMissingLabel', 'Подпись отсутствующих материалов'),
  text('productUi.cardCtaLabel', 'Ссылка карточки товара'),
  text('productUi.standardHeroPrimaryLabel', 'Обычный товар: основная кнопка'),
  text('productUi.standardHeroSecondaryLabel', 'Обычный товар: вторая кнопка'),
  text('productUi.standardContactEyebrow', 'Обычный товар: надзаголовок контакта'),
  text('productUi.standardContactPrimaryLabel', 'Обычный товар: основная кнопка контакта'),
  text('productUi.standardContactSecondaryLabel', 'Обычный товар: вторая кнопка контакта'),
  text('productUi.standardDefaultCustomTitle', 'Обычный товар: индивидуальный заголовок по умолчанию'),
  text('productUi.standardDefaultRegularTitle', 'Обычный товар: серийный заголовок по умолчанию'),
  area('productUi.standardDefaultDescription', 'Обычный товар: описание по умолчанию'),
  text('productUi.standardPriceLabel', 'Обычный товар: подпись стоимости'),
  text('productUi.standardSectionNavLabel', 'Обычный товар: название навигации'),
  text('productUi.standardNavOverviewLabel', 'Обычный товар: навигация «Обзор»'),
  text('productUi.standardNavDescriptionLabel', 'Обычный товар: навигация «Описание»'),
  text('productUi.standardNavSpecificationsLabel', 'Обычный товар: навигация «Характеристики»'),
  text('productUi.standardNavDeliveryLabel', 'Обычный товар: навигация «Доставка»'),
  text('productUi.standardNavRelatedLabel', 'Обычный товар: навигация связанных изделий'),
  text('productUi.standardNavContactLabel', 'Обычный товар: навигация контакта'),
  text('productUi.standardDescriptionEyebrow', 'Обычный товар: надзаголовок описания'),
  text('productUi.standardDescriptionTitle', 'Обычный товар: заголовок описания'),
  text('productUi.standardSpecificationsEyebrow', 'Обычный товар: надзаголовок характеристик'),
  text('productUi.standardSpecificationsTitle', 'Обычный товар: заголовок характеристик'),
  text('productUi.standardMaterialsEyebrow', 'Обычный товар: надзаголовок материалов'),
  text('productUi.standardMaterialsTitle', 'Обычный товар: заголовок материалов'),
  text('productUi.standardColorsEyebrow', 'Обычный товар: надзаголовок покрытия'),
  text('productUi.standardColorsTitle', 'Обычный товар: заголовок покрытия'),
  text('productUi.standardCustomizationEyebrow', 'Обычный товар: надзаголовок изменений'),
  text('productUi.standardCustomizationTitle', 'Обычный товар: заголовок изменений'),
  text('productUi.standardDeliveryEyebrow', 'Обычный товар: надзаголовок доставки'),
  text('productUi.standardDeliveryTitle', 'Обычный товар: заголовок доставки'),
  text('productUi.standardDeliveryLinkLabel', 'Обычный товар: ссылка доставки'),
  text('productUi.standardRelatedEyebrow', 'Обычный товар: связанные изделия'),
  text('productUi.standardRelatedCategoryTitle', 'Обычный товар: связанные изделия категории'),
  text('productUi.standardRelatedSectionTitle', 'Обычный товар: связанные изделия раздела'),
  text('productUi.standardRelatedLinkLabel', 'Обычный товар: ссылка на категорию'),
  text('productUi.premiumHeroPrimaryLabel', 'Премиальный товар: основная кнопка'),
  text('productUi.premiumHeroSecondaryLabel', 'Премиальный товар: вторая кнопка'),
  text('productUi.premiumContactEyebrow', 'Премиальный товар: надзаголовок контакта'),
  text('productUi.premiumContactPrimaryLabel', 'Премиальный товар: основная кнопка контакта'),
  text('productUi.premiumContactSecondaryLabel', 'Премиальный товар: вторая кнопка контакта'),
  text('productUi.premiumDefaultTitle', 'Премиальный товар: заголовок по умолчанию'),
  area('productUi.premiumDefaultDescription', 'Премиальный товар: описание по умолчанию'),
  text('productUi.premiumDefaultSolutionKicker', 'Премиальный товар: надзаголовок решения по умолчанию'),
  text('productUi.premiumPriceLabel', 'Премиальный товар: подпись расчёта'),
  text('productUi.premiumSectionNavLabel', 'Премиальный товар: название навигации'),
  text('productUi.premiumNavSolutionLabel', 'Премиальный товар: навигация решения'),
  text('productUi.premiumNavApplicationsLabel', 'Премиальный товар: навигация применения'),
  text('productUi.premiumNavGalleryLabel', 'Премиальный товар: навигация галереи'),
  text('productUi.premiumNavAdaptationLabel', 'Премиальный товар: навигация адаптации'),
  text('productUi.premiumNavVariantsLabel', 'Премиальный товар: навигация вариантов'),
  text('productUi.premiumNavTechnicalLabel', 'Премиальный товар: навигация конструктива'),
  text('productUi.premiumNavDeliveryLabel', 'Премиальный товар: навигация доставки'),
  text('productUi.premiumNavRelatedLabel', 'Премиальный товар: навигация связанных решений'),
  text('productUi.premiumNavContactLabel', 'Премиальный товар: навигация контакта'),
  text('productUi.premiumSolutionEyebrow', 'Премиальный товар: надзаголовок решения'),
  text('productUi.premiumApplicationsEyebrow', 'Премиальный товар: надзаголовок применения'),
  text('productUi.premiumApplicationsTitle', 'Премиальный товар: заголовок применения'),
  text('productUi.premiumGalleryEyebrow', 'Премиальный товар: надзаголовок галереи'),
  text('productUi.premiumGalleryTitle', 'Премиальный товар: заголовок галереи'),
  text('productUi.premiumAdaptationEyebrow', 'Премиальный товар: надзаголовок адаптации'),
  text('productUi.premiumAdaptationTitle', 'Премиальный товар: заголовок адаптации'),
  text('productUi.premiumVariantsEyebrow', 'Премиальный товар: надзаголовок вариантов'),
  text('productUi.premiumVariantsTitle', 'Премиальный товар: заголовок вариантов'),
  text('productUi.premiumTechnicalEyebrow', 'Премиальный товар: надзаголовок конструктива'),
  text('productUi.premiumTechnicalTitle', 'Премиальный товар: заголовок конструктива'),
  text('productUi.premiumSpecificationsTitle', 'Премиальный товар: заголовок характеристик'),
  text('productUi.premiumMaterialsTitle', 'Премиальный товар: заголовок материалов'),
  text('productUi.premiumColorsTitle', 'Премиальный товар: заголовок покрытия'),
  text('productUi.premiumDeliveryEyebrow', 'Премиальный товар: надзаголовок доставки'),
  text('productUi.premiumDeliveryTitle', 'Премиальный товар: заголовок доставки'),
  text('productUi.premiumRelatedEyebrow', 'Премиальный товар: надзаголовок связанных решений'),
  text('productUi.premiumRelatedTitle', 'Премиальный товар: заголовок связанных решений'),
  text('productUi.premiumRelatedLinkLabel', 'Премиальный товар: ссылка на категорию')
];

const CATALOG_UI_FIELDS = [
  text('catalogUi.shared.homeBreadcrumbLabel', 'Главная в хлебных крошках каталога'),
  text('catalogUi.shared.phoneChannelLabel', 'Подпись основного телефона'),
  text('catalogUi.shared.telegramChannelLabel', 'Подпись Telegram'),
  text('catalogUi.shared.emailChannelLabel', 'Подпись email'),
  text('catalogUi.card.productCountOne', 'Карточка категории: форма «одно изделие»'),
  text('catalogUi.card.productCountFew', 'Карточка категории: форма «несколько изделий»'),
  text('catalogUi.card.productCountMany', 'Карточка категории: форма «много изделий»'),
  text('catalogUi.card.sparseLabel', 'Карточка категории с примерами'),
  text('catalogUi.card.minimalLabel', 'Карточка категории без медиа'),
  text('catalogUi.card.emptyMediaLabel', 'Карточка категории: отсутствующее медиа'),
  text('catalogUi.card.ctaLabel', 'Карточка категории: ссылка'),
  text('catalogUi.hub.heroKicker', 'Раздел: надзаголовок первого экрана'),
  text('catalogUi.hub.heroPrimaryLabel', 'Раздел: основная кнопка первого экрана'),
  text('catalogUi.hub.heroSecondaryLabel', 'Раздел: вторая кнопка первого экрана'),
  text('catalogUi.hub.categoryCountSuffix', 'Раздел: подпись количества категорий'),
  text('catalogUi.hub.gridEyebrow', 'Раздел: надзаголовок сетки'),
  text('catalogUi.hub.gridTitle', 'Раздел: заголовок сетки'),
  area('catalogUi.hub.gridDescription', 'Раздел: описание сетки'),
  text('catalogUi.hub.emptyTitle', 'Раздел без категорий: заголовок'),
  area('catalogUi.hub.emptyDescription', 'Раздел без категорий: описание'),
  text('catalogUi.hub.customEyebrow', 'Раздел: надзаголовок индивидуального исполнения'),
  text('catalogUi.hub.customDefaultTitle', 'Раздел: заголовок индивидуального исполнения по умолчанию'),
  area('catalogUi.hub.customDefaultDescription', 'Раздел: описание индивидуального исполнения по умолчанию'),
  text('catalogUi.hub.customLinkLabel', 'Раздел: ссылка индивидуального исполнения'),
  text('catalogUi.hub.contactEyebrow', 'Раздел: надзаголовок контакта'),
  text('catalogUi.hub.contactDefaultTitle', 'Раздел: заголовок контакта по умолчанию'),
  area('catalogUi.hub.contactDefaultDescription', 'Раздел: описание контакта по умолчанию'),
  text('catalogUi.hub.contactPrimaryLabel', 'Раздел: основная кнопка контакта'),
  text('catalogUi.hub.contactSecondaryLabel', 'Раздел: вторая кнопка контакта'),
  text('catalogUi.category.heroKicker', 'Категория: надзаголовок первого экрана'),
  text('catalogUi.category.productCountOne', 'Категория: форма «одно изделие»'),
  text('catalogUi.category.productCountFew', 'Категория: форма «несколько изделий»'),
  text('catalogUi.category.productCountMany', 'Категория: форма «много изделий»'),
  text('catalogUi.category.sparseCountLabel', 'Категория без товаров: подпись первого экрана'),
  text('catalogUi.category.heroProductsPrimaryLabel', 'Категория с товарами: основная кнопка'),
  text('catalogUi.category.heroSparsePrimaryLabel', 'Категория без товаров: основная кнопка'),
  text('catalogUi.category.heroProductsSecondaryLabel', 'Категория с товарами: вторая кнопка'),
  text('catalogUi.category.heroSparseSecondaryPrefix', 'Категория без товаров: префикс второй кнопки'),
  text('catalogUi.category.sectionNavLabel', 'Категория: название навигации'),
  text('catalogUi.category.navProductsLabel', 'Навигация: изделия'),
  text('catalogUi.category.navExamplesLabel', 'Навигация: примеры'),
  text('catalogUi.category.navCustomLabel', 'Навигация: по вашей задаче'),
  text('catalogUi.category.navContactLabel', 'Навигация: расчёт'),
  text('catalogUi.category.listEyebrow', 'Категория: надзаголовок списка'),
  text('catalogUi.category.listTitle', 'Категория: заголовок списка'),
  area('catalogUi.category.listDescription', 'Категория: описание списка'),
  text('catalogUi.category.galleryEyebrow', 'Категория: надзаголовок галереи'),
  text('catalogUi.category.galleryTitle', 'Категория: заголовок галереи'),
  text('catalogUi.category.customEyebrow', 'Категория: надзаголовок индивидуального исполнения'),
  text('catalogUi.category.customTitle', 'Категория: заголовок индивидуального исполнения'),
  area('catalogUi.category.customDescription', 'Категория: описание индивидуального исполнения'),
  text('catalogUi.category.customLinkLabel', 'Категория: ссылка индивидуального исполнения'),
  text('catalogUi.category.contactEyebrow', 'Категория: надзаголовок контакта'),
  text('catalogUi.category.contactTitle', 'Категория: заголовок контакта'),
  area('catalogUi.category.contactDefaultDescription', 'Категория: описание контакта по умолчанию'),
  text('catalogUi.category.contactPrimaryLabel', 'Категория: основная кнопка контакта'),
  text('catalogUi.category.contactSecondaryLabel', 'Категория: вторая кнопка контакта'),
  text('catalogUi.sparse.galleryTitle', 'Категория без товаров: заголовок галереи'),
  text('catalogUi.sparse.eyebrow', 'Категория без товаров: надзаголовок'),
  text('catalogUi.sparse.title', 'Категория без товаров: заголовок'),
  area('catalogUi.sparse.summary', 'Категория без товаров: пояснение'),
  text('catalogUi.sparse.materialsLabel', 'Категория без товаров: название списка материалов'),
  field('catalogUi.sparse.materials', 'Категория без товаров: материалы для расчёта', 'json-readonly', { wide: true, advanced: true, hint: 'Пункты и их порядок редактируются непосредственно на странице.' }),
  text('catalogUi.sparse.sectionLinkPrefix', 'Категория без товаров: префикс ссылки на раздел'),
  text('catalogUi.sparse.contactEyebrow', 'Категория без товаров: надзаголовок контакта'),
  text('catalogUi.sparse.contactTitle', 'Категория без товаров: заголовок контакта'),
  area('catalogUi.sparse.contactDefaultDescription', 'Категория без товаров: описание контакта по умолчанию'),
  text('catalogUi.sparse.contactPrimaryLabel', 'Категория без товаров: основная кнопка контакта'),
  text('catalogUi.sparse.contactSecondaryLabel', 'Категория без товаров: вторая кнопка контакта')
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
      field('priceMode', 'Как показывать цену', 'select', { required: true, options: [['from', 'Цена от'], ['exact', 'Точная цена'], ['on_request', 'По запросу'], ['none', 'Не показывать']] }),
      field('priceFrom', 'Значение цены', 'number', { nullable: true, min: 0 }),
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
    group('direction-presentation', 'Подача специального направления', DIRECTION_PRESENTATION_FIELDS, { collapsible: true }),
    group('blocks', 'Секции страницы', [field('pageBlocks', 'Секции', 'page-blocks', { wide: true })]),
    group('seo', 'Поиск и адрес', [...SEO_FIELDS, ...ADVANCED_COMMON, text('menuTitle', 'Название в меню', { advanced: true }), text('placeholderLabel', 'Подпись без фото', { advanced: true }), field('imageView', 'Кадрирование', 'image-view', { advanced: true, wide: true }), field('heroOverlayOpacity', 'Затемнение первого экрана', 'number', { advanced: true, min: 0, max: 100 }), field('heroTitleStyle', 'Стиль заголовка', 'json-readonly', { advanced: true, legacy: true }), field('heroDescriptionStyle', 'Стиль описания', 'json-readonly', { advanced: true, legacy: true }), field('heroLayout', 'Размещение hero', 'json-readonly', { advanced: true, legacy: true })], { advanced: true, collapsible: true })
  ]),

  services: Object.freeze([
    group('main', 'Основное', [text('title', 'Название услуги', { required: true }), area('shortDescription', 'Краткое описание', { required: true }), text('heroKicker', 'Надзаголовок'), text('heroTitle', 'Заголовок первого экрана', { required: true }), area('heroDescription', 'Описание первого экрана', { required: true })]),
    group('visibility', 'Состояние материала', [toggle('isActive', 'Страница доступна'), toggle('showOnHome', 'Показывать на главной'), toggle('showInMenu', 'Показывать в меню'), toggle('showBadge', 'Показывать отметку')]),
    group('photos', 'Медиа', [media('image', 'Основное фото', { requiredForPublic: true }), media('heroMediaPoster', 'Постер первого экрана'), media('heroMediaPosterMobile', 'Мобильный постер'), media('heroMediaVideo', 'Видео первого экрана'), media('heroMediaVideoMobile', 'Мобильное видео')]),
    group('contact', 'Контактный блок', [text('contactTitle', 'Заголовок'), area('contactDescription', 'Описание'), text('contactTelegramLabel', 'Подпись Telegram'), text('contactEmailLabel', 'Подпись email'), text('contactPhoneLabel', 'Подпись телефона')]),
    group('direction-presentation', 'Подача специального направления', DIRECTION_PRESENTATION_FIELDS, { collapsible: true }),
    group('blocks', 'Секции страницы', [field('pageBlocks', 'Секции', 'page-blocks', { wide: true })]),
    group('seo', 'Поиск и адрес', [...SEO_FIELDS, ...ADVANCED_COMMON, text('menuTitle', 'Название в меню', { advanced: true }), text('placeholderLabel', 'Подпись без фото', { advanced: true }), field('imageView', 'Кадрирование', 'image-view', { advanced: true, wide: true }), field('heroOverlayOpacity', 'Затемнение', 'number', { advanced: true, min: 0, max: 100 }), field('heroTitleStyle', 'Стиль заголовка', 'json-readonly', { advanced: true, legacy: true }), field('heroDescriptionStyle', 'Стиль описания', 'json-readonly', { advanced: true, legacy: true }), field('heroLayout', 'Размещение hero', 'json-readonly', { advanced: true, legacy: true })], { advanced: true, collapsible: true })
  ]),

  jobs: Object.freeze([
    group('main', 'Вакансия', [text('title', 'Должность', { required: true }), text('city', 'Город', { required: true }), text('employmentType', 'Занятость', { required: true }), text('salary', 'Зарплата', { required: true }), area('shortDescription', 'Краткое описание', { required: true, hint: 'Можно написать несколько абзацев о работе: переносы строк сохраняются на странице вакансии. Обязанности, требования и условия заполните отдельными списками ниже. HTML не нужен.' }), list('responsibilities', 'Обязанности'), list('requirements', 'Требования'), list('conditions', 'Условия')]),
    group('visibility', 'Состояние материала', [toggle('isActive', 'Показывать вакансию')]),
    group('seo', 'Поиск', SEO_FIELDS),
    group('advanced', 'Адрес и порядок', ADVANCED_COMMON, { advanced: true, collapsible: true })
  ]),

  'site-settings': Object.freeze([
    group('company', 'Компания', [text('companyName', 'Название компании', { required: true }), text('companyShortName', 'Короткое название', { required: true }), text('inn', 'ИНН', { required: true }), text('kpp', 'КПП', { required: true }), text('ogrn', 'ОГРН', { required: true }), text('registrationDate', 'Дата регистрации', { required: true }), area('legalAddress', 'Юридический адрес', { required: true })]),
    group('contacts', 'Контакты', [text('phonePrimary', 'Основной телефон', { required: true }), text('phoneSecondary', 'Дополнительный телефон', { required: true }), text('telegram', 'Ссылка на Telegram', { required: true }), text('telegramLabel', 'Подпись Telegram'), text('email', 'Email', { required: true }), text('city', 'Город', { required: true }), area('address', 'Адрес', { required: true }), list('regions', 'Регионы работы')]),
    group('shell', 'Шапка и подвал', [
      text('shellLabels.productsGroup', 'Группа продукции'), text('shellLabels.productsMenuEyebrow', 'Подпись меню продукции'),
      text('shellLabels.companyMenu', 'Меню компании'), text('shellLabels.workAndCompanyGroup', 'Группа работы и компании'),
      text('shellLabels.directionsGroup', 'Группа направлений'), text('shellLabels.directContactGroup', 'Группа прямой связи'),
      text('shellLabels.secondaryPhoneSuffix', 'Подпись дополнительного телефона'), text('shellLabels.telegramSuffix', 'Подпись Telegram'),
      text('shellLabels.defaultCtaLabel', 'Основная CTA-подпись сайта'), text('shellLabels.catalogRequestCtaLabel', 'CTA-подпись каталога'),
      area('footerDisclaimer', 'Юридическое примечание'), text('copyrightLabel', 'Авторские права'), media('brandLogo', 'Логотип')
    ]),
    group('catalog-pages', 'Разделы и категории каталога', CATALOG_UI_FIELDS, { collapsible: true }),
    group('product-pages', 'Товарные страницы', PRODUCT_UI_FIELDS, { collapsible: true }),
    group('contacts-page', 'Страница контактов', [
      text('contactsPage.homeBreadcrumbLabel', 'Главная в хлебных крошках'), text('contactsPage.breadcrumbLabel', 'Текущая страница в хлебных крошках'),
      text('contactsPage.eyebrow', 'Надзаголовок'), text('contactsPage.title', 'Заголовок'), area('contactsPage.description', 'Описание'),
      text('contactsPage.primaryPhoneLabel', 'Основной телефон — подпись'), text('contactsPage.secondaryPhoneLabel', 'Дополнительный телефон — подпись'),
      text('contactsPage.telegramCardLabel', 'Telegram — подпись'), text('contactsPage.emailCardLabel', 'Email — подпись'),
      text('contactsPage.addressEyebrow', 'Надзаголовок адреса'), area('contactsPage.addressDescription', 'Описание адреса'),
      text('contactsPage.regionsLabel', 'Подпись географии'), text('contactsPage.ratingTitle', 'Название рейтинга'),
      text('contactsPage.mapLinkLabel', 'Текст ссылки на карту'), text('contactsPage.requisitesEyebrow', 'Надзаголовок реквизитов'),
      text('contactsPage.innLabel', 'Подпись ИНН'), text('contactsPage.kppLabel', 'Подпись КПП'), text('contactsPage.ogrnLabel', 'Подпись ОГРН'),
      text('contactsPage.aboutLabel', 'Ссылка на компанию'), text('contactsPage.vacanciesLabel', 'Ссылка на вакансии'),
      text('contactsPage.briefEyebrow', 'Надзаголовок исходных материалов'), text('contactsPage.briefTitle', 'Заголовок исходных материалов'),
      area('contactsPage.briefDescription', 'Описание исходных материалов'), text('contactsPage.ctaEyebrow', 'Надзаголовок CTA'),
      text('contactsPage.ctaTitle', 'Заголовок CTA'), text('contactsPage.primaryLabel', 'Основная кнопка'), text('contactsPage.secondaryLabel', 'Вторая кнопка')
      ,text('contactsPage.shellCtaLabel', 'CTA в шапке'), text('contactsPage.seoTitle', 'SEO-заголовок'), area('contactsPage.seoDescription', 'SEO-описание')
    ]),
    group('company-page', 'Подписи страницы компании', [
      text('companyPage.homeBreadcrumbLabel', 'Главная в хлебных крошках'), text('companyPage.breadcrumbLabel', 'Текущая страница в хлебных крошках'),
      text('companyPage.companyLabel', 'Подпись компании'), text('companyPage.cityLabel', 'Подпись города'),
      text('companyPage.registrationLabel', 'Подпись регистрации'), text('companyPage.regionsLabel', 'Подпись географии'),
      text('companyPage.contactsLabel', 'Ссылка на контакты'), text('companyPage.privacyLabel', 'Ссылка на политику'),
      text('companyPage.innLabel', 'Подпись ИНН'), text('companyPage.kppLabel', 'Подпись КПП'),
      text('companyPage.ogrnLabel', 'Подпись ОГРН'), text('companyPage.registrationDateLabel', 'Подпись даты регистрации'),
      text('companyPage.legalAddressLabel', 'Подпись юридического адреса'), text('companyPage.contactAddressLabel', 'Подпись контактного адреса')
    ], { collapsible: true }),
    group('project-pages', 'Выполненные объекты', [
      text('projectUi.homeBreadcrumbLabel', 'Главная в хлебных крошках'), text('projectUi.archiveBreadcrumbLabel', 'Архив в хлебных крошках'),
      text('projectUi.archiveCardCtaLabel', 'Ссылка карточки в архиве'), text('projectUi.detailDefaultEyebrow', 'Надзаголовок по умолчанию'),
      text('projectUi.detailArchiveBackLabel', 'Ссылка назад к архиву'), text('projectUi.detailSectionNavLabel', 'Название навигации'),
      text('projectUi.detailNavOverviewLabel', 'Навигация: обзор'), text('projectUi.detailNavWorkLabel', 'Навигация: работы'),
      text('projectUi.detailNavFactsLabel', 'Навигация: сведения'), text('projectUi.detailNavGalleryLabel', 'Навигация: фотографии'),
      text('projectUi.detailNavDirectionsLabel', 'Навигация: направления'), text('projectUi.detailNavContactLabel', 'Навигация: контакт'),
      text('projectUi.detailWorkTitle', 'Заголовок выполненных работ'), text('projectUi.detailFactsEyebrow', 'Надзаголовок сведений'),
      text('projectUi.detailFactsTitle', 'Заголовок сведений'), text('projectUi.detailFactSummaryLabel', 'Подпись описания'),
      text('projectUi.detailFactTaskLabel', 'Подпись задачи'), text('projectUi.detailFactWorkTypesLabel', 'Подпись видов работ'),
      text('projectUi.detailFactScopeLabel', 'Подпись объёма работ'), text('projectUi.detailFactMaterialsLabel', 'Подпись материалов'),
      text('projectUi.detailFactFeaturesLabel', 'Подпись особенностей'), text('projectUi.detailGalleryEyebrow', 'Надзаголовок галереи'),
      text('projectUi.detailGalleryTitle', 'Заголовок галереи'), text('projectUi.detailDirectionsEyebrow', 'Надзаголовок направлений'),
      text('projectUi.detailDirectionsTitle', 'Заголовок направлений'), text('projectUi.detailPreviousLabel', 'Предыдущий объект'),
      text('projectUi.detailNextLabel', 'Следующий объект'), text('projectUi.detailContactEyebrow', 'Надзаголовок контакта'),
      text('projectUi.detailContactTitle', 'Заголовок контакта'), area('projectUi.detailContactDescription', 'Описание контакта'),
      text('projectUi.detailContactPrimaryLabel', 'Основная кнопка контакта'), text('projectUi.detailContactSecondaryLabel', 'Вторая кнопка контакта')
    ], { collapsible: true }),
    group('not-found-page', 'Страница 404', [
      text('notFoundPage.eyebrow', 'Надзаголовок'), text('notFoundPage.title', 'Заголовок'), area('notFoundPage.description', 'Описание'),
      text('notFoundPage.primaryLabel', 'Основная recovery-кнопка'), text('notFoundPage.primaryHref', 'Ссылка основной кнопки', { hint: 'Только внутренний путь от корня сайта.' }),
      text('notFoundPage.secondaryLabel', 'Дополнительная recovery-кнопка'), text('notFoundPage.secondaryHref', 'Ссылка дополнительной кнопки', { hint: 'Только внутренний путь от корня сайта.' }),
      text('notFoundPage.ctaEyebrow', 'Надзаголовок контакта'), text('notFoundPage.ctaTitle', 'Заголовок контакта'),
      text('notFoundPage.phoneLabel', 'Подпись телефона'), text('notFoundPage.telegramLabel', 'Подпись Telegram'), text('notFoundPage.emailLabel', 'Подпись email'),
      text('notFoundPage.shellCtaLabel', 'CTA в шапке и мобильном подвале'), text('notFoundPage.seoTitle', 'SEO-заголовок'), area('notFoundPage.seoDescription', 'SEO-описание')
    ], { collapsible: true }),
    group('jobs', 'Вакансии', [
      text('vacanciesEmptyTitle', 'Заголовок без вакансий', { required: true }), area('vacanciesEmptyText', 'Текст без вакансий', { required: true }),
      text('vacanciesPage.homeBreadcrumbLabel', 'Архив: главная в хлебных крошках'), text('vacanciesPage.breadcrumbLabel', 'Архив: текущая страница в хлебных крошках'),
      text('vacanciesPage.eyebrow', 'Надзаголовок архива'), text('vacanciesPage.title', 'Заголовок архива'), area('vacanciesPage.description', 'Описание архива'),
      text('vacanciesPage.cityLabel', 'Архив: подпись города'), text('vacanciesPage.employmentTypeLabel', 'Архив: подпись занятости'),
      text('vacanciesPage.salaryLabel', 'Архив: подпись оплаты'), text('vacanciesPage.openPositionLabel', 'Надзаголовок карточки вакансии'),
      text('vacanciesPage.emptyEyebrow', 'Надзаголовок пустого состояния'), text('vacanciesPage.primaryLabel', 'Кнопка вакансии'),
      text('vacanciesPage.relatedEyebrow', 'Архив: надзаголовок связанных страниц'), text('vacanciesPage.relatedCompanyLabel', 'Архив: ссылка на компанию'),
      text('vacanciesPage.relatedContactsLabel', 'Архив: ссылка на контакты'), text('vacanciesPage.shellCtaLabel', 'CTA архива в шапке'),
      text('vacanciesPage.seoTitle', 'SEO-заголовок архива'), area('vacanciesPage.seoDescription', 'SEO-описание архива'),
      text('vacancyDetailPage.homeBreadcrumbLabel', 'Вакансия: главная в хлебных крошках'), text('vacancyDetailPage.archiveBreadcrumbLabel', 'Вакансия: архив в хлебных крошках'),
      text('vacancyDetailPage.responsibilitiesLabel', 'Заголовок обязанностей'), text('vacancyDetailPage.requirementsLabel', 'Заголовок требований'),
      text('vacancyDetailPage.conditionsLabel', 'Заголовок условий'), text('vacancyDetailPage.cityLabel', 'Вакансия: подпись города'),
      text('vacancyDetailPage.employmentTypeLabel', 'Вакансия: подпись занятости'), text('vacancyDetailPage.salaryLabel', 'Вакансия: подпись оплаты'),
      text('vacancyDetailPage.emailChannelLabel', 'Подпись email'), text('vacancyDetailPage.phoneChannelLabel', 'Подпись телефона'),
      text('vacancyDetailPage.telegramChannelLabel', 'Подпись Telegram'), text('vacancyDetailPage.relatedEyebrow', 'Вакансия: надзаголовок связанных страниц'),
      text('vacancyDetailPage.relatedCompanyLabel', 'Вакансия: ссылка на компанию'), text('vacancyDetailPage.relatedContactsLabel', 'Вакансия: ссылка на контакты'),
      text('vacancyDetailPage.eyebrow', 'Надзаголовок вакансии'), text('vacancyDetailPage.ctaEyebrow', 'Надзаголовок отклика'),
      text('vacancyDetailPage.ctaTitle', 'Заголовок отклика'), text('vacancyDetailPage.primaryLabel', 'Ссылка на все вакансии'),
      text('vacancyDetailPage.shellCtaLabel', 'CTA вакансии в шапке')
    ], { collapsible: true }),
    group('privacy-policy', 'Политика конфиденциальности', [
      text('privacyPolicy.homeBreadcrumbLabel', 'Главная в хлебных крошках'), text('privacyPolicy.shellCtaLabel', 'CTA в шапке'),
      text('privacyPolicy.title', 'Название документа'), text('privacyPolicy.documentLabel', 'Подпись документа'),
      area('privacyPolicy.documentDescription', 'Описание документа'), text('privacyPolicy.revisionDate', 'Дата редакции'),
      text('privacyPolicy.operatorHeading', 'Заголовок оператора'), text('privacyPolicy.operatorFullName', 'Полное имя оператора'),
      field('privacyPolicy.sections', 'Структура документа', 'json-readonly', { wide: true, hint: 'Разделы, абзацы и списки редактируются структурированным legal-инструментом на странице.' })
    ], { collapsible: true }),
    group('cookies', 'Cookie и конфиденциальность', [area('cookieNotice.message', 'Текст уведомления'), text('cookieNotice.privacyLabel', 'Ссылка на политику'), text('cookieNotice.acceptLabel', 'Кнопка согласия'), text('cookieNotice.settingsLabel', 'Настройки cookie'), text('cookieNotice.dialogTitle', 'Заголовок окна'), area('cookieNotice.dialogDescription', 'Описание окна'), text('cookieNotice.closeLabel', 'Кнопка закрытия')], { collapsible: true })
  ]),

  'static-pages': Object.freeze([
    group('main', 'Первый экран', [text('title', 'Название страницы', { required: true }), text('heroKicker', 'Надзаголовок'), text('heroTitle', 'Заголовок первого экрана', { required: true }), area('heroDescription', 'Описание первого экрана'), text('heroPrimaryLabel', 'Основная кнопка'), text('heroPrimaryHref', 'Ссылка основной кнопки'), text('heroSecondaryLabel', 'Дополнительная кнопка'), text('heroSecondaryHref', 'Ссылка дополнительной кнопки'), text('shellCtaLabel', 'CTA страницы в шапке')]),
    group('visibility', 'Состояние материала', [toggle('isActive', 'Страница доступна'), toggle('showInMenu', 'Показывать в меню'), toggle('showBadge', 'Показывать отметку')]),
    group('photos', 'Медиа', [media('image', 'Основное фото'), media('heroMediaPoster', 'Постер первого экрана'), media('heroMediaPosterMobile', 'Мобильный постер'), media('heroMediaVideo', 'Видео первого экрана'), media('heroMediaVideoMobile', 'Мобильное видео'), text('heroMediaCaption', 'Подпись к медиа')]),
    group('home', 'Блоки главной и доверия', [text('pathwaysKicker', 'Надзаголовок направлений'), text('pathwaysTitle', 'Заголовок направлений'), field('pathwayCards', 'Карточки направлений', 'json-readonly', { wide: true, legacy: true }), text('productsTitle', 'Заголовок товаров'), area('productsIntro', 'Введение к товарам'), text('servicesTitle', 'Заголовок услуг'), area('servicesIntro', 'Введение к услугам'), text('trustTitle', 'Заголовок доверительного блока'), area('trustText', 'Текст доверительного блока'), media('trustImage', 'Фото доверительного блока'), text('trustCaption', 'Подпись к фото'), text('contactTitle', 'Заголовок контактов'), area('contactDescription', 'Описание контактов'), text('contactSecondaryHref', 'Ссылка второй контактной кнопки'), text('contactPhonePrimaryLabel', 'Подпись основного телефона'), text('contactPhoneSecondaryLabel', 'Подпись дополнительного телефона'), text('contactTelegramLabel', 'Подпись Telegram'), text('contactEmailLabel', 'Подпись электронной почты'), text('contactAddressLabel', 'Подпись адреса'), text('contactRegionsLabel', 'Подпись географии')]),
    group('gateway-projects', 'Проекты в доверительном gateway', [
      field('gatewayProjectSlugs', 'Объекты и их порядок', 'relation-list', { relationCollections: ['projects'], wide: true })
    ], { appliesToSlugs: ['home', 'o-nas'], collapsible: true }),
    group('company-presentation', 'Медиа первого экрана компании', [
      field('companyHeroProjectSlug', 'Объект-источник фото', 'relation-select', { relationCollection: 'projects', wide: true }),
      field('companyHeroPosition', 'Кадрирование фото', 'focal-position', { wide: true })
    ], { appliesToSlugs: ['o-nas'], collapsible: true }),
    group('custom-order-presentation', 'Подача «Изготовления на заказ»', [
      field('customOrderHeroProjectSlug', 'Объект-источник hero', 'relation-select', { relationCollection: 'projects', wide: true }),
      field('customOrderHeroPosition', 'Кадрирование hero на desktop', 'focal-position', { wide: true }),
      field('customOrderHeroMobilePosition', 'Кадрирование hero на mobile', 'focal-position', { wide: true }),
      field('relatedDirectionSlugs', 'Связанные направления и порядок', 'relation-list', { relationCollections: ['product-sections', 'services'], wide: true })
    ], { appliesToSlugs: ['custom-order'], collapsible: true }),
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

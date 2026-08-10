type HomeV2Source = {
  heroKicker: string;
  heroTitle: string;
  heroDescription: string;
  heroPrimaryLabel: string;
  heroSecondaryLabel: string;
  pathwaysKicker: string;
  pathwaysTitle: string;
  productsTitle: string;
  productsIntro: string;
  servicesTitle: string;
  servicesIntro: string;
  trustTitle: string;
  trustText: string;
  contactTitle: string;
  contactDescription: string;
  pageBlocks: Array<{
    title?: string;
    text?: string;
    isActive?: boolean;
    order?: number;
  }>;
};

const approvedUntilEdited = (current: string, legacy: string, approved: string) =>
  current.trim() === legacy ? approved : current.trim();

const legacy = {
  heroTitle: 'Закрываем объект комплексно: от изделий и металлоконструкций до строительства и благоустройства',
  heroDescription: 'Работаем с коммерческими и общественными площадками: считаем задачу, подбираем формат работ, изготавливаем в цехе и сопровождаем реализацию на объекте.',
  heroSecondaryLabel: 'Наши объекты',
  pathwaysKicker: 'Структура работы',
  pathwaysTitle: 'Три понятных сценария для разных задач объекта',
  aboutTitle: 'Кто мы и что мы делаем',
  aboutText: 'СМУ-1 выполняет комплексные работы для коммерческих и общественных объектов: изготавливает изделия, металлоконструкции и элементы благоустройства, подбирает решения под задачу и сопровождает реализацию на объекте.',
  productsTitle: 'Продукция',
  productsIntro: 'Здесь собраны продуктовые направления компании для задач общественных, коммерческих и городских территорий.',
  servicesTitle: 'Услуги',
  servicesIntro: 'Сервисные направления для работ под задачу объекта: от подготовки решения до реализации на площадке.',
  trustText: 'Показываем не рендеры, а реальные площадки: задачу, объем работ, комплектацию и итог на объекте.',
  contactTitle: 'Не нашли, что искали?',
  contactDescription: 'Готовы выполнить решение под ваш объект, ТЗ, референс или чертеж. Напишите нам напрямую, и мы сориентируем по реализации.'
} as const;

export const getHomeV2Presentation = (source: HomeV2Source) => {
  const about = source.pageBlocks
    .filter((item) => item.isActive !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  const aboutIsLegacy = about?.title?.trim() === legacy.aboutTitle && about?.text?.trim() === legacy.aboutText;
  const directionsAreLegacy = source.productsTitle.trim() === legacy.productsTitle
    && source.productsIntro.trim() === legacy.productsIntro
    && source.servicesTitle.trim() === legacy.servicesTitle
    && source.servicesIntro.trim() === legacy.servicesIntro;

  return {
    heroKicker: source.heroKicker.trim(),
    heroTitle: approvedUntilEdited(source.heroTitle, legacy.heroTitle, 'Изделия, конструкции и комплексные работы на объекте'),
    heroDescription: approvedUntilEdited(
      source.heroDescription,
      legacy.heroDescription,
      'Изготавливаем изделия и конструкции, выполняем металлоконструкции, строительно-монтажные работы и комплексное благоустройство.'
    ),
    heroPrimaryLabel: source.heroPrimaryLabel.trim(),
    heroSecondaryLabel: approvedUntilEdited(source.heroSecondaryLabel, legacy.heroSecondaryLabel, 'Смотреть объекты'),
    positioningKicker: approvedUntilEdited(source.pathwaysKicker, legacy.pathwaysKicker, 'СМУ-1 в одной фразе'),
    positioningTitle: approvedUntilEdited(
      source.pathwaysTitle,
      legacy.pathwaysTitle,
      'Работаем с изделием, конструкцией и объектом целиком.'
    ),
    positioningSummary: aboutIsLegacy
      ? 'Доступны каталожные решения и работа по фото, размерам, эскизу, чертежу или ТЗ. Масштаб задач включает уличную мебель, металлоконструкции, благоустройство и строительство.'
      : [about?.title?.trim(), about?.text?.trim()].filter(Boolean).join('. '),
    directionsEyebrow: directionsAreLegacy
      ? 'Семь компетенций'
      : [source.productsTitle.trim(), source.servicesTitle.trim()].filter(Boolean).join(' · '),
    directionsDescription: directionsAreLegacy
      ? 'Каждое направление ведёт в существующий раздел с описанием работ, вариантами изделий или вводными для расчёта.'
      : [
          `${source.productsTitle.trim()}. ${source.productsIntro.trim()}`,
          `${source.servicesTitle.trim()}. ${source.servicesIntro.trim()}`
        ].join(' '),
    projectsEyebrow: source.trustTitle.trim(),
    projectsDescription: approvedUntilEdited(
      source.trustText,
      legacy.trustText,
      'Реальные работы СМУ-1 на общественных, коммерческих и производственных площадках собраны в отдельном разделе.'
    ),
    contactTitle: approvedUntilEdited(source.contactTitle, legacy.contactTitle, 'Обсудим ваш объект или конструкцию'),
    contactDescription: approvedUntilEdited(
      source.contactDescription,
      legacy.contactDescription,
      'Свяжемся, уточним задачу и подготовим расчёт.'
    )
  };
};

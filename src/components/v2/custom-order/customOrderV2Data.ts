import { getCollection, type CollectionEntry } from 'astro:content';
import { loadCatalogV2Snapshot } from '../catalogV2Data';
import { getV2ProjectPresentation } from '../mediaRoleAdapter';
import { loadV2Directions, type V2DirectionSlug } from '../../../utils/v2Directions';

type ProjectData = CollectionEntry<'projects'>['data'];
type StaticPageData = CollectionEntry<'static-pages'>['data'];

export interface CustomOrderDirection {
  title: string;
  href: string;
}

export interface CustomOrderMedia {
  src: string;
  alt: string;
  fit: 'cover' | 'contain';
  position: string;
  mobilePosition: string;
}

export interface CustomOrderChangeTheme {
  title: string;
  items: string[];
}

export interface CustomOrderV2Data {
  sourcePage: StaticPageData;
  copy: {
    heroKicker: string;
    heroTitle: string;
    heroDescription: string;
    contactTitle: string;
    contactDescription: string;
  };
  directions: CustomOrderDirection[];
  heroMedia: CustomOrderMedia[];
  changeThemes: CustomOrderChangeTheme[];
  sourceMaterials: string[];
}

const required = <T>(value: T | undefined, message: string): T => {
  if (!value) throw new Error(message);
  return value;
};

const relatedDirectionSlugs = new Set<V2DirectionSlug>([
  'ulichnaya-mebel',
  'ograzhdeniya-i-zabory',
  'navesy-i-kozyrki',
  'metallokonstruktsii-dlya-biznesa'
]);

const customOrderHero = {
  projectSlug: 'gorodskie-kacheli-dlya-obshchestvennyh-territoriy',
  src: '/uploads/project-05c77513c1a391e5a71a7dee.jpg',
  position: '50% 64%',
  mobilePosition: '50% 58%'
} as const;

export const loadCustomOrderV2Data = async (): Promise<CustomOrderV2Data> => {
  const [snapshot, staticEntries, projectEntries, activeDirections] = await Promise.all([
    loadCatalogV2Snapshot(),
    getCollection('static-pages'),
    getCollection('projects'),
    loadV2Directions()
  ]);

  const sourcePage = required(
    staticEntries.find(({ data }) => data.slug === 'custom-order' && data.isActive !== false)?.data,
    'Custom order V2 requires the current custom-order static-page record.'
  );
  const projects = projectEntries.map(({ data }) => data).filter((item) => item.isActive);
  const directions = activeDirections
    .filter(({ slug }) => relatedDirectionSlugs.has(slug))
    .map(({ title, href }) => ({ title, href }));
  const approvedUntilEdited = (current: string | undefined, legacy: string, approved: string) => {
    const value = current?.trim() ?? '';
    return value === legacy ? approved : (value || approved);
  };
  const copy = {
    heroKicker: approvedUntilEdited(sourcePage.heroKicker, 'Служебный сценарий', 'Индивидуальная задача'),
    heroTitle: approvedUntilEdited(sourcePage.heroTitle, 'Изготовление на заказ', 'Изготовление под задачу объекта'),
    heroDescription: approvedUntilEdited(
      sourcePage.heroDescription,
      'Если задача не укладывается в каталог, присылайте фото, размеры, эскиз или описание. Подготовим рабочий вариант и расчет.',
      'Рассматриваем изделия и конструкции по фотографии, эскизу, чертежу или техническому заданию и подбираем исполнение под условия конкретного объекта.'
    ),
    contactTitle: approvedUntilEdited(sourcePage.contactTitle, 'Не нашли, что искали?', 'Передайте задачу удобным способом'),
    contactDescription: approvedUntilEdited(
      sourcePage.contactDescription,
      'Если типовое решение не закрывает задачу, напишите нам. Подберем формат реализации под объект, референс, ТЗ или чертеж.',
      'Можно начать с краткого описания и тех материалов, которые уже подготовлены.'
    )
  };

  const publicProducts = snapshot.products.filter((product) => product.showInCatalog !== false);
  const projectPresentations = projects
    .map((project) => getV2ProjectPresentation(project as ProjectData))
    .filter((item) => item.hasMedia);
  const heroProject = projectPresentations.find(
    (item) => item.project.slug === customOrderHero.projectSlug
  );
  const heroProjectMedia = heroProject?.media.find(
    (item) => item.src === customOrderHero.src
      && item.roles.includes('finished-result')
      && item.roles.includes('hero')
  );
  const heroMedia: CustomOrderMedia[] = [required(
    heroProjectMedia ? {
      src: heroProjectMedia.src,
      alt: heroProjectMedia.alt,
      fit: 'cover',
      position: customOrderHero.position,
      mobilePosition: customOrderHero.mobilePosition
    } : undefined,
    'Custom order V2 requires the approved finished-result swings Hero media.'
  )];

  // Capabilities are derived from every currently public product. If an editor removes
  // the supporting records or text, that granular claim and any empty theme disappear.
  const evidenceText = publicProducts
    .flatMap((product) => product.customizationItems || [])
    .join(' · ')
    .toLocaleLowerCase('ru');
  const supported = (pattern: RegExp, label: string) =>
    pattern.test(evidenceText) ? label : undefined;
  const theme = (title: string, items: Array<string | undefined>) => ({
    title,
    items: items.filter((item): item is string => Boolean(item))
  });
  const changeThemes = [
    theme('Размеры', [
      supported(/размер|габарит/, 'Размеры и габариты')
    ]),
    theme('Форма и конструктив', [
      supported(/форму|наклон/, 'Форма и геометрия отдельных элементов'),
      supported(
        /количество стоек|расстояние между стойками/,
        'Количество и расстояние между стойками в составном решении'
      )
    ]),
    theme('Цвет металла и дерева', [
      supported(/цвет металла/, 'Цвет металлических элементов'),
      supported(/оттенок дерева/, 'Оттенок деревянных элементов')
    ]),
    theme('Комплектация и крепление', [
      supported(/способ крепления/, 'Способ крепления')
    ]),
    theme('Дополнительные элементы', [
      supported(/логотип/, 'Добавление логотипа')
    ])
  ].filter((item) => item.items.length > 0);

  const approvedSourceMaterials = [
    'Фотография или референс',
    'Примерные размеры',
    'Эскиз',
    'Чертёж',
    'Техническое задание',
    'Описание задачи'
  ];
  const legacySourceMaterials = [
    'фото текущей ситуации',
    'размеры и привязки',
    'эскиз или пример',
    'описание условий эксплуатации'
  ];
  const sourceMaterialsBlock = (sourcePage.pageBlocks as Array<{
    type?: string;
    title?: string;
    items?: unknown[];
    isActive?: boolean;
  }>).find((block) => block.type === 'listPanel' && block.title === 'Что можно прислать' && block.isActive !== false);
  const editedSourceMaterials = (sourceMaterialsBlock?.items ?? [])
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim());
  const sourceMaterials = JSON.stringify(editedSourceMaterials) === JSON.stringify(legacySourceMaterials)
    ? approvedSourceMaterials
    : (editedSourceMaterials.length > 0 ? editedSourceMaterials : approvedSourceMaterials);

  return {
    sourcePage,
    copy,
    directions,
    heroMedia,
    changeThemes,
    sourceMaterials,
  };
};

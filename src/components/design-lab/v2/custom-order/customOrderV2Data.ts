import { getCollection, type CollectionEntry } from 'astro:content';
import {
  catalogV2ProductHref,
  loadCatalogV2Snapshot,
  type CatalogV2Snapshot,
  type ProductData
} from '../catalogV2Data';
import { getV2ProjectPresentation } from '../mediaRoleAdapter';

type ProductSectionData = CollectionEntry<'product-sections'>['data'];
type ServiceData = CollectionEntry<'services'>['data'];
type ProjectData = CollectionEntry<'projects'>['data'];
type StaticPageData = CollectionEntry<'static-pages'>['data'];

export interface CustomOrderDirection {
  title: string;
  description: string;
  href: string;
}

export interface CustomOrderMedia {
  src: string;
  alt: string;
  fit: 'cover' | 'contain';
  position: string;
}

export interface CustomOrderExample extends CustomOrderMedia {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
}

export interface CustomOrderV2Data {
  sourcePage: StaticPageData;
  directions: CustomOrderDirection[];
  heroMedia: [CustomOrderMedia, CustomOrderMedia];
  changeOptions: string[];
  sourceMaterials: string[];
  examples: CustomOrderExample[];
}

const required = <T>(value: T | undefined, message: string): T => {
  if (!value) throw new Error(message);
  return value;
};

const activeSection = (snapshot: CatalogV2Snapshot, slug: string) =>
  required(snapshot.sections.find((item) => item.slug === slug), `Custom order V2 requires active section ${slug}.`);

const activeProduct = (snapshot: CatalogV2Snapshot, slug: string) =>
  required(snapshot.products.find((item) => item.slug === slug), `Custom order V2 requires active product ${slug}.`);

const productHref = (snapshot: CatalogV2Snapshot, product: ProductData) => {
  const route = required(
    snapshot.productRoutes.find((item) => item.product.slug === product.slug),
    `Custom order V2 cannot resolve the catalog route for ${product.slug}.`
  );
  return catalogV2ProductHref(route.section.slug, route.category.slug, product.slug);
};

const productExample = (
  snapshot: CatalogV2Snapshot,
  product: ProductData,
  eyebrow: string
): CustomOrderExample => ({
  eyebrow,
  title: product.title,
  description: product.shortDescription || product.leadText || '',
  href: productHref(snapshot, product),
  src: required(product.image?.trim(), `Custom order V2 example ${product.slug} requires assigned media.`),
  alt: product.title,
  fit: product.imageView?.fit === 'contain' ? 'contain' : 'cover',
  position: `${product.imageView?.positionX ?? 50}% ${product.imageView?.positionY ?? 50}%`
});

export const loadCustomOrderV2Data = async (): Promise<CustomOrderV2Data> => {
  const [snapshot, staticEntries, serviceEntries, projectEntries] = await Promise.all([
    loadCatalogV2Snapshot(),
    getCollection('static-pages'),
    getCollection('services'),
    getCollection('projects')
  ]);

  const sourcePage = required(
    staticEntries.find(({ data }) => data.slug === 'custom-order' && data.isActive !== false)?.data,
    'Custom order V2 requires the current custom-order static-page record.'
  );
  const services = serviceEntries.map(({ data }) => data).filter((item) => item.isActive);
  const projects = projectEntries.map(({ data }) => data).filter((item) => item.isActive);
  const service = (slug: string) => required(
    services.find((item) => item.slug === slug),
    `Custom order V2 requires active service ${slug}.`
  );

  const directionSpecs: Array<{
    item: ProductSectionData | ServiceData;
    title: string;
    href: string;
  }> = [
    { item: activeSection(snapshot, 'ulichnaya-mebel'), title: 'Уличная мебель', href: '/design-lab/v2/ulichnaya-mebel/' },
    { item: activeSection(snapshot, 'ograzhdeniya-i-zabory'), title: 'Ограждения и заборы', href: '/design-lab/v2/ograzhdeniya-i-zabory/' },
    { item: activeSection(snapshot, 'navesy-i-kozyrki'), title: 'Навесы и козырьки', href: '/design-lab/v2/navesy-i-kozyrki/' },
    { item: activeSection(snapshot, 'metallokonstruktsii-dlya-biznesa'), title: 'Металлоконструкции', href: '/design-lab/v2/metallokonstruktsii-dlya-biznesa/' },
    { item: activeSection(snapshot, 'topiarii'), title: 'Топиарии', href: '/design-lab/v2/topiarii/' },
    { item: service('blagoustroystvo-territoriy'), title: 'Благоустройство территорий', href: '/design-lab/v2/blagoustroystvo-territoriy/' },
    { item: service('stroitelstvo-i-remonty'), title: 'Строительство и ремонты', href: '/design-lab/v2/stroitelstvo-i-remonty/' }
  ];
  const directions = directionSpecs.map(({ item, title, href }) => ({
    title,
    href,
    description: item.shortDescription
  }));

  const bench = activeProduct(snapshot, 'skamya-loft');
  const canopy = activeProduct(snapshot, 'naves-terra');
  const screen = activeProduct(snapshot, 'ekran-s-navesom');
  const bikeMarker = activeProduct(snapshot, 'veloparkovka-marker');
  const swingsProject = required(
    projects.find((item) => item.slug === 'gorodskie-kacheli-dlya-obshchestvennyh-territoriy'),
    'Custom order V2 requires the active city swings project.'
  );
  const promenadeProject = required(
    projects.find((item) => item.slug === 'blagoustroystvo-naberezhnoy-reki-tobol'),
    'Custom order V2 requires the active promenade project.'
  );
  const swingsPresentation = getV2ProjectPresentation(swingsProject as ProjectData);
  const promenadePresentation = getV2ProjectPresentation(promenadeProject as ProjectData);
  const finishedSwings = required(
    swingsPresentation.heroMedia,
    'Custom order V2 requires the approved finished-result city swings media.'
  );
  const finishedPromenade = required(
    promenadePresentation.archiveCoverMedia,
    'Custom order V2 requires the approved finished-result promenade media.'
  );

  // These options are a V2-only presentation adapter backed by the named active product records.
  // No capability is inferred from file names or added to production data.
  const evidenceText = [
    ...(bench.customizationItems || []),
    ...(canopy.customizationItems || []),
    ...(screen.customizationItems || []),
    ...(bikeMarker.customizationItems || [])
  ].join(' · ').toLocaleLowerCase('ru');
  const evidence = (pattern: RegExp, label: string) => {
    if (!pattern.test(evidenceText)) throw new Error(`Custom order V2 lacks product-record evidence for: ${label}.`);
    return label;
  };
  const changeOptions = [
    evidence(/размер|габарит/, 'Размеры и габариты'),
    evidence(/форму|наклон/, 'Форма и геометрия отдельных элементов'),
    evidence(/цвет металла/, 'Цвет металлических элементов'),
    evidence(/оттенок дерева/, 'Оттенок деревянных элементов'),
    evidence(/способ крепления/, 'Способ крепления'),
    evidence(/количество стоек|расстояние между стойками/, 'Количество и расстояние между стойками в составном решении'),
    evidence(/логотип/, 'Добавление логотипа')
  ];

  const heroMedia: [CustomOrderMedia, CustomOrderMedia] = [
    {
      src: finishedSwings.src,
      alt: finishedSwings.alt,
      fit: 'cover',
      position: swingsPresentation.detailHeroPosition
    },
    {
      src: required(canopy.image?.trim(), 'Custom order V2 requires the canopy catalog render.'),
      alt: canopy.title,
      fit: 'contain',
      position: '50% 50%'
    }
  ];

  const examples: CustomOrderExample[] = [
    productExample(snapshot, bench, 'Изделие'),
    productExample(snapshot, screen, 'Конструкция'),
    {
      eyebrow: 'Выполненный объект',
      title: promenadeProject.title,
      description: promenadeProject.shortDescription,
      href: `/design-lab/v2/vypolnennye-obekty/${promenadeProject.slug}/`,
      src: finishedPromenade.src,
      alt: finishedPromenade.alt,
      fit: 'cover',
      position: promenadePresentation.archiveCoverPosition
    }
  ];

  return {
    sourcePage,
    directions,
    heroMedia,
    changeOptions,
    sourceMaterials: [
      'Фотография или референс',
      'Примерные размеры',
      'Эскиз',
      'Чертёж',
      'Техническое задание',
      'Описание задачи'
    ],
    examples
  };
};

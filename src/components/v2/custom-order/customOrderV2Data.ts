import { getCollection, type CollectionEntry } from 'astro:content';
import {
  catalogV2ProductHref,
  loadCatalogV2Snapshot,
  type CatalogV2Snapshot,
  type ProductData
} from '../catalogV2Data';
import { getV2ProjectPresentation } from '../mediaRoleAdapter';
import { loadV2Directions } from '../../../utils/v2Directions';

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
  copy: {
    heroKicker: string;
    heroTitle: string;
    heroDescription: string;
    contactTitle: string;
    contactDescription: string;
  };
  directions: CustomOrderDirection[];
  heroMedia: CustomOrderMedia[];
  changeOptions: string[];
  sourceMaterials: string[];
  examples: CustomOrderExample[];
}

const required = <T>(value: T | undefined, message: string): T => {
  if (!value) throw new Error(message);
  return value;
};

const isUsableMedia = (value: string | undefined) => Boolean(
  value?.trim() && !value.includes('/assets/images/placeholders/')
);

const productHref = (snapshot: CatalogV2Snapshot, product: ProductData) => {
  const route = snapshot.productRoutes.find((item) => item.product.slug === product.slug);
  return route ? catalogV2ProductHref(route.section.slug, route.category.slug, product.slug) : '';
};

const productExample = (
  snapshot: CatalogV2Snapshot,
  product: ProductData | undefined,
  eyebrow: string
): CustomOrderExample | undefined => {
  if (!product || !isUsableMedia(product.image)) return undefined;
  const href = productHref(snapshot, product);
  if (!href) return undefined;
  return {
    eyebrow,
    title: product.title,
    description: product.shortDescription || product.leadText || '',
    href,
    src: product.image!.trim(),
    alt: product.title,
    fit: product.imageView?.fit === 'contain' ? 'contain' : 'cover',
    position: `${product.imageView?.positionX ?? 50}% ${product.imageView?.positionY ?? 50}%`
  };
};

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
  const directions = activeDirections.map(({ title, href, description }) => ({ title, href, description }));
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
  const usableProducts = publicProducts.filter((product) => isUsableMedia(product.image) && Boolean(productHref(snapshot, product)));
  const pickProduct = (preferredSlugs: string[], excluded = new Set<string>()) => (
    preferredSlugs
      .map((slug) => usableProducts.find((product) => product.slug === slug && !excluded.has(product.slug)))
      .find(Boolean)
    ?? usableProducts.find((product) => !excluded.has(product.slug))
  );
  const projectPresentations = projects
    .map((project) => getV2ProjectPresentation(project as ProjectData))
    .filter((item) => item.hasMedia);
  const pickProject = (preferredSlug: string, role: 'hero' | 'cover') => (
    projectPresentations.find((item) => item.project.slug === preferredSlug
      && Boolean(role === 'hero' ? item.detailHeroMedia : item.archiveCoverMedia))
    ?? projectPresentations.find((item) => Boolean(role === 'hero' ? item.detailHeroMedia : item.archiveCoverMedia))
  );

  const heroProject = pickProject('gorodskie-kacheli-dlya-obshchestvennyh-territoriy', 'hero');
  const heroProjectMedia = heroProject?.detailHeroMedia;
  const heroProduct = pickProduct(['naves-terra']);

  // Capabilities are derived from every currently public product. If an editor removes
  // the supporting records or text, the option disappears instead of becoming a claim.
  const evidenceText = publicProducts
    .flatMap((product) => product.customizationItems || [])
    .join(' · ')
    .toLocaleLowerCase('ru');
  const evidence = (pattern: RegExp, label: string) => pattern.test(evidenceText) ? label : undefined;
  const changeOptions = [
    evidence(/размер|габарит/, 'Размеры и габариты'),
    evidence(/форму|наклон/, 'Форма и геометрия отдельных элементов'),
    evidence(/цвет металла/, 'Цвет металлических элементов'),
    evidence(/оттенок дерева/, 'Оттенок деревянных элементов'),
    evidence(/способ крепления/, 'Способ крепления'),
    evidence(/количество стоек|расстояние между стойками/, 'Количество и расстояние между стойками в составном решении'),
    evidence(/логотип/, 'Добавление логотипа')
  ].filter((item): item is string => Boolean(item));

  const heroMedia: CustomOrderMedia[] = [
    heroProjectMedia && heroProject ? {
      src: heroProjectMedia.src,
      alt: heroProjectMedia.alt,
      fit: 'cover',
      position: heroProject.detailHeroPosition
    } : undefined,
    heroProduct && isUsableMedia(heroProduct.image) ? {
      src: heroProduct.image!.trim(),
      alt: heroProduct.title,
      fit: heroProduct.imageView?.fit === 'contain' ? 'contain' : 'cover',
      position: `${heroProduct.imageView?.positionX ?? 50}% ${heroProduct.imageView?.positionY ?? 50}%`
    } : undefined
  ].filter((item): item is CustomOrderMedia => Boolean(item)).slice(0, 2);

  const usedProductSlugs = new Set<string>();
  const productExampleRecord = pickProduct(['skamya-loft']);
  if (productExampleRecord) usedProductSlugs.add(productExampleRecord.slug);
  const constructionExampleRecord = pickProduct(['ekran-s-navesom'], usedProductSlugs);
  const exampleProject = pickProject('blagoustroystvo-naberezhnoy-reki-tobol', 'cover');
  const exampleProjectMedia = exampleProject?.archiveCoverMedia;
  const examples = [
    productExample(snapshot, productExampleRecord, 'Изделие'),
    productExample(snapshot, constructionExampleRecord, 'Конструкция'),
    exampleProject && exampleProjectMedia ? {
      eyebrow: 'Выполненный объект',
      title: exampleProject.project.title,
      description: exampleProject.project.shortDescription,
      href: exampleProject.productionRoute,
      src: exampleProjectMedia.src,
      alt: exampleProjectMedia.alt,
      fit: 'cover',
      position: exampleProject.archiveCoverPosition
    } satisfies CustomOrderExample : undefined
  ].filter((item): item is CustomOrderExample => Boolean(item)).slice(0, 3);

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
    changeOptions,
    sourceMaterials,
    examples
  };
};

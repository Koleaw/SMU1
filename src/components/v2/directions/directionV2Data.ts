import { getCollection, type CollectionEntry } from 'astro:content';
import {
  getCategoryProducts,
  loadCatalogV2Snapshot,
  type CatalogV2Snapshot,
  type ProductCategoryData,
  type ProductData,
  type ProductSectionData
} from '../catalogV2Data';

export type ServiceData = CollectionEntry<'services'>['data'];

export interface DirectionCardItem {
  title: string;
  text?: string;
  image?: string;
  imageAlt?: string;
  imageView?: { fit?: 'cover' | 'contain'; positionX?: number; positionY?: number; scale?: number };
  order?: number;
  isActive?: boolean;
}

export interface DirectionStepItem {
  title: string;
  order?: number;
  isActive?: boolean;
}

export interface DirectionBlock {
  type: string;
  title?: string;
  text?: string;
  media?: string;
  order?: number;
  isActive?: boolean;
  items?: Array<string | DirectionCardItem>;
  steps?: DirectionStepItem[];
}

export interface DirectionV2Snapshot {
  catalog: CatalogV2Snapshot;
  services: ServiceData[];
  section: ProductSectionData;
  catalogCategory?: ProductCategoryData;
  catalogProducts: ProductData[];
}

interface LoadDirectionOptions {
  sectionSlug: string;
  catalogCategorySlug?: string;
}

const byOrderAndTitle = <T extends { order?: number; title?: string }>(a: T, b: T) =>
  (a.order ?? 0) - (b.order ?? 0) || (a.title || '').localeCompare(b.title || '', 'ru');

export const loadDirectionV2Snapshot = async ({
  sectionSlug,
  catalogCategorySlug
}: LoadDirectionOptions): Promise<DirectionV2Snapshot> => {
  const [catalog, serviceEntries] = await Promise.all([
    loadCatalogV2Snapshot(),
    getCollection('services')
  ]);
  const section = catalog.sections.find((item) => item.slug === sectionSlug);
  if (!section) throw new Error(`Active direction ${sectionSlug} was not found.`);

  const services = serviceEntries
    .map(({ data }) => data)
    .filter((item) => item.isActive)
    .sort(byOrderAndTitle);
  const catalogCategory = catalogCategorySlug
    ? catalog.categories.find((item) => item.slug === catalogCategorySlug)
    : undefined;
  const catalogProducts = catalogCategory
    ? getCategoryProducts(catalog, catalogCategory.slug)
    : [];

  return { catalog, services, section, catalogCategory, catalogProducts };
};

export const getDirectionBlocks = (section: ProductSectionData, type?: string) => {
  const blocks = (Array.isArray(section.pageBlocks) ? section.pageBlocks : []) as DirectionBlock[];
  return blocks
    .filter((block) => block.isActive !== false && (!type || block.type === type))
    .sort(byOrderAndTitle);
};

export const getDirectionBlock = (section: ProductSectionData, type: string, index = 0) =>
  getDirectionBlocks(section, type)[index];

export const getDirectionCardItems = (block?: DirectionBlock) =>
  (Array.isArray(block?.items) ? block.items : [])
    .filter((item): item is DirectionCardItem => Boolean(item) && typeof item !== 'string' && item.isActive !== false)
    .map((item) => ({
      ...item,
      title: item.title.trim(),
      text: item.text?.trim() || '',
      image: item.image?.trim() || undefined,
      imageAlt: item.imageAlt?.trim() || undefined
    }))
    .filter((item) => Boolean(item.title))
    .sort(byOrderAndTitle);

export const getDirectionListItems = (block?: DirectionBlock) =>
  Array.from(new Set((Array.isArray(block?.items) ? block.items : [])
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)));

export const getDirectionStepItems = (block?: DirectionBlock) =>
  (Array.isArray(block?.steps) ? block.steps : [])
    .filter((item) => item.isActive !== false && item.title?.trim())
    .sort(byOrderAndTitle)
    .map((item) => item.title.trim());

export const getDirectionGalleryImages = (products: ProductData[], includePrimary = false) => {
  const images = products.flatMap((product) => [
    ...(includePrimary && product.image ? [product.image] : []),
    ...(Array.isArray(product.gallery) ? product.gallery : [])
  ]);
  return Array.from(new Set(images.map((item) => item?.trim()).filter((item): item is string => Boolean(item))));
};

export const extractConfirmedBriefInputs = (sources: Array<string | undefined>) => {
  const copy = sources.filter(Boolean).join(' ');
  const rules = [
    { test: /фото(?:граф)?/iu, label: 'Фотография' },
    { test: /размер|габарит/iu, label: 'Размеры' },
    { test: /эскиз/iu, label: 'Эскиз' },
    { test: /черт[её]ж/iu, label: 'Чертёж' },
    { test: /техническ\p{L}*\s+задан|(?:^|[\s,.;:()])тз(?:$|[\s,.;:()])/iu, label: 'ТЗ' },
    { test: /описан\p{L}*\s+задач/iu, label: 'Описание задачи' }
  ];
  return rules.filter(({ test }) => test.test(copy)).map(({ label }) => label);
};

import { getCollection } from 'astro:content';

export type V2DirectionSlug =
  | 'ulichnaya-mebel'
  | 'ograzhdeniya-i-zabory'
  | 'navesy-i-kozyrki'
  | 'metallokonstruktsii-dlya-biznesa'
  | 'topiarii'
  | 'blagoustroystvo-territoriy'
  | 'stroitelstvo-i-remonty';

export interface V2DirectionSummary {
  slug: V2DirectionSlug;
  ownerCollection: 'product-sections' | 'services';
  title: string;
  description: string;
  href: string;
  showOnHome: boolean;
  listOrder: number;
  image?: string;
  imageFit: 'cover' | 'contain';
  imagePosition: string;
}

type DirectionRecord = {
  slug: string;
  title: string;
  shortDescription: string;
  homeImage?: string;
  homeOrder?: number;
  imageView?: { fit?: string; positionX?: number; positionY?: number };
  showOnHome?: boolean;
  isActive?: boolean;
  order: number;
};

const directionSlugs = new Set<V2DirectionSlug>([
  'ulichnaya-mebel',
  'ograzhdeniya-i-zabory',
  'navesy-i-kozyrki',
  'metallokonstruktsii-dlya-biznesa',
  'topiarii',
  'blagoustroystvo-territoriy',
  'stroitelstvo-i-remonty'
]);

export const loadV2Directions = async (): Promise<V2DirectionSummary[]> => {
  const [sectionEntries, serviceEntries] = await Promise.all([
    getCollection('product-sections'),
    getCollection('services')
  ]);
  const records = [
    ...sectionEntries.map(({ data }) => ({
      ownerCollection: 'product-sections' as const,
      record: data as DirectionRecord
    })),
    ...serviceEntries.map(({ data }) => ({
      ownerCollection: 'services' as const,
      record: data as DirectionRecord
    }))
  ].filter(({ record }) => record.isActive !== false && directionSlugs.has(record.slug as V2DirectionSlug));

  return records.map<V2DirectionSummary>(({ ownerCollection, record }) => ({
    slug: record.slug as V2DirectionSlug,
    ownerCollection,
    title: record.title.trim(),
    description: record.shortDescription.trim(),
    href: `/${record.slug}/`,
    showOnHome: record.showOnHome !== false,
    listOrder: record.homeOrder ?? record.order,
    image: record.homeImage?.trim() || undefined,
    imageFit: record.imageView?.fit === 'contain' ? 'contain' : 'cover',
    imagePosition: `${record.imageView?.positionX ?? 50}% ${record.imageView?.positionY ?? 50}%`
  })).sort((a, b) => a.listOrder - b.listOrder);
};

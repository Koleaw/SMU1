import type { CollectionEntry } from 'astro:content';
import { getProjectImages, type ProjectImage, type ProjectImageSource } from '../../utils/projectImages';
import { projectCategory, projectLocation } from '../../utils/projectContent';

export type V2MediaRole =
  | 'metalworks'
  | 'construction'
  | 'construction-building'
  | 'landscaping'
  | 'finished-result'
  | 'process'
  | 'proof'
  | 'hero'
  | 'excluded';

export type V2ProjectRecord = CollectionEntry<'projects'>['data'];

interface V2ProjectMediaSource extends ProjectImageSource {
  slug: string;
}

export interface V2MediaSelection {
  allOf?: readonly V2MediaRole[];
  anyOf?: readonly V2MediaRole[];
  exclude?: readonly V2MediaRole[];
}

export interface V2ProjectMedia extends ProjectImage {
  roles: readonly V2MediaRole[];
}

export interface V2ProjectDirection {
  label: string;
  href: string;
  context: string;
}

export type V2ArchiveCoverOrientation = 'landscape' | 'portrait';

export interface V2ProjectPresentation {
  project: V2ProjectRecord;
  productionRoute: string;
  v2Route: string;
  location: string;
  category: string;
  /** Every allowed media item from the record. This remains the audit/source set. */
  media: V2ProjectMedia[];
  /** Curated, public V2 sequence. Items omitted here are not removed from the record. */
  publicGallery: V2ProjectMedia[];
  excludedFromPresentation: V2ProjectMedia[];
  archiveCoverMedia?: V2ProjectMedia;
  detailHeroMedia?: V2ProjectMedia;
  archiveCoverPosition: string;
  archiveCoverOrientation: V2ArchiveCoverOrientation;
  detailHeroPosition: string;
  /** Backwards-compatible alias used by existing V2 callers. */
  heroMedia?: V2ProjectMedia;
  relatedDirections: V2ProjectDirection[];
  hasMedia: boolean;
  isTextOnly: boolean;
}

interface V2ProjectPresentationConfig {
  archiveCoverMedia?: string;
  detailHeroMedia?: string;
  publicGallery?: readonly string[];
  archiveCoverPosition?: string;
  archiveCoverOrientation?: V2ArchiveCoverOrientation;
  detailHeroPosition?: string;
  relatedDirections: readonly V2ProjectDirection[];
  altOverrides?: Readonly<Record<string, string>>;
}

const directions = {
  streetFurniture: {
    label: 'Уличная мебель',
    href: '/design-lab/v2/ulichnaya-mebel/',
    context: 'Изделия для общественных и частных территорий.'
  },
  fences: {
    label: 'Ограждения и заборы',
    href: '/design-lab/v2/ograzhdeniya-i-zabory/',
    context: 'Ограждения, перила и решения для границ территории.'
  },
  metalworks: {
    label: 'Металлоконструкции',
    href: '/design-lab/v2/metallokonstruktsii-dlya-biznesa/',
    context: 'Металлическая часть объекта по исходным данным заказчика.'
  },
  construction: {
    label: 'Строительство и ремонты',
    href: '/design-lab/v2/stroitelstvo-i-remonty/',
    context: 'Строительные и ремонтные работы на объекте.'
  },
  landscaping: {
    label: 'Благоустройство территорий',
    href: '/design-lab/v2/blagoustroystvo-territoriy/',
    context: 'Работы для общественных, коммерческих и частных территорий.'
  }
} satisfies Record<string, V2ProjectDirection>;

// Explicit presentation choices shared by production and the design-lab reference routes.
// The project records, schemas and media stay untouched. If an editor replaces configured media in a
// project record, getV2ProjectPresentation deliberately falls back to the record's current safe media.
const projectPresentations = {
  'blagoustroystvo-naberezhnoy-reki-tobol': {
    archiveCoverMedia: '/uploads/project-da0872c68d9a09f0a7d2f995.jpg',
    detailHeroMedia: '/uploads/project-da0872c68d9a09f0a7d2f995.jpg',
    publicGallery: [
      '/uploads/project-248f17177df30b29ab9b231a.jpg',
      '/uploads/project-da0872c68d9a09f0a7d2f995.jpg',
      '/uploads/project-13f617982c8070a1abe2c203.jpg'
    ],
    archiveCoverPosition: '50% 55%',
    detailHeroPosition: '50% 56%',
    relatedDirections: [directions.landscaping, directions.fences, directions.streetFurniture],
    altOverrides: {
      '/uploads/project-248f17177df30b29ab9b231a.jpg': 'Ограждение на благоустроенной набережной реки Тобол',
      '/uploads/project-da0872c68d9a09f0a7d2f995.jpg': 'Готовая территория набережной с лестницей, лавочками и ограждениями',
      '/uploads/project-13f617982c8070a1abe2c203.jpg': 'Работы на участке набережной реки Тобол'
    }
  },
  'remont-skvera-na-ulitse-gogolya': {
    publicGallery: [],
    relatedDirections: [directions.landscaping, directions.streetFurniture]
  },
  'kompleks-rabot-na-proizvodstvennoy-territorii': {
    archiveCoverMedia: '/uploads/img-20250724-134235-1783272745917.jpg',
    detailHeroMedia: '/uploads/img-20250724-134235-1783272745917.jpg',
    publicGallery: [
      '/uploads/img-20250724-134235-1783272745917.jpg',
      '/uploads/img-20231005-180628-1783272745470.jpg',
      '/uploads/img-20231011-134317-1783272745498.jpg',
      '/uploads/img-20230928-115904-1783272745333.jpg',
      '/uploads/img-20231026-161150-1783272745570.jpg',
      '/uploads/img-20231102-142552-1783272745634.jpg',
      '/uploads/img-20231103-164313-1783272745668.jpg',
      '/uploads/img-20231126-132505-1783272745788.jpg',
      '/uploads/img-20231223-222338-1783272745821.jpg',
      '/uploads/img-20250724-133811-1783272616313.jpg'
    ],
    archiveCoverPosition: '50% 48%',
    detailHeroPosition: '50% 48%',
    relatedDirections: [directions.construction, directions.metalworks],
    altOverrides: {
      '/uploads/img-20250724-133811-1783272616313.jpg': 'Готовое здание на производственной территории',
      '/uploads/img-20250724-134010-1783272745899.jpg': 'Металлический каркас здания на производственной территории',
      '/uploads/img-20250724-134235-1783272745917.jpg': 'Готовое здание на производственной территории, общий вид',
      '/uploads/img-20250724-134355-1783272745972.jpg': 'Готовые здания на производственной территории'
    }
  },
  'gorodskie-kacheli-dlya-obshchestvennyh-territoriy': {
    archiveCoverMedia: '/uploads/project-05c77513c1a391e5a71a7dee.jpg',
    archiveCoverOrientation: 'portrait',
    detailHeroMedia: '/uploads/project-05c77513c1a391e5a71a7dee.jpg',
    publicGallery: [
      '/uploads/project-05c77513c1a391e5a71a7dee.jpg',
      '/uploads/project-05e1cb18f1d596a46bdacc90.jpg',
      '/uploads/project-684ea95d87f32fae2eea2987.jpg',
      '/uploads/project-24b71828f5efa9730bdde4ae.jpg'
    ],
    archiveCoverPosition: '50% 67%',
    detailHeroPosition: '50% 64%',
    relatedDirections: [directions.streetFurniture],
    altOverrides: {
      '/uploads/project-05e1cb18f1d596a46bdacc90.jpg': 'Установка городских качелей на общественной территории',
      '/uploads/project-684ea95d87f32fae2eea2987.jpg': 'Сборка городских качелей на территории объекта',
      '/uploads/project-05c77513c1a391e5a71a7dee.jpg': 'Городские качели после установки на общественной территории',
      '/uploads/project-24b71828f5efa9730bdde4ae.jpg': 'Работы по установке городских качелей на территории объекта'
    }
  }
} satisfies Record<string, V2ProjectPresentationConfig>;

// Media roles are intentionally explicit: file names are never treated as semantic evidence.
const mediaRoles = {
  'kompleks-rabot-na-proizvodstvennoy-territorii': {
    '/uploads/img-20250724-133811-1783272616313.jpg': [
      'construction', 'construction-building', 'finished-result', 'proof'
    ],
    '/uploads/img-20230913-110408-1783272745279.jpg': ['construction', 'process'],
    '/uploads/img-20230913-110538-1783272745310.jpg': ['construction', 'process'],
    '/uploads/img-20230928-115904-1783272745333.jpg': ['metalworks', 'process'],
    '/uploads/img-20230928-143443-1783272745354.jpg': ['metalworks', 'process'],
    '/uploads/img-20230928-151513-1783272745377.jpg': ['metalworks', 'process'],
    '/uploads/img-20231013-135454-1783272745548.jpg': ['metalworks', 'proof'],
    '/uploads/img-20231102-142552-1783272745634.jpg': ['metalworks', 'proof'],
    '/uploads/img-20231223-222338-1783272745821.jpg': ['metalworks', 'proof'],
    '/uploads/img-20231227-171915-1783272745842.jpg': ['metalworks', 'proof'],
    '/uploads/img-20250724-134010-1783272745899.jpg': ['metalworks', 'hero'],
    '/uploads/img-20250724-134235-1783272745917.jpg': [
      'construction', 'construction-building', 'finished-result', 'hero', 'proof'
    ],
    '/uploads/img-20250724-134252-1783272745934.jpg': ['excluded'],
    '/uploads/img-20250724-134312-1783272745953.jpg': ['excluded'],
    '/uploads/img-20250724-134355-1783272745972.jpg': [
      'construction', 'construction-building', 'finished-result', 'proof'
    ],
    '/uploads/img-20250724-134415-1783272745988.jpg': ['excluded']
  },
  'blagoustroystvo-naberezhnoy-reki-tobol': {
    '/uploads/project-248f17177df30b29ab9b231a.jpg': [
      'landscaping', 'finished-result', 'proof'
    ],
    '/uploads/project-da0872c68d9a09f0a7d2f995.jpg': [
      'landscaping', 'finished-result', 'hero', 'proof'
    ],
    '/uploads/project-13f617982c8070a1abe2c203.jpg': ['landscaping', 'process']
  },
  'remont-skvera-na-ulitse-gogolya': {
    '/assets/images/placeholders/landscaping.svg': ['excluded'],
    '/assets/images/placeholders/street-furniture.svg': ['excluded']
  },
  'gorodskie-kacheli-dlya-obshchestvennyh-territoriy': {
    '/uploads/project-05e1cb18f1d596a46bdacc90.jpg': ['process'],
    '/uploads/project-c9865e6f9d5ef6d37fbd9895.jpg': ['excluded'],
    '/uploads/project-93a94bd9fbec9f730574cfee.jpg': ['excluded'],
    '/uploads/project-684ea95d87f32fae2eea2987.jpg': ['process'],
    '/uploads/project-05c77513c1a391e5a71a7dee.jpg': ['finished-result', 'hero', 'proof'],
    '/uploads/project-24b71828f5efa9730bdde4ae.jpg': ['process']
  }
} satisfies Record<string, Record<string, readonly V2MediaRole[]>>;

const roleMap = mediaRoles as Record<string, Record<string, readonly V2MediaRole[]>>;
const presentationMap = projectPresentations as Record<string, V2ProjectPresentationConfig>;

export const getV2MediaRoles = (projectSlug: string, mediaPath: string): readonly V2MediaRole[] =>
  roleMap[projectSlug]?.[mediaPath] ?? [];

const matchesSelection = (roles: readonly V2MediaRole[], selection: V2MediaSelection) => {
  const allOf = selection.allOf ?? [];
  const anyOf = selection.anyOf ?? [];
  const excludedRoles = selection.exclude ?? ['excluded'];
  if (excludedRoles.some((role) => roles.includes(role))) return false;
  if (allOf.length > 0 && !allOf.every((role) => roles.includes(role))) return false;
  if (anyOf.length > 0 && !anyOf.some((role) => roles.includes(role))) return false;
  return allOf.length > 0 || anyOf.length > 0;
};

const normalizedMedia = (project: V2ProjectMediaSource) => {
  const config = presentationMap[project.slug];
  return getProjectImages(project).map((item) => ({
    ...item,
    alt: config?.altOverrides?.[item.src] || item.alt,
    roles: getV2MediaRoles(project.slug, item.src)
  }));
};

export const selectV2ProjectMediaItems = (
  project: V2ProjectMediaSource | undefined,
  selection: V2MediaSelection
) => project ? normalizedMedia(project).filter((item) => matchesSelection(item.roles, selection)) : [];

export const selectV2ProjectMedia = (
  project: V2ProjectMediaSource | undefined,
  selection: V2MediaSelection
) => selectV2ProjectMediaItems(project, selection).map((item) => item.src);

export const getV2ProjectPresentation = (project: V2ProjectRecord): V2ProjectPresentation => {
  const config = presentationMap[project.slug];
  const media = normalizedMedia(project).filter((item) => !item.roles.includes('excluded'));
  const configuredGallery = config?.publicGallery;
  const configuredGalleryItems = configuredGallery
    ?.map((src) => media.find((item) => item.src === src))
    .filter((item): item is V2ProjectMedia => Boolean(item)) ?? [];
  const configuredMediaChanged = configuredGallery !== undefined
    && (configuredGallery.length === 0
      ? media.length > 0
      : configuredGalleryItems.length !== configuredGallery.length);
  const fallbackLimit = configuredGallery && configuredGallery.length > 0
    ? configuredGallery.length
    : media.length;
  const publicGallery = configuredGallery && !configuredMediaChanged
    ? configuredGalleryItems
    : media.slice(0, fallbackLimit);
  const publicGallerySources = new Set(publicGallery.map((item) => item.src));
  const excludedFromPresentation = media.filter((item) => !publicGallerySources.has(item.src));
  const archiveCoverMedia = media.find((item) => item.src === config?.archiveCoverMedia)
    || media.find((item) => item.roles.includes('hero'))
    || publicGallery[0];
  const detailHeroMedia = media.find((item) => item.src === config?.detailHeroMedia)
    || archiveCoverMedia
    || publicGallery[0];
  const locationParts = [projectLocation(project), project.region?.trim()]
    .filter((item, index, items): item is string => Boolean(item) && items.indexOf(item) === index);

  return {
    project,
    productionRoute: `/vypolnennye-obekty/${project.slug}/`,
    v2Route: `/design-lab/v2/vypolnennye-obekty/${project.slug}/`,
    location: locationParts.join(', '),
    category: projectCategory(project),
    media,
    publicGallery,
    excludedFromPresentation,
    archiveCoverMedia,
    detailHeroMedia,
    archiveCoverPosition: config?.archiveCoverPosition ?? '50% 50%',
    archiveCoverOrientation: config?.archiveCoverOrientation ?? 'landscape',
    detailHeroPosition: config?.detailHeroPosition ?? '50% 50%',
    heroMedia: detailHeroMedia,
    relatedDirections: [...(config?.relatedDirections ?? [])],
    hasMedia: Boolean(archiveCoverMedia || detailHeroMedia || publicGallery.length),
    isTextOnly: !archiveCoverMedia && publicGallery.length === 0
  };
};

export const getV2ProjectPresentationConfig = (slug: string) => presentationMap[slug];

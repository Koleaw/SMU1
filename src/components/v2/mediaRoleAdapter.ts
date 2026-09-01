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

export interface V2ProjectDirection {
  id: string;
  label: string;
  href: string;
  context: string;
  order: number;
}

export type V2ArchiveCoverOrientation = 'landscape' | 'portrait';

type V2ProjectPresentationSource = {
  archiveCoverMedia?: string;
  detailHeroMedia?: string;
  publicGallery: string[];
  archiveCoverPosition: string;
  archiveCoverOrientation: V2ArchiveCoverOrientation;
  detailHeroPosition: string;
  relatedDirections: V2ProjectDirection[];
  altOverrides?: Record<string, string>;
  mediaRoles?: Record<string, V2MediaRole[]>;
};

interface V2ProjectMediaSource extends ProjectImageSource {
  slug: string;
  presentation?: V2ProjectPresentationSource;
}

export interface V2MediaSelection {
  allOf?: readonly V2MediaRole[];
  anyOf?: readonly V2MediaRole[];
  exclude?: readonly V2MediaRole[];
}

export interface V2ProjectMedia extends ProjectImage {
  roles: V2MediaRole[];
}

export interface V2ProjectPresentation {
  project: V2ProjectRecord;
  productionRoute: string;
  v2Route: string;
  location: string;
  category: string;
  /** Every allowed media item from the record. This remains the audit/source set. */
  media: V2ProjectMedia[];
  /** Explicit public sequence stored separately from the raw source pool. */
  publicGallery: V2ProjectMedia[];
  excludedFromPresentation: V2ProjectMedia[];
  archiveCoverMedia?: V2ProjectMedia;
  detailHeroMedia?: V2ProjectMedia;
  archiveCoverPosition: string;
  archiveCoverOrientation: V2ArchiveCoverOrientation;
  detailHeroPosition: string;
  heroMedia?: V2ProjectMedia;
  relatedDirections: V2ProjectDirection[];
  hasMedia: boolean;
  isTextOnly: boolean;
}

const normalizedMedia = (project: V2ProjectMediaSource) => {
  const config = project.presentation;
  return getProjectImages(project).map((item) => ({
    ...item,
    alt: config?.altOverrides?.[item.src] || item.alt,
    roles: config?.mediaRoles?.[item.src] ?? []
  }));
};

const matchesSelection = (roles: readonly V2MediaRole[], selection: V2MediaSelection) => {
  const allOf = selection.allOf ?? [];
  const anyOf = selection.anyOf ?? [];
  const excludedRoles = selection.exclude ?? ['excluded'];
  if (excludedRoles.some((role) => roles.includes(role))) return false;
  if (allOf.length > 0 && !allOf.every((role) => roles.includes(role))) return false;
  if (anyOf.length > 0 && !anyOf.some((role) => roles.includes(role))) return false;
  return allOf.length > 0 || anyOf.length > 0;
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
  const source = project as V2ProjectRecord & V2ProjectMediaSource;
  const config = source.presentation;
  const media = normalizedMedia(source).filter((item) => !item.roles.includes('excluded'));
  const publicGallery: V2ProjectMedia[] = (config?.publicGallery ?? [])
    .map((src) => media.find((item) => item.src === src))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  const publicGallerySources = new Set(publicGallery.map((item) => item.src));
  const excludedFromPresentation = media.filter((item) => !publicGallerySources.has(item.src));
  // Covers are explicit roles. A missing configured file remains missing and is
  // reported by validation; a newly uploaded first image never becomes a cover.
  const archiveCoverMedia = config?.archiveCoverMedia
    ? media.find((item) => item.src === config.archiveCoverMedia)
    : undefined;
  const detailHeroMedia = config?.detailHeroMedia
    ? media.find((item) => item.src === config.detailHeroMedia)
    : undefined;
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
    relatedDirections: (config?.relatedDirections ?? []).slice().sort((a, b) => a.order - b.order),
    hasMedia: Boolean(archiveCoverMedia || detailHeroMedia || publicGallery.length),
    isTextOnly: !archiveCoverMedia && !detailHeroMedia && publicGallery.length === 0
  };
};

export const getV2ProjectPresentationConfig = (project: V2ProjectRecord) =>
  (project as V2ProjectRecord & V2ProjectMediaSource).presentation;

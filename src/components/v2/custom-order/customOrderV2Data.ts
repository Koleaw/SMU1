import { getCollection, type CollectionEntry } from 'astro:content';
import { getV2ProjectPresentation } from '../mediaRoleAdapter';
import { loadV2Directions } from '../../../utils/v2Directions';

type StaticPageData = CollectionEntry<'static-pages'>['data'];
type CustomOrderSourcePage = StaticPageData & Required<Pick<StaticPageData, 'heroDescription' | 'shellCtaLabel'>>;

export interface CustomOrderDirection {
  title: string;
  href: string;
  slug: string;
  ownerCollection: 'product-sections' | 'services';
}

export interface CustomOrderMedia {
  src: string;
  alt: string;
  fit: 'cover' | 'contain';
  position: string;
  mobilePosition: string;
  ownerSlug: string;
  fieldPath: 'presentation.detailHeroMedia';
}

export interface CustomOrderChangeTheme {
  id: string;
  title: string;
  items: Array<{ id: string; label: string }>;
}

export interface CustomOrderV2Data {
  sourcePage: CustomOrderSourcePage;
  copy: {
    heroKicker: string;
    heroTitle: string;
    heroDescription: string;
    heroPrimaryLabel: string;
    heroSecondaryLabel: string;
    contactTitle: string;
    contactDescription: string;
    contactEyebrow: string;
    contactPrimaryLabel: string;
    contactSecondaryLabel: string;
  };
  directions: CustomOrderDirection[];
  heroMedia: CustomOrderMedia[];
  changeThemes: CustomOrderChangeTheme[];
  sourceMaterials: Array<{ id: string; label: string }>;
}

const required = <T>(value: T | undefined, message: string): T => {
  if (!value) throw new Error(message);
  return value;
};

export const loadCustomOrderV2Data = async (): Promise<CustomOrderV2Data> => {
  const [staticEntries, projectEntries, activeDirections] = await Promise.all([
    getCollection('static-pages'),
    getCollection('projects'),
    loadV2Directions()
  ]);
  const rawSourcePage = required(
    staticEntries.find(({ data }) => data.slug === 'custom-order' && data.isActive !== false)?.data,
    'Custom order V2 requires the current custom-order static-page record.'
  );
  const sourcePage: CustomOrderSourcePage = {
    ...rawSourcePage,
    heroDescription: required(rawSourcePage.heroDescription, 'Custom order V2 requires a Hero description.'),
    shellCtaLabel: required(rawSourcePage.shellCtaLabel, 'Custom order V2 requires a shell CTA label.')
  };
  const directionBySlug = new Map(activeDirections.map((direction) => [direction.slug, direction]));
  const directions = (sourcePage.relatedDirectionSlugs ?? [])
    .map((slug) => directionBySlug.get(slug as Parameters<typeof directionBySlug.get>[0]))
    .filter((direction): direction is NonNullable<typeof direction> => Boolean(direction))
    .map(({ title, href, slug, ownerCollection }) => ({ title, href, slug, ownerCollection }));

  const heroProject = projectEntries
    .map(({ data }) => data)
    .find((project) => project.isActive && project.slug === sourcePage.customOrderHeroProjectSlug);
  const heroPresentation = heroProject ? getV2ProjectPresentation(heroProject) : undefined;
  const heroProjectMedia = heroPresentation?.detailHeroMedia;
  const heroMedia: CustomOrderMedia[] = [required(heroProject && heroProjectMedia ? {
    src: heroProjectMedia.src,
    alt: heroProjectMedia.alt,
    fit: 'cover',
    position: sourcePage.customOrderHeroPosition ?? '50% 50%',
    mobilePosition: sourcePage.customOrderHeroMobilePosition ?? sourcePage.customOrderHeroPosition ?? '50% 50%',
    ownerSlug: heroProject.slug,
    fieldPath: 'presentation.detailHeroMedia'
  } : undefined, 'Custom order V2 requires a published project-backed Hero media role.')];

  const sourceMaterials = (sourcePage.customOrderSourceMaterials ?? [])
    .filter((item) => item.isActive !== false)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(({ id, label }) => ({ id, label }));
  const changeThemes = (sourcePage.customOrderChangeThemes ?? [])
    .filter((theme) => theme.isActive !== false)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((theme) => ({
      id: theme.id,
      title: theme.title,
      items: theme.items
        .filter((item) => item.isActive !== false)
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(({ id, label }) => ({ id, label }))
    }))
    .filter((theme) => theme.items.length > 0);

  return {
    sourcePage,
    copy: {
      heroKicker: sourcePage.heroKicker ?? '',
      heroTitle: sourcePage.heroTitle,
      heroDescription: sourcePage.heroDescription ?? '',
      heroPrimaryLabel: sourcePage.heroPrimaryLabel ?? 'Позвонить',
      heroSecondaryLabel: sourcePage.heroSecondaryLabel ?? 'Отправить исходные данные',
      contactTitle: sourcePage.contactTitle ?? '',
      contactDescription: sourcePage.contactDescription ?? '',
      contactEyebrow: sourcePage.contactEyebrow ?? 'Прямая связь',
      contactPrimaryLabel: sourcePage.contactPrimaryLabel ?? 'Основной телефон',
      contactSecondaryLabel: sourcePage.contactSecondaryLabel ?? 'Email'
    },
    directions,
    heroMedia,
    changeThemes,
    sourceMaterials
  };
};

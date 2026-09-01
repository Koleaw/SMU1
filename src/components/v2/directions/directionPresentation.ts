import type { ProductCategoryData, ProductSectionData } from '../catalogV2Data';
import type { ServiceData } from './directionV2Data';
import { adminBinding, adminDisposition } from '../../../admin/bindings/adminBinding';

export type DirectionPresentation = NonNullable<ProductSectionData['directionPresentation']>;
export type DirectionOwner = { collection: 'product-sections' | 'services'; slug: string };

interface DirectionCatalog {
  sections: ProductSectionData[];
  categories: ProductCategoryData[];
}

const byOrder = <T extends { order: number; id: string }>(left: T, right: T) =>
  left.order - right.order || left.id.localeCompare(right.id, 'ru');

export function requireDirectionPresentation(
  record: { slug: string; directionPresentation?: DirectionPresentation }
): DirectionPresentation {
  if (!record.directionPresentation) {
    throw new Error(`Direction ${record.slug} requires directionPresentation content.`);
  }
  return record.directionPresentation;
}

export function directionPresentationBinding(
  url: URL,
  owner: DirectionOwner,
  currentRoute: string,
  fieldPath: string,
  tool = 'short-text',
  options: Record<string, unknown> = {}
) {
  return adminBinding(url, {
    renderer: { family: 'specialized-direction', variant: owner.slug },
    owner,
    fieldPath: `directionPresentation.${fieldPath}`,
    stableItemId: `${owner.slug}-presentation-${fieldPath}`,
    scope: 'local',
    tool,
    affectedRoutes: [currentRoute],
    ...options
  });
}

export function directionSectionNavItems(
  url: URL,
  owner: DirectionOwner,
  currentRoute: string,
  presentation: DirectionPresentation,
  availableIds: Iterable<string>
) {
  const available = new Set(availableIds);
  return presentation.sectionNav.items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => item.isActive !== false && available.has(item.id))
    .sort((left, right) => byOrder(left.item, right.item))
    .map(({ item, sourceIndex }) => ({
      id: item.id,
      label: item.label,
      reorderEditor: directionPresentationBinding(
        url,
        owner,
        currentRoute,
        'sectionNav.items',
        'reorder-item',
        {
          stableItemId: item.id,
          zoneId: `direction-section-nav:${owner.collection}:${owner.slug}`,
          itemKind: 'object',
          label: `Пункт навигации «${item.label}»`,
          permissions: { edit: true, reorder: true, delete: false }
        }
      ),
      editor: directionPresentationBinding(
        url,
        owner,
        currentRoute,
        `sectionNav.items[${sourceIndex}].label`,
        'short-text'
      )
    }));
}

export function directionRelatedItems(
  url: URL,
  owner: DirectionOwner,
  currentRoute: string,
  presentation: DirectionPresentation,
  catalog: DirectionCatalog,
  services: ServiceData[]
) {
  const collections = {
    'product-sections': catalog.sections,
    'product-categories': catalog.categories,
    services
  } as const;

  return presentation.related.items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => item.isActive !== false)
    .sort((left, right) => byOrder(left.item, right.item))
    .flatMap(({ item, sourceIndex }) => {
      const record = collections[item.targetCollection].find((candidate) => candidate.slug === item.targetSlug);
      if (!record) return [];
      const href = item.targetCollection === 'product-categories'
        ? `/${(record as ProductCategoryData).parentSectionSlug}/${record.slug}/`
        : `/${record.slug}/`;
      const targetRoute = href;
      const local = (field: 'eyebrow' | 'title' | 'description', tool = 'short-text') =>
        directionPresentationBinding(
          url,
          owner,
          currentRoute,
          `related.items[${sourceIndex}].${field}`,
          tool
        );
      const titleEditor = item.title
        ? local('title')
        : adminBinding(url, {
            renderer: { family: 'direction-related', variant: owner.slug },
            owner: { collection: item.targetCollection, slug: record.slug },
            fieldPath: 'title', stableItemId: `${owner.slug}-${item.id}-related-title`,
            scope: 'shared', tool: 'short-text', affectedRoutes: [currentRoute, targetRoute, '/']
          });
      const descriptionEditor = typeof item.description === 'string'
        ? local('description', 'long-text')
        : adminBinding(url, {
            renderer: { family: 'direction-related', variant: owner.slug },
            owner: { collection: item.targetCollection, slug: record.slug },
            fieldPath: 'shortDescription', stableItemId: `${owner.slug}-${item.id}-related-description`,
            scope: 'shared', tool: 'long-text', affectedRoutes: [currentRoute, targetRoute, '/']
          });
      const hrefEditor = adminDisposition(url, {
        kind: 'derived',
        reason: 'Адрес связи вычисляется из targetCollection, targetSlug и канонической route policy.',
        source: `${owner.collection}:${owner.slug}.directionPresentation.related.items[${sourceIndex}]`,
        tool: 'page-settings'
      });
      return [{
        eyebrow: item.eyebrow,
        title: item.title || record.title,
        description: item.description ?? record.shortDescription,
        href,
        reorderEditor: directionPresentationBinding(
          url,
          owner,
          currentRoute,
          'related.items',
          'reorder-item',
          {
            stableItemId: item.id,
            zoneId: `direction-related:${owner.collection}:${owner.slug}`,
            itemKind: 'object',
            label: `Связанная страница «${item.title || record.title}»`,
            permissions: { edit: true, reorder: true, delete: false }
          }
        ),
        editor: { eyebrow: local('eyebrow'), title: titleEditor, description: descriptionEditor, href: hrefEditor }
      }];
    });
}

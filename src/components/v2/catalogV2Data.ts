import { getCollection, type CollectionEntry } from 'astro:content';

export type ProductSectionData = CollectionEntry<'product-sections'>['data'];
export type ProductCategoryData = CollectionEntry<'product-categories'>['data'];
export type ProductData = CollectionEntry<'products'>['data'];

export interface CatalogProductRoute {
  section: ProductSectionData;
  category: ProductCategoryData;
  product: ProductData;
  href: string;
}

export interface CatalogV2Snapshot {
  sections: ProductSectionData[];
  categories: ProductCategoryData[];
  products: ProductData[];
  productRoutes: CatalogProductRoute[];
}

export interface CatalogV2Links {
  sectionHref: string;
  categoryHrefs: Record<string, string>;
  productHrefs: Record<string, string>;
}

export const loadCatalogV2Snapshot = async (): Promise<CatalogV2Snapshot> => {
  const [sectionEntries, categoryEntries, productEntries] = await Promise.all([
    getCollection('product-sections'),
    getCollection('product-categories'),
    getCollection('products')
  ]);

  const sections = sectionEntries
    .map(({ data }) => data)
    .filter((item) => item.isActive)
    .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title, 'ru'));
  const categories = categoryEntries
    .map(({ data }) => data)
    .filter((item) => item.isActive)
    .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title, 'ru'));
  const products = productEntries
    .map(({ data }) => data)
    .filter((item) => item.isActive)
    .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title, 'ru'));

  const sectionsBySlug = new Map(sections.map((item) => [item.slug, item]));
  const categoriesBySlug = new Map(categories.map((item) => [item.slug, item]));
  const productRoutes = products.flatMap((product) => {
    const category = categoriesBySlug.get(product.productCategorySlug);
    const section = category ? sectionsBySlug.get(category.parentSectionSlug) : undefined;
    if (!category || !section) return [];
    return [{
      section,
      category,
      product,
      href: `/${section.slug}/${category.slug}/${product.slug}/`
    }];
  });

  return { sections, categories, products, productRoutes };
};

export const getSectionCategories = (snapshot: CatalogV2Snapshot, sectionSlug: string) =>
  snapshot.categories
    .filter((item) => item.parentSectionSlug === sectionSlug && item.showInSectionGrid !== false)
    .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title, 'ru'));

const getAllActiveSectionCategories = (snapshot: CatalogV2Snapshot, sectionSlug: string) =>
  snapshot.categories
    .filter((item) => item.parentSectionSlug === sectionSlug)
    .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title, 'ru'));

// Kept as the public compatibility name used by section routes. Visibility in the
// section grid remains controlled by the existing admin field.
export const getActiveSectionCategories = getSectionCategories;

export const getCategoryProducts = (snapshot: CatalogV2Snapshot, categorySlug: string) =>
  snapshot.products
    .filter((item) => item.productCategorySlug === categorySlug && item.showInCatalog !== false)
    .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title, 'ru'));

export const getProductRoute = (snapshot: CatalogV2Snapshot, productSlug: string) =>
  snapshot.productRoutes.find((route) => route.product.slug === productSlug);

export const catalogV2SectionHref = (sectionSlug: string) => `/design-lab/v2/${sectionSlug}/`;

export const catalogV2CategoryHref = (sectionSlug: string, categorySlug: string) =>
  `${catalogV2SectionHref(sectionSlug)}${categorySlug}/`;

export const catalogV2ProductHref = (sectionSlug: string, categorySlug: string, productSlug: string) =>
  `${catalogV2CategoryHref(sectionSlug, categorySlug)}${productSlug}/`;

export const productionCategoryHref = (sectionSlug: string, categorySlug: string) =>
  `/${sectionSlug}/${categorySlug}/`;

export const productionProductHref = (sectionSlug: string, categorySlug: string, productSlug: string) =>
  `${productionCategoryHref(sectionSlug, categorySlug)}${productSlug}/`;

export const createCatalogV2Links = (
  snapshot: CatalogV2Snapshot,
  sectionSlug: string
): CatalogV2Links => {
  // Link resolution must retain every active route, including categories deliberately
  // hidden from a section grid via showInSectionGrid.
  const sectionCategories = getAllActiveSectionCategories(snapshot, sectionSlug);
  const categorySlugs = new Set(sectionCategories.map((category) => category.slug));
  const categoryHrefs = Object.fromEntries(sectionCategories.map((category) => [
    category.slug,
    catalogV2CategoryHref(sectionSlug, category.slug)
  ]));
  const productHrefs = Object.fromEntries(snapshot.productRoutes
    .filter((route) => (
      route.section.slug === sectionSlug &&
      categorySlugs.has(route.category.slug)
    ))
    .map((route) => [
      route.product.slug,
      catalogV2ProductHref(sectionSlug, route.category.slug, route.product.slug)
    ]));

  return {
    sectionHref: catalogV2SectionHref(sectionSlug),
    categoryHrefs,
    productHrefs
  };
};

export const selectRelatedProductRoutes = (
  snapshot: CatalogV2Snapshot,
  current: CatalogProductRoute,
  limit = 4
) => {
  const visibleRoutes = snapshot.productRoutes.filter((route) => route.product.showInCatalog !== false);
  const selected = new Map<string, CatalogProductRoute>();
  const add = (route: CatalogProductRoute | undefined) => {
    if (!route || route.product.slug === current.product.slug || selected.has(route.product.slug)) return;
    selected.set(route.product.slug, route);
  };
  const manualSlugs = Array.from(new Set(
    (Array.isArray(current.product.relatedProductSlugs) ? current.product.relatedProductSlugs : [])
      .map((slug) => slug.trim())
      .filter(Boolean)
  ));

  if (manualSlugs.length > 0) {
    manualSlugs.forEach((slug) => add(visibleRoutes.find((route) => route.product.slug === slug)));
  } else {
    visibleRoutes
      .filter((route) => route.category.slug === current.category.slug)
      .sort((a, b) => a.product.order - b.product.order)
      .forEach(add);
  }

  return Array.from(selected.values()).slice(0, limit);
};

export const formatProductPrice = (product: Pick<ProductData, 'priceMode' | 'priceFrom' | 'currency'>) => {
  if ((product.priceMode === 'from' || product.priceMode === 'exact') && typeof product.priceFrom === 'number') {
    const currency = product.currency === 'RUB' ? '₽' : product.currency;
    const formatted = `${product.priceFrom.toLocaleString('ru-RU')} ${currency}`;
    return product.priceMode === 'from' ? `от ${formatted}` : formatted;
  }
  if (product.priceMode === 'on_request') return 'Цена по запросу';
  return 'Цена не указана';
};

export const imageViewStyle = (view?: { fit?: 'cover' | 'contain'; positionX?: number; positionY?: number; scale?: number }) => {
  const safe = { fit: 'cover', positionX: 50, positionY: 50, scale: 1, ...(view || {}) };
  return `object-fit:${safe.fit};object-position:${safe.positionX}% ${safe.positionY}%;transform:scale(${safe.scale});transform-origin:center;`;
};

export const cleanTextItems = (items: unknown) => {
  if (!Array.isArray(items)) return [];
  return Array.from(new Set(items
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)));
};

const catalogHelperCopyPatterns = [
  /^описание первого экрана[.!]?$/iu,
  /^описание страницы[.!]?$/iu,
  /^краткое описание(?: типа)? изделий[.!]?$/iu,
  /^заголовок блока[.!]?$/iu,
  /^текст блока[.!]?$/iu,
  /^текст[.!]?$/iu,
  /^lorem ipsum(?:[\s\S]*)$/iu,
  /^placeholder(?: text| copy)?[.!]?$/iu,
  /^dev(?:elopment)?[\s/_-]*(?:copy|text|placeholder)[.!]?$/iu,
  /^v2[\s/_-]*(?:copy|text|placeholder)[.!]?$/iu
];

/**
 * Presentation-only guard for helper copy that can remain in migrated records.
 * The source record is deliberately left untouched; empty output means that the
 * consuming component should omit the optional copy block.
 */
export const publicCatalogCopy = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const copy = value.trim();
  if (!copy) return '';
  return catalogHelperCopyPatterns.some((pattern) => pattern.test(copy)) ? '' : copy;
};

export type CatalogMediaPresentation = 'isolated' | 'contextual' | 'none';

export const catalogMediaPresentation = (
  source: string,
  view?: { fit?: 'cover' | 'contain' }
): CatalogMediaPresentation => {
  const media = source.trim();
  if (!media) return 'none';
  if (view?.fit === 'contain') return 'isolated';
  if (view?.fit === 'cover') return 'contextual';
  if (/\.(?:png|svg)(?:[?#].*)?$/iu.test(media)) return 'isolated';
  return 'contextual';
};

export const isPlaceholderCatalogMedia = (value: string) =>
  /\/assets\/images\/placeholders\//i.test(value);

const catalogGalleryPath = (item: unknown) => typeof item === 'string'
  ? item.trim()
  : item && typeof item === 'object' && 'src' in item && typeof item.src === 'string'
    ? item.src.trim()
    : '';

export const productGalleryImages = (product: ProductData) =>
  Array.from(new Set([product.image, ...(Array.isArray(product.gallery) ? product.gallery : [])]
    .map(catalogGalleryPath)
    .filter((item): item is string => Boolean(item) && !isPlaceholderCatalogMedia(item))));

export const categoryGalleryImages = (category: ProductCategoryData) => {
  const galleryImages = Array.isArray(category.gallery)
    ? category.gallery
        .map((item) => typeof item === 'string'
          ? item.trim()
          : item?.src?.trim() || '')
        .filter((item) => Boolean(item) && !isPlaceholderCatalogMedia(item))
    : [];
  const categoryImage = category.image?.trim() || '';
  const selectedImages = galleryImages.length > 0
    ? galleryImages
    : [isPlaceholderCatalogMedia(categoryImage) ? '' : categoryImage];
  return Array.from(new Set(selectedImages.filter(Boolean)));
};

export const categoryHasMedia = (category: ProductCategoryData) =>
  categoryGalleryImages(category).length > 0;

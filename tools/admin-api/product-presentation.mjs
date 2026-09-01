import { contentSchemas } from '../../src/content-schemas.mjs';

function compactObject(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

function productValidationIssues(error) {
  return (error?.issues || []).map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : '(root)',
    message: issue.message
  }));
}

export function validateProductContentForWrite(content) {
  const result = contentSchemas.products.safeParse(content);
  if (result.success) return result.data;

  const issues = productValidationIssues(result.error);
  const summary = issues
    .slice(0, 4)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ');
  const error = new Error(`Данные товара не прошли проверку${summary ? `: ${summary}` : '.'}`);
  error.code = 'PRODUCT_SCHEMA_VALIDATION_FAILED';
  error.validationIssues = issues;
  throw error;
}

export function projectProductToImportItem(product) {
  const images = [product.image, ...(Array.isArray(product.gallery) ? product.gallery : [])]
    .filter((item) => typeof item === 'string' && item.length > 0);
  const specs = Array.isArray(product.dimensions)
    ? product.dimensions.map((item) => compactObject([
      ['id', item?.id],
      ['name', item?.label],
      ['value', item?.value],
      ['order', item?.order],
      ['isActive', item?.isActive]
    ]))
    : undefined;

  return compactObject([
    ['title', product.title],
    ['slug', product.slug],
    ['productCategorySlug', product.productCategorySlug],
    ['presentationType', product.presentationType === 'premium' ? 'premium' : 'standard'],
    ['sku', product.sku],
    ['shortDescription', product.shortDescription],
    ['leadText', product.leadText],
    ['description', product.description],
    ['solutionKicker', product.solutionKicker],
    ['applicationItems', product.applicationItems],
    ['executionVariants', product.executionVariants],
    ['materials', product.materials],
    ['colors', product.colors],
    ['images', images],
    ['specs', specs],
    ['advantages', product.features],
    ['customProduction', product.customizationItems],
    ['showDelivery', product.showDeliveryBlock],
    ['deliveryText', product.deliveryText],
    ['relatedProducts', product.relatedProductSlugs],
    ['showCustomProject', product.showCustomProjectBlock],
    ['customProjectTitle', product.customProjectTitle],
    ['customProjectText', product.customProjectText],
    ['priceMode', product.priceMode],
    ['priceFrom', product.priceFrom],
    ['currency', product.currency],
    ['placeholderLabel', product.placeholderLabel],
    ['order', product.order],
    ['isActive', product.isActive],
    ['showInCatalog', product.showInCatalog],
    ['seoTitle', product.seoTitle],
    ['seoDescription', product.seoDescription]
  ]);
}

export function buildProductImportPayload(products) {
  return {
    type: 'products_import',
    version: 1,
    items: products.map(projectProductToImportItem)
  };
}

export function resolveProductImportEnvelope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Корневой объект JSON должен быть объектом.' };
  }
  if (payload.type === 'products_import') {
    return Array.isArray(payload.items)
      ? { ok: true, payload }
      : { ok: false, error: 'items отсутствует или не является массивом.' };
  }
  if (payload.type === 'catalog_export') {
    if (!payload.productImport || payload.productImport.type !== 'products_import' || !Array.isArray(payload.productImport.items)) {
      return {
        ok: false,
        error: 'Файл catalog_export не содержит совместимый productImport. Скачайте новый экспорт каталога и повторите импорт.'
      };
    }
    return { ok: true, payload: payload.productImport };
  }
  return { ok: false, error: 'type должен быть равен "products_import" или "catalog_export".' };
}

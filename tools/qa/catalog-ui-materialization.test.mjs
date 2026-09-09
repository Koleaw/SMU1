import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contentSchemas } from '../../src/content-schemas.mjs';
import { getFieldCoverage } from '../../src/admin/metadata/content-coverage-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const settings = JSON.parse(read('src/content/site-settings/global.json'));

test('catalog UI copy and the catalog shell labels live behind the strict shared schema', () => {
  assert.equal(contentSchemas['site-settings'].safeParse(settings).success, true);
  assert.equal(settings.shellLabels.defaultCtaLabel, 'Получить расчёт');
  assert.equal(settings.shellLabels.catalogRequestCtaLabel, 'Запросить расчёт');
  assert.equal(settings.catalogUi.hub.gridTitle, 'Выберите тип изделия');
  assert.equal(settings.catalogUi.category.listTitle, 'Модели и варианты');
  assert.equal(settings.catalogUi.card.productCountOne, 'изделие');
  assert.equal(settings.catalogUi.card.emptyMediaLabel, 'Изображение недоступно');
  assert.equal(settings.catalogUi.card.ctaLabel, 'Открыть категорию');
  assert.deepEqual(settings.catalogUi.sparse.materials.map(({ id }) => id), ['dimensions', 'place-photo', 'drawing']);
  assert.equal(settings.productUi.standardPriceLabel, 'Стоимость');
  assert.equal(settings.productUi.standardRelatedCategoryTitle, 'Другие изделия категории');
  assert.equal(settings.productUi.premiumDefaultSolutionKicker, 'Инженерное решение');
  assert.equal(settings.productUi.premiumTechnicalTitle, 'Материалы и конструктив');
});

test('category cards and both product renderers use schema-owned UI copy with exact occurrence bindings', () => {
  const card = read('src/components/v2/V2CategoryCard.astro');
  const standard = read('src/components/v2/CatalogStandardProductV2.astro');
  const premium = read('src/components/v2/CatalogPremiumProductV2.astro');

  assert.match(card, /settings\.catalogUi\.card/u);
  assert.match(card, /binding\(`gallery\[\$\{galleryFallbackIndex\}\]`/u);
  assert.match(card, /formula: 'category\.image when non-placeholder, otherwise first non-placeholder category\.gallery item'/u);
  assert.match(card, /catalogUiBinding\('emptyMediaLabel'\)/u);
  assert.match(card, /catalogUiBinding\('ctaLabel', 'link-label'\)/u);

  assert.match(standard, /settings\.catalogUi\.shared\.homeBreadcrumbLabel/u);
  assert.match(standard, /referenceBinding\('product-sections', section\.slug, 'title', 'breadcrumb-section'/u);
  assert.match(standard, /referenceBinding\('product-categories', category\.slug, 'title', 'hero-category-eyebrow'\)/u);
  assert.match(standard, /productUiBinding\('standardDescriptionTitle', 'heading'\)/u);
  assert.match(standard, /productUiBinding\(relatedTitleField, 'heading', 'related-title'\)/u);

  assert.match(premium, /settings\.catalogUi\.shared\.homeBreadcrumbLabel/u);
  assert.match(premium, /solutionKickerBinding = authoredSolutionKicker/u);
  assert.match(premium, /productUiBinding\('premiumDefaultSolutionKicker'/u);
  assert.match(premium, /binding\('title', 'heading', \{ stableItemId: `\$\{product\.slug\}-solution-title`/u);
  assert.match(premium, /productUiBinding\('premiumTechnicalTitle', 'heading'\)/u);

  for (const [source, literals] of [
    [card, ['Изображение недоступно', 'Открыть категорию', 'Описание без фотоматериалов']],
    [standard, ['>Стоимость<', '>О модели<', '>Технические данные<', '>Другие изделия категории<']],
    [premium, ['>Формат расчёта<', '>Что это за решение<', '>Материалы и конструктив<', '>Покрытие и цвет<']]
  ]) {
    for (const literal of literals) assert.equal(source.includes(literal), false, literal);
  }
});

test('hub, category and sparse production renderers consume catalogUi with exact admin bindings', () => {
  const hub = read('src/components/v2/CatalogSectionV2.astro');
  const category = read('src/components/v2/CatalogCategoryV2.astro');
  const sparse = read('src/components/v2/V2CatalogSparseState.astro');
  const hero = read('src/components/v2/V2CatalogHero.astro');

  for (const source of [hub, category, sparse]) {
    assert.match(source, /settings\.catalogUi/u);
    assert.match(source, /owner: \{ collection: 'site-settings', slug: 'global' \}/u);
  }
  assert.match(hub, /eyebrowBinding=\{globalBinding\('hub\.contactEyebrow'\)\}/u);
  assert.match(category, /primaryLabelBinding=\{globalBinding\(hasProducts/u);
  assert.match(sparse, /bindingField="gallery"/u);
  assert.match(sparse, /itemKind: 'object'/u);
  assert.match(sparse, /adminListItem\(Astro\.url, item\.id\)/u);
  assert.match(sparse, /adminListField\(Astro\.url, 'label'\)/u);
  assert.match(hero, /primaryLabelBinding\?: Record<string, string>/u);

  for (const literal of [
    'Полный ассортимент', 'Обсудим нужное вам изделие', 'Модели и варианты',
    'Что можно прислать для расчёта', 'Конструкцию можно рассчитать по вашим вводным.'
  ]) {
    assert.equal([hub, category, sparse].some((source) => source.includes(`>${literal}<`)), false, literal);
  }
});

test('coverage registry exposes catalog, product, shell, route SEO and vacancy SEO owner paths', () => {
  for (const [collection, fieldPath] of [
    ['site-settings', 'catalogUi.hub.gridTitle'],
    ['site-settings', 'catalogUi.card.emptyMediaLabel'],
    ['site-settings', 'catalogUi.category.contactPrimaryLabel'],
    ['site-settings', 'catalogUi.sparse.materials[].label'],
    ['site-settings', 'productUi.cardPremiumLabel'],
    ['site-settings', 'productUi.standardSpecificationsTitle'],
    ['site-settings', 'productUi.standardRelatedCategoryTitle'],
    ['site-settings', 'productUi.premiumNavApplicationsLabel'],
    ['site-settings', 'productUi.premiumTechnicalTitle'],
    ['site-settings', 'shellLabels.defaultCtaLabel'],
    ['site-settings', 'contactsPage.seoTitle'],
    ['site-settings', 'vacanciesPage.shellCtaLabel'],
    ['static-pages', 'shellCtaLabel'],
    ['jobs', 'seoTitle'],
    ['jobs', 'seoDescription']
  ]) {
    assert.ok(getFieldCoverage(collection, fieldPath), `${collection}.${fieldPath}`);
  }
});

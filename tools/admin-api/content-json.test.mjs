import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createContentJsonService, diffContent, mergeContent } from './content-json.mjs';
import { contentSchemas } from '../../src/content-schemas.mjs';

const directoryCollections = ['product-sections', 'product-categories', 'products', 'services', 'projects', 'jobs', 'static-pages'];

function project(slug, overrides = {}) {
  return {
    title: `Объект ${slug}`,
    slug,
    city: 'Курган',
    shortDescription: 'Краткое описание',
    whatWasDone: 'Выполненные работы',
    order: 10,
    isActive: true,
    year: 2025,
    seoTitle: `Объект ${slug}`,
    seoDescription: 'SEO описание',
    ...overrides
  };
}

function staticPage(slug, overrides = {}) {
  return {
    title: slug === 'home' ? 'Главная' : 'Выполненные объекты', slug,
    seoTitle: 'SEO title', seoDescription: 'SEO description', isActive: true,
    heroTitle: slug === 'home' ? 'Главная' : 'Выполненные объекты', heroDescription: '',
    ...overrides
  };
}

function product(slug, overrides = {}) {
  return {
    title: `Товар ${slug}`,
    slug,
    productCategorySlug: 'lavochki-i-skameyki',
    shortDescription: 'Краткое описание',
    leadText: 'Описание изделия',
    priceMode: 'on_request',
    priceFrom: null,
    currency: 'RUB',
    image: '/placeholder.svg',
    placeholderLabel: 'Фото',
    order: 10,
    isActive: true,
    showInCatalog: true,
    seoTitle: `Товар ${slug}`,
    seoDescription: 'SEO описание',
    ...overrides
  };
}

function productCategory(slug = 'lavochki-i-skameyki') {
  return {
    title: 'Лавочки и скамейки', slug, parentSectionSlug: 'ulichnaya-mebel', shortDescription: 'Описание',
    heroTitle: 'Лавочки и скамейки', heroDescription: 'Описание', order: 10, showInSectionGrid: true,
    isActive: true, image: '/placeholder.svg', placeholderLabel: 'Фото', mode: 'catalog-list',
    seoTitle: 'Лавочки и скамейки', seoDescription: 'Описание'
  };
}

function siteSettings() {
  return {
    companyName: 'СМУ-1', companyShortName: 'СМУ-1', inn: '1', kpp: '2', ogrn: '3',
    registrationDate: '01.01.2020', legalAddress: 'Адрес', phonePrimary: '+7', phoneSecondary: '+7',
    telegram: '@smu1', email: 'mail@example.test', city: 'Курган', address: 'Адрес',
    vacanciesEmptyTitle: 'Вакансий нет', vacanciesEmptyText: 'Следите за обновлениями'
  };
}

async function fixture(fileSystem = fs) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-json-'));
  const collections = {};
  await fs.mkdir(path.join(repoRoot, 'public'), { recursive: true });
  for (const collection of directoryCollections) {
    const collectionPath = path.join(repoRoot, 'src', 'content', collection);
    await fs.mkdir(collectionPath, { recursive: true });
    collections[collection] = { type: 'directory', path: collectionPath };
  }
  const settingsPath = path.join(repoRoot, 'src', 'content', 'site-settings', 'global.json');
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(siteSettings(), null, 2)}\n`);
  collections['site-settings'] = { type: 'single-file', path: settingsPath, slug: 'global' };
  const navigationPath = path.join(repoRoot, 'src', 'data', 'navigation.json');
  const yandexPath = path.join(repoRoot, 'src', 'data', 'yandex.json');
  await fs.mkdir(path.dirname(navigationPath), { recursive: true });
  await fs.writeFile(navigationPath, `${JSON.stringify([{ title: 'Главная', href: '/' }], null, 2)}\n`);
  await fs.writeFile(yandexPath, `${JSON.stringify({ metrika: { counterId: 1 } }, null, 2)}\n`);
  const singletons = { navigation: { path: navigationPath }, yandex: { path: yandexPath } };
  const service = createContentJsonService({ repoRoot, collections, singletons, fileSystem });
  return {
    repoRoot,
    collections,
    service,
    write: async (collection, slug, value) => fs.writeFile(path.join(collections[collection].path, `${slug}.json`), `${JSON.stringify(value, null, 2)}\n`),
    read: async (collection, slug) => JSON.parse(await fs.readFile(path.join(collections[collection].path, `${slug}.json`), 'utf8')),
    cleanup: () => fs.rm(repoRoot, { recursive: true, force: true })
  };
}

test('merge keeps omitted fields and diff reports array additions/removals', () => {
  const merged = mergeContent({ title: 'До', nested: { keep: true, value: 1 }, gallery: ['a'] }, { title: 'После', nested: { value: 2 }, gallery: ['a', 'b'] });
  assert.deepEqual(merged, { title: 'После', nested: { keep: true, value: 2 }, gallery: ['a', 'b'] });
  const diff = diffContent({ gallery: ['a', 'b'], old: true }, { gallery: ['a', 'c', 'd'] });
  assert.deepEqual(diff.changed, ['gallery[1]']);
  assert.deepEqual(diff.added, ['gallery[2]']);
  assert.deepEqual(diff.removed, ['old']);
});

test('projects schema accepts legacy and expanded cases with flexible text fields', () => {
  assert.equal(contentSchemas.projects.safeParse(project('legacy')).success, true);
  const expanded = project('expanded', {
    category: 'благоустройство',
    locationLabel: 'Курган, район Энергетики',
    workTypes: ['асфальтирование', 'ограждения'],
    scope: 'Около 300 м набережной',
    materials: ['металл', 'дерево'],
    features: 'Работы выполнялись на протяженном участке.',
    result: 'Территория получила обновленную пешеходную зону.',
    clientVisibility: 'без точного адреса'
  });
  assert.equal(contentSchemas.projects.safeParse(expanded).success, true);
  assert.equal(contentSchemas.projects.safeParse({ ...expanded, materials: 'металл', features: ['сложный рельеф'] }).success, true);
});

test('products schema defaults presentationType and validates premium presentation fields', () => {
  const standard = contentSchemas.products.parse(product('standard-default'));
  assert.equal(standard.presentationType, 'standard');

  const premium = contentSchemas.products.parse(product('premium-solution', {
    presentationType: 'premium',
    solutionKicker: 'Архитектурно-инженерное решение',
    applicationItems: ['Общественные пространства', 'Парки'],
    executionVariants: ['С подсветкой', 'С индивидуальной геометрией']
  }));
  assert.equal(premium.presentationType, 'premium');
  assert.deepEqual(premium.applicationItems, ['Общественные пространства', 'Парки']);
  assert.equal(contentSchemas.products.safeParse(product('invalid-tier', { presentationType: 'featured' })).success, false);
});

test('product presentation fields survive import/export and legacy imports persist the standard default', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await f.write('product-categories', 'lavochki-i-skameyki', productCategory());

  const premium = product('premium-roundtrip', {
    presentationType: 'premium',
    solutionKicker: 'Решение для объекта',
    applicationItems: ['Входная группа', 'Городская площадь'],
    executionVariants: ['Оцинкованный каркас', 'Порошковая окраска']
  });
  await f.write('products', premium.slug, premium);
  const premiumExport = await f.service.exportSingle('products', premium.slug);
  assert.deepEqual(premiumExport.payload, premium);
  const premiumPreview = await f.service.preview({ owner: 'admin', collection: 'products', scope: 'single', currentSlug: premium.slug, writeMode: 'merge', rawJson: JSON.stringify(premiumExport.payload) });
  assert.equal(premiumPreview.result, 'ready');
  assert.equal(premiumPreview.canApply, false);

  const legacy = product('legacy-standard', { order: 20 });
  const legacyPayload = { type: 'smu1_content_collection', version: 1, collection: 'products', items: [legacy] };
  const legacyPreview = await f.service.preview({ owner: 'admin', collection: 'products', scope: 'collection', writeMode: 'merge', rawJson: JSON.stringify(legacyPayload) });
  assert.equal(legacyPreview.result, 'ready');
  assert.equal(legacyPreview.created, 1);
  const applied = await f.service.apply({ owner: 'admin', operationId: legacyPreview.operationId });
  assert.equal(applied.result, 'success');
  assert.equal((await f.read('products', legacy.slug)).presentationType, 'standard');

  const legacyExport = await f.service.exportSingle('products', legacy.slug);
  const legacyRoundTrip = await f.service.preview({ owner: 'admin', collection: 'products', scope: 'single', currentSlug: legacy.slug, writeMode: 'merge', rawJson: JSON.stringify(legacyExport.payload) });
  assert.equal(legacyRoundTrip.result, 'ready');
  assert.equal(legacyRoundTrip.canApply, false);
});

test('single round-trip has no changes and malformed JSON is rejected with report', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await f.write('projects', 'park', project('park'));
  const exported = await f.service.exportSingle('projects', 'park');
  assert.equal(exported.filename, 'export-completed-project-park.json');
  const preview = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'single', currentSlug: 'park', writeMode: 'merge', rawJson: JSON.stringify(exported.payload) });
  assert.equal(preview.result, 'ready');
  assert.equal(preview.canApply, false);
  assert.equal(preview.rows[0].action, 'skip');
  const broken = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'single', currentSlug: 'park', writeMode: 'merge', rawJson: '{broken' });
  assert.equal(broken.result, 'invalid-json');
  assert.match(broken.reportText, /JSON не читается/);
});

test('projects collection export preserves expanded fields and re-import has no diff', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const expanded = project('full-case', {
    category: 'комплексные работы', locationLabel: 'Курган, производственная территория',
    workTypes: ['ограждения', 'лестница'], scope: 'Около 300 м', materials: ['металл', 'дерево'],
    features: 'Протяженный участок.', result: 'Территория обновлена.', clientVisibility: 'не указывать заказчика'
  });
  await f.write('projects', 'full-case', expanded);
  const exported = await f.service.exportCollection('projects');
  assert.deepEqual(exported.payload.items[0], expanded);
  const preview = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'collection', writeMode: 'merge', rawJson: JSON.stringify(exported.payload) });
  assert.equal(preview.result, 'ready');
  assert.equal(preview.rows[0].action, 'skip');
  assert.equal(preview.canApply, false);
});

test('projects import accepts legacy media objects, removes invalid entries and exact path duplicates', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const payload = {
    type: 'smu1_content_collection', version: 1, collection: 'projects',
    items: [project('mixed-gallery', {
      image: { src: '/uploads/cover.jpg', alt: 'Cover' },
      gallery: [
        '/uploads/one.jpg',
        { src: '/uploads/two.jpg', alt: 'Second', caption: 'Caption' },
        { src: '/uploads/one.jpg', alt: 'Duplicate' },
        { alt: 'Missing source' },
        42
      ]
    })]
  };
  const preview = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'collection', writeMode: 'merge', rawJson: JSON.stringify(payload) });
  assert.equal(preview.result, 'ready');
  assert.equal(preview.created, 1);
  assert.ok(preview.warnings.some((warning) => warning.includes('image')));
  assert.ok(preview.warnings.some((warning) => warning.includes('gallery[2]')));
  assert.ok(preview.warnings.some((warning) => warning.includes('gallery[3]')));
  const applied = await f.service.apply({ owner: 'admin', operationId: preview.operationId });
  assert.equal(applied.result, 'success');
  const stored = await f.read('projects', 'mixed-gallery');
  assert.equal(stored.image, '/uploads/cover.jpg');
  assert.deepEqual(stored.gallery, [
    '/uploads/one.jpg',
    { src: '/uploads/two.jpg', alt: 'Second', caption: 'Caption' }
  ]);
  const exported = await f.service.exportSingle('projects', 'mixed-gallery');
  const roundTrip = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'single', currentSlug: 'mixed-gallery', writeMode: 'merge', rawJson: JSON.stringify(exported.payload) });
  assert.equal(roundTrip.result, 'ready');
  assert.equal(roundTrip.canApply, false);
});

test('merge import with a non-array gallery warns and preserves the stored gallery', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await f.write('projects', 'keep-gallery', project('keep-gallery', { gallery: ['/uploads/keep.jpg'] }));
  const incoming = project('keep-gallery', { gallery: 'not-an-array', title: 'Updated title' });
  const preview = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'single', currentSlug: 'keep-gallery', writeMode: 'merge', rawJson: JSON.stringify(incoming) });
  assert.equal(preview.result, 'ready');
  assert.ok(preview.warnings.some((warning) => warning.includes('ожидается массив')));
  const result = await f.service.apply({ owner: 'admin', operationId: preview.operationId });
  assert.equal(result.result, 'success');
  const stored = await f.read('projects', 'keep-gallery');
  assert.equal(stored.title, 'Updated title');
  assert.deepEqual(stored.gallery, ['/uploads/keep.jpg']);
});

test('completed projects page bundle contains page data and every project field', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await f.write('static-pages', 'vypolnennye-obekty', staticPage('vypolnennye-obekty'));
  const expanded = project('case-one', {
    category: 'Благоустройство', locationLabel: 'Курган, центр', workTypes: ['монтаж'],
    scope: '300 м', materials: ['сталь'], features: ['сложный рельеф'], result: 'Готово', clientVisibility: 'без адреса'
  });
  await f.write('projects', expanded.slug, expanded);
  const exported = await f.service.exportPage('static-pages', 'vypolnennye-obekty');
  assert.equal(exported.payload.type, 'smu1_page_bundle');
  assert.equal(exported.payload.page.kind, 'completed-projects-index');
  assert.deepEqual(exported.payload.related.collections.projects.items[0], expanded);
  const preview = await f.service.preview({ owner: 'admin', collection: 'static-pages', scope: 'page-bundle', currentSlug: 'vypolnennye-obekty', writeMode: 'merge', rawJson: JSON.stringify(exported.payload) });
  assert.equal(preview.result, 'ready');
  assert.equal(preview.canApply, false);
});

test('full site export includes the registry and round-trips without changes', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await f.write('static-pages', 'home', staticPage('home'));
  await f.write('projects', 'legacy', project('legacy'));
  const exported = await f.service.exportFullSite();
  assert.equal(exported.payload.type, 'smu1_full_site_export');
  assert.deepEqual(Object.keys(exported.payload.collections), ['static-pages', 'services', 'product-sections', 'product-categories', 'products', 'projects', 'jobs']);
  assert.deepEqual(Object.keys(exported.payload.singletons), ['site-settings', 'navigation', 'yandex']);
  const preview = await f.service.preview({ owner: 'admin', scope: 'full-site', writeMode: 'merge', rawJson: JSON.stringify(exported.payload) });
  assert.equal(preview.result, 'ready');
  assert.equal(preview.canApply, false);
  assert.equal(preview.updated, 0);
});

test('full site preview validates new parent and child records against projected state', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const exported = await f.service.exportFullSite();
  exported.payload.collections['product-sections'].items.push({
    title: 'Раздел', slug: 'new-section', shortDescription: 'Описание', heroTitle: 'Раздел', heroDescription: 'Описание',
    order: 10, showOnHome: false, isActive: true, mode: 'catalog-hub', image: '/placeholder.svg',
    placeholderLabel: 'Фото', seoTitle: 'Раздел', seoDescription: 'Описание'
  });
  exported.payload.collections['product-categories'].items.push({
    title: 'Категория', slug: 'new-category', parentSectionSlug: 'new-section', shortDescription: 'Описание',
    heroTitle: 'Категория', heroDescription: 'Описание', order: 10, showInSectionGrid: true, isActive: true,
    image: '/placeholder.svg', placeholderLabel: 'Фото', mode: 'catalog-list', seoTitle: 'Категория', seoDescription: 'Описание'
  });
  exported.payload.collections.products.items.push({
    title: 'Товар', slug: 'new-product', productCategorySlug: 'new-category', shortDescription: 'Описание', leadText: 'Описание',
    priceMode: 'on_request', priceFrom: null, currency: 'RUB', image: '/placeholder.svg', placeholderLabel: 'Фото',
    order: 10, isActive: true, showInCatalog: true, seoTitle: 'Товар', seoDescription: 'Описание'
  });
  const preview = await f.service.preview({ owner: 'admin', scope: 'full-site', writeMode: 'merge', rawJson: JSON.stringify(exported.payload) });
  assert.equal(preview.result, 'ready');
  assert.equal(preview.created, 3);
  assert.equal(preview.errors.length, 0);
});

test('page bundle creates a project without deleting omitted projects', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await f.write('static-pages', 'vypolnennye-obekty', staticPage('vypolnennye-obekty'));
  await f.write('projects', 'keep', project('keep'));
  const exported = await f.service.exportPage('static-pages', 'vypolnennye-obekty');
  exported.payload.related.collections.projects.items = [project('created')];
  const preview = await f.service.preview({ owner: 'admin', collection: 'static-pages', scope: 'page-bundle', currentSlug: 'vypolnennye-obekty', writeMode: 'merge', rawJson: JSON.stringify(exported.payload) });
  assert.equal(preview.created, 1);
  const result = await f.service.apply({ owner: 'admin', operationId: preview.operationId });
  assert.equal(result.result, 'success');
  assert.equal((await f.read('projects', 'created')).slug, 'created');
  assert.equal((await f.read('projects', 'keep')).slug, 'keep');
});

test('collection import updates and creates without deleting omitted entries', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await f.write('projects', 'keep', project('keep'));
  await f.write('projects', 'update', project('update', { title: 'Старое' }));
  const payload = {
    type: 'smu1_content_collection', version: 1, collection: 'projects', exportedAt: new Date().toISOString(),
    items: [project('update', { title: 'Новое' }), project('created', { order: 20 })]
  };
  const preview = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'collection', writeMode: 'merge', rawJson: JSON.stringify(payload) });
  assert.equal(preview.result, 'ready');
  assert.equal(preview.created, 1);
  assert.equal(preview.updated, 1);
  const result = await f.service.apply({ owner: 'admin', operationId: preview.operationId });
  assert.equal(result.result, 'success');
  assert.equal((await f.read('projects', 'update')).title, 'Новое');
  assert.equal((await f.read('projects', 'created')).slug, 'created');
  assert.equal((await f.read('projects', 'keep')).slug, 'keep');
});

test('replace requires confirmation and removes omitted optional fields', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await f.write('projects', 'replace', project('replace', { region: 'Курганская область' }));
  const preview = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'single', currentSlug: 'replace', writeMode: 'replace', rawJson: JSON.stringify(project('replace')) });
  assert.ok(preview.rows[0].removed.includes('region'));
  const denied = await f.service.apply({ owner: 'admin', operationId: preview.operationId });
  assert.equal(denied.result, 'error');
  const result = await f.service.apply({ owner: 'admin', operationId: preview.operationId, replaceConfirmed: true });
  assert.equal(result.result, 'success');
  assert.equal('region' in await f.read('projects', 'replace'), false);
});

test('failed collection write rolls all files back', async (t) => {
  let copyCount = 0;
  const failingFs = {
    access: fs.access, copyFile: async (...args) => {
      copyCount += 1;
      if (copyCount === 2) throw new Error('simulated write failure');
      return fs.copyFile(...args);
    },
    mkdir: fs.mkdir, readFile: fs.readFile, readdir: fs.readdir, unlink: fs.unlink, writeFile: fs.writeFile
  };
  const f = await fixture(failingFs);
  t.after(f.cleanup);
  await f.write('projects', 'first', project('first', { title: 'Первый до' }));
  await f.write('projects', 'second', project('second', { title: 'Второй до' }));
  const payload = { type: 'smu1_content_collection', version: 1, collection: 'projects', items: [project('first', { title: 'Первый после' }), project('second', { title: 'Второй после' })] };
  const preview = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'collection', writeMode: 'merge', rawJson: JSON.stringify(payload) });
  const result = await f.service.apply({ owner: 'admin', operationId: preview.operationId });
  assert.equal(result.result, 'rolled-back');
  assert.equal((await f.read('projects', 'first')).title, 'Первый до');
  assert.equal((await f.read('projects', 'second')).title, 'Второй до');
});

test('media validation warns for missing public files and blocks traversal', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const payload = { type: 'smu1_content_collection', version: 1, collection: 'projects', items: [project('media', { image: '/uploads/missing.jpg' })] };
  const preview = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'collection', writeMode: 'merge', rawJson: JSON.stringify(payload) });
  assert.equal(preview.result, 'ready');
  assert.match(preview.warnings[0], /не найден/);
  payload.items[0].image = '../outside.jpg';
  const blocked = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'collection', writeMode: 'merge', rawJson: JSON.stringify(payload) });
  assert.equal(blocked.result, 'validation-error');
  assert.match(blocked.errors.join('\n'), /переходы \.\./);
  payload.items[0].image = 'data:image/png;base64,AAAA';
  const base64 = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'collection', writeMode: 'merge', rawJson: JSON.stringify(payload) });
  assert.equal(base64.result, 'validation-error');
  assert.match(base64.errors.join('\n'), /base64 запрещён/);
});

test('apply rejects a stale preview without overwriting newer content', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  await f.write('projects', 'stale', project('stale', { title: 'До' }));
  const preview = await f.service.preview({ owner: 'admin', collection: 'projects', scope: 'single', currentSlug: 'stale', writeMode: 'merge', rawJson: JSON.stringify(project('stale', { title: 'Импорт' })) });
  await f.write('projects', 'stale', project('stale', { title: 'Новая ручная правка' }));
  const result = await f.service.apply({ owner: 'admin', operationId: preview.operationId });
  assert.equal(result.result, 'rolled-back');
  assert.match(result.errors[0], /изменился после preview/);
  assert.equal((await f.read('projects', 'stale')).title, 'Новая ручная правка');
});

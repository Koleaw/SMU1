import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveAstroCli } from '../admin-api/astro-cli.mjs';
import { createParentBoundNodeArgs } from '../admin-api/launcher.mjs';
import { createAdminRepoIdentity } from '../admin-api/runtime-identity.mjs';
import { CdpBrowser } from './cdp-browser.mjs';

import {
  hasNewlyVisibleBindingRows,
  liveProductBindingId,
  liveSectionBindingId,
  moveRelationValue,
  reconcileCanvasBindingCandidate,
  relationStructuralHeaderFields,
  relationCandidatesForBinding,
  relationTargetCollections,
  resolveCatalogCardMaterialProjection,
  resolveDirectionRelatedCanvasProjection,
  resolveProductRelationsCanvasProjection,
  synchronizeIndexedRelationBindingState
} from '../../src/admin/shell/visual-editor-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const stopChild = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000)
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
};

test('page-first relation registry resolves only declared target collections', () => {
  const selectBinding = { relationCollection: 'projects', relationCollections: ['projects', 'unknown'] };
  const listBinding = { relationCollections: ['product-sections', 'services', 'services'] };

  assert.deepEqual(relationTargetCollections(selectBinding), ['projects']);
  assert.deepEqual(relationTargetCollections(listBinding), ['product-sections', 'services']);
  assert.deepEqual(relationTargetCollections({}), []);
});

test('relation candidates are titled schema records, preserve a selected hidden record, and expose ambiguous slugs', () => {
  const summaries = new Map([
    ['product-sections', [
      { slug: 'street', title: 'Уличная мебель', isActive: true },
      { slug: 'hidden', title: 'Скрытый раздел', isActive: false },
      { slug: 'shared', title: 'Раздель', isActive: true }
    ]],
    ['services', [
      { slug: 'repair', title: 'Ремонт', isActive: true },
      { slug: 'shared', title: 'Услуга', isActive: true }
    ]]
  ]);
  const binding = { relationCollections: ['product-sections', 'services'] };

  const regular = relationCandidatesForBinding(binding, summaries);
  assert.deepEqual(regular.filter((entry) => !entry.ambiguous).map((entry) => entry.slug), ['repair', 'street']);
  assert.equal(regular.some((entry) => entry.slug === 'hidden'), false);
  assert.equal(regular.filter((entry) => entry.slug === 'shared').every((entry) => entry.ambiguous), true);

  const withSelectedHidden = relationCandidatesForBinding(binding, summaries, { currentSlugs: ['hidden'] });
  assert.deepEqual(withSelectedHidden.find((entry) => entry.slug === 'hidden'), {
    collection: 'product-sections',
    slug: 'hidden',
    title: 'Скрытый раздел',
    typeLabel: 'Раздел каталога',
    isActive: false,
    ambiguous: false
  });
});

test('relation ordering is immutable and deterministic for buttons', () => {
  const source = ['one', 'two', 'three', 'four'];
  assert.deepEqual(moveRelationValue(source, 2, 'start'), ['three', 'one', 'two', 'four']);
  assert.deepEqual(moveRelationValue(source, 1, 'end'), ['one', 'three', 'four', 'two']);
  assert.deepEqual(moveRelationValue(source, 2, -1), ['one', 'three', 'two', 'four']);
  assert.deepEqual(moveRelationValue(source, 1, 1), ['one', 'three', 'two', 'four']);
  assert.deepEqual(source, ['one', 'two', 'three', 'four']);
});

test('visual inspector dispatches relation tools before generic array/text controls', () => {
  const source = read('src/admin/shell/visual-editor-app.mjs');
  const styles = read('src/admin/styles/visual-editor.css');
  const selectDispatch = source.indexOf("else if (binding.tool === 'relation-select') renderRelationSelectInspector(record, binding)");
  const listDispatch = source.indexOf("else if (binding.tool === 'relation-list') renderRelationListInspector(record, binding)");
  const genericDispatch = source.indexOf("else if (binding.tool === 'list' || Array.isArray(value)) renderListInspector(record, binding)");

  assert.ok(selectDispatch > 0);
  assert.ok(listDispatch > selectDispatch);
  assert.ok(genericDispatch > listDispatch);
  assert.match(source, /fieldset\.dataset\.relationTool = 'relation-select'/u);
  assert.match(source, /relationChooser\([\s\S]*relationTool: 'relation-list'/u);
  assert.match(source, /slug не вводится вручную/u);
  assert.match(styles, /\[data-relation-tool="relation-list"\] \.ve-relation-row \{ grid-template-columns: minmax\(0, 1fr\) repeat\(5, 28px\); \}/u);
});

test('every current visual relation binding declares its target collection', () => {
  const bindingSource = read('src/admin/bindings/adminBinding.ts');
  const company = read('src/components/v2/practical/V2CompanyPage.astro');
  const customOrder = read('src/components/v2/custom-order/CustomOrderV2Page.astro');
  const gateway = read('src/components/v2/projects/V2ProjectArchiveGateway.astro');
  const standardProduct = read('src/components/v2/CatalogStandardProductV2.astro');
  const premiumProduct = read('src/components/v2/CatalogPremiumProductV2.astro');
  const projectDetail = read('src/components/v2/projects/V2ProjectDetail.astro');
  const directionPresentation = read('src/components/v2/directions/directionPresentation.ts');
  const directionRelated = read('src/components/v2/directions/DirectionV2Related.astro');

  assert.match(bindingSource, /relationCollection\?: string/u);
  assert.match(bindingSource, /relationCollections\?: string\[\]/u);
  assert.match(company, /companyHeroProjectSlug'[\s\S]*relationCollection: 'projects'/u);
  assert.match(company, /label: 'Объект-источник фотографии'/u);
  assert.match(customOrder, /customOrderHeroProjectSlug'[\s\S]*relationCollection: 'projects'/u);
  assert.match(customOrder, /relatedDirectionSlugs'[\s\S]*relationCollections: \['product-sections', 'services'\]/u);
  assert.match(customOrder, /label: 'Связанные направления и их порядок'/u);
  assert.match(gateway, /tool: 'relation-list',[\s\S]*relationCollections: \['projects'\]/u);
  assert.match(gateway, /label: 'Объекты и их порядок'/u);
  assert.match(standardProduct, /relatedProductSlugs', 'relation-list',[\s\S]*relationCollections: \['products'\]/u);
  assert.match(premiumProduct, /relatedProductSlugs', 'relation-list',[\s\S]*relationCollections: \['products'\]/u);
  assert.match(projectDetail, /presentation\.relatedDirections', 'project-direction-relations',[\s\S]*relationCollections: \['product-sections', 'services'\]/u);
  assert.match(directionPresentation, /'related\.items',[\s\S]*'direction-related-relations',[\s\S]*relationCollections: \['product-sections', 'product-categories', 'services'\]/u);
  assert.match(directionRelated, /\{\.\.\.Astro\.props\.relationsBinding\}/u);
});

test('structured project directions open their dedicated relation inspector and keep renderer DOM', () => {
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  const projection = read('src/admin/state/binding-projection.mjs');
  assert.match(editor, /binding\.tool === 'project-direction-relations'\) await renderProjectDirectionRelationsInspector\(record\)/u);
  assert.match(editor, /chooser\.dataset\.relationTool = 'project-direction-relations'/u);
  assert.match(editor, /Название связанного направления/u);
  assert.match(editor, /Подпись связанного направления/u);
  assert.match(editor, /updateCopy\('label', labelInput\.value\)/u);
  assert.match(editor, /updateCopy\('context', contextInput\.value\)/u);
  assert.match(editor, /__smu1ProjectDirectionProjection: true/u);
  assert.deepEqual(relationStructuralHeaderFields('project-direction-relations').map(({ owner, path, scope }) => ({ owner, path, scope })), [
    { owner: 'site-settings:global', path: 'projectUi.detailDirectionsEyebrow', scope: 'global' },
    { owner: 'site-settings:global', path: 'projectUi.detailDirectionsTitle', scope: 'global' }
  ]);
  assert.match(editor, /влияет на заголовок блока на всех страницах выполненных объектов/u);
  const layout = read('src/layouts/PublicV2Layout.astro');
  assert.match(layout, /value\.__smu1ProjectDirectionProjection === true/u);
  assert.match(layout, /grid\.replaceChildren\(\.\.\.rows\)/u);
  assert.match(layout, /__smu1DetachedProjectDirectionsHost/u);
  for (const tool of ['relation-select', 'relation-list', 'project-direction-relations', 'direction-related-relations', 'reorder-item']) {
    assert.match(projection, new RegExp(`'${tool}'`, 'u'));
  }
});

test('direction related cards expose their typed contextual relation chooser', () => {
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  const helper = read('src/components/v2/directions/directionPresentation.ts');
  const pages = [
    'CanopiesV2Page.astro',
    'ConstructionV2Page.astro',
    'LandscapingV2Page.astro',
    'MetalworksV2Page.astro',
    'TopiaryV2Page.astro'
  ].map((filename) => read(`src/components/v2/pages/${filename}`));
  assert.match(editor, /binding\.tool === 'direction-related-relations'\) renderDirectionRelatedRelationsInspector\(record\)/u);
  assert.match(editor, /directionRelatedChooser\(record, directionRelatedCandidates\(record\)\)/u);
  assert.deepEqual(relationStructuralHeaderFields('direction-related-relations').map(({ owner, path, scope }) => ({ owner, path, scope })), [
    { owner: 'current', path: 'directionPresentation.related.eyebrow', scope: 'local' },
    { owner: 'current', path: 'directionPresentation.related.title', scope: 'local' }
  ]);
  assert.match(helper, /export function directionRelatedRelationsBinding/u);
  pages.forEach((source) => assert.match(source, /relationsBinding=\{directionRelatedRelationsBinding\(Astro\.url, owner, route\)\}/u));
});

test('dormant bindings becoming visible trigger one fresh draft projection even when registry size is unchanged', () => {
  const row = (bindingId) => ({ binding: { bindingId } });
  assert.equal(hasNewlyVisibleBindingRows([row('root')], [row('root')]), false);
  assert.equal(hasNewlyVisibleBindingRows([row('root')], [row('root'), row('restored-child')]), true);
  assert.equal(hasNewlyVisibleBindingRows([row('root'), row('restored-child')], [row('root')]), false);
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  assert.match(editor, /state\.bindingRegistry\.size > registrySize \|\| hasNewlyVisibleBinding/u);
});

test('direction related structural draft resolves renderer-safe items and target dependencies', () => {
  const pages = [
    { collection: 'product-sections', slug: 'street', title: 'Уличная мебель', route: '/street/' },
    { collection: 'services', slug: 'repair', title: 'Ремонт из summary', route: '/repair/' }
  ];
  const loaded = new Map([
    ['services:repair', { title: 'Строительство и ремонт', shortDescription: 'Точный текст из draft.' }],
    ['product-sections:street', { title: 'Уличная мебель', isActive: true }]
  ]);
  const result = resolveDirectionRelatedCanvasProjection({
    items: [
      { id: 'repair', targetCollection: 'services', targetSlug: 'repair', eyebrow: 'Услуга', order: 20, isActive: true },
      { id: 'street', targetCollection: 'product-sections', targetSlug: 'street', title: 'Локальный заголовок', description: '', order: 10, isActive: true },
      { id: 'hidden', targetCollection: 'services', targetSlug: 'repair', order: 30, isActive: false },
      { id: 'unsafe', targetCollection: 'unknown', targetSlug: 'bad', order: 40, isActive: true }
    ],
    pages,
    readRecordContent: (collection, slug) => loaded.get(`${collection}:${slug}`),
    siteBase: '/SMU1'
  });

  assert.deepEqual(result.value, {
    __smu1DirectionRelatedProjection: true,
    eyebrow: 'Дальше по задаче',
    title: 'Связанные направления',
    items: [
      {
        id: 'street', targetCollection: 'product-sections', targetSlug: 'street', eyebrow: '',
        title: 'Локальный заголовок', titleSource: 'local', description: '', descriptionSource: 'local',
        href: '/SMU1/street/', order: 10, sourceIndex: 1
      },
      {
        id: 'repair', targetCollection: 'services', targetSlug: 'repair', eyebrow: 'Услуга',
        title: 'Строительство и ремонт', titleSource: 'inherited',
        description: 'Точный текст из draft.', descriptionSource: 'inherited', href: '/SMU1/repair/', order: 20, sourceIndex: 0
      }
    ]
  });
  assert.deepEqual(result.dependencies, []);
  assert.equal(result.complete, true);
});

test('canvas binding reconciliation preserves trusted metadata and only retargets authoritative indexed items', () => {
  const registered = {
    bindingId: 'binding:direction-title', route: '/direction/',
    renderer: { family: 'direction', variant: 'service', version: 'h6-v1' },
    owner: { collection: 'services', slug: 'direction' }, ownerCollection: 'services', recordSlug: 'direction',
    fieldPath: 'directionPresentation.related.items[0].title',
    stableItemId: 'direction-second-related-title', role: 'heading', scope: 'local', tool: 'inline-text',
    permissions: { edit: true, reorder: false }, projection: { kind: 'direct' }, affectedRoutes: ['/direction/'],
    currentDraftRevision: 1
  };
  const candidate = {
    ...structuredClone(registered), fieldPath: 'directionPresentation.related.items[1].title',
    permissions: { edit: true, reorder: true, delete: true }, projection: { kind: 'forged' },
    currentDraftRevision: 2
  };
  const accepted = reconcileCanvasBindingCandidate({
    candidate, registered, frameRevision: 2, currentRoute: '/direction/',
    readRecordContent: () => ({
      directionPresentation: { related: { items: [
        { id: 'first', title: 'Первый' }, { id: 'second', title: 'Второй' }
      ] } }
    })
  });
  assert.equal(accepted.fieldPath, candidate.fieldPath);
  assert.deepEqual(accepted.permissions, registered.permissions);
  assert.deepEqual(accepted.projection, registered.projection);
  assert.deepEqual(accepted.affectedRoutes, registered.affectedRoutes);
  assert.equal(accepted.currentDraftRevision, 2);
  assert.equal(reconcileCanvasBindingCandidate({
    candidate: { ...candidate, stableItemId: 'direction-first-related-title' },
    registered, frameRevision: 2,
    readRecordContent: () => ({ directionPresentation: { related: { items: [{ id: 'first' }, { id: 'second' }] } } })
  }), null);
});

test('parent indexed registry retargets rows and removes stale overlays before frame geometry', () => {
  const first = {
    bindingId: 'binding:first-title', ownerCollection: 'services', recordSlug: 'direction',
    fieldPath: 'directionPresentation.related.items[0].title',
    stableItemId: 'direction-first-related-title'
  };
  const second = {
    bindingId: 'binding:second-title', ownerCollection: 'services', recordSlug: 'direction',
    fieldPath: 'directionPresentation.related.items[1].title',
    stableItemId: 'direction-second-related-title'
  };
  const synchronized = synchronizeIndexedRelationBindingState({
    registry: new Map([[first.bindingId, first], [second.bindingId, second]]),
    rows: [{ binding: first, rect: {} }, { binding: second, rect: {} }],
    currentBinding: { binding: first, rect: {}, record: {} },
    readRecordContent: () => ({ directionPresentation: { related: { items: [{ id: 'second' }] } } })
  });
  assert.deepEqual(synchronized.rows.map((row) => row.binding.bindingId), [second.bindingId]);
  assert.equal(synchronized.registry.get(second.bindingId).fieldPath, 'directionPresentation.related.items[0].title');
  assert.equal(synchronized.currentBinding, null);
  assert.deepEqual([...synchronized.dormantIds], [first.bindingId]);
});

test('product relation projection is typed, dependency-aware, and deterministic', () => {
  const pages = [
    { collection: 'products', slug: 'current', parentSlug: 'benches', route: '/street/benches/current/', entry: { order: 10 } },
    { collection: 'products', slug: 'second', parentSlug: 'benches', route: '/street/benches/second/', entry: { order: 30 } },
    { collection: 'products', slug: 'first', parentSlug: 'benches', route: '/street/benches/first/', entry: { order: 20 } },
    { collection: 'products', slug: 'hidden', parentSlug: 'benches', route: '/street/benches/hidden/', isActive: false, entry: { order: 5 } },
    { collection: 'products', slug: 'catalog-hidden', parentSlug: 'benches', route: '/street/benches/catalog-hidden/', entry: { order: 4, summary: { showInCatalog: false } } },
    { collection: 'products', slug: 'draft-hidden', parentSlug: 'benches', route: '/street/benches/draft-hidden/', entry: { order: 40 } },
    { collection: 'products', slug: 'inactive-loaded', parentSlug: 'benches', route: '/street/benches/inactive-loaded/', entry: { order: 41 } }
  ];
  const records = new Map([
    ['products:first', {
      title: 'Первая скамья', shortDescription: 'Первое описание', materials: ['Сталь'],
      priceMode: 'from', priceFrom: 12500, currency: 'RUB', presentationType: 'premium',
      image: '/uploads/first.jpg', gallery: ['/uploads/second.jpg'], imageView: { positionX: 42, positionY: 61, scale: 1.2 }
    }],
    ['products:second', {
      title: 'Вторая скамья', shortDescription: 'Второе описание', materials: [],
      priceMode: 'on_request', currency: 'RUB', presentationType: 'standard',
      image: { url: '/uploads/must-not-be-used.jpg' }, gallery: ['/assets/images/placeholders/product.svg']
    }],
    ['products:hidden', { title: 'Скрыт', isActive: false, showInCatalog: true }],
    ['products:catalog-hidden', { title: 'Скрыт из каталога', isActive: true, showInCatalog: false }],
    ['products:draft-hidden', { title: 'Скрыт в draft', showInCatalog: false }],
    ['products:inactive-loaded', { title: 'Неактивен в draft', isActive: false, showInCatalog: true }]
  ]);
  const manual = resolveProductRelationsCanvasProjection({
    relatedProductSlugs: ['second', 'first', 'second', '../unsafe', 'hidden', 'catalog-hidden', 'draft-hidden', 'inactive-loaded'],
    currentProductSlug: 'current',
    currentCategorySlug: 'benches',
    pages,
    readRecordContent: (collection, slug) => records.get(`${collection}:${slug}`),
    resolveMedia: (_collection, slug, value) => `/api/media/${slug}${value}`,
    siteBase: '/SMU1'
  });
  assert.equal(manual.complete, true);
  assert.equal(manual.explicit, true);
  assert.deepEqual(manual.dependencies, []);
  assert.deepEqual(manual.value.items.map((item) => item.slug), ['second', 'first']);
  assert.equal(manual.value.items[0].price, 'Цена по запросу');
  assert.equal(manual.value.items[0].image, null);
  assert.equal(manual.value.items[1].price, 'от 12 500 ₽');
  assert.equal(manual.value.items[1].href, '/SMU1/street/benches/first/');
  assert.equal(manual.value.items[1].image, '/api/media/first/uploads/first.jpg');
  assert.deepEqual(manual.value.items[1].imageView, { positionX: 42, positionY: 61, scale: 1.2 });

  const pending = resolveProductRelationsCanvasProjection({
    relatedProductSlugs: [], currentProductSlug: 'current', currentCategorySlug: 'benches', pages,
    readRecordContent: (_collection, slug) => slug === 'second' ? undefined : records.get(`products:${slug}`)
  });
  assert.equal(pending.explicit, false);
  assert.equal(pending.complete, false);
  assert.deepEqual(pending.value.items.map((item) => item.slug), ['first']);
  assert.deepEqual(pending.dependencies, [{ collection: 'products', slug: 'second' }]);

  const inverseVisibility = resolveProductRelationsCanvasProjection({
    relatedProductSlugs: ['saved-hidden'], currentProductSlug: 'current', currentCategorySlug: 'benches',
    pages: [{
      collection: 'products', slug: 'saved-hidden', route: '/street/benches/saved-hidden/',
      parentSlug: 'benches', emitted: false, isActive: false, entry: { showInCatalog: false }
    }],
    readRecordContent: () => ({
      title: 'Возвращён в draft', isActive: true, showInCatalog: true,
      productCategorySlug: 'benches', shortDescription: 'Текст'
    })
  });
  assert.equal(inverseVisibility.complete, true);
  assert.deepEqual(inverseVisibility.value.items.map((item) => item.slug), ['saved-hidden']);

  const invalidExplicit = resolveProductRelationsCanvasProjection({
    relatedProductSlugs: ['current', '../unsafe', 'unknown'],
    currentProductSlug: 'current', currentCategorySlug: 'benches', pages,
    readRecordContent: (collection, slug) => records.get(`${collection}:${slug}`)
  });
  assert.equal(invalidExplicit.explicit, true);
  assert.deepEqual(invalidExplicit.value.items, []);

  const helperCopy = resolveProductRelationsCanvasProjection({
    relatedProductSlugs: ['first'], currentProductSlug: 'current', currentCategorySlug: 'benches', pages,
    readRecordContent: (_collection, slug) => slug === 'first'
      ? { ...records.get('products:first'), shortDescription: 'Текст' }
      : undefined
  });
  assert.equal(helperCopy.value.items[0].description, '');

  const closurePages = [
    { collection: 'products', slug: 'child', parentSlug: 'hidden-category', route: '/section/hidden-category/child/' },
    { collection: 'product-categories', slug: 'hidden-category', parentSlug: 'section', route: '/section/hidden-category/' },
    { collection: 'product-sections', slug: 'section', route: '/section/' }
  ];
  const closureRecords = new Map([
    ['products:child', { title: 'Товар', productCategorySlug: 'hidden-category', isActive: true, showInCatalog: true }],
    ['product-categories:hidden-category', { parentSectionSlug: 'section', isActive: false }],
    ['product-sections:section', { isActive: true }]
  ]);
  const hiddenParent = resolveProductRelationsCanvasProjection({
    relatedProductSlugs: ['child'], currentProductSlug: 'current', currentCategorySlug: 'current-category',
    pages: closurePages, readRecordContent: (collection, slug) => closureRecords.get(`${collection}:${slug}`)
  });
  assert.equal(hiddenParent.complete, true);
  assert.deepEqual(hiddenParent.value.items, []);
  closureRecords.set('product-categories:hidden-category', { parentSectionSlug: 'section', isActive: true });
  assert.deepEqual(resolveProductRelationsCanvasProjection({
    relatedProductSlugs: ['child'], currentProductSlug: 'current', currentCategorySlug: 'current-category',
    pages: closurePages, readRecordContent: (collection, slug) => closureRecords.get(`${collection}:${slug}`)
  }).value.items.map((item) => item.slug), ['child']);
});

test('catalog-card material projection selects a scalar and waits for the global fallback', () => {
  assert.deepEqual(resolveCatalogCardMaterialProjection({ materials: ['', '  Сталь  ', 'Дерево'] }, undefined), {
    status: 'value', value: 'Сталь', dependencies: []
  });
  assert.deepEqual(resolveCatalogCardMaterialProjection({ materials: [] }, undefined), {
    status: 'pending', dependencies: [{ collection: 'site-settings', slug: 'global' }]
  });
  assert.deepEqual(resolveCatalogCardMaterialProjection({ materials: [] }, {
    productUi: { cardMaterialsMissingLabel: 'Уточните материал' }
  }), { status: 'value', value: 'Уточните материал', dependencies: [] });
});

test('direction related live projection rebuilds production-shaped DOM without HTML injection', () => {
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  const component = read('src/components/v2/directions/DirectionV2Related.astro');
  const layout = read('src/layouts/PublicV2Layout.astro');
  assert.match(editor, /row\.binding\.tool === 'direction-related-relations'[\s\S]*resolveDirectionRelatedCanvasProjection/u);
  assert.match(editor, /dependencies\.push\(\.\.\.directionResolution\.dependencies\)/u);
  assert.match(layout, /value\.__smu1DirectionRelatedProjection === true/u);
  assert.match(layout, /allowedCollections = new Set\(\['product-sections', 'product-categories', 'services'\]\)/u);
  assert.match(layout, /node\('a', 'direction-related__card'\)/u);
  assert.match(layout, /node\('ul', 'direction-related__links'\)/u);
  assert.match(layout, /grid\.__smu1DirectionRelatedRows instanceof Map/u);
  assert.match(layout, /links\.__smu1DirectionRelatedRows instanceof Map/u);
  assert.match(layout, /const existingCard = currentById\.get\(item\.id\)/u);
  assert.match(layout, /const existingRow = currentById\.get\(item\.id\)/u);
  assert.match(layout, /if \(element !== section\) element\.replaceWith\(section\)/u);
  assert.match(layout, /element\.replaceWith\(affordance\)/u);
  assert.match(component, /editorCanvas && \(\s*<button[\s\S]*empty-direction-related/u);
});

test('direction related browser projection preserves child binding identity through reorder and empty recovery', { timeout: 120_000 }, async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const astroCli = await resolveAstroCli(ROOT);
  const { CODEX_CI: _codexCi, ...foregroundEnvironment } = process.env;
  const renderer = spawn(process.execPath, createParentBoundNodeArgs(astroCli, [
    'dev', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)
  ]), {
    cwd: ROOT,
    env: {
      ...foregroundEnvironment,
      CI: 'false',
      ASTRO_TELEMETRY_DISABLED: '1',
      ASTRO_DEV_BACKGROUND: 'foreground-parent-bound',
      BASE_PATH: '/',
      DEPLOY_TARGET: 'development',
      SMU1_LOCAL_ADMIN: 'true',
      SMU1_ADMIN_LAUNCHER_REPO_IDENTITY: createAdminRepoIdentity(ROOT),
      TEST_SITE_URL: origin
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
    shell: false
  });
  let rendererLog = '';
  renderer.stdout.on('data', (chunk) => { rendererLog = `${rendererLog}${chunk}`.slice(-12_000); });
  renderer.stderr.on('data', (chunk) => { rendererLog = `${rendererLog}${chunk}`.slice(-12_000); });
  const browser = new CdpBrowser({ safetyMode: 'public-read-only' });
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (renderer.exitCode !== null) throw new Error(`Astro renderer exited early (${renderer.exitCode}).\n${rendererLog}`);
      if (await fetch(`${origin}/`).then((response) => response.status < 500).catch(() => false)) break;
      await delay(120);
    }
    await browser.start();
    const session = randomUUID();
    const url = new URL('/blagoustroystvo-territoriy/', origin);
    url.searchParams.set('__smu1_editor', '1');
    url.searchParams.set('editorSession', session);
    url.searchParams.set('editorRevision', '1');
    url.searchParams.set('editorMode', 'edit');
    await browser.navigate(url.href, { waitAfterMs: 120 });
    const baseline = await browser.evaluate(`(() => {
      const section = document.querySelector('section.direction-related[data-smu1-binding-id]');
      if (!(section instanceof HTMLElement)) return { error: 'missing direction section' };
      const rootBindingId = section.getAttribute('data-smu1-binding-id');
      const rootBinding = JSON.parse(section.getAttribute('data-smu1-binding') || 'null');
      section.dataset.h6PreserveToken = 'same-root';
      const rows = Array.from(section.querySelectorAll(':scope .direction-related__links > li'));
      const items = rows.map((row, index) => {
        const binding = JSON.parse(row.getAttribute('data-smu1-binding') || 'null');
        const id = String(binding?.stableItemId || '');
        row.dataset.h6PreserveToken = 'row-' + id;
        const anchor = row.querySelector(':scope > a');
        const titleNode = row.querySelector('strong,h3');
        const descriptionNode = row.querySelector('.direction-related__link-copy > span,:scope > p');
        const titleBinding = JSON.parse(titleNode?.getAttribute('data-smu1-binding') || 'null');
        const descriptionBinding = JSON.parse(descriptionNode?.getAttribute('data-smu1-binding') || 'null');
        const inheritedBinding = [titleBinding, descriptionBinding].find((candidate) => candidate
          && (candidate.ownerCollection !== rootBinding?.ownerCollection || candidate.recordSlug !== rootBinding?.recordSlug));
        return {
          id,
          targetCollection: inheritedBinding?.ownerCollection || 'services',
          targetSlug: inheritedBinding?.recordSlug || ('projection-' + index),
          eyebrow: row.querySelector('.direction-related__link-eyebrow')?.textContent || '',
          title: row.querySelector('strong')?.textContent || id,
          titleSource: titleBinding?.ownerCollection === rootBinding?.ownerCollection && titleBinding?.recordSlug === rootBinding?.recordSlug
            ? 'local' : 'inherited',
          description: row.querySelector('.direction-related__link-copy > span')?.textContent || '',
          descriptionSource: descriptionBinding?.ownerCollection === rootBinding?.ownerCollection && descriptionBinding?.recordSlug === rootBinding?.recordSlug
            ? 'local' : 'inherited',
          href: new URL(anchor?.href || '/', location.origin).pathname,
          childBindingIds: Array.from(row.querySelectorAll('[data-smu1-binding-id]')).map((node) => node.getAttribute('data-smu1-binding-id'))
        };
      });
      return { rootBindingId, items };
    })()`);
    assert.equal(baseline.error, undefined);
    assert.ok(baseline.items.length >= 2);
    assert.ok(baseline.items.every((item) => item.id && item.childBindingIds.length >= 2));
    const reordered = [...baseline.items].reverse().map((item, sourceIndex) => ({ ...item, sourceIndex }));
    await browser.evaluate(`(() => {
      window.postMessage({
        protocol: 'smu1-editor-bridge', version: 1,
        nonce: ${JSON.stringify(session)}, revision: 1, sequence: 1000,
        type: 'projection', projections: [{
          bindingId: ${JSON.stringify(baseline.rootBindingId)},
          value: {
            __smu1DirectionRelatedProjection: true,
            eyebrow: 'Дальше по задаче', title: 'Связанные направления',
            items: ${JSON.stringify(reordered.map(({ childBindingIds: _ids, ...item }) => item))}
          }
        }]
      }, location.origin);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    const afterReorder = await browser.evaluate(`(() => {
      const section = document.querySelector('section.direction-related[data-smu1-binding-id]');
      return {
        rootPreserved: section?.dataset.h6PreserveToken === 'same-root',
        rootBindingId: section?.getAttribute('data-smu1-binding-id') || '',
        rows: Array.from(section?.querySelectorAll(':scope .direction-related__links > li') || []).map((row) => ({
          token: row.dataset.h6PreserveToken || '',
          id: row.dataset.smu1LiveDirectionId || '',
          childBindings: Array.from(row.querySelectorAll('[data-smu1-binding-id]')).map((node) => {
            const binding = JSON.parse(node.getAttribute('data-smu1-binding') || 'null');
            return { id: node.getAttribute('data-smu1-binding-id'), fieldPath: binding?.fieldPath || '' };
          })
        }))
      };
    })()`);
    assert.equal(afterReorder.rootPreserved, true);
    assert.equal(afterReorder.rootBindingId, baseline.rootBindingId);
    assert.deepEqual(afterReorder.rows.map((row) => row.id), reordered.map((item) => item.id));
    afterReorder.rows.forEach((row, sourceIndex) => {
      const before = baseline.items.find((item) => item.id === row.id);
      assert.equal(row.token, `row-${row.id}`);
      assert.deepEqual(row.childBindings.map((binding) => binding.id), before.childBindingIds);
      assert.ok(row.childBindings.every((binding) => binding.fieldPath.includes(`[${sourceIndex}]`)));
    });
    await browser.evaluate(`(() => {
      window.postMessage({
        protocol: 'smu1-editor-bridge', version: 1,
        nonce: ${JSON.stringify(session)}, revision: 1, sequence: 1001,
        type: 'projection', projections: [{
          bindingId: ${JSON.stringify(baseline.rootBindingId)},
          value: {
            __smu1DirectionRelatedProjection: true,
            eyebrow: 'Дальше', title: 'Связанные страницы',
            items: ${JSON.stringify(reordered.slice(0, 1).map(({ childBindingIds: _ids, ...item }) => item))}
          }
        }]
      }, location.origin);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    await browser.evaluate(`(() => {
      window.postMessage({
        protocol: 'smu1-editor-bridge', version: 1,
        nonce: ${JSON.stringify(session)}, revision: 1, sequence: 1002,
        type: 'projection', projections: [{
          bindingId: ${JSON.stringify(baseline.rootBindingId)},
          value: {
            __smu1DirectionRelatedProjection: true,
            eyebrow: 'Дальше', title: 'Связанные страницы',
            items: ${JSON.stringify(reordered.map(({ childBindingIds: _ids, ...item }) => item))}
          }
        }]
      }, location.origin);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    assert.deepEqual(await browser.evaluate(`(() => Array.from(
      document.querySelectorAll('section.direction-related .direction-related__links > li')
    ).map((row) => ({
      id: row.dataset.smu1LiveDirectionId || '', token: row.dataset.h6PreserveToken || '',
      childBindingIds: Array.from(row.querySelectorAll('[data-smu1-binding-id]')).map((node) => node.getAttribute('data-smu1-binding-id'))
    })))()`), reordered.map((item) => ({
      id: item.id, token: `row-${item.id}`,
      childBindingIds: baseline.items.find((before) => before.id === item.id).childBindingIds
    })));
    await browser.evaluate(`(() => {
      window.postMessage({
        protocol: 'smu1-editor-bridge', version: 1,
        nonce: ${JSON.stringify(session)}, revision: 1, sequence: 1003,
        type: 'projection', projections: [{
          bindingId: ${JSON.stringify(baseline.rootBindingId)},
          value: { __smu1DirectionRelatedProjection: true, eyebrow: '', title: '', items: [] }
        }]
      }, location.origin);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    assert.deepEqual(await browser.evaluate(`(() => {
      const button = document.querySelector('[data-smu1-editor-affordance="empty-direction-related"]');
      return { tag: button?.tagName || '', bindingId: button?.getAttribute('data-smu1-binding-id') || '' };
    })()`), { tag: 'BUTTON', bindingId: baseline.rootBindingId });
    await browser.evaluate(`(() => {
      window.postMessage({
        protocol: 'smu1-editor-bridge', version: 1,
        nonce: ${JSON.stringify(session)}, revision: 1, sequence: 1004,
        type: 'projection', projections: [{
          bindingId: ${JSON.stringify(baseline.rootBindingId)},
          value: {
            __smu1DirectionRelatedProjection: true,
            eyebrow: 'Дальше', title: 'Связанные страницы',
            items: ${JSON.stringify(reordered.slice(0, 1).map(({ childBindingIds: _ids, ...item }) => item))}
          }
        }]
      }, location.origin);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    assert.deepEqual(await browser.evaluate(`(() => {
      const section = document.querySelector('section.direction-related[data-smu1-binding-id]');
      const row = section?.querySelector('[data-smu1-live-direction-id]');
      return {
        bindingId: section?.getAttribute('data-smu1-binding-id') || '',
        itemIds: Array.from(section?.querySelectorAll('[data-smu1-live-direction-id]') || []).map((item) => item.dataset.smu1LiveDirectionId),
        rowToken: row?.dataset.h6PreserveToken || '',
        childBindingIds: Array.from(row?.querySelectorAll('[data-smu1-binding-id]') || []).map((node) => node.getAttribute('data-smu1-binding-id'))
      };
    })()`), {
      bindingId: baseline.rootBindingId,
      itemIds: [reordered[0].id],
      rowToken: `row-${reordered[0].id}`,
      childBindingIds: baseline.items.find((item) => item.id === reordered[0].id).childBindingIds
    });
    await browser.evaluate(`(() => {
      window.postMessage({
        protocol: 'smu1-editor-bridge', version: 1,
        nonce: ${JSON.stringify(session)}, revision: 1, sequence: 1005,
        type: 'projection', projections: [{
          bindingId: ${JSON.stringify(baseline.rootBindingId)},
          value: { __smu1DirectionRelatedProjection: true, eyebrow: '', title: '', items: [] }
        }]
      }, location.origin);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    await browser.evaluate(`(() => {
      const button = document.querySelector('[data-smu1-editor-affordance="empty-direction-related"]');
      if (button) button.__smu1DetachedDirectionRelatedHost = null;
    })()`);
    await browser.evaluate(`(() => {
      window.postMessage({
        protocol: 'smu1-editor-bridge', version: 1,
        nonce: ${JSON.stringify(session)}, revision: 1, sequence: 1006,
        type: 'projection', projections: [{
          bindingId: ${JSON.stringify(baseline.rootBindingId)},
          value: {
            __smu1DirectionRelatedProjection: true, eyebrow: 'Дальше', title: 'Связанные страницы',
            items: ${JSON.stringify(reordered.slice(0, 1).map(({ childBindingIds: _ids, ...item }) => item))}
          }
        }]
      }, location.origin);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    assert.deepEqual(await browser.evaluate(`(() => {
      const text = document.querySelector('section.direction-related [data-smu1-live-direction-id] strong');
      const structural = text?.closest('[data-smu1-binding]');
      const binding = JSON.parse(structural?.getAttribute('data-smu1-binding') || 'null');
      return {
        bindingId: structural?.getAttribute('data-smu1-binding-id') || '',
        tool: binding?.tool || '',
        eyebrow: document.querySelector('section.direction-related .hv2-eyebrow')?.textContent || '',
        title: document.querySelector('#direction-related-title')?.textContent || ''
      };
    })()`), {
      bindingId: baseline.rootBindingId,
      tool: 'direction-related-relations',
      eyebrow: 'Дальше',
      title: 'Связанные страницы'
    });
  } finally {
    await browser.close().catch(() => {});
    await stopChild(renderer);
  }
});

test('project and product relation projections preserve keyed bindings in Chromium', { timeout: 120_000 }, async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const astroCli = await resolveAstroCli(ROOT);
  const { CODEX_CI: _codexCi, ...foregroundEnvironment } = process.env;
  const renderer = spawn(process.execPath, createParentBoundNodeArgs(astroCli, [
    'dev', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)
  ]), {
    cwd: ROOT,
    env: {
      ...foregroundEnvironment,
      CI: 'false',
      ASTRO_TELEMETRY_DISABLED: '1',
      ASTRO_DEV_BACKGROUND: 'foreground-parent-bound',
      BASE_PATH: '/',
      DEPLOY_TARGET: 'development',
      SMU1_LOCAL_ADMIN: 'true',
      SMU1_ADMIN_LAUNCHER_REPO_IDENTITY: createAdminRepoIdentity(ROOT),
      TEST_SITE_URL: origin
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
    shell: false
  });
  let rendererLog = '';
  renderer.stdout.on('data', (chunk) => { rendererLog = `${rendererLog}${chunk}`.slice(-12_000); });
  renderer.stderr.on('data', (chunk) => { rendererLog = `${rendererLog}${chunk}`.slice(-12_000); });
  const browser = new CdpBrowser({ safetyMode: 'public-read-only' });
  const session = randomUUID();
  const navigateCanvas = async (route) => {
    const url = new URL(route, origin);
    url.searchParams.set('__smu1_editor', '1');
    url.searchParams.set('editorSession', session);
    url.searchParams.set('editorRevision', '1');
    url.searchParams.set('editorMode', 'edit');
    await browser.navigate(url.href, { waitAfterMs: 150 });
  };
  const postProjection = async (bindingId, value, sequence) => browser.evaluate(`(() => {
    window.postMessage({
      protocol: 'smu1-editor-bridge', version: 1,
      nonce: ${JSON.stringify(session)}, revision: 1, sequence: ${Number(sequence)},
      type: 'projection', projections: [{ bindingId: ${JSON.stringify(bindingId)}, value: ${JSON.stringify(value)} }]
    }, location.origin);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (renderer.exitCode !== null) throw new Error(`Astro renderer exited early (${renderer.exitCode}).\n${rendererLog}`);
      if (await fetch(`${origin}/`).then((response) => response.status < 500).catch(() => false)) break;
      await delay(120);
    }
    await browser.start();

    await navigateCanvas('/vypolnennye-obekty/remont-skvera-na-ulitse-gogolya/');
    const projectBaseline = await browser.evaluate(`(() => {
      const grid = document.querySelector('.v2-project-detail__direction-grid[data-smu1-binding-id]');
      if (!(grid instanceof HTMLElement)) return { error: 'missing project direction grid' };
      grid.dataset.h6PreserveToken = 'project-grid';
      const items = Array.from(grid.querySelectorAll(':scope > a')).map((row) => {
        const id = String(row.dataset.smu1LiveDirectionId || '');
        row.dataset.h6PreserveToken = 'project-row-' + id;
        const context = row.querySelector(':scope > span');
        const label = row.querySelector(':scope > strong');
        if (context) context.dataset.h6PreserveToken = 'context-' + id;
        if (label) label.dataset.h6PreserveToken = 'label-' + id;
        const contextBinding = JSON.parse(context?.getAttribute('data-smu1-binding') || 'null');
        const labelBinding = JSON.parse(label?.getAttribute('data-smu1-binding') || 'null');
        return {
          id, label: label?.textContent || '', context: context?.textContent || '',
          href: new URL(row.href, location.origin).pathname,
          contextBindingId: context?.getAttribute('data-smu1-binding-id') || '',
          labelBindingId: label?.getAttribute('data-smu1-binding-id') || '',
          contextFieldPath: contextBinding?.fieldPath || '', labelFieldPath: labelBinding?.fieldPath || ''
        };
      });
      return {
        bindingId: grid.getAttribute('data-smu1-binding-id'),
        binding: JSON.parse(grid.getAttribute('data-smu1-binding') || 'null'),
        items
      };
    })()`);
    assert.equal(projectBaseline.error, undefined);
    assert.ok(projectBaseline.items.length >= 2);
    const projectReordered = [...projectBaseline.items].reverse().map((item, sourceIndex) => ({
      id: item.id, label: item.label, context: item.context, href: item.href,
      order: (sourceIndex + 1) * 10, sourceIndex
    }));
    await postProjection(projectBaseline.bindingId, {
      __smu1ProjectDirectionProjection: true,
      items: projectReordered
    }, 2000);
    const projectAfter = await browser.evaluate(`(() => {
      const grid = document.querySelector('.v2-project-detail__direction-grid[data-smu1-binding-id]');
      return {
        gridToken: grid?.dataset.h6PreserveToken || '',
        items: Array.from(grid?.querySelectorAll(':scope > a') || []).map((row) => {
          const id = String(row.dataset.smu1LiveDirectionId || '');
          const context = row.querySelector(':scope > span');
          const label = row.querySelector(':scope > strong');
          const contextBinding = JSON.parse(context?.getAttribute('data-smu1-binding') || 'null');
          const labelBinding = JSON.parse(label?.getAttribute('data-smu1-binding') || 'null');
          return {
            id, rowToken: row.dataset.h6PreserveToken || '',
            contextToken: context?.dataset.h6PreserveToken || '', labelToken: label?.dataset.h6PreserveToken || '',
            contextBindingId: context?.getAttribute('data-smu1-binding-id') || '',
            labelBindingId: label?.getAttribute('data-smu1-binding-id') || '',
            contextFieldPath: contextBinding?.fieldPath || '', labelFieldPath: labelBinding?.fieldPath || ''
          };
        })
      };
    })()`);
    assert.equal(projectAfter.gridToken, 'project-grid');
    assert.deepEqual(projectAfter.items.map((item) => item.id), projectReordered.map((item) => item.id));
    projectAfter.items.forEach((item, sourceIndex) => {
      const before = projectBaseline.items.find((candidate) => candidate.id === item.id);
      assert.equal(item.rowToken, `project-row-${item.id}`);
      assert.equal(item.contextToken, `context-${item.id}`);
      assert.equal(item.labelToken, `label-${item.id}`);
      assert.equal(item.contextBindingId, before.contextBindingId);
      assert.equal(item.labelBindingId, before.labelBindingId);
      assert.equal(item.contextFieldPath, `presentation.relatedDirections[${sourceIndex}].context`);
      assert.equal(item.labelFieldPath, `presentation.relatedDirections[${sourceIndex}].label`);
    });
    await postProjection(projectBaseline.bindingId, {
      __smu1ProjectDirectionProjection: true, items: projectReordered.slice(0, 1)
    }, 2001);
    await postProjection(projectBaseline.bindingId, {
      __smu1ProjectDirectionProjection: true, items: projectReordered
    }, 2002);
    assert.deepEqual(await browser.evaluate(`(() => Array.from(
      document.querySelectorAll('.v2-project-detail__direction-grid > a')
    ).map((row) => ({
      id: row.dataset.smu1LiveDirectionId || '', token: row.dataset.h6PreserveToken || '',
      childBindingIds: Array.from(row.querySelectorAll('[data-smu1-binding-id]')).map((node) => node.getAttribute('data-smu1-binding-id'))
    })))()`), projectReordered.map((item) => ({
      id: item.id, token: `project-row-${item.id}`,
      childBindingIds: [
        projectBaseline.items.find((before) => before.id === item.id).contextBindingId,
        projectBaseline.items.find((before) => before.id === item.id).labelBindingId
      ]
    })));
    await postProjection(projectBaseline.bindingId, { __smu1ProjectDirectionProjection: true, items: [] }, 2003);
    assert.deepEqual(await browser.evaluate(`(() => {
      const button = document.querySelector('[data-smu1-editor-affordance="empty-project-directions"]');
      const navItem = document.querySelector('[data-v2-section-nav-link][href="#project-directions"]')?.closest('li');
      return { tag: button?.tagName || '', bindingId: button?.getAttribute('data-smu1-binding-id') || '', navHidden: navItem?.hidden };
    })()`), { tag: 'BUTTON', bindingId: projectBaseline.bindingId, navHidden: true });
    await postProjection(projectBaseline.bindingId, {
      __smu1ProjectDirectionProjection: true,
      items: projectReordered
    }, 2004);
    const projectRestored = await browser.evaluate(`(() => ({
      items: Array.from(document.querySelectorAll('.v2-project-detail__direction-grid > a')).map((row) => ({
        id: row.dataset.smu1LiveDirectionId || '', token: row.dataset.h6PreserveToken || '',
        childBindingIds: Array.from(row.querySelectorAll('[data-smu1-binding-id]')).map((node) => node.getAttribute('data-smu1-binding-id'))
      }))
    }))()`);
    assert.deepEqual(projectRestored.items.map((item) => item.id), projectReordered.map((item) => item.id));
    projectRestored.items.forEach((item) => {
      const before = projectBaseline.items.find((candidate) => candidate.id === item.id);
      assert.equal(item.token, `project-row-${item.id}`);
      assert.deepEqual(item.childBindingIds, [before.contextBindingId, before.labelBindingId]);
    });
    assert.equal(await browser.evaluate(`document.querySelector(
      '[data-v2-section-nav-link][href="#project-directions"]'
    )?.closest('li')?.hidden`), false);
    await postProjection(projectBaseline.bindingId, { __smu1ProjectDirectionProjection: true, items: [] }, 2005);
    await browser.evaluate(`(() => {
      const button = document.querySelector('[data-smu1-editor-affordance="empty-project-directions"]');
      if (button) button.__smu1DetachedProjectDirectionsHost = null;
    })()`);
    await postProjection(projectBaseline.bindingId, {
      __smu1ProjectDirectionProjection: true,
      eyebrow: 'Новый надзаголовок проекта',
      title: 'Новый заголовок проекта',
      items: projectReordered
    }, 2006);
    assert.deepEqual(await browser.evaluate(`(() => {
      const header = document.querySelector('.v2-project-detail__directions > .hv2-shell > header');
      const text = document.querySelector('.v2-project-detail__direction-grid > a > strong');
      const structural = text?.closest('[data-smu1-binding]');
      const binding = JSON.parse(structural?.getAttribute('data-smu1-binding') || 'null');
      return {
        headerBindingId: header?.getAttribute('data-smu1-binding-id') || '',
        textBindingId: structural?.getAttribute('data-smu1-binding-id') || '',
        tool: binding?.tool || '',
        eyebrow: header?.querySelector(':scope > .hv2-eyebrow')?.textContent || '',
        title: header?.querySelector(':scope > #v2-project-directions-title')?.textContent || ''
      };
    })()`), {
      headerBindingId: projectBaseline.bindingId,
      textBindingId: projectBaseline.bindingId,
      tool: 'project-direction-relations',
      eyebrow: 'Новый надзаголовок проекта',
      title: 'Новый заголовок проекта'
    });

    await navigateCanvas('/ulichnaya-mebel/lavochki-i-skameyki/skamya-bulvar/');
    const productBaseline = await browser.evaluate(`(() => {
      const grid = document.querySelector('.v2-product-grid--related[data-smu1-binding-id]');
      if (!(grid instanceof HTMLElement)) return { error: 'missing standard related product grid', path: location.pathname };
      grid.dataset.h6PreserveToken = 'product-grid';
      const items = Array.from(grid.querySelectorAll(':scope > [role="listitem"]')).map((wrapper) => {
        const card = wrapper.querySelector(':scope > .v2-product-card');
        const slug = String(card?.dataset.smu1LiveProductSlug || '');
        wrapper.dataset.h6PreserveToken = 'wrapper-' + slug;
        if (card) card.dataset.h6PreserveToken = 'card-' + slug;
        const image = card?.querySelector('img');
        return {
          slug,
          href: new URL(card?.href || '/', location.origin).pathname,
          title: card?.querySelector('h3')?.textContent || slug,
          description: card?.querySelector('.v2-product-card__description')?.textContent || '',
          material: card?.querySelector('.v2-product-card__type')?.textContent || '',
          price: card?.querySelector('.v2-product-card__footer > strong')?.textContent || '',
          categorySlug: String(card?.dataset.smu1LiveProductCategory || ''),
          presentationType: card?.dataset.productCardPresentation === 'premium' ? 'premium' : 'standard',
          image: image ? { src: image.dataset.smu1CanonicalMedia || new URL(image.src, location.origin).pathname, alt: image.alt } : null,
          responsive: image ? {
            src: image.getAttribute('src') || '', srcset: image.getAttribute('srcset') || '',
            sources: Array.from(image.closest('picture')?.querySelectorAll('source') || []).map((source) => source.getAttribute('srcset') || '')
          } : null,
          childBindingIds: Array.from(card?.querySelectorAll('[data-smu1-binding-id]') || []).map((node) => node.getAttribute('data-smu1-binding-id'))
        };
      });
      return {
        bindingId: grid.getAttribute('data-smu1-binding-id'),
        binding: JSON.parse(grid.getAttribute('data-smu1-binding') || 'null'),
        items
      };
    })()`);
    assert.equal(productBaseline.error, undefined, JSON.stringify(productBaseline));
    assert.ok(productBaseline.items.length >= 2);
    assert.ok(productBaseline.items.every((item) => item.slug && item.childBindingIds.length >= 3));
    const productReordered = [...productBaseline.items].reverse();
    await postProjection(productBaseline.bindingId, {
      __smu1ProductRelationsProjection: true,
      items: productReordered.map(({ childBindingIds: _children, responsive: _responsive, ...item }) => item)
    }, 3000);
    const productAfter = await browser.evaluate(`(() => {
      const grid = document.querySelector('.v2-product-grid--related[data-smu1-binding-id]');
      return {
        gridToken: grid?.dataset.h6PreserveToken || '',
        bindingId: grid?.getAttribute('data-smu1-binding-id') || '',
        items: Array.from(grid?.querySelectorAll(':scope > [role="listitem"]') || []).map((wrapper) => {
          const card = wrapper.querySelector(':scope > .v2-product-card');
          return {
            slug: card?.dataset.smu1LiveProductSlug || '',
            wrapperToken: wrapper.dataset.h6PreserveToken || '', cardToken: card?.dataset.h6PreserveToken || '',
            responsive: card?.querySelector('img') ? {
              src: card.querySelector('img').getAttribute('src') || '', srcset: card.querySelector('img').getAttribute('srcset') || '',
              sources: Array.from(card.querySelectorAll('picture source')).map((source) => source.getAttribute('srcset') || '')
            } : null,
            childBindingIds: Array.from(card?.querySelectorAll('[data-smu1-binding-id]') || []).map((node) => node.getAttribute('data-smu1-binding-id'))
          };
        })
      };
    })()`);
    assert.equal(productAfter.gridToken, 'product-grid');
    assert.equal(productAfter.bindingId, productBaseline.bindingId);
    assert.deepEqual(productAfter.items.map((item) => item.slug), productReordered.map((item) => item.slug));
    productAfter.items.forEach((item) => {
      const before = productBaseline.items.find((candidate) => candidate.slug === item.slug);
      assert.equal(item.wrapperToken, `wrapper-${item.slug}`);
      assert.equal(item.cardToken, `card-${item.slug}`);
      assert.deepEqual(item.childBindingIds, before.childBindingIds);
      assert.deepEqual(item.responsive, before.responsive);
    });
    const imageProduct = productReordered.find((item) => item.image && item.responsive);
    assert.ok(imageProduct, 'fixture must contain a responsive related product image');
    await postProjection(productBaseline.bindingId, {
      __smu1ProductRelationsProjection: true,
      items: productReordered.map(({ childBindingIds: _children, responsive: _responsive, ...item }) => (
        item.slug === imageProduct.slug ? { ...item, image: null } : item
      ))
    }, 3001);
    assert.equal(await browser.evaluate(`document.querySelector(
      '.v2-product-card[data-smu1-live-product-slug="${imageProduct.slug}"] [data-smu1-editor-affordance="missing-product-media"]'
    ) !== null`), true);
    await postProjection(productBaseline.bindingId, {
      __smu1ProductRelationsProjection: true,
      items: productReordered.map(({ childBindingIds: _children, responsive: _responsive, ...item }) => item)
    }, 3002);
    assert.deepEqual(await browser.evaluate(`(() => {
      const image = document.querySelector(
        '.v2-product-card[data-smu1-live-product-slug="${imageProduct.slug}"] img'
      );
      return image ? {
        src: image.getAttribute('src') || '', srcset: image.getAttribute('srcset') || '',
        sources: Array.from(image.closest('picture')?.querySelectorAll('source') || []).map((source) => source.getAttribute('srcset') || '')
      } : null;
    })()`), imageProduct.responsive);
    const withoutLastProduct = productReordered.slice(0, -1)
      .map(({ childBindingIds: _children, responsive: _responsive, ...item }) => item);
    await postProjection(productBaseline.bindingId, {
      __smu1ProductRelationsProjection: true, items: withoutLastProduct
    }, 3003);
    await postProjection(productBaseline.bindingId, {
      __smu1ProductRelationsProjection: true,
      items: productReordered.map(({ childBindingIds: _children, responsive: _responsive, ...item }) => item)
    }, 3004);
    assert.deepEqual(await browser.evaluate(`(() => Array.from(
      document.querySelectorAll('.v2-product-grid--related > [role="listitem"]')
    ).map((wrapper) => {
      const card = wrapper.querySelector(':scope > .v2-product-card');
      return {
        slug: card?.dataset.smu1LiveProductSlug || '',
        wrapperToken: wrapper.dataset.h6PreserveToken || '', cardToken: card?.dataset.h6PreserveToken || '',
        childBindingIds: Array.from(card?.querySelectorAll('[data-smu1-binding-id]') || []).map((node) => node.getAttribute('data-smu1-binding-id'))
      };
    }))()`), productReordered.map((item) => ({
      slug: item.slug, wrapperToken: `wrapper-${item.slug}`, cardToken: `card-${item.slug}`,
      childBindingIds: productBaseline.items.find((before) => before.slug === item.slug).childBindingIds
    })));
    await postProjection(productBaseline.bindingId, { __smu1ProductRelationsProjection: true, items: [] }, 3005);
    assert.deepEqual(await browser.evaluate(`(() => {
      const button = document.querySelector('[data-smu1-editor-affordance="empty-related-products"]');
      const navItem = document.querySelector('[data-v2-section-nav-link][href="#related-products"]')?.closest('li');
      return { tag: button?.tagName || '', bindingId: button?.getAttribute('data-smu1-binding-id') || '', navHidden: navItem?.hidden };
    })()`), { tag: 'BUTTON', bindingId: productBaseline.bindingId, navHidden: true });
    const oneProduct = productReordered.slice(0, 1).map(({ childBindingIds: _children, responsive: _responsive, ...item }) => item);
    await postProjection(productBaseline.bindingId, { __smu1ProductRelationsProjection: true, items: oneProduct }, 3006);
    assert.deepEqual(await browser.evaluate(`(() => {
      const grid = document.querySelector('.v2-related-products .v2-product-grid--related[data-smu1-binding-id]');
      const wrapper = grid?.querySelector(':scope > [role="listitem"]');
      const card = wrapper?.querySelector(':scope > .v2-product-card');
      return {
        bindingId: grid?.getAttribute('data-smu1-binding-id') || '',
        slugs: Array.from(grid?.querySelectorAll(':scope > [role="listitem"] .v2-product-card') || []).map((item) => item.dataset.smu1LiveProductSlug),
        wrapperToken: wrapper?.dataset.h6PreserveToken || '', cardToken: card?.dataset.h6PreserveToken || '',
        childBindingIds: Array.from(card?.querySelectorAll('[data-smu1-binding-id]') || []).map((node) => node.getAttribute('data-smu1-binding-id'))
      };
    })()`), {
      bindingId: productBaseline.bindingId,
      slugs: [oneProduct[0].slug],
      wrapperToken: `wrapper-${oneProduct[0].slug}`,
      cardToken: `card-${oneProduct[0].slug}`,
      childBindingIds: productBaseline.items.find((item) => item.slug === oneProduct[0].slug).childBindingIds
    });
    assert.equal(await browser.evaluate(`document.querySelector(
      '[data-v2-section-nav-link][href="#related-products"]'
    )?.closest('li')?.hidden`), false);
    await postProjection(productBaseline.bindingId, { __smu1ProductRelationsProjection: true, items: [] }, 3007);
    await browser.evaluate(`(() => {
      const button = document.querySelector('[data-smu1-editor-affordance="empty-related-products"]');
      if (button) button.__smu1DetachedProductRelationsHost = null;
    })()`);
    const unseenProduct = {
      ...oneProduct[0], slug: 'editor-new-product', href: '/ulichnaya-mebel/lavochki-i-skameyki/editor-new-product/',
      title: 'Новый товар в draft', description: 'Безопасная renderer-карточка.',
      categorySlug: 'lavochki-i-skameyki', image: null
    };
    await postProjection(productBaseline.bindingId, { __smu1ProductRelationsProjection: true, items: [unseenProduct] }, 3008);
    const unseenEvidence = await browser.evaluate(`(() => {
      const section = document.querySelector('.v2-related-products');
      const header = section?.querySelector(':scope > .v2-section-heading');
      const grid = section?.querySelector(':scope > .v2-product-grid--related[data-smu1-binding-id]');
      const card = grid?.querySelector(':scope > [role="listitem"] > .v2-product-card');
      const parseBindings = (nodes) => nodes
        .map((node) => JSON.parse(node.getAttribute('data-smu1-binding') || 'null'))
        .filter(Boolean);
      const liveBindings = parseBindings(Array.from(section?.querySelectorAll('[data-smu1-binding]') || []))
        .filter((binding) => binding.liveTemplateBindingId);
      const templateBindings = Array.from(document.querySelectorAll('template[data-smu1-product-relations-template]'))
        .flatMap((template) => parseBindings(Array.from(template.content.querySelectorAll('[data-smu1-binding]'))));
      const productBindings = liveBindings.filter((binding) => binding.ownerCollection === 'products');
      return {
        sectionClasses: section?.className || '', headerReveal: header?.hasAttribute('data-v2-reveal') || false,
        headerUiBindings: header?.querySelectorAll('[data-smu1-binding-id]').length || 0,
        gridBindingId: grid?.getAttribute('data-smu1-binding-id') || '',
        cardReveal: card?.hasAttribute('data-v2-reveal') || false,
        slug: card?.dataset.smu1LiveProductSlug || '',
        missingAffordance: card?.querySelector('[data-smu1-editor-affordance="missing-product-media"]') !== null,
        liveBindings,
        templateBindings,
        productBindings: productBindings.map((binding) => ({
          id: binding.bindingId, recordSlug: binding.recordSlug, ownerSlug: binding.owner?.slug,
          stableItemId: binding.stableItemId,
          parentSlug: binding.tool === 'reorder-item' ? binding.parentSlug : undefined
        }))
      };
    })()`);
    assert.equal(unseenEvidence.sectionClasses, 'v2-related-products');
    assert.equal(unseenEvidence.headerReveal, true);
    assert.ok(unseenEvidence.headerUiBindings >= 2);
    assert.equal(unseenEvidence.gridBindingId, productBaseline.bindingId);
    assert.equal(unseenEvidence.cardReveal, true);
    assert.equal(unseenEvidence.slug, unseenProduct.slug);
    assert.equal(unseenEvidence.missingAffordance, true);
    assert.ok(unseenEvidence.productBindings.length >= 4);
    unseenEvidence.productBindings.forEach((binding) => {
      assert.match(binding.id, /^live-product:editor-new-product:[a-f0-9]{8}$/u);
      assert.equal(binding.recordSlug, unseenProduct.slug);
      assert.equal(binding.ownerSlug, unseenProduct.slug);
      assert.equal(binding.stableItemId, unseenProduct.slug);
      if (binding.parentSlug !== undefined) assert.equal(binding.parentSlug, unseenProduct.categorySlug);
    });
    const templates = new Map(unseenEvidence.templateBindings.map((binding) => [binding.bindingId, binding]));
    const accepted = unseenEvidence.liveBindings.map((candidate) => reconcileCanvasBindingCandidate({
      candidate,
      template: templates.get(candidate.liveTemplateBindingId),
      structuralParent: productBaseline.binding,
      frameRevision: 1,
      currentRoute: '/ulichnaya-mebel/lavochki-i-skameyki/skamya-bulvar/',
      readRecordContent: (collection, slug) => collection === 'products' && slug === unseenProduct.slug
        ? { ...unseenProduct, isActive: true, showInCatalog: true }
        : undefined,
      resolvePage: (collection, slug) => collection === 'products' && slug === unseenProduct.slug
        ? {
            collection: 'products', slug, emitted: true, isActive: true,
            parentSlug: unseenProduct.categorySlug, route: unseenProduct.href,
            entry: { showInCatalog: true }
          }
        : undefined,
      isDynamicItemAllowed: (_parent, slug) => slug === unseenProduct.slug || slug === 'section-title:section'
    }));
    assert.ok(accepted.length >= 6, `expected product, global and header live bindings, got ${accepted.length}`);
    assert.ok(accepted.every(Boolean));
    assert.ok(accepted.some((binding) => binding.ownerCollection === 'products'));
    assert.ok(accepted.some((binding) => binding.ownerCollection === 'site-settings' && binding.dynamicItemId === unseenProduct.slug));
    assert.ok(accepted.some((binding) => binding.ownerCollection === 'site-settings' && binding.dynamicItemId === 'section'));
    assert.equal(accepted.find((binding) => binding?.dynamicItemId === 'section-title:section')?.fieldPath,
      'productUi.standardRelatedSectionTitle');
    for (const binding of accepted.filter(Boolean)) {
      assert.equal(binding.bindingId, String(binding.dynamicItemId).startsWith('section')
        ? liveSectionBindingId(productBaseline.bindingId, binding.liveTemplateBindingId)
        : liveProductBindingId(binding.liveTemplateBindingId, unseenProduct.slug));
    }

    await navigateCanvas('/ulichnaya-mebel/kacheli/kacheli-pergola/');
    // Use the production canvas and cascade: inline objectFit alone cannot
    // override the hero rules that read the authored --v2-media-* properties.
    const cropBaseline = await browser.evaluate(`(() => {
      const image = document.querySelector('.v2-premium-product-hero__media img[data-smu1-binding-id]');
      const binding = JSON.parse(image?.getAttribute('data-smu1-binding') || 'null');
      return {
        bindingId: image?.getAttribute('data-smu1-binding-id') || '',
        tool: binding?.tool || '',
        responsive: image ? {
          src: image.getAttribute('src'), srcset: image.getAttribute('srcset'),
          sources: Array.from(image.closest('picture')?.querySelectorAll('source') || [])
            .map((source) => source.getAttribute('srcset'))
        } : null
      };
    })()`);
    assert.ok(cropBaseline.bindingId, 'premium hero exposes the actual crop binding');
    assert.equal(cropBaseline.tool, 'crop');
    for (const [index, crop] of [
      { fit: 'contain', positionX: 17, positionY: 68, scale: 1.2 },
      { fit: 'cover', positionX: 50, positionY: 50, scale: 1 }
    ].entries()) {
      await postProjection(cropBaseline.bindingId, { __smu1CropProjection: true, ...crop }, 3900 + index);
      const projectedCrop = await browser.evaluate(`(() => {
        const image = document.querySelector('.v2-premium-product-hero__media img[data-smu1-binding-id]');
        const computed = getComputedStyle(image);
        return {
          fit: computed.objectFit, position: computed.objectPosition,
          scale: new DOMMatrixReadOnly(computed.transform).a,
          responsive: {
            src: image.getAttribute('src'), srcset: image.getAttribute('srcset'),
            sources: Array.from(image.closest('picture')?.querySelectorAll('source') || [])
              .map((source) => source.getAttribute('srcset'))
          }
        };
      })()`);
      assert.equal(projectedCrop.fit, crop.fit, 'live fit wins the production CSS cascade');
      assert.equal(projectedCrop.position, `${crop.positionX}% ${crop.positionY}%`);
      assert.ok(Math.abs(projectedCrop.scale - crop.scale) < 0.001, 'live scale reaches the image');
      assert.deepEqual(projectedCrop.responsive, cropBaseline.responsive, 'crop preserves H5 responsive sources');
    }
    const premiumBaseline = await browser.evaluate(`(() => {
      const grid = document.querySelector('.v2-premium-related .v2-product-grid--related[data-smu1-binding-id]');
      if (!(grid instanceof HTMLElement)) return { error: 'missing premium related grid', path: location.pathname };
      const card = grid.querySelector(':scope > [role="listitem"] > .v2-product-card');
      const image = card?.querySelector('img');
      const wrapper = card?.closest('[role="listitem"]');
      if (wrapper) wrapper.dataset.h6PreserveToken = 'premium-wrapper';
      if (card) card.dataset.h6PreserveToken = 'premium-card';
      return {
        bindingId: grid.getAttribute('data-smu1-binding-id'),
        variant: grid.dataset.smu1ProductRelationsVariant || '',
        item: {
          slug: card?.dataset.smu1LiveProductSlug || '', href: new URL(card?.href || '/', location.origin).pathname,
          title: card?.querySelector('h3')?.textContent || '',
          description: card?.querySelector('.v2-product-card__description')?.textContent || '',
          material: card?.querySelector('.v2-product-card__type')?.textContent || '',
          price: card?.querySelector('.v2-product-card__footer > strong')?.textContent || '',
          categorySlug: String(card?.dataset.smu1LiveProductCategory || ''),
          presentationType: card?.dataset.productCardPresentation === 'premium' ? 'premium' : 'standard',
          image: image ? { src: image.dataset.smu1CanonicalMedia || new URL(image.src, location.origin).pathname, alt: image.alt } : null,
          responsive: image ? {
            src: image.getAttribute('src') || '', srcset: image.getAttribute('srcset') || '',
            sources: Array.from(image.closest('picture')?.querySelectorAll('source') || []).map((source) => source.getAttribute('srcset') || '')
          } : null
        }
      };
    })()`);
    assert.equal(premiumBaseline.error, undefined, JSON.stringify(premiumBaseline));
    assert.equal(premiumBaseline.variant, 'premium');
    assert.ok(premiumBaseline.item.slug);
    await postProjection(premiumBaseline.bindingId, {
      __smu1ProductRelationsProjection: true,
      items: [{ ...premiumBaseline.item, responsive: undefined }]
    }, 3999);
    assert.deepEqual(await browser.evaluate(`(() => {
      const card = document.querySelector('.v2-premium-related .v2-product-card');
      const image = card?.querySelector('img');
      return {
        wrapperToken: card?.closest('[role="listitem"]')?.dataset.h6PreserveToken || '',
        cardToken: card?.dataset.h6PreserveToken || '',
        responsive: image ? {
          src: image.getAttribute('src') || '', srcset: image.getAttribute('srcset') || '',
          sources: Array.from(image.closest('picture')?.querySelectorAll('source') || []).map((source) => source.getAttribute('srcset') || '')
        } : null
      };
    })()`), {
      wrapperToken: 'premium-wrapper', cardToken: 'premium-card', responsive: premiumBaseline.item.responsive
    });
    await postProjection(premiumBaseline.bindingId, { __smu1ProductRelationsProjection: true, items: [] }, 4000);
    await browser.evaluate(`(() => {
      const button = document.querySelector('[data-smu1-editor-affordance="empty-related-products"]');
      if (button) button.__smu1DetachedProductRelationsHost = null;
    })()`);
    await postProjection(premiumBaseline.bindingId, {
      __smu1ProductRelationsProjection: true,
      items: [{ ...premiumBaseline.item, responsive: undefined }]
    }, 4001);
    assert.deepEqual(await browser.evaluate(`(() => {
      const section = document.querySelector('.v2-premium-related');
      const grid = section?.querySelector('.v2-product-grid--related[data-smu1-binding-id]');
      const card = grid?.querySelector('.v2-product-card');
      return {
        section: section?.tagName || '', premiumSection: section?.hasAttribute('data-premium-product-section') || false,
        shell: section?.querySelector(':scope > .hv2-shell') !== null,
        headerReveal: section?.querySelector('.v2-section-heading')?.hasAttribute('data-v2-reveal') || false,
        headerUiBindings: section?.querySelector('.v2-section-heading')?.querySelectorAll('[data-smu1-binding-id]').length || 0,
        bindingId: grid?.getAttribute('data-smu1-binding-id') || '', slug: card?.dataset.smu1LiveProductSlug || ''
      };
    })()`), {
      section: 'SECTION', premiumSection: true, shell: true, headerReveal: true, headerUiBindings: 3,
      bindingId: premiumBaseline.bindingId, slug: premiumBaseline.item.slug
    });
  } finally {
    await browser.close().catch(() => {});
    await stopChild(renderer);
  }
});

test('an empty related-product set remains clickable without changing public layout', () => {
  const standard = read('src/components/v2/CatalogStandardProductV2.astro');
  const premium = read('src/components/v2/CatalogPremiumProductV2.astro');
  const styles = read('src/admin/styles/editor-canvas-affordances.css');
  for (const source of [standard, premium]) {
    assert.match(source, /editorCanvas && relatedProducts\.length === 0/u);
    assert.match(source, /data-smu1-editor-affordance="empty-related-products"/u);
    assert.match(source, /\{\.\.\.relatedProductsBinding\}/u);
    assert.match(source, /<template data-smu1-product-relations-template=/u);
    assert.match(source, /data-smu1-card-template-presentation="standard"[^>]*><V2ProductCard product=\{standardTemplateProduct\}/u);
    assert.match(source, /data-smu1-card-template-presentation="premium"[^>]*><V2ProductCard product=\{premiumTemplateProduct\}/u);
  }
  assert.match(styles, /\.v2-editor-fixed-affordance\s*\{[^}]*position:\s*fixed;/su);
});

test('borrowed relation media has distinct accessible actions and safe live projection', () => {
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  const styles = read('src/admin/styles/visual-editor.css');
  const layout = read('src/layouts/PublicV2Layout.astro');

  assert.match(editor, /resolveRelationMediaProjection\(row\.binding, projectionRecordContent\)/u);
  assert.match(editor, /retargetBorrowedMediaBinding/u);
  assert.match(editor, /relationHandle\.dataset\.controlKey = 'relation'/u);
  assert.match(editor, /relationHandle\.textContent = binding\.tool === 'relation-select' \? 'Источник' : 'Связи'/u);
  assert.match(styles, /\.ve-relation-handle \{[^}]*z-index: 6;/u);
  assert.match(layout, /__smu1RelationMediaProjection === true/u);
  assert.match(layout, /validRetargetedMediaBinding/u);
  assert.match(layout, /image\.closest\('picture'\)\?\.querySelectorAll\('source'\)\.forEach\(\(source\) => source\.removeAttribute\('srcset'\)\)/u);
  assert.doesNotMatch(layout, /element\.textContent = String\(value\)[\s\S]{0,120}__smu1RelationMediaProjection/u);
});

test('borrowed media provenance and focal controls stay visible in editor UI', () => {
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  assert.match(editor, /Используется на: \$\{affected\.join\(', '\)\}/u);
  assert.match(editor, /focalPositionControl\(record, 'companyHeroPosition', 'Фокус фотографии первого экрана'\)/u);
  assert.match(editor, /focalPositionControl\(record, 'customOrderHeroPosition', 'Фокус первого экрана на компьютере'\)/u);
  assert.match(editor, /focalPositionControl\(record, 'customOrderHeroMobilePosition', 'Фокус первого экрана на телефоне'\)/u);
});

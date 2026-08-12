import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildRelationGraph,
  findBlockingReferences,
  getMediaReferences,
  normalizeRoutePathname,
  previewRelationImpact
} from './relation-graph.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fixture(navigationShape = 'array') {
  const navigationItems = [
    { title: 'Категория', href: '/catalog/benches/?from=nav#models' },
    { title: 'Объект', href: '/vypolnennye-obekty/city-square/' }
  ];
  return deepFreeze({
    collections: {
      'product-sections': [
        { title: 'Каталог', slug: 'catalog', isActive: true, image: '/uploads/shared.jpg' },
        { title: 'Другой раздел', slug: 'other-section', isActive: true }
      ],
      'product-categories': [
        { title: 'Скамейки', slug: 'benches', parentSectionSlug: 'catalog', isActive: true, gallery: [{ src: '/uploads/shared.jpg', alt: 'Общий файл' }] },
        { title: 'Другая категория', slug: 'other-category', parentSectionSlug: 'other-section', isActive: true }
      ],
      products: [
        {
          title: 'Альфа', slug: 'alpha', productCategorySlug: 'benches', isActive: true,
          showInCatalog: true, relatedProductSlugs: ['beta'], image: '/uploads/alpha.jpg', gallery: ['/uploads/shared.jpg']
        },
        {
          title: 'Бета', slug: 'beta', productCategorySlug: 'benches', isActive: true,
          showInCatalog: true, relatedProductSlugs: [], image: '/uploads/shared.jpg'
        }
      ],
      services: [
        { title: 'Монтаж', slug: 'installation', isActive: true }
      ],
      projects: [
        { title: 'Площадь', slug: 'city-square', isActive: true, image: '/uploads/shared.jpg', gallery: [{ src: '/uploads/project.jpg', caption: 'Объект' }] }
      ],
      jobs: [
        { title: 'Сварщик', slug: 'welder', isActive: true }
      ],
      'static-pages': [
        { title: 'Главная', slug: 'home', isActive: true, heroTitle: 'Главная' },
        { title: 'Объекты', slug: 'vypolnennye-obekty', isActive: true, heroTitle: 'Объекты' },
        {
          title: 'О нас', slug: 'about', isActive: true, heroTitle: 'О нас', trustImage: '/uploads/shared.jpg',
          pathwayCards: [{ title: 'Скамейки', text: 'Категория', categorySlug: 'benches', buttonHref: '/catalog/benches/' }],
          pageBlocks: [{ type: 'cta', order: 10, buttonHref: '/catalog/benches/alpha/?source=about#buy' }]
        }
      ],
      'site-settings': [{ companyName: 'СМУ-1' }]
    },
    navigation: navigationShape === 'envelope' ? { items: navigationItems } : navigationItems
  });
}

function graph(navigationShape = 'array') {
  const input = fixture(navigationShape);
  const before = structuredClone(input);
  const result = buildRelationGraph(input);
  assert.deepEqual(input, before, 'relation graph construction mutated its input');
  return result;
}

function updateAt(preview, id, path) {
  return preview.relationUpdates.find((update) => update.target.id === id && update.path === path);
}

test('graph resolves hierarchy, related products, public routes and exact internal href pathnames', () => {
  const result = graph();
  const section = result.hierarchy.sections.find((item) => item.section.slug === 'catalog');
  assert.deepEqual(section.categories.map((item) => item.slug), ['benches']);
  const category = result.hierarchy.categories.find((item) => item.category.slug === 'benches');
  assert.equal(category.section.slug, 'catalog');
  assert.deepEqual(category.products.map((item) => item.slug), ['alpha', 'beta']);

  const alphaRelations = result.hierarchy.relatedProducts.find((item) => item.product.slug === 'alpha');
  const betaRelations = result.hierarchy.relatedProducts.find((item) => item.product.slug === 'beta');
  assert.deepEqual(alphaRelations.outgoing.map((item) => item.slug), ['beta']);
  assert.deepEqual(betaRelations.incoming.map((item) => item.slug), ['alpha']);

  assert.equal(result.records.find((item) => item.id === 'products:alpha').route, '/catalog/benches/alpha/');
  assert.equal(result.records.find((item) => item.id === 'projects:city-square').route, '/vypolnennye-obekty/city-square/');
  assert.equal(result.records.find((item) => item.id === 'jobs:welder').route, '/vakansii/welder/');
  assert.ok(result.routes.some((item) => item.path === '/vypolnennye-obekty/' && item.owner.id === 'static-pages:vypolnennye-obekty'));

  const navRelation = result.relations.find((item) => item.type === 'navigation-route' && item.path === '[0].href');
  assert.equal(navRelation.target.path, '/catalog/benches/');
  assert.equal(navRelation.target.exists, true);
  const buttonRelation = result.relations.find((item) => item.type === 'content-route' && item.path === 'pageBlocks[0].buttonHref');
  assert.equal(buttonRelation.target.path, '/catalog/benches/alpha/');
  assert.equal(buttonRelation.target.exists, true);
  assert.equal(normalizeRoutePathname('/catalog/benches/?from=nav#models'), '/catalog/benches/');
  assert.equal(normalizeRoutePathname('https://example.test/catalog/'), null);
  assert.equal(normalizeRoutePathname('#models'), null);

  assert.deepEqual(result.lockedStaticSlugs, ['custom-order', 'home', 'vypolnennye-obekty']);
  assert.equal(result.routeCollisions.length, 0);
});

test('navigation envelopes retain an addressable items path', () => {
  const result = graph('envelope');
  const relation = result.relations.find((item) => item.type === 'navigation-route' && item.value.includes('from=nav'));
  assert.equal(relation.path, 'items[0].href');
  assert.equal(relation.target.path, '/catalog/benches/');
});

test('media index counts exact fields and exposes references without suggesting source deletion', () => {
  const result = graph();
  const shared = getMediaReferences(result, '/uploads/shared.jpg?cache=1#image');
  assert.equal(shared.referenceCount, 6);
  assert.equal(shared.recordCount, 6);
  assert.deepEqual(shared.references.map((reference) => `${reference.source.id}:${reference.path}`).sort(), [
    'product-sections:catalog:image',
    'product-categories:benches:gallery[0].src',
    'products:alpha:gallery[0]',
    'products:beta:image',
    'projects:city-square:image',
    'static-pages:about:trustImage'
  ].sort());
  assert.deepEqual(getMediaReferences(result, '/uploads/not-used.jpg'), {
    path: '/uploads/not-used.jpg', referenceCount: 0, recordCount: 0, references: []
  });

  const deletion = previewRelationImpact(result, { action: 'delete', collection: 'projects', slug: 'city-square' });
  assert.ok(deletion.media.every((item) => item.deleteOriginal === false));
  assert.ok(deletion.warnings.some((item) => item.code === 'MEDIA_RETAINED'));
});

test('archive is recoverable, leaves references intact, and reports descendant route impact', () => {
  const result = graph();
  const preview = previewRelationImpact(result, { action: 'archive', collection: 'product-sections', slug: 'catalog' });
  assert.equal(preview.allowed, true);
  assert.deepEqual(preview.blockers, []);
  assert.deepEqual(preview.relationUpdates[0], {
    target: { kind: 'record', id: 'product-sections:catalog', collection: 'product-sections', slug: 'catalog', title: 'Каталог' },
    path: 'isActive', from: true, to: false, reason: 'archive'
  });
  assert.deepEqual(preview.affectedRoutes.map((item) => item.from).sort(), [
    '/catalog/',
    '/catalog/benches/',
    '/catalog/benches/alpha/',
    '/catalog/benches/beta/'
  ].sort());
  assert.ok(preview.affectedRoutes.some((item) => item.from === '/catalog/benches/'));
  assert.ok(preview.affectedRoutes.some((item) => item.from === '/catalog/benches/alpha/'));
  assert.ok(preview.warnings.some((item) => item.code === 'DEPENDENT_ROUTES_HIDDEN'));
  assert.ok(preview.warnings.some((item) => item.code === 'INBOUND_REFERENCES_REMAIN'));

  const lockedButRecoverable = previewRelationImpact(result, { action: 'archive', collection: 'static-pages', slug: 'home' });
  assert.equal(lockedButRecoverable.allowed, true, 'locked slugs only block destructive delete/rename');
  assert.equal(lockedButRecoverable.relationUpdates[0].path, 'isActive');

  const unsupported = previewRelationImpact(result, { action: 'archive', collection: 'site-settings', slug: 'global' });
  assert.equal(unsupported.allowed, false);
  assert.deepEqual(unsupported.blockers.map((item) => item.code), ['ARCHIVE_UNSUPPORTED']);
});

test('hard delete blocks unresolved children, inbound related products, route links and locked records', () => {
  const result = graph();
  const sectionBlockers = findBlockingReferences(result, { action: 'delete', collection: 'product-sections', slug: 'catalog' });
  assert.ok(sectionBlockers.some((item) => item.code === 'CHILD_CATEGORY'));

  const category = previewRelationImpact(result, { action: 'delete', collection: 'product-categories', slug: 'benches' });
  assert.equal(category.allowed, false);
  assert.equal(category.blockers.filter((item) => item.code === 'CHILD_PRODUCT').length, 2);
  assert.ok(category.blockers.some((item) => item.code === 'INBOUND_ROUTE_REFERENCE' && item.reference.source.id === 'singleton:navigation'));
  assert.ok(category.blockers.some((item) => item.code === 'INBOUND_RECORD_REFERENCE' && item.reference.path.endsWith('categorySlug')));

  const beta = previewRelationImpact(result, { action: 'delete', collection: 'products', slug: 'beta' });
  assert.equal(beta.allowed, false);
  assert.ok(beta.blockers.some((item) => item.code === 'INBOUND_RELATED_PRODUCT' && item.reference.source.slug === 'alpha'));

  const alpha = previewRelationImpact(result, { action: 'delete', collection: 'products', slug: 'alpha' });
  assert.ok(alpha.blockers.some((item) => item.code === 'INBOUND_ROUTE_REFERENCE' && item.reference.source.id === 'static-pages:about'));

  for (const slug of ['home', 'vypolnennye-obekty']) {
    const locked = previewRelationImpact(result, { action: 'delete', collection: 'static-pages', slug });
    assert.ok(locked.blockers.some((item) => item.code === 'LOCKED_SLUG'));
  }
});

test('category rename previews child, explicit record, navigation and button href cascades', () => {
  const result = graph();
  const preview = previewRelationImpact(result, {
    action: 'rename', collection: 'product-categories', slug: 'benches', nextSlug: 'street-benches'
  });
  assert.equal(preview.allowed, true);
  assert.equal(preview.oldRoute, '/catalog/benches/');
  assert.equal(preview.newRoute, '/catalog/street-benches/');
  assert.deepEqual(preview.redirect, { created: false });
  assert.ok(preview.warnings.some((item) => item.code === 'NO_AUTOMATIC_REDIRECT'));

  assert.equal(updateAt(preview, 'products:alpha', 'productCategorySlug').to, 'street-benches');
  assert.equal(updateAt(preview, 'products:beta', 'productCategorySlug').to, 'street-benches');
  assert.equal(updateAt(preview, 'static-pages:about', 'pathwayCards[0].categorySlug').to, 'street-benches');
  assert.equal(updateAt(preview, 'static-pages:about', 'pathwayCards[0].buttonHref').to, '/catalog/street-benches/');
  assert.equal(updateAt(preview, 'singleton:navigation', '[0].href').to, '/catalog/street-benches/?from=nav#models');
  assert.equal(updateAt(preview, 'static-pages:about', 'pageBlocks[0].buttonHref').to, '/catalog/street-benches/alpha/?source=about#buy');
  assert.ok(preview.affectedRoutes.some((item) => item.from === '/catalog/benches/alpha/' && item.to === '/catalog/street-benches/alpha/'));
});

test('section and product rename previews cascade their stored relations and descendant URLs', () => {
  const result = graph();
  const section = previewRelationImpact(result, {
    action: 'rename', collection: 'product-sections', slug: 'catalog', nextSlug: 'street-catalog'
  });
  assert.equal(section.allowed, true);
  assert.equal(updateAt(section, 'product-categories:benches', 'parentSectionSlug').to, 'street-catalog');
  assert.ok(section.affectedRoutes.some((item) => item.from === '/catalog/benches/beta/' && item.to === '/street-catalog/benches/beta/'));

  const product = previewRelationImpact(result, {
    action: 'rename', collection: 'products', slug: 'beta', nextSlug: 'beta-new'
  });
  assert.equal(product.allowed, true);
  assert.equal(updateAt(product, 'products:alpha', 'relatedProductSlugs[0]').to, 'beta-new');
  assert.equal(product.oldRoute, '/catalog/benches/beta/');
  assert.equal(product.newRoute, '/catalog/benches/beta-new/');

  const project = previewRelationImpact(result, {
    action: 'rename', collection: 'projects', slug: 'city-square', nextSlug: 'central-square'
  });
  assert.equal(project.allowed, true);
  assert.equal(project.oldRoute, '/vypolnennye-obekty/city-square/');
  assert.equal(project.newRoute, '/vypolnennye-obekty/central-square/');
  assert.equal(updateAt(project, 'singleton:navigation', '[1].href').to, '/vypolnennye-obekty/central-square/');
});

test('rename rejects locked, reserved, duplicate, invalid and route-colliding slugs', () => {
  const result = graph();
  const locked = previewRelationImpact(result, {
    action: 'rename', collection: 'static-pages', slug: 'home', nextSlug: 'start'
  });
  assert.ok(locked.blockers.some((item) => item.code === 'LOCKED_SLUG'));

  const reserved = previewRelationImpact(result, {
    action: 'rename', collection: 'services', slug: 'installation', nextSlug: 'admin'
  });
  assert.ok(reserved.blockers.some((item) => item.code === 'RESERVED_SLUG'));
  assert.ok(reserved.blockers.some((item) => item.code === 'ROUTE_COLLISION'));

  const duplicate = previewRelationImpact(result, {
    action: 'rename', collection: 'product-sections', slug: 'catalog', nextSlug: 'other-section'
  });
  assert.ok(duplicate.blockers.some((item) => item.code === 'SLUG_COLLISION'));

  const invalid = previewRelationImpact(result, {
    action: 'rename', collection: 'products', slug: 'alpha', nextSlug: '../alpha'
  });
  assert.deepEqual(invalid.blockers.map((item) => item.code), ['INVALID_SLUG']);

  const fixedCollision = previewRelationImpact(result, {
    action: 'rename', collection: 'services', slug: 'installation', nextSlug: 'kontakty'
  });
  assert.ok(fixedCollision.blockers.some((item) => item.code === 'ROUTE_COLLISION' && item.path === '/kontakty/'));

  const settingsRename = previewRelationImpact(result, {
    action: 'rename', collection: 'site-settings', slug: 'global', nextSlug: 'other'
  });
  assert.ok(settingsRename.blockers.some((item) => item.code === 'SLUG_RENAME_UNSUPPORTED'));
  const settingsDelete = previewRelationImpact(result, {
    action: 'delete', collection: 'site-settings', slug: 'global'
  });
  assert.ok(settingsDelete.blockers.some((item) => item.code === 'DELETE_UNSUPPORTED'));
});

test('the current production corpus has a complete collision-free relation graph', async () => {
  const collectionNames = [
    'product-sections', 'product-categories', 'products', 'services',
    'projects', 'jobs', 'static-pages', 'site-settings'
  ];
  const collections = {};
  for (const collection of collectionNames) {
    const collectionPath = path.join(REPO_ROOT, 'src', 'content', collection);
    const entries = (await fs.readdir(collectionPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    collections[collection] = await Promise.all(entries.map(async (entry) => (
      JSON.parse(await fs.readFile(path.join(collectionPath, entry.name), 'utf8'))
    )));
  }
  const navigation = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'src', 'data', 'navigation.json'), 'utf8'));
  const first = buildRelationGraph({ collections, navigation });
  const second = buildRelationGraph({ collections, navigation });

  assert.deepEqual(second, first, 'graph output must be deterministic for the same corpus');
  assert.equal(first.records.length, 107);
  assert.ok(first.relations.length > 300);
  assert.ok(first.media.length > 200);
  assert.deepEqual(first.routeCollisions, []);
  assert.deepEqual(first.issues, []);
});

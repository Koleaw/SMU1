import assert from 'node:assert/strict';
import test from 'node:test';

import { assessCompleteness } from '../editors/record-editor.mjs';
import { createDraftDefaults, isOrdinaryPublicRouteAvailable, isVisibleRecord } from './editor-fields.mjs';

test('direct route visibility is independent from catalog and home placement flags', () => {
  for (const [collection, placementField] of [
    ['products', 'showInCatalog'],
    ['product-categories', 'showInSectionGrid'],
    ['product-sections', 'showOnHome'],
    ['services', 'showOnHome']
  ]) {
    assert.equal(isVisibleRecord(collection, { isActive: true, [placementField]: false }), true, collection);
    assert.equal(isVisibleRecord(collection, { isActive: false, [placementField]: true }), false, collection);
  }
  assert.equal(isVisibleRecord('site-settings', {}), null);
});

test('an active unlisted product still receives public completeness blockers', () => {
  const product = {
    ...createDraftDefaults('products', { title: 'Тестовый товар', parentSlug: 'category' }),
    isActive: true,
    showInCatalog: false,
    shortDescription: 'Краткое описание',
    leadText: 'Вводный текст',
    image: ''
  };
  const report = assessCompleteness('products', product, {
    summaries: new Map([['product-categories', [{ slug: 'category', isActive: true }]]])
  });
  assert.equal(report.publicBlockers.some((issue) => issue.path === 'image'), true);
  assert.equal(report.canSave, false);
});

test('ordinary catalog preview requires the full active route chain', () => {
  const summaries = new Map([
    ['product-sections', [
      { slug: 'active-section', isActive: true },
      { slug: 'hidden-section', isActive: false }
    ]],
    ['product-categories', [
      { slug: 'active-category', isActive: true, summary: { parentSectionSlug: 'active-section' } },
      { slug: 'hidden-category', isActive: false, summary: { parentSectionSlug: 'active-section' } },
      { slug: 'orphaned-category', isActive: true, summary: { parentSectionSlug: 'hidden-section' } }
    ]]
  ]);

  assert.equal(isOrdinaryPublicRouteAvailable('products', { isActive: true, productCategorySlug: 'active-category' }, { summaries }), true);
  assert.equal(isOrdinaryPublicRouteAvailable('products', { isActive: true, productCategorySlug: 'hidden-category' }, { summaries }), false);
  assert.equal(isOrdinaryPublicRouteAvailable('products', { isActive: true, productCategorySlug: 'orphaned-category' }, { summaries }), false);
  assert.equal(isOrdinaryPublicRouteAvailable('product-categories', { isActive: true, parentSectionSlug: 'hidden-section' }, { summaries }), false);
  assert.equal(isOrdinaryPublicRouteAvailable('product-categories', { isActive: true, parentSectionSlug: 'active-section' }, { summaries }), true);
  assert.equal(isOrdinaryPublicRouteAvailable('products', { isActive: true, productCategorySlug: 'missing' }, { summaries }), false);
});

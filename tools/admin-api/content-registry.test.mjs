import test from 'node:test';
import assert from 'node:assert/strict';
import { contentSchemas } from '../../src/content-schemas.mjs';
import {
  COLLECTION_KEYS,
  COLLECTION_REGISTRY,
  PAGE_BLOCK_REGISTRY,
  SINGLETON_KEYS,
  classifyPageBlocks,
  getCollectionDefinition,
  getPageBlockPolicy,
  getSingletonDefinition,
  listCreatablePageBlockTypes,
  requireCollectionDefinition
} from './content-registry.mjs';

test('registry covers exactly the eight Astro content schemas and both data singletons', () => {
  assert.deepEqual([...COLLECTION_KEYS].sort(), Object.keys(contentSchemas).sort());
  assert.equal(Object.keys(COLLECTION_REGISTRY).length, 8);
  assert.deepEqual(SINGLETON_KEYS, ['navigation', 'yandex']);
  assert.equal(getSingletonDefinition('navigation').storage, 'single-file-array');
  assert.equal(getSingletonDefinition('yandex').storage, 'single-file-object');
});

test('collection definitions expose write-relevant field policies', () => {
  const staticPages = getCollectionDefinition('static-pages');
  assert.equal(staticPages.supportsPageBlocks, true);
  assert.ok(staticPages.mediaFields.includes('pageBlocks[].items[].image'));
  assert.ok(staticPages.urlFields.some((field) => field.path === 'pageBlocks[].buttonHref'));

  const products = getCollectionDefinition('products');
  assert.equal(products.storage, 'directory');
  assert.deepEqual(products.mediaFields, ['image', 'gallery[]']);

  const settings = requireCollectionDefinition('site-settings');
  assert.equal(settings.fixedSlug, 'global');
  assert.ok(settings.urlFields.some((field) => field.path === 'notFoundPage.primaryHref' && field.context === 'internal'));
  assert.ok(settings.urlFields.some((field) => field.path === 'notFoundPage.secondaryHref' && field.context === 'internal'));
  assert.throws(
    () => requireCollectionDefinition('not-a-collection'),
    (error) => error.code === 'CONTENT_COLLECTION_UNKNOWN'
  );
});

test('known page blocks expose their item contract and unknown legacy blocks are no-op/read-only', () => {
  assert.equal(getPageBlockPolicy('directionCards').itemPolicy, 'cards');
  assert.equal(getPageBlockPolicy('faq').itemPolicy, 'faq');
  assert.equal(getPageBlockPolicy('listPanel').itemPolicy, 'text-list');
  assert.equal(getPageBlockPolicy('process').itemPolicy, 'steps');
  assert.equal(getPageBlockPolicy('companyProof').editorMode, 'advanced');

  const unknown = getPageBlockPolicy('retiredWidget');
  assert.deepEqual(
    {
      known: unknown.known,
      rendererSupported: unknown.rendererSupported,
      editorMode: unknown.editorMode,
      mutationPolicy: unknown.mutationPolicy,
      itemPolicy: unknown.itemPolicy
    },
    {
      known: false,
      rendererSupported: false,
      editorMode: 'read-only',
      mutationPolicy: 'no-op-only',
      itemPolicy: 'opaque'
    }
  );

  const classified = classifyPageBlocks([{ type: 'cta' }, { type: 'retiredWidget' }]);
  assert.equal(classified[0].known, true);
  assert.equal(classified[1].editorMode, 'read-only');
  assert.ok(listCreatablePageBlockTypes().some((entry) => entry.type === 'gallery'));
  assert.ok(!listCreatablePageBlockTypes().some((entry) => entry.type === 'companyProof'));
  assert.ok(Object.isFrozen(PAGE_BLOCK_REGISTRY));
});

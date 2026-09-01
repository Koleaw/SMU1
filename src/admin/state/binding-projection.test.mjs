import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  bindingOwnerDependency,
  resolveBindingProjection,
  resolveRelationMediaProjection
} from './binding-projection.mjs';

const contentReader = (records) => (collection, slug) => records.get(`${collection}:${slug}`);
const productBinding = (fieldPath, fallback, overrides = {}) => ({
  owner: { collection: 'products', slug: 'skamya-test' },
  ownerCollection: 'products',
  recordSlug: 'skamya-test',
  fieldPath,
  tool: 'long-text',
  projection: { kind: 'fallback', fallback },
  ...overrides
});

test('projection resolves scalar fallback from another authoritative owner', () => {
  const records = new Map([
    ['products:skamya-test', { customProjectTitle: '' }],
    ['site-settings:global', { productUi: { standardDefaultCustomTitle: 'Индивидуальное исполнение' } }]
  ]);
  const result = resolveBindingProjection(
    productBinding('customProjectTitle', 'site-settings.productUi.standardDefaultCustomTitle'),
    contentReader(records)
  );
  assert.deepEqual(result, { status: 'value', value: 'Индивидуальное исполнение', dependencies: [] });
});

test('projection reports a cross-owner dependency instead of emitting undefined', () => {
  const records = new Map([['products:skamya-test', { customProjectTitle: '' }]]);
  const result = resolveBindingProjection(
    productBinding('customProjectTitle', 'site-settings.productUi.standardDefaultCustomTitle'),
    contentReader(records)
  );
  assert.deepEqual(result, {
    status: 'pending',
    dependencies: [{ collection: 'site-settings', slug: 'global' }]
  });
  assert.equal(Object.hasOwn(result, 'value'), false);
});

test('a recovered draft can request its unloaded binding owner without loading unrelated cards', () => {
  assert.deepEqual(bindingOwnerDependency(productBinding('title', '')), {
    collection: 'products',
    slug: 'skamya-test'
  });
  assert.equal(bindingOwnerDependency({ fieldPath: 'title' }), null);
});

test('cross-owner fallback alternatives keep the referenced owner context', () => {
  const records = new Map([
    ['site-settings:global', { catalogUi: { sparse: { contactDefaultDescription: '' } } }],
    ['product-categories:perila', { heroDescription: '', shortDescription: 'Короткое описание категории' }]
  ]);
  const binding = {
    owner: { collection: 'site-settings', slug: 'global' },
    fieldPath: 'catalogUi.sparse.contactDefaultDescription',
    tool: 'long-text',
    projection: { kind: 'fallback', fallback: 'product-categories.perila.heroDescription || shortDescription' }
  };
  assert.deepEqual(resolveBindingProjection(binding, contentReader(records)), {
    status: 'value',
    value: 'Короткое описание категории',
    dependencies: []
  });
});

test('named stable selector resolves the authored page block without an array index', () => {
  const records = new Map([
    ['site-settings:global', { catalogUi: { hub: { customDefaultTitle: '' } } }],
    ['product-sections:ograzhdeniya-i-zabory', {
      pageBlocks: [
        { id: 'facts', type: 'listPanel', title: 'Факты', order: 10 },
        { id: 'custom', type: 'mediaText', title: 'Изготовим по задаче', order: 20 }
      ]
    }]
  ]);
  const binding = {
    owner: { collection: 'site-settings', slug: 'global' },
    fieldPath: 'catalogUi.hub.customDefaultTitle',
    tool: 'heading',
    projection: {
      kind: 'fallback',
      fallback: 'product-sections.ograzhdeniya-i-zabory.pageBlocks[mediaText].title'
    }
  };
  assert.deepEqual(resolveBindingProjection(binding, contentReader(records)), {
    status: 'value',
    value: 'Изготовим по задаче',
    dependencies: []
  });
});

test('category-order relation preserves production DOM and never auto-merges structural arrays', () => {
  for (const relatedProductSlugs of [[], ['skamya-a', 'skamya-b']]) {
    const records = new Map([['products:skamya-test', { relatedProductSlugs }]]);
    const result = resolveBindingProjection(
      productBinding('relatedProductSlugs', 'category order', { tool: 'list' }),
      contentReader(records)
    );
    assert.deepEqual(result, { status: 'preserve', reason: 'structural-fallback', dependencies: [] });
    assert.equal(Object.hasOwn(result, 'value'), false);
  }

  const records = new Map([['products:skamya-test', { features: [] }], ['products:fallback', { features: ['x'] }]]);
  const directEmpty = resolveBindingProjection(
    productBinding('features', 'products.fallback.features', { tool: 'list' }),
    contentReader(records)
  );
  assert.deepEqual(directEmpty, { status: 'value', value: [], dependencies: [] });
});

test('relation and derived tools preserve renderer-owned structures', () => {
  const records = new Map([['products:skamya-test', { relatedProductSlugs: ['skamya-a'] }]]);
  for (const binding of [
    productBinding('relatedProductSlugs', '', { tool: 'relation-list', projection: { kind: 'direct' } }),
    productBinding('relatedProductSlugs', '', { tool: 'list', projection: { kind: 'derived', formula: 'category order' } }),
    productBinding('order', '', { tool: 'reorder-item', projection: { kind: 'direct' } })
  ]) {
    const result = resolveBindingProjection(binding, contentReader(records));
    assert.equal(result.status, 'preserve');
    assert.equal(Object.hasOwn(result, 'value'), false);
  }
});

test('declared borrowed project media resolves through the selected relation dependency', () => {
  const binding = productBinding('companyHeroProjectSlug', '', {
    owner: { collection: 'static-pages', slug: 'o-nas' },
    ownerCollection: 'static-pages',
    recordSlug: 'o-nas',
    tool: 'relation-select',
    relationCollection: 'projects',
    relationProjection: {
      mediaBindingId: 'company-hero-project-media-binding',
      mediaFieldPaths: ['presentation.detailHeroMedia', 'presentation.archiveCoverMedia', 'presentation.publicGallery']
    }
  });
  const ownerOnly = new Map([['static-pages:o-nas', { companyHeroProjectSlug: 'new-project' }]]);
  assert.deepEqual(resolveRelationMediaProjection(binding, contentReader(ownerOnly)), {
    status: 'pending',
    dependencies: [{ collection: 'projects', slug: 'new-project' }]
  });
  ownerOnly.set('projects:new-project', {
    title: 'Новый объект',
    presentation: {
      detailHeroMedia: '',
      archiveCoverMedia: '',
      publicGallery: ['/uploads/new-project.jpg'],
      altOverrides: { '/uploads/new-project.jpg': 'Новый объект после завершения работ' }
    }
  });
  assert.deepEqual(resolveRelationMediaProjection(binding, contentReader(ownerOnly)), {
    status: 'value',
    value: {
      mediaBindingId: 'company-hero-project-media-binding',
      targetOwner: { collection: 'projects', slug: 'new-project' },
      sourceFieldPath: 'presentation.publicGallery[0]',
      mediaPath: '/uploads/new-project.jpg',
      alt: 'Новый объект после завершения работ',
      sourcePosition: '50% 50%',
      title: 'Новый объект'
    },
    dependencies: []
  });
});

test('ordered project relation resolves its new first source after reorder', () => {
  const binding = {
    owner: { collection: 'static-pages', slug: 'home' },
    fieldPath: 'gatewayProjectSlugs',
    tool: 'relation-list',
    relationCollections: ['projects'],
    relationCollection: 'projects',
    relationProjection: {
      mediaBindingId: 'home-project-gateway-visible-frame',
      mediaFieldPaths: ['presentation.archiveCoverMedia', 'presentation.publicGallery', 'presentation.detailHeroMedia']
    }
  };
  const records = new Map([
    ['static-pages:home', { gatewayProjectSlugs: ['project-b', 'project-a'] }],
    ['projects:project-b', {
      title: 'Проект Б',
      presentation: { archiveCoverMedia: '/uploads/b.jpg', archiveCoverPosition: '25% 70%' }
    }]
  ]);
  assert.deepEqual(resolveRelationMediaProjection(binding, contentReader(records)), {
    status: 'value',
    value: {
      mediaBindingId: 'home-project-gateway-visible-frame',
      targetOwner: { collection: 'projects', slug: 'project-b' },
      sourceFieldPath: 'presentation.archiveCoverMedia',
      mediaPath: '/uploads/b.jpg',
      alt: 'Проект Б',
      sourcePosition: '25% 70%',
      title: 'Проект Б'
    },
    dependencies: []
  });
});

test('company gateway projection follows the renderer offset and skips text-only relations', () => {
  const binding = {
    owner: { collection: 'static-pages', slug: 'about' },
    fieldPath: 'gatewayProjectSlugs',
    tool: 'relation-list',
    relationCollections: ['projects'],
    relationProjection: {
      mediaBindingId: 'company-gateway-visible-frame',
      mediaFieldPaths: ['presentation.archiveCoverMedia', 'presentation.publicGallery'],
      strategy: 'gateway-frame',
      frameOffset: 1
    }
  };
  const records = new Map([
    ['static-pages:about', { gatewayProjectSlugs: ['project-a', 'text-only', 'project-c'] }],
    ['projects:project-a', {
      title: 'Проект А',
      presentation: { archiveCoverMedia: '/uploads/a.jpg', mediaRoles: { '/uploads/a.jpg': ['finished-result'] } }
    }],
    ['projects:text-only', { title: 'Только текст', presentation: { publicGallery: [], mediaRoles: {} } }],
    ['projects:project-c', {
      title: 'Проект В',
      presentation: { archiveCoverMedia: '/uploads/c.jpg', mediaRoles: { '/uploads/c.jpg': ['proof'] } }
    }]
  ]);
  const result = resolveRelationMediaProjection(binding, contentReader(records));
  assert.equal(result.value.targetOwner.slug, 'project-c');
  assert.equal(result.value.mediaPath, '/uploads/c.jpg');
});

test('borrowed media alt falls back to the authored raw project media item', () => {
  const binding = {
    owner: { collection: 'static-pages', slug: 'custom-order' },
    fieldPath: 'customOrderHeroProjectSlug',
    tool: 'relation-select',
    relationCollection: 'projects',
    relationProjection: { mediaBindingId: 'custom-order-visible-media', mediaFieldPaths: ['presentation.detailHeroMedia'] }
  };
  const records = new Map([
    ['static-pages:custom-order', { customOrderHeroProjectSlug: 'project-a' }],
    ['projects:project-a', {
      title: 'Проект А',
      gallery: [{ src: '/uploads/a.jpg', alt: 'Авторский alt исходного кадра' }],
      presentation: { detailHeroMedia: '/uploads/a.jpg' }
    }]
  ]);
  const result = resolveRelationMediaProjection(binding, contentReader(records));
  assert.equal(result.value.alt, 'Авторский alt исходного кадра');
});

test('shared media remains renderer-safe but can project through its dedicated media tool', () => {
  const records = new Map([['projects:new-project', { presentation: { detailHeroMedia: '/uploads/new-project.jpg' } }]]);
  const result = resolveBindingProjection({
    owner: { collection: 'projects', slug: 'new-project' },
    fieldPath: 'presentation.detailHeroMedia',
    tool: 'media',
    projection: { kind: 'shared-media' }
  }, contentReader(records));
  assert.deepEqual(result, { status: 'value', value: '/uploads/new-project.jpg', dependencies: [] });
});

test('visual editor wires resolver dependencies and never evaluates fallback as an owner-local path', async () => {
  const source = await readFile(new URL('../shell/visual-editor-app.mjs', import.meta.url), 'utf8');
  assert.match(source, /resolveBindingProjection\(row\.binding, projectionRecordContent\)/u);
  assert.match(source, /resolution\.status === 'pending'/u);
  assert.match(source, /hydrateProjectionDependencies\(dependencies\)/u);
  assert.match(source, /state\.draftKeys\.has\(recordKey\(ownerDependency\.collection, ownerDependency\.slug\)\)/u);
  assert.match(source, /if \(resolution\.status !== 'value'\) continue;/u);
  assert.match(source, /state\.records\.set\(key, record\);\s*if \(!deepEqual\(initial, payload\.content\)\) record\.history\.commit/u);
  assert.match(source, /state\.records\.set\(key, record\);\s*if \(!deepEqual\(initial, canonical\)\) record\.history\.commit/u);
  assert.doesNotMatch(source, /getAtPath\(content, fallbackPath\)/u);
});

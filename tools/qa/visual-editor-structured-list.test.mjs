import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createStructuredListItem,
  declaredStructuredListFields
} from '../../src/admin/shell/visual-editor-app.mjs';
import {
  objectListBindingSupportsMedia,
  structuredObjectListBindingIssues
} from './structured-list-binding.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const itemFields = [
  { fieldPath: 'id', tool: 'generated-id' },
  { fieldPath: 'title', label: 'Название', tool: 'short-text' },
  { fieldPath: 'text', label: 'Описание', tool: 'long-text' },
  { fieldPath: 'image', label: 'Фотография', tool: 'media', role: 'card' },
  { fieldPath: 'order', tool: 'generated-order' },
  { fieldPath: 'isActive', tool: 'visibility' }
];

test('fresh structured item is built only from declared fields and never clones a stale sample', () => {
  const created = createStructuredListItem(itemFields, 2, { randomUUID: () => 'fresh-id' });
  assert.deepEqual(created, {
    id: 'fresh-id', title: '', text: '', image: '', order: 30, isActive: true
  });
  assert.equal(Object.hasOwn(created, 'buttonHref'), false);
  assert.equal(Object.hasOwn(created, 'privateLegacyMedia'), false);
});

test('structured field normalization rejects unsafe paths and preserves an explicit nested list contract', () => {
  const fields = declaredStructuredListFields({ itemFields: [
    { fieldPath: '__proto__.polluted', tool: 'short-text' },
    {
      fieldPath: 'items', tool: 'list', itemKind: 'object', itemFields: [
        { fieldPath: 'label', tool: 'long-text' }
      ]
    }
  ] });
  assert.deepEqual(fields, [{
    fieldPath: 'items', label: '', tool: 'list', itemKind: 'object',
    itemFields: [{ fieldPath: 'label', label: '', tool: 'long-text' }]
  }]);
});

test('route passport fails closed when an object wrapper cannot edit descendant copy or media', () => {
  const record = { cards: [{ id: 'one', title: 'Карточка', text: 'Видимое описание', image: '/uploads/card.jpg' }] };
  const generic = {
    tool: 'list', itemKind: 'object', fieldPath: 'cards', stableItemId: 'one',
    itemFields: [{ fieldPath: 'title', tool: 'short-text' }],
    domTarget: {
      ownedBusinessText: ['Карточка', 'Видимое описание'], ownedMedia: 1,
      ownedListItems: [{ id: 'one', fields: ['title'] }]
    }
  };
  const issues = structuredObjectListBindingIssues(generic, record);
  assert.ok(issues.includes('object-list-unmapped-text:Видимое описание'));
  assert.ok(issues.includes('object-list-unmapped-media'));
  assert.equal(objectListBindingSupportsMedia(generic), false);
});

test('explicit structured contract covers nested text, generated ordinal, and role-bound media', () => {
  const record = {
    cards: [{
      id: 'one', title: 'Карточка', text: 'Видимое описание', image: '/uploads/card.jpg',
      items: [{ id: 'nested', label: 'Вложенный пункт', order: 10, isActive: true }]
    }]
  };
  const binding = {
    tool: 'list', itemKind: 'object', fieldPath: 'cards', stableItemId: 'one',
    itemFields: [
      { fieldPath: 'ordinal', tool: 'computed', formula: 'Позиция элемента в списке' },
      ...itemFields,
      {
        fieldPath: 'items', tool: 'list', itemKind: 'object', itemFields: [
          { fieldPath: 'label', tool: 'long-text' }
        ]
      }
    ],
    domTarget: {
      ownedBusinessText: ['01', 'Карточка', 'Видимое описание', 'Вложенный пункт'], ownedMedia: 1,
      ownedListItems: [
        { id: 'one', fields: ['ordinal', 'title', 'text', 'image', 'items'] },
        { id: 'nested', fields: ['label'] }
      ]
    }
  };
  assert.deepEqual(structuredObjectListBindingIssues(binding, record), []);
  assert.equal(objectListBindingSupportsMedia(binding), true);
});

test('route passport rejects declared editable fields and unstable generated ids without exact DOM occurrences', () => {
  const record = { cards: [{ title: 'Карточка', text: '', image: '' }] };
  const binding = {
    tool: 'list', itemKind: 'object', fieldPath: 'cards',
    itemFields,
    domTarget: {
      ownedBusinessText: ['Карточка'], ownedMedia: 0,
      ownedListItems: [{ id: '0', fields: ['title'] }]
    }
  };
  const issues = structuredObjectListBindingIssues(binding, record);
  assert.ok(issues.includes('object-list-item-id-missing:items[0]'));
  assert.ok(issues.some((issue) => issue.endsWith('.text')));
  assert.ok(issues.some((issue) => issue.endsWith('.image')));
});

test('visual list inspector renders every declared field and routes nested media through the unified uploader', () => {
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  assert.match(editor, /declaredStructuredListFields\(binding\)/u);
  assert.match(editor, /field\.tool === 'list'/u);
  assert.match(editor, /field\.tool === 'media'/u);
  assert.match(editor, /void openMedia\(\{/u);
  assert.match(editor, /current\.push\(structured \? createStructuredListItem\(fields, current\.length\) : ''\)/u);
  assert.doesNotMatch(editor, /\{ \.\.\.sample, id: crypto\.randomUUID\(\)/u);
});

test('legacy primitive lists are field-editable but cannot add, delete, or reorder by index identity', () => {
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  assert.match(editor, /stableStructuredItems = structured && fields\.some/u);
  assert.match(editor, /canReorder = stableStructuredItems && binding\.permissions\?\.reorder === true/u);
  assert.match(editor, /if \(canReorder\) row\.append\(handle\)/u);
  assert.match(editor, /if \(canDelete\) row\.append\(remove\)/u);
  assert.match(editor, /if \(canAdd\) target\.append\(add\)/u);
  assert.match(editor, /legacy-списка нет постоянных идентификаторов/u);
  for (const sourcePath of [
    'src/components/v2/directions/DirectionV2Brief.astro',
    'src/components/v2/directions/DirectionV2Scope.astro',
    'src/components/v2/engineering/EngineeringDirectionScope.astro',
    'src/components/v2/place/PlaceDirectionBrief.astro',
    'src/components/v2/place/PlaceDirectionContexts.astro',
    'src/components/v2/project/ProjectDirectionBrief.astro',
    'src/components/v2/project/ProjectDirectionContexts.astro'
  ]) {
    const source = read(sourcePath);
    assert.doesNotMatch(source, /adminListItem|stableItemId:\s*(?:String\()?index/u, sourcePath);
    assert.match(source, /adminListValue\(Astro\.url\)/u, sourcePath);
  }
});

test('every current generic object-list source declares itemFields', () => {
  const directSources = [
    'src/components/v2/CatalogStandardProductV2.astro',
    'src/components/v2/CatalogPremiumProductV2.astro',
    'src/components/v2/home-final/HomeFinal.astro',
    'src/components/v2/custom-order/CustomOrderV2Page.astro',
    'src/components/v2/practical/V2CompanyPage.astro',
    'src/components/v2/V2CatalogSparseState.astro',
    'src/components/v2/practical/V2PrivacyPolicy.astro',
    'src/components/v2/practical/V2ContactsPage.astro'
  ];
  for (const sourcePath of directSources) {
    const source = read(sourcePath);
    const occurrences = [...source.matchAll(/itemKind:\s*'object'/gu)];
    assert.ok(occurrences.length > 0, sourcePath);
    for (const occurrence of occurrences) {
      assert.match(source.slice(occurrence.index, occurrence.index + 1200), /itemFields:\s*\[/u, sourcePath);
    }
  }
  for (const sourcePath of [
    'src/components/v2/pages/CanopiesV2Page.astro',
    'src/components/v2/pages/TopiaryV2Page.astro',
    'src/components/v2/pages/LandscapingV2Page.astro',
    'src/components/v2/pages/MetalworksV2Page.astro',
    'src/components/v2/pages/ConstructionV2Page.astro'
  ]) {
    assert.match(read(sourcePath), /itemFields: itemKind === 'object' \? \[/u, sourcePath);
  }
});

test('direction object-list contracts expose only fields rendered by each production variant', () => {
  const contract = (relativePath) => {
    const source = read(relativePath);
    return source.slice(source.indexOf('const blockBinding'), source.indexOf('\n---', source.indexOf('const blockBinding')));
  };
  const canopies = contract('src/components/v2/pages/CanopiesV2Page.astro');
  const topiary = contract('src/components/v2/pages/TopiaryV2Page.astro');
  const metalworks = contract('src/components/v2/pages/MetalworksV2Page.astro');
  const landscaping = contract('src/components/v2/pages/LandscapingV2Page.astro');
  const construction = contract('src/components/v2/pages/ConstructionV2Page.astro');
  assert.doesNotMatch(canopies, /fieldPath: 'image'/u);
  assert.match(topiary, /fieldPath: 'image'[\s\S]*role: 'card'/u);
  assert.doesNotMatch(metalworks, /fieldPath: 'image'/u);
  assert.doesNotMatch(landscaping, /fieldPath: 'image'|fieldPath: 'ordinal'/u);
  assert.doesNotMatch(construction, /fieldPath: 'image'|fieldPath: 'ordinal'/u);
  assert.match(metalworks, /field === 'items'/u);
});

test('rendered direction object items and product specifications use persisted unique ids', () => {
  for (const relativePath of [
    'src/content/product-sections/navesy.json',
    'src/content/product-sections/topiarii.json',
    'src/content/product-sections/metallokonstruktsii-dlya-biznesa.json',
    'src/content/product-sections/ograzhdeniya-i-zabory.json',
    'src/content/services/blagoustroystvo.json',
    'src/content/services/stroitelstvo.json',
    'src/content/static-pages/about.json'
  ]) {
    const record = JSON.parse(read(relativePath));
    for (const block of record.pageBlocks || []) {
      for (const key of ['items', 'steps']) {
        const objects = (block[key] || []).filter((item) => item && typeof item === 'object');
        if (!objects.length) continue;
        assert.ok(objects.every((item) => typeof item.id === 'string' && item.id), `${relativePath}:${block.type}.${key}`);
        assert.equal(new Set(objects.map((item) => item.id)).size, objects.length, `${relativePath}:${block.type}.${key}`);
      }
    }
  }
  const productFiles = fs.readdirSync(path.join(ROOT, 'src/content/products')).filter((name) => name.endsWith('.json'));
  for (const name of productFiles) {
    const product = JSON.parse(read(`src/content/products/${name}`));
    if (!product.dimensions?.length) continue;
    assert.ok(product.dimensions.every((item) => typeof item.id === 'string' && item.id), name);
    assert.equal(new Set(product.dimensions.map((item) => item.id)).size, product.dimensions.length, name);
  }
  for (const relativePath of [
    'src/components/v2/directions/DirectionV2Types.astro',
    'src/components/v2/engineering/EngineeringDirectionTasks.astro',
    'src/components/v2/engineering/EngineeringDirectionBrief.astro',
    'src/components/v2/place/PlaceDirectionScope.astro',
    'src/components/v2/project/ProjectDirectionScope.astro'
  ]) assert.match(read(relativePath), /adminListItem\(Astro\.url, item\.id\)/u, relativePath);
});

test('both product renderers use a dedicated complete structured spec projector', () => {
  const layout = read('src/layouts/PublicV2Layout.astro');
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  for (const relativePath of [
    'src/components/v2/CatalogStandardProductV2.astro',
    'src/components/v2/CatalogPremiumProductV2.astro'
  ]) {
    const source = read(relativePath);
    assert.match(source, /target: 'product-specifications'/u, relativePath);
    assert.match(source, /adminListItem\(Astro\.url, item\.id\)/u, relativePath);
    assert.match(source, /adminListField\(Astro\.url, 'label'\)/u, relativePath);
    assert.match(source, /data-smu1-list-transform/u, relativePath);
  }
  assert.match(editor, /projectionTarget: row\.binding\.projection\?\.target/u);
  assert.match(layout, /projectProductSpecifications/u);
  assert.match(layout, /payload\.projectionTarget === 'product-specifications'/u);
  assert.match(layout, /element\.replaceChildren\(\)/u);
  assert.match(layout, /left\.order - right\.order/u);
  assert.match(layout, /item\.isActive !== false/u);
  assert.match(layout, /genericLabels/u);
});

test('structured marker projection moves stable nodes and clones only for explicit new ids', () => {
  const layout = read('src/layouts/PublicV2Layout.astro');
  const start = layout.indexOf('const projectStructuredMarkers');
  const source = layout.slice(start, layout.indexOf('const projectProductSpecifications', start));
  assert.match(source, /directListItems\(element\)/u);
  assert.match(source, /new Map\(marked\.map/u);
  assert.match(source, /byId\.get\(itemId\)/u);
  assert.match(source, /template\.cloneNode\(true\)/u);
  assert.match(source, /marked\.filter\(\(item\) => !used\.has\(item\)\)/u);
  assert.match(source, /ordered\.forEach\(\(item\) => element\.append\(item\)\)/u);
});

test('string-list bridge prefers explicit values and never overwrites aria-hidden numbering', () => {
  const layout = read('src/layouts/PublicV2Layout.astro');
  const scope = read('src/components/v2/directions/DirectionV2Scope.astro');
  const contexts = read('src/components/v2/project/ProjectDirectionContexts.astro');
  assert.match(layout, /element\.matches\?\.\('\[data-smu1-list-value\]'\)/u);
  assert.match(layout, /!node\.closest\('\[aria-hidden="true"\],\[inert\]'\)/u);
  assert.match(layout, /node\.nodeType === Node\.TEXT_NODE/u);
  assert.match(scope, /aria-hidden="true"[\s\S]*adminListValue/u);
  assert.match(contexts, /aria-hidden="true"[\s\S]*adminListValue/u);
});

test('optional structured text and media occurrences are stable editor-only targets', () => {
  const types = read('src/components/v2/directions/DirectionV2Types.astro');
  const layout = read('src/layouts/PublicV2Layout.astro');
  assert.match(types, /data-smu1-list-optional-media/u);
  assert.match(types, /data-smu1-list-optional-field/u);
  assert.match(layout, /data-smu1-list-media-host/u);
  assert.match(layout, /optionalField\.hidden/u);
});

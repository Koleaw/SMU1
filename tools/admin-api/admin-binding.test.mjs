import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { REPO_ROOT } from './test-helpers/corpus-fixture.mjs';

const sourcePath = path.join(REPO_ROOT, 'src/admin/bindings/adminBinding.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const loadModule = async (localAdmin) => {
  const withFlag = compiled.replaceAll(
    'import.meta.env.SMU1_LOCAL_ADMIN',
    JSON.stringify(localAdmin ? 'true' : 'false')
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(withFlag).toString('base64')}`;
  return import(moduleUrl);
};
const publicModule = await loadModule(false);
const localAdminModule = await loadModule(true);
const { stableBindingId } = publicModule;

test('long binding IDs retain a deterministic collision-resistant suffix', () => {
  const url = new URL('http://127.0.0.1/catalog/example/');
  const definition = {
    renderer: { family: 'catalog', variant: 'standard', version: 'h6-v1' },
    owner: { collection: 'products', slug: 'example' },
    fieldPath: `gallery[0].${'nested'.repeat(45)}`,
    stableItemId: `${'shared-prefix-'.repeat(30)}first`
  };
  const first = stableBindingId(url, definition);
  const second = stableBindingId(url, { ...definition, stableItemId: `${'shared-prefix-'.repeat(30)}second` });
  assert.ok(first.length <= 240);
  assert.ok(second.length <= 240);
  assert.notEqual(first, second);
  assert.equal(first, stableBindingId(url, definition));
  assert.match(first, /-[0-9a-f]{16}$/u);
});

test('admin disposition is emitted only for an explicit local editor session', () => {
  const definition = {
    kind: 'derived',
    reason: 'The label follows the set of visible sections.',
    source: 'src/components/v2/pages/MetalworksV2Page.astro#sectionNavItems',
    tool: 'page-settings'
  };
  const editorUrl = new URL('http://127.0.0.1/metallokonstruktsii-dlya-biznesa/?__smu1_editor=1&editorSession=01234567-89ab-4cde-8fab-0123456789ab&editorRevision=7');

  assert.deepEqual(publicModule.adminDisposition(editorUrl, definition), {});
  assert.deepEqual(localAdminModule.adminDisposition(new URL('http://127.0.0.1/metallokonstruktsii-dlya-biznesa/'), definition), {});
  assert.deepEqual(localAdminModule.adminDisposition(editorUrl, definition), {
    'data-smu1-editor-disposition': 'derived',
    'data-smu1-editor-reason': definition.reason,
    'data-smu1-editor-source': definition.source,
    'data-smu1-editor-tool': 'page-settings'
  });
});

test('admin disposition rejects blank provenance in the local canvas', () => {
  const editorUrl = new URL('http://127.0.0.1/?__smu1_editor=1&editorSession=01234567-89ab-4cde-8fab-0123456789ab&editorRevision=1');
  assert.throws(() => localAdminModule.adminDisposition(editorUrl, {
    kind: 'template-fixed', reason: '   ', source: 'src/components/Header.astro'
  }), /non-empty reason and source/u);
});

test('relation target metadata is admin-only and survives binding serialization', () => {
  const editorUrl = new URL('http://127.0.0.1/izgotovlenie-na-zakaz/?__smu1_editor=1&editorSession=01234567-89ab-4cde-8fab-0123456789ab&editorRevision=3');
  const definition = {
    renderer: { family: 'custom-order', variant: 'production' },
    owner: { collection: 'static-pages', slug: 'custom-order' },
    fieldPath: 'relatedDirectionSlugs',
    tool: 'relation-list',
    relationCollection: 'projects',
    relationCollections: ['product-sections', 'services', 'services'],
    relationProjection: {
      mediaBindingId: 'custom-order-visible-media',
      mediaFieldPaths: ['presentation.detailHeroMedia', 'presentation.detailHeroMedia'],
      positionFields: [{ fieldPath: 'customOrderHeroPosition', cssProperty: '--custom-order-hero-position' }],
      applySourcePosition: true
    }
  };

  assert.deepEqual(publicModule.adminBinding(editorUrl, definition), {});
  const attributes = localAdminModule.adminBinding(editorUrl, definition);
  const binding = JSON.parse(attributes['data-smu1-binding']);
  assert.equal(binding.relationCollection, 'projects');
  assert.deepEqual(binding.relationCollections, ['product-sections', 'services']);
  assert.deepEqual(binding.relationProjection, {
    mediaBindingId: 'custom-order-visible-media',
    mediaFieldPaths: ['presentation.detailHeroMedia'],
    positionFields: [{ fieldPath: 'customOrderHeroPosition', cssProperty: '--custom-order-hero-position' }],
    applySourcePosition: true
  });
  assert.equal(binding.tool, 'relation-list');
  assert.equal(binding.fieldPath, 'relatedDirectionSlugs');
});

test('structured object-list field contract is admin-only and survives nested serialization', () => {
  const editorUrl = new URL('http://127.0.0.1/izgotovlenie-na-zakaz/?__smu1_editor=1&editorSession=01234567-89ab-4cde-8fab-0123456789ab&editorRevision=4');
  const itemFields = [
    { fieldPath: 'id', tool: 'generated-id' },
    { fieldPath: 'title', label: 'Тема', tool: 'short-text' },
    {
      fieldPath: 'items', label: 'Пункты', tool: 'list', itemKind: 'object',
      itemFields: [
        { fieldPath: 'label', label: 'Пункт', tool: 'long-text' },
        { fieldPath: 'order', tool: 'generated-order' }
      ]
    }
  ];
  const definition = {
    renderer: { family: 'custom-order', variant: 'production' },
    owner: { collection: 'static-pages', slug: 'custom-order' },
    fieldPath: 'customOrderChangeThemes',
    tool: 'list', itemKind: 'object', itemFields
  };

  assert.deepEqual(publicModule.adminBinding(editorUrl, definition), {});
  const binding = JSON.parse(localAdminModule.adminBinding(editorUrl, definition)['data-smu1-binding']);
  assert.deepEqual(binding.itemFields, itemFields);
  itemFields[1].label = 'Изменено после сериализации';
  assert.equal(binding.itemFields[1].label, 'Тема');
});

test('list structure markers are emitted only inside an exact local canvas session', () => {
  const editorUrl = new URL('http://127.0.0.1/?__smu1_editor=1&editorSession=01234567-89ab-4cde-8fab-0123456789ab&editorRevision=5');
  assert.deepEqual(publicModule.adminListItem(editorUrl, 'stable-item'), {});
  assert.deepEqual(publicModule.adminListField(editorUrl, 'items.label'), {});
  assert.deepEqual(publicModule.adminListValue(editorUrl), {});
  assert.deepEqual(localAdminModule.adminListItem(editorUrl, 'stable-item'), { 'data-smu1-list-item': 'stable-item' });
  assert.deepEqual(localAdminModule.adminListField(editorUrl, 'items.label'), { 'data-smu1-list-field': 'items.label' });
  assert.deepEqual(localAdminModule.adminListValue(editorUrl), { 'data-smu1-list-value': 'true' });
  assert.throws(() => localAdminModule.adminListItem(editorUrl, ' '), /stable item id/u);
  assert.throws(() => localAdminModule.adminListField(editorUrl, '__proto__.polluted'), /safe relative field path/u);
});

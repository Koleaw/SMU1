import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  moveRelationValue,
  relationCandidatesForBinding,
  relationTargetCollections
} from '../../src/admin/shell/visual-editor-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

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
});

test('structured project directions open their dedicated relation inspector and keep renderer DOM', () => {
  const editor = read('src/admin/shell/visual-editor-app.mjs');
  const projection = read('src/admin/state/binding-projection.mjs');
  assert.match(editor, /binding\.tool === 'project-direction-relations'\) renderProjectDirectionRelationsInspector\(record\)/u);
  assert.match(editor, /chooser\.dataset\.relationTool = 'project-direction-relations'/u);
  assert.match(editor, /Название связанного направления/u);
  assert.match(editor, /Подпись связанного направления/u);
  assert.match(editor, /updateCopy\('label', labelInput\.value\)/u);
  assert.match(editor, /updateCopy\('context', contextInput\.value\)/u);
  assert.match(editor, /__smu1ProjectDirectionProjection: true/u);
  const layout = read('src/layouts/PublicV2Layout.astro');
  assert.match(layout, /value\.__smu1ProjectDirectionProjection === true/u);
  assert.match(layout, /element\.replaceChildren\(\.\.\.rows\)/u);
  assert.match(projection, /PRESERVED_TOOLS = new Set\(\['relation-select', 'relation-list', 'project-direction-relations', 'reorder-item'\]\)/u);
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

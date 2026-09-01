import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { contentSchemas } from '../../src/content-schemas.mjs';
import { groupsForCollection } from '../../src/admin/metadata/editor-fields.mjs';
import { orderedDirectionItems } from '../../src/admin/state/direction-presentation-editor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));
const files = {
  'product-sections': fs.readdirSync(path.join(ROOT, 'src/content/product-sections')).filter((name) => name.endsWith('.json')),
  services: fs.readdirSync(path.join(ROOT, 'src/content/services')).filter((name) => name.endsWith('.json')),
  'product-categories': fs.readdirSync(path.join(ROOT, 'src/content/product-categories')).filter((name) => name.endsWith('.json'))
};
const corpus = new Map(Object.entries(files).map(([collection, names]) => [collection, names.map((name) => readJson(`src/content/${collection}/${name}`))]));
const presentations = [...corpus.get('product-sections'), ...corpus.get('services')]
  .filter((record) => record.directionPresentation);
const componentBySlug = new Map([
  ['navesy-i-kozyrki', 'src/components/v2/pages/CanopiesV2Page.astro'],
  ['topiarii', 'src/components/v2/pages/TopiaryV2Page.astro'],
  ['metallokonstruktsii-dlya-biznesa', 'src/components/v2/pages/MetalworksV2Page.astro'],
  ['blagoustroystvo-territoriy', 'src/components/v2/pages/LandscapingV2Page.astro'],
  ['stroitelstvo-i-remonty', 'src/components/v2/pages/ConstructionV2Page.astro']
]);

test('every specialized direction has a valid presentation whose anchors reconcile with its exact renderer', () => {
  assert.equal(presentations.length, 5);
  for (const record of presentations) {
    const collection = corpus.get('services').some((candidate) => candidate.slug === record.slug) ? 'services' : 'product-sections';
    const parsed = contentSchemas[collection].safeParse(record);
    assert.equal(parsed.success, true, `${collection}:${record.slug} must satisfy the authoritative content schema`);
    const componentPath = componentBySlug.get(record.slug);
    assert.ok(componentPath, `renderer variant missing for ${record.slug}`);
    const renderer = read(componentPath);
    for (const { item } of orderedDirectionItems(record.directionPresentation.sectionNav.items)) {
      assert.ok(
        renderer.includes(`'${item.id}'`) || renderer.includes(`\"${item.id}\"`),
        `${record.slug} nav item ${item.id} must be reconciled by its concrete renderer`
      );
    }
    const navIds = record.directionPresentation.sectionNav.items.map((item) => item.id);
    assert.equal(new Set(navIds).size, navIds.length, `${record.slug} nav ids must be stable and unique`);
    const relatedIds = record.directionPresentation.related.items.map((item) => item.id);
    assert.equal(new Set(relatedIds).size, relatedIds.length, `${record.slug} related ids must be stable and unique`);
    const relatedTargets = record.directionPresentation.related.items.map((item) => `${item.targetCollection}:${item.targetSlug}`);
    assert.equal(new Set(relatedTargets).size, relatedTargets.length, `${record.slug} related targets must not repeat`);
    for (const item of record.directionPresentation.related.items) {
      const target = corpus.get(item.targetCollection)?.find((candidate) => candidate.slug === item.targetSlug);
      assert.ok(target, `${record.slug} relation ${item.id} target must exist`);
      assert.notEqual(target.isActive, false, `${record.slug} relation ${item.id} must not create a link to a hidden route`);
    }
  }
});

test('direction arrays use typed controls in visual settings and the shared secondary editor', () => {
  for (const collection of ['product-sections', 'services']) {
    const presentation = groupsForCollection(collection).find((group) => group.id === 'direction-presentation');
    assert.equal(presentation.fields.find((field) => field.path === 'directionPresentation.sectionNav.items')?.kind, 'direction-section-nav');
    assert.equal(presentation.fields.find((field) => field.path === 'directionPresentation.related.items')?.kind, 'direction-related');
  }
  const visual = read('src/admin/shell/visual-editor-app.mjs');
  assert.match(visual, /directionSectionNavEditor\(record\)/u);
  assert.match(visual, /directionRelatedChooser\(record, candidates\)/u);
  assert.match(visual, /settingsBody\.append\(directionSectionNavEditor\(record\), directionRelatedChooser\(record, candidates\)\)/u);
  const secondary = read('src/admin/editors/record-editor.mjs');
  assert.match(secondary, /direction-section-nav/u);
  assert.match(secondary, /direction-related/u);
  assert.doesNotMatch(
    read('src/admin/metadata/editor-fields.mjs'),
    /directionPresentation\.(?:sectionNav|related)\.items'[^\n]*json-readonly/u
  );
});

test('production components expose admin-only in-record reorder zones without layout wrappers', () => {
  const presentation = read('src/components/v2/directions/directionPresentation.ts');
  assert.match(presentation, /zoneId: `direction-section-nav:\$\{owner\.collection\}:\$\{owner\.slug\}`/u);
  assert.match(presentation, /zoneId: `direction-related:\$\{owner\.collection\}:\$\{owner\.slug\}`/u);
  assert.match(presentation, /fieldPath:[\s\S]*?'sectionNav\.items'[\s\S]*?'reorder-item'/u);
  assert.match(presentation, /fieldPath:[\s\S]*?'related\.items'[\s\S]*?'reorder-item'/u);
  assert.match(read('src/components/v2/V2SectionNav.astro'), /<li class="v2-section-nav__item" \{\.\.\.item\.reorderEditor\}>/u);
  assert.match(read('src/components/v2/directions/DirectionV2Related.astro'), /<li \{\.\.\.item\.reorderEditor\}>/u);
  const visual = read('src/admin/shell/visual-editor-app.mjs');
  assert.match(visual, /Array\.isArray\(items\).*items\.every/u);
  assert.match(visual, /orderedDirectionItems\(items\)/u);
});

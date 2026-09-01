import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { reorderEntityKind, reorderEntityPages } from '../../src/admin/state/entity-reorder.mjs';
import { contentSchemas } from '../../src/content-schemas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

test('both production catalog hubs have deterministic schema-backed category order', () => {
  const categories = fs.readdirSync(path.join(ROOT, 'src/content/product-categories'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(`src/content/product-categories/${name}`));

  for (const sectionSlug of ['ulichnaya-mebel', 'ograzhdeniya-i-zabory']) {
    const visible = categories
      .filter((category) => category.parentSectionSlug === sectionSlug && category.isActive && category.showInSectionGrid)
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, 'ru'));
    assert.ok(visible.length > 1, `${sectionSlug} must expose a real multi-item reorder zone`);
    assert.equal(new Set(visible.map((category) => category.slug)).size, visible.length, `${sectionSlug} slugs must be stable`);
    assert.equal(new Set(visible.map((category) => category.order)).size, visible.length, `${sectionSlug} order values must be deterministic`);
    for (const category of visible) {
      assert.equal(contentSchemas['product-categories'].safeParse(category).success, true, `${category.slug} must satisfy the category schema`);
    }
  }
});

test('category card declares an editable reorder item tied to its parent-section zone', () => {
  const card = read('src/components/v2/V2CategoryCard.astro');
  assert.match(card, /binding\('order', 'reorder-item'/u);
  assert.match(card, /role: 'category-order'/u);
  assert.match(card, /zoneId: category\.parentSectionSlug/u);
  assert.match(card, /parentSlug: category\.parentSectionSlug/u);
  assert.match(card, /permissions: \{ edit: true, reorder: true, delete: false \}/u);

  const hub = read('src/components/v2/CatalogSectionV2.astro');
  assert.match(hub, /<div class="v2-category-grid" role="list">/u);
  assert.match(hub, /<div role="listitem"[\s\S]*?<V2CategoryCard/u);
});

test('category reorder resolver selects category records, never sibling products or hidden cards', () => {
  const binding = {
    ownerCollection: 'product-categories',
    recordSlug: 'benches',
    fieldPath: 'order',
    stableItemId: 'benches',
    zoneId: 'street-furniture'
  };
  const pages = [
    { kind: 'category', slug: 'benches', parentSlug: 'street-furniture', isActive: true, entry: { summary: { showInSectionGrid: true } } },
    { kind: 'category', slug: 'bins', parentSlug: 'street-furniture', isActive: true, entry: { summary: { showInSectionGrid: true } } },
    { kind: 'category', slug: 'hidden', parentSlug: 'street-furniture', isActive: true, entry: { summary: { showInSectionGrid: false } } },
    { kind: 'category', slug: 'fences', parentSlug: 'fences', isActive: true, entry: { summary: { showInSectionGrid: true } } },
    { kind: 'product', slug: 'bench-1', parentSlug: 'street-furniture', isActive: true },
    { kind: 'category', slug: 'inactive', parentSlug: 'street-furniture', isActive: false, entry: { summary: { showInSectionGrid: true } } }
  ];

  assert.equal(reorderEntityKind(binding, binding.zoneId), 'category');
  assert.deepEqual(
    reorderEntityPages(pages, binding, binding.zoneId).map((page) => page.slug),
    ['benches', 'bins']
  );
});

test('visual editor commits every category order before projecting the DOM', () => {
  const visual = read('src/admin/shell/visual-editor-app.mjs');
  assert.match(visual, /reorderEntityPages\(state\.pages, binding, zoneId\)/u);
  assert.match(visual, /records\.forEach\(\(record, index\) => \{[\s\S]*?order: \(index \+ 1\) \* 10[\s\S]*?\}\);/u);
  assert.match(visual, /postToFrame\('reorder-projection', \{ zoneId: zoneId \|\| '', orderedSlugs: next\.map\(\(page\) => page\.slug\) \}\)/u);
  assert.match(visual, /for \(const \[key, glyph, label\] of \[\['Home', '⇤', 'В начало'\], \['ArrowUp', '↑', 'Выше'\], \['ArrowDown', '↓', 'Ниже'\], \['End', '⇥', 'В конец'\]\]\)/u);
  assert.match(visual, /handle\.addEventListener\('keydown'[\s\S]*?keyboardReorder\(binding, event\.key\)/u);
});

test('generic draft projection never replaces a renderer-owned reorder card with its numeric order', () => {
  const resolver = read('src/admin/state/binding-projection.mjs');
  assert.match(resolver, /PRESERVED_TOOLS = new Set\(\[[^\]]*'reorder-item'[^\]]*\]\)/u);
});

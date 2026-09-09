import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicSearchIndex } from '../../src/utils/publicSearchIndex.mjs';
import { normalizeSearch, prepareSearch, searchPublicEntries } from '../../src/scripts/public-search.mjs';

const collections = { productSections: 'product-sections', categories: 'product-categories', products: 'products', services: 'services', projects: 'projects' };
const snapshot = Object.fromEntries(Object.entries(collections).map(([key, folder]) => [key, readdirSync(resolve('src/content', folder))
  .filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(resolve('src/content', folder, name), 'utf8')))]));
const index = createPublicSearchIndex(snapshot);
const prepared = prepareSearch(index.entries);
const find = (query) => searchPublicEntries(prepared, query);

test('every currently published exact title has its own route among first exact matches', () => {
  assert.ok(index.entries.length > 50);
  for (const entry of index.entries) {
    const exactTitles = index.entries.filter((row) => normalizeSearch(row.title) === normalizeSearch(entry.title)).length;
    assert.ok(find(entry.title).slice(0, exactTitles).some((row) => row.href === entry.href), entry.title);
  }
});

test('Russian bench synonyms and inflections resolve the same model', () => {
  const target = '/ulichnaya-mebel/lavochki-i-skameyki/skamya-radius/';
  for (const query of ['Скамья Радиус', 'скамейки радиус', 'лавочка радиус', 'лавочки радиус', 'лавок радиус', 'скамьёй радиус']) {
    assert.equal(find(query)[0]?.href, target, query);
  }
  assert.ok(find('скамейки').some((row) => row.href === '/ulichnaya-mebel/lavochki-i-skameyki/'));
});

test('ё/е, punctuation, initials, RAL, projects and material inflections are searchable', () => {
  const fixture = prepareSearch([{ title: 'Крепёжный элемент Ёлка', description: '', keywords: '', kind: 'product', href: '/items/elka/' }]);
  assert.equal(searchPublicEntries(fixture, 'крепежные елка')[0]?.href, '/items/elka/');
  assert.deepEqual(searchPublicEntries(fixture, 'крепёжный ёлка'), searchPublicEntries(fixture, 'крепежный елка'));
  assert.equal(find('  СКАМЬЯ «РАДИУС»  ')[0]?.title, 'Скамья Радиус');
  assert.ok(find('деревянными').some((row) => row.kind === 'product'));
  assert.ok(find('металлоконструкций').some((row) => row.href === '/metallokonstruktsii-dlya-biznesa/'));
  assert.ok(find('топиариев').some((row) => row.href === '/topiarii/'));
  assert.ok(find('ограждений').some((row) => row.href === '/ograzhdeniya-i-zabory/'));
  assert.ok(find('урнами').some((row) => row.kind === 'product'));
  assert.ok(find('набережной Тобол').some((row) => row.kind === 'project'));
  assert.ok(find('RAL').some((row) => row.kind === 'product'));
  assert.ok(find('ради').some((row) => row.title === 'Скамья Радиус'));
});

test('empty, stop words, unrelated and markup queries return no accidental match', () => {
  for (const query of ['', '   ', 'и для на', 'несуществующееизделие92831', '<script>alert(92831)</script>']) assert.deepEqual(find(query), []);
});

test('index follows public route activity, excluding inactive ancestors and draft fields', () => {
  const active = { isActive: true, order: 1 };
  const fixture = createPublicSearchIndex({
    productSections: [{ ...active, slug: 'street', title: 'Мебель' }, { isActive: false, slug: 'hidden' }],
    categories: [{ ...active, slug: 'benches', parentSectionSlug: 'street', title: 'Скамейки', showInSectionGrid: false }, { ...active, slug: 'orphan', parentSectionSlug: 'hidden' }],
    products: [{ ...active, slug: 'radius', productCategorySlug: 'benches', title: 'Радиус', showInCatalog: false, adminNotes: 'NEVER_PUBLISH', image: '/private-original.png' },
      { isActive: false, slug: 'draft', productCategorySlug: 'benches', title: 'Черновик' },
      { ...active, slug: 'orphan-product', productCategorySlug: 'orphan', title: 'Скрытый' }],
    projects: [{ isActive: false, slug: 'future-project', title: 'Черновик объекта' }]
  });
  assert.deepEqual(fixture.entries.map((entry) => entry.href).sort(), ['/street/', '/street/benches/', '/street/benches/radius/']);
  assert.ok(!JSON.stringify(fixture).includes('NEVER_PUBLISH'));
  assert.ok(!JSON.stringify(fixture).includes('private-original'));
  assert.equal(new Set(index.entries.map((entry) => entry.href)).size, index.entries.length);
  assert.ok(index.entries.every((entry) => !/admin|design-lab|404|\.html|\/navesy\/$/.test(entry.href) || entry.href.startsWith('/ulichnaya-mebel/')));
});

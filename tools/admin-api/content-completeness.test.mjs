import assert from 'node:assert/strict';
import test from 'node:test';

import { assessPublicCompleteness, validateProjectedPublicCompleteness } from './content-completeness.mjs';

function corpus(records) {
  const entries = new Map(records.map((entry) => [`${entry.collection}:${entry.slug}`, entry]));
  const collectionValues = {};
  for (const entry of records) (collectionValues[entry.collection] ||= []).push(entry.content);
  return { entries, collectionValues };
}

test('hidden drafts may be incomplete, but a public product requires content and a public parent', () => {
  const hidden = { title: '', slug: 'draft', productCategorySlug: 'benches', image: '', isActive: false, showInCatalog: false };
  assert.equal(assessPublicCompleteness({ collection: 'products', slug: 'draft', value: hidden, corpus: corpus([]) }).complete, true);
  const result = assessPublicCompleteness({ collection: 'products', slug: 'draft', value: { ...hidden, isActive: true }, corpus: corpus([]) });
  assert.equal(result.complete, false);
  assert.ok(result.issues.some((entry) => entry.code === 'PUBLIC_REQUIRED_FIELD_EMPTY'));
  assert.ok(result.issues.some((entry) => entry.code === 'PUBLIC_PARENT_NOT_VISIBLE'));
});

test('direct public route is validated independently from the catalog listing flag', () => {
  const value = {
    title: 'Товар', slug: 'bench', productCategorySlug: 'benches', shortDescription: 'Описание', leadText: 'Текст',
    priceMode: 'none', priceFrom: null, currency: '₽', image: '/uploads/a.jpg', placeholderLabel: 'Фото',
    order: 10, isActive: true, showInCatalog: false, seoTitle: '', seoDescription: ''
  };
  const result = assessPublicCompleteness({
    collection: 'products', slug: 'bench', value,
    corpus: corpus([{ collection: 'product-categories', slug: 'benches', content: { slug: 'benches', isActive: true } }])
  });
  assert.equal(result.complete, true);
});

test('unknown active top-level slug is rejected before it can break the Astro dispatcher', () => {
  const value = {
    title: 'Новый раздел', slug: 'unsupported', shortDescription: 'Описание', heroTitle: 'Раздел', heroDescription: 'Описание',
    order: 10, showOnHome: false, isActive: true, mode: 'catalog-hub', image: '/uploads/a.jpg',
    placeholderLabel: 'Фото', seoTitle: '', seoDescription: ''
  };
  const issues = validateProjectedPublicCompleteness(corpus([{ collection: 'product-sections', slug: value.slug, content: value }]));
  assert.ok(issues.some((entry) => entry.code === 'PUBLIC_RENDERER_UNAPPROVED'));
});

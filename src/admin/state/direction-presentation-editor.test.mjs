import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDirectionRelation,
  directionTargetKey,
  moveDirectionItem,
  orderedDirectionItems,
  removeDirectionRelation,
  renumberDirectionItems,
  reorderDirectionItemSubset,
  updateDirectionItem
} from './direction-presentation-editor.mjs';

const fixture = () => [
  { id: 'third', label: 'Третий', order: 30, isActive: true },
  { id: 'first', label: 'Первый', order: 10, isActive: true },
  { id: 'second', label: 'Второй', order: 20, isActive: false }
];

test('direction ordering is deterministic while source indexes and stable ids stay intact', () => {
  const source = fixture();
  const ordered = orderedDirectionItems(source);
  assert.deepEqual(ordered.map(({ item }) => item.id), ['first', 'second', 'third']);
  assert.deepEqual(ordered.map(({ sourceIndex }) => sourceIndex), [1, 2, 0]);

  const moved = moveDirectionItem(source, 'third', 'start');
  assert.deepEqual(moved.map((item) => item.id), source.map((item) => item.id), 'physical source order must stay binding-stable');
  assert.deepEqual(orderedDirectionItems(moved).map(({ item }) => item.id), ['third', 'first', 'second']);
  assert.deepEqual(moved.map((item) => item.order), [10, 20, 30]);

  const ended = moveDirectionItem(moved, 'third', 'end');
  assert.deepEqual(orderedDirectionItems(ended).map(({ item }) => item.id), ['first', 'second', 'third']);
});

test('renumber rejects partial, duplicate, and unknown stable-id lists', () => {
  assert.throws(() => renumberDirectionItems(fixture(), ['first', 'second']), /every direction presentation item/u);
  assert.throws(() => renumberDirectionItems(fixture(), ['first', 'first', 'third']), /exactly once/u);
  assert.throws(() => renumberDirectionItems(fixture(), ['first', 'second', 'missing']), /exactly once/u);
});

test('label and visibility changes preserve stable identity', () => {
  const source = fixture();
  const next = updateDirectionItem(source, 'second', { label: 'Новая подпись', isActive: true, id: 'attempted-rewrite' });
  assert.equal(next[2].id, 'second');
  assert.equal(next[2].label, 'Новая подпись');
  assert.equal(next[2].isActive, true);
  assert.deepEqual(source, fixture(), 'helper must not mutate the current draft snapshot');
});

test('related set add/remove is typed, duplicate-safe, and deterministically ordered', () => {
  const original = [{
    id: 'fences', targetCollection: 'product-sections', targetSlug: 'ograzhdeniya-i-zabory',
    eyebrow: 'Конструкции', order: 20, isActive: true
  }];
  const withService = addDirectionRelation(original, {
    targetCollection: 'services', targetSlug: 'stroitelstvo-i-remonty'
  }, { eyebrow: 'Работы на объекте' });
  assert.equal(withService[1].id, 'related-services-stroitelstvo-i-remonty');
  assert.equal(withService[0].order, 10);
  assert.equal(withService[1].order, 20);
  assert.equal(directionTargetKey(withService[1].targetCollection, withService[1].targetSlug), 'services:stroitelstvo-i-remonty');
  assert.throws(() => addDirectionRelation(withService, {
    targetCollection: 'services', targetSlug: 'stroitelstvo-i-remonty'
  }), /already present/u);
  assert.throws(() => addDirectionRelation(withService, {
    targetCollection: 'projects', targetSlug: 'forbidden'
  }), /allowed collection/u);
  const removed = removeDirectionRelation(withService, 'fences');
  assert.deepEqual(removed.map((item) => [item.id, item.order]), [['related-services-stroitelstvo-i-remonty', 10]]);
});

test('partial direction order reuses only the selected slots and preserves foreign content and indexes', () => {
  const source = [
    { id: 'rail-b', order: 260, group: 'rail', isActive: true, media: { src: '/b.png' } },
    { id: 'feature', order: 17, group: 'feature', isActive: true },
    { id: 'hidden', order: 90, group: 'rail', isActive: false },
    { id: 'rail-a', order: 120, group: 'rail', isActive: true, kicker: 'А' },
    { id: 'wide', order: 999, group: 'wide', isActive: true }
  ];
  const before = structuredClone(source);
  const next = reorderDirectionItemSubset(source, ['rail-b', 'rail-a']);
  assert.deepEqual(next.map((item) => item.id), source.map((item) => item.id));
  assert.deepEqual(next.map((item) => item.order), [120, 17, 90, 260, 999]);
  for (const index of [1, 2, 4]) assert.deepEqual(next[index], source[index]);
  for (const index of [0, 3]) assert.deepEqual({ ...next[index], order: source[index].order }, source[index]);
  assert.deepEqual(source, before, 'the current snapshot must remain untouched');
});

test('partial direction order rejects duplicates, hidden and unknown ids without a silent partial update', () => {
  const source = fixture();
  assert.throws(() => reorderDirectionItemSubset(source, ['first', 'first']), /unique, known, active/u);
  assert.throws(() => reorderDirectionItemSubset(source, ['first', 'missing']), /unique, known, active/u);
  assert.throws(() => reorderDirectionItemSubset(source, ['first', 'second']), /unique, known, active/u);
  assert.throws(() => reorderDirectionItemSubset(source, ['first']), /at least two/u);
  const duplicateOrders = source.map((item) => ({ ...item, order: 10 }));
  assert.throws(() => reorderDirectionItemSubset(duplicateOrders, ['third', 'first']), /distinct numeric order slots/u);
  const invalidOrder = source.map((item) => ({ ...item, order: item.id === 'first' ? null : item.order }));
  assert.throws(() => reorderDirectionItemSubset(invalidOrder, ['third', 'first']), /distinct numeric order slots/u);
  assert.deepEqual(source, fixture());
});
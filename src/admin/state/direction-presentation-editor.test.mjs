import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDirectionRelation,
  directionTargetKey,
  moveDirectionItem,
  orderedDirectionItems,
  removeDirectionRelation,
  renumberDirectionItems,
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

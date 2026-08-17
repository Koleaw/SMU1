import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryStore, deleteAtPath, setAtPath } from './history-store.mjs';

test('history supports more than fifty meaningful actions without crossing the saved boundary', () => {
  let time = 0;
  const store = createHistoryStore({ title: 'Начало', values: [] }, { capacity: 80, now: () => ++time, coalesceMs: 0 });
  for (let index = 0; index < 65; index += 1) {
    store.commit({ title: `Шаг ${index}`, values: [index] }, { label: `Изменить ${index}` });
  }
  assert.equal(store.snapshot().undoCount, 65);
  for (let index = 0; index < 65; index += 1) store.undo();
  assert.deepEqual(store.snapshot().value, { title: 'Начало', values: [] });
  assert.equal(store.snapshot().dirty, false);
  store.redo();
  assert.equal(store.snapshot().dirty, true);
  store.markBoundary();
  assert.equal(store.snapshot().dirty, false);
  assert.equal(store.snapshot().canUndo, false);
  store.commit({ title: 'После save', values: [] });
  store.undo();
  assert.equal(store.snapshot().value.title, 'Шаг 0', 'undo stops at the last loaded/saved boundary');
});

test('text actions coalesce while structural changes remain separate and clear redo', () => {
  let time = 100;
  const store = createHistoryStore({ text: '', items: ['a'] }, { now: () => time });
  store.commit({ text: 'п', items: ['a'] }, { label: 'Текст', coalesceKey: 'text' });
  time += 100;
  store.commit({ text: 'пр', items: ['a'] }, { label: 'Текст', coalesceKey: 'text' });
  assert.equal(store.snapshot().undoCount, 1);
  time += 1_000;
  store.commit({ text: 'при', items: ['a'] }, { label: 'Текст', coalesceKey: 'text' });
  assert.equal(store.snapshot().undoCount, 2);
  store.undo();
  assert.equal(store.snapshot().value.text, 'пр');
  store.commit({ text: 'пр', items: ['a', 'b'] }, { label: 'Добавить пункт' });
  assert.equal(store.snapshot().canRedo, false);
});

test('path helpers update clones without mutating nested input', () => {
  const original = Object.freeze({ nested: Object.freeze({ items: Object.freeze(['one', 'two']) }) });
  const updated = setAtPath(original, ['nested', 'items', 1], 'second');
  assert.deepEqual(updated, { nested: { items: ['one', 'second'] } });
  assert.deepEqual(original, { nested: { items: ['one', 'two'] } });
  assert.deepEqual(deleteAtPath(updated, ['nested', 'items', 0]), { nested: { items: ['second'] } });
});

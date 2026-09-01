import assert from 'node:assert/strict';
import test from 'node:test';

import { createHistoryStore } from './history-store.mjs';
import {
  completeInlineGesture,
  createInlineGestureCheckpoint,
  restoreInlineGestureCheckpoint
} from './inline-gesture.mjs';

test('inline gesture preserves function-bearing reorder redo commands by identity', () => {
  const history = createHistoryStore({ title: 'B' });
  const record = { history, undoActionStack: [7], redoActionStack: [{ originalSequence: 5, readySequence: 6 }] };
  const command = { label: 'Порядок', undo() {}, redo() {} };
  const gesture = createInlineGestureCheckpoint(record, [command]);
  history.commit({ title: 'C' }, { label: 'Текст', coalesceKey: 'title' });
  record.undoActionStack.push(8);
  record.redoActionStack = [];
  let restoredCommands = null;

  assert.equal(restoreInlineGestureCheckpoint(gesture, (commands) => { restoredCommands = commands; }), true);
  assert.deepEqual(history.snapshot().value, { title: 'B' });
  assert.deepEqual(record.undoActionStack, [7]);
  assert.deepEqual(record.redoActionStack, [{ originalSequence: 5, readySequence: 6 }]);
  assert.equal(restoredCommands[0], command);
  assert.equal(restoredCommands[0].undo, command.undo);
  assert.equal(restoredCommands[0].redo, command.redo);
});

test('completing an inline gesture before Save prevents a later Escape rollback', () => {
  const history = createHistoryStore({ title: 'A' });
  const record = { history, undoActionStack: [], redoActionStack: [] };
  const gesture = createInlineGestureCheckpoint(record);
  history.commit({ title: 'B' }, { label: 'Текст', coalesceKey: 'title' });
  completeInlineGesture(gesture);
  history.markBoundary({ title: 'B' });

  assert.equal(restoreInlineGestureCheckpoint(gesture), false);
  assert.deepEqual(history.snapshot().value, { title: 'B' });
  assert.equal(history.snapshot().dirty, false);
});

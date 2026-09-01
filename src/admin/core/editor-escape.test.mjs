import assert from 'node:assert/strict';
import test from 'node:test';

import { handleVisualEditorEscape } from './editor-escape.mjs';

function escapeEvent() {
  return {
    key: 'Escape',
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };
}

test('visual editor Escape leaves a top-layer dialog to the browser', () => {
  const calls = [];
  const event = escapeEvent();
  const result = handleVisualEditorEscape(event, {
    documentValue: { querySelector: (selector) => selector === 'dialog[open]' ? {} : null },
    inlineOpen: () => true,
    cancelInline: () => calls.push('inline'),
    inspectorOpen: () => true,
    closeInspector: () => calls.push('inspector')
  });
  assert.equal(result, 'dialog');
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(calls, []);
});

test('visual editor Escape cancels inline before closing the inspector', () => {
  const calls = [];
  const inlineEvent = escapeEvent();
  assert.equal(handleVisualEditorEscape(inlineEvent, {
    documentValue: { querySelector: () => null },
    inlineOpen: () => true,
    cancelInline: () => calls.push('inline'),
    inspectorOpen: () => true,
    closeInspector: () => calls.push('inspector')
  }), 'inline');
  assert.equal(inlineEvent.defaultPrevented, true);
  assert.deepEqual(calls, ['inline']);

  const inspectorEvent = escapeEvent();
  assert.equal(handleVisualEditorEscape(inspectorEvent, {
    documentValue: { querySelector: () => null },
    inspectorOpen: () => true,
    closeInspector: () => calls.push('inspector')
  }), 'inspector');
  assert.equal(inspectorEvent.defaultPrevented, true);
  assert.deepEqual(calls, ['inline', 'inspector']);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../../src/admin/shell/visual-editor-app.mjs', import.meta.url), 'utf8');
const implementation = app.slice(app.indexOf('function restoreFocusDialog('), app.indexOf('export async function startVisualEditor('));

function fixture({ overlay = false, connected = true } = {}) {
  const calls = [];
  class HTMLElement {
    constructor(bindingId = '', controlKey = '') { this.dataset = { bindingId, controlKey }; this.isConnected = true; }
    closest() { return this.dataset.bindingId ? {} : null; }
    focus(options) { calls.push({ target: this, options }); }
  }
  const previous = new HTMLElement(overlay ? 'product:gallery' : '', overlay ? 'target' : '');
  previous.isConnected = connected;
  let replacement = null, selector = null;
  const document = { activeElement: previous, querySelector(value) { selector = value; return replacement; } };
  const restore = new Function('document', 'HTMLElement', 'CSS', 'requestAnimationFrame', `${implementation}\nreturn restoreFocusDialog;`)(document, HTMLElement, { escape: value => value }, callback => callback());
  const listeners = [];
  const dialog = { open: false, showModal() { this.open = true; }, querySelector() { return null; },
    addEventListener(type, callback, options) { assert.equal(type, 'close'); assert.equal(options.once, true); listeners.push(callback); },
    close() { this.open = false; listeners.splice(0).forEach(callback => callback()); } };
  return { previous, calls, dialog, restore, HTMLElement,
    replace(node) { previous.isConnected = false; replacement = node; }, selector: () => selector };
}

test('dialog retains the existing return behavior for a connected ordinary trigger', () => {
  const f = fixture(); f.restore(f.dialog, f.previous); f.dialog.close();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].target, f.previous);
  assert.equal(f.calls[0].options, undefined); assert.equal(f.selector(), null);
});

test('dialog restores the exact overlay binding after its original node was recreated', () => {
  const f = fixture({ overlay: true }); f.restore(f.dialog, f.previous);
  const current = new f.HTMLElement('product:gallery', 'target'); f.replace(current); f.dialog.close();
  assert.equal(f.selector(), '#veOverlay [data-binding-id="product:gallery"][data-control-key="target"]');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].target, current);
  assert.deepEqual(f.calls[0].options, { preventScroll: true });
});

test('dialog does not select an unrelated binding when its original overlay target is gone', () => {
  const f = fixture({ overlay: true }); f.restore(f.dialog, f.previous); f.replace(null); f.dialog.close();
  assert.equal(f.calls.length, 0);
});

test('a disconnected ordinary trigger does not invoke the overlay fallback', () => {
  const f = fixture(); f.restore(f.dialog, f.previous); f.replace(new f.HTMLElement('other', 'target')); f.dialog.close();
  assert.equal(f.calls.length, 0); assert.equal(f.selector(), null);
});
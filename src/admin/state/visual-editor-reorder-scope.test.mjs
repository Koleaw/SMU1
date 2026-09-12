import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getAtPath, setAtPath } from './history-store.mjs';
import { orderedDirectionItems, renumberDirectionItems, reorderDirectionItemSubset } from './direction-presentation-editor.mjs';

const source = await readFile(new URL('../shell/visual-editor-app.mjs', import.meta.url), 'utf8');
const extract = (name, next) => source.slice(source.indexOf(`  function ${name}(`), source.indexOf(`  ${next}`, source.indexOf(`  function ${name}(`))).trim();
const items = [
  { id: 'feature', order: 10, isActive: true },
  { id: 'rail-a', order: 50, isActive: true },
  { id: 'hidden', order: 55, isActive: false },
  { id: 'rail-b', order: 60, isActive: true },
  { id: 'wide', order: 70, isActive: true }
];
const binding = { tool: 'reorder-item', ownerCollection: 'static-pages', recordSlug: 'home', fieldPath: 'cards', zoneId: 'rail', stableItemId: 'rail-a' };

test('runtime descriptor membership is limited by exact owner, record, field and zone', () => {
  const candidates = [
    binding,
    { ...binding, stableItemId: 'rail-b' },
    { ...binding, stableItemId: 'hidden' },
    { ...binding, stableItemId: 'feature', zoneId: 'feature' },
    { ...binding, stableItemId: 'wide', ownerCollection: 'products' },
    { ...binding, stableItemId: 'wide', recordSlug: 'other' },
    { ...binding, stableItemId: 'wide', fieldPath: 'otherCards' }
  ];
  const record = { history: { snapshot: () => ({ value: { cards: items } }) } };
  const factory = new Function('state', 'recordForBinding', 'clone', 'getAtPath', 'orderedDirectionItems', 'reorderEntityPages', 'recordKey', `${extract('reorderDescriptorList', 'function projectCurrentReorderToFrame')}; return reorderDescriptorList;`);
  const resolve = factory({ bindingRows: candidates.map((binding) => ({ binding })), currentPage: { slug: 'home' } }, () => record, structuredClone, getAtPath, orderedDirectionItems, () => { throw Error('unexpected entity path'); }, () => '');
  assert.deepEqual(resolve(binding).map((row) => row.stableItemId), ['rail-a', 'rail-b']);
});

test('runtime rejects ambiguous partial order without committing, projecting or reporting success', () => {
  const ambiguous = items.map((item) => ({ ...item, order: item.id.startsWith('rail-') ? 50 : item.order }));
  const effects = [];
  const record = { history: { snapshot: () => ({ value: { cards: ambiguous } }), commit: () => effects.push('commit') } };
  const factory = new Function('clone', 'getAtPath', 'setAtPath', 'orderedDirectionItems', 'renumberDirectionItems', 'reorderDirectionItemSubset', 'state', 'notifications', 'postToFrame', 'updateChrome', `${extract('applyInRecordReorder', 'async function applyReorder')}; return applyInRecordReorder;`);
  const move = factory(structuredClone, getAtPath, setAtPath, orderedDirectionItems, renumberDirectionItems, reorderDirectionItemSubset, {}, { toast: (_message, severity) => effects.push(severity) }, () => effects.push('projection'), () => effects.push('chrome'));
  const descriptors = ambiguous.filter((item) => item.id.startsWith('rail-')).map((item) => ({ item, record, fieldPath: 'cards' }));
  assert.equal(move(descriptors, 0, 1, 'Move', 'rail'), false);
  assert.deepEqual(effects, ['warning']);
});
test('initial bridge readiness projects a restored order once after binding registration', () => {
  const restored = items.map((item) => ({ ...item, order: item.id === 'rail-a' ? 60 : item.id === 'rail-b' ? 50 : item.order }));
  const record = { history: { snapshot: () => ({ value: { cards: restored } }) } };
  const state = { bindingRows: [], currentPage: { slug: 'home' } };
  const descriptorFactory = new Function('state', 'recordForBinding', 'clone', 'getAtPath', 'orderedDirectionItems', `${extract('reorderDescriptorList', 'function projectCurrentReorderToFrame')}; return reorderDescriptorList;`);
  const resolve = descriptorFactory(state, () => record, structuredClone, getAtPath, orderedDirectionItems);
  const events = [];
  const projectionFactory = new Function('state', 'reorderDescriptorList', 'postToFrame', `${extract('projectCurrentReorderToFrame', 'async function applyEntityReorder')}; return projectCurrentReorderToFrame;`);
  const project = projectionFactory(state, resolve, (type, value) => events.push({ type, ...value }));
  const start = source.indexOf("    if (message.type === 'ready') {");
  const end = source.indexOf("    if (message.type === 'geometry') {", start);
  const ready = new Function('message', 'state', 'aliasPreview', 'registerBindingTemplates', 'registerBindingDefinitions', 'registeredBindingRows', 'renderOverlay', 'projectDraftToFrame', 'projectCurrentReorderToFrame', 'canvasHint', source.slice(start, end));
  const bindings = [{ binding }, { binding: { ...binding, stableItemId: 'rail-b' } }];
  ready({ type: 'ready', bindings }, state, false, () => {}, () => {}, (rows) => rows, () => {}, () => events.push({ type: 'scalar' }), project, {});
  assert.deepEqual(events, [
    { type: 'scalar' },
    { type: 'reorder-projection', zoneId: 'rail', orderedSlugs: ['rail-b', 'rail-a'] }
  ]);
});
test('open reorder inspector refreshes stale position and disabled actions without replacing focused controls', () => {
  const record = {};
  const state = { currentBinding: { record, binding: { ...binding, stableItemId: 'rail-b' } } };
  const documentValue = { activeElement: null };
  const buttons = ['Home', 'ArrowUp', 'ArrowDown', 'End'].map((key) => ({
    dataset: { reorderKey: key }, disabled: false,
    focus(options) { assert.equal(options.preventScroll, true); documentValue.activeElement = this; }
  }));
  const position = {}, total = {};
  const card = { querySelector: (selector) => selector === '[data-reorder-position]' ? position : total, querySelectorAll: () => buttons };
  let order = ['rail-b', 'rail-a'];
  const factory = new Function('state', 'inspector', 'inspectorForm', 'reorderDescriptorList', 'document', `${extract('syncReorderInspector', 'function renderReorderInspector')}; return syncReorderInspector;`);
  const refresh = factory(state, { hidden: false }, { querySelector: () => card }, () => order.map((stableItemId) => ({ stableItemId })), documentValue);
  documentValue.activeElement = buttons[0];
  refresh(record);
  assert.equal(position.textContent, '1');
  assert.equal(total.textContent, '2');
  assert.deepEqual(buttons.map((button) => button.disabled), [true, true, false, false]);
  assert.equal(documentValue.activeElement, buttons[2], 'focus moves to the next available action when the clicked action becomes disabled');
  const undoControl = { id: 'veUndo' };
  documentValue.activeElement = undoControl;
  order = ['rail-a', 'rail-b'];
  refresh(record);
  assert.equal(position.textContent, '2');
  assert.deepEqual(buttons.map((button) => button.disabled), [false, false, true, true]);
  assert.equal(documentValue.activeElement, undoControl, 'history controls must keep their focus');
});
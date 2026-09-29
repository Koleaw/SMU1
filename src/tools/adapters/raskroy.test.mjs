import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, normalizeInput, example, form, diagram, printDiagram, extra, toMetal, asyncCalculate } from './raskroy.mjs';
import { calculate as pureCalculate } from '../calculations/cutting.mjs';

test('numeric input accepts comma, keeps unknown fields for strict validation, and only blank purchase count means unlimited', () => {
  const input = structuredClone(example);
  input.kerf = '3,5'; input.parts[0].length = '1 800';
  assert.throws(() => calculate(input), /введите число/);
  input.parts[0].length = '1800,25'; input.parts[0].quantity = '4'; input.purchases[0].quantity = '';
  const normalized = normalizeInput(input);
  assert.equal(normalized.kerf, 3.5);
  assert.equal(normalized.parts[0].length, 1800.25);
  assert.equal(normalized.parts[0].quantity, 4);
  assert.equal(normalized.purchases[0].quantity, null);
  assert.equal(calculate(input).totals.placedPieces, 10);
  input.stock[0].quantity = '';
  assert.throws(() => calculate(input), /укажите значение/);
  input.stock[0].quantity = 1; input.surprise = 'untrusted';
  assert.throws(() => calculate(input), /неизвестное поле/);
});

test('form, diagram and extra tables escape user text and preserve the selected input', () => {
  const input = structuredClone(example);
  input.parts[0].name = '<img src=x onerror=alert(1)>';
  const result = calculate(input);
  for (const markup of [form(input), diagram(result, input, 'parts.0.length'), printDiagram(result, input), extra(result)]) {
    assert.equal(markup.includes('<img src=x'), false);
  }
  assert.match(form(input), /&lt;img/);
  assert.match(diagram(result, input, 'parts.0.length'), /class="is-active"/);
  assert.equal(typeof printDiagram(result, input), 'string');
  assert.equal(result.extraTables.length, 3);
  assert.equal(result.extraTables[0].rows, result.procurement);
  assert.match(extra(result), /data-action="to-metal"/);
});

test('transfer to metal uses bought bar length, quantity and explicit unknown mass and price', () => {
  const result = calculate(example), metal = toMetal(result);
  assert.equal(metal.rows.length, 1);
  assert.equal(metal.rows[0].length, 6000);
  assert.equal(metal.rows[0].quantity, 2);
  assert.equal(metal.rows[0].shape, 'known');
  assert.equal(metal.rows[0].massPerMetre, '');
  assert.equal(metal.rows[0].price, '');
  assert.match(metal.rows[0].name, /Труба.*Сталь/);
  assert.equal(metal.rows.reduce((sum, row) => sum + row.length * row.quantity, 0), result.totals.newLength);
  assert.notEqual(result.totals.newLength, result.totals.cleanPartsLength);
});

test('async adapter dispatches the same normalized job and terminates the worker after response', async () => {
  const OriginalWorker = globalThis.Worker;
  let terminated = 0, posted;
  class FakeWorker {
    constructor(url, options) { assert.match(String(url), /cutting\.worker\.mjs$/); assert.equal(options.type, 'module'); }
    postMessage(data) { posted = data; queueMicrotask(() => this.onmessage({ data: { result: pureCalculate(data) } })); }
    terminate() { terminated++; }
  }
  globalThis.Worker = FakeWorker;
  try {
    const input = structuredClone(example); input.kerf = '3,0';
    const result = await asyncCalculate(input);
    assert.equal(posted.kerf, 3);
    assert.deepEqual(result, calculate(input));
    assert.equal(terminated, 1);
  } finally { globalThis.Worker = OriginalWorker; }
});

test('async adapter cancellation terminates work and cannot resolve from a late worker response', async () => {
  const OriginalWorker = globalThis.Worker;
  let worker, terminated = 0;
  class SlowWorker { constructor() { worker = this; } postMessage() {} terminate() { terminated++; } }
  globalThis.Worker = SlowWorker;
  try {
    const controller = new AbortController();
    const pending = asyncCalculate(example, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    worker.onmessage({ data: { result: pureCalculate(example) } });
    assert.equal(terminated, 1);
    await assert.rejects(asyncCalculate(example, { signal: controller.signal }), { name: 'AbortError' });
  } finally { globalThis.Worker = OriginalWorker; }
});

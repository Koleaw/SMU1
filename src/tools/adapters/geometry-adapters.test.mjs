import test from 'node:test';
import assert from 'node:assert/strict';
import * as fundament from './fundament.mjs';
import * as ograzhdenie from './ograzhdenie.mjs';
import * as plitka from './plitka.mjs';
import { validateShape, createProject, parseFile, serialize, csv } from '../core/projects.mjs';

test('geometry adapters: examples and blank drafts retain strict serializable schema', () => {
  for (const [id, adapter] of [['fundament', fundament], ['ograzhdenie', ograzhdenie], ['plitka', plitka]]) {
    validateShape(adapter.blank, adapter.example);
    validateShape(adapter.example, adapter.example);
    const project = createProject(id, adapter.example, 'Проверка кириллицы', adapter.methodologyVersion);
    const restored = parseFile(serialize([project])).projects[0];
    validateShape(restored.input, adapter.example);
    assert.deepEqual(adapter.calculate(restored.input), adapter.calculate(adapter.example));
    const result = adapter.calculate(restored.input);
    assert.ok(adapter.form(restored.input).includes('data-field='));
    assert.ok(adapter.diagram(result, restored.input).includes('<svg'));
    assert.ok(csv(result).startsWith('\uFEFF'));
  }
});

test('foundation adapter: selectable forming sides use controlled CSV conversion', () => {
  const input = structuredClone(fundament.example);
  input.formwork.outerSides = '0,2';
  const result = fundament.calculate(input);
  assert.equal(result.totals.formworkAreaM2, 4);
  assert.deepEqual(result.input.formwork.outerSides, [0, 2]);
  assert.equal(input.formwork.outerSides, '0,2', 'raw saved draft must not be mutated');
  assert.throws(() => fundament.calculate({ ...input, formwork: { ...input.formwork, outerSides: '0,8' } }));
});

test('geometry adapters: foundation mode switches preserve dormant inputs; fence normalizes sides', () => {
  const input = { ...structuredClone(fundament.example), type: 'slab' };
  input.formwork.inner = true;
  input.layers[0].area = 'strip';
  fundament.onInput(input, 'type');
  assert.equal(input.formwork.inner, true);
  assert.equal(input.layers[0].area, 'strip');
  assert.throws(()=>fundament.calculate(input),/Область под лентой/);
  const fence = { ...structuredClone(ograzhdenie.example), type: 'line' };
  fence.openings[0].side = 3;
  ograzhdenie.onInput(fence, 'type');
  assert.equal(fence.openings[0].side, 0);
});

test('geometry adapter labels safely escape names in diagrams and form fields', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const input = structuredClone(ograzhdenie.example);
  input.openings[0].name = attack;
  assert.ok(!ograzhdenie.form(input).includes(attack));
  const result = ograzhdenie.calculate(input);
  assert.ok(!ograzhdenie.diagram(result, input).includes('<img'));
  const foundation = structuredClone(fundament.example);
  foundation.layers[0].name = attack;
  assert.ok(!fundament.diagram(fundament.calculate(foundation), foundation).includes('<img'));
});
test('normalized historical tile centres remain compatible and can change mode',()=>{
  const input=plitka.calculate({...plitka.example,mode:'symmetric-tile',centerY:'joint'}).input;
  plitka.validateDraft(input);assert.equal(plitka.calculate(input).totals.sourceCount,6);
  input.mode='symmetric-joint';plitka.onInput(input,'mode');
  assert.equal(input.centerX,'joint');assert.equal(input.centerY,'joint');
  assert.throws(()=>plitka.validateDraft({...input,unknown:1}));
});

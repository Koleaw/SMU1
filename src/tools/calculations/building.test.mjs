import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, example, blank } from './building.mjs';
import { diagram, form, extra, printDiagram } from '../adapters/zdanie.mjs';

const job = (overrides = {}) => ({ ...structuredClone(blank), length: 10000, width: 8000, externalHeight: 6000, usefulHeight: 4500, ...overrides });
const zone = (id, x, y, length, width) => ({ id, name: id, x, y, length, width });
const opening = (id, side, position, width, height = 2100) => ({ id, name: id, side, position, width, height });

test('unknown dimensions produce a partial brief; they never become zero or inferred values', () => {
  const result = calculate(structuredClone(blank));
  assert.equal(result.geometry.available, false);
  assert.equal(result.input.length, null);
  assert.equal(result.input.width, null);
  assert.equal(result.input.externalHeight, null);
  assert.equal(result.input.usefulHeight, null);
  assert.equal(result.input.purpose, null);
  assert.equal(result.input.budget, null);
  assert.equal(result.totals.footprintAreaM2, null);
  assert.equal(result.totals.perimeterM, null);
  assert.equal(result.calculated.length, 0);
  assert.ok(result.needClarify.some((row) => row.parameter === 'Размерный план'));
  assert.ok(result.needClarify.some((row) => row.parameter === 'Полезная площадь'));
  assert.equal(result.summary[0].value, 'Неизвестно');
});
test('independent rectangle and height fixture separates 80 m² outer footprint from useful space', () => {
  const result = calculate(job());
  assert.equal(result.totals.footprintAreaM2, 80);
  assert.equal(result.totals.perimeterM, 36);
  assert.equal(result.geometry.externalHeight, 6000);
  assert.equal(result.geometry.usefulHeight, 4500);
  assert.equal(result.given.find((row) => row.parameter === 'Наружная высота').value, 6000);
  assert.equal(result.given.find((row) => row.parameter === 'Требуемая полезная высота').value, 4500);
  assert.equal(result.calculated.some((row) => row.parameter === 'Полезная площадь'), false);
  assert.equal(result.extraTables[0].title, 'Задано заказчиком');
  assert.equal(result.extraTables[1].title, 'Вычислено из геометрии');
  assert.equal(result.extraTables[2].title, 'Нужно уточнить');
});
test('known useful height does not infer outside height, and malformed or contradictory values fail', () => {
  const result = calculate(job({ externalHeight: null, usefulHeight: '4500,5' }));
  assert.equal(result.input.externalHeight, null);
  assert.equal(result.input.usefulHeight, 4500.5);
  assert.throws(() => calculate(job({ externalHeight: 4000, usefulHeight: 4500 })), /не может превышать/);
  assert.throws(() => calculate(job({ usefulHeight: '4 500' })), /введите число/);
});
test('overlapping zones fail, touching edges are allowed, and out-of-envelope zones fail', () => {
  assert.throws(() => calculate(job({ zones: [zone('a', 0, 0, 4000, 4000), zone('b', 3000, 3000, 4000, 4000)] })), /пересекаются/);
  const adjacent = calculate(job({ zones: [zone('a', 0, 0, 4000, 4000), zone('b', 4000, 0, 4000, 4000)] }));
  assert.equal(adjacent.geometry.zones[0].areaM2, 16);
  assert.equal(adjacent.geometry.zones[1].areaM2, 16);
  assert.throws(() => calculate(job({ zones: [zone('a', 7000, 0, 4000, 4000)] })), /наружную длину/);
  assert.throws(() => calculate(job({ zones: [zone('a', 0, 5000, 4000, 4000)] })), /наружную ширину/);
});
test('opening positions and overlaps are checked on their own wall, including far-corner directions', () => {
  assert.throws(() => calculate(job({ openings: [opening('gate', 'south', 8000, 3000)] })), /границу стороны 1/);
  assert.throws(() => calculate(job({ openings: [opening('door', 'east', 7000, 2000)] })), /границу стороны 2/);
  assert.throws(() => calculate(job({ openings: [opening('gate', 'north', 9500, 1000)] })), /границу стороны 3/);
  assert.throws(() => calculate(job({ openings: [opening('a', 'west', 1000, 2000), opening('b', 'west', 2000, 1500)] })), /пересекаются/);
  assert.doesNotThrow(() => calculate(job({ openings: [opening('a', 'south', 0, 2000), opening('b', 'south', 2000, 1500), opening('c', 'north', 0, 2000)] })));
  assert.throws(() => calculate(job({ openings: [opening('gate', 'south', 0, 2000, 6000.001)] })), /выше заданной наружной/);
});
test('partial zones and openings remain unknown and are omitted from precise geometry only with an explanation', () => {
  const result = calculate(job({ zones: [zone('a', null, 0, 4000, 4000)], openings: [opening('gate', 'south', null, 4000, null)] }));
  assert.equal(result.geometry.zones[0].complete, false);
  assert.equal(result.geometry.zones[0].x, null);
  assert.equal(result.geometry.zones[0].areaM2, 16);
  assert.equal(result.geometry.openings[0].complete, false);
  assert.equal(result.geometry.openings[0].height, null);
  assert.ok(result.needClarify.some((row) => row.parameter === 'Проверка всех зон'));
  assert.ok(result.needClarify.some((row) => row.parameter === 'Проверка всех проёмов'));
  assert.equal(result.rows.length, 2);
});
test('exact 0.001 mm boundary does not create a false overlap or outside condition', () => {
  const result = calculate(job({ length: 1000.002, width: 1000, zones: [zone('a', 0, 0, 500.001, 1000), zone('b', 500.001, 0, 500.001, 1000)], openings: [opening('door', 'south', 500.001, 500.001)] }));
  assert.equal(result.geometry.zones.length, 2);
  assert.equal(result.geometry.openings.length, 1);
  assert.throws(() => calculate(job({ zones: [zone('a', 0, 0, 1.0001, 1000)] })), /точность/);
});
test('zero, unknown and supplied customer budget remain distinct; cost and completion date are not invented', () => {
  const zero = calculate(job({ budget: 0, timeline: 'По пожеланию заказчика — 2027 год' }));
  assert.equal(zero.input.budget, 0);
  assert.equal(zero.given.find((row) => row.parameter === 'Бюджет заказчика').value, 0);
  assert.equal(calculate(job({ budget: '' })).input.budget, null);
  assert.equal(calculate(job({ budget: '1000000,50' })).input.budget, 1000000.5);
  assert.equal(zero.calculated.some((row) => /стоимость|срок|цен[аы]/i.test(row.parameter)), false);
});
test('strict schemas and limits reject malformed input without mutating the draft', () => {
  const input = structuredClone(example), saved = JSON.stringify(input), result = calculate(input);
  assert.equal(JSON.stringify(input), saved);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.throws(() => calculate({ ...input, formula: 'eval(1)' }), /неизвестное поле/);
  const missing = structuredClone(input); delete missing.externalHeight;
  assert.throws(() => calculate(missing), /отсутствует поле/);
  for (const bad of [-1, 0, 1000001, Infinity, NaN, true]) assert.throws(() => calculate(job({ length: bad })), Error);
  assert.throws(() => calculate(job({ budget: -1 })), /допустимо/);
  assert.throws(() => calculate(job({ zones: [zone('a', 0, 0, 1, 1), zone('a', 3, 0, 1, 1)] })), /уникальный ID/);
  assert.throws(() => calculate(job({ openings: [opening('x', 'other', 0, 100)] })), /выберите сторону/);
  assert.throws(() => calculate(job({ zones: Array.from({ length: 51 }, (_, i) => zone(`z${i}`, i, 0, 0.5, 1)) })), /50 строк/);
  assert.throws(() => calculate(job({ site: 'a'.repeat(2001) })), /2000 символов/);
});
test('maximum accepted brief preserves 50 zones and 50 openings in interface and export rows', () => {
  const input = job({ zones: Array.from({ length: 50 }, (_, i) => zone(`z${i}`, i * 100, 1000, 100, 100)), openings: Array.from({ length: 50 }, (_, i) => opening(`o${i}`, 'south', i * 100, 100)) });
  const result = calculate(input);
  assert.equal(result.geometry.zones.length, 50);
  assert.equal(result.geometry.openings.length, 50);
  assert.equal(result.rows.length, 100);
  assert.equal(result.given.filter((row) => row.parameter.endsWith(': ширина')).length, 100);
});
test('adapter escapes free text, shows unknown plan clearly, and highlights selected zones and openings', () => {
  const input = structuredClone(example); input.purpose = '<script>alert(1)</script>'; input.zones[0].name = '<img src=x onerror=alert(1)>';
  const result = calculate(input);
  for (const markup of [form(input), diagram(result, input, 'zones.0.length'), extra(result), printDiagram(result, input)]) {
    assert.equal(markup.includes('<script>alert'), false);
    assert.equal(markup.includes('<img src=x'), false);
  }
  assert.match(diagram(result, input, 'zones.0.length'), /class="is-active"/);
  assert.match(diagram(result, input, 'openings.0.width'), /class="is-active"/);
  assert.match(diagram(calculate(blank), blank), /Размерный план пока недоступен/);
});

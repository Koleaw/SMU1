import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate as foundation, example as foundationExample, blank as foundationBlank } from './foundation.mjs';
import { calculate as fence, example as fenceExample, blank as fenceBlank } from './fence.mjs';
import { calculate as tile, example as tileExample, blank as tileBlank } from './tile.mjs';

const copy = value => structuredClone(value);
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test('foundation: slab hand standard, reserves and explicit forming height', () => {
  const result = foundation(foundationExample);
  near(result.totals.concreteVolumeM3, 12);
  near(result.totals.footprintAreaM2, 48);
  near(result.totals.concreteAreaM2, 48);
  near(result.totals.formworkAreaM2, 7);
  near(result.totals.reserveVolumeM3, 0.6);
  near(result.totals.orderVolumeM3, 12.6);
  near(result.geometry.layers[0].volumeM3, 4.8);
  const tallForm = foundation({ ...foundationExample, formwork: { outer: true, inner: false, height: 300, outerSides: [0, 1] } });
  near(tallForm.totals.formworkAreaM2, 4.2);
  assert.equal(tallForm.geometry.formworkEdges.length, 2);
  const noForm = foundation({ ...foundationExample, formwork: { outer: false, inner: false, height: 0 } });
  assert.equal(noForm.totals.formworkAreaM2, 0);
});

const strip = { ...foundationExample, type: 'strip', length: 10000, width: 8000, height: 800, stripWidth: 400, reservePercent: 0, formwork: { outer: true, inner: true, height: 800 }, layers: [{ id: 'ring', name: 'Под лентой', area: 'strip', thickness: 100 }, { id: 'full', name: 'По пятну', area: 'footprint', thickness: 200 }] };

test('foundation: strip hand standard, corners counted once, two layer regions', () => {
  const result = foundation(strip);
  near(result.totals.concreteAreaM2, 13.76);
  near(result.totals.concreteVolumeM3, 11.008);
  near(result.totals.formworkAreaM2, 55.04);
  near(result.geometry.layers[0].areaM2, 13.76);
  near(result.geometry.layers[0].volumeM3, 1.376);
  near(result.geometry.layers[1].areaM2, 80);
  near(result.geometry.layers[1].volumeM3, 16);
  near(result.geometry.planRects.reduce((sum, r) => sum + r.width * r.height, 0), 13_760_000);
  for (let i = 0; i < result.geometry.planRects.length; i++) for (let j = i + 1; j < result.geometry.planRects.length; j++) {
    const a = result.geometry.planRects[i], b = result.geometry.planRects[j];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'plan rectangles must not overlap');
  }
  const innerOnly = foundation({ ...strip, formwork: { inner: true, outer: false, height: 800 } });
  near(innerOnly.totals.formworkAreaM2, 26.24);
});

test('foundation: decimal comma and selected formwork surfaces', () => {
  const result = foundation({ ...foundationExample, length: '8000,001', width: '6000', height: '250,0', reservePercent: '0', formwork: { outer: true, inner: false, height: '250', outerSides: [0] } });
  near(result.totals.concreteVolumeM3, 12.0000015);
  near(result.totals.formworkAreaM2, 2.00000025);
  assert.equal(result.input.length, 8000.001);
  assert.equal(result.totals.reserveVolumeM3, 0);
});

test('foundation: invalid dimensions, sides and layer combinations are rejected', () => {
  for (const input of [foundationBlank, { ...strip, stripWidth: 4000 }, { ...strip, stripWidth: 4001 }, { ...foundationExample, formwork: { outer: true, inner: true, height: 250 } }, { ...foundationExample, formwork: { outer: true, inner: false, height: 0 } }, { ...foundationExample, formwork: { outer: true, inner: false, height: 250, outerSides: [0, 0] } }, { ...foundationExample, layers: [{ id: 'x', name: 'X', area: 'strip', thickness: 100 }] }, { ...foundationExample, layers: Array(9).fill({}) }, { ...strip, layers: [{ id: 'x', area: 'strip', thickness: 100 }, { id: 'x', area: 'strip', thickness: 100 }] }]) assert.throws(() => foundation(input));
});

test('fence: independent rectangle with gates hand standard', () => {
  const result = fence(fenceExample);
  assert.equal(result.totals.spanCount, 16);
  assert.equal(result.totals.nodeCount, 17);
  assert.equal(result.totals.openingCount, 1);
  assert.equal(result.totals.fenceLengthMm, 32000);
  assert.equal(result.totals.openingLengthMm, 4000);
  assert.equal(result.totals.perimeterMm, 36000);
  assert.deepEqual(result.geometry.sections.map(s => s.count), [2, 2, 4, 4, 4]);
  assert.deepEqual(result.geometry.sections.map(s => s.step), [1500, 1500, 2000, 2500, 2000]);
  assert.equal(result.geometry.nodes.filter(n => n.y === 0 && n.x > 3000 && n.x < 7000).length, 0);
});

test('fence: opening at corner reuses node, touching openings reuse boundary', () => {
  const atCorner = fence({ ...fenceExample, openings: [{ ...fenceExample.openings[0], position: 0 }] });
  const first = atCorner.geometry.nodes.find(node => node.x === 0 && node.y === 0);
  assert.deepEqual(first.roles.sort(), ['corner', 'opening-start']);
  assert.equal(atCorner.totals.spanCount, 15);
  assert.equal(atCorner.totals.nodeCount, 16);
  const adjacent = fence({ ...fenceExample, openings: [{ id: 'a', side: 0, position: 0, width: 2000 }, { id: 'b', side: 0, position: 2000, width: 2000 }] });
  const shared = adjacent.geometry.nodes.filter(node => node.x === 2000 && node.y === 0);
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].roles.sort(), ['opening-end', 'opening-start']);
  assert.deepEqual(shared[0].openingIds, ['a', 'b']);
  assert.equal(adjacent.totals.spanCount, 15);
  assert.equal(adjacent.totals.nodeCount, 17);
});

test('fence: whole side opening produces no phantom spans or duplicated ends', () => {
  const result = fence({ ...fenceExample, openings: [{ id: 'all', side: 0, position: 0, width: 10000 }] });
  assert.equal(result.totals.spanCount, 12);
  assert.equal(result.totals.nodeCount, 13);
  assert.equal(result.geometry.spans.filter(span => span.side === 0).length, 0);
  const line = fence({ type: 'line', length: 10000, width: '', height: 2000, maxStep: 2500, openings: [{ id: 'all', side: 0, position: 0, width: 10000 }] });
  assert.equal(line.totals.spanCount, 0);
  assert.equal(line.totals.nodeCount, 2);
  assert.equal(line.totals.fenceLengthMm, 0);
});

test('fence: exact decimal step does not add a phantom span', () => {
  const result = fence({ type: 'line', length: '0,3', width: '', height: 1000, maxStep: '0,1', openings: [] });
  assert.equal(result.totals.spanCount, 3);
  assert.equal(result.totals.nodeCount, 4);
  assert.equal(result.geometry.spans.at(-1).x2, 0.3);
  for (const span of result.geometry.spans) near(span.length, 0.1);
});

test('fence: geometry balance and unique node references over varying openings', () => {
  for (let i = 0; i < 80; i++) {
    const result = fence({ ...fenceExample, length: 9000 + i * 13, width: 7000 + i * 17, maxStep: 1300 + i * 19, openings: [{ id: 'gate', name: 'Ворота', side: i % 4, position: 100 + i, width: 2000 }] });
    const nodeIds = new Set(result.geometry.nodes.map(node => node.id));
    const positions = new Set(result.geometry.nodes.map(node => `${node.x}:${node.y}`));
    assert.equal(positions.size, nodeIds.size);
    for (const span of result.geometry.spans) {
      assert.ok(span.length > 0 && span.length <= result.input.maxStep);
      assert.ok(nodeIds.has(span.startNode) && nodeIds.has(span.endNode));
      near(Math.hypot(span.x2 - span.x1, span.y2 - span.y1), span.length, 1e-8);
    }
    near(result.geometry.spans.reduce((sum, span) => sum + span.length, 0) + result.totals.openingLengthMm, result.totals.perimeterMm, 1e-7);
  }
});

test('fence: rejects invalid openings and excessive tasks before allocation', () => {
  for (const input of [fenceBlank, { ...fenceExample, maxStep: 0 }, { ...fenceExample, maxStep: 0.001 }, { ...fenceExample, openings: [{ id: 'a', side: 0, position: 9000, width: 2000 }] }, { ...fenceExample, openings: [{ id: 'a', side: 0, position: 3000, width: 2000 }, { id: 'b', side: 0, position: 4000, width: 2000 }] }, { ...fenceExample, openings: [{ id: 'a', side: 0, position: -1, width: 1000 }] }, { ...fenceExample, openings: [{ id: 'a', side: 4, position: 0, width: 1000 }] }, { ...fenceExample, openings: [{ id: 'a', side: 0, position: 0, width: 0 }] }]) assert.throws(() => fence(input));
});

test('tile: exact 1004mm grid hand standard has four whole tiles', () => {
  const result = tile({ ...tileExample, length: 1004, width: 1004, tileLength: 500, tileWidth: 500, seam: 4 });
  assert.equal(result.totals.fullCount, 4);
  assert.equal(result.totals.cutCount, 0);
  assert.equal(result.totals.sourceCount, 4);
  assert.deepEqual(result.geometry.edgeCuts, { left: [], right: [], top: [], bottom: [] });
  near(result.totals.tileAreaM2, 1);
});

test('tile: 1200mm field has 597mm edge and each cut requires its own source', () => {
  const result = tile(tileExample);
  assert.equal(result.totals.fullCount, 1);
  assert.equal(result.totals.cutCount, 3);
  assert.equal(result.totals.sourceCount, 4);
  assert.deepEqual(result.geometry.edgeCuts.right, [597]);
  assert.deepEqual(result.geometry.edgeCuts.bottom, [597]);
  assert.deepEqual(result.geometry.tiles.map(t => [t.width, t.height]), [[600, 600], [597, 600], [600, 597], [597, 597]]);
});

test('tile: 2mm slivers remain explicit and highlighted', () => {
  const result = tile({ ...tileExample, length: 1010, width: 1004, tileLength: 500, tileWidth: 500, seam: 4 });
  assert.equal(result.totals.fullCount, 4);
  assert.equal(result.totals.cutCount, 2);
  assert.equal(result.totals.sourceCount, 6);
  assert.equal(result.totals.narrowCount, 2);
  assert.deepEqual(result.geometry.tiles.filter(t => t.cut).map(t => [t.width, t.height]), [[2, 500], [2, 500]]);
});

test('tile: seam is not material; touching a boundary creates no tile', () => {
  for (const length of [500, 502, 504]) {
    const result = tile({ ...tileExample, length, width: 500, tileLength: 500, tileWidth: 500, seam: 4 });
    assert.equal(result.totals.sourceCount, 1, `width ${length}`);
    assert.equal(result.totals.fullCount, 1);
  }
  const fractional = tile({ ...tileExample, length: '2,1', width: '2,1', tileLength: 1, tileWidth: 1, seam: '0,1' });
  assert.equal(fractional.totals.sourceCount, 4);
  assert.equal(fractional.totals.fullCount, 4);
});

test('tile: symmetric tile/joint and mixed centres have independently expected edges', () => {
  const base = { ...tileExample, length: 1200, width: 1200, tileLength: 500, tileWidth: 500, seam: 4 };
  const byTile = tile({ ...base, mode: 'symmetric-tile' });
  assert.equal(byTile.totals.sourceCount, 9);
  assert.equal(byTile.totals.fullCount, 1);
  assert.deepEqual(byTile.geometry.edgeCuts.left, [346]);
  assert.deepEqual(byTile.geometry.edgeCuts.right, [346]);
  const byJoint = tile({ ...base, mode: 'symmetric-joint' });
  assert.equal(byJoint.totals.sourceCount, 16);
  assert.equal(byJoint.totals.fullCount, 4);
  assert.deepEqual(byJoint.geometry.edgeCuts.left, [94]);
  assert.deepEqual(byJoint.geometry.edgeCuts.right, [94]);
  const mixed = tile({ ...base, mode: 'symmetric-tile', centerY: 'joint' });
  assert.equal(mixed.totals.sourceCount, 12);
  assert.equal(mixed.totals.fullCount, 2);
  assert.deepEqual(mixed.geometry.edgeCuts.left, [346]);
  assert.deepEqual(mixed.geometry.edgeCuts.top, [94]);
});

test('tile: perimeter gap, rotation and grid offsets use actual intersections', () => {
  const gap = tile({ ...tileExample, length: 1014, width: 1014, tileLength: 500, tileWidth: 500, seam: 4, gap: 5 });
  assert.equal(gap.totals.fullCount, 4);
  assert.equal(gap.geometry.tiles[0].x, 5);
  assert.equal(gap.geometry.tiles[0].y, 5);
  const rotated = tile({ ...tileExample, length: 1004, width: 300, tileLength: 300, tileWidth: 500, rotate: true, seam: 4 });
  assert.equal(rotated.totals.fullCount, 2);
  assert.equal(rotated.totals.sourceCount, 2);
  const offset = tile({ ...tileExample, length: 1004, width: 500, tileLength: 500, tileWidth: 500, seam: 4, offsetX: 100 });
  assert.equal(offset.totals.sourceCount, 3);
  assert.deepEqual(offset.geometry.tiles.map(t => t.width), [96, 500, 400]);
  const periodic = tile({ ...offset.input, offsetX: 604 });
  assert.deepEqual(periodic.geometry.tiles.map(t => [t.x, t.width]), offset.geometry.tiles.map(t => [t.x, t.width]));
});

test('tile: explicit reserve and package rounding have no floating phantom', () => {
  const result = tile({ ...tileExample, length: 10000, width: 1000, tileLength: 100, tileWidth: 100, seam: 0, reservePercent: 0.1, packSize: 7 });
  assert.equal(result.totals.sourceCount, 1000);
  assert.equal(result.totals.reserveCount, 1);
  assert.equal(result.totals.requiredCount, 1001);
  assert.equal(result.totals.packCount, 143);
  assert.equal(result.totals.purchasedCount, 1001);
  const fraction = tile({ ...tileExample, length: 300, width: 100, tileLength: 100, tileWidth: 100, seam: 0, reservePercent: 33.333, packSize: 4 });
  assert.equal(fraction.totals.sourceCount, 3);
  assert.equal(fraction.totals.reserveCount, 1);
  assert.equal(fraction.totals.packCount, 1);
});

test('tile: maximum permissible task retains all elements and correct grouping', () => {
  const result = tile({ ...tileExample, length: 20000, width: 10000, tileLength: 100, tileWidth: 100, seam: 0 });
  assert.equal(result.totals.sourceCount, 20_000);
  assert.equal(result.geometry.tiles.length, 20_000);
  assert.equal(result.rows[0].count, 20_000);
  assert.equal(result.rows[0].sourceCount, 20_000);
});

test('tile: bounds, source dimensions and task limit reject instead of truncating', () => {
  for (const input of [tileBlank, { ...tileExample, gap: 600 }, { ...tileExample, tileLength: 0 }, { ...tileExample, seam: -1 }, { ...tileExample, rotate: 1 }, { ...tileExample, packSize: 1.5 }, { ...tileExample, length: 1000000, width: 1000000, tileLength: 1, tileWidth: 1 }, { ...tileExample, mode: 'diagonal' }]) assert.throws(() => tile(input));
});

test('all engines: strict input, empty/null/negative/huge/nonfinite and read-only operation', () => {
  for (const [calculate, example] of [[foundation, foundationExample], [fence, fenceExample], [tile, tileExample]]) {
    const before = copy(example);
    calculate(example);
    assert.deepEqual(example, before);
    for (const invalid of ['', ' ', null, undefined, -1, Infinity, NaN, '1e3', '1,2.3', '1.0001', 1000001, {}, []]) assert.throws(() => calculate({ ...example, length: invalid }));
    assert.throws(() => calculate({ ...example, unexpected: 'field' }), error => error.field === 'input.unexpected');
    const result = calculate(example);
    assert.equal(result.methodologyVersion, calculate === foundation ? '1.1.0' : '1.0.0');
    assert.ok(result.rows.every(row => result.columns.every(column => Object.hasOwn(row, column.key))));
    assert.deepEqual(calculate(result.input), result, 'normalization and restoration must preserve calculation result');
  }
});

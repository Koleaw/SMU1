import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validate, example, blank, methodologyVersion } from './cutting.mjs';

const part = (length, quantity = 1, id = 'p1', extra = {}) => ({ id, name: `Деталь ${id}`, profile: '40 × 40 × 2', material: 'Сталь', length, quantity, ...extra });
const source = (length, quantity = 1, id = 's1', extra = {}) => ({ id, name: `Заготовка ${id}`, kind: 'stock', profile: '40 × 40 × 2', material: 'Сталь', length, quantity, ...extra });
const purchase = (length, quantity = null, id = 'b1', extra = {}) => ({ id, profile: '40 × 40 × 2', material: 'Сталь', length, quantity, ...extra });
const job = (parts, stock = [], purchases = [], extra = {}) => ({ kerf: 3, trimStart: 0, trimEnd: 0, minUsefulRemnant: 100, parts, stock, purchases, ...extra });
const units = (value) => Math.round(value * 1000);

function verifyAccounting(input, result) {
  const occurrences = new Map();
  const used = new Map();
  for (const map of result.maps) {
    assert.equal(units(map.partLength) + units(map.kerfLength) + units(map.trimLength) + units(map.remainingLength), units(map.length));
    assert.equal(units(map.partLength) + units(map.usefulRemnant) + units(map.waste), units(map.length));
    let cursor = 0;
    for (const segment of map.segments) {
      assert.equal(units(segment.start), cursor);
      assert.ok(segment.length > 0);
      cursor += units(segment.length);
      assert.equal(cursor, units(segment.end));
    }
    assert.equal(cursor, units(map.length));
    for (const piece of map.parts) {
      const key = `${piece.partId}:${piece.pieceNumber}`;
      assert.equal(occurrences.has(key), false, `duplicate piece ${key}`);
      occurrences.set(key, true);
    }
    used.set(map.sourceKey, (used.get(map.sourceKey) || 0) + 1);
  }
  for (const piece of result.unplaced) {
    const key = `${piece.partId}:${piece.pieceNumber}`;
    assert.equal(occurrences.has(key), false);
    occurrences.set(key, true);
  }
  for (const row of input.parts) for (let i = 1; i <= row.quantity; i++) assert.ok(occurrences.has(`${row.id}:${i}`));
  for (const row of input.stock) assert.ok((used.get(`stock:${row.id}`) || 0) <= row.quantity);
  for (const row of input.purchases) if (row.quantity !== null) assert.ok((used.get(`purchase:${row.id}`) || 0) <= row.quantity);
  assert.equal(result.totals.requestedPieces, occurrences.size);
  assert.equal(result.rows.length, result.maps.reduce((sum, map) => sum + map.segments.length, 0));
}

test('independent manual example: two 500 mm parts do not fit a 1000 mm bar at kerf 3 mm', () => {
  const input = job([part(500, 2)], [source(1000)]), result = calculate(input);
  assert.equal(result.totals.placedPieces, 1);
  assert.equal(result.totals.unplacedPieces, 1);
  assert.equal(result.maps[0].remainingLength, 497);
  assert.equal(result.maps[0].kerfLength, 3);
  verifyAccounting(input, result);
});
test('independent manual example: 500 + 3 + 497 = 1000, no invented final cut', () => {
  const input = job([part(500), part(497, 1, 'p2')], [source(1000)]), result = calculate(input);
  assert.equal(result.totals.placedPieces, 2);
  assert.equal(result.maps[0].kerfLength, 3);
  assert.equal(result.maps[0].remainingLength, 0);
  assert.equal(result.maps[0].cuttingPasses, 1);
  assert.deepEqual(result.maps[0].segments.map((s) => s.type), ['part', 'kerf', 'part']);
  verifyAccounting(input, result);
});
test('independent manual example: 400 + 3 + 400 + 3 + 194 = 1000', () => {
  const input = job([part(400, 2)], [source(1000)]), result = calculate(input);
  assert.equal(result.maps[0].kerfLength, 6);
  assert.equal(result.maps[0].remainingLength, 194);
  assert.equal(result.maps[0].usefulRemnant, 194);
  assert.equal(result.maps[0].waste, 6);
  assert.equal(result.maps[0].cuttingPasses, 2);
  verifyAccounting(input, result);
});
test('short end smaller than kerf is removed with an overhanging blade, not a negative tail', () => {
  const input = job([part(998)], [source(1000)]), result = calculate(input);
  assert.equal(result.maps[0].kerfLength, 2);
  assert.equal(result.maps[0].remainingLength, 0);
  assert.equal(result.maps[0].kerfs[0].nominalWidth, 3);
  assert.equal(result.maps[0].kerfs[0].partial, true);
  assert.equal(result.maps[0].cuttingPasses, 1);
  verifyAccounting(input, result);
});
test('trims include their own kerfs and are consumed once per end', () => {
  const input = job([part(500), part(497, 1, 'p2')], [source(1020)], [], { trimStart: 10, trimEnd: 10 });
  const result = calculate(input), map = result.maps[0];
  assert.equal(map.usableLength, 1000);
  assert.equal(map.trimLength, 20);
  assert.equal(map.kerfLength, 3);
  assert.equal(map.remainingLength, 0);
  assert.equal(map.trimPasses, 2);
  assert.equal(map.parts[0].start, 10);
  verifyAccounting(input, result);
});
test('each existing remnant is finite and uniquely identified', () => {
  const input = job([part(400, 5)], [source(1000, 1, 'r1', { kind: 'remnant' }), source(1000, 1, 'r2', { kind: 'remnant' })]);
  const result = calculate(input);
  assert.equal(result.maps.length, 2);
  assert.equal(result.totals.placedPieces, 4);
  assert.equal(result.totals.unplacedPieces, 1);
  assert.deepEqual(result.maps.map((m) => m.sourceId).sort(), ['r1', 'r2']);
  assert.ok(result.maps.every((m) => m.sourceOrdinal === 1));
  verifyAccounting(input, result);
});
test('finite purchase counts and missing source reasons are explicit', () => {
  const finite = calculate(job([part(800, 2)], [], [purchase(1000, 1)]));
  assert.equal(finite.totals.newBars, 1);
  assert.equal(finite.unplaced.length, 1);
  assert.equal(finite.unplaced[0].reasonCode, 'finite-stock-or-heuristic');
  const tooLong = calculate(job([part(1001)], [source(1000)]));
  assert.equal(tooLong.unplaced[0].reasonCode, 'too-long');
  const noSource = calculate(job([part(500)]));
  assert.equal(noSource.unplaced[0].reasonCode, 'no-compatible-source');
});
test('profile and material groups never share a bar', () => {
  const input = job([
    part(400), part(400, 1, 'p2', { material: 'Алюминий' }), part(400, 1, 'p3', { profile: '60 × 40 × 2' }),
  ], [source(2000)]);
  const result = calculate(input);
  assert.equal(result.totals.placedPieces, 1);
  assert.equal(result.unplaced.length, 2);
  assert.equal(result.maps.length, 1);
  verifyAccounting(input, result);
});
test('new material length takes priority over buying the shortest fitting option', () => {
  const input = job([part(600, 2)], [], [purchase(1100, null, 'short'), purchase(2000, null, 'long')]);
  const result = calculate(input);
  assert.equal(result.totals.newLength, 2000);
  assert.equal(result.totals.newBars, 1);
  assert.equal(result.procurement[0].sourceId, 'long');
  assert.equal(result.procurement[0].cleanPartsLength, 1200);
  assert.equal(result.procurement[0].totalLength, 2000);
  verifyAccounting(input, result);
});
test('existing material avoids buying stock and unused inventory is not consumed', () => {
  const input = job([part(500)], [source(600), source(1000, 2, 'unused')], [purchase(1000)]);
  const result = calculate(input);
  assert.equal(result.totals.newLength, 0);
  assert.equal(result.totals.newBars, 0);
  assert.equal(result.totals.stockBars, 1);
  assert.equal(result.unusedStock.reduce((sum, s) => sum + s.remaining, 0), 2);
  verifyAccounting(input, result);
});
test('useful threshold uses exact boundary and zero kerf is supported', () => {
  const at = calculate(job([part(400, 2)], [source(1000)], [], { minUsefulRemnant: 194 }));
  assert.equal(at.maps[0].usefulRemnant, 194);
  const below = calculate(job([part(400, 2)], [source(1000)], [], { minUsefulRemnant: 194.001 }));
  assert.equal(below.maps[0].usefulRemnant, 0);
  assert.equal(below.maps[0].waste, 200);
  const exactInput = job([part(500.001, 2)], [source(1000.002)], [], { kerf: 0 });
  const exact = calculate(exactInput);
  assert.equal(exact.totals.placedPieces, 2);
  assert.equal(exact.maps[0].remainingLength, 0);
  assert.equal(exact.maps[0].cuttingPasses, 1);
  verifyAccounting(exactInput, exact);
});
test('pure engine does not mutate inputs; all interfaces are JSON serializable', () => {
  const input = structuredClone(example), before = JSON.stringify(input), result = calculate(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.deepEqual(calculate(input), result);
  assert.equal(result.methodologyVersion, methodologyVersion);
  assert.throws(() => calculate(blank), /Профиль|Название|длина|число/);
  verifyAccounting(input, result);
});
test('strict input validation rejects missing, negative, excessive, unknown and overprecise values', () => {
  const valid = job([part(500)], [source(1000)]);
  for (const bad of ['', null, undefined, '500', NaN, Infinity, -1, 0, 1_000_001, 1.00001]) {
    const input = structuredClone(valid); input.parts[0].length = bad;
    assert.throws(() => calculate(input), Error, `length ${String(bad)}`);
  }
  for (const bad of ['', null, -1, 0, 1.5, 1001]) {
    const input = structuredClone(valid); input.parts[0].quantity = bad;
    assert.throws(() => calculate(input), Error);
  }
  assert.throws(() => calculate({ ...valid, unknown: 1 }), /неизвестное поле/);
  assert.throws(() => calculate({ ...valid, parts: [part(500, 501), part(500, 500, 'p2')] }), /1000 деталей/);
  assert.throws(() => calculate({ ...valid, parts: [part(500), part(400)] }), /повторяется ID/);
  assert.throws(() => calculate({ ...valid, trimStart: 1000 }), /сумма торцовок/);
  assert.throws(() => calculate({ ...valid, stock: [source(1000, 501), source(1000, 500, 's2')] }), /1000 заготовок/);
  assert.throws(() => calculate({ ...valid, parts: [part(500, 1, 'p', { name: 'x\u0000y' })] }), /текст/);
  assert.throws(() => calculate({ ...valid, purchases: [purchase(1000, '')] }), /число/);
  assert.doesNotThrow(() => validate(valid));
});

// Independent exhaustive oracle. It enumerates assignments to individual physical bars;
// it never calls the engine's placement, accounting, comparison, or validation functions.
function oracle(input) {
  const pieces = input.parts.flatMap((row) => Array(row.quantity).fill(row.length));
  const bars = [];
  for (const row of input.stock) for (let i = 0; i < row.quantity; i++) bars.push({ length: row.length, purchase: false, pieces: [] });
  for (const row of input.purchases) for (let i = 0; i < (row.quantity ?? pieces.length); i++) bars.push({ length: row.length, purchase: true, pieces: [] });
  let best = null;
  function lexLess(a, b) { if (!b) return true; for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; }
  function walk(index, missing, missingLength) {
    if (best && missing > best[0]) return;
    if (index === pieces.length) {
      let newLength = 0, newCount = 0;
      for (const bar of bars) if (bar.purchase && bar.pieces.length) { newLength += bar.length; newCount++; }
      const score = [missing, missingLength, newLength, newCount];
      if (lexLess(score, best)) best = score;
      return;
    }
    const symmetry = new Set();
    for (const bar of bars) {
      const signature = `${bar.purchase}/${bar.length}/${bar.pieces.join(',')}`;
      if (symmetry.has(signature)) continue;
      symmetry.add(signature);
      const trial = [...bar.pieces, pieces[index]];
      const internalCuts = Math.max(0, trial.length - 1);
      if (trial.reduce((a, b) => a + b, 0) + internalCuts * input.kerf + input.trimStart + input.trimEnd > bar.length) continue;
      bar.pieces.push(pieces[index]); walk(index + 1, missing, missingLength); bar.pieces.pop();
    }
    walk(index + 1, missing + 1, missingLength + pieces[index]);
  }
  walk(0, 0, 0);
  return best;
}

test('bounded small search agrees with an independent exhaustive physical-bar oracle', () => {
  let seed = 81923;
  const random = (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let run = 0; run < 60; run++) {
    const count = 2 + random(5);
    const input = job(
      Array.from({ length: count }, (_, i) => part(100 + random(9) * 100, 1, `p${i}`)),
      [source(500 + random(5) * 200, 1, 'a', { kind: 'remnant' }), source(800 + random(4) * 200, 1, 'b')],
      [purchase(900 + random(5) * 200, run % 3 === 0 ? 1 : null)],
      { kerf: random(5), trimStart: random(3), trimEnd: random(3) },
    );
    const expected = oracle(input), actual = calculate(input);
    assert.equal(actual.groups[0].smallSearchCompleted, true, `run ${run}`);
    assert.deepEqual([actual.unplaced.length, actual.unplaced.reduce((sum, p) => sum + p.length, 0), actual.totals.newLength, actual.totals.newBars], expected, `run ${run}: ${JSON.stringify(input)}`);
    verifyAccounting(input, actual);
  }
});
test('largest accepted job preserves all 1000 pieces without expanding output silently', () => {
  const input = job([part(100, 1000)], [source(1000, 20, 'r', { kind: 'remnant' })], [purchase(6000)]);
  const result = calculate(input);
  assert.equal(result.totals.placedPieces, 1000);
  assert.equal(result.totals.unplacedPieces, 0);
  assert.equal(result.groups[0].smallSearchCompleted, false);
  verifyAccounting(input, result);
});
test('cancellation is observable before and during a calculation', () => {
  assert.throws(() => calculate(example, { signal: { aborted: true } }), { name: 'AbortError' });
  let calls = 0;
  assert.throws(() => calculate(job([part(100, 1000)], [], [purchase(6000)]), { shouldCancel: () => ++calls > 5 }), { name: 'AbortError' });
});

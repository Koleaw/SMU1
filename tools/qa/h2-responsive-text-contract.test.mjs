import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateResponsiveTextOverflow } from '../migration/h2-responsive-text-contract.mjs';

test('heading overflow inside a column fails even without document overflow', () => {
  for (const overflow of [20, 65, 9]) {
    const result = evaluateResponsiveTextOverflow({ initial: { h1: { selector: 'h1', lines: 3, overflow } } });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].overflow, overflow);
    assert.equal(result.issues[0].role, 'h1');
  }
});

test('map-address H2 and lead are checked in the initial and scrolled states', () => {
  const result = evaluateResponsiveTextOverflow({
    initial: { h2: { selector: '#contacts-address-title', lines: 3, overflow: 3 }, lead: { overflow: 0 } },
    scrolled: { h2: { selector: '#contacts-address-title', lines: 3, overflow: 5 }, lead: { overflow: 9 } }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map(({ state, role }) => ({ state, role })), [
    { state: 'initial', role: 'h2' }, { state: 'scrolled', role: 'h2' }, { state: 'scrolled', role: 'lead' }
  ]);
});

test('four or five lines without overflow remain valid and the glyph tolerance stays at two pixels', () => {
  assert.equal(evaluateResponsiveTextOverflow({ initial: { h1: { lines: 5, overflow: 0 }, h2: { lines: 4, overflow: 0 }, lead: null } }).ok, true);
  assert.equal(evaluateResponsiveTextOverflow({ initial: { h1: { overflow: 2 } } }).ok, true);
  assert.equal(evaluateResponsiveTextOverflow({ initial: { h1: { overflow: 2.01 } } }).ok, false);
  assert.equal(evaluateResponsiveTextOverflow({ initial: { h1: { overflow: NaN } } }).ok, false);
});

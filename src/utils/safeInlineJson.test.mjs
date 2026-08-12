import test from 'node:test';
import assert from 'node:assert/strict';
import { safeInlineJson } from './safeInlineJson.mjs';

test('inline JSON cannot terminate a script element and round-trips exactly', () => {
  const value = {
    title: '</script><script>alert("x")</script>',
    caption: 'one & two > zero',
    separators: '\u2028\u2029'
  };
  const serialized = safeInlineJson(value);
  assert.equal(serialized.includes('<'), false);
  assert.equal(serialized.includes('>'), false);
  assert.equal(serialized.includes('&'), false);
  assert.deepEqual(JSON.parse(serialized), value);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const HEADER_BLOCK = /:root\[data-v2-public-route='true'\] \.home-v2-body \.hv2-header(?<state>:not\(\.is-scrolled\)|\.is-scrolled)\s*\{(?<body>[^}]+)\}/gu;

test('H4 header keeps the standard backdrop declaration after its WebKit fallback', async () => {
  const source = await readFile(path.resolve('src/styles/v2/h4-scale-v2.css'), 'utf8');
  const blocks = [...source.matchAll(HEADER_BLOCK)];

  assert.equal(blocks.length, 2, 'expected unscrolled and scrolled public header blocks');
  for (const match of blocks) {
    const body = match.groups.body;
    const declarations = [...body.matchAll(/(?:^|;)\s*(?<property>-webkit-backdrop-filter|backdrop-filter)\s*:\s*none(?:\s*!important)?\s*(?=;|$)/gu)];
    const prefixed = declarations.findIndex(({ groups }) => groups.property === '-webkit-backdrop-filter');
    const standard = declarations.findIndex(({ groups }) => groups.property === 'backdrop-filter');
    assert.ok(prefixed >= 0, `${match.groups.state}: missing WebKit fallback`);
    assert.ok(standard > prefixed, `${match.groups.state}: standalone standard declaration must follow WebKit fallback`);
  }
});

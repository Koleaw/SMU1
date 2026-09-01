import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { REPO_ROOT } from './test-helpers/corpus-fixture.mjs';

const sourcePath = path.join(REPO_ROOT, 'src/admin/bindings/adminBinding.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const loadModule = async (localAdmin) => {
  const withFlag = compiled.replaceAll(
    'import.meta.env.SMU1_LOCAL_ADMIN',
    JSON.stringify(localAdmin ? 'true' : 'false')
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(withFlag).toString('base64')}`;
  return import(moduleUrl);
};
const publicModule = await loadModule(false);
const localAdminModule = await loadModule(true);
const { stableBindingId } = publicModule;

test('long binding IDs retain a deterministic collision-resistant suffix', () => {
  const url = new URL('http://127.0.0.1/catalog/example/');
  const definition = {
    renderer: { family: 'catalog', variant: 'standard', version: 'h6-v1' },
    owner: { collection: 'products', slug: 'example' },
    fieldPath: `gallery[0].${'nested'.repeat(45)}`,
    stableItemId: `${'shared-prefix-'.repeat(30)}first`
  };
  const first = stableBindingId(url, definition);
  const second = stableBindingId(url, { ...definition, stableItemId: `${'shared-prefix-'.repeat(30)}second` });
  assert.ok(first.length <= 240);
  assert.ok(second.length <= 240);
  assert.notEqual(first, second);
  assert.equal(first, stableBindingId(url, definition));
  assert.match(first, /-[0-9a-f]{16}$/u);
});

test('admin disposition is emitted only for an explicit local editor session', () => {
  const definition = {
    kind: 'derived',
    reason: 'The label follows the set of visible sections.',
    source: 'src/components/v2/pages/MetalworksV2Page.astro#sectionNavItems',
    tool: 'page-settings'
  };
  const editorUrl = new URL('http://127.0.0.1/metallokonstruktsii-dlya-biznesa/?__smu1_editor=1&editorSession=01234567-89ab-4cde-8fab-0123456789ab&editorRevision=7');

  assert.deepEqual(publicModule.adminDisposition(editorUrl, definition), {});
  assert.deepEqual(localAdminModule.adminDisposition(new URL('http://127.0.0.1/metallokonstruktsii-dlya-biznesa/'), definition), {});
  assert.deepEqual(localAdminModule.adminDisposition(editorUrl, definition), {
    'data-smu1-editor-disposition': 'derived',
    'data-smu1-editor-reason': definition.reason,
    'data-smu1-editor-source': definition.source,
    'data-smu1-editor-tool': 'page-settings'
  });
});

test('admin disposition rejects blank provenance in the local canvas', () => {
  const editorUrl = new URL('http://127.0.0.1/?__smu1_editor=1&editorSession=01234567-89ab-4cde-8fab-0123456789ab&editorRevision=1');
  assert.throws(() => localAdminModule.adminDisposition(editorUrl, {
    kind: 'template-fixed', reason: '   ', source: 'src/components/Header.astro'
  }), /non-empty reason and source/u);
});

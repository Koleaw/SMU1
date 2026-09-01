import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExactPrerenderManifestError,
  normalizeExactRoute,
  normalizeExactRouteManifest,
  selectExactStaticPaths,
  validatedExactRouteManifestInput
} from './exact-prerender-integration.mjs';

const route = (pathname) => ({ pathname, route: { component: `${pathname || 'root'}.astro`, prerender: true } });
const manifest = (expectations) => ({
  version: 1,
  kind: 'smu1-exact-route-closure',
  runId: `exact-${'a'.repeat(32)}`,
  transactionId: 'tx-exact-test',
  expectations
});

test('exact route closure normalizes trailing slash only and rejects unsafe or ambiguous routes', () => {
  assert.equal(normalizeExactRoute('/'), '/');
  assert.equal(normalizeExactRoute('/catalog/item/'), '/catalog/item');
  assert.equal(normalizeExactRoute('/404.html'), '/404.html');
  for (const unsafe of ['//evil.example/x', '/a//b/', '/a/../b/', '/a?x=1', '/a#x', '/a\\b', '/%2e%2e/x', 'relative']) {
    assert.throws(() => normalizeExactRoute(unsafe), ExactPrerenderManifestError);
  }
  assert.throws(() => normalizeExactRouteManifest(manifest([
    { route: '/same/', expected: 'html' },
    { route: '/same', expected: 'html' }
  ])), (error) => error.code === 'EXACT_ROUTE_DUPLICATE');
});

test('targeted production SSG selection enumerates full topology but emits only requested HTML', () => {
  const paths = [route('/'), route('/catalog/'), route('/catalog/item/'), route('/project/'), route('/404.html')];
  const selected = selectExactStaticPaths(paths, manifest([
    { route: '/catalog/item/', expected: 'html' },
    { route: '/project/', expected: 'html' }
  ]));
  assert.deepEqual(selected.selected.map((entry) => entry.pathname), ['/catalog/item/', '/project/']);
  assert.equal(selected.evidence.mode, 'targeted-production-ssg');
  assert.equal(selected.evidence.authoritativePathCount, 5);
  assert.equal(selected.evidence.selectedPathCount, 2);
});

test('validated manifest input remains strict when the Astro hook validates it again', () => {
  const input = manifest([{ route: '/catalog/item/', expected: 'html' }]);
  const validatedInput = validatedExactRouteManifestInput(input);
  assert.deepEqual(Object.keys(validatedInput.expectations[0]).sort(), ['expected', 'route']);
  const selected = selectExactStaticPaths([route('/catalog/item/')], validatedInput);
  assert.deepEqual(selected.selected.map((entry) => entry.pathname), ['/catalog/item/']);
});

test('not-found expectation proves absence from topology and selects the canonical 404 renderer', () => {
  const paths = [route('/'), route('/active/'), route('/404.html')];
  const selected = selectExactStaticPaths(paths, manifest([
    { route: '/removed/', expected: 'not-found' },
    { route: '/active/', expected: 'html' }
  ]));
  assert.deepEqual(selected.selected.map((entry) => entry.pathname), ['/active/', '/404.html']);
  assert.throws(
    () => selectExactStaticPaths(paths, manifest([{ route: '/active/', expected: 'not-found' }])),
    (error) => error.code === 'EXACT_NOT_FOUND_ROUTE_PRESENT'
  );
  assert.throws(
    () => selectExactStaticPaths(paths, manifest([{ route: '/missing-html/', expected: 'html' }])),
    (error) => error.code === 'EXACT_AFFECTED_ROUTE_MISSING'
  );
});

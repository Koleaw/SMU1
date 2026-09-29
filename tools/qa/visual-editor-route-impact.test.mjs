import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { COLLECTION_KEYS } from '../admin-api/content-registry.mjs';
import { buildExpectedRouteModel } from './route-passport-model.mjs';
import { buildPageRegistry, affectedRoutesForPageBinding } from '../../src/admin/shell/visual-editor-app.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const TOOL_ROUTES = ['/instrumenty/', '/instrumenty/metal/', '/instrumenty/raskroy/', '/instrumenty/fundament/',
  '/instrumenty/ograzhdenie/', '/instrumenty/plitka/', '/instrumenty/maf/', '/instrumenty/zdanie/'];
const byRoute = (left, right) => left.localeCompare(right, 'en');

async function actualSummaries() {
  return new Map(await Promise.all(COLLECTION_KEYS.map(async collection => {
    const directory = path.join(root, 'src/content', collection);
    const files = (await readdir(directory)).filter(name => name.endsWith('.json'));
    return [collection, await Promise.all(files.map(async name => {
      const record = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      // Match the admin list API shape. Registry fields live in summary;
      // the expected route set is independently derived by route-passport-model.
      return { slug: record.slug || name.slice(0, -5), title: record.title || record.companyName,
        isActive: record.isActive ?? null, order: record.order ?? null,
        summary: { ...record, hasPrimaryMedia: Boolean(record.coverImage || record.image),
          galleryCount: (record.gallery || []).length + (record.images || []).length } };
    }))];
  })));
}

test('global phone impact covers the authoritative 119 routes including all eight tool pages', async () => {
  const summaries = await actualSummaries();
  const pages = buildPageRegistry(summaries);
  const phoneBinding = { ownerCollection: 'site-settings', recordSlug: 'global', fieldPath: 'phonePrimary', scope: 'global', affectedRoutes: ['*'] };
  const displayed = affectedRoutesForPageBinding(phoneBinding, pages).sort(byRoute);
  const expected = buildExpectedRouteModel({ root }).routes.map(route => route.pathname).sort(byRoute);
  assert.equal(expected.length, 119, 'the independently audited public route set stays complete');
  assert.equal(displayed.length, 119);
  assert.equal(new Set(displayed).size, 119, 'each affected route is displayed once');
  assert.deepEqual(displayed, expected);
  for (const route of TOOL_ROUTES) assert.ok(displayed.includes(route), `global phone change affects ${route}`);
  assert.ok(!displayed.some(route => route.includes('tool-references')), 'reference records do not invent public pages');

  // Changing the common phone must retain the complete impact closure.
  const global = summaries.get('site-settings').find(entry => entry.slug === 'global');
  global.summary.phonePrimary = '+7 (900) 123-45-67';
  assert.deepEqual(affectedRoutesForPageBinding(phoneBinding, buildPageRegistry(summaries)).sort(byRoute), expected);
});

test('tool records preserve stable owners and local bindings do not become global', async () => {
  const pages = buildPageRegistry(await actualSummaries());
  const archive = pages.find(page => page.route === '/instrumenty/');
  assert.equal(archive.readOnly, true, 'the generated archive has no invented editable record');
  for (const route of TOOL_ROUTES.slice(1)) {
    const page = pages.find(item => item.route === route);
    assert.equal(page.collection, 'tools');
    assert.equal(page.slug, route.split('/')[2]);
    assert.equal(page.parentRoute, '/instrumenty/');
    assert.equal(page.emitted, true);
  }
  assert.deepEqual(affectedRoutesForPageBinding({ affectedRoutes: ['/instrumenty/metal/', '/instrumenty/metal/'] }, pages), ['/instrumenty/metal/']);
  assert.deepEqual(affectedRoutesForPageBinding({ affectedRoutes: [] }, pages), []);
  assert.deepEqual(affectedRoutesForPageBinding({ affectedRoutes: ['*'] }, [{ route: '/active/', emitted: true }, { route: '/hidden/', emitted: false }]), ['/active/']);
});

test('both admin shells and round-trip fixtures load the central collection inventory', async () => {
  for (const source of ['src/admin/shell/visual-editor-app.mjs', 'src/admin/shell/admin-app.mjs']) {
    const text = await readFile(path.join(root, source), 'utf8');
    assert.match(text, /import \{ COLLECTION_KEYS as COLLECTIONS \} from ['"].*content-registry\.mjs['"]/u, source);
    assert.match(text, /COLLECTIONS\.map\(async \(collection\)/u, source);
  }
  const editor = await readFile(path.join(root, 'src/admin/shell/visual-editor-app.mjs'), 'utf8');
  assert.match(editor, /return affectedRoutesForPageBinding\(binding, state\.pages\)/u, 'the tested resolver is the actual provenance and impact-drawer resolver');
  const header = await readFile(path.join(root, 'src/components/v2/home-v2/HomeV2Header.astro'), 'utf8');
  assert.match(header, /scope: 'global', tool, affectedRoutes: \['\*'\]/u);
  assert.match(header, /globalBinding\('phonePrimary', 'link'/u);
  const fixture = await readFile(path.join(root, 'tools/admin-api/admin-browser-roundtrip.mjs'), 'utf8');
  assert.match(fixture, /const collections = COLLECTION_KEYS/u);
});

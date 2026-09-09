import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createPublicSearchIndex } from '../../src/utils/publicSearchIndex.mjs';

// Run on the final build, including after deploy:prepare. It verifies current
// source coverage and actual emitted resources, not just a matcher fixture.
const root = process.cwd();
const distArgument = process.argv.find((argument) => argument.startsWith('--dist='))?.slice('--dist='.length);
const dist = resolve(root, distArgument || 'dist');
const groups = { productSections: 'product-sections', categories: 'product-categories', products: 'products', services: 'services', projects: 'projects' };
const snapshot = Object.fromEntries(await Promise.all(Object.entries(groups).map(async ([key, folder]) => {
  const directory = resolve(root, 'src/content', folder);
  const records = await Promise.all((await readdir(directory)).filter((name) => name.endsWith('.json')).map(async (name) => JSON.parse(await readFile(resolve(directory, name), 'utf8'))));
  return [key, records];
})));
const expected = createPublicSearchIndex(snapshot);
const source = await readFile(resolve(dist, 'search-index.json'), 'utf8');
const actual = JSON.parse(source);
assert.deepEqual(actual, expected, 'Build search index is stale or does not match published records');
assert.equal(new Set(actual.entries.map((entry) => entry.href)).size, actual.entries.length, 'Duplicate search routes');
for (const entry of actual.entries) {
  assert.ok((await stat(resolve(dist, `${entry.href.slice(1)}index.html`))).isFile(), `Missing result route: ${entry.href}`);
}
const home = await readFile(resolve(dist, 'index.html'), 'utf8');
const moduleUrl = home.match(/data-search-module="([^"]+)"/)?.[1];
const indexUrl = home.match(/data-search-index="([^"]+)"/)?.[1];
const base = home.match(/data-search-base="([^"]+)"/)?.[1];
assert.ok(moduleUrl && indexUrl && base, 'Search entry / resource references missing');
assert.equal(indexUrl, `${base}search-index.json`, 'Search index does not respect site base');
const modulePath = moduleUrl.startsWith(base) ? moduleUrl.slice(base.length) : moduleUrl.replace(/^\//, '');
const client = await readFile(resolve(dist, modulePath), 'utf8');
assert.ok(client.includes('initPublicSearch') && client.includes('searchPublicEntries'), 'Lazy search client missing after deploy pruning');
assert.ok(!home.includes(`src="${moduleUrl}"`), 'Search engine should stay lazy');
assert.ok(!home.includes('__VITE_PRELOAD__'), 'Unresolved Vite preload placeholder breaks native lazy imports');
const bootstrapUrl = home.match(/<script[^>]+src="([^"]*public-search-dialog[^\"]+\.mjs)"/)?.[1];
const styleUrl = home.match(/<link[^>]+href="([^"]*public-search[^\"]+\.css)"/)?.[1];
assert.ok(bootstrapUrl && styleUrl, 'Cacheable search dialog script and styles missing');
for (const url of [bootstrapUrl, styleUrl]) {
  assert.ok(url.startsWith(base), 'Search resource does not respect site base');
  assert.ok((await stat(resolve(dist, url.slice(base.length)))).isFile(), `Missing search resource after deploy pruning: ${url}`);
}
console.log(JSON.stringify({ pass: true, entries: actual.entries.length, byKind: actual.entries.reduce((counts, entry) => ({ ...counts, [entry.kind]: (counts[entry.kind] || 0) + 1 }), {}), indexBytes: Buffer.byteLength(source), indexGzipBytes: gzipSync(source).length, lazyModuleGzipBytes: gzipSync(client).length, base, moduleUrl, bootstrapUrl, styleUrl }, null, 2));

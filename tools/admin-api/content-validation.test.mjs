import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTION_KEYS } from './content-registry.mjs';
import {
  ContentValidationError,
  assertSchemaRegistryComplete,
  assertValidContentRecord,
  validateContentRecord,
  validateMutationSet,
  validateSingleton
} from './content-validation.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, '..', '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

const aboutFixture = () => readJson('src/content/static-pages/about.json');

test('all current records in all eight collections pass the shared Astro schema boundary', () => {
  assert.equal(assertSchemaRegistryComplete(), true);
  const covered = new Set();

  for (const collection of COLLECTION_KEYS) {
    const directory = path.join(repoRoot, 'src', 'content', collection);
    for (const filename of fs.readdirSync(directory).filter((entry) => entry.endsWith('.json'))) {
      const value = readJson(path.relative(repoRoot, path.join(directory, filename)));
      const slug = collection === 'site-settings' ? 'global' : value.slug;
      const checked = validateContentRecord({ collection, slug, value, operation: 'read' });
      assert.equal(
        checked.success,
        true,
        `${collection}/${filename}: ${checked.errors.map((issue) => `${issue.code}:${issue.path}`).join(', ')}`
      );
      covered.add(collection);
    }
  }

  assert.deepEqual([...covered].sort(), [...COLLECTION_KEYS].sort());
});

test('schema failures use stable structured issues with safe Russian and technical text', () => {
  const value = aboutFixture();
  delete value.title;
  const checked = validateContentRecord({ collection: 'static-pages', slug: value.slug, value });

  assert.equal(checked.success, false);
  const issue = checked.errors.find((entry) => entry.path === 'title');
  assert.ok(issue);
  assert.equal(issue.code, 'CONTENT_SCHEMA_INVALID');
  assert.equal(issue.collection, 'static-pages');
  assert.equal(issue.slug, 'o-nas');
  assert.match(issue.userMessage, /Проверьте/u);
  assert.match(issue.technicalDetail, /title/u);
  assert.equal('stack' in issue, false);
});

test('schema-permitted nested passthrough survives validation unchanged', () => {
  const value = aboutFixture();
  const cardBlock = value.pageBlocks.find((block) => block.type === 'directionCards');
  cardBlock.rendererLegacyFlag = { approved: true, note: 'keep exactly' };
  cardBlock.items[0].consumerExtension = { cropVersion: 7 };

  const checked = validateContentRecord({ collection: 'static-pages', slug: value.slug, value });
  assert.equal(checked.success, true);
  assert.deepEqual(checked.data.pageBlocks.find((block) => block.type === 'directionCards').rendererLegacyFlag, {
    approved: true,
    note: 'keep exactly'
  });
  assert.deepEqual(
    checked.data.pageBlocks.find((block) => block.type === 'directionCards').items[0].consumerExtension,
    { cropVersion: 7 }
  );
});

test('supported page block types validate their own item shape', () => {
  const cards = aboutFixture();
  cards.pageBlocks.find((block) => block.type === 'directionCards').items.push(42);
  const badCard = validateContentRecord({ collection: 'static-pages', slug: cards.slug, value: cards });
  assert.ok(badCard.errors.some((issue) => issue.code === 'PAGE_BLOCK_ITEM_INVALID'
    && issue.path.includes('directionCards') === false));

  const faq = aboutFixture();
  faq.pageBlocks.push({ type: 'faq', order: 999, items: [{ title: 'Вопрос без ответа' }] });
  const badFaq = validateContentRecord({ collection: 'static-pages', slug: faq.slug, value: faq });
  assert.ok(badFaq.errors.some((issue) => issue.code === 'PAGE_BLOCK_ITEM_INVALID'
    && issue.path === `pageBlocks[${faq.pageBlocks.length - 1}].items[0].text`));
});

test('unknown legacy page blocks are preserved for read/no-op and cannot be created or edited', () => {
  const value = aboutFixture();
  const legacyBlock = {
    type: 'retiredWidget',
    order: 990,
    items: [{ untouched: ['legacy', { nested: true }] }],
    legacyLayout: { width: '73.5%', opaque: true }
  };
  value.pageBlocks.push(legacyBlock);

  const read = validateContentRecord({ collection: 'static-pages', slug: value.slug, value, operation: 'read' });
  assert.equal(read.success, true);
  assert.ok(read.warnings.some((issue) => issue.code === 'PAGE_BLOCK_LEGACY_READ_ONLY'));
  assert.equal(JSON.stringify(read.data.pageBlocks.at(-1)), JSON.stringify(legacyBlock));

  const noOp = validateContentRecord({
    collection: 'static-pages', slug: value.slug, value: clone(value), previous: clone(value), operation: 'update'
  });
  assert.equal(noOp.success, true);

  const changed = clone(value);
  changed.pageBlocks.at(-1).legacyLayout.width = '99%';
  const update = validateContentRecord({
    collection: 'static-pages', slug: changed.slug, value: changed, previous: value, operation: 'update'
  });
  assert.ok(update.errors.some((issue) => issue.code === 'PAGE_BLOCK_LEGACY_MUTATION_FORBIDDEN'));

  const create = validateContentRecord({ collection: 'static-pages', slug: value.slug, value, operation: 'create' });
  assert.ok(create.errors.some((issue) => issue.code === 'PAGE_BLOCK_LEGACY_MUTATION_FORBIDDEN'));
});

test('URL and canonical media policies run inside collection validation', () => {
  const unsafeLink = aboutFixture();
  unsafeLink.pageBlocks.find((block) => block.type === 'directionCards').items[0].buttonHref = 'java%73cript%3Aalert(1)';
  const linkResult = validateContentRecord({ collection: 'static-pages', slug: unsafeLink.slug, value: unsafeLink });
  assert.ok(linkResult.errors.some((issue) => issue.code === 'URL_SCHEME_FORBIDDEN'
    && issue.path.endsWith('.buttonHref')));

  const derivative = aboutFixture();
  derivative.image = '/_media/h5/generated.avif';
  const mediaResult = validateContentRecord({ collection: 'static-pages', slug: derivative.slug, value: derivative });
  assert.ok(mediaResult.errors.some((issue) => issue.code === 'MEDIA_PATH_GENERATED_FORBIDDEN'
    && issue.path === 'image'));
});

test('404 recovery links are schema-owned internal routes and reject traversal', () => {
  const settings = readJson('src/content/site-settings/global.json');
  const accepted = validateContentRecord({ collection: 'site-settings', slug: 'global', value: settings });
  assert.equal(accepted.success, true);

  const unsafe = clone(settings);
  unsafe.notFoundPage.secondaryHref = '/../private';
  const rejected = validateContentRecord({ collection: 'site-settings', slug: 'global', value: unsafe });
  assert.ok(rejected.errors.some((issue) => issue.code === 'URL_PATH_TRAVERSAL'
    && issue.path === 'notFoundPage.secondaryHref'));
});

test('image galleries reject video paths and explicit video fields reject images', () => {
  const product = readJson('src/content/products/besedka-kofe.json');
  product.gallery = ['/uploads/not-an-image.mp4'];
  const productResult = validateContentRecord({ collection: 'products', slug: product.slug, value: product });
  assert.ok(productResult.errors.some((issue) => issue.code === 'MEDIA_ROLE_FORMAT_MISMATCH' && issue.path === 'gallery[0]'));

  const page = aboutFixture();
  page.heroMediaVideo = '/uploads/not-a-video.jpg';
  const pageResult = validateContentRecord({ collection: 'static-pages', slug: page.slug, value: page });
  assert.ok(pageResult.errors.some((issue) => issue.code === 'MEDIA_ROLE_FORMAT_MISMATCH' && issue.path === 'heroMediaVideo'));
});

test('unsafe values in opaque legacy blocks survive read/no-op but block a changed write', () => {
  const previous = aboutFixture();
  previous.pageBlocks.push({
    type: 'retiredWidget',
    order: 990,
    buttonHref: 'javascript:legacy()',
    media: 'data:image/png;base64,legacy'
  });

  const read = validateContentRecord({ collection: 'static-pages', slug: previous.slug, value: previous, operation: 'read' });
  assert.equal(read.success, true);
  assert.ok(read.warnings.some((issue) => issue.code === 'URL_SCHEME_FORBIDDEN'));
  assert.ok(read.warnings.some((issue) => issue.code === 'URL_SCHEME_FORBIDDEN' && issue.path.endsWith('.media')));

  const noOp = validateContentRecord({
    collection: 'static-pages', slug: previous.slug, value: clone(previous), previous: clone(previous), operation: 'update'
  });
  assert.equal(noOp.success, true);

  const changed = clone(previous);
  changed.title = `${changed.title} — уточнение`;
  const write = validateContentRecord({
    collection: 'static-pages', slug: changed.slug, value: changed, previous, operation: 'update'
  });
  assert.ok(write.errors.some((issue) => issue.path.endsWith('.buttonHref')));
  assert.ok(write.errors.some((issue) => issue.path.endsWith('.media')));
});

test('navigation accepts storage/envelope shapes, preserves passthrough and validates href context', () => {
  const navigation = readJson('src/data/navigation.json');
  navigation[0].legacyMenuHint = { keep: true };
  const raw = validateSingleton({ singleton: 'navigation', value: navigation });
  assert.equal(raw.success, true);
  assert.ok(Array.isArray(raw.data));
  assert.deepEqual(raw.storageValue[0].legacyMenuHint, { keep: true });

  const envelope = validateSingleton({ singleton: 'navigation', value: { items: navigation, version: 2 } });
  assert.equal(envelope.success, true);
  assert.equal(envelope.data.version, 2);
  assert.ok(Array.isArray(envelope.storageValue));

  const unsafe = clone(navigation);
  unsafe[0].href = 'mailto:admin@example.com';
  const rejected = validateSingleton({ singleton: 'navigation', value: unsafe });
  assert.ok(rejected.errors.some((issue) => issue.code === 'URL_CONTACT_SCHEME_FORBIDDEN'
    && issue.path === 'items[0].href'));
});

test('yandex singleton validates shape, trusted HTTPS hosts and keeps future passthrough', () => {
  const yandex = readJson('src/data/yandex.json');
  yandex.futureSetting = { enabled: false };
  const checked = validateSingleton({ singleton: 'yandex', value: yandex });
  assert.equal(checked.success, true);
  assert.deepEqual(checked.data.futureSetting, { enabled: false });

  const unsafe = clone(yandex);
  unsafe.metrika.scriptSrc = 'https://evil.example/tag.js';
  const rejected = validateSingleton({ singleton: 'yandex', value: unsafe });
  assert.ok(rejected.errors.some((issue) => issue.code === 'URL_HOST_FORBIDDEN'
    && issue.path === 'metrika.scriptSrc'));
});

test('mutation-set aggregation and throwing API return only structured validation details', () => {
  const badRecord = aboutFixture();
  badRecord.slug = 'Not Safe';
  const navigation = readJson('src/data/navigation.json');
  navigation[0].href = '//evil.example';

  const checked = validateMutationSet({
    records: [{ collection: 'static-pages', slug: 'o-nas', value: badRecord }],
    singletons: { navigation }
  });
  assert.equal(checked.success, false);
  assert.ok(checked.errors.some((issue) => issue.code === 'CONTENT_SLUG_INVALID'));
  assert.ok(checked.errors.some((issue) => issue.code === 'URL_PROTOCOL_RELATIVE_FORBIDDEN'));

  assert.throws(
    () => assertValidContentRecord({ collection: 'static-pages', slug: 'o-nas', value: badRecord }),
    (error) => error instanceof ContentValidationError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && Array.isArray(error.toJSON().validationIssues)
      && !('stack' in error.toJSON())
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { contentSchemas } from '../../src/content-schemas.mjs';
import { createContentStore } from './content-store.mjs';
import {
  COLLECTION_NAMES,
  REPO_ROOT,
  assertFingerprintEqual,
  assertSnapshotEqual,
  createCorpusFixture,
  listCorpusRecords,
  readFileFingerprint,
  snapshotRecordCorpus
} from './test-helpers/corpus-fixture.mjs';

function issueSummary(error) {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

test('the complete production content corpus is schema-valid and the audit is read-only', async (t) => {
  const before = await snapshotRecordCorpus(REPO_ROOT);
  t.after(async () => assertSnapshotEqual(before, await snapshotRecordCorpus(REPO_ROOT), 'live content corpus'));

  const records = await listCorpusRecords(REPO_ROOT);
  assert.deepEqual([...new Set(records.map((record) => record.collection))], COLLECTION_NAMES);

  const counts = new Map(COLLECTION_NAMES.map((collection) => [collection, 0]));
  for (const record of records) {
    const raw = await fs.readFile(record.filePath, 'utf8');
    const content = JSON.parse(raw);
    const parsed = contentSchemas[record.collection].safeParse(content);
    assert.equal(
      parsed.success,
      true,
      `${record.relativePath}: ${parsed.success ? '' : issueSummary(parsed.error)}`
    );
    assert.deepEqual(parsed.data, content, `${record.relativePath}: schema parsing must be lossless`);
    counts.set(record.collection, counts.get(record.collection) + 1);
  }

  for (const [collection, count] of counts) {
    assert.ok(count > 0, `${collection}: corpus must contain at least one record`);
  }
});

test('every corpus record has a byte-, mtime-, hash- and revision-stable no-op save', async (t) => {
  const fixture = await createCorpusFixture(t);
  const store = createContentStore({
    repoRoot: fixture.repoRoot,
    collections: fixture.collections,
    singletons: fixture.singletons,
    clock: () => new Date('2026-08-13T00:00:00.000Z')
  });

  const records = await listCorpusRecords(fixture.repoRoot);
  for (const record of records) {
    const before = await readFileFingerprint(record.filePath, fixture.repoRoot);
    const firstRead = await store.read(record.collection, record.slug);
    const secondRead = await store.read(record.collection, record.slug);

    assert.deepEqual(firstRead.content, JSON.parse(before.raw.toString('utf8')), `${record.relativePath}: read changed content`);
    assert.equal(typeof firstRead.revision, 'string', `${record.relativePath}: missing revision`);
    assert.ok(firstRead.revision.length > 0, `${record.relativePath}: empty revision`);
    assert.equal(firstRead.revision, secondRead.revision, `${record.relativePath}: revision is not deterministic`);
    assert.equal(firstRead.schemaVersion, secondRead.schemaVersion, `${record.relativePath}: schema version is unstable`);

    const result = await store.save({
      collection: record.collection,
      slug: record.slug,
      content: structuredClone(firstRead.content),
      baseRevision: firstRead.revision
    });

    assert.equal(result.result, 'noop', `${record.relativePath}: unchanged content was written`);
    assert.equal(result.revision, firstRead.revision, `${record.relativePath}: no-op changed revision`);
    assert.deepEqual(result.content, firstRead.content, `${record.relativePath}: no-op response changed content`);
    assert.deepEqual(result.changedPaths ?? [], [], `${record.relativePath}: no-op reported changed paths`);
    assertFingerprintEqual(before, await readFileFingerprint(record.filePath, fixture.repoRoot), record.relativePath);
  }
});

test('about.json preserves pageBlocks textWidth, presentation/layout fields and nested passthrough', async (t) => {
  const fixture = await createCorpusFixture(t);
  const aboutPath = fixture.recordPath('static-pages', 'about');
  const sourceAbout = await fixture.readJson('static-pages', 'about');
  const sourceBlock = sourceAbout.pageBlocks.find((block) => block.type === 'whoWeAre');
  assert.equal(sourceAbout.slug, 'o-nas');
  assert.equal(sourceBlock?.textWidth, '760px', 'golden about fixture lost pageBlocks[].textWidth');

  const presentationFixture = {
    ...sourceAbout,
    heroTitleStyle: {
      fontSize: '2xl',
      fontWeight: 'semibold',
      italic: false,
      align: 'left',
      lineHeight: 'compact',
      color: 'white'
    },
    heroDescriptionStyle: {
      fontSize: 'large',
      fontWeight: 'normal',
      align: 'left',
      lineHeight: 'relaxed',
      color: 'secondary'
    },
    heroLayout: {
      width: 'wide',
      widthPercent: 73,
      maxWidth: 980,
      position: 'left',
      padding: 'large',
      verticalPadding: 'compact'
    },
    pageBlocks: sourceAbout.pageBlocks.map((block, index) => index === 0 ? {
      ...block,
      textWidth: '760px',
      textStyle: {
        fontSize: 'large',
        fontWeight: 'medium',
        italic: true,
        align: 'left',
        lineHeight: 'relaxed',
        color: 'primary'
      },
      titleStyle: {
        fontSize: 'xl',
        fontWeight: 'bold',
        align: 'center',
        color: 'accent'
      },
      layout: {
        width: 'medium',
        widthPercent: 68,
        maxWidth: 760,
        position: 'center',
        padding: 'normal',
        verticalPadding: 'large'
      },
      legacyRendererState: {
        crop: { x: 17, y: 29, focalPoints: [{ x: 0.2, y: 0.8 }] },
        labels: ['legacy', 'read-only']
      }
    } : block)
  };
  deepFreeze(presentationFixture);
  const schemaResult = contentSchemas['static-pages'].safeParse(presentationFixture);
  assert.equal(schemaResult.success, true, schemaResult.success ? '' : issueSummary(schemaResult.error));
  assert.deepEqual(schemaResult.data, presentationFixture, 'schema boundary removed permitted nested fields');

  await fixture.writeJson('static-pages', 'about', presentationFixture);
  const before = await readFileFingerprint(aboutPath, fixture.repoRoot);
  const store = createContentStore({
    repoRoot: fixture.repoRoot,
    collections: fixture.collections,
    singletons: fixture.singletons
  });
  const opened = await store.read('static-pages', 'about');
  const noOp = await store.save({
    collection: 'static-pages',
    slug: 'about',
    content: structuredClone(opened.content),
    baseRevision: opened.revision
  });

  assert.equal(noOp.result, 'noop');
  assert.deepEqual(noOp.content, presentationFixture);
  assertFingerprintEqual(before, await readFileFingerprint(aboutPath, fixture.repoRoot), 'about presentation no-op');

  const changed = structuredClone(opened.content);
  changed.heroDescription = `${changed.heroDescription} Проверка одной правки.`;
  const saved = await store.save({
    collection: 'static-pages',
    slug: 'about',
    content: changed,
    baseRevision: opened.revision
  });

  assert.equal(saved.result, 'saved');
  assert.deepEqual(saved.changedPaths, ['heroDescription']);
  assert.notEqual(saved.revision, opened.revision);
  assert.deepEqual(saved.content.pageBlocks, presentationFixture.pageBlocks);
  assert.deepEqual(saved.content.heroTitleStyle, presentationFixture.heroTitleStyle);
  assert.deepEqual(saved.content.heroDescriptionStyle, presentationFixture.heroDescriptionStyle);
  assert.deepEqual(saved.content.heroLayout, presentationFixture.heroLayout);

  const stored = await fixture.readJson('static-pages', 'about');
  assert.equal(stored.pageBlocks[0].textWidth, '760px');
  assert.deepEqual(stored.pageBlocks[0].legacyRendererState, presentationFixture.pageBlocks[0].legacyRendererState);
  assert.deepEqual({ ...stored, heroDescription: presentationFixture.heroDescription }, presentationFixture);
});

test('a stale revision is rejected with 409 semantics and exact current bytes remain untouched', async (t) => {
  const fixture = await createCorpusFixture(t);
  const store = createContentStore({
    repoRoot: fixture.repoRoot,
    collections: fixture.collections,
    singletons: fixture.singletons
  });

  const firstClient = await store.read('static-pages', 'about');
  const staleClient = await store.read('static-pages', 'about');
  assert.equal(firstClient.revision, staleClient.revision);

  const firstContent = structuredClone(firstClient.content);
  firstContent.heroDescription = `${firstContent.heroDescription} Актуальная правка.`;
  const saved = await store.save({
    collection: 'static-pages',
    slug: 'about',
    content: firstContent,
    baseRevision: firstClient.revision
  });
  assert.equal(saved.result, 'saved');

  const beforeConflict = await fixture.fingerprint('static-pages', 'about');
  const staleContent = structuredClone(staleClient.content);
  staleContent.heroDescription = `${staleContent.heroDescription} Устаревшая правка.`;
  await assert.rejects(
    store.save({
      collection: 'static-pages',
      slug: 'about',
      content: staleContent,
      baseRevision: staleClient.revision
    }),
    (error) => {
      assert.equal(error?.code, 'REVISION_CONFLICT');
      assert.equal(error?.status, 409);
      return true;
    }
  );

  assertFingerprintEqual(beforeConflict, await fixture.fingerprint('static-pages', 'about'), 'stale revision rejection');
  const current = await store.read('static-pages', 'about');
  assert.equal(current.revision, saved.revision);
  assert.equal(current.content.heroDescription, firstContent.heroDescription);
});

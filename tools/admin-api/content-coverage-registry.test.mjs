import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { z } from 'astro/zod';
import { contentSchemas } from '../../src/content-schemas.mjs';
import {
  CONTENT_COMPLETENESS_POLICIES,
  CREATABLE_PAGE_BLOCK_TYPES,
  DECLARED_SCHEMA_PATHS,
  EDITOR_FIELD_STATUS,
  FIELD_COVERAGE_STATUS,
  FIELD_RENDERER_COVERAGE,
  KNOWN_PAGE_BLOCK_ITEM_FIELDS,
  KNOWN_PAGE_BLOCK_PASSTHROUGH_FIELDS,
  PAGE_BLOCK_SCHEMA_FIELDS,
  PAGE_BLOCK_SUPPORT_STATUS,
  PAGE_BLOCK_TEMPLATE_POLICIES,
  TEMPLATE_FAMILIES,
  auditContentCoverage,
  getCreatablePageBlockTypes,
  getFieldCoverage,
  getPageBlockTemplatePolicy,
  getRecordTemplateFamilies,
  isPageBlockRenderedForTemplate,
  listCoverageFields,
  resolvePageBlockTemplateFamily
} from '../../src/admin/metadata/content-coverage-registry.mjs';
import {
  COLLECTION_KEYS,
  PAGE_BLOCK_REGISTRY,
  listCreatablePageBlockTypes
} from './content-registry.mjs';
import {
  REPO_ROOT,
  listCorpusRecords
} from './test-helpers/corpus-fixture.mjs';

const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right, 'en'));

function unwrapZod(schema) {
  let current = schema;
  let changed = true;
  while (changed) {
    changed = false;
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap();
      changed = true;
    } else if (current instanceof z.ZodDefault) {
      current = current.removeDefault();
      changed = true;
    } else if (z.ZodEffects && current instanceof z.ZodEffects) {
      current = current.innerType();
      changed = true;
    } else if (z.ZodPipe && current instanceof z.ZodPipe) {
      current = current._def.out;
      changed = true;
    }
  }
  return current;
}

function collectZodNestedPaths(schema, pathPrefix, result) {
  const current = unwrapZod(schema);
  if (current instanceof z.ZodObject) {
    for (const [key, child] of Object.entries(current.shape)) {
      const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      result.add(childPath);
      collectZodNestedPaths(child, childPath, result);
    }
    return;
  }
  if (current instanceof z.ZodArray) {
    const element = unwrapZod(current.element);
    if (element instanceof z.ZodObject) {
      collectZodNestedPaths(element, `${pathPrefix}[]`, result);
      return;
    }
    if (element instanceof z.ZodUnion) {
      for (const option of element.options) {
        const unwrapped = unwrapZod(option);
        if (unwrapped instanceof z.ZodObject) collectZodNestedPaths(unwrapped, `${pathPrefix}[]`, result);
        else result.add(`${pathPrefix}[]`);
      }
      return;
    }
    result.add(`${pathPrefix}[]`);
    return;
  }
  if (current instanceof z.ZodUnion) {
    for (const option of current.options) collectZodNestedPaths(option, pathPrefix, result);
  }
}

function zodSchemaPaths(schema) {
  const result = new Set();
  collectZodNestedPaths(schema, '', result);
  return sorted(result);
}

function singletonSchemaPathsFromSource(sourceText) {
  const sourceFile = ts.createSourceFile(
    'content-validation.mjs',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const declarations = new Map();
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        declarations.set(declaration.name.text, declaration.initializer);
      }
    }
  });

  const resolve = (node, seen = new Set()) => {
    if (ts.isParenthesizedExpression(node)) return resolve(node.expression, seen);
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) throw new Error(`Recursive schema declaration: ${node.text}`);
      const initializer = declarations.get(node.text);
      if (!initializer) return { kind: 'leaf' };
      return resolve(initializer, new Set([...seen, node.text]));
    }
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return { kind: 'leaf' };

    const receiver = node.expression.expression;
    const method = node.expression.name.text;
    if (ts.isIdentifier(receiver) && receiver.text === 'z') {
      if (method === 'object') return { kind: 'object', literal: node.arguments[0] };
      if (method === 'array') return { kind: 'array', element: node.arguments[0] };
      if (method === 'union' && ts.isArrayLiteralExpression(node.arguments[0])) {
        return { kind: 'union', options: [...node.arguments[0].elements] };
      }
      return { kind: 'leaf' };
    }
    // optional(), nullable(), passthrough(), min(), superRefine(), etc. retain
    // the named path shape of the schema expression on their left.
    return resolve(receiver, seen);
  };

  const propertyName = (name) => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    throw new Error(`Unsupported singleton schema property: ${name.getText(sourceFile)}`);
  };

  const collect = (node, pathPrefix, result) => {
    const descriptor = resolve(node);
    if (descriptor.kind === 'object') {
      assert.ok(ts.isObjectLiteralExpression(descriptor.literal), `Expected object literal at ${pathPrefix || '<root>'}`);
      for (const property of descriptor.literal.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = propertyName(property.name);
        const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        result.add(childPath);
        collect(property.initializer, childPath, result);
      }
      return;
    }
    if (descriptor.kind === 'array') {
      const child = resolve(descriptor.element);
      if (child.kind === 'object') collect(descriptor.element, `${pathPrefix}[]`, result);
      else if (child.kind === 'union') {
        for (const option of child.options) {
          if (resolve(option).kind === 'object') collect(option, `${pathPrefix}[]`, result);
          else result.add(`${pathPrefix}[]`);
        }
      } else result.add(`${pathPrefix}[]`);
      return;
    }
    if (descriptor.kind === 'union') {
      for (const option of descriptor.options) collect(option, pathPrefix, result);
    }
  };

  const pathsFor = (declarationName) => {
    const schema = declarations.get(declarationName);
    assert.ok(schema, `${declarationName} must remain declared in content-validation.mjs`);
    const result = new Set();
    collect(schema, '', result);
    return sorted(result);
  };

  return {
    navigation: pathsFor('navigationSchema'),
    yandex: pathsFor('yandexSchema')
  };
}

function schemaPathsByOwner() {
  const result = Object.fromEntries(
    Object.entries(contentSchemas).map(([owner, schema]) => [owner, zodSchemaPaths(schema)])
  );
  const validationSource = fs.readFileSync(path.join(REPO_ROOT, 'tools/admin-api/content-validation.mjs'), 'utf8');
  return { ...result, ...singletonSchemaPathsFromSource(validationSource) };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

function valuePaths(value, pathPrefix = '', result = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object') valuePaths(item, `${pathPrefix}[]`, result);
      else result.add(`${pathPrefix}[]`);
    }
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    result.add(childPath);
    valuePaths(child, childPath, result);
  }
  return result;
}

test('coverage registry matches every declared path in all eight Zod schemas and both singleton schemas', () => {
  const actual = schemaPathsByOwner();
  assert.deepEqual(sorted(Object.keys(actual)), sorted([...COLLECTION_KEYS, 'navigation', 'yandex']));

  for (const [owner, paths] of Object.entries(actual)) {
    assert.deepEqual(
      sorted(listCoverageFields(owner).map((field) => field.schemaPath)),
      paths,
      `${owner}: schema paths and coverage rows diverged`
    );
    assert.deepEqual(sorted(DECLARED_SCHEMA_PATHS[owner]), paths, `${owner}: explicit path snapshot drifted`);
  }

  assert.deepEqual(auditContentCoverage({ schemaPathsByOwner: actual }), []);
});

test('coverage audit fails closed for a future schema field and an uncovered creatable field', () => {
  const actual = schemaPathsByOwner();
  const withFutureField = {
    ...actual,
    products: [...actual.products, 'futureRequiredField']
  };
  const schemaIssues = auditContentCoverage({ schemaPathsByOwner: withFutureField });
  assert.ok(schemaIssues.some((issue) => issue.code === 'SCHEMA_FIELD_UNCLASSIFIED'
    && issue.owner === 'products'
    && issue.schemaPath === 'futureRequiredField'));

  const blockIssues = auditContentCoverage({
    schemaPathsByOwner: actual,
    creatableFieldsByType: { cardGrid: ['items[].futureCropMode'] }
  });
  assert.ok(blockIssues.some((issue) => issue.code === 'CREATABLE_FIELD_UNCOVERED'
    && issue.type === 'cardGrid'
    && issue.field === 'items[].futureCropMode'));
});

test('required-for-save flags follow the public Zod optional contract while public completeness stays separate', () => {
  for (const [owner, schema] of Object.entries(contentSchemas)) {
    const requiredTopLevel = sorted(Object.entries(schema.shape)
      .filter(([, fieldSchema]) => !fieldSchema.isOptional())
      .map(([pathName]) => pathName));
    const classifiedRequired = sorted(listCoverageFields(owner)
      .filter((field) => field.requiredForSave)
      .map((field) => field.schemaPath));
    assert.deepEqual(classifiedRequired, requiredTopLevel, `${owner}: save requirements drifted from Zod`);

    const policy = CONTENT_COMPLETENESS_POLICIES[owner];
    assert.deepEqual(sorted(policy.blocksSave.requiredFields), requiredTopLevel);
    assert.ok(policy.blocksPublic);
    for (const publicPath of policy.blocksPublic.requiredFields) {
      assert.ok(getFieldCoverage(owner, publicPath), `${owner}.${publicPath}: missing public coverage row`);
    }
  }

  assert.equal(getFieldCoverage('products', 'priceFrom').requiredForSave, true);
  assert.equal(getFieldCoverage('products', 'priceFrom').requiredForPublic, false);
  assert.equal(getFieldCoverage('products', 'seoTitle').requiredForPublic, false);
  assert.equal(getFieldCoverage('projects', 'gallery').requiredForPublic, false);
  assert.ok(CONTENT_COMPLETENESS_POLICIES.projects.blocksPublic.rules.some((rule) => rule.kind === 'at-least-one-media'));
});

test('each field row carries editor, renderer, relation/media and fixture metadata without false WYSIWYG claims', () => {
  assert.equal(Object.keys(FIELD_RENDERER_COVERAGE.collections).length, 8);
  assert.deepEqual(sorted(Object.keys(FIELD_RENDERER_COVERAGE.singletons)), ['navigation', 'yandex']);

  const validCoverageStatuses = new Set(Object.values(FIELD_COVERAGE_STATUS));
  const validEditorStatuses = new Set(Object.values(EDITOR_FIELD_STATUS));
  for (const owner of Object.keys(DECLARED_SCHEMA_PATHS)) {
    for (const field of listCoverageFields(owner)) {
      assert.ok(field.label && !field.label.includes(field.schemaPath), `${owner}.${field.schemaPath}: friendly label missing`);
      assert.ok(field.editorControl);
      assert.ok(validCoverageStatuses.has(field.coverageStatus));
      assert.ok(validEditorStatuses.has(field.editorStatus));
      assert.equal(field.validation.source, 'zod-schema');
      assert.equal(typeof field.requiredForSave, 'boolean');
      assert.equal(typeof field.requiredForPublic, 'boolean');
      assert.ok(field.testFixture);
      if (field.coverageStatus === FIELD_COVERAGE_STATUS.RENDERER_BACKED) assert.ok(field.consumers.length > 0);
      if (field.coverageStatus === FIELD_COVERAGE_STATUS.LEGACY_ONLY) {
        assert.equal(field.consumers.length, 0);
        assert.equal(field.editorStatus, EDITOR_FIELD_STATUS.LEGACY_NOT_RENDERED);
        assert.match(field.hiddenReason, /production V2/u);
      }
    }
  }

  assert.equal(getFieldCoverage('product-categories', 'parentSectionSlug').relationRole.target, 'product-sections');
  assert.equal(getFieldCoverage('products', 'relatedProductSlugs[]').relationRole.target, 'products');
  assert.equal(getFieldCoverage('projects', 'gallery[]').mediaRole.role, 'project-gallery');
  assert.equal(getFieldCoverage('navigation', 'items[].href').relationRole.kind, 'internal-route');
  assert.equal(getFieldCoverage('product-sections', 'gallery').coverageStatus, FIELD_COVERAGE_STATUS.LEGACY_ONLY);
  assert.equal(getFieldCoverage('static-pages', 'pageBlocks[].textWidth').coverageStatus, FIELD_COVERAGE_STATUS.LEGACY_ONLY);
  assert.equal(getFieldCoverage('product-sections', 'heroTitle').presentationPolicy, 'approved-until-edited');
  assert.equal(getFieldCoverage('products', 'presentationType').editorStatus, EDITOR_FIELD_STATUS.FRIENDLY);
});

test('page-block creation is template-scoped and every creatable field has explicit coverage', () => {
  assert.deepEqual(sorted(Object.keys(PAGE_BLOCK_TEMPLATE_POLICIES)), sorted(Object.keys(PAGE_BLOCK_REGISTRY)));
  for (const { type } of listCreatablePageBlockTypes()) {
    assert.ok(getPageBlockTemplatePolicy(type), `${type}: legacy registry creatable type has no renderer-truth policy`);
  }

  assert.deepEqual(sorted(getCreatablePageBlockTypes()), sorted(CREATABLE_PAGE_BLOCK_TYPES));
  assert.ok(CREATABLE_PAGE_BLOCK_TYPES.includes('cardGrid'));
  assert.ok(CREATABLE_PAGE_BLOCK_TYPES.includes('mediaText'));
  assert.ok(!CREATABLE_PAGE_BLOCK_TYPES.includes('gallery'));
  assert.ok(!CREATABLE_PAGE_BLOCK_TYPES.includes('faq'));
  assert.ok(!CREATABLE_PAGE_BLOCK_TYPES.includes('notice'));

  for (const type of CREATABLE_PAGE_BLOCK_TYPES) {
    const policy = getPageBlockTemplatePolicy(type);
    assert.equal(policy.primaryCreatable, true);
    assert.ok(policy.creatableIn.length > 0);
    for (const templateFamily of policy.creatableIn) {
      const support = policy.supportByTemplate[templateFamily];
      assert.notEqual(support.status, PAGE_BLOCK_SUPPORT_STATUS.NOT_RENDERED, `${type}/${templateFamily}: false renderer claim`);
      assert.ok(support.consumers.length > 0);
      for (const consumer of support.consumers) assert.ok(fs.existsSync(path.join(REPO_ROOT, consumer)), consumer);
      for (const field of policy.creatableFieldsByTemplate[templateFamily]) {
        assert.ok(Object.hasOwn(policy.fieldCoverage, field), `${type}/${templateFamily}/${field}: uncovered creatable field`);
      }
    }
  }

  const legacyGallery = getPageBlockTemplatePolicy('gallery');
  assert.equal(legacyGallery.primaryCreatable, false);
  assert.equal(legacyGallery.genericLegacyRenderer.mountedOnProductionRoute, false);
  assert.equal(legacyGallery.fieldCoverage.media?.status ?? FIELD_COVERAGE_STATUS.LEGACY_ONLY, FIELD_COVERAGE_STATUS.LEGACY_ONLY);
  assert.ok(PAGE_BLOCK_SCHEMA_FIELDS.includes('textWidth'));
  assert.ok(KNOWN_PAGE_BLOCK_PASSTHROUGH_FIELDS.includes('secondaryButtonLabel'));
  assert.ok(KNOWN_PAGE_BLOCK_ITEM_FIELDS.includes('items[].imageView.positionX'));
});

test('page-block policies match the selectors in actual production adapters', () => {
  const catalogSection = fs.readFileSync(path.join(REPO_ROOT, 'src/components/v2/CatalogSectionV2.astro'), 'utf8');
  const metalworks = fs.readFileSync(path.join(REPO_ROOT, 'src/components/v2/pages/MetalworksV2Page.astro'), 'utf8');
  const company = fs.readFileSync(path.join(REPO_ROOT, 'src/components/v2/practical/V2CompanyPage.astro'), 'utf8');
  const customOrder = fs.readFileSync(path.join(REPO_ROOT, 'src/components/v2/custom-order/customOrderV2Data.ts'), 'utf8');

  assert.match(catalogSection, /block\.type === 'mediaText'/u);
  assert.match(metalworks, /getDirectionBlock\(section, 'cardGrid'\)/u);
  assert.match(metalworks, /getDirectionBlock\(section, 'listPanel'\)/u);
  assert.match(metalworks, /getDirectionBlock\(section, 'process'\)/u);
  for (const type of ['whoWeAre', 'directionCards', 'companyProof', 'companyDirections', 'companyDetails', 'cta']) {
    assert.match(company, new RegExp(`block\\.type === '${type}'`, 'u'));
  }
  assert.match(customOrder, /sourcePage\.customOrderSourceMaterials/u);
  assert.match(customOrder, /sourcePage\.customOrderChangeThemes/u);
  const customOrderSupport = getPageBlockTemplatePolicy('listPanel').supportByTemplate['custom-order'];
  assert.equal(customOrderSupport.status, PAGE_BLOCK_SUPPORT_STATUS.NOT_RENDERED);
  assert.match(customOrderSupport.reason, /структурирован/u);
});

test('live page-block corpus has an explicit honest support decision for its actual template family', async () => {
  const expectedRenderedIndexes = {
    'product-sections:metallokonstruktsii-dlya-biznesa': new Set([0, 1, 2]),
    'product-sections:navesy-i-kozyrki': new Set([0, 1]),
    'product-sections:ograzhdeniya-i-zabory': new Set([2]),
    'product-sections:topiarii': new Set([0, 1]),
    'product-sections:ulichnaya-mebel': new Set(),
    'services:blagoustroystvo-territoriy': new Set([0, 1, 2]),
    'services:stroitelstvo-i-remonty': new Set([0, 1, 2]),
    'static-pages:o-nas': new Set([0, 1, 2, 3, 4, 6]),
    'static-pages:custom-order': new Set(),
    'static-pages:home': new Set([0]),
    'static-pages:vypolnennye-obekty': new Set()
  };

  const records = (await listCorpusRecords()).filter((record) => (
    ['product-sections', 'services', 'static-pages'].includes(record.collection)
  ));
  for (const record of records) {
    const content = JSON.parse(fs.readFileSync(record.filePath, 'utf8'));
    const templateFamily = resolvePageBlockTemplateFamily(record.collection, content);
    assert.ok(templateFamily, `${record.collection}/${record.slug}: page-block template missing`);
    const expected = expectedRenderedIndexes[`${record.collection}:${content.slug}`];
    assert.ok(expected, `${record.collection}/${content.slug}: expected adapter fixture missing`);

    for (const [blockIndex, block] of (content.pageBlocks ?? []).entries()) {
      const policy = getPageBlockTemplatePolicy(block.type);
      assert.ok(policy, `${record.collection}/${content.slug}/${block.type}: unknown block`);
      const support = policy.supportByTemplate[templateFamily];
      assert.ok(support, `${block.type}/${templateFamily}: support decision missing`);
      assert.equal(
        isPageBlockRenderedForTemplate({
          type: block.type,
          templateFamily,
          record: content,
          block,
          pageBlocks: content.pageBlocks
        }),
        expected.has(blockIndex),
        `${record.collection}/${content.slug}/${block.type}: policy disagrees with production adapter`
      );

      for (const key of Object.keys(block)) {
        assert.ok(
          PAGE_BLOCK_SCHEMA_FIELDS.includes(key) || KNOWN_PAGE_BLOCK_PASSTHROUGH_FIELDS.includes(key),
          `${record.collection}/${content.slug}/${block.type}.${key}: known live block passthrough lacks coverage`
        );
      }
    }
  }
});

test('live corpus and singleton fixtures use covered schema paths while unknown item passthrough remains read-only', async () => {
  const records = await listCorpusRecords();
  assert.ok(records.length >= 100);
  const coveredCollections = new Set();

  for (const record of records) {
    const content = JSON.parse(fs.readFileSync(record.filePath, 'utf8'));
    const parsed = contentSchemas[record.collection].safeParse(content);
    assert.equal(parsed.success, true, `${record.relativePath}: live schema failure`);
    for (const key of Object.keys(content)) {
      assert.ok(getFieldCoverage(record.collection, key), `${record.relativePath}:${key}: live top-level field uncovered`);
    }
    assert.ok(getRecordTemplateFamilies(record.collection, content).length > 0);
    coveredCollections.add(record.collection);
  }
  assert.deepEqual(sorted(coveredCollections), sorted(COLLECTION_KEYS));

  const navigation = readJson('src/data/navigation.json');
  const yandex = readJson('src/data/yandex.json');
  for (const [owner, value] of [['navigation', { items: navigation }], ['yandex', yandex]]) {
    for (const schemaPath of valuePaths(value)) {
      assert.ok(getFieldCoverage(owner, schemaPath), `${owner}.${schemaPath}: live singleton field uncovered`);
    }
  }

  const fence = readJson('src/content/product-sections/ograzhdeniya-i-zabory.json');
  const card = fence.pageBlocks.find((block) => block.type === 'directionCards').items[0];
  assert.ok(Object.hasOwn(card, 'categorySlug'));
  assert.ok(!KNOWN_PAGE_BLOCK_ITEM_FIELDS.includes('items[].categorySlug'));
  assert.equal(getPageBlockTemplatePolicy('directionCards').unknownPassthroughPolicy, 'preserve-losslessly-read-only');
});

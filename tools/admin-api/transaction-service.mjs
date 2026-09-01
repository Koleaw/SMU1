import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  createTransactionEngine,
  revisionForBytes
} from './transaction-engine.mjs';
import {
  COLLECTION_KEYS,
  SINGLETON_KEYS,
  getCollectionDefinition,
  getSingletonDefinition
} from './content-registry.mjs';
import {
  createValidationIssue,
  validateContentRecord,
  validateSingleton
} from './content-validation.mjs';
import { validateProjectedPublicCompleteness } from './content-completeness.mjs';
import { buildRelationGraph, previewRelationImpact } from './relation-graph.mjs';
import { diffContentPaths, serializeContent } from './content-store.mjs';

const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,240}$/u;
const RECORD_OPERATION_TYPES = new Set([
  'upsert-record',
  'rename-record',
  'archive-record',
  'delete-record'
]);
const SERVICE_METADATA_VERSION = 2;
const STAGED_MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function isInsideOrEqual(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function asRelative(repoRoot, absolutePath, label) {
  const resolved = path.resolve(absolutePath);
  if (!isInsideOrEqual(repoRoot, resolved) || resolved === path.resolve(repoRoot)) {
    throw new ContentTransactionError(
      'CONTENT_TRANSACTION_CONFIG_INVALID',
      `Путь ${label} должен находиться внутри корня репозитория.`,
      { status: 500, details: { label } }
    );
  }
  return path.relative(repoRoot, resolved).split(path.sep).join('/');
}

function safeSlug(value, field = 'slug') {
  if (typeof value !== 'string' || value !== value.trim().toLowerCase() || !SAFE_SLUG_RE.test(value)) {
    throw new ContentTransactionError(
      'CONTENT_SLUG_INVALID',
      `Поле ${field} содержит некорректный slug.`,
      { status: 400, details: { field, value: String(value ?? '') } }
    );
  }
  return value;
}

function requiredRevision(value) {
  if (typeof value !== 'string' || !/^(?:missing|sha256:[a-f0-9]{64}:\d+)$/u.test(value)) {
    throw new ContentTransactionError(
      'BASE_REVISION_REQUIRED',
      'Для изменения обязательна точная baseRevision.',
      { status: 409 }
    );
  }
  return value;
}

function requiredId(value, field) {
  if (typeof value !== 'string' || value !== value.trim() || !SAFE_ID_RE.test(value)) {
    throw new ContentTransactionError(
      'CONTENT_TRANSACTION_CONTEXT_INVALID',
      `Поле ${field} отсутствует или имеет неверный формат.`,
      { status: 400, details: { field } }
    );
  }
  return value;
}

function readError(error, code, message, details) {
  return new ContentTransactionError(code, message, { status: 500, details, cause: error });
}

function pathTokens(value) {
  const tokens = [];
  const pattern = /([^.\[\]]+)|\[(\d+)\]/gu;
  let match;
  while ((match = pattern.exec(String(value || '')))) {
    tokens.push(match[1] ?? Number(match[2]));
  }
  return tokens;
}

function setAtPath(root, jsonPath, nextValue) {
  const tokens = pathTokens(jsonPath);
  if (!tokens.length) return nextValue;
  let cursor = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (cursor == null || typeof cursor !== 'object' || !(token in cursor)) {
      throw new ContentTransactionError(
        'RELATION_UPDATE_INVALID',
        'План связанных изменений больше не соответствует данным.',
        { status: 409, details: { path: jsonPath } }
      );
    }
    cursor = cursor[token];
  }
  cursor[tokens.at(-1)] = clone(nextValue);
  return root;
}

function deleteAtPath(root, jsonPath) {
  const tokens = pathTokens(jsonPath);
  if (!tokens.length) return root;
  let cursor = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    cursor = cursor?.[tokens[index]];
    if (cursor == null) return root;
  }
  const key = tokens.at(-1);
  if (Array.isArray(cursor) && typeof key === 'number') cursor.splice(key, 1);
  else if (cursor && typeof cursor === 'object') delete cursor[key];
  return root;
}

function normalizeConfig(repoRoot, collections, singletons) {
  const normalizedCollections = {};
  for (const key of COLLECTION_KEYS) {
    const definition = getCollectionDefinition(key);
    const configured = collections?.[key];
    if (!configured?.path) {
      throw new ContentTransactionError(
        'CONTENT_TRANSACTION_CONFIG_INVALID',
        `Не настроено хранилище коллекции ${key}.`,
        { status: 500 }
      );
    }
    const absolutePath = path.isAbsolute(configured.path)
      ? path.resolve(configured.path)
      : path.resolve(repoRoot, configured.path);
    normalizedCollections[key] = Object.freeze({
      key,
      type: configured.type || (definition.storage === 'single-file' ? 'single-file' : 'directory'),
      slug: configured.slug || definition.fixedSlug,
      absolutePath,
      relativePath: asRelative(repoRoot, absolutePath, key)
    });
  }
  const normalizedSingletons = {};
  for (const key of SINGLETON_KEYS) {
    const definition = getSingletonDefinition(key);
    const configured = singletons?.[key];
    if (!configured?.path) {
      throw new ContentTransactionError(
        'CONTENT_TRANSACTION_CONFIG_INVALID',
        `Не настроено хранилище singleton ${key}.`,
        { status: 500 }
      );
    }
    const absolutePath = path.isAbsolute(configured.path)
      ? path.resolve(configured.path)
      : path.resolve(repoRoot, configured.path);
    normalizedSingletons[key] = Object.freeze({
      key,
      slug: definition.fixedSlug,
      absolutePath,
      relativePath: asRelative(repoRoot, absolutePath, key)
    });
  }
  return Object.freeze({ collections: normalizedCollections, singletons: normalizedSingletons });
}

async function readOptionalBytes(filePath, fileSystem) {
  try {
    return await fileSystem.readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function parseJson(bytes, relativePath) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw readError(error, 'CONTENT_JSON_INVALID_ON_DISK', 'JSON-файл контента повреждён.', { path: relativePath });
  }
}

function recordKey(collection, slug) {
  return `${collection}:${slug}`;
}

function publicRecord(entry) {
  return {
    collection: entry.collection,
    slug: entry.slug,
    content: entry.content,
    revision: entry.revision,
    lastModified: entry.lastModified ?? null,
    fileName: path.posix.basename(entry.relativePath)
  };
}

function routeSet(graph) {
  return new Set(graph.routes.filter((item) => item.owner?.kind === 'record').map((item) => item.path));
}

function graphRecord(graph, collection, slug) {
  return graph?.records?.find((record) => record.collection === collection && record.slug === slug) ?? null;
}

function routeAvailable(graph, record) {
  if (!record?.route || record.content?.isActive === false) return false;
  if (record.collection === 'product-categories') {
    const section = graphRecord(graph, 'product-sections', record.content?.parentSectionSlug);
    return Boolean(section) && section.content?.isActive !== false;
  }
  if (record.collection === 'products') {
    const category = graphRecord(graph, 'product-categories', record.content?.productCategorySlug);
    if (!category || category.content?.isActive === false) return false;
    const section = graphRecord(graph, 'product-sections', category.content?.parentSectionSlug);
    return Boolean(section) && section.content?.isActive !== false;
  }
  return true;
}

function deriveRouteExpectations(validation, plan) {
  const expectations = new Map();
  const add = (route, expected, source) => {
    if (typeof route !== 'string' || !route.startsWith('/')) {
      throw new ContentTransactionError(
        'CONTENT_ROUTE_EXPECTATION_UNRESOLVED',
        'Не удалось вывести безопасное smoke-ожидание для изменённого маршрута.',
        { status: 409, details: { route: String(route ?? ''), source } }
      );
    }
    const previous = expectations.get(route);
    if (previous && previous !== expected) {
      throw new ContentTransactionError(
        'CONTENT_ROUTE_EXPECTATION_CONFLICT',
        'Для одного маршрута выведены противоречивые smoke-ожидания.',
        { status: 409, details: { route, previous, expected, source } }
      );
    }
    expectations.set(route, expected);
  };

  for (const impact of validation.affectedRoutes) {
    if (!impact || typeof impact !== 'object' || Array.isArray(impact)) {
      throw new ContentTransactionError(
        'CONTENT_ROUTE_EXPECTATION_UNRESOLVED',
        'Изменённый маршрут не содержит типизированного relation impact.',
        { status: 409 }
      );
    }
    const from = impact.from ?? impact.oldRoute ?? null;
    const to = impact.to ?? impact.newRoute ?? null;
    if (from && to && from === to) {
      const record = validation.afterGraph.records.find((item) => item.route === to);
      add(to, routeAvailable(validation.afterGraph, record) ? 'html' : 'not-found', 'relation-impact-same-route');
      continue;
    }
    if (from) add(from, 'not-found', 'relation-impact-from');
    if (to) {
      const record = validation.afterGraph.records.find((item) => item.route === to);
      if (!record) {
        throw new ContentTransactionError(
          'CONTENT_ROUTE_EXPECTATION_UNRESOLVED',
          'Новый маршрут отсутствует в projected relation graph.',
          { status: 409, details: { route: to } }
        );
      }
      add(to, routeAvailable(validation.afterGraph, record) ? 'html' : 'not-found', 'relation-impact-to');
    }
  }

  for (const diff of plan.diffs) {
    const entity = diff?.entity;
    if (!entity?.collection || !entity?.slug) continue;
    const before = graphRecord(validation.beforeGraph, entity.collection, entity.slug);
    const after = graphRecord(validation.afterGraph, entity.collection, entity.slug);
    const beforeRoute = before?.route ?? null;
    const afterRoute = after?.route ?? null;
    const afterAvailable = routeAvailable(validation.afterGraph, after);
    if (beforeRoute && (!afterAvailable || beforeRoute !== afterRoute)) {
      add(beforeRoute, 'not-found', 'record-before');
    }
    if (afterRoute) add(afterRoute, afterAvailable ? 'html' : 'not-found', 'record-after');
  }

  if (expectations.size === 0 && plan.mutations.length > 0) {
    add('/', 'html', 'non-route-content-fallback');
  }
  return [...expectations].sort(([left], [right]) => left.localeCompare(right))
    .map(([route, expected]) => ({ route, expected }));
}

function deriveRouteTransitions(validation) {
  const beforeByKey = new Map(validation.beforeGraph.records.map((record) => [recordKey(record.collection, record.slug), record]));
  const afterByKey = new Map(validation.afterGraph.records.map((record) => [recordKey(record.collection, record.slug), record]));
  const state = (graph, record) => record ? {
    collection: record.collection,
    slug: record.slug,
    route: record.route || null,
    expected: routeAvailable(graph, record) ? 'html' : 'not-found'
  } : null;
  const transitions = [];
  for (const key of [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort()) {
    const before = state(validation.beforeGraph, beforeByKey.get(key));
    const after = state(validation.afterGraph, afterByKey.get(key));
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    transitions.push({ before, after });
  }
  return transitions;
}

function compareIssue(issue) {
  return JSON.stringify(stableValue(issue));
}

function relationIssueToValidation(issue) {
  return createValidationIssue({
    code: issue.code || 'RELATION_GRAPH_INVALID',
    collection: issue.source?.collection || issue.collection || '',
    slug: issue.source?.slug || issue.slug || '',
    path: issue.path || '',
    severity: issue.severity === 'warning' ? 'warning' : 'error',
    userMessage: issue.message || 'Проверьте связанные записи.',
    technicalDetail: JSON.stringify(issue)
  });
}

function mediaRelativePath(value) {
  const normalized = String(value || '').split(/[?#]/u, 1)[0];
  if (!/^\/(?:assets|uploads)\//u.test(normalized)) return null;
  return `public${normalized}`;
}

function validateWhitelistedMutationPath(registry, relativePath, { allowMedia = false, stagingPaths = null } = {}) {
  for (const singleton of Object.values(registry.singletons)) {
    if (singleton.relativePath === relativePath) return { kind: 'singleton', singleton: singleton.key };
  }
  for (const collection of Object.values(registry.collections)) {
    if (collection.type === 'single-file') {
      if (collection.relativePath === relativePath) return { kind: 'record', collection: collection.key };
      continue;
    }
    const prefix = `${collection.relativePath}/`;
    if (!relativePath.startsWith(prefix)) continue;
    const suffix = relativePath.slice(prefix.length);
    if (!suffix.includes('/') && /^[a-z0-9][a-z0-9-]*\.json$/u.test(suffix)) {
      return { kind: 'record', collection: collection.key };
    }
  }
  if (allowMedia && /^public\/uploads\/[a-f0-9]{64}\.[a-z0-9]{2,8}$/u.test(relativePath)) {
    return { kind: 'media' };
  }
  if (stagingPaths?.has(relativePath)) return { kind: 'staging' };
  throw new ContentTransactionError(
    'CONTENT_TRANSACTION_PATH_NOT_ALLOWED',
    'Транзакция содержит путь вне разрешённого content-хранилища.',
    { status: 409, details: { path: relativePath } }
  );
}

export class ContentTransactionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ContentTransactionError';
    this.code = code;
    this.status = options.status ?? 409;
    this.details = options.details ?? {};
    this.validationIssues = options.validationIssues ?? [];
    this.blockers = options.blockers ?? [];
    this.warnings = options.warnings ?? [];
  }

  toJSON() {
    return {
      code: this.code,
      error: this.message,
      details: this.details,
      validationIssues: this.validationIssues,
      blockers: this.blockers,
      warnings: this.warnings
    };
  }
}

export function createContentTransactionService({
  repoRoot = process.cwd(),
  runtimeDir,
  collections,
  singletons,
  stagingAdapter = null,
  fileSystem = fs,
  engine: suppliedEngine,
  engineOptions = {}
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const registry = normalizeConfig(resolvedRepoRoot, collections, singletons);
  const engine = suppliedEngine || createTransactionEngine({
    repoRoot: resolvedRepoRoot,
    runtimeDir: runtimeDir || path.join(resolvedRepoRoot, '.admin-runtime', 'content-transactions'),
    fileSystem,
    ...engineOptions
  });

  function principal(request) {
    const owner = requiredId(request.owner, 'owner');
    const sessionFingerprint = requiredId(request.sessionFingerprint, 'sessionFingerprint');
    return {
      owner,
      sessionFingerprint,
      // Saved history belongs to the authenticated local owner, not to one
      // ephemeral cookie. Session fingerprints still authorize each HTTP
      // request at the server boundary; keeping them out of persistent
      // ownership makes restart, re-login and owner handoff recoverable.
      engineOwner: `content-owner:${digest({ owner })}`
    };
  }

  function actor(request) {
    return {
      ...principal(request),
      recoveryClientId: requiredId(request.recoveryClientId, 'recoveryClientId'),
      idempotencyKey: requiredId(request.idempotencyKey, 'idempotencyKey')
    };
  }

  function absolute(relativePath) {
    return path.resolve(resolvedRepoRoot, ...relativePath.split('/'));
  }

  async function loadCorpus(overrides = new Map(), stagingPaths = new Set()) {
    const entries = new Map();
    const files = new Map();
    const discovered = new Set();

    for (const config of Object.values(registry.collections)) {
      if (config.type === 'single-file') {
        discovered.add(config.relativePath);
      } else {
        let names = [];
        try {
          names = await fileSystem.readdir(config.absolutePath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw readError(error, 'CONTENT_READ_FAILED', 'Не удалось прочитать коллекцию.', { collection: config.key });
        }
        names.filter((name) => name.endsWith('.json')).forEach((name) => {
          if (/^[a-z0-9][a-z0-9-]*\.json$/u.test(name)) discovered.add(`${config.relativePath}/${name}`);
        });
      }
    }
    for (const config of Object.values(registry.singletons)) discovered.add(config.relativePath);
    for (const relativePath of overrides.keys()) {
      validateWhitelistedMutationPath(registry, relativePath, { allowMedia: true, stagingPaths });
      if (relativePath.endsWith('.json')) discovered.add(relativePath);
    }

    const singletonValues = {};
    for (const relativePath of [...discovered].sort()) {
      const bytes = overrides.has(relativePath)
        ? overrides.get(relativePath)
        : await readOptionalBytes(absolute(relativePath), fileSystem);
      if (bytes === null) {
        files.set(relativePath, { bytes: null, revision: 'missing' });
        continue;
      }
      const classification = validateWhitelistedMutationPath(registry, relativePath, { allowMedia: true, stagingPaths });
      if (classification.kind === 'media' || classification.kind === 'staging') continue;
      const content = parseJson(bytes, relativePath);
      files.set(relativePath, { bytes, revision: revisionForBytes(bytes), content });
      if (classification.kind === 'singleton') {
        singletonValues[classification.singleton] = {
          singleton: classification.singleton,
          content,
          bytes,
          revision: revisionForBytes(bytes),
          relativePath
        };
        continue;
      }
      const collection = classification.collection;
      const config = registry.collections[collection];
      const definition = getCollectionDefinition(collection);
      const fileSlug = config.type === 'single-file'
        ? config.slug
        : path.posix.basename(relativePath, '.json');
      const slug = definition.hasSlug ? content?.slug : config.slug;
      if (definition.hasSlug) safeSlug(slug, `${collection}.slug`);
      const key = recordKey(collection, slug);
      if (entries.has(key)) {
        throw new ContentTransactionError(
          'CONTENT_DUPLICATE_LOGICAL_SLUG',
          `В коллекции ${collection} найдено несколько файлов для slug ${slug}.`,
          { status: 409, details: { collection, slug, files: [entries.get(key).relativePath, relativePath] } }
        );
      }
      entries.set(key, {
        collection,
        slug,
        fileSlug,
        content,
        bytes,
        revision: revisionForBytes(bytes),
        relativePath
      });
    }

    const collectionValues = Object.fromEntries(COLLECTION_KEYS.map((key) => [key, []]));
    for (const entry of entries.values()) collectionValues[entry.collection].push(entry.content);
    return { entries, files, singletons: singletonValues, collectionValues };
  }

  function graphFor(corpus) {
    return buildRelationGraph({
      collections: corpus.collectionValues,
      navigation: corpus.singletons.navigation?.content ?? []
    });
  }

  function cloneProjected(corpus) {
    const entries = new Map([...corpus.entries].map(([key, value]) => [key, {
      ...value,
      content: clone(value.content),
      originalContent: clone(value.content)
    }]));
    const singletonsMap = Object.fromEntries(Object.entries(corpus.singletons).map(([key, value]) => [key, { ...value, content: clone(value.content) }]));
    return { entries, singletons: singletonsMap };
  }

  function projectedCorpus(projected) {
    const collectionValues = Object.fromEntries(COLLECTION_KEYS.map((key) => [key, []]));
    for (const entry of projected.entries.values()) collectionValues[entry.collection].push(entry.content);
    return { ...projected, collectionValues };
  }

  function findProjected(projected, collection, slug) {
    return projected.entries.get(recordKey(collection, slug));
  }

  function markRelationUpdates(projected, updates) {
    for (const update of updates || []) {
      if (update.target?.kind === 'record') {
        const entry = findProjected(projected, update.target.collection, update.target.slug);
        if (!entry) throw new ContentTransactionError('RELATION_UPDATE_TARGET_MISSING', 'Связанная запись больше не найдена.', { status: 409 });
        setAtPath(entry.content, update.path, update.to);
      } else if (update.target?.kind === 'singleton' && update.target.name === 'navigation') {
        const singleton = projected.singletons.navigation;
        if (!singleton) throw new ContentTransactionError('RELATION_UPDATE_TARGET_MISSING', 'Файл навигации не найден.', { status: 409 });
        setAtPath(singleton.content, update.path, update.to);
      }
    }
  }

  function descendantKeys(projected, target) {
    const result = new Set([recordKey(target.collection, target.slug)]);
    if (target.collection === 'product-sections') {
      const categorySlugs = new Set();
      for (const entry of projected.entries.values()) {
        if (entry.collection === 'product-categories' && entry.content.parentSectionSlug === target.slug) {
          result.add(recordKey(entry.collection, entry.slug));
          categorySlugs.add(entry.slug);
        }
      }
      for (const entry of projected.entries.values()) {
        if (entry.collection === 'products' && categorySlugs.has(entry.content.productCategorySlug)) result.add(recordKey(entry.collection, entry.slug));
      }
    } else if (target.collection === 'product-categories') {
      for (const entry of projected.entries.values()) {
        if (entry.collection === 'products' && entry.content.productCategorySlug === target.slug) result.add(recordKey(entry.collection, entry.slug));
      }
    }
    return result;
  }

  function applyCascadeDelete(projected, target, deleteKeys) {
    const deletedSlugs = new Set([...deleteKeys]
      .map((key) => projected.entries.get(key))
      .filter((entry) => entry?.collection === 'products')
      .map((entry) => entry.slug));
    for (const key of deleteKeys) projected.entries.delete(key);
    if (deletedSlugs.size) {
      for (const entry of projected.entries.values()) {
        if (!Array.isArray(entry.content.relatedProductSlugs)) continue;
        entry.content.relatedProductSlugs = entry.content.relatedProductSlugs.filter((slug) => !deletedSlugs.has(slug));
      }
    }
    return target;
  }

  function assertBase(entry, baseRevision, details) {
    const expected = requiredRevision(baseRevision);
    const actual = entry?.revision ?? 'missing';
    if (actual !== expected) {
      throw new ContentTransactionError(
        'REVISION_CONFLICT',
        'Данные изменились после открытия. Выполните preview заново.',
        { status: 409, details: { ...details, expected, actual } }
      );
    }
  }

  function relationBlockers(impact) {
    return (impact.blockers || []).map((item) => ({ ...item, severity: 'error' }));
  }

  async function applyOperations(initial, operations) {
    if (!Array.isArray(operations) || !operations.length) {
      throw new ContentTransactionError('CONTENT_OPERATIONS_REQUIRED', 'Не указаны операции с контентом.', { status: 400 });
    }
    const projected = cloneProjected(initial);
    const blockers = [];
    const warnings = [];
    const affectedRoutes = [];
    const promotions = [];

    for (const raw of operations) {
      if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') {
        throw new ContentTransactionError('CONTENT_OPERATION_INVALID', 'Операция с контентом имеет неверный формат.', { status: 400 });
      }
      if (RECORD_OPERATION_TYPES.has(raw.type)) {
        const definition = getCollectionDefinition(raw.collection);
        if (!definition) throw new ContentTransactionError('CONTENT_COLLECTION_UNKNOWN', 'Коллекция не разрешена.', { status: 400 });
        const collection = raw.collection;
        const slug = definition.fixedSlug || safeSlug(raw.slug);
        const current = findProjected(projected, collection, slug);
        assertBase(current, raw.baseRevision, { collection, slug });

        if (raw.type === 'upsert-record') {
          if (!raw.content || typeof raw.content !== 'object' || Array.isArray(raw.content)) {
            throw new ContentTransactionError('CONTENT_RECORD_NOT_OBJECT', 'Запись должна быть JSON-объектом.', { status: 400 });
          }
          const next = clone(raw.content);
          if (definition.hasSlug && next.slug !== slug) {
            throw new ContentTransactionError('CONTENT_SLUG_MISMATCH', 'Для смены slug используйте rename-record.', { status: 409 });
          }
          const config = registry.collections[collection];
          const relativePath = current?.relativePath || (config.type === 'single-file'
            ? config.relativePath
            : `${config.relativePath}/${slug}.json`);
          projected.entries.set(recordKey(collection, slug), {
            ...(current || {}), collection, slug, fileSlug: path.posix.basename(relativePath, '.json'),
            content: next, relativePath, revision: current?.revision ?? 'missing', bytes: current?.bytes ?? null
          });
          continue;
        }

        if (!current) {
          throw new ContentTransactionError('CONTENT_RECORD_NOT_FOUND', 'Запись не найдена.', { status: 404, details: { collection, slug } });
        }
        const graph = graphFor(projectedCorpus(projected));
        const action = raw.type === 'rename-record' ? 'rename' : raw.type === 'archive-record' ? 'archive' : 'delete';
        const impact = previewRelationImpact(graph, { action, collection, slug, nextSlug: raw.nextSlug });
        warnings.push(...(impact.warnings || []));
        affectedRoutes.push(...(impact.affectedRoutes || []));

        if (raw.type === 'rename-record') {
          const nextSlug = safeSlug(raw.nextSlug, 'nextSlug');
          if (findProjected(projected, collection, nextSlug)) {
            blockers.push({ code: 'CONTENT_RENAME_DESTINATION_EXISTS', message: `Slug ${nextSlug} уже существует.`, severity: 'error' });
            continue;
          }
          if (!impact.allowed) {
            blockers.push(...relationBlockers(impact));
            continue;
          }
          if (raw.content !== undefined) current.content = { ...clone(raw.content), slug };
          markRelationUpdates(projected, impact.relationUpdates);
          const renamed = findProjected(projected, collection, slug);
          renamed.content.slug = nextSlug;
          projected.entries.delete(recordKey(collection, slug));
          const config = registry.collections[collection];
          renamed.slug = nextSlug;
          renamed.relativePath = `${config.relativePath}/${nextSlug}.json`;
          renamed.fileSlug = nextSlug;
          projected.entries.set(recordKey(collection, nextSlug), renamed);
          continue;
        }

        if (raw.type === 'archive-record') {
          if (!impact.allowed) blockers.push(...relationBlockers(impact));
          else markRelationUpdates(projected, impact.relationUpdates);
          continue;
        }

        const relationPlan = raw.relationPlan;
        if (!relationPlan || !['hard-delete', 'cascade'].includes(relationPlan.strategy)) {
          blockers.push({
            code: 'RELATION_PLAN_REQUIRED',
            message: 'Для безвозвратного удаления требуется подтверждённый relationPlan.',
            severity: 'error', collection, slug
          });
          continue;
        }
        if (impact.blockers.length && relationPlan.strategy !== 'cascade') {
          blockers.push(...relationBlockers(impact));
          continue;
        }
        if (relationPlan.strategy === 'cascade') {
          const deleteKeys = descendantKeys(projected, current);
          applyCascadeDelete(projected, current, deleteKeys);
        } else {
          projected.entries.delete(recordKey(collection, slug));
        }
        continue;
      }

      if (raw.type === 'upsert-singleton') {
        const definition = getSingletonDefinition(raw.singleton);
        if (!definition) throw new ContentTransactionError('CONTENT_SINGLETON_UNKNOWN', 'Singleton не разрешён.', { status: 400 });
        const current = projected.singletons[raw.singleton];
        assertBase(current, raw.baseRevision, { singleton: raw.singleton });
        if (raw.value === undefined) throw new ContentTransactionError('CONTENT_SINGLETON_INVALID', 'Не указано значение singleton.', { status: 400 });
        const config = registry.singletons[raw.singleton];
        projected.singletons[raw.singleton] = {
          singleton: raw.singleton,
          content: clone(raw.value),
          bytes: current?.bytes ?? null,
          revision: current?.revision ?? 'missing',
          relativePath: config.relativePath
        };
        continue;
      }

      if (raw.type === 'promote-staged-media') {
        if (!stagingAdapter || typeof stagingAdapter.resolveForPromotion !== 'function') {
          throw new ContentTransactionError(
            'STAGED_MEDIA_ADAPTER_REQUIRED',
            'Продвижение staged media отключено: безопасный staging adapter не подключён.',
            { status: 409 }
          );
        }
        if (typeof raw.stagedId !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.stagedId)) {
          throw new ContentTransactionError('STAGED_MEDIA_ID_INVALID', 'Некорректный идентификатор staged media.', { status: 400 });
        }
        const resolved = await stagingAdapter.resolveForPromotion({
          stagedId: raw.stagedId,
          leaseId: raw.leaseId,
          batchId: raw.batchId,
          owner: raw.stagingOwner
        });
        if (!resolved || typeof resolved !== 'object' || !Buffer.isBuffer(resolved.bytes)
          || typeof resolved.sourcePath !== 'string' || typeof resolved.publicPath !== 'string') {
          throw new ContentTransactionError('STAGED_MEDIA_ADAPTER_INVALID', 'Staging adapter вернул неверный promotion plan.', { status: 500 });
        }
        const sourcePath = String(resolved.sourcePath).split(path.sep).join('/');
        const sourceAbsolute = absolute(sourcePath);
        if (!isInsideOrEqual(resolvedRepoRoot, sourceAbsolute) || sourceAbsolute === resolvedRepoRoot) {
          throw new ContentTransactionError('STAGED_MEDIA_PATH_INVALID', 'Staging adapter вернул путь вне репозитория.', { status: 500 });
        }
        const extension = path.posix.extname(resolved.publicPath).toLowerCase();
        if (!STAGED_MEDIA_EXTENSIONS.has(extension)) {
          throw new ContentTransactionError('STAGED_MEDIA_TYPE_INVALID', 'Формат staged media не поддерживается.', { status: 400 });
        }
        const sourceBytes = await readOptionalBytes(absolute(sourcePath), fileSystem);
        if (sourceBytes === null || !sourceBytes.equals(resolved.bytes)) {
          throw new ContentTransactionError('STAGED_MEDIA_NOT_FOUND', 'Staged media не найдено.', { status: 404 });
        }
        assertBase({ revision: revisionForBytes(sourceBytes) }, raw.baseRevision, { stagedId: raw.stagedId });
        const contentHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
        if (contentHash !== raw.stagedId || resolved.publicPath !== `/uploads/${contentHash}${extension}`) {
          throw new ContentTransactionError('STAGED_MEDIA_HASH_MISMATCH', 'Staged media не соответствует каноническому адресу.', { status: 409 });
        }
        const destinationPath = `public/uploads/${contentHash}${extension}`;
        const destinationBytes = await readOptionalBytes(absolute(destinationPath), fileSystem);
        const destinationRevision = revisionForBytes(destinationBytes);
        const expectedDestinationRevision = requiredRevision(raw.destinationBaseRevision);
        if (destinationRevision !== expectedDestinationRevision) {
          throw new ContentTransactionError(
            'REVISION_CONFLICT',
            'Файл назначения изменился после подготовки загрузки.',
            { status: 409, details: { path: destinationPath, expected: expectedDestinationRevision, actual: destinationRevision } }
          );
        }
        promotions.push({
          stagedId: raw.stagedId,
          batchId: raw.batchId,
          leaseId: raw.leaseId,
          stagingOwner: raw.stagingOwner,
          sourcePath,
          sourceBytes,
          sourceRevision: revisionForBytes(sourceBytes),
          destinationPath,
          destinationBytes,
          destinationRevision,
          bytes: sourceBytes,
          publicPath: resolved.publicPath
        });
        continue;
      }

      throw new ContentTransactionError('CONTENT_OPERATION_UNSUPPORTED', `Операция ${raw.type} не поддерживается.`, { status: 400 });
    }

    return { projected: projectedCorpus(projected), blockers, warnings, affectedRoutes, promotions };
  }

  async function validateProjection(initial, projected, operationResult, { trustedExact = false } = {}) {
    const validationIssues = [];
    for (const entry of projected.entries.values()) {
      const previous = entry.originalContent
        ?? initial.entries.get(recordKey(entry.collection, entry.slug))?.content;
      const checked = validateContentRecord({
        collection: entry.collection,
        slug: entry.slug,
        value: entry.content,
        previous,
        operation: previous ? 'update' : trustedExact ? 'validate' : 'create'
      });
      validationIssues.push(...checked.issues);
    }
    if (!trustedExact) {
      const beforeGlobal = initial.entries.get(recordKey('site-settings', 'global'))?.content;
      const afterGlobal = projected.entries.get(recordKey('site-settings', 'global'))?.content;
      if (beforeGlobal && afterGlobal?.privacyPolicy) {
        const legalFields = ['companyName', 'inn', 'kpp', 'ogrn', 'legalAddress', 'email'];
        const withoutConfirmation = (value) => ({
          requisites: Object.fromEntries(legalFields.map((field) => [field, value?.[field] ?? ''])),
          privacyPolicy: { ...(value?.privacyPolicy || {}), confirmedAgainstGlobalAt: '' }
        });
        const legalContentChanged = !isDeepStrictEqual(withoutConfirmation(beforeGlobal), withoutConfirmation(afterGlobal));
        const previousConfirmation = String(beforeGlobal.privacyPolicy?.confirmedAgainstGlobalAt || '');
        const nextConfirmation = String(afterGlobal.privacyPolicy?.confirmedAgainstGlobalAt || '');
        if (legalContentChanged && (!nextConfirmation || nextConfirmation === previousConfirmation)) {
          validationIssues.push(createValidationIssue({
            code: 'LEGAL_CONFIRMATION_REQUIRED',
            collection: 'site-settings',
            slug: 'global',
            path: 'privacyPolicy.confirmedAgainstGlobalAt',
            severity: 'error',
            userMessage: 'Юридический текст или реквизиты изменены. Сверьте их и явно подтвердите новую редакцию в настройках страницы.',
            technicalDetail: 'Legal content changed without advancing confirmedAgainstGlobalAt.'
          }));
        }
      }
    }
    for (const name of SINGLETON_KEYS) {
      const entry = projected.singletons[name];
      if (!entry) continue;
      validationIssues.push(...validateSingleton({ singleton: name, value: entry.content }).issues);
    }
    const beforePublicCompleteness = new Set(validateProjectedPublicCompleteness(initial).map(compareIssue));
    for (const issue of validateProjectedPublicCompleteness(projected)) {
      if (!beforePublicCompleteness.has(compareIssue(issue))) validationIssues.push(issue);
    }

    const beforeGraph = graphFor(initial);
    const afterGraph = graphFor(projected);
    const beforeIssues = new Set(beforeGraph.issues.map(compareIssue));
    for (const issue of afterGraph.issues) {
      if (!beforeIssues.has(compareIssue(issue))) validationIssues.push(relationIssueToValidation(issue));
    }

    const warnings = [
      ...operationResult.warnings,
      ...validationIssues.filter((issue) => issue.severity === 'warning')
    ];
    const blockers = [
      ...operationResult.blockers,
      ...validationIssues.filter((issue) => issue.severity !== 'warning')
    ];
    const beforeRoutes = routeSet(beforeGraph);
    const afterRoutes = routeSet(afterGraph);
    const affectedRoutes = [
      ...operationResult.affectedRoutes,
      ...[...beforeRoutes].filter((route) => !afterRoutes.has(route)).map((route) => ({ from: route, to: null, status: 'removed' })),
      ...[...afterRoutes].filter((route) => !beforeRoutes.has(route)).map((route) => ({ from: null, to: route, status: 'added' }))
    ];

    const mediaPaths = new Set([...beforeGraph.media, ...afterGraph.media].map((item) => item.path));
    for (const mediaPath of mediaPaths) {
      const relativePath = mediaRelativePath(mediaPath);
      if (!relativePath) continue;
      const bytes = await readOptionalBytes(absolute(relativePath), fileSystem);
      if (bytes === null) {
        warnings.push(createValidationIssue({
          code: 'MEDIA_FILE_MISSING',
          path: mediaPath,
          severity: 'warning',
          userMessage: `Медиафайл ${mediaPath} не найден.`,
          technicalDetail: `Missing ${relativePath}`
        }));
      }
    }
    return { blockers, warnings, affectedRoutes, mediaPaths, beforeGraph, afterGraph };
  }

  function buildFileMap(corpus) {
    const result = new Map();
    for (const entry of corpus.entries.values()) result.set(entry.relativePath, entry);
    for (const entry of Object.values(corpus.singletons)) result.set(entry.relativePath, entry);
    return result;
  }

  async function buildEnginePlan(initial, projected, validation, promotions = []) {
    const beforeFiles = buildFileMap(initial);
    const afterFiles = buildFileMap(projected);
    const paths = new Set([...beforeFiles.keys(), ...afterFiles.keys()]);
    const mutations = [];
    const diffs = [];
    for (const relativePath of [...paths].sort()) {
      const before = beforeFiles.get(relativePath);
      const after = afterFiles.get(relativePath);
      const beforeBytes = before?.bytes ?? null;
      const afterBytes = after
        ? before && isDeepStrictEqual(before.content, after.content)
          ? before.bytes
          : serializeContent(after.content)
        : null;
      const beforeRevision = revisionForBytes(beforeBytes);
      const afterRevision = revisionForBytes(afterBytes);
      if (beforeRevision === afterRevision) continue;
      if (afterBytes === null) {
        mutations.push({ path: relativePath, operation: 'delete', expectedRevision: beforeRevision });
      } else {
        mutations.push({
          path: relativePath,
          operation: 'write',
          bytesBase64: afterBytes.toString('base64'),
          expectedRevision: beforeRevision
        });
      }
      diffs.push({
        path: relativePath,
        entity: after
          ? after.singleton ? { singleton: after.singleton } : { collection: after.collection, slug: after.slug }
          : before.singleton ? { singleton: before.singleton } : { collection: before.collection, slug: before.slug },
        action: before && after ? 'update' : after ? 'create' : 'delete',
        beforeRevision,
        afterRevision,
        beforeBytesBase64: beforeBytes?.toString('base64') ?? null,
        afterBytesBase64: afterBytes?.toString('base64') ?? null,
        changedPaths: diffContentPaths(before?.content ?? null, after?.content ?? null)
      });
    }

    for (const promotion of promotions) {
      mutations.push({
        path: promotion.destinationPath,
        operation: 'write',
        bytesBase64: promotion.bytes.toString('base64'),
        expectedRevision: promotion.destinationRevision
      });
      diffs.push({
        path: promotion.destinationPath,
        entity: { media: promotion.publicPath },
        action: 'promote',
        beforeRevision: promotion.destinationRevision,
        afterRevision: revisionForBytes(promotion.bytes),
        beforeBytesBase64: promotion.destinationBytes?.toString('base64') ?? null,
        afterBytesBase64: promotion.bytes.toString('base64'),
        changedPaths: ['(bytes)']
      });
    }

    const readPaths = new Set([
      ...initial.files.keys(),
      ...beforeFiles.keys(),
      ...afterFiles.keys(),
      ...Object.values(registry.singletons).map((item) => item.relativePath)
    ]);
    for (const promotion of promotions) {
      readPaths.add(promotion.sourcePath);
      readPaths.add(promotion.destinationPath);
    }
    for (const mediaPath of validation.mediaPaths) {
      const relativePath = mediaRelativePath(mediaPath);
      if (relativePath) readPaths.add(relativePath);
    }
    const readSet = [];
    for (const relativePath of [...readPaths].sort()) {
      const bytes = await readOptionalBytes(absolute(relativePath), fileSystem);
      readSet.push({ path: relativePath, expectedRevision: revisionForBytes(bytes) });
    }
    return { mutations, readSet, diffs };
  }

  async function buildExactDiff(mutations, stagingPaths = new Set()) {
    const diffs = [];
    for (const mutation of mutations) {
      const beforeBytes = await readOptionalBytes(absolute(mutation.path), fileSystem);
      const afterBytes = mutation.operation === 'delete' ? null : Buffer.from(mutation.bytesBase64, 'base64');
      const classification = validateWhitelistedMutationPath(registry, mutation.path, { allowMedia: true, stagingPaths });
      let beforeContent = null;
      let afterContent = null;
      if (classification.kind === 'record' || classification.kind === 'singleton') {
        if (beforeBytes) beforeContent = parseJson(beforeBytes, mutation.path);
        if (afterBytes) afterContent = parseJson(afterBytes, mutation.path);
      }
      diffs.push({
        path: mutation.path,
        entity: classification.kind === 'record'
          ? { collection: classification.collection, slug: afterContent?.slug || beforeContent?.slug || registry.collections[classification.collection].slug }
          : classification.kind === 'singleton'
            ? { singleton: classification.singleton }
            : classification.kind === 'media'
              ? { media: `/${mutation.path.slice('public/'.length)}` }
              : { stagedMedia: path.posix.basename(mutation.path) },
        action: beforeBytes && afterBytes ? 'update' : afterBytes ? 'create' : 'delete',
        beforeRevision: revisionForBytes(beforeBytes),
        afterRevision: revisionForBytes(afterBytes),
        beforeBytesBase64: beforeBytes?.toString('base64') ?? null,
        afterBytesBase64: afterBytes?.toString('base64') ?? null,
        changedPaths: classification.kind === 'record' || classification.kind === 'singleton'
          ? diffContentPaths(beforeContent, afterContent)
          : ['(bytes)']
      });
    }
    return diffs;
  }

  function publicPreview(enginePreview, detail) {
    return {
      ...enginePreview,
      canApply: enginePreview.state === 'prepared',
      blockers: detail.blockers,
      warnings: detail.warnings,
      affectedRoutes: detail.affectedRoutes,
      diff: detail.diffs,
      readSet: detail.readSet.map((item) => ({ path: item.path, revision: item.expectedRevision }))
    };
  }

  async function preparePreview(request, exactMutations = null) {
    const context = actor(request);
    const prepared = await engine.withStableRead(async () => {
      const initial = await loadCorpus();
      let projected;
      let operationResult;
      if (exactMutations) {
        const overrides = new Map();
        const stagingPaths = new Set(request.internalStagingPaths || []);
        for (const mutation of exactMutations) {
          validateWhitelistedMutationPath(registry, mutation.path, { allowMedia: true, stagingPaths });
          overrides.set(mutation.path, mutation.operation === 'delete' ? null : Buffer.from(mutation.bytesBase64, 'base64'));
        }
        projected = await loadCorpus(overrides, stagingPaths);
        operationResult = { blockers: [], warnings: [], affectedRoutes: [], stagingPaths };
      } else {
        operationResult = await applyOperations(initial, request.operations);
        projected = operationResult.projected;
      }
      const validation = await validateProjection(initial, projected, operationResult, { trustedExact: Boolean(exactMutations) });
      const plan = await buildEnginePlan(initial, projected, validation, operationResult.promotions || []);
      if (exactMutations) {
        plan.mutations = exactMutations;
        plan.diffs = await buildExactDiff(exactMutations, operationResult.stagingPaths);
      }
      if (validation.blockers.length) {
        return {
          blocked: {
            state: 'blocked',
            result: 'validation-error',
            canApply: false,
            transactionId: null,
            blockers: validation.blockers,
            warnings: validation.warnings,
            affectedRoutes: validation.affectedRoutes,
            diff: plan.diffs,
            readSet: plan.readSet.map((item) => ({ path: item.path, revision: item.expectedRevision }))
          }
        };
      }
      const routeExpectations = deriveRouteExpectations(validation, plan);
      const routeTransitions = deriveRouteTransitions(validation);
      const affectedRouteNames = routeExpectations.map((item) => item.route);
      const recordRenames = (request.operations || [])
        .filter((operation) => operation?.type === 'rename-record')
        .map((operation) => ({ collection: operation.collection, fromSlug: operation.slug, toSlug: operation.nextSlug }));
      const metadata = {
        service: 'content-transaction',
        serviceVersion: SERVICE_METADATA_VERSION,
        operationDigest: digest(request.operations ?? exactMutations),
        userSummary: String(request.metadata?.userSummary || request.userSummary || 'Изменение контента').slice(0, 500),
        affectedRoutes: affectedRouteNames,
        routeExpectations,
        routeTransitions,
        recordRenames,
        diff: plan.diffs.map(({ beforeBytesBase64, afterBytesBase64, changedPaths, ...item }) => item),
        mediaPromotions: (operationResult.promotions || []).map((item) => ({
          stagedId: item.stagedId,
          batchId: item.batchId,
          leaseId: item.leaseId,
          stagingOwner: item.stagingOwner,
          publicPath: item.publicPath
        })),
        stagingpaths: [
          ...(operationResult.promotions || []).map((item) => item.sourcePath),
          ...(request.internalStagingPaths || [])
        ],
        ...(request.metadata?.transactionKind === 'json-import' ? { transactionKind: 'json-import' } : {}),
        ...(['merge', 'replace'].includes(request.metadata?.writeMode) ? { writeMode: request.metadata.writeMode } : {}),
        ...(request.metadata?.baseHead || request.baseHead ? { baseHead: request.metadata?.baseHead || request.baseHead } : {}),
        ...(request.metadata?.restoresTransactionId ? { restoresTransactionId: request.metadata.restoresTransactionId } : {})
      };
      return { validation, plan, metadata };
    });
    if (prepared.blocked) return prepared.blocked;
    const { validation, plan, metadata } = prepared;
    const enginePreview = await engine.preview({
      owner: context.engineOwner,
      recoveryClientId: context.recoveryClientId,
      idempotencyKey: context.idempotencyKey,
      baseHead: metadata.baseHead,
      metadata,
      readSet: plan.readSet,
      mutations: plan.mutations
    });
    return publicPreview(enginePreview, { ...validation, ...plan });
  }

  async function validateJournalProjection(journal, authorizedStagingPaths = []) {
    if (journal.metadata?.service !== 'content-transaction' || journal.metadata?.serviceVersion !== SERVICE_METADATA_VERSION) {
      throw new ContentTransactionError('CONTENT_TRANSACTION_METADATA_INVALID', 'Транзакция не принадлежит content-сервису.', { status: 409 });
    }
    const overrides = new Map();
    const stagingPaths = new Set([
      ...authorizedStagingPaths,
      ...(journal.metadata?.stagingPaths || []),
      ...(journal.metadata?.stagingpaths || [])
    ]);
    for (const mutation of journal.mutations) {
      validateWhitelistedMutationPath(registry, mutation.path, { allowMedia: true, stagingPaths });
      overrides.set(mutation.path, mutation.operation === 'delete' ? null : Buffer.from(mutation.contentBase64, 'base64'));
    }
    const initial = await loadCorpus();
    const projected = await loadCorpus(overrides, stagingPaths);
    const validation = await validateProjection(
      initial,
      projected,
      { blockers: [], warnings: [], affectedRoutes: [] },
      { trustedExact: true }
    );
    if (validation.blockers.length) {
      throw new ContentTransactionError(
        'CONTENT_SEMANTIC_RECHECK_FAILED',
        'Данные не прошли повторную проверку перед записью.',
        { status: 409, blockers: validation.blockers, warnings: validation.warnings }
      );
    }
  }

  async function assertOwned(transactionId, context) {
    const journal = await engine.withStableRead(() => engine.getTransaction(transactionId));
    if (journal.owner !== context.engineOwner) {
      throw new ContentTransactionError('CONTENT_TRANSACTION_NOT_FOUND', 'Транзакция не найдена.', { status: 404 });
    }
    return journal;
  }

  async function initialize() {
    return engine.initialize();
  }

  async function preview(request = {}) {
    return preparePreview(request);
  }

  async function apply(request = {}) {
    const context = principal(request);
    const transactionId = requiredId(request.transactionId, 'transactionId');
    const journal = await assertOwned(transactionId, context);
    const recoveryClientId = request.recoveryClientId || journal.recoveryClientId;
    const idempotencyKey = request.idempotencyKey || journal.idempotencyKey;
    const authorizedStagingPaths = journal.metadata?.stagingpaths || [];
    const result = await engine.apply({
      owner: context.engineOwner,
      recoveryClientId,
      idempotencyKey,
      transactionId,
      payloadHash: request.payloadHash
    }, { beforeApply: ({ journal: lockedJournal }) => validateJournalProjection(lockedJournal, authorizedStagingPaths) });
    const mediaPromotionWarnings = [];
    if (typeof stagingAdapter?.markPromoted === 'function') {
      for (const promotion of journal.metadata?.mediaPromotions || []) {
        try {
          await stagingAdapter.markPromoted(promotion);
        } catch (error) {
          mediaPromotionWarnings.push({
            code: error?.code || 'STAGED_MEDIA_FINALIZE_FAILED',
            stagedId: promotion.stagedId,
            message: error?.message || 'Canonical media сохранено, но staging status не обновлён.'
          });
        }
      }
    }
    return mediaPromotionWarnings.length ? { ...result, mediaPromotionWarnings } : result;
  }

  async function getTransaction(request = {}) {
    const context = principal(request);
    const journal = await assertOwned(requiredId(request.transactionId, 'transactionId'), context);
    return {
      transactionId: journal.transactionId,
      state: journal.state,
      createdAt: journal.createdAt,
      updatedAt: journal.updatedAt,
      metadata: clone(journal.metadata),
      result: clone(journal.result),
      mutations: journal.mutations.map((item) => ({
        path: item.path,
        operation: item.operation,
        baseRevision: item.baseRevision,
        nextRevision: item.nextRevision,
        willChange: item.willChange
      }))
    };
  }

  async function listHistory(request = {}) {
    const context = principal(request);
    const history = await engine.withStableRead(() => engine.listHistory());
    return history.filter((entry) => entry.owner === context.engineOwner).map((entry) => ({
      transactionId: entry.transactionId,
      state: entry.state,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      metadata: entry.metadata,
      changedPaths: entry.changedPaths
    }));
  }

  async function previewRestore(request = {}) {
    const context = actor(request);
    const sourceTransactionId = requiredId(request.sourceTransactionId, 'sourceTransactionId');
    await assertOwned(sourceTransactionId, context);
    const restorePlan = await engine.createRestorePlan(sourceTransactionId);
    const sourceMetadata = (await engine.getTransaction(sourceTransactionId)).metadata || {};
    const sourceStagingPaths = new Set([
      ...(sourceMetadata.stagingPaths || []),
      ...(sourceMetadata.stagingpaths || [])
    ]);
    return preparePreview({
      ...request,
      operations: [{ type: 'restore-transaction', sourceTransactionId }],
      internalStagingPaths: [...sourceStagingPaths],
      metadata: {
        ...(request.metadata || {}),
        restoresTransactionId: sourceTransactionId,
        userSummary: request.metadata?.userSummary || `Восстановление версии до транзакции ${sourceTransactionId}`,
        affectedRoutes: restorePlan.metadata?.affectedRoutes || []
      }
    }, restorePlan.mutations);
  }

  async function readRecord(request = {}) {
    const collection = String(request.collection || '');
    const definition = getCollectionDefinition(collection);
    if (!definition) throw new ContentTransactionError('CONTENT_COLLECTION_UNKNOWN', 'Коллекция не разрешена.', { status: 404 });
    const slug = definition.fixedSlug || safeSlug(request.slug);
    return engine.withStableRead(async () => {
      const corpus = await loadCorpus();
      const entry = corpus.entries.get(recordKey(collection, slug));
      if (!entry) throw new ContentTransactionError('CONTENT_RECORD_NOT_FOUND', 'Запись не найдена.', { status: 404 });
      return publicRecord(entry);
    });
  }

  async function withRecordStableRead(request = {}, callback) {
    if (typeof callback !== 'function') {
      throw new ContentTransactionError('CONTENT_STABLE_READ_CALLBACK_REQUIRED', 'Для стабильного чтения нужна callback-функция.', { status: 500 });
    }
    const collection = String(request.collection || '');
    const definition = getCollectionDefinition(collection);
    if (!definition) throw new ContentTransactionError('CONTENT_COLLECTION_UNKNOWN', 'Коллекция не разрешена.', { status: 404 });
    const slug = definition.fixedSlug || safeSlug(request.slug);
    return engine.withStableRead(async (context) => {
      const corpus = await loadCorpus();
      const entry = corpus.entries.get(recordKey(collection, slug));
      if (!entry) throw new ContentTransactionError('CONTENT_RECORD_NOT_FOUND', 'Запись не найдена.', { status: 404 });
      return callback(publicRecord(entry), context);
    });
  }

  async function readSingleton(request = {}) {
    const singleton = String(request.singleton || '');
    if (!getSingletonDefinition(singleton)) throw new ContentTransactionError('CONTENT_SINGLETON_UNKNOWN', 'Singleton не разрешён.', { status: 404 });
    return engine.withStableRead(async () => {
      const corpus = await loadCorpus();
      const entry = corpus.singletons[singleton];
      if (!entry) throw new ContentTransactionError('CONTENT_SINGLETON_NOT_FOUND', 'Singleton не найден.', { status: 404 });
      return { singleton, content: clone(entry.content), revision: entry.revision };
    });
  }

  async function withStableRead(callback) {
    return engine.withStableRead(callback);
  }

  return Object.freeze({
    initialize,
    preview,
    apply,
    getTransaction,
    listHistory,
    previewRestore,
    readRecord,
    withRecordStableRead,
    readSingleton,
    withStableRead
  });
}

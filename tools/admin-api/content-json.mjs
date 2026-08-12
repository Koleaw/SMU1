import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { contentSchemas } from '../../src/content-schemas.mjs';
import { projectMediaPath, sanitizeProjectGallery } from '../../src/utils/projectMedia.mjs';
import { revisionForBytes } from './transaction-engine.mjs';

const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SENSITIVE_KEY_RE = /(?:password|secret|token|api[-_]?key|authorization)/i;
const LOCAL_ABSOLUTE_RE = /^(?:[a-z]:[\\/]|\\\\|file:)/i;
const MEDIA_KEYS = new Set([
  'image', 'coverImage', 'gallery', 'images', 'media', 'video', 'poster', 'src', 'url',
  'heroMediaVideo', 'heroMediaVideoMobile', 'heroMediaPoster', 'heroMediaPosterMobile', 'trustImage'
]);
const OPERATION_TTL_MS = 15 * 60 * 1000;
const FULL_COLLECTIONS = [
  'static-pages', 'services', 'product-sections', 'product-categories', 'products', 'projects', 'jobs'
];
const FULL_SINGLETONS = ['site-settings', 'navigation', 'yandex'];
const PAGE_KIND_BY_COLLECTION = {
  'static-pages': 'static-page',
  'product-sections': 'product-section',
  'product-categories': 'product-category',
  products: 'product',
  services: 'service',
  projects: 'project'
};
const COLLECTION_BY_PAGE_KIND = Object.fromEntries(
  Object.entries(PAGE_KIND_BY_COLLECTION).map(([collection, kind]) => [kind, collection])
);
const COLLECTION_EXPORT_NAMES = {
  'product-sections': ['product-section', 'product-sections'],
  'product-categories': ['product-category', 'product-categories'],
  products: ['product', 'products'],
  services: ['service', 'services'],
  projects: ['completed-project', 'completed-projects'],
  jobs: ['job', 'jobs'],
  'site-settings': ['site-settings', 'site-settings'],
  'static-pages': ['static-page', 'static-pages']
};
const REQUIRED_TEXT_FIELDS = {
  'product-sections': ['title', 'slug', 'shortDescription', 'heroTitle', 'heroDescription', 'image', 'placeholderLabel', 'seoTitle', 'seoDescription'],
  'product-categories': ['title', 'slug', 'parentSectionSlug', 'shortDescription', 'heroTitle', 'heroDescription', 'image', 'placeholderLabel', 'seoTitle', 'seoDescription'],
  products: ['title', 'slug', 'productCategorySlug', 'shortDescription', 'leadText', 'currency', 'image', 'placeholderLabel', 'seoTitle', 'seoDescription'],
  services: ['title', 'slug', 'shortDescription', 'heroTitle', 'heroDescription', 'image', 'placeholderLabel', 'seoTitle', 'seoDescription'],
  projects: ['title', 'slug', 'city', 'shortDescription', 'whatWasDone', 'seoTitle', 'seoDescription'],
  jobs: ['title', 'slug', 'city', 'employmentType', 'salary', 'shortDescription'],
  'site-settings': ['companyName', 'companyShortName', 'inn', 'kpp', 'ogrn', 'registrationDate', 'legalAddress', 'phonePrimary', 'phoneSecondary', 'telegram', 'email', 'city', 'address', 'vacanciesEmptyTitle', 'vacanciesEmptyText'],
  'static-pages': ['title', 'slug', 'seoTitle', 'seoDescription', 'heroTitle']
};
const ROUTE_SLUG_COLLECTIONS = new Set(['static-pages', 'product-sections', 'services']);
const RESERVED_TOP_LEVEL_SLUGS = new Set(['admin', 'izgotovlenie-na-zakaz', '404']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cleanSlug(value) {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return slug && SAFE_SLUG_RE.test(slug) ? slug : '';
}

function formatPath(parts) {
  return parts.reduce((result, part) => typeof part === 'number' ? `${result}[${part}]` : result ? `${result}.${part}` : part, '');
}

export function mergeContent(current, incoming) {
  if (!isPlainObject(current) || !isPlainObject(incoming)) return clone(incoming);
  const result = clone(current);
  for (const [key, value] of Object.entries(incoming)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? mergeContent(result[key], value)
      : clone(value);
  }
  return result;
}

export function diffContent(current, next) {
  const result = { changed: [], added: [], removed: [] };
  const visit = (left, right, parts = []) => {
    if (Object.is(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        if (index >= left.length) result.added.push(formatPath([...parts, index]));
        else if (index >= right.length) result.removed.push(formatPath([...parts, index]));
        else visit(left[index], right[index], [...parts, index]);
      }
      return;
    }
    if (isPlainObject(left) && isPlainObject(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) {
        if (!(key in left)) result.added.push(formatPath([...parts, key]));
        else if (!(key in right)) result.removed.push(formatPath([...parts, key]));
        else visit(left[key], right[key], [...parts, key]);
      }
      return;
    }
    result.changed.push(formatPath(parts) || '(корень)');
  };
  visit(current, next);
  return result;
}

function findSensitivePaths(value, parts = [], result = []) {
  if (Array.isArray(value)) value.forEach((item, index) => findSensitivePaths(item, [...parts, index], result));
  else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(key)) result.push(formatPath([...parts, key]));
      else findSensitivePaths(item, [...parts, key], result);
    }
  }
  return result;
}

function assertNoSensitiveContent(value) {
  const sensitive = findSensitivePaths(value);
  if (sensitive.length) {
    const error = new Error(`Экспорт заблокирован: запрещённые секретные поля в ${sensitive.join(', ')}.`);
    error.code = 'SENSITIVE_CONTENT_BLOCKED';
    error.sensitivePaths = sensitive;
    throw error;
  }
}

function collectMediaValues(value, parts = [], activeMediaKey = false, result = []) {
  if (Array.isArray(value)) value.forEach((item, index) => collectMediaValues(item, [...parts, index], activeMediaKey, result));
  else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) collectMediaValues(item, [...parts, key], MEDIA_KEYS.has(key), result);
  } else if (activeMediaKey && typeof value === 'string' && value.trim()) {
    result.push({ path: formatPath(parts), value: value.trim() });
  }
  return result;
}

function assertExportPathsAreSafe(value) {
  const unsafe = collectMediaValues(value).filter((item) => {
    const normalized = item.value.replace(/\\/g, '/');
    return item.value.startsWith('data:') || LOCAL_ABSOLUTE_RE.test(item.value) || item.value.includes('\0') || normalized.split('/').includes('..');
  });
  if (unsafe.length) throw new Error(`Экспорт заблокирован: небезопасные media-значения в ${unsafe.map((item) => item.path).join(', ')}.`);
}

async function mediaWarnings(value, publicRoot, fileSystem) {
  const warnings = [];
  const errors = [];
  for (const media of collectMediaValues(value)) {
    if (media.value.startsWith('data:')) {
      errors.push(`${media.path}: data/base64 запрещён; используйте путь к файлу.`);
      continue;
    }
    if (/^https?:\/\//i.test(media.value)) continue;
    if (LOCAL_ABSOLUTE_RE.test(media.value) || media.value.includes('\0')) {
      errors.push(`${media.path}: абсолютный локальный или file-путь запрещён.`);
      continue;
    }
    const normalized = media.value.replace(/\\/g, '/');
    if (normalized.split('/').includes('..')) {
      errors.push(`${media.path}: переходы .. в пути запрещены.`);
      continue;
    }
    if (!normalized.startsWith('/')) continue;
    const target = path.resolve(publicRoot, normalized.replace(/^\/+/, ''));
    const root = path.resolve(publicRoot);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      errors.push(`${media.path}: путь выходит за пределы public.`);
      continue;
    }
    try { await fileSystem.access(target); }
    catch { warnings.push(`${media.path}: файл ${media.value} не найден в public.`); }
  }
  return { warnings, errors };
}

function zodMessages(result) {
  if (result.success) return [];
  return result.error.issues.map((issue) => `${formatPath(issue.path) || '(корень)'}: ${issue.message}`);
}

function validateSpecialFields(collection, value) {
  const errors = [];
  const warnings = [];
  const slug = collection === 'site-settings' ? 'global' : cleanSlug(value?.slug);
  if (collection !== 'site-settings' && !slug) errors.push('slug: требуется непустой slug из латиницы, цифр и дефисов.');
  for (const field of REQUIRED_TEXT_FIELDS[collection] || []) {
    if (typeof value?.[field] !== 'string' || !value[field].trim()) {
      const message = `${field}: обязательное поле пустое.`;
      if (field === 'image' || field === 'placeholderLabel') warnings.push(message);
      else errors.push(message);
    }
  }
  if (collection === 'projects' && value?.year !== undefined && (!Number.isInteger(value.year) || value.year < 1900 || value.year > 2100)) {
    errors.push('year: ожидается четырёхзначный год от 1900 до 2100.');
  }
  if (collection === 'site-settings' && typeof value?.registrationDate === 'string') {
    const match = value.registrationDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 31 || Number(match[2]) < 1 || Number(match[2]) > 12) {
      errors.push('registrationDate: ожидается дата в формате ДД.ММ.ГГГГ.');
    }
  }
  const sensitive = findSensitivePaths(value);
  if (sensitive.length) errors.push(`Запрещены секретные поля: ${sensitive.join(', ')}.`);
  return { errors, warnings };
}

function sanitizeProjectIncoming(value) {
  if (!isPlainObject(value)) return { value, warnings: [] };
  const next = clone(value);
  const warnings = [];
  for (const field of ['image', 'coverImage']) {
    if (!(field in next)) continue;
    const original = next[field];
    if (typeof original === 'string') {
      next[field] = original.trim();
      continue;
    }
    const src = projectMediaPath(original);
    if (src) {
      next[field] = src;
      warnings.push(`${field}: объект media преобразован в строковый путь.`);
    } else {
      delete next[field];
      warnings.push(`${field}: отсутствует строковый src; значение пропущено.`);
    }
  }
  for (const field of ['gallery', 'images']) {
    if (!(field in next)) continue;
    const sanitized = sanitizeProjectGallery(next[field]);
    if (sanitized.items === undefined) delete next[field];
    else next[field] = sanitized.items;
    warnings.push(...sanitized.warnings.map((warning) => field === 'gallery' ? warning : warning.replace(/^gallery/, field)));
  }
  return { value: next, warnings };
}

function validateNavigation(value) {
  const errors = [];
  if (!isPlainObject(value) || !Array.isArray(value.items)) return ['navigation: ожидается объект с массивом items.'];
  value.items.forEach((item, index) => {
    if (!isPlainObject(item)) errors.push(`navigation.items[${index}]: ожидается объект.`);
    else {
      if (typeof item.title !== 'string' || !item.title.trim()) errors.push(`navigation.items[${index}].title: обязательное поле пустое.`);
      if (typeof item.href !== 'string' || !item.href.trim()) errors.push(`navigation.items[${index}].href: обязательное поле пустое.`);
      if (item.order !== undefined && typeof item.order !== 'number') errors.push(`navigation.items[${index}].order: ожидается число.`);
      if (item.isActive !== undefined && typeof item.isActive !== 'boolean') errors.push(`navigation.items[${index}].isActive: ожидается boolean.`);
    }
  });
  return errors;
}

function sortItems(items) {
  return items.slice().sort((left, right) => {
    const order = (Number(left.order) || Number.MAX_SAFE_INTEGER) - (Number(right.order) || Number.MAX_SAFE_INTEGER);
    return order || String(left.title || left.companyName || left.slug || '').localeCompare(String(right.title || right.companyName || right.slug || ''), 'ru');
  });
}

function collectionEnvelope(collection, items, exportedAt = new Date().toISOString()) {
  items.forEach(assertNoSensitiveContent);
  return { type: 'smu1_content_collection', version: 1, collection, exportedAt, items: sortItems(items.map(clone)) };
}

function exportFilename(collection, slug = '') {
  const [single, all] = COLLECTION_EXPORT_NAMES[collection] || [collection, collection];
  return slug ? `export-${single}-${slug}.json` : `export-${all}-all.json`;
}

function buildReport(data) {
  const lines = [
    'SMU-1 — отчёт JSON-импорта',
    `Дата и время: ${data.timestamp}`,
    `Тип импорта: ${data.importType || data.scope || '-'}`,
    `Коллекции: ${(data.affectedCollections || []).join(', ') || '-'}`,
    `Singletons: ${(data.affectedSingletons || []).join(', ') || '-'}`,
    `Режим записи: ${data.writeMode || '-'}`,
    `Результат: ${data.result || '-'}`,
    '',
    `Создано: ${data.created || 0}`,
    `Обновлено: ${data.updated || 0}`,
    `Пропущено: ${data.skipped || 0}`,
    '',
    'Элементы:',
    ...(data.items?.length ? data.items.map((item) => `- ${item.collection || item.singleton || '-'} / ${item.slug || '-'}: ${item.action}`) : ['- нет']),
    '',
    'Изменённые файлы:',
    ...(data.files?.length ? data.files.map((item) => `- ${item}`) : ['- нет']),
    '',
    'Warnings:',
    ...(data.warnings?.length ? data.warnings.map((item) => `- ${item}`) : ['- нет']),
    '',
    'Errors:',
    ...(data.errors?.length ? data.errors.map((item) => `- ${item}`) : ['- нет'])
  ];
  return lines.join('\n');
}

function reportPayload(data) {
  const safe = {
    timestamp: new Date().toISOString(), created: 0, updated: 0, skipped: 0,
    files: [], warnings: [], errors: [], affectedCollections: [], affectedSingletons: [], ...data
  };
  return { ...safe, reportText: buildReport(safe) };
}

function pageRoute(collection, item, lookups) {
  if (collection === 'static-pages') {
    if (item.slug === 'home') return '/';
    if (item.slug === 'custom-order') return '/izgotovlenie-na-zakaz/';
    return `/${item.slug}/`;
  }
  if (collection === 'product-sections' || collection === 'services') return `/${item.slug}/`;
  if (collection === 'projects') return `/vypolnennye-obekty/${item.slug}/`;
  if (collection === 'product-categories') return `/${item.parentSectionSlug}/${item.slug}/`;
  if (collection === 'products') {
    const category = lookups.get('product-categories')?.get(item.productCategorySlug)?.content;
    if (!category) throw new Error(`Категория ${item.productCategorySlug} для товара ${item.slug} не найдена.`);
    return `/${category.parentSectionSlug}/${category.slug}/${item.slug}/`;
  }
  return `/${item.slug}/`;
}

function referencedCategorySlugs(value, sectionSlug, result = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => referencedCategorySlugs(item, sectionSlug, result));
  else if (isPlainObject(value)) {
    if (typeof value.categorySlug === 'string' && cleanSlug(value.categorySlug)) result.add(cleanSlug(value.categorySlug));
    if (typeof value.buttonHref === 'string') {
      const pathOnly = value.buttonHref.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0];
      const parts = pathOnly.split('/').filter(Boolean);
      const sectionIndex = parts.lastIndexOf(sectionSlug);
      const candidate = sectionIndex >= 0 ? parts[sectionIndex + 1] : '';
      if (cleanSlug(candidate)) result.add(cleanSlug(candidate));
    }
    Object.values(value).forEach((item) => referencedCategorySlugs(item, sectionSlug, result));
  }
  return result;
}

export function createContentJsonService({
  repoRoot,
  collections,
  singletons = {},
  operationTtlMs = OPERATION_TTL_MS,
  fileSystem = fs,
  transactionService = null
}) {
  const operations = new Map();
  let applying = false;
  const publicRoot = path.join(repoRoot, 'public');
  const sanitizeError = (value) => String(value || 'Неизвестная ошибка')
    .replaceAll(repoRoot, '[repo]')
    .replaceAll(repoRoot.replace(/\\/g, '/'), '[repo]');

  const collectionConfig = (collection) => {
    if (!contentSchemas[collection] || !collections[collection]) throw new Error('Коллекция не разрешена для JSON-импорта.');
    return collections[collection];
  };

  const entryPath = (collection, slug) => {
    const config = collectionConfig(collection);
    if (config.type === 'single-file') return config.path;
    const safeSlug = cleanSlug(slug);
    if (!safeSlug) throw new Error('Некорректный slug.');
    const target = path.resolve(config.path, `${safeSlug}.json`);
    const root = path.resolve(config.path);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Путь выходит за разрешённую коллекцию.');
    return target;
  };

  const listEntries = async (collection) => {
    const config = collectionConfig(collection);
    if (config.type === 'single-file') {
      const raw = await fileSystem.readFile(config.path, 'utf8');
      return [{ slug: config.slug, filePath: config.path, raw, content: JSON.parse(raw) }];
    }
    const names = await fileSystem.readdir(config.path, { withFileTypes: true });
    const entries = [];
    for (const name of names) {
      if (!name.isFile() || !name.name.endsWith('.json')) continue;
      const filePath = path.join(config.path, name.name);
      const raw = await fileSystem.readFile(filePath, 'utf8');
      const content = JSON.parse(raw);
      const slug = cleanSlug(content.slug) || name.name.replace(/\.json$/i, '');
      entries.push({ slug, filePath, raw, content });
    }
    return entries;
  };

  const readEntry = async (collection, slug) => {
    const entries = await listEntries(collection);
    const entry = entries.find((item) => item.slug === slug || path.basename(item.filePath, '.json') === slug);
    if (!entry) throw new Error('Запись не найдена.');
    return entry;
  };

  const relativePath = (filePath) => path.relative(repoRoot, filePath).replace(/\\/g, '/');

  async function readDataSingleton(name) {
    const config = singletons[name];
    if (!config) throw new Error(`Singleton ${name} не разрешён.`);
    const raw = await fileSystem.readFile(config.path, 'utf8');
    const stored = JSON.parse(raw);
    return {
      raw,
      filePath: config.path,
      content: name === 'navigation' ? { items: stored } : stored
    };
  }

  async function exportSingle(collection, slug) {
    const entry = await readEntry(collection, slug);
    assertExportPathsAreSafe(entry.content);
    assertNoSensitiveContent(entry.content);
    return { payload: clone(entry.content), filename: exportFilename(collection, slug) };
  }

  async function exportCollection(collection) {
    const entries = await listEntries(collection);
    entries.forEach((entry) => assertExportPathsAreSafe(entry.content));
    return { payload: collectionEnvelope(collection, entries.map((entry) => entry.content)), filename: exportFilename(collection) };
  }

  async function loadLookups() {
    const result = new Map();
    for (const collection of Object.keys(collections)) {
      const entries = await listEntries(collection);
      result.set(collection, new Map(entries.map((entry) => [entry.slug, entry])));
    }
    return result;
  }

  async function exportFullSite() {
    const exportedAt = new Date().toISOString();
    const payload = { type: 'smu1_full_site_export', version: 1, exportedAt, collections: {}, singletons: {} };
    for (const collection of FULL_COLLECTIONS) {
      const entries = await listEntries(collection);
      entries.forEach((entry) => assertExportPathsAreSafe(entry.content));
      payload.collections[collection] = collectionEnvelope(collection, entries.map((entry) => entry.content), exportedAt);
    }
    const settings = await readEntry('site-settings', 'global');
    assertExportPathsAreSafe(settings.content);
    assertNoSensitiveContent(settings.content);
    payload.singletons['site-settings'] = clone(settings.content);
    for (const name of FULL_SINGLETONS.filter((item) => item !== 'site-settings')) {
      const singleton = await readDataSingleton(name);
      assertExportPathsAreSafe(singleton.content);
      assertNoSensitiveContent(singleton.content);
      payload.singletons[name] = clone(singleton.content);
    }
    return { payload, filename: `export-smu1-full-site-${exportedAt.slice(0, 10)}.json` };
  }

  async function exportPage(collection, slug) {
    if (!PAGE_KIND_BY_COLLECTION[collection]) throw new Error('Для этой сущности page bundle не поддерживается.');
    const lookups = await loadLookups();
    const pageEntry = lookups.get(collection)?.get(slug);
    if (!pageEntry) throw new Error('Страница не найдена.');
    const exportedAt = new Date().toISOString();
    const related = new Map();
    const addRelated = (name, entries) => {
      if (!entries?.length) return;
      const current = related.get(name) || new Map();
      entries.forEach((entry) => current.set(entry.slug, entry));
      related.set(name, current);
    };

    let kind = PAGE_KIND_BY_COLLECTION[collection];
    if (collection === 'static-pages' && slug === 'vypolnennye-obekty') {
      kind = 'completed-projects-index';
      addRelated('projects', [...lookups.get('projects').values()]);
    } else if (collection === 'static-pages' && slug === 'home') {
      addRelated('product-sections', [...lookups.get('product-sections').values()].filter((entry) => entry.content.showOnHome && entry.content.isActive));
      addRelated('services', [...lookups.get('services').values()].filter((entry) => entry.content.showOnHome && entry.content.isActive));
    } else if (collection === 'product-sections') {
      const categorySlugs = referencedCategorySlugs(pageEntry.content, slug);
      const categories = [...lookups.get('product-categories').values()].filter((entry) => entry.content.parentSectionSlug === slug || categorySlugs.has(entry.slug));
      addRelated('product-categories', categories);
      const selected = new Set(categories.map((entry) => entry.slug));
      addRelated('products', [...lookups.get('products').values()].filter((entry) => selected.has(entry.content.productCategorySlug)));
    } else if (collection === 'product-categories') {
      addRelated('products', [...lookups.get('products').values()].filter((entry) => entry.content.productCategorySlug === slug));
    } else if (collection === 'products') {
      const category = lookups.get('product-categories').get(pageEntry.content.productCategorySlug);
      if (category) {
        addRelated('product-categories', [category]);
        const section = lookups.get('product-sections').get(category.content.parentSectionSlug);
        if (section) addRelated('product-sections', [section]);
        const manual = new Set(Array.isArray(pageEntry.content.relatedProductSlugs) ? pageEntry.content.relatedProductSlugs : []);
        addRelated('products', [...lookups.get('products').values()].filter((entry) => entry.slug !== slug && (manual.has(entry.slug) || entry.content.productCategorySlug === category.slug)));
      }
    }

    assertExportPathsAreSafe(pageEntry.content);
    assertNoSensitiveContent(pageEntry.content);
    const relatedCollections = {};
    for (const [name, entries] of related) {
      const values = [...entries.values()];
      values.forEach((entry) => assertExportPathsAreSafe(entry.content));
      relatedCollections[name] = collectionEnvelope(name, values.map((entry) => entry.content), exportedAt);
    }
    return {
      payload: {
        type: 'smu1_page_bundle', version: 1, exportedAt,
        page: { kind, slug, route: pageRoute(collection, pageEntry.content, lookups), data: clone(pageEntry.content) },
        related: { collections: relatedCollections }
      },
      filename: `export-page-${slug}.json`
    };
  }

  function parseCollectionEnvelope(value, expectedCollection) {
    if (!isPlainObject(value) || value.type !== 'smu1_content_collection' || value.version !== 1 || value.collection !== expectedCollection || !Array.isArray(value.items)) {
      throw new Error(`Ожидается smu1_content_collection версии 1 для ${expectedCollection}.`);
    }
    return value.items;
  }

  function expectedRelatedCollections(collection, slug) {
    if (collection === 'static-pages' && slug === 'vypolnennye-obekty') return new Set(['projects']);
    if (collection === 'static-pages' && slug === 'home') return new Set(['product-sections', 'services']);
    if (collection === 'product-sections') return new Set(['product-categories', 'products']);
    if (collection === 'product-categories') return new Set(['products']);
    if (collection === 'products') return new Set(['product-sections', 'product-categories', 'products']);
    return new Set();
  }

  function parseImportPayload({ collection, scope, currentSlug, parsed }) {
    if (scope === 'single') {
      if (!isPlainObject(parsed)) throw new Error('Одиночный импорт ожидает JSON-объект.');
      return { importType: 'single entity', groups: [{ collection, items: [parsed], bindingSlug: currentSlug }], singletonValues: {} };
    }
    if (scope === 'collection') {
      return { importType: 'collection', groups: [{ collection, items: parseCollectionEnvelope(parsed, collection) }], singletonValues: {} };
    }
    if (scope === 'full-site') {
      if (!isPlainObject(parsed) || parsed.type !== 'smu1_full_site_export' || parsed.version !== 1 || !isPlainObject(parsed.collections) || !isPlainObject(parsed.singletons)) {
        throw new Error('Ожидается smu1_full_site_export версии 1.');
      }
      const collectionKeys = Object.keys(parsed.collections);
      const singletonKeys = Object.keys(parsed.singletons);
      const missing = [...FULL_COLLECTIONS.filter((key) => !collectionKeys.includes(key)), ...FULL_SINGLETONS.filter((key) => !singletonKeys.includes(key))];
      const unknown = [...collectionKeys.filter((key) => !FULL_COLLECTIONS.includes(key)), ...singletonKeys.filter((key) => !FULL_SINGLETONS.includes(key))];
      if (missing.length) throw new Error(`Full site export неполный: отсутствуют ${missing.join(', ')}.`);
      if (unknown.length) throw new Error(`Full site export содержит неизвестные ресурсы: ${unknown.join(', ')}.`);
      const groups = FULL_COLLECTIONS.map((name) => ({ collection: name, items: parseCollectionEnvelope(parsed.collections[name], name) }));
      groups.push({ collection: 'site-settings', items: [parsed.singletons['site-settings']], bindingSlug: 'global' });
      return {
        importType: 'full site', groups,
        singletonValues: { navigation: parsed.singletons.navigation, yandex: parsed.singletons.yandex }
      };
    }
    if (scope === 'page-bundle') {
      if (!isPlainObject(parsed) || parsed.type !== 'smu1_page_bundle' || parsed.version !== 1 || !isPlainObject(parsed.page) || !isPlainObject(parsed.page.data)) {
        throw new Error('Ожидается smu1_page_bundle версии 1.');
      }
      let pageCollection = COLLECTION_BY_PAGE_KIND[parsed.page.kind];
      if (parsed.page.kind === 'completed-projects-index') pageCollection = 'static-pages';
      if (!pageCollection || pageCollection !== collection || parsed.page.slug !== currentSlug || parsed.page.data.slug !== currentSlug) {
        throw new Error('Page bundle не соответствует открытой странице или её slug.');
      }
      const relatedCollections = parsed.related?.collections;
      if (!isPlainObject(relatedCollections)) throw new Error('Page bundle должен содержать related.collections.');
      const expected = expectedRelatedCollections(collection, currentSlug);
      const actual = Object.keys(relatedCollections);
      const unknown = actual.filter((key) => !expected.has(key));
      const missing = [...expected].filter((key) => !actual.includes(key));
      if (unknown.length || missing.length) throw new Error(`Неверный состав related.collections${unknown.length ? `; лишние: ${unknown.join(', ')}` : ''}${missing.length ? `; отсутствуют: ${missing.join(', ')}` : ''}.`);
      const groups = [{ collection, items: [parsed.page.data], bindingSlug: currentSlug }];
      for (const name of actual) groups.push({ collection: name, items: parseCollectionEnvelope(relatedCollections[name], name) });
      return { importType: 'page bundle', groups, singletonValues: {} };
    }
    throw new Error('Неизвестный режим импорта.');
  }

  async function preview({
    owner,
    sessionFingerprint,
    recoveryClientId,
    idempotencyKey,
    baseHead,
    collection = '',
    scope,
    currentSlug = '',
    writeMode = 'merge',
    rawJson = ''
  }) {
    for (const [id, operation] of operations) if (Date.now() - operation.createdAt > operationTtlMs) operations.delete(id);
    const baseReport = { collection, slug: currentSlug, scope, writeMode };
    if (!['single', 'collection', 'full-site', 'page-bundle'].includes(scope)) return reportPayload({ ...baseReport, result: 'validation-error', errors: ['Неизвестный режим импорта.'] });
    if (!['merge', 'replace'].includes(writeMode)) return reportPayload({ ...baseReport, result: 'validation-error', errors: ['Неизвестный режим записи.'] });
    let parsed;
    try { parsed = JSON.parse(String(rawJson || '')); }
    catch (error) { return reportPayload({ ...baseReport, result: 'invalid-json', importType: scope, errors: [`JSON не читается: ${error.message}`] }); }

    let spec;
    try {
      if (scope === 'single' || scope === 'collection' || scope === 'page-bundle') collectionConfig(collection);
      spec = parseImportPayload({ collection, scope, currentSlug, parsed });
    } catch (error) {
      return reportPayload({ ...baseReport, result: 'validation-error', importType: scope, errors: [sanitizeError(error.message)] });
    }

    const affectedCollections = [...new Set(spec.groups.map((group) => group.collection))];
    const affectedSingletons = Object.keys(spec.singletonValues);
    const existing = new Map();
    for (const name of affectedCollections) existing.set(name, await listEntries(name));
    // Relation checks need current parents even when they are not directly imported.
    for (const name of ['product-sections', 'product-categories', 'products', 'static-pages', 'services']) {
      if (!existing.has(name)) existing.set(name, await listEntries(name));
    }
    const existingMaps = new Map([...existing].map(([name, entries]) => [name, new Map(entries.map((entry) => [entry.slug, entry]))]));
    const projected = new Map([...existingMaps].map(([name, entries]) => [name, new Map([...entries].map(([slug, entry]) => [slug, entry.content]))]));
    const candidates = [];
    const duplicateKeys = new Set();
    const seenKeys = new Set();

    for (const group of spec.groups) {
      const config = collectionConfig(group.collection);
      if (config.type === 'single-file' && group.items.length !== 1) {
        return reportPayload({ ...baseReport, importType: spec.importType, result: 'validation-error', affectedCollections, affectedSingletons, errors: [`${group.collection}: однофайловая коллекция должна содержать одну запись.`] });
      }
      group.items.forEach((rawIncoming, index) => {
        const sanitized = group.collection === 'projects' ? sanitizeProjectIncoming(rawIncoming) : { value: rawIncoming, warnings: [] };
        const incoming = sanitized.value;
        const slug = config.type === 'single-file' ? config.slug : cleanSlug(incoming?.slug);
        const key = `${group.collection}:${slug}`;
        if (seenKeys.has(key)) duplicateKeys.add(key);
        seenKeys.add(key);
        const current = existingMaps.get(group.collection)?.get(group.bindingSlug || slug);
        const next = current && writeMode === 'merge' ? mergeContent(current.content, incoming) : clone(incoming);
        candidates.push({ collection: group.collection, index, incoming, slug, bindingSlug: group.bindingSlug || '', current, next, key, importWarnings: sanitized.warnings });
        if (slug) {
          if (!projected.has(group.collection)) projected.set(group.collection, new Map());
          projected.get(group.collection).set(slug, next);
        }
      });
    }

    const rows = [];
    const writes = [];
    for (const candidate of candidates) {
      const { collection: name, incoming, slug, bindingSlug, current, next, key, index, importWarnings } = candidate;
      const row = { collection: name, index, slug: slug || '', title: incoming?.title || incoming?.companyName || '', currentTitle: current?.content?.title || current?.content?.companyName || '', action: 'skip', changed: [], added: [], removed: [], warnings: [], errors: [] };
      if (!isPlainObject(incoming)) row.errors.push('Запись должна быть объектом.');
      if (!slug) row.errors.push('slug отсутствует или имеет неправильный формат.');
      if (duplicateKeys.has(key)) row.errors.push('slug повторяется для этой коллекции в импортируемом файле.');
      if (bindingSlug && slug !== bindingSlug) row.errors.push(`slug должен совпадать с текущей записью: ${bindingSlug}.`);
      row.warnings.push(...(importWarnings || []));
      const schemaResult = contentSchemas[name].safeParse(next);
      const special = validateSpecialFields(name, next);
      row.errors.push(...zodMessages(schemaResult), ...special.errors);
      row.warnings.push(...special.warnings);
      const media = await mediaWarnings(next, publicRoot, fileSystem);
      row.errors.push(...media.errors);
      row.warnings.push(...media.warnings);

      if (name === 'product-categories' && next?.parentSectionSlug && !projected.get('product-sections')?.has(next.parentSectionSlug)) {
        row.errors.push(`parentSectionSlug: раздел ${next.parentSectionSlug} не найден.`);
      }
      if (name === 'products' && next?.productCategorySlug && !projected.get('product-categories')?.has(next.productCategorySlug)) {
        row.errors.push(`productCategorySlug: категория ${next.productCategorySlug} не найдена.`);
      }
      if (!row.errors.length) {
        const diff = current ? diffContent(current.content, next) : { changed: [], added: Object.keys(next), removed: [] };
        Object.assign(row, diff);
        row.action = current ? (diff.changed.length || diff.added.length || diff.removed.length ? 'update' : 'skip') : 'create';
        if (row.action !== 'skip') {
          writes.push({ collection: name, slug, filePath: current?.filePath || entryPath(name, slug), before: current?.raw ?? null, beforeHash: current ? hash(current.raw) : null, after: `${JSON.stringify(schemaResult.data, null, 2)}\n`, action: row.action });
        }
      }
      rows.push(row);
    }

    const routeOwners = new Map();
    for (const name of ROUTE_SLUG_COLLECTIONS) {
      for (const slug of projected.get(name)?.keys() || []) {
        if (name === 'static-pages' && slug === 'custom-order') continue;
        if (!routeOwners.has(slug)) routeOwners.set(slug, []);
        routeOwners.get(slug).push(name);
      }
    }
    for (const row of rows.filter((item) => ROUTE_SLUG_COLLECTIONS.has(item.collection) && item.slug)) {
      if (RESERVED_TOP_LEVEL_SLUGS.has(row.slug) && !(row.collection === 'static-pages' && row.slug === 'custom-order')) row.errors.push('slug занят системным маршрутом сайта.');
      const owners = routeOwners.get(row.slug) || [];
      if (new Set(owners).size > 1) row.errors.push(`slug уже занят в коллекции ${owners.find((name) => name !== row.collection)}.`);
    }

    for (const [name, incoming] of Object.entries(spec.singletonValues)) {
      const current = await readDataSingleton(name);
      const next = writeMode === 'merge' ? mergeContent(current.content, incoming) : clone(incoming);
      const row = { singleton: name, index: 0, slug: name, title: name, action: 'skip', changed: [], added: [], removed: [], warnings: [], errors: [] };
      if (!isPlainObject(incoming)) row.errors.push('Singleton должен быть объектом.');
      if (name === 'navigation') row.errors.push(...validateNavigation(next));
      if (name === 'yandex' && !isPlainObject(next)) row.errors.push('yandex: ожидается объект.');
      const sensitive = findSensitivePaths(next);
      if (sensitive.length) row.errors.push(`Запрещены секретные поля: ${sensitive.join(', ')}.`);
      const media = await mediaWarnings(next, publicRoot, fileSystem);
      row.errors.push(...media.errors);
      row.warnings.push(...media.warnings);
      if (!row.errors.length) {
        const diff = diffContent(current.content, next);
        Object.assign(row, diff);
        row.action = diff.changed.length || diff.added.length || diff.removed.length ? 'update' : 'skip';
        if (row.action !== 'skip') {
          const stored = name === 'navigation' ? next.items : next;
          writes.push({ singleton: name, slug: name, filePath: current.filePath, before: current.raw, beforeHash: hash(current.raw), after: `${JSON.stringify(stored, null, 2)}\n`, action: 'update' });
        }
      }
      rows.push(row);
    }

    const errors = rows.flatMap((row) => row.errors.map((message) => `${row.collection || row.singleton}/${row.slug || `#${row.index + 1}`}: ${message}`));
    const warnings = rows.flatMap((row) => row.warnings.map((message) => `${row.collection || row.singleton}/${row.slug || `#${row.index + 1}`}: ${message}`));
    const summary = reportPayload({
      ...baseReport, importType: spec.importType, result: errors.length ? 'validation-error' : 'ready', affectedCollections, affectedSingletons, warnings, errors,
      items: rows.map((row) => ({ collection: row.collection, singleton: row.singleton, slug: row.slug, action: row.action })),
      created: rows.filter((row) => row.action === 'create').length,
      updated: rows.filter((row) => row.action === 'update').length,
      skipped: rows.filter((row) => row.action === 'skip').length,
      files: writes.map((item) => relativePath(item.filePath))
    });
    if (errors.length) return { ...summary, rows, canApply: false };
    if (transactionService && writes.length) {
      const typedOperations = writes.map((write) => {
        const baseRevision = revisionForBytes(write.before === null ? null : Buffer.from(write.before, 'utf8'));
        const stored = JSON.parse(write.after);
        return write.singleton
          ? { type: 'upsert-singleton', singleton: write.singleton, value: stored, baseRevision }
          : { type: 'upsert-record', collection: write.collection, slug: write.slug, content: stored, baseRevision };
      });
      const transaction = await transactionService.preview({
        owner,
        sessionFingerprint,
        recoveryClientId,
        idempotencyKey,
        baseHead,
        metadata: {
          userSummary: `JSON-импорт: ${spec.importType}`,
          transactionKind: 'json-import',
          writeMode
        },
        operations: typedOperations
      });
      if (!transaction.canApply) {
        return {
          ...summary,
          result: 'validation-error',
          rows,
          canApply: false,
          blockers: transaction.blockers,
          warnings: [...warnings, ...(transaction.warnings || []).map((item) => item.message || String(item))],
          errors: (transaction.blockers || []).map((item) => item.message || item.userMessage || String(item))
        };
      }
      operations.set(transaction.transactionId, {
        owner,
        writeMode,
        createdAt: Date.now(),
        transaction: true,
        sessionFingerprint,
        recoveryClientId,
        idempotencyKey,
        payloadHash: transaction.payloadHash,
        summary
      });
      return {
        ...summary,
        rows,
        canApply: true,
        operationId: transaction.transactionId,
        transactionId: transaction.transactionId,
        payloadHash: transaction.payloadHash,
        affectedRoutes: transaction.affectedRoutes,
        diff: transaction.diff
      };
    }
    const operationId = crypto.randomUUID();
    operations.set(operationId, { owner, writeMode, createdAt: Date.now(), rows, writes, summary });
    return { ...summary, rows, canApply: writes.length > 0, operationId };
  }

  async function apply({
    owner,
    sessionFingerprint,
    recoveryClientId,
    idempotencyKey,
    operationId,
    replaceConfirmed = false
  }) {
    const operation = operations.get(operationId);
    if (!operation && transactionService && sessionFingerprint) {
      let prepared = null;
      try {
        prepared = await transactionService.getTransaction({ owner, sessionFingerprint, transactionId: operationId });
      } catch {
        // Preserve the compatibility response below for missing, expired, or foreign previews.
      }
      if (prepared?.metadata?.transactionKind === 'json-import') {
        if (prepared.metadata.writeMode === 'replace' && !replaceConfirmed) {
          return reportPayload({ result: 'error', errors: ['Для режима replace требуется явное подтверждение.'] });
        }
        const applied = await transactionService.apply({
          owner,
          sessionFingerprint,
          recoveryClientId,
          idempotencyKey,
          transactionId: operationId
        });
        return reportPayload({ result: applied.state === 'committed' ? 'success' : applied.state, errors: [] });
      }
    }
    if (operation?.transaction && transactionService) {
      if (operation.owner !== owner || Date.now() - operation.createdAt > operationTtlMs) {
        operations.delete(operationId);
        return reportPayload({ result: 'error', errors: ['Preview устарел или принадлежит другой сессии.'] });
      }
      if (operation.writeMode === 'replace' && !replaceConfirmed) {
        return reportPayload({ ...operation.summary, result: 'error', errors: ['Для режима replace требуется явное подтверждение.'] });
      }
      const applied = await transactionService.apply({
        owner,
        sessionFingerprint: sessionFingerprint || operation.sessionFingerprint,
        recoveryClientId: recoveryClientId || operation.recoveryClientId,
        idempotencyKey: idempotencyKey || operation.idempotencyKey,
        transactionId: operationId,
        payloadHash: operation.payloadHash
      });
      operations.delete(operationId);
      return reportPayload({
        ...operation.summary,
        result: applied.state === 'committed' ? 'success' : applied.state,
        errors: []
      });
    }
    if (!operation || operation.owner !== owner || Date.now() - operation.createdAt > operationTtlMs) {
      operations.delete(operationId);
      return reportPayload({ result: 'error', errors: ['Preview устарел или не принадлежит текущей сессии. Выполните проверку заново.'] });
    }
    if (operation.writeMode === 'replace' && !replaceConfirmed) return reportPayload({ ...operation.summary, result: 'error', errors: ['Для режима replace требуется явное подтверждение.'] });
    if (applying) return reportPayload({ ...operation.summary, result: 'error', errors: ['Другая операция импорта уже выполняется.'] });
    applying = true;
    const tempFiles = [];
    const applied = [];
    try {
      for (const write of operation.writes) {
        let current = null;
        try { current = await fileSystem.readFile(write.filePath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if ((current === null ? null : hash(current)) !== write.beforeHash) throw new Error(`Файл ${relativePath(write.filePath)} изменился после preview.`);
      }
      for (const write of operation.writes) {
        await fileSystem.mkdir(path.dirname(write.filePath), { recursive: true });
        const tempPath = `${write.filePath}.import-${crypto.randomUUID()}.tmp`;
        await fileSystem.writeFile(tempPath, write.after, 'utf8');
        tempFiles.push(tempPath);
      }
      for (let index = 0; index < operation.writes.length; index += 1) {
        const write = operation.writes[index];
        applied.push(write);
        await fileSystem.copyFile(tempFiles[index], write.filePath);
      }
      operations.delete(operationId);
      return reportPayload({
        ...operation.summary, result: 'success', errors: [],
        created: operation.writes.filter((item) => item.action === 'create').length,
        updated: operation.writes.filter((item) => item.action === 'update').length,
        skipped: operation.rows.filter((item) => item.action === 'skip').length
      });
    } catch (error) {
      operations.delete(operationId);
      const rollbackErrors = [];
      for (const write of applied.reverse()) {
        try {
          if (write.before === null) await fileSystem.unlink(write.filePath).catch((unlinkError) => { if (unlinkError.code !== 'ENOENT') throw unlinkError; });
          else await fileSystem.writeFile(write.filePath, write.before, 'utf8');
        } catch (rollbackError) { rollbackErrors.push(`${relativePath(write.filePath)}: ${rollbackError.message}`); }
      }
      return reportPayload({ ...operation.summary, result: 'rolled-back', errors: [sanitizeError(error.message), ...rollbackErrors.map((item) => `Ошибка отката: ${sanitizeError(item)}`)] });
    } finally {
      await Promise.all(tempFiles.map((tempPath) => fileSystem.unlink(tempPath).catch(() => {})));
      applying = false;
    }
  }

  return { exportSingle, exportCollection, exportFullSite, exportPage, preview, apply, buildReport, exportFilename };
}

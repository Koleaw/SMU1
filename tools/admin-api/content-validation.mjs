import { isDeepStrictEqual } from 'node:util';
import { z } from 'astro/zod';
import { contentSchemas } from '../../src/content-schemas.mjs';
import {
  COLLECTION_KEYS,
  SINGLETON_KEYS,
  getCollectionDefinition,
  getPageBlockPolicy,
  getSingletonDefinition
} from './content-registry.mjs';
import { URL_CONTEXTS, validateMediaPath, validateUrl } from './url-policy.mjs';

const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const VALIDATION_SEVERITIES = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning'
});

const navigationItemSchema = z.object({
  title: z.string().min(1),
  href: z.string().min(1),
  order: z.number().finite().optional(),
  isActive: z.boolean().optional()
}).passthrough();

const navigationSchema = z.object({
  items: z.array(navigationItemSchema)
}).passthrough();

const yandexSchema = z.object({
  metrika: z.object({
    counterId: z.number().int().positive(),
    scriptSrc: z.string().min(1),
    init: z.object({
      ssr: z.boolean().optional(),
      webvisor: z.boolean().optional(),
      clickmap: z.boolean().optional(),
      ecommerce: z.string().optional(),
      accurateTrackBounce: z.boolean().optional(),
      trackLinks: z.boolean().optional()
    }).passthrough()
  }).passthrough(),
  map: z.object({
    constructorSrc: z.string().min(1),
    height: z.number().int().min(1).max(4096)
  }).passthrough(),
  ratingBadge: z.object({
    src: z.string().min(1),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096)
  }).passthrough(),
  links: z.object({
    yandexMapsCompanyUrl: z.string().nullable(),
    yandexReviewUrl: z.string().nullable()
  }).passthrough()
}).passthrough();

const cardItemSchema = z.union([
  z.string().min(1),
  z.object({
    title: z.string().optional(),
    text: z.string().optional(),
    image: z.string().optional(),
    video: z.string().optional(),
    poster: z.string().optional(),
    src: z.string().optional(),
    url: z.string().optional(),
    placeholderLabel: z.string().optional(),
    buttonLabel: z.string().optional(),
    buttonHref: z.string().optional(),
    order: z.number().finite().optional(),
    isActive: z.boolean().optional()
  }).passthrough()
]);

const galleryItemSchema = z.union([
  z.string().min(1),
  z.object({
    title: z.string().optional(),
    text: z.string().optional(),
    image: z.string().optional(),
    video: z.string().optional(),
    poster: z.string().optional(),
    src: z.string().optional(),
    url: z.string().optional(),
    alt: z.string().optional(),
    caption: z.string().optional(),
    placeholderLabel: z.string().optional(),
    order: z.number().finite().optional(),
    isActive: z.boolean().optional()
  }).passthrough()
]);

const faqItemSchema = z.object({
  title: z.string().optional(),
  text: z.string().optional(),
  question: z.string().optional(),
  answer: z.string().optional(),
  order: z.number().finite().optional(),
  isActive: z.boolean().optional()
}).passthrough().superRefine((item, context) => {
  if (!(item.title?.trim() || item.question?.trim())) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'Укажите вопрос в title или question.' });
  }
  if (!(item.text?.trim() || item.answer?.trim())) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'Укажите ответ в text или answer.' });
  }
});

const textListItemSchema = z.union([
  z.string().min(1),
  z.object({
    title: z.string().optional(),
    text: z.string().optional(),
    order: z.number().finite().optional(),
    isActive: z.boolean().optional()
  }).passthrough().superRefine((item, context) => {
    if (!(item.text?.trim() || item.title?.trim())) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'Укажите текст строки.' });
    }
  })
]);

const processStepSchema = z.object({
  title: z.string(),
  text: z.string().optional(),
  order: z.number().finite(),
  isActive: z.boolean().optional()
}).passthrough();

const ITEM_SCHEMAS = Object.freeze({
  cards: cardItemSchema,
  gallery: galleryItemSchema,
  faq: faqItemSchema,
  'text-list': textListItemSchema,
  steps: processStepSchema
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function formatValidationPath(parts = []) {
  if (typeof parts === 'string') return parts;
  return parts.reduce((result, part) => {
    if (typeof part === 'number') return `${result}[${part}]`;
    return result ? `${result}.${String(part)}` : String(part);
  }, '');
}

export function createValidationIssue({
  code,
  collection = '',
  slug = '',
  path = '',
  message,
  userMessage = message,
  technicalDetail = '',
  severity = VALIDATION_SEVERITIES.ERROR
}) {
  const normalizedMessage = String(userMessage || 'Проверьте значение поля.');
  return Object.freeze({
    code: String(code || 'CONTENT_VALIDATION_ERROR'),
    collection: String(collection || ''),
    slug: String(slug || ''),
    path: formatValidationPath(path),
    severity,
    message: normalizedMessage,
    userMessage: normalizedMessage,
    technicalDetail: String(technicalDetail || '')
  });
}

function partitionIssues(issues) {
  return {
    errors: issues.filter((issue) => issue.severity === VALIDATION_SEVERITIES.ERROR),
    warnings: issues.filter((issue) => issue.severity === VALIDATION_SEVERITIES.WARNING)
  };
}

function validationResult({ data, storageValue, issues, metadata = {} }) {
  const { errors, warnings } = partitionIssues(issues);
  return Object.freeze({
    success: errors.length === 0,
    data,
    storageValue: storageValue ?? data,
    issues: Object.freeze(issues),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    ...metadata
  });
}

function zodIssues(result, context, code = 'CONTENT_SCHEMA_INVALID') {
  if (result.success) return [];
  return result.error.issues.map((issue) => createValidationIssue({
    ...context,
    code,
    path: issue.path,
    userMessage: context.collection === 'navigation'
      ? 'Проверьте поле пункта навигации.'
      : context.collection === 'yandex'
        ? 'Проверьте настройки Яндекса.'
        : 'Проверьте обязательные поля записи.',
    technicalDetail: `${issue.code} at ${formatValidationPath(issue.path) || '(root)'}: ${issue.message}`
  }));
}

function patternTokens(pattern) {
  return pattern.split('.').map((part) => ({
    key: part.endsWith('[]') ? part.slice(0, -2) : part,
    array: part.endsWith('[]')
  }));
}

function valuesAtPattern(root, pattern) {
  const found = [];
  const visit = (value, tokens, parts) => {
    if (!tokens.length) {
      found.push({ value, path: formatValidationPath(parts) });
      return;
    }
    if (!isPlainObject(value)) return;
    const [token, ...rest] = tokens;
    if (!Object.hasOwn(value, token.key)) return;
    const next = value[token.key];
    const nextParts = [...parts, token.key];
    if (token.array) {
      if (!Array.isArray(next)) return;
      next.forEach((item, index) => visit(item, rest, [...nextParts, index]));
      return;
    }
    visit(next, rest, nextParts);
  };
  visit(root, patternTokens(pattern), []);
  return found;
}

function legacyBlockAtPath(value, path) {
  const match = path.match(/^pageBlocks\[(\d+)\](?:\.|$)/u);
  if (!match) return null;
  const index = Number(match[1]);
  const block = value?.pageBlocks?.[index];
  const policy = getPageBlockPolicy(block?.type);
  return policy.known ? null : { index, block, policy };
}

function legacyValueSeverity(value, previous, path, operation) {
  const currentLegacy = legacyBlockAtPath(value, path);
  if (!currentLegacy) return VALIDATION_SEVERITIES.ERROR;
  if (operation === 'read' || operation === 'validate') return VALIDATION_SEVERITIES.WARNING;
  return previous && isDeepStrictEqual(previous, value)
    ? VALIDATION_SEVERITIES.WARNING
    : VALIDATION_SEVERITIES.ERROR;
}

function validateRegisteredUrls(value, definition, context) {
  const issues = [];
  for (const field of definition.urlFields ?? []) {
    for (const reference of valuesAtPattern(value, field.path)) {
      if (reference.value === null && field.nullable) continue;
      const checked = validateUrl(reference.value, {
        context: field.context ?? URL_CONTEXTS.LINK,
        allowEmpty: field.allowEmpty ?? false,
        allowedHosts: field.allowedHosts
      });
      if (!checked.ok) {
        const severity = legacyValueSeverity(value, context.previous, reference.path, context.operation);
        issues.push(createValidationIssue({
          ...context,
          code: checked.code,
          path: reference.path,
          userMessage: severity === VALIDATION_SEVERITIES.WARNING
            ? 'Legacy-ссылка сохранена без изменений, но её нужно исправить перед редактированием или публикацией.'
            : checked.message,
          technicalDetail: checked.technicalDetail,
          severity
        }));
      }
    }
  }
  return issues;
}

function validateRegisteredMedia(value, definition, context) {
  const issues = [];
  const visited = new Set();
  for (const pattern of definition.mediaFields ?? []) {
    for (const reference of valuesAtPattern(value, pattern)) {
      if (typeof reference.value !== 'string' || !reference.value || visited.has(reference.path)) continue;
      visited.add(reference.path);
      const checked = validateMediaPath(reference.value, { allowEmpty: true });
      if (!checked.ok) {
        const severity = legacyValueSeverity(value, context.previous, reference.path, context.operation);
        issues.push(createValidationIssue({
          ...context,
          code: checked.code,
          path: reference.path,
          userMessage: severity === VALIDATION_SEVERITIES.WARNING
            ? 'Legacy-медиа сохранено без изменений, но путь нужно исправить перед редактированием или публикацией.'
            : checked.message,
          technicalDetail: checked.technicalDetail,
          severity
        }));
      }
    }
  }
  return issues;
}

function legacyMutationIssue(block, previousBlock, index, context) {
  const policy = getPageBlockPolicy(block?.type);
  if (policy.known) return null;
  const unchanged = previousBlock !== undefined && isDeepStrictEqual(block, previousBlock);
  const mayPreserve = context.operation === 'read' || context.operation === 'validate' || unchanged;
  return createValidationIssue({
    ...context,
    code: mayPreserve ? 'PAGE_BLOCK_LEGACY_READ_ONLY' : 'PAGE_BLOCK_LEGACY_MUTATION_FORBIDDEN',
    path: `pageBlocks[${index}]`,
    userMessage: mayPreserve
      ? `Legacy-блок “${policy.type || 'без типа'}” сохранён без изменений и доступен только для чтения.`
      : `Нельзя создать или изменить неподдерживаемый legacy-блок “${policy.type || 'без типа'}”.`,
    technicalDetail: mayPreserve
      ? 'Unknown page block type is preserved as opaque read-only data.'
      : 'Unknown page block type is allowed only when byte-equivalent to the previous value at the same index.',
    severity: mayPreserve ? VALIDATION_SEVERITIES.WARNING : VALIDATION_SEVERITIES.ERROR
  });
}

function validatePageBlocks(value, context) {
  if (!Array.isArray(value?.pageBlocks)) return [];
  const issues = [];
  value.pageBlocks.forEach((block, blockIndex) => {
    const previousBlock = context.previous?.pageBlocks?.[blockIndex];
    const legacyIssue = legacyMutationIssue(block, previousBlock, blockIndex, context);
    if (legacyIssue) {
      issues.push(legacyIssue);
      return;
    }

    const policy = getPageBlockPolicy(block.type);
    if (policy.itemPolicy === 'none') {
      if (Array.isArray(block.items) && block.items.length) {
        issues.push(createValidationIssue({
          ...context,
          code: 'PAGE_BLOCK_ITEMS_UNUSED',
          path: `pageBlocks[${blockIndex}].items`,
          userMessage: 'Эти legacy-элементы сохранены, но выбранный тип блока их не использует.',
          technicalDetail: `${block.type} has no registered items contract; values are preserved as passthrough.`,
          severity: VALIDATION_SEVERITIES.WARNING
        }));
      }
      return;
    }

    const listName = policy.itemPolicy === 'steps' ? 'steps' : 'items';
    const items = block[listName];
    if (items === undefined) return;
    if (!Array.isArray(items)) {
      issues.push(createValidationIssue({
        ...context,
        code: 'PAGE_BLOCK_ITEMS_NOT_ARRAY',
        path: `pageBlocks[${blockIndex}].${listName}`,
        userMessage: 'Элементы блока должны быть списком.',
        technicalDetail: `${block.type}.${listName} must be an array.`
      }));
      return;
    }

    const schema = ITEM_SCHEMAS[policy.itemPolicy];
    items.forEach((item, itemIndex) => {
      const parsed = schema.safeParse(item);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push(createValidationIssue({
            ...context,
            code: 'PAGE_BLOCK_ITEM_INVALID',
            path: [`pageBlocks`, blockIndex, listName, itemIndex, ...issue.path],
            userMessage: 'Проверьте содержимое элемента блока.',
            technicalDetail: `${issue.code} for ${block.type}/${policy.itemPolicy}: ${issue.message}`
          }));
        }
      }
    });
  });
  return issues;
}

function normalizeContext(collection, slug, options) {
  return {
    collection,
    slug: String(slug || ''),
    operation: options.operation ?? 'validate',
    previous: options.previous
  };
}

export function validateContentRecord(input, maybeValue, maybeOptions = {}) {
  const request = typeof input === 'string'
    ? { collection: input, value: maybeValue, ...maybeOptions }
    : { ...input };
  const collection = request.collection;
  const value = request.value ?? request.content;
  const definition = getCollectionDefinition(collection);
  const requestedSlug = request.slug ?? value?.slug ?? definition?.fixedSlug ?? '';
  const context = normalizeContext(collection || '', requestedSlug, request);
  const issues = [];

  if (!definition || !contentSchemas[collection]) {
    issues.push(createValidationIssue({
      ...context,
      code: 'CONTENT_COLLECTION_UNKNOWN',
      userMessage: 'Эта коллекция не поддерживается.',
      technicalDetail: `No registry/schema entry for ${String(collection)}.`
    }));
    return validationResult({ data: undefined, issues, metadata: { collection, slug: context.slug } });
  }
  if (!isPlainObject(value)) {
    issues.push(createValidationIssue({
      ...context,
      code: 'CONTENT_RECORD_NOT_OBJECT',
      userMessage: 'Запись должна быть JSON-объектом.',
      technicalDetail: `Expected a plain object, received ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}.`
    }));
    return validationResult({ data: undefined, issues, metadata: { collection, slug: context.slug } });
  }

  const schemaResult = contentSchemas[collection].safeParse(value);
  issues.push(...zodIssues(schemaResult, context));
  const validatedValue = schemaResult.success ? schemaResult.data : value;

  if (definition.hasSlug) {
    const contentSlug = value.slug;
    if (typeof contentSlug === 'string' && (!SAFE_SLUG_RE.test(contentSlug) || contentSlug !== contentSlug.trim().toLowerCase())) {
      issues.push(createValidationIssue({
        ...context,
        code: 'CONTENT_SLUG_INVALID',
        path: 'slug',
        userMessage: 'Slug может содержать только строчные латинские буквы, цифры и дефисы.',
        technicalDetail: 'Slug must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ and already be normalized.'
      }));
    }
    if (request.slug && typeof contentSlug === 'string' && request.slug !== contentSlug) {
      issues.push(createValidationIssue({
        ...context,
        code: 'CONTENT_SLUG_MISMATCH',
        path: 'slug',
        userMessage: 'Slug в записи не совпадает с адресом редактируемой записи.',
        technicalDetail: 'Route/file binding slug differs from content.slug.'
      }));
    }
  }

  issues.push(...validateRegisteredUrls(validatedValue, definition, context));
  issues.push(...validateRegisteredMedia(validatedValue, definition, context));
  if (definition.supportsPageBlocks) issues.push(...validatePageBlocks(validatedValue, context));

  return validationResult({
    data: schemaResult.success ? schemaResult.data : undefined,
    issues,
    metadata: { collection, slug: context.slug }
  });
}

function singletonSchemaInput(singleton, value) {
  if (singleton === 'navigation' && Array.isArray(value)) return { items: value };
  return value;
}

export function validateSingleton(input, maybeValue, maybeOptions = {}) {
  const request = typeof input === 'string'
    ? { singleton: input, value: maybeValue, ...maybeOptions }
    : { ...input };
  const singleton = request.singleton ?? request.name;
  const value = request.value ?? request.content;
  const definition = getSingletonDefinition(singleton);
  const context = normalizeContext(singleton || '', singleton || '', request);
  const issues = [];

  if (!definition) {
    issues.push(createValidationIssue({
      ...context,
      code: 'CONTENT_SINGLETON_UNKNOWN',
      userMessage: 'Эта одиночная настройка не поддерживается.',
      technicalDetail: `No singleton registry entry for ${String(singleton)}.`
    }));
    return validationResult({ data: undefined, issues, metadata: { singleton } });
  }

  const schema = singleton === 'navigation' ? navigationSchema : yandexSchema;
  const schemaInput = singletonSchemaInput(singleton, value);
  const schemaResult = schema.safeParse(schemaInput);
  issues.push(...zodIssues(schemaResult, context, `${singleton.toUpperCase()}_SCHEMA_INVALID`));
  const validatedValue = schemaResult.success ? schemaResult.data : schemaInput;
  if (isPlainObject(validatedValue)) {
    issues.push(...validateRegisteredUrls(validatedValue, definition, context));
  }

  if (singleton === 'navigation' && Array.isArray(validatedValue?.items)) {
    const seen = new Map();
    validatedValue.items.forEach((item, index) => {
      if (typeof item?.href !== 'string' || !item.href) return;
      if (seen.has(item.href)) {
        issues.push(createValidationIssue({
          ...context,
          code: 'NAVIGATION_DUPLICATE_HREF',
          path: `items[${index}].href`,
          userMessage: 'В навигации повторяется одна и та же ссылка.',
          technicalDetail: `Duplicate of items[${seen.get(item.href)}].href.`,
          severity: VALIDATION_SEVERITIES.WARNING
        }));
      } else {
        seen.set(item.href, index);
      }
    });
  }

  const parsedData = schemaResult.success
    ? singleton === 'navigation' && Array.isArray(value)
      ? schemaResult.data.items
      : schemaResult.data
    : undefined;
  const storageValue = schemaResult.success
    ? singleton === 'navigation' ? schemaResult.data.items : schemaResult.data
    : undefined;
  return validationResult({ data: parsedData, storageValue, issues, metadata: { singleton, slug: singleton } });
}

export function validateMutationSet({ records = [], singletons = [] } = {}) {
  const recordInputs = Array.isArray(records) ? records : [];
  const singletonInputs = Array.isArray(singletons)
    ? singletons
    : Object.entries(singletons ?? {}).map(([singleton, value]) => ({ singleton, value }));
  const recordResults = recordInputs.map((record) => validateContentRecord(record));
  const singletonResults = singletonInputs.map((singleton) => validateSingleton(singleton));
  const issues = [...recordResults, ...singletonResults].flatMap((entry) => entry.issues);
  const { errors, warnings } = partitionIssues(issues);
  return Object.freeze({
    success: errors.length === 0,
    recordResults: Object.freeze(recordResults),
    singletonResults: Object.freeze(singletonResults),
    issues: Object.freeze(issues),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings)
  });
}

export class ContentValidationError extends Error {
  constructor(issues, message = 'Данные не прошли проверку. Исправьте отмеченные поля.') {
    const normalizedIssues = Array.isArray(issues) ? issues : [];
    super(message);
    this.name = 'ContentValidationError';
    this.code = 'CONTENT_VALIDATION_FAILED';
    this.validationIssues = normalizedIssues;
  }

  toJSON() {
    return {
      code: this.code,
      error: this.message,
      validationIssues: this.validationIssues
    };
  }
}

export function assertValidContentRecord(...args) {
  const checked = validateContentRecord(...args);
  if (!checked.success) throw new ContentValidationError(checked.errors);
  return checked.data;
}

export function assertValidSingleton(...args) {
  const checked = validateSingleton(...args);
  if (!checked.success) throw new ContentValidationError(checked.errors);
  return checked.storageValue;
}

export function assertValidMutationSet(input) {
  const checked = validateMutationSet(input);
  if (!checked.success) throw new ContentValidationError(checked.errors);
  return checked;
}

export function assertSchemaRegistryComplete() {
  const schemaKeys = Object.keys(contentSchemas).sort();
  const registryKeys = [...COLLECTION_KEYS].sort();
  const missingSchemas = registryKeys.filter((key) => !schemaKeys.includes(key));
  const unknownSchemas = schemaKeys.filter((key) => !registryKeys.includes(key));
  if (missingSchemas.length || unknownSchemas.length || SINGLETON_KEYS.length !== 2) {
    const error = new Error(`Schema registry mismatch; missing=${missingSchemas.join(',')}; unknown=${unknownSchemas.join(',')}.`);
    error.code = 'CONTENT_SCHEMA_REGISTRY_MISMATCH';
    throw error;
  }
  return true;
}

import {
  CONTENT_COMPLETENESS_POLICIES,
  resolvePageBlockTemplateFamily
} from './content-coverage-registry.mjs';

const APPROVED_TOP_LEVEL_RENDERERS = Object.freeze({
  'product-sections': new Set(['ulichnaya-mebel', 'navesy-i-kozyrki', 'topiarii', 'ograzhdeniya-i-zabory']),
  services: new Set(['metallokonstruktsii-dlya-biznesa', 'blagoustroystvo-territoriy', 'stroitelstvo-i-remonty']),
  'static-pages': new Set(['home', 'custom-order', 'vypolnennye-obekty', 'o-nas'])
});

function atPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function blank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function publicEnabled(collection, value) {
  if (collection === 'site-settings') return true;
  if (collection === 'static-pages') return value?.isActive !== false;
  return value?.isActive === true;
}

function issue(collection, slug, path, code, userMessage) {
  return Object.freeze({
    code,
    collection,
    slug,
    path,
    severity: 'error',
    message: userMessage,
    userMessage,
    technicalDetail: `${collection}:${slug}:${path}:${code}`
  });
}

function collectionRecords(corpus, collection) {
  if (Array.isArray(corpus?.collectionValues?.[collection])) return corpus.collectionValues[collection];
  if (corpus?.entries instanceof Map) {
    return [...corpus.entries.values()]
      .filter((entry) => entry.collection === collection)
      .map((entry) => entry.content);
  }
  return [];
}

function hasMedia(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMedia);
  if (value && typeof value === 'object') return hasMedia(value.src) || hasMedia(value.image);
  return false;
}

export function assessPublicCompleteness({ collection, slug, value, corpus } = {}) {
  const policy = CONTENT_COMPLETENESS_POLICIES[collection];
  if (!policy?.blocksPublic || !publicEnabled(collection, value)) {
    return Object.freeze({ enabled: false, complete: true, issues: Object.freeze([]) });
  }
  const issues = [];
  const rendererSet = APPROVED_TOP_LEVEL_RENDERERS[collection];
  if (rendererSet && !rendererSet.has(value?.slug || slug)) {
    issues.push(issue(collection, slug, 'slug', 'PUBLIC_RENDERER_UNAPPROVED', 'Для этого адреса ещё нет утверждённого публичного шаблона. Оставьте запись скрытой и обратитесь к разработчику.'));
  }

  const required = new Set(policy.blocksPublic.requiredFields || []);
  const templateFamily = resolvePageBlockTemplateFamily(collection, value || {});
  for (const field of policy.blocksPublic.byTemplate?.[templateFamily] || []) required.add(field);
  for (const path of required) {
    if (blank(atPath(value, path))) {
      issues.push(issue(collection, slug, path, 'PUBLIC_REQUIRED_FIELD_EMPTY', `Перед показом на сайте заполните поле «${path}».`));
    }
  }

  for (const rule of policy.blocksPublic.rules || []) {
    if (rule.kind === 'media-path' && !hasMedia(atPath(value, rule.path))) {
      issues.push(issue(collection, slug, rule.path, 'PUBLIC_MEDIA_REQUIRED', 'Перед показом на сайте добавьте основное изображение.'));
    } else if (rule.kind === 'at-least-one-media' && !rule.paths.some((path) => hasMedia(atPath(value, path)))) {
      issues.push(issue(collection, slug, rule.paths[0], 'PUBLIC_MEDIA_REQUIRED', 'Перед показом на сайте добавьте хотя бы одну фотографию.'));
    } else if (rule.kind === 'non-empty-list' && blank(atPath(value, rule.path))) {
      issues.push(issue(collection, slug, rule.path, 'PUBLIC_LIST_REQUIRED', `Перед показом на сайте заполните список «${rule.path}».`));
    } else if (rule.kind === 'relation-exists-and-public') {
      const targetSlug = atPath(value, rule.path);
      const target = collectionRecords(corpus, rule.target).find((entry) => entry?.slug === targetSlug);
      if (!target || target.isActive !== true) {
        issues.push(issue(collection, slug, rule.path, 'PUBLIC_PARENT_NOT_VISIBLE', 'Связанная родительская запись должна существовать и быть доступна на сайте.'));
      }
    }
  }
  return Object.freeze({ enabled: true, complete: issues.length === 0, issues: Object.freeze(issues) });
}

export function validateProjectedPublicCompleteness(corpus) {
  const issues = [];
  for (const entry of corpus?.entries?.values?.() || []) {
    issues.push(...assessPublicCompleteness({
      collection: entry.collection,
      slug: entry.slug,
      value: entry.content,
      corpus
    }).issues);
  }
  return Object.freeze(issues);
}

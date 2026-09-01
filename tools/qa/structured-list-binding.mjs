import { getAtPath } from '../../src/admin/state/history-store.mjs';

const FIELD_PATH_RE = /^[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*$/u;
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const safeFieldPath = (value) => FIELD_PATH_RE.test(value)
  && value.split('.').every((part) => !FORBIDDEN_PATH_PARTS.has(part));
const FIELD_TOOLS = new Set([
  'short-text', 'long-text', 'link', 'media', 'list',
  'generated-id', 'generated-order', 'visibility', 'computed'
]);
const TEXT_TOOLS = new Set(['short-text', 'long-text', 'link']);

const clean = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();

function fieldContractIssues(fields, prefix = 'itemFields') {
  if (!Array.isArray(fields) || fields.length === 0) return [`${prefix}:missing`];
  const issues = [];
  const paths = new Set();
  fields.forEach((field, index) => {
    const location = `${prefix}[${index}]`;
    if (!field || typeof field !== 'object') {
      issues.push(`${location}:invalid`);
      return;
    }
    const fieldPath = String(field.fieldPath || '');
    const tool = String(field.tool || 'short-text');
    if (!safeFieldPath(fieldPath)) issues.push(`${location}:fieldPath`);
    if (paths.has(fieldPath)) issues.push(`${location}:duplicate:${fieldPath}`);
    paths.add(fieldPath);
    if (!FIELD_TOOLS.has(tool)) issues.push(`${location}:tool:${tool || 'missing'}`);
    if (tool === 'computed' && !clean(field.formula)) issues.push(`${location}:formula`);
    if (tool === 'media' && !clean(field.role)) issues.push(`${location}:media-role`);
    if (tool === 'list' && field.itemKind === 'object') {
      issues.push(...fieldContractIssues(field.itemFields, `${location}.itemFields`));
    }
  });
  return issues;
}

function selectedItems(binding, sourceRecord) {
  const value = getAtPath(sourceRecord, binding.fieldPath);
  if (!Array.isArray(value)) return { items: [], issue: 'object-list-source-not-array' };
  const stableItemId = String(binding.stableItemId || '');
  const selectedIndex = value.findIndex((item) => item && typeof item === 'object' && String(item.id || '') === stableItemId);
  return {
    items: selectedIndex >= 0 ? [{ value: value[selectedIndex], index: selectedIndex }] : value.map((item, index) => ({ value: item, index })),
    issue: ''
  };
}

function projectedText(item, fields, itemIndex) {
  const values = [];
  for (const field of fields) {
    const tool = String(field.tool || 'short-text');
    if (tool === 'computed') {
      if (field.fieldPath === 'ordinal') {
        values.push(String(itemIndex + 1), String(itemIndex + 1).padStart(2, '0'));
      }
      continue;
    }
    if (tool === 'list') {
      const nested = getAtPath(item, field.fieldPath);
      if (Array.isArray(nested) && field.itemKind === 'object') {
        nested.forEach((nestedItem, nestedIndex) => values.push(...projectedText(nestedItem, field.itemFields || [], nestedIndex)));
      } else if (Array.isArray(nested)) {
        values.push(...nested.map(clean).filter(Boolean));
      }
      continue;
    }
    if (!TEXT_TOOLS.has(tool)) continue;
    const raw = getAtPath(item, field.fieldPath);
    const normalized = clean(raw);
    if (!normalized) continue;
    values.push(normalized);
    if (typeof raw === 'string' && /[\r\n]/u.test(raw)) {
      values.push(...raw.split(/\r?\n+/u).map(clean).filter(Boolean));
    }
  }
  return values;
}

function hasProjectedMedia(item, fields) {
  return fields.some((field) => {
    if (field.tool === 'media') return Boolean(clean(getAtPath(item, field.fieldPath)));
    if (field.tool !== 'list' || field.itemKind !== 'object') return false;
    const nested = getAtPath(item, field.fieldPath);
    return Array.isArray(nested) && nested.some((nestedItem) => hasProjectedMedia(nestedItem, field.itemFields || []));
  });
}

const itemRequiresStableId = (fields) => fields.some((field) => field?.fieldPath === 'id' && field?.tool === 'generated-id');

function markerContractIssues(items, fields, domItems, prefix = 'items') {
  const issues = [];
  const requiresStableId = itemRequiresStableId(fields);
  const sourceIds = new Set();
  items.forEach(({ value: item, index }, occurrenceIndex) => {
    if (!item || typeof item !== 'object') return;
    const rawId = clean(item.id);
    if (requiresStableId && !rawId) issues.push(`object-list-item-id-missing:${prefix}[${index}]`);
    if (rawId && sourceIds.has(rawId)) issues.push(`object-list-item-id-duplicate:${rawId}`);
    if (rawId) sourceIds.add(rawId);
    const markerId = rawId || String(index);
    const matches = domItems.filter((entry) => clean(entry?.id) === markerId);
    if (!matches.length) {
      issues.push(`object-list-item-marker-missing:${markerId}`);
      return;
    }
    const markerFields = new Set(matches.flatMap((entry) => Array.isArray(entry?.fields) ? entry.fields : []));
    for (const field of fields) {
      const tool = String(field?.tool || 'short-text');
      if (['generated-id', 'generated-order', 'visibility'].includes(tool)) continue;
      if (!markerFields.has(field.fieldPath)) {
        issues.push(`object-list-phantom-field:${prefix}[${occurrenceIndex}].${field.fieldPath}`);
        continue;
      }
      if (tool !== 'list' || field.itemKind !== 'object') continue;
      const nested = getAtPath(item, field.fieldPath);
      if (!Array.isArray(nested)) continue;
      const nestedItems = nested.map((value, nestedIndex) => ({ value, index: nestedIndex }));
      issues.push(...markerContractIssues(nestedItems, field.itemFields || [], domItems, `${prefix}[${occurrenceIndex}].${field.fieldPath}`));
    }
  });
  return issues;
}

export function objectListBindingSupportsMedia(binding) {
  const visit = (fields) => (Array.isArray(fields) ? fields : []).some((field) => field?.tool === 'media'
    || (field?.tool === 'list' && field.itemKind === 'object' && visit(field.itemFields)));
  return binding?.tool === 'list' && binding?.itemKind === 'object' && visit(binding.itemFields);
}

/**
 * A container binding may cover child copy only when its object-list contract
 * can project every text/media occurrence owned by that exact DOM node. This
 * prevents one generic wrapper from making uneditable descendants look green.
 */
export function structuredObjectListBindingIssues(binding, sourceRecord) {
  if (binding?.tool !== 'list' || binding?.itemKind !== 'object') return [];
  const issues = fieldContractIssues(binding.itemFields);
  if (!sourceRecord) return issues;
  const selected = selectedItems(binding, sourceRecord);
  if (selected.issue) return [...issues, selected.issue];

  issues.push(...markerContractIssues(
    selected.items,
    binding.itemFields || [],
    Array.isArray(binding.domTarget?.ownedListItems) ? binding.domTarget.ownedListItems : []
  ));

  const projected = selected.items.flatMap(({ value, index }) => value && typeof value === 'object'
    ? projectedText(value, binding.itemFields || [], index)
    : []);
  const remaining = [...projected];
  for (const actual of binding.domTarget?.ownedBusinessText || []) {
    const normalized = clean(actual);
    const match = remaining.indexOf(normalized);
    if (match < 0) issues.push(`object-list-unmapped-text:${normalized.slice(0, 80) || 'blank'}`);
    else remaining.splice(match, 1);
  }

  if (Number(binding.domTarget?.ownedMedia || 0) > 0
    && !selected.items.some(({ value }) => value && typeof value === 'object' && hasProjectedMedia(value, binding.itemFields || []))) {
    issues.push('object-list-unmapped-media');
  }
  return [...new Set(issues)];
}

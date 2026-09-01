type BindingScope = 'local' | 'shared' | 'global' | 'legal' | 'derived';

export type AdminEditorDispositionKind =
  | 'computed'
  | 'contextual'
  | 'derived'
  | 'global'
  | 'legal'
  | 'template-fixed';

export type AdminEditorDispositionDefinition = {
  kind: AdminEditorDispositionKind;
  /** Human explanation shown when this occurrence cannot be edited in-place. */
  reason: string;
  /** Exact schema field, renderer module, or formula that owns the occurrence. */
  source: string;
  /** Optional contextual tool that can edit the source safely. */
  tool?: string;
};

export type AdminListItemFieldDefinition = {
  /** Relative path inside one structured list item. */
  fieldPath: string;
  label?: string;
  /**
   * Scalar tools are rendered in the contextual inspector. `list` may carry
   * another explicit item contract. Generated fields are never exposed as
   * free text and exist only to create a schema-valid fresh item.
   */
  tool?: 'short-text' | 'long-text' | 'link' | 'media' | 'list' | 'generated-id' | 'generated-order' | 'visibility' | 'computed';
  itemKind?: 'string' | 'object';
  itemFields?: AdminListItemFieldDefinition[];
  role?: string;
  formula?: string;
  defaultValue?: unknown;
};

export type AdminBindingDefinition = {
  renderer: { family: string; variant?: string; version?: string };
  owner: { collection: string; slug: string };
  fieldPath: string;
  stableItemId?: string;
  role?: string;
  scope?: BindingScope;
  projection?: { kind?: string; formula?: string; target?: string; fallback?: string };
  tool?: string;
  label?: string;
  affectedRoutes?: string[];
  permissions?: { edit?: boolean; reorder?: boolean; delete?: boolean };
  validation?: Record<string, unknown>;
  zoneId?: string;
  parentSlug?: string;
  multiple?: boolean;
  itemKind?: 'string' | 'object';
  /** Fail-closed field contract for object-list contextual editing. */
  itemFields?: AdminListItemFieldDefinition[];
  coverPath?: string;
  heroPath?: string;
  archivePath?: string;
  modePath?: string;
  valuePath?: string;
  currencyPath?: string;
  hrefPath?: string;
  /** Exact collection owning the selectable relation target. */
  relationCollection?: string;
  /** Exact collections owning targets in an ordered relation list. */
  relationCollections?: string[];
  /** Safe live projection for a visible media occurrence borrowed through a relation. */
  relationProjection?: {
    mediaBindingId: string;
    mediaFieldPaths: string[];
    positionFields?: Array<{ fieldPath: string; cssProperty: string }>;
    applySourcePosition?: boolean;
    strategy?: 'gateway-frame';
    frameOffset?: number;
    excludedMediaPaths?: string[];
  };
};

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LIST_FIELD_RE = /^[A-Za-z_$][\w$-]*(?:\[\])?(?:\.[A-Za-z_$][\w$-]*(?:\[\])?)*$/u;
const FORBIDDEN_LIST_FIELD_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

export function isLocalAdminCanvas(url: URL) {
  // This value is compiled by astro.config.mjs from the conjunction of the
  // development deploy target and the explicit local-admin flag. Depending on
  // import.meta.env.DEV here made server-rendered Astro modules disagree with
  // Vite-transformed component modules in development and silently removed all
  // bindings from the real canvas.
  return import.meta.env.SMU1_LOCAL_ADMIN === 'true'
    && url.searchParams.get('__smu1_editor') === '1'
    && SESSION_RE.test(url.searchParams.get('editorSession') || '')
    && /^\d{1,12}$/u.test(url.searchParams.get('editorRevision') || '');
}

/** Admin-only structural markers used by the live list projector. */
export function adminListItem(url: URL, stableItemId: string): Record<string, string> {
  if (!isLocalAdminCanvas(url)) return {};
  const value = String(stableItemId || '').trim();
  if (!value) throw new TypeError('Admin list item marker requires a stable item id.');
  return { 'data-smu1-list-item': value };
}

export function adminListField(url: URL, fieldPath: string): Record<string, string> {
  if (!isLocalAdminCanvas(url)) return {};
  const value = String(fieldPath || '').trim();
  if (!LIST_FIELD_RE.test(value) || value.split('.').some((part) => FORBIDDEN_LIST_FIELD_PARTS.has(part.replace(/\[\]$/u, '')))) {
    throw new TypeError('Admin list field marker requires a safe relative field path.');
  }
  return { 'data-smu1-list-field': value };
}

export function adminListValue(url: URL): Record<string, string> {
  return isLocalAdminCanvas(url) ? { 'data-smu1-list-value': 'true' } : {};
}

function stableHash(value: string) {
  const hash = (seed: number) => {
    let result = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 0x01000193) >>> 0;
    }
    return result.toString(16).padStart(8, '0');
  };
  return `${hash(0x811c9dc5)}${hash(0x9e3779b9)}`;
}

export function stableBindingId(url: URL, definition: AdminBindingDefinition) {
  const owner = `${definition.owner.collection}:${definition.owner.slug}`;
  const occurrence = definition.stableItemId || definition.role || 'value';
  const renderer = `${definition.renderer.family}:${definition.renderer.variant || 'default'}:${definition.renderer.version || 'h6-v1'}`;
  const normalized = `${url.pathname}:${renderer}:${owner}:${definition.fieldPath}:${definition.role || 'content'}:${occurrence}`
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9а-яё._:-]+/giu, '-');
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 220)}-${stableHash(normalized)}`;
}

export function adminBinding(url: URL, definition: AdminBindingDefinition): Record<string, string> {
  if (!isLocalAdminCanvas(url)) return {};
  const bindingId = stableBindingId(url, definition);
  const binding = {
    bindingId,
    route: url.pathname,
    renderer: { version: 'h6-v1', ...definition.renderer },
    owner: definition.owner,
    ownerCollection: definition.owner.collection,
    recordSlug: definition.owner.slug,
    fieldPath: definition.fieldPath,
    stableItemId: definition.stableItemId || definition.owner.slug,
    role: definition.role || 'content',
    scope: definition.scope || 'local',
    projection: { kind: 'direct', ...definition.projection },
    tool: definition.tool || 'long-text',
    label: definition.label || '',
    affectedRoutes: [...new Set(definition.affectedRoutes || [])],
    permissions: { edit: true, reorder: false, delete: false, ...definition.permissions },
    validation: definition.validation || {},
    currentDraftRevision: Number(url.searchParams.get('editorRevision') || 0),
    ...(definition.zoneId ? { zoneId: definition.zoneId } : {}),
    ...(definition.parentSlug ? { parentSlug: definition.parentSlug } : {}),
    ...(definition.multiple !== undefined ? { multiple: definition.multiple } : {}),
    ...(definition.itemKind ? { itemKind: definition.itemKind } : {}),
    ...(definition.itemFields?.length ? { itemFields: structuredClone(definition.itemFields) } : {}),
    ...(definition.coverPath ? { coverPath: definition.coverPath } : {}),
    ...(definition.heroPath ? { heroPath: definition.heroPath } : {}),
    ...(definition.archivePath ? { archivePath: definition.archivePath } : {}),
    ...(definition.modePath ? { modePath: definition.modePath } : {}),
    ...(definition.valuePath ? { valuePath: definition.valuePath } : {}),
    ...(definition.currencyPath ? { currencyPath: definition.currencyPath } : {}),
    ...(definition.hrefPath ? { hrefPath: definition.hrefPath } : {}),
    ...(definition.relationCollection ? { relationCollection: definition.relationCollection } : {}),
    ...(definition.relationCollections?.length
      ? { relationCollections: [...new Set(definition.relationCollections)] }
      : {}),
    ...(definition.relationProjection?.mediaBindingId && definition.relationProjection.mediaFieldPaths?.length
      ? {
          relationProjection: {
            mediaBindingId: definition.relationProjection.mediaBindingId,
            mediaFieldPaths: [...new Set(definition.relationProjection.mediaFieldPaths)],
            positionFields: (definition.relationProjection.positionFields || []).map((item) => ({
              fieldPath: item.fieldPath,
              cssProperty: item.cssProperty
            })),
            applySourcePosition: definition.relationProjection.applySourcePosition === true,
            ...(definition.relationProjection.strategy ? { strategy: definition.relationProjection.strategy } : {}),
            ...(Number.isSafeInteger(definition.relationProjection.frameOffset)
              ? { frameOffset: definition.relationProjection.frameOffset }
              : {}),
            ...(definition.relationProjection.excludedMediaPaths?.length
              ? { excludedMediaPaths: [...new Set(definition.relationProjection.excludedMediaPaths)] }
              : {})
          }
        }
      : {})
  };
  return {
    'data-smu1-binding-id': bindingId,
    'data-smu1-binding': JSON.stringify(binding)
  };
}

/**
 * Declares the provenance of a deliberately non-direct occurrence in the local
 * production canvas. Like adminBinding(), this is compiled out of every normal
 * preview/production render by the explicit local-admin gate.
 *
 * Keep the attribute on the smallest semantic element that owns the value. A
 * page/root wrapper would make the route passport look complete while hiding
 * missing editor tools, so blank declarations fail fast in local development.
 */
export function adminDisposition(
  url: URL,
  definition: AdminEditorDispositionDefinition
): Record<string, string> {
  if (!isLocalAdminCanvas(url)) return {};

  const reason = definition.reason.trim();
  const source = definition.source.trim();
  const tool = definition.tool?.trim() || '';
  if (!reason || !source) {
    throw new TypeError('Admin editor dispositions require a non-empty reason and source.');
  }

  return {
    'data-smu1-editor-disposition': definition.kind,
    'data-smu1-editor-reason': reason,
    'data-smu1-editor-source': source,
    ...(tool ? { 'data-smu1-editor-tool': tool } : {})
  };
}

export const ADMIN_EDITOR_SESSION_PATTERN_SOURCE = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const ADMIN_EDITOR_REVISION_PATTERN_SOURCE = '^\\d{1,12}$';

const sessionPattern = new RegExp(ADMIN_EDITOR_SESSION_PATTERN_SOURCE, 'iu');
const revisionPattern = new RegExp(ADMIN_EDITOR_REVISION_PATTERN_SOURCE, 'u');

export function hasAdminEditorSessionShape(value) {
  return sessionPattern.test(String(value || ''));
}

export function hasAdminEditorRevisionShape(value) {
  return revisionPattern.test(String(value || ''));
}

export function isAdminHomeCanvasReady(snapshot) {
  return Boolean(
    snapshot?.ready
    && snapshot.locationOriginPath
    && snapshot.logicalRoute === '/'
    && snapshot.editorMode === '1'
    && snapshot.editorSessionShape
    && snapshot.editorRevisionShape
    && Array.isArray(snapshot.h1)
    && snapshot.h1.length === 1
    && Number(snapshot.bindings) > 0
    && Number(snapshot.interactions) > 0
    && Number(snapshot.overlays) > 0
  );
}

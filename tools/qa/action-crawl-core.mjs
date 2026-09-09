const CONTACT_PROTOCOL = /^(?:tel:|mailto:|sms:|tg:)/iu;
const EXTERNAL_PROTOCOL = /^(?:https?:)?\/\//iu;
const UNSAFE_LABEL = /(?:отправ|заказ|заяв|расч[её]т|сохран|удал|опубли|восстанов|откат|импорт|загруз|выйти|отменить|повторить|undo|redo|дублир|скрыть|перемест|добав|измен|примен|выше|ниже|в начало|в конец|перетащ|убрать)/iu;
const PUBLIC_SUBMISSION_LABEL = /(?:отправ|заказ|заяв|расч[её]т|submit|send)/iu;
const RELEASE_LABEL = /(?:опубли|публикац|production|preview|основн(?:ой|ого) сайт|rollback|откат)/iu;
const SAFE_ADMIN_IDS = new Set([
  'veNavigatorToggle', 'veBack', 'veForward', 'vePagePicker', 'vePreviousMaterial', 'veNextMaterial',
  'veStatus', 'vePageSettings', 'vePublish', 'veCommandOpen', 'veGlobalSettings', 'veRefreshCanvas',
  'veFullScreen', 'veFooterSettings', 'veInspectorClose', 'veInspectorDone', 'veChangesToggle'
]);
const SAFE_ADMIN_DATA_ACTIONS = new Set([
  'data-viewport', 'data-mode', 'data-filter', 'data-settings-tab', 'data-dialog-close', 'data-binding-id', 'data-route'
]);
const SAFE_ADMIN_CONTAINERS = new Set([
  'veBreadcrumbs', 'vePageTree', 'veRecentList', 'veFavoritesList', 'vePageDialogResults', 'veCommandResults'
]);

export function classifyPublicAction(action) {
  if (action.disabled) return { policy: 'disabled-state', execute: false };
  if (!action.visible) return { policy: 'hidden-state', execute: false };
  if ((action.dataActions || []).includes('data-public-search-control')) {
    return { policy: 'public-search-semantic-coverage', execute: false };
  }
  if (action.tag === 'a') {
    if ((action.dataActions || []).includes('data-v2-entry-skip-link') || /^К основному содержанию$/iu.test(String(action.name || '').trim())) {
      return { policy: 'keyboard-focus-action', execute: true, modes: ['keyboard-enter'] };
    }
    const href = String(action.href || '').trim();
    if (!href) return { policy: 'invalid-link', execute: false };
    if (action.download || String(action.target || '').toLowerCase() === '_blank') {
      return { policy: 'new-context-or-download-no-launch', execute: false };
    }
    if (href.startsWith('#') || href.startsWith('/') || /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/iu.test(href)) {
      return { policy: 'internal-link-action', execute: true };
    }
    if (CONTACT_PROTOCOL.test(href)) return { policy: 'contact-protocol-format', execute: false };
    if (EXTERNAL_PROTOCOL.test(href)) return { policy: 'external-link-no-launch', execute: false };
    return { policy: 'relative-route-coverage', execute: false };
  }
  if (action.inForm || PUBLIC_SUBMISSION_LABEL.test(String(action.name || ''))) {
    return { policy: 'protected-form-action', execute: false };
  }
  if (action.tag === 'input' && ['submit', 'image', 'file'].includes(String(action.type || '').toLowerCase())) {
    return { policy: 'protected-form-action', execute: false };
  }
  if (action.tag === 'button' && String(action.type || '').toLowerCase() === 'submit') {
    return { policy: 'protected-form-action', execute: false };
  }
  if (action.tag === 'video') return { policy: 'native-media-control', execute: false };
  if (['button', 'summary'].includes(action.tag) || action.role === 'button') return { policy: 'safe-ui-action', execute: true };
  return { policy: 'focus-state', execute: false };
}

export function classifyAdminAction(action, { isolatedMutations = false } = {}) {
  if (action.disabled) return { policy: 'disabled-state', execute: false };
  if (!action.visible) return { policy: 'hidden-state', execute: false };
  if (String(action.context || '').startsWith('iframe-')) return { policy: 'canvas-public-action-covered', execute: false };
  const label = `${action.name || ''} ${action.dataActions?.join(' ') || ''} ${Object.entries(action.dataAttributes || {}).map(([name, value]) => `${name}=${value}`).join(' ')}`;
  if (action.domId === 'vePublish' || /^публикация$/iu.test(String(action.name || '').trim())) {
    return { policy: 'safe-ui-action', execute: true };
  }
  if (RELEASE_LABEL.test(label)) return { policy: 'release-intercept-required', execute: false };
  if (action.tag === 'input' && String(action.type || '').toLowerCase() === 'file') {
    return { policy: 'requires-file-fixture', execute: false };
  }
  if (action.classes?.includes('ve-tree-item__favorite')) return { policy: 'safe-ui-action', execute: true };
  if ((action.dataActions || []).includes('data-route') || action.role === 'treeitem') {
    return { policy: 'navigation-inventory', execute: false };
  }
  const safeDataAction = (action.dataActions || []).some((item) => SAFE_ADMIN_DATA_ACTIONS.has(item) && item !== 'data-route');
  if (safeDataAction) return { policy: 'safe-ui-action', execute: true };
  if (UNSAFE_LABEL.test(label) || action.type === 'submit') {
    return isolatedMutations
      ? { policy: 'isolated-mutation', execute: true }
      : { policy: 'requires-isolated-fixture', execute: false };
  }
  if (action.tag === 'a') return { policy: 'navigation-inventory', execute: false };
  if (SAFE_ADMIN_CONTAINERS.has(action.containerId)) {
    return { policy: 'navigation-inventory', execute: false };
  }
  const safeClass = (action.classes || []).includes('ve-overlay-target');
  if (SAFE_ADMIN_IDS.has(action.domId) || safeClass) {
    return { policy: 'safe-ui-action', execute: true };
  }
  if (['button', 'summary'].includes(action.tag) || action.role === 'button') {
    return isolatedMutations
      ? { policy: 'isolated-mutation', execute: true }
      : { policy: 'requires-isolated-fixture', execute: false };
  }
  return { policy: 'focus-state', execute: false };
}

export function validateContactProtocol(href) {
  const value = String(href || '').trim();
  if (!CONTACT_PROTOCOL.test(value)) return false;
  const payload = value.slice(value.indexOf(':') + 1).trim();
  if (!payload) return false;
  if (value.toLowerCase().startsWith('tel:')) return /^\+?[\d\s()-]{5,}$/u.test(payload);
  if (value.toLowerCase().startsWith('mailto:')) return /^[^\s@]+@[^\s@]+\.[^\s@]+(?:\?.*)?$/u.test(payload);
  return true;
}

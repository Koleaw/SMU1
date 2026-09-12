// These selectors describe controls, not the temporary inventory order. The
// navigator replaces its DOM after favorite/filter changes and on every reset.
export function findAdminActionElement(documentValue, action) {
  if (!documentValue) return null;
  if (action.domId) return documentValue.getElementById(action.domId);
  const scope = action.containerId ? documentValue.getElementById(action.containerId) : documentValue;
  if (!scope) return null;
  const candidates = Array.from(scope.querySelectorAll(action.tag || '*'));
  if (action.classes?.includes('ve-tree-item__favorite')) {
    return candidates.find((element) => element.classList.contains('ve-tree-item__favorite')
      && element.closest('[data-route]')?.getAttribute('data-route') === action.ancestorRoute) || null;
  }
  const attributes = ['data-viewport', 'data-mode', 'data-filter', 'data-settings-tab',
    'data-dialog-close', 'data-binding-id', 'data-control-key', 'data-route']
    .filter((name) => Object.hasOwn(action.dataAttributes || {}, name));
  if (attributes.length) {
    const matches = candidates.filter((element) => attributes.every((name) => element.getAttribute(name) === action.dataAttributes[name]));
    return matches.length === 1 ? matches[0] : null;
  }
  const clean = (value) => String(value || '').replace(/\s+/gu, ' ').trim();
  const named = candidates.filter((element) => clean(element.getAttribute('aria-label') || element.title || element.textContent || element.value) === action.name);
  // Native summary controls have no application id. Their unique group label
  // remains stable when newly rendered favorites shift all temporary ids.
  return named.length === 1 ? named[0] : null;
}

export function isExpectedIsolatedPublishStatus({ method, status, origin, url, code, isolated }) {
  if (!isolated || method !== 'GET' || status !== 403 || code !== 'INSECURE_PUBLISH_DENIED') return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && parsed.pathname === '/api/admin/publish/status' && !parsed.search;
  } catch { return false; }
}

export function adminControlPostcondition(action, before, after, _requests, activation = null) {
  if (action.containerId === 'veOverlay') {
    let previous, next;
    try { previous = JSON.parse(before); next = JSON.parse(after); } catch { return false; }
    const bindingId = action.dataAttributes?.['data-binding-id'];
    const controlKey = action.dataAttributes?.['data-control-key'];
    const trusted = activation?.some(event => event.type === 'click' && event.isTrusted === true
      && event.bindingId === bindingId && event.controlKey === controlKey);
    if (!trusted || !bindingId || !controlKey) return false;
    if (controlKey === 'handle') return next?.active === true;
    if (controlKey.startsWith('move-')) {
      const order = previous?.reorder?.orderedIds;
      const actual = next?.reorder?.orderedIds;
      const identity = previous?.reorder?.identity;
      if (!Array.isArray(order) || !Array.isArray(actual) || order.length < 1
        || new Set(order).size !== order.length || !order.includes(identity)
        || previous.reorder.zoneId !== next?.reorder?.zoneId) return false;
      const index = order.indexOf(identity), key = controlKey.slice(5);
      const target = key === 'Home' ? 0 : key === 'End' ? order.length - 1
        : key === 'ArrowUp' ? index - 1 : key === 'ArrowDown' ? index + 1 : NaN;
      if (!Number.isFinite(target)) return false;
      const expected = order.slice();
      if (target >= 0 && target < order.length) expected.splice(target, 0, ...expected.splice(index, 1));
      // Boundary no-ops still require a trusted event on this exact control.
      return JSON.stringify(expected) === JSON.stringify(actual);
    }
    const selected = next?.selectedBinding === bindingId;
    const surface = next?.inlineBinding === bindingId || next?.inspectorOpen === true || next?.dialogs > 0;
    const opened = (previous?.inlineBinding !== bindingId && next?.inlineBinding === bindingId)
      || (previous?.inspectorOpen !== true && next?.inspectorOpen === true) || next?.dialogs > previous?.dialogs;
    return selected && (opened || (previous?.selectedBinding !== bindingId && surface));
  }
  if (action.domId === 'veFullScreen') {
    try {
      const previous = JSON.parse(before)?.fullscreen, next = JSON.parse(after)?.fullscreen;
      return typeof previous === 'boolean' && typeof next === 'boolean' && previous !== next;
    } catch { return false; }
  }
  if (action.tag === 'summary') {
    try {
      const previous = JSON.parse(before)?.detailsOpen, next = JSON.parse(after)?.detailsOpen;
      return typeof previous === 'boolean' && typeof next === 'boolean' && previous !== next;
    } catch { return false; }
  }
  if (action.classes?.includes('ve-tree-item__favorite')) {
    try {
      const previous = JSON.parse(before)?.pressed, next = JSON.parse(after)?.pressed;
      return ['true', 'false'].includes(previous) && ['true', 'false'].includes(next) && previous !== next;
    } catch { return false; }
  }
  if (['data-viewport', 'data-mode', 'data-filter', 'data-settings-tab']
    .some((name) => Object.hasOwn(action.dataAttributes || {}, name))) {
    try { return JSON.parse(before)?.pressed === 'false' && JSON.parse(after)?.pressed === 'true'; }
    catch { return false; }
  }
  // A background video/image/API request is not evidence of a UI action.
  // Refresh is represented by the actual iframe Document identity in snapshots.
  try {
    const previous = JSON.parse(before), next = JSON.parse(after);
    if (!previous || !next) return false;
    delete previous.status; delete next.status;
    delete previous.hidden; delete next.hidden;
    delete previous.active; delete next.active;
    return JSON.stringify(previous) !== JSON.stringify(next);
  } catch { return false; }
}

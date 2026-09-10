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
    'data-dialog-close', 'data-binding-id', 'data-route']
    .filter((name) => Object.hasOwn(action.dataAttributes || {}, name));
  if (attributes.length) {
    return candidates.find((element) => attributes.every((name) => element.getAttribute(name) === action.dataAttributes[name])) || null;
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

export function adminControlPostcondition(action, before, after, requestCount) {
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
  return Boolean(before !== after || requestCount);
}

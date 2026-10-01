// This function is serialized into the browser by the motion harness. Keep it
// self-contained: each geometry reader runs in its own event stack. Coverage
// precedes navigation by one intentional animation frame in the controller.
export function installHeldNavigationCapture(targetHref, readGeometry, expectedTransition) {
  if (!window.navigation || typeof window.navigation.addEventListener !== 'function') return false;
  window.__smu1H4CoveredNavigation = { prevented: false, cancelable: false, destination: '' };
  window.__smu1H4CoveredGeometry = null;
  window.__smu1H4CoveredEventGeometry = null;
  const onCovered = (event) => {
    const detail = event.detail;
    if (!detail || detail.variant !== expectedTransition.variant
      || detail.from !== expectedTransition.from || detail.to !== expectedTransition.to
      || typeof detail.navigationId !== 'string' || !detail.navigationId) return;
    document.removeEventListener('v2:page-covered', onCovered, { capture: true });
    const observedAt = Date.now();
    window.__smu1H4CoveredEventGeometry = {
      ...readGeometry(),
      event: { observedAt, variant: detail.variant, from: detail.from, to: detail.to, navigationId: detail.navigationId }
    };
  };
  document.addEventListener('v2:page-covered', onCovered, { capture: true });
  window.navigation.addEventListener('navigate', (event) => {
    const destination = event.destination?.url || '';
    if (destination !== targetHref) return;
    document.removeEventListener('v2:page-covered', onCovered, { capture: true });
    window.__smu1H4CoveredNavigation.cancelable = event.cancelable;
    window.__smu1H4CoveredNavigation.destination = destination;
    if (!event.cancelable) return;
    event.preventDefault();
    window.__smu1H4CoveredNavigation.prevented = true;
    // Do not await an RPC, timer, microtask or animation frame here. The stored
    // timestamp belongs to the observed geometry, not the later PNG request.
    window.__smu1H4CoveredGeometry = readGeometry();
  }, { once: true });
  return true;
}

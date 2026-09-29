// This function is serialized into the browser by the motion harness. Keep it
// self-contained: the geometry reader runs in the same navigation event stack.
export function installHeldNavigationCapture(targetHref, readGeometry) {
  if (!window.navigation || typeof window.navigation.addEventListener !== 'function') return false;
  window.__smu1H4CoveredNavigation = { prevented: false, cancelable: false, destination: '' };
  window.__smu1H4CoveredGeometry = null;
  window.navigation.addEventListener('navigate', (event) => {
    const destination = event.destination?.url || '';
    if (destination !== targetHref) return;
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

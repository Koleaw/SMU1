// Keep the pressed DOM target alive until the browser has delivered its click.
// Geometry can still update in state; only replacing the overlay DOM is deferred.
export function createOverlayRenderGuard(render, scheduleFrame = requestAnimationFrame) {
  const gestures = new Set();
  let pending = false;
  let releaseScheduled = false;

  function flushAfterRelease() {
    if (releaseScheduled || gestures.size) return;
    releaseScheduled = true;
    scheduleFrame(() => {
      releaseScheduled = false;
      if (gestures.size || !pending) return;
      pending = false;
      render();
    });
  }

  return {
    hold(id) { gestures.add(id); },
    release(id) { if (gestures.delete(id)) flushAfterRelease(); },
    releaseAll() {
      if (!gestures.size) return;
      gestures.clear();
      flushAfterRelease();
    },
    request() {
      if (gestures.size || releaseScheduled) pending = true;
      else render();
    }
  };
}

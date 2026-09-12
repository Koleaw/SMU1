// The themed split hub switches composition at 981px. Its accepted public
// heading is clamp(46px, 4.25vw, 72px); stacked hubs and other route families
// retain their existing H4 scale.
export function resolveSplitHubHeadingSize(routeKind, width, fallback) {
  if (routeKind !== 'section-hub' || width < 981) return fallback;
  return Math.min(72, Math.max(46, width * .0425));
}

// The custom-order hero keeps its longest word inside the narrow text panel.
// The added 701–760px range continues its existing 761–1100px CSS measure;
// all untouched ranges retain the caller's existing H4 scale.
export function resolveCustomOrderHeadingSize(routeKind, width, fallback) {
  if (routeKind !== 'custom-order') return fallback;
  if (width >= 701 && width <= 760) return Math.min(64, Math.max(46, width * .061));
  if (width < 1101 || width > 1320) return fallback;
  return Math.min(80, Math.max(64, width * .061));
}

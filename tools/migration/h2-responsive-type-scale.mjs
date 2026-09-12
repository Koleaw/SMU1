// The themed split hub switches composition at 981px. Its accepted public
// heading is clamp(46px, 4.25vw, 72px); stacked hubs and other route families
// retain their existing H4 scale.
export function resolveSplitHubHeadingSize(routeKind, width, fallback) {
  if (routeKind !== 'section-hub' || width < 981) return fallback;
  return Math.min(72, Math.max(46, width * .0425));
}

// The custom-order split hero needs this narrow desktop measure to keep its
// longest word inside the text panel. Its existing smaller/larger rules stay.
export function resolveCustomOrderHeadingSize(routeKind, width, fallback) {
  if (routeKind !== 'custom-order' || width < 1101 || width > 1320) return fallback;
  return Math.min(80, Math.max(64, width * .061));
}

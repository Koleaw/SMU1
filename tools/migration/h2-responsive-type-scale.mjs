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

// Calculators start with a compact working heading rather than a marketing
// hero. The archive measures a card title; calculators measure the always
// visible data-panel title. All three text roles are required on both routes.
export function resolveToolTypeScale(routeKind, width) {
  if (!['tool', 'tools-archive'].includes(routeKind)) return null;
  return {
    family: routeKind,
    breakpoint: width <= 800 ? 'mobile' : 'desktop',
    h1: Math.min(49, Math.max(30, width * .033)),
    h2: routeKind === 'tool' ? 18 : width <= 800 ? 21 : 24,
    lead: width <= 800 ? 15 : 17,
    tolerance: .25,
    requiredRoles: ['h1', 'h2', 'lead'],
    selectors: {
      h1: '.tools-page .tool-heading h1',
      h2: routeKind === 'tool'
        ? '.tools-page .tool-input-panel > .tool-panel-title'
        : '.tools-page .tool-card > h2',
      lead: '.tools-page .tool-heading > p:last-child'
    }
  };
}

export function evaluateResponsiveTypeScale(scale, metrics) {
  const matches = (role) => Boolean(scale && metrics?.[role])
    && Math.abs(metrics[role].fontSize - scale[role]) <= scale.tolerance;
  const h1Ok = matches('h1');
  const h2Ok = !metrics?.h2 || matches('h2');
  const leadOk = !metrics?.lead || matches('lead');
  const requiredRolesOk = (scale?.requiredRoles || []).every((role) => Boolean(metrics?.[role]));
  return { ok: h1Ok && h2Ok && leadOk && requiredRolesOk, h1Ok, h2Ok, leadOk, requiredRolesOk };
}

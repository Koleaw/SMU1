// Utility pages have no entrance coordinator or readiness dependency: the
// shared transition uses its existing `not-required` path. Only their already
// visible header receives a short optional animation; the form never waits.
let dispose: (() => void) | undefined;

export const initializeToolEntrance = () => {
  dispose?.();
  const html = document.documentElement;
  if (html.dataset.v2ToolRoute !== 'true') return;

  const life = new AbortController();
  const { signal } = life;
  const header = document.querySelector<HTMLElement>('[data-home-v2-header]');
  const roles = Array.from(header?.querySelectorAll<HTMLElement>('[data-v2-entrance-role]') ?? []);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const animations: Animation[] = [];
  const settle = () => {
    animations.splice(0).forEach(animation => animation.cancel());
    header?.classList.add('is-ready');
    roles.forEach(element => {
      element.dataset.v2EntranceNode = 'settled';
      element.style.removeProperty('pointer-events');
      element.style.removeProperty('will-change');
    });
  };
  dispose = () => { settle(); life.abort(); };
  document.addEventListener('astro:before-swap', () => dispose?.(), { signal });
  document.addEventListener('v2:entrance-fail-open-request', () => {
    settle();
    document.dispatchEvent(new CustomEvent('v2:entrance-fail-open', {
      detail: { state: 'fail-open', source: 'tool', route: location.pathname }
    }));
  }, { signal });
  window.addEventListener('pagehide', settle, { signal });
  document.addEventListener('v2:prepare-bfcache', settle, { signal });
  window.addEventListener('pageshow', event => { if (event.persisted) settle(); }, { signal });
  header?.addEventListener('focusin', settle, { signal });
  reducedMotion.addEventListener('change', settle, { signal });

  settle();
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (reducedMotion.matches || connection?.saveData || navigation?.type === 'back_forward') return;
  try {
    roles.filter(element => element.getClientRects().length && !element.contains(document.activeElement))
      .forEach(element => {
        if (typeof element.animate !== 'function') return;
        animations.push(element.animate(
          [{ opacity: 0.85, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
          { duration: 160, easing: 'ease-out' }
        ));
      });
  } catch { settle(); }
};

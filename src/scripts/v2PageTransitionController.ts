import { prefetch } from 'astro:prefetch';

export const V2_PAGE_TRANSITION_KEY = 'smu1:page-transition:v1';
export const V2_PAGE_TRANSITION_VERSION = 1 as const;
export const V2_PAGE_TRANSITION_TTL = 20_000;
export const V2_PAGE_TRANSITION_HARD_DEADLINE = 1_200;

const DESKTOP_COVER_DURATION = 320;
const MOBILE_COVER_DURATION = 250;
const DESKTOP_REVEAL_DURATION = 560;
const MOBILE_REVEAL_DURATION = 400;
const FAIL_OPEN_DURATION = 140;
const NAVIGATION_WATCHDOG = 4_000;

type PageTransitionState =
  | 'idle'
  | 'covering'
  | 'covered'
  | 'navigating'
  | 'arrival'
  | 'waiting'
  | 'revealing'
  | 'done'
  | 'static'
  | 'skipped'
  | 'fail-open';

type CriticalStatus =
  | 'loading'
  | 'ready'
  | 'not-required'
  | 'image-error'
  | 'deadline'
  | 'controller-error';

type PageTransitionToken = {
  version: typeof V2_PAGE_TRANSITION_VERSION;
  target: string;
  timestamp: number;
  nonce: string;
};

type ConnectionNavigator = Navigator & {
  connection?: {
    saveData?: boolean;
    effectiveType?: string;
  };
};

type PageTransitionWindow = Window & {
  __smu1V2PageTransitionPageshowReady?: boolean;
  __smu1PageTransitionFailSafe?: number;
};

type ManagedTransition = {
  resetFromPageShow: () => void;
};

type CriticalOutcome =
  | { kind: 'ready' | 'not-required' | 'deadline' }
  | { kind: 'image-error'; error?: unknown };

const managedTransitions = new WeakMap<HTMLElement, ManagedTransition>();
const transitionWindow = window as PageTransitionWindow;

const clearHeadFailSafe = () => {
  if (transitionWindow.__smu1PageTransitionFailSafe === undefined) return;
  window.clearTimeout(transitionWindow.__smu1PageTransitionFailSafe);
  delete transitionWindow.__smu1PageTransitionFailSafe;
};

const wait = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

const nextFrame = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => resolve());
});

const twoFrames = async () => {
  await nextFrame();
  await nextFrame();
};

export const exactV2PageTarget = (url: URL) => `${url.pathname}${url.search}${url.hash}`;

const connection = () => (navigator as ConnectionNavigator).connection;
const hasSaveData = () => Boolean(connection()?.saveData);
const hasSlowConnection = () => /(^|-)2g$/i.test(connection()?.effectiveType || '');
const hasReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobileViewport = () => window.matchMedia('(max-width: 760px)').matches;

const normalizeBasePath = (value: string) => {
  let pathname = '/';
  try {
    pathname = new URL(value || '/', window.location.origin).pathname;
  } catch {
    pathname = '/';
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
};

const routeWithinBase = (pathname: string, basePath: string) => {
  if (basePath === '/') return pathname || '/';
  const rootWithoutSlash = basePath.slice(0, -1);
  if (pathname === rootWithoutSlash || pathname === basePath) return '/';
  if (!pathname.startsWith(basePath)) return null;
  return `/${pathname.slice(basePath.length)}`;
};

const normalizeRouteForComparison = (route: string) => {
  if (!route || route === '/') return '/';
  return route.endsWith('/') ? route : `${route}/`;
};

const COMPATIBILITY_ROUTES = new Set([
  '/lavochki-i-skameyki/',
  '/urny/',
  '/navesy/'
]);

const isPublicV2Route = (url: URL, root: HTMLElement) => {
  const basePath = normalizeBasePath(root.dataset.v2PageBase || '/');
  const route = routeWithinBase(url.pathname, basePath);
  if (route === null) return false;

  const normalizedRoute = normalizeRouteForComparison(route);
  const lowerRoute = normalizedRoute.toLowerCase();
  if (/^\/(?:assets|uploads|admin|api)(?:\/|$)/i.test(lowerRoute)) return false;
  if (/^\/design-lab(?:\/|$)/i.test(lowerRoute)) {
    return root.dataset.v2PageAllowDesignLab === 'true';
  }
  if (COMPATIBILITY_ROUTES.has(lowerRoute)) return false;
  if (lowerRoute === '/404/' || lowerRoute === '/404.html/') return false;
  if (/\.[a-z\d]{1,8}\/$/i.test(lowerRoute) && !lowerRoute.endsWith('.html/')) return false;
  return true;
};

const anchorFromEvent = (event: Event) => {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLAnchorElement>('a[href]');
};

const hasTransitionOptOut = (anchor: HTMLAnchorElement) => Boolean(
  anchor.closest('[data-v2-transition="off"]')
);

const resolveEligibleUrl = (anchor: HTMLAnchorElement, root: HTMLElement) => {
  if (hasTransitionOptOut(anchor)) return null;
  if (anchor.hasAttribute('download')) return null;
  const target = anchor.getAttribute('target');
  if (target && target.toLowerCase() !== '_self') return null;

  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.origin !== window.location.origin) return null;
  if (!isPublicV2Route(url, root)) return null;

  const current = new URL(window.location.href);
  if (url.href === current.href) return null;
  // Same-page anchors and query-only changes remain native. A cross-page hash
  // is eligible because its pathname is different and the exact hash is kept
  // in the handoff token and location.assign().
  if (
    normalizeRouteForComparison(url.pathname)
    === normalizeRouteForComparison(current.pathname)
  ) return null;
  return url;
};

const isPrimaryUnmodifiedClick = (event: MouseEvent) => (
  event.button === 0
  && !event.ctrlKey
  && !event.metaKey
  && !event.shiftKey
  && !event.altKey
);

const setState = (
  root: HTMLElement,
  state: PageTransitionState,
  options: { preserveBootstrap?: boolean } = {}
) => {
  root.dataset.v2PageState = state;
  document.documentElement.dataset.v2PageState = state;
  if (!options.preserveBootstrap && (state === 'done' || state === 'fail-open')) {
    document.documentElement.dataset.v2PageBootstrap = state;
  }
};

const setCriticalStatus = (root: HTMLElement, status: CriticalStatus) => {
  root.dataset.v2PageCriticalStatus = status;
  document.documentElement.dataset.v2PageCriticalStatus = status;
};

const lockPage = (root: HTMLElement) => {
  root.dataset.v2PageLock = 'true';
  document.documentElement.dataset.v2PageLock = 'true';
  document.documentElement.classList.add('v2-page-transition-locked');
};

const unlockPage = (root: HTMLElement) => {
  delete root.dataset.v2PageLock;
  delete document.documentElement.dataset.v2PageLock;
  document.documentElement.classList.remove('v2-page-transition-locked');
};

const dispatchPageEvent = (
  name: 'revealing' | 'done',
  root: HTMLElement,
  detail: Record<string, unknown> = {}
) => {
  document.dispatchEvent(new CustomEvent(`v2:page-${name}`, {
    detail: {
      state: root.dataset.v2PageState || name,
      criticalStatus: root.dataset.v2PageCriticalStatus || 'not-required',
      ...detail
    }
  }));
};

const waitForSheetTransition = (
  sheet: HTMLElement,
  maximumMilliseconds: number
) => new Promise<void>((resolve) => {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    sheet.removeEventListener('transitionend', onTransitionEnd);
    sheet.removeEventListener('transitioncancel', onTransitionCancel);
    resolve();
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === sheet && event.propertyName === 'transform') finish();
  };
  const onTransitionCancel = (event: TransitionEvent) => {
    if (event.target === sheet && event.propertyName === 'transform') finish();
  };
  const timeout = window.setTimeout(finish, maximumMilliseconds + 100);
  sheet.addEventListener('transitionend', onTransitionEnd);
  sheet.addEventListener('transitioncancel', onTransitionCancel);
});

const createNonce = () => {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(36)).join('-');
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
};

const writeHandoffToken = (url: URL): PageTransitionToken => {
  const token: PageTransitionToken = {
    version: V2_PAGE_TRANSITION_VERSION,
    target: exactV2PageTarget(url),
    timestamp: Date.now(),
    nonce: createNonce()
  };
  window.sessionStorage.setItem(V2_PAGE_TRANSITION_KEY, JSON.stringify(token));
  return token;
};

const clearOwnedToken = (token: PageTransitionToken | null) => {
  if (!token) return;
  try {
    const raw = window.sessionStorage.getItem(V2_PAGE_TRANSITION_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Partial<PageTransitionToken>;
    if (stored.nonce === token.nonce) {
      window.sessionStorage.removeItem(V2_PAGE_TRANSITION_KEY);
    }
  } catch {
    // Storage failures must never keep the page locked.
  }
};

const findCriticalImage = () => {
  const markers = Array.from(document.querySelectorAll<HTMLElement>('[data-v2-page-critical]'));
  for (const marker of markers) {
    if (marker instanceof HTMLImageElement) return marker;
    const image = marker.querySelector<HTMLImageElement>('img');
    if (image) return image;
  }
  return null;
};

const waitForCriticalImage = (
  image: HTMLImageElement,
  signal: AbortSignal
) => new Promise<void>((resolve, reject) => {
  let settled = false;

  const cleanup = () => {
    image.removeEventListener('load', onLoad);
    image.removeEventListener('error', onError);
    signal.removeEventListener('abort', onAbort);
  };

  const resolveLoadedImage = async () => {
    if (settled) return;
    if (image.naturalWidth <= 0) {
      settled = true;
      cleanup();
      reject(new Error('image-error'));
      return;
    }

    try {
      if (typeof image.decode === 'function') await image.decode();
    } catch (error) {
      // decode() can reject transiently for an image which has already loaded.
      // Only naturalWidth=0 or the real error event is a broken critical image.
      if (image.naturalWidth <= 0) {
        settled = true;
        cleanup();
        reject(error);
        return;
      }
    }

    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  };

  const onLoad = () => { void resolveLoadedImage(); };
  const onError = (event: Event) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(event);
  };
  const onAbort = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  };

  image.addEventListener('load', onLoad, { once: true });
  image.addEventListener('error', onError, { once: true });
  signal.addEventListener('abort', onAbort, { once: true });
  if (image.complete) queueMicrotask(() => { void resolveLoadedImage(); });
});

const waitForIncomingReadiness = async (root: HTMLElement): Promise<CriticalOutcome> => {
  const image = findCriticalImage();
  const abortController = new AbortController();
  let deadlineTimer = 0;

  setCriticalStatus(root, image ? 'loading' : 'not-required');

  const readiness = (async (): Promise<CriticalOutcome> => {
    if (!image) {
      await twoFrames();
      return { kind: 'not-required' };
    }
    try {
      await waitForCriticalImage(image, abortController.signal);
      await twoFrames();
      return { kind: 'ready' };
    } catch (error) {
      return { kind: 'image-error', error };
    }
  })();

  const deadline = new Promise<CriticalOutcome>((resolve) => {
    deadlineTimer = window.setTimeout(
      () => resolve({ kind: 'deadline' }),
      V2_PAGE_TRANSITION_HARD_DEADLINE
    );
  });

  const outcome = await Promise.race([readiness, deadline]);
  window.clearTimeout(deadlineTimer);
  abortController.abort();
  return outcome;
};

const initializeTransitionRoot = (root: HTMLElement) => {
  if (root.dataset.v2PageController === 'ready') return;
  const sheet = root.querySelector<HTMLElement>('[data-v2-page-sheet]');
  if (!sheet) return;

  root.dataset.v2PageController = 'ready';
  let busy = false;
  let watchdog = 0;
  let activeToken: PageTransitionToken | null = null;
  let intentTimer = 0;

  const clearWatchdog = () => {
    window.clearTimeout(watchdog);
    watchdog = 0;
  };

  const resetOverlay = (state: PageTransitionState = 'idle') => {
    clearWatchdog();
    clearOwnedToken(activeToken);
    activeToken = null;
    busy = false;
    root.dataset.v2PageSettled = 'true';
    setState(root, state, { preserveBootstrap: state === 'idle' });
    unlockPage(root);
  };

  const completeIncoming = (state: Extract<PageTransitionState, 'done' | 'fail-open'>) => {
    root.dataset.v2PageSettled = 'true';
    setState(root, state);
    unlockPage(root);
    busy = false;
    dispatchPageEvent('done', root, { outcome: state });
  };

  const failOpen = async (reason: string, navigateTo?: URL) => {
    clearWatchdog();
    root.dataset.v2PageFailure = reason;
    setCriticalStatus(root, 'controller-error');
    setState(root, 'fail-open');
    dispatchPageEvent('revealing', root, { outcome: 'fail-open', reason });
    await wait(FAIL_OPEN_DURATION + 20);
    completeIncoming('fail-open');
    clearOwnedToken(activeToken);
    activeToken = null;
    if (navigateTo) {
      try {
        window.location.assign(navigateTo.href);
      } catch {
        // The old document is already usable again.
      }
    }
  };

  const beginNavigation = async (url: URL) => {
    if (busy) return;
    busy = true;
    delete root.dataset.v2PageSettled;
    delete root.dataset.v2PageFailure;
    setCriticalStatus(root, 'not-required');
    lockPage(root);
    // This repeat is intentional: it covers keyboard activation and a click
    // which arrived before the hover/focus intent delay elapsed.
    prefetch(url.href);
    setState(root, 'covering');
    await waitForSheetTransition(
      sheet,
      isMobileViewport() ? MOBILE_COVER_DURATION : DESKTOP_COVER_DURATION
    );
    if (!busy) return;

    setState(root, 'covered');
    await nextFrame();
    if (!busy) return;

    try {
      activeToken = writeHandoffToken(url);
    } catch {
      await failOpen('storage-error', url);
      return;
    }

    setState(root, 'navigating');
    try {
      window.location.assign(url.href);
    } catch {
      await failOpen('navigation-error');
      return;
    }

    watchdog = window.setTimeout(() => {
      if (!busy) return;
      clearOwnedToken(activeToken);
      activeToken = null;
      void failOpen('navigation-watchdog');
    }, NAVIGATION_WATCHDOG);
  };

  const onClick = (event: MouseEvent) => {
    if (busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.defaultPrevented || !isPrimaryUnmodifiedClick(event)) return;
    const anchor = anchorFromEvent(event);
    if (!anchor) return;
    if (hasReducedMotion() || hasSaveData()) return;

    const url = resolveEligibleUrl(anchor, root);
    if (!url) return;
    event.preventDefault();
    void beginNavigation(url).catch(() => {
      void failOpen('controller-error', url);
    });
  };

  const prefetchFromEvent = (event: Event, delayed: boolean) => {
    if (hasSaveData() || hasSlowConnection()) return;
    const anchor = anchorFromEvent(event);
    if (!anchor) return;
    const url = resolveEligibleUrl(anchor, root);
    if (!url) return;

    window.clearTimeout(intentTimer);
    if (delayed) {
      intentTimer = window.setTimeout(() => prefetch(url.href), 80);
    } else {
      prefetch(url.href);
    }
  };

  const onPointerOut = () => {
    window.clearTimeout(intentTimer);
    intentTimer = 0;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    prefetchFromEvent(event, false);
  };

  const onPageShow = () => {
    clearWatchdog();
    clearOwnedToken(activeToken);
    activeToken = null;
    busy = false;
    delete root.dataset.v2PageSettled;
    delete root.dataset.v2PageFailure;
    root.dataset.v2PageCriticalStatus = 'not-required';
    document.documentElement.dataset.v2PageCriticalStatus = 'not-required';
    document.documentElement.dataset.v2PageBootstrap = 'static';
    setState(root, 'idle', { preserveBootstrap: true });
    unlockPage(root);
    dispatchPageEvent('done', root, { outcome: 'bfcache' });
  };

  managedTransitions.set(root, { resetFromPageShow: onPageShow });
  document.addEventListener('click', onClick, { capture: true });
  document.addEventListener('pointerover', (event) => prefetchFromEvent(event, true), { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });
  document.addEventListener('focusin', (event) => prefetchFromEvent(event, false), { passive: true });
  document.addEventListener('pointerdown', onPointerDown, { capture: true });

  const bootstrap = document.documentElement.dataset.v2PageBootstrap;
  if (bootstrap === 'arrival') {
    clearHeadFailSafe();
    busy = true;
    delete root.dataset.v2PageSettled;
    lockPage(root);
    setState(root, 'arrival', { preserveBootstrap: true });

    if (hasReducedMotion() || hasSaveData()) {
      root.dataset.v2PageFailure = hasReducedMotion() ? 'reduced-motion' : 'save-data';
      setCriticalStatus(root, 'not-required');
      setState(root, 'fail-open');
      dispatchPageEvent('revealing', root, {
        outcome: 'fail-open',
        reason: root.dataset.v2PageFailure
      });
      completeIncoming('fail-open');
      return;
    }

    setState(root, 'waiting', { preserveBootstrap: true });
    void (async () => {
      const outcome = await waitForIncomingReadiness(root);
      if (!busy) return;
      setCriticalStatus(root, outcome.kind);

      if (outcome.kind === 'image-error') {
        root.dataset.v2PageFailure = 'image-error';
        setState(root, 'fail-open');
        dispatchPageEvent('revealing', root, { outcome: 'fail-open', reason: 'image-error' });
        await waitForSheetTransition(sheet, FAIL_OPEN_DURATION);
        completeIncoming('fail-open');
        return;
      }

      setState(root, 'revealing', { preserveBootstrap: true });
      dispatchPageEvent('revealing', root, { outcome: outcome.kind });
      await waitForSheetTransition(
        sheet,
        isMobileViewport() ? MOBILE_REVEAL_DURATION : DESKTOP_REVEAL_DURATION
      );
      if (!busy) return;
      completeIncoming('done');
    })().catch(() => {
      void failOpen('controller-error');
    });
  } else if (hasReducedMotion()) {
    setCriticalStatus(root, 'not-required');
    resetOverlay('static');
  } else if (hasSaveData()) {
    setCriticalStatus(root, 'not-required');
    resetOverlay('skipped');
  } else {
    setCriticalStatus(root, 'not-required');
    resetOverlay('idle');
  }
};

export const initializeV2PageTransitionController = () => {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-v2-page-transition]'));
  roots.forEach(initializeTransitionRoot);

  if (transitionWindow.__smu1V2PageTransitionPageshowReady) return;
  transitionWindow.__smu1V2PageTransitionPageshowReady = true;
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    document.querySelectorAll<HTMLElement>('[data-v2-page-transition]').forEach((root) => {
      managedTransitions.get(root)?.resetFromPageShow();
    });
  });
};

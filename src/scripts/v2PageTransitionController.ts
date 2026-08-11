import { prefetch } from 'astro:prefetch';
import {
  classifyV2Route,
  parseV2RouteRegistry,
  resolveV2TransitionMode,
  V2_FALLBACK_ROUTE_REGISTRY
} from '../utils/v2TransitionRouting.mjs';

export const V2_PAGE_TRANSITION_KEY = 'smu1:page-transition:v2';
export const V2_PAGE_TRANSITION_VERSION = 2 as const;
export const V2_PAGE_TRANSITION_TTL = 20_000;
export const V2_PAGE_TRANSITION_HARD_DEADLINE = 250;

const DESKTOP_COVER_DURATION = 300;
const MOBILE_COVER_DURATION = 240;
const DESKTOP_REVEAL_DURATION = 480;
const MOBILE_REVEAL_DURATION = 380;
const H3_FAIL_OPEN_DURATION = 140;
const DESKTOP_CALM_COVER_DURATION = 220;
const MOBILE_CALM_COVER_DURATION = 180;
const DESKTOP_CALM_REVEAL_DURATION = 420;
const MOBILE_CALM_REVEAL_DURATION = 320;
const DESKTOP_CALM_FAIL_OPEN_DURATION = 140;
const MOBILE_CALM_FAIL_OPEN_DURATION = 120;
const NAVIGATION_WATCHDOG = 4_000;
const TRANSITION_LABEL_MAX_LENGTH = 80;

type PageTransitionVariant = 'h3' | 'calm';

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
  | 'deadline'
  | 'controller-error';

type V2RouteDescriptor = {
  pathname: string;
  routeKind: string;
  rootSectionId: string | null;
  label: string;
  classified?: boolean;
  interceptEligible?: boolean;
  presentationType?: 'standard' | 'premium';
};

type V2RouteClassification = {
  requestedTarget: string;
  navigationTarget: string;
  normalizedTarget: string;
  normalizedPathname: string;
  routeKind: string;
  rootSectionId: string | null;
  canonicalLabel: string;
  isProductionV2: boolean;
  isClassified: boolean;
  interceptEligible: boolean;
  exclusionReason: string;
  presentationType: 'standard' | 'premium' | undefined;
};

type PageTransitionToken = {
  version: typeof V2_PAGE_TRANSITION_VERSION;
  variant: PageTransitionVariant;
  target: string;
  label: string;
  calmLabel?: string;
  from: {
    pathname: string;
    rootSectionId: string | null;
  };
  to: {
    pathname: string;
    rootSectionId: string | null;
  };
  timestamp: number;
  nonce: string;
  navigationId: string;
};

type ResolvedNavigation = {
  url: URL;
  from: V2RouteClassification;
  to: V2RouteClassification;
  variant: PageTransitionVariant;
  label: string;
  calmLabel: string;
};

type RoutingContext = {
  registry: V2RouteDescriptor[];
  registryComplete: boolean;
};

type IncomingReadiness = {
  kind: 'ready' | 'not-required' | 'deadline' | 'entrance-fail-open';
  activationId?: string;
};

type ConnectionNavigator = Navigator & {
  connection?: {
    saveData?: boolean;
    effectiveType?: string;
  };
};

type PageTransitionWindow = Window & {
  __smu1V2PageTransitionLifecycleReady?: boolean;
  __smu1PageTransitionFailSafe?: number;
};

type ManagedTransition = {
  resetFromPageShow: () => void;
  prepareForPageHide: () => void;
};

const managedTransitions = new WeakMap<HTMLElement, ManagedTransition>();
const transitionWindow = window as PageTransitionWindow;

const clearHeadFailSafe = () => {
  if (transitionWindow.__smu1PageTransitionFailSafe === undefined) return;
  window.clearTimeout(transitionWindow.__smu1PageTransitionFailSafe);
  delete transitionWindow.__smu1PageTransitionFailSafe;
};

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

export const sanitizeV2PageTransitionLabel = (value: unknown) => Array.from(
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
).slice(0, TRANSITION_LABEL_MAX_LENGTH).join('');

const TECHNICAL_LABEL = /^(?:(?:открыть|перейти|смотреть|посмотреть|читать)(?:\s+(?:все|всю|полный|полную|текущий|текущую|следующий|следующую|предыдущий|предыдущую))?(?:\s+(?:страницу|категорию|объект|объекты|товар|товары|изделие|изделия|направление))?|подробнее)$/iu;
const TECHNICAL_PREFIX = /^(?:открыть|перейти|смотреть|посмотреть|читать)(?:\s+(?:страницу|категорию|объект|товар|изделие|направление))?\s*[:\u2014\u2013-]?\s*/iu;

const cleanTransitionLabel = (value: unknown) => {
  const sanitized = sanitizeV2PageTransitionLabel(value);
  if (!sanitized || TECHNICAL_LABEL.test(sanitized)) return '';
  const withoutAction = sanitizeV2PageTransitionLabel(sanitized.replace(TECHNICAL_PREFIX, ''));
  if (!withoutAction || TECHNICAL_LABEL.test(withoutAction)) return '';
  const unquoted = withoutAction.match(/^[\u00ab"](.+)[\u00bb"]$/u)?.[1] || withoutAction;
  return sanitizeV2PageTransitionLabel(unquoted);
};

const cardHeadingForAnchor = (anchor: HTMLAnchorElement) => {
  const ownHeading = anchor.querySelector<HTMLElement>(
    '[data-v2-transition-title], h1, h2, h3, h4, h5, h6'
  );
  const context = anchor.closest<HTMLElement>(
    '[data-v2-transition-context], [data-v2-project-card], article, [class*="card"]'
  );
  const contextHeading = context?.querySelector<HTMLElement>(
    '[data-v2-transition-title], h1, h2, h3, h4, h5, h6'
  );
  return cleanTransitionLabel(ownHeading?.textContent || contextHeading?.textContent || '');
};

const transitionLabelForAnchor = (anchor: HTMLAnchorElement) => {
  const explicit = cleanTransitionLabel(anchor.dataset.v2TransitionLabel);
  if (explicit) return explicit;

  const accessible = cleanTransitionLabel(anchor.getAttribute('aria-label'));
  if (accessible) return accessible;

  const cardHeading = cardHeadingForAnchor(anchor);
  if (cardHeading) return cardHeading;

  return cleanTransitionLabel(anchor.innerText || anchor.textContent || '');
};

const isPageTransitionVariant = (value: unknown): value is PageTransitionVariant => (
  value === 'h3' || value === 'calm'
);

const readRoutingContext = (): RoutingContext => {
  const fallback = {
    registry: [...V2_FALLBACK_ROUTE_REGISTRY] as V2RouteDescriptor[],
    registryComplete: false
  };
  const registryElement = document.querySelector<HTMLScriptElement>('[data-v2-route-registry]');
  if (!registryElement) return fallback;

  try {
    const parsed = parseV2RouteRegistry(JSON.parse(registryElement.textContent || '')) as {
      version: number;
      routes: V2RouteDescriptor[];
    } | null;
    if (!parsed) return fallback;
    return { registry: parsed.routes, registryComplete: true };
  } catch {
    return fallback;
  }
};

const classifyForRoot = (
  url: URL,
  root: HTMLElement,
  routing: RoutingContext
) => classifyV2Route(url, {
  origin: window.location.origin,
  basePath: root.dataset.v2PageBase || '/',
  registry: routing.registry,
  registryComplete: routing.registryComplete,
  allowDesignLab: root.dataset.v2PageAllowDesignLab === 'true'
}) as V2RouteClassification;

const anchorFromEvent = (event: Event) => {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLAnchorElement>('a[href]');
};

const hasTransitionOptOut = (anchor: HTMLAnchorElement) => Boolean(
  anchor.closest('[data-v2-transition="off"]')
);

const resolveEligibleNavigation = (
  anchor: HTMLAnchorElement,
  root: HTMLElement,
  routing: RoutingContext
): ResolvedNavigation | null => {
  if (hasTransitionOptOut(anchor)) return null;
  if (anchor.hasAttribute('download')) return null;
  const target = anchor.getAttribute('target');
  if (target && target.toLowerCase() !== '_self') return null;

  let requestedUrl: URL;
  try {
    requestedUrl = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }

  const currentUrl = new URL(window.location.href);
  const from = classifyForRoot(currentUrl, root, routing);
  const to = classifyForRoot(requestedUrl, root, routing);
  const mode = resolveV2TransitionMode(from, to);
  if (mode !== 'h3' && mode !== 'calm') return null;

  const canonicalLabel = cleanTransitionLabel(to.canonicalLabel);
  const fallbackLabel = transitionLabelForAnchor(anchor);
  const candidateLabel = canonicalLabel || fallbackLabel;
  const variant: PageTransitionVariant = mode === 'h3' && candidateLabel ? 'h3' : 'calm';

  return {
    url: new URL(to.navigationTarget, window.location.origin),
    from,
    to,
    variant,
    label: variant === 'h3' ? candidateLabel : '',
    calmLabel: variant === 'calm' ? candidateLabel : ''
  };
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

const setVariant = (root: HTMLElement, variant: PageTransitionVariant | null) => {
  if (variant) {
    root.dataset.v2PageVariant = variant;
    document.documentElement.dataset.v2PageVariant = variant;
    return;
  }
  delete root.dataset.v2PageVariant;
  delete document.documentElement.dataset.v2PageVariant;
};

const setNavigationId = (root: HTMLElement, navigationId: string) => {
  if (navigationId) {
    root.dataset.v2PageNavigationId = navigationId;
    document.documentElement.dataset.v2PageNavigationId = navigationId;
    return;
  }
  delete root.dataset.v2PageNavigationId;
  delete document.documentElement.dataset.v2PageNavigationId;
};

const clearNavigationDiagnostics = (root: HTMLElement) => {
  setNavigationId(root, '');
  delete root.dataset.v2PageFromRoot;
  delete root.dataset.v2PageToRoot;
  delete document.documentElement.dataset.v2PageFromRoot;
  delete document.documentElement.dataset.v2PageToRoot;
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
      variant: root.dataset.v2PageVariant || null,
      navigationId: root.dataset.v2PageNavigationId || null,
      fromRootSectionId: root.dataset.v2PageFromRoot || null,
      toRootSectionId: root.dataset.v2PageToRoot || null,
      ...detail
    }
  }));
};

const coverDuration = (variant: PageTransitionVariant) => {
  if (variant === 'calm') {
    return isMobileViewport() ? MOBILE_CALM_COVER_DURATION : DESKTOP_CALM_COVER_DURATION;
  }
  return isMobileViewport() ? MOBILE_COVER_DURATION : DESKTOP_COVER_DURATION;
};

const revealDuration = (variant: PageTransitionVariant) => {
  if (variant === 'calm') {
    return isMobileViewport() ? MOBILE_CALM_REVEAL_DURATION : DESKTOP_CALM_REVEAL_DURATION;
  }
  return isMobileViewport() ? MOBILE_REVEAL_DURATION : DESKTOP_REVEAL_DURATION;
};

const failOpenDuration = (variant: PageTransitionVariant) => {
  if (variant === 'calm') {
    return isMobileViewport()
      ? MOBILE_CALM_FAIL_OPEN_DURATION
      : DESKTOP_CALM_FAIL_OPEN_DURATION;
  }
  return H3_FAIL_OPEN_DURATION;
};

const waitForSheetTransition = (
  sheet: HTMLElement,
  variant: PageTransitionVariant,
  maximumMilliseconds: number
) => new Promise<void>((resolve) => {
  let settled = false;
  const expectedProperty = variant === 'calm' ? 'opacity' : 'transform';
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    sheet.removeEventListener('transitionend', onTransitionEnd);
    sheet.removeEventListener('transitioncancel', onTransitionCancel);
    resolve();
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === sheet && event.propertyName === expectedProperty) finish();
  };
  const onTransitionCancel = (event: TransitionEvent) => {
    if (event.target === sheet && event.propertyName === expectedProperty) finish();
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

const writeHandoffToken = (
  navigation: ResolvedNavigation,
  navigationId: string
): PageTransitionToken => {
  const token: PageTransitionToken = {
    version: V2_PAGE_TRANSITION_VERSION,
    variant: navigation.variant,
    target: exactV2PageTarget(navigation.url),
    label: navigation.variant === 'h3'
      ? sanitizeV2PageTransitionLabel(navigation.label)
      : '',
    ...(navigation.calmLabel
      ? { calmLabel: sanitizeV2PageTransitionLabel(navigation.calmLabel) }
      : {}),
    from: {
      pathname: navigation.from.normalizedPathname,
      rootSectionId: navigation.from.rootSectionId
    },
    to: {
      pathname: navigation.to.normalizedPathname,
      rootSectionId: navigation.to.rootSectionId
    },
    timestamp: Date.now(),
    nonce: navigationId,
    navigationId
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
    if (stored.navigationId === token.navigationId && stored.nonce === token.nonce) {
      window.sessionStorage.removeItem(V2_PAGE_TRANSITION_KEY);
    }
  } catch {
    // Storage failures must never keep the page locked.
  }
};

const waitForIncomingReadiness = async (): Promise<IncomingReadiness> => {
  const html = document.documentElement;
  const initialState = html.dataset.v2EntranceState;
  if (!initialState) {
    await twoFrames();
    return { kind: 'not-required' };
  }
  if (initialState === 'fail-open') return { kind: 'entrance-fail-open' };
  if (initialState === 'waiting' || initialState === 'revealing' || initialState === 'settled') {
    await nextFrame();
    return {
      kind: 'ready',
      activationId: html.dataset.v2EntranceActivationId
    };
  }

  return new Promise<IncomingReadiness>((resolve) => {
    let settled = false;
    const finish = (outcome: IncomingReadiness) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      document.removeEventListener('v2:entrance-ready', onReady as EventListener);
      document.removeEventListener('v2:entrance-fail-open', onFailOpen as EventListener);
      resolve(outcome);
    };
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      const activationId = typeof detail?.activationId === 'string'
        ? detail.activationId
        : html.dataset.v2EntranceActivationId;
      window.requestAnimationFrame(() => finish({ kind: 'ready', activationId }));
    };
    const onFailOpen = () => finish({ kind: 'entrance-fail-open' });
    const timeout = window.setTimeout(
      () => finish({ kind: 'deadline' }),
      V2_PAGE_TRANSITION_HARD_DEADLINE
    );
    document.addEventListener('v2:entrance-ready', onReady as EventListener, { once: true });
    document.addEventListener('v2:entrance-fail-open', onFailOpen as EventListener, { once: true });
  });
};

const terminalizeEntranceBeforePageReveal = (reason: string) => {
  const html = document.documentElement;
  document.dispatchEvent(new CustomEvent('v2:entrance-fail-open-request', {
    detail: { owner: 'page-transition', state: 'fail-open', reason }
  }));
  // A coordinator that is already initializing consumes the request above
  // synchronously. This persistent fallback also covers a controller bundle
  // that did not register before the 250ms page-readiness deadline.
  if (html.dataset.v2EntranceState === 'fail-open') return;

  const motionRoot = document.querySelector<HTMLElement>(
    '[data-v2-motion-root][data-v2-entry-mode="public"]'
  );
  const detail = {
    activationId: html.dataset.v2EntranceActivationId || null,
    source: html.dataset.v2EntranceSource || null,
    scope: html.dataset.v2EntranceScope || null,
    route: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    state: 'fail-open',
    navigationId: html.dataset.v2PageNavigationId || null,
    reason
  };
  html.dataset.v2EntranceState = 'fail-open';
  html.dataset.v2EntranceController = 'fail-open';
  delete html.dataset.v2MotionProfile;
  delete html.dataset.v2ScrollLocked;
  delete html.dataset.v2EntryLock;
  html.classList.remove('v2-entry-js', 'v2-entry-scroll-locked');
  if (motionRoot) {
    motionRoot.dataset.v2EntranceState = 'fail-open';
    motionRoot.dataset.v2EntranceController = 'fail-open';
    motionRoot.dataset.v2MotionStatic = 'true';
    delete motionRoot.dataset.v2ScrollLocked;
  }
  document.querySelectorAll<HTMLElement>('[data-v2-entrance-role], [data-v2-entrance-runtime-role]')
    .forEach((element) => {
      element.dataset.v2EntranceNode = 'settled';
      delete element.dataset.v2EntranceRuntimeRole;
      element.style.removeProperty('--v2-entrance-duration');
      element.style.removeProperty('will-change');
      element.style.removeProperty('pointer-events');
    });
  document.querySelectorAll<HTMLElement>('[data-v2-scroll-state], [data-v2-scroll-group-state]')
    .forEach((element) => {
      if (element.hasAttribute('data-v2-scroll-state')) element.dataset.v2ScrollState = 'settled';
      if (element.hasAttribute('data-v2-scroll-group-state')) element.dataset.v2ScrollGroupState = 'settled';
      element.style.removeProperty('--v2-scroll-delay');
      element.style.removeProperty('--v2-scroll-duration');
      element.style.removeProperty('will-change');
      element.style.removeProperty('pointer-events');
    });
  document.body?.classList.remove('v2-entry-scroll-locked');
  if (document.body) delete document.body.dataset.v2EntryLock;
  document.dispatchEvent(new CustomEvent('v2:entrance-fail-open', { detail }));
};

const initializeTransitionRoot = (root: HTMLElement) => {
  if (root.dataset.v2PageController === 'ready') return;
  const sheet = root.querySelector<HTMLElement>('[data-v2-page-sheet]');
  if (!sheet) return;

  const routing = readRoutingContext();
  const h3Template = document.querySelector<HTMLTemplateElement>('[data-v2-page-h3-template]');
  let activeVariant: PageTransitionVariant = isPageTransitionVariant(
    document.documentElement.dataset.v2PageVariant
  ) ? document.documentElement.dataset.v2PageVariant : 'h3';

  const clearH3Drawing = () => {
    sheet.replaceChildren();
  };

  const ensureH3Drawing = () => {
    let label = sheet.querySelector<HTMLElement>('[data-v2-page-label]');
    if (label) return label;
    if (h3Template) sheet.append(h3Template.content.cloneNode(true));
    label = sheet.querySelector<HTMLElement>('[data-v2-page-label]');
    return label;
  };

  const prepareDrawing = (variant: PageTransitionVariant) => {
    activeVariant = variant;
    setVariant(root, variant);
    if (variant === 'calm') {
      clearH3Drawing();
      return null;
    }
    return ensureH3Drawing();
  };

  const setTransitionLabel = (label: unknown) => {
    const sanitized = activeVariant === 'h3'
      ? sanitizeV2PageTransitionLabel(label)
      : '';
    const labelElement = activeVariant === 'h3' ? ensureH3Drawing() : null;
    if (activeVariant === 'h3' && !labelElement) return '';
    if (labelElement) labelElement.textContent = sanitized;
    root.dataset.v2PageLabel = sanitized;
    document.documentElement.dataset.v2PageTransitionLabel = sanitized;
    return sanitized;
  };

  prepareDrawing(activeVariant);
  root.dataset.v2PageController = 'ready';
  let busy = false;
  let watchdog = 0;
  let activeToken: PageTransitionToken | null = null;
  let intentTimer = 0;

  const clearWatchdog = () => {
    window.clearTimeout(watchdog);
    watchdog = 0;
  };

  const clearVisualContext = () => {
    setVariant(root, null);
    clearNavigationDiagnostics(root);
    setTransitionLabel('');
  };

  const resetOverlay = (
    state: PageTransitionState = 'idle',
    options: { clearContext?: boolean } = { clearContext: true }
  ) => {
    clearWatchdog();
    clearOwnedToken(activeToken);
    activeToken = null;
    busy = false;
    root.dataset.v2PageSettled = 'true';
    setState(root, state, { preserveBootstrap: state === 'idle' });
    unlockPage(root);
    if (options.clearContext !== false) clearVisualContext();
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
    await waitForSheetTransition(sheet, activeVariant, failOpenDuration(activeVariant));
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

  const beginNavigation = async (navigation: ResolvedNavigation) => {
    if (busy) return;
    const navigationId = createNonce();
    prepareDrawing(navigation.variant);
    const label = setTransitionLabel(navigation.label);
    if (navigation.variant === 'h3' && !label) {
      navigation.variant = 'calm';
      navigation.label = '';
      prepareDrawing('calm');
      setTransitionLabel('');
    }

    busy = true;
    delete root.dataset.v2PageSettled;
    delete root.dataset.v2PageFailure;
    root.dataset.v2PageFromRoot = navigation.from.rootSectionId || '';
    root.dataset.v2PageToRoot = navigation.to.rootSectionId || '';
    document.documentElement.dataset.v2PageFromRoot = navigation.from.rootSectionId || '';
    document.documentElement.dataset.v2PageToRoot = navigation.to.rootSectionId || '';
    setNavigationId(root, navigationId);
    setCriticalStatus(root, 'not-required');
    lockPage(root);
    prefetch(navigation.url.href);
    setState(root, 'covering');
    document.dispatchEvent(new CustomEvent('v2:page-covering', {
      detail: {
        variant: activeVariant,
        navigationId,
        from: navigation.from.normalizedPathname,
        to: navigation.to.normalizedPathname,
        fromRootSectionId: navigation.from.rootSectionId,
        toRootSectionId: navigation.to.rootSectionId
      }
    }));
    await waitForSheetTransition(sheet, activeVariant, coverDuration(activeVariant));
    if (!busy) return;

    setState(root, 'covered');
    document.dispatchEvent(new CustomEvent('v2:page-covered', {
      detail: {
        variant: activeVariant,
        navigationId,
        from: navigation.from.normalizedPathname,
        to: navigation.to.normalizedPathname,
        fromRootSectionId: navigation.from.rootSectionId,
        toRootSectionId: navigation.to.rootSectionId
      }
    }));
    await nextFrame();
    if (!busy) return;

    try {
      activeToken = writeHandoffToken(navigation, navigationId);
    } catch {
      await failOpen('storage-error', navigation.url);
      return;
    }

    setState(root, 'navigating');
    try {
      window.location.assign(navigation.url.href);
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

    const navigation = resolveEligibleNavigation(anchor, root, routing);
    if (!navigation) return;
    event.preventDefault();
    void beginNavigation(navigation).catch(() => {
      void failOpen('controller-error', navigation.url);
    });
  };

  const prefetchFromEvent = (event: Event, delayed: boolean) => {
    if (hasSaveData() || hasSlowConnection()) return;
    const anchor = anchorFromEvent(event);
    if (!anchor) return;
    const navigation = resolveEligibleNavigation(anchor, root, routing);
    if (!navigation) return;

    window.clearTimeout(intentTimer);
    if (delayed) {
      intentTimer = window.setTimeout(() => prefetch(navigation.url.href), 80);
    } else {
      prefetch(navigation.url.href);
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

  const prepareForPageHide = () => {
    clearHeadFailSafe();
    clearWatchdog();
    window.clearTimeout(intentTimer);
    intentTimer = 0;
    // A successfully written token must remain in sessionStorage for the new
    // document. Only the old document's mutable visual state is settled here.
    activeToken = null;
    busy = false;
    root.dataset.v2PageSettled = 'true';
    setState(root, 'done');
    unlockPage(root);
  };

  const onPageShow = () => {
    clearWatchdog();
    clearOwnedToken(activeToken);
    activeToken = null;
    busy = false;
    document.querySelector('[data-v2-page-bootstrap-overlay]')?.remove();
    delete root.dataset.v2PageFailure;
    root.dataset.v2PageCriticalStatus = 'not-required';
    document.documentElement.dataset.v2PageCriticalStatus = 'not-required';
    document.documentElement.dataset.v2PageBootstrap = 'static';
    setState(root, 'idle', { preserveBootstrap: true });
    root.dataset.v2PageSettled = 'true';
    unlockPage(root);
    clearVisualContext();
    dispatchPageEvent('done', root, { outcome: 'bfcache' });
  };

  managedTransitions.set(root, { resetFromPageShow: onPageShow, prepareForPageHide });
  document.addEventListener('click', onClick, { capture: true });
  document.addEventListener('pointerover', (event) => prefetchFromEvent(event, true), { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });
  document.addEventListener('focusin', (event) => prefetchFromEvent(event, false), { passive: true });
  document.addEventListener('pointerdown', onPointerDown, { capture: true });

  const bootstrap = document.documentElement.dataset.v2PageBootstrap;
  const incomingVariant = document.documentElement.dataset.v2PageVariant;
  if (bootstrap === 'arrival' && isPageTransitionVariant(incomingVariant)) {
    clearHeadFailSafe();
    prepareDrawing(incomingVariant);
    const incomingLabel = setTransitionLabel(
      document.documentElement.dataset.v2PageTransitionLabel
    );
    if (incomingVariant === 'h3' && !incomingLabel) {
      root.dataset.v2PageFailure = 'missing-label';
      setCriticalStatus(root, 'controller-error');
      busy = true;
      lockPage(root);
      void failOpen('missing-label');
      return;
    }

    const navigationId = document.documentElement.dataset.v2PageNavigationId || '';
    setNavigationId(root, navigationId);
    root.dataset.v2PageFromRoot = document.documentElement.dataset.v2PageFromRoot || '';
    root.dataset.v2PageToRoot = document.documentElement.dataset.v2PageToRoot || '';
    busy = true;
    delete root.dataset.v2PageSettled;
    lockPage(root);
    setState(root, 'arrival', { preserveBootstrap: true });

    const compactFailure = hasReducedMotion()
      ? 'reduced-motion'
      : hasSaveData()
        ? 'save-data'
        : '';
    if (compactFailure) {
      // Preserve the accepted H3 accessibility arrival contract: the sheet
      // is released immediately and only the universal compact entrance may
      // apply its short opacity fade. Calm inherits the same fail-open rule
      // instead of introducing a second compact transition timing.
      root.dataset.v2PageFailure = compactFailure;
      setCriticalStatus(root, 'not-required');
      setState(root, 'fail-open');
      dispatchPageEvent('revealing', root, {
        outcome: 'fail-open',
        reason: compactFailure
      });
      completeIncoming('fail-open');
      return;
    }

    setState(root, 'waiting', { preserveBootstrap: true });
    setCriticalStatus(root, 'loading');
    void (async () => {
      const outcome = await waitForIncomingReadiness();
      if (!busy) return;

      if (outcome.kind === 'deadline' || outcome.kind === 'entrance-fail-open') {
        setCriticalStatus(root, outcome.kind === 'deadline' ? 'deadline' : 'controller-error');
        if (outcome.kind === 'deadline') terminalizeEntranceBeforePageReveal('entrance-timeout');
        await failOpen(outcome.kind === 'deadline' ? 'entrance-timeout' : 'entrance-fail-open');
        return;
      }

      setCriticalStatus(root, outcome.kind === 'ready' ? 'ready' : 'not-required');
      setState(root, 'revealing', { preserveBootstrap: true });
      dispatchPageEvent('revealing', root, {
        outcome: outcome.kind,
        activationId: outcome.activationId || null
      });
      await waitForSheetTransition(sheet, activeVariant, revealDuration(activeVariant));
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

  if (transitionWindow.__smu1V2PageTransitionLifecycleReady) return;
  transitionWindow.__smu1V2PageTransitionLifecycleReady = true;

  const prepareAllForPageHide = () => {
    document.querySelectorAll<HTMLElement>('[data-v2-page-transition]').forEach((root) => {
      managedTransitions.get(root)?.prepareForPageHide();
    });
  };

  document.addEventListener('v2:prepare-bfcache', prepareAllForPageHide);
  window.addEventListener('pagehide', prepareAllForPageHide);
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    document.querySelectorAll<HTMLElement>('[data-v2-page-transition]').forEach((root) => {
      managedTransitions.get(root)?.resetFromPageShow();
    });
  });
};

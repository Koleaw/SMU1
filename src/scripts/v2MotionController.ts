type EntryState =
  | 'armed'
  | 'logo'
  | 'waiting'
  | 'opening'
  | 'assembling'
  | 'done'
  | 'skipped'
  | 'static'
  | 'fail-open';

type CriticalFailure = 'image-error' | 'font-error';
type ReadinessOutcome =
  | { kind: 'ready' }
  | { kind: 'deadline' }
  | { kind: CriticalFailure; error: unknown };

type ManagedEntry = {
  forceVisible: (
    state: Extract<EntryState, 'done' | 'skipped' | 'static' | 'fail-open'>,
    quiet?: boolean
  ) => void;
};

type MotionWindow = Window & {
  __smu1EntryFailSafe?: number;
  __smu1EntryFailSafeCleanup?: number;
  __smu1V2PageshowReady?: boolean;
};

type ConnectionNavigator = Navigator & {
  connection?: { saveData?: boolean; effectiveType?: string };
};

const SESSION_KEY = 'smu1:entry-intro:v2';
const MIN_OPEN_AT = 1700;
const HARD_DEADLINE_AT = 3900;
const PLANE_DURATION = 760;
const OVERLAY_GONE_AFTER = 800;
const CONTENT_SETTLED_AFTER = 1580;
const managedEntries = new WeakMap<HTMLElement, ManagedEntry>();

const motionWindow = window as MotionWindow;
const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
const waitUntil = (startedAt: number, offset: number) => wait(Math.max(0, startedAt + offset - performance.now()));

class CriticalResourceError extends Error {
  readonly kind: CriticalFailure;

  constructor(kind: CriticalFailure, cause?: unknown) {
    super(kind);
    this.name = 'CriticalResourceError';
    this.kind = kind;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

const clearHeadFailSafe = () => {
  if (motionWindow.__smu1EntryFailSafe !== undefined) {
    window.clearTimeout(motionWindow.__smu1EntryFailSafe);
    delete motionWindow.__smu1EntryFailSafe;
  }
  if (motionWindow.__smu1EntryFailSafeCleanup !== undefined) {
    window.clearTimeout(motionWindow.__smu1EntryFailSafeCleanup);
    delete motionWindow.__smu1EntryFailSafeCleanup;
  }
};

const unlockScroll = (root: HTMLElement) => {
  const html = document.documentElement;
  delete root.dataset.v2ScrollLocked;
  delete html.dataset.v2ScrollLocked;
  delete html.dataset.v2EntryLock;
  html.classList.remove('v2-entry-scroll-locked');
  document.body.classList.remove('v2-entry-scroll-locked');
  delete document.body.dataset.v2EntryLock;
};

const lockScroll = (root: HTMLElement) => {
  const html = document.documentElement;
  root.dataset.v2ScrollLocked = 'true';
  html.dataset.v2ScrollLocked = 'true';
  html.classList.add('v2-entry-scroll-locked');
  document.body.classList.add('v2-entry-scroll-locked');
};

const dispatchEntryEvent = (root: HTMLElement, name: 'opening' | 'done') => {
  root.dispatchEvent(new CustomEvent(`v2:entry-${name}`, {
    bubbles: false,
    detail: { state: root.dataset.v2MotionState || name }
  }));
};

const setDiagnosticState = (
  root: HTMLElement,
  overlay: HTMLElement,
  state: EntryState,
  overlayState: EntryState = state
) => {
  root.dataset.v2MotionState = state;
  overlay.dataset.v2EntryState = overlayState;
  document.documentElement.dataset.v2MotionState = state;
};

const waitForCriticalImage = (image: HTMLImageElement): Promise<void> => new Promise((resolve, reject) => {
  let settled = false;

  const cleanup = () => {
    image.removeEventListener('load', onLoad);
    image.removeEventListener('error', onError);
  };

  const finish = async () => {
    if (settled) return;
    if (image.naturalWidth <= 0) {
      settled = true;
      cleanup();
      reject(new CriticalResourceError('image-error'));
      return;
    }

    try {
      if (typeof image.decode === 'function') await image.decode();
    } catch (error) {
      // A loaded image can reject decode() transiently while still being fully
      // usable. Only naturalWidth=0 or an actual error event is a broken image.
      if (image.naturalWidth <= 0) {
        settled = true;
        cleanup();
        reject(new CriticalResourceError('image-error', error));
        return;
      }
    }

    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  };

  const onLoad = () => { void finish(); };
  const onError = (event: Event) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(new CriticalResourceError('image-error', event));
  };

  image.addEventListener('load', onLoad, { once: true });
  image.addEventListener('error', onError, { once: true });
  if (image.complete) queueMicrotask(() => { void finish(); });
});

const waitForFontStylesheet = () => new Promise<void>((resolve, reject) => {
  const stylesheet = document.querySelector<HTMLLinkElement>('[data-v2-font-stylesheet]');
  if (!stylesheet) {
    reject(new CriticalResourceError('font-error'));
    return;
  }

  if (stylesheet.dataset.v2FontState === 'error') {
    reject(new CriticalResourceError('font-error'));
    return;
  }
  if (stylesheet.dataset.v2FontState === 'loaded' || stylesheet.sheet) {
    resolve();
    return;
  }

  const cleanup = () => {
    stylesheet.removeEventListener('load', onLoad);
    stylesheet.removeEventListener('error', onError);
  };
  const onLoad = () => {
    cleanup();
    resolve();
  };
  const onError = (event: Event) => {
    cleanup();
    reject(new CriticalResourceError('font-error', event));
  };
  stylesheet.addEventListener('load', onLoad, { once: true });
  stylesheet.addEventListener('error', onError, { once: true });
});

const waitForCriticalFonts = async () => {
  if (!('fonts' in document) || typeof document.fonts?.load !== 'function') {
    throw new CriticalResourceError('font-error');
  }
  try {
    await waitForFontStylesheet();
    // These are the weights actually visible in Header and Hero copy/actions.
    const faces = await Promise.all([
      document.fonts.load('400 1em Manrope', 'СМУ Изделия конструкции'),
      document.fonts.load('600 1em Manrope', 'СМУ Изделия конструкции'),
      document.fonts.load('700 1em Manrope', 'СМУ Изделия конструкции')
    ]);
    if (faces.some((weightFaces) => weightFaces.length === 0)) {
      throw new CriticalResourceError('font-error');
    }
  } catch (error) {
    if (error instanceof CriticalResourceError) throw error;
    throw new CriticalResourceError('font-error', error);
  }
};

const resolveBootstrapMode = (): EntryState => {
  const html = document.documentElement;
  const existing = html.dataset.v2EntryBootstrap as EntryState | undefined;
  if (existing) return existing;

  const params = new URLSearchParams(window.location.search);
  const forcedReplay = params.get('intro') === 'replay' || params.get('intro') === 'slow';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = Boolean((navigator as ConnectionNavigator).connection?.saveData);
  let mode: EntryState = 'armed';

  try {
    if (html.dataset.v2PageBootstrap === 'arrival') {
      window.sessionStorage.setItem(SESSION_KEY, 'seen');
      mode = 'static';
    } else if (window.location.hash) {
      window.sessionStorage.setItem(SESSION_KEY, 'seen');
      mode = 'skipped';
    } else if (reducedMotion || saveData) {
      window.sessionStorage.setItem(SESSION_KEY, 'seen');
      mode = 'static';
    } else {
      const seen = window.sessionStorage.getItem(SESSION_KEY) === 'seen';
      if (!forcedReplay && seen) mode = 'static';
      else window.sessionStorage.setItem(SESSION_KEY, 'seen');
    }
  } catch {
    mode = 'fail-open';
  }

  html.dataset.v2EntryBootstrap = mode;
  return mode;
};

const initializePreviewScrollChoreography = (
  root: HTMLElement,
  reducedMotion: boolean,
  revealImmediately = false
) => {
  const scrollScope = root.querySelector<HTMLElement>('[data-home-final-root]');
  if (!scrollScope) return () => undefined;
  const elements = Array.from(scrollScope.querySelectorAll<HTMLElement>('[data-v2-reveal]'))
    .filter((element) => !element.hasAttribute('data-v2-entry'));
  if (elements.length === 0) return () => undefined;

  let observer: IntersectionObserver | undefined;
  const reveal = (element: HTMLElement) => {
    if (element.dataset.v2RevealState === 'visible') return;
    element.dataset.v2RevealState = 'visible';
    element.classList.add('is-v2-revealed');
    observer?.unobserve(element);
    window.setTimeout(() => element.style.removeProperty('--v2-reveal-delay'), 900);
  };

  if (reducedMotion || revealImmediately || !('IntersectionObserver' in window)) {
    elements.forEach(reveal);
    return () => undefined;
  }

  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) reveal(entry.target as HTMLElement);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

  elements.forEach((element, index) => {
    const rect = element.getBoundingClientRect();
    const alreadyReached = rect.bottom >= 0 && rect.top < window.innerHeight * 0.92;
    element.style.setProperty('--v2-reveal-delay', `${Math.min(index % 4, 3) * 70}ms`);
    if (alreadyReached) reveal(element);
    else {
      element.dataset.v2RevealState = 'pending';
      observer?.observe(element);
    }
  });

  return () => observer?.disconnect();
};

const initializeMotionRoot = (root: HTMLElement) => {
  if (root.dataset.v2MotionController === 'ready') return;
  const overlay = root.querySelector<HTMLElement>('[data-v2-entry-root]');
  if (!overlay) return;

  const isLegacyPreview = root.dataset.v2EntryMode === 'preview';
  if (isLegacyPreview) root.dataset.v2MotionActive = 'true';
  root.dataset.v2MotionController = 'ready';
  document.documentElement.dataset.v2EntryControllerReady = 'true';

  const entryParts = isLegacyPreview
    ? Array.from(root.querySelectorAll<HTMLElement>('[data-v2-entry]'))
    : [];
  const header = isLegacyPreview
    ? root.querySelector<HTMLElement>('[data-v2-entry="header"]')
    : null;
  const skipLink = root.querySelector<HTMLElement>('[data-v2-entry-skip-link]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mode = resolveBootstrapMode();
  const timers = new Set<number>();
  let cancelled = false;
  let entryDoneDispatched = false;
  let disconnectPreviewScroll: () => void = () => undefined;

  const schedule = (callback: () => void, milliseconds: number) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!cancelled) callback();
    }, milliseconds);
    timers.add(timer);
    return timer;
  };

  const clearTimers = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
  };

  const markPreviewEntriesVisible = () => {
    if (!isLegacyPreview) return;
    entryParts.forEach((element) => { element.dataset.v2EntryVisible = 'true'; });
    header?.classList.add('is-ready');
  };

  const forceVisible = (
    state: Extract<EntryState, 'done' | 'skipped' | 'static' | 'fail-open'>,
    quiet = false
  ) => {
    cancelled = true;
    clearTimers();
    disconnectPreviewScroll();
    setDiagnosticState(root, overlay, state);
    root.dataset.v2EntrySettled = 'true';
    delete root.dataset.v2EntryStartedAt;
    if (root.dataset.v2CriticalStatus === 'loading') root.dataset.v2CriticalStatus = 'cancelled';
    markPreviewEntriesVisible();
    if (isLegacyPreview) {
      root.querySelectorAll<HTMLElement>('[data-v2-reveal]').forEach((element) => {
        element.dataset.v2RevealState = 'visible';
        element.classList.add('is-v2-revealed');
        element.style.removeProperty('--v2-reveal-delay');
      });
    }
    unlockScroll(root);
    document.documentElement.classList.remove('v2-entry-js');
    clearHeadFailSafe();
    if (!quiet && !entryDoneDispatched) {
      entryDoneDispatched = true;
      dispatchEntryEvent(root, 'done');
    }
    if (!isLegacyPreview && !quiet && document.documentElement.dataset.v2EntranceState === 'waiting') {
      document.dispatchEvent(new CustomEvent('v2:entrance-fail-open-request', {
        detail: { owner: 'first-entry', state }
      }));
    }
  };

  managedEntries.set(root, { forceVisible });
  root.addEventListener('v2:entry-cancel', () => forceVisible('fail-open', true), { once: true });

  const skipEntry = () => forceVisible('skipped');
  skipLink?.addEventListener('focus', skipEntry, { once: true });
  skipLink?.addEventListener('click', skipEntry, { once: true });

  if (mode !== 'armed') {
    setDiagnosticState(root, overlay, mode);
    root.dataset.v2EntrySettled = 'true';
    root.dataset.v2CriticalStatus = 'not-required';
    markPreviewEntriesVisible();
    unlockScroll(root);
    document.documentElement.classList.remove('v2-entry-js');
    clearHeadFailSafe();
    if (isLegacyPreview) {
      disconnectPreviewScroll = initializePreviewScrollChoreography(
        root,
        reducedMotion,
        mode === 'fail-open'
      );
    }
    entryDoneDispatched = true;
    dispatchEntryEvent(root, 'done');
    return;
  }

  lockScroll(root);
  setDiagnosticState(root, overlay, 'armed');
  if (isLegacyPreview) {
    disconnectPreviewScroll = initializePreviewScrollChoreography(root, reducedMotion);
  }
  const startedAt = performance.now();
  root.dataset.v2EntryStartedAt = String(Math.round(startedAt));
  root.dataset.v2CriticalStatus = 'loading';

  const readiness = (async (): Promise<ReadinessOutcome> => {
    try {
      const criticalImages = Array.from(root.querySelectorAll<HTMLImageElement>(
        'img[data-v2-critical-media], img[data-v2-page-critical]'
      ));
      await Promise.all([
        Promise.all(criticalImages.map(waitForCriticalImage)),
        waitForCriticalFonts()
      ]);
      if (new URLSearchParams(window.location.search).get('intro') === 'slow') {
        await waitUntil(startedAt, 3300);
      }
      return { kind: 'ready' };
    } catch (error) {
      if (error instanceof CriticalResourceError) return { kind: error.kind, error };
      return { kind: 'font-error', error };
    }
  })();

  const deadline = waitUntil(startedAt, HARD_DEADLINE_AT).then<ReadinessOutcome>(() => ({ kind: 'deadline' }));

  schedule(() => setDiagnosticState(root, overlay, 'logo'), 100);
  schedule(() => {
    // Commit the collapsed line before changing its target. On a busy first
    // paint timers can otherwise coalesce the initial and waiting states.
    const axis = overlay.querySelector<HTMLElement>('[data-v2-entry-axis]');
    if (axis) void getComputedStyle(axis).transform;
    requestAnimationFrame(() => {
      if (!cancelled && overlay.dataset.v2EntryState === 'logo') {
        setDiagnosticState(root, overlay, 'waiting');
      }
    });
  }, 650);
  // All managed fallbacks are installed; the module controller now owns both
  // the 3900ms deadline and final cleanup.
  clearHeadFailSafe();

  void (async () => {
    const outcome = await Promise.race([readiness, deadline]);
    if (cancelled) return;
    root.dataset.v2CriticalStatus = outcome.kind;

    if (outcome.kind === 'deadline') await waitUntil(startedAt, HARD_DEADLINE_AT);
    else await waitUntil(startedAt, MIN_OPEN_AT);
    if (cancelled) return;

    const failOpen = outcome.kind !== 'ready';

    // The universal entrance coordinator is normally ready long before the
    // accepted 1700ms opening point. If its pre-paint marker exists but module
    // registration is still finishing, give the handshake one bounded beat;
    // the normal first-entry timing remains unchanged.
    if (
      document.documentElement.dataset.v2EntranceState === 'armed'
      && document.documentElement.dataset.v2EntranceController !== 'ready'
    ) {
      await Promise.race([
        new Promise<void>((resolve) => {
          document.addEventListener('v2:entrance-ready', () => resolve(), { once: true });
        }),
        wait(250)
      ]);
    }
    if (cancelled) return;

    setDiagnosticState(root, overlay, failOpen ? 'fail-open' : 'opening', 'opening');
    dispatchEntryEvent(root, 'opening');

    if (isLegacyPreview) {
      const entryDelays: Record<string, number> = {
        media: 0,
        header: 160,
        meta: 220,
        title: 280,
        lead: 500,
        support: 560,
        actions: 620,
        control: 740
      };
      entryParts.forEach((element) => {
        const delay = entryDelays[element.dataset.v2Entry || ''] ?? 0;
        schedule(() => {
          element.dataset.v2EntryVisible = 'true';
          if (element.dataset.v2Entry === 'header') element.classList.add('is-ready');
        }, delay);
      });
    }

    schedule(() => {
      overlay.dataset.v2EntryState = 'assembling';
      if (!failOpen) {
        root.dataset.v2MotionState = 'assembling';
        document.documentElement.dataset.v2MotionState = 'assembling';
      }
    }, PLANE_DURATION);

    schedule(() => {
      overlay.dataset.v2EntryState = 'done';
      if (!failOpen) {
        root.dataset.v2MotionState = 'done';
        document.documentElement.dataset.v2MotionState = 'done';
      }
      unlockScroll(root);
      document.documentElement.classList.remove('v2-entry-js');
      clearHeadFailSafe();
      if (!entryDoneDispatched) {
        entryDoneDispatched = true;
        dispatchEntryEvent(root, 'done');
      }
    }, OVERLAY_GONE_AFTER);

    schedule(() => {
      root.dataset.v2EntrySettled = 'true';
      delete root.dataset.v2EntryStartedAt;
    }, CONTENT_SETTLED_AFTER);
  })().catch(() => forceVisible('fail-open'));
};

export const initializeV2MotionController = () => {
  const roots = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-v2-motion-root][data-v2-entry-mode]'
  ));
  roots.forEach(initializeMotionRoot);

  if (motionWindow.__smu1V2PageshowReady) return;
  motionWindow.__smu1V2PageshowReady = true;
  const settleEntryOverlays = () => {
    document.querySelectorAll<HTMLElement>('[data-v2-motion-root][data-v2-entry-mode]')
      .forEach((root) => managedEntries.get(root)?.forceVisible('done', true));
  };
  window.addEventListener('pagehide', settleEntryOverlays);
  document.addEventListener('v2:prepare-bfcache', settleEntryOverlays);
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    settleEntryOverlays();
  });
};

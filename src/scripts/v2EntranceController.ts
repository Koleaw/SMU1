type EntranceRole =
  | 'media'
  | 'header-logo'
  | 'header-nav'
  | 'header-actions'
  | 'context'
  | 'title-primary'
  | 'title-secondary'
  | 'lead'
  | 'actions-meta'
  | 'support';

type EntranceSource =
  | 'first-entry'
  | 'direct'
  | 'reload'
  | 'mpa-h3'
  | 'mpa-calm'
  | 'history-document';

type EntranceScope = 'hero' | 'viewport' | 'hash-target';
type EntranceState = 'armed' | 'waiting' | 'revealing' | 'settled' | 'fail-open';
type MotionProfile = 'normal' | 'reduce' | 'save-data';
type ScrollRole = 'title' | 'copy' | 'actions' | 'media' | 'card';

type EntranceDetail = {
  activationId: string;
  source: EntranceSource;
  scope: EntranceScope;
  route: string;
  state: EntranceState;
  navigationId?: string;
};

type EntranceItem = {
  element: HTMLElement;
  role: EntranceRole;
  runtimeRole: boolean;
};

type ScrollItem = {
  element: HTMLElement;
  role: ScrollRole;
  runtimeNode: boolean;
};

type ScrollGroup = {
  container: HTMLElement;
  trigger: HTMLElement;
  items: ScrollItem[];
  consumed: boolean;
};

type ManagedEntrance = {
  prepareForPagehide: (persisted: boolean) => void;
  restorePersisted: () => void;
};

type NetworkInformationLike = EventTarget & {
  saveData?: boolean;
};

type EntranceWindow = Window & {
  __smu1EntranceFailSafe?: number;
  __smu1EntranceFailSafeCleanup?: number;
  __smu1EntranceLifecycleReady?: boolean;
};

const ROLE_ORDER: readonly EntranceRole[] = [
  'media',
  'header-logo',
  'header-nav',
  'header-actions',
  'context',
  'title-primary',
  'title-secondary',
  'lead',
  'actions-meta',
  'support'
];

const DESKTOP_TIMINGS: Record<EntranceRole, readonly [number, number]> = {
  media: [0, 1150],
  'header-logo': [100, 780],
  'header-nav': [200, 780],
  'header-actions': [300, 780],
  context: [360, 760],
  'title-primary': [540, 980],
  'title-secondary': [720, 980],
  lead: [880, 880],
  'actions-meta': [1080, 820],
  support: [1240, 760]
};

const MOBILE_TIMINGS: Record<EntranceRole, readonly [number, number]> = {
  media: [0, 900],
  'header-logo': [70, 650],
  // Desktop navigation is settled before the role map is armed on mobile.
  'header-nav': [0, 0],
  'header-actions': [170, 650],
  context: [260, 620],
  'title-primary': [420, 850],
  'title-secondary': [560, 850],
  lead: [720, 760],
  'actions-meta': [900, 700],
  support: [1020, 650]
};

const SCROLL_TIMINGS: Record<ScrollRole, readonly [number, number]> = {
  title: [0, 900],
  copy: [160, 820],
  actions: [300, 760],
  media: [360, 1000],
  card: [420, 820]
};

const SCROLL_ROLES: readonly ScrollRole[] = ['title', 'copy', 'actions', 'media', 'card'];

const INTERACTIVE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SEMANTIC_SECTION_SELECTOR = 'section, article, [role="region"], [data-v2-scroll-section]';
const managedEntrances = new WeakMap<HTMLElement, ManagedEntrance>();
const entranceWindow = window as EntranceWindow;

const scheduleFrame = (callback: () => void) => window.requestAnimationFrame(callback);

const createActivationId = () => {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `v2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const getConnection = (): NetworkInformationLike | undefined => {
  const extendedNavigator = navigator as Navigator & {
    connection?: NetworkInformationLike;
    mozConnection?: NetworkInformationLike;
    webkitConnection?: NetworkInformationLike;
  };
  return extendedNavigator.connection
    ?? extendedNavigator.mozConnection
    ?? extendedNavigator.webkitConnection;
};

const resolveMotionProfile = (): MotionProfile => {
  const declared = document.documentElement.dataset.v2MotionProfile;
  if (declared === 'normal' || declared === 'reduce' || declared === 'save-data') return declared;
  return detectMotionProfile();
};

const detectMotionProfile = (): MotionProfile => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduce';
  if (getConnection()?.saveData) return 'save-data';
  return 'normal';
};

const resolveNavigationType = () => {
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return entry?.type;
};

const resolveSource = (): EntranceSource => {
  const html = document.documentElement;
  const pageVariant = html.dataset.v2PageVariant;
  const pageArrival = html.dataset.v2PageBootstrap === 'arrival';
  if (pageArrival || pageVariant === 'h3' || pageVariant === 'calm') {
    return pageVariant === 'calm' ? 'mpa-calm' : 'mpa-h3';
  }
  if (html.dataset.v2EntryBootstrap === 'armed') return 'first-entry';
  const navigationType = resolveNavigationType();
  if (navigationType === 'reload') return 'reload';
  if (navigationType === 'back_forward') return 'history-document';
  return 'direct';
};

const getHeaderHeight = () => {
  const header = document.querySelector<HTMLElement>('[data-home-v2-header]');
  return Math.max(0, header?.getBoundingClientRect().height ?? 0);
};

const findHashTarget = (): HTMLElement | null => {
  const rawHash = window.location.hash.slice(1);
  if (!rawHash) return null;
  let id = rawHash;
  try { id = decodeURIComponent(rawHash); } catch { id = rawHash; }
  return document.getElementById(id);
};

const waitForRestoredScroll = () => new Promise<void>((resolve) => {
  const startedAt = performance.now();
  let previous = window.scrollY;
  let stableFrames = 0;

  const sample = () => {
    const current = window.scrollY;
    stableFrames = current === previous ? stableFrames + 1 : 0;
    previous = current;
    if (stableFrames >= 2 || performance.now() - startedAt >= 250) {
      resolve();
      return;
    }
    scheduleFrame(sample);
  };

  scheduleFrame(sample);
});

const resolveScope = async (source: EntranceSource): Promise<EntranceScope> => {
  if (findHashTarget()) return 'hash-target';
  if (source === 'reload' || source === 'history-document') await waitForRestoredScroll();
  return window.scrollY > getHeaderHeight() ? 'viewport' : 'hero';
};

const isEntranceRole = (value: string | undefined): value is EntranceRole => (
  value !== undefined && ROLE_ORDER.includes(value as EntranceRole)
);

const isScrollRole = (value: string | undefined): value is ScrollRole => (
  value !== undefined && SCROLL_ROLES.includes(value as ScrollRole)
);

const isHeaderRole = (role: EntranceRole) => (
  role === 'header-logo' || role === 'header-nav' || role === 'header-actions'
);

const roleSelector = '[data-v2-entrance-role], [data-v2-entrance-runtime-role]';

const hasSameRoleAncestor = (element: HTMLElement, role: EntranceRole) => {
  let ancestor = element.parentElement?.closest<HTMLElement>('[data-v2-entrance-role]') ?? null;
  while (ancestor) {
    if (ancestor.dataset.v2EntranceRole === role) return true;
    ancestor = ancestor.parentElement?.closest<HTMLElement>('[data-v2-entrance-role]') ?? null;
  }
  return false;
};

const collectDeclaredEntranceItems = (root: HTMLElement): EntranceItem[] => (
  Array.from(root.querySelectorAll<HTMLElement>('[data-v2-entrance-role]'))
    .map((element): EntranceItem | null => {
      const role = element.dataset.v2EntranceRole;
      if (!isEntranceRole(role) || hasSameRoleAncestor(element, role)) return null;
      return { element, role, runtimeRole: false };
    })
    .filter((item): item is EntranceItem => item !== null)
);

const findSectionContainer = (element: HTMLElement, root: HTMLElement) => {
  const explicitSection = element.closest<HTMLElement>('[data-v2-scroll-section]');
  if (explicitSection && root.contains(explicitSection)) return explicitSection;

  const semantic = element.closest<HTMLElement>(SEMANTIC_SECTION_SELECTOR);
  if (semantic && root.contains(semantic)) {
    // A repeated reveal-card can itself be an <article>. In that case the
    // owning section/list is the choreography boundary, not every card.
    if (semantic === element && (
      element.matches('article, li')
      || /(?:^|__|--)(?:card|item)(?:$|__|--)/i.test(element.className)
    )) {
      const parentSection = element.parentElement?.closest<HTMLElement>(SEMANTIC_SECTION_SELECTOR);
      if (parentSection && root.contains(parentSection)) return parentSection;
      const stableList = element.parentElement?.closest<HTMLElement>('ul, ol, [role="list"], [class*="grid"], [class*="list"]');
      if (stableList && root.contains(stableList)) return stableList;
    }
    return semantic;
  }
  const directMainChild = element.closest<HTMLElement>('main > div, main > header');
  return directMainChild && root.contains(directMainChild) ? directMainChild : element;
};

const inferScrollRole = (element: HTMLElement, declared = ''): ScrollRole => {
  const explicitRole = element.dataset.v2ScrollRole;
  if (isScrollRole(explicitRole)) return explicitRole;

  const hint = `${declared} ${element.className}`.toLowerCase();
  if (declared === 'title' || /section-heading|section-head|__heading/.test(hint) || /^H[1-6]$/.test(element.tagName)) return 'title';
  if (declared.includes('media') || /media|gallery|viewer|image|photo/.test(hint) || element.matches('picture, img, video, figure')) return 'media';
  if (/action|control|filter|channel|related/.test(hint) || element.matches('nav')) return 'actions';
  if (declared === 'group' || element.matches('li') || /card|item|sequence|grid|list/.test(hint)) return 'card';
  return 'copy';
};

const expandRevealCandidate = (candidate: HTMLElement): ScrollItem[] => {
  const explicitRole = candidate.dataset.v2ScrollRole;
  if (isScrollRole(explicitRole)) {
    return [{ element: candidate, role: explicitRole, runtimeNode: false }];
  }

  const declared = candidate.dataset.v2Reveal ?? '';
  const expandableGroup = declared === 'group'
    && candidate.matches('div, ol, ul')
    && !candidate.matches(INTERACTIVE_SELECTOR);
  if (!expandableGroup) {
    return [{ element: candidate, role: inferScrollRole(candidate, declared), runtimeNode: false }];
  }
  const children = Array.from(candidate.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement);
  if (children.length === 0) {
    return [{ element: candidate, role: 'card', runtimeNode: false }];
  }
  return children.map((element) => ({ element, role: 'card', runtimeNode: true }));
};

const findGroupTrigger = (container: HTMLElement, items: ScrollItem[]) => {
  const heading = container.querySelector<HTMLElement>('h2, h3, h4, [data-v2-section-trigger]');
  return heading ?? items[0]?.element ?? container;
};

const buildScrollGroups = (root: HTMLElement): ScrollGroup[] => {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-v2-reveal]'))
    .filter((element) => !element.matches(roleSelector))
    .filter((element) => !element.closest(roleSelector))
    .filter((element) => !element.querySelector(roleSelector));
  const byContainer = new Map<HTMLElement, ScrollItem[]>();

  candidates.forEach((candidate) => {
    const container = findSectionContainer(candidate, root);
    const items = byContainer.get(container) ?? [];
    expandRevealCandidate(candidate).forEach((item) => {
      if (!items.some((existing) => existing.element === item.element)) items.push(item);
    });
    byContainer.set(container, items);
  });

  return Array.from(byContainer, ([container, items]) => ({
    container,
    trigger: findGroupTrigger(container, items),
    items,
    consumed: false
  }));
};

const groupContains = (group: ScrollGroup, element: HTMLElement) => (
  group.container === element || group.container.contains(element)
);

const findScopedGroup = (groups: ScrollGroup[], scope: EntranceScope) => {
  if (scope === 'hash-target') {
    const target = findHashTarget();
    if (!target) return undefined;
    return groups.find((group) => groupContains(group, target));
  }
  if (scope !== 'viewport') return undefined;
  const headerHeight = getHeaderHeight();
  return groups
    .filter((group) => {
      const rect = group.trigger.getBoundingClientRect();
      return rect.bottom > headerHeight && rect.top < window.innerHeight;
    })
    .sort((left, right) => (
      Math.abs(left.trigger.getBoundingClientRect().top - headerHeight)
      - Math.abs(right.trigger.getBoundingClientRect().top - headerHeight)
    ))[0];
};

const scrollRoleToEntranceRole = (role: ScrollRole): EntranceRole => {
  if (role === 'title') return 'title-primary';
  if (role === 'copy') return 'lead';
  if (role === 'actions') return 'actions-meta';
  if (role === 'media') return 'media';
  return 'support';
};

const setEntranceNodeFinal = (item: EntranceItem) => {
  const { element } = item;
  element.dataset.v2EntranceNode = 'settled';
  element.style.removeProperty('--v2-entrance-duration');
  element.style.removeProperty('will-change');
  element.style.removeProperty('pointer-events');
};

const clearBlockingState = (root: HTMLElement) => {
  const html = document.documentElement;
  delete root.dataset.v2ScrollLocked;
  delete html.dataset.v2ScrollLocked;
  delete html.dataset.v2EntryLock;
  html.classList.remove('v2-entry-js', 'v2-entry-scroll-locked');
  document.body?.classList.remove('v2-entry-scroll-locked');
  if (document.body) delete document.body.dataset.v2EntryLock;
};

const clearHeadEntranceFailSafe = () => {
  if (entranceWindow.__smu1EntranceFailSafe !== undefined) {
    window.clearTimeout(entranceWindow.__smu1EntranceFailSafe);
    delete entranceWindow.__smu1EntranceFailSafe;
  }
  if (entranceWindow.__smu1EntranceFailSafeCleanup !== undefined) {
    window.clearTimeout(entranceWindow.__smu1EntranceFailSafeCleanup);
    delete entranceWindow.__smu1EntranceFailSafeCleanup;
  }
};

const settleTerminalEntranceRoot = (root: HTMLElement) => {
  const html = document.documentElement;
  html.dataset.v2EntranceState = 'fail-open';
  html.dataset.v2EntranceController = 'fail-open';
  html.dataset.v2EntryBootstrap = 'fail-open';
  html.dataset.v2MotionState = 'fail-open';
  delete html.dataset.v2MotionProfile;
  delete html.dataset.v2EntranceActivationId;
  root.dataset.v2EntranceState = 'fail-open';
  root.dataset.v2EntranceController = 'fail-open';
  root.dataset.v2MotionStatic = 'true';
  root.dataset.v2MotionState = 'fail-open';
  root.dataset.v2EntrySettled = 'true';
  delete root.dataset.v2EntranceActivationId;
  document.querySelectorAll<HTMLElement>('[data-v2-entry-root], [data-v2-entry-overlay]')
    .forEach((overlay) => { overlay.dataset.v2EntryState = 'fail-open'; });
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
  clearBlockingState(root);
  clearHeadEntranceFailSafe();
};

const initializeEntranceRoot = async (root: HTMLElement) => {
  if (managedEntrances.has(root) || root.dataset.v2EntranceController === 'ready') return;

  const html = document.documentElement;
  if (html.dataset.v2EntranceState === 'fail-open' || root.dataset.v2MotionStatic === 'true') {
    settleTerminalEntranceRoot(root);
    return;
  }
  const profile = resolveMotionProfile();
  const source = resolveSource();
  const activationId = createActivationId();
  const route = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const navigationId = html.dataset.v2PageNavigationId;
  const abortController = new AbortController();
  const { signal } = abortController;
  const entranceTimers = new Set<number>();
  const scrollTimers = new Set<number>();
  const entranceFrames = new Set<number>();
  const scrollFrames = new Set<number>();
  let observer: IntersectionObserver | undefined;
  let scope: EntranceScope = findHashTarget() ? 'hash-target' : 'hero';
  let state: EntranceState = 'armed';
  let started = false;
  let covering = false;
  let entranceTerminal = false;
  let lifecycleStopped = false;
  let readyDispatched = false;
  let doneDispatched = false;
  let scrollGroups: ScrollGroup[] = [];
  let entranceItems: EntranceItem[] = [];

  html.dataset.v2MotionProfile = profile;
  html.dataset.v2EntranceState = 'armed';
  html.dataset.v2EntranceSource = source;
  html.dataset.v2EntranceScope = scope;
  html.dataset.v2EntranceActivationId = activationId;
  root.dataset.v2EntranceController = 'initializing';
  root.dataset.v2EntranceActivationId = activationId;
  root.dataset.v2EntranceSource = source;
  root.dataset.v2EntranceScope = scope;

  const detail = (nextState = state): EntranceDetail => ({
    activationId,
    source,
    scope,
    route,
    state: nextState,
    ...(navigationId ? { navigationId } : {})
  });

  const dispatch = (name: 'ready' | 'start' | 'done' | 'fail-open', nextState = state) => {
    document.dispatchEvent(new CustomEvent(`v2:entrance-${name}`, { detail: detail(nextState) }));
  };

  const scheduleIn = (
    collection: Set<number>,
    callback: () => void,
    delay: number,
    canRun: () => boolean
  ) => {
    const timer = window.setTimeout(() => {
      collection.delete(timer);
      if (canRun()) callback();
    }, delay);
    collection.add(timer);
    return timer;
  };

  const frameIn = (
    collection: Set<number>,
    callback: () => void,
    canRun: () => boolean
  ) => {
    const frameId = scheduleFrame(() => {
      collection.delete(frameId);
      if (canRun()) callback();
    });
    collection.add(frameId);
    return frameId;
  };

  const scheduleEntrance = (callback: () => void, delay: number) => (
    scheduleIn(entranceTimers, callback, delay, () => !entranceTerminal && !lifecycleStopped)
  );
  const scheduleScroll = (callback: () => void, delay: number) => (
    scheduleIn(scrollTimers, callback, delay, () => !lifecycleStopped)
  );
  const frameEntrance = (callback: () => void) => (
    frameIn(entranceFrames, callback, () => !entranceTerminal && !lifecycleStopped)
  );
  const frameScroll = (callback: () => void) => (
    frameIn(scrollFrames, callback, () => !lifecycleStopped)
  );

  const clearCollection = (timers: Set<number>, frames: Set<number>) => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    frames.forEach((frameId) => window.cancelAnimationFrame(frameId));
    frames.clear();
  };

  const cleanupNode = (element: HTMLElement) => {
    element.style.removeProperty('will-change');
    element.style.removeProperty('pointer-events');
  };

  const settleScrollGroup = (group: ScrollGroup, consumed = group.consumed) => {
    group.consumed = consumed;
    observer?.unobserve(group.trigger);
    group.container.dataset.v2ScrollGroupState = consumed ? 'consumed' : 'settled';
    group.items.forEach(({ element, runtimeNode }) => {
      element.dataset.v2ScrollState = 'settled';
      cleanupNode(element);
      element.style.removeProperty('--v2-scroll-delay');
      element.style.removeProperty('--v2-scroll-duration');
      if (runtimeNode) delete element.dataset.v2ScrollRole;
    });
  };

  const revealScrollGroup = (group: ScrollGroup) => {
    if (group.consumed || group.container.dataset.v2ScrollGroupState !== 'pending') return;
    observer?.unobserve(group.trigger);
    group.container.dataset.v2ScrollGroupState = 'revealing';
    let lastCompletion = 0;
    let cardIndex = 0;

    group.items.forEach((item) => {
      const base = SCROLL_TIMINGS[item.role];
      const delay = item.role === 'card'
        ? base[0] + Math.min(cardIndex++, 4) * 90
        : base[0];
      const duration = item.role === 'card' ? Math.min(850, base[1] + Math.min(cardIndex - 1, 3) * 10) : base[1];
      lastCompletion = Math.max(lastCompletion, delay + duration);
      item.element.style.setProperty('--v2-scroll-delay', '0ms');
      item.element.style.setProperty('--v2-scroll-duration', `${duration}ms`);
      scheduleScroll(() => {
        if (
          group.container.dataset.v2ScrollGroupState !== 'revealing'
          || item.element.dataset.v2ScrollState !== 'pending'
        ) return;
        item.element.style.setProperty('will-change', item.role === 'media' ? 'opacity, scale' : 'opacity, translate');
        frameScroll(() => {
          if (
            group.container.dataset.v2ScrollGroupState !== 'revealing'
            || item.element.dataset.v2ScrollState !== 'pending'
          ) {
            cleanupNode(item.element);
            return;
          }
          item.element.style.removeProperty('pointer-events');
          item.element.dataset.v2ScrollState = 'revealing';
          const removeWillChange = () => cleanupNode(item.element);
          item.element.addEventListener('transitionend', removeWillChange, { once: true, signal });
          scheduleScroll(removeWillChange, duration + 50);
        });
      }, Math.max(0, delay - 18));
    });

    scheduleScroll(() => settleScrollGroup(group), lastCompletion + 32);
  };

  const settleAllScrollGroups = () => scrollGroups.forEach((group) => settleScrollGroup(group));
  const settleUnconsumedScrollGroups = () => scrollGroups.forEach((group) => {
    if (group.consumed) {
      group.container.dataset.v2ScrollGroupState = 'consumed';
      observer?.unobserve(group.trigger);
    } else {
      settleScrollGroup(group);
    }
  });

  const removeRuntimeRoles = () => {
    entranceItems.forEach((item) => {
      if (item.runtimeRole) delete item.element.dataset.v2EntranceRuntimeRole;
    });
  };

  const completeEntrance = (quiet = false) => {
    if (entranceTerminal || lifecycleStopped) return;
    entranceTerminal = true;
    state = 'settled';
    clearCollection(entranceTimers, entranceFrames);
    entranceItems.forEach(setEntranceNodeFinal);
    clearBlockingState(root);
    html.dataset.v2EntranceState = 'settled';
    root.dataset.v2EntranceState = 'settled';
    clearHeadEntranceFailSafe();
    window.setTimeout(removeRuntimeRoles, 0);
    if (!quiet && !doneDispatched) {
      doneDispatched = true;
      dispatch('done', 'settled');
    }
  };

  const failOpen = () => {
    if (lifecycleStopped) return;
    lifecycleStopped = true;
    entranceTerminal = true;
    state = 'fail-open';
    clearCollection(entranceTimers, entranceFrames);
    clearCollection(scrollTimers, scrollFrames);
    observer?.disconnect();
    entranceItems.forEach(setEntranceNodeFinal);
    settleAllScrollGroups();
    delete html.dataset.v2MotionProfile;
    root.dataset.v2MotionStatic = 'true';
    document.querySelectorAll<HTMLElement>('[data-v2-entry-overlay]').forEach((overlay) => {
      overlay.dataset.v2EntryState = 'fail-open';
    });
    clearBlockingState(root);
    html.dataset.v2EntranceState = 'fail-open';
    root.dataset.v2EntranceState = 'fail-open';
    clearHeadEntranceFailSafe();
    removeRuntimeRoles();
    abortController.abort();
    if (!doneDispatched) {
      doneDispatched = true;
      dispatch('fail-open', 'fail-open');
    }
  };

  // Terminal requests must be consumable while resolveScope() is still
  // waiting for native scroll restoration. Register them before the first
  // await so a page-transition deadline cannot outrun the coordinator.
  document.addEventListener('v2:entrance-fail-open-request', failOpen, { once: true, signal });
  document.addEventListener('v2:page-fail-open', failOpen, { once: true, signal });

  const settleDocument = () => {
    if (lifecycleStopped) return;
    if (!entranceTerminal) completeEntrance(true);
    lifecycleStopped = true;
    clearCollection(entranceTimers, entranceFrames);
    clearCollection(scrollTimers, scrollFrames);
    observer?.disconnect();
    entranceItems.forEach(setEntranceNodeFinal);
    settleAllScrollGroups();
    clearBlockingState(root);
    document.querySelectorAll<HTMLElement>('[data-v2-entry-overlay]').forEach((overlay) => {
      overlay.dataset.v2EntryState = 'done';
    });
    html.dataset.v2EntranceState = 'settled';
    root.dataset.v2EntranceState = 'settled';
    removeRuntimeRoles();
    abortController.abort();
  };

  const prepareForPagehide = (persisted: boolean) => {
    settleDocument();
    document.dispatchEvent(new CustomEvent('v2:prepare-bfcache', {
      detail: { ...detail('settled'), persisted }
    }));
  };

  const restorePersisted = () => {
    settleDocument();
    document.querySelectorAll<HTMLElement>('[data-v2-entry-overlay]').forEach((overlay) => {
      overlay.dataset.v2EntryState = 'done';
    });
    clearBlockingState(root);
    html.dataset.v2EntranceState = 'settled';
  };

  managedEntrances.set(root, { prepareForPagehide, restorePersisted });

  try {
    scope = await resolveScope(source);
    if (lifecycleStopped) return;
    html.dataset.v2EntranceScope = scope;
    root.dataset.v2EntranceScope = scope;
    scrollGroups = buildScrollGroups(root);
    const scopedGroup = findScopedGroup(scrollGroups, scope);
    const declaredItems = collectDeclaredEntranceItems(root);
    const hashTarget = scope === 'hash-target' ? findHashTarget() : null;

    entranceItems = declaredItems.filter((item) => {
      if (isHeaderRole(item.role)) return true;
      if (scope === 'hero') return true;
      if (hashTarget) {
        // A broad ancestor hash such as #main-content must not replay every
        // declared Hero role below it. The resolved scroll group owns section
        // content; declared roles participate only when the hash identifies
        // that exact role (or a descendant of it).
        return hashTarget === item.element
          || item.element.contains(hashTarget);
      }
      const rect = item.element.getBoundingClientRect();
      return rect.bottom > getHeaderHeight() && rect.top < window.innerHeight;
    });

    declaredItems
      .filter((item) => !entranceItems.includes(item))
      .forEach(setEntranceNodeFinal);

    if (scopedGroup) {
      scopedGroup.consumed = true;
      scopedGroup.container.dataset.v2ScrollGroupState = 'consumed';
      scopedGroup.items.forEach((item) => {
        const role = scrollRoleToEntranceRole(item.role);
        item.element.dataset.v2EntranceRuntimeRole = role;
        entranceItems.push({ element: item.element, role, runtimeRole: true });
      });
    }

    const mobile = window.matchMedia('(max-width: 760px)').matches;
    entranceItems.forEach((item) => {
      const hiddenMobileNavigation = mobile && item.role === 'header-nav';
      if (hiddenMobileNavigation) setEntranceNodeFinal(item);
      else {
        item.element.dataset.v2EntranceNode = 'pending';
        if (
          item.element.matches(INTERACTIVE_SELECTOR)
          || item.element.querySelector(INTERACTIVE_SELECTOR)
        ) item.element.style.setProperty('pointer-events', 'none');
      }
    });

    const activeEntranceItems = () => entranceItems.filter((item) => item.element.dataset.v2EntranceNode === 'pending');

    const initializeScrollChoreography = () => {
      if (profile !== 'normal' || !('IntersectionObserver' in window)) {
        settleUnconsumedScrollGroups();
        return;
      }

      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const group = scrollGroups.find((candidate) => candidate.trigger === entry.target);
          if (group) revealScrollGroup(group);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.10 });

      scrollGroups.forEach((group) => {
        if (group.consumed) {
          // The deep/hash target is owned by the active entrance timeline.
          // Do not add a competing scroll-state to those same nodes.
          group.container.dataset.v2ScrollGroupState = 'consumed';
          observer?.unobserve(group.trigger);
          return;
        }
        const rect = group.trigger.getBoundingClientRect();
        if (rect.bottom <= 0) {
          settleScrollGroup(group, true);
          return;
        }
        group.container.dataset.v2ScrollGroupState = 'pending';
        group.items.forEach((item) => {
          item.element.dataset.v2ScrollState = 'pending';
          item.element.dataset.v2ScrollRole = item.role;
          if (
            item.element.matches(INTERACTIVE_SELECTOR)
            || item.element.querySelector(INTERACTIVE_SELECTOR)
          ) item.element.style.setProperty('pointer-events', 'none');
        });
        observer?.observe(group.trigger);
      });
    };

    initializeScrollChoreography();

    const finishAfter = mobile ? 1670 : 2000;
    const watchdogAfter = mobile ? 1950 : 2300;
    const timings = mobile ? MOBILE_TIMINGS : DESKTOP_TIMINGS;

    const revealEntranceItem = (item: EntranceItem, duration: number) => {
      if (entranceTerminal || lifecycleStopped || item.element.dataset.v2EntranceNode !== 'pending') return;
      item.element.style.setProperty('--v2-entrance-duration', `${duration}ms`);
      item.element.style.removeProperty('pointer-events');
      item.element.dataset.v2EntranceNode = 'revealing';
      const removeWillChange = () => cleanupNode(item.element);
      item.element.addEventListener('transitionend', removeWillChange, { once: true, signal });
      scheduleEntrance(removeWillChange, duration + 50);
    };

    const runNormalEntrance = () => {
      const items = activeEntranceItems();
      items.filter((item) => timings[item.role][0] === 0).forEach((item) => {
        item.element.style.setProperty('will-change', item.role === 'media' ? 'opacity, scale' : 'opacity, translate');
      });

      frameEntrance(() => {
        if (entranceTerminal || lifecycleStopped) return;
        state = 'revealing';
        html.dataset.v2EntranceState = 'revealing';
        root.dataset.v2EntranceState = 'revealing';
        try {
          performance.mark('v2:entrance-start');
          performance.mark(`v2:entrance-start:${activationId}`);
        } catch {
          // Performance marks are diagnostic only.
        }
        dispatch('start', 'revealing');

        items.forEach((item) => {
          const [delay, duration] = timings[item.role];
          if (delay === 0) {
            revealEntranceItem(item, duration);
            return;
          }
          scheduleEntrance(() => {
            if (item.element.dataset.v2EntranceNode !== 'pending') return;
            item.element.style.setProperty('will-change', item.role === 'media' ? 'opacity, scale' : 'opacity, translate');
            frameEntrance(() => {
              if (item.element.dataset.v2EntranceNode !== 'pending') {
                cleanupNode(item.element);
                return;
              }
              revealEntranceItem(item, duration);
            });
          }, Math.max(0, delay - 18));
        });

        scheduleEntrance(completeEntrance, finishAfter);
        scheduleEntrance(completeEntrance, watchdogAfter);
      });
    };

    const runCompactEntrance = (duration: number) => {
      frameEntrance(() => {
        if (entranceTerminal || lifecycleStopped) return;
        state = 'revealing';
        html.dataset.v2EntranceState = 'revealing';
        root.dataset.v2EntranceState = 'revealing';
        try {
          performance.mark('v2:entrance-start');
          performance.mark(`v2:entrance-start:${activationId}`);
        } catch {
          // Performance marks are diagnostic only.
        }
        dispatch('start', 'revealing');
        activeEntranceItems().forEach((item) => revealEntranceItem(item, duration));
        scheduleEntrance(completeEntrance, duration);
      });
    };

    const startEntrance = () => {
      if (started || entranceTerminal || lifecycleStopped) return;
      started = true;
      if (profile === 'reduce') runCompactEntrance(120);
      else if (profile === 'save-data') runCompactEntrance(160);
      else runNormalEntrance();
    };

    const settleInteractiveTarget = (target: EventTarget | null, settleAllInteractive = false) => {
      const targetElement = target instanceof HTMLElement ? target : null;
      activeEntranceItems().forEach((item) => {
        const containsTarget = targetElement && (item.element === targetElement || item.element.contains(targetElement));
        const containsInteractive = item.element.matches(INTERACTIVE_SELECTOR)
          || Boolean(item.element.querySelector(INTERACTIVE_SELECTOR));
        if (containsTarget || (settleAllInteractive && containsInteractive)) {
          setEntranceNodeFinal(item);
        }
      });
      scrollGroups.forEach((group) => {
        if (group.container.dataset.v2ScrollGroupState !== 'pending') return;
        const containsTarget = targetElement && group.container.contains(targetElement);
        if (containsTarget || (settleAllInteractive && group.container.querySelector(INTERACTIVE_SELECTOR))) {
          settleScrollGroup(group, true);
        }
      });
    };

    document.addEventListener('keydown', (event) => {
      if (!['Tab', 'Enter', ' '].includes(event.key)) return;
      settleInteractiveTarget(document.activeElement, event.key === 'Tab');
    }, { capture: true, signal });
    document.addEventListener('focusin', (event) => settleInteractiveTarget(event.target), { capture: true, signal });

    let scrollFrame = 0;
    const inspectActualScroll = () => {
      scrollFrame = 0;
      if (lifecycleStopped) return;
      // A scrollbar drag, anchor or Page Down can jump over the heading that
      // IntersectionObserver watches. Reached content must remain available.
      const headerHeight = getHeaderHeight();
      scrollGroups.forEach((group) => {
        if (group.container.dataset.v2ScrollGroupState === 'pending'
          && group.trigger.getBoundingClientRect().bottom <= headerHeight) {
          settleScrollGroup(group, true);
        }
      });
      if (entranceTerminal || !started || scope !== 'hero') return;
      const hero = root.querySelector<HTMLElement>('[data-v2-hero-scroll], main > section, main > header');
      if (!hero) return;
      if (hero.getBoundingClientRect().bottom <= headerHeight) completeEntrance();
    };
    window.addEventListener('scroll', () => {
      if (scrollFrame) return;
      scrollFrame = scheduleFrame(inspectActualScroll);
    }, { passive: true, signal });

    document.addEventListener('v2:page-covering', () => {
      if (entranceTerminal || lifecycleStopped) return;
      covering = true;
      clearCollection(entranceTimers, entranceFrames);
      entranceItems.forEach((item) => cleanupNode(item.element));
    }, { signal });
    document.addEventListener('v2:page-covered', () => {
      if (covering) completeEntrance();
    }, { signal });
    document.addEventListener('v2:entrance-cancel', () => completeEntrance(), { signal });
    document.addEventListener('v2:page-done', () => {
      if (covering) completeEntrance();
      else if (!started) startEntrance();
    }, { signal });

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const settleForPreferenceChange = () => {
      const nextProfile = detectMotionProfile();
      // NetworkInformation also emits change for RTT/downlink measurements.
      // Only an actual motion preference change should interrupt the entrance.
      if (html.dataset.v2MotionProfile === nextProfile) return;
      if (!entranceTerminal) completeEntrance();
      clearCollection(scrollTimers, scrollFrames);
      observer?.disconnect();
      settleAllScrollGroups();
      html.dataset.v2MotionProfile = nextProfile;
    };
    reducedMotion.addEventListener('change', settleForPreferenceChange, { signal });
    getConnection()?.addEventListener?.('change', settleForPreferenceChange, { signal });

    state = 'waiting';
    html.dataset.v2EntranceController = 'ready';
    html.dataset.v2EntranceState = 'waiting';
    root.dataset.v2EntranceController = 'ready';
    root.dataset.v2EntranceState = 'waiting';
    const waitingLimit = source === 'first-entry' ? 4200 : 1200;
    scheduleEntrance(() => {
      if (!started) failOpen();
    }, waitingLimit);
    clearHeadEntranceFailSafe();
    readyDispatched = true;
    dispatch('ready', 'waiting');

    if (source === 'mpa-h3' || source === 'mpa-calm') {
      document.addEventListener('v2:page-revealing', startEntrance, { once: true, signal });
      if (['revealing', 'done', 'fail-open'].includes(html.dataset.v2PageState || '')) {
        frameEntrance(startEntrance);
      }
    } else if (source === 'first-entry') {
      root.addEventListener('v2:entry-opening', startEntrance, { once: true, signal });
      const entryState = root.dataset.v2MotionState;
      if (entryState === 'opening' || entryState === 'assembling' || entryState === 'done') frameEntrance(startEntrance);
    } else {
      frameEntrance(() => frameEntrance(startEntrance));
    }
  } catch {
    if (!readyDispatched) {
      state = 'waiting';
      html.dataset.v2EntranceController = 'ready';
      html.dataset.v2EntranceState = 'waiting';
      root.dataset.v2EntranceController = 'ready';
      root.dataset.v2EntranceState = 'waiting';
      dispatch('ready', 'waiting');
    }
    failOpen();
  }
};

const installLifecycleCleanup = () => {
  if (entranceWindow.__smu1EntranceLifecycleReady) return;
  entranceWindow.__smu1EntranceLifecycleReady = true;

  window.addEventListener('pagehide', (event) => {
    document.querySelectorAll<HTMLElement>('[data-v2-motion-root][data-v2-entry-mode="public"]')
      .forEach((root) => managedEntrances.get(root)?.prepareForPagehide(event.persisted));
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    document.querySelectorAll<HTMLElement>('[data-v2-motion-root][data-v2-entry-mode="public"]')
      .forEach((root) => managedEntrances.get(root)?.restorePersisted());
  });
};

export const initializeV2EntranceController = () => {
  installLifecycleCleanup();
  document.querySelectorAll<HTMLElement>('[data-v2-motion-root][data-v2-entry-mode="public"]')
    .forEach((root) => { void initializeEntranceRoot(root); });
};

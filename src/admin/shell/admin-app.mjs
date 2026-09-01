import { createAdminApiClient, AdminApiError } from '../core/api-client.mjs';
import { createDraftStore, createMemoryDraftStore } from '../state/draft-store.mjs';
import { createHistoryStore, setAtPath } from '../state/history-store.mjs';
import { createAdminRouter, ADMIN_VIEWS, parseAdminRoute, viewForCollection } from './router.mjs';
import { renderOverview } from './overview.mjs';
import { renderEditorWorkspace } from './editor-workspace.mjs';
import { renderPublishPanel } from '../publish/publish-panel.mjs';
import { renderHistoryPanel } from '../history/history-panel.mjs';
import { createMediaDialog } from '../media/media-dialog.mjs';
import { planCanonicalMediaSelection } from '../media/media-selection.mjs';
import { createMediaScheduler } from '../../../tools/admin-api/media-scheduler.mjs';
import { createDraftDefaults, COLLECTION_LABELS, isOrdinaryPublicRouteAvailable, publicRouteFor, VISIBILITY_FIELDS } from '../metadata/editor-fields.mjs';
import { required, clear, element, debounce, focusWithoutScroll, safeExternalOpen } from '../ui/dom.mjs';
import { icon } from '../ui/icons.mjs';
import { createNotifications } from '../ui/notifications.mjs';
import { renderDataTools } from '../settings/data-tools.mjs';

const COLLECTIONS = Object.freeze([
  'product-sections', 'product-categories', 'products', 'services',
  'projects', 'jobs', 'site-settings', 'static-pages'
]);
const REPO_IDENTITY = 'smu1-site:h6';
const STRUCTURAL_CONFLICT_PATHS = new Set(['slug', 'pageBlocks', 'gallery', 'images', 'order', 'relatedProductSlugs']);

function normalizeBase(value) {
  const normalized = String(value || '/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function joinBase(base, pathname) {
  return `${normalizeBase(base)}${String(pathname || '').replace(/^\/+/, '')}`;
}

function downloadJson(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = element('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = element('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function changedPaths(base, value, prefix = '', result = []) {
  if (Object.is(base, value)) return result;
  if (typeof base !== typeof value || base === null || value === null || typeof base !== 'object' || Array.isArray(base) !== Array.isArray(value)) {
    result.push(prefix || '(корень)');
    return result;
  }
  const keys = new Set([...Object.keys(base), ...Object.keys(value)]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(base, key) || !Object.hasOwn(value, key)) result.push(path);
    else changedPaths(base[key], value[key], path, result);
  }
  return result;
}

function topLevelChangedPaths(base, value) {
  return new Set(changedPaths(base, value).map((path) => path.split('.')[0]));
}

function topLevelConflictPaths(base, mine, current) {
  const myChanges = topLevelChangedPaths(base, mine);
  const theirChanges = topLevelChangedPaths(base, current);
  return [...myChanges].filter((path) => theirChanges.has(path)).sort();
}

function copyTopLevel(target, source, key) {
  if (Object.hasOwn(source, key)) target[key] = structuredClone(source[key]);
  else delete target[key];
}

function ownerInitial(username) {
  return String(username || 'В').trim().charAt(0).toLocaleUpperCase('ru-RU') || 'В';
}

export async function startAdminApp() {
  const root = required(document, '#adminRoot');
  const loginView = required(root, '#adminLogin');
  const loginForm = required(root, '#adminLoginForm');
  const loginStatus = required(root, '#adminLoginStatus');
  const loginSubmit = required(root, '#adminLoginSubmit');
  const appView = required(root, '#adminApp');
  const main = required(root, '#adminMain');
  const nav = required(root, '#adminNav');
  const navToggle = required(root, '#adminNavToggle');
  const navScrim = required(root, '#adminNavScrim');
  const usernameLabel = required(root, '#adminUsername');
  const avatar = required(root, '#adminAvatar');
  const toastRegion = required(root, '#adminToastRegion');
  const liveRegion = required(root, '#adminLiveRegion');
  const dirtyDialog = required(root, '#adminDirtyDialog');
  const recoveryDialog = required(root, '#adminRecoveryDialog');
  const recoveryBody = required(root, '#adminRecoveryBody');
  const conflictDialog = required(root, '#adminConflictDialog');
  const conflictBody = required(root, '#adminConflictBody');
  const createDialog = required(root, '#adminCreateDialog');
  const createForm = required(root, '#adminCreateForm');
  const actionDialog = required(root, '#adminActionDialog');
  const actionForm = required(root, '#adminActionForm');
  const actionTitle = required(root, '#adminActionTitle');
  const actionCopy = required(root, '#adminActionCopy');
  const actionBody = required(root, '#adminActionBody');
  const actionInputField = required(root, '#adminActionInputField');
  const actionInputLabel = required(root, '#adminActionInputLabel');
  const actionInput = required(root, '#adminActionInput');
  const actionInputHint = required(root, '#adminActionInputHint');
  const actionConfirm = required(root, '#adminActionConfirm');
  const mediaDialogElement = required(root, '#adminMediaDialog');
  const helpDialog = required(root, '#adminHelpDialog');
  const notifications = createNotifications({ toastRegion, liveRegion });
  const localBrowserHost = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']).has(location.hostname.toLowerCase());
  const siteBase = normalizeBase(root.dataset.siteBase || '/');
  const adminBase = normalizeBase(root.dataset.adminBase || '/admin/');
  let draftStore;
  try { draftStore = createDraftStore(); }
  catch { draftStore = createMemoryDraftStore(); }

  const state = {
    authenticated: false,
    username: '',
    summaries: new Map(),
    drafts: new Map(),
    draftRows: [],
    history: [],
    reorderDrafts: new Map(),
    previewStatus: { status: 'not-sent' },
    publishOverview: { transactions: [], activeJob: null, latestJob: null },
    publishSelection: new Set(),
    pendingPublishStart: null,
    publishPollTimer: null,
    exactPollTimer: null,
    current: null,
    workspace: null,
    pendingNavigation: null,
    pendingRecoveryDraft: null,
    pendingConflict: null,
    createTypeHint: '',
    loadingBootstrap: false
  };

  function showLogin(message = '') {
    if (state.publishPollTimer) clearTimeout(state.publishPollTimer);
    state.publishPollTimer = null;
    if (state.exactPollTimer) clearTimeout(state.exactPollTimer);
    state.exactPollTimer = null;
    closeNav({ restoreFocus: false });
    state.authenticated = false;
    appView.hidden = true;
    loginView.hidden = false;
    loginStatus.textContent = message;
    loginForm.querySelector('input')?.focus();
  }

  const api = createAdminApiClient({
    baseUrl: root.dataset.apiBase,
    onSessionExpired: () => {
      persistCurrentDraft().catch(() => {});
      showLogin('Сессия истекла — черновик сохранён в браузере. Войдите снова, чтобы продолжить.');
    }
  });

  const initialRoute = parseAdminRoute({
    defaultView: root.dataset.initialView || 'overview',
    defaultCollection: root.dataset.initialCollection || '',
    defaultSlug: root.dataset.initialSlug || ''
  });
  const router = createAdminRouter({
    basePath: adminBase,
    initialRoute,
    onRoute: (route) => void handleRoute(route),
    guardRoute: (next, context) => {
      if (context?.source !== 'popstate' || !state.current?.history?.snapshot().dirty) return true;
      state.pendingNavigation = () => router.navigate(next);
      notifications.openDialog(dirtyDialog, { initialFocus: dirtyDialog.querySelector('[data-dirty-action="stay"]') });
      return false;
    }
  });

  function requestAction({
    title,
    copy = '',
    details = [],
    confirmLabel = 'Продолжить',
    danger = false,
    inputLabel = '',
    inputHint = '',
    inputValue = '',
    expectedValue = null
  }) {
    actionTitle.textContent = title;
    actionCopy.textContent = copy;
    clear(actionBody);
    for (const detail of details) actionBody.append(element('p', { text: detail }));
    const needsInput = Boolean(inputLabel);
    actionInputField.hidden = !needsInput;
    actionInputLabel.textContent = inputLabel;
    actionInputHint.textContent = inputHint;
    actionInput.value = inputValue;
    actionConfirm.textContent = confirmLabel;
    actionConfirm.className = `admin-btn ${danger ? 'admin-btn--danger' : 'admin-btn--primary'}`;
    const sync = () => {
      actionConfirm.disabled = expectedValue !== null && actionInput.value !== expectedValue;
    };
    sync();
    return new Promise((resolve) => {
      let submitted = false;
      const cleanup = () => {
        actionForm.removeEventListener('submit', submit);
        actionInput.removeEventListener('input', sync);
        actionDialog.removeEventListener('close', closed);
      };
      const submit = (event) => {
        event.preventDefault();
        if (actionConfirm.disabled) return;
        submitted = true;
        const value = needsInput ? actionInput.value : true;
        cleanup();
        actionDialog.close('confirmed');
        resolve(value);
      };
      const closed = () => {
        if (submitted) return;
        cleanup();
        resolve(null);
      };
      actionForm.addEventListener('submit', submit);
      actionInput.addEventListener('input', sync);
      actionDialog.addEventListener('close', closed);
      notifications.openDialog(actionDialog, { initialFocus: needsInput ? actionInput : actionConfirm });
    });
  }

  const navDrawerMedia = window.matchMedia('(max-width: 1199px)');
  let navReturnFocus = null;

  function isNavDrawerOpen() {
    return navDrawerMedia.matches && nav.dataset.open === 'true';
  }

  function syncNavLayout() {
    if (!navDrawerMedia.matches) {
      nav.dataset.open = 'false';
      nav.inert = false;
      nav.removeAttribute('aria-hidden');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.setAttribute('aria-label', 'Открыть меню');
      navScrim.hidden = true;
      return;
    }
    const open = nav.dataset.open === 'true';
    nav.inert = !open;
    nav.setAttribute('aria-hidden', String(!open));
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    navScrim.hidden = !open;
  }

  function closeNav({ restoreFocus = true } = {}) {
    const wasOpen = isNavDrawerOpen();
    const returnTarget = navReturnFocus instanceof HTMLElement && navReturnFocus.isConnected && !nav.contains(navReturnFocus)
      ? navReturnFocus
      : navToggle;
    if (wasOpen && restoreFocus) focusWithoutScroll(returnTarget);
    navReturnFocus = null;
    nav.dataset.open = 'false';
    syncNavLayout();
  }

  function openNav() {
    if (!navDrawerMedia.matches) return;
    navReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : navToggle;
    nav.dataset.open = 'true';
    syncNavLayout();
    requestAnimationFrame(() => {
      const current = nav.querySelector('[data-view][aria-current="page"]');
      focusWithoutScroll(current || nav.querySelector('[data-view]'));
    });
  }

  function toggleNav() {
    if (isNavDrawerOpen()) closeNav();
    else openNav();
  }

  function handleNavKeydown(event) {
    if (!isNavDrawerOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeNav();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...nav.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => node instanceof HTMLElement && !node.hidden && node.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      focusWithoutScroll(navToggle);
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !nav.contains(active))) {
      event.preventDefault();
      focusWithoutScroll(last);
    } else if (!event.shiftKey && (active === last || !nav.contains(active))) {
      event.preventDefault();
      focusWithoutScroll(first);
    }
  }

  const navIcons = { overview: 'overview', pages: 'pages', catalog: 'catalog', projects: 'projects', preview: 'preview', media: 'media', history: 'history', settings: 'settings' };
  for (const button of nav.querySelectorAll('[data-view]')) {
    button.prepend(icon(navIcons[button.dataset.view]));
    button.addEventListener('click', () => requestNavigation({ view: button.dataset.view, collection: '', slug: '' }));
  }
  navToggle.append(icon('menu'));
  navToggle.addEventListener('click', toggleNav);
  navScrim.addEventListener('click', closeNav);
  document.addEventListener('keydown', handleNavKeydown);
  navDrawerMedia.addEventListener('change', () => closeNav({ restoreFocus: false }));
  syncNavLayout();
  required(root, '#adminHelp').addEventListener('click', () => notifications.openDialog(helpDialog));
  required(root, '#adminLogout').addEventListener('click', async () => {
    await persistCurrentDraft().catch(() => {});
    await api.logout().catch(() => {});
    showLogin('Вы вышли. Черновики в браузере не удалены.');
  });
  for (const button of root.querySelectorAll('[data-dialog-close]')) button.addEventListener('click', () => button.closest('dialog')?.close('cancelled'));

  function updateNavState(view) {
    for (const button of nav.querySelectorAll('[data-view]')) {
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    closeNav();
  }

  async function refreshDrafts() {
    try {
      state.draftRows = await draftStore.list(REPO_IDENTITY);
      state.drafts = new Map(state.draftRows.map((draft) => [`${draft.collection}:${draft.slug}`, draft]));
    } catch (error) {
      notifications.toast('Браузер не дал прочитать сохранённые черновики. Текущая вкладка продолжит работать.', { type: 'error', duration: 0 });
      state.draftRows = [];
      state.drafts = new Map();
    }
  }

  async function refreshHistory() {
    try {
      const payload = await api.history();
      state.history = payload?.history || payload || [];
    }
    catch { state.history = state.history || []; }
  }

  async function refreshPreviewStatus() {
    try {
      const payload = await api.publishOverview();
      state.publishOverview = payload || { transactions: [], activeJob: null, latestJob: null };
      const readyIds = new Set((payload?.transactions || [])
        .filter((entry) => entry.published !== true && entry.publishEligible === true && entry.exactStatus === 'ready')
        .map((entry) => entry.transactionId));
      state.publishSelection = new Set([...state.publishSelection].filter((id) => readyIds.has(id)));
      const job = payload?.activeJob || payload?.latestJob;
      if (state.pendingPublishStart && job?.planId === state.pendingPublishStart.planId) {
        state.pendingPublishStart = null;
      }
      state.previewStatus = {
        ...(job || {}),
        status: job?.status || 'not-sent',
        previewUrl: payload?.previewUrl || '',
        lastSuccessfulPreviewSHA: payload?.lastSuccessfulPreviewSHA || null,
        updatedAt: job?.updatedAt || payload?.updatedAt || null
      };
      if (job?.jobId && ['preparing', 'local-gates', 'committed', 'pushed', 'workflow-queued', 'building'].includes(job.status)) {
        schedulePublishPoll(job.jobId, 5_000);
      }
      if ((payload?.transactions || []).some((entry) => ['queued', 'running'].includes(entry.exactStatus))) {
        scheduleExactPoll();
      }
    } catch (error) {
      state.previewStatus = { status: error.code === 'ADMIN_API_OFFLINE' ? 'not-sent' : 'failure', error: error.message };
    }
  }

  function scheduleExactPoll(delay = 1_000) {
    if (state.exactPollTimer || !state.authenticated) return;
    state.exactPollTimer = setTimeout(async () => {
      state.exactPollTimer = null;
      await refreshPreviewStatus();
      if (['overview', 'preview'].includes(router.current.view) || state.current) renderRoute();
    }, delay);
  }

  function contentPathForRecord(record) {
    if (!record?.collection || !record?.slug) return '';
    return record.collection === 'navigation'
      ? 'src/data/navigation.json'
      : record.collection === 'yandex'
        ? 'src/data/yandex.json'
        : `src/content/${record.collection}/${record.slug}.json`;
  }

  function transactionTouchesRecord(entry, record) {
    const path = contentPathForRecord(record);
    return Boolean(path && entry.changedPaths?.includes(path))
      || (entry.routeTransitions || []).some((transition) => [transition.before, transition.after]
        .some((side) => side?.collection === record.collection && side?.slug === record.slug));
  }

  function previewStatusForRecord(record) {
    if (!record?.collection || !record?.slug) return state.previewStatus;
    const pending = (state.publishOverview.transactions || [])
      .filter((entry) => entry.published !== true && transactionTouchesRecord(entry, record))
      .sort((left, right) => Date.parse(right.committedAt || 0) - Date.parse(left.committedAt || 0))[0];
    return pending
      ? {
          status: pending.exactStatus || 'not-sent',
          updatedAt: pending.exactValidation?.finishedAt || pending.exactValidation?.startedAt || pending.committedAt,
          transactionId: pending.transactionId,
          message: pending.exactValidation?.message || ''
        }
      : state.previewStatus;
  }

  function registerLocalTransaction(result, record = null) {
    if (!result?.transactionId) return;
    const metadata = result.metadata || {};
    const changedPaths = result.changedPaths
      || result.diff?.map((item) => item?.path).filter(Boolean)
      || [contentPathForRecord(record)].filter(Boolean);
    const entry = {
      transactionId: result.transactionId,
      committedAt: new Date().toISOString(),
      summary: metadata.userSummary || (record ? `Сохранение ${record.collection}:${record.slug}` : 'Локальное изменение контента'),
      changedPaths,
      affectedRoutes: result.affectedRoutes || metadata.affectedRoutes || [],
      routeExpectations: result.routeExpectations || metadata.routeExpectations || [],
      routeTransitions: result.routeTransitions || metadata.routeTransitions || [],
      recordRenames: result.recordRenames || metadata.recordRenames || [],
      canonicalMedia: [],
      published: false,
      exactStatus: result.exactScheduling?.status || 'queued',
      publishEligible: false,
      exactValidation: result.exactScheduling || null
    };
    state.publishOverview.transactions = [
      entry,
      ...(state.publishOverview.transactions || []).filter((item) => item.transactionId !== entry.transactionId)
    ];
  }

  function resolveDeployedRecordRoute(record, currentRoute) {
    let identity = { collection: record.collection, slug: record.slug };
    let route = currentRoute || null;
    let exact = true;
    let changed = false;
    const pending = (state.publishOverview.transactions || [])
      .filter((entry) => entry.published !== true)
      .sort((left, right) => Date.parse(right.committedAt || 0) - Date.parse(left.committedAt || 0));
    for (const entry of pending) {
      const transitions = Array.isArray(entry.routeTransitions) ? entry.routeTransitions : [];
      const renames = Array.isArray(entry.recordRenames) ? entry.recordRenames : [];
      let transition = transitions.find((item) => item.after?.collection === identity.collection && item.after?.slug === identity.slug);
      const rename = renames.find((item) => item.collection === identity.collection && item.toSlug === identity.slug);
      if (transition) {
        changed = true;
        route = transition.before?.expected === 'html' ? transition.before.route : null;
        if (transition.before) identity = { collection: transition.before.collection, slug: transition.before.slug };
      }
      if (rename) {
        const beforeRename = transitions.find((item) => item.before?.collection === rename.collection
          && item.before?.slug === rename.fromSlug
          && item.after === null);
        changed = true;
        route = beforeRename?.before?.expected === 'html' ? beforeRename.before.route : null;
        identity = { collection: rename.collection, slug: rename.fromSlug };
        transition = beforeRename || transition;
      }
      if (!transition && transactionTouchesRecord(entry, identity) && transitions.length === 0) {
        const unchangedExpectation = (entry.routeExpectations || []).find((item) => item.route === route);
        if (unchangedExpectation?.expected !== 'html') exact = false;
      }
    }
    return { route, exact, changed };
  }

  async function loadSummaries() {
    const results = await Promise.allSettled(COLLECTIONS.map(async (collection) => [collection, (await api.list(collection)).entries || []]));
    for (const result of results) {
      if (result.status === 'fulfilled') state.summaries.set(result.value[0], result.value[1]);
    }
    state.summaries.set('navigation', [{ slug: 'navigation', title: 'Навигация и шапка', isActive: null, order: 0, summary: { shortDescription: 'Пункты основного меню' } }]);
    state.summaries.set('yandex', [{ slug: 'yandex', title: 'Карта и Яндекс', isActive: null, order: 0, summary: { shortDescription: 'Карта, рейтинг и ссылки Яндекса' } }]);
  }

  async function bootstrap() {
    if (state.loadingBootstrap) return;
    state.loadingBootstrap = true;
    main.className = 'admin-main';
    main.replaceChildren(element('div', { className: 'admin-page admin-loading' }, Array.from({ length: 7 }, () => element('div', { className: 'admin-skeleton' }))));
    const previewRefresh = refreshPreviewStatus();
    await Promise.all([loadSummaries(), refreshDrafts(), refreshHistory()]);
    await Promise.race([
      previewRefresh,
      new Promise((resolve) => setTimeout(resolve, 1_200))
    ]);
    state.loadingBootstrap = false;
    const legacyNotice = root.dataset.legacyNotice;
    if (legacyNotice) notifications.toast(legacyNotice, { type: 'info', duration: 8000 });
    await handleRoute(router.current);
  }

  function showApp(payload) {
    state.authenticated = true;
    state.username = payload?.username || state.username || 'Владелец';
    usernameLabel.textContent = state.username;
    avatar.textContent = ownerInitial(state.username);
    loginView.hidden = true;
    appView.hidden = false;
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginSubmit.disabled = true;
    loginStatus.textContent = 'Проверяем…';
    try {
      const form = new FormData(loginForm);
      const payload = await api.login(form.get('login'), form.get('password'));
      showApp(payload);
      loginForm.reset();
      await bootstrap();
    } catch (error) {
      loginStatus.textContent = error.message || 'Не удалось войти.';
      required(loginForm, '#adminLoginPassword').select();
    } finally {
      loginSubmit.disabled = false;
    }
  });

  function currentIdentity() {
    if (!state.current || state.current.loading || state.current.error) return null;
    return { repoIdentity: REPO_IDENTITY, collection: state.current.collection, slug: state.current.slug };
  }

  async function persistCurrentDraft() {
    const identity = currentIdentity();
    if (!identity || !state.current.history?.snapshot().dirty) return;
    const saved = await draftStore.put({
      ...identity,
      baseRevision: state.current.revision,
      schemaVersion: state.current.schemaVersion,
      content: state.current.history.snapshot().value,
      stagedMedia: state.current.stagedMedia || []
    });
    state.drafts.set(`${identity.collection}:${identity.slug}`, saved);
    state.draftRows = await draftStore.list(REPO_IDENTITY);
  }

  const persistCurrentDraftSoon = debounce(() => persistCurrentDraft()
    .catch((error) => notifications.toast(error.message, { type: 'error' })), 350);

  async function clearCurrentDraft() {
    const identity = currentIdentity();
    if (!identity) return;
    persistCurrentDraftSoon.cancel();
    reconcileStagedMediaSoon.cancel();
    await draftStore.delete(identity).catch(() => {});
    state.drafts.delete(`${identity.collection}:${identity.slug}`);
    state.draftRows = state.draftRows.filter((draft) => !(draft.collection === identity.collection && draft.slug === identity.slug));
  }

  async function cancelStagedMediaLeases(items) {
    const leases = (Array.isArray(items) ? items : [])
      .filter((item) => item?.batchId && item?.leaseId);
    await Promise.allSettled(leases.map((item) => api.cancelStagedMedia({
      batchId: item.batchId,
      leaseId: item.leaseId
    })));
  }

  async function refreshStagedMediaLeases(record, { notify = true } = {}) {
    const leases = Array.isArray(record?.stagedMedia) ? record.stagedMedia : [];
    if (!leases.length) {
      if (record) record.stagingProblems = [];
      return [];
    }
    const byBatch = new Map();
    for (const lease of leases) {
      if (!lease?.batchId || !lease?.leaseId) continue;
      const items = byBatch.get(lease.batchId) || [];
      items.push(lease);
      byBatch.set(lease.batchId, items);
    }
    const refreshedByLease = new Map();
    const problems = [];
    for (const [batchId, expected] of byBatch) {
      try {
        await api.renewStagedBatch(batchId);
        const batch = await api.stagedBatch(batchId);
        const actual = new Map((batch.items || []).map((item) => [item.leaseId, item]));
        for (const lease of expected) {
          const current = actual.get(lease.leaseId);
          if (!current || current.expired) problems.push({ lease, code: 'STAGED_MEDIA_UNAVAILABLE' });
          else refreshedByLease.set(lease.leaseId, current);
        }
      } catch (error) {
        for (const lease of expected) problems.push({ lease, code: error.code || 'STAGED_MEDIA_UNAVAILABLE', message: error.message });
      }
    }
    record.stagedMedia = leases.map((lease) => ({ ...lease, ...(refreshedByLease.get(lease.leaseId) || {}) }));
    record.stagingProblems = problems;
    if (problems.length && notify) {
      const paths = [...new Set(problems.map(({ lease }) => lease.canonicalPath).filter(Boolean))];
      notifications.toast(`Текст черновика восстановлен, но ${problems.length} отложенных файлов уже недоступны${paths.length ? `: ${paths.slice(0, 3).join(', ')}` : ''}. Выберите их заново; админка не запишет неполный материал.`, { type: 'error', duration: 0 });
    }
    return problems;
  }

  function collectReferencedStagedPaths(value, candidates, result = new Set(), seen = new WeakSet()) {
    if (typeof value === 'string') {
      if (candidates.has(value)) result.add(value);
      return result;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return result;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collectReferencedStagedPaths(item, candidates, result, seen);
    } else {
      for (const item of Object.values(value)) collectReferencedStagedPaths(item, candidates, result, seen);
    }
    return result;
  }

  async function reconcileStagedMedia(record, content = record?.history?.snapshot().value) {
    if (!record?.stagedMedia?.length) return [];
    const candidates = new Set(record.stagedMedia.map((lease) => lease?.canonicalPath).filter(Boolean));
    const referenced = collectReferencedStagedPaths(content, candidates);
    const retainedByPath = new Map();
    const released = [];
    for (const lease of record.stagedMedia) {
      if (lease?.canonicalPath && referenced.has(lease.canonicalPath) && !retainedByPath.has(lease.canonicalPath)) {
        retainedByPath.set(lease.canonicalPath, lease);
      } else {
        released.push(lease);
      }
    }
    record.stagedMedia = [...retainedByPath.values()];
    if (released.length) await cancelStagedMediaLeases(released);
    return released;
  }

  const reconcileStagedMediaSoon = debounce(async () => {
    const record = state.current;
    if (!record?.history || !record.stagedMedia?.length) return;
    const released = await reconcileStagedMedia(record);
    if (released.length && state.current === record) await persistCurrentDraft().catch(() => {});
  }, 700);

  function runAfterDirtyResolution(continuation) {
    if (state.current?.history?.snapshot().dirty) {
      state.pendingNavigation = continuation;
      notifications.openDialog(dirtyDialog, { initialFocus: dirtyDialog.querySelector('[data-dirty-action="stay"]') });
      return false;
    }
    continuation();
    return true;
  }

  function requestNavigation(route) {
    runAfterDirtyResolution(() => router.navigate(route));
  }

  for (const link of root.querySelectorAll('[data-route-view]')) {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      requestNavigation({ view: link.dataset.routeView, collection: '', slug: '' });
    });
  }

  for (const button of dirtyDialog.querySelectorAll('[data-dirty-action]')) {
    button.addEventListener('click', async () => {
      const action = button.dataset.dirtyAction;
      if (action === 'stay') { state.pendingNavigation = null; dirtyDialog.close('stay'); return; }
      if (action === 'save') {
        const saved = await saveCurrent();
        if (!saved) return;
      } else if (action === 'discard') {
        await cancelStagedMediaLeases(state.current.stagedMedia);
        state.current.stagedMedia = [];
        state.current.history.resetToBoundary();
        await clearCurrentDraft();
      }
      const continuation = state.pendingNavigation;
      state.pendingNavigation = null;
      dirtyDialog.close(action);
      continuation?.();
    });
  }

  async function handleRoute(route) {
    if (!state.authenticated || state.loadingBootstrap) return;
    updateNavState(route.view);
    if (['pages', 'catalog', 'projects', 'settings'].includes(route.view)) {
      if (route.collection && route.slug && (!state.current || state.current.collection !== route.collection || state.current.slug !== route.slug)) {
        await loadRecord(route.collection, route.slug);
      } else if (!route.collection || !route.slug) {
        state.current = null;
      }
    } else {
      state.current = null;
    }
    renderRoute(route);
  }

  function openRecord({ collection, slug }) {
    requestNavigation({ view: viewForCollection(collection), collection, slug });
  }

  function renderRoute(route = router.current) {
    updateNavState(route.view);
    if (route.view === 'overview') {
      state.workspace = renderOverview({
        root: main,
        summaries: state.summaries,
        drafts: state.draftRows,
        history: state.history,
        previewStatus: state.previewStatus,
        onOpenRecord: openRecord,
        onCreate: (collection) => openCreateDialog(collection),
        onMedia: () => requestNavigation({ view: 'media', collection: '', slug: '' }),
        onPreview: () => requestNavigation({ view: 'preview', collection: '', slug: '' }),
        onSearch: (query) => handleGlobalSearch(query)
      });
      return;
    }
    if (route.view === 'preview') {
      main.className = 'admin-main';
      renderPublishPanel({
        root: main,
        overview: state.publishOverview,
        selectedTransactionIds: [...state.publishSelection],
        onSelectionChange: (ids) => { state.publishSelection = new Set(ids); },
        onRefresh: async () => { await refreshPreviewStatus(); renderRoute(); },
        onPublish: publishSelected,
        onRetry: retryPublish,
        onRetryExact: retryExactValidation,
        onOpenPreview: () => openTestSite(),
        onDownloadReport: downloadPublishReport
      });
      return;
    }
    if (route.view === 'history') {
      main.className = 'admin-main';
      renderHistoryPanel({ root: main, history: state.history, onRestorePreview: restoreHistory, onRefresh: async () => { await refreshHistory(); renderRoute(); } });
      return;
    }
    if (route.view === 'media') { renderMediaLibrary(); return; }
    if (route.view === 'settings' && !route.collection) {
      renderDataTools({
        root: main,
        api,
        notifications,
        onOpenRecord: openRecord,
        confirmAction: requestAction,
        onApplied: async (result) => {
          registerLocalTransaction(result);
          await Promise.all([loadSummaries(), refreshHistory()]);
          void refreshPreviewStatus();
          renderRoute();
        }
      });
      return;
    }
    const view = ADMIN_VIEWS[route.view] || ADMIN_VIEWS.pages;
    state.workspace = renderEditorWorkspace({
      root: main,
      view,
      summaries: state.summaries,
      drafts: state.drafts,
      reorderDrafts: state.reorderDrafts,
      current: state.current,
      relations: { summaries: state.summaries, categories: new Map((state.summaries.get('product-categories') || []).map((entry) => [entry.slug, entry.content || entry.summary || {}])) },
      siteBase,
      previewStatus: previewStatusForRecord(state.current),
      resolveMediaSource: (pathname) => {
        const current = state.current;
        const unavailableLeaseIds = new Set((current?.stagingProblems || []).map((problem) => problem?.lease?.leaseId));
        const lease = [...(current?.stagedMedia || []), ...(current?.pendingMediaPreviews || [])]
          .find((item) => item?.canonicalPath === pathname && !unavailableLeaseIds.has(item.leaseId));
        return lease?.batchId && lease?.leaseId
          ? api.stagedMediaPreviewUrl({ batchId: lease.batchId, leaseId: lease.leaseId })
          : pathname;
      },
      actions: {
        select: openRecord,
        create: () => openCreateDialog(route.view === 'projects' ? 'projects' : route.view === 'catalog' ? 'products' : 'jobs'),
        back: () => requestNavigation({ view: route.view, collection: '', slug: '' }),
        reload: () => loadRecord(route.collection, route.slug),
        update: updateCurrent,
        save: saveCurrent,
        undo: () => state.current?.history.undo(),
        redo: () => state.current?.history.redo(),
        reset: resetCurrent,
        hide: hideCurrent,
        openLocal: openLocalCurrent,
        openDeployed: openDeployedCurrent,
        media: (context) => mediaDialog.open(context),
        duplicate: duplicateCurrent,
        rename: previewRename,
        hardDelete: previewHardDelete,
        reorder: reorderCollectionDraft,
        saveOrder: saveCollectionOrder,
        cancelOrder: cancelCollectionOrder
      }
    });
  }

  function createRecordState({
    collection,
    slug,
    content,
    revision,
    schemaVersion,
    lastModified,
    isNew = false,
    stagedMedia = [],
    baseContent = isNew ? {} : content,
    recoveryDraft = null,
    recoveryAllowsRecreate = false
  }) {
    const record = {
      collection, slug, content: structuredClone(content), loadedContent: structuredClone(baseContent),
      revision, schemaVersion, lastModified, isNew, stagedMedia: structuredClone(stagedMedia), pendingMediaPreviews: [],
      saving: false, conflict: false, history: null,
      recoveryDraft: recoveryDraft ? structuredClone(recoveryDraft) : null,
      recoveryAllowsRecreate
    };
    record.history = createHistoryStore(baseContent, {
      capacity: 240,
      onChange: (snapshot, reason) => {
        record.content = snapshot.value;
        if (snapshot.dirty) {
          persistCurrentDraftSoon();
          if (record.stagedMedia.length) reconcileStagedMediaSoon();
        }
        state.workspace?.sync(snapshot, reason);
      }
    });
    return record;
  }

  async function fetchRecordSnapshot(collection, slug) {
    if (collection === 'navigation') {
      const payload = await api.readNavigation();
      return { ...payload, content: { title: 'Навигация и шапка', items: payload.items } };
    }
    if (collection === 'yandex') return api.readSingleton('yandex');
    return api.read(collection, slug);
  }

  async function loadRecord(collection, slug) {
    await persistCurrentDraftSoon.flush();
    state.current = { collection, slug, loading: true };
    renderRoute({ view: viewForCollection(collection), collection, slug });
    const identity = { repoIdentity: REPO_IDENTITY, collection, slug };
    let draft = null;
    try { draft = await draftStore.get(identity); }
    catch { /* the disk record remains available even if browser storage is unavailable */ }

    if (draft?.baseRevision === 'missing') {
      const record = createRecordState({
        collection,
        slug,
        content: draft.content,
        baseContent: {},
        revision: 'missing',
        schemaVersion: draft.schemaVersion || 'h6-content-v1',
        lastModified: draft.updatedAt,
        isNew: true,
        stagedMedia: draft.stagedMedia
      });
      state.workspace = null;
      state.current = record;
      record.history.commit(draft.content, { label: 'Восстановить новый черновик', force: true });
      renderRoute({ view: viewForCollection(collection), collection, slug });
      await refreshStagedMediaLeases(record);
      await persistCurrentDraft().catch(() => {});
      notifications.toast('Новая запись восстановлена из браузерного черновика. Она по-прежнему не записана на компьютер и скрыта с сайта.', { type: 'success', duration: 8000 });
      return;
    }

    try {
      const payload = await fetchRecordSnapshot(collection, slug);
      const content = payload.content;
      state.current = createRecordState({ collection, slug, content, revision: payload.revision, schemaVersion: payload.schemaVersion, lastModified: payload.lastModified });
      renderRoute({ view: viewForCollection(collection), collection, slug });
      if (draft) showRecoveryDraft(draft);
    } catch (error) {
      if (draft) {
        const recoveryAllowsRecreate = error?.status === 404 && COLLECTIONS.includes(collection);
        const record = createRecordState({
          collection,
          slug,
          content: draft.content,
          baseContent: {},
          revision: draft.baseRevision,
          schemaVersion: draft.schemaVersion || 'h6-content-v1',
          lastModified: draft.updatedAt,
          stagedMedia: draft.stagedMedia,
          recoveryDraft: draft,
          recoveryAllowsRecreate
        });
        state.workspace = null;
        state.current = record;
        record.history.commit(draft.content, { label: 'Открыть аварийный черновик', force: true });
        renderRoute({ view: viewForCollection(collection), collection, slug });
        await refreshStagedMediaLeases(record);
        await persistCurrentDraft().catch(() => {});
        await openConflict(null, draft, { skipFetch: true, allowRecreate: recoveryAllowsRecreate, loadError: error });
        return;
      }
      state.current = { collection, slug, error: error.message || 'Не удалось открыть запись.' };
      renderRoute({ view: viewForCollection(collection), collection, slug });
    }
  }

  function updateCurrent(path, value, metadata = {}) {
    if (!state.current?.history) return;
    const current = state.current.history.snapshot().value;
    const snapshot = state.current.history.commit(setAtPath(current, path, value), metadata);
    if (metadata.forceControlSync) state.workspace?.sync(snapshot, 'external-control-update');
  }

  async function resetCurrent() {
    if (!state.current?.history) return;
    const record = state.current;
    const staged = state.current.stagedMedia || [];
    await cancelStagedMediaLeases(staged);
    state.current.stagedMedia = [];
    if (record.isNew) {
      await clearCurrentDraft();
      state.current = null;
      router.navigate({ view: viewForCollection(record.collection), collection: '', slug: '' });
      notifications.toast('Новый браузерный черновик удалён. На диске и на сайте ничего не изменилось.', { type: 'success' });
      return;
    }
    state.current.history.resetToBoundary();
    await clearCurrentDraft();
    notifications.toast('Изменения этой записи отменены.', { type: 'success' });
  }

  function hideCurrent() {
    const record = state.current;
    if (!record?.history) return;
    const rules = VISIBILITY_FIELDS[record.collection] || [];
    if (!rules.length) {
      notifications.toast('У этой записи нет публичного переключателя видимости.', { type: 'info' });
      return;
    }
    const current = record.history.snapshot().value;
    const next = structuredClone(current);
    let changed = false;
    for (const rule of rules) {
      if (next[rule.path] === false) continue;
      next[rule.path] = false;
      changed = true;
    }
    if (!changed) {
      notifications.toast('Материал уже скрыт с сайта.', { type: 'info' });
      return;
    }
    record.history.commit(next, { label: 'Скрыть материал с сайта' });
    notifications.toast('Материал скрыт только в браузерном черновике. Нажмите «Сохранить на компьютере», чтобы применить.', { type: 'success', duration: 8000 });
  }

  async function saveCurrent() {
    const record = state.current;
    if (!record?.history || record.saving) return false;
    if (record.recoveryDraft) {
      await openConflict(null, record.recoveryDraft, {
        skipFetch: true,
        allowRecreate: record.recoveryAllowsRecreate,
        loadError: record.recoveryAllowsRecreate ? { status: 404 } : null
      });
      return false;
    }
    record.saving = true;
    state.workspace?.sync(record.history.snapshot(), 'saving');
    try {
      let result;
      const content = record.history.snapshot().value;
      const stagingProblems = await refreshStagedMediaLeases(record, { notify: true });
      if (stagingProblems.length) return false;
      reconcileStagedMediaSoon.cancel();
      const releasedStagedMedia = await reconcileStagedMedia(record, content);
      if (releasedStagedMedia.length) await persistCurrentDraft().catch(() => {});
      if (record.collection === 'navigation') {
        result = await api.saveNavigation(content.items, record.revision);
        result.content = { title: 'Навигация и шапка', items: result.items || result.content };
      } else if (record.collection === 'yandex') {
        result = await api.saveSingleton('yandex', content, record.revision);
      } else if (record.isNew) {
        result = await api.create(record.collection, content, 'missing', { stagedMedia: record.stagedMedia });
      } else {
        result = await api.save(record.collection, record.slug, content, record.revision, { stagedMedia: record.stagedMedia });
      }
      record.revision = result.revision || record.revision;
      record.schemaVersion = result.schemaVersion || record.schemaVersion;
      record.loadedContent = structuredClone(result.content || content);
      record.content = structuredClone(record.loadedContent);
      record.history.markBoundary(record.loadedContent);
      record.isNew = false;
      record.conflict = false;
      record.stagedMedia = [];
      await clearCurrentDraft();
      await Promise.all([loadSummaries(), refreshHistory()]);
      if (record.slug !== record.content.slug && record.content.slug) record.slug = record.content.slug;
      registerLocalTransaction(result, record);
      void refreshPreviewStatus();
      notifications.toast('Сохранено на компьютере. Тестовый сайт не обновлялся.', { type: 'success' });
      renderRoute({ view: viewForCollection(record.collection), collection: record.collection, slug: record.slug });
      return true;
    } catch (error) {
      const versionConflict = Boolean(
        error.payload?.currentRevision
        || error.payload?.current?.revision
        || /(REVISION|STALE|CONFLICT)/u.test(String(error.code || ''))
      );
      if (versionConflict) {
        record.conflict = true;
        await persistCurrentDraft().catch(() => {});
        let currentPayload = error.payload?.current || null;
        if (!currentPayload?.revision) {
          try { currentPayload = await fetchRecordSnapshot(record.collection, record.slug); }
          catch { /* conflict dialog still offers draft download/reload */ }
        }
        await openConflict(currentPayload);
      } else {
        const validationIssue = error.validationIssues?.[0];
        const message = validationIssue?.userMessage || validationIssue?.message || error.message || 'Сохранение не выполнено. Черновик остаётся в браузере.';
        notifications.toast(message, { type: 'error', duration: 0 });
        if (validationIssue?.path) state.workspace?.focusField(validationIssue.path);
      }
      return false;
    } finally {
      record.saving = false;
      state.workspace?.sync(record.history.snapshot(), 'save-result');
    }
  }

  function showRecoveryDraft(draft) {
    state.pendingRecoveryDraft = draft;
    const sameRevision = draft.baseRevision === state.current.revision;
    clear(recoveryBody);
    recoveryBody.append(
      element('div', { className: `admin-alert ${sameRevision ? 'admin-alert--warning' : 'admin-alert--error'}` }, [icon(sameRevision ? 'warning' : 'error'), element('p', { text: sameRevision ? `Черновик изменён ${new Date(draft.updatedAt).toLocaleString('ru-RU')}. Дисковая версия не менялась.` : 'После создания черновика запись изменилась на диске. Автоматическое восстановление отключено: сначала разрешите конфликт.' })]),
      element('details', { className: 'admin-details', style: 'margin-top:16px' }, [element('summary', { text: 'Посмотреть технические сведения' }), element('div', { className: 'admin-details__body' }, [element('pre', { className: 'admin-json-editor', text: JSON.stringify({ baseRevision: draft.baseRevision, currentRevision: state.current.revision, schemaVersion: draft.schemaVersion }, null, 2) })])])
    );
    const restore = recoveryDialog.querySelector('[data-recovery-action="restore"]');
    restore.disabled = !sameRevision;
    notifications.openDialog(recoveryDialog, { initialFocus: sameRevision ? restore : recoveryDialog.querySelector('[data-recovery-action="compare"]') });
  }

  for (const button of recoveryDialog.querySelectorAll('[data-recovery-action]')) {
    button.addEventListener('click', async () => {
      const draft = state.pendingRecoveryDraft;
      if (!draft) return recoveryDialog.close();
      if (button.dataset.recoveryAction === 'restore' && draft.baseRevision === state.current.revision) {
        state.current.stagedMedia = structuredClone(draft.stagedMedia || []);
        state.current.history.commit(draft.content, { label: 'Восстановить черновик', force: true });
        await refreshStagedMediaLeases(state.current);
        await persistCurrentDraft().catch(() => {});
        recoveryDialog.close('restored');
        notifications.toast('Черновик восстановлен. Проверьте изменения и сохраните их на компьютере.', { type: 'success' });
      } else if (button.dataset.recoveryAction === 'compare') {
        recoveryDialog.close('compare');
        openConflict(null, draft);
      } else if (button.dataset.recoveryAction === 'discard') {
        await cancelStagedMediaLeases(draft.stagedMedia);
        await draftStore.delete(draft);
        await refreshDrafts();
        recoveryDialog.close('discarded');
        notifications.toast('Старый браузерный черновик удалён. Дисковая запись не менялась.', { type: 'success' });
      }
      state.pendingRecoveryDraft = null;
    });
  }

  async function openConflict(currentPayload = null, explicitDraft = null, { skipFetch = false, allowRecreate = false, loadError = null } = {}) {
    const record = state.current;
    if (!record?.history) return;
    if (!skipFetch && !currentPayload?.content) {
      try { currentPayload = await fetchRecordSnapshot(record.collection, record.slug); }
      catch { currentPayload = null; }
    }
    const currentDisk = currentPayload?.content || null;
    const currentRevision = currentPayload?.revision || '';
    const mine = structuredClone(explicitDraft?.content || record.history.snapshot().value);
    const base = structuredClone(record.loadedContent || {});
    const myChanges = topLevelChangedPaths(base, mine);
    const theirChanges = explicitDraft
      ? new Set(myChanges)
      : currentDisk ? topLevelChangedPaths(base, currentDisk) : new Set();
    const paths = currentDisk
      ? [...myChanges].filter((path) => theirChanges.has(path)).sort()
      : [...myChanges].sort();

    if (currentDisk && currentRevision && !explicitDraft && paths.length === 0) {
      const merged = structuredClone(currentDisk);
      for (const path of myChanges) copyTopLevel(merged, mine, path);
      record.loadedContent = structuredClone(currentDisk);
      record.revision = currentRevision;
      record.conflict = false;
      record.history.commit(merged, { label: 'Объединить независимые изменения', force: true });
      notifications.toast('Изменения другой вкладки не пересекаются с вашими. Черновик безопасно объединён; проверьте и сохраните ещё раз.', { type: 'success', duration: 8000 });
      return;
    }

    const decisions = new Map();
    const canRecreate = Boolean(!currentDisk && explicitDraft && allowRecreate && COLLECTIONS.includes(record.collection));
    state.pendingConflict = { currentDisk, currentRevision, mine, base, myChanges, theirChanges, paths, decisions, explicitDraft, canRecreate };
    const mergeButton = conflictDialog.querySelector('[data-conflict-action="merge"]');
    const recreateButton = conflictDialog.querySelector('[data-conflict-action="recreate"]');
    const reloadButton = conflictDialog.querySelector('[data-conflict-action="reload"]');
    mergeButton.hidden = !currentDisk || !currentRevision || paths.length === 0;
    mergeButton.disabled = true;
    recreateButton.hidden = !canRecreate;
    reloadButton.textContent = currentDisk ? 'Открыть актуальную версию' : 'Проверить диск ещё раз';
    clear(conflictBody);
    const missingCopy = canRecreate
      ? 'Диск подтвердил, что записи больше нет. Ваш браузерный черновик не потерян: его можно скачать или восстановить как новую скрытую запись.'
      : `Не удалось получить актуальную дисковую версию${loadError?.message ? `: ${loadError.message}` : ''}. Ваш черновик сохранён: скачайте его или повторите проверку диска.`;
    conflictBody.append(element('div', { className: 'admin-alert admin-alert--error' }, [icon('error'), element('p', { text: currentDisk ? 'Выберите версию каждого пересекающегося поля. Ничего не будет записано, пока выбор не применён к черновику и вы снова не нажмёте «Сохранить на компьютере».' : missingCopy })]));
    for (const path of paths) {
      const structural = STRUCTURAL_CONFLICT_PATHS.has(path);
      const mineButton = element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button', 'aria-pressed': 'false' } }, ['Оставить моё']);
      const currentButton = element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button', 'aria-pressed': 'false' } }, ['Принять текущее']);
      const choose = (choice) => {
        decisions.set(path, choice);
        mineButton.setAttribute('aria-pressed', String(choice === 'mine'));
        currentButton.setAttribute('aria-pressed', String(choice === 'current'));
        mergeButton.disabled = decisions.size !== paths.length;
        notifications.announce(`Для поля ${path} выбрана версия: ${choice === 'mine' ? 'моя' : 'текущая'}.`);
      };
      mineButton.addEventListener('click', () => choose('mine'));
      currentButton.addEventListener('click', () => choose('current'));
      conflictBody.append(element('div', { className: 'admin-card', style: 'margin-top:12px' }, [element('div', { className: 'admin-card__body admin-section-stack' }, [
        element('strong', { text: path }),
        element('div', { className: 'admin-conflict-grid' }, [element('div', {}, [element('small', { text: 'Моя версия' }), element('pre', { className: 'admin-json-editor', text: JSON.stringify(mine?.[path], null, 2), style: 'min-height:100px' })]), element('div', {}, [element('small', { text: 'Текущая версия' }), element('pre', { className: 'admin-json-editor', text: JSON.stringify(currentDisk?.[path], null, 2), style: 'min-height:100px' })])]),
        structural ? element('p', { className: 'admin-field__hint', text: 'Структурное поле не объединяется по частям. Выбор применяется ко всему полю целиком.' }) : null,
        currentDisk ? element('div', { className: 'admin-list-editor__footer' }, [mineButton, currentButton]) : null
      ])]));
    }
    notifications.openDialog(conflictDialog);
  }

  conflictDialog.querySelector('[data-conflict-action="download"]').addEventListener('click', () => {
    const record = state.current;
    if (!record?.history) return;
    downloadJson(`smu1-draft-${record.collection}-${record.slug}.json`, { collection: record.collection, slug: record.slug, baseRevision: record.revision, schemaVersion: record.schemaVersion, content: record.history.snapshot().value, stagedMedia: record.stagedMedia || [] });
  });
  conflictDialog.querySelector('[data-conflict-action="reload"]').addEventListener('click', async () => {
    const record = state.current;
    if (!record) return;
    await persistCurrentDraft().catch(() => {});
    conflictDialog.close('reload');
    await loadRecord(record.collection, record.slug);
  });
  conflictDialog.querySelector('[data-conflict-action="recreate"]').addEventListener('click', async () => {
    const pending = state.pendingConflict;
    const record = state.current;
    if (!pending?.canRecreate || !record?.history) return;
    let content = structuredClone(pending.mine);
    content.slug = record.slug;
    for (const rule of VISIBILITY_FIELDS[record.collection] || []) content = setAtPath(content, rule.path, false);
    const replacement = createRecordState({
      collection: record.collection,
      slug: record.slug,
      content,
      baseContent: {},
      revision: 'missing',
      schemaVersion: record.schemaVersion || pending.explicitDraft?.schemaVersion || 'h6-content-v1',
      isNew: true,
      stagedMedia: pending.explicitDraft?.stagedMedia || record.stagedMedia
    });
    state.workspace = null;
    state.current = replacement;
    replacement.history.commit(content, { label: 'Восстановить как новую скрытую запись', force: true });
    state.pendingConflict = null;
    conflictDialog.close('recreated');
    await persistCurrentDraft().catch((error) => notifications.toast(error.message, { type: 'error', duration: 0 }));
    renderRoute({ view: viewForCollection(replacement.collection), collection: replacement.collection, slug: replacement.slug });
    notifications.toast('Черновик подготовлен как новая скрытая запись. Проверьте её и нажмите «Сохранить на компьютере».', { type: 'success', duration: 8000 });
  });
  conflictDialog.querySelector('[data-conflict-action="merge"]').addEventListener('click', () => {
    const pending = state.pendingConflict;
    const record = state.current;
    if (!pending?.currentDisk || !pending.currentRevision || !record?.history || pending.decisions.size !== pending.paths.length) return;
    const merged = structuredClone(pending.currentDisk);
    for (const path of pending.myChanges) {
      if (!pending.theirChanges.has(path) || pending.decisions.get(path) === 'mine') copyTopLevel(merged, pending.mine, path);
    }
    record.loadedContent = structuredClone(pending.currentDisk);
    record.revision = pending.currentRevision;
    record.conflict = false;
    if (pending.explicitDraft) record.stagedMedia = structuredClone(pending.explicitDraft.stagedMedia || []);
    record.history.commit(merged, { label: 'Разрешить конфликт версий', force: true });
    state.pendingConflict = null;
    conflictDialog.close('merged');
    notifications.toast('Выбор применён к черновику на основе актуальной версии. Проверьте поля и сохраните ещё раз.', { type: 'success', duration: 8000 });
  });

  function openCreateDialog(collection = 'products', { skipDirtyGuard = false } = {}) {
    if (!skipDirtyGuard && !runAfterDirtyResolution(() => openCreateDialog(collection, { skipDirtyGuard: true }))) return;
    state.createTypeHint = collection;
    const type = required(createForm, '#adminCreateType');
    type.value = [...type.options].some((option) => option.value === collection) ? collection : 'products';
    syncCreateDialog();
    notifications.openDialog(createDialog, { initialFocus: required(createForm, '#adminCreateName') });
  }

  function reorderCollectionDraft({ collection, slug, direction, targetSlug }, { skipDirtyGuard = false } = {}) {
    if (!skipDirtyGuard && !runAfterDirtyResolution(() => reorderCollectionDraft({ collection, slug, direction, targetSlug }, { skipDirtyGuard: true }))) return;
    const entries = state.summaries.get(collection) || [];
    const order = [...(state.reorderDrafts.get(collection) || entries.map((entry) => entry.slug))];
    const from = order.indexOf(slug);
    if (from < 0) return;
    const to = direction === 'start' ? 0
      : direction === 'end' ? order.length - 1
        : direction === 'up' ? Math.max(0, from - 1)
          : direction === 'before' && targetSlug && order.includes(targetSlug)
            ? order.indexOf(targetSlug)
            : Math.min(order.length - 1, from + 1);
    if (from === to) return;
    const [moved] = order.splice(from, 1);
    const adjustedTo = direction === 'before' && from < to ? Math.max(0, to - 1) : to;
    order.splice(adjustedTo, 0, moved);
    state.reorderDrafts.set(collection, order);
    renderRoute(router.current);
    notifications.announce(`Порядок изменён только в браузере. Сохраните порядок раздела ${COLLECTION_LABELS[collection] || collection}.`);
  }

  function cancelCollectionOrder(collection) {
    state.reorderDrafts.delete(collection);
    renderRoute(router.current);
    notifications.toast('Черновой порядок отменён. Данные на компьютере не менялись.', { type: 'info' });
  }

  async function saveCollectionOrder(collection) {
    const order = state.reorderDrafts.get(collection);
    if (!order?.length) return;
    try {
      const snapshots = await Promise.all(order.map(async (slug) => ({ slug, snapshot: await fetchRecordSnapshot(collection, slug) })));
      const operations = snapshots.flatMap(({ slug, snapshot }, index) => {
        const nextOrder = (index + 1) * 10;
        if (snapshot.content?.order === nextOrder) return [];
        return [{
          type: 'upsert-record',
          collection,
          slug,
          content: { ...snapshot.content, order: nextOrder },
          baseRevision: snapshot.revision
        }];
      });
      if (!operations.length) {
        state.reorderDrafts.delete(collection);
        renderRoute(router.current);
        return;
      }
      const preview = await api.transactionPreview(operations, { userSummary: `Изменить порядок: ${COLLECTION_LABELS[collection] || collection}` });
      const blockers = preview.blockers || [];
      if (blockers.length) throw new Error(blockers.map((item) => item.userMessage || item.message || item.code).join('; '));
      await api.transactionApply({ transactionId: preview.transactionId, idempotencyKey: preview.idempotencyKey, payloadHash: preview.payloadHash });
      registerLocalTransaction(preview, state.current?.collection === collection ? state.current : null);
      state.reorderDrafts.delete(collection);
      await Promise.all([loadSummaries(), refreshHistory()]);
      void refreshPreviewStatus();
      if (state.current?.collection === collection && state.current?.slug) await loadRecord(collection, state.current.slug);
      else renderRoute(router.current);
      notifications.toast('Порядок сохранён одной локальной транзакцией. Тестовый сайт не обновлялся.', { type: 'success' });
    } catch (error) {
      notifications.toast(error.message || 'Не удалось сохранить порядок. Черновой порядок остаётся в браузере.', { type: 'error', duration: 0 });
    }
  }

  function syncCreateDialog() {
    const type = required(createForm, '#adminCreateType').value;
    const parentField = required(createForm, '#adminCreateParentField');
    const presentationField = required(createForm, '#adminCreatePresentationField');
    const parent = required(createForm, '#adminCreateParent');
    parentField.hidden = !['products', 'product-categories'].includes(type);
    presentationField.hidden = type !== 'products';
    clear(parent);
    const sourceCollection = type === 'products' ? 'product-categories' : 'product-sections';
    for (const entry of state.summaries.get(sourceCollection) || []) parent.append(element('option', { text: entry.title || entry.slug, attrs: { value: entry.slug } }));
  }
  required(createForm, '#adminCreateType').addEventListener('change', syncCreateDialog);
  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(createForm);
    const collection = String(form.get('collection'));
    const content = createDraftDefaults(collection, { title: String(form.get('title')), parentSlug: String(form.get('parentSlug') || ''), presentationType: String(form.get('presentationType') || 'standard'), order: ((state.summaries.get(collection)?.length || 0) + 1) * 10 });
    if (!content) return;
    const record = createRecordState({ collection, slug: content.slug, content, revision: 'missing', schemaVersion: 'h6-content-v1', isNew: true });
    state.workspace = null;
    state.current = record;
    record.history.commit(content, { label: 'Создать скрытый черновик', force: true });
    await persistCurrentDraft().catch((error) => notifications.toast(error.message, { type: 'error', duration: 0 }));
    createDialog.close('created');
    router.navigate({ view: viewForCollection(collection), collection, slug: content.slug });
    notifications.toast('Создан браузерный черновик. Он скрыт с сайта и ещё не записан на компьютер.', { type: 'success' });
    createForm.reset();
  });

  async function duplicateCurrent({ skipDirtyGuard = false } = {}) {
    const source = state.current;
    if (!source?.history || !['products', 'projects'].includes(source.collection)) return;
    if (!skipDirtyGuard && !runAfterDirtyResolution(() => void duplicateCurrent({ skipDirtyGuard: true }))) return;
    const draft = structuredClone(source.history.snapshot().value);
    draft.title = `Копия — ${draft.title || source.slug}`;
    draft.slug = `${draft.slug || source.slug}-copy-${String(Date.now()).slice(-5)}`;
    draft.isActive = false;
    if (source.collection === 'products') draft.showInCatalog = false;
    draft.seoTitle = '';
    draft.seoDescription = '';
    const record = createRecordState({ collection: source.collection, slug: draft.slug, content: draft, revision: 'missing', schemaVersion: source.schemaVersion, isNew: true });
    state.workspace = null;
    state.current = record;
    record.history.commit(draft, { label: 'Создать копию', force: true });
    await persistCurrentDraft().catch((error) => notifications.toast(error.message, { type: 'error', duration: 0 }));
    router.navigate({ view: viewForCollection(source.collection), collection: source.collection, slug: draft.slug });
    notifications.toast('Копия создана как скрытый браузерный черновик. Фотографии переиспользуются без копирования байтов.', { type: 'success' });
  }

  async function openLocalCurrent() {
    const record = state.current;
    if (!record?.history) return;
    if (record.history.snapshot().dirty || record.isNew) {
      notifications.toast('Точная локальная страница использует только сохранённую версию. Сначала сохраните запись на компьютере.', { type: 'error' });
      return;
    }
    const route = publicRouteFor(record.collection, record.content, { categories: new Map((state.summaries.get('product-categories') || []).map((entry) => [entry.slug, entry.summary || {}])) });
    if (!route) return notifications.toast('Для этой записи нет отдельной публичной страницы.', { type: 'info' });
    const routeIsPublic = isOrdinaryPublicRouteAvailable(record.collection, record.content, { summaries: state.summaries });
    if (routeIsPublic) {
      safeExternalOpen(joinBase(siteBase, route));
      return;
    }
    const waitingWindow = window.open('about:blank', '_blank');
    if (waitingWindow) {
      waitingWindow.opener = null;
      waitingWindow.document.title = 'Собираем локальный preview…';
      waitingWindow.document.body.textContent = 'Собираем точную локальную страницу. Это может занять несколько секунд…';
    }
    notifications.toast('Собираем точную локальную страницу из сохранённой скрытой версии…', { type: 'info', duration: 0 });
    try {
      const preview = await api.localPreview({ collection: record.collection, slug: record.slug, revision: record.revision });
      if (waitingWindow && !waitingWindow.closed) waitingWindow.location.replace(preview.url);
      else safeExternalOpen(preview.url);
      notifications.toast('Точный локальный preview готов. Он доступен только в этой local-only сессии и автоматически очистится.', { type: 'success', duration: 8000 });
    } catch (error) {
      if (waitingWindow && !waitingWindow.closed) waitingWindow.close();
      notifications.toast(error.message || 'Не удалось собрать точный локальный preview. Сохранённые данные не изменены.', { type: 'error', duration: 0 });
    }
  }

  function openDeployedCurrent() {
    const record = state.current;
    if (!record?.history) return;
    if (record.isNew) {
      notifications.toast('Новая запись ещё не отправлялась на тестовый сайт. Сначала сохраните её на компьютере, затем опубликуйте отдельным действием.', { type: 'info' });
      return;
    }
    const previewRoot = state.publishOverview.previewUrl || state.previewStatus.previewUrl || state.previewStatus.url;
    if (!previewRoot) {
      notifications.toast('Адрес тестового сайта пока не получен. Откройте раздел «Тестовый сайт» и обновите состояние.', { type: 'info' });
      return;
    }
    const snapshot = record.history.snapshot();
    const savedContent = snapshot.dirty ? record.loadedContent : snapshot.value;
    const savedRoute = publicRouteFor(record.collection, savedContent, { categories: new Map((state.summaries.get('product-categories') || []).map((entry) => [entry.slug, entry.summary || {}])) });
    if (!savedRoute) {
      notifications.toast('Для этой записи нет отдельной публичной страницы.', { type: 'info' });
      return;
    }
    const deployed = resolveDeployedRecordRoute(record, savedRoute);
    if (!deployed.exact) {
      notifications.toast('Для старого локального сохранения нет достаточного route-доказательства. Админка не станет угадывать deployed-адрес; сначала опубликуйте или откройте отчёт тестового сайта.', { type: 'error', duration: 0 });
      return;
    }
    if (!deployed.route) {
      notifications.toast('В последней опубликованной версии этой страницы ещё нет или она там скрыта. Локальное сохранение не выдаётся за deployed-страницу.', { type: 'info', duration: 8000 });
      return;
    }
    if (snapshot.dirty) notifications.toast('Открывается последняя опубликованная версия. Несохранённый браузерный черновик на тестовый сайт не отправлялся.', { type: 'info', duration: 7000 });
    else if (deployed.changed) notifications.toast('Открывается точный маршрут последней опубликованной версии; более новое локальное сохранение ещё не публиковалось.', { type: 'info', duration: 7000 });
    safeExternalOpen(joinBase(previewRoot, deployed.route));
  }

  async function previewRename({ skipDirtyGuard = false } = {}) {
    const record = state.current;
    if (!record?.history || record.isNew) return notifications.toast('Адрес новой записи можно изменить до первого сохранения в поле slug.', { type: 'info' });
    if (!skipDirtyGuard && !runAfterDirtyResolution(() => void previewRename({ skipDirtyGuard: true }))) return;
    const nextSlug = await requestAction({
      title: 'Проверить новый адрес',
      copy: 'Сначала сервер проверит коллизии и все связанные ссылки. Автоматический redirect не создаётся.',
      inputLabel: 'Новый технический адрес (slug)',
      inputHint: 'Только латинские буквы, цифры и дефисы.',
      inputValue: record.content.slug || record.slug,
      confirmLabel: 'Проверить связи'
    });
    if (!nextSlug || nextSlug === record.content.slug) return;
    try {
      const preview = await api.transactionPreview([{ type: 'rename-record', collection: record.collection, slug: record.slug, nextSlug, baseRevision: record.revision }], { userSummary: `Переименовать ${record.content.title || record.slug}` });
      const blockers = preview.blockers || preview.relationImpact?.blockers || [];
      if (blockers.length) return notifications.toast(blockers.map((item) => item.message || item.code).join('; '), { type: 'error', duration: 0 });
      const confirmed = await requestAction({
        title: 'Применить новый адрес?',
        copy: 'Адрес и внутренние ссылки изменятся одной транзакцией. Тестовый сайт не обновится.',
        details: [
          `Старый адрес: ${preview.oldRoute || record.slug}`,
          `Новый адрес: ${preview.newRoute || nextSlug}`,
          `Связей будет обновлено: ${preview.relationUpdates?.length || 0}`,
          'Redirect автоматически не создаётся.'
        ],
        confirmLabel: 'Переименовать'
      });
      if (!confirmed) return;
      await api.transactionApply({ transactionId: preview.transactionId, idempotencyKey: preview.idempotencyKey, payloadHash: preview.payloadHash });
      registerLocalTransaction(preview, record);
      notifications.toast('Адрес и связанные внутренние ссылки изменены одной транзакцией. Тестовый сайт не обновлялся.', { type: 'success' });
      await Promise.all([loadSummaries(), refreshHistory()]);
      void refreshPreviewStatus();
      router.navigate({ view: viewForCollection(record.collection), collection: record.collection, slug: nextSlug });
    } catch (error) { notifications.toast(error.message, { type: 'error', duration: 0 }); }
  }

  async function previewHardDelete({ skipDirtyGuard = false } = {}) {
    const record = state.current;
    if (!record?.history || record.isNew) return;
    if (!skipDirtyGuard && !runAfterDirtyResolution(() => void previewHardDelete({ skipDirtyGuard: true }))) return;
    try {
      const preview = await api.transactionPreview([{ type: 'delete-record', collection: record.collection, slug: record.slug, baseRevision: record.revision, hardDelete: true, relationPlan: { strategy: 'hard-delete' } }], { userSummary: `Удалить ${record.content.title || record.slug}` });
      const blockers = preview.blockers || preview.relationImpact?.blockers || [];
      if (blockers.length) return notifications.toast(`Удаление заблокировано: ${blockers.map((item) => item.message || item.code).join('; ')}`, { type: 'error', duration: 0 });
      const exactName = await requestAction({
        title: 'Окончательно удалить запись?',
        copy: 'Будет создана восстановимая резервная версия. Исходные фотографии автоматически не удаляются.',
        details: [`Запись: ${record.content.title || record.slug}`, `Затронуто маршрутов: ${preview.affectedRoutes?.length || preview.relationImpact?.affectedRoutes?.length || 0}`],
        danger: true,
        confirmLabel: 'Удалить локально',
        inputLabel: 'Введите точное название записи',
        inputHint: 'Это защищает от случайного удаления.',
        expectedValue: record.content.title || record.slug
      });
      if (exactName === null) return;
      await api.transactionApply({ transactionId: preview.transactionId, idempotencyKey: preview.idempotencyKey, payloadHash: preview.payloadHash });
      registerLocalTransaction(preview, record);
      await Promise.all([loadSummaries(), refreshHistory(), clearCurrentDraft()]);
      void refreshPreviewStatus();
      state.current = null;
      router.navigate({ view: viewForCollection(record.collection), collection: '', slug: '' });
      notifications.toast('Запись удалена локально с recoverable history. Тестовый сайт не обновлялся.', { type: 'success' });
    } catch (error) { notifications.toast(error.message, { type: 'error', duration: 0 }); }
  }

  const mediaDialog = createMediaDialog({
    dialog: mediaDialogElement,
    body: required(root, '#adminMediaBody'),
    confirmButton: required(root, '#adminMediaConfirm'),
    notifications,
    loadLibrary: (options) => api.mediaLibrary(options),
    onConfirm: async ({ context, items, onProgress, registerCancel }) => {
      const targetRecord = state.current;
      if (!targetRecord?.history || (!context?.path && typeof context?.applySelection !== 'function')) {
        throw new Error('Сначала откройте конкретную запись и выберите поле для фотографий.');
      }
      const batchId = `batch-${crypto.randomUUID()}`;
      const uploadItems = items.filter((item) => item.file);
      const reusedItems = items.filter((item) => item.existingPath);
      const scheduler = createMediaScheduler({
        concurrency: 2,
        onUpdate: (record) => onProgress?.(record),
        worker: async (item, { signal }) => {
          if (signal.aborted) throw new DOMException('Загрузка отменена', 'AbortError');
          return api.stageMedia({ batchId, clientId: item.clientId, originalIndex: item.index, file: item.file, signal });
        }
      });
      registerCancel?.(() => scheduler.cancel());
      let results;
      try {
        results = uploadItems.length ? await scheduler.start(uploadItems) : [];
      } finally {
        registerCancel?.(null);
      }
      const uncertain = results.filter((item) => item.requiresStatusCheck === true);
      if (uncertain.length) {
        const batch = await api.stagedBatch(batchId);
        const confirmedByClient = new Map((batch.items || []).map((lease) => [lease.clientId, lease]));
        results = results.map((item) => {
          if (!item.requiresStatusCheck) return item;
          const lease = confirmedByClient.get(item.clientId);
          return lease
            ? { ...item, status: lease.reused ? 'reused' : 'uploaded', result: lease, requiresStatusCheck: false, outcome: 'confirmed-after-cancel' }
            : { ...item, status: 'cancelled', requiresStatusCheck: false, outcome: 'confirmed-not-staged' };
        });
      }
      const completed = results.filter((item) => ['uploaded', 'reused'].includes(item.status));
      const stagedLeases = completed.map((item) => item.result).filter(Boolean);
      const leasesByClientId = new Map([
        ...stagedLeases.map((lease) => [lease.clientId, lease]),
        ...reusedItems.map((item) => [item.clientId, { clientId: item.clientId, canonicalPath: item.existingPath, reused: true }])
      ]);
      const { leases, omittedDuplicates } = planCanonicalMediaSelection(items, leasesByClientId);
      for (const item of omittedDuplicates) {
        onProgress?.({ clientId: item.clientId, status: 'duplicate', statusLabel: 'Дубликат уже выбран; повтор не будет добавлен' });
      }
      if (!leases.length) {
        return {
          failures: results.map((item) => ({
            clientId: item.clientId,
            message: item.status === 'cancelled' ? 'Загрузка отменена; можно повторить.' : item.error?.message || 'Файл не прошёл server-side проверку.'
          }))
        };
      }
      if (state.current !== targetRecord) {
        await Promise.allSettled(stagedLeases.map((lease) => api.cancelStagedMedia({ batchId, leaseId: lease.leaseId })));
        throw new Error('Запись изменилась во время загрузки. Подготовленные файлы отменены; откройте нужную запись и повторите выбор.');
      }
      const paths = leases.map((lease) => lease.canonicalPath);
      targetRecord.pendingMediaPreviews = stagedLeases.map((lease) => ({ ...lease, batchId: lease.batchId || batchId }));
      const content = targetRecord.history.snapshot().value;
      const usedCanonicalPaths = new Set();
      if (typeof context.applySelection === 'function') {
        let appliedPaths;
        try {
          appliedPaths = context.applySelection(paths, { leases: structuredClone(leases) });
        } catch (error) {
          targetRecord.pendingMediaPreviews = [];
          await Promise.allSettled(stagedLeases.map((lease) => api.cancelStagedMedia({ batchId, leaseId: lease.leaseId })));
          throw error;
        }
        for (const selectedPath of Array.isArray(appliedPaths) ? appliedPaths : []) {
          if (selectedPath) usedCanonicalPaths.add(selectedPath);
        }
      } else if (context.multiple) {
        const existing = Array.isArray(content[context.path]) ? structuredClone(content[context.path]) : [];
        const existingPaths = new Set(existing.map((entry) => typeof entry === 'string' ? entry : entry?.src || entry?.image || '').filter(Boolean));
        const uniquePaths = paths.filter((path) => {
          if (!path || existingPaths.has(path)) return false;
          existingPaths.add(path);
          usedCanonicalPaths.add(path);
          return true;
        });
        const additions = uniquePaths.map((path) => context.itemKind === 'string' ? path : { src: path, alt: '', caption: '' });
        if (additions.length) updateCurrent(context.path, [...existing, ...additions], { label: `Добавить ${additions.length} фото в галерею`, forceControlSync: true });
      } else {
        if (paths[0]) {
          usedCanonicalPaths.add(paths[0]);
          updateCurrent(context.path, paths[0], { label: 'Выбрать фотографию', forceControlSync: true });
        }
      }
      const requestedCover = items.find((item) => item.isCover);
      const requestedCoverLease = requestedCover ? leasesByClientId.get(requestedCover.clientId) : null;
      const coverLease = requestedCoverLease
        ? leases.find((lease) => lease.clientId === requestedCover.clientId)
          || leases.find((lease) => lease.canonicalPath === requestedCoverLease.canonicalPath)
        : null;
      if (context.coverPath && coverLease) {
        usedCanonicalPaths.add(coverLease.canonicalPath);
        updateCurrent(context.coverPath, coverLease.canonicalPath, { label: 'Явно выбрать обложку', forceControlSync: true });
      }
      const retainedByPath = new Map();
      const alreadyStagedPaths = new Set(targetRecord.stagedMedia.map((lease) => lease.canonicalPath));
      const selectedStagedClientIds = new Set(leases.map((lease) => lease.clientId));
      const unusedStagedLeases = [];
      for (const lease of stagedLeases) {
        if (!selectedStagedClientIds.has(lease.clientId)
          || !usedCanonicalPaths.has(lease.canonicalPath)
          || alreadyStagedPaths.has(lease.canonicalPath)
          || retainedByPath.has(lease.canonicalPath)) {
          unusedStagedLeases.push(lease);
        } else {
          retainedByPath.set(lease.canonicalPath, lease);
        }
      }
      await Promise.allSettled(unusedStagedLeases.map((lease) => api.cancelStagedMedia({ batchId, leaseId: lease.leaseId })));
      const retainedStagedLeases = [...retainedByPath.values()];
      targetRecord.stagedMedia.push(...retainedStagedLeases.map((lease) => ({
        batchId,
        leaseId: lease.leaseId,
        stagedId: lease.stagedId,
        canonicalPath: lease.canonicalPath,
        baseRevision: lease.baseRevision,
        destinationBaseRevision: lease.destinationBaseRevision,
        validation: lease.validation
      })));
      targetRecord.pendingMediaPreviews = [];
      state.workspace?.sync(targetRecord.history.snapshot(), 'staged-media-ready');
      await persistCurrentDraft();
      const failures = results.filter((item) => ['error', 'cancelled'].includes(item.status)).length;
      notifications.toast(`Добавлено в черновик: ${usedCanonicalPaths.size}.${omittedDuplicates.length ? ` Дубликатов не добавлено: ${omittedDuplicates.length}.` : ''}${failures ? ` Ошибок: ${failures}.` : ''} Новые файлы станут постоянными только вместе с сохранением записи.`, { type: failures ? 'info' : 'success', duration: 8000 });
      return {
        resolvedItems: leases.map((lease) => ({ clientId: lease.clientId, canonicalPath: lease.canonicalPath })),
        omittedDuplicateClientIds: omittedDuplicates.map((item) => item.clientId),
        failures: results.filter((item) => ['error', 'cancelled'].includes(item.status)).map((item) => ({
          clientId: item.clientId,
          message: item.status === 'cancelled' ? 'Загрузка отменена; можно повторить.' : item.error?.message || 'Файл не прошёл серверную проверку.'
        }))
      };
    }
  });

  async function renderMediaLibrary({ page = 1, search = '', usage = 'all' } = {}) {
    main.className = 'admin-main';
    clear(main);
    const pageRoot = element('div', { className: 'admin-page' }, [
      element('div', { className: 'admin-page__heading' }, [element('div', {}, [element('h1', { text: 'Медиа' }), element('p', { text: 'Только canonical originals. H5 derivatives, staging и QA-файлы исключены.' })])]),
      element('div', { className: 'admin-section-stack' }, [
        element('div', { className: 'admin-alert' }, [icon('info'), element('p', { text: 'Постоянная бесхозная загрузка не создаётся. Выберите товар, тип изделий или объект, затем откройте нужную обложку/галерею.' })]),
        element('div', { className: 'admin-quick-actions' }, [
          element('button', { className: 'admin-btn admin-btn--primary', attrs: { type: 'button' }, on: { click: () => requestNavigation({ view: 'catalog', collection: '', slug: '' }) } }, [icon('catalog'), 'Выбрать товар или тип изделий']),
          element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => requestNavigation({ view: 'projects', collection: '', slug: '' }) } }, [icon('projects'), 'Выбрать выполненный объект']),
          element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => requestNavigation({ view: 'pages', collection: '', slug: '' }) } }, [icon('pages'), 'Выбрать страницу'])
        ]),
        element('div', { className: 'admin-skeleton', style: 'height:160px' })
      ])
    ]);
    main.append(pageRoot);
    const stack = pageRoot.querySelector('.admin-section-stack');
    try {
      const result = await api.mediaLibrary({ page, pageSize: 24, search, usage });
      if (router.current.view !== 'media') return;
      stack.querySelector('.admin-skeleton')?.remove();
      const searchInput = element('input', { value: search, attrs: { type: 'search', placeholder: 'Поиск по имени или пути', 'aria-label': 'Поиск медиа' } });
      const usageSelect = element('select', { attrs: { 'aria-label': 'Фильтр использования' } }, [
        ['all', 'Все'], ['used', 'Используемые'], ['unreferenced', 'Без ссылок (диагностика)']
      ].map(([value, label]) => element('option', { text: label, selected: usage === value, attrs: { value } })));
      const runSearch = () => void renderMediaLibrary({ page: 1, search: searchInput.value, usage: usageSelect.value });
      searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') runSearch(); });
      const grid = element('div', { className: 'admin-media-grid' }, result.items.map((entry) => element('article', { className: 'admin-media-item' }, [
        element('div', { className: 'admin-media-item__image' }, [element('img', { src: entry.path, alt: '', loading: 'lazy' })]),
        element('div', { className: 'admin-media-item__body' }, [
          element('strong', { text: entry.filename }),
          element('small', { text: `${Math.max(1, Math.round(entry.bytes / 1024))} КБ · ${entry.width || '—'}×${entry.height || '—'}` }),
          element('span', { className: `admin-badge ${entry.usageCount ? 'admin-badge--success' : 'admin-badge--warning'}`, text: entry.usageCount ? `Используется: ${entry.usageCount}` : 'Нет ссылок — не удаляется автоматически' }),
          element('details', { className: 'admin-details' }, [element('summary', { text: 'Технические детали' }), element('div', { className: 'admin-details__body' }, [element('code', { text: entry.path }), element('p', { text: `SHA-256: ${entry.sha256}` }), ...(entry.references || []).map((reference) => element('p', { text: `${reference.collection || reference.singleton}:${reference.slug || ''} · ${reference.fieldPath}` }))])])
        ])
      ])));
      stack.append(
        element('section', { className: 'admin-card' }, [element('div', { className: 'admin-card__body admin-list-editor__footer' }, [searchInput, usageSelect, element('button', { className: 'admin-btn admin-btn--primary admin-btn--small', attrs: { type: 'button' }, on: { click: runSearch } }, ['Найти'])])]),
        result.items.length ? grid : element('div', { className: 'admin-empty' }, [icon('image'), element('strong', { text: 'Ничего не найдено' }), element('p', { text: 'Измените поиск или фильтр.' })]),
        element('div', { className: 'admin-list-editor__footer' }, [
          element('button', { className: 'admin-btn admin-btn--small', disabled: result.page <= 1, attrs: { type: 'button' }, on: { click: () => void renderMediaLibrary({ page: result.page - 1, search, usage }) } }, ['Назад']),
          element('span', { text: `${result.page} / ${result.pages} · файлов: ${result.total}` }),
          element('button', { className: 'admin-btn admin-btn--small', disabled: result.page >= result.pages, attrs: { type: 'button' }, on: { click: () => void renderMediaLibrary({ page: result.page + 1, search, usage }) } }, ['Дальше'])
        ])
      );
    } catch (error) {
      stack.querySelector('.admin-skeleton')?.replaceWith(element('div', { className: 'admin-alert admin-alert--error' }, [icon('error'), element('p', { text: error.message || 'Не удалось загрузить медиатеку.' })]));
    }
  }

  function handleGlobalSearch(query) {
    const normalized = String(query || '').trim().toLocaleLowerCase('ru-RU');
    if (normalized.length < 2) return;
    const matches = [];
    for (const [collection, entries] of state.summaries) {
      for (const entry of entries) {
        if ([entry.title, entry.slug, ...Object.values(entry.summary || {})].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(normalized)) matches.push({ collection, ...entry });
      }
    }
    if (matches.length === 1) {
      openRecord(matches[0]);
      return;
    }
    if (!matches.length) {
      notifications.toast('По этому запросу ничего не найдено.', { type: 'info' });
      return;
    }
    main.className = 'admin-main';
    clear(main);
    const results = element('div', { className: 'admin-page' }, [
      element('div', { className: 'admin-page__heading' }, [
        element('div', {}, [element('h1', { text: `Результаты поиска: ${matches.length}` }), element('p', { text: `Запрос: «${query}». Выберите точную запись.` })]),
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => renderRoute(router.current) } }, ['Вернуться к обзору'])
      ]),
      element('div', { className: 'admin-section-stack' }, matches.map((match) => element('button', {
        className: 'admin-record-row',
        attrs: { type: 'button' },
        on: { click: () => openRecord(match) }
      }, [
        element('span', { className: 'admin-record-row__thumb' }, [icon(match.collection === 'products' ? 'box' : match.collection === 'projects' ? 'projects' : 'pages')]),
        element('span', {}, [element('strong', { text: match.title || match.slug }), element('small', { text: `${COLLECTION_LABELS[match.collection] || match.collection} · ${match.slug}` })]),
        icon('arrowRight')
      ])))
    ]);
    main.append(results);
    results.querySelector('button.admin-record-row')?.focus();
  }

  async function restoreHistory(entry) {
    try {
      const preview = await api.restorePreview(entry.transactionId);
      const diffs = Array.isArray(preview.diff) ? preview.diff : preview.paths || preview.changedPaths || [];
      const confirmed = await requestAction({
        title: 'Восстановить эту версию?',
        copy: 'Восстановление создаст новую транзакцию и само останется восстановимым. Тестовый сайт не обновится.',
        details: [`Изменится файлов: ${diffs.length}`, entry.metadata?.userSummary ? `Исходное действие: ${entry.metadata.userSummary}` : ''],
        confirmLabel: 'Восстановить локально'
      });
      if (!confirmed) return;
      await api.transactionApply({ transactionId: preview.transactionId, idempotencyKey: preview.idempotencyKey, payloadHash: preview.payloadHash });
      registerLocalTransaction(preview);
      await Promise.all([refreshHistory(), loadSummaries()]);
      void refreshPreviewStatus();
      renderRoute();
      notifications.toast('Предыдущее сохранение восстановлено новой транзакцией. Тестовый сайт не обновлялся.', { type: 'success' });
    } catch (error) { notifications.toast(error.message, { type: 'error', duration: 0 }); }
  }

  async function publishSelected(transactionIds) {
    try {
      if (!transactionIds.length) {
        notifications.toast('Выберите хотя бы одно готовое локальное сохранение.', { type: 'info' });
        return;
      }
      state.previewStatus = { status: 'preparing', updatedAt: new Date().toISOString() };
      state.publishOverview = { ...state.publishOverview, activeJob: state.previewStatus, latestJob: state.previewStatus };
      renderRoute();
      const plan = await api.publishPlan(transactionIds);
      const selected = plan.selectedTransactionIds?.length || transactionIds.length;
      const dependencies = plan.automaticDependencyIds?.length || 0;
      const files = plan.paths?.length || 0;
      const routes = plan.affectedRoutes?.length || 0;
      const shortHash = (value) => String(value || 'missing').replace(/^sha256:/u, '').slice(0, 12);
      const details = [
        `Целых сохранений: ${selected}${dependencies ? ` (автоматически добавлено зависимостей: ${dependencies})` : ''}`,
        `Изменится файлов: ${files}; затронуто маршрутов: ${routes}`,
        `Base HEAD: ${plan.baseHead || 'не определён'}`,
        `Preview anchor: ${plan.anchorSha || 'не определён'}`,
        `Проверок в чистой копии: ${plan.gates?.length || 0}`,
        ...(plan.automaticDependencyIds?.length ? [`Автоматически добавленные зависимости: ${plan.automaticDependencyIds.join(', ')}`] : []),
        ...(plan.excludedTransactionIds?.length ? [`Не включены: ${plan.excludedTransactionIds.join(', ')}`] : []),
        ...((plan.paths || []).map((entry) => `Файл: ${entry.path} · ${shortHash(entry.beforeHash)} → ${shortHash(entry.afterHash)}`)),
        ...((plan.affectedRoutes || []).map((route) => `Маршрут live-проверки: ${route}`)),
        ...((plan.canonicalMedia || []).map((path) => `Новое canonical media: ${path}`)),
        'Ветки v4-product-final-candidate и preview будут обновлены одной atomic-операцией. Production/main не изменяется.',
        ...(plan.warnings || [])
      ];
      const confirmed = await requestAction({
        title: plan.empty ? 'Выбранные изменения уже на тестовом сайте' : 'Запустить полную проверку и публикацию?',
        copy: plan.empty
          ? 'Новая версия не потребуется, но план всё равно будет зафиксирован как уже опубликованный.'
          : 'Операция может занять несколько минут. Админкой можно продолжать пользоваться, а локальные данные останутся сохранёнными при любом результате.',
        details,
        confirmLabel: plan.empty ? 'Подтвердить состояние' : 'Проверить и обновить preview'
      });
      if (!confirmed) {
        await refreshPreviewStatus();
        renderRoute();
        return;
      }
      const idempotencyKey = crypto.randomUUID();
      state.pendingPublishStart = { planId: plan.planId, idempotencyKey, attempts: 0 };
      const result = await api.publishApply(plan.planId, { idempotencyKey });
      state.pendingPublishStart = null;
      updatePublishJob(result);
      renderRoute();
      if (!['deploy-success', 'failure', 'empty', 'unknown-network-result'].includes(result.status)) {
        schedulePublishPoll(result.jobId, 2_000);
      }
      notifications.toast('Проверка и обновление тестового сайта запущены. Локальные сохранения остаются доступны независимо от результата.', { type: 'success' });
    } catch (error) {
      if (error.code === 'ADMIN_API_OFFLINE' && state.pendingPublishStart) {
        state.previewStatus = {
          status: 'unknown-network-result',
          error: { message: 'Ответ запуска потерян. Админка сверит persisted job и повторит тот же idempotent запрос только при необходимости.' },
          updatedAt: new Date().toISOString()
        };
        state.publishOverview = { ...state.publishOverview, activeJob: state.previewStatus, latestJob: state.previewStatus };
        renderRoute();
        schedulePublishStartReconciliation(2_000);
        return;
      }
      state.pendingPublishStart = null;
      state.previewStatus = {
        status: error.code?.includes('UNKNOWN') ? 'unknown-network-result' : 'failure',
        error: { message: error.message },
        updatedAt: new Date().toISOString()
      };
      state.publishOverview = { ...state.publishOverview, activeJob: null, latestJob: state.previewStatus };
      renderRoute();
      notifications.toast(error.message, { type: 'error', duration: 0 });
    }
  }

  async function retryExactValidation(transactionId) {
    try {
      const run = await api.requestExactValidation(transactionId);
      state.publishOverview.transactions = (state.publishOverview.transactions || []).map((entry) => (
        entry.transactionId === transactionId
          ? { ...entry, exactStatus: run.status || 'queued', publishEligible: false, exactValidation: run }
          : entry
      ));
      state.publishSelection.delete(transactionId);
      renderRoute();
      scheduleExactPoll(500);
      notifications.toast('Повторная проверка поставлена в очередь. Локальное сохранение не изменилось.', { type: 'info' });
    } catch (error) {
      notifications.toast(error.message || 'Не удалось повторить exact-проверку.', { type: 'error', duration: 0 });
    }
  }

  function schedulePublishStartReconciliation(delay = 2_000) {
    if (!state.pendingPublishStart || !state.authenticated) return;
    if (state.publishPollTimer) clearTimeout(state.publishPollTimer);
    state.publishPollTimer = setTimeout(async () => {
      state.publishPollTimer = null;
      const pending = state.pendingPublishStart;
      if (!pending || !state.authenticated) return;
      try {
        const overview = await api.publishOverview();
        const existing = [overview.activeJob, overview.latestJob].find((job) => job?.planId === pending.planId);
        const job = existing || await api.publishApply(pending.planId, { idempotencyKey: pending.idempotencyKey });
        state.pendingPublishStart = null;
        state.publishOverview = overview;
        updatePublishJob(job);
        renderRoute();
        if (!['deploy-success', 'failure', 'empty'].includes(job.status)) schedulePublishPoll(job.jobId, 2_000);
      } catch (error) {
        pending.attempts += 1;
        if (error.code === 'ADMIN_API_OFFLINE' && pending.attempts < 12 && state.authenticated) {
          schedulePublishStartReconciliation(Math.min(60_000, 2_000 * (2 ** Math.min(pending.attempts, 5))));
          return;
        }
        state.pendingPublishStart = null;
        state.previewStatus = { status: 'failure', error: { message: error.message }, updatedAt: new Date().toISOString() };
        renderRoute();
        notifications.toast(error.message, { type: 'error', duration: 0 });
      }
    }, delay);
  }

  function updatePublishJob(job) {
    if (!job) return;
    state.publishOverview = {
      ...state.publishOverview,
      activeJob: ['deploy-success', 'failure', 'empty'].includes(job.status) ? null : job,
      latestJob: job,
      previewUrl: job.previewUrl || state.publishOverview.previewUrl
    };
    state.previewStatus = {
      ...job,
      previewUrl: job.previewUrl || state.publishOverview.previewUrl || '',
      lastSuccessfulPreviewSHA: state.publishOverview.lastSuccessfulPreviewSHA || null
    };
  }

  function schedulePublishPoll(jobId, delay = 5_000, failureCount = 0) {
    if (!jobId) return;
    if (state.publishPollTimer) clearTimeout(state.publishPollTimer);
    state.publishPollTimer = setTimeout(async () => {
      state.publishPollTimer = null;
      try {
        const job = await api.publishJob(jobId);
        updatePublishJob(job);
        if (['overview', 'preview'].includes(router.current.view)) renderRoute();
        if (['preparing', 'local-gates', 'committed', 'pushed', 'workflow-queued', 'building'].includes(job.status)) {
          schedulePublishPoll(jobId, 5_000);
        } else if (job.status === 'deploy-success' || job.status === 'empty') {
          await refreshPreviewStatus();
          if (['overview', 'preview'].includes(router.current.view)) renderRoute();
          notifications.toast(job.status === 'empty'
            ? 'Выбранные данные уже соответствуют доказанно успешной версии. Новая сборка не запускалась.'
            : 'Тестовый сайт обновлён и проверен по точной версии.', { type: 'success', duration: 8000 });
        } else if (job.status === 'failure') {
          notifications.toast(job.error?.message || 'Обновление тестового сайта остановлено. Локальные данные сохранены.', { type: 'error', duration: 0 });
        }
      } catch (error) {
        if (!state.authenticated || error.status === 401) return;
        const nextFailure = failureCount + 1;
        if (nextFailure === 1 || nextFailure === 4) {
          notifications.toast(`Связь со статусом публикации временно потеряна: ${error.message}. Повторяем автоматически.`, { type: 'error', duration: nextFailure === 1 ? 8000 : 0 });
        }
        schedulePublishPoll(jobId, Math.min(60_000, 3_000 * (2 ** Math.min(nextFailure, 5))), nextFailure);
      }
    }, delay);
  }

  async function retryPublish(jobId) {
    try {
      const job = await api.retryPublishJob(jobId);
      updatePublishJob(job);
      renderRoute();
      if (!['deploy-success', 'failure', 'empty', 'unknown-network-result'].includes(job.status)) schedulePublishPoll(job.jobId, 2_000);
    } catch (error) {
      notifications.toast(error.message, { type: 'error', duration: 0 });
    }
  }

  async function downloadPublishReport(jobId) {
    try {
      const result = await api.publishReport(jobId);
      downloadBlob(result.filename, result.blob);
    } catch (error) {
      notifications.toast(error.message, { type: 'error', duration: 0 });
    }
  }

  function openTestSite() {
    const url = state.publishOverview.previewUrl || state.previewStatus.previewUrl || state.previewStatus.url;
    if (!url) return notifications.toast('Адрес тестового сайта пока не получен.', { type: 'info' });
    safeExternalOpen(url);
  }

  document.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLocaleLowerCase() === 's') {
      event.preventDefault();
      void saveCurrent();
    } else if (modifier && event.key.toLocaleLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      state.current?.history?.undo();
    } else if (modifier && (event.key.toLocaleLowerCase() === 'y' || (event.key.toLocaleLowerCase() === 'z' && event.shiftKey))) {
      event.preventDefault();
      state.current?.history?.redo();
    } else if (modifier && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      runAfterDirtyResolution(() => {
        if (router.current.view !== 'overview') router.navigate({ view: 'overview', collection: '', slug: '' });
        requestAnimationFrame(() => state.workspace?.focusSearch?.());
      });
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!state.current?.history?.snapshot().dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (!localBrowserHost) {
    for (const control of loginForm.elements) control.disabled = true;
    loginStatus.className = 'admin-alert admin-alert--warning';
    showLogin('Эта опубликованная страница работает только как инструкция. Чтобы редактировать сайт, запустите локальную админку двойным кликом или командой npm run admin на настроенном компьютере.');
    return;
  }

  try {
    const session = await api.me();
    if (session.authenticated) {
      showApp(session);
      await bootstrap();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin(error.message || 'Не удалось подключиться к локальной админке.');
  }
}

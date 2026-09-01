import { createAdminApiClient, AdminApiError } from '../core/api-client.mjs';
import { createDraftStore } from '../state/draft-store.mjs';
import { createHistoryStore, getAtPath, setAtPath } from '../state/history-store.mjs';
import { createMediaQueueStore } from '../state/media-queue-store.mjs';
import {
  addDirectionRelation,
  directionTargetKey,
  moveDirectionItem,
  orderedDirectionItems,
  renumberDirectionItems,
  removeDirectionRelation,
  updateDirectionItem
} from '../state/direction-presentation-editor.mjs';
import { createMediaScheduler } from '../../../tools/admin-api/media-scheduler.mjs';

const BRIDGE_PROTOCOL = 'smu1-editor-bridge';
const BRIDGE_VERSION = 1;
const COLLECTIONS = Object.freeze([
  'product-sections',
  'product-categories',
  'products',
  'services',
  'projects',
  'jobs',
  'site-settings',
  'static-pages'
]);
const GROUP_ORDER = Object.freeze([
  'Главная',
  'Направления',
  'Категории',
  'Товары',
  'Выполненные объекты',
  'Компания и связь',
  'Вакансии',
  'Служебные страницы'
]);
const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900, label: 'Компьютер' }),
  tablet: Object.freeze({ width: 834, height: 1112, label: 'Планшет' }),
  mobile: Object.freeze({ width: 390, height: 844, label: 'Телефон' })
});
const SHORT_TEXT_TOOLS = new Set(['short-text', 'heading', 'button-label', 'caption']);
const STRUCTURAL_PATHS = new Set(['slug', 'parentSectionSlug', 'productCategorySlug', 'presentationType']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_MEDIA_FILES = 50;
const MAX_MEDIA_BYTES = 250 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PUBLISH_RUNNING_STATUSES = new Set([
  'preparing',
  'local-gates',
  'committed',
  'pushed',
  'workflow-queued',
  'building',
  'unknown-network-result'
]);

function publishJobRunning(job) {
  return Boolean(job && PUBLISH_RUNNING_STATUSES.has(job.status));
}

function publishJobVerified(job) {
  const smoke = job?.evidence?.smoke;
  return job?.status === 'deploy-success'
    && job?.success === true
    && smoke?.byteIdentityVerified === true
    && smoke?.identityVerified === true
    && smoke?.artifactIdentity?.testedCommitSha === job?.testedSha;
}

function required(scope, selector) {
  const value = scope.querySelector(selector);
  if (!value) throw new Error(`Visual editor element is missing: ${selector}`);
  return value;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null || typeof left !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeRoute(value) {
  const pathname = String(value || '/').split(/[?#]/u, 1)[0] || '/';
  if (pathname === '/404.html') return pathname;
  const leading = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return leading === '/' ? '/' : `${leading.replace(/\/+$/u, '')}/`;
}

function withBase(base, pathname) {
  const normalizedBase = String(base || '/').replace(/\/+$/u, '');
  const normalizedPath = String(pathname || '/').startsWith('/') ? String(pathname || '/') : `/${pathname}`;
  return `${normalizedBase}${normalizedPath}` || '/';
}

function debounce(callback, delay = 250) {
  let timer = 0;
  const wrapped = (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
  wrapped.cancel = () => window.clearTimeout(timer);
  return wrapped;
}

function humanBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function displayValue(value) {
  if (value === undefined) return 'не задано';
  if (value === null) return 'пусто';
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'элемент' : 'элементов'}`;
  if (typeof value === 'object') return 'набор параметров';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  const string = String(value).replace(/\s+/gu, ' ').trim();
  return string || 'пусто';
}

function fieldLabel(path) {
  const labels = {
    title: 'Название', heroTitle: 'Заголовок страницы', heroDescription: 'Вводный текст',
    heroKicker: 'Надпись над заголовком', heroPrimaryLabel: 'Основная кнопка',
    heroSecondaryLabel: 'Вторая кнопка', shortDescription: 'Короткое описание', leadText: 'Вводный текст',
    description: 'Описание', priceMode: 'Формат цены', priceFrom: 'Цена', currency: 'Валюта',
    seoTitle: 'SEO-заголовок', seoDescription: 'SEO-описание', isActive: 'Показывать на сайте',
    showInCatalog: 'Показывать в каталоге', image: 'Главная фотография', gallery: 'Галерея',
    coverImage: 'Обложка', phonePrimary: 'Основной телефон', phoneSecondary: 'Дополнительный телефон',
    telegram: 'Telegram', email: 'Электронная почта', address: 'Адрес', legalAddress: 'Юридический адрес'
  };
  const last = String(path || '').split('.').filter(Boolean).at(-1) || path;
  return labels[last] || String(last || 'Поле').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function iconFor(descriptor) {
  const icons = {
    home: '⌂', direction: '↗', category: '▦', product: '□', projects: '◇', project: '◆',
    company: 'С', contacts: '@', vacancies: 'В', job: '₽', custom: '+', legal: '§', notFound: '404', alias: '↪'
  };
  return icons[descriptor.kind] || '·';
}

function descriptorSearchText(descriptor) {
  return [descriptor.title, descriptor.route, descriptor.slug, descriptor.typeLabel, descriptor.categoryTitle, descriptor.group]
    .filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
}

function diffLeaves(before, after, prefix = '', result = []) {
  if (deepEqual(before, after)) return result;
  if (Array.isArray(before) || Array.isArray(after)) {
    result.push({ path: prefix, before: clone(before), after: clone(after) });
    return result;
  }
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) diffLeaves(before[key], after[key], prefix ? `${prefix}.${key}` : key, result);
    return result;
  }
  result.push({ path: prefix, before: clone(before), after: clone(after) });
  return result;
}

function mediaPath(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return String(value.src || value.image || value.url || value.path || '');
}

function activeEntry(entry) {
  return entry?.isActive !== false;
}

function entryOrder(left, right) {
  return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
    || String(left.title || '').localeCompare(String(right.title || ''), 'ru');
}

function buildPageRegistry(summaries) {
  const pages = [];
  const add = (descriptor) => pages.push(Object.freeze({
    emitted: descriptor.emitted !== false,
    isActive: descriptor.isActive !== false,
    missingMedia: Boolean(descriptor.missingMedia),
    hasError: Boolean(descriptor.hasError),
    ...descriptor,
    route: normalizeRoute(descriptor.route)
  }));
  const list = (collection) => [...(summaries.get(collection) || [])].sort(entryOrder);
  const sections = list('product-sections');
  const services = list('services');
  const categories = list('product-categories');
  const products = list('products');
  const projects = list('projects');
  const jobs = list('jobs');
  const staticPages = list('static-pages');
  const sectionBySlug = new Map(sections.map((entry) => [entry.slug, entry]));
  const categoryBySlug = new Map(categories.map((entry) => [entry.slug, entry]));

  const home = staticPages.find((entry) => entry.slug === 'home');
  if (home) add({
    kind: 'home', group: 'Главная', typeLabel: 'Главная', title: home.title,
    route: '/', collection: 'static-pages', slug: home.slug, isActive: activeEntry(home), entry: home
  });

  for (const entry of [...sections, ...services].sort(entryOrder)) add({
    kind: 'direction', group: 'Направления', typeLabel: entry.summary?.mode === 'catalog-hub' ? 'Каталог направлений' : 'Направление',
    title: entry.title, route: `/${entry.slug}/`, collection: sections.includes(entry) ? 'product-sections' : 'services',
    slug: entry.slug, isActive: activeEntry(entry), emitted: activeEntry(entry), missingMedia: !entry.summary?.hasPrimaryMedia,
    entry
  });

  for (const entry of categories) {
    const parent = sectionBySlug.get(entry.summary?.parentSectionSlug);
    add({
      kind: 'category', group: 'Категории', typeLabel: 'Категория', title: entry.title,
      route: `/${entry.summary?.parentSectionSlug || 'catalog'}/${entry.slug}/`, collection: 'product-categories', slug: entry.slug,
      parentSlug: entry.summary?.parentSectionSlug || '', parentRoute: parent ? `/${parent.slug}/` : '/', categoryTitle: parent?.title || '',
      isActive: activeEntry(entry) && activeEntry(parent), emitted: activeEntry(entry) && activeEntry(parent),
      missingMedia: !entry.summary?.hasPrimaryMedia && !entry.summary?.galleryCount, entry
    });
  }

  for (const entry of products) {
    const category = categoryBySlug.get(entry.summary?.productCategorySlug);
    const parentSlug = category?.summary?.parentSectionSlug || 'catalog';
    add({
      kind: 'product', group: 'Товары', typeLabel: entry.summary?.presentationType === 'premium' ? 'Премиальный товар' : 'Товар',
      title: entry.title, route: `/${parentSlug}/${entry.summary?.productCategorySlug || 'category'}/${entry.slug}/`,
      collection: 'products', slug: entry.slug, parentSlug: entry.summary?.productCategorySlug || '',
      parentRoute: category ? `/${parentSlug}/${category.slug}/` : '/', categoryTitle: category?.title || '',
      isActive: activeEntry(entry) && entry.summary?.showInCatalog !== false && activeEntry(category),
      emitted: activeEntry(entry) && entry.summary?.showInCatalog !== false && activeEntry(category),
      missingMedia: !entry.summary?.hasPrimaryMedia && !entry.summary?.galleryCount, entry
    });
  }

  const archive = staticPages.find((entry) => entry.slug === 'vypolnennye-obekty');
  if (archive) add({
    kind: 'projects', group: 'Выполненные объекты', typeLabel: 'Архив объектов', title: archive.title,
    route: '/vypolnennye-obekty/', collection: 'static-pages', slug: archive.slug,
    isActive: activeEntry(archive), entry: archive
  });
  for (const entry of projects) add({
    kind: 'project', group: 'Выполненные объекты', typeLabel: 'Выполненный объект', title: entry.title,
    route: `/vypolnennye-obekty/${entry.slug}/`, collection: 'projects', slug: entry.slug,
    parentRoute: '/vypolnennye-obekty/', isActive: activeEntry(entry), emitted: activeEntry(entry),
    missingMedia: !entry.summary?.hasPrimaryMedia && !entry.summary?.galleryCount, entry
  });

  const company = staticPages.find((entry) => entry.slug === 'o-nas');
  if (company) add({ kind: 'company', group: 'Компания и связь', typeLabel: 'О компании', title: company.title, route: '/o-nas/', collection: 'static-pages', slug: company.slug, isActive: activeEntry(company), entry: company });
  add({ kind: 'contacts', group: 'Компания и связь', typeLabel: 'Контакты', title: 'Контакты', route: '/kontakty/', collection: 'site-settings', slug: 'global', scope: 'global' });
  const customOrder = staticPages.find((entry) => entry.slug === 'custom-order');
  if (customOrder) add({ kind: 'custom', group: 'Компания и связь', typeLabel: 'Изготовление на заказ', title: customOrder.title, route: '/izgotovlenie-na-zakaz/', collection: 'static-pages', slug: customOrder.slug, isActive: activeEntry(customOrder), entry: customOrder });

  add({ kind: 'vacancies', group: 'Вакансии', typeLabel: 'Архив вакансий', title: 'Вакансии', route: '/vakansii/', collection: 'site-settings', slug: 'global', scope: 'shared' });
  for (const entry of jobs) add({
    kind: 'job', group: 'Вакансии', typeLabel: 'Вакансия', title: entry.title,
    route: `/vakansii/${entry.slug}/`, collection: 'jobs', slug: entry.slug, parentRoute: '/vakansii/',
    isActive: activeEntry(entry), emitted: activeEntry(entry), entry
  });

  add({ kind: 'legal', group: 'Служебные страницы', typeLabel: 'Юридический документ', title: 'Политика конфиденциальности', route: '/politika-konfidencialnosti/', collection: 'site-settings', slug: 'global', scope: 'legal', legal: true });
  add({ kind: 'notFound', group: 'Служебные страницы', typeLabel: 'Системная страница', title: 'Страница не найдена', route: '/404.html', collection: 'site-settings', slug: 'global', scope: 'shared' });
  add({ kind: 'alias', group: 'Служебные страницы', typeLabel: 'Совместимый адрес', title: 'Лавочки и скамейки — старый адрес', route: '/lavochki-i-skameyki/', readOnly: true, canonicalTarget: '/ulichnaya-mebel/lavochki-i-skameyki/' });
  add({ kind: 'alias', group: 'Служебные страницы', typeLabel: 'Совместимый адрес', title: 'Урны — старый адрес', route: '/urny/', readOnly: true, canonicalTarget: '/ulichnaya-mebel/urny/' });
  add({ kind: 'alias', group: 'Служебные страницы', typeLabel: 'Совместимый адрес', title: 'Навесы — старый адрес', route: '/navesy/', readOnly: true, canonicalTarget: '/navesy-i-kozyrki/' });

  return pages.sort((left, right) => GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group)
    || entryOrder(left.entry || left, right.entry || right));
}

function createToastRegion(region, liveRegion) {
  return Object.freeze({
    toast(message, kind = 'success', duration = kind === 'error' ? 0 : 5200) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 've-toast';
      node.dataset.kind = kind;
      node.setAttribute('aria-label', `${String(message)}. Закрыть уведомление`);
      node.textContent = String(message);
      region.append(node);
      liveRegion.textContent = String(message);
      const remove = () => node.remove();
      node.addEventListener('click', remove, { once: true });
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') remove();
      });
      if (duration) window.setTimeout(remove, duration);
      return node;
    },
    announce(message) { liveRegion.textContent = String(message); }
  });
}

function restoreFocusDialog(dialog, trigger) {
  if (dialog.open) {
    dialog.querySelector('input, button:not([data-dialog-close]), select, textarea')?.focus();
    return;
  }
  const previous = trigger || document.activeElement;
  dialog.showModal();
  requestAnimationFrame(() => {
    dialog.querySelector('input, button:not([data-dialog-close]), select, textarea')?.focus();
  });
  dialog.addEventListener('close', () => {
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  }, { once: true });
}

export async function startVisualEditor() {
  const root = required(document, '#visualEditorRoot');
  const repoMarker = String(root.dataset.repoIdentity || '');
  const repoMatch = /^smu1-admin-runtime:v1:ui:([a-f0-9]{64})$/u.exec(repoMarker);
  if (!repoMatch) throw new Error('Локальный редактор не получил подтверждённую идентичность рабочей папки. Перезапустите его ярлыком.');
  const REPO_IDENTITY = repoMatch[1];
  const storageKey = (name) => `smu1-admin:${REPO_IDENTITY}:${name}`;
  const login = required(root, '#veLogin');
  const loginForm = required(root, '#veLoginForm');
  const loginStatus = required(root, '#veLoginStatus');
  const loginSubmit = required(root, '#veLoginSubmit');
  const app = required(root, '#veApp');
  const navigator = required(root, '#veNavigator');
  const navigatorToggle = required(root, '#veNavigatorToggle');
  const search = required(root, '#veSearch');
  const pageTree = required(root, '#vePageTree');
  const recentSection = required(root, '#veRecent');
  const recentList = required(root, '#veRecentList');
  const favoritesSection = required(root, '#veFavorites');
  const favoritesList = required(root, '#veFavoritesList');
  const frame = required(root, '#veFrame');
  const canvasScroller = required(root, '#veCanvasScroller');
  const canvasViewport = required(root, '#veCanvasViewport');
  const overlay = required(root, '#veOverlay');
  const canvasHint = required(root, '#veCanvasHint');
  const breadcrumbs = required(root, '#veBreadcrumbs');
  const pagePickerType = required(root, '#vePagePickerType');
  const pagePickerTitle = required(root, '#vePagePickerTitle');
  const previousMaterial = required(root, '#vePreviousMaterial');
  const nextMaterial = required(root, '#veNextMaterial');
  const back = required(root, '#veBack');
  const forward = required(root, '#veForward');
  const undoButton = required(root, '#veUndo');
  const redoButton = required(root, '#veRedo');
  const saveButton = required(root, '#veSave');
  const statusButton = required(root, '#veStatus');
  const statusLabel = required(root, '#veStatusLabel');
  const inspector = required(root, '#veInspector');
  const inspectorKicker = required(root, '#veInspectorKicker');
  const inspectorTitle = required(root, '#veInspectorTitle');
  const inspectorForm = required(root, '#veInspectorForm');
  const provenance = required(root, '#veProvenance');
  const inlineEditor = required(root, '#veInlineEditor');
  const inlineLabel = required(root, '#veInlineLabel');
  const inlineInput = required(root, '#veInlineInput');
  const changesTray = required(root, '#veChangesTray');
  const changesCount = required(root, '#veChangesCount');
  const changesBody = required(root, '#veChangesBody');
  const pageDialog = required(root, '#vePageDialog');
  const pageDialogSearch = required(root, '#vePageDialogSearch');
  const pageDialogResults = required(root, '#vePageDialogResults');
  const commandDialog = required(root, '#veCommandDialog');
  const commandSearch = required(root, '#veCommandSearch');
  const commandResults = required(root, '#veCommandResults');
  const settingsDrawer = required(root, '#veSettingsDrawer');
  const settingsBody = required(root, '#veSettingsBody');
  const settingsSubtitle = required(root, '#veSettingsSubtitle');
  const publishDrawer = required(root, '#vePublishDrawer');
  const publishBody = required(root, '#vePublishBody');
  const mediaDialog = required(root, '#veMediaDialog');
  const mediaBody = required(root, '#veMediaBody');
  const mediaConfirm = required(root, '#veMediaConfirm');
  const mediaSubtitle = required(root, '#veMediaSubtitle');
  const conflictDialog = required(root, '#veConflictDialog');
  const conflictBody = required(root, '#veConflictBody');
  const notifications = createToastRegion(required(root, '#veToastRegion'), required(root, '#veLiveRegion'));
  const siteBase = String(root.dataset.siteBase || '/');
  const api = createAdminApiClient({
    baseUrl: root.dataset.apiBase,
    onSessionExpired: () => {
      notifications.toast('Сессия закончилась. Черновик сохранён в браузере — войдите снова, чтобы продолжить.', 'warning', 0);
      root.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close('session-expired'));
      app.hidden = true;
      login.hidden = false;
      requestAnimationFrame(() => required(root, '#veLoginName').focus());
    }
  });
  const draftStore = createDraftStore();
  const mediaQueueStore = createMediaQueueStore();
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`smu1-admin-h6-records:${REPO_IDENTITY}`) : null;
  const tabId = crypto.randomUUID();
  const frameNonce = crypto.randomUUID();

  const state = {
    username: '',
    summaries: new Map(),
    pages: [],
    pageByRoute: new Map(),
    records: new Map(),
    currentPage: null,
    currentBinding: null,
    bindingRows: [],
    bindingRegistry: new Map(),
    frameRevision: 0,
    bridgeSequence: -1,
    parentSequence: 0,
    mode: 'edit',
    viewport: 'desktop',
    filter: 'all',
    favorites: new Set(),
    recent: [],
    navigationStack: [],
    navigationIndex: -1,
    draftKeys: new Set(),
    commandUndo: [],
    commandRedo: [],
    status: 'saved',
    exact: { status: 'not-requested' },
    publishOverview: null,
    publishJob: null,
    publishRequestInFlight: false,
    backupStatus: null,
    backups: [],
    backupsLoaded: false,
    backupAction: null,
    lastTransactionIds: [],
    lastSaveLatencyMs: null,
    activeMedia: null,
    mediaScheduler: null,
    mediaQueue: [],
    mediaInitialCount: 0,
    mediaBatchId: '',
    mediaObjectUrls: new Set(),
    dragBinding: null,
    inlineGesture: null,
    remoteConflicts: new Map(),
    settingsTab: 'general',
    settingsRecordOverride: null,
    settingsContext: 'page',
    navigationRequest: 0,
    selectionRequest: 0,
    actionSequence: 0,
    replayingCommand: false
  };

  function readLocalJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch { return fallback; }
  }

  state.favorites = new Set(readLocalJson(storageKey('favorites'), []));
  state.recent = readLocalJson(storageKey('recent-pages'), []).filter((item) => typeof item === 'string').slice(0, 8);

  function recordKey(collection, slug) { return `${collection}:${slug}`; }
  function dirtyRecords() { return [...state.records.values()].filter((record) => record.history?.snapshot().dirty); }
  function currentRecord() {
    const page = state.currentPage;
    return page?.collection && page?.slug ? state.records.get(recordKey(page.collection, page.slug)) || null : null;
  }

  function setHumanStatus(status, detail = '') {
    state.status = status;
    const labels = {
      dirty: 'Есть несохранённые изменения',
      saved: 'Сохранено на компьютере',
      checking: 'Проверяется',
      ready: 'Готово к публикации',
      failed: 'Сохранено, но проверка не прошла',
      publishing: 'Тестовый сайт собирается',
      published: 'Тестовый сайт готов',
      publishFailed: 'Тестовая публикация не удалась'
    };
    statusButton.dataset.state = status;
    const backupSuffix = state.backupStatus?.lastError ? ' · резервная копия не создана' : '';
    statusLabel.textContent = `${detail || labels[status] || labels.saved}${backupSuffix}`;
  }

  function persistFavorites() {
    localStorage.setItem(storageKey('favorites'), JSON.stringify([...state.favorites]));
  }

  function pushRecent(route) {
    state.recent = [route, ...state.recent.filter((item) => item !== route)].slice(0, 8);
    localStorage.setItem(storageKey('recent-pages'), JSON.stringify(state.recent));
    renderRecentAndFavorites();
  }

  const draftPersistTimers = new Map();
  function persistRecordDraft(record) {
    const key = recordKey(record.collection, record.slug);
    window.clearTimeout(draftPersistTimers.get(key));
    draftPersistTimers.set(key, window.setTimeout(async () => {
      draftPersistTimers.delete(key);
      const snapshot = record.history.snapshot();
      if (!snapshot.dirty) {
        await draftStore.delete({ repoIdentity: REPO_IDENTITY, collection: record.collection, slug: record.slug }).catch(() => {});
        state.draftKeys.delete(key);
        return;
      }
      try {
        await draftStore.put({
          repoIdentity: REPO_IDENTITY,
          collection: record.collection,
          slug: record.slug,
          baseRevision: record.revision,
          schemaVersion: record.schemaVersion,
          content: snapshot.value,
          stagedMedia: record.stagedMedia || []
        });
        state.draftKeys.add(key);
      } catch (error) {
        notifications.toast(`Черновик виден на странице, но recovery-хранилище недоступно: ${error.message}`, 'warning', 0);
      }
    }, 280));
  }

  function onRecordChanged(record, reason) {
    record.undoActionStack ||= [];
    record.redoActionStack ||= [];
    const snapshot = record.history.snapshot();
    if (reason === 'commit') {
      const sequence = ++state.actionSequence;
      if (snapshot.undoCount > record.undoActionStack.length) record.undoActionStack.push(sequence);
      else if (record.undoActionStack.length) record.undoActionStack[record.undoActionStack.length - 1] = sequence;
      record.redoActionStack = [];
      if (!state.replayingCommand) state.commandRedo = [];
    } else if (reason === 'undo') {
      const originalSequence = record.undoActionStack.pop() || 0;
      record.redoActionStack.push({ originalSequence, readySequence: ++state.actionSequence });
    } else if (reason === 'redo') {
      record.redoActionStack.pop();
      record.undoActionStack.push(++state.actionSequence);
    } else if (reason === 'boundary' || reason === 'reset') {
      record.undoActionStack = [];
      record.redoActionStack = [];
    }
    if (!['boundary', 'saved-boundary', 'reset'].includes(reason)) persistRecordDraft(record);
    else if (reason === 'saved-boundary' && snapshot.dirty) persistRecordDraft(record);
    updateChrome();
    renderChanges();
    projectDraftToFrame();
    projectCurrentReorderToFrame();
  }

  async function ensureRecord(collection, slug) {
    const key = recordKey(collection, slug);
    if (state.records.has(key)) return state.records.get(key);
    const payload = await api.read(collection, slug);
    const recovery = await draftStore.get({ repoIdentity: REPO_IDENTITY, collection, slug }).catch(() => null);
    let initial = payload.content;
    let recoveryConflict = null;
    if (recovery) {
      if (recovery.baseRevision === payload.revision) {
        initial = recovery.content;
        state.draftKeys.add(key);
      } else {
        recoveryConflict = recovery;
        state.remoteConflicts.set(key, { mine: recovery.content, theirs: payload.content, baseRevision: recovery.baseRevision, currentRevision: payload.revision });
      }
    }
    const record = {
      collection, slug, revision: payload.revision, schemaVersion: payload.schemaVersion,
      loadedContent: clone(payload.content), stagedMedia: recovery?.stagedMedia || [], recoveryConflict,
      history: null
    };
    record.history = createHistoryStore(payload.content, {
      capacity: 240,
      coalesceMs: 720,
      onChange: (_snapshot, reason) => onRecordChanged(record, reason)
    });
    if (!deepEqual(initial, payload.content)) record.history.commit(initial, { label: 'Восстановленный черновик', force: true });
    state.records.set(key, record);
    if (recoveryConflict) {
      notifications.toast('Найден черновик от более старой версии. Он не перезаписал новые данные; откройте сравнение изменений.', 'warning', 0);
    } else if (recovery && !deepEqual(recovery.content, payload.content)) {
      notifications.toast(`Восстановлен браузерный черновик: ${payload.content?.title || slug}.`, 'success');
    }
    return record;
  }

  async function ensureNavigationRecord() {
    const key = recordKey('navigation', 'navigation');
    if (state.records.has(key)) return state.records.get(key);
    const payload = await api.readNavigation();
    const recovery = await draftStore.get({ repoIdentity: REPO_IDENTITY, collection: 'navigation', slug: 'navigation' }).catch(() => null);
    const canonical = { items: payload.items || [] };
    const initial = recovery?.baseRevision === payload.revision ? recovery.content : canonical;
    const recoveryConflict = recovery && recovery.baseRevision !== payload.revision ? recovery : null;
    const record = {
      collection: 'navigation', slug: 'navigation', revision: payload.revision, schemaVersion: payload.schemaVersion,
      loadedContent: clone(canonical), stagedMedia: [], recoveryConflict, history: null
    };
    record.history = createHistoryStore(canonical, {
      capacity: 240, coalesceMs: 720, onChange: (_snapshot, reason) => onRecordChanged(record, reason)
    });
    if (!deepEqual(initial, canonical)) record.history.commit(initial, { label: 'Восстановленный черновик навигации', force: true });
    state.records.set(key, record);
    if (recoveryConflict) state.remoteConflicts.set(key, { mine: recovery.content, theirs: canonical, baseRevision: recovery.baseRevision, currentRevision: payload.revision });
    return record;
  }

  async function readEditorRecord(record) {
    if (record.collection === 'navigation') {
      const payload = await api.readNavigation();
      return { content: { items: payload.items || [] }, revision: payload.revision, schemaVersion: payload.schemaVersion };
    }
    return api.read(record.collection, record.history.snapshot().value.slug || record.slug);
  }

  async function loadSummaries() {
    const currentRoute = state.currentPage?.route || '';
    const rows = await Promise.all(COLLECTIONS.map(async (collection) => {
      const result = await api.list(collection);
      return [collection, result.entries || []];
    }));
    state.summaries = new Map(rows);
    state.pages = buildPageRegistry(state.summaries);
    state.pageByRoute = new Map(state.pages.map((page) => [page.route, page]));
    if (currentRoute && state.pageByRoute.has(currentRoute)) {
      state.currentPage = state.pageByRoute.get(currentRoute);
      pagePickerType.textContent = state.currentPage.typeLabel;
      pagePickerTitle.textContent = state.currentPage.title;
      renderBreadcrumbs();
      updateMaterialNavigation();
    }
    const drafts = await draftStore.list(REPO_IDENTITY).catch(() => []);
    state.draftKeys = new Set(drafts.map((draft) => recordKey(draft.collection, draft.slug)));
    renderNavigator();
  }

  function pageMatches(page, query = search.value) {
    const normalized = String(query || '').trim().toLocaleLowerCase('ru-RU');
    if (normalized && !descriptorSearchText(page).includes(normalized)) return false;
    if (state.filter === 'changed' && !state.draftKeys.has(recordKey(page.collection, page.slug))) return false;
    if (state.filter === 'missing-media' && !page.missingMedia) return false;
    if (state.filter === 'hidden' && page.isActive !== false) return false;
    if (state.filter === 'errors' && !page.hasError && state.exact?.status !== 'failed') return false;
    return true;
  }

  function pageItem(page, { compact = false } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 've-tree-item';
    wrapper.dataset.route = page.route;
    wrapper.setAttribute('role', 'treeitem');
    if (state.currentPage?.route === page.route) wrapper.setAttribute('aria-current', 'page');
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 've-tree-item';
    link.setAttribute('aria-label', `Открыть: ${page.title}`);
    if (state.currentPage?.route === page.route) link.setAttribute('aria-current', 'page');
    link.innerHTML = `<span class="ve-tree-item__icon">${escapeHtml(iconFor(page))}</span><span class="ve-tree-item__copy"><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(compact ? page.typeLabel : page.route)}</small></span>`;
    if (state.draftKeys.has(recordKey(page.collection, page.slug))) {
      const badge = document.createElement('span');
      badge.className = 've-tree-item__badge';
      badge.title = 'Есть браузерный черновик';
      link.append(badge);
    }
    link.addEventListener('click', () => void openPage(page));
    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 've-tree-item__favorite';
    favorite.setAttribute('aria-label', state.favorites.has(page.route) ? 'Убрать из избранного' : 'Добавить в избранное');
    favorite.setAttribute('aria-pressed', String(state.favorites.has(page.route)));
    favorite.textContent = state.favorites.has(page.route) ? '★' : '☆';
    favorite.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state.favorites.has(page.route)) state.favorites.delete(page.route);
      else state.favorites.add(page.route);
      persistFavorites();
      renderNavigator();
    });
    wrapper.replaceChildren(...link.childNodes, favorite);
    wrapper.addEventListener('click', (event) => {
      if (event.target.closest('.ve-tree-item__favorite')) return;
      void openPage(page);
    });
    wrapper.tabIndex = 0;
    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openPage(page); }
    });
    return wrapper;
  }

  function renderRecentAndFavorites() {
    const recentPages = state.recent.map((route) => state.pageByRoute.get(route)).filter(Boolean);
    recentSection.hidden = recentPages.length === 0;
    recentList.replaceChildren(...recentPages.slice(0, 4).map((page) => pageItem(page, { compact: true })));
    const favoritePages = state.pages.filter((page) => state.favorites.has(page.route));
    favoritesSection.hidden = favoritePages.length === 0;
    favoritesList.replaceChildren(...favoritePages.slice(0, 5).map((page) => pageItem(page, { compact: true })));
  }

  function renderNavigator() {
    const fragment = document.createDocumentFragment();
    for (const group of GROUP_ORDER) {
      const pages = state.pages.filter((page) => page.group === group && pageMatches(page));
      if (!pages.length) continue;
      const details = document.createElement('details');
      details.className = 've-tree-group';
      details.open = group !== 'Товары' || Boolean(search.value.trim()) || state.currentPage?.group === group;
      const summary = document.createElement('summary');
      summary.textContent = `${group} · ${pages.length}`;
      const items = document.createElement('div');
      items.className = 've-tree-group__items';
      items.replaceChildren(...pages.map((page) => pageItem(page)));
      details.append(summary, items);
      fragment.append(details);
    }
    if (!fragment.childNodes.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'padding:24px 14px;color:#718079;font-size:11px;line-height:1.6';
      empty.textContent = 'Ничего не найдено. Сбросьте фильтр или измените запрос.';
      fragment.append(empty);
    }
    pageTree.replaceChildren(fragment);
    renderRecentAndFavorites();
  }

  function currentSiblings() {
    const page = state.currentPage;
    if (!page) return [];
    if (page.kind === 'product') return state.pages.filter((item) => item.kind === 'product' && item.parentSlug === page.parentSlug && item.isActive);
    if (page.kind === 'project') return state.pages.filter((item) => item.kind === 'project' && item.isActive);
    if (page.kind === 'job') return state.pages.filter((item) => item.kind === 'job' && item.isActive);
    if (page.kind === 'category') return state.pages.filter((item) => item.kind === 'category' && item.parentSlug === page.parentSlug && item.isActive);
    return [];
  }

  function renderBreadcrumbs() {
    const page = state.currentPage;
    if (!page) return;
    const crumbs = [{ title: 'Главная редактора', route: '/' }];
    if (page.parentRoute) {
      const parent = state.pageByRoute.get(normalizeRoute(page.parentRoute));
      if (parent && parent.route !== page.route) crumbs.push({ title: parent.title, route: parent.route });
    } else if (page.group !== 'Главная') {
      crumbs.push({ title: page.group, route: '' });
    }
    crumbs.push({ title: page.title, route: page.route, current: true });
    const nodes = [];
    crumbs.forEach((crumb, index) => {
      if (index) {
        const separator = document.createElement('span');
        separator.setAttribute('aria-hidden', 'true');
        separator.textContent = '/';
        nodes.push(separator);
      }
      if (!crumb.current && crumb.route && state.pageByRoute.has(normalizeRoute(crumb.route))) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = crumb.title;
        button.addEventListener('click', () => void openPage(state.pageByRoute.get(normalizeRoute(crumb.route))));
        nodes.push(button);
      } else {
        const span = document.createElement('span');
        span.textContent = crumb.title;
        if (crumb.current) span.setAttribute('aria-current', 'page');
        nodes.push(span);
      }
    });
    breadcrumbs.replaceChildren(...nodes);
  }

  function updateMaterialNavigation() {
    const siblings = currentSiblings();
    const index = siblings.findIndex((item) => item.route === state.currentPage?.route);
    previousMaterial.disabled = index <= 0;
    nextMaterial.disabled = index < 0 || index >= siblings.length - 1;
    previousMaterial.title = index > 0 ? siblings[index - 1].title : 'Нет предыдущего материала';
    nextMaterial.title = index >= 0 && index < siblings.length - 1 ? siblings[index + 1].title : 'Нет следующего материала';
  }

  function updateChrome() {
    const dirty = dirtyRecords();
    saveButton.disabled = dirty.length === 0;
    changesTray.hidden = dirty.length === 0;
    if (dirty.length) setHumanStatus('dirty');
    else if (!['checking', 'ready', 'failed', 'publishing', 'published', 'publishFailed'].includes(state.status)) setHumanStatus('saved');
    const recordUndoAvailable = [...state.records.values()].some((record) => (record.undoActionStack || []).length > 0);
    const recordRedoAvailable = [...state.records.values()].some((record) => (record.redoActionStack || []).length > 0);
    undoButton.disabled = state.commandUndo.length === 0 && !recordUndoAvailable;
    redoButton.disabled = state.commandRedo.length === 0 && !recordRedoAvailable;
    back.disabled = state.navigationIndex <= 0;
    forward.disabled = state.navigationIndex < 0 || state.navigationIndex >= state.navigationStack.length - 1;
  }

  function buildCanvasUrl(page) {
    const url = new URL(withBase(siteBase, page.route), location.origin);
    url.searchParams.set('__smu1_editor', '1');
    url.searchParams.set('editorSession', frameNonce);
    url.searchParams.set('editorRevision', String(state.frameRevision));
    url.searchParams.set('editorMode', state.mode);
    return url.toString();
  }

  async function openPage(page, { history = 'push' } = {}) {
    if (!page) return;
    const requestId = ++state.navigationRequest;
    state.selectionRequest += 1;
    state.currentPage = page;
    state.currentBinding = null;
    state.bindingRows = [];
    state.bindingRegistry = new Map();
    state.frameRevision += 1;
    state.bridgeSequence = -1;
    state.parentSequence = 0;
    overlay.replaceChildren();
    closeInlineEditor();
    closeInspector({ restoreFocus: false });
    let openedRecord = null;
    if (page.collection && page.slug && !page.readOnly) {
      try { openedRecord = await ensureRecord(page.collection, page.slug); }
      catch (error) {
        if (requestId === state.navigationRequest) notifications.toast(error.message || 'Не удалось открыть данные страницы.', 'error', 0);
      }
    }
    if (requestId !== state.navigationRequest) return;
    if (history === 'push') {
      state.navigationStack.splice(state.navigationIndex + 1);
      state.navigationStack.push(page.route);
      state.navigationIndex = state.navigationStack.length - 1;
    }
    frame.src = buildCanvasUrl(page);
    pagePickerType.textContent = page.typeLabel;
    pagePickerTitle.textContent = page.title;
    canvasHint.textContent = page.readOnly
      ? page.canonicalTarget
        ? `Совместимый адрес. Каноническая страница: ${page.canonicalTarget}`
        : 'Системные свойства страницы вычисляются; бизнес-текст откроется в специальном редакторе.'
      : 'Нажмите на текст, карточку или фотографию, чтобы изменить';
    pushRecent(page.route);
    renderBreadcrumbs();
    updateMaterialNavigation();
    renderNavigator();
    updateChrome();
    if (openedRecord?.recoveryConflict && !openedRecord.recoveryConflictDialogShown) {
      openedRecord.recoveryConflictDialogShown = true;
      window.setTimeout(() => showRecoveryConflict(openedRecord), 0);
    }
  }

  function postToFrame(type, payload = {}) {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage({
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_VERSION,
      nonce: frameNonce,
      revision: state.frameRevision,
      sequence: state.parentSequence++,
      type,
      ...payload
    }, location.origin);
  }

  function recordForBinding(binding) {
    const owner = binding?.owner || {};
    const collection = binding?.ownerCollection || owner.collection || owner.key;
    const slug = binding?.recordSlug || owner.slug;
    return collection && slug ? state.records.get(recordKey(collection, slug)) || null : null;
  }

  async function ensureBindingRecord(binding) {
    const owner = binding?.owner || {};
    const collection = binding?.ownerCollection || owner.collection || owner.key;
    const slug = binding?.recordSlug || owner.slug;
    if (!collection || !slug) return null;
    if (collection === 'navigation' && slug === 'navigation') return ensureNavigationRecord();
    return ensureRecord(collection, slug);
  }

  function projectDraftToFrame() {
    const projections = [];
    for (const row of state.bindingRows) {
      const record = recordForBinding(row.binding);
      if (!record) continue;
      const content = record.history.snapshot().value;
      let value = getAtPath(content, row.binding.fieldPath);
      const fallbackPath = row.binding.projection?.fallback;
      if (fallbackPath && (value == null || (typeof value === 'string' && !value.trim()))) {
        value = getAtPath(content, fallbackPath);
      }
      if (row.binding.tool === 'price') {
        const mode = getAtPath(content, row.binding.modePath || 'priceMode');
        const amount = getAtPath(content, row.binding.valuePath || 'priceFrom');
        const currency = getAtPath(content, row.binding.currencyPath || 'currency');
        if (['from', 'exact'].includes(mode) && typeof amount === 'number') {
          const formatted = `${amount.toLocaleString('ru-RU')} ${currency === 'RUB' ? '₽' : currency || ''}`.trim();
          value = mode === 'from' ? `от ${formatted}` : formatted;
        } else value = mode === 'on_request' ? 'Цена по запросу' : 'Цена не указана';
      } else if (row.binding.tool === 'video') {
        const mobilePath = row.binding.mobilePath || `${row.binding.fieldPath}Mobile`;
        value = {
          __smu1VideoProjection: true,
          desktop: typeof value === 'string' && value.startsWith('/') ? withBase(siteBase, value) : value,
          mobile: (() => {
            const mobile = getAtPath(content, mobilePath);
            return typeof mobile === 'string' && mobile.startsWith('/') ? withBase(siteBase, mobile) : mobile;
          })()
        };
      } else if (row.binding.tool === 'media' || row.binding.tool === 'gallery') {
        const rawItems = Array.isArray(value) ? value : value ? [value] : [];
        const stagedByPath = new Map((record.stagedMedia || []).map((lease) => [lease.canonicalPath, lease]));
        const items = rawItems.map((item) => {
          const pathValue = mediaPath(item);
          const lease = stagedByPath.get(pathValue);
          return {
            src: lease ? api.stagedMediaPreviewUrl({ batchId: lease.batchId, leaseId: lease.leaseId }) : pathValue,
            alt: typeof item === 'object' ? item.alt || '' : '',
            caption: typeof item === 'object' ? item.caption || '' : ''
          };
        }).filter((item) => item.src);
        value = {
          __smu1MediaProjection: true,
          items,
          paths: items.map((item) => item.src)
        };
      } else if (row.binding.tool === 'list' || (Array.isArray(value) && row.binding.tool !== 'reorder-item')) {
        let projectedItems = value;
        if (Array.isArray(value) && row.binding.stableItemId) {
          const occurrence = value.find((item) => item && typeof item === 'object' && String(item.id || '') === String(row.binding.stableItemId));
          if (occurrence) projectedItems = occurrence;
        }
        value = {
          __smu1ListProjection: true,
          fieldPath: row.binding.fieldPath,
          stableItemId: row.binding.stableItemId || '',
          items: projectedItems
        };
      }
      if (row.binding.hrefPath) {
        const rawHref = getAtPath(content, row.binding.hrefPath);
        const field = String(row.binding.hrefPath);
        const href = field === 'phonePrimary' || field === 'phoneSecondary'
          ? `tel:${String(rawHref || '').replace(/[^+\d]/gu, '')}`
          : field === 'email'
            ? `mailto:${String(rawHref || '')}`
            : typeof rawHref === 'string' && rawHref.startsWith('/')
              ? withBase(siteBase, rawHref)
              : String(rawHref || '');
        value = { __smu1LinkProjection: true, text: value, href };
      }
      projections.push({ bindingId: row.binding.bindingId, value });
    }
    if (projections.length) postToFrame('projection', { projections });
  }

  function overlayLabel(binding) {
    if (binding.tool === 'reorder-item') return 'Переставить';
    if (binding.tool === 'media' || binding.tool === 'gallery') return 'Фотографии';
    if (binding.tool === 'video') return 'Видео';
    if (binding.tool === 'price') return 'Цена';
    return binding.label || fieldLabel(binding.fieldPath);
  }

  function registeredBindingRows(rows, { establish = false } = {}) {
    if (!Array.isArray(rows)) return [];
    const allowedCollections = new Set([...COLLECTIONS, 'navigation']);
    const nextRegistry = establish ? new Map() : state.bindingRegistry;
    const seen = new Set();
    const result = [];
    for (const row of rows) {
      const candidate = row?.binding;
      const id = String(candidate?.bindingId || '');
      const collection = String(candidate?.ownerCollection || candidate?.owner?.collection || '');
      const slug = String(candidate?.recordSlug || candidate?.owner?.slug || '');
      const fieldPath = String(candidate?.fieldPath || '');
      const valid = id.length > 8 && id.length <= 240
        && !seen.has(id)
        && allowedCollections.has(collection)
        && /^[a-z0-9-]+$/u.test(slug)
        && /^[A-Za-z0-9_.\[\]-]{1,300}$/u.test(fieldPath)
        && candidate?.renderer?.version === 'h6-v1'
        && Number(candidate?.currentDraftRevision) === state.frameRevision;
      if (!valid) continue;
      seen.add(id);
      if (establish) nextRegistry.set(id, clone(candidate));
      const registered = nextRegistry.get(id);
      if (!registered) continue;
      const rect = row?.rect;
      if (!rect || !['left', 'top', 'right', 'bottom', 'width', 'height'].every((key) => Number.isFinite(Number(rect[key])))) continue;
      result.push({ binding: registered, rect: Object.fromEntries(['left', 'top', 'right', 'bottom', 'width', 'height'].map((key) => [key, Number(rect[key])])) });
    }
    if (establish) state.bindingRegistry = nextRegistry;
    return result;
  }

  function renderOverlay() {
    const focused = overlay.contains(document.activeElement) && document.activeElement instanceof HTMLElement
      ? { bindingId: document.activeElement.dataset.bindingId || '', controlKey: document.activeElement.dataset.controlKey || '' }
      : null;
    overlay.replaceChildren();
    for (const row of state.bindingRows) {
      const { rect, binding } = row;
      if (!rect || rect.width < 4 || rect.height < 4 || rect.bottom < 0 || rect.right < 0) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 've-overlay-target';
      button.dataset.bindingId = binding.bindingId;
      button.dataset.controlKey = 'target';
      button.dataset.toolLabel = overlayLabel(binding);
      if (binding.role === 'h1' || binding.fieldPath === 'heroTitle') button.dataset.priority = 'primary';
      if (state.currentBinding?.binding?.bindingId === binding.bindingId) button.setAttribute('aria-pressed', 'true');
      else button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', `Изменить: ${overlayLabel(binding)}`);
      button.style.left = `${Math.max(0, rect.left)}px`;
      button.style.top = `${Math.max(0, rect.top)}px`;
      button.style.width = `${Math.max(8, rect.width)}px`;
      button.style.height = `${Math.max(8, rect.height)}px`;
      button.addEventListener('click', () => void selectBinding(binding, rect));
      if (binding.tool === 'reorder-item') {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 've-reorder-handle';
        handle.dataset.bindingId = binding.bindingId;
        handle.dataset.controlKey = 'handle';
        handle.textContent = '↕';
        handle.draggable = true;
        handle.title = 'Перетащить';
        handle.setAttribute('aria-label', `Перетащить: ${binding.label || binding.recordSlug}`);
        handle.style.left = `${Math.max(4, rect.left + 4)}px`;
        handle.style.top = `${Math.max(4, rect.top + 4)}px`;
        handle.addEventListener('dragstart', (event) => {
          state.dragBinding = binding;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', binding.bindingId);
          button.dataset.dragging = 'true';
        });
        handle.addEventListener('dragend', () => { state.dragBinding = null; delete button.dataset.dragging; });
        button.addEventListener('dragover', (event) => {
          if (!state.dragBinding) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          button.dataset.drop = 'true';
          const bounds = canvasViewport.getBoundingClientRect();
          if (event.clientY < bounds.top + 72) frame.contentWindow?.scrollBy({ top: -28, behavior: 'auto' });
          if (event.clientY > bounds.bottom - 72) frame.contentWindow?.scrollBy({ top: 28, behavior: 'auto' });
        });
        button.addEventListener('dragleave', () => { delete button.dataset.drop; });
        button.addEventListener('drop', (event) => {
          event.preventDefault();
          delete button.dataset.drop;
          if (state.dragBinding) void reorderBoundItems(state.dragBinding, binding);
        });
        const moves = document.createElement('span');
        moves.className = 've-reorder-moves';
        moves.style.left = `${Math.max(40, rect.right - 128)}px`;
        moves.style.top = `${Math.max(4, rect.top + 4)}px`;
        for (const [key, glyph, label] of [['Home', '⇤', 'В начало'], ['ArrowUp', '↑', 'Выше'], ['ArrowDown', '↓', 'Ниже'], ['End', '⇥', 'В конец']]) {
          const move = document.createElement('button');
          move.type = 'button';
          move.textContent = glyph;
          move.dataset.bindingId = binding.bindingId;
          move.dataset.controlKey = `move-${key}`;
          move.title = label;
          move.setAttribute('aria-label', `${label}: ${binding.label || binding.recordSlug}`);
          move.addEventListener('click', (event) => {
            event.stopPropagation();
            void keyboardReorder(binding, key);
          });
          moves.append(move);
        }
        handle.addEventListener('keydown', (event) => {
          if (!event.altKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          void keyboardReorder(binding, event.key);
        });
        overlay.append(handle, moves);
      }
      overlay.append(button);
    }
    if (focused?.bindingId) {
      const selector = `[data-binding-id="${CSS.escape(focused.bindingId)}"][data-control-key="${CSS.escape(focused.controlKey)}"]`;
      overlay.querySelector(selector)?.focus({ preventScroll: true });
    }
  }

  function handleBridgeMessage(event) {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const message = event.data;
    if (!message || message.protocol !== BRIDGE_PROTOCOL || message.version !== BRIDGE_VERSION) return;
    if (message.nonce !== frameNonce || message.revision !== state.frameRevision) return;
    if (!Number.isSafeInteger(message.sequence) || message.sequence <= state.bridgeSequence) return;
    state.bridgeSequence = message.sequence;
    if (message.type === 'ready') {
      state.bindingRows = registeredBindingRows(message.bindings, { establish: true });
      renderOverlay();
      projectDraftToFrame();
      canvasHint.textContent = state.bindingRows.length
        ? `Доступно элементов для редактирования: ${state.bindingRows.length}`
        : state.currentPage?.readOnly
          ? canvasHint.textContent
          : 'Для этой страницы пока доступны настройки страницы и режим «Все материалы».';
      return;
    }
    if (message.type === 'geometry') {
      state.bindingRows = registeredBindingRows(message.bindings);
      renderOverlay();
      return;
    }
    if (message.type === 'select' && message.binding && message.rect) {
      const registered = state.bindingRegistry.get(String(message.binding.bindingId || ''));
      if (registered) void selectBinding(registered, message.rect);
      return;
    }
    if (message.type === 'navigate' && message.href) {
      const url = new URL(message.href, location.origin);
      const route = normalizeRoute(url.pathname.replace(String(siteBase).replace(/\/$/u, ''), '') || '/');
      const target = state.pageByRoute.get(route);
      if (target) void openPage(target);
      else notifications.toast('Этот адрес не относится к редактируемым страницам сайта.', 'warning');
      return;
    }
    if (message.type === 'interaction-blocked') {
      notifications.toast('Отправка формы отключена внутри редактора. Проверяйте форму отдельно, без реальной отправки заявки.', 'warning');
    }
  }

  function commitField(record, path, value, label = '', { force = false } = {}) {
    if (!record || !path || STRUCTURAL_PATHS.has(path)) return;
    const current = record.history.snapshot().value;
    let next = setAtPath(current, path, value);
    const legalSourceChanged = record.collection === 'site-settings'
      && path !== 'privacyPolicy.confirmedAgainstGlobalAt'
      && (path.startsWith('privacyPolicy.') || ['companyName', 'inn', 'kpp', 'ogrn', 'legalAddress', 'email'].includes(path))
      && !deepEqual(getAtPath(current, path), value);
    if (legalSourceChanged && getAtPath(next, 'privacyPolicy')) {
      next = setAtPath(next, 'privacyPolicy.confirmedAgainstGlobalAt', '');
    }
    record.history.commit(next, {
      label: label || `Изменить: ${fieldLabel(path)}`,
      coalesceKey: `field:${record.collection}:${record.slug}:${path}`,
      force
    });
  }

  function positionInlineEditor(rect) {
    const width = Math.min(390, canvasViewport.clientWidth - 24);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, canvasViewport.clientWidth - width - 12));
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + 92 < canvasViewport.clientHeight ? preferredTop : Math.max(12, rect.top - 92);
    inlineEditor.style.left = `${left}px`;
    inlineEditor.style.top = `${top}px`;
  }

  function closeInlineEditor() {
    inlineEditor.hidden = true;
    inlineEditor.dataset.bindingId = '';
    state.inlineGesture = null;
  }

  function closeInspector({ restoreFocus = true } = {}) {
    const bindingId = state.currentBinding?.binding?.bindingId || '';
    inspector.hidden = true;
    app.dataset.inspectorOpen = 'false';
    inspectorForm.replaceChildren();
    provenance.hidden = true;
    if (restoreFocus && bindingId) {
      requestAnimationFrame(() => overlay.querySelector(`[data-binding-id="${CSS.escape(bindingId)}"][data-control-key="target"]`)?.focus({ preventScroll: true }));
    }
  }

  function affectedRoutesForBinding(binding) {
    const declared = Array.isArray(binding?.affectedRoutes) ? binding.affectedRoutes : [];
    if (declared.includes('*')) return state.pages.filter((page) => page.emitted).map((page) => page.route);
    return [...new Set(declared.filter(Boolean))];
  }

  function renderProvenance(binding) {
    const projection = binding.projection || {};
    const scope = binding.scope || 'local';
    const show = scope !== 'local' || projection.kind && projection.kind !== 'direct' || binding.legal === true;
    provenance.hidden = !show;
    if (!show) return;
    const affected = affectedRoutesForBinding(binding);
    const owner = binding.owner || {};
    provenance.innerHTML = `<strong>Источник: ${escapeHtml(owner.collection || owner.key || binding.ownerCollection || 'контент')} · ${escapeHtml(owner.slug || binding.recordSlug || '')}</strong>
      <span>${scope === 'global' ? 'Общее значение для сайта.' : scope === 'shared' ? 'Значение используется в нескольких местах.' : binding.legal ? 'Юридически значимый текст.' : 'Значение вычисляется из исходных данных.'}</span>
      ${projection.formula ? `<span> Правило: ${escapeHtml(projection.formula)}</span>` : ''}
      ${affected.length ? `<button type="button" data-show-impact>Используется на ${affected.length} страницах</button>` : ''}`;
    provenance.querySelector('[data-show-impact]')?.addEventListener('click', () => openSettings('impact', { record: state.currentBinding?.record || null, context: 'binding' }));
  }

  function renderTextInspector(record, binding, value, { multiline = true } = {}) {
    const label = document.createElement('label');
    label.className = 've-field';
    const span = document.createElement('span');
    span.textContent = binding.label || fieldLabel(binding.fieldPath);
    const control = document.createElement(multiline ? 'textarea' : 'input');
    control.value = value == null ? '' : String(value);
    if (!multiline) control.maxLength = Number(binding.validation?.maxLength || 240);
    control.addEventListener('input', () => commitField(record, binding.fieldPath, control.value));
    label.append(span, control);
    if (binding.validation?.hint) {
      const hint = document.createElement('p');
      hint.className = 've-field-hint';
      hint.textContent = binding.validation.hint;
      label.append(hint);
    }
    inspectorForm.append(label);
    requestAnimationFrame(() => control.focus());
  }

  function renderPriceInspector(record, binding) {
    const content = record.history.snapshot().value;
    const modePath = binding.modePath || 'priceMode';
    const valuePath = binding.valuePath || 'priceFrom';
    const currencyPath = binding.currencyPath || 'currency';
    const grid = document.createElement('fieldset');
    grid.className = 've-price-grid';
    grid.innerHTML = '<legend>Структурированная цена</legend>';
    const mode = document.createElement('label');
    mode.className = 've-field';
    mode.innerHTML = '<span>Формат</span><select><option value="from">Цена от</option><option value="exact">Точная цена</option><option value="on_request">По запросу</option><option value="none">Не показывать</option></select>';
    const modeSelect = required(mode, 'select');
    modeSelect.value = String(getAtPath(content, modePath) || 'on_request');
    const amount = document.createElement('label');
    amount.className = 've-field';
    amount.innerHTML = '<span>Сумма</span><input type="number" min="0" step="1" inputmode="numeric" />';
    const amountInput = required(amount, 'input');
    amountInput.value = getAtPath(content, valuePath) ?? '';
    const currency = document.createElement('label');
    currency.className = 've-field';
    currency.innerHTML = '<span>Валюта</span><select><option value="RUB">₽ · рубли</option></select>';
    const currencySelect = required(currency, 'select');
    currencySelect.value = getAtPath(content, currencyPath) || 'RUB';
    const sync = () => {
      let next = record.history.snapshot().value;
      next = setAtPath(next, modePath, modeSelect.value);
      next = setAtPath(next, valuePath, ['from', 'exact'].includes(modeSelect.value) && amountInput.value !== '' ? Number(amountInput.value) : null);
      next = setAtPath(next, currencyPath, currencySelect.value);
      record.history.commit(next, { label: 'Изменить цену', coalesceKey: `price:${record.slug}` });
      amountInput.disabled = !['from', 'exact'].includes(modeSelect.value);
    };
    modeSelect.addEventListener('change', sync);
    amountInput.addEventListener('input', sync);
    currencySelect.addEventListener('change', sync);
    amountInput.disabled = !['from', 'exact'].includes(modeSelect.value);
    grid.append(mode, amount, currency);
    inspectorForm.append(grid);
  }

  function renderVideoInspector(record, binding) {
    const section = document.createElement('fieldset');
    section.className = 've-drawer-grid';
    section.innerHTML = '<legend>Фоновое видео</legend><p class="ve-field-hint">Видео отделено от загрузчика фотографий: JPEG/PNG/WebP никогда не будут записаны в MP4-поле. Выберите уже подготовленные локальные MP4-файлы через медиатеку в режиме «Все материалы» либо укажите существующие безопасные пути.</p>';
    section.append(
      fieldControl(record, binding.fieldPath, 'Видео для компьютера'),
      fieldControl(record, binding.mobilePath || `${binding.fieldPath}Mobile`, 'Видео для телефона')
    );
    inspectorForm.append(section);
  }

  function listItemText(item) {
    if (typeof item === 'string') return item;
    return String(item?.text ?? item?.title ?? item?.label ?? item?.value ?? '');
  }

  function updateListItem(item, text) {
    if (typeof item === 'string') return text;
    if ('text' in item) return { ...item, text };
    if ('title' in item) return { ...item, title: text };
    if ('label' in item) return { ...item, label: text };
    if ('value' in item) return { ...item, value: text };
    return { ...item, text };
  }

  function renderListInspector(record, binding) {
    const container = document.createElement('fieldset');
    container.innerHTML = `<legend>${escapeHtml(binding.label || fieldLabel(binding.fieldPath))}</legend>`;
    const list = document.createElement('div');
    list.className = 've-list-editor';
    const render = () => {
      const items = clone(getAtPath(record.history.snapshot().value, binding.fieldPath) || []);
      list.replaceChildren();
      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 've-list-row';
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 've-list-row__handle';
        handle.textContent = '⋮⋮';
        handle.title = 'Перетащить или Alt + стрелка';
        handle.draggable = true;
        const input = document.createElement('input');
        input.value = listItemText(item);
        input.setAttribute('aria-label', `${binding.label || 'Элемент'} ${index + 1}`);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 've-list-row__remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Удалить элемент ${index + 1}`);
        const commitItems = (nextItems, label) => commitField(record, binding.fieldPath, nextItems, label);
        input.addEventListener('input', () => {
          const current = clone(getAtPath(record.history.snapshot().value, binding.fieldPath) || []);
          current[index] = updateListItem(current[index], input.value);
          commitItems(current, 'Изменить элемент списка');
        });
        remove.addEventListener('click', () => {
          const current = clone(getAtPath(record.history.snapshot().value, binding.fieldPath) || []);
          current.splice(index, 1);
          commitItems(current, 'Удалить элемент списка');
          render();
        });
        const move = (target) => {
          const current = clone(getAtPath(record.history.snapshot().value, binding.fieldPath) || []);
          if (target < 0 || target >= current.length || target === index) return;
          const [moved] = current.splice(index, 1);
          current.splice(target, 0, moved);
          commitItems(current.map((entry, position) => typeof entry === 'object' && entry ? { ...entry, order: (position + 1) * 10 } : entry), 'Изменить порядок списка');
          notifications.announce(`Элемент перемещён на позицию ${target + 1}.`);
          render();
        };
        handle.addEventListener('keydown', (event) => {
          if (!event.altKey) return;
          if (event.key === 'ArrowUp') { event.preventDefault(); move(index - 1); }
          if (event.key === 'ArrowDown') { event.preventDefault(); move(index + 1); }
          if (event.key === 'Home') { event.preventDefault(); move(0); }
          if (event.key === 'End') { event.preventDefault(); move(items.length - 1); }
        });
        handle.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', String(index)));
        row.addEventListener('dragover', (event) => event.preventDefault());
        row.addEventListener('drop', (event) => {
          event.preventDefault();
          const source = Number(event.dataTransfer.getData('text/plain'));
          if (!Number.isSafeInteger(source) || source < 0 || source >= items.length || source === index) return;
          const current = clone(getAtPath(record.history.snapshot().value, binding.fieldPath) || []);
          const [moved] = current.splice(source, 1);
          current.splice(index, 0, moved);
          commitItems(current.map((entry, position) => typeof entry === 'object' && entry
            ? { ...entry, order: (position + 1) * 10 }
            : entry), 'Изменить порядок списка');
          notifications.announce(`Элемент перемещён на позицию ${index + 1}.`);
          render();
        });
        row.append(handle, input, remove);
        list.append(row);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 've-add-row';
      add.textContent = '+ Добавить элемент';
      add.addEventListener('click', () => {
        const current = clone(getAtPath(record.history.snapshot().value, binding.fieldPath) || []);
        const sample = current[0];
        const valueKey = sample && typeof sample === 'object'
          ? ['text', 'title', 'label', 'value'].find((key) => Object.hasOwn(sample, key)) || 'text'
          : '';
        current.push(typeof sample === 'object' && sample
          ? { ...sample, id: crypto.randomUUID(), [valueKey]: '', order: (current.length + 1) * 10, isActive: true }
          : '');
        commitField(record, binding.fieldPath, current, 'Добавить элемент списка');
        render();
      });
      list.append(add);
    };
    render();
    container.append(list);
    inspectorForm.append(container);
  }

  function uniqueDraftSlug(collection, sourceSlug) {
    const stem = `${String(sourceSlug || 'material').replace(/-kopiya(?:-\d+)?$/u, '')}-kopiya`;
    const occupied = new Set([
      ...(state.summaries.get(collection) || []).map((entry) => entry.slug),
      ...[...state.records.values()].filter((record) => record.collection === collection).map((record) => record.slug)
    ]);
    if (!occupied.has(stem)) return stem;
    let index = 2;
    while (occupied.has(`${stem}-${index}`)) index += 1;
    return `${stem}-${index}`;
  }

  function duplicateRecordDraft(source, overrides = {}) {
    if (!source) return null;
    const sourceContent = source.history.snapshot().value;
    const slug = uniqueDraftSlug(source.collection, source.slug);
    const content = {
      ...clone(sourceContent),
      ...overrides,
      slug,
      title: `${sourceContent.title || 'Материал'} — копия`,
      order: Number(sourceContent.order || 0) + 5,
      ...('isActive' in sourceContent ? { isActive: false } : {}),
      ...('showInCatalog' in sourceContent ? { showInCatalog: false } : {})
    };
    const record = {
      collection: source.collection,
      slug,
      revision: 'missing',
      schemaVersion: source.schemaVersion,
      loadedContent: {},
      stagedMedia: [],
      recoveryConflict: null,
      history: null,
      isNew: true
    };
    record.history = createHistoryStore({}, {
      capacity: 240,
      coalesceMs: 720,
      onChange: (_snapshot, reason) => onRecordChanged(record, reason)
    });
    state.records.set(recordKey(record.collection, record.slug), record);
    record.history.commit(content, { label: `Создать копию: ${sourceContent.title || source.slug}`, force: true });
    state.currentBinding = { record, binding: { ownerCollection: record.collection, recordSlug: record.slug, fieldPath: 'title', label: 'Новый материал', scope: 'local', affectedRoutes: [] } };
    notifications.toast(`Создан скрытый браузерный черновик «${content.title}». Проверьте его и нажмите «Сохранить».`, 'success', 0);
    return record;
  }

  function renderReorderInspector(record, binding) {
    const descriptors = reorderDescriptorList(binding);
    const identity = binding.stableItemId || binding.recordSlug;
    const index = descriptors.findIndex((item) => (item.stableItemId || item.slug) === identity);
    const card = document.createElement('section');
    card.className = 've-reorder-inspector';
    card.innerHTML = `<p>Позиция <strong>${index >= 0 ? index + 1 : '—'}</strong> из ${descriptors.length}. Перестановка меняет данные и сохранится атомарно.</p>`;
    const actions = document.createElement('div');
    actions.className = 've-reorder-inspector__actions';
    for (const [key, label] of [['Home', 'В начало'], ['ArrowUp', 'Выше'], ['ArrowDown', 'Ниже'], ['End', 'В конец']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 've-button';
      button.textContent = label;
      button.disabled = index < 0 || (['Home', 'ArrowUp'].includes(key) && index === 0) || (['End', 'ArrowDown'].includes(key) && index === descriptors.length - 1);
      button.addEventListener('click', () => void keyboardReorder(binding, key));
      actions.append(button);
    }
    card.append(actions);
    if (['products', 'projects', 'jobs'].includes(record.collection)) {
      const entityActions = document.createElement('div');
      entityActions.className = 've-reorder-inspector__actions';
      const duplicate = document.createElement('button');
      duplicate.type = 'button';
      duplicate.className = 've-button';
      duplicate.textContent = 'Дублировать';
      duplicate.addEventListener('click', () => duplicateRecordDraft(record));
      const hide = document.createElement('button');
      hide.type = 'button';
      hide.className = 've-button';
      hide.textContent = 'Скрыть';
      hide.disabled = !('isActive' in record.history.snapshot().value) && !('showInCatalog' in record.history.snapshot().value);
      hide.addEventListener('click', () => {
        let next = record.history.snapshot().value;
        if ('isActive' in next) next = { ...next, isActive: false };
        if ('showInCatalog' in next) next = { ...next, showInCatalog: false };
        record.history.commit(next, { label: 'Скрыть материал с сайта', force: true });
        notifications.toast('Материал скрыт в браузерном черновике. Нажмите «Сохранить».', 'success');
      });
      entityActions.append(duplicate, hide);
      card.append(entityActions);
    }
    inspectorForm.append(card);
  }

  async function selectBinding(binding, rect) {
    const registered = state.bindingRegistry.get(String(binding?.bindingId || ''));
    if (!registered) return;
    binding = registered;
    const requestId = ++state.selectionRequest;
    const expectedFrameRevision = state.frameRevision;
    let record;
    try { record = await ensureBindingRecord(binding); }
    catch (error) { notifications.toast(error.message || 'Не удалось открыть источник элемента.', 'error', 0); return; }
    if (requestId !== state.selectionRequest || expectedFrameRevision !== state.frameRevision) return;
    if (!record) {
      notifications.toast('Этот элемент вычисляется шаблоном и пока недоступен для прямой правки. Откройте настройки страницы.', 'warning');
      openSettings('impact');
      return;
    }
    state.currentBinding = { binding, rect, record };
    renderOverlay();
    const value = getAtPath(record.history.snapshot().value, binding.fieldPath);
    const readOnly = binding.permissions?.edit === false || binding.projection?.kind === 'derived';
    if (readOnly) {
      closeInlineEditor();
      inspector.hidden = false;
      app.dataset.inspectorOpen = 'true';
      inspectorKicker.textContent = 'Вычисляемое значение';
      inspectorTitle.textContent = binding.label || fieldLabel(binding.fieldPath);
      inspectorForm.innerHTML = `<div class="ve-provenance" style="margin:0"><strong>Это значение нельзя менять напрямую.</strong><span>${escapeHtml(binding.projection?.formula || 'Оно вычисляется из порядка и связанных материалов.')}</span></div>`;
      renderProvenance(binding);
      return;
    }
    if (binding.tool === 'legal-section') {
      closeInlineEditor();
      inspector.hidden = false;
      app.dataset.inspectorOpen = 'true';
      inspectorKicker.textContent = 'Структурированный юридический раздел';
      inspectorTitle.textContent = binding.label || value?.heading || 'Раздел документа';
      inspectorForm.innerHTML = '<div class="ve-provenance" style="margin:0"><strong>Структура раздела защищена.</strong><span>Нажмите на конкретный заголовок, абзац или список внутри документа. Так heading/list integrity сохраняется и весь объект не превращается в свободный текст.</span></div>';
      renderProvenance(binding);
      return;
    }
    if (SHORT_TEXT_TOOLS.has(binding.tool)) {
      closeInspector({ restoreFocus: false });
      inlineLabel.textContent = binding.label || fieldLabel(binding.fieldPath);
      inlineInput.value = value == null ? '' : String(value);
      inlineEditor.dataset.bindingId = binding.bindingId;
      state.inlineGesture = { record, undoCount: record.history.snapshot().undoCount, started: false };
      positionInlineEditor(rect);
      inlineEditor.hidden = false;
      requestAnimationFrame(() => { inlineInput.focus(); inlineInput.select(); });
      return;
    }
    if (binding.tool === 'media' || binding.tool === 'gallery') {
      closeInlineEditor();
      await openMedia(binding, record);
      return;
    }
    closeInlineEditor();
    inspector.hidden = false;
    app.dataset.inspectorOpen = 'true';
    inspectorKicker.textContent = binding.scope === 'global' ? 'Общее для сайта' : binding.scope === 'shared' ? 'Общий источник' : 'Элемент страницы';
    inspectorTitle.textContent = binding.label || fieldLabel(binding.fieldPath);
    inspectorForm.replaceChildren();
    renderProvenance(binding);
    if (binding.tool === 'video') renderVideoInspector(record, binding);
    else if (binding.tool === 'reorder-item') renderReorderInspector(record, binding);
    else if (binding.tool === 'price') renderPriceInspector(record, binding);
    else if (binding.tool === 'list' || Array.isArray(value)) renderListInspector(record, binding);
    else if (binding.tool === 'link' && binding.hrefPath) {
      renderTextInspector(record, binding, value, { multiline: false });
      renderTextInspector(record, { ...binding, fieldPath: binding.hrefPath, label: 'Адрес ссылки' }, getAtPath(record.history.snapshot().value, binding.hrefPath), { multiline: false });
    } else renderTextInspector(record, binding, value, { multiline: binding.tool !== 'short-text' });
  }

  inlineInput.addEventListener('input', () => {
    const current = state.currentBinding;
    if (!current || inlineEditor.dataset.bindingId !== current.binding.bindingId) return;
    const gesture = state.inlineGesture;
    commitField(current.record, current.binding.fieldPath, inlineInput.value, '', { force: Boolean(gesture && !gesture.started) });
    if (gesture) gesture.started = true;
  });
  inlineInput.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!/[\r\n]/u.test(text)) return;
    event.preventDefault();
    const normalized = text.replace(/[\r\n]+/gu, ' ').replace(/\s+/gu, ' ');
    inlineInput.setRangeText(normalized, inlineInput.selectionStart || 0, inlineInput.selectionEnd || 0, 'end');
    inlineInput.dispatchEvent(new Event('input', { bubbles: true }));
    notifications.toast('Переносы строк заменены пробелами: это однострочное поле.', 'warning');
  });
  inlineEditor.addEventListener('submit', (event) => { event.preventDefault(); closeInlineEditor(); });
  inlineInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      const gesture = state.inlineGesture;
      while (gesture?.record?.history.snapshot().undoCount > gesture.undoCount) gesture.record.history.undo();
      closeInlineEditor();
    }
  });
  inlineInput.addEventListener('blur', () => window.setTimeout(() => {
    if (!inlineEditor.matches(':focus-within')) closeInlineEditor();
  }, 0));

  function reorderDescriptorList(binding) {
    const zoneId = binding.zoneId || binding.parentSlug || state.currentPage?.slug;
    const record = recordForBinding(binding);
    const items = clone(getAtPath(record?.history.snapshot().value, binding.fieldPath));
    if (record && Array.isArray(items) && items.every((item) => item && typeof item === 'object' && item.id)) {
      return orderedDirectionItems(items)
        .map(({ item }) => item)
        .filter((item) => item.isActive !== false)
        .map((item) => ({ kind: 'in-record', slug: String(item.id), stableItemId: String(item.id), item, record, fieldPath: binding.fieldPath }));
    }
    const kind = zoneId === 'project-archive' ? 'project' : zoneId === 'vacancies' ? 'job' : 'product';
    return state.pages.filter((page) => page.isActive && (kind === 'product'
      ? page.kind === 'product' && page.parentSlug === zoneId
      : page.kind === kind))
      .sort((left, right) => {
        const leftRecord = state.records.get(recordKey(left.collection, left.slug));
        const rightRecord = state.records.get(recordKey(right.collection, right.slug));
        const leftOrder = leftRecord?.history.snapshot().value.order ?? left.entry?.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = rightRecord?.history.snapshot().value.order ?? right.entry?.order ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || String(left.title || '').localeCompare(String(right.title || ''), 'ru');
      });
  }

  function projectCurrentReorderToFrame() {
    const bindings = state.bindingRows.map((row) => row.binding).filter((binding) => binding.tool === 'reorder-item');
    const zones = new Map(bindings.map((binding) => [binding.zoneId || binding.parentSlug, binding]));
    for (const [zoneId, binding] of zones) {
      if (!zoneId) continue;
      const descriptors = reorderDescriptorList(binding);
      if (descriptors.length < 2) continue;
      postToFrame('reorder-projection', { zoneId, orderedSlugs: descriptors.map((page) => page.stableItemId || page.slug) });
    }
  }

  async function applyEntityReorder(descriptors, fromIndex, toIndex, label, zoneId) {
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= descriptors.length || toIndex >= descriptors.length || fromIndex === toIndex) return;
    const next = descriptors.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const records = await Promise.all(next.map((page) => ensureRecord(page.collection, page.slug)));
    const before = records.map((record) => ({ record, value: record.history.snapshot().value.order }));
    records.forEach((record, index) => {
      const content = record.history.snapshot().value;
      record.history.commit({ ...content, order: (index + 1) * 10 }, { label, force: true });
    });
    const after = records.map((record) => ({ record, value: record.history.snapshot().value.order }));
    state.commandUndo.push({
      label,
      sequence: ++state.actionSequence,
      undo: () => before.forEach(({ record }) => record.history.undo()),
      redo: () => after.forEach(({ record }) => record.history.redo())
    });
    state.commandRedo = [];
    notifications.toast('Порядок изменён в браузерном черновике. Сохранение запишет все позиции одной транзакцией.', 'success');
    postToFrame('reorder-projection', { zoneId: zoneId || '', orderedSlugs: next.map((page) => page.slug) });
    updateChrome();
  }

  function applyInRecordReorder(descriptors, fromIndex, toIndex, label, zoneId) {
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= descriptors.length || toIndex >= descriptors.length || fromIndex === toIndex) return;
    const descriptor = descriptors[0];
    const record = descriptor?.record;
    if (!record) return;
    const current = clone(getAtPath(record.history.snapshot().value, descriptor.fieldPath) || []);
    const active = descriptors.map((item) => item.item);
    const nextActive = active.slice();
    const [moved] = nextActive.splice(fromIndex, 1);
    nextActive.splice(toIndex, 0, moved);
    let activeIndex = 0;
    const completeOrder = orderedDirectionItems(current).map(({ item }) => item.isActive === false
      ? String(item.id)
      : String(nextActive[activeIndex++]?.id || item.id));
    const next = renumberDirectionItems(current, completeOrder);
    const before = record.history.snapshot().value;
    const after = setAtPath(before, descriptor.fieldPath, next);
    record.history.commit(after, { label, force: true });
    state.commandUndo.push({
      label,
      sequence: ++state.actionSequence,
      undo: () => record.history.undo(),
      redo: () => record.history.redo()
    });
    state.commandRedo = [];
    postToFrame('reorder-projection', { zoneId, orderedSlugs: nextActive.map((item) => String(item.id)) });
    notifications.toast('Порядок изменён в браузерном черновике. Сохранение запишет список одной транзакцией.', 'success');
    updateChrome();
  }

  async function applyReorder(descriptors, fromIndex, toIndex, label, zoneId) {
    if (descriptors[0]?.kind === 'in-record') return applyInRecordReorder(descriptors, fromIndex, toIndex, label, zoneId);
    return applyEntityReorder(descriptors, fromIndex, toIndex, label, zoneId);
  }

  async function reorderBoundItems(source, target) {
    if (source.zoneId !== target.zoneId) {
      notifications.toast('Перемещение возможно только внутри этого списка. Для переноса между категориями используйте настройки товара.', 'warning');
      return;
    }
    const descriptors = reorderDescriptorList(source);
    await applyReorder(
      descriptors,
      descriptors.findIndex((page) => (page.stableItemId || page.slug) === (source.stableItemId || source.recordSlug)),
      descriptors.findIndex((page) => (page.stableItemId || page.slug) === (target.stableItemId || target.recordSlug)),
      `Изменить порядок: ${state.currentPage?.title || source.zoneId}`,
      source.zoneId
    );
  }

  async function keyboardReorder(binding, key) {
    const descriptors = reorderDescriptorList(binding);
    const index = descriptors.findIndex((page) => (page.stableItemId || page.slug) === (binding.stableItemId || binding.recordSlug));
    const target = key === 'Home' ? 0 : key === 'End' ? descriptors.length - 1 : key === 'ArrowUp' ? index - 1 : index + 1;
    await applyReorder(descriptors, index, target, `Изменить порядок: ${state.currentPage?.title || binding.zoneId}`, binding.zoneId);
    if (target >= 0 && target < descriptors.length) notifications.announce(`Элемент перемещён на позицию ${target + 1}.`);
  }

  function renderChanges() {
    const rows = dirtyRecords().flatMap((record) => diffLeaves(record.loadedContent, record.history.snapshot().value)
      .map((change) => ({ ...change, record })));
    changesCount.textContent = String(rows.length);
    const fragment = document.createDocumentFragment();
    rows.slice(0, 120).forEach((change) => {
      const item = document.createElement('article');
      item.className = 've-change';
      item.innerHTML = `<div class="ve-change__where">${escapeHtml(change.record.history.snapshot().value.title || change.record.slug)}<br><small>${escapeHtml(fieldLabel(change.path))}</small></div><div class="ve-change__values"><span title="${escapeHtml(displayValue(change.before))}">${escapeHtml(displayValue(change.before))}</span><b>→</b><span title="${escapeHtml(displayValue(change.after))}">${escapeHtml(displayValue(change.after))}</span></div>`;
      const revert = document.createElement('button');
      revert.type = 'button';
      revert.textContent = '↶';
      revert.title = 'Отменить только эту правку';
      revert.addEventListener('click', () => {
        const current = change.record.history.snapshot().value;
        change.record.history.commit(setAtPath(current, change.path, change.before), { label: `Отменить: ${fieldLabel(change.path)}`, force: true });
      });
      item.append(revert);
      fragment.append(item);
    });
    if (rows.length > 120) {
      const note = document.createElement('p');
      note.style.cssText = 'margin:0;padding:12px;color:#65726c;font-size:10px';
      note.textContent = `Показаны первые 120 из ${rows.length} изменений.`;
      fragment.append(note);
    }
    changesBody.replaceChildren(fragment);
  }

  async function saveAll() {
    const candidates = dirtyRecords();
    if (candidates.some((record) => record.reconciliationPending)) {
      notifications.toast('Предыдущая запись уже выполнена, но редактор ещё не сверил новую revision. Перезапустите редактор; браузерный черновик следующих правок сохранён.', 'warning', 0);
      return;
    }
    const blockedLegal = candidates.filter((record) => getAtPath(record.history.snapshot().value, 'privacyPolicy')
      && !String(getAtPath(record.history.snapshot().value, 'privacyPolicy.confirmedAgainstGlobalAt') || '').trim());
    const records = candidates.filter((record) => !blockedLegal.includes(record));
    if (blockedLegal.length) {
      notifications.toast(records.length
        ? 'Обычные правки будут сохранены отдельно. Юридический документ останется в черновике, пока вы явно не подтвердите его реквизиты в настройках страницы.'
        : 'Юридический документ изменён. Перед сохранением подтвердите реквизиты в настройках этой страницы; черновик не потерян.', 'warning', 0);
    }
    if (!records.length || saveButton.dataset.busy === 'true') return;
    saveButton.dataset.busy = 'true';
    saveButton.disabled = true;
    saveButton.textContent = 'Сохраняем…';
    const started = performance.now();
    let committed = false;
    try {
      const savedContents = new Map(records.map((record) => [record, clone(record.history.snapshot().value)]));
      const mediaOperations = records.flatMap((record) => {
        const referenced = JSON.stringify(savedContents.get(record));
        return (record.stagedMedia || []).filter((lease) => lease?.canonicalPath && referenced.includes(lease.canonicalPath)).map((lease) => ({
        type: 'promote-staged-media',
        stagedId: lease.stagedId,
        batchId: lease.batchId,
        leaseId: lease.leaseId,
        baseRevision: lease.baseRevision,
        destinationBaseRevision: lease.destinationBaseRevision
      }));
      });
      const recordOperations = records.map((record) => record.collection === 'navigation'
        ? { type: 'upsert-singleton', singleton: 'navigation', value: savedContents.get(record).items || [], baseRevision: record.revision }
        : {
            type: 'upsert-record',
            collection: record.collection,
            slug: record.slug,
            content: savedContents.get(record),
            baseRevision: record.revision
          });
      const idempotencyKey = crypto.randomUUID();
      const preview = await api.transactionPreview([...mediaOperations, ...recordOperations], {
        idempotencyKey,
        userSummary: records.length === 1
          ? `Изменить страницу: ${records[0].history.snapshot().value.title || records[0].slug}`
          : `Изменить ${records.length} связанных материалов`
      });
      const blockers = [...(preview.blockers || []), ...(preview.relationImpact?.blockers || [])];
      if (blockers.length) throw new AdminApiError(blockers[0].userMessage || blockers[0].message || 'Сохранение заблокировано проверкой данных.', { code: blockers[0].code || 'SAVE_BLOCKED', payload: preview });
      const applied = await api.transactionApply({ transactionId: preview.transactionId, idempotencyKey: preview.idempotencyKey || idempotencyKey, payloadHash: preview.payloadHash });
      committed = true;
      state.lastTransactionIds = [preview.transactionId];
      const freshResults = await Promise.allSettled(records.map((record) => readEditorRecord(record)));
      const reconciliationFailures = [];
      for (const [index, record] of records.entries()) {
        const savedContent = savedContents.get(record);
        const currentContent = record.history.snapshot().value;
        const oldSlug = record.slug;
        const result = freshResults[index];
        const fresh = result.status === 'fulfilled' ? result.value : null;
        const committedContent = fresh?.content || savedContent;
        if (fresh) {
          record.slug = fresh.content?.slug || record.slug;
          record.revision = fresh.revision;
          record.schemaVersion = fresh.schemaVersion;
          record.reconciliationPending = false;
        } else {
          record.reconciliationPending = true;
          reconciliationFailures.push(record);
        }
        record.loadedContent = clone(committedContent);
        const referencedAtSave = JSON.stringify(savedContent);
        record.stagedMedia = (record.stagedMedia || []).filter((lease) => !lease?.canonicalPath || !referencedAtSave.includes(lease.canonicalPath));
        if (deepEqual(currentContent, savedContent)) record.history.markBoundary(committedContent);
        else record.history.setBoundary(committedContent);
        if (oldSlug !== record.slug) {
          state.records.delete(recordKey(record.collection, oldSlug));
          state.records.set(recordKey(record.collection, record.slug), record);
          await draftStore.delete({ repoIdentity: REPO_IDENTITY, collection: record.collection, slug: oldSlug }).catch(() => {});
          state.draftKeys.delete(recordKey(record.collection, oldSlug));
        }
        if (!record.history.snapshot().dirty) {
          await draftStore.delete({ repoIdentity: REPO_IDENTITY, collection: record.collection, slug: record.slug }).catch(() => {});
          state.draftKeys.delete(recordKey(record.collection, record.slug));
        } else persistRecordDraft(record);
      }
      state.lastSaveLatencyMs = Math.round(performance.now() - started);
      localStorage.setItem(storageKey('last-save-evidence'), JSON.stringify({ latencyMs: state.lastSaveLatencyMs, at: new Date().toISOString(), records: records.length, transactionId: preview.transactionId }));
      channel?.postMessage({ type: 'saved', tabId, records: records.map((record) => ({ collection: record.collection, slug: record.slug, revision: record.revision })) });
      setHumanStatus('saved');
      notifications.toast(`Сохранено на компьютере за ${(state.lastSaveLatencyMs / 1000).toFixed(2)} с. Тестовый сайт не обновлялся.`, 'success');
      if (reconciliationFailures.length) {
        notifications.toast('Изменения уже сохранены на компьютере, но редактор не смог перечитать новую редакцию. Не нажимайте Save повторно: перезапустите редактор, черновик следующих правок сохранён.', 'warning', 0);
      } else {
        try { await loadSummaries(); }
        catch (error) { notifications.toast(`Сохранено, но список страниц пока не обновился: ${error.message}. Можно продолжить после перезапуска.`, 'warning', 0); }
      }
      renderChanges();
      void watchBackupAfterSave(preview.transactionId);
      void requestExactValidation({ transactionId: preview.transactionId, applied });
    } catch (error) {
      if (committed) {
        notifications.toast('Изменения уже сохранены на компьютере. Не повторяйте Save: обновите редактор для сверки состояния.', 'warning', 0);
        updateChrome();
        return;
      }
      const conflict = /(REVISION|STALE|CONFLICT)/u.test(String(error.code || '')) || error.status === 409;
      if (conflict) await showConflict(error, records);
      else notifications.toast(error.validationIssues?.[0]?.userMessage || error.message || 'Сохранение не выполнено. Черновик остаётся в браузере.', 'error', 0);
      updateChrome();
    } finally {
      saveButton.dataset.busy = 'false';
      saveButton.textContent = 'Сохранить';
      updateChrome();
    }
  }

  async function requestExactValidation({ transactionId }) {
    setHumanStatus('checking');
    state.exact = { status: 'queued', transactionId };
    renderPublish();
    try {
      const response = await api.request('/validation/request', {
        method: 'POST',
        body: JSON.stringify({ transactionId })
      });
      state.exact = response;
      pollExactValidation(1200, response.runId, response.transactionId);
    } catch (error) {
      state.exact = { status: 'failed', transactionId, message: error.code === 'ADMIN_API_ERROR' && error.status === 404
        ? 'Фоновая exact-проверка недоступна.'
        : error.message };
      setHumanStatus('failed');
      notifications.toast('Изменения сохранены на компьютере, но проверка сайта не прошла. Тестовая публикация заблокирована.', 'warning', 0);
      renderPublish();
    }
  }

  function pollExactValidation(delay = 1200, expectedRunId = state.exact?.runId, expectedTransactionId = state.exact?.transactionId) {
    const runId = expectedRunId;
    if (!runId) return;
    window.setTimeout(async () => {
      if (state.exact?.runId !== runId || state.exact?.transactionId !== expectedTransactionId) return;
      try {
        const result = await api.request(`/validation/runs/${encodeURIComponent(runId)}`);
        if (state.exact?.runId !== runId || state.exact?.transactionId !== expectedTransactionId) return;
        state.exact = result;
        if (['queued', 'running'].includes(result.status)) {
          setHumanStatus('checking');
          renderPublish();
          pollExactValidation(Math.min(5000, Math.round(delay * 1.35)), runId, expectedTransactionId);
        } else if (result.status === 'passed') {
          setHumanStatus('ready');
          notifications.toast('Точная проверка сохранённой версии завершена. Версия готова к тестовой публикации.', 'success');
          renderPublish();
        } else {
          setHumanStatus('failed');
          notifications.toast('Изменения сохранены на компьютере, но проверка сайта не прошла. Тестовая публикация заблокирована.', 'warning', 0);
          renderPublish();
        }
      } catch (error) {
        if (state.exact?.runId !== runId || state.exact?.transactionId !== expectedTransactionId) return;
        state.exact = { ...state.exact, status: 'failed', message: error.message };
        setHumanStatus('failed');
        renderPublish();
      }
    }, delay);
  }

  async function refreshBackupState({ includeList = false } = {}) {
    try {
      state.backupStatus = await api.backupStatus();
      if (includeList && state.backupStatus?.configured !== false) {
        state.backups = (await api.backups()).backups || [];
        state.backupsLoaded = true;
      }
    } catch (error) {
      state.backupStatus = {
        configured: false,
        pending: 0,
        lastError: { code: error.code || 'BACKUP_STATUS_FAILED', message: error.message }
      };
    }
    setHumanStatus(state.status);
    return state.backupStatus;
  }

  async function watchBackupAfterSave(transactionId, attempt = 0) {
    const report = await refreshBackupState();
    const matchingSuccess = report?.lastSuccess?.transactionId === transactionId;
    const matchingFailure = report?.lastAttempt?.transactionId === transactionId && report?.lastAttempt?.status === 'failed';
    if (matchingSuccess) {
      notifications.announce('Резервная копия сохранённой редакции создана.');
      if (publishDrawer.open) void renderPublish();
      return;
    }
    if (matchingFailure) {
      notifications.toast('Сохранено на компьютере · резервная копия не создана. Откройте «Публикация», чтобы увидеть причину и повторить экспорт.', 'warning', 0);
      if (publishDrawer.open) void renderPublish();
      return;
    }
    if ((report?.pending || 0) > 0 && attempt < 20) {
      window.setTimeout(() => void watchBackupAfterSave(transactionId, attempt + 1), Math.min(5000, 900 + attempt * 300));
    }
  }

  function showRecoveryConflict(record) {
    const recovery = record?.recoveryConflict;
    if (!recovery) return;
    const mine = recovery.content;
    const theirs = record.loadedContent;
    conflictBody.innerHTML = `<p>После прошлого сеанса на компьютере остался черновик, но сохранённая редакция уже изменилась. Ничего не объединено автоматически: выберите целую версию осознанно или сначала скачайте черновик.</p>
      <details class="ve-technical" open><summary>${escapeHtml(mine?.title || record.slug)} · ${escapeHtml(record.collection)}</summary><div class="ve-drawer-grid ve-drawer-grid--two"><section><h3>Черновик из браузера</h3><pre>${escapeHtml(JSON.stringify(mine, null, 2))}</pre></section><section><h3>Сохранённая версия</h3><pre>${escapeHtml(JSON.stringify(theirs, null, 2))}</pre></section></div><details class="ve-technical"><summary>Версия, от которой начинался черновик</summary><p>Редакция: ${escapeHtml(recovery.baseRevision || 'неизвестна')}</p></details></details>
      <div class="ve-publish-step__actions"><button type="button" class="ve-button" data-export-recovery>Скачать мой черновик</button><button type="button" class="ve-button" data-use-recovery>Продолжить с моим вариантом</button><button type="button" class="ve-button ve-button--primary" data-discard-recovery>Оставить сохранённую версию</button></div>`;
    conflictBody.querySelector('[data-export-recovery]')?.addEventListener('click', () => downloadJson(`smu1-recovery-${record.slug}.json`, {
      createdAt: new Date().toISOString(), collection: record.collection, slug: record.slug,
      baseRevision: recovery.baseRevision, mine, theirs
    }));
    conflictBody.querySelector('[data-use-recovery]')?.addEventListener('click', () => {
      if (!window.confirm('Использовать весь браузерный черновик поверх текущей сохранённой версии? Массивы и порядок не объединяются автоматически.')) return;
      record.history.commit(mine, { label: 'Выбран восстановленный черновик целиком', force: true });
      record.stagedMedia = recovery.stagedMedia || [];
      record.recoveryConflict = null;
      state.remoteConflicts.delete(recordKey(record.collection, record.slug));
      conflictDialog.close();
      notifications.toast('Черновик выбран явно. Проверьте страницу и нажмите «Сохранить»; сохранённая версия пока не перезаписана.', 'warning', 0);
    });
    conflictBody.querySelector('[data-discard-recovery]')?.addEventListener('click', async () => {
      if (!window.confirm('Удалить старый браузерный черновик и оставить сохранённую версию? Перед этим можно скачать JSON.')) return;
      await draftStore.delete({ repoIdentity: REPO_IDENTITY, collection: record.collection, slug: record.slug });
      record.recoveryConflict = null;
      record.stagedMedia = [];
      state.remoteConflicts.delete(recordKey(record.collection, record.slug));
      state.draftKeys.delete(recordKey(record.collection, record.slug));
      conflictDialog.close();
      renderNavigator();
      updateChrome();
    });
    restoreFocusDialog(conflictDialog, pagePickerTitle);
  }

  async function showConflict(error, records) {
    const conflicts = await Promise.all(records.map(async (record, index) => {
      let fresh = null;
      try { fresh = await readEditorRecord(record); }
      catch { /* export still works while the canonical record is unavailable */ }
      if (index === 0 && !fresh?.content && error.payload?.current?.content) {
        fresh = { content: error.payload.current.content, revision: error.payload.current.revision, schemaVersion: record.schemaVersion };
      }
      return { record, mine: record.history.snapshot().value, base: record.loadedContent, fresh };
    }));
    conflictBody.innerHTML = `<p>Ваш черновик не перезаписал более новую версию. Сравните три состояния или сохраните свой черновик отдельным JSON.</p>
      ${conflicts.map(({ record, mine, base, fresh }) => `<details class="ve-technical" open><summary>${escapeHtml(mine?.title || record.slug)} · ${escapeHtml(record.collection)}</summary><div class="ve-drawer-grid ve-drawer-grid--two"><section><h3>Ваш вариант</h3><pre>${escapeHtml(JSON.stringify(mine, null, 2))}</pre></section><section><h3>Текущая версия</h3><pre>${escapeHtml(JSON.stringify(fresh?.content || { unavailable: true }, null, 2))}</pre></section></div><details class="ve-technical"><summary>Базовая версия</summary><pre>${escapeHtml(JSON.stringify(base, null, 2))}</pre></details></details>`).join('')}
      <div class="ve-publish-step__actions"><button type="button" class="ve-button" data-export-mine>Скачать все мои черновики</button><button type="button" class="ve-button ve-button--primary" data-reload-theirs>Отказаться от моих правок и открыть актуальную версию</button></div>`;
    conflictBody.querySelector('[data-export-mine]')?.addEventListener('click', () => downloadJson('smu1-conflicting-drafts.json', {
      createdAt: new Date().toISOString(), conflicts: conflicts.map(({ record, mine, base, fresh }) => ({ collection: record.collection, slug: record.slug, base, mine, theirs: fresh?.content || null, currentRevision: fresh?.revision || null }))
    }));
    conflictBody.querySelector('[data-reload-theirs]')?.addEventListener('click', async () => {
      if (!window.confirm('Отказаться от всех перечисленных несохранённых правок? Перед этим можно скачать их JSON.')) return;
      for (const { record, fresh } of conflicts) {
        if (!fresh?.content) continue;
        record.revision = fresh.revision;
        record.schemaVersion = fresh.schemaVersion || record.schemaVersion;
        record.loadedContent = clone(fresh.content);
        record.stagedMedia = [];
        record.history.markBoundary(fresh.content);
        state.remoteConflicts.delete(recordKey(record.collection, record.slug));
        await draftStore.delete({ repoIdentity: REPO_IDENTITY, collection: record.collection, slug: record.slug });
      }
      conflictDialog.close();
      updateChrome();
      projectDraftToFrame();
    });
    restoreFocusDialog(conflictDialog, saveButton);
  }

  function downloadJson(filename, value) {
    const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function settingsRecord() { return state.settingsRecordOverride || currentRecord(); }

  function fieldControl(record, path, label, options = {}) {
    const wrapper = document.createElement('label');
    wrapper.className = 've-field';
    const title = document.createElement('span');
    title.textContent = label;
    let control;
    if (options.type === 'select') {
      control = document.createElement('select');
      for (const option of options.options || []) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        control.append(node);
      }
    } else if (options.type === 'textarea') {
      control = document.createElement('textarea');
    } else {
      control = document.createElement('input');
      control.type = options.type || 'text';
      if (options.min !== undefined) control.min = String(options.min);
      if (options.max !== undefined) control.max = String(options.max);
      if (options.step !== undefined) control.step = String(options.step);
    }
    const value = getAtPath(record.history.snapshot().value, path);
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = value ?? '';
    control.disabled = Boolean(options.disabled);
    const eventName = control.type === 'checkbox' || control.tagName === 'SELECT' ? 'change' : 'input';
    control.addEventListener(eventName, () => {
      const next = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value;
      commitField(record, path, next);
    });
    wrapper.append(title, control);
    if (options.hint) {
      const hint = document.createElement('p');
      hint.className = 've-field-hint';
      hint.textContent = options.hint;
      wrapper.append(hint);
    }
    return wrapper;
  }

  function structuralSelect(record, path, label, options, warning) {
    const wrapper = document.createElement('label');
    wrapper.className = 've-field';
    const title = document.createElement('span');
    title.textContent = label;
    const select = document.createElement('select');
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      select.append(node);
    }
    select.value = String(getAtPath(record.history.snapshot().value, path) || '');
    select.addEventListener('change', () => {
      const previous = String(getAtPath(record.history.snapshot().value, path) || '');
      if (!window.confirm(warning)) {
        select.value = previous;
        return;
      }
      const next = setAtPath(record.history.snapshot().value, path, select.value);
      record.history.commit(next, { label: `Структурное изменение: ${label}`, force: true });
      notifications.toast('Структурное изменение осталось в черновике. Перед записью сервер проверит ссылки и затронутые маршруты.', 'warning', 0);
    });
    const hint = document.createElement('p');
    hint.className = 've-field-hint';
    hint.textContent = 'Это структурная операция: перед локальной записью выполняется relation/route pre-apply gate.';
    wrapper.append(title, select, hint);
    return wrapper;
  }

  function relationChooser(record, path, label, candidates) {
    const section = document.createElement('fieldset');
    section.className = 've-relation-chooser';
    const legend = document.createElement('legend');
    legend.textContent = label;
    const list = document.createElement('div');
    const render = () => {
      const current = [...(getAtPath(record.history.snapshot().value, path) || [])];
      list.replaceChildren();
      current.forEach((slug, index) => {
        const candidate = candidates.find((item) => item.slug === slug);
        const row = document.createElement('div');
        row.className = 've-relation-row';
        const copy = document.createElement('span');
        copy.textContent = candidate?.title || slug;
        const move = (target) => {
          if (target < 0 || target >= current.length) return;
          const next = current.slice();
          const [item] = next.splice(index, 1);
          next.splice(target, 0, item);
          commitField(record, path, next, `Изменить порядок: ${label}`);
          render();
        };
        for (const [text, action, aria] of [['↑', () => move(index - 1), 'Выше'], ['↓', () => move(index + 1), 'Ниже'], ['×', () => { commitField(record, path, current.filter((item) => item !== slug), `Удалить связь: ${label}`); render(); }, 'Убрать']]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = text;
          button.title = aria;
          button.setAttribute('aria-label', `${aria}: ${candidate?.title || slug}`);
          button.addEventListener('click', action);
          row.append(index === 0 && text === '↑' ? copy : document.createTextNode(''), button);
        }
        if (!row.contains(copy)) row.prepend(copy);
        list.append(row);
      });
      const addRow = document.createElement('div');
      addRow.className = 've-relation-add';
      const select = document.createElement('select');
      const available = candidates.filter((item) => !current.includes(item.slug));
      select.innerHTML = '<option value="">Выберите материал…</option>';
      available.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.slug;
        option.textContent = item.title;
        select.append(option);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 've-button';
      add.textContent = 'Добавить';
      add.disabled = available.length === 0;
      add.addEventListener('click', () => {
        if (!select.value) return;
        commitField(record, path, [...current, select.value], `Добавить связь: ${label}`);
        render();
      });
      addRow.append(select, add);
      list.append(addRow);
    };
    render();
    section.append(legend, list);
    return section;
  }

  function directionMoveActions(record, path, item, items, render, label) {
    const actions = document.createElement('div');
    actions.className = 've-direction-order-actions';
    const ordered = orderedDirectionItems(items).map((row) => row.item);
    const index = ordered.findIndex((entry) => String(entry.id) === String(item.id));
    const definitions = [
      ['⇤', 'start', 'В начало', index === 0],
      ['↑', -1, 'Выше', index === 0],
      ['↓', 1, 'Ниже', index === ordered.length - 1],
      ['⇥', 'end', 'В конец', index === ordered.length - 1]
    ];
    for (const [text, destination, title, disabled] of definitions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.title = title;
      button.disabled = disabled;
      button.setAttribute('aria-label', `${title}: ${item.label || item.eyebrow || item.id}`);
      button.addEventListener('click', () => {
        const current = clone(getAtPath(record.history.snapshot().value, path) || []);
        commitField(record, path, moveDirectionItem(current, item.id, destination), label, { force: true });
        notifications.announce(`${item.label || item.eyebrow || item.id}: ${String(title).toLocaleLowerCase('ru-RU')}.`);
        render();
      });
      actions.append(button);
    }
    return actions;
  }

  function directionSectionNavEditor(record) {
    const path = 'directionPresentation.sectionNav.items';
    const section = document.createElement('fieldset');
    section.className = 've-relation-chooser ve-direction-structure-editor';
    const legend = document.createElement('legend');
    legend.textContent = 'Навигация по странице: подписи и порядок';
    const hint = document.createElement('p');
    hint.className = 've-field-hint';
    hint.textContent = 'Якоря определяет production-шаблон. Здесь можно менять подписи, видимость и порядок; новые технические якоря не создаются.';
    const list = document.createElement('div');
    const render = () => {
      const current = clone(getAtPath(record.history.snapshot().value, path) || []);
      list.replaceChildren();
      orderedDirectionItems(current).forEach(({ item }) => {
        const row = document.createElement('article');
        row.className = 've-direction-structure-row';
        row.dataset.itemId = item.id;
        const label = document.createElement('label');
        label.className = 've-field';
        const labelTitle = document.createElement('span');
        labelTitle.textContent = `Подпись · #${item.id}`;
        const input = document.createElement('input');
        input.value = item.label;
        input.maxLength = 120;
        input.setAttribute('aria-label', `Подпись пункта ${item.id}`);
        input.addEventListener('input', () => {
          const latest = clone(getAtPath(record.history.snapshot().value, path) || []);
          commitField(record, path, updateDirectionItem(latest, item.id, { label: input.value }), 'Изменить подпись навигации');
        });
        label.append(labelTitle, input);
        const footer = document.createElement('div');
        footer.className = 've-direction-structure-footer';
        const visible = document.createElement('label');
        visible.className = 've-direction-visible';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.isActive !== false;
        checkbox.addEventListener('change', () => {
          const latest = clone(getAtPath(record.history.snapshot().value, path) || []);
          commitField(record, path, updateDirectionItem(latest, item.id, { isActive: checkbox.checked }), 'Изменить видимость пункта навигации', { force: true });
          render();
        });
        visible.append(checkbox, document.createTextNode(' Показывать'));
        footer.append(visible, directionMoveActions(record, path, item, current, render, 'Изменить порядок навигации по странице'));
        row.append(label, footer);
        list.append(row);
      });
    };
    render();
    section.append(legend, hint, list);
    return section;
  }

  function directionRelatedChooser(record, candidates) {
    const path = 'directionPresentation.related.items';
    const section = document.createElement('fieldset');
    section.className = 've-relation-chooser ve-direction-structure-editor';
    const legend = document.createElement('legend');
    legend.textContent = 'Связанные страницы и порядок';
    const hint = document.createElement('p');
    hint.className = 've-field-hint';
    hint.textContent = 'Адрес вычисляется из выбранной страницы. Пустые название и описание наследуются из неё; локальные подписи можно менять прямо на canvas.';
    const list = document.createElement('div');
    const render = () => {
      const current = clone(getAtPath(record.history.snapshot().value, path) || []);
      const candidateByKey = new Map(candidates.map((candidate) => [directionTargetKey(candidate.collection, candidate.slug), candidate]));
      list.replaceChildren();
      orderedDirectionItems(current).forEach(({ item }) => {
        const candidate = candidateByKey.get(directionTargetKey(item.targetCollection, item.targetSlug));
        const row = document.createElement('article');
        row.className = 've-direction-structure-row';
        row.dataset.itemId = item.id;
        const heading = document.createElement('div');
        heading.className = 've-direction-structure-heading';
        const copy = document.createElement('span');
        copy.innerHTML = `<strong>${escapeHtml(candidate?.title || item.targetSlug)}</strong><small>${escapeHtml(candidate?.typeLabel || item.targetCollection)} · ${escapeHtml(item.targetSlug)}</small>`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 've-button';
        remove.textContent = 'Убрать';
        remove.setAttribute('aria-label', `Убрать связь: ${candidate?.title || item.targetSlug}`);
        remove.addEventListener('click', () => {
          const latest = clone(getAtPath(record.history.snapshot().value, path) || []);
          commitField(record, path, removeDirectionRelation(latest, item.id), 'Убрать связанную страницу', { force: true });
          render();
        });
        heading.append(copy, remove);

        const labels = document.createElement('details');
        labels.className = 've-direction-copy-details';
        const summary = document.createElement('summary');
        summary.textContent = 'Локальные подписи карточки';
        const eyebrow = document.createElement('label');
        eyebrow.className = 've-field';
        eyebrow.innerHTML = '<span>Надпись</span>';
        const eyebrowInput = document.createElement('input');
        eyebrowInput.value = item.eyebrow || '';
        eyebrowInput.addEventListener('input', () => {
          const latest = clone(getAtPath(record.history.snapshot().value, path) || []);
          commitField(record, path, updateDirectionItem(latest, item.id, { eyebrow: eyebrowInput.value }), 'Изменить подпись связанной страницы');
        });
        eyebrow.append(eyebrowInput);
        const title = document.createElement('label');
        title.className = 've-field';
        title.innerHTML = '<span>Своё название (необязательно)</span>';
        const titleInput = document.createElement('input');
        titleInput.value = item.title || '';
        titleInput.placeholder = candidate?.title || 'Наследовать название страницы';
        titleInput.addEventListener('input', () => {
          const latest = clone(getAtPath(record.history.snapshot().value, path) || []);
          const patch = { title: titleInput.value || undefined };
          commitField(record, path, updateDirectionItem(latest, item.id, patch), 'Изменить локальное название связи');
        });
        title.append(titleInput);
        const description = document.createElement('label');
        description.className = 've-field';
        description.innerHTML = '<span>Своё описание (необязательно)</span>';
        const descriptionInput = document.createElement('textarea');
        descriptionInput.rows = 3;
        descriptionInput.value = item.description || '';
        descriptionInput.placeholder = 'Наследовать краткое описание страницы';
        descriptionInput.addEventListener('input', () => {
          const latest = clone(getAtPath(record.history.snapshot().value, path) || []);
          const patch = { description: descriptionInput.value || undefined };
          commitField(record, path, updateDirectionItem(latest, item.id, patch), 'Изменить локальное описание связи');
        });
        description.append(descriptionInput);
        labels.append(summary, eyebrow, title, description);

        const footer = document.createElement('div');
        footer.className = 've-direction-structure-footer';
        const visible = document.createElement('label');
        visible.className = 've-direction-visible';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.isActive !== false;
        checkbox.addEventListener('change', () => {
          const latest = clone(getAtPath(record.history.snapshot().value, path) || []);
          commitField(record, path, updateDirectionItem(latest, item.id, { isActive: checkbox.checked }), 'Изменить видимость связанной страницы', { force: true });
          render();
        });
        visible.append(checkbox, document.createTextNode(' Показывать'));
        footer.append(visible, directionMoveActions(record, path, item, current, render, 'Изменить порядок связанных страниц'));
        row.append(heading, labels, footer);
        list.append(row);
      });

      const used = new Set(current.map((item) => directionTargetKey(item.targetCollection, item.targetSlug)));
      const available = candidates.filter((candidate) => !used.has(directionTargetKey(candidate.collection, candidate.slug)));
      const addRow = document.createElement('div');
      addRow.className = 've-relation-add';
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Добавить связанную страницу');
      select.innerHTML = '<option value="">Выберите страницу…</option>';
      available.forEach((candidate) => {
        const option = document.createElement('option');
        option.value = directionTargetKey(candidate.collection, candidate.slug);
        option.textContent = `${candidate.title} · ${candidate.typeLabel}`;
        select.append(option);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 've-button';
      add.textContent = 'Добавить';
      add.disabled = available.length === 0;
      add.addEventListener('click', () => {
        const candidate = available.find((entry) => directionTargetKey(entry.collection, entry.slug) === select.value);
        if (!candidate) return;
        const latest = clone(getAtPath(record.history.snapshot().value, path) || []);
        const next = addDirectionRelation(latest, {
          targetCollection: candidate.collection,
          targetSlug: candidate.slug
        }, { eyebrow: candidate.typeLabel || 'Связанное направление' });
        commitField(record, path, next, 'Добавить связанную страницу', { force: true });
        render();
      });
      addRow.append(select, add);
      list.append(addRow);
    };
    render();
    section.append(legend, hint, list);
    return section;
  }

  function focalPositionControl(record, path, label) {
    const section = document.createElement('fieldset');
    section.className = 've-relation-chooser';
    const legend = document.createElement('legend');
    legend.textContent = label;
    const match = /^(\d{1,3})%\s+(\d{1,3})%$/u.exec(String(getAtPath(record.history.snapshot().value, path) || '50% 50%'));
    let x = Math.min(100, Number(match?.[1] || 50));
    let y = Math.min(100, Number(match?.[2] || 50));
    const make = (axis, value, onInput) => {
      const wrapper = document.createElement('label');
      wrapper.className = 've-field';
      const title = document.createElement('span');
      title.textContent = axis;
      const input = document.createElement('input');
      input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1'; input.value = String(value);
      const output = document.createElement('output'); output.textContent = `${value}%`;
      input.addEventListener('input', () => { output.textContent = `${input.value}%`; onInput(Number(input.value)); });
      wrapper.append(title, input, output);
      return wrapper;
    };
    const commit = () => commitField(record, path, `${x}% ${y}%`, `Изменить точку фокуса: ${label}`);
    section.append(legend,
      make('По горизонтали', x, (value) => { x = value; commit(); }),
      make('По вертикали', y, (value) => { y = value; commit(); })
    );
    return section;
  }

  function projectDirectionChooser(record, candidates) {
    const section = document.createElement('fieldset');
    section.className = 've-relation-chooser';
    const legend = document.createElement('legend');
    legend.textContent = 'Связанные направления и порядок';
    const list = document.createElement('div');
    const path = 'presentation.relatedDirections';
    const render = () => {
      const current = clone(getAtPath(record.history.snapshot().value, path) || []);
      list.replaceChildren();
      current.forEach((relation, index) => {
        const row = document.createElement('div');
        row.className = 've-relation-row';
        const copy = document.createElement('span');
        copy.textContent = relation.label || relation.href;
        const move = (target) => {
          if (target < 0 || target >= current.length) return;
          const next = current.slice();
          const [item] = next.splice(index, 1); next.splice(target, 0, item);
          commitField(record, path, next.map((entry, order) => ({ ...entry, order: (order + 1) * 10 })), 'Изменить порядок связанных направлений');
          render();
        };
        const actions = [
          ['↑', () => move(index - 1), 'Выше'],
          ['↓', () => move(index + 1), 'Ниже'],
          ['×', () => { commitField(record, path, current.filter((_, itemIndex) => itemIndex !== index).map((entry, order) => ({ ...entry, order: (order + 1) * 10 })), 'Убрать связанное направление'); render(); }, 'Убрать']
        ];
        row.append(copy);
        for (const [text, action, aria] of actions) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.title = aria;
          button.setAttribute('aria-label', `${aria}: ${relation.label || relation.href}`); button.addEventListener('click', action); row.append(button);
        }
        list.append(row);
      });
      const addRow = document.createElement('div'); addRow.className = 've-relation-add';
      const select = document.createElement('select'); select.innerHTML = '<option value="">Выберите направление…</option>';
      const used = new Set(current.map((item) => normalizeRoute(item.href)));
      const available = candidates.filter((item) => !used.has(normalizeRoute(item.route)));
      available.forEach((item) => { const option = document.createElement('option'); option.value = item.route; option.textContent = item.title; select.append(option); });
      const add = document.createElement('button'); add.type = 'button'; add.className = 've-button'; add.textContent = 'Добавить'; add.disabled = available.length === 0;
      add.addEventListener('click', () => {
        const candidate = available.find((item) => item.route === select.value); if (!candidate) return;
        const relation = { id: `direction-${candidate.slug || candidate.route.replace(/\W+/gu, '-')}`, label: candidate.title, href: candidate.route, context: 'Связанное направление', order: (current.length + 1) * 10 };
        commitField(record, path, [...current, relation], 'Добавить связанное направление'); render();
      });
      addRow.append(select, add); list.append(addRow);
    };
    render(); section.append(legend, list); return section;
  }

  function navigationEditor(record) {
    const section = document.createElement('fieldset');
    section.className = 've-relation-chooser';
    const legend = document.createElement('legend'); legend.textContent = 'Главное меню: подписи и порядок';
    const list = document.createElement('div');
    const render = () => {
      const items = clone(record.history.snapshot().value.items || []);
      list.replaceChildren();
      items.forEach((item, index) => {
        const row = document.createElement('div'); row.className = 've-relation-row ve-relation-row--navigation';
        const title = document.createElement('input'); title.value = item.title || ''; title.setAttribute('aria-label', `Подпись пункта ${index + 1}`);
        title.addEventListener('input', () => { const next = clone(record.history.snapshot().value.items || []); next[index] = { ...next[index], title: title.value }; commitField(record, 'items', next, 'Изменить подпись меню'); });
        const href = document.createElement('input'); href.value = item.href || ''; href.setAttribute('aria-label', `Адрес пункта ${index + 1}`);
        href.addEventListener('input', () => { const next = clone(record.history.snapshot().value.items || []); next[index] = { ...next[index], href: href.value }; commitField(record, 'items', next, 'Изменить адрес меню'); });
        const move = (target) => {
          if (target < 0 || target >= items.length) return;
          const next = items.slice(); const [moved] = next.splice(index, 1); next.splice(target, 0, moved);
          commitField(record, 'items', next.map((entry, order) => ({ ...entry, order: (order + 1) * 10 })), 'Изменить порядок меню'); render();
        };
        const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.setAttribute('aria-label', `Выше: ${item.title}`); up.disabled = index === 0; up.addEventListener('click', () => move(index - 1));
        const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓'; down.setAttribute('aria-label', `Ниже: ${item.title}`); down.disabled = index === items.length - 1; down.addEventListener('click', () => move(index + 1));
        row.append(title, href, up, down); list.append(row);
      });
    };
    render(); section.append(legend, list); return section;
  }

  async function renderSettings() {
    const page = state.currentPage;
    const record = settingsRecord();
    settingsSubtitle.textContent = state.settingsContext === 'global'
      ? 'Общие значения · влияют на несколько страниц'
      : `${page?.title || ''} · ${page?.route || ''}`;
    settingsBody.replaceChildren();
    if (state.settingsTab === 'impact') {
      const section = document.createElement('section');
      section.className = 've-drawer-section';
      const routes = affectedRoutesForBinding(state.currentBinding?.binding);
      if (!routes.length && page?.route) routes.push(page.route);
      section.innerHTML = `<h3>Какие страницы затронет изменение</h3><p class="ve-field-hint">Список вычислен из binding/provenance registry. Exact-проверка после сохранения сверит итоговые HTML.</p><ul class="ve-impact-list">${routes.map((route) => `<li>${escapeHtml(route)}</li>`).join('')}</ul>`;
      if (page?.canonicalTarget) section.innerHTML += `<div class="ve-provenance" style="margin:14px 0 0"><strong>Каноническая цель</strong>${escapeHtml(page.canonicalTarget)}. Этот alias не является второй редактируемой страницей.</div>`;
      settingsBody.append(section);
      return;
    }
    if (state.settingsTab === 'history') {
      const section = document.createElement('section');
      section.className = 've-drawer-section';
      section.innerHTML = '<h3>Локальная история</h3><p class="ve-field-hint">Восстановление всегда создаёт новую транзакцию и не переписывает историю.</p>';
      const list = document.createElement('div');
      list.className = 've-history-list';
      try {
        const history = (await api.history()).history || [];
        const related = history.filter((entry) => !record || JSON.stringify(entry).includes(record.slug)).slice(0, 30);
        if (!related.length) list.innerHTML = '<p class="ve-field-hint">Для этой страницы сохранённых изменений пока нет.</p>';
        related.forEach((entry) => {
          const item = document.createElement('article');
          item.className = 've-history-item';
          item.innerHTML = `<strong>${escapeHtml(entry.metadata?.userSummary || entry.userSummary || 'Изменение')}</strong><br>${escapeHtml(new Date(entry.committedAt || entry.createdAt || Date.now()).toLocaleString('ru-RU'))}`;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 've-button';
          button.textContent = 'Подготовить восстановление';
          button.addEventListener('click', async () => {
            try {
              const preview = await api.restorePreview(entry.transactionId);
              const confirmed = window.confirm(`Восстановить ${preview.diff?.length || 0} файлов новой транзакцией?`);
              if (!confirmed) return;
              if (dirtyRecords().length) {
                notifications.toast('Сначала сохраните или экспортируйте браузерный черновик. Восстановление истории не будет молча его затирать.', 'warning', 0);
                return;
              }
              const applied = await api.transactionApply({ transactionId: preview.transactionId, idempotencyKey: preview.idempotencyKey, payloadHash: preview.payloadHash });
              state.lastTransactionIds = [preview.transactionId];
              state.exact = null;
              state.publishJob = null;
              state.records.clear();
              state.remoteConflicts.clear();
              notifications.toast('Восстановление сохранено как новая локальная транзакция.', 'success');
              await loadSummaries();
              const restoredPage = state.pageByRoute.get(page?.route || '/') || state.pageByRoute.get('/');
              await openPage(restoredPage, { history: 'none' });
              localStorage.setItem(storageKey('last-save-evidence'), JSON.stringify({ at: new Date().toISOString(), records: preview.diff?.length || 0, transactionId: preview.transactionId, restoredFrom: entry.transactionId }));
              settingsDrawer.close();
              void watchBackupAfterSave(preview.transactionId);
              void requestExactValidation({ transactionId: preview.transactionId, applied });
            } catch (error) { notifications.toast(error.message, 'error', 0); }
          });
          item.append(button);
          list.append(item);
        });
      } catch (error) { list.innerHTML = `<p class="ve-field-error">${escapeHtml(error.message)}</p>`; }
      section.append(list);
      settingsBody.append(section);
      return;
    }
    if (!record) {
      settingsBody.innerHTML = `<section class="ve-drawer-section"><h3>${escapeHtml(page?.typeLabel || 'Страница')}</h3><p>Эта страница пока имеет вычисляемую или юридическую модель. Её route semantics недоступны для обычной формы.</p>${page?.canonicalTarget ? `<div class="ve-provenance" style="margin:14px 0"><strong>Каноническая цель</strong>${escapeHtml(page.canonicalTarget)}</div>` : ''}</section>`;
      return;
    }
    if (state.settingsTab === 'seo') {
      const section = document.createElement('section');
      section.className = 've-drawer-section ve-drawer-grid';
      if (state.settingsContext === 'global') {
        section.innerHTML = '<h3>SEO относится к конкретной странице</h3><p class="ve-field-hint">Закройте общие настройки и откройте нужную страницу. Контакты, Footer и реквизиты остаются общими, но поисковое представление настраивается отдельно.</p>';
        settingsBody.append(section);
        return;
      }
      const seoPrefix = page?.legal ? 'privacyPolicy.' : '';
      section.append(
        fieldControl(record, `${seoPrefix}seoTitle`, 'SEO title', { hint: 'Обычно до 60–65 знаков.' }),
        fieldControl(record, `${seoPrefix}seoDescription`, 'SEO description', { type: 'textarea', hint: 'Кратко опишите страницу для поисковой выдачи.' })
      );
      const canonical = document.createElement('label');
      canonical.className = 've-field';
      canonical.innerHTML = `<span>Канонический адрес</span><input value="${escapeHtml(page.route)}" disabled><p class="ve-field-hint">Вычисляется из slug и родителя. Совместимые адреса показаны отдельно.</p>`;
      section.append(canonical);
      const preview = document.createElement('div');
      preview.className = 've-social-preview';
      const snapshot = record.history.snapshot().value;
      preview.innerHTML = `<span>Предпросмотр ссылки</span><strong>${escapeHtml(getAtPath(snapshot, `${seoPrefix}seoTitle`) || snapshot.title || page.title)}</strong><small>${escapeHtml(page.route)}</small><p>${escapeHtml(getAtPath(snapshot, `${seoPrefix}seoDescription`) || '')}</p>`;
      section.append(preview);
      settingsBody.append(section);
      return;
    }
    const content = record.history.snapshot().value;
    const general = document.createElement('section');
    general.className = 've-drawer-section ve-drawer-grid';
    if (state.settingsContext === 'global') {
      const globalFields = [
        ['companyName', 'Название организации'], ['phonePrimary', 'Основной телефон'], ['phoneSecondary', 'Дополнительный телефон'],
        ['telegram', 'Ссылка Telegram'], ['telegramLabel', 'Подпись Telegram'], ['email', 'Электронная почта'],
        ['city', 'Город'], ['address', 'Адрес производства'], ['legalAddress', 'Юридический адрес'],
        ['inn', 'ИНН'], ['kpp', 'КПП'], ['ogrn', 'ОГРН'], ['footerDisclaimer', 'Дисклеймер Footer'],
        ['copyrightLabel', 'Копирайт'], ['brandLogo', 'Логотип']
      ];
      for (const [path, label] of globalFields) {
        if (path in content) general.append(fieldControl(record, path, label, {
          type: ['legalAddress', 'footerDisclaimer'].includes(path) ? 'textarea' : 'text'
        }));
      }
      if (Array.isArray(content.regions)) {
        const wrapper = document.createElement('label');
        wrapper.className = 've-field';
        const title = document.createElement('span');
        title.textContent = 'Регионы работы';
        const control = document.createElement('textarea');
        control.value = content.regions.join('\n');
        control.addEventListener('input', () => commitField(record, 'regions', control.value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)));
        const hint = document.createElement('p');
        hint.className = 've-field-hint';
        hint.textContent = 'Один регион на строку. Изменение затронет все места, где показывается география работы.';
        wrapper.append(title, control, hint);
        general.append(wrapper);
      }
      settingsBody.append(general);
      try {
        const navigation = await ensureNavigationRecord();
        settingsBody.append(navigationEditor(navigation));
      } catch (error) {
        const warning = document.createElement('p'); warning.className = 've-field-error'; warning.textContent = `Главное меню не загрузилось: ${error.message}`; settingsBody.append(warning);
      }
      return;
    }
    if (page?.legal) {
      general.append(
        fieldControl(record, 'privacyPolicy.revisionDate', 'Дата редакции'),
        fieldControl(record, 'privacyPolicy.documentDescription', 'Описание документа', { type: 'textarea' })
      );
      const confirmation = document.createElement('div');
      confirmation.className = 've-provenance';
      confirmation.innerHTML = `<strong>Юридическое подтверждение</strong><span>Реквизиты оператора сравниваются с общими настройками. Последнее подтверждение: ${escapeHtml(content.privacyPolicy?.confirmedAgainstGlobalAt || 'не подтверждено')}.</span><button type="button" data-confirm-legal>Подтвердить текущие реквизиты</button>`;
      confirmation.querySelector('[data-confirm-legal]')?.addEventListener('click', () => {
        if (!window.confirm('Подтвердить, что реквизиты оператора в документе сверены с общими настройками сайта?')) return;
        commitField(record, 'privacyPolicy.confirmedAgainstGlobalAt', new Date().toISOString(), 'Подтвердить юридические реквизиты');
        void renderSettings();
      });
      general.append(confirmation);
      settingsBody.append(general);
      return;
    }
    const slugField = document.createElement('label');
    slugField.className = 've-field';
    const technicalRecordUrl = `${withBase(siteBase, '/admin/all-materials/')}?${new URLSearchParams({ collection: record.collection, slug: record.slug })}`;
    slugField.innerHTML = `<span>Slug / адрес</span><input value="${escapeHtml(content.slug || record.slug)}" disabled><p class="ve-field-hint">Смена адреса — структурная операция с предварительной проверкой ссылок. Она не мешает сохранять обычные правки. <a href="${escapeHtml(technicalRecordUrl)}">Изменить адрес в безопасной форме…</a></p>`;
    general.append(slugField);
    if ('isActive' in content) general.append(fieldControl(record, 'isActive', 'Показывать на сайте', { type: 'checkbox' }));
    if ('showInCatalog' in content) general.append(fieldControl(record, 'showInCatalog', 'Показывать в каталоге', { type: 'checkbox' }));
    if ('presentationType' in content) general.append(fieldControl(record, 'presentationType', 'Тип подачи', { type: 'select', options: [{ value: 'standard', label: 'Обычная карточка' }, { value: 'premium', label: 'Премиальная подача' }], disabled: true, hint: 'Смена шаблона требует отдельной exact-проверки.' }));
    if ('productCategorySlug' in content) {
      general.append(structuralSelect(record, 'productCategorySlug', 'Категория товара', state.pages
        .filter((item) => item.kind === 'category')
        .map((item) => ({ value: item.slug, label: `${item.categoryTitle || ''}${item.categoryTitle ? ' · ' : ''}${item.title}` })), 'Перенести товар в другую категорию? Категория и обе detail/list страницы будут проверены перед записью.'));
    }
    if ('parentSectionSlug' in content) {
      general.append(structuralSelect(record, 'parentSectionSlug', 'Родительское направление', state.pages
        .filter((item) => item.kind === 'direction' && item.collection === 'product-sections')
        .map((item) => ({ value: item.slug, label: item.title })), 'Перенести категорию в другое направление? Все дочерние адреса и ссылки будут проверены перед записью.'));
    }
    if ('order' in content) general.append(fieldControl(record, 'order', 'Порядок', { type: 'number', min: 0 }));
    if (content.imageView) {
      general.append(
        fieldControl(record, 'imageView.fit', 'Заполнение изображения', { type: 'select', options: [{ value: 'cover', label: 'Заполнить область' }, { value: 'contain', label: 'Показать целиком' }] }),
        fieldControl(record, 'imageView.positionX', 'Фокус по горизонтали, %', { type: 'number', min: 0, max: 100 }),
        fieldControl(record, 'imageView.positionY', 'Фокус по вертикали, %', { type: 'number', min: 0, max: 100 }),
        fieldControl(record, 'imageView.scale', 'Масштаб', { type: 'number', min: 1, max: 3, step: 0.05 })
      );
    }
    if (record.collection === 'projects' && content.presentation) {
      general.append(
        fieldControl(record, 'presentation.archiveCoverOrientation', 'Форма обложки в архиве', { type: 'select', options: [{ value: 'landscape', label: 'Альбомная' }, { value: 'portrait', label: 'Портретная' }] }),
        focalPositionControl(record, 'presentation.archiveCoverPosition', 'Фокус обложки архива'),
        focalPositionControl(record, 'presentation.detailHeroPosition', 'Фокус hero страницы')
      );
    }
    settingsBody.append(general);
    if (record.collection === 'products') {
      const relations = document.createElement('section');
      relations.className = 've-drawer-section';
      relations.append(relationChooser(record, 'relatedProductSlugs', 'Связанные товары и их порядок', state.pages.filter((item) => item.kind === 'product' && item.slug !== record.slug)));
      settingsBody.append(relations);
    }
    if (record.collection === 'projects' && content.presentation) {
      const candidates = state.pages.filter((item) => item.kind === 'direction' || item.collection === 'services');
      settingsBody.append(projectDirectionChooser(record, candidates));
    }
    if (content.directionPresentation && ['product-sections', 'services'].includes(record.collection)) {
      const candidates = state.pages.filter((item) => (
        ['product-sections', 'product-categories', 'services'].includes(item.collection)
        && item.emitted !== false
        && item.isActive !== false
        && !(item.collection === record.collection && item.slug === record.slug)
      ));
      settingsBody.append(directionSectionNavEditor(record), directionRelatedChooser(record, candidates));
    }
    const aliases = state.pages.filter((item) => item.canonicalTarget && normalizeRoute(item.canonicalTarget) === page?.route);
    const routeImpact = document.createElement('section');
    routeImpact.className = 've-drawer-section';
    routeImpact.innerHTML = `<h3>Адреса и влияние</h3><p class="ve-field-hint">Основной адрес: ${escapeHtml(page?.route || '')}</p>${aliases.length ? `<ul class="ve-impact-list">${aliases.map((item) => `<li>${escapeHtml(item.route)} → ${escapeHtml(page.route)}</li>`).join('')}</ul>` : '<p class="ve-field-hint">Совместимых alias-адресов нет.</p>'}`;
    settingsBody.append(routeImpact);
    const addKind = page?.kind === 'category' && content.mode === 'catalog-list' ? 'product'
      : page?.kind === 'projects' ? 'project'
        : page?.kind === 'vacancies' ? 'job'
          : '';
    if (addKind) {
      const addSection = document.createElement('section');
      addSection.className = 've-drawer-section';
      addSection.innerHTML = `<h3>Материалы списка</h3><p class="ve-field-hint">Новая запись создаётся скрытой в браузерном черновике и использует тот же Save/transaction flow.</p>`;
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 've-button ve-button--primary';
      add.textContent = addKind === 'product' ? 'Добавить товар' : addKind === 'project' ? 'Добавить объект' : 'Добавить вакансию';
      add.addEventListener('click', async () => {
        const candidates = state.pages.filter((item) => item.kind === addKind && (addKind !== 'product' || item.parentSlug === page.slug));
        const source = candidates[0] ? await ensureRecord(candidates[0].collection, candidates[0].slug) : null;
        if (!source) {
          notifications.toast('Нет безопасного шаблона для новой записи. Создайте первую запись в режиме «Все материалы».', 'warning', 0);
          return;
        }
        const copy = duplicateRecordDraft(source, addKind === 'product' ? { productCategorySlug: page.slug } : {});
        if (copy) {
          settingsDrawer.close();
          closeInlineEditor();
          inspector.hidden = false;
          app.dataset.inspectorOpen = 'true';
          inspectorKicker.textContent = 'Новый скрытый черновик';
          inspectorTitle.textContent = copy.history.snapshot().value.title;
          inspectorForm.replaceChildren();
          renderTextInspector(copy, { fieldPath: 'title', label: 'Название' }, copy.history.snapshot().value.title, { multiline: false });
        }
      });
      addSection.append(add);
      settingsBody.append(addSection);
    }
    const danger = document.createElement('section');
    danger.className = 've-drawer-section danger-zone';
    danger.innerHTML = `<h3>Опасные действия</h3><p class="ve-field-hint">Удаление, смена шаблона и route topology выполняются только после отдельного pre-apply gate. Редактор сначала покажет затронутые страницы и потребует отдельное подтверждение.</p><div class="ve-publish-step__actions"><button type="button" class="ve-button" data-hide-record>Скрыть с сайта</button><a class="ve-button" href="${escapeHtml(technicalRecordUrl)}">Изменить адрес…</a><a class="ve-button" href="${escapeHtml(technicalRecordUrl)}">Удалить…</a></div>`;
    danger.querySelector('[data-hide-record]')?.addEventListener('click', () => {
      let next = record.history.snapshot().value;
      if ('isActive' in next) next = { ...next, isActive: false };
      if ('showInCatalog' in next) next = { ...next, showInCatalog: false };
      record.history.commit(next, { label: 'Скрыть материал с сайта', force: true });
      notifications.toast('Материал скрыт только в браузерном черновике. Нажмите «Сохранить».', 'success');
    });
    settingsBody.append(danger);
  }

  function openSettings(tab = 'general', { record = null, context = 'page' } = {}) {
    state.settingsTab = tab;
    state.settingsRecordOverride = record;
    state.settingsContext = context;
    for (const button of root.querySelectorAll('[data-settings-tab]')) button.setAttribute('aria-pressed', String(button.dataset.settingsTab === tab));
    void renderSettings();
    if (!settingsDrawer.open) restoreFocusDialog(settingsDrawer, document.activeElement);
  }

  async function handleBackupAction(button) {
    const action = button.dataset.backupAction;
    const snapshotId = button.dataset.snapshotId || '';
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Выполняется…';
    try {
      if (action === 'create-export') {
        state.backupAction = await api.createBackupExport();
        notifications.toast('Полная переносимая копия создана в отдельном каталоге.', 'success');
      } else if (action === 'verify') {
        const result = await api.verifyBackup(snapshotId);
        state.backupAction = result;
        notifications.toast(result.ok ? `Резервная копия проверена: ${result.checkedFiles} файлов без ошибок.` : 'Проверка нашла повреждённые файлы. Восстановление заблокировано.', result.ok ? 'success' : 'error', result.ok ? 5200 : 0);
      } else if (action === 'export') {
        state.backupAction = await api.exportBackup(snapshotId);
        notifications.toast('Переносимая копия подготовлена. Путь доступен в технических сведениях.', 'success');
      } else if (action === 'restore') {
        if (dirtyRecords().length) {
          notifications.toast('Сначала сохраните или отмените браузерный черновик. Восстановление не должно смешиваться с несохранёнными правками.', 'warning');
          return;
        }
        const preview = await api.previewBackupRestore(snapshotId);
        state.backupAction = preview;
        if (!window.confirm(`Проверка найдена: будет изменено ${preview.changeCount} файлов. Восстановить копию новой атомарной транзакцией?`)) return;
        const applied = await api.applyBackupRestore(preview.restoreId);
        state.backupAction = applied;
        notifications.toast('Резервная копия восстановлена новой транзакцией. Редактор перезагрузится с актуальными данными.', 'success', 0);
        window.setTimeout(() => window.location.reload(), 900);
        return;
      }
      await refreshBackupState({ includeList: true });
      await renderPublish();
    } catch (error) {
      notifications.toast(error.message || 'Операция с резервной копией не выполнена.', 'error', 0);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  }

  async function renderPublish() {
    const focused = publishBody.contains(document.activeElement) && document.activeElement instanceof HTMLElement
      ? {
          action: document.activeElement.dataset.backupAction || (document.activeElement.hasAttribute('data-preview-publish') ? 'preview' : document.activeElement.hasAttribute('data-preview-retry') ? 'preview-retry' : document.activeElement.hasAttribute('data-exact-retry') ? 'retry' : document.activeElement.hasAttribute('data-publish-save') ? 'save' : ''),
          snapshotId: document.activeElement.dataset.snapshotId || ''
        }
      : null;
    try { state.publishOverview = await api.publishOverview(); }
    catch (error) { state.publishOverview = { error: error.message }; }
    await refreshBackupState({ includeList: !state.backupsLoaded });
    const dirty = dirtyRecords();
    const exactStatus = state.exact?.status || 'not-requested';
    const latestTransactionId = state.lastTransactionIds.at(-1) || '';
    const exactReady = exactStatus === 'passed'
      && state.exact?.current === true
      && state.exact?.publishEligible === true
      && state.exact?.transactionId === latestTransactionId
      && dirty.length === 0
      && Boolean(latestTransactionId);
    const previewUrl = state.publishJob?.previewUrl || state.publishOverview?.previewUrl || state.publishOverview?.latestJob?.previewUrl || '';
    const previewUrlIsImmutable = state.publishJob?.previewUrlIsImmutable === true
      || state.publishOverview?.previewUrlIsImmutable === true
      || state.publishOverview?.latestJob?.previewUrlIsImmutable === true;
    const previewNeedsRetry = state.publishJob?.retryable === true;
    const previewRunning = state.publishRequestInFlight || (publishJobRunning(state.publishJob) && !previewNeedsRetry);
    const previewVerified = publishJobVerified(state.publishJob);
    const previewFailed = state.publishJob?.status === 'failure' || previewNeedsRetry;
    const exactState = exactReady ? 'ready' : ['queued', 'running'].includes(exactStatus) ? 'running' : exactStatus === 'failed' ? 'failed' : 'blocked';
    const exactTitle = exactReady
      ? 'Точная проверка пройдена'
      : exactStatus === 'passed'
        ? 'Проверка устарела'
        : ['queued', 'running'].includes(exactStatus)
          ? 'Проверяем точный результат'
          : exactStatus === 'failed'
            ? 'Сохранено, но проверка не прошла'
            : 'Ожидает сохранённую редакцию';
    const exactCopy = state.exact?.message || (exactStatus === 'failed'
      ? 'Изменения сохранены на компьютере, но проверка сайта не прошла. Тестовая публикация заблокирована.'
      : exactStatus === 'passed' && !exactReady
        ? 'Последняя успешная проверка относится к другой или уже изменённой редакции. Сохраните текущий черновик и дождитесь новой проверки.'
        : 'Exact build использует immutable snapshot, production components и H5 media pipeline.');
    const backup = state.backupStatus || {};
    const backupState = backup.configured === false || backup.lastError ? 'failed' : backup.pending ? 'running' : backup.lastSuccess ? 'ready' : 'blocked';
    const backupTitle = backup.configured === false
      ? 'Резервное копирование недоступно'
      : backup.lastError
        ? 'Сохранено, но резервная копия не создана'
        : backup.pending
          ? 'Создаём резервную копию'
          : backup.lastSuccess
            ? 'Резервная копия создана'
            : 'Резервная копия появится после сохранения';
    const backupCopy = backup.lastError?.message
      || (backup.lastSuccess?.at ? `Последняя успешная копия: ${new Date(backup.lastSuccess.at).toLocaleString('ru-RU')}. Проверено SHA-256, файлов: ${backup.lastSuccess.fileCount || 0}.` : 'После каждого успешного Save содержимое и медиа копируются в отдельный настраиваемый каталог.');
    const backupRows = state.backups.slice(0, 10).map((item) => `<article class="ve-backup-row"><div><strong>${escapeHtml(new Date(item.createdAt).toLocaleString('ru-RU'))}</strong><small>${escapeHtml(item.kind === 'automatic' ? 'Автоматическая' : 'Ручная')} · ${item.fileCount} файлов · ${escapeHtml(humanBytes(item.totalBytes))}</small></div><div class="ve-backup-row__actions"><button type="button" class="ve-button" data-backup-action="verify" data-snapshot-id="${escapeHtml(item.snapshotId)}">Проверить</button><button type="button" class="ve-button" data-backup-action="export" data-snapshot-id="${escapeHtml(item.snapshotId)}">Экспорт</button><button type="button" class="ve-button" data-backup-action="restore" data-snapshot-id="${escapeHtml(item.snapshotId)}" ${dirty.length ? 'disabled' : ''}>Восстановить…</button></div></article>`).join('');
    publishBody.innerHTML = `
      <section class="ve-publish-step" data-step="1" data-state="${dirty.length ? 'running' : 'ready'}">
        <h3>${dirty.length ? 'Есть несохранённые изменения' : 'Сохранено на компьютере'}</h3>
        <p>${dirty.length ? `${dirty.length} материалов остаются браузерным черновиком. Сохранение локальное и не запускает публикацию.` : `Локальная редакция зафиксирована${state.lastSaveLatencyMs != null ? ` за ${(state.lastSaveLatencyMs / 1000).toFixed(2)} с` : ''}.`}</p>
        ${dirty.length ? '<div class="ve-publish-step__actions"><button type="button" class="ve-button ve-button--primary" data-publish-save>Сохранить на компьютере</button></div>' : ''}
        <div class="ve-backup-summary" data-state="${backupState}"><strong>${escapeHtml(backupTitle)}</strong><span>${escapeHtml(backupCopy)}</span><div class="ve-publish-step__actions"><button type="button" class="ve-button" data-backup-action="create-export" ${backup.configured === false ? 'disabled' : ''}>Создать полную копию</button></div></div>
        ${state.backups.length ? `<details class="ve-backup-history"><summary>История резервных копий · ${state.backups.length}</summary><div>${backupRows}</div></details>` : ''}
      </section>
      <section class="ve-publish-step" data-step="2" data-state="${exactState}">
        <h3>${exactTitle}</h3>
        <p>${escapeHtml(exactCopy)}</p>
        ${exactStatus === 'failed' && state.exact?.runId ? '<div class="ve-publish-step__actions"><button type="button" class="ve-button" data-exact-retry>Повторить проверку</button></div>' : ''}
      </section>
      <section class="ve-publish-step" data-step="3" data-state="${previewVerified ? 'ready' : previewFailed ? 'failed' : previewRunning ? 'running' : exactReady ? 'ready' : 'blocked'}">
        <h3>Тестовый сайт</h3>
        <p>${previewVerified ? 'Проверенный артефакт побайтно совпал с опубликованным deployment и прошёл live smoke.' : previewFailed ? 'Тестовая публикация не удалась. Локально сохранённая редакция не изменена.' : 'Публикуется только зафиксированная и точно проверенная редакция. Preview имеет noindex, но без отдельной защиты доступа не считается приватным.'}</p>
        <div class="ve-publish-step__actions">${previewNeedsRetry ? '<button type="button" class="ve-button ve-button--primary" data-preview-retry>Повторить безопасную сверку</button>' : `<button type="button" class="ve-button ve-button--primary" data-preview-publish ${exactReady && !previewRunning ? '' : 'disabled'}>${previewRunning ? 'Собирается…' : previewVerified ? 'Обновить тестовый сайт ещё раз' : 'Обновить тестовый сайт'}</button>`}${previewUrl ? '<button type="button" class="ve-button" data-open-preview>Открыть тестовый сайт</button>' : ''}</div>
        ${previewUrl ? `<a class="ve-publish-url" href="${escapeHtml(previewUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(previewUrl)}</a>${previewUrlIsImmutable ? '' : '<p class="ve-publish-note">GitHub Pages даёт изменяемый адрес: следующая тестовая публикация обновит его. Точная версия и побайтовая сверка доступны в технических сведениях.</p>'}` : ''}
      </section>
      <section class="ve-publish-step" data-step="4" data-state="blocked">
        <h3>Основной сайт</h3>
        <p>Основной сайт будет подключён при запуске H7. Сейчас доступна только тестовая публикация.</p>
        <div class="ve-publish-step__actions"><button type="button" class="ve-button" disabled>Опубликовать на основном сайте</button><button type="button" class="ve-button" disabled>Откатить версию</button></div>
      </section>
      <details class="ve-technical"><summary>Технические сведения</summary><pre>${escapeHtml(JSON.stringify({ exact: state.exact, publish: state.publishJob || state.publishOverview, backup: state.backupStatus, backupAction: state.backupAction, transactionIds: state.lastTransactionIds }, null, 2))}</pre></details>`;
    publishBody.querySelector('[data-publish-save]')?.addEventListener('click', () => void saveAll());
    publishBody.querySelector('[data-exact-retry]')?.addEventListener('click', () => void requestExactValidation({ transactionId: state.exact.transactionId || state.lastTransactionIds.at(-1) }));
    publishBody.querySelector('[data-preview-publish]')?.addEventListener('click', () => void publishPreview());
    publishBody.querySelector('[data-preview-retry]')?.addEventListener('click', () => void retryPublishPreview());
    publishBody.querySelector('[data-open-preview]')?.addEventListener('click', () => window.open(previewUrl, '_blank', 'noopener,noreferrer'));
    for (const button of publishBody.querySelectorAll('[data-backup-action]')) button.addEventListener('click', () => void handleBackupAction(button));
    if (focused?.action) {
      const selector = focused.action === 'preview' ? '[data-preview-publish]'
        : focused.action === 'preview-retry' ? '[data-preview-retry]'
        : focused.action === 'retry' ? '[data-exact-retry]'
          : focused.action === 'save' ? '[data-publish-save]'
            : `[data-backup-action="${CSS.escape(focused.action)}"][data-snapshot-id="${CSS.escape(focused.snapshotId)}"]`;
      publishBody.querySelector(selector)?.focus({ preventScroll: true });
    }
  }

  function openPublish() {
    if (!publishDrawer.open) {
      publishBody.innerHTML = '<section class="ve-publish-step" data-state="running"><h3>Загружаем состояние</h3><p role="status">Сверяем сохранённую редакцию, проверку и резервные копии…</p></section>';
      restoreFocusDialog(publishDrawer, document.activeElement);
    }
    void renderPublish();
  }

  async function publishPreview() {
    if (state.publishRequestInFlight || publishJobRunning(state.publishJob)) return;
    const latestTransactionId = state.lastTransactionIds.at(-1) || '';
    if (state.exact?.status !== 'passed'
      || state.exact?.current !== true
      || state.exact?.publishEligible !== true
      || state.exact?.transactionId !== latestTransactionId
      || dirtyRecords().length
      || !latestTransactionId) {
      notifications.toast('Тестовая публикация доступна только для текущей сохранённой редакции с успешной exact-проверкой.', 'warning');
      return;
    }
    state.publishRequestInFlight = true;
    try {
      setHumanStatus('publishing');
      void renderPublish();
      const plan = await api.publishPlan(state.lastTransactionIds);
      const result = await api.publishApply(plan.planId, { idempotencyKey: crypto.randomUUID() });
      state.publishJob = result;
      state.publishRequestInFlight = false;
      await renderPublish();
      pollPublishJob(result.jobId);
    } catch (error) {
      state.publishRequestInFlight = false;
      setHumanStatus('publishFailed');
      notifications.toast(error.message || 'Тестовая публикация не удалась.', 'error', 0);
      await renderPublish();
    }
  }

  function pollPublishJob(jobId, delay = 4000) {
    if (!jobId) return;
    window.setTimeout(async () => {
      try {
        const job = await api.publishJob(jobId);
        state.publishJob = job;
        if (job.retryable === true) {
          setHumanStatus('publishFailed');
          notifications.toast('Результат сети не подтверждён. Локальная редакция сохранена; используйте безопасный повтор сверки.', 'warning', 0);
          renderPublish();
        } else if (publishJobRunning(job)) {
          setHumanStatus('publishing');
          renderPublish();
          pollPublishJob(jobId, Math.min(12000, Math.round(delay * 1.35)));
        } else if (publishJobVerified(job)) {
          setHumanStatus('published');
          notifications.toast('Тестовый сайт готов. SHA-256 артефакта совпал с deployment, live smoke пройден.', 'success');
          renderPublish();
        } else {
          setHumanStatus('publishFailed');
          notifications.toast('Тестовая публикация не удалась. Сохранённая локальная редакция не пострадала.', 'error', 0);
          renderPublish();
        }
      } catch (error) {
        notifications.toast(error.message || 'Не удалось получить статус тестовой публикации.', 'warning', 0);
        pollPublishJob(jobId, Math.min(15000, Math.round(delay * 1.5)));
      }
    }, delay);
  }

  async function retryPublishPreview() {
    const jobId = state.publishJob?.jobId;
    if (!jobId || state.publishJob?.retryable !== true) return;
    try {
      setHumanStatus('publishing');
      state.publishJob = await api.retryPublishJob(jobId);
      await renderPublish();
      pollPublishJob(jobId, 2000);
    } catch (error) {
      setHumanStatus('publishFailed');
      notifications.toast(error.message || 'Безопасный повтор тестовой публикации не удался.', 'error', 0);
      await renderPublish();
    }
  }

  function mediaIdentity(binding, record) {
    return { repoIdentity: REPO_IDENTITY, collection: record.collection, slug: record.slug, fieldPath: binding.fieldPath };
  }

  function revokeMediaUrls() {
    for (const url of state.mediaObjectUrls) URL.revokeObjectURL(url);
    state.mediaObjectUrls.clear();
  }

  function preflightMedia(file) {
    const extension = String(file.name || '').split('.').at(-1)?.toLowerCase() || '';
    if (!IMAGE_EXTENSIONS.has(extension)) return 'Разрешены только JPEG, PNG и WebP. SVG, GIF, PDF, HEIC и архивы запрещены.';
    if (file.size <= 0) return 'Файл пустой.';
    if (file.size > MAX_IMAGE_BYTES) return 'Фото больше 10 МБ. Подготовьте уменьшенную JPG/WebP-копию.';
    return '';
  }

  async function imageDimensions(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { const result = { width: image.naturalWidth, height: image.naturalHeight }; URL.revokeObjectURL(url); resolve(result); };
      image.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 0, height: 0 }); };
      image.src = url;
    });
  }

  async function persistMediaQueue() {
    const active = state.activeMedia;
    if (!active) return;
    try {
      await mediaQueueStore.put({
        ...mediaIdentity(active.binding, active.record),
        batchId: state.mediaBatchId,
        items: state.mediaQueue
      });
    } catch (error) { notifications.toast(`Очередь не удалось сохранить для восстановления: ${error.message}`, 'warning', 0); }
  }

  async function addMediaFiles(fileList) {
    const files = [...fileList];
    const remaining = MAX_MEDIA_FILES - state.mediaQueue.length;
    if (remaining <= 0) { notifications.toast('В одной очереди может быть не более 50 файлов.', 'warning'); return; }
    const accepted = files.slice(0, remaining);
    const total = state.mediaQueue.reduce((sum, item) => sum + Number(item.bytes || 0), 0) + accepted.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_MEDIA_BYTES) { notifications.toast('Суммарный размер очереди превышает 250 МБ. Разделите загрузку на несколько сохранений.', 'error', 0); return; }
    for (const file of accepted) {
      const dimensions = await imageDimensions(file);
      state.mediaQueue.push({
        clientId: `media-${crypto.randomUUID()}`,
        originalIndex: state.mediaQueue.length,
        file,
        name: file.name,
        type: file.type,
        bytes: file.size,
        width: dimensions.width,
        height: dimensions.height,
        alt: '', caption: '', role: 'gallery', roles: ['gallery'], originalRoles: ['gallery'], roleChanged: false,
        status: 'waiting', error: preflightMedia(file), canonicalPath: '', lease: null
      });
    }
    if (files.length > accepted.length) notifications.toast('Добавлены первые 50 файлов. Остальные не попали в очередь.', 'warning');
    await persistMediaQueue();
    renderMediaQueue();
  }

  function moveMedia(from, to) {
    if (from < 0 || to < 0 || from >= state.mediaQueue.length || to >= state.mediaQueue.length || from === to) return;
    const [item] = state.mediaQueue.splice(from, 1);
    state.mediaQueue.splice(to, 0, item);
    void persistMediaQueue();
    renderMediaQueue();
    notifications.announce(`Фотография перемещена на позицию ${to + 1}.`);
  }

  function mediaRoleOptions(binding, record) {
    const current = getAtPath(record.history.snapshot().value, binding.fieldPath);
    const options = [];
    if (binding.multiple !== false || Array.isArray(current)) options.push(['gallery', 'В опубликованную галерею']);
    else options.push(['gallery', 'Основное фото']);
    if (binding.coverPath) options.push(['cover', record.collection === 'projects' ? 'Обложка списка' : 'Обложка']);
    if (binding.heroPath) options.push(['hero', 'Hero страницы']);
    if (binding.archivePath && binding.archivePath !== binding.coverPath) options.push(['archive', 'Обложка архива']);
    if (binding.multiple !== false || record.collection === 'projects') options.push(['excluded', 'Оставить в исходниках, не публиковать']);
    return [...new Map(options.map((option) => [option[0], option])).values()];
  }

  function mediaItemRoles(item) {
    const roles = Array.isArray(item.roles) && item.roles.length
      ? item.roles
      : Array.isArray(item.originalRoles) && item.originalRoles.length
        ? item.originalRoles
        : [item.role || 'gallery'];
    return [...new Set(roles.filter(Boolean))];
  }

  function existingMediaQueue(binding, record) {
    const content = record.history.snapshot().value;
    const rows = new Map();
    const add = (raw, role = 'gallery') => {
      const path = mediaPath(raw);
      if (!path) return;
      const existing = rows.get(path);
      const originalRoles = [...new Set([...(existing?.originalRoles || existing?.roles || []), role])]
        .filter((entryRole) => role === 'excluded' || entryRole !== 'excluded');
      const priority = { excluded: 0, gallery: 1, cover: 2, hero: 3, archive: 4 };
      const nextRole = originalRoles.slice().sort((left, right) => priority[right] - priority[left])[0] || 'gallery';
      rows.set(path, {
        clientId: existing?.clientId || `existing-${crypto.randomUUID()}`,
        originalIndex: existing?.originalIndex ?? rows.size,
        file: null,
        name: decodeURIComponent(path.split('/').at(-1) || 'photo'),
        type: '', bytes: 0, width: 0, height: 0,
        alt: typeof raw === 'object' ? raw.alt || existing?.alt || '' : existing?.alt || '',
        caption: typeof raw === 'object' ? raw.caption || existing?.caption || '' : existing?.caption || '',
        role: nextRole, roles: originalRoles, originalRoles, roleChanged: false,
        status: 'uploaded', error: '', canonicalPath: path, lease: null,
        existing: true
      });
    };
    if (record.collection === 'projects') {
      const rawPool = Array.isArray(content.gallery) ? content.gallery : Array.isArray(content.images) ? content.images : [];
      const presentation = content.presentation || {};
      const published = new Set(Array.isArray(presentation.publicGallery) ? presentation.publicGallery : []);
      rawPool.forEach((item) => {
        const path = mediaPath(item);
        const enriched = typeof item === 'object'
          ? { ...item, alt: item.alt || presentation.altOverrides?.[path] || '' }
          : { src: path, alt: presentation.altOverrides?.[path] || '' };
        add(enriched, published.has(path) ? 'gallery' : 'excluded');
      });
      published.forEach((path) => add({ src: path, alt: presentation.altOverrides?.[path] || '' }, 'gallery'));
      add(presentation.archiveCoverMedia, 'cover');
      add(presentation.detailHeroMedia, 'hero');
      return [...rows.values()];
    }
    const current = getAtPath(content, binding.fieldPath);
    (Array.isArray(current) ? current : current ? [current] : []).forEach((item) => add(item, 'gallery'));
    if (binding.coverPath) add(getAtPath(content, binding.coverPath), 'cover');
    if (binding.heroPath) add(getAtPath(content, binding.heroPath), 'hero');
    if (binding.archivePath && binding.archivePath !== binding.coverPath) add(getAtPath(content, binding.archivePath), 'archive');
    return [...rows.values()];
  }

  function renderMediaQueue() {
    revokeMediaUrls();
    mediaBody.replaceChildren();
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.jpg,.jpeg,.png,.webp';
    picker.multiple = true;
    picker.hidden = true;
    picker.addEventListener('change', () => { void addMediaFiles(picker.files || []); picker.value = ''; });
    const dropzone = document.createElement('button');
    dropzone.type = 'button';
    dropzone.className = 've-media-dropzone';
    dropzone.innerHTML = '<span><strong>Перетащите фотографии сюда</strong>или выберите до 50 файлов · JPEG, PNG, WebP · до 10 МБ каждый</span>';
    dropzone.addEventListener('click', () => picker.click());
    for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.dataset.over = 'true'; });
    for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, (event) => { event.preventDefault(); delete dropzone.dataset.over; });
    dropzone.addEventListener('drop', (event) => void addMediaFiles(event.dataTransfer?.files || []));
    mediaBody.append(picker, dropzone);
    const queue = document.createElement('div');
    queue.className = 've-media-queue';
    state.mediaQueue.forEach((item, index) => {
      const row = document.createElement('article');
      row.className = 've-media-row';
      row.dataset.status = item.error ? 'error' : item.status;
      const number = document.createElement('button');
      number.type = 'button';
      number.className = 've-media-row__number';
      number.textContent = String(index + 1);
      number.draggable = true;
      number.title = 'Перетащить · Alt + стрелки';
      number.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', item.clientId); row.dataset.dragging = 'true'; });
      number.addEventListener('dragend', () => delete row.dataset.dragging);
      number.addEventListener('keydown', (event) => {
        if (!event.altKey) return;
        if (event.key === 'ArrowUp') { event.preventDefault(); moveMedia(index, index - 1); }
        if (event.key === 'ArrowDown') { event.preventDefault(); moveMedia(index, index + 1); }
        if (event.key === 'Home') { event.preventDefault(); moveMedia(index, 0); }
        if (event.key === 'End') { event.preventDefault(); moveMedia(index, state.mediaQueue.length - 1); }
      });
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const clientId = event.dataTransfer.getData('text/plain');
        moveMedia(state.mediaQueue.findIndex((entry) => entry.clientId === clientId), index);
      });
      const thumb = document.createElement('span');
      thumb.className = 've-media-row__thumb';
      if (item.file) {
        const objectUrl = URL.createObjectURL(item.file);
        state.mediaObjectUrls.add(objectUrl);
        const image = document.createElement('img');
        image.src = objectUrl;
        image.alt = '';
        thumb.append(image);
      } else if (item.canonicalPath) {
        const image = document.createElement('img');
        image.src = item.canonicalPath;
        image.alt = '';
        thumb.append(image);
      }
      const copy = document.createElement('div');
      copy.className = 've-media-row__copy';
      const privateMetadata = item.lease?.validation?.privateMetadata || item.privateMetadata;
      copy.innerHTML = `<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.width && item.height ? `${item.width} × ${item.height} · ` : '')}${humanBytes(item.bytes)}</small>${item.error ? `<small style="color:#b8473e">${escapeHtml(item.error)}</small>` : ''}${privateMetadata?.detected ? '<small class="ve-media-row__privacy">Найдены приватные метаданные — в публичной копии они удалены</small>' : ''}`;
      const textFields = document.createElement('span');
      textFields.className = 've-media-row__text-fields';
      const alt = document.createElement('input');
      alt.value = item.alt || '';
      alt.placeholder = 'Alt — что изображено';
      alt.setAttribute('aria-label', `Alt фотографии ${index + 1}`);
      alt.addEventListener('input', () => { item.alt = alt.value; void persistMediaQueue(); });
      const caption = document.createElement('input');
      caption.value = item.caption || '';
      caption.placeholder = 'Подпись (необязательно)';
      caption.setAttribute('aria-label', `Подпись фотографии ${index + 1}`);
      caption.addEventListener('input', () => { item.caption = caption.value; void persistMediaQueue(); });
      textFields.append(alt, caption);
      copy.append(textFields);
      const status = document.createElement('span');
      status.className = 've-media-row__status';
      status.dataset.state = item.error ? 'error' : item.status;
      const statusLabels = { waiting: 'Ожидает', uploading: 'Загружается…', uploaded: 'Проверено', reused: 'Дубликат найден', error: 'Ошибка', cancelled: 'Отменено' };
      status.textContent = item.error || statusLabels[item.status] || item.status;
      if (item.status === 'reused') {
        const duplicateAction = document.createElement('select');
        duplicateAction.className = 've-media-duplicate-action';
        duplicateAction.setAttribute('aria-label', `Что сделать с дубликатом ${index + 1}`);
        duplicateAction.innerHTML = '<option value="reuse">Использовать копию</option><option value="replace">Заменить элемент</option><option value="skip">Пропустить</option>';
        duplicateAction.value = item.duplicateAction || 'reuse';
        duplicateAction.addEventListener('change', () => { item.duplicateAction = duplicateAction.value; void persistMediaQueue(); });
        copy.append(duplicateAction);
      }
      const role = document.createElement('fieldset');
      role.className = 've-media-role-picker';
      role.setAttribute('aria-label', `Роли фотографии ${index + 1}`);
      const options = state.activeMedia ? mediaRoleOptions(state.activeMedia.binding, state.activeMedia.record) : [['gallery', 'В галерею']];
      const allowed = new Set(options.map(([value]) => value));
      item.roles = mediaItemRoles(item).filter((value) => allowed.has(value));
      if (!item.roles.length) item.roles = [options[0][0]];
      role.replaceChildren(...options.map(([value, label]) => {
        const wrapper = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = value;
        input.checked = item.roles.includes(value);
        input.addEventListener('change', () => {
          let next = new Set(mediaItemRoles(item));
          if (input.checked) next.add(value); else next.delete(value);
          if (value === 'excluded' && input.checked) next = new Set(['excluded']);
          else if (value !== 'excluded') next.delete('excluded');
          if (['cover', 'hero', 'archive'].includes(value) && input.checked) {
            state.mediaQueue.forEach((entry) => {
              if (entry.clientId === item.clientId) return;
              entry.roles = mediaItemRoles(entry).filter((entryRole) => entryRole !== value);
              if (!entry.roles.length) entry.roles = ['gallery'];
              entry.roleChanged = true;
            });
          }
          if (!next.size) next.add(allowed.has('gallery') ? 'gallery' : options[0][0]);
          item.roles = [...next].filter((entryRole) => allowed.has(entryRole));
          item.role = item.roles[0];
          item.roleChanged = true;
          void persistMediaQueue();
          renderMediaQueue();
        });
        wrapper.append(input, document.createTextNode(label));
        return wrapper;
      }));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 've-media-row__remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Убрать ${item.name}`);
      remove.addEventListener('click', async () => {
        if (item.lease) await api.cancelStagedMedia({ batchId: item.lease.batchId, leaseId: item.lease.leaseId }).catch(() => {});
        state.mediaQueue.splice(index, 1);
        await persistMediaQueue();
        renderMediaQueue();
      });
      row.append(number, thumb, copy, status, role, remove);
      queue.append(row);
    });
    mediaBody.append(queue);
    const actions = document.createElement('div');
    actions.className = 've-media-actions';
    actions.innerHTML = `<span class="ve-media-actions__summary">${state.mediaQueue.length} из 50 · ${humanBytes(state.mediaQueue.reduce((sum, item) => sum + item.bytes, 0))}</span>`;
    const actionGroup = document.createElement('div');
    actionGroup.className = 've-publish-step__actions';
    const reverse = document.createElement('button');
    reverse.type = 'button'; reverse.className = 've-button'; reverse.textContent = 'Обратный порядок'; reverse.disabled = state.mediaQueue.length < 2;
    reverse.addEventListener('click', () => { state.mediaQueue.reverse(); void persistMediaQueue(); renderMediaQueue(); });
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 've-button'; retry.textContent = 'Повторить ошибки'; retry.disabled = !state.mediaQueue.some((item) => item.status === 'error');
    retry.addEventListener('click', () => void retryFailedMedia());
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 've-button'; cancel.textContent = 'Отменить загрузку'; cancel.hidden = !state.mediaScheduler?.isRunning();
    cancel.addEventListener('click', () => state.mediaScheduler?.cancel());
    actionGroup.append(reverse, retry, cancel);
    actions.append(actionGroup);
    mediaBody.append(actions);
    const actionable = state.mediaInitialCount > 0 || state.mediaQueue.some((item) => item.existing || (!item.error && !mediaItemRoles(item).includes('excluded')));
    mediaConfirm.disabled = !actionable || state.mediaScheduler?.isRunning();
    mediaConfirm.textContent = state.mediaScheduler?.isRunning() ? 'Проверяем и загружаем…' : `Применить очередь (${state.mediaQueue.filter((item) => !item.error && !mediaItemRoles(item).includes('excluded')).length})`;
  }

  async function openMedia(binding, record) {
    if (state.mediaScheduler?.isRunning()) {
      notifications.toast('Сначала завершите или отмените текущую загрузку.', 'warning');
      return;
    }
    state.mediaScheduler = null;
    state.activeMedia = { binding, record };
    state.mediaBatchId = `batch-${crypto.randomUUID()}`;
    state.mediaQueue = [];
    const restored = await mediaQueueStore.get(mediaIdentity(binding, record)).catch(() => null);
    if (restored?.items?.length) {
      state.mediaBatchId = restored.batchId || state.mediaBatchId;
      state.mediaQueue = restored.items.map((item) => ({
        ...item,
        file: item.file && !(item.file instanceof File)
          ? new File([item.file], item.name || 'photo.jpg', { type: item.type || item.file.type || 'application/octet-stream' })
          : item.file
      }));
      notifications.toast(`Восстановлена незавершённая очередь: ${restored.items.length} файлов.`, 'success');
    } else state.mediaQueue = existingMediaQueue(binding, record);
    state.mediaInitialCount = state.mediaQueue.filter((item) => item.existing).length;
    mediaSubtitle.textContent = `Источник: ${record.history.snapshot().value.title || record.slug} · ${fieldLabel(binding.fieldPath)}. Порядок очереди станет порядком публикации.`;
    renderMediaQueue();
    restoreFocusDialog(mediaDialog, document.activeElement);
  }

  async function stageMediaItems(items) {
    const batchId = state.mediaBatchId;
    state.mediaScheduler = createMediaScheduler({
      concurrency: 2,
      windowMaxItems: 10,
      windowMaxBytes: 48 * 1024 * 1024,
      maxQueueItems: 50,
      worker: (item, { signal, originalIndex }) => api.stageMedia({ batchId, clientId: item.clientId, originalIndex, file: item.file, signal }),
      onUpdate: (progress) => {
        const row = state.mediaQueue.find((item) => item.clientId === progress.clientId);
        if (!row) return;
        row.status = progress.status;
        row.error = progress.error?.message || '';
        if (progress.result) {
          row.lease = progress.result;
          row.canonicalPath = progress.result.canonicalPath;
          row.privateMetadata = progress.result.validation?.privateMetadata || null;
          if (progress.result.reused) row.status = 'reused';
        }
        void persistMediaQueue();
        renderMediaQueue();
      }
    });
    return state.mediaScheduler.start(items.map((item, index) => ({ ...item, originalIndex: index })));
  }

  async function retryFailedMedia() {
    if (!state.mediaScheduler) {
      const failed = state.mediaQueue.filter((item) => item.status === 'error' && item.file);
      failed.forEach((item) => { item.error = ''; item.status = 'waiting'; });
      if (failed.length) await stageMediaItems(failed);
      return;
    }
    state.mediaQueue.filter((item) => item.status === 'error').forEach((item) => { item.error = ''; });
    await state.mediaScheduler.retryFailed();
  }

  async function confirmMedia() {
    const active = state.activeMedia;
    if (!active || state.mediaScheduler?.isRunning()) return;
    const uploadItems = state.mediaQueue.filter((item) => item.file && !item.lease && !item.error && !mediaItemRoles(item).includes('excluded'));
    try {
      if (uploadItems.length) await stageMediaItems(uploadItems);
      const failed = state.mediaQueue.filter((item) => item.status === 'error' || item.error);
      if (failed.length) {
        notifications.toast(`${failed.length} файлов требуют внимания. Успешные элементы сохранены в очереди; повторите только ошибки.`, 'error', 0);
        renderMediaQueue();
        return;
      }
      const usable = state.mediaQueue.filter((item) => item.duplicateAction !== 'skip' && (item.canonicalPath || item.lease?.canonicalPath));
      const selected = usable.filter((item) => !mediaItemRoles(item).includes('excluded'));
      if (!usable.length && !state.mediaQueue.some((item) => item.existing) && state.mediaInitialCount === 0) return;
      const binding = active.binding;
      const record = active.record;
      let content = record.history.snapshot().value;
      const currentValue = getAtPath(content, binding.fieldPath);
      const objectGallery = binding.itemKind === 'object' || ['products', 'product-categories'].includes(record.collection);
      const galleryItems = selected.filter((item) => mediaItemRoles(item).includes('gallery')).map((item, index) => objectGallery
        ? { src: item.canonicalPath || item.lease.canonicalPath, alt: item.alt || '', caption: item.caption || '', order: (index + 1) * 10, isActive: true }
        : item.canonicalPath || item.lease.canonicalPath);
      if (record.collection === 'projects') {
        const rawItems = usable.map((item) => ({ src: item.canonicalPath || item.lease.canonicalPath, alt: item.alt || '', caption: item.caption || '' }));
        const presentation = { ...(content.presentation || {}) };
        presentation.publicGallery = selected.filter((item) => mediaItemRoles(item).includes('gallery')).map((item) => item.canonicalPath || item.lease.canonicalPath);
        presentation.archiveCoverMedia = selected.find((item) => mediaItemRoles(item).some((role) => ['cover', 'archive'].includes(role)))?.canonicalPath
          || selected.find((item) => mediaItemRoles(item).some((role) => ['cover', 'archive'].includes(role)))?.lease?.canonicalPath || '';
        presentation.detailHeroMedia = selected.find((item) => mediaItemRoles(item).includes('hero'))?.canonicalPath
          || selected.find((item) => mediaItemRoles(item).includes('hero'))?.lease?.canonicalPath || '';
        presentation.altOverrides = Object.fromEntries(usable.filter((item) => item.alt).map((item) => [item.canonicalPath || item.lease.canonicalPath, item.alt]));
        content = { ...content, gallery: rawItems, presentation };
      } else if (binding.multiple !== false || Array.isArray(currentValue)) {
        content = setAtPath(content, binding.fieldPath, galleryItems);
      } else {
        const first = selected.find((item) => mediaItemRoles(item).includes('gallery')) || selected[0];
        content = setAtPath(content, binding.fieldPath, first ? first.canonicalPath || first.lease.canonicalPath : '');
      }
      if (record.collection !== 'projects') {
        if (binding.coverPath) content = setAtPath(content, binding.coverPath, selected.find((item) => mediaItemRoles(item).includes('cover'))?.canonicalPath || selected.find((item) => mediaItemRoles(item).includes('cover'))?.lease?.canonicalPath || '');
        if (binding.heroPath) content = setAtPath(content, binding.heroPath, selected.find((item) => mediaItemRoles(item).includes('hero'))?.canonicalPath || selected.find((item) => mediaItemRoles(item).includes('hero'))?.lease?.canonicalPath || '');
        if (binding.archivePath) content = setAtPath(content, binding.archivePath, selected.find((item) => mediaItemRoles(item).includes('archive'))?.canonicalPath || selected.find((item) => mediaItemRoles(item).includes('archive'))?.lease?.canonicalPath || '');
      }
      record.stagedMedia = [...(record.stagedMedia || []), ...selected.map((item) => item.lease).filter(Boolean)];
      record.history.commit(content, { label: `Добавить фотографии: ${selected.length}`, force: true });
      await draftStore.put({ repoIdentity: REPO_IDENTITY, collection: record.collection, slug: record.slug, baseRevision: record.revision, schemaVersion: record.schemaVersion, content, stagedMedia: record.stagedMedia });
      await mediaQueueStore.delete(mediaIdentity(binding, record));
      state.mediaQueue = [];
      state.mediaInitialCount = 0;
      state.mediaScheduler = null;
      mediaDialog.close('confirmed');
      notifications.toast(`Фотографии добавлены в браузерный черновик: ${selected.length}. Нажмите «Сохранить», чтобы записать их атомарно.`, 'success');
      projectDraftToFrame();
    } catch (error) {
      notifications.toast(error.message || 'Не удалось подготовить фотографии.', 'error', 0);
      renderMediaQueue();
    }
  }

  function renderPageDialog(query = '') {
    const matches = state.pages.filter((page) => descriptorSearchText(page).includes(String(query).trim().toLocaleLowerCase('ru-RU'))).slice(0, 80);
    pageDialogResults.replaceChildren(...matches.map((page) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 've-dialog-result';
      button.innerHTML = `<span class="ve-dialog-result__icon">${escapeHtml(iconFor(page))}</span><span><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.typeLabel)} · ${escapeHtml(page.route)}</small></span><small>${page.isActive ? '' : 'Скрыта'}</small>`;
      button.addEventListener('click', () => { pageDialog.close(); void openPage(page); });
      return button;
    }));
  }

  function commandItems(query = '') {
    const normalized = String(query).trim().toLocaleLowerCase('ru-RU');
    const actions = [
      { title: 'Сохранить на компьютере', detail: 'Ctrl+S', run: () => void saveAll() },
      { title: 'Открыть публикацию', detail: 'Проверка и тестовый сайт', run: openPublish },
      { title: 'Настройки текущей страницы', detail: 'SEO, адрес и история', run: () => openSettings('general') },
      { title: app.dataset.fullscreen === 'true' ? 'Выйти из полноэкранного canvas' : 'Canvas на весь экран', detail: 'F', run: toggleFullscreen },
      { title: state.mode === 'edit' ? 'Перейти в просмотр' : 'Перейти в редактирование', detail: 'E', run: () => setMode(state.mode === 'edit' ? 'preview' : 'edit') }
    ].filter((item) => !normalized || `${item.title} ${item.detail}`.toLocaleLowerCase('ru-RU').includes(normalized));
    const pages = state.pages.filter((page) => !normalized || descriptorSearchText(page).includes(normalized)).slice(0, 35);
    return { actions, pages };
  }

  function renderCommands(query = '') {
    const { actions, pages } = commandItems(query);
    const fragment = document.createDocumentFragment();
    if (actions.length) {
      const title = document.createElement('div'); title.className = 've-command-group-title'; title.textContent = 'Действия'; fragment.append(title);
      actions.forEach((action) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 've-dialog-result';
        button.innerHTML = `<span class="ve-dialog-result__icon">⌘</span><span><strong>${escapeHtml(action.title)}</strong><small>${escapeHtml(action.detail)}</small></span>`;
        button.addEventListener('click', () => { commandDialog.close(); action.run(); }); fragment.append(button);
      });
    }
    if (pages.length) {
      const title = document.createElement('div'); title.className = 've-command-group-title'; title.textContent = 'Страницы'; fragment.append(title);
      pages.forEach((page) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 've-dialog-result';
        button.innerHTML = `<span class="ve-dialog-result__icon">${escapeHtml(iconFor(page))}</span><span><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.route)}</small></span><small>${escapeHtml(page.typeLabel)}</small>`;
        button.addEventListener('click', () => { commandDialog.close(); void openPage(page); }); fragment.append(button);
      });
    }
    commandResults.replaceChildren(fragment);
  }

  function setViewport(viewport) {
    if (!VIEWPORTS[viewport]) return;
    state.viewport = viewport;
    canvasViewport.dataset.viewport = viewport;
    for (const button of root.querySelectorAll('[data-viewport]')) button.setAttribute('aria-pressed', String(button.dataset.viewport === viewport));
    notifications.announce(`Предпросмотр: ${VIEWPORTS[viewport].label}, ${VIEWPORTS[viewport].width} на ${VIEWPORTS[viewport].height}.`);
    postToFrame('request-geometry');
  }

  function setMode(mode) {
    state.mode = mode === 'preview' ? 'preview' : 'edit';
    frame.tabIndex = state.mode === 'preview' ? 0 : -1;
    app.dataset.mode = state.mode;
    for (const button of root.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
    closeInlineEditor();
    closeInspector();
    postToFrame('mode', { mode: state.mode });
    canvasHint.textContent = state.mode === 'preview' ? 'Просмотр: ссылки и интерактивные элементы работают как на сайте' : 'Нажмите на текст, карточку или фотографию, чтобы изменить';
  }

  function toggleFullscreen() {
    const full = app.dataset.fullscreen === 'true';
    app.dataset.fullscreen = String(!full);
    required(root, '#veFullScreen').textContent = full ? 'На весь экран' : 'Вернуться в редактор';
    postToFrame('request-geometry');
  }

  function runUndo() {
    const recordCandidates = [...state.records.values()]
      .map((record) => ({ record, sequence: (record.undoActionStack || []).at(-1) || -1 }))
      .filter((entry) => entry.sequence >= 0);
    const newestRecord = recordCandidates.sort((left, right) => right.sequence - left.sequence)[0] || null;
    const commandIndex = state.commandUndo.reduce((best, command, index, rows) => command.sequence > (rows[best]?.sequence ?? -1) ? index : best, -1);
    const command = commandIndex >= 0 ? state.commandUndo[commandIndex] : null;
    if (command && command.sequence >= (newestRecord?.sequence ?? -1)) {
      state.commandUndo.splice(commandIndex, 1);
      state.replayingCommand = true;
      try { command.undo(); } finally { state.replayingCommand = false; }
      command.redoReadySequence = ++state.actionSequence;
      state.commandRedo.push(command);
      notifications.announce(`Отменено: ${command.label}`);
    } else newestRecord?.record.history.undo();
    updateChrome();
  }

  function runRedo() {
    const recordCandidates = [...state.records.values()]
      .map((record) => ({ record, readySequence: (record.redoActionStack || []).at(-1)?.readySequence || -1 }))
      .filter((entry) => entry.readySequence >= 0);
    const newestRecord = recordCandidates.sort((left, right) => right.readySequence - left.readySequence)[0] || null;
    const commandIndex = state.commandRedo.reduce((best, command, index, rows) => (command.redoReadySequence || -1) > (rows[best]?.redoReadySequence ?? -1) ? index : best, -1);
    const command = commandIndex >= 0 ? state.commandRedo[commandIndex] : null;
    if (command && (command.redoReadySequence || -1) >= (newestRecord?.readySequence ?? -1)) {
      state.commandRedo.splice(commandIndex, 1);
      state.replayingCommand = true;
      try { command.redo(); } finally { state.replayingCommand = false; }
      command.sequence = ++state.actionSequence;
      state.commandUndo.push(command);
      notifications.announce(`Повторено: ${command.label}`);
    } else newestRecord?.record.history.redo();
    updateChrome();
  }

  function navigateStack(delta) {
    const next = state.navigationIndex + delta;
    if (next < 0 || next >= state.navigationStack.length) return;
    state.navigationIndex = next;
    const page = state.pageByRoute.get(state.navigationStack[next]);
    if (page) void openPage(page, { history: 'none' });
  }

  async function showApp(payload) {
    state.username = payload.username || 'Владелец';
    login.hidden = true;
    app.hidden = false;
    app.dataset.navCollapsed = 'false';
    app.dataset.inspectorOpen = 'false';
    app.dataset.mode = 'edit';
    frame.tabIndex = -1;
    setHumanStatus('saved');
    await Promise.all([loadSummaries(), mediaQueueStore.cleanup({ repoIdentity: REPO_IDENTITY }).catch(() => {})]);
    const initialRoute = normalizeRoute(root.dataset.initialRoute || '/');
    const initialPage = state.pageByRoute.get(initialRoute) || state.pageByRoute.get('/') || state.pages[0];
    await openPage(initialPage);
    const draftCleanup = await draftStore.cleanup({
      repoIdentity: REPO_IDENTITY,
      preserveKeys: [...state.records.values()]
        .filter((record) => record.history?.snapshot().dirty || record.recoveryConflict)
        .map((record) => ({ repoIdentity: REPO_IDENTITY, collection: record.collection, slug: record.slug }))
    }).catch(() => null);
    if (draftCleanup?.removed) {
      const remainingDrafts = await draftStore.list(REPO_IDENTITY).catch(() => []);
      state.draftKeys = new Set(remainingDrafts.map((draft) => recordKey(draft.collection, draft.slug)));
      renderNavigator();
      notifications.toast(`Очищено старых recovery-черновиков: ${draftCleanup.removed}. Текущая открытая правка сохранена. Срок хранения — 90 дней, максимум 160 материалов.`, 'warning', 0);
    }
    const [publishResult, exactResult, historyResult, backupResult] = await Promise.allSettled([
      api.publishOverview(), api.request('/validation/status'), api.history(), api.backupStatus()
    ]);
    if (backupResult.status === 'fulfilled') state.backupStatus = backupResult.value;
    const localSaveEvidence = readLocalJson(storageKey('last-save-evidence'), null);
    const historyEntries = historyResult.status === 'fulfilled' ? historyResult.value?.history || [] : [];
    const latestCommitted = historyEntries.find((entry) => ['committed', 'success'].includes(entry.state || entry.result));
    const rememberedTransactionId = latestCommitted?.transactionId
      || (historyResult.status === 'rejected' ? localSaveEvidence?.transactionId || '' : '');
    if (rememberedTransactionId) state.lastTransactionIds = [rememberedTransactionId];
    if (exactResult.status === 'fulfilled' && exactResult.value?.current) {
      state.exact = exactResult.value.current;
      if (!state.lastTransactionIds.length) state.lastTransactionIds = [state.exact.transactionId];
      if (['queued', 'running'].includes(state.exact.status)) {
        setHumanStatus('checking');
        pollExactValidation(1200, state.exact.runId, state.exact.transactionId);
      } else if (state.exact.status === 'passed'
        && state.exact.current === true
        && state.exact.publishEligible === true
        && state.exact.transactionId === state.lastTransactionIds.at(-1)) setHumanStatus('ready');
      else if (state.exact.status === 'failed') setHumanStatus('failed');
    }
    if (publishResult.status === 'fulfilled') {
      const overview = publishResult.value;
      state.publishOverview = overview;
      const latest = overview.activeJob || overview.latestJob;
      if (latest?.retryable === true) {
        state.publishJob = latest;
        setHumanStatus('publishFailed');
      } else if (latest && publishJobRunning(latest)) {
        state.publishJob = latest;
        setHumanStatus('publishing');
        pollPublishJob(latest.jobId);
      } else if (latest && publishJobVerified(latest)) {
        state.publishJob = latest;
        setHumanStatus('published');
      }
    }
  }

  async function bootstrap() {
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    if (!localHosts.has(location.hostname.toLowerCase())) {
      loginStatus.textContent = 'Редактор запускается только на этом компьютере через локальный ярлык.';
      loginSubmit.disabled = true;
      return;
    }
    try {
      const session = await api.me();
      if (session.authenticated) await showApp(session);
      else { login.hidden = false; app.hidden = true; }
    } catch (error) {
      loginStatus.textContent = error.message || 'Локальная программа не отвечает.';
    }
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginSubmit.disabled = true;
    loginStatus.textContent = 'Проверяем…';
    const form = new FormData(loginForm);
    try {
      const payload = await api.login(form.get('login'), form.get('password'));
      loginStatus.textContent = '';
      await showApp(payload);
    } catch (error) {
      loginStatus.textContent = error.message || 'Не удалось войти.';
    } finally { loginSubmit.disabled = false; }
  });

  navigatorToggle.addEventListener('click', () => {
    const collapsed = app.dataset.navCollapsed === 'true';
    app.dataset.navCollapsed = String(!collapsed);
    navigatorToggle.setAttribute('aria-expanded', String(collapsed));
    navigatorToggle.setAttribute('aria-label', collapsed ? 'Скрыть навигатор' : 'Показать навигатор');
    postToFrame('request-geometry');
  });
  search.addEventListener('input', renderNavigator);
  for (const button of root.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    for (const peer of root.querySelectorAll('[data-filter]')) peer.setAttribute('aria-pressed', String(peer === button));
    renderNavigator();
  });
  for (const button of root.querySelectorAll('[data-viewport]')) button.addEventListener('click', () => setViewport(button.dataset.viewport));
  for (const button of root.querySelectorAll('[data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode));
  for (const button of root.querySelectorAll('[data-settings-tab]')) button.addEventListener('click', () => openSettings(button.dataset.settingsTab, {
    record: state.settingsRecordOverride,
    context: state.settingsContext
  }));
  for (const button of root.querySelectorAll('[data-dialog-close]')) button.addEventListener('click', () => {
    const dialog = button.closest('dialog');
    if (dialog === mediaDialog && state.mediaScheduler?.isRunning()) {
      notifications.toast('Дождитесь завершения текущих файлов или нажмите «Отменить загрузку» внутри очереди.', 'warning');
      return;
    }
    dialog?.close('cancelled');
  });
  required(root, '#vePagePicker').addEventListener('click', () => { pageDialogSearch.value = ''; renderPageDialog(); restoreFocusDialog(pageDialog, document.activeElement); });
  pageDialogSearch.addEventListener('input', () => renderPageDialog(pageDialogSearch.value));
  required(root, '#veCommandOpen').addEventListener('click', () => { commandSearch.value = ''; renderCommands(); restoreFocusDialog(commandDialog, document.activeElement); });
  commandSearch.addEventListener('input', () => renderCommands(commandSearch.value));
  required(root, '#vePageSettings').addEventListener('click', () => openSettings('general'));
  required(root, '#veFooterSettings').addEventListener('click', () => openSettings('general'));
  required(root, '#veGlobalSettings').addEventListener('click', async () => {
    const record = await ensureRecord('site-settings', 'global');
    state.currentBinding = { record, binding: { ownerCollection: 'site-settings', recordSlug: 'global', fieldPath: 'phonePrimary', label: 'Общие настройки', scope: 'global', affectedRoutes: state.pages.filter((page) => page.emitted).map((page) => page.route) } };
    openSettings('general', { record, context: 'global' });
  });
  required(root, '#veInspectorClose').addEventListener('click', closeInspector);
  required(root, '#veInspectorDone').addEventListener('click', closeInspector);
  required(root, '#veRefreshCanvas').addEventListener('click', () => {
    state.frameRevision += 1;
    state.bridgeSequence = -1;
    state.parentSequence = 0;
    frame.src = buildCanvasUrl(state.currentPage);
  });
  required(root, '#veFullScreen').addEventListener('click', toggleFullscreen);
  saveButton.addEventListener('click', () => void saveAll());
  required(root, '#vePublish').addEventListener('click', openPublish);
  statusButton.addEventListener('click', openPublish);
  undoButton.addEventListener('click', runUndo);
  redoButton.addEventListener('click', runRedo);
  back.addEventListener('click', () => navigateStack(-1));
  forward.addEventListener('click', () => navigateStack(1));
  previousMaterial.addEventListener('click', () => {
    const siblings = currentSiblings();
    const index = siblings.findIndex((item) => item.route === state.currentPage?.route);
    if (index > 0) void openPage(siblings[index - 1]);
  });
  nextMaterial.addEventListener('click', () => {
    const siblings = currentSiblings();
    const index = siblings.findIndex((item) => item.route === state.currentPage?.route);
    if (index >= 0 && index < siblings.length - 1) void openPage(siblings[index + 1]);
  });
  required(root, '#veChangesToggle').addEventListener('click', () => {
    const open = changesTray.dataset.open === 'true';
    changesTray.dataset.open = String(!open);
    required(root, '#veChangesToggle').setAttribute('aria-expanded', String(!open));
  });
  mediaConfirm.addEventListener('click', () => void confirmMedia());
  mediaDialog.addEventListener('cancel', (event) => { if (state.mediaScheduler?.isRunning()) event.preventDefault(); });
  mediaDialog.addEventListener('close', () => {
    revokeMediaUrls();
    if (state.mediaQueue.length) void persistMediaQueue();
    state.mediaScheduler = null;
    state.mediaInitialCount = 0;
    state.activeMedia = null;
  });
  window.addEventListener('message', handleBridgeMessage);
  window.addEventListener('resize', debounce(() => postToFrame('request-geometry'), 80));
  window.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    const target = event.target instanceof Element ? event.target : document.activeElement;
    const nativeEditing = target instanceof Element && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('[contenteditable="true"]'));
    const modalOpen = Boolean(document.querySelector('dialog[open]'));
    if (modalOpen && !(modifier && event.key.toLowerCase() === 's')) return;
    if (modifier && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      renderCommands();
      restoreFocusDialog(commandDialog, document.activeElement);
    }
    if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void saveAll(); }
    if (!nativeEditing && modifier && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); runUndo(); }
    if (!nativeEditing && ((modifier && event.shiftKey && event.key.toLowerCase() === 'z') || (modifier && event.key.toLowerCase() === 'y'))) { event.preventDefault(); runRedo(); }
    if (!modifier && event.key.toLowerCase() === 'f' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) toggleFullscreen();
    if (!modifier && event.key.toLowerCase() === 'e' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) setMode(state.mode === 'edit' ? 'preview' : 'edit');
  });
  window.addEventListener('beforeunload', (event) => {
    if (!state.mediaQueue.length && !state.mediaScheduler?.isRunning()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  channel?.addEventListener('message', async (event) => {
    const message = event.data;
    if (!message || message.tabId === tabId || message.type !== 'saved') return;
    for (const update of message.records || []) {
      const key = recordKey(update.collection, update.slug);
      const record = state.records.get(key);
      if (!record) continue;
      if (record.history.snapshot().dirty) {
        state.remoteConflicts.set(key, { mine: record.history.snapshot().value, base: record.loadedContent, currentRevision: update.revision });
        notifications.toast(`«${record.history.snapshot().value.title || record.slug}» сохранён в другой вкладке. Ваш черновик не будет перезаписан.`, 'warning', 0);
      } else {
        const fresh = await readEditorRecord(record).catch(() => null);
        if (fresh) {
          record.revision = fresh.revision;
          record.loadedContent = clone(fresh.content);
          record.history.markBoundary(fresh.content);
        }
      }
    }
  });

  await bootstrap();
}

import { clear, element } from '../ui/dom.mjs';
import { icon } from '../ui/icons.mjs';

const IMAGE_UPLOAD_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const IMAGE_REFERENCE_EXTENSIONS = new Set([...IMAGE_UPLOAD_EXTENSIONS, 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm']);
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const WINDOW_ITEMS = 10;

function clientId() { return crypto.randomUUID(); }
function extension(name) { return String(name || '').split('.').at(-1)?.toLowerCase() || ''; }
function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'размер уже сохранён';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function mediaPath(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return String(value.src || value.image || value.path || '');
}

function displayFilename(value) {
  const pathname = mediaPath(value);
  return pathname.split('/').filter(Boolean).at(-1) || 'Существующий медиафайл';
}

function mediaKind(mediaContext) {
  const role = String(mediaContext?.role || '').toLowerCase();
  const fieldPath = String(mediaContext?.path || '').toLowerCase();
  return role.startsWith('video') || fieldPath.includes('video') ? 'video' : 'image';
}

function incompatiblePathMessage(pathname, kind) {
  const ext = extension(pathname);
  if (kind === 'video' && !VIDEO_EXTENSIONS.has(ext)) return 'Для поля видео выберите MP4 или WebM.';
  if (kind === 'image' && !IMAGE_REFERENCE_EXTENSIONS.has(ext)) return 'Для фото, постера или галереи выберите JPG, PNG, WebP или уже существующий SVG.';
  return '';
}

function preflightFile(file, kind) {
  const ext = extension(file.name);
  if (ext === 'heic' || ext === 'heif') return 'HEIC/HEIF пока не поддерживается. На телефоне экспортируйте фото как JPG или WebP и выберите его снова.';
  if (kind === 'video') return 'Новые видео пока нельзя загружать: безопасная полная проверка и очистка метаданных видео не подключены. Выберите уже сохранённое видео из медиатеки.';
  if (kind === 'image' && !IMAGE_UPLOAD_EXTENSIONS.has(ext)) return 'Для новой фотографии выберите JPG, PNG или WebP. SVG, GIF, PDF, HEIC и архивы запрещены для загрузки.';
  const roleError = incompatiblePathMessage(file.name, kind);
  if (roleError) return `${roleError} SVG, GIF, PDF, HEIC и архивы запрещены для новых загрузок.`;
  if (file.size <= 0) return 'Файл пустой.';
  if (file.size > IMAGE_MAX_BYTES) return 'Фото больше 10 МБ. Экспортируйте уменьшенную JPG/WebP-копию, сохранив исходник отдельно.';
  return '';
}

export function createMediaDialog({ dialog, body, confirmButton, notifications, onConfirm, loadLibrary }) {
  let context = null;
  let queue = [];
  let selectedIndex = -1;
  let coverClientId = '';
  let library = null;
  let libraryOpen = false;
  let busy = false;
  let activeCancel = null;
  let nextSourceOrder = 0;
  const objectUrls = new Set();

  function revokeAll() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }

  function snapshot() {
    return queue.map(({ file, objectUrl, ...item }, index) => ({
      ...item,
      index,
      file: file || null,
      displayName: file?.name || item.existingEntry?.filename || item.existingPath,
      bytes: file?.size || item.existingEntry?.bytes || 1
    }));
  }

  function updateConfirm() {
    confirmButton.disabled = busy || !queue.length || queue.every((item) => item.error);
    confirmButton.textContent = busy
      ? 'Проверяем и загружаем…'
      : queue.length
        ? context?.multiple ? `Применить итоговый порядок (${queue.length})` : 'Добавить в черновик'
        : 'Добавить в черновик';
    body.setAttribute('aria-busy', String(busy));
    for (const control of body.querySelectorAll('button, input, select')) {
      if (control.dataset.mediaCancel === 'true') control.disabled = false;
      else control.disabled = busy || control.disabled;
    }
    for (const control of dialog.querySelectorAll('[data-dialog-close]')) control.disabled = busy;
  }

  function move(index, delta) {
    if (busy) return;
    const target = index + delta;
    if (target < 0 || target >= queue.length) return;
    [queue[index], queue[target]] = [queue[target], queue[index]];
    selectedIndex = target;
    render();
    notifications.announce(`Фото перемещено на позицию ${target + 1}.`);
  }

  function moveTo(index, target) {
    if (busy || index < 0 || index >= queue.length || target < 0 || target >= queue.length || index === target) return;
    const [item] = queue.splice(index, 1);
    queue.splice(target, 0, item);
    selectedIndex = target;
    render();
    notifications.announce(`Фото перемещено на позицию ${target + 1}.`);
  }

  function remove(index) {
    if (busy) return;
    const [removed] = queue.splice(index, 1);
    if (removed?.clientId === coverClientId) coverClientId = '';
    if (removed?.objectUrl) {
      URL.revokeObjectURL(removed.objectUrl);
      objectUrls.delete(removed.objectUrl);
    }
    selectedIndex = Math.min(selectedIndex, queue.length - 1);
    render();
  }

  function addFiles(files) {
    if (busy) return;
    const kind = mediaKind(context);
    const queueLimit = context?.multiple && kind === 'image' ? 50 : 1;
    const incoming = [...files].slice(0, Math.max(0, queueLimit - queue.length));
    for (const file of incoming) {
      const objectUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
      if (objectUrl) objectUrls.add(objectUrl);
      queue.push({ clientId: clientId(), file, objectUrl, error: preflightFile(file, kind), status: 'Готово к проверке', sourceOrder: nextSourceOrder++ });
    }
    if (files.length > incoming.length) notifications.toast(queueLimit === 1
      ? `Для этого поля выбирается только один ${kind === 'video' ? 'видеофайл' : 'файл'}. Уберите текущий элемент, чтобы заменить его.`
      : 'За один раз можно подготовить не более 50 файлов.', { type: 'error' });
    render();
  }

  function addExisting(entry) {
    if (busy) return;
    const roleError = incompatiblePathMessage(entry?.path, mediaKind(context));
    if (roleError) {
      notifications.toast(roleError, { type: 'error' });
      return;
    }
    if ((!context?.multiple || mediaKind(context) === 'video') && queue.length >= 1) {
      notifications.toast('Для этого поля выбирается только один файл. Уберите текущий элемент, чтобы заменить его.', { type: 'info' });
      return;
    }
    if (!entry?.path || queue.some((item) => item.existingPath === entry.path)) return;
    queue.push({
      clientId: clientId(),
      file: null,
      objectUrl: '',
      existingPath: entry.path,
      existingEntry: entry,
      error: '',
      status: 'Будет использован существующий файл',
      sourceOrder: nextSourceOrder++
    });
    render();
  }

  function addCurrentGallery(values) {
    for (const existingValue of Array.isArray(values) ? values : []) {
      const existingPath = mediaPath(existingValue);
      if (!existingPath) continue;
      queue.push({
        clientId: clientId(),
        file: null,
        objectUrl: '',
        existingPath,
        existingValue: structuredClone(existingValue),
        existingEntry: { path: existingPath, filename: displayFilename(existingValue), bytes: 0 },
        error: incompatiblePathMessage(existingPath, mediaKind(context)),
        status: 'Уже находится в галерее',
        sourceOrder: nextSourceOrder++
      });
    }
  }

  async function openLibrary({ page = 1, search = '' } = {}) {
    if (busy || typeof loadLibrary !== 'function') return;
    libraryOpen = true;
    library = { loading: true, page, search, items: [] };
    render();
    try {
      library = { ...await loadLibrary({ page, pageSize: 18, search, usage: 'all' }), loading: false, search };
    } catch (error) {
      library = { loading: false, page, search, items: [], error: error.message || 'Не удалось открыть медиатеку.' };
    }
    render();
  }

  function row(item, index) {
    const previewSource = item.objectUrl || item.existingPath || '';
    const preview = element('span', { className: 'admin-record-row__thumb' }, previewSource
      ? [element('img', { src: previewSource, alt: '' })]
      : [icon(item.file?.type?.startsWith('video/') ? 'media' : 'image')]);
    const displayName = item.file?.name || item.existingEntry?.filename || item.existingPath || 'Медиафайл';
    const bytes = item.file?.size || item.existingEntry?.bytes || 0;
    const status = item.error || item.serverError
      ? element('span', { className: 'admin-badge admin-badge--error', text: item.error || item.serverError })
      : element('span', { className: 'admin-badge admin-badge--success', text: item.status });
    return element('article', {
      className: 'admin-record-row',
      attrs: { 'aria-current': selectedIndex === index ? 'true' : 'false', tabindex: '0', draggable: busy ? 'false' : 'true' },
      on: {
        click: () => { if (busy) return; selectedIndex = index; render(); },
        dragstart: (event) => {
          if (busy) return event.preventDefault();
          event.dataTransfer?.setData('text/plain', item.clientId);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        },
        dragover: (event) => { if (!busy) event.preventDefault(); },
        drop: (event) => {
          event.preventDefault();
          const sourceId = event.dataTransfer?.getData('text/plain');
          moveTo(queue.findIndex((entry) => entry.clientId === sourceId), index);
        }
      }
    }, [
      preview,
      element('div', {}, [element('strong', { text: `${index + 1}. ${displayName}` }), element('small', { text: humanBytes(bytes) }), status]),
      element('div', { className: 'admin-list-editor__actions' }, [
        context?.coverPath ? element('button', {
          className: `admin-btn admin-btn--small${coverClientId === item.clientId ? ' admin-btn--primary' : ''}`,
          attrs: { type: 'button', 'aria-pressed': coverClientId === item.clientId ? 'true' : 'false' },
          on: { click: (event) => { event.stopPropagation(); coverClientId = coverClientId === item.clientId ? '' : item.clientId; render(); } }
        }, [icon('image'), coverClientId === item.clientId ? 'Выбрана обложкой' : 'Сделать обложкой']) : null,
        element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', disabled: index === 0, attrs: { type: 'button', 'aria-label': `Переместить ${displayName} в начало` }, on: { click: (event) => { event.stopPropagation(); moveTo(index, 0); } } }, [icon('arrowUp')]),
        element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', disabled: index === 0, attrs: { type: 'button', 'aria-label': `Поднять ${displayName}` }, on: { click: (event) => { event.stopPropagation(); move(index, -1); } } }, [icon('arrowUp')]),
        element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', disabled: index === queue.length - 1, attrs: { type: 'button', 'aria-label': `Опустить ${displayName}` }, on: { click: (event) => { event.stopPropagation(); move(index, 1); } } }, [icon('arrowDown')]),
        element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', disabled: index === queue.length - 1, attrs: { type: 'button', 'aria-label': `Переместить ${displayName} в конец` }, on: { click: (event) => { event.stopPropagation(); moveTo(index, queue.length - 1); } } }, [icon('arrowDown')]),
        element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', attrs: { type: 'button', 'aria-label': `Убрать ${displayName}` }, on: { click: (event) => { event.stopPropagation(); remove(index); } } }, [icon('trash')])
      ])
    ]);
  }

  function render() {
    clear(body);
    const kind = mediaKind(context);
    const allowsMultiple = Boolean(context?.multiple) && kind === 'image';
    const picker = kind === 'image' ? element('input', {
      attrs: { type: 'file', accept: '.jpg,.jpeg,.png,.webp', multiple: allowsMultiple },
      style: 'position:absolute;opacity:0;pointer-events:none',
      on: { change: (event) => { addFiles(event.currentTarget.files); event.currentTarget.value = ''; } }
    }) : null;
    const pickButton = picker ? element('button', { className: 'admin-btn admin-btn--primary', attrs: { type: 'button' }, on: { click: () => picker.click() } }, [icon('upload'), allowsMultiple ? 'Выбрать несколько фото' : 'Выбрать одно фото']) : null;
    const dropzone = picker ? element('div', {
      className: 'admin-alert',
      attrs: { tabindex: '0', role: 'button', 'aria-label': 'Перетащите фотографии сюда или нажмите, чтобы выбрать' },
      on: {
        click: () => picker.click(),
        keydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); picker.click(); } },
        dragover: (event) => { event.preventDefault(); event.currentTarget.dataset.dragover = 'true'; },
        dragleave: (event) => { delete event.currentTarget.dataset.dragover; },
        drop: (event) => { event.preventDefault(); delete event.currentTarget.dataset.dragover; addFiles(event.dataTransfer?.files || []); }
      }
    }, [icon('upload'), element('p', { text: `Перетащите ${allowsMultiple ? 'фотографии' : 'фотографию'} сюда или нажмите для выбора. Загрузка начнётся только после подтверждения.` })]) : null;
    const uploadControls = picker
      ? [
          picker,
          element('div', { className: 'admin-alert' }, [icon('info'), element('p', { text: 'Начальный порядок получен от устройства. Проверьте его до сохранения. Сервер дополнительно проверит реальные байты, формат и размеры.' })]),
          dropzone
        ]
      : [element('div', { className: 'admin-alert admin-alert--warning' }, [
          icon('warning'),
          element('p', { text: 'Новые видео пока нельзя загружать: безопасная полная проверка и очистка метаданных видео не подключены. Уже сохранённое MP4/WebM можно выбрать из медиатеки.' })
        ])];
    body.append(
      ...uploadControls,
      element('div', { className: 'admin-quick-actions', style: 'margin:16px 0' }, [
        pickButton,
        typeof loadLibrary === 'function' ? element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => void openLibrary({ page: 1, search: library?.search || '' }) } }, [icon(kind === 'video' ? 'media' : 'image'), kind === 'video' ? 'Выбрать сохранённое видео' : 'Добавить из медиатеки']) : null,
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => { queue.sort((left, right) => (left.file?.name || left.existingPath).localeCompare(right.file?.name || right.existingPath, 'ru')); render(); } } }, ['По имени']),
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => { queue = queue.slice().reverse(); render(); } } }, ['Обратный порядок']),
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => { queue.sort((left, right) => left.sourceOrder - right.sourceOrder); render(); } } }, ['Вернуть исходный порядок'])
      ]),
      element('p', { className: 'admin-field__hint', text: kind === 'video'
        ? 'Новые видео не отправляются в staging. Доступен только выбор уже сохранённого canonical MP4/WebM.'
        : `Окна загрузки: до ${WINDOW_ITEMS} файлов, не более двух запросов одновременно. Порядок очереди сохраняется независимо от скорости ответа.` })
    );
    if (busy) {
      body.append(element('div', { className: 'admin-alert admin-alert--warning' }, [
        icon('warning'),
        element('div', { className: 'admin-section-stack' }, [
          element('p', { text: 'Идёт server-side проверка. Можно запросить отмену: уже подтверждённые файлы будут точно сверены по batch status.' }),
          element('button', {
            className: 'admin-btn admin-btn--danger admin-btn--small',
            dataset: { mediaCancel: true },
            attrs: { type: 'button' },
            on: { click: () => {
              activeCancel?.();
              for (const item of queue) {
                if (!item.serverError) item.status = 'Отмена запрошена; уточняем результат…';
              }
              render();
            } }
          }, ['Отменить незавершённые загрузки'])
        ])
      ]));
    }
    if (libraryOpen) {
      const searchInput = element('input', { value: library?.search || '', attrs: { type: 'search', placeholder: 'Имя или путь файла', 'aria-label': 'Поиск в медиатеке' } });
      const libraryBody = element('div', { className: 'admin-media-grid' });
      if (library?.loading) libraryBody.append(element('div', { className: 'admin-skeleton' }));
      else if (library?.error) libraryBody.append(element('div', { className: 'admin-alert admin-alert--error' }, [icon('error'), element('p', { text: library.error })]));
      else for (const entry of library?.items || []) {
        const roleError = incompatiblePathMessage(entry.path, kind);
        libraryBody.append(element('button', {
          className: 'admin-media-item',
          disabled: Boolean(roleError),
          attrs: { type: 'button', title: roleError || entry.path },
          on: { click: () => addExisting(entry) }
        }, [
          element('span', { className: 'admin-media-item__image' }, [element('img', { src: entry.path, alt: '', loading: 'lazy' })]),
          element('span', { className: 'admin-media-item__body' }, [element('strong', { text: entry.filename }), element('small', { text: `${humanBytes(entry.bytes)} · используется в ${entry.usageCount} местах` })])
        ]));
      }
      body.append(element('section', { className: 'admin-card' }, [
        element('div', { className: 'admin-card__header' }, [element('h3', { text: 'Canonical originals' }), element('button', { className: 'admin-btn admin-btn--quiet admin-btn--small', attrs: { type: 'button' }, on: { click: () => { libraryOpen = false; render(); } } }, ['Закрыть'])]),
        element('div', { className: 'admin-card__body admin-section-stack' }, [
          element('div', { className: 'admin-list-editor__footer' }, [searchInput, element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: () => void openLibrary({ page: 1, search: searchInput.value }) } }, ['Найти'])]),
          libraryBody,
          library && library.pages > 1 ? element('div', { className: 'admin-list-editor__footer' }, [
            element('button', { className: 'admin-btn admin-btn--small', disabled: library.page <= 1, attrs: { type: 'button' }, on: { click: () => void openLibrary({ page: library.page - 1, search: library.search }) } }, ['Назад']),
            element('span', { text: `${library.page} / ${library.pages}` }),
            element('button', { className: 'admin-btn admin-btn--small', disabled: library.page >= library.pages, attrs: { type: 'button' }, on: { click: () => void openLibrary({ page: library.page + 1, search: library.search }) } }, ['Дальше'])
          ]) : null
        ])
      ]));
    }
    const list = element('div', { className: 'admin-section-stack', attrs: { 'aria-label': 'Очередь файлов' } }, queue.map(row));
    body.append(queue.length ? list : element('div', { className: 'admin-empty' }, [icon(kind === 'video' ? 'media' : 'image'), element('strong', { text: kind === 'video' ? 'Видео не выбрано' : 'Фотографии ещё не выбраны' }), element('p', { text: kind === 'video' ? 'Выберите уже сохранённое видео из медиатеки.' : 'Файлы остаются в браузере до явного подтверждения. Постоянная бесхозная загрузка не создаётся.' })]));
    updateConfirm();
  }

  async function confirm() {
    if (busy) return;
    const valid = snapshot().filter((item) => !item.error);
    if (!valid.length) return;
    busy = true;
    try {
      queue.forEach((item) => {
        item.serverError = '';
        item.status = item.file ? 'Проверяется сервером…' : 'Сохраняется в итоговом порядке';
      });
      render();
      const result = await onConfirm({
        context,
        items: valid.map((item) => ({ ...item, isCover: item.clientId === coverClientId })),
        onProgress(progress) {
          const item = queue.find((entry) => entry.clientId === progress.clientId);
          if (!item) return;
          item.status = progress.statusLabel || progress.status || item.status;
          if (progress.error?.message) item.serverError = progress.error.message;
          render();
        },
        registerCancel(cancel) { activeCancel = typeof cancel === 'function' ? cancel : null; }
      });
      const omittedDuplicateClientIds = new Set(result?.omittedDuplicateClientIds || []);
      if (omittedDuplicateClientIds.size) {
        for (const item of queue) {
          if (!omittedDuplicateClientIds.has(item.clientId) || !item.objectUrl) continue;
          URL.revokeObjectURL(item.objectUrl);
          objectUrls.delete(item.objectUrl);
        }
        queue = queue.filter((item) => !omittedDuplicateClientIds.has(item.clientId));
        if (!queue.some((item) => item.clientId === coverClientId)) coverClientId = '';
      }
      const failures = new Map([
        ...(result?.failures || []).map((item) => [item.clientId, item.message || 'Не удалось загрузить файл.']),
        ...queue.filter((item) => item.error).map((item) => [item.clientId, item.error])
      ]);
      if (failures.size) {
        const resolvedItems = new Map((result?.resolvedItems || []).map((item) => [item.clientId, item.canonicalPath]));
        for (const item of queue) {
          item.serverError = failures.get(item.clientId) || '';
          const canonicalPath = resolvedItems.get(item.clientId);
          if (!canonicalPath || failures.has(item.clientId)) continue;
          item.existingPath = canonicalPath;
          item.existingEntry = { path: canonicalPath, filename: item.file?.name || displayFilename(canonicalPath), bytes: item.file?.size || 0 };
          item.file = null;
          item.error = '';
          item.status = 'Уже добавлен в черновик; повторно не загружается';
        }
        coverClientId = queue.some((item) => item.clientId === coverClientId) ? coverClientId : '';
        busy = false;
        activeCancel = null;
        render();
        notifications.toast(`Часть файлов добавлена. Требуют внимания: ${failures.size}. Неподдерживаемые файлы удалите из очереди или выберите подходящую копию; ошибки загрузки можно повторить.`, { type: 'error', duration: 0 });
      } else {
        busy = false;
        activeCancel = null;
        dialog.close('confirmed');
      }
    } catch (error) {
      busy = false;
      activeCancel = null;
      render();
      notifications.toast(error.message || 'Не удалось добавить фотографии.', { type: 'error', duration: 0 });
    } finally {
      if (dialog.open) updateConfirm();
    }
  }

  confirmButton.addEventListener('click', confirm);
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    revokeAll();
    queue = [];
    selectedIndex = -1;
    coverClientId = '';
    library = null;
    libraryOpen = false;
    busy = false;
    activeCancel = null;
    context = null;
    clear(body);
  });

  return Object.freeze({
    open(nextContext = null) {
      context = nextContext;
      queue = [];
      nextSourceOrder = 0;
      selectedIndex = -1;
      coverClientId = '';
      library = null;
      libraryOpen = false;
      busy = false;
      activeCancel = null;
      addCurrentGallery(context?.multiple ? context?.existing : []);
      const currentCoverPath = context?.coverPath ? mediaPath(context?.content?.[context.coverPath]) : '';
      if (currentCoverPath) coverClientId = queue.find((item) => item.existingPath === currentCoverPath)?.clientId || '';
      render();
      notifications.openDialog(dialog, { initialFocus: body.querySelector('button') });
    },
    snapshot
  });
}

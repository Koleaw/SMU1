import { clear, element } from '../ui/dom.mjs';
import { icon } from '../ui/icons.mjs';
import { renderEntityList } from '../lists/entity-list.mjs';
import { assessCompleteness, renderRecordEditor } from '../editors/record-editor.mjs';
import { COLLECTION_LABELS, humanPresentationType, isVisibleRecord, publicRouteFor } from '../metadata/editor-fields.mjs';

function countDiff(left, right) {
  if (Object.is(left, right)) return 0;
  if (typeof left !== typeof right || left === null || right === null || typeof left !== 'object') return 1;
  if (Array.isArray(left) !== Array.isArray(right)) return 1;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let count = 0;
  for (const key of keys) {
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) count += 1;
    else count += countDiff(left[key], right[key]);
  }
  return count;
}

function stateBox(label, value, detail, type = '') {
  return element('div', { className: 'admin-state-box' }, [
    element('strong', {}, [type ? element('span', { className: `admin-badge admin-badge--${type}`, text: value }) : value]),
    element('small', { text: detail })
  ]);
}

function exactStatus(collection, content, dirty, conflict) {
  if (conflict) return ['Конфликт версии', 'Откройте актуальную версию или скачайте свой черновик.', 'error'];
  if (dirty) return ['Есть несохранённые изменения', 'Черновик сохранён в этом браузере.', 'warning'];
  const visible = isVisibleRecord(collection, content);
  if (visible === true) return ['Видна на сайте', 'Сохранено на компьютере.', 'success'];
  if (visible === false) return ['Скрыта с сайта', 'Сохранено на компьютере.', 'info'];
  return ['Сохранено на компьютере', 'Для этой записи нет переключателя видимости.', 'success'];
}

function editorSubtitle(collection, content) {
  if (collection === 'products') return `${COLLECTION_LABELS[collection]} · ${humanPresentationType(content.presentationType)}`;
  return COLLECTION_LABELS[collection] || collection;
}

export function renderEditorWorkspace({
  root,
  view,
  summaries,
  drafts,
  reorderDrafts,
  current,
  relations,
  siteBase = '/',
  previewStatus,
  resolveMediaSource,
  actions
}) {
  clear(root);
  root.className = 'admin-main admin-main--with-list';
  const listRoot = element('aside', { className: 'admin-entity-list', attrs: { 'aria-label': `Список: ${view.title}` }, dataset: { mobileState: current ? 'hidden' : 'visible' } });
  const editorRoot = element('section', { className: 'admin-editor', attrs: { 'aria-label': 'Редактор записи' }, dataset: { mobileState: current ? 'visible' : 'hidden' } });
  root.append(listRoot, editorRoot);

  renderEntityList({
    root: listRoot,
    view,
    summaries,
    drafts,
    reorderDrafts,
    selected: current,
    onSelect: actions.select,
    onCreate: actions.create,
    onBack: actions.back,
    onReorder: actions.reorder,
    onSaveOrder: actions.saveOrder,
    onCancelOrder: actions.cancelOrder
  });

  if (!current) {
    editorRoot.dataset.mobileState = 'hidden';
    editorRoot.append(element('div', { className: 'admin-page', style: 'display:grid;place-items:center;min-height:calc(100vh - var(--admin-topbar-height))' }, [
      element('div', { className: 'admin-empty' }, [icon('pages'), element('strong', { text: 'Выберите запись слева' }), element('p', { text: 'Список загружает только краткие сведения. Полная запись откроется по выбору.' })])
    ]));
    return Object.freeze({ sync() {}, focusField() {} });
  }

  if (current.loading) {
    editorRoot.append(element('div', { className: 'admin-page admin-loading' }, Array.from({ length: 8 }, () => element('div', { className: 'admin-skeleton' }))));
    return Object.freeze({ sync() {}, focusField() {} });
  }

  if (current.error) {
    editorRoot.append(element('div', { className: 'admin-page' }, [element('div', { className: 'admin-alert admin-alert--error' }, [icon('error'), element('div', {}, [element('p', { text: current.error }), element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: actions.reload } }, ['Повторить'])])])]));
    return Object.freeze({ sync() {}, focusField() {} });
  }

  const header = element('header', { className: 'admin-editor__header' });
  const title = element('h1', { text: current.content.title || current.slug });
  const routeText = element('span');
  const materialStates = element('div', { className: 'admin-editor__states' });
  const actionBar = element('div', { className: 'admin-editor__actions' });
  const body = element('div', { className: 'admin-editor__body' });
  const completenessAlert = element('div');
  const dirtyCount = element('span', { className: 'admin-badge' });
  const saveButton = element('button', { className: 'admin-btn admin-btn--primary', attrs: { type: 'button' }, on: { click: actions.save } }, [icon('save'), element('span', { text: 'Сохранить на компьютере' })]);
  const mobileSaveButton = element('button', { className: 'admin-btn admin-btn--primary', attrs: { type: 'button' }, on: { click: actions.save } }, [icon('save'), element('span', { text: 'Сохранить на компьютере' })]);
  const mobileResetButton = element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: actions.reset } }, ['Отменить']);
  const undoButton = element('button', { className: 'admin-btn admin-btn--icon', attrs: { type: 'button', title: 'Отменить последнее действие (Ctrl/Cmd+Z)', 'aria-label': 'Отменить последнее действие' }, on: { click: actions.undo } }, [icon('undo')]);
  const redoButton = element('button', { className: 'admin-btn admin-btn--icon', attrs: { type: 'button', title: 'Вернуть действие (Ctrl/Cmd+Shift+Z)', 'aria-label': 'Вернуть действие' }, on: { click: actions.redo } }, [icon('redo')]);
  const resetButton = element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: actions.reset } }, ['Отменить изменения']);
  const localButton = element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: actions.openLocal } }, [icon('external'), element('span', { text: 'Открыть локальную страницу' })]);
  const deployedButton = element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: actions.openDeployed } }, [icon('external'), element('span', { text: 'Открыть на тестовом сайте' })]);
  const hideButton = isVisibleRecord(current.collection, current.content) !== null
    ? element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: actions.hide } }, ['Скрыть с сайта'])
    : null;
  const duplicateButton = ['products', 'projects'].includes(current.collection)
    ? element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: actions.duplicate } }, [icon('copy'), 'Создать копию'])
    : null;

  actionBar.append(saveButton, undoButton, redoButton, resetButton, localButton, deployedButton, hideButton);
  header.append(
    element('button', { className: 'admin-btn admin-btn--quiet admin-mobile-only', attrs: { type: 'button' }, on: { click: actions.back } }, [icon('arrowLeft'), view.title]),
    element('div', { className: 'admin-editor__identity' }, [
      element('div', {}, [title, element('p', { className: 'admin-editor__meta' }, [element('span', { text: editorSubtitle(current.collection, current.content) }), routeText, dirtyCount])]),
      materialStates
    ]),
    actionBar
  );
  editorRoot.append(header, body);

  let editor = null;
  const technicalDetails = element('details', { className: 'admin-details' }, [
    element('summary', { text: 'Технические детали' }),
    element('div', { className: 'admin-details__body admin-section-stack' }, [
      element('p', { className: 'admin-field__hint', text: 'Внутренние ключи и JSON приведены для диагностики. Неизвестные legacy-поля сохраняются; обычная форма не обещает для них визуальный результат.' }),
      duplicateButton,
      element('pre', { className: 'admin-json-editor', attrs: { tabindex: '0', 'aria-label': 'JSON текущего черновика' } }),
      element('div', { className: 'admin-alert admin-alert--warning' }, [icon('warning'), element('p', { text: 'Переименование адреса и окончательное удаление доступны только после server-side проверки всех связей и создания recoverable history.' })]),
      element('div', { className: 'admin-list-editor__footer' }, [
        element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: actions.rename } }, ['Проверить переименование адреса']),
        element('button', { className: 'admin-btn admin-btn--danger admin-btn--small', attrs: { type: 'button' }, on: { click: actions.hardDelete } }, [icon('trash'), 'Окончательно удалить…'])
      ])
    ])
  ]);
  const rawJson = technicalDetails.querySelector('pre');

  function renderCompleteness(content) {
    const report = assessCompleteness(current.collection, content, relations);
    clear(completenessAlert);
    const issues = [...report.saveBlockers, ...report.publicBlockers, ...report.recommendations];
    if (!issues.length) {
      completenessAlert.className = 'admin-alert admin-alert--success';
      completenessAlert.append(icon('check'), element('p', { text: 'Основные данные заполнены. Можно сохранить и проверить локальную страницу.' }));
    } else {
      const isBlocking = report.saveBlockers.length > 0 || report.publicBlockers.length > 0;
      completenessAlert.className = `admin-alert ${isBlocking ? 'admin-alert--error' : 'admin-alert--warning'}`;
      const first = issues[0];
      completenessAlert.append(icon(isBlocking ? 'error' : 'warning'), element('div', {}, [
        element('p', { text: report.saveBlockers.length
          ? `Нельзя сохранить: ${report.saveBlockers.length} обязательных полей.`
          : report.publicBlockers.length
            ? `Нельзя сохранить материал как видимый: условий показа не выполнено — ${report.publicBlockers.length}. Заполните их или временно выключите видимость.`
            : `Есть ${issues.length} рекомендаций.` }),
        element('button', { className: 'admin-btn admin-btn--quiet admin-btn--small', text: first.message, attrs: { type: 'button' }, on: { click: () => editor?.focusField(first.path) } })
      ]));
    }
    saveButton.disabled = current.saving || !report.canSave;
    mobileSaveButton.disabled = current.saving || !report.canSave;
    return report;
  }

  function sync(snapshot, reason = 'external') {
    const content = snapshot.value;
    current.content = content;
    title.textContent = content.title || current.slug;
    const route = publicRouteFor(current.collection, content, relations);
    routeText.textContent = route ? `Путь: ${route}` : 'Публичный путь не применяется';
    const changed = countDiff(current.loadedContent, content);
    dirtyCount.textContent = snapshot.dirty ? `Изменено полей: ${changed}` : 'Нет несохранённых изменений';
    dirtyCount.className = `admin-badge ${snapshot.dirty ? 'admin-badge--warning' : 'admin-badge--success'}`;
    clear(materialStates);
    const [material, detail, type] = exactStatus(current.collection, content, snapshot.dirty, current.conflict);
    const effectivePreviewStatus = snapshot.dirty || current.isNew ? { status: 'not-sent' } : previewStatus;
    const exactCopy = {
      queued: ['Проверка в очереди', 'Сохранение уже на компьютере; exact build начнётся в фоне.'],
      running: ['Проверяется', 'Сохранение уже на компьютере; проверяется точный результат сайта.'],
      ready: ['Готово к публикации', 'Exact-проверка текущей редакции пройдена.'],
      failed: ['Сохранено, проверка не прошла', 'Локальные данные целы; тестовая публикация заблокирована.'],
      stale: ['Проверка устарела', 'Повторите exact-проверку текущего сохранения.']
    }[effectivePreviewStatus?.status];
    const exactType = effectivePreviewStatus?.status === 'failed'
      ? 'error'
      : effectivePreviewStatus?.status === 'stale' ? 'warning' : 'info';
    materialStates.append(
      stateBox('Состояние материала', material, detail, type),
      stateBox(
        'Состояние тестового сайта',
        exactCopy?.[0] || (effectivePreviewStatus?.status === 'deploy-success' ? 'Тестовый сайт обновлён' : ['preparing', 'local-gates', 'committed', 'pushed', 'workflow-queued', 'building'].includes(effectivePreviewStatus?.status) ? 'Идёт обновление preview' : effectivePreviewStatus?.status === 'failure' ? 'Обновление остановлено' : 'Не отправлено в preview'),
        exactCopy?.[1] || (effectivePreviewStatus?.status === 'deploy-success' ? 'Точная проверенная версия.' : effectivePreviewStatus?.status === 'failure' ? 'Локальные данные не потеряны.' : 'Сохранение не отправляет данные в интернет.'),
        exactCopy ? exactType : effectivePreviewStatus?.status === 'deploy-success' ? 'success' : effectivePreviewStatus?.status === 'failure' ? 'error' : 'info'
      )
    );
    undoButton.disabled = !snapshot.canUndo || current.saving;
    redoButton.disabled = !snapshot.canRedo || current.saving;
    resetButton.disabled = !snapshot.dirty || current.saving;
    mobileResetButton.disabled = !snapshot.dirty || current.saving;
    if (hideButton) hideButton.hidden = isVisibleRecord(current.collection, content) !== true;
    saveButton.querySelector('span').textContent = current.saving ? 'Сохраняем…' : current.isNew ? 'Создать на компьютере' : 'Сохранить на компьютере';
    mobileSaveButton.querySelector('span').textContent = current.saving ? 'Сохраняем…' : current.isNew ? 'Создать на компьютере' : 'Сохранить на компьютере';
    rawJson.textContent = JSON.stringify(content, null, 2);
    renderCompleteness(content);
    editor?.sync(content, reason);
  }

  body.append(completenessAlert);
  const editorFieldsRoot = element('div', { className: 'admin-section-stack' });
  body.append(editorFieldsRoot, technicalDetails);
  editor = renderRecordEditor({
    root: editorFieldsRoot,
    collection: current.collection,
    content: current.content,
    relations,
    update: actions.update,
    onMediaRequest: actions.media,
    getContent: () => current.history.snapshot().value,
    resolveMediaSource,
    isNew: current.isNew
  });
  sync(current.history.snapshot(), 'initial');

  const mobileActions = element('div', { className: 'admin-mobile-actionbar' }, [
    mobileSaveButton,
    mobileResetButton
  ]);
  editorRoot.append(mobileActions);

  return Object.freeze({ sync, focusField: (path) => editor.focusField(path) });
}

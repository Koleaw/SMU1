import { clear, element, formatHumanTime } from '../ui/dom.mjs';
import { icon } from '../ui/icons.mjs';
import { COLLECTION_LABELS } from '../metadata/editor-fields.mjs';

function activityRow({ title, subtitle, status, statusType = 'info', onOpen }) {
  const copy = element('div', {}, [element('strong', { text: title }), element('small', { text: subtitle })]);
  const badge = element('span', { className: `admin-badge admin-badge--${statusType}`, text: status });
  return element(onOpen ? 'button' : 'div', {
    className: 'admin-activity',
    attrs: onOpen ? { type: 'button' } : {},
    style: onOpen ? 'width:100%;border:0;background:transparent;text-align:left;cursor:pointer' : '',
    on: onOpen ? { click: onOpen } : {}
  }, [copy, badge]);
}

function quickAction(label, iconName, onClick, primary = false) {
  return element('button', {
    className: `admin-btn${primary ? ' admin-btn--primary' : ''}`,
    attrs: { type: 'button' },
    on: { click: onClick }
  }, [icon(iconName), label]);
}

export function renderOverview({
  root,
  summaries,
  drafts,
  history,
  previewStatus,
  onOpenRecord,
  onCreate,
  onMedia,
  onPreview,
  onSearch
}) {
  clear(root);
  root.className = 'admin-page';
  const searchInput = element('input', {
    attrs: { type: 'search', placeholder: 'Найти страницу, товар или объект', 'aria-label': 'Поиск по всему сайту' },
    on: { input: (event) => onSearch(event.currentTarget.value) }
  });
  const search = element('div', { className: 'admin-search' }, [icon('search'), searchInput, element('kbd', { text: 'Ctrl + K' })]);
  const draftRows = drafts.slice(0, 6).map((draft) => activityRow({
    title: draft.content?.title || draft.slug,
    subtitle: `${COLLECTION_LABELS[draft.collection] || draft.collection} · изменён ${formatHumanTime(draft.updatedAt)}`,
    status: 'Черновик в браузере',
    statusType: 'warning',
    onOpen: () => onOpenRecord({ collection: draft.collection, slug: draft.slug })
  }));
  const historyRows = history.slice(0, 6).map((entry) => activityRow({
    title: entry.metadata?.userSummary || `Сохранение ${entry.transactionId?.slice(0, 8) || ''}`,
    subtitle: `${entry.changedPaths?.length || 0} файл(а) · ${formatHumanTime(entry.updatedAt)}`,
    status: 'Сохранено на компьютере',
    statusType: 'success'
  }));

  const main = element('div', { className: 'admin-overview-main' }, [
    search,
    element('div', { className: 'admin-quick-actions' }, [
      quickAction('Новый товар', 'box', () => onCreate('products')),
      quickAction('Новый объект', 'projects', () => onCreate('projects')),
      quickAction('Загрузить фотографии', 'upload', onMedia, true)
    ]),
    element('section', { className: 'admin-card' }, [
      element('div', { className: 'admin-card__header' }, [element('div', {}, [element('h2', { text: 'Несохранённые черновики' }), element('p', { text: 'Хранятся в этом браузере и ещё не записаны в общие файлы сайта.' })])]),
      element('div', { className: 'admin-card__body' }, draftRows.length ? draftRows : [element('div', { className: 'admin-empty' }, [icon('check'), element('strong', { text: 'Несохранённых черновиков нет' }), element('p', { text: 'Изменения появятся здесь до нажатия «Сохранить на компьютере».' })])])
    ]),
    element('section', { className: 'admin-card' }, [
      element('div', { className: 'admin-card__header' }, [element('div', {}, [element('h2', { text: 'Последние локальные сохранения' }), element('p', { text: 'Это история общих изменений на компьютере, а не история браузерной кнопки «Отменить».' })])]),
      element('div', { className: 'admin-card__body' }, historyRows.length ? historyRows : [element('div', { className: 'admin-empty' }, [icon('history'), element('strong', { text: 'История пока пуста' }), element('p', { text: 'После первого безопасного сохранения здесь появится запись для восстановления.' })])])
    ])
  ]);

  const previewState = previewStatus?.status || 'not-sent';
  const previewCopy = {
    'deploy-success': ['Тестовый сайт обновлён', 'Последняя точная версия собрана, развёрнута и открывается.', 'success'],
    empty: ['Изменения уже опубликованы', 'Новая версия не потребовалась.', 'success'],
    preparing: ['Подготовка точной версии', 'Можно продолжать локальное редактирование.', 'info'],
    'local-gates': ['Идут локальные проверки', 'Точная версия проверяется в чистой копии.', 'info'],
    committed: ['Проверенная версия готова', 'Удалённые ветки ещё не изменены.', 'info'],
    pushed: ['Версия отправлена', 'Ожидаем GitHub Actions и Pages.', 'info'],
    'workflow-queued': ['В очереди GitHub Actions', 'Ожидаем сборку именно этой версии.', 'info'],
    building: ['Тестовый сайт собирается', 'Можно продолжать локальное редактирование.', 'info'],
    'unknown-network-result': ['Уточняется результат сети', 'Админка сверяет обе тестовые ветки без создания второй версии.', 'warning'],
    failure: ['Обновление остановлено', 'Локальные сохранения не потеряны. Откройте отчёт в разделе тестового сайта.', 'error'],
    'not-sent': ['Есть локальные изменения', 'Они не отправляются в интернет без отдельного подтверждения.', 'warning']
  }[previewState] || ['Состояние проверяется', 'Дождитесь ответа GitHub Pages.', 'info'];
  const side = element('aside', { className: 'admin-overview-side' }, [
    element('section', { className: 'admin-card' }, [
      element('div', { className: 'admin-card__header' }, [element('h2', { text: 'Состояние тестового сайта' })]),
      element('div', { className: 'admin-card__body admin-section-stack' }, [
        element('span', { className: `admin-badge admin-badge--${previewCopy[2]}`, text: previewCopy[0] }),
        element('p', { text: previewCopy[1], style: 'margin:0;color:var(--admin-text-muted)' }),
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: onPreview } }, [icon('preview'), 'Открыть тестовый сайт'])
      ])
    ]),
    element('section', { className: 'admin-card' }, [
      element('div', { className: 'admin-card__header' }, [element('h2', { text: 'Как устроено сохранение' })]),
      element('div', { className: 'admin-card__body' }, [
        element('ul', { className: 'admin-status-list' }, [
          element('li', {}, [icon('undo'), element('div', {}, [element('strong', { text: 'Черновик в браузере' }), element('small', { text: 'Виден только в этом браузере до сохранения.' })])]),
          element('li', {}, [icon('save'), element('div', {}, [element('strong', { text: 'Сохранено на компьютере' }), element('small', { text: 'Общее локальное состояние, GitHub не вызывается.' })])]),
          element('li', {}, [icon('preview'), element('div', {}, [element('strong', { text: 'Тестовый сайт' }), element('small', { text: 'Обновляется только отдельным действием и после проверок.' })])])
        ])
      ])
    ])
  ]);

  root.append(
    element('div', { className: 'admin-page__heading' }, [element('div', {}, [element('h1', { text: 'Обзор' }), element('p', { text: 'Найдите материал, продолжите черновик или выполните понятное действие.' })])]),
    element('div', { className: 'admin-overview-grid' }, [main, side])
  );
  return Object.freeze({ focusSearch: () => searchInput.focus() });
}

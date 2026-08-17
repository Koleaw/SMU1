import { clear, element, formatHumanTime } from '../ui/dom.mjs';
import { icon } from '../ui/icons.mjs';

const STATUS_COPY = Object.freeze({
  preparing: ['Подготовка', 'Фиксируем точный список выбранных локальных сохранений.'],
  'local-gates': ['Идут локальные проверки', 'Точная версия проверяется в независимой чистой копии.'],
  committed: ['Проверенная версия готова', 'Удалённые ветки ещё не изменены.'],
  pushed: ['Отправлено в GitHub', 'Обе тестовые ветки указывают на одну проверенную версию.'],
  'workflow-queued': ['В очереди GitHub Actions', 'Ожидаем начало сборки именно этой версии.'],
  building: ['Тестовый сайт собирается', 'Предыдущая успешная версия остаётся доступна.'],
  'deploy-success': ['Тестовый сайт обновлён', 'Workflow, Pages deployment и live-проверка точной версии успешны.'],
  failure: ['Обновление остановлено', 'Локальные сохранения целы. Если exact-версия уже отправлена, её можно безопасно проверить повторно без нового коммита; иначе исправьте причину и подготовьте новый план.'],
  'unknown-network-result': ['Результат сети уточняется', 'Админка сверяет обе удалённые ветки; повторная версия не создаётся.'],
  empty: ['Изменения уже опубликованы', 'Новая версия не потребовалась: выбранные данные совпали с тестовым сайтом.'],
  'not-sent': ['Не отправлено в preview', 'Сохранение на компьютере никогда не публикует сайт автоматически.']
});

const BUSY_STATUSES = new Set([
  'preparing', 'local-gates', 'committed', 'pushed', 'workflow-queued', 'building', 'unknown-network-result'
]);

function currentJob(overview) {
  return overview?.activeJob || overview?.latestJob || null;
}

function statusCard(job, overview, { onRefresh, onRetry, onDownloadReport }) {
  const state = job?.status || 'not-sent';
  const [title, description] = STATUS_COPY[state] || STATUS_COPY['not-sent'];
  const details = [];
  if (job?.testedSha) details.push(`Версия: ${job.testedSha.slice(0, 12)}`);
  if (job?.updatedAt) details.push(formatHumanTime(job.updatedAt));
  const actions = [
    element('button', {
      className: 'admin-btn',
      attrs: { type: 'button' },
      on: { click: onRefresh }
    }, ['Обновить состояние'])
  ];
  if (job?.retryable === true && job?.jobId) {
    actions.push(element('button', {
      className: 'admin-btn admin-btn--primary',
      attrs: { type: 'button' },
      on: { click: () => onRetry(job.jobId) }
    }, [state === 'failure' ? 'Повторить exact-SHA безопасно' : 'Сверить и повторить безопасно']));
  }
  if (job?.jobId && ['failure', 'unknown-network-result', 'deploy-success'].includes(state)) {
    actions.push(element('button', {
      className: 'admin-btn',
      attrs: { type: 'button' },
      on: { click: () => onDownloadReport(job.jobId) }
    }, ['Скачать отчёт']));
  }
  return element('section', { className: 'admin-card', attrs: { 'aria-live': 'polite' } }, [
    element('div', { className: 'admin-card__header' }, [element('h2', { text: title })]),
    element('div', { className: 'admin-card__body admin-section-stack' }, [
      element('p', { text: description, style: 'margin:0;color:var(--admin-text-muted)' }),
      job?.error?.message ? element('div', { className: 'admin-alert admin-alert--error' }, [icon('warning'), element('p', { text: job.error.message })]) : null,
      details.length ? element('small', { text: details.join(' · ') }) : null,
      overview?.lastSuccessfulPreviewSHA
        ? element('small', { text: `Последняя доказанно успешная версия: ${overview.lastSuccessfulPreviewSHA.slice(0, 12)}` })
        : null,
      element('div', { className: 'admin-heading-actions' }, actions)
    ])
  ]);
}

export function renderPublishPanel({
  root,
  overview = {},
  selectedTransactionIds = [],
  onSelectionChange,
  onRefresh,
  onPublish,
  onRetry,
  onOpenPreview,
  onDownloadReport
}) {
  clear(root);
  root.className = 'admin-page';

  const transactions = Array.isArray(overview.transactions) ? overview.transactions : [];
  const ready = transactions.filter((entry) => entry.published !== true);
  const published = transactions.filter((entry) => entry.published === true);
  const readyIds = new Set(ready.map((entry) => entry.transactionId));
  const selection = new Set(selectedTransactionIds.filter((id) => readyIds.has(id)));
  const list = element('div', { className: 'admin-section-stack' });
  const job = currentJob(overview);
  const state = job?.status || 'not-sent';
  const publishButton = element('button', {
    className: 'admin-btn admin-btn--primary',
    attrs: { type: 'button' },
    on: { click: () => onPublish([...selection]) }
  }, [icon('upload'), 'Проверить план публикации']);

  function syncPublishButton() {
    publishButton.disabled = ready.length === 0 || selection.size === 0 || BUSY_STATUSES.has(state);
  }

  if (!ready.length) {
    list.append(element('div', { className: 'admin-empty' }, [
      icon('check'),
      element('strong', { text: 'Нет неопубликованных локальных сохранений' }),
      element('p', { text: 'Сначала сохраните изменение на компьютере. Оно появится здесь отдельной целой транзакцией.' })
    ]));
  } else {
    for (const entry of ready) {
      const label = entry.summary || entry.transactionId;
      const checkbox = element('input', {
        attrs: { type: 'checkbox', 'aria-label': `Выбрать: ${label}` },
        checked: selection.has(entry.transactionId),
        on: {
          change: (event) => {
            if (event.currentTarget.checked) selection.add(entry.transactionId);
            else selection.delete(entry.transactionId);
            onSelectionChange?.([...selection]);
            syncPublishButton();
          }
        }
      });
      list.append(element('label', { className: 'admin-switch' }, [
        element('span', { className: 'admin-switch__copy' }, [
          element('strong', { text: label }),
          element('small', {
            text: `${entry.changedPaths?.length || 0} файл(а) · ${entry.affectedRoutes?.length || 0} маршрут(а) · ${formatHumanTime(entry.committedAt)}`
          })
        ]),
        checkbox,
        element('span', { className: 'admin-switch__control', attrs: { 'aria-hidden': 'true' } })
      ]));
    }
  }
  syncPublishButton();

  root.append(
    element('div', { className: 'admin-page__heading' }, [
      element('div', {}, [
        element('h1', { text: 'Тестовый сайт' }),
        element('p', { text: 'Сначала изучите точный план, затем отдельным подтверждением запустите проверки и обновление preview. Production/main недоступен.' })
      ]),
      element('div', { className: 'admin-heading-actions' }, [
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: onRefresh } }, ['Обновить']),
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: onOpenPreview } }, [icon('external'), 'Открыть тестовый сайт'])
      ])
    ]),
    element('div', { className: 'admin-overview-grid' }, [
      element('div', { className: 'admin-overview-main' }, [
        element('section', { className: 'admin-card' }, [
          element('div', { className: 'admin-card__header' }, [
            element('div', {}, [
              element('h2', { text: 'Готовые локальные изменения' }),
              element('p', { text: 'Публикуются только целые сохранения. Зависимости будут добавлены в план автоматически и показаны до подтверждения.' })
            ]),
            ready.length ? element('div', { className: 'admin-heading-actions' }, [
              element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: () => {
                const ids = ready.map((entry) => entry.transactionId);
                onSelectionChange?.(ids);
                renderPublishPanel({ root, overview, selectedTransactionIds: ids, onSelectionChange, onRefresh, onPublish, onRetry, onOpenPreview, onDownloadReport });
              } } }, ['Выбрать все готовые']),
              element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: () => {
                onSelectionChange?.([]);
                renderPublishPanel({ root, overview, selectedTransactionIds: [], onSelectionChange, onRefresh, onPublish, onRetry, onOpenPreview, onDownloadReport });
              } } }, ['Снять выбор'])
            ]) : null
          ]),
          element('div', { className: 'admin-card__body' }, [list])
        ]),
        element('div', { className: 'admin-alert admin-alert--warning' }, [
          icon('warning'),
          element('p', { text: 'Тестовый GitHub Pages закрыт от индексации, но не является приватным. Не публикуйте секреты, персональные данные и конфиденциальные документы.' })
        ]),
        published.length
          ? element('details', { className: 'admin-details' }, [
              element('summary', { text: `Уже опубликованные сохранения: ${published.length}` }),
              element('div', { className: 'admin-details__body admin-section-stack' }, published.slice(0, 20).map((entry) =>
                element('p', { text: `${entry.summary || entry.transactionId} · ${formatHumanTime(entry.committedAt)}` })
              ))
            ])
          : null,
        element('details', { className: 'admin-details' }, [
          element('summary', { text: 'Что именно доказывает публикация' }),
          element('div', { className: 'admin-details__body' }, [
            element('p', { text: 'Админка формирует content-only commit в отдельном индексе, проверяет его в независимой чистой копии, затем одной atomic-командой направляет ветки v4-product-final-candidate и preview на один SHA. Ветка main не меняется.' })
          ])
        ])
      ]),
      element('aside', { className: 'admin-overview-side' }, [
        statusCard(job, overview, { onRefresh, onRetry, onDownloadReport }),
        publishButton
      ])
    ])
  );
}

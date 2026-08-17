import { clear, element } from '../ui/dom.mjs';
import { icon } from '../ui/icons.mjs';

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = element('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function renderDataTools({ root, api, notifications, onApplied, onOpenRecord, confirmAction }) {
  clear(root);
  root.className = 'admin-main';
  const page = element('div', { className: 'admin-page', attrs: { id: 'adminJsonTools' } });
  const fileInput = element('input', { attrs: { id: 'adminJsonImportFile', type: 'file', accept: '.json,application/json' } });
  const mode = element('select', { attrs: { 'aria-label': 'Режим импорта' } }, [
    element('option', { text: 'Объединить — ничего не удалять', attrs: { value: 'merge' } }),
    element('option', { text: 'Заменить набор — требуется отдельное подтверждение', attrs: { value: 'replace' } })
  ]);
  const report = element('div', { className: 'admin-section-stack' });
  const applyButton = element('button', { className: 'admin-btn admin-btn--primary', disabled: true, attrs: { id: 'adminJsonImportApply', type: 'button' } }, ['Применить проверенный план']);
  const downloadReportButton = element('button', { className: 'admin-btn', hidden: true, attrs: { type: 'button' } }, ['Скачать отчёт проверки']);
  let preview = null;
  let previewMode = '';

  const previewButton = element('button', {
    className: 'admin-btn', attrs: { id: 'adminJsonImportPreview', type: 'button' },
    on: { click: async () => {
      const file = fileInput.files?.[0];
      if (!file) return notifications.toast('Сначала выберите JSON-файл.', { type: 'info' });
      previewButton.disabled = true;
      clear(report);
      report.append(element('div', { className: 'admin-skeleton', style: 'height:96px' }));
      try {
        preview = await api.importPreview({ rawJson: await file.text(), writeMode: mode.value });
        previewMode = mode.value;
        clear(report);
        const blockers = preview.blockers || preview.errors || [];
        const changes = preview.changes || preview.plan?.changes || preview.diff || [];
        report.append(
          element('div', { className: `admin-alert ${blockers.length ? 'admin-alert--error' : 'admin-alert--success'}` }, [
            icon(blockers.length ? 'error' : 'check'),
            element('p', { text: blockers.length ? `Импорт заблокирован: ${blockers.length} ошибок.` : `План проверен. Изменений: ${changes.length || preview.summary?.changed || 0}. Ничего ещё не записано.` })
          ]),
          element('details', { className: 'admin-details' }, [element('summary', { text: 'Технический отчёт preview' }), element('pre', { className: 'admin-json-editor', text: JSON.stringify(preview, null, 2), attrs: { tabindex: '0' } })])
        );
        downloadReportButton.hidden = false;
        applyButton.disabled = Boolean(blockers.length || !preview.operationId);
      } catch (error) {
        clear(report);
        report.append(element('div', { className: 'admin-alert admin-alert--error' }, [icon('error'), element('p', { text: error.message })]));
        applyButton.disabled = true;
        downloadReportButton.hidden = true;
      } finally { previewButton.disabled = false; }
    } }
  }, ['Сначала проверить файл']);

  downloadReportButton.addEventListener('click', () => {
    if (!preview) return;
    saveBlob(new Blob([`${JSON.stringify(preview, null, 2)}\n`], { type: 'application/json;charset=utf-8' }), `smu1-import-preview-${new Date().toISOString().slice(0, 10)}.json`);
  });
  mode.addEventListener('change', () => {
    preview = null;
    previewMode = '';
    applyButton.disabled = true;
    downloadReportButton.hidden = true;
    clear(report);
    notifications.toast('Режим изменён. Проверьте файл ещё раз перед применением.', { type: 'info' });
  });
  fileInput.addEventListener('change', () => {
    preview = null;
    previewMode = '';
    applyButton.disabled = true;
    downloadReportButton.hidden = true;
    clear(report);
  });

  applyButton.addEventListener('click', async () => {
    if (!preview?.operationId) return;
    let replaceConfirmed = false;
    if (previewMode === 'replace') {
      const answer = await confirmAction?.({
        title: 'Подтвердить замену набора данных?',
        copy: 'Все удаления и обновления из проверенного плана будут применены одной восстановимой транзакцией. Тестовый сайт не обновится.',
        details: [`Операция: ${preview.operationId}`, `Изменений: ${(preview.changes || preview.diff || []).length || preview.summary?.changed || 0}`],
        danger: true,
        confirmLabel: 'Применить замену',
        inputLabel: 'Введите ЗАМЕНИТЬ',
        inputHint: 'Регистр важен.',
        expectedValue: 'ЗАМЕНИТЬ'
      });
      if (answer === null) return;
      replaceConfirmed = true;
    }
    applyButton.disabled = true;
    try {
      const result = await api.importApply({ operationId: preview.operationId, replaceConfirmed });
      notifications.toast('Импорт применён одной локальной транзакцией. Тестовый сайт не обновлялся.', { type: 'success' });
      preview = null;
      fileInput.value = '';
      clear(report);
      downloadReportButton.hidden = true;
      await onApplied?.(result);
    } catch (error) {
      notifications.toast(error.message, { type: 'error', duration: 0 });
      applyButton.disabled = false;
    }
  });

  async function exportData(kind) {
    try {
      const result = kind === 'catalog' ? await api.exportCatalog() : await api.exportFullSite();
      saveBlob(result.blob, result.filename);
      notifications.toast(kind === 'catalog' ? 'Экспорт товаров скачан.' : 'Данные сайта скачаны. Медиа-байты в этот JSON не входят.', { type: 'success' });
    } catch (error) { notifications.toast(error.message, { type: 'error' }); }
  }

  page.append(
    element('div', { className: 'admin-page__heading' }, [element('div', {}, [element('h1', { text: 'Настройки и дополнительно' }), element('p', { text: 'Контакты компании, навигация и перенос данных без ручного редактирования JSON.' })])]),
    element('section', { className: 'admin-card' }, [
      element('div', { className: 'admin-card__header' }, [element('div', {}, [element('h2', { text: 'Настройки сайта' }), element('p', { text: 'Обычные настройки открываются как понятные формы. JSON ниже нужен только для переноса данных.' })])]),
      element('div', { className: 'admin-card__body admin-quick-actions' }, [
        element('button', { className: 'admin-btn admin-btn--primary', attrs: { type: 'button' }, on: { click: () => onOpenRecord?.({ collection: 'site-settings', slug: 'global' }) } }, [icon('settings'), 'Компания и контакты']),
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => onOpenRecord?.({ collection: 'navigation', slug: 'navigation' }) } }, [icon('pages'), 'Навигация и шапка']),
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => onOpenRecord?.({ collection: 'yandex', slug: 'yandex' }) } }, [icon('external'), 'Карта и Яндекс'])
      ])
    ]),
    element('section', { className: 'admin-card' }, [element('div', { className: 'admin-card__header' }, [element('h2', { text: 'Скачать данные' })]), element('div', { className: 'admin-card__body admin-section-stack' }, [
      element('div', { className: 'admin-alert' }, [icon('info'), element('p', { text: 'JSON всего сайта lossless для зарегистрированного контента, navigation и yandex, но не переносит сами фотографии. Полное восстановление обеспечивают история транзакций и сохранённые source originals.' })]),
      element('div', { className: 'admin-quick-actions' }, [
        element('button', { className: 'admin-btn admin-btn--primary', attrs: { id: 'adminJsonExportFullSite', type: 'button' }, on: { click: () => void exportData('full') } }, ['Скачать данные всего сайта (JSON)']),
        element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => void exportData('catalog') } }, ['Экспорт товаров для массовой правки'])
      ])
    ])]),
    element('section', { className: 'admin-card', style: 'margin-top:18px' }, [element('div', { className: 'admin-card__header' }, [element('h2', { text: 'Импорт JSON' })]), element('div', { className: 'admin-card__body admin-section-stack' }, [
      element('p', { text: 'Файл сначала проверяется без записи. Только затем создаётся одна crash-recoverable локальная транзакция; публикация не запускается.' }),
      fileInput,
      mode,
      element('div', { className: 'admin-quick-actions' }, [previewButton, applyButton, downloadReportButton]),
      report
    ])])
  );
  root.append(page);
}

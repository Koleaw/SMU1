import { clear, element, formatHumanTime } from '../ui/dom.mjs';
import { icon } from '../ui/icons.mjs';

export function renderHistoryPanel({ root, history = [], onRestorePreview, onRefresh }) {
  clear(root);
  root.className = 'admin-page';
  const rows = history.map((entry) => element('article', { className: 'admin-card' }, [
    element('div', { className: 'admin-card__header' }, [
      element('div', {}, [element('h2', { text: entry.metadata?.userSummary || 'Локальное сохранение' }), element('p', { text: `${formatHumanTime(entry.updatedAt)} · ${entry.changedPaths?.length || 0} изменённых файл(а)` })]),
      element('span', { className: `admin-badge ${entry.state === 'committed' ? 'admin-badge--success' : 'admin-badge--warning'}`, text: entry.state === 'committed' ? 'Сохранено' : 'Откачено' })
    ]),
    element('div', { className: 'admin-card__body admin-section-stack' }, [
      entry.metadata?.affectedRoutes?.length ? element('p', { text: `Затронутые страницы: ${entry.metadata.affectedRoutes.join(', ')}` }) : null,
      element('details', { className: 'admin-details' }, [element('summary', { text: 'Технические детали' }), element('div', { className: 'admin-details__body' }, [element('pre', { text: JSON.stringify({ transactionId: entry.transactionId, payloadHash: entry.payloadHash, changedPaths: entry.changedPaths }, null, 2), className: 'admin-json-editor' })])]),
      entry.state === 'committed' ? element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: () => onRestorePreview(entry) } }, [icon('history'), 'Показать восстановление']) : null
    ])
  ]));
  root.append(
    element('div', { className: 'admin-page__heading' }, [element('div', {}, [element('h1', { text: 'История и восстановление' }), element('p', { text: 'Последние безопасные сохранения. Восстановление создаёт новую обратную транзакцию и не переписывает историю.' })]), element('button', { className: 'admin-btn', attrs: { type: 'button' }, on: { click: onRefresh } }, ['Обновить'])]),
    element('div', { className: 'admin-section-stack' }, rows.length ? rows : [element('div', { className: 'admin-empty' }, [icon('history'), element('strong', { text: 'История сохранений пуста' }), element('p', { text: 'Черновики браузера находятся на Обзоре; здесь появятся только успешные локальные транзакции.' })])])
  );
}

import { clear, element } from '../ui/dom.mjs';
import { icon } from '../ui/icons.mjs';
import { COLLECTION_LABELS, humanPresentationType } from '../metadata/editor-fields.mjs';

function recordStatus(collection, entry, drafts) {
  const key = `${collection}:${entry.slug}`;
  if (drafts.has(key)) return { className: 'admin-record-row__status--dirty', label: 'Есть несохранённый черновик' };
  const pageVisible = entry.isActive !== false;
  const placementVisible = collection === 'products' ? entry.summary?.showInCatalog !== false
    : collection === 'product-categories' ? entry.summary?.showInSectionGrid !== false
      : ['product-sections', 'services'].includes(collection) ? entry.summary?.showOnHome !== false
        : true;
  const visible = pageVisible && placementVisible;
  const label = !pageVisible ? 'Скрыта с сайта'
    : !placementVisible ? collection === 'products' ? 'Страница доступна, но товар скрыт из каталога' : 'Страница доступна, но карточка скрыта из списка'
      : 'Видна на сайте';
  return { className: visible ? 'admin-record-row__status--visible' : '', label };
}

function matches(entry, query) {
  if (!query) return true;
  const haystack = [entry.title, entry.slug, ...Object.values(entry.summary || {})]
    .filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
  return haystack.includes(query.toLocaleLowerCase('ru-RU'));
}

export function renderEntityList({
  root,
  view,
  summaries,
  drafts = new Map(),
  selected = null,
  reorderDrafts = new Map(),
  onSelect,
  onCreate,
  onBack,
  onReorder,
  onSaveOrder,
  onCancelOrder
}) {
  clear(root);
  const collections = view.collectionGroups || [];
  const title = view.title;
  const search = element('input', { attrs: { type: 'search', placeholder: `Найти в разделе «${title}»`, 'aria-label': `Поиск: ${title}` } });
  const filter = element('select', { attrs: { 'aria-label': `Фильтр: ${title}` } }, [
    ['all', 'Все записи'],
    ['visible', 'Видна на сайте'],
    ['hidden', 'Скрыта с сайта/списка'],
    ['draft', 'Есть browser draft'],
    ['no-photo', 'Без основного фото'],
    ['empty-gallery', 'Пустая галерея'],
    ['standard', 'Обычная карточка'],
    ['premium', 'Расширенная подача']
  ].map(([value, label]) => element('option', { text: label, attrs: { value } })));
  const body = element('div', { className: 'admin-entity-list__body' });
  const count = element('small', { className: 'admin-field__hint' });

  function orderedEntries(collection) {
    const entries = summaries.get(collection) || [];
    const order = reorderDrafts.get(collection);
    if (!Array.isArray(order)) return entries;
    const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
    return [...order.map((slug) => bySlug.get(slug)).filter(Boolean), ...entries.filter((entry) => !order.includes(entry.slug))];
  }

  function renderRow(collection, entry, index, total, depth = 0) {
    const status = recordStatus(collection, entry, drafts);
    const subtitle = collection === 'products' && entry.summary?.presentationType
      ? humanPresentationType(entry.summary.presentationType)
      : entry.slug;
    const open = element('button', {
      className: 'admin-record-row',
      attrs: {
        type: 'button',
        'aria-current': selected?.collection === collection && selected?.slug === entry.slug ? 'true' : 'false',
        'aria-label': `${entry.title || entry.slug}. ${status.label}`
      },
      on: { click: () => onSelect({ collection, slug: entry.slug, entry }) }
    }, [
      element('span', { className: 'admin-record-row__thumb' }, [icon(collection === 'products' ? 'box' : collection === 'projects' ? 'projects' : 'pages')]),
      element('span', {}, [element('strong', { text: entry.title || entry.slug }), element('small', { text: subtitle })]),
      element('span', { className: `admin-record-row__status ${status.className}`, attrs: { title: status.label, 'aria-hidden': 'true' } })
    ]);
    const reorder = typeof onReorder === 'function' && total > 1
      ? element('details', { className: 'admin-record-order' }, [
          element('summary', { attrs: { 'aria-label': `Изменить порядок: ${entry.title || entry.slug}` } }, ['⋮']),
          element('div', { className: 'admin-record-order__menu' }, [
            element('button', { className: 'admin-btn admin-btn--small', disabled: index === 0, attrs: { type: 'button' }, on: { click: () => onReorder({ collection, slug: entry.slug, direction: 'start' }) } }, ['В начало']),
            element('button', { className: 'admin-btn admin-btn--small', disabled: index === 0, attrs: { type: 'button' }, on: { click: () => onReorder({ collection, slug: entry.slug, direction: 'up' }) } }, [icon('arrowUp'), 'Выше']),
            element('button', { className: 'admin-btn admin-btn--small', disabled: index === total - 1, attrs: { type: 'button' }, on: { click: () => onReorder({ collection, slug: entry.slug, direction: 'down' }) } }, [icon('arrowDown'), 'Ниже']),
            element('button', { className: 'admin-btn admin-btn--small', disabled: index === total - 1, attrs: { type: 'button' }, on: { click: () => onReorder({ collection, slug: entry.slug, direction: 'end' }) } }, ['В конец'])
          ])
        ])
      : null;
    const wrap = element('div', {
      className: 'admin-record-row-wrap',
      dataset: { depth, collection, slug: entry.slug },
      attrs: { draggable: typeof onReorder === 'function' ? 'true' : 'false' }
    }, [open, reorder]);
    if (typeof onReorder === 'function') {
      wrap.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', `${collection}:${entry.slug}`);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        wrap.dataset.dragging = 'true';
      });
      wrap.addEventListener('dragover', (event) => {
        const source = event.dataTransfer?.getData('text/plain') || '';
        if (source.startsWith(`${collection}:`) && source !== `${collection}:${entry.slug}`) {
          event.preventDefault();
          wrap.dataset.dropTarget = 'true';
        }
      });
      wrap.addEventListener('dragleave', () => { delete wrap.dataset.dropTarget; });
      wrap.addEventListener('drop', (event) => {
        event.preventDefault();
        delete wrap.dataset.dropTarget;
        const [sourceCollection, ...sourceSlugParts] = String(event.dataTransfer?.getData('text/plain') || '').split(':');
        const sourceSlug = sourceSlugParts.join(':');
        if (sourceCollection === collection && sourceSlug && sourceSlug !== entry.slug) {
          onReorder({ collection, slug: sourceSlug, targetSlug: entry.slug, direction: 'before' });
        }
      });
      wrap.addEventListener('dragend', () => {
        delete wrap.dataset.dragging;
        for (const target of root.querySelectorAll('[data-drop-target]')) delete target.dataset.dropTarget;
      });
    }
    return wrap;
  }

  function passesFilter(collection, entry) {
    const value = filter.value;
    if (value === 'all') return true;
    if (value === 'draft') return drafts.has(`${collection}:${entry.slug}`);
    if (value === 'visible') return recordStatus(collection, entry, new Map()).label === 'Видна на сайте';
    if (value === 'hidden') return recordStatus(collection, entry, new Map()).label !== 'Видна на сайте';
    if (value === 'no-photo') return entry.summary?.hasPrimaryMedia === false;
    if (value === 'empty-gallery') return Number(entry.summary?.galleryCount || 0) === 0;
    if (value === 'standard' || value === 'premium') return collection === 'products' && entry.summary?.presentationType === value;
    return true;
  }

  function appendOrderDraft(collection) {
    if (reorderDrafts.has(collection)) {
      body.append(element('div', { className: 'admin-order-draft' }, [
        element('p', { text: 'Новый порядок пока только в браузере.' }),
        element('button', { className: 'admin-btn admin-btn--primary admin-btn--small', attrs: { type: 'button' }, on: { click: () => onSaveOrder?.(collection) } }, [icon('save'), 'Сохранить порядок']),
        element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: () => onCancelOrder?.(collection) } }, ['Отменить'])
      ]));
    }
  }

  function appendCollection(collection, entries, { label = true, depth = 0, includeOrderDraft = true } = {}) {
    if (!entries.length) return 0;
    if (label) body.append(element('p', { className: 'admin-nav__label', text: COLLECTION_LABELS[collection] || collection, style: 'margin-top:12px' }));
    entries.forEach((entry, index) => body.append(renderRow(collection, entry, index, entries.length, depth)));
    if (includeOrderDraft) appendOrderDraft(collection);
    return entries.length;
  }

  function renderRows() {
    clear(body);
    let shown = 0;
    const query = search.value.trim();
    const filteredFor = (collection) => orderedEntries(collection).filter((entry) => matches(entry, query) && passesFilter(collection, entry));
    if (view.title === 'Каталог' && !query && filter.value === 'all') {
      const sections = filteredFor('product-sections');
      const categories = filteredFor('product-categories');
      const products = filteredFor('products');
      body.append(element('p', { className: 'admin-nav__label', text: 'Раздел → тип изделий → товар', style: 'margin-top:12px' }));
      for (const [sectionIndex, section] of sections.entries()) {
        body.append(renderRow('product-sections', section, sectionIndex, sections.length, 0));
        shown += 1;
        const sectionCategories = categories.filter((entry) => entry.summary?.parentSectionSlug === section.slug);
        for (const category of sectionCategories) {
          body.append(renderRow('product-categories', category, categories.indexOf(category), categories.length, 1));
          shown += 1;
          for (const product of products.filter((entry) => entry.summary?.productCategorySlug === category.slug)) {
            body.append(renderRow('products', product, products.indexOf(product), products.length, 2));
            shown += 1;
          }
        }
      }
      const knownSections = new Set(sections.map((entry) => entry.slug));
      const knownCategories = new Set(categories.map((entry) => entry.slug));
      shown += appendCollection('product-categories', categories.filter((entry) => !knownSections.has(entry.summary?.parentSectionSlug)), { label: true, depth: 1, includeOrderDraft: false });
      shown += appendCollection('products', products.filter((entry) => !knownCategories.has(entry.summary?.productCategorySlug)), { label: true, depth: 2, includeOrderDraft: false });
      for (const collection of ['product-sections', 'product-categories', 'products']) appendOrderDraft(collection);
    } else {
      for (const collection of collections) {
        const filtered = filteredFor(collection);
        shown += appendCollection(collection, filtered);
      }
    }
    count.textContent = shown ? `Показано: ${shown}` : 'Ничего не найдено';
    if (!shown) body.append(element('div', { className: 'admin-empty' }, [icon('search'), element('strong', { text: 'Записей не найдено' }), element('p', { text: 'Измените запрос или очистите строку поиска.' })]));
  }

  search.addEventListener('input', renderRows);
  filter.addEventListener('change', renderRows);
  const header = element('div', { className: 'admin-entity-list__header' }, [
    element('div', { className: 'admin-entity-list__title-row' }, [
      element('h1', { className: 'admin-entity-list__title', text: title }),
      onCreate ? element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', attrs: { type: 'button', 'aria-label': 'Создать запись' }, on: { click: onCreate } }, [icon('plus')]) : null
    ]),
    element('div', { className: 'admin-search' }, [icon('search'), search]),
    filter,
    count
  ]);
  root.append(header, body);
  renderRows();
  return Object.freeze({ refresh: renderRows, search });
}

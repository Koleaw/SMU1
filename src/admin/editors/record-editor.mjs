import { element, clear } from '../ui/dom.mjs';
import { icon } from '../ui/icons.mjs';
import { getAtPath } from '../state/history-store.mjs';
import { groupsForCollection, isVisibleRecord } from '../metadata/editor-fields.mjs';
import { assessPublicCompleteness } from '../metadata/content-completeness.mjs';
import {
  getCreatablePageBlockTypes,
  getPageBlockTemplatePolicy,
  isPageBlockRenderedForTemplate,
  resolvePageBlockTemplateFamily
} from '../metadata/content-coverage-registry.mjs';

const blockLabel = (type) => getPageBlockTemplatePolicy(type)?.label || `Legacy: ${type || 'без типа'}`;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function fieldId(collection, path) {
  return `field-${collection}-${path.replace(/[^a-z0-9]+/giu, '-')}`;
}

function presentMediaValue(item) {
  if (typeof item === 'string') return item;
  return item?.src || item?.image || item?.url || '';
}

function displayFilename(value) {
  const clean = String(value || '').split(/[?#]/u)[0];
  try { return decodeURIComponent(clean.split('/').at(-1) || clean); }
  catch { return clean.split('/').at(-1) || clean; }
}

function createFieldShell(definition, control) {
  const id = control.id;
  const label = element('label', { className: 'admin-field__label', attrs: { for: id } }, [
    element('span', {}, [definition.label, definition.required ? element('span', { className: 'admin-field__required', text: ' *', attrs: { 'aria-hidden': 'true' } }) : null]),
    definition.advanced ? element('small', { text: 'Дополнительно' }) : null
  ]);
  const hint = definition.hint
    ? element('p', { className: 'admin-field__hint', text: definition.hint, attrs: { id: `${id}-hint` } })
    : null;
  if (hint) control.setAttribute('aria-describedby', `${id}-hint`);
  return element('div', { className: `admin-field${definition.wide ? ' admin-field--wide' : ''}`, dataset: { fieldPath: definition.path } }, [label, control, hint]);
}

function scalarControl(definition, collection, initialValue, update, { isNew = false } = {}) {
  const id = fieldId(collection, definition.path);
  const tag = definition.kind === 'textarea' ? 'textarea' : definition.kind === 'select' || definition.kind === 'relation-select' ? 'select' : 'input';
  const control = element(tag, {
    attrs: {
      id,
      name: definition.path,
      type: definition.kind === 'number' ? 'number' : 'text',
      required: definition.required,
      maxlength: definition.maxLength,
      min: definition.min,
      max: definition.max,
      autocomplete: 'off'
    }
  });
  if (definition.path === 'slug' && !isNew) {
    control.disabled = true;
    control.title = 'После первого сохранения адрес меняется только через проверку связей.';
  }
  const options = definition.options || [];
  if (tag === 'select') {
    if (!definition.required) control.append(element('option', { text: 'Не выбрано', attrs: { value: '' } }));
    for (const [value, label] of options) control.append(element('option', { text: label, attrs: { value } }));
  }
  const writeValue = (value) => {
    control.value = value === null || value === undefined ? '' : String(value);
  };
  writeValue(initialValue);
  const eventName = tag === 'select' ? 'change' : 'input';
  control.addEventListener(eventName, () => {
    let value = control.value;
    if (definition.kind === 'number') value = value === '' && definition.nullable ? null : Number(value);
    else if (definition.nullable && value === '') value = null;
    update(definition.path, value, { label: `Изменить: ${definition.label}`, coalesceKey: tag === 'select' ? '' : definition.path });
  });
  return {
    node: createFieldShell(definition, control),
    sync: (content, reason) => {
      if (reason === 'commit' && document.activeElement === control) return;
      writeValue(getAtPath(content, definition.path));
    },
    focus: () => control.focus()
  };
}

function booleanControl(definition, collection, initialValue, update) {
  const id = fieldId(collection, definition.path);
  const input = element('input', { attrs: { id, type: 'checkbox' }, checked: initialValue === true });
  const control = element('label', { className: 'admin-switch', attrs: { for: id } }, [
    element('span', { className: 'admin-switch__copy' }, [
      element('strong', { text: definition.label }),
      definition.hint ? element('small', { text: definition.hint }) : null
    ]),
    input,
    element('span', { className: 'admin-switch__control', attrs: { 'aria-hidden': 'true' } })
  ]);
  input.addEventListener('change', () => update(definition.path, input.checked, { label: definition.label }));
  return {
    node: element('div', { className: `admin-field${definition.wide ? ' admin-field--wide' : ''}`, dataset: { fieldPath: definition.path } }, [control]),
    sync: (content) => { input.checked = getAtPath(content, definition.path) === true; },
    focus: () => input.focus()
  };
}

function listControl(definition, collection, initialValue, update) {
  const id = fieldId(collection, definition.path);
  const textarea = element('textarea', { attrs: { id, name: definition.path, rows: 6, 'aria-describedby': `${id}-hint` } });
  const warning = element('p', { className: 'admin-field__hint', attrs: { id: `${id}-hint` } });
  const writeValue = (value) => {
    const items = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
    textarea.value = items.join('\n');
    const normalized = items.map((item) => String(item).trim()).filter(Boolean);
    const duplicateCount = normalized.length - new Set(normalized.map((item) => item.toLocaleLowerCase('ru-RU'))).size;
    warning.textContent = duplicateCount
      ? `Найдены повторы: ${duplicateCount}. Они не удаляются автоматически.`
      : 'Один пункт на строку. Пустые строки при сохранении списка не учитываются.';
  };
  writeValue(initialValue);
  textarea.addEventListener('input', () => {
    const items = textarea.value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
    update(definition.path, items, { label: `Изменить список: ${definition.label}`, coalesceKey: definition.path });
    const duplicateCount = items.length - new Set(items.map((item) => item.toLocaleLowerCase('ru-RU'))).size;
    warning.textContent = duplicateCount
      ? `Найдены повторы: ${duplicateCount}. Они не удаляются автоматически.`
      : 'Один пункт на строку. Пустые строки при сохранении списка не учитываются.';
  });
  const node = element('div', { className: 'admin-field admin-field--wide', dataset: { fieldPath: definition.path } }, [
    element('label', { className: 'admin-field__label', text: definition.label, attrs: { for: id } }), textarea, warning
  ]);
  return {
    node,
    sync: (content, reason) => {
      if (reason === 'commit' && document.activeElement === textarea) return;
      writeValue(getAtPath(content, definition.path));
    },
    focus: () => textarea.focus()
  };
}

function specificationControl(definition, collection, initialValue, update) {
  const body = element('div', { className: 'admin-list-editor' });
  let current = Array.isArray(initialValue) ? clone(initialValue) : [];
  const commit = (label) => update(definition.path, current, { label });

  function render() {
    clear(body);
    current.forEach((item, index) => {
      const labelInput = element('input', { value: item?.label || '', attrs: { 'aria-label': `Параметр ${index + 1}` } });
      const valueInput = element('input', { value: item?.value || '', attrs: { 'aria-label': `Значение ${index + 1}` } });
      labelInput.addEventListener('input', () => { current[index] = { ...current[index], label: labelInput.value }; commit('Изменить название параметра'); });
      valueInput.addEventListener('input', () => { current[index] = { ...current[index], value: valueInput.value }; commit('Изменить значение параметра'); });
      const remove = element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', attrs: { type: 'button', 'aria-label': `Удалить параметр ${index + 1}` }, on: { click: () => { current.splice(index, 1); commit('Удалить параметр'); render(); } } }, [icon('trash')]);
      body.append(element('div', { className: 'admin-list-editor__row' }, [
        element('div', { style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px' }, [labelInput, valueInput]), remove
      ]));
    });
    body.append(element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: () => { current.push({ label: '', value: '', order: (current.length + 1) * 10 }); commit('Добавить параметр'); render(); body.querySelector('input:last-of-type')?.focus(); } } }, [icon('plus'), 'Добавить параметр']));
  }
  render();
  const node = element('div', { className: 'admin-field admin-field--wide', dataset: { fieldPath: definition.path } }, [element('span', { className: 'admin-field__label', text: definition.label }), body]);
  return { node, sync: (content, reason) => { if (reason !== 'commit') { current = clone(getAtPath(content, definition.path) || []); render(); } }, focus: () => body.querySelector('input,button')?.focus() };
}

function mediaControl(definition, collection, initialValue, update, onMediaRequest, resolveMediaSource) {
  const id = fieldId(collection, definition.path);
  const preview = element('div', { className: 'admin-media-item__image' });
  const pathInput = element('input', { value: initialValue || '', attrs: { id, type: 'text', autocomplete: 'off', readonly: true } });
  function syncValue(value) {
    pathInput.value = value || '';
    clear(preview);
    const isVideo = String(definition.role || definition.path || '').toLowerCase().includes('video');
    const previewSource = value ? resolveMediaSource(value) : '';
    if (previewSource && !isVideo) preview.append(element('img', { src: previewSource, alt: '', loading: 'lazy', on: { error: () => { clear(preview); preview.append(icon('image')); } } }));
    else if (value && isVideo) preview.append(icon('media'));
    else preview.append(icon('image'));
  }
  syncValue(initialValue);
  const choose = element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: () => onMediaRequest?.({ path: definition.path, role: definition.role, multiple: false }) } }, [icon('image'), 'Выбрать фото']);
  const node = element('div', { className: 'admin-field admin-field--wide', dataset: { fieldPath: definition.path } }, [
    element('label', { className: 'admin-field__label', text: definition.label, attrs: { for: id } }),
    element('div', { style: 'display:grid;grid-template-columns:minmax(120px,180px) minmax(0,1fr);gap:12px;align-items:center' }, [
      element('div', { className: 'admin-media-item' }, [preview]),
      element('div', { className: 'admin-list-editor', }, [pathInput, choose])
    ]),
    definition.hint ? element('p', { className: 'admin-field__hint', text: definition.hint }) : null
  ]);
  return { node, sync: (content) => syncValue(getAtPath(content, definition.path)), focus: () => pathInput.focus() };
}

function galleryControl(definition, collection, initialValue, update, onMediaRequest, getContent, resolveMediaSource) {
  const grid = element('div', { className: 'admin-media-grid' });
  const hint = element('p', { className: 'admin-field__hint', text: 'Порядок ниже станет порядком галереи после сохранения. Фото и подписи перемещаются вместе.' });
  let current = Array.isArray(initialValue) ? clone(initialValue) : [];

  function commit(label, coalesceKey = '') { update(definition.path, current, { label, coalesceKey }); }
  function replaceItem(index, key, value) {
    const item = current[index];
    if (definition.itemKind === 'string') current[index] = value;
    else current[index] = { ...(typeof item === 'object' && item ? item : { src: presentMediaValue(item) }), [key]: value };
    commit(`Изменить ${key === 'caption' ? 'подпись' : 'фото'} галереи`, `${definition.path}.${index}.${key}`);
  }
  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    commit('Изменить порядок фотографий');
    render();
  }
  function render() {
    clear(grid);
    current.forEach((item, index) => {
      const source = presentMediaValue(item);
      const previewSource = source ? resolveMediaSource(source) : '';
      const imageWrap = element('div', { className: 'admin-media-item__image' }, previewSource
        ? [element('img', { src: previewSource, alt: typeof item === 'object' ? item.alt || '' : '', loading: 'lazy', on: { error: (event) => event.currentTarget.remove() } })]
        : [icon('image')]);
      const body = element('div', { className: 'admin-media-item__body' }, [
        element('small', { text: displayFilename(source) || `Фото ${index + 1}` }),
        definition.itemKind !== 'string' ? element('input', {
          value: typeof item === 'object' ? item.alt || '' : '',
          attrs: { 'aria-label': `Alt-текст фото ${index + 1}`, placeholder: 'Alt-текст' },
          on: { input: (event) => replaceItem(index, 'alt', event.currentTarget.value) }
        }) : null,
        definition.itemKind !== 'string' ? element('input', {
          value: typeof item === 'object' ? item.caption || '' : '',
          attrs: { 'aria-label': `Подпись фото ${index + 1}`, placeholder: 'Подпись' },
          on: { input: (event) => replaceItem(index, 'caption', event.currentTarget.value) }
        }) : null,
        element('div', { className: 'admin-list-editor__actions' }, [
          element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', disabled: index === 0, attrs: { type: 'button', 'aria-label': `Переместить фото ${index + 1} выше` }, on: { click: () => move(index, -1) } }, [icon('arrowUp')]),
          element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', disabled: index === current.length - 1, attrs: { type: 'button', 'aria-label': `Переместить фото ${index + 1} ниже` }, on: { click: () => move(index, 1) } }, [icon('arrowDown')]),
          element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', attrs: { type: 'button', 'aria-label': `Удалить фото ${index + 1}` }, on: { click: () => { current.splice(index, 1); commit('Убрать фото из галереи'); render(); } } }, [icon('trash')])
        ])
      ]);
      grid.append(element('article', { className: 'admin-media-item' }, [element('span', { className: 'admin-media-item__order', text: index + 1 }), imageWrap, body]));
    });
    grid.append(element('button', {
      className: 'admin-btn',
      attrs: { type: 'button' },
      style: 'min-height:128px;border-style:dashed',
      on: { click: () => onMediaRequest?.({
        path: definition.path,
        role: definition.role,
        multiple: true,
        existing: clone(current),
        itemKind: definition.itemKind,
        content: getContent(),
        coverPath: collection === 'projects' ? 'coverImage' : ['products', 'product-categories', 'product-sections'].includes(collection) ? 'image' : '',
        applySelection(paths) {
          const previousByPath = new Map();
          for (const entry of current) {
            const pathname = presentMediaValue(entry);
            if (!pathname) continue;
            const values = previousByPath.get(pathname) || [];
            values.push(clone(entry));
            previousByPath.set(pathname, values);
          }
          current = paths.map((pathname) => {
            const preserved = previousByPath.get(pathname)?.shift();
            if (preserved !== undefined) return preserved;
            return definition.itemKind === 'string' ? pathname : { src: pathname, alt: '', caption: '' };
          });
          commit('Применить итоговый порядок фотографий');
          render();
          return paths;
        }
      }) }
    }, [icon('plus'), 'Выбрать несколько фото']));
  }
  render();
  const node = element('div', { className: 'admin-field admin-field--wide', dataset: { fieldPath: definition.path } }, [element('span', { className: 'admin-field__label', text: definition.label }), grid, hint]);
  return { node, sync: (content, reason) => { if (reason !== 'commit') { current = clone(getAtPath(content, definition.path) || []); render(); } }, focus: () => grid.querySelector('button')?.focus() };
}

function imageViewControl(definition, collection, initialValue, update) {
  const body = element('div', { className: 'admin-form-section__body' });
  const defaults = { fit: 'cover', positionX: 50, positionY: 50, scale: 1 };
  let current = { ...defaults, ...(initialValue || {}) };
  const inputs = new Map();
  const definitions = [
    ['fit', 'Режим', 'select', [['cover', 'Заполнить'], ['contain', 'Показать целиком']]],
    ['positionX', 'Позиция по горизонтали', 'range', null, 0, 100],
    ['positionY', 'Позиция по вертикали', 'range', null, 0, 100],
    ['scale', 'Масштаб', 'range', null, 1, 3, .05]
  ];
  for (const [key, label, kind, options, min, max, step] of definitions) {
    const input = element(kind === 'select' ? 'select' : 'input', { attrs: { type: kind, min, max, step, 'aria-label': label } });
    if (kind === 'select') options.forEach(([value, text]) => input.append(element('option', { text, attrs: { value } })));
    input.value = String(current[key]);
    input.addEventListener('input', () => {
      current[key] = kind === 'select' ? input.value : Number(input.value);
      update(definition.path, current, { label: `Изменить кадрирование: ${label}`, coalesceKey: `${definition.path}.${key}` });
    });
    inputs.set(key, input);
    body.append(element('label', { className: 'admin-field' }, [element('span', { className: 'admin-field__label', text: label }), input]));
  }
  const details = element('details', { className: 'admin-details admin-field--wide' }, [element('summary', { text: definition.label }), element('div', { className: 'admin-details__body' }, [body])]);
  return { node: details, sync: (content) => { current = { ...defaults, ...(getAtPath(content, definition.path) || {}) }; for (const [key, input] of inputs) input.value = String(current[key]); }, focus: () => details.focus() };
}

function pageBlocksControl(definition, collection, initialValue, update, onMediaRequest, getContent) {
  const body = element('div', { className: 'admin-section-stack' });
  let current = Array.isArray(initialValue) ? clone(initialValue) : [];
  function commit(label, coalesceKey = '') { update(definition.path, current, { label, coalesceKey }); }

  function updateBlock(index, key, value, label, coalesceKey = '') {
    current[index] = { ...current[index], [key]: value };
    commit(label, coalesceKey);
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    current = current.map((block, itemIndex) => ({ ...block, order: (itemIndex + 1) * 10 }));
    commit('Изменить порядок секций'); render();
  }

  function topLevelField(index, key, label, { multiline = false, technical = false } = {}) {
    const block = current[index] || {};
    const control = element(multiline ? 'textarea' : 'input', {
      value: block[key] ?? '',
      attrs: { 'aria-label': label, autocomplete: 'off' },
      on: {
        input: (event) => updateBlock(index, key, event.currentTarget.value, `Изменить: ${label}`, `${definition.path}.${index}.${key}`)
      }
    });
    return element('label', { className: 'admin-field' }, [
      element('span', { className: 'admin-field__label', text: label }),
      control,
      technical ? element('small', { className: 'admin-field__hint', text: 'Технический идентификатор выбирает место секции в текущем шаблоне.' }) : null
    ]);
  }

  function itemActions({ index, itemIndex, arrayKey, items, renderItems }) {
    const replace = (next, label) => {
      updateBlock(index, arrayKey, next.map((item, orderIndex) => (
        item && typeof item === 'object' ? { ...item, order: (orderIndex + 1) * 10 } : item
      )), label);
      renderItems();
    };
    return element('div', { className: 'admin-list-editor__actions' }, [
      element('button', {
        className: 'admin-btn admin-btn--icon admin-btn--small',
        disabled: itemIndex === 0,
        attrs: { type: 'button', 'aria-label': `Поднять пункт ${itemIndex + 1}` },
        on: { click: () => { const next = clone(items); [next[itemIndex - 1], next[itemIndex]] = [next[itemIndex], next[itemIndex - 1]]; replace(next, 'Изменить порядок пунктов секции'); } }
      }, [icon('arrowUp')]),
      element('button', {
        className: 'admin-btn admin-btn--icon admin-btn--small',
        disabled: itemIndex === items.length - 1,
        attrs: { type: 'button', 'aria-label': `Опустить пункт ${itemIndex + 1}` },
        on: { click: () => { const next = clone(items); [next[itemIndex + 1], next[itemIndex]] = [next[itemIndex], next[itemIndex + 1]]; replace(next, 'Изменить порядок пунктов секции'); } }
      }, [icon('arrowDown')]),
      element('button', {
        className: 'admin-btn admin-btn--icon admin-btn--small',
        attrs: { type: 'button', 'aria-label': `Удалить пункт ${itemIndex + 1}` },
        on: { click: () => { const next = clone(items); next.splice(itemIndex, 1); replace(next, 'Удалить пункт секции'); } }
      }, [icon('trash')])
    ]);
  }

  function arrayEditor(index, policy, consumedFields) {
    const arrayKey = policy.itemPolicy === 'steps' ? 'steps' : 'items';
    const holder = element('div', { className: 'admin-section-stack' });

    function writeItem(itemIndex, key, value, label) {
      const items = clone(Array.isArray(current[index]?.[arrayKey]) ? current[index][arrayKey] : []);
      const existing = items[itemIndex];
      items[itemIndex] = existing && typeof existing === 'object'
        ? { ...existing, [key]: value }
        : value;
      updateBlock(index, arrayKey, items, label, `${definition.path}.${index}.${arrayKey}.${itemIndex}.${key || 'value'}`);
    }

    function renderItems() {
      clear(holder);
      const items = Array.isArray(current[index]?.[arrayKey]) ? current[index][arrayKey] : [];
      items.forEach((item, itemIndex) => {
        const fields = [];
        if (policy.itemPolicy === 'text-list') {
          if (typeof item === 'string') {
            fields.push(element('input', {
              value: item,
              attrs: { 'aria-label': `Текст пункта ${itemIndex + 1}` },
              on: { input: (event) => writeItem(itemIndex, '', event.currentTarget.value, 'Изменить пункт списка') }
            }));
          } else {
            fields.push(
              element('div', { className: 'admin-alert admin-alert--warning' }, [icon('warning'), element('p', { text: 'Этот legacy-пункт имеет нестандартную структуру и показан без возможности изменения.' })]),
              element('pre', { className: 'admin-json-editor', text: JSON.stringify(item, null, 2), attrs: { tabindex: '0' } })
            );
          }
        } else if (item && typeof item === 'object') {
          if (consumedFields.has(`${arrayKey}[].title`)) fields.push(element('input', {
            value: item.title || '', attrs: { 'aria-label': `Заголовок пункта ${itemIndex + 1}`, placeholder: 'Заголовок' },
            on: { input: (event) => writeItem(itemIndex, 'title', event.currentTarget.value, 'Изменить заголовок пункта') }
          }));
          if (consumedFields.has(`${arrayKey}[].text`)) fields.push(element('textarea', {
            value: item.text || '', attrs: { 'aria-label': `Текст пункта ${itemIndex + 1}`, placeholder: 'Текст' },
            on: { input: (event) => writeItem(itemIndex, 'text', event.currentTarget.value, 'Изменить текст пункта') }
          }));
          if (consumedFields.has('items[].image')) {
            const imageInput = element('input', {
              value: item.image || '', attrs: { 'aria-label': `Фото пункта ${itemIndex + 1}`, placeholder: '/uploads/…' },
              on: { input: (event) => writeItem(itemIndex, 'image', event.currentTarget.value, 'Изменить фото пункта') }
            });
            fields.push(element('div', { className: 'admin-list-editor__footer' }, [
              imageInput,
              element('button', {
                className: 'admin-btn admin-btn--small', attrs: { type: 'button' },
                on: { click: () => onMediaRequest?.({
                  path: `${definition.path}.${index}.${arrayKey}.${itemIndex}.image`,
                  role: 'page-block-card',
                  multiple: false,
                  applySelection(paths) {
                    const selected = paths.slice(0, 1);
                    if (selected[0]) {
                      writeItem(itemIndex, 'image', selected[0], 'Выбрать фото пункта');
                      renderItems();
                    }
                    return selected;
                  }
                }) }
              }, [icon('image'), 'Выбрать'])
            ]));
          }
          if (consumedFields.has('items[].imageAlt')) fields.push(element('input', {
            value: item.imageAlt || '', attrs: { 'aria-label': `Alt-текст пункта ${itemIndex + 1}`, placeholder: 'Что изображено' },
            on: { input: (event) => writeItem(itemIndex, 'imageAlt', event.currentTarget.value, 'Изменить alt-текст пункта') }
          }));
          if (consumedFields.has(`${arrayKey}[].isActive`)) {
            const visible = element('input', {
              attrs: { type: 'checkbox', 'aria-label': `Показывать пункт ${itemIndex + 1}` },
              checked: item.isActive !== false,
              on: { change: (event) => writeItem(itemIndex, 'isActive', event.currentTarget.checked, 'Изменить видимость пункта') }
            });
            fields.push(element('label', {}, [visible, ' Показывать пункт']));
          }
        } else {
          fields.push(
            element('div', { className: 'admin-alert admin-alert--warning' }, [icon('warning'), element('p', { text: 'Этот legacy-пункт имеет нестандартный тип и сохраняется без преобразования.' })]),
            element('pre', { className: 'admin-json-editor', text: JSON.stringify(item, null, 2), attrs: { tabindex: '0' } })
          );
        }
        fields.push(itemActions({ index, itemIndex, arrayKey, items, renderItems }));
        holder.append(element('div', { className: 'admin-card' }, [
          element('div', { className: 'admin-card__body admin-section-stack' }, [
            element('strong', { text: `Пункт ${itemIndex + 1}` }),
            ...fields
          ])
        ]));
      });

      const add = () => {
        const next = clone(items);
        if (policy.itemPolicy === 'text-list') next.push('');
        else if (policy.itemPolicy === 'steps') next.push({ title: '', order: (next.length + 1) * 10, isActive: true });
        else next.push({ title: '', text: '', image: '', imageAlt: '', order: (next.length + 1) * 10, isActive: true });
        updateBlock(index, arrayKey, next, 'Добавить пункт секции');
        renderItems();
      };
      holder.append(element('button', {
        className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: add }
      }, [icon('plus'), policy.itemPolicy === 'steps' ? 'Добавить этап' : 'Добавить пункт']));
    }

    renderItems();
    return holder;
  }

  function newBlock(type, templateFamily) {
    const policy = getPageBlockTemplatePolicy(type);
    const fields = new Set(policy?.creatableFieldsByTemplate?.[templateFamily] || []);
    const block = { type, order: (current.length + 1) * 10, isActive: true };
    for (const key of ['title', 'intro', 'text', 'sectionId', 'buttonLabel', 'secondaryButtonLabel']) {
      if (fields.has(key)) block[key] = '';
    }
    if (fields.has('items')) block.items = [];
    if (fields.has('steps')) block.steps = [];
    return block;
  }

  function render() {
    clear(body);
    const record = getContent();
    const templateFamily = resolvePageBlockTemplateFamily(collection, record);
    const creatableTypes = getCreatablePageBlockTypes({ templateFamily });
    current.forEach((block, index) => {
      const policy = getPageBlockTemplatePolicy(block?.type);
      const templateSupport = policy?.supportByTemplate?.[templateFamily];
      const potentiallyRendered = Boolean(templateSupport && templateSupport.status !== 'not-rendered');
      const renderedNow = potentiallyRendered && isPageBlockRenderedForTemplate({
        type: block?.type,
        templateFamily,
        record,
        block,
        pageBlocks: current
      });
      const consumedFields = new Set(templateSupport?.consumedFields || []);
      const title = blockLabel(block?.type);
      const details = element('details', { className: 'admin-details', open: index === 0 }, [
        element('summary', {}, [element('span', {}, [
          `${index + 1}. ${title}`,
          !potentiallyRendered
            ? element('span', { className: 'admin-badge admin-badge--warning', text: 'Legacy — не выводится', style: 'margin-left:8px' })
            : !renderedNow
              ? element('span', { className: 'admin-badge admin-badge--warning', text: 'Сейчас не выбрана шаблоном', style: 'margin-left:8px' })
              : element('span', { className: 'admin-badge admin-badge--success', text: 'Выводится на сайте', style: 'margin-left:8px' })
        ])]),
        element('div', { className: 'admin-details__body admin-section-stack' }, potentiallyRendered ? [
          !renderedNow ? element('div', { className: 'admin-alert admin-alert--warning' }, [icon('warning'), element('p', { text: 'Шаблон сейчас выбирает другую активную секцию этого типа или другой sectionId. Измените порядок/идентификатор осознанно и проверьте локальную страницу.' })]) : null,
          consumedFields.has('title') ? topLevelField(index, 'title', 'Заголовок') : null,
          consumedFields.has('intro') ? topLevelField(index, 'intro', 'Вводный текст', { multiline: true }) : null,
          consumedFields.has('text') ? topLevelField(index, 'text', 'Основной текст', { multiline: true }) : null,
          consumedFields.has('sectionId') ? topLevelField(index, 'sectionId', 'Идентификатор секции', { technical: true }) : null,
          consumedFields.has('buttonLabel') ? topLevelField(index, 'buttonLabel', 'Текст основной кнопки') : null,
          consumedFields.has('secondaryButtonLabel') ? topLevelField(index, 'secondaryButtonLabel', 'Текст дополнительной кнопки') : null,
          ['cards', 'text-list', 'steps'].includes(policy?.itemPolicy) ? arrayEditor(index, policy, consumedFields) : null,
          element('label', { className: 'admin-switch' }, [element('span', { className: 'admin-switch__copy' }, [element('strong', { text: 'Показывать секцию' })]), element('input', { attrs: { type: 'checkbox' }, checked: block.isActive !== false, on: { change: (event) => { current[index] = { ...current[index], isActive: event.currentTarget.checked }; commit('Изменить видимость секции'); } } }), element('span', { className: 'admin-switch__control', attrs: { 'aria-hidden': 'true' } })]),
          element('div', { className: 'admin-list-editor__footer' }, [
            element('button', { className: 'admin-btn admin-btn--small', disabled: index === 0, attrs: { type: 'button' }, on: { click: () => move(index, -1) } }, [icon('arrowUp'), 'Выше']),
            element('button', { className: 'admin-btn admin-btn--small', disabled: index === current.length - 1, attrs: { type: 'button' }, on: { click: () => move(index, 1) } }, [icon('arrowDown'), 'Ниже']),
            element('button', { className: 'admin-btn admin-btn--danger admin-btn--small', attrs: { type: 'button' }, on: { click: () => { current.splice(index, 1); commit('Убрать секцию'); render(); } } }, [icon('trash'), 'Убрать'])
          ])
        ] : [
          element('div', { className: 'admin-alert admin-alert--warning' }, [icon('warning'), element('p', { text: 'Эта legacy-секция не читается текущим production-шаблоном. Она сохраняется побайтно по смыслу и не редактируется обычной формой.' })]),
          element('pre', { className: 'admin-json-editor', text: JSON.stringify(block, null, 2), attrs: { tabindex: '0' } })
        ])
      ]);
      body.append(details);
    });
    if (creatableTypes.length) {
      const select = element('select', { attrs: { 'aria-label': 'Тип новой секции' } }, creatableTypes.map((value) => element('option', { text: blockLabel(value), attrs: { value } })));
      body.append(element('div', { className: 'admin-list-editor__footer' }, [select, element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: () => { current.push(newBlock(select.value, templateFamily)); commit('Добавить секцию'); render(); } } }, [icon('plus'), 'Добавить секцию'])]));
    } else {
      body.append(element('div', { className: 'admin-alert' }, [icon('info'), element('p', { text: 'Для этого шаблона нет секций, которые можно безопасно создать через обычную форму.' })]));
    }
  }
  render();
  const node = element('div', { className: 'admin-field admin-field--wide', dataset: { fieldPath: definition.path } }, [element('span', { className: 'admin-field__label', text: definition.label }), body]);
  return { node, sync: (content, reason) => { if (reason !== 'commit') { current = clone(getAtPath(content, definition.path) || []); render(); } }, focus: () => body.querySelector('summary,button')?.focus() };
}

function navigationItemsControl(definition, collection, initialValue, update) {
  const body = element('div', { className: 'admin-list-editor' });
  let current = Array.isArray(initialValue) ? clone(initialValue) : [];
  function commit(label, coalesceKey = '') { update(definition.path, current.map((item, index) => ({ ...item, order: (index + 1) * 10 })), { label, coalesceKey }); }
  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    commit('Изменить порядок меню'); render();
  }
  function render() {
    clear(body);
    current.forEach((item, index) => {
      const title = element('input', { value: item?.title || '', attrs: { 'aria-label': `Название пункта ${index + 1}`, placeholder: 'Название' }, on: { input: (event) => { current[index] = { ...current[index], title: event.currentTarget.value }; commit('Изменить название пункта меню', `${definition.path}.${index}.title`); } } });
      const href = element('input', { value: item?.href || '', attrs: { 'aria-label': `Ссылка пункта ${index + 1}`, placeholder: '/bezopasnyy-put/' }, on: { input: (event) => { current[index] = { ...current[index], href: event.currentTarget.value }; commit('Изменить ссылку меню', `${definition.path}.${index}.href`); } } });
      const active = element('input', { attrs: { type: 'checkbox', 'aria-label': `Показывать пункт ${index + 1}` }, checked: item?.isActive !== false, on: { change: (event) => { current[index] = { ...current[index], isActive: event.currentTarget.checked }; commit('Изменить видимость пункта меню'); } } });
      body.append(element('div', { className: 'admin-card' }, [element('div', { className: 'admin-card__body admin-section-stack' }, [
        element('div', { style: 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:8px' }, [title, href]),
        element('div', { className: 'admin-list-editor__footer' }, [element('label', {}, [active, ' Показывать']), element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', disabled: index === 0, attrs: { type: 'button', 'aria-label': `Поднять пункт ${index + 1}` }, on: { click: () => move(index, -1) } }, [icon('arrowUp')]), element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', disabled: index === current.length - 1, attrs: { type: 'button', 'aria-label': `Опустить пункт ${index + 1}` }, on: { click: () => move(index, 1) } }, [icon('arrowDown')]), element('button', { className: 'admin-btn admin-btn--icon admin-btn--small', attrs: { type: 'button', 'aria-label': `Удалить пункт ${index + 1}` }, on: { click: () => { current.splice(index, 1); commit('Удалить пункт меню'); render(); } } }, [icon('trash')])])
      ])]));
    });
    body.append(element('button', { className: 'admin-btn admin-btn--small', attrs: { type: 'button' }, on: { click: () => { current.push({ title: '', href: '/', order: (current.length + 1) * 10, isActive: false }); commit('Добавить пункт меню'); render(); } } }, [icon('plus'), 'Добавить пункт меню']));
  }
  render();
  return { node: element('div', { className: 'admin-field admin-field--wide', dataset: { fieldPath: definition.path } }, [element('span', { className: 'admin-field__label', text: definition.label }), body]), sync: (content, reason) => { if (reason !== 'commit') { current = clone(getAtPath(content, definition.path) || []); render(); } }, focus: () => body.querySelector('input,button')?.focus() };
}

function readonlyJsonControl(definition, collection, initialValue) {
  const pre = element('pre', { className: 'admin-json-editor', text: JSON.stringify(initialValue ?? null, null, 2), attrs: { tabindex: '0' } });
  return {
    node: element('div', { className: 'admin-field admin-field--wide', dataset: { fieldPath: definition.path } }, [element('span', { className: 'admin-field__label', text: definition.label }), element('p', { className: 'admin-field__hint', text: 'Существующее значение сохранится. Поле не обещает отдельного визуального эффекта в текущем шаблоне.' }), pre]),
    sync: (content) => { pre.textContent = JSON.stringify(getAtPath(content, definition.path) ?? null, null, 2); },
    focus: () => pre.focus()
  };
}

function relationOptions(definition, relations) {
  const entries = relations?.summaries?.get?.(definition.relationCollection) || [];
  return entries.map((entry) => [entry.slug, entry.title || entry.slug]);
}

function createControl(definition, context) {
  const value = getAtPath(context.content, definition.path);
  const definitionWithOptions = definition.kind === 'relation-select'
    ? { ...definition, options: relationOptions(definition, context.relations) }
    : definition;
  if (definition.kind === 'boolean') return booleanControl(definition, context.collection, value, context.update);
  if (definition.kind === 'list') return listControl(definition, context.collection, value, context.update);
  if (definition.kind === 'specifications') return specificationControl(definition, context.collection, value, context.update);
  if (definition.kind === 'media') return mediaControl(definition, context.collection, value, context.update, context.onMediaRequest, context.resolveMediaSource);
  if (definition.kind === 'gallery') return galleryControl(definition, context.collection, value, context.update, context.onMediaRequest, context.getContent, context.resolveMediaSource);
  if (definition.kind === 'image-view') return imageViewControl(definition, context.collection, value, context.update);
  if (definition.kind === 'page-blocks') return pageBlocksControl(definition, context.collection, value, context.update, context.onMediaRequest, context.getContent);
  if (definition.kind === 'navigation-items') return navigationItemsControl(definition, context.collection, value, context.update);
  if (definition.kind === 'json-readonly') return readonlyJsonControl(definition, context.collection, value);
  return scalarControl(definitionWithOptions, context.collection, value, context.update, { isNew: context.isNew });
}

export function assessCompleteness(collection, content, relations = {}) {
  const groups = groupsForCollection(collection);
  const saveBlockers = [];
  const publicBlockers = [];
  const recommendations = [];
  const visible = isVisibleRecord(collection, content) === true;
  for (const definition of groups.flatMap((entry) => entry.fields)) {
    const value = getAtPath(content, definition.path);
    const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (definition.required && empty) saveBlockers.push({ path: definition.path, message: `Заполните поле «${definition.label}».` });
    if (visible && definition.requiredForPublic && empty) publicBlockers.push({ path: definition.path, message: `Для показа на сайте добавьте: ${definition.label.toLocaleLowerCase('ru-RU')}.` });
  }
  const collectionValues = {};
  for (const [owner, entries] of relations?.summaries || []) {
    collectionValues[owner] = entries.map((entry) => ({
      slug: entry.slug,
      isActive: entry.isActive,
      ...(entry.summary || {})
    }));
  }
  const publicReport = assessPublicCompleteness({
    collection,
    slug: content?.slug,
    value: content,
    corpus: { collectionValues }
  });
  const knownPublicPaths = new Set(publicBlockers.map((item) => item.path));
  for (const issue of publicReport.issues) {
    if (knownPublicPaths.has(issue.path)) continue;
    knownPublicPaths.add(issue.path);
    publicBlockers.push({ path: issue.path, message: issue.userMessage || issue.message });
  }
  const hasSeoFields = groups.some((entry) => entry.fields.some((definition) => definition.path === 'seoTitle'));
  if (hasSeoFields && !String(content?.seoTitle || '').trim()) recommendations.push({ path: 'seoTitle', message: 'Добавьте заголовок для поисковиков.' });
  if (hasSeoFields && !String(content?.seoDescription || '').trim()) recommendations.push({ path: 'seoDescription', message: 'Добавьте описание для поисковиков.' });
  const gallery = Array.isArray(content?.gallery) ? content.gallery : [];
  if (gallery.some((item) => typeof item === 'object' && item && !String(item.alt || '').trim())) {
    recommendations.push({ path: 'gallery', message: 'У части фотографий нет alt-текста.' });
  }
  return Object.freeze({
    saveBlockers,
    publicBlockers,
    recommendations,
    canSave: saveBlockers.length === 0 && publicBlockers.length === 0,
    canShow: publicBlockers.length === 0
  });
}

export function renderRecordEditor({ root, collection, content, relations, update, onMediaRequest, getContent, resolveMediaSource = (value) => value, isNew = false }) {
  const controls = new Map();
  const premiumOnlyNodes = [];
  clear(root);
  const groups = groupsForCollection(collection);
  if (!groups.length) {
    root.append(element('div', { className: 'admin-empty' }, [icon('info'), element('strong', { text: 'Для этой записи пока нет обычной формы' }), element('p', { text: 'Откройте «Технические детали» или выберите другую запись.' })]));
    return Object.freeze({ sync() {}, focusField() {} });
  }

  for (const definition of groups) {
    const section = element(definition.collapsible ? 'details' : 'section', {
      className: definition.collapsible ? 'admin-details' : 'admin-form-section',
      open: !definition.advanced
    });
    const heading = definition.collapsible
      ? element('summary', { text: definition.title })
      : element('div', { className: 'admin-form-section__heading' }, [element('h2', { text: definition.title })]);
    const body = element('div', { className: definition.collapsible ? 'admin-details__body admin-form-section__body' : 'admin-form-section__body' });
    section.append(heading, body);
    for (const fieldDefinition of definition.fields) {
      const control = createControl(fieldDefinition, { collection, content, relations, update, onMediaRequest, getContent, resolveMediaSource, isNew });
      if (fieldDefinition.premiumOnly) {
        control.node.hidden = content?.presentationType !== 'premium';
        premiumOnlyNodes.push(control.node);
      }
      body.append(control.node);
      controls.set(fieldDefinition.path, control);
    }
    root.append(section);
  }

  return Object.freeze({
    sync(nextContent, reason = 'external') {
      for (const control of controls.values()) control.sync(nextContent, reason);
      for (const node of premiumOnlyNodes) node.hidden = nextContent?.presentationType !== 'premium';
    },
    focusField(path) {
      const normalized = String(path || '').replace(/\[\d+\]/gu, '');
      const control = controls.get(path)
        || controls.get(normalized)
        || controls.get(normalized.split('.')[0]);
      control?.focus();
      control?.node?.scrollIntoView?.({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });
}

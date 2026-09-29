import * as engine from '../calculations/cutting.mjs';
import { number } from '../core/numbers.mjs';
import { field, fields, group, rowActions, button, svg, dim, txt, escape, format, table } from '../core/view.mjs';

export const { example, blank, methodologyVersion, limits } = engine;
export const referenceVersions = {};
export const printColumns = [
  { key: 'map', label: 'Карта' }, { key: 'type', label: 'Элемент' }, { key: 'name', label: 'Название / номер детали' },
  { key: 'length', label: 'Длина, мм' }, { key: 'start', label: 'Начало, мм' }, { key: 'end', label: 'Конец, мм' },
];
export const rowTemplates = {
  parts: { id: '', name: '', profile: '', material: '', length: '', quantity: 1 },
  stock: { id: '', name: '', kind: 'stock', profile: '', material: '', length: '', quantity: 1 },
  purchases: { id: '', profile: '', material: '', length: '', quantity: null },
};

/** Only converts displayed numeric text; strict engine validation retains every field. */
export function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Раскрой: ожидается объект.');
  const normalized = { ...input };
  for (const [key, label] of [['kerf', 'Ширина пропила'], ['trimStart', 'Торцовка начала'], ['trimEnd', 'Торцовка конца'], ['minUsefulRemnant', 'Полезный остаток']]) {
    normalized[key] = number(input[key], label, 0, engine.limits.length);
  }
  for (const key of ['parts', 'stock', 'purchases']) {
    if (!Array.isArray(input[key])) continue;
    normalized[key] = input[key].map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Строка ${index + 1}: ожидается объект.`);
      return {
        ...row,
        length: number(row.length, `Строка ${index + 1}, длина`, 0.001, engine.limits.length),
        quantity: key === 'purchases' && (row.quantity === null || row.quantity === '') ? null : number(row.quantity, `Строка ${index + 1}, количество`, 1, engine.limits.pieces, true),
      };
    });
  }
  return normalized;
}

function prepareResult(result) {
  const missing = new Map();
  for (const piece of result.unplaced) {
    const key = `${piece.partId}:${piece.reasonCode}`;
    const row = missing.get(key) || { partId: piece.partId, name: piece.name, profile: piece.profile, material: piece.material, length: piece.length, quantity: 0, reason: piece.reason };
    row.quantity++; missing.set(key, row);
  }
  const extraTables = [
    {
      title: 'Закупка заготовок',
      columns: [{ key: 'sourceId', label: 'ID варианта' }, { key: 'profile', label: 'Профиль' }, { key: 'material', label: 'Материал' }, { key: 'length', label: 'Длина заготовки, мм' }, { key: 'quantity', label: 'Количество, шт.' }, { key: 'totalLength', label: 'Закупка, мм' }, { key: 'cleanPartsLength', label: 'Детали из закупки, мм' }],
      rows: result.procurement,
    },
    {
      title: 'Неразмещённые детали',
      columns: [{ key: 'partId', label: 'ID детали' }, { key: 'name', label: 'Деталь' }, { key: 'profile', label: 'Профиль' }, { key: 'material', label: 'Материал' }, { key: 'length', label: 'Длина, мм' }, { key: 'quantity', label: 'Количество, шт.' }, { key: 'reason', label: 'Причина' }],
      rows: [...missing.values()],
    },
    {
      title: 'Использованное и оставшееся наличие',
      columns: [{ key: 'sourceId', label: 'ID наличия' }, { key: 'name', label: 'Заготовка' }, { key: 'profile', label: 'Профиль' }, { key: 'material', label: 'Материал' }, { key: 'length', label: 'Длина, мм' }, { key: 'available', label: 'Было, шт.' }, { key: 'used', label: 'Использовано, шт.' }, { key: 'remaining', label: 'Осталось, шт.' }],
      rows: result.unusedStock,
    },
  ];
  return { ...result, extraTables };
}

export function calculate(input) { return prepareResult(engine.calculate(normalizeInput(input))); }

function abortError() { const error = new Error('Расчёт отменён.'); error.name = 'AbortError'; return error; }

export function asyncCalculate(input, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    let worker;
    try {
      const normalized = normalizeInput(input);
      worker = new Worker(new URL('../workers/cutting.worker.mjs', import.meta.url), { type: 'module' });
      let settled = false;
      const complete = (error, result) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        worker.terminate();
        if (error) reject(error); else resolve(prepareResult(result));
      };
      const cancel = () => complete(abortError());
      signal?.addEventListener('abort', cancel, { once: true });
      worker.onmessage = ({ data }) => {
        if (data?.error) {
          const error = new Error(typeof data.error === 'string' ? data.error : data.error.message);
          error.name = data.error.name || 'Error';
          complete(error);
        } else if (data?.result) complete(null, data.result);
        else complete(new Error('Не удалось получить карту раскроя. Повторите расчёт.'));
      };
      worker.onerror = (event) => { event.preventDefault?.(); complete(new Error('Не удалось выполнить расчёт раскроя. Перезагрузите страницу и повторите попытку.')); };
      worker.postMessage(normalized);
    } catch (error) { worker?.terminate(); reject(error); }
  });
}

export function form(input) {
  let html = group('Прямые резы 90°', fields(input, [
    field('kerf', 'Ширина пропила', { unit: 'мм' }),
    field('trimStart', 'Торцовка начала', { unit: 'мм' }),
    field('trimEnd', 'Торцовка конца', { unit: 'мм' }),
    field('minUsefulRemnant', 'Минимальный полезный остаток', { unit: 'мм' }),
  ]), 'Торцовка — полная потеря на конце, уже включая её пропил. Применяется к каждой использованной заготовке.');
  const defsFor = (path, index) => {
    const prefix = `${path}.${index}.`;
    const f = (key, label, options = {}) => field(prefix + key, label, options);
    const defs = [];
    if (path !== 'purchases') defs.push(f('name', path === 'parts' ? 'Название детали' : 'Название / отметка', { type: 'text' }));
    if (path === 'stock') defs.push(f('kind', 'Вид наличия', { options: [['stock', 'Мерная заготовка'], ['remnant', 'Существующий остаток']] }));
    defs.push(f('profile', 'Профиль / сечение', { type: 'text', placeholder: 'Труба 40 × 40 × 2' }), f('material', 'Материал', { type: 'text', placeholder: 'Сталь' }), f('length', path === 'parts' ? 'Длина детали' : 'Длина заготовки', { unit: 'мм' }));
    defs.push(f('quantity', path === 'purchases' ? 'Доступно к закупке' : 'Количество', { unit: 'шт.', ...(path === 'purchases' ? { placeholder: 'Без ограничения', hint: 'Пусто — закупка без ограничения количества.' } : {}) }));
    return defs;
  };
  const sections = [
    { path: 'parts', label: 'Детали', row: 'Деталь', action: '+ Добавить деталь', note: 'До 1000 деталей. Профиль и материал должны совпадать с соответствующими заготовками.' },
    { path: 'stock', label: 'В наличии', row: 'Заготовка в наличии', action: '+ Добавить наличие / остаток', note: 'Только существующие заготовки и остатки. У каждой строки конечное количество.' },
    { path: 'purchases', label: 'Можно докупить', row: 'Вариант закупки', action: '+ Добавить вариант закупки', note: 'Эти заготовки ещё не находятся в наличии. Расчёт покажет необходимое количество отдельно.' },
  ];
  for (const section of sections) {
    const rows = input[section.path] || [];
    html += `<section class="tool-input-section"><h3>${escape(section.label)}</h3><p class="tool-hint">${escape(section.note)}</p>`;
    html += rows.map((row, index) => group(`${section.row} ${index + 1}`, fields(input, defsFor(section.path, index)) + rowActions(section.path, index, rows.length))).join('');
    html += button('add-row', section.action, `data-path="${section.path}"`) + '</section>';
  }
  return html;
}

function mapGroups(result) {
  const groups = new Map();
  for (const map of result.maps) {
    const key = JSON.stringify([map.sourceKey, map.length, map.segments.map((segment) => [segment.type, segment.length, segment.partId])]);
    const group = groups.get(key) || { map, maps: [] };
    group.maps.push(map); groups.set(key, group);
  }
  return [...groups.values()];
}

function diagramForGroup(grouped, input, active = '') {
  const { map, maps } = grouped;
  const repeats = maps.length;
  const path = active.match(/^(parts|stock|purchases)\.(\d+)\./);
  const focused = path ? input[path[1]]?.[Number(path[2])] : null;
  const activePart = path?.[1] === 'parts' ? focused?.id : null;
  const activeSource = path && path[1] !== 'parts' && focused?.id === map.sourceId && (path[1] === 'purchases') === (map.kind === 'purchase');
  const x = 40, y = 72, width = 680, barHeight = 76, scale = width / map.length;
  let body = '';
  for (const segment of map.segments) {
    const left = x + segment.start * scale, segmentWidth = segment.length * scale;
    const selected = activeSource || (segment.type === 'part' && activePart === segment.partId) || (segment.type === 'kerf' && active === 'kerf') || (segment.type === 'remnant' && active === 'minUsefulRemnant') || (segment.type === 'trim' && ((segment.start === 0 && active === 'trimStart') || (segment.end === map.length && active === 'trimEnd')));
    const fill = segment.type === 'part' ? 'var(--tool-ink)' : segment.type === 'remnant' ? '#a9c9ba' : segment.type === 'kerf' ? '#b25f35' : 'url(#tool-hatch)';
    body += `<g${selected ? ' class="is-active"' : ''}><title>${escape(`${segment.label}: ${format(segment.length)} мм; от ${format(segment.start)} до ${format(segment.end)} мм`)}</title><rect x="${left}" y="${y}" width="${segmentWidth}" height="${barHeight}" fill="${fill}" stroke="${selected ? '#b25f35' : 'var(--tool-paper)'}" stroke-width="${selected ? 3 : segment.type === 'part' ? 1 : 0}"/>`;
    if (segment.type === 'part' && segmentWidth >= Math.max(96, format(segment.length).length * 23)) {
      const partIndex = input.parts.findIndex((row) => row.id === segment.partId) + 1;
      body += txt(left + segmentWidth / 2, y + 29, `Д${partIndex}`, 'class="tool-cut-part-label" text-anchor="middle" style="font-size:28px;fill:white"');
      body += txt(left + segmentWidth / 2, y + 61, `${format(segment.length)}`, 'class="tool-cut-part-label" text-anchor="middle" style="font-size:28px;fill:white"');
    }
    if (segment.type === 'kerf') body += `<path d="M${left + segmentWidth / 2} ${y - 11}V${y}" stroke="#b25f35" stroke-width="2"/>`;
    body += '</g>';
  }
  body += dim(x, 193, x + width, 193, `${format(map.length)} мм`, activeSource ? 'length' : '', active).replace('<text ', '<text style="font-size:28px" ');
  body += txt(40, 37, `${map.kind === 'purchase' ? 'Закупка' : map.kind === 'remnant' ? 'Остаток в наличии' : 'Заготовка в наличии'} · ${format(map.length)} мм`, 'style="font-size:28px"');
  body += txt(40, 247, `Пропил: ${format(map.kerfLength)} мм · хвост: ${format(map.remainingLength)} мм`, 'style="font-size:28px"');
  const numbers = maps.map((item) => item.number);
  const numberText = numbers.length > 12 ? `${numbers.slice(0, 12).join(', ')}… (${numbers.length} карт)` : numbers.join(', ');
  const details = map.parts.map((part) => {
    const row = input.parts.findIndex((item) => item.id === part.partId) + 1;
    return `Д${row}: ${part.name}${repeats === 1 ? ` №${part.pieceNumber}` : ''} — ${format(part.length)} мм`;
  });
  const uniqueDetails = [...new Set(details)];
  const title = repeats > 1 ? `Карты ${numberText} · ${repeats} одинаковых схем` : `Карта ${map.number} · заготовка ${map.sourceOrdinal}`;
  return `<section class="tool-cut-map"><h3>${escape(title)}</h3><p class="tool-hint">${escape(map.profile)} · ${escape(map.material)} · ID ${escape(map.sourceId)}. Линейный масштаб: 1 мм = ${escape(format(scale, 4))} ед. схемы.</p>${svg(body, `${title}. ${map.profile}, ${map.material}. Длина ${map.length} мм.`, 275)}<ul class="tool-cut-parts">${uniqueDetails.map((detail) => `<li>${escape(detail)}</li>`).join('')}</ul>${repeats > 1 ? '<p class="tool-hint">Размеры одинаковы во всех картах группы. Номера экземпляров деталей и физических заготовок приведены в ведомости.</p>' : ''}</section>`;
}

export function diagram(result, input, active = '') {
  if (!result.maps.length) return '<p class="tool-hint">Ни одна деталь не размещена. Причины указаны в результате; добавьте подходящие заготовки или варианты закупки.</p>';
  const grouped = mapGroups(result);
  const header = `<p class="tool-hint">${result.maps.length} карт, ${grouped.length} разных схем. Размеры вдоль исходной заготовки в мм. Зелёный хвост — полезный остаток; штриховка — отход или торцовка; рыжие метки — пропилы.</p>`;
  const visible = grouped.slice(0, 12).map((item) => diagramForGroup(item, input, active)).join('');
  const rest = grouped.length > 12 ? `<details class="tool-more-maps"><summary>Показать остальные схемы (${grouped.length - 12})</summary>${grouped.slice(12).map((item) => diagramForGroup(item, input, active)).join('')}</details>` : '';
  return header + visible + rest;
}

export function printDiagram(result, input) { return mapGroups(result).map((item) => diagramForGroup(item, input)).join(''); }

export function printInputs(input) {
  const rows = [
    { field: 'Ширина пропила, мм', value: input.kerf }, { field: 'Торцовка начала, мм (с её пропилом)', value: input.trimStart },
    { field: 'Торцовка конца, мм (с её пропилом)', value: input.trimEnd }, { field: 'Минимальный полезный остаток, мм', value: input.minUsefulRemnant },
  ];
  for (const [path, label] of [['parts', 'Деталь'], ['stock', 'Наличие'], ['purchases', 'Вариант закупки']]) {
    input[path].forEach((row, index) => {
      const prefix = `${label} ${index + 1}`;
      rows.push({ field: `${prefix}: название / профиль / материал`, value: [row.name, row.profile, row.material].filter(Boolean).join(' · ') });
      if (path === 'stock') rows.push({ field: `${prefix}: вид`, value: row.kind === 'remnant' ? 'Конечный остаток в наличии' : 'Мерная заготовка в наличии' });
      rows.push({ field: `${prefix}: длина, мм`, value: row.length });
      rows.push({ field: `${prefix}: количество, шт.`, value: path === 'purchases' && (row.quantity === null || row.quantity === '') ? 'Без ограничения: можно докупить по потребности' : row.quantity });
    });
  }
  return table({ columns: [{ key: 'field', label: 'Параметр' }, { key: 'value', label: 'Значение' }], rows });
}

export function extra(result) {
  const blocks = result.extraTables || prepareResult(result).extraTables;
  return `<section><h3>Как выбрана карта</h3><p>${escape(result.criteria)}</p><p class="tool-hint">Резов по деталям: ${format(result.totals.cuttingPasses)}; торцовочных операций: ${format(result.totals.trimPasses)}. Все длины в таблицах ниже — мм.</p></section>` + blocks.map((block) => `<section class="tool-cut-extra"><h3>${escape(block.title)}</h3>${block.rows.length ? table(block) : `<p class="tool-hint">${block.title === 'Закупка заготовок' ? 'Закупка не требуется для размещённых деталей.' : block.title === 'Неразмещённые детали' ? 'Все детали размещены.' : 'Наличие не задано.'}</p>`}${block.title === 'Закупка заготовок' && block.rows.length ? `<p class="tool-hint">В металлокомплект переносится длина закупаемых заготовок. Для оценки массы укажите известную массу метра либо выберите форму и размеры.</p>${button('to-metal', 'Оценить массу и стоимость закупки')}` : ''}</section>`).join('');
}

export function toMetal(result) {
  return {
    rows: result.procurement.map((row) => ({
      name: `${row.profile} · ${row.material}`,
      shape: 'known', width: '', height: '', thickness: '', diameter: '', length: row.length, quantity: row.quantity,
      angle: '40x40x4', massPerMetre: '', price: '', priceUnit: 'kg',
    })),
  };
}

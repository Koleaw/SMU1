import * as engine from '../calculations/building.mjs';
import { field, fields, group, rowActions, button, svg, dim, txt, escape, format, table } from '../core/view.mjs';

export const { calculate, example, blank, methodologyVersion, referenceVersions } = engine;
export const rowLimits = { zones: engine.limits.zones, openings: engine.limits.openings };
export const rowTemplates = {
  zones: { id: '', name: '', x: null, y: null, length: null, width: null },
  openings: { id: '', name: '', side: 'south', position: null, width: null, height: null },
};
const dimensionField = (path, label, options = {}) => field(path, label, { unit: 'мм', placeholder: 'Неизвестно', ...options });

export function form(input) {
  let html = group('Назначение и место', fields(input, [
    field('purpose', 'Что планируется разместить', { type: 'text', maxlength: 2000, placeholder: 'Склад, цех, другое назначение' }),
    field('region', 'Регион строительства', { type: 'text', maxlength: 2000, placeholder: 'Неизвестно' }),
    field('thermal', 'Исполнение', { options: Object.entries(engine.thermalNames) }),
  ]), 'БВЗ — быстровозводимое здание. Это задание для обсуждения, а не инженерный проект. Неизвестные данные можно оставить пустыми: они попадут в список уточнений.');
  html += group('Габариты и высоты', fields(input, [
    dimensionField('length', 'Наружная длина L'), dimensionField('width', 'Наружная ширина W'),
    dimensionField('externalHeight', 'Наружная высота'), dimensionField('usefulHeight', 'Требуемая полезная высота', { hint: 'Свободная высота для эксплуатации, отдельно от наружной.' }),
  ]), 'Наружное пятно не равно полезной площади. Толщина стен и колонны в эту схему не входят.');
  html += '<section class="tool-input-section"><h3>Функциональные зоны</h3><p class="tool-hint">Начало координат — нижний левый угол плана. X направлена вправо, Y — вверх. Зоны — условные прямоугольники без расчёта стен.</p>';
  html += input.zones.map((zone, i) => group(`Зона ${i + 1}`, fields(input, [
    field(`zones.${i}.name`, 'Название / функция', { type: 'text' }),
    dimensionField(`zones.${i}.x`, 'Положение X'), dimensionField(`zones.${i}.y`, 'Положение Y'),
    dimensionField(`zones.${i}.length`, 'Длина зоны'), dimensionField(`zones.${i}.width`, 'Ширина зоны'),
  ]) + rowActions('zones', i, input.zones.length))).join('');
  html += button('add-row', '+ Добавить зону', 'data-path="zones"') + '</section>';
  html += '<section class="tool-input-section"><h3>Ворота, двери и другие проёмы</h3><p class="tool-hint">Стороны пронумерованы на плане. Положение задаётся от указанного начала стороны; это пожелания к проёмам для дальнейшего согласования.</p>';
  html += input.openings.map((opening, i) => group(`Проём ${i + 1}`, fields(input, [
    field(`openings.${i}.name`, 'Название / вид', { type: 'text' }),
    field(`openings.${i}.side`, 'Сторона и начало отсчёта', { options: Object.entries(engine.sideNames) }),
    dimensionField(`openings.${i}.position`, 'Положение начала проёма'), dimensionField(`openings.${i}.width`, 'Ширина проёма'), dimensionField(`openings.${i}.height`, 'Высота проёма'),
  ]) + rowActions('openings', i, input.openings.length))).join('');
  html += button('add-row', '+ Добавить проём', 'data-path="openings"') + '</section>';
  html += group('Дополнительное задание', fields(input, [
    field('equipment', 'Оборудование и пожелания к его размещению', { type: 'textarea', placeholder: 'Если известно' }),
    field('engineering', 'Инженерные пожелания', { type: 'textarea' }),
    field('site', 'Что известно об участке и подъездах', { type: 'textarea' }),
    field('timeline', 'Желаемые сроки заказчика', { type: 'textarea' }),
    field('budget', 'Бюджет, указанный заказчиком', { unit: '₽', placeholder: 'Не указан', hint: 'Необязательный ориентир. Стоимость строительства не рассчитывается.' }),
  ]));
  return html;
}

const label = (x, y, value, attrs = '') => txt(x, y, value, `style="font-size:28px" ${attrs}`);
const dimension = (...args) => dim(...args).replace('<text ', '<text style="font-size:28px" ');
const colors = ['#adc4b7', '#b3c5d2', '#d8c19e', '#c8c0d0', '#b9c8a6', '#d3b9b0'];

export function diagram(result, input, active = '') {
  const g = result.geometry;
  if (!g.available) return `<div class="tool-building-plan">${svg(label(380, 150, 'Размерный план пока недоступен', 'text-anchor="middle"') + label(380, 200, 'Укажите наружную длину и ширину', 'text-anchor="middle"'), 'Для плана нужны наружные длина и ширина. Остальное задание сохранено.', 280)}<p class="tool-hint">Задание можно сохранить и распечатать с неизвестными значениями. Площадь и масштаб не подставляются автоматически.</p></div>`;
  const scale = Math.min(480 / g.length, 260 / g.width);
  const w = g.length * scale, h = g.width * scale, x = 140 + (480 - w) / 2, y = 110 + (260 - h) / 2;
  const sx = (value) => x + value * scale, sy = (value) => y + h - value * scale;
  const selectedZone = Number(active.match(/^zones\.(\d+)\./)?.[1] ?? -1);
  const selectedOpening = Number(active.match(/^openings\.(\d+)\./)?.[1] ?? -1);
  let body = label(28, 34, 'Предварительный план · наружный контур');
  body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(--tool-paper)" stroke="var(--tool-ink)" stroke-width="2"/>`;
  g.zones.forEach((zone, index) => {
    if (!zone.complete) return;
    const zx = sx(zone.x), zy = sy(zone.y + zone.width), zw = zone.length * scale, zh = zone.width * scale, selected = index === selectedZone;
    body += `<g${selected ? ' class="is-active"' : ''}><title>${escape(`${zone.label}: ${format(zone.length)} × ${format(zone.width)} мм; X ${format(zone.x)}, Y ${format(zone.y)} мм`)}</title><rect x="${zx}" y="${zy}" width="${zw}" height="${zh}" fill="${colors[index % colors.length]}" stroke="${selected ? '#a96234' : '#6b8378'}" stroke-width="${selected ? 4 : 1}"/>`;
    if (zw >= 36 && zh >= 30) body += label(zx + zw / 2, zy + zh / 2 + 8, `З${index + 1}`, 'text-anchor="middle"');
    body += '</g>';
  });
  g.openings.forEach((opening, index) => {
    if (!opening.complete) return;
    let a, b;
    const p = opening.position, end = p + opening.width;
    if (opening.side === 'south') { a = [sx(p), sy(0)]; b = [sx(end), sy(0)]; }
    if (opening.side === 'east') { a = [sx(g.length), sy(p)]; b = [sx(g.length), sy(end)]; }
    if (opening.side === 'north') { a = [sx(g.length - p), sy(g.width)]; b = [sx(g.length - end), sy(g.width)]; }
    if (opening.side === 'west') { a = [sx(0), sy(g.width - p)]; b = [sx(0), sy(g.width - end)]; }
    const selected = selectedOpening === index;
    const vertical = opening.side === 'east' || opening.side === 'west';
    body += `<g${selected ? ' class="is-active"' : ''}><title>${escape(`${opening.label}: сторона ${engine.sideNames[opening.side]}, положение ${format(p)} мм, ширина ${format(opening.width)} мм, высота ${format(opening.height)} мм`)}</title><path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="var(--tool-paper)" stroke-width="9"/><path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="${selected ? '#8f3d11' : '#a96234'}" stroke-width="${selected ? 7 : 4}" stroke-dasharray="8 4"/>`;
    body += label((a[0] + b[0]) / 2 + (vertical ? opening.side === 'east' ? -10 : 10 : 0), (a[1] + b[1]) / 2 + (vertical ? 8 : opening.side === 'south' ? -13 : 27), `П${index + 1}`, `text-anchor="${vertical ? opening.side === 'east' ? 'end' : 'start' : 'middle'}"`);
    body += '</g>';
  });
  body += dimension(x, 76, x + w, 76, `L ${format(g.length)} мм`, 'length', active === 'length' ? active : '');
  body += `<g transform="translate(85 ${y + h}) rotate(-90)">${dimension(0, 0, h, 0, `W ${format(g.width)} мм`, 'width', active === 'width' ? active : '')}</g>`;
  body += label(x + w / 2, y + h + 30, '1 →', 'text-anchor="middle"') + label(x + w + 22, y + h / 2, '2 ↑') + label(x + w / 2, y - 10, '← 3', 'text-anchor="middle"') + label(x - 20, y + h / 2, '4 ↓', 'text-anchor="end"');
  body += `<circle cx="${x}" cy="${y + h}" r="4" fill="var(--tool-ink)"/>` + label(x - 8, y + h + 28, '0', 'text-anchor="end"');
  const mmValue = value => value === null ? 'неизвестно' : `${format(value)} мм`;
  body += label(28, 426, `Наружная высота: ${mmValue(g.externalHeight)}`);
  body += label(28, 458, `Требуемая полезная высота: ${mmValue(g.usefulHeight)}`);
  const legends = [...g.zones.map((zone, i) => `<li><strong>З${i + 1}</strong> — ${escape(zone.label)}: ${escape(mmValue(zone.length))} × ${escape(mmValue(zone.width))}; X ${escape(mmValue(zone.x))}, Y ${escape(mmValue(zone.y))}${zone.complete ? '' : ' · на плане не размещена'}</li>`), ...g.openings.map((opening, i) => `<li><strong>П${i + 1}</strong> — ${escape(opening.label)}: ширина ${escape(mmValue(opening.width))}, высота ${escape(mmValue(opening.height))}; сторона ${engine.sideNames[opening.side].slice(0, 1)}, начало ${escape(mmValue(opening.position))}${opening.complete ? '' : ' · на плане не размещён'}</li>`)];
  return `<div class="tool-building-plan">${svg(body, 'Предварительный план задания. Зоны — прямоугольники, проёмы — пунктир, стороны пронумерованы.', 480)}<p class="tool-hint">Масштаб: 1 мм = ${escape(format(scale, 4))} ед. схемы. X вправо, Y вверх от нижнего левого угла. Номера сторон условные, ориентация по сторонам света не задана.</p>${legends.length ? `<ul class="tool-plan-legend">${legends.join('')}</ul>` : ''}<p class="tool-hint">Толщина стен, перегородки, колонны и противопожарные расстояния не показаны. Размеры проёмов требуют согласования с изготовителем.</p></div>`;
}

export const printDiagram = (result, input) => diagram(result, input);
export const printInputs = () => '<p>Все введённые параметры и пожелания приведены в разделе «Задано заказчиком». Неизвестные значения перечислены в разделе «Нужно уточнить». Числа в этих разделах даны в подписанных единицах.</p>';

export function extra(result) {
  return result.extraTables.map((section) => `<section class="tool-building-brief"><h3>${escape(section.title)}</h3>${section.rows.length ? `<div class="tool-building-screen-brief"><dl>${section.rows.map(row => `<div><dt>${escape(row.parameter)}</dt><dd>${escape(format(row.value))}${row.unit ? ` ${escape(row.unit)}` : ''}</dd>${row.detail ? `<dd class="tool-hint">${escape(row.detail)}</dd>` : ''}</div>`).join('')}</dl></div><div class="tool-building-print-brief">${table(section)}</div>` : '<p class="tool-hint">Данных пока нет.</p>'}</section>`).join('');
}

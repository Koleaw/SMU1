import * as engine from '../calculations/fence.mjs';
import { field, fields, group, rowActions, button, svg, dim, txt, escape, format } from '../core/view.mjs';

export const { calculate, example, blank, methodologyVersion } = engine;
export const rowTemplates = { openings: { id: '', name: 'Проём', side: 0, position: '', width: '' } };
export function onInput(input, path) {
  if (path === 'type' && input.type === 'line') for (const opening of input.openings) opening.side = 0;
}
export function form(input) {
  const defs = [field('type', 'План', { options: [['line', 'Прямая линия'], ['rectangle', 'Замкнутый прямоугольник']] }), field('length', 'Длина по осям L', { unit: 'мм' })];
  if (input.type === 'rectangle') defs.push(field('width', 'Ширина по осям W', { unit: 'мм' }));
  defs.push(field('height', 'Высота ограждения', { unit: 'мм' }), field('maxStep', 'Максимальный шаг по осям', { unit: 'мм' }));
  return group('Геометрия по осям опор', fields(input, defs), 'Все длины отсчитываются между центрами опор. Фактический равномерный шаг на каждом участке не превышает заданный.')
    + input.openings.map((opening, i) => group(`Проём ${i + 1}`, fields(input, [field(`openings.${i}.name`, 'Название', { type: 'text', maxlength: 120 }), field(`openings.${i}.side`, 'Сторона', { options: (input.type === 'line' ? [0] : [0, 1, 2, 3]).map(side => [side, `Сторона ${side + 1}`]) }), field(`openings.${i}.position`, 'От начала стороны', { unit: 'мм', hint: 'По направлению обхода на схеме.' }), field(`openings.${i}.width`, 'Ширина по осям', { unit: 'мм' })]) + rowActions('openings', i, input.openings.length), 'Осевая ширина проёма больше свободной ширины въезда на величину, зависящую от стоек и креплений.')).join('')
    + button('add-row', '+ Добавить ворота / калитку', 'data-path="openings"');
}
const label = (x, y, value, attrs = '') => txt(x, y, value, `style="font-size:clamp(25px,calc(41px - 2vw),33px)" ${attrs}`);
const dimension = (...args) => dim(...args).replace('<text ', '<text style="font-size:clamp(25px,calc(41px - 2vw),33px)" ');
const vertical = (x, y, height, value, key, active) => `<g transform="translate(${x} ${y + height}) rotate(-90)">${dimension(0, 0, height, 0, value, key, active)}</g>`;
export function diagram(result, input, active = '') {
  const g = result.geometry;
  const scale = Math.min(500 / g.length, g.closed ? 270 / g.width : Infinity);
  const x = 145 + (500 - g.length * scale) / 2, y = g.closed ? 120 + (270 - g.width * scale) / 2 : 225;
  const w = g.length * scale, h = g.width * scale;
  let body = label(28, 36, 'План осей опор · размеры в мм');
  const point = (px, py) => [x + px * scale, y + py * scale];
  const selectedOpeningIndex = Number(active.match(/^openings\.(\d+)\./)?.[1] ?? 0);
  const selected = g.openings[selectedOpeningIndex];
  for (const span of g.spans) {
    const [x1, y1] = point(span.x1, span.y1), [x2, y2] = point(span.x2, span.y2);
    body += `<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${active === 'maxStep' ? '#b34e14' : 'var(--tool-ink)'}" stroke-width="5"/>`;
  }
  for (const opening of g.openings) {
    const [x1, y1] = point(opening.x1, opening.y1), [x2, y2] = point(opening.x2, opening.y2);
    body += `<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="#b34e14" stroke-width="${selected === opening ? 5 : 3}" stroke-dasharray="10 6"/>`;
  }
  const nodeLabelStride = g.nodes.length <= 22 ? 1 : Math.ceil(g.nodes.length / 16);
  for (let i = 0; i < g.nodes.length; i++) {
    const node = g.nodes[i], [nx, ny] = point(node.x, node.y);
    const special = node.roles.includes('corner') || node.openingIds.length;
    body += `<circle cx="${nx}" cy="${ny}" r="${special ? 5 : 3.5}" fill="var(--tool-paper)" stroke="${node.openingIds.length ? '#b34e14' : 'var(--tool-ink)'}" stroke-width="2"/>`;
    if (i % nodeLabelStride === 0 && (g.nodes.length <= 22 || special)) {
      const isTop = node.y === 0, isBottom = node.y === g.width && g.closed;
      const ly = isTop ? ny + 29 : isBottom ? ny - 15 : ny + 8;
      const lx = !isTop && !isBottom ? nx + (node.x === 0 ? 14 : -14) : nx;
      body += txt(lx, ly, node.id, `style="font-size:clamp(21px,calc(37px - 2vw),29px)" text-anchor="${!isTop && !isBottom ? node.x === 0 ? 'start' : 'end' : 'middle'}"`);
    }
  }
  body += dimension(x, 78, x + w, 78, `L ${format(g.length)} мм`, 'length', active);
  if (g.closed) {
    body += vertical(81, y, h, `W ${format(g.width)} мм`, 'width', active);
    body += label(x + w / 2, y - 23, '1 →', 'text-anchor="middle"') + label(x + w + 24, y + h / 2, '2 ↓') + label(x + w / 2, y + h + 40, '← 3', 'text-anchor="middle"') + label(x - 22, y + h / 2, '↑ 4', 'text-anchor="end"');
  } else body += label(x, y - 28, 'Сторона 1 →');
  if (selected) {
    const [x1, y1] = point(selected.x1, selected.y1), [x2, y2] = point(selected.x2, selected.y2);
    const key = `openings.${selectedOpeningIndex}.width`;
    const name = selected.name.length > 24 ? `${selected.name.slice(0, 22)}…` : selected.name;
    body += label(28, 488, `${name}: ${format(selected.width)} мм по осям`, active.startsWith(`openings.${selectedOpeningIndex}.`) ? 'class="is-active"' : '');
    if (selected.side === 0 || selected.side === 2) body += dimension(Math.min(x1, x2), selected.side === 0 ? y1 - 3 : y1 + 3, Math.max(x1, x2), selected.side === 0 ? y1 - 3 : y1 + 3, '', key, active);
    else body += vertical(selected.side === 1 ? x1 + 5 : x1 - 5, Math.min(y1, y2), Math.abs(y2 - y1), '', key, active);
  }
  const sampled = g.nodes.length > 22 ? ' Подписи узлов на схеме показаны выборочно; полная нумерация и координаты сохранены в ведомости.' : '';
  return svg(body, 'Оси ограждения. Кружки — уникальные опорные узлы; пунктир — проёмы.', 530) + `<p class="tool-hint">Синий — пролёты; оранжевый пунктир — проёмы. Кружки обозначают центры опор. Стрелки показывают начало отсчёта сторон.${escape(sampled)}</p><p class="tool-hint">Масштаб: 1 мм = ${escape(format(scale, 4))} ед. схемы. Высота ограждения: ${escape(format(g.height))} мм.</p>`;
}
export function extra(result) {
  const steps = [...new Set(result.geometry.sections.map(section => format(section.step)))];
  return `<p class="tool-hint">Фактические шаги по осям: <strong>${escape(steps.length ? steps.join('; ') : 'пролётов нет')}${steps.length ? ' мм' : ''}</strong>. Баланс: ${escape(format(result.totals.fenceLengthMm / 1000))} м ограждения + ${escape(format(result.totals.openingLengthMm / 1000))} м проёмов = ${escape(format(result.totals.perimeterMm / 1000))} м.</p>`;
}

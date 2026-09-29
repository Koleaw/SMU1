import * as engine from '../calculations/foundation.mjs';
import { field, fields, group, rowActions, button, svg, dim, txt, escape, format } from '../core/view.mjs';

export const { methodologyVersion } = engine;
const complete = input => ({ ...structuredClone(input), formwork: { ...input.formwork, outerSides: '0,1,2,3', innerSides: '0,1,2,3' } });
export const example = complete(engine.example);
export const blank = complete(engine.blank);
export const rowTemplates = { layers: { id: '', name: 'Подготовительный слой', area: 'footprint', thickness: '' } };
const sideOptions = [['0,1,2,3', 'Все четыре стороны'], ['0,2', 'Стороны 1 и 3'], ['1,3', 'Стороны 2 и 4'], ['0', 'Только сторона 1'], ['1', 'Только сторона 2'], ['2', 'Только сторона 3'], ['3', 'Только сторона 4'], ['0,1', 'Стороны 1 и 2'], ['0,3', 'Стороны 1 и 4'], ['1,2', 'Стороны 2 и 3'], ['2,3', 'Стороны 3 и 4'], ['0,1,2', 'Стороны 1, 2 и 3'], ['0,1,3', 'Стороны 1, 2 и 4'], ['0,2,3', 'Стороны 1, 3 и 4'], ['1,2,3', 'Стороны 2, 3 и 4']];
export function calculate(input) {
  const raw = structuredClone(input);
  if (raw.formwork && typeof raw.formwork === 'object') for (const kind of ['outerSides', 'innerSides']) {
    if (typeof raw.formwork[kind] === 'string') {
      if (!sideOptions.some(([value]) => value === raw.formwork[kind])) throw new Error('Выберите допустимое сочетание сторон опалубки.');
      raw.formwork[kind] = raw.formwork[kind].split(',').map(Number);
    }
  }
  return engine.calculate(raw);
}
export function onInput(input, path) {
  if (path === 'type' && input.type === 'slab') {
    input.formwork.inner = false;
    for (const layer of input.layers) if (layer.area === 'strip') layer.area = 'footprint';
  }
}
export function form(input) {
  const dims = [field('type', 'Геометрия', { options: [['slab', 'Прямоугольная плита'], ['strip', 'Замкнутая лента']] }), field('length', 'Наружная длина L', { unit: 'мм' }), field('width', 'Наружная ширина W', { unit: 'мм' }), field('height', 'Высота бетона H', { unit: 'мм' })];
  if (input.type === 'strip') dims.push(field('stripWidth', 'Ширина ленты b', { unit: 'мм' }));
  dims.push(field('reservePercent', 'Дополнительный запас', { unit: '%' }));
  let html = group('Заданная геометрия', fields(input, dims), 'Размеры плиты или ленты задаёт пользователь. Инструмент не подбирает конструкцию фундамента.');
  const forms = [field('formwork.outer', 'Наружные стороны', { type: 'checkbox' })];
  if (input.type === 'strip') forms.push(field('formwork.inner', 'Внутренние стороны', { type: 'checkbox' }));
  if (input.formwork.outer) forms.push(field('formwork.outerSides', 'Какие наружные стороны', { options: sideOptions }));
  if (input.type === 'strip' && input.formwork.inner) forms.push(field('formwork.innerSides', 'Какие внутренние стороны', { options: sideOptions }));
  forms.push(field('formwork.height', 'Формуемая высота', { unit: 'мм', hint: 'Задаётся отдельно от высоты бетона.' }));
  html += group('Опалубка', fields(input, forms), 'Стороны 1 и 3 идут вдоль длины, 2 и 4 — вдоль ширины. Выберите только поверхности, для которых нужна опалубка.');
  html += group('Подготовительные слои', '<p class="tool-hint">Порядок сверху вниз: первый слой непосредственно под бетоном. Коэффициенты уплотнения не применяются.</p>');
  html += input.layers.map((layer, i) => group(`Слой ${i + 1}`, fields(input, [field(`layers.${i}.name`, 'Название слоя', { type: 'text', maxlength: 120 }), field(`layers.${i}.area`, 'Область', { options: input.type === 'strip' ? [['footprint', 'Всё прямоугольное пятно'], ['strip', 'Только под лентой']] : [['footprint', 'Всё прямоугольное пятно']] }), field(`layers.${i}.thickness`, 'Толщина слоя', { unit: 'мм' })]) + rowActions('layers', i, input.layers.length))).join('');
  return html + button('add-row', '+ Добавить слой', 'data-path="layers"');
}

const label = (x, y, value, attrs = '') => txt(x, y, value, `style="font-size:clamp(25px,calc(41px - 2vw),33px)" ${attrs}`);
const dimension = (...args) => dim(...args).replace('<text ', '<text style="font-size:clamp(25px,calc(41px - 2vw),33px)" ');
const vertical = (x, y, height, value, key, active) => `<g transform="translate(${x} ${y + height}) rotate(-90)">${dimension(0, 0, height, 0, value, key, active)}</g>`;
const layerColors = ['#d5bc92', '#a7bbc0', '#c8c8bb', '#bab5aa', '#bed3c1', '#ded0a7', '#c1bdcd', '#bbc8d3'];

export function diagram(result, input, active = '') {
  const g = result.geometry;
  const scale = Math.min(490 / g.length, 260 / g.width);
  const x = 135 + (490 - g.length * scale) / 2, y = 120 + (260 - g.width * scale) / 2;
  const w = g.length * scale, h = g.width * scale;
  let plan = label(28, 35, 'План · наружные размеры');
  plan += g.planRects.map(rect => `<rect x="${x + rect.x * scale}" y="${y + rect.y * scale}" width="${rect.width * scale}" height="${rect.height * scale}" fill="${active === 'stripWidth' ? '#d99c71' : '#9fb8c2'}" stroke="var(--tool-ink)" stroke-width="1.5"/>`).join('');
  const edge = (kind, side) => {
    const inset = kind === 'inner' ? g.stripWidth : 0;
    const left = x + inset * scale, top = y + inset * scale;
    const right = x + (g.length - inset) * scale, bottom = y + (g.width - inset) * scale;
    return [[left, top, right, top], [right, top, right, bottom], [right, bottom, left, bottom], [left, bottom, left, top]][side];
  };
  for (const form of g.formworkEdges) {
    const [x1, y1, x2, y2] = edge(form.kind, form.side);
    const isActive = active.startsWith(`formwork.${form.kind}`);
    plan += `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${isActive ? '#b34e14' : '#a96234'}" stroke-width="${isActive ? 6 : 3}" stroke-dasharray="9 5" fill="none"/>`;
  }
  plan += dimension(x, 82, x + w, 82, `${format(g.length)} мм`, 'length', active);
  plan += vertical(85, y, h, `${format(g.width)} мм`, 'width', active);
  if (g.stripWidth) plan += dimension(x, 412, x + g.stripWidth * scale, 412, `b ${format(g.stripWidth)} мм`, 'stripWidth', active);
  plan += label(x + w / 2, y - 8, '1', 'text-anchor="middle"') + label(x + w + 20, y + h / 2 + 8, '2') + label(x + w / 2, y + h + 28, '3', 'text-anchor="middle"') + label(x - 22, y + h / 2 + 8, '4', 'text-anchor="end"');
  const top = Math.min(0, g.height - result.input.formwork.height);
  const bottom = Math.max(...g.sectionRects.map(rect => rect.y + rect.height));
  const sectionScale = Math.min(540 / g.length, 210 / (bottom - top));
  const sx = (760 - g.length * sectionScale) / 2, sy = 90 + (210 - (bottom - top) * sectionScale) / 2 - top * sectionScale;
  let section = label(28, 35, 'Разрез по середине ширины');
  for (const rect of g.sectionRects) {
    const layerIndex = g.layers.findIndex(layer => rect.id === layer.id || rect.id === `${layer.id}-left` || rect.id === `${layer.id}-right`);
    const selected = layerIndex >= 0 && active.startsWith(`layers.${layerIndex}.`);
    section += `<rect x="${sx + rect.x * sectionScale}" y="${sy + rect.y * sectionScale}" width="${rect.width * sectionScale}" height="${Math.max(0.5, rect.height * sectionScale)}" fill="${selected ? '#d99c71' : layerIndex < 0 ? '#9fb8c2' : layerColors[layerIndex]}" stroke="${selected ? '#b34e14' : '#637274'}" stroke-width="${selected ? 3 : 1}"/>`;
  }
  section += vertical(sx - 36, sy, g.height * sectionScale, '', 'height', active);
  if (result.input.formwork.outer || result.input.formwork.inner) section += vertical(sx + g.length * sectionScale + 42, sy + (g.height - result.input.formwork.height) * sectionScale, result.input.formwork.height * sectionScale, '', 'formwork.height', active);
  section += dimension(sx, 332, sx + g.length * sectionScale, 332, `${format(g.length)} мм`, 'length', active);
  section += label(28, 378, `Бетон H ${format(g.height)} мм`, active === 'height' ? 'class="is-active"' : '');
  if (result.input.formwork.outer || result.input.formwork.inner) section += label(28, 414, `Опалубка ${format(result.input.formwork.height)} мм`, active === 'formwork.height' ? 'class="is-active"' : '');
  const legend = g.layers.map((layer, i) => `<span style="display:inline-block;margin-right:12px"><span aria-hidden="true" style="display:inline-block;width:11px;height:11px;background:${layerColors[i]};border:1px solid #687579"></span> ${escape(layer.name)}: ${escape(format(layer.thickness))} мм</span>`).join('');
  return `<div class="tool-stock-map">${svg(plan, 'План фундамента. Стороны пронумерованы, выбранная опалубка обозначена пунктиром.', 450)}<p class="tool-hint">Синий — бетон. Коричневый пунктир — заданная опалубка. Масштаб плана: 1 мм = ${escape(format(scale, 4))} ед. схемы.</p></div><div class="tool-stock-map">${svg(section, 'Разрез фундамента с подготовительными слоями.', 445)}<p class="tool-hint">${legend || 'Подготовительные слои не заданы.'}</p><p class="tool-hint">Разрез: 1 мм = ${escape(format(sectionScale, 4))} ед. схемы. Тонкие слои обведены для различимости.</p></div>`;
}

export function extra(result) {
  return `<p class="tool-hint">Площадь бетона в плане: <strong>${escape(format(result.totals.concreteAreaM2))} м²</strong>. Пятно целиком: ${escape(format(result.totals.footprintAreaM2))} м². Ведомость разделяет бетон, дополнительный запас, опалубку и подготовительные слои.</p>`;
}

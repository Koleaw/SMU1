import * as engine from '../calculations/tile.mjs';
import { field, fields, group, svg, dim, txt, escape, format } from '../core/view.mjs';
import {validateShape} from '../core/projects.mjs';

export const { calculate, example, blank, methodologyVersion } = engine;
export const rowTemplates = {};
export function validateDraft(input){
  const {centerX,centerY,...draft}=input;
  validateShape(draft,engine.example);
  for(const value of [centerX,centerY])if(value!==undefined&&!['tile','joint'].includes(value))throw new Error('Центр раскладки: выберите плитку или шов.');
}
export function onInput(input,path){if(path==='mode')for(const key of ['centerX','centerY'])if(Object.hasOwn(input,key))input[key]=input.mode==='symmetric-joint'?'joint':'tile';}
export function form(input) {
  let html = group('Одна поверхность: пол или стена', fields(input, [field('length', 'Длина поверхности', { unit: 'мм', hint: 'Например, 3000 мм = 3 м.' }), field('width', 'Ширина / высота поверхности', { unit: 'мм', hint: 'Для стены — высота облицовки.' })]), 'Введите размеры прямоугольника, который хотите облицевать кафелем.');
  html += group('Один формат плитки', fields(input, [field('tileLength', 'Длина плитки', { unit: 'мм' }), field('tileWidth', 'Ширина плитки', { unit: 'мм' }), field('seam', 'Ширина шва', { unit: 'мм' }), field('rotate', 'Повернуть на 90°', { type: 'checkbox' })]));
  const layout = [field('mode', 'Начало раскладки', { options: [['edge', 'От края'], ['symmetric-tile', 'Центр по плитке'], ['symmetric-joint', 'Центр по шву']] })];
  layout.push(field('offsetX', 'Сдвиг по длине', { unit: 'мм' }), field('offsetY', 'Сдвиг по ширине', { unit: 'мм' }), field('narrowCut', 'Выделять подрезки уже', { unit: 'мм' }));
  for(const key of ['centerX','centerY'])if(Object.hasOwn(input,key))layout.push(field(key,`Центр по ${key==='centerX'?'длине':'ширине'}`,{options:[['tile','Середина плитки'],['joint','Середина шва']]}));
  html += group('Сколько купить', fields(input, [field('reservePercent', 'Запас на бой и замену', { unit: '%' }), field('packSize', 'Плиток в упаковке', { unit: 'шт.', hint: 'Посмотрите на упаковке. Для покупки поштучно укажите 1.' })]), 'На каждую деталь с подрезкой заложена отдельная целая плитка. Запас добавляется сверх этого количества.');
  return html + `<details class="tool-advanced" data-preserve-open="tile-settings"><summary>Дополнительные настройки раскладки</summary>${group('Края и подрезки', fields(input, [field('gap', 'Зазор по периметру', { unit: 'мм', hint: 'Вычитается с каждой стороны.' }), ...layout]), 'Сдвиг перемещает всю сетку. Сравните центр по плитке и по шву: варианты дают разные подрезки. Повторное использование обрезков не рассчитывается.')}</details>`;
}
const label = (x, y, value, attrs = '') => txt(x, y, value, `style="font-size:clamp(25px,calc(41px - 2vw),33px)" ${attrs}`);
const dimension = (...args) => dim(...args).replace('<text ', '<text style="font-size:clamp(25px,calc(41px - 2vw),33px)" ');
const vertical = (x, y, height, value, key, active) => `<g transform="translate(${x} ${y + height}) rotate(-90)">${dimension(0, 0, height, 0, value, key, active)}</g>`;
const colors = { full: '#a7c0ca', cut: '#dfba91', narrow: '#c85831' };
export function diagram(result, input, active = '') {
  const g = result.geometry;
  const scale = Math.min(490 / g.length, 315 / g.width);
  const x = 145 + (490 - g.length * scale) / 2, y = 110 + (315 - g.width * scale) / 2;
  const w = g.length * scale, h = g.width * scale;
  let body = label(28, 35, 'Прямая сетка · вид сверху');
  body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e2e2dc" stroke="${active === 'gap' ? '#b34e14' : '#8b9493'}" stroke-width="${active === 'gap' ? 4 : 1}"/>`;
  const paths = { full: [], cut: [], narrow: [] };
  for (const t of g.tiles) {
    const category = t.narrow ? 'narrow' : t.cut ? 'cut' : 'full';
    paths[category].push(`M${x + t.x * scale} ${y + t.y * scale}h${t.width * scale}v${t.height * scale}h${-t.width * scale}Z`);
  }
  for (const [category, commands] of Object.entries(paths)) if (commands.length) body += `<path d="${commands.join('')}" fill="${colors[category]}" stroke="${category === 'narrow' ? '#ac3418' : active.startsWith('offset') ? '#b34e14' : '#647b84'}" stroke-width="${category === 'narrow' ? 2 : 0.4}" ${category==='narrow'?'vector-effect="non-scaling-stroke"':''}/>`;
  body += `<rect x="${x + g.gap * scale}" y="${y + g.gap * scale}" width="${g.usefulLength * scale}" height="${g.usefulWidth * scale}" fill="none" stroke="${active === 'gap' ? '#b34e14' : '#637579'}" stroke-width="1.4" stroke-dasharray="6 4"/>`;
  body += dimension(x, 82, x + w, 82, `${format(g.length)} мм`, 'length', active);
  body += vertical(83, y, h, `${format(g.width)} мм`, 'width', active);
  if (['tileLength', 'tileWidth', 'rotate'].includes(active)) {
    const sample = g.tiles.find(t => !t.cut) || g.tiles[0];
    if (sample) body += `<rect x="${x + sample.x * scale}" y="${y + sample.y * scale}" width="${sample.width * scale}" height="${sample.height * scale}" fill="none" stroke="#b34e14" stroke-width="4"/>`;
  }
  if (active === 'seam' && g.seam > 0 && g.tiles.length) {
    const sample = g.tiles.find(t => t.x + t.width + g.seam <= g.length - g.gap);
    if (sample) body += `<rect x="${x + (sample.x + sample.width) * scale}" y="${y + sample.y * scale}" width="${Math.max(g.seam * scale, 2)}" height="${sample.height * scale}" fill="#b34e14"/>`;
  }
  body += label(28, 478, `Формат на плане ${format(g.tileLength)} × ${format(g.tileWidth)} мм`, ['tileLength', 'tileWidth', 'rotate'].includes(active) ? 'class="is-active"' : '');
  body += label(28, 516, `Шов ${format(g.seam)} мм · зазор ${format(g.gap)} мм`, ['seam', 'gap'].includes(active) ? 'class="is-active"' : '');
  const edges = Object.entries(g.edgeCuts).filter(([, sizes]) => sizes.length).map(([side, sizes]) => `${({ left: 'слева', right: 'справа', top: 'сверху', bottom: 'снизу' })[side]} ${sizes.map(size => format(size)).join(' / ')} мм`).join('; ');
  const legend = [['full', 'Целая'], ['cut', 'Подрезанная'], ['narrow', 'Узкая подрезка']].map(([category, name]) => `<span style="display:inline-block;margin-right:12px"><span aria-hidden="true" style="display:inline-block;width:12px;height:12px;background:${colors[category]};border:1px solid #687579"></span> ${name}</span>`).join('');
  return svg(body, 'Раскладка плитки. Целые элементы синие, подрезанные бежевые, узкие подрезки оранжевые.', 550) + `<p class="tool-hint">${legend}</p><p class="tool-hint">Крайние подрезки: <strong>${escape(edges || 'нет')}</strong>.</p><p class="tool-hint">Масштаб: 1 мм = ${escape(format(scale, 4))} ед. схемы. Штриховой контур — полезное поле. Узкие подрезки обведены для различимости; все ${escape(format(g.tiles.length))} элементов сохранены в расчёте.</p>`;
}
export function extra(result) {
  const t = result.totals;
  return `${t.narrowCount ? `<div class="tool-warning"><strong>Узкие подрезки: ${format(t.narrowCount)} шт.</strong><p>Красные элементы на схеме уже ${format(result.input.narrowCut)} мм хотя бы по одной стороне. Сравните центровку или сдвиг в дополнительных настройках перед покупкой.</p></div>` : ''}<p class="tool-hint">Для раскладки: <strong>${format(t.sourceCount)} плиток</strong> (${format(t.fullCount)} целых + ${format(t.cutCount)} на детали с подрезкой). Запас: ${format(t.reserveCount)} шт. Всего нужно ${format(t.requiredCount)} шт.; упаковками — <strong>${format(t.purchasedCount)} шт.</strong> Полезная площадь: ${format(t.usefulAreaM2)} м².</p>`;
}

import { number, text as checkedText, format } from '../core/numbers.mjs';

export const methodologyVersion = '1.0.0';
export const referenceVersions = {};
export const limits = Object.freeze({ zones: 50, openings: 50, length: 1_000_000, text: 2000, precisionMm: 0.001 });
export const sideNames = {
  south: '1 · нижняя, от левого угла вправо',
  east: '2 · правая, от нижнего угла вверх',
  north: '3 · верхняя, от правого угла влево',
  west: '4 · левая, от верхнего угла вниз',
};
export const thermalNames = { unknown: 'Не определено', warm: 'Тёплое — пожелание заказчика', cold: 'Холодное — пожелание заказчика' };
export const example = {
  purpose: 'Склад с участком сборки', region: 'Пермский край', length: 24000, width: 12000,
  externalHeight: 6000, usefulHeight: 4500, thermal: 'warm',
  zones: [
    { id: 'z1', name: 'Хранение', x: 1000, y: 1000, length: 13000, width: 10000 },
    { id: 'z2', name: 'Сборка', x: 15000, y: 1000, length: 8000, width: 7000 },
    { id: 'z3', name: 'Бытовая зона', x: 17000, y: 9000, length: 5000, width: 2000 },
  ],
  openings: [
    { id: 'o1', name: 'Ворота', side: 'south', position: 2000, width: 4000, height: 4000 },
    { id: 'o2', name: 'Дверь', side: 'east', position: 2000, width: 1500, height: 2100 },
  ],
  equipment: 'Стеллажи и сборочные столы. Характеристики и нагрузки уточняются.',
  engineering: 'Нужны электроснабжение, освещение и обсуждение температурного режима.',
  site: 'Подъезд и ограничения участка требуют уточнения.', timeline: 'Желаемый срок обсудить после уточнения задания.', budget: null,
};
export const blank = {
  purpose: '', region: '', length: null, width: null, externalHeight: null, usefulHeight: null, thermal: 'unknown',
  zones: [], openings: [], equipment: '', engineering: '', site: '', timeline: '', budget: null,
};
const keys = Object.keys(blank);
const zoneKeys = ['id', 'name', 'x', 'y', 'length', 'width'];
const openingKeys = ['id', 'name', 'side', 'position', 'width', 'height'];
const unit = (value) => value === null ? null : Math.round(value * 1000);
const fromUnit = (value) => value === null ? null : value / 1000;

function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: ожидается объект.`);
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label}: неизвестное поле.`);
  for (const key of allowed) if (!(key in value)) throw new Error(`${label}: отсутствует поле «${key}»; неизвестное значение задайте явно.`);
}
function optionalText(value, label, max = limits.text) {
  if (value === null || value === '') return null;
  return checkedText(value, label, max) || null;
}
function optionalNumber(value, label, min, max) {
  return value === null || value === '' ? null : number(value, label, min, max);
}
function mm(value, label, allowZero = false) {
  const parsed = optionalNumber(value, label, allowZero ? 0 : 0.001, limits.length);
  if (parsed === null) return null;
  if (Math.abs(fromUnit(unit(parsed)) - parsed) > 1e-8) throw new Error(`${label}: точность до 0,001 мм, не более трёх знаков после запятой.`);
  return unit(parsed);
}
function rows(value, label, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}: не более ${max} строк.`);
  return value;
}
function id(value, label, used) {
  const result = checkedText(value, label, 80);
  if (!result || used.has(result)) throw new Error(`${label}: нужен непустой уникальный ID.`);
  used.add(result); return result;
}
function intersection(aStart, aEnd, bStart, bEnd) { return Math.max(aStart, bStart) < Math.min(aEnd, bEnd); }

export function calculate(raw) {
  object(raw, keys, 'Задание');
  const given = [], calculated = [], needClarify = [];
  const add = (target, parameter, value, unit = '', detail = '') => target.push({ parameter, value, unit, detail });
  const missing = (parameter, detail) => add(needClarify, parameter, 'Неизвестно', '', detail);
  const inputs = {};
  for (const [key, label] of [['purpose', 'Назначение'], ['region', 'Регион'], ['equipment', 'Оборудование'], ['engineering', 'Инженерные пожелания'], ['site', 'Сведения об участке'], ['timeline', 'Желаемые сроки']]) {
    inputs[key] = optionalText(raw[key], label);
    if (inputs[key] === null) missing(label, 'Заказчик пока не указал значение.');
    else add(given, label, inputs[key], '', key === 'timeline' ? 'Желаемый срок заказчика; срок строительства не рассчитан.' : 'Со слов заказчика; требуется обсуждение.');
  }
  const L = mm(raw.length, 'Наружная длина'), W = mm(raw.width, 'Наружная ширина');
  const exterior = mm(raw.externalHeight, 'Наружная высота'), useful = mm(raw.usefulHeight, 'Требуемая полезная высота');
  if (exterior !== null && useful !== null && useful > exterior) throw new Error('Требуемая полезная высота не может превышать заданную наружную высоту. Уточните оба значения.');
  for (const [key, label, value] of [['length', 'Наружная длина', L], ['width', 'Наружная ширина', W], ['externalHeight', 'Наружная высота', exterior], ['usefulHeight', 'Требуемая полезная высота', useful]]) {
    inputs[key] = fromUnit(value);
    if (value === null) missing(label, key === 'usefulHeight' ? 'Укажите необходимую свободную высоту отдельно от наружной.' : 'Значение не заменяется нулём и не выводится из других параметров.');
    else add(given, label, fromUnit(value), 'мм', key === 'usefulHeight' ? 'Требование заказчика, не подтверждение достижимости.' : 'Заданный наружный габарит.');
  }
  if (!Object.hasOwn(thermalNames, raw.thermal)) throw new Error('Выберите тёплое, холодное или неопределённое исполнение.');
  inputs.thermal = raw.thermal;
  if (raw.thermal === 'unknown') missing('Тепловое исполнение', 'Обсудить требуемый режим; отопление автоматически не назначается.');
  else add(given, 'Тепловое исполнение', thermalNames[raw.thermal]);
  inputs.budget = optionalNumber(raw.budget, 'Бюджет заказчика', 0, 1_000_000_000_000);
  if (inputs.budget === null) missing('Бюджет заказчика', 'Необязательный ориентир; стоимость строительства не рассчитана.');
  else add(given, 'Бюджет заказчика', inputs.budget, '₽', 'Указан заказчиком. Не является ценой или сметой СМУ‑1.');

  const zoneIds = new Set();
  const zones = rows(raw.zones, 'Зоны', limits.zones).map((row, index) => {
    object(row, zoneKeys, `Зона ${index + 1}`);
    const name = optionalText(row.name, `Зона ${index + 1}, название`, 160), label = name || `Зона ${index + 1}`;
    const zone = { id: id(row.id, `Зона ${index + 1}`, zoneIds), name, label,
      x: mm(row.x, `${label}, координата X`, true), y: mm(row.y, `${label}, координата Y`, true),
      length: mm(row.length, `${label}, длина`), width: mm(row.width, `${label}, ширина`) };
    if (L !== null && zone.x !== null && (zone.x > L || (zone.length !== null && zone.x + zone.length > L))) throw new Error(`Зона «${label}» выходит за наружную длину здания.`);
    if (W !== null && zone.y !== null && (zone.y > W || (zone.width !== null && zone.y + zone.width > W))) throw new Error(`Зона «${label}» выходит за наружную ширину здания.`);
    if (name === null) missing(`${label}: назначение`, 'Укажите название функциональной зоны.');
    for (const [key, title] of [['x', 'X'], ['y', 'Y'], ['length', 'длина'], ['width', 'ширина']]) {
      if (zone[key] === null) missing(`${label}: ${title}`, 'Для привязки прямоугольника на плане требуется значение.');
      else add(given, `${label}: ${title}`, fromUnit(zone[key]), 'мм', 'Координаты от нижнего левого угла; размеры — пожелания заказчика.');
    }
    zone.complete = ['x', 'y', 'length', 'width'].every((key) => zone[key] !== null);
    zone.areaM2 = zone.length !== null && zone.width !== null ? fromUnit(zone.length) / 1000 * (fromUnit(zone.width) / 1000) : null;
    if (zone.areaM2 !== null) add(calculated, `${label}: площадь прямоугольника`, zone.areaM2, 'м²', 'Толщина стен, перегородки и колонны не вычтены.');
    return zone;
  });
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    const a = zones[i], b = zones[j];
    if (a.complete && b.complete && intersection(a.x, a.x + a.length, b.x, b.x + b.length) && intersection(a.y, a.y + a.width, b.y, b.y + b.width)) throw new Error(`Зоны «${a.label}» и «${b.label}» пересекаются. Измените координаты или размеры.`);
  }
  if (!zones.length) missing('Функциональные зоны', 'Зоны не перечислены; это не означает отсутствие зонирования.');
  if (zones.some((zone) => !zone.complete)) missing('Проверка всех зон', 'Для неполных прямоугольников пересечения и границы проверить невозможно.');

  const openingIds = new Set();
  const openings = rows(raw.openings, 'Проёмы', limits.openings).map((row, index) => {
    object(row, openingKeys, `Проём ${index + 1}`);
    const name = optionalText(row.name, `Проём ${index + 1}, название`, 160), label = name || `Проём ${index + 1}`;
    if (!Object.hasOwn(sideNames, row.side)) throw new Error(`${label}: выберите сторону.`);
    const opening = { id: id(row.id, `Проём ${index + 1}`, openingIds), name, label, side: row.side,
      position: mm(row.position, `${label}, положение`, true), width: mm(row.width, `${label}, ширина`), height: mm(row.height, `${label}, высота`) };
    const wallLength = ['south', 'north'].includes(row.side) ? L : W;
    if (wallLength !== null && opening.position !== null && (opening.position > wallLength || (opening.width !== null && opening.position + opening.width > wallLength))) throw new Error(`Проём «${label}» выходит за границу стороны ${sideNames[row.side].slice(0, 1)}.`);
    if (opening.height !== null && exterior !== null && opening.height > exterior) throw new Error(`Проём «${label}» выше заданной наружной высоты здания.`);
    if (opening.height !== null && useful !== null && opening.height > useful) missing(`${label}: согласование высоты`, 'Высота проёма больше требуемой полезной высоты. Проверьте отметки и конструкцию со специалистом.');
    if (name === null) missing(`${label}: назначение`, 'Укажите вид проёма: ворота, дверь или другое пожелание.');
    add(given, `${label}: сторона`, sideNames[row.side], '', 'Стороны — условные обозначения плана, не ориентация по сторонам света.');
    for (const [key, title] of [['position', 'положение от начала стороны'], ['width', 'ширина'], ['height', 'высота']]) {
      if (opening[key] === null) missing(`${label}: ${title}`, 'Размер проёма не назначается автоматически.');
      else add(given, `${label}: ${title}`, fromUnit(opening[key]), 'мм', 'Задано заказчиком; согласовать чистый проём и монтажные размеры.');
    }
    opening.complete = opening.position !== null && opening.width !== null;
    return opening;
  });
  for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
    const a = openings[i], b = openings[j];
    if (a.side === b.side && a.complete && b.complete && intersection(a.position, a.position + a.width, b.position, b.position + b.width)) throw new Error(`Проёмы «${a.label}» и «${b.label}» пересекаются на одной стороне.`);
  }
  if (!openings.length) missing('Проёмы', 'Проёмы не перечислены; это не означает отсутствие дверей или ворот.');
  if (openings.some((opening) => !opening.complete)) missing('Проверка всех проёмов', 'Для проёмов без положения или ширины проверка размещения пока невозможна.');

  const planAvailable = L !== null && W !== null;
  const footprintAreaM2 = planAvailable ? fromUnit(L) / 1000 * (fromUnit(W) / 1000) : null;
  const perimeterM = planAvailable ? 2 * (fromUnit(L) + fromUnit(W)) / 1000 : null;
  if (planAvailable) {
    add(calculated, 'Площадь наружного прямоугольника', footprintAreaM2, 'м²', 'Не является полезной площадью здания.');
    add(calculated, 'Периметр наружного прямоугольника', perimeterM, 'м', 'Геометрическая длина контура; не ведомость материалов стен.');
  } else missing('Размерный план', 'Для масштаба и проверки выхода зон/проёмов нужны наружная длина и ширина.');
  missing('Полезная площадь', 'Нужны толщина стен, перегородки, колонны и планировочные ограничения. Точная полезная площадь не рассчитана.');
  missing('Проектные решения', 'Каркас, фундамент, нагрузки, отопление, противопожарные решения, цена и сроки определяются отдельно после уточнения задания.');

  const publicZones = zones.map(({ x, y, length, width, ...zone }) => ({ ...zone, x: fromUnit(x), y: fromUnit(y), length: fromUnit(length), width: fromUnit(width) }));
  const publicOpenings = openings.map(({ position, width, height, ...opening }) => ({ ...opening, position: fromUnit(position), width: fromUnit(width), height: fromUnit(height) }));
  inputs.zones = publicZones.map(({ id, name, x, y, length, width }) => ({ id, name, x, y, length, width }));
  inputs.openings = publicOpenings.map(({ id, name, side, position, width, height }) => ({ id, name, side, position, width, height }));
  const geometryRows = [
    ...publicZones.map((zone) => ({ element: 'Зона', name: zone.label, position: `X: ${format(zone.x)}; Y: ${format(zone.y)}`, dimensions: `${format(zone.length)} × ${format(zone.width)}`, height: null, detail: zone.complete ? 'Прямоугольник; стены и колонны не учтены' : 'Геометрия неполная' })),
    ...publicOpenings.map((opening) => ({ element: 'Проём', name: opening.label, position: `Сторона ${sideNames[opening.side].slice(0, 1)}; начало: ${format(opening.position)}`, dimensions: opening.width, height: opening.height, detail: opening.complete ? 'Заданные положение и ширина' : 'Положение или ширина неизвестны' })),
  ];
  const briefColumns = [{ key: 'parameter', label: 'Параметр' }, { key: 'value', label: 'Значение' }, { key: 'unit', label: 'Единица' }, { key: 'detail', label: 'Пояснение' }];
  return {
    methodologyVersion, input: inputs,
    geometry: { available: planAvailable, length: inputs.length, width: inputs.width, externalHeight: inputs.externalHeight, usefulHeight: inputs.usefulHeight, zones: publicZones, openings: publicOpenings },
    totals: { footprintAreaM2, perimeterM, zoneCount: zones.length, openingCount: openings.length },
    given, calculated, needClarify,
    summary: [
      { label: 'Наружное пятно', value: footprintAreaM2 === null ? 'Неизвестно' : footprintAreaM2, unit: footprintAreaM2 === null ? '' : 'м²' },
      { label: 'Требуемая полезная высота', value: inputs.usefulHeight === null ? 'Неизвестно' : inputs.usefulHeight, unit: inputs.usefulHeight === null ? '' : 'мм' },
      { label: 'Заданных зон', value: zones.length, unit: 'шт.' },
      { label: 'Заданных проёмов', value: openings.length, unit: 'шт.' },
    ],
    columns: [{ key: 'element', label: 'Элемент' }, { key: 'name', label: 'Название' }, { key: 'position', label: 'Положение, мм' }, { key: 'dimensions', label: 'Размер в плане, мм' }, { key: 'height', label: 'Высота, мм' }, { key: 'detail', label: 'Статус' }], rows: geometryRows,
    extraTables: [{ title: 'Задано заказчиком', columns: briefColumns, rows: given }, { title: 'Вычислено из геометрии', columns: briefColumns, rows: calculated }, { title: 'Нужно уточнить', columns: briefColumns, rows: needClarify }],
    warnings: [
      'Предварительная схема для обсуждения задания. Не является проектом, подбором конструкции или нормативным одобрением.',
      'Наружное пятно и прямоугольники зон не подтверждают полезную площадь: стены, перегородки и колонны неизвестны.',
      'Тёплое исполнение, полезная высота, сроки и бюджет — требования заказчика. Системы отопления, стоимость и сроки строительства автоматически не назначаются.',
    ],
    coefficients: { unit: 'мм', precisionMm: limits.precisionMm, origin: 'Нижний левый угол: X вправо, Y вверх' },
  };
}

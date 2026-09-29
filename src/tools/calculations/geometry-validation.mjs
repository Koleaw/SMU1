/** Strict shared parsing for geometry engines. Dimensions use integer thousandths of mm. */
export function fail(field, message) {
  const error = new Error(message);
  error.field = field;
  throw error;
}

export function object(value, keys, field = 'input') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(field, 'Ожидается объект параметров.');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${field}.${key}`, `Неизвестное поле: ${key}.`);
  return value;
}

export function number(value, field, min, max, precision = 3) {
  if (typeof value === 'string') {
    value = value.trim();
    if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(value)) fail(field, 'Введите число; десятичный разделитель — запятая или точка.');
    value = Number(value.replace(',', '.'));
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(field, 'Введите известное числовое значение.');
  if (value < min || value > max) fail(field, `Допустимое значение: от ${min} до ${max}.`);
  const scale = 10 ** precision;
  const rounded = Math.round(value * scale);
  if (Math.abs(value * scale - rounded) > 0.00001) fail(field, `Допустимо не более ${precision} знаков после запятой.`);
  return rounded / scale;
}

export function integer(value, field, min, max) { return number(value, field, min, max, 0); }
export function mm(value, field, min = 0.001, max = 1_000_000) { return Math.round(number(value, field, min, max) * 1000); }
export function enumValue(value, options, field) {
  if (!options.includes(value)) fail(field, `Выберите значение: ${options.join(', ')}.`);
  return value;
}
export function boolean(value, field) {
  if (typeof value !== 'boolean') fail(field, 'Выберите «да» или «нет».');
  return value;
}
export function text(value, field, fallback = '', max = 120) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(field, `Введите текст длиной до ${max} символов без управляющих знаков.`);
  return value.trim();
}
export function array(value, field, max) {
  if (!Array.isArray(value) || value.length > max) fail(field, `Допустим список не более ${max} элементов.`);
  return value;
}
export function uniqueIds(items, field) {
  const ids = new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) fail(field, 'У каждого элемента должен быть непустой уникальный ID.');
    ids.add(item.id);
  }
}
export const ceilDiv = (a, b) => Math.floor(a / b) + (a % b === 0 ? 0 : 1);
export const asMm = value => value / 1000;

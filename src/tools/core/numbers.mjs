export function number(value, label, min = 0, max = 1e9, integer = false) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') throw new Error(`${label}: укажите значение.`);
  const source = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  if (source === '' || (typeof source === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(source))) throw new Error(`${label}: введите число, например 2,5.`);
  const n = Number(source);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${label}: допустимо ${min}–${max}${integer ? ', целое число' : ''}.`);
  return n;
}
export function optional(value, label, min = 0, max = 1e9) { return value === '' || value === null || value === undefined ? null : number(value, label, min, max); }
export function text(value, label = 'Текст', max = 500) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) throw new Error(`${label}: не более ${max} символов.`);
  return value.trim();
}
export function list(value, label, max = 100, min = 0) { if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label}: от ${min} до ${max} строк.`); return value; }
export function choice(value, values, label) { if (!values.includes(value)) throw new Error(`${label}: выберите значение из списка.`); return value; }
export const format = (value, digits = 3) => typeof value === 'number' ? new Intl.NumberFormat('ru-RU', {maximumFractionDigits:digits}).format(value) : String(value ?? 'Не указано');
export const clone = value => JSON.parse(JSON.stringify(value));

import { object, number, mm, enumValue, boolean, integer, fail, asMm, ceilDiv } from './geometry-validation.mjs';

export const methodologyVersion = '1.0.0';
export const example = { length: 1200, width: 1200, tileLength: 600, tileWidth: 600, seam: 3, gap: 0, rotate: false, mode: 'edge', offsetX: 0, offsetY: 0, reservePercent: 0, packSize: 4, narrowCut: 30 };
export const blank = { ...example, length: '', width: '', tileLength: '', tileWidth: '' };

// Doubled micrometres preserve exact centres, even at half a micrometre.
function intersections(size, tile, seam, origin) {
  const pitch = tile + seam;
  // origin + i*pitch + tile > 0 AND origin + i*pitch < size (strict intersections).
  const first = Math.floor((-origin - tile) / pitch) + 1;
  const last = Math.ceil((size - origin) / pitch) - 1;
  const count = Math.max(0, last - first + 1);
  return { first, last, count, pitch };
}

export function calculate(raw) {
  object(raw, ['length', 'width', 'tileLength', 'tileWidth', 'seam', 'gap', 'rotate', 'mode', 'centerX', 'centerY', 'offsetX', 'offsetY', 'reservePercent', 'packSize', 'narrowCut']);
  const L = 2 * mm(raw.length, 'length');
  const W = 2 * mm(raw.width, 'width');
  const TL = 2 * mm(raw.tileLength, 'tileLength', 1, 10_000);
  const TW = 2 * mm(raw.tileWidth, 'tileWidth', 1, 10_000);
  const S = 2 * mm(raw.seam, 'seam', 0, 1000);
  const G = 2 * mm(raw.gap, 'gap', 0, 1000);
  if (2 * G >= L || 2 * G >= W) fail('gap', 'Два периметральных зазора должны быть меньше каждой стороны поверхности.');
  const rotate = boolean(raw.rotate, 'rotate');
  const tileX = rotate ? TW : TL, tileY = rotate ? TL : TW;
  const mode = enumValue(raw.mode, ['edge', 'symmetric-tile', 'symmetric-joint'], 'mode');
  const centerX = enumValue(raw.centerX ?? (mode === 'symmetric-joint' ? 'joint' : 'tile'), ['tile', 'joint'], 'centerX');
  const centerY = enumValue(raw.centerY ?? (mode === 'symmetric-joint' ? 'joint' : 'tile'), ['tile', 'joint'], 'centerY');
  const OX = 2 * mm(raw.offsetX, 'offsetX', -1_000_000, 1_000_000);
  const OY = 2 * mm(raw.offsetY, 'offsetY', -1_000_000, 1_000_000);
  const reservePercent = number(raw.reservePercent, 'reservePercent', 0, 100);
  const packSize = integer(raw.packSize, 'packSize', 1, 1000);
  const narrowCut = 2 * mm(raw.narrowCut, 'narrowCut', 0, 1000);
  const usefulL = L - 2 * G, usefulW = W - 2 * G;
  const origin = (size, tile, center) => mode === 'edge' ? 0 : center === 'tile' ? (size - tile) / 2 : (size + S) / 2;
  const originX = origin(usefulL, tileX, centerX) + OX;
  const originY = origin(usefulW, tileY, centerY) + OY;
  const xRange = intersections(usefulL, tileX, S, originX);
  const yRange = intersections(usefulW, tileY, S, originY);
  const sourceCount = xRange.count * yRange.count;
  if (sourceCount > 20_000) fail('tileLength', 'Раскладка ограничена 20 000 элементами. Увеличьте формат плитки или разделите поверхность.');
  const tiles = [];
  const edgeCutSets = { left: new Set(), right: new Set(), top: new Set(), bottom: new Set() };
  const groups = new Map();
  let fullCount = 0, cutCount = 0, narrowCount = 0, tileArea = 0;
  for (let row = yRange.first; row <= yRange.last; row++) {
    const originalY = originY + row * yRange.pitch;
    const top = Math.max(0, originalY), bottom = Math.min(usefulW, originalY + tileY);
    for (let column = xRange.first; column <= xRange.last; column++) {
      const originalX = originX + column * xRange.pitch;
      const left = Math.max(0, originalX), right = Math.min(usefulL, originalX + tileX);
      const width = right - left, height = bottom - top;
      if (width <= 0 || height <= 0) continue;
      const cut = width !== tileX || height !== tileY;
      const narrow = cut && (width < narrowCut || height < narrowCut);
      if (cut) cutCount++; else fullCount++;
      if (narrow) narrowCount++;
      tileArea += (width / 2000) * (height / 2000);
      const tile = { id: `T${tiles.length + 1}`, column, row, x: (G + left) / 2000, y: (G + top) / 2000, width: width / 2000, height: height / 2000, cut, narrow, leftCut: originalX < 0, rightCut: originalX + tileX > usefulL, topCut: originalY < 0, bottomCut: originalY + tileY > usefulW };
      tiles.push(tile);
      if (tile.leftCut) edgeCutSets.left.add(tile.width);
      if (tile.rightCut) edgeCutSets.right.add(tile.width);
      if (tile.topCut) edgeCutSets.top.add(tile.height);
      if (tile.bottomCut) edgeCutSets.bottom.add(tile.height);
      const groupKey = `${width}:${height}:${cut}`;
      const group = groups.get(groupKey) ?? { name: cut ? 'Подрезанный элемент' : 'Целая плитка', length: tile.width, width: tile.height, count: 0, sourceCount: 0, narrow: narrow ? 'Узкая подрезка' : '', detail: cut ? 'Одна целая плитка на каждый элемент; обрезки повторно не используются' : 'Без подрезки' };
      group.count++; group.sourceCount++;
      groups.set(groupKey, group);
    }
  }
  if (tiles.length !== sourceCount) fail('input', 'Ошибка геометрического баланса раскладки.');
  // reservePercent has three decimal places: integer multiplication prevents phantom reserve units.
  const reserveCount = ceilDiv(sourceCount * Math.round(reservePercent * 1000), 100_000);
  const requiredCount = sourceCount + reserveCount;
  const packCount = ceilDiv(requiredCount, packSize);
  const purchasedCount = packCount * packSize;
  const rows = [...groups.values(), { name: 'Дополнительный запас', length: asMm(TL / 2), width: asMm(TW / 2), count: reserveCount, sourceCount: reserveCount, narrow: '', detail: `${reservePercent}% от плиток для раскладки; округление вверх` }, { name: 'Закупка упаковками', length: asMm(TL / 2), width: asMm(TW / 2), count: packCount, sourceCount: purchasedCount, narrow: '', detail: `${packSize} шт. в упаковке; ${purchasedCount - requiredCount} шт. сверх расчёта из-за упаковки` }];
  const warnings = ['Каждый подрезанный элемент требует отдельной целой плитки. Повторное использование обрезков не оптимизируется; минимальная закупка не гарантируется.', 'Дополнительный запас задан отдельно и не заменяет уже учтённые подрезки.'];
  if (narrowCount) warnings.push(`Узких подрезанных элементов: ${narrowCount}. Порог ${narrowCut / 2000} мм; сравните смещение и варианты центрирования.`);
  if (!sourceCount) warnings.push('Полезное поле попало в шов сетки. Проверьте формат, ширину шва и смещение.');
  const usefulAreaM2 = (usefulL / 2_000_000) * (usefulW / 2_000_000);
  return {
    valid: true, methodologyVersion,
    input: { length: L / 2000, width: W / 2000, tileLength: TL / 2000, tileWidth: TW / 2000, seam: S / 2000, gap: G / 2000, rotate, mode, centerX, centerY, offsetX: OX / 2000, offsetY: OY / 2000, reservePercent, packSize, narrowCut: narrowCut / 2000 },
    totals: { fullCount, cutCount, sourceCount, reserveCount, requiredCount, packCount, purchasedCount, usefulAreaM2, tileAreaM2: tileArea / 1_000_000, narrowCount },
    summary: [{ label: 'Купить упаковок', value: packCount, unit: 'уп.' }, { label: 'Плиток в покупке', value: purchasedCount, unit: 'шт.' }, { label: 'Площадь облицовки', value: usefulAreaM2, unit: 'м²' }],
    columns: [{ key: 'name', label: 'Элемент' }, { key: 'length', label: 'Длина, мм' }, { key: 'width', label: 'Ширина, мм' }, { key: 'count', label: 'Количество' }, { key: 'sourceCount', label: 'Плиток, шт.' }, { key: 'narrow', label: 'Подрезка' }, { key: 'detail', label: 'Примечание' }], rows,
    geometry: { length: L / 2000, width: W / 2000, gap: G / 2000, usefulLength: usefulL / 2000, usefulWidth: usefulW / 2000, tileLength: tileX / 2000, tileWidth: tileY / 2000, seam: S / 2000, tiles, edgeCuts: Object.fromEntries(Object.entries(edgeCutSets).map(([edge, values]) => [edge, [...values].sort((a, b) => a - b)])), originX: (G + originX) / 2000, originY: (G + originY) / 2000 }, warnings,
  };
}

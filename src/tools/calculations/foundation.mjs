import { object, number, mm, enumValue, boolean, text, array, uniqueIds, integer, fail, asMm } from './geometry-validation.mjs';
import { calculate as calculateShapes } from './foundation-shapes.mjs';

export const methodologyVersion = '1.1.0';
export const example = { type: 'slab', length: 8000, width: 6000, height: 250, stripWidth: 400, reservePercent: 5, formwork: { outer: true, inner: false, height: 250 }, layers: [{ id: 'sand', name: 'Песчаная подготовка', area: 'footprint', thickness: 100 }] };
export const blank = { type: 'slab', length: '', width: '', height: '', stripWidth: '', reservePercent: 0, formwork: { outer: false, inner: false, height: 0 }, layers: [] };

function sides(value, field) {
  if (value === undefined) return [0, 1, 2, 3];
  const result = array(value, field, 4).map((v, i) => integer(v, `${field}.${i}`, 0, 3));
  if (new Set(result).size !== result.length) fail(field, 'Стороны опалубки не должны повторяться.');
  return result;
}

export function calculate(raw) {
  if (raw?.type === 'polygon' || raw?.type === 'network') return calculateShapes(raw);
  object(raw, ['type', 'length', 'width', 'height', 'stripWidth', 'reservePercent', 'formwork', 'layers']);
  const type = enumValue(raw.type, ['slab', 'strip'], 'type');
  const L = mm(raw.length, 'length');
  const W = mm(raw.width, 'width');
  const H = mm(raw.height, 'height', 0.001, 100_000);
  const B = type === 'strip' ? mm(raw.stripWidth, 'stripWidth', 0.001, 100_000) : 0;
  if (type === 'strip' && (2 * B >= L || 2 * B >= W)) fail('stripWidth', 'Ширина ленты должна быть меньше половины каждой наружной стороны.');
  const reservePercent = number(raw.reservePercent, 'reservePercent', 0, 100);
  const forms = object(raw.formwork, ['outer', 'inner', 'height', 'outerSides', 'innerSides'], 'formwork');
  const outer = boolean(forms.outer, 'formwork.outer');
  const inner = boolean(forms.inner, 'formwork.inner');
  if (inner && type !== 'strip') fail('formwork.inner', 'Внутренние стороны есть только у ленточного фундамента.');
  const FH = mm(forms.height, 'formwork.height', 0, 100_000);
  if ((outer || inner) && FH === 0) fail('formwork.height', 'Для выбранных сторон задайте ненулевую высоту опалубки.');
  const outerSides = sides(forms.outerSides, 'formwork.outerSides');
  const innerSides = sides(forms.innerSides, 'formwork.innerSides');
  if (outer && !outerSides.length) fail('formwork.outerSides', 'Выберите хотя бы одну наружную сторону.');
  if (inner && !innerSides.length) fail('formwork.innerSides', 'Выберите хотя бы одну внутреннюю сторону.');
  const length = asMm(L), width = asMm(W), height = asMm(H), stripWidth = asMm(B);
  const innerLength = type === 'strip' ? asMm(L - 2 * B) : 0;
  const innerWidth = type === 'strip' ? asMm(W - 2 * B) : 0;
  const footprintAreaM2 = (length / 1000) * (width / 1000);
  // Equivalent to L*W - (L-2b)*(W-2b); this avoids subtracting two large nearly equal areas.
  const concreteAreaM2 = type === 'strip' ? 2 * (stripWidth / 1000) * ((length + width - 2 * stripWidth) / 1000) : footprintAreaM2;
  const concreteVolumeM3 = concreteAreaM2 * (height / 1000);
  const reserveVolumeM3 = concreteVolumeM3 * reservePercent / 100;
  const formworkEdges = [];
  for (const kind of ['outer', 'inner']) {
    if (!(kind === 'outer' ? outer : inner)) continue;
    const chosen = kind === 'outer' ? outerSides : innerSides;
    for (const side of chosen) {
      const edgeLength = kind === 'outer' ? (side % 2 ? width : length) : (side % 2 ? innerWidth : innerLength);
      formworkEdges.push({ side, kind, length: edgeLength, height: asMm(FH), areaM2: (edgeLength / 1000) * (asMm(FH) / 1000) });
    }
  }
  const formworkAreaM2 = formworkEdges.reduce((sum, edge) => sum + edge.areaM2, 0);
  const layers = array(raw.layers, 'layers', 8).map((row, i) => {
    object(row, ['id', 'name', 'area', 'thickness'], `layers.${i}`);
    const id = text(row.id, `layers.${i}.id`, '', 64);
    const name = text(row.name, `layers.${i}.name`, `Слой ${i + 1}`);
    const area = enumValue(row.area, ['footprint', 'strip'], `layers.${i}.area`);
    if (area === 'strip' && type !== 'strip') fail(`layers.${i}.area`, 'Область под лентой доступна для ленточного фундамента.');
    const thickness = asMm(mm(row.thickness, `layers.${i}.thickness`, 0.001, 100_000));
    const areaM2 = area === 'footprint' ? footprintAreaM2 : concreteAreaM2;
    return { id, name, area, thickness, areaM2, volumeM3: areaM2 * thickness / 1000 };
  });
  uniqueIds(layers, 'layers');
  const planRects = type === 'slab' ? [{ id: 'concrete', x: 0, y: 0, width: length, height: width }] : [
    { id: 'top', x: 0, y: 0, width: length, height: stripWidth },
    { id: 'bottom', x: 0, y: width - stripWidth, width: length, height: stripWidth },
    { id: 'left', x: 0, y: stripWidth, width: stripWidth, height: innerWidth },
    { id: 'right', x: length - stripWidth, y: stripWidth, width: stripWidth, height: innerWidth },
  ];
  const sectionRects = type === 'slab' ? [{ id: 'concrete', name: 'Бетон', x: 0, y: 0, width: length, height }] : [
    { id: 'concrete-left', name: 'Бетон', x: 0, y: 0, width: stripWidth, height },
    { id: 'concrete-right', name: 'Бетон', x: length - stripWidth, y: 0, width: stripWidth, height },
  ];
  let sectionY = height;
  for (const layer of layers) {
    if (layer.area === 'footprint') sectionRects.push({ id: layer.id, name: layer.name, x: 0, y: sectionY, width: length, height: layer.thickness });
    else sectionRects.push({ id: `${layer.id}-left`, name: layer.name, x: 0, y: sectionY, width: stripWidth, height: layer.thickness }, { id: `${layer.id}-right`, name: layer.name, x: length - stripWidth, y: sectionY, width: stripWidth, height: layer.thickness });
    sectionY += layer.thickness;
  }
  const rows = [
    { name: 'Бетон — геометрический объём', quantity: concreteVolumeM3, unit: 'м³', detail: type === 'slab' ? 'Прямоугольная плита' : 'Прямоугольная замкнутая лента' },
    { name: 'Дополнительный запас бетона', quantity: reserveVolumeM3, unit: 'м³', detail: `${reservePercent}% — задано пользователем` },
    ...formworkEdges.map(edge => ({ name: `Опалубка: ${edge.kind === 'outer' ? 'наружная' : 'внутренняя'} сторона ${edge.side + 1}`, quantity: edge.areaM2, unit: 'м²', detail: `Длина ${edge.length} мм; формуемая высота ${edge.height} мм` })),
    ...layers.flatMap(layer => [{ name: `${layer.name} — площадь`, quantity: layer.areaM2, unit: 'м²', detail: layer.area === 'footprint' ? 'Всё прямоугольное пятно' : 'Под лентой' }, { name: `${layer.name} — объём`, quantity: layer.volumeM3, unit: 'м³', detail: `Толщина ${layer.thickness} мм` }]),
  ];
  return {
    valid: true, methodologyVersion,
    input: { type, length, width, height, stripWidth, reservePercent, formwork: { outer, inner, height: asMm(FH), outerSides, innerSides }, layers: layers.map(({ id, name, area, thickness }) => ({ id, name, area, thickness })) },
    totals: { footprintAreaM2, concreteAreaM2, concreteVolumeM3, reserveVolumeM3, orderVolumeM3: concreteVolumeM3 + reserveVolumeM3, formworkAreaM2 },
    summary: [{ label: 'Бетон по геометрии', value: concreteVolumeM3, unit: 'м³' }, { label: 'Дополнительный запас', value: reserveVolumeM3, unit: 'м³' }, { label: 'Бетон с запасом', value: concreteVolumeM3 + reserveVolumeM3, unit: 'м³' }, { label: 'Заданная опалубка', value: formworkAreaM2, unit: 'м²' }],
    columns: [{ key: 'name', label: 'Материал / поверхность' }, { key: 'quantity', label: 'Количество' }, { key: 'unit', label: 'Единица' }, { key: 'detail', label: 'Условие' }], rows,
    geometry: { length, width, height, stripWidth, innerLength, innerWidth, planRects, sectionRects, formworkEdges, layers },
    warnings: ['Расчёт материалов по заданной геометрии. Несущая способность, грунты, армирование и пригодность фундамента для здания не проверяются.', 'Плотности материалов и коэффициенты уплотнения не применяются.'],
  };
}

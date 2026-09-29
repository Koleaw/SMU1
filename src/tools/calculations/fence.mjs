import { object, mm, enumValue, text, array, uniqueIds, integer, fail, asMm, ceilDiv } from './geometry-validation.mjs';

export const methodologyVersion = '1.0.0';
export const example = { type: 'rectangle', length: 10000, width: 8000, height: 2000, maxStep: 2500, openings: [{ id: 'gate-1', name: 'Ворота', side: 0, position: 3000, width: 4000 }] };
export const blank = { type: 'line', length: '', width: '', height: '', maxStep: '', openings: [] };
const roleNames = { end: 'конец линии', corner: 'угол', intermediate: 'промежуточная опора', 'opening-start': 'начало проёма', 'opening-end': 'конец проёма' };

export function calculate(raw) {
  object(raw, ['type', 'length', 'width', 'height', 'maxStep', 'openings']);
  const type = enumValue(raw.type, ['line', 'rectangle'], 'type');
  const L = mm(raw.length, 'length');
  const W = type === 'rectangle' ? mm(raw.width, 'width') : 0;
  const H = mm(raw.height, 'height', 0.001, 20_000);
  const S = mm(raw.maxStep, 'maxStep');
  const sideLengths = type === 'rectangle' ? [L, W, L, W] : [L];
  const offsets = [0];
  for (const sideLength of sideLengths) offsets.push(offsets.at(-1) + sideLength);
  const perimeter = offsets.at(-1);
  const openings = array(raw.openings, 'openings', 100).map((row, i) => {
    object(row, ['id', 'name', 'side', 'position', 'width'], `openings.${i}`);
    const id = text(row.id, `openings.${i}.id`, '', 64);
    const name = text(row.name, `openings.${i}.name`, `Проём ${i + 1}`);
    const side = integer(row.side, `openings.${i}.side`, 0, sideLengths.length - 1);
    const position = mm(row.position, `openings.${i}.position`, 0);
    const width = mm(row.width, `openings.${i}.width`);
    if (position + width > sideLengths[side]) fail(`openings.${i}.width`, `Проём «${name}» выходит за сторону ${side + 1}.`);
    return { id, name, side, position, width, rawIndex: i };
  });
  uniqueIds(openings, 'openings');
  const bySide = sideLengths.map((_, side) => openings.filter(o => o.side === side).sort((a, b) => a.position - b.position));
  for (const list of bySide) for (let i = 1; i < list.length; i++) {
    if (list[i].position < list[i - 1].position + list[i - 1].width) fail(`openings.${list[i].rawIndex}.position`, 'Проёмы на одной стороне не должны пересекаться.');
  }
  const sections = [];
  let spanCount = 0;
  for (let side = 0; side < sideLengths.length; side++) {
    let start = 0;
    const addSection = end => {
      if (end === start) return;
      const length = end - start;
      const count = ceilDiv(length, S);
      spanCount += count;
      if (spanCount > 10_000) fail('maxStep', 'Расчёт ограничен 10 000 пролётами. Увеличьте шаг или разделите объект.');
      sections.push({ id: `section-${sections.length + 1}`, side, start, end, length, count, step: length / count });
    };
    for (const opening of bySide[side]) { addSection(opening.position); start = opening.position + opening.width; }
    addSection(sideLengths[side]);
  }
  const point = (side, position) => {
    if (side === 0) return [position, 0];
    if (side === 1) return [L, position];
    if (side === 2) return [L - position, W];
    return [0, W - position];
  };
  const nodeMap = new Map();
  const addNode = (side, position, roles = [], openingId) => {
    let station = offsets[side] + position;
    if (type === 'rectangle' && station === perimeter) station = 0;
    let node = nodeMap.get(station);
    if (!node) {
      const [x, y] = point(side, position);
      node = { station, x: asMm(x), y: asMm(y), roles: new Set(), openingIds: new Set() };
      nodeMap.set(station, node);
    }
    for (const role of roles) node.roles.add(role);
    if (openingId) node.openingIds.add(openingId);
    return node;
  };
  if (type === 'rectangle') for (let side = 0; side < 4; side++) addNode(side, 0, ['corner']);
  else { addNode(0, 0, ['end']); addNode(0, L, ['end']); }
  const plottedOpenings = openings.map(opening => {
    const first = addNode(opening.side, opening.position, ['opening-start'], opening.id);
    const last = addNode(opening.side, opening.position + opening.width, ['opening-end'], opening.id);
    return { ...opening, first, last };
  });
  const spanRefs = [];
  for (const section of sections) {
    let first = addNode(section.side, section.start);
    for (let i = 1; i <= section.count; i++) {
      // Retain exact integer boundaries at ends; interior positions may be rational.
      const position = i === section.count ? section.end : section.start + section.length * i / section.count;
      const last = addNode(section.side, position, i < section.count ? ['intermediate'] : []);
      spanRefs.push({ side: section.side, length: asMm(section.step), first, last });
      first = last;
    }
  }
  const ordered = [...nodeMap.values()].sort((a, b) => a.station - b.station);
  ordered.forEach((node, i) => { node.id = `N${i + 1}`; });
  const nodes = ordered.map(({ id, x, y, roles, openingIds }) => ({ id, x, y, roles: [...roles], openingIds: [...openingIds] }));
  const spans = spanRefs.map((span, i) => ({ id: `S${i + 1}`, side: span.side, startNode: span.first.id, endNode: span.last.id, length: span.length, x1: span.first.x, y1: span.first.y, x2: span.last.x, y2: span.last.y }));
  const geometryOpenings = plottedOpenings.map(({ id, name, side, position, width, first, last }) => ({ id, name, side, position: asMm(position), width: asMm(width), startNode: first.id, endNode: last.id, x1: first.x, y1: first.y, x2: last.x, y2: last.y }));
  const openingLength = openings.reduce((sum, opening) => sum + opening.width, 0);
  const fenceLength = perimeter - openingLength;
  const geometrySections = sections.map(section => ({ ...section, start: asMm(section.start), end: asMm(section.end), length: asMm(section.length), step: asMm(section.step) }));
  const rows = [
    ...geometrySections.map(section => ({ kind: 'Пролёты участка', id: section.id, side: section.side + 1, size: section.step, quantity: section.count, detail: `Участок ${section.start}–${section.end} мм; размер по осям, не длина готовой секции` })),
    ...geometryOpenings.map(opening => ({ kind: opening.name, id: opening.id, side: opening.side + 1, size: opening.width, quantity: 1, detail: `Положение ${opening.position} мм; осевая ширина; узлы ${opening.startNode}–${opening.endNode}` })),
    ...nodes.map(node => ({ kind: 'Опорный узел', id: node.id, side: '', size: '', quantity: 1, detail: `X ${node.x} мм; Y ${node.y} мм; ${node.roles.map(role => roleNames[role]).join(', ')}` })),
  ];
  return {
    valid: true, methodologyVersion,
    input: { type, length: asMm(L), width: asMm(W), height: asMm(H), maxStep: asMm(S), openings: geometryOpenings.map(({ id, name, side, position, width }) => ({ id, name, side, position, width })) },
    totals: { perimeterMm: asMm(perimeter), fenceLengthMm: asMm(fenceLength), openingLengthMm: asMm(openingLength), spanCount, nodeCount: nodes.length, openingCount: openings.length, fenceAreaM2: asMm(fenceLength) * asMm(H) / 1_000_000 },
    summary: [{ label: 'Пролётов', value: spanCount, unit: 'шт.' }, { label: 'Уникальных опорных узлов', value: nodes.length, unit: 'шт.' }, { label: 'Длина ограждения', value: asMm(fenceLength) / 1000, unit: 'м' }, { label: 'Ширина проёмов по осям', value: asMm(openingLength) / 1000, unit: 'м' }],
    columns: [{ key: 'kind', label: 'Элемент' }, { key: 'id', label: 'Обозначение' }, { key: 'side', label: 'Сторона' }, { key: 'size', label: 'Осевая длина / шаг, мм' }, { key: 'quantity', label: 'Количество' }, { key: 'detail', label: 'Примечание' }], rows,
    geometry: { length: asMm(L), width: asMm(W), height: asMm(H), closed: type === 'rectangle', nodes, spans, openings: geometryOpenings, sections: geometrySections },
    warnings: ['Размеры заданы между осями опор. Осевая ширина проёма не равна свободной ширине въезда.', 'Шаг не подтверждает прочность. Сечения, крепления, фундамент и длина готовых секций требуют отдельного согласования.'],
  };
}

/** Straight 90° cutting, all public lengths in millimetres. No DOM or browser state. */
export const methodologyVersion = '1.0.0';
export const limits = Object.freeze({ partRows: 200, sourceRows: 200, purchaseRows: 32, pieces: 1000, stockPieces: 1000, length: 1_000_000, decimals: 3 });
const SCALE = 1000;
const fromUnits = (n) => n / SCALE;
const clone = (value) => JSON.parse(JSON.stringify(value));

export const example = {
  kerf: 3, trimStart: 0, trimEnd: 0, minUsefulRemnant: 300,
  parts: [
    { id: 'p1', name: 'Стойка', profile: 'Труба 40 × 40 × 2', material: 'Сталь', length: 1800, quantity: 4 },
    { id: 'p2', name: 'Перемычка', profile: 'Труба 40 × 40 × 2', material: 'Сталь', length: 900, quantity: 6 },
  ],
  stock: [{ id: 's1', name: 'Остаток со склада', kind: 'remnant', profile: 'Труба 40 × 40 × 2', material: 'Сталь', length: 2500, quantity: 1 }],
  purchases: [{ id: 'buy1', profile: 'Труба 40 × 40 × 2', material: 'Сталь', length: 6000, quantity: null }],
};

export const blank = {
  kerf: 3, trimStart: 0, trimEnd: 0, minUsefulRemnant: 300,
  parts: [{ id: 'p1', name: '', profile: '', material: '', length: '', quantity: 1 }],
  stock: [], purchases: [],
};

function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: ожидается объект.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: неизвестное поле «${key}».`);
}
function text(value, label, { empty = false, max = 160 } = {}) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/u.test(value) || (!empty && !value.trim())) throw new Error(`${label}: укажите текст до ${max} символов.`);
  return value.trim();
}
function number(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label}: укажите ${integer ? 'целое ' : ''}число от ${min} до ${max}.`);
  return value;
}
function length(value, label, { zero = false, max = limits.length } = {}) {
  number(value, label, zero ? 0 : 0.001, max);
  const scaled = Math.round(value * SCALE);
  if (Math.abs(scaled / SCALE - value) > 1e-8) throw new Error(`${label}: допускается не более трёх знаков после запятой (0,001 мм).`);
  return scaled;
}
function array(value, label, max, nonempty = false) {
  if (!Array.isArray(value) || value.length > max || (nonempty && !value.length)) throw new Error(`${label}: укажите ${nonempty ? 'от 1 до' : 'не более'} ${max} строк.`);
}

export function validate(input) {
  object(input, ['kerf', 'trimStart', 'trimEnd', 'minUsefulRemnant', 'parts', 'stock', 'purchases'], 'Раскрой');
  const kerf = length(input.kerf, 'Ширина пропила', { zero: true, max: 100 });
  const trimStart = length(input.trimStart, 'Торцовка в начале', { zero: true, max: 10000 });
  const trimEnd = length(input.trimEnd, 'Торцовка в конце', { zero: true, max: 10000 });
  const minUsefulRemnant = length(input.minUsefulRemnant, 'Полезный остаток', { zero: true });
  array(input.parts, 'Детали', limits.partRows, true);
  array(input.stock, 'Наличие', limits.sourceRows);
  array(input.purchases, 'Варианты закупки', limits.purchaseRows);
  const ids = new Set();
  const common = (item, type, index) => {
    const id = text(item.id, `ID ${type}, строка ${index + 1}`, { max: 80 });
    if (ids.has(`${type}:${id}`)) throw new Error(`${type}: повторяется ID «${id}».`);
    ids.add(`${type}:${id}`);
    return { id, profile: text(item.profile, 'Профиль'), material: text(item.material, 'Материал'), length: length(item.length, `${type}, длина`) };
  };
  let totalParts = 0;
  const parts = input.parts.map((item, index) => {
    object(item, ['id', 'name', 'profile', 'material', 'length', 'quantity'], `Деталь ${index + 1}`);
    const quantity = number(item.quantity, 'Количество деталей', 1, limits.pieces, true);
    totalParts += quantity;
    return { ...common(item, 'Деталь', index), name: text(item.name, 'Название детали'), quantity, rowIndex: index };
  });
  if (totalParts > limits.pieces) throw new Error(`В одном расчёте допускается до ${limits.pieces} деталей. Разделите задание, ничего не исключая из ведомости.`);
  let totalStock = 0;
  const stock = input.stock.map((item, index) => {
    object(item, ['id', 'name', 'kind', 'profile', 'material', 'length', 'quantity'], `Наличие ${index + 1}`);
    if (!['stock', 'remnant'].includes(item.kind)) throw new Error('Укажите вид наличия: мерная заготовка или остаток.');
    const quantity = number(item.quantity, 'Количество заготовок в наличии', 1, limits.stockPieces, true);
    totalStock += quantity;
    return { ...common(item, 'Наличие', index), name: text(item.name, 'Название заготовки', { empty: true }), kind: item.kind, quantity, key: `stock:${item.id}` };
  });
  if (totalStock > limits.stockPieces) throw new Error(`В одном расчёте допускается до ${limits.stockPieces} заготовок в наличии.`);
  const purchases = input.purchases.map((item, index) => {
    object(item, ['id', 'name', 'profile', 'material', 'length', 'quantity'], `Закупка ${index + 1}`);
    const quantity = item.quantity === null ? totalParts : number(item.quantity, 'Доступное количество новых заготовок', 1, limits.pieces, true);
    return { ...common(item, 'Закупка', index), name: item.name === undefined ? 'Новая заготовка' : text(item.name, 'Название закупки', { empty: true }), kind: 'purchase', quantity, key: `purchase:${item.id}` };
  });
  for (const source of [...stock, ...purchases]) {
    if (source.length <= trimStart + trimEnd) throw new Error(`Заготовка «${source.id}»: сумма торцовок должна быть меньше длины.`);
    source.usable = source.length - trimStart - trimEnd;
  }
  return { kerf, trimStart, trimEnd, minUsefulRemnant, parts, stock, purchases, totalParts };
}

function abort(options) {
  if (options?.signal?.aborted || options?.shouldCancel?.()) {
    const error = new Error('Расчёт отменён.');
    error.name = 'AbortError';
    throw error;
  }
}
const compatible = (a, b) => a.profile === b.profile && a.material === b.material;
const required = (bin, part, kerf) => part.length + (bin.parts.length ? kerf : 0);
const scoreLess = (a, b) => {
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
  return false;
};
function score(solution, config) {
  let newLength = 0, newCount = 0, waste = 0, stockLength = 0;
  for (const bin of solution.bins) {
    if (bin.source.kind === 'purchase') { newLength += bin.source.length; newCount++; } else stockLength += bin.source.length;
    const tailBeforeCut = bin.source.usable - bin.used;
    const finalKerf = Math.min(tailBeforeCut, config.kerf);
    const tail = tailBeforeCut - finalKerf;
    waste += config.trimStart + config.trimEnd + (bin.parts.length - 1) * config.kerf + finalKerf + (tail < config.minUsefulRemnant ? tail : 0);
  }
  return [solution.unplaced.length, solution.unplaced.reduce((sum, part) => sum + part.length, 0), newLength, newCount, waste, stockLength];
}
function potentialLoad(source, remaining, kerf) {
  let used = 0, count = 0;
  for (const part of remaining) {
    const next = part.length + (count ? kerf : 0);
    if (used + next <= source.usable) { used += next; count++; }
  }
  return { used, count };
}
function greedy(parts, sources, config, order, policy, options) {
  const sorted = [...parts].sort(order === 'ascending' ? (a, b) => a.length - b.length : order === 'descending' ? (a, b) => b.length - a.length : (a, b) => a.rowIndex - b.rowIndex);
  const bins = [], unplaced = [], counts = new Map();
  for (let i = 0; i < sorted.length; i++) {
    if ((i & 31) === 0) abort(options);
    const part = sorted[i];
    let best = null;
    for (const bin of bins) {
      const next = required(bin, part, config.kerf);
      if (bin.used + next <= bin.source.usable && (!best || bin.source.usable - bin.used < best.source.usable - best.used)) best = bin;
    }
    if (best) { best.used += required(best, part, config.kerf); best.parts.push(part); continue; }
    let eligible = sources.filter((s) => s.usable >= part.length && (counts.get(s.key) || 0) < s.quantity);
    const inStock = eligible.filter((s) => s.kind !== 'purchase');
    if (inStock.length) eligible = inStock;
    if (!eligible.length) { unplaced.push(part); continue; }
    let selected;
    if (policy === 'fill') {
      const remaining = sorted.slice(i).sort((a, b) => b.length - a.length);
      const candidates = eligible.map((s) => ({ s, load: potentialLoad(s, remaining, config.kerf) }));
      candidates.sort((a, b) => (a.s.length / a.load.used) - (b.s.length / b.load.used) || a.s.length - b.s.length || a.s.key.localeCompare(b.s.key));
      selected = candidates[0].s;
    } else {
      eligible.sort((a, b) => (policy === 'longest' ? b.length - a.length : a.length - b.length) || a.key.localeCompare(b.key));
      selected = eligible[0];
    }
    counts.set(selected.key, (counts.get(selected.key) || 0) + 1);
    bins.push({ source: selected, used: part.length, parts: [part] });
  }
  return { bins, unplaced };
}

/** Bounded independent placement search for tiny jobs; it also improves greedy seeds. */
function improveSmall(parts, sources, config, initial, options) {
  if (parts.length > 12 || sources.length > 12) return { solution: initial, checked: false, nodes: 0 };
  let best = initial, bestScore = score(initial, config), nodes = 0, stopped = false;
  const sorted = [...parts].sort((a, b) => b.length - a.length);
  const sourceOrder = [...sources].sort((a, b) => Number(a.kind === 'purchase') - Number(b.kind === 'purchase') || a.length - b.length || a.key.localeCompare(b.key));
  const bins = [], unplaced = [], counts = new Map();
  function visit(index, newLength, newCount, missingLength) {
    if (++nodes > 150000) { stopped = true; return; }
    if ((nodes & 255) === 0) abort(options);
    if (unplaced.length > bestScore[0] || (unplaced.length === bestScore[0] && missingLength > bestScore[1])) return;
    if (unplaced.length === bestScore[0] && missingLength === bestScore[1] && (newLength > bestScore[2] || (newLength === bestScore[2] && newCount > bestScore[3]))) return;
    if (index === sorted.length) {
      const candidate = { bins, unplaced }, candidateScore = score(candidate, config);
      if (scoreLess(candidateScore, bestScore)) { bestScore = candidateScore; best = { bins: bins.map((bin) => ({ ...bin, parts: [...bin.parts] })), unplaced: [...unplaced] }; }
      return;
    }
    const part = sorted[index], seen = new Set();
    for (const bin of bins) {
      const next = required(bin, part, config.kerf);
      const signature = `${bin.source.kind}:${bin.source.length}:${bin.used}:${bin.parts.length}`;
      if (bin.used + next > bin.source.usable || seen.has(signature)) continue;
      seen.add(signature);
      bin.used += next; bin.parts.push(part);
      visit(index + 1, newLength, newCount, missingLength);
      bin.parts.pop(); bin.used -= next;
      if (stopped) return;
    }
    const seenSources = new Set();
    for (const source of sourceOrder) {
      const count = counts.get(source.key) || 0;
      if (source.usable < part.length || count >= source.quantity) continue;
      // Equal source rows with finite quantities remain available through their counts.
      const signature = `${source.kind}:${source.length}:${source.quantity - count}`;
      if (seenSources.has(signature)) continue;
      seenSources.add(signature);
      counts.set(source.key, count + 1);
      bins.push({ source, used: part.length, parts: [part] });
      visit(index + 1, newLength + (source.kind === 'purchase' ? source.length : 0), newCount + Number(source.kind === 'purchase'), missingLength);
      bins.pop(); counts.set(source.key, count);
      if (stopped) return;
    }
    unplaced.push(part);
    visit(index + 1, newLength, newCount, missingLength + part.length);
    unplaced.pop();
  }
  visit(0, 0, 0, 0);
  return { solution: best, checked: !stopped, nodes };
}

function buildMap(bin, index, config, sourceOrdinal) {
  let cursor = 0;
  const segments = [], kerfs = [], parts = [];
  const add = (type, size, extra = {}) => {
    if (!size) return;
    const segment = { type, start: fromUnits(cursor), length: fromUnits(size), end: fromUnits(cursor + size), ...extra };
    segments.push(segment); cursor += size;
    if (type === 'kerf') kerfs.push(segment);
    if (type === 'part') parts.push(segment);
  };
  add('trim', config.trimStart, { label: 'Торцовка начала (включая её пропил)' });
  bin.parts.forEach((part, partIndex) => {
    if (partIndex) add('kerf', config.kerf, { nominalWidth: fromUnits(config.kerf), partial: false, label: 'Между деталями' });
    add('part', part.length, { partId: part.id, pieceNumber: part.pieceNumber, name: part.name, label: `${part.name} №${part.pieceNumber}` });
  });
  const tailBeforeCut = bin.source.usable - bin.used;
  const finalKerf = Math.min(tailBeforeCut, config.kerf);
  add('kerf', finalKerf, { nominalWidth: fromUnits(config.kerf), partial: finalKerf < config.kerf, label: finalKerf < config.kerf ? 'Удаление короткого хвоста: диск выходит за готовый край' : 'Отделение последней детали' });
  const tail = tailBeforeCut - finalKerf;
  add(tail >= config.minUsefulRemnant ? 'remnant' : 'waste', tail, { label: tail >= config.minUsefulRemnant ? 'Полезный остаток' : 'Отход хвоста' });
  add('trim', config.trimEnd, { label: 'Торцовка конца (включая её пропил)' });
  if (cursor !== bin.source.length) throw new Error('Внутренняя проверка: нарушен баланс длины заготовки.');
  const partLength = bin.parts.reduce((sum, part) => sum + part.length, 0);
  const kerfLength = (bin.parts.length - 1) * config.kerf + finalKerf;
  const usefulRemnant = tail >= config.minUsefulRemnant ? tail : 0;
  const waste = config.trimStart + config.trimEnd + kerfLength + tail - usefulRemnant;
  // At zero kerf, the separation is still a cut even though no interval is removed.
  const cuttingPasses = bin.parts.length - 1 + Number(tailBeforeCut > 0);
  return {
    id: `map-${index + 1}`, number: index + 1, sourceId: bin.source.id, sourceKey: bin.source.key, sourceOrdinal,
    sourceName: bin.source.name, kind: bin.source.kind, profile: bin.source.profile, material: bin.source.material,
    length: fromUnits(bin.source.length), usableLength: fromUnits(bin.source.usable), segments, parts, kerfs,
    partLength: fromUnits(partLength), kerfLength: fromUnits(kerfLength), trimLength: fromUnits(config.trimStart + config.trimEnd),
    remainingLength: fromUnits(tail), usefulRemnant: fromUnits(usefulRemnant), waste: fromUnits(waste), cuttingPasses,
    trimPasses: Number(config.trimStart > 0) + Number(config.trimEnd > 0), balance: true,
  };
}

export function calculate(input, options = {}) {
  abort(options);
  const config = validate(input), groups = new Map();
  for (const row of config.parts) {
    const key = JSON.stringify([row.profile, row.material]);
    if (!groups.has(key)) groups.set(key, { profile: row.profile, material: row.material, pieces: [] });
    for (let index = 0; index < row.quantity; index++) groups.get(key).pieces.push({ ...row, pieceNumber: index + 1 });
  }
  const combined = { bins: [], unplaced: [] }, groupResults = [];
  for (const group of groups.values()) {
    abort(options);
    const sources = [...config.stock, ...config.purchases].filter((source) => compatible(source, group));
    let best = null, bestScore = null;
    for (const order of ['descending', 'ascending', 'input']) {
      for (const policy of ['shortest', 'longest', 'fill']) {
        const candidate = greedy(group.pieces, sources, config, order, policy, options), candidateScore = score(candidate, config);
        if (!best || scoreLess(candidateScore, bestScore)) { best = candidate; bestScore = candidateScore; }
      }
    }
    const improved = improveSmall(group.pieces, sources, config, best, options);
    combined.bins.push(...improved.solution.bins);
    combined.unplaced.push(...improved.solution.unplaced.map((part) => {
      const hasLongEnough = sources.some((source) => source.usable >= part.length);
      return { partId: part.id, name: part.name, profile: part.profile, material: part.material, length: fromUnits(part.length), pieceNumber: part.pieceNumber,
        reason: !sources.length ? 'Нет заготовок этого профиля и материала.' : !hasLongEnough ? 'Деталь длиннее любой доступной заготовки после торцовки. Сварка из частей не предполагается.' : 'Доступного количества заготовок не хватило для предложенной карты. Проверьте наличие и варианты закупки.',
        reasonCode: !sources.length ? 'no-compatible-source' : !hasLongEnough ? 'too-long' : 'finite-stock-or-heuristic',
      };
    }));
    groupResults.push({ profile: group.profile, material: group.material, smallSearchCompleted: improved.checked, searchNodes: improved.nodes });
  }
  const ordinals = new Map();
  const maps = combined.bins.map((bin, index) => {
    const ordinal = (ordinals.get(bin.source.key) || 0) + 1;
    ordinals.set(bin.source.key, ordinal);
    return buildMap(bin, index, config, ordinal);
  });
  const procurementMap = new Map();
  for (const map of maps.filter((map) => map.kind === 'purchase')) {
    const row = procurementMap.get(map.sourceKey) || { sourceId: map.sourceId, profile: map.profile, material: map.material, length: map.length, quantity: 0, totalLength: 0, cleanPartsLength: 0 };
    row.quantity++; row.totalLength = fromUnits(Math.round(row.length * SCALE) * row.quantity);
    row.cleanPartsLength = fromUnits(Math.round(row.cleanPartsLength * SCALE) + Math.round(map.partLength * SCALE));
    procurementMap.set(map.sourceKey, row);
  }
  const procurement = [...procurementMap.values()];
  const sum = (key, selected = maps) => fromUnits(selected.reduce((total, map) => total + Math.round(map[key] * SCALE), 0));
  const totals = {
    requestedPieces: config.totalParts, placedPieces: maps.reduce((total, map) => total + map.parts.length, 0), unplacedPieces: combined.unplaced.length,
    cleanPartsLength: sum('partLength'), requestedPartsLength: fromUnits(config.parts.reduce((total, part) => total + part.length * part.quantity, 0)),
    stockLength: sum('length', maps.filter((map) => map.kind !== 'purchase')), newLength: sum('length', maps.filter((map) => map.kind === 'purchase')),
    newBars: maps.filter((map) => map.kind === 'purchase').length, stockBars: maps.filter((map) => map.kind !== 'purchase').length,
    usefulRemnant: sum('usefulRemnant'), waste: sum('waste'), kerfLength: sum('kerfLength'), trimLength: sum('trimLength'),
    cuttingPasses: maps.reduce((total, map) => total + map.cuttingPasses, 0), trimPasses: maps.reduce((total, map) => total + map.trimPasses, 0),
  };
  if (totals.placedPieces + totals.unplacedPieces !== config.totalParts) throw new Error('Внутренняя проверка: нарушено количество деталей.');
  const rows = maps.flatMap((map) => map.segments.map((segment) => ({
    map: map.number, sourceId: map.sourceId, sourceOrdinal: map.sourceOrdinal, source: map.kind === 'purchase' ? 'Закупка' : map.kind === 'remnant' ? 'Остаток в наличии' : 'Заготовка в наличии',
    profile: map.profile, material: map.material, type: { part: 'Деталь', kerf: 'Пропил', trim: 'Торцовка', remnant: 'Полезный остаток', waste: 'Отход' }[segment.type],
    name: segment.label, length: segment.length, start: segment.start, end: segment.end,
  })));
  const unusedStock = config.stock.map((source) => ({ sourceId: source.id, name: source.name, profile: source.profile, material: source.material, length: fromUnits(source.length), available: source.quantity, used: ordinals.get(source.key) || 0, remaining: source.quantity - (ordinals.get(source.key) || 0) }));
  return {
    methodologyVersion, algorithm: 'Предложенная карта: девять детерминированных эвристик и ограниченный перебор малых задач.',
    criteria: 'Сначала размещаем максимум деталей; затем уменьшаем длину нового материала, число новых хлыстов и отходы. Наличие и остатки имеют конечное количество. Глобальный оптимум для произвольной задачи не гарантируется.',
    maps, procurement, unplaced: combined.unplaced, unusedStock, groups: groupResults, totals,
    summary: [
      { label: 'Размещено деталей', value: totals.placedPieces, unit: 'шт.' },
      { label: 'Из наличия', value: totals.stockLength / 1000, unit: 'м' },
      { label: 'Докупить', value: totals.newLength / 1000, unit: 'м' },
      { label: 'Новых хлыстов', value: totals.newBars, unit: 'шт.' },
      { label: 'Чистый метраж деталей', value: totals.cleanPartsLength / 1000, unit: 'м' },
      { label: 'Полезные остатки', value: totals.usefulRemnant / 1000, unit: 'м' },
      { label: 'Отходы с пропилом и торцовкой', value: totals.waste / 1000, unit: 'м' },
      { label: 'Не размещено', value: totals.unplacedPieces, unit: 'шт.' },
    ],
    columns: [
      { key: 'map', label: 'Карта' }, { key: 'source', label: 'Источник' }, { key: 'sourceId', label: 'ID заготовки' }, { key: 'sourceOrdinal', label: 'Номер заготовки в строке наличия' },
      { key: 'profile', label: 'Профиль' }, { key: 'material', label: 'Материал' }, { key: 'type', label: 'Элемент' }, { key: 'name', label: 'Название' },
      { key: 'length', label: 'Длина, мм' }, { key: 'start', label: 'Начало, мм' }, { key: 'end', label: 'Конец, мм' },
    ], rows,
    notes: [
      'Только прямые резы 90°. Проверяйте карту перед производством; припуски на другие операции не включены.',
      'Торцовка — суммарная потеря на соответствующем конце, уже включая пропил торцовочного реза. Начальный и конечный припуски применяются по одному разу к каждой используемой заготовке.',
      'Если положительный хвост короче ширины диска, удаляется весь хвост; часть диска выходит за готовый край. Если такая операция недопустима на вашем оборудовании, увеличьте торцовочный припуск и перепроверьте карту.',
      'Чистая длина деталей, использованное наличие и закупаемый метраж показаны отдельно. Оставшиеся заготовки не считаются использованными.',
    ],
    usedCoefficients: { kerf: input.kerf, trimStart: input.trimStart, trimEnd: input.trimEnd, minUsefulRemnant: input.minUsefulRemnant, unit: 'мм', internalUnit: '0,001 мм' },
  };
}

export function freshExample() { return clone(example); }

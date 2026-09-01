const DEFAULT_CAPACITY = 200;
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_ARRAY_INDEX = 4_294_967_294;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function freezeSnapshot(value) {
  return Object.freeze(clone(value));
}

function isDeepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null || typeof left !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && isDeepEqual(left[key], right[key]));
}

function assertSafePathPart(part) {
  if (typeof part === 'number') {
    if (!Number.isSafeInteger(part) || part < 0 || part > MAX_ARRAY_INDEX) {
      throw new TypeError('Path contains an invalid array index.');
    }
    return part;
  }
  const normalized = String(part);
  if (!normalized || FORBIDDEN_PATH_PARTS.has(normalized)) {
    throw new TypeError('Path contains an empty or unsafe property.');
  }
  return normalized;
}

function tokenizePath(path) {
  if (Array.isArray(path)) return path.map(assertSafePathPart);
  const source = String(path ?? '');
  if (!source) return [];

  const parts = [];
  let cursor = 0;
  let expectsPart = true;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '.') {
      if (expectsPart) throw new TypeError('Path contains an empty property.');
      expectsPart = true;
      cursor += 1;
      continue;
    }
    if (character === '[') {
      if (expectsPart && parts.length > 0) throw new TypeError('Path contains an invalid bracket index.');
      const closingBracket = source.indexOf(']', cursor + 1);
      if (closingBracket < 0) throw new TypeError('Path contains an unclosed bracket index.');
      const rawIndex = source.slice(cursor + 1, closingBracket);
      if (!/^(?:0|[1-9]\d*)$/u.test(rawIndex)) throw new TypeError('Path bracket indexes must be non-negative integers.');
      parts.push(assertSafePathPart(Number(rawIndex)));
      cursor = closingBracket + 1;
      expectsPart = false;
      if (cursor < source.length && source[cursor] !== '.' && source[cursor] !== '[') {
        throw new TypeError('Path is malformed after a bracket index.');
      }
      continue;
    }
    if (!expectsPart) throw new TypeError('Path properties must be separated by a dot or bracket index.');
    const start = cursor;
    while (cursor < source.length && source[cursor] !== '.' && source[cursor] !== '[' && source[cursor] !== ']') cursor += 1;
    if (cursor === start || source[cursor] === ']') throw new TypeError('Path contains an unexpected closing bracket.');
    parts.push(assertSafePathPart(source.slice(start, cursor)));
    expectsPart = false;
  }
  if (expectsPart) throw new TypeError('Path cannot end with a separator.');
  return parts;
}

function isArrayIndex(part) {
  if (typeof part === 'number') return Number.isSafeInteger(part) && part >= 0 && part <= MAX_ARRAY_INDEX;
  return /^(?:0|[1-9]\d*)$/u.test(part) && Number(part) <= MAX_ARRAY_INDEX;
}

export function createHistoryStore(initialValue, {
  capacity = DEFAULT_CAPACITY,
  coalesceMs = 750,
  now = () => Date.now(),
  onChange = () => {}
} = {}) {
  if (!Number.isInteger(capacity) || capacity < 50) throw new RangeError('Undo capacity must be at least 50.');
  let current = freezeSnapshot(initialValue);
  let past = [];
  let future = [];
  let boundary = freezeSnapshot(initialValue);
  const checkpoints = new WeakSet();

  function cloneHistoryEntries(entries) {
    return entries.map((entry) => ({ ...entry, value: freezeSnapshot(entry.value) }));
  }

  function emit(reason) {
    onChange(snapshot(), reason);
  }

  function snapshot() {
    return Object.freeze({
      value: clone(current),
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      dirty: !isDeepEqual(current, boundary),
      undoCount: past.length,
      redoCount: future.length
    });
  }

  function commit(nextValue, {
    label = 'Изменение',
    coalesceKey = '',
    force = false
  } = {}) {
    const next = freezeSnapshot(nextValue);
    if (!force && isDeepEqual(current, next)) return snapshot();
    const timestamp = now();
    const last = past.at(-1);
    if (coalesceKey && last?.coalesceKey === coalesceKey && timestamp - last.timestamp <= coalesceMs) {
      last.timestamp = timestamp;
      last.label = label;
    } else {
      past.push({ value: current, label, coalesceKey, timestamp });
      if (past.length > capacity) past.splice(0, past.length - capacity);
    }
    current = next;
    future = [];
    emit('commit');
    return snapshot();
  }

  function undo() {
    const entry = past.pop();
    if (!entry) return snapshot();
    future.push({ value: current, label: entry.label, coalesceKey: '', timestamp: now() });
    current = entry.value;
    emit('undo');
    return snapshot();
  }

  function redo() {
    const entry = future.pop();
    if (!entry) return snapshot();
    past.push({ value: current, label: entry.label, coalesceKey: '', timestamp: now() });
    current = entry.value;
    emit('redo');
    return snapshot();
  }

  // A UI gesture needs a stronger boundary than an undo-count comparison:
  // adjacent text commits may coalesce and a bounded history can keep the same
  // length while dropping its oldest entry. The opaque checkpoint restores the
  // exact current/past/future state without moving the saved boundary.
  function createCheckpoint() {
    const checkpoint = Object.freeze({
      current: freezeSnapshot(current),
      past: Object.freeze(cloneHistoryEntries(past).map(Object.freeze)),
      future: Object.freeze(cloneHistoryEntries(future).map(Object.freeze))
    });
    checkpoints.add(checkpoint);
    return checkpoint;
  }

  function restoreCheckpoint(checkpoint) {
    if (!checkpoint || !checkpoints.has(checkpoint)) throw new TypeError('History checkpoint is invalid or already restored.');
    checkpoints.delete(checkpoint);
    current = freezeSnapshot(checkpoint.current);
    past = cloneHistoryEntries(checkpoint.past);
    future = cloneHistoryEntries(checkpoint.future);
    emit('checkpoint-restore');
    return snapshot();
  }

  function markBoundary(value = current) {
    current = freezeSnapshot(value);
    boundary = current;
    past = [];
    future = [];
    emit('boundary');
    return snapshot();
  }

  // A save may finish while the user is already typing the next change. In that
  // case the committed value becomes the new boundary, but the newer browser
  // draft and its undo stack must remain intact.
  function setBoundary(value) {
    boundary = freezeSnapshot(value);
    emit('saved-boundary');
    return snapshot();
  }

  function resetToBoundary() {
    current = boundary;
    past = [];
    future = [];
    emit('reset');
    return snapshot();
  }

  return Object.freeze({
    snapshot,
    commit,
    undo,
    redo,
    createCheckpoint,
    restoreCheckpoint,
    markBoundary,
    setBoundary,
    resetToBoundary
  });
}

export function getAtPath(value, path) {
  const parts = tokenizePath(path);
  return parts.reduce((current, part) => current?.[part], value);
}

export function setAtPath(value, path, nextValue) {
  const parts = tokenizePath(path);
  if (!parts.length) return clone(nextValue);
  const root = clone(value ?? {});
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const nextKey = parts[index + 1];
    if (cursor[key] === null || typeof cursor[key] !== 'object') {
      cursor[key] = isArrayIndex(nextKey) ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[parts.at(-1)] = clone(nextValue);
  return root;
}

export function deleteAtPath(value, path) {
  const parts = tokenizePath(path);
  if (!parts.length) return undefined;
  const root = clone(value);
  if (root === null || typeof root !== 'object') return root;
  let cursor = root;
  for (const key of parts.slice(0, -1)) {
    cursor = cursor?.[key];
    if (!cursor || typeof cursor !== 'object') return root;
  }
  if (Array.isArray(cursor) && isArrayIndex(parts.at(-1))) cursor.splice(Number(parts.at(-1)), 1);
  else delete cursor[parts.at(-1)];
  return root;
}

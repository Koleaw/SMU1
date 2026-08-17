const DEFAULT_CAPACITY = 200;

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

  function markBoundary(value = current) {
    current = freezeSnapshot(value);
    boundary = current;
    past = [];
    future = [];
    emit('boundary');
    return snapshot();
  }

  function resetToBoundary() {
    current = boundary;
    past = [];
    future = [];
    emit('reset');
    return snapshot();
  }

  return Object.freeze({ snapshot, commit, undo, redo, markBoundary, resetToBoundary });
}

export function getAtPath(value, path) {
  const parts = Array.isArray(path) ? path : String(path).split('.').filter(Boolean);
  return parts.reduce((current, part) => current?.[part], value);
}

export function setAtPath(value, path, nextValue) {
  const parts = Array.isArray(path) ? path : String(path).split('.').filter(Boolean);
  if (!parts.length) return clone(nextValue);
  const root = clone(value ?? {});
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const nextKey = parts[index + 1];
    if (cursor[key] === null || typeof cursor[key] !== 'object') {
      cursor[key] = Number.isInteger(Number(nextKey)) ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[parts.at(-1)] = clone(nextValue);
  return root;
}

export function deleteAtPath(value, path) {
  const parts = Array.isArray(path) ? path : String(path).split('.').filter(Boolean);
  if (!parts.length) return undefined;
  const root = clone(value);
  let cursor = root;
  for (const key of parts.slice(0, -1)) {
    cursor = cursor?.[key];
    if (!cursor || typeof cursor !== 'object') return root;
  }
  if (Array.isArray(cursor)) cursor.splice(Number(parts.at(-1)), 1);
  else delete cursor[parts.at(-1)];
  return root;
}

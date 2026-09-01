const DATABASE_NAME = 'smu1-admin-h6';
const DATABASE_VERSION = 2;
const STORE_NAME = 'record-drafts';
const MAX_DRAFT_BYTES = 5 * 1024 * 1024;
const DEFAULT_RETENTION_COUNT = 160;
const DEFAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function keyOf({ repoIdentity, collection, slug }) {
  const values = [repoIdentity, collection, slug].map((value) => String(value || '').trim());
  if (values.some((value) => !value)) throw new TypeError('Draft identity is incomplete.');
  return values.join('::');
}

function assertSerializable(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return;
  if (typeof File !== 'undefined' && value instanceof File) throw new TypeError('File objects cannot be stored in record drafts.');
  if (typeof Blob !== 'undefined' && value instanceof Blob) throw new TypeError('Blob objects cannot be stored in record drafts.');
  if (typeof value !== 'object') return;
  if (seen.has(value)) throw new TypeError('Circular values cannot be stored in record drafts.');
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item) => assertSerializable(item, seen));
  else Object.values(value).forEach((item) => assertSerializable(item, seen));
  seen.delete(value);
}

function normalizeDraft(draft, now) {
  assertSerializable(draft?.content);
  assertSerializable(draft?.stagedMedia);
  const normalized = {
    key: keyOf(draft),
    repoIdentity: String(draft.repoIdentity),
    collection: String(draft.collection),
    slug: String(draft.slug),
    baseRevision: String(draft.baseRevision || ''),
    schemaVersion: String(draft.schemaVersion || ''),
    updatedAt: new Date(now()).toISOString(),
    content: structuredClone(draft.content),
    stagedMedia: structuredClone(draft.stagedMedia || [])
  };
  const serialized = JSON.stringify(normalized);
  if (new TextEncoder().encode(serialized).byteLength > MAX_DRAFT_BYTES) {
    throw new RangeError('Record draft exceeds the safe browser storage limit.');
  }
  return normalized;
}

function normalizeCleanupOptions({
  repoIdentity,
  keep = DEFAULT_RETENTION_COUNT,
  olderThanMs = DEFAULT_RETENTION_MS,
  preserveKeys = []
} = {}) {
  if (!Number.isInteger(keep) || keep < 0) throw new RangeError('Draft retention count must be a non-negative integer.');
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) throw new RangeError('Draft retention age must be a non-negative duration.');
  if (!Array.isArray(preserveKeys)) throw new TypeError('Draft preserveKeys must be an array.');
  return {
    repoIdentity: repoIdentity === undefined ? '' : String(repoIdentity),
    keep,
    olderThanMs,
    preserveKeys: new Set(preserveKeys.map((identity) => typeof identity === 'string' ? identity : keyOf(identity)))
  };
}

function cleanupSelection(rows, options, timestamp) {
  const relevant = rows.filter((row) => !options.repoIdentity || row.repoIdentity === options.repoIdentity);
  const groups = new Map();
  for (const row of relevant) {
    const group = groups.get(row.repoIdentity) || [];
    group.push(row);
    groups.set(row.repoIdentity, group);
  }

  const cutoff = timestamp - options.olderThanMs;
  const removedRows = [];
  for (const group of groups.values()) {
    group.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.key.localeCompare(right.key));
    group.forEach((row, index) => {
      if (options.preserveKeys.has(row.key)) return;
      const updatedAt = Date.parse(row.updatedAt);
      const expired = !Number.isFinite(updatedAt) || updatedAt < cutoff;
      if (expired || index >= options.keep) removedRows.push({ row, reason: expired ? 'expired' : 'over-limit' });
    });
  }

  const expired = removedRows.filter((entry) => entry.reason === 'expired').length;
  return {
    removedRows,
    report: {
      removed: removedRows.length,
      retained: relevant.length - removedRows.length,
      expired,
      overLimit: removedRows.length - expired,
      removedKeys: removedRows.map(({ row }) => row.key)
    }
  };
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function openDatabase(indexedDB) {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener('upgradeneeded', () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      store.createIndex('updatedAt', 'updatedAt');
      store.createIndex('repoIdentity', 'repoIdentity');
    }
    if (!database.objectStoreNames.contains('media-queues')) {
      const queues = database.createObjectStore('media-queues', { keyPath: 'key' });
      queues.createIndex('updatedAt', 'updatedAt');
      queues.createIndex('repoIdentity', 'repoIdentity');
    }
  });
  return requestPromise(request);
}

export function createDraftStore({ indexedDB = globalThis.indexedDB, now = () => Date.now() } = {}) {
  if (!indexedDB) throw new Error('IndexedDB is unavailable in this browser.');
  let databasePromise = null;
  const database = () => databasePromise ??= openDatabase(indexedDB);

  async function transaction(mode, callback) {
    const db = await database();
    const tx = db.transaction(STORE_NAME, mode);
    const result = await callback(tx.objectStore(STORE_NAME));
    await new Promise((resolve, reject) => {
      tx.addEventListener('complete', resolve, { once: true });
      tx.addEventListener('abort', () => reject(tx.error), { once: true });
      tx.addEventListener('error', () => reject(tx.error), { once: true });
    });
    return result;
  }

  async function list(repoIdentity) {
    const values = await transaction('readonly', (store) => requestPromise(store.getAll()));
    return values
      .filter((draft) => !repoIdentity || draft.repoIdentity === repoIdentity)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.key.localeCompare(right.key))
      .map((draft) => structuredClone(draft));
  }

  async function cleanup(options = {}) {
    const normalized = normalizeCleanupOptions(options);
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let report = null;
      const request = store.getAll();
      request.addEventListener('success', () => {
        const selection = cleanupSelection(request.result || [], normalized, now());
        report = selection.report;
        // Queue every deletion while the IndexedDB success event still keeps
        // this transaction active. Promise continuations are too late in some
        // browsers (notably WebKit) and can cause TransactionInactiveError.
        selection.removedRows.forEach(({ row }) => store.delete(row.key));
      }, { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
      tx.addEventListener('complete', () => resolve(report || cleanupSelection([], normalized, now()).report), { once: true });
      tx.addEventListener('abort', () => reject(tx.error), { once: true });
      tx.addEventListener('error', () => reject(tx.error), { once: true });
    });
  }

  return Object.freeze({
    keyOf,
    async put(draft) {
      const normalized = normalizeDraft(draft, now);
      await transaction('readwrite', (store) => requestPromise(store.put(normalized)));
      return structuredClone(normalized);
    },
    async get(identity) {
      const value = await transaction('readonly', (store) => requestPromise(store.get(keyOf(identity))));
      return value ? structuredClone(value) : null;
    },
    async delete(identity) {
      await transaction('readwrite', (store) => requestPromise(store.delete(keyOf(identity))));
    },
    list,
    cleanup
  });
}

export function createMemoryDraftStore({ now = () => Date.now() } = {}) {
  const records = new Map();
  return Object.freeze({
    keyOf,
    async put(draft) {
      const normalized = normalizeDraft(draft, now);
      records.set(normalized.key, normalized);
      return structuredClone(normalized);
    },
    async get(identity) {
      const value = records.get(keyOf(identity));
      return value ? structuredClone(value) : null;
    },
    async delete(identity) { records.delete(keyOf(identity)); },
    async list(repoIdentity) {
      return [...records.values()]
        .filter((draft) => !repoIdentity || draft.repoIdentity === repoIdentity)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.key.localeCompare(right.key))
        .map((draft) => structuredClone(draft));
    },
    async cleanup(options = {}) {
      const normalized = normalizeCleanupOptions(options);
      const { removedRows, report } = cleanupSelection([...records.values()], normalized, now());
      removedRows.forEach(({ row }) => records.delete(row.key));
      return report;
    }
  });
}

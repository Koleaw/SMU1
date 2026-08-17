const DATABASE_NAME = 'smu1-admin-h6';
const DATABASE_VERSION = 1;
const STORE_NAME = 'record-drafts';
const MAX_DRAFT_BYTES = 5 * 1024 * 1024;

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
    async list(repoIdentity) {
      const values = await transaction('readonly', (store) => requestPromise(store.getAll()));
      return values
        .filter((draft) => !repoIdentity || draft.repoIdentity === repoIdentity)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((draft) => structuredClone(draft));
    }
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
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((draft) => structuredClone(draft));
    }
  });
}

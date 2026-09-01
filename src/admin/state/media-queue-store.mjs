const DATABASE_NAME = 'smu1-admin-h6';
const DATABASE_VERSION = 2;
const STORE_NAME = 'media-queues';
const MAX_QUEUE_ITEMS = 50;
const MAX_QUEUE_BYTES = 250 * 1024 * 1024;
const MEDIA_ROLES = new Set(['gallery', 'cover', 'hero', 'archive', 'excluded']);
const DUPLICATE_ACTIONS = new Set(['reuse', 'replace', 'skip']);

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function openDatabase(indexedDB) {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener('upgradeneeded', () => {
    const database = request.result;
    if (!database.objectStoreNames.contains('record-drafts')) {
      const drafts = database.createObjectStore('record-drafts', { keyPath: 'key' });
      drafts.createIndex('updatedAt', 'updatedAt');
      drafts.createIndex('repoIdentity', 'repoIdentity');
    }
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      const queues = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      queues.createIndex('updatedAt', 'updatedAt');
      queues.createIndex('repoIdentity', 'repoIdentity');
    }
  });
  return requestResult(request);
}

function queueKey({ repoIdentity, collection, slug, fieldPath }) {
  const values = [repoIdentity, collection, slug, fieldPath].map((value) => String(value || '').trim());
  if (values.some((value) => !value)) throw new TypeError('Media queue identity is incomplete.');
  return values.join('::');
}

function normalizeRoles(value, fallback = ['gallery']) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  const roles = [...new Set(source.map((role) => String(role || '').trim()).filter(Boolean))];
  if (!roles.length || roles.some((role) => !MEDIA_ROLES.has(role))) {
    throw new TypeError('Media queue contains an unsupported presentation role.');
  }
  if (roles.includes('excluded') && roles.length > 1) {
    throw new TypeError('Excluded media cannot also have a public presentation role.');
  }
  return roles;
}

function normalizeQueue(queue, now) {
  const items = Array.isArray(queue?.items) ? queue.items : [];
  if (items.length > MAX_QUEUE_ITEMS) throw new RangeError('Media queue exceeds the 50-file limit.');
  const bytes = items.reduce((sum, item) => sum + Number(item?.file?.size || item?.bytes || 0), 0);
  if (bytes > MAX_QUEUE_BYTES) throw new RangeError('Media queue exceeds the 250 MB recovery limit.');
  const seen = new Set();
  const normalizedItems = items.map((item, index) => {
    const clientId = String(item?.clientId || '');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(clientId) || seen.has(clientId)) {
      throw new TypeError('Media queue stable clientId is invalid or duplicated.');
    }
    seen.add(clientId);
    if (item.file !== null && item.file !== undefined && !(item.file instanceof Blob)) {
      throw new TypeError('Media queue file must be a Blob/File.');
    }
    const legacyRole = String(item.role || 'gallery');
    const roles = normalizeRoles(item.roles, [legacyRole]);
    const originalRoles = normalizeRoles(item.originalRoles, roles);
    const duplicateAction = String(item.duplicateAction || 'reuse');
    if (!DUPLICATE_ACTIONS.has(duplicateAction)) {
      throw new TypeError('Media queue duplicate action is invalid.');
    }
    return {
      clientId,
      originalIndex: Number.isSafeInteger(item.originalIndex) ? item.originalIndex : index,
      file: item.file || null,
      name: String(item.name || item.file?.name || ''),
      type: String(item.type || item.file?.type || ''),
      bytes: Number(item.bytes || item.file?.size || 0),
      width: Number(item.width || 0),
      height: Number(item.height || 0),
      alt: String(item.alt || ''),
      caption: String(item.caption || ''),
      role: roles.includes(legacyRole) ? legacyRole : roles[0],
      roles,
      originalRoles,
      roleChanged: item.roleChanged === true,
      existing: item.existing === true,
      status: String(item.status || 'waiting'),
      error: String(item.error || ''),
      canonicalPath: String(item.canonicalPath || ''),
      lease: item.lease && typeof item.lease === 'object' ? structuredClone(item.lease) : null,
      duplicateAction,
      privateMetadata: item.privateMetadata && typeof item.privateMetadata === 'object'
        ? structuredClone(item.privateMetadata)
        : null
    };
  });
  return {
    key: queueKey(queue),
    repoIdentity: String(queue.repoIdentity),
    collection: String(queue.collection),
    slug: String(queue.slug),
    fieldPath: String(queue.fieldPath),
    batchId: String(queue.batchId || ''),
    updatedAt: new Date(now()).toISOString(),
    items: normalizedItems
  };
}

export function createMediaQueueStore({ indexedDB = globalThis.indexedDB, now = () => Date.now() } = {}) {
  if (!indexedDB) throw new Error('IndexedDB is unavailable in this browser.');
  let databasePromise;
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
    const rows = await transaction('readonly', (store) => requestResult(store.getAll()));
    return rows.filter((row) => !repoIdentity || row.repoIdentity === repoIdentity)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  return Object.freeze({
    keyOf: queueKey,
    async put(queue) {
      const normalized = normalizeQueue(queue, now);
      await transaction('readwrite', (store) => requestResult(store.put(normalized)));
      return normalized;
    },
    async get(identity) {
      const result = await transaction('readonly', (store) => requestResult(store.get(queueKey(identity))));
      return result || null;
    },
    async delete(identity) {
      await transaction('readwrite', (store) => requestResult(store.delete(queueKey(identity))));
    },
    list,
    async cleanup({ repoIdentity, keep = 12, olderThanMs = 14 * 24 * 60 * 60 * 1000 } = {}) {
      const rows = await list(repoIdentity);
      const cutoff = now() - olderThanMs;
      const doomed = rows.filter((row, index) => index >= keep || Date.parse(row.updatedAt) < cutoff);
      await Promise.all(doomed.map((row) => transaction('readwrite', (store) => requestResult(store.delete(row.key)))));
      return doomed.length;
    }
  });
}

export function createMemoryMediaQueueStore({ now = () => Date.now() } = {}) {
  const records = new Map();

  async function list(repoIdentity) {
    return [...records.values()]
      .filter((row) => !repoIdentity || row.repoIdentity === repoIdentity)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.key.localeCompare(right.key))
      .map((row) => structuredClone(row));
  }

  return Object.freeze({
    keyOf: queueKey,
    async put(queue) {
      const normalized = normalizeQueue(queue, now);
      records.set(normalized.key, structuredClone(normalized));
      return structuredClone(normalized);
    },
    async get(identity) {
      const result = records.get(queueKey(identity));
      return result ? structuredClone(result) : null;
    },
    async delete(identity) { records.delete(queueKey(identity)); },
    list,
    async cleanup({ repoIdentity, keep = 12, olderThanMs = 14 * 24 * 60 * 60 * 1000 } = {}) {
      const rows = await list(repoIdentity);
      const cutoff = now() - olderThanMs;
      const doomed = rows.filter((row, index) => index >= keep || Date.parse(row.updatedAt) < cutoff);
      doomed.forEach((row) => records.delete(row.key));
      return doomed.length;
    }
  });
}

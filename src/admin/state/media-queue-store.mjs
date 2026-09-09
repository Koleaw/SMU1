const DATABASE_NAME = 'smu1-admin-h6';
const DATABASE_VERSION = 2;
const STORE_NAME = 'media-queues';
const MAX_QUEUE_ITEMS = 50;
const MAX_QUEUE_BYTES = 250 * 1024 * 1024;
const MEDIA_ROLES = new Set(['gallery', 'cover', 'hero', 'archive', 'excluded']);
const DUPLICATE_ACTIONS = new Set(['reuse', 'replace', 'skip']);

export class MediaQueueConflictError extends Error {
  constructor({ key, expectedRevision, expectedToken, actualRevision, actualToken, current }) {
    super('Media recovery queue changed in another editor tab.');
    this.name = 'MediaQueueConflictError';
    this.code = 'MEDIA_QUEUE_CONFLICT';
    this.key = key;
    this.expectedRevision = expectedRevision;
    this.expectedToken = expectedToken;
    this.actualRevision = actualRevision;
    this.actualToken = actualToken;
    this.current = current ? structuredClone(current) : null;
  }
}

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

function storedQueueRevision(row) {
  if (!row) return 0;
  return Number.isSafeInteger(row.queueRevision) && row.queueRevision > 0 ? row.queueRevision : 1;
}

function legacyQueueToken(row) {
  return `legacy:${String(row?.key || queueKey(row || {}))}:${String(row?.updatedAt || '')}`;
}

function storedQueueToken(row) {
  if (!row) return '';
  return typeof row.queueToken === 'string' && row.queueToken
    ? row.queueToken
    : legacyQueueToken(row);
}

function queueWithRevision(row) {
  return row ? {
    ...row,
    queueRevision: storedQueueRevision(row),
    queueToken: storedQueueToken(row)
  } : null;
}

function expectedQueueRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Media queue expectedRevision must be a non-negative safe integer.');
  }
  return value;
}

function expectedQueueToken(value) {
  if (typeof value !== 'string' || value.length > 1024) {
    throw new TypeError('Media queue expectedToken must be a string no longer than 1024 characters.');
  }
  return value;
}

function defaultQueueToken() {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('Secure randomness is unavailable for the media queue token.');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function freshQueueToken(createToken, current) {
  const currentToken = storedQueueToken(current);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = String(createToken() || '');
    if (token && token.length <= 1024 && token !== currentToken) return token;
  }
  throw new Error('Could not create a unique media queue token.');
}

function nextQueueRevision(current) {
  const revision = storedQueueRevision(current);
  if (revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Media queue revision is exhausted.');
  return revision + 1;
}

function assertQueueVersion({ key, current, expectedRevision, expectedToken }) {
  const expected = expectedQueueRevision(expectedRevision);
  const expectedOpaqueToken = expectedQueueToken(expectedToken);
  const actual = storedQueueRevision(current);
  const actualToken = storedQueueToken(current);
  if (actual !== expected || actualToken !== expectedOpaqueToken) {
    throw new MediaQueueConflictError({
      key,
      expectedRevision: expected,
      expectedToken: expectedOpaqueToken,
      actualRevision: actual,
      actualToken,
      current: queueWithRevision(current)
    });
  }
  return { revision: actual, token: actualToken };
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
    intentVersion: Number.isSafeInteger(queue.intentVersion) ? queue.intentVersion : 1,
    baselineFingerprint: String(queue.baselineFingerprint || ''),
    baseQueueRevision: Number.isSafeInteger(queue.baseQueueRevision) && queue.baseQueueRevision >= 0
      ? queue.baseQueueRevision
      : 0,
    baseQueueToken: String(queue.baseQueueToken || ''),
    conflictForKey: String(queue.conflictForKey || ''),
    conflictOwner: String(queue.conflictOwner || ''),
    cancelled: queue.cancelled === true,
    updatedAt: new Date(now()).toISOString(),
    items: normalizedItems
  };
}

export function createMediaQueueStore({
  indexedDB = globalThis.indexedDB,
  now = () => Date.now(),
  createToken = defaultQueueToken
} = {}) {
  if (!indexedDB) throw new Error('IndexedDB is unavailable in this browser.');
  let databasePromise;
  const database = () => databasePromise ??= openDatabase(indexedDB);

  async function transaction(mode, callback) {
    const db = await database();
    const tx = db.transaction(STORE_NAME, mode);
    const completion = new Promise((resolve, reject) => {
      tx.addEventListener('complete', resolve, { once: true });
      tx.addEventListener('abort', () => reject(tx.error), { once: true });
      tx.addEventListener('error', () => reject(tx.error), { once: true });
    });
    try {
      const result = await callback(tx.objectStore(STORE_NAME));
      await completion;
      return result;
    } catch (error) {
      try { tx.abort(); } catch {}
      await completion.catch(() => {});
      throw error;
    }
  }

  async function list(repoIdentity) {
    const rows = await transaction('readonly', (store) => requestResult(store.getAll()));
    return rows.filter((row) => !repoIdentity || row.repoIdentity === repoIdentity)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(queueWithRevision);
  }

  async function compareAndSwap(queue, { expectedRevision, expectedToken } = {}) {
    const expected = expectedQueueRevision(expectedRevision);
    const expectedOpaqueToken = expectedQueueToken(expectedToken);
    const normalized = normalizeQueue(queue, now);
    return transaction('readwrite', async (store) => {
      const current = await requestResult(store.get(normalized.key));
      assertQueueVersion({
        key: normalized.key,
        current,
        expectedRevision: expected,
        expectedToken: expectedOpaqueToken
      });
      const next = {
        ...normalized,
        queueRevision: nextQueueRevision(current),
        queueToken: freshQueueToken(createToken, current)
      };
      await requestResult(store.put(next));
      return queueWithRevision(next);
    });
  }

  async function compareAndDelete(identity, { expectedRevision, expectedToken } = {}) {
    const expected = expectedQueueRevision(expectedRevision);
    const expectedOpaqueToken = expectedQueueToken(expectedToken);
    const key = queueKey(identity);
    return transaction('readwrite', async (store) => {
      const current = await requestResult(store.get(key));
      assertQueueVersion({
        key,
        current,
        expectedRevision: expected,
        expectedToken: expectedOpaqueToken
      });
      if (!current) return null;
      await requestResult(store.delete(key));
      return queueWithRevision(current);
    });
  }

  return Object.freeze({
    keyOf: queueKey,
    async put(queue) {
      const normalized = normalizeQueue(queue, now);
      return transaction('readwrite', async (store) => {
        const current = await requestResult(store.get(normalized.key));
        const next = {
          ...normalized,
          queueRevision: nextQueueRevision(current),
          queueToken: freshQueueToken(createToken, current)
        };
        await requestResult(store.put(next));
        return queueWithRevision(next);
      });
    },
    async get(identity) {
      const result = await transaction('readonly', (store) => requestResult(store.get(queueKey(identity))));
      return queueWithRevision(result);
    },
    async delete(identity) {
      await transaction('readwrite', (store) => requestResult(store.delete(queueKey(identity))));
    },
    compareAndSwap,
    compareAndDelete,
    list,
    async cleanup({ repoIdentity, keep = 12, olderThanMs = 14 * 24 * 60 * 60 * 1000 } = {}) {
      const rows = await list(repoIdentity);
      const cutoff = now() - olderThanMs;
      const doomed = rows.filter((row, index) => index >= keep || Date.parse(row.updatedAt) < cutoff);
      const deleted = await Promise.all(doomed.map(async (row) => {
        try {
          return await compareAndDelete(row, {
            expectedRevision: row.queueRevision,
            expectedToken: row.queueToken
          }) ? 1 : 0;
        } catch (error) {
          if (error instanceof MediaQueueConflictError) return 0;
          throw error;
        }
      }));
      return deleted.reduce((sum, value) => sum + value, 0);
    }
  });
}

export function createMemoryMediaQueueStore({
  now = () => Date.now(),
  createToken = defaultQueueToken
} = {}) {
  const records = new Map();

  async function list(repoIdentity) {
    return [...records.values()]
      .filter((row) => !repoIdentity || row.repoIdentity === repoIdentity)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.key.localeCompare(right.key))
      .map((row) => structuredClone(queueWithRevision(row)));
  }

  async function compareAndSwap(queue, { expectedRevision, expectedToken } = {}) {
    const normalized = normalizeQueue(queue, now);
    const current = records.get(normalized.key) || null;
    assertQueueVersion({ key: normalized.key, current, expectedRevision, expectedToken });
    const next = {
      ...normalized,
      queueRevision: nextQueueRevision(current),
      queueToken: freshQueueToken(createToken, current)
    };
    records.set(next.key, structuredClone(next));
    return structuredClone(queueWithRevision(next));
  }

  async function compareAndDelete(identity, { expectedRevision, expectedToken } = {}) {
    const key = queueKey(identity);
    const current = records.get(key) || null;
    assertQueueVersion({ key, current, expectedRevision, expectedToken });
    if (!current) return null;
    records.delete(key);
    return structuredClone(queueWithRevision(current));
  }

  return Object.freeze({
    keyOf: queueKey,
    async put(queue) {
      const normalized = normalizeQueue(queue, now);
      const current = records.get(normalized.key) || null;
      const next = {
        ...normalized,
        queueRevision: nextQueueRevision(current),
        queueToken: freshQueueToken(createToken, current)
      };
      records.set(next.key, structuredClone(next));
      return structuredClone(queueWithRevision(next));
    },
    async get(identity) {
      const result = records.get(queueKey(identity));
      return result ? structuredClone(queueWithRevision(result)) : null;
    },
    async delete(identity) { records.delete(queueKey(identity)); },
    compareAndSwap,
    compareAndDelete,
    list,
    async cleanup({ repoIdentity, keep = 12, olderThanMs = 14 * 24 * 60 * 60 * 1000 } = {}) {
      const rows = await list(repoIdentity);
      const cutoff = now() - olderThanMs;
      const doomed = rows.filter((row, index) => index >= keep || Date.parse(row.updatedAt) < cutoff);
      let deleted = 0;
      for (const row of doomed) {
        try {
          if (await compareAndDelete(row, {
            expectedRevision: row.queueRevision,
            expectedToken: row.queueToken
          })) deleted += 1;
        } catch (error) {
          if (!(error instanceof MediaQueueConflictError)) throw error;
        }
      }
      return deleted;
    }
  });
}

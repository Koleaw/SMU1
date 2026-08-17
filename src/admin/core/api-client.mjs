const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_READ_LOCK_RETRY_DELAYS_MS = Object.freeze([40, 100, 250]);

export class AdminApiError extends Error {
  constructor(message, { status = 0, code = 'ADMIN_API_ERROR', payload = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.validationIssues = Array.isArray(payload?.validationIssues) ? payload.validationIssues : [];
  }
}

function storageId(storage, key, prefix) {
  let value = storage?.getItem(key);
  if (!value) {
    value = `${prefix}-${crypto.randomUUID()}`;
    try { storage?.setItem(key, value); } catch { /* private-mode fallback stays in memory */ }
  }
  return value;
}

export function createAdminApiClient({
  baseUrl,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  onSessionExpired = () => {}
} = {}) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/u, '');
  if (!normalizedBase) throw new TypeError('Admin API base URL is required.');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required.');
  const sameOriginResourceBase = normalizedBase.startsWith('/')
    ? normalizedBase
    : new URL(normalizedBase).pathname.replace(/\/+$/u, '');
  const recoveryClientId = storageId(storage, 'smu1-admin:recovery-client', 'browser');
  let csrfToken = '';
  let sessionFingerprint = '';

  async function request(pathname, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    headers.set('X-Admin-Recovery-Client-Id', recoveryClientId);
    if (sessionFingerprint) headers.set('X-Admin-Session-Fingerprint', sessionFingerprint);
    if (MUTATING_METHODS.has(method)) {
      if (csrfToken) headers.set('X-Admin-CSRF', csrfToken);
      if (options.body !== undefined && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }

    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(`${normalizedBase}${pathname.startsWith('/') ? pathname : `/${pathname}`}`, {
          ...options,
          method,
          headers,
          credentials: 'include',
          cache: 'no-store'
        });
      } catch (cause) {
        throw new AdminApiError('Локальная админка не отвечает. Проверьте, что окно запуска остаётся открытым.', {
          code: 'ADMIN_API_OFFLINE',
          cause
        });
      }

      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json().catch(() => null)
        : await response.text().catch(() => '');
      const retryDelay = SAFE_READ_LOCK_RETRY_DELAYS_MS[attempt];
      if (method === 'GET' && response.status === 423 && payload?.code === 'TRANSACTION_LOCKED' && retryDelay !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }
      if (!response.ok) {
        if (response.status === 401) onSessionExpired();
        throw new AdminApiError(
          typeof payload?.error === 'string' ? payload.error : `Запрос завершился с ошибкой ${response.status}.`,
          { status: response.status, code: payload?.code || 'ADMIN_API_ERROR', payload }
        );
      }
      return payload;
    }
  }

  async function download(pathname) {
    const headers = new Headers({ Accept: 'application/json' });
    headers.set('X-Admin-Recovery-Client-Id', recoveryClientId);
    if (sessionFingerprint) headers.set('X-Admin-Session-Fingerprint', sessionFingerprint);
    const response = await fetchImpl(`${normalizedBase}${pathname}`, {
      headers,
      credentials: 'include', cache: 'no-store'
    });
    if (!response.ok) {
      if (response.status === 401) onSessionExpired();
      const payload = await response.json().catch(() => null);
      throw new AdminApiError(
        typeof payload?.error === 'string' ? payload.error : `Не удалось скачать данные (${response.status}).`,
        { status: response.status, code: payload?.code || 'ADMIN_DOWNLOAD_FAILED', payload }
      );
    }
    return {
      blob: await response.blob(),
      filename: response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'smu1-data.json'
    };
  }

  function acceptSession(payload) {
    csrfToken = String(payload?.csrfToken || '');
    sessionFingerprint = String(payload?.sessionFingerprint || sessionFingerprint || '');
    return payload;
  }

  return Object.freeze({
    recoveryClientId,
    get csrfToken() { return csrfToken; },
    request,
    async me() { return acceptSession(await request('/me')); },
    async login(login, password) {
      return acceptSession(await request('/login', { method: 'POST', body: JSON.stringify({ login, password }) }));
    },
    async logout() {
      const result = await request('/logout', { method: 'POST', body: '{}' });
      csrfToken = '';
      sessionFingerprint = '';
      return result;
    },
    collections: () => request('/collections'),
    list: (collection) => request(`/content/${encodeURIComponent(collection)}`),
    read: (collection, slug) => request(`/content/${encodeURIComponent(collection)}/${encodeURIComponent(slug)}`),
    readNavigation: () => request('/navigation'),
    saveNavigation: (items, baseRevision) => request('/navigation', {
      method: 'PUT', body: JSON.stringify({ items, baseRevision, recoveryClientId })
    }),
    readSingleton: (singleton) => request(`/singletons/${encodeURIComponent(singleton)}`),
    saveSingleton: (singleton, content, baseRevision) => request(`/singletons/${encodeURIComponent(singleton)}`, {
      method: 'PUT', body: JSON.stringify({ content, baseRevision, recoveryClientId })
    }),
    create: (collection, content, baseRevision = 'missing', options = {}) => request(`/content/${encodeURIComponent(collection)}`, {
      method: 'POST', body: JSON.stringify({ content, slug: content?.slug, baseRevision, recoveryClientId, stagedMedia: options.stagedMedia || [] })
    }),
    save: (collection, slug, content, baseRevision, options = {}) => request(`/content/${encodeURIComponent(collection)}/${encodeURIComponent(slug)}`, {
      method: 'PUT', body: JSON.stringify({ content, baseRevision, recoveryClientId, stagedMedia: options.stagedMedia || [] })
    }),
    remove: (collection, slug, baseRevision, relationPlan) => request(`/content/${encodeURIComponent(collection)}/${encodeURIComponent(slug)}`, {
      method: 'DELETE', body: JSON.stringify({ baseRevision, relationPlan, recoveryClientId })
    }),
    transactionPreview: (operations, { idempotencyKey = crypto.randomUUID(), baseHead = '', userSummary = '' } = {}) => request('/transactions/preview', {
      method: 'POST',
      body: JSON.stringify({ recoveryClientId, idempotencyKey, baseHead, userSummary, operations })
    }),
    transactionApply: ({ transactionId, idempotencyKey, payloadHash }) => request('/transactions/apply', {
      method: 'POST', body: JSON.stringify({ recoveryClientId, transactionId, idempotencyKey, payloadHash })
    }),
    history: () => request('/history'),
    exportFullSite: () => download('/json-export/full-site'),
    exportCatalog: () => download('/export-catalog'),
    importPreview: ({ rawJson, scope = 'full-site', collection = '', currentSlug = '', writeMode = 'merge' }) => request('/json-import/preview', {
      method: 'POST', body: JSON.stringify({ rawJson, scope, collection, currentSlug, writeMode, recoveryClientId })
    }),
    importApply: ({ operationId, replaceConfirmed = false }) => request('/json-import/apply', {
      method: 'POST', body: JSON.stringify({ operationId, replaceConfirmed, recoveryClientId })
    }),
    restorePreview: (transactionId, { idempotencyKey = crypto.randomUUID() } = {}) => request(`/history/${encodeURIComponent(transactionId)}/restore-preview`, {
      method: 'POST', body: JSON.stringify({ recoveryClientId, idempotencyKey })
    }),
    localPreview: ({ collection, slug, revision }) => request('/local-preview', {
      method: 'POST', body: JSON.stringify({ collection, slug, revision })
    }),
    publishOverview: () => request('/publish/status'),
    stageMedia: ({ batchId, clientId, originalIndex, file, signal }) => {
      const body = new FormData();
      body.append('file', file, file.name);
      body.append('batchId', batchId);
      body.append('clientId', clientId);
      body.append('originalIndex', String(originalIndex));
      return request('/media/staging', { method: 'POST', body, signal });
    },
    stagedBatch: (batchId) => request(`/media/staging/${encodeURIComponent(batchId)}`),
    // Browser media elements cannot attach our custom auth headers. Always use
    // the same-origin Astro proxy even when JSON requests use an absolute local
    // API URL; this keeps CORP strict and still sends the HttpOnly session.
    stagedMediaPreviewUrl: ({ batchId, leaseId }) => `${sameOriginResourceBase}/media/staging/${encodeURIComponent(batchId)}/${encodeURIComponent(leaseId)}/preview`,
    renewStagedBatch: (batchId) => request(`/media/staging/${encodeURIComponent(batchId)}/renew`, { method: 'POST', body: '{}' }),
    cancelStagedMedia: ({ batchId, leaseId }) => request(`/media/staging/${encodeURIComponent(batchId)}/${encodeURIComponent(leaseId)}`, { method: 'DELETE', body: '{}' }),
    mediaLibrary: ({ page = 1, pageSize = 24, search = '', usage = 'all' } = {}) => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, usage });
      return request(`/media/library?${query}`);
    },
    publishPlan: (transactionIds) => request('/publish/preview-plan', {
      method: 'POST',
      body: JSON.stringify({ target: 'preview', transactionIds, recoveryClientId })
    }),
    publishApply: (planId, { idempotencyKey = crypto.randomUUID() } = {}) => request('/publish/preview-apply', {
      method: 'POST',
      body: JSON.stringify({ target: 'preview', planId, idempotencyKey, recoveryClientId })
    }),
    publishJob: (jobId) => request(`/publish/jobs/${encodeURIComponent(jobId)}`),
    pollPublishJob: (jobId) => request(`/publish/jobs/${encodeURIComponent(jobId)}/poll`, {
      method: 'POST', body: JSON.stringify({ target: 'preview', recoveryClientId })
    }),
    retryPublishJob: (jobId) => request(`/publish/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST', body: JSON.stringify({ target: 'preview', recoveryClientId })
    }),
    publishReport: (jobId) => download(`/publish/jobs/${encodeURIComponent(jobId)}/report`)
  });
}

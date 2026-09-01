import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminApiError, createAdminApiClient } from './api-client.mjs';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('browser client sends the server CSRF header on every authenticated mutation', async () => {
  const calls = [];
  const storageValues = new Map();
  const client = createAdminApiClient({
    baseUrl: '/api/admin',
    storage: {
      getItem: (key) => storageValues.get(key) ?? null,
      setItem: (key, value) => storageValues.set(key, value),
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (String(url).endsWith('/login')) return jsonResponse({ ok: true, csrfToken: 'csrf-exact-token' });
      return jsonResponse({ ok: true, revision: 'sha256:test:1', content: {} });
    },
  });

  await client.login('owner', 'secret-password');
  await client.save('products', 'item', { slug: 'item' }, 'sha256:base:1');
  await client.renewStagedBatch('batch-001');
  await client.logout();

  const loginHeaders = new Headers(calls[0].options.headers);
  const saveHeaders = new Headers(calls[1].options.headers);
  const renewHeaders = new Headers(calls[2].options.headers);
  const logoutHeaders = new Headers(calls[3].options.headers);
  assert.equal(loginHeaders.has('X-Admin-CSRF'), false);
  assert.equal(saveHeaders.get('X-Admin-CSRF'), 'csrf-exact-token');
  assert.equal(renewHeaders.get('X-Admin-CSRF'), 'csrf-exact-token');
  assert.match(String(calls[2].url), /\/media\/staging\/batch-001\/renew$/u);
  assert.equal(logoutHeaders.get('X-Admin-CSRF'), 'csrf-exact-token');
  assert.equal(saveHeaders.has('X-CSRF-Token'), false);
  assert.match(saveHeaders.get('X-Admin-Recovery-Client-Id'), /^browser-/u);
});

test('safe reads retry a bounded transaction lock while mutations never auto-retry', async () => {
  let readCalls = 0;
  let writeCalls = 0;
  const client = createAdminApiClient({
    baseUrl: '/api/admin',
    storage: null,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        readCalls += 1;
        if (readCalls < 3) return jsonResponse({ code: 'TRANSACTION_LOCKED', error: 'busy' }, 423);
        return jsonResponse({ entries: [] });
      }
      writeCalls += 1;
      return jsonResponse({ code: 'TRANSACTION_LOCKED', error: 'busy' }, 423);
    }
  });

  assert.deepEqual(await client.list('products'), { entries: [] });
  assert.equal(readCalls, 3);
  await assert.rejects(
    client.save('products', 'item', { slug: 'item' }, 'sha256:base:1'),
    (error) => error.status === 423 && error.code === 'TRANSACTION_LOCKED'
  );
  assert.equal(writeCalls, 1);
});

test('staged media previews stay on the Astro origin even with an absolute API base', () => {
  const client = createAdminApiClient({
    baseUrl: 'http://127.0.0.1:8787/api/admin',
    storage: null,
    fetchImpl: async () => jsonResponse({})
  });
  assert.equal(
    client.stagedMediaPreviewUrl({ batchId: 'batch-001', leaseId: 'a'.repeat(64) }),
    `/api/admin/media/staging/batch-001/${'a'.repeat(64)}/preview`
  );
});

test('a rejected session clears stale CSRF and fingerprint before a fresh login', async () => {
  const calls = [];
  let loginCount = 0;
  let expiredCount = 0;
  const client = createAdminApiClient({
    baseUrl: '/api/admin',
    storage: null,
    onSessionExpired: () => { expiredCount += 1; },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (String(url).endsWith('/login')) {
        loginCount += 1;
        return jsonResponse({
          ok: true,
          csrfToken: `csrf-${loginCount}`,
          sessionFingerprint: `fingerprint-${loginCount}`
        });
      }
      return jsonResponse({ code: 'SESSION_EXPIRED', error: 'Сессия завершена.' }, 401);
    }
  });

  await client.login('owner', 'first-password');
  await assert.rejects(client.list('products'), (error) => error.status === 401);
  assert.equal(expiredCount, 1);
  assert.equal(client.csrfToken, '');
  await client.login('owner', 'second-password');

  const reloginHeaders = new Headers(calls[2].options.headers);
  assert.equal(reloginHeaders.has('X-Admin-CSRF'), false);
  assert.equal(reloginHeaders.has('X-Admin-Session-Fingerprint'), false);
  assert.equal(client.csrfToken, 'csrf-2');
});

test('offline exports use the same human-readable API error boundary as JSON requests', async () => {
  const client = createAdminApiClient({
    baseUrl: '/api/admin',
    storage: null,
    fetchImpl: async () => { throw new TypeError('synthetic network loss'); }
  });

  await assert.rejects(
    client.exportFullSite(),
    (error) => error instanceof AdminApiError
      && error.code === 'ADMIN_API_OFFLINE'
      && /админка|соединен|скачать/iu.test(error.message)
  );
});

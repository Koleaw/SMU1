import test from 'node:test';
import assert from 'node:assert/strict';
import {
  URL_CONTEXTS,
  assertValidUrl,
  validateMediaPath,
  validateUrl
} from './url-policy.mjs';

test('URL policy accepts normalized internal, hash and HTTPS links', () => {
  assert.deepEqual(validateUrl('/kontakty/'), { ok: true, value: '/kontakty/', kind: 'internal' });
  assert.deepEqual(validateUrl('#contact'), { ok: true, value: '#contact', kind: 'hash' });

  const external = validateUrl('https://example.com/catalog?q=one%20two');
  assert.equal(external.ok, true);
  assert.equal(external.kind, 'https');
  assert.equal(external.hostname, 'example.com');
});

test('mailto and tel are accepted only in contact context', () => {
  assert.equal(validateUrl('mailto:info@example.com', { context: URL_CONTEXTS.CONTACT }).ok, true);
  assert.equal(validateUrl('tel:+79129735006', { context: URL_CONTEXTS.CONTACT }).ok, true);
  assert.equal(validateUrl('mailto:info@example.com').code, 'URL_CONTACT_SCHEME_FORBIDDEN');
  assert.equal(validateUrl('tel:+79129735006', { context: URL_CONTEXTS.INTERNAL }).code, 'URL_CONTACT_SCHEME_FORBIDDEN');
});

test('URL policy rejects executable, local, protocol-relative and encoded bypasses', () => {
  const cases = [
    ['javascript:alert(1)', 'URL_SCHEME_FORBIDDEN'],
    ['JaVaScRiPt:alert(1)', 'URL_SCHEME_FORBIDDEN'],
    ['java%73cript%3Aalert(1)', 'URL_SCHEME_FORBIDDEN'],
    ['%256a%2561%2576%2561%2573%2563%2572%2569%2570%2574%253Aalert(1)', 'URL_SCHEME_FORBIDDEN'],
    ['data:text/html,test', 'URL_SCHEME_FORBIDDEN'],
    ['file:///etc/passwd', 'URL_SCHEME_FORBIDDEN'],
    ['//evil.example/path', 'URL_PROTOCOL_RELATIVE_FORBIDDEN'],
    ['C:\\Windows\\file.txt', 'URL_LOCAL_PATH_FORBIDDEN'],
    ['/safe/%2e%2e/admin', 'URL_PATH_TRAVERSAL'],
    ['/safe\npath', 'URL_CONTROL_CHARACTER'],
    ['/safe/%0d%0apath', 'URL_ENCODED_CONTROL_CHARACTER'],
    [' /kontakty/', 'URL_NOT_NORMALIZED']
  ];

  for (const [value, code] of cases) {
    assert.equal(validateUrl(value).code, code, value);
  }
});

test('URL context and host allowlist are enforced', () => {
  assert.equal(
    validateUrl('https://mc.yandex.ru/metrika/tag.js', {
      context: URL_CONTEXTS.HTTPS,
      allowedHosts: ['mc.yandex.ru']
    }).ok,
    true
  );
  assert.equal(
    validateUrl('https://evil.example/tag.js', {
      context: URL_CONTEXTS.HTTPS,
      allowedHosts: ['mc.yandex.ru']
    }).code,
    'URL_HOST_FORBIDDEN'
  );
  assert.equal(
    validateUrl('https://example.com/', { context: URL_CONTEXTS.INTERNAL }).code,
    'URL_EXTERNAL_FORBIDDEN'
  );
  assert.equal(validateUrl('relative/page').code, 'URL_INTERNAL_ABSOLUTE_PATH_REQUIRED');
});

test('canonical media policy accepts originals and rejects remote/generated/temp paths', () => {
  assert.equal(validateMediaPath('/uploads/project-a.jpg').ok, true);
  assert.equal(validateMediaPath('/assets/images/products/a.webp').ok, true);
  assert.equal(validateMediaPath('').ok, true);

  const rejected = [
    ['https://example.com/a.jpg', 'MEDIA_PATH_NOT_CANONICAL'],
    ['data:image/png;base64,AAAA', 'URL_SCHEME_FORBIDDEN'],
    ['file:///tmp/a.jpg', 'URL_SCHEME_FORBIDDEN'],
    ['/_media/h5/a.avif', 'MEDIA_PATH_GENERATED_FORBIDDEN'],
    ['/uploads/staging/a.jpg', 'MEDIA_PATH_GENERATED_FORBIDDEN'],
    ['/assets/cache/a.jpg', 'MEDIA_PATH_GENERATED_FORBIDDEN'],
    ['/uploads/../a.jpg', 'MEDIA_PATH_NOT_NORMALIZED'],
    ['/uploads/%2e%2e/a.jpg', 'MEDIA_PATH_ENCODED'],
    ['/uploads/a.jpg?size=2', 'MEDIA_PATH_NOT_CANONICAL'],
    ['/other/a.jpg', 'MEDIA_PATH_ROOT_FORBIDDEN']
  ];
  for (const [value, code] of rejected) {
    assert.equal(validateMediaPath(value).code, code, value);
  }
});

test('assertValidUrl exposes a stable safe error without the rejected value', () => {
  assert.throws(
    () => assertValidUrl('javascript:alert(document.cookie)'),
    (error) => error.name === 'UrlPolicyError'
      && error.code === 'URL_SCHEME_FORBIDDEN'
      && !error.message.includes('document.cookie')
  );
});

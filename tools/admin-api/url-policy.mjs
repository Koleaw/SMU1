const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const RAW_WHITESPACE_RE = /\s/u;
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/iu;
const INVALID_PERCENT_RE = /%(?![0-9a-f]{2})/iu;
const ENCODED_OCTET_RE = /%[0-9a-f]{2}/iu;
const WINDOWS_DRIVE_RE = /^[a-z]:[\\/]/iu;
const BLOCKED_SCHEMES = new Set(['javascript', 'data', 'file', 'vbscript', 'blob']);
const DEFAULT_CANONICAL_MEDIA_ROOTS = Object.freeze(['/assets/', '/uploads/']);
const BLOCKED_MEDIA_SEGMENTS = new Set([
  '_media',
  'dist',
  'cache',
  'caches',
  'staging',
  'stage',
  'thumbnails',
  'thumbnail-cache',
  'qa',
  'artifacts'
]);

export const URL_CONTEXTS = Object.freeze({
  LINK: 'link',
  INTERNAL: 'internal',
  CONTACT: 'contact',
  HTTPS: 'https',
  MEDIA: 'media'
});

function result(ok, properties = {}) {
  return Object.freeze({ ok, ...properties });
}

function invalid(code, message, technicalDetail, properties = {}) {
  return result(false, { code, message, technicalDetail, ...properties });
}

function valid(value, kind, properties = {}) {
  return result(true, { value, kind, ...properties });
}

function decodeForInspection(value) {
  let decoded = value;
  for (let pass = 0; pass < 4 && ENCODED_OCTET_RE.test(decoded); pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return { ok: false, value: decoded };
    }
  }
  return { ok: true, value: decoded };
}

function prepareValue(rawValue, { allowEmpty = false } = {}) {
  if (typeof rawValue !== 'string') {
    return invalid(
      'URL_VALUE_NOT_STRING',
      'Ссылка должна быть строкой.',
      `Expected a string, received ${rawValue === null ? 'null' : typeof rawValue}.`
    );
  }

  if (!rawValue) {
    return allowEmpty
      ? valid('', 'empty')
      : invalid('URL_VALUE_EMPTY', 'Укажите ссылку.', 'The URL value is empty.');
  }

  if (rawValue !== rawValue.trim()) {
    return invalid(
      'URL_NOT_NORMALIZED',
      'Уберите пробелы в начале и конце ссылки.',
      'Leading or trailing whitespace is not allowed.'
    );
  }

  if (CONTROL_CHARACTER_RE.test(rawValue)) {
    return invalid(
      'URL_CONTROL_CHARACTER',
      'Ссылка содержит недопустимый служебный символ.',
      'Raw C0/C1 control characters are not allowed.'
    );
  }

  if (INVALID_PERCENT_RE.test(rawValue)) {
    return invalid(
      'URL_INVALID_ENCODING',
      'Ссылка содержит некорректное кодирование.',
      'A percent sign must be followed by exactly two hexadecimal digits.'
    );
  }

  const inspected = decodeForInspection(rawValue);
  if (!inspected.ok) {
    return invalid(
      'URL_INVALID_ENCODING',
      'Ссылка содержит некорректное кодирование.',
      'decodeURIComponent failed while checking encoded bypasses.'
    );
  }

  if (CONTROL_CHARACTER_RE.test(inspected.value)) {
    return invalid(
      'URL_ENCODED_CONTROL_CHARACTER',
      'Ссылка содержит закодированный служебный символ.',
      'The decoded URL contains a C0/C1 control character.'
    );
  }

  const compactInspection = inspected.value.replace(/[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f]/gu, '');
  const decodedScheme = compactInspection.match(SCHEME_RE)?.[1]?.toLowerCase();
  if (decodedScheme && BLOCKED_SCHEMES.has(decodedScheme)) {
    return invalid(
      'URL_SCHEME_FORBIDDEN',
      'Этот тип ссылки запрещён из соображений безопасности.',
      `Forbidden scheme detected after decoding: ${decodedScheme}:`,
      { scheme: decodedScheme }
    );
  }

  return { ok: true, value: rawValue, inspectedValue: inspected.value };
}

function hostnameMatches(hostname, allowedHosts) {
  if (!allowedHosts?.length) return true;
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  return allowedHosts.some((candidate) => {
    const allowed = String(candidate).toLowerCase().replace(/^\./u, '').replace(/\.$/u, '');
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

function validateHttps(value, options) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return invalid('URL_INVALID', 'Проверьте адрес ссылки.', 'The value cannot be parsed as an absolute URL.');
  }

  if (url.protocol !== 'https:') {
    return invalid(
      'URL_HTTPS_REQUIRED',
      'Внешняя ссылка должна начинаться с https://.',
      `Only https: is allowed here; received ${url.protocol || 'no protocol'}.`
    );
  }
  if (!url.hostname) {
    return invalid('URL_HOST_REQUIRED', 'Во внешней ссылке не указан сайт.', 'The HTTPS URL has no hostname.');
  }
  if (url.username || url.password) {
    return invalid(
      'URL_CREDENTIALS_FORBIDDEN',
      'Не указывайте логин или пароль внутри ссылки.',
      'URL userinfo is forbidden.'
    );
  }
  if (!hostnameMatches(url.hostname, options.allowedHosts)) {
    return invalid(
      'URL_HOST_FORBIDDEN',
      'Этот адрес сайта не разрешён для данного поля.',
      `Hostname ${url.hostname} is outside the allowed host list.`,
      { hostname: url.hostname }
    );
  }
  return valid(value, 'https', { hostname: url.hostname.toLowerCase() });
}

function hasDotSegment(value) {
  const pathOnly = value.split(/[?#]/u, 1)[0];
  return pathOnly.split('/').some((segment) => segment === '.' || segment === '..');
}

function validateInternal(value, inspectedValue) {
  if (value.startsWith('//') || inspectedValue.startsWith('//')) {
    return invalid(
      'URL_PROTOCOL_RELATIVE_FORBIDDEN',
      'Ссылка без указания протокола запрещена.',
      'Protocol-relative URLs are not accepted.'
    );
  }
  if (value.includes('\\') || inspectedValue.includes('\\')) {
    return invalid('URL_BACKSLASH_FORBIDDEN', 'Используйте в ссылке символ “/”.', 'Backslashes are forbidden in URL paths.');
  }
  if (RAW_WHITESPACE_RE.test(value)) {
    return invalid('URL_WHITESPACE_FORBIDDEN', 'Замените пробелы в ссылке безопасным кодированием.', 'Raw whitespace is forbidden.');
  }
  if (hasDotSegment(inspectedValue)) {
    return invalid('URL_PATH_TRAVERSAL', 'Ссылка содержит недопустимый переход по пути.', 'Decoded dot path segments are forbidden.');
  }

  if (value.startsWith('#')) {
    if (value.length === 1) {
      return invalid('URL_HASH_EMPTY', 'После # укажите идентификатор секции.', 'A bare hash is not a useful normalized target.');
    }
    return valid(value, 'hash');
  }

  if (!value.startsWith('/')) {
    return invalid(
      'URL_INTERNAL_ABSOLUTE_PATH_REQUIRED',
      'Внутренняя ссылка должна начинаться с “/” или “#”.',
      'Internal routes must be root-relative paths or fragment identifiers.'
    );
  }
  if (value.startsWith('/?') || value.startsWith('/#')) {
    return invalid('URL_INTERNAL_PATH_INVALID', 'Укажите полный внутренний путь.', 'A root path followed only by query/hash is not accepted.');
  }
  return valid(value, 'internal');
}

function validateMailto(value) {
  const address = value.slice('mailto:'.length).split('?', 1)[0];
  if (!/^[^@\s/?#]+@[^@\s/?#]+\.[^@\s/?#]+$/u.test(address)) {
    return invalid('URL_MAILTO_INVALID', 'Проверьте адрес электронной почты.', 'The mailto recipient is not a valid simple email address.');
  }
  return valid(value, 'mailto');
}

function validateTel(value) {
  const number = value.slice('tel:'.length);
  if (!/^\+?[0-9().-]{5,32}$/u.test(number) || !/[0-9]/u.test(number)) {
    return invalid('URL_TEL_INVALID', 'Проверьте номер телефона в ссылке.', 'The tel target contains unsupported characters or length.');
  }
  return valid(value, 'tel');
}

export function validateUrl(rawValue, options = {}) {
  const context = options.context ?? URL_CONTEXTS.LINK;
  const prepared = prepareValue(rawValue, options);
  if (!prepared.ok || prepared.kind === 'empty') return prepared;

  const value = prepared.value;
  const inspectedValue = prepared.inspectedValue;
  if (value.startsWith('//') || inspectedValue.startsWith('//')) {
    return invalid(
      'URL_PROTOCOL_RELATIVE_FORBIDDEN',
      'Ссылка без указания протокола запрещена.',
      'Protocol-relative URLs are not accepted.'
    );
  }
  if (WINDOWS_DRIVE_RE.test(inspectedValue)) {
    return invalid('URL_LOCAL_PATH_FORBIDDEN', 'Локальный путь к файлу здесь использовать нельзя.', 'A Windows drive path was detected.');
  }

  const scheme = inspectedValue.match(SCHEME_RE)?.[1]?.toLowerCase() ?? '';
  if (scheme) {
    if (scheme === 'https') {
      if (context === URL_CONTEXTS.INTERNAL || context === URL_CONTEXTS.MEDIA) {
        return invalid('URL_EXTERNAL_FORBIDDEN', 'Для этого поля нужна внутренняя ссылка.', 'External URLs are forbidden in this context.');
      }
      return validateHttps(value, options);
    }
    if (scheme === 'mailto' || scheme === 'tel') {
      if (context !== URL_CONTEXTS.CONTACT) {
        return invalid(
          'URL_CONTACT_SCHEME_FORBIDDEN',
          'Почтовая или телефонная ссылка разрешена только в контактном поле.',
          `${scheme}: is not allowed in the ${context} context.`,
          { scheme }
        );
      }
      return scheme === 'mailto' ? validateMailto(value) : validateTel(value);
    }
    return invalid(
      'URL_SCHEME_FORBIDDEN',
      'Этот тип ссылки не разрешён.',
      `Scheme ${scheme}: is not in the allowlist for ${context}.`,
      { scheme }
    );
  }

  if (context === URL_CONTEXTS.HTTPS || context === URL_CONTEXTS.CONTACT && !value.startsWith('/') && !value.startsWith('#')) {
    return invalid('URL_HTTPS_REQUIRED', 'Внешняя ссылка должна начинаться с https://.', 'This context requires an HTTPS URL.');
  }
  return validateInternal(value, inspectedValue);
}

function normalizedMediaRoots(roots) {
  return (roots?.length ? roots : DEFAULT_CANONICAL_MEDIA_ROOTS).map((root) => {
    const normalized = String(root).replace(/\\/gu, '/');
    const leading = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return leading.endsWith('/') ? leading : `${leading}/`;
  });
}

export function validateMediaPath(rawValue, options = {}) {
  const prepared = prepareValue(rawValue, { allowEmpty: options.allowEmpty ?? true });
  if (!prepared.ok || prepared.kind === 'empty') return prepared;
  const value = prepared.value;
  const inspectedValue = prepared.inspectedValue;

  if (ENCODED_OCTET_RE.test(value)) {
    return invalid(
      'MEDIA_PATH_ENCODED',
      'Путь к медиафайлу должен быть указан без URL-кодирования.',
      'Canonical media references cannot contain percent-encoded octets.'
    );
  }
  if (value.startsWith('//') || value.includes('\\') || WINDOWS_DRIVE_RE.test(inspectedValue)) {
    return invalid('MEDIA_PATH_NOT_CANONICAL', 'Укажите канонический путь к медиафайлу на сайте.', 'Protocol-relative, drive and backslash paths are forbidden.');
  }
  if (!value.startsWith('/') || value.includes('?') || value.includes('#') || RAW_WHITESPACE_RE.test(value)) {
    return invalid(
      'MEDIA_PATH_NOT_CANONICAL',
      'Укажите канонический путь к медиафайлу на сайте.',
      'A media reference must be a root-relative path without whitespace, query or fragment.'
    );
  }
  if (value.includes('//') || hasDotSegment(inspectedValue)) {
    return invalid('MEDIA_PATH_NOT_NORMALIZED', 'Путь к медиафайлу не нормализован.', 'Repeated slashes and dot segments are forbidden.');
  }

  const lowerSegments = value.toLowerCase().split('/').filter(Boolean);
  const isH5Derivative = lowerSegments[0] === '_media' && lowerSegments[1] === 'h5';
  const blockedSegment = lowerSegments.find((segment) => BLOCKED_MEDIA_SEGMENTS.has(segment));
  if (isH5Derivative || blockedSegment) {
    return invalid(
      'MEDIA_PATH_GENERATED_FORBIDDEN',
      'Нельзя сохранять производный, временный или служебный медиафайл.',
      `Blocked generated/cache/staging segment: ${isH5Derivative ? '_media/h5' : blockedSegment}.`
    );
  }

  const roots = normalizedMediaRoots(options.allowedRoots);
  if (!roots.some((root) => value.startsWith(root) && value.length > root.length)) {
    return invalid(
      'MEDIA_PATH_ROOT_FORBIDDEN',
      'Выберите исходный файл из разрешённой медиатеки.',
      `Canonical media path must be below one of: ${roots.join(', ')}.`,
      { allowedRoots: roots }
    );
  }
  return valid(value, 'media');
}

export function assertValidUrl(rawValue, options = {}) {
  const checked = options.context === URL_CONTEXTS.MEDIA
    ? validateMediaPath(rawValue, options)
    : validateUrl(rawValue, options);
  if (checked.ok) return checked.value;
  const error = new Error(checked.message);
  error.name = 'UrlPolicyError';
  error.code = checked.code;
  error.technicalDetail = checked.technicalDetail;
  throw error;
}

export const MEDIA_PATH_POLICY = Object.freeze({
  allowedRoots: DEFAULT_CANONICAL_MEDIA_ROOTS,
  blockedSegments: Object.freeze([...BLOCKED_MEDIA_SEGMENTS])
});

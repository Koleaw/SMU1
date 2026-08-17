import { createHash } from 'node:crypto';
import path from 'node:path';

export const ADMIN_RUNTIME_HEALTH_KIND = 'smu1-admin-runtime';
export const ADMIN_RUNTIME_HEALTH_VERSION = 1;
export const ADMIN_RUNTIME_SHUTDOWN_TYPE = 'smu1-admin-runtime-shutdown';

const SAFE_NODE_ENV_KEYS = Object.freeze([
  'PATH', 'Path', 'PATHEXT',
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'SystemDrive',
  'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'NO_COLOR', 'FORCE_COLOR', 'TERM'
]);

function exactRepoIdentity(value) {
  const identity = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(identity)) throw new TypeError('Admin repo identity must be a SHA-256 hex digest.');
  return identity;
}

export function createAdminRepoIdentity(repoRoot) {
  const resolved = path.normalize(path.resolve(repoRoot));
  const canonical = process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
  return createHash('sha256').update(`smu1-admin-repo-v1\0${canonical}`, 'utf8').digest('hex');
}

export function createAdminHealthIdentity(service, repoIdentity) {
  const normalizedService = String(service ?? '').trim().toLowerCase();
  if (!['api', 'ui'].includes(normalizedService)) throw new TypeError('Admin health service must be api or ui.');
  return Object.freeze({
    kind: ADMIN_RUNTIME_HEALTH_KIND,
    version: ADMIN_RUNTIME_HEALTH_VERSION,
    service: normalizedService,
    repoIdentity: exactRepoIdentity(repoIdentity)
  });
}

export function createAdminUiHealthMarker(repoIdentity) {
  return `${ADMIN_RUNTIME_HEALTH_KIND}:v${ADMIN_RUNTIME_HEALTH_VERSION}:ui:${exactRepoIdentity(repoIdentity)}`;
}

export function createAdminShutdownMessage(repoIdentity) {
  return Object.freeze({
    type: ADMIN_RUNTIME_SHUTDOWN_TYPE,
    version: ADMIN_RUNTIME_HEALTH_VERSION,
    repoIdentity: exactRepoIdentity(repoIdentity)
  });
}

export function isAdminShutdownMessage(message, repoIdentity) {
  return Boolean(message && typeof message === 'object'
    && message.type === ADMIN_RUNTIME_SHUTDOWN_TYPE
    && message.version === ADMIN_RUNTIME_HEALTH_VERSION
    && message.repoIdentity === exactRepoIdentity(repoIdentity));
}

export function createSafeNodeChildEnvironment(environment = {}) {
  const safe = {};
  for (const key of SAFE_NODE_ENV_KEYS) {
    const value = environment?.[key];
    if (typeof value === 'string' && value.length > 0) safe[key] = value;
  }
  return safe;
}

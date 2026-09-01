import { spawnSync } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';

const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SAFE_CREDENTIAL_ENVIRONMENT_KEYS = Object.freeze([
  'PATH', 'Path', 'PATHEXT',
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'SystemDrive',
  'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'
]);
const GITHUB_TOKEN_PATTERNS = Object.freeze([
  /github_pat_[A-Za-z0-9_]+/gu,
  /gh[pousr]_[A-Za-z0-9_]+/gu,
  /Bearer\s+[A-Za-z0-9._-]+/giu
]);
const READ_PATH_PATTERNS = Object.freeze([
  /^\/actions\/workflows\/deploy\.yml\/runs(?:\?[A-Za-z0-9_=&%+.-]*)?$/u,
  /^\/actions\/runs(?:\?[A-Za-z0-9_=&%+.-]*)?$/u,
  /^\/actions\/runs\/[1-9][0-9]*$/u,
  /^\/actions\/runs\/[1-9][0-9]*\/jobs(?:\?[A-Za-z0-9_=&%+.-]*)?$/u,
  /^\/actions\/jobs\/[1-9][0-9]*\/logs$/u,
  /^\/deployments(?:\?[A-Za-z0-9_=&%+.-]*)?$/u,
  /^\/deployments\/[1-9][0-9]*\/statuses(?:\?[A-Za-z0-9_=&%+.-]*)?$/u
]);
const WRITE_PATH_PATTERNS = Object.freeze([
  /^\/actions\/runs\/[1-9][0-9]*\/(?:rerun-failed-jobs|rerun)$/u
]);

export class GitHubCredentialBrokerError extends Error {
  constructor(code, message, { status = 503 } = {}) {
    super(message);
    this.name = 'GitHubCredentialBrokerError';
    this.code = code;
    this.status = status;
  }
}

function exactRepository(value) {
  const repository = String(value ?? '').trim();
  if (!GITHUB_REPOSITORY_PATTERN.test(repository)
    || repository.split('/').some((part) => part === '.' || part === '..')) {
    throw new GitHubCredentialBrokerError(
      'PUBLISH_GITHUB_REPOSITORY_INVALID',
      'GitHub repository должен иметь безопасный формат owner/repo.',
      { status: 500 }
    );
  }
  return repository;
}

function credentialEnvironment(source = process.env) {
  const safe = {};
  for (const key of SAFE_CREDENTIAL_ENVIRONMENT_KEYS) {
    const value = source?.[key];
    if (typeof value === 'string' && value.length > 0) safe[key] = value;
  }
  safe.GIT_TERMINAL_PROMPT = '0';
  safe.GCM_INTERACTIVE = 'Never';
  return safe;
}

function parsedCredentialOutput(output) {
  const fields = {};
  for (const line of String(output ?? '').split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  if (fields.quit === '1'
    || fields.protocol !== 'https'
    || String(fields.host ?? '').toLowerCase() !== 'github.com'
    || !fields.password) return null;
  return fields.password;
}

function redactGitHubSecret(value, secret = '') {
  let safe = String(value ?? '');
  if (secret) safe = safe.split(secret).join('[secret]');
  for (const pattern of GITHUB_TOKEN_PATTERNS) safe = safe.replace(pattern, '[secret]');
  return safe;
}

function credentialCapability(secret) {
  return Object.freeze({
    source: 'git-credential',
    authorize(headers = {}) {
      return { ...headers, Authorization: `Bearer ${secret}` };
    },
    redact(value) {
      return redactGitHubSecret(value, secret);
    }
  });
}

/**
 * Resolves a GitHub credential through Git's configured OS credential helper.
 * The secret remains inside a non-serializable capability closure.
 */
export function resolveGitHubCredential(options = {}) {
  const repository = exactRepository(options.repository);
  const run = options.spawnSyncImpl ?? spawnSync;
  const timeoutMs = Number(options.timeoutMs ?? 5_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new GitHubCredentialBrokerError(
      'PUBLISH_GITHUB_CREDENTIAL_TIMEOUT_INVALID',
      'Credential broker timeout настроен некорректно.',
      { status: 500 }
    );
  }

  let result;
  try {
    result = run('git', ['credential', 'fill'], {
      cwd: options.workingDirectory ?? os.tmpdir(),
      input: `protocol=https\nhost=github.com\npath=${repository}.git\n\n`,
      encoding: 'utf8',
      env: credentialEnvironment(options.environment),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    });
  } catch {
    return null;
  }
  if (!result || result.error || result.status !== 0) return null;
  const secret = parsedCredentialOutput(result.stdout);
  return secret ? credentialCapability(secret) : null;
}

function allowedRequestPath(method, pathname) {
  const patterns = method === 'GET' ? READ_PATH_PATTERNS : method === 'POST' ? WRITE_PATH_PATTERNS : [];
  return patterns.some((pattern) => pattern.test(pathname));
}

function repositoryParts(value) {
  const repository = typeof value === 'string'
    ? exactRepository(value)
    : exactRepository(`${value?.owner ?? ''}/${value?.repo ?? ''}`);
  const [owner, repo] = repository.split('/');
  return { owner, repo, repository };
}

/** Creates the small, allowlisted GitHub API boundary used by preview status/rerun. */
export function createGitHubApiRequest(options = {}) {
  const getRepository = options.getRepository;
  const broker = options.credentialBroker ?? resolveGitHubCredential;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const environment = options.environment ?? process.env;
  const credentialTtlMs = Number(options.credentialTtlMs ?? 5 * 60_000);
  if (typeof getRepository !== 'function' || typeof broker !== 'function' || typeof fetchImpl !== 'function') {
    throw new TypeError('GitHub API request requires repository, credential broker and fetch providers.');
  }
  if (!Number.isSafeInteger(credentialTtlMs) || credentialTtlMs < 0 || credentialTtlMs > 60 * 60_000) {
    throw new TypeError('credentialTtlMs must be between 0 and 3600000.');
  }

  let cached = null;
  function cachedCredentialFor(repository) {
    const now = Date.now();
    if (cached && cached.repository === repository && cached.expiresAt > now) return cached.capability;
    if (cached) cached = null;
    return null;
  }

  async function credentialFor(repository) {
    const now = Date.now();
    const existing = cachedCredentialFor(repository);
    if (existing) return existing;
    let capability = null;
    try {
      capability = await broker({ repository, environment });
    } catch {
      capability = null;
    }
    if (!capability
      || typeof capability.authorize !== 'function'
      || typeof capability.redact !== 'function') return null;
    if (credentialTtlMs > 0) cached = { repository, capability, expiresAt: now + credentialTtlMs };
    return capability;
  }

  async function perform(url, request, capability) {
    const baseHeaders = {
      Accept: request.accept,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const headers = capability ? capability.authorize(baseHeaders) : baseHeaders;
    return fetchImpl(url, {
      method: request.method,
      headers,
      redirect: 'error',
      ...(request.signal ? { signal: request.signal } : {})
    });
  }

  return async function githubApiRequest(pathname, requestOptions = {}) {
    const method = String(requestOptions.method ?? 'GET').toUpperCase();
    const relativePath = String(pathname ?? '');
    if (!allowedRequestPath(method, relativePath)) {
      throw new GitHubCredentialBrokerError(
        'PUBLISH_GITHUB_PATH_DENIED',
        'GitHub API path не разрешён publish runtime.',
        { status: 500 }
      );
    }
    const { owner, repo, repository } = repositoryParts(await getRepository());
    let capability = method === 'POST' ? await credentialFor(repository) : cachedCredentialFor(repository);
    if (method === 'POST' && !capability) {
      throw new GitHubCredentialBrokerError(
        'PUBLISH_GITHUB_WRITE_CREDENTIAL_REQUIRED',
        'Повторный запуск GitHub Actions заблокирован: войдите в GitHub через системный Git Credential Manager и повторите действие.'
      );
    }

    const requestedAccept = String(requestOptions.headers?.Accept ?? requestOptions.headers?.accept ?? '').trim();
    const accept = requestedAccept === 'text/plain' ? 'text/plain' : 'application/vnd.github+json';
    const url = `https://api.github.com/repos/${owner}/${repo}${relativePath}`;
    let anonymousAttempted = !capability;
    let response = await perform(url, { method, accept, signal: requestOptions.signal }, capability);
    if (method === 'GET' && !capability && response.status === 403) {
      capability = await credentialFor(repository);
      if (capability) response = await perform(url, { method, accept, signal: requestOptions.signal }, capability);
    }
    if (method === 'GET' && capability && !anonymousAttempted && [401, 403].includes(response.status)) {
      cached = null;
      anonymousAttempted = true;
      response = await perform(url, { method, accept, signal: requestOptions.signal }, null);
    }
    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      const detail = capability
        ? capability.redact(responseText || response.statusText)
        : redactGitHubSecret(responseText || response.statusText);
      throw new GitHubCredentialBrokerError(
        'PUBLISH_GITHUB_REQUEST_FAILED',
        `GitHub API ${response.status}: ${detail || 'request failed'}`
      );
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json();
    return response.text();
  };
}

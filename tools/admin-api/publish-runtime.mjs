import { spawn } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  CONTENT_ONLY_GATES,
  classifyPublishPath,
  fingerprintPublishPlan,
  hashPublishBytes,
} from './publish-planner.mjs';
import {
  RELEASE_IDENTITY_RELATIVE_PATH,
  normalizeReleaseIdentityEvidence,
  parseReleaseIdentityBytes,
  readAndVerifyReleaseIdentity,
  releaseIdentityEvidenceMatches,
} from '../release/artifact-identity.mjs';

const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024;
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

const SAFE_ENVIRONMENT_KEYS = new Set([
  'ALL_PROXY',
  'APPDATA',
  'CI',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LOCALAPPDATA',
  'NO_COLOR',
  'NO_PROXY',
  'NUMBER_OF_PROCESSORS',
  'NPM_CONFIG_CACHE',
  'NPM_CONFIG_REGISTRY',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
]);

const SECRET_ENVIRONMENT_KEY = /(?:^|_)(?:AUTH|COOKIE|CREDENTIAL|PASSWORD|PRIVATE|SECRET|SESSION|TOKEN)(?:_|$)/iu;
const TOKEN_PATTERNS = [
  /\bgithub_pat_[A-Za-z0-9_]+\b/gu,
  /\bgh[pousr]_[A-Za-z0-9_]+\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu,
  /(?:_authToken|authorization)\s*=\s*[^\s]+/giu,
];

const COMMANDS = Object.freeze([
  Object.freeze({ id: 'npm-ci', args: ['ci', '--no-audit', '--no-fund'] }),
  Object.freeze({ id: 'admin-tests', args: ['run', 'test:admin-h6:ci'] }),
  Object.freeze({ id: 'admin-browser-roundtrip', args: ['run', 'qa:admin-browser'] }),
  Object.freeze({ id: 'evidence-contract-tests', args: ['run', 'test:h6-evidence-contracts'] }),
  Object.freeze({ id: 'astro-check', args: ['run', 'check'] }),
  Object.freeze({ id: 'build', args: ['run', 'build'] }),
  Object.freeze({ id: 'exact-targeted-build', args: ['run', 'qa:h6:exact-targeted'] }),
  Object.freeze({ id: 'performance-before-deploy', args: ['run', 'qa:performance'] }),
  Object.freeze({ id: 'static-qa', args: ['run', 'qa:final:static'] }),
  Object.freeze({ id: 'deploy-prepare', args: ['run', 'deploy:prepare'] }),
  Object.freeze({ id: 'performance-after-deploy', args: ['run', 'qa:performance'] }),
  Object.freeze({ id: 'browser-motion-isolation', args: ['run', 'qa:final:browser'] }),
  Object.freeze({ id: 'deploy-isolation', args: ['run', 'qa:deploy-isolation'] }),
  Object.freeze({ id: 'route-passport', args: ['run', 'qa:h6:route-passport'] }),
  Object.freeze({ id: 'public-action-crawl', args: ['run', 'qa:h6:public-actions'] }),
  Object.freeze({ id: 'admin-visual-acceptance', args: ['run', 'qa:h6:admin-actions'] }),
  Object.freeze({ id: 'media-privacy', args: ['run', 'qa:h6:media-privacy'] }),
  Object.freeze({ id: 'backup-restore', args: ['run', 'qa:h6:backup-restore'] }),
  Object.freeze({ id: 'evidence-verification', args: ['run', 'qa:h6:verify-evidence'] }),
]);

export class PublishRuntimeError extends Error {
  constructor(code, message, { details, status = 409 } = {}) {
    super(message);
    this.name = 'PublishRuntimeError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertFullSha(value, field = 'testedSha') {
  const normalized = String(value ?? '').toLowerCase();
  if (!FULL_SHA_PATTERN.test(normalized)) {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_SHA_INVALID', `${field} must be a full Git SHA.`, {
      details: { field },
      status: 400,
    });
  }
  return normalized;
}

function sameOrderedSet(left, right) {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === left.length
    && normalizedRight.length === right.length
    && normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((item, index) => item === normalizedRight[index]);
}

function parseNulPaths(value) {
  return String(Buffer.isBuffer(value) ? value.toString('utf8') : value ?? '')
    .split('\0')
    .filter(Boolean)
    .map((item) => item.replaceAll('\\', '/'));
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeBasePath(value) {
  const candidate = String(value ?? '/').trim() || '/';
  if (!candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
    || candidate.includes('?')
    || candidate.includes('#')
    || candidate.split('/').some((part) => part === '.' || part === '..')) {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_BASE_PATH_INVALID', 'BASE_PATH must be a safe absolute URL path.', {
      status: 500,
    });
  }
  if (candidate === '/') return '/';
  return candidate.endsWith('/') ? candidate : `${candidate}/`;
}

function normalizeTestSiteUrl(value) {
  const candidate = String(value ?? '').trim() || 'http://127.0.0.1:4321/';
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_TEST_URL_INVALID', 'TEST_SITE_URL must be an HTTP(S) URL.', {
      status: 500,
    });
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_TEST_URL_INVALID', 'TEST_SITE_URL must be a credential-free HTTP(S) URL.', {
      status: 500,
    });
  }
  return url.toString();
}

function secretValues(environment) {
  return Object.entries(environment ?? {})
    .filter(([key, value]) => SECRET_ENVIRONMENT_KEY.test(key) && String(value ?? '').length >= 4)
    .map(([, value]) => String(value))
    .sort((left, right) => right.length - left.length);
}

function redactText(value, secrets = []) {
  let safe = String(value ?? '');
  for (const secret of secrets) safe = safe.split(secret).join('[secret]');
  for (const pattern of TOKEN_PATTERNS) safe = safe.replace(pattern, '[secret]');
  return safe.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[credentials]@');
}

function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(String(value ?? ''), 'utf8');
  if (bytes.length <= maxBytes) return { text: bytes.toString('utf8'), truncated: false };
  const marker = Buffer.from('[output truncated]\n', 'utf8');
  const room = Math.max(0, maxBytes - marker.length);
  const tail = bytes.subarray(bytes.length - room).toString('utf8').replace(/^\uFFFD/u, '');
  let result = `${marker.toString('utf8')}${tail}`;
  while (Buffer.byteLength(result, 'utf8') > maxBytes) result = result.slice(1);
  return { text: result, truncated: true };
}

function safeOutput(stdout, stderr, secrets, maxOutputBytes, inheritedTruncation = false) {
  const stdoutBudget = Math.max(1, Math.floor(maxOutputBytes / 2));
  const stderrBudget = Math.max(1, maxOutputBytes - stdoutBudget);
  const safeStdout = truncateUtf8(redactText(stdout, secrets), stdoutBudget);
  const safeStderr = truncateUtf8(redactText(stderr, secrets), stderrBudget);
  return Object.freeze({
    stdout: safeStdout.text,
    stderr: safeStderr.text,
    truncated: inheritedTruncation || safeStdout.truncated || safeStderr.truncated,
  });
}

function createTailCollector(maxBytes) {
  let kept = Buffer.alloc(0);
  let totalBytes = 0;
  return Object.freeze({
    append(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.length;
      kept = Buffer.concat([kept, bytes]);
      if (kept.length > maxBytes) kept = kept.subarray(kept.length - maxBytes);
    },
    value() {
      return { bytes: kept, truncated: totalBytes > kept.length };
    },
  });
}

function defaultRunCommand(command, args, { cwd, env, maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    const stdout = createTailCollector(maxOutputBytes);
    const stderr = createTailCollector(maxOutputBytes);
    let child;
    try {
      const isWindowsBatch = process.platform === 'win32' && /\.(?:bat|cmd)$/iu.test(command);
      const executable = isWindowsBatch ? (env.COMSPEC ?? env.ComSpec ?? 'cmd.exe') : command;
      const executableArgs = isWindowsBatch
        ? ['/d', '/s', '/c', [command, ...args].join(' ')]
        : args;
      child = spawn(executable, executableArgs, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.stdout?.on('data', (chunk) => stdout.append(chunk));
    child.stderr?.on('data', (chunk) => stderr.append(chunk));
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      const stdoutResult = stdout.value();
      const stderrResult = stderr.value();
      resolve({
        exitCode,
        signal,
        stdout: stdoutResult.bytes,
        stderr: stderrResult.bytes,
        outputTruncated: stdoutResult.truncated || stderrResult.truncated,
      });
    });
  });
}

function executionEnvironment(source = process.env) {
  const safe = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    const upper = key.toUpperCase();
    if (value === undefined
      || SECRET_ENVIRONMENT_KEY.test(upper)
      || upper === 'NODE_OPTIONS'
      || upper.startsWith('GIT_')) continue;
    if (SAFE_ENVIRONMENT_KEYS.has(upper) || upper.startsWith('LC_')) safe[key] = String(value);
  }

  const repository = String(source?.GITHUB_REPOSITORY ?? '').trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) safe.GITHUB_REPOSITORY = repository;
  const repositoryOwner = String(source?.GITHUB_REPOSITORY_OWNER ?? '').trim();
  if (/^[A-Za-z0-9_.-]+$/u.test(repositoryOwner)) safe.GITHUB_REPOSITORY_OWNER = repositoryOwner;

  safe.CI = 'true';
  safe.DEPLOY_TARGET = 'test';
  safe.PRODUCTION_DEPLOY_ENABLED = 'false';
  safe.REQUIRE_SITE_URL = 'false';
  safe.SITE_URL = '';
  safe.TEST_SITE_URL = normalizeTestSiteUrl(source?.TEST_SITE_URL);
  safe.BASE_PATH = normalizeBasePath(source?.BASE_PATH);
  safe.GITHUB_REF_NAME = 'preview';
  safe.NPM_CONFIG_PRODUCTION = 'false';
  safe.NPM_CONFIG_OMIT = '';
  safe.NO_COLOR = '1';
  safe.FORCE_COLOR = '0';
  return safe;
}

function validatePlan(plan, requestedGates) {
  if (!plan
    || plan.version !== 1
    || plan.target !== 'preview'
    || plan.profile !== 'content-only'
    || !Array.isArray(plan.paths)) {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_PLAN_INVALID', 'A version 1 content-only preview plan is required.');
  }
  if (!sameOrderedSet(requestedGates, CONTENT_ONLY_GATES)
    || !Array.isArray(plan.gates)
    || !sameOrderedSet(plan.gates, CONTENT_ONLY_GATES)) {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_GATES_INVALID', 'The exact content-only gate set is required.');
  }
  const suppliedFingerprint = plan.fingerprint ?? plan.planFingerprint;
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(suppliedFingerprint ?? ''))
    || (plan.fingerprint && plan.planFingerprint && plan.fingerprint !== plan.planFingerprint)
    || fingerprintPublishPlan(plan) !== suppliedFingerprint) {
    throw new PublishRuntimeError('PUBLISH_PLAN_FINGERPRINT_MISMATCH', 'The publish plan fingerprint is invalid.');
  }
  if (new Set(plan.paths.map((item) => item?.path)).size !== plan.paths.length) {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_PLAN_INVALID', 'The publish plan contains duplicate paths.');
  }
  for (const item of plan.paths) {
    const classification = classifyPublishPath(item?.path);
    if (!item
      || !classification.allowed
      || classification.profile !== 'content-only'
      || !['write', 'delete'].includes(item.operation)
      || !/^(?:missing|sha256:[a-f0-9]{64}:[0-9]+)$/u.test(String(item.afterHash ?? ''))
      || (item.operation === 'delete') !== (item.afterHash === 'missing')
      || (item.currentHash !== undefined && item.currentHash !== item.afterHash)) {
      throw new PublishRuntimeError('PUBLISH_RUNTIME_PLAN_INVALID', 'The publish plan contains an invalid content path.', {
        details: { path: String(item?.path ?? '') },
      });
    }
  }
  normalizeSmokeRouteContract(plan.affectedRoutes, plan.routeExpectations);
  return suppliedFingerprint;
}

async function readCheckoutHash(checkoutRoot, realCheckoutRoot, item) {
  const absolute = path.resolve(checkoutRoot, ...item.path.split('/'));
  if (!isInside(checkoutRoot, absolute)) {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_PATH_ESCAPE', 'A publish path escapes the independent checkout.', {
      details: { path: item.path },
    });
  }
  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new PublishRuntimeError('PUBLISH_RUNTIME_PATH_NOT_REGULAR', 'A publish path is not a regular file.', {
        details: { path: item.path },
      });
    }
    const realFile = await realpath(absolute);
    if (!isInside(realCheckoutRoot, realFile)) {
      throw new PublishRuntimeError('PUBLISH_RUNTIME_PATH_ESCAPE', 'A publish path resolves outside the independent checkout.', {
        details: { path: item.path },
      });
    }
    return hashPublishBytes(await readFile(realFile));
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing';
    throw error;
  }
}

function normalizeCommandResult(value) {
  return {
    exitCode: Number.isInteger(value?.exitCode)
      ? value.exitCode
      : Number.isInteger(value?.code) ? value.code : null,
    signal: value?.signal ? String(value.signal) : null,
    stdout: value?.stdout ?? '',
    stderr: value?.stderr ?? '',
    outputTruncated: value?.outputTruncated === true,
  };
}

/**
 * Returns the gateRunner function consumed by createPublishRunner.
 * The runner receives an already independent checkout, then independently
 * re-proves its exact SHA, commit path set, bytes, and plan fingerprint.
 */
export function createContentPublishGateRunner({
  runCommand = defaultRunCommand,
  environment = process.env,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
} = {}) {
  if (typeof runCommand !== 'function') {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_COMMAND_REQUIRED', 'runCommand must be a function.', { status: 500 });
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 1024 * 1024) {
    throw new PublishRuntimeError('PUBLISH_RUNTIME_OUTPUT_LIMIT_INVALID', 'maxOutputBytes must be between 1024 and 1048576.', {
      status: 500,
    });
  }
  const commandEnvironment = executionEnvironment(environment);
  const secrets = secretValues(environment);
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  return async function contentPublishGateRunner({ checkoutDir, testedSha, profile, gates, plan } = {}) {
    const sha = assertFullSha(testedSha);
    if (profile !== 'content-only' || !checkoutDir || typeof checkoutDir !== 'string') {
      throw new PublishRuntimeError('PUBLISH_RUNTIME_INPUT_INVALID', 'An independent content-only checkout is required.');
    }
    const checkoutRoot = path.resolve(checkoutDir);
    let realCheckoutRoot;
    try {
      realCheckoutRoot = await realpath(checkoutRoot);
    } catch {
      throw new PublishRuntimeError('PUBLISH_RUNTIME_CHECKOUT_MISSING', 'The independent checkout is unavailable.');
    }
    const planFingerprint = validatePlan(plan, Array.isArray(gates) ? gates : []);
    const commands = [];

    const runChecked = async (command, args, id) => {
      let raw;
      try {
        raw = await runCommand(command, [...args], {
          cwd: realCheckoutRoot,
          env: { ...commandEnvironment },
          maxOutputBytes,
        });
      } catch (error) {
        throw new PublishRuntimeError('PUBLISH_GATE_COMMAND_ERROR', `Publish gate command could not start: ${id}.`, {
          details: { id, diagnostic: truncateUtf8(redactText(error?.message, secrets), 512).text },
        });
      }
      const normalized = normalizeCommandResult(raw);
      const output = safeOutput(
        normalized.stdout,
        normalized.stderr,
        secrets,
        maxOutputBytes,
        normalized.outputTruncated,
      );
      const evidence = Object.freeze({
        index: commands.length,
        id,
        command: path.basename(command).toLowerCase().startsWith('npm') ? 'npm' : path.basename(command),
        args: Object.freeze([...args]),
        exitCode: normalized.exitCode,
        signal: normalized.signal,
        output,
      });
      commands.push(evidence);
      if (normalized.exitCode !== 0) {
        throw new PublishRuntimeError('PUBLISH_GATE_COMMAND_FAILED', `Publish gate command failed: ${id}.`, {
          details: { id, exitCode: normalized.exitCode, signal: normalized.signal, output },
        });
      }
      return { raw: normalized, evidence };
    };

    const headResult = await runChecked('git', ['rev-parse', 'HEAD'], 'verify-head');
    const actualHead = String(Buffer.isBuffer(headResult.raw.stdout)
      ? headResult.raw.stdout.toString('utf8')
      : headResult.raw.stdout).trim().toLowerCase();
    if (actualHead !== sha) {
      throw new PublishRuntimeError('PUBLISH_GATE_SHA_MISMATCH', 'The independent checkout is not the tested SHA.', {
        details: { expected: sha, actual: FULL_SHA_PATTERN.test(actualHead) ? actualHead : 'invalid' },
      });
    }

    const statusResult = await runChecked(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=no'],
      'verify-clean-checkout',
    );
    const trackedStatus = String(Buffer.isBuffer(statusResult.raw.stdout)
      ? statusResult.raw.stdout.toString('utf8')
      : statusResult.raw.stdout).trim();
    if (trackedStatus) {
      throw new PublishRuntimeError('PUBLISH_GATE_CHECKOUT_DIRTY', 'The independent checkout has tracked modifications.');
    }

    const diffResult = await runChecked(
      'git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', sha],
      'verify-commit-scope',
    );
    const commitPaths = parseNulPaths(diffResult.raw.stdout);
    const planPaths = plan.paths.map((item) => item.path);
    if (!sameOrderedSet(commitPaths, planPaths)) {
      throw new PublishRuntimeError('PUBLISH_GATE_PATH_SET_MISMATCH', 'The tested commit path set differs from the publish plan.', {
        details: { planned: [...planPaths].sort(), actual: [...commitPaths].sort() },
      });
    }

    for (const item of plan.paths) {
      const actualHash = await readCheckoutHash(checkoutRoot, realCheckoutRoot, item);
      if (actualHash !== item.afterHash) {
        throw new PublishRuntimeError('PUBLISH_GATE_PATH_HASH_MISMATCH', 'Tested checkout bytes differ from the publish plan.', {
          details: { path: item.path, expected: item.afterHash, actual: actualHash },
        });
      }
    }

    const commandIndexes = {};
    for (const command of COMMANDS) {
      const executed = await runChecked(npmCommand, command.args, command.id);
      commandIndexes[command.id] = executed.evidence.index;
    }
    const identityCommand = await runChecked(
      process.execPath,
      ['tools/release/artifact-identity.mjs', '--dist', 'dist', '--tested-sha', sha],
      'release-artifact-identity',
    );
    commandIndexes['release-artifact-identity'] = identityCommand.evidence.index;
    let artifactIdentity;
    try {
      artifactIdentity = await readAndVerifyReleaseIdentity({
        distRoot: path.join(realCheckoutRoot, 'dist'),
        expectedTestedCommitSha: sha,
      });
    } catch (error) {
      throw new PublishRuntimeError(
        'PUBLISH_GATE_ARTIFACT_IDENTITY_INVALID',
        'The deterministic release artifact identity is missing or does not match dist.',
        { details: { code: error?.code || 'RELEASE_IDENTITY_FAILED' } },
      );
    }

    const results = {
      'schema-transaction-validation': { ok: true, commandIndexes: [commandIndexes['admin-tests']] },
      'targeted-admin-tests': {
        ok: true,
        commandIndexes: [
          commandIndexes['admin-tests'],
          commandIndexes['admin-browser-roundtrip'],
          commandIndexes['evidence-contract-tests'],
          commandIndexes['static-qa'],
          commandIndexes['route-passport'],
          commandIndexes['public-action-crawl'],
          commandIndexes['admin-visual-acceptance'],
          commandIndexes['media-privacy'],
          commandIndexes['backup-restore'],
          commandIndexes['evidence-verification'],
        ],
      },
      'astro-check': { ok: true, commandIndexes: [commandIndexes['astro-check']] },
      'build-media-prepare': { ok: true, commandIndexes: [commandIndexes.build] },
      'h5-media-budgets': {
        ok: true,
        commandIndexes: [commandIndexes['performance-before-deploy'], commandIndexes['performance-after-deploy']],
      },
      'deploy-isolation': { ok: true, commandIndexes: [commandIndexes['deploy-isolation']] },
      'exact-media-references': {
        ok: true,
        commandIndexes: [commandIndexes['deploy-prepare'], commandIndexes['performance-after-deploy'], commandIndexes['media-privacy']],
      },
      'publish-plan-consistency': {
        ok: true,
        commandIndexes: [headResult.evidence.index, statusResult.evidence.index, diffResult.evidence.index],
        fingerprint: planFingerprint,
        pathCount: plan.paths.length,
      },
      'artifact-byte-identity': {
        ok: true,
        commandIndexes: [commandIndexes['release-artifact-identity']],
        testedCommitSha: artifactIdentity.testedCommitSha,
        artifactManifestSha256: artifactIdentity.artifactManifestSha256,
      },
    };

    return deepFreeze({
      version: 1,
      profile: 'content-only',
      ok: true,
      testedSha: sha,
      planFingerprint,
      artifactIdentity,
      results,
      commands,
    });
  };
}

function normalizePublicUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function latestByTimestampAndId(items) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left?.updated_at ?? left?.created_at ?? '') || 0;
    const rightTime = Date.parse(right?.updated_at ?? right?.created_at ?? '') || 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return Number(right?.id ?? 0) - Number(left?.id ?? 0);
  })[0] ?? null;
}

function workflowStatus(value) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'completed') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'queued';
}

function deploymentStatus(value) {
  const state = String(value ?? '').toLowerCase();
  if (state === 'success') return { status: 'completed', conclusion: 'success' };
  if (['failure', 'error', 'inactive'].includes(state)) {
    return { status: 'completed', conclusion: state === 'inactive' ? 'failure' : state };
  }
  if (state === 'in_progress') return { status: 'in_progress', conclusion: null };
  return { status: 'queued', conclusion: null };
}

function providerEvidenceSha(value) {
  const candidate = value?.sha ?? value?.headSha ?? value?.commitSha ?? value?.testedSha;
  return typeof candidate === 'string' ? candidate.toLowerCase() : null;
}

function assertRetryEvidenceSha(value, testedSha, label) {
  if (!value) return;
  const actual = providerEvidenceSha(value);
  if (actual !== testedSha) {
    throw new PublishRuntimeError('PUBLISH_RETRY_SHA_MISMATCH', `${label} evidence is not for the tested SHA.`, {
      details: { expected: testedSha, actual: FULL_SHA_PATTERN.test(String(actual ?? '')) ? actual : 'invalid' },
    });
  }
}

function retryRunId(value) {
  const candidate = typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new PublishRuntimeError('PUBLISH_RETRY_RUN_ID_INVALID', 'Retry requires a safe GitHub Actions run id.');
  }
  return candidate;
}

function assertAtomicPushEvidence(push, testedSha) {
  if (!push
    || push.status !== 'pushed'
    || push.pushed !== true
    || providerEvidenceSha(push) !== testedSha
    || push.refs?.candidate !== testedSha
    || push.refs?.preview !== testedSha) {
    throw new PublishRuntimeError(
      'PUBLISH_RETRY_PUSH_EVIDENCE_INVALID',
      'Retry requires a proven atomic candidate and preview push for the tested SHA.',
    );
  }
}

function safeRoute(value) {
  const route = String(value ?? '');
  return route.startsWith('/')
    && !route.startsWith('//')
    && !route.includes('\\')
    && !route.includes('?')
    && !route.includes('#')
    && !/[\u0000-\u001F\u007F]/u.test(route)
    && !/%(?:2e|2f|5c)/iu.test(route)
    && !route.split('/').some((part) => part === '.' || part === '..');
}

function normalizeSmokeRouteContract(affectedRoutes, routeExpectations) {
  if (!Array.isArray(affectedRoutes) || !Array.isArray(routeExpectations)
    || affectedRoutes.length === 0 || routeExpectations.length === 0
    || affectedRoutes.length > 500 || routeExpectations.length > 500) {
    throw new PublishRuntimeError(
      'PUBLISH_SMOKE_EXPECTATIONS_REQUIRED',
      'Typed smoke expectations are required for every affected route.',
      { status: 400 },
    );
  }
  const routes = [...new Set(affectedRoutes)];
  if (routes.some((route) => !safeRoute(route))) {
    throw new PublishRuntimeError('PUBLISH_SMOKE_ROUTES_INVALID', 'affectedRoutes contains an unsafe route.', {
      status: 400,
    });
  }
  routes.sort();
  const byRoute = new Map();
  for (const item of routeExpectations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'expected,route'
      || !safeRoute(item.route) || !['html', 'not-found'].includes(item.expected)) {
      throw new PublishRuntimeError(
        'PUBLISH_SMOKE_EXPECTATION_INVALID',
        'routeExpectations contains an invalid typed expectation.',
        { status: 400 },
      );
    }
    const previous = byRoute.get(item.route);
    if (previous && previous !== item.expected) {
      throw new PublishRuntimeError(
        'PUBLISH_SMOKE_EXPECTATION_CONFLICT',
        'The same route has contradictory smoke expectations.',
        { details: { route: item.route, previous, expected: item.expected }, status: 409 },
      );
    }
    byRoute.set(item.route, item.expected);
  }
  const expectationRoutes = [...byRoute.keys()].sort();
  if (routes.length !== expectationRoutes.length
    || routes.some((route, index) => route !== expectationRoutes[index])) {
    throw new PublishRuntimeError(
      'PUBLISH_SMOKE_EXPECTATIONS_MISMATCH',
      'affectedRoutes and routeExpectations must describe the same exact route set.',
      { status: 409 },
    );
  }
  return expectationRoutes.map((route) => ({ route, expected: byRoute.get(route) }));
}

function configuredPagesBase(value) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new PublishRuntimeError('PUBLISH_PAGES_BASE_URL_INVALID', 'testSiteBaseUrl must be an HTTPS URL.', {
      status: 500,
    });
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new PublishRuntimeError('PUBLISH_PAGES_BASE_URL_INVALID', 'testSiteBaseUrl must be a credential-free HTTPS URL.', {
      status: 500,
    });
  }
  url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return url;
}

function isWithinPagesBase(url, base) {
  if (url.origin !== base.origin || url.username || url.password || /%(?:2e|2f|5c)/iu.test(url.pathname)) return false;
  if (base.pathname === '/') return true;
  const withoutSlash = base.pathname.slice(0, -1);
  return url.pathname === withoutSlash || url.pathname.startsWith(base.pathname);
}

function routeUrl(base, route) {
  return route === '/' ? new URL('./', base) : new URL(route.slice(1), base);
}

function validatePreviewBranch(value) {
  const branch = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) || branch.includes('..')) {
    throw new PublishRuntimeError('PUBLISH_PREVIEW_BRANCH_INVALID', 'previewBranch is invalid.', { status: 500 });
  }
  return branch;
}

/**
 * Creates exact-SHA observation providers consumed by publish-status.mjs.
 * githubRequest receives repository-relative REST paths such as
 * /actions/workflows/deploy.yml/runs and /deployments.
 */
export function createGitHubPublishProviders({
  githubRequest,
  previewBranch = 'preview',
  testSiteBaseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
} = {}) {
  if (typeof githubRequest !== 'function') {
    throw new PublishRuntimeError('PUBLISH_GITHUB_REQUEST_REQUIRED', 'githubRequest must be a function.', { status: 500 });
  }
  if (typeof fetchImpl !== 'function') {
    throw new PublishRuntimeError('PUBLISH_FETCH_REQUIRED', 'fetchImpl must be a function.', { status: 500 });
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120_000) {
    throw new PublishRuntimeError('PUBLISH_PROVIDER_TIMEOUT_INVALID', 'timeoutMs must be between 10 and 120000.', {
      status: 500,
    });
  }
  const branch = validatePreviewBranch(previewBranch);
  const pagesBase = configuredPagesBase(testSiteBaseUrl);

  async function timedRequest(operation, { endpoint, timeoutCode, failureCode, label }) {
    const controller = new AbortController();
    let timeout;
    const timeoutPromise = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new PublishRuntimeError(timeoutCode, `${label} timed out.`, {
          details: endpoint ? { endpoint } : undefined,
          status: 503,
        }));
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation(controller.signal), timeoutPromise]);
    } catch (error) {
      if (error?.code === 'PUBLISH_GITHUB_WRITE_CREDENTIAL_REQUIRED') {
        throw new PublishRuntimeError(
          'PUBLISH_GITHUB_WRITE_CREDENTIAL_REQUIRED',
          'Повторный запуск GitHub Actions заблокирован: войдите в GitHub через системный Git Credential Manager и повторите действие.',
          { details: endpoint ? { endpoint } : undefined, status: 503 }
        );
      }
      const timedOut = error instanceof PublishRuntimeError && error.code === timeoutCode;
      throw new PublishRuntimeError(timedOut ? timeoutCode : failureCode, `${label} ${timedOut ? 'timed out' : 'failed'}.`, {
        details: endpoint ? { endpoint } : undefined,
        status: 503,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  const requestGitHub = async (endpoint, method = 'GET') => timedRequest(
    (signal) => githubRequest(endpoint, { method, signal }),
    {
      endpoint,
      timeoutCode: 'PUBLISH_GITHUB_TIMEOUT',
      failureCode: 'PUBLISH_GITHUB_REQUEST_FAILED',
      label: 'GitHub API request',
    },
  );

  async function workflowProvider({ testedSha } = {}) {
    const sha = assertFullSha(testedSha);
    const query = new URLSearchParams({ branch, head_sha: sha, per_page: '100' });
    const endpoint = `/actions/workflows/deploy.yml/runs?${query.toString()}`;
    const data = await requestGitHub(endpoint);
    if (!data || !Array.isArray(data.workflow_runs)) {
      throw new PublishRuntimeError('PUBLISH_GITHUB_RESPONSE_INVALID', 'GitHub workflow response is invalid.', {
        details: { endpoint },
        status: 503,
      });
    }
    const run = latestByTimestampAndId(data.workflow_runs.filter((item) => (
      String(item?.head_sha ?? '').toLowerCase() === sha
      && String(item?.head_branch ?? '') === branch
      && (!item?.path || String(item.path).startsWith('.github/workflows/deploy.yml@'))
    )));
    if (!run) return null;
    const status = workflowStatus(run.status);
    const conclusion = status === 'completed' ? String(run.conclusion ?? 'unknown').toLowerCase() : null;
    return deepFreeze({
      sha,
      status,
      conclusion,
      id: run.id ?? null,
      runAttempt: run.run_attempt ?? null,
      branch,
      event: String(run.event ?? ''),
      url: normalizePublicUrl(run.html_url),
      createdAt: run.created_at ?? null,
      updatedAt: run.updated_at ?? null,
    });
  }

  async function pagesProvider({ testedSha, workflow } = {}) {
    const sha = assertFullSha(testedSha);
    if (workflow && (workflow.sha !== sha || workflow.status !== 'completed' || workflow.conclusion !== 'success')) {
      throw new PublishRuntimeError('PUBLISH_PAGES_WORKFLOW_EVIDENCE_INVALID', 'Pages lookup requires a successful workflow for the tested SHA.');
    }
    const query = new URLSearchParams({ sha, environment: 'github-pages', per_page: '100' });
    const endpoint = `/deployments?${query.toString()}`;
    const deployments = await requestGitHub(endpoint);
    if (!Array.isArray(deployments)) {
      throw new PublishRuntimeError('PUBLISH_GITHUB_RESPONSE_INVALID', 'GitHub deployments response is invalid.', {
        details: { endpoint },
        status: 503,
      });
    }
    const deployment = latestByTimestampAndId(deployments.filter((item) => (
      String(item?.sha ?? '').toLowerCase() === sha
      && String(item?.environment ?? '') === 'github-pages'
    )));
    if (!deployment) return null;
    if (!Number.isSafeInteger(Number(deployment.id)) || Number(deployment.id) <= 0) {
      throw new PublishRuntimeError('PUBLISH_GITHUB_RESPONSE_INVALID', 'GitHub deployment identity is invalid.', {
        details: { endpoint },
        status: 503,
      });
    }
    const statusesEndpoint = `/deployments/${encodeURIComponent(deployment.id)}/statuses?per_page=100`;
    const statuses = await requestGitHub(statusesEndpoint);
    if (!Array.isArray(statuses)) {
      throw new PublishRuntimeError('PUBLISH_GITHUB_RESPONSE_INVALID', 'GitHub deployment statuses response is invalid.', {
        details: { endpoint: statusesEndpoint },
        status: 503,
      });
    }
    const latestStatus = latestByTimestampAndId(statuses);
    const normalized = deploymentStatus(latestStatus?.state);
    return deepFreeze({
      sha,
      status: normalized.status,
      conclusion: normalized.conclusion,
      deploymentId: Number(deployment.id),
      deploymentStatusId: latestStatus?.id ?? null,
      environment: 'github-pages',
      ref: deployment.ref ?? null,
      url: normalizePublicUrl(latestStatus?.environment_url)
        ?? normalizePublicUrl(latestStatus?.target_url)
        ?? normalizePublicUrl(latestStatus?.log_url),
      createdAt: deployment.created_at ?? null,
      updatedAt: latestStatus?.updated_at ?? latestStatus?.created_at ?? deployment.updated_at ?? null,
    });
  }

  async function retryProvider({ testedSha, statusRecord, evidence } = {}) {
    const sha = assertFullSha(testedSha);
    if (statusRecord?.testedSha !== undefined && statusRecord.testedSha !== null) {
      const statusSha = assertFullSha(statusRecord.testedSha, 'statusRecord.testedSha');
      if (statusSha !== sha) {
        throw new PublishRuntimeError('PUBLISH_RETRY_SHA_MISMATCH', 'Retry status is not for the tested SHA.', {
          details: { expected: sha, actual: statusSha },
        });
      }
    }
    const observations = evidence ?? statusRecord?.evidence ?? {};
    if (!observations || typeof observations !== 'object' || Array.isArray(observations)) {
      throw new PublishRuntimeError('PUBLISH_RETRY_EVIDENCE_INVALID', 'Retry evidence must be an object.');
    }
    assertAtomicPushEvidence(observations.push, sha);

    const workflow = observations.workflow ?? observations.workflowObservation ?? null;
    const pages = observations.pages ?? observations.pagesObservation ?? null;
    const smoke = observations.smoke ?? null;
    assertRetryEvidenceSha(workflow, sha, 'Workflow');
    assertRetryEvidenceSha(pages, sha, 'Pages');
    assertRetryEvidenceSha(smoke, sha, 'Smoke');

    if (workflow?.status === 'completed' && workflow.conclusion !== 'success') {
      const runId = retryRunId(workflow.id);
      const endpoint = `/actions/runs/${runId}/rerun-failed-jobs`;
      await requestGitHub(endpoint, 'POST');
      return deepFreeze({
        version: 1,
        action: 'workflow-rerun-failed-jobs',
        requested: true,
        repollOnly: false,
        testedSha: sha,
        runId,
      });
    }

    if (pages?.status === 'completed' && pages.conclusion !== 'success') {
      if (!workflow || workflow.status !== 'completed' || workflow.conclusion !== 'success') {
        throw new PublishRuntimeError(
          'PUBLISH_RETRY_WORKFLOW_EVIDENCE_INVALID',
          'Pages retry requires a successful exact-SHA workflow.',
        );
      }
      const runId = retryRunId(workflow.id);
      const endpoint = `/actions/runs/${runId}/rerun`;
      await requestGitHub(endpoint, 'POST');
      return deepFreeze({
        version: 1,
        action: 'pages-rerun',
        requested: true,
        repollOnly: false,
        testedSha: sha,
        runId,
      });
    }

    return deepFreeze({
      version: 1,
      action: 'repoll',
      requested: false,
      repollOnly: true,
      testedSha: sha,
      reason: smoke?.ok === false ? 'smoke-failure' : 'transient-observation',
    });
  }

  async function fetchPage(url) {
    return timedRequest(
      (signal) => fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9' },
      }),
      {
        timeoutCode: 'PUBLISH_SMOKE_TIMEOUT',
        failureCode: 'PUBLISH_SMOKE_NETWORK_ERROR',
        label: 'Pages smoke request',
      },
    );
  }

  async function fetchIdentityMarker(url) {
    return timedRequest(
      (signal) => fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      }),
      {
        timeoutCode: 'PUBLISH_SMOKE_IDENTITY_TIMEOUT',
        failureCode: 'PUBLISH_SMOKE_IDENTITY_NETWORK_ERROR',
        label: 'Pages release identity request',
      },
    );
  }

  async function inspectArtifactIdentity(testedSha, localEvidence) {
    let expected;
    try {
      expected = normalizeReleaseIdentityEvidence(localEvidence, { expectedTestedCommitSha: testedSha });
    } catch (error) {
      return { ok: false, code: 'PUBLISH_SMOKE_LOCAL_IDENTITY_INVALID', detailCode: error?.code || null };
    }
    let currentUrl = routeUrl(pagesBase, `/${RELEASE_IDENTITY_RELATIVE_PATH}`);
    currentUrl.searchParams.set('release', testedSha);
    const redirects = [];
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      let response;
      try {
        response = await fetchIdentityMarker(currentUrl);
      } catch (error) {
        return {
          ok: false,
          code: error?.code === 'PUBLISH_SMOKE_IDENTITY_TIMEOUT' ? error.code : 'PUBLISH_SMOKE_IDENTITY_NETWORK_ERROR',
          redirects,
        };
      }
      const status = Number(response?.status ?? 0);
      if (status >= 300 && status < 400) {
        const location = response?.headers?.get?.('location');
        await response?.body?.cancel?.().catch(() => {});
        if (!location) return { ok: false, code: 'PUBLISH_SMOKE_IDENTITY_REDIRECT_INVALID', status, redirects };
        let nextUrl;
        try { nextUrl = new URL(location, currentUrl); } catch {
          return { ok: false, code: 'PUBLISH_SMOKE_IDENTITY_REDIRECT_INVALID', status, redirects };
        }
        if (!isWithinPagesBase(nextUrl, pagesBase)) {
          return { ok: false, code: 'PUBLISH_SMOKE_IDENTITY_REDIRECT_UNSAFE', status, redirects };
        }
        if (!nextUrl.search) nextUrl.searchParams.set('release', testedSha);
        redirects.push(nextUrl.pathname);
        currentUrl = nextUrl;
        continue;
      }
      const contentType = String(response?.headers?.get?.('content-type') ?? '').toLowerCase().split(';')[0].trim();
      const declaredLength = Number(response?.headers?.get?.('content-length') || 0);
      if (status !== 200 || contentType !== 'application/json'
        || (Number.isFinite(declaredLength) && declaredLength > 64 * 1024)) {
        await response?.body?.cancel?.().catch(() => {});
        return { ok: false, code: 'PUBLISH_SMOKE_IDENTITY_RESPONSE_INVALID', status, contentType, redirects };
      }
      let bytes;
      try {
        bytes = Buffer.from(await response.arrayBuffer());
      } catch {
        return { ok: false, code: 'PUBLISH_SMOKE_IDENTITY_NETWORK_ERROR', status, redirects };
      }
      let observed;
      try {
        observed = parseReleaseIdentityBytes(bytes, { expectedTestedCommitSha: testedSha });
      } catch (error) {
        return {
          ok: false,
          code: error?.code === 'RELEASE_IDENTITY_SHA_MISMATCH'
            ? 'PUBLISH_SMOKE_IDENTITY_STALE'
            : 'PUBLISH_SMOKE_IDENTITY_INVALID',
          detailCode: error?.code || null,
          status,
          redirects,
        };
      }
      if (!releaseIdentityEvidenceMatches(expected, observed, { expectedTestedCommitSha: testedSha })) {
        return {
          ok: false,
          code: 'PUBLISH_SMOKE_IDENTITY_MANIFEST_MISMATCH',
          status,
          redirects,
          observed,
        };
      }
      return { ok: true, status, redirects, observed };
    }
    return { ok: false, code: 'PUBLISH_SMOKE_IDENTITY_TOO_MANY_REDIRECTS', redirects };
  }

  async function inspectRoute(route, expected) {
    if (!safeRoute(route)) return { route, ok: false, code: 'PUBLISH_SMOKE_ROUTE_INVALID' };
    let currentUrl = routeUrl(pagesBase, route);
    const redirects = [];
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      let response;
      try {
        response = await fetchPage(currentUrl);
      } catch (error) {
        return {
          route,
          ok: false,
          code: error?.code === 'PUBLISH_SMOKE_TIMEOUT' ? error.code : 'PUBLISH_SMOKE_NETWORK_ERROR',
          redirects,
        };
      }
      const status = Number(response?.status ?? 0);
      if (status >= 300 && status < 400) {
        const location = response?.headers?.get?.('location');
        await response?.body?.cancel?.().catch(() => {});
        if (!location) return { route, ok: false, code: 'PUBLISH_SMOKE_REDIRECT_INVALID', status, redirects };
        let nextUrl;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return { route, ok: false, code: 'PUBLISH_SMOKE_REDIRECT_INVALID', status, redirects };
        }
        if (!isWithinPagesBase(nextUrl, pagesBase)) {
          return { route, ok: false, code: 'PUBLISH_SMOKE_REDIRECT_UNSAFE', status, redirects };
        }
        redirects.push(nextUrl.pathname);
        currentUrl = nextUrl;
        continue;
      }

      const contentType = String(response?.headers?.get?.('content-type') ?? '').toLowerCase();
      const mediaType = contentType.split(';')[0].trim();
      const isHtml = mediaType === 'text/html' || mediaType === 'application/xhtml+xml';
      await response?.body?.cancel?.().catch(() => {});
      if (status === 404 && isHtml) {
        return expected === 'not-found'
          ? { route, expected, ok: true, status, outcome: 'intentional-not-found', redirects }
          : { route, expected, ok: false, status, code: 'PUBLISH_SMOKE_UNEXPECTED_NOT_FOUND', redirects };
      }
      if (status >= 200 && status < 300 && isHtml) {
        return expected === 'html'
          ? { route, expected, ok: true, status, outcome: 'html', redirects }
          : { route, expected, ok: false, status, code: 'PUBLISH_SMOKE_UNEXPECTED_HTML', redirects };
      }
      return {
        route,
        expected,
        ok: false,
        code: status >= 500 ? 'PUBLISH_SMOKE_SERVER_ERROR' : 'PUBLISH_SMOKE_RESPONSE_INVALID',
        status,
        contentType: mediaType,
        redirects,
      };
    }
    return { route, ok: false, code: 'PUBLISH_SMOKE_TOO_MANY_REDIRECTS', redirects };
  }

  async function smokeRunner({ testedSha, affectedRoutes, routeExpectations, pages, artifactIdentity } = {}) {
    const sha = assertFullSha(testedSha);
    if (!pages
      || pages.sha !== sha
      || pages.status !== 'completed'
      || pages.conclusion !== 'success') {
      throw new PublishRuntimeError('PUBLISH_SMOKE_PAGES_EVIDENCE_INVALID', 'Smoke requires a successful Pages deployment for the tested SHA.');
    }
    const expectations = normalizeSmokeRouteContract(affectedRoutes, routeExpectations);
    const routes = expectations.map((item) => item.route);
    const checks = [];
    const artifactIdentityCheck = await inspectArtifactIdentity(sha, artifactIdentity);
    for (const expectation of expectations) {
      const check = await inspectRoute(expectation.route, expectation.expected);
      checks.push(check.expected ? check : { ...check, expected: expectation.expected });
    }
    const failures = checks.filter((item) => item.ok !== true).map((item) => ({ ...item }));
    if (!artifactIdentityCheck.ok) {
      failures.unshift({
        route: `/${RELEASE_IDENTITY_RELATIVE_PATH}`,
        expected: 'release-identity',
        ...artifactIdentityCheck,
      });
    }
    return deepFreeze({
      sha,
      ok: failures.length === 0,
      baseUrl: pagesBase.toString(),
      checkedRoutes: [...routes],
      routeExpectations: expectations.map((item) => ({ ...item })),
      checks,
      failures,
      artifactIdentity: artifactIdentityCheck.observed || null,
      byteIdentityVerified: artifactIdentityCheck.ok === true,
      identityVerified: artifactIdentityCheck.ok === true,
    });
  }

  return Object.freeze({ workflowProvider, pagesProvider, smokeRunner, retryProvider });
}

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createContentJsonService } from './content-json.mjs';
import { MISSING_REVISION } from './content-store.mjs';
import { createContentTransactionService, ContentTransactionError } from './transaction-service.mjs';
import { revisionForBytes } from './transaction-engine.mjs';
import { createMediaStagingService } from './media-staging.mjs';
import { createMediaLibraryService } from './media-library.mjs';
import { createLocalPreviewService } from './local-preview.mjs';
import { createPublishService } from './publish-service.mjs';
import { createContentPublishGateRunner, createGitHubPublishProviders } from './publish-runtime.mjs';
import { createPublishGitEnvironment, runGitProcess } from './publish-planner.mjs';
import { createWriterLease } from './writer-lease.mjs';
import { createWorktreeMutationGuard } from './worktree-guard.mjs';
import {
  createAdminHealthIdentity,
  createAdminRepoIdentity,
  isAdminShutdownMessage
} from './runtime-identity.mjs';
import { loadAdminConfig, assertSecureOperation } from './config.mjs';
import {
  assertValidContentRecord,
  assertValidSingleton
} from './content-validation.mjs';
import {
  ADMIN_SESSION_COOKIE,
  LoginLimiter,
  MUTATING_METHODS,
  SessionStore,
  apiSecurityHeaders,
  applyHeaders,
  assertCsrf,
  buildSessionCookie,
  clearSessionCookie as clearSessionCookieHeader,
  createLocalRequestPolicy,
  loginLimiterKey,
  parseCookies as parseSecureCookies,
  timingSafeEqualText,
  verifyCredentials
} from './security.mjs';
import {
  buildProductImportPayload,
  validateProductContentForWrite
} from './product-presentation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const adminRepoIdentity = createAdminRepoIdentity(repoRoot);
const adminApiHealthIdentity = createAdminHealthIdentity('api', adminRepoIdentity);
const contentRoot = process.env.ADMIN_TEST_CONTENT_ROOT
  ? path.resolve(process.env.ADMIN_TEST_CONTENT_ROOT)
  : path.join(repoRoot, 'src', 'content');
const transactionRepoRoot = process.env.ADMIN_TEST_CONTENT_ROOT ? contentRoot : repoRoot;
const execFileAsync = promisify(execFile);

const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROUTE_SLUG_COLLECTIONS = new Set(['static-pages', 'product-sections', 'services']);
const LOCKED_STATIC_PAGE_SLUGS = new Set(['home', 'custom-order', 'vypolnennye-obekty']);
const RESERVED_TOP_LEVEL_SLUGS = new Set(['admin', 'izgotovlenie-na-zakaz', '404']);
const COLLECTIONS = {
  'product-sections': {
    label: 'Страницы каталога',
    type: 'directory',
    path: path.join(contentRoot, 'product-sections')
  },
  services: {
    label: 'Проектные страницы',
    type: 'directory',
    path: path.join(contentRoot, 'services')
  },
  'product-categories': {
    label: 'Подстраницы каталога',
    type: 'directory',
    path: path.join(contentRoot, 'product-categories')
  },
  products: {
    label: 'Товары каталога',
    type: 'directory',
    path: path.join(contentRoot, 'products')
  },
  projects: {
    label: 'Выполненные объекты',
    type: 'directory',
    path: path.join(contentRoot, 'projects')
  },
  jobs: {
    label: 'Вакансии',
    type: 'directory',
    path: path.join(contentRoot, 'jobs')
  },
  'site-settings': {
    label: 'Настройки сайта',
    type: 'single-file',
    path: path.join(contentRoot, 'site-settings', 'global.json'),
    slug: 'global'
  },
  'static-pages': {
    label: 'Страницы',
    type: 'directory',
    path: path.join(contentRoot, 'static-pages')
  }
};

const DATA_SINGLETONS = {
  navigation: { path: path.join(repoRoot, 'src/data/navigation.json') },
  yandex: { path: path.join(repoRoot, 'src/data/yandex.json') }
};
const TRANSACTION_SINGLETONS = process.env.ADMIN_TEST_CONTENT_ROOT
  ? {
      navigation: { path: path.join(contentRoot, '.admin-data', 'navigation.json') },
      yandex: { path: path.join(contentRoot, '.admin-data', 'yandex.json') }
    }
  : DATA_SINGLETONS;

const NAVIGATION_PATH = path.join(repoRoot, 'src', 'data', 'navigation.json');
const MAX_VIDEO_UPLOAD_SIZE = 90 * 1024 * 1024;
const MAX_UPLOAD_SIZE = MAX_VIDEO_UPLOAD_SIZE;
const DEPLOY_TARGETS = new Set(['test', 'production']);
const MAX_JSON_IMPORT_BODY_SIZE = 12 * 1024 * 1024;
const API_CAPABILITIES = { contentJson: 1, contentBundles: 1, transactions: 1, mediaStaging: 1, publish: 1 };
const CONTENT_SCHEMA_VERSION = 'h6-content-v1';
const REPORT_LOG_LINES = 200;
const DEFAULT_PREVIEW_BRANCH = 'preview';
const DEFAULT_PRODUCTION_BRANCH = 'main';
const PUBLISH_REFS = Object.freeze({
  candidate: 'v4-product-final-candidate',
  preview: 'preview',
  protected: 'main'
});

function formatUploadLimit(bytes) {
  return Math.round(bytes / (1024 * 1024));
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendPrettyJson(res, statusCode, payload, filename) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.end(JSON.stringify(payload, null, 2));
}

async function runGit(args) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: repoRoot,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const message = [
      error?.message,
      error?.stdout?.trim(),
      error?.stderr?.trim()
    ].filter(Boolean).join('\n');
    throw new Error(message || 'Git command failed');
  }
}

function normalizeDeployTarget(value) {
  const target = String(value || 'test').trim().toLowerCase();
  return DEPLOY_TARGETS.has(target) ? target : 'test';
}

function safeBranchName(value, fallback) {
  const branch = String(value || fallback || '').trim().replace(/^refs\/heads\//, '');
  if (!branch || branch.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error(`Некорректное имя ветки публикации: ${branch || '(пусто)'}`);
  }
  return branch;
}

function branchKey(value) {
  return String(value || '').trim().replace(/^refs\/heads\//, '').toLowerCase();
}

function isProductionDeployEnabled() {
  return false;
}

function isSiteUrlConfigured() {
  return Boolean(String(config?.SITE_URL || '').trim());
}

function getPublishConfigPayload() {
  const productionDeployEnabled = isProductionDeployEnabled();
  const siteUrlConfigured = isSiteUrlConfigured();
  return {
    productionDeployEnabled,
    siteUrlConfigured,
    productionReady: productionDeployEnabled && siteUrlConfigured,
    previewBranch: PUBLISH_REFS.preview,
    productionBranch: PUBLISH_REFS.protected
  };
}

function isProductionBranch(branch, productionBranch = config?.ADMIN_PRODUCTION_BRANCH) {
  const key = branchKey(branch);
  const productionKey = branchKey(productionBranch || DEFAULT_PRODUCTION_BRANCH);
  return key === productionKey || key === 'main' || key === 'master';
}

function isTestBranch(branch) {
  const key = branchKey(branch);
  const previewKey = branchKey(config?.ADMIN_PREVIEW_BRANCH || DEFAULT_PREVIEW_BRANCH);
  return key === previewKey || key === 'preview' || key === 'develop';
}

function inferWorkflowDeployMeta(event, branch, requestedTarget = 'test') {
  const workflowEvent = String(event || '').trim();
  const target = normalizeDeployTarget(requestedTarget);
  const productionDeployEnabled = isProductionDeployEnabled();
  const siteUrlConfigured = isSiteUrlConfigured();

  if (workflowEvent === 'workflow_dispatch') {
    if (target === 'production') {
      if (productionDeployEnabled) {
        return {
          workflowDeployTarget: 'production',
          productionCheckRan: true,
          workflowDeployReason: 'workflow_dispatch requested production and PRODUCTION_DEPLOY_ENABLED=true.',
          productionDeployEnabled,
          siteUrlConfigured
        };
      }
      return {
        workflowDeployTarget: 'test',
        productionCheckRan: false,
        workflowDeployReason: 'workflow_dispatch requested production, but production deploy is disabled.',
        productionDeployEnabled,
        siteUrlConfigured
      };
    }
    return {
      workflowDeployTarget: 'test',
      productionCheckRan: false,
      workflowDeployReason: 'workflow_dispatch requested test.',
      productionDeployEnabled,
      siteUrlConfigured
    };
  }

  if (isTestBranch(branch)) {
    return {
      workflowDeployTarget: 'test',
      productionCheckRan: false,
      workflowDeployReason: 'preview/develop branches always use test deployment.',
      productionDeployEnabled,
      siteUrlConfigured
    };
  }

  if (isProductionBranch(branch)) {
    if (productionDeployEnabled) {
      return {
        workflowDeployTarget: 'production',
        productionCheckRan: true,
        workflowDeployReason: 'main/master with PRODUCTION_DEPLOY_ENABLED=true.',
        productionDeployEnabled,
        siteUrlConfigured
      };
    }
    return {
      workflowDeployTarget: 'test',
      productionCheckRan: false,
      workflowDeployReason: 'main/master with production deploy disabled; running test build only.',
      productionDeployEnabled,
      siteUrlConfigured
    };
  }

  return {
    workflowDeployTarget: 'test',
    productionCheckRan: false,
    workflowDeployReason: 'Non-deploy branch; running test build only.',
    productionDeployEnabled,
    siteUrlConfigured
  };
}

function getPublishBranch(target) {
  const productionBranch = safeBranchName(config.ADMIN_PRODUCTION_BRANCH, DEFAULT_PRODUCTION_BRANCH);
  if (target === 'production') return productionBranch;

  const previewBranch = safeBranchName(config.ADMIN_PREVIEW_BRANCH, DEFAULT_PREVIEW_BRANCH);
  return isProductionBranch(previewBranch, productionBranch) ? DEFAULT_PREVIEW_BRANCH : previewBranch;
}

function assertProductionReady() {
  const error = new Error('Публикация в production запрещена политикой H6. Доступна только тестовая preview-ветка; main не изменяется.');
  error.code = 'PRODUCTION_PUBLISH_FORBIDDEN';
  error.status = 403;
  error.productionDeployEnabled = false;
  error.siteUrlConfigured = isSiteUrlConfigured();
  throw error;
}

function parseGitHubRemote(value = '') {
  const remote = String(value).trim();
  const httpsMatch = remote.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/iu);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = remote.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/iu);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}

async function getGitHubRepository() {
  const configured = String(config.GITHUB_REPOSITORY || '').trim();
  const configuredMatch = configured.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/u);
  if (configuredMatch) return { owner: configuredMatch[1], repo: configuredMatch[2] };

  const remoteName = publishRemoteName();
  const remote = (await runGit(['config', '--get', `remote.${remoteName}.url`]).catch(() => ({ stdout: '' }))).stdout;
  return parseGitHubRemote(remote);
}

function getGitHubToken() {
  return String(config.GITHUB_DEPLOY_TOKEN || config.GITHUB_TOKEN || '').trim();
}

function maskSecrets(text = '') {
  let safe = String(text || '');
  const secretValues = Object.entries(config)
    .filter(([key, value]) => /(TOKEN|SECRET|PASSWORD|KEY)/i.test(key) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value)
    .filter(Boolean);

  for (const secret of secretValues) {
    safe = safe.split(secret).join('[secret]');
  }

  return safe
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[github-token]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[github-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [secret]');
}

async function githubRequest(pathname, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const relativePath = String(pathname || '');
  const allowedReadPath = /^\/actions\/workflows\/deploy\.yml\/runs(?:\?|$)/u.test(relativePath)
    || /^\/deployments(?:\?|$)/u.test(relativePath)
    || /^\/deployments\/[1-9][0-9]*\/statuses(?:\?|$)/u.test(relativePath);
  const allowedWritePath = /^\/actions\/runs\/[1-9][0-9]*\/(?:rerun-failed-jobs|rerun)$/u.test(relativePath);
  if (!((method === 'GET' && allowedReadPath) || (method === 'POST' && allowedWritePath))
    || relativePath.includes('\\')
    || /[\u0000-\u001F\u007F]/u.test(relativePath)) {
    throw publishApiError('PUBLISH_GITHUB_PATH_DENIED', 'GitHub API path не разрешён publish runtime.', 500);
  }
  const token = getGitHubToken();
  if (method === 'POST' && !token) {
    throw publishApiError(
      'PUBLISH_GITHUB_WRITE_TOKEN_REQUIRED',
      'Для повторного запуска GitHub Actions нужен локально настроенный GitHub token.',
      503
    );
  }
  const repository = await getGitHubRepository();
  if (!repository) {
    throw new Error('Не удалось определить GitHub repository. Укажите GITHUB_REPOSITORY=owner/repo.');
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}${relativePath}`, {
    method,
    headers,
    redirect: 'error',
    ...(options.signal ? { signal: options.signal } : {})
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(maskSecrets(`GitHub API ${response.status}: ${text || response.statusText}`));
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

async function buildGitHubPublicationInfo(branch, commitSha, target = 'test') {
  const repository = await getGitHubRepository();
  const commitUrl = repository
    ? `https://github.com/${repository.owner}/${repository.repo}/commit/${commitSha}`
    : '';
  const run = await findWorkflowRun({ branch, commitSha }).catch(() => null);
  const workflowEvent = run?.event || '';
  const workflowBranch = run?.head_branch || branch;
  const workflowMeta = inferWorkflowDeployMeta(workflowEvent, workflowBranch, target);
  return {
    commitUrl,
    workflowRunId: run?.id ?? null,
    workflowRunUrl: run?.html_url ?? '',
    workflowEvent,
    workflowBranch,
    ...workflowMeta,
    status: normalizeRunStatus(run)
  };
}

async function findWorkflowRun({ branch, commitSha, runId }) {
  if (runId) {
    return githubRequest(`/actions/runs/${encodeURIComponent(runId)}`);
  }

  const params = new URLSearchParams({ per_page: '20' });
  if (branch) params.set('branch', branch);
  if (commitSha) params.set('head_sha', commitSha);
  const data = await githubRequest(`/actions/runs?${params.toString()}`);
  return Array.isArray(data?.workflow_runs) ? data.workflow_runs[0] || null : null;
}

function normalizeRunStatus(run) {
  if (!run) return 'queued';
  if (run.status === 'completed') return run.conclusion === 'success' ? 'success' : 'failure';
  if (run.status === 'in_progress') return 'in_progress';
  return run.status || 'queued';
}

function lastLogLines(text = '', limit = REPORT_LOG_LINES) {
  return maskSecrets(String(text || '').split(/\r?\n/).slice(-limit).join('\n'));
}

async function fetchRunFailureDetails(runId) {
  if (!runId) return {};
  const jobsData = await githubRequest(`/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`).catch(() => null);
  const jobs = Array.isArray(jobsData?.jobs) ? jobsData.jobs : [];
  const failedJob = jobs.find((job) => job.conclusion && !['success', 'skipped'].includes(job.conclusion))
    || jobs.find((job) => job.status && job.status !== 'completed')
    || null;
  const failedStep = failedJob?.steps?.find((step) => step.conclusion && !['success', 'skipped'].includes(step.conclusion)) || null;

  let logTail = '';
  if (failedJob?.id) {
    const logs = await githubRequest(`/actions/jobs/${encodeURIComponent(failedJob.id)}/logs`, {
      headers: { Accept: 'text/plain' }
    }).catch(() => '');
    logTail = lastLogLines(logs, REPORT_LOG_LINES);
  }

  return {
    failedJob: failedJob?.name || '',
    failedStep: failedStep?.name || '',
    logTail
  };
}

function explainFailure(logTail = '', statusError = '', context = {}) {
  const haystack = `${logTail}\n${statusError}`;
  if (/SITE_URL must be set|Production build requires SITE_URL|Боевой домен пока не настроен/i.test(haystack)) {
    const workflowTarget = context.workflowDeployTarget || context.target || '';
    const workflowEvent = context.workflowEvent || '';
    const workflowBranch = context.workflowBranch || context.branch || '';
    return {
      explanation: 'Build упал, потому что SITE_URL обязателен для production build, но не был задан.',
      probableCause: workflowTarget === 'production'
        ? `Workflow определил deploy target как production${workflowBranch ? ` для ветки ${workflowBranch}` : ''}${workflowEvent ? ` при событии ${workflowEvent}` : ''} и поэтому выполнил production settings check.`
        : 'Workflow потребовал SITE_URL, хотя публикация была выбрана как тестовая. Проверьте ветку публикации и deploy target в workflow.',
      nextStep: 'Для текущей стадии используйте тестовую публикацию в ветку preview. Для боевой публикации задайте PRODUCTION_DEPLOY_ENABLED=true и SITE_URL после подключения домена/хостинга.'
    };
  }

  if (/npm run check|astro check/i.test(haystack)) {
    return {
      explanation: 'Сборка остановилась на проверке проекта.',
      probableCause: 'В коде или данных есть ошибка, которую поймал astro check.',
      nextStep: 'Запустите локально npm run check, исправьте ошибку и повторите публикацию.'
    };
  }

  return {
    explanation: 'GitHub Actions завершился с ошибкой.',
    probableCause: 'Точная причина указана в failed job/step и хвосте лога.',
    nextStep: 'Откройте workflow run, проверьте failed step, затем локально выполните npm run check и npm run build.'
  };
}

async function getPublishStatus(params = {}) {
  const target = normalizeDeployTarget(params.target);
  const branch = safeBranchName(params.branch, getPublishBranch(target));
  const commitSha = String(params.commitSha || params.commit || '').trim();
  const runId = String(params.runId || '').trim();
  const repository = await getGitHubRepository().catch(() => null);
  const resolvedCommitUrl = repository && commitSha
    ? `https://github.com/${repository.owner}/${repository.repo}/commit/${commitSha}`
    : '';
  const run = await findWorkflowRun({ branch, commitSha, runId }).catch((error) => ({
    statusLookupError: error instanceof Error ? error.message : 'Не удалось получить статус GitHub Actions.'
  }));

  if (!run || run.statusLookupError) {
    const workflowMeta = inferWorkflowDeployMeta('', branch, target);
    return {
      target,
      mode: target,
      requestedTarget: params.requestedTarget || target,
      publishSource: params.publishSource || '',
      branch,
      ref: params.ref || `refs/heads/${branch}`,
      commitSha,
      runId: runId || null,
      commitUrl: resolvedCommitUrl,
      workflowEvent: '',
      workflowBranch: branch,
      ...workflowMeta,
      status: 'queued',
      statusError: run?.statusLookupError || 'GitHub Actions run еще не найден. Повторите проверку через несколько секунд.'
    };
  }

  const status = normalizeRunStatus(run);
  const failureDetails = status === 'failure' ? await fetchRunFailureDetails(run.id) : {};
  const workflowEvent = run.event || '';
  const workflowBranch = run.head_branch || branch;
  const workflowMeta = inferWorkflowDeployMeta(workflowEvent, workflowBranch, target);
  const failureInfo = status === 'failure'
    ? explainFailure(failureDetails.logTail, '', { target, branch, workflowEvent, workflowBranch, workflowDeployTarget: workflowMeta.workflowDeployTarget })
    : {};
  return {
    target,
    mode: target,
    requestedTarget: params.requestedTarget || target,
    publishSource: params.publishSource || '',
    branch,
    ref: params.ref || `refs/heads/${branch}`,
    commitSha: run.head_sha || commitSha,
    commit: (run.head_sha || commitSha).slice(0, 7),
    commitUrl: repository && (run.head_sha || commitSha)
      ? `https://github.com/${repository.owner}/${repository.repo}/commit/${run.head_sha || commitSha}`
      : resolvedCommitUrl,
    workflowRunId: run.id,
    workflowRunUrl: run.html_url || '',
    workflowEvent,
    workflowBranch,
    ...workflowMeta,
    status,
    runConclusion: run.conclusion || '',
    runName: run.name || '',
    createdAt: run.created_at || '',
    updatedAt: run.updated_at || '',
    ...failureDetails,
    ...failureInfo
  };
}

function buildPublishReport(status, params = {}) {
  const now = new Date().toISOString();
  const target = normalizeDeployTarget(params.target || status.target);
  const workflowEvent = status.workflowEvent || params.workflowEvent || '';
  const workflowBranch = status.workflowBranch || params.workflowBranch || params.branch || status.branch || '';
  const workflowMeta = inferWorkflowDeployMeta(workflowEvent, workflowBranch, target);
  const detectedDeployTarget = status.workflowDeployTarget || params.workflowDeployTarget || workflowMeta.workflowDeployTarget;
  const productionCheckRan = typeof status.productionCheckRan === 'boolean'
    ? status.productionCheckRan
    : workflowMeta.productionCheckRan;
  const productionDeployEnabled = typeof status.productionDeployEnabled === 'boolean'
    ? status.productionDeployEnabled
    : workflowMeta.productionDeployEnabled;
  const siteUrlConfigured = typeof status.siteUrlConfigured === 'boolean'
    ? status.siteUrlConfigured
    : workflowMeta.siteUrlConfigured;
  const workflowDeployReason = status.workflowDeployReason || params.workflowDeployReason || workflowMeta.workflowDeployReason;
  const lines = [
    'SMU-1 publish/build error report',
    '',
    `Дата и время: ${now}`,
    `Кнопка/источник в админке: ${params.publishSource || status.publishSource || ''}`,
    `Target, отправленный админкой: ${params.requestedTarget || status.requestedTarget || target}`,
    `Selected target: ${params.requestedTarget || status.requestedTarget || target}`,
    `Режим публикации: ${target}`,
    `Branch: ${params.branch || status.branch || ''}`,
    `Event: ${workflowEvent}`,
    `Ref: ${params.ref || status.ref || ''}`,
    `Commit hash: ${params.commitSha || status.commitSha || params.commit || ''}`,
    `Commit message: ${params.commitMessage || status.commitMessage || ''}`,
    `Workflow event: ${workflowEvent}`,
    `Workflow branch: ${workflowBranch}`,
    `Deploy target from workflow: ${detectedDeployTarget}`,
    `Detected DEPLOY_TARGET: ${detectedDeployTarget}`,
    `PRODUCTION_DEPLOY_ENABLED: ${productionDeployEnabled ? 'true' : 'false'}`,
    `SITE_URL configured: ${siteUrlConfigured ? 'yes' : 'no'}`,
    `Check production settings ran: ${productionCheckRan ? 'yes' : 'no'}`,
    `productionCheckRan: ${productionCheckRan ? 'true' : 'false'}`,
    `Workflow decision: ${workflowDeployReason}`,
    `Workflow run URL: ${status.workflowRunUrl || params.workflowRunUrl || ''}`,
    `Run status: ${status.status || ''}${status.runConclusion ? ` (${status.runConclusion})` : ''}`,
    `Failed job: ${status.failedJob || ''}`,
    `Failed step: ${status.failedStep || ''}`,
    '',
    'Короткое объяснение ошибки:',
    status.explanation || (status.statusError ? maskSecrets(status.statusError) : 'Публикация или сборка завершилась с ошибкой.'),
    '',
    'Вероятная причина:',
    status.probableCause || 'Смотрите failed job/step и последние строки лога.',
    '',
    'Что сделать дальше:',
    status.nextStep || 'Запустите локальные проверки, исправьте ошибку и повторите публикацию.',
    '',
    'Команды для локальной проверки:',
    'npm run check',
    'npm run build',
    '',
    `Последние ${REPORT_LOG_LINES} строк лога failed step/job:`,
    status.logTail ? maskSecrets(status.logTail) : '(лог недоступен)'
  ];
  return lines.join('\n');
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req, maxBytes = MAX_UPLOAD_SIZE + 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`Запрос слишком большой. Максимум ${formatUploadLimit(maxBytes)} MB.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sanitizeSlug(slug) {
  const value = String(slug ?? '').trim().toLowerCase();
  if (!value) {
    throw new Error('Slug не может быть пустым');
  }
  if (!SAFE_SLUG_RE.test(value)) {
    throw new Error('Некорректный slug. Разрешены только латиница a-z, цифры 0-9 и дефисы.');
  }
  return value;
}

function getCollectionConfig(collection) {
  const config = COLLECTIONS[collection];
  if (!config) {
    throw new Error('Коллекция не разрешена');
  }
  return config;
}

async function readJsonFile(fullPath) {
  const content = await fs.readFile(fullPath, 'utf8');
  return JSON.parse(content);
}

function normalizeNavigationHref(href) {
  const value = String(href ?? '').trim();
  if (!value) {
    throw new Error('URL пункта меню не может быть пустым');
  }
  if (/^\s*javascript:/i.test(value)) {
    throw new Error('URL пункта меню не может использовать javascript:');
  }
  return value;
}

function normalizeNavigationItems(items) {
  if (!Array.isArray(items)) {
    throw new Error('Ожидается массив пунктов меню');
  }

  return items.map((item, index) => {
    const title = String(item?.title ?? '').trim();
    if (!title) {
      throw new Error(`Пункт меню ${index + 1}: заполните название`);
    }

    return {
      title,
      href: normalizeNavigationHref(item?.href),
      isActive: item?.isActive !== false,
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : (index + 1) * 10
    };
  });
}

async function readNavigationItems() {
  const json = await readJsonFile(NAVIGATION_PATH);
  return normalizeNavigationItems(json);
}

function isSamePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function getDirectoryEntryPath(config, slug) {
  const fullPath = path.join(config.path, `${slug}.json`);
  const normalizedBase = path.resolve(config.path);
  const normalizedPath = path.resolve(fullPath);

  if (!normalizedPath.startsWith(normalizedBase + path.sep)) {
    throw new Error('Неверный путь');
  }

  return fullPath;
}

async function listJsonEntries(collection) {
  const config = getCollectionConfig(collection);
  if (config.type === 'single-file') return [];

  const dirEntries = await fs.readdir(config.path, { withFileTypes: true });
  const items = [];
  for (const entry of dirEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    const fileSlug = entry.name.replace(/\.json$/i, '');
    if (!SAFE_SLUG_RE.test(fileSlug)) continue;

    const filePath = path.join(config.path, entry.name);
    const json = await readJsonFile(filePath);
    items.push({ fileSlug, filePath, json });
  }
  return items;
}

function getEntrySlug(entry) {
  if (typeof entry.json?.slug === 'string') {
    try {
      return sanitizeSlug(entry.json.slug);
    } catch {
      // fall back to the file slug for malformed legacy content
    }
  }
  return entry.fileSlug;
}

function catalogSortValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function sortCatalogItems(left, right) {
  const leftSection = String(left.parentSectionSlug ?? left.productCategorySlug ?? left.section ?? '');
  const rightSection = String(right.parentSectionSlug ?? right.productCategorySlug ?? right.section ?? '');
  if (leftSection !== rightSection) return leftSection.localeCompare(rightSection, 'ru');

  const orderDiff = catalogSortValue(left.order) - catalogSortValue(right.order);
  if (orderDiff !== 0) return orderDiff;
  return String(left.title ?? left.slug ?? '').localeCompare(String(right.title ?? right.slug ?? ''), 'ru');
}

async function exportCollection(collection) {
  const entries = await listJsonEntries(collection);
  return entries
    .map((entry) => ({ ...entry.json, slug: getEntrySlug(entry) }))
    .sort(sortCatalogItems);
}

async function buildCatalogExport() {
  const [productCategories, products, catalogPages] = await Promise.all([
    exportCollection('product-categories'),
    exportCollection('products'),
    exportCollection('product-sections')
  ]);

  return {
    type: 'catalog_export',
    version: 1,
    exportedAt: new Date().toISOString(),
    source: {
      site: 'SMU-1',
      content: 'src/content'
    },
    productCategories,
    products,
    catalogPages,
    productImport: buildProductImportPayload(products)
  };
}

function validateContentForWrite(collection, content, options = {}) {
  const productValidated = collection === 'products' ? validateProductContentForWrite(content) : content;
  return assertValidContentRecord({
    collection,
    slug: collection === 'site-settings' ? 'global' : productValidated?.slug,
    value: productValidated,
    previous: options.previous,
    operation: options.operation ?? 'update'
  });
}

async function currentGitHead() {
  try {
    const { stdout } = await runGit(['rev-parse', 'HEAD']);
    const head = String(stdout || '').trim().toLowerCase();
    return /^[a-f0-9]{40}$/u.test(head) ? head : '';
  } catch {
    return '';
  }
}

function publishApiError(code, message, status = 409, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function assertPublishOperationAllowed() {
  try {
    assertSecureOperation(config, 'publish');
  } catch (error) {
    if (error?.code === 'INSECURE_PUBLISH_DENIED') error.status = 403;
    throw error;
  }
}

function publishRemoteName() {
  const remote = String(config.ADMIN_GIT_REMOTE || 'origin').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(remote)) {
    throw publishApiError('PUBLISH_REMOTE_INVALID', 'Некорректное имя Git remote для preview-публикации.', 500);
  }
  return remote;
}

function normalizePublishBasePath(value) {
  const candidate = String(value || '/').trim() || '/';
  if (!candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
    || candidate.includes('?')
    || candidate.includes('#')
    || candidate.split('/').some((part) => part === '.' || part === '..')) {
    throw publishApiError('PUBLISH_TEST_BASE_PATH_INVALID', 'TEST_BASE_PATH должен быть безопасным абсолютным URL-путём.', 500);
  }
  if (candidate === '/') return '/';
  return candidate.endsWith('/') ? candidate : `${candidate}/`;
}

function configuredPublishSite() {
  const rawSiteUrl = String(config.TEST_SITE_URL || '').trim();
  let site;
  try {
    site = new URL(rawSiteUrl);
  } catch {
    throw publishApiError('PUBLISH_TEST_SITE_URL_INVALID', 'Для preview-публикации настройте TEST_SITE_URL.', 500);
  }
  if (site.protocol !== 'https:'
    || site.username
    || site.password
    || site.search
    || site.hash) {
    throw publishApiError(
      'PUBLISH_TEST_SITE_URL_INVALID',
      'TEST_SITE_URL должен быть HTTPS-адресом без credentials, query и fragment.',
      500
    );
  }

  const configuredBase = String(config.TEST_BASE_PATH || config.BASE_PATH || '').trim();
  const sitePath = normalizePublishBasePath(site.pathname || '/');
  let basePath = normalizePublishBasePath(configuredBase || '/');
  if (sitePath !== '/') {
    if (!configuredBase) basePath = sitePath;
    else if (sitePath !== basePath) {
      throw publishApiError(
        'PUBLISH_TEST_URL_AMBIGUOUS',
        'Путь в TEST_SITE_URL не совпадает с TEST_BASE_PATH. Оставьте в TEST_SITE_URL только origin.',
        500
      );
    }
  }

  const preview = new URL(site.origin);
  preview.pathname = basePath;
  preview.search = '';
  preview.hash = '';
  return Object.freeze({
    testSiteUrl: site.origin,
    basePath,
    previewUrl: preview.toString()
  });
}

function parseRemotePublishRefs(bytes) {
  const refs = new Map();
  for (const line of Buffer.from(bytes ?? '').toString('utf8').split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const [sha, ref] = line.trim().split(/\s+/u);
    if (/^[a-f0-9]{40}$/u.test(sha) && ref) refs.set(ref, sha);
  }
  return refs;
}

async function resolveInitialSuccessfulPreviewSha(remote, providers, { requireDeploymentEvidence = true } = {}) {
  let remoteResult;
  try {
    remoteResult = await runGitProcess([
      'ls-remote',
      '--heads',
      remote,
      `refs/heads/${PUBLISH_REFS.candidate}`,
      `refs/heads/${PUBLISH_REFS.preview}`,
      `refs/heads/${PUBLISH_REFS.protected}`
    ], {
      cwd: repoRoot,
      env: createPublishGitEnvironment(process.env),
      timeoutMs: 15_000
    });
  } catch {
    throw publishApiError(
      'PUBLISH_REMOTE_LOOKUP_FAILED',
      'Не удалось безопасно прочитать обязательные remote refs preview-публикации.',
      503
    );
  }
  const refs = parseRemotePublishRefs(remoteResult.stdout);
  const candidate = refs.get(`refs/heads/${PUBLISH_REFS.candidate}`);
  const preview = refs.get(`refs/heads/${PUBLISH_REFS.preview}`);
  const protectedSha = refs.get(`refs/heads/${PUBLISH_REFS.protected}`);
  if (!candidate || !preview || !protectedSha) {
    throw publishApiError('PUBLISH_REMOTE_REF_MISSING', 'Не найдены обязательные candidate/preview/main refs.', 409);
  }
  if (candidate !== preview) {
    throw publishApiError(
      'PUBLISH_REMOTE_REFS_DIVERGED',
      'Remote candidate и preview расходятся; автоматическая публикация остановлена.',
      409,
      { candidate, preview }
    );
  }

  if (!requireDeploymentEvidence) return preview;

  const workflow = await providers.workflowProvider({ testedSha: preview });
  if (!workflow || workflow.sha !== preview || workflow.status !== 'completed' || workflow.conclusion !== 'success') {
    throw publishApiError(
      'PUBLISH_INITIAL_WORKFLOW_UNPROVEN',
      'Текущий preview SHA не подтверждён успешным exact-SHA workflow.',
      409,
      { previewSha: preview }
    );
  }
  const pages = await providers.pagesProvider({ testedSha: preview, workflow });
  if (!pages || pages.sha !== preview || pages.status !== 'completed' || pages.conclusion !== 'success') {
    throw publishApiError(
      'PUBLISH_INITIAL_PAGES_UNPROVEN',
      'Текущий preview SHA не подтверждён успешным exact-SHA GitHub Pages deployment.',
      409,
      { previewSha: preview }
    );
  }
  const smoke = await providers.smokeRunner({
    testedSha: preview,
    affectedRoutes: ['/'],
    routeExpectations: [{ route: '/', expected: 'html' }],
    pages
  });
  if (!smoke || smoke.sha !== preview || smoke.ok !== true
    || !Array.isArray(smoke.checkedRoutes) || !smoke.checkedRoutes.includes('/')) {
    throw publishApiError(
      'PUBLISH_INITIAL_LIVE_SMOKE_UNPROVEN',
      'Текущий preview SHA не прошёл точную live-проверку главной страницы.',
      409,
      { previewSha: preview }
    );
  }
  return preview;
}

async function hasPersistedPublishState(runtimeDir) {
  for (const filename of ['state.json', 'state.previous.json']) {
    try {
      await fs.lstat(path.join(runtimeDir, filename));
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

function publishOwnership(req, session, body = {}) {
  const recoveryClientId = body?.recoveryClientId || headerText(req, 'x-admin-recovery-client-id');
  const idempotencyKey = body?.idempotencyKey || headerText(req, 'x-admin-idempotency-key');
  return {
    owner: session.username,
    sessionFingerprint: sessionFingerprint(session),
    ...(recoveryClientId ? { recoveryClientId: String(recoveryClientId).trim() } : {}),
    ...(idempotencyKey ? { idempotencyKey: String(idempotencyKey).trim() } : {})
  };
}

function withPublishPreviewUrl(payload) {
  return { ...payload, previewUrl: configuredPublishSite().previewUrl };
}

function parseMultipartFormData(buffer, contentType) {
  const boundaryMatch = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('Некорректный multipart/form-data');
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  if (!boundary || boundary.length > 200) throw new Error('Некорректная multipart boundary');
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  let start = buffer.indexOf(delimiter);
  while (start !== -1) {
    const next = buffer.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = buffer.slice(start + delimiter.length + 2, Math.max(start + delimiter.length + 2, next - 2));
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      const name = headers.match(/name="([^"]+)"/i)?.[1] || '';
      const filename = headers.match(/filename="([^"]*)"/i)?.[1];
      const value = part.slice(headerEnd + 4);
      if (filename !== undefined) {
        files.push({
          fieldName: name,
          filename,
          declaredMime: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || '',
          fileBuffer: value
        });
      } else if (name && value.length <= 16 * 1024) {
        fields[name] = value.toString('utf8');
      }
    }
    start = next;
  }
  return { fields, files };
}

function requireBaseRevision(value, { create = false } = {}) {
  const revision = typeof value === 'string' ? value.trim() : '';
  if (!revision || (create && revision !== MISSING_REVISION)) {
    const error = new Error(create
      ? 'Для создания записи нужен baseRevision="missing".'
      : 'Для сохранения нужен baseRevision из последнего чтения записи.');
    error.code = 'BASE_REVISION_REQUIRED';
    error.status = 409;
    throw error;
  }
  return revision;
}

async function assertSlugIsUnique(collection, slug, currentPath = null) {
  const entries = await listJsonEntries(collection);
  for (const entry of entries) {
    if (currentPath && isSamePath(entry.filePath, currentPath)) continue;
    const occupiedSlugs = new Set([entry.fileSlug, getEntrySlug(entry)]);
    if (occupiedSlugs.has(slug)) {
      throw new Error('Запись с таким slug уже существует');
    }
  }
}

async function assertTopLevelRouteIsAvailable(collection, slug, currentPath = null) {
  if (!ROUTE_SLUG_COLLECTIONS.has(collection)) return;
  if (RESERVED_TOP_LEVEL_SLUGS.has(slug)) {
    throw new Error('Этот slug занят системным маршрутом сайта');
  }

  for (const routeCollection of ROUTE_SLUG_COLLECTIONS) {
    const entries = await listJsonEntries(routeCollection);
    for (const entry of entries) {
      if (currentPath && isSamePath(entry.filePath, currentPath)) continue;
      const occupiedSlugs = new Set([entry.fileSlug, getEntrySlug(entry)]);
      if (occupiedSlugs.has(slug)) {
        throw new Error('Этот slug уже занят другой страницей сайта');
      }
    }
  }
}

async function validateDirectoryContentSlug(collection, content, currentPath = null, previousSlug = null) {
  const slug = sanitizeSlug(content?.slug ?? previousSlug);
  if (collection === 'static-pages' && previousSlug && LOCKED_STATIC_PAGE_SLUGS.has(previousSlug) && slug !== previousSlug) {
    throw new Error('Slug этой служебной страницы закреплен маршрутом сайта');
  }

  await assertSlugIsUnique(collection, slug, currentPath);
  await assertTopLevelRouteIsAvailable(collection, slug, currentPath);
  return slug;
}

async function listCollectionEntries(collection) {
  const config = getCollectionConfig(collection);

  if (config.type === 'single-file') {
    const json = await readJsonFile(config.path);
    return [
      {
        slug: config.slug,
        fileName: path.basename(config.path),
        title: json.title ?? json.companyName ?? 'Настройки',
        isActive: typeof json.isActive === 'boolean' ? json.isActive : null,
        order: typeof json.order === 'number' ? json.order : null,
        summary: {
          shortDescription: json.shortDescription ?? null,
          mode: json.mode ?? null,
          parentSectionSlug: json.parentSectionSlug ?? null,
          productCategorySlug: json.productCategorySlug ?? null,
          presentationType: json.presentationType ?? null,
          showInCatalog: typeof json.showInCatalog === 'boolean' ? json.showInCatalog : null,
          showInSectionGrid: typeof json.showInSectionGrid === 'boolean' ? json.showInSectionGrid : null,
          showOnHome: typeof json.showOnHome === 'boolean' ? json.showOnHome : null,
          sku: json.sku ?? null,
          city: json.city ?? null,
          year: json.year ?? null,
          hasPrimaryMedia: Boolean(json.coverImage || json.image),
          galleryCount: [...(Array.isArray(json.gallery) ? json.gallery : []), ...(Array.isArray(json.images) ? json.images : [])].length
        }
      }
    ];
  }

  const entries = await listJsonEntries(collection);
  const items = [];
  for (const entry of entries) {
    const json = entry.json;
    const slug = getEntrySlug(entry);
    items.push({
      slug,
      fileName: path.basename(entry.filePath),
      title: json.title ?? slug,
      isActive: typeof json.isActive === 'boolean' ? json.isActive : null,
      order: typeof json.order === 'number' ? json.order : null,
      summary: {
        shortDescription: json.shortDescription ?? null,
        mode: json.mode ?? null,
        parentSectionSlug: json.parentSectionSlug ?? null,
        productCategorySlug: json.productCategorySlug ?? null,
        presentationType: json.presentationType ?? null,
        showInCatalog: typeof json.showInCatalog === 'boolean' ? json.showInCatalog : null,
        showInSectionGrid: typeof json.showInSectionGrid === 'boolean' ? json.showInSectionGrid : null,
        showOnHome: typeof json.showOnHome === 'boolean' ? json.showOnHome : null,
        sku: json.sku ?? null,
        city: json.city ?? null,
        year: json.year ?? null,
        hasPrimaryMedia: Boolean(json.coverImage || json.image),
        galleryCount: [...(Array.isArray(json.gallery) ? json.gallery : []), ...(Array.isArray(json.images) ? json.images : [])].length
      }
    });
  }

  return items.sort((a, b) => {
    const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title, 'ru');
  });
}

async function resolveJsonPath(collection, slug) {
  const config = getCollectionConfig(collection);

  if (config.type === 'single-file') {
    if (slug !== config.slug) {
      throw new Error('Запись не найдена');
    }
    return config.path;
  }

  const safeSlug = sanitizeSlug(slug);
  const fullPath = getDirectoryEntryPath(config, safeSlug);

  try {
    await fs.access(fullPath);
    return fullPath;
  } catch {
    const entries = await listJsonEntries(collection);
    for (const entry of entries) {
      if (getEntrySlug(entry) === safeSlug) return entry.filePath;
    }
  }

  return fullPath;
}

function getAuthSession(req, { touch = true } = {}) {
  const cookies = parseSecureCookies(req);
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (!token) return null;
  const result = sessions.get(token, { touch });
  return result.ok ? { token, ...result.session } : null;
}

function requireAuth(req, res) {
  const session = getAuthSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Требуется авторизация' });
    return null;
  }
  return session;
}

function writeSessionCookie(res, token) {
  res.setHeader('Set-Cookie', buildSessionCookie(token, {
    path: '/api/admin',
    secure: false,
    maxAgeSeconds: 8 * 60 * 60
  }));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', clearSessionCookieHeader({ path: '/api/admin', secure: false }));
}

function headerText(req, name) {
  const value = req.headers[String(name).toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function sessionFingerprint(session) {
  return `session-${crypto.createHash('sha256').update(String(session.token)).digest('hex')}`;
}

function mediaOwnerId(session) {
  return `owner-${crypto.createHash('sha256')
    .update(`smu1-media-owner\0${String(session.username || '')}`)
    .digest('hex')
    .slice(0, 48)}`;
}

function authorizeMediaOperations(operations, session) {
  if (!Array.isArray(operations)) return operations;
  const ownerId = mediaOwnerId(session);
  return operations.map((operation) => operation?.type === 'promote-staged-media'
    ? { ...operation, stagingOwner: ownerId }
    : operation);
}

function stagedPromotionOperations(body, session) {
  const rows = body?.stagedMedia;
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || rows.length > 100) {
    throw new ContentTransactionError('STAGED_MEDIA_LIST_INVALID', 'Некорректный список подготовленных медиафайлов.', { status: 400 });
  }
  return authorizeMediaOperations(rows.map((row) => ({
    type: 'promote-staged-media',
    stagedId: row?.stagedId,
    batchId: row?.batchId,
    leaseId: row?.leaseId,
    baseRevision: row?.baseRevision,
    destinationBaseRevision: row?.destinationBaseRevision
  })), session);
}

function transactionContext(req, session, body = {}, fallbackSeed = '') {
  const fingerprint = sessionFingerprint(session);
  const recoveryClientId = String(
    body?.recoveryClientId
    || headerText(req, 'x-admin-recovery-client-id')
    || fingerprint
  ).trim();
  const explicitKey = body?.idempotencyKey || headerText(req, 'x-admin-idempotency-key');
  const idempotencyKey = String(explicitKey || `compat-${crypto.createHash('sha256')
    .update(`${req.method || ''}\0${req.url || ''}\0${fallbackSeed || JSON.stringify(body)}`)
    .digest('hex')}`).trim();
  return {
    owner: session.username,
    sessionFingerprint: fingerprint,
    recoveryClientId,
    idempotencyKey
  };
}

function transactionOwnership(req, session, body = {}) {
  const recoveryClientId = body?.recoveryClientId || headerText(req, 'x-admin-recovery-client-id');
  const idempotencyKey = body?.idempotencyKey || headerText(req, 'x-admin-idempotency-key');
  return {
    owner: session.username,
    sessionFingerprint: sessionFingerprint(session),
    ...(recoveryClientId ? { recoveryClientId: String(recoveryClientId).trim() } : {}),
    ...(idempotencyKey ? { idempotencyKey: String(idempotencyKey).trim() } : {})
  };
}

function blockedTransaction(preview) {
  const error = new ContentTransactionError(
    'CONTENT_TRANSACTION_BLOCKED',
    'Изменения не прошли проверку связей и схемы.',
    {
      status: 409,
      blockers: preview.blockers || [],
      warnings: preview.warnings || [],
      validationIssues: (preview.blockers || []).filter((item) => item?.collection || item?.path)
    }
  );
  throw error;
}

async function applyCompatibilityTransaction(req, session, body, operations, userSummary) {
  const context = transactionContext(req, session, body);
  const baseHead = await currentGitHead();
  const preview = await contentTransactions.preview({
    ...context,
    operations,
    ...(baseHead ? { baseHead } : {}),
    metadata: { userSummary, ...(baseHead ? { baseHead } : {}) }
  });
  if (preview.state === 'blocked') blockedTransaction(preview);
  if (preview.state === 'no-op') return { preview, applied: preview };
  const applied = await contentTransactions.apply({
    ...context,
    transactionId: preview.transactionId,
    payloadHash: preview.payloadHash
  });
  return { preview, applied };
}

function compatibilityTransactionReceipt(transaction) {
  return {
    transactionId: transaction.preview.transactionId,
    changedPaths: (transaction.preview.diff || []).map((item) => item.path).filter(Boolean),
    affectedRoutes: transaction.preview.metadata?.affectedRoutes || [],
    routeExpectations: transaction.preview.metadata?.routeExpectations || [],
    routeTransitions: transaction.preview.metadata?.routeTransitions || [],
    recordRenames: transaction.preview.metadata?.recordRenames || []
  };
}

const { config } = await loadAdminConfig({ repoRoot });
assertSecureOperation(config, 'startup');
const worktreeGuard = config.ADMIN_TEST_MODE && process.env.ADMIN_TEST_CONTENT_ROOT
  ? null
  : createWorktreeMutationGuard({
      repoRoot,
      expectedBranch: config.ADMIN_EXPECTED_BRANCH
    });
await worktreeGuard?.initialize();
const writerLease = createWriterLease({
  repoRoot: transactionRepoRoot,
  runtimeDir: path.join(transactionRepoRoot, '.admin-runtime')
});
await writerLease.acquire();
const allowedHosts = [`${config.ADMIN_API_HOST}:${config.ADMIN_API_PORT}`];
const requestPolicy = createLocalRequestPolicy({
  allowedOrigins: config.ADMIN_ALLOWED_ORIGINS,
  allowedHosts,
  allowIpv6: config.ADMIN_ALLOW_IPV6_LOOPBACK === true,
  allowLocalhost: false
});
const sessions = new SessionStore({ secret: config.SESSION_SECRET });
const loginLimiter = new LoginLimiter({ secret: config.SESSION_SECRET });
const mediaStaging = createMediaStagingService({
  stagingRoot: path.join(transactionRepoRoot, '.admin-runtime', 'media-staging')
});
await mediaStaging.init();
await mediaStaging.cleanupExpired({ removeTemporary: true });
const mediaCleanupTimer = setInterval(() => {
  void mediaStaging.cleanupExpired().catch((error) => {
    console.error(`[admin-api] media staging cleanup failed [${error?.code || 'MEDIA_CLEANUP_ERROR'}]`);
  });
}, 60 * 60 * 1000);
mediaCleanupTimer.unref?.();
const mediaLibrary = createMediaLibraryService({ repoRoot: transactionRepoRoot });
const mediaStagingAdapter = Object.freeze({
  async resolveForPromotion({ stagedId, batchId, leaseId, owner }) {
    const resolved = await mediaStaging.resolveForPromotion({
      stagedId,
      batchId,
      leaseId,
      ownerId: owner
    });
    return {
      bytes: resolved.bytes,
      sourcePath: path.relative(transactionRepoRoot, resolved.filePath).split(path.sep).join('/'),
      publicPath: resolved.canonicalPath
    };
  },
  async markPromoted({ stagedId, batchId, leaseId, stagingOwner, publicPath }) {
    return mediaStaging.markPromoted({
      stagedId,
      batchId,
      leaseId,
      ownerId: stagingOwner,
      canonicalPath: publicPath
    });
  }
});
const contentTransactions = createContentTransactionService({
  repoRoot: transactionRepoRoot,
  runtimeDir: path.join(transactionRepoRoot, '.admin-runtime', 'content-transactions'),
  collections: COLLECTIONS,
  singletons: TRANSACTION_SINGLETONS,
  stagingAdapter: mediaStagingAdapter,
  engineOptions: { lockAcquireTimeoutMs: 5_000 }
});
await contentTransactions.initialize();
const contentJson = createContentJsonService({
  repoRoot: transactionRepoRoot,
  collections: COLLECTIONS,
  singletons: TRANSACTION_SINGLETONS,
  transactionService: contentTransactions
});
const localPreview = createLocalPreviewService({
  repoRoot: transactionRepoRoot,
  runtimeDir: path.join(transactionRepoRoot, '.admin-runtime', 'local-preview'),
  origin: `http://${config.ADMIN_API_HOST}:${config.ADMIN_API_PORT}`
});
await localPreview.initialize();

let publishServiceInstance = null;
let publishServicePromise = null;

async function getPublishService() {
  assertPublishOperationAllowed();
  if (publishServiceInstance) return publishServiceInstance;
  if (publishServicePromise) return publishServicePromise;

  publishServicePromise = (async () => {
    const remote = publishRemoteName();
    const site = configuredPublishSite();
    const runtimeDir = path.join(repoRoot, '.admin-runtime', 'publish');
    const providers = createGitHubPublishProviders({
      githubRequest,
      previewBranch: PUBLISH_REFS.preview,
      testSiteBaseUrl: site.previewUrl
    });
    const persistedState = await hasPersistedPublishState(runtimeDir);
    const initialLastSuccessfulPreviewSHA = await resolveInitialSuccessfulPreviewSha(remote, providers, {
      requireDeploymentEvidence: !persistedState
    });
    const gateRunner = createContentPublishGateRunner({
      environment: {
        ...process.env,
        DEPLOY_TARGET: 'test',
        PRODUCTION_DEPLOY_ENABLED: 'false',
        REQUIRE_SITE_URL: 'false',
        SITE_URL: '',
        TEST_SITE_URL: site.testSiteUrl,
        BASE_PATH: site.basePath,
        TEST_BASE_PATH: site.basePath,
        GITHUB_REF_NAME: PUBLISH_REFS.preview
      }
    });
    const service = createPublishService({
      repoRoot,
      runtimeDir,
      initialLastSuccessfulPreviewSHA,
      transactionService: contentTransactions,
      remote,
      refs: PUBLISH_REFS,
      gateRunner,
      workflowProvider: providers.workflowProvider,
      pagesProvider: providers.pagesProvider,
      smokeRunner: providers.smokeRunner,
      retryProvider: providers.retryProvider,
      // Anonymous GitHub API reads are limited to 60 requests/hour. Keep the
      // owner flow usable without a token, while authenticated status polling
      // may remain responsive.
      pollIntervalMs: getGitHubToken() ? 15_000 : 75_000,
      environment: process.env
    });
    try {
      await service.initialize();
    } catch (error) {
      await service.close().catch(() => {});
      throw error;
    }
    publishServiceInstance = service;
    return service;
  })();

  try {
    return await publishServicePromise;
  } catch (error) {
    publishServicePromise = null;
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    applyHeaders(res, apiSecurityHeaders());
    const policy = requestPolicy.evaluate(req);
    if (!policy.ok) {
      sendJson(res, policy.status || 403, { error: 'Локальный запрос отклонён политикой безопасности.', code: policy.code });
      return;
    }
    applyHeaders(res, policy.corsHeaders);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${config.ADMIN_API_PORT}`);
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/admin')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (pathname === '/api/admin/health' && req.method === 'GET') {
      sendJson(res, 200, adminApiHealthIdentity);
      return;
    }

    if (pathname === '/api/admin/login' && req.method === 'POST') {
      const body = await readBody(req);
      const username = String(body.login ?? '').trim();
      const password = String(body.password ?? '');
      const limiterKey = loginLimiterKey(req, username);
      const rate = loginLimiter.check(limiterKey);
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        sendJson(res, 429, { error: 'Слишком много попыток входа. Повторите позже.', code: rate.code, retryAfterSeconds: rate.retryAfterSeconds });
        return;
      }

      const credentialsValid = config.ADMIN_TEST_MODE
        ? timingSafeEqualText(username, config.ADMIN_USERNAME) && timingSafeEqualText(password, config.ADMIN_PASSWORD)
        : await verifyCredentials(
            { username: config.ADMIN_USERNAME, passwordHash: config.ADMIN_PASSWORD_HASH },
            { username, password }
          );
      if (!credentialsValid) {
        loginLimiter.recordFailure(limiterKey);
        sendJson(res, 401, { error: 'Неверный логин или пароль' });
        return;
      }

      loginLimiter.recordSuccess(limiterKey);
      const issued = sessions.issue(username);
      writeSessionCookie(res, issued.token);
      sendJson(res, 200, {
        ok: true,
        username,
        csrfToken: issued.session.csrfToken,
        publishConfig: getPublishConfigPayload(),
        capabilities: API_CAPABILITIES
      });
      return;
    }

    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      const session = getAuthSession(req, { touch: false });
      if (session) {
        assertCsrf(req, session.csrfToken);
        sessions.logout(session.token);
      }
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/admin/me' && req.method === 'GET') {
      const session = getAuthSession(req);
      if (!session) {
        sendJson(res, 200, { authenticated: false, capabilities: API_CAPABILITIES });
        return;
      }
      sendJson(res, 200, {
        authenticated: true,
        username: session.username,
        csrfToken: session.csrfToken,
        publishConfig: getPublishConfigPayload(),
        capabilities: API_CAPABILITIES
      });
      return;
    }

    const authSession = requireAuth(req, res);
    if (!authSession) {
      return;
    }
    if (pathname.startsWith('/api/admin/publish/')) {
      assertPublishOperationAllowed();
    }
    if (MUTATING_METHODS.has(String(req.method || '').toUpperCase())) {
      await worktreeGuard?.assertMutable();
      assertCsrf(req, authSession.csrfToken);
      await writerLease.assertOwned();
    }
    const authUser = authSession.username;

    if (pathname === '/api/admin/local-preview' && req.method === 'POST') {
      const body = await readBody(req);
      const collection = String(body?.collection || '');
      const slug = String(body?.slug || '');
      const outcome = await contentTransactions.withRecordStableRead(
        { collection, slug },
        async (snapshot, { refreshLease }) => {
          if (body?.revision && body.revision !== snapshot.revision) {
            return { conflictRevision: snapshot.revision };
          }
          return {
            result: await localPreview.build({
              collection,
              slug,
              revision: snapshot.revision,
              owner: sessionFingerprint(authSession),
              refreshLease
            })
          };
        }
      );
      if (outcome.conflictRevision) {
        sendJson(res, 409, {
          code: 'LOCAL_PREVIEW_REVISION_CONFLICT',
          error: 'Запись изменилась после открытия. Перезагрузите её перед точным просмотром.',
          currentRevision: outcome.conflictRevision
        });
        return;
      }
      sendJson(res, 200, outcome.result);
      return;
    }

    const localPreviewAssetMatch = pathname.match(/^\/api\/admin\/local-preview\/([a-f0-9]{32})(?:\/(.*))?$/u);
    if (localPreviewAssetMatch && req.method === 'GET') {
      const asset = await localPreview.resolveAsset({
        token: localPreviewAssetMatch[1],
        relativePath: localPreviewAssetMatch[2] || '',
        owner: sessionFingerprint(authSession)
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', asset.contentType);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        'frame-src https://yandex.ru https://yandex.com',
        "worker-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'"
      ].join('; '));
      res.end(asset.bytes);
      return;
    }

    if (pathname === '/api/admin/transactions/preview' && req.method === 'POST') {
      const body = await readBody(req, MAX_JSON_IMPORT_BODY_SIZE);
      const baseHead = await currentGitHead();
      const preview = await contentTransactions.preview({
        ...transactionContext(req, authSession, body),
        operations: authorizeMediaOperations(body?.operations, authSession),
        ...(baseHead ? { baseHead } : {}),
        metadata: {
          userSummary: body?.userSummary || body?.metadata?.userSummary || 'Изменение контента',
          ...(baseHead ? { baseHead } : {})
        }
      });
      sendJson(res, 200, preview);
      return;
    }

    if (pathname === '/api/admin/transactions/apply' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await contentTransactions.apply({
        ...transactionOwnership(req, authSession, body),
        transactionId: body?.transactionId,
        payloadHash: body?.payloadHash
      });
      sendJson(res, 200, result);
      return;
    }

    const transactionMatch = pathname.match(/^\/api\/admin\/transactions\/([a-z0-9-]+)$/i);
    if (transactionMatch && req.method === 'GET') {
      const result = await contentTransactions.getTransaction({
        ...transactionOwnership(req, authSession),
        transactionId: transactionMatch[1]
      });
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/admin/history' && req.method === 'GET') {
      const history = await contentTransactions.listHistory(transactionOwnership(req, authSession));
      sendJson(res, 200, { history });
      return;
    }

    const restorePreviewMatch = pathname.match(/^\/api\/admin\/history\/([a-z0-9-]+)\/restore-preview$/i);
    if (restorePreviewMatch && req.method === 'POST') {
      const body = await readBody(req);
      const baseHead = await currentGitHead();
      const preview = await contentTransactions.previewRestore({
        ...transactionContext(req, authSession, body),
        sourceTransactionId: restorePreviewMatch[1],
        ...(baseHead ? { baseHead } : {}),
        metadata: {
          userSummary: body?.userSummary || `Восстановление ${restorePreviewMatch[1]}`,
          ...(baseHead ? { baseHead } : {})
        }
      });
      sendJson(res, 200, preview);
      return;
    }

    if (pathname === '/api/admin/navigation' && req.method === 'GET') {
      const snapshot = await contentTransactions.readSingleton({ singleton: 'navigation' });
      const items = normalizeNavigationItems(snapshot.content);
      sendJson(res, 200, {
        items,
        revision: snapshot.revision,
        schemaVersion: CONTENT_SCHEMA_VERSION
      });
      return;
    }

    if (pathname === '/api/admin/navigation' && req.method === 'PUT') {
      const body = await readBody(req);
      const baseRevision = requireBaseRevision(body?.baseRevision);
      const items = normalizeNavigationItems(body?.items ?? body);
      const validated = assertValidSingleton({ singleton: 'navigation', value: items, operation: 'update' });
      const transaction = await applyCompatibilityTransaction(req, authSession, body, [{
        type: 'upsert-singleton', singleton: 'navigation', value: validated, baseRevision
      }], 'Обновление навигации');
      const saved = await contentTransactions.readSingleton({ singleton: 'navigation' });
      sendJson(res, 200, {
        ok: true,
        result: transaction.applied.state === 'no-op' ? 'noop' : 'saved',
        items: saved.content,
        revision: saved.revision,
        schemaVersion: CONTENT_SCHEMA_VERSION,
        ...compatibilityTransactionReceipt(transaction)
      });
      return;
    }

    const singletonMatch = pathname.match(/^\/api\/admin\/singletons\/(navigation|yandex)$/i);
    if (singletonMatch && req.method === 'GET') {
      const singleton = singletonMatch[1].toLowerCase();
      const snapshot = await contentTransactions.readSingleton({ singleton });
      sendJson(res, 200, {
        singleton,
        content: snapshot.content,
        revision: snapshot.revision,
        schemaVersion: CONTENT_SCHEMA_VERSION
      });
      return;
    }

    if (singletonMatch && req.method === 'PUT') {
      const body = await readBody(req);
      const singleton = singletonMatch[1].toLowerCase();
      const baseRevision = requireBaseRevision(body?.baseRevision);
      const content = assertValidSingleton({ singleton, value: body?.content, operation: 'update' });
      const transaction = await applyCompatibilityTransaction(req, authSession, body, [{
        type: 'upsert-singleton', singleton, value: content, baseRevision
      }], `Сохранить ${singleton === 'yandex' ? 'настройки Яндекса' : 'навигацию'}`);
      const saved = await contentTransactions.readSingleton({ singleton });
      sendJson(res, 200, {
        ok: true,
        result: transaction.applied.state === 'no-op' ? 'noop' : 'saved',
        singleton,
        content: saved.content,
        revision: saved.revision,
        schemaVersion: CONTENT_SCHEMA_VERSION,
        ...compatibilityTransactionReceipt(transaction)
      });
      return;
    }

    if (pathname === '/api/admin/export-catalog' && req.method === 'GET') {
      const exportedAt = new Date();
      const payload = await contentTransactions.withStableRead(() => buildCatalogExport());
      const filename = `smu1-catalog-export-${exportedAt.toISOString().slice(0, 10)}.json`;
      sendPrettyJson(res, 200, payload, filename);
      return;
    }

    if (pathname === '/api/admin/json-export/full-site' && req.method === 'GET') {
      const exported = await contentTransactions.withStableRead(() => contentJson.exportFullSite());
      sendPrettyJson(res, 200, exported.payload, exported.filename);
      return;
    }

    const pageJsonExportMatch = pathname.match(/^\/api\/admin\/json-export\/page\/([a-z0-9-]+)\/([a-z0-9-]+)$/i);
    if (pageJsonExportMatch && req.method === 'GET') {
      const [, collection, slug] = pageJsonExportMatch;
      const exported = await contentTransactions.withStableRead(() => contentJson.exportPage(collection, slug));
      sendPrettyJson(res, 200, exported.payload, exported.filename);
      return;
    }

    const jsonExportMatch = pathname.match(/^\/api\/admin\/json-export\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/i);
    if (jsonExportMatch && req.method === 'GET') {
      const [, collection, slug] = jsonExportMatch;
      const exported = await contentTransactions.withStableRead(() => slug
        ? contentJson.exportSingle(collection, slug)
        : contentJson.exportCollection(collection));
      sendPrettyJson(res, 200, exported.payload, exported.filename);
      return;
    }

    if (pathname === '/api/admin/json-import/preview' && req.method === 'POST') {
      const body = await readBody(req, MAX_JSON_IMPORT_BODY_SIZE);
      const context = transactionContext(req, authSession, body);
      const baseHead = await currentGitHead();
      const preview = await contentJson.preview({
        ...context,
        ...(baseHead ? { baseHead } : {}),
        collection: body?.collection,
        scope: body?.scope,
        currentSlug: body?.currentSlug,
        writeMode: body?.writeMode,
        rawJson: body?.rawJson
      });
      sendJson(res, 200, preview);
      return;
    }

    if (pathname === '/api/admin/json-import/apply' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await contentJson.apply({
        owner: authUser,
        ...transactionOwnership(req, authSession, body),
        operationId: body?.operationId,
        replaceConfirmed: body?.replaceConfirmed === true
      });
      sendJson(res, result.result === 'success' ? 200 : 409, result);
      return;
    }

    if (pathname === '/api/admin/publish/preview-plan' && req.method === 'POST') {
      assertPublishOperationAllowed();
      const body = await readBody(req);
      const publishService = await getPublishService();
      const plan = await publishService.preview({
        ...publishOwnership(req, authSession, body),
        target: body?.target,
        transactionIds: body?.transactionIds ?? body?.selectedTransactionIds ?? []
      });
      sendJson(res, 200, withPublishPreviewUrl(plan));
      return;
    }

    if (pathname === '/api/admin/publish/preview-apply' && req.method === 'POST') {
      assertPublishOperationAllowed();
      const body = await readBody(req);
      const publishService = await getPublishService();
      const job = await publishService.start({
        ...publishOwnership(req, authSession, body),
        target: body?.target,
        planId: body?.planId
      });
      sendJson(res, job.status === 'empty' ? 200 : 202, withPublishPreviewUrl(job));
      return;
    }

    if (pathname === '/api/admin/publish/status' && req.method === 'GET') {
      assertPublishOperationAllowed();
      const publishService = await getPublishService();
      const status = await publishService.overview(publishOwnership(req, authSession));
      sendJson(res, 200, withPublishPreviewUrl(status));
      return;
    }

    const publishJobMatch = pathname.match(
      /^\/api\/admin\/publish\/jobs\/([A-Za-z0-9][A-Za-z0-9._:-]{2,255})(?:\/(poll|retry|report))?$/u
    );
    if (publishJobMatch) {
      const [, jobId, action = 'status'] = publishJobMatch;
      const methodAllowed = (action === 'status' || action === 'report')
        ? req.method === 'GET'
        : req.method === 'POST';
      if (!methodAllowed) {
        sendJson(res, 405, { error: 'Метод не разрешён для publish job route.', code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      assertPublishOperationAllowed();
      const body = req.method === 'POST' ? await readBody(req) : {};
      const request = {
        ...publishOwnership(req, authSession, body),
        target: body?.target,
        jobId
      };
      const publishService = await getPublishService();
      if (action === 'report') {
        const report = withPublishPreviewUrl(await publishService.report(request));
        sendPrettyJson(res, 200, report, `smu1-publish-report-${jobId}.json`);
        return;
      }
      const job = action === 'poll'
        ? await publishService.poll(request)
        : action === 'retry'
          ? await publishService.retry(request)
          : await publishService.getStatus(request);
      sendJson(res, 200, withPublishPreviewUrl(job));
      return;
    }

    if (pathname === '/api/admin/publish') {
      sendJson(res, 410, {
        error: 'Старый publish отключён: он не доказывал exact SHA и atomic update двух preview-веток.',
        code: 'LEGACY_PUBLISH_DISABLED',
        replacement: '/api/admin/publish/preview-plan'
      });
      return;
    }

    if (pathname === '/api/admin/publish-all') {
      sendJson(res, 410, {
        error: 'Публикация всего checkout из админки запрещена. Админка публикует только точные content transaction manifests.',
        code: 'LEGACY_PUBLISH_ALL_DISABLED',
        replacement: '/api/admin/publish/preview-plan'
      });
      return;
    }

    if (pathname === '/api/admin/publish-status') {
      sendJson(res, 410, {
        error: 'Legacy publish status отключён; используйте exact-SHA job status.',
        code: 'LEGACY_PUBLISH_STATUS_DISABLED',
        replacement: '/api/admin/publish/status'
      });
      return;
    }

    if (pathname === '/api/admin/publish-report') {
      sendJson(res, 410, {
        error: 'Legacy publish report отключён; скачивайте JSON-отчёт exact-SHA job.',
        code: 'LEGACY_PUBLISH_REPORT_DISABLED',
        replacement: '/api/admin/publish/jobs/:jobId/report'
      });
      return;
    }

    if (pathname === '/api/admin/media/staging' && req.method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      if (!String(contentType).includes('multipart/form-data')) {
        sendJson(res, 400, { error: 'Ожидается multipart/form-data', code: 'MEDIA_MULTIPART_REQUIRED' });
        return;
      }
      const raw = await readRawBody(req, MAX_VIDEO_UPLOAD_SIZE + 64 * 1024);
      const form = parseMultipartFormData(raw, contentType);
      if (form.files.length !== 1 || form.files[0].fieldName !== 'file') {
        sendJson(res, 400, { error: 'За один staging-запрос принимается ровно один файл.', code: 'MEDIA_FILE_COUNT_INVALID' });
        return;
      }
      const file = form.files[0];
      await mediaStaging.cleanupExpired();
      const staged = await mediaStaging.stage({
        batchId: form.fields.batchId,
        ownerId: mediaOwnerId(authSession),
        clientId: form.fields.clientId,
        originalIndex: form.fields.originalIndex,
        filename: file.filename,
        declaredMime: file.declaredMime,
        buffer: file.fileBuffer
      });
      const destination = path.join(transactionRepoRoot, 'public', ...staged.canonicalPath.split('/').filter(Boolean));
      let destinationBytes = null;
      try { destinationBytes = await fs.readFile(destination); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      sendJson(res, 201, {
        ...staged,
        baseRevision: revisionForBytes(file.fileBuffer),
        destinationBaseRevision: revisionForBytes(destinationBytes),
        usage: await mediaStaging.usage()
      });
      return;
    }

    if (pathname === '/api/admin/media/staging/usage' && req.method === 'GET') {
      sendJson(res, 200, await mediaStaging.usage());
      return;
    }

    if (pathname === '/api/admin/media/library' && req.method === 'GET') {
      const result = await contentTransactions.withStableRead(() => mediaLibrary.list({
        page: url.searchParams.get('page') || 1,
        pageSize: url.searchParams.get('pageSize') || 24,
        search: url.searchParams.get('search') || '',
        usage: url.searchParams.get('usage') || 'all'
      }));
      sendJson(res, 200, result);
      return;
    }

    const stagedBatchMatch = pathname.match(/^\/api\/admin\/media\/staging\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})$/u);
    if (stagedBatchMatch && req.method === 'GET') {
      const items = await mediaStaging.listBatch({
        batchId: stagedBatchMatch[1],
        ownerId: mediaOwnerId(authSession)
      });
      sendJson(res, 200, { batchId: stagedBatchMatch[1], items, usage: await mediaStaging.usage() });
      return;
    }

    const stagedBatchRenewMatch = pathname.match(/^\/api\/admin\/media\/staging\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})\/renew$/u);
    if (stagedBatchRenewMatch && req.method === 'POST') {
      const renewed = await mediaStaging.renewBatch({
        batchId: stagedBatchRenewMatch[1],
        ownerId: mediaOwnerId(authSession)
      });
      const items = await mediaStaging.listBatch({
        batchId: stagedBatchRenewMatch[1],
        ownerId: mediaOwnerId(authSession)
      });
      sendJson(res, 200, { ...renewed, items, usage: await mediaStaging.usage() });
      return;
    }

    const stagedPreviewMatch = pathname.match(/^\/api\/admin\/media\/staging\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})\/([a-f0-9]{64})\/preview$/u);
    if (stagedPreviewMatch && req.method === 'GET') {
      const staged = await mediaStaging.resolveForPromotion({
        batchId: stagedPreviewMatch[1],
        leaseId: stagedPreviewMatch[2],
        ownerId: mediaOwnerId(authSession)
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', staged.validation.mime);
      res.setHeader('Content-Length', String(staged.bytes.length));
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.end(staged.bytes);
      return;
    }

    const stagedLeaseMatch = pathname.match(/^\/api\/admin\/media\/staging\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})\/([a-f0-9]{64})$/u);
    if (stagedLeaseMatch && req.method === 'DELETE') {
      const result = await mediaStaging.cancel({
        batchId: stagedLeaseMatch[1],
        leaseId: stagedLeaseMatch[2],
        ownerId: mediaOwnerId(authSession)
      });
      sendJson(res, 200, result);
      return;
    }

    if (['/api/admin/project-media-upload', '/api/admin/upload'].includes(pathname) && req.method === 'POST') {
      sendJson(res, 410, {
        error: 'Старый прямой upload отключён. Используйте безопасную очередь медиа; файл станет постоянным только вместе с сохранением записи.',
        code: 'LEGACY_UPLOAD_DISABLED',
        replacement: '/api/admin/media/staging'
      });
      return;
    }

    if (pathname === '/api/admin/collections' && req.method === 'GET') {
      const collections = Object.entries(COLLECTIONS).map(([key, value]) => ({
        key,
        label: value.label
      }));
      sendJson(res, 200, { collections });
      return;
    }

    const matchList = pathname.match(/^\/api\/admin\/content\/([a-z0-9-]+)$/i);
    if (matchList && req.method === 'GET') {
      const [, collection] = matchList;
      const entries = await contentTransactions.withStableRead(() => listCollectionEntries(collection));
      sendJson(res, 200, { entries });
      return;
    }

    if (matchList && req.method === 'POST') {
      const [, collection] = matchList;
      const config = getCollectionConfig(collection);
      if (config.type === 'single-file') {
        sendJson(res, 400, { error: 'Для этой коллекции нельзя создавать новые записи' });
        return;
      }

      const body = await readBody(req);
      const baseRevision = requireBaseRevision(body?.baseRevision, { create: true });
      const content = body?.content && typeof body.content === 'object' && !Array.isArray(body.content)
        ? body.content
        : body;

      if (!content || typeof content !== 'object' || Array.isArray(content)) {
        sendJson(res, 400, { error: 'Ожидается JSON-объект' });
        return;
      }

      const slug = await validateDirectoryContentSlug(collection, {
        ...content,
        slug: body?.slug ?? content?.slug
      });
      const filePath = getDirectoryEntryPath(config, slug);

      try {
        await fs.access(filePath);
        sendJson(res, 409, { error: 'Запись с таким slug уже существует' });
        return;
      } catch {
        // file does not exist yet
      }

      const savedContent = validateContentForWrite(collection, { ...content, slug }, { operation: 'create' });
      const transaction = await applyCompatibilityTransaction(req, authSession, body, [...stagedPromotionOperations(body, authSession), {
        type: 'upsert-record', collection, slug, content: savedContent, baseRevision
      }], `Создание ${collection}:${slug}`);
      const saved = await contentTransactions.readRecord({ collection, slug });
      sendJson(res, 201, {
        ok: true,
        result: transaction.applied.state === 'no-op' ? 'noop' : 'saved',
        slug,
        content: saved.content,
        revision: saved.revision,
        schemaVersion: CONTENT_SCHEMA_VERSION,
        ...compatibilityTransactionReceipt(transaction)
      });
      return;
    }

    const matchEntry = pathname.match(/^\/api\/admin\/content\/([a-z0-9-]+)\/([a-z0-9-]+)$/i);
    if (matchEntry && req.method === 'GET') {
      const [, collection, slug] = matchEntry;
      const snapshot = await contentTransactions.readRecord({ collection, slug });
      sendJson(res, 200, {
        content: snapshot.content,
        revision: snapshot.revision,
        schemaVersion: CONTENT_SCHEMA_VERSION
      });
      return;
    }

    if (matchEntry && req.method === 'PUT') {
      const [, collection, slug] = matchEntry;
      const config = getCollectionConfig(collection);
      const filePath = await resolveJsonPath(collection, slug);
      const previousSnapshot = await contentTransactions.readRecord({ collection, slug });
      const previousContent = previousSnapshot.content;
      const requestBody = await readBody(req);
      const baseRevision = requireBaseRevision(requestBody?.baseRevision);
      const body = requestBody?.content && typeof requestBody.content === 'object' && !Array.isArray(requestBody.content)
        ? requestBody.content
        : requestBody;

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'Ожидается JSON-объект' });
        return;
      }

      const previousSlug = sanitizeSlug(previousContent?.slug ?? slug);
      const nextSlug = config.type === 'single-file'
        ? config.slug
        : await validateDirectoryContentSlug(collection, body, filePath, previousSlug);
      const contentForValidation = config.type === 'single-file' ? body : { ...body, slug: nextSlug };
      const savedContent = validateContentForWrite(collection, contentForValidation, { previous: previousContent, operation: 'update' });
      const operation = config.type !== 'single-file' && nextSlug !== previousSlug
        ? {
            type: 'rename-record', collection, slug: previousSlug, nextSlug,
            content: savedContent, baseRevision
          }
        : {
            type: 'upsert-record', collection, slug: config.type === 'single-file' ? config.slug : previousSlug,
            content: savedContent, baseRevision
          };
      const transaction = await applyCompatibilityTransaction(
        req,
        authSession,
        requestBody,
        [...stagedPromotionOperations(requestBody, authSession), operation],
        (nextSlug === previousSlug ? 'Обновление ' : 'Переименование ') + collection + ':' + previousSlug
      );
      const saved = await contentTransactions.readRecord({ collection, slug: nextSlug });
      sendJson(res, 200, {
        ok: true,
        result: transaction.applied.state === 'no-op' ? 'noop' : 'saved',
        previousSlug,
        slug: nextSlug,
        updatedProductCount: transaction.preview.diff?.filter((item) => item.entity?.collection === 'products').length || 0,
        content: saved.content,
        revision: saved.revision,
        schemaVersion: CONTENT_SCHEMA_VERSION,
        ...compatibilityTransactionReceipt(transaction)
      });
      return;
    }

    if (matchEntry && req.method === 'DELETE') {
      const [, collection, slug] = matchEntry;
      const config = getCollectionConfig(collection);
      if (config.type === 'single-file') {
        sendJson(res, 400, { error: 'Эту запись нельзя удалить' });
        return;
      }

      const body = await readBody(req);
      const baseRevision = requireBaseRevision(body?.baseRevision);
      const transaction = await applyCompatibilityTransaction(req, authSession, body, [{
        type: 'delete-record',
        collection,
        slug,
        baseRevision,
        relationPlan: body?.relationPlan
      }], `Удаление ${collection}:${slug}`);
      sendJson(res, 200, { ok: true, ...compatibilityTransactionReceipt(transaction) });
      return;
    }

    sendJson(res, 404, { error: 'Маршрут не найден' });
  } catch (error) {
    const message = error instanceof Error ? maskSecrets(error.message) : 'Неизвестная ошибка';
    const isProductionNotReady = error?.code === 'PRODUCTION_NOT_READY';
    const locked = new Set(['TRANSACTION_LOCKED', 'TRANSACTION_RECOVERY_REQUIRED']);
    const conflict = typeof error?.code === 'string' && (
      error.code.includes('REVISION')
      || error.code.includes('IDEMPOTENCY')
      || error.code.includes('TRANSACTION_BINDING')
      || error.code.includes('TRANSACTION_PAYLOAD')
      || error.code.includes('TRANSACTION_EXPIRED')
    );
    const status = locked.has(error?.code)
      ? 423
      : error?.status ?? (isProductionNotReady || conflict ? 409 : 400);
    sendJson(res, status, {
      error: message,
      code: error?.code || 'ADMIN_API_ERROR',
      ...(Array.isArray(error?.validationIssues) ? { validationIssues: error.validationIssues } : {}),
      ...(Array.isArray(error?.blockers) ? { blockers: error.blockers } : {}),
      ...(Array.isArray(error?.warnings) ? { warnings: error.warnings } : {}),
      ...(error?.details && typeof error.details === 'object' ? { details: error.details } : {}),
      ...(isProductionNotReady ? getPublishConfigPayload() : {})
    });
  }
});

server.listen(config.ADMIN_API_PORT, config.ADMIN_API_HOST, () => {
  console.log(`[admin-api] running on http://127.0.0.1:${config.ADMIN_API_PORT}/api/admin`);
  console.log(`[admin-api] CORS origins: ${config.ADMIN_ALLOWED_ORIGINS.join(', ')}`);
});

let shutdownStarted = false;
async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  clearInterval(mediaCleanupTimer);
  const forcedExit = setTimeout(() => process.exit(1), 5_000);
  forcedExit.unref?.();
  await new Promise((resolve) => server.close(resolve));
  const publishService = publishServiceInstance
    || (publishServicePromise ? await publishServicePromise.catch(() => null) : null);
  await publishService?.close();
  await writerLease.release();
  clearTimeout(forcedExit);
  process.exit(signal ? 0 : (process.exitCode || 0));
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
if (typeof process.send === 'function') {
  process.on('message', (message) => {
    if (isAdminShutdownMessage(message, adminRepoIdentity)) void shutdown('IPC');
  });
  process.once('disconnect', () => { void shutdown('IPC_DISCONNECT'); });
}

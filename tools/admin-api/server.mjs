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
import {
  MAX_PROJECT_MEDIA_REQUEST_SIZE,
  parseMultipartFiles,
  saveProjectMediaFiles
} from './project-media.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
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
const UPLOADS_DIR = path.join(repoRoot, 'public', 'uploads');
const MAX_IMAGE_UPLOAD_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_SIZE = 90 * 1024 * 1024;
const MAX_UPLOAD_SIZE = MAX_VIDEO_UPLOAD_SIZE;
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);
const ALLOWED_EXTENSIONS = new Set([...ALLOWED_IMAGE_EXTENSIONS, ...ALLOWED_VIDEO_EXTENSIONS]);
const PUBLISH_PATHS = ['src/content', 'src/data/navigation.json', 'public/uploads'];
const FULL_PUBLISH_PATHS = [
  '.gitignore',
  '.github',
  '.pages.yml',
  'AGENTS.md',
  'README.md',
  'astro.config.mjs',
  'docs',
  'package.json',
  'package-lock.json',
  'public',
  'src',
  'tools',
  'tsconfig.json'
];
const DEPLOY_TARGETS = new Set(['test', 'production']);
const MAX_JSON_IMPORT_BODY_SIZE = 12 * 1024 * 1024;
const API_CAPABILITIES = { contentJson: 1, contentBundles: 1 };
const CONTENT_SCHEMA_VERSION = 'h6-content-v1';
const REPORT_LOG_LINES = 200;
const DEFAULT_PREVIEW_BRANCH = 'preview';
const DEFAULT_PRODUCTION_BRANCH = 'main';

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

function sendTextAttachment(res, statusCode, text, filename) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.end(text);
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

async function existingGitPathspecs(paths) {
  const result = [];
  for (const relativePath of paths) {
    try {
      await fs.access(path.join(repoRoot, relativePath));
      result.push(relativePath);
    } catch {
      try {
        await runGit(['ls-files', '--error-unmatch', relativePath]);
        result.push(relativePath);
      } catch {
        // optional path
      }
    }
  }
  return result;
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
  const productionBranch = safeBranchName(config.ADMIN_PRODUCTION_BRANCH, DEFAULT_PRODUCTION_BRANCH);
  const previewCandidate = safeBranchName(config.ADMIN_PREVIEW_BRANCH, DEFAULT_PREVIEW_BRANCH);
  const previewBranch = isProductionBranch(previewCandidate, productionBranch) ? DEFAULT_PREVIEW_BRANCH : previewCandidate;
  const productionDeployEnabled = isProductionDeployEnabled();
  const siteUrlConfigured = isSiteUrlConfigured();
  return {
    productionDeployEnabled,
    siteUrlConfigured,
    productionReady: productionDeployEnabled && siteUrlConfigured,
    previewBranch,
    productionBranch
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

function buildPublishMessage(scope = 'content', target = 'test') {
  const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const prefix = target === 'production' ? 'production' : 'preview';
  return `${prefix}: update from local admin (${scope}, ${timestamp})`;
}

async function getCurrentBranch() {
  await runGit(['rev-parse', '--is-inside-work-tree']);
  return (await runGit(['branch', '--show-current'])).stdout || 'HEAD';
}

async function publishPaths(paths, scope, options = {}) {
  const target = normalizeDeployTarget(options.target);
  if (target === 'production') assertProductionReady();

  const sourceBranch = await getCurrentBranch();
  const branch = getPublishBranch(target);
  const ref = `refs/heads/${branch}`;
  const publishConfig = getPublishConfigPayload();
  const requestedTarget = options.target === undefined || options.target === null || String(options.target).trim() === ''
    ? 'test'
    : String(options.target).trim();
  const publishSource = String(options.source || '').trim();
  const pathspecs = await existingGitPathspecs(paths);
  if (!pathspecs.length) {
    return { published: false, target, mode: target, requestedTarget, publishSource, branch, ref, sourceBranch, ...publishConfig, message: 'Нет путей для публикации.' };
  }

  await runGit(['add', '--', ...pathspecs]);

  try {
    await runGit(['diff', '--cached', '--quiet', '--', ...pathspecs]);
    return { published: false, target, mode: target, requestedTarget, publishSource, branch, ref, sourceBranch, ...publishConfig, message: 'Нет изменений для публикации.' };
  } catch {
    // git diff --quiet exits with 1 when there are staged changes.
  }

  const commitMessage = buildPublishMessage(scope, target);
  await runGit(['commit', '-m', commitMessage, '--', ...pathspecs]);
  const commit = (await runGit(['rev-parse', '--short', 'HEAD'])).stdout;
  const commitSha = (await runGit(['rev-parse', 'HEAD'])).stdout;
  const remote = safeBranchName(config.ADMIN_GIT_REMOTE, 'origin');
  await runGit(['push', remote, `HEAD:${ref}`]);
  const githubInfo = await buildGitHubPublicationInfo(branch, commitSha, target).catch((error) => ({
    statusError: error instanceof Error ? error.message : 'Не удалось получить статус GitHub Actions.'
  }));

  return {
    published: true,
    target,
    mode: target,
    requestedTarget,
    publishSource,
    branch,
    ref,
    sourceBranch,
    commit,
    commitSha,
    commitMessage,
    ...publishConfig,
    ...githubInfo,
    message: target === 'production'
      ? `Опубликовано в GitHub: ${commit}. Production build запущен для ветки ${branch}.`
      : `Опубликовано в GitHub: ${commit}. Тестовая сборка запущена для ветки ${branch}.`
  };
}

async function publishContentChanges(options = {}) {
  return publishPaths(PUBLISH_PATHS, 'content', options);
}

async function publishWholeSiteChanges(options = {}) {
  return publishPaths(FULL_PUBLISH_PATHS, 'site', options);
}

function parseGitHubRemote(value = '') {
  const remote = String(value).trim();
  const httpsMatch = remote.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = remote.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}

async function getGitHubRepository() {
  const configured = String(config.GITHUB_REPOSITORY || '').trim();
  if (configured.includes('/')) {
    const [owner, repo] = configured.split('/');
    if (owner && repo) return { owner, repo: repo.replace(/\.git$/i, '') };
  }

  const remoteName = safeBranchName(config.ADMIN_GIT_REMOTE, 'origin');
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
  const repository = await getGitHubRepository();
  if (!repository) {
    throw new Error('Не удалось определить GitHub repository. Укажите GITHUB_REPOSITORY=owner/repo.');
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers || {})
  };
  const token = getGitHubToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}${pathname}`, {
    ...options,
    headers
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

function slugifyFilename(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'media';
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

function parseMultipartFile(buffer, contentType) {
  const boundaryMatch = String(contentType || '').match(/boundary=([^;]+)/i);
  if (!boundaryMatch) throw new Error('Некорректный multipart/form-data');
  const boundary = boundaryMatch[1];
  const delimiter = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(delimiter);
  while (start !== -1) {
    const next = buffer.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = buffer.slice(start + delimiter.length + 2, next - 2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      if (headers.includes('name="file"')) {
        const fileNameMatch = headers.match(/filename="([^"]*)"/i);
        const filename = fileNameMatch ? fileNameMatch[1] : 'upload.bin';
        const fileBuffer = part.slice(headerEnd + 4);
        return { filename, fileBuffer };
      }
    }
    start = next;
  }
  throw new Error('Файл не найден в multipart-запросе');
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
          mode: json.mode ?? null
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
        mode: json.mode ?? null
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
  const preview = await contentTransactions.preview({
    ...context,
    operations,
    metadata: { userSummary }
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

const { config } = await loadAdminConfig({ repoRoot });
assertSecureOperation(config, 'startup');
const allowedHosts = [`${config.ADMIN_API_HOST}:${config.ADMIN_API_PORT}`];
const requestPolicy = createLocalRequestPolicy({
  allowedOrigins: config.ADMIN_ALLOWED_ORIGINS,
  allowedHosts,
  allowIpv6: config.ADMIN_ALLOW_IPV6_LOOPBACK === true,
  allowLocalhost: false
});
const sessions = new SessionStore({ secret: config.SESSION_SECRET });
const loginLimiter = new LoginLimiter({ secret: config.SESSION_SECRET });
const contentTransactions = createContentTransactionService({
  repoRoot: transactionRepoRoot,
  runtimeDir: path.join(transactionRepoRoot, '.admin-runtime', 'content-transactions'),
  collections: COLLECTIONS,
  singletons: TRANSACTION_SINGLETONS
});
await contentTransactions.initialize();
const contentJson = createContentJsonService({
  repoRoot,
  collections: COLLECTIONS,
  singletons: DATA_SINGLETONS,
  transactionService: contentTransactions
});

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
    if (MUTATING_METHODS.has(String(req.method || '').toUpperCase())) {
      assertCsrf(req, authSession.csrfToken);
    }
    const authUser = authSession.username;

    if (pathname === '/api/admin/transactions/preview' && req.method === 'POST') {
      const body = await readBody(req, MAX_JSON_IMPORT_BODY_SIZE);
      const preview = await contentTransactions.preview({
        ...transactionContext(req, authSession, body),
        operations: body?.operations,
        baseHead: body?.baseHead,
        metadata: {
          userSummary: body?.userSummary || body?.metadata?.userSummary || 'Изменение контента',
          ...(body?.baseHead ? { baseHead: body.baseHead } : {})
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
      const preview = await contentTransactions.previewRestore({
        ...transactionContext(req, authSession, body),
        sourceTransactionId: restorePreviewMatch[1],
        metadata: { userSummary: body?.userSummary || `Восстановление ${restorePreviewMatch[1]}` }
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
        transactionId: transaction.preview.transactionId
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
      const preview = await contentJson.preview({
        ...context,
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

    if (pathname === '/api/admin/publish' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await contentTransactions.withStableRead(() => publishContentChanges({ target: body?.target, source: body?.source }));
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/api/admin/publish-all' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await contentTransactions.withStableRead(() => publishWholeSiteChanges({ target: body?.target, source: body?.source }));
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/api/admin/publish-status' && req.method === 'GET') {
      const status = await contentTransactions.withStableRead(() => getPublishStatus({
        target: url.searchParams.get('target'),
        branch: url.searchParams.get('branch'),
        commitSha: url.searchParams.get('commitSha') || url.searchParams.get('commit'),
        runId: url.searchParams.get('runId')
      }));
      sendJson(res, 200, { ok: true, ...status });
      return;
    }

    if (pathname === '/api/admin/publish-report' && req.method === 'GET') {
      const params = {
        target: url.searchParams.get('target'),
        branch: url.searchParams.get('branch'),
        commitSha: url.searchParams.get('commitSha') || url.searchParams.get('commit'),
        commitMessage: url.searchParams.get('commitMessage'),
        runId: url.searchParams.get('runId'),
        requestedTarget: url.searchParams.get('requestedTarget'),
        publishSource: url.searchParams.get('publishSource'),
        ref: url.searchParams.get('ref')
      };
      const status = await contentTransactions.withStableRead(() => getPublishStatus(params)).catch((error) => ({
        target: normalizeDeployTarget(params.target),
        branch: params.branch || '',
        commitSha: params.commitSha || '',
        status: 'failure',
        statusError: error instanceof Error ? error.message : 'Не удалось получить статус GitHub Actions.'
      }));
      const filename = `smu1-publish-report-${new Date().toISOString().slice(0, 10)}.txt`;
      sendTextAttachment(res, 200, buildPublishReport(status, params), filename);
      return;
    }

    if (pathname === '/api/admin/project-media-upload' && req.method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      if (!String(contentType).includes('multipart/form-data')) {
        sendJson(res, 400, { error: 'Ожидается multipart/form-data' });
        return;
      }
      const raw = await readRawBody(req, MAX_PROJECT_MEDIA_REQUEST_SIZE + 1024 * 1024);
      const parts = parseMultipartFiles(raw, contentType);
      const result = await saveProjectMediaFiles(parts, { uploadsDir: UPLOADS_DIR });
      sendJson(res, result.files.length ? 200 : 400, {
        ok: result.files.length > 0,
        files: result.files,
        errors: result.errors,
        ...(result.files.length ? {} : { error: result.errors.map((item) => `${item.name}: ${item.error}`).join('; ') || 'Файлы не загружены' })
      });
      return;
    }

    if (pathname === '/api/admin/upload' && req.method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      if (!String(contentType).includes('multipart/form-data')) {
        sendJson(res, 400, { error: 'Ожидается multipart/form-data' });
        return;
      }

      const raw = await readRawBody(req);
      const { filename, fileBuffer } = parseMultipartFile(raw, contentType);
      if (!fileBuffer?.length) {
        sendJson(res, 400, { error: 'Пустой файл' });
        return;
      }

      const ext = path.extname(filename).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        sendJson(res, 400, { error: 'Разрешены только jpg, jpeg, png, webp, svg, mp4, webm' });
        return;
      }

      const isVideo = ALLOWED_VIDEO_EXTENSIONS.has(ext);
      const maxFileSize = isVideo ? MAX_VIDEO_UPLOAD_SIZE : MAX_IMAGE_UPLOAD_SIZE;
      if (fileBuffer.length > maxFileSize) {
        sendJson(res, 400, { error: `Файл слишком большой. Максимум для ${isVideo ? 'видео' : 'фото'} ${formatUploadLimit(maxFileSize)} MB.` });
        return;
      }

      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      const baseName = slugifyFilename(path.basename(filename, ext));
      const safeName = `${baseName}-${Date.now()}${ext}`;
      const filePath = path.join(UPLOADS_DIR, safeName);
      await fs.writeFile(filePath, fileBuffer);
      sendJson(res, 200, { path: `/uploads/${safeName}`, type: isVideo ? 'video' : 'image' });
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
      const transaction = await applyCompatibilityTransaction(req, authSession, body, [{
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
        transactionId: transaction.preview.transactionId
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
        [operation],
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
        transactionId: transaction.preview.transactionId
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
      sendJson(res, 200, { ok: true, transactionId: transaction.preview.transactionId });
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

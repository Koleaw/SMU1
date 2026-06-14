import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const execFileAsync = promisify(execFile);

const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROUTE_SLUG_COLLECTIONS = new Set(['static-pages', 'product-sections', 'services']);
const LOCKED_STATIC_PAGE_SLUGS = new Set(['home', 'custom-order']);
const RESERVED_TOP_LEVEL_SLUGS = new Set(['admin', 'izgotovlenie-na-zakaz', '404']);
const DEV_DEFAULTS = {
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'admin',
  SESSION_SECRET: 'dev-session-secret-change-me',
  ADMIN_API_PORT: '8787',
  ADMIN_ALLOWED_ORIGIN: '',
  CONTENT_WRITE_MODE: 'local',
  ADMIN_PREVIEW_BRANCH: 'preview',
  ADMIN_PRODUCTION_BRANCH: 'main',
  ADMIN_DEFAULT_DEPLOY_TARGET: 'test',
  ADMIN_GIT_REMOTE: 'origin',
  ADMIN_ALLOW_PRODUCTION_PUBLISH: 'false',
  SITE_URL: '',
  TEST_SITE_URL: '',
  GITHUB_REPOSITORY: '',
  GITHUB_TOKEN: '',
  GITHUB_DEPLOY_TOKEN: ''
};

const COLLECTIONS = {
  'product-sections': {
    label: 'Страницы каталога',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/product-sections')
  },
  services: {
    label: 'Проектные страницы',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/services')
  },
  'product-categories': {
    label: 'Подстраницы каталога',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/product-categories')
  },
  products: {
    label: 'Товары каталога',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/products')
  },
  projects: {
    label: 'Выполненные объекты',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/projects')
  },
  jobs: {
    label: 'Вакансии',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/jobs')
  },
  'site-settings': {
    label: 'Настройки сайта',
    type: 'single-file',
    path: path.join(repoRoot, 'src/content/site-settings/global.json'),
    slug: 'global'
  },
  'static-pages': {
    label: 'Страницы',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/static-pages')
  }
};

const sessions = new Map();
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
const PRODUCTION_NOT_READY_MESSAGE = 'Боевой домен пока не настроен. Используйте тестовую публикацию.';
const REPORT_LOG_LINES = 200;
const DEFAULT_PREVIEW_BRANCH = 'preview';
const DEFAULT_PRODUCTION_BRANCH = 'main';

function formatUploadLimit(bytes) {
  return Math.round(bytes / (1024 * 1024));
}

function parseEnvText(source = '') {
  const lines = source.split(/\r?\n/);
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['\"]|['\"]$/g, '');
    result[key] = value;
  }
  return result;
}

async function loadEnvConfig() {
  const files = ['.env.local', '.env.admin.local'];
  const merged = {};

  for (const filename of files) {
    const fullPath = path.join(repoRoot, filename);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      Object.assign(merged, parseEnvText(content));
    } catch {
      // optional env file
    }
  }
  Object.assign(merged, Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === 'string' && value.length > 0)
  ));

  let usingDevCredentials = false;
  const config = {
    ADMIN_USERNAME: merged.ADMIN_USERNAME ?? DEV_DEFAULTS.ADMIN_USERNAME,
    ADMIN_PASSWORD: merged.ADMIN_PASSWORD ?? DEV_DEFAULTS.ADMIN_PASSWORD,
    SESSION_SECRET: merged.SESSION_SECRET ?? DEV_DEFAULTS.SESSION_SECRET,
    ADMIN_API_PORT: Number(merged.ADMIN_API_PORT ?? DEV_DEFAULTS.ADMIN_API_PORT),
    ADMIN_ALLOWED_ORIGIN: merged.ADMIN_ALLOWED_ORIGIN ?? DEV_DEFAULTS.ADMIN_ALLOWED_ORIGIN,
    CONTENT_WRITE_MODE: merged.CONTENT_WRITE_MODE ?? DEV_DEFAULTS.CONTENT_WRITE_MODE,
    ADMIN_PREVIEW_BRANCH: merged.ADMIN_PREVIEW_BRANCH ?? DEV_DEFAULTS.ADMIN_PREVIEW_BRANCH,
    ADMIN_PRODUCTION_BRANCH: merged.ADMIN_PRODUCTION_BRANCH ?? DEV_DEFAULTS.ADMIN_PRODUCTION_BRANCH,
    ADMIN_DEFAULT_DEPLOY_TARGET: merged.ADMIN_DEFAULT_DEPLOY_TARGET ?? DEV_DEFAULTS.ADMIN_DEFAULT_DEPLOY_TARGET,
    ADMIN_GIT_REMOTE: merged.ADMIN_GIT_REMOTE ?? DEV_DEFAULTS.ADMIN_GIT_REMOTE,
    ADMIN_ALLOW_PRODUCTION_PUBLISH: merged.ADMIN_ALLOW_PRODUCTION_PUBLISH ?? DEV_DEFAULTS.ADMIN_ALLOW_PRODUCTION_PUBLISH,
    SITE_URL: merged.SITE_URL ?? DEV_DEFAULTS.SITE_URL,
    TEST_SITE_URL: merged.TEST_SITE_URL ?? DEV_DEFAULTS.TEST_SITE_URL,
    GITHUB_REPOSITORY: merged.GITHUB_REPOSITORY ?? DEV_DEFAULTS.GITHUB_REPOSITORY,
    GITHUB_TOKEN: merged.GITHUB_TOKEN ?? DEV_DEFAULTS.GITHUB_TOKEN,
    GITHUB_DEPLOY_TOKEN: merged.GITHUB_DEPLOY_TOKEN ?? DEV_DEFAULTS.GITHUB_DEPLOY_TOKEN
  };

  if (!merged.ADMIN_USERNAME || !merged.ADMIN_PASSWORD || !merged.SESSION_SECRET) {
    usingDevCredentials = true;
  }

  return { config, usingDevCredentials };
}

function parseCookies(request) {
  const header = request.headers.cookie;
  if (!header) return {};

  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((pair) => {
        const [key, ...rest] = pair.split('=');
        return [key, decodeURIComponent(rest.join('='))];
      })
  );
}

function buildAllowedOrigins(extraOrigin) {
  const defaults = new Set(['http://localhost:4321', 'http://127.0.0.1:4321']);
  const normalizedExtraOrigin = String(extraOrigin ?? '').trim();
  if (normalizedExtraOrigin) {
    defaults.add(normalizedExtraOrigin);
  }
  return defaults;
}

function setCorsHeaders(req, res, allowedOrigins) {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
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
  const target = String(value || config?.ADMIN_DEFAULT_DEPLOY_TARGET || 'test').trim().toLowerCase();
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

function isProductionBranch(branch, productionBranch = config?.ADMIN_PRODUCTION_BRANCH) {
  const key = branchKey(branch);
  const productionKey = branchKey(productionBranch || DEFAULT_PRODUCTION_BRANCH);
  return key === productionKey || key === 'main' || key === 'master';
}

function inferWorkflowDeployTarget(event, branch, requestedTarget = 'test') {
  if (event === 'workflow_dispatch') return normalizeDeployTarget(requestedTarget);
  return isProductionBranch(branch) ? 'production' : 'test';
}

function getPublishBranch(target) {
  const productionBranch = safeBranchName(config.ADMIN_PRODUCTION_BRANCH, DEFAULT_PRODUCTION_BRANCH);
  if (target === 'production') return productionBranch;

  const previewBranch = safeBranchName(config.ADMIN_PREVIEW_BRANCH, DEFAULT_PREVIEW_BRANCH);
  return isProductionBranch(previewBranch, productionBranch) ? DEFAULT_PREVIEW_BRANCH : previewBranch;
}

function assertProductionReady() {
  if (config.ADMIN_ALLOW_PRODUCTION_PUBLISH === 'true') return;
  if (String(config.SITE_URL || '').trim()) return;
  const error = new Error(PRODUCTION_NOT_READY_MESSAGE);
  error.code = 'PRODUCTION_NOT_READY';
  throw error;
}

function buildPublishMessage(scope = 'content', target = 'test') {
  const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return `${scope}: ${target} publish from local admin (${timestamp})`;
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
  const pathspecs = await existingGitPathspecs(paths);
  if (!pathspecs.length) {
    return { published: false, target, mode: target, branch, sourceBranch, message: 'Нет путей для публикации.' };
  }

  await runGit(['add', '-A', '--', ...pathspecs]);

  try {
    await runGit(['diff', '--cached', '--quiet', '--', ...pathspecs]);
    return { published: false, target, mode: target, branch, sourceBranch, message: 'Нет изменений для публикации.' };
  } catch {
    // git diff --quiet exits with 1 when there are staged changes.
  }

  const commitMessage = buildPublishMessage(scope, target);
  await runGit(['commit', '-m', commitMessage, '--', ...pathspecs]);
  const commit = (await runGit(['rev-parse', '--short', 'HEAD'])).stdout;
  const commitSha = (await runGit(['rev-parse', 'HEAD'])).stdout;
  const remote = safeBranchName(config.ADMIN_GIT_REMOTE, 'origin');
  await runGit(['push', remote, `HEAD:refs/heads/${branch}`]);
  const githubInfo = await buildGitHubPublicationInfo(branch, commitSha, target).catch((error) => ({
    statusError: error instanceof Error ? error.message : 'Не удалось получить статус GitHub Actions.'
  }));

  return {
    published: true,
    target,
    mode: target,
    branch,
    sourceBranch,
    commit,
    commitSha,
    commitMessage,
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
  return {
    commitUrl,
    workflowRunId: run?.id ?? null,
    workflowRunUrl: run?.html_url ?? '',
    workflowEvent,
    workflowBranch,
    workflowDeployTarget: inferWorkflowDeployTarget(workflowEvent, workflowBranch, target),
    productionCheckRan: inferWorkflowDeployTarget(workflowEvent, workflowBranch, target) === 'production',
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
      nextStep: 'Для текущей стадии используйте тестовую публикацию в ветку preview. Для боевой публикации задайте SITE_URL после подключения домена/хостинга.'
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
    return {
      target,
      mode: target,
      branch,
      commitSha,
      runId: runId || null,
      commitUrl: resolvedCommitUrl,
      workflowEvent: '',
      workflowBranch: branch,
      workflowDeployTarget: inferWorkflowDeployTarget('', branch, target),
      productionCheckRan: inferWorkflowDeployTarget('', branch, target) === 'production',
      status: 'queued',
      statusError: run?.statusLookupError || 'GitHub Actions run еще не найден. Повторите проверку через несколько секунд.'
    };
  }

  const status = normalizeRunStatus(run);
  const failureDetails = status === 'failure' ? await fetchRunFailureDetails(run.id) : {};
  const workflowEvent = run.event || '';
  const workflowBranch = run.head_branch || branch;
  const workflowDeployTarget = inferWorkflowDeployTarget(workflowEvent, workflowBranch, target);
  const failureInfo = status === 'failure'
    ? explainFailure(failureDetails.logTail, '', { target, branch, workflowEvent, workflowBranch, workflowDeployTarget })
    : {};
  return {
    target,
    mode: target,
    branch,
    commitSha: run.head_sha || commitSha,
    commit: (run.head_sha || commitSha).slice(0, 7),
    commitUrl: repository && (run.head_sha || commitSha)
      ? `https://github.com/${repository.owner}/${repository.repo}/commit/${run.head_sha || commitSha}`
      : resolvedCommitUrl,
    workflowRunId: run.id,
    workflowRunUrl: run.html_url || '',
    workflowEvent,
    workflowBranch,
    workflowDeployTarget,
    productionCheckRan: workflowDeployTarget === 'production',
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
  const lines = [
    'SMU-1 publish/build error report',
    '',
    `Дата и время: ${now}`,
    `Режим публикации: ${target}`,
    `Branch: ${params.branch || status.branch || ''}`,
    `Commit hash: ${params.commitSha || status.commitSha || params.commit || ''}`,
    `Commit message: ${params.commitMessage || status.commitMessage || ''}`,
    `Workflow event: ${status.workflowEvent || params.workflowEvent || ''}`,
    `Workflow branch: ${status.workflowBranch || params.workflowBranch || params.branch || status.branch || ''}`,
    `Deploy target from workflow: ${status.workflowDeployTarget || params.workflowDeployTarget || target}`,
    `Check production settings ran: ${status.productionCheckRan ? 'yes' : 'no'}`,
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
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
        reject(new Error(`Файл слишком большой. Максимум ${formatUploadLimit(MAX_UPLOAD_SIZE)} MB.`));
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

function normalizeOrderItems(items) {
  if (!Array.isArray(items)) return items;
  return items.map((item, index) => {
    if (item && typeof item === 'object' && !Array.isArray(item) && 'order' in item) {
      return { ...item, order: (index + 1) * 10 };
    }
    return item;
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

const PRESENTATION_FIELD_KEYS = new Set([
  'heroTitleStyle',
  'heroDescriptionStyle',
  'heroLayout',
  'descriptionTextStyle',
  'descriptionLayout',
  'titleStyle',
  'textStyle',
  'layout',
  'fontSize',
  'fontWeight',
  'italic',
  'align',
  'textAlign',
  'lineHeight',
  'color',
  'textColor',
  'width',
  'widthPercent',
  'maxWidth',
  'position',
  'padding',
  'verticalPadding',
  'sectionSpacing',
  'textBlockWidth',
  'textWidth',
  'textSize',
  'titleSize',
  'textWeight',
  'textItalic'
]);

function stripPresentationFields(value, options = {}) {
  const { removeEmpty = false } = options;
  if (Array.isArray(value)) {
    const items = value
      .map((item) => stripPresentationFields(item, options))
      .filter((item) => item !== undefined);
    return removeEmpty && !items.length ? undefined : items;
  }
  if (!value || typeof value !== 'object') {
    if (removeEmpty && (value === undefined || value === null || value === '')) return undefined;
    return value;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (PRESENTATION_FIELD_KEYS.has(key)) continue;
    const nextValue = stripPresentationFields(item, options);
    if (nextValue === undefined) continue;
    if (removeEmpty && Array.isArray(nextValue) && !nextValue.length) continue;
    if (removeEmpty && nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue) && !Object.keys(nextValue).length) continue;
    result[key] = nextValue;
  }
  return removeEmpty && !Object.keys(result).length ? undefined : result;
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
    .map((entry) => stripPresentationFields({ ...entry.json, slug: getEntrySlug(entry) }, { removeEmpty: true }))
    .filter(Boolean)
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
    catalogPages
  };
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

async function updateProductsCategorySlug(previousSlug, nextSlug) {
  if (previousSlug === nextSlug) return 0;

  const entries = await listJsonEntries('products');
  let updatedCount = 0;
  for (const entry of entries) {
    if (entry.json?.productCategorySlug !== previousSlug) continue;
    const updated = { ...entry.json, productCategorySlug: nextSlug };
    await fs.writeFile(entry.filePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    updatedCount += 1;
  }
  return updatedCount;
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

function getAuthUser(req) {
  const cookies = parseCookies(req);
  const token = cookies['admin_session'];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  return session.username;
}

function requireAuth(req, res) {
  const username = getAuthUser(req);
  if (!username) {
    sendJson(res, 401, { error: 'Требуется авторизация' });
    return null;
  }
  return username;
}

function buildSessionToken(secret, username) {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${username}:${randomPart}`)
    .digest('hex');
  return `${randomPart}.${signature}`;
}

function writeSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

const { config, usingDevCredentials } = await loadEnvConfig();
const allowedOrigins = buildAllowedOrigins(config.ADMIN_ALLOWED_ORIGIN);

if (usingDevCredentials) {
  console.warn('[admin-api] WARNING: используются dev credentials (admin/admin). Добавьте .env.local или .env.admin.local');
}

if (config.CONTENT_WRITE_MODE !== 'local') {
  console.warn(`[admin-api] WARNING: CONTENT_WRITE_MODE=${config.CONTENT_WRITE_MODE}. Stage 1 поддерживает только local.`);
}

const server = http.createServer(async (req, res) => {
  try {
    setCorsHeaders(req, res, allowedOrigins);

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

      if (username !== config.ADMIN_USERNAME || password !== config.ADMIN_PASSWORD) {
        sendJson(res, 401, { error: 'Неверный логин или пароль' });
        return;
      }

      const token = buildSessionToken(config.SESSION_SECRET, username);
      sessions.set(token, { username, createdAt: Date.now() });
      writeSessionCookie(res, token);
      sendJson(res, 200, { ok: true, username });
      return;
    }

    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      const cookies = parseCookies(req);
      const token = cookies.admin_session;
      if (token) sessions.delete(token);
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/admin/me' && req.method === 'GET') {
      const username = getAuthUser(req);
      if (!username) {
        sendJson(res, 200, { authenticated: false });
        return;
      }
      sendJson(res, 200, { authenticated: true, username });
      return;
    }

    if (!requireAuth(req, res)) {
      return;
    }

    if (pathname === '/api/admin/navigation' && req.method === 'GET') {
      const items = await readNavigationItems();
      sendJson(res, 200, { items });
      return;
    }

    if (pathname === '/api/admin/navigation' && req.method === 'PUT') {
      const body = await readBody(req);
      const items = normalizeNavigationItems(body?.items ?? body);
      await fs.mkdir(path.dirname(NAVIGATION_PATH), { recursive: true });
      await fs.writeFile(NAVIGATION_PATH, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
      const saved = await readNavigationItems();
      sendJson(res, 200, { ok: true, items: saved });
      return;
    }

    if (pathname === '/api/admin/export-catalog' && req.method === 'GET') {
      const exportedAt = new Date();
      const payload = await buildCatalogExport();
      const filename = `smu1-catalog-export-${exportedAt.toISOString().slice(0, 10)}.json`;
      sendPrettyJson(res, 200, payload, filename);
      return;
    }

    if (pathname === '/api/admin/publish' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await publishContentChanges({ target: body?.target });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/api/admin/publish-all' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await publishWholeSiteChanges({ target: body?.target });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/api/admin/publish-status' && req.method === 'GET') {
      const status = await getPublishStatus({
        target: url.searchParams.get('target'),
        branch: url.searchParams.get('branch'),
        commitSha: url.searchParams.get('commitSha') || url.searchParams.get('commit'),
        runId: url.searchParams.get('runId')
      });
      sendJson(res, 200, { ok: true, ...status });
      return;
    }

    if (pathname === '/api/admin/publish-report' && req.method === 'GET') {
      const params = {
        target: url.searchParams.get('target'),
        branch: url.searchParams.get('branch'),
        commitSha: url.searchParams.get('commitSha') || url.searchParams.get('commit'),
        commitMessage: url.searchParams.get('commitMessage'),
        runId: url.searchParams.get('runId')
      };
      const status = await getPublishStatus(params).catch((error) => ({
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
      const entries = await listCollectionEntries(collection);
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
      const content = stripPresentationFields(
        body?.content && typeof body.content === 'object' && !Array.isArray(body.content)
          ? body.content
          : body
      );

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

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify({ ...content, slug }, null, 2)}\n`, 'utf8');
      const saved = await readJsonFile(filePath);
      sendJson(res, 201, { ok: true, slug, content: saved });
      return;
    }

    const matchEntry = pathname.match(/^\/api\/admin\/content\/([a-z0-9-]+)\/([a-z0-9-]+)$/i);
    if (matchEntry && req.method === 'GET') {
      const [, collection, slug] = matchEntry;
      const filePath = await resolveJsonPath(collection, slug);
      const content = await readJsonFile(filePath);
      sendJson(res, 200, { content });
      return;
    }

    if (matchEntry && req.method === 'PUT') {
      const [, collection, slug] = matchEntry;
      const config = getCollectionConfig(collection);
      const filePath = await resolveJsonPath(collection, slug);
      const previousContent = await readJsonFile(filePath);
      const body = stripPresentationFields(await readBody(req));

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'Ожидается JSON-объект' });
        return;
      }

      if (config.type === 'single-file') {
        await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
        const saved = await readJsonFile(filePath);
        sendJson(res, 200, { ok: true, content: saved });
        return;
      }

      const previousSlug = sanitizeSlug(previousContent?.slug ?? slug);
      const nextSlug = await validateDirectoryContentSlug(collection, body, filePath, previousSlug);
      const savedContent = { ...body, slug: nextSlug };
      const nextPath = getDirectoryEntryPath(config, nextSlug);

      if (!isSamePath(filePath, nextPath)) {
        try {
          await fs.access(nextPath);
          sendJson(res, 409, { error: 'Запись с таким slug уже существует' });
          return;
        } catch {
          // target file does not exist yet
        }
        await fs.writeFile(nextPath, `${JSON.stringify(savedContent, null, 2)}\n`, 'utf8');
        await fs.unlink(filePath);
      } else {
        await fs.writeFile(filePath, `${JSON.stringify(savedContent, null, 2)}\n`, 'utf8');
      }

      const updatedProductCount = collection === 'product-categories'
        ? await updateProductsCategorySlug(previousSlug, nextSlug)
        : 0;
      const saved = await readJsonFile(nextPath);
      sendJson(res, 200, { ok: true, content: saved, previousSlug, slug: nextSlug, updatedProductCount });
      return;
    }

    if (matchEntry && req.method === 'DELETE') {
      const [, collection, slug] = matchEntry;
      const config = getCollectionConfig(collection);
      if (config.type === 'single-file') {
        sendJson(res, 400, { error: 'Эту запись нельзя удалить' });
        return;
      }

      const filePath = await resolveJsonPath(collection, slug);
      await fs.unlink(filePath);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: 'Маршрут не найден' });
  } catch (error) {
    const message = error instanceof Error ? maskSecrets(error.message) : 'Неизвестная ошибка';
    sendJson(res, error?.code === 'PRODUCTION_NOT_READY' ? 409 : 400, {
      error: message,
      code: error?.code || 'ADMIN_API_ERROR'
    });
  }
});

server.listen(config.ADMIN_API_PORT, () => {
  console.log(`[admin-api] running on http://127.0.0.1:${config.ADMIN_API_PORT}/api/admin`);
  console.log(`[admin-api] CORS origins: ${Array.from(allowedOrigins).join(', ')}`);
});

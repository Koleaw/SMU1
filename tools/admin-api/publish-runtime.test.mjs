import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONTENT_ONLY_GATES,
  fingerprintPublishPlan,
  hashPublishBytes,
} from './publish-planner.mjs';
import {
  PublishRuntimeError,
  createContentPublishGateRunner,
  createGitHubPublishProviders,
} from './publish-runtime.mjs';
import {
  parseReleaseIdentityBytes,
  readAndVerifyReleaseIdentity,
  serializeReleaseIdentity,
  writeReleaseIdentity,
} from '../release/artifact-identity.mjs';

const BASE_SHA = '1'.repeat(40);
const TESTED_SHA = '2'.repeat(40);
const PROTECTED_SHA = '3'.repeat(40);
const NAVIGATION_PATH = 'src/data/navigation.json';

function artifactIdentity(overrides = {}) {
  const marker = {
    version: 1,
    kind: 'smu1-release-artifact-identity',
    testedCommitSha: TESTED_SHA,
    artifactManifestSha256: 'a'.repeat(64),
    fileCount: 2,
    totalBytes: 30,
    largestFile: { path: 'index.html', bytes: 20, sha256: 'b'.repeat(64) },
    ...overrides,
  };
  return parseReleaseIdentityBytes(serializeReleaseIdentity(marker));
}

function identityResponse(evidence = artifactIdentity()) {
  const { markerSha256: _markerSha256, ...marker } = evidence;
  return new Response(serializeReleaseIdentity(marker), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function publishPlan(bytes, overrides = {}) {
  const afterHash = hashPublishBytes(bytes);
  const core = {
    version: 1,
    kind: 'smu1-content-publish-plan',
    target: 'preview',
    profile: 'content-only',
    remote: 'origin',
    refs: {
      candidate: 'v4-product-final-candidate',
      preview: 'preview',
      protected: 'main',
    },
    baseHead: BASE_SHA,
    anchorSha: BASE_SHA,
    protectedMainSha: PROTECTED_SHA,
    remoteRefs: { candidate: BASE_SHA, preview: BASE_SHA, protected: PROTECTED_SHA },
    transactionManifests: [],
    unpublishedTransactionIds: [],
    selectedTransactionIds: ['transaction_001'],
    automaticDependencyIds: [],
    excludedTransactionIds: [],
    allPaths: [],
    paths: [{
      path: NAVIGATION_PATH,
      operation: 'write',
      beforeHash: hashPublishBytes('{}\n'),
      afterHash,
      beforeGitOid: '4'.repeat(40),
      afterGitOid: '5'.repeat(40),
      currentHash: afterHash,
      transactionIds: ['transaction_001'],
      classification: { allowed: true, profile: 'content-only', kind: 'data-singleton' },
    }],
    affectedRoutes: ['/'],
    routeExpectations: [{ route: '/', expected: 'html' }],
    canonicalMedia: [],
    commitTimestamp: '2026-08-17T10:00:00.000Z',
    gates: [...CONTENT_ONLY_GATES],
    unrelatedUnstaged: [],
    warnings: [],
    targetRefs: ['refs/heads/v4-product-final-candidate', 'refs/heads/preview'],
    empty: false,
    ...overrides,
  };
  core.allPaths = overrides.allPaths ?? core.paths;
  const fingerprint = fingerprintPublishPlan(core);
  return { ...core, fingerprint, planFingerprint: fingerprint };
}

async function checkoutFixture(bytes = '{"items":[]}\n') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-publish-runtime-'));
  const absolute = path.join(root, ...NAVIGATION_PATH.split('/'));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  return {
    root,
    bytes,
    async dispose() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function successfulCommandStub(calls, { output = '' } = {}) {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git' && args[0] === 'rev-parse') return { exitCode: 0, stdout: `${TESTED_SHA}\n`, stderr: '' };
    if (command === 'git' && args[0] === 'status') return { exitCode: 0, stdout: '', stderr: '' };
    if (command === 'git' && args[0] === 'diff-tree') {
      return { exitCode: 0, stdout: `${NAVIGATION_PATH}\0`, stderr: '' };
    }
    if (args[0] === 'tools/release/artifact-identity.mjs') {
      const distRoot = path.join(options.cwd, 'dist');
      await mkdir(distRoot, { recursive: true });
      await writeFile(path.join(distRoot, 'index.html'), '<!doctype html>\n');
      await writeReleaseIdentity({ distRoot, testedCommitSha: TESTED_SHA });
    }
    return { exitCode: 0, stdout: output, stderr: '' };
  };
}

test('release identity marker is deterministic, excludes itself, and detects later dist mutation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-release-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const distRoot = path.join(root, 'dist');
  await mkdir(path.join(distRoot, 'assets'), { recursive: true });
  await writeFile(path.join(distRoot, 'index.html'), '<!doctype html>\n');
  await writeFile(path.join(distRoot, 'assets', 'app.js'), 'console.log(1);\n');

  const first = await writeReleaseIdentity({ distRoot, testedCommitSha: TESTED_SHA });
  const firstBytes = await readFile(path.join(distRoot, '_release', 'identity.json'));
  const second = await writeReleaseIdentity({ distRoot, testedCommitSha: TESTED_SHA });
  const secondBytes = await readFile(path.join(distRoot, '_release', 'identity.json'));
  assert.deepEqual(second, first);
  assert.deepEqual(secondBytes, firstBytes);
  assert.equal(first.fileCount, 2);
  assert.equal('generatedAt' in JSON.parse(firstBytes), false);
  assert.deepEqual(await readAndVerifyReleaseIdentity({ distRoot, expectedTestedCommitSha: TESTED_SHA }), first);

  await writeFile(path.join(distRoot, 'index.html'), '<!doctype html><title>changed</title>\n');
  await assert.rejects(
    readAndVerifyReleaseIdentity({ distRoot, expectedTestedCommitSha: TESTED_SHA }),
    { code: 'RELEASE_IDENTITY_MANIFEST_MISMATCH' },
  );
});

test('content gate runner proves exact checkout and returns evidence for every required gate', async (t) => {
  const fixture = await checkoutFixture();
  t.after(() => fixture.dispose());
  const calls = [];
  const leakedToken = 'ghp_THIS_MUST_NOT_LEAK_123456789';
  const gateRunner = createContentPublishGateRunner({
    runCommand: successfulCommandStub(calls, { output: `${'x'.repeat(1500)} ${leakedToken}` }),
    environment: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      GITHUB_TOKEN: leakedToken,
      TEST_SITE_URL: 'https://owner.github.io',
      BASE_PATH: '/repo',
      SITE_URL: 'https://production.example',
    },
    maxOutputBytes: 1024,
  });

  const result = await gateRunner({
    checkoutDir: fixture.root,
    testedSha: TESTED_SHA,
    profile: 'content-only',
    gates: [...CONTENT_ONLY_GATES],
    plan: publishPlan(fixture.bytes),
  });

  assert.equal(result.ok, true);
  assert.equal(result.testedSha, TESTED_SHA);
  assert.deepEqual(
    Object.keys(result.results).filter((key) => key !== 'artifact-byte-identity').sort(),
    [...CONTENT_ONLY_GATES].sort(),
  );
  for (const gate of CONTENT_ONLY_GATES) assert.equal(result.results[gate].ok, true);
  assert.equal(result.results['artifact-byte-identity'].ok, true);
  assert.equal(result.artifactIdentity.testedCommitSha, TESTED_SHA);
  assert.equal(calls.length, 18);
  assert.deepEqual(calls.slice(0, 3).map((call) => call.args[0]), ['rev-parse', 'status', 'diff-tree']);
  assert.deepEqual(calls.slice(3, -1).map((call) => call.args), [
    ['ci', '--no-audit', '--no-fund'],
    ['run', 'test:admin-h6:ci'],
    ['run', 'test:h6-evidence-contracts'],
    ['run', 'check'],
    ['run', 'build'],
    ['run', 'qa:performance'],
    ['run', 'qa:final:static'],
    ['run', 'deploy:prepare'],
    ['run', 'qa:performance'],
    ['run', 'qa:final:browser'],
    ['run', 'qa:h6:route-passport'],
    ['run', 'qa:h6:public-actions'],
    ['run', 'qa:h6:admin-actions'],
    ['run', 'qa:h6:verify-evidence'],
  ]);
  assert.ok(calls.slice(3, -1).every((call) => /npm(?:\.cmd)?$/iu.test(call.command)));
  assert.deepEqual(calls.at(-1).args, [
    'tools/release/artifact-identity.mjs', '--dist', 'dist', '--tested-sha', TESTED_SHA,
  ]);
  assert.equal(calls[0].options.env.GITHUB_TOKEN, undefined);
  assert.equal(calls[0].options.env.DEPLOY_TARGET, 'test');
  assert.equal(calls[0].options.env.PRODUCTION_DEPLOY_ENABLED, 'false');
  assert.equal(calls[0].options.env.SITE_URL, '');
  assert.equal(calls[0].options.env.TEST_SITE_URL, 'https://owner.github.io/');
  assert.equal(calls[0].options.env.BASE_PATH, '/repo/');
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(leakedToken, 'u'));
  assert.ok(result.commands.every((command) => (
    Buffer.byteLength(command.output.stdout) + Buffer.byteLength(command.output.stderr) <= 1024
  )));
  assert.ok(result.commands.at(-1).output.truncated);
});

test('content gate runner fails closed for fingerprint, path bytes, dirty checkout, and a failed command', async (t) => {
  const fixture = await checkoutFixture();
  t.after(() => fixture.dispose());

  const badFingerprint = publishPlan(fixture.bytes);
  badFingerprint.planFingerprint = `sha256:${'f'.repeat(64)}`;
  await assert.rejects(
    createContentPublishGateRunner({ runCommand: successfulCommandStub([]) })({
      checkoutDir: fixture.root,
      testedSha: TESTED_SHA,
      profile: 'content-only',
      gates: [...CONTENT_ONLY_GATES],
      plan: badFingerprint,
    }),
    (error) => error instanceof PublishRuntimeError && error.code === 'PUBLISH_PLAN_FINGERPRINT_MISMATCH',
  );

  const wrongBytesPlan = publishPlan('{"different":true}\n');
  await assert.rejects(
    createContentPublishGateRunner({ runCommand: successfulCommandStub([]) })({
      checkoutDir: fixture.root,
      testedSha: TESTED_SHA,
      profile: 'content-only',
      gates: [...CONTENT_ONLY_GATES],
      plan: wrongBytesPlan,
    }),
    (error) => error instanceof PublishRuntimeError && error.code === 'PUBLISH_GATE_PATH_HASH_MISMATCH',
  );

  const dirtyRunner = createContentPublishGateRunner({
    runCommand: async (command, args) => {
      if (command === 'git' && args[0] === 'rev-parse') return { exitCode: 0, stdout: TESTED_SHA };
      if (command === 'git' && args[0] === 'status') return { exitCode: 0, stdout: ` M ${NAVIGATION_PATH}\n` };
      return { exitCode: 0, stdout: '' };
    },
  });
  await assert.rejects(
    dirtyRunner({
      checkoutDir: fixture.root,
      testedSha: TESTED_SHA,
      profile: 'content-only',
      gates: [...CONTENT_ONLY_GATES],
      plan: publishPlan(fixture.bytes),
    }),
    (error) => error instanceof PublishRuntimeError && error.code === 'PUBLISH_GATE_CHECKOUT_DIRTY',
  );

  const secret = 'ghp_COMMAND_FAILURE_SECRET_123';
  const failedCalls = [];
  const failedRunner = createContentPublishGateRunner({
    environment: { GITHUB_TOKEN: secret },
    runCommand: async (command, args, options) => {
      failedCalls.push({ command, args, options });
      if (command === 'git' && args[0] === 'rev-parse') return { exitCode: 0, stdout: TESTED_SHA };
      if (command === 'git' && args[0] === 'status') return { exitCode: 0, stdout: '' };
      if (command === 'git' && args[0] === 'diff-tree') return { exitCode: 0, stdout: `${NAVIGATION_PATH}\0` };
      if (args[0] === 'run' && args[1] === 'check') return { exitCode: 2, stderr: `failure ${secret}` };
      return { exitCode: 0, stdout: '' };
    },
  });
  await assert.rejects(
    failedRunner({
      checkoutDir: fixture.root,
      testedSha: TESTED_SHA,
      profile: 'content-only',
      gates: [...CONTENT_ONLY_GATES],
      plan: publishPlan(fixture.bytes),
    }),
    (error) => {
      assert.equal(error.code, 'PUBLISH_GATE_COMMAND_FAILED');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(secret, 'u'));
      assert.match(error.details.output.stderr, /\[secret\]/u);
      return true;
    },
  );
});

test('GitHub providers select only the exact workflow and github-pages deployment SHA', async () => {
  const endpoints = [];
  const githubRequest = async (endpoint, options) => {
    endpoints.push({ endpoint, options });
    if (endpoint.startsWith('/actions/workflows/deploy.yml/runs?')) {
      return {
        workflow_runs: [
          { id: 4, head_sha: TESTED_SHA, head_branch: 'main', status: 'completed', conclusion: 'success' },
          { id: 3, head_sha: BASE_SHA, head_branch: 'preview', status: 'completed', conclusion: 'success' },
          {
            id: 2,
            head_sha: TESTED_SHA,
            head_branch: 'preview',
            path: '.github/workflows/deploy.yml@refs/heads/preview',
            status: 'completed',
            conclusion: 'success',
            event: 'push',
            html_url: 'https://github.com/owner/repo/actions/runs/2',
            created_at: '2026-08-17T10:00:00Z',
            updated_at: '2026-08-17T10:02:00Z',
          },
        ],
      };
    }
    if (endpoint.startsWith('/deployments?')) {
      return [
        { id: 8, sha: BASE_SHA, environment: 'github-pages' },
        {
          id: 9,
          sha: TESTED_SHA,
          environment: 'github-pages',
          ref: 'preview',
          created_at: '2026-08-17T10:03:00Z',
        },
      ];
    }
    if (endpoint === '/deployments/9/statuses?per_page=100') {
      return [
        {
          id: 10,
          state: 'success',
          environment_url: 'https://owner.github.io/repo/',
          created_at: '2026-08-17T10:04:00Z',
        },
      ];
    }
    assert.fail(`Unexpected endpoint: ${endpoint}`);
  };
  const providers = createGitHubPublishProviders({
    githubRequest,
    testSiteBaseUrl: 'https://owner.github.io/repo/',
    fetchImpl: async () => assert.fail('Smoke fetch is not expected'),
  });

  const workflow = await providers.workflowProvider({ testedSha: TESTED_SHA });
  assert.deepEqual({ sha: workflow.sha, status: workflow.status, conclusion: workflow.conclusion, id: workflow.id }, {
    sha: TESTED_SHA,
    status: 'completed',
    conclusion: 'success',
    id: 2,
  });
  const workflowQuery = new URL(`https://api.invalid${endpoints[0].endpoint}`);
  assert.equal(workflowQuery.pathname, '/actions/workflows/deploy.yml/runs');
  assert.equal(workflowQuery.searchParams.get('branch'), 'preview');
  assert.equal(workflowQuery.searchParams.get('head_sha'), TESTED_SHA);
  assert.equal(endpoints[0].options.method, 'GET');

  const pages = await providers.pagesProvider({ testedSha: TESTED_SHA, workflow });
  assert.deepEqual({ sha: pages.sha, status: pages.status, conclusion: pages.conclusion, deploymentId: pages.deploymentId }, {
    sha: TESTED_SHA,
    status: 'completed',
    conclusion: 'success',
    deploymentId: 9,
  });
  const deploymentQuery = new URL(`https://api.invalid${endpoints[1].endpoint}`);
  assert.equal(deploymentQuery.pathname, '/deployments');
  assert.equal(deploymentQuery.searchParams.get('sha'), TESTED_SHA);
  assert.equal(deploymentQuery.searchParams.get('environment'), 'github-pages');
  assert.equal(endpoints[2].endpoint, '/deployments/9/statuses?per_page=100');
});

test('retry provider reruns only the exact failed workflow or Pages workflow run', async () => {
  const calls = [];
  const providers = createGitHubPublishProviders({
    githubRequest: async (endpoint, options) => {
      calls.push({ endpoint, options });
      return null;
    },
    testSiteBaseUrl: 'https://owner.github.io/repo/',
    fetchImpl: async () => assert.fail('Smoke fetch is not expected'),
  });
  const push = {
    status: 'pushed',
    pushed: true,
    testedSha: TESTED_SHA,
    refs: { candidate: TESTED_SHA, preview: TESTED_SHA, protected: PROTECTED_SHA },
  };

  const workflowRetry = await providers.retryProvider({
    testedSha: TESTED_SHA,
    statusRecord: {
      testedSha: TESTED_SHA,
      evidence: {
        push,
        workflow: { sha: TESTED_SHA, id: 41, status: 'completed', conclusion: 'failure' },
      },
    },
  });
  assert.deepEqual(workflowRetry, {
    version: 1,
    action: 'workflow-rerun-failed-jobs',
    requested: true,
    repollOnly: false,
    testedSha: TESTED_SHA,
    runId: 41,
  });
  assert.equal(calls[0].endpoint, '/actions/runs/41/rerun-failed-jobs');
  assert.equal(calls[0].options.method, 'POST');

  const pagesRetry = await providers.retryProvider({
    testedSha: TESTED_SHA,
    evidence: {
      push,
      workflow: { sha: TESTED_SHA, id: '42', status: 'completed', conclusion: 'success' },
      pages: { sha: TESTED_SHA, status: 'completed', conclusion: 'failure' },
    },
  });
  assert.deepEqual(pagesRetry, {
    version: 1,
    action: 'pages-rerun',
    requested: true,
    repollOnly: false,
    testedSha: TESTED_SHA,
    runId: 42,
  });
  assert.equal(calls[1].endpoint, '/actions/runs/42/rerun');
  assert.equal(calls[1].options.method, 'POST');
});

test('retry provider uses repoll-only for smoke and transient failures without a GitHub write', async () => {
  const calls = [];
  const providers = createGitHubPublishProviders({
    githubRequest: async (...args) => {
      calls.push(args);
      assert.fail('Repoll-only recovery must not call GitHub');
    },
    testSiteBaseUrl: 'https://owner.github.io/repo/',
    fetchImpl: async () => assert.fail('Smoke fetch is not expected'),
  });
  const push = {
    status: 'pushed',
    pushed: true,
    sha: TESTED_SHA,
    refs: { candidate: TESTED_SHA, preview: TESTED_SHA },
  };
  const smokeRetry = await providers.retryProvider({
    testedSha: TESTED_SHA,
    evidence: {
      push,
      workflow: { sha: TESTED_SHA, id: 51, status: 'completed', conclusion: 'success' },
      pages: { sha: TESTED_SHA, status: 'completed', conclusion: 'success' },
      smoke: { sha: TESTED_SHA, ok: false },
    },
  });
  assert.equal(smokeRetry.action, 'repoll');
  assert.equal(smokeRetry.repollOnly, true);
  assert.equal(smokeRetry.requested, false);
  assert.equal(smokeRetry.reason, 'smoke-failure');

  const transientRetry = await providers.retryProvider({
    testedSha: TESTED_SHA,
    evidence: { push, workflowObservation: null },
  });
  assert.equal(transientRetry.action, 'repoll');
  assert.equal(transientRetry.reason, 'transient-observation');
  assert.equal(calls.length, 0);
});

test('retry provider fails closed on unproven SHA/run identity and redacts request failures', async () => {
  const secret = 'ghp_RETRY_SECRET_MUST_NOT_LEAK_123';
  const calls = [];
  const providers = createGitHubPublishProviders({
    githubRequest: async (endpoint, options) => {
      calls.push({ endpoint, options });
      throw new Error(`request failed with ${secret}`);
    },
    testSiteBaseUrl: 'https://owner.github.io/repo/',
    fetchImpl: async () => assert.fail('Smoke fetch is not expected'),
  });
  const push = {
    status: 'pushed',
    pushed: true,
    testedSha: TESTED_SHA,
    refs: { candidate: TESTED_SHA, preview: TESTED_SHA },
  };

  await assert.rejects(
    providers.retryProvider({
      testedSha: TESTED_SHA,
      evidence: {
        push,
        workflow: { sha: BASE_SHA, id: 61, status: 'completed', conclusion: 'failure' },
      },
    }),
    { code: 'PUBLISH_RETRY_SHA_MISMATCH' },
  );
  await assert.rejects(
    providers.retryProvider({
      testedSha: TESTED_SHA,
      evidence: {
        push: { ...push, refs: { candidate: TESTED_SHA, preview: BASE_SHA } },
        workflow: { sha: TESTED_SHA, id: 61, status: 'completed', conclusion: 'failure' },
      },
    }),
    { code: 'PUBLISH_RETRY_PUSH_EVIDENCE_INVALID' },
  );
  await assert.rejects(
    providers.retryProvider({
      testedSha: TESTED_SHA,
      evidence: {
        push,
        workflow: { sha: TESTED_SHA, id: 'unsafe', status: 'completed', conclusion: 'failure' },
      },
    }),
    { code: 'PUBLISH_RETRY_RUN_ID_INVALID' },
  );
  assert.equal(calls.length, 0);

  await assert.rejects(
    providers.retryProvider({
      testedSha: TESTED_SHA,
      evidence: {
        push,
        workflow: { sha: TESTED_SHA, id: 62, status: 'completed', conclusion: 'failure' },
      },
    }),
    (error) => {
      assert.equal(error.code, 'PUBLISH_GITHUB_REQUEST_FAILED');
      assert.doesNotMatch(error.message, new RegExp(secret, 'u'));
      assert.doesNotMatch(JSON.stringify(error.details), new RegExp(secret, 'u'));
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test('smoke runner checks every route, follows only in-base redirects, and accepts HTML 404', async () => {
  const fetched = [];
  const providers = createGitHubPublishProviders({
    githubRequest: async () => assert.fail('GitHub request is not expected'),
    testSiteBaseUrl: 'https://owner.github.io/repo/',
    fetchImpl: async (url, options) => {
      fetched.push({ url: String(url), options });
      const pathname = new URL(url).pathname;
      if (pathname === '/repo/_release/identity.json') return identityResponse();
      if (pathname === '/repo/old/') {
        return new Response(null, { status: 302, headers: { Location: '/repo/new/' } });
      }
      if (pathname === '/repo/gone/') {
        return new Response('<html>not found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
      }
      return new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    },
  });
  const pages = { sha: TESTED_SHA, status: 'completed', conclusion: 'success' };
  const result = await providers.smokeRunner({
    testedSha: TESTED_SHA,
    affectedRoutes: ['/', '/gone/', '/old/'],
    routeExpectations: [
      { route: '/', expected: 'html' },
      { route: '/gone/', expected: 'not-found' },
      { route: '/old/', expected: 'html' },
    ],
    pages,
    artifactIdentity: artifactIdentity(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.byteIdentityVerified, true);
  assert.equal(result.identityVerified, true);
  assert.deepEqual(result.checkedRoutes, ['/', '/gone/', '/old/']);
  assert.deepEqual(result.checks.map((check) => check.outcome), ['html', 'intentional-not-found', 'html']);
  assert.deepEqual(result.routeExpectations, [
    { route: '/', expected: 'html' },
    { route: '/gone/', expected: 'not-found' },
    { route: '/old/', expected: 'html' },
  ]);
  assert.equal(fetched.length, 5);
  assert.equal(new URL(fetched[0].url).searchParams.get('release'), TESTED_SHA);
  assert.equal(fetched[0].options.cache, 'no-store');
  assert.equal(fetched[0].options.headers['Cache-Control'], 'no-cache');
  assert.deepEqual(fetched.map((item) => new URL(item.url).pathname), [
    '/repo/_release/identity.json',
    '/repo/',
    '/repo/gone/',
    '/repo/old/',
    '/repo/new/',
  ]);
  assert.ok(fetched.every((item) => item.options.redirect === 'manual'));
});

test('smoke runner rejects a manifest mismatch and a stale release identity marker', async () => {
  const localIdentity = artifactIdentity();
  let remoteIdentity = artifactIdentity({ artifactManifestSha256: 'c'.repeat(64) });
  const providers = createGitHubPublishProviders({
    githubRequest: async () => assert.fail('GitHub request is not expected'),
    testSiteBaseUrl: 'https://owner.github.io/repo/',
    fetchImpl: async (url) => new URL(url).pathname === '/repo/_release/identity.json'
      ? identityResponse(remoteIdentity)
      : new Response('<html>ok</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
  });
  const request = {
    testedSha: TESTED_SHA,
    affectedRoutes: ['/'],
    routeExpectations: [{ route: '/', expected: 'html' }],
    pages: { sha: TESTED_SHA, status: 'completed', conclusion: 'success' },
    artifactIdentity: localIdentity,
  };

  const mismatch = await providers.smokeRunner(request);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.byteIdentityVerified, false);
  assert.equal(mismatch.identityVerified, false);
  assert.equal(mismatch.failures[0].code, 'PUBLISH_SMOKE_IDENTITY_MANIFEST_MISMATCH');

  remoteIdentity = artifactIdentity({ testedCommitSha: BASE_SHA });
  const stale = await providers.smokeRunner(request);
  assert.equal(stale.ok, false);
  assert.equal(stale.byteIdentityVerified, false);
  assert.equal(stale.failures[0].code, 'PUBLISH_SMOKE_IDENTITY_STALE');
});

test('smoke runner fails closed on 5xx, unsafe redirects, non-HTML, and network errors without short-circuiting', async () => {
  const attempted = [];
  const providers = createGitHubPublishProviders({
    githubRequest: async () => assert.fail('GitHub request is not expected'),
    testSiteBaseUrl: 'https://owner.github.io/repo/',
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      attempted.push(pathname);
      if (pathname === '/repo/_release/identity.json') return identityResponse();
      if (pathname.endsWith('/server/')) {
        return new Response('<html></html>', { status: 503, headers: { 'Content-Type': 'text/html' } });
      }
      if (pathname.endsWith('/outside/')) {
        return new Response(null, { status: 302, headers: { Location: 'https://evil.example/phish' } });
      }
      if (pathname.endsWith('/binary/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('network failed with ghp_NEVER_EXPOSE_THIS');
    },
  });
  const result = await providers.smokeRunner({
    testedSha: TESTED_SHA,
    affectedRoutes: ['/server/', '/outside/', '/binary/', '/network/'],
    routeExpectations: ['/server/', '/outside/', '/binary/', '/network/']
      .map((route) => ({ route, expected: 'html' })),
    pages: { sha: TESTED_SHA, status: 'completed', conclusion: 'success' },
    artifactIdentity: artifactIdentity(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 4);
  assert.deepEqual(attempted, ['/repo/_release/identity.json', '/repo/binary/', '/repo/network/', '/repo/outside/', '/repo/server/']);
  assert.deepEqual(result.failures.map((failure) => failure.code), [
    'PUBLISH_SMOKE_RESPONSE_INVALID',
    'PUBLISH_SMOKE_NETWORK_ERROR',
    'PUBLISH_SMOKE_REDIRECT_UNSAFE',
    'PUBLISH_SMOKE_SERVER_ERROR',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE/u);
});

test('smoke runner rejects outcome/expectation mismatches and missing or conflicting expectations', async () => {
  const providers = createGitHubPublishProviders({
    githubRequest: async () => assert.fail('GitHub request is not expected'),
    testSiteBaseUrl: 'https://owner.github.io/repo/',
    fetchImpl: async (url) => {
      if (new URL(url).pathname === '/repo/_release/identity.json') return identityResponse();
      return new Response(
        new URL(url).pathname.endsWith('/missing/') ? '<html>not found</html>' : '<html>active</html>',
        { status: new URL(url).pathname.endsWith('/missing/') ? 404 : 200, headers: { 'Content-Type': 'text/html' } },
      );
    },
  });
  const pages = { sha: TESTED_SHA, status: 'completed', conclusion: 'success' };
  const result = await providers.smokeRunner({
    testedSha: TESTED_SHA,
    affectedRoutes: ['/active/', '/missing/'],
    routeExpectations: [
      { route: '/active/', expected: 'not-found' },
      { route: '/missing/', expected: 'html' },
    ],
    pages,
    artifactIdentity: artifactIdentity(),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures.map((item) => item.code), [
    'PUBLISH_SMOKE_UNEXPECTED_HTML',
    'PUBLISH_SMOKE_UNEXPECTED_NOT_FOUND',
  ]);

  await assert.rejects(
    providers.smokeRunner({ testedSha: TESTED_SHA, affectedRoutes: ['/active/'], pages }),
    { code: 'PUBLISH_SMOKE_EXPECTATIONS_REQUIRED' },
  );
  await assert.rejects(
    providers.smokeRunner({
      testedSha: TESTED_SHA,
      affectedRoutes: ['/active/'],
      routeExpectations: [
        { route: '/active/', expected: 'html' },
        { route: '/active/', expected: 'not-found' },
      ],
      pages,
    }),
    { code: 'PUBLISH_SMOKE_EXPECTATION_CONFLICT' },
  );
});

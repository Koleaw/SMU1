import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createGitHubApiRequest,
  resolveGitHubCredential
} from './github-credential-broker.mjs';

const REPOSITORY = Object.freeze({ owner: 'Acme', repo: 'SMU1' });

function mockedCredential(secret, calls = []) {
  return resolveGitHubCredential({
    repository: `${REPOSITORY.owner}/${REPOSITORY.repo}`,
    workingDirectory: process.cwd(),
    environment: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      GITHUB_TOKEN: 'environment-secret-must-not-reach-helper',
      GITHUB_DEPLOY_TOKEN: 'environment-deploy-secret-must-not-reach-helper',
      GIT_CONFIG_COUNT: '1'
    },
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: `protocol=https\nhost=github.com\nusername=x-access-token\npassword=${secret}\n`,
        stderr: ''
      };
    }
  });
}

test('credential broker uses git credential fill and keeps the secret in a non-serializable capability', () => {
  const secret = 'github_pat_BROKER_SECRET_123456';
  const calls = [];
  const capability = mockedCredential(secret, calls);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'git');
  assert.deepEqual(calls[0].args, ['credential', 'fill']);
  assert.match(calls[0].options.input, /^protocol=https\nhost=github\.com\npath=Acme\/SMU1\.git\n\n$/u);
  assert.equal(calls[0].options.env.GITHUB_TOKEN, undefined);
  assert.equal(calls[0].options.env.GITHUB_DEPLOY_TOKEN, undefined);
  assert.equal(calls[0].options.env.GIT_CONFIG_COUNT, undefined);
  assert.equal(calls[0].options.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(calls[0].options.env.GCM_INTERACTIVE, 'Never');
  assert.equal(Object.hasOwn(capability, 'password'), false);
  assert.equal(JSON.stringify(capability).includes(secret), false);
  assert.equal(capability.authorize({ Accept: 'application/json' }).Authorization, `Bearer ${secret}`);
  assert.equal(capability.redact(`Bearer ${secret}`).includes(secret), false);
});

test('public GitHub reads stay anonymous until rate limiting requires the credential broker', async () => {
  let brokerCalls = 0;
  const fetchCalls = [];
  const request = createGitHubApiRequest({
    getRepository: async () => REPOSITORY,
    credentialBroker: async () => {
      brokerCalls += 1;
      return null;
    },
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(JSON.stringify({ workflow_runs: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  assert.deepEqual(await request('/actions/runs?branch=preview&per_page=20'), { workflow_runs: [] });
  assert.equal(brokerCalls, 0);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].options.headers.Authorization, undefined);
});

test('a rate-limited public read retries through the broker without serializing its credential', async () => {
  const secret = 'ghp_RATE_LIMIT_BROKER_SECRET_123';
  const capability = mockedCredential(secret);
  const fetchCalls = [];
  let brokerCalls = 0;
  const request = createGitHubApiRequest({
    getRepository: async () => REPOSITORY,
    credentialBroker: async () => {
      brokerCalls += 1;
      return capability;
    },
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      if (fetchCalls.length === 1) return new Response('rate limited', { status: 403 });
      return new Response(JSON.stringify({ workflow_runs: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  assert.deepEqual(await request('/actions/workflows/deploy.yml/runs?branch=preview'), { workflow_runs: [] });
  assert.equal(brokerCalls, 1);
  assert.equal(fetchCalls[0].options.headers.Authorization, undefined);
  assert.equal(fetchCalls[1].options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(JSON.stringify({ capability }).includes(secret), false);
});

test('workflow rerun is blocked without a broker credential and succeeds with a mocked broker/GitHub API', async () => {
  let blockedFetchCalls = 0;
  const blockedRequest = createGitHubApiRequest({
    getRepository: async () => REPOSITORY,
    credentialBroker: async () => null,
    fetchImpl: async () => {
      blockedFetchCalls += 1;
      return new Response(null, { status: 204 });
    }
  });
  await assert.rejects(
    blockedRequest('/actions/runs/42/rerun-failed-jobs', { method: 'POST' }),
    (error) => error.code === 'PUBLISH_GITHUB_WRITE_CREDENTIAL_REQUIRED'
      && error.status === 503
      && /Credential Manager/u.test(error.message)
      && !/GITHUB_(?:DEPLOY_)?TOKEN/u.test(error.message)
  );
  assert.equal(blockedFetchCalls, 0);

  const secret = 'ghp_RERUN_BROKER_SECRET_123';
  const capability = mockedCredential(secret);
  const fetchCalls = [];
  const request = createGitHubApiRequest({
    getRepository: async () => REPOSITORY,
    credentialBroker: async () => capability,
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(null, { status: 204 });
    }
  });
  assert.equal(await request('/actions/runs/42/rerun', { method: 'POST' }), '');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.equal(fetchCalls[0].options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(JSON.stringify(fetchCalls.map(({ url, options }) => ({ url, method: options.method }))).includes(secret), false);
});

test('GitHub API errors redact the in-memory broker credential', async () => {
  const secret = 'github_pat_ERROR_SECRET_123456';
  const capability = mockedCredential(secret);
  const request = createGitHubApiRequest({
    getRepository: async () => REPOSITORY,
    credentialBroker: async () => capability,
    fetchImpl: async () => new Response(`authorization failed: Bearer ${secret}`, { status: 500 })
  });

  await assert.rejects(
    request('/actions/runs/42/rerun', { method: 'POST' }),
    (error) => error.code === 'PUBLISH_GITHUB_REQUEST_FAILED'
      && !error.message.includes(secret)
      && !JSON.stringify(error).includes(secret)
  );
});

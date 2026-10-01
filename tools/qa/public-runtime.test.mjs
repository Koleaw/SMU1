import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PUBLIC_QA_IMAGE, PUBLIC_QA_CHROME, publicRuntimeImage, publicRuntimeLaunchArgs } from './public-runtime.mjs';

const fixture = () => ({
  environment: { H6_QA_CONTAINER_IMAGE: PUBLIC_QA_IMAGE, CHROME_PATH: PUBLIC_QA_CHROME, ImageVersion: '20260920.314.1' },
  platform: 'linux', exists: () => true,
  read: () => JSON.stringify({ driverVersion: '1.63.0', dockerImageName: 'mcr.microsoft.com/playwright:v1.63.0-noble' })
});

test('same immutable container has the same identity during a hosted runner image roll', () => {
  const first = fixture(), second = fixture();
  second.environment.ImageVersion = '20260927.320.1';
  assert.equal(publicRuntimeImage(first), PUBLIC_QA_IMAGE);
  assert.equal(publicRuntimeImage(second), PUBLIC_QA_IMAGE);
});

test('container identity fails closed on unpinned images, missing markers and different browsers', () => {
  for (const mutate of [
    value => { value.environment.H6_QA_CONTAINER_IMAGE = 'mcr.microsoft.com/playwright:latest'; },
    value => { value.platform = 'win32'; },
    value => { value.environment.CHROME_PATH = '/usr/bin/google-chrome'; },
    value => { value.exists = filename => filename !== '/.dockerenv'; },
    value => { value.exists = filename => filename !== PUBLIC_QA_CHROME; },
    value => { value.read = () => '{}'; },
    value => { value.read = () => '{broken'; },
    value => { value.read = () => JSON.stringify({ driverVersion: '1.62.0', dockerImageName: 'mcr.microsoft.com/playwright:v1.62.0-noble' }); }
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => publicRuntimeImage(value));
  }
});

test('local and native runner evidence retains its original image distinction', () => {
  assert.equal(publicRuntimeImage({ environment: {}, platform: 'win32' }), 'win32');
  assert.notEqual(publicRuntimeImage({ environment: { ImageVersion: 'old' } }), publicRuntimeImage({ environment: { ImageVersion: 'new' } }));
});

test('root browser arguments apply only to the verified container and its exact browser', () => {
  assert.deepEqual(publicRuntimeLaunchArgs(PUBLIC_QA_CHROME, { ...fixture(), uid: 0 }), ['--no-sandbox']);
  assert.deepEqual(publicRuntimeLaunchArgs(PUBLIC_QA_CHROME, { ...fixture(), uid: 1000 }), []);
  assert.deepEqual(publicRuntimeLaunchArgs('native-browser', { environment: {}, uid: 0 }), []);
  assert.throws(() => publicRuntimeLaunchArgs('different-browser', { ...fixture(), uid: 0 }));
  assert.throws(() => publicRuntimeLaunchArgs(PUBLIC_QA_CHROME, { ...fixture(), uid: 0, exists: () => false }));
});

test('every public evidence producer and verifier uses the exact same pinned container', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const jobSource = workflow.slice(workflow.indexOf('\njobs:') + 7);
  const jobs = Object.fromEntries([...jobSource.matchAll(/^  ([a-z-]+):\r?\n([\s\S]*?)(?=^  [a-z-]+:\r?$|(?![\s\S]))/gmu)].map(match => [match[1], match[2]]));
  for (const id of ['public-runtime', 'public-inputs', 'public-actions', 'public-evidence', 'release', 'resume-evidence']) {
    assert.ok(jobs[id].includes(`image: ${PUBLIC_QA_IMAGE}`), `${id}: pinned container`);
    assert.ok(jobs[id].includes(`H6_QA_CONTAINER_IMAGE: ${PUBLIC_QA_IMAGE}`), `${id}: matching identity`);
    assert.ok(jobs[id].includes(`CHROME_PATH: ${PUBLIC_QA_CHROME}`), `${id}: bundled browser`);
  }
  assert.match(jobs['public-runtime'], /run: node tools\/qa\/public-runtime-preflight\.mjs/u);
  assert.match(jobs['public-evidence'], /name: Reconcile every shard[\s\S]*?shell: bash/u);
});

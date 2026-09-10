import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergePublicActionShards } from './public-action-shards.mjs';

const shaPattern = /^[a-f0-9]{40}$/;
const requiredJobs = ['build', 'admin-actions', 'admin-acceptance', 'public-inputs',
  ...Array.from({ length: 8 }, (_, index) => 'public-actions (' + (index + 1) + ')')];

export function validateResumeRun({ run, jobs, candidateSHA, previewSHA, workflowId }) {
  assert.equal(run.status, 'completed', 'Original workflow must have stopped.');
  assert.ok(['success', 'failure'].includes(run.conclusion), 'Cancelled or unfinished runs cannot be resumed.');
  assert.equal(run.head_branch, 'preview', 'Only a preview source run is accepted.');
  assert.equal(run.workflow_id, workflowId, 'Evidence must originate from this deployment workflow.');
  assert.match(run.head_sha || '', shaPattern);
  assert.equal(candidateSHA, run.head_sha, 'Candidate moved since these checks.');
  assert.equal(previewSHA, run.head_sha, 'Preview moved since these checks.');
  for (const name of requiredJobs) {
    const matching = jobs.filter(job => job.name === name);
    assert.equal(matching.length, 1, 'Expected one completed job: ' + name);
    assert.equal(matching[0].status, 'completed', name + ' is unfinished.');
    assert.equal(matching[0].conclusion, 'success', name + ' did not pass.');
  }
  return run.head_sha;
}

export function validateReconciliationBoundary(relativeFiles) {
  for (const file of relativeFiles) {
    assert.ok(file.startsWith('tools/qa/') || file.startsWith('docs/qa/')
      || file === '.github/workflows/deploy.yml', 'Resume tooling contains a public/source change: ' + file);
  }
}

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const option = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const output = (name, value) => {
  console.log(name + '=' + value);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + value + '\n');
};
async function main() {
  const command = process.argv[2];
  const runId = option('run-id');
  assert.match(runId || '', /^[1-9][0-9]*$/);
  if (command === 'resolve') {
    const repository = process.env.GITHUB_REPOSITORY;
    assert.match(repository || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    const api = async resource => {
      const response = await fetch('https://api.github.com/repos/' + repository + '/' + resource, {
        headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28' }
      });
      if (!response.ok) throw new Error('GitHub evidence metadata HTTP ' + response.status);
      return response.json();
    };
    const [run, jobs, current, candidate, preview] = await Promise.all([
      api('actions/runs/' + runId),
      api('actions/runs/' + runId + '/jobs?filter=latest&per_page=100'),
      api('actions/runs/' + process.env.GITHUB_RUN_ID),
      api('git/ref/heads/v4-product-final-candidate'), api('git/ref/heads/preview')
    ]);
    output('source_sha', validateResumeRun({ run, jobs: jobs.jobs, workflowId: current.workflow_id,
      candidateSHA: candidate.object.sha, previewSHA: preview.object.sha }));
    return;
  }
  if (command !== 'reconcile') throw new Error('Expected resolve or reconcile.');
  const site = path.resolve(option('site') || 'site');
  const tooling = path.resolve(option('tooling') || 'qa-tools');
  const sourceSHA = process.env.TESTED_SHA;
  assert.match(sourceSHA || '', shaPattern);
  assert.equal(git(site, 'rev-parse', 'HEAD'), sourceSHA);
  assert.equal(git(site, 'branch', '--show-current'), 'preview');
  const changed = git(tooling, 'diff', '--name-only', sourceSHA, 'HEAD').split('\n').filter(Boolean);
  validateReconciliationBoundary(changed);
  const directory = path.join(site, '.admin-runtime/h6-qa');
  const shardFiles = Array.from({ length: 8 }, (_, index) => path.join(directory, 'public-action-shards/shard-' + (index + 1) + '.json'));
  const buffers = shardFiles.map(file => fs.readFileSync(file));
  const reports = buffers.map(bytes => JSON.parse(bytes));
  assert.ok(reports.every(report => report.evidence.sourceSHA === sourceSHA));
  // This is a new reconciliation of immutable, already executed browser reports.
  // The original checkout below still supplies the input fingerprint and every
  // release verifier; no original SHA, action, result or timestamp is rewritten.
  const report = mergePublicActionShards(reports, { sourceFiles: shardFiles.map(file => path.relative(site, file).replaceAll('\\', '/')) });
  report.evidence.reconciliation = {
    kind: 'immutable-ci-shards', originalRunId: Number(runId), testedSourceSHA: sourceSHA,
    toolingSourceSHA: git(tooling, 'rev-parse', 'HEAD'),
    mergerSHA256: hash(fs.readFileSync(path.join(tooling, 'tools/qa/public-action-shards.mjs'))),
    sourceShards: buffers.map((bytes, index) => ({ index: index + 1, sha256: hash(bytes), bytes: bytes.length }))
  };
  const originalContract = await import(pathToFileURL(path.join(site, 'tools/qa/evidence-contract.mjs')).href);
  const checked = originalContract.validatePublicActionEvidence(report);
  assert.equal(checked.ok, true, checked.issues.join('\n'));
  fs.writeFileSync(path.join(directory, 'public-action-crawl.json'), JSON.stringify(report));
  const basePath = read(path.join(directory, 'route-passport.json')).evidence.basePath;
  assert.match(basePath, /^\/[A-Za-z0-9/_-]*$/);
  output('base_path', basePath);
  console.log(JSON.stringify({ originalRunId: runId, sourceSHA, aggregate: report.aggregate, issues: checked.issues }));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();

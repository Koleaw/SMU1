import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { PUBLIC_CRAWL_SHARDS, publicHarnessFiles } from './public-action-cache.mjs';

test('public QA fingerprint follows transitive imports and excludes unrelated editor helpers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-qa-inputs-'));
  try {
    await fs.writeFile(path.join(root, 'entry.mjs'), "import './shared.mjs'; export {value} from './other.mjs';");
    await fs.writeFile(path.join(root, 'shared.mjs'), "await import('./leaf.mjs');");
    await fs.writeFile(path.join(root, 'other.mjs'), 'export const value=1;');
    await fs.writeFile(path.join(root, 'leaf.mjs'), 'export const leaf=1;');
    await fs.writeFile(path.join(root, 'admin.mjs'), 'export const admin=1;');
    const initial = publicHarnessFiles(root, ['entry.mjs']);
    assert.deepEqual(initial.map(([file])=>file), ['entry.mjs', 'leaf.mjs', 'other.mjs', 'shared.mjs']);
    await fs.writeFile(path.join(root, 'admin.mjs'), 'export const admin=2;');
    assert.deepEqual(publicHarnessFiles(root, ['entry.mjs']), initial);
    await fs.writeFile(path.join(root, 'leaf.mjs'), 'export const leaf=2;');
    assert.notDeepEqual(publicHarnessFiles(root, ['entry.mjs']), initial);
    await fs.writeFile(path.join(root, 'shared.mjs'), 'await import(process.env.TEST_MODULE);');
    assert.throws(()=>publicHarnessFiles(root, ['entry.mjs']), /Untracked dynamic QA import/);
  } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    assert.ok(relative.startsWith('smu1-qa-inputs-') && !relative.includes(path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('CI retains independent failed stages and gates publishing on complete evidence', async () => {
  const workflow = await fs.readFile(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const jobSource = workflow.slice(workflow.indexOf('\njobs:') + 7);
  const jobs = Object.fromEntries([...jobSource.matchAll(/^  ([a-z-]+):\r?\n([\s\S]*?)(?=^  [a-z-]+:\r?$|(?![\s\S]))/gmu)].map(match=>[match[1],match[2]]));
  assert.deepEqual(Object.keys(jobs), ['build','admin-actions','admin-acceptance','public-inputs','public-actions','public-evidence','release','deploy-test','resume-evidence','deploy-resumed-preview']);
  for (const name of ['build','admin-actions','admin-acceptance']) assert.match(jobs[name], /if: inputs\.resume_evidence_run == ''/u);
  assert.match(jobs['admin-actions'], /--stage=actions/u);
  assert.match(jobs['admin-acceptance'], /--stage=acceptance/u);
  assert.doesNotMatch(jobs['admin-actions'], /^    needs:/mu);
  assert.doesNotMatch(jobs['admin-acceptance'], /^    needs:/mu);
  for (const name of ['admin-actions','admin-acceptance','public-actions']) assert.match(jobs[name], /if: always\(\)/u);
  assert.match(jobs['public-inputs'], /needs: \[build, admin-actions, admin-acceptance\]/u);
  assert.match(jobs['public-inputs'], /public-action-cache\.mjs restore/u);
  assert.doesNotMatch(jobs['public-inputs'], /restore-keys:/u);
  assert.match(jobs['public-actions'], /cache_hit != 'true'/u);
  const shards = jobs['public-actions'].match(/shard: \[([^\]]+)\]/u)[1].split(',').map(Number);
  assert.deepEqual(shards, Array.from({length:PUBLIC_CRAWL_SHARDS},(_,index)=>index+1));
  assert.match(jobs['public-actions'], /--expected-input-key=/u);
  assert.match(jobs['public-evidence'], /public-action-shards\.mjs/u);
  assert.match(jobs['public-evidence'], /public-action-cache\.mjs seal/u);
  assert.match(jobs.release, /needs: \[build, admin-actions, admin-acceptance, public-evidence\]/u);
  assert.match(jobs.release, /npm run qa:h6:verify-evidence/u);
  assert.match(jobs['deploy-test'], /needs: \[build, release\]/u);
  assert.match(jobs['resume-evidence'], /inputs\.deploy_target == 'test'[\s\S]*github\.ref_name != 'main'[\s\S]*github\.ref_name != 'master'/u);
  assert.match(jobs['resume-evidence'], /resume-preview-evidence\.mjs resolve/u);
  assert.match(jobs['resume-evidence'], /resume-preview-evidence\.mjs reconcile/u);
  assert.match(jobs['resume-evidence'], /node \.\.\/qa-tools\/tools\/qa\/verify-h6-evidence\.mjs\s+working-directory: site/u);
  assert.match(jobs['resume-evidence'], /steps\.reconcile\.outputs\.artifact_recheck == 'true'/u);
  assert.match(jobs['resume-evidence'], /node tools\/performance\/prepare-media\.mjs\s+tar -xmf \.admin-runtime\/ci\/validated-build\.tar dist/u);
  assert.match(jobs['resume-evidence'], /cp -a dist\/_media\/h5\/\. public\/_media\/h5\/\s+node tools\/performance\/prepare-media\.mjs/u);
  assert.match(jobs['resume-evidence'], /npm run qa:performance[\s\S]*npm run qa:h6:route-passport[\s\S]*npm run qa:h6:media-privacy/u);
  for (const name of ['public-inputs','public-actions','public-evidence','release']) assert.match(jobs[name], /node tools\/qa\/restore-ci-artifact\.mjs/u);
  assert.doesNotMatch(jobs['resume-evidence'], /run: npm run build|public-action-crawl\.mjs|--stage=actions|--stage=acceptance/u);
  assert.match(jobs['deploy-resumed-preview'], /needs: resume-evidence/u);
  for (const name of ['resume-evidence', 'deploy-resumed-preview']) {
    assert.match(jobs[name], /test "\$candidate_sha" = "\$TESTED_SHA" && test "\$preview_sha" = "\$TESTED_SHA"/u);
  }
  assert.doesNotMatch(workflow, /continue-on-error: true|--allow-stale-dist|--allow-deferred-admin-actions|--no-js=off/u);
  assert.doesNotMatch(workflow, /run: tar -xmf validated-build\.tar/u, 'generated archives stay in the ignored runtime directory');
});

test('isolated editor accepts only explicit bounded stages, with all as the default', () => {
  for (const stage of ['all','actions','acceptance']) {
    const help = execFileSync(process.execPath, ['tools/qa/isolated-admin-action-qa.mjs', '--help', `--stage=${stage}`], { encoding:'utf8', windowsHide:true });
    assert.match(help, /--stage=all\|actions\|acceptance/u);
  }
  assert.throws(()=>execFileSync(process.execPath, ['tools/qa/isolated-admin-action-qa.mjs', '--help', '--stage=skip'], { stdio:'pipe', windowsHide:true }));
});

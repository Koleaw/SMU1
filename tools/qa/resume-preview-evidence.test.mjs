import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { validateResumeRun, validateReconciliationBoundary, validateOriginalReport, classifyTrackedOverlay } from './resume-preview-evidence.mjs';
const sourceSHA = 'a'.repeat(40);
const fixture = () => ({
  run: { status: 'completed', conclusion: 'failure', head_branch: 'preview', head_sha: sourceSHA, workflow_id: 123 },
  jobs: ['build', 'admin-actions', 'admin-acceptance', 'public-inputs', ...Array.from({length: 8}, (_, i) => 'public-actions (' + (i + 1) + ')')]
    .map(name => ({name, status: 'completed', conclusion: 'success'})),
  candidateSHA: sourceSHA, previewSHA: sourceSHA, workflowId: 123
});
test('resume requires the exact protected preview and every successful original browser job', () => {
  assert.equal(validateResumeRun(fixture()), sourceSHA);
  for (const mutate of [
    value => { value.run.status = 'in_progress'; },
    value => { value.run.conclusion = 'cancelled'; },
    value => { value.run.head_branch = 'main'; },
    value => { value.workflowId = 321; },
    value => { value.previewSHA = 'b'.repeat(40); },
    value => { value.candidateSHA = 'b'.repeat(40); },
    value => { value.jobs.pop(); },
    value => { value.jobs.push(value.jobs[0]); },
    value => { value.jobs[5].conclusion = 'failure'; }
  ]) {
    const value = fixture(); mutate(value); assert.throws(() => validateResumeRun(value));
  }
});
test('resumption cannot carry an untested public, content or dependency change', () => {
  validateReconciliationBoundary(['tools/qa/public-action-shards.mjs', 'docs/qa/report.md', '.github/workflows/deploy.yml']);
  for (const file of ['src/pages/index.astro', 'public/photo.jpg', 'content/products/model.json', 'package.json', 'package-lock.json', 'astro.config.mjs']) {
    assert.throws(() => validateReconciliationBoundary([file]), /public\/source change/);
  }
});

test('reconciliation reads authoritative content from the original checkout rather than the runner parent directory', async () => {
  const site = process.cwd();
  try {
    process.chdir(os.tmpdir());
    const checked = await validateOriginalReport({}, site);
    assert.equal(checked.ok, false);
    assert.ok(checked.issues.includes('public-actions:schema-version'));
  } finally { process.chdir(site); }
});

test('artifact resumption can recheck original tracked SVG overlays but rejects any other changed byte', () => {
  const bytes=Buffer.from('<svg/>');
  const old={artifactFileHashes:[['index.html','a'.repeat(64),10]]};
  const extra=['assets/icons/old.svg',createHash('sha256').update(bytes).digest('hex'),bytes.length];
  const current={artifactFileHashes:[...old.artifactFileHashes,extra]};
  assert.deepEqual(classifyTrackedOverlay(old,current,()=>bytes),[extra]);
  for(const mutate of [
    value=>{value.artifactFileHashes[0]=['index.html','b'.repeat(64),10];},
    value=>{value.artifactFileHashes.shift();},
    value=>{value.artifactFileHashes[1]=['assets/new.js',extra[1],extra[2]];},
    value=>{value.artifactFileHashes[1]=[extra[0],'c'.repeat(64),extra[2]];}
  ]){const changed=structuredClone(current);mutate(changed);assert.throws(()=>classifyTrackedOverlay(old,changed,()=>bytes));}
});

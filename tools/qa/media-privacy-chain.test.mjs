import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('media privacy drill is exact-SHA, disposable and verifies the complete GPS-to-deploy chain', async () => {
  const source = await fs.readFile(path.join(process.cwd(), 'tools', 'qa', 'media-privacy-chain.mjs'), 'utf8');
  assert.match(source, /git\(sourceRoot, \['rev-parse', 'HEAD'\]\)/u);
  assert.match(source, /createMediaStagingService/u);
  assert.match(source, /createTransactionEngine/u);
  assert.match(source, /privateMetadata\?\.gps/u);
  assert.match(source, /tools\/performance\/prepare-media\.mjs/u);
  assert.match(source, /astroCli, 'build'/u);
  assert.match(source, /deploy-media-reachability\.mjs', '--apply'/u);
  assert.match(source, /metadata\.exif/u);
  assert.match(source, /metadata\.xmp/u);
  assert.match(source, /metadata\.iptc/u);
  assert.match(source, /metadata\.comments/u);
  assert.match(source, /absentFromStaging:\s*stagingAudit\.absent/u);
  assert.match(source, /absentFromPublicUploads:\s*publicUploadAudit\.absent/u);
  assert.match(source, /absentFromDeployUploads:\s*deployUploadAudit\.absent/u);
  assert.match(source, /finally\s*\{[\s\S]*contained\(fixtureBase, fixtureRoot\)[\s\S]*rm\(fixtureRoot/u);
  assert.doesNotMatch(source, /writeFile\([^\n]*privateSource/u, 'private source bytes must never be written');

  const stagedAt = source.indexOf('await staging.stage(');
  const resolvedAt = source.indexOf('await staging.resolveForPromotion(');
  const committedAt = source.indexOf('await engine.apply(');
  const promotedAt = source.indexOf('await staging.markPromoted(');
  assert.ok(stagedAt >= 0 && stagedAt < resolvedAt, 'stage must precede promotion resolution');
  assert.ok(resolvedAt < committedAt, 'verified staged bytes must feed the transaction');
  assert.ok(committedAt < promotedAt, 'markPromoted must happen only after the atomic transaction commits');
  assert.doesNotMatch(source, /import\s*\{\s*preparePublicMediaUpload\s*\}/u, 'drill must exercise the staging service boundary');
});

test('H6 evidence verifier requires and validates the media privacy report', async () => {
  const source = await fs.readFile(path.join(process.cwd(), 'tools', 'qa', 'verify-h6-evidence.mjs'), 'utf8');
  assert.match(source, /mediaPrivacy:\s*await readJson\(filenames\.mediaPrivacy\)/u);
  assert.match(source, /validateMediaPrivacyEvidence\(reports\.mediaPrivacy/u);
  assert.match(source, /expectedSourceSHA:\s*currentEvidence\.sourceSHA/u);
  assert.match(source, /expectedPipelineHash:\s*currentEvidence\.h5PipelineHash/u);
  assert.match(source, /expectedArtifactFingerprint:\s*currentEvidence\.artifactFingerprintSHA256/u);
});

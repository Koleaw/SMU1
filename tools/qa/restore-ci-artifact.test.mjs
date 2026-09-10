import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';import {restoreCIArtifact} from './restore-ci-artifact.mjs';
test('archive restoration preserves tracked checkout output separately and never overlays obsolete files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'smu1-ci-restore-'));
 try {
  fs.mkdirSync(path.join(root,'.admin-runtime/ci'),{recursive:true});
  fs.mkdirSync(path.join(root,'source/dist'),{recursive:true});
  fs.writeFileSync(path.join(root,'source/dist/index.html'),'validated public page');
  execFileSync('tar',['-cf',path.join(root,'.admin-runtime/ci/validated-build.tar'),'-C',path.join(root,'source'),'dist'],{windowsHide:true});
  fs.mkdirSync(path.join(root,'dist/assets'),{recursive:true});
  fs.writeFileSync(path.join(root,'dist/assets/stale.svg'),'old tracked placeholder');
  fs.writeFileSync(path.join(root,'dist/index.html'),'old checkout page');
  const result=restoreCIArtifact(root);
  assert.equal(fs.readFileSync(path.join(result.restored,'index.html'),'utf8'),'validated public page');
  assert.equal(fs.existsSync(path.join(result.restored,'assets/stale.svg')),false);
  assert.equal(fs.readFileSync(path.join(result.preservedCheckout,'assets/stale.svg'),'utf8'),'old tracked placeholder');
  assert.throws(()=>restoreCIArtifact(root),/already preserved/);
 } finally {
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(root));
  assert.ok(relative.startsWith('smu1-ci-restore-')&&!relative.includes(path.sep));
  fs.rmSync(root,{recursive:true,force:true});
 }
});

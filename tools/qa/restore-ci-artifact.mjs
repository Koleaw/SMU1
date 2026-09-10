import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function restoreCIArtifact(root=process.cwd()) {
  root=fs.realpathSync(root);
  const runtime=path.join(root,'.admin-runtime/ci');
  const archive=path.join(runtime,'validated-build.tar');
  assert.ok(fs.statSync(archive).isFile(), 'Validated build archive is missing.');
  const dist=path.join(root,'dist'),preserved=path.join(runtime,'checkout-dist');
  assert.ok(!fs.existsSync(preserved), 'Original checkout output was already preserved.');
  if(fs.existsSync(dist))fs.renameSync(dist,preserved);
  execFileSync('tar',['-xmf',archive],{cwd:root,stdio:'inherit',windowsHide:true});
  assert.ok(fs.statSync(path.join(dist,'index.html')).isFile(), 'Archive did not restore a public build.');
  return {restored:dist,preservedCheckout:fs.existsSync(preserved)?preserved:null};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  assert.equal(execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8',windowsHide:true}).trim().replaceAll('\\','/'),process.cwd().replaceAll('\\','/'),'Restore must run at the checkout root.');
  console.log(JSON.stringify(restoreCIArtifact()));
}

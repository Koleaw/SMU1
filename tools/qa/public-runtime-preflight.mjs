import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CdpBrowser } from './cdp-browser.mjs';
import { PUBLIC_QA_IMAGE, publicRuntimeImage } from './public-runtime.mjs';

assert.equal(publicRuntimeImage(), PUBLIC_QA_IMAGE);
// A job container sees the host-owned checkout through a bind mount. Prove
// Git can read that exact checkout before the slower build/crawl jobs finish.
const git = (...args) => execFileSync('git', args, { encoding:'utf8', windowsHide:true }).trim();
assert.equal(fs.realpathSync(git('rev-parse', '--show-toplevel')), fs.realpathSync(process.cwd()));
const sourceSHA = git('rev-parse', 'HEAD');
assert.match(sourceSHA, /^[a-f0-9]{40}$/u);
if (process.env.GITHUB_SHA) assert.equal(sourceSHA, process.env.GITHUB_SHA);
const browser = new CdpBrowser();
try {
  await browser.start();
  const chromium = await browser.send('Browser.getVersion');
  assert.match(chromium.product, /\/153\.0\.8010\.12$/u);
  console.log(JSON.stringify({ image: PUBLIC_QA_IMAGE, node: process.versions.node, sourceSHA, checkoutReadable:true, chromium }));
} finally {
  await browser.close();
}

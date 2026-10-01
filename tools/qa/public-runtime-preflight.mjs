import assert from 'node:assert/strict';
import { CdpBrowser } from './cdp-browser.mjs';
import { PUBLIC_QA_IMAGE, publicRuntimeImage } from './public-runtime.mjs';

assert.equal(publicRuntimeImage(), PUBLIC_QA_IMAGE);
const browser = new CdpBrowser();
try {
  await browser.start();
  const chromium = await browser.send('Browser.getVersion');
  assert.match(chromium.product, /\/153\.0\.8010\.12$/u);
  console.log(JSON.stringify({ image: PUBLIC_QA_IMAGE, node: process.versions.node, chromium }));
} finally {
  await browser.close();
}

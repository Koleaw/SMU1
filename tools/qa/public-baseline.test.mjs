import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CdpBrowser, createDistServer } from './cdp-browser.mjs';
import { restorePublicBaseline } from './public-baseline.mjs';

test('public baseline rejects any non-disposable origin before navigating or clearing data', async () => {
  for (const target of ['https://example.com/', 'http://127.0.0.1:9999/']) {
    await assert.rejects(restorePublicBaseline({}, { origin: 'http://127.0.0.1:1234', requestedUrl: target }), /disposable loopback/u);
  }
});

test('baseline replaces a hash-mutated document and clears storage after its pagehide save', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smu1-public-baseline-'));
  await fs.writeFile(path.join(root, 'index.html'), `<!doctype html><input value="initial"><script>
    window.documentIdentity = Math.random();
    addEventListener('pagehide', () => localStorage.setItem('saved-on-pagehide', 'old calculation'));
  </script>`);
  const server = await createDistServer({ distRoot: root });
  const browser = new CdpBrowser();
  try {
    await browser.start();
    const requestedUrl = server.origin + '/';
    await browser.navigate(requestedUrl);
    const original = await browser.evaluate(`(() => {
      history.replaceState(null, '', '#project=sample');
      document.querySelector('input').value = 'mutated';
      document.body.insertAdjacentHTML('beforeend', '<button>Added project</button>');
      localStorage.setItem('projects', 'temporary QA data');
      return window.documentIdentity;
    })()`);
    await restorePublicBaseline(browser, { origin: server.origin, requestedUrl });
    const after = await browser.evaluate(`({ identity: window.documentIdentity, value: document.querySelector('input').value,
      buttons: document.querySelectorAll('button').length, keys: Object.keys(localStorage), hash: location.hash })`);
    assert.notEqual(after.identity, original);
    assert.equal(after.value, 'initial');
    assert.equal(after.buttons, 0);
    assert.deepEqual(after.keys, []);
    assert.equal(after.hash, '');
  } finally {
    await browser.close();
    await server.close();
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    assert.ok(relative.startsWith('smu1-public-baseline-') && !relative.includes(path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

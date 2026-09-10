import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CdpBrowser, createDistServer, preferredChromePath } from './cdp-browser.mjs';
import { adminControlPostcondition, findAdminActionElement, isExpectedIsolatedPublishStatus } from './admin-action-state.mjs';

test('only the evidenced insecure isolated publish-status denial is expected', () => {
  const allowed = { method: 'GET', status: 403, origin: 'http://127.0.0.1:4321',
    url: 'http://127.0.0.1:4321/api/admin/publish/status', code: 'INSECURE_PUBLISH_DENIED', isolated: true };
  assert.equal(isExpectedIsolatedPublishStatus(allowed), true);
  for (const patch of [{ method: 'POST' }, { status: 401 }, { code: 'AUTH_REQUIRED' }, { code: '' },
    { isolated: false }, { url: 'https://example.org/api/admin/publish/status' },
    { url: allowed.url + '?action=publish' }, { url: 'http://127.0.0.1:4321/api/admin/publish/preview-apply' }]) {
    assert.equal(isExpectedIsolatedPublishStatus({ ...allowed, ...patch }), false, JSON.stringify(patch));
  }
});

test('favorite and selection evidence proves state changes, not incidental network traffic', () => {
  assert.equal(adminControlPostcondition({ domId: 'veFullScreen' }, '{"fullscreen":false}', '{"fullscreen":true}', 0), true);
  assert.equal(adminControlPostcondition({ domId: 'veFullScreen' }, '{"fullscreen":false}', '{"fullscreen":false}', 99), false);
  assert.equal(adminControlPostcondition({ tag: 'summary' }, '{"detailsOpen":true}', '{"detailsOpen":false}', 0), true);
  assert.equal(adminControlPostcondition({ tag: 'summary' }, '{"detailsOpen":true}', '{"detailsOpen":true}', 99), false);
  const favorite = { classes: ['ve-tree-item__favorite'] };
  const off = JSON.stringify({ pressed: 'false' }), on = JSON.stringify({ pressed: 'true' });
  assert.equal(adminControlPostcondition(favorite, off, on, 0), true);
  assert.equal(adminControlPostcondition(favorite, on, off, 0), true);
  assert.equal(adminControlPostcondition(favorite, off, off, 99), false);
  assert.equal(adminControlPostcondition(favorite, off, null, 99), false);
  for (const name of ['data-viewport', 'data-mode', 'data-filter', 'data-settings-tab']) {
    const selection = { dataAttributes: { [name]: 'selected' } };
    assert.equal(adminControlPostcondition(selection, off, on, 0), true);
    assert.equal(adminControlPostcondition(selection, on, on, 99), false);
    assert.equal(adminControlPostcondition(selection, on, off, 99), false);
  }
});

test('admin controls survive navigator replacement and modal reset without matching another inventory position', { skip: !preferredChromePath() }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-admin-action-state-'));
  const markup = '<!doctype html><html><body><div id="tree"><div data-route="/a/"><button class="ve-tree-item__favorite" data-h6-admin-action-id="a1">A</button></div><div data-route="/b/"><button class="ve-tree-item__favorite" data-h6-admin-action-id="a2">B</button></div></div><div id="modes"><button data-mode="edit">Edit</button><button data-mode="preview">Preview</button></div><dialog id="dialog"><button>Close</button></dialog></body></html>';
  await writeFile(path.join(root, 'index.html'), markup);
  const server = await createDistServer({ distRoot: root });
  const browser = await new CdpBrowser().start();
  const favorite = { tag: 'button', id: 'a2', containerId: 'tree', classes: ['ve-tree-item__favorite'], ancestorRoute: '/b/' };
  const expression = (action, suffix) => `(() => { const element = (${findAdminActionElement.toString()})(document, ${JSON.stringify(action)}); ${suffix} })()`;
  try {
    await browser.navigate(server.origin + '/');
    assert.equal(await browser.evaluate(expression(favorite, 'return element.textContent;')), 'B');
    await browser.evaluate(`document.getElementById('tree').innerHTML = '<div data-route="/b/"><button class="ve-tree-item__favorite" data-h6-admin-action-id="a1">B replaced</button></div><div data-route="/a/"><button class="ve-tree-item__favorite" data-h6-admin-action-id="a2">Wrong positional target</button></div>'; document.getElementById('dialog').showModal();`);
    assert.equal(await browser.evaluate(expression(favorite, 'element.focus(); return element === document.activeElement;')), false);
    await browser.evaluate("document.getElementById('dialog').close()");
    assert.equal(await browser.evaluate(expression(favorite, 'element.focus(); return element.textContent;')), 'B replaced');
    assert.equal(await browser.evaluate(expression(favorite, 'return element === document.activeElement;')), true);
    assert.equal(await browser.evaluate(expression({ ...favorite, ancestorRoute: '/missing/' }, 'return element;')), null);
    assert.equal(await browser.evaluate(expression({ tag: 'button', containerId: 'modes', dataAttributes: { 'data-mode': 'preview' } }, 'return element.textContent;')), 'Preview');
    await browser.evaluate(`document.getElementById('tree').innerHTML = '<details><summary data-h6-admin-action-id="a900">Categories</summary><p>Content</p></details>';`);
    const summary = { tag: 'summary', id: 'a56', containerId: 'tree', name: 'Categories' };
    assert.equal(await browser.evaluate(expression(summary, 'return element.textContent;')), 'Categories');
    await browser.evaluate(`document.getElementById('tree').insertAdjacentHTML('beforeend','<details><summary>Categories</summary></details>');`);
    assert.equal(await browser.evaluate(expression(summary, 'return element;')), null, 'ambiguous labels must not silently match another control');
  } finally {
    await browser.close(); await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

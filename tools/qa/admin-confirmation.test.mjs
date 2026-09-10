import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CdpBrowser, createDistServer, preferredChromePath } from './cdp-browser.mjs';

test('public crawls and non-disposable contexts cannot accept admin confirmations', async () => {
  let called = false;
  for (const [safetyMode, disposable] of [['public-read-only', true], ['admin-no-release', false]]) {
    const browser = new CdpBrowser({ safetyMode });
    await assert.rejects(browser.confirmIsolatedAction({ kind: 'history-restore', origin: 'http://127.0.0.1:4321', disposable }, () => { called = true; }), /disposable local admin/u);
  }
  assert.equal(called, false);
});

test('a disposable action accepts one exact confirmation and still rejects unexpected dialogs', { skip: !preferredChromePath() }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-admin-confirm-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body>Isolated dialog fixture</body></html>');
  const server = await createDistServer({ distRoot: root });
  const browser = await new CdpBrowser({ safetyMode: 'admin-no-release' }).start();
  const options = { kind: 'history-restore', origin: server.origin, disposable: true };
  try {
    await browser.navigate(server.origin + '/');
    const accepted = await browser.confirmIsolatedAction(options, () => browser.evaluate(`window.__confirmed = confirm('Восстановить 2 файлов новой транзакцией?')`));
    assert.equal(await browser.evaluate('window.__confirmed'), true);
    assert.deepEqual(accepted, { type: 'confirm', accepted: true, reason: 'qa-isolated-history-restore', kind: 'history-restore' });
    assert.equal(browser.safetyEvidence().navigationDialogs.length, 0);
    assert.equal(browser.safetyEvidence().actionDialogs.length, 1);
    assert.equal(JSON.stringify(browser.safetyEvidence()).includes('Восстановить'), false, 'dialog text is not persisted');
    await assert.rejects(browser.confirmIsolatedAction(options, () => browser.evaluate(`window.__wrong = confirm('Удалить настоящие данные?')`)), /Unexpected JavaScript confirm/u);
    assert.equal(await browser.evaluate('window.__wrong'), false);
    assert.equal(browser.safetyEvidence().navigationDialogs.at(-1).accepted, false);
    assert.equal(browser.safetyEvidence().actionDialogs.length, 1);
    await assert.rejects(browser.confirmIsolatedAction({ ...options, timeoutMs: 40 }, () => browser.evaluate('0')), /Expected exactly one/u);
    await assert.rejects(browser.confirmIsolatedAction({ ...options, origin: 'http://127.0.0.1:1' }, () => browser.evaluate('0')), /origin does not match/u);
  } finally {
    await browser.close(); await server.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

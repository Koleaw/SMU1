import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CdpBrowser, createDistServer, preferredChromePath } from './cdp-browser.mjs';
import { measureTextProjection } from './text-projection-probe.mjs';

test('feedback measures actual DOM projection, excludes transport, and rejects stale or absent changes', { skip: !preferredChromePath() }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-projection-clock-'));
  await writeFile(path.join(root, 'index.html'), `<!doctype html>
    <textarea id="edit"></textarea><iframe id="veFrame" srcdoc='<p data-smu1-binding-id="text">Original</p>'></iframe>
    <script>
      window.projectionDelay=0; window.project=true;
      edit.oninput=()=>{const value=edit.value;if(window.project)setTimeout(()=>{
        const target=veFrame.contentDocument.querySelector('p');
        const replacement=target.cloneNode();replacement.textContent=value;target.replaceWith(replacement);
      },window.projectionDelay);};
    </script>`);
  const server = await createDistServer({ distRoot: root }), browser = await new CdpBrowser().start();
  try {
    await browser.navigate(server.origin + '/');
    await browser.evaluate(`new Promise(resolve => {const frame=document.querySelector('#veFrame');if(frame.contentDocument?.querySelector('p'))resolve();else frame.onload=resolve;})`);
    const settings = { inputSelector: '#edit', bindingId: 'text', value: 'Fresh immediate', expected: 'Fresh immediate' };
    const delayedTransport = { evaluate: async (expression) => {
      const value = await browser.evaluate(expression);
      await new Promise(resolve => setTimeout(resolve, 150));
      return value;
    } };
    const immediate = await measureTextProjection(delayedTransport, settings);
    assert.equal(immediate.projected, settings.expected);
    assert.equal(immediate.clock, 'browser-performance-input-to-dom');
    assert.ok(immediate.wallMs - immediate.elapsedMs >= 140, 'CDP response delay is excluded from feedback');
    await assert.rejects(measureTextProjection(browser, settings), /marker must be new/);
    await browser.evaluate('window.projectionDelay=160');
    const slow = await measureTextProjection(browser, { ...settings, value: 'Slow update', expected: 'Slow update' });
    assert.ok(slow.elapsedMs >= 150, 'real delayed projection exceeds the unchanged 100 ms feedback budget');
    await browser.evaluate('window.project=false');
    await assert.rejects(measureTextProjection(browser, { ...settings, value: 'Missing update', expected: 'Missing update', timeoutMs: 150 }), /Timed out waiting for text projection/);
    await assert.rejects(measureTextProjection(browser, { ...settings, bindingId: 'missing' }), /unavailable/);
  } finally {
    await browser.close(); await server.close();
    // The exact directory was freshly returned by mkdtemp for this test only.
    await rm(root, { recursive: true, force: true });
  }
});

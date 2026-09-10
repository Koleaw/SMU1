import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CdpBrowser, createDistServer, preferredChromePath } from './cdp-browser.mjs';
import { clickWhenReady } from './actionable-click.mjs';

test('coordinate clicks wait for motion, visibility and hit-testing, then activate exactly once', { skip: !preferredChromePath() }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'smu1-actionable-'));
  await writeFile(path.join(root, 'index.html'), `<!doctype html><button id="target" style="position:absolute;top:1200px;left:20px">Target</button><div id="cover" style="position:fixed;inset:0;z-index:4"></div><script>window.count=0;target.onclick=()=>window.count++;</script>`);
  const server = await createDistServer({ distRoot: root }), browser = await new CdpBrowser().start();
  try {
    await browser.navigate(server.origin + '/');
    await assert.rejects(clickWhenReady(browser, '#target', { timeoutMs: 250 }), /covered/);
    assert.equal(await browser.evaluate('window.count'), 0);
    await browser.evaluate(`cover.remove(); target.disabled=true;`);
    await assert.rejects(clickWhenReady(browser, '#target', { timeoutMs: 250 }), /unavailable/);
    await browser.evaluate(`target.disabled=false; const start=performance.now(); const move=now=>{target.style.left=(20+Math.min(1,(now-start)/250)*450)+'px';if(now-start<250)requestAnimationFrame(move);};requestAnimationFrame(move);`);
    await clickWhenReady(browser, '#target');
    assert.equal(await browser.evaluate('window.count'), 1);
    assert.equal(await browser.evaluate('parseFloat(target.style.left)'), 470);
    await browser.evaluate('target.hidden=true');
    await assert.rejects(clickWhenReady(browser, '#target', { timeoutMs: 150 }), /unavailable/);
    assert.equal(await browser.evaluate('window.count'), 1);
  } finally {
    await browser.close(); await server.close();
    // mkdtemp returned this exact owned test directory.
    await rm(root, { recursive: true, force: true });
  }
});

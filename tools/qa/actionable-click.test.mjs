import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CdpBrowser, createDistServer, preferredChromePath } from './cdp-browser.mjs';
import { clickWhenReady, visibleClickPoint } from './actionable-click.mjs';

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
    await browser.evaluate(`target.hidden=false; target.style.cssText='position:fixed;top:85vh;left:70vw;width:50vw;height:50vh';`);
    const clippedPoint = await clickWhenReady(browser, '#target', { scroll: false });
    const clipped = await browser.evaluate('({width:innerWidth,height:innerHeight,rect:target.getBoundingClientRect().toJSON(),count:window.count})');
    assert.ok(clipped.rect.top + clipped.rect.height / 2 > clipped.height, 'full centre is outside the viewport');
    assert.ok(clippedPoint.x < clipped.width && clippedPoint.y < clipped.height, 'native click stays in the visible intersection');
    assert.equal(clipped.count, 2);
    await browser.evaluate(`{
      const clip=document.createElement('div'); clip.style.cssText='position:fixed;left:20px;top:20px;width:80px;height:80px;overflow:hidden';
      clip.innerHTML='<button id="clipped" style="position:absolute;left:100px;top:100px;width:40px;height:40px">Clipped</button><button id="visible" style="position:absolute;left:10px;top:10px">Visible</button>';
      document.body.append(clip);
    }`);
    const candidates = await browser.evaluate(`['clipped','visible'].map(id=>({id,point:(${visibleClickPoint.toString()})(document.getElementById(id))}))`);
    assert.deepEqual(candidates.filter(candidate=>candidate.point.ready).map(candidate=>candidate.id), ['visible'], 'selection excludes a target clipped by its ancestor, despite its on-screen bounding box');
  } finally {
    await browser.close(); await server.close();
    // mkdtemp returned this exact owned test directory.
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CdpBrowser, createDistServer, preferredChromePath } from './cdp-browser.mjs';
import { adminControlPostcondition } from './admin-action-state.mjs';
import { prepareAdminAction, adminActionStateExpression, armAdminActionTraceExpression } from './admin-action-preparation.mjs';

test('clipped shell overlay reveals its iframe source and dispatches once to the exact stable control', {skip:!preferredChromePath()}, async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'smu1-admin-action-preparation-'));
  const markup=`<!doctype html><html><body style="margin:0"><div id="veApp"><div id="veCanvasScroller" style="position:absolute;left:260px;top:100px;width:1000px;height:600px;overflow:auto"><div id="veCanvasViewport" style="position:relative;width:1440px;height:580px"><iframe id="veFrame" style="border:0;width:100%;height:100%" src="/canvas.html"></iframe><div id="veOverlay" style="position:absolute;inset:0;overflow:clip;pointer-events:none"></div></div></div><div id="veInlineEditor" hidden></div></div><script>
  window.counts={target:0,handle:0,move:0};
  const update=()=>{const source=veFrame.contentDocument.querySelector('[data-smu1-binding-id]');const rect=source.getBoundingClientRect();veOverlay.replaceChildren();for(const key of ['target','handle','move-Home']){const b=document.createElement('button');b.dataset.bindingId='home:landscaping';b.dataset.controlKey=key;b.className=key==='target'?'ve-overlay-target':key==='handle'?'ve-reorder-handle':'';b.setAttribute('aria-pressed','false');b.textContent=key;b.style.cssText='position:absolute;pointer-events:auto;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;';if(key!=='target'){b.style.width='44px';b.style.height='44px';b.style.zIndex='2';b.style.left=(rect.left+(key==='handle'?4:rect.width-48))+'px';}b.onclick=()=>{counts[key==='move-Home'?'move':key]++;if(key==='target'){b.setAttribute('aria-pressed','true');veInlineEditor.hidden=false;veInlineEditor.dataset.bindingId='home:landscaping';}};veOverlay.append(b);}};
  veFrame.onload=()=>{veFrame.contentWindow.addEventListener('scroll',()=>requestAnimationFrame(update));update();document.body.dataset.ready='true';};
  </script></body></html>`;
  await writeFile(path.join(root,'index.html'),markup);
  await writeFile(path.join(root,'canvas.html'),`<!doctype html><body style="height:3500px;margin:0"><div data-smu1-binding-id="home:landscaping" data-smu1-binding='{"tool":"short-text","bindingId":"home:landscaping"}' style="position:absolute;top:2244px;left:30px;width:1300px;height:100px">Editable source</div></body>`);
  const server=await createDistServer({distRoot:root}), browser=await new CdpBrowser().start();
  const action=key=>({context:'shell',containerId:'veOverlay',tag:'button',dataAttributes:{'data-binding-id':'home:landscaping','data-control-key':key}});
  try{
    await browser.setViewport({width:1440,height:900,mobile:false});
    await browser.navigate(server.origin+'/');
    const readyDeadline=Date.now()+5000;
    while(!await browser.evaluate("document.body.dataset.ready==='true'")){if(Date.now()>readyDeadline)throw Error('fixture iframe not ready');await new Promise(resolve=>setTimeout(resolve,20));}
    assert.ok(await browser.evaluate("document.querySelector('[data-control-key=target]').getBoundingClientRect().top > innerHeight"));
    await browser.evaluate(armAdminActionTraceExpression());
    const target=await prepareAdminAction(browser,action('target'));
    assert.equal(target.executable,true,JSON.stringify(target));
    assert.deepEqual(target.matched,{bindingId:'home:landscaping',controlKey:'target'});
    assert.ok(target.point.y<900&&target.point.y>100);
    assert.ok(await browser.evaluate('veFrame.contentWindow.scrollY > 1500'));
    assert.equal(await browser.evaluate('veOverlay.scrollTop'),0,'the clipped overlay is never scrolled');
    await browser.dispatchClick(target.point);
    const after=await browser.evaluate(adminActionStateExpression(action('target')));
    const trace=await browser.evaluate('window.__h6AdminActionTrace.events');
    assert.equal(adminControlPostcondition(action('target'),target.before,after,[],trace),true);
    assert.deepEqual(await browser.evaluate('window.counts'),{target:1,handle:0,move:0});
    await browser.evaluate("veFrame.contentDocument.querySelector('[data-smu1-binding-id]').style.height='1800px';veFrame.contentWindow.scrollTo(0,0)");
    await browser.evaluate(armAdminActionTraceExpression());
    const handle=await prepareAdminAction(browser,action('handle'));
    assert.ok(handle.point.y>=100&&handle.point.y<700,'tall-source top-anchored handle remains inside the canvas');
    assert.equal(handle.executable,true,JSON.stringify(handle));
    assert.ok(handle.point.x>=260&&handle.point.x<1260,'left handle is revealed in the narrower horizontal canvas scrollport');
    assert.equal(handle.active,false,'click readiness must not focus the handle programmatically');
    await browser.dispatchClick(handle.point);
    assert.equal(adminControlPostcondition(action('handle'),handle.before,await browser.evaluate(adminActionStateExpression(action('handle'))),[],await browser.evaluate('window.__h6AdminActionTrace.events')),true);
    const move=await prepareAdminAction(browser,action('move-Home'));
    assert.equal(move.executable,true,JSON.stringify(move));
    assert.equal(move.matched.controlKey,'move-Home');
    assert.ok(move.point.x>=260&&move.point.x<1260,'right move control is revealed in the same scrollport');
    await browser.dispatchClick(move.point);
    assert.deepEqual(await browser.evaluate('window.counts'),{target:1,handle:1,move:1});
    await browser.evaluate("const cover=document.createElement('div');cover.id='cover';cover.style.cssText='position:fixed;inset:0;z-index:100';document.body.append(cover)");
    const covered=await prepareAdminAction(browser,action('target'),{timeoutMs:250});
    assert.equal(covered.executable,false);
    assert.equal(covered.reason,'covered');
    assert.deepEqual(await browser.evaluate('window.counts'),{target:1,handle:1,move:1});
  }finally{
    await browser.close();await server.close();
    // Exact mkdtemp-owned fixture, including its isolated iframe document.
    await rm(root,{recursive:true,force:true});
  }
});

test('overlay preparation waits for real iframe fonts and rechecks a hover-induced move before one native click', {skip:!preferredChromePath()}, async()=>{
  const font=await readFile(new URL('../../public/assets/fonts/manrope/manrope-400-latin-cyrillic.woff2',import.meta.url));
  let releaseFont;
  const shell=`<!doctype html><body style="margin:0"><div id="veApp"><iframe id="veFrame" src="/canvas" style="position:absolute;inset:0;width:100%;height:800px;border:0"></iframe><div id="veOverlay" style="position:absolute;inset:0;pointer-events:none"></div><div id="veInlineEditor" hidden></div></div><script>
    window.counts={target:0,blocker:0,hover:0};
    const update=()=>{const source=veFrame.contentDocument.querySelector('[data-smu1-binding-id]'),r=source.getBoundingClientRect();let b=veOverlay.querySelector('button');if(!b){b=document.createElement('button');b.dataset.bindingId='home:cta';b.dataset.controlKey='target';b.className='ve-overlay-target';b.textContent='Edit CTA';b.setAttribute('aria-pressed','false');b.onclick=()=>{counts.target++;b.setAttribute('aria-pressed','true');veInlineEditor.hidden=false;veInlineEditor.dataset.bindingId='home:cta';};b.onpointerenter=()=>{if(!counts.hover){counts.hover++;source.style.top='471px';update();}};veOverlay.append(b);}b.style.cssText='position:absolute;pointer-events:auto;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px';};
    addEventListener('message',event=>{if(event.data==='ready'){update();document.body.dataset.ready='true';}if(event.data==='font-ready')update();});
  </script>`;
  const canvas=`<!doctype html><style>@font-face{font-family:QA;src:url('/font.woff2')}body{margin:0}#source{position:absolute;top:350px;left:300px;width:200px;height:36px;font:20px QA}</style><div id="source" data-smu1-binding-id="home:cta" data-smu1-binding='{"tool":"short-text"}'>Second CTA</div><script>
    document.fonts.load('20px QA').then(()=>{source.style.top='401px';parent.postMessage('font-ready','*');});parent.postMessage('ready','*');
  </script>`;
  const server=createServer((req,res)=>{
    if(req.url==='/font.woff2'){releaseFont=()=>{if(!res.writableEnded)res.writeHead(200,{'content-type':'font/woff2'}).end(font);};return;}
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(req.url==='/canvas'?canvas:shell);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=new CdpBrowser();
  try{
    await browser.start();await browser.setViewport({width:1440,height:900,mobile:false});
    await browser.navigate('http://127.0.0.1:'+server.address().port+'/');
    const deadline=Date.now()+5000;
    while(!releaseFont||!await browser.evaluate("document.body.dataset.ready==='true'")){if(Date.now()>deadline)throw Error('delayed font fixture not ready');await new Promise(r=>setTimeout(r,20));}
    assert.equal(await browser.evaluate('veFrame.contentDocument.fonts.status'),'loading');
    const action={context:'shell',containerId:'veOverlay',tag:'button',dataAttributes:{'data-binding-id':'home:cta','data-control-key':'target'}};
    await browser.evaluate(armAdminActionTraceExpression());
    let settled=false;
    const pending=prepareAdminAction(browser,action).then(value=>{settled=true;return value;});
    await new Promise(r=>setTimeout(r,100));
    assert.equal(settled,false,'a fallback-font position must not be reported actionable');
    releaseFont();
    const prepared=await pending;
    assert.equal(prepared.executable,true,JSON.stringify(prepared));
    assert.equal(prepared.point.y,489,'the final point accounts for both the font and hover moves');
    assert.deepEqual(await browser.evaluate('window.counts'),{target:0,blocker:0,hover:1},'preparation has not clicked');
    await browser.dispatchClick(prepared.point);
    assert.equal(adminControlPostcondition(action,prepared.before,await browser.evaluate(adminActionStateExpression(action)),[],await browser.evaluate('window.__h6AdminActionTrace.events')),true);
    assert.deepEqual(await browser.evaluate('window.counts'),{target:1,blocker:0,hover:1},'exactly one native click reached the intended control');
  }finally{releaseFont?.();await browser.close();await new Promise(resolve=>server.close(resolve));}
});

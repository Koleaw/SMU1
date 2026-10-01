import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {waitForRenderedTool} from './rendered-tool-ready.mjs';
import {comparableBusinessText} from './route-passport-equivalence.mjs';

function fixture({absent=false}={}) {
  let changed,expire,disconnected=false,timerCleared=false;
  const nodes={ '[data-error]':{hidden:true,textContent:''}, '[data-save-status]':{textContent:'Загрузка инструмента…'} };
  const root={dataset:{ready:'true',toolId:'maf'},querySelector:key=>nodes[key]};
  const promise=vm.runInNewContext(`(${waitForRenderedTool.toString()})(8000)`,{
    document:{querySelector:()=>absent?null:root},
    MutationObserver:class {constructor(callback){changed=callback;}observe(){}disconnect(){disconnected=true;}},
    setTimeout(callback){expire=callback;return 7;},clearTimeout(id){assert.equal(id,7);timerCleared=true;}
  });
  return {promise,nodes,change:()=>changed(),expire:()=>expire(),clean:()=>disconnected&&timerCleared};
}
test('ready marker alone cannot hide a still-loading catalogue; actual results release the observer',async()=>{
  const f=fixture();let settled=false;f.promise.then(()=>settled=true);
  await Promise.resolve();assert.equal(settled,false);
  Object.assign(f.nodes,{'[data-summary] dl':{},'[data-result-table] table':{},'[data-fields]':{children:[{}]},'[data-action="cancel"]':{hidden:true},'[data-action="csv"]':{disabled:false}});
  f.change();assert.equal(await f.promise,true);assert.equal(f.clean(),true);
});
test('invalid and stalled tools fail instead of being classified as equivalent empty shells',async()=>{
  const broken=fixture();broken.nodes['[data-error]']={hidden:false,textContent:'Каталог не загрузился'};
  broken.change();await assert.rejects(broken.promise,/Каталог не загрузился/u);assert.equal(broken.clean(),true);
  const stalled=fixture();stalled.expire();await assert.rejects(stalled.promise,/within 8000 ms/u);assert.equal(stalled.clean(),true);
  assert.equal(await fixture({absent:true}).promise,true);
});
test('only map transport status is transient; address and business text remain compared',async()=>{
  const source=await readFile(new URL('./route-passport-browser.mjs',import.meta.url),'utf8');
  assert.match(source,/element\.closest\('\[data-v2-map-status\],\[data-v2-map-message\]'\)\) return 'map-loading-status'/u);
  assert.doesNotMatch(source,/element\.closest\('\[data-v2-yandex-map\]'\)\) return 'map-loading-status'/u);
  const snapshot=status=>({businessOccurrences:[{text:'Курган, улица Промышленная'},{text:status,runtimeSurface:'map-loading-status'}]});
  assert.deepEqual(comparableBusinessText(snapshot('Загружаем карту…')),comparableBusinessText(snapshot('Карта загружена.')));
  assert.deepEqual(comparableBusinessText(snapshot('Карта загружена.')),['Курган, улица Промышленная']);
});

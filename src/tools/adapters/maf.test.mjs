import test from 'node:test';
import assert from 'node:assert/strict';
import {prepare,calculate,example} from './maf.mjs';
test('H5 display and absolute links do not modify a saved catalogue snapshot',async()=>{
  const input=structuredClone(example),before=structuredClone(input),live={...input.rows[0].snapshot,thumbnail:'/_media/h5/bench-320.webp'};
  const fetchBefore=globalThis.fetch,locationBefore=globalThis.location;
  globalThis.fetch=async()=>({ok:true,json:async()=>({products:[live],categories:[]})});
  globalThis.location={hash:''};
  try{
    const root={dataset:{base:'/SMU1/',publicBase:'https://koleaw.github.io/SMU1/'}};
    await prepare(root,input);const result=calculate(input,root);
    assert.deepEqual(input,before);assert.equal(result.rows[0].snapshot.thumbnail,live.thumbnail);
    assert.equal(result.rows[0].href,'https://koleaw.github.io/SMU1/ulichnaya-mebel/lavochki-i-skameyki/skamya-park/');
    assert.equal(input.rows[0].snapshot.href,'/ulichnaya-mebel/lavochki-i-skameyki/skamya-park/');
  }finally{globalThis.fetch=fetchBefore;if(locationBefore===undefined)delete globalThis.location;else globalThis.location=locationBefore;}
});

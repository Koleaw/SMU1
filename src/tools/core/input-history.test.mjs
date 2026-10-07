import test from 'node:test';
import assert from 'node:assert/strict';
import { inputHistory } from './input-history.mjs';
test('history groups typing, preserves invalid drafts and mode states, supports redo and bounded independent projects',()=>{
  const h=inputHistory({type:'slab',x:10},3),other=inputHistory({x:1});
  h.record({type:'slab',x:''},'x',1);h.record({type:'slab',x:'2'},'x',2);h.record({type:'slab',x:'20'},'x',3);
  h.record({type:'polygon',x:'20'});assert.deepEqual(h.undo(),{type:'slab',x:'20'});assert.deepEqual(h.undo(),{type:'slab',x:10});assert.equal(h.undo(),null);assert.equal(other.undo(),null);
  assert.deepEqual(h.redo(),{type:'slab',x:'20'});h.record({type:'slab',x:''});assert.equal(h.canRedo,false);assert.equal(h.undo().x,'20');
  for(let x=0;x<10;x++)h.record({x});assert.equal(h.undo().x,8);assert.equal(h.undo().x,7);assert.equal(h.undo().x,6);assert.equal(h.undo(),null);
});

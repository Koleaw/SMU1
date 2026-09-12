import assert from 'node:assert/strict';
import test from 'node:test';
import { findAdminActionElement, adminControlPostcondition } from './admin-action-state.mjs';
import { visibleClickPoint } from './actionable-click.mjs';

const action = key => ({context:'shell',containerId:'veOverlay',tag:'button',dataAttributes:{'data-binding-id':'home:landscaping','data-control-key':key}});
const native = key => [{type:'click',isTrusted:true,bindingId:'home:landscaping',controlKey:key}];
const state = value => JSON.stringify(value);
const node = (binding,key) => ({getAttribute:name=>({'data-binding-id':binding,'data-control-key':key})[name] ?? null});
const doc = nodes => ({getElementById:()=>({querySelectorAll:()=>nodes})});

test('reorder controls sharing a binding resolve by exact control key and reject ambiguity',()=>{
  const handle=node('home:landscaping','handle'), move=node('home:landscaping','move-Home'), target=node('home:landscaping','target');
  assert.equal(findAdminActionElement(doc([handle,move,target]),action('move-Home')),move);
  assert.equal(findAdminActionElement(doc([handle,move,target]),action('target')),target);
  assert.equal(findAdminActionElement(doc([handle,move,target]),action('move-End')),null);
  assert.equal(findAdminActionElement(doc([move,node('home:landscaping','move-Home')]),action('move-Home')),null);
});

test('observed CI points outside 1440 by 900 are rejected before any hit or native click',()=>{
  for(const y of [993,2244.015625,4976.3125,5098.03125]) {
    let hits=0;
    const element={ownerDocument:{defaultView:{innerWidth:1440,innerHeight:900},elementFromPoint:()=>{hits++;return null}},getBoundingClientRect:()=>({left:350,right:394,top:y,bottom:y+44})};
    assert.deepEqual(visibleClickPoint(element),{ready:false,reason:'outside-viewport'});
    assert.equal(hits,0);
  }
});

test('on-screen coordinates clipped by the overlay ancestor are not actionable',()=>{
  const element={ownerDocument:{defaultView:{innerWidth:1440,innerHeight:900},elementFromPoint:()=>({tagName:'IFRAME',closest:()=>null,getAttribute:()=>null})},getBoundingClientRect:()=>({left:350,right:394,top:300,bottom:344}),contains:()=>false};
  assert.equal(visibleClickPoint(element).ready,false);
});

test('unrelated MP4 requests and status announcements cannot prove a generic UI action',()=>{
  const before=state({dialogs:0,status:[]}), after=state({dialogs:0,status:['Предпросмотр: Компьютер, 1440 на 900.']});
  const requests=[{method:'GET',resourceType:'Media',url:{pathname:'/uploads/background.mp4'}}];
  assert.equal(adminControlPostcondition({},before,before,requests),false);
  assert.equal(adminControlPostcondition({},before,after,requests),false);
  assert.equal(adminControlPostcondition({},before,before,99),false);
  assert.equal(adminControlPostcondition({},before,state({dialogs:1,status:[]}),[]),true);
});

test('exact binding selection requires both trusted activation and the matching open editor',()=>{
  const before=state({selectedBinding:'',dialogs:0});
  const after=state({selectedBinding:'home:landscaping',inlineBinding:'home:landscaping',dialogs:0});
  assert.equal(adminControlPostcondition(action('target'),before,after,[],native('target')),true);
  assert.equal(adminControlPostcondition(action('target'),before,after,[],native('handle')),false);
  assert.equal(adminControlPostcondition(action('target'),before,after,[],[{...native('target')[0],isTrusted:false}]),false);
  assert.equal(adminControlPostcondition(action('target'),before,state({selectedBinding:'another',dialogs:1}),[],native('target')),false);
  assert.equal(adminControlPostcondition(action('target'),before,state({selectedBinding:'home:landscaping',dialogs:0}),[],native('target')),false);
  const selectedClosed=state({selectedBinding:'home:landscaping',dialogs:0,inspectorOpen:false});
  assert.equal(adminControlPostcondition(action('target'),selectedClosed,state({selectedBinding:'home:landscaping',dialogs:1}),[],native('target')),true);
  assert.equal(adminControlPostcondition(action('target'),after,after,[],native('target')),false,'an already open unchanged field is not a newly opened editor');
});

test('native drag-handle click proves only exact active focus, never an Enter reorder action',()=>{
  assert.equal(adminControlPostcondition(action('handle'),state({active:true}),state({active:true}),[],native('handle')),true);
  assert.equal(adminControlPostcondition(action('handle'),state({active:true}),state({active:false}),[],native('handle')),false);
  assert.equal(adminControlPostcondition(action('handle'),state({active:true}),state({active:true}),[],[{type:'keydown',isTrusted:true,key:'Enter'}]),false);
});

test('move controls require their exact projected order, including evidenced boundary no-ops',()=>{
  const snapshot=(orderedIds,identity='b')=>state({reorder:{zoneId:'home-directions',orderedIds,identity}});
  const before=snapshot(['a','b','c']);
  for(const [key,expected] of [['move-Home',['b','a','c']],['move-End',['a','c','b']],['move-ArrowUp',['b','a','c']],['move-ArrowDown',['a','c','b']]]) {
    assert.equal(adminControlPostcondition(action(key),before,snapshot(expected),[],native(key)),true,key);
    assert.equal(adminControlPostcondition(action(key),before,before,[],native(key)),false,key);
    assert.equal(adminControlPostcondition(action(key),before,snapshot(expected),[],native('handle')),false,key);
  }
  const start=snapshot(['a','b','c'],'a'), end=snapshot(['a','b','c'],'c');
  for(const [key,edge] of [['move-Home',start],['move-ArrowUp',start],['move-End',end],['move-ArrowDown',end]]) {
    assert.equal(adminControlPostcondition(action(key),edge,edge,[],native(key)),true,key);
    assert.equal(adminControlPostcondition(action(key),edge,edge,[],[]),false,key);
  }
});


test('unrelated global hidden changes cannot prove a shell dialog action',()=>{
  const picker={domId:'vePagePicker'};
  const before=state({dialogs:0,hidden:6,canvasDocument:1,status:[]});
  assert.equal(adminControlPostcondition(picker,before,state({dialogs:0,hidden:5,canvasDocument:1,status:[]}),[]),false);
  assert.equal(adminControlPostcondition(picker,before,state({dialogs:1,hidden:5,canvasDocument:1,status:[]}),[]),true);
});

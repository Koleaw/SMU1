import test from 'node:test';
import assert from 'node:assert/strict';
import { polygon, network } from './foundation-geometry.mjs';
import { calculate, example } from './foundation.mjs';
import { defaultShapes, rectangle, lShape, bridge } from './foundation-shapes.mjs';
import { format } from '../core/numbers.mjs';
import { csv, createProject, serialize, parseFile } from '../core/projects.mjs';
import * as adapter from '../adapters/fundament.mjs';

const clone=structuredClone;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const perimeter=g=>g.edges.reduce((s,e)=>s+e.length,0)/1000;
const contour=vertices=>({closed:true,vertices:vertices.map(([x,y])=>({x,y}))});
const input=type=>({...clone(example),type,shapes:defaultShapes()});
const net=segments=>({segments:segments.map(([x1,y1,x2,y2])=>({x1,y1,x2,y2})),footprint:{closed:false,vertices:[]}});

test('independent polygon standards: rectangle, triangle, L and U; all perimeter and volumes',()=>{
  const standards=[
    [rectangle,48,28],
    [contour([[0,0],[4000,0],[0,3000]]),6,12],
    [lShape,36,28],
    [contour([[0,0],[2000,0],[2000,4000],[6000,4000],[6000,0],[8000,0],[8000,6000],[0,6000]]),32,36]
  ];
  for(const [p,area,length] of standards){
    const raw=input('polygon');raw.shapes.polygon=clone(p);
    const r=calculate(raw);near(r.totals.concreteAreaM2,area);near(r.totals.concreteVolumeM3,area*.25);near(r.totals.reserveVolumeM3,area*.25*.05);near(r.totals.formworkAreaM2,length*.25);near(perimeter(r.geometry),length);
    near(r.geometry.layers[0].areaM2,area);near(r.geometry.layers[0].volumeM3,area*.1);
    assert.deepEqual(calculate(r.input),r);assert.deepEqual(raw.shapes.polygon,p);
  }
});

test('polygon reflection, rotation of start, reverse order and translation preserve quantities',()=>{
  for(const p of [rectangle,lShape,contour([[0,0],[4000,0],[0,3000]])]){
    const base=polygon(p);
    for(const vertices of [p.vertices.slice().reverse(),[...p.vertices.slice(2),...p.vertices.slice(0,2)],p.vertices.map(v=>({x:-v.x,y:v.y})),p.vertices.map(v=>({x:v.x+10000,y:v.y-5000}))]){const r=polygon({...p,vertices});near(r.areaM2,base.areaM2);near(perimeter(r),perimeter(base));}
    assert.deepEqual(new Set(polygon({...p,vertices:p.vertices.slice().reverse()}).edges.map(e=>e.id)),new Set(base.edges.map(e=>e.id)));
  }
});

test('independent unions: rectangle ring, T, cross, one and several internal branches',()=>{
  const many=clone(bridge);many.segments.splice(4,1,{x1:3000,y1:0,x2:3000,y2:7600},{x1:6000,y1:0,x2:6000,y2:7600},{x1:0,y1:3800,x2:9600,y2:3800});
  const standards=[
    [{...clone(bridge),segments:bridge.segments.slice(0,4)},400,13.76,68.8],
    [net([[-2000,0,2000,0],[0,0,0,3000]]),1000,8,18],
    [net([[-2000,0,2000,0],[0,-2000,0,2000]]),1000,9,20],
    [bridge,400,16.64,82.4],
    [many,400,22.88,110.4]
  ];
  for(const [n,b,area,length] of standards){
    const raw=input('network');raw.shapes.network=clone(n);raw.stripWidth=b;raw.height=800;raw.formwork.height=800;raw.layers=[{id:'s',name:'Под лентой',area:'strip',thickness:100}];
    const r=calculate(raw);near(r.totals.concreteAreaM2,area);near(r.totals.concreteVolumeM3,area*.8);near(r.totals.formworkAreaM2,length*.8);near(perimeter(r.geometry),length);near(r.geometry.layers[0].areaM2,area);near(r.geometry.layers[0].volumeM3,area*.1);
    const reversed={...clone(n),segments:n.segments.slice().reverse().map(s=>({x1:s.x2,y1:s.y2,x2:s.x1,y2:s.y1}))};
    assert.deepEqual(network(reversed,b).edges,network(n,b).edges);
    const reflected={...clone(n),segments:n.segments.map(s=>({...s,x1:-s.x1,x2:-s.x2})),footprint:{...n.footprint,vertices:n.footprint.vertices.map(p=>({...p,x:-p.x}))}};
    const mirror=network(reflected,b);near(mirror.areaM2,area);near(perimeter(mirror),length);
  }
});

test('union boundaries are exposed only; duplicates and overlapping collinear segments do not add concrete',()=>{
  const n=net([[0,0,4000,0],[2000,0,6000,0],[0,0,4000,0]]),g=network(n,1000);
  near(g.areaM2,7);near(perimeter(g),16);assert.equal(g.edges.length,4);
  assert.deepEqual(new Set(g.edges.map(e=>[e.x1,e.y1,e.x2,e.y2].join(','))),new Set(['-500,-500,6500,-500','-500,500,6500,500','-500,-500,-500,500','6500,-500,6500,500']));
  const ring=network({...bridge,segments:bridge.segments.slice(0,4)},400);
  near(ring.edges.filter(e=>e.kind==='outer').reduce((s,e)=>s+e.length,0),36000);
  near(ring.edges.filter(e=>e.kind==='inner').reduce((s,e)=>s+e.length,0),32800);
});

test('union independent fine-cell oracle (not coordinate compression), 40 deterministic connected cases',()=>{
  for(let seed=1;seed<=40;seed++){
    let v=seed;const rnd=()=>{v=(v*1664525+1013904223)>>>0;return v;};
    const lines=[[0,0,6000,0]];for(let i=0;i<6;i++){const x=(rnd()%7)*1000;lines.push([x,0,x,(1+rnd()%6)*1000]);}
    const n=net(lines),cells=new Set();
    // 500 mm cells, independently enumerate each square-capped section.
    for(const [x1,y1,x2,y2] of lines)for(let x=Math.min(x1,x2)/500-1;x<Math.max(x1,x2)/500+1;x++)for(let y=Math.min(y1,y2)/500-1;y<Math.max(y1,y2)/500+1;y++)cells.add(`${x},${y}`);
    let p=0;for(const cell of cells){const [x,y]=cell.split(',').map(Number);for(const [a,b] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])if(!cells.has(`${a},${b}`))p+=.5;}
    const r=network(n,1000);near(r.areaM2,cells.size*.25);near(perimeter(r),p);
  }
});

test('surface subsets and explicit footprint: missing and undersized footprints fail',()=>{
  const raw=input('network');let r=calculate(raw);near(r.totals.footprintAreaM2,80);near(r.geometry.layers[0].volumeM3,8);
  raw.shapes.surfaces={mode:'selected',edges:[r.geometry.edges[0].id]};r=calculate(raw);near(r.totals.formworkAreaM2,r.geometry.edges[0].length/1000*.25);
  raw.shapes.surfaces.edges=['stale'];assert.throws(()=>calculate(raw),/Границы изменились/);
  raw.shapes.surfaces.mode='all';raw.shapes.network=net([[0,0,4000,0]]);assert.throws(()=>calculate(raw),/внешний контур/);
  raw.layers[0].area='strip';r=calculate(raw);assert.equal(r.totals.footprintAreaM2,null);near(r.geometry.layers[0].areaM2,1.76);
  raw.shapes.network.footprint=contour([[0,0],[4000,0],[4000,1000],[0,1000]]);assert.throws(()=>calculate(raw),/включать всю область/);
});

test('invalid contours never return a plausible quantity',()=>{
  for(const p of [
    {...rectangle,closed:false},contour([[0,0],[1,0]]),contour([[0,0],[1000,1000],[0,1000],[1000,0]]),contour([[0,0],[1000,0],[2000,0]]),contour([[0,0],[1000,0],[1000,0],[0,1000]]),
    contour([[0,0],[2000,0],[1000,0],[1000,1000],[0,1000]]),contour([[0,0],[2000,0],[2000,2000],[1000,0],[0,2000]]),{...rectangle,vertices:[...rectangle.vertices,rectangle.vertices[0]]},
    {...rectangle,vertices:Array(33).fill({x:0,y:0})}
  ])assert.throws(()=>polygon(p));
  for(const bad of ['',null,NaN,Infinity,'1e3','0.0001',100001,{},[]]){const p=clone(rectangle);p.vertices[0].x=bad;assert.throws(()=>polygon(p));}
  assert.throws(()=>polygon({...rectangle,holes:[]}));
  for(const n of [net([]),net([[0,0,0,0]]),net([[0,0,1,1]]),net([[0,0,1000,0],[5000,0,6000,0]]),net([[0,0,1000,0],[2000,1000,3000,1000]]),net(Array(33).fill([0,0,1000,0]))])assert.throws(()=>network(n,1000));
  for(const bad of [0,-1,'',null,Infinity,'0.001',100001])assert.throws(()=>network(net([[0,0,1000,0]]),bad));
});

test('micrometre inputs, square half-width, comma, SI conversions and display rounding',()=>{
  const p=contour([[99999,99999],[100000,99999],[100000,100000],[99999,100000]]);near(polygon(p).areaM2,.000001);
  assert.equal(format(polygon(p).areaM2),'1,00e-6','nonzero material must never be presented as zero');
  const n=net([[0,0,'1,001',0]]),g=network(n,'1,001');near(g.areaM2,2.002*1.001/1e6);near(g.edges[0].x1,-.5005);
  const raw=input('polygon');raw.shapes.polygon=contour([[0,0],['1234,567',0],['1234,567',1000],[0,1000]]);raw.height=100;raw.reservePercent=7.5;
  const r=calculate(raw);near(r.totals.concreteVolumeM3,.1234567);near(r.totals.reserveVolumeM3,.0092592525);assert.equal(format(r.totals.concreteVolumeM3),'0,123');near(r.totals.orderVolumeM3,.1327159525);
  assert.ok(csv(r).includes('1234,567'));assert.ok(csv(r).includes('Геометрия'));
});

test('legacy projects keep inputs and quantitative results; extension round-trips without evaluation',()=>{
  for(const old of [clone(adapter.example),{...clone(adapter.example),type:'strip',length:10000,width:8000,height:800,formwork:{outer:true,inner:true,height:800,outerSides:'0,1,2,3',innerSides:'0,1,2,3'}}]){
    const project=createProject('fundament',old,'Старый проект','1.0.0'),restored=parseFile(serialize([project])).projects[0];adapter.validateDraft(restored.input);const r=adapter.calculate(restored.input);
    near(r.totals.concreteVolumeM3,old.type==='strip'?11.008:12);assert.equal(restored.methodologyVersion,'1.0.0');assert.deepEqual(restored.input,old);
  }
  const draft={...clone(adapter.example),type:'network',shapes:defaultShapes()};adapter.validateDraft(draft);const project=createProject('fundament',draft,'Новый проект',adapter.methodologyVersion);
  assert.deepEqual(adapter.calculate(parseFile(serialize([project])).projects[0].input),adapter.calculate(draft));
  for(const extra of [{code:'alert(1)'},{shapes:{...draft.shapes,eval:'1'}}])assert.throws(()=>adapter.validateDraft({...draft,...extra}));
  draft.shapes.polygon.vertices[0].x='';adapter.validateDraft(draft);draft.type='polygon';assert.throws(()=>adapter.calculate(draft));
  const before=clone(draft.shapes);draft.type='strip';adapter.onInput(draft,'type');draft.type='polygon';adapter.onInput(draft,'type');assert.deepEqual(draft.shapes,before);
});

test('switching modes restores independent parameters, layers and surface selections',()=>{
  const raw={...clone(adapter.example),type:'strip',length:10000,width:8000,height:800};raw.layers[0].area='strip';raw.formwork.inner=true;
  const original=clone(raw);let before=clone(raw);raw.type='polygon';adapter.onInput(raw,'type',before);adapter.validateDraft(raw);
  assert.equal(raw.layers[0].area,'footprint');raw.height=250;raw.shapes.surfaces.mode='none';
  const vertices=clone(raw.shapes.polygon);before=clone(raw);raw.type='strip';adapter.onInput(raw,'type',before);adapter.validateDraft(raw);
  for(const key of Object.keys(original))assert.deepEqual(raw[key],original[key]);
  before=clone(raw);raw.type='polygon';adapter.onInput(raw,'type',before);adapter.validateDraft(raw);
  assert.equal(raw.height,250);assert.equal(raw.shapes.surfaces.mode,'none');assert.deepEqual(raw.shapes.polygon,vertices);
});

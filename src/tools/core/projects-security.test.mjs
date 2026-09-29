import test from 'node:test';
import assert from 'node:assert/strict';
import { bounded, parseFile, serialize, createProject, duplicateProject, validateProject, validateShape, writeProjects, readProjects, csvCell } from './projects.mjs';

const project=()=>createProject('metal',{rows:[]},'Расчёт цеха','1.0.0',{'steel-angles':'1.0.0'});
const stored=()=>{
  let value=serialize([project()]);
  return { getItem:()=>value, setItem:(_,next)=>{value=next;}, value:()=>value };
};

test('project envelope rejects coerced method versions, invalid flags and non-object snapshots',()=>{
  const source=project();
  for(const patch of [{id:''},{id:'  '},{methodologyVersion:['1.0.0']},{methodologyVersion:100},{imported:'false'},{imported:null},{snapshotText:{text:'untrusted'}},{snapshotText:1},{resultSnapshot:[]},{resultSnapshot:null},{input:null},{input:[]},{input:'unknown'}]){
    assert.throws(()=>validateProject({...source,...patch}),JSON.stringify(patch));
    assert.throws(()=>parseFile(serialize([{...source,...patch}])),JSON.stringify(patch));
  }
});

test('reference version values are bounded strings, including unfamiliar archival versions',()=>{
  const source=project();
  for(const referenceVersions of [{angles:null},{angles:1},{angles:{}},{angles:[]},{angles:''},{angles:'v'.repeat(121)}])assert.throws(()=>validateProject({...source,referenceVersions}));
  assert.doesNotThrow(()=>validateProject({...source,referenceVersions:{unfamiliar:'2023-05-01 / release-17'}}));
});

test('unknown historical methods remain opaque, unchanged and exportable',()=>{
  const old={...project(),methodologyVersion:'0.4.0',referenceVersions:{old:'2021'},input:{legacyGeometry:{dimension:'неизвестно',rows:[{oldField:17}]}},snapshotText:'Исторический результат: 123 кг',resultSnapshot:{unverifiedMass:123},imported:true};
  const before=structuredClone(old);
  const restored=parseFile(serialize([old])).projects[0];
  assert.deepEqual(restored,before);
  const copy=duplicateProject(restored);
  assert.notEqual(copy.id,old.id);
  assert.equal(copy.methodologyVersion,'0.4.0');
  assert.equal(copy.imported,true);
  assert.deepEqual(copy.input,old.input);
  assert.deepEqual(old,before);
});

test('strict draft shape rejects inherited Object property names as unknown fields',()=>{
  for(const key of ['toString','valueOf','hasOwnProperty','isPrototypeOf','toLocaleString','__defineGetter__'])assert.throws(()=>validateShape({x:1,[key]:'unexpected'},{x:1}),key);
  assert.throws(()=>validateShape(Object.create({x:1}),{x:1}));
  validateShape({x:'',unknown:null},{x:1,unknown:null});
});

test('unsupported prototypes and executable values cannot enter the structured store',()=>{
  for(const input of [new Date(),new Map(),new Set(),()=>1,Object.create({inherited:1})])assert.throws(()=>bounded(input));
  assert.throws(()=>bounded({toJSON(){return {safe:true};}}));
  assert.doesNotThrow(()=>bounded(Object.assign(Object.create(null),{safe:'data'})));
});

test('invalid write is rejected before touching a valid previous store',()=>{
  const storage=stored(),before=storage.value(),source=project();
  for(const entries of [[{...source,snapshotText:{}}],[source,structuredClone(source)],[{...source,input:{amount:Infinity}}],[{...source,input:{amount:NaN}}],{},null]){
    assert.throws(()=>writeProjects(storage,entries));
    assert.equal(storage.value(),before);
    assert.equal(readProjects(storage).length,1);
  }
});

test('storage failures propagate while leaving the caller project unchanged',()=>{
  const p=project(),before=structuredClone(p);
  const storage={setItem(){throw new Error('QuotaExceededError');}};
  assert.throws(()=>writeProjects(storage,[p]),/QuotaExceededError/);
  assert.deepEqual(p,before);
});

test('empty folder and maximum allowed folder roundtrip; excess is atomic',()=>{
  const storage=stored();
  writeProjects(storage,[]);
  assert.deepEqual(readProjects(storage),[]);
  const sixty=Array.from({length:60},project);
  writeProjects(storage,sixty);
  assert.deepEqual(readProjects(storage),sixty);
  const before=storage.value();
  assert.throws(()=>writeProjects(storage,[...sixty,project()]));
  assert.equal(storage.value(),before);
});

test('malicious and overdeep imported data are rejected without partial parse results',()=>{
  const p=project();
  for(const key of ['__proto__','constructor','prototype']){
    const raw=serialize([p]).replace('"rows": []',`"rows": [], "${key}": {"polluted":true}`);
    assert.throws(()=>parseFile(raw));
  }
  let deep='leaf';for(let i=0;i<14;i++)deep={nested:deep};
  assert.throws(()=>parseFile(serialize([{...p,input:deep}])));
  assert.equal({}.polluted,undefined);
});

test('CSV formula prefixes, quotes and newlines remain inert cells',()=>{
  for(const value of ['=1+1',' +SUM(A1)','\t@SUM(A1)','\uFEFF-2+3','\r=1'])assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('обычный "текст"\nвторая строка'),'"обычный ""текст""\nвторая строка"');
  assert.equal(csvCell(null),'"Не указано"');
});

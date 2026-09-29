import test from 'node:test';import assert from 'node:assert/strict';
import {parseFile,serialize,createProject,writeProjects,readProjects,validateShape,csvCell} from './projects.mjs';
test('независимые расчёты переживают запись/чтение',()=>{let saved='';const s={getItem:()=>saved,setItem:(k,v)=>saved=v};const p=createProject('metal',{rows:[]},'Расчёт','1.0.0');writeProjects(s,[p]);assert.deepEqual(readProjects(s),[p]);});
test('испорченный импорт не меняет хранилище',()=>{for(const data of ['{}','broken',serialize([{tool:'metal'}]),'{"format":"smu1-tools","version":1,"projects":[],"__proto__":{}}'])assert.throws(()=>parseFile(data));});
test('ошибка storage распространяется до UI',()=>assert.throws(()=>writeProjects({setItem(){throw new Error('QuotaExceededError');}},[])));
test('строгий черновик и инъекции CSV',()=>{validateShape({x:''},{x:1});assert.throws(()=>validateShape({x:1,y:2},{x:1}));assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell('  @SUM(A1)'),'"\'  @SUM(A1)"');});

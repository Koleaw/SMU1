import test from 'node:test';import assert from 'node:assert/strict';import {calculate,example,blank,addItem} from './maf.mjs';
const copy=x=>structuredClone(x);
test('пожелания отделены, цена неизвестна, разные исполнения остаются',()=>{const p=copy(example);p.rows.push({...copy(p.rows[0]),colorWish:'Красный',quantity:2});const r=calculate(p,[p.rows[0].snapshot]);assert.equal(r.rows.length,2);assert.equal(r.rows[0].subtotal,null);assert.equal(r.completeCost,false);assert.match(r.rows[0].wishes,/7016/);});
test('снимок изменений и удаления без подмены',()=>{const p=copy(example);assert.match(calculate(p,[]).rows[0].status,/отсутствует/);const live={...p.rows[0].snapshot,title:'Новое название'};const r=calculate(p,[live]);assert.match(r.rows[0].status,/изменились/);assert.equal(r.rows[0].name,'Скамья Парк');});
test('объединяется только совпадающий ID и конфигурация',()=>{const p=copy(blank);addItem(p,example.rows[0].snapshot);addItem(p,example.rows[0].snapshot);assert.equal(p.rows[0].quantity,2);p.rows[0].colorWish='Красный';addItem(p,example.rows[0].snapshot);assert.equal(p.rows.length,2);});
test('сравнение двух вариантов',()=>{const p=copy(example);p.alternative=copy(p.rows);p.alternative[0].quantity=2;assert.equal(calculate(p,[p.rows[0].snapshot]).comparison[0].difference,2);});
test('опасные ссылки/неверные количества отвергаются',()=>{for(const href of ['javascript:alert(1)','//evil.ru/x','/../x','/%2e%2e/x']){const p=copy(example);p.rows[0].snapshot.href=href;assert.throws(()=>calculate(p,[]));}const p=copy(example);p.rows[0].quantity='';assert.throws(()=>calculate(p,[]));});
test('фиксированная цена, «от» и отсутствующая цена не создают ложный окончательный итог',()=>{
  const p=copy(example);const r=p.rows[0];r.quantity=3;r.snapshot.priceMode='fixed';r.snapshot.priceFrom=1200;
  p.rows.push({...copy(r),quantity:2,snapshot:{...r.snapshot,priceMode:'from',priceFrom:700}});
  p.rows.push({...copy(r),snapshot:{...r.snapshot,priceMode:'on_request',priceFrom:null}});
  const result=calculate(p);assert.equal(result.knownCost,5000);assert.equal(result.rows[2].subtotal,null);assert.equal(result.completeCost,false);assert.match(result.summary[2].value,/^от /);assert.match(result.summary[2].label,/часть/);
});

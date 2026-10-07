import test from 'node:test'; import assert from 'node:assert/strict';
import {calculate,example,emptyRow} from './metal.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('ручные эталоны полосы и листа',()=>{const r=calculate(example);close(r.rows[0].massPerMetre,1.256);close(r.rows[0].mass,7.536);close(r.rows[1].massPerSheet,31.4);assert.equal(r.completeCost,false);assert.equal(r.rows[1].cost,null);});
test('единицы цены, кг/т/м/лист и нулевая известная цена',()=>{for(const [price,priceUnit,expected] of [[100,'kg',753.6],[100000,'t',753.6],[20,'m',120],[0,'kg',0]])close(calculate({rows:[{...example.rows[0],price,priceUnit}]}).knownCost,expected);close(calculate({rows:[{...example.rows[1],price:1200,priceUnit:'sheet',quantity:2}]}).knownCost,2400);});
test('таблица ГОСТ 8509-93 стр.2-3, независимые значения',()=>{for(const [angle,mass] of [['40x40x4',2.42],['50x50x5',3.77],['63x63x6',5.72]])close(calculate({rows:[{...emptyRow,shape:'angle',angle,length:1000}]}).totalMass,mass);});
test('запятая, пустые и неверные значения',()=>{close(calculate({rows:[{...example.rows[0],thickness:'4,0'}]}).totalMass,7.536);for(const length of ['',null,-1,Infinity,100001])assert.throws(()=>calculate({rows:[{...example.rows[0],length}]})); assert.throws(()=>calculate({rows:[{...example.rows[0],shape:'square',thickness:20}]}));});
test('снимок хранит использованную табличную массу; чрезмерный итог отклоняется',()=>{const r=calculate({rows:[{...emptyRow,shape:'angle',angle:'40x40x4',length:1000}]});assert.equal(r.coefficients.tabulatedProfiles[0].massKgM,2.42);assert.match(r.coefficients.tabulatedProfiles[0].source,/8509-93/);assert.throws(()=>calculate({rows:[{...emptyRow,shape:'known',massPerMetre:100000,length:100000,quantity:10000,price:1e9,priceUnit:'kg'}]}),/предел/);});
test('контроль одинаковой закупки по цене за метр, кг и тонну',()=>{
  for(const [price,priceUnit] of [[300,'m'],[80,'kg'],[80000,'t']]){
    const r=calculate({rows:[{...emptyRow,shape:'known',massPerMetre:3.75,length:2500,quantity:4,price,priceUnit}]});
    close(r.totalLength,10);close(r.totalMass,37.5);close(r.knownCost,3000);
  }
});
test('независимый лист 1,5 × 3 м × 2,5 мм: масса, цена, неполная ведомость',()=>{
  for(const [price,priceUnit] of [[80,'kg'],[80000,'t'],[7065,'sheet']]){
    const sheet={...emptyRow,shape:'sheet',width:1500,length:3000,thickness:2.5,quantity:3,price,priceUnit};
    const r=calculate({rows:[sheet]});close(r.totalMass,264.9375);close(r.knownCost,21195);assert.equal(r.totalLength,0);
    const partial=calculate({rows:[sheet,{...sheet,price:''}]});assert.equal(partial.completeCost,false);assert.equal(partial.rows[1].cost,null);close(partial.knownCost,21195);
  }
});
test('копейки округляются по позиции до суммирования; неизвестная цена не нулевая',()=>{
  const row={...emptyRow,shape:'known',massPerMetre:1,length:1000,price:0.335,priceUnit:'kg'};
  const r=calculate({rows:[row,row,row,{...row,price:''},{...row,price:0}]});
  assert.deepEqual(r.rows.map(r=>r.cost),[0.34,0.34,0.34,null,0]);assert.equal(r.knownCost,1.02);assert.equal(r.priced,4);assert.equal(r.completeCost,false);
});

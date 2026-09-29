import test from 'node:test'; import assert from 'node:assert/strict';
import {calculate,example,emptyRow} from './metal.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('ручные эталоны полосы и листа',()=>{const r=calculate(example);close(r.rows[0].massPerMetre,1.256);close(r.rows[0].mass,7.536);close(r.rows[1].massPerSheet,31.4);assert.equal(r.completeCost,false);assert.equal(r.rows[1].cost,null);});
test('единицы цены, кг/т/м/лист и нулевая известная цена',()=>{for(const [price,priceUnit,expected] of [[100,'kg',753.6],[100000,'t',753.6],[20,'m',120],[0,'kg',0]])close(calculate({rows:[{...example.rows[0],price,priceUnit}]}).knownCost,expected);close(calculate({rows:[{...example.rows[1],price:1200,priceUnit:'sheet',quantity:2}]}).knownCost,2400);});
test('таблица ГОСТ 8509-93 стр.2-3, независимые значения',()=>{for(const [angle,mass] of [['40x40x4',2.42],['50x50x5',3.77],['63x63x6',5.72]])close(calculate({rows:[{...emptyRow,shape:'angle',angle,length:1000}]}).totalMass,mass);});
test('запятая, пустые и неверные значения',()=>{close(calculate({rows:[{...example.rows[0],thickness:'4,0'}]}).totalMass,7.536);for(const length of ['',null,-1,Infinity,100001])assert.throws(()=>calculate({rows:[{...example.rows[0],length}]})); assert.throws(()=>calculate({rows:[{...example.rows[0],shape:'square',thickness:20}]}));});

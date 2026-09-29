import * as engine from '../calculations/maf.mjs';
import {clone} from '../core/numbers.mjs';
import {fields,field,group,rowActions,button,escape,table,format} from '../core/view.mjs';
export const {example,blank,methodologyVersion,referenceVersions,validateDraft}=engine;
export const rowTemplates={rows:engine.emptyRow,alternative:engine.emptyRow};
let catalogue=[],query='';
const basePath=(root,path)=>`${root.dataset.base}${path.replace(/^\//,'')}`;
export async function prepare(root,input){
  const response=await fetch(`${root.dataset.base}instrumenty/catalog.json`);if(!response.ok)throw new Error('Каталог не загрузился. Попробуйте перезагрузить страницу.');const data=await response.json();catalogue=data.products;
  if(!Array.isArray(catalogue)||catalogue.length>1000)throw new Error('Некорректный каталог.');catalogue.forEach(engine.validateSnapshot);
  for(const r of [...input.rows,...input.alternative]){const live=catalogue.find(p=>p.id===r.snapshot.id);if(live&&r.snapshot.image===live.image&&!r.snapshot.thumbnail)r.snapshot.thumbnail=live.thumbnail;}
  const params=new URLSearchParams(location.hash.slice(1)),id=params.get('add');if(id){const p=catalogue.find(p=>p.id===id);if(p){engine.addItem(input,p);params.delete('add');history.replaceState(history.state,'',location.pathname+(params.size?'#'+params:''));}}
}
export function calculate(input){return engine.calculate(input,catalogue);}
function productChoices(root){const q=query.trim().toLocaleLowerCase('ru-RU'),found=catalogue.filter(p=>`${p.title} ${p.materials}`.toLocaleLowerCase('ru-RU').includes(q));return `<p class="tool-hint">Найдено: ${found.length}. Опубликованные изделия СМУ-1.</p><div class="tool-catalog-results">${found.map(p=>`<div class="tool-catalog-row"><span>${escape(p.title)}</span>${button('maf-add','Добавить',`data-product="${escape(p.id)}"`)}</div>`).join('')}</div>`;}
export function form(input,root){
  const rows=(key,title)=>input[key].map((r,i)=>group(`${title} ${i+1} · ${r.snapshot.title}`,`<p class="tool-hint">Изделие каталога: ${escape(r.snapshot.id)}</p>`+fields(input,[field(`${key}.${i}.quantity`,'Количество',{unit:'шт.'}),field(`${key}.${i}.zone`,'Зона объекта',{type:'text'}),field(`${key}.${i}.sizeWish`,'Желаемые размеры',{type:'text'}),field(`${key}.${i}.colorWish`,'Желаемый цвет',{type:'text'}),field(`${key}.${i}.executionWish`,'Пожелания по исполнению',{type:'textarea',maxlength:1000})])+rowActions(key,i,input[key].length))).join('');
  return group('Найти изделие',`<label class="tool-field"><span>Поиск по каталогу</span><input type="search" value="${escape(query)}" data-maf-search maxlength="100" placeholder="Например, скамья" /></label><div data-maf-catalog>${productChoices(root)}</div>`)+fields(input,[field('variant','Название комплектации',{type:'text'})])+rows('rows','Позиция')+group('Сравнить два варианта',`<p class="tool-hint">Сделайте независимую копию состава и измените количества или пожелания ниже. Основной вариант сохранится.</p>${button('maf-alternative','Дублировать состав для сравнения')}`)+rows('alternative','Альтернатива');
}
export function bind(root,signal){root.addEventListener('input',e=>{if(e.target.matches('[data-maf-search]')){query=e.target.value;root.querySelector('[data-maf-catalog]').innerHTML=productChoices(root);}},{signal});}
export function diagram(result,input,active,root){return `<p class="tool-hint">Ведомость комплектации. Изображения иллюстративные, без масштаба: числовые габариты требуют согласования.</p><div class="tool-product-cards">${result.rows.map(r=>`<article class="tool-product-card">${r.snapshot.image?`<img src="${escape(basePath(root,r.snapshot.thumbnail||r.snapshot.image))}" alt="${escape(r.name)}" loading="lazy" width="260" height="160">`:''}<h3>${r.index}. ${escape(r.name)}</h3><p><strong>${r.quantity} шт.</strong> · ${escape(r.zone)}</p><p>Опубликовано: ${escape(r.characteristics)}</p><p><strong>Пожелания:</strong> ${escape(r.wishes)}</p><p>${escape(r.price)}</p><p>${escape(r.status)}</p><a href="${escape(basePath(root,r.href))}">Карточка изделия →</a></article>`).join('')}</div>`;}
export function extra(result){return result.extraTables.map(t=>`<h3>${escape(t.title)}</h3>${table(t)}`).join('');}
export function printDiagram(result,input,root){return diagram(result,input,'',root).replaceAll('loading="lazy"','loading="eager"');}
export const printColumns=[{key:'index',label:'№'},{key:'name',label:'Изделие'},{key:'quantity',label:'Шт.'},{key:'zone',label:'Зона'},{key:'wishes',label:'Пожелания'},{key:'price',label:'Цена за шт.'}];
export function action(action,{input,button:b}){if(action==='maf-add'){const p=catalogue.find(p=>p.id===b.dataset.product);if(p)engine.addItem(input,p);return true;}if(action==='maf-alternative'){input.alternative=clone(input.rows);return true;}return false;}

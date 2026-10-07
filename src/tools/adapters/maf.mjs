import * as engine from '../calculations/maf.mjs';
import {clone} from '../core/numbers.mjs';
import {fields,field,group,rowActions,button,escape,table,format} from '../core/view.mjs';
import {publicProductUrl} from '../core/urls.mjs';
export const {example,blank,methodologyVersion,referenceVersions,validateDraft}=engine;
export const rowTemplates={rows:engine.emptyRow,alternative:engine.emptyRow};
let catalogue=[],categories=[],query='',category='';
const alternativeUndo=new WeakMap();
const basePath=(root,path)=>`${root.dataset.base}${path.replace(/^\//,'')}`;
export async function prepare(root,input){
  const response=await fetch(`${root.dataset.base}instrumenty/catalog.json`);if(!response.ok)throw new Error('Каталог не загрузился. Попробуйте перезагрузить страницу.');const data=await response.json();catalogue=data.products;categories=data.categories||[];
  if(!Array.isArray(catalogue)||catalogue.length>1000)throw new Error('Некорректный каталог.');catalogue.forEach(engine.validateSnapshot);
  const params=new URLSearchParams(location.hash.slice(1)),id=params.get('add');if(id){const p=catalogue.find(p=>p.id===id);if(p){engine.addItem(input,p);params.delete('add');history.replaceState(history.state,'',location.pathname+(params.size?'#'+params:''));}}
}
export function calculate(input,root){
  const result=engine.calculate(input,catalogue);
  result.rows=result.rows.map(row=>{
    const live=catalogue.find(p=>p.id===row.snapshot.id);
    const thumbnail=row.snapshot.thumbnail||(live?.image===row.snapshot.image?live.thumbnail:'');
    return {...row,href:root?.dataset.publicBase?publicProductUrl(row.href,root.dataset.publicBase):row.href,snapshot:{...row.snapshot,thumbnail}};
  });
  return result;
}
function productChoices(root){
  const q=query.trim().toLocaleLowerCase('ru-RU'),ids=categories.find(c=>c.id===category)?.productIds;
  const found=catalogue.filter(p=>(!ids||ids.includes(p.id))&&`${p.title} ${p.materials}`.toLocaleLowerCase('ru-RU').includes(q));
  return `<p class="tool-hint" role="status">Найдено: ${found.length}. Добавление — 1 шт.; количество и зону можно изменить ниже.</p><div class="tool-catalog-results">${found.map(p=>`<article class="tool-catalog-row">${p.thumbnail?`<img src="${escape(basePath(root,p.thumbnail))}" alt="${escape(p.title)}" loading="lazy" decoding="async" width="96" height="80">`:'<span class="tool-hint">Фото уточняется</span>'}<div><strong>${escape(p.title)}</strong><p>${p.priceMode==='on_request'||p.priceFrom===null?'Цена по запросу':`${p.priceMode==='from'?'от ':''}${format(p.priceFrom)} ₽`}</p><a href="${escape(publicProductUrl(p.href,root.dataset.publicBase))}" target="_blank" rel="noopener noreferrer">Подробнее об изделии</a>${button('maf-add','Добавить 1 шт.',`data-product="${escape(p.id)}" aria-label="${escape(`Добавить: ${p.title}`)}"`)}</div></article>`).join('')||'<p class="tool-hint">Изделий не найдено. Измените запрос или выберите все категории.</p>'}</div>`;
}
export function form(input,root){
  const rows=(key,title)=>input[key].map((r,i)=>group(`${title} ${i+1} · ${r.snapshot.title}`,`<p class="tool-hint">Изделие каталога: ${escape(r.snapshot.id)}</p>`+fields(input,[field(`${key}.${i}.quantity`,'Количество',{unit:'шт.'}),field(`${key}.${i}.zone`,'Зона объекта',{type:'text'}),field(`${key}.${i}.sizeWish`,'Желаемые размеры',{type:'text'}),field(`${key}.${i}.colorWish`,'Желаемый цвет',{type:'text'}),field(`${key}.${i}.executionWish`,'Пожелания по исполнению',{type:'textarea',maxlength:1000})])+rowActions(key,i,input[key].length))).join('');
  return group('Добавить изделия в ведомость',`<label class="tool-field"><span>Категория изделий</span><select data-maf-category class="ym-disable-keys"><option value="">Все категории</option>${categories.map(c=>`<option value="${escape(c.id)}" ${c.id===category?'selected':''}>${escape(c.title)}</option>`).join('')}</select></label><label class="tool-field"><span>Поиск по каталогу</span><input type="search" class="ym-disable-keys" value="${escape(query)}" data-maf-search maxlength="100" placeholder="Например, скамья" /></label><div data-maf-catalog>${productChoices(root)}</div>`)+fields(input,[field('variant','Название комплектации',{type:'text'})])+rows('rows','Позиция')+group('Сравнить два варианта',`<p class="tool-hint">Сделайте независимую копию состава и измените количества или пожелания ниже. Основной вариант сохранится.</p>${button('maf-alternative',input.alternative.length?'Обновить альтернативу из основного состава':'Дублировать состав для сравнения')}${alternativeUndo.has(input)?button('maf-undo-alternative','Отменить обновление альтернативы'):''}`)+rows('alternative','Альтернатива');
}
export function bind(root,signal){root.addEventListener('input',e=>{if(e.target.matches('[data-maf-search]')){query=e.target.value;root.querySelector('[data-maf-catalog]').innerHTML=productChoices(root);}},{signal});root.addEventListener('change',e=>{if(e.target.matches('[data-maf-category]')){category=e.target.value;root.querySelector('[data-maf-catalog]').innerHTML=productChoices(root);}},{signal});}
export function diagram(result,input,active,root){return `<p class="tool-hint">Ведомость комплектации. Изображения иллюстративные, без масштаба: числовые габариты требуют согласования.</p><div class="tool-product-cards">${result.rows.map(r=>`<article class="tool-product-card">${r.snapshot.image?`<img src="${escape(basePath(root,r.snapshot.thumbnail||r.snapshot.image))}" alt="${escape(r.name)}" loading="lazy" width="260" height="160">`:''}<h3>${r.index}. ${escape(r.name)}</h3><p><strong>${r.quantity} шт.</strong> · ${escape(r.zone)}</p><p>Опубликовано: ${escape(r.characteristics)}</p><p><strong>Пожелания:</strong> ${escape(r.wishes)}</p><p>${escape(r.price)}</p><p>${escape(r.status)}</p><a href="${escape(r.href.startsWith('http')?r.href:publicProductUrl(r.href,root.dataset.publicBase))}">Карточка изделия →</a></article>`).join('')}</div>`;}
export function extra(result){return result.extraTables.map(t=>`<h3>${escape(t.title)}</h3>${table(t)}`).join('');}
export function printDiagram(result,input,root){return diagram(result,input,'',root).replaceAll('loading="lazy"','loading="eager"');}
export const printColumns=[{key:'index',label:'№'},{key:'name',label:'Изделие'},{key:'quantity',label:'Шт.'},{key:'zone',label:'Зона'},{key:'wishes',label:'Пожелания'},{key:'price',label:'Цена за шт.'}];
export function action(action,{input,button:b}){if(action==='maf-add'){const p=catalogue.find(p=>p.id===b.dataset.product);if(p)engine.addItem(input,p);return true;}if(action==='maf-alternative'){alternativeUndo.set(input,clone(input.alternative));input.alternative=clone(input.rows);return true;}if(action==='maf-undo-alternative'&&alternativeUndo.has(input)){input.alternative=alternativeUndo.get(input);alternativeUndo.delete(input);return true;}return false;}

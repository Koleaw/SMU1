import * as engine from '../calculations/metal.mjs';
import {field, fields,group,rowActions,button,svg,dim,txt,escape,format} from '../core/view.mjs';
export const {calculate,example,blank,methodologyVersion,referenceVersions}=engine;
export const rowTemplates={rows:engine.emptyRow};
export function onInput(input,path){if(path.endsWith('.shape')){const r=input.rows[Number(path.split('.')[1])];if(r.shape==='sheet'&&r.priceUnit==='m'||r.shape!=='sheet'&&r.priceUnit==='sheet')r.priceUnit='kg';}}
export function form(input) {
  return group('Сталь · 7 850 кг/м³','<p class="tool-hint">Номинальные размеры в миллиметрах. Цены необязательны; пустая цена означает «неизвестно».</p>')+input.rows.map((r,i)=>{
    const p=`rows.${i}.`, f=(key,label,o={})=>field(p+key,label,o);
    const defs=[f('name','Название',{type:'text'}),f('shape','Форма',{options:Object.entries(engine.shapes)})];
    if(['square','rectangle','strip','sheet'].includes(r.shape))defs.push(f('width',r.shape==='square'?'Сторона':'Ширина',{unit:'мм'}));
    if(r.shape==='rectangle')defs.push(f('height','Высота',{unit:'мм'}));
    if(['square','rectangle','strip','sheet','pipe'].includes(r.shape))defs.push(f('thickness','Толщина',{unit:'мм'}));
    if(['pipe','round'].includes(r.shape))defs.push(f('diameter','Диаметр',{unit:'мм'}));
    if(r.shape==='angle')defs.push(f('angle','Справочная позиция',{options:['40x40x4','50x50x5','63x63x6'].map(x=>[x,`${x.replaceAll('x',' × ')} мм`])}));
    if(r.shape==='known')defs.push(f('massPerMetre','Известная масса метра',{unit:'кг/м'}));
    defs.push(f('length',r.shape==='sheet'?'Длина листа':'Длина одной заготовки',{unit:'мм'}),f('quantity','Количество',{unit:'шт.'}),f('price','Цена',{unit:'₽',placeholder:'Неизвестна'}),f('priceUnit','Цена за',{options:[['kg','Килограмм'],['t','Тонну'],...(r.shape==='sheet'?[['sheet','Лист']]:[['m','Метр']])] }));
    return group(`Позиция ${i+1}`,fields(input,defs)+rowActions('rows',i,input.rows.length));
  }).join('')+button('add-row','+ Добавить позицию','data-path="rows"');
}
export function diagram(result,input,active='') {
  const i=Number(active.match(/^rows\.(\d+)/)?.[1]||0),r=result.rows[i]||result.rows[0], d=r.dimensions;
  if(r.shape==='known')return svg(txt(380,175,r.name,'text-anchor="middle"')+txt(380,225,`${format(r.massPerMetre)} кг/м · задано пользователем`,'text-anchor="middle"'),'Масса метра задана пользователем');
  const w=d.width||d.diameter,h=d.height||d.diameter||(r.shape==='sheet'?r.length:d.thickness), scale=Math.min(370/w,220/h), rw=w*scale,rh=h*scale,x=(760-rw)/2,y=100+(220-rh)/2,t=d.thickness*scale;
  let shape='';
  if(['pipe','round'].includes(r.shape))shape=`<circle cx="380" cy="210" r="${rw/2}" fill="var(--tool-ink)"/>${r.shape==='pipe'?`<circle cx="380" cy="210" r="${rw/2-t}" fill="var(--tool-paper)"/>`:''}`;
  else if(r.shape==='angle')shape=`<path d="M${x} ${y}h${t}v${rh-t}h${rw-t}v${t}H${x}Z" fill="var(--tool-ink)"/>`;
  else shape=`<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="var(--tool-ink)"/>${['square','rectangle'].includes(r.shape)?`<rect x="${x+t}" y="${y+t}" width="${rw-2*t}" height="${rh-2*t}" fill="var(--tool-paper)"/>`:''}`;
  return svg(txt(28,32,`${i+1}. ${r.designation}`)+shape+dim(x,350,x+rw,350,`${w} мм`,d.diameter?'diameter':'width',active)+(d.height||r.shape==='sheet'?`<g transform="translate(${x+rw+55} ${y+rh}) rotate(-90)">${dim(0,0,rh,0,`${h} мм`,r.shape==='sheet'?'length':'height',active)}</g>`:'')+(d.thickness?txt(28,390,`Толщина: ${d.thickness} мм`,active.endsWith('thickness')?'class="is-active"':''):''),`Сечение ${r.designation}. ${r.shape==='sheet'?'Лист, вид сверху.':'Размеры в мм.'}`).replaceAll('<text ','<text style="font-size:24px" ')+`<p class="tool-hint"><strong>${escape(r.designation)}</strong></p><p class="tool-hint">Масштаб: 1 мм = ${format(scale,2)} ед. схемы. ${r.shape==='sheet'?'Лист показан сверху.':'Размеры номинальные.'}</p>`;
}
export function printDiagram(result,input){return result.rows.map((r,i)=>`<section class="tool-stock-map">${diagram(result,input,`rows.${i}.width`)}</section>`).join('');}
export function extra(result){
  return `<div class="tool-position-list"><h3>Позиции комплекта</h3>${result.rows.map(r=>`<article class="tool-position"><h4>${r.index}. ${escape(r.name)}</h4><p>${escape(r.designation)}</p><dl><div><dt>Количество</dt><dd>${format(r.quantity)} шт. × ${format(r.length)} мм</dd></div><div><dt>Масса позиции</dt><dd>${format(r.mass)} кг</dd></div><div><dt>Ваша цена</dt><dd>${r.price===null?'Не указана':`${format(r.price)} ${escape(r.priceUnit)}`}</dd></div><div><dt>Стоимость позиции</dt><dd>${r.cost===null?'Неизвестна':`${format(r.cost,2)} ₽`}</dd></div></dl></article>`).join('')}</div><p class="tool-hint">Стоимость округлена до копеек по каждой позиции. Масса — до 0,001 кг на экране, без промежуточного округления в расчёте. Справочные массы и основания доступны в полной ведомости и CSV.</p>`;
}
export const printColumns=[{key:'index',label:'№'},{key:'designation',label:'Профиль / размеры'},{key:'quantity',label:'Шт.'},{key:'length',label:'Длина, мм'},{key:'mass',label:'Масса, кг'},{key:'cost',label:'Стоимость, ₽'}];

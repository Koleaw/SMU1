import { field, fields, group, button, escape, format, table } from '../core/view.mjs';
import { polygon, network } from '../calculations/foundation-geometry.mjs';
import { rectangle, lShape, bridge } from '../calculations/foundation-shapes.mjs';

const parse=v=>typeof v==='number'?v:typeof v==='string'&&/^[+-]?\d+(?:[.,]\d+)?$/.test(v.trim())?Number(v.replace(',','.')):NaN;
const valid=v=>Number.isFinite(v)&&Math.abs(v)<=150000;
const pointsPath=input=>input.type==='polygon'?'shapes.polygon.vertices':'shapes.network.segments';
const items=input=>input.type==='polygon'?input.shapes.polygon.vertices:input.shapes.network.segments;
const index=(input,root)=>Math.min(Math.max(0,Number(root?.dataset.geoIndex)||0),Math.max(0,items(input).length-1));
const attrs=(action,extra='')=>`data-action="${action}" ${extra}`;
export function shapeOf(input) {try{return input.type==='polygon'?polygon(input.shapes.polygon):network(input.shapes.network,input.stripWidth);}catch{return null;}}

export function plan(input, selected=-1, interactive=false, geometry=null) {
  const isPolygon=input.type==='polygon',source=isPolygon?input.shapes.polygon.vertices:input.shapes.network.segments;
  const parsed=source.map(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,parse(v)])));
  const coordinates=parsed.flatMap(p=>isPolygon?[p]:[{x:p.x1,y:p.y1},{x:p.x2,y:p.y2}]).filter(p=>valid(p.x)&&valid(p.y));
  const shape=geometry||shapeOf(input);
  const edges=shape?.edges||[], rects=shape?.rects||shape?.planRects||[];
  const bounds=[...coordinates,...edges.flatMap(e=>[{x:e.x1,y:e.y1},{x:e.x2,y:e.y2}])];
  if(!bounds.length)return '<p class="tool-hint">Введите координаты: схема появится здесь. Неполные поля остаются сохранены.</p>';
  const minX=Math.min(...bounds.map(p=>p.x)),maxX=Math.max(...bounds.map(p=>p.x)),minY=Math.min(...bounds.map(p=>p.y)),maxY=Math.max(...bounds.map(p=>p.y));
  const scale=Math.min(550/Math.max(1,maxX-minX),330/Math.max(1,maxY-minY));
  const tx=105+(550-(maxX-minX)*scale)/2-minX*scale,ty=85+(330-(maxY-minY)*scale)/2-minY*scale;
  const xy=p=>`${tx+p.x*scale},${ty+p.y*scale}`;
  const surfaceIds=geometry?.formworkEdges?.map(e=>e.id)||edges.filter(e=>input.shapes.surfaces.mode==='all'||input.shapes.surfaces.mode===e.kind||input.shapes.surfaces.mode==='selected'&&input.shapes.surfaces.edges.includes(e.id)).map(e=>e.id);
  let body=rects.map(r=>`<rect x="${tx+r.x*scale}" y="${ty+r.y*scale}" width="${r.width*scale}" height="${r.height*scale}" fill="#9fb8c2"/>`).join('');
  if(isPolygon){const pts=parsed.filter(p=>valid(p.x)&&valid(p.y));body+=`<${input.shapes.polygon.closed?'polygon':'polyline'} points="${pts.map(xy).join(' ')}" fill="${shape?'#9fb8c2':'none'}" stroke="#31586b" stroke-width="2" ${shape?'':'stroke-dasharray="8 6"'}/>`;}
  const footprint=shape?.footprint||geometry?.footprint||[];
  if(footprint.length)body+=`<polygon points="${footprint.map(xy).join(' ')}" fill="none" stroke="#617444" stroke-width="2" stroke-dasharray="4 6"/>`;
  edges.forEach(e=>{body+=`<line x1="${tx+e.x1*scale}" y1="${ty+e.y1*scale}" x2="${tx+e.x2*scale}" y2="${ty+e.y2*scale}" stroke="${surfaceIds.includes(e.id)?'#a96234':'#31586b'}" stroke-width="${surfaceIds.includes(e.id)?4:1.5}" ${surfaceIds.includes(e.id)?'stroke-dasharray="8 4"':''}/>`;});
  parsed.forEach((p,i)=>{
    if(!Object.values(p).every(valid))return;
    const x=isPolygon?p.x:(p.x1+p.x2)/2,y=isPolygon?p.y:(p.y1+p.y2)/2;
    const label=isPolygon?`Вершина ${i+1}`:`Участок ${i+1}, ось ${format(Math.hypot(p.x2-p.x1,p.y2-p.y1))} мм`;
    const edit=interactive?`${attrs('geo-select',`data-index="${i}"`)} tabindex="0" role="button" aria-label="${escape(label)}" aria-pressed="${i===selected}"`:'';
    body+=`<g ${edit} class="geo-handle ${i===selected?'is-selected':''}"><title>${escape(label)}</title>${!isPolygon?`<line x1="${tx+p.x1*scale}" y1="${ty+p.y1*scale}" x2="${tx+p.x2*scale}" y2="${ty+p.y2*scale}" stroke="${i===selected?'#a54116':'#31586b'}" stroke-width="3" stroke-dasharray="9 5"/>`:''}<circle cx="${tx+x*scale}" cy="${ty+y*scale}" r="22" fill="transparent"/><circle cx="${tx+x*scale}" cy="${ty+y*scale}" r="${i===selected?10:7}" fill="${i===selected?'#a54116':'#31586b'}" stroke="white" stroke-width="2"/><text x="${tx+x*scale+15}" y="${ty+y*scale-15}" class="geo-label">${isPolygon?'В':'У'}${i+1}</text></g>`;
  });
  body+=`<text x="380" y="38" text-anchor="middle" class="geo-label">${format(maxX-minX)} мм · внешний габарит</text><text x="24" y="470" class="geo-label">Y ↓ · ${format(maxY-minY)} мм</text><text x="555" y="470" class="geo-label">X → · мм</text>`;
  return `<svg class="tool-svg geo-plan" viewBox="0 0 760 500" role="${interactive?'group':'img'}" aria-label="${interactive?'Редактор геометрии: выберите вершину или участок':'План бетона и выбранных формуемых границ'}" data-geo-plan data-scale="${scale}" xmlns="http://www.w3.org/2000/svg">${body}</svg><p class="tool-hint">${shape?'Синий — бетон; коричневый пунктир — опалубка; зелёный — заданное пятно.':'Черновая схема: контур ещё не прошёл проверку. Материалы не рассчитаны.'}</p>`;
}

function preview(input,root) {
  const isPolygon=input.type==='polygon',list=items(input),i=index(input,root);
  let html=plan(input,i,true);
  if(list[i]){const p=list[i],values=Object.values(p).map(parse);if(values.every(valid))html+=`<p class="tool-hint"><strong>${isPolygon?'Вершина':'Участок'} ${i+1}</strong>: ${isPolygon?`X ${escape(p.x)}, Y ${escape(p.y)} мм`:`длина по оси ${format(Math.hypot(parse(p.x2)-parse(p.x1),parse(p.y2)-parse(p.y1)))} мм; ширина ${escape(input.stripWidth)} мм`}. Высота бетона ${escape(input.height)} мм.</p>`;}
  return html;
}
export function refresh(input,root) {
  const target=root.querySelector('[data-geo-preview]');
  if(target&&['polygon','network'].includes(input.type))target.innerHTML=preview(input,root);
}
export function editor(input,root) {
  const isPolygon=input.type==='polygon',list=items(input),i=index(input,root),path=pointsPath(input);
  const title=isPolygon?'вершина':'участок';
  let html=`<div data-geo-preview>${preview(input,root)}</div>`;
  html+=`<label class="tool-field tool-field-wide"><span>Выбранный ${isPolygon?'элемент':'участок'}</span><select data-geometry-select class="ym-disable-keys" aria-label="Выбранный элемент">${list.map((_,n)=>`<option value="${n}" ${n===i?'selected':''}>${isPolygon?'Вершина':'Участок'} ${n+1}</option>`).join('')}</select></label>`;
  if(list.length)html+=fields(input,(isPolygon?['x','y']:['x1','y1','x2','y2']).map(k=>field(`${path}.${i}.${k}`,`${k.toUpperCase()} ${isPolygon?'вершины':'по оси'}`,{unit:'мм'})));
  html+=`<div class="tool-row-actions">${button('geo-add',`+ ${isPolygon?'Вершина после выбранной':'Участок'}`)}${button('geo-remove',`Удалить: ${title} ${i+1}`,list.length?'':'disabled')}</div>`;
  html+=`<p class="tool-hint">Выберите точку на схеме или в списке. Стрелки на выбранной точке и кнопки ниже сдвигают её на 100 мм (Shift — 10 мм). Координаты можно вводить точно; перетаскивание не требуется. X вправо, Y вниз.</p><div class="tool-row-actions">${[['left','← X −100'],['right','X +100 →'],['up','↑ Y −100'],['down','Y +100 ↓']].map(([d,l])=>button('geo-nudge',l,`data-direction="${d}" ${list.length?'':'disabled'}`)).join('')}</div>`;
  if(isPolygon)html+=fields(input,[field('shapes.polygon.closed','Замкнуть контур (последняя → первая)',{type:'checkbox'})]);
  html+=`<details data-preserve-open="geo-coordinates"><summary>Все ${isPolygon?'вершины':'участки'} численно · порядок обхода</summary>${list.map((p,n)=>`<p>${n+1}: ${Object.entries(p).map(([k,v])=>`${k.toUpperCase()} = ${escape(v)} мм`).join('; ')} ${button('geo-select','Выбрать',`data-index="${n}"`)}</p>`).join('')}</details>`;
  if(!isPolygon){
    const fp=input.shapes.network.footprint;
    html+=`<details data-preserve-open="geo-footprint"><summary>Внешний контур для слоя «Всё пятно»</summary><p class="tool-hint">Необязательный отдельный ортогональный контур по внешним границам. Должен охватывать весь бетон. Для открытой сети площадь автоматически не определяется.</p>${fields(input,[field('shapes.network.footprint.closed','Замкнуть внешний контур',{type:'checkbox'})])}${fp.vertices.map((_,n)=>group(`Вершина пятна ${n+1}`,fields(input,['x','y'].map(k=>field(`shapes.network.footprint.vertices.${n}.${k}`,k.toUpperCase(),{unit:'мм'})))+button('geo-foot-remove','Удалить вершину',`data-index="${n}"`))).join('')}<div class="tool-row-actions">${button('geo-foot-add','+ Вершина пятна')}${button('geo-foot-clear','Убрать контур пятна')}</div></details>`;
  }
  return group('Контур и координаты',html,isPolygon?'Один простой многоугольник, 3–32 вершины, координаты ±100 000 мм (точность 0,001 мм). Кривые и отверстия не поддерживаются. Первую вершину в конце не повторяйте.':'1–32 ортогональных участка, одна связная область. Координаты ±100 000 мм. Размеры по осям; ширина общая. Квадратные концы выходят на b/2 за каждую конечную точку.');
}

export function surfaceForm(input) {
  const shape=shapeOf(input),modes=[['none','Без опалубки'],['all','Все границы'],['outer','Только наружные'],...(input.type==='network'?[['inner','Только внутренние']]:[]),['selected','Выбрать отдельные границы']];
  let html=fields(input,[field('shapes.surfaces.mode','Формуемые поверхности',{options:modes}),field('formwork.height','Формуемая высота',{unit:'мм',hint:'Отдельно от высоты бетона. Верх и низ не учитываются.'})]);
  if(input.shapes.surfaces.mode==='selected'&&shape)html+=`<div class="geo-surfaces">${shape.edges.map((e,i)=>`<label class="tool-check"><input type="checkbox" class="ym-disable-keys" data-geometry-edge="${escape(e.id)}" ${input.shapes.surfaces.edges.includes(e.id)?'checked':''}/><span>Граница ${i+1}: (${format(e.x1)}; ${format(e.y1)}) → (${format(e.x2)}; ${format(e.y2)}) мм · ${e.kind==='outer'?'наружная':'внутренняя'}</span></label>`).join('')}</div>`;
  return group('Опалубка по границам бетона',html,'Только открытые боковые границы объединения. Пересечения участков не создают внутренних поверхностей. До 200 отдельных границ либо вся группа. При изменении выбранной границы потребуется выбрать её заново.');
}

export function action(action,{input,root,button:b}) {
  if(action==='geo-example'){
    const kind=b.dataset.kind;
    if(kind==='legacy')input.type='slab';
    else {input.type=kind==='bridge'?'network':'polygon';if(kind==='bridge')input.shapes.network=structuredClone(bridge);else input.shapes.polygon=structuredClone(kind==='rectangle'?rectangle:lShape);}
    input.length=8000;input.width=6000;input.height=250;input.stripWidth=400;input.reservePercent=5;input.formwork={outer:true,inner:false,height:250,outerSides:'0,1,2,3',innerSides:'0,1,2,3'};input.layers=[{id:'sand',name:'Песчаная подготовка',area:'footprint',thickness:100}];input.shapes.surfaces={mode:'all',edges:[]};root.dataset.geoIndex='0';return true;
  }
  if(!['polygon','network'].includes(input.type))return false;
  const list=items(input),i=index(input,root);
  if(action==='geo-add'){if(list.length>=32)throw Error('Не более 32 элементов.');if(input.type==='polygon'){const a=list[i],c=list[(i+1)%list.length];const midpoint=k=>a&&c&&valid(parse(a[k]))&&valid(parse(c[k]))?Math.round((parse(a[k])+parse(c[k]))*500)/1000:0;list.splice(i+1,0,{x:midpoint('x'),y:midpoint('y')});root.dataset.geoIndex=String(Math.min(i+1,list.length-1));}else{list.push({x1:0,y1:0,x2:1000,y2:0});root.dataset.geoIndex=String(list.length-1);}return true;}
  if(action==='geo-remove'){list.splice(i,1);root.dataset.geoIndex=String(Math.max(0,i-1));return true;}
  if(action==='geo-nudge'){nudge(input,i,b.dataset.direction,100);return true;}
  const fp=input.shapes.network.footprint;
  if(action==='geo-foot-clear'){fp.vertices=[];fp.closed=false;return true;}
  if(action==='geo-foot-remove'){fp.vertices.splice(Number(b.dataset.index),1);return true;}
  if(action==='geo-foot-add'){if(fp.vertices.length>=32)throw Error('Не более 32 вершин.');fp.vertices.push({x:0,y:0});return true;}
  return false;
}
function nudge(input,i,direction,step){const item=items(input)[i];if(!item)return;const axis=['left','right'].includes(direction)?'x':'y',delta=['left','up'].includes(direction)?-step:step,keys=input.type==='polygon'?[axis]:[`${axis}1`,`${axis}2`];if(keys.some(key=>!Number.isFinite(parse(item[key]))))throw Error('Сначала заполните координаты выбранного элемента.');for(const key of keys)item[key]=Math.round((parse(item[key])+delta)*1000)/1000;}

export function bind(root,signal,api) {
  const listen=(name,fn)=>root.addEventListener(name,fn,{signal});
  const select=n=>{root.dataset.geoIndex=String(n);api.render();};
  listen('click',e=>{const node=e.target.closest('[data-action="geo-select"]');if(node)select(node.dataset.index);});
  listen('change',e=>{if(e.target.matches('[data-geometry-select]'))select(e.target.value);if(e.target.matches('[data-geometry-edge]'))api.commit(input=>{const id=e.target.dataset.geometryEdge,ids=input.shapes.surfaces.edges;input.shapes.surfaces.edges=e.target.checked?[...new Set([...ids,id])]:ids.filter(v=>v!==id);});});
  listen('keydown',e=>{const node=e.target.closest('[data-action="geo-select"]');if(!node)return;
    if(['Enter',' '].includes(e.key)){e.preventDefault();select(node.dataset.index);}
    const directions={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
    if(directions[e.key]){e.preventDefault();root.dataset.geoIndex=node.dataset.index;api.commit(input=>nudge(input,Number(node.dataset.index),directions[e.key],e.shiftKey?10:100));root.querySelector(`[data-action="geo-select"][data-index="${node.dataset.index}"]`)?.focus();}
  });
}

export function extra(result) {return (result.extraTables||[]).map(t=>`<details class="tool-geometry-table"><summary>${escape(t.title)}</summary>${table(t)}</details>`).join('');}

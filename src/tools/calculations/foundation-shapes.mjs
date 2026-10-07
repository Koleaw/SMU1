import { object, number, mm, enumValue, text, array, uniqueIds, asMm, fail } from './geometry-validation.mjs';
import { polygon, network } from './foundation-geometry.mjs';

export const methodologyVersion = '1.1.0';
export const rectangle = {closed:true,vertices:[{x:0,y:0},{x:8000,y:0},{x:8000,y:6000},{x:0,y:6000}]};
export const lShape = {closed:true,vertices:[{x:0,y:0},{x:8000,y:0},{x:8000,y:3000},{x:4000,y:3000},{x:4000,y:6000},{x:0,y:6000}]};
export const bridge = {segments:[{x1:0,y1:0,x2:9600,y2:0},{x1:9600,y1:0,x2:9600,y2:7600},{x1:9600,y1:7600,x2:0,y2:7600},{x1:0,y1:7600,x2:0,y2:0},{x1:4800,y1:0,x2:4800,y2:7600}],footprint:{closed:true,vertices:[{x:-200,y:-200},{x:9800,y:-200},{x:9800,y:7800},{x:-200,y:7800}]}};
export const defaultShapes = () => ({polygon:structuredClone(lShape),network:structuredClone(bridge),surfaces:{mode:'all',edges:[]}});

export function calculate(raw) {
  object(raw,['type','length','width','height','stripWidth','reservePercent','formwork','layers','shapes']);
  const type=enumValue(raw.type,['polygon','network'],'type');
  object(raw.shapes,['polygon','network','surfaces'],'shapes');
  const height=asMm(mm(raw.height,'height',0.001,100_000));
  const reservePercent=number(raw.reservePercent,'reservePercent',0,100);
  let shape;
  // Prefix field paths for the saved extension and its numerical controls.
  try {shape=type==='polygon'?polygon(raw.shapes.polygon):network(raw.shapes.network,raw.stripWidth);}
  catch(error){if(error.field?.startsWith('polygon')||error.field?.startsWith('network'))error.field=`shapes.${error.field}`;throw error;}
  const concreteAreaM2=shape.areaM2,footprintAreaM2=type==='polygon'?shape.areaM2:shape.footprintAreaM2;
  object(raw.formwork,['outer','inner','height','outerSides','innerSides'],'formwork');
  const formHeight=asMm(mm(raw.formwork.height,'formwork.height',0,100_000));
  const surfaces=object(raw.shapes.surfaces,['mode','edges'],'shapes.surfaces');
  const mode=enumValue(surfaces.mode,['none','all','outer','inner','selected'],'shapes.surfaces.mode');
  const selected=array(surfaces.edges,'shapes.surfaces.edges',200).map((id,i)=>text(id,`shapes.surfaces.edges.${i}`,'',160));
  if(new Set(selected).size!==selected.length)fail('shapes.surfaces.edges','Поверхности не должны повторяться.');
  if(mode==='selected'&&(!selected.length||selected.some(id=>!shape.edges.some(e=>e.id===id))))fail('shapes.surfaces.mode','Границы изменились или выбор пуст. Выберите поверхности заново либо режим «Все границы».');
  if(type==='polygon'&&mode==='inner')fail('shapes.surfaces.mode','У плиты без отверстий нет внутренних границ.');
  const formworkEdges=shape.edges.filter(e=>mode==='all'||mode===e.kind||mode==='selected'&&selected.includes(e.id)).map(e=>({...e,height:formHeight,areaM2:e.length/1000*formHeight/1000}));
  if(formworkEdges.length&&!formHeight)fail('formwork.height','Для выбранных поверхностей задайте ненулевую высоту опалубки.');
  const layers=array(raw.layers,'layers',8).map((row,i)=>{
    object(row,['id','name','area','thickness'],`layers.${i}`);
    const id=text(row.id,`layers.${i}.id`,'',64),name=text(row.name,`layers.${i}.name`,`Слой ${i+1}`);
    const area=enumValue(row.area,['footprint','strip'],`layers.${i}.area`),thickness=asMm(mm(row.thickness,`layers.${i}.thickness`,0.001,100_000));
    if(area==='strip'&&type==='polygon')fail(`layers.${i}.area`,'Для плиты выберите область «Всё пятно». Исходный выбор слоя сохранён.');
    if(area==='footprint'&&footprintAreaM2===null)fail(`layers.${i}.area`,'Для всего пятна задайте замкнутый внешний контур. Площадь открытой сети не заменяется прямоугольником.');
    const areaM2=area==='strip'?concreteAreaM2:footprintAreaM2;
    return {id,name,area,thickness,areaM2,volumeM3:areaM2*thickness/1000};
  });
  uniqueIds(layers,'layers');
  const concreteVolumeM3=concreteAreaM2*height/1000,reserveVolumeM3=concreteVolumeM3*reservePercent/100,formworkAreaM2=formworkEdges.reduce((s,e)=>s+e.areaM2,0);
  const rows=[{name:'Бетон — площадь в плане',quantity:concreteAreaM2,unit:'м²',detail:type==='polygon'?'Простой замкнутый контур':'Объединение участков без двойного учёта пересечений'},
    {name:'Бетон — геометрический объём',quantity:concreteVolumeM3,unit:'м³',detail:`Высота ${height} мм`},
    {name:'Дополнительный запас бетона',quantity:reserveVolumeM3,unit:'м³',detail:`${reservePercent}% — задано пользователем`},
    ...formworkEdges.map(e=>({name:`Опалубка: граница ${shape.edges.indexOf(shape.edges.find(b=>b.id===e.id))+1}`,quantity:e.areaM2,unit:'м²',detail:`(${e.x1}; ${e.y1}) → (${e.x2}; ${e.y2}) мм; длина ${e.length} мм; высота ${formHeight} мм`})),
    ...layers.flatMap(l=>[{name:`${l.name} — площадь`,quantity:l.areaM2,unit:'м²',detail:l.area==='strip'?'Объединение под лентой':'Заданное внешнее пятно'},{name:`${l.name} — объём`,quantity:l.volumeM3,unit:'м³',detail:`Толщина ${l.thickness} мм`}])];
  const geometryRows=type==='polygon'?shape.vertices.map((p,i)=>({name:`Вершина ${i+1}`,x1:p.x,y1:p.y,x2:'',y2:''})):shape.segments.map((s,i)=>({name:`Ось участка ${i+1}`,...s}));
  if(type==='network')geometryRows.push(...shape.footprint.map((p,i)=>({name:`Внешнее пятно: вершина ${i+1}`,x1:p.x,y1:p.y,x2:'',y2:''})));
  const conditions=type==='polygon'?'Координаты вершин — внешняя граница плиты; последний отрезок соединяет последнюю вершину с первой.':'Координаты участков — оси. Единая ширина; квадратные концы выходят на половину ширины за обе конечные точки. Контур пятна — по внешним границам, задаётся отдельно.';
  return {valid:true,methodologyVersion,input:structuredClone(raw),totals:{concreteAreaM2,footprintAreaM2,concreteVolumeM3,reserveVolumeM3,orderVolumeM3:concreteVolumeM3+reserveVolumeM3,formworkAreaM2},
    summary:[{label:'Площадь бетона',value:concreteAreaM2,unit:'м²'},{label:'Бетон по геометрии',value:concreteVolumeM3,unit:'м³'},{label:'Дополнительный запас',value:reserveVolumeM3,unit:'м³'},{label:'Бетон с запасом',value:concreteVolumeM3+reserveVolumeM3,unit:'м³'},{label:'Заданная опалубка',value:formworkAreaM2,unit:'м²'}],
    columns:[{key:'name',label:'Материал / поверхность'},{key:'quantity',label:'Количество'},{key:'unit',label:'Единица'},{key:'detail',label:'Условие'}],rows,
    extraTables:[{title:'Геометрия · координаты в мм',columns:[{key:'name',label:'Элемент'},{key:'x1',label:'X / X1, мм'},{key:'y1',label:'Y / Y1, мм'},{key:'x2',label:'X2, мм'},{key:'y2',label:'Y2, мм'}],rows:geometryRows},
      {title:'Исходные параметры',columns:[{key:'name',label:'Параметр'},{key:'value',label:'Значение'}],rows:[{name:'Смысл размеров',value:conditions},{name:'Высота бетона, мм',value:height},{name:'Ширина ленты, мм',value:type==='network'?asMm(mm(raw.stripWidth,'stripWidth')):'Не применяется'},{name:'Запас, %',value:reservePercent},{name:'Формуемая высота, мм',value:formHeight}]},
      {title:'Все границы объединения',columns:[{key:'name',label:'Граница'},{key:'coordinates',label:'От → до, мм'},{key:'length',label:'Длина, мм'},{key:'selected',label:'Опалубка'}],rows:shape.edges.map((e,i)=>({name:`${i+1} · ${e.kind==='outer'?'Наружная':'Внутренняя'}`,coordinates:`(${e.x1}; ${e.y1}) → (${e.x2}; ${e.y2})`,length:e.length,selected:formworkEdges.some(f=>f.id===e.id)?'Да':'Нет'}))}],
    geometry:{type,height,stripWidth:type==='network'?asMm(mm(raw.stripWidth,'stripWidth')):0,vertices:shape.vertices||[],segments:shape.segments||[],footprint:shape.footprint||[],planRects:shape.rects||[],edges:shape.edges,formworkEdges,layers},
    warnings:[conditions,'Материалы по заданной геометрии. Подбор фундамента, грунты, нагрузки, армирование и пригодность основания для здания не проверяются.','Кривые, отверстия в плите, переменная ширина и высота, наклонные участки ленты и раздельные области не поддерживаются. Коэффициенты уплотнения не применяются.']};
}

import {number, optional, text, list, choice, clone} from '../core/numbers.mjs';
import {validateShape} from '../core/projects.mjs';
import reference from '../../content/tool-references/steel-angles.json' with {type:'json'};
export const methodologyVersion = '1.0.0';
export const referenceVersions = {'steel-angles':reference.version};
export const density = reference.densityKgM3;
export const shapes = {square:'Квадратная труба',rectangle:'Прямоугольная труба',pipe:'Круглая труба',strip:'Полоса',round:'Круг',sheet:'Лист',angle:'Уголок по таблице',known:'Известная масса метра'};
export const emptyRow = {name:'',shape:'strip',width:'',height:'',thickness:'',diameter:'',length:'',quantity:1,angle:'40x40x4',massPerMetre:'',price:'',priceUnit:'kg'};
export const blank = {rows:[clone(emptyRow)]};
export const example = {rows:[{...emptyRow,name:'Полоса для каркаса',width:40,thickness:4,length:6000,quantity:1,price:90,priceUnit:'kg'},{...emptyRow,name:'Лист для деталей',shape:'sheet',width:1000,length:2000,thickness:2,quantity:1}]};
export function calculate(input) {
  validateShape(input,example);
  const rows = list(input.rows,'Ведомость',100,1).map((r,index)=>{
    const p=`Позиция ${index+1}`;
    const shape=choice(r.shape,Object.keys(shapes),`${p}, форма`);
    const quantity=number(r.quantity,`${p}, количество`,1,10000,true);
    const length=number(r.length,`${p}, длина, мм`,0.001,100000);
    const dim=(key,label)=>number(r[key],`${p}, ${label}, мм`,0.001,20000);
    let area=0, massPerMetre=null, massPerSheet=null, designation='', source='Оценка по номинальным размерам без допусков и скруглений', dimensions={};
    if (['square','rectangle','strip','sheet'].includes(shape)) {
      const width=dim('width','ширина'), thickness=dim('thickness','толщина');
      dimensions={width,thickness};
      if (['square','rectangle'].includes(shape)) {
        const height=shape==='square'?width:dim('height','высота'); dimensions.height=height;
        if (2*thickness>=Math.min(width,height)) throw new Error(`${p}: стенка должна быть меньше половины меньшего размера трубы.`);
        area=width*height-(width-2*thickness)*(height-2*thickness);
        designation=`${shapes[shape]} ${width}×${height}×${thickness} мм`;
      } else { area=width*thickness; designation=`${shapes[shape]} ${width}×${shape==='sheet'?`${length}×`:''}${thickness} мм`; }
    } else if (['pipe','round'].includes(shape)) {
      const diameter=dim('diameter','диаметр'); dimensions={diameter};
      const thickness=shape==='pipe'?dim('thickness','стенка'):0; dimensions.thickness=thickness;
      if (shape==='pipe' && 2*thickness>=diameter) throw new Error(`${p}: стенка должна быть меньше половины диаметра.`);
      area=Math.PI*(diameter**2-(shape==='pipe'?(diameter-2*thickness)**2:0))/4;
      designation=`${shapes[shape]} Ø${diameter}${shape==='pipe'?`×${thickness}`:''} мм`;
    } else if (shape==='angle') {
      const entry=reference.entries.find(x=>x.id===r.angle); if(!entry) throw new Error(`${p}: выберите уголок из справочника.`);
      massPerMetre=entry.massKgM; designation=entry.designation; source=`${reference.source.title}; позиция ${entry.id}`;
      dimensions={width:entry.widthMm,height:entry.heightMm,thickness:entry.thicknessMm};
    } else { massPerMetre=number(r.massPerMetre,`${p}, кг/м`,0.000001,100000); designation='Профиль по заданной массе'; source='Масса метра задана пользователем'; }
    if (massPerMetre===null) massPerMetre=area*density/1e6;
    const totalLength=shape==='sheet'?0:length/1000*quantity;
    if(shape==='sheet') massPerSheet=massPerMetre*length/1000;
    const mass=shape==='sheet'?massPerSheet*quantity:massPerMetre*totalLength;
    if(shape==='sheet') massPerMetre=null;
    const price=optional(r.price,`${p}, цена`,0,1e9);
    const priceUnit=choice(r.priceUnit,['m','kg','t','sheet'],`${p}, единица цены`);
    if(price!==null && (priceUnit==='sheet' && shape!=='sheet' || priceUnit==='m' && shape==='sheet')) throw new Error(`${p}: для листа используйте цену за лист, кг или тонну; для профиля — метр, кг или тонну.`);
    const cost=price===null?null:price*(priceUnit==='kg'?mass:priceUnit==='t'?mass/1000:priceUnit==='sheet'?quantity:totalLength);
    return {index:index+1,name:text(r.name,`${p}, название`,120)||designation,shape,designation,length,quantity,dimensions,massPerMetre,massPerSheet,totalLength,mass,price,priceUnit:({m:'₽/м',kg:'₽/кг',t:'₽/т',sheet:'₽/лист'})[priceUnit],cost,source};
  });
  const totalMass=rows.reduce((n,r)=>n+r.mass,0), totalLength=rows.reduce((n,r)=>n+r.totalLength,0), knownCost=rows.reduce((n,r)=>n+(r.cost??0),0), priced=rows.filter(r=>r.cost!==null).length;
  if(knownCost>1e14||!Number.isFinite(knownCost))throw new Error('Стоимость комплекта превышает допустимый предел 100 трлн ₽. Проверьте размеры, количество и единицы цены.');
  return {rows, totalMass,totalLength,knownCost,completeCost:priced===rows.length,priced,coefficients:{densityKgM3:density,tabulatedProfiles:rows.filter(r=>r.shape==='angle').map(r=>({position:r.index,designation:r.designation,massKgM:r.massPerMetre,source:r.source}))},summary:[{label:'Теоретическая масса',value:totalMass,unit:'кг'},{label:'Метраж профилей',value:totalLength,unit:'м'},{label:priced===rows.length?'Стоимость металла':`Известная часть стоимости (${priced}/${rows.length})`,value:priced?knownCost:'Не указана',unit:priced?'₽':''}],columns:[{key:'index',label:'№'},{key:'name',label:'Позиция'},{key:'designation',label:'Профиль / размеры'},{key:'length',label:'Длина, мм'},{key:'quantity',label:'Шт.'},{key:'massPerMetre',label:'кг/м'},{key:'massPerSheet',label:'кг/лист'},{key:'totalLength',label:'Метраж, м'},{key:'mass',label:'Масса, кг'},{key:'price',label:'Цена'},{key:'priceUnit',label:'Единица цены'},{key:'cost',label:'Стоимость, ₽'},{key:'source',label:'Основание'}],warnings:['Теоретическая масса отличается от взвешивания поставки. Трубы по геометрии: реальные скругления и допуски не учтены.','Цена относится только к металлу. Изготовление, монтаж и доставка не включены.',...(priced<rows.length?['Полная стоимость неизвестна: у части позиций нет цены.']:[])]};
}

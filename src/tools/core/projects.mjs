import {clone} from './numbers.mjs';
export const storageKey='smu1.tools.projects.v1';
export const maxFileBytes=4*1024*1024;
export const toolIds=['metal','raskroy','fundament','ograzhdenie','plitka','maf','zdanie'];
export const newId=()=>globalThis.crypto?.randomUUID?.()||`p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function bounded(value,depth=0) {
  if(depth>12)throw new Error('Слишком глубокая структура файла.');
  if(value===null || typeof value==='boolean')return;
  if(typeof value==='string') {if(value.length>20000)throw new Error('Слишком длинное значение.');return;}
  if(typeof value==='number') {if(!Number.isFinite(value)||Math.abs(value)>1e14)throw new Error('Недопустимое число.');return;}
  if(Array.isArray(value)){if(value.length>5000)throw new Error('Слишком много элементов.');value.forEach(v=>bounded(v,depth+1));return;}
  if(typeof value!=='object')throw new Error('Недопустимый формат данных.');
  const keys=Object.keys(value);if(keys.length>100)throw new Error('Слишком много полей.');
  keys.forEach(k=>{if(['__proto__','constructor','prototype'].includes(k))throw new Error('Недопустимое имя поля.');bounded(value[k],depth+1);});
}
// Strict draft shape permits empty numeric controls, but rejects unknown fields before any write.
export function validateShape(value,template,path='input') {
  if(Array.isArray(template)) { if(!Array.isArray(value)||value.length>200)throw new Error(`${path}: неверный список или более 200 строк.`);if(template.length) value.forEach((v,i)=>validateShape(v,template[0],`${path}.${i}`));return; }
  if(template && typeof template==='object') {if(!value||Array.isArray(value)||typeof value!=='object')throw new Error(`${path}: неверная структура.`);for(const key of Object.keys(value))if(!(key in template)||['__proto__','constructor','prototype'].includes(key))throw new Error(`${path}.${key}: неизвестное поле.`);for(const key of Object.keys(template)) {if(!(key in value))throw new Error(`${path}.${key}: отсутствует поле.`);validateShape(value[key],template[key],`${path}.${key}`);}return;}
  if(typeof template==='boolean') {if(typeof value!=='boolean')throw new Error(`${path}: требуется переключатель.`);}
  else if(!['string','number'].includes(typeof value)&&value!==null)throw new Error(`${path}: требуется значение.`);
  if(typeof value==='string'&&value.length>2000)throw new Error(`${path}: не более 2000 символов.`);
}
export function validateProject(project) {
  bounded(project);
  const required=['id','tool','name','input','methodologyVersion','referenceVersions','createdAt','updatedAt','demo'];
  const allowed=[...required,'resultSnapshot','snapshotText','imported'];
  if(!project||Array.isArray(project)||Object.keys(project).some(k=>!allowed.includes(k))||required.some(k=>!(k in project)))throw new Error('Некорректная структура расчёта.');
  if(typeof project.id!=='string'||project.id.length>100||!toolIds.includes(project.tool)||typeof project.name!=='string'||!project.name.trim()||project.name.length>120)throw new Error('Неверное название или тип расчёта.');
  if(!/^\d+\.\d+\.\d+$/.test(project.methodologyVersion)||!project.referenceVersions||Array.isArray(project.referenceVersions)||typeof project.referenceVersions!=='object'||typeof project.demo!=='boolean')throw new Error('Неверная версия расчёта.');
  for(const date of [project.createdAt,project.updatedAt])if(typeof date!=='string'||!Number.isFinite(Date.parse(date)))throw new Error('Неверная дата расчёта.');
  return project;
}
export function readProjects(storage) {
  const raw=storage.getItem(storageKey);if(!raw)return [];
  const file=parseFile(raw);return file.projects;
}
export function parseFile(raw) {
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>maxFileBytes)throw new Error('Файл проекта должен быть не больше 4 МБ.');
  let file;try{file=JSON.parse(raw);}catch{throw new Error('Файл повреждён: не удалось прочитать JSON.');}
  bounded(file);
  if(!file||file.format!=='smu1-tools'||file.version!==1||Object.keys(file).some(k=>!['format','version','projects'].includes(k))||!Array.isArray(file.projects)||file.projects.length>60)throw new Error('Неподдерживаемый формат файла проекта.');
  file.projects.forEach(validateProject);
  if(new Set(file.projects.map(p=>p.id)).size!==file.projects.length)throw new Error('В файле повторяются ID расчётов.');
  return file;
}
export function serialize(projects) {return JSON.stringify({format:'smu1-tools',version:1,projects},null,2);}
export function writeProjects(storage,projects) {
  if(projects.length>60)throw new Error('В папке уже 60 расчётов. Сохраните архив файлом и удалите ненужные.');
  const serialized=serialize(projects);if(new TextEncoder().encode(serialized).length>maxFileBytes)throw new Error('Папка превышает 4 МБ. Выгрузите проекты файлом.');
  storage.setItem(storageKey,serialized);
}
export function createProject(tool,input,name,methodologyVersion,referenceVersions={},demo=false) {const now=new Date().toISOString();return {id:newId(),tool,name,input:clone(input),methodologyVersion,referenceVersions:clone(referenceVersions),createdAt:now,updatedAt:now,demo};}
export function duplicateProject(project) { return {...clone(project),id:newId(),name:`${project.name.slice(0,110)} — копия`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; }
export function csvCell(value) {let s=String(value??'Не указано');if(/^[\s\uFEFF]*[=+\-@\t\r]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;}
export function csv(result) {const block=t=>[t.columns.map(c=>csvCell(c.label)).join(';'),...t.rows.map(r=>t.columns.map(c=>csvCell(typeof r[c.key]==='number'?String(r[c.key]).replace('.',','):r[c.key])).join(';'))].join('\r\n');return '\uFEFF'+block(result)+(result.extraTables||[]).map(t=>`\r\n\r\n${csvCell(t.title)}\r\n${block(t)}`).join('');}

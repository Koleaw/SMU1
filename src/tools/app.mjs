import {clone,format} from './core/numbers.mjs';
import {escape,get,set,table,button} from './core/view.mjs';
import {storageKey,newId,readProjects,writeProjects,parseFile,serialize,createProject,duplicateProject,validateShape,csv,maxFileBytes} from './core/projects.mjs';
import {isProductionDeploy} from '../utils/deployEnvironment';
import yandex from '../data/yandex.json';
const loaders=import.meta.glob(['./adapters/*.mjs','!./adapters/*.test.mjs']);
const loadAdapter=id=>loaders[`./adapters/${id}.mjs`]();
let teardown=()=>{};
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const pendingEvents=[];let analyticsTimer;
const event=(tool,action)=>{
  if(!isProductionDeploy||!window.__smu1MetrikaState)return;
  pendingEvents.push({tool,action});
  const flush=()=>{if(typeof window.ym==='function'){clearTimeout(analyticsTimer);analyticsTimer=null;for(const item of pendingEvents.splice(0))window.ym(yandex.metrika.counterId,'reachGoal',`tool_${item.action}`,{tool:item.tool});}else if(pendingEvents.length){analyticsTimer=setTimeout(flush,500);}};
  if(!analyticsTimer)flush();
};
async function init(){
  const root=document.querySelector('[data-tool-app]');if(!root||root.dataset.ready==='true')return;
  root.dataset.ready='true';const life=new AbortController(),on=(el,name,fn)=>el.addEventListener(name,fn,{signal:life.signal});
  const $=s=>root.querySelector(s),tool=root.dataset.toolId,base=root.dataset.base,content=JSON.parse($('[data-tool-content]').textContent);
  let adapter;try{adapter=await loadAdapter(tool);}catch(error){$('[data-save-status]').textContent='Не удалось загрузить инструмент. Перезагрузите страницу.';console.error(error);return;}
  if(!root.isConnected)return;
  let projects=[],current,result=null,active='',timer,saveTimer,computeController,removed=null,blockedStorage=false,folderOpen=false,started=false,reported=false,revision=0;
  const pendingNew=new Map(),deletedIds=new Set(),observed=new Map();
  const projectState=p=>JSON.stringify({name:p.name,tool:p.tool,input:p.input,methodologyVersion:p.methodologyVersion,referenceVersions:p.referenceVersions,demo:p.demo,imported:p.imported});
  const status=message=>$('[data-save-status]').textContent=message;
  try{projects=readProjects(localStorage);projects.forEach(p=>observed.set(p.id,projectState(p)));}catch{blockedStorage=true;status('Хранилище недоступно или повреждено. Расчёт работает; выгрузите файл проекта.');}
  const hashParams=new URLSearchParams(location.hash.slice(1)), requested=hashParams.get('project'),adding=tool==='maf'&&hashParams.has('add');
  current=projects.find(p=>p.id===requested&&p.tool===tool)||projects.filter(p=>p.tool===tool).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  if(!current||adding&&current.demo){current=createProject(tool,adding?adapter.blank:adapter.example,`${adding?'Моя ведомость':'Пример'} · ${content.title}`,adapter.methodologyVersion,adapter.referenceVersions||{},!adding);projects.push(current);}
  const historical=()=>current.imported || current.methodologyVersion!==adapter.methodologyVersion || JSON.stringify(current.referenceVersions)!==JSON.stringify(adapter.referenceVersions||{});
  const exportStatus=message=>$('[data-export-status]').textContent=message;
  const shape=p=>adapter.validateDraft?adapter.validateDraft(p.input):validateShape(p.input,adapter.draftTemplate||adapter.example);
  function save(){
    clearTimeout(saveTimer);current.updatedAt=new Date().toISOString();
    const index=projects.findIndex(p=>p.id===current.id);if(index>=0)projects[index]=current;else projects.push(current);
    if(blockedStorage){status('Не сохранено в браузере. Выгрузите файл проекта, чтобы сохранить работу.');return;}
    try{
      const fresh=readProjects(localStorage),stored=fresh.find(p=>p.id===current.id),baseline=observed.get(current.id);let conflicted=false;
      if(baseline!==undefined&&(!stored||projectState(stored)!==baseline)){
        if(projectState(current)===baseline){projects=fresh;status('Расчёт изменён в другой вкладке. Откройте его из «Моих расчётов», чтобы увидеть новую версию.');return;}
        if(fresh.length>=60)throw new Error('Расчёт изменён в другой вкладке, а папка заполнена. Выгрузите свою версию файлом.');
        current=duplicateProject(current);current.name=current.name.slice(0,100)+' · другая вкладка';$('[data-project-name]').value=current.name;history.replaceState(history.state,'',`${location.pathname}#project=${encodeURIComponent(current.id)}`);conflicted=true;
      }
      const merged=fresh.filter(p=>p.id!==current.id&&!deletedIds.has(p.id));for(const p of pendingNew.values())if(p.id!==current.id&&!deletedIds.has(p.id)&&!merged.some(x=>x.id===p.id))merged.push(p);merged.push(current);writeProjects(localStorage,merged);projects=merged;observed.set(current.id,projectState(current));pendingNew.clear();status(conflicted?'Сохранено отдельной копией: исходный расчёт изменён в другой вкладке.':'Сохранено на этом устройстве');
    }catch(error){status(`Не удалось сохранить на этом устройстве. ${error.message} Выгрузите файл проекта.`);}
  }
  function folder(){
    const panel=$('[data-folder]');panel.hidden=!folderOpen;if(!folderOpen)return;
    panel.innerHTML=`<h2>Мои расчёты · ${projects.length}/60</h2><p class="tool-hint">Каждый расчёт независим. Переименование доступно в поле над инструментом.</p>${button('all-export','Выгрузить всю папку')}${removed?button('undo-delete','Отменить удаление'):''}${projects.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(p=>`<div class="tool-folder-item"><div><p>${escape(p.name)}</p><small>${escape(p.tool)} · ${new Date(p.updatedAt).toLocaleDateString('ru-RU')}${p.demo?' · пример':''}</small></div><div class="tool-row-actions">${button('open-project','Открыть',`data-id="${escape(p.id)}"`)}${button('duplicate-project','Дублировать',`data-id="${escape(p.id)}"`)}${button('delete-project','Удалить',`data-id="${escape(p.id)}"`)}</div></div>`).join('')}`;
  }
  function renderForm(){ const focused=document.activeElement?.dataset?.field;$('[data-fields]').innerHTML=historical()?'<p class="tool-hint">Исторический расчёт защищён от изменений. Пересчитайте копию по текущей методике.</p>':adapter.form(current.input,root);$('[data-project-name]').value=current.name;$('[data-demo]').hidden=!current.demo;if(focused)root.querySelector(`[data-field="${CSS.escape(focused)}"]`)?.focus(); }
  function tab(name){$('[data-active-tab]').dataset.activeTab=name;root.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===name)));}
  function clearResult(message='Введите исходные данные для расчёта.'){
    result=null;$('[data-error]').hidden=true;$('[data-summary]').innerHTML='';$('[data-result-table]').innerHTML='';$('[data-extra]').innerHTML='';$('[data-notes]').innerHTML='';$('[data-diagram]').innerHTML=`<p class="tool-empty">${escape(message)}</p>`;root.querySelectorAll('[data-needs-result]').forEach(b=>b.disabled=true);
  }
  function renderResult(){
    $('[data-error]').hidden=true;
    $('[data-summary]').innerHTML=result.summary.map(s=>`<dl class="tool-metric"><dt>${escape(s.label)}</dt><dd>${escape(format(s.value))} <small>${escape(s.unit||'')}</small></dd></dl>`).join('');
    $('[data-notes]').innerHTML=(result.warnings||result.notes||[]).map(s=>`<p>${escape(s)}</p>`).join('');
    $('[data-result-table]').innerHTML=table(result);
    $('[data-diagram]').innerHTML=adapter.diagram(result,current.input,active,root);
    $('[data-action="zoom"]').hidden=!$('[data-diagram] svg');
    $('[data-extra]').innerHTML=adapter.extra?.(result,current.input,root)||'';
    root.querySelectorAll('[data-needs-result]').forEach(b=>b.disabled=false);
  }
  function showHistory(){
    const p=$('[data-history]');p.hidden=!historical();
    if(historical()){p.innerHTML=`${current.imported?'Импортирован исторический снимок. Его результаты пока не проверены.':'Методика или справочник изменились. Прежний расчёт сохранён отдельно.'} ${button('recalculate','Пересчитать копию по текущей методике')}<details><summary>Сохранённый текст результата (исторический, не проверен)</summary><pre style="white-space:pre-wrap">${escape(current.snapshotText||'Снимок результата отсутствует.')}</pre></details>`;}
    $('[data-tool-form]').inert=Boolean(historical());
  }
  async function compute(){
    const rev=++revision;computeController?.abort();computeController=new AbortController();
    if(historical()){clearResult('Откройте исторический снимок или пересчитайте его копию.');showHistory();return;}
    const cancel=$('[data-action="cancel"]');cancel.hidden=!adapter.asyncCalculate;
    try{shape(current);result=await (adapter.asyncCalculate?adapter.asyncCalculate(current.input,{signal:computeController.signal}):adapter.calculate(current.input,root));if(rev!==revision||!root.isConnected)return;renderResult();current.resultSnapshot={summary:result.summary,coefficients:result.coefficients||result.usedCoefficients||{},totals:result.totals||{}};current.snapshotText=summaryText(false);if(started&&!reported){reported=true;event(tool,'result');}save();}
    catch(error){if(rev!==revision)return;clearResult(error.name==='AbortError'?'Расчёт отменён. Измените данные или нажмите «Рассчитать».':'Исправьте данные, чтобы получить актуальный результат.');if(error.name!=='AbortError'){$('[data-error]').textContent=error.message;$('[data-error]').hidden=false;}delete current.resultSnapshot;delete current.snapshotText;save();}
    finally{if(rev===revision)cancel.hidden=true;}
  }
  function changed(){current.demo=false;delete current.resultSnapshot;delete current.snapshotText;$('[data-demo]').hidden=true;if(!started){started=true;event(tool,'start');}revision++;computeController?.abort();clearResult('Данные изменились. Проверяем расчёт…');clearTimeout(timer);clearTimeout(saveTimer);timer=setTimeout(compute,220);saveTimer=setTimeout(save,350);}
  function summaryText(includeRows=true){const block=t=>`${t.title||'Ведомость'}:\n${t.columns.map(c=>c.label).join(' | ')}\n${t.rows.map(r=>t.columns.map(c=>format(r[c.key])).join(' | ')).join('\n')}`;return `${content.title}\n${current.name}\nМетодика ${current.methodologyVersion}\n${result.summary.map(s=>`${s.label}: ${format(s.value)} ${s.unit||''}`).join('\n')}\n${(result.warnings||result.notes||[]).join('\n')}${includeRows?`\n\n${[result,...(result.extraTables||[])].map(block).join('\n\n')}`:''}`;}
  function switchProject(p){clearTimeout(timer);save();computeController?.abort();current=p;if(projects.some(saved=>saved.id===p.id))observed.set(p.id,projectState(p));history.replaceState(history.state,'',`${location.pathname}#project=${encodeURIComponent(p.id)}`);result=null;reported=false;started=false;renderForm();showHistory();folder();void compute();}
  on(root,'input',e=>{const path=e.target.dataset.field;if(path){set(current.input,path,e.target.type==='checkbox'?e.target.checked:e.target.value);adapter.onInput?.(current.input,path);changed();}if(e.target.matches('[data-project-name]')){current.name=e.target.value.trim()||'Без названия';clearTimeout(saveTimer);saveTimer=setTimeout(()=>{save();folder();},350);}});
  on(root,'change',e=>{if(e.target.dataset.field&&(e.target.tagName==='SELECT'||e.target.type==='checkbox'))renderForm();});
  on(root,'focusin',e=>{if(e.target.dataset.field){active=e.target.dataset.field;if(result)$('[data-diagram]').innerHTML=adapter.diagram(result,current.input,active,root);}});
  on($('[data-tool-form]'),'submit',e=>{e.preventDefault();if(!started){started=true;event(tool,'start');}clearTimeout(timer);void compute().then(()=>{if(result)tab('result');else if(!$('[data-error]').hidden)$('[data-error]').focus();});});
  on(root,'click',async e=>{
    const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
    try{
      if(action==='tab')tab(b.dataset.tab);
      else if(action==='fit'){$('[data-diagram]').scrollTo({top:0,left:0});$('[data-diagram]').querySelectorAll('svg').forEach(s=>{s.style.width='100%';s.style.maxWidth='100%';});}
      else if(action==='zoom'){$('[data-diagram]').querySelectorAll('svg').forEach(s=>{s.style.width='200%';s.style.maxWidth='none';});$('[data-diagram]').focus();}
      else if(action==='folder'){folderOpen=!folderOpen;folder();}
      else if(action==='new'||action==='example'){if(projects.length>=60)throw new Error('В папке уже 60 расчётов. Выгрузите архив и удалите ненужные.');const demo=action==='example';switchProject(createProject(tool,demo?adapter.example:adapter.blank,demo?`Пример · ${content.title}`:`${content.title} · ${new Date().toLocaleDateString('ru-RU')}`,adapter.methodologyVersion,adapter.referenceVersions||{},demo));tab('data');}
      else if(action==='open-project'){const p=projects.find(p=>p.id===b.dataset.id);if(p.tool===tool)switchProject(p);else location.href=`${base}instrumenty/${p.tool}/#project=${encodeURIComponent(p.id)}`;}
      else if(action==='duplicate-project'){if(projects.length>=60)throw new Error('В папке уже 60 расчётов.');const p=duplicateProject(projects.find(p=>p.id===b.dataset.id));projects.push(p);pendingNew.set(p.id,p);save();folder();if(p.tool===tool)switchProject(p);}
      else if(action==='delete-project'){const id=b.dataset.id;removed=projects.find(p=>p.id===id);deletedIds.add(id);pendingNew.delete(id);projects=projects.filter(p=>p.id!==id);if(current.id===id){clearTimeout(timer);clearTimeout(saveTimer);revision++;computeController?.abort();current=createProject(tool,adapter.blank,`Новый · ${content.title}`,adapter.methodologyVersion,adapter.referenceVersions||{});history.replaceState(history.state,'',location.pathname);renderForm();showHistory();clearResult();}$('[data-save-status]').textContent='Расчёт удалён. Можно отменить в папке.';if(!blockedStorage)writeProjects(localStorage,readProjects(localStorage).filter(p=>!deletedIds.has(p.id)));folder();}
      else if(action==='undo-delete'&&removed){if(projects.length>=60)throw new Error('В папке уже 60 расчётов.');deletedIds.delete(removed.id);observed.delete(removed.id);if(!projects.some(p=>p.id===current.id)&&removed.tool===tool){current=removed;renderForm();showHistory();void compute();}projects.push(removed);pendingNew.set(removed.id,removed);removed=null;save();folder();}
      else if(action==='recalculate'){if(projects.length>=60)throw new Error('В папке уже 60 расчётов.');const p=duplicateProject(current);p.methodologyVersion=adapter.methodologyVersion;p.referenceVersions=clone(adapter.referenceVersions||{});delete p.imported;shape(p);switchProject(p);}
      else if(['add-row','remove-row','duplicate-row','up-row','down-row'].includes(action)){
        const path=b.dataset.path,arr=get(current.input,path),i=Number(b.dataset.index);if(!Array.isArray(arr))return;
        if(action==='add-row'||action==='duplicate-row'){if(arr.length>=100)throw new Error('В интерфейсе допускается не более 100 строк в одном списке.');const row=clone(action==='add-row'?adapter.rowTemplates[path]:arr[i]);if(Object.hasOwn(row,'id'))row.id=newId();arr.splice(action==='add-row'?arr.length:i+1,0,row);}
        else if(action==='remove-row')arr.splice(i,1);else{const j=action==='up-row'?i-1:i+1;[arr[i],arr[j]]=[arr[j],arr[i]];}renderForm();changed();
      }
      else if(action==='cancel'){revision++;computeController?.abort();clearResult('Расчёт отменён.');b.hidden=true;}
      else if(action==='project-export'||action==='all-export'){save();const file=serialize(action==='all-export'?projects:[current]);if(new TextEncoder().encode(file).length>maxFileBytes)throw new Error('Архив больше 4 МБ. Выгрузите расчёты отдельными файлами.');download('smu1-project.json',file,'application/json');event(tool,'export');exportStatus('Файл проекта подготовлен. Сохраните его на устройстве.');}
      else if(action==='import')$('[data-import-file]').click();
      else if(action==='csv'&&result){download(`${tool}-vedomost.csv`,csv(result),'text/csv;charset=utf-8');event(tool,'export');exportStatus('CSV подготовлен: UTF-8, разделитель «;».');}
      else if(action==='print'&&result){const {printDocument}=await import('./core/print.mjs');await printDocument({current,result,content,adapter,root});event(tool,'export');exportStatus('Открыт системный диалог печати. Выберите принтер или «Сохранить в PDF».');}
      else if(action==='copy'&&result){const message=summaryText()+'\n\nПрошу уточнить возможность изготовления и стоимость. Ведомость прилагаю.';try{await navigator.clipboard.writeText(message);exportStatus('Текст запроса скопирован. Вставьте его в письмо или Telegram.');}catch{const area=document.createElement('textarea');area.className='ym-disable-keys';area.value=message;area.setAttribute('aria-label','Текст запроса для копирования');$('[data-export-status]').replaceChildren(area);area.focus();area.select();}event(tool,'contact_start');}
      else if(action==='to-metal'&&result&&adapter.toMetal){save();if(projects.length>=60)throw new Error('В папке уже 60 расчётов.');const metal=await loadAdapter('metal');const p=createProject('metal',adapter.toMetal(result),'Закупка из раскроя',metal.methodologyVersion,metal.referenceVersions||{});projects.push(p);pendingNew.set(p.id,p);if(blockedStorage)throw new Error('Хранилище недоступно. Выгрузите папку файлом проекта: закупка добавлена как отдельный расчёт.');writeProjects(localStorage,[...readProjects(localStorage),p]);pendingNew.delete(p.id);location.href=`${base}instrumenty/metal/#project=${encodeURIComponent(p.id)}`;}
      else if(adapter.action){const update=await adapter.action(action,{input:current.input,result,root,button:b,projects});if(update){renderForm();changed();}}
    }catch(error){exportStatus(error.message);}
  });
  on($('[data-import-file]'),'change',async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try{
      if(file.size>maxFileBytes)throw new Error('Файл больше 4 МБ.');const imported=parseFile(await file.text());
      for(const p of imported.projects){const a=await loadAdapter(p.tool);if(p.methodologyVersion===a.methodologyVersion){if(a.validateDraft)a.validateDraft(p.input);else validateShape(p.input,a.draftTemplate||a.example);}}
      const fresh=imported.projects.map(p=>({...p,id:newId(),imported:true}));
      if(projects.length+fresh.length>60)throw new Error('После импорта будет больше 60 расчётов.');
      // Validate and stage the entire file before changing any in-memory or persisted project.
      if(!blockedStorage){const latest=readProjects(localStorage);writeProjects(localStorage,[...latest,...fresh]);projects=[...latest,...fresh];}else{projects.push(...fresh);fresh.forEach(p=>pendingNew.set(p.id,p));}folderOpen=true;folder();exportStatus(`Импортировано: ${fresh.length}. Исходные расчёты сохранены. Откройте снимок и пересчитайте копию.`);
    }catch(error){exportStatus(`Импорт не выполнен. ${error.message} Существующие расчёты не изменены.`);}
  });
  root.querySelectorAll('[data-service-link]').forEach(link=>on(link,'click',()=>event(tool,'service')));
  root.querySelectorAll('[data-contact-link]').forEach(link=>on(link,'click',()=>event(tool,'contact_start')));
  teardown=()=>{clearTimeout(timer);clearTimeout(saveTimer);revision++;computeController?.abort();save();life.abort();delete root.dataset.ready;};
  try{if(!historical())shape(current);await adapter.prepare?.(root,historical()?clone(adapter.blank):current.input);adapter.bind?.(root,life.signal);renderForm();showHistory();await compute();}catch(error){clearResult(error.message);exportStatus('Сохранённый расчёт сохранён в папке. Начните новый или выгрузите файл.');}
}
document.addEventListener('astro:before-swap',()=>teardown());
document.addEventListener('astro:page-load',()=>void init());
window.addEventListener('pagehide',()=>teardown());
window.addEventListener('pageshow',e=>{if(e.persisted)void init();});
void init();

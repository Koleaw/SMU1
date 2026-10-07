import {escape,table,format} from './view.mjs';
function inputRows(root) {return [...root.querySelectorAll('[data-fields] [data-field]')].map(control=>({field:[control.closest('fieldset')?.querySelector('legend')?.textContent,control.closest('label')?.querySelector('span')?.textContent].filter(Boolean).join(' · '),value:control.type==='checkbox'?(control.checked?'Да':'Нет'):control.tagName==='SELECT'?control.selectedOptions[0]?.textContent:control.value||'Не указано'}));}
export async function printDocument({current,result,content,adapter,root}){
  document.querySelector('.tool-print')?.remove();
  const doc=document.createElement('article');doc.className='tool-print ym-hide-content';
  const compactColumns=adapter.printColumns||result.columns.filter(c=>!['source','price','priceUnit','massPerMetre','massPerSheet'].includes(c.key));
  const diagrams=adapter.printDiagram?.(result,current.input,root)||adapter.diagram(result,current.input,'',root);
  doc.innerHTML=`<header><p>СМУ-1 · ${escape(new Date().toLocaleDateString('ru-RU'))}</p><h1>${escape(content.title)}</h1><p>${escape(current.name)}${current.demo?' · ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ':''}</p><p>Методика ${escape(current.methodologyVersion)}${Object.keys(current.referenceVersions).length?` · Справочники: ${escape(Object.entries(current.referenceVersions).map(([k,v])=>`${k} ${v}`).join(', '))}`:''}</p></header><h2>Результат</h2>${result.summary.map(s=>`<p><strong>${escape(s.label)}:</strong> ${escape(format(s.value))} ${escape(s.unit||'')}</p>`).join('')}<h2>Схема / комплектация</h2>${diagrams}<h2>Ведомость</h2>${table({...result,columns:compactColumns})}${adapter.extra?.(result,current.input,root)||''}<h2>Условия расчёта</h2>${(result.warnings||result.notes||[]).map(s=>`<p>${escape(s)}</p>`).join('')}${content.limitations.map(s=>`<p>${escape(s)}</p>`).join('')}<h2>Исходные данные</h2>${adapter.printInputs?.(current.input)||table({columns:[{key:'field',label:'Параметр'},{key:'value',label:'Значение'}],rows:inputRows(root)})}<h2>Методика и источники</h2>${content.methodology.map(s=>`<p>${escape(s)}</p>`).join('')}${content.sources.map(s=>`<p>${escape(s.title)}<br/>${escape(s.url)}</p>`).join('')}<footer><p>СМУ-1 · ${escape(content.contact.phone)} · ${escape(content.contact.email)}</p><p>Предварительные данные для обсуждения задачи. Состав и условия работ согласуются отдельно.</p></footer>`;
  document.body.append(doc);
  doc.querySelectorAll('details').forEach(details=>{details.open=true;});
  await document.fonts?.ready;
  await Promise.allSettled([...doc.querySelectorAll('img')].map(img=>img.decode()));
  window.print();
}

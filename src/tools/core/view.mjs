import {format} from './numbers.mjs';
export {format};
export const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const get = (object,path) => path.split('.').reduce((a,k)=>a?.[k],object);
export function set(object,path,value) { const parts=path.split('.'); let p=object; for(const k of parts.slice(0,-1)) p=p[k]; p[parts.at(-1)]=value; }
export const field = (path,label,options={}) => ({path,label,...options});
export function inputField(input, f) {
  const value=get(input,f.path), id=`tool-${f.path.replaceAll('.','-')}`;
  const attr=`id="${id}" data-field="${escape(f.path)}"`;
  const control=f.options?`<select ${attr}>${f.options.map(o=>{const [v,t]=Array.isArray(o)?o:[o,o];return `<option value="${escape(v)}" ${String(value)===String(v)?'selected':''}>${escape(t)}</option>`}).join('')}</select>`:f.type==='checkbox'?`<input ${attr} type="checkbox" ${value?'checked':''}>`:f.type==='textarea'?`<textarea ${attr} maxlength="${f.maxlength||2000}" rows="3">${escape(value)}</textarea>`:`<input ${attr} type="text" ${f.type==='text'?'':'inputmode="decimal"'} maxlength="${f.type==='text'?f.maxlength||160:24}" value="${escape(value)}" ${f.placeholder?`placeholder="${escape(f.placeholder)}"`:''} autocomplete="off">`;
  return `<label class="tool-field ${f.type==='checkbox'?'tool-check':''} ${f.options||f.type==='textarea'||f.type==='text'?'tool-field-wide':''}" for="${id}"><span>${escape(f.label)}${f.unit?` <small>${escape(f.unit)}</small>`:''}</span>${control}${f.hint?`<small>${escape(f.hint)}</small>`:''}</label>`;
}
export const fields = (input, defs) => `<div class="tool-fields">${defs.map(f=>inputField(input,f)).join('')}</div>`;
export const group = (title,body,note='') => `<fieldset class="tool-group"><legend>${escape(title)}</legend>${note?`<p class="tool-hint">${escape(note)}</p>`:''}${body}</fieldset>`;
export const button = (action,label,attrs='') => `<button type="button" class="tool-button" data-action="${escape(action)}" ${attrs}>${escape(label)}</button>`;
export const rowActions = (path,index,length) => `<div class="tool-row-actions">${button('duplicate-row','Дублировать',`data-path="${path}" data-index="${index}"`)}${button('remove-row','Удалить',`data-path="${path}" data-index="${index}"`)}${index?button('up-row','↑ Выше',`data-path="${path}" data-index="${index}"`):''}${index<length-1?button('down-row','↓ Ниже',`data-path="${path}" data-index="${index}"`):''}</div>`;
export function table(result) { return `<div class="tool-table-wrap"><table class="tool-table"><thead><tr>${result.columns.map(c=>`<th scope="col">${escape(c.label)}</th>`).join('')}</tr></thead><tbody>${result.rows.map(row=>`<tr>${result.columns.map(c=>`<td>${escape(format(row[c.key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
export function svg(body, label, height=420) { return `<svg class="tool-svg" viewBox="0 0 760 ${height}" role="img" aria-label="${escape(label)}" xmlns="http://www.w3.org/2000/svg"><title>${escape(label)}</title><defs><pattern id="tool-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="currentColor" opacity=".065"/></pattern><pattern id="tool-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2 2L2 -2M0 8L8 0M6 10L10 6" stroke="#a96234" stroke-width="1"/></pattern></defs><rect width="760" height="${height}" fill="url(#tool-grid)"/>${body}</svg>`; }
export const txt = (x,y,text,attrs='') => `<text x="${x}" y="${y}" ${attrs}>${escape(text)}</text>`;
export function dim(x1,y1,x2,y2,label,key='',active='') { return `<g class="tool-dimension ${key&&active.endsWith(key)?'is-active':''}"><path d="M${x1} ${y1}L${x2} ${y2}"/><path d="M${x1-4} ${y1-5}l8 10M${x2-4} ${y2-5}l8 10"/>${txt((x1+x2)/2,(y1+y2)/2-9,label,'text-anchor="middle"')}</g>`; }

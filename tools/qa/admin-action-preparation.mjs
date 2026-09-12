import { findAdminActionElement } from './admin-action-state.mjs';
import { visibleClickPoint } from './actionable-click.mjs';

// Serialized into CDP: reads observable state, never calls application handlers.
export function readAdminControlState(documentValue, action, element) {
  const frame = documentValue.querySelector('#veFrame');
  const canvas = frame?.contentDocument;
  const win = documentValue.defaultView;
  const documents = win.__h6ActionDocuments ||= { ids: new WeakMap(), next: 1 };
  if (canvas && !documents.ids.has(canvas)) documents.ids.set(canvas, documents.next++);
  const bindingId = action.dataAttributes?.['data-binding-id'] || '';
  const rows = action.containerId === 'veOverlay'
    ? Array.from(canvas?.querySelectorAll('[data-smu1-binding-id][data-smu1-binding]') || []).flatMap(node => {
      try { return [{ node, binding: JSON.parse(node.getAttribute('data-smu1-binding')) }]; } catch { return []; }
    }) : [];
  const binding = rows.find(row => row.node.getAttribute('data-smu1-binding-id') === bindingId)?.binding;
  const order = binding?.tool === 'reorder-item' ? [...new Set(rows.filter(row => row.binding?.tool === 'reorder-item'
    && row.binding.zoneId === binding.zoneId).map(row => String(row.binding.stableItemId || row.binding.recordSlug || '')))] : [];
  return JSON.stringify({
    className: element?.className, expanded: element?.getAttribute('aria-expanded'), pressed: element?.getAttribute('aria-pressed'), selected: element?.getAttribute('aria-selected'),
    detailsOpen: element?.tagName === 'SUMMARY' ? element.parentElement.open : null,
    fullscreen: documentValue.querySelector('#veApp')?.dataset.fullscreen === 'true',
    body: documentValue.body.className, html: documentValue.documentElement.className,
    dialogs: documentValue.querySelectorAll('dialog[open],[role="dialog"]:not([hidden])').length,
    hidden: documentValue.querySelectorAll('[hidden]').length,
    status: Array.from(documentValue.querySelectorAll('[aria-live]')).map(item => item.textContent?.trim()).filter(Boolean).slice(0, 12),
    active: documentValue.activeElement === element,
    canvasDocument: canvas ? documents.ids.get(canvas) : null,
    selectedBinding: Array.from(documentValue.querySelectorAll('#veOverlay [data-control-key="target"][aria-pressed="true"]')).find(node => node.dataset.bindingId === bindingId)?.dataset.bindingId || '',
    inspectorOpen: documentValue.querySelector('#veApp')?.dataset.inspectorOpen === 'true',
    inlineBinding: (() => { const inline = documentValue.querySelector('#veInlineEditor'); return inline && !inline.hidden ? inline.dataset.bindingId || '' : ''; })(),
    reorder: binding?.tool === 'reorder-item' ? { zoneId: binding.zoneId || '', identity: String(binding.stableItemId || binding.recordSlug || ''), orderedIds: order } : null
  });
}

export const adminActionStateExpression = action => `(() => {
  const documentValue = ${action.context === 'shell' ? 'document' : `Array.from(document.querySelectorAll('iframe')).find((frame,index) => 'iframe-' + (frame.id || index + 1) === ${JSON.stringify(action.context)})?.contentDocument`};
  if (!documentValue) return null;
  const element = (${findAdminActionElement.toString()})(documentValue, ${JSON.stringify(action)});
  return (${readAdminControlState.toString()})(documentValue, ${JSON.stringify(action)}, element);
})()`;

export const armAdminActionTraceExpression = () => `(() => {
  window.__h6AdminActionTrace?.dispose();
  const events = [];
  const observe = event => {
    const target = event.target?.closest?.('[data-binding-id][data-control-key]');
    if (!target) return;
    events.push({ type: event.type, isTrusted: event.isTrusted, key: event.key || '', bindingId: target.dataset.bindingId, controlKey: target.dataset.controlKey });
  };
  for (const type of ['pointerdown','pointerup','click','keydown']) document.addEventListener(type, observe, true);
  window.__h6AdminActionTrace = { events, dispose: () => { for (const type of ['pointerdown','pointerup','click','keydown']) document.removeEventListener(type, observe, true); } };
})()`;

export function adminActionProbeExpression(action, { scroll = false, interaction = 'click' } = {}) {
  return `(async () => {
    const action = ${JSON.stringify(action)};
    const find = ${findAdminActionElement.toString()};
    const frame = action.context === 'shell' ? null : Array.from(document.querySelectorAll('iframe')).find((frame,index) => 'iframe-' + (frame.id || index + 1) === action.context);
    const documentValue = action.context === 'shell' ? document : frame?.contentDocument;
    if (!documentValue) return { found:false, executable:false, reason:'missing-document' };
    let element = find(documentValue, action);
    if (!element) return { found:false, executable:false, reason:'missing-control' };
    if (${JSON.stringify(scroll)}) {
      if (action.containerId === 'veOverlay') {
        const canvas = document.querySelector('#veFrame');
        const source = Array.from(canvas?.contentDocument?.querySelectorAll('[data-smu1-binding-id]') || []).find(node => node.getAttribute('data-smu1-binding-id') === action.dataAttributes?.['data-binding-id']);
        if (!source) return { found:true, executable:false, reason:'missing-binding-source' };
        const key = action.dataAttributes?.['data-control-key'] || '';
        // Reorder controls are anchored to the source's top, even when its
        // image/card is taller than the iframe viewport.
        const block = key === 'handle' || key.startsWith('move-') ? 'start' : 'center';
        const inline = key === 'handle' ? 'start' : key.startsWith('move-') ? 'end' : 'center';
        source.scrollIntoView({block,inline,behavior:'instant'});
        canvas.contentWindow.dispatchEvent(new canvas.contentWindow.Event('scroll'));
      } else element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    }
    const frameTick = () => new Promise(resolve => requestAnimationFrame(resolve));
    await frameTick();
    element = find(documentValue, action);
    if (!element) return { found:false, executable:false, reason:'replaced' };
    const before = element.getBoundingClientRect();
    await frameTick();
    if (!element.isConnected || find(documentValue, action) !== element) return { found:true, executable:false, reason:'replaced' };
    const rect = element.getBoundingClientRect(), style = documentValue.defaultView.getComputedStyle(element);
    if (element.hidden || element.disabled || element.getAttribute('aria-disabled') === 'true' || element.closest('[hidden]')
      || style.display === 'none' || style.visibility === 'hidden' || rect.width < 1 || rect.height < 1) return { found:true, executable:false, reason:'hidden' };
    if (['x','y','width','height'].some(key => Math.abs(rect[key] - before[key]) > 0.25)) return { found:true, executable:false, reason:'moving' };
    const hit = (${visibleClickPoint.toString()})(element);
    if (!hit.ready) return { found:true, executable:false, reason:hit.reason, hit:hit.hit || '', rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height} };
    const frameRect = frame?.getBoundingClientRect() || {left:0,top:0};
    const point = {x:frameRect.left+hit.x,y:frameRect.top+hit.y};
    if (point.x < 0 || point.y < 0 || point.x >= innerWidth || point.y >= innerHeight) return {found:true,executable:false,reason:'outside-shell-viewport'};
    if (frame && document.elementFromPoint(point.x,point.y) !== frame) return {found:true,executable:false,reason:'covered-by-shell'};
    if (${JSON.stringify(interaction)} === 'keyboard') element.focus({preventScroll:true});
    return {found:true,executable:true,active:documentValue.activeElement === element,point,
      before:(${readAdminControlState.toString()})(documentValue,action,element), matched:{bindingId:element.dataset.bindingId || '',controlKey:element.dataset.controlKey || ''}};
  })()`;
}

// Readiness may be sampled repeatedly; this helper never dispatches or retries an action.
export async function prepareAdminAction(browser, action, {timeoutMs = 8000, interaction = 'click'} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last, first = true;
  do {
    last = await browser.evaluate(adminActionProbeExpression(action, {scroll:first, interaction}));
    first = false;
    if (last?.executable && (interaction === 'click' || last.active)) return last;
    if (['missing-document','missing-control','hidden','missing-binding-source'].includes(last?.reason)) return last;
    await new Promise(resolve => setTimeout(resolve,40));
  } while (Date.now() < deadline);
  return last || {found:false,executable:false,reason:'readiness-timeout'};
}

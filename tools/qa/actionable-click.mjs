const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Self-contained so CDP callers can use the same hit test while selecting a
// target. Bounding boxes alone do not account for clipped scrolling ancestors.
export function visibleClickPoint(element) {
  const doc = element.ownerDocument, win = doc.defaultView;
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left), right = Math.min(win.innerWidth, rect.right);
  let top = Math.max(0, rect.top), bottom = Math.min(win.innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return { ready: false, reason: 'outside-viewport' };
  // The useful rectangle is the intersection of every scrolling/clipping
  // ancestor. Sampling the uncut rectangle misses exposed parent padding.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = win.getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    const scaleX = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
    const scaleY = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
    const clipLeft = bounds.left + parent.clientLeft * scaleX;
    const clipTop = bounds.top + parent.clientTop * scaleY;
    if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
      left = Math.max(left, clipLeft); right = Math.min(right, clipLeft + parent.clientWidth * scaleX);
    }
    if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
      top = Math.max(top, clipTop); bottom = Math.min(bottom, clipTop + parent.clientHeight * scaleY);
    }
  }
  if (right <= left || bottom <= top) return { ready: false, reason: 'clipped-by-ancestor' };
  const points = [[.5,.5],[.5,.2],[.2,.2],[.8,.2],[.2,.5],[.8,.5],[.2,.8],[.5,.8],[.8,.8]]
    .map(([px, py]) => [left + (right-left)*px, top + (bottom-top)*py]);
  // Nested text/media controls may cover the centre of a parent while its
  // padding remains a real native target. Edges still require exact hit-testing.
  const insetX = Math.min(8, (right-left)/2), insetY = Math.min(8, (bottom-top)/2);
  for (const x of [left+insetX, (left+right)/2, right-insetX]) {
    for (const y of [top+insetY, (top+bottom)/2, bottom-insetY]) points.push([x,y]);
  }
  let hit = null, toast = null;
  for (const [x, y] of points) {
    hit = doc.elementFromPoint(x, y);
    if (hit === element || element.contains(hit)) return { ready: true, x, y };
    toast ||= hit?.closest('#veToastRegion .ve-toast');
  }
  if (toast) toast.dataset.acceptanceDismiss = 'true';
  return { ready: false, reason: 'covered', hit: hit?.id || hit?.getAttribute('data-binding-id') || hit?.tagName || '', toast: Boolean(toast) };
}

// CDP dispatches coordinates without Playwright's actionability checks. Wait for
// layout/scroll handlers and a stable, unobstructed target before dispatching once.
export async function clickWhenReady(browser, selector, { scroll = true, timeoutMs = 8000, dismissToasts = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await browser.evaluate(`(async () => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.hidden || element.disabled || element.closest('[hidden]')) return { ready: false, reason: 'unavailable' };
      if (${JSON.stringify(scroll)}) element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      await frame();
      const before = element.getBoundingClientRect();
      await frame();
      if (!element.isConnected || document.querySelector(${JSON.stringify(selector)}) !== element) return { ready: false, reason: 'replaced' };
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (rect.width < 1 || rect.height < 1 || style.visibility === 'hidden' || style.display === 'none') return { ready: false, reason: 'hidden' };
      if (['x', 'y', 'width', 'height'].some(key => Math.abs(rect[key] - before[key]) > 0.25)) return { ready: false, reason: 'moving' };
      return (${visibleClickPoint.toString()})(element);
    })()`);
    if (last?.ready) {
      const point = { x: last.x, y: last.y };
      await browser.dispatchClick(point);
      return point;
    }
    if (dismissToasts && last?.toast) {
      await clickWhenReady(browser, '#veToastRegion [data-acceptance-dismiss="true"]', { timeoutMs: 2000, scroll: false });
    }
    await sleep(40);
  }
  throw new Error(`Clickable control did not become stable and unobstructed: ${selector}. ${JSON.stringify(last)}`);
}

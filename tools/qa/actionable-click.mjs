const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
      const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
      if (right <= left || bottom <= top) return { ready: false, reason: 'outside-viewport', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } };
      const x = (left + right) / 2, y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit !== element && !element.contains(hit)) {
        const toast = hit?.closest('#veToastRegion .ve-toast');
        if (toast) toast.dataset.acceptanceDismiss = 'true';
        return { ready: false, reason: 'covered', hit: hit?.id || hit?.tagName || '', toast: Boolean(toast) };
      }
      return { ready: true, x, y };
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

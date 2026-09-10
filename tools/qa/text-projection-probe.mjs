// Executed in the browser: both timestamps use the same performance clock.
// CDP transport/polling latency is diagnostic, not part of the editor's feedback.
export function observeTextProjection({ inputSelector, bindingId, value, expected, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const input = document.querySelector(inputSelector);
    const canvas = document.querySelector('#veFrame')?.contentDocument;
    const selector = '[data-smu1-binding-id="' + CSS.escape(bindingId) + '"]';
    const text = () => canvas?.querySelector(selector)?.textContent?.replace(/\s+/gu, ' ').trim() || '';
    if (!input || input.disabled || input.closest('[hidden]') || !canvas?.querySelector(selector)) {
      reject(new Error('Text input or projected binding is unavailable.'));
      return;
    }
    if (!expected || text().includes(expected)) {
      reject(new Error('Projection marker must be new before the input gesture.'));
      return;
    }
    let started = 0, settled = false;
    const finish = (error, projected) => {
      if (settled) return;
      settled = true;
      const elapsedMs = performance.now() - started;
      observer.disconnect();
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ projected, elapsedMs, clock: 'browser-performance-input-to-dom' });
    };
    const check = () => {
      const projected = text();
      if (projected.includes(expected)) finish(null, projected);
    };
    // Observe the document too: projection may replace the bound element.
    const observer = new MutationObserver(check);
    observer.observe(canvas, { subtree: true, childList: true, characterData: true });
    const timer = setTimeout(() => finish(new Error('Timed out waiting for text projection.')), timeoutMs);
    started = performance.now();
    try {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      check();
    } catch (error) { finish(error); }
  });
}

export async function measureTextProjection(browser, settings) {
  const started = performance.now();
  const result = await browser.evaluate(`(${observeTextProjection.toString()})(${JSON.stringify(settings)})`);
  return { ...result, wallMs: performance.now() - started };
}

// Serialized into the browser. Inspect the real result, not only data-ready:
// that attribute is set before the route adapter and MAF catalogue are loaded.
export function waitForRenderedTool(timeoutMs = 8000) {
  const root = document.querySelector('[data-tool-app]');
  if (!root) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error) => {
      observer.disconnect();
      clearTimeout(timer);
      if (error) reject(error); else resolve(true);
    };
    const inspect = () => {
      const error = root.querySelector('[data-error]');
      if (error && !error.hidden && error.textContent.trim()) {
        finish(new Error(`Tool ${root.dataset.toolId} failed: ${error.textContent.trim()}`));
        return;
      }
      if (root.querySelector('[data-summary] dl') && root.querySelector('[data-result-table] table')
        && root.querySelector('[data-fields]')?.children.length
        && root.querySelector('[data-action="cancel"]')?.hidden
        && root.querySelector('[data-action="csv"]')?.disabled === false) finish();
    };
    const observer = new MutationObserver(inspect);
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    timer = setTimeout(() => finish(new Error(`Tool ${root.dataset.toolId} did not render a valid result within ${timeoutMs} ms: ${root.querySelector('[data-save-status]')?.textContent || ''}`)), timeoutMs);
    inspect();
  });
}

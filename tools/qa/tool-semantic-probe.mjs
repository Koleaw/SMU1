// Calculator controls mutate only disposable local browser projects. Native
// print/file/clipboard/download operations have a separate document QA suite.
export async function exerciseToolSemantics(browser, { requestedUrl } = {}) {
  const checks = [];
  const coveredActions = new Set();
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), ...(detail ? { detail } : {}) });
  const waitFor = async (expression, ms = 8_000) => {
    const end = Date.now() + ms;
    do {
      if (await browser.evaluate(expression)) return true;
      await new Promise(resolve => setTimeout(resolve, 35));
    } while (Date.now() < end);
    return false;
  };
  const click = async (selector, keyboard = false) => {
    const point = await browser.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.disabled || !el.getClientRects().length) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.focus({ preventScroll: true });
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, focused: document.activeElement === el };
    })()`);
    if (!point?.focused) throw new Error(`Tool control unavailable or cannot receive focus: ${selector}`);
    if (keyboard) await browser.dispatchKey('Enter', { code: 'Enter' }); else await browser.dispatchClick(point);
  };
  const action = async (id, keyboard = false, suffix = '') => {
    const selector = `[data-tool-app] [data-action="${id}"]${suffix}`;
    // The mobile tabs are intentionally absent from desktop layout, where all
    // three panels are visible at once.
    if (id === 'tab' && !await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length)`)) return false;
    await click(selector, keyboard); coveredActions.add(id); return true;
  };
  const current = `(() => { const app = document.querySelector('[data-tool-app]'); const projects = JSON.parse(localStorage.getItem('smu1.tools.projects.v1') || '{}').projects || []; return projects.filter(p => p.tool === app?.dataset.toolId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0]; })()`;
  const valid = `Boolean(document.querySelector('[data-summary] dl') && document.querySelector('[data-error]')?.hidden)`;
  const fill = async (selector, value) => {
    await browser.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); })()`);
    await browser.send('Input.insertText', { text: value });
  };
  const count = () => browser.evaluate(`(JSON.parse(localStorage.getItem('smu1.tools.projects.v1') || '{}').projects || []).length`);
  try {
    check('initial-result', await waitFor(valid));
    check('initial-save', await waitFor(`document.querySelector('[data-save-status]')?.textContent === 'Сохранено на этом устройстве'`));
    check('idle-worker-cancel-hidden', await browser.evaluate(`!document.querySelector('[data-action="cancel"]').getClientRects().length`));
    check('private-calculation-markup', await browser.evaluate(`(() => {
      const app = document.querySelector('[data-tool-app]');
      return app?.classList.contains('ym-hide-content') && [...app.querySelectorAll('input:not([type="file"]), textarea')].every(field => field.classList.contains('ym-disable-keys'));
    })()`));
    for (const name of ['diagram', 'result', 'data']) {
      if (await action('tab', true, `[data-tab="${name}"]`)) check(`keyboard-tab-${name}`, await browser.evaluate(`document.querySelector('[data-active-tab]').dataset.activeTab === ${JSON.stringify(name)} && document.querySelector('[data-tab="${name}"]').getAttribute('aria-pressed') === 'true'`));
    }
    await action('tab', false, '[data-tab="diagram"]');
    const hasSvg = await browser.evaluate(`Boolean(document.querySelector('[data-diagram] svg'))`);
    if (hasSvg) {
      await action('zoom', true);
      check('keyboard-zoom-diagram', await waitFor(`document.activeElement === document.querySelector('[data-diagram]') && [...document.querySelectorAll('[data-diagram] svg')].every(s => s.style.width === '200%') && document.querySelector('[data-diagram]').scrollWidth > document.querySelector('[data-diagram]').clientWidth`));
      await browser.dispatchKey('ArrowRight', { code: 'ArrowRight' });
      check('keyboard-diagram-scroll', await waitFor(`document.querySelector('[data-diagram]').scrollLeft > 0`));
    } else {
      check('non-svg-zoom-hidden', await browser.evaluate(`!document.querySelector('[data-action="zoom"]').getClientRects().length`));
      await browser.evaluate(`document.querySelector('[data-diagram]').focus()`);
    }
    check('keyboard-diagram-focus', await browser.evaluate(`document.activeElement === document.querySelector('[data-diagram]')`));
    await action('fit', true);
    check('fit-diagram', await browser.evaluate(`!!document.querySelector('[data-diagram] svg, [data-diagram] .tool-product-card') && [...document.querySelectorAll('[data-diagram] svg')].every(s => s.style.width === '100%')`));
    await action('tab', true, '[data-tab="data"]');
    const numeric = await browser.evaluate(`(() => { const el = document.querySelector('[data-fields] input[inputmode="decimal"]'); return el ? { path: el.dataset.field, value: el.value } : null; })()`);
    if (numeric) {
      const selector = `[data-field="${numeric.path}"]`;
      const priorSummary = await browser.evaluate(`document.querySelector('[data-summary]').textContent`);
      await fill(selector, '');
      // Empty required input must invalidate, while an optional empty input may
      // remain valid. In both cases the persisted input must reflect the edit.
      check('empty-input-stored', await waitFor(`(() => { const p = ${current}; return p && ${JSON.stringify(numeric.path)}.split('.').reduce((v,k) => v?.[k], p.input) === ''; })()`));
      check('empty-input-honest-result', await waitFor(`Boolean((!document.querySelector('[data-summary] dl') && !document.querySelector('[data-error]').hidden && !(${current})?.resultSnapshot) || (document.querySelector('[data-tool-app]').dataset.toolId === 'zdanie' && document.querySelector('[data-summary] dl') && document.querySelector('[data-error]').hidden && document.querySelector('[data-summary]').textContent !== ${JSON.stringify(priorSummary)}))`));
      await fill(selector, '-1');
      check('invalid-input-error-visible-in-data', await waitFor(`(() => {
        const error = document.querySelector('[data-error]');
        return document.querySelector('[data-active-tab]').dataset.activeTab === 'data' && !error.hidden
          && error.getClientRects().length > 0 && getComputedStyle(error).visibility === 'visible'
          && !document.querySelector('[data-summary] dl') && !(${current})?.resultSnapshot;
      })()`));
      await click('[data-tool-form] button[type="submit"]', true);
      check('invalid-submit-focuses-error', await waitFor(`document.activeElement === document.querySelector('[data-error]')`));
      const commaValue = String(numeric.value).includes('.') || String(numeric.value).includes(',')
        ? String(numeric.value).replace('.', ',') : `${numeric.value || '1'},0`;
      await fill(selector, commaValue);
      check('decimal-comma-result', await waitFor(valid));
    }
    await click('[data-tool-form] button[type="submit"]', true);
    check('keyboard-compute', await waitFor(valid));
    await action('tab', true, '[data-tab="result"]');
    await click('.tool-details > summary', true);
    check('full-statement', await browser.evaluate(`document.querySelector('.tool-details').open && !!document.querySelector('[data-result-table] tbody tr')`));
    const renamed = 'Контроль сохранения СМУ-1';
    await fill('[data-project-name]', renamed);
    check('rename-persisted', await waitFor(`(${current})?.name === ${JSON.stringify(renamed)}`));
    const beforeReload = await browser.evaluate(`${current}`);
    await browser.navigate(requestedUrl, { waitForFonts: false });
    check('reload-restores-name-and-input', await waitFor(`(() => { const p = ${current}; return document.querySelector('[data-project-name]')?.value === ${JSON.stringify(renamed)} && JSON.stringify(p?.input) === ${JSON.stringify(JSON.stringify(beforeReload.input))}; })()`));
    check('reload-recalculates', await waitFor(valid));
    await action('folder', true);
    check('folder-opens', await browser.evaluate(`!document.querySelector('[data-folder]').hidden`));
    const beforeDuplicate = await count();
    await action('duplicate-project', true);
    check('duplicate-independent-id', await waitFor(`(() => { const items = JSON.parse(localStorage.getItem('smu1.tools.projects.v1')).projects; return items.length === ${beforeDuplicate + 1} && new Set(items.map(p => p.id)).size === items.length; })()`));
    await action('open-project', true);
    check('folder-open-project-result', await waitFor(valid));
    const beforeDelete = await count();
    await action('delete-project', true);
    check('delete-project', await waitFor(`(JSON.parse(localStorage.getItem('smu1.tools.projects.v1')).projects.length) === ${beforeDelete - 1}`));
    await action('undo-delete', true);
    check('undo-restores-project', await waitFor(`(JSON.parse(localStorage.getItem('smu1.tools.projects.v1')).projects.length) === ${beforeDelete}`));
    await action('new', true);
    check('new-is-not-example', await waitFor(`document.querySelector('[data-demo]').hidden && !document.querySelector('[data-project-name]').value.startsWith('Пример')`));
    await action('example', true);
    check('example-explicit-and-valid', await waitFor(`${valid} && !document.querySelector('[data-demo]').hidden`));
    await action('tab', false, '[data-tab="data"]');
    const paths = await browser.evaluate(`[...new Set([...document.querySelectorAll('[data-action="add-row"],[data-action="duplicate-row"]')].map(el => el.dataset.path))]`);
    for (const path of paths) {
      const before = await browser.evaluate(`(${current}).input[${JSON.stringify(path)}].length`);
      const canAdd = await browser.evaluate(`!!document.querySelector('[data-action="add-row"][data-path="${path}"]')`);
      const added = canAdd ? 1 : 0;
      if (canAdd) {
        await action('add-row', true, `[data-path="${path}"]`);
        check(`add-row-${path}`, await waitFor(`(${current}).input[${JSON.stringify(path)}].length === ${before + 1}`));
      }
      await action('duplicate-row', true, `[data-path="${path}"]`);
      check(`duplicate-row-${path}`, await waitFor(`(${current}).input[${JSON.stringify(path)}].length === ${before + added + 1}`));
      for (const id of ['down-row', 'up-row']) {
        const available = await browser.evaluate(`!!document.querySelector('[data-action="${id}"][data-path="${path}"]:not([disabled])')`);
        if (available) {
          const index = await browser.evaluate(`Number(document.querySelector('[data-action="${id}"][data-path="${path}"]').dataset.index)`);
          const expectedRows = await browser.evaluate(`(${current}).input[${JSON.stringify(path)}]`);
          const target = index + (id === 'down-row' ? 1 : -1);
          [expectedRows[index], expectedRows[target]] = [expectedRows[target], expectedRows[index]];
          await action(id, true, `[data-path="${path}"]:not([disabled])`);
          check(`${id}-${path}`, await waitFor(`JSON.stringify((${current}).input[${JSON.stringify(path)}]) === ${JSON.stringify(JSON.stringify(expectedRows))}`));
        }
      }
      await action('remove-row', true, `[data-path="${path}"]`);
      check(`remove-row-${path}`, await waitFor(`(${current}).input[${JSON.stringify(path)}].length === ${before + added}`));
    }
    if (await browser.evaluate(`document.querySelector('[data-tool-app]').dataset.toolId === 'maf'`)) {
      const before = await browser.evaluate(`(${current}).input.rows.reduce((n,r) => n + Number(r.quantity), 0)`);
      await action('maf-add', true);
      check('maf-add-real-item', await waitFor(`(${current}).input.rows.reduce((n,r) => n + Number(r.quantity), 0) === ${before + 1}`));
      await action('maf-alternative', true);
      check('maf-compare-copy', await waitFor(`JSON.stringify((${current}).input.rows) === JSON.stringify((${current}).input.alternative)`));
      await fill('[data-maf-search]', 'несуществующееизделие92831');
      check('maf-search-filter', await browser.evaluate(`!document.querySelector('[data-maf-catalog] [data-product]')`));
      await fill('[data-maf-search]', '');
    }
    await action('example', true);
    check('final-example-restored', await waitFor(valid));
    if (await browser.evaluate(`!!document.querySelector('[data-action="to-metal"]')`)) {
      await action('tab', true, '[data-tab="result"]');
      const before = await count();
      await action('to-metal', true);
      check('cutting-transfer-new-project', await waitFor(`document.querySelector('[data-tool-app]')?.dataset.toolId === 'metal' && (JSON.parse(localStorage.getItem('smu1.tools.projects.v1')).projects.length) === ${before + 1} && (${current})?.input?.rows?.length > 0`));
      await browser.navigate(requestedUrl, { waitForFonts: false });
      check('transfer-origin-restored', await waitFor(valid));
    }
    // Keep the final form as the initial surface for inventory and link probes.
    if (await browser.evaluate(`!document.querySelector('[data-folder]').hidden`)) await action('folder', true);
    await action('tab', true, '[data-tab="data"]');
  } catch (error) {
    check('probe-completes', false, error instanceof Error ? error.message : String(error));
  }
  return { status: checks.length && checks.every(item => item.passed) ? 'pass' : 'fail', checks, coveredActions: [...coveredActions] };
}

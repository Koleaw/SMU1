// Semantic coverage for the read-only search dialog. Lead forms stay protected.
// The full interaction sequence runs once per viewport/shard; every entry point
// still opens, loads and closes by the requested mouse/keyboard mode.
export async function exercisePublicSearch(browser, { extended = false } = {}) {
  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), ...(detail ? { detail } : {}) });
  const waitFor = async (expression, timeout = 13_000) => {
    const deadline = Date.now() + timeout;
    do {
      if (await browser.evaluate(expression)) return true;
      await new Promise((resolve) => setTimeout(resolve, 35));
    } while (Date.now() < deadline);
    return false;
  };
  const click = async (selector) => {
    const point = await browser.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || !el.getClientRects().length) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error(`Search control unavailable: ${selector}`);
    await browser.dispatchClick(point);
  };
  const fill = async (value) => {
    await browser.evaluate(`(() => { const input = document.querySelector('[data-search-input]'); input.focus(); input.select(); })()`);
    await browser.send('Input.insertText', { text: value });
    await new Promise((resolve) => setTimeout(resolve, 135));
  };
  const focused = (selector) => browser.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
  try {
    check('dialog-open', await browser.evaluate(`Boolean(document.querySelector('[data-search-dialog]')?.open)`));
    check('input-focused-on-open', await focused('[data-search-input]'));
    const loaded = await waitFor(`(() => {
      const dialog = document.querySelector('[data-search-dialog]');
      return dialog?.dataset.searchReady === 'true' && /Найдите|Найдено/.test(dialog.querySelector('[data-search-status]').textContent || '');
    })()`);
    check('index-loaded', loaded);
    if (!loaded) throw new Error('Public search did not load its generated index');
    if (extended) {
      await fill('скамья Радиус');
      const exact = await browser.evaluate(`(() => { const a = document.querySelector('[data-search-results] a'); return { title: a?.querySelector('strong')?.textContent, href: a?.getAttribute('href'), base: document.querySelector('[data-search-dialog]').dataset.searchBase }; })()`);
      check('exact-title-and-base', exact.title === 'Скамья Радиус' && exact.href === `${exact.base}ulichnaya-mebel/lavochki-i-skameyki/skamya-radius/`, exact);
      await browser.dispatchKey('ArrowDown', { code: 'ArrowDown' });
      check('arrow-down-focus', await focused('[data-search-results] a'));
      await browser.dispatchKey('ArrowUp', { code: 'ArrowUp' });
      check('arrow-up-focus', await focused('[data-search-input]'));
      await browser.dispatchKey('Enter', { code: 'Enter' });
      check('submit-focuses-result', await focused('[data-search-results] a'));
      await fill('лавочка радиус');
      check('russian-synonym', await browser.evaluate(`document.querySelector('[data-search-results] strong')?.textContent === 'Скамья Радиус'`));
      await fill('Контур');
      check('description-matches-collapsed', await browser.evaluate(`(() => { const group = document.querySelector('[data-search-descriptions]'); return group?.tagName === 'DETAILS' && !group.open && [...group.querySelectorAll('a')].some((a) => a.textContent.includes('Вазон Овал') && a.querySelector('mark')?.textContent.toLowerCase() === 'контуром'); })()`));
      await click('[data-search-descriptions] summary');
      check('description-group-expands', await browser.evaluate(`document.querySelector('[data-search-descriptions]')?.open`));
      await fill('Овал');
      check('oval-title-primary', await browser.evaluate(`document.querySelector('[data-search-results] strong')?.textContent === 'Вазон Овал'`));
      await fill('скамья без спинки');
      check('characteristic-query', await browser.evaluate(`!!document.querySelector('[data-search-results] a')`));
      await fill('деревянными');
      check('description-only-results-immediate', await browser.evaluate(`(() => { const group = document.querySelector('[data-search-descriptions]'); return group?.tagName === 'SECTION' && !!group.querySelector('a mark')?.getClientRects().length; })()`));
      await fill('несуществующееизделие92831');
      check('no-results', await browser.evaluate(`!document.querySelector('[data-search-results] a') && document.querySelector('[data-search-status]').textContent.includes('Ничего не найдено')`));
      await click('[data-search-clear]');
      check('clear-query-and-focus', await browser.evaluate(`document.querySelector('[data-search-input]').value === '' && document.activeElement === document.querySelector('[data-search-input]')`));
      await click('[data-search-suggestions] button');
      check('suggestion-results', await browser.evaluate(`[...document.querySelectorAll('[data-search-results] a')].filter((a) => a.getClientRects().length).length === 12`));
      await click('[data-search-more]');
      check('more-results-and-focus', await browser.evaluate(`document.querySelectorAll('[data-search-results] a').length > 12 && document.activeElement === document.querySelectorAll('[data-search-results] a')[12]`));
    }
    await browser.dispatchKey('Escape', { code: 'Escape' });
    check('escape-closes-and-restores-focus', await browser.evaluate(`!document.querySelector('[data-search-dialog]').open && document.activeElement === document.querySelector('[data-search-open]') && document.querySelector('[data-search-open]').getAttribute('aria-expanded') === 'false'`));
    if (extended) {
      await click('[data-search-open]');
      check('reopen-at-input', await browser.evaluate(`document.querySelector('[data-search-dialog]').scrollTop === 0 && document.activeElement === document.querySelector('[data-search-input]')`));
      await click('[data-search-close]');
      check('close-button-restores-focus', await browser.evaluate(`!document.querySelector('[data-search-dialog]').open && document.activeElement === document.querySelector('[data-search-open]')`));
    }
  } catch (error) {
    check('completed-without-error', false, String(error.message || error));
    await browser.dispatchKey('Escape', { code: 'Escape' }).catch(() => {});
  }
  return { status: checks.every((item) => item.passed) ? 'pass' : 'fail', extended, checks };
}

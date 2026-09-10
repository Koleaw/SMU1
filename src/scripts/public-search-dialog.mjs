const initSearchDialog = () => {
    const dialog = document.querySelector('[data-search-dialog]');
    const trigger = document.querySelector('[data-search-open]');
    if (!dialog || !trigger || dialog.dataset.bound) return;
    dialog.dataset.bound = 'true';
    // The fallback must also sit outside transformed page/header ancestors.
    document.body.append(dialog);
    const input = dialog.querySelector('[data-search-input]');
    const status = dialog.querySelector('[data-search-status]');
    const retry = dialog.querySelector('[data-search-retry]');
    let modulePromise = null;
    let loadAttempt = 0;
    let previousOverflow = '';
    let wasOpen = false;
    let inerted = [];
    const load = async () => {
      retry.hidden = true;
      status.textContent = 'Загружаем поиск…';
      try {
        const moduleUrl = new URL(dialog.dataset.searchModule, location.href);
        if (loadAttempt++) moduleUrl.searchParams.set('retry', String(loadAttempt));
        modulePromise ||= import(moduleUrl.href);
        const client = await modulePromise;
        client.initPublicSearch(dialog);
      } catch {
        modulePromise = null;
        status.textContent = 'Не удалось загрузить поиск. Проверьте соединение и попробуйте ещё раз.';
        retry.hidden = false;
      }
    };
    const close = (restoreFocus = true) => {
      if (!wasOpen) return;
      wasOpen = false;
      if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
      document.body.style.overflow = previousOverflow;
      inerted.forEach((element) => element.removeAttribute('inert'));
      inerted = [];
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus({ preventScroll: true });
    };
    trigger.hidden = false;
    trigger.addEventListener('click', () => {
      if (wasOpen) return;
      wasOpen = true;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
        inerted = Array.from(document.body.children).filter((el) => el instanceof HTMLElement && el !== dialog && !el.hasAttribute('inert'));
        inerted.forEach((element) => element.setAttribute('inert', ''));
      }
      dialog.scrollTop = 0;
      trigger.setAttribute('aria-expanded', 'true');
      input.focus({ preventScroll: true });
      if (!dialog.dataset.searchReady) load();
    });
    retry.addEventListener('click', () => { if (!dialog.dataset.searchReady) load(); });
    dialog.querySelector('[data-search-close]').addEventListener('click', () => close());
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll('a[href], button, input, summary')).filter((item) => item.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    dialog.querySelector('form').addEventListener('submit', (event) => event.preventDefault());
    window.addEventListener('pagehide', () => close(false));
    document.addEventListener('v2:prepare-bfcache', () => close(false));
  };
  initSearchDialog();
  document.addEventListener('astro:page-load', initSearchDialog);

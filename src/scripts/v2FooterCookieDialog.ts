const initHomeV2CookieDialog = () => {
    const dialog = document.querySelector<HTMLDialogElement>('[data-hv2-cookie-dialog]');
    const openButton = document.querySelector<HTMLButtonElement>('[data-hv2-cookie-open]');
    const closeButton = document.querySelector<HTMLButtonElement>('[data-hv2-cookie-close]');
    if (!dialog || !openButton || !closeButton || dialog.dataset.ready === 'true') return;
    dialog.dataset.ready = 'true';

    openButton.addEventListener('click', () => {
      dialog.showModal();
      closeButton.focus();
    });
    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => openButton.focus());
  };

  initHomeV2CookieDialog();
  document.addEventListener('astro:page-load', initHomeV2CookieDialog);

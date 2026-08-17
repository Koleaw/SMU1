import { element, focusWithoutScroll } from './dom.mjs';
import { icon } from './icons.mjs';

export function createNotifications({ toastRegion, liveRegion }) {
  let serial = 0;

  function announce(message) {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    requestAnimationFrame(() => { liveRegion.textContent = String(message); });
  }

  function toast(message, { type = 'info', duration = 5200, action = null } = {}) {
    const id = `admin-toast-${++serial}`;
    const close = element('button', {
      className: 'admin-btn admin-btn--quiet admin-btn--icon admin-btn--small',
      attrs: { type: 'button', 'aria-label': 'Закрыть уведомление' },
      on: { click: () => node.remove() }
    }, [icon('close')]);
    const body = element('div', {}, [element('p', { text: message })]);
    if (action?.label && typeof action.handler === 'function') {
      body.append(element('button', {
        className: 'admin-btn admin-btn--quiet admin-btn--small',
        text: action.label,
        attrs: { type: 'button' },
        on: { click: action.handler }
      }));
    }
    const node = element('div', {
      className: `admin-toast admin-toast--${type}`,
      attrs: { id, role: type === 'error' ? 'alert' : 'status' }
    }, [icon(type === 'error' ? 'error' : type === 'success' ? 'check' : 'info'), body, close]);
    toastRegion?.append(node);
    announce(message);
    if (duration > 0) setTimeout(() => node.remove(), duration);
    return node;
  }

  function openDialog(dialog, { initialFocus = null, returnFocus = document.activeElement } = {}) {
    if (!(dialog instanceof HTMLDialogElement)) throw new TypeError('Expected an HTMLDialogElement.');
    dialog.dataset.returnFocusId = '';
    dialog.showModal();
    const focusTarget = initialFocus ?? dialog.querySelector('[autofocus], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    requestAnimationFrame(() => focusWithoutScroll(focusTarget));
    const restore = () => {
      dialog.removeEventListener('close', restore);
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) focusWithoutScroll(returnFocus);
    };
    dialog.addEventListener('close', restore);
  }

  return Object.freeze({ announce, toast, openDialog });
}

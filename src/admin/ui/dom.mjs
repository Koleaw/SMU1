export function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const {
    className,
    text,
    attrs = {},
    dataset = {},
    on = {},
    ...properties
  } = options;
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const [name, value] of Object.entries(dataset)) {
    if (value !== undefined && value !== null) node.dataset[name] = String(value);
  }
  for (const [name, handler] of Object.entries(on)) node.addEventListener(name, handler);
  for (const [name, value] of Object.entries(properties)) {
    if (value !== undefined) node[name] = value;
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  const values = Array.isArray(children) ? children : [children];
  for (const child of values.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function required(root, selector) {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`Admin UI element is missing: ${selector}`);
  return node;
}

export function debounce(callback, delay = 180) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
  debounced.flush = (...args) => {
    clearTimeout(timer);
    timer = null;
    return callback(...args);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

export function focusWithoutScroll(node) {
  if (!(node instanceof HTMLElement)) return;
  try { node.focus({ preventScroll: true }); }
  catch { node.focus(); }
}

export function formatHumanTime(value, now = Date.now()) {
  if (!value) return 'время не указано';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return String(value);
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return 'только что';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} мин. назад`;
  const date = new Date(timestamp);
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `сегодня, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function safeExternalOpen(url) {
  const target = window.open(url, '_blank', 'noopener,noreferrer');
  if (target) target.opener = null;
}

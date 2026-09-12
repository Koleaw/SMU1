const controllers = new WeakMap();
const BINDING = '__smu1AcceptanceNativeEvent';
const OBSERVER = '__smu1AcceptanceNativeTrace';

// Serialized into each same-origin document; it never cancels or dispatches UI events.
export function observeNativeClicks(origin, bindingName, observerName) {
  if (location.origin !== origin || window[observerName]) return;
  const ids = new WeakMap();
  let nextId = 0;
  const documentId = `${performance.timeOrigin}:${Math.random().toString(36).slice(2)}`;
  let expected = null;
  let lastReady = null;
  let lastGeometry = null;
  let pressed = null;
  let previousSnapshot = '';
  const nodeInfo = (node) => {
    if (!(node instanceof Element)) return null;
    if (!ids.has(node)) ids.set(node, ++nextId);
    const bound = node.closest('[data-binding-id],[data-smu1-binding-id]');
    return { generation: ids.get(node), connected: node.isConnected, tag: node.tagName,
      id: node.id || '', bindingId: bound?.getAttribute('data-binding-id') || bound?.getAttribute('data-smu1-binding-id') || '',
      controlKey: bound?.getAttribute('data-control-key') || '' };
  };
  const expectedSnapshot = () => {
    if (window !== window.top) {
      try { return window.top[observerName]?.snapshot() || null; } catch { return null; }
    }
    if (!expected) return null;
    const selector = `#veOverlay [data-binding-id="${CSS.escape(expected.bindingId)}"][data-control-key="${CSS.escape(expected.controlKey)}"]`;
    const definition = lastReady?.definitions?.find(value => value?.bindingId === expected.bindingId);
    const geometry = lastGeometry?.rows?.find(value => value.bindingId === expected.bindingId);
    return { ...expected, node: nodeInfo(document.querySelector(selector)),
      lastReportedGeometry: geometry ? { revision: lastGeometry.revision, sequence: lastGeometry.sequence, rect: geometry.rect } : null,
      lastReady: lastReady ? { revision: lastReady.revision, sequence: lastReady.sequence,
        inBindings: lastReady.bindingIds?.includes(expected.bindingId) ?? null,
        inDefinitions: lastReady.definitions?.some(value => value?.bindingId === expected.bindingId) ?? null,
        definition: definition ? { ownerCollection: definition.ownerCollection || definition.owner?.collection,
          recordSlug: definition.recordSlug || definition.owner?.slug, fieldPath: definition.fieldPath,
          role: definition.role, tool: definition.tool, route: definition.route,
          rendererVersion: definition.renderer?.version, currentDraftRevision: definition.currentDraftRevision } : null } : null,
      mediaDialogOpen: Boolean(document.querySelector('#veMediaDialog')?.open) };
  };
  const emit = (type, details = {}) => {
    const frame = window === window.top ? document.querySelector('#veFrame') : window.frameElement;
    let revision = null;
    try { revision = new URL(frame?.src || location.href, location.href).searchParams.get('editorRevision'); } catch {}
    const payload = { type, documentId, pathname: location.pathname, topDocument: window === window.top,
      documentTime: performance.timeOrigin + performance.now(), frameRevision: revision,
      expected: expectedSnapshot(), focus: nodeInfo(document.activeElement),
      documentHasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
      visibilityState: document.visibilityState ?? null, ...details };
    window[bindingName](JSON.stringify(payload));
  };
  window[observerName] = {
    snapshot: expectedSnapshot,
    setExpected(value) { expected = value; previousSnapshot = ''; emit('expected-binding'); }
  };
  for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'mousemove', 'mousedown', 'mouseup', 'click']) {
    document.addEventListener(type, (event) => {
      if (type === 'pointerdown') pressed = event.target;
      const target = nodeInfo(event.target);
      const x = Number.isFinite(event.clientX) ? event.clientX : null;
      const y = Number.isFinite(event.clientY) ? event.clientY : null;
      emit(type, { trusted: event.isTrusted, pointerId: event.pointerId ?? null, buttons: event.buttons,
        x, y, target,
        pressed: nodeInfo(pressed), samePressedTarget: Boolean(pressed && (event.target === pressed || pressed.contains?.(event.target))) });
    }, { capture: true, passive: true });
  }
  if (window === window.top) {
    new MutationObserver(() => {
      if (!expected) return;
      const snapshot = { expected: expectedSnapshot(), pressed: nodeInfo(pressed) };
      const key = JSON.stringify(snapshot);
      if (key === previousSnapshot) return;
      previousSnapshot = key;
      emit('overlay-mutation', snapshot);
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open'] });
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (event.origin !== origin || event.source !== document.querySelector('#veFrame')?.contentWindow
        || data?.protocol !== 'smu1-editor-bridge' || !['ready', 'geometry', 'select', 'navigate', 'navigation'].includes(data.type)) return;
      if (Array.isArray(data.bindings)) lastGeometry = { revision: data.revision, sequence: data.sequence,
        rows: data.bindings.map(value => ({ bindingId: value?.binding?.bindingId || value?.bindingId,
          rect: value?.rect ? { left: value.rect.left, top: value.rect.top, right: value.rect.right,
            bottom: value.rect.bottom, width: value.rect.width, height: value.rect.height } : null })) };
      if (data.type === 'ready') lastReady = { revision: data.revision, sequence: data.sequence,
        bindingIds: Array.isArray(data.bindings) ? data.bindings.map(value => value?.binding?.bindingId || value?.bindingId) : null,
        definitions: Array.isArray(data.bindingDefinitions) ? data.bindingDefinitions : null };
      const id = expected?.bindingId;
      const contains = (values) => Array.isArray(values) ? values.some(value => (value?.binding?.bindingId || value?.bindingId) === id) : null;
      emit('bridge-message', { bridgeType: data.type, revision: data.revision, bridgeSequence: data.sequence,
        selectedBindingId: data.binding?.bindingId || '', expectedInBindings: id ? contains(data.bindings) : null,
        expectedInDefinitions: id ? contains(data.bindingDefinitions) : null });
    }, { passive: true });
  }
  emit('observer-ready');
}

export function decodeNativeClickEvent(payload) {
  try {
    const value = JSON.parse(payload);
    return value && typeof value.type === 'string' && typeof value.documentId === 'string'
      && typeof value.pathname === 'string' && Number.isFinite(value.documentTime) ? value : null;
  } catch { return null; }
}

export async function installNativeClickTelemetry(browser, origin, record) {
  let active = false;
  let attempt = 0;
  let lastExpected = null;
  let activeExpected = null;
  browser.on('Runtime.bindingCalled', (event) => {
    if (event.name !== BINDING) return;
    const value = decodeNativeClickEvent(event.payload);
    if (!value) return;
    if (value.topDocument && value.expected) lastExpected = value.expected;
    record({ ...value, executionContextId: event.executionContextId, bindingAttemptActive: active });
  });
  await browser.send('Runtime.addBinding', { name: BINDING });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${observeNativeClicks.toString()})(${JSON.stringify(origin)},${JSON.stringify(BINDING)},${JSON.stringify(OBSERVER)})`
  });
  const dispatch = browser.dispatchClick.bind(browser);
  browser.dispatchClick = (point) => {
    // No extra CDP call in the readiness -> move -> press gap. This is the last
    // observer snapshot received, not a new assertion of live DOM readiness.
    if (active) {
      if (lastExpected?.attempt !== activeExpected?.attempt || lastExpected?.bindingId !== activeExpected?.bindingId) throw Error('Native click observer did not acknowledge the binding');
      record({ type: 'dispatch-ready', point: { ...point }, lastObservedExpectedAtDispatch: lastExpected, bindingAttemptActive: true });
    }
    return dispatch(point);
  };
  controllers.set(browser, {
    begin(bindingId, controlKey) {
      active = true;
      activeExpected = { bindingId, controlKey, attempt: ++attempt };
      return activeExpected;
    },
    end() { active = false; }
  });
}

function controller(browser) {
  const value = controllers.get(browser);
  if (!value) throw Error('Native click telemetry is not installed');
  return value;
}
export const beginNativeClickTrace = (browser, bindingId, controlKey) => controller(browser).begin(bindingId, controlKey);
export const endNativeClickTrace = (browser) => controller(browser).end();

export const nativeClickTraceBeginExpression = (expected) => `const observer=window[${JSON.stringify(OBSERVER)}]; if(!observer) throw Error('Native click observer is missing'); observer.setExpected(${JSON.stringify(expected)})`;

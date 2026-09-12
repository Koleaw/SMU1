import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { observeNativeClicks, decodeNativeClickEvent, installNativeClickTelemetry,
  beginNativeClickTrace, endNativeClickTrace, nativeClickTraceBeginExpression } from './native-click-telemetry.mjs';

const origin = 'http://127.0.0.1:9999';
function documentFixture(emit, generation = 1) {
  class Element {
    constructor(bindingId = 'gallery') { this.bindingId = bindingId; this.isConnected = true; this.tagName = 'BUTTON'; this.id = ''; }
    closest() { return this; }
    getAttribute(name) { return name === 'data-binding-id' ? this.bindingId : name === 'data-control-key' ? 'target' : ''; }
    getBoundingClientRect() { throw Error('Observer forced layout'); }
    contains(node) { return this === node; }
  }
  let target = new Element();
  const listeners = new Map(), windowListeners = new Map(), mutations = [];
  const frameWindow = {};
  const frame = { src: `${origin}/product/?editorRevision=11`, contentWindow: frameWindow };
  const document = {
    activeElement: target, hasFocus: () => true, visibilityState: 'visible',
    querySelector: (selector) => selector === '#veFrame' ? frame : selector === '#veMediaDialog' ? { open: false } : target,
    elementFromPoint: () => { throw Error('Observer forced hit test'); },
    addEventListener(type, callback, options) {
      assert.equal(options.capture, true); assert.equal(options.passive, true); listeners.set(type, callback);
    }
  };
  const window = { addEventListener: (type, callback) => windowListeners.set(type, callback) }; window.top = window;
  const context = vm.createContext({ window, document, Element, location: { origin, pathname: '/admin/', href: `${origin}/admin/` },
    CSS: { escape: (value) => value }, URL, performance: { timeOrigin: generation * 1000, now: () => 10 },
    MutationObserver: class { constructor(callback) { mutations.push(callback); } observe() {} } });
  return { context, window,
    bind(name) { window[name] = emit; },
    fire(type) { listeners.get(type)({ target, isTrusted: true, pointerId: 1, buttons: type.includes('up') ? 0 : 1,
      clientX: 20, clientY: 30, preventDefault() { throw Error('Observer cancelled native event'); } }); },
    replace() { target.isConnected = false; target = new Element(); mutations.forEach(callback => callback()); },
    bridge(data) { windowListeners.get('message')({ origin, source: frameWindow, data: { protocol: 'smu1-editor-bridge', ...data } }); }
  };
}

test('observer records real target identity/detachment without cancelling or dispatching events', () => {
  const events = [], doc = documentFixture(value => events.push(JSON.parse(value)));
  doc.bind('capture'); vm.runInContext(`(${observeNativeClicks.toString()})(${JSON.stringify(origin)},'capture','observer')`, doc.context);
  doc.window.observer.setExpected({ bindingId: 'gallery', controlKey: 'target', attempt: 1 });
  doc.fire('pointerdown'); doc.replace(); doc.fire('pointerup'); doc.fire('click');
  const down = events.find(value => value.type === 'pointerdown');
  const mutation = events.find(value => value.type === 'overlay-mutation');
  const click = events.find(value => value.type === 'click');
  assert.equal(down.trusted, true); assert.equal(down.pressed.connected, true);
  assert.equal(mutation.pressed.connected, false);
  assert.notEqual(click.target.generation, down.target.generation);
  assert.equal(click.samePressedTarget, false);
  assert.equal(click.frameRevision, '11');
  assert.equal(click.documentHasFocus, true);
  assert.equal(click.visibilityState, 'visible');
});

test('bridge trace includes expected registry presence without copying content or nonce', () => {
  const events = [], doc = documentFixture(value => events.push(JSON.parse(value)));
  doc.bind('capture'); vm.runInContext(`(${observeNativeClicks.toString()})(${JSON.stringify(origin)},'capture','observer')`, doc.context);
  doc.window.observer.setExpected({ bindingId: 'gallery', controlKey: 'target', attempt: 1 });
  doc.bridge({ type: 'ready', revision: 11, sequence: 4, nonce: 'PRIVATE_NONCE',
    bindings: [{ binding: { bindingId: 'gallery' }, rect: { left: 10, top: 20, width: 220, height: 50 } }], bindingDefinitions: [{ bindingId: 'other', content: 'PRIVATE_CONTENT' }] });
  const event = events.find(value => value.type === 'bridge-message');
  assert.equal(event.expectedInBindings, true); assert.equal(event.expectedInDefinitions, false);
  assert.equal(event.revision, 11); assert.equal(event.bridgeSequence, 4);
  assert.equal(event.expected.lastReportedGeometry.rect.width, 220);
  assert.equal(event.expected.lastReportedGeometry.sequence, 4);
  assert.equal(event.expected.node.rect, undefined);
  assert.equal(JSON.stringify(event).includes('PRIVATE_'), false);
});

class Browser {
  handlers = new Map(); calls = []; generation = 0;
  on(name, callback) { this.handlers.set(name, callback); }
  async send(name, value) {
    this.calls.push(name);
    if (name === 'Runtime.addBinding') this.binding = value.name;
    if (name === 'Page.addScriptToEvaluateOnNewDocument') { this.source = value.source; this.reload(); }
  }
  reload() {
    const contextId = ++this.generation;
    this.doc = documentFixture(payload => this.handlers.get('Runtime.bindingCalled')({ name: this.binding, payload, executionContextId: contextId }), contextId);
    this.doc.bind(this.binding); vm.runInContext(this.source, this.doc.context);
  }
  async evaluate(source) { this.calls.push('Runtime.evaluate'); return vm.runInContext(source, this.doc.context); }
  async dispatchClick(point) { this.calls.push('native-dispatch'); this.doc.fire('pointerdown'); this.doc.fire('pointerup'); this.doc.fire('click'); return point; }
}

test('Node transport survives reload and does not insert a roundtrip at dispatch', async () => {
  const events = [], browser = new Browser();
  await installNativeClickTelemetry(browser, origin, value => events.push(value));
  for (let index = 0; index < 2; index++) {
    if (index) browser.reload();
    const beforeBegin = browser.calls.length;
    const expected = beginNativeClickTrace(browser, 'gallery', 'target');
    assert.equal(browser.calls.length, beforeBegin);
    await browser.evaluate(`(() => { ${nativeClickTraceBeginExpression(expected)}; return true; })()`);
    const beforeDispatch = browser.calls.length;
    await browser.dispatchClick({ x: 20, y: 30 }); endNativeClickTrace(browser);
    assert.deepEqual(browser.calls.slice(beforeDispatch), ['native-dispatch']);
  }
  assert.equal(events.filter(value => value.type === 'dispatch-ready').length, 2);
  assert.equal(new Set(events.filter(value => value.type === 'observer-ready').map(value => value.documentId)).size, 2);
  assert.equal(events.filter(value => value.type === 'click').length, 2);
});

test('missing acknowledgment fails before any click instead of silently accepting absent telemetry', async () => {
  const browser = new Browser(); await installNativeClickTelemetry(browser, origin, () => {});
  beginNativeClickTrace(browser, 'gallery', 'target');
  assert.throws(() => browser.dispatchClick({ x: 20, y: 30 }), /did not acknowledge/);
  assert.equal(browser.calls.includes('native-dispatch'), false);
});

test('malformed telemetry and invalid timestamps are rejected', () => {
  assert.equal(decodeNativeClickEvent('{'), null);
  assert.equal(decodeNativeClickEvent(JSON.stringify({ type: 'click', documentId: 'd', pathname: '/', documentTime: null })), null);
});

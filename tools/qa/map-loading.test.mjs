import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../src/components/v2/practical/V2YandexMap.astro', import.meta.url), 'utf8');
const scriptSource = source.match(/<script is:inline>([\s\S]*?)<\/script>/u)[1];

// Exercise the shipped initializer against controlled provider events. Network
// errors, a inserted-but-never-loaded frame and retries must be deterministic.
function fixture({ intersectionObserver = true } = {}) {
  const eventNode = () => {
    const listeners = new Map();
    return {
      hidden: false, disabled: false, isConnected: true, textContent: '', attributes: {},
      addEventListener(type, callback) { (listeners.get(type) || listeners.set(type, []).get(type)).push(callback); },
      emit(type) { for (const callback of listeners.get(type) || []) callback(); },
      setAttribute(name, value) { this.attributes[name] = value; if (name === 'hidden') this.hidden = true; },
      getAttribute(name) { return name === 'src' ? this.src : this.attributes[name]; },
      removeAttribute(name) { delete this.attributes[name]; if (name === 'hidden') this.hidden = false; },
      remove() { this.isConnected = false; },
      focus() { throw new Error('Map loading must not take focus.'); }
    };
  };
  const activate = eventNode(); activate.hidden = true;
  const placeholder = eventNode(); placeholder.hidden = true;
  const status = eventNode(); const message = eventNode();
  const frames = []; const scripts = []; const timers = new Map(); const windowListeners = new Map();
  let onMutation; let onProximity; let timeoutIndex = 0; let top = 1800;
  const map = {
    dataset: { v2MapTitle: 'Яндекс Карта: Курган', v2MapConstructor: 'https://api-maps.yandex.ru/services/constructor/1.0/js/?um=fixture&scroll=true' },
    querySelector(selector) { return ({ '[data-v2-map-activate]': activate, '[data-v2-map-placeholder]': placeholder, '[data-v2-map-status]': status, '[data-v2-map-message]': message })[selector]; },
    querySelectorAll() { return frames.filter(frame => frame.isConnected); },
    append(script) { scripts.push(script); },
    getBoundingClientRect() { return { top, bottom: top + 410 }; }
  };
  const window = {
    innerHeight: 844,
    setTimeout(callback) { timers.set(++timeoutIndex, callback); return timeoutIndex; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, callback) { windowListeners.set(type, callback); },
    removeEventListener(type) { windowListeners.delete(type); }
  };
  const Observer = class {
    constructor(callback) { onProximity = callback; }
    observe() {}
    disconnect() {}
  };
  if (intersectionObserver) window.IntersectionObserver = Observer;
  runInNewContext(scriptSource, {
    document: { querySelectorAll: () => [map], createElement: eventNode }, window, URL,
    IntersectionObserver: Observer,
    MutationObserver: class { constructor(callback) { onMutation = callback; } observe() {} disconnect() {} }
  });
  return {
    map, activate, placeholder, status, scripts, timers,
    approach() { top = 700; if (intersectionObserver) onProximity([{ isIntersecting: true }]); else windowListeners.get('scroll')(); },
    insertFrame() { const frame = eventNode(); frame.src = 'https://yandex.ru/map-widget/v1/?um=fixture'; frames.push(frame); onMutation(); return frame; },
    expire() { for (const callback of [...timers.values()]) callback(); }
  };
}

test('map defers offscreen, does not become ready on iframe insertion, and completes on document load without focus', () => {
  const f = fixture();
  assert.equal(f.map.dataset.v2MapState, 'idle');
  assert.equal(f.scripts.length, 0);
  assert.equal(f.activate.hidden, true);
  f.approach();
  assert.equal(f.map.dataset.v2MapState, 'loading');
  assert.equal(new URL(f.scripts[0].src).searchParams.get('scroll'), 'false');
  const frame = f.insertFrame();
  assert.equal(f.map.dataset.v2MapState, 'loading');
  assert.equal(f.placeholder.hidden, false);
  assert.equal(f.timers.size, 1);
  frame.emit('load');
  assert.equal(f.map.dataset.v2MapState, 'ready');
  assert.equal(f.placeholder.hidden, true);
  assert.equal(frame.attributes.title, 'Яндекс Карта: Курган');
  assert.equal(frame.attributes.tabindex, '0');
  assert.equal(f.timers.size, 0);
  f.approach();
  assert.equal(f.scripts.length, 1);
});

for (const failure of ['constructor-error', 'frame-error', 'frame-timeout']) {
  test(`map ${failure} preserves retry and retries with a fresh provider frame`, () => {
    const f = fixture(); f.approach();
    const failedFrame = failure !== 'constructor-error' ? f.insertFrame() : null;
    if (failure === 'constructor-error') f.scripts[0].emit('error');
    else if (failure === 'frame-error') failedFrame.emit('error');
    else f.expire();
    assert.equal(f.map.dataset.v2MapState, 'error');
    assert.equal(f.placeholder.hidden, false);
    assert.equal(f.activate.hidden, false);
    assert.equal(f.activate.disabled, false);
    assert.equal(f.map.querySelectorAll('iframe').length, 0);
    f.activate.emit('click');
    assert.equal(f.map.dataset.v2MapState, 'loading');
    failedFrame?.emit('load');
    failedFrame?.emit('error');
    assert.equal(f.map.dataset.v2MapState, 'loading');
    f.insertFrame().emit('load');
    assert.equal(f.map.dataset.v2MapState, 'ready');
    assert.equal(f.scripts.length, 2);
  });
}

test('map keeps proximity loading when IntersectionObserver is unavailable', () => {
  const f = fixture({ intersectionObserver: false });
  assert.equal(f.scripts.length, 0);
  f.approach();
  assert.equal(f.scripts.length, 1);
  f.insertFrame().emit('load');
  assert.equal(f.map.dataset.v2MapState, 'ready');
});

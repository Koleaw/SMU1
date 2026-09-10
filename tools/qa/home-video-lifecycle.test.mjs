import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../../src/scripts/homeFinalVideo.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { initializeHomeFinalVideo } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

// Exercise the actual lifecycle without requiring a visible optional menu.
const fixture = ({ reduced = false, saveData = false, reject = false, controls = 0 } = {}) => {
  const saved = new Map(['window', 'document', 'navigator', 'matchMedia', 'innerHeight', 'IntersectionObserver']
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const timers = new Set();
  const win = new EventTarget();
  Object.assign(win, {
    setTimeout(callback, milliseconds) {
      const id = setTimeout(callback, milliseconds); timers.add(id); return id;
    },
    clearTimeout(id) { clearTimeout(id); timers.delete(id); }
  });
  const doc = Object.assign(new EventTarget(), { hidden: false, documentElement: { dataset: {} } });
  const hero = { dataset: {}, classList: { toggle() {} }, getBoundingClientRect: () => ({ top: 0, bottom: 768 }) };
  const toggles = Array.from({ length: controls }, () => Object.assign(new EventTarget(), {
    hidden: true, disabled: false, attributes: {}, label: { textContent: '' },
    querySelector() { return this.label; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  }));
  const video = Object.assign(new EventTarget(), {
    dataset: { hfDesktopSrc: '/hero.mp4', hfMobileSrc: '/hero-mobile.mp4' },
    paused: true, src: '', playCalls: 0, canPlayType: () => 'probably', load() {},
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); },
    play() {
      this.playCalls += 1;
      if (reject) return Promise.reject(new DOMException('Autoplay denied', 'NotAllowedError'));
      this.paused = false; this.dispatchEvent(new Event('playing')); return Promise.resolve();
    }
  });
  let visibility;
  class VisibilityObserver {
    constructor(callback) { visibility = callback; }
    observe() {}
  }
  win.IntersectionObserver = VisibilityObserver;
  const values = {
    window: win, document: doc, navigator: { connection: { saveData } }, innerHeight: 768,
    matchMedia: (query) => Object.assign(new EventTarget(), { matches: query.includes('prefers-reduced-motion') && reduced }),
    IntersectionObserver: VisibilityObserver
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const root = {
    querySelector: (selector) => selector === '[data-hf-hero]' ? hero : selector === '[data-hf-hero-video]' ? video : null,
    querySelectorAll: () => toggles, closest: () => null
  };
  initializeHomeFinalVideo(root);
  return {
    hero, video, toggles, document: doc, setVisible: (isIntersecting) => visibility([{ isIntersecting }]),
    cleanup() {
      timers.forEach(clearTimeout);
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  };
};

test('home video initializes without optional controls and pauses outside the first screen', () => {
  const page = fixture();
  try {
    assert.equal(page.video.paused, false);
    assert.equal(page.hero.dataset.hfVideoState, 'playing');
    page.setVisible(false);
    assert.equal(page.video.paused, true);
    page.setVisible(true);
    assert.equal(page.video.paused, false);
    page.document.hidden = true;
    page.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(page.video.paused, true);
    page.document.hidden = false;
    page.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(page.video.paused, false);
  } finally { page.cleanup(); }
});

for (const profile of [{ reduced: true }, { saveData: true }]) {
  test(`home video preserves the poster and makes no playback request: ${JSON.stringify(profile)}`, () => {
    const page = fixture(profile);
    try {
      assert.equal(page.video.src, '');
      assert.equal(page.video.playCalls, 0);
      page.setVisible(false); page.setVisible(true);
      assert.equal(page.video.playCalls, 0);
    } finally { page.cleanup(); }
  });
}

test('autoplay denial returns to the poster without requiring a retry control', async () => {
  const page = fixture({ reject: true });
  try {
    await Promise.resolve();
    assert.equal(page.video.paused, true);
    assert.equal(page.hero.dataset.hfVideoState, 'idle');
    assert.equal(page.video.playCalls, 1);
  } finally { page.cleanup(); }
});

test('desktop and compact menu controls share user intent across viewport changes', () => {
  const page = fixture({ controls: 2 });
  try {
    assert.ok(page.toggles.every((toggle) => toggle.label.textContent === 'Пауза видео'));
    page.toggles[0].dispatchEvent(new Event('click'));
    assert.equal(page.video.paused, true);
    assert.ok(page.toggles.every((toggle) => toggle.label.textContent === 'Включить видео'));
    page.setVisible(false); page.setVisible(true);
    assert.equal(page.video.paused, true, 'leaving and returning must preserve a manual pause');
    page.toggles[1].dispatchEvent(new Event('click'));
    assert.equal(page.video.paused, false);
    assert.ok(page.toggles.every((toggle) => toggle.attributes['aria-pressed'] === 'true'));
  } finally { page.cleanup(); }
});

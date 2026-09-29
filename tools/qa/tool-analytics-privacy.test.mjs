import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { inputField } from '../../src/tools/core/view.mjs';
import { printDocument } from '../../src/tools/core/print.mjs';
import * as maf from '../../src/tools/adapters/maf.mjs';

const layout = await readFile(new URL('../../src/layouts/PublicV2Layout.astro', import.meta.url), 'utf8');
const marker = layout.indexOf("const stateKey = '__smu1MetrikaState'");
assert.ok(marker > 0, 'existing deferred production analytics script is present');
const start = layout.lastIndexOf('(() => {', marker);
const script = layout.slice(start, layout.indexOf('})();', marker) + 5);

function analytics({ url, referrer = '', base = '/SMU1/', beforeLoad } = {}) {
  const calls = [], timers = [], events = new Map(), inserted = [];
  const location = { href: url, origin: new URL(url).origin };
  const window = { ym: (...args) => calls.push(args), setTimeout: callback => (timers.push(callback), timers.length) };
  const document = {
    readyState: 'complete', referrer, scripts: [],
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: element => inserted.push(element) } }],
    addEventListener: (name, listener) => events.set(name, listener)
  };
  runInNewContext(script, { window, document, location, URL, metrikaCounterId: 1,
    metrikaScriptSrc: 'https://mc.yandex.ru/metrika/tag.js', metrikaInit: { webvisor: true, clickmap: true },
    metrikaBasePath: base, metrikaDelayMs: 7000 });
  assert.equal(calls.length, 0, 'initialization remains deferred');
  assert.equal(timers.length, 1);
  if (beforeLoad) location.href = beforeLoad;
  timers[0]();
  events.get('astro:page-load')();
  assert.equal(calls.length, 1, 'SPA lifecycle does not create duplicate counters or implicit unsanitized hits');
  assert.equal(inserted.length, 1);
  assert.equal(calls[0][1], 'init');
  return calls[0][2];
}

test('production analytics strip query and hash for tools on both supported bases', () => {
  for (const base of ['/', '/SMU1/']) {
    for (const path of ['instrumenty/', 'instrumenty/metal/', 'instrumenty/maf/']) {
      const clean = `https://example.test${base}${path}`;
      const config = analytics({ url: `${clean}?price=private#project=private-id`,
        referrer: 'https://koleaw.github.io/SMU1/instrumenty/zdanie/?address=private#project=another', base });
      assert.equal(config.url, clean);
      assert.equal(config.referrer, 'https://koleaw.github.io/SMU1/instrumenty/zdanie/');
      assert.equal(config.webvisor, false);
      assert.equal(config.clickmap, true);
    }
  }
});

test('analytics retain unrelated route parameters and mask a tool referrer', () => {
  const url = 'https://example.test/SMU1/ulichnaya-mebel/?campaign=autumn#products';
  const config = analytics({ url, referrer: 'https://example.test/instrumenty/metal/?mass=secret#project=secret' });
  assert.equal(config.url, url);
  assert.equal(config.referrer, 'https://example.test/instrumenty/metal/');
  assert.equal(config.webvisor, true);
  for (const path of ['/SMU1/instrumenty-other/', '/other/instrumenty/']) {
    const unrelated = `https://example.test${path}?q=kept#anchor`;
    assert.equal(analytics({ url: unrelated }).url, unrelated);
  }
  assert.equal(analytics({ url }).referrer, '');
});

test('deferred analytics use current route after client navigation', () => {
  const config = analytics({ url: 'https://example.test/SMU1/',
    beforeLoad: 'https://example.test/SMU1/instrumenty/fundament/?dimensions=secret#project=private' });
  assert.equal(config.url, 'https://example.test/SMU1/instrumenty/fundament/');
  assert.equal(config.webvisor, false);
});

test('generated text, numeric, textarea and MAF search fields explicitly block key recording', () => {
  for (const options of [{}, { type: 'text' }, { type: 'textarea' }, { type: 'checkbox' }]) {
    const html = inputField({ value: '<private & data>' }, { path: 'value', label: 'Поле', ...options });
    assert.match(html, /<(?:input|textarea)\b[^>]*class="ym-disable-keys"/);
    assert.ok(!html.includes('<private & data>'), 'input remains safely escaped');
  }
  const html = maf.form(maf.example, { dataset: { base: '/SMU1/' } });
  const controls = html.match(/<(?:input|textarea)\b[^>]*>/g) || [];
  assert.ok(controls.some(tag => tag.includes('data-maf-search')));
  assert.ok(controls.every(tag => tag.includes('class="ym-disable-keys"')));
});

test('calculator wrapper protects results and saved project names on an already recorded session', async () => {
  const source = await readFile(new URL('../../src/components/tools/ToolPage.astro', import.meta.url), 'utf8');
  assert.match(source, /<section class="tool-app ym-hide-content"[^>]*data-tool-app/);
  assert.match(source, /<input class="ym-disable-keys" data-project-name/);
  const app = await readFile(new URL('../../src/tools/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /area\.className='ym-disable-keys'/, 'manual clipboard fallback is protected too');
});

test('actual print builder masks private document before insertion and uses escaped configured contacts', async () => {
  const originalDocument = globalThis.document, originalWindow = globalThis.window;
  const doc = { className: '', innerHTML: '', querySelectorAll: () => [] };
  let inserted = false, printed = false;
  globalThis.document = { querySelector: () => null, createElement: () => doc,
    body: { append: element => { assert.ok(element.className.split(' ').includes('ym-hide-content')); inserted = true; } } };
  globalThis.window = { print: () => { assert.ok(inserted); printed = true; } };
  try {
    await printDocument({ current: { name: 'Частный объект', methodologyVersion: '1.0.0', referenceVersions: {}, input: {} },
      result: { summary: [], columns: [], rows: [] }, content: { title: 'Ведомость', limitations: [], methodology: [], sources: [], contact: { phone: '+7 <123>', email: 'safe&test@example.test' } },
      adapter: { diagram: () => '<svg></svg>', printInputs: () => '<p>Адрес заказчика</p>' }, root: {} });
    assert.equal(printed, true);
    assert.ok(doc.innerHTML.includes('Адрес заказчика'));
    assert.ok(doc.innerHTML.includes('+7 &lt;123&gt;'));
    assert.ok(doc.innerHTML.includes('safe&amp;test@example.test'));
  } finally { globalThis.document = originalDocument; globalThis.window = originalWindow; }
});

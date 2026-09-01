import assert from 'node:assert/strict';

import { CdpBrowser } from './cdp-browser.mjs';

const rawOrigin = process.argv.find((argument) => argument.startsWith('--origin='))?.slice('--origin='.length)
  || process.env.SMU1_EDITOR_CANVAS_ORIGIN
  || '';
const origin = new URL(rawOrigin);
if (!['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname)) {
  throw new Error('--origin must name an already running loopback Astro editor-canvas server.');
}

const sessionNonce = '01234567-89ab-4cde-8fab-0123456789ab';
const routes = [
  { path: '/ulichnaya-mebel/besedki-i-pergoly/besedka-kub/', variant: 'premium' },
  { path: '/ulichnaya-mebel/shezlongi/shezlong-siluet/', variant: 'standard' }
];

const canvasUrl = (pathname) => {
  const url = new URL(pathname, origin);
  url.searchParams.set('__smu1_editor', '1');
  url.searchParams.set('editorSession', sessionNonce);
  url.searchParams.set('editorRevision', '1');
  return url.href;
};

const browser = await new CdpBrowser({ safetyMode: 'public-read-only' }).start();
const runtimeFailures = [];
browser.on('Runtime.exceptionThrown', ({ exceptionDetails }) => runtimeFailures.push(
  exceptionDetails?.exception?.description || exceptionDetails?.text || 'Unknown runtime exception'
));

const projectionExpression = ({ sequence, items }) => `(async () => {
  const wrapper = [...document.querySelectorAll('[data-smu1-binding]')].find((node) => {
    try { return JSON.parse(node.getAttribute('data-smu1-binding') || 'null')?.fieldPath === 'dimensions'; }
    catch { return false; }
  });
  if (!wrapper) throw new Error('Product dimensions binding is absent.');
  const binding = JSON.parse(wrapper.getAttribute('data-smu1-binding'));
  window.postMessage({
    protocol: 'smu1-editor-bridge', version: 1,
    nonce: ${JSON.stringify(sessionNonce)}, revision: 1, sequence: ${sequence}, type: 'projection',
    projections: [{ bindingId: binding.bindingId, value: {
      __smu1ListProjection: true,
      items: ${JSON.stringify(items)},
      itemKind: 'object', itemFields: binding.itemFields,
      projectionTarget: binding.projection.target
    } }]
  }, location.origin);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const panel = binding.renderer.variant === 'standard'
    ? wrapper.closest('.v2-technical-panel--specs')
    : wrapper;
  return {
    variant: binding.renderer.variant,
    projectionTarget: binding.projection.target,
    panelHidden: panel?.hidden === true,
    heading: wrapper.querySelector(':scope > h3')?.textContent?.trim() || '',
    pairIds: [...wrapper.querySelectorAll(':scope > dl > [data-smu1-list-item]')]
      .map((node) => node.getAttribute('data-smu1-list-item')),
    pairCopy: [...wrapper.querySelectorAll(':scope > dl > [data-smu1-list-item]')]
      .map((node) => [
        node.querySelector('[data-smu1-list-field="label"]')?.textContent?.trim(),
        node.querySelector('[data-smu1-list-field="value"]')?.textContent?.trim()
      ]),
    textRows: [...wrapper.querySelectorAll(':scope > ul > [data-smu1-list-item], :scope > p[data-smu1-list-item]')]
      .map((node) => ({
        id: node.getAttribute('data-smu1-list-item'),
        field: node.getAttribute('data-smu1-list-field'),
        line: node.getAttribute('data-smu1-list-line'),
        text: node.textContent?.trim()
      })),
    allItemIds: [...wrapper.querySelectorAll('[data-smu1-list-item]')]
      .map((node) => node.getAttribute('data-smu1-list-item'))
  };
})()`;

const mediaProjectionExpression = ({ sequence, items }) => `(async () => {
  const wrapper = [...document.querySelectorAll('[data-smu1-binding]')].find((node) => {
    try {
      const binding = JSON.parse(node.getAttribute('data-smu1-binding') || 'null');
      return binding?.tool === 'list' && binding?.itemKind === 'object'
        && binding?.fieldPath === 'pageBlocks[0].items';
    } catch { return false; }
  });
  if (!wrapper) throw new Error('Topiary card-list binding is absent.');
  const binding = JSON.parse(wrapper.getAttribute('data-smu1-binding'));
  window.postMessage({
    protocol: 'smu1-editor-bridge', version: 1,
    nonce: ${JSON.stringify(sessionNonce)}, revision: 1, sequence: ${sequence}, type: 'projection',
    projections: [{ bindingId: binding.bindingId, value: {
      __smu1ListProjection: true,
      items: ${JSON.stringify(items)},
      itemKind: 'object', itemFields: binding.itemFields,
      projectionTarget: binding.projection?.target || ''
    } }]
  }, location.origin);
  await new Promise((resolve) => setTimeout(resolve, 40));
  return {
    mediaRole: binding.itemFields.find((field) => field.fieldPath === 'image')?.role || '',
    items: [...wrapper.children].filter((node) => node.hasAttribute('data-smu1-list-item')).map((node) => {
      const host = node.querySelector('[data-smu1-list-media-host]');
      const image = node.querySelector('[data-smu1-list-field="image"]');
      return {
        id: node.getAttribute('data-smu1-list-item'),
        title: node.querySelector('[data-smu1-list-field="title"]')?.textContent?.trim(),
        mediaHidden: host?.hidden === true,
        imageSource: image?.getAttribute('src') || ''
      };
    })
  };
})()`;

const evidence = [];
try {
  await browser.setViewport({ width: 1440, height: 900 });
  for (const route of routes) {
    await browser.navigate(canvasUrl(route.path));
    const first = await browser.evaluate(projectionExpression({
      sequence: 0,
      items: [
        { id: 'spec-a', label: 'Высота', value: '2400 мм', order: 20, isActive: true },
        { id: 'spec-b', label: 'Размеры и характеристики', value: 'Первая строка\nВторая строка', order: 10, isActive: true },
        { id: 'spec-c', label: 'Ширина', value: '1200 мм', order: 5, isActive: true },
        { id: 'spec-hidden', label: 'Скрыто', value: 'Не показывать', order: 0, isActive: false }
      ]
    }));
    assert.equal(first.variant, route.variant);
    assert.equal(first.projectionTarget, 'product-specifications');
    assert.equal(first.panelHidden, false);
    assert.deepEqual(first.pairIds, ['spec-c', 'spec-a']);
    assert.deepEqual(first.pairCopy, [['Ширина', '1200 мм'], ['Высота', '2400 мм']]);
    assert.deepEqual(first.textRows.map(({ id, field, line, text }) => ({ id, field, line, text })), [
      { id: 'spec-b', field: 'value', line: '0', text: 'Первая строка' },
      { id: 'spec-b', field: 'value', line: '1', text: 'Вторая строка' }
    ]);
    assert.equal(first.allItemIds.includes('spec-hidden'), false);

    const second = await browser.evaluate(projectionExpression({
      sequence: 1,
      items: [{
        id: 'spec-a', label: 'Размеры и характеристики', value: 'Одна строка', order: 10, isActive: true
      }]
    }));
    assert.deepEqual(second.pairIds, []);
    assert.deepEqual(second.textRows, [{ id: 'spec-a', field: 'value', line: '0', text: 'Одна строка' }]);
    assert.deepEqual([...new Set(second.allItemIds)], ['spec-a']);
    if (route.variant === 'premium') assert.ok(second.heading, 'Premium specifications heading must survive projection.');

    const third = await browser.evaluate(projectionExpression({
      sequence: 2,
      items: [{ id: 'spec-a', label: 'Высота', value: '2400 мм', order: 10, isActive: false }]
    }));
    assert.equal(third.panelHidden, true);
    assert.deepEqual(third.allItemIds, []);
    evidence.push({ route: route.path, variant: route.variant, first, second, third });
  }
  await browser.navigate(canvasUrl('/topiarii/'));
  const mediaSource = '/uploads/chatgpt-image-5-2026-21-56-34-1783277823870.png';
  const mediaFirst = await browser.evaluate(mediaProjectionExpression({
    sequence: 0,
    items: [
      { id: 'topiary-geometric-shapes', title: 'Геометрия', text: 'Новая первая карточка', image: { src: mediaSource }, order: 10, isActive: true },
      { id: 'topiary-animal-figures', title: 'Без фотографии', text: 'Источник очищен', image: null, order: 20, isActive: true },
      { id: 'topiary-new-card', title: 'Новая карточка', text: 'Добавлена в draft', image: { src: mediaSource }, order: 30, isActive: true }
    ]
  }));
  assert.equal(mediaFirst.mediaRole, 'card');
  assert.deepEqual(mediaFirst.items.map((item) => item.id), [
    'topiary-geometric-shapes', 'topiary-animal-figures', 'topiary-new-card'
  ]);
  assert.equal(mediaFirst.items[0].mediaHidden, false);
  assert.equal(mediaFirst.items[0].imageSource.endsWith(mediaSource), true);
  assert.equal(mediaFirst.items[1].mediaHidden, true);
  assert.equal(mediaFirst.items[1].imageSource, '');
  assert.equal(mediaFirst.items[2].mediaHidden, false);
  assert.equal(mediaFirst.items[2].imageSource.endsWith(mediaSource), true);
  const mediaSecond = await browser.evaluate(mediaProjectionExpression({
    sequence: 1,
    items: [
      { id: 'topiary-new-card', title: 'Теперь первая', text: 'Порядок изменён', image: null, order: 10, isActive: true },
      { id: 'topiary-geometric-shapes', title: 'Теперь вторая', text: 'Фото сохранено', image: { src: mediaSource }, order: 20, isActive: true }
    ]
  }));
  assert.deepEqual(mediaSecond.items.map((item) => item.id), ['topiary-new-card', 'topiary-geometric-shapes']);
  assert.equal(mediaSecond.items[0].mediaHidden, true);
  assert.equal(mediaSecond.items[0].imageSource, '');
  assert.equal(mediaSecond.items[1].mediaHidden, false);
  evidence.push({ route: '/topiarii/', variant: 'structured-media', first: mediaFirst, second: mediaSecond });
  assert.deepEqual(runtimeFailures, []);
  process.stdout.write(`${JSON.stringify({ ok: true, routes: evidence, runtimeFailures }, null, 2)}\n`);
} finally {
  await browser.close();
}

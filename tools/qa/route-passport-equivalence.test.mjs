import assert from 'node:assert/strict';
import test from 'node:test';
import { comparableBusinessText, compareStableGeometry } from './route-passport-equivalence.mjs';

test('equivalence excludes only explicitly classified runtime surfaces', () => {
  const snapshot = {
    businessOccurrences: [
      { text: 'Основной заголовок', runtimeSurface: '' },
      { text: 'К основному содержанию', runtimeSurface: 'entry-skip-link' },
      { text: 'Cookies', runtimeSurface: 'cookie-banner' },
      { text: 'Скрытый, но стабильный business text', runtimeSurface: '' }
    ]
  };
  assert.deepEqual(comparableBusinessText(snapshot), ['Основной заголовок', 'Скрытый, но стабильный business text']);
});

test('stable geometry ignores total document/runtime overlays but fails closed on content geometry', () => {
  const publicGeometry = {
    header: { tag: 'header', id: '', width: 1440, height: 80 },
    main: { tag: 'main', id: 'main-content', width: 1440, height: 2400 },
    footer: { tag: 'footer', id: '', width: 1440, height: 420 }
  };
  const withinPixel = structuredClone(publicGeometry);
  withinPixel.main.height = 2400.8;
  assert.deepEqual(compareStableGeometry(publicGeometry, withinPixel), []);

  const widthOnlyFrame = {
    'main-frame': { tag: 'main', id: 'main-content', dimensions: ['width'], width: 1440, height: 6400 }
  };
  const runtimeHeightDifference = structuredClone(widthOnlyFrame);
  runtimeHeightDifference['main-frame'].height = 6500;
  assert.deepEqual(compareStableGeometry(widthOnlyFrame, runtimeHeightDifference), []);

  const layoutRegression = structuredClone(publicGeometry);
  layoutRegression.main.height = 2420;
  assert.match(compareStableGeometry(publicGeometry, layoutRegression).join('\n'), /main:height/u);

  const missingLandmark = structuredClone(publicGeometry);
  delete missingLandmark.footer;
  assert.match(compareStableGeometry(publicGeometry, missingLandmark).join('\n'), /targets:/u);
});

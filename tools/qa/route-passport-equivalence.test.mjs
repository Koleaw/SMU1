import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindingFieldPathExists,
  comparableBusinessText,
  comparableMedia,
  compareMediaSnapshots,
  compareStableGeometry,
  isDirectMediaBindingTool
} from './route-passport-equivalence.mjs';

test('equivalence excludes only explicitly classified runtime surfaces', () => {
  const snapshot = {
    businessOccurrences: [
      { text: 'Основной заголовок', runtimeSurface: '' },
      { text: 'К основному содержанию', runtimeSurface: 'entry-skip-link' },
      { text: 'Cookies', runtimeSurface: 'cookie-banner' },
      { text: 'Добавить фотографии', runtimeSurface: 'editor-affordance' },
      { text: 'Скрытый, но стабильный business text', runtimeSurface: '' }
    ]
  };
  assert.deepEqual(comparableBusinessText(snapshot), ['Основной заголовок', 'Скрытый, но стабильный business text']);
});

test('stable geometry ignores total document/runtime overlays but fails closed on content geometry', () => {
  const publicGeometry = {
    header: { tag: 'header', id: '', width: 1440, height: 80, visualWidth: 1440, visualHeight: 80 },
    main: { tag: 'main', id: 'main-content', width: 1440, height: 2400, visualWidth: 1440, visualHeight: 2400 },
    footer: { tag: 'footer', id: '', width: 1440, height: 420, visualWidth: 1440, visualHeight: 420 }
  };
  const withinPixel = structuredClone(publicGeometry);
  withinPixel.main.height = 2400.8;
  assert.deepEqual(compareStableGeometry(publicGeometry, withinPixel), []);

  const widthOnlyFrame = {
    'main-frame': { tag: 'main', id: 'main-content', dimensions: ['width'], width: 1440, height: 6400, visualWidth: 1440, visualHeight: 6400 }
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

  const editorScaled = structuredClone(publicGeometry);
  editorScaled.main.visualWidth = 1296;
  editorScaled.main.visualHeight = 2160;
  const scalingIssues = compareStableGeometry(publicGeometry, editorScaled).join('\n');
  assert.match(scalingIssues, /main:visualWidth:1440->1296/u);
  assert.match(scalingIssues, /main:visualHeight:2400->2160/u);

  const ignoredVisualHeight = structuredClone(widthOnlyFrame);
  ignoredVisualHeight['main-frame'].visualHeight = 5000;
  assert.deepEqual(compareStableGeometry(widthOnlyFrame, ignoredVisualHeight), []);
});

test('binding validation traverses the exact nested path or accepts only its exact normalized schema path', () => {
  const record = {
    presentation: {
      publicGallery: ['/assets/one.jpg'],
      mediaRoles: { cover: 'one' }
    },
    gallery: [{ src: '/assets/two.jpg' }],
    wrongGalleryShape: { caption: 'not an array' }
  };
  assert.equal(bindingFieldPathExists(record, 'presentation.publicGallery[0]', []), true);
  assert.equal(bindingFieldPathExists(record, 'gallery[0].src', []), true);
  assert.equal(bindingFieldPathExists(record, 'gallery[0].caption', ['gallery[].caption']), true);
  assert.equal(bindingFieldPathExists(record, 'gallery[3].caption', ['gallery[].caption']), false);
  assert.equal(bindingFieldPathExists(record, 'wrongGalleryShape[0].caption', ['wrongGalleryShape[].caption']), false);
  assert.equal(bindingFieldPathExists(record, 'presentation.optional.value', ['presentation.optional.value']), true);
  assert.equal(bindingFieldPathExists(record, 'presentation.mediaRole.cover', ['presentation']), false);
  assert.equal(bindingFieldPathExists(record, 'presentation.publicGallery[zero]', ['presentation.publicGallery[]']), false);
  assert.equal(bindingFieldPathExists(record, 'presentation..publicGallery', ['presentation.publicGallery']), false);
});

test('generic list/relation tools cannot claim direct media-editor coverage', () => {
  for (const tool of ['crop', 'gallery', 'media', 'video']) assert.equal(isDirectMediaBindingTool(tool), true);
  for (const tool of ['image', 'list', 'relation', 'relation-list', 'relation-select', 'reorder-item']) assert.equal(isDirectMediaBindingTool(tool), false);
});

test('media equivalence normalizes only local deploy origins and preserves video, query, external and background identity', () => {
  const localOrigins = [
    { origin: 'http://127.0.0.1:4100', basePath: '/SMU1' },
    { origin: 'http://127.0.0.1:4200', basePath: '/' }
  ];
  const publicSnapshot = {
    location: 'http://127.0.0.1:4100/SMU1/projects/example/',
    media: [
      { tag: 'video', src: '/SMU1/assets/hero.mp4?quality=source', currentSrc: '/SMU1/assets/hero.mp4?quality=source', poster: '/SMU1/assets/poster.jpg?v=2' },
      { tag: 'img', src: 'https://cdn.example.test/photo.jpg?fit=cover', currentSrc: 'https://cdn.example.test/photo.jpg?fit=cover', srcset: 'https://cdn.example.test/photo.jpg?width=640 640w' }
    ],
    backgroundMedia: [
      { background: 'linear-gradient(#0000, #0008), url("http://127.0.0.1:4100/SMU1/assets/background.webp?rev=7")' }
    ]
  };
  const editorSnapshot = {
    location: 'http://127.0.0.1:4200/projects/example/?__smu1_editor=1',
    media: [
      { tag: 'video', src: '/assets/hero.mp4?quality=source', currentSrc: '/assets/hero.mp4?quality=source', poster: '/assets/poster.jpg?v=2' },
      { tag: 'img', src: 'https://cdn.example.test/photo.jpg?fit=cover', currentSrc: 'https://cdn.example.test/photo.jpg?fit=cover', srcset: 'https://cdn.example.test/photo.jpg?width=640 640w' }
    ],
    backgroundMedia: [
      { background: 'linear-gradient(#0000, #0008), url("http://127.0.0.1:4200/assets/background.webp?rev=7")' }
    ]
  };

  const normalized = comparableMedia(publicSnapshot, { localOrigins });
  assert.equal(normalized[0].src, '/assets/hero.mp4?quality=source');
  assert.equal(normalized[1].src, 'https://cdn.example.test/photo.jpg?fit=cover');
  assert.deepEqual(normalized.at(-1), { tag: 'background', sources: ['/assets/background.webp?rev=7'] });
  assert.equal(compareMediaSnapshots(publicSnapshot, editorSnapshot, { localOrigins }).match, true);

  const changedQuery = structuredClone(editorSnapshot);
  changedQuery.media[0].src = '/assets/hero.mp4?quality=optimized';
  assert.equal(compareMediaSnapshots(publicSnapshot, changedQuery, { localOrigins }).match, false);

  const changedExternalOrigin = structuredClone(editorSnapshot);
  changedExternalOrigin.media[1].src = 'https://images.example.test/photo.jpg?fit=cover';
  assert.equal(compareMediaSnapshots(publicSnapshot, changedExternalOrigin, { localOrigins }).match, false);

  const changedBackground = structuredClone(editorSnapshot);
  changedBackground.backgroundMedia[0].background = 'url("/assets/other.webp?rev=7")';
  assert.equal(compareMediaSnapshots(publicSnapshot, changedBackground, { localOrigins }).match, false);
});

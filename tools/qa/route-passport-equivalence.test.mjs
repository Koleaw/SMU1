import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindingFieldPathExists,
  comparableBusinessText,
  comparableMedia,
  compareMediaSnapshots,
  compareStableGeometry,
  isDirectMediaBindingTool,
  runtimeMediaSelectionIssues
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

test('media equivalence compares declarations and validates currentSrc without racing lazy selection', () => {
  const localOrigins = [
    { origin: 'http://127.0.0.1:4100', basePath: '/SMU1' },
    { origin: 'http://127.0.0.1:4200', basePath: '/' }
  ];
  const declared = {
    tag: 'img',
    mediaGroup: 'example-picture',
    mediaAttribute: 'srcset',
    sizes: '(min-width: 900px) 50vw, 100vw',
    mimeType: 'image/avif',
    src: '/SMU1/_media/h5/example-w1024.jpg',
    srcset: '/SMU1/_media/h5/example-w480.avif 480w, /SMU1/_media/h5/example-w1024.avif 1024w',
    currentSrc: '',
    loading: 'lazy',
    visible: false
  };
  const publicSnapshot = {
    location: 'http://127.0.0.1:4100/SMU1/example/',
    media: [declared],
    backgroundMedia: []
  };
  const editorSnapshot = {
    location: 'http://127.0.0.1:4200/example/?__smu1_editor=1',
    media: [{
      ...declared,
      src: '/_media/h5/example-w1024.jpg',
      srcset: '/_media/h5/example-w480.avif 480w, /_media/h5/example-w1024.avif 1024w',
      currentSrc: 'http://127.0.0.1:4200/_media/h5/example-w480.avif'
    }],
    backgroundMedia: []
  };
  assert.equal(compareMediaSnapshots(publicSnapshot, editorSnapshot, { localOrigins }).match, true);
  assert.deepEqual(runtimeMediaSelectionIssues(editorSnapshot, { localOrigins }), []);

  const undeclaredSelection = structuredClone(editorSnapshot);
  undeclaredSelection.media[0].currentSrc = '/uploads/original-not-declared.jpg';
  const undeclaredResult = compareMediaSnapshots(publicSnapshot, undeclaredSelection, { localOrigins });
  assert.equal(undeclaredResult.match, false);
  assert.equal(runtimeMediaSelectionIssues(undeclaredSelection, { localOrigins }).length, 1);
  assert.deepEqual(undeclaredResult.diff.selectionIssues, {
    public: [],
    editor: runtimeMediaSelectionIssues(undeclaredSelection, { localOrigins })
  });
});

test('media declarations preserve group topology plus sizes, media attribute and MIME type', () => {
  const localOrigins = [
    { origin: 'http://127.0.0.1:4100', basePath: '/SMU1' },
    { origin: 'http://127.0.0.1:4200', basePath: '/' }
  ];
  const publicSnapshot = {
    location: 'http://127.0.0.1:4100/SMU1/example/',
    media: [{
      tag: 'source', mediaGroup: 'hero-picture', mediaAttribute: '(max-width: 699px)',
      sizes: '100vw', mimeType: 'image/avif', srcset: '/SMU1/_media/hero-640.avif 640w'
    }]
  };
  const editorSnapshot = {
    location: 'http://127.0.0.1:4200/example/?__smu1_editor=1',
    media: [{
      ...publicSnapshot.media[0],
      srcset: '/_media/hero-640.avif 640w'
    }]
  };
  assert.equal(compareMediaSnapshots(publicSnapshot, editorSnapshot, { localOrigins }).match, true);

  for (const [field, replacement] of [
    ['sizes', '50vw'],
    ['mediaAttribute', '(min-width: 700px)'],
    ['mimeType', 'image/webp']
  ]) {
    const changed = structuredClone(editorSnapshot);
    changed.media[0][field] = replacement;
    assert.equal(compareMediaSnapshots(publicSnapshot, changed, { localOrigins }).match, false, field);
  }
});

test('cross-snapshot media groups compare by topology, not generated group labels', () => {
  const localOrigins = [
    { origin: 'http://127.0.0.1:4100', basePath: '/SMU1' },
    { origin: 'http://127.0.0.1:4200', basePath: '/' }
  ];
  const publicSnapshot = {
    location: 'http://127.0.0.1:4100/SMU1/example/',
    media: [{ tag: 'img', mediaGroup: '4', src: '/SMU1/_media/logo.svg', currentSrc: '/SMU1/_media/logo.svg' }]
  };
  const editorSnapshot = {
    location: 'http://127.0.0.1:4200/example/?__smu1_editor=1',
    media: [{ tag: 'img', mediaGroup: '11', src: '/_media/logo.svg', currentSrc: '/_media/logo.svg' }]
  };
  assert.equal(compareMediaSnapshots(publicSnapshot, editorSnapshot, { localOrigins }).match, true);

  const publicPicture = {
    location: publicSnapshot.location,
    media: [
      { tag: 'source', mediaGroup: '4', mediaAttribute: '(max-width: 699px)', srcset: '/SMU1/_media/logo-mobile.avif 640w' },
      { tag: 'img', mediaGroup: '4', src: '/SMU1/_media/logo.jpg', currentSrc: '/SMU1/_media/logo.jpg' }
    ]
  };
  const editorPicture = {
    location: editorSnapshot.location,
    media: [
      { tag: 'source', mediaGroup: '11', mediaAttribute: '(max-width: 699px)', srcset: '/_media/logo-mobile.avif 640w' },
      { tag: 'img', mediaGroup: '11', src: '/_media/logo.jpg', currentSrc: '/_media/logo.jpg' }
    ]
  };
  assert.equal(compareMediaSnapshots(publicPicture, editorPicture, { localOrigins }).match, true);

  const splitPicture = structuredClone(editorPicture);
  splitPicture.media[1].mediaGroup = '12';
  assert.equal(compareMediaSnapshots(publicPicture, splitPicture, { localOrigins }).match, false);

  const separatePublicPicture = structuredClone(publicPicture);
  separatePublicPicture.media[1].mediaGroup = '5';
  assert.equal(compareMediaSnapshots(separatePublicPicture, editorPicture, { localOrigins }).match, false);
});

test('currentSrc is validated within its media group and cannot swap candidates between images', () => {
  const localOrigins = [
    { origin: 'http://127.0.0.1:4100', basePath: '/SMU1' },
    { origin: 'http://127.0.0.1:4200', basePath: '/' }
  ];
  const publicSnapshot = {
    location: 'http://127.0.0.1:4100/SMU1/example/',
    media: [
      { tag: 'img', mediaGroup: 'hero', src: '/SMU1/_media/hero.jpg', srcset: '/SMU1/_media/hero-640.avif 640w', currentSrc: '/SMU1/_media/hero-640.avif' },
      { tag: 'img', mediaGroup: 'gallery-1', src: '/SMU1/_media/gallery.jpg', srcset: '/SMU1/_media/gallery-640.avif 640w', currentSrc: '/SMU1/_media/gallery-640.avif' }
    ]
  };
  const editorSnapshot = {
    location: 'http://127.0.0.1:4200/example/?__smu1_editor=1',
    media: [
      { ...publicSnapshot.media[0], src: '/_media/hero.jpg', srcset: '/_media/hero-640.avif 640w', currentSrc: '/_media/gallery-640.avif' },
      { ...publicSnapshot.media[1], src: '/_media/gallery.jpg', srcset: '/_media/gallery-640.avif 640w', currentSrc: '/_media/hero-640.avif' }
    ]
  };
  const result = compareMediaSnapshots(publicSnapshot, editorSnapshot, { localOrigins });
  assert.equal(result.match, false);
  assert.equal(result.editorSelectionIssues.length, 2);
  assert.deepEqual(result.editorSelectionIssues.map((issue) => issue.mediaGroup), ['hero', 'gallery-1']);
});

test('currentSrc comparison rejects a visible settled image that is empty on one side', () => {
  const localOrigins = [
    { origin: 'http://127.0.0.1:4100', basePath: '/SMU1' },
    { origin: 'http://127.0.0.1:4200', basePath: '/' }
  ];
  const publicSnapshot = {
    location: 'http://127.0.0.1:4100/SMU1/example/',
    media: [{
      tag: 'img', mediaGroup: 'hero', src: '/SMU1/_media/hero.jpg',
      srcset: '/SMU1/_media/hero-640.avif 640w, /SMU1/_media/hero-1280.avif 1280w',
      currentSrc: '/SMU1/_media/hero-640.avif', loading: 'lazy', visible: true, complete: true
    }]
  };
  const selectedDifferent = {
    location: 'http://127.0.0.1:4200/example/?__smu1_editor=1',
    media: [{
      ...publicSnapshot.media[0], src: '/_media/hero.jpg',
      srcset: '/_media/hero-640.avif 640w, /_media/hero-1280.avif 1280w',
      currentSrc: '/_media/hero-1280.avif'
    }]
  };
  const differentResult = compareMediaSnapshots(publicSnapshot, selectedDifferent, { localOrigins });
  assert.equal(differentResult.match, false);
  assert.equal(differentResult.publicSelectionIssues.length, 0);
  assert.equal(differentResult.editorSelectionIssues.length, 0);
  assert.equal(differentResult.selectionDifferences.length, 1);
  assert.deepEqual(differentResult.diff.declarationDifferences, {
    publicOnly: [], editorOnly: [], orderOnly: true
  });
  assert.equal(differentResult.diff.selectionDifferences.length, 1);
  assert.deepEqual(differentResult.diff.selectionIssues, { public: [], editor: [] });

  const visibleButEmpty = structuredClone(selectedDifferent);
  visibleButEmpty.media[0].currentSrc = '';
  const visibleResult = compareMediaSnapshots(publicSnapshot, visibleButEmpty, { localOrigins });
  assert.equal(visibleResult.match, false);
  assert.equal(visibleResult.selectionDifferences[0].kind, 'unexpected-empty-current-src');
  assert.equal(visibleResult.selectionDifferences[0].emptySide, 'editor');

  const editorOnlyOffscreen = structuredClone(visibleButEmpty);
  editorOnlyOffscreen.media[0].visible = false;
  const crossVisibilityResult = compareMediaSnapshots(publicSnapshot, editorOnlyOffscreen, { localOrigins });
  assert.equal(crossVisibilityResult.match, false);
  assert.equal(crossVisibilityResult.selectionDifferences[0].kind, 'unexpected-empty-current-src');

  const publicOffscreenLazy = structuredClone(publicSnapshot);
  const editorOffscreenLazy = structuredClone(visibleButEmpty);
  publicOffscreenLazy.media[0].visible = false;
  editorOffscreenLazy.media[0].visible = false;
  const lazyResult = compareMediaSnapshots(publicOffscreenLazy, editorOffscreenLazy, { localOrigins });
  assert.equal(lazyResult.match, true);
  assert.equal(lazyResult.selectionDifferences.length, 0);

  const sourcePublic = {
    location: publicSnapshot.location,
    media: [{ tag: 'source', mediaGroup: 'picture', srcset: '/SMU1/_media/hero-640.avif 640w', currentSrc: '' }]
  };
  const sourceEditor = {
    location: selectedDifferent.location,
    media: [{ tag: 'source', mediaGroup: 'picture', srcset: '/_media/hero-640.avif 640w', currentSrc: '/_media/hero-640.avif' }]
  };
  assert.equal(compareMediaSnapshots(sourcePublic, sourceEditor, { localOrigins }).match, true);
});

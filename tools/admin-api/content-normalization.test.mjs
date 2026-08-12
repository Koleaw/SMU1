import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeStructuredGalleryForView } from '../../src/admin/core/content-normalization.mjs';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

test('structured category gallery view normalization is pure and lossless', () => {
  const gallery = deepFreeze([
    '/uploads/legacy-string.jpg',
    {
      src: '/uploads/structured.jpg',
      alt: 'Фасад изделия',
      caption: 'Монтаж на объекте',
      legacyPresentation: {
        focalPoint: { x: 0.25, y: 0.75 },
        badges: ['archive', 'do-not-strip']
      }
    }
  ]);
  const snapshot = structuredClone(gallery);

  const normalized = normalizeStructuredGalleryForView(gallery);

  assert.deepEqual(gallery, snapshot, 'opening/rendering the editor mutated its draft');
  assert.deepEqual(normalized, snapshot, 'view normalization changed strings, metadata, or passthrough fields');
  assert.notStrictEqual(normalized, gallery, 'the helper must return an isolated array');
  assert.equal(normalized[0], gallery[0], 'legacy string entries must remain strings');
  assert.notStrictEqual(normalized[1], gallery[1], 'structured entries must not share object identity');
  assert.notStrictEqual(normalized[1].legacyPresentation, gallery[1].legacyPresentation, 'nested passthrough must be cloned');
  assert.notStrictEqual(normalized[1].legacyPresentation.focalPoint, gallery[1].legacyPresentation.focalPoint, 'deep nested state must be cloned');

  normalized[1].alt = 'Изменённый alt только для view';
  normalized[1].legacyPresentation.focalPoint.x = 0.9;
  assert.deepEqual(gallery, snapshot, 'mutating the normalized view leaked into the draft');
});

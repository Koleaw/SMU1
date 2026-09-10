import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGalleryViewport } from './gallery-viewport-contract.mjs';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const fixture = () => ({ viewport: { width: 1366, height: 768 }, media: rect(30, 94, 1306, 644),
  picture: rect(30, 94, 1306, 644), image: rect(30, 94, 1306, 644), fit: 'contain', ready: true });

test('fullscreen contain requires picture and image to fit inside the visible media area', () => {
  const valid = fixture();
  assert.equal(evaluateGalleryViewport(valid).ok, true);
  const clipped = { ...valid, picture: rect(30, 94, 1306, 1741.33), image: rect(30, 94, 1306, 1741.33) };
  const result = evaluateGalleryViewport(clipped);
  assert.equal(result.ok, false, 'the observed implicit grid track overflow must fail even with object-fit:contain');
  assert.equal(result.completeImage, true);
  assert.equal(result.pictureInsideMedia, false);
  assert.equal(result.imageInsideMedia, false);
});

test('fullscreen rejects cropped, unavailable and off-screen images', () => {
  const valid = fixture();
  assert.equal(evaluateGalleryViewport({ ...valid, fit: 'cover' }).ok, false);
  assert.equal(evaluateGalleryViewport({ ...valid, ready: false }).ok, false);
  assert.equal(evaluateGalleryViewport({ ...valid, media: rect(30, 94, 1306, 900) }).ok, false);
  assert.equal(evaluateGalleryViewport({ ...valid, picture: rect(-20, 94, 1306, 644) }).ok, false);
  assert.equal(evaluateGalleryViewport(null).ok, false);
});

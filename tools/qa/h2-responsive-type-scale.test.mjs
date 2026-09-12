import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCustomOrderHeadingSize, resolveSplitHubHeadingSize } from '../migration/h2-responsive-type-scale.mjs';

test('split hub headings follow the accepted clamp including both ends and the 981px composition boundary', () => {
  assert.equal(resolveSplitHubHeadingSize('section-hub', 980, 61.74), 61.74);
  for (const [width, expected] of [
    [981, 46], [1082, 46], [1083, 46.0275],
    [1181, 50.1925], [1280, 54.4], [1440, 61.2],
    [1694, 71.995], [1695, 72], [1920, 72]
  ]) {
    assert.ok(Math.abs(resolveSplitHubHeadingSize('section-hub', width, 96) - expected) < 1e-9, `width ${width}`);
  }
});

test('split hub exception cannot change mobile headings or other route families', () => {
  for (const [width, existing] of [[320, 44], [390, 46.8], [760, 52], [768, 58]]) {
    assert.equal(resolveSplitHubHeadingSize('section-hub', width, existing), existing);
  }
  for (const routeKind of ['home', 'category', 'direction', 'company', 'custom-order', 'contacts', 'product-standard', 'product-premium', 'project-detail', 'career-detail', 'legal']) {
    for (const width of [320, 981, 1440, 1920]) {
      assert.equal(resolveSplitHubHeadingSize(routeKind, width, 88), 88, `${routeKind} at ${width}`);
    }
  }
});

test('custom-order narrow desktop scale ends exactly at its composition boundaries', () => {
  for (const [width, expected] of [[1101, 67.161], [1181, 72.041], [1280, 78.08], [1311, 79.971], [1312, 80], [1320, 80]]) {
    assert.ok(Math.abs(resolveCustomOrderHeadingSize('custom-order', width, 88) - expected) < 1e-9, `width ${width}`);
  }
  for (const [width, existing] of [[320, 44], [700, 52], [761, 46.421], [1100, 64], [1321, 88], [1920, 112]]) {
    assert.equal(resolveCustomOrderHeadingSize('custom-order', width, existing), existing);
  }
});

test('custom-order exception preserves hub and other families inside the narrow desktop range', () => {
  for (const routeKind of ['section-hub', 'home', 'category', 'direction', 'company', 'contacts', 'product-standard', 'product-premium', 'project-detail', 'career-detail', 'legal']) {
    for (const width of [700, 701, 760, 761, 1101, 1181, 1280, 1320]) {
      assert.equal(resolveCustomOrderHeadingSize(routeKind, width, 88), 88, `${routeKind} at ${width}`);
    }
  }
});

test('custom-order 701–760px heading measure matches the new CSS while preserving both adjacent ranges', () => {
  assert.equal(resolveCustomOrderHeadingSize('custom-order', 700, 52), 52);
  for (const [width, expected] of [[701, 46], [754, 46], [755, 46.055], [760, 46.36]]) {
    assert.ok(Math.abs(resolveCustomOrderHeadingSize('custom-order', width, 52) - expected) < 1e-9, `width ${width}`);
  }
  assert.equal(resolveCustomOrderHeadingSize('custom-order', 761, 46.421), 46.421);
});
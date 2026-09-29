import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateResponsiveTypeScale, resolveCustomOrderHeadingSize, resolveSplitHubHeadingSize, resolveToolTypeScale } from '../migration/h2-responsive-type-scale.mjs';

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

test('tool and archive contracts cover all six audited widths and exact compact-scale boundaries', () => {
  for (const [width, h1, cardHeading, lead] of [
    [320, 30, 21, 15], [390, 30, 21, 15], [800, 30, 21, 15], [801, 30, 24, 17],
    [909, 30, 24, 17], [910, 30.03, 24, 17], [1181, 38.973, 24, 17],
    [1280, 42.24, 24, 17], [1440, 47.52, 24, 17], [1484, 48.972, 24, 17],
    [1485, 49, 24, 17], [1920, 49, 24, 17]
  ]) {
    for (const kind of ['tool', 'tools-archive']) {
      const scale = resolveToolTypeScale(kind, width);
      assert.ok(Math.abs(scale.h1 - h1) < 1e-9, `${kind} H1 at ${width}`);
      assert.equal(scale.h2, kind === 'tool' ? 18 : cardHeading, `${kind} H2 at ${width}`);
      assert.equal(scale.lead, lead, `${kind} lead at ${width}`);
      assert.equal(scale.tolerance, .25);
      assert.deepEqual(scale.requiredRoles, ['h1', 'h2', 'lead']);
    }
  }
});

test('tool selectors measure the heading, data panel or archive card, and introduction', () => {
  assert.deepEqual(resolveToolTypeScale('tool', 390).selectors, {
    h1: '.tools-page .tool-heading h1',
    h2: '.tools-page .tool-input-panel > .tool-panel-title',
    lead: '.tools-page .tool-heading > p:last-child'
  });
  assert.equal(resolveToolTypeScale('tools-archive', 1440).selectors.h2, '.tools-page .tool-card > h2');
});

test('tools require all three text roles and reject incorrect measurements without relaxing tolerance', () => {
  for (const kind of ['tool', 'tools-archive']) {
    const scale = resolveToolTypeScale(kind, 390);
    const metrics = { h1: { fontSize: 30 }, h2: { fontSize: kind === 'tool' ? 18 : 21 }, lead: { fontSize: 15 } };
    assert.equal(evaluateResponsiveTypeScale(scale, metrics).ok, true);
    for (const role of ['h1', 'h2', 'lead']) {
      assert.equal(evaluateResponsiveTypeScale(scale, { ...metrics, [role]: null }).ok, false, `${kind} missing ${role}`);
      assert.equal(evaluateResponsiveTypeScale(scale, { ...metrics, [role]: { fontSize: metrics[role].fontSize + .25 } }).ok, true);
      assert.equal(evaluateResponsiveTypeScale(scale, { ...metrics, [role]: { fontSize: metrics[role].fontSize + .26 } }).ok, false);
      assert.equal(evaluateResponsiveTypeScale(scale, { ...metrics, [role]: { fontSize: NaN } }).ok, false);
    }
  }
});

test('tool scale cannot replace existing route contracts and existing optional roles retain their behavior', () => {
  for (const kind of ['home', 'section-hub', 'category', 'direction', 'company', 'custom-order', 'contacts',
    'projects-archive', 'careers-archive', 'not-found', 'product-standard', 'product-premium', 'project-detail', 'career-detail', 'legal']) {
    for (const width of [320, 390, 1181, 1280, 1440, 1920]) assert.equal(resolveToolTypeScale(kind, width), null);
  }
  const originalScale = { h1: 88, h2: 44, lead: 22, tolerance: .25 };
  assert.equal(evaluateResponsiveTypeScale(originalScale, { h1: { fontSize: 88 }, h2: null, lead: null }).ok, true);
  assert.equal(evaluateResponsiveTypeScale(originalScale, { h1: { fontSize: 88 }, h2: { fontSize: 43.74 } }).ok, false);
  assert.equal(evaluateResponsiveTypeScale(null, { h1: { fontSize: 88 } }).ok, false);
  assert.equal(evaluateResponsiveTypeScale(originalScale, { h1: null }).ok, false);
});

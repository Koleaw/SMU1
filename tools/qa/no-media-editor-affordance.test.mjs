import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('no-media product affordances are editor-only overlays instead of production layout children', async () => {
  const [layout, product, card, css] = await Promise.all([
    source('src/layouts/PublicV2Layout.astro'),
    source('src/components/v2/CatalogStandardProductV2.astro'),
    source('src/components/v2/V2ProductCard.astro'),
    source('src/admin/styles/editor-canvas-affordances.css')
  ]);

  assert.match(layout, /editor-canvas-affordances\.css\?raw/u);
  assert.match(layout, /isEditorCanvas && \(\s*<style is:inline set:html=\{editorCanvasAffordancesCss\}/u);
  assert.match(product, /'v2-product-top--editor-missing-media': images\.length === 0 && editorCanvas/u);
  assert.match(product, /v2-product-top__gallery--editor-affordance/u);
  assert.match(product, /data-smu1-editor-affordance=\{images\.length === 0 \? 'missing-product-media' : undefined\}/u);
  assert.match(card, /'v2-product-card--editor-missing-media': !cardImage && editorCanvas/u);
  assert.match(card, /v2-product-card__media--editor-affordance/u);
  assert.match(card, /data-smu1-editor-affordance=\{!cardImage \? 'missing-product-media' : undefined\}/u);
  assert.match(css, /\.v2-product-top__gallery--editor-affordance \{[\s\S]*?position: absolute !important;/u);
  assert.match(css, /\.v2-product-card__media--editor-affordance \{[\s\S]*?position: absolute !important;/u);
  assert.match(css, /\.v2-media-empty--editor-affordance \{[\s\S]*?display: grid !important;/u);
});

test('route passport classifies editor affordance copy as a runtime surface', async () => {
  const passport = await source('tools/qa/route-passport-browser.mjs');
  assert.match(passport, /closest\('\[data-smu1-editor-affordance\]'\)\) return 'editor-affordance'/u);
  assert.match(passport, /querySelectorAll\('\[data-smu1-editor-affordance\],\[data-v2-entry-skip-link\]/u);
});

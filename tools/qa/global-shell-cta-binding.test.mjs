import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

test('catalog shell CTA defaults are schema-owned and preserve the accepted labels', () => {
  const settings = readJson('src/content/site-settings/global.json');
  const layout = read('src/components/v2/CatalogV2Layout.astro');

  assert.equal(settings.shellLabels.defaultCtaLabel, 'Получить расчёт');
  assert.equal(settings.shellLabels.catalogRequestCtaLabel, 'Запросить расчёт');
  assert.match(layout, /pageKind === 'product'[\s\S]*?'shellLabels\.catalogRequestCtaLabel'[\s\S]*?'shellLabels\.defaultCtaLabel'/u);
  assert.match(layout, /settings\.shellLabels\.catalogRequestCtaLabel/u);
  assert.match(layout, /settings\.shellLabels\.defaultCtaLabel/u);
  assert.doesNotMatch(layout, /pageKind === 'product' \? 'Запросить расчёт' : 'Получить расчёт'/u);
});

test('every default shell CTA occurrence gets a distinct exact global binding', () => {
  const layout = read('src/components/v2/CatalogV2Layout.astro');

  assert.match(layout, /owner: \{ collection: 'site-settings', slug: 'global' \}/u);
  assert.match(layout, /fieldPath: defaultCtaFieldPath/u);
  assert.match(layout, /scope: 'global'/u);
  assert.match(layout, /affectedRoutes: \['\*'\]/u);
  for (const occurrence of ['header-desktop', 'header-mobile', 'footer-mobile']) {
    assert.match(layout, new RegExp(`globalCtaBinding\\('${occurrence}'\\)`, 'u'));
  }
  assert.match(layout, /desktopCtaBinding=\{headerCtaBinding\}/u);
  assert.match(layout, /mobileCtaBinding=\{headerMobileCtaBinding\}/u);
  assert.match(layout, /mobileCtaBinding=\{mobileCtaBinding\}/u);
});

test('Home direct header/footer calls use the same schema owner without a layout prop', () => {
  const header = read('src/components/v2/home-v2/HomeV2Header.astro');
  const footer = read('src/components/v2/home-v2/HomeV2Footer.astro');

  assert.match(header, /ctaLabel = settings\.shellLabels\.defaultCtaLabel/u);
  assert.match(footer, /mobileCtaLabel = settings\.shellLabels\.defaultCtaLabel/u);
  assert.match(header, /globalBinding\('shellLabels\.defaultCtaLabel', 'button-label', \{ stableItemId: 'home-header-desktop-cta'/u);
  assert.match(header, /globalBinding\('shellLabels\.defaultCtaLabel', 'button-label', \{ stableItemId: 'home-header-mobile-cta'/u);
  assert.match(footer, /globalBinding\('shellLabels\.defaultCtaLabel', 'button-label', \{ stableItemId: 'home-footer-mobile-cta'/u);
  assert.doesNotMatch(`${header}\n${footer}`, /CtaLabel = 'Получить расчёт'/u);
});

test('repeated responsive shell labels keep distinct overlay occurrence ids', () => {
  const header = read('src/components/v2/home-v2/HomeV2Header.astro');
  const footer = read('src/components/v2/home-v2/HomeV2Footer.astro');

  for (const occurrence of ['header-desktop-products-group', 'header-mobile-products-group']) {
    assert.match(header, new RegExp(`stableItemId: '${occurrence}'`, 'u'), occurrence);
  }
  for (const occurrence of [
    'footer-desktop-directions-group',
    'footer-mobile-directions-group',
    'footer-desktop-company-group',
    'footer-mobile-company-group'
  ]) {
    assert.match(footer, new RegExp(`stableItemId: '${occurrence}'`, 'u'), occurrence);
  }
});

test('nested layouts preserve independently identified owner-specific CTA bindings', () => {
  for (const relativePath of [
    'src/components/v2/directions/DirectionV2Layout.astro',
    'src/components/v2/projects/V2ProjectsLayout.astro',
    'src/components/v2/practical/PracticalV2Layout.astro'
  ]) {
    const source = read(relativePath);
    assert.match(source, /headerCtaBinding\?: Record<string, string>/u, relativePath);
    assert.match(source, /headerMobileCtaBinding\?: Record<string, string>/u, relativePath);
    assert.match(source, /mobileCtaBinding\?: Record<string, string>/u, relativePath);
    assert.match(source, /headerCtaBinding=\{Astro\.props\.headerCtaBinding\}/u, relativePath);
    assert.match(source, /headerMobileCtaBinding=\{Astro\.props\.headerMobileCtaBinding\}/u, relativePath);
    assert.match(source, /mobileCtaBinding=\{Astro\.props\.mobileCtaBinding\}/u, relativePath);
  }
});

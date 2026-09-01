import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getFieldCoverage } from '../../src/admin/metadata/content-coverage-registry.mjs';
import { formatFocalPosition, parseFocalPosition } from '../../src/admin/editors/record-editor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));
const expectedProjects = [
  'blagoustroystvo-naberezhnoy-reki-tobol',
  'remont-skvera-na-ulitse-gogolya',
  'kompleks-rabot-na-proizvodstvennoy-territorii',
  'gorodskie-kacheli-dlya-obshchestvennyh-territoriy'
];

test('Home and Company gateways use an explicit ordered project relation with exact frame provenance', () => {
  const home = json('src/content/static-pages/home.json');
  const company = json('src/content/static-pages/about.json');
  const gateway = read('src/components/v2/projects/V2ProjectArchiveGateway.astro');
  const homeRenderer = read('src/components/v2/home-final/HomeFinal.astro');
  const companyRenderer = read('src/components/v2/practical/V2CompanyPage.astro');

  assert.deepEqual(home.gatewayProjectSlugs, expectedProjects);
  assert.deepEqual(company.gatewayProjectSlugs, expectedProjects);
  assert.match(gateway, /const presentations = projectSlugs\.map/u);
  assert.match(gateway, /fieldPath: 'presentation\.archiveCoverMedia'/u);
  assert.match(gateway, /fieldPath: `presentation\.publicGallery\[\$\{index\}\]`/u);
  assert.match(gateway, /data-smu1-gateway-frame-source/u);
  assert.match(gateway, /type PublicGatewayFrame = Omit<GatewayFrame, 'ownerSlug' \| 'fieldPath' \| 'sourceRole'>/u);
  assert.match(gateway, /tool: 'relation-list'/u);
  for (const source of [homeRenderer, companyRenderer]) {
    assert.match(source, /projectSlugs=\{(?:home|page)\.gatewayProjectSlugs \?\? \[\]\}/u);
    assert.match(source, /projectSelectionField="gatewayProjectSlugs"/u);
  }
  assert.equal(getFieldCoverage('static-pages', 'gatewayProjectSlugs').editorControl, 'relation-list');
  assert.equal(getFieldCoverage('static-pages', 'gatewayProjectSlugs[]').relationRole.target, 'projects');
});

test('Company and Custom Order media presentation is schema-owned and contextual', () => {
  const company = json('src/content/static-pages/about.json');
  const customOrder = json('src/content/static-pages/custom-order.json');
  const companyRenderer = read('src/components/v2/practical/V2CompanyPage.astro');
  const customData = read('src/components/v2/custom-order/customOrderV2Data.ts');
  const customRenderer = read('src/components/v2/custom-order/CustomOrderV2Page.astro');

  assert.equal(company.companyHeroProjectSlug, 'kompleks-rabot-na-proizvodstvennoy-territorii');
  assert.equal(company.companyHeroPosition, '50% 48%');
  assert.doesNotMatch(companyRenderer, /item\.project\.slug === 'kompleks-rabot/u);
  assert.match(companyRenderer, /item\.project\.slug === page\.companyHeroProjectSlug/u);
  assert.match(companyRenderer, /pageBinding\('companyHeroProjectSlug', 'relation-select'/u);
  assert.match(companyRenderer, /pageBinding\('companyHeroPosition', 'focal-position'/u);

  assert.equal(customOrder.customOrderHeroProjectSlug, 'gorodskie-kacheli-dlya-obshchestvennyh-territoriy');
  assert.match(customData, /heroPresentation\?\.detailHeroMedia/u);
  assert.doesNotMatch(customData, /sourcePage\.image\?\.trim/u);
  assert.match(customRenderer, /pageBinding\('customOrderHeroProjectSlug', 'relation-select'/u);
  assert.match(customRenderer, /pageBinding\('customOrderHeroPosition', 'focal-position'/u);
  assert.match(customRenderer, /pageBinding\('customOrderHeroMobilePosition', 'focal-position'/u);
  assert.match(customRenderer, /pageBinding\('relatedDirectionSlugs', 'relation-list'/u);
  assert.match(customRenderer, /owner: \{ collection: 'projects', slug: heroMedia\.ownerSlug \}/u);
  assert.match(customRenderer, /const breadcrumbItems = \[/u);
  assert.match(customRenderer, /globalBinding\('catalogUi\.shared\.homeBreadcrumbLabel', 'short-text', 'breadcrumb-home'\)/u);
  assert.match(customRenderer, /pageBinding\('title', 'heading', \{ stableItemId: 'custom-order-breadcrumb-current'/u);
  for (const field of ['phonePrimary', 'email', 'telegram']) {
    assert.match(customRenderer, new RegExp(`contactHrefDisposition\\('${field}'`, 'u'));
  }
  assert.match(customRenderer, /contactsPage\.telegramCardLabel/u);
  assert.doesNotMatch(customRenderer, /<span>Telegram<\/span>/u);
});

test('specialized brief inputs are materialized and no longer inferred from copy', () => {
  const canopies = json('src/content/product-sections/navesy.json');
  const topiary = json('src/content/product-sections/topiarii.json');
  const shared = read('src/components/v2/directions/directionV2Data.ts');
  const canopiesRenderer = read('src/components/v2/pages/CanopiesV2Page.astro');
  const topiaryRenderer = read('src/components/v2/pages/TopiaryV2Page.astro');

  assert.deepEqual(canopies.directionPresentation.brief.items.map((item) => item.label), ['Фотография', 'Размеры', 'Эскиз', 'ТЗ']);
  assert.deepEqual(topiary.directionPresentation.brief.items.map((item) => item.label), ['Фотография', 'Эскиз', 'ТЗ', 'Описание задачи']);
  assert.doesNotMatch(shared, /extractConfirmedBriefInputs/u);
  for (const source of [canopiesRenderer, topiaryRenderer]) {
    assert.match(source, /presentation\.brief\.items \?\? \[\]/u);
    assert.match(source, /itemsBinding=\{presentationBinding\('brief\.items', 'ordered-label-list'\)\}/u);
  }
  for (const pathName of ['directionPresentation.brief.items', 'directionPresentation.brief.items[].id', 'directionPresentation.brief.items[].label']) {
    assert.ok(getFieldCoverage('product-sections', pathName));
  }
});

test('compatibility aliases expose canonical provenance only in the local canvas', () => {
  const layout = read('src/layouts/PublicV2Layout.astro');
  const fallback = read('src/components/v2/LegacyV2Fallback.astro');
  assert.match(layout, /refreshTarget && !isEditorCanvas/u);
  assert.match(fallback, /compatibility-alias:\$\{Astro\.url\.pathname\}->\$\{target\}/u);
  assert.match(fallback, /kind: 'contextual'/u);
  assert.match(fallback, /tool: 'open-canonical-page'/u);
  assert.match(fallback, /adminDisposition\(Astro\.url/u);
});

test('focal-position parser clamps invalid values and serializes deterministically', () => {
  assert.deepEqual(parseFocalPosition('12.5% 88%'), { x: 12.5, y: 88 });
  assert.deepEqual(parseFocalPosition('-4% 140%'), { x: 0, y: 100 });
  assert.deepEqual(parseFocalPosition('center'), { x: 50, y: 50 });
  assert.equal(formatFocalPosition({ x: 12.345, y: 88.888 }), '12.35% 88.89%');
});

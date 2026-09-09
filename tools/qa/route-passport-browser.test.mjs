import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('binding registry inventory preserves DOM provenance through parseBinding', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /const parseBinding = \(owner\) => \{[\s\S]*?domTarget:\s*\{[\s\S]*?bindingIdAttribute:/u);
  assert.match(source, /const bindings = Array\.from\(document\.querySelectorAll\('\[data-smu1-binding\]'\)\)\.map\(parseBinding\);/u);
  assert.doesNotMatch(source, /const bindings = [\s\S]{0,240}JSON\.parse\(element\.getAttribute\('data-smu1-binding'\)\)/u);
});

test('production browser inventory rejects admin-only structural list markers', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /\[data-smu1-list-item\],\[data-smu1-list-field\],\[data-smu1-list-value\]/u);
  assert.match(source, /public-list-marker-leak/u);
});

test('expected editor 404 document failures are separated from real runtime failures', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  const contract = await readFile(new URL('./evidence-contract.mjs', import.meta.url), 'utf8');
  assert.match(source, /partitionExpectedNotFoundDocumentEvents\(events\.slice\(editorEventIndex\), expected\.pathname\)/u);
  assert.match(source, /events: editorEvents,\s*expectedDocumentEvents: editorEventPartition\.expected/u);
  assert.match(contract, /route-passport:editor-404-document-evidence/u);
  assert.match(contract, /result\.editor\.expectedDocumentEvents\.some/u);
});

test('editor equivalence explicitly classifies runtime-only surfaces and uses stable landmarks', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  for (const marker of ['data-cookie-banner', 'data-v2-entry-skip-link', 'data-v2-entry-root']) assert.match(source, new RegExp(marker, 'u'));
  for (const marker of ['data-v2-gallery-prev', 'data-v2-gallery-next', 'data-v2-gallery-status', 'data-v2-project-gallery-prev', 'data-v2-project-gallery-next', 'data-v2-project-gallery-status']) {
    assert.match(source, new RegExp(marker, 'u'));
  }
  for (const marker of ['hv2-header__dropdown-indicator', 'v2-breadcrumbs i', 'v2-product-gallery__zoom', 'v2-project-gallery__zoom']) {
    assert.match(source, new RegExp(marker, 'u'));
  }
  assert.match(source, /\.v2-media-empty\[aria-hidden="true"\]/u);
  assert.match(source, /comparableBusinessText\(snapshot\)/u);
  assert.match(source, /compareStableGeometry\(snapshot\.stableGeometry, editorSnapshot\.stableGeometry\)/u);
  assert.doesNotMatch(source, /editorSnapshot\.documentSize\.scrollHeight\s*!==\s*snapshot\.documentSize\.scrollHeight/u);
});

test('alias reconciliation resolves its canonical runtime descriptor from the authoritative route model', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /const expectedRouteByPath = new Map\(model\.routes\.map\(\(route\) => \[route\.pathname, route\]\)\);/u);
  assert.match(source, /expectedRouteByPath\.get\(expected\.canonicalTarget\) \|\| expected/u);
});

test('preview passport reconciles schema-backed optional fields, wildcard impact and declared media instead of runtime state', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /DECLARED_SCHEMA_PATHS\[binding\.ownerCollection\]/u);
  assert.match(source, /bindingFieldPathExists\(sourceRecord, binding\.fieldPath, declaredPaths\)/u);
  assert.doesNotMatch(source, /Object\.hasOwn\(sourceRecord, rootField\)/u);
  assert.match(source, /value\.endsWith\('\/\*'\)/u);
  assert.match(source, /binding\.scope === 'global' && !binding\.affectedRoutes\.includes\('\*'\)/u);
  assert.match(source, /declaredSources:/u);
  assert.match(source, /testDeployArtifact \? 'suppressed-noindex-preview'/u);
  assert.match(source, /testDeployArtifact && !\/noindex\/iu\.test\(snapshot\.robots\).*test-preview-not-noindex/u);
  assert.match(source, /binding\.permissions\?\.reorder === true/u);
  assert.match(source, /item\.visible && !item\.runtimeSurface/u);
  assert.match(source, /document\.fonts\.load\(headingWeight \+ ' ' \+ headingSize/u);
  assert.match(source, /СМУ-1 Проверка сайта/u);
  assert.match(source, /fontStylesheet\.addEventListener\('load'/u);
  assert.match(source, /document\.getAnimations\(\)\.filter/u);
  assert.match(source, /Promise\.allSettled\(finiteAnimations/u);
  assert.match(source, /width: element\.offsetWidth/u);
  assert.match(source, /visualWidth: Math\.round\(rect\.width/u);
  assert.match(source, /#main-content header\[id\], #main-content nav[\s\S]*?#main-content \[data-v2-page-handoff\][\s\S]*?#main-content \[data-v2-media\][\s\S]*?#main-content \[data-v2-entrance-role\]/u);
  assert.match(source, /\.filter\(\(element\) => visuallyVisible\(element\) && !runtimeSurfaceOf\(element\)\)/u);
  assert.match(source, /mediaDiff/u);
  assert.match(source, /compareMediaSnapshots\(snapshot, editorSnapshot, mediaComparisonOptions\)/u);
  assert.match(source, /publicFontDiagnostics: snapshot\.fontDiagnostics/u);
  assert.match(source, /editorFontDiagnostics: editorSnapshot\.fontDiagnostics/u);
  assert.match(source, /item\.declaredSources\?\.length/u);
  assert.match(source, /viewportIntersecting:/u);
  assert.match(source, /new URL\(expected\.pathname, `\$\{options\.editorOrigin\}\/`\)/u);
  assert.match(source, /new URL\(REAL_UNKNOWN_ROUTE, `\$\{options\.editorOrigin\}\/`\)/u);
  assert.doesNotMatch(source, /options\.editorOrigin\}\$\{withBase\(/u);
});

test('production canonical evidence is bound to the configured HTTPS origin as well as route path', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  const contract = await readFile(new URL('./evidence-contract.mjs', import.meta.url), 'utf8');
  assert.match(source, /Production route passport requires SITE_URL to verify canonical origin identity/u);
  assert.match(source, /deployTarget = String\(process\.env\.DEPLOY_TARGET \|\| process\.env\.DEPLOY_ENV/u);
  assert.match(source, /parsed\.origin === canonicalOrigin[\s\S]*!parsed\.username[\s\S]*!parsed\.password[\s\S]*logicalCanonicalPath !== null/u);
  assert.match(source, /canonicalPathWithoutBase/u);
  assert.match(source, /canonical-identity:/u);
  assert.match(source, /canonicalOrigin,/u);
  assert.match(contract, /parsed\.protocol !== 'https:' \|\| parsed\.origin !== expectedOrigin[\s\S]{0,120}parsed\.search \|\| parsed\.hash/u);
  assert.match(contract, /route-passport:canonical-origin/u);
});

test('scalar text bindings cannot target structural DOM without an explicit safe projection', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../../src/layouts/PublicV2Layout.astro', import.meta.url), 'utf8');
  const sectionNav = await readFile(new URL('../../src/components/v2/V2SectionNav.astro', import.meta.url), 'utf8');
  const standard = await readFile(new URL('../../src/components/v2/CatalogStandardProductV2.astro', import.meta.url), 'utf8');
  assert.match(source, /unsafe-structural-text-target:/u);
  assert.match(source, /safeStructuralTargets = new Set\(\['attribute:aria-label', 'paragraphs'\]\)/u);
  assert.match(layout, /target === 'attribute:aria-label'/u);
  assert.match(layout, /target === 'paragraphs'/u);
  assert.match(standard, /standardSectionNavLabel[\s\S]*target: 'attribute:aria-label'/u);
  assert.match(standard, /binding\('description', 'long-text',[\s\S]*target: 'paragraphs'/u);
  assert.match(sectionNav, /data-v2-section-nav \{\.\.\.editor\}/u);
});

test('visual inventory keeps aria-hidden pixels separate from accessibility visibility', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /const visuallyVisible = \(element\) => \{\s*if \(element\.closest\('dialog:not\(\[open\]\), \[hidden\]'\)\) return false;/u);
  assert.doesNotMatch(source, /const visuallyVisible[\s\S]{0,240}\[aria-hidden="true"\]/u);
  assert.match(source, /const accessibilityVisible = \(element\) => visuallyVisible\(element\)\s*&& !element\.closest\('\[aria-hidden="true"\],\[inert\]'\);/u);
  assert.match(source, /visible: visuallyVisible\(element\), accessible: accessibilityVisible\(element\)/u);
  assert.doesNotMatch(source, /element\.closest\('script,style,noscript,template,svg,\[aria-hidden="true"\]'\)/u);
});

test('media coverage requires a direct media tool and rejects generic relation/list false positives', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /kind === 'media'\s*\? isDirectMediaBindingTool\(item\.binding\.tool\)/u);
});

test('object-list coverage is fail-closed against uneditable descendant fields', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  const contract = await readFile(new URL('./structured-list-binding.mjs', import.meta.url), 'utf8');
  assert.match(source, /structuredObjectListBindingIssues\(binding, sourceRecord\)/u);
  assert.match(source, /ownedBusinessText:/u);
  assert.match(source, /ownedMedia:/u);
  assert.match(source, /ownedListItems/u);
  assert.match(source, /objectListBindingSupportsMedia\(item\.binding\)/u);
  assert.match(contract, /object-list-unmapped-text:/u);
  assert.match(contract, /object-list-unmapped-media/u);
  assert.match(contract, /object-list-phantom-field:/u);
  assert.match(contract, /object-list-item-id-missing:/u);
  assert.match(contract, /media-role/u);
});

test('relation coverage requires an explicit typed relation tool', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  for (const tool of ['relation-list', 'relation-select', 'project-direction-relations', 'direction-related-relations']) {
    assert.match(source, new RegExp(`'${tool}'`, 'u'));
  }
  assert.match(source, /RELATION_BINDING_TOOLS[\s\S]*?capabilities\.add\('relation'\)/u);
  assert.doesNotMatch(source, /if \(actual\.has\('list'\)\) \{[\s\S]{0,160}capabilities\.add\('relation'\)/u);
  assert.doesNotMatch(source, /actual\.has\('reorder-item'\)[\s\S]{0,120}capabilities\.add\('relation'\)/u);
});

test('structural relation bindings never mask unbound descendant business text', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /NON_DIRECT_TEXT_BINDING_TOOLS = new Set\(\[[\s\S]*'relation-list'[\s\S]*'relation-select'[\s\S]*'project-direction-relations'[\s\S]*'direction-related-relations'[\s\S]*\]\)/u);
  assert.match(source, /kind === 'media'[\s\S]*: !NON_DIRECT_TEXT_BINDING_TOOLS\.has\(item\.binding\.tool\)/u);
});

test('crop coverage requires an explicit crop binding instead of a generic media binding', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  const premium = await readFile(new URL('../../src/components/v2/CatalogPremiumProductV2.astro', import.meta.url), 'utf8');
  const editor = await readFile(new URL('../../src/admin/shell/visual-editor-app.mjs', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../../src/layouts/PublicV2Layout.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\['gallery', 'media'\][\s\S]{0,120}capabilities\.add\('crop'\)/u);
  assert.match(premium, /binding\('imageView', 'crop',[\s\S]*premium-hero-crop/u);
  assert.match(editor, /binding\.tool === 'crop'\) renderCropInspector\(record, binding\)/u);
  assert.match(editor, /__smu1CropProjection: true/u);
  assert.match(layout, /value\.__smu1CropProjection === true/u);
});

test('stable geometry gate consumes the recorded visual dimensions', async () => {
  const equivalence = await readFile(new URL('./route-passport-equivalence.mjs', import.meta.url), 'utf8');
  assert.match(equivalence, /width: 'visualWidth'/u);
  assert.match(equivalence, /height: 'visualHeight'/u);
  assert.match(equivalence, /Math\.abs\(publicVisualValue - editorVisualValue\) > tolerance/u);
});

test('local editor canvas keeps production visual selectors while disabling only public motion', async () => {
  const layout = await readFile(new URL('../../src/layouts/PublicV2Layout.astro', import.meta.url), 'utf8');
  assert.match(layout, /data-v2-public-route=\{isProduction \? 'true' : undefined\}/u);
  assert.match(layout, /const stylesheetUrl = \(value: string\) => import\.meta\.env\.DEV/u);
  assert.match(layout, /const fontStylesheetUrl = withBase\('\/assets\/fonts\/manrope\/fonts\.css'\)/u);
  assert.doesNotMatch(layout, /fonts\.(?:googleapis|gstatic)\.com/u);
  assert.match(layout, /\[400, 600, 700\]\.map\(\(weight\) => <link\s+href=\{withBase\(`\/assets\/fonts\/manrope\/manrope-\$\{weight\}-latin-cyrillic\.woff2`\)\}\s+rel="preload"\s+as="font"\s+type="font\/woff2"\s+crossorigin/u);
  const fonts = await readFile(new URL('../../public/assets/fonts/manrope/fonts.css', import.meta.url), 'utf8');
  const faces = [...fonts.matchAll(/@font-face\s*\{([^}]+)\}/gu)].map((match) => match[1]);
  assert.equal(faces.length, 4);
  for (const weight of [400, 500, 600, 700]) {
    const face = faces.find((block) => block.includes(`font-weight: ${weight};`));
    assert.ok(face, `Manrope ${weight} must have a static local face`);
    assert.match(face, /font-family: 'Manrope';/u);
    assert.match(face, /font-display: optional;/u);
    assert.ok(face.includes(`url('./manrope-${weight}-latin-cyrillic.woff2') format('woff2')`));
    const bytes = await readFile(new URL(`../../public/assets/fonts/manrope/manrope-${weight}-latin-cyrillic.woff2`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'wOF2');
  }
  assert.match(layout, /\$\{value\.includes\('\?'\) \? '&' : '\?'\}direct/u);
  assert.match(layout, /\{isProduction && <link rel="stylesheet" href=\{h4ScaleV2StylesheetUrl\}/u);
  assert.match(layout, /\{isPublicV2Motion && <link rel="stylesheet" href=\{entranceV2StylesheetUrl\}/u);
  assert.match(layout, /const isPublicV2Motion = isProduction\s*\n\s*&& !isEditorCanvas/u);
});

test('mobile project detail lead keeps a font-cache-independent line measure', async () => {
  const scale = await readFile(new URL('../../src/styles/v2/h4-scale-v2.css', import.meta.url), 'utf8');
  const mobileScale = scale.slice(scale.indexOf('/* Mobile'));
  assert.match(mobileScale, /\.projects-v2 \.v2-project-detail__lead\s*\{\s*max-width: calc\(100% - 1em\);/u);
});

test('route equivalence warms and verifies the optional font on both sequential origins', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /const warmFontCache = async \(\) =>/u);
  assert.match(source, /const warmRoute = routesToCrawl\[0\]\?\.pathname \|\| '\/'/u);
  assert.match(source, /\{ id: 'public', url: `\$\{origin\}\$\{withBase\(warmRoute\)\}` \}/u);
  assert.match(source, /id: 'editor'[\s\S]*new URL\(warmRoute, `\$\{options\.editorOrigin\}\/`\)/u);
  assert.match(source, /for \(let pass = 1; pass <= 2; pass \+= 1\)/u);
  assert.match(source, /kind: 'font-metric-mismatch'/u);
  assert.match(source, /await browser\.emulateMedia\(\{ reducedMotion: true \}\)/u);
  assert.match(source, /cold-font-warmup-runtime-or-network/u);
  assert.match(source, /fontWarmup\.failures\.length \+ routeResults\.reduce/u);
  assert.match(source, /try \{\s*const fontWarmup = await warmFontCache\(\);\s*progress/u);
});

test('filtered project smoke does not invent missing archive evidence while full crawl stays strict', async () => {
  const source = await readFile(new URL('./route-passport-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /presentation \|\| \(options\.onlyRoute\s*\? \{ status: 'not-collected-in-filtered-smoke' \}/u);
  assert.match(source, /if \(!presentation && options\.onlyRoute\) continue;/u);
  assert.match(source, /if \(!presentation\) \{\s*result\.issues\.push\('project-archive-presentation-unreconciled'\)/u);
});

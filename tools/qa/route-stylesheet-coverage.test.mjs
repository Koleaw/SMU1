import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readSource = (relative) => readFile(path.resolve(relative), 'utf8');
const families = [
  { layout: 'practical/PracticalV2Layout', css: 'practical-v2', variable: 'practicalStylesheetUrl', parent: 'CatalogV2Layout' },
  { layout: 'engineering/EngineeringDirectionV2Layout', css: 'engineering-direction-v2', variable: 'engineeringStylesheetUrl', parent: 'DirectionV2Layout' },
  { layout: 'project/ProjectDirectionV2Layout', css: 'project-direction-v2', variable: 'projectStylesheetUrl', parent: 'DirectionV2Layout' },
  { layout: 'place/PlaceDirectionV2Layout', css: 'place-direction-v2', variable: 'placeStylesheetUrl', parent: 'DirectionV2Layout' }
];

const astroFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? astroFiles(filename) : entry.name.endsWith('.astro') ? [filename] : [];
  }));
  return groups.flat();
};

test('conditional route families request only their own blocking CSS without dispatcher side effects', async () => {
  const files = await astroFiles(path.resolve('src'));
  const sources = await Promise.all(files.map(async (filename) => ({ filename, source: await readFile(filename, 'utf8') })));
  for (const family of families) {
    const source = await readSource(`src/components/v2/${family.layout}.astro`);
    assert.ok(source.includes(`import ${family.variable} from '../../../styles/v2/${family.css}.css?url';`), family.layout);
    assert.ok(source.includes(`<${family.parent}\n  blockingStylesheetUrls={[${family.variable}]}`),
      `${family.layout}: the rendered owner sends its CSS to the document head`);
    for (const { filename, source: candidate } of sources) {
      assert.ok(!candidate.includes(`/${family.css}.css';`) && !candidate.includes(`/${family.css}.css";`),
        `${filename}: a static dispatcher import must not include another route's CSS`);
    }
  }
});

test('all public owners still use the layouts that supply their route styles', async () => {
  const owners = [
    ['src/components/v2/pages/MetalworksV2Page.astro', 'EngineeringDirectionV2Layout'],
    ['src/components/v2/pages/ConstructionV2Page.astro', 'ProjectDirectionV2Layout'],
    ['src/components/v2/pages/LandscapingV2Page.astro', 'PlaceDirectionV2Layout'],
    ['src/pages/[slug].astro', 'PracticalV2Layout'],
    ['src/pages/kontakty.astro', 'PracticalV2Layout'],
    ['src/pages/vakansii.astro', 'PracticalV2Layout'],
    ['src/pages/vakansii/[slug].astro', 'PracticalV2Layout'],
    ['src/pages/politika-konfidencialnosti/index.astro', 'PracticalV2Layout']
  ];
  for (const [filename, layout] of owners) {
    const source = await readSource(filename);
    assert.ok(source.includes(`import ${layout} from `), `${filename}: imports ${layout}`);
    assert.ok(source.includes(`<${layout}`), `${filename}: renders ${layout}`);
  }
});

test('route CSS propagation remains synchronous in the head with final polish after it', async () => {
  const direction = await readSource('src/components/v2/directions/DirectionV2Layout.astro');
  const catalog = await readSource('src/components/v2/CatalogV2Layout.astro');
  const layout = await readSource('src/layouts/PublicV2Layout.astro');
  assert.ok(direction.includes('blockingStylesheetUrls={[directionPolishUrl, ...(Astro.props.blockingStylesheetUrls ?? [])]}'));
  assert.match(catalog, /blockingStylesheetUrls=\{\[\s*catalogStylesheetUrl,\s*\.\.\.\(Astro\.props\.blockingStylesheetUrls \?\? \[\]\)/u);
  const head = layout.slice(layout.indexOf('<head>'), layout.indexOf('</head>'));
  assert.match(head, /blockingStylesheetUrls\.map\(\(href\) => \(\s*<link rel="stylesheet" href=\{stylesheetUrl\(href\)\} data-v2-route-styles \/>/u);
  assert.ok(head.indexOf('blockingStylesheetUrls.map') < head.indexOf('href={stylesheetUrl(publicPolishUrl)}'));
  assert.ok(head.indexOf('href={stylesheetUrl(publicPolishUrl)}') < head.indexOf('href={stylesheetUrl(ownerDirectionsUrl)}'));
});

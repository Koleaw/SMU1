import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFile(path.join(root, ...relative.split('/')), 'utf8');

test('Home exposes exact direction kicker/image fields and distinct responsive poster roles', async () => {
  const source = await read('src/components/v2/home-final/HomeFinal.astro');
  assert.match(source, /homeBinding\('heroMediaPosterMobile', 'media',[\s\S]*?role: 'home-hero-poster-mobile'[\s\S]*?target: 'source\.srcset'/u);
  assert.match(source, /homeBinding\('heroMediaPoster', 'media',[\s\S]*?role: 'home-hero-poster-desktop'[\s\S]*?target: 'img\.src'/u);
  assert.doesNotMatch(source, /<picture class="hf-hero__poster"[^>]*homeBinding/u,
    'responsive poster wrapper must not collapse desktop and mobile fields into one owner occurrence');
  assert.match(source, /homeBinding\(`homeDirectionCards\[\$\{index\}\]\.\$\{field\}`/u);
  assert.equal((source.match(/homeDirectionCardBinding\([^\n]+, 'kicker'\)/gu) || []).length, 3,
    'feature, rail and wide direction kickers use their stable home card field');
  assert.equal((source.match(/directionBinding\([^\n]+, 'homeImage', 'media'/gu) || []).length, 2,
    'feature and wide direction images bind to the borrowed direction homeImage field');
});

test('construction and landscaping proof occurrences retain their project owners and field paths', async () => {
  const [projectProof, construction, placeProjects, landscaping] = await Promise.all([
    read('src/components/v2/project/ProjectDirectionProof.astro'),
    read('src/components/v2/pages/ConstructionV2Page.astro'),
    read('src/components/v2/place/PlaceDirectionProjects.astro'),
    read('src/components/v2/pages/LandscapingV2Page.astro')
  ]);

  assert.match(construction, /owner: \{ collection: 'projects', slug: industrial\.slug \}/u);
  assert.match(construction, /descriptionField: industrial\.whatWasDone\?\.trim\(\) \? 'whatWasDone' : 'shortDescription'/u);
  assert.match(construction, /mediaField: 'presentation\.mediaRoles'/u);
  assert.match(construction, /construction-building \+ finished-result \+ proof/u);
  assert.match(construction, /owner: \{ collection: 'projects', slug: squareRepair\.slug \}/u);
  assert.match(projectProof, /projectBinding\(featured, featured\.editor\.mediaField, 'gallery'/u);
  assert.match(projectProof, /directOrDeclared\(featured, 'title', 'heading'/u);
  assert.match(projectProof, /project\.editor && fieldPath[\s\S]*?projectBinding\(project, fieldPath, tool\)/u,
    'owned proof occurrences must resolve the contextual helper to a real project binding');
  assert.match(projectProof, /featured\.editor\?\.descriptionField/u);
  assert.match(projectProof, /src\/content\/\$\{project\.editor\.owner\.collection\}\/\$\{project\.editor\.owner\.slug\}\.json#\$\{fields\}/u);
  assert.match(projectProof, /kind: 'derived',[\s\S]*?source: sourcePath\(project, 'city,year'\)/u);

  assert.match(placeProjects, /owner: \{ collection: 'projects', slug: project\.project\.slug \}/u);
  assert.match(placeProjects, /projectBinding\(featured, 'presentation\.mediaRoles', 'gallery'/u);
  assert.match(placeProjects, /projectBinding\(featured, 'title', 'heading'\)/u);
  assert.match(placeProjects, /projectBinding\(featured, descriptionField\(featured\), 'long-text'\)/u);
  assert.match(placeProjects, /src\/content\/projects\/\$\{project\.project\.slug\}\.json#city,year/u);
  assert.match(landscaping, /editorSource="src\/components\/v2\/pages\/LandscapingV2Page\.astro#landscaping-proof"/u);
});

test('multi-owner direction gallery declares exact product sources instead of a false single owner', async () => {
  const [directionGallery, productGallery, canopies] = await Promise.all([
    read('src/components/v2/directions/DirectionV2Gallery.astro'),
    read('src/components/v2/V2ProductGallery.astro'),
    read('src/components/v2/pages/CanopiesV2Page.astro')
  ]);
  const productFiles = await fs.readdir(path.join(root, 'src', 'content', 'products'));
  const contributors = [];
  for (const filename of productFiles.filter((item) => item.endsWith('.json'))) {
    const product = JSON.parse(await fs.readFile(path.join(root, 'src', 'content', 'products', filename), 'utf8'));
    if (product.productCategorySlug === 'navesy' && product.isActive !== false && product.showInCatalog !== false
      && Array.isArray(product.gallery) && product.gallery.length > 0) contributors.push(product.slug);
  }
  assert.deepEqual(contributors.sort(), ['ekran-s-navesom', 'naves-galereya', 'naves-terra']);
  assert.match(canopies, /galleryMediaSources = catalogProducts[\s\S]*?owner: \{ collection: 'products', slug: product\.slug \}, fieldPath: 'gallery'/u);
  assert.match(canopies, /mediaSources=\{galleryMediaSources\}/u);
  assert.match(directionGallery, /adminDisposition\(Astro\.url,[\s\S]*?kind: 'contextual'/u);
  assert.match(directionGallery, /src\/content\/\$\{owner\.collection\}\/\$\{owner\.slug\}\.json#\$\{fieldPath\}/u);
  assert.match(directionGallery, /one binding cannot honestly represent|один binding не может честно представить/iu);
  assert.doesNotMatch(directionGallery, /adminBinding\(/u);
  assert.equal((productGallery.match(/\{\.\.\.mediaDisposition\}/gu) || []).length, 2,
    'the contextual declaration is attached only to the visible main and thumbnail media occurrences');
});

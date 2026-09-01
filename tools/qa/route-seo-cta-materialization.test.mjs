import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getFieldCoverage } from '../../src/admin/metadata/content-coverage-registry.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

test('project and product card business labels have exact shared owners', () => {
  const settings = readJson('src/content/site-settings/global.json');
  const projectCard = read('src/components/v2/projects/V2ProjectCard.astro');
  const productCard = read('src/components/v2/V2ProductCard.astro');

  assert.equal(settings.projectUi.archiveCardCtaLabel, 'Смотреть объект');
  assert.match(projectCard, /settings\.projectUi\.archiveCardCtaLabel/u);
  assert.match(projectCard, /projectUiBinding\('archiveCardCtaLabel', 'link-label'\)/u);
  assert.match(projectCard, /project-archive-card-\$\{project\.slug\}-\$\{fieldPath\}/u);
  assert.match(projectCard, /scope: 'shared',[\s\S]{0,100}affectedRoutes: \['\/vypolnennye-obekty\/'\]/u);

  for (const [fieldPath, value] of Object.entries({
    cardPremiumLabel: 'Решение для объекта',
    cardMaterialsMissingLabel: 'Материалы не указаны',
    cardCtaLabel: 'Подробнее'
  })) {
    assert.equal(settings.productUi[fieldPath], value);
    assert.match(productCard, new RegExp(`settings\\.productUi\\.${fieldPath}`, 'u'));
    assert.match(productCard, new RegExp(`productUiBinding\\('${fieldPath}'`, 'u'));
    assert.ok(getFieldCoverage('site-settings', `productUi.${fieldPath}`));
  }

  assert.match(productCard, /kind: 'derived'[\s\S]*products\.\$\{product\.slug\}\.materials\[0\]/u);
  assert.doesNotMatch(productCard, />Решение для объекта</u);
  assert.doesNotMatch(productCard, />Подробнее</u);
});

test('standard and premium product UI fields render with exact bindings', () => {
  const settings = readJson('src/content/site-settings/global.json');
  const standard = read('src/components/v2/CatalogStandardProductV2.astro');
  const premium = read('src/components/v2/CatalogPremiumProductV2.astro');
  const expected = {
    standardDeliveryEyebrow: 'Получение изделия',
    standardDeliveryTitle: 'Доставка',
    standardDeliveryLinkLabel: 'Уточнить условия',
    standardRelatedEyebrow: 'Другие изделия',
    standardRelatedLinkLabel: 'Все товары категории',
    premiumDeliveryEyebrow: 'Реализация',
    premiumDeliveryTitle: 'Доставка и монтаж',
    premiumRelatedEyebrow: 'Продолжить подбор',
    premiumRelatedTitle: 'Другие изделия и решения',
    premiumRelatedLinkLabel: 'Все товары категории'
  };

  for (const [fieldPath, value] of Object.entries(expected)) {
    const source = fieldPath.startsWith('standard') ? standard : premium;
    assert.equal(settings.productUi[fieldPath], value);
    assert.match(source, new RegExp(`settings\\.productUi\\.${fieldPath}`, 'u'));
    assert.match(source, new RegExp(`productUiBinding\\('${fieldPath}'`, 'u'));
    assert.ok(getFieldCoverage('site-settings', `productUi.${fieldPath}`));
  }

  for (const source of [standard, premium]) {
    assert.match(source, /headerCtaBinding=\{headerCtaBinding\}/u);
    assert.match(source, /headerMobileCtaBinding=\{headerMobileCtaBinding\}/u);
    assert.match(source, /mobileCtaBinding=\{mobileCtaBinding\}/u);
    assert.match(source, /header-desktop/u);
    assert.match(source, /header-mobile/u);
    assert.match(source, /footer-mobile/u);
  }
});

test('practical route SEO and shell CTA come from their authoritative owners', () => {
  const settings = readJson('src/content/site-settings/global.json');
  const practicalLayout = read('src/components/v2/practical/PracticalV2Layout.astro');
  const contacts = read('src/pages/kontakty.astro');
  const vacancies = read('src/pages/vakansii.astro');
  const vacancy = read('src/pages/vakansii/[slug].astro');

  for (const [owner, source] of [['contactsPage', contacts], ['vacanciesPage', vacancies]]) {
    assert.match(source, /title=\{copy\.seoTitle\}/u);
    assert.match(source, /description=\{copy\.seoDescription\}/u);
    assert.match(source, /ctaLabel=\{copy\.shellCtaLabel\}/u);
    assert.match(source, new RegExp(`fieldPath: '${owner}\\.shellCtaLabel'`, 'u'));
    for (const fieldPath of ['seoTitle', 'seoDescription', 'shellCtaLabel']) {
      assert.equal(typeof settings[owner][fieldPath], 'string');
      assert.ok(getFieldCoverage('site-settings', `${owner}.${fieldPath}`));
    }
  }

  assert.match(vacancy, /title=\{job\.seoTitle\}/u);
  assert.match(vacancy, /description=\{job\.seoDescription\}/u);
  assert.ok(getFieldCoverage('jobs', 'seoTitle'));
  assert.ok(getFieldCoverage('jobs', 'seoDescription'));
  assert.match(vacancy, /fieldPath: 'vacancyDetailPage\.shellCtaLabel'/u);
  assert.match(vacancy, /ctaLabel=\{copy\.shellCtaLabel\}/u);
  assert.equal(settings.vacancyDetailPage.shellCtaLabel, 'Откликнуться');

  for (const prop of ['headerCtaBinding', 'headerMobileCtaBinding', 'mobileCtaBinding']) {
    assert.match(practicalLayout, new RegExp(`${prop}=\\{Astro\\.props\\.${prop}\\}`, 'u'));
  }
  for (const source of [contacts, vacancies, vacancy]) {
    assert.match(source, /shellCtaBinding\('header-desktop'\)/u);
    assert.match(source, /shellCtaBinding\('header-mobile'\)/u);
    assert.match(source, /shellCtaBinding\('footer-mobile'\)/u);
  }
});

test('custom-order SEO and all shell CTA occurrences share the static page owner', () => {
  const page = readJson('src/content/static-pages/custom-order.json');
  const route = read('src/pages/izgotovlenie-na-zakaz.astro');

  assert.equal(page.shellCtaLabel, 'Обсудить задачу');
  assert.match(route, /title=\{data\.sourcePage\.seoTitle\}/u);
  assert.match(route, /description=\{data\.sourcePage\.seoDescription\}/u);
  assert.match(route, /fieldPath: 'shellCtaLabel'/u);
  assert.match(route, /owner: \{ collection: 'static-pages', slug: data\.sourcePage\.slug \}/u);
  assert.match(route, /headerCtaLabel=\{data\.sourcePage\.shellCtaLabel\}/u);
  assert.match(route, /mobileCtaLabel=\{data\.sourcePage\.shellCtaLabel\}/u);
  assert.ok(getFieldCoverage('static-pages', 'shellCtaLabel'));
  assert.doesNotMatch(route, /headerCtaLabel="Обсудить задачу"/u);
});

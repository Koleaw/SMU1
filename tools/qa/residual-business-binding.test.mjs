import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

test('vacancy archive binds every record-backed fact to its exact jobs field', () => {
  const source = read('src/components/v2/practical/V2VacanciesArchive.astro');

  for (const fieldPath of ['city', 'employmentType', 'salary']) {
    assert.match(source, new RegExp(`value: job\\.${fieldPath}, fieldPath: '${fieldPath}'`, 'u'));
  }
  assert.match(source, /<dd \{\.\.\.jobBinding\(job, fact\.fieldPath, 'short-text'\)\}>\{fact\.value\}<\/dd>/u);
});

test('custom-order CTA and contact copy is schema-owned, bound, and output-equivalent', () => {
  const page = readJson('src/content/static-pages/custom-order.json');
  const dataSource = read('src/components/v2/custom-order/customOrderV2Data.ts');
  const component = read('src/components/v2/custom-order/CustomOrderV2Page.astro');
  const expected = {
    heroPrimaryLabel: 'Позвонить',
    heroSecondaryLabel: 'Отправить исходные данные',
    contactEyebrow: 'Прямая связь',
    contactPrimaryLabel: 'Основной телефон',
    contactSecondaryLabel: 'Email'
  };

  for (const [fieldPath, value] of Object.entries(expected)) {
    assert.equal(page[fieldPath], value, `${fieldPath} must preserve the accepted public copy`);
    assert.match(dataSource, new RegExp(`${fieldPath}: sourcePage\\.${fieldPath} \\?\\?`, 'u'));
    assert.match(component, new RegExp(`pageBinding\\('${fieldPath}',`, 'u'));
    assert.match(component, new RegExp(`data\\.copy\\.${fieldPath}`, 'u'));
  }
});

test('project category exposes the real fallback source and section navigation is not mislabeled derived', () => {
  const detail = read('src/components/v2/projects/V2ProjectDetail.astro');
  const nav = read('src/components/v2/V2SectionNav.astro');

  for (const fieldPath of ['category', 'workType', 'shortCategory']) {
    assert.match(detail, new RegExp(`project\\.${fieldPath}\\?\\.trim\\(\\)`, 'u'));
  }
  assert.match(detail, /binding\(categoryFieldPath, 'short-text'/u);
  assert.match(detail, /presentation\.category \|\| settings\.projectUi\.detailDefaultEyebrow/u);
  assert.match(detail, /fallback: 'site-settings\.projectUi\.detailDefaultEyebrow'/u);
  assert.match(detail, /editorSource="src\/components\/v2\/projects\/V2ProjectDetail\.astro#sectionNavItems"/u);
  assert.match(nav, /kind: 'template-fixed'/u);
  assert.match(nav, /source: `\$\{editorSource\}#\$\{item\.id\}`/u);
  assert.doesNotMatch(nav, /kind: 'derived'/u);
});

test('company and project archive pass complete owner bindings to V2DirectContact', () => {
  const companyPage = readJson('src/content/static-pages/about.json');
  const company = read('src/components/v2/practical/V2CompanyPage.astro');
  const archivePage = readJson('src/content/static-pages/vypolnennye-obekty.json');
  const archive = read('src/components/v2/projects/V2ProjectArchivePage.astro');
  const companyContact = company.match(/<V2DirectContact[\s\S]*?\/>/u)?.[0] ?? '';
  const archiveContact = archive.match(/<V2DirectContact[\s\S]*?\/>/u)?.[0] ?? '';

  assert.equal(companyPage.contactEyebrow, 'Прямая связь');
  for (const prop of ['eyebrowBinding', 'titleBinding', 'descriptionBinding', 'primaryLabelBinding', 'secondaryLabelBinding']) {
    assert.match(companyContact, new RegExp(`${prop}=\\{pageBinding\\(`, 'u'));
    assert.match(archiveContact, new RegExp(`${prop}=\\{pageBinding\\(`, 'u'));
  }

  assert.deepEqual(
    {
      contactEyebrow: archivePage.contactEyebrow,
      contactPrimaryLabel: archivePage.contactPrimaryLabel,
      contactSecondaryLabel: archivePage.contactSecondaryLabel
    },
    {
      contactEyebrow: 'Прямая связь',
      contactPrimaryLabel: 'Написать в Telegram',
      contactSecondaryLabel: 'Позвонить'
    }
  );

  const detail = read('src/components/v2/projects/V2ProjectDetail.astro');
  assert.match(detail, /editorSource="src\/components\/v2\/projects\/V2ProjectDetail\.astro#contact"/u);
  assert.doesNotMatch(detail, /titleBinding=\{binding\('contact/u);
});

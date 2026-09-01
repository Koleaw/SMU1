import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getFieldCoverage } from '../../src/admin/metadata/content-coverage-registry.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

test('Home owns button destinations and contact-channel labels separately from global contact values', () => {
  const home = readJson('src/content/static-pages/home.json');
  const source = read('src/components/v2/home-final/HomeFinal.astro');
  const accepted = {
    heroPrimaryHref: '#contact',
    heroSecondaryHref: '/vypolnennye-obekty/',
    contactSecondaryHref: '/kontakty/',
    contactPhonePrimaryLabel: 'Основной телефон',
    contactPhoneSecondaryLabel: 'Дополнительный телефон',
    contactTelegramLabel: 'Telegram',
    contactEmailLabel: 'Электронная почта',
    contactAddressLabel: 'Адрес',
    contactRegionsLabel: 'География'
  };

  for (const [fieldPath, value] of Object.entries(accepted)) {
    assert.equal(home[fieldPath], value);
    assert.ok(getFieldCoverage('static-pages', fieldPath), fieldPath);
    assert.match(source, new RegExp(`home\.${fieldPath}`, 'u'), fieldPath);
  }
  assert.match(source, /homeBinding\('heroPrimaryLabel', 'link', \{ hrefPath: 'heroPrimaryHref' \}\)/u);
  assert.match(source, /homeBinding\('heroSecondaryLabel', 'link', \{ hrefPath: 'heroSecondaryHref' \}\)/u);
  assert.match(source, /homeBinding\('contactSecondaryLabel', 'link', \{ hrefPath: 'contactSecondaryHref' \}\)/u);
  assert.match(source, /globalHrefDisposition\('telegram', 'Адрес основной контактной кнопки/u);
  assert.match(source, /globalBinding\('telegramLabel'/u);
  assert.doesNotMatch(source, /href="#contact"/u);
  assert.doesNotMatch(source, /<span>Основной телефон<\/span>/u);
});

test('Privacy keeps legal prefixes fixed and binds only the mutable global value spans', () => {
  const settings = readJson('src/content/site-settings/global.json');
  const source = read('src/components/v2/practical/V2PrivacyPolicy.astro');

  assert.equal(settings.privacyPolicy.homeBreadcrumbLabel, 'Главная');
  assert.equal(settings.privacyPolicy.shellCtaLabel, 'Связаться');
  assert.match(source, /title: policy\.homeBreadcrumbLabel[\s\S]*legalBinding\('homeBreadcrumbLabel'/u);
  for (const fieldPath of ['inn', 'kpp', 'ogrn', 'legalAddress', 'phonePrimary', 'email', 'telegramLabel']) {
    assert.ok(source.includes(`<span {...globalBinding('${fieldPath}'`), fieldPath);
  }
  assert.match(source, /fixedPrefix\('operator-inn-prefix'/u);
  assert.match(source, /fixedPrefix\('contact-phone-prefix'/u);
  assert.doesNotMatch(source, /<p \{\.\.\.globalBinding\('inn'\)\}>ИНН/u);
  assert.ok(getFieldCoverage('site-settings', 'privacyPolicy.homeBreadcrumbLabel'));
  assert.ok(getFieldCoverage('site-settings', 'privacyPolicy.shellCtaLabel'));
});

test('Company and vacancy visible labels have exact schema owners and occurrence bindings', () => {
  const settings = readJson('src/content/site-settings/global.json');
  const company = read('src/components/v2/practical/V2CompanyPage.astro');
  const archive = read('src/components/v2/practical/V2VacanciesArchive.astro');
  const detail = read('src/components/v2/practical/V2VacancyDetail.astro');

  for (const [owner, fields] of Object.entries({
    companyPage: ['homeBreadcrumbLabel', 'breadcrumbLabel', 'companyLabel', 'cityLabel', 'registrationLabel', 'regionsLabel', 'contactsLabel', 'privacyLabel', 'innLabel', 'kppLabel', 'ogrnLabel', 'registrationDateLabel', 'legalAddressLabel', 'contactAddressLabel'],
    vacanciesPage: ['homeBreadcrumbLabel', 'breadcrumbLabel', 'cityLabel', 'employmentTypeLabel', 'salaryLabel', 'openPositionLabel', 'emptyEyebrow', 'relatedEyebrow', 'relatedCompanyLabel', 'relatedContactsLabel'],
    vacancyDetailPage: ['homeBreadcrumbLabel', 'archiveBreadcrumbLabel', 'responsibilitiesLabel', 'requirementsLabel', 'conditionsLabel', 'cityLabel', 'employmentTypeLabel', 'salaryLabel', 'emailChannelLabel', 'phoneChannelLabel', 'telegramChannelLabel', 'relatedEyebrow', 'relatedCompanyLabel', 'relatedContactsLabel']
  })) {
    for (const fieldPath of fields) {
      assert.equal(typeof settings[owner][fieldPath], 'string', `${owner}.${fieldPath}`);
      assert.ok(getFieldCoverage('site-settings', `${owner}.${fieldPath}`), `${owner}.${fieldPath}`);
    }
  }

  assert.match(company, /companyPageBinding\('homeBreadcrumbLabel'/u);
  assert.match(company, /fixedPrefix\('registered-prefix'/u);
  assert.match(company, /globalBinding\('registrationDate', 'short-text', \{ stableItemId: 'company-fact-registration-date' \}\)/u);
  assert.doesNotMatch(company, /<dd \{\.\.\.globalBinding\('registrationDate'\)\}>Зарегистрировано/u);
  for (const occurrence of [
    'company-fact-name',
    'company-fact-city',
    'company-fact-registration-date',
    'company-fact-regions',
    'company-details-name',
    'company-details-city',
    'company-details-address',
    'company-details-regions',
    'company-requisite-name',
    'company-requisite-registration-date',
    'company-requisite-contact-address'
  ]) {
    assert.match(company, new RegExp(`stableItemId: '${occurrence}'`, 'u'), occurrence);
  }
  assert.match(archive, /pageBinding\('openPositionLabel'/u);
  assert.match(archive, /stableItemId: `vacancies-primary-label-\$\{job\.slug\}`/u);
  assert.match(detail, /pageBinding\(section\.titleFieldPath, 'heading'\)/u);
  assert.match(detail, /pageBinding\('telegramChannelLabel'/u);
  assert.doesNotMatch(`${archive}\n${detail}`, />Узнать больше о СМУ-1</u);
});

test('company and privacy shell CTA occurrences use their authoritative page owners', () => {
  const about = readJson('src/content/static-pages/about.json');
  const settings = readJson('src/content/site-settings/global.json');
  const sources = [
    read('src/pages/[slug].astro'),
    read('src/pages/design-lab/v2/o-nas/index.astro'),
    read('src/pages/politika-konfidencialnosti/index.astro'),
    read('src/pages/design-lab/v2/politika-konfidencialnosti/index.astro')
  ];

  assert.equal(about.shellCtaLabel, 'Получить расчёт');
  assert.equal(settings.privacyPolicy.shellCtaLabel, 'Связаться');
  for (const source of sources) {
    assert.match(source, /headerCtaBinding=\{(?:companyS|s)hellCtaBinding\('header-desktop'\)\}/u);
    assert.match(source, /headerMobileCtaBinding=\{(?:companyS|s)hellCtaBinding\('header-mobile'\)\}/u);
    assert.match(source, /mobileCtaBinding=\{(?:companyS|s)hellCtaBinding\('footer-mobile'\)\}/u);
  }
  assert.match(sources[0], /fieldPath: 'shellCtaLabel'/u);
  assert.match(sources[2], /fieldPath: 'privacyPolicy\.shellCtaLabel'/u);
  assert.doesNotMatch(sources.join('\n'), /ctaLabel="(?:Получить расчёт|Связаться)"/u);
});

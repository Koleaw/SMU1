import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getFieldCoverage } from '../../src/admin/metadata/content-coverage-registry.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

test('project archive/detail shared copy is schema-owned and preserves the accepted output', () => {
  const settings = readJson('src/content/site-settings/global.json');
  const detail = read('src/components/v2/projects/V2ProjectDetail.astro');
  const archivePage = read('src/components/v2/projects/V2ProjectArchivePage.astro');
  const archiveRow = read('src/components/v2/projects/V2ProjectArchiveRow.astro');
  const projectSources = `${detail}\n${archivePage}\n${archiveRow}`;
  const expected = {
    archiveCardCtaLabel: 'Смотреть объект',
    detailDefaultEyebrow: 'Выполненный объект',
    detailWorkTitle: 'Что было выполнено',
    detailFactsEyebrow: 'Сведения об объекте',
    detailFactsTitle: 'По опубликованным данным',
    detailGalleryEyebrow: 'Фотографии объекта',
    detailGalleryTitle: 'Объект в кадрах',
    detailDirectionsEyebrow: 'Связанные направления',
    detailDirectionsTitle: 'Продолжить по задаче',
    detailContactTitle: 'Обсудим похожую задачу',
    detailContactDescription: 'Кратко опишите объект и имеющиеся исходные материалы — обсудим задачу и подготовим расчёт.'
  };

  for (const [fieldPath, value] of Object.entries(expected)) {
    assert.equal(settings.projectUi[fieldPath], value, `${fieldPath} must preserve the accepted copy`);
    assert.ok(getFieldCoverage('site-settings', `projectUi.${fieldPath}`), `${fieldPath} needs renderer coverage`);
  }

  for (const fieldPath of Object.keys(settings.projectUi)) {
    assert.match(projectSources, new RegExp(`settings\\.projectUi\\.${fieldPath}`, 'u'), `${fieldPath} must be rendered`);
    if (fieldPath !== 'detailDefaultEyebrow') {
      if (fieldPath.startsWith('detailFact') && fieldPath.endsWith('Label')) {
        assert.match(detail, new RegExp(`titleField: '${fieldPath}'`, 'u'));
        assert.match(detail, /projectUiBinding\(fact\.titleField, 'heading'\)/u);
      } else {
        assert.match(projectSources, new RegExp(`projectUiBinding\\('${fieldPath}'`, 'u'), `${fieldPath} needs an exact canvas binding`);
      }
    }
  }

  for (const fieldPath of [
    'detailWorkTitle', 'detailFactsEyebrow', 'detailFactsTitle', 'detailGalleryEyebrow',
    'detailGalleryTitle', 'detailDirectionsEyebrow', 'detailDirectionsTitle',
    'detailContactEyebrow', 'detailContactTitle', 'detailContactDescription',
    'detailContactPrimaryLabel', 'detailContactSecondaryLabel'
  ]) {
    assert.match(detail, new RegExp(`projectUiBinding\\('${fieldPath}'`, 'u'));
    assert.match(detail, new RegExp(`settings\\.projectUi\\.${fieldPath}`, 'u'));
  }

  assert.match(archiveRow, /projectUiBinding\('archiveCardCtaLabel', 'button-label'\)/u);
  assert.match(archiveRow, /settings\.projectUi\.archiveCardCtaLabel/u);
  assert.doesNotMatch(detail, />Что было выполнено</u);
  assert.doesNotMatch(detail, /title="Обсудим похожую задачу"/u);
  assert.doesNotMatch(archiveRow, />Смотреть объект</u);
});

test('404 SEO, visible copy and recovery targets share one validated owner', () => {
  const settings = readJson('src/content/site-settings/global.json');
  const route = read('src/components/v2/not-found/V2NotFoundRoute.astro');
  const page = read('src/components/v2/not-found/V2NotFoundPage.astro');
  const copy = settings.notFoundPage;

  assert.deepEqual(
    {
      seoTitle: copy.seoTitle,
      seoDescription: copy.seoDescription,
      shellCtaLabel: copy.shellCtaLabel,
      primaryHref: copy.primaryHref,
      secondaryHref: copy.secondaryHref,
      phoneLabel: copy.phoneLabel,
      telegramLabel: copy.telegramLabel,
      emailLabel: copy.emailLabel
    },
    {
      seoTitle: 'Страница не найдена — СМУ-1',
      seoDescription: 'Запрошенная страница не найдена. Перейдите на главную, к направлениям или свяжитесь с СМУ-1.',
      shellCtaLabel: 'Связаться',
      primaryHref: '/',
      secondaryHref: '/#directions',
      phoneLabel: 'Телефон',
      telegramLabel: 'Telegram',
      emailLabel: 'Email'
    }
  );

  assert.match(route, /title=\{copy\.seoTitle\}/u);
  assert.match(route, /description=\{copy\.seoDescription\}/u);
  assert.match(route, /headerCtaBinding=\{pageBinding\('shellCtaLabel'/u);
  assert.match(page, /href=\{withBase\(copy\.primaryHref\)\}/u);
  assert.match(page, /hrefPath: 'notFoundPage\.primaryHref'/u);
  assert.match(page, /href=\{withBase\(copy\.secondaryHref\)\}/u);
  assert.match(page, /hrefPath: 'notFoundPage\.secondaryHref'/u);
  assert.equal(getFieldCoverage('site-settings', 'notFoundPage.primaryHref').relationRole.kind, 'internal-route');
  assert.equal(getFieldCoverage('site-settings', 'notFoundPage.secondaryHref').relationRole.target, 'route-registry');
  assert.doesNotMatch(route, /title="Страница не найдена/u);
  assert.doesNotMatch(page, /<span>Телефон<\/span>/u);
});

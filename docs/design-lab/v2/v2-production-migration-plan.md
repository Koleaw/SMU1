# План переноса V2 в production

Дата аудита: 15 июля 2026 года. Этот документ описывает будущую отдельную migration-задачу. В текущей задаче production routes, templates, records, schemas, media, admin, deployment и GitHub Actions не изменяются.

Machine-readable source of truth: [`v2-production-migration-manifest.csv`](./v2-production-migration-manifest.csv). В нём ровно **110 строк** — по одной на каждый фактический public production route. Дополнительный V2 detail активной вакансии в эти 110 строк не включён.

## Состояние покрытия

| Состояние | Количество | Действие |
| --- | ---: | --- |
| Полноценный V2-аналог | 106 | 18 `replace` + 88 `dynamic-template` |
| Legacy alias | 3 | Реальный HTTP 301, без копии контента |
| Future production 404 | 1 | V2 presentation + реальный status 404 |
| Дополнительный V2 owner-decision | 1 | Detail активной вакансии; вне production manifest |

Разбивка 106 полноценных аналогов: home — 1; catalog sections — 2; другие основные направления — 5; categories — 20; products — 68; archive/details объектов — 5; company/contacts/vacancies archive/legal — 4; custom order — 1. Арифметика public production: `106 + 3 + 1 = 110`.

## Карта будущего переноса

### Replace: 18 самостоятельных страниц

- `/` → `HomeV2`.
- `/ulichnaya-mebel/`, `/ograzhdeniya-i-zabory/` → `CatalogSectionV2`.
- Пять остальных направлений → утверждённые `DirectionV2Layout`, `EngineeringDirectionV2Layout`, `PlaceDirectionV2Layout` и `ProjectDirectionV2Layout` с текущими V2 adapters.
- `/vypolnennye-obekty/` и четыре detail route → `ProjectsV2Archive` / `ProjectV2Page`.
- `/o-nas/`, `/kontakty/`, `/vakansii/`, `/politika-konfidencialnosti/` → practical V2 templates.
- `/izgotovlenie-na-zakaz/` → `CustomOrderV2Page` и `customOrderV2Data`.

Во всех случаях production URL и production canonical сохраняются. Design-lab prefix не переносится.

### Dynamic templates: 88 catalog routes

- 20 active categories → один pattern `CatalogCategoryV2` через `[section]/[category]/index.astro`.
- 68 active products → один pattern `CatalogProductV2` через `[section]/[category]/[product]/index.astro`.

Migration должна сохранить исходные collections, slugs и media paths. Генератор обязан повторно валидировать active state, parent category, duplicate slug/route, H1, canonical, related links и отсутствие public SKU.

### Redirects: 3 route-level blockers

| Alias | Target | Действие |
| --- | --- | --- |
| `/lavochki-i-skameyki/` | `/ulichnaya-mebel/lavochki-i-skameyki/` | HTTP 301, один hop |
| `/urny/` | `/ulichnaya-mebel/urny/` | HTTP 301, один hop |
| `/navesy/` | `/navesy-i-kozyrki/` | HTTP 301; удалить self-canonical/meta-refresh document вместе с заменой route |

Блокирующая зависимость — подтверждённый routing/deployment mechanism для настоящих 301. До её решения нельзя считать migration полностью готовой. Отдельные V2 content pages для aliases создавать не нужно.

### 404

`/design-lab/v2/404/` — только visual specimen. Будущий production error document должен возвращать реальный HTTP 404, иметь `noindex`, отсутствовать в sitemap и не иметь canonical на несуществующий URL. Автоматический redirect не нужен.

### Vacancy detail: owner/architecture decision

Сейчас дополнительный route `/design-lab/v2/vakansii/svarshchik-metallokonstruktsiy/` не имеет самостоятельного production URL и использует canonical `/vakansii/`. До migration владелец должен решить, нужен ли public detail.

Рекомендуемый pattern при положительном решении: `/vakansii/{slug}/`; canonical — тот же detail URL; archive должен ссылаться на detail. При отрицательном решении archive сохраняет текущий production URL, а V2 detail остаётся design specimen и не переносится. Production URL в текущей задаче не создавался.

## SEO и link migration

Текущие 108 V2 routes изолированы: `noindex`, `nofollow`, production canonical и sitemap exclusion; исключение — 404 specimen без canonical. Перед production release нельзя переносить design-lab robots/canonical policy механически:

1. убрать `noindex, nofollow` с обычных production pages;
2. оставить self-canonical на 106 сохранённых production URL;
3. не ставить canonical на 404;
4. aliases отдавать 301, не HTML-копию;
5. включить canonical pages в production sitemap по существующей policy;
6. повторить полный link crawl после замены prefix.

Текущий статический и browser audit: V2 → old category links — 0; V2 → old product links — 0; V2 → legacy routes — 0; V2 → отсутствующие routes — 0; empty href/broken anchors/invalid canonical — 0. После появления custom-order V2 все подходящие V2 Header/Footer/CTA ведут на него. Production navigation не менялась.

## Data preservation

Автоматическая сверка подтверждает отображение текущих публичных полей: section/category/product titles, price/price mode, descriptions, specifications, materials, colors, customization, delivery, galleries, active states, projects, contacts, requisites, vacancy data и privacy text. Пустые поля скрываются; SKU, admin metadata, inactive records и placeholder media не являются обязательным public output.

Известные data/media gaps не блокируют шаблоны:

- 8 active sparse categories без active products; у двух из них нет пригодного category media — используется общий честный text/graphic fallback;
- 3 active products без media — используется zero-media state без стрелок, thumbnails и `0/0`;
- один project detail и один связанный direction example остаются text-only;
- эти gaps не исправляются изменением records или подстановкой чужих изображений.

## Media preservation

Production media paths, desktop/mobile hero video и posters сохраняются. Проверка Git не обнаружила removed, renamed, copied или overwritten media. V2 использует только существующие repository assets; внешние stock/generated additions и публичные кадры внутреннего производства отсутствуют. Yandex map в contacts использует существующий production Constructor mechanism и текущую конфигурацию, без нового SDK/API key.

## Порядок отдельной migration-задачи

1. Зафиксировать design-lab baseline отдельным review-коммитом после ручной проверки состава; текущая задача не выполняет `git add`/commit.
2. Решить routing blocker для трёх HTTP 301 и owner decision по vacancy detail.
3. Перенести общую V2 shell/accessibility/motion систему без design-lab SEO isolation.
4. Заменить 18 самостоятельных templates, сохранив URLs и current data sources.
5. Подключить два dynamic catalog patterns для 20/68 records.
6. Настроить production 404 response и три redirects.
7. Выполнить fresh check/build, 110-route manifest crawl, SEO/link/data/media parity и representative Browser QA.
8. Только после приёмки переключать production; rollback должен восстанавливать прежние templates без изменения records/media.

## Git inventory и границы будущего коммита

Финальный рабочий снимок:

```text
 M astro.config.mjs
?? docs/design-lab/
?? src/components/design-lab/
?? src/layouts/DesignLabLayout.astro
?? src/pages/design-lab/
?? src/styles/design-lab.css
?? src/styles/design-lab/
```

- tracked modified: **1**; staged: **0**;
- untracked files: **356**; из них текущий V2 scope — **221** (`105` source + `116` docs/QA), V2 PNG — **89**;
- ignored: **94** свёрнутых status entries, или **14 610** отдельных файлов (`14 078` dependencies, `516` build output, `5` `.astro` files и `11` root logs).

V2-код и документы остаются untracked. Перед отдельной migration необходимо явно просмотреть и добавить в отдельный design-lab baseline:

- `src/components/design-lab/**`, `src/pages/design-lab/**`, `src/styles/design-lab*`, `src/layouts/DesignLabLayout.astro`;
- актуальные review/matrix/manifest/policy `.md` и `.csv`;
- QA generators/audits `.mjs`;
- обязательные approval screenshots в `docs/design-lab/v2/`.

Не должны попадать в production migration commit: `dist/**`, `.astro/**`, `node_modules/**`, logs, временные browser profiles/ports и прочий ignored output. `browser-pre-migration-v2-report.json` — воспроизводимый QA output; хранить его только как review artifact, если это отдельно принято. Исторические `docs/design-lab/pilot`, `prototypes` и архивы нельзя автоматически добавлять вместе с V2.

Единственный исходно tracked modified file — `astro.config.mjs` с sitemap exclusion для `/design-lab/`; его следует рассматривать отдельно как design-lab isolation change. Git index не изменялся, commit/push не выполнялись.

## Acceptance gate

До production migration остаются **3 route-level blockers** (настоящие 301) и **1 owner decision** (vacancy detail). 404 status configuration — обязательный migration step, но specimen готов. Текущие V2 layouts/data adapters, 106 analogs и 110-row manifest готовы как проектный baseline; это не является разрешением на production migration.

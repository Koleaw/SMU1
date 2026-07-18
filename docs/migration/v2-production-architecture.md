# Архитектура production migration V2

## Цель и границы

Миграция переводит существующие публичные URL на утверждённые V2-renderers, не меняя владельцев данных. `src/data/**`, схемы, slugs, media paths, админка и формат import/export остаются каноническими. Design-lab сохраняется до приёмки как reference implementation, но production и design-lab используют один код компонентов, а не две развивающиеся копии.

Не входят в миграцию: изменение фактического контента, реорганизация media, редизайн админки, смена hosting/deployment и удаление прежнего production-кода.

## Целевой shared-слой

Утверждённые компоненты переносятся из namespace `src/components/design-lab/**` в `src/components/v2/**` с группировкой по назначению:

- `shell`: Header, desktop dropdowns, MobileMenu, Footer, breadcrumbs, direct-contact/CTA;
- `home`: главная, hero, карта компетенций и teaser объектов;
- `catalog`: `CatalogSectionV2`, `CatalogCategoryV2`, `CatalogProductV2`, cards, sparse state и product gallery;
- `directions`: общая инфраструктура и специализированные композиции направлений;
- `projects`: архив, карточка, detail renderer, proof/meta/gallery;
- `practical`: компания, контакты и Yandex map, вакансии, vacancy detail, политика;
- `custom-order` и `not-found`;
- presentation adapters для media, routes и данных.

Стили компонентов переходят в `src/styles/v2/**`. Design-system specimens и palette comparison остаются в `src/components/design-lab/**` и `src/styles/design-lab/**`: это лабораторный слой, не production dependency.

Общий production-layout должен сохранить важные обязанности текущего `BaseLayout`: метаданные, существующий structured data, Yandex Metrika и CookieBanner. V2 shell подключается поверх этого контракта. Старый `BaseLayout` и прежние production-компоненты не удаляются до приёмки; после переключения routes они служат rollback reference и не участвуют в основном render path.

## Scope-aware rendering

Shared renderers получают явный scope: `production` или `design-lab`. Один route resolver строит ссылки из канонического production path:

- в production возвращает production URL без `/design-lab/`;
- в design-lab возвращает соответствующий reference URL;
- не меняет `tel:`, `mailto:`, Telegram и внешние URL;
- не допускает hardcoded design-lab links в production HTML.

Production использует только палитру Olive. Palette switch, design-lab label и query/local-storage logic палитр доступны только при scope `design-lab`. Корень production breadcrumbs — «Главная»; лабораторный корень может сохранять reference-навигацию.

SEO также задаётся scope, а не копируется по страницам:

- production canonical pages: `index, follow`, self-canonical;
- design-lab: `noindex, nofollow`, canonical на соответствующий production URL, исключение из sitemap;
- production 404: `noindex`, без canonical, отдельный `404.html`;
- legacy aliases: `noindex`, canonical на target и исключение из sitemap.

Репозиторий не подтверждает фактическую production-платформу и её серверные redirect/error-document capabilities. Workflow `.github/workflows/deploy.yml` публикует в GitHub Pages только сборки с `deploy_kind == 'test'`; ветка `production` в этом workflow выполняет проверки и build, но не содержит шага публикации. Поэтому `/lavochki-i-skameyki/`, `/urny/` и `/navesy/` реализуются на уровне Astro как честно документированные static compatibility pages: сгенерированный HTML отдаётся обычным static server с HTTP 200, содержит meta/client redirect, доступную ссылку и canonical target. Это не HTTP 301. Настоящие permanent redirects и поведение неизвестного URL должны быть отдельно проверены на фактическом production hosting до публикации.

## Route architecture

Существующее владение route-файлами сохраняется, чтобы не создавать коллизии Astro. Route-файлы становятся тонкими adapters: выбирают запись, вычисляют canonical/current state и передают данные shared renderer.

Используются текущие data-driven patterns:

- catalog sections — существующие section index routes;
- categories — существующие `[section]/[slug]` и `ulichnaya-mebel/[slug]` patterns;
- products — `[section]/[category]/[product]`;
- projects — `/vypolnennye-obekty/` и `/vypolnennye-obekty/[slug]/`;
- vacancy archive и production detail pattern `/vakansii/[slug]/` для active records;
- пять service/direction routes — общие или специализированные V2 direction renderers, выбранные по данным;
- practical pages, custom order, 404 и aliases — явные тонкие routes.

Design-lab route-файлы временно остаются wrappers над теми же shared renderers со scope `design-lab`. Они не копируют layout или page composition. Специфические system-a/b/c specimens остаются изолированными и не становятся частью production routing.

## Что заменяется в production

Production routes последовательно отключаются от прежних `Header`, `Footer`, catalog cards/templates, project renderers и practical-page markup и подключаются к shared V2. Старые компоненты не редактируются ради визуального соответствия и не удаляются: это уменьшает rollback surface. После переключения ни одна production карточка, breadcrumb, CTA, related link или navigation item не должна вести в design-lab либо на отдельную старую template copy.

Production navigation сохраняет существующие публичные URL и фактические записи, но её renderer становится V2 shell. `src/utils/v2Navigation.ts` читает существующий `navigation.json`, а `src/utils/v2Directions.ts` — active direction records; порядок, видимость и active state вычисляются presentation/route adapters. `navigation.json` и site settings не меняются.

## Data, admin и media compatibility

Все shared adapters являются read-only presentation layer. Они нормализуют заполненные поля для вывода, скрывают пустые значения и публичный SKU, но не переписывают records. Catalog renderer продолжает читать title, description, price mode/price, specifications, materials, colors, customization, delivery, galleries, active/showInCatalog/showInSectionGrid и related data. Project, contact, requisites, vacancy, navigation и legal data также берутся из существующих источников.

Для уже утверждённой V2-редакции home, company, custom order и специализированных direction pages используется ограниченный паттерн «approved until edited». Adapter сравнивает текущее поле с известным pre-migration значением: пока запись не редактировалась, показывается утверждённая V2-формулировка; после фактического изменения через данные выводится новое значение record. Это presentation mapping, а не второе хранилище и не запись обратно в JSON. Аналогично media-role adapters сохраняют утверждённую публичную выборку, но переходят к пригодным текущим record media, если администратор заменил исходные paths.

Совместимость не означает универсальный вывод каждого произвольного legacy `pageBlocks` в любой V2-композиции. Намеренно не переносятся технические, процессные и стоимостные блоки, противоречащие утверждённому публичному scope, а также произвольный порядок/тип блоков, для которого нет V2-renderer. Placeholder media, кадры внутреннего производства и иные небезопасные presentation assets не выдаются за публичные изображения; сами поля и файлы не удаляются. Точное покрытие редактируемых полей и это ограничение фиксируются в admin compatibility report.

Admin API, schemas и import/export остаются без изменений. Совместимость проверяется в изолированной временной копии данных: read, edit/export/import/compare без сохранения тестовых изменений в production records и без вызова publish из рабочей Git-копии. Известное ограничение visual editor для `about.pageBlocks[].textWidth` документируется, а не маскируется изменением данных.

Media adapters выбирают только разрешённые публичные кадры для конкретной композиции. Они не удаляют, не копируют, не переименовывают и не транскодируют файлы, не меняют references в records. Desktop/mobile hero video и все production paths сохраняются. Zero-media и text-only состояния формируются компонентами без фиктивных изображений.

## Порядок переключения и rollback

После checkpoint shared-слой выделяется один раз, затем подключаются shell, home, catalog, directions, projects, practical pages, 404 и aliases. На каждом этапе routes остаются data-driven. Финальный switch подтверждается route/link/SEO/media/admin audits, `npm run check`, `npm run build` и последовательным browser QA.

Checkpoint commit остаётся неизменной точкой отката. До приёмки нельзя удалять design-lab, прежние production components, migration documents или media baseline. Rollback выполняется переключением на checkpoint/предыдущую ветку, а не ручным восстановлением файлов.

# Отчёт о production migration V2

Дата финальной проверки: 16 июля 2026 года. Миграция выполнена локально; push, deployment и публикация не выполнялись. Hash итогового migration commit указывается в финальной передаче результата: commit не может надёжно содержать собственный hash. После создания commit его можно получить командой `git log --grep="^feat: migrate public site to v2 design system$" -1 --format=%H`.

## 1. Ветка и safety checkpoint

- Рабочая ветка: `v2-production-migration`.
- Checkpoint: `0d5fc8ff0ae0d5c05636fa97647b0a30327b15b6` (`chore: checkpoint v2 design system before production migration`).
- Checkpoint содержит V2 source, layout/styles, sitemap isolation и обязательные design-lab документы. 89 QA PNG общей массой около 91,1 MiB в него намеренно не добавлялись.
- Checkpoint является неизменяемой точкой возврата: в нём сохранены прежний production render path и полностью собранная design-lab V2.
- Итоговый migration commit создаётся с сообщением `feat: migrate public site to v2 design system`; точный hash приводится в финальной передаче и определяется указанной выше командой.

## 2. Изменённые production-файлы

Production routes переведены на shared V2 через тонкие adapters:

- `src/pages/index.astro`, `src/pages/[slug].astro`;
- `src/pages/ulichnaya-mebel/index.astro`, `src/pages/ulichnaya-mebel/[slug].astro`;
- `src/pages/[section]/[slug].astro`, `src/pages/[section]/[category]/[product].astro`;
- `src/pages/vypolnennye-obekty/index.astro`, `src/pages/vypolnennye-obekty/[slug].astro`;
- `src/pages/kontakty.astro`, `src/pages/vakansii.astro`, новый `src/pages/vakansii/[slug].astro`;
- `src/pages/politika-konfidencialnosti/index.astro`, `src/pages/izgotovlenie-na-zakaz.astro`, `src/pages/404.astro`;
- compatibility routes `src/pages/lavochki-i-skameyki.astro`, `src/pages/urny.astro`, `src/pages/navesy/index.astro`;
- `astro.config.mjs` — production sitemap filters для design-lab, admin/API, aliases и 404.

Общий слой расположен в `src/layouts/PublicV2Layout.astro`, `src/components/v2/**`, `src/styles/v2/**`, а также в `src/utils/v2Routes.ts`, `v2Navigation.ts`, `v2Directions.ts` и `v2SiteSettings.ts`. Design-lab wrappers обновлены на те же shared renderers. Старые `BaseLayout` и production-компоненты не удалены: они остаются rollback reference, но не участвуют в основном production render path. Generated `dist/**` не является migration source и не должен попадать в commit.

## 3. Перенесённые templates

В shared-слой вынесены Header, dropdowns, MobileMenu, Footer, breadcrumbs, direct contacts и CTA; home; catalog section/category/product; cards, sparse state и gallery; пять специализированных direction compositions; archive/detail проектов и fullscreen gallery; company, contacts/Yandex map, vacancies, privacy; custom order; 404 и legacy fallback.

Production и design-lab получают явный scope. Один resolver строит production URL либо reference URL, не меняя `tel:`, `mailto:`, Telegram и внешние адреса. Production использует только Olive, без palette switch, V2 labels и `/design-lab/`-ссылок. Records остаются владельцами фактических данных; route-файлы только выбирают запись и renderer.

Home, company, custom order и специализированные direction pages используют ограниченные read-only adapters «approved until edited»: неизменённое pre-migration значение отображается в утверждённой V2-редакции, а после фактического изменения через record выводится новое значение. Навигация, active/show flags, контакты, каталог, проекты и вакансии читаются из существующих источников. Это не означает универсальный вывод всех legacy `pageBlocks`: технические, процессные, стоимостные и произвольные неподдерживаемые блоки намеренно не включены в публичную V2-композицию; placeholder/unsafe media и кадры внутреннего производства исключены из presentation, но данные и файлы не удалены.

## 4. Покрытие production routes и build

Фактическое покрытие после положительного решения по vacancy detail:

| Группа | Количество |
| --- | ---: |
| Canonical production routes | 107 |
| Static compatibility aliases | 3 |
| Production 404 document | 1 |
| Всего проверенных production routes | 111 |
| Всего HTML pages в build | 227 |

В 227 build pages входят 111 production artifacts, 108 V2 reference routes, 3 других design-lab specimens и 5 admin pages. Canonical routes и три aliases проверяются локально как HTTP 200. Сборка содержит `/404.html`; локальный QA harness дополнительно может отдать его body со статусом 404 для отсутствующего URL. Это подтверждает корректность artifact и локального сценария, но не доказывает unknown-route/status behavior фактического production hosting.

Автоматическая сверка: `docs/migration/v2-production-route-audit.csv`; route/data/SEO issues — 0.

## 5. Каталог

- Active categories: **20/20**.
- Active/show-in-catalog products: **68/68**.
- Используются общие data-driven patterns для section, category и product, а не отдельные файлы для 68 товаров.
- Сохранены title, description, price/price mode, features, specifications, materials, colors, customization, delivery, gallery, visibility, related products и custom-order/direct-contact data.
- Пустые блоки скрываются; SKU не выводится публично и не удалён из records/schema.
- Проверены media-rich, one-image, zero-media, portrait, long-title, specifications-heavy, sparse и no-category-media states. Product/category/related links ведут только на production V2-rendered URL.

## 6. Выполненные объекты

Покрыты архив и **4/4 active project detail routes**. Архив сохраняет равноправную сетку: три media-rich карточки и один text-only проект без placeholder. Detail renderer выводит только фактические поля, gallery при наличии, related directions, previous/next и контакты.

Публичные presentation selections сохранены: набережная — 3 кадра; производственная территория — 10 выбранных внешних кадров; городские качели — 4 кадра с finished external cover; сквер — text-only. Неиспользованные media не удалялись из records или filesystem. Fullscreen galleries прошли contain, arrows/counter, thumbnails, Escape, focus trap, return focus, horizontal swipe при сохранённом vertical scroll и reduced-motion.

## 7. Практические страницы

На V2 production shell переведены `/o-nas/`, `/kontakty/`, `/vakansii/` и `/politika-konfidencialnosti/`. Компания использует утверждённый H1 и только внешние готовые объекты. Контакты читают существующие телефоны, Telegram, email, адрес и реквизиты; карта использует прежний Yandex Constructor ID из `src/data/yandex.json`, имеет title и ссылку открытия в Яндекс Картах. Юридический текст сохранён полностью; автоматическая нормализованная сверка с checkpoint прошла.

Архив вакансий фильтрует только active records. Новые зарплаты, условия, услуги, категории, товары или проекты не создавались.

## 8. «Изготовление под задачу объекта»

Route `/izgotovlenie-na-zakaz/` переведён на утверждённую самостоятельную композицию. Она использует существующие данные/контакты и media adapters: compact hero, 7 подтверждённых параметров изменения, ссылки на все 7 направлений, 6 видов исходных материалов, 3 реальных примера и финальный телефон/Telegram/email. Формы, callback, новые media и изображения внутреннего производства отсутствуют.

## 9. Решение по vacancy detail

Принято положительное архитектурное решение: active-вакансия имеет production route `/vakansii/svarshchik-metallokonstruktsiy/` через pattern `/vakansii/[slug]/`. Страница отвечает HTTP 200, имеет self-canonical, `index, follow`, breadcrumbs и фактические обязанности, требования, условия и контакты. Archive ведёт на detail. Production URL не добавлялся в record и slug записи не менялся.

## 10. Production 404

`src/pages/404.astro` формирует `/404.html` с H1 «Страница не найдена», ссылками на главную и направления и существующими контактами. Страница имеет `noindex, nofollow`, исключена из sitemap и не содержит canonical либо auto redirect. Локальный QA server проверяет сценарий, в котором unknown URL получает status 404 и body этого artifact. Репозиторий сам по себе не подтверждает, что фактический production hosting настроен на такое же error-document behavior; это обязательная отдельная проверка перед публикацией.

## 11. Legacy routes и ограничение hosting

Фактический production hosting и его server-side redirect capabilities из репозитория не определяются. Workflow `.github/workflows/deploy.yml` публикует в GitHub Pages только `deploy_kind == 'test'`; production-ветка workflow выполняет check/build без шага публикации. Поэтому на уровне текущей Astro-сборки реализованы честные static compatibility pages:

| Alias | Target | Фактическое поведение |
| --- | --- | --- |
| `/lavochki-i-skameyki/` | `/ulichnaya-mebel/lavochki-i-skameyki/` | HTTP 200, target canonical, `noindex`, meta/client redirect и доступная ссылка |
| `/urny/` | `/ulichnaya-mebel/urny/` | HTTP 200, target canonical, `noindex`, meta/client redirect и доступная ссылка |
| `/navesy/` | `/navesy-i-kozyrki/` | HTTP 200, target canonical, `noindex`, meta/client redirect и доступная ссылка |

Это **не HTTP 301**: при обычной статической раздаче alias HTML получает HTTP 200. Aliases исключены из sitemap, а внутренние production links ведут сразу на canonical targets. Настоящие permanent redirects возможны только после проверки и отдельной настройки фактического hosting/edge layer.

## 12. SEO

Все 107 canonical production pages имеют `index, follow` и self-canonical. Design-lab остаётся `noindex, nofollow`, с production canonical и без участия в production navigation. Aliases имеют `noindex` и canonical target. 404 имеет `noindex` без canonical. Проверены title, description, единственный непустой H1, robots, canonical, отсутствие public SKU, design-lab labels/links и duplicate canonical routes. Существующие structured data, Yandex Metrika и CookieBanner сохранены в `PublicV2Layout`.

## 13. Sitemap

Sitemap содержит ровно **107 canonical production URLs**, включая новый vacancy detail. Из него исключены design-lab, admin/API, 404 и три aliases. Проверка не обнаружила отсутствующих canonical routes, лишних routes или design-lab URL. Фильтрация зафиксирована в `astro.config.mjs`.

## 14. Admin и import/export compatibility

`npm run test:admin-import` завершился результатом **19/19 tests passed**. Дополнительно `node tools/migration/admin-roundtrip.mjs` выполнил изолированный двух-sandbox round-trip: read → тестовые изменения текста, существующей media reference, `isActive`, `showInCatalog`, project data и site settings → preview/apply → export → import во вторую копию → повторный export/compare. Нормализованные exports совпали, тестовые поля сохранились, `/publish` не вызывался, live hashes content/data/media до и после совпали.

Admin routes, API, schemas и import/export format не менялись. Record-driven coverage и границы presentation adapters перечислены в отдельном отчёте: round-trip подтверждает data/API, но не универсальный визуальный вывод произвольных legacy blocks. Известен прежний gap visual editor: recursive `stripPresentationFields()` может удалить schema-backed `about.pageBlocks[].textWidth`. До отдельного узкого исправления нельзя сохранять `o-nas` через visual editor; нужен regression test. Live visual save, upload нового media и publish намеренно не запускались. Подробности: `docs/migration/v2-admin-compatibility-report.md`.

## 15. Сохранность media

SHA-256 manifest покрывает **332 paths** (331 media-файл и служебный `.gitkeep`). Сравнение baseline/final: unchanged 332; removed 0; renamed 0; overwritten 0; unexpected copied/added 0. Production paths сохранены, транскодирование не выполнялось.

- Desktop hero video: 26 073 769 bytes, SHA-256 `13341bc4a23614d634a7e6ead6e69207006ad3433231021bd8cc158ed6b8efb0`.
- Mobile hero video: 5 627 976 bytes, SHA-256 `44e4019da504b46a7231136d1d7b91143eed280567059b6d4f5396d706c01117`.

Внешние stock/generated assets не добавлялись. В публичных V2 selections исключены внутренние помещения, оборудование и производственные операции. Полный результат: `docs/migration/v2-production-media-audit.csv`.

## 16. Проверки и Browser QA

Финальный последовательный gate пройден после последних source-изменений:

- `npm run check`: pass, 0 errors; 33 существующих hints;
- `npm run build`: pass, 227 pages;
- route/link/SEO audit: 111 production artifacts, 107 canonical routes, 9 099 внутренних ссылок, issues 0;
- один Chromium, один context/page: HTTP 200 для всех 111 перечисленных production artifacts и 168 representative diagnostics (24 routes × 7 режимов: 1440, 1280, 1024, 768, 390, 320 и 200% reflow);
- Header scroll state, dropdown, MobileMenu/focus return, Footer, contacts/map, desktop/mobile hero videos, lazy media, product/project fullscreen galleries, focus trap, Escape, return focus, swipe и reduced motion: pass;
- runtime/console errors, horizontal overflow, duplicate IDs, broken images, empty href и unlabeled controls: 0;
- 11 обязательных proof screenshots перегенерированы в `docs/migration/screenshots/` и непусты;
- QA server, Chromium, capture Node process, temporary profile и порт закрыты; остаточных QA-процессов/профилей/listeners — 0.

Машинные доказательства: `docs/migration/v2-production-link-audit.csv` и `docs/migration/browser-production-qa.json`. Отдельного `browser-production-capture.json` в наборе доказательств нет.

## 17. Известные content и media gaps

Эти gaps происходят из текущих records, честно отображаются общими fallback states и не блокируют migration:

- 8 active fence categories не имеют active products;
- категории `dekorativnye-ograzhdeniya` и `stolbiki-i-bollardy` не имеют пригодного category media;
- товары `konteynernaya-ploshchadka-duo`, `konteynernaya-ploshchadka-modul`, `konteynernaya-ploshchadka-zakrytaya` не имеют изображений;
- у topiary есть один уникальный visual, но нет отдельных media форм, товаров, gallery или подтверждённых проектов;
- для canopies нет пригодного section hero и подтверждённого выполненного объекта; используются фактические catalog images;
- проект сквера остаётся text-only: оба placeholder исключены;
- часть media-rich project records содержит больше разрешённых файлов, чем входит в утверждённую публичную selection; файлы и references сохранены.

Чужие изображения, фиктивные продукты и придуманные характеристики для заполнения gaps не использовались.

## 18. Owner decisions и blockers

Критических технических blockers для локального migration commit не осталось. До публикации владелец должен:

1. Визуально принять 11 proof screenshots и выборки project media.
2. Определить фактический production hosting и финальный домен, затем задать обязательный `SITE_URL`/`BASE_PATH` и проверить canonical, robots, sitemap и unknown-route status уже на этом окружении. Локальная development-сборка закономерно использует `http://localhost:4321` и не является SEO-доказательством финального домена.
3. Решить, достаточно ли static HTTP 200 alias fallback, либо отдельно внедрять hosting/edge mechanism для настоящих 301.
4. Заказать отдельное исправление visual editor для `pageBlocks[].textWidth` до редактирования страницы «О компании» через admin.
5. По мере появления фактических материалов заполнить перечисленные media/content gaps через существующие records/admin; это не требует изменения renderer.
6. После приёмки отдельно решить срок удаления design-lab и rollback reference components. Их удаление не входит в эту migration.

Deployment readiness не означает deployment authorization: push и GitHub Pages publish в рамках задачи запрещены.

## 19. Rollback procedure

Команды ниже документированы, но в ходе migration не выполнялись. Сначала создать постоянную ссылку на checkpoint:

```powershell
git branch v2-design-checkpoint 0d5fc8ff0ae0d5c05636fa97647b0a30327b15b6
```

Открыть предыдущее production-состояние вместе с checkpoint V2 в новой безопасной ветке:

```powershell
git switch -c v2-production-rollback 0d5fc8ff0ae0d5c05636fa97647b0a30327b15b6
```

Вернуться к migration branch:

```powershell
git switch v2-production-migration
```

Удалить migration branch, не теряя checkpoint, можно только после создания `v2-design-checkpoint` и переключения на другую ветку:

```powershell
git branch v2-design-checkpoint 0d5fc8ff0ae0d5c05636fa97647b0a30327b15b6
git switch main
git branch -D v2-production-migration
```

Повторно открыть удалённую migration branch по hash из финальной передачи результата:

```powershell
$migrationCommit = git log --all --grep="^feat: migrate public site to v2 design system$" -1 --format=%H
git switch -c v2-production-migration $migrationCommit
```

Перед любой командой переключения необходимо сохранить или убрать отдельно появившиеся пользовательские изменения. `git reset --hard` и ручное восстановление records/media для rollback не требуются.

## 20. Что нельзя удалять до приёмки

- commit `0d5fc8ff0ae0d5c05636fa97647b0a30327b15b6` и ветку `v2-production-migration`;
- `src/pages/design-lab/**`, design-lab документы и reference specimens;
- прежний `BaseLayout`, старые production components/styles, пока rollback не принят;
- `src/components/v2/**`, `src/styles/v2/**`, `src/layouts/PublicV2Layout.astro`, route resolver и production route adapters;
- `src/content/**`, `src/data/**`, schemas, admin/API, import/export и все существующие media;
- `tools/migration/**`, route/link/media/admin audit results и media baseline;
- `docs/migration/screenshots/**`, architecture/admin reports и этот migration report.

В migration commit не должны попадать `dist`, `.astro`, `node_modules`, logs, browser profiles, runtime output, pilot/prototype archives и случайные design-lab screenshots. До отдельной приёмки нельзя удалять design-lab, hero videos, media adapter mappings или исходные project media только потому, что они не входят в текущую публичную selection.

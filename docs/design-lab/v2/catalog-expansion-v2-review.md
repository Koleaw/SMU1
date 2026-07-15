# Распространение каталога V2 — review

Дата проверки: 15 июля 2026 года.

## Охват и маршруты

Фактические collections содержат **20 active/published categories** и **68 active products**, доступных в публичном каталоге. До этого этапа V2 покрывал 10 категорий и 4 товара. Добавлено **10 новых V2 category routes** и **64 новых V2 product routes**; итоговое покрытие — 20/20 и 68/68.

Маршруты строятся двумя общими Astro patterns, без десятков ручных файлов:

- `src/pages/design-lab/v2/[section]/[category]/index.astro` → `CatalogCategoryV2`;
- `src/pages/design-lab/v2/[section]/[category]/[product]/index.astro` → `CatalogProductV2`.

Оба используют существующий `catalogV2Data.ts`, точные production slugs и records. Каждый V2 route имеет production canonical, `noindex, nofollow` и исключён из sitemap. Production records, slugs, schemas и templates не менялись.

## Поведение templates

Утверждённые `CatalogSectionV2`, `CatalogCategoryV2`, `CatalogProductV2`, `V2CategoryCard`, `V2ProductGallery`, `V2DirectContact` и sparse state сохранены. Category pages выводят H1/description/media из record, только active products, V2 breadcrumbs/CTA/links и возврат в соответствующий V2 section.

Product pages показывают только заполненные record-блоки: summary, price mode/price, gallery, description, адаптивные `dl`/lists/text для характеристик, материалы, покрытия, изменения, доставку, related products и прямые контакты. Пустые секции скрыты; публичный SKU отсутствует. Related products ограничены явными связями record либо той же категорией, исключают текущий и inactive product и всегда ведут на V2.

Media adapter поддерживает zero/single/multiple/portrait/landscape media, thumbnails и fullscreen. Placeholder paths отфильтрованы и не выдаются за реальные фото. При отсутствии media используется честный текстово-графический fallback без arrows, thumbnails и `0/0`.

## Sparse, media и data gaps

Восьми категориям ограждений сейчас не назначены active products; они используют общий `V2CatalogSparseState`, фактические category descriptions/media, существующие контакты и возврат к разделу. Фиктивные товары не создавались.

Две active categories не имеют пригодного category media: `dekorativnye-ograzhdeniya` и `stolbiki-i-bollardy`. Три active products не имеют изображений: `konteynernaya-ploshchadka-duo`, `konteynernaya-ploshchadka-modul`, `konteynernaya-ploshchadka-zakrytaya`. Для них используется zero-media fallback; изображения другого типа продукции не подставляются.

Автоматическая сверка не обнаружила orphan products, products без active category, duplicate slugs/routes, missing/extra V2 routes, broken canonicals, пустые H1, inactive cards, placeholder/broken media или противоречия route ownership. Эти содержательные media gaps зафиксированы, но records не исправлялись и данные не выдумывались.

## Устранённые старые ссылки

Header, MobileMenu, Footer, home V2, catalog sections, category/product cards, related products, direction/company/project pages проверены относительно полного production catalog route set. Ссылки V2 → old category pages и V2 → old product pages равны **0**. В частности, related link направления навесов теперь ведёт на `/design-lab/v2/ulichnaya-mebel/navesy/`, а все cards используют общий V2 route map.

Production-only ссылки остались только у страниц без V2-аналога, прежде всего `/izgotovlenie-na-zakaz/`, как разрешено заданием. Redirects не создавались.

## Representative visual QA

Категории:

- filled/many — `/design-lab/v2/ulichnaya-mebel/lavochki-i-skameyki/`;
- filled/one — `/design-lab/v2/ulichnaya-mebel/stoly-i-komplekty/`;
- sparse with media — `/design-lab/v2/ograzhdeniya-i-zabory/zabory/`;
- no media — `/design-lab/v2/ograzhdeniya-i-zabory/dekorativnye-ograzhdeniya/`;
- long H1 — `/design-lab/v2/ulichnaya-mebel/vazony-i-tsvetochnitsy/`.

Товары:

- media-rich/multiple/related — `kacheli/kachel-portal`;
- single-image/minimal — `lavochki-i-skameyki/skamya-smu1-bazovaya`;
- zero-media/long name — `ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-zakrytaya`;
- many specifications — `lavochki-i-skameyki/bolshaya-skameyka-amplituda`;
- portrait media — `ulichnoe-osveshchenie/fonar-prizma`.

Один последовательный Chromium проверил эти pages на 1440, 1280, 1024, 768, 390 и 320 px, плюс 200% reflow. Для всех representative cases page overflow = 0. Все 88 generated category/product routes дали HTTP 200 и прошли проверки H1, canonical, robots, internal links, media, duplicate IDs, controls, console и public SKU. Product и project galleries прошли `contain`, arrows/counter, fullscreen, focus trap, Escape/return focus, swipe и reduced motion.

Screenshots: `catalog-expansion-category-filled-{desktop,mobile}.png`, `catalog-expansion-category-sparse-desktop.png`, `catalog-expansion-product-media-{desktop,mobile}.png`, `catalog-expansion-product-zero-media-{desktop,mobile}.png`, `catalog-expansion-product-fullscreen.png`.

`npm run check` — 0 errors/0 warnings (34 информационных hints). `npm run build` — успешно, 224 pages. Автоматическая сверка: production public routes 110, V2 routes 106, category/product gaps 0/0, sitemap isolation сохранена.

Изменения ограничены design-lab V2 и документацией. Production routes/templates/content records, schemas, navigation/site settings, admin/import/export, packages/deployment и существующие media не менялись; media removed/renamed/copied: 0.

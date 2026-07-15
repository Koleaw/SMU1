# Ограждения и заборы — V2 review

## Фактический охват

По текущим content records раздел содержит 9 активных категорий и 3 товара с `isActive: true` + `showInCatalog: true`. Порядок категорий сохранён из данных. Новые записи, slugs и media не создавались.

Созданы data-driven V2-маршруты:

- `/design-lab/v2/ograzhdeniya-i-zabory/`
- `/design-lab/v2/ograzhdeniya-i-zabory/zabory/`
- `/design-lab/v2/ograzhdeniya-i-zabory/vorota/`
- `/design-lab/v2/ograzhdeniya-i-zabory/kalitki/`
- `/design-lab/v2/ograzhdeniya-i-zabory/sekcionnye-ograzhdeniya/`
- `/design-lab/v2/ograzhdeniya-i-zabory/dekorativnye-ograzhdeniya/`
- `/design-lab/v2/ograzhdeniya-i-zabory/gazonnye-ograzhdeniya/`
- `/design-lab/v2/ograzhdeniya-i-zabory/perila-i-poruchni/`
- `/design-lab/v2/ograzhdeniya-i-zabory/stolbiki-i-bollardy/`
- `/design-lab/v2/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/`
- `/design-lab/v2/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-modul/`
- `/design-lab/v2/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-zakrytaya/`
- `/design-lab/v2/ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/konteynernaya-ploshchadka-duo/`

## Реализация

Переиспользованы `CatalogV2Layout`, общие Header/MobileMenu/Footer, `V2Breadcrumbs`, `V2CatalogHero`, `V2CategoryCard`, `V2ProductCard`, `V2ProductGallery`, `V2DirectContact`, CTA-система, palette/motion tokens и renderer характеристик. Отдельных fence-копий этих компонентов нет.

Общие `CatalogSectionV2`, `CatalogCategoryV2` и `CatalogProductV2` расширены картой V2-ссылок, реальными счётчиками и нейтральными текстами, пригодными для других разделов. `CatalogV2Layout` передаёт тип страницы для корректного CTA footer. `V2CategoryCard` различает состояния `products`, `sparse` и `minimal`. `V2DirectContact` допускает один CTA без дублирования. `V2ProductGallery` получил общий zero-media fallback и корректное однокадровое состояние: без стрелок, thumbnails и фиктивного индекса, но с fullscreen. Связанные товары теперь выбираются сначала из категории, затем только из того же раздела.

Добавлены универсальные `catalogV2Data.ts` для построения ссылок/выборок и `V2CatalogSparseState.astro`. Заполненная категория показывает все три фактических товара. Empty/sparse-категория сохраняет собственные H1, описание и media; при их отсутствии показывает текстово-графическое состояние, предлагает прислать размеры, фотографию, эскиз, чертёж или ТЗ, даёт ссылку на раздел и телефон, Telegram, email. Формулировки не объявляют категорию навсегда пустой.

Товарные страницы строятся одним dynamic adapter. Заполненные поля выводятся условно; пустых декоративных секций и публичного SKU нет. Характеристики остаются `dl`, списком или абзацем по типу данных. Related products не содержат текущий товар, placeholders или уличную мебель: на выбранной странице показаны две реальные соседние модели.

Все category/product cards ограждений и связанные товары получают V2-href из набора реально созданных маршрутов. Browser-проверка не обнаружила ссылок `/ograzhdeniya-i-zabory/...` на старые category/product templates. Header и MobileMenu также ведут в V2-корень ограждений. Все страницы имеют `noindex, nofollow`; design-lab отсутствует в sitemap.

## Content/media gaps

У категорий «Декоративные ограждения» (`dekorativnye-ograzhdeniya`) и «Столбики и болларды» (`stolbiki-i-bollardy`) не указаны media. У всех трёх опубликованных товаров пусты `image` и `gallery`, поэтому их страницы показывают честный zero-media fallback без gallery controls. Подмена изображениями категории не выполнялась. Fullscreen общего `V2ProductGallery` зафиксирован на двух реальных изображениях категории «Ограждения контейнерных площадок»; товарный zero-media сценарий проверен отдельно. Media не копировались, не переименовывались и не удалялись.

## Проверки и screenshots

Для снимков выбраны: заполненная категория «Ограждения контейнерных площадок» (`ograzhdeniya-kontejnernyh-ploshchadok`), sparse-категория «Декоративные ограждения» (`dekorativnye-ograzhdeniya`) и наиболее заполненный товар «Контейнерная площадка Дуо» (`konteynernaya-ploshchadka-duo`). Сохранены все 11 требуемых PNG.

`npm run check` — успешно, 0 ошибок; `npm run build` — успешно, 135 страниц. Автоматизированная browser-проверка прошла для всех 13 новых маршрутов, шаблонов на 1440/1024/768/390/320 px и 200% zoom: без horizontal overflow, duplicate IDs, unlabeled buttons, console errors и публичного SKU. Проверены dropdown, MobileMenu, mobile footer, reduced motion, missing/broken media, single/multiple/zero-media gallery, ArrowLeft/ArrowRight, Escape, focus trap, return focus и swipe с `touch-action: pan-y`. Повторная проверка home-v2 и трёх существующих V2-страниц уличной мебели прошла.

Production routes/templates, content records, schemas, navigation/site settings, admin/import/export, package/deployment/GitHub Actions и media не изменялись. V2 в production не переносился.

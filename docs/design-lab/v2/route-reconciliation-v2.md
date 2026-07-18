# Reconciliation публичных маршрутов V2

Дата проверки: 15 июля 2026 года. Источник чисел — текущие production collections и HTML-дерево `dist`, без интернет-исследования и без изменения production-кода.

## Снимок целостности до новых страниц

- `git status --short`: один tracked modified file — `astro.config.mjs`; untracked-группы — `docs/design-lab/`, `src/components/design-lab/`, `src/layouts/DesignLabLayout.astro`, `src/pages/design-lab/`, `src/styles/design-lab.css`, `src/styles/design-lab/`.
- `git diff --name-status`: только `M astro.config.mjs`; изменение исключает `/design-lab/` из sitemap.
- Untracked files: **335** на момент стартового снимка. Среди них находятся V2 templates/components/routes, QA scripts, review documents и screenshots; они не добавлены в index.
- `git status --ignored --short`: **93 ignored status entries** в текущем представлении Git. Это агрегированные ignored paths, преимущественно `.astro`, `dist`, logs и dependency/build output; число не следует трактовать как количество отдельных файлов.
- Production records, schemas, media, navigation, site settings и admin в tracked diff отсутствуют.

## Проверенные числа

| Метрика | Факт |
| --- | ---: |
| Public production HTML routes | 110 |
| Изолированные V2 routes | 106 |
| V2 routes с production canonical | 105 |
| Дополнительные V2 routes без production detail | 1 |
| Active category routes production / V2 | 20 / 20 |
| Active product routes production / V2 | 68 / 68 |
| Production routes без самостоятельного V2-аналога | 5 |

Дополнительный маршрут — `/design-lab/v2/vakansii/svarshchik-metallokonstruktsiy/`. Он использует canonical `/vakansii/`, потому что отдельного production detail route пока нет. Это отдельное owner/architecture decision, а не одна из 110 production-страниц.

## Uncovered production routes

### `/izgotovlenie-na-zakaz/`

- Тип: самостоятельная публичная страница.
- Уникальный контент: да; данные находятся в `src/content/static-pages/custom-order.json` и выводятся `src/pages/izgotovlenie-na-zakaz.astro`.
- Текущий canonical: `/izgotovlenie-na-zakaz/`.
- Внутренние входы: 108 anchor occurrences из 108 production HTML sources; основной источник — общая mobile CTA/Footer и контекстные CTA.
- Решение: создать самостоятельную V2-страницу на том же production canonical. Не превращать её в восьмое направление.

### `/404.html`

- Тип: специальный файл ошибки, а не обычная контентная страница.
- Уникальный контент: только сообщение об ошибке и ссылка на главную.
- Текущий canonical в собранном HTML: `/404/`; такого public route в дереве нет. `noindex` отсутствует.
- Внутренние входы: 0.
- Решение: создать изолированный V2 specimen. При migration заменить production presentation, но сохранить реальный HTTP status 404; добавить `noindex`, исключить из sitemap и не ставить canonical на несуществующий URL.

### `/lavochki-i-skameyki/`

- Тип: legacy alias.
- Уникальный контент: нет. Source немедленно вызывает `Astro.redirect(..., 301)` на `/ulichnaya-mebel/lavochki-i-skameyki/`.
- Текущий canonical: `/ulichnaya-mebel/lavochki-i-skameyki/`; собранный redirect document также имеет `noindex`.
- Внутренние входы на alias: 0; внутренние ссылки используют nested canonical route.
- Решение: не создавать V2-копию. После migration сохранить совместимость через HTTP 301 на canonical category route.

### `/urny/`

- Тип: legacy alias, а не действующая самостоятельная категория.
- Уникальный контент: нет. Source состоит только из `Astro.redirect(..., 301)` на `/ulichnaya-mebel/urny/`.
- Текущий canonical: `/ulichnaya-mebel/urny/`; собранный redirect document имеет `noindex`.
- Внутренние входы на alias: 0; каталог и карточки используют `/ulichnaya-mebel/urny/`.
- Решение: отдельный V2-аналог не нужен. После migration сохранить HTTP 301 на nested category route. Удаление alias без redirect создаст риск для внешних/старых закладок, даже при отсутствии внутренних входов.

### `/navesy/`

- Тип: legacy compatibility page.
- Уникальный бизнес-контент: нет; страница содержит только H1 о перенаправлении, fallback-ссылку и meta refresh на `/navesy-i-kozyrki/`.
- Текущий canonical: ошибочно self-canonical `/navesy/`; `noindex` отсутствует.
- Внутренние входы на alias: 0. Навигация ведёт на `/navesy-i-kozyrki/`; вложенная catalog category `/ulichnaya-mebel/navesy/` имеет другой пользовательский смысл и не является target этого alias.
- Решение: не создавать отдельный V2 content template. После migration заменить meta refresh на HTTP 301 к `/navesy-i-kozyrki/`. До migration production-файл не менять.

## Вывод

Пять gaps полностью объясняются как **1 самостоятельная страница + 1 error document + 3 aliases**. `/urny/` не добавляет 21-ю категорию: активная запись категории одна, её canonical hierarchy — `/ulichnaya-mebel/urny/`. Каталожное покрытие остаётся 20/20 и 68/68. Для aliases не нужны V2 compatibility pages; их поведение должно быть описано как redirect policy в migration manifest.


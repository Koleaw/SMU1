# Карта готовности публичных маршрутов V2

Дата проверки: 15 июля 2026 года. Матрица пересчитана по current collections и свежему `dist` после создания custom-order и изолированного 404 specimen.

## Точные числа

| Состояние | Количество | Что входит |
| --- | ---: | --- |
| Public production routes | **110** | Все public HTML routes, включая `/404.html` и 3 legacy aliases; без admin/design-lab. |
| V2 routes | **108** | 106 полноценных аналогов + 1 isolated 404 specimen + 1 vacancy detail без production route. |
| Production routes с полноценным V2-аналогом | **106** | Сохраняют production canonical и готовы к `replace` либо `dynamic-template`. |
| Production routes → redirect | **3** | `/lavochki-i-skameyki/`, `/urny/`, `/navesy/`. |
| Future production 404 | **1** | `/404.html`; V2 specimen не считается обычной canonical page. |
| Дополнительный V2 owner-decision | **1** | Detail активной вакансии; не входит в 110 production routes. |

Полное покрытие каталога сохранено: **20/20 active categories**, **68/68 active products**. Category/product routes без V2 — **0/0**.

## Разбивка 110 production routes

| Тип | Production | Full V2 analog | Redirect | Future 404 |
| --- | ---: | ---: | ---: | ---: |
| Home | 1 | 1 | 0 | 0 |
| Catalog sections | 2 | 2 | 0 | 0 |
| Other main directions | 5 | 5 | 0 | 0 |
| Catalog categories | 20 | 20 | 0 | 0 |
| Catalog products | 68 | 68 | 0 | 0 |
| Projects archive/details | 5 | 5 | 0 | 0 |
| About, contacts, vacancies archive, legal | 4 | 4 | 0 | 0 |
| Custom order | 1 | 1 | 0 | 0 |
| Legacy aliases | 3 | 0 | 3 | 0 |
| Error document | 1 | 0 | 0 | 1 |
| **Итого** | **110** | **106** | **3** | **1** |

## Migration actions

- `replace`: **18** самостоятельных production pages используют готовую V2-композицию при сохранении URL.
- `dynamic-template`: **88** catalog category/product routes переходят на два общих data-driven templates.
- `redirect`: **3** aliases не получают content duplicates и должны отдавать HTTP 301.
- `404`: **1** error document должен использовать V2 presentation, реальный HTTP 404, `noindex`, отсутствие canonical и sitemap exclusion.

CSV содержит отдельную строку для каждого из 110 production routes и дополнительную строку owner-decision для vacancy detail: [public-v2-route-matrix.csv](./public-v2-route-matrix.csv).

## Redirect-only routes

1. `/lavochki-i-skameyki/` → `/ulichnaya-mebel/lavochki-i-skameyki/` (301).
2. `/urny/` → `/ulichnaya-mebel/urny/` (301). Это alias, а не отдельная 21-я категория.
3. `/navesy/` → `/navesy-i-kozyrki/` (301). Вложенная `/ulichnaya-mebel/navesy/` остаётся самостоятельной catalog category и не является target alias.

У aliases нет внутренних incoming anchors и нет уникального business content. Текущий `/navesy/` особенно проблемен: indexable self-canonical page использует meta refresh. Policy: [legacy-route-policy.md](./legacy-route-policy.md).

## 404

`/design-lab/v2/404/` — изолированный visual specimen. У него `noindex, nofollow`, нет canonical и он исключён из sitemap. Во время migration его presentation нужно перенести в production error document, не создавая обычный public route `/404/`; сервер/хост обязан вернуть status 404.

## Owner decision: vacancy detail

`/design-lab/v2/vakansii/svarshchik-metallokonstruktsiy/` — дополнительный V2 route. В production сейчас есть только `/vakansii/`; поэтому V2 detail временно canonical to archive. До migration владелец/архитектор должен решить:

- публиковать ли отдельный detail route;
- рекомендуемый pattern: `/vakansii/{slug}/`, если detail будет публичным;
- canonical должен совпадать с утверждённым detail URL;
- archive должен ссылаться на detail только после появления production pattern.

До решения route не включён в 110-row migration manifest и не должен автоматически появиться в production.

## Blockers и non-blocking gaps

- Три redirect rows имеют status `blocked-routing`: нужен реальный HTTP 301 на production hosting/routing layer. Это один общий инфраструктурный blocker, затрагивающий три URL.
- Vacancy detail — отдельное owner/architecture decision, но не blocker для сохранения текущей archive-only production модели.
- Восемь fence categories остаются sparse; две category records не имеют usable media; три products используют zero-media state; один project — text-only. Эти gaps честно отображаются и не блокируют route migration.
- Все V2 files и документы пока untracked; их точный scope должен быть добавлен осознанно только в отдельной migration работе.

Machine-readable 110-row migration scope находится в [v2-production-migration-manifest.csv](./v2-production-migration-manifest.csv).

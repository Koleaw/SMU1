# Политика legacy routes перед V2 migration

Дата проверки: 15 июля 2026 года. Политика основана на исходных Astro-файлах, current records и собранном HTML. Production routes в этой задаче не изменялись.

## `/lavochki-i-skameyki/`

| Поле | Решение |
| --- | --- |
| Current content | Собственного контента нет: `src/pages/lavochki-i-skameyki.astro` сразу вызывает `Astro.redirect(..., 301)`. |
| Target canonical | `/ulichnaya-mebel/lavochki-i-skameyki/` |
| Internal links | 0 входящих anchors на alias; актуальные catalog links используют nested route. |
| Indexing/canonical | Собранный redirect document: `noindex`, canonical на target, meta refresh fallback. |
| Recommended HTTP action | **301 redirect** на target. |
| Reason | Alias обозначает ту же категорию и не содержит отдельного пользовательского смысла. V2 category уже существует. |
| SEO risk | Удаление без redirect потеряет старые внешние ссылки; отдельная индексируемая копия создаст duplicate content. |
| Migration step | Добавить/сохранить правило 301 на routing/deployment layer; не переносить alias в V2 content template; проверить один hop и target 200. |

## `/urny/`

| Поле | Решение |
| --- | --- |
| Current content | Собственного контента нет: `src/pages/urny.astro` сразу вызывает `Astro.redirect(..., 301)`. Активная production category record одна и имеет parent `ulichnaya-mebel`. |
| Target canonical | `/ulichnaya-mebel/urny/` |
| Internal links | 0 входящих anchors на alias; section/category/product navigation использует nested route. |
| Indexing/canonical | Собранный redirect document: `noindex`, canonical на target, meta refresh fallback. |
| Recommended HTTP action | **301 redirect** на target. |
| Reason | Это legacy alias, а не 21-я категория и не route с уникальным контентом. |
| SEO risk | Удаление без redirect может сломать старые внешние URL; отдельный V2-аналог ошибочно раздвоит одну категорию. |
| Migration step | Сохранить один постоянный redirect; target должен использовать `CatalogCategoryV2` и прежний production URL. |

## `/navesy/`

| Поле | Решение |
| --- | --- |
| Current content | Только redirect notice: H1, fallback-ссылка и meta refresh на direction. Уникального бизнес-контента нет. |
| Target canonical | Рекомендуемый target `/navesy-i-kozyrki/`. Текущий HTML ошибочно self-canonical на `/navesy/`. |
| Internal links | 0 входящих anchors на alias; Header/navigation использует `/navesy-i-kozyrki/`. Вложенная `/ulichnaya-mebel/navesy/` — отдельная catalog category, не target alias. |
| Indexing/canonical | `noindex` отсутствует; meta refresh и self-canonical создают неоднозначный SEO-сигнал. |
| Recommended HTTP action | **301 redirect** на `/navesy-i-kozyrki/`. |
| Reason | Current page уже объявляет именно direction target и не содержит самостоятельного пользовательского сценария. |
| SEO risk | Сохранение indexable meta-refresh страницы может восприниматься как soft redirect/duplicate; redirect на вложенную category изменил бы исходный смысл alias. |
| Migration step | Заменить compatibility HTML реальным 301, убрать self-canonical вместе со страницей, проверить отсутствие redirect chain. Production-файл до отдельной migration задачи не менять. |

## Общая политика

- Три полноценных V2 compatibility pages не создаются: это увеличило бы дублирование без сохранения уникального контента.
- Все три URL остаются учтены в migration manifest как production routes с action `redirect`.
- Redirect target сохраняет существующий canonical production URL; design-lab namespace в target никогда не используется.
- Если production-хостинг не умеет отдавать HTTP redirects, это deployment dependency и migration blocker для корректной SEO-реализации, а не повод оставлять индексируемые meta-refresh copies.
- Legacy aliases не включаются в sitemap и не получают отдельные canonical pages.

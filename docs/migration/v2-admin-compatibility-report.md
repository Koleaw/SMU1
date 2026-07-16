# Совместимость V2 с существующей админкой и данными

Дата финальной проверки: 16 июля 2026 года.

## Итог

Основной контракт совместимости подтверждён: migrated production-страницы продолжают читать канонические записи из существующих Astro Content Collections. Формат записей, схемы, административные маршруты, import/export и пути media для migration не изменялись.

Проверка записи выполнялась только в двух изолированных временных копиях репозитория. Production records, `src/data`, `public/assets` и `public/uploads` в рабочем дереве не изменялись. Вызов публикации, Git-операции из админки и deployment не выполнялись.

## Сохранённая архитектура данных

Production V2 использует прежние коллекции, объявленные в `src/content.config.ts`:

- `product-sections`;
- `product-categories`;
- `products`;
- `services`;
- `projects`;
- `jobs`;
- `site-settings`;
- `static-pages`.

Каталог загружается через `getCollection()` из `product-sections`, `product-categories` и `products`; страницы проектов — из `projects`; вакансии — из `jobs`; главная и практические страницы — из `static-pages` и `site-settings`. Фильтрация `isActive`, `showInCatalog`, `showInSectionGrid` и `showOnHome` остаётся data-driven. V2-компоненты являются renderer/adapters и не создают параллельное хранилище записей.

Существующая Admin API по-прежнему сопоставляет эти коллекции с JSON в `src/content/**`. `src/data/navigation.json` и `src/data/yandex.json` остаются прежними singleton-источниками. Media references продолжают указывать на существующие пути в `public/assets` и `public/uploads`.

## Какие изменения records доходят до V2

V2 читает напрямую либо через read-only adapters следующие публичные данные:

- shell — фактические контакты/site settings, а также labels, href, order и visibility существующей навигации; active direction records фильтруют соответствующие пункты;
- home — hero media, направления с `isActive/showOnHome`, фактические проекты и контакты;
- catalog — title/description, price mode/price, features, specifications, materials, colors, customization, delivery, gallery, active/show flags и related products;
- directions — active state, title/description/image, hero/contact fields и пригодные media из текущих section/service/project records;
- projects — title, description, city/year, `whatWasDone`, active state и пригодные media; если администратор заменяет configured paths, renderer использует безопасный record-media fallback;
- practical pages — фактические company blocks, контакты/реквизиты, vacancy records и полный legal source;
- custom order — hero/contact fields, исходные материалы, активные направления, текущие продукты/проекты и прямые контакты.

Для home, company, custom order и специализированных direction pages часть прежней редакции проходит через паттерн «approved until edited»: если поле всё ещё равно известному pre-migration значению, renderer показывает утверждённую V2-формулировку; после реального изменения поля выводится новое record value. Adapter ничего не записывает в record и не подменяет import/export. Это позволяет сохранить утверждённую V2-копию без превращения разметки в независимый контентный источник.

V2 намеренно не является универсальным renderer для произвольных legacy `pageBlocks`. Технические, процессные и стоимостные блоки, не входящие в утверждённый публичный scope, произвольная перестановка неподдерживаемых block types, публичный SKU, placeholder media и небезопасные кадры внутреннего производства не выводятся. Они не удалены из records/filesystem, но их редактирование не обязано менять публичную V2-композицию. Поэтому подтверждённый Admin API round-trip нельзя трактовать как визуальный end-to-end тест каждого поля каждого legacy блока.

## Автоматические тесты Admin API

Команда:

```text
npm run test:admin-import
```

Результат: **19/19 tests passed**. Проверены существующие тесты content JSON, project media и Admin API routes, включая preview/apply import и full-site export.

## Изолированный import/export round-trip

Команда:

```text
node tools/migration/admin-roundtrip.mjs
```

Результат: **pass**.

Проверка выполнила следующую последовательность:

1. До теста рассчитаны SHA-256 для live `src/content`, `src/data`, `public/assets` и `public/uploads`.
2. Созданы две временные sandbox-копии без каталога `.git`.
3. Через текущий Admin API прочитаны:
   - `products/skamya-loft`;
   - `projects/blagoustroystvo-naberezhnoy-reki-tobol`;
   - `site-settings/global`.
4. Только в первой sandbox-копии изменены тестовые значения:
   - текст товара `shortDescription`;
   - ссылка товара на уже существующий media-файл;
   - `isActive` и `showInCatalog` товара;
   - `shortDescription` и `isActive` проекта;
   - `vacanciesEmptyTitle` в site settings.
5. Выполнены preview/apply, full-site export, import во вторую sandbox-копию и повторный export.
6. После удаления служебных `exportedAt` нормализованные exports совпали полностью; все перечисленные тестовые поля сохранились.
7. Endpoint публикации не вызывался. Временные sandboxes удалены.
8. Повторные live-хеши совпали с исходными: изменения content/data/media в рабочем репозитории отсутствуют.

Это подтверждает data/API round-trip для текста, существующей media reference, публичных состояний товара и проекта, а также site settings. Тест намеренно не проверял реальную загрузку нового файла, визуальное отражение каждого поля в V2 или публикацию ветки.

## Известное ограничение visual editor

В существующем visual editor и Admin API есть рекурсивная функция `stripPresentationFields()`. Ключ `textWidth` входит в общий список удаляемых presentation fields. Поэтому сохранение записи страницы «О компании» через visual editor может удалить фактическое поле `pageBlocks[].textWidth`, хотя оно разрешено текущей schema и используется как часть данных блока.

Это существующее поведение админки, не внесённое production migration. Изолированный round-trip подтверждает перечисленные business/content fields, но не устраняет риск потери `pageBlocks[].textWidth`: full-site export также проходит через серверный recursive stripping.

До отдельного исправления рекомендуется не сохранять страницу `o-nas` через visual editor. Нужен отдельный узкий fix: сохранять schema-backed presentation fields внутри `pageBlocks` и добавить regression test на round-trip `pageBlocks[].textWidth`. В рамках этой migration админка и schemas не изменялись.

## Что намеренно не выполнялось

- live visual save;
- загрузка или замена media через UI;
- вызов publish;
- commit/push из административного процесса;
- production deployment.

Таким образом, data/API compatibility для перечисленных record-driven полей migrated production renderer подтверждена. Visual editor сохраняет прежнее операционное ограничение для `about.pageBlocks[].textWidth`, а неподдерживаемые/намеренно исключённые legacy blocks не следует считать частью публичного V2-контракта.

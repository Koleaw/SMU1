# Stage 1: Content/Data Backbone

## Введенные сущности
- `product-sections`
- `product-categories`
- `products`
- `services`
- `projects`
- `jobs`
- `site-settings`

## Где лежит контент
- Разделы продукции: `src/content/product-sections/`
- Подкатегории: `src/content/product-categories/`
- Позиции: `src/content/products/`
- Услуги: `src/content/services/`
- Выполненные объекты: `src/content/projects/`
- Вакансии: `src/content/jobs/`
- Глобальные настройки: `src/content/site-settings/`
- Схемы коллекций: `src/content.config.ts`

## Как добавить новый верхнеуровневый раздел
1. Создать JSON-файл в `src/content/product-sections/`.
2. Заполнить все обязательные поля схемы.
3. Указать `showOnHome: true`, если раздел должен попасть на главную.
4. Указать `isActive: true` для публикации.

## Как добавить новую подкатегорию (пример: «Фонари»)
1. Создать `src/content/product-categories/fonari.json`.
2. Указать `parentSectionSlug: "ulichnaya-mebel"`.
3. Указать `mode: "catalog-list"` (если будут товарные позиции).
4. Поставить `showInSectionGrid: true` и `isActive: true`.

## Как добавить новую позицию
1. Создать JSON-файл в `src/content/products/`.
2. Указать `productCategorySlug` равным slug подкатегории.
3. Заполнить цену через `priceMode` (`from` / `on_request` / `none`).
4. Включить `showInCatalog: true` и `isActive: true`.

## Как добавить вакансию
1. Создать JSON-файл в `src/content/jobs/`.
2. Заполнить все поля вакансии.
3. Поставить `isActive: true`.
4. Вакансия появится на `/vakansii/` автоматически.

## Что останется для следующего этапа (полноценная админка)
- Подключение git-based CMS UI (без изменения структуры коллекций).
- Настройка workflow публикации/ревью контента.
- Роли доступа и редакторский процесс.

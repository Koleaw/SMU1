# Локальная админка СМУ-1 (Stage 1)

## Что это
Локальная MVP-админка для редактирования контента сайта СМУ-1 через интерфейс на `/admin`.

- Frontend: `src/pages/admin/index.astro`
- Local API: `tools/admin-api/server.mjs`
- Режим записи: только `local` (изменения пишутся прямо в `src/content/**/*.json`)

## Запуск
1. Терминал 1:
   ```bash
   npm run dev -- --host 127.0.0.1
   ```
2. Терминал 2:
   ```bash
   npm run admin:api
   ```
3. Открыть:
   - `http://127.0.0.1:4321/SMU1/admin/`
4. Логин:
   - Логин: `admin`
   - Пароль: `admin`

## ENV
Пример переменных: `.env.admin.example`.

Поддерживаются локальные файлы:
- `.env.local`
- `.env.admin.local`

Если переменные не заданы, API использует dev-дефолты (`admin/admin`) и выводит warning в консоль.

Admin frontend использует API base в таком порядке:
1. `PUBLIC_ADMIN_API_BASE` (если задана).
2. Дефолт для local dev: `http://127.0.0.1:8787/api/admin`.

Admin API в local dev всегда разрешает CORS для:
- `http://localhost:4321`
- `http://127.0.0.1:4321`
- и дополнительно `ADMIN_ALLOWED_ORIGIN`, если задан.

## Что сейчас работает
- Логин/логаут и проверка сессии:
  - `POST /api/admin/login`
  - `POST /api/admin/logout`
  - `GET /api/admin/me`
- Просмотр и редактирование whitelist-коллекций:
  - `product-sections`
  - `product-categories`
  - `products`
  - `services`
  - `projects`
  - `jobs`
  - `site-settings`
- Эндпоинты контента:
  - `GET /api/admin/collections`
  - `GET /api/admin/content/:collection`
  - `GET /api/admin/content/:collection/:slug`
  - `PUT /api/admin/content/:collection/:slug`
- Friendly editor для `product-sections` и `services`, включая `pageBlocks`.
- Generic editor для остальных коллекций.
- Read-only секция «Показать JSON».
- Предупреждение браузера при уходе с несохраненными изменениями.

## Как редактировать страницу «Навесы»
1. Откройте `/admin`.
2. Войдите в админку.
3. В левой колонке выберите **Разделы продукции**.
4. В списке записей нажмите **Открыть** у записи `Навесы` (`navesy`).
5. В секции «Блоки страницы» редактируйте карточки/строки/шаги, меняйте порядок кнопками «Выше/Ниже», скрывайте через `isActive`.
6. Нажмите **Сохранить**.

После сохранения изменяется локальный JSON-файл (например, `src/content/product-sections/navesy.json`).

## Ограничения Stage 1 (пока не реализовано)
- Нет создания новых записей.
- Нет удаления записей/файлов.
- Нет загрузки изображений.
- Нет production-хостинга backend.
- Нет GitHub write mode / auto commit.
- Нет drag-and-drop.

## Важно после правок
Изменения пишутся в локальные JSON-файлы.
После редактирования нужно сделать `git commit` / `git push` вручную.

Production-режим и GitHub write mode — отдельный следующий этап.

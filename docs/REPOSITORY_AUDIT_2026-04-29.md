# Аудит репозитория СМУ-1

Дата аудита: 2026-04-29  
Рабочая директория: `D:\работа\СМУ1\SMU1`  
Главный источник требований: `docs/MASTER_SPEC.md`

## 1. Объем проверки

Проверены все проектные файлы вне `node_modules`, включая скрытые конфиги, `docs`, `public`, `src`, `.github`, `tools` и `codextasks`.

`node_modules` физически лежит в рабочей директории и содержит 10 776 файлов / примерно 139 MB. Это не исходный код проекта, а сгенерированная директория зависимостей; она не отслеживается git и должна быть исключена через `.gitignore`.

PDF-файлы в `docs` проверены как бинарные документы по наличию, именам, размеру и роли в проекте. Локального `pdftotext` в окружении нет, поэтому содержимое PDF не извлекалось. Это допустимо для текущего аудита, потому что сам проект объявляет `docs/MASTER_SPEC.md` главным source of truth, а PDF только уточняющими материалами.

## 2. Краткий вывод

Репозиторий уже содержит рабочий Astro-каркас, content layer, статическую сборку, публичные страницы каталога/услуг, локальную админку Stage 1 для страницы "Навесы", Pages CMS config, GitHub Pages workflow, cookie banner, Яндекс Метрику с согласием и базовый SEO-набор.

Главная проблема: проект пока не готов к надежному деплою через текущий `npm run build` и GitHub Actions. Причина не в Astro-страницах, а в конфигурации зависимостей: script вызывает `astro check`, но в `package.json` нет `@astrojs/check` и `typescript`.

Вторая большая проблема: фактическая реализация заметно ушла от `MASTER_SPEC` и `DESIGN_SYSTEM_FINAL.md`. Не реализованы формы, отсутствует страница "Производство", README описывает старую модель данных, дизайн-токены отличаются от утвержденных, часть страниц сильно недонаполнена, а часть URL уже раздроблена тонкими placeholder-страницами.

## 3. Результаты технических проверок

### 3.1. Git status до аудиторских правок/проверок

На старте был неотслеживаемый:

```text
?? node_modules/
```

После проверки сборки появились также сгенерированные:

```text
?? .astro/
?? dist/
?? node_modules/
```

Эти директории нельзя коммитить. В репозитории нет `.gitignore`.

### 3.2. Зависимости

`npm ls --depth=0`:

```text
@astrojs/sitemap@3.7.2
astro@5.18.1
```

В `package.json` указаны диапазоны:

```json
"astro": "^5.1.0",
"@astrojs/sitemap": "^3.2.1"
```

`package-lock.json` отсутствует. Это делает сборку недетерминированной: локально установлен Astro 5.18.1, а CI может получить другую совместимую версию.

### 3.3. Проверка `npm run check`

`npm run check` не выполняет type-check, потому что Astro просит установить отсутствующие зависимости:

```text
@astrojs/check
typescript
```

### 3.4. Проверка `npm run build` в CI-режиме

Команда:

```powershell
$env:CI='true'; npm run build
```

Результат: ошибка. Ключевая причина:

```text
The `@astrojs/check` and `typescript` packages are required for this command to work.
```

Следствие: текущий `.github/workflows/deploy.yml` с высокой вероятностью упадет на шаге `npm run build`.

### 3.5. Проверка прямой статической сборки

Команда:

```bash
npx astro build
```

Результат: успешно, 36 страниц собрано. В sandbox запуск падал на `spawn EPERM`, но вне sandbox сборка прошла.

### 3.6. Проверка H1 и meta description

Для публичных не-admin страниц, кроме технических redirect-страниц `/lavochki-i-skameyki/` и `/urny/`, в `dist` есть ровно один H1 и meta description.

Admin-страницы имеют несколько H1. Для публичного SEO это не критично, но admin-страницы сейчас тоже попадают в статическую сборку.

### 3.7. Проверка внутренних ассетов

Найден один отсутствующий ассет:

```text
src/pages/index.astro -> /assets/video/hero-home.mp4
```

В hero есть poster fallback, поэтому страница не ломается визуально, но браузер все равно будет пытаться запросить отсутствующий MP4.

## 4. Карта текущей архитектуры

### 4.1. Стек

Фактический стек:

- Astro 5
- TypeScript config через `astro/tsconfigs/strict`
- Astro content collections в `src/content.config.ts`
- JSON data/content
- CSS в одном большом `src/styles/global.css`
- GitHub Actions -> GitHub Pages
- Локальный Node backend для admin Stage 1: `tools/admin-api/server.mjs`

Расхождение со спецификацией:

- В AGENTS.md указан SCSS, фактически используется plain CSS.
- Формы через внешний backend заявлены в спецификации, но в коде форм нет.

### 4.2. Две модели данных

В проекте одновременно существуют:

1. Новая модель Astro content layer:
   - `src/content/product-sections`
   - `src/content/product-categories`
   - `src/content/products`
   - `src/content/services`
   - `src/content/projects`
   - `src/content/jobs`
   - `src/content/site-settings`

2. Старая/переходная модель:
   - `src/data/categories.json`
   - `src/data/product-categories.json`
   - `src/data/project-pages.json`
   - `src/data/objects.json`
   - `src/data/faqs.json`
   - `src/data/site.json`
   - `src/data/yandex.json`
   - `src/data/navigation.json`

Фактически используются только:

- `src/data/navigation.json`
- `src/data/site.json`
- `src/data/yandex.json`
- `src/data/faqs.json` только компонентом `FAQ.astro`, но сам `FAQ.astro` нигде не подключен

Неиспользуемые или устаревшие:

- `src/data/categories.json`
- `src/data/product-categories.json`
- `src/data/project-pages.json`
- `src/data/objects.json`

Риск: README все еще направляет редактора менять часть данных в `src/data`, хотя актуальные страницы в основном строятся из `src/content`.

## 5. Критические проблемы

### P0. CI/deploy сейчас сломан

Файлы:

- `package.json`
- `.github/workflows/deploy.yml`

Причина:

- `npm run build` = `astro check && astro build`
- `astro check` требует `@astrojs/check` и `typescript`
- этих пакетов нет в зависимостях

Что сделать:

1. Добавить `@astrojs/check` и `typescript` в devDependencies.
2. Зафиксировать lockfile.
3. Перейти в workflow с `npm install` на `npm ci`, когда появится lockfile.

### P0. Нет `.gitignore`, а generated/dependency dirs уже в рабочем дереве

Факты:

- `.gitignore` отсутствует.
- `node_modules/` неотслеживаемый.
- После build появились `.astro/` и `dist/`.

Что сделать:

Добавить минимум:

```gitignore
node_modules/
dist/
.astro/
.env.local
.env.admin.local
public/uploads/
```

`public/uploads/` стоит обсудить отдельно: если uploads должны коммититься как контент, тогда папку не игнорировать целиком, а вводить процесс ревью загруженных файлов.

### P0/P1. В спецификации формы обязательны, в коде форм нет

Требования:

- `shortLead`
- `calculationForm`
- `customOrderForm`
- success text: "Свяжемся, уточним задачу и подготовим расчет."
- honeypot
- внешний form backend

Фактическое состояние:

- Компонента `LeadForm.astro` нет.
- `src/data/forms.json` нет, хотя README на него ссылается.
- Все CTA ведут в Telegram/email/phone.
- Политика конфиденциальности прямо говорит, что форм на сайте нет.

Вывод:

Текущая версия может работать как сайт с прямыми контактами, но не соответствует коммерческой логике MASTER_SPEC и не закрывает сценарии заявок.

### P1. Отсутствует страница "Производство"

В `MASTER_SPEC.md` и AGENTS.md страница "Производство" обязательна.

Фактически:

- `src/pages/proizvodstvo.astro` или `src/pages/proizvodstvo/index.astro` нет.
- В навигации "Производство" отсутствует.
- Стили под production есть в `src/styles/global.css`, и ассет `public/assets/images/production/process-1.svg` есть, но страница не создана.

### P1. `robots.txt` содержит неправильный sitemap URL

Файл:

- `public/robots.txt`

Сейчас:

```text
Sitemap: https://example.github.io/SMU1/sitemap-index.xml
```

В CI `astro.config.mjs` выставляет `SITE_URL` как `https://${{ github.repository_owner }}.github.io`, но `robots.txt` статический и не обновится. На проде robots будет отдавать `example.github.io`.

Что сделать:

- Генерировать robots через Astro endpoint/скрипт с учетом `SITE_URL` и `BASE_PATH`; или
- вручную заменить на финальный домен/путь перед публикацией.

## 6. Соответствие страниц MASTER_SPEC

### Главная

Файл:

- `src/pages/index.astro`

Есть:

- hero
- продуктовые направления
- услуги
- выполненные объекты
- direct contact

Не хватает по spec:

- отдельного блока "Как работаем"
- производственного блока
- полноценной формы заявки
- контактов как отдельного блока с контактными данными
- более явного разведения "каталог / проектные услуги / доверительный контур"

Отдельный риск:

- hero ссылается на отсутствующий `/assets/video/hero-home.mp4`.

### Уличная мебель

Файл:

- `src/pages/ulichnaya-mebel/index.astro`

Есть:

- hero
- сетка подкатегорий
- direct contact

Не хватает:

- короткого объяснения раздела отдельным блоком
- примеров направлений сверх карточек
- блока "изготавливаем на заказ"
- формы заявки
- объектов/преимуществ/how we work

### Товарные категории уличной мебели

Файл:

- `src/pages/ulichnaya-mebel/[slug].astro`

Страницы генерируются для:

- `lavochki-i-skameyki`
- `urny`
- `vazony-i-tsvetochnitsy`
- `veloparkovki`
- `kachali-shezlongi-pergoly`

Есть:

- hero
- сетка изделий, если есть продукты
- direct contact

Не хватает:

- "Что влияет на цену"
- варианты исполнения
- фото в реальной среде
- FAQ
- форма заявки
- блок "на заказ"

Для `/lavochki-i-skameyki/` и `/urny/` есть redirect-страницы в корне, но для остальных товарных категорий корневых redirect-страниц нет.

### Ограждения и заборы

Файлы:

- `src/content/product-sections/ograzhdeniya.json`
- `src/pages/[slug].astro`
- `src/pages/[section]/[slug].astro`

Есть:

- верхнеуровневая страница
- 9 вложенных подстраниц

Риск:

`MASTER_SPEC.md` предупреждает, что на старте можно не дробить ограждения на много URL без контента. Сейчас создано 9 вложенных URL, многие из них имеют только общий placeholder-контент. Это может дать тонкие SEO-страницы.

### Навесы и козырьки

Файлы:

- `src/content/product-sections/navesy.json`
- `src/pages/[slug].astro`
- `src/components/PageBlocksRenderer.astro`
- `src/pages/admin/pages/navesy.astro`

Это наиболее развитая страница. Есть `pageBlocks`, визуальный editor Stage 1, блоки типов, объектов, процесса и факторов цены.

Не хватает по spec:

- расширенной формы расчета
- реальных объектов
- блока "что нужно для расчета" в текущем pageBlocks наборе
- "Почему СМУ-1" как отдельного доказательного блока

### Металлоконструкции для бизнеса

Файлы:

- `src/content/product-sections/metallokonstruktsii.json`
- `src/pages/[slug].astro`

Есть:

- подробный hardcoded набор секций
- сценарии, объекты, входные данные, процесс, факторы цены, примеры

Не хватает:

- data-driven content blocks
- формы расчета
- реальных объектов

### Благоустройство территорий

Файлы:

- `src/content/services/blagoustroystvo.json`
- `src/pages/[slug].astro`

Есть подробные hardcoded секции.

Не хватает:

- формы расчета
- реальных объектов
- более аккуратного ухода от термина "МАФ" в публичной подаче, если будет использоваться в верхних блоках. В меню термина нет, что хорошо.

### Строительство и ремонты

Файлы:

- `src/content/services/stroitelstvo.json`
- `src/pages/[slug].astro`

Есть подробные hardcoded секции.

Не хватает:

- формы расчета
- реальных объектов
- отдельной проектной доказательной части

### Выполненные объекты

Файлы:

- `src/pages/vypolnennye-obekty/index.astro`
- `src/pages/vypolnennye-obekty/[slug].astro`
- `src/content/projects/*.json`

Есть:

- листинг
- две карточки объектов

Не хватает по spec карточки объекта:

- задача как отдельное поле
- результат как отдельное поле
- полноценная галерея
- CTA через форму/расчет

Примечание: старая модель `src/data/objects.json` содержит `task` и `result`, но актуальная content collection `projects` этих полей не имеет.

### Контакты

Файл:

- `src/pages/kontakty.astro`

Есть:

- телефоны
- email
- Telegram
- город/адрес
- география
- Яндекс карта
- рейтинг Яндекс

Не хватает:

- формы связи
- реквизитов на странице, хотя они есть в footer и `site-settings`

### Изготовление на заказ

Файл:

- `src/pages/izgotovlenie-na-zakaz.astro`

Есть:

- hero
- вводные
- что делаем дальше
- placeholder media
- direct contact

Не хватает:

- `customOrderForm`
- коротких примеров кастомных задач отдельной сеткой
- возможности прикрепить файл/фото через внешний form backend

### 404

Файл:

- `src/pages/404.astro`

Есть и работает.

## 7. Дизайн-система и UI

Файл требований:

- `docs/DESIGN_SYSTEM_FINAL.md`

Фактические расхождения:

1. Требуется Roboto, но подключены `Raleway` и `Manrope`:
   - `src/layouts/BaseLayout.astro`
   - `src/styles/global.css`

2. Требуются размеры:
   - H1 36px
   - H2 28px
   - Body 16px

   Фактически:
   - H1 56px
   - H2 40px
   - Body 18px

3. В design system базовый border `#E0E0E0`, фактически `--color-border: #1c2733`, что делает многие карточки более жесткими/темными.

4. В CSS есть отрицательный `letter-spacing` у заголовков. Это расходится с текущими frontend-ограничениями и с более спокойной B2B-подачей.

5. Header desktop должен иметь CTA "Изготовление на заказ". Сейчас desktop header показывает телефон и Telegram, а CTA есть только в mobile menu.

6. `Topiarii` и `Vakansii` добавлены в верхнее меню, но не входят в утвержденную архитектуру MASTER_SPEC как обязательные верхнеуровневые разделы. Это может быть осознанное расширение, но оно должно быть зафиксировано в spec, иначе архитектура расходится.

## 8. SEO и маршруты

Плюсы:

- `@astrojs/sitemap` подключен.
- `BaseLayout` ставит title, description, canonical, OG title/description/url/image.
- Публичные контентные страницы имеют H1.
- URL человекочитаемые.
- `public/.nojekyll` есть.

Проблемы:

1. `robots.txt` указывает на `example.github.io`.
2. Админка попадает в статическую сборку и sitemap, если не исключена интеграцией/настройками.
3. Тонкие страницы ограждений могут быть преждевременным SEO-дроблением.
4. Redirect-страницы `/lavochki-i-skameyki/` и `/urny/` не имеют обычного H1 в `dist`, потому что это redirect. Это нормально технически, но нужно убедиться, что redirect реально отдается корректно на GitHub Pages.
5. Главная canonical при локальном build без env получается `https://example.github.io/SMU1`. В CI будет лучше, но статический robots все равно останется проблемой.

## 9. Контент и данные

### 9.1. Content collections

Схема `src/content.config.ts` строгая и полезная. Ссылочные проверки между `product-sections`, `product-categories` и `products` прошли: битых `parentSectionSlug`/`productCategorySlug` нет.

### 9.2. Слабые места content model

1. `projects` слишком бедная для кейсов:
   - нет `task`
   - нет `result`
   - нет `relatedPages`
   - нет `workType`
   - нет `region`

2. `product-categories` не содержит:
   - price factors
   - variants
   - faqIds
   - related objects

3. `products` содержит только базовую карточку, без характеристик/вариантов.

4. `pageBlocks` есть только пилотно на `product-sections`, но проектные услуги `services` в схеме уже допускают `pageBlocks`. Pages CMS config для services пока не дает редактировать `pageBlocks`.

### 9.3. Старые данные

Старые JSON в `src/data` содержат важные поля, которых нет в новой модели. Это не ошибка сборки, но риск потери смысловой структуры при дальнейшем переносе.

Рекомендация:

- Либо удалить старые файлы после миграции.
- Либо явно пометить их как legacy.
- Либо перенести недостающие поля в content layer.

## 10. Админка и CMS

### 10.1. Pages CMS

Файл:

- `.pages.yml`

Есть:

- коллекции каталога, услуг, объектов, вакансий, настроек
- media config на `public/uploads`
- базовые поля
- `pageBlocks` для `product-sections`

Проблемы:

1. `public/uploads` отсутствует до первого upload.
2. В `.pages.yml` нет `imageView`/`mediaView`, хотя эти поля поддерживаются схемой и visual editor.
3. Для `services` нет CMS-редактирования `pageBlocks`, хотя схема допускает.
4. Настройка CMS не синхронизирована полностью с content schema.

### 10.2. Local admin API

Файл:

- `tools/admin-api/server.mjs`

Плюсы:

- локальная авторизация
- cookie session
- CORS только localhost/127.0.0.1 + optional origin
- ограничение коллекций
- slug sanitation
- upload limit 10 MB
- extension allowlist

Риски:

1. Нет schema validation перед записью JSON. Любой валидный JSON-объект может быть сохранен и потом сломать Astro build.
2. Upload проверяет расширение, но не MIME/signature.
3. SVG upload разрешен. Если uploads будут доступны публично, SVG надо либо запрещать для upload, либо санитизировать.
4. Sessions живут в памяти и не истекают по TTL.
5. Dev credentials `admin/admin` включаются по умолчанию при отсутствии env. Для локального режима это удобно, но нужно не допустить случайного production exposure.

### 10.3. Admin UI

Файлы:

- `src/pages/admin/index.astro`
- `src/pages/admin/technical.astro`
- `src/pages/admin/pages/navesy.astro`

Плюсы:

- есть visual editor страницы "Навесы"
- есть технический редактор
- есть upload и кадрирование через `imageView/mediaView`

Проблемы:

1. `src/pages/admin/index.astro` вызывает `/me`, но не проверяет поле `authenticated`; если API вернул `{ authenticated: false }` со статусом 200, главный экран admin может показаться без авторизации. Запись все равно не пройдет без API auth, но UX/security-сигнал неправильный.
2. Admin-страницы статически публикуются вместе с сайтом. Если это не нужно на проде, их надо исключать или закрывать отдельным процессом.
3. Большая часть editor logic живет прямо в `.astro` файлах. Это усложнит поддержку.

## 11. Безопасность, приватность, внешние сервисы

Плюсы:

- Метрика загружается только после согласия.
- Cookie banner есть.
- Политика конфиденциальности есть.

Риски:

1. Если будут добавлены формы, политику надо обновить: сейчас она явно говорит, что формы заявок и загрузка файлов отсутствуют.
2. Яндекс Карта и rating badge на контактах грузятся внешними скриптами/iframe. Это нормально, но в политике уже должно быть отражено как сторонние сервисы; сейчас отражено.
3. Google Fonts подключаются внешне. Если нужен максимально контролируемый privacy/performance контур, стоит self-host fonts или использовать системный стек/Roboto локально.

## 12. Документация

Плюсы:

- `MASTER_SPEC.md` подробный и полезный.
- Есть docs по content architecture, design system, Pages CMS, admin stage.
- AGENTS.md хорошо фиксирует границы этапа.

Проблемы:

1. README устарел:
   - говорит менять данные в `src/data/*.json`, хотя актуальная модель в `src/content`.
   - ссылается на `src/components/LeadForm.astro`, которого нет.
   - ссылается на `src/data/forms.json`, которого нет.

2. `docs/readme.md` пустой.

3. `MASTER_SPEC.md` говорит, что PDF лежат в `docs/source/`, фактически они лежат прямо в `docs/`.

4. `codextasks/codextask1.txt` содержит полноценную постановку задачи по visual editor. Это полезно как история, но не является документацией для обычного редактора.

## 13. Ассеты

Плюсы:

- `public/assets/brand/` уже создан.
- `logo-full.svg`, `favicon.svg`, `logo_scan_cropped.svg` есть.
- Иконки перенесены в `public/assets/icons`.
- Placeholder SVG есть для products/objects/production/placeholders.

Проблемы:

1. Большинство визуалов пока технические SVG-placeholder.
2. `hero-home.mp4` отсутствует.
3. В `docs` продублированы иконки и логотипы, которые уже есть в `public`.
4. Favicon временный, это соответствует рискам в AGENTS.md.

## 14. Рекомендуемый порядок исправлений

### Сначала инфраструктура

1. Добавить `.gitignore`.
2. Добавить `@astrojs/check` и `typescript`.
3. Создать `package-lock.json`.
4. Перевести GitHub Actions на `npm ci`.
5. Проверить `npm run build` локально и в CI.
6. Исправить `robots.txt`.

### Затем соответствие spec

1. Создать страницу "Производство".
2. Добавить формы или явно согласовать временный direct-contact-only режим.
3. Обновить политику после добавления форм.
4. Довести главную до обязательных блоков MASTER_SPEC.
5. Усилить карточки товарных категорий: price factors, variants, FAQ, CTA/form.
6. Расширить content model для projects.

### Затем дизайн и редакторский контур

1. Синхронизировать CSS tokens с `DESIGN_SYSTEM_FINAL.md`.
2. Вернуть Roboto или обновить design doc, если Raleway/Manrope утверждены отдельно.
3. Добавить desktop CTA в Header.
4. Синхронизировать `.pages.yml` с `src/content.config.ts`.
5. Добавить schema validation в local admin API перед записью.

## 15. Инвентаризация проектных файлов

### Root

- `.env.admin.example`
- `.pages.yml`
- `AGENTS.md`
- `astro.config.mjs`
- `package.json`
- `README.md`
- `tsconfig.json`

### GitHub

- `.github/workflows/deploy.yml`

### Codex tasks

- `codextasks/codextask1.txt`

### Docs

- `docs/MASTER_SPEC.md`
- `docs/ADMIN_LOCAL_STAGE1.md`
- `docs/CONTENT_ARCHITECTURE_STAGE1.md`
- `docs/DESIGN_SYSTEM_FINAL.md`
- `docs/PAGE_BLOCKS_STAGE1.md`
- `docs/PAGES_CMS_SETUP.md`
- `docs/readme.md`
- `docs/SMU1_TZ_arhitektura_struktura_logika_saita.pdf`
- `docs/SMU1_template_category_page.pdf`
- `docs/SMU1_page_to_query_map_v3_fixed.pdf`
- `docs/SMU1_Karta_saita_i_sostav_stranits.pdf`
- `docs/SMU1_homepage_structure.pdf`
- `docs/SMU1_final_site_architecture_v2.pdf`
- `docs/SMU1_content_model.pdf`
- `docs/logo scan.svg`
- `docs/logo_scan_cropped.svg`
- `docs/building.svg`
- `docs/download.svg`
- `docs/factory.svg`
- `docs/file-text.svg`
- `docs/image.svg`
- `docs/mail.svg`
- `docs/map-pin.svg`
- `docs/menu.svg`
- `docs/phone.svg`
- `docs/send.svg`
- `docs/x.svg`

### Public

- `public/.nojekyll`
- `public/robots.txt`
- `public/assets/brand/favicon.svg`
- `public/assets/brand/logo-full.svg`
- `public/assets/brand/logo_scan_cropped.svg`
- `public/assets/icons/mail.svg`
- `public/assets/icons/map-pin.svg`
- `public/assets/icons/menu.svg`
- `public/assets/icons/phone.svg`
- `public/assets/icons/send.svg`
- `public/assets/icons/x.svg`
- `public/assets/images/objects/object-1.svg`
- `public/assets/images/objects/object-2.svg`
- `public/assets/images/objects/object-3.svg`
- `public/assets/images/objects/object-4.svg`
- `public/assets/images/placeholders/canopies.svg`
- `public/assets/images/placeholders/construction.svg`
- `public/assets/images/placeholders/landscaping.svg`
- `public/assets/images/placeholders/metal-business.svg`
- `public/assets/images/placeholders/og-default.svg`
- `public/assets/images/placeholders/street-furniture.svg`
- `public/assets/images/production/process-1.svg`
- `public/assets/images/products/benches-1.svg`
- `public/assets/images/products/benches-2.svg`
- `public/assets/images/products/benches-3.svg`
- `public/assets/images/products/bins-1.svg`
- `public/assets/images/products/bins-2.svg`
- `public/assets/images/products/bins-3.svg`
- `public/assets/video/.gitkeep`

### Src: config/layout/styles/utils

- `src/content.config.ts`
- `src/layouts/BaseLayout.astro`
- `src/styles/global.css`
- `src/utils/withBase.ts`

### Src: components

- `src/components/Breadcrumbs.astro`
- `src/components/CookieBanner.astro`
- `src/components/DirectContactBlock.astro`
- `src/components/FAQ.astro`
- `src/components/Footer.astro`
- `src/components/Header.astro`
- `src/components/Hero.astro`
- `src/components/MobileMenu.astro`
- `src/components/PageBlocksRenderer.astro`
- `src/components/SectionNavigator.astro`

### Src: pages

- `src/pages/index.astro`
- `src/pages/404.astro`
- `src/pages/[slug].astro`
- `src/pages/[section]/[slug].astro`
- `src/pages/izgotovlenie-na-zakaz.astro`
- `src/pages/kontakty.astro`
- `src/pages/lavochki-i-skameyki.astro`
- `src/pages/urny.astro`
- `src/pages/vakansii.astro`
- `src/pages/admin/index.astro`
- `src/pages/admin/technical.astro`
- `src/pages/admin/pages/navesy.astro`
- `src/pages/navesy/index.astro`
- `src/pages/politika-konfidencialnosti/index.astro`
- `src/pages/ulichnaya-mebel/index.astro`
- `src/pages/ulichnaya-mebel/[slug].astro`
- `src/pages/vypolnennye-obekty/index.astro`
- `src/pages/vypolnennye-obekty/[slug].astro`

### Src: data

- `src/data/categories.json`
- `src/data/faqs.json`
- `src/data/navigation.json`
- `src/data/objects.json`
- `src/data/product-categories.json`
- `src/data/project-pages.json`
- `src/data/site.json`
- `src/data/yandex.json`

### Src: content

- `src/content/jobs/svarshchik.json`
- `src/content/product-categories/dekorativnye-ograzhdeniya.json`
- `src/content/product-categories/gazonnye-ograzhdeniya.json`
- `src/content/product-categories/kachali-shezlongi-pergoly.json`
- `src/content/product-categories/kalitki.json`
- `src/content/product-categories/lavochki-i-skameyki.json`
- `src/content/product-categories/ograzhdeniya-kontejnernyh-ploshchadok.json`
- `src/content/product-categories/perila-i-poruchni.json`
- `src/content/product-categories/sekcionnye-ograzhdeniya.json`
- `src/content/product-categories/stolbiki-i-bollardy.json`
- `src/content/product-categories/urny.json`
- `src/content/product-categories/vazony-i-tsvetochnitsy.json`
- `src/content/product-categories/veloparkovki.json`
- `src/content/product-categories/vorota.json`
- `src/content/product-categories/zabory.json`
- `src/content/product-sections/metallokonstruktsii.json`
- `src/content/product-sections/navesy.json`
- `src/content/product-sections/ograzhdeniya.json`
- `src/content/product-sections/topiarii.json`
- `src/content/product-sections/ulichnaya-mebel.json`
- `src/content/products/kacheli-parkovye.json`
- `src/content/products/pergola-modulnaya.json`
- `src/content/products/skamya-antivandalnaya.json`
- `src/content/products/skamya-s-derevyannoy-spinkoy.json`
- `src/content/products/skamya-smu1-bazovaya.json`
- `src/content/products/tsvetochnitsa-modulnaya.json`
- `src/content/products/urna-antivandalnaya.json`
- `src/content/products/urna-s-kryshkoy-60l.json`
- `src/content/products/urna-smu1-45l.json`
- `src/content/products/vazon-pryamougolniy.json`
- `src/content/products/veloparkovka-bazovaya.json`
- `src/content/products/veloparkovka-usilennaya.json`
- `src/content/projects/objekt-parkovaya-zona.json`
- `src/content/projects/objekt-vhodnaya-gruppa.json`
- `src/content/services/blagoustroystvo.json`
- `src/content/services/stroitelstvo.json`
- `src/content/site-settings/global.json`

### Tools

- `tools/admin-api/server.mjs`


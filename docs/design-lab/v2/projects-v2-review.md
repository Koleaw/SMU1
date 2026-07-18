# Выполненные объекты V2 — review

Дата проверки: 14 июля 2026 года.

## Маршруты и данные

Фактический production archive: `/vypolnennye-obekty/`. Создан V2 archive: `/design-lab/v2/vypolnennye-obekty/`.

В collection находятся 6 project records, из них фактически active/published — 4. Для них один dynamic `getStaticPaths`-route создаёт:

- `/design-lab/v2/vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/`;
- `/design-lab/v2/vypolnennye-obekty/remont-skvera-na-ulitse-gogolya/`;
- `/design-lab/v2/vypolnennye-obekty/kompleks-rabot-na-proizvodstvennoy-territorii/`;
- `/design-lab/v2/vypolnennye-obekty/gorodskie-kacheli-dlya-obshchestvennyh-territoriy/`.

Архив читает active records и сортирует их по `order`, без featured-приоритета, filters и поиска. Используются существующие поля: `title`, `slug`, `city`, `region`, `locationLabel`, `year`, `shortDescription`, `whatWasDone`, `image`, `coverImage`, `gallery`, `images`, `captions`, а при заполнении также `summary`, `task`, `workType`, `category`, `shortCategory`, `workTypes`, `scope`, `result`, `materials`, `features`, `order`, `isActive`, `seoTitle`, `seoDescription`. Пустые поля и служебные сообщения не выводятся.

Все V2 pages имеют `noindex, nofollow`, production canonical и исключены из sitemap. Production archive/detail routes не менялись.

## Общие компоненты

Созданы `V2ProjectArchive`, `V2ProjectCard`, `V2ProjectMeta`, `V2ProjectProof`, `V2ProjectGallery`, `V2ProjectDetail`, `V2ProjectsLayout` и loader `projectV2Data.ts`. Общий archive/card layer выводит три media-rich объекта как равноправные visual-карточки и сквер как компактную text-only карточку без пустой media-рамки.

Detail template адаптируется к данным: breadcrumbs, hero, location/year, точный `shortDescription`, точный `whatWasDone`, только заполненные дополнительные facts, gallery при наличии, подтверждённые направления, previous/next, V2 archive-link, CTA и прямые телефон/Telegram/email. Media-sparse страница сквера не создаёт hero-media и gallery; она остаётся короткой и коммерчески завершённой.

## Gallery и presentation adapter

`V2ProjectGallery` показывает явно заданную публичную последовательность, contain-stage, portrait-safe thumbnails, previous/next, индекс и fullscreen dialog. Реализованы ArrowLeft/ArrowRight, Escape, focus trap, return focus, mobile horizontal swipe при `touch-action: pan-y pinch-zoom`, broken-media fallback и reduced-motion. При одном изображении controls/thumbnails/count не выводятся; при нуле component отсутствует. На detail hero загружается eager/high, gallery и thumbnails — lazy.

Временный `mediaRoleAdapter.ts` находится только в design-lab. Он явно назначает hero, media roles, exclusions, связанные направления и ключевые alt, не классифицируя кадры по имени файла. Фактический public набор:

- набережная: 3 из 3 media, hero — готовая территория; direction proof использует 2 finished-result кадра;
- промышленная территория: 32 разрешённых из 35 media остаются в adapter, публичная V2 gallery отбирает 10 различающихся кадров; исключены 3 внутренних кадра, hero — готовое внешнее здание;
- качели: 4 из 6 media; исключены 2 кадра внутреннего производства, hero — внешний landscape-кадр качелей на территории;
- сквер: 0 public media; оба placeholder исключены.

Связи направлений заданы вручную по record/`whatWasDone`: набережная — благоустройство, ограждения, уличная мебель; сквер — благоустройство и уличная мебель; промышленный объект — строительство и металлоконструкции; качели — уличная мебель. Связей с товарами нет.

## Обновлённые V2-переходы

На V2 archive/detail переведены Header «Объекты», MobileMenu, все варианты Footer, обе object CTA на home-v2, три home-v2 project cards, proof металлоконструкций, feature/supporting proof строительства и оба proof-проекта благоустройства. Browser QA не обнаружил ссылок из проверенных V2 pages на старые project detail routes.

## Контентные пробелы и проверки

У сквера отсутствуют реальные фотографии. Records не содержат project captions и структурированных alt; V2 сохраняет существующие значения, добавляет проверенные alt только ключевым кадрам и не имитирует captions. Нет customer, cost, dates beyond `year`, durations, технических узлов, характеристик или документов — они не добавлялись. Несколько направлений пока подтверждаются малым числом опубликованных объектов; это не компенсируется вымышленными cases.

`npm run check`: успешно, 0 errors. `npm run build`: успешно, 145 pages, включая archive и 4 detail routes. Один Chrome без параллельных contexts выполнил 54 responsive diagnostics: все V2 routes на 1440/390 и representative pages на 1280/1024/768/320/720 (200%-эквивалент). Результат: horizontal overflow 0, broken images 0, duplicate IDs 0, unlabeled buttons 0, console/runtime errors 0, broken local links 0. Проверены gallery keyboard/fullscreen/focus/swipe, Header/dropdown/MobileMenu, mobile footer, reduced-motion, production canonical и sitemap isolation.

## Visual correction pass

Archive hero сокращён до 268 px на 1440 px, поэтому объекты появляются в первом viewport значительно раньше. Асимметричная editorial-раскладка заменена единой двухколоночной grid: все visual cards имеют одинаковую ширину, cover ratio `16:10`, одинаковую структуру meta/title/description/CTA и `object-fit: cover`. Нечётная последняя visual-карточка сохраняет ту же ширину и центрируется; это не создаёт featured-приоритета. Text-only cards находятся отдельной компактной grid ниже и никогда не создают figure или placeholder. Visual: набережная, производственная территория, городские качели. Text-only: ремонт сквера.

Archive cover и detail hero назначаются отдельно, хотя сейчас для каждого media-rich объекта выбран один landscape-кадр: набережная — `/uploads/project-da0872c68d9a09f0a7d2f995.jpg`; производственная территория — `/uploads/img-20250724-134235-1783272745917.jpg`; качели — `/uploads/project-05c77513c1a391e5a71a7dee.jpg`. Detail hero использует controlled cover crop без прежних тёмных полей; полный кадр доступен через contain-gallery и fullscreen.

Public gallery selection не меняет records: набережная показывает 3 кадра, производственная территория — 10 из 32 разрешённых, качели — 4, сквер — 0. Для промышленного объекта оставлены общий готовый вид, различающиеся кадры основания, каркаса, работ на территории и облицовки, без near-duplicates и внутренних производственных зон. Остальные 22 разрешённых кадра остаются в record/adapter как `excludedFromPresentation`; три запрещённых внутренних кадра по-прежнему имеют роль `excluded`.

Media-sparse detail получил собственную плотность: компактный hero, уменьшенный блок `whatWasDone`, более короткие отступы связанных направлений, без gallery/media-зоны. Его финальная высота на 1440 px — 2418 px вместе с navigation, CTA и полным footer; основной фактический контент помещается в первом viewport. Breadcrumbs публично показывают «Главная», не внутреннее «Главная V2». Секция «Примеры благоустройства» сохранила feature набережной и горизонтальный text-only proof сквера без регрессии.

Project records, schema, slugs и все исходные media остались неизменными; media removed/renamed/copied: 0. Presentation choices существуют только в design-lab V2.

Изменения этой задачи ограничены design-lab V2, его styles и review/capture files. Production routes/templates, content records, schemas, slugs, navigation data, site settings, admin/import/export, package/deployment/GitHub Actions и существующие media не изменялись; media removed/renamed/copied: 0.

## Correction pass — 15 июля 2026 года

Для городских качелей archive cover, detail hero и первый gallery-кадр заменены на `/uploads/project-05c77513c1a391e5a71a7dee.jpg`: это наиболее чистый внешний вид установленных качелей без человека, стремянки и монтажных конструкций. Прежний монтажный `/uploads/project-05e1cb18f1d596a46bdacc90.jpg` сохранён вторым внутри gallery и больше не представляет итог как hero. На всех project detail pages удалён внутренний eyebrow «Фактический состав»; публичный H2 «Что было выполнено» оставлен без дублирующей подписи.

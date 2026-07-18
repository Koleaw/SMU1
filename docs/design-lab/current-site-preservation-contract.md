# Контракт сохранения текущего сайта СМУ-1

Статус: обязательный baseline для будущего редизайна.  
Дата локального аудита: 12 июля 2026 года.  
Область аудита: текущий исходный код, собранный сайт, локальные данные, админка, медиа и design-lab. Интернет-источники не использовались.

## 1. Назначение и приоритеты

Будущая версия должна быть надмножеством текущего сайта. Дизайн можно менять, но нельзя без отдельного решения владельца:

- удалять действующий маршрут, самостоятельное направление, полезный контент или канал связи;
- сокращать товарную или проектную модель ради визуального минимализма;
- заменять работающую галерею одним изображением;
- менять slug, URL, имя или путь медиа;
- разрывать связь публичных шаблонов с локальной админкой;
- вводить обязательную связь товар ↔ объект;
- показывать внутреннее производство, цех, оборудование, сотрудников или производственный процесс.

Последнее правило владельца имеет приоритет над прежними спецификациями и исследовательскими рекомендациями. Возможность изготовления изделий допустимо описывать через результат, материалы, документы, выполненные объекты и понятный процесс взаимодействия, но не через показ внутреннего производства.

Иерархия источников для этого аудита:

1. Последние прямые решения владельца: no-production, полное сохранение media, отсутствие обязательной связи товар ↔ объект.
2. Фактически работающий публичный код, routes, content и admin dependencies.
3. docs/MASTER_SPEC.md только для неразрешённых намерений. Его требования отдельной страницы «Производство», фото цеха и обязательных forms противоречат более поздним решениям/фактическому сайту и не входят в preservation baseline.
4. System A/B/C только как visual language.
5. Pilot research только как набор проверяемых design candidates.

## 2. Зафиксированный объём

| Слой | Фактический объём | Источник истины |
|---|---:|---|
| Канонические содержательные публичные маршруты | 106 | Astro templates + active content entries |
| Legacy-маршруты | 3 | два Astro redirect и один meta-refresh alias |
| Страница 404 | 1 | src/pages/404.astro |
| Публичная поверхность с legacy и 404 | 110 | локальная production-сборка |
| Изолированные noindex design-lab маршруты | 3 | src/pages/design-lab |
| Административные страницы | 5 | src/pages/admin |
| Всего HTML-страниц в текущей сборке | 118 | dist |
| Основные направления бизнеса | 7 | 5 product sections + 2 services |
| Сквозные коммерческие контуры | 2 | изготовление на заказ и комплексные работы/объекты |
| Активные категории | 20 | src/content/product-categories |
| Активные товары | 68 | src/content/products |
| Опубликованные объекты | 4 | 4 active из 6 project entries |
| Активные вакансии | 1 | src/content/jobs |
| Зафиксированные интерфейсные механизмы | 19 | компоненты и публичные шаблоны |
| Медиа в public | 331 | 211 PNG, 82 JPG, 9 JPEG, 26 SVG, 3 MP4 |
| Уникальные локальные media references в данных | 252 | content/JSON; отсутствующих файлов не найдено |

Семь основных направлений: уличная мебель, ограждения, навесы, металлоконструкции, топиарии, благоустройство, строительство. Они не могут быть заменены тремя абстрактными сценариями.

## 3. Полный маршрутный контракт

### 3.1 Фиксированные канонические страницы

| Маршрут | Назначение | Требование | Основной риск |
|---|---|---|---|
| / | Главная, полный обзор компании и переходы ко всем контурам | Улучшить композицию, сохранить смысловой и функциональный объём | Сведение компании к благоустройству или трём сценариям |
| /ulichnaya-mebel/ | Вход в товарный каталог уличной мебели | Сохранить | Подмена полным интернет-магазином или слишком общей витриной |
| /vypolnennye-obekty/ | Листинг опубликованных объектов | Улучшить, не теряя карусели и маршрутов | Замена статичной подборкой |
| /izgotovlenie-na-zakaz/ | Сквозной маршрут индивидуальной конструкции | Усилить | Растворение в каталоге либо металлоконструкциях |
| /kontakty/ | Все контактные каналы, карта, география | Сохранить и улучшить | Потеря второго телефона, Telegram, карты или регионов |
| /vakansii/ | Трудоустройство | Сохранить и расширить вывод существующих полей | Удаление как «непродающей» страницы |
| /politika-konfidencialnosti/ | Юридическое описание обработки данных и cookie | Сохранить; обновлять при появлении формы/consent | Несоответствие фактической аналитике и новым формам |

### 3.2 Топ-уровневые страницы из content collections

| Маршрут | Тип | Требование |
|---|---|---|
| /ograzhdeniya-i-zabory/ | product section | Сохранить самостоятельным направлением |
| /navesy-i-kozyrki/ | product section | Сохранить самостоятельным направлением |
| /metallokonstruktsii-dlya-biznesa/ | product/project | Сделать первичным коммерческим входом |
| /topiarii/ | product section | Сохранить собственное имя и доступность |
| /blagoustroystvo-territoriy/ | service | Сохранить |
| /stroitelstvo-i-remonty/ | service/project | Сделать первичным входом и усилить реальными доказательствами масштаба |
| /o-nas/ | static page | Сохранить, исключив будущий публичный показ производства |

### 3.3 Категории

Полный канонический набор категорий:

- /ulichnaya-mebel/besedki-i-pergoly/
- /ulichnaya-mebel/kacheli/
- /ulichnaya-mebel/lavochki-i-skameyki/
- /ulichnaya-mebel/malye-elementy/
- /ulichnaya-mebel/navesy/
- /ulichnaya-mebel/shezlongi/
- /ulichnaya-mebel/stoly-i-komplekty/
- /ulichnaya-mebel/ulichnoe-osveshchenie/
- /ulichnaya-mebel/urny/
- /ulichnaya-mebel/vazony-i-tsvetochnitsy/
- /ulichnaya-mebel/veloparkovki/
- /ograzhdeniya-i-zabory/dekorativnye-ograzhdeniya/
- /ograzhdeniya-i-zabory/gazonnye-ograzhdeniya/
- /ograzhdeniya-i-zabory/kalitki/
- /ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/
- /ograzhdeniya-i-zabory/perila-i-poruchni/
- /ograzhdeniya-i-zabory/sekcionnye-ograzhdeniya/
- /ograzhdeniya-i-zabory/stolbiki-i-bollardy/
- /ograzhdeniya-i-zabory/vorota/
- /ograzhdeniya-i-zabory/zabory/

Все 20 URL и соответствующие записи должны сохраниться. Изменение иерархии допускается только с картой 301 redirects и подтверждением владельца.

### 3.4 Товарные маршруты

Полный набор 68 detail URL задаётся активными файлами src/content/products и родительскими категориями. Для проверки без двусмысленности ниже приведены route groups.

| Родительский маршрут | Товарные slug |
|---|---|
| /ulichnaya-mebel/besedki-i-pergoly/ | besedka-kofe, besedka-kub, pergola-lamel, pergola-s-lavkoy |
| /ulichnaya-mebel/kacheli/ | kachel-duga, kachel-patio, kachel-portal, kachel-s-navesom, kacheli-pergola, kacheli-s-dlinnym-navesom |
| /ulichnaya-mebel/lavochki-i-skameyki/ | bolshaya-skameyka-amplituda, skamya-bulvar, skamya-kapsula, skamya-kontur, skamya-liniya, skamya-liniya-so-spinkami, skamya-loft, skamya-park, skamya-plato, skamya-podium, skamya-radius, skamya-radius-so-spinkami, skamya-reyka, skamya-skoba, skamya-smu1-bazovaya, skamya-volna |
| /ulichnaya-mebel/malye-elementy/ | sidenie-kub, sidenie-pilon |
| /ulichnaya-mebel/navesy/ | ekran-s-navesom, naves-galereya, naves-terra |
| /ulichnaya-mebel/shezlongi/ | shezlong-dyuna, shezlong-siluet, shezlong-vitok, shezlong-volna |
| /ulichnaya-mebel/stoly-i-komplekty/ | stol-so-skamyami-orbita |
| /ulichnaya-mebel/ulichnoe-osveshchenie/ | fonar-liniya, fonar-mayak, fonar-prizma, fonar-sektor, fonar-vektor, fonar-vektor-vysokiy |
| /ulichnaya-mebel/urny/ | stantsiya-razdelnogo-sbora, urna-blok, urna-ellips, urna-kolonna, urna-layn, urna-monolit, urna-panel, urna-profil, urna-slim, urna-vertikal |
| /ulichnaya-mebel/vazony-i-tsvetochnitsy/ | vazon-gorizont, vazon-koltso, vazon-kontur, vazon-lenta, vazon-oval, vazon-ritm, vazon-soft |
| /ulichnaya-mebel/veloparkovki/ | parkovka-dlya-samokatov-arka, veloparkovka-duga, veloparkovka-marker, veloparkovka-pik, veloparkovka-pilon, veloparkovka-ramka |
| /ograzhdeniya-i-zabory/ograzhdeniya-kontejnernyh-ploshchadok/ | konteynernaya-ploshchadka-duo, konteynernaya-ploshchadka-modul, konteynernaya-ploshchadka-zakrytaya |

Контракт товарного detail:

- active product получает URL при active parent section и category;
- showInCatalog=false скрывает товар из листинга, но не удаляет active detail URL;
- relatedProductSlugs или автоматические related products внутри категории/раздела сохраняются;
- обязательной связи товар ↔ объект нет и в будущем быть не должно;
- SKU, изображения, галерея, размеры, характеристики, материалы, цвета, варианты, price mode, доставка, related products и custom-project block не сокращаются.

### 3.5 Объекты

Опубликованные detail URL:

- /vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/
- /vypolnennye-obekty/gorodskie-kacheli-dlya-obshchestvennyh-territoriy/
- /vypolnennye-obekty/kompleks-rabot-na-proizvodstvennoy-territorii/
- /vypolnennye-obekty/remont-skvera-na-ulitse-gogolya/

Два inactive project entries сохраняются в данных, но не становятся публичными до смены статуса. Маршрут «Комплекс работ на производственной территории» подтверждает строительные работы, включая основания и сборку зданий/цехов. Это не разрешение показывать внутреннее производство СМУ-1: будущая публичная медиаподборка требует ручной классификации кадров. Внутренние производственные сцены не публикуются, но исходные файлы не удаляются.

### 3.6 Legacy, error, lab и admin

| Маршрут | Текущее состояние | Контракт |
|---|---|---|
| /lavochki-i-skameyki/ | Astro 301 | Сохранить permanent redirect |
| /urny/ | Astro 301 | Сохранить permanent redirect |
| /navesy/ | meta refresh с indexable layout | Заменить настоящим permanent redirect, не удаляя alias |
| /404 | отдельная страница | Сохранить и добавить noindex |
| /design-lab/system-a/, /system-b/, /system-c/ | noindex prototypes | Не считать частью коммерческой IA; не переносить их сокращённую структуру |
| /admin/, /admin/catalog/, /admin/pages/navesy/, /admin/technical/, /admin/visual/ | локальная админка | Не менять в ходе визуального редизайна; обеспечить data round-trip |

## 4. Навигационный контракт

### 4.1 Текущее desktop/mobile меню

src/data/navigation.json содержит ровно десять пунктов:

1. Уличная мебель.
2. Ограждения.
3. Навесы.
4. Металлоконструкции.
5. Топиарии.
6. Благоустройство.
7. Строительство.
8. Объекты.
9. Контакты.
10. Вакансии.

Desktop header дополнительно содержит логотип, основной телефон и Telegram. Mobile menu повторяет десять пунктов, добавляет «Изготовление на заказ», оба телефона, email, Telegram, адрес, повторные ссылки на объекты и контакты.

| Элемент | Задача | Решение | Риск регрессии |
|---|---|---|---|
| Все десять текущих пунктов | Доступ ко всем компетенциям и сервисным страницам | Сохранить доступ не глубже одного раскрытия | Исчезновение направлений внутри общего «Услуги» |
| Металлоконструкции и строительство | Продажа крупных инженерных работ | Оставить видимыми top-level на desktop | Восприятие как второстепенных услуг |
| Телефон | Быстрый B2B-контакт | Сохранить в desktop и mobile | Потеря конверсии |
| Telegram | Низкопороговый контакт | Сохранить как явное сервисное действие | Скрытие только в footer |
| «Получить расчёт» | Основной коммерческий CTA | Добавить/унифицировать, сохранив прямые каналы | CTA без понятного способа связи |
| Overlay → scrolled header | Медийный hero и читаемость после scroll | Улучшить: прозрачный поверх video, светлый fixed после 72px/границы hero | Плохой контраст на кадрах или скачок layout |
| Mobile full menu | Полная карта сайта и контакты | Сохранить объём, добавить focus trap/return и scroll lock | Непроходимая клавиатурная навигация |

showInMenu/menuTitle в content entries сейчас не управляют Header: фактический source of truth — navigation.json через src/utils/navigation.ts. Любая новая dropdown-модель требует явной миграции singleton и админки, а не предположения, что эти поля уже работают.

## 5. Главная страница

Текущая последовательность:

1. SectionNavigator.
2. Hero с отдельными desktop/mobile video и poster, CTA на контакты и объекты, мета-ссылками на каталог, услуги и объекты.
3. Who we are.
4. Три pathway.
5. Пять продуктовых направлений.
6. Два service-направления.
7. Trust/object block.
8. Прямые контакты: Telegram, email, телефон.

| Что уже работает | Что сохранить | Что улучшить | Риск |
|---|---|---|---|
| Hero на реальном видео и широкое текущее позиционирование | Оба видео, posters, два коммерческих действия | Уменьшить текстовую нагрузку и проверить focal point | Закрытие видео огромным текстом |
| Пять product sections и два services названы явно | Все семь направлений | Превратить в карту компетенций с разной ролью блоков | Одинаковые карточки делают строительство визуально вторичным |
| Объекты и прямые контакты | Ссылку на архив и три канала | Подать разные типы результата и контекстный CTA | Статичная «красивая» подборка без доказательности |
| Три pathways помогают первичной ориентации | Их смысл, если он не дублирует дерево | Сделать сквозными типами задачи, не бизнес-иерархией | Ложное сокращение компании до трёх сценариев |
| Who we are объясняет компанию | Проверенные утверждения | Убрать будущие обещания показа производства | Противоречие решению владельца |

Пробелы текущей главной:

- масштаб строительства зданий и роль металлоконструкций недостаточно капитализируются;
- повторяются pathway и последующие direction blocks без чёткого различия задач;
- часть trust-контента и изображений имеет placeholder-характер;
- нет структурированного brief, только прямые каналы;
- строительство, металлоконструкции, топиарии, ограждения и навесы можно пропустить при быстром просмотре;
- вакансия не имеет видимого входа в основном content flow, хотя сохранена в меню/footer.

## 6. Контракт направлений и контента

| Направление | Текущий смысл | Сохранить/улучшить | Риск |
|---|---|---|---|
| Уличная мебель | 11 категорий, 65 товаров | Сохранить taxonomy и product detail | Свести всё к нескольким featured SKU |
| Ограждения | 9 категорий, 3 товара в одной заполненной категории | Сохранить все category routes и section page | Пустые категории могут выглядеть как ошибка; нужны честные состояния |
| Навесы | Типы, объекты, этапы, факторы цены, примеры | Сохранить отдельный маршрут | Растворить в уличной мебели |
| Металлоконструкции | Каркасы, фермы, площадки, лестницы, кронштейны, опоры, конструкции по чертежам | Поднять в primary navigation и проектный режим | Свести к custom product |
| Топиарии | Самостоятельные типы и сценарии применения | Сохранить имя и маршрут | Скрыть внутри декора/благоустройства |
| Благоустройство | Scope работ на территории, этапы, цена, объекты | Сохранить как service/project | Подменить всей идентичностью компании |
| Строительство | Строительно-монтажные работы, частные/коммерческие/промышленные объекты | Усилить доказательством active project без внутренних производственных кадров | Недопродать здания и крупный масштаб |
| Изготовление на заказ | Работа по фото, эскизу, размерам и ТЗ | Сохранить как сквозной маршрут | Создать обязательную зависимость от каталога |
| Выполненные объекты | Доказательства результата | Сохранить полноценный архив/detail/gallery | Свести к декоративной ленте |
| Вакансии | Одна active vacancy и rich job fields | Сохранить; вывести все существующие поля и контакт | Удалить или оставить без действия |

## 7. Каталог и товар

### 7.1 Текущая функциональность

- section → category → product URL hierarchy;
- breadcrumbs и BreadcrumbList JSON-LD;
- серверный отбор active/showInCatalog записей;
- карточки с изображением, названием и переходом;
- product main image + gallery, cyclic arrows и thumbnails;
- SKU;
- price modes: «от», «по запросу», расчёт;
- features, description, dimensions/specifications;
- materials и colors;
- customizationItems;
- delivery block;
- related products;
- custom project block;
- Telegram/email/phone CTA;
- responsive layout и lazy loading ниже первого основного изображения.

Пользовательской фильтрации, поиска и сравнения сейчас нет. Их можно добавить после проверки потребности и заполненности полей; нельзя заявлять их как уже существующую функцию.

### 7.2 Preservation

| Элемент | Решение | Риск |
|---|---|---|
| Hierarchy и canonical URL | Сохранить | Потеря SEO и входящих ссылок |
| Карточки | Улучшить плотность и сравнимость | Удаление важных фактов ради «чистоты» |
| Product gallery | Сохранить изображения, порядок, стрелки и thumbnails; улучшить accessibility | Замена статичной фотографией |
| Price mode | Сохранить честные статусы | Фиктивные цены или скрытие способа расчёта |
| Specs/materials/colors/customization/delivery | Сохранить полностью | Неполная карточка для архитектора/закупщика |
| Related products | Сохранить product-product логику | Ошибочная обязательная project relation |
| Documents | В текущей модели нет | Только additive schema/admin/renderer после появления реальных файлов |
| Filters/search/compare | В текущем UI нет | Вводить только пропорционально данным и с URL/SEO-правилами |

## 8. Выполненные объекты и галереи

### 8.1 Listing carousel

- до шести изображений объекта;
- cyclic previous/next;
- dots;
- autoplay 5200 ms;
- пауза при hover, focus и hidden document;
- карточка открывается мышью и Enter/Space;
- все listing slides lazy;
- reduced-motion отключает autoplay через CSS/JS-связку.

Пробелы: нет подписей, скрытые slides не имеют полного aria-state, dots малы, autoplay не имеет видимой Pause.

### 8.2 Detail gallery

- нормализует image, coverImage, gallery и images;
- сохраняет порядок и удаляет дубли по src;
- cyclic arrows;
- thumbnails;
- первое изображение eager/fetchpriority, thumbnails lazy;
- structured alt/caption поддержаны моделью и UI;
- portrait images не обрезаются: contain foreground + blurred cover background.

В текущих active project JSON captions фактически не заполнены. Swipe, fullscreen/lightbox, Escape, ArrowLeft/ArrowRight и video items не реализованы.

### 8.3 Product и category galleries

Product gallery имеет main image, cyclic arrows и thumbnails; используется единый imageView без per-image alt/caption. Category gallery статична, но поддерживает structured src/alt/caption и lazy loading.

### 8.4 Обязательное улучшение без потери

- сохранить все URL, порядок изображений и metadata;
- сохранить стрелки и thumbnails;
- добавить swipe на mobile;
- добавить fullscreen с явным close, Escape, focus trap/return;
- добавить ArrowLeft/ArrowRight;
- сделать per-item alt/caption управляемыми через schema и admin;
- первая значимая фотография eager, остальные lazy;
- сохранять безопасную подачу вертикальных кадров;
- autoplay использовать только с Pause и reduced-motion;
- video в project gallery считать новой функцией: нужен additive schema + admin + renderer + import/export.

Новый дизайн не имеет права заменять эти механизмы одним статичным media block.

## 9. Формы, CTA и контакты

Публичной lead form сейчас нет. На сайте есть:

- tel links;
- Telegram;
- email;
- CTA на контакты;
- direct contact block;
- CTA product/custom project;
- карта и Яндекс rating badge на contacts.

Metadata контактов ошибочно упоминает «форму связи», а privacy page прямо фиксирует отсутствие forms/uploads/account/cart/payment.

| Решение | Статус |
|---|---|
| Сохранить телефон, второй телефон, Telegram, email, адрес, регионы, карту, rating badge | Обязательно |
| Унифицировать основной CTA «Получить расчёт» | Улучшение |
| Добавить короткий structured brief | Новая функция только после согласования backend, privacy, consent, honeypot/rate limit, success/error и fallback contacts |
| Удалить прямые каналы после появления формы | Запрещено |
| Придумать SLA ответа | Запрещено без подтверждённого факта |

Vacancy page сейчас выводит summary, хотя данные содержат responsibilities, requirements и conditions. Будущая версия должна начать показывать эти существующие поля и дать честный канал отклика.

## 10. Motion и интерактивность

Текущая система включает:

- transition overlay/scrolled header;
- underline навигации;
- button lift и focus;
- card/image hover zoom около 420 ms;
- IntersectionObserver reveal около 640 ms со stagger до 280 ms;
- object crossfade около 420 ms;
- section marker/scrollspy;
- hero video autoplay/fallback;
- mobile menu open/close;
- cookie banner и reopen.

Сохранить семантическую роль, но улучшить:

- content должен быть видим без JavaScript;
- reduced-motion выключает reveal transforms, smooth scroll, carousel autoplay и hero playback, показывая poster;
- hover не должен быть единственным носителем информации;
- header state не должен вызывать layout shift;
- gallery transitions не блокируют управление;
- тяжёлые scroll effects, blur и page transitions не добавляются без performance budget.

Текущий reduced-motion неполон: hero JS всё ещё пытается autoplay/retry, а section/cookie smooth scroll сохраняется.

## 11. Mobile и accessibility

Сохранить:

- отдельное mobile hero-video;
- полный mobile menu, а не сокращённый hamburger-only список;
- все contact links;
- responsive product/project layouts;
- portrait-safe media;
- lazy loading ниже первого экрана.

Улучшить:

- focus trap и возврат focus у menu/lightbox;
- body scroll lock;
- aria-current в navigation и breadcrumbs;
- Escape для menu/lightbox;
- swipe и keyboard gallery controls;
- видимую Pause для autoplay;
- минимум 44×44 CSS px для touch actions;
- отсутствие horizontal overflow на 320–390 px;
- длинные русские названия без обрезания;
- semantic list исправления SectionNavigator;
- mobile-альтернативу SectionNavigator либо честное удаление этого вспомогательного уровня, но не основных ссылок.

## 12. Данные, CMS и зависимости

### 12.1 Collections и singleton

Восемь Astro collections:

- 5 product-sections;
- 20 product-categories;
- 68 products;
- 2 services;
- 6 projects;
- 1 job;
- 4 static-pages;
- 1 site-settings.

Отдельные singleton: navigation.json и yandex.json.

Главная зависит от home static page, active/showOnHome product sections/services и active pageBlocks. Категория зависит от active parent section. Listing товара использует isActive + showInCatalog. Object listing/detail используют active projects. Vacancies используют active jobs и settings. Contacts используют settings и yandex.

### 12.2 Административный контракт

| Функция | Сохранить | Риск |
|---|---|---|
| CRUD восьми collections | Да | Обычные POST/PUT сейчас не вызывают Zod до записи |
| Navigation/Yandex singletons | Да | Новая nav hierarchy требует совместимой модели |
| Image/video upload | Да | Потеря путей, имён или форматов |
| Project batch upload + content-hash dedupe | Да | Нарушение порядка gallery |
| JSON import/export full/page/collection | Да | Потеря полей при round-trip |
| Preview/hash/rollback import | Да | Необратимая запись без preview |
| Publish scope src/content + navigation + public/uploads | Да | Попадание presentation-only кода или удаление медиа |
| Visual editor fields | Улучшить | Сейчас presentation fields рекурсивно удаляются при save |

Критические технические gaps:

- CRUD должен валидировать Zod и parent relations до write;
- сохранение не должно стирать неизвестные/неотредактированные поля;
- rename section не каскадит parentSectionSlug, rename product не каскадит relatedProductSlugs, links тоже не каскадятся;
- reserved route set неполон;
- project schema богаче visual editor;
- jobs public template не выводит все уже сохранённые rich fields;
- project-pages.json и FAQ data сейчас dormant; их нельзя удалять автоматически.

Все slugs на этапе редизайна замораживаются. Любая миграция выполняется через dependency graph, redirects, snapshot и round-trip tests.

## 13. SEO-контракт

Сохранить:

- canonical и absolute OG;
- title/description;
- sitemap и robots;
- LocalBusiness и WebSite JSON-LD;
- BreadcrumbList;
- base-aware URL;
- production SITE_URL guard.

Улучшить:

- исключить design-lab, admin, aliases, inactive records и noindex pages из sitemap;
- заменить /navesy/ настоящим 301;
- добавить noindex к 404;
- использовать реальные project/category/service OG images;
- добавить Product/Service/Project/JobPosting schema только при наличии подтверждённых полей;
- исправить шесть active category seoDescription со значением «Описание страницы.» после редакторского согласования;
- не создавать фиктивные Offer, rating, clients, certificates или цифры.

## 14. Медиа и логотип

Обязательные video paths:

- /uploads/media-1779034941013.mp4 — desktop hero;
- /uploads/hero-home-mobile.mp4 — mobile hero;
- /uploads/media-1779031688602.mp4 — сейчас не найден в src references, но должен сохраниться.

Контракт:

- все 331 файла сохраняются с теми же путями, именами, URL, байтами и hashes;
- все 252 текущие ссылки остаются разрешимыми;
- desktop/mobile hero videos и posters остаются основой первого экрана;
- hero использует autoplay, muted, loop, playsinline; reduced-motion показывает poster и не инициирует playback;
- никакое изображение не заменяется stock/generated media;
- unused и placeholder media не удаляются без отдельной инвентаризации и решения владельца;
- исходные logo files и геометрия не меняются;
- white/dark/возможная согласованная accent-версия той же геометрии — только отдельная будущая задача после согласования.

В src/content/static-pages/home.json и about.json есть текущие упоминания «в цехе», «производство» и placeholder «Фото производства». Эти данные сейчас сохраняются неизменными, но будущая публичная редактура должна убрать обещание показать внутреннее производство после согласования владельца. Это content-governance задача, не разрешение удалять исходные медиа.

## 15. Реестр 19 сохраняемых механизмов

| № | Механизм | Решение | Риск регрессии |
|---:|---|---|---|
| 1 | Desktop navigation | Сохранить полный доступ, улучшить grouping | Потеря направления |
| 2 | Mobile fullscreen navigation | Сохранить объём, улучшить a11y | Недоступные ссылки/контакты |
| 3 | Overlay → scrolled header | Сохранить и стабилизировать | Контраст/layout shift |
| 4 | Phone link | Сохранить | Потеря звонков |
| 5 | Telegram link | Сохранить | Потеря низкопорогового контакта |
| 6 | Email link | Сохранить | Потеря B2B-документооборота |
| 7 | Responsive hero video + poster | Сохранить desktop/mobile | Потеря ключевого media |
| 8 | SectionNavigator/scrollspy | Улучшить либо заменить эквивалентом | Потеря ориентации на длинных страницах |
| 9 | Anchor scrolling | Сохранить с reduced-motion | Непредсказуемый scroll |
| 10 | Reveal motion | Сохранить мягко | Скрытый контент/CLS |
| 11 | Hover/focus motion | Улучшить | Hover-only информация |
| 12 | Object listing carousel | Сохранить и исправить controls | Замена статикой |
| 13 | Object detail gallery | Сохранить и расширить | Потеря изображений/порядка |
| 14 | Product gallery | Сохранить и расширить | Потеря выбора изображений |
| 15 | Category photo grid | Сохранить | Потеря alt/captions |
| 16 | Breadcrumbs + schema | Сохранить | UX/SEO регрессия |
| 17 | Cookie notice + reopen | Перевести в согласованный consent | Аналитика не соответствует выбору |
| 18 | Yandex map + rating badge | Сохранить с lazy/fallback | Third-party performance/privacy |
| 19 | Direct CTA system | Сохранить и унифицировать | Форма вытесняет прямые каналы |

## 16. Конфликты, требующие решения владельца

1. Какие существующие кадры industrial project допустимы как внешний результат строительства, а какие раскрывают внутреннее производство.
2. Разрешено ли редакционно заменить текущие упоминания «цеха/производства» без потери утверждения о способности изготовить изделия.
3. Нужна ли новая lead form и какой внешний backend/юридический текст допустим.
4. Какие документы реально доступны для product/service pages.
5. Нужны ли публичные priceFrom или только честные price modes по категориям.
6. Какие project facts можно публиковать: заказчик, сроки, объём, роль, география.
7. Следует ли сохранять dormant FAQ/project-pages как будущий контент или архивировать после отдельного решения.
8. Допустимы ли дополнительные цветовые версии неизменной геометрии logo.

## 17. Условие приёмки контракта

Редизайн считается сохраняющим текущий сайт только если:

- все 106 canonical content routes доступны или имеют согласованные one-to-one permanent redirects;
- три legacy aliases продолжают корректно перенаправлять;
- семь направлений и два сквозных контура доступны и не стали второстепенными;
- 20 categories, 68 products, 6 project records, 1 job и все static/settings entries проходят schema round-trip;
- 19 механизмов сохранены или улучшены с documented equivalence;
- все медиа и URL сохранены;
- оба hero videos работают по device rules;
- gallery functionality не сокращена;
- direct contact channels не потеряны;
- админка, import/export и build видят те же данные;
- производство не предлагается и не показывается;
- product ↔ project relation остаётся необязательной и отсутствует как schema requirement.

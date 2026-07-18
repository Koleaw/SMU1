# Gap-анализ текущего сайта и System A/B/C

Статус: аналитический документ, не спецификация реализации.  
Дата: 12 июля 2026 года.  
Источники: текущие публичные шаблоны и content collections, локальная сборка, src/components/design-lab/DesignSystemSpecimen.astro, src/styles/design-lab.css, материалы docs/design-lab/pilot и docs/design-lab/prototypes.

## 1. Основной вывод

System A, B и C успешно проверяют новый визуальный язык, но не моделируют будущую информационную архитектуру. Каждый specimen — одна и та же сокращённая демонстрационная страница с пятью anchor-пунктами, тремя сценариями, шестью названиями категорий, тремя товарами, одним статичным объектным фрагментом и одной custom-service секцией.

Текущий сайт существенно шире:

- 106 канонических содержательных маршрутов;
- 7 самостоятельных бизнес-направлений;
- 20 активных категорий;
- 68 активных товаров;
- 4 опубликованных объекта с листингом и detail galleries;
- отдельные контакты, вакансии, privacy, about, custom order;
- 19 интерфейсных механизмов;
- локальная CMS/data модель и SEO-контур.

Следовательно, переносить можно визуальные принципы и отдельные композиционные приёмы. Перенос сокращённой навигации, трёх сценариев как бизнес-архитектуры или статичных fragments приведёт к функциональному и коммерческому регрессу.

## 2. Что прототипы действительно улучшили

Общее для A/B/C:

- Manrope для body и Raleway для headings используются последовательнее;
- 12-column grid и контейнер до 1320 px дают более уверенную desktop-композицию;
- product mode светлый и технически читаемый;
- крупные реальные изображения получают композиционную роль, а не становятся фоном одинаковых cards;
- радиусы 0–2 px, тонкие линии и почти полное отсутствие теней лучше соответствуют B2B/engineering характеру;
- три режима — Cinematic, Product, Project — визуально различимы, но связаны typography, spacing, buttons и media rules;
- CTA яснее отделены от secondary links;
- предусмотрены focus states, reduced motion и lazy loading ниже hero;
- existing desktop/mobile hero videos сохранены в specimen;
- интерфейс перестаёт быть механическим чередованием одинаковых белых/graphite sections.

Это визуальные улучшения, а не подтверждение корректности prototype content architecture.

## 2.1 Текущий visual baseline

Измеренные tokens из src/styles/global.css:

| Группа | Текущее значение | Вывод |
|---|---|---|
| Основной/поверхность | #FFFFFF / #FFFFFF | Каталог читаем, но section hierarchy часто зависит только от контента |
| Тёмная поверхность/панель | #13181C / #1A2024 | Подходит локально, но механическое чередование даёт тяжёлые полосы |
| Text/muted | #11161A / #59636D | Рабочая контрастная основа |
| Accent/hover | #18B663 / #149654 | Яркий зелёный сильнее связывает бренд с «эко/благоустройством», чем со строительством и металлом |
| Fonts | Raleway headings, Manrope body | Сохраняются во всех specimens; проблема не в выборе семейства, а в иерархии и применении |
| Desktop type | H1 56, H2 40, H3 28, body 18 px | Рабочая шкала; новый дизайн не требует искусственно огромного display text |
| Container/padding | 1280 px; 24/20/16 px | Specimen расширяет container до 1320 и формализует 12 columns |
| Section spacing | 96/72/56 px | Основа уже существует; specimens делают ритм более композиционным |
| Radius/shadow | 4–6 px; лёгкие card shadows | Specimens снижают radius до 0–2 и чаще используют lines |

Текущая система уже содержит правильные fonts, restrained shadows и responsive spacing. Качественный скачок prototypes создаётся прежде всего композицией, media hierarchy, grid и более дисциплинированной ролью цвета, а не полной заменой всех tokens.

## 3. Количественная потеря

| Слой | Текущий сайт | Каждый specimen | Потеря при прямом переносе |
|---|---:|---:|---|
| Видимые navigation concepts | 10 current items + contacts | 5 generic anchors | Именованные направления, вакансии, быстрые контакты |
| Основные направления | 7 | 3 abstract pathways | 4+ компетенции растворяются |
| Categories | 20 routes | 6 названий без route tree | 14 категорий и вся иерархия |
| Products | 68 detail routes | 3 fragments | 65 карточек и большая часть полей |
| Active projects | 4 details + listing | 1 static fragment | Архив, три объекта и gallery functions |
| Job routes/content | 1 active vacancy | 0 | Полная потеря recruiting contour |
| Direct contact mechanisms | phone, second phone, TG, email, map, rating, address, regions | CTA + сокращённый footer | Потеря проверенных low-friction paths |
| Existing functional mechanisms | 19 | только часть визуальных states | Галереи, breadcrumbs, cookie, map и другое не представлены |

## 4. Самые серьёзные общие gaps

### 4.1 Навигация

Prototype header показывает «Каталог / Услуги / Объекты / О компании / Контакты». Текущий navigation.json показывает «Уличная мебель / Ограждения / Навесы / Металлоконструкции / Топиарии / Благоустройство / Строительство / Объекты / Контакты / Вакансии», а Header дополнительно содержит телефон и Telegram.

Прямой перенос:

- уберёт семь именованных компетенций из первого навигационного уровня;
- сделает строительство и металлоконструкции менее заметными;
- удалит вакансии;
- увеличит число действий до конкретного направления;
- уберёт быстрые каналы B2B-контакта.

Допустим перенос прозрачности, типографики и transition header. Структура prototype header не переносится.

### 4.2 Позиционирование

Prototype hero говорит о решениях «для городских пространств». Это соответствует части уличной мебели и благоустройства, но сужает реальный бизнес. Текущий home hero прямо называет изделия, металлоконструкции, строительство и благоустройство.

При прямом переносе исчезнут или ослабнут:

- строительство зданий и строительно-монтажные работы;
- промышленные и коммерческие задачи;
- инженерные металлоконструкции;
- ограждения, навесы, топиарии как самостоятельные направления.

Media composition можно переносить. Urban-only copy нельзя.

### 4.3 Ложная иерархия из трёх сценариев

Prototype pathways «каталог / индивидуальная конструкция / работы на объекте» полезны как способы обращения, но не равны структуре бизнеса. Текущий source of truth — пять product sections, две services, custom order, projects, contacts и jobs.

Три сценария допустимы только как вторичный routing aid. Они не могут заменить карту семи компетенций, taxonomy и основные navigation entries.

### 4.4 Товарная глубина

Prototype product fragment показывает три SKU и краткий технический список. Не представлены:

- section/category breadcrumbs и URL hierarchy;
- 20 categories;
- product main gallery с arrows/thumbnails;
- SKU для всего каталога;
- dimensions/specifications;
- materials, colors, RAL/customization;
- price modes;
- delivery;
- related products;
- custom-project block;
- три direct contact channels;
- active/showInCatalog behavior;
- admin editing and data round-trip.

Строгую светлую сетку можно переносить. Сокращённую data model — нельзя.

### 4.5 Объекты и доказательность

Prototype показывает один крупный static image с короткой подписью. Текущий сайт имеет:

- listing carousel до шести кадров на объект;
- previous/next, dots, autoplay и pause states;
- clickable keyboard card;
- detail gallery с полным набором изображений;
- arrows и thumbnails;
- portrait-safe presentation;
- structured alt/caption capability;
- facts: short, task, whatWasDone, workTypes, scope, materials, features, result.

Static editorial composition может быть первым экраном объекта, но не заменяет полную галерею и факты.

### 4.6 Контакты, trust и careers

В prototypes отсутствуют или сокращены:

- второй телефон и его роль;
- Telegram как service action;
- email;
- адрес и regions;
- Yandex map;
- Yandex rating badge;
- legal details;
- privacy и cookie settings;
- vacancies route и job data.

Эти элементы могут быть визуально спокойнее, но не удаляются.

### 4.7 CMS, data и SEO

Specimens импортируют небольшую выборку реального content, но не проверяют:

- восемь collections;
- navigation/yandex singleton;
- visual admin fields;
- JSON import/export;
- uploads/publish scope;
- parent/child relations;
- slugs и redirects;
- all canonical URLs;
- sitemap/robots;
- canonical/OG/structured data;
- category/product/project generation.

Поэтому ни один specimen нельзя считать техническим template prototype будущей реализации.

## 5. Сравнение систем

### 5.1 System A — «Точная идентичность»

Палитра specimen:

- background #F3F5F1;
- secondary #E7ECE7;
- text #18221D;
- muted #5A665F;
- accent/CTA #285D47;
- secondary accent #9A6845;
- contrast #20352B.

**Что улучшено**

- левый короткий hero-copy хорошо сохраняет focal area существующего видео;
- ясная primary/secondary CTA hierarchy;
- restrained green выглядит зрелее текущего яркого #18B663;
- прямолинейная product grid удобна для каталога;
- локальный тёмно-зелёный contrast может поддержать отдельный cinematic block.

**Что спорно**

- даже более сложный green может снова превратить широкую строительную компанию в «экологичный бренд благоустройства»;
- текущий синий logo конкурирует с зелёным accent;
- систематическое применение dark-green bands вернёт ритм чередующихся полос;
- brown secondary accent нельзя смешивать с цветами B/C.

**Вердикт**

Не брать систему целиком. Безопасно взять left hero composition, CTA hierarchy, restrained contrast surfaces и более тихий green как один из вариантов, но только после проверки на полном media set и logo.

### 5.2 System B — «Оксид и сталь»

Палитра specimen:

- background #F2EFE9;
- secondary #E2E7E8;
- surface #FCFAF6;
- text #242D31;
- muted #636B6E;
- oxide accent #9E4C36;
- steel-blue CTA #31586B;
- contrast #203B49.

**Что улучшено**

- steel-blue лучше других specimens согласуется с существующим синим logo;
- mineral/oxide context поддерживает металл, дерево, мощение и архитектурные фотографии;
- инженерная двухколоночная hero hierarchy создаёт масштаб без чрезмерного размера шрифта;
- light product mode остаётся функциональным;
- oxide можно использовать как редкий project/service marker, а не общий декоративный цвет.

**Что спорно**

- избыток terracotta сделает сайт интерьерным;
- избыток steel-blue сделает его холодно-корпоративным;
- текущая split hero composition может закрыть разные focal points существующего видео;
- prototype still carries all common IA/function gaps.

**Вердикт**

Наиболее устойчивый кандидат для общей neutral/steel foundation, но не готовая бренд-система. Нужны проверки на всех media, текущем logo и реальных длинных templates.

### 5.3 System C — «Камень и бордо»

Палитра specimen:

- background #E9E8E3;
- secondary #D8DFE1;
- surface #F7F6F2;
- text #26363E;
- muted #5B6971;
- accent/CTA #7B2D43;
- secondary accent #607982;
- contrast #2D4D58.

**Что улучшено**

- stone background и cool gray-blue хорошо поддерживают снег, бетон, металл и мощение;
- editorial asymmetry полезна для разных типов объектов;
- graphite не доминирует;
- крупный media block выглядит архитектурно без декоративных effects.

**Что спорно**

- burgundy легко уводит систему в интерьерную, административную или residential visual language;
- right-shifted hero требует отдельной проверки focal point каждого desktop/mobile video;
- одновременное использование burgundy и accents A/B создаст визуальный хаос;
- асимметрия снижает сравнимость товаров и не подходит каталожной сетке.

**Вердикт**

Переносить stone secondary surfaces и controlled object asymmetry. Не переносить burgundy как третий брендовый accent и right hero как универсальное правило.

## 6. Матрица компетенций

| Компетенция | Текущий сайт | A/B/C specimen | Требование к будущему |
|---|---|---|---|
| Уличная мебель | Section, 11 categories, 65 products | Три featured products | Полная taxonomy + compact home overview |
| Ограждения | Section, 9 categories, 3 products | Не представлено как направление | Явный вход и сохранение категорий |
| Навесы | Top-level section + catalog category/products | Один featured product | Явный самостоятельный вход |
| Металлоконструкции | Top-level project/product page | Только общий custom-order смысл | Primary navigation и инженерная подача |
| Топиарии | Top-level page | Нет | Сохранить name/route |
| Благоустройство | Service + objects | Смещено в общее «работы» | Явная service page, не весь бренд |
| Строительство | Service + industrial project proof | Нет | Primary navigation, здания/СМР и real proof |
| Изготовление на заказ | Отдельный route | Представлено хорошо как scenario | Сохранить как cross-cutting contour |
| Комплексные работы | Service/object content | Один scenario | Раскрывать состав и границы работ |
| Вакансии | Route + active job | Нет | Сохранить recruitment contour |

## 7. Матрица функций

| Функция текущего сайта | A/B/C | Решение |
|---|---|---|
| Desktop full navigation | Упрощена | Prototype IA отклонить |
| Mobile full menu + contacts | Только specimen menu pattern | Восстановить полный объём и улучшить a11y |
| Overlay/scrolled header | Header преимущественно светлый | Перенести visual quality, сохранить state model |
| Responsive hero desktop/mobile video | Представлено | Сохранить; взять left composition A как baseline candidate |
| SectionNavigator/scrollspy | Нет | Сохранить роль либо дать эквивалент |
| Object listing carousel | Нет | Сохранить и улучшить |
| Object detail gallery | Нет | Сохранить и улучшить |
| Product gallery | Нет полного механизма | Сохранить |
| Category gallery | Нет | Сохранить |
| Breadcrumbs + JSON-LD | Нет | Сохранить |
| Direct phone/TG/email | Сокращены | Сохранить все |
| Contacts map/rating | Нет | Сохранить lazy/fallback |
| Cookie notice/settings | Нет | Сохранить и исправить consent |
| Vacancies | Нет | Сохранить и усилить |
| CMS CRUD/import/export/uploads | Не проверено | Не менять архитектурой specimen |
| SEO/canonical/sitemap/routes | Не проверено | Сохранить и проверить отдельно |

## 8. Что можно безопасно перенести

Только после превращения в единые production tokens:

1. Manrope body + Raleway headings и более строгая типографическая иерархия.
2. 12-column grid, широкий контейнер и spacing system.
3. Left hero composition A как начальный вариант для текущего видео.
4. Steel-blue/mineral neutral foundation B как кандидат.
5. Stone secondary surfaces C.
6. Асимметрия только на featured objects/services, не в product comparison grid.
7. Светлый Product mode с lines вместо тяжёлых cards.
8. Engineering two-column service composition.
9. Крупные реальные фотографии без filters и decorative masks.
10. Подписи вида type / place / year только при наличии данных.
11. CTA hierarchy и restrained buttons.
12. Радиусы 0–2 px, минимум shadows.
13. Focus states, reduced-motion, lazy media below hero.
14. Тонкие link/hover/reveal/header transitions.
15. Один общий header/footer, buttons, states, media rules для всех modes.

## 9. Что переносить нельзя

1. Пять generic prototype nav items как полную шапку.
2. Три scenarios как бизнес-архитектуру.
3. Urban-only positioning.
4. Один static image вместо object gallery.
5. Три product fragments вместо 68 detail pages.
6. Минимальные captions вместо specs/materials/price/delivery.
7. Удаление вакансий, privacy, contacts map или service contacts.
8. Hamburger-only desktop navigation.
9. Full-dark catalog/forms.
10. Giant headings, закрывающие hero video.
11. Heavy scroll effects, blur, WebGL или multiple autoplay media.
12. Обязательную product ↔ project relation.
13. Показ собственного production/factory/equipment/process.
14. Stock/generated replacement media.
15. Одновременное смешивание green A, oxide B и burgundy C.
16. Изменение исходного logo или его геометрии.

## 10. Конфликты с более ранним исследованием

В pilot-материалах встречаются идеи связи products с projects и production trust content. Они полезны как observations референсов, но отменены решениями владельца СМУ-1:

- product и project остаются независимыми;
- все существующие files сохраняются, но внутреннее производство не показывается;
- доверие строится на результатах, scope, материалах, документах и объектах;
- промышленный объект допустим как доказательство строительства только после ручной классификации кадров.

Это не отрицание исследования, а адаптация к реальной бизнес-модели и ограничениям владельца.

## 11. Рекомендуемый visual consensus

Консенсус UX, Product, Art, Commercial, B2B, CRO, Frontend, CMS, SEO и domain-аудита:

- **основа:** neutral/steel family System B как кандидат, а не автоматически утверждённая palette;
- **из A:** left hero, direct CTA hierarchy, экономное применение contrast surfaces;
- **из C:** stone secondary surface и object-page asymmetry;
- **единое:** fonts, grid, spacing, header/footer, buttons, focus, radii, rules of captions/media/motion;
- **режимы:** Cinematic для home/objects; Product для catalog/product; Project для construction/metals/services; Practical для contacts/vacancies;
- **запрет:** не смешивать три accent families и не переносить упрощённую architecture.

Compatibility с current logo должна быть проверена на реальных transparent/scrolled header states. Исходный SVG не меняется. Возможные white/dark/accent variants той же геометрии требуют отдельного согласования.

## 12. Что нужно закрыть до реализации

- утвердить superset navigation и не менять slugs;
- вручную классифицировать media с точки зрения no-production policy;
- определить подтверждённые facts для construction/metals/projects;
- решить, нужна ли lead form и её legal/backend model;
- определить доступные product/project documents;
- решить content gaps active categories и vacancy detail;
- проверить выбранные tokens на всех media, длинных русских headings и current logo;
- спроектировать gallery enhancement как сохранение текущих возможностей;
- провести CMS round-trip prototype до перевода всех public templates;
- утвердить redirect, sitemap и structured-data matrix.

До закрытия этих пунктов System A/B/C остаются visual specimens, а не архитектурными кандидатами «целиком».

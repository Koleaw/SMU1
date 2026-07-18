# Коммерческая архитектура будущего сайта СМУ-1

Статус: обратимая архитектурная рекомендация до UX-прототипирования и согласования владельцем.  
Дата: 12 июля 2026 года.  
Принцип: будущий сайт — надмножество текущего, а не сокращённый landing page.

## 1. Командный консенсус

Решение согласовано на уровне ролей UX Architect, Product Designer, Art Director, Commercial Director, B2B Marketing Strategist, CRO Specialist, Senior Frontend Architect, CMS/Content Architect, Technical SEO Architect и SMU-1 Domain Expert:

1. Семь именованных направлений сохраняются и продаются напрямую.
2. Строительство и металлоконструкции становятся первичными входами, а не вложенными второстепенными услугами.
3. Каталог, проектные услуги, объекты, контакты и вакансии сохраняют собственную логику.
4. Три prototype modes — способы визуальной подачи, но не три раздела бизнеса.
5. Доверие строится только на фактическом результате, составе работ, материалах, документах и опубликованных объектах.
6. Внутреннее производство не показывается.
7. Product и project не связываются обязательным отношением.
8. Прямые телефон, Telegram и email сохраняются даже при возможном появлении form.
9. Ни один URL, data field или media asset не удаляется из-за нового дизайна.

При конфликте красоты и полноты выбран вариант с более сильной композицией, но без потери содержания, функции и коммерческого маршрута.

## 2. Коммерческая модель

Архитектура должна поддерживать три логики продаж, не подменяя ими структуру компетенций.

Приоритет — B2B: муниципальные заказчики, девелоперы, генеральные подрядчики, архитекторы, коммерческие и промышленные организации. B2C остаётся вторым контуром для каталожного изделия, частного объекта и индивидуальной конструкции. Careers обслуживает отдельную аудиторию и не смешивается с sales funnel.

### 2.1 Каталог изделий

Задача: дать понятный выбор готового/типового изделия, техническую информацию и быстрый расчёт.

Сущности: product section → category → product.  
Ключевые направления: уличная мебель, ограждения, часть навесов и топиариев.  
Основные доказательства: реальные фото, размеры, материалы, цвета, варианты, price mode, доставка.  
Основной CTA: «Запросить расчёт».

### 2.2 Проектные и строительные работы

Задача: продать компетенцию решить объектную или инженерную задачу, где результат не обязан существовать в каталоге.

Сущности: металлоконструкции, строительство, благоустройство, изготовление на заказ, самостоятельные ограждения/навесы/топиарии по задаче.  
Доказательства: scope, исходные данные, этапы, материалы, ограничения, факт выполненного результата.  
Основной CTA: «Обсудить задачу» или «Отправить ТЗ».

### 2.3 Доверительный контур

Задача: подтвердить реальность компании и снизить риск B2B-заказчика.

Сущности: выполненные объекты, о компании, контакты, реквизиты, география, вакансии.  
Доказательства: реальные фотографии и galleries, город/год, фактический состав работ, контактные данные, карта.  
Основной CTA: контекстный переход к расчёту или прямому контакту.

Эти контуры пересекаются навигационно, но не требуют жёстких relations в CMS.

## 3. Иерархия компетенций

### Уровень 1: самостоятельные направления

1. Уличная мебель.
2. Ограждения и заборы.
3. Навесы и козырьки.
4. Металлоконструкции.
5. Топиарии.
6. Благоустройство.
7. Строительство и ремонты.

Каждое название должно быть доступно из desktop navigation максимум за одно раскрытие и явно присутствовать в mobile navigation.

### Уровень 2: сквозные способы работы

- изготовление конструкции на заказ;
- комплекс работ на объекте;
- подбор каталожного изделия;
- монтаж и связанные работы там, где это подтверждено content;
- выполненные объекты как доказательство.

Это маршруты по задаче, а не замена направлениям.

### Уровень 3: доверие и обслуживание

- о компании;
- контакты;
- вакансии;
- privacy/cookie;
- прямые каналы;
- карта/география/реквизиты.

## 4. Рекомендуемое дерево сайта

Все существующие URL сохраняются. Ниже — navigation grouping, а не предложение массово менять маршруты.

- Главная
- Продукция
  - Уличная мебель
    - 11 текущих категорий
    - 65 текущих товаров
  - Ограждения и заборы
    - 9 текущих категорий
    - 3 текущих товара
  - Навесы и козырьки
  - Топиарии
  - Изготовление на заказ
- Металлоконструкции
- Строительство и ремонты
- Благоустройство территорий
- Выполненные объекты
  - 4 текущих active detail pages
- Компания
  - О компании
  - Контакты
  - Вакансии
  - Политика конфиденциальности

Legacy aliases остаются permanent redirects. Design-lab и admin не входят в коммерческое дерево.

## 5. Desktop navigation

### 5.1 Предлагаемая структура

**Logo | Продукция ▾ | Металлоконструкции | Строительство | Благоустройство | Объекты | Компания ▾ | телефон | Получить расчёт**

Dropdown «Продукция»:

- Уличная мебель;
- Ограждения;
- Навесы;
- Топиарии;
- Изготовление на заказ.

Dropdown «Компания»:

- О компании;
- Контакты;
- Вакансии.

Telegram остаётся явным сервисным действием рядом с контактной зоной или в компактном utility popover; он не переносится только в footer.

### 5.2 Почему так

- Металлоконструкции и строительство видимы постоянно и получают необходимый коммерческий вес.
- Четыре product-oriented направления группируются без потери собственных имён.
- Благоустройство остаётся видимым, но не определяет весь бренд.
- Объекты всегда доступны как proof.
- Careers не исчезают, но не перегружают основной sales row.
- Телефон и CTA остаются в зоне постоянного действия.

### 5.3 Поведение header

- поверх home hero: прозрачный overlay state с проверенным контрастом logo/text/CTA на всех кадрах;
- после 72 px либо выхода hero: светлый fixed state;
- без изменения высоты и layout shift;
- Escape закрывает dropdown;
- dropdown работает keyboard/pointer/touch;
- focus не теряется;
- aria-expanded/controls/current обязательны;
- при reduced motion transition становится мгновенным или коротким без transform.

Прототипная шапка «Каталог / Услуги / Объекты / О компании / Контакты» не принимается.

## 6. Mobile navigation

Полноэкранное или sheet menu сохраняет весь объём:

1. Продукция — раскрываемая группа с пятью явными дочерними ссылками.
2. Металлоконструкции.
3. Строительство.
4. Благоустройство.
5. Объекты.
6. Компания — О компании, Контакты, Вакансии.
7. CTA «Получить расчёт».
8. Основной и второй телефоны.
9. Telegram.
10. Email.
11. Адрес.

Требования: body scroll lock, initial focus, focus trap, return focus, Escape, читаемые длинные русские названия, tap targets от 44×44 CSS px, отсутствие horizontal overflow на 320/390 px.

## 7. Роль главной

Главная не является полным каталогом, подробным project archive или перечнем всех товаров. Её задача — за один просмотр ответить:

1. Кто такие СМУ-1?
2. Что компания изготавливает и выполняет?
3. Какие задачи и масштабы способна закрывать?
4. Где открыть конкретное направление?
5. Где посмотреть выполненный результат?
6. Как получить расчёт или обсудить задачу?

### 7.1 Рекомендуемая последовательность

#### 1. Hero video

- существующие desktop и mobile video;
- короткое full-scope positioning: изделия, металлоконструкции, строительство, благоустройство;
- CTA «Получить расчёт»;
- secondary «Смотреть объекты»;
- текст не закрывает focal point и не превращает hero в banner;
- poster и reduced-motion fallback.

#### 2. Кто мы / масштаб задачи

Короткий фактический statement без выдуманных цифр. Можно назвать Курган, действующую географию и типы задач. Нельзя показывать производство или обещать неподтверждённые мощности.

#### 3. Карта семи компетенций

Все названия видимы одновременно либо без скрытого carousel. Это navigation layer, а не семь одинаковых cards:

- строительство и металлоконструкции — крупные равноправные project entries;
- уличная мебель — taxonomy entry;
- ограждения, навесы, топиарии — самостоятельные product/project entries;
- благоустройство — service/object entry.

#### 4. Продукция

Короткий category overview пяти product sections, а не три product cards. Он ведёт в taxonomy; technical details остаются на category/product pages.

#### 5. Инженерные и объектные работы

Отдельная композиция для:

- строительства;
- металлоконструкций;
- благоустройства;
- изготовления на заказ.

Каждый блок отвечает «какую задачу решаем / что может входить / что прислать», но не раскрывает внутреннее производство.

#### 6. Выполненные объекты

Небольшая выборка разных по типу real cases:

- благоустройство набережной;
- городские качели;
- industrial construction result после media review;
- сквер, если placeholder media заменены реальными или честно обозначены.

Главная не дублирует полный archive и gallery. Каждый entry ведёт в detail.

#### 7. Как начать работу

Фактические inputs из текущего content: фото, размеры, эскиз, чертёж, ТЗ или описание задачи. Без внутренних production steps и неподтверждённых сроков.

#### 8. Trust/contact

География, контакты, реквизиты и прямая связь. Только проверенные факты; без фальшивых clients/certificates/numbers.

#### 9. Careers entry и footer

Небольшая ссылка на вакансии сохраняет recruiting route. Footer содержит основные направления, объекты, контакты, реквизиты, privacy/cookie.

### 7.2 Что объединить, а что не сокращать

Текущие pathways и direction grids можно композиционно перестроить, чтобы убрать дублирование. При этом весь смысл семи направлений сохраняется. Удаление повторного блока допустимо только если его ссылки, тексты и коммерческая задача перенесены в новый блок и проверены content diff.

## 8. Page-mode architecture

### 8.1 Cinematic / Editorial

Страницы: home, object listing/detail, крупные image-led направления.

Правила:

- крупное реальное media;
- контролируемое whitespace;
- factual captions;
- один dominant story focus;
- рядом сохраняются route, scope и CTA;
- editorial hero не заменяет gallery/data.

### 8.2 Product / Technical

Страницы: product sections, categories, product detail.

Правила:

- светлый фон;
- регулярная сравнимая grid;
- breadcrumbs;
- ясные category names;
- specs/materials/colors/price/delivery открыты;
- gallery controls;
- минимум decorative motion;
- filters/search только после подтверждения данных и потребности.

### 8.3 Project / Service

Страницы: строительство, металлоконструкции, благоустройство, навесы/ограждения/custom tasks.

Правила:

- задача → состав → вводные → этапы → факторы стоимости → proof → CTA;
- balanced text/media;
- engineering facts всегда видимы;
- real project proof не требует product relation;
- никаких фото внутреннего производства.

### 8.4 Practical

Страницы: contacts, vacancies, privacy, 404.

Правила:

- минимальная декоративность;
- быстрый доступ к действию;
- ясные адреса/каналы;
- полные job/legal fields;
- тот же header/footer/tokens.

## 9. Роли отдельных разделов

### 9.1 Каталог

Не интернет-магазин, а техническая B2B/B2C-витрина. Он помогает определить тип изделия, изучить параметры и запросить расчёт. Cart/account/payment не нужны, пока бизнес-процесс не подтверждён.

### 9.2 Товары

Карточка должна сохранить все текущие поля и дать:

- media gallery;
- SKU/title/short description;
- price status;
- dimensions/specifications;
- materials/colors/options;
- delivery;
- related products;
- custom project alternative;
- Telegram/email/phone;
- возможный «Запросить расчёт» brief как additive feature.

Documents добавляются только когда есть реальные файлы и полный CMS lifecycle.

### 9.3 Металлоконструкции

Первичный коммерческий маршрут для каркасов, ферм, площадок, лестниц, кронштейнов, опор и конструкций по drawings. Он не становится подстраницей generic «Услуги».

Подача: виды задач, входные материалы, состав решения, ограничения, монтаж/объектный контекст, real cases, CTA «Отправить ТЗ или чертёж».

### 9.4 Строительство

Первичный маршрут. Текущий active project фактически подтверждает подготовку участка, геодезические работы, фундаменты, сборку четырёх цехов, частичную сборку пятого и укрепление существующего фундамента. Это сильнее текущей service page, где основной акцент находится на площадках, входных группах и малых конструкциях.

Будущая страница должна показать два масштаба:

- здания/цеха и комплекс строительно-монтажных работ, строго в границах подтверждённого case;
- прикладные основания, зоны, монтаж и работы по ТЗ.

Нельзя на основании одного case выдумывать новые типы зданий, лицензии, мощности или масштаб портфеля.

### 9.5 Благоустройство

Самостоятельная service page: территория, состав работ, этапность, materials/objects и CTA. Она не должна поглощать весь бренд.

### 9.6 Ограждения

Сохраняются section и девять category routes, даже если product fill пока неравномерен. Честное empty/coming content state лучше выдуманного ассортимента.

### 9.7 Навесы

Сохраняются два контекста: product category внутри уличной мебели и самостоятельное business direction. Навигация и copy должны объяснять разницу между типовым изделием и объектной конструкцией.

### 9.8 Топиарии

Самостоятельное направление с типами, применением, input/reference и CTA. Не прятать в благоустройство или «декор».

### 9.9 Объекты

Архив — trust layer, detail — доказательство. Gallery и facts сохраняются. Filters допустимы только при достаточном количестве cases; с четырьмя active projects достаточно simple tags либо полного списка.

### 9.10 Вакансии

Сохраняются в Company dropdown, mobile menu и footer. Public page должна вывести существующие responsibilities, requirements, conditions и дать реальный канал отклика. Нельзя придумывать employer benefits.

## 10. Целевые аудитории

| Аудитория | Что важно | Какой контент/доказательства нужны | Основной маршрут | CTA | Текущий барьер |
|---|---|---|---|---|---|
| Муниципальный заказчик | Комплексность, материалы, применимость, результат | Scope, city/year, materials, galleries, verified documents при наличии | Home → Благоустройство/МАФ/Ограждения/Топиарии → Объекты → Контакты | Рассчитать по ТЗ | Мало полных project facts и документов |
| Застройщик/девелопер | Закрытие территории и разных элементов | Благоустройство, МАФ, навесы, ограждения, монтаж, реальные объекты | Home → карта компетенций → направления → custom → contact | Обсудить объект / отправить план | Одинаковые cards слабо объясняют cross-scope |
| Генеральный подрядчик | Состав работ, этапы, основания, монтаж, ответственность | Construction/metals scope, drawings, industrial project result | Home → Строительство/Металлоконструкции → объект → contact | Отправить ТЗ/чертёж | Service copy недопродаёт крупные здания |
| Архитектор/проектировщик | Размеры, материалы, варианты, technical files | Product specs, RAL/colors, galleries, documents только при наличии | Catalog → category → product/custom | Запросить подбор/технические материалы | Нет downloads/BIM/certificates; это пробел, не обещание |
| Коммерческая организация | Понятное решение, стоимость, сроки обсуждения | Навесы, ограждения, топиарии, entrance groups, cost factors, geography | Home → направление → contact | Отправить фото и размеры | Нет sector-oriented entry и structured brief |
| Промышленный заказчик | Здания, каркасы, площадки, лестницы, object works | Construction/metals facts и внешний результат industrial project | Home → Строительство + Металлоконструкции → объект → contact | Обсудить строительство / направить ТЗ | Сильное proof не связано с service page |
| Покупатель каталожного изделия | Быстрый выбор и параметры | Gallery, specs, material/color, price status, delivery | Catalog → category → product | Запросить расчёт | Нет search/filter/compare/documents |
| Заказчик индивидуальной конструкции | Возможность сделать по вводным | Что прислать, процесс, materials, similar outcomes | Custom order/metal/fence/canopy → contact | Отправить вводные | Current custom page короткая и частично placeholder |
| Потенциальный сотрудник | Условия и способ отклика | Role, city, employment, salary mode, responsibilities, requirements, conditions | Company → Vacancies → job/contact | Откликнуться / позвонить | Rich job fields не выводятся; нет apply action |

## 11. CTA-архитектура

| Тип страницы | Primary CTA | Secondary action | Момент показа |
|---|---|---|---|
| Главная | Получить расчёт | Смотреть объекты | Hero и после proof |
| Product section/category | Подобрать/запросить расчёт | Изготовление на заказ | После taxonomy и в конце |
| Product detail | Запросить расчёт | Telegram/email/phone | Рядом с price/specs и после details |
| Металлоконструкции | Отправить ТЗ или чертёж | Позвонить | После inputs и case |
| Строительство | Обсудить объект | Смотреть выполненные работы | Hero и после scope/proof |
| Благоустройство | Рассчитать работы | Смотреть объекты | После scope и cases |
| Custom order | Отправить фото, размеры или эскиз | Позвонить | После объяснения inputs |
| Object detail | Обсудить похожую задачу | Все объекты | После facts/gallery |
| Contacts | Написать удобным способом | Карта/маршрут | Сразу |
| Vacancy | Откликнуться | Позвонить | После условий |

Формулировка CTA не обещает срок ответа или цену. Прямые channels сохраняются. Lead form, если будет, должна быть короткой и иметь fallback contacts.

## 12. Доверие без выдумывания фактов

Можно использовать уже существующее:

- company legal data;
- registration date;
- Курган, address и published regions;
- active object names, cities, years и actual scope;
- product/material/dimension fields;
- реальные galleries;
- фактический industrial construction case;
- карту и текущий rating badge как external element.

Нельзя добавлять без подтверждения:

- количество клиентов/объектов/сотрудников;
- production capacity/area/equipment;
- логотипы клиентов;
- сертификаты и лицензии;
- сроки ответа/производства;
- гарантии;
- отзывы;
- coverage geography шире settings;
- fake prices/discounts.

Пробел должен быть записан как content gap и поставлен владельцу, а не заполнен копирайтингом.

## 13. Визуальная система

Не принимать A/B/C целиком.

### 13.1 Рекомендуемая основа

- кандидат нейтралей и steel-blue action hierarchy — System B;
- left hero composition и строгая CTA hierarchy — System A;
- stone secondary surfaces и object asymmetry — System C.

Финальные colors утверждаются только после full-media/logo/contrast review. Green, oxide и burgundy одновременно не смешиваются.

### 13.2 Единые токены

На всём сайте едины:

- Manrope/Raleway и type scale;
- 12-column grid и container;
- spacing scale;
- text/muted/border/surface/action/focus tokens;
- radii 0–2 px;
- button/links/focus states;
- header/footer;
- media captions;
- photo color treatment без filters;
- motion durations/easings;
- reduced-motion;
- breakpoints;
- form controls, если form будет согласована.

### 13.3 Допустимые различия

- home/objects: больше media и whitespace;
- catalog/product: регулярная светлая grid и высокая information density;
- services/construction/metals: engineering two-column layouts и facts;
- contacts/vacancies: practical layout без cinematic decoration.

Это modes одного бренда, а не отдельные themes.

## 14. Motion architecture

Оставить и улучшить:

- transparent/scrolled header transition;
- restrained section reveal;
- image reveal без blur;
- link underline/arrow feedback;
- button hover/focus;
- gallery crossfade/slide;
- menu state transition.

Правила:

- content в DOM и видим без JS;
- no scroll-jacking;
- no heavy parallax/WebGL;
- hero video не перезапускается в reduced-motion;
- gallery autoplay только с visible pause;
- no animation задерживает CTA;
- third-party map lazy и вне critical path.

## 15. CMS и content architecture

Будущие templates должны продолжать читать те же collections и singleton. До visual migration:

1. Заморозить slug sets.
2. Сделать snapshot всех records и media refs.
3. Устранить потерю presentation fields при admin save.
4. Добавить Zod/parent validation до CRUD write.
5. Проверить import/export round-trip.
6. Расширять schema только additive.
7. Не добавлять required projectId/productIds.
8. Добавлять documents, gallery captions, video или forms только вместе с admin/editor/import/export/render/SEO lifecycle.
9. Перевести hardcoded Header/DirectContact contacts на site-settings без изменения публичных значений.
10. Сохранить dormant data до отдельного owner decision.

## 16. Technical SEO architecture

- сохраняются 106 canonical content URLs;
- legacy aliases становятся настоящими permanent redirects;
- sitemap содержит только canonical indexable public URLs;
- design-lab, admin, aliases, 404, inactive records исключаются;
- 404 получает noindex;
- breadcrumbs и JSON-LD сохраняются;
- project/product/service/job OG используют реальные media только при наличии;
- structured data заполняется только фактическими fields;
- six placeholder category descriptions проходят editorial task;
- filter URLs, если появятся, получают заранее определённые canonical/index rules.

## 17. Контентные задачи до wireframes

Обязательные owner/editor decisions:

1. Подтвердить формулировку full-scope hero.
2. Подтвердить границы construction claims по active industrial case.
3. Классифицировать industrial media: public result / prohibited internal production.
4. Утвердить замену public mentions «цех/производство» без удаления исходных data/media.
5. Заполнить six category SEO descriptions.
6. Определить реальные project facts и captions.
7. Решить, какие product/project documents существуют.
8. Решить lead form/backend/privacy.
9. Утвердить vacancy response channel.
10. Утвердить logo color variants без изменения geometry.

## 18. Рекомендуемый порядок реализации

1. Зафиксировать preservation baseline, routes и media hashes.
2. Утвердить navigation/content hierarchy.
3. Закрыть no-production media/content classification.
4. Создать token prototype на реальных long pages.
5. Спроектировать Header/MobileMenu/Footer и focus behavior.
6. Спроектировать четыре page modes.
7. Сначала мигрировать один section/category/product vertical slice с CMS round-trip.
8. Затем один object detail с полной gallery.
9. Затем construction/metals service templates и home.
10. После каждой волны проверять route/data/media parity, SEO, mobile и performance.

Такой порядок даёт новый визуальный уровень, не превращая СМУ-1 в упрощённый сайт только о благоустройстве и не создавая необратимую миграцию.

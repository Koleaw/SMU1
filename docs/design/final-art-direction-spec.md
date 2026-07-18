# СМУ-1 — финальное арт-направление и production design specification

Статус: обязательное ТЗ для финального публичного дизайн-прохода

Версия: 1.0

Дата фиксации: 17 июля 2026

Визуальное направление: Engineering Blue
Область действия: публичный сайт СМУ-1

## Актуализирующее дополнение от 18 июля 2026 года

Этот документ сохраняется как исходное визуальное ТЗ прохода и исследовательская трассировка. Для завершённой задачи **Final Premium Design + Standard/Premium Product System** следующие более новые документы имеют приоритет:

1. прямое каноническое задание текущей задачи;
2. `docs/design/final-art-direction-master-plan.md`;
3. `docs/design/product-presentation-model.md`;
4. `docs/design/cms-product-presentation-switch.md`;
5. `docs/design/FINAL_CURRENT_TASK_REQUIREMENTS_MATRIX.md` и `FINAL_CURRENT_TASK_ACCEPTANCE.md`.

В частности:

- значения palette в разделах 4–5 ниже являются исторической спецификацией и заменены фактическими production tokens: `#101720`, `#171F29`, `#1E4FA3`, `#153D82`, `#DFE9F8`, `#F4F6F8`, `#E8EDF2`, `#CBD3DC`, `#5B6570`;
- green accent из ранней версии не используется как production action/surface color;
- запрет разделов 16 и 17.8 менять CMS/schema/content не применяется к узкому разрешённому presentation layer: добавлены `presentationType`, три optional premium fields, editor controls, write validation, export/import projection и явная классификация 68 product records;
- presentation layer подтверждён не только schema/API suite 22/22, но и реальным visual-admin browser round-trip 29/29: switch, conditional fields, save/reload, UI export/import, сохранение premium data при Standard и invalid no-write; production content, HEAD и index при QA не изменились;
- это дополнение не разрешает иных широких изменений admin, business data, URL, slugs, media, deployment или production facts;
- фактический итог и QA-числа находятся в `final-design-implementation-report.md`, а не в будущих формулировках ранних acceptance-пунктов этого документа.

## 0. Назначение документа

Этот документ является главным визуальным ТЗ для финального прохода. Он заменяет прежнюю production-ориентацию на Olive в части визуальных решений, но не отменяет бизнес-, контентные и технические ограничения проекта.

Цель — сделать сайт визуально сопоставимым с сильным федеральным инженерно-строительным брендом: точным, масштабным, технологичным и коммерчески понятным. Сайт не должен выглядеть как шаблон строительной компании, витрина маркетплейса, арт-галерея или AI-сборка из одинаковых карточек.

Нормативный порядок источников:

1. Последние прямые решения владельца и ограничения текущего задания.
2. Этот документ.
3. docs/design-lab/current-site-preservation-contract.md.
4. docs/MASTER_SPEC.md в непротиворечащей части.
5. Исследования и отчёты docs/design-lab и docs/migration.
6. Старые дизайн-документы только как историческая справка.

docs/DESIGN_SYSTEM_FINAL.md является legacy-документом: его Roboto-only и no-blue правила не применяются к этому проходу.

## 1. Исследование и benchmark

### 1.1. Изученная внутренняя база

Решения этого ТЗ опираются на:

- docs/design-lab/commercial-site-architecture.md;
- docs/design-lab/current-site-preservation-contract.md;
- docs/design-lab/final-design-audit.md;
- docs/design-lab/final-design-benchmark.md;
- docs/design-lab/final-visual-direction.md;
- docs/design-lab/prototype-gap-analysis.md;
- docs/design-lab/prototypes/systems-comparison.md;
- docs/design-lab/redesign-acceptance-checklist.md;
- pilot-исследования Foster + Partners, Vestre, mmcité, Skanska и Linear;
- V2 production migration, page review и visual-polish QA в docs/migration.

Главная коммерческая последовательность, подтверждённая Design Lab:

**предложение → доказательство → состав/результат → короткое пояснение процесса → следующий шаг**

Большое медиа должно доказывать предложение. Доверие должно находиться рядом с обещанием. CTA должен появляться после смысла, а не повторяться механически в каждой секции.

### 1.2. Свежий benchmark официальных сайтов

Исследование выполнено по официальным публичным сайтам; копирование их макетов, текстов, шрифтов или фирменных приёмов запрещено.

Повторная верификация 18 июля 2026 года подтвердила доступность официального project index MVRDV по адресу `https://www.mvrdv.com/en/` и его project-first структуру с тематической навигацией. Отдельный browser-capture MVRDV в сохранённом Design Lab отсутствует, поэтому выводы о конкретных transition timings не считаются доказанным контрактом: в СМУ-1 используется только зафиксированный ниже композиционный принцип «тезис + конкретный визуал», а motion принимается по собственным browser-тестам сайта СМУ-1.

#### Arup

Официальный сайт: [arup.com](https://www.arup.com/)

Что переносим:

- первый экран сразу формулирует масштаб и инженерную роль компании;
- короткая верхнеуровневая навигация ведёт к рынкам, услугам, проектам и контакту;
- проекты стоят рядом с компетенциями и подтверждают обещание;
- типографическая иерархия заметнее декоративных элементов;
- header должен быть спокойным, контрастным и менять состояние без визуального скачка.

Что не переносим:

- глобальную консалтинговую широту, которой нет в контенте СМУ-1;
- сложную editorial-архитектуру insights.

#### MVRDV

Официальный сайт: [mvrdv.com](https://www.mvrdv.com/)

Что переносим:

- ритм крупных тезисов и изображений;
- смену масштаба текста между смысловыми блоками;
- появление элементов как продолжение композиции, а не отдельный эффект;
- сильную связь заголовка с конкретным визуалом.

Что не переносим:

- игровой и провокационный арт-язык;
- перегруженную динамику и экспериментальную навигацию;
- декоративные цифры и показатели без подтверждённых данных.

#### Skanska

Официальный сайт: [skanska.com/group/en](https://www.skanska.com/group/en)

Что переносим:

- объектный масштаб hero;
- ясный корпоративный тезис до подробностей;
- последовательность purpose → направления → доказательства → проекты;
- белый, синий и тёмный как дисциплинированная корпоративная система;
- широкие контекстные фотографии реальных объектов.

Что не переносим:

- публичные финансовые показатели и масштабы, которых нет в records СМУ-1;
- многоуровневую географическую структуру.

#### Turner Construction

Официальный сайт: [turnerconstruction.com](https://www.turnerconstruction.com/)

Что переносим:

- blue/white/black discipline;
- разделение компании, услуг, рынков, проектов и контакта;
- представление инженерной работы как управляемого процесса;
- уверенный финальный контактный блок;
- restrained footer reveal как завершение страницы.

Что не переносим:

- масштаб mega-menu, не соответствующий текущему объёму сайта;
- сторонние отраслевые сущности и формы, которых нет в бизнес-логике СМУ-1.

#### Snøhetta

Официальный сайт: [snohetta.com](https://www.snohetta.com/)

Что переносим:

- уверенный размер шрифта;
- большие, но функциональные интервалы;
- короткие текстовые блоки достаточной ширины;
- спокойный ритм между изображением и текстом.

Что не переносим:

- музейную подачу;
- намеренно абстрактную коммуникацию.

#### Дополнительные официальные ориентиры

- [Foster + Partners](https://www.fosterandpartners.com/) — медиа-доминанта и спокойный интерфейс;
- [SOM](https://www.som.com/) — проектная иерархия и инженерная строгость;
- [BIG](https://big.dk/) — масштаб проектов и смена композиционного ритма;
- [Grimshaw](https://grimshaw.global/) — техническая ясность и editorial project archive;
- [Buro Happold](https://www.burohappold.com/) — связь компетенции, результата и экспертизы.

### 1.3. Итог исследования

Премиальность в этом проекте создаётся не эффектами, а дисциплиной:

- одна сетка;
- одна гарнитура;
- холодная инженерная палитра;
- сильное реальное медиа;
- различимые типы страниц;
- ясный порядок доказательств;
- крупная типографика без сломанных переносов;
- ограниченная, осмысленная анимация;
- один понятный следующий шаг.

## 2. Независимый аудит текущего сайта

### 2.1. Главная

Сильные стороны:

- уже существует масштабный media hero;
- направления, проекты и контакт присутствуют в коммерческой цепочке;
- header умеет работать поверх hero и переходить в solid.

Проблемы:

- Olive, тёплый бежевый и зелёный primary создают более ремесленное, чем инженерное впечатление;
- hero quick links, дополнительная внутренняя навигация и следующий positioning-блок конкурируют за внимание;
- повтор одинаковых карточек после сильного первого экрана возвращает шаблонность;
- autoplay media без ясного управления особенно тяжело воспринимается на mobile;
- доверие может появляться позже обещания;
- повтор CTA и стрелок создаёт AI-pattern.

Решение:

- полноэкранный Engineering Blue hero;
- одна главная формулировка, один primary CTA и максимум один secondary CTA;
- убрать дублирующую навигацию из hero;
- сразу после hero дать короткое доказательство и направления;
- проекты показывать крупнее и реже;
- финальный контакт сделать единым коммерческим завершением.

### 2.2. Направления

Общая проблема группы — разные направления после hero слишком быстро превращаются в одинаковый набор section heading + cards. Это ослабляет специфику услуги и создаёт AI-template-ощущение.

#### Металлоконструкции

- hero должен показывать конструкцию или законченный объект, а не случайную абстрактную деталь;
- «Что изготавливаем» сделать плотной 3–4-колоночной системой без узких текстовых столбов;
- доказательство возможностей поставить сразу после scope;
- не возвращать фотографии внутреннего производства;
- процесс описывать только существующим контентом.

#### Благоустройство

- строить страницу вокруг реальной среды и выполненного объекта;
- «Для каких объектов» сделать плоским читаемым списком, не набором одинаковых карточек;
- показать связь задачи, состава работ и результата;
- не повторять одну и ту же фотографию в hero и ближайшей gallery.

#### Строительство

- использовать законченный объект как основное доказательство;
- убрать ощущение универсальной услуги «для всех»;
- блоки «Что делаем» и «Для каких объектов» уплотнить;
- CTA ставить после состава услуги и после project proof.

#### Навесы

- доступные catalog renders нельзя растягивать как документальную фотографию;
- hero допускает contained/split-композицию на холодной поверхности;
- нужно честно разделить типы изделий и следующий шаг;
- не имитировать отсутствующие реальные кейсы.

#### Топиарии

- один уникальный визуал использовать как сильный editorial anchor;
- не создавать ложную gallery из дублей и кропов;
- сделать страницу короче других направлений;
- компенсировать малое число медиа качественной типографикой и ясными контекстами применения.

### 2.3. Каталог и категории

Проблемы:

- после category hero страница быстро становится обычным листингом;
- одинаковая сетка создаёт marketplace-ощущение;
- слабые или отсутствующие media в части категорий дают случайные пустоты;
- повтор category media в gallery не добавляет доказательства;
- слишком узкие подписи и мелкие eyebrow ухудшают mobile.

Решение:

- каталог остаётся коммерческой навигацией, а не маркетплейсом;
- category hero 520–680 px, далее короткое описание, taxonomy и product grid;
- product cards отличаются от project cards;
- sparse/zero-media состояния оформляются честно, без borrowed media;
- фильтры не вводятся при текущем объёме данных;
- related categories показываются после основного списка, а не до него.

### 2.4. Товары

Проблемы:

- gallery и summary могут выглядеть как два конкурирующих framed widget;
- CTA повторяется внутри характеристик;
- cover-кроп искажает isolated product;
- стрелки галереи нарушают новое обязательное правило;
- функциональные данные иногда распадаются на узкие колонки.

Решение:

- above the fold: contained media слева, title/lead/key facts/action справа;
- один primary CTA в summary и один финальный CTA после полного описания;
- media всегда contain для изолированного изделия;
- характеристики — широкая definition grid, на mobile одна колонка;
- gallery controls только текстовые: «Назад», «Далее», «Закрыть»;
- functional counter имеет вид «2 из 7», без декоративного 02/07.

### 2.5. Выполненные объекты

Проблемы:

- равная сетка не выделяет сильный реальный объект;
- текущая project card не является кликабельной целиком;
- внутренние controls конфликтуют с whole-card link;
- text-only проект визуально проигрывает и может выглядеть как сломанный;
- без клиента, бюджета и сроков нельзя строить доверие на fake metrics.

Решение:

- первый media-rich проект — featured;
- listing card использует один статичный cover, без carousel controls;
- вся карточка кликабельна через валидную stretched-link схему;
- text-only проект получает намеренный типографический вариант;
- detail строится как задача → решение/состав → результат → gallery → следующий шаг;
- не добавлять несуществующие customer/cost/duration/documents.

### 2.6. Компания

Проблемы:

- универсальные values cards и декоративные числа выглядят шаблонно;
- слишком общие тезисы не создают доверия;
- старые спецификации конфликтуют с последним запретом на показ внутреннего производства.

Решение:

- компактный уверенный hero;
- использовать только законченный внешний объект и существующие факты;
- объяснить роль компании через направления, подход и реальные проекты;
- не создавать секцию «Производство» и не показывать цех.

### 2.7. Контакты

Проблемы:

- множество равноправных карточек дробит главное действие;
- декоративные поверхности могут отдалять телефон и email;
- карта не должна быть первым смысловым блоком.

Решение:

- телефон, Telegram, email и адрес видимы сразу;
- primary contact крупнее вторичных каналов;
- карта идёт после контактных данных;
- реквизиты оформляются компактно;
- не добавлять новую форму или backend.

### 2.8. Вакансии

Проблемы:

- card/number-язык выглядит искусственно на простой практической странице;
- слишком большой hero раздувает короткий контент;
- путь отклика может теряться.

Решение:

- editorial, а не promotional hero;
- архив — читаемый список вакансий;
- detail — обязанности, требования, условия и существующий канал отклика;
- никаких декоративных 01/02/03;
- сохранить существующие records и URLs.

### 2.9. Мобильная версия

Проблемы:

- длинные русские заголовки могут превращаться в столб;
- captions и eyebrows были слишком мелкими и разреженными;
- desktop-сетки иногда складываются в несколько слишком узких колонок;
- initial gallery logic ранее вызывал auto-scroll;
- footer и menu требуют отдельной, а не уменьшенной desktop-композиции.

Решение:

- на 390 и 320 px не оставлять контентные колонки уже 28ch;
- при недостаточной ширине переходить в одну колонку;
- minimum body 16 px, caption 13 px;
- touch target минимум 44 × 44 px;
- не выполнять scrollIntoView при инициализации;
- mobile menu должен управлять focus и scroll lock;
- footer становится последовательной одноколоночной структурой.

## 3. Приоритеты

### CRITICAL

1. Заменить production Olive на единую Engineering Blue систему.
2. Пересобрать hero главной и всех крупных направлений по типам страниц.
3. Убрать все стрелки из кнопок, включая gallery и navigation controls.
4. Убрать всю декоративную нумерацию 01/02/03.
5. Сделать project cards кликабельными целиком.
6. Исключить сломанные переносы и узкие текстовые столбы.
7. Сделать «Что делаем», «Что изготавливаем» и «Для каких объектов» плотными и читаемыми.
8. Унифицировать transparent-to-solid header.
9. Исправить footer alignment и дать один главный коммерческий финал.
10. Гарантировать отсутствие auto-scroll и сохранение scrollY=0 при переходе на новую страницу.
11. Не возвращать внутреннее производство вопреки latest owner contract.

### IMPORTANT

1. Развести композицию directions, categories, products, projects и practical pages.
2. Переставить proof ближе к обещанию.
3. Убрать повторные CTA и одинаковые card walls.
4. Систематизировать cover/contain media roles.
5. Добавить restrained hero, section и footer motion.
6. Переработать внутреннюю anchor-навигацию без дублирования hero.
7. Улучшить sparse и zero-media states.
8. Выделить featured project.
9. Увеличить mobile captions/eyebrows и touch targets.
10. Проверить first screen каждого canonical route.

### OPTIONAL

1. Точечная настройка focal position на отдельных изображениях без изменения media files.
2. Более тонкие hover-состояния для pointer devices.
3. Ручной physical-device QA на iOS Safari и Android Chrome.
4. Дополнительная оптимизация LCP media без замены файлов.
5. Настройка footer reveal после прохождения reduced-motion и performance QA.

## 4. Visual concept

Название: **Engineering Blue — «Точность, превращённая в объект»**.

Сайт воспринимается как спокойная инженерная система:

- белые и холодные светлые поверхности дают ясность;
- глубокий графит создаёт вес и масштаб;
- Royal Blue отвечает за действие, технологичность и доверие;
- фирменный зелёный остаётся редким подтверждающим акцентом;
- реальные объекты дают материальность;
- типографика удерживает коммерческий смысл;
- motion показывает управляемость, а не развлекает.

Тон не футуристический и не luxury-fashion. Это современный B2B industrial/civic brand, способный говорить с девелопером, промышленным заказчиком, муниципалитетом, архитектором и частным клиентом без смены визуального языка.

Рекомендуемая пропорция визуального поля:

- 62–68% белый и cold-white;
- 18–24% реальные изображения;
- 8–12% graphite/deep-blue surfaces;
- 3–5% Royal Blue;
- не более 1–2% зелёный accent.

## 5. Color system

### 5.1. Обязательные токены

| Token | Значение | Назначение |
|---|---:|---|
| --smu-bg | #F4F7FA | основной холодный фон |
| --smu-surface | #FFFFFF | карточки, header, elevated content |
| --smu-surface-steel | #E8EDF3 | вторичная инженерная поверхность |
| --smu-ink | #111820 | основной текст |
| --smu-graphite | #1B2632 | тёмные секции и footer |
| --smu-blue-night | #0C2340 | глубокий hero/overlay tone |
| --smu-blue | #1858D8 | primary action, active state |
| --smu-blue-hover | #1048B8 | hover/pressed |
| --smu-blue-soft | #E9F0FF | selected/soft highlight |
| --smu-green-accent | #2B6A4F | редкий подтверждающий акцент |
| --smu-text-muted | #586575 | вторичный текст |
| --smu-border | #D3DAE4 | линии и границы |
| --smu-on-dark | #F7FAFF | текст на graphite/blue-night |
| --smu-on-dark-muted | #B7C2D0 | вторичный текст на тёмном |
| --smu-focus-light | #1858D8 | focus ring на светлом |
| --smu-focus-dark | #8CB5FF | focus ring на тёмном |
| --smu-error | #B42318 | ошибки существующих controls |

Контраст ключевых пар:

- #1858D8 / #FFFFFF — 6.13:1;
- #586575 / #FFFFFF — 5.94:1;
- #2B6A4F / #FFFFFF — 6.41:1;
- #111820 / #FFFFFF — 17.87:1.

Все пары соответствуют WCAG AA для обычного текста. Нельзя снижать opacity текста так, чтобы итоговый контраст стал ниже 4.5:1.

### 5.2. Правила использования

- Royal Blue — единственный основной цвет CTA.
- Green Accent не используется как основной button background, большой фон или массовый eyebrow.
- Beige, cream, dirty pale green и случайные pastel surfaces удаляются.
- Graphite применяется в hero overlay, evidence, final CTA и footer, но не покрывает весь каталог.
- Карточки на светлом фоне не получают цветной фон без смысловой причины.
- Градиент не является декоративной заливкой; он допускается только как media overlay.

## 6. Typography system

Основная и единственная гарнитура: **Manrope**, fallback: Segoe UI, Arial, sans-serif.

Разрешённые веса: 400, 500, 600, 700. Display-текст не должен быть тяжелее 600.

| Роль | Desktop | Mobile | Line-height | Tracking |
|---|---|---|---:|---:|
| Hero H1 | 56–104 px | 36–52 px | 0.96–1.02 | -0.045em |
| Page H1 compact | 48–80 px | 34–46 px | 1.00–1.06 | -0.035em |
| H2 | 36–72 px | 30–40 px | 1.02–1.10 | -0.032em |
| H3 | 22–32 px | 21–28 px | 1.10–1.18 | -0.020em |
| Lead | 18–22 px | 17–20 px | 1.45–1.58 | -0.010em |
| Body | 16–18 px | 16–17 px | 1.55–1.68 | 0 |
| Small/caption | 13–14 px | 13–14 px | 1.40–1.55 | 0.01em |
| Eyebrow | 12–13 px | 12–13 px | 1.35 | 0.06em |

Рекомендуемые fluid tokens:

    --smu-h1: clamp(3.5rem, 6vw, 6.5rem);
    --smu-h1-compact: clamp(3rem, 4.8vw, 5rem);
    --smu-h2: clamp(2.25rem, 4.2vw, 4.5rem);
    --smu-h3: clamp(1.375rem, 2vw, 2rem);
    --smu-lead: clamp(1.125rem, 1.4vw, 1.375rem);
    --smu-body: clamp(1rem, 0.25vw + 0.94rem, 1.125rem);

При ширине до 767 px H1 переопределяется:

    --smu-h1: clamp(2.25rem, 10.5vw, 3.25rem);
    --smu-h1-compact: clamp(2.125rem, 9vw, 2.875rem);
    --smu-h2: clamp(1.875rem, 8vw, 2.5rem);

Ограничения ширины:

- hero H1: 10–14ch, для длинных русских названий допускается до 16ch;
- H2: 14–20ch;
- lead: максимум 58ch;
- body: максимум 68ch;
- utility text: максимум 74ch;
- контентная колонка не должна становиться уже 28ch; вместо этого сетка складывается.

Для заголовков применяются normal word-break и balanced wrapping. Запрещены ручные переносы, которые ломаются на соседних viewport. Нельзя оставлять одиночный короткий предлог в отдельной строке, если это можно исправить шириной или типографическим масштабом.

## 7. Spacing, grid и геометрия

### 7.1. Spacing tokens

| Token | px |
|---|---:|
| --smu-space-1 | 4 |
| --smu-space-2 | 8 |
| --smu-space-3 | 12 |
| --smu-space-4 | 16 |
| --smu-space-5 | 24 |
| --smu-space-6 | 32 |
| --smu-space-7 | 48 |
| --smu-space-8 | 64 |
| --smu-space-9 | 80 |
| --smu-space-10 | 96 |
| --smu-space-11 | 120 |
| --smu-space-12 | 160 |

Section spacing:

- desktop standard: clamp(80px, 8vw, 120px);
- desktop dense: clamp(56px, 6vw, 80px);
- tablet: 64–88px;
- mobile standard: 56–72px;
- mobile dense: 40–56px.

Запрещены случайные пустоты больше 160 px без медиа или смыслового перехода. Пустое пространство должно либо усиливать тезис, либо отделять режим страницы.

### 7.2. Grid

- content max-width: 1360 px;
- desktop: 12 columns, gap 24 px;
- tablet 768–1023: 8 columns, gap 20 px;
- mobile: 4 columns, gap 16 px;
- horizontal gutter: clamp(16px, 3vw, 40px);
- 320 px: минимум 16 px с каждой стороны;
- 390 px: 20 px допустимы, если полезная ширина не ломает текст.

Радиусы:

- media и обычные карточки: 0–2 px;
- controls: 2 px;
- modal/lightbox: максимум 4 px;
- pill-формы используются только для реального status/tag, не для навигации и декора.

Тени:

- обычные карточки не имеют постоянной тени;
- dropdown/dialog: 0 16px 40px rgba(17, 24, 32, 0.10);
- разделение создаётся сеткой, линией и контрастом поверхности.

## 8. Hero system

Hero — главный приоритет. У каждого типа страницы собственный режим.

| Тип страницы | Высота desktop | Высота mobile | Media |
|---|---:|---:|---|
| Главная | минимум max(680px, 100svh) | минимум max(620px, 100svh) | full-bleed cover |
| Крупное направление | минимум max(640px, 100svh) | минимум max(600px, 100svh) | full-bleed cover либо доказанный split |
| Каталог landing | 640–760 px | auto, минимум 520 px | editorial/split |
| Категория | 520–680 px | auto, минимум 460 px | contextual cover или contained fallback |
| Товар | минимум 640 px | auto | isolated contain |
| Проекты — архив | 520–640 px | 420–520 px | featured/contextual |
| Проект — detail | 72–86svh | 58–72svh | contextual cover |
| Компания | 480–620 px | 420–520 px | completed external object |
| Контакты/вакансии | 340–480 px | auto, минимум 320 px | преимущественно типографический |

Для immersive hero запрещено показывать торчащий фрагмент следующей секции. Для compact hero следующая секция начинается только после визуально завершённой нижней границы hero.

### 8.1. Media

- contextual object: cover;
- isolated product/render: contain;
- focal position задаётся на уровне layout/config без изменения media records;
- hero image не повторяется в следующей gallery в той же функции;
- placeholder не может быть featured;
- media без достаточного разрешения не растягивается на full bleed;
- hero image/video является LCP и загружается приоритетно; остальные media lazy.

Desktop overlay для левого текста:

    linear-gradient(
      90deg,
      rgba(5, 15, 29, 0.86) 0%,
      rgba(5, 15, 29, 0.64) 42%,
      rgba(5, 15, 29, 0.20) 76%,
      rgba(5, 15, 29, 0.08) 100%
    )

Допускается нижний gradient до rgba(5, 15, 29, 0.48) для устойчивости CTA.

На mobile текст располагается в нижней части, overlay становится вертикальным: лёгкое затемнение сверху и 0.84–0.90 у нижней границы. Контраст проверяется на каждом конкретном изображении.

### 8.2. Content

- eyebrow — только если добавляет контекст;
- один H1;
- lead максимум 2–3 строки desktop и 4–5 строк mobile;
- максимум два CTA;
- primary CTA — Royal Blue;
- secondary — outline или text link без стрелки;
- trust cue допускается только существующий и проверяемый;
- hero не содержит дублирующую section navigation.

### 8.3. Hero motion

Последовательность:

1. header/logo: 0 ms;
2. eyebrow: 40 ms;
3. H1: 100 ms;
4. lead: 170 ms;
5. actions: 240 ms;
6. media contrast/reveal завершается не позднее 560 ms.

Текст: opacity 0 → 1 и translateY 12 px → 0. Никаких blur, letter-by-letter, typewriter и elastic effects.

## 9. Header system

### 9.1. Размеры и состояния

- desktop height: 80 px;
- tablet: 72 px;
- mobile: 64 px;
- position: fixed;
- overlay state: transparent над immersive hero, white text, гарантированный top scrim;
- solid state: #FFFFFF, #111820 text, нижняя граница #D3DAE4;
- переход overlay → solid: 240 ms без изменения высоты и layout shift.

Логотип:

- использовать существующий asset;
- desktop visual height 34–38 px;
- mobile 28–32 px;
- не менять media file и не применять искажающие фильтры;
- контраст overlay обеспечивается top scrim, а не новым логотипом.

### 9.2. Desktop navigation

Обязательная структура:

- логотип;
- «Продукция»;
- ключевые направления;
- «Проекты»;
- «Компания»;
- телефон;
- CTA «Получить расчёт».

Desktop не скрывается в hamburger при достаточной ширине. При ширине ниже 1120 px включается mobile/compact menu, чтобы пункты не сжимались в нечитаемую строку.

Dropdown:

- открывается pointer и keyboard;
- Escape закрывает;
- фокус возвращается на trigger;
- состояние обозначается plus/minus или текстом, не стрелкой/chevron;
- click outside закрывает;
- открытый dropdown не вызывает page scroll.

### 9.3. Mobile menu

- занимает устойчивый viewport с safe-area padding;
- background #111820 или #FFFFFF, без glassmorphism;
- body scroll блокируется;
- focus trap обязателен;
- первый focus — close button;
- все направления и контакты доступны;
- close button имеет текстовое accessible name;
- закрытие не меняет исходный scroll position.

## 10. Внутренняя навигация страницы

- применяется только на страницах с тремя и более содержательными разделами;
- не дублируется в hero;
- sticky position находится под header;
- active state — Royal Blue line/text, не декоративная плашка;
- на mobile список горизонтально прокручивается вручную;
- инициализация не вызывает scrollIntoView;
- anchor target получает scroll-margin-top равный header + local nav + 24 px;
- URL hash меняется только после пользовательского действия;
- browser back/forward сохраняет ожидаемую позицию.

Для «Что делаем», «Что изготавливаем», «Для каких объектов»:

- desktop: 3–4 широкие колонки;
- tablet: 2 колонки;
- mobile: 1 колонка;
- минимум 28ch для текстового содержимого;
- item padding 20–24 px;
- максимум 2–3 коротких абзаца;
- вместо одинаковых карточек допускается плоская ruled grid.

## 11. Motion system

### 11.1. Tokens

| Token | Duration | Использование |
|---|---:|---|
| --smu-motion-instant | 120 ms | pressed/state |
| --smu-motion-fast | 180 ms | hover/focus |
| --smu-motion-standard | 240 ms | header/dropdown |
| --smu-motion-reveal | 420 ms | text/section |
| --smu-motion-media | 520 ms | image/hero mask |
| --smu-motion-footer | 560 ms | one-time footer reveal |

Easing:

    --smu-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
    --smu-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);

### 11.2. Разрешённые эффекты

- text reveal: opacity + translateY не более 12 px;
- media reveal: opacity либо clip-path без blur;
- stagger: 40–70 ms, максимум 5 элементов;
- header: background/color/border transition;
- card image hover: scale максимум 1.015;
- footer: один раз проявляется разделительная линия и контактный блок.

### 11.3. Запрещённые эффекты

- parallax;
- scroll-jacking;
- autoplay marquee;
- letter-by-letter;
- typewriter;
- WebGL и тяжёлые canvas effects;
- blur reveal;
- bounce, elastic, flashing;
- бесконечная footer animation;
- анимация, без которой контент скрыт;
- одновременный reveal всех карточек длинного каталога.

### 11.4. Reduced motion

При prefers-reduced-motion:

- duration становится 1 ms;
- transforms и clip-path reveal отключаются;
- smooth scroll отключается;
- autoplay video не запускается автоматически;
- весь контент остаётся видимым;
- gallery/lightbox работает без transition.

## 12. Component system

### 12.1. Buttons и links

Primary button:

- background #1858D8;
- hover #1048B8;
- text #FFFFFF;
- height 48–52 px;
- horizontal padding 20–24 px;
- radius 2 px;
- weight 700, 13–14 px.

Secondary button:

- transparent;
- border currentColor;
- без fill до hover;
- тот же размер.

Правила:

- ни одна кнопка не содержит стрелку;
- external link не получает диагональную стрелку;
- gallery использует слова «Назад» и «Далее»;
- accordion/dropdown использует plus/minus;
- не более одного primary button в локальном смысловом блоке;
- minimum interactive target 44 × 44 px.

### 12.2. Project cards

- aspect ratio media 16:10 или 3:2;
- contextual cover;
- title 24–32 px;
- metadata только из records;
- статичный preview в listing;
- вся карточка кликабельна.

Реализация whole-card:

- семантический article;
- основная ссылка получает stretched pseudo-element;
- никаких nested links;
- дополнительные controls, если неизбежны, располагаются над overlay через z-index;
- preferred решение — убрать gallery controls из listing и оставить gallery на detail;
- focus-visible охватывает всю карточку;
- accessible name сообщает название проекта.

### 12.3. Product cards

- isolated media: contain;
- background #FFFFFF или #F4F7FA;
- aspect ratio 4:5 либо согласованный квадрат;
- category/title/price state только из данных;
- без тени и декоративной нумерации;
- hover меняет border и media scale, не поднимает карточку;
- вся карточка кликабельна, если внутри нет других controls.

### 12.4. Direction blocks

- не копировать product card;
- использовать крупные editorial split или ruled grid;
- направление различается композицией и релевантным media, а не цветной плашкой;
- description минимум 32ch;
- на mobile split становится последовательностью text → media либо media → text по смыслу.

### 12.5. Galleries и lightbox

- thumbnail и main media имеют устойчивые dimensions;
- controls: «Назад», «Далее», «Закрыть»;
- counter: «2 из 7»;
- keyboard: Left/Right допустимы как клавиши, хотя визуальных стрелок нет;
- Escape закрывает;
- focus trap и возврат фокуса обязательны;
- dialog получает role/aria-modal;
- swipe допустим как enhancement, не единственный способ;
- gallery init не меняет scroll position.

### 12.6. Evidence и trust

- только существующие проекты, контакты, факты и документы;
- evidence находится рядом с тезисом;
- запрещены generic badges, fake metrics, invented clients и testimonials;
- отсутствие данных оформляется честным layout, а не пустой карточкой;
- нельзя возвращать внутреннее производство как proof.

### 12.7. CTA section

- один сильный тёмный блок ближе к концу страницы;
- H2, короткий текст, один primary и максимум один secondary action;
- background #1B2632 или contextual media с устойчивым overlay;
- без декоративных линий, цифр и стрелок;
- текст максимум 46ch.

### 12.8. Footer

Desktop 12-column:

- columns 1–4: logo и positioning;
- columns 5–8: основные маршруты в двух логических группах;
- columns 9–12: телефон, email, Telegram, адрес и главный contact action;
- нижняя строка: copyright и legal links по одной baseline.

Tablet:

- brand занимает полную первую строку;
- navigation и contact — две широкие колонки.

Mobile:

- brand → primary contact → navigation groups → legal;
- одна колонка;
- равные левые края;
- gap 28–36 px;
- телефоны не ломаются на две строки.

Footer background #1B2632, text #F7FAFF, secondary #B7C2D0. Разрешён one-time line/contact reveal 560 ms. Никаких loop-анимаций и стрелок.

### 12.9. Breadcrumbs

- компактны;
- не создают отдельную высокую полосу;
- на practical pages могут входить в hero;
- current item не является ссылкой;
- horizontal overflow на 320 px решается wrapping или controlled scroll без auto-scroll.

## 13. Page-by-page implementation plan

### 13.1. Главная

1. Full-screen contextual hero.
2. Один H1, lead, «Получить расчёт» и при необходимости один secondary action.
3. Короткое proof/positioning продолжение без повторной hero-навигации.
4. Направления — чередование editorial scale, не ряд одинаковых карточек.
5. Плотный блок инженерных возможностей.
6. Featured project и 2–3 supporting projects.
7. Короткий понятный процесс только из существующего контента.
8. Единый final CTA.
9. Footer.

### 13.2. Металлоконструкции

1. Immersive hero с конструкцией/готовым объектом.
2. Короткое предложение и scope.
3. «Что изготавливаем» — dense ruled grid.
4. Proof через существующий внешний результат.
5. Контексты объектов.
6. Существующий порядок работ.
7. Final calculation CTA.
8. Не показывать внутренний цех.

### 13.3. Благоустройство

1. Hero на реальной городской среде.
2. Задача и состав услуги.
3. Featured real project.
4. «Для каких объектов» — широкая list/grid.
5. Дополнительные направления/категории только после proof.
6. Final brief CTA.

### 13.4. Строительство

1. Hero с завершённым объектом.
2. Чёткое коммерческое обещание.
3. «Что делаем» — плотный scope.
4. Project/result proof.
5. Этапы только из текущего контента.
6. Контексты применения.
7. Final contact CTA.

### 13.5. Навесы

1. Split/contained hero, если доступен только render.
2. Типы изделий.
3. Параметры/варианты без invented facts.
4. Контекст применения.
5. Переход в категории/товары.
6. Final calculation CTA.

### 13.6. Топиарии

1. Editorial hero с единственным сильным visual.
2. Короткое объяснение.
3. Контексты применения.
4. Состав заказа.
5. Direct contact CTA.
6. Не создавать fake gallery.

### 13.7. Каталог

1. Compact editorial hero.
2. Ясная taxonomy.
3. Категории разного визуального веса при сохранении данных.
4. Без marketplace filters.
5. Короткий custom-order bridge.
6. Final CTA.

### 13.8. Категории

1. Contextual/contained hero по качеству media.
2. Description и category navigation.
3. Product grid.
4. Honest sparse state.
5. Optional contextual gallery только с уникальной функцией.
6. Related categories.
7. Final custom/calculation CTA.

Для dekorativnye-ograzhdeniya и stolbiki-i-bollardy обязателен deliberate zero-media layout без borrowed image.

### 13.9. Товары

1. Above-fold contain gallery + summary.
2. Title, lead, key facts и один primary CTA.
3. Описание.
4. Характеристики в широком definition layout.
5. Материалы, варианты, customization — только если fields существуют.
6. Context gallery.
7. Delivery/next step.
8. Related products.
9. Final CTA.

Три zero-media container products получают одинаково качественный typographic fallback.

### 13.10. Проекты — архив

1. Compact editorial hero.
2. Featured media-rich project.
3. Supporting project grid.
4. Whole-card links.
5. Text-only project — отдельный намеренный вариант.
6. Final project discussion CTA.

### 13.11. Проект — карточка

1. Contextual hero.
2. Task.
3. Scope/solution.
4. Result.
5. Gallery.
6. Related direction, если уже существует в данных.
7. Final CTA.

Не добавлять заказчика, стоимость, сроки и документы при отсутствии records.

### 13.12. Компания

1. Compact hero с внешним завершённым объектом.
2. Роль компании и направления.
3. Подход через существующие факты.
4. Реальные проекты.
5. Контакт.
6. Никакой внутренней production section.

### 13.13. Контакты

1. Typographic hero.
2. Primary phone и основные каналы.
3. Адрес.
4. Карта.
5. Реквизиты.
6. Не добавлять новую форму или form provider.

### 13.14. Вакансии

Архив:

- короткий hero;
- список активных вакансий;
- общий канал связи.

Detail:

- title и location/type, если fields существуют;
- обязанности, требования, условия;
- существующий отклик;
- related vacancy только при наличии;
- без decorative cards и numbering.

### 13.15. Изготовление на заказ

- остаётся cross-cutting commercial page, а не восьмым направлением;
- объясняет допустимые изменения;
- использует существующие contact channels;
- не вводит upload или форму;
- один финальный CTA.

### 13.16. 404

- компактный Engineering Blue экран;
- ясное сообщение;
- кнопки «На главную» и «Открыть каталог» без стрелок;
- header/footer остаются рабочими;
- никаких декоративных ошибок/анимаций.

## 14. Responsive specification

### 14.1. Контрольные ширины

Обязательные:

- desktop: 1440, 1280, 1024;
- mobile: 390, 320.

Дополнительные:

- 1920;
- 768;
- 360;
- reflow 200% при viewport 1280.

### 14.2. Правила

- 1440 и 1280 сохраняют 12-column hierarchy.
- На 1024 header переходит в compact navigation, если пункты не помещаются без сжатия.
- Ни одна текстовая колонка не становится уже 28ch.
- На 390 и 320 все основные layouts одноколоночные, кроме простых двухколоночных micro-facts при доказанной ширине.
- H1 не выходит за viewport и не использует font-size меньше 36 px на immersive hero.
- Длинный H1 на 320 px допускает до пяти строк, но не отдельные обломки слов.
- CTA на mobile может занимать 100% ширины; два CTA складываются вертикально.
- Media сохраняет aspect ratio; width/height или aspect-ratio зарезервированы до загрузки.
- Горизонтального page overflow нет.
- Fixed/sticky элементы не перекрывают anchor target.
- Footer и menu учитывают safe-area-inset.

## 15. Accessibility requirements

Уровень: WCAG 2.2 AA.

Обязательно:

- semantic landmark structure;
- один H1 на страницу;
- последовательная heading hierarchy;
- Skip to content;
- видимый focus ring;
- полный keyboard access;
- focus trap и возврат фокуса для menu/lightbox;
- Escape закрывает modal/menu;
- alt берётся из существующих данных; decorative media имеет пустой alt;
- цвет не является единственным способом передать state;
- contrast минимум 4.5:1 для body и 3:1 для large text/UI;
- touch target минимум 44 × 44 px;
- respects prefers-reduced-motion;
- видео имеет pause control; на reduced motion autoplay отключён;
- состояние текущей страницы и раскрытого dropdown доступно через aria-current/aria-expanded;
- error/empty states не зависят только от цвета;
- counter gallery произносится осмысленно;
- контент остаётся доступен при отключённом JavaScript, кроме progressive enhancement.

## 16. Жёсткие ограничения

Запрещено менять:

- CMS/admin;
- schemas;
- content records;
- canonical и legacy URLs;
- media files;
- import/export;
- бизнес-логику;
- юридический текст;
- существующие contact values без отдельного решения владельца.

Запрещено добавлять:

- новую страницу или секцию внутреннего производства;
- фотографии цеха и внутреннего production process;
- mandatory product↔project relation;
- fake clients, metrics, reviews, certificates, prices, сроки и SLA;
- stock/generated media вместо отсутствующих материалов;
- новый form backend;
- marketplace filters;
- heavy JS, scroll-jacking, parallax, WebGL;
- decorative 01/02/03;
- стрелки внутри любых кнопок;
- universal hero для всех page types;
- одинаковые card walls как основной ритм сайта.

Последнее правило владельца из docs/design-lab/current-site-preservation-contract.md имеет приоритет над ранним требованием MASTER_SPEC показывать внутреннее производство.

## 17. QA и acceptance criteria

### 17.1. Build и route integrity

- production build проходит без ошибок;
- все 107 canonical routes собираются;
- три compatibility aliases остаются доступны;
- 404 собирается;
- URL и canonical metadata не изменены;
- отсутствуют broken internal links;
- отсутствуют 404 media requests;
- console errors и unhandled promise rejection — 0.

### 17.2. Visual QA

На 1440, 1280, 1024, 390 и 320 проверить:

- первый экран каждой группы страниц;
- все уникальные templates;
- header overlay и solid;
- переход hero → следующая секция;
- отсутствие видимого «куска» следующей секции у immersive hero;
- типографические переносы;
- «Что делаем», «Что изготавливаем», «Для каких объектов»;
- cards и whole-card project links;
- galleries/lightbox;
- sparse и zero-media states;
- CTA;
- footer alignment;
- menu;
- focus states;
- reduced motion.

Дополнительно создать first-screen screenshots каждого canonical route на 1440 и 390. Полный пятиширинный manual review обязателен для всех уникальных templates и следующих edge cases:

- dekorativnye-ograzhdeniya;
- stolbiki-i-bollardy;
- три zero-media container products;
- text-only project;
- topiary;
- canopies;
- vacancy archive/detail;
- contacts;
- 404.

### 17.3. Navigation и scroll

- обычный переход на новую страницу заканчивается на scrollY = 0;
- intentional anchor navigation учитывает header offset;
- initial gallery/menu/local nav не вызывает auto-scroll;
- back/forward сохраняет browser-native поведение;
- hash не появляется без пользовательского действия;
- menu open/close сохраняет исходную позицию;
- lightbox close возвращает фокус и scroll position.

### 17.4. Motion

- hero sequence заметна, но завершается не позднее 600 ms;
- section reveal не превышает 12 px;
- нет layout shift из-за reveal;
- контент виден без IntersectionObserver;
- prefers-reduced-motion полностью отключает transforms и autoplay;
- footer animation происходит один раз и не блокирует ссылки.

### 17.5. Cards и controls

- project card открывается по клику в любой неинтерактивной точке;
- Tab выделяет карточку целиком;
- нет nested interactive elements;
- ни одна кнопка не содержит arrow glyph или arrow SVG;
- декоративная 01/02/03 отсутствует;
- functional count оформлен словами «n из m»;
- minimum target 44 × 44 px.

### 17.6. Typography и reflow

- отсутствует horizontal overflow на 320 px;
- body не меньше 16 px;
- caption не меньше 13 px;
- нет колонки уже 28ch;
- нет обрезанного текста;
- нет ручного br, создающего сломанный перенос на соседней ширине;
- при 200% zoom весь контент и controls доступны.

### 17.7. Performance

На representative home, direction, category, product, project и contacts:

- Lighthouse mobile Performance не ниже 85;
- Accessibility не ниже 95;
- Best Practices не ниже 95;
- SEO не ниже 95;
- CLS не выше 0.10;
- hero LCP media имеет явные dimensions и приоритет загрузки;
- ниже первого экрана media lazy-load;
- mobile не загружает тяжёлое autoplay video, если есть poster-equivalent.

### 17.8. Definition of Done

Проход считается завершённым только если:

1. Engineering Blue tokens применены ко всем публичным V2 pages.
2. Все hero соответствуют своему page type.
3. Header и footer едины.
4. Стрелки и декоративная нумерация удалены.
5. Project cards кликабельны целиком.
6. Dense scope sections не имеют узких колонок.
7. Нет auto-scroll и scroll regression.
8. Все обязательные viewport checks пройдены.
9. Edge-case routes проверены вручную.
10. CMS, schema, content, URLs, media и business logic не изменены.
11. Внутреннее производство не возвращено.
12. Результаты реализации и ограничения зафиксированы в docs/design/final-design-implementation-report.md.

## 18. Порядок реализации

1. Зафиксировать route/content/media baseline и dirty-worktree boundary.
2. Ввести Engineering Blue tokens без изменения данных.
3. Пересобрать header states и controls.
4. Пересобрать hero по page modes.
5. Исправить local navigation и dense scope sections.
6. Переработать project/product/category cards.
7. Удалить arrows и decorative numbering.
8. Унифицировать galleries, CTA и footer.
9. Настроить motion и reduced motion.
10. Провести automated route/accessibility checks.
11. Провести visual QA по обязательной матрице.
12. Создать implementation report с реализованными решениями, невозможными пунктами и оставшимися ограничениями.

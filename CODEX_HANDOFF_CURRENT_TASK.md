# CODEX HANDOFF — текущая задача SMU-1

Дата фиксации: 2026-07-18
Рабочая папка: `D:\работа\СМУ1\SMU1`

## OWNER VISUAL FREEZE v2 — финальное состояние

- Новая безопасная ветка: `v2-owner-visual-freeze`, исходный commit `409c8140b730d743b74175ca625253e65375ee90`.
- Existing dirty build/QA/untracked artifacts сохранены; reset/clean/restore/rebase не выполнялись.
- Research gate закрыт: существующих материалов хватило для 8 из 10 вопросов; только hero motion и scroll layering уточнены на официальных Home/Construction Skanska. Решения заморожены в `docs/design/SKANSKA_REFERENCE_DECISIONS.md`.
- Канонический checklist создан: `docs/design/FINAL_OWNER_VISUAL_FREEZE_CHECKLIST.md`.
- Baseline: 33/33 PNG сняты, каждый открыт и оценён; defects записаны по пакетам.
- Пакет A завершил две визуальные итерации. Усилены global type/palette tokens, Header contrast, sticky navigation, split copy/media hero handoff и единый Final CTA + Footer.
- Критический correction после первого capture: CTA heading был обрезан, а hero-copy смешивался с прозрачным Header. После исправления Browser geometry дал `CTA 495 px + Footer 405 px = 900 px` на `1440×900`; весь heading, контакты, колонки и legal row видимы. Mid-scroll переснят и просмотрен.
- `npm run build` после пакета A: pass, 227 страниц. Owner capture: runtime errors 0, local network errors 0.
- Следующий пакет: B — Home/catalog/category visual implementation и повторная съёмка.
- Пакет B завершён после двух corrections. `/ulichnaya-mebel/` стал white/royal split с contain-render; `/ograzhdeniya-i-zabory/` — white/contextual-photo split; filled category — compact navy/white product composition. Первый capture выявил одиночный союз «и» и clipped CTA: text measure расширен, повторный capture принят.
- Отдельно открыты review frames filled grid, sparse и no-media. No-media сначала сохранял ложную пустую media-half; после correction это compact white editorial hero без fake placeholder. Все B captures: runtime/network failures 0.
- Следующий пакет: C — Standard product и Premium Portal.
- Пакет C desktop завершён. Standard first-screen показывает render/H1/lead/price/CTA/fullscreen/local nav на 1440×900; technical и related grid просмотрены отдельно, без towers/empty cells.
- Portal: solid 44% navy panel + matching neutral media canvas без veil/tint; 1440/1920 открыты. Первый capture оставил active nav royal и copy под Header — scoped correction вернул white active и opaque-left contextual Header; mid-scroll переснят.
- Portal Gallery compact: composition 680 px (`0.756 × 900`), stage 460 px, controls/counter/thumbs видимы. Primary render = contain; второй contextual frame отдельно открыт и подтверждён как cover без passport. Application royal/white, adaptation, variants и technical sections пересобраны и открыты.
- Пакет D завершён после нескольких visual corrections. Canopies и Topiary получили цельный navy/white split с полностью видимым render и viewport hero; photo heroes Metalworks/Landscaping/Construction сохранены и усилены без показа следующей секции на direct load.
- Первый Topiary capture выявил overlap изображения и текста, второй — избыточную высоту строки; финальная сетка deterministic 4×2, первый overlay читаем, последний tile — осмысленный royal-blue accent. Первый review related cards выявил overlap copy; явный flex-flow устранил дефект.
- Нижние direction sections открыты отдельно и уплотнены: Canopies related 536 px; Topiary scope 454 px и brief 423 px; Metalworks proof 978 px; Landscaping proof 951 px; Construction proof 985 px. Contextual media переведены в cover, ложные пустые cells удалены, supporting project Construction собран в компактную строку.
- Канонические D screenshots и восемь дополнительных review PNG открыты вручную после исправлений. Последняя сборка: pass, 227 страниц; owner capture не зарегистрировал runtime/network failures.
- Пакет E завершён после трёх visual corrections. Custom Order буквально переставлен в порядок hero → changes → inputs → directions → examples → CTA; дублирующая hero-table/micro-note удалена, а «Что можно прислать» стало единственным royal-blue/white content block.
- Первый Custom Order capture выявил ложные пустые ячейки в changes/directions и clipped preceding copy; последние элементы получили осмысленные full-row layouts, нижний padding royal section исправлен. Финальные section heights: changes 461 px, inputs 408 px, directions 729 px, examples 748 px.
- Projects archive получил 310 px editorial intro, белый featured proof и раннюю двухколоночную grid. Project detail открыт отдельно: hero clean, gallery целиком 821 px. Первый related capture выявил пустую треть и перенос «Металлоконструкции» на одну букву; финал — две равные cards без text tail.
- Company hero теперь white/navy split с двумя сохранёнными объектами; tasks/geography = 601 px, projects = 890 px. Contacts intro = 220 px, royal primary phone и загруженная Yandex Map видимы. Vacancies archive и detail открыты повторно; Header/logo, активная позиция и все исходные данные видимы.
- Семь канонических E PNG и девять дополнительных review frames открыты вручную; исправленные changes/related пересняты ещё раз. Последняя сборка: pass, 227 страниц; owner captures: runtime/network failures 0.
- Пакет F visual gate завершён. Финальный desktop set: 33/33 PNG сняты, каждый открыт; первый final capture выявил mobile Footer text tower и hero-copy под Header — оба дефекта исправлены, затронутые кадры пересняты и повторно открыты. Desktop geometry: Home/Portal/direction heroes = viewport, Portal gallery composition 680 px, Final CTA 495 + Footer 405 = 900 px.
- Mobile regression: 16/16 routes на 390×844 сняты и открыты. Исправлены узкие text towers Canopies/Topiary, clipping H1 «Металлоконструкции», лишняя no-media category height и реальный Projects overflow (media 448 px внутри card 358 px); после correction `viewportWidth = documentWidth = 390`, wide elements = 0. Исправленные routes пересняты повторно.
- Headless proof capture на image-heavy routes иногда пропускал composited Header при длинной batch-сессии при корректной DOM geometry/opacity; runner теперь делает bounded warm-up surface read, а четыре спорных PNG дополнительно записаны по одному/в устойчивой последовательности и открыты вручную. Runtime/network failures owner capture = 0.
- Первый полный post-freeze browser run прошёл весь объём, но честно выявил 6 defects: mobile overflow на двух Premium products, двух project detail и Custom Order, а также нестабильную исходную scroll-позицию synthetic gallery swipe после same-route reload. Причины исправлены точечно: mobile Premium grid columns сброшены, длинные project/custom H1 уменьшены на 320 px, 12-column Custom Order grids получили bounded 16 px column-gap, а swipe audit сначала стабилизирует видимую gallery stage.
- Targeted regression по пяти проблемным routes на 320×700: pass, 5 responsive + 10 motion assertions, failures/runtime/network = 0. После correction заново сняты и открыты `mobile/portal-390.png` и `mobile/custom-order-390.png`; композиция, типографика, CTA и media handoff приняты.
- Финальный полный browser QA: pass за 493.4 s; 107 canonical direct loads, 24 real click navigations, 270 responsive assertions, 124 motion assertions, 22 Footer assertions, 7 functional scenarios; failures 0, runtime errors 0, local network errors 0. Product swipe сохраняет document scroll (`2462 → 2462`), горизонтальный жест меняет `1 / 3 → 2 / 3`, вертикальный — не меняет кадр.
- Финальные source/build проверки: `npm run check` — 186 files, 0 errors, 0 warnings, 33 existing hints; `npm run build` — 227 pages; `npm run qa:final:static` — 38/38 (107 routes, 9193 links, 2285 media, 59 Standard/9 Premium); `npm run test:admin-import` — 22/22; focused browser — 17/17; admin browser — 29/29.
- Preservation audit: task diff по `src/content`, schema, `src/pages/admin`, `tools/admin-api` и `public/assets` пуст. Records, Standard/Premium classification, validation/import-export, media, URLs/canonical/sitemap и deployment configuration не менялись. `.astro`, `dist`, `docs/migration`, PNG и Design Lab artifacts исключаются из commit.
- Task-owned Chromium/Node processes закрыты. Exact-path local commit создаётся с сообщением `fix: finalize owner-approved visual system`; push/deployment/remote operations не выполнялись, публичный сайт не изменён.
- Разделы ниже сохранены как исторический handoff предыдущих этапов; текущее финальное состояние определяется этим верхним разделом и `docs/design/FINAL_OWNER_VISUAL_FREEZE_CHECKLIST.md`.

## 0. Статус этого handoff

Этот документ восстановлен по истории текущей сессии и сообщениям параллельных агентов. По прямому указанию пользователя при его создании **не запускались** web-поиск, `git status`, `git diff`, сборка, тесты, браузерные проверки или другие длительные команды. Поэтому:

- результаты, которые ниже помечены как «сообщено агентом», действительно были сообщены в этой сессии, но должны быть повторно подтверждены после объединения всех текущих изменений;
- свежего снимка `git status`/`git diff` непосредственно перед handoff нет;
- рабочее дерево было существенно грязным ещё до текущего прохода; нельзя считать все изменения в нём созданными только этой сессией и нельзя откатывать чужие изменения;
- исходная задача **не завершена**: известны минимум два функциональных дефекта QA и не выполнена финальная сквозная приёмка после всех изменений.

## 1. Исходная цель и требования

Цель — довести сайт ООО «СМУ-1» до уровня цельной, современной, премиальной B2B-системы строительной/производственной компании: инженерно-серьёзной, коммерчески убедительной, читаемой, визуально собранной и расширяемой через CMS.

Работа задана как последовательность ролей:

1. Creative Director / Digital Art Director.
2. UX / Information Architecture Lead.
3. Product Presentation Strategist.
4. Frontend Implementation Lead.
5. CMS / Content Model Architect.
6. QA / Visual Acceptance Lead.

Обязательные направления исходной задачи:

- сначала исследовать существующий проект, `docs/design-lab/`, `docs/design/`, прошлые аудиты/benchmark/art-direction материалы, шаблоны, данные и CMS;
- изучить референсы Skanska, Arup, MVRDV, Turner Construction и Snøhetta, не копируя маскированный/«вырезанный» текст и избыточно художественную стилистику;
- до рефакторинга зафиксировать арт-дирекшн, аудит и модель продуктовой презентации;
- внедрить два реальных сценария продукта: `standard` и `premium`;
- добавить понятный CMS-переключатель для новых и существующих продуктов с безопасной обратной совместимостью;
- реализовать сильную бело-/near-black-/navy-/royal-blue систему без случайной бледно-жёлтой/грязной пастели;
- усилить типографику, не допускать «башен» переносов, слишком узких колонок, мелкого ключевого текста и бессмысленных пустот;
- усилить первые экраны и реализовать контролируемый Skanska-inspired hero scroll handoff без пересечения текста с header;
- не запускать reveal фотографии до её загрузки/decode;
- улучшить sticky page navigation, related-блоки, hover-состояния, CTA и footer как единый завершающий экран;
- отдельно пройти Home, «Изготовление под заказ», металлоконструкции, благоустройство, строительство, выполненные объекты и карточки объектов, «О компании», контакты, вакансии, категории и продуктовые страницы;
- не ломать URLs, бизнес-логику, CMS, существующий контент и media;
- выполнить check, build, route, responsive, animation, visual, link, image и sticky-nav QA;
- создать пять обязательных документов и финально сопоставить результат со всеми критериями исходной задачи.

Обязательные итоговые документы:

1. `docs/design/final-art-direction-master-plan.md`
2. `docs/design/final-design-audit-v3.md`
3. `docs/design/product-presentation-model.md`
4. `docs/design/cms-product-presentation-switch.md`
5. `docs/design/final-design-implementation-report.md`

## 2. План, по которому велась работа

План был разбит на шесть последовательных этапов:

1. Аудит repo, design-документов, структуры страниц, данных/CMS и визуальных референсов.
2. Создание master plan, честного design audit и формальной модели standard/premium до основной реализации.
3. Изменение schema/data/admin: поле presentation type, безопасные defaults, редакторские подсказки, миграционная совместимость.
4. Разделение product rendering на стандартный и премиальный шаблоны; усиление общей visual/motion/image-ready системы.
5. Page-by-page polish обязательных коммерческих страниц и общих паттернов hero/sticky nav/related/CTA/footer.
6. Полный технический и визуальный QA, исправление найденного, обновление implementation report и финальная сверка с каждым требованием.

Последний известный формальный статус плана до handoff был устаревшим относительно фактических правок: этапы 1–2 были отмечены завершёнными, этап 3 — in progress, этапы 4–6 — pending. По фактическим сообщениям агентов этап 3 завершён, этапы 4–5 существенно выполнены, но этап 6 не завершён. В новой сессии план нужно обновить после свежего `git status`/`git diff`.

## 3. Что полностью выполнено

### 3.1 Исследование и зафиксированные решения

- Изучены структура проекта, `MASTER_SPEC`, существующие design-документы и прошлые визуальные материалы.
- Изучены заявленные референсы: Skanska — масштаб, hero и handoff; Arup — digital polish header/text; MVRDV — композиция текста поверх изображения; Turner — корпоративный финальный CTA/footer; Snøhetta — спокойная типографическая премиальность.
- Принято направление Engineering Blue: white, near-black, navy, royal blue и чистый light-blue accent.
- Созданы первые четыре обязательных design-документа:
  - `docs/design/final-art-direction-master-plan.md`
  - `docs/design/final-design-audit-v3.md`
  - `docs/design/product-presentation-model.md`
  - `docs/design/cms-product-presentation-switch.md`

### 3.2 Content model / CMS switch

По сообщениям агента CMS-реализации выполнено следующее:

- добавлено поле `presentationType` со значениями `standard | premium`;
- schema использует `z.enum(['standard', 'premium']).default('standard')`;
- добавлены необязательные premium-поля `solutionKicker`, `applicationItems`, `executionVariants`;
- визуальная админка получила понятный русский select и подсказку;
- premium-only редакторы скрываются для standard, но данные при переключении не удаляются;
- технический редактор также получил select;
- новый продукт и импорт по умолчанию получают `standard`;
- проверена round-trip логика импорта/редактирования;
- все 68 существующих product JSON получили явный `presentationType`: 59 `standard`, 9 `premium`;
- консервативно назначены ровно девять premium-продуктов:
  - `kachel-portal`
  - `kacheli-pergola`
  - `kacheli-s-dlinnym-navesom`
  - `pergola-lamel`
  - `pergola-s-lavkoy`
  - `naves-galereya`
  - `besedka-kub`
  - `besedka-kofe`
  - `bolshaya-skameyka-amplituda`
- для девяти premium JSON заполнены `solutionKicker`, `applicationItems`, `executionVariants`; формулировки выведены из уже существующего контента, без выдумывания неподтверждённых характеристик.

Важно: эта часть считается реализованной по отчёту агента, но после всех параллельных правок всё равно требует свежего schema/admin теста.

### 3.3 Два product templates

Реализована архитектура автоматического выбора шаблона:

- `CatalogProductV2.astro` стал selector-компонентом;
- исходный компактный сценарий вынесен в `CatalogStandardProductV2.astro`;
- создан richer-сценарий `CatalogPremiumProductV2.astro`;
- selector выбирает premium при `presentationType === 'premium'`, иначе standard;
- standard root имеет `data-product-presentation="standard"`;
- premium root имеет `data-product-presentation="premium"`;
- richer premium-блоки имеют `data-premium-product-section`, что позволяет объективно проверить различие сценариев;
- standard оставлен компактным и товарным;
- premium получил усиленный hero, solution/application/adaptation/variants/technical/gallery/delivery/related/final-contact сценарий.

### 3.4 QA-инструменты

Агент QA создал:

- `tools/migration/final-design-qa.mjs`
- `tools/migration/browser-final-design-qa.mjs`

В `package.json` добавлены команды:

- `qa:final:static`
- `qa:final:browser`
- `qa:final`

Static QA проверяет, среди прочего, routes, links/anchors, media, sitemap, 404/legacy, CMS и наличие фактической standard/premium развилки.

## 4. Что выполнено частично

### 4.1 Общая визуальная система и motion

В `src/styles/v2/final-art-direction-v2.css` внесён большой системный проход:

- усилены цвета и типографика;
- улучшены header/nav;
- добавлены standard/premium product styles;
- добавлены image-ready классы;
- добавлен hero-scroll motion;
- усилена связка CTA/footer;
- добавлены responsive-правила.

В layout/hero components подключены hero-scroll data hooks и скрипт с `requestAnimationFrame`, reduced-motion и desktop guard. CSS подключён в `<head>`, чтобы не возникал поздний restyle.

Однако этот блок **не может считаться полностью принятым**, пока не пройдёт свежий responsive/animation/visual QA после всех изменений.

### 4.2 Image preload/decode/reveal

Создан `src/utils/v2ImageReady.ts`, а reveal в каталогах/Home поставлен в зависимость от `load`/`decode`.

Известный дефект: текущая реализация использует `Promise.race` с таймаутом около 6 секунд и после таймаута переводит элемент в ready, даже если фотография всё ещё не загрузилась. Это нарушает исходный критерий «не анимировать пустое/недогруженное фото». Механизм реализован, но пока небезопасен и должен быть исправлен.

### 4.3 Sticky section navigation

Навигация визуально усилена, но browser QA обнаружил сброс `aria-current` после клика по anchor как на desktop, так и на mobile. Вероятная зона исправления — `src/components/v2/V2SectionNav.astro`. Нужно подтвердить причиной чтением кода, а не принимать предположение за факт.

### 4.4 Page-by-page polish

Агент page polish сообщил о завершённой переработке:

- «Изготовление под заказ»;
- archive/listing выполненных объектов;
- «О компании»;
- контакты;
- вакансии;
- direction pages, включая металлоконструкции, благоустройство и строительство;
- устранение текстовых «башен», пустых колонок и giant sections;
- добавление intrinsic dimensions пяти изображениям страницы изготовления под заказ.

Это сильная реализационная часть, но её статус остаётся «частично принято», потому что новая сессия должна:

- восстановить точный diff этих файлов;
- визуально проверить все обязательные страницы на desktop/mobile;
- убедиться, что изменения агента не были перекрыты параллельными правками;
- проверить Home, категории, object detail, related blocks и финальные экраны в той же серии.

### 4.5 Итоговый implementation report

`docs/design/final-design-implementation-report.md` уже существовал/был создан в рабочем дереве ранее, но он **не обновлён до окончательного состояния v3** и не содержит финальных подтверждённых результатов после исправления browser QA. Его наличие нельзя считать выполнением deliverable до актуализации.

### 4.6 Product listing/card distinction

Различие самих product detail templates реализовано. Планировалось также добавить спокойный premium-индикатор в listing card (`V2ProductCard`), например «Решение для объекта», без pseudo-premium для standard. По истории сессии эта правка **не была выполнена**. Нужно решить её в соответствии с уже созданной моделью и затем проверить, что standard-карточки не маркируются как инженерные решения.

## 5. Что ещё не выполнено

1. Не восстановлен свежий фактический `git status`, `git diff`, `git diff --stat`, `git diff --check` после всех параллельных изменений.
2. Не исправлен image-ready timeout, который может reveal пустое изображение.
3. Не исправлен sticky-nav `aria-current` после anchor click на desktop/mobile.
4. Не добавлен/не подтверждён понятный, сдержанный premium indicator в listing cards.
5. Не проведён свежий полный `npm run check` после объединения всех текущих изменений.
6. Не проведён свежий полный build после объединения всех текущих изменений.
7. Не проведён свежий admin/schema round-trip test после объединения изменений.
8. Не проведён финальный static route/link/image/CMS/product-split QA после исправлений.
9. Не достигнут результат browser QA 15/15.
10. Не проведена финальная ручная visual acceptance серия на обязательных desktop/mobile маршрутах.
11. Не проверены вручную hero/header overlap, hero handoff, image reveal, sticky nav, related hovers и CTA+footer на репрезентативных страницах.
12. Не актуализирован `docs/design/final-design-implementation-report.md` фактическими итогами и оставшимися компромиссами.
13. Не выполнена финальная матрица соответствия каждому требованию исходного задания и всем 13 success criteria.

## 6. Созданные или изменённые файлы и назначение

Ниже перечислены файлы, точно известные по истории. Полный список необходимо восстановить через свежий `git status` и `git diff --name-only`; текущая сессия не запускала их после запроса на handoff.

### 6.1 Design-документы

- `docs/design/final-art-direction-master-plan.md` — финальная visual/motion/page/product система и правила.
- `docs/design/final-design-audit-v3.md` — честный аудит текущих страниц/паттернов и требуемых исправлений.
- `docs/design/product-presentation-model.md` — критерии и сценарии standard vs premium.
- `docs/design/cms-product-presentation-switch.md` — редакторская и техническая логика переключателя.
- `docs/design/final-design-implementation-report.md` — итоговый отчёт; требует финального обновления.

### 6.2 Product rendering

- `src/components/v2/CatalogProductV2.astro` — автоматический selector standard/premium.
- `src/components/v2/CatalogStandardProductV2.astro` — компактный standard template, выделенный из прежней продуктовой страницы.
- `src/components/v2/CatalogPremiumProductV2.astro` — richer engineering-solution template.
- `src/styles/v2/final-art-direction-v2.css` — общая premium design system, product variants, hero/image-ready/nav/CTA/footer/responsive styles.

### 6.3 Layout, hero и image-ready

- `src/utils/v2ImageReady.ts` — ожидание media load/decode перед reveal; содержит известный timeout defect.
- `PublicV2Layout.astro` — подключение final CSS в head и hero-scroll runtime. Точный каталог файла нужно подтвердить через `rg --files`.
- `CatalogV2Layout.astro` — integration image-ready/reveal. Точный каталог файла нужно подтвердить.
- `HomeV2.astro` — hero-scroll hooks и image-ready/reveal integration. Точный каталог файла нужно подтвердить.
- `HomeV2Header.astro` — расширен selector hero boundary. Точный каталог файла нужно подтвердить.
- `ImmersiveDirectionHero.astro` — hero-scroll hooks. Точный каталог файла нужно подтвердить.
- `V2CatalogHero.astro` — hero-scroll hooks. Точный каталог файла нужно подтвердить.
- `src/components/v2/V2SectionNav.astro` — текущая реализация sticky nav; требует исправления известного `aria-current` дефекта. Нельзя утверждать без свежего diff, что файл уже изменялся именно текущей сессией.

### 6.4 Schema, CMS и product data

- schema-файл product collection — добавлены `presentationType` и optional premium fields; точный путь следует найти через `rg -n "presentationType" src`.
- файлы визуального и технического CMS editor — добавлены select/hint/conditional premium editors; точный список следует получить через `git diff --name-only` и `rg -n "presentationType"`.
- все 68 product JSON в текущей product data/content collection — добавлен явный `presentationType`; девять premium JSON получили дополнительные premium-поля.

### 6.5 Page polish

Изменены page/components для custom order, projects archive, company, contacts, vacancies и direction pages. Точный перечень путей в истории handoff не зафиксирован надёжно; его нужно восстановить командой `git diff --name-only -- src` и сопоставить с diff. Не следует угадывать имена или заново переписывать эти страницы до проверки существующих изменений.

### 6.6 QA

- `tools/migration/final-design-qa.mjs` — статическая финальная проверка.
- `tools/migration/browser-final-design-qa.mjs` — browser/responsive/animation/sticky/image проверка.
- `package.json` — добавлены scripts `qa:final:static`, `qa:final:browser`, `qa:final`.

### 6.7 Состояние репозитория до этой работы

До текущего прохода рабочее дерево уже содержало множество tracked/untracked изменений, включая `.astro`, `dist`, migration screenshots/reports, `src/components/v2`, design-lab assets, `docs/design/`, `src/styles/v2/final-art-direction-v2.css` и `V2SectionNav`. Все такие изменения нужно считать пользовательскими/совместными, пока diff не докажет обратное. Запрещено использовать `git reset --hard`, `git checkout --` или массово удалять untracked файлы.

## 7. Важные решения и допущения

1. `presentationType` выбран как простое редакторское поле с безопасным default `standard`.
2. Неизвестный/отсутствующий тип должен рендериться как standard, чтобы не ломать существующий контент.
3. Premium назначается консервативно только пространственно/конструктивно значимым решениям; обычные лавочки, скамейки, урны и простые МАФы остаются standard.
4. Premium page — не просто другой цвет: у неё отдельная информационная драматургия и richer sections.
5. Premium-only CMS data при переключении на standard скрывается, но не уничтожается.
6. Дополнительный premium content не должен изобретать технические характеристики; использован только смысл существующего контента.
7. Для QA в DOM введены стабильные маркеры `data-product-presentation` и `data-premium-product-section`.
8. Hero motion ограничен по интенсивности, отключается/упрощается при reduced motion и не должен превращаться в sticky text.
9. CSS final art direction перенесён в `<head>`, чтобы избежать late restyle.
10. Изображение нельзя считать готовым только из-за истечения таймаута. При сетевой ошибке нужен честный fallback/broken state, а не reveal пустого контейнера.
11. Референсы используются как принципы; mask/cut-out text и избыточная art-стилистика сознательно исключены.
12. URLs, исходные media и существующая CMS-логика должны сохраняться.

## 8. Уже запускавшиеся команды и результаты

Все результаты ниже относятся к моменту запуска конкретным агентом и **могут предшествовать части параллельных изменений**. Перед завершением их нужно повторить.

### 8.1 Сообщено page-polish агентом

- `npm run check` — 0 errors, 0 warnings.
- build — success, сгенерировано 227 pages.
- `git diff --check` — clean.
- более ранняя visual/browser серия — 41/41, без broken images и stuck reveals.

Последний пункт особенно нужно перепроверить: он мог быть получен до введения/изменения текущего 6-second image-ready timeout.

### 8.2 Сообщено CMS-агентом

- admin tests — 21/21.
- `npm run check` — 0 errors.
- schema/JSON validation для premium content — успешно.

### 8.3 Сообщено QA-агентом

- static/dist QA — 34/34.
- проверено 107 routes.
- проверено 9193 links/anchors.
- проверено 2285 media references/elements.
- sitemap, 404/legacy, CMS и standard/premium проверки прошли.
- browser QA — 12/15, то есть финально **не прошёл**.

Browser QA выявил два класса дефектов:

1. reveal по timeout может показать ещё не загруженное изображение;
2. sticky nav сбрасывает `aria-current` после anchor click на desktop и mobile.

## 9. Команды с ошибкой, зависанием или недостоверным результатом

- Явно зафиксированных бесконечно зависших build/test команд в истории нет.
- Browser QA завершился неполным результатом 12/15; это достоверный fail, а не успешная проверка.
- Полный `npm run qa:final` после всех изменений не был подтверждён.
- Предыдущая попытка начать свежую инвентаризацию `git status`/`git diff` была прервана сменой пользовательского запроса до получения результатов. Поэтому свежего достоверного снимка рабочего дерева нет.
- Check/build/static/admin результаты были получены разными агентами в параллельной работе. Они полезны как промежуточные свидетельства, но не являются достоверной финальной проверкой объединённого состояния.
- Новая сессия должна использовать явные конечные timeout. Если команда не показывает прогресс, её следует остановить, проверить процессы/порт/preview server и перезапустить ограниченный сценарий; нельзя ждать бесконечно.

## 10. Оставшиеся проблемы, которые нужно исправить

### P0 — блокируют завершение

1. `v2ImageReady.ts`: timeout не должен объявлять незагруженное изображение ready. Требуемое поведение:
   - дождаться `load` + по возможности `decode`;
   - при конечном timeout/error показать предусмотренный fallback/broken state, а не пустую фотографию;
   - можно оставить late-load recovery, но reveal должен происходить только для реально готового изображения или явного fallback;
   - исключить вечное ожидание.
2. `V2SectionNav.astro`: после клика выбранный anchor обязан корректно сохранить/перевести `aria-current`, пока scroll sync не подтверждает новую активную секцию; исправить desktop и mobile без вечных locks/timers.
3. Browser QA должен стать 15/15 после исправлений.
4. Выполнить финальный check/build/static/browser/admin QA на одном объединённом состоянии.
5. Провести ручную visual acceptance обязательных страниц и исправить найденные сетки/переносы/пустоты/overlaps.
6. Обновить final implementation report реальными результатами.

### P1 — обязательная полнота исходной задачи

1. Подтвердить или добавить premium indicator в product listing cards без маркировки standard как engineering solution.
2. Визуально подтвердить разницу standard vs premium на реальных маршрутах, включая `kachel-portal` и обычную скамейку/урну.
3. Проверить Home, custom order, все три направления, projects archive + detail, company, contacts, vacancies, category landing и обе product variants.
4. Проверить related grids и hover, CTA+footer, sticky page nav, header/hero handoff.
5. Проверить отсутствие пустого reveal при normal, delayed и failed image loading.
6. Подтвердить CMS switch для существующего и нового товара, сохранение premium fields при обратном переключении.

## 11. Точная рекомендуемая последовательность продолжения

1. Прочитать этот handoff, исходное пользовательское задание, `AGENTS.md`, `docs/MASTER_SPEC.md` и пять design deliverables.
2. Без изменений снять фактическое состояние короткими командами с timeout:
   - `git -c core.quotepath=false status --short`
   - `git diff --stat`
   - `git diff --name-only`
   - `git diff --check`
   - `rg -n "presentationType|data-product-presentation|data-premium-product-section" src`
3. Сопоставить diff со списком файлов выше. Не откатывать unrelated/user changes.
4. Прочитать `src/utils/v2ImageReady.ts` и browser QA assertion для delayed/failed images. Исправить timeout через готовый fallback/broken state и конечный таймер. Не ослаблять тест.
5. Прочитать `V2SectionNav.astro` и browser assertion. Исправить click/scroll synchronization и `aria-current` для desktop/mobile с конечным lock/timer. Не маскировать проблему увеличением ожидания теста.
6. Проверить `V2ProductCard` и product presentation model. Если indicator отсутствует, добавить только для premium и назвать нейтрально/делово («Решение для объекта» или формулировкой из утверждённой модели).
7. Выполнить быстрые source checks с конечными timeout: schema/admin tests и `npm run check`.
8. Выполнить build с конечным timeout. Если зависает — остановить, найти оставшийся preview/node process, проверить лог и перезапустить один раз на свободном порту.
9. Выполнить `npm run qa:final:static`.
10. Выполнить `npm run qa:final:browser`; требование — 15/15. Проверить, что скрипт корректно завершает preview server.
11. Провести ручную visual QA серию desktop/mobile по обязательным маршрутам. Сохранять screenshot evidence в существующую QA/migration структуру, не плодить новый несогласованный формат.
12. Исправить только подтверждённые visual defects. После правок повторить check/build/static/browser и релевантные screenshots.
13. Обновить `docs/design/final-design-implementation-report.md`: фактические страницы, standard/premium split, schema/CMS, совместимость, QA numbers, ограничения и только реальные компромиссы.
14. Финально выполнить `git diff --check`, проверить пять обязательных документов и сопоставить результат со всеми исходными критериями.
15. Завершать задачу только при отсутствии известных P0/P1 дефектов. Если что-либо объективно заблокировано внешним контентом/сервисом, описать это точно, но не выдавать за завершённое.

## 12. Критерии полной приёмки новой сессией

Новая сессия может считать исходную задачу выполненной только если одновременно подтверждено следующее:

1. Существуют и актуальны все пять обязательных документов.
2. `presentationType` доступен редактору для нового и существующего продукта, принимает только `standard|premium`, безопасно default-ится в standard и не теряет premium data при переключении.
3. Все существующие продукты валидны; обычные продукты остаются standard, девять выбранных пространственных решений — premium либо любое изменение списка отдельно обосновано данными.
4. Standard и premium имеют объективно разные шаблоны и DOM/визуальные сценарии; standard компактен, premium richer, без pseudo-premium.
5. На listing card premium можно отличить, но standard не получает ложный инженерный статус.
6. Home и каждая обязательная страница имеют сильный, влезающий first screen без башен переносов, giant whitespace и сломанной сетки.
7. Hero scroll не пересекается с header, не становится sticky и полностью уходит под следующую секцию; reduced motion корректен.
8. Ни одно reveal-изображение не появляется пустым: normal, delayed и failed loading имеют корректное состояние.
9. Sticky navigation визуально качественна, клики/scroll/deep links работают, `aria-current` стабилен на desktop/mobile.
10. Related grids не перекрываются, тексты не ломаются, hover читаем и согласован с royal-blue системой.
11. CTA + footer образуют цельный финальный экран на репрезентативных страницах; legal/cookies alignment собран.
12. URLs, content model compatibility, media и business logic не сломаны.
13. `npm run check` проходит без ошибок; build проходит; route/link/image/static QA проходит; admin/schema tests проходят; browser QA показывает 15/15.
14. Ручная visual acceptance проведена на desktop и mobile для Home, custom order, metalworks, landscaping, construction, projects listing/detail, company, contacts, vacancies, category, standard product и premium product.
15. Нет известных сломанных сеток, текстовых башен, бессмысленных giant sections, слишком мелкого ключевого текста, пустых reveal photos, hero/header overlap, слабого финального экрана или неразличимых product variants.
16. `final-design-implementation-report.md` отражает именно финальное состояние, результаты проверок и честные ограничения.

## 13. Короткий итог для следующей сессии

Архитектурно основная трансформация уже сделана: design documents, CMS switch, 59/9 data split, отдельные standard/premium templates, page polish и QA scripts присутствуют. Но задача не готова к сдаче. Сначала восстановить diff, затем исправить два известных browser-дефекта (image-ready timeout и sticky `aria-current`), подтвердить premium listing indicator, выполнить единый полный QA и только после ручной visual acceptance обновить итоговый отчёт.

## 14. Продолжение 2026-07-18 — исходная матрица

- Ветка и baseline повторно подтверждены: `v2-visual-polish`, `44148a74f1562613a30ad4ad823315b16cdda5ee`.
- Task commit по-прежнему отсутствует; staged files отсутствуют.
- Создана `docs/design/FINAL_CURRENT_TASK_REQUIREMENTS_MATRIX.md`. В ней зафиксированы только проверенные доказательства, известные дефекты и способы финальной приёмки.
- Подтверждённая незавершённая работа: image-ready fallback, sticky `aria-current`, admin write validation, paired catalog export/import, premium listing indicator, объединённый check/build/browser/visual/admin QA, актуализация документов и acceptance.
- Следующий точный шаг: выполнить независимые кодовые исправления, начиная с CMS, image-ready и sticky navigation, затем объединить их в одном build/QA состоянии.
- Git status остаётся намеренно грязным из-за незакоммиченной текущей задачи и старых generated/Design Lab артефактов; ничего не сбрасывалось и не удалялось.

## 15. Продолжение 2026-07-18 — функциональные исправления

- Реализован media-ready contract `pending | ready | fallback`: timeout/error показывает доступный непустой fallback, поздняя загрузка восстанавливает изображение и переводит состояние в ready.
- Исправлена гонка sticky navigation: bounded lock 1800 ms удерживает единственный `aria-current` до достижения anchor offset и затем возвращает geometry sync.
- В product listing добавлена нейтральная метка «Решение для объекта» только для premium; standard визуально не маркируется.
- Product POST/PUT теперь валидируется schema до записи; legacy record материализует `standard`, invalid enum возвращает 400 и не изменяет файл.
- `catalog_export` сохраняет старые поля и получил импортируемый `productImport`; standalone и nested envelope поддерживаются, старый lossy envelope отклоняется явно.
- Изолированные admin tests: 22/22 pass. Source contract QA: 27/27 pass. Node syntax и `git diff --check`: pass.
- Остановлены 22 старых orphaned headless Chrome process; удалены только три одноразовых temp-профиля общей ёмкостью около 152 MB. Пользовательские Chrome/Edge не затронуты.
- Следующий точный шаг: последовательные `npm run check`, `npm run build`, static/browser QA на объединённом состоянии.

## 16. Продолжение 2026-07-18 — объединённый QA и устранение visual defects

- На объединённом состоянии подтверждены: `npm run check` — 0 errors/0 warnings (33 существующих hints); `npm run build` — 227 страниц; `npm run qa:final:static` — 38/38; `npm run test:admin-import` — 22/22; focused browser QA — 17/17, без runtime и local-network errors.
- Первый полный visual-polish browser run завершился штатно за 541.1 s, проверил 107 canonical routes, 24 click navigation, 270 responsive assertions, 124 motion assertions, 22 footer assertions, 7 functional assertions и создал 31 свежий screenshot. Он выявил 13 записей, сведённых к трём первопричинам: project hero overflow, reduced-motion media opacity и vacancy reflow на 320 px.
- Исправлен reduced-motion каскад: элементы `v2-image-awaiting` больше не скрываются, когда пользователь просит уменьшить motion; media-ready/fallback логика продолжает работать.
- Исправлен узкий vacancy layout: длинный русский H1 получает локальный безопасный перенос, grid/channel children допускают сжатие. Targeted QA подтвердил 320 px без overflow.
- Исправлен project-detail hero: media height больше не превращает intrinsic aspect ratio в минимальную ширину grid item; desktop media занимает собственный track, а на <=1180 px сохраняет responsive aspect-ratio. Targeted QA подтвердил 1440 и 1280 px без overflow.
- В `browser-visual-polish-qa.mjs` добавлен переиспользуемый targeted режим `--routes`/`--viewports`; он использует тот же Chromium/CDP audit contract, пишет только во временную `.astro` и не заменяет финальные отчёты. Диагностика overflow теперь сохраняет clipped candidates для точного определения источника.
- Последняя сборка после этих исправлений: success, 227 pages, 7.17 s. Последний targeted project-detail audit: pass, failures 0, runtime errors 0, local network errors 0.
- Следующий точный шаг: один финальный полный visual-polish browser run со screenshots, затем независимая визуальная сверка, актуализация пяти design documents/matrix/acceptance/handoff и точечный local commit без generated артефактов.

## 17. Продолжение 2026-07-18 — независимая visual acceptance и premium hero

- Независимый просмотр 31 screenshot принял 27 кадров без замечаний и выявил фактический P0 на desktop Portal: hero-copy был `opacity: 1`, но находился ниже первого viewport. Причина подтверждена computed geometry: общий `[data-v2-media] { position: relative; }` перебивал равный по специфичности premium media selector, поэтому media занимало 1069 px normal flow перед copy.
- Premium media selector усилен до прямого child + `[data-v2-media]`; desktop media снова absolute, mobile override остаётся relative. Для overlay-header у premium product убран общий верхний padding `main`, поэтому header находится на тёмном hero, а не на светлой полосе.
- Mobile legal footer собран в двухколоночный уровень для privacy/cookies; copyright и disclaimer занимают полную ширину выше него.
- Browser QA получил регрессионное условие `hero-copy-outside-first-screen`: наличие элемента и ненулевая opacity больше не считаются достаточными, если copy геометрически вне первого viewport.
- Сборка после исправления: success, 227 pages, 8.43 s. Targeted Portal QA на 1440x900 и 390x844: pass, 0 failures/runtime/network errors. Desktop hero теперь 900 px, copy расположен `top=481/bottom=828`; mobile copy — `top=138/bottom=581`.
- Следующий точный шаг: повторный полный visual-polish QA со screenshots, проверка свежих Portal/footer кадров, затем окончательная документация, acceptance и commit.

## 18. Финальное состояние 2026-07-18 — acceptance готова

- Повторный полный visual-polish run после Portal/footer исправлений: pass за 555.5 s; 107 canonical direct loads, 24 real click navigations, 270 responsive assertions, 124 motion assertions, 22 footer assertions, 7 functional assertions, runtime errors 0, local network errors 0, failures 0. Создан 31 свежий proof PNG общей ёмкостью 17 392 854 bytes.
- Свежие `product-premium-portal-desktop.png`, `product-premium-portal-mobile.png` и `home-footer-mobile.png` просмотрены вручную: desktop Portal copy/media присутствуют в первом экране, overlay header контрастен, mobile header контрастен, privacy/cookies собраны на одном legal-уровне. Остальные 27 кадров уже были приняты независимым visual review; затронутые кадры перепроверены после fix.
- Финальные production checks: `npm run check` — 186 files, 0 errors, 0 warnings, 33 existing hints; `npm run build` — 227 pages; static QA — 38/38 (107 routes, 9 193 links, 2 285 media, 59 Standard/9 Premium); admin/API tests — 22/22; focused browser — 17/17.
- Добавлен изолированный реальный `npm run qa:admin-browser`: итог 29/29. Он проверяет visual editor Standard → Premium, conditional fields, save/reload, UI catalog export, UI import Standard с сохранением premium data, UI import скачанного Premium с reload, invalid UI/API no-write. Один publish POST блокируется proxy; production content, HEAD и index остаются неизменными; sandbox находится вне Git на D:, восстанавливается и удаляется; Chromium/server/ports закрыты.
- Пять обязательных design docs синхронизированы с фактическими tokens/components/schema/QA; legacy `final-art-direction-spec.md` получил superseding addendum. Созданы/актуализированы `FINAL_CURRENT_TASK_REQUIREMENTS_MATRIX.md` (54 DONE, остальные статусы 0) и `FINAL_CURRENT_TASK_ACCEPTANCE.md` (CRITICAL 0).
- Scope data повторно подтверждён: изменения всех 68 product records аддитивны; 59 Standard/9 Premium; slugs, ownership, prices, media, dimensions, existing materials/facts не менялись; `public/**`, `.github/**`, deployment, contacts и legal не затронуты.
- Ветка остаётся `v2-visual-polish`, baseline до задачи — `44148a74f1562613a30ad4ad823315b16cdda5ee`. Push/deployment не выполнялись.
- Единственный следующий шаг при восстановлении до commit: повторить краткий final source/scope audit, точечно stage только task files (исключить `.astro`, `dist`, `docs/migration`, `docs/design-lab`), создать один local commit `design: complete final premium product presentation system`, затем проверить residual status/processes/disks. Если этот commit уже виден в `git log`, задача завершена и повторная реализация не нужна.

# СМУ-1 — final art direction master plan v3

Статус: реализованная и проверенная production-система на 18 июля 2026 года. Концепция называется **Engineering Clarity**, её цветовая реализация — **Engineering Blue**. Фактическая приёмка зафиксирована также в `final-design-implementation-report.md` и `FINAL_CURRENT_TASK_ACCEPTANCE.md`.

## 1. Концепция

Финальная система называется **Engineering Clarity**: крупная уверенная типографика, реальные изделия и объекты как главный визуальный аргумент, холодная нейтральная база и точечный royal blue как коммерческий акцент. Сайт должен выглядеть не как универсальный шаблон, а как цифровая система производственно-строительной компании: точная, спокойная, масштабная и доказательная.

Референсная иерархия:

- Skanska — масштаб первого экрана, сочетание фотографии и крупного текста, ритм белых/тёмных/синих поверхностей и уход hero под следующий экран;
- Arup — появление header, навигации и текста, короткие чистые переходы;
- MVRDV — композиционное наложение текста на изображение без масок и декоративного шума;
- Turner Construction — строгий завершающий CTA и плотный корпоративный footer;
- Snøhetta — спокойная крупная типографика и дисциплина размеров без избыточной арт-подачи.

## 2. Визуальная система

### Цвет

| Роль | Значение | Применение |
| --- | --- | --- |
| Ink / near-black | `#101720` | основной текст, footer, тёмные CTA |
| Contrast / navy-graphite | `#171F29` | hero, инженерные секции, финальный экран |
| Royal blue | `#1E4FA3` | primary CTA, active state, ссылки, hover |
| Royal blue hover | `#153D82` | hover/focus primary actions |
| Light blue | `#DFE9F8` | редкие информационные поверхности |
| Cold white | `#F4F6F8` | базовый фон |
| White | `#FFFFFF` | поднятые поверхности, карточки |
| Steel | `#E8EDF2` | вторичный фон и media wells |
| Border | `#CBD3DC` | сетки и спокойные разделители |
| Muted text | `#5B6570` | только вспомогательная информация |

Запрещены бледно-жёлтые, mint/olive и случайные пастельные поверхности. Royal blue используется как действие или композиционный акцент, а не как сплошная заливка каждого блока. На одной прокрутке должно быть не более одной доминирующей синей поверхности подряд.

### Типографика

Основной шрифт — Manrope с системным fallback. Начертания: 400/500 для текста, 600/700 для заголовков и интерфейса.

- display/H1: `clamp(44px, 6vw, 96px)`, line-height `0.96–1.02`, tracking `-0.045em`;
- H2: `clamp(36px, 4.4vw, 68px)`, line-height `1.0–1.08`;
- H3/card title: `clamp(22px, 2vw, 32px)`, line-height `1.12`;
- lead: `clamp(18px, 1.45vw, 23px)`, line-height `1.45–1.55`, максимум 64 знака в строке;
- body: 16–18px, line-height `1.55–1.65`;
- eyebrow: 11–12px, 600–700, uppercase, tracking `0.08–0.11em`;
- metadata/table/sticky nav: 12–14px, 600–700, без светло-серого низкоконтрастного текста.

По умолчанию заголовки используют `overflow-wrap: normal`, `word-break: normal` и не зажимаются в узкие колонки. Для длинных русских H1 сначала уменьшается размер либо расширяется колонка. Локальный `overflow-wrap: anywhere` допустим только как последний reflow-предохранитель в ограниченном контексте — сейчас он используется у project detail и vacancy detail. Вручную заданные переносы допустимы только как утверждённая композиция.

### Сетка и плотность

- максимальная ширина контента: 1360px;
- desktop gutters: 32px, tablet: 20px, mobile: 16px;
- базовая сетка: 12 колонок, gap 24px;
- вертикальный ритм секций: 72–120px desktop, 52–76px mobile;
- полезный контент не растягивается до `100vh`, если он занимает две строки;
- карточные сетки: 3 колонки desktop, 2 tablet, 1 mobile; одинаковая высота достигается содержательной структурой, а не огромным `min-height`.

## 3. Motion system

- header reveal/state: 300ms, `cubic-bezier(0.22, 1, 0.36, 1)`;
- hover/focus: 180ms;
- content reveal: 480–560ms, translateY не более 12px;
- media reveal: opacity + scale `1.02 → 1`, без агрессивных масок;
- stagger: 50–70ms, максимум четыре элемента подряд;
- все эффекты отключаются при `prefers-reduced-motion: reduce`.

Для ключевых hero используется controlled scroll handoff: копия движется вниз со скоростью примерно `0.18–0.24` от scroll progress, одновременно плавно теряет opacity и полностью скрывается clipping-границей hero до контакта с header. Hero не `position: sticky` на всю страницу и не задерживает естественный скролл. На mobile эффект ограничивается opacity/малой трансформацией либо отключается.

Reveal медиа работает по конечному автомату `pending → ready | fallback`. Состояние `ready` выставляется после `load` и попытки `HTMLImageElement.decode()`; конечный timeout 6000 ms или `error` переводит media в непустой доступный fallback с `role="status"`, а не показывает пустую картинку. Поздняя успешная загрузка после fallback восстанавливает изображение и состояние `ready`. При reduced motion awaiting-media остаётся видимым, а readiness/fallback логика продолжает работать. Текстовые reveal не ждут lazy-изображений вне своей media-группы.

## 4. Page и component system

### Hero

- главная и инженерные направления: full-bleed media, тёмная вуаль, крупная копия слева, 1 primary + 1 secondary CTA;
- каталог/категория: split hero с понятной продуктовой иерархией, без лишней театральности;
- premium product: отдельный editorial hero с масштабной галереей и статусом «Инженерное решение»;
- standard product: компактный двухколоночный first screen, изображение + summary;
- контакты/вакансии: компактный текстовый intro 340–480px, без искусственного full-screen.

Hero всегда содержит ответ на три вопроса: что предлагается, для кого/какой задачи и какое следующее действие. Header на тёмном hero прозрачный, после границы hero — белый; hero-копия не пересекается с header.

### Sticky navigation

Локальная навигация располагается под header, имеет высоту 52–56px, вес 650–700, явный active underline royal blue и горизонтальный scroll на mobile. Компонент оставляет только ссылки на реально существующие цели и скрывается, если целей меньше двух. При скрытом global header навигация поднимается к `top: 0`; anchor offset динамически учитывает обе панели. После click/hash выбранная цель удерживается единственным `aria-current="location"` конечным lock до 1800 ms, с settle 120 ms после достижения целевой полосы, затем управление возвращается geometry sync.

### Cards и related blocks

- единая сетка без span-исключений, создающих сломанные пустоты;
- заголовок максимум 2–3 строки, body не уже 18ch;
- media aspect-ratio задаётся типом карточки;
- hover: royal blue surface или уверенный blue underline, белый текст только при достаточном контрасте;
- весь card target кликабелен, интерактивные controls остаются выше stretched link.

### CTA + footer

Последний CTA и footer образуют один navy/near-black экран без светлого разрыва. CTA: крупный заголовок, короткое пояснение, primary действие и Telegram/phone. Footer остаётся крупным: логотип 70px+, две группы навигации, контакты и выровненная legal-строка. Суммарная высота финального экрана должна быть плотной, без пустого «подвала».

### Изображения

- реальные объектные фото — `cover`, isolated product renders — `contain` на белой/steel поверхности;
- hero media: eager + `fetchpriority="high"`; ниже первого экрана: lazy + async decode;
- обязательны width/height или aspect-ratio, чтобы исключить layout shift;
- placeholders не должны маскироваться под реальные кейсы;
- исходные файлы не перекрашиваются и не обрезаются физически: crop хранится в `imageView`.

## 5. Обязательные изменения по страницам

- **Home:** сохранить сильный объектный hero, перевести палитру в Engineering Blue, увеличить nav/lead, добавить scroll handoff, сократить повторяющиеся тёмные поверхности и укрепить доказательные проекты.
- **Изготовление на заказ:** сделать главным коммерческим сценарием; первый экран «фото / эскиз / чертёж / ТЗ», затем входные данные, направления, процесс, примеры и быстрый контакт.
- **Металлоконструкции / благоустройство / строительство:** унифицировать immersive hero, убрать текстовые башни и viewport-breaking min-heights, привести scope к плотной 2×N/1×N сетке.
- **Выполненные объекты:** усилить intro, вынести featured case, держать cards и detail facts в ограниченной ширине.
- **О компании:** собрать split hero и доказательные направления без oversized секций.
- **Контакты / вакансии:** оставить быстрыми практическими страницами; контакты и открытые позиции должны быть видны в первом/втором экране.
- **Категории:** убрать бледную рыхлость, усилить встречающий split hero, привести product grid и sparse states к одной системе.
- **Товары:** переключать два сценария строго по `presentationType`; standard остаётся компактным, premium получает richer narrative и gallery.

## 6. Порядок реализации и acceptance

1. Зафиксировать audit, product model и CMS switch.
2. Добавить schema/default/admin switch и пометить проверенные premium records.
3. Разделить product rendering, не меняя URL и related logic.
4. Вынести image-ready reveal и hero-scroll в общий motion controller.
5. Доработать обязательные страницы и финальный CTA/footer.
6. Пройти `check`, `build`, route/link/media audit и browser screenshots на 1440, 1024, 768, 390 и 320px.

Готовность означает отсутствие горизонтального overflow, обрезанных H1, пустых reveal media, пересечений header/nav, бессмысленных full-screen секций и визуально одинаковых standard/premium product pages.

## 7. Фактическое component/page mapping

| Сценарий | Route family | Основные компоненты |
| --- | --- | --- |
| Главная | `/` | `HomeV2.astro`, `HomeV2Header.astro`, `HomeV2Footer.astro` |
| Изготовление на заказ | `/izgotovlenie-na-zakaz/` | `custom-order/CustomOrderV2Page.astro` |
| Инженерные направления | металлоконструкции, благоустройство, строительство | `pages/MetalworksV2Page.astro`, `LandscapingV2Page.astro`, `ConstructionV2Page.astro`, `directions/ImmersiveDirectionHero.astro` |
| Split-направления | навесы, топиарии | `pages/CanopiesV2Page.astro`, `TopiaryV2Page.astro` |
| Каталог и категории | product sections и category routes | `CatalogSectionV2.astro`, `CatalogCategoryV2.astro`, `V2CatalogHero.astro`, `V2ProductCard.astro` |
| Standard product | product route с `presentationType=standard` | `CatalogProductV2.astro` → `CatalogStandardProductV2.astro` |
| Premium product | product route с `presentationType=premium` | `CatalogProductV2.astro` → `CatalogPremiumProductV2.astro` |
| Проекты | `/vypolnennye-obekty/` и detail | `projects/V2ProjectArchive.astro`, `V2ProjectDetail.astro`, `V2ProjectGallery.astro` |
| Практические страницы | компания, контакты, вакансии | `practical/V2CompanyPage.astro`, `V2ContactsPage.astro`, `V2VacanciesArchive.astro`, `V2VacancyDetail.astro` |
| Общая local navigation | страницы с двумя и более реальными секциями | `V2SectionNav.astro` |
| Общая media readiness | reveal-media всех V2-композиций | `src/utils/v2ImageReady.ts` |

## 8. Результат acceptance

- `npm run check`: 186 files, 0 errors, 0 warnings, 33 существующих hints;
- production build: 227 pages;
- final static QA: 38/38, включая 107 routes, 9 193 links и 2 285 media;
- admin/schema/API/export suite: 22/22;
- `npm run qa:admin-browser`: 29/29 — real visual-admin switch, save/reload, UI export/import, round-trip и invalid no-write;
- focused product/image/sticky browser QA: 17/17;
- полный visual-polish QA: 107 direct loads, 24 click navigations, 270 responsive, 124 motion, 22 footer и 7 functional assertions;
- 31 свежий PNG-файл, 17 392 854 bytes; runtime errors 0, local network errors 0, failures 0;
- representative Standard «Скамья СМУ-1 Базовая» и Premium «Качель Портал» приняты на desktop и mobile;
- browser-admin прогон выполнен в одной Chromium instance на внешней D:-sandbox: Standard → Premium fields, save/reload, UI catalog export, импорт Standard с сохранением premium fields, импорт скачанного Premium с reload, invalid UI/API без записи; runtime console 0. Один publish POST был намеренно перехвачен локально и не дошёл до git/remote; production content, HEAD и index не изменились, temp удалён.

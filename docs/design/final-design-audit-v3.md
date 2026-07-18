# СМУ-1 — финальный дизайн-аудит v3

Статус документа: **pre-implementation baseline** финального прохода. Формулировки разделов 1–4 описывают состояние до исправлений и сохранены как трассировка решений; фактическое закрытие findings приведено в разделе 5.

## 1. Состояние системы

На момент baseline в репозитории уже была сильная V2-база: общие layouts, единый header/footer, immersive direction heroes, каталог, projects, practical pages, reveal-логика и большой набор browser screenshots. Незавершённый слой `final-art-direction-v2.css` только начинал переход от olive к navy/royal blue, существовал как поздно подключаемый override и содержал много компенсирующих правил. Визуальный уровень был неоднороден: главная и часть направлений выглядели убедительно, практические, каталоговые и продуктовые сценарии заметно слабее.

## 2. Аудит по паттернам

| Область | Что плохо | Почему плохо | Исправление |
| --- | --- | --- | --- |
| Палитра | Одновременно живут olive/mint, warm beige, graphite и новый blue override | страницы выглядят как разные версии продукта | сделать Engineering Blue единственной production-темой, убрать palette-switch из production и закрепить токены |
| CSS cascade | Финальный CSS загружается отдельным `<link>` в конце `body` | риск позднего restyle/FOUC и трудно предсказуемый cascade | подключить последний слой штатным layout import, исправить синтаксис и оставить только необходимые overrides |
| Типографика | nav и metadata местами слишком мелкие; длинные H1 зажаты | слабый B2B-вес, «башни» переносов | поднять базовые размеры, ограничить line length, дать длинным H1 более широкую колонку |
| Hero | несколько несовместимых hero-паттернов и oversized min-height | сайт не ощущается системой, текст иногда занимает слишком много viewport | оставить четыре осознанных hero family и ограничить высоту по типу страницы |
| Hero scroll | отсутствует требуемый уход копии под следующую секцию | первый экран статичен и не достигает уровня референса | общий controlled scroll handoff с clip/opacity и reduced-motion fallback |
| Reveal изображений | observer открывает media независимо от `decode()` | контейнер может появиться раньше картинки | image-ready promise, fail-open при error, reveal после decode |
| Sticky nav | появился недавно, но текст мал и state зависит от CSS `:has()` | дешёвый вид и потенциальная нестабильность | усилить типографику и синхронизировать top через class/data state |
| Related grids | разные span/min-height и сложные stretched links | переносы, пустоты и зона клика ведут себя непоследовательно | единая 3/2/1 grid contract и общий interactive layering |
| Final screen | CTA/footer стилистически близки, но не всегда слиты | конец страницы ощущается набором двух блоков | общий navy container, единый padding и legal alignment |

## 3. Аудит страниц

### Home

Сильная сторона — реальное объектное фото металлического каркаса и серьёзная композиция. Слабые места: слишком мелкая desktop navigation, статичный hero, повторяемость тёмных секций и часть шаблонных competency cards. Исправление: крупнее header/lead, scroll handoff, больше белых доказательных секций между navy-блоками, чёткая иерархия «изделия и конструкции → направления → объекты → контакт».

### Изготовление на заказ

Сейчас split hero светлый и визуально рыхлый; маленькая isolated product card конкурирует с объектным фото, а главный сценарий не выглядит приоритетным. Исправление: компактный, но сильный navy/split hero; четыре типа входных данных как явная последовательность; затем направления, адаптируемые параметры, процесс и CTA. Убрать лишний palette UI и декоративный текст, который не ведёт к заявке.

### Металлоконструкции

Hero уже убедителен, но длинное слово и narrow copy могут давать риск на промежуточных ширинах. Ниже встречаются слишком большие scope/task cells. Исправление: специальный size cap для русского H1, плотная 2×N сетка, ограничение min-height и единый CTA.

### Благоустройство

Главная проблема — H1 превращается в башню на desktop, хотя место в кадре есть. Табличные блоки перегружены одинаковым визуальным весом. Исправление: шире copy до 8–9 колонок, меньше display size только для этой строки, scope разделить на компактные пары «задача/результат».

### Строительство

Тёмная copy-panel на hero выглядит отдельной карточкой поверх фотографии и занимает слишком много площади. Исправление: убрать тяжёлую panel treatment, оставить свободную композицию с контролируемой вуалью; ограничить hero до viewport и уплотнить последующие sections.

### Выполненные объекты и карточка объекта

Archive intro слишком текстовый и слабее самих фотографий; карточки начинаются как обычная сетка. Detail hero и факты могут растягиваться. Исправление: featured project первым доказательством, крупнее image-to-copy ratio, facts без больших min-height, gallery с decode-ready reveal.

### О компании

Split hero работает, но композиция слишком похожа на каталог, а последующие statements рыхлые. Исправление: сохранить real-media split, сократить hero, собрать направления и факты в плотные доказательные модули, не придумывать несуществующие цифры.

### Контакты

Страница уже функциональна, но первый intro и четыре contact cards можно сделать плотнее. Email и адрес требуют безопасного wrapping. Исправление: hero 340–420px, primary phone как royal-blue anchor, остальные каналы нейтральные, карта и адрес сразу следом.

### Вакансии

Нужна та же практичность, что контактам: hero не должен быть full-screen. Одна вакансия должна занимать одну горизонтальную строку на desktop и карточку на mobile; пустое состояние — короткое и с контактом.

### Каталог и категории

Текущий split hero и cards стали лучше, но pale surfaces и слишком высокие карточки сохраняют ощущение каталожного шаблона. Исправление: navy category hero, steel/white cards, media 4:3, заголовки максимум три строки, 3/2/1 grid. Sparse category не должна имитировать заполненный каталог.

### Product detail

На момент baseline существовал один универсальный шаблон: он был приемлем для обычного изделия, но недостаточен для «Портала» и одновременно слишком тяжёл для простой урны. Требуемое исправление: два реальных шаблона. Standard — компактный summary/spec/gallery/CTA. Premium — editorial hero, solution/application/adaptation/variants/technical narrative, richer gallery и статусный final CTA.

## 4. Приоритет исправлений

### Critical

1. Ввести `presentationType` и два различимых product templates.
2. Сделать image reveal зависимым от decode/load.
3. Реализовать безопасный hero-scroll handoff.
4. Устранить смешение palette и позднее подключение финального CSS.
5. Исправить H1/reflow и viewport-breaking sections на обязательных страницах.

### Important

1. Усилить sticky nav, related grids и final CTA/footer.
2. Пересобрать custom order как основной commercial path.
3. Усилить projects archive и плотность practical pages.
4. Провести responsive/animation/link/media browser QA.

### Не делать

- не менять публичные URL, route selection, формы и source media;
- не добавлять вымышленные сертификаты, числа, клиентов и технические свойства;
- не помечать все крупные картинки как premium;
- не скрывать проблемы CSS новыми глобальными `!important` без локальной причины.

## 5. Закрытие findings

| Finding baseline | Фактическое закрытие | Evidence |
| --- | --- | --- |
| Смешанная palette | Production theme закреплена как Engineering Blue; активные action tokens — `#1E4FA3` и `#153D82`, contrast — `#171F29`, near-black — `#101720` | `final-art-direction-v2.css`; полный screenshot review |
| Поздний CSS cascade | Финальный stylesheet предзагружается и подключается последним внутри `<head>`, не в `body` | `PublicV2Layout.astro` |
| Слабая типографика и reflow | Fluid H1/H2, широкие copy tracks и локальные предохранители для project/vacancy; 30 routes × 9 viewport modes без overflow failures | full visual QA: 270/270 responsive |
| Статичный hero | Общий controlled scroll handoff на desktop, natural flow и static reset на mobile/reduced motion | `PublicV2Layout.astro`; 124/124 motion assertions |
| Reveal до готовности image | `pending/ready/fallback`, load + decode, 6000 ms accessible fallback, late recovery | `v2ImageReady.ts`; focused browser QA delayed/timeout/error/recovery |
| Нестабильный sticky nav | Реальные anchors, dynamic offset, bounded 1800 ms target lock и единый `aria-current` | `V2SectionNav.astro`; desktop/mobile focused tests |
| Related grids / clickable cards | Единые minmax grids, whole-card targets, visible focus; gallery controls не вложены в stretched links | static QA + full functional browser scenarios |
| Разорванный final screen | Final CTA и footer собраны как единая dark sequence; legal/privacy/cookies выровнены, mobile accordion не дублирует desktop navigation | 22/22 footer assertions; принятые desktop/mobile screenshots |
| Один product template | Selector разделяет компактный Standard и editorial Premium без изменения URL | `CatalogProductV2.astro`, два variant-компонента, 59/9 rendered split |
| Слабый Portal case | Portal получил отдельный first screen, spatial gallery, application/adaptation/variants/technical sections и усиленный CTA | принятые Portal desktop/mobile screenshots; focused browser QA |
| Presentation switch не доказан через реальный editor | Visual admin проверен через Standard → Premium, save/reload, UI export/import, обратный Standard с сохранением premium fields и Premium round-trip; invalid UI/API не записываются | `npm run test:admin-import` 22/22; `npm run qa:admin-browser` 29/29 |

### 5.1. Итог проверки

- `npm run check`: 186 files, 0 errors, 0 warnings, 33 hints;
- build: 227 pages;
- static QA: 38/38, 107 routes, 9 193 links, 2 285 media;
- admin/schema/API/export suite: 22/22;
- admin browser round-trip: 29/29, runtime console 0; production content, HEAD и index unchanged;
- focused browser QA: 17/17;
- full visual QA: pass — 107 direct, 24 click, 270 responsive, 124 motion, 22 footer и 7 functional assertions;
- 31 PNG-файл, 17 392 854 bytes; runtime/network/failures — 0/0/0.

Архитектурный компромисс сохранён осознанно: `final-art-direction-v2.css` остаётся отдельным последним production-слоем поверх исторических V2 styles, а `:has()` всё ещё используется для визуального `top` local navigation. Active-state не зависит от `:has()` и подтверждён browser-тестами. Полный рефакторинг исторического CSS и физическая device-lab проверка Safari/Android не входили в текущий scope.

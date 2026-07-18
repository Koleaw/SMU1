# Final Visual Direction — SMU-1 V2

Дата фиксации: 17 июля 2026 года
Статус: production-направление финального прохода

## 1. Брендовая позиция

СМУ-1 воспринимается не как обычный подрядчик, дешёвый производитель или шаблонный строительный сайт.

Целевой образ:

> СМУ-1 — инженерно-производственная компания, которая превращает задачу объекта в изготовленное и смонтированное решение, соединяя конструкцию, производство и дизайн среды.

Визуальная система должна передавать пять качеств:

- **материальность** — металл, дерево, поверхность, узел, масштаб;
- **контроль** — ясная структура, точная иерархия, спокойная сетка;
- **реальность** — существующие объекты и изделия важнее деклараций;
- **проектность** — показывается не только продукт, но и задача площадки;
- **доступность диалога** — следующий шаг конкретен и находится там, где решение уже можно принять.

Тон коммуникации: уверенный, деловой, конкретный. Не использовать декоративный пафос, абстрактные суперлативы, fake metrics и псевдотехническую лексику.

## 2. Композиционный принцип

Основная формула страниц:

`offer → proof → scope/result → brief → next step`

Она не означает одинаковый набор секций. Напротив, каждый тип страницы получает свою композицию.

### Главная

1. Контекстный full-bleed hero с прямым предложением.
2. Три коммерческих направления с интегрированным позиционированием.
3. Реальные объекты как доказательство.
4. Короткий brief: что прислать для расчёта.
5. Контакт и финальный CTA.

Отдельные quick links внизу hero, sticky section-nav и повторяющий positioning-блок не используются.

### Инженерное/проектное направление

1. Contextual cover hero.
2. Реальный объект/proof.
3. Максимум две смысловые секции состава работ или задач.
4. Brief.
5. Related routes в виде спокойных text links.
6. Финальный CTA.

### Предметное направление

1. Split hero с isolated media в режиме contain.
2. Типы/семейства изделий.
3. Контекст или галерея применения.
4. Brief.
5. Related routes и финальный CTA.

### Catalog section

1. Split hero: область применения + representative product.
2. Категории.
3. Изготовление под задачу.
4. Контакт.

### Category

1. Продающий hero: что это, для каких объектов, сколько решений.
2. Product grid.
3. Только недублирующая gallery/context.
4. Контрастная custom-order band.
5. Контакт.

### Product

1. Единый product showcase: gallery + summary + цена/условие + CTA above the fold.
2. Открытые характеристики и варианты.
3. Контекстное media, если оно существует.
4. Финальный CTA.

Промежуточный CTA внутри specs не используется.

### Projects

Archive: компактный intro → один featured реальный объект → grid остальных → CTA. Placeholder никогда не featured.

Detail: contextual hero с результатом → роль/состав работ → gallery → related → CTA. При sparse data используется сильная типографическая композиция без fake facts.

### Practical

Company: профиль → реальная работа/доказательство → направления без декоративных номеров → контакт.
Contacts: главный канал → остальные способы → адрес/карта → данные для старта без numbering.
Vacancies: компактный intro → актуальные позиции → practical links.

## 3. Premium color system

### Основные токены

| Token | Значение | Роль |
|---|---|---|
| `--smu-base` | `#F6F3ED` | Основной тёплый фон страницы |
| `--smu-elevated` | `#FFFDF8` | Hero/product/card surface с визуальным подъёмом |
| `--smu-neutral` | `#E9E5DC` | Вторичная полоса, контекст, gallery surface |
| `--smu-dark-olive` | `#20352B` | Инженерный dark field, image overlay, сильный CTA |
| `--smu-graphite` | `#1D2421` | Графитовая поверхность и controls |
| `--smu-text` | `#18201C` | Основной текст |
| `--smu-text-muted` | `#626761` | Вторичный текст и captions |
| `--smu-border` | `#D2CFC6` | Функциональные разделители |
| `--smu-accent` | `#285D47` | Основное действие и активное состояние |
| `--smu-accent-hover` | `#1E4938` | Hover/pressed primary action |

### Правила

- Светлые поверхности тёплые, не мятные и не холодно-серые.
- Одновременно на экране используются не более base, elevated, одного neutral и одного dark/accent.
- Dark olive служит либо полем hero/CTA, либо контрастным разделителем; он не заполняет подряд весь каталог.
- Green accent используется для действия и небольшого semantic marker, не как декоративная заливка каждой карточки.
- Border применяется только для структуры, выбора или интерактивности.
- Текст на светлой поверхности — `#18201C`; muted не используется для ключевой информации.
- На media-тексте обеспечивается контраст через `#20352B` overlay, а не через случайный blur.

Удаляются/заменяются legacy mint (`#F3F5F1`, `#E7ECE7` и близкие), локальные blue-green темы и случайные near-black значения, если они не являются частью media.

## 4. Типографика

Единственная public-family: **Manrope**, system fallback `Arial, sans-serif`. Raleway удаляется из загрузки и визуального голоса.

### Display / H1

- desktop: `clamp(3.25rem, 5.6vw, 6.75rem)` в зависимости от шаблона;
- mobile: `clamp(2.35rem, 12vw, 4rem)`;
- weight: 500–600;
- line-height: 0.96–1.04;
- letter-spacing: от `-0.045em` до `-0.025em`;
- строка ограничивается смысловым переносом, не декоративной узкой колонкой.

### H2

- `clamp(2.1rem, 4vw, 4.5rem)`;
- weight 500–600;
- line-height 1.00–1.08;
- letter-spacing `-0.035em`.

### H3 / card title

- `clamp(1.35rem, 2vw, 2.25rem)`;
- weight 550–600;
- line-height 1.08–1.18.

### Body lead

- `clamp(1.05rem, 1.35vw, 1.4rem)`;
- line-height 1.48–1.58;
- max line length 54–66ch.

### Body

- 1rem–1.1rem;
- weight 400–500;
- line-height 1.55–1.7;
- max line length 68ch.

### Caption / eyebrow

- 0.75rem–0.82rem;
- weight 650–700;
- uppercase допустим только для короткой рубрики;
- letter-spacing `0.07em–0.11em`, не шире;
- caption не несёт критически важную информацию в одиночку.

### CTA

- 0.88rem–0.98rem;
- weight 650–700;
- sentence case;
- без стрелки внутри label;
- min target 44 × 44 px.

## 5. Фотографическая режиссура

Новые изображения не создаются. Система перераспределяет роли существующих media.

### Hero photo

- Главная, металл, строительство, благоустройство и project detail: реальный объект/процесс, `object-fit: cover`.
- Crop сохраняет конструктивный центр, человека/узел или читаемый край объекта; ключевой объект не должен быть случайно срезан текстовой колонкой.
- Текст размещается на участке с устойчивым контрастом, overlay градуируется по стороне текста.

### Product/isolated media

- Каталог, предметная категория, навесы/топиарии и product gallery: `object-fit: contain` на `--smu-elevated` или спокойной neutral surface.
- У предмета остаётся безопасное поле 5–9%.
- Не растягивать isolated PNG/JPEG на весь viewport через cover.

### Context media

- Показывает результат на объекте и используется после выбора продукта или сразу после offer услуги.
- `cover`, aspect-ratio 4:3, 3:2 или editorial 16:10 в зависимости от секции.
- Не повторяет hero, если выполняет ту же функцию.

### Detail media

- Узлы, покрытие, монтаж и фактура допускают более плотный crop.
- Detail не заменяет общий вид: сначала посетитель понимает целый объект, затем видит деталь.

### Placeholder/sparse

- Placeholder не используется как featured proof.
- При отсутствии media — типографический hero и усиленная summary-композиция без искусственного image box.

## 6. Motion system

Motion подчёркивает появление объекта и смену смыслового уровня. Он не скрывает контент и не превращает прокрутку в презентацию.

### Hero entrance

- eyebrow: 0 ms;
- H1: 60 ms;
- lead: 120 ms;
- actions: 180 ms;
- duration: 420–520 ms;
- transform: `translateY(12–16px)` → `0`;
- opacity: 0 → 1 только при progressive enhancement; без JS всё видно.

### Image reveal

- duration: до 560 ms;
- opacity + `scale(1.012)` или clip/mask без blur;
- один раз при появлении;
- никакого parallax.

### Section transition

- duration: 420–480 ms;
- translate 12px максимум;
- stagger внутри группы: 40–70 ms, не более четырёх элементов.

### Controls

- hover/press: 160–220 ms;
- изменение background/color/border; translate не более 2px;
- gallery next/prev может сохранять функциональные стрелки.

### Video

- poster является исходным состоянием;
- desktop video загружается после первого paint при отсутствии `prefers-reduced-motion: reduce` и `saveData`;
- mobile использует poster и не загружает отдельный video asset;
- play/pause доступен с клавиатуры и имеет обновляемый label;
- при reduced motion все reveal-transition отключены, контент остаётся видимым.

## 7. Унифицированные компоненты

### Header

- Один и тот же desktop/mobile контракт на всех public V2 страницах.
- Logo, основные направления, проекты, company menu и один расчётный CTA.
- Telegram без декоративной стрелки; chevron остаётся только у раскрывающегося меню.
- На media header использует прозрачную/тёмную тему, после hero — elevated surface с читаемым border.

### Buttons

- Primary: accent fill, светлый текст, без glyph.
- Secondary: transparent/elevated с функциональной рамкой.
- Text action: текст + underline/border-bottom только если это действительно третичный маршрут.
- Gallery previous/next сохраняют стрелки как функциональную иконку.

### Surfaces

- Base — основная лента.
- Elevated — product summary, важный content panel, form.
- Neutral — gallery/context strip.
- Dark olive — hero/strong CTA.
- Не вкладывать больше двух рамочных surfaces друг в друга.

### Cards

- Product card: media → category/name → price/condition; вся карточка кликабельна.
- Project card: large contextual image → result/name → location/type, без лишней рамки.
- Competence item: типографический список или разделённая строка, не обязательная карточка.
- Contact method: прямой link/value, не псевдо-dashboard.

### CTA sections

- Один тезис, один основной CTA, опциональный прямой контакт.
- CTA следует после proof/brief.
- Не повторять один label в соседних секциях.

## 8. Плотность и сетка

- Основной container: существующий responsive container, визуальный максимум около 1600 px на 1920.
- Desktop split: 5/7 или 6/6 в зависимости от роли media.
- Section vertical rhythm: 72–120 px desktop, 52–76 px tablet, 40–60 px mobile.
- После hero первая доказательная секция начинается без пустого «буферного экрана».
- Не более двух больших текстовых экранов подряд.
- Cards gap: 16–28 px; padding внутри функциональной карточки 20–36 px.
- На 320 px одна колонка; горизонтальный scroll допускается только в gallery thumbnails с доступными controls.

## 9. Accessibility и отказоустойчивость

- Все действия доступны с клавиатуры и имеют видимый `:focus-visible`.
- Motion и video уважают `prefers-reduced-motion`.
- Контент не получает `display: none` до выполнения JS, кроме явных overlays/dialogs.
- Изображения сохраняют существующие содержательные alt.
- Кнопки без стрелок остаются понятны по label; иконка не является единственным названием действия.
- Touch targets не менее 44 px.
- Контраст основного текста и CTA проверяется на всех production surfaces.
- При отсутствии media/product data шаблон не ломается и не создаёт ложное доказательство.

## 10. Freeze criteria

Визуальная система готова к заморозке, если:

1. первый экран каждой обязательной группы однозначно сообщает предложение;
2. CTA, surfaces, typography и palette едины;
3. декоративные номера и CTA-arrows отсутствуют;
4. category, product и projects имеют разные коммерческие композиции;
5. desktop, tablet и mobile сохраняют иерархию без overflow;
6. reduced-motion и no-video состояния полноценны;
7. check/build и visual QA проходят;
8. protected data/admin/contracts не изменены.

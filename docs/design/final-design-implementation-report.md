# СМУ-1 — отчёт о финальном дизайн-проходе и product presentation system

Дата итогового объединённого QA: 18 июля 2026 года.

Канонические источники текущего результата:

1. прямое задание **Final Premium Design + Standard/Premium Product System**;
2. `docs/design/final-art-direction-master-plan.md`;
3. `docs/design/product-presentation-model.md`;
4. `docs/design/cms-product-presentation-switch.md`;
5. `docs/design/FINAL_CURRENT_TASK_REQUIREMENTS_MATRIX.md` и `FINAL_CURRENT_TASK_ACCEPTANCE.md`.

`final-art-direction-spec.md` сохраняется как ранняя визуальная спецификация; его устаревшие palette и no-CMS ограничения заменены актуализирующим дополнением.

## 1. Результат

Публичный V2-сайт собран как единая система **Engineering Clarity** с палитрой **Engineering Blue**. Визуальный образ — строгая инженерно-строительная B2B-компания: реальные изделия и завершённые/объектные решения, крупная типографика, холодная нейтральная база, точечный royal blue и доказательная структура страниц.

Завершены:

- сильные, различимые first-screen для ключевых page families;
- единая responsive typography без текстовых башен и horizontal overflow;
- controlled hero scroll handoff без scroll-jacking;
- media-ready reveal с decode/load, доступным fallback и late recovery;
- desktop/mobile header и local sticky navigation;
- единый final CTA + footer, включая собранную legal/privacy/cookies строку;
- целиком кликабельные project/product cards с keyboard focus;
- два реальных product presentation variants: Standard и Premium;
- узкий CMS/admin presentation switch с schema, validation и export/import contract;
- полный static, build, browser, responsive, motion и visual QA.

## 2. Исследование и art direction

Перед реализацией были повторно сверены `docs/design-lab/**`, прежние audits, benchmark, visual direction, screenshots и текущая V2-архитектура. Главным принципиальным ориентиром осталась Skanska: крупный уверенный first screen, фотография как доказательство, бело-тёмно-синий ритм и мягкий уход hero под следующий блок.

Дополнительные принципы:

- Arup — короткие reveal header/navigation/text и digital polish;
- MVRDV — взаимодействие тезиса и конкретного изображения; официальный project index повторно проверен, но неподтверждённые transition timings не копировались;
- Turner Construction — строгий завершающий CTA и плотный корпоративный footer;
- Snøhetta — масштаб заголовков и дисциплина типографики без превращения сайта в art project.

Mask/cutout typography, scroll-jacking, декоративные AI-patterns и вымышленные доказательства не использовались.

## 3. Реализованная дизайн-система

### 3.1. Цвет и типографика

Фактические production colors:

| Роль | Значение |
| --- | --- |
| Near-black / ink | `#101720` |
| Contrast / navy-graphite | `#171F29` |
| Royal blue | `#1E4FA3` |
| Royal blue hover | `#153D82` |
| Light blue | `#DFE9F8` |
| Cold white | `#F4F6F8` |
| White | `#FFFFFF` |
| Steel | `#E8EDF2` |
| Border | `#CBD3DC` |
| Muted text | `#5B6570` |

Legacy-named variables остаются внутри исторического V2 cascade, но olive/mint/beige не управляют production action/surface system. Определённый `--hv2-green-accent` не используется в production selectors.

Manrope загружается неблокирующе с системным fallback. H1/H2 используют fluid clamp, контролируемый max-width и нормальный default wrapping. Для длинных project/vacancy H1 локально применён `overflow-wrap:anywhere` как последний reflow-предохранитель. Обязательные русские длинные слова и 200% reflow вошли в responsive acceptance.

### 3.2. Hero и first-screen

- Home использует объектное фото металлического каркаса, крупный offer, два CTA и управляемое desktop video; mobile/reduced motion остаются на poster.
- Металлоконструкции, благоустройство и строительство получили immersive photographic heroes с finished/object result first.
- Навесы и топиарии используют цельную split-composition на desktop и последовательный text → CTA → media stack на mobile.
- Custom order показывает коммерческий вход «фото / эскиз / чертёж / техническое задание» без создания отдельного направления и без показа внутреннего производства.
- Catalog, category, Standard/Premium product, projects, company, contacts и vacancies используют отдельные hero families, соответствующие объёму задачи.

Controlled scroll handoff работает только на подходящих desktop heroes. Copy движется с ограниченной амплитудой, теряет opacity внутри hero clipping и не становится sticky. Mobile и `prefers-reduced-motion: reduce` получают статическое состояние.

### 3.3. Image-ready reveal

`src/utils/v2ImageReady.ts` реализует состояния `pending | ready | fallback`:

- критичные media используют eager/fetchpriority и стабильные dimensions/aspect ratio;
- readiness требует реального `load` и попытки `decode()`;
- timeout 6000 ms и `error` показывают непустой fallback с `role="status"` и `aria-live`;
- content никогда не остаётся hidden бесконечно;
- late load после fallback восстанавливает image и переводит state в `ready`;
- reduced motion не скрывает awaiting media;
- lazy images ниже first screen не стали массово eager.

Focused browser QA отдельно проверяет normal/delayed, timeout fallback, late recovery и invalid-image error fallback.

### 3.4. Header и sticky navigation

Header сохраняет overlay/solid/hide/reveal states, desktop dropdown, plus/minus, active state, CTA и mobile focus contract. Проверены focus trap, Escape, возврат focus и восстановление исходного scroll position.

`V2SectionNav.astro`:

- выводит только реальные anchors и скрывается при менее чем двух целях;
- учитывает фактическую высоту visible header и local nav;
- удерживает clicked/hash target единственным `aria-current="location"` bounded lock до 1800 ms;
- после settle 120 ms возвращается к geometry tracking;
- поддерживает first/last section, page end, deep link и horizontal mobile scroll;
- отсутствует на contacts, vacancies и legal pages.

### 3.5. Cards, galleries, final CTA и footer

Project cards кликабельны целиком, имеют visible focus и не создают nested interactive conflicts с gallery controls. Product/category cards используют устойчивые minmax grids и полноценный hover/focus state без декоративных стрелок.

Product/project galleries сохраняют previous/next, thumbnails, keyboard, swipe, fullscreen, focus return и scroll lock. Isolated product media рендерится через `contain`, contextual/object media — через `cover`.

Final CTA и footer образуют одну dark sequence без светлого разрыва и пустого подвала. Footer сохраняет крупный logo, direct contacts, собранные navigation groups и legal/privacy/cookies на одном уровне; mobile accordion не дублирует одновременно desktop navigation. Финальный прогон подтвердил 22/22 footer assertions.

## 4. Standard / Premium product system

### 4.1. Selector и совместимость URL

`CatalogProductV2.astro` нормализует variant:

```ts
const presentationType = product.presentationType === 'premium' ? 'premium' : 'standard';
```

- Premium → `CatalogPremiumProductV2.astro`;
- Standard, missing или безопасный fallback → `CatalogStandardProductV2.astro`;
- route, slug, canonical, breadcrumbs, related selection и media paths не меняются.

### 4.2. Standard product

Standard остаётся компактным коммерческим сценарием: media/gallery, title, lead, price mode, key points, specifications/materials/colors, изменяемые параметры, delivery при наличии, CTA и related products. Premium narrative и `data-premium-product-section` отсутствуют.

Representative case: `/ulichnaya-mebel/lavochki-i-skameyki/skamya-smu1-bazovaya/`. Desktop/mobile screenshots подтверждают компактный split first screen и отсутствие искусственного инженерного пафоса.

### 4.3. Premium product и Portal

Premium отличается не badge/color, а архитектурой страницы: editorial hero, решение, сценарии применения, richer spatial gallery, адаптация, варианты исполнения, подтверждённая technical system, delivery/project context, related solutions и усиленный CTA.

Representative case: `/ulichnaya-mebel/kacheli/kachel-portal/`. Portal P0 исправлен; свежие desktop/mobile screenshots повторно приняты. Hero copy/media, gallery, application, adaptation, variants и CTA входят в browser/static contract.

### 4.4. Classification и listing

Все 68 records имеют явное значение:

- 59 Standard;
- 9 Premium.

Premium назначен только девяти подтверждённым пространственным решениям из `product-presentation-model.md`. Listing card получает нейтральную метку «Решение для объекта» только для premium; standard не маркируется и не понижается в visual rank.

## 5. CMS/admin presentation switch

### 5.1. Schema и editor controls

`src/content-schemas.mjs` содержит:

```ts
presentationType: z.enum(['standard', 'premium']).default('standard')
```

Optional `solutionKicker`, `applicationItems` и `executionVariants` не ломают legacy records. Visual editor показывает human-readable select «Стандартный товар» / «Премиум / инженерное решение» и условные premium fields; technical editor использует тот же enum. Новый товар создаётся как Standard. Скрытие premium fields при Standard не удаляет их из draft.

### 5.2. Server validation

Product POST/PUT проходит `validateProductContentForWrite()` до записи:

- legacy/missing type материализуется в `standard`;
- invalid type возвращает HTTP 400 и `PRODUCT_SCHEMA_VALIDATION_FAILED`;
- validation issues возвращаются редактору;
- invalid request не изменяет record.

### 5.3. Export/import

`catalog_export` v1 сохраняет прежние raw arrays и аддитивно включает `productImport` v1. Standalone `products_import` и nested payload поддерживаются. Presentation fields и поддерживаемые product fields проходят projection/reconstruction round-trip. Старый `catalog_export` без nested payload отклоняется явно, чтобы исключить молчаливую потерю данных.

### 5.4. Browser-admin доказательство

`npm run test:admin-import` — 22/22: schema/default, isolated create/update, premium fields, invalid no-write и export envelope/reconstruction.

`npm run qa:admin-browser` — 29/29 в одной Chromium instance и внешней D:-sandbox. Реальный visual editor прошёл Standard → Premium, conditional premium fields, save/reload, UI catalog export, UI import Standard с сохранением premium fields, UI import скачанного Premium с полным reload round-trip, invalid UI no-write и invalid API 400/no-write. Runtime console errors — 0.

Один publish POST был намеренно заблокирован локальным proxy и не forwarded. Production content hash, git HEAD и git index не изменились; sandbox восстановлен, внешняя временная директория удалена.

## 6. Page-specific completion

- **Home:** сильный object hero, controlled scroll, локальная navigation, доказательные projects и единый final screen.
- **Custom order:** исправлены grid/reflow, показаны четыре типа исходных данных, направления, изменяемые параметры, реальные examples и direct CTA.
- **Metalworks:** sections уплотнены, object proof и sticky navigation помещаются в viewport, related grid исправлен.
- **Landscaping:** устранены text towers, собраны object/scope grids и project proof.
- **Construction:** finished result first, ограниченные section heights, корректный related block.
- **Canopies / Topiary:** split first-screen завершён, media behavior и related cards исправлены, pale blue ограничен.
- **Projects:** archive intro уплотнён, whole-card links доступны, detail media/facts/gallery/fullscreen не уничтожают остальную страницу.
- **Company:** split hero, плотные proof modules, два типа объектов и устойчивый geography grid.
- **Contacts / Vacancies:** compact intro, быстрый доступ к phone/mail/Telegram/map и active vacancy; sticky nav отсутствует.
- **Catalog/categories:** filled/sparse/no-media states, contain/cover distinction, whole-card links и responsive hierarchy.
- **Standard/Premium products:** два объективно разных template contracts подтверждены на representative cases.

## 7. Основные файлы реализации

- `src/styles/v2/final-art-direction-v2.css` — production palette, typography, hero, nav, product variants, responsive/reduced-motion и final screen layer;
- `src/layouts/PublicV2Layout.astro` — fixed Engineering theme, final stylesheet in `<head>`, font strategy и hero-scroll runtime;
- `src/utils/v2ImageReady.ts` — media readiness/fallback/recovery;
- `src/components/v2/V2SectionNav.astro` — sticky anchor state;
- `src/components/v2/CatalogProductV2.astro`, `CatalogStandardProductV2.astro`, `CatalogPremiumProductV2.astro`, `V2ProductCard.astro` — presentation system;
- `src/content-schemas.mjs` и `src/content/products/*.json` — enum/default и 59/9 classification;
- `src/pages/admin/visual.astro`, `src/pages/admin/technical.astro` — editor controls/import projection;
- `tools/admin-api/product-presentation.mjs`, `server.mjs`, `server-routes.test.mjs` — validation, export envelope и isolated tests;
- `tools/admin-api/admin-browser-roundtrip.mjs` — реальный visual-admin save/reload/export/import/no-write и safety audit;
- direction, custom-order, projects и practical V2 components — page-specific fixes;
- `tools/migration/final-design-qa.mjs` — source/dist route/link/media/product/admin contract;
- `tools/migration/browser-final-design-qa.mjs` — focused image/product/hero/sticky checks;
- `tools/migration/browser-visual-polish-qa.mjs` — canonical/responsive/motion/footer/functional visual acceptance.

Финальный stylesheet предзагружается и подключается последним внутри `<head>`. Он остаётся отдельным controlled override layer поверх исторических V2 component styles; полный cascade refactor сознательно не проводился после успешной regression-проверки.

## 8. QA

### 8.1. Check, build, static и admin

| Проверка | Итог |
| --- | --- |
| `npm run check` | 186 files; 0 errors; 0 warnings; 33 existing hints |
| `npm run build` | success; 227 pages |
| source contract QA | 27/27 |
| final static QA | 38/38 |
| Canonical routes | 107 |
| Internal links/anchors | 9 193; issues 0 |
| Media references/elements | 2 285; issues 0 |
| Product rendering | 59 Standard / 9 Premium; issues 0 |
| `npm run test:admin-import` | 22/22 |
| `npm run qa:admin-browser` | 29/29; runtime console 0; production/git state unchanged |
| `git diff --check` | pass; только line-ending notices |

Static QA также проверяет canonical, robots, sitemap, compatibility aliases/404, missing/invalid presentation values, admin controls, product markers, premium sections и listing indicator.

### 8.2. Admin browser round-trip

Результат: 29/29, одна Chromium instance, runtime console errors 0.

Покрыты:

- login и загрузка visual product editor;
- initial Standard state;
- Standard → Premium и conditional fields;
- save/reload premium values;
- UI download `catalog_export`;
- UI import Standard с сохранением скрытых premium data;
- UI import скачанного Premium и reload полного round-trip state;
- invalid UI и invalid API no-write;
- точная write sequence 200/200/200/400;
- local interception одного publish POST без forwarding;
- неизменность production content, HEAD и index;
- восстановление sandbox и удаление внешней D:-temp.

### 8.3. Focused public browser QA

Результат: 17/17, runtime errors 0, local network errors 0.

Покрыты:

- delayed media reveal;
- timeout fallback;
- late recovery;
- invalid image error fallback;
- Standard/Premium desktop/mobile rendering;
- listing indicator;
- Home и Premium hero handoff;
- sticky navigation desktop/mobile;
- representative responsive geometry.

### 8.4. Полный visual-polish QA

Финальный полный run: **pass**.

| Проверка | Результат |
| --- | ---: |
| Canonical direct loads | 107 |
| Real click navigations | 24 |
| Responsive assertions | 270 = 30 routes × 9 modes |
| Motion assertions | 124 |
| Footer assertions | 22 |
| Functional scenarios | 7 |
| Screenshots | 31 |
| Screenshot bytes | 17 392 854 |
| Runtime errors | 0 |
| Local network errors | 0 |
| Failures | 0 |

Responsive modes: 1920×1080, 1706×958, 1440×900, 1280×800, 1024×768, 768×1024, 390×844, 320×700 и 200% reflow.

Functional scenarios включают desktop/mobile home video contract, keyboard dropdown, mobile menu focus/lock/Escape, product gallery navigation/fullscreen/swipe, project gallery fullscreen и contacts map. Fresh screenshot set содержит Home/footer, пять направлений, catalog/category variants, Standard bench, Premium Portal, zero-media product, projects/detail, custom order, company, contacts и vacancies. Portal desktop/mobile и footer legal были повторно просмотрены после исправлений и приняты.

## 9. Сохранённые ограничения и защищённый scope

Не изменены:

- публичные URL, slugs, canonical route ownership и compatibility aliases;
- исходные media files и media paths;
- contact data, legal text, project facts и фактические условия вакансий;
- deployment configuration, GitHub Actions и remote;
- формы и несвязанная business logic.

Content/admin изменения ограничены presentation switch: явный enum в 68 product records, три optional premium fields у подтверждённых решений, editor controls, validation и export/import projection. Fake content, stock media и изображения внутреннего производства не добавлялись.

## 10. Честные ограничения

1. Физическая device-lab проверка iOS Safari/Android Chrome не выполнялась; использован один управляемый Chromium с точными viewport/mobile/reduced-motion режимами.
2. Существующие тяжёлые JPEG/video originals не конвертировались в WebP/AVIF и не получали новый media pipeline, поскольку source media менять запрещено.
3. Карта и Яндекс.Метрика зависят от внешней сети; локальные media/routes при финальном прогоне ошибок не дали.
4. Финальный CSS остаётся отдельным последним override layer. Это подтверждённый regression-safe компромисс, а не полный рефакторинг исторических style files.

## 11. Итог

Публичная визуальная система, Standard/Premium product rendering, Portal representative case, CMS presentation schema/API/export/browser round-trip, responsive/motion/footer behavior и canonical route integrity реализованы и проверены на одном production build. Полный visual run и admin browser QA завершены без runtime, local-network и assertion failures. Push, deployment и изменение публичного сайта в рамках этой работы не выполнялись.

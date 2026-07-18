# Production V2 visual-polish plan

## Baseline

- Ветка работ: `v2-visual-polish`, исходная точка `de282ed3da8419d1bcf6cf0d5f5d5b912446b635`.
- Зафиксировано 111 render routes из `v2-production-route-audit.csv`: 107 canonical (1 home, 7 directions/sections, 20 categories, 68 products, 5 project routes и 6 practical routes), 3 compatibility aliases и `404.html`.
- Shared V2 слой: 77 файлов в `src/components/v2` и 11 файлов в `src/styles/v2`. Production shell — `PublicV2Layout` + один `HomeV2Header`/`HomeV2Footer`; legacy Header/Footer через `BaseLayout` в V2 render path не входят.
- Reference screenshots: `docs/migration/screenshots/**`; design-lab screenshots используются только как локальное сравнение.

## Root causes

1. Footer не подключён дважды. `HomeV2` передаёт `catalogV2`, поэтому shared Footer намеренно рендерит desktop nav и mobile `<details>`. Правила переключения ошибочно находятся только под ancestor `.catalog-v2`; на главной ancestor отсутствует, и browser-default `<details>` видны вместе с колонками. Исправление должно принадлежать самому Footer variant.
2. ClientRouter/ViewTransitions отсутствуют. `V2ProductGallery` и `V2ProjectGallery` безусловно вызывают `thumb.scrollIntoView()` внутри initial `setCurrent(0)`. Вложенный thumbnail далеко ниже fold заставляет браузер прокрутить весь document. Исправление: initial state без scroll; при пользовательской смене кадра — только локальный horizontal `scrollLeft/scrollTo` thumbs-container. Native hash и Back/Forward не переопределяются.
3. Motion раздроблен между home-only `[data-reveal]` и catalog `[data-v2-reveal]`. Hero обычно помечен одним крупным wrapper, visible elements получают один момент появления, а отдельные специализированные hero вообще не имеют последовательности. Нужны общие durations/easing, явные hero delays, fail-open timeout и assertions final visibility.
4. Header имеет рабочие mobile focus trap/lock/Escape/return, но `CatalogV2Layout` hardcode-ит light mode. Direction hero не предоставляет sentinel, поэтому overlay-to-solid lifecycle невозможен.

## Page-entry architecture

1. **Immersive direction** — metalworks, landscaping, construction, canopies, topiary: media background 82–100svh, integrated breadcrumbs, overlay Header, один primary и при необходимости secondary CTA. Реальные текущие media, eager/high priority, reserved dimensions.
2. **Catalog/category** — section и category split composition на neutral/dark outer surface; isolated renders в elevated panel с `contain`, contextual photos с `cover`; no-media превращается в компактный typographic entry без пустой рамки.
3. **Product** — viewport-aware two-column composition; gallery stage через `svh/clamp`, `contain`, одна горизонтальная строка thumbnails, компактный zero-media state; summary/price/CTA остаются частью первого экрана.
4. **Editorial/practical** — projects, company, contacts, vacancies, legal, custom order и details: solid Header, компактный editorial intro, без механического fullscreen hero.

## Color and surface map

| Текущее | Использование | Масштаб | Замена |
|---|---|---:|---|
| `--hv2-background: #f3f5f1` | page/category/company base | page | warm neutral base `#f6f3ed` |
| `--hv2-surface: #fbfaf6` | cards/header/panels | component | warm white `#fffdf8` |
| `--hv2-secondary-surface: #e7ece7` | category hero, contacts/map, practical/project sections, media stages | section/page | warm neutral `#e9e5dc`; elevated media uses warm white |
| `--hv2-contrast: #20352b` и близкие direct olives | Footer/contact/dark sections | section | one dark olive token |
| `--hv2-action: #285d47` и `#315a45` | CTA, links, active states | control | one accent token + one hover token |
| direct graphite `#172126/#101713/...` | galleries/dark proof blocks | component | shared graphite tokens |

Добавляются semantic aliases: base, elevated, warm-neutral, dark-olive, graphite, text-primary, text-secondary, border и accent. Mint не остаётся фоном hero, крупной секции или страницы.

## Motion system

- Fast interaction 180ms, standard state 300ms, reveal 520–560ms, единая easing curve.
- Page entrance: breadcrumbs/eyebrow → H1 → description → CTA → media, короткие delays до 240ms.
- Section reveal: intro, media, cards/list с ограниченным stagger; transform/opacity only, без влияния на layout.
- Content остаётся visible до подтверждённой JS-enhancement; timeout снимает pending. `prefers-reduced-motion` сразу показывает final state и отключает smooth scroll/transitions.

## Change surface

Затрагиваются V2 tokens/shell, Footer responsive variant, gallery scripts, shared catalog/category/product renderers, пять direction entries и их layout/header plumbing, а также palette/motion/spacing overrides practical/projects/custom-order/not-found.

Не переделываются records, schemas, slugs, route adapters, admin/import-export, media, legal copy, project-card architecture, contacts composition/map, vacancy information и home media/video selection.

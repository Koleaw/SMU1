# Матрица требований текущей задачи

Дата финальной сверки: 2026-07-18

Ветка: `v2-visual-polish`
Baseline до задачи: `44148a74f1562613a30ad4ad823315b16cdda5ee` (`design: final art direction upgrade`)

Статус `DONE` ниже установлен только после сверки реализации с кодом/данными и соответствующим static, browser, screenshot либо Git-доказательством. Итог: **54 DONE, 0 PARTIAL, 0 NOT STARTED, 0 BLOCKED**.

| ID | Требование | Статус | Доказательство | Что осталось | Как проверено |
|---|---|---|---|---|---|
| D1 | Единый премиальный B2B-образ сайта | DONE | `src/styles/v2/final-art-direction-v2.css`; V2 components; 31 proof PNG | — | Полный visual QA 107/107; независимый просмотр 31/31 |
| D2 | Последовательные роли Art/UX/Product/Frontend/CMS/QA | DONE | master plan → audit → product model → CMS switch → implementation → acceptance | — | Doc/code cross-check и отдельный acceptance-проход |
| D3.1 | Изучены repo, Design Lab, audits, screenshots и research | DONE | `docs/design-lab/**`; `docs/design/final-design-audit-v3.md`; сохранённые benchmark/capture материалы | — | Документальная сверка с фактическими компонентами |
| D3.2 | Принципы Skanska отражены в системе | DONE | master plan; immersive/split heroes; hero scroll handoff | — | Desktop/mobile screenshots и 124 motion assertions |
| D3.3 | Arup, MVRDV, Turner, Snøhetta применены без копирования | DONE | master plan + addendum `final-art-direction-spec.md`; header reveal, text/image composition, footer/type mapping | — | Document/source mapping и визуальная приёмка |
| D4.1 | `final-art-direction-master-plan.md` актуален | DONE | фактические токены, components, contracts, QA table | — | Повторная сверка с CSS/JS/tests |
| D4.2 | `final-design-audit-v3.md` актуален | DONE | baseline явно отделён от closure appendix | — | Finding-by-finding closure audit |
| D4.3 | `product-presentation-model.md` актуален | DONE | 59/9 split, template/listing/route evidence | — | Data/static/browser comparison |
| D4.4 | `cms-product-presentation-switch.md` актуален | DONE | schema/write/import/export/UI round-trip описаны фактически | — | 22/22 API + 29/29 admin browser |
| D4.5 | `final-design-implementation-report.md` соответствует repo | DONE | итоговый component/page/data/QA mapping | — | Независимая doc consistency сверка |
| D5.1 | STANDARD PRODUCT — отдельный компактный сценарий | DONE | `CatalogStandardProductV2.astro`; standard DOM markers | — | `skamya-smu1-bazovaya` desktop/mobile screenshot + focused QA |
| D5.2 | PREMIUM PRODUCT — richer engineering scenario | DONE | `CatalogPremiumProductV2.astro`; premium-only hero/narrative/index/gallery/CTA | — | Portal desktop/mobile screenshot + focused QA |
| D5.3 | Portal — representative premium case | DONE | `kachel-portal.json`; `/ulichnaya-mebel/kacheli/kachel-portal/` | — | Hero geometry 1440/390, gallery/motion/CTA, fresh PNG |
| D5.4 | Обычная скамья — representative standard case | DONE | `skamya-smu1-bazovaya.json`; compact standard template | — | Desktop/mobile visual acceptance; premium sections absent |
| D5.5 | Premium различим в listing без ложной standard-метки | DONE | `V2ProductCard.astro`: «Решение для объекта» только premium | — | Static contract + browser listing assertion |
| D6.1 | Enum и безопасный default `presentationType` | DONE | `content-schemas.mjs`; `product-presentation.mjs` | — | legacy/default/valid/invalid tests, 22/22 |
| D6.2 | Человеческий admin control для новых и старых товаров | DONE | `visual.astro`, `technical.astro`; default standard | — | Реальный editor load/switch/save/reload, 29/29 |
| D6.3 | Premium-поля не теряются при переключении | DONE | optional schema fields и conditional editor block | — | UI premium→standard import→premium restore/reload |
| D6.4 | Export/import сохраняет presentation layer | DONE | additive `catalog_export.productImport`; `products_import` v1 | — | API suite 22/22 и UI download/import round-trip 29/29 |
| D6.5 | Invalid enum отклоняется без повреждения record | DONE | HTTP 400 `PRODUCT_SCHEMA_VALIDATION_FAILED` до write | — | UI disabled/no-write + API hash/no-write |
| D6.6 | Frontend автоматически выбирает variant с legacy fallback | DONE | `CatalogProductV2.astro`; missing field → standard | — | Static 59/9 + standard/premium focused browser QA |
| D7 | White/near-black/navy/royal/light-blue palette | DONE | фактические tokens `#101720/#171F29/#1E4FA3/#153D82/#DFE9F8` | — | CSS token audit + 31 screenshots |
| D8.1 | Сильная responsive typography | DONE | clamp/max-width/line-height rules в final/practical/projects CSS | — | 270 responsive assertions на 9 viewport modes |
| D8.2 | Нет башен, clipping и поломки длинных русских слов | DONE | локальные project/vacancy safeguards; overflow diagnostics | — | 320/390/1024/1280/1440/1920 + 200% reflow, 0 failures |
| D9 | Завершённый first-screen обязательных страниц | DONE | разные hero modes для home/directions/catalog/products/practical/projects | — | 31 screenshot + first-screen hero-copy geometry guard |
| D10 | Hero scroll без scroll-jacking, с reduced motion | DONE | `PublicV2Layout.astro`; `[data-v2-hero-scroll]`; finite transforms | — | 124 normal/reduced assertions; home и Portal focused tests |
| D11.1 | Critical media preload/fetchpriority и стабильные размеры | DONE | hero/product components; preload in `PublicV2Layout.astro`; width/height/aspect-ratio | — | Static DOM/media audit: 2 285 media, 0 failures |
| D11.2 | Reveal ждёт load/decode и fail-open непустым fallback | DONE | `src/utils/v2ImageReady.ts`: pending/ready/fallback, 6000 ms, late recovery | — | delayed/timeout/error/final browser scenarios 4/4 |
| D12.1 | Header overlay/solid/mobile/a11y сохранён | DONE | `HomeV2Header.astro`; logo/menu/dropdown/focus logic | — | keyboard dropdown; mobile focus trap/Escape/return-focus |
| D12.2 | Sticky nav: реальные anchors, offsets, стабильный current | DONE | `V2SectionNav.astro`; 1800 ms lock + geometry sync | — | desktop/mobile/hash/history/browser assertions |
| D12.3 | Sticky nav отсутствует на contacts/vacancies/legal | DONE | route composition и DOM contract | — | 107-route direct DOM audit |
| D13 | Final CTA/footer — единый доступный финальный экран | DONE | `HomeV2Footer.astro`; mobile legal grid | — | 22 footer assertions; fresh 390 screenshot; link/duplicate audit |
| D14 | Related/adjacent cards не ломают grid; полноценный hover | DONE | direction/product/project related components и royal-blue hover CSS | — | 270 geometry checks + 31-frame visual acceptance |
| D15 | Object cards кликабельны целиком и доступны | DONE | `V2ProjectCard.astro`; stretched link/focus; gallery controls separated | — | click/keyboard/functional browser assertions |
| D16.HOME | Главная | DONE | `HomeV2.astro`; object-frame hero, local rhythm, CTA/footer | — | desktop/mobile/desktop-footer/mobile-footer screenshots |
| D16.CUSTOM | Изготовление на заказ | DONE | `CustomOrderV2Page.astro`; inputs/directions/options/examples | — | desktop/mobile screenshots; no internal-production link/media |
| D16.METAL | Металлоконструкции | DONE | `MetalworksV2Page.astro`; compact scope/proof/sticky/related | — | desktop/mobile screenshots + route diagnostics |
| D16.LAND | Благоустройство | DONE | `LandscapingV2Page.astro`; objects/scope/projects proof | — | desktop/mobile screenshots + overflow audit |
| D16.CONSTR | Строительство и ремонты | DONE | `ConstructionV2Page.astro`; finished-result first | — | desktop screenshot + responsive/motion audit |
| D16.CANOPY | Навесы и козырьки | DONE | `CanopiesV2Page.astro`; split media behavior | — | screenshot + responsive/motion/related audit |
| D16.TOPIARY | Топиарии | DONE | `TopiaryV2Page.astro`; repaired grids, restrained light blue | — | screenshot + responsive diagnostics |
| D16.PROJECTS | Архив и detail проектов | DONE | `V2ProjectArchive/Detail/Card/Gallery.astro` | — | archive/detail desktop/mobile + fullscreen/keyboard QA |
| D16.COMPANY | Компания | DONE | `V2CompanyPage.astro`; compact proof/geography/contact | — | desktop screenshot + responsive audit |
| D16.CONTACTS | Контакты | DONE | compact page, map, tel/mailto/Telegram | — | screenshot, map functional assertion, link audit |
| D16.VACANCIES | Вакансии | DONE | archive/detail; 320-safe long Russian H1 | — | desktop proof + 320/reflow diagnostics; facts unchanged |
| D16.CATALOG | Sections/categories/product-state variants | DONE | `CatalogCategoryV2.astro`; contain/cover/sparse/no-media variants | — | filled/sparse/no-media/product screenshots + 107-route audit |
| D17 | URL/media/facts/legal/deployment сохранены; нет fake/stock/internal production | DONE | scoped Git/data audit: 68 product diffs additive; `public/**`, `.github/**`, contacts/legal untouched | — | diff audit + 9 193 links/2 285 media; no production→Design Lab links |
| D18.1 | `npm run check` | DONE | 186 files | — | exit 0; 0 errors, 0 warnings, 33 existing hints |
| D18.2 | `npm run build` | DONE | Astro static output | — | exit 0; 227 pages |
| D18.3 | Static route/link/media/schema audit | DONE | `npm run qa:final:static` | — | 38/38; 107 routes, 9 193 links, 2 285 media |
| D18.4 | Browser behavior audit | DONE | focused + full browser suites | — | 17/17; full 107/24/270/124/22/7; runtime/network 0 |
| D18.5 | Responsive/visual QA | DONE | 9 modes: 1920, 1706, 1440, 1280, 1024, 768, 390, 320, 200% reflow | — | 270 assertions, 31 fresh PNG, independent review |
| D18.6 | Independent final acceptance | DONE | `FINAL_CURRENT_TASK_ACCEPTANCE.md`; повторная matrix/repo/browser сверка | — | CRITICAL/PARTIAL/NOT STARTED/BLOCKED = 0 |
| GIT | Один локальный commit, без push/deploy/generated files | DONE | exact-path staging исключает `.astro`, `dist`, `docs/migration`, `docs/design-lab`; commit содержит эту матрицу | — | cached scope/diff checks + post-commit status; hash в final report |

## Итоговые acceptance-счётчики

- DONE: **54**
- PARTIAL: **0**
- NOT STARTED: **0**
- BLOCKED: **0**
- CRITICAL: **0**

Известные эксплуатационные границы, не являющиеся незавершёнными требованиями: физическая device-lab не выполнялась (вместо неё проверены заданные viewport/reflow modes); внешняя карта и аналитика зависят от сети; исходные тяжёлые media не перекодировались, поскольку изменение media запрещено задачей.

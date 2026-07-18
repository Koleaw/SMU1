# Реестр источников и открытий

Дата всех просмотров: **11 июля 2026 года**. Время ниже указано в **MSK (UTC+3)**. Технические журналы с миллисекундами находятся в `_capture-results-*.json`.

## Сводка

- Успешно визуально исследовано **23 уникальных содержательных URL**.
- Главные страницы всех пяти сайтов дополнительно проверены при mobile viewport `390 × 844`.
- Открыты, но не засчитаны как содержательные страницы: два нестабильных/404 маршрута Foster и служебный redirect-route mmcité `/products`.
- Встроенный web использовался для поиска и перепроверки URL; выводы о дизайне основаны на браузерном рендере, PNG и DOM.

## Foster + Partners

| Тип | URL | Время MSK | Title / HTTP | Статус и препятствия | Основное доказательство |
|---|---|---:|---|---|---|
| Home, desktop | `https://fosterandpartners.com/` → `https://www.fosterandpartners.com/` | 12:34:56 | `Foster + Partners`, 200 | Открыта; `Yes, I agree` принят | [`home-desktop-viewport.png`](screenshots/foster/home-desktop-viewport.png) |
| Projects | `https://fosterandpartners.com/projects` → `https://www.fosterandpartners.com/projects` | 12:39:21 | `Discover projects from Foster + Partners`, 200 | Открыта; первые карточки загружены, полный lazy-list не считается доказанным | [`projects-desktop-viewport.png`](screenshots/foster/projects-desktop-viewport.png) |
| Project detail | `https://www.fosterandpartners.com/projects/south-sabah-al-ahmad-masterplan` | 12:35:27 | `South Sabah Al-Ahmad Masterplan \| Projects`, 200 | Открыта; доступный detail взят из фактического href Projects | [`project-detail-desktop.png`](screenshots/foster/project-detail-desktop.png) |
| Studio | `https://www.fosterandpartners.com/studio/` → `/studio` | 12:43:42 | `Foster + Partners \| Studio`, 200 | Открыта после нестабильной маршрутизации | [`studio-desktop-viewport.png`](screenshots/foster/studio-desktop-viewport.png) |
| Home, mobile | тот же home URL | 12:45:03 | `Foster + Partners`, 200 | Первый экран и раскрытое меню валидны; нижний full-page lazy-контент ограничен | [`home-mobile-viewport.png`](screenshots/foster/home-mobile-viewport.png), [`home-mobile-menu.png`](screenshots/foster/home-mobile-menu.png) |

Неблокирующие request failures относятся преимущественно к analytics/LinkedIn/Vimeo; видимые media и основные компоненты загружены. Полный разбор: [foster-and-partners.md](sites/foster-and-partners.md).

## Vestre

| Тип | URL | Время MSK | Title / HTTP | Статус и препятствия | Основное доказательство |
|---|---|---:|---|---|---|
| Home, desktop | `https://www.vestre.com/` | 12:32:58 | `Vestre \| We craft wood and metal into Public Belonging`, 200 | Открыта нативным Chrome; ранние попытки получили checkpoint 429 | [`home-desktop.png`](screenshots/vestre/home-desktop.png), [`home-desktop-products.png`](screenshots/vestre/home-desktop-products.png) |
| Products | `https://www.vestre.com/products` | 12:33:40 | `Products \| Vestre`, 200 | Открыта; 18 146 px document исследован viewport-зонами | [`products-desktop.png`](screenshots/vestre/products-desktop.png), [`products-desktop-grid.png`](screenshots/vestre/products-desktop-grid.png) |
| Seating category | `https://www.vestre.com/products/seating` | финальный захват 12:39:18 | `Seating \| Vestre`, 200 | Открыта; первый capture повторен из-за некорректного transition-state | [`category-desktop.png`](screenshots/vestre/category-desktop.png), [`category-desktop-grid.png`](screenshots/vestre/category-desktop-grid.png) |
| STOOP bench | `https://www.vestre.com/products/multipurpose/stoop-seat` | 12:34:38 | `STOOP bench \| Vestre`, 200 | Открыта; gallery/specification/sticky CTA загружены | [`product-desktop.png`](screenshots/vestre/product-desktop.png), [`product-desktop-specification.png`](screenshots/vestre/product-desktop-specification.png) |
| References | `https://www.vestre.com/references` | финальный захват 12:39:28 | `References \| Vestre`, 200 | Первый capture потерял execution context при checkpoint-навигации; retry успешен, document responses 429→200 | [`references-desktop.png`](screenshots/vestre/references-desktop.png), [`references-desktop-grid.png`](screenshots/vestre/references-desktop-grid.png) |
| Reference detail | `https://www.vestre.com/references/parks/burgerpark-garching-a-green-jewel-for-recreation-and-leisure` | 12:35:26 | `Bürgerpark Garching: A green jewel for recreation and leisure \| Vestre`, 200 | Открыта после 429→200; контент и изображения валидны | [`reference-detail-desktop.png`](screenshots/vestre/reference-detail-desktop.png), [`reference-detail-desktop-gallery.png`](screenshots/vestre/reference-detail-desktop-gallery.png) |
| Home, mobile | `https://www.vestre.com/` | 12:35:55 | home title, 200 | Открыта после 429→200; точный viewport и зоны валидны | [`home-mobile.png`](screenshots/vestre/home-mobile.png), [`home-mobile-products.png`](screenshots/vestre/home-mobile-products.png) |

Cookie wall не обнаружен. Единый full-page PNG не использован как доказательство нижних секций: blur/reveal зависит от нахождения блока во viewport. Полный разбор: [vestre.md](sites/vestre.md).

## mmcité

| Тип | URL | Время MSK | Title / HTTP | Статус и препятствия | Основное доказательство |
|---|---|---:|---|---|---|
| Home, desktop | `https://www.mmcite.com/en` | 12:27:11 | `mmcité \| mmcité street furniture`, 200 | Открыта; `Allow all` принят | [`home-desktop-viewport.png`](screenshots/mmcite/home-desktop-viewport.png) |
| Products mega-menu | состояние на home URL | 12:32:34 | home title | Открыто кликом, URL не менялся | [`products-menu-desktop.png`](screenshots/mmcite/products-menu-desktop.png) |
| Category | `https://www.mmcite.com/en/park-benches-and-seating` | 12:27:33 | `mmcité \| Park Benches and Seating`, 200 | Открыта; filters и product grid загружены; отдельный viewport имеет артефакт шапки, поэтому основной proof — full-page | [`category-desktop.png`](screenshots/mmcite/category-desktop.png) |
| Product | `https://www.mmcite.com/en/vera` | 12:27:46 | `mmcité \| Vera`, 200 | Открыта; 7 console messages внешнего Issuu reader, основной контент не затронут; `*-clean` исключен аудитом | [`product-desktop-viewport.png`](screenshots/mmcite/product-desktop-viewport.png) |
| References | `https://www.mmcite.com/en/references` | 12:28:13 | `mmcité \| References`, 200 | Открыта; filters и cards загружены | [`references-desktop-viewport.png`](screenshots/mmcite/references-desktop-viewport.png) |
| Reference detail | `https://www.mmcite.com/en/newark-nj` | 12:28:29 | `mmcité \| Newark, NJ`, 200 | Открыта; gallery и linked product загружены | [`reference-detail-desktop-viewport-clean.png`](screenshots/mmcite/reference-detail-desktop-viewport-clean.png) |
| Home, mobile | `https://www.mmcite.com/en` | 12:28:42 | home title, 200 | Открыта; mobile menu отдельно проверено в 12:42:22 | [`home-mobile-viewport.png`](screenshots/mmcite/home-mobile-viewport.png), [`navigation-mobile.png`](screenshots/mmcite/navigation-mobile.png) |

Полный разбор: [mmcite.md](sites/mmcite.md).

## Skanska

| Тип | URL | Время MSK | Title / HTTP | Статус и препятствия | Основное доказательство |
|---|---|---:|---|---|---|
| Home, desktop | `https://www.skanska.com/group/en` | 12:31:43 | `We build the places that move the world \| Skanska`, 200 | Открыта; `Allow all cookies` принят | [`home-desktop-viewport.png`](screenshots/skanska/home-desktop-viewport.png) |
| Construction | `https://www.skanska.com/group/en/about-us/our-business-streams/construction` | 12:32:04 | `Construction and Infrastructure development \| Skanska`, 200 | Открыта; 56/57 DOM images loaded, broken 0 | [`construction-desktop-viewport.png`](screenshots/skanska/construction-desktop-viewport.png) |
| Projects | `https://www.skanska.com/group/en/about-us/around-our-world/our-projects` | 12:32:29 | `Browse our global project portfolio \| Skanska`, 200 | Client data загружены: `865 projects`, не `Loading/0` | [`projects-desktop-viewport.png`](screenshots/skanska/projects-desktop-viewport.png) |
| Project detail | `https://www.skanska.com/uk/en-gb/projects/crossrail-paddington-elizabeth-line-station` | 12:32:48 | `Crossrail – Paddington Elizabeth Line Station \| Skanska in the UK`, 200 | Открыта; facts, gallery, map placeholder и related projects загружены; viewport имеет артефакт краев шапки | [`project-detail-desktop.png`](screenshots/skanska/project-detail-desktop.png) |
| About | `https://www.skanska.com/group/en/about-us` | 12:33:08 | `Shaping the way we live \| Skanska`, 200 | Открыта; 15/15 images loaded | [`about-desktop-viewport.png`](screenshots/skanska/about-desktop-viewport.png) |
| Home, mobile | home URL | 12:33:35 | home title, 200 | Открыта; consent wall снят | [`home-mobile-viewport.png`](screenshots/skanska/home-mobile-viewport.png) |

Повторяющиеся console messages и request failures были неблокирующими; screenshot/DOM показывают основной контент. Полный разбор: [skanska.md](sites/skanska.md).

## Linear

| Тип | URL | Время MSK | Title / HTTP | Статус и препятствия | Основное доказательство |
|---|---|---:|---|---|---|
| Home, desktop | `https://linear.app/` | 12:43:44 | `Linear – The system for product development`, 200 | Открыта; cookie wall нет; один aborted audio request не влияет на UI | [`home-desktop-viewport.png`](screenshots/linear/home-desktop-viewport.png) |
| Features | `https://linear.app/features` | 12:44:18 | `Features – Linear`, 200 | Открыта; console/request errors 0 | [`features-desktop-viewport.png`](screenshots/linear/features-desktop-viewport.png) |
| Plan | `https://linear.app/plan` | 12:44:28 | `Linear Plan – Define the product direction`, 200 | Открыта; console/request errors 0 | [`product-desktop-viewport.png`](screenshots/linear/product-desktop-viewport.png) |
| Home, mobile | `https://linear.app/` | 12:44:57 | home title, 200 | Открыта; один aborted audio request не влияет на UI | [`home-mobile-viewport.png`](screenshots/linear/home-mobile-viewport.png) |

Полный разбор: [linear.md](sites/linear.md).

## Открытые, но не засчитанные маршруты

| Сайт | URL | Фактический результат | Решение |
|---|---|---|---|
| Foster + Partners | `https://fosterandpartners.com/projects/apple-park-visitor-center` и вариант со слешем | HTTP 200, title бренда, H1 `404`, `Page not found` | Не засчитан; выбран доступный detail из фактической Projects card, замена явно отмечена |
| Foster + Partners | `https://fosterandpartners.com/studio/about` | один раз DOM About, затем фирменная 404; полученные PNG белые | Не засчитан; выводы ограничены Studio fallback |
| mmcité | `https://www.mmcite.com/en/products` | HTTP 200, title `Redirection`, только `Please wait while redirecting` | Не засчитан как каталог; Products изучен как фактический mega-menu + category page |

Прямой `www` root Foster и ранние Vestre checkpoint PNG также были диагностическими попытками и не входят в доказательный набор.

# Production V2 visual-polish report

Дата проверки: 16 июля 2026. Рабочая ветка: `v2-visual-polish`. Исходное состояние: `de282ed3da8419d1bcf6cf0d5f5d5b912446b635`. Работа выполнялась локально; URL, records, schemas, admin и media не менялись.

## 1. Причина дублирования Footer

Footer не был подключён дважды и отдельного Home Footer не существовало. Один shared `HomeV2Footer` намеренно рендерил desktop-колонки и mobile `<details>`, но правила их взаимоисключающей видимости находились только под ancestor `.catalog-v2`. На главной этого ancestor нет, поэтому browser-default `<details>` показывались вместе с desktop-навигацией.

Видимость теперь принадлежит самому Footer: на desktop остаются две обычные навигационные колонки, на mobile — только два нативных, keyboard-доступных accordion. Проверено на 9 типах страниц × 2 viewport: 18/18 pass.

## 2. Причина автоматического scroll

Astro ClientRouter и ViewTransitions в production V2 отсутствуют. Причиной были `V2ProductGallery` и `V2ProjectGallery`: initial `setCurrent(0)` безусловно вызывал `thumb.scrollIntoView()`. Thumbnail, находившийся ниже fold, заставлял браузер прокручивать весь document к галерее.

## 3. Исправление навигации и scroll

- Initial gallery state больше не прокручивает страницу.
- При пользовательской смене кадра двигается только горизонтальный thumbs-container через локальный `scrollTo`, а не document.
- Обычный новый pathname использует нативную навигацию и открывается сверху.
- Настоящие hash, Back и Forward не переопределяются; browser history restoration сохранён.
- Focus management и MobileMenu не вызывают scroll jump.

Финальный audit: 107/107 direct loads и 24/24 trusted click pathname-перехода завершились с `scrollY=0`; максимум среди 131 замера — `0`. Native Back восстановил `4468 → 4468`, Forward — `0 → 0`. `#contact` click/Forward/direct достигли anchor; Back точно восстановил `121 → 121`. Тест дожидается фактического завершения нативного smooth scroll перед assertion.

## 4. Page-entry architecture

Используются четыре режима:

1. Immersive direction — интегрированный прозрачный Header, media, breadcrumbs и staged entrance.
2. Catalog/category — связанная split-композиция с neutral/dark outer surface.
3. Product — viewport-aware gallery + summary в одном первом экране.
4. Editorial/practical — solid Header и компактный типографический intro без искусственного fullscreen hero.

## 5. Immersive directions

Новый immersive hero получили:

- `/metallokonstruktsii-dlya-biznesa/` — реальный металлический каркас, H1 без разрыва слова;
- `/blagoustroystvo-territoriy/` — сохранён кадр набережной;
- `/stroitelstvo-i-remonty/` — готовое внешнее здание;
- `/navesy-i-kozyrki/` — готовый render навеса;
- `/topiarii/` — отдельная split-композиция с topiary media.

Media имеют зарезервированные размеры, eager loading и `fetchpriority="high"`; loader поверх H1 отсутствует. Breadcrumbs находятся внутри hero. Header переходит из overlay в solid state без изменения высоты.

## 6. Catalog и categories

`/ulichnaya-mebel/` и `/ograzhdeniya-i-zabory/` используют законченный section entry, но не копируют immersive hero. Все 20 category routes проходят через общий dark split entry. Isolated renders показываются целиком через `contain` внутри elevated panel; contextual photo использует `cover`. No-media и sparse state стали компактными типографическими состояниями без пустой рамки высотой в экран.

## 7. Product first screen

Все 68 product routes используют общий viewport budget. Desktop stage ограничен через `svh`, `clamp` и `max-height`, изображение — `contain`, thumbnails полностью помещаются в горизонтальный scroller. Summary, price mode и CTA остаются частью entry composition. На mobile сначала показываются title/summary/CTA, затем компактная gallery. Zero-media state не имитирует большую пустую галерею. SKU не выводится.

Проверены media-rich, single-image, zero-media, portrait, long-title, specs-heavy и minimal-text варианты. Fullscreen, arrows, thumbs, Escape, return focus и swipe прошли functional audit.

## 8. Устранение pale green

Большие mint/pale-green surfaces `#e7ece7` и `#f3f5f1` удалены из page/hero/section roles. Они не заменялись одним глобальным hex вслепую: category, practical, projects, contacts, company и product surfaces получили подходящий semantic role — base, warm neutral, elevated либо dark olive.

## 9. Color и spacing tokens

- base `#f6f3ed`;
- elevated `#fffdf8`;
- warm neutral `#e9e5dc`;
- dark olive `#20352b`;
- graphite `#1d2421`;
- primary text `#18201c`;
- secondary text `#626761`;
- border `#d2cfc6`;
- accent `#285d47`, hover `#1e4938`.

Добавлена общая spacing scale 4–128 px и четыре H1 entry scales. Совместимые aliases сохраняют существующую V2 component architecture.

## 10. Motion system

Home `[data-reveal]` и production `[data-v2-reveal]` приведены к одной restrained системе: breadcrumbs/eyebrow → H1 → description → CTA → media, затем section intro/media/cards. Motion использует opacity/transform без layout shift, короткие delays и общий easing. Content скрывается только после JS enhancement; observer, rapid-scroll scan и fail-open оставляют его доступным.

Normal final-state audit: 107/107 routes pass. Reduced-motion: 15/15 representative routes pass, content сразу видим, opacity-zero/pending elements и scroll drift отсутствуют.

## 11. Placeholder copy

В records найдены helper-значения, но records не изменялись:

- `kacheli`, `malye-elementy`, `navesy`, `stoly-i-komplekty`, `ulichnoe-osveshchenie`: «Описание первого экрана.», «Краткое описание типа изделий.», «Описание страницы.»;
- `shezlongi`: «Описание первого экрана.», «Текст», «Описание страницы.».

Presentation guard `publicCatalogCopy` скрывает exact helper/dev copy в visible blocks и metadata. При отсутствии фактического description остаются H1, количество изделий, существующие факты и CTA; новый маркетинговый текст не выдумывался. Финальный production HTML scan не нашёл указанные helper-фразы, Lorem, Placeholder или dev/internal V2 copy. Слово «Текст» на главной остаётся только как осмысленная подпись формата к пункту «Описание задачи».

## 12. Страницы с минимальными изменениями

Архив объектов сохранил принятую card architecture. Contacts сохранили контакты, адрес, Yandex map, brief, реквизиты и CTA; изменены только tokens и mobile email span. Vacancies сохранили компактность и факты. Legal text не менялся. Company сохранила H1 и два типа готовых объектов; переработаны только surfaces/иерархия блока задач.

## 13. Check и build

- `npm run check`: pass, 0 errors, 0 warnings, 33 существующих hints.
- `npm run build`: pass, 227 static pages.
- Production audit: 111 production artifacts, 107 canonical, 20 categories, 68 products, 4 project details, 7 directions, 1 vacancy, 9099 internal-link observations, 0 issues.

## 14. Browser и visual QA

- direct canonical routes: 107/107 pass;
- real click pathname transitions: 24/24 pass;
- responsive/reflow assertions: 270/270 pass на 1920×1080, 1706×958, 1440×900, 1280×800, 1024×768, 768×1024, 390×844, 320×700 и 200% reflow;
- motion assertions: 122/122 pass;
- Footer assertions: 18/18 pass;
- functional audits: 7/7 pass (dropdown, MobileMenu lock/trap/Escape/return, product/project galleries, swipe/fullscreen, map, desktop/mobile hero video);
- runtime/console errors: 0; local broken-resource errors: 0; failures: 0;
- empty href, duplicate ID, horizontal overflow, broken media, pending reveal, public design-lab link и visible spinner findings: 0.

Вручную просмотрен 31-route representative set, включая production 404; 41 local capture завершён без ошибок. Созданы 23 requested proof PNG общим размером 16,090,719 bytes. Размер посчитан до staging; PNG намеренно не добавляются в commit.

## 15. Data, admin и media preservation

- Protected diff от migration commit для `src/content`, `src/data`, schemas, `src/pages/admin`, `tools/admin-api`, `public/assets`, `public/uploads`: пустой.
- Records modified = 0; schemas = 0; admin = 0; import/export = 0.
- Media audit: baseline/current 332/332; removed = 0, renamed = 0, overwritten = 0, unexpected = 0.
- Desktop hero video: 26,073,769 bytes, SHA-256 `13341BC4A23614D634A7E6EAD6E69207006AD3433231021BD8CC158ED6B8EFB0`.
- Mobile hero video: 5,627,976 bytes, SHA-256 `44E4019DA504B46A7231136D1D7B91143EED280567059B6D4F5396D706C01117`.
- Admin import tests: 19/19 pass. Round-trip: normalized export equal, live changes 0, publish not called.

## 16. Known visual limitations

- Качество и ракурсы зависят от существующих разрешённых media; новые изображения не создавались и stock media не добавлялись.
- Honest zero-media/sparse states остаются менее визуальными по определению, но не выглядят сломанными.
- Yandex map зависит от внешнего сервиса; локальный audit подтвердил правильный constructor ID, frame и готовый container, но не заменяет проверку доступности сервиса у конечного пользователя.
- Автоматизированы Chromium viewports и reflow; отдельный физический Safari/iOS/Android device lab в этот этап не входил.

## 17. Что проверить владельцу вручную

1. Субъективно утвердить crop/контраст пяти direction heroes на реальных мониторах и телефонах.
2. Подтвердить, что фактические формулировки category/product descriptions и цены по запросу актуальны; records этим этапом не редактировались.
3. Открыть Yandex map, Telegram, телефон и email из целевой сети/устройства.
4. Проверить mobile menu и product fullscreen на одном физическом iPhone и Android.
5. Решить, нужно ли хранить 23 proof PNG в репозитории отдельным осознанным commit; текущий visual-polish commit их не включает.

Push, deployment и GitHub Pages не выполнялись. Публичный сайт не изменён.

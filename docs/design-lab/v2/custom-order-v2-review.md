# V2: «Изготовление под задачу объекта»

Дата: 15 июля 2026 года. Route: `/design-lab/v2/izgotovlenie-na-zakaz/`; production canonical: `/izgotovlenie-na-zakaz/`. Страница имеет `noindex, nofollow` и исключается из sitemap общей design-lab policy.

## Композиция

Страница не добавляет восьмое направление и не повторяет product/direction template. Она состоит из шести компактных секций:

1. Hero с H1 «Изготовление под задачу объекта», кратким сценарием и двумя прямыми действиями.
2. «Что можно изменить» — только параметры, подтверждённые active product records.
3. Выбор всех семи основных направлений с V2-ссылками.
4. «Что можно прислать» с пояснением, что достаточно имеющихся исходных данных.
5. Три готовых примера разных типов.
6. Финальная прямая связь: основной телефон, Telegram и email, без формы и загрузчика файлов.

Header, MobileMenu, Breadcrumbs и Footer используют утверждённую V2-обвязку. Custom-order отмечается как current page в desktop dropdown, mobile menu и Footer. Все подходящие V2 CTA, включая home, catalog section/category, hero и direct-contact defaults, переведены с production URL на новый V2 route. Production navigation не менялась.

## Источники данных

- Исходная production page: `src/content/static-pages/custom-order.json`.
- Направления: пять active `product-sections` и два active `services` records.
- Подтверждение вариантов изменения: active products `skamya-loft`, `naves-terra`, `ekran-s-navesom`, `veloparkovka-marker`.
- Контакты: существующий `src/content/site-settings/global.json`.
- Примеры: active products и active projects; связи собраны только временным V2 presentation adapter, production records/schema не менялись.

Показываются подтверждённые варианты: размеры и габариты; форма/геометрия отдельных элементов; цвет металлических и оттенок деревянных элементов; способ крепления; количество/расстояние между стойками; добавление логотипа. Не выводятся нагрузки, узлы, марки стали, нормативы, сроки, гарантии или иные неподтверждённые параметры.

Блок исходных данных перечисляет фотографию/референс, примерные размеры, эскиз, чертёж, ТЗ и описание задачи. Формулировки подтверждаются текущей custom-order page, product custom-project copy и service contact copy.

## Media

Hero использует максимум два существующих файла:

- `/uploads/project-05c77513c1a391e5a71a7dee.jpg` — явно маркированный V2 adapter как готовые городские качели после установки (`finished-result`, `hero`);
- `/uploads/chatgpt-image-17-2026-15-36-16-1779554995111.png` — назначенный product record catalog render «Навес Терра».

В примерах используются назначенные media «Скамья Лофт», «Экран с навесом» и approved finished-result набережной. Процесс, монтаж, внутреннее производство, placeholders, stock и новые media отсутствуют. На mobile hero media идут последовательно и используют `contain`, чтобы не обрезать значимую часть результата.

## QA artifacts

- `custom-order-desktop.png` — 1440 px.
- `custom-order-mobile.png` — 390 px.
- `custom-order-full.png` — full-page capture после image decode.

Единый последовательный Chromium run успешно проверил 1440, 1280, 1024, 768, 390, 320 px и эквивалент 200% reflow; horizontal overflow, broken media и console errors не обнаружены. Отчёт: `browser-pre-migration-v2-report.json`. `npm run check` после реализации: успешно, 0 errors, 0 warnings, 34 существующих hints.

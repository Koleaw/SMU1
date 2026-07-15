# Финальный вердикт пилота

Дата: **11 июля 2026 года**.

## 1. Было ли исследование реально визуальным

**Да.** Публичные страницы выполняли клиентский JavaScript в Chrome/Chromium; ожидались fonts и media, прокручивался lazy-контент, сохранялись desktop/mobile PNG, затем screenshots проверялись визуально. HTML, web search и snippets использовались только для поиска URL и независимой перепроверки, но не заменяли визуальный анализ.

Доказательства включают полностью отрендеренные videos/photos/product UI, responsive navigation, filters, galleries, sticky CTA и computed styles. Пустые, error, cookie-wall и skeleton-состояния не засчитывались.

## 2. Какие инструменты использовались

- встроенный web search/open;
- PowerShell/curl для HTTP и redirects;
- установленный Google Chrome `149.0.7827.201`;
- уже кэшированные Playwright `1.60.0` и Chromium `148.0.7778.96`;
- Chrome DevTools Protocol для Vestre;
- локальный `view_image` для проверки PNG;
- исследовательский helper `_research-browser.cjs` внутри разрешенного каталога.

Ничего не устанавливалось; npm/package/lock не менялись.

## 3. Сколько страниц фактически открыто

**23 уникальных содержательных URL** успешно открыты и визуально исследованы:

| Сайт | Содержательные URL | Статус покрытия |
|---|---:|---|
| Foster + Partners | 4 | Частично относительно точных заданных URL: home, Projects, доступный project detail и Studio исследованы; Apple Park URL и About не засчитаны |
| Vestre | 6 | Полностью по выбранным типам: home, Products, Seating, STOOP, References, reference detail |
| mmcité | 5 | Полностью по полезным типам: home/mega-menu, category, Vera, References, reference detail; `/products` отдельно открыт как служебный redirect |
| Skanska | 5 | Полностью: home, Construction, Projects, Crossrail, About |
| Linear | 3 | Полностью для scope пилота: home, Features, Plan |

Главные страницы всех пяти сайтов дополнительно отрендерены при mobile viewport. Открытые, но не засчитанные routes: Apple Park и About Foster, `/products` mmcité. Полный список: [source-register.md](source-register.md).

## 4. Сколько корректных скриншотов создано

- Всего в пяти screenshot-папках: **77 PNG**.
- Приняты как доказательства: **73 PNG**.
- Исключены из доказательств: **4 PNG** — три Vestre probes и `mmcite/product-desktop-viewport-clean.png` с крупными черными блоками.
- В числе 73 принятых есть файлы с явно записанными ограничениями: отдельные full-page lazy/white-tail states и viewport с артефактом только в шапке; выводы по испорченной зоне опираются на другой корректный PNG и DOM.
- Корректных mobile viewport главных: **5**, по одному на каждый сайт; дополнительно есть mobile full-page/zone/menu доказательства.

## 5. Какие ограничения выявлены

1. Foster нестабилен по host/path: direct `www` root, Apple Park и About могли отдавать фирменную 404 при HTTP 200.
2. Vestre применяет Vercel checkpoint: Playwright launch получил 429; нативный Chrome прошел переход 429→200.
3. Vestre blur/reveal зависит от viewport, поэтому длинные страницы надежнее фиксировать зонами, а не одним full-page.
4. У отдельных AOS/animation страниц full-page/viewport capture может давать white tail или black header blocks; нужен независимый visual audit.
5. Mobile подробно покрывает home, но не все внутренние templates.
6. Motion зафиксирован по видимому поведению и animation count, но не записан/измерен покадрово.
7. Не тестировались submit forms, authentication, downloads, full filter behavior, hover, 3D, map, accessibility и Core Web Vitals.
8. Живые сайты могут измениться после даты исследования.

## 6. Какова надежность выводов

- **Высокая:** desktop composition, typography, color, grids, navigation, cards, catalog/product/project structure на 23 успешных URL.
- **Высокая с локальными оговорками:** screenshot evidence, потому что каждый проблемный PNG классифицирован и не используется для испорченной зоны.
- **Средняя:** mobile patterns ниже home hero и применимость сложных sticky/carousel решений.
- **Средняя/низкая:** конкретные motion-паттерны и performance impact без video trace/Lighthouse.
- **Нулевая:** дизайн точных Apple Park/About Foster, которые не были успешно визуально сняты.

Выводы для СМУ-1 являются кандидатами в принципы, а не доказанными conversion results.

## 7. Есть ли смысл расширять исследование до 30–40 сайтов

**Да, но после человеческих решений о приоритетном offer, CTA, prices, content readiness и technical files.** Пилот показал, что метод дает конкретные различия и применимые принципы. Расширение полезно для проверки российских B2B-паттернов, price/delivery/forms, а не для накопления еще 30 эстетических примеров.

Масштабирование следует делать волнами с фиксированной taxonomy findings и stop criteria.

## 8. Сколько сайтов оптимально исследовать за один этап

Оптимально **8–12 сайтов на одну волну**:

- 3–4 прямых производителя/каталога;
- 2–3 строительных/проектных компании;
- 1–2 российских B2B-лидера по forms/prices/delivery;
- 1–2 источника по typography/motion, не используемых как отраслевой эталон.

Полная экспедиция 30–40 сайтов — **3–4 волны**, между которыми человек исключает нерелевантные направления и уточняет вопросы.

## 9. Что изменить в методике полной экспедиции

1. До массового capture делать двухдоменный access gate: Playwright + нативный Chrome fallback.
2. Фиксировать canonical URL из реального href, redirects и error-like body отдельно от HTTP status.
3. Снимать первый viewport всегда; full-page только там, где visual audit подтверждает off-screen content.
4. Для reveal/lazy interfaces автоматически делать 3–4 named zones.
5. Ввести обязательный post-capture audit: PNG dimensions, visual state, missing links, hash duplicates и classification `reliable/limited/excluded`.
6. Выбирать одинаковые functional page types, а не одинаковое число страниц у каждого сайта.
7. Добавить interaction script для menu/filter/gallery/CTA и reduced-motion state.
8. Отдельно замерять network weight/Core Web Vitals на shortlist, не на всей выборке.
9. Кодировать findings в единой taxonomy и прекращать волну, когда новые сайты не добавляют новых решений по ключевым вопросам.
10. После каждой волны проводить human decision gate, иначе противоречия будут накапливаться без разрешения.

## 10. Какие вопросы должен решить человек, а не Codex

1. Какой offer доминирует на первом экране.
2. Какие CTA и срок ответа можно обещать.
3. Как публикуются prices.
4. Какие факты/сертификаты/мощности разрешено раскрывать.
5. Какой photo/video budget и права доступны.
6. Какие BIM/PDF/DWG действительно поддерживаются.
7. Какие поля обязательны для товара и объекта.
8. Какая аудитория приоритетна при конфликте требований.
9. Кто обновляет product↔project связи, документы и показатели.
10. Какой form provider и legal consent утверждены.

Подробно: [smu1-open-questions.md](smu1-open-questions.md).

## Критерии успеха исходного пилота

| Критерий | Результат |
|---|---|
| Не менее 15 целевых страниц | Выполнено: 23 содержательных URL |
| Минимум 5 корректных mobile screenshots | Выполнено: 5 home viewport + дополнительные mobile files |
| Desktop screenshots внутренних страниц | Выполнено для всех пяти сайтов |
| Выводы основаны на доказательствах | Выполнено: URL/PNG/DOM/measurements в site reports и findings |
| Сайты не описаны одинаково | Выполнено: отчетливо различаются project/editorial, physical catalog, construction trust и software narrative |
| Конкретные выводы для СМУ-1 | Выполнено: 25 кандидатов, rejects, audiences и risks |
| Основной проект не изменен | Выполнено: `git status` показывает только `docs/design-lab/` |

## Общий вердикт

Пилот **успешен как исследовательский процесс** и подтверждает смысл расширения. Следующий этап должен быть не «еще больше красивых сайтов», а сравнительная волна 8–12 источников вокруг нерешенных коммерческих вопросов СМУ-1, с теми же evidence и artifact checks.

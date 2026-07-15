# Строительство и ремонты V2 — review

Дата проверки: 14 июля 2026 года.

## Маршруты и данные

Production route: `/stroitelstvo-i-remonty/`. Изолированный прототип: `/design-lab/v2/stroitelstvo-i-remonty/`. V2-страница использует production canonical, `noindex, nofollow`, не входит в sitemap и production-навигацию.

Источник контента — `src/content/services/stroitelstvo.json`. Визуальный proof использует active published project `src/content/projects/kompleks-rabot-na-proizvodstvennoy-territorii.json`; компактный текстовый proof — `src/content/projects/remont-skvera-na-ulitse-gogolya.json`. Исходные записи, schema и media не изменялись.

## Separation from metalworks

Страница теперь продаёт комплекс строительных и ремонтных работ с акцентом на готовый или преобразованный объект. Hero использует одно сильное изображение готового обшитого здания вместо двухкадрового коллажа:

- `/uploads/img-20250724-134235-1783272745917.jpg`.

Основной proof показывает только finished-result media производственной территории:

- `/uploads/img-20250724-133811-1783272616313.jpg`;
- `/uploads/img-20250724-134235-1783272745917.jpg`;
- `/uploads/img-20250724-134355-1783272745972.jpg`.

Кадры открытого металлического каркаса и отдельных элементов исключены из текущей строительной presentation и оставлены странице металлоконструкций. Процесс не запрещён как класс материала, но в этой версии он не заменяет главный вывод о результате. Кадры внутренних зон, оборудования, людей и монтажных операций не выводятся.

Проект «Благоустройство набережной реки Тобол» полностью удалён со строительной страницы: он больше не используется ни в hero, ни в proof. «Частичный ремонт сквера на улице Гоголя» показан только компактной текстовой карточкой на основании опубликованной записи; placeholders не используются.

Основной proof описывает опубликованный комплекс работ на производственной территории и прямо обозначает, что визуально показан готовый внешний результат. Внутренняя фраза «Каждый пример подтверждает только факты, опубликованные в записи конкретного объекта» удалена. Для клиента, которому нужна отдельная металлическая конструкция, добавлена коммерческая ссылка на направление металлоконструкций.

## Временное назначение media

Presentation-only adapter расположен в `src/components/design-lab/v2/mediaRoleAdapter.ts`; полное описание — в `docs/design-lab/v2/media-role-adapter.md`. Он нужен только для явного разведения текущих V2-прототипов без изменения production schema и records. Позднее роли должны управляться через новую админку; в этой задаче она не создавалась.

## Проверка и изоляция

Проверены single-image hero, отличный от металлоконструкций proof, галерея и fullscreen, клавиатура, focus trap и return focus, swipe, reduced motion, Header, MobileMenu, Footer, CTA, ссылки, responsive/reflow и отсутствие horizontal overflow. Финальный `npm run check`: 126 файлов, 0 errors, 0 warnings, 34 существующих hints. Финальный `npm run build`: успешно, 140 страниц.

Production routes/templates, content records, schemas, slugs, navigation, site settings, admin, import/export, media, package/deployment-файлы и GitHub Actions не изменялись. V2 не переносилась в production.

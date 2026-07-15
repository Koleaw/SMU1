# Металлоконструкции V2 — review

Дата проверки: 14 июля 2026 года.

## Маршруты и данные

Production route: `/metallokonstruktsii-dlya-biznesa/`. Изолированный прототип: `/design-lab/v2/metallokonstruktsii-dlya-biznesa/`. V2-страница использует production canonical, `noindex, nofollow`, не входит в sitemap и production-навигацию.

Источник контента — `src/content/product-sections/metallokonstruktsii-dlya-biznesa.json`; proof — active published project `src/content/projects/kompleks-rabot-na-proizvodstvennoy-territorii.json`. Исходные записи, schema и media не изменялись.

## Separation from construction

Предложение страницы теперь ограничено предметом покупки: конкретной металлоконструкцией или металлической частью объекта. Hero, заголовки блоков «Для каких объектов» и «Что изготавливаем», proof и CTA последовательно поддерживают эту формулировку. Для более широкого комплекса есть обычная коммерческая ссылка на «Строительство и ремонты».

Hero показывает открытый металлический каркас:

- `/uploads/img-20250724-134010-1783272745899.jpg`.

Proof использует только кадры, на которых читаются каркас и металлические элементы:

- `/uploads/img-20231013-135454-1783272745548.jpg`;
- `/uploads/img-20231102-142552-1783272745634.jpg`;
- `/uploads/img-20231223-222338-1783272745821.jpg`;
- `/uploads/img-20231227-171915-1783272745842.jpg`.

Готовые строительные кадры `/uploads/img-20250724-133811-1783272616313.jpg`, `/uploads/img-20250724-134235-1783272745917.jpg` и `/uploads/img-20250724-134355-1783272745972.jpg` исключены из presentation страницы металлоконструкций. Также не выводятся внутренние зоны, оборудование, люди и монтажные операции.

Proof сформулирован узко: он подтверждает открытую металлическую часть выполненного комплекса при сборке четырёх цехов и частичной сборке пятого. Объект не представлен как доказательство всего спектра металлоконструкций.

## Временное назначение media

Presentation-only adapter расположен в `src/components/design-lab/v2/mediaRoleAdapter.ts`; полное описание — в `docs/design-lab/v2/media-role-adapter.md`. Он не меняет project records и применяется только внутри design-lab V2. Позднее управляемый выбор ролей должен перейти в новую админку, но CMS-модель в рамках этой задачи не создавалась.

## Проверка и изоляция

Проверены разные по смыслу hero/proof, галерея и fullscreen, клавиатура, focus trap и return focus, swipe, reduced motion, Header, MobileMenu, Footer, CTA, ссылки, responsive/reflow и отсутствие horizontal overflow. Финальный `npm run check`: 126 файлов, 0 errors, 0 warnings, 34 существующих hints. Финальный `npm run build`: успешно, 140 страниц.

Production routes/templates, content records, schemas, slugs, navigation, site settings, admin, import/export, media, package/deployment-файлы и GitHub Actions не изменялись. V2 не переносилась в production.

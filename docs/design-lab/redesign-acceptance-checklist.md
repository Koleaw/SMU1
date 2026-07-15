# Checklist приёмки будущего редизайна СМУ-1

Статус: обязательный release gate.  
Формат: каждый пункт должен быть отмечен только после приложенного machine output, screenshot либо ручного протокола.  
Baseline: docs/design-lab/current-site-preservation-contract.md.

Обозначения:

- **[AUTO]** — должен проверяться скриптом/CI;
- **[MANUAL]** — ручная проверка с URL/viewport/evidence;
- **[OWNER]** — требуется явное решение владельца;
- **[CONDITIONAL]** — применяется только если функция добавлена.

## 1. Baseline и область изменений

- [ ] **BASE-001 [AUTO]** Перед началом сохранены git commit/status, route manifest, content snapshot и SHA-256 manifest public media; критерий: артефакты датированы и доступны в release report.
- [ ] **BASE-002 [AUTO]** Изменения не затрагивают admin, data, media, deployment или public behavior вне утверждённой migration scope; критерий: git diff классифицирован по файлам и каждый non-visual diff имеет issue/approval.
- [ ] **BASE-003 [AUTO]** package.json, lock-file, Astro config и GitHub workflows изменены только при отдельном техническом решении; критерий: неожиданный diff блокирует release.
- [ ] **BASE-004 [AUTO]** Ни один существующий media path не удалён и не переименован; критерий: path set baseline является подмножеством release set.
- [ ] **BASE-005 [AUTO]** Ни один существующий content record не удалён; критерий: collection slug sets baseline являются подмножеством release sets, исключения имеют owner approval и redirect.
- [ ] **BASE-006 [MANUAL]** Redesign остаётся единым сайтом с четырьмя presentation modes; критерий: header, footer, type, grid, controls и states визуально едины.

## 2. Build и штатные проверки

- [ ] **BUILD-001 [AUTO]** npm run check завершается exit code 0.
- [ ] **BUILD-002 [AUTO]** npm run build завершается exit code 0.
- [ ] **BUILD-003 [AUTO]** npm run test:admin-import завершается exit code 0.
- [ ] **BUILD-004 [AUTO]** Production build использует утверждённый SITE_URL/base, не localhost и не temporary URL.
- [ ] **BUILD-005 [AUTO]** В build log нет новых broken-link, missing-media, schema, hydration или duplicate-route ошибок.
- [ ] **BUILD-006 [AUTO]** Clean checkout воспроизводит build без локальных untracked dependencies.

## 3. Полный маршрутный gate

### 3.1 Количество и статусы

- [ ] **ROUTE-001 [AUTO]** Канонических содержательных public URL ровно 106 до согласованного additive расширения; критерий: generated route set равен baseline manifest.
- [ ] **ROUTE-002 [AUTO]** Публичная поверхность содержит 106 canonical + 3 legacy + 404; критерий: 110 baseline pages присутствуют.
- [ ] **ROUTE-003 [AUTO]** Все canonical routes возвращают 200 и не redirect.
- [ ] **ROUTE-004 [AUTO]** Все legacy routes возвращают permanent redirect и ведут ровно на согласованный canonical URL.
- [ ] **ROUTE-005 [AUTO]** Inactive content entries не генерируют indexable public routes.
- [ ] **ROUTE-006 [AUTO]** Ни один canonical URL не ведёт на 404, meta refresh или redirect chain.
- [ ] **ROUTE-007 [AUTO]** URL сохраняют trailing-slash policy и корректный base GitHub Pages.

### 3.2 Фиксированные страницы

- [ ] **ROUTE-010 [AUTO]** / доступен.
- [ ] **ROUTE-011 [AUTO]** /ulichnaya-mebel/ доступен.
- [ ] **ROUTE-012 [AUTO]** /vypolnennye-obekty/ доступен.
- [ ] **ROUTE-013 [AUTO]** /izgotovlenie-na-zakaz/ доступен.
- [ ] **ROUTE-014 [AUTO]** /kontakty/ доступен.
- [ ] **ROUTE-015 [AUTO]** /vakansii/ доступен.
- [ ] **ROUTE-016 [AUTO]** /politika-konfidencialnosti/ доступен.
- [ ] **ROUTE-017 [AUTO]** /o-nas/ доступен.
- [ ] **ROUTE-018 [AUTO]** /ograzhdeniya-i-zabory/ доступен.
- [ ] **ROUTE-019 [AUTO]** /navesy-i-kozyrki/ доступен.
- [ ] **ROUTE-020 [AUTO]** /metallokonstruktsii-dlya-biznesa/ доступен.
- [ ] **ROUTE-021 [AUTO]** /topiarii/ доступен.
- [ ] **ROUTE-022 [AUTO]** /blagoustroystvo-territoriy/ доступен.
- [ ] **ROUTE-023 [AUTO]** /stroitelstvo-i-remonty/ доступен.

### 3.3 Категории и товары

- [ ] **ROUTE-030 [AUTO]** Ровно 20 active category slugs сгенерированы под корректными parent sections; критерий: route set равен таблице раздела 3.3 preservation contract.
- [ ] **ROUTE-031 [AUTO]** Все 11 categories уличной мебели доступны.
- [ ] **ROUTE-032 [AUTO]** Все 9 categories ограждений доступны.
- [ ] **ROUTE-033 [AUTO]** Ровно 68 active product detail routes сгенерированы под корректными category parents; критерий: route set равен таблице раздела 3.4 preservation contract.
- [ ] **ROUTE-034 [AUTO]** Все 65 products уличной мебели доступны.
- [ ] **ROUTE-035 [AUTO]** Все 3 products ограждений доступны.
- [ ] **ROUTE-036 [AUTO]** showInCatalog=false скрывает product из listing, но active detail URL продолжает возвращать 200.
- [ ] **ROUTE-037 [AUTO]** Inactive parent section/category блокирует генерацию descendants.
- [ ] **ROUTE-038 [AUTO]** Related product links разрешаются и не создают loops/broken URLs.

### 3.4 Объекты

- [ ] **ROUTE-040 [AUTO]** /vypolnennye-obekty/blagoustroystvo-naberezhnoy-reki-tobol/ доступен.
- [ ] **ROUTE-041 [AUTO]** /vypolnennye-obekty/gorodskie-kacheli-dlya-obshchestvennyh-territoriy/ доступен.
- [ ] **ROUTE-042 [AUTO]** /vypolnennye-obekty/kompleks-rabot-na-proizvodstvennoy-territorii/ доступен с owner-approved public media selection.
- [ ] **ROUTE-043 [AUTO]** /vypolnennye-obekty/remont-skvera-na-ulitse-gogolya/ доступен.
- [ ] **ROUTE-044 [AUTO]** Два inactive project records сохранены в data и не индексируются.

### 3.5 Legacy, 404, lab и admin

- [ ] **ROUTE-050 [AUTO]** /lavochki-i-skameyki/ permanent redirects на /ulichnaya-mebel/lavochki-i-skameyki/.
- [ ] **ROUTE-051 [AUTO]** /urny/ permanent redirects на /ulichnaya-mebel/urny/.
- [ ] **ROUTE-052 [AUTO]** /navesy/ permanent redirects на /navesy-i-kozyrki/ без meta refresh.
- [ ] **ROUTE-053 [AUTO]** 404 возвращает корректный HTTP status и содержит noindex.
- [ ] **ROUTE-054 [AUTO]** /design-lab/system-a/, /system-b/, /system-c/ не вошли в commercial navigation или sitemap и остаются noindex до отдельного удаления/архива.
- [ ] **ROUTE-055 [AUTO]** Пять admin pages не появились в sitemap/navigation и продолжают открываться в локальном admin contour.

## 4. Компетенции и полнота бизнеса

- [ ] **BIZ-001 [MANUAL]** «Уличная мебель» явно видна в desktop/mobile navigation и на home competence map.
- [ ] **BIZ-002 [MANUAL]** «Ограждения» явно видны и не растворены в общем «Каталоге».
- [ ] **BIZ-003 [MANUAL]** «Навесы» явно видны как самостоятельное направление; различие section и catalog category понятно.
- [ ] **BIZ-004 [MANUAL]** «Металлоконструкции» — видимый top-level desktop entry и сильный home/service route.
- [ ] **BIZ-005 [MANUAL]** «Топиарии» явно видны и не скрыты внутри благоустройства.
- [ ] **BIZ-006 [MANUAL]** «Благоустройство» сохранено как самостоятельная service competency, но не подменяет весь бренд.
- [ ] **BIZ-007 [MANUAL]** «Строительство» — видимый top-level desktop entry, включая подтверждённый масштаб зданий/цехов.
- [ ] **BIZ-008 [MANUAL]** «Изготовление на заказ» доступно как сквозной маршрут.
- [ ] **BIZ-009 [MANUAL]** «Комплексные работы на объектах» объяснены через scope, не заменяют семь направлений.
- [ ] **BIZ-010 [MANUAL]** «Выполненные объекты» служат proof и ведут в полноценный archive/detail.
- [ ] **BIZ-011 [MANUAL]** «Вакансии» доступны в desktop grouping, mobile и footer.
- [ ] **BIZ-012 [MANUAL]** Первый экран и первые navigation blocks не создают впечатление, что СМУ-1 занимается только благоустройством/МАФ.
- [ ] **BIZ-013 [MANUAL]** Ни одна business competency не объединена/удалена без owner-approved mapping.

## 5. No-production policy

- [ ] **POLICY-001 [AUTO]** В public navigation нет раздела «Производство».
- [ ] **POLICY-002 [MANUAL]** На public pages нет фотографий собственного цеха, оборудования, станков, производственных сотрудников или внутреннего процесса.
- [ ] **POLICY-003 [MANUAL]** Нет публикации production capacity, площади, оборудования или числа сотрудников.
- [ ] **POLICY-004 [MANUAL]** Возможность изготовления описана через результат, материалы, документы, объект и процесс взаимодействия.
- [ ] **POLICY-005 [OWNER]** Все media industrial project вручную классифицированы как допустимый внешний результат либо запрещённый internal production.
- [ ] **POLICY-006 [AUTO]** Запрещённые к публикации media физически сохранены и не удалены из repository/storage.
- [ ] **POLICY-007 [MANUAL]** Construction of client buildings/workshops не перепутано с показом собственного производства.
- [ ] **POLICY-008 [AUTO]** Admin defaults больше не предлагают production photo после отдельной согласованной content migration; до неё исходные data не потеряны.

## 6. Header и navigation

- [ ] **NAV-001 [MANUAL]** Desktop header содержит Logo, Продукция, Металлоконструкции, Строительство, Благоустройство, Объекты, Компания, телефон и CTA.
- [ ] **NAV-002 [MANUAL]** Dropdown «Продукция» явно содержит Уличную мебель, Ограждения, Навесы, Топиарии и Изготовление на заказ.
- [ ] **NAV-003 [MANUAL]** Dropdown «Компания» содержит О компании, Контакты и Вакансии.
- [ ] **NAV-004 [MANUAL]** Telegram остаётся явным доступным service action.
- [ ] **NAV-005 [MANUAL]** Transparent header читаем на всех ключевых кадрах desktop/mobile hero.
- [ ] **NAV-006 [MANUAL]** После scroll header становится светлым fixed без layout shift.
- [ ] **NAV-007 [AUTO]** Текущая страница обозначается aria-current.
- [ ] **NAV-008 [MANUAL]** Dropdown открывается pointer, keyboard и touch; Escape закрывает; focus не теряется.
- [ ] **NAV-009 [MANUAL]** Mobile menu содержит все направления, custom order, objects, about, contacts, vacancies, оба телефона, Telegram, email и address.
- [ ] **NAV-010 [MANUAL]** Mobile menu имеет scroll lock, focus trap, initial focus, Escape и return focus.
- [ ] **NAV-011 [MANUAL]** Hamburger не является единственной desktop navigation.

## 7. Главная

- [ ] **HOME-001 [MANUAL]** Hero использует существующие desktop/mobile video и не закрыт огромным текстом.
- [ ] **HOME-002 [MANUAL]** Hero отвечает, что СМУ-1 делает изделия, металлоконструкции, строительство и благоустройство.
- [ ] **HOME-003 [MANUAL]** Hero содержит «Получить расчёт» и «Смотреть объекты».
- [ ] **HOME-004 [MANUAL]** На home все семь компетенций видимы без горизонтального carousel.
- [ ] **HOME-005 [MANUAL]** Строительство и металлоконструкции получают не меньший визуальный вес, чем благоустройство.
- [ ] **HOME-006 [MANUAL]** Product overview является навигацией к taxonomy, а не неполным «каталогом на главной».
- [ ] **HOME-007 [MANUAL]** Object selection ведёт в archive/detail и не подменяет galleries.
- [ ] **HOME-008 [MANUAL]** Steps/inputs не раскрывают внутреннее производство.
- [ ] **HOME-009 [MANUAL]** Trust facts подтверждены текущими data; нет invented numbers/clients/certificates/reviews.
- [ ] **HOME-010 [MANUAL]** Final contact сохраняет Telegram, email и phone.
- [ ] **HOME-011 [MANUAL]** В footer/flow сохранён доступ к vacancies.
- [ ] **HOME-012 [AUTO]** Удалённый/объединённый current block имеет content/function mapping, подтверждающий отсутствие смысловой потери.

## 8. Каталог, категории и товары

- [ ] **CAT-001 [AUTO]** Все 5 product-section records и 20 category records прошли schema round-trip.
- [ ] **CAT-002 [AUTO]** Все 68 product records прошли schema round-trip без потери fields.
- [ ] **CAT-003 [MANUAL]** Catalog/category pages имеют breadcrumbs, title, intro, grid и ясный empty state.
- [ ] **CAT-004 [MANUAL]** Product cards остаются сравнимыми и не превращены в editorial asymmetric grid.
- [ ] **CAT-005 [MANUAL]** Карточка продукта выводит title, SKU, price mode, images, description и features.
- [ ] **CAT-006 [MANUAL]** Dimensions/specifications, materials, colors и customizationItems не потеряны.
- [ ] **CAT-007 [MANUAL]** Delivery block сохраняется там, где showDeliveryBlock=true.
- [ ] **CAT-008 [AUTO]** Related product behavior сохраняет manual slugs и automatic fallback.
- [ ] **CAT-009 [AUTO]** В schema/CMS нет required projectId, projectIds или обратной required product relation.
- [ ] **CAT-010 [MANUAL]** CTA доступны рядом с price/specs и после details.
- [ ] **CAT-011 [CONDITIONAL][AUTO]** Если добавлены filters/search, их fields заполнены, state доступен keyboard, empty state корректен, URL/canonical/index policy протестирована.
- [ ] **CAT-012 [CONDITIONAL][AUTO]** Если добавлены documents, они имеют schema, admin CRUD, import/export, renderer, type/size label и broken-file test.
- [ ] **CAT-013 [MANUAL]** Каталог остаётся каталогом запроса/подбора, не получает fake cart/account/payment.

## 9. Object listing и galleries

- [ ] **GAL-001 [AUTO]** Для каждого project сохранены media URL, порядок, alt/caption fields и dedupe behavior.
- [ ] **GAL-002 [MANUAL]** Listing показывает до шести кадров либо функционально эквивалентную preview gallery.
- [ ] **GAL-003 [MANUAL]** Listing имеет previous/next и понятный current state.
- [ ] **GAL-004 [MANUAL]** Autoplay, если сохранён, имеет видимую Pause и останавливается hover/focus/hidden/reduced-motion.
- [ ] **GAL-005 [AUTO]** Hidden listing slides имеют корректные aria-hidden/inert states.
- [ ] **GAL-006 [MANUAL]** Detail gallery сохраняет все images, previous/next и thumbnails.
- [ ] **GAL-007 [MANUAL]** На mobile работает swipe без блокировки вертикального scroll.
- [ ] **GAL-008 [MANUAL]** Fullscreen/lightbox имеет явный close, Escape, focus trap и return focus.
- [ ] **GAL-009 [MANUAL]** ArrowLeft/ArrowRight работают в gallery context.
- [ ] **GAL-010 [MANUAL]** Portrait images видны целиком или кадрированы по explicit media metadata, без случайного обрезания.
- [ ] **GAL-011 [AUTO]** Первое meaningful image eager/fetchpriority; остальные ниже fold lazy.
- [ ] **GAL-012 [MANUAL]** Alt/caption показаны/озвучены там, где они заполнены; пустые captions не имитируются.
- [ ] **GAL-013 [MANUAL]** Broken media не разрушает layout и даёт честный fallback.
- [ ] **GAL-014 [CONDITIONAL][AUTO]** Project video добавляется только после additive schema/admin/import/export/renderer/accessibility coverage.
- [ ] **GAL-015 [MANUAL]** Static cinematic first screen не заменяет полную gallery.

## 10. Forms, CTA и contacts

- [ ] **CONTACT-001 [MANUAL]** Primary phone кликабелен и совпадает с site-settings.
- [ ] **CONTACT-002 [MANUAL]** Secondary phone сохранён с корректной ролью/подписью.
- [ ] **CONTACT-003 [MANUAL]** Telegram и email доступны в header/mobile/contact/footer по утверждённой схеме.
- [ ] **CONTACT-004 [MANUAL]** Address, city и regions сохранены.
- [ ] **CONTACT-005 [MANUAL]** Yandex map и rating badge сохранены с lazy loading и text/link fallback.
- [ ] **CONTACT-006 [AUTO]** Header, DirectContact, MobileMenu, Footer и Contacts получают значения из одного settings source; snapshot values совпадают.
- [ ] **CONTACT-007 [MANUAL]** CTA wording соответствует page intent и не обещает неподтверждённый срок/цену.
- [ ] **CONTACT-008 [MANUAL]** Прямые channels не удалены после добавления form.
- [ ] **FORM-001 [CONDITIONAL][OWNER]** Внешний form backend, legal text и data retention согласованы.
- [ ] **FORM-002 [CONDITIONAL][AUTO]** Form имеет labels, keyboard order, validation, error summary, loading, success, retry и no-JS/fallback contact.
- [ ] **FORM-003 [CONDITIONAL][AUTO]** Honeypot и provider rate-limit/antispam протестированы.
- [ ] **FORM-004 [CONDITIONAL][AUTO]** Privacy page соответствует фактическим fields/backend; metadata больше не противоречит UI.
- [ ] **FORM-005 [CONDITIONAL][AUTO]** Не отправляются analytics events с персональными данными.

## 11. Вакансии

- [ ] **JOB-001 [AUTO]** Active/inactive job logic сохранена.
- [ ] **JOB-002 [MANUAL]** Public vacancy выводит title, city, employment, salary mode и short description.
- [ ] **JOB-003 [MANUAL]** Существующие responsibilities, requirements и conditions выведены без потери.
- [ ] **JOB-004 [MANUAL]** Есть реальный owner-approved response channel; benefits не выдуманы.
- [ ] **JOB-005 [MANUAL]** Empty state сохраняет settings fields.
- [ ] **JOB-006 [AUTO]** Vacancy route не удалён из navigation/footer/sitemap при active job.

## 12. Медиа и logo

- [ ] **MEDIA-001 [AUTO]** Все 331 baseline media paths присутствуют.
- [ ] **MEDIA-002 [AUTO]** SHA-256 hashes всех baseline media совпадают либо конкретная approved replacement documented; default criterion — 331/331 unchanged.
- [ ] **MEDIA-003 [AUTO]** Все 252 baseline local media refs разрешаются, missing=0.
- [ ] **MEDIA-004 [AUTO]** /uploads/media-1779034941013.mp4 сохранён и используется как desktop home hero.
- [ ] **MEDIA-005 [AUTO]** /uploads/hero-home-mobile.mp4 сохранён и используется как mobile home hero.
- [ ] **MEDIA-006 [AUTO]** /uploads/media-1779031688602.mp4 сохранён, даже если остаётся unreferenced.
- [ ] **MEDIA-007 [MANUAL]** Hero video имеет autoplay, muted, loop, playsinline и корректный object-fit/focal point.
- [ ] **MEDIA-008 [MANUAL]** prefers-reduced-motion показывает poster и не запускает playback/retry.
- [ ] **MEDIA-009 [AUTO]** Existing image/video names, URLs и source files не транскодированы/перемещены без approval.
- [ ] **MEDIA-010 [MANUAL]** Ни одно реальное photo не заменено stock/generated media.
- [ ] **MEDIA-011 [AUTO]** Original logo SVG files и geometry hashes совпадают с baseline.
- [ ] **MEDIA-012 [OWNER]** Дополнительные white/dark/accent logo variants, если нужны, согласованы отдельно и сохраняют geometry.

## 13. Responsive и accessibility

- [ ] **A11Y-001 [AUTO]** Автоматические accessibility checks не имеют новых critical/serious violations.
- [ ] **A11Y-002 [MANUAL]** Полный keyboard walkthrough выполнен на home, menu, category, product, object gallery, contacts и vacancy.
- [ ] **A11Y-003 [MANUAL]** Visible focus присутствует на всех interactive controls.
- [ ] **A11Y-004 [AUTO]** В DOM нет duplicate IDs, unlabeled controls, invalid nested interactive elements.
- [ ] **A11Y-005 [MANUAL]** Heading hierarchy логична на каждом template type.
- [ ] **A11Y-006 [MANUAL]** Text/background и button states проходят WCAG AA для используемых размеров.
- [ ] **A11Y-007 [MANUAL]** 200% zoom не скрывает content/actions.
- [ ] **A11Y-008 [MANUAL]** 320, 390, 768, 1024 и 1440 px не имеют horizontal overflow.
- [ ] **A11Y-009 [MANUAL]** Длинные русские titles не обрезаются в header, cards, buttons и galleries.
- [ ] **A11Y-010 [MANUAL]** Touch targets от 44×44 CSS px либо имеют эквивалентный доступный размер.
- [ ] **A11Y-011 [MANUAL]** Screen-reader names описывают icon-only controls.
- [ ] **A11Y-012 [MANUAL]** Content order остаётся логичным при one-column mobile reflow.
- [ ] **A11Y-013 [MANUAL]** Hero/header/CTA не перекрываются на 390×844 и при browser chrome changes.

## 14. Motion

- [ ] **MOTION-001 [MANUAL]** Header transition не вызывает layout shift.
- [ ] **MOTION-002 [AUTO]** Content остаётся видимым без JavaScript и при IntersectionObserver failure.
- [ ] **MOTION-003 [MANUAL]** Reveals не задерживают чтение/CTA и не используют постоянный blur.
- [ ] **MOTION-004 [MANUAL]** Hover state имеет focus/touch equivalent.
- [ ] **MOTION-005 [MANUAL]** Gallery transition не блокирует repeated input.
- [ ] **MOTION-006 [AUTO]** prefers-reduced-motion отключает hero playback, carousel autoplay, smooth scroll и nonessential transforms.
- [ ] **MOTION-007 [MANUAL]** Нет scroll-jacking, decorative parallax, heavy WebGL или multiple autoplay videos.
- [ ] **MOTION-008 [AUTO]** Animation не меняет semantic/SEO visibility content.

## 15. SEO

- [ ] **SEO-001 [AUTO]** Каждый canonical template имеет unique nonempty title и description либо зафиксированный content gap.
- [ ] **SEO-002 [AUTO]** Ни один active category не публикуется с placeholder description «Описание страницы.» перед final release.
- [ ] **SEO-003 [AUTO]** Canonical absolute, base-aware и self-referencing на canonical pages.
- [ ] **SEO-004 [AUTO]** Sitemap содержит только canonical indexable public URLs.
- [ ] **SEO-005 [AUTO]** Sitemap исключает admin, API, design-lab, 404, redirects и inactive entries.
- [ ] **SEO-006 [AUTO]** robots.txt сохраняет admin/API disallow и правильный sitemap URL.
- [ ] **SEO-007 [AUTO]** Legacy aliases отсутствуют в sitemap и redirect одним hop.
- [ ] **SEO-008 [AUTO]** 404 и design-lab имеют noindex.
- [ ] **SEO-009 [AUTO]** Breadcrumb visual и BreadcrumbList присутствуют на nested pages.
- [ ] **SEO-010 [AUTO]** OG/Twitter images разрешаются; project/service/category используют реальные media при наличии.
- [ ] **SEO-011 [AUTO]** Product/Service/Project/JobPosting schema содержит только существующие facts.
- [ ] **SEO-012 [AUTO]** Нет fake Offer, AggregateRating, Review, client или certificate data.
- [ ] **SEO-013 [CONDITIONAL][AUTO]** Filter/search states имеют заранее утверждённые canonical/index rules.
- [ ] **SEO-014 [AUTO]** Internal links не содержат broken/redirecting canonical references.

## 16. CMS и data integrity

- [ ] **CMS-001 [AUTO]** Сохранены 8 collections: product-sections, product-categories, products, services, projects, jobs, site-settings, static-pages.
- [ ] **CMS-002 [AUTO]** Counts не ниже baseline: 5 sections, 20 categories, 68 products, 2 services, 6 projects, 1 job, 4 static pages, 1 settings.
- [ ] **CMS-003 [AUTO]** navigation.json и yandex.json сохранены и проходят validation.
- [ ] **CMS-004 [AUTO]** CRUD валидирует Zod schema до write.
- [ ] **CMS-005 [AUTO]** CRUD валидирует parent/category/product relations до write.
- [ ] **CMS-006 [AUTO]** Admin save round-trip не удаляет неизвестные или неотредактированные fields.
- [ ] **CMS-007 [AUTO]** Presentation fields имеют один явный owner: code/tokens либо CMS; silent stripping отсутствует.
- [ ] **CMS-008 [AUTO]** Full-site, page и collection JSON export/import round-trip сохраняет all fields, order и media refs.
- [ ] **CMS-009 [AUTO]** Import preview/hash/rollback остаются рабочими.
- [ ] **CMS-010 [AUTO]** Image/video upload и project batch upload сохраняют format/path/dedupe behavior.
- [ ] **CMS-011 [AUTO]** Publish scope не удаляет public/uploads и не публикует design-lab как content.
- [ ] **CMS-012 [AUTO]** Full reserved-route set включает fixed public, admin, API, design-lab, robots и legacy aliases.
- [ ] **CMS-013 [AUTO]** Rename требует dependency graph, link update и permanent redirect; silent slug mutation запрещена.
- [ ] **CMS-014 [AUTO]** Job rich fields и project rich gallery fields доступны public renderer и admin без потери.
- [ ] **CMS-015 [AUTO]** Dormant FAQ/project-pages data не удалены без owner approval.
- [ ] **CMS-016 [AUTO]** Не добавлены required product↔project fields или hidden coupling.

## 17. Cookie, privacy и third-party

- [ ] **PRIV-001 [MANUAL]** Cookie UI честно описывает фактическое поведение analytics.
- [ ] **PRIV-002 [AUTO]** Если consent required, Metrika не загружается до соответствующего выбора.
- [ ] **PRIV-003 [MANUAL]** Footer «Настройки cookie» открывает реальное управление, а не только notice.
- [ ] **PRIV-004 [AUTO]** Отказ сохраняется и respected при следующем visit.
- [ ] **PRIV-005 [AUTO]** Map/rating third-party embeds не блокируют critical render и имеют privacy-aware loading.
- [ ] **PRIV-006 [CONDITIONAL][OWNER]** Privacy copy обновлена при forms, uploads или новых analytics events.

## 18. Performance

- [ ] **PERF-001 [AUTO]** Утверждён performance budget для LCP, CLS, INP и transferred media по representative templates.
- [ ] **PERF-002 [AUTO]** Hero poster/video не lazy-loaded способом, ломающим first screen.
- [ ] **PERF-003 [AUTO]** Below-fold images используют loading=lazy и responsive sizes/srcset там, где pipeline это поддерживает.
- [ ] **PERF-004 [AUTO]** First meaningful project/product image имеет правильный priority; thumbnails не загружаются eager.
- [ ] **PERF-005 [AUTO]** Third-party map/rating/analytics не входят в critical rendering path.
- [ ] **PERF-006 [AUTO]** Нет нескольких autoplay video на одной page.
- [ ] **PERF-007 [AUTO]** Reveal/motion не удерживают large offscreen media в expensive blur/compositing state.
- [ ] **PERF-008 [MANUAL]** Site usable на throttled mobile connection до загрузки optional media.

## 19. Visual-system gate

- [ ] **VIS-001 [OWNER]** Утверждена одна token palette после проверки current logo и полного media set.
- [ ] **VIS-002 [MANUAL]** Green A, oxide B и burgundy C не используются одновременно как равноправные accents.
- [ ] **VIS-003 [MANUAL]** Product pages светлые, регулярные и технически читаемые.
- [ ] **VIS-004 [MANUAL]** Home/objects cinematic, но CTA и facts не скрыты.
- [ ] **VIS-005 [MANUAL]** Services/construction/metals используют project/engineering hierarchy.
- [ ] **VIS-006 [MANUAL]** Contacts/vacancies остаются practical и не получают ненужный cinematic layer.
- [ ] **VIS-007 [MANUAL]** Buttons, links, forms, captions, lines, radii и states едины во всех modes.
- [ ] **VIS-008 [MANUAL]** Нет nested cards, чрезмерных shadows, decorative orbs/noise или механического alternating dark bands.
- [ ] **VIS-009 [MANUAL]** Реальные product/object media не тонируются так, чтобы менять цвет материалов.
- [ ] **VIS-010 [MANUAL]** Asymmetry используется для featured stories, а не ухудшает сравнение products.

## 20. Аудиторные walkthrough

- [ ] **AUD-001 [MANUAL]** Муниципальный заказчик проходит Home → направление → объект → расчёт без тупика.
- [ ] **AUD-002 [MANUAL]** Застройщик находит комплекс благоустройства, МАФ, навесы и ограждения.
- [ ] **AUD-003 [MANUAL]** Генподрядчик находит строительство, металлоконструкции, industrial case и CTA.
- [ ] **AUD-004 [MANUAL]** Архитектор находит category/product specs, materials/colors и custom route.
- [ ] **AUD-005 [MANUAL]** Коммерческий заказчик находит навесы/ограждения/custom и direct contact.
- [ ] **AUD-006 [MANUAL]** Промышленный заказчик видит здания/металлоконструкции без показа собственного производства.
- [ ] **AUD-007 [MANUAL]** Покупатель изделия находит category → product → price/specs → calculation.
- [ ] **AUD-008 [MANUAL]** Заказчик custom конструкции понимает, какие вводные прислать.
- [ ] **AUD-009 [MANUAL]** Кандидат находит vacancy, full conditions и response channel.

## 21. Финальный regression sign-off

- [ ] **SIGN-001 [AUTO]** Route diff приложен: removed canonical routes = 0, либо каждый approved redirect перечислен.
- [ ] **SIGN-002 [AUTO]** Content diff приложен: removed records/fields = 0.
- [ ] **SIGN-003 [AUTO]** Media diff приложен: removed/renamed files = 0; hashes verified.
- [ ] **SIGN-004 [AUTO]** Functional matrix приложена: 19/19 mechanisms сохранены или улучшены с evidence.
- [ ] **SIGN-005 [AUTO]** Admin import/export/CRUD/upload/publish tests пройдены.
- [ ] **SIGN-006 [AUTO]** SEO route/canonical/sitemap/structured-data tests пройдены.
- [ ] **SIGN-007 [MANUAL]** Desktop 1440 и mobile 390 screenshots проверены для каждого template mode, не только home.
- [ ] **SIGN-008 [MANUAL]** Нет horizontal overflow, overlapping header/CTA или unloaded critical media.
- [ ] **SIGN-009 [OWNER]** Владелец подтвердил no-production media classification, navigation и construction claims.
- [ ] **SIGN-010 [OWNER]** Владелец подтвердил, что семь направлений, vacancies, contacts и proof не сокращены.
- [ ] **SIGN-011 [AUTO]** Production deployment не запускается, пока любой mandatory checkbox остаётся незакрытым.

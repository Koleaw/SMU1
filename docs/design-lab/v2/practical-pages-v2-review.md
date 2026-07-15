# Практические страницы V2 — correction review

Дата проверки: 15 июля 2026 года.

## Контакты

Production `/kontakty/` выводит карту из `src/pages/kontakty.astro` по конфигурации `src/data/yandex.json`: это асинхронный Yandex Maps Constructor script с существующим `um=constructor:ca887405ce74342784b43229f8bdac691fceefd5cbebc53bc6209bca88dd8046`. Там же используется существующий rating badge. Координат, отдельного API key или нового SDK в репозитории нет.

V2 переиспользует эту же конфигурацию через тонкую обёртку `V2YandexMap.astro`. Production-компонент и production page не менялись. Конструктор загружается асинхронно, созданному iframe задаётся понятный title «Яндекс Карта: ул. Промышленная, 17, Курган», контейнер ограничивает overflow. В реальном Chromium iframe загрузился размером 853×300, сохранил встроенную ссылку «Открыть в Яндекс Картах» и показан на desktop/mobile screenshots. Новый сервис, API key, координаты или случайная ссылка не добавлялись.

Страница перестроена в компактную последовательность: intro → четыре способа связи → адрес и карта → «Что можно прислать» → реквизиты → CTA → Footer. Отдельная карточка «География работ» убрана только из вывода contacts; исходные данные не изменены. Desktop DOM имеет высоту 1865 px, full capture — 1945 px; сокращение получено отступами и компоновкой, без фиксированной высоты страницы.

Проверены `tel:+79129735006`, `tel:+79125799665`, `https://t.me/smu1build` и `mailto:smu1.kurgan@yandex.ru`: пустых href нет, touch target каждой карточки 104 px по высоте, focus видим. Основной телефон теперь белый на `rgb(40, 93, 71)`; измеренный контраст — 7,64:1. Hover/focus/visited используют тот же светлый foreground.

## О компании

H1 заменён на «Изделия, конструкции и работы под задачу объекта», eyebrow «О компании» сохранён. Описание продолжает использовать фактические формулировки record: изделия, металлоконструкции, благоустройство, подбор под площадку и сопровождение реализации.

Hero использует два существующих внешних кадра готовых объектов:

- `/uploads/img-20250724-134235-1783272745917.jpg` — внешний вид готового производственного здания;
- `/uploads/project-da0872c68d9a09f0a7d2f995.jpg` — готовая набережная реки Тобол.

На desktop это restrained split с основным и более узким дополнительным кадром; на mobile оба исходных кадра идут последовательно в пропорции 4:3. Внутренние помещения, производство, монтаж, люди, оборудование, stock и placeholders не используются.

Пустые изображения в блоке «Результат можно посмотреть в деталях» были capture-регрессией: валидные below-fold изображения имели lazy loading, а прежний full-page capture не прокручивал страницу и не ждал decode. Для двух project cards применён контролируемый eager, а QA capture последовательно прокручивает документ, ждёт `complete`/`decode()` и возвращается вверх. Оба изображения имеют `naturalWidth=4096`; normal scroll и full capture проверены.

## Вакансии и legal

Archive сохраняет data-driven фильтр active records и одну фактическую вакансию. Второй крупный H2 удалён; конец hero находится на 354 px, карточка начинается на 420 px, то есть неоправданного пустого экрана нет. Неактивные записи не выводятся.

Detail сохраняет без изменений город, занятость, оплату, обязанности, требования и условия. Hero уменьшен до 408 px, content начинается на 537 px. CTA использует только существующие email, основной телефон и Telegram; media не добавлено.

Юридический текст, дата, порядок разделов, реквизиты и контакты совпадают с production source. Desktop H1 ограничен 52 px, документная колонка расширена до 980 px; mobile-композиция сохранена. Автоматическое сравнение нормализованного текста вернуло полное совпадение, heading count — 16.

## QA и границы изменений

Один Chromium, один context и одна page проверили practical pages, Header/dropdown, MobileMenu, Footer, Breadcrumbs, CTA, contact/vacancy links, focus, console и responsive layout. Существующие object galleries проверены без визуальных изменений: `contain`, fullscreen, arrows, counter, Escape, focus trap, return focus, swipe и reduced motion прошли.

Итоговые screenshots: `company-{desktop,mobile,full}.png`, `contacts-{desktop,mobile,full}.png`, `vacancies-archive-{desktop,mobile}.png`, `vacancy-detail-{desktop,mobile}.png`, `legal-{desktop,mobile}.png` в этой папке.

Изменения ограничены design-lab V2 и `docs/design-lab/v2`. Production routes/templates/content records, schemas, `navigation.json`, site settings, admin/import/export, package/deployment и существующие media не менялись; media removed/renamed/copied: 0.

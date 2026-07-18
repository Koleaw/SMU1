# Противоречия в пилотной выборке

Противоречие означает зависимость решения от сценария, а не ошибку одного из сайтов.

| Вопрос | Подход 1 | Подход 2 | Решение для СМУ-1 | Что еще проверить |
|---|---|---|---|---|
| CTA в hero | Foster, mmcité и Skanska продают образом без прямой заявки | Linear держит Sign up, Vestre — quote-widget, хотя hero ведет к фильму | На home/услугах дать 1–2 коммерческих действия; на объекте CTA может быть ниже фактов | Формулировки и конверсия CTA по аудиториям |
| Desktop navigation | Foster скрывает все в hamburger | Остальные показывают основные маршруты | Видимые Каталог/Услуги/Объекты/Контакты + компактное More | Допустимое число пунктов при текущем дереве |
| Темная оболочка | Linear почти полностью темный; Foster темный home | Vestre/mmcité/Skanska держат functional pages светлыми | Светлая база, dark hero/production/trust bands | Контраст реальных фото металла на dark/light |
| Размер hero | Foster/Vestre/Skanska используют почти viewport | Projects Skanska и каталоги Vestre/mmcité сразу показывают controls/cards | Full hero только для имиджевой задачи; в каталоге показать выбор в первом viewport | A/B prototype на mobile и desktop |
| Card grid | Vestre/Skanska повторяют регулярные 3–4 columns | Foster/mmcité/Linear используют featured/asymmetric modules | Регулярная сетка для выбора, featured module только для важной истории/серии | Влияние mixed sizes на поиск товара |
| Information density | Product Vestre/mmcité очень длинный и детальный | Foster project и Linear Features дают меньше параметров в начале | Product specs сгруппировать, но критичное показать до fold/первого CTA | Какие поля реально заполнены для 68 товаров |
| Price visibility | Vestre скрывает цену за sign-in | СМУ-1 требует честное `от` или `по запросу`; mmcité тоже не делает цену опорой | Не вводить login; показывать `от`/`по запросу` и факторы цены | Правила публикации цен по категориям |
| Filters | Foster/Skanska применяют фасеты к сотням projects | Linear curated overview обходится без них; СМУ-1 имеет 4 опубликованных объекта | Простые tabs/tags для объектов сейчас; полноценные filters — после роста базы | Порог числа сущностей и частота пустых результатов |
| Breadcrumbs | Foster/Skanska/mmcité используют глубокую ориентацию | Linear не использует; Vestre reference detail ограничивается back-link | Breadcrumbs обязательны в каталоге, товаре, услуге и объекте | Длина русских цепочек на mobile |
| Product↔project | Vestre/mmcité связывают в обе стороны | Foster/Skanska связывают в основном project↔project | Ввести двусторонние связи в данных СМУ-1 | Кто и как будет поддерживать связи |
| Motion | Linear/Vestre используют много активных animations/reveal | mmcité/Skanska в capture выглядят преимущественно статично | Motion — усилитель hierarchy, не обязательное условие; reduced-motion обязателен | Performance budget и реальные low-end Android |
| Mobile overflow | Все используют horizontal sets в разной степени | Основная информация при этом остается вертикальной не везде; Linear обрезает wide grids | Horizontal только для related/recommendations с affordance | Usability-test с пятью аудиториями |
| Contact model | Linear разделяет self-service и sales; Vestre — quote/add project | Foster/Skanska делают контакт вторичным; mmcité предлагает adviser позже | Два маршрута: расчет/спецификация и консультация | Кто принимает каждый тип лида и SLA |
| Trust metrics | Skanska опирается на масштабные цифры; Foster — на архив/историю | Vestre/mmcité — на документацию, материалы и реальные применения | Использовать только доступные локальные факты, документы и объекты | Какие показатели можно публиковать и обновлять |

## Редкие решения

- Full desktop hamburger Foster — редкий прием и коммерчески рискованный для СМУ-1.
- Sticky product action bar Vestre — наиболее прямой инструмент продаж в выборке.
- Связь `products used in project` в обе стороны у Vestre/mmcité — редкая и особенно релевантная.
- Полностью dark product narrative Linear — визуально убедителен, но предметно далек от физического каталога.
- Grid/map toggle Vestre References полезен только при достаточной географии и данных.

## Неразрешенные противоречия

Пилот не определяет окончательно:

1. Нужен ли СМУ-1 video hero или достаточно сильной фотографии.
2. Следует ли показывать price range на card или только на detail.
3. Нужна ли архитекторам отдельная BIM/download зона на старте.
4. Какой объем project filters оправдан после добавления новых объектов.
5. Должна ли главная начинаться с сценарного выбора или одного доминирующего направления загрузки цеха.

Эти вопросы требуют данных СМУ-1, прототипа и участия человека, а не расширения референсной выборки само по себе.

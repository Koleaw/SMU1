# Skanska reference decisions — owner visual freeze

Дата фиксации: 2026-07-18
Статус: **FROZEN** — после этого документа дополнительное исследование не проводится.

## Research gate

Существующие материалы в `docs/design-lab/**`, итоговые art-direction документы и текущая реализация давали достаточный ответ на 8 из 10 вопросов. Не хватало измеримого понимания только по hero handoff и относительному движению text/media.

Проведена одна ограниченная проверка официальных страниц Skanska Home и Construction в Chromium. Новые компании не исследовались, чужие assets, HTML, CSS, тексты и изображения не скачивались и не копировались.

Ключевое наблюдение по scroll: hero остаётся в нормальном потоке и равен первому viewport; copy отстаёт от документа примерно на 20% прокрутки hero, media — примерно на 30%. Слои исчезают за границей clipping, а следующая секция движется естественно. Sticky lock и scroll-jacking отсутствуют.

## Решения

| Принцип | Наблюдение Skanska | Решение для СМУ-1 | Route/component | Acceptance |
|---|---|---|---|---|
| Иерархия текста | Один крупный statement задаёт смысл; lead является самостоятельным вторым уровнем; supporting copy заметно спокойнее; labels редки | Сохранить максимум четыре уровня: H1/H2, lead, body, редкий auxiliary label. Удалить подписи, которые повторяют соседний текст | Все public pages; hero, editorial sections, cards | Lead визуально является вторым смысловым уровнем; body не выглядит микротекстом; в секции не более двух auxiliary levels |
| Desktop text scale | В benchmark H1 около 98 px, крупные section titles около 78 px, lead около 26 px, body около 18 px | Использовать H1/H2 по длине в диапазоне 48–96 px, lead 22–30 px, body 17–18 px, labels не мельче 12–13 px | Home, Directions, Portal, Company, Projects | На 1440 px крупный statement доминирует без башен переносов; lead заметно крупнее body |
| Ширина текста | Крупные тексты получают широкие editorial columns, supporting copy не зажимается в узких карточках | Не размещать длинный desktop-текст в колонке уже 240 px; основные intro/lead держать примерно в диапазоне 520–760 px | All editorial and card layouts | Нет строк из фрагментов по 2–4 символа; проверочные длинные русские слова не ломают layout |
| Цветовая иерархия | White доминирует; насыщенный brand color используется как действие; navy/black появляются отдельными контрастными экранами | White — основная поверхность; royal blue — CTA и один сильный смысловой блок; navy/near-black — hero или финальное завершение; light blue только локальный акцент | Global tokens; Home, Catalog, Portal, Custom Order, final CTA | Нет двух крупных pale-blue секций подряд; royal-blue блок имеет white text; коммерческая страница не залита одним цветом |
| Отказ от pastel canvas | Светлые подложки не образуют длинную последовательность полноэкранных полотен; разделение строится композицией, whitespace и media | Убрать большие pale-blue page canvases и повторяющиеся steel sections; применять тонкие borders или локальный neutral только при функциональной необходимости | Catalog, Standard, Portal content, Projects, Company, Contacts, Vacancies | В полном скролле white остаётся доминирующей поверхностью; neutral не выглядит самостоятельной темой страницы |
| Hero first screen | Hero воспринимается законченным первым экраном; следующая секция не выглядывает при direct load | Major hero равен доступному viewport с учётом overlay header; локальная навигация начинается за границей hero | Home, Directions, Portal | На 1440×900 и 1920×1080 next-section visible pixels = 0; overlap header/content = 0 |
| Hero handoff | Hero находится в normal flow; next section подходит к его границе естественно и закрывает уходящие слои | Сохранить normal flow и `overflow: clip`; не использовать sticky lock. Copy получает небольшой поздний fade только как адаптацию под читаемость | Home hero, `ImmersiveDirectionHero`, Portal hero | На mid-scroll нет скачка, фиксации или пересечения Header; граница следующей секции движется линейно |
| Раздельное движение слоёв | Copy отстаёт примерно на 20%, media примерно на 30%; media движется чуть медленнее документа | Добавить отдельный media hook и CSS variable; copy lag ≈20% с cap ≈20% hero, media lag ≈30% с cap ≈30%; mobile/reduced-motion static | `PublicV2Layout`, Home, direction hero, premium hero | Media визуально отстаёт сильнее copy; render не растягивается; reduced-motion полностью статичен |
| Editorial rhythm | Крупный visual сменяется white editorial section, statement, supporting copy, proof и следующим действием | Уплотнить страницы в последовательности hero/visual → intro → offer/proof → next step; не создавать grids ради заполнения | Home, Directions, Projects, Company, Portal | Каждая крупная секция имеет ясную роль; обычная секция без большого контента не выше 1.1 viewport |
| Business streams | Направление получает собственный сильный hero, короткое объяснение, доказательства и связанный следующий шаг | Сохранить общие primitives, но различать направления media и составом proof; related directions сделать компактным завершением | Metalworks, Landscaping, Construction, Canopies, Topiary | Страница читается как конкретная услуга, а не копия каталога; related cards не доминируют над proof |
| Простота карточек | Иерархия достигается media, типографикой и пространством, а не множеством декоративных рамок | Сократить искусственные frames, пустые cells и shadows; карточка целиком кликабельна, hover строится на royal blue + white | Catalog/category/project/related cards | Нет декоративных стрелок; hover выглядит намеренным; card text не пересекается и не выходит за границы |
| Финальная композиция | Завершение страницы объединяет statement, контакты, навигацию и legal baseline; элементы остаются крупными | Адаптировать под SMU-1 как единый navy Final CTA + Footer, хотя у Skanska Footer светлый | `DirectionV2FinalCTA`, `HomeV2Footer` и аналоги | CTA + Footer ≤ desktop viewport; весь title, contacts, columns и legal row видны одновременно |
| Header contrast | Overlay navigation меняет контраст по visual context, не требует затемнения всего изображения | Белый logo/nav на dark/photo; royal-blue logo на светлом; active item остаётся различимым | Home, Directions, Portal, global Header | Logo/nav читаются без тяжёлого overlay; active state не blue-on-blue |
| Media discipline | Крупные visuals работают благодаря качеству и масштабу исходника; лишнее паспарту не используется | Isolated product render показывать через `contain` на совпадающем clean canvas; contextual photo через `cover`; не имитировать отсутствующую фотографию | Catalog, Standard, Portal, Canopies, Topiary | Нет полос, случайной тонировки, растяжения, пустого primary canvas или обрезанной конструкции |
| Что не переносим | Масштаб Skanska поддерживает международную навигацию, огромный portfolio, длинные истории и claims глобальной компании | Не копировать branding, палитру буквально, тексты, media, corporate claims, nav depth, 7–10k px страницы, сложные filters и структуру под отсутствующий контент | Весь SMU-1 | Контент остаётся правдивым для локальной производственной компании и существующих records; архитектура не расширена |

## Frozen implementation mapping

- Copy motion использует существующий `data-v2-hero-scroll-copy`; media получает `data-v2-hero-scroll-media`.
- Scroll-механика меняет wrapper, а не размеры/пропорции самого изображения.
- Единственный обязательный большой royal-blue content block на Portal — «Применение», на Custom Order — «Что можно прислать».
- Final CTA и Footer остаются одним navy-завершением по прямому требованию владельца, а не буквальной копией Skanska.
- Дополнительное исследование после этой точки запрещено; все последующие решения проверяются только на production routes SMU-1.

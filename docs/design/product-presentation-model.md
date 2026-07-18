# СМУ-1 — product presentation model

## 1. Назначение

Каждый продукт получает один из двух сценариев: `standard` или `premium`. Это не ценовой тариф и не автоматическая оценка качества. Поле определяет глубину digital-подачи. Решение принимает редактор по масштабу, конструктивной сложности и роли изделия в объекте.

## 2. Правило классификации

### STANDARD PRODUCT

Выбирать `standard`, если изделие является типовым либо адаптируемым, понятно по одному основному изображению и не требует отдельного пространственного narrative. Примеры: обычные лавочки и скамейки, урны, вазоны, велопарковки, фонари, отдельные малые элементы.

Standard остаётся default даже при высокой цене, красивом рендере или возможности выбрать RAL. Наличие нескольких параметров само по себе не делает изделие инженерным решением.

### PREMIUM PRODUCT / ENGINEERING SOLUTION

Выбирать `premium`, только если выполняются минимум два содержательных критерия:

1. изделие формирует пространство или заметно влияет на объект;
2. есть конструктивная/монтажная/модульная вариативность под площадку;
3. нужны сценарии применения, комплектация или варианты исполнения;
4. масштабу продукта полезны контекстные и детальные изображения;
5. продажа происходит как обсуждение решения, а не выбор одной модели.

Очевидные кандидаты в текущем каталоге: `kachel-portal`, `kacheli-pergola`, `kacheli-s-dlinnym-navesom`, `pergola-lamel`, `pergola-s-lavkoy`, `naves-galereya`, беседки и большая скамья «Амплитуда». Начальная разметка должна быть консервативной: записи без достаточного контента остаются standard до редакторского подтверждения.

## 3. Шаблон STANDARD

Порядок блоков:

1. breadcrumbs;
2. compact product first screen: media/gallery слева, category + H1 + lead + price + 3–5 facts + CTA справа;
3. локальная навигация только по реально существующим блокам;
4. короткое описание;
5. характеристики, материалы, покрытие и изменяемые параметры;
6. доставка, если заполнена;
7. related products/categories;
8. единый direct contact + footer.

Ограничения:

- не создавать narrative-разделы из пустых данных;
- один основной H2 на смысловой блок;
- не растягивать first screen сверх необходимого;
- gallery поддерживает 0/1/N media и корректный fallback;
- CTA: «Запросить расчёт», вторичный — Telegram.

## 4. Шаблон PREMIUM

Порядок блоков:

1. breadcrumbs поверх/перед hero;
2. editorial hero: label «Инженерное решение», крупный H1, lead, стоимость/режим расчёта, CTA и доминирующее media;
3. sticky section nav;
4. «Что это за решение» — description;
5. «Где применяется» — application items;
6. spatial/rich gallery с контекстом и деталями;
7. «Что адаптируем под объект» — customization;
8. «Варианты исполнения» — variants;
9. материалы / конструктив / покрытие / размеры;
10. delivery/project workflow, если данные заполнены;
11. related solutions;
12. статусный CTA «Обсудить решение для объекта» + footer.

Premium-шаблон остаётся строгим: максимум один выразительный приём на экран, без mask typography, горизонтального скролл-театра и декоративных счётчиков. Отсутствующий optional block не рендерится.

## 5. Content contract

Общее обязательное поле:

```ts
presentationType: 'standard' | 'premium'
```

Существующие поля переиспользуются без переименования:

- `leadText` — hero lead;
- `description` — «что это за продукт/решение»;
- `features` — короткие факты first screen;
- `customizationItems` — изменяемые параметры;
- `materials`, `colors`, `dimensions` — technical system;
- `gallery` — дополнительные изображения;
- `deliveryText` — получение/монтаж/доставка;
- `relatedProductSlugs` — related block.

Для premium добавляются только optional поля, чтобы не ломать старые записи:

```ts
applicationItems?: string[]
executionVariants?: string[]
solutionKicker?: string
```

Если optional premium-поля пусты, блок не показывается; шаблон не генерирует маркетинговый текст автоматически. Standard ignores эти поля в расширенной форме, но данные сохраняются при переключении туда и обратно.

## 6. Rendering и fallback

- `presentationType === 'premium'` → premium component;
- любое другое/отсутствующее значение → standard component;
- URL, canonical, product route и related selection не зависят от presentation type;
- переключение не удаляет поля и media;
- на card/list уровне выводится небольшой нейтральный label «Решение для объекта» только для premium; standard не получает видимой статусной метки, а visual rank сетки не меняется. Контракт размечен `data-product-card-presentation="standard|premium"` и `data-product-presentation-indicator="premium"`.

## 7. Начальная классификация

Premium при первом внедрении:

- `kachel-portal`;
- `kacheli-pergola`;
- `kacheli-s-dlinnym-navesom`;
- `pergola-lamel`;
- `pergola-s-lavkoy`;
- `naves-galereya`;
- `besedka-kub`;
- `besedka-kofe`;
- `bolshaya-skameyka-amplituda`.

Все остальные существующие товары — standard. `naves-terra`, контейнерные площадки и экран с навесом остаются standard до появления достаточной объектной фактуры; редактор может изменить тип позднее.

## 8. Acceptance

- простая скамья и урна дают компактную страницу без premium narrative;
- «Качель Портал» визуально и структурно воспринимается как объектное решение;
- оба шаблона работают с 0, 1 и несколькими media;
- пустые optional секции отсутствуют в DOM;
- переключение в CMS меняет шаблон после сохранения/build и не меняет URL.

## 9. Фактическая реализация и evidence

- Все 68 product records имеют явное поле: 59 `standard`, 9 `premium`.
- `CatalogProductV2.astro` выбирает variant только по нормализованному `presentationType`; отсутствующее или неизвестное значение безопасно ведёт в Standard.
- `CatalogStandardProductV2.astro` реализует компактный media/summary/price/key-points/spec/options/CTA/related сценарий без `data-premium-product-section`.
- `CatalogPremiumProductV2.astro` реализует отдельный editorial hero, solution, application, spatial gallery, adaptation, execution variants, technical system, delivery и усиленный final CTA. Optional блок не рендерится без подтверждённых данных.
- Representative Standard: `/ulichnaya-mebel/lavochki-i-skameyki/skamya-smu1-bazovaya/`.
- Representative Premium: `/ulichnaya-mebel/kacheli/kachel-portal/`.
- Listing cards показывают «Решение для объекта» только для premium; compiled HTML audit не обнаружил ни одной ложной standard-метки.
- Static QA подтвердил rendered split 59/9, template markers и listing contract; focused browser QA подтвердил Standard, Portal и listing на desktop/mobile.
- Свежие доказательства: `product-standard-bench-desktop.png`, `product-standard-bench-mobile.png`, `product-premium-portal-desktop.png`, `product-premium-portal-mobile.png`. Portal P0 после исправления повторно просмотрен и принят.

Schema/API/export доказательства переключателя приведены в `cms-product-presentation-switch.md`. Дополнительно `npm run qa:admin-browser` проходит 29/29: visual admin переключает representative Standard в Premium, показывает и сохраняет premium fields, восстанавливает их после reload, импортирует Standard без удаления premium data и затем возвращает скачанный Premium через UI export/import round-trip. Invalid presentation type блокируется и в UI, и в API без записи.

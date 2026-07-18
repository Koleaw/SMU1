# СМУ-1 — CMS switch типа продуктовой подачи

## 1. Поле

В коллекцию `products` добавляется поле:

```json
"presentationType": "standard"
```

Допустимые значения:

- `standard` — стандартная карточка изделия;
- `premium` — расширенная подача инженерного/пространственного решения.

Имя `presentationType` описывает именно способ подачи и не смешивается с ценой, качеством, SKU или категорией.

## 2. Schema и совместимость

В `src/content-schemas.mjs` поле задаётся как enum с default:

```ts
presentationType: z.enum(['standard', 'premium']).default('standard')
```

Это позволяет читать старые product JSON без поля как standard. При сохранении через CMS значение записывается явно. Новые записи создаются с `presentationType: 'standard'`. Generic content-import старой записи остаётся совместимым через schema default. Специализированный product bulk-import имеет более строгий envelope-контракт, описанный ниже: старый `catalog_export` без `productImport` намеренно не применяется как потенциально неполный импорт.

Optional premium-поля (`applicationItems`, `executionVariants`, `solutionKicker`) принимаются схемой, но не обязательны. Переключение типа не удаляет их.

### 2.1. Write boundary

POST и PUT коллекции `products` проходят `validateProductContentForWrite()` из `tools/admin-api/product-presentation.mjs` до любой записи на диск. Проверка использует ту же `contentSchemas.products`, что Astro content layer.

- missing `presentationType` материализуется как `standard`;
- `standard` и `premium` сохраняются;
- иное значение возвращает HTTP 400, `code: "PRODUCT_SCHEMA_VALIDATION_FAILED"` и массив `validationIssues`;
- при ошибке исходный JSON не изменяется;
- остальные admin collections не получили несвязанного schema-refactor.

### 2.2. Export/import contract

Существующий `catalog_export` v1 сохраняет raw `productCategories`, `products` и `catalogPages`. Аддитивно в него включается:

```json
{
  "productImport": {
    "type": "products_import",
    "version": 1,
    "items": []
  }
}
```

Importer принимает standalone `products_import` либо `catalog_export` с совместимым вложенным `productImport`. Projection переносит `presentationType`, `solutionKicker`, `applicationItems`, `executionVariants`, изображения, specifications, advantages, customization, delivery/custom-project flags, цену, visibility и SEO-поля. Старый `catalog_export` без nested payload отклоняется с сообщением о необходимости скачать новый экспорт; это предотвращает молчаливый lossy import.

## 3. Admin UI

В visual editor продукта в секции «Основное» добавляется select:

- label: «Тип подачи»;
- `standard`: «Стандартный товар»;
- `premium`: «Премиум / инженерное решение»;
- hint: «Premium выбирайте только для пространственно или конструктивно значимых решений. Обычные лавки, урны и типовые изделия оставляйте standard».

При premium ниже показываются редакторы «Где применяется», «Варианты исполнения» и «Короткая метка решения». При standard они скрываются из friendly UI, но данные остаются в draft. Technical editor также показывает `presentationType` рядом с основными product fields.

В create form нового продукта default всегда standard. Отдельный badge в admin list не добавлялся: тип меняется только явным действием в editor, bulk-редактор его самопроизвольно не повышает.

## 4. Rendering

Product route остаётся прежним и передаёт одну запись в presentation selector:

```ts
const presentationType = product.presentationType === 'premium' ? 'premium' : 'standard';
```

- premium → `CatalogPremiumProductV2`;
- standard/fallback → `CatalogStandardProductV2`;
- SEO, canonical, breadcrumbs, related product selection и URL общие;
- данные не дублируются между шаблонами.

## 5. Использование редактором

1. Открыть «Админка → Продукция → нужная модель».
2. В поле «Тип подачи» выбрать standard или premium.
3. Для premium заполнить описание решения, применения, варианты, адаптацию и media настолько, насколько есть фактура.
4. Сохранить и открыть preview/public URL.
5. Если premium-страница выглядит пустой, вернуть standard либо сначала дополнить контент; не заполнять секции вымышленными фактами.

## 6. Миграция существующих данных

Миграция аддитивная:

- всем текущим JSON записывается явное `presentationType`;
- девять подтверждённых пространственных решений получают `premium` согласно `product-presentation-model.md`;
- остальные получают `standard`;
- URL, slug, category binding, order, price и media не меняются.

## 7. Проверки

Фактически подтверждено на 18 июля 2026 года:

- schema принимает legacy record без поля как standard, принимает оба enum и отвергает иные;
- изолированный API create материализует standard и записывает его в JSON;
- API update сохраняет premium и три optional presentation fields;
- invalid enum возвращает 400 и оставляет файл byte-for-byte неизменным;
- export формирует raw catalog payload и вложенный импортируемый `productImport`;
- projection → reconstruction round-trip сохраняет `presentationType` и optional premium fields вместе с поддерживаемыми товарными данными;
- visual editor содержит human-readable select, условные premium editors и сохраняет скрытые premium values в draft; technical editor содержит тот же enum control;
- build рендерит 59 Standard и 9 Premium на стабильных URL;
- `npm run test:admin-import`: 22/22 pass;
- `npm run qa:admin-browser`: 29/29 pass;
- final static QA: 38/38; focused public product browser QA: 17/17.

### 7.1. Browser-admin round-trip

`npm run qa:admin-browser` запускает одну Chromium instance против изолированной копии content во внешней временной директории на D:. Реальный visual editor подтверждает:

- загрузку существующего Standard и скрытые premium editors;
- переключение Standard → Premium и появление полей;
- заполнение `solutionKicker`, `applicationItems`, `executionVariants`, save и reload;
- скачивание `catalog_export` через UI и наличие presentation fields в raw product и `productImport`;
- UI import Standard с сохранением ранее заполненных premium fields;
- повторный reload в Standard без premium panels;
- импорт скачанного Premium через UI, сохранение и reload полного premium state;
- invalid enum блокируется preview/apply в UI без content write;
- invalid direct API update возвращает 400/`PRODUCT_SCHEMA_VALIDATION_FAILED` без изменения файла;
- runtime console errors: 0.

Safety contract также прошёл: один publish POST намеренно перехвачен локальным proxy и не forwarded; production content hash, git HEAD и git index остались неизменными; sandbox восстановлен, внешняя D:-temp директория удалена. Итог — 29/29.

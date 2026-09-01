# H6: route passport и полный action crawl

Этот контур не использует «покрыто по аналогии». Источник ожидаемой топологии — активные записи `src/content/**` и тот же `createV2RouteRegistry`, который строит индекс production-маршрутов. Источник фактически выпущенных URL — каждый HTML-файл чистой `dist`, за исключением `admin/**` и `design-lab/**`. Любой missing/unexpected URL останавливает browser crawl до открытия страниц.

Текущая source-модель содержит 111 production URL:

- 107 canonical;
- 3 compatibility aliases;
- `/404.html`;
- 68 product detail (59 standard, 9 premium; 3 standard без публичных фото);
- 20 categories: 11 product-list, 6 gallery-only через реальный media resolver, 2 text-only, 1 mixed;
- 4 опубликованных project detail и один archive;
- отдельные Home, catalog hubs, специализированные направления, Company, Contacts, vacancies archive/detail, Custom Order и Privacy.

Число 111 не зашито в browser runner как способ «пройти» тест: unit contract одновременно фиксирует принятую топологию, а runtime сначала сравнивает полный список ожидаемых URL со свежей `dist`. Если контент законно добавит маршрут, source model и runtime manifest изменятся вместе, а unit test потребует осознанно обновить принятое route-count evidence.

## Обязательный порядок запуска

1. В чистом clone exact final SHA выполнить dependency install, media prepare и production build с нужным `BASE_PATH`.
2. Запустить unit contracts, включая read-only server/base-path и browser safety contract:

   ```powershell
   node --test tools/qa/*.test.mjs
   ```

3. Запустить route passport. Для полного H6 binding evidence рядом должен работать local-only editor render server с `SMU1_LOCAL_ADMIN=true`:

   ```powershell
   node tools/qa/route-passport-browser.mjs `
     --editor-origin=http://127.0.0.1:<random-ui-port> `
     --require-editor-coverage `
     --output=.admin-runtime/h6-qa/route-passport.json
   ```

4. Запустить public action crawl:

   ```powershell
   node tools/qa/public-action-crawl.mjs `
     --output=.admin-runtime/h6-qa/public-action-crawl.json
   ```

   Полный crawl можно безопасно разделить между 2–16 независимыми loopback Chromium workers. Например, четыре команды ниже запускаются в четырёх терминалах из одного clean clone и одной неизменяемой `dist`:

   ```powershell
   node tools/qa/public-action-crawl.mjs --shard=1/4
   node tools/qa/public-action-crawl.mjs --shard=2/4
   node tools/qa/public-action-crawl.mjs --shard=3/4
   node tools/qa/public-action-crawl.mjs --shard=4/4
   ```

   После завершения всех workers отчёты объединяются отдельным fail-closed шагом:

   ```powershell
   node tools/qa/public-action-shards.mjs `
     --input=.admin-runtime/h6-qa/public-action-crawl-shard-1-of-4.json `
     --input=.admin-runtime/h6-qa/public-action-crawl-shard-2-of-4.json `
     --input=.admin-runtime/h6-qa/public-action-crawl-shard-3-of-4.json `
     --input=.admin-runtime/h6-qa/public-action-crawl-shard-4-of-4.json `
     --output=.admin-runtime/h6-qa/public-action-crawl.json
   ```

   Это не «покрытие по аналогии»: одиночный shard всегда имеет `concreteCoverage=false`. Merger требует точную детерминированную partition всех 111 URL, ровно 222 уникальные route/viewport пары, 111 no-JS результатов и обе viewport-проверки настоящего unknown URL. Он отвергает пропуск, дубликат, `--route` filter, несовпадающие SHA/branch/build fingerprints или неполный набор indexes. Unknown URL и его no-JS probe принадлежат только shard 1.

5. Запустить admin action crawl против synthetic local session. Значения логина/пароля передаются только через environment, не пишутся в URL, отчёт или localStorage:

   ```powershell
   $env:H6_QA_ADMIN_ORIGIN = 'http://127.0.0.1:<random-ui-port>'
   $env:H6_QA_ADMIN_USERNAME = '<synthetic-profile>'
   $env:H6_QA_ADMIN_PASSWORD = '<synthetic-password>'
   node tools/qa/admin-action-crawl.mjs `
     --output=.admin-runtime/h6-qa/admin-action-crawl.json
   ```

   `--isolated-mutations` разрешён только в disposable clone с отдельным writable content root и перехваченным publish namespace. Runner требует подписанный fixture-файл `--isolation-proof=<json>`: его root и origin обязаны совпасть с текущим disposable checkout/server, `sourceWritesDisposable=true`, `publishIntercepted=true`, nonce имеет не менее 24 символов. Publish/release controls runner никогда не исполняет: их проверяет отдельный isolated admin round-trip, где `/api/admin/publish/**` гарантированно перехвачен. На общей рабочей копии Save, Undo/Redo, delete, upload, import и restore только регистрируются как `requires-isolated-fixture`.

6. Проверить структурную полноту доказательств:

   ```powershell
   node tools/qa/verify-h6-evidence.mjs `
     --passport=.admin-runtime/h6-qa/route-passport.json `
     --public-actions=.admin-runtime/h6-qa/public-action-crawl.json `
     --admin-actions=.admin-runtime/h6-qa/admin-action-crawl.json
   ```

   Verifier по умолчанию требует и полный editor-binding pass, и executed isolated admin mutation/file fixtures. Только для разработки самих runner доступны явно ослабляющие флаги `--allow-missing-editor-coverage` и `--allow-deferred-admin-actions`; такой результат не является H6 release evidence. Verifier не доверяет записанной в JSON identity: он повторно читает текущие HEAD/branch/dirty state и SHA-256 каждого файла текущей `dist`.

   `.admin-runtime` намеренно ignored: сам запуск evidence не превращает clean clone в dirty checkout. Поле `evidence.dirty` вычисляется с точными Git pathspec-исключениями только для generated `dist/**`, `.astro/**` и `.admin-runtime/**`; любое изменение в `src`, `public`, `tools`, `tests`, `docs`, workflow или package-файлах остаётся source-dirty и блокирует release evidence. Если JSON нужно приложить к release, его архивируют только после проверки либо во внешнее evidence-хранилище, не меняя identity уже проверенного SHA.

## Что содержит route passport

Для каждого конкретного URL отдельно записываются два обязательных результата: `desktop-1440x900` и `mobile-390x844`. Каждый результат содержит:

- requested/final URL, canonical/alias/404, HTTP document responses и robots;
- renderer family, ожидаемый и фактически reconciled variant;
- единственный H1;
- все semantic sections и их visible state;
- все `img`, `source`, `video`, CSS background media, galleries и controls;
- все links/buttons/inputs/details/media controls и их состояния;
- schema/template owners, ожидаемые editor tools и фактические admin-only bindings;
- occurrence-level coverage каждого видимого бизнес-текста и media occurrence: валидный binding либо явная admin-only классификация non-direct content;
- console/runtime/network errors;
- horizontal overflow и конкретные offenders;
- browser decode failures и отдельный HEAD-check каждого same-origin media URL;
- полный список реально загруженных public assets и попытки загрузить admin/editor asset;
- для project detail — public gallery size плюс archive cover orientation и media-first/media-last, считанные с настоящего archive renderer.

Aggregate отдельно считает actual renderer families/variants по 111 конкретным URL (не удваивая desktop/mobile), поэтому итоговый отчёт может привести доказуемую variant coverage, а не список вручную выбранных representative pages.

`/404.html` входит в обычные 111 routes. Настоящий неизвестный URL `/__h6-route-passport-unknown__/` дополнительно открывается в обоих viewport и обязан вернуть HTTP 404, один H1 и `noindex`.

Production DOM обязан содержать ноль `data-smu1-binding`. Binding registry собирается отдельным открытием того же route в explicit local editor render mode; каждый registry record дополняется фактическим `domTarget` (tag/id/`data-smu1-binding-id`), а не повторным сырым JSON.parse. Затем runner сравнивает public/editor H1, стабильный business text, media paths, renderer identity и geometry semantic landmarks. Production-only entry/transition clone, entry skip-link и runtime cookie banner не маскируются: они отдельно перечислены в `equivalence.normalization.publicRuntimeSurfaces`, но исключены из content parity, потому что editor canvas намеренно не запускает эти runtime surfaces. Geometry сравнивает H1/semantic sections/Footer и ширину main frame, а не суммарную высоту документа или scroll-state Header; изменение размера реального content landmark больше 1 px остаётся ошибкой. Это доказывает одновременно editor coverage, production-renderer parity и отсутствие layout-changing wrappers без ложного приравнивания fixed runtime overlay к бизнес-контенту.

Isolation проверяется не только в DOM. Runner считает SHA-256 и размер каждого файла всего immutable artifact, а затем сканирует все text assets и inert `/admin` HTML на binding/disposition metadata, editor flags, local API/CSRF client, активный login/shell, bridge/bundle и admin source maps. `/admin`-совместимость допустима только как `noindex` inert instruction page без password form и active script bundle.

Strict binding contract требует у каждого binding: `route`, `renderer.family/version`, owner collection/slug, `fieldPath`, stable item ID, scope, projection/fallback, tool, affected routes, permissions, validation и текущую draft revision. Видимый occurrence без прямого binding допустим только при admin-only атрибутах `data-smu1-editor-disposition`, `data-smu1-editor-reason` и `data-smu1-editor-source`. Это позволяет честно обозначить computed/template-fixed/contextual значение; пустая причина или route-level «покрыто в целом» не проходят. Ни binding, ни disposition metadata не могут попасть в public DOM.

Coverage fail-closed: для каждого non-alias route и настоящего unknown URL strict evidence требует `editor.status=covered`, ноль invalid binding records, ноль повторяющихся `bindingId` в одном DOM, ноль ambiguous/unclassified visible text occurrences, ноль ambiguous/unclassified visible media occurrences, полный набор ожидаемых tools и `equivalence.status=pass`. Runner пишет отдельные человеческие issue codes (`invalid-editor-bindings`, `duplicate-editor-binding-ids`, `unclassified-editor-occurrences`, `unclassified-editor-media`, `missing-editor-tools`, `editor-production-mismatch`), поэтому общий `editor-coverage:uncovered|invalid` не скрывает конкретный пробел.

## Что содержит action crawl

Public runner снова открывает каждый конкретный URL в обоих viewport, инвентаризирует каждый control и:

- исполняет каждый видимый безопасный UI button отдельно click и Enter;
- реально переходит по каждому видимому внутреннему link отдельно click и Enter, сверяет exact final canonical route, H1 и hash anchor, затем восстанавливает исходную страницу;
- повторяет discovery несколькими волнами: раскрытый menu/dialog/lightbox даёт новый concrete registry, поэтому вложенные controls не считаются покрытыми только потому, что были скрыты в initial DOM;
- фиксирует focus, before/after state, requests, server/runtime errors;
- требует наблюдаемый postcondition у безопасного control (expanded/pressed/dialog/details/media/current image/status/scroll/iframe), а не только отсутствие exception;
- связывает каждый internal link с конкретным URL, уже открытым passport/action crawl;
- проверяет cross-page anchors по ID index каждого конкретного emitted HTML; click/Enter дополнительно проверяют фактические final URL, hash и target H1 в Chromium, поэтому шардирование не ослабляет link evidence;
- валидирует `tel:`/`mailto:` синтаксически, но не запускает внешнее приложение;
- не запускает внешние URL;
- не отправляет формы, лиды или analytics;
- повторно открывает каждый route с JavaScript disabled и проверяет document status, exact route/canonical identity, H1, навигацию, overflow и отсутствие runtime/network errors;
- отдельно повторяет полный action registry для настоящего unknown URL в обоих viewport и его no-JS 404 probe.

Chromium CDP-level safety перехватывает до отправки все non-GET/HEAD/OPTIONS запросы и известные analytics/form endpoints. Если UI всё же попытался отправить lead/analytics или изменить состояние, это не только блокируется, но и делает evidence красным. Встроенный static server обслуживает только configured `BASE_PATH`, отвергает path escape и отвечает `405` на state-changing methods.

Admin runner собирает controls как из shell, так и из same-origin production iframe, выполняет безопасные navigation/drawer/viewport controls и выдаёт честные отдельные policies для hidden, disabled, file-fixture, isolated-mutation и release-intercept states.

До общего registry crawl он отдельно доказывает ключевой navigator flow: page picker search открывает «Контакты» настоящим mouse click, затем Privacy настоящим Enter и возвращает canvas на Home. Затем через настоящий navigator search он отдельно открывает все 111 authoritative URL. Для каждого concrete URL проверяются expected canonical/alias identity, один H1, bindings/overlay targets, открытие contextual tool кликом по overlay и закрытие Escape; aliases обязаны открыть canonical canvas и не считаются второй editable page. Отдельно navigator tree обязан содержать exact 111 routes без missing/unexpected.

Неизвестная admin-кнопка по умолчанию считается mutation и не исполняется в общей копии; безопасными считаются только явные shell/navigation/overlay controls. Интеракции внутри production iframe отмечаются как уже покрытые public action crawl, чтобы admin runner не запускал второй опасный путь через публичные ссылки.

## Связь с остальным test DAG

Эти инструменты не дублируют H5 performance/media gates, H2 motion/lifecycle gate, transaction fault injection или deploy isolation. Финальный DAG должен запускать каждый дорогой suite один раз в таком порядке:

```text
unit/source contracts
  -> clean media:prepare + Astro build
     -> deterministic H5 performance + static/deploy isolation (parallel)
     -> route passport
        -> public action/no-JS crawl
     -> isolated admin round-trip + admin action crawl (parallel)
        -> evidence contract
           -> candidate deploy
              -> provider URL + exact deployed SHA/artifact identity/live smoke
```

Save-time exact validation не должен запускать этот all-route crawl. Полный passport/action crawl — release gate перед test/final release.

Final verifier заново строит authoritative source route list, требует точные 222 concrete route/viewport pair, два отдельных unknown-URL probe, одинаковый source SHA/branch, SHA-256 fingerprint всех 111 production HTML и отдельный fingerprint всего artifact между passport и public action crawl. Он также сверяет оба fingerprint с файлами текущей `dist`, поэтому отчёты от прошлой сборки, разных сборок или неполный `--route` smoke нельзя случайно объединить в зелёное evidence.

## Ограничения, которые нельзя скрывать

- Browser runner использует установленный Chromium/Chrome через CDP; при отсутствии Chrome требуется `CHROME_PATH`.
- System file picker, реальное внешнее contact application и реальная lead delivery намеренно не автоматизируются.
- Public map activation разрешён как UI action, но analytics/form endpoints блокируются. Ошибка внешнего map provider остаётся в network evidence, а не маскируется.
- Полный binding pass возможен только при explicit local admin flag. Production artifact никогда не включается в этот режим.
- Generated JSON из грязной рабочей копии допустим только для разработки runner. Release evidence принимается исключительно из clean clone exact SHA; поле `evidence.dirty` позволяет это проверить в итоговом отчёте.
- `dist` должна быть результатом clean build после последнего source/public/package input. По умолчанию runner останавливается до браузера, если хотя бы один production HTML старше входов. `--allow-stale-dist` существует только для диагностики runner и verifier всегда отвергает такое evidence.

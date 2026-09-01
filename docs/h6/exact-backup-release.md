# H6: exact-проверка, резервные копии и release boundary

Этот документ описывает серверный контур локального визуального редактора. Он не объединяет `Save` и публикацию.

## После нажатия «Сохранить»

1. Content transaction атомарно фиксируется на компьютере и сразу возвращает успешный ответ UI.
2. Отдельная backup-очередь получает идентификатор committed transaction. Ошибка backup не откатывает Save.
3. UI отдельно вызывает `POST /api/admin/validation/request` с `transactionId`.
4. Exact service создаёт immutable snapshot: Git `source SHA` плюс точные content/media-дельты, schema hash и H5 pipeline hash.

Текущий H6 target — GitHub Pages. Его URL изменяемый: следующая тестовая публикация обновляет содержимое по тому же адресу. Интерфейс не называет такую ссылку immutable и показывает это ограничение рядом с URL. Неизменяемыми и проверяемыми остаются snapshot, artifact manifest, deployed SHA и release evidence; статус готовности появляется только после их побайтовой сверки и live smoke. Выдача отдельного immutable deployment URL остаётся обязательным критерием trial/выбора hosting adapter в H7.
5. В фоне `npm run build:exact` запускает тот же production SSG, но его prerenderer получает server-derived affected-route closure immutable snapshot и выдаёт HTML только для затронутых routes (для удалённого route — canonical `404.html`). Общая Vite/Astro compile-фаза и проверенный H5 cache переиспользуются; это не full all-route gate. Результат связывается с revision и содержит SHA-256 artifact manifest, число/размер файлов, largest file, точный selected route set и проверки affected routes.
6. `POST /api/admin/publish/preview-plan` повторно проверяет exact evidence на сервере. Состояние кнопки в браузере не является trust boundary.

Exact queue допускает не более одной активной сборки и одной последней ожидающей. Промежуточная ожидающая revision получает `superseded`; результат активной сборки получает `stale`, если за время работы появилась новая revision. Failed/stale result никогда не открывает preview gate.

API:

- `POST /api/admin/validation/request` — поставить committed transaction в очередь или повторить failed run;
- `GET /api/admin/validation/runs/:runId` — статус конкретной проверки;
- `GET /api/admin/validation/status` — текущая проверка и ограниченная история;
- `POST /api/admin/publish/preview-plan` — существующий двухшаговый preview flow, теперь с обязательным current exact gate.

Обычный Save не запускает build внутри своего запроса и не ждёт сеть/GitHub.

## ReleaseControl и HostingAdapter

`tools/admin-api/release-control.mjs` задаёт provider-neutral boundary:

- `ReleaseControl.requestPreview(sourceRevision)` принимает только server-verified artifact;
- `ReleaseControl.getStatus(runId)` и `getPreviewEvidence(runId)` возвращают deployment evidence;
- `requestProduction()` и `rollback()` в H6 всегда отвечают `403 H6_PRODUCTION_DISABLED`;
- HostingAdapter имеет методы `deployPreview`, `stageProduction`, `promote`, `rollback`, `verify`.

Текущий H6 adapter использует существующий candidate/preview publish service. Production credentials и production endpoint отсутствуют. В H7 adapter может быть заменён без переноса hosting credentials в браузер или source model.

## Автоматические резервные копии

По умолчанию backup root создаётся рядом с repository как `<repository>-backups`. Рекомендуется указать другой физический диск или синхронизируемый приватный каталог:

```dotenv
ADMIN_BACKUP_DIR=D:/SMU1-private-backups
ADMIN_BACKUP_RETENTION=20
ADMIN_BACKUP_MAX_BYTES=21474836480
```

Backup root обязан быть отдельным от repository. Symlink/junction, path traversal и неизвестные manifest paths запрещены. В backup входят:

- `src/content/**/*.json`;
- `src/data/**/*.json`;
- originals из `public/uploads`;
- brand/icons/images/video из разрешённых public media roots.

Производные `public/_media/h5` не копируются: они воспроизводимы из originals через pinned H5 pipeline.

Файлы хранятся content-addressed по SHA-256. Поэтому каждый Save получает отдельный manifest/history point, но неизменившиеся фотографии физически не дублируются. Перед новым blob проверяются quota и свободное место. Retention удаляет старые manifests и более не используемые blobs.

Статусы и операции:

- `GET /api/admin/backups/status` — последняя успешная копия, последняя ошибка, очередь, quota/free space;
- `GET /api/admin/backups` — список snapshot manifests;
- `POST /api/admin/backups/export` — создать полный manual snapshot и portable export;
- `POST /api/admin/backups/:snapshotId/verify` — проверить manifest и каждый blob;
- `POST /api/admin/backups/:snapshotId/export` — материализовать portable directory `content + settings + media + manifest`;
- `POST /api/admin/backups/:snapshotId/restore-preview` — обязательный dry-run с before/after path report;
- `POST /api/admin/backups/restore/:restoreId/apply` — применить неизменившийся dry-run как новую atomic transaction и записать restore receipt.

Если backup недоступен, канонические данные уже сохранены. UI должен показывать: «Сохранено на компьютере · резервная копия не создана» и ссылку на status/details.

## Мастер восстановления на новом компьютере

1. Установить тот же или более новый проверенный H6 source checkout. Не копировать `.admin-runtime` старого редактора поверх нового checkout.
2. Скопировать весь приватный backup root (`snapshots`, `blobs`, при необходимости `exports`) на новый компьютер.
3. Указать его абсолютный путь в `ADMIN_BACKUP_DIR` и запустить редактор ярлыком.
4. Открыть backup status, выбрать последний snapshot и выполнить Verify. Любая checksum error блокирует restore.
5. Запустить Restore preview. Просмотреть create/replace/delete report; structural arrays не объединяются автоматически.
6. Подтвердить Apply. Restore использует atomic transaction; конфликт текущих revisions требует нового dry-run.
7. Выполнить обычный exact-check восстановленной revision. Только успешный current result может перейти в preview publication.
8. Создать новый manual portable export и проверить его manifest.

Portable export в `exports/<snapshotId>/` самодостаточен для аварийного ручного извлечения: в нём есть `files/`, `manifest.json` и `RESTORE.json`. Для штатного атомарного мастера переносите весь backup root, чтобы сохранить content-addressed blobs и history manifests.

## Проверки

Focused suite:

```text
node --test tools/admin-api/exact-validation-service.test.mjs \
  tools/admin-api/backup-service.test.mjs \
  tools/admin-api/release-control.test.mjs
```

Он доказывает coalescing/stale rejection, retry failed exact, server publish gate, checksum/dedup/retention, нефатальный quota failure, portable export, restore conflict и atomic restore receipt. Эти tests включены в `test:admin-transactions` и `test:admin-publish`.

Перед H6 preview release `qa:h6:exact-targeted` действительно вызывает immutable exact runner, побайтно сравнивает репрезентативный route каждого renderer variant с уже выполненной полной production SSG, доказывает отсутствие unrelated HTML и неизменность source H5 cache. Полный all-route build, этот targeted parity gate и новый-machine restore drill запускаются из clean clone финального SHA; unit tests их не заменяют.

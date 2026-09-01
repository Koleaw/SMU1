# Публикация и release runbook СМУ-1 (H6)

Этот документ фиксирует действующий H6-контракт. Он разделяет обычное локальное сохранение контента, owner preview publish и технический release исходного кода.

## Неподвижные правила H6

- **Save ≠ Publish.** Локальное сохранение создаёт committed-транзакцию на компьютере и не выполняет Git-команды или сетевые запросы.
- Владелец может публиковать только target `preview`.
- Production target и обновление `main` из админки запрещены до H7.
- Preview publish работает только с точным allowlist content/media paths; source-код, workflow, package-файлы и runtime-артефакты в owner publish не входят.
- Проверяется prospective commit, а не произвольное состояние живого worktree.
- Один tested SHA должен оказаться сразу в обеих preview-ветках атомарным push. Последовательного fallback нет.
- Успех требует доказательств workflow + Pages + live smoke для того же SHA.

## Веточный контракт

Значения H6 по умолчанию заданы в publish planner:

- candidate: `v4-product-final-candidate`;
- deploy trigger: `preview`;
- protected production ref: `main`;
- remote: `origin`.

Перед planning фиксируются remote SHA всех трёх веток. Перед commit, перед push и при reconciliation защищённый SHA `main` проверяется повторно. Успешный owner publish обязан завершиться так:

```text
origin/v4-product-final-candidate == tested SHA
origin/preview                   == tested SHA
origin/main                      == main SHA до операции
```

Если одна preview-ветка обновилась без другой, remote ушёл вперёд, `main` изменился или сервер не поддерживает atomic push, операция завершается ошибкой. Запрещено «долечивать» её двумя ручными push.

## Что может публиковать владелец

Content-only allowlist:

- `src/content/{jobs,product-categories,product-sections,products,projects,services,site-settings,static-pages}/<slug>.json`;
- `src/data/navigation.json`;
- `src/data/yandex.json`;
- `public/uploads/<sha256>.{jpg,png,webp,mp4,webm}`.

Разрешены только пути из выбранных committed transaction manifests с точными before/after hashes и Git object ids. `.admin-runtime`, staging, `dist`, `.astro`, `public/_media/h5`, временные файлы и весь source-admin surface запрещены.

## Owner preview publish

1. UI получает список committed-транзакций и отправляет выбранные transaction IDs на preview planning.
2. Planner проверяет зависимости, path allowlist, base/anchor refs, `main` snapshot и формирует fingerprint.
3. Перед apply план вычисляется заново. Изменившийся fingerprint делает старый план недействительным.
4. Временный Git index строит дерево строго из выбранных путей. Любые посторонние staged changes блокируют операцию.
5. Создаётся prospective commit с детерминированным деревом.
6. В отдельном clean clone, detached на prospective SHA, выполняется профиль `content-only`:
   - schema/transaction validation;
   - targeted admin tests;
   - `astro check`;
   - build + media preparation;
   - H5 media budgets;
   - deploy isolation;
   - exact media references;
   - publish plan consistency.
7. Только при полном gate evidence локальная candidate-ветка переводится на tested SHA.
8. Выполняется единственный `git push --atomic` этого SHA в candidate и preview.
9. Status tracker сверяет exact SHA в GitHub workflow, Pages deployment и live smoke затронутых routes.

Empty plan ничего не коммитит и не пушит. Повтор с тем же idempotency key возвращает то же задание; неизвестный сетевой результат сначала reconciles remote refs и не создаёт новый commit.

## GitHub Actions: полный H6 CI

Workflow `.github/workflows/deploy.yml` запускается для `preview`, `develop`, `main`, `master` и вручную, но GitHub Pages может обновить только run точной ветки `preview`. `develop`, `main`, `master` и ручной test run с любой другой ветки выполняют только проверки. Перед загрузкой artifact и ещё раз непосредственно перед deploy workflow требует `origin/v4-product-final-candidate == origin/preview == GITHUB_SHA`; поэтому прямой или ошибочный push только одной ветки не может обойти owner publish.

Build job выполняет:

1. checkout и вычисление deploy metadata;
2. закреплённый Node.js 22.12.0 и `npm ci`;
3. `npm run test:admin-h6:ci` — весь H6 Node-test DAG без браузера;
4. контракты H6 evidence и `astro check`;
5. `npm run build` (включая media preparation) и performance budgets;
6. static QA, подготовку reachable Pages artifact и повторную проверку budgets;
7. browser/motion QA и доказательство изоляции public artifact;
8. фактическое открытие каждого route в public/editor desktop/mobile режимах;
9. полный public action crawl, isolated admin action crawl и recovery scenarios;
10. media privacy chain с GPS fixture и checksummed backup/restore drill;
11. reconciliation exact SHA со всеми evidence-файлами и запись `dist/_release/identity.json`;
12. двойную сверку exact candidate/preview ref pair;
13. upload/deploy GitHub Pages только для доказанного `preview` SHA при `deploy_kind=test`.

Полный локальный release gate — те же leaf suites в отдельном exact-SHA clone. Если команды запускаются вручную, каждый leaf нужно выполнять один раз: агрегат `npm run qa:final` уже содержит вложенные browser/action/media/restore проверки.

### Переменные preview workflow

Опциональные repository variables:

```env
TEST_SITE_URL=https://<owner>.github.io
TEST_BASE_PATH=/<repo>
```

Если они не заданы, workflow выводит GitHub Pages fallback из repository owner/name.

`PRODUCTION_DEPLOY_ENABLED` в H6 всегда остаётся `false`. Запрос production через `workflow_dispatch` принудительно переводится в test/check-only и ничего не публикует. Наличие future production UI не отменяет запрет production publish в локальной админке.

Локальная админка использует `GITHUB_REPOSITORY=owner/repo`, но plaintext `GITHUB_TOKEN` и `GITHUB_DEPLOY_TOKEN` запрещены даже в ignored `.env.admin.local`. Exact-SHA status для public repository сначала читается анонимно; при исчерпании anonymous limit backend может получить credential только через системный `git credential fill` (Git Credential Manager/OS keychain). Повторный запуск workflow без системной credential честно блокируется. Секрет остаётся только в памяти backend, не сериализуется и не попадает в UI или лог. Git push по HTTPS использует тот же Credential Manager, а по SSH — настроенный SSH agent/key; браузеру credentials не передаются.

## Полный release исходного кода

Source-admin изменения (код админки, workflow, документация, package/config) не публикуются owner content-only кнопкой. Их выпускает разработчик отдельными небольшими commits после review.

### 1. Зафиксировать live checkout

После создания и проверки намеренных commits, до release QA, сохраните снимок состояния в переменных текущей PowerShell-сессии:

```powershell
$releaseRoot = (Resolve-Path .).Path
$releaseSha = (git rev-parse HEAD).Trim()
$liveHeadBefore = $releaseSha
$liveStatusBefore = (git status --porcelain=v1 -uall) -join "`n"
$mainBeforeLine = git ls-remote origin refs/heads/main
if (-not $mainBeforeLine) { throw "Protected main ref is missing" }
$mainBefore = (($mainBeforeLine -split "\s+")[0]).Trim()
$releaseBranch = (git branch --show-current).Trim()
if (-not $releaseBranch) { throw "Release must start from a named task-owned branch" }
```

Проверьте, что `$releaseSha` — именно reviewed commit, а `git diff --cached --name-only` пуст. Не удаляйте и не «исправляйте» существующие `.astro`, generated или пользовательские изменения ради чистого статуса; они должны остаться ровно теми же.

### 2. Проверить exact commit в одноразовом clone

```powershell
$qaRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("smu1-release-qa-" + [guid]::NewGuid().ToString("N"))
git clone --no-local --no-checkout -- "$releaseRoot" "$qaRoot"
git -C "$qaRoot" checkout --detach "$releaseSha"
if ((git -C "$qaRoot" rev-parse HEAD).Trim() -ne $releaseSha) { throw "QA clone SHA mismatch" }
if ((git -C "$qaRoot" status --porcelain=v1 -uall) -join "`n") { throw "QA clone is dirty before gates" }
Push-Location "$qaRoot"
try {
  npm ci
  npm run qa:final
} finally {
  Pop-Location
}
if ((git -C "$qaRoot" rev-parse HEAD).Trim() -ne $releaseSha) { throw "QA changed HEAD" }
```

Не запускайте `npm run build`, `npm run qa:final` или browser QA в live checkout. Одноразовую папку удаляйте только после завершения аудита и только убедившись, что `$qaRoot` указывает на созданный temp clone.

### 3. Проверить fast-forward и preservation

```powershell
git fetch --no-tags origin "+refs/heads/main:refs/remotes/origin/main" "+refs/heads/preview:refs/remotes/origin/preview" "+refs/heads/v4-product-final-candidate:refs/remotes/origin/v4-product-final-candidate"
git merge-base --is-ancestor origin/v4-product-final-candidate "$releaseSha"
if ($LASTEXITCODE -ne 0) { throw "candidate is not fast-forward" }
git merge-base --is-ancestor origin/preview "$releaseSha"
if ($LASTEXITCODE -ne 0) { throw "preview is not fast-forward" }
if ((git rev-parse HEAD).Trim() -ne $liveHeadBefore) { throw "Live HEAD changed during QA" }
if (((git status --porcelain=v1 -uall) -join "`n") -cne $liveStatusBefore) { throw "Live worktree changed during QA" }
```

Если проверка не проходит, остановитесь и разберите расхождение. Не применяйте reset, clean, checkout, stash, rebase или force push к рабочему checkout как обход.

### 4. Atomic source release

После явного разрешения на push:

```powershell
git push --atomic origin "${releaseSha}:refs/heads/v4-product-final-candidate" "${releaseSha}:refs/heads/preview"
```

Если remote отклонил atomic push, остановитесь. Не повторяйте двумя последовательными командами и не добавляйте `--force`.

### 5. Проверить remote и deployment

```powershell
$candidateAfter = (((git ls-remote origin refs/heads/v4-product-final-candidate) -split "\s+")[0]).Trim()
$previewAfter = (((git ls-remote origin refs/heads/preview) -split "\s+")[0]).Trim()
$mainAfter = (((git ls-remote origin refs/heads/main) -split "\s+")[0]).Trim()
if ($candidateAfter -ne $releaseSha -or $previewAfter -ne $releaseSha) { throw "Preview refs do not match release SHA" }
if ($mainAfter -ne $mainBefore) { throw "Protected main changed" }
if ((git rev-parse HEAD).Trim() -ne $liveHeadBefore) { throw "Live HEAD changed" }
if (((git status --porcelain=v1 -uall) -join "`n") -cne $liveStatusBefore) { throw "Live worktree changed" }
```

Найдите run ветки `preview` через GitHub UI либо public Actions REST API и потребуйте `head_sha == $releaseSha`, `status=completed`, `conclusion=success`. Затем проверьте exact-SHA Pages deployment и его latest status `success`.

Скачайте `https://koleaw.github.io/SMU1/_release/identity.json`: marker обязан вернуть HTTP 200, содержать `testedCommitSha == $releaseSha` и побайтово совпасть с marker из локального exact-SHA clone. После этого выполните live smoke главной, representative routes, alias, `/404.html`, неизвестного URL и H5 media. Preview URL изменяемый, публичный и не защищён паролем; `noindex` не является access protection. Совпадение внешнего вида без доказательства SHA и artifact identity не считается успешным release.

## Ошибки и безопасное восстановление

- **Plan stale / remote ahead** — обновите обзор и создайте новый план; не переиспользуйте старый fingerprint.
- **Unrelated staged changes** — определите владельца staged-файлов. Не снимайте их со staging без согласования.
- **Gate failed** — remote refs не должны меняться. Исправьте причину отдельным commit/transaction и повторите весь exact-SHA контур.
- **Atomic push rejected** — обе ветки должны остаться на старых SHA. Последовательный fallback запрещён.
- **Unknown network result** — сначала `ls-remote`/reconciliation. Если обе ветки уже на tested SHA, повторный push не нужен; если ни одна — можно повторить то же idempotent job; split state требует ручного расследования.
- **Workflow/Pages failed** — локальные транзакции и tested commit сохраняются. Не объявляйте успех и не создавайте новый контент commit только ради перезапуска без анализа причины.
- **Live smoke failed** — deployment неуспешен, даже если workflow зелёный.
- **`main` changed** — немедленно остановитесь: H6 publisher не должен его менять. Сохраните refs, job/report и передайте расследование ответственному разработчику.

## H7 boundary

Production publish требует отдельного решения по домену, hosting backend, ролям, secrets, audit/backup и rollback. Включение `SITE_URL` или `PRODUCTION_DEPLOY_ENABLED=true` само по себе не является H7 и не разрешает владельцу публиковать `main`.

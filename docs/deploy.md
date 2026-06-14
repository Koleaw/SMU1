# Публикация сайта СМУ-1

## Режимы публикации

В админке есть два разных режима.

**Опубликовать тестовую версию**

- используется сейчас, пока нет боевого домена;
- пушит изменения в тестовую ветку `preview` по умолчанию;
- запускает GitHub Actions с `DEPLOY_TARGET=test`;
- не требует `SITE_URL`;
- использует `TEST_SITE_URL` и `TEST_BASE_PATH`, либо GitHub Pages fallback;
- не обновляет будущий боевой сайт.

**Опубликовать на сайт**

- будущий боевой режим;
- пушит изменения в production-ветку `main` по умолчанию;
- запускает production build с `DEPLOY_TARGET=production`;
- требует `SITE_URL`;
- сейчас, пока `SITE_URL` не задан, админка показывает: «Боевой домен пока не настроен. Используйте тестовую публикацию.» и не пушит в `main`.

## Ветки

- `preview` - тестовая версия сайта.
- `main` - будущий боевой сайт.

Имена веток можно поменять через env:

```env
ADMIN_PREVIEW_BRANCH=preview
ADMIN_PRODUCTION_BRANCH=main
```

## Env variables

Для тестовой публикации:

```env
DEPLOY_TARGET=test
TEST_SITE_URL=https://<github-user-or-org>.github.io
TEST_BASE_PATH=/SMU1
```

Если `TEST_SITE_URL` не задан в GitHub Actions, workflow вычисляет fallback `https://<owner>.github.io`. Для project site base path берется из `TEST_BASE_PATH`, либо вычисляется как `/<repo>`.

Для боевой публикации после подключения домена:

```env
DEPLOY_TARGET=production
SITE_URL=https://final-domain.ru
BASE_PATH=/
```

Для админки и GitHub API статусов:

```env
GITHUB_REPOSITORY=owner/repo
GITHUB_DEPLOY_TOKEN=
```

Токен нужен локальному `tools/admin-api/server.mjs`, чтобы получать статус GitHub Actions и логи failed job. Токен не выводится в UI и маскируется в отчетах.

## GitHub Actions

Workflow `.github/workflows/deploy.yml` определяет цель так:

- push в `main`/`master` -> `production`;
- push в `preview`/`develop` -> `test`;
- ручной запуск `workflow_dispatch` -> выбранный `deploy_target`.

Для `test` workflow:

- запускает `npm ci`;
- запускает `npm run check`;
- запускает `npm run build`;
- публикует артефакт в GitHub Pages.

Для `production` workflow:

- заранее проверяет наличие repository variable `SITE_URL`;
- если `SITE_URL` не задан, завершает workflow понятной ошибкой;
- запускает `npm run check` и `npm run build`;
- не деплоит в GitHub Pages, потому что будущий хостинг должен сам забирать изменения из production-ветки.

## Почему SITE_URL пока не нужен для теста

Production-сборка должна иметь корректный канонический домен для sitemap, canonical URL и SEO. Пока домена нет, production-публикация заблокирована.

Тестовая сборка использует `TEST_SITE_URL`/GitHub Pages fallback и не считается боевой SEO-публикацией.

## Когда появится домен и хостинг

1. Подключить хостинг к ветке `main`.
2. Задать repository variable `SITE_URL=https://final-domain.ru`.
3. Оставить `BASE_PATH=/`, если сайт открыт с корня домена.
4. Проверить production workflow вручную через `workflow_dispatch` с `deploy_target=production`.
5. После успешной проверки использовать кнопку «Опубликовать на сайт».

## Отчет об ошибке

Если публикация или build упали, в админке появится кнопка «Скачать отчет об ошибке».

В отчете указываются:

- дата и время;
- режим публикации;
- branch;
- commit hash и commit message;
- URL workflow run;
- статус run;
- failed job и failed step;
- последние строки лога;
- краткое объяснение;
- вероятная причина;
- что сделать дальше;
- команды `npm run check` и `npm run build`.

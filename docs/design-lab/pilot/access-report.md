# Диагностика доступа и среды

Дата диагностики: **11 июля 2026 года**. Рабочий часовой пояс: **Europe/Moscow (UTC+3)**.

## Исходное состояние

| Проверка | Фактический результат |
|---|---|
| Рабочая папка | `D:\работа\СМУ1\SMU1` |
| Codex | `codex-cli 0.144.1` |
| Начальный `git status --short` | пустой вывод; рабочее дерево было чистым |
| Время фиксации исходного состояния | `2026-07-11T12:00:42+03:00` |
| Node.js / npm | `v24.15.0` / `11.12.1` |
| Встроенный web search/open | доступен; поиск и открытие публичных страниц выполнены фактически |
| Прямые HTTP-запросы | доступны через PowerShell/curl; ответы зависят от защиты конкретного сайта |

После начала работы `git status --short` показывает только новый каталог `docs/design-lab/`; исходный код, контент, стили, конфиги, зависимости и workflow не менялись.

## Уже установленные браузерные средства

Ничего не устанавливалось.

| Средство | Путь / версия | Результат |
|---|---|---|
| Google Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`, `149.0.7827.201` | нативный headless-рендеринг и CDP работают |
| Microsoft Edge | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, `150.0.4078.48` | установлен; резервный путь, в итоговом сборе не понадобился |
| Playwright | кэшированный модуль `1.60.0` в пользовательском npm cache | программный захват и DOM/computed-style измерения работают |
| Chromium for Playwright | `148.0.7778.96` в `ms-playwright/chromium-1223` | использован для Foster, mmcité, Skanska и Linear |
| Chromium headless shell | уже присутствует в `ms-playwright/chromium_headless_shell-1223` | обнаружен, отдельно не требовался |
| Puppeteer / Selenium / Pyppeteer | не обнаружены | не использовались |
| Firefox / отдельный системный Chromium | не обнаружены | не использовались |

В `package.json`, lock-файлы и локальный `node_modules` ничего не добавлялось. `npx` не запускался, браузеры не скачивались.

## Проверка интернета и HTTP

1. Встроенный web search вернул актуальные официальные страницы Foster + Partners и Vestre, затем был использован для уточнения URL всех пяти сайтов.
2. Прямой PowerShell HTTP-запрос к `https://www.fosterandpartners.com/` первоначально вернул `200`, 86 095 байт и title `Foster + Partners`, но прямой browser-вход на тот же `www` root отдал фирменную страницу `404`.
3. Вход через `https://fosterandpartners.com/` без `www` прошел edge-маршрут, завершился на `https://www.fosterandpartners.com/` с итоговым документом `200` и полноценной главной. Это подтверждено [`home-desktop-viewport.png`](screenshots/foster/home-desktop-viewport.png).
4. Прямой PowerShell HTTP-запрос к `https://vestre.com/` вернул `429 Too Many Requests`. Playwright-launched Chromium также сначала увидел `Vercel Security Checkpoint`.
5. Нативный Chrome открыл Vestre визуально. В CDP-журнале одного перехода зафиксированы два document response: сначала `429`, затем итоговый `200`; после этого title, DOM, изображения и интерактивные компоненты соответствовали Vestre. Доказательство: [`home-desktop.png`](screenshots/vestre/home-desktop.png) и capture-реестр `_capture-results-vestre.json`.
6. mmcité, Skanska и Linear открылись в Chromium с итоговым HTTP `200`; детали по каждому URL находятся в [source-register.md](source-register.md).

## Проверка реального визуального рендеринга

Первый нативный Chrome-снимок прямого `www` root Foster показал фирменную `404` и cookie wall, поэтому не был принят как исследование. Повторный вход через non-`www` дал полностью отрендеренный hero с видео, фотографией, навигацией и клиентской каруселью. PNG проверен визуально, а DOM зафиксировал `video`, `object-fit: cover`, fixed header и загруженные media.

Vestre был вторым независимым тестом. Нативный Chrome отрисовал видеофон, продуктовую сетку и навигацию после checkpoint-перехода. Таким образом подтверждены все три уровня доступа:

- интернет и DNS;
- выполнение клиентского JavaScript, web-fonts и media;
- desktop/mobile PNG заданных viewport с DOM/computed-style измерениями.

## Ограничения доступа

- Foster чувствителен к host, завершающему слешу и edge-маршруту. Apple Park Visitor Center и `/studio/about` возвращали фирменную `404` при HTTP `200`; эти состояния не засчитаны и не подменены молча.
- Vestre применяет Vercel checkpoint. Playwright-launch fingerprint получил `429`; рабочим оказался нативный Chrome с последующим CDP-подключением и подтвержденным финальным `200`.
- У Vestre часть изображений раскрывается только при попадании в viewport. Единый full-page захват оставлял blur/lazy-состояния; поэтому доказательствами служат точный первый экран и отдельные зоны после реальной прокрутки.
- Web search/open использовался для поиска URL и текстовой перепроверки, но не заменял визуальный браузерный анализ.
- Состояние живых сайтов относится к дате просмотра; последующие изменения сайтов не отражены.

## Вывод диагностики

Среда пригодна для реального визуального пилота. Доступ не является одинаково стабильным на всех доменах, но уже установленных Chrome, Chromium и Playwright достаточно для подтвержденного рендеринга, desktop/mobile-скриншотов и DOM/computed-style анализа без установки зависимостей.

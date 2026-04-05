# Сайт СМУ-1 (Astro + GitHub Pages)

Рабочий каркас сайта СМУ-1 под статическую публикацию в GitHub Pages.

## Запуск локально

```bash
npm install
npm run dev
```

Проверка типов и сборки:

```bash
npm run check
npm run build
npm run preview
```

## Деплой на GitHub Pages

1. Убедиться, что репозиторий на GitHub и ветка `main` (или `master`) используется для релизов.
2. В **Settings → Pages** выбрать **Source: GitHub Actions**.
3. Запушить изменения — workflow `.github/workflows/deploy.yml` соберет сайт и опубликует `dist/`.
4. Для кастомного домена задайте `SITE_URL` и/или правьте `astro.config.mjs`.

## Где менять контент

- Тексты и базовые данные: `src/data/*.json`
- Категории и подкатегории: `src/data/categories.json`, `src/data/product-categories.json`
- Проектные страницы: `src/data/project-pages.json`
- Объекты: `src/data/objects.json`
- FAQ: `src/data/faqs.json`
- Контакты компании: `src/data/site.json`

## Где менять фото

- Изделия: `public/assets/images/products/`
- Объекты: `public/assets/images/objects/`
- Производство: `public/assets/images/production/`
- Временные заглушки: `public/assets/images/placeholders/`

## Где менять цены

- Для товарных категорий: `src/data/product-categories.json` (`priceMode`, `priceLabel`, `priceValue`).
- Для проектных страниц рекомендуем «по запросу» + CTA «Рассчитать стоимость».

## Где менять цвета и стили

- Тема и дизайн-токены: `src/styles/global.css` (`:root` переменные).
- Компоненты и сетка: `src/components/*.astro`.

## Где менять формы

- Архитектура форм: `src/components/LeadForm.astro`
- Точка подключения внешнего form backend: `src/data/forms.json` (`endpoint`)

### Важно по формам (GitHub Pages)

GitHub Pages не обрабатывает POST на сервере. Для реальной отправки:
1. Выберите внешний обработчик (Formspree/Web3Forms/аналог).
2. Вставьте его endpoint в `src/data/forms.json`.
3. При необходимости добавьте юридический текст о согласии на обработку данных.

## Логотип

- Временный файл: `public/assets/brand/logo-full.svg`
- Временный favicon: `public/assets/brand/favicon.svg`
- После утверждения бренд-материалов замените эти файлы на финальные.

## Что сейчас честно оставлено заглушками до мая

- Часть фото изделий, объектов и производства.
- Данные карточек некоторых объектов (без фейковых цифр и сроков).
- Финальный логотип/иконка.
- Подключение боевого внешнего form backend и юридический блок.

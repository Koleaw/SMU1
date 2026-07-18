# Временный V2 media-role и project-presentation adapter

Adapter расположен в `src/components/design-lab/v2/mediaRoleAdapter.ts` и работает только в presentation layer design-lab V2. Production records, schema и media он не изменяет.

На уровне media сохраняются явные назначения `project slug + существующий media path`: `metalworks`, `construction`, `construction-building`, `landscaping`, `finished-result`, `process`, `proof`, `hero`, `excluded`. Путь сначала проверяется по `image`/`coverImage`/`gallery`/`images` исходного record; сохраняются порядок, dedupe, заполненные `alt` и `caption`. Имя файла не используется как смысловое доказательство.

На уровне project добавлены временные назначения:

- `archiveCoverMedia` — cover archive-карточки;
- `detailHeroMedia` — отдельный detail hero;
- `archiveCoverPosition` и `detailHeroPosition` — проверенный controlled crop;
- `publicGallery` — явная публичная последовательность разрешённых кадров;
- `excludedFromPresentation` — разрешённые media record, не вошедшие в текущую публичную выборку;
- `isTextOnly` — вариант объекта без пригодного cover/public gallery;
- связанные V2-направления с публичным контекстом;
- проверенные alt для ключевых кадров;
- production и V2 detail routes.

Archive cover/detail hero назначены так: набережная — `project-da0872c68d9a09f0a7d2f995.jpg`; промышленная территория — `img-20250724-134235-1783272745917.jpg`; качели — внешний landscape-кадр `project-05e1cb18f1d596a46bdacc90.jpg`. Ремонт сквера имеет `isTextOnly: true` и не получает фиктивный cover.

Публичные V2 gallery содержат соответственно 3, 10, 4 и 0 кадров. Для промышленного объекта 22 других разрешённых кадра остаются в `media` и вычисляемом `excludedFromPresentation`: они не удалены и не помечены запрещёнными, а лишь не входят в текущую публичную подборку. Отдельная роль `excluded` продолжает исключать три внутренних кадра промышленного объекта (`134252`, `134312`, `134415`), два кадра внутреннего производства качелей (`c9865e`, `93a94b`) и оба placeholder сквера. Исходные файлы, hashes и ссылки в records сохранены.

У набережной direction proof использует только два finished-result кадра, а detail page — все три разрешённых кадра: один объект поэтому может иметь разные media-роли и выборки в разных контекстах. Detail/gallery components не содержат slug-проверок — они получают готовую presentation-модель.

Project-level mapping остаётся только в design-lab, потому что текущая production schema не содержит presentation-полей и её изменение запрещено. В будущей админке должны управляться archive cover, detail hero, crop position, порядок/public gallery selection, presentation exclusion, text-only state, роли каждого media, hard excluded state, alt/caption, связанные направления и короткий публичный контекст. Проектирование админки в эту работу не входит.

# H6 visual editor browser evidence

These screenshots were captured from the real loopback owner launcher and the
same Astro production components used by the public site. No screenshot is used
as an editor canvas. The capture run did not press Save or Publish and did not
change canonical content.

Application source started from `0a2bbf807a7728ab287ff8fceb7a60a44c698443`.
The capture checkout also included the pending follow-up change that disables
the unrelated Astro developer toolbar; the final H6 branch contains that same
change.

1. `01-home-page-first-editor.png` — Home is the default page; persistent toolbar,
   navigator, production iframe canvas and edit overlays are visible.
2. `02-inline-h1-edit.png` — clicking the real Home H1 opens the anchored editor;
   Escape cancelled the gesture and Save stayed disabled.
3. `03-page-settings-drawer.png` — always-available page settings, route impact and
   heavy-operation boundary.
4. `04-publish-drawer.png` — local Save, exact check, preview and disabled H7
   production step are separate.
5. `05-bulk-media-20-selection.png` — 20 unique raster files were selected in one
   operation. Together with three existing gallery items, the visible numbered
   queue contains 23 items and 14.2 MB.
6. `06-bulk-media-reordered.png` — the same queue after `Обратный порядок`; the
   first visible item changed before Save.
7. `07-category-reorder-controls.png` — 16 bench cards expose handle-only drag and
   keyboard move buttons directly on the real category page.
8. `08-category-reorder-inspector.png` — contextual source/impact and position
   controls for the selected product order field.

The 23-item media queue restored in a second browser tab before screenshots 5–6,
proving browser recovery independently of canonical Save. The clean second-tab
run reported no console warnings or errors.

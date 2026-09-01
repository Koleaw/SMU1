# H6 visual editor concepts

These images are reference concepts used to set hierarchy, density and interaction
priorities for the page-first editor. They are design evidence only; the editor
canvas always renders the real Astro site and never uses screenshots as an
editable surface.

- `page-first-editor.png` — default Home canvas, navigator, overlay and inspector.
- `publish-drawer.png` — revision/check/preview separation and future H7 step.
- `bulk-media.png` — numbered media queue and explicit role assignment.

## Fidelity ledger

Implemented from the concepts:

- persistent compact toolbar, collapsible page navigator, production canvas and
  contextual right-hand inspector;
- status expressed in human language while technical identifiers stay behind a
  disclosure;
- Save, exact validation, preview publication and future production publication
  as distinct steps;
- numbered media queue with thumbnails, order controls, roles, alt/caption and
  per-file status.

Intentional implementation differences:

- the real site determines canvas typography, spacing and responsive geometry;
  the concept artwork is never embedded in the editor;
- reorder controls are attached to schema-owned zones instead of providing a
  free-form page builder;
- the production step is visibly disabled in H6, and preview is described as
  public/noindex rather than protected;
- desktop density was tuned against the actual 1280–1440 px local application,
  not against the concept's idealized viewport.

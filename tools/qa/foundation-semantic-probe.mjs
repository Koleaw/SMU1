// Runs inside the existing public action crawl on desktop AND mobile.
export async function exerciseFoundationGeometry({browser,check,action,click,fill,waitFor,current,valid}) {
  await action('tab',false,'[data-tab="data"]');
  await click('[data-preserve-open="geo-examples"] > summary',true);
  await action('geo-example',true,'[data-kind="l"]');
  check('foundation-L-area-volume',await waitFor(`${valid} && (${current})?.resultSnapshot?.totals.concreteAreaM2 === 36 && (${current})?.resultSnapshot?.totals.concreteVolumeM3 === 9`));
  await action('geo-select',true,'[data-index="0"]');
  await action('geo-nudge',true,'[data-direction="right"]');
  check('foundation-diagram-nudge',await waitFor(`(${current})?.input.shapes.polygon.vertices[0].x === 100`));
  await action('history-undo',true);
  check('foundation-undo-geometry',await waitFor(`${valid} && (${current})?.input.shapes.polygon.vertices[0].x === 0`));
  await action('history-redo',true);
  check('foundation-redo-geometry',await waitFor(`(${current})?.input.shapes.polygon.vertices[0].x === 100`));
  await action('history-undo',true);
  await action('geo-add',true);
  check('foundation-add-vertex',await waitFor(`(${current})?.input.shapes.polygon.vertices.length === 7`));
  await action('geo-remove',true);
  check('foundation-remove-vertex',await waitFor(`${valid} && (${current})?.input.shapes.polygon.vertices.length === 6`));
  await click('[data-field="shapes.polygon.closed"]');
  check('foundation-open-contour-no-result',await waitFor(`!document.querySelector('[data-error]').hidden && !document.querySelector('[data-summary] dl') && !(${current})?.resultSnapshot`));
  await action('history-undo',true);
  check('foundation-error-recovery',await waitFor(valid));
  await action('geo-example',true,'[data-kind="bridge"]');
  check('foundation-bridge-union',await waitFor(`${valid} && Math.abs((${current})?.resultSnapshot?.totals.concreteAreaM2 - 16.64) < 1e-9 && Math.abs((${current})?.resultSnapshot?.totals.formworkAreaM2 - 20.6) < 1e-9`));
  await click('[data-preserve-open="geo-footprint"] > summary',true);
  await action('geo-foot-clear',true);
  check('foundation-no-invented-footprint',await waitFor(`!document.querySelector('[data-error]').hidden && !(${current})?.resultSnapshot && document.querySelector('[data-error]').textContent.includes('внешний контур')`));
  await action('history-undo',true);
  check('foundation-footprint-recovered',await waitFor(valid));
  await action('geo-foot-add',true);
  check('foundation-footprint-vertex-added',await waitFor(`(${current})?.input.shapes.network.footprint.vertices.length === 5`));
  await action('geo-foot-remove',true,'[data-index="4"]');
  check('foundation-footprint-vertex-removed',await waitFor(`${valid} && (${current})?.input.shapes.network.footprint.vertices.length === 4`));
  await action('example',true);
  check('foundation-legacy-still-12m3',await waitFor(`${valid} && (${current})?.resultSnapshot?.totals.concreteVolumeM3 === 12`));
}

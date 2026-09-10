const validRect = (rect) => rect && ['left', 'top', 'right', 'bottom', 'width', 'height']
  .every((key) => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;

const inside = (inner, outer) => validRect(inner) && validRect(outer)
  && inner.left >= outer.left - 1 && inner.top >= outer.top - 1
  && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;

export function evaluateGalleryViewport(geometry) {
  if (!geometry) return { ok: false, reason: 'missing-geometry' };
  const viewport = { left: 0, top: 0, right: geometry.viewport?.width,
    bottom: geometry.viewport?.height, width: geometry.viewport?.width, height: geometry.viewport?.height };
  const mediaInsideViewport = inside(geometry.media, viewport);
  const pictureInsideMedia = inside(geometry.picture, geometry.media);
  const imageInsideMedia = inside(geometry.image, geometry.media);
  const completeImage = geometry.ready === true && geometry.fit === 'contain';
  return { ok: mediaInsideViewport && pictureInsideMedia && imageInsideMedia && completeImage,
    mediaInsideViewport, pictureInsideMedia, imageInsideMedia, completeImage };
}

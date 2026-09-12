/** One explicit editor control for the desktop poster hidden behind Home's video. */
export function homePosterControlLayout(row, rows, viewport, headerBottom = 0) {
  const { binding, rect } = row || {};
  if (binding?.renderer?.family !== 'home' || binding.role !== 'home-hero-poster-desktop' || !rect) return null;
  const video = rows.find((candidate) => candidate.binding?.renderer?.family === 'home'
    && candidate.binding.role === 'home-hero-video'
    && candidate.binding.ownerCollection === binding.ownerCollection
    && candidate.binding.recordSlug === binding.recordSlug
    && ['left', 'top', 'width', 'height'].every((key) => Math.abs(candidate.rect?.[key] - rect[key]) <= 2));
  if (!video) return null;
  const leftEdge = Math.max(rect.left, viewport.left);
  const rightEdge = Math.min(rect.right, viewport.right);
  const bottomEdge = Math.min(rect.bottom, viewport.bottom);
  const width = Math.min(216, rightEdge - leftEdge - 24);
  const left = leftEdge + 12;
  const top = Math.max(rect.top + 12, viewport.top + 12, headerBottom + 12);
  // This is still the same poster control; it becomes available again when its
  // media area returns. Never fall back to the video-covered full-size target.
  if (width < 44 || top + 44 > bottomEdge - 4) return { hidden: true };
  return { left, top, width, height: 44, right: left + width, bottom: top + 44 };
}

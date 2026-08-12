function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
  }
  return value;
}

/**
 * Produces an isolated view model for a structured gallery without rewriting
 * strings, captions, alternative text or legacy passthrough properties.
 */
export function normalizeStructuredGalleryForView(gallery) {
  if (!Array.isArray(gallery)) return [];
  return gallery.map(cloneJsonValue);
}

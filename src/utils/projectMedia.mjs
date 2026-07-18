function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function projectMediaPath(item) {
  if (typeof item === 'string') return cleanText(item);
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  return cleanText(item.src) || cleanText(item.image) || cleanText(item.url);
}

export function normalizeProjectMediaItem(item, fallbackAlt = '') {
  const src = projectMediaPath(item);
  if (!src) return null;
  if (typeof item === 'string') return { src, alt: cleanText(fallbackAlt), caption: '' };
  return {
    src,
    alt: cleanText(item.alt) || cleanText(fallbackAlt),
    caption: cleanText(item.caption)
  };
}

export function projectMediaSourceKey(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  if (cleanText(item.src)) return 'src';
  if (cleanText(item.image)) return 'image';
  if (cleanText(item.url)) return 'url';
  return 'src';
}

export function sanitizeProjectGallery(value) {
  const items = [];
  const warnings = [];
  const seen = new Set();
  if (value === undefined) return { items: undefined, warnings };
  if (!Array.isArray(value)) return { items: undefined, warnings: ['gallery: ожидается массив; значение пропущено.'] };

  value.forEach((item, index) => {
    const src = projectMediaPath(item);
    if (!src) {
      warnings.push(`gallery[${index}]: отсутствует строковый src; элемент пропущен.`);
      return;
    }
    if (seen.has(src)) {
      warnings.push(`gallery[${index}]: путь ${src} уже встречался; дубль пропущен.`);
      return;
    }
    seen.add(src);
    if (typeof item === 'string') items.push(src);
    else items.push({ ...item, [projectMediaSourceKey(item)]: src });
  });
  return { items, warnings };
}

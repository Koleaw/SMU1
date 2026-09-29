import presentations from '../data/media-presentation.json';

type ImageView = { fit?: 'cover' | 'contain'; positionX?: number; positionY?: number; scale?: number };
type MediaPresentation = { kind: 'render' | 'scene'; background?: string };

// Source-level art direction, reviewed from the originals. File extensions do
// not distinguish a studio render from a photograph. Existing card crops keep
// using imageView; gallery frames have their own presentation.
export const mediaPresentation = (source: string): MediaPresentation | undefined =>
  (presentations as Record<string, MediaPresentation>)[source];

export const galleryImageView = (source: string, fallback?: ImageView, ratio = 1.5): ImageView => {
  const presentation = mediaPresentation(source);
  if (!presentation) return fallback ?? { fit: 'contain', positionX: 50, positionY: 50, scale: 1 };
  return { fit: presentation.kind === 'render' || ratio < 1 ? 'contain' : 'cover', positionX: 50, positionY: 50, scale: 1 };
};

export const mediaBackground = (source: string) => mediaPresentation(source)?.background || '#fff';

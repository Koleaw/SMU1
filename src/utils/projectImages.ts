import { normalizeProjectMediaItem } from './projectMedia.mjs';

export type RawProjectImage =
  | string
  | {
      src?: string;
      image?: string;
      url?: string;
      alt?: string;
      caption?: string;
    };

export type ProjectImage = {
  src: string;
  alt: string;
  caption?: string;
};

export type ProjectImageSource = {
  title?: string;
  image?: string;
  coverImage?: string;
  gallery?: RawProjectImage[];
  images?: RawProjectImage[];
  captions?: string[];
};

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeImage(value: RawProjectImage | undefined, title: string, fallbackCaption = ''): ProjectImage | null {
  const normalized = normalizeProjectMediaItem(value, title);
  if (!normalized) return null;
  return {
    src: normalized.src,
    alt: normalized.alt || title,
    caption: normalized.caption || cleanText(fallbackCaption) || undefined
  };
}

export function getProjectImages(project: ProjectImageSource): ProjectImage[] {
  const title = cleanText(project.title) || 'Выполненный объект';
  const captions = Array.isArray(project.captions) ? project.captions : [];
  const result: ProjectImage[] = [];
  const seen = new Set<string>();

  const add = (image: ProjectImage | null) => {
    if (!image || seen.has(image.src)) return;
    seen.add(image.src);
    result.push(image);
  };

  const cover = project.coverImage || project.image;
  const normalizedCover = normalizeImage(cover, title, captions[0]);
  if (cover !== undefined && !normalizedCover) console.warn(`[projects] ${title}: некорректное главное изображение пропущено.`);
  add(normalizedCover);

  const gallery = Array.isArray(project.gallery) ? project.gallery : [];
  gallery.forEach((image, index) => {
    const normalized = normalizeImage(image, title, captions[index + 1] || captions[index]);
    if (!normalized) console.warn(`[projects] ${title}: gallery[${index}] без строкового src пропущен.`);
    add(normalized);
  });

  const images = Array.isArray(project.images) ? project.images : [];
  images.forEach((image, index) => {
    const normalized = normalizeImage(image, title, captions[index]);
    if (!normalized) console.warn(`[projects] ${title}: images[${index}] без строкового src пропущен.`);
    add(normalized);
  });

  return result;
}

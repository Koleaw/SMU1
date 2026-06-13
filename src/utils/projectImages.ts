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
  if (!value) return null;

  if (typeof value === 'string') {
    const src = cleanText(value);
    return src ? { src, alt: title, caption: cleanText(fallbackCaption) || undefined } : null;
  }

  const src = cleanText(value.src) || cleanText(value.image) || cleanText(value.url);
  if (!src) return null;

  return {
    src,
    alt: cleanText(value.alt) || title,
    caption: cleanText(value.caption) || cleanText(fallbackCaption) || undefined
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

  add(normalizeImage(project.coverImage || project.image, title, captions[0]));

  const gallery = Array.isArray(project.gallery) ? project.gallery : [];
  gallery.forEach((image, index) => add(normalizeImage(image, title, captions[index + 1] || captions[index])));

  const images = Array.isArray(project.images) ? project.images : [];
  images.forEach((image, index) => add(normalizeImage(image, title, captions[index])));

  return result;
}


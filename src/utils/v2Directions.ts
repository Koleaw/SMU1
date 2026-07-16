import { getCollection } from 'astro:content';

export type V2DirectionSlug =
  | 'ulichnaya-mebel'
  | 'ograzhdeniya-i-zabory'
  | 'navesy-i-kozyrki'
  | 'metallokonstruktsii-dlya-biznesa'
  | 'topiarii'
  | 'blagoustroystvo-territoriy'
  | 'stroitelstvo-i-remonty';

export interface V2DirectionSummary {
  slug: V2DirectionSlug;
  title: string;
  description: string;
  href: string;
  showOnHome: boolean;
  listOrder: number;
  image?: string;
  imageFit: 'cover' | 'contain';
  imagePosition: string;
}

type DirectionRecord = {
  slug: string;
  title: string;
  shortDescription: string;
  image?: string;
  imageView?: { fit?: string; positionX?: number; positionY?: number };
  showOnHome?: boolean;
  isActive?: boolean;
};

type PresentationConfig = {
  listOrder: number;
  legacyTitle: string;
  approvedTitle: string;
  legacyDescription: string;
  approvedDescription: string;
  legacyImage: string;
  approvedImage?: string;
  approvedPosition?: string;
};

const presentation: Record<V2DirectionSlug, PresentationConfig> = {
  'ulichnaya-mebel': {
    listOrder: 1,
    legacyTitle: 'Уличная мебель',
    approvedTitle: 'Уличная мебель',
    legacyDescription: 'Направление с серийными и адаптируемыми решениями для общественных и коммерческих территорий.',
    approvedDescription: 'Серийные и адаптируемые решения для общественных и коммерческих территорий.',
    legacyImage: '/uploads/chatgpt-image-17-2026-15-34-46-1779555132517.png',
    approvedImage: '/uploads/project-05e1cb18f1d596a46bdacc90.jpg'
  },
  'ograzhdeniya-i-zabory': {
    listOrder: 2,
    legacyTitle: 'Ограждения и заборы',
    approvedTitle: 'Ограждения и заборы',
    legacyDescription: 'Ограждения, заборы, ворота, калитки, перила и входные группы, которые проектируются и изготавливаются под конкретный объект.',
    approvedDescription: 'Заборы, ворота, калитки, перила, поручни и входные группы.',
    legacyImage: '/uploads/hero-1780248334850.png',
    approvedImage: '/uploads/project-248f17177df30b29ab9b231a.jpg'
  },
  'navesy-i-kozyrki': {
    listOrder: 3,
    legacyTitle: 'Навесы',
    approvedTitle: 'Навесы и козырьки',
    legacyDescription: 'Навесы для входных групп, зон ожидания, велопарковок, контейнерных площадок и благоустройства территорий.',
    approvedDescription: 'Для входных групп, зон ожидания, велопарковок и хозяйственных площадок.',
    legacyImage: '/uploads/2026-03-08-221112-1777541397642.png'
  },
  'metallokonstruktsii-dlya-biznesa': {
    listOrder: 4,
    legacyTitle: 'Металлоконструкции',
    approvedTitle: 'Металлоконструкции',
    legacyDescription: 'Металлоконструкции под задачу: каркасы, рамы, площадки, лестницы, опорные элементы и нестандартные конструкции.',
    approvedDescription: 'Каркасы, рамы, площадки, лестницы, опорные элементы и конструкции по чертежам.',
    legacyImage: '/uploads/chatgpt-image-5-2026-22-01-29-1783278108067.png',
    approvedImage: '/uploads/img-20250724-134010-1783272745899.jpg'
  },
  topiarii: {
    listOrder: 5,
    legacyTitle: 'Топиарии',
    approvedTitle: 'Топиарии',
    legacyDescription: 'Декоративные топиарии, зеленые фигуры, композиции и арт-объекты под задачу территории.',
    approvedDescription: 'Декоративные фигуры, зелёные композиции и арт-объекты под задачу пространства.',
    legacyImage: '/uploads/chatgpt-image-5-2026-21-56-34-1783277800820.png'
  },
  'blagoustroystvo-territoriy': {
    listOrder: 6,
    legacyTitle: 'Благоустройство',
    approvedTitle: 'Благоустройство территорий',
    legacyDescription: 'Благоустройство территорий, входных групп, дворов, зон отдыха и хозяйственных площадок с подбором МАФ, конструкций и монтажом.',
    approvedDescription: 'Дворы, входные группы, зоны отдыха и хозяйственные площадки с подбором конструкций и монтажом.',
    legacyImage: '/assets/images/placeholders/landscaping.svg',
    approvedImage: '/uploads/project-da0872c68d9a09f0a7d2f995.jpg'
  },
  'stroitelstvo-i-remonty': {
    listOrder: 7,
    legacyTitle: 'Строительство',
    approvedTitle: 'Строительство и ремонты',
    legacyDescription: 'Строительные и монтажные работы на объекте: основания, входные группы, хозяйственные зоны, монтаж конструкций и работы по ТЗ.',
    approvedDescription: 'Основания, монтаж и работы по ТЗ — до подтверждённой сборки зданий и производственных цехов.',
    legacyImage: '/assets/images/placeholders/construction.svg',
    approvedImage: '/uploads/img-20250724-134235-1783272745917.jpg'
  }
};

const isPlaceholder = (value: string) => value.startsWith('/assets/images/placeholders/');
const approvedUntilEdited = (current: string, legacy: string, approved: string) =>
  current.trim() === legacy ? approved : current.trim();

export const loadV2Directions = async (): Promise<V2DirectionSummary[]> => {
  const [sectionEntries, serviceEntries] = await Promise.all([
    getCollection('product-sections'),
    getCollection('services')
  ]);
  const records = [...sectionEntries, ...serviceEntries]
    .map(({ data }) => data as DirectionRecord)
    .filter((record) => record.isActive !== false && record.slug in presentation);

  return records.map((record) => {
    const slug = record.slug as V2DirectionSlug;
    const config = presentation[slug];
    const sourceImage = record.image?.trim() ?? '';
    const image = sourceImage === config.legacyImage
      ? config.approvedImage
      : (sourceImage && !isPlaceholder(sourceImage) ? sourceImage : undefined);
    const usesApprovedImage = sourceImage === config.legacyImage;
    const fit = record.imageView?.fit === 'contain' ? 'contain' : 'cover';
    const imageFit: 'cover' | 'contain' = usesApprovedImage ? 'cover' : fit;
    const position = usesApprovedImage
      ? (config.approvedPosition ?? '50% 50%')
      : `${record.imageView?.positionX ?? 50}% ${record.imageView?.positionY ?? 50}%`;

    return {
      slug,
      title: approvedUntilEdited(record.title, config.legacyTitle, config.approvedTitle),
      description: approvedUntilEdited(record.shortDescription, config.legacyDescription, config.approvedDescription),
      href: `/${slug}/`,
      showOnHome: record.showOnHome !== false,
      listOrder: config.listOrder,
      image,
      imageFit,
      imagePosition: position
    };
  }).sort((a, b) => a.listOrder - b.listOrder);
};
